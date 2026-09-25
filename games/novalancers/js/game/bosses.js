// Nova Lancers — the five sector bosses (+ their parts), registered into ENEMIES.
//
// BOSSES[key] = { spawn(sim, rng) } — HOST ONLY: spawns the boss root (def boss:true, bar:true,
// hpFn for the HUD bar) and its parts as child enemies (parent = root id; children die with the
// root). Movement is closed-form (paths read t, e.p, e.phase/e.phaseT0 and fields written by
// onPhase/cues on every peer); every decision happens in the root's host brain and travels as
// sim.fire / setParams / setPhase / cue / spawn / kill events.
//
// Phase numbering (the HUD prints "PHASE n+1" for phase > 0):
//   phase 0   entrance (armored until the host's 'settle' cue) + first combat phase
//   phase 1,2 later combat phases (HP thresholds / parts destroyed)
//   phase -1  DYING: armored, bullets cleared, chained explosions, then the host kills the root
//             (explode:'boss' + onDeath flair) → onBossDefeated → stage flow.
// The root carries a small HP reserve (def.res, fraction of max HP) so the dying sequence can
// start before the engine's own "hp <= 0 → kill" fires; the HUD bar hides the reserve.
//
// HP below is 1-player (the engine multiplies every part by sim.diff.hp for co-op). Tuned so a
// focused pilot at the sector's expected power (S1 ≈ 5 … S5 = 8) needs ~50–100 s (Tempest fastest,
// Seraph slowest; the final boss ~65–120 s).
// 1 THE WARDEN  (S1, 2120 HP) hijacked shipyard carrier.
//     parts: 2 crane arms (240 hp, cable-hung claws with a turret each), 4 hull turrets (60),
//            9 armored hull plates (bullets spark off the hull), core (1400) behind a bay hatch.
//     P0 hatch shut: claws grapple at players (reticle telegraph), pendulum swipes dripping orbs,
//        arm fans, turret needles, drone launches. Both arms down (or 28 s) → P1.
//     P1 hatch open: core spirals / aimed rings + everything left alive.
//     P2 (core < 50%): pylon "gate" lasers + core rings, 6-beam rotating sunburst, petals.
// 2 CINDER WYRM (S2, 3500 HP bar) magma serpent: head (2000) + 10 segments (150, destroyable only
//     while molten = cracked frame; 75% of the damage they take also burns the head) + tail. The
//     body follows the head's track (turtle lines + arcs, exact arc length) at fixed arc offsets,
//     so every peer evaluates it closed-form. It surfaces in legs (coil figure-8, weave pass, hook,
//     dive through the field, lunge), burrowing off-screen between legs; the next emergence point
//     glows and previews the path (a danger corridor for dives/lunges). Head: fire-breath fans
//     along its heading (jaw-open telegraph), cluster bombs; molten segments lob magma.
//     P1 more molten + faster, magma rain while burrowed; P2 enrage: all molten, spirals, lunges.
//     Dying: the frozen serpent slides into view and bursts apart tail → head.
// 3 PRISM ARRAY (S3, 4140 HP) crystal core (2800) + 6 orbiting shards (170).
//     P0 shielded core; shards refract needles and fire a rotating beam wheel (beams ride the
//        shards; the core draws refraction beams into them) — shoot shards off to expose the
//        core (or 40 s).
//     P1 exposed core teleports (warp fade), implode rings, petals, refracting laser fans, stopAim.
//     P2 (core < 50%): 4 new shards grow (80), faster reverse wheel, cross spirals, accel rings.
// 4 THE DREADNOUGHT (S4, 4920 HP) bridge section: bridge (4000) + 6 turrets (100) +
//     4 drone hatches (80, launch seekers) + spinal cannon + 10 hull plates.
//     Signature: the cannon charges over 4 frames while a translucent wedge shows exactly what the
//     sweep will cover (safe side chosen from player positions), then a 28–34 px beam sweeps
//     across with screen shake and scorch bursts.
//     P0 bridge shuttered until the turrets fall (or 40 s); P1 bridge exposed (curtains, accel
//     rings); P2 (< 45%) overload: lowers, wider/faster sweep, crossfire, burst chains, snipes.
// 5 THE CHOIR HEART (S5, final, 6900 HP) eye within a rotating halo, 8 petals (100).
//     P0 Bloom (eye 2100): the eye blinks shut (armored) while the halo fires counter-rotating
//        orbit rings; petals (behind the halo plane, not hittable) fire radial needle lines;
//        bloom / rose patterns.
//     P1 Blades (2100): the halo shatters, petals tear free as spinning orbiting blades (now
//        destroyable) firing spirals; eye beam fans and opening laser fans.
//     P2 Singularity (1900): the heart devours its blades, core2 exposed; cross-spiral / rose
//        desperation that slowly accelerates over 40 s. Then a 6 s death sequence.

import { ENEMIES, canFire, fireAt, dens } from './enemies.js';
import { registerPatterns } from './patterns.js';
import { FIELD_W, FIELD_H } from '../config.js';
import { TAU, clamp, easeOut, easeIn, easeInOut, smooth } from '../util.js';
import { RAMPS } from '../art/palette.js';

const PI = Math.PI;
const HALF = PI / 2;
const CX = FIELD_W / 2;
const DYING = -1;
const LEAD = 60;                 // ticks of breather between a phase change and its first attack
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const r5 = (v) => Math.round(v * 100000) / 100000;
const lerp = (a, b, u) => a + (b - a) * u;
const COL = { p: '#ff6fb4', o: '#ffab4f', v: '#d596ff', c: '#86f4d8', w: '#ffffff', gold: '#ffd966', red: '#ff5a4f', cy: '#79ecff', hot: '#ffe2b3' };
const OUTLINE = '#05040c';

// ---------------------------------------------------------------------------------------
// Boss art metadata: js/art/bossart.js BOSS_META via sim.env.bossMeta, with these fallbacks.
// Simulation-critical offsets are resolved on the host and shipped in spawn params.
// ---------------------------------------------------------------------------------------
const META_FB = {
  warden: {
    armL: [-53, -18], armR: [53, -18], armPivot: [0, -20], armTip: [0, 26], armRSprite: 'boss_warden_arm_r',
    armCapsule: { from: [0, -20], to: [0, 26], r: 6 }, turrets: [[-24, -22], [24, -22], [-31, 21], [31, 21]], turretMuzzle: 6.5,
    core: [0, 8], coreR: 9, hatch: { sprite: 'boss_warden_hatch', frames: 5 }, bay: [0, 24], hullRadius: 46,
  },
  wyrm: {
    segSpacing: 19, tailSpacing: 15, segR: 12, headR: 15, tailR: 8, mouth: [0, -22], eyes: [[-6, -7], [6, -7]],
    segVariants: ['boss_wyrm_seg', 'boss_wyrm_seg_b', 'boss_wyrm_seg_c'],
  },
  prism: { shardOrbitR: 40, eye: [0, -3], coreR: 8, shardR: 5, shardLen: 28, bodyRx: 17, bodyRy: 30 },
  dread: {
    cannon: [0, 25], cannonMuzzle: [0, 21], turrets: [[-61, -12], [61, -12], [-38, 4], [38, 4], [-23, 27], [23, 27]], turretMuzzle: 7.5,
    hatches: [[-45, -27], [45, -27], [-73, 1], [73, 1]], bridge: [0, -7], bridgeR: 9, hullRadius: 70,
    shutter: { sprite: 'boss_dread_shutter', at: [0, -10], frames: 5 }, shadow: { sprite: 'boss_dread_shadow', dx: 6, dy: 8 },
  },
  heart: { iris: [0, 2], coreR: 7, eyeR: 23, haloR: 44, haloBand: 3.5, petalR: 64, petalLen: 36, petalW: 7, petalTip: 18, core2R: 11 },
};
let metaSrc = null, metaCache = {};
function meta(sim, key) {
  const src = (sim.env && sim.env.bossMeta) || null;
  if (src !== metaSrc) { metaSrc = src; metaCache = {}; }
  let m = metaCache[key];
  if (!m) {
    m = Object.assign({}, META_FB[key]);
    const s = src && src[key];
    if (s && typeof s === 'object') for (const k in s) if (s[k] !== undefined && s[k] !== null) m[k] = s[k];
    metaCache[key] = m;
  }
  return m;
}

// =======================================================================================
// Shared helpers
// =======================================================================================

// --- drawing (cosmetic, all peers) ----------------------------------------------------
const OPT = { dir: undefined, flipX: false, white: false, alpha: undefined, team: undefined };
// sprite at (x,y); dir = sprite direction (radians, 0 = up, clockwise) for rotated sprites
function sp(sim, ctx, lctx, name, fr, x, y, dir, flip, alpha, flash) {
  const S = sim.env.sprites;
  if (!S) return;
  if (alpha !== undefined && alpha <= 0.01) return;
  OPT.dir = dir; OPT.flipX = !!flip; OPT.white = false; OPT.alpha = alpha; OPT.team = undefined;
  S.draw(ctx, name, fr, x, y, OPT);
  if (flash) {
    OPT.white = true; OPT.alpha = (alpha ?? 1) * 0.5;
    S.draw(ctx, name, fr, x, y, OPT);
    OPT.white = false; OPT.alpha = alpha;
  }
  if (lctx) S.drawE(lctx, name, fr, x, y, OPT);
}
// sprite registered yet? (boss art is built lazily; fall back to drawn shapes until it is)
function hasSp(sim, name) { const S = sim.env.sprites; return !!(S && S._has && S._has(name)); }
function glow(sim, lctx, x, y, r, col, a) {
  if (a > 0.02 && sim.env.glow && r > 0.5) sim.env.glow(lctx, x, y, r, col, Math.min(1, a));
}
// dotted pixel line (no anti-aliasing)
function dotLine(ctx, x1, y1, x2, y2, gap, off, col, alpha) {
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
  if (L < 1 || alpha <= 0.01) return;
  const ux = dx / L, uy = dy / L;
  ctx.globalAlpha = Math.min(1, alpha); ctx.fillStyle = col;
  for (let d = ((off % gap) + gap) % gap; d < L; d += gap) ctx.fillRect(Math.round(x1 + ux * d), Math.round(y1 + uy * d), 1, 1);
  ctx.globalAlpha = 1;
}
function dotRing(ctx, x, y, r, n, rot, col, alpha, sz = 1) {
  if (alpha <= 0.01) return;
  ctx.globalAlpha = Math.min(1, alpha); ctx.fillStyle = col;
  for (let i = 0; i < n; i++) {
    const a = rot + (TAU * i) / n;
    ctx.fillRect(Math.round(x + Math.cos(a) * r - (sz >> 1)), Math.round(y + Math.sin(a) * r - (sz >> 1)), sz, sz);
  }
  ctx.globalAlpha = 1;
}
// a crane cable: 2 px dark core with bright links every 3 px
function cable(ctx, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
  if (L < 2) return;
  const ux = dx / L, uy = dy / L;
  for (let d = 0; d < L; d += 1) {
    const x = Math.round(x1 + ux * d), y = Math.round(y1 + uy * d);
    ctx.fillStyle = OUTLINE; ctx.fillRect(x - 1, y, 3, 1);
    ctx.fillStyle = (d | 0) % 3 === 0 ? RAMPS.steel[5] : RAMPS.steel[3];
    ctx.fillRect(x, y, 1, 1);
  }
}
// deterministic per-tick jitter (dying shake): -1..1
function jit(tick, salt) {
  const s = Math.sin(tick * 12.9898 + salt * 78.233) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}
// Tick-crossing for draw-driven cosmetic events: returns the last tick already processed.
function lastTick(e, key, sim) {
  const k = '_lt' + key, v = e[k];
  e[k] = sim.tick;
  return v === undefined || v > sim.tick ? sim.tick - 1 : v;
}
const crossed = (last, now, tk) => tk > last && tk <= now;
function nearestXY(sim, x, y) {
  const p = sim.nearestPlayer(x, y);
  return p ? [p.x, p.y] : [CX, FIELD_H - 60];
}
// sprite direction (0 = up) that points from (x,y) toward the nearest player — cosmetic aim
function aimDir(sim, x, y) {
  const [px, py] = nearestXY(sim, x, y);
  return Math.atan2(py - y, px - x) + HALF;
}

// --- structure --------------------------------------------------------------------------
function kids(e, sim, role) {
  const out = [];
  for (const c of sim.elist) if (c.alive && c.parent === e.id && (!role || c.p.role === role)) out.push(c);
  return out;
}
function kid(e, sim, role, key, val) {
  for (const c of sim.elist) if (c.alive && c.parent === e.id && c.p.role === role && (key === undefined || c.p[key] === val)) return c;
  return null;
}
function kidsHp(e, sim, roles) {
  let s = 0;
  for (const c of sim.elist) if (c.alive && c.parent === e.id && roles.includes(c.p.role)) s += Math.max(0, c.hp);
  return s;
}
const hpMul = (e) => e.maxHp / e.def.hp;
const resHp = (e) => e.maxHp * (e.def.res || 0);
const effHp = (e) => Math.max(0, e.hp - resHp(e));
const effMax = (e) => e.maxHp - resHp(e);
const effFrac = (e) => effHp(e) / Math.max(1, effMax(e));
const tinTicks = (e) => Math.round((e.p.tin ?? 4) * 60);
const settledAt = (e) => e.t0 + tinTicks(e);
function onField(e, m = 8, maxY = 300) { return e.x > m && e.x < FIELD_W - m && e.y > m && e.y < maxY; }

// --- host-side scheduling -----------------------------------------------------------------
function later(e, sim, dt, fn) { (e.data.q || (e.data.q = [])).push([sim.tick + Math.max(1, dt | 0), fn]); }
function runLater(e, sim) {
  const q = e.data.q;
  if (!q || !q.length) return;
  for (let i = 0; i < q.length;) {
    if (q[i][0] <= sim.tick) { const f = q[i][1]; q.splice(i, 1); f(); } else i++;
  }
}
// Attack scripts: { len, steps: [[tick, name, fn(e, sim)]] } looping from `start`.
function scriptStart(e) { return e.phase === 0 ? settledAt(e) + LEAD : e.phaseT0 + LEAD; }
function runScript(e, sim, sc) {
  if (!sc) return;
  const pt = sim.tick - scriptStart(e);
  if (pt < 0) return;
  const k = pt % sc.len;
  for (const s of sc.steps) if (s[0] === k) s[2](e, sim);
}
// ALL PEERS (cosmetic telegraphs): [ticks until the next step `name`, ticks since the last one]
function stepClock(e, sim, sc, name) {
  if (!sc || e.phase === DYING) return [Infinity, Infinity];
  const pt = sim.tick - scriptStart(e);
  let until = Infinity, since = Infinity;
  for (const s of sc.steps) {
    if (s[1] !== name) continue;
    if (pt < 0) { until = Math.min(until, s[0] - pt); continue; }
    const k = pt % sc.len;
    let d = s[0] - k; if (d < 0) d += sc.len;
    until = Math.min(until, d);
    let b = k - s[0]; if (b < 0) b += sc.len;
    if (pt - b >= 0) since = Math.min(since, b);
  }
  return [until, since];
}
// 0..1 telegraph envelope from a step clock
function tele(c, lead = 24, hold = 10) {
  if (c[0] <= lead) return 1 - c[0] / lead;
  if (c[1] <= hold) return 1 - c[1] / hold;
  return 0;
}

