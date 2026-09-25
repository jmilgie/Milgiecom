// Nova Lancers — enemy roster (the Choir).
//
// Definition fields (all optional unless noted):
//   spr (required)   sprite name            hp, r (collision radius), score, z (draw order)
//   move             default path name (params may override with p.path)
//   paths            { name: fn } per-enemy custom paths (same purity rules as js/game/paths.js)
//   pdef             default spawn params, filled into e.p on every peer at spawn (missing keys only)
//   rot              true: sprite uses baked direction frames following the heading (e.face ?? heading)
//   fps / frame(e,t,sim)                    animation (frame() must be deterministic or purely cosmetic)
//   fire: [{ at, every, times, pat, args, aim=true, target:'near'|'rand', jitter, from:[dx,dy], when(e,sim,t), maxY }]
//                    engine fire schedule (kept for compatibility — the roster below uses `guns`)
//   guns: [{ at=1, every=0, times, pat, args, aim=true|'rand'|false, from:[dx,dy], maxY (px),
//            minD (px), jitter (rad), rot (random a0 range, rad), ph (only in this phase; timing
//            then counts from the phase start), dens=true, tele (1: drives the telegraph glow/frame) }]
//                    tick-exact HOST schedule run by runGuns(): fires only when the muzzle is on
//                    screen, above maxY (aimed default 280, unaimed 320) and at least minD (48) px
//                    from every live player; aimed guns get args.a + args.target (slot);
//                    args.n scales with co-op density. Timing is fixed, so every peer can derive
//                    the telegraph (gunClock / teleAmt) without extra network events.
//   brain(e, sim, t)  HOST ONLY per-tick logic (use sim.fire / sim.setParams / sim.setPhase / sim.spawn / sim.cue)
//                    (defs with `guns` and no brain get one automatically; custom brains call runGuns)
//   onKill(e, sim, by) HOST ONLY, when killed (e.g. split an asteroid: sim.spawn(...) children)
//   deathFire: { pat, args, aim, from } | [...]   HOST fires this pattern from the death position
//   onSpawn(e, sim) / onPhase(e, ph, sim) / onDeath(e, sim)   run on EVERY peer (cosmetic + deterministic state)
//   cues: { name(e, sim, data) }            run on every peer via sim.cue(name, data, e)
//   drops: { gem, gemL, power, bomb, od, life }  (counts / probabilities)
//   explode: 'tiny'|'small'|'medium'|'large'|'huge'|'boss'   palette: fx palette   odGain
//   ground (drawn under, no body collision), armor (bullets bounce), noHit, noCollide,
//   ignoreClear (doesn't block wait:'clear'), boss, midboss, bar (show HP bar), name, hpScale:false,
//   maxLife (s), warp (warp-in fx), draw(e,ctx,lctx,sim,env) / drawOver(...)
//   Roster-specific data read by the shared brains: lay (weaver), boom (mine), split (rocks),
//   volleys/cycles (phantom), attacks/life (sentinel), lvl/theme (bastion), dash (lancet elite).
//
// Per-instance state that is identical on every peer (safe for paths/draw): e.p, e.phase,
// e.phaseT0, e.armor, fields written by onSpawn/onPhase/cues. e.data is HOST-ONLY scratch.
//
// Roster (keys = sprite name without 'en_'; elites reuse the base sprite + a colored aura):
//   mite mite_shot · dart dart_elite · wisp wisp_ring · lancet lancet_elite ·
//   eye eye_ring eye_elite · carapace carapace_elite · weaver weaver_elite · mine mine_elite ·
//   hornet hornet_elite · seeker · shard shard_elite · phantom phantom_elite ·
//   turret turret_heavy turret_flak · rock_s rock_m rock_l · sentinel sentinel_elite ·
//   bastion bastion_crystal bastion_wreck bastion_void (mid-bosses, +25% HP per tier)

import { FIELD_W, FIELD_H } from '../config.js';
import { TAU, clamp } from '../util.js';
import { hoverTo, hoverLeave, seekTurn } from './paths.js';

const PI = Math.PI;
const HALF = Math.PI / 2;
const r3 = (v) => Math.round(v * 1000) / 1000;
const r1 = (v) => Math.round(v * 10) / 10;

const AIM_MAXY = 280;     // aimed shots only from enemies above this line
const FREE_MAXY = 320;    // non-aimed patterns
const MIN_D = 48;         // never fire when a player is this close to the muzzle

const COL = {
  p: '#ff6fb4', o: '#ffab4f', v: '#d596ff', c: '#86f4d8', gold: '#ffd966', red: '#ff5a4f', w: '#ffffff',
};

// =======================================================================================
// Host helpers (exported for stage / boss authors)
// =======================================================================================

// Co-op density scaling for bullet counts fired from brains
export function dens(sim, n) { return Math.max(1, Math.round(n * ((sim.diff && sim.diff.density) || 1))); }

// Is it fair to fire from (e + from) right now? On screen, above maxY, no player within minD.
export function canFire(e, sim, maxY = FREE_MAXY, minD = MIN_D, fx = 0, fy = 0) {
  if (sim.state !== 'play' || !e.alive || e.dying) return false;
  const x = e.x + fx, y = e.y + fy;
  if (x < 8 || x > FIELD_W - 8 || y < 6 || y > maxY) return false;
  const m2 = minD * minD;
  for (const p of sim.players) {
    if (!p || !p.alive || p.down || p.respawnT > 0) continue;
    const dx = p.x - x, dy = p.y - y;
    if (dx * dx + dy * dy < m2) return false;
  }
  return true;
}

// Fire `pat` from e aimed at a player: sets args.a (+ args.target = slot) unless args.a is given.
export function fireAt(e, sim, pat, args, from, mode) {
  const fx = from ? from[0] : 0, fy = from ? from[1] : 0;
  const tg = sim.targetPlayer(e, mode);
  const a = tg ? Math.atan2(tg.y - (e.y + fy), tg.x - (e.x + fx)) : HALF;
  sim.fire(e, pat, Object.assign({ a: r3(a), target: tg ? tg.slot : 0 }, args), from);
}

// Tick-exact gun schedule (see header). Call from a brain; returns nothing.
export function runGuns(e, sim) {
  const guns = e.def.guns;
  if (!guns) return;
  const st = e.data.gn || (e.data.gn = []);
  for (let i = 0; i < guns.length; i++) {
    const g = guns[i];
    if (g.ph !== undefined && e.phase !== g.ph) continue;
    const lt = sim.tick - (g.ph !== undefined ? e.phaseT0 : e.t0);
    const at = Math.round((g.at ?? 1) * 60), ev = Math.round((g.every || 0) * 60);
    if (lt < at || (ev ? (lt - at) % ev !== 0 : lt !== at)) continue;
    if (g.times && (st[i] || 0) >= g.times) continue;
    st[i] = (st[i] || 0) + 1; // counts attempts, so the telegraph clock stays in sync with shots
    const fx = g.from ? g.from[0] : 0, fy = g.from ? g.from[1] : 0;
    const aimed = g.aim !== false;
    if (!canFire(e, sim, g.maxY ?? (aimed ? AIM_MAXY : FREE_MAXY), g.minD ?? MIN_D, fx, fy)) continue;
    const A = Object.assign({}, g.args);
    if (aimed) {
      const tg = sim.targetPlayer(e, g.aim === 'rand' ? 'rand' : 'near');
      let a = tg ? Math.atan2(tg.y - (e.y + fy), tg.x - (e.x + fx)) : HALF;
      if (g.jitter) a += (sim.rng.next() - 0.5) * g.jitter;
      A.a = r3(a);
      A.target = tg ? tg.slot : 0;
    }
    if (g.rot) A.a0 = r3((A.a0 || 0) + sim.rng.next() * g.rot);
    if (g.dens !== false && A.n > 1) A.n = dens(sim, A.n);
    sim.fire(e, g.pat, A, g.from);
  }
}
function gunsBrain(e, sim) { runGuns(e, sim); }