// --- shared phase / death machinery ----------------------------------------------------------
function stopAll(sim) {
  for (const em of sim.emitters.list) em.dead = true;
  sim.clearBullets(true);
}
function phaseFx(e, sim, pal, big) {
  stopAll(sim);
  const fx = sim.env.fx;
  fx.shockwave?.(e.x, e.y, big ? 120 : 84, pal);
  fx.flash?.(big ? 0.4 : 0.25, [1, 0.9, 0.95]);
  fx.chroma?.(big ? 0.6 : 0.35);
  sim.env.sfx('boss_phase', { x: e.x, vol: 1 });
  sim.env.shake(big ? 6 : 4, big ? 0.7 : 0.45);
  sim.env.haptic?.('heavy');
  sim.env.bg?.flash?.();
}
function dyingFx(e, sim, pal) {
  e.armor = true;
  for (const c of sim.elist) if (c.parent === e.id) c.armor = true;
  stopAll(sim);
  const fx = sim.env.fx;
  fx.flash?.(0.55, [1, 0.95, 0.9]);
  fx.chroma?.(0.8);
  fx.shockwave?.(e.x, e.y, 70, pal);
  fx.explode(e.x, e.y, 'large', { palette: pal });
  sim.env.sfx('boss_phase', { x: e.x, vol: 1.1 });
  sim.env.sfx('explode_large', { x: e.x, vol: 1 });
  sim.env.shake(6, 1.2);
  sim.env.haptic?.('heavy');
  sim.env.music?.duck?.(0.55, 2.5);
  sim.env.bg?.flash?.();
}
// HOST: dying sequence — pops over parts / hull, optionally eating parts, then the final kill.
function dieBrain(e, sim, o) {
  const k = sim.tick - e.phaseT0;
  if (k >= o.dur) { sim.kill(e, -1); return; }
  if (k % (o.every || 8) !== 3) return;
  const rng = sim.rng;
  const vis = kids(e, sim).filter((c) => c.p.role !== 'plate');
  if (vis.length && k > 10 && rng.next() < (o.partP ?? 0.45)) {
    const c = vis[Math.floor(rng.next() * vis.length)];
    sim.cue('pop', [r2(c.x), r2(c.y), c.r > 10 ? 2 : 1], e);
    if (o.eat && o.eat.includes(c.p.role) && k < o.dur - 20) sim.kill(c, -1, true);
  } else {
    const g = Math.min(1, k / o.dur) * (o.grow ?? 0) + 1;
    sim.cue('pop', [r2(e.x + (rng.next() * 2 - 1) * o.rx * g), r2(e.y + (o.oy || 0) + (rng.next() * 2 - 1) * o.ry * g), rng.next() < 0.3 ? 2 : 1], e);
  }
}
function popCue(pal) {
  return (e, sim, d) => {
    if (!Array.isArray(d)) return;
    const fx = sim.env.fx, s = d[2] | 0;
    fx.explode(d[0], d[1], s >= 2 ? 'large' : s === 1 ? 'medium' : 'small', { palette: pal });
    if (s >= 2) { fx.shockwave?.(d[0], d[1], 34, pal); fx.debris?.(d[0], d[1], 4, 'fire'); sim.env.shake(3, 0.25); }
    sim.sfxAt(s >= 2 ? 'explode_large' : 'explode_medium', d[0], 0.85);
  };
}
function roarCue(pal) {
  return (e, sim) => {
    sim.env.sfx('boss_roar', { x: e.x, vol: 1 });
    sim.env.shake(4, 1.0);
    sim.env.haptic?.('heavy');
    sim.env.bg?.flash?.();
    sim.env.fx.shockwave?.(e.x, e.y, 60, pal);
    sim.env.fx.chroma?.(0.3);
  };
}
// Optional background hook (all peers): lets a backdrop react to the boss fight — e.g. the
// Event Horizon can pull its black-hole lens away from the boss arena. No-op if unsupported.
function bgBoss(sim, on) { try { sim.env.bg?.bossMode?.(on); } catch { /* optional */ } }
function bigDeath(e, sim, pal, ring, spots) {
  bgBoss(sim, false);
  const fx = sim.env.fx;
  fx.shockwave?.(e.x, e.y, ring, pal);
  fx.shockwave?.(e.x, e.y, ring * 0.55, 'white');
  fx.debris?.(e.x, e.y, 18, 'fire');
  for (const [dx, dy, s] of spots) fx.explode(e.x + dx, e.y + dy, s, { palette: s === 'large' ? 'fire' : pal });
  fx.flash?.(0.85, [1, 0.97, 0.92]);
  fx.chroma?.(1);
  sim.env.sfx('explode_boss', { x: e.x, vol: 1.2 });
  sim.env.bg?.flash?.();
  sim.env.haptic?.('death');
}
// generic armored hull plate (invisible; bullets spark off it, blows up with the boss)
function plateDef(pal) {
  return {
    spr: 'eb_small_p', hp: 1, hpScale: false, armor: true, r: 8, score: 0, z: 8, move: 'attach',
    explode: 'medium', palette: pal, drops: {}, odGain: 0, draw() {},
  };
}
// shared drop tables
const BOSS_DROPS = (g, gl) => ({ gem: g, gemL: gl, power: 1, bomb: 0.7, od: 0.8 });

// =======================================================================================
// 1. THE WARDEN — hijacked shipyard carrier (S1)
// Root = the core in the bay (weak point). Hull center = root - META.core.
// =======================================================================================

const W_CORE = 1400, W_RES = 150, W_ARM = 240, W_TUR = 60;
// hull plates [x, y, r] relative to the hull center (kept clear of turrets, arms and the bay)
const W_PLATES = [[0, -26, 11], [-16, -34, 6], [16, -34, 6], [-37, -21, 6], [37, -21, 6], [-53, -21, 9], [53, -21, 9], [-31, 1, 8], [31, 1, 8]];
const W_SWING = { sl: 92, sw: 0.72, half: 0.8, n: 4 };
// grapple telegraph (ticks the reticle shows before the claw launches) and the reticle's final
// radius — it must cover the claw's real body-kill radius (0.75·r 13 + ship hitbox ≈ 12.3 px)
const W_GRAB = 60, W_GRAB_R = 13;

function wardenHullPath(e, t) {
  const p = e.p, tin = p.tin ?? 4.2, tick = e.t0 + t * 60;
  const u = easeOut(clamp(t / tin, 0, 1));
  const tt = Math.max(0, t - tin);
  const k2 = e.t2 !== undefined ? smooth(clamp((tick - e.t2) / 150, 0, 1)) : 0;
  const amp = (30 + 14 * k2) * smooth(clamp(tt / 2.5, 0, 1));
  const y0 = p.y ?? -70, ty = p.ty ?? 96;
  let y = y0 + (ty - y0) * u + 4 * Math.sin(t * 0.9) * u + 10 * k2;
  if (e.tD !== undefined) { const kd = clamp((tick - e.tD) / 160, 0, 1); y += 16 * kd * kd; }
  e.x = (p.x ?? CX) + amp * Math.sin(tt * 0.36);
  e.y = y;
}

// Arm: hangs from its hull turntable; act 1 = grapple (claw flies to tx,ty on its cable),
// act 2 = pendulum swing. `at` = absolute tick the action starts (telegraph before it).
function wardenArmPath(e, t, sim) {
  const par = sim.enemies.get(e.parent);
  if (!par) return;
  const p = e.p, side = p.side || -1;
  const px = par.x + p.ox, py = par.y + p.oy;
  let ax = px + Math.sin(t * 1.3 + side) * 1.2, ay = py;
  const s = (sim.tick - (p.at || 0)) / 60;
  if (p.act === 1 && s >= 0) {
    const tx = p.tx ?? px, ty = (p.ty ?? 200) - p.pv - p.cy;
    if (s < 0.3) { const u = easeIn(s / 0.3); ax = lerp(ax, tx, u); ay = lerp(ay, ty, u); }
    else if (s < 0.75) { ax = tx; ay = ty; }
    else if (s < 1.75) { const u = easeInOut((s - 0.75) / 1.0); ax = lerp(tx, ax, u); ay = lerp(ty, ay, u); }
  } else if (p.act === 2 && s >= 0) {
    const sl = p.sl || W_SWING.sl, half = p.half || W_SWING.half, D = (p.sn || W_SWING.n) * half;
    let L = 0, th = 0;
    if (s < 0.5) L = sl * easeOut(s / 0.5);
    else if (s < 0.5 + D) {
      // synchronized swings, each biased toward the middle so neither claw leaves the field
      const bias = -side * 0.3 * smooth(clamp((s - 0.5) / 0.4, 0, 1)) * smooth(clamp((0.5 + D - s) / 0.4, 0, 1));
      L = sl; th = (p.sw || W_SWING.sw) * Math.sin((PI * (s - 0.5)) / half) + bias;
    }
    else if (s < 1.1 + D) L = sl * (1 - easeInOut((s - 0.5 - D) / 0.6));
    ax += Math.sin(th) * L; ay += Math.cos(th) * L;
  }
  e.x = ax;
  e.y = ay + p.pv + p.cy;
}

function wardenArmor(e, sim) {
  const settled = e._settled;
  for (const c of sim.elist) {
    if (!c.alive || c.parent !== e.id) continue;
    c.armor = e.phase === DYING || !settled || c.p.role === 'plate';
  }
  e.armor = e.phase === DYING || e.phase === 0;
}

// ---- host attacks
function wTurrets(e, sim) {
  const ph = e.phase;
  let i = 0;
  for (const c of kids(e, sim, 'tur')) {
    later(e, sim, 1 + i++ * 6, () => {
      if (!c.alive || !canFire(c, sim, 300, 48)) return;
      fireAt(c, sim, 'lines', { ways: ph >= 2 ? 2 : 1, spread: 0.3, per: 3, v: 1.35, dv: 0.25, spr: 'eb_needle_p' });
    });
  }
}
function armBusy(arm, sim) { return (arm.data.busy || 0) > sim.tick; }
function wArmDrop(e, sim, side) {
  const arm = kid(e, sim, 'arm', 'side', side);
  if (!arm || armBusy(arm, sim)) return;
  const tg = sim.targetPlayer(arm, 'near');
  if (!tg) return;
  const tx = clamp(tg.x, side < 0 ? 18 : 72, side < 0 ? 168 : 222), ty = clamp(tg.y, 176, 300);
  const at = sim.tick + W_GRAB;
  sim.setParams(arm, { act: 1, at, tx: r2(tx), ty: r2(ty) });
  arm.data.busy = at + 112;
  later(e, sim, W_GRAB + 19, () => {
    if (!arm.alive) return;
    sim.cue('snap', null, arm);
    if (canFire(arm, sim, 330, 46)) sim.fire(arm, 'ring', { n: dens(sim, e.phase >= 2 ? 12 : 10), v: 0.9, a0: r3(sim.rng.next() * TAU), spr: 'eb_small_o' }, [0, 8]);
  });
}
function wArmFans(e, sim) {
  for (const arm of kids(e, sim, 'arm')) {
    if (armBusy(arm, sim)) continue;
    const g = [arm.p.side < 0 ? 1 : -1, -18];
    if (canFire(arm, sim, 280, 48, g[0], g[1])) fireAt(arm, sim, 'fan', { n: dens(sim, 5), spread: 0.75, v: 1.3, spr: 'eb_orb_p' }, g);
  }
}
function wSwing(e, sim) {
  const at = sim.tick + 20;
  const dur = Math.round((1.1 + W_SWING.n * W_SWING.half) * 60);
  for (const arm of kids(e, sim, 'arm')) {
    if (armBusy(arm, sim)) continue;
    sim.setParams(arm, { act: 2, at });
    arm.data.busy = at + dur + 4;
    later(e, sim, 20 + 30, () => {
      if (!arm.alive) return;
      sim.fire(arm, 'trail', { count: 16, every: 12, v: 0.45, acc: 0.01, vmax: 1.25, spr: 'eb_orb_o', follow: 1, oy: 12 });
    });
  }
}
function wBay(e, sim) {
  const M = meta(sim, 'warden');
  const bx = M.bay[0] - M.core[0], by = M.bay[1] - M.core[1];
  const n = e.phase === 0 ? 3 : 4, type = e.phase >= 2 ? 'mite_shot' : 'mite';
  sim.cue('bay', null, e);
  for (let i = 0; i < n; i++) {
    later(e, sim, 14 + i * 12, () => {
      if (sim.state !== 'play' || e.phase === DYING) return;
      sim.spawn(type, { path: 'sine', x: r2(e.x + bx), y: r2(e.y + by), vy: 72, amp: 20 + i * 6, freq: 0.45, ph: r2(i * 2.1) });
    });
  }
}
function wCoreSpiral(e, sim) {
  if (!canFire(e, sim, 320, 50)) return;
  sim.fire(e, 'spiral', { arms: dens(sim, 3), v: 1.05, every: 5, count: 34, da: 0.21, a0: r3(sim.rng.next() * TAU), spr: 'eb_small_v', follow: 1 });
}
function wCoreRing(e, sim) {
  if (!canFire(e, sim, 300, 50)) return;
  fireAt(e, sim, 'aimRing', { n: dens(sim, e.phase >= 2 ? 18 : 16), v: 1.1, spr: 'eb_orb_p' });
}
function wGate(e, sim) {
  const M = meta(sim, 'warden');
  const oy = r2(37 - M.core[1]);
  for (const s of [-1, 1]) {
    sim.fire(e, 'beam', { a: r3(HALF), av: -s * 0.0028, avT: 130, w: 10, warn: 50, dur: 170, len: 480, pal: 'magenta', follow: 1, ox: s * 31, oy }, [s * 31, oy]);
  }
  later(e, sim, 60, () => {
    if (e.phase === DYING || !canFire(e, sim, 320, 40)) return;
    sim.fire(e, 'rings', { n: dens(sim, 12), count: 4, every: 34, v: 0.95, rot: 0.26, a0: r3(sim.rng.next() * TAU), spr: 'eb_orb_v', follow: 1 });
  });
}
function wSun(e, sim) {
  const s = sim.rng.next() < 0.5 ? -1 : 1;
  sim.fire(e, 'laserFan', { n: 6, full: 1, a: r3(sim.rng.next() * TAU), w: 8, warn: 50, dur: 110, av: s * 0.0045, avT: 110, len: 420, pal: 'plasma', follow: 1 });
}
function wPetal(e, sim) {
  if (!canFire(e, sim, 320, 50)) return;
  sim.fire(e, 'petal', { n: dens(sim, 7), per: 5, width: 0.55, v: 0.95, dv: 0.5, curl: 0.012, a0: r3(sim.rng.next() * TAU), spr: 'eb_small_p' });
}
const W_SCRIPT = {
  0: { len: 600, steps: [
    [0, 'tur', wTurrets], [40, 'dropL', (e, s) => wArmDrop(e, s, -1)], [130, 'fans', wArmFans],
    [210, 'dropR', (e, s) => wArmDrop(e, s, 1)], [290, 'bay', wBay], [330, 'swing', wSwing], [470, 'tur', wTurrets],
  ] },
  1: { len: 540, steps: [
    [0, 'spiral', wCoreSpiral], [60, 'tur', wTurrets], [170, 'dropL', (e, s) => wArmDrop(e, s, -1)],
    [240, 'ring', wCoreRing], [300, 'dropR', (e, s) => wArmDrop(e, s, 1)], [370, 'bay', wBay], [440, 'fans', wArmFans], [470, 'tur', wTurrets],
  ] },
  2: { len: 720, steps: [
    [0, 'gate', wGate], [230, 'sun', wSun], [300, 'tur', wTurrets], [380, 'dropL', (e, s) => wArmDrop(e, s, -1)],
    [440, 'dropR', (e, s) => wArmDrop(e, s, 1)], [500, 'petal', wPetal], [580, 'bay', wBay], [620, 'fans', wArmFans], [660, 'ring', wCoreRing],
  ] },
};

function wardenBrain(e, sim) {
  runLater(e, sim);
  if (e.phase === DYING) { dieBrain(e, sim, { dur: 160, rx: 58, ry: 30, oy: -10, eat: ['tur', 'arm'] }); return; }
  const lt = sim.tick - e.t0, tin = tinTicks(e);
  if (!e.data.settled) {
    if (lt === tin - 50) sim.cue('roar', null, e);
    if (lt >= tin) { e.data.settled = true; sim.cue('settle', null, e); }
    return;
  }
  if (e.hp <= resHp(e)) { sim.setPhase(e, DYING); return; }
  if (e.phase === 0) {
    if (!kid(e, sim, 'arm') || sim.tick - settledAt(e) > 28 * 60) { sim.setPhase(e, 1); return; }
  } else if (e.phase === 1 && effFrac(e) <= 0.5) { sim.setPhase(e, 2); return; }
  runScript(e, sim, W_SCRIPT[e.phase]);
}

function wardenPhase(e, ph, sim) {
  if (ph === DYING) { e.tD = e.phaseT0; dyingFx(e, sim, 'fire'); return; }
  if (ph === 1) {
    e.tOpen = e.phaseT0;
    phaseFx(e, sim, 'magenta', false);
    sim.env.sfx('enemy_laser_charge', { x: e.x, vol: 0.8, pitch: -5 });
    sim.env.fx.spark?.(e.x - 8, e.y, PI, 'gold', 6);
    sim.env.fx.spark?.(e.x + 8, e.y, 0, 'gold', 6);
  } else if (ph === 2) {
    e.t2 = e.phaseT0;
    phaseFx(e, sim, 'fire', true);
    sim.env.sfx('boss_roar', { x: e.x, vol: 0.9, pitch: 2 });
    sim.env.fx.explode(e.x - 30, e.y - 20, 'medium', { palette: 'fire' });
    sim.env.fx.explode(e.x + 34, e.y - 14, 'medium', { palette: 'fire' });
  }
  wardenArmor(e, sim);
}

function wardenHp(e, sim) {
  if (e.phase === DYING) return 0;
  const hm = hpMul(e);
  const cur = effHp(e) + kidsHp(e, sim, ['arm', 'tur']);
  return cur / (effMax(e) + (2 * W_ARM + 4 * W_TUR) * hm);
}

// hatch shutters over the core: they retract sideways as `open` goes 0 → 1
function wardenHatch(ctx, lctx, sim, cx, cy, open) {
  const H0 = meta(sim, 'warden').hatch;
  if (H0 && hasSp(sim, H0.sprite)) {
    const fr = Math.round(clamp(open, 0, 1) * ((H0.frames || 5) - 1));
    sp(sim, ctx, lctx, H0.sprite, fr, cx, cy);
    if (fr === 0) { const k = 0.5 + 0.5 * Math.sin(sim.tick * 0.2); glow(sim, lctx, cx, cy, 5 + 2 * k, COL.p, 0.3 + 0.2 * k); }
    return;
  }
  const HW = 11, H = 15, w = Math.round(HW * (1 - open));
  if (w <= 0) return;
  const top = Math.round(cy) - 7, L = Math.round(cx) - HW, R = Math.round(cx) + HW;
  const st = RAMPS.steel;
  const door = (x, flip) => {
    ctx.fillStyle = OUTLINE; ctx.fillRect(x, top, w, H);
    if (w > 2) {
      ctx.fillStyle = st[2]; ctx.fillRect(x + 1, top + 1, w - 2, H - 2);
      ctx.fillStyle = st[4]; ctx.fillRect(x + 1, top + 1, w - 2, 1);
      ctx.fillStyle = st[1]; ctx.fillRect(x + 1, top + H - 2, w - 2, 1);
      ctx.fillStyle = st[3];
      for (let y = top + 3; y < top + H - 3; y += 3) ctx.fillRect(x + 1, y, w - 2, 1);
      // hazard chevrons on the meeting edge
      const ex = flip ? x + 1 : x + w - 3;
      for (let y = top + 2; y < top + H - 2; y += 2) { ctx.fillStyle = (y >> 1) & 1 ? RAMPS.gold[3] : OUTLINE; ctx.fillRect(ex, y, 2, 1); }
    }
  };
  door(L, false);
  door(R - w, true);
  if (w >= HW - 1) {
    const k = 0.5 + 0.5 * Math.sin(sim.tick * 0.2);
    glow(sim, lctx, cx, cy, 5 + 2 * k, COL.p, 0.35 + 0.25 * k);
    lctx.fillStyle = COL.p; lctx.fillRect(Math.round(cx) - 1, top + 2, 2, H - 4);
  }
}