// ALL PEERS (cosmetic): [ticks until gun gi fires next, ticks since it last fired]
export function gunClock(e, sim, gi = 0) {
  const g = e.def.guns && e.def.guns[gi];
  if (!g || (g.ph !== undefined && e.phase !== g.ph)) return [Infinity, Infinity];
  const lt = sim.tick - (g.ph !== undefined ? e.phaseT0 : e.t0);
  const at = Math.round((g.at ?? 1) * 60), ev = Math.round((g.every || 0) * 60);
  if (lt < at) return [at - lt, Infinity];
  if (!ev) return [lt === at ? 0 : Infinity, lt - at];
  const k = Math.floor((lt - at) / ev);
  if (g.times && k >= g.times) return [Infinity, lt - (at + (g.times - 1) * ev)];
  const since = (lt - at) % ev;
  if (since === 0) return [0, 0];
  const last = !g.times || k + 1 < g.times ? ev - since : Infinity;
  return [last, since];
}

// ALL PEERS (cosmetic): 0..1 "charging / just fired" amount over guns flagged tele
export function teleAmt(e, sim, lead = 26, hold = 12) {
  const guns = e.def.guns;
  if (!guns) return 0;
  let best = 0;
  for (let i = 0; i < guns.length; i++) {
    if (!guns[i].tele) continue;
    const c = gunClock(e, sim, i);
    let o = 0;
    if (c[0] <= lead) o = 1 - c[0] / lead;
    else if (c[1] <= hold) o = 1 - c[1] / hold;
    if (o > best) best = o;
  }
  return best;
}

function nearestPlayerDist(sim, x, y) {
  let bd = Infinity;
  for (const p of sim.players) {
    if (!p || !p.alive || p.down || p.respawnT > 0) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bd) bd = d;
  }
  return bd;
}

// =======================================================================================
// Cosmetic draw helpers (all peers; never affect the simulation)
// =======================================================================================

function glow(env, lctx, x, y, r, color, a) {
  if (env.glow && a > 0.02) env.glow(lctx, x, y, r, color, Math.min(1, a));
}

function dotLine(ctx, x, y, a, len, gap, off, color, alpha) {
  const c = Math.cos(a), s = Math.sin(a);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (let d = off; d < len; d += gap) ctx.fillRect(Math.round(x + c * d), Math.round(y + s * d), 1, 1);
  ctx.globalAlpha = 1;
}

function dotRing(ctx, x, y, r, n, rot, color, alpha) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const a = rot + (TAU * i) / n;
    ctx.fillRect(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r), 1, 1);
  }
  ctx.globalAlpha = 1;
}

// Throttled per-enemy trail puffs (local cosmetic state on the enemy object)
function puff(e, sim, pal, every, dx = 0, dy = 0) {
  if (sim.tick - (e._pf || -99) < every) return;
  e._pf = sim.tick;
  sim.env.fx.trail?.(e.x + dx, e.y + dy, pal, 1);
}

const both = (...fns) => (e, ctx, lctx, sim, env) => { for (const f of fns) if (f) f(e, ctx, lctx, sim, env); };

// pulsing aura that marks elite variants (they reuse the base sprite)
function aura(color, extra = 5) {
  return (e, ctx, lctx, sim, env) => {
    const k = 0.5 + 0.5 * Math.sin(sim.tick * 0.12 + e.id);
    glow(env, lctx, e.x, e.y, e.r + extra + k * 3, color, 0.28 + 0.2 * k);
  };
}

// core glow that swells before tele guns fire
function charge(color, dy = 0, base = 4, grow = 9) {
  return (e, ctx, lctx, sim, env) => {
    const o = teleAmt(e, sim);
    if (o > 0.02) glow(env, lctx, e.x, e.y + dy, base + grow * o, color, 0.25 + 0.75 * o);
  };
}

// extra death spectacle for big enemies (on top of the engine's explosion)
function bigDeath(pal, ring = 44, debris = 6) {
  return (e, sim) => {
    const fx = sim.env.fx;
    fx.shockwave?.(e.x, e.y, ring, pal);
    fx.debris?.(e.x, e.y, debris, pal);
  };
}

// =======================================================================================
// Roster
// =======================================================================================

const R = {};

// ---------------------------------------------------------------- MITE — swarm fodder
// Tiny wing-flicker drones in long weaving lines. No bullets; formation bonuses carry the loot.
R.mite = {
  spr: 'en_mite', hp: 2, r: 4.5, score: 60, move: 'sine', fps: 12,
  drops: {}, explode: 'small', palette: 'magenta', odGain: 0.01,
};
// later sectors: each mite spits one slow pellet
R.mite_shot = Object.assign({}, R.mite, {
  hp: 3, score: 90,
  guns: [{ at: 0.9, every: 2.8, times: 2, pat: 'shot', args: { v: 1.2, spr: 'eb_small_p' }, maxY: 230, jitter: 0.12 }],
  drawOver: aura(COL.o, 3),
});

// ---------------------------------------------------------------- DART — arcing fighter
// Swoops across on a curve and fires aimed needle pairs (fast, sparse).
R.dart = {
  spr: 'en_dart', hp: 5, r: 6, score: 150, move: 'swoop', rot: true,
  guns: [{ at: 0.8, every: 1.5, times: 2, pat: 'lines', args: { ways: 1, per: 2, v: 2.0, dv: 0.45, spr: 'eb_needle_p' }, maxY: 250 }],
  drops: { gem: 1 }, explode: 'small', palette: 'magenta',
  drawOver: (e, ctx, lctx, sim) => puff(e, sim, 'magenta', 5, -Math.cos(e.face ?? e.heading) * 6, -Math.sin(e.face ?? e.heading) * 6),
};
R.dart_elite = Object.assign({}, R.dart, {
  hp: 8, score: 280,
  guns: [{ at: 0.7, every: 1.3, times: 2, pat: 'lines', args: { ways: 3, spread: 0.42, per: 2, v: 1.9, dv: 0.4, spr: 'eb_needle_p' }, maxY: 250 }],
  drops: { gem: 2 },
  drawOver: both(R.dart.drawOver, aura(COL.o, 3)),
});

// ---------------------------------------------------------------- WISP — weaving gem carrier
R.wisp = {
  spr: 'en_wisp', hp: 4, r: 5.5, score: 300, move: 'sine', fps: 10,
  drops: { gem: 2, gemL: 1, od: 0.04 }, explode: 'small', palette: 'plasma', odGain: 0.02,
  drawOver: (e, ctx, lctx, sim, env) => glow(env, lctx, e.x, e.y, 9 + 2 * Math.sin(sim.tick * 0.15 + e.id), COL.v, 0.45),
};
R.wisp_ring = Object.assign({}, R.wisp, {
  hp: 6, score: 380,
  guns: [{ at: 1.0, every: 2.4, aim: false, rot: TAU, pat: 'ring', args: { n: 10, v: 0.85, spr: 'eb_small_v' }, maxY: 260, tele: 1 }],
  drawOver: both(R.wisp.drawOver, charge(COL.v, 0, 3, 7)),
});

// ---------------------------------------------------------------- LANCET — telegraphed dive
// Enters to a hold point, locks onto a player (sprite turns + dotted warning line for
// `pause` s), then dashes along that line. Host picks the target; dx/dy go out via setParams.
function lancetBrain(e, sim) {
  const p = e.p;
  const lt = sim.tick - e.t0;
  const tin = Math.round((p.tin ?? 1) * 60), pause = Math.round((p.pause ?? 0.6) * 60);
  if (lt === tin) {
    const tx = p.tx ?? p.x ?? FIELD_W / 2, ty = p.ty ?? 80;
    const tg = sim.targetPlayer(e);
    let a = tg ? Math.atan2(tg.y - ty, tg.x - tx) : HALF;
    a = clamp(a, 0.42, PI - 0.42);                 // always a downward dive
    sim.setParams(e, { dx: r1(tx + Math.cos(a) * 400), dy: r1(ty + Math.sin(a) * 400) });
    sim.setPhase(e, 1);
  } else if (lt === tin + pause) {
    sim.setPhase(e, 2);
    const d = e.def.dash;
    if (d && canFire(e, sim, 220, 70)) fireAt(e, sim, d.pat, Object.assign({}, d.args, d.args.n ? { n: dens(sim, d.args.n) } : null));
  }
}
function lancetPhase(e, ph, sim) {
  if (ph === 1) sim.env.sfx('enemy_laser_charge', { x: e.x, vol: 0.3, pitch: 9 });
  else if (ph === 2) {
    sim.env.sfx('enemy_shot_heavy', { x: e.x, vol: 0.45 });
    sim.env.fx.spark?.(e.x, e.y, (e.face ?? HALF) + PI, 'magenta', 4);
  }
}
function lancetDraw(e, ctx, lctx, sim, env) {
  const a = e.face ?? HALF;
  if (e.phase === 1) {
    const k = clamp((sim.tick - e.phaseT0) / Math.max(1, (e.p.pause ?? 0.6) * 60), 0, 1);
    const off = 12 + ((sim.tick >> 1) % 6);
    dotLine(lctx, e.x, e.y, a, 40 + 130 * k, 6, off, COL.p, 0.35 + 0.5 * k);
    dotLine(ctx, e.x, e.y, a, 40 + 130 * k, 6, off, COL.p, 0.5);
    glow(env, lctx, e.x + Math.cos(a) * 9, e.y + Math.sin(a) * 9, 3 + 6 * k, COL.p, 0.5 + 0.5 * k);
  } else if (e.phase === 2) {
    puff(e, sim, 'magenta', 2, -Math.cos(a) * 9, -Math.sin(a) * 9);
    glow(env, lctx, e.x - Math.cos(a) * 8, e.y - Math.sin(a) * 8, 7, COL.p, 0.7);
  }
}
R.lancet = {
  spr: 'en_lancet', hp: 9, r: 7, score: 250, move: 'dive', rot: true,
  brain: lancetBrain, onPhase: lancetPhase, drawOver: lancetDraw,
  drops: { gem: 1 }, explode: 'small', palette: 'magenta',
};
R.lancet_elite = Object.assign({}, R.lancet, {
  hp: 14, score: 420,
  dash: { pat: 'aimRing', args: { n: 10, v: 0.95, offset: 0.5, spr: 'eb_small_p' } },
  drops: { gem: 2 },
  drawOver: both(lancetDraw, aura(COL.o, 4)),
});

// ---------------------------------------------------------------- EYE — floating turret
// Sleeps half-lidded; the eye opens (frames 2→0) and its core swells ~0.4 s before each volley.
function eyeFrame(e, t, sim) {
  const c0 = e.def.guns ? teleAmt(e, sim, 26, 0) : 0;
  let best = Infinity;
  for (let i = 0; i < e.def.guns.length; i++) { const s = gunClock(e, sim, i)[1]; if (s < best) best = s; }
  if (best >= 6 && best < 14 && c0 < 0.05) return 3;            // blink shut right after a volley
  return c0 > 0.66 || best < 6 ? 0 : c0 > 0.2 ? 1 : 2;
}
const eyeGuns = (g) => g.map((x) => Object.assign({ tele: 1 }, x));
R.eye = {
  spr: 'en_eye', hp: 28, r: 8, score: 500, move: 'hold',
  pdef: { ey: -60 },
  guns: eyeGuns([{ at: 1.4, every: 2.0, pat: 'fan', args: { n: 5, spread: 0.8, v: 1.25, spr: 'eb_orb_p' } }]),
  frame: eyeFrame, drawOver: charge(COL.p, 0, 4, 9),
  drops: { gem: 3, power: 0.15 }, explode: 'medium', palette: 'magenta',
};
R.eye_ring = Object.assign({}, R.eye, {
  hp: 32, score: 600,
  guns: eyeGuns([
    { at: 1.3, every: 2.4, aim: false, rot: TAU, pat: 'ring', args: { n: 16, v: 0.95, spr: 'eb_orb_v' } },
    { at: 2.5, every: 2.4, pat: 'aimRing', args: { n: 12, v: 1.3, offset: 0.5, spr: 'eb_small_p' } },
  ]),
  drawOver: charge(COL.v, 0, 4, 10),
  drops: { gem: 3, power: 0.18 },
});
R.eye_elite = Object.assign({}, R.eye, {
  hp: 40, score: 850,
  guns: eyeGuns([
    { at: 1.2, every: 2.2, pat: 'lines', args: { ways: 5, spread: 0.9, per: 3, v: 1.45, dv: 0.25, spr: 'eb_needle_p' } },
    { at: 2.3, every: 4.4, aim: false, rot: TAU, pat: 'accelRing', args: { n: 20, v0: 0.2, acc: 0.03, vmax: 1.7, spr: 'eb_orb_v' } },
  ]),
  drawOver: both(charge(COL.p, 0, 4, 10), aura(COL.o, 5)),
  drops: { gem: 4, power: 0.22 },
});

// ---------------------------------------------------------------- CARAPACE — armored gunship
R.carapace = {
  spr: 'en_carapace', hp: 70, r: 11, score: 1200, move: 'hold', fps: 4,
  pdef: { tin: 1.6, hold: 7, sway: 18, swayF: 0.12, ey: -70 },
  guns: [
    { at: 1.4, every: 2.8, pat: 'shotgun', args: { n: 5, spread: 0.75, v: 1.1, dv: 0.3, layers: 3, spr: 'eb_small_o' }, from: [0, 8], maxY: 250, tele: 1 },
    { at: 2.8, every: 2.8, aim: false, rot: 0.6, pat: 'ring', args: { n: 16, v: 0.9, spr: 'eb_orb_v' }, tele: 1 },
  ],
  drawOver: charge(COL.o, 3, 5, 10),
  drops: { gem: 4, gemL: 1, power: 0.4, bomb: 0.06 }, explode: 'large', palette: 'fire', odGain: 0.05,
  onDeath: bigDeath('fire', 44, 8),
};
R.carapace_elite = Object.assign({}, R.carapace, {
  hp: 100, score: 1800,
  guns: [
    { at: 1.3, every: 3.0, pat: 'shotgun', args: { n: 6, spread: 0.8, v: 1.1, dv: 0.28, layers: 4, spr: 'eb_small_o' }, from: [0, 8], maxY: 250, tele: 1 },
    { at: 2.3, every: 3.0, pat: 'burstChain', args: { v: 1.5, n1: 6, n2: 3, v2: 1.7 }, maxY: 230, tele: 1 },
    { at: 3.1, every: 3.0, aim: false, rot: 0.6, pat: 'layered', args: { n: 14, layers: 2, v: 0.85, dv: 0.25, twist: 0.22, spr: 'eb_orb_v' } },
  ],
  drawOver: both(charge(COL.o, 3, 5, 11), aura(COL.red, 6)),
  drops: { gem: 5, gemL: 2, power: 0.5, bomb: 0.08 },
});