function wardenDraw(e, ctx, lctx, sim) {
  const M = meta(sim, 'warden');
  const t = (sim.tick - e.t0) / 60;
  let jx = 0, jy = 0;
  if (e.phase === DYING) {
    const k = clamp((sim.tick - e.phaseT0) / 160, 0, 1);
    jx = Math.round(jit(sim.tick, 1) * 2.5 * k); jy = Math.round(jit(sim.tick, 2) * 1.5 * k);
  }
  const x = e.x + jx, y = e.y + jy;
  const hx = x - M.core[0], hy = y - M.core[1];
  const settled = e._settled;
  // engine / retro thrusters
  const thr = settled ? 0.45 : 1;
  for (const s of [-1, 1]) {
    glow(sim, lctx, hx + s * 18, hy - 37, 7 + 2 * Math.sin(sim.tick * 0.3 + s), COL.v, 0.55 * thr + 0.2);
    if (!settled && (sim.tick & 1)) sim.env.fx.trail?.(hx + s * 18, hy - 40, 'plasma', 2);
  }
  sp(sim, ctx, lctx, 'boss_warden', Math.floor(t * 3), hx, hy);
  // core in the bay
  const open = e.tOpen !== undefined ? smooth(clamp((sim.tick - e.tOpen) / 40, 0, 1)) : 0;
  sp(sim, ctx, lctx, 'boss_warden_core', Math.floor(t * 8), x, y, 0, false, 1, e.flash > 0 && open > 0.5);
  if (open > 0) {
    const sc = W_SCRIPT[e.phase];
    const a = Math.max(tele(stepClock(e, sim, sc, 'spiral'), 30), tele(stepClock(e, sim, sc, 'ring'), 30), tele(stepClock(e, sim, sc, 'petal'), 30), tele(stepClock(e, sim, sc, 'sun'), 30));
    const k = 0.5 + 0.5 * Math.sin(sim.tick * 0.15);
    glow(sim, lctx, x, y, (8 + 3 * k + 8 * a) * open, a > 0.2 ? COL.w : COL.p, (0.45 + 0.5 * a) * open);
  }
  wardenHatch(ctx, lctx, sim, x, y, open);
  // bay drone lights
  const bay = tele(stepClock(e, sim, W_SCRIPT[e.phase], 'bay'), 40, 30);
  if (bay > 0 && ((sim.tick >> 2) & 1)) {
    const bx = hx + M.bay[0], by = hy + M.bay[1];
    glow(sim, lctx, bx - 9, by + 1, 4, COL.gold, bay);
    glow(sim, lctx, bx + 9, by + 1, 4, COL.gold, bay);
  }
  // battle damage: missing turrets smoke, broken arm turntables spark
  if (settled) {
    const live = new Set();
    for (const c of kids(e, sim)) live.add(c.p.role + (c.p.i ?? c.p.side));
    M.turrets.forEach(([tx, ty], i) => {
      if (live.has('tur' + i)) return;
      if ((sim.tick + i * 5) % 9 === 0) sim.env.fx.trail?.(hx + tx + jit(sim.tick, i) * 2, hy + ty - 2, 'fire', 2);
      glow(sim, lctx, hx + tx, hy + ty, 4, COL.o, 0.35 + 0.2 * Math.sin(sim.tick * 0.3 + i));
    });
    for (const s of [-1, 1]) {
      if (live.has('arm' + s)) continue;
      const pv = s < 0 ? M.armL : M.armR;
      if ((sim.tick + (s > 0 ? 7 : 0)) % 13 === 0) sim.env.fx.spark?.(hx + pv[0], hy + pv[1] + 4, HALF + s * 0.6, 'gold', 2);
      if ((sim.tick + 3) % 7 === 0) sim.env.fx.trail?.(hx + pv[0], hy + pv[1], 'fire', 2);
    }
  }
  if (e.phase === 2 && (sim.tick % 6) === 0) sim.env.fx.trail?.(hx - 34 + ((sim.tick >> 3) % 3) * 4, hy - 20, 'fire', 2);
}

function wardenArmDraw(e, ctx, lctx, sim) {
  const par = sim.enemies.get(e.parent);
  if (!par) return;
  const p = e.p, side = p.side || -1;
  const px = par.x + p.ox, py = par.y + p.oy;
  const cx = e.x, cyy = e.y - p.cy;           // arm sprite center
  const ax = cx, ay = cyy - p.pv;             // arm top (its turntable)
  if (Math.hypot(ax - px, ay - py) > 3) cable(ctx, px, py, ax, ay);
  // grapple telegraph: reticle on the target + guide line
  if (p.act === 1) {
    const s = sim.tick - (p.at || 0);
    if (s >= -W_GRAB && s < 22) {
      const k = clamp((s + W_GRAB) / W_GRAB, 0, 1), rot = sim.tick * 0.08 * side;
      const col = s >= 0 ? COL.w : COL.o;
      const rr = W_GRAB_R + 5 * (1 - k);       // closes in on the real danger radius
      // a dense pixel ring with a dark rim (reads over bright backgrounds on a phone) + 4 brackets
      dotRing(ctx, p.tx, p.ty, rr + 1, 40, rot, OUTLINE, 0.55);
      dotRing(ctx, p.tx, p.ty, rr, 40, rot, col, 0.7 + 0.3 * k);
      dotRing(lctx, p.tx, p.ty, rr, 40, rot, col, 0.55 + 0.45 * k);
      for (let i = 0; i < 4; i++) {
        const a = -rot * 1.5 + i * HALF, c = Math.cos(a), si = Math.sin(a);
        dotLine(ctx, p.tx + c * (rr + 7), p.ty + si * (rr + 7), p.tx + c * (rr + 2), p.ty + si * (rr + 2), 1, 0, col, 0.85);
        dotLine(lctx, p.tx + c * (rr + 7), p.ty + si * (rr + 7), p.tx + c * (rr + 2), p.ty + si * (rr + 2), 1, 0, col, 0.7);
      }
      ctx.globalAlpha = 0.8; ctx.fillStyle = col;
      ctx.fillRect(Math.round(p.tx) - 1, Math.round(p.ty), 3, 1); ctx.fillRect(Math.round(p.tx), Math.round(p.ty) - 1, 1, 3);
      ctx.globalAlpha = 1;
      if (s < 0) dotLine(lctx, e.x, e.y + 8, p.tx, p.ty, 5, sim.tick >> 1, COL.o, 0.35 + 0.4 * k);
      glow(sim, lctx, p.tx, p.ty, 6 + 6 * k, COL.o, 0.25 + 0.35 * k);
    }
  }
  const flash = e.flash > 0;
  const armR = side > 0 && meta(sim, 'warden').armRSprite;
  if (armR && hasSp(sim, armR)) sp(sim, ctx, lctx, armR, 0, cx, cyy, 0, false, 1, flash);
  else sp(sim, ctx, lctx, 'boss_warden_arm', 0, cx, cyy, 0, side > 0, 1, flash);
  // arm turret (tracks the nearest player, glows before its fan)
  const tx = cx + (side < 0 ? 1 : -1), ty = cyy - 8;
  sp(sim, ctx, lctx, 'boss_warden_turret', 0, tx, ty, aimDir(sim, tx, ty), false, 1, flash);
  const g = tele(stepClock(par, sim, W_SCRIPT[par.phase], 'fans'), 26);
  if (g > 0 && !e.armor) glow(sim, lctx, tx, ty, 3 + 6 * g, COL.p, 0.3 + 0.6 * g);
  // claw glow while grappling / swinging
  const s = (sim.tick - (p.at || 0)) / 60;
  if ((p.act === 1 && s >= 0 && s < 0.9) || (p.act === 2 && s >= 0.4 && s < 0.6 + W_SWING.n * W_SWING.half)) {
    glow(sim, lctx, cx, cyy + 22, 7, COL.o, 0.55);
  }
}

function wardenTurretDraw(e, ctx, lctx, sim) {
  const par = sim.enemies.get(e.parent);
  sp(sim, ctx, lctx, 'boss_warden_turret', 0, e.x, e.y, aimDir(sim, e.x, e.y), false, 1, e.flash > 0);
  if (par && !e.armor) {
    const g = tele(stepClock(par, sim, W_SCRIPT[par.phase], 'tur'), 24);
    if (g > 0) glow(sim, lctx, e.x, e.y, 3 + 5 * g, COL.p, 0.3 + 0.6 * g);
  }
}

ENEMIES.warden = {
  spr: 'boss_warden_core', hp: W_CORE + W_RES, res: W_RES / (W_CORE + W_RES), r: 12, score: 50000,
  boss: true, bar: true, name: 'THE WARDEN', z: 2, move: 'wardenHull', paths: { wardenHull: wardenHullPath },
  explode: 'boss', palette: 'fire', odGain: 0.5, drops: BOSS_DROPS(14, 6),
  hpFn: wardenHp, brain: wardenBrain, onPhase: wardenPhase, draw: wardenDraw,
  onSpawn(e, sim) { e.armor = true; bgBoss(sim, true); },
  onDeath(e, sim) { bigDeath(e, sim, 'fire', 150, [[-44, -24, 'large'], [42, -20, 'large'], [0, -34, 'medium'], [-30, 22, 'medium'], [30, 22, 'medium']]); },
  cues: {
    roar: roarCue('magenta'),
    settle(e, sim) { e._settled = true; e.data.settled = true; wardenArmor(e, sim); sim.env.sfx('boss_phase', { x: e.x, vol: 0.6, pitch: -4 }); },
    bay(e, sim) { sim.env.sfx('warp_in', { x: e.x, vol: 0.5, pitch: -3 }); },
    pop: popCue('fire'),
  },
};
ENEMIES.warden_arm = {
  spr: 'boss_warden_arm', hp: W_ARM, r: 13, score: 3000, z: 3, move: 'wardenArm', paths: { wardenArm: wardenArmPath },
  explode: 'large', palette: 'fire', odGain: 0.15, drops: { gem: 3, power: 0.35 },
  onSpawn(e) { e.armor = true; },
  draw: wardenArmDraw,
  onDeath(e, sim) {
    const fx = sim.env.fx;
    fx.shockwave?.(e.x, e.y, 50, 'fire'); fx.debris?.(e.x, e.y, 8, 'fire');
    fx.explode(e.x, e.y - 24, 'medium', { palette: 'fire' });
    sim.env.sfx('explode_large', { x: e.x, vol: 0.9 });
  },
  cues: {
    snap(e, sim) {
      sim.env.sfx('hit_armor', { x: e.x, vol: 1, pitch: -8 });
      sim.env.fx.spark?.(e.x - 5, e.y + 14, HALF + 0.8, 'ember', 4);
      sim.env.fx.spark?.(e.x + 5, e.y + 14, HALF - 0.8, 'ember', 4);
      sim.env.shake(2, 0.15);
    },
  },
};
ENEMIES.warden_turret = {
  spr: 'boss_warden_turret', hp: W_TUR, r: 6.5, score: 800, z: 4, move: 'attach',
  explode: 'medium', palette: 'fire', odGain: 0.05, drops: { gem: 1 },
  onSpawn(e) { e.armor = true; }, draw: wardenTurretDraw,
};
ENEMIES.warden_plate = plateDef('fire');

function spawnWarden(sim) {
  const M = meta(sim, 'warden');
  const e = sim.spawn('warden', { x: CX, y: -70, ty: 96, tin: 4.2 });
  if (!e) return null;
  const hcx = -M.core[0], hcy = -M.core[1];
  for (const side of [-1, 1]) {
    const pv = side < 0 ? M.armL : M.armR;
    sim.spawn('warden_arm', { role: 'arm', side, ox: r2(hcx + pv[0]), oy: r2(hcy + pv[1]), pv: -M.armPivot[1], cy: 10, act: 0, at: 0 }, e.id);
  }
  M.turrets.forEach(([x, y], i) => sim.spawn('warden_turret', { role: 'tur', i, ox: r2(hcx + x), oy: r2(hcy + y) }, e.id));
  for (const [x, y, r] of W_PLATES) sim.spawn('warden_plate', { role: 'plate', ox: r2(hcx + x), oy: r2(hcy + y), r }, e.id);
  return e;
}

// =======================================================================================
// 2. CINDER WYRM — magma serpent (S2)
// Track: a leg = { k (start tick rel. head spawn), v (px/s), x, y, a (start pose), c: [len, rad, …] }
// built turtle-style from straights (rad 0) and arcs (|rad| = radius, sign = turn direction:
// + clockwise on screen). Exact arc length → constant segment spacing. Legs start and end
// off-screen; the body always trails `d` px behind the head along the current/previous leg.
// =======================================================================================

const Y_HEAD = 2000, Y_RES = 200, Y_SEG = 150, Y_NSEG = 10;
const Y_SHARE = 0.75;             // fraction of damage dealt to molten segments that also burns the head
const TRK = new WeakMap();
function trkBuild(leg) {
  let T = TRK.get(leg);
  if (T) return T;
  const pcs = [];
  let x = leg.x, y = leg.y, a = leg.a, s0 = 0;
  const c = leg.c || [];
  for (let i = 0; i + 1 < c.length; i += 2) {
    const len = c[i], rad = c[i + 1];
    const pc = { x, y, a, len, rad, s0, cx: 0, cy: 0 };
    pcs.push(pc);
    if (!rad) { x += Math.cos(a) * len; y += Math.sin(a) * len; }
    else {
      const sg = rad > 0 ? 1 : -1, R = Math.abs(rad);
      pc.cx = x - sg * R * Math.sin(a); pc.cy = y + sg * R * Math.cos(a);
      a += (sg * len) / R;
      x = pc.cx + sg * R * Math.sin(a); y = pc.cy - sg * R * Math.cos(a);
    }
    s0 += len;
  }
  T = { pcs, total: s0, ex: x, ey: y, ea: a, uin: -1 };
  TRK.set(leg, T);
  return T;
}
function trkAt(leg, u, o) {
  const T = trkBuild(leg);
  if (u <= 0 || !T.pcs.length) { o.x = leg.x + Math.cos(leg.a) * u; o.y = leg.y + Math.sin(leg.a) * u; o.a = leg.a; return o; }
  if (u >= T.total) { const s = u - T.total; o.x = T.ex + Math.cos(T.ea) * s; o.y = T.ey + Math.sin(T.ea) * s; o.a = T.ea; return o; }
  let pc = T.pcs[0];
  for (let i = 1; i < T.pcs.length; i++) { if (T.pcs[i].s0 <= u) pc = T.pcs[i]; else break; }
  const s = u - pc.s0;
  if (!pc.rad) { o.x = pc.x + Math.cos(pc.a) * s; o.y = pc.y + Math.sin(pc.a) * s; o.a = pc.a; }
  else {
    const sg = pc.rad > 0 ? 1 : -1, R = Math.abs(pc.rad), a2 = pc.a + (sg * s) / R;
    o.x = pc.cx + sg * R * Math.sin(a2); o.y = pc.cy - sg * R * Math.cos(a2); o.a = a2;
  }
  return o;
}
// first arc length at which the leg is inside the field (emergence point)
function trkEntry(leg) {
  const T = trkBuild(leg);
  if (T.uin >= 0) return T.uin;
  const o = {};
  let u = 0;
  for (; u < T.total; u += 3) { trkAt(leg, u, o); if (o.x > 2 && o.x < FIELD_W - 2 && o.y > 2 && o.y < FIELD_H - 2) break; }
  T.uin = u;
  return u;
}
// head time: frozen once the dying sequence starts (the body then slides into view, see wyrmDie*)
function wyrmTime(h, t) {
  if (h.tD === undefined) return t;
  const td = (h.tD - h.t0) / 60;
  return t < td ? t : td;
}
// Dying: the frozen serpent slides so its centroid sits inside the field, and writhes.
// Derived only from the legs + the phase tick, so every peer computes the same offset.
function wyrmDieOff(h, sim) {
  if (h.tD === undefined) return null;
  if (!h._dieOff || h._dieOff.tD !== h.tD) {
    const td = (h.tD - h.t0) / 60, sp = meta(sim, 'wyrm').segSpacing, o = {};
    let sx = 0, sy = 0;
    for (let k = 0; k <= Y_NSEG; k++) { wyrmPose(h.p.L, td, k * sp, o); sx += o.x; sy += o.y; }
    const cx = sx / (Y_NSEG + 1), cy = sy / (Y_NSEG + 1);
    h._dieOff = { tD: h.tD, dx: clamp(cx, 60, FIELD_W - 60) - cx, dy: clamp(cy, 80, 210) - cy };
  }
  const u = smooth(clamp((sim.tick - h.tD) / 50, 0, 1));
  return [h._dieOff.dx * u, h._dieOff.dy * u, u];
}
function wyrmPose(L, t, d, o) {
  if (!L || !L.length) { o.x = CX; o.y = -300; o.a = HALF; return o; }
  let i = 0;
  for (let j = 0; j < L.length; j++) if (L[j].k / 60 <= t) i = j;
  const leg = L[i];
  const u = leg.v * (t - leg.k / 60) - d;
  if (u < 0 && i > 0) { const pl = L[i - 1]; return trkAt(pl, (pl.v * (leg.k - pl.k)) / 60 + u, o); }
  return trkAt(leg, u, o);
}
const POSE = { x: 0, y: 0, a: 0 };
function wyrmHeadPath(e, t, sim) {
  wyrmPose(e.p.L, wyrmTime(e, t), 0, POSE);
  e.x = POSE.x; e.y = POSE.y; e.face = POSE.a;
  const off = sim && wyrmDieOff(e, sim);
  if (off) { e.x += off[0]; e.y += off[1]; }
}
function wyrmBodyPath(e, t, sim) {
  const h = sim.enemies.get(e.parent);
  if (!h) return;
  wyrmPose(h.p.L, wyrmTime(h, (sim.tick - h.t0) / 60), e.p.d || 19, POSE);
  e.x = POSE.x; e.y = POSE.y; e.face = POSE.a;
  const off = wyrmDieOff(h, sim);
  if (off) {
    const w = Math.sin((e.p.k || 0) * 0.9 - sim.tick * 0.22) * 4 * off[2];
    e.x += off[0] - Math.sin(POSE.a) * w; e.y += off[1] + Math.cos(POSE.a) * w;
  }
}