// ---------------------------------------------------------------- WEAVER — curtain bomber
// Strafes across at a height ('strafe' path) and hangs a net of orbs behind it with 1-2 wide
// gaps (host-chosen); when the pass is done the whole net drops as one wall. Also snaps an
// aimed needle fan while high up.
function weaverBrain(e, sim) {
  runGuns(e, sim);
  if (e.data.laid || sim.state !== 'play') return;
  if (e.x < 14 || e.x > FIELD_W - 14 || e.y < 8 || e.y > 230) return;
  e.data.laid = 1;
  const L = e.def.lay;
  const speed = Math.abs(e.p.v ?? 60);
  const stepPx = Math.max(2, (speed * L.every) / 60);
  const count = Math.ceil((FIELD_W - 16) / stepPx);
  const glen = Math.max(3, Math.round(L.gapPx / stepPx));
  const gaps = [];
  const G = L.gaps;
  for (let g = 0; g < G; g++) {
    const lo = Math.floor((count * g) / G) + 2, hi = Math.floor((count * (g + 1)) / G) - glen - 2;
    gaps.push(lo + Math.floor(sim.rng.next() * Math.max(1, hi - lo)), glen);
  }
  sim.fire(e, 'trail', { count, every: L.every, v: L.v, acc: L.acc, vmax: L.vmax, spr: L.spr, gaps, twin: L.twin || 0, sync: 1, hold: L.hold ?? 24, follow: 1, oy: 5 }, [0, 5]);
}
R.weaver = {
  spr: 'en_weaver', hp: 45, r: 10, score: 900, move: 'strafe', fps: 6,
  lay: { every: 5, v: 0.5, acc: 0.012, vmax: 1.35, spr: 'eb_orb_o', gaps: 2, gapPx: 44, twin: 0 },
  guns: [{ at: 1.0, every: 2.6, pat: 'fan', args: { n: 3, spread: 0.4, v: 1.9, spr: 'eb_needle_o' }, maxY: 200 }],
  brain: weaverBrain,
  drawOver: (e, ctx, lctx, sim, env) => {
    glow(env, lctx, e.x, e.y + 5, 5, COL.o, 0.5 + 0.3 * Math.sin(sim.tick * 0.4));
    puff(e, sim, 'ember', 4, (e.p.side || -1) * 9, 0);
  },
  drops: { gem: 3, power: 0.25 }, explode: 'medium', palette: 'fire', odGain: 0.04,
};
R.weaver_elite = Object.assign({}, R.weaver, {
  hp: 65, score: 1300,
  lay: { every: 5, v: 0.55, acc: 0.014, vmax: 1.45, spr: 'eb_orb_o', gaps: 2, gapPx: 40, twin: 9 },
  guns: [
    { at: 0.9, every: 2.2, pat: 'lines', args: { ways: 3, spread: 0.5, per: 2, v: 1.8, dv: 0.35, spr: 'eb_needle_o' }, maxY: 200 },
  ],
  drawOver: both(R.weaver.drawOver, aura(COL.red, 6)),
  drops: { gem: 4, power: 0.3 },
});

// ---------------------------------------------------------------- MINE — drifting burst mine
// Drifts slowly; killed → delayed "revenge" ring (flickers harmlessly for 14 ticks first).
// Left alone on screen it arms (fast blink + contracting warning ring) and detonates.
function mineBrain(e, sim) {
  const lt = sim.tick - e.t0;
  const fuse = Math.round((e.p.fuse ?? e.def.fuse) * 60);
  if (e.phase === 0) {
    if (lt >= fuse && canFire(e, sim, 300, 56)) sim.setPhase(e, 1);
  } else if (sim.tick - e.phaseT0 >= 42) {
    const b = e.def.boom;
    sim.cue('boom', null, e);
    sim.fire(e, b.pat, Object.assign({}, b.args, { n: dens(sim, b.args.n), a0: r3(sim.rng.next() * TAU) }));
    sim.kill(e, -1, true);
  }
}
function mineDraw(e, ctx, lctx, sim, env) {
  if (e.phase === 1) {
    const k = clamp((sim.tick - e.phaseT0) / 42, 0, 1);
    const r = 30 - 20 * k;
    dotRing(lctx, e.x, e.y, r, 20, sim.tick * 0.05, COL.o, 0.4 + 0.5 * k);
    glow(env, lctx, e.x, e.y, 5 + 7 * k, COL.o, 0.5 + 0.5 * k);
  } else {
    glow(env, lctx, e.x, e.y, 4, COL.o, ((sim.tick >> 4) & 1) ? 0.55 : 0.2);
  }
}
R.mine = {
  spr: 'en_mine', hp: 8, r: 5.5, score: 120, move: 'drift',
  fuse: 5.5,
  boom: { pat: 'ring', args: { n: 12, v: 1.0, spr: 'eb_small_o' } },
  deathFire: { pat: 'ring', args: { n: 10, v: 0.85, delay: 14, spr: 'eb_small_o' } },
  brain: mineBrain,
  cues: {
    boom(e, sim) {
      sim.env.fx.explode(e.x, e.y, 'small', { palette: 'ember' });
      sim.env.fx.shockwave?.(e.x, e.y, 28, 'ember');
      sim.sfxAt('explode_small', e.x, 0.8);
    },
  },
  frame: (e, t) => (e.phase === 1 ? Math.floor(t * 14) & 1 : Math.floor(t * 2) & 1),
  drawOver: mineDraw,
  drops: { gem: 1 }, explode: 'small', palette: 'ember', odGain: 0.015,
};
R.mine_elite = Object.assign({}, R.mine, {
  hp: 14, score: 200, fuse: 4.5,
  boom: { pat: 'layered', args: { n: 12, layers: 2, v: 0.85, dv: 0.3, twist: 0.26, spr: 'eb_small_o' } },
  deathFire: [
    { pat: 'ring', args: { n: 12, v: 0.8, delay: 14, spr: 'eb_small_o' } },
    { pat: 'ring', args: { n: 12, v: 1.15, delay: 14, a0: 0.26, spr: 'eb_orb_o' } },
  ],
  drawOver: both(mineDraw, aura(COL.red, 3)),
  drops: { gem: 1, power: 0.05 },
});

// ---------------------------------------------------------------- HORNET — stop & spin
// Enters, stops, spins a 3-arm spiral (sprite spins fast while firing), then leaves.
function hornetFrame(e, t) {
  const g = e.def.guns[0];
  const on = t >= g.at && t < g.at + (g.args.count * g.args.every) / 60;
  return Math.floor(t * (on ? 18 : 5));
}
R.hornet = {
  spr: 'en_hornet', hp: 40, r: 8, score: 900, move: 'hold',
  pdef: { tin: 1.2, hold: 4.2, tout: 2, ey: -60 },
  guns: [
    { at: 1.5, times: 1, aim: false, rot: TAU, pat: 'spiral', args: { arms: 3, v: 1.0, every: 6, count: 36, da: 0.21, spr: 'eb_small_v', follow: 1 } },
    { at: 3.4, times: 1, pat: 'fan', args: { n: 3, spread: 0.35, v: 1.9, spr: 'eb_needle_p' }, maxY: 240, tele: 1 },
  ],
  frame: hornetFrame,
  drawOver: (e, ctx, lctx, sim, env) => {
    const t = (sim.tick - e.t0) / 60, g = e.def.guns[0];
    const on = t >= g.at - 0.3 && t < g.at + (g.args.count * g.args.every) / 60;
    glow(env, lctx, e.x, e.y, on ? 9 + Math.sin(sim.tick * 0.5) * 2 : 5, COL.v, on ? 0.8 : 0.35);
  },
  drops: { gem: 3, power: 0.3, od: 0.06 }, explode: 'medium', palette: 'fire', odGain: 0.04,
};
R.hornet_elite = Object.assign({}, R.hornet, {
  hp: 60, score: 1300,
  guns: [
    { at: 1.5, times: 1, aim: false, rot: TAU, pat: 'crossSpiral', args: { arms: 3, v: 1.0, every: 6, count: 38, da: 0.17, spr: 'eb_small_v', spr2: 'eb_small_p', follow: 1 } },
    { at: 2.6, every: 1.4, times: 2, pat: 'lines', args: { ways: 3, spread: 0.45, per: 2, v: 1.8, dv: 0.35, spr: 'eb_needle_p' }, maxY: 240, tele: 1 },
  ],
  drawOver: both(R.hornet.drawOver, aura(COL.o, 6)),
  drops: { gem: 4, power: 0.35, od: 0.08 },
});

// ---------------------------------------------------------------- SEEKER — homing kamikaze
// Flies on closed-form arcs; every 0.5 s the host re-steers it toward a player (turn ≤ ~1 rad).
// It commits (stops steering) when close, low on screen or after `life` s — always dodgeable.
function seekerBrain(e, sim) {
  const lt = sim.tick - e.t0;
  const first = Math.round((e.p.t1 ?? 0.35) * 60);
  if (lt < first || (lt - first) % 30 !== 0) return;
  if (lt > (e.p.life ?? 4) * 60 || e.y > 300 || e.y < -30) return;
  const tg = sim.targetPlayer(e);
  if (!tg) return;
  if (Math.hypot(tg.x - e.x, tg.y - e.y) < 64) return;
  seekTurn(sim, e, tg.x, tg.y, e.p.turn ?? 1.0, 0.3);
}
R.seeker = {
  spr: 'en_seeker', hp: 3, r: 4, score: 80, move: 'seek', fps: 10, maxLife: 14,
  pdef: { v: 105 },
  brain: seekerBrain,
  drawOver: (e, ctx, lctx, sim, env) => {
    const a = e.face ?? e.heading;
    puff(e, sim, 'magenta', 3, -Math.cos(a) * 4, -Math.sin(a) * 4);
    glow(env, lctx, e.x, e.y, 5, COL.p, 0.55);
  },
  drops: {}, explode: 'small', palette: 'magenta', odGain: 0.01,
};

// ---------------------------------------------------------------- SHARD — crystal (Veil)
// Materialises (warp), fires needles that refract into pairs mid-flight, and short aimed beams.
R.shard = {
  spr: 'en_shard', hp: 22, r: 6, score: 450, move: 'hold', fps: 4, warp: true,
  pdef: { tin: 1.0, hold: 6, sway: 10, swayF: 0.2, ey: -60 },
  guns: [
    { at: 1.0, every: 2.4, pat: 'refract', args: { n: 3, spread: 0.5, v: 1.9, t: 34, split: 2, sp: 0.7, v2: 1.35, spr: 'eb_needle_c' }, maxY: 250, tele: 1 },
    { at: 2.2, every: 4.8, pat: 'beam', args: { w: 5, warn: 40, dur: 24, len: 120, pal: 'crystal', follow: 1 }, maxY: 220 },
  ],
  drawOver: charge(COL.c, -2, 3, 8),
  onDeath: (e, sim) => { sim.env.fx.debris?.(e.x, e.y, 6, 'crystal'); },
  drops: { gem: 2, power: 0.1 }, explode: 'small', palette: 'crystal', odGain: 0.02,
};
R.shard_elite = Object.assign({}, R.shard, {
  hp: 32, score: 700,
  guns: [
    { at: 1.0, every: 2.2, pat: 'refract', args: { n: 3, spread: 0.6, v: 1.9, t: 30, split: 3, sp: 0.9, v2: 1.3, spr: 'eb_needle_c' }, maxY: 250, tele: 1 },
    { at: 2.0, every: 4.4, pat: 'laserFan', args: { n: 3, spread: 0.7, w: 5, warn: 44, dur: 26, len: 140, pal: 'crystal', follow: 1 }, maxY: 210 },
  ],
  drawOver: both(charge(COL.c, -2, 3, 9), aura(COL.w, 5)),
  drops: { gem: 3, power: 0.14 },
});

// ---------------------------------------------------------------- PHANTOM — phase ghost (Veil)
// phase 0 = arriving (visible, holds fire), 1 = solid (vulnerable, fires `volleys`),
// 2 = phased out (armor on every peer, translucent, relocates). After `cycles` it flees.
function phantomBrain(e, sim, t) {
  const d = e.def;
  const pt = sim.tick - e.phaseT0;
  if (e.phase === 0) {
    if (t >= (e.p.tin ?? 1.2)) sim.setPhase(e, 1);
    return;
  }
  if (e.phase === 1) {
    for (const v of d.volleys) {
      if (pt !== v.at) continue;
      const aimed = v.aim !== false;
      if (!canFire(e, sim, aimed ? AIM_MAXY : FREE_MAXY, v.minD ?? MIN_D)) continue;
      const A = Object.assign({}, v.args);
      if (A.n > 1) A.n = dens(sim, A.n);
      if (!aimed) { A.a0 = r3(sim.rng.next() * TAU); sim.fire(e, v.pat, A); } else fireAt(e, sim, v.pat, A);
    }
    if (pt >= d.solidT) {
      e.data.cyc = (e.data.cyc || 0) + 1;
      sim.setPhase(e, 2);
    }
    return;
  }
  // phased out
  if (pt === 4) {
    if (e.data.cyc >= (e.p.cycles ?? d.cycles)) hoverLeave(sim, e, e.x, -60, 1.6);
    else {
      const nx = clamp(e.x + (sim.rng.next() - 0.5) * 150, 28, FIELD_W - 28);
      const ny = 50 + sim.rng.next() * 90;
      hoverTo(sim, e, nx, ny, 1.1);
    }
  }
  if (pt === d.ghostT && e.data.cyc < (e.p.cycles ?? d.cycles)) sim.setPhase(e, 1);
}
function phantomPhase(e, ph, sim) {
  const prev = e._ph ?? 0;
  e._ph = ph;
  e._from = prev;
  e.armor = ph === 2;
  if (ph === 2 || (ph === 1 && prev === 2)) {
    sim.env.fx.warp?.(e.x, e.y, 'plasma');
    sim.env.sfx('warp_in', { x: e.x, vol: 0.35, pitch: ph === 2 ? -4 : 3 });
  }
}
function phantomAlpha(e, sim) {
  const k = clamp((sim.tick - e.phaseT0) / 18, 0, 1);
  if (e.phase === 2) return 1 - 0.86 * k;
  if (e.phase === 1 && e._from === 2) return 0.14 + 0.86 * k;
  return 1;
}
function phantomDraw(e, ctx, lctx, sim, env) {
  const S = env.sprites;
  const t = (sim.tick - e.t0) / 60;
  const fr = Math.floor(t * 8);
  const al = phantomAlpha(e, sim);
  if (e.phase === 2) {
    // ghost shimmer: offset emissive echoes
    const o2 = S.optNone(); o2.alpha = al * 0.6;
    const j = ((sim.tick >> 2) & 1) ? 1 : -1;
    S.drawE(lctx, e.def.spr, fr, e.x + j, e.y, o2);
  }
  const o = S.optNone(); o.alpha = al;
  S.draw(ctx, e.def.spr, fr, e.x, e.y, o);
  if (e.flash > 0 && e.phase !== 2) sim.drawFlash(ctx, e.def.spr, fr, e.x, e.y, o, 0.8);
  const oe = S.optNone(); oe.alpha = al;
  S.drawE(lctx, e.def.spr, fr, e.x, e.y, oe);
  glow(env, lctx, e.x, e.y, 10, COL.v, 0.3 * al);
  if (e.def.eliteCol) glow(env, lctx, e.x, e.y, e.r + 7, e.def.eliteCol, 0.3 * al);
}
R.phantom = {
  spr: 'en_phantom', hp: 26, r: 8, score: 600, move: 'hover', palette: 'plasma',
  pdef: { tin: 1.2, sway: 16, swayF: 0.2, bob: 4 },
  solidT: 150, ghostT: 84, cycles: 3,
  volleys: [
    { at: 30, pat: 'aimRing', args: { n: 12, v: 1.1, offset: 0.5, spr: 'eb_orb_p' } },
    { at: 96, pat: 'lines', args: { ways: 3, spread: 0.5, per: 3, v: 1.5, dv: 0.25, spr: 'eb_needle_p' } },
  ],
  brain: phantomBrain, onPhase: phantomPhase, draw: phantomDraw,
  drops: { gem: 3, power: 0.15 }, explode: 'medium', odGain: 0.03,
};
R.phantom_elite = Object.assign({}, R.phantom, {
  hp: 38, score: 900, eliteCol: COL.c, cycles: 4,
  volleys: [
    { at: 24, aim: false, minD: 100, pat: 'implode', args: { n: 14, r: 46, v: 0.9, delay: 30, spr: 'eb_small_v' } },
    { at: 70, pat: 'stopAim', args: { n: 10, v: 1.5, stopT: 28, hold: 22, v2: 2.0 } },
    { at: 126, pat: 'lines', args: { ways: 3, spread: 0.55, per: 3, v: 1.5, dv: 0.25, spr: 'eb_needle_p' } },
  ],
  solidT: 170,
  drops: { gem: 4, power: 0.2 },
});