// leg builders
const roundLeg = (l) => ({ k: l.k, t: l.t, v: r2(l.v), x: r2(l.x), y: r2(l.y), a: r5(l.a), c: l.c.map(r3) });
function legCoil(v, loops, cx, cy, R, exitRight) {
  const c = [cy + 70, 0];
  for (let i = 0; i < loops; i++) c.push(TAU * R, R, TAU * R, -R);
  c.push(PI * R, exitRight ? -R : R, cy + 160, 0);
  return { t: 'coil', v, x: cx, y: -70, a: HALF, c };
}
function legWeave(v, side, y, r, beta, n) {
  const c = [40, 0, r * beta, r];
  let sg = -1;
  for (let i = 0; i < n; i++) { c.push(2 * r * beta, sg * r); sg = -sg; }
  c.push(r * beta, sg * r, 180, 0);
  return { t: 'weave', v, x: side < 0 ? -60 : FIELD_W + 60, y, a: side < 0 ? 0 : PI, c };
}
function legDive(v, x0, r, beta, n) {
  const c = [50, 0, r * beta, r];
  let sg = -1;
  for (let i = 0; i < n; i++) { c.push(2 * r * beta, sg * r); sg = -sg; }
  c.push(r * beta, sg * r, 220, 0);
  return { t: 'dive', v, x: x0, y: -70, a: HALF, c };
}
function legHook(v, side, y, R) {
  return { t: 'hook', v, x: side < 0 ? -60 : FIELD_W + 60, y, a: side < 0 ? 0 : PI, c: [180, 0, PI * R, side < 0 ? R : -R, 260, 0] };
}
function legLunge(v, side, y0, y1) {
  const x0 = side < 0 ? -60 : FIELD_W + 60, x1 = side < 0 ? FIELD_W + 60 : -60;
  const a = Math.atan2(y1 - y0, x1 - x0);
  return { t: 'lunge', v, x: x0, y: y0, a, c: [Math.hypot(x1 - x0, y1 - y0), 0] };
}
const Y_SEQ = ['weave', 'dive', 'coil', 'hook', 'dive', 'weave', 'coil', 'hook'];
const Y_SEQ3 = ['dive', 'lunge', 'weave', 'dive', 'hook', 'lunge', 'coil'];
function wyrmBodyLen(sim) { const M = meta(sim, 'wyrm'); return M.segSpacing * Y_NSEG + Math.round(M.segSpacing * 0.8); }
function wyrmMakeLeg(e, sim) {
  const d = e.data, ph = e.phase < 0 ? 2 : e.phase, rng = sim.rng;
  const sp = [1, 1.15, 1.35][ph];
  const seq = ph >= 2 ? Y_SEQ3 : Y_SEQ;
  const kind = seq[(d.seq = (d.seq ?? -1) + 1) % seq.length];
  const side = rng.next() < 0.5 ? -1 : 1;
  const tg = sim.targetPlayer(e, 'rand');
  const px = tg ? tg.x : CX;
  switch (kind) {
    case 'coil': return legCoil(72 * sp, ph >= 2 ? 1 : 2, CX, 92 + rng.next() * 28, 44 + rng.next() * 6, rng.next() < 0.5);
    case 'weave': return legWeave(100 * sp, side, 56 + rng.next() * 90, 58, 1.0, 3);
    case 'dive': return legDive(118 * sp, clamp(px + (rng.next() - 0.5) * 110, 46, FIELD_W - 46), 70, 0.9, 3);
    case 'hook': return legHook(96 * sp, side, 36 + rng.next() * 40, 52 + rng.next() * 16);
    default: return legLunge(175, side, 40 + rng.next() * 50, 170 + rng.next() * 70);
  }
}
function wyrmPlan(e, sim, t, force) {
  const d = e.data, L = e.p.L;
  const last = L[L.length - 1];
  if (!force && (t < last.k / 60 || d.after === last)) return;   // plan once the newest leg has started
  const base = force ? L[L.length - 2] || last : last;
  const T = trkBuild(base);
  const gap = [0.8, 0.6, 0.4][Math.max(0, e.phase)] ?? 0.6;
  const endT = base.k / 60 + (T.total + wyrmBodyLen(sim) + 30) / base.v;
  const leg = wyrmMakeLeg(e, sim);
  leg.k = Math.round((endT + gap) * 60);
  const keep = force ? L.slice(0, -1) : L;
  const nl = keep.slice(-2).concat([roundLeg(leg)]);
  sim.setParams(e, { L: nl });
  d.after = base;
}
const Y_MOLTEN = [[2, 4, 6, 8, 10], [1, 2, 4, 5, 6, 8, 9, 10], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]];
function wyrmArmor(e, sim) {
  const set = Y_MOLTEN[Math.max(0, e.phase)] || [];
  for (const c of sim.elist) {
    if (!c.alive || c.parent !== e.id) continue;
    c.armor = e.phase === DYING || !e._settled || c.p.role !== 'seg' || !set.includes(c.p.k);
  }
  e.armor = e.phase === DYING || !e._settled;
}
function mouthOf(sim, e) {
  const M = meta(sim, 'wyrm'), a = (e.face ?? HALF) + HALF;
  const c = Math.cos(a), s = Math.sin(a);
  return [r2(M.mouth[0] * c - M.mouth[1] * s), r2(M.mouth[0] * s + M.mouth[1] * c)];
}
function yBreath(e, sim) {
  if (!onField(e, 12, 280)) return;
  const mo = mouthOf(sim, e), a = e.face ?? HALF;
  if (!canFire(e, sim, 290, 56, mo[0], mo[1])) return;
  const ph = Math.max(0, e.phase);
  if (Math.cos(a - HALF) > 0.34) sim.fire(e, 'fan', { a: r3(a), n: dens(sim, [5, 7, 7][ph]), spread: 0.85, v: 1.25, spr: 'eb_orb_o' }, mo);
  else fireAt(e, sim, 'lines', { ways: 3, spread: 0.5, per: 2, v: 1.45, dv: 0.3, spr: 'eb_needle_o' }, mo);
}
function yCluster(e, sim) {
  if (!onField(e, 12, 260)) return;
  const mo = mouthOf(sim, e);
  if (!canFire(e, sim, 270, 60, mo[0], mo[1])) return;
  const ph = Math.max(0, e.phase);
  fireAt(e, sim, 'cluster', { n: [1, 2, 3][ph], spread: 0.7, v: 1.7, t: 50, ringN: dens(sim, 10), ringV: 1.0, spr: 'eb_big_o', ringSpr: 'eb_small_o' }, mo);
}
function ySpit(e, sim) {
  const segs = kids(e, sim, 'seg');
  for (const s of segs) {
    if (s.armor) continue;
    later(e, sim, 1 + s.p.k * 6, () => {
      if (!s.alive || s.armor || !onField(s, 8, 300) || !canFire(s, sim, 300, 40)) return;
      sim.fire(s, 'fountain', { n: dens(sim, 3), a: -HALF, spread: 1.3, v: 1.15, vj: 0.4, grav: 0.014, spr: 'eb_small_o' });
    });
  }
}
function ySpiral(e, sim) {
  if (!onField(e, 16, 250) || !canFire(e, sim, 260, 56)) return;
  sim.fire(e, 'spiral', { arms: 2, v: 1.05, every: 7, count: 22, da: 0.33, a0: r3(sim.rng.next() * TAU), spr: 'eb_small_o', follow: 1 });
}
const Y_SCRIPT = {
  0: { len: 480, steps: [[0, 'breath', yBreath], [96, 'breath', yBreath], [140, 'spit', ySpit], [192, 'breath', yBreath], [240, 'cluster', yCluster], [288, 'breath', yBreath], [380, 'spit', ySpit], [384, 'breath', yBreath]] },
  1: { len: 420, steps: [[0, 'breath', yBreath], [60, 'spit', ySpit], [80, 'breath', yBreath], [120, 'cluster', yCluster], [160, 'breath', yBreath], [240, 'breath', yBreath], [260, 'spit', ySpit], [300, 'cluster', yCluster], [320, 'breath', yBreath]] },
  2: { len: 360, steps: [[0, 'breath', yBreath], [40, 'spit', ySpit], [60, 'breath', yBreath], [90, 'cluster', yCluster], [120, 'breath', yBreath], [150, 'spiral', ySpiral], [180, 'breath', yBreath], [200, 'spit', ySpit], [240, 'breath', yBreath], [270, 'cluster', yCluster], [300, 'breath', yBreath]] },
};
function wyrmBrain(e, sim, t) {
  runLater(e, sim);
  if (e.phase === DYING) { wyrmDie(e, sim); return; }
  const th = wyrmTime(e, t);
  wyrmPlan(e, sim, th, false);
  const lt = sim.tick - e.t0, tin = tinTicks(e);
  if (!e.data.settled) {
    if (lt === 130) sim.cue('roar', null, e);
    if (lt >= tin) { e.data.settled = true; sim.cue('settle', null, e); }
    return;
  }
  wyrmShare(e, sim);
  if (e.hp <= resHp(e)) { sim.setPhase(e, DYING); return; }
  const f = effFrac(e);
  const want = f > 0.7 ? 0 : f > 0.35 ? 1 : 2;
  if (want > e.phase) {
    sim.setPhase(e, want);
    const L = e.p.L, last = L[L.length - 1];
    if (last.k / 60 > th + 1.6) wyrmPlan(e, sim, th, true);   // re-plan the queued leg at the new speed
    return;
  }
  runScript(e, sim, Y_SCRIPT[e.phase]);
  // enraged: magma rain while the wyrm is burrowed
  if (e.phase >= 1) {
    const d = e.data;
    if ((d.rainT || 0) <= sim.tick && sim.tick % 20 === 0) {
      const any = [e, ...kids(e, sim)].some((c) => c.x > -12 && c.x < FIELD_W + 12 && c.y > -12 && c.y < FIELD_H + 12);
      if (!any) {
        d.rainT = sim.tick + 240;
        sim.fire(e, 'rain', { count: e.phase >= 2 ? 22 : 14, every: 5, v: 1.1, vj: 0.35, spr: 'eb_small_o' });
      }
    }
  }
}
// HOST: molten segments share the wyrm's life — damage they take also burns the head
function wyrmShare(e, sim) {
  let d = 0;
  for (const c of sim.elist) {
    if (!c.alive || c.parent !== e.id || c.p.role !== 'seg') continue;
    const prev = c.data.hp0 ?? c.maxHp;
    if (c.hp < prev) { d += prev - c.hp; c.data.hp0 = c.hp; }
  }
  if (e.data.lost) { d += e.data.lost; e.data.lost = 0; }
  if (d > 0 && e.phase !== DYING) { e.hp -= d * Y_SHARE; sim.hpDirty.add(e.id); }
}
function wyrmDie(e, sim) {
  const k = sim.tick - e.phaseT0, dur = 190;
  if (k >= dur) { sim.kill(e, -1); return; }
  if (k % 11 === 5) {
    // blow the body apart from the tail toward the head
    const body = kids(e, sim).sort((a, b) => (b.p.d || 0) - (a.p.d || 0));
    const c = body[0];
    if (c) { sim.cue('pop', [r2(c.x), r2(c.y), 2], e); sim.kill(c, -1, true); }
    else sim.cue('pop', [r2(e.x + (sim.rng.next() - 0.5) * 20), r2(e.y + (sim.rng.next() - 0.5) * 20), 1], e);
  }
}
function wyrmPhase(e, ph, sim) {
  if (ph === DYING) { e.tD = e.phaseT0; dyingFx(e, sim, 'ember'); }
  else {
    phaseFx(e, sim, 'ember', ph >= 2);
    sim.env.sfx('boss_roar', { x: e.x, vol: 1, pitch: ph >= 2 ? 3 : 0 });
    for (const c of kids(e, sim, 'seg')) sim.env.fx.spark?.(c.x, c.y, -HALF, 'ember', 3);
  }
  wyrmArmor(e, sim);
}
function wyrmHp(e, sim) {
  if (e.phase === DYING) return 0;
  return (effHp(e) + kidsHp(e, sim, ['seg'])) / (effMax(e) + Y_NSEG * Y_SEG * hpMul(e));
}

// emergence telegraph + fx for every leg (all peers, from the leg data)
const POSE2 = { x: 0, y: 0, a: 0 };
function wyrmLegFx(e, ctx, lctx, sim) {
  const L = e.p.L;
  if (!L) return;
  const last = lastTick(e, 'em', sim);
  for (const leg of L) {
    const uin = trkEntry(leg);
    const tin = e.t0 + leg.k + Math.round((uin / leg.v) * 60);
    const dt = tin - sim.tick;
    trkAt(leg, uin, POSE2);
    // marker kept inside the field and below the HUD boss bar strip
    const ex = clamp(POSE2.x, 8, FIELD_W - 8), ey = clamp(POSE2.y, 34, FIELD_H - 8);
    if (dt > 0 && dt < 84 && e.phase !== DYING) {
      const k = 1 - dt / 84, pulse = 0.5 + 0.5 * Math.sin(sim.tick * 0.5);
      glow(sim, lctx, ex, ey, 10 + 14 * k, COL.o, 0.3 + 0.5 * k * (0.6 + 0.4 * pulse));
      dotRing(ctx, ex, ey, 14 - 8 * k, 10, sim.tick * 0.1, COL.o, 0.4 + 0.5 * k, 2);
      dotRing(lctx, ex, ey, 14 - 8 * k, 10, sim.tick * 0.1, COL.hot, 0.3 + 0.5 * k, 2);
      // flowing preview of the coming path: a danger corridor (rails at the body's width) for
      // dives / lunges through the field, a center line for the others
      const reach = leg.t === 'dive' ? 440 : leg.t === 'lunge' ? 340 : 200;
      const wide = leg.t === 'dive' || leg.t === 'lunge';
      const o = {}, flow = (sim.tick * 1.5) % 8;
      for (let u = uin + flow; u < uin + reach * Math.min(1, k * 1.6); u += 8) {
        trkAt(leg, u, o);
        const f = 1 - (u - uin) / reach, a = (0.35 + 0.55 * k) * (0.35 + 0.65 * f);
        const px = Math.round(o.x), py = Math.round(o.y);
        lctx.globalAlpha = a; lctx.fillStyle = COL.o; lctx.fillRect(px - 1, py - 1, 2, 2);
        ctx.globalAlpha = a * 0.8; ctx.fillStyle = COL.hot; ctx.fillRect(px, py, 1, 1);
        if (wide) {
          const nx = -Math.sin(o.a) * 14, ny = Math.cos(o.a) * 14;
          lctx.fillRect(Math.round(o.x + nx), Math.round(o.y + ny), 1, 1);
          lctx.fillRect(Math.round(o.x - nx), Math.round(o.y - ny), 1, 1);
          ctx.fillStyle = COL.o;
          ctx.fillRect(Math.round(o.x + nx), Math.round(o.y + ny), 1, 1);
          ctx.fillRect(Math.round(o.x - nx), Math.round(o.y - ny), 1, 1);
        }
        lctx.globalAlpha = 1; ctx.globalAlpha = 1;
      }
      if (wide && crossed(last, sim.tick, tin - 80)) sim.env.sfx('boss_roar', { x: ex, vol: 0.45, pitch: 6 });
      if ((sim.tick % 5) === 0) sim.env.fx.spark?.(ex, ey, POSE2.a + PI, 'ember', 1);
      if (crossed(last, sim.tick, tin - 60)) sim.env.sfx('enemy_laser_charge', { x: ex, vol: 0.45, pitch: -12 });
    }
    if (crossed(last, sim.tick, tin)) {
      const fx = sim.env.fx;
      fx.explode(ex, ey, 'medium', { palette: 'ember' });
      fx.debris?.(ex, ey, 7, 'ember');
      fx.shockwave?.(ex, ey, 40, 'ember');
      sim.env.sfx('explode_large', { x: ex, vol: 0.7 });
      sim.env.shake(3, 0.35);
    }
  }
}
function wyrmHeadDraw(e, ctx, lctx, sim) {
  wyrmLegFx(e, ctx, lctx, sim);
  let x = e.x, y = e.y;
  if (e.phase === DYING) { const k = clamp((sim.tick - e.phaseT0) / 190, 0, 1); x += jit(sim.tick, 3) * 2 * k; y += jit(sim.tick, 4) * 2 * k; }
  if (x < -30 || x > FIELD_W + 30 || y < -30 || y > FIELD_H + 30) return;
  const sc = Y_SCRIPT[Math.max(0, e.phase)];
  const open = Math.max(tele(stepClock(e, sim, sc, 'breath'), 22, 8), tele(stepClock(e, sim, sc, 'cluster'), 26, 8), tele(stepClock(e, sim, sc, 'spiral'), 26, 30));
  const a = e.face ?? HALF, dir = a + HALF;
  if (e.phase >= 2 || e.phase === DYING) glow(sim, lctx, x, y, 22 + 3 * Math.sin(sim.tick * 0.2), COL.o, 0.35);
  sp(sim, ctx, lctx, 'boss_wyrm_head', open > 0.15 ? 1 : 0, x, y, dir, false, 1, e.flash > 0);
  const M = meta(sim, 'wyrm');
  const c = Math.cos(dir), s = Math.sin(dir);
  if (open > 0.05) {
    const mx = x + M.mouth[0] * c - M.mouth[1] * s, my = y + M.mouth[0] * s + M.mouth[1] * c;
    glow(sim, lctx, mx, my, 5 + 9 * open, open > 0.8 ? COL.hot : COL.o, 0.35 + 0.6 * open);
  }
  for (const [ex, ey] of M.eyes) glow(sim, lctx, x + ex * c - ey * s, y + ex * s + ey * c, 3, e.phase >= 2 ? COL.w : COL.o, 0.55);
  if ((sim.tick & 3) === 0) sim.env.fx.trail?.(x - Math.cos(a) * 14, y - Math.sin(a) * 14, 'ember', e.phase >= 2 ? 2 : 1);
}
function wyrmSegDraw(e, ctx, lctx, sim) {
  const h = sim.enemies.get(e.parent);
  let x = e.x, y = e.y;
  if (h && h.phase === DYING) { const k = clamp((sim.tick - h.phaseT0) / 190, 0, 1); x += jit(sim.tick, e.p.k) * 2.5 * k; y += jit(sim.tick, e.p.k + 9) * 2.5 * k; }
  if (x < -30 || x > FIELD_W + 30 || y < -30 || y > FIELD_H + 30) return;
  if (e.p.role === 'tail') {
    sp(sim, ctx, lctx, 'boss_wyrm_tail', 0, x, y, (e.face ?? HALF) + PI + HALF, false, 1, e.flash > 0);
    return;
  }
  const molten = !e.armor;
  // magma tether across a severed gap (to the next body part toward the head)
  if (h && e.p.k > 1) {
    let prev = null, best = 0;
    for (const c of sim.elist) if (c.alive && c.parent === h.id && c.p.role === 'seg' && c.p.k < e.p.k && c.p.k > best) { best = c.p.k; prev = c; }
    if (best < e.p.k - 1) {
      const tx = prev ? prev.x : h.x, ty = prev ? prev.y : h.y;
      dotLine(lctx, x, y, tx, ty, 3, sim.tick >> 1, COL.o, 0.55);
      dotLine(ctx, x, y, tx, ty, 3, (sim.tick >> 1) + 1, RAMPS.ember[2], 0.8);
    }
  }
  const vars = meta(sim, 'wyrm').segVariants || ['boss_wyrm_seg'];
  let sn = vars[(e.p.k || 0) % vars.length];
  if (!hasSp(sim, sn)) sn = 'boss_wyrm_seg';
  sp(sim, ctx, lctx, sn, molten ? 1 : 0, x, y, (e.face ?? -HALF) + HALF, false, 1, e.flash > 0);
  if (molten && h) {
    const g = tele(stepClock(h, sim, Y_SCRIPT[Math.max(0, h.phase)], 'spit'), 30, 10);
    const k = 0.5 + 0.5 * Math.sin(sim.tick * 0.12 + e.p.k);
    glow(sim, lctx, x, y, 9 + 3 * k + 6 * g, g > 0.5 ? COL.hot : COL.o, 0.3 + 0.2 * k + 0.4 * g);
    if ((sim.tick + e.p.k * 3) % 17 === 0) sim.env.fx.spark?.(x, y - 4, -HALF, 'ember', 1);
  }
}