// ---------------------------------------------------------------- TURRET — hull gun (Wreck)
// Rides the scrolling hull ('ground' path: pass p.sy0 = sim.scrollY at spawn). The barrel
// overlay tracks the nearest player locally (cosmetic); the muzzle glows before each burst.
function turretDraw(e, ctx, lctx, sim, env) {
  const S = env.sprites;
  const pl = sim.nearestPlayer(e.x, e.y);
  const a = pl ? Math.atan2(pl.y - e.y, pl.x - e.x) : HALF;
  const opt = S.optDir('en_turret_gun', a);
  S.draw(ctx, 'en_turret_gun', 0, e.x, e.y, opt);
  S.drawE(lctx, 'en_turret_gun', 0, e.x, e.y, opt);
  const o = teleAmt(e, sim, 30, 8);
  if (o > 0.02) glow(env, lctx, e.x + Math.cos(a) * 7, e.y + Math.sin(a) * 7, 3 + 6 * o, e.def.muzzle || COL.o, 0.3 + 0.7 * o);
}
R.turret = {
  spr: 'en_turret', hp: 36, r: 8, score: 700, move: 'ground', ground: true, fps: 1,
  guns: [{ at: 0.9, every: 1.9, pat: 'lines', args: { ways: 1, per: 3, v: 1.9, dv: 0.3, spr: 'eb_needle_o' }, maxY: 270, tele: 1 }],
  drawOver: turretDraw,
  onDeath: bigDeath('fire', 30, 5),
  drops: { gem: 2, power: 0.12 }, explode: 'medium', palette: 'fire', odGain: 0.03,
};
R.turret_heavy = Object.assign({}, R.turret, {
  hp: 60, score: 1100, muzzle: COL.red,
  guns: [
    { at: 0.9, every: 2.6, pat: 'shotgun', args: { n: 5, spread: 0.6, v: 1.2, dv: 0.3, layers: 2, spr: 'eb_small_o' }, maxY: 260, tele: 1 },
    { at: 2.2, every: 2.6, aim: false, rot: 0.5, pat: 'ring', args: { n: 12, v: 0.9, spr: 'eb_orb_o' }, maxY: 300 },
  ],
  drops: { gem: 3, power: 0.2 },
});
R.turret_flak = Object.assign({}, R.turret, {
  hp: 45, score: 850, muzzle: COL.gold,
  guns: [
    { at: 1.0, every: 2.4, pat: 'cluster', args: { n: 1, v: 1.7, t: 44, ringN: 10, ringV: 1.1, spr: 'eb_big_o', ringSpr: 'eb_small_o' }, maxY: 250, tele: 1 },
    { at: 2.2, every: 2.4, aim: false, pat: 'fountain', args: { n: 6, a: -HALF, spread: 1.2, v: 1.6, vj: 0.5, grav: 0.03, spr: 'eb_small_o' }, maxY: 300 },
  ],
  drops: { gem: 2, power: 0.15 },
});

// ---------------------------------------------------------------- ROCKS — asteroids (Cinder)
// No bullets. Large rocks split into medium, medium into small (host spawns children).
function rockSplit(e, sim) {
  const s = e.def.split;
  if (!s) return;
  // A rock shot while it is sliding off a side/bottom edge would spawn fragments outside the
  // field that never "enter" it (so the engine only reaps them at maxLife): let it crumble.
  if (e.x < 2 || e.x > FIELD_W - 2 || e.y > FIELD_H - 8) return;
  const rng = sim.rng;
  const vx = e.p.vx || 0, vy = e.p.vy ?? 32;
  for (let i = 0; i < s.n; i++) {
    const k = s.n === 1 ? 0 : (i / (s.n - 1)) * 2 - 1;
    sim.spawn(s.type, {
      path: 'drift', x: r1(clamp(e.x + k * 6, 3, FIELD_W - 3)), y: r1(e.y), vx: r1(vx * 0.6 + k * s.spread + (rng.next() - 0.5) * 10),
      vy: r1(Math.max(16, vy * 0.9 + rng.next() * 16 - 4)), wob: 2, wobF: r3(0.3 + rng.next() * 0.3), ph: r3(rng.next() * 6), v: rng.int(0, 3),
    });
  }
}
const rockFrame = (e) => (e.p.v ?? e.id) & 3;
R.rock_l = {
  spr: 'en_rock_l', hp: 70, r: 13, score: 400, move: 'drift', frame: rockFrame, ignoreClear: true,
  split: { type: 'rock_m', n: 2, spread: 34 }, onKill: rockSplit,
  onDeath: bigDeath('ember', 36, 8),
  drops: { gem: 2, power: 0.1 }, explode: 'large', palette: 'ember', odGain: 0.03,
};
R.rock_m = {
  spr: 'en_rock_m', hp: 22, r: 8, score: 150, move: 'drift', frame: rockFrame, ignoreClear: true,
  split: { type: 'rock_s', n: 2, spread: 40 }, onKill: rockSplit,
  onDeath: (e, sim) => sim.env.fx.debris?.(e.x, e.y, 4, 'ember'),
  drops: { gem: 1 }, explode: 'medium', palette: 'ember', odGain: 0.015,
};
R.rock_s = {
  spr: 'en_rock_s', hp: 6, r: 5, score: 50, move: 'drift', frame: rockFrame, ignoreClear: true,
  drops: {}, explode: 'small', palette: 'ember', odGain: 0.008,
};

// ---------------------------------------------------------------- SENTINEL — halo guardian (Horizon)
// Warps in, hovers, cycles through its `attacks` every `every` ticks and relocates every
// two attacks; leaves after `life` seconds.
function sentinelBrain(e, sim, t) {
  const d = e.def, lt = sim.tick - e.t0;
  const tin = Math.round((e.p.tin ?? 1.2) * 60);
  if (e.data.gone) return;
  if (t > (e.p.life ?? d.life)) { e.data.gone = 1; hoverLeave(sim, e, e.x, -60, 2.2); return; }
  if (lt < tin + 20) return;
  const k = lt - tin - 20;
  const every = d.every;
  if (k % every !== 0) return;
  const n = k / every;
  const atk = d.attacks[n % d.attacks.length];
  for (const a of atk) {
    const aimed = a.aim !== false;
    if (!canFire(e, sim, aimed ? AIM_MAXY : FREE_MAXY, a.minD ?? 56)) continue;
    const A = Object.assign({}, a.args);
    if (A.n > 1) A.n = dens(sim, A.n);
    if (a.dir) A.dir = n & 1 ? -1 : 1;
    if (aimed) fireAt(e, sim, a.pat, A);
    else { A.a0 = r3((A.a0 || 0) + sim.rng.next() * TAU); sim.fire(e, a.pat, A); }
  }
  if (n % 2 === 1) {
    const nx = clamp(60 + sim.rng.next() * 120, 30, FIELD_W - 30);
    const ny = 60 + sim.rng.next() * 70;
    hoverTo(sim, e, nx, ny, 1.4);
  }
}
function sentinelDraw(e, ctx, lctx, sim, env) {
  const k = 0.5 + 0.5 * Math.sin(sim.tick * 0.08 + e.id);
  glow(env, lctx, e.x, e.y, 12 + 3 * k, COL.v, 0.35 + 0.2 * k);
  dotRing(lctx, e.x, e.y, 15, 12, sim.tick * 0.03, COL.v, 0.35);
  if (e.def.eliteCol) glow(env, lctx, e.x, e.y, 17, e.def.eliteCol, 0.25 + 0.15 * k);
}
R.sentinel = {
  spr: 'en_sentinel', hp: 90, r: 9, score: 1800, move: 'hover', fps: 6, warp: true,
  pdef: { tin: 1.2, sway: 12, swayF: 0.15, bob: 4 },
  every: 150, life: 18,
  attacks: [
    [{ aim: false, dir: 1, pat: 'orbitRing', args: { n: 14, r: 16, v: 1.0, k: 0.8, spinT: 70, spr: 'eb_orb_v' } }],
    [{ aim: false, pat: 'crossSpiral', args: { arms: 3, v: 1.0, every: 6, count: 24, da: 0.2, spr: 'eb_small_v', spr2: 'eb_small_p', follow: 1 } }],
    [
      { aim: false, pat: 'rings', args: { n: 16, count: 3, every: 16, rot: 0.1, v: 1.0, spr: 'eb_ring_v' } },
      { pat: 'lines', args: { ways: 3, spread: 0.5, per: 3, v: 1.5, dv: 0.25, spr: 'eb_needle_p' } },
    ],
  ],
  brain: sentinelBrain, drawOver: sentinelDraw,
  onDeath: bigDeath('plasma', 52, 8),
  drops: { gem: 5, gemL: 2, power: 0.45, od: 0.12 }, explode: 'large', palette: 'plasma', odGain: 0.06,
};
R.sentinel_elite = Object.assign({}, R.sentinel, {
  hp: 130, score: 2600, eliteCol: COL.gold, every: 160, life: 20,
  attacks: [
    [{ aim: false, pat: 'petal', args: { n: 6, per: 5, width: 0.6, v: 0.9, dv: 0.55, curl: 0.012, curlT: 50, spr: 'eb_small_v' } }],
    [{ aim: false, minD: 110, pat: 'laserFan', args: { n: 4, full: 1, w: 6, warn: 60, dur: 80, av: 0.008, avT: 80, len: 150, pal: 'plasma', follow: 1 } },
      { pat: 'lines', args: { ways: 3, spread: 0.6, per: 2, v: 1.4, dv: 0.3, spr: 'eb_needle_p' } }],
    [{ aim: false, dir: 1, pat: 'orbitRing', args: { n: 16, r: 18, v: 1.0, k: 0.75, spinT: 80, spr: 'eb_orb_v' } },
      { pat: 'stopAim', args: { n: 8, v: 1.4, stopT: 26, hold: 26, v2: 2.0 } }],
  ],
  drops: { gem: 6, gemL: 3, power: 0.6, od: 0.18, bomb: 0.08 },
});