ENEMIES.wyrm = {
  spr: 'boss_wyrm_head', hp: Y_HEAD + Y_RES, res: Y_RES / (Y_HEAD + Y_RES), r: 15, score: 70000,
  boss: true, bar: true, name: 'CINDER WYRM', z: 6, move: 'wyrmHead', paths: { wyrmHead: wyrmHeadPath },
  explode: 'boss', palette: 'ember', odGain: 0.5, drops: BOSS_DROPS(16, 7),
  hpFn: wyrmHp, brain: wyrmBrain, onPhase: wyrmPhase, draw: wyrmHeadDraw,
  onSpawn(e, sim) { e.armor = true; bgBoss(sim, true); },
  onDeath(e, sim) { bigDeath(e, sim, 'ember', 140, [[-16, -10, 'large'], [14, 12, 'medium'], [0, 20, 'medium']]); },
  cues: {
    roar: roarCue('ember'),
    settle(e, sim) { e._settled = true; e.data.settled = true; wyrmArmor(e, sim); for (const c of kids(e, sim, 'seg')) if (!c.armor) sim.env.fx.spark?.(c.x, c.y, -HALF, 'ember', 3); },
    pop: popCue('ember'),
  },
};
const Y_SEG_DEF = {
  spr: 'boss_wyrm_seg', hp: Y_SEG, r: 12, score: 1500, z: 5, move: 'wyrmBody', paths: { wyrmBody: wyrmBodyPath },
  explode: 'medium', palette: 'ember', odGain: 0.08, drops: { gem: 2, power: 0.12 },
  noPredict: true, onSpawn(e) { e.armor = true; }, draw: wyrmSegDraw,
  onKill(e, sim) { const h = sim.enemies.get(e.parent); if (h) h.data.lost = (h.data.lost || 0) + Math.max(0, e.data.hp0 ?? e.maxHp); },
  onDeath(e, sim) { sim.env.fx.debris?.(e.x, e.y, 6, 'ember'); sim.env.fx.shockwave?.(e.x, e.y, 30, 'ember'); },
};
// one def per body index: z descends along the body (head on top, tail at the bottom)
for (let k = 1; k <= Y_NSEG; k++) ENEMIES['wyrm_seg' + k] = Object.assign({}, Y_SEG_DEF, { z: 5 - k * 0.1 });
ENEMIES.wyrm_tail = {
  spr: 'boss_wyrm_tail', hp: 1, hpScale: false, armor: true, r: 8, score: 0, z: 3, move: 'wyrmBody', paths: { wyrmBody: wyrmBodyPath },
  explode: 'medium', palette: 'ember', drops: {}, draw: wyrmSegDraw,
};

function spawnWyrm(sim) {
  const M = meta(sim, 'wyrm');
  const leg0 = legCoil(70, 1, CX, 104, 46, false);
  leg0.k = 100;
  const tin = (leg0.k + ((104 + 70 + PI * 46) / 70) * 60) / 60;
  const e = sim.spawn('wyrm', { L: [roundLeg(leg0)], tin: r2(tin) });
  if (!e) return null;
  for (let k = 1; k <= Y_NSEG; k++) {
    sim.spawn('wyrm_seg' + k, { role: 'seg', k, d: k * M.segSpacing }, e.id);
  }
  sim.spawn('wyrm_tail', { role: 'tail', k: Y_NSEG + 1, d: Y_NSEG * M.segSpacing + Math.round(M.segSpacing * 0.8) }, e.id);
  return e;
}


// =======================================================================================
// 3. PRISM ARRAY — crystal core with orbiting shards (S3)
// Orbit angle: piecewise-linear schedule root.p.rs = [[t0 (s since root spawn), a0, w (rad/s)], …].
// Teleports: root.p {bx,by} → {ax,ay} at absolute tick wk (fade out before, in after).
// =======================================================================================

const P_CORE = 2800, P_RES = 220, P_SH1 = 170, P_SH2 = 80;
function pwAngle(rs, t) {
  if (!rs || !rs.length) return 0;
  let s = rs[0];
  for (const r of rs) if (r[0] <= t) s = r;
  return s[1] + s[2] * (t - s[0]);
}
function pwRate(rs, t) {
  if (!rs || !rs.length) return 0;
  let s = rs[0];
  for (const r of rs) if (r[0] <= t) s = r;
  return s[2];
}
function prismCorePath(e, t, sim) {
  const p = e.p, tick = sim.tick;
  let ax = p.ax ?? CX, ay = p.ay ?? 100;
  // before the jump tick: the previous anchor (also frozen there if it started dying first)
  if (p.wk !== undefined && (tick < p.wk || (e.tD !== undefined && e.tD < p.wk))) { ax = p.bx ?? ax; ay = p.by ?? ay; }
  const k = smooth(clamp(t / 2, 0, 1));
  const amp = e.phase >= 1 ? 20 : 30;
  e.x = ax + amp * Math.sin(t * 0.5) * k;
  e.y = ay + 9 * Math.sin(t * 0.83) * k;
}
function prismShardPath(e, t, sim) {
  const par = sim.enemies.get(e.parent);
  if (!par) return;
  const p = e.p;
  const tr = (sim.tick - par.t0) / 60;
  const ang = pwAngle(par.p.rs, tr) + (p.k * TAU) / (p.n || 6);
  const R = (p.R || 40) * easeOut(clamp(t / (p.gr || 1.5), 0, 1));
  e.x = par.x + Math.sin(ang) * R;
  e.y = par.y - Math.cos(ang) * R * (p.ey || 0.62);
  e.oa = ang;
  e.face = ang - HALF;
  e.armor = par.phase === DYING || !par._settled || t < (p.gr || 1.5);
}
function prismArmor(e) { e.armor = e.phase === DYING || e.phase === 0; }
function prismFade(e, sim) {
  const p = e.p;
  if (p.wk === undefined || (e.tD !== undefined && e.tD < p.wk)) return 1;
  const d = sim.tick - p.wk;
  if (d < -30 || d > 24) return 1;
  return d < 0 ? clamp(-d / 30, 0, 1) : clamp(d / 24, 0, 1);
}
// ---- host attacks
function pShards(e, sim) { return kids(e, sim, 'shard').filter((s) => !s.armor); }
function pRefract(e, sim) {
  let i = 0;
  for (const s of pShards(e, sim)) {
    later(e, sim, 1 + i++ * 5, () => {
      if (!s.alive || !canFire(s, sim, 300, 44)) return;
      fireAt(s, sim, 'refract', { n: 1, v: 1.85, t: 32, split: dens(sim, 3), sp: 0.9, v2: 1.3, spr: 'eb_needle_c' });
    });
  }
}
function pWheel(e, sim) {
  const sh = pShards(e, sim);
  if (!sh.length) return;
  const warn = 54, tr = (sim.tick - e.t0) / 60, tf = tr + warn / 60;
  const w = pwRate(e.p.rs, tf), base = pwAngle(e.p.rs, tf);
  for (const s of sh) {
    const ang = base + (s.p.k * TAU) / (s.p.n || 6);
    sim.fire(s, 'beam', { a: r5(ang - HALF), av: r5(w / 60), avT: 300, w: 7, warn, dur: e.phase >= 2 ? 100 : 120, len: 420, pal: 'crystal', follow: 1 });
  }
  sim.cue('hum', null, e);
}
function pShardRings(e, sim) {
  for (const s of pShards(e, sim)) {
    if (!canFire(s, sim, 320, 40)) continue;
    sim.fire(s, 'ring', { n: dens(sim, 6), v: 1.05, a0: r3(s.oa || 0), spr: 'eb_small_c' });
  }
}
function pAimRing(e, sim) { if (canFire(e, sim, 300, 50)) fireAt(e, sim, 'aimRing', { n: dens(sim, 16), v: 1.0, spr: 'eb_orb_c' }); }
function pTeleport(e, sim) {
  const ANCH = [[CX, 96], [70, 88], [170, 88], [88, 128], [152, 128], [CX, 70], [60, 118], [180, 118]];
  const p = e.p, rng = sim.rng;
  const cur = [p.ax ?? CX, p.ay ?? 100];
  let pick = null;
  for (let tries = 0; tries < 12 && !pick; tries++) {
    const c = ANCH[Math.floor(rng.next() * ANCH.length)];
    if (Math.hypot(c[0] - cur[0], c[1] - cur[1]) < 40) continue;
    let ok = true;
    for (const pl of sim.players) if (pl && pl.alive && !pl.down && Math.hypot(pl.x - c[0], pl.y - c[1]) < 96) ok = false;
    if (ok) pick = c;
  }
  if (!pick) return;
  const wk = sim.tick + 30;
  sim.setParams(e, { bx: cur[0], by: cur[1], ax: pick[0], ay: pick[1], wk });
  later(e, sim, 32, () => {
    if (e.phase === DYING || sim.state !== 'play') return;
    sim.fire(e, 'implode', { n: dens(sim, e.phase >= 2 ? 20 : 18), r: 84, v: 0.95, delay: 40, a0: r3(rng.next() * TAU), spr: 'eb_small_c' });
  });
}
function pPetal(e, sim) {
  if (canFire(e, sim, 300, 50)) sim.fire(e, 'petal', { n: dens(sim, 6), per: 6, width: 0.6, v: 0.9, dv: 0.6, curl: 0.014, a0: r3(sim.rng.next() * TAU), spr: 'eb_small_c' });
}
function pLaserFan(e, sim) {
  fireAt(e, sim, 'laserFan', { n: 3, spread: 1.1, w: 8, warn: 50, dur: 70, av: 0.006, mirror: 1, avT: 60, len: 440, pal: 'crystal', follow: 1 });
}
function pStopAim(e, sim) {
  if (canFire(e, sim, 300, 50)) fireAt(e, sim, 'stopAim', { n: dens(sim, 14), v: 1.5, stopT: 30, hold: 20, v2: 2.0, spr: 'eb_orb_c', spr2: 'eb_needle_c' });
}
function pCoreRefract(e, sim) {
  if (canFire(e, sim, 300, 50)) fireAt(e, sim, 'refract', { n: dens(sim, 5), spread: 0.9, v: 1.8, t: 36, split: 2, sp: 0.7, v2: 1.4, spr: 'eb_needle_c' });
}
function pCross(e, sim) {
  if (canFire(e, sim, 320, 50)) sim.fire(e, 'crossSpiral', { arms: 3, v: 1.0, every: 7, count: 26, da: 0.19, a0: r3(sim.rng.next() * TAU), spr: 'eb_small_c', spr2: 'eb_small_v', follow: 1 });
}
function pAccel(e, sim) {
  if (canFire(e, sim, 320, 50)) sim.fire(e, 'accelRing', { n: dens(sim, 20), layers: 2, v0: 0.2, acc: 0.03, vmax: 1.9, a0: r3(sim.rng.next() * TAU), spr: 'eb_orb_c' });
}
const P_SCRIPT = {
  0: { len: 480, steps: [[0, 'refract', pRefract], [110, 'wheel', pWheel], [300, 'core', pAimRing], [380, 'rings', pShardRings]] },
  1: { len: 540, steps: [[0, 'warp', pTeleport], [120, 'core', pPetal], [200, 'fan', pLaserFan], [320, 'core', pStopAim], [420, 'core', pCoreRefract]] },
  2: { len: 600, steps: [[0, 'warp', pTeleport], [100, 'wheel', pWheel], [300, 'core', pCross], [420, 'refract', pRefract], [500, 'core', pAccel]] },
};
function prismBrain(e, sim) {
  runLater(e, sim);
  if (e.phase === DYING) { dieBrain(e, sim, { dur: 170, rx: 26, ry: 34, eat: ['shard'], grow: 0.5 }); return; }
  const lt = sim.tick - e.t0, tin = tinTicks(e);
  if (!e.data.settled) {
    if (lt === 20) sim.cue('roar', null, e);
    if (lt >= tin) { e.data.settled = true; sim.cue('settle', null, e); }
    return;
  }
  if (e.hp <= resHp(e)) { sim.setPhase(e, DYING); return; }
  if (e.phase === 0) {
    const sh = kids(e, sim, 'shard');
    if (!sh.length) { sim.setPhase(e, 1); return; }
    if (sim.tick - settledAt(e) > 40 * 60) {
      for (const c of sh) { sim.cue('pop', [r2(c.x), r2(c.y), 2], e); sim.kill(c, -1, true); }
      sim.setPhase(e, 1);
      return;
    }
  } else if (e.phase === 1 && effFrac(e) <= 0.5) {
    sim.setPhase(e, 2);
    // the array regrows: 4 new shards, faster reverse rotation
    const tr = (sim.tick - e.t0) / 60, t1 = r3(tr + 0.25);
    sim.setParams(e, { rs: [e.p.rs[e.p.rs.length - 1], [t1, r5(pwAngle(e.p.rs, t1)), -0.4]] });
    const M = meta(sim, 'prism');
    for (let k = 0; k < 4; k++) sim.spawn('prism_shard2', { role: 'shard', set: 2, k, n: 4, R: M.shardOrbitR + 14, ey: 0.66, gr: 1.8 }, e.id);
    return;
  }
  runScript(e, sim, P_SCRIPT[e.phase]);
}
function prismPhase(e, ph, sim) {
  const fx = sim.env.fx;
  if (ph === DYING) { e.tD = e.phaseT0; dyingFx(e, sim, 'crystal'); }
  else if (ph === 1) {
    phaseFx(e, sim, 'crystal', true);
    // the refraction shield shatters
    for (let i = 0; i < 10; i++) fx.spark?.(e.x, e.y, (i / 10) * TAU, 'crystal', 3);
    fx.debris?.(e.x, e.y, 10, 'crystal');
    sim.env.sfx('explode_large', { x: e.x, vol: 0.8, pitch: 5 });
  } else if (ph === 2) {
    phaseFx(e, sim, 'crystal', true);
    sim.env.sfx('boss_roar', { x: e.x, vol: 0.9, pitch: 5 });
    fx.warp?.(e.x, e.y, 'crystal');
  }
  prismArmor(e);
}
function prismHp(e, sim) {
  if (e.phase === DYING) return 0;
  const hm = hpMul(e);
  const pend = e.phase < 2 && e.phase !== DYING ? 4 * P_SH2 * hm : 0;
  return (effHp(e) + kidsHp(e, sim, ['shard']) + pend) / (effMax(e) + (6 * P_SH1 + 4 * P_SH2) * hm);
}
function prismShardSprite(s, ctx, lctx, sim, alpha) {
  sp(sim, ctx, lctx, 'boss_prism_shard', 0, s.x, s.y, s.oa || 0, false, alpha, s.flash > 0);
  if (!s.armor) glow(sim, lctx, s.x, s.y, 6, COL.c, 0.25 * alpha);
}
function prismDraw(e, ctx, lctx, sim) {
  const M = meta(sim, 'prism');
  const t = (sim.tick - e.t0) / 60;
  const fade = prismFade(e, sim);
  let x = e.x, y = e.y;
  if (e.phase === DYING) { const k = clamp((sim.tick - e.phaseT0) / 170, 0, 1); x += jit(sim.tick, 5) * 2 * k; y += jit(sim.tick, 6) * 2 * k; }
  // teleport fx (all peers, from the params)
  const p = e.p;
  if (p.wk !== undefined) {
    const last = lastTick(e, 'wk', sim);
    if (crossed(last, sim.tick, p.wk - 30)) { sim.env.fx.warp?.(p.bx ?? x, p.by ?? y, 'crystal'); sim.env.sfx('warp_in', { x, vol: 0.8, pitch: 4 }); }
    if (crossed(last, sim.tick, p.wk)) { sim.env.fx.warp?.(x, y, 'crystal'); sim.env.fx.shockwave?.(x, y, 50, 'crystal'); sim.env.sfx('warp_in', { x, vol: 1 }); }
  }
  const shards = kids(e, sim, 'shard');
  // shards behind the body
  for (const s of shards) if (Math.cos(s.oa || 0) > 0) prismShardSprite(s, ctx, lctx, sim, fade);
  // refraction: inner beams from the eye to shards whose beams are live
  const ids = new Set(shards.map((s) => s.id));
  for (const b of sim.beams.list) {
    if (!ids.has(b.follow)) continue;
    const s = sim.enemies.get(b.follow);
    if (!s) continue;
    const warn = b.age <= b.warn;
    sim.env.fx.drawBeam?.(ctx, lctx, x + M.eye[0], y + M.eye[1], s.x, s.y, warn ? 1 : 3, warn ? 'warn' : 'fire', sim.tick / 60, 'crystal');
  }
  glow(sim, lctx, x, y, 26, COL.c, 0.22 * fade);
  sp(sim, ctx, lctx, 'boss_prism', Math.floor(t * 8), x, y, 0, false, fade, e.flash > 0);
  const sc = P_SCRIPT[Math.max(0, e.phase)];
  const a = Math.max(tele(stepClock(e, sim, sc, 'core'), 30), tele(stepClock(e, sim, sc, 'fan'), 30), tele(stepClock(e, sim, sc, 'wheel'), 40, 20));
  const k = 0.5 + 0.5 * Math.sin(sim.tick * 0.14);
  glow(sim, lctx, x + M.eye[0], y + M.eye[1], (5 + 3 * k + 9 * a) * fade, a > 0.3 ? COL.w : COL.p, (0.5 + 0.5 * a) * fade);
  // refraction shield while the array holds
  if (e.armor && e.phase !== DYING && e._settled) {
    const rot = sim.tick * 0.03;
    ctx.globalAlpha = 0.55 * fade; lctx.globalAlpha = 0.6 * fade;
    for (let i = 0; i < 24; i++) {
      const aa = rot + (i / 24) * TAU;
      const px = Math.round(x + Math.cos(aa) * (M.bodyRx + 7)), py = Math.round(y + Math.sin(aa) * (M.bodyRy + 6));
      ctx.fillStyle = i % 3 ? RAMPS.crystal[3] : RAMPS.crystal[5]; ctx.fillRect(px, py, 1, 1);
      lctx.fillStyle = COL.c; lctx.fillRect(px, py, 1, 1);
    }
    ctx.globalAlpha = 1; lctx.globalAlpha = 1;
  }
}
function prismShardDraw(e, ctx, lctx, sim) {
  const par = sim.enemies.get(e.parent);
  if (Math.cos(e.oa || 0) > 0) return;                  // drawn by the core (behind it)
  prismShardSprite(e, ctx, lctx, sim, par ? prismFade(par, sim) : 1);
  const t = (sim.tick - e.t0) / 60;
  if (t < (e.p.gr || 1.5) && (sim.tick % 4) === 0) sim.env.fx.spark?.(e.x, e.y, (e.oa || 0) - HALF, 'crystal', 1);
}