// ---------------------------------------------------------------- BASTION — mid-boss frigate
// Three HP-driven phases (100-60-30%), each a looping attack script. Phase changes clear the
// screen with a shockwave on every peer. Retreats (quietly removed) if it survives `stay` s.
const BASTION_GUNS = { L: [-17, 4], R: [17, 4], C: [0, 11], TL: [-6, -3], TR: [6, -3] };
const THEMES = {
  choir: { orb: 'eb_orb_v', small: 'eb_small_v', needle: 'eb_needle_p', big: 'eb_big_v', pet: 'eb_small_p', beam: 'magenta', fx: 'fire', col: COL.p },
  crystal: { orb: 'eb_orb_c', small: 'eb_small_c', needle: 'eb_needle_c', big: 'eb_big_v', pet: 'eb_small_c', beam: 'crystal', fx: 'crystal', col: COL.c },
  ember: { orb: 'eb_orb_o', small: 'eb_small_o', needle: 'eb_needle_o', big: 'eb_big_o', pet: 'eb_star_o', beam: 'ember', fx: 'fire', col: COL.o },
  void: { orb: 'eb_orb_v', small: 'eb_small_v', needle: 'eb_needle_p', big: 'eb_big_p', pet: 'eb_ring_v', beam: 'plasma', fx: 'plasma', col: COL.v },
};

// Gun mounts from the sprite metadata when available (sprites.js ENEMY_META.en_bastion.guns =
// [L, R, top-L, top-R, low-L, low-R]); hardcoded fallback otherwise. Host-only (fire offsets).
function bastionGun(sim, name) {
  const m = sim.env.sprites && sim.env.sprites.emeta && sim.env.sprites.emeta.en_bastion;
  const g = m && m.guns;
  if (g && g.length >= 6) {
    if (name === 'C') return m.core || [(g[4][0] + g[5][0]) / 2, (g[4][1] + g[5][1]) / 2];
    const v = g[{ L: 0, R: 1, TL: 2, TR: 3 }[name]];
    if (v) return v;
  }
  return BASTION_GUNS[name];
}

// script steps: [tick-in-loop, fn(e, sim, L, T)]
const BASTION_SCRIPT = [
  { len: 330, steps: [
    [0, (e, sim, L, T) => { const g = bastionGun(sim, 'C'); if (canFire(e, sim, FREE_MAXY, 56, g[0], g[1])) sim.fire(e, 'rings', { n: dens(sim, 16 + 2 * L), count: 3, every: 14, v: 0.95 + 0.05 * L, rot: 0.13, a0: r3(sim.rng.next() * TAU), spr: T.orb, follow: 1, ox: g[0], oy: g[1] }, g); }],
    [70, (e, sim, L, T) => {
      for (const s of ['L', 'R']) {
        const g = bastionGun(sim, s);
        if (!canFire(e, sim, AIM_MAXY, 56, g[0], g[1])) continue;
        const tg = sim.targetPlayer(e, s === 'L' ? 'near' : 'rand');
        sim.fire(e, 'stream', { target: tg ? tg.slot : 0, count: 7 + 2 * L, every: 6, v: 2.1, n: 2, spread: 0.16, spr: T.needle, follow: 1, ox: g[0], oy: g[1] }, g);
      }
    }],
    [160, (e, sim, L, T) => { const g = bastionGun(sim, 'C'); if (canFire(e, sim, FREE_MAXY, 56, g[0], g[1])) sim.fire(e, 'petal', { n: dens(sim, 6 + L), per: 5, width: 0.5, v: 0.85, dv: 0.6, a0: r3(sim.rng.next() * TAU), spr: T.pet }, g); }],
    [235, (e, sim, L, T) => { const g = bastionGun(sim, 'C'); if (canFire(e, sim, AIM_MAXY, 56, g[0], g[1])) fireAt(e, sim, 'lines', { ways: dens(sim, 5 + (L >> 1) * 2), spread: 1.0, per: 3, v: 1.45, dv: 0.25, spr: T.needle }, g); }],
  ] },
  { len: 420, steps: [
    [20, (e, sim, L, T) => {
      // scissor beams: side guns start angled outward and sweep in to vertical (center lane stays safe)
      for (const s of [-1, 1]) {
        const g = bastionGun(sim, s < 0 ? 'L' : 'R');
        sim.fire(e, 'beam', { a: r3(HALF - s * 0.62), av: r3(s * 0.0052), avT: 118, w: 9, warn: 56, dur: 140, pal: T.beam, follow: 1, ox: g[0], oy: g[1] }, g);
      }
    }],
    [130, (e, sim, L, T) => {
      if (L < 2) return; // higher tiers harass the safe lane with telegraphed snipes
      for (const s of ['TL', 'TR']) {
        const g = bastionGun(sim, s);
        if (canFire(e, sim, AIM_MAXY, 56, g[0], g[1])) fireAt(e, sim, 'snipe', { n: 1, v: 2.4, delay: 24, spr: T.needle }, g);
      }
    }],
    [230, (e, sim, L, T) => { const g = bastionGun(sim, 'C'); if (canFire(e, sim, FREE_MAXY, 56, g[0], g[1])) sim.fire(e, 'accelRing', { n: dens(sim, 18 + 2 * L), v0: 0.2, acc: 0.028, vmax: 1.6 + 0.1 * L, a0: r3(sim.rng.next() * TAU), spr: T.orb }, g); }],
    [300, (e, sim, L, T) => { const g = bastionGun(sim, 'C'); if (canFire(e, sim, AIM_MAXY, 56, g[0], g[1])) { const a = sim.aimAt(e, g[0], g[1]); sim.fire(e, 'polygon', { sides: 5, per: dens(sim, 3 + (L > 1 ? 1 : 0)), star: 0.45, v: 1.0, a0: r3(a), spr: T.small }, g); } }],
    [365, (e, sim, L, T) => {
      for (const s of ['TL', 'TR']) {
        const g = bastionGun(sim, s);
        if (canFire(e, sim, AIM_MAXY, 56, g[0], g[1])) fireAt(e, sim, 'snipe', { n: 3, spread: 0.3, v: 2.6, delay: 18, spr: T.needle }, g);
      }
    }],
  ] },
  { len: 300, steps: [
    [0, (e, sim, L, T) => { const g = bastionGun(sim, 'C'); if (canFire(e, sim, FREE_MAXY, 56, g[0], g[1])) sim.fire(e, 'crossSpiral', { arms: 3 + (L > 1 ? 1 : 0), v: 1.0, every: 6, count: 34, da: 0.18, a0: r3(sim.rng.next() * TAU), spr: T.small, spr2: T.pet, follow: 1, ox: g[0], oy: g[1] }, g); }],
    [120, (e, sim, L, T) => {
      for (const s of ['L', 'R']) {
        const g = bastionGun(sim, s);
        if (canFire(e, sim, AIM_MAXY, 56, g[0], g[1])) fireAt(e, sim, 'burstChain', { v: 1.5, n1: dens(sim, 6), n2: 3, v2: 1.7, spr: T.big, spr1: T.orb, spr2: T.needle }, g);
      }
    }],
    [215, (e, sim, L, T) => { const g = bastionGun(sim, 'C'); if (canFire(e, sim, AIM_MAXY, 56, g[0], g[1])) fireAt(e, sim, 'lines', { ways: dens(sim, 7), spread: 1.3, per: 3, v: 1.5, dv: 0.25, spr: T.needle }, g); }],
    [260, (e, sim, L, T) => { const g = bastionGun(sim, 'C'); if (canFire(e, sim, FREE_MAXY, 56, g[0], g[1])) sim.fire(e, 'mineLayer', { count: 3, every: 10, v: 0.6, fuse: 70, ringN: dens(sim, 8 + L), ringV: 0.95, spr: T.orb === 'eb_orb_o' ? 'eb_orb_o' : 'eb_orb_p', ringSpr: T.small, follow: 1, ox: g[0], oy: g[1] }, g); }],
  ] },
];

function bastionBrain(e, sim, t) {
  const d = e.data, L = e.p.lvl ?? e.def.lvl;
  const T = THEMES[e.def.theme] || THEMES.choir;
  const lt = sim.tick - e.t0;
  const tin = Math.round((e.p.tin ?? 3) * 60);
  if (lt === Math.max(1, tin - 40)) sim.cue('arrive', null, e);
  if (lt < tin) return;
  if (!d.leaving && t > (e.p.stay ?? 60)) { d.leaving = 1; hoverLeave(sim, e, e.x, -110, 3.5); }
  if (d.leaving) { if (e.y < -80) sim.kill(e, -1, true); return; }
  const f = e.hp / e.maxHp;
  const want = f > 0.6 ? 0 : f > 0.3 ? 1 : 2;
  if (want > e.phase) { sim.setPhase(e, want); return; }
  const start = Math.max(e.phaseT0, e.t0 + tin) + (e.phase > 0 ? 50 : 0);
  const pt = sim.tick - start;
  if (pt < 0) return;
  const sc = BASTION_SCRIPT[Math.min(e.phase, BASTION_SCRIPT.length - 1)];
  const k = pt % sc.len;
  for (const s of sc.steps) if (s[0] === k) s[1](e, sim, L, T);
}
function bastionPhase(e, ph, sim) {
  if (ph <= 0) return;
  const fx = sim.env.fx, T = THEMES[e.def.theme] || THEMES.choir;
  // screen clear: stop live emitters too, so a peer that applies this event late (and let an
  // emitter run a few extra ticks) ends up with exactly the same bullets as the host
  for (const em of sim.emitters.list) em.dead = true;
  sim.clearBullets(true);
  fx.shockwave?.(e.x, e.y, 90, T.fx);
  const g = BASTION_GUNS[ph === 1 ? 'TL' : 'TR'];
  fx.explode(e.x + g[0], e.y + g[1], 'medium', { palette: 'fire' });
  fx.flash?.(0.25, [1, 0.85, 0.7]);
  fx.chroma?.(0.4);
  sim.env.sfx('boss_phase', { x: e.x });
  sim.env.shake(5, 0.5);
  sim.env.haptic?.('heavy');
}
function bastionDraw(e, ctx, lctx, sim, env) {
  const T = THEMES[e.def.theme] || THEMES.choir;
  const k = 0.5 + 0.5 * Math.sin(sim.tick * 0.1);
  glow(env, lctx, e.x, e.y + 13, 6 + 3 * k, T.col, 0.5 + 0.3 * k);
  // engines
  glow(env, lctx, e.x - 12, e.y - 17, 5, COL.o, 0.55);
  glow(env, lctx, e.x + 12, e.y - 17, 5, COL.o, 0.55);
  // battle damage: smoke / sparks from scarred gun decks
  if (e.phase >= 1) puff(e, sim, 'fire', 5, -14 + ((sim.tick >> 3) % 3) * 3, -6);
  if (e.phase >= 2 && (sim.tick % 11) === 0) sim.env.fx.spark?.(e.x + 15, e.y - 4, -HALF, 'ember', 2);
}
function bastionDeath(e, sim) {
  const fx = sim.env.fx, T = THEMES[e.def.theme] || THEMES.choir;
  for (const [dx, dy, s] of [[-16, -6, 'large'], [15, 4, 'large'], [0, 12, 'medium'], [-6, -14, 'medium'], [18, -10, 'small']]) {
    fx.explode(e.x + dx, e.y + dy, s, { palette: 'fire' });
  }
  fx.shockwave?.(e.x, e.y, 120, T.fx);
  fx.debris?.(e.x, e.y, 14, 'fire');
  fx.flash?.(0.45, [1, 0.9, 0.75]);
  fx.chroma?.(0.6);
  sim.env.sfx('explode_boss', { x: e.x, vol: 0.9 });
  sim.env.bg?.flash?.();
}
function makeBastion(L, theme, name) {
  return {
    spr: 'en_bastion', hp: Math.round(800 * Math.pow(1.25, L)), r: 18, score: 10000 + 4000 * L, move: 'hover',
    boss: true, midboss: true, bar: true, name, z: 1, lvl: L, theme, maxLife: 200,
    pdef: { x: FIELD_W / 2, y: -46, tx: FIELD_W / 2, ty: 86, tin: 3, sway: 28, swayF: 0.07, bob: 3 },
    brain: bastionBrain, onPhase: bastionPhase, drawOver: bastionDraw, onDeath: bastionDeath,
    cues: {
      arrive(e, sim) {
        sim.env.sfx('boss_roar', { x: e.x, vol: 0.7 });
        sim.env.shake(3, 0.8);
        sim.env.bg?.flash?.();
      },
    },
    drops: { gem: 8, gemL: 4, power: 1, bomb: 0.5, od: 0.5, life: L >= 2 ? 0.15 : 0 },
    explode: 'huge', palette: 'fire', odGain: 0.25,
  };
}
R.bastion = makeBastion(0, 'choir', 'BASTION FRIGATE');
R.bastion_crystal = makeBastion(1, 'crystal', 'PRISM BASTION');
R.bastion_wreck = makeBastion(2, 'ember', 'DERELICT BASTION');
R.bastion_void = makeBastion(3, 'void', 'VOID BASTION');

// =======================================================================================
// Finalize: auto gun brains, param defaults
// =======================================================================================

function finalize(def) {
  if (def.guns && !def.brain) def.brain = gunsBrain;
  if (def.pdef && !def._pdefWrapped) {
    const inner = def.onSpawn;
    const pd = def.pdef;
    def.onSpawn = (e, sim) => {
      for (const k in pd) if (e.p[k] === undefined) e.p[k] = pd[k];
      if (inner) inner(e, sim);
    };
    def._pdefWrapped = true;
  }
  return def;
}
for (const k in R) finalize(R[k]);

// Direct assignment (ENEMIES.foo = def, as bosses.js does) is finalized too.
export const ENEMIES = new Proxy(R, {
  set(target, key, value) {
    target[key] = value && typeof value === 'object' ? finalize(value) : value;
    return true;
  },
});

export function registerEnemies(obj) { Object.assign(ENEMIES, obj); }