ENEMIES.prism = {
  spr: 'boss_prism', hp: P_CORE + P_RES, res: P_RES / (P_CORE + P_RES), r: 15, score: 90000,
  boss: true, bar: true, name: 'PRISM ARRAY', z: 5, move: 'prismCore', paths: { prismCore: prismCorePath },
  explode: 'boss', palette: 'crystal', odGain: 0.5, drops: BOSS_DROPS(18, 8), warp: true,
  hpFn: prismHp, brain: prismBrain, onPhase: prismPhase, draw: prismDraw,
  onSpawn(e, sim) { e.armor = true; bgBoss(sim, true); },
  onDeath(e, sim) { bigDeath(e, sim, 'crystal', 160, [[-12, -18, 'large'], [12, 16, 'large'], [0, 0, 'medium']]); for (let i = 0; i < 12; i++) sim.env.fx.spark?.(e.x, e.y, (i / 12) * TAU, 'crystal', 3); },
  cues: {
    roar: roarCue('crystal'),
    settle(e, sim) { e._settled = true; e.data.settled = true; prismArmor(e); sim.env.sfx('boss_phase', { x: e.x, vol: 0.6, pitch: 7 }); },
    hum(e, sim) { sim.env.sfx('enemy_laser_charge', { x: e.x, vol: 0.7, pitch: 5 }); },
    pop: popCue('crystal'),
  },
};
ENEMIES.prism_shard = {
  spr: 'boss_prism_shard', hp: P_SH1, r: 8, score: 2000, z: 6, move: 'prismShard', paths: { prismShard: prismShardPath },
  explode: 'medium', palette: 'crystal', odGain: 0.12, drops: { gem: 2, power: 0.3 },
  onSpawn(e) { e.armor = true; }, draw: prismShardDraw,
  onDeath(e, sim) { const fx = sim.env.fx; fx.debris?.(e.x, e.y, 6, 'crystal'); fx.shockwave?.(e.x, e.y, 36, 'crystal'); for (let i = 0; i < 6; i++) fx.spark?.(e.x, e.y, (i / 6) * TAU, 'crystal', 2); sim.env.sfx('explode_medium', { x: e.x, vol: 0.9, pitch: 6 }); },
};
ENEMIES.prism_shard2 = Object.assign({}, ENEMIES.prism_shard, { hp: P_SH2, score: 1200, drops: { gem: 1, power: 0.15 } });

function spawnPrism(sim) {
  const M = meta(sim, 'prism');
  const e = sim.spawn('prism', { ax: CX, ay: 96, rs: [[0, 0, 0.3]], tin: 2.6 });
  if (!e) return null;
  for (let k = 0; k < 6; k++) sim.spawn('prism_shard', { role: 'shard', set: 1, k, n: 6, R: M.shardOrbitR, ey: 0.62, gr: 1.6 }, e.id);
  return e;
}

// =======================================================================================
// 4. THE DREADNOUGHT — awakening bridge section (S4)
// Root = the bridge (weak point); body center = root - META.bridge.
// =======================================================================================

const D_BRIDGE = 4000, D_RES = 300, D_TUR = 100, D_HATCH = 80;
const D_PLATES = [[-14, -30, 7], [14, -30, 7], [-29, -30, 7], [29, -30, 7], [-20, -10, 7], [20, -10, 7], [-80, -16, 7], [80, -16, 7], [-52, 10, 7], [52, 10, 7]];
function dreadHullPath(e, t) {
  const p = e.p, tin = p.tin ?? 6, tick = e.t0 + t * 60;
  const u = easeInOut(clamp(t / tin, 0, 1));
  const tt = Math.max(0, t - tin);
  const k2 = e.t2 !== undefined ? smooth(clamp((tick - e.t2) / 180, 0, 1)) : 0;
  const amp = (14 + 8 * k2) * smooth(clamp(tt / 3, 0, 1));
  const y0 = p.y ?? -130, ty = p.ty ?? 86;
  let y = y0 + (ty - y0) * u + 2.5 * Math.sin(t * 0.7) * u + 12 * k2;
  if (e.tD !== undefined) { const kd = clamp((tick - e.tD) / 210, 0, 1); y += 20 * kd * kd; }
  e.x = (p.x ?? CX) + amp * Math.sin(tt * 0.22);
  e.y = y;
}
function dreadArmor(e, sim) {
  for (const c of sim.elist) {
    if (!c.alive || c.parent !== e.id) continue;
    c.armor = e.phase === DYING || !e._settled || c.p.role === 'plate' || c.p.role === 'cannon';
  }
  e.armor = e.phase === DYING || e.phase === 0;
}
function dCannon(e, sim) {
  const can = kid(e, sim, 'cannon');
  if (!can) return;
  const M = meta(sim, 'dread');
  let sx = 0;
  for (const p of sim.players) if (p && p.alive && !p.down) sx += p.x < e.x ? -1 : 1;
  const safe = sx === 0 ? (sim.rng.next() < 0.5 ? -1 : 1) : Math.sign(sx);
  const ph = Math.max(0, e.phase);
  // start angled toward the UNSAFE side (angle > PI/2 points down-left), sweep toward the safe
  // side and stop short of it: the wedge between the two lines is shown during the long warning
  const a0 = HALF + safe * (ph >= 2 ? 0.8 : 0.75);
  const span = ph >= 2 ? 0.98 : 0.9, dur = ph >= 2 ? 130 : 150;
  const mo = M.cannonMuzzle;
  sim.fire(can, 'beam', { a: r5(a0), av: r5((-safe * span) / dur), avT: dur, w: ph >= 2 ? 34 : 28, warn: 110, dur, len: 480, pal: 'plasma', follow: 1, ox: mo[0], oy: mo[1] }, mo);
  sim.cue('charge', null, can);
}
function dTurrets(e, sim) {
  const ph = Math.max(0, e.phase);
  let i = 0;
  for (const c of kids(e, sim, 'tur')) {
    later(e, sim, 1 + i++ * 7, () => {
      if (!c.alive || !canFire(c, sim, 300, 48)) return;
      if (ph >= 2) fireAt(c, sim, 'snipe', { n: 2, spread: 0.2, v: 2.5, delay: 20, spr: 'eb_needle_o' });
      else fireAt(c, sim, 'lines', { ways: 1, per: 3, v: 1.45, dv: 0.22, spr: 'eb_needle_o' });
    });
  }
}
function dDrones(e, sim) {
  const ph = Math.max(0, e.phase);
  const n = ph >= 2 ? 2 : ph >= 1 ? 2 : 1;
  for (const h of kids(e, sim, 'hatch')) {
    for (let j = 0; j < n; j++) {
      later(e, sim, 1 + j * 14, () => {
        if (!h.alive || sim.state !== 'play' || e.phase === DYING) return;
        const side = h.x < e.x ? -1 : 1;
        sim.spawn('seeker', { path: 'seek', x: r2(h.x), y: r2(h.y + 4), dx: r2(h.x + side * 50), dy: r2(h.y + 300), v: 92, t1: 0.45, life: 3.6 });
      });
    }
  }
}
function dAccel(e, sim) { if (canFire(e, sim, 320, 50)) sim.fire(e, 'accelRing', { n: dens(sim, 22), layers: 2, v0: 0.2, acc: 0.03, vmax: 1.8, a0: r3(sim.rng.next() * TAU), spr: 'eb_orb_p' }); }
function dCurtain(e, sim) {
  const tg = sim.targetPlayer(e, 'rand');
  const gx = clamp((tg ? tg.x : CX) + (sim.rng.next() - 0.5) * 60, 40, FIELD_W - 40);
  const drift = (gx < CX ? 1 : -1) * (e.phase >= 2 ? 12 : 9);
  sim.fire(e, 'curtain', { rows: e.phase >= 2 ? 6 : 5, every: 26, n: 15, gap: r2(gx), gapW: e.phase >= 2 ? 40 : 46, drift, v: 0.9, spr: 'eb_orb_o' });
}
function dCross(e, sim) { sim.fire(e, 'crossfire', { n: 5, y0: 170, dy: 28, v: 1.25, tilt: 0.25, delay: 24, spr: 'eb_needle_o' }); }
function dBurst(e, sim) { if (canFire(e, sim, 300, 50)) fireAt(e, sim, 'burstChain', { v: 1.5, n1: dens(sim, 6), n2: 3, v2: 1.7, spr: 'eb_big_p', spr1: 'eb_orb_p', spr2: 'eb_needle_p' }); }
const D_SCRIPT = {
  0: { len: 600, steps: [[0, 'cannon', dCannon], [300, 'tur', dTurrets], [380, 'drones', dDrones], [470, 'bridge', dAccel], [540, 'tur', dTurrets]] },
  1: { len: 660, steps: [[0, 'cannon', dCannon], [290, 'bridge', dCurtain], [420, 'tur', dTurrets], [480, 'drones', dDrones], [560, 'bridge', dAccel]] },
  2: { len: 600, steps: [[0, 'cannon', dCannon], [280, 'bridge', dCross], [360, 'bridge', dBurst], [420, 'drones', dDrones], [430, 'tur', dTurrets], [500, 'bridge', dCurtain]] },
};
function dreadBrain(e, sim) {
  runLater(e, sim);
  if (e.phase === DYING) { dieBrain(e, sim, { dur: 210, rx: 80, ry: 34, oy: 6, eat: ['tur', 'hatch'], every: 7 }); return; }
  const lt = sim.tick - e.t0, tin = tinTicks(e);
  if (!e.data.settled) {
    if (lt === 30 || lt === tin - 60) sim.cue('roar', null, e);
    if (lt >= tin) { e.data.settled = true; sim.cue('settle', null, e); }
    return;
  }
  if (e.hp <= resHp(e)) { sim.setPhase(e, DYING); return; }
  if (e.phase === 0) {
    if (!kid(e, sim, 'tur') || sim.tick - settledAt(e) > 32 * 60) { sim.setPhase(e, 1); return; }
  } else if (e.phase === 1 && effFrac(e) <= 0.45) { sim.setPhase(e, 2); return; }
  runScript(e, sim, D_SCRIPT[e.phase]);
}
function dreadPhase(e, ph, sim) {
  if (ph === DYING) { e.tD = e.phaseT0; dyingFx(e, sim, 'fire'); }
  else if (ph === 1) {
    e.tOpen = e.phaseT0;
    phaseFx(e, sim, 'magenta', false);
    sim.env.sfx('enemy_laser_charge', { x: e.x, vol: 0.8, pitch: -7 });
  } else if (ph === 2) {
    e.t2 = e.phaseT0;
    phaseFx(e, sim, 'fire', true);
    sim.env.sfx('boss_roar', { x: e.x, vol: 1, pitch: -3 });
    const fx = sim.env.fx;
    fx.explode(e.x - 60, e.y + 2, 'large', { palette: 'fire' });
    fx.explode(e.x + 58, e.y + 6, 'large', { palette: 'fire' });
  }
  dreadArmor(e, sim);
}
function dreadHp(e, sim) {
  if (e.phase === DYING) return 0;
  const hm = hpMul(e);
  return (effHp(e) + kidsHp(e, sim, ['tur', 'hatch'])) / (effMax(e) + (6 * D_TUR + 4 * D_HATCH) * hm);
}
function dreadDraw(e, ctx, lctx, sim) {
  const M = meta(sim, 'dread');
  const t = (sim.tick - e.t0) / 60;
  let x = e.x, y = e.y;
  if (e.phase === DYING) { const k = clamp((sim.tick - e.phaseT0) / 210, 0, 1); x += Math.round(jit(sim.tick, 7) * 3 * k); y += Math.round(jit(sim.tick, 8) * 2 * k); }
  const bx = x - M.bridge[0], by = y - M.bridge[1];
  // engine wash along the torn stern while it slides in / hovers
  const k0 = e._settled ? 0.35 : 0.9;
  for (const dx of [-54, -30, 30, 54]) glow(sim, lctx, bx + dx, by - 44, 8, COL.v, k0 * (0.7 + 0.3 * Math.sin(sim.tick * 0.25 + dx)));
  if (!e._settled && (sim.tick & 1)) for (const dx of [-54, 54]) sim.env.fx.trail?.(bx + dx, by - 46, 'plasma', 2);
  const SH = M.shadow;
  if (SH && hasSp(sim, SH.sprite)) sp(sim, ctx, null, SH.sprite, 0, bx + SH.dx, by + SH.dy);
  sp(sim, ctx, lctx, 'boss_dread', Math.floor(t * 2), bx, by);
  // bridge windows: shuttered (armored) until opened
  const open = e.tOpen !== undefined ? smooth(clamp((sim.tick - e.tOpen) / 45, 0, 1)) : 0;
  const SHU = M.shutter;
  const shut = SHU && hasSp(sim, SHU.sprite);
  if (shut) sp(sim, ctx, lctx, SHU.sprite, Math.round(open * ((SHU.frames || 5) - 1)), bx + SHU.at[0], by + SHU.at[1]);
  const w = 20, h = shut ? 0 : Math.round(7 * (1 - open));
  if (h > 0) {
    const sx = Math.round(x) - w / 2, sy = Math.round(y) - 4;
    ctx.fillStyle = OUTLINE; ctx.fillRect(sx, sy, w, h);
    if (h > 2) {
      ctx.fillStyle = RAMPS.hull[3]; ctx.fillRect(sx + 1, sy + 1, w - 2, h - 2);
      ctx.fillStyle = RAMPS.hull[5]; ctx.fillRect(sx + 1, sy + 1, w - 2, 1);
      ctx.fillStyle = RAMPS.rust[4];
      for (let i = sx + 2; i < sx + w - 2; i += 4) ctx.fillRect(i, sy + h - 2, 2, 1);
    }
  }
  const k = 0.5 + 0.5 * Math.sin(sim.tick * 0.16);
  const sc = D_SCRIPT[Math.max(0, e.phase)];
  const a = tele(stepClock(e, sim, sc, 'bridge'), 30);
  if (open > 0) {
    glow(sim, lctx, x, y, (8 + 3 * k + 8 * a) * open, a > 0.3 ? COL.w : COL.p, (0.45 + 0.45 * a) * open);
    if (e.flash > 0) glow(sim, lctx, x, y, 10, COL.w, 0.8);
  }
  // wreck damage: smoking turret sockets, burning hatches, phase 3 fires
  if (e._settled) {
    const live = new Set();
    for (const c of kids(e, sim)) live.add(c.p.role + c.p.i);
    M.turrets.forEach(([tx, ty], i) => {
      if (live.has('tur' + i)) return;
      if ((sim.tick + i * 4) % 8 === 0) sim.env.fx.trail?.(bx + tx, by + ty - 2, 'fire', 2);
      glow(sim, lctx, bx + tx, by + ty, 4, COL.o, 0.4);
    });
    M.hatches.forEach(([hx, hy], i) => {
      if (live.has('hatch' + i)) return;
      if ((sim.tick + i * 6) % 10 === 0) sim.env.fx.trail?.(bx + hx, by + hy, 'fire', 2);
    });
    if (e.phase === 2 && sim.tick % 5 === 0) sim.env.fx.trail?.(bx + (jit(sim.tick >> 4, 11) * 70), by - 20 + jit(sim.tick >> 4, 12) * 10, 'fire', 2);
  }
}
function dreadCannonDraw(e, ctx, lctx, sim) {
  const M = meta(sim, 'dread');
  let beam = null;
  for (const b of sim.beams.list) if (b.follow === e.id) { beam = b; break; }
  let fr = 0;
  const mx = e.x + M.cannonMuzzle[0], my = e.y + M.cannonMuzzle[1];
  if (beam) {
    const warn = beam.age <= beam.warn;
    fr = warn ? Math.min(3, Math.floor((beam.age / beam.warn) * 4)) : 3;
    const last = lastTick(e, 'bm', sim);
    if (warn) {
      const k = beam.age / beam.warn;
      // the swept wedge (danger zone) between the start line (engine warn line) and the end line
      const a1 = beam.a + beam.av * Math.min(beam.avT, beam.dur);
      const L = 480, pulse = 0.75 + 0.25 * Math.sin(sim.tick * 0.35);
      lctx.globalAlpha = (0.05 + 0.12 * k) * pulse;
      lctx.fillStyle = COL.v;
      lctx.beginPath(); lctx.moveTo(mx, my);
      for (let i = 0; i <= 12; i++) { const aa = beam.a + (a1 - beam.a) * (i / 12); lctx.lineTo(mx + Math.cos(aa) * L, my + Math.sin(aa) * L); }
      lctx.closePath(); lctx.fill();
      lctx.globalAlpha = 1;
      dotLine(lctx, mx, my, mx + Math.cos(a1) * L, my + Math.sin(a1) * L, 4, -(sim.tick >> 1), COL.w, 0.35 + 0.5 * k);
      dotLine(ctx, mx, my, mx + Math.cos(a1) * L, my + Math.sin(a1) * L, 4, -(sim.tick >> 1) + 2, COL.v, 0.5 + 0.4 * k);
      const n = 26;
      for (let i = 0; i <= n; i++) {
        const aa = beam.a + (a1 - beam.a) * (i / n);
        for (const R of [60, 110, 170]) {
          lctx.globalAlpha = (0.25 + 0.55 * k) * (i % 2 ? 0.6 : 1);
          lctx.fillStyle = COL.v;
          lctx.fillRect(Math.round(mx + Math.cos(aa) * R), Math.round(my + Math.sin(aa) * R), 2, 1);
        }
      }
      lctx.globalAlpha = 1;
      // arrowhead showing the sweep direction
      const tip = a1, ax = mx + Math.cos(tip) * 110, ay = my + Math.sin(tip) * 110;
      glow(sim, lctx, ax, ay, 5, COL.v, 0.3 + 0.5 * k);
      // energy converging into the muzzle
      glow(sim, lctx, mx, my, 4 + 14 * k, k > 0.7 ? COL.w : COL.v, 0.4 + 0.6 * k);
      if ((sim.tick % 3) === 0) {
        const aa = (sim.tick * 0.7) % TAU, R = 26 + 10 * (1 - k);
        sim.env.fx.spark?.(mx + Math.cos(aa) * R, my + Math.sin(aa) * R, aa + PI, 'plasma', 1);
      }
      if ((sim.tick % 20) === 0) sim.env.shake(1 + 2 * k, 0.2);
    } else {
      const fk = Math.min(1, (beam.age - beam.warn) / 10);
      glow(sim, lctx, mx, my, 18 + 4 * Math.sin(sim.tick), COL.w, 0.9 * fk);
      for (let tk = last + 1; tk <= sim.tick; tk++) {
        if (tk % 8 === 0) sim.env.shake(3.5, 0.25);
        if (tk % 5 === 0) {
          // scorch where the beam leaves the field
          const c = Math.cos(beam.a), s = Math.sin(beam.a);
          const d = s > 0.05 ? (FIELD_H - beam.y) / s : 300;
          const hx = beam.x + c * d, hy = beam.y + s * d;
          if (hx > -10 && hx < FIELD_W + 10) sim.env.fx.explode(clamp(hx, 4, FIELD_W - 4), FIELD_H - 4, 'small', { palette: 'plasma' });
        }
      }
      if (crossed(last, sim.tick, sim.tick - beam.age + beam.warn + 1)) { sim.env.fx.flash?.(0.35, [0.85, 0.7, 1]); sim.env.fx.chroma?.(0.5); sim.env.haptic?.('heavy'); }
    }
  }
  sp(sim, ctx, lctx, 'boss_dread_cannon', fr, e.x, e.y);
}
function dreadTurretDraw(e, ctx, lctx, sim) {
  const par = sim.enemies.get(e.parent);
  sp(sim, ctx, lctx, 'boss_dread_turret', 0, e.x, e.y, aimDir(sim, e.x, e.y), false, 1, e.flash > 0);
  if (par && !e.armor) {
    const g = tele(stepClock(par, sim, D_SCRIPT[Math.max(0, par.phase)], 'tur'), 24);
    if (g > 0) glow(sim, lctx, e.x, e.y, 3 + 5 * g, COL.o, 0.3 + 0.6 * g);
  }
}
function dreadHatchDraw(e, ctx, lctx, sim) {
  const par = sim.enemies.get(e.parent);
  let open = 0;
  if (par) open = tele(stepClock(par, sim, D_SCRIPT[Math.max(0, par.phase)], 'drones'), 30, 36);
  sp(sim, ctx, lctx, 'boss_dread_hatch', open > 0.1 ? 1 : 0, e.x, e.y, 0, false, 1, e.flash > 0);
  if (open > 0.1) glow(sim, lctx, e.x, e.y, 6 + 4 * open, COL.p, 0.3 + 0.5 * open);
}

ENEMIES.dread = {
  spr: 'boss_dread', hp: D_BRIDGE + D_RES, res: D_RES / (D_BRIDGE + D_RES), r: 14, score: 120000,
  boss: true, bar: true, name: 'THE DREADNOUGHT', z: 2, move: 'dreadHull', paths: { dreadHull: dreadHullPath },
  explode: 'boss', palette: 'fire', odGain: 0.5, drops: BOSS_DROPS(20, 9),
  hpFn: dreadHp, brain: dreadBrain, onPhase: dreadPhase, draw: dreadDraw,
  onSpawn(e, sim) { e.armor = true; bgBoss(sim, true); },
  onDeath(e, sim) { bigDeath(e, sim, 'fire', 190, [[-66, -10, 'large'], [64, -8, 'large'], [-30, 22, 'large'], [30, 22, 'large'], [0, -30, 'medium'], [-80, 8, 'medium'], [80, 8, 'medium']]); },
  cues: {
    roar: roarCue('fire'),
    settle(e, sim) { e._settled = true; e.data.settled = true; dreadArmor(e, sim); sim.env.sfx('boss_phase', { x: e.x, vol: 0.7, pitch: -6 }); sim.env.shake(5, 0.6); },
    pop: popCue('fire'),
  },
};
ENEMIES.dread_cannon = {
  spr: 'boss_dread_cannon', hp: 1, hpScale: false, armor: true, noHit: true, noCollide: true, r: 10, score: 0, z: 3, move: 'attach',
  explode: 'large', palette: 'plasma', drops: {}, draw: dreadCannonDraw,
  cues: { charge(e, sim) { sim.env.sfx('enemy_laser_charge', { x: e.x, vol: 1.2, pitch: -8 }); sim.env.music?.duck?.(0.3, 1.2); } },
};
ENEMIES.dread_turret = {
  spr: 'boss_dread_turret', hp: D_TUR, r: 7, score: 2000, z: 4, move: 'attach',
  explode: 'medium', palette: 'fire', odGain: 0.08, drops: { gem: 2, power: 0.2 },
  onSpawn(e) { e.armor = true; }, draw: dreadTurretDraw,
};
ENEMIES.dread_hatch = {
  spr: 'boss_dread_hatch', hp: D_HATCH, r: 8, score: 1500, z: 3, move: 'attach',
  explode: 'medium', palette: 'fire', odGain: 0.08, drops: { gem: 2, bomb: 0.08 },
  onSpawn(e) { e.armor = true; }, draw: dreadHatchDraw,
};
ENEMIES.dread_plate = plateDef('fire');

function spawnDread(sim) {
  const M = meta(sim, 'dread');
  const e = sim.spawn('dread', { x: CX, y: -130, ty: 86, tin: 6 });
  if (!e) return null;
  const bx = -M.bridge[0], by = -M.bridge[1];
  sim.spawn('dread_cannon', { role: 'cannon', ox: r2(bx + M.cannon[0]), oy: r2(by + M.cannon[1]) }, e.id);
  M.hatches.forEach(([x, y], i) => sim.spawn('dread_hatch', { role: 'hatch', i, ox: r2(bx + x), oy: r2(by + y) }, e.id));
  M.turrets.forEach(([x, y], i) => sim.spawn('dread_turret', { role: 'tur', i, ox: r2(bx + x), oy: r2(by + y) }, e.id));
  for (const [x, y, r] of D_PLATES) sim.spawn('dread_plate', { role: 'plate', ox: r2(bx + x), oy: r2(by + y), r }, e.id);
  return e;
}

// =======================================================================================
// 5. THE CHOIR HEART — final boss (S5)
// Root = the eye. Petals are children; in the Bloom they sit in the halo (drawn by the root,
// under the halo), in the Blades phase they detach and orbit/spin (drawn by themselves).
// =======================================================================================

const H_EYE = 6100, H_RES = 300, H_PET = 100;
const H_F1 = 2100 / 6100, H_F2 = 1900 / 6100;       // eye pools 2100 / 2100 / 1900 (form changes at these fractions lost / left)
const H_P0_LEN = 540, H_LID = 70;
function heartLid(e, tick) {
  if (e.phase !== 0 || !e._settled) return -1;
  const pt = tick - (settledAt(e) + LEAD);
  if (pt < 0) return -1;
  return pt % H_P0_LEN;
}
function heartPath(e, t) {
  const p = e.p, tin = p.tin ?? 5, tick = e.t0 + Math.round(t * 60);
  const u = easeOut(clamp(t / tin, 0, 1));
  const k1 = e.t1 !== undefined ? smooth(clamp((tick - e.t1) / 180, 0, 1)) : 0;
  const k2 = e.t2 !== undefined ? smooth(clamp((tick - e.t2) / 180, 0, 1)) : 0;
  const ax = (24 + 34 * k1) * (1 - k2) + 8 * k2, ay = (8 + 14 * k1) * (1 - k2) + 5 * k2;
  const cy = (p.ty ?? 118) + 14 * k2;
  const tt = Math.max(0, t - tin), ramp = smooth(clamp(tt / 2.5, 0, 1));
  let x = CX + ax * Math.sin(tt * 0.42) * ramp;
  let y = (p.y ?? -90) + (cy - (p.y ?? -90)) * u + ay * Math.sin(tt * 0.77) * ramp;
  if (e.tD !== undefined) {
    const td = (e.tD - e.t0) / 60;
    const kd = smooth(clamp((t - td) / 3, 0, 1));
    x = lerp(x, CX, kd * 0.6); y = lerp(y, 150, kd * 0.5);
  }
  e.x = x; e.y = y;
  const lid = heartLid(e, tick);
  e.armor = e.phase === DYING || !e._settled || (lid >= 0 && lid < H_LID);
}
function heartPetalPath(e, t, sim) {
  const par = sim.enemies.get(e.parent);
  if (!par) return;
  const p = e.p, n = p.n || 8, R = p.R || 64;
  const tr = (sim.tick - par.t0) / 60;
  const base = (p.k * TAU) / n + PI / n;
  const rho = (tt) => 0.22 * tt + 0.15 * Math.sin(tt * 0.7);
  const grow = easeOut(clamp(t / 2.4, 0, 1));
  const th1 = base + rho(tr);
  const R1 = R * (0.3 + 0.7 * grow);
  let x = par.x + Math.sin(th1) * R1, y = par.y - Math.cos(th1) * R1, dir = th1;
  if (par.t1 !== undefined) {
    const s1 = Math.max(0, (sim.tick - par.t1) / 60);
    const w = smooth(clamp(s1 / 1.6, 0, 1));
    const t1s = (par.t1 - par.t0) / 60;
    const spin = s1 * s1 < 4 ? s1 * s1 * 0.25 : s1 - 1;          // orbit speeds up smoothly
    const th2 = base + rho(t1s) + 0.95 * spin * (p.k & 1 ? 1 : 1);
    const R2 = 76 + 26 * Math.sin(0.9 * s1 + p.k * 0.8);
    const x2 = par.x + Math.sin(th2) * R2, y2 = par.y - Math.cos(th2) * R2 * 0.85;
    x = lerp(x, x2, w); y = lerp(y, y2, w);
    dir = lerp(th1, th2 + s1 * 5.5, w);
  }
  if (par.t2 !== undefined) {
    const s2 = Math.max(0, (sim.tick - par.t2) / 60);
    const k = easeIn(clamp(s2 / 2, 0, 1));
    x = lerp(x, par.x, k); y = lerp(y, par.y, k); dir += s2 * s2 * 5;
  }
  e.x = x; e.y = y; e.oa = dir; e.face = dir - HALF;
  // petals are part of the bloom (bullets spark off them); once torn free as blades they can be shot down
  e.armor = par.phase === DYING || !par._settled || par.t1 === undefined || par.t2 !== undefined || (sim.tick - par.t1) < 50;
}
// ---- host attacks
function hHalo(e, sim) {
  const M = meta(sim, 'heart');
  const dir = e.data.hd = -(e.data.hd || 1);
  sim.fire(e, 'orbitRing', { n: dens(sim, 22), r: M.haloR, v: 0.95, dir, k: 0.86, spinT: 70, a0: r3(sim.rng.next() * TAU), spr: 'eb_orb_p' });
}
function hPetalLines(e, sim) {
  for (const pt of kids(e, sim, 'petal')) {
    if (pt.armor || !canFire(pt, sim, 330, 40)) continue;
    sim.fire(pt, 'lines', { a: r3(pt.face ?? 0), ways: 1, per: 4, v: 1.1, dv: 0.2, spr: 'eb_needle_p' });
  }
}
function hEyeRing(e, sim) {
  if (!canFire(e, sim, 320, 50)) return;
  fireAt(e, sim, 'aimRing', { n: dens(sim, 18), v: 1.05, spr: 'eb_orb_v' });
  later(e, sim, 24, () => { if (e.phase === 0 && canFire(e, sim, 320, 50)) fireAt(e, sim, 'snipe', { n: 3, spread: 0.35, v: 2.4, delay: 20, spr: 'eb_needle_p' }); });
}
function hBloom(e, sim) { if (canFire(e, sim, 320, 50)) sim.fire(e, 'petal', { n: dens(sim, 8), per: 5, width: 0.5, v: 0.9, dv: 0.55, curl: 0.012, a0: r3(sim.rng.next() * TAU), spr: 'eb_small_p' }); }
function hFlower(e, sim) { if (canFire(e, sim, 320, 50)) sim.fire(e, 'rose', { n: dens(sim, 32), petals: 4, v: 0.8, dv: 0.55, curl: 0.006, a0: r3(sim.rng.next() * TAU), spr: 'eb_small_v' }); }
function hBeam(e, sim) {
  const M = meta(sim, 'heart');
  fireAt(e, sim, 'laserFan', { n: 3, spread: 0.9, w: 11, warn: 56, dur: 64, len: 480, pal: 'magenta', follow: 1, ox: M.iris[0], oy: M.iris[1] });
}
function hBlades(e, sim) {
  let i = 0;
  for (const b of kids(e, sim, 'petal')) {
    const d = i % 2 ? 1 : -1;
    later(e, sim, 1 + i++ * 10, () => {
      if (!b.alive || b.armor || !canFire(b, sim, 320, 40)) return;
      sim.fire(b, 'spiral', { arms: 1, v: 0.95, every: 6, count: 16, da: r3(0.42 * d), a0: r3(sim.rng.next() * TAU), spr: 'eb_small_p', follow: 1 });
    });
  }
}
function hFan(e, sim) { fireAt(e, sim, 'laserFan', { n: 4, spread: 0.5, w: 8, warn: 50, dur: 80, av: 0.0045, mirror: 1, avT: 80, len: 480, pal: 'plasma', follow: 1 }); }
function hOrbit(e, sim) { if (canFire(e, sim, 320, 50)) sim.fire(e, 'orbitRing', { n: dens(sim, 20), r: 26, v: 1.05, dir: sim.rng.next() < 0.5 ? -1 : 1, k: 0.82, spinT: 80, a0: r3(sim.rng.next() * TAU), spr: 'eb_orb_v' }); }
function hBladeLines(e, sim) {
  for (const b of kids(e, sim, 'petal')) {
    if (b.armor || !canFire(b, sim, 300, 44)) continue;
    fireAt(b, sim, 'lines', { ways: 1, per: 3, v: 1.3, dv: 0.25, spr: 'eb_needle_p' });
  }
}
function hStop(e, sim) { if (canFire(e, sim, 300, 50)) fireAt(e, sim, 'stopAim', { n: dens(sim, 14), v: 1.5, stopT: 30, hold: 20, v2: 2.0, spr: 'eb_orb_p', spr2: 'eb_needle_p' }); }
function hK(e, sim) { return clamp((sim.tick - e.phaseT0 - LEAD) / 2400, 0, 1); }     // desperation ramps over 40 s
function hSpiral3(e, sim) {
  if (!canFire(e, sim, 330, 40)) return;
  const k = hK(e, sim);
  sim.fire(e, 'crossSpiral', { arms: k > 0.6 ? 4 : 3, v: r3(0.85 + 0.3 * k), every: k > 0.5 ? 6 : 7, count: 20, da: r3(0.16 + 0.04 * k), a0: r3(sim.rng.next() * TAU), spr: 'eb_small_p', spr2: 'eb_small_v', follow: 1 });
}
function hFlower3(e, sim) {
  if (!canFire(e, sim, 330, 40)) return;
  const k = hK(e, sim);
  sim.fire(e, 'rose', { n: dens(sim, Math.round(24 + 10 * k)), petals: 5, v: r3(0.75 + 0.3 * k), dv: 0.5, curl: r3(0.008 * (sim.rng.next() < 0.5 ? -1 : 1)), layers: k > 0.45 ? 2 : 1, a0: r3(sim.rng.next() * TAU), spr: 'eb_orb_p' });
}
function hAim3(e, sim) { if (canFire(e, sim, 330, 50)) fireAt(e, sim, 'lines', { ways: dens(sim, 5), spread: 0.8, per: 3, v: 1.5, dv: 0.25, spr: 'eb_needle_p' }); }
const H_SCRIPT = {
  0: { len: H_P0_LEN, steps: [[20, 'halo', hHalo], [45, 'halo', hHalo], [100, 'petals', hPetalLines], [200, 'eye', hEyeRing], [300, 'eye', hBloom], [400, 'petals', hPetalLines], [470, 'eye', hFlower]] },
  1: { len: 600, steps: [[0, 'beam', hBeam], [90, 'blades', hBlades], [250, 'beam', hFan], [360, 'eye', hOrbit], [450, 'blades', hBladeLines], [520, 'eye', hStop]] },
  2: { len: 300, steps: [[0, 'core', hSpiral3], [75, 'core', hFlower3], [150, 'core', hSpiral3], [200, 'aim', hAim3], [225, 'core', hFlower3]] },
};
function heartBrain(e, sim) {
  runLater(e, sim);
  if (e.phase === DYING) { heartDie(e, sim); return; }
  const lt = sim.tick - e.t0, tin = tinTicks(e);
  if (!e.data.settled) {
    if (lt === tin - 80) sim.cue('roar', null, e);
    if (lt >= tin) { e.data.settled = true; sim.cue('settle', null, e); }
    return;
  }
  if (e.hp <= resHp(e)) { sim.setPhase(e, DYING); return; }
  const f = effFrac(e);
  if (e.phase === 0 && f <= 1 - H_F1 + 1e-6) { sim.setPhase(e, 1); return; }
  if (e.phase === 1 && f <= H_F2) {
    sim.setPhase(e, 2);
    later(e, sim, 124, () => {
      for (const b of kids(e, sim, 'petal')) sim.kill(b, -1, true);
      sim.cue('devour', null, e);
    });
    return;
  }
  runScript(e, sim, H_SCRIPT[e.phase]);
}
function heartDie(e, sim) {
  const k = sim.tick - e.phaseT0, dur = 380;
  if (k >= dur) { sim.kill(e, -1); return; }
  if (k < dur - 60 && k % 10 === 3) {
    const rng = sim.rng, R = 8 + 70 * (k / dur), a = rng.next() * TAU;
    sim.cue('pop', [r2(e.x + Math.cos(a) * R * rng.next()), r2(e.y + Math.sin(a) * R * rng.next()), rng.next() < 0.35 ? 2 : 1], e);
  }
}
function heartPhase(e, ph, sim) {
  const fx = sim.env.fx;
  if (ph === DYING) { e.tD = e.phaseT0; dyingFx(e, sim, 'magenta'); fx.flash?.(0.8, [1, 0.8, 0.95]); }
  else if (ph === 1) {
    e.t1 = e.phaseT0;
    for (const c of sim.elist) if (c.alive && c.parent === e.id && c.p.role === 'petal') c.def = ENEMIES.heart_blade;
    phaseFx(e, sim, 'magenta', true);
    const M = meta(sim, 'heart');
    for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; fx.spark?.(e.x + Math.cos(a) * M.haloR, e.y + Math.sin(a) * M.haloR, a, 'magenta', 3); }
    fx.debris?.(e.x, e.y, 16, 'magenta');
    fx.shockwave?.(e.x, e.y, 70, 'plasma');
    sim.env.sfx('explode_large', { x: e.x, vol: 1 });
    sim.env.sfx('boss_roar', { x: e.x, vol: 1, pitch: 4 });
  } else if (ph === 2) {
    e.t2 = e.phaseT0;
    phaseFx(e, sim, 'plasma', true);
    fx.explode(e.x, e.y, 'large', { palette: 'magenta' });
    fx.debris?.(e.x, e.y, 14, 'magenta');
    sim.env.sfx('boss_roar', { x: e.x, vol: 1.2, pitch: -4 });
    sim.env.music?.duck?.(0.4, 1.5);
  }
}
function heartHp(e, sim) {
  if (e.phase === DYING) return 0;
  return (effHp(e) + kidsHp(e, sim, ['petal'])) / (effMax(e) + 8 * H_PET * hpMul(e));
}
function heartPetalSprite(pt, ctx, lctx, sim, alpha) {
  sp(sim, ctx, lctx, 'boss_heart_petal', 0, pt.x, pt.y, pt.oa || 0, false, alpha, pt.flash > 0);
}
function heartDraw(e, ctx, lctx, sim) {
  const M = meta(sim, 'heart');
  const t = (sim.tick - e.t0) / 60;
  let x = e.x, y = e.y;
  const dk = e.phase === DYING ? clamp((sim.tick - e.phaseT0) / 380, 0, 1) : 0;
  if (dk > 0) { x += jit(sim.tick, 9) * 3 * dk; y += jit(sim.tick, 10) * 3 * dk; }
  const last = lastTick(e, 'h', sim);
  // Bloom: petals sit in the halo (under it)
  if (e.t1 === undefined) for (const pt of kids(e, sim, 'petal')) heartPetalSprite(pt, ctx, lctx, sim, 1);
  // halo: intact in the bloom, shatters when the blades tear free
  const tk1 = e.t1 !== undefined ? sim.tick - e.t1 : -1;
  if (tk1 < 0 || tk1 < 36) {
    const fl = tk1 < 0 ? 1 : (tk1 >> 1) & 1 ? 0.3 : 0.9 * (1 - tk1 / 36);
    const sc = H_SCRIPT[0];
    const hk = e.phase === 0 ? tele(stepClock(e, sim, sc, 'halo'), 30, 20) : 0;
    glow(sim, lctx, x, y, M.haloR + 10, COL.p, (0.15 + 0.35 * hk) * fl);
    sp(sim, ctx, lctx, 'boss_heart_halo', Math.floor(t * (10 + 12 * hk)), x, y, 0, false, fl);
  }
  if (e.t2 === undefined || sim.tick - e.t2 < 40) {
    // the eye: lid schedule in the bloom, pulse otherwise
    const lid = heartLid(e, sim.tick);
    let fr = Math.floor(t * 6) % 4;
    if (!e._settled) { const k = (sim.tick - e.t0) / tinTicks(e); fr = k < 0.55 ? 5 : k < 0.8 ? 4 : fr; }
    else if (lid >= 0 && lid < H_LID) fr = lid < 8 || lid >= H_LID - 8 ? 4 : 5;
    const fade = e.t2 !== undefined ? 1 - (sim.tick - e.t2) / 40 : 1;
    sp(sim, ctx, lctx, 'boss_heart', fr, x, y, 0, false, fade, e.flash > 0 && fr < 4);
    const sc = H_SCRIPT[Math.max(0, e.phase)];
    const a = e.phase >= 0 ? Math.max(tele(stepClock(e, sim, sc, 'eye'), 30), tele(stepClock(e, sim, sc, 'beam'), 40, 20)) : 0;
    if (fr < 4) glow(sim, lctx, x + M.iris[0], y + M.iris[1], 8 + 10 * a + 2 * Math.sin(sim.tick * 0.2), a > 0.4 ? COL.w : COL.p, 0.45 + 0.5 * a);
  }
  if (e.t2 !== undefined) {
    // Singularity: the exposed core
    const s2 = sim.tick - e.t2, k = clamp(s2 / 40, 0, 1);
    const hk = e.phase === 2 ? hK(e, sim) : 1;
    const R = 20 + 6 * Math.sin(sim.tick * 0.1) + 10 * hk;
    glow(sim, lctx, x, y, R + 16 * dk, dk > 0.5 ? COL.w : COL.p, (0.5 + 0.3 * hk) * k);
    // rotating light spokes
    const n = 12, rot = sim.tick * (0.01 + 0.02 * hk + 0.05 * dk);
    lctx.globalAlpha = (0.25 + 0.35 * hk + 0.4 * dk) * k;
    for (let i = 0; i < n; i++) {
      const aa = rot + (i / n) * TAU, len = 22 + 14 * hk + 90 * dk;
      lctx.fillStyle = i % 2 ? COL.p : COL.v;
      for (let d = 12; d < len; d += 2) lctx.fillRect(Math.round(x + Math.cos(aa) * d), Math.round(y + Math.sin(aa) * d), 1, 1);
    }
    lctx.globalAlpha = 1;
    sp(sim, ctx, lctx, 'boss_heart_core2', Math.floor(t * (10 + 10 * hk)), x, y, 0, false, k, e.flash > 0);
    if (dk > 0.85) glow(sim, lctx, x, y, 10 + 200 * (dk - 0.85), COL.w, (dk - 0.85) * 6);
  }
  // dying: expanding shockwaves on a rhythm, final implosion flare
  if (e.phase === DYING) {
    const base = e.phaseT0;
    for (let tk = last + 1; tk <= sim.tick; tk++) {
      const k = tk - base;
      if (k > 0 && k % 60 === 0 && k < 330) {
        sim.env.fx.shockwave?.(x, y, 40 + k * 0.4, k % 120 === 0 ? 'magenta' : 'plasma');
        sim.env.fx.flash?.(0.2 + 0.25 * (k / 380), [1, 0.75, 0.95]);
        sim.env.fx.chroma?.(0.4 + 0.4 * (k / 380));
        sim.env.sfx('explode_large', { x, vol: 1 });
        sim.env.shake(3 + 4 * (k / 380), 0.5);
      }
      if (k === 320) { sim.env.sfx('warp_in', { x, vol: 1.2, pitch: -10 }); sim.env.music?.duck?.(0.2, 3); }
    }
  }
}
function heartPetalDraw(e, ctx, lctx, sim) {
  const par = sim.enemies.get(e.parent);
  if (!par || par.t1 === undefined) return;            // bloom: drawn by the heart under the halo
  heartPetalSprite(e, ctx, lctx, sim, 1);
  glow(sim, lctx, e.x, e.y, 8, COL.p, 0.35);
  if ((sim.tick + e.p.k * 2) % 4 === 0) sim.env.fx.trail?.(e.x, e.y, 'magenta', 1);
}

ENEMIES.heart = {
  spr: 'boss_heart', hp: H_EYE + H_RES, res: H_RES / (H_EYE + H_RES), r: 16, score: 250000,
  boss: true, bar: true, final: true, name: 'THE CHOIR HEART', z: 5, move: 'heartPath', paths: { heartPath },
  explode: 'boss', palette: 'magenta', odGain: 0.5, drops: BOSS_DROPS(24, 12),
  hpFn: heartHp, brain: heartBrain, onPhase: heartPhase, draw: heartDraw,
  onSpawn(e, sim) { e.armor = true; bgBoss(sim, true); },
  onDeath(e, sim) {
    bigDeath(e, sim, 'magenta', 240, [[-30, -20, 'large'], [30, -18, 'large'], [0, 34, 'large'], [-44, 20, 'medium'], [44, 22, 'medium'], [0, -44, 'medium']]);
    const fx = sim.env.fx;
    fx.shockwave?.(e.x, e.y, 320, 'plasma');
    fx.nova?.(e.x, e.y, 'magenta');
    for (let i = 0; i < 16; i++) fx.spark?.(e.x, e.y, (i / 16) * TAU, i % 2 ? 'magenta' : 'white', 3);
  },
  cues: {
    roar: roarCue('magenta'),
    settle(e, sim) { e._settled = true; e.data.settled = true; sim.env.sfx('boss_phase', { x: e.x, vol: 0.7, pitch: 3 }); sim.env.fx.shockwave?.(e.x, e.y, 90, 'magenta'); },
    devour(e, sim) { const fx = sim.env.fx; fx.flash?.(0.5, [1, 0.8, 1]); fx.shockwave?.(e.x, e.y, 110, 'plasma'); fx.chroma?.(0.8); sim.env.sfx('explode_boss', { x: e.x, vol: 0.9 }); sim.env.shake(6, 0.8); },
    pop: popCue('magenta'),
  },
};
// Bloom petals sit behind the halo plane: shots and ships pass them (noHit/noCollide). When the
// halo breaks, the heart's onPhase swaps every petal to the solid 'heart_blade' def (all peers).
ENEMIES.heart_blade = {
  spr: 'boss_heart_petal', hp: H_PET, r: 9, score: 2500, z: 6, move: 'heartPetal', paths: { heartPetal: heartPetalPath },
  explode: 'medium', palette: 'magenta', odGain: 0.12, drops: { gem: 2, power: 0.25 },
  onSpawn(e) { e.armor = true; }, draw: heartPetalDraw,
  onDeath(e, sim) { sim.env.fx.debris?.(e.x, e.y, 6, 'magenta'); sim.env.fx.shockwave?.(e.x, e.y, 32, 'magenta'); },
};
ENEMIES.heart_petal = Object.assign({}, ENEMIES.heart_blade, { noHit: true, noCollide: true });

function spawnHeart(sim) {
  const M = meta(sim, 'heart');
  const e = sim.spawn('heart', { x: CX, y: -90, ty: 118, tin: 5 });
  if (!e) return null;
  for (let k = 0; k < 8; k++) sim.spawn('heart_petal', { role: 'petal', k, n: 8, R: M.petalR }, e.id);
  return e;
}

// =======================================================================================
// Boss patterns
// =======================================================================================

registerPatterns({
  // rose bloom: a ring whose speeds follow |cos(petals·θ/2)| (a rhodonea) — optionally curling
  // and doubled into a counter-twisted second layer.
  // {n=32, petals=4, v=0.8, dv=0.55, curl=0 (rad/tick spin, 40 ticks), layers=1, a0=0, spr='eb_small_p'}
  rose(sim, x, y, A) {
    const n = A.n || 32, pet = A.petals || 4, v = A.v ?? 0.8, dv = A.dv ?? 0.55, a0 = A.a0 || 0, L = A.layers || 1;
    for (let l = 0; l < L; l++) {
      const curl = (A.curl || 0) * (l % 2 ? -1 : 1);
      for (let i = 0; i < n; i++) {
        const th = (TAU * i) / n;
        const k = Math.abs(Math.cos((pet * th) / 2));
        sim.eb({ x, y, a: a0 + th + (l * PI) / n, v: v + dv * k + l * 0.18, spr: A.spr || 'eb_small_p', spin: curl, spinT: 40 });
      }
    }
    A.silent = 1;
    sim.sfxAt('enemy_shot_heavy', x, 0.55);
  },
});

// =======================================================================================

export const BOSSES = {
  warden: { spawn: spawnWarden },
  wyrm: { spawn: spawnWyrm },
  prism: { spawn: spawnPrism },
  dread: { spawn: spawnDread },
  heart: { spawn: spawnHeart },
};

export function registerBosses(obj) { Object.assign(BOSSES, obj); }
