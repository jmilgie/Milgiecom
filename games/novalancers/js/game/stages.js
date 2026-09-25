// Nova Lancers — the five-sector campaign.
//
// STAGES[key] = { script: Step[], cues: { name(sim, sim, data) } }
// Steps are executed by StageRunner (sim.js, host only). Step fields:
//   dt (seconds after the previous step), and any of:
//   spawn:type n gap p(object | (i, rng, sim) => object) bonus:'power'|'bomb'|'overdrive'|'life'
//   call:(sim, rng) => void   wait:'clear'|'boss' max   banner:{title, sub}   warning:{name, music}
//   music:track   boss:key   pickup:{type, x, y}   end:true
//
// Authoring model: every sector is a list of timeline BLOCKS. Inside a block, items are
// written with ABSOLUTE times (seconds from the start of the block) and block() converts them
// into the runner's relative dt. Blocks are separated by breathers (wait:'clear' with a max),
// so a block always starts on a clean screen.
//
// Formation helpers spawn a whole group on the same tick and bake each member's delay into
// its closed-form path params (sine / line are pure functions of t, so starting d seconds
// "upstream" is exact). That keeps bonus drops honest: the group's power core always drops
// from the true last kill, never from an early kill while the rest are still queued.
//
// Pacing per sector (≈ 2:20–2:45 before the WARNING):
//   A first contact (teaching)  → B rising (banner)  → C set-piece / mid-boss (+1UP after)
//   → D peak  → E breather (gem shower)  → WARNING → boss → end.
// Power cores (bonus:'power' + scripted drops) are placed so a player who collects well is at
// power 5–6 leaving S1–S2 and at 8 by the end of S3; later sectors give enough to recover.

import { swoop, formationOffsets } from './paths.js';
import { FIELD_W, FIELD_H } from '../config.js';

const W = FIELD_W;
const CX = W / 2;
const TAU = Math.PI * 2;
const PI = Math.PI;
const r2 = (v) => Math.round(v * 100) / 100;

// ======================================================================================
// Timeline helpers
// ======================================================================================

// block([t, step | step[]], ...) → runner steps. t = seconds from the block start.
function block(...items) {
  const flat = [];
  items.forEach(([t, s], k) => { for (const st of [].concat(s)) if (st) flat.push({ t, k, st }); });
  flat.sort((a, b) => a.t - b.t || a.k - b.k);
  let last = 0;
  return flat.map(({ t, st }) => {
    const out = Object.assign({ dt: r2(Math.max(0, t - last)) }, st);
    last = t;
    return out;
  });
}

const breather = (max, dt = 0) => ({ dt, wait: 'clear', max });
const banner = (title, sub, ms) => ({ banner: ms ? { title, sub, ms } : { title, sub } });
const cue = (name, data) => ({ call: (sim, rng) => sim.cue(name, typeof data === 'function' ? data(rng, sim) : (data ?? null)) });
const pickup = (type, x = CX, y = 40) => ({ pickup: { type, x, y } });

// strip undefined keys so host and client params are identical objects
function clean(o) {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

// ======================================================================================
// Formation / spawn helpers (all return runner steps)
// ======================================================================================

// Column of n enemies weaving down a sine; member i trails the leader by i·d seconds.
// {x, y, vy, amp, freq, ph, d, bonus}
function sineTrain(type, n, o = {}) {
  const x = o.x ?? CX, y = o.y ?? -14, vy = o.vy ?? 50, amp = o.amp ?? 28, freq = o.freq ?? 0.45;
  const ph = o.ph ?? 0, d = o.d ?? 0.25;
  return clean({
    spawn: type, n, gap: 0, bonus: o.bonus,
    p: (i) => ({ path: 'sine', x, y: y - vy * d * i, vy, amp, freq, ph: ph - freq * TAU * d * i }),
  });
}

// Straight stream of n enemies along (vx, vy) from (x, y); member i trails by i·d seconds.
function lineTrain(type, n, o = {}) {
  const x = o.x ?? CX, y = o.y ?? -14, vx = o.vx ?? 0, vy = o.vy ?? 50, d = o.d ?? 0.25;
  return clean({
    spawn: type, n, gap: 0, bonus: o.bonus,
    p: (i) => ({ path: 'line', x: x - vx * d * i, y: y - vy * d * i, vx, vy }),
  });
}

// Mirrored pair of line trains from the two top corners, crossing in the middle.
function pincer(type, n, o = {}) {
  const vx = o.vx ?? 60, vy = o.vy ?? 44, y = o.y ?? 24, d = o.d ?? 0.24;
  return [
    lineTrain(type, n, { x: -12, y, vx, vy, d, bonus: o.bonusL }),
    lineTrain(type, n, { x: W + 12, y: y + (o.dy ?? 14), vx: -vx, vy, d, bonus: o.bonusR }),
  ];
}

// Rigid squadron flying a leader path (default: a swoop). shape: vee|line|column|wall|
// circle|diamond|arrow (paths.js formationOffsets). rot:1 banks the whole formation with
// the leader's heading.
function squad(type, shape, n, lead, o = {}) {
  const offs = formationOffsets(shape, n, o.sp ?? 16);
  const lp = Object.assign({}, lead);
  const lpath = lp.path || 'swoop';
  delete lp.path;
  return clean({
    spawn: type, n, gap: 0, bonus: o.bonus,
    p: (i) => clean({ path: 'formation', lpath, lp, ox: offs[i][0], oy: offs[i][1], rot: o.rot ?? 1, grow: o.grow }),
  });
}

// Individual swoopers on the same curve, one every `gap` seconds.
function swoopers(type, n, side, preset, y, o = {}) {
  const base = swoop(side, preset, y, o.depth ?? 110, o.dur ?? 3.2, o.exitV ?? 110);
  return { spawn: type, n, gap: o.gap ?? 0.4, p: (i) => Object.assign({}, base, { y: y + (o.dy || 0) * i }) };
}

// Enemies that fly in from the top to hold points, then leave ('hold' path).
// xs: hold x per member; o: {ty | tys[], y, tin, hold, sway, swayF, bob, gap, ex, ey}
function holdRow(type, xs, o = {}) {
  return {
    spawn: type, n: xs.length, gap: o.gap ?? 0.3,
    p: (i) => clean({
      path: 'hold', x: o.x0 !== undefined ? o.x0 : xs[i], y: o.y ?? -22, tx: xs[i], ty: o.tys ? o.tys[i] : (o.ty ?? 80),
      tin: o.tin, hold: o.hold, sway: o.sway, swayF: o.swayF, bob: o.bob, ex: o.ex, ey: o.ey,
    }),
  };
}

// Hovering enemies ('hover' path: sentinels, phantoms, bastions).
function hoverAt(type, pts, o = {}) {
  return {
    spawn: type, n: pts.length, gap: o.gap ?? 0.4,
    p: (i) => clean({
      path: 'hover', x: o.warp ? pts[i][0] : (o.x0 ?? pts[i][0]), y: o.warp ? pts[i][1] - 6 : (o.y ?? -24),
      tx: pts[i][0], ty: pts[i][1], tin: o.tin, sway: o.sway, swayF: o.swayF, bob: o.bob, ph: i * 1.7,
      life: o.life, cycles: o.cycles, stay: o.stay,
    }),
  };
}

// Crystal shards materialise (warp) at their hold points in the upper field.
function shardsAt(type, pts, o = {}) {
  return {
    spawn: type, n: pts.length, gap: o.gap ?? 0.3,
    p: (i) => clean({ path: 'hold', x: pts[i][0], y: pts[i][1] - 8, tx: pts[i][0], ty: pts[i][1], tin: 0.8, hold: o.hold ?? 6, sway: o.sway ?? 8, swayF: 0.2, ey: -60 }),
  };
}

// A ring of n enemies orbiting a slowly falling centre (optionally around a core enemy).
function halo(type, n, o = {}) {
  const cx = o.x ?? CX, cy = o.y ?? -52, cvy = o.vy ?? 34, r = o.r ?? 28, w = o.w ?? 1.8;
  const steps = [clean({
    spawn: type, n, gap: 0, bonus: o.bonus,
    p: (i) => clean({ path: 'orbit', cx, cy, cvx: o.vx || 0, cvy, r, w, ph: (TAU * i) / n, rin: o.rin }),
  })];
  if (o.core) steps.push({ spawn: o.core, n: 1, p: { path: 'line', x: cx, y: cy, vx: o.vx || 0, vy: cvy } });
  return steps;
}

// Telegraphed dive-bombers: hold at (xs[i], ty) then lock on and dash.
function lancets(type, xs, o = {}) {
  return {
    spawn: type, n: xs.length, gap: o.gap ?? 0.45,
    p: (i) => clean({ path: 'dive', x: xs[i], y: -22, tx: xs[i], ty: o.tys ? o.tys[i] : (o.ty ?? 72), tin: o.tin ?? 1.0, pause: o.pause ?? 0.7 }),
  };
}

// Drifting mines across the top.
function mines(type, xs, o = {}) {
  return {
    spawn: type, n: xs.length, gap: o.gap ?? 0.25,
    p: (i) => clean({ path: 'drift', x: xs[i], y: o.y ?? -12, vx: o.vx ? o.vx * (i % 2 ? -1 : 1) : 0, vy: o.vy ?? 26, wob: 3, wobF: 0.3, ph: i, fuse: o.fuse }),
  };
}

// Kamikaze seekers. from:'top' (xs = entry x) or 'left'/'right' (xs = entry y).
function seekers(n, o = {}) {
  const from = o.from || 'top';
  return {
    spawn: 'seeker', n, gap: o.gap ?? 0.35,
    p: (i) => {
      const k = o.xs ? o.xs[i % o.xs.length] : (from === 'top' ? 40 + ((i * 53) % 160) : 60 + ((i * 37) % 120));
      if (from === 'top') return { path: 'seek', x: k, y: -12, dx: k + (o.lean || 0), dy: FIELD_H, v: o.v ?? 105, turn: o.turn ?? 1.0 };
      const side = from === 'left' ? -1 : 1;
      const x = side < 0 ? -12 : W + 12;
      return { path: 'seek', x, y: k, dx: CX - side * 40, dy: k + 90, v: o.v ?? 105, turn: o.turn ?? 1.0 };
    },
  };
}

// Strafing curtain bombers.
function weaver(type, side, y, o = {}) {
  return { spawn: type, n: 1, p: clean({ path: 'strafe', side, y, v: o.v ?? 60, amp: o.amp ?? 4, freq: 0.3, dip: o.dip }) };
}

// Random asteroid field (well spread in x via the golden ratio).
function rocks(type, n, gap, o = {}) {
  const x0 = o.x0 ?? 22, x1 = o.x1 ?? W - 22, big = type === 'rock_l';
  return {
    spawn: type, n, gap,
    p: (i, rng) => ({
      path: 'drift',
      x: x0 + (x1 - x0) * ((i * 0.618 + (o.seed || 0) + rng.next() * 0.25) % 1),
      y: big ? -30 : -22,
      vx: rng.range(-(o.vx ?? 10), o.vx ?? 10),
      vy: rng.range(o.vy0 ?? (big ? 22 : 28), o.vy1 ?? (big ? 30 : 42)),
      wob: 2 + rng.next() * 2, wobF: rng.range(0.18, 0.45), ph: rng.range(0, 6.28), v: rng.int(0, 3),
    }),
  };
}

// Hull turrets riding the scrolling ground (Leviathan Wreck). xs: hull x per turret;
// o.dy staggers them into rows (px further up the hull), o.rail slides them along tracks.
function turrets(type, xs, o = {}) {
  return {
    spawn: type, n: xs.length, gap: 0,
    p: (i, rng, sim) => clean({
      path: 'ground', x: xs[i], y: (o.y ?? -18) - (o.dy || 0) * i, sy0: sim.scrollY,
      rail: o.rail ? o.rail * (i % 2 ? -1 : 1) : undefined, railF: o.rail ? (o.railF ?? 0.14) : undefined,
    }),
  };
}

// Mid-boss frigate.
function bastion(type, o = {}) {
  return { spawn: type, n: 1, p: clean({ path: 'hover', x: o.x ?? CX, y: -46, tx: o.tx ?? CX, ty: o.ty ?? 86, tin: 3, sway: 28, swayF: 0.07, bob: 3, stay: o.stay ?? 55 }) };
}

// WARNING → boss → end
function finale(bossKey, name, music = 'boss', lead = 1.2) {
  return [
    { dt: lead, warning: { name, music } },
    { dt: 3.6, boss: bossKey },
    { dt: 0, wait: 'boss' },
    { dt: 1.5, end: true },
  ];
}

// ======================================================================================
// Stage cues (cosmetic, every peer) — backgrounds, flashes, rumbles
// ======================================================================================

const fxOf = (sim) => sim.env.fx || {};

const CUES = {
  // S1: dawn glint off the ring station
  dawn(sim) {
    sim.env.bg?.flash?.();
    fxOf(sim).flash?.(0.16, [1, 0.92, 0.72]);
  },
  // S2: red-giant solar flare — orange wash, low rumble, a shudder
  flare(sim) {
    sim.env.bg?.flash?.();
    fxOf(sim).flash?.(0.3, [1, 0.5, 0.22]);
    fxOf(sim).chroma?.(0.25);
    sim.env.shake(2.5, 0.8);
    sim.env.sfx('explode_large', { x: CX, vol: 0.32, pitch: -12 });
    sim.env.music?.duck?.(0.25, 0.8);
  },
  // S3: lightning inside the nebula clouds (d = 1: a big one)
  lightning(sim, _s, d) {
    const big = d === 1;
    sim.env.bg?.flash?.();
    fxOf(sim).flash?.(big ? 0.24 : 0.13, [0.82, 0.72, 1]);
    if (big) fxOf(sim).chroma?.(0.2);
    sim.env.shake(big ? 2 : 1, big ? 0.5 : 0.25);
    sim.env.sfx('explode_large', { x: CX, vol: big ? 0.3 : 0.18, pitch: -14 });
  },
  // S4: hull breach — secondary explosions along the wreck (d = [x, y, x, y, ...])
  breach(sim, _s, d) {
    const fx = fxOf(sim);
    const pts = Array.isArray(d) ? d : [];
    for (let i = 0; i + 1 < pts.length; i += 2) {
      fx.explode?.(pts[i], pts[i + 1], i === 0 ? 'large' : 'medium', { palette: 'fire' });
      fx.debris?.(pts[i], pts[i + 1], 5, 'ember');
    }
    if (pts.length) fx.shockwave?.(pts[0], pts[1], 60, 'fire');
    fx.flash?.(0.18, [1, 0.6, 0.35]);
    sim.env.shake(4, 0.7);
    sim.env.sfx('explode_large', { x: pts[0] ?? CX, vol: 0.7, pitch: -4 });
    sim.env.bg?.flash?.();
  },
  // S5: gravity pulse from the singularity — space ripples, colour splits
  pulse(sim) {
    const fx = fxOf(sim);
    sim.env.bg?.flash?.();
    fx.chroma?.(0.55);
    fx.flash?.(0.2, [0.7, 0.5, 1]);
    fx.shockwave?.(CX, 70, 170, 'plasma');
    sim.env.shake(3, 0.8);
    sim.env.sfx('warp_in', { x: CX, vol: 0.6, pitch: -10 });
    sim.env.music?.duck?.(0.3, 0.8);
  },
};

// deterministic hull-breach explosion spots, picked by the host
const breachPts = (rng) => {
  const out = [];
  for (let i = 0; i < 4; i++) out.push(Math.round(i % 2 ? W - 16 - rng.next() * 40 : 16 + rng.next() * 40), Math.round(40 + i * 60 + rng.next() * 30));
  return out;
};

// ======================================================================================
// S1 — AURORA RING: orbital shipyard at dawn. Readable, generous, exciting.
// mites, darts, wisps, eyes; carapace gunship set-piece; boss: THE WARDEN
// ======================================================================================

const aurora = [
  // A — first contact: swarm, fighters, gem carriers, the first turret eyes
  ...block(
    [3.6, sineTrain('mite', 7, { x: 74, d: 0.24, amp: 26, bonus: 'power' })],
    [6.3, sineTrain('mite', 7, { x: 166, d: 0.24, amp: 26, ph: PI })],
    [9.2, squad('dart', 'vee', 5, swoop(-1, 'u', 34, 80, 3.8, 110), { sp: 15 })],
    [13.0, squad('dart', 'vee', 5, swoop(1, 'u', 48, 80, 3.8, 110), { sp: 15, bonus: 'overdrive' })],
    [16.8, sineTrain('wisp', 3, { x: CX, vy: 36, amp: 76, freq: 0.2, d: 1.1 })],
    [19.8, holdRow('eye', [64, 176], { ty: 74, hold: 5.5, gap: 0.5 })],
    [24.2, pincer('mite', 6, { vx: 62, vy: 44, d: 0.22, bonusR: 'power' })],
    [28.4, swoopers('dart', 3, -1, 'hook', 38, { gap: 0.42 })],
    [29.4, swoopers('dart', 3, 1, 'hook', 54, { gap: 0.42 })],
    [32.6, halo('mite', 8, { x: 78, r: 26, core: 'wisp' })],
    [34.4, halo('mite', 8, { x: 162, r: 26, w: -1.8, core: 'wisp' })],
    [38.0, squad('dart', 'diamond', 6, swoop(1, 'dip', 34, 120, 3.8, 110), { sp: 14 })],
    [41.0, holdRow('eye', [96, 144], { ty: 58, hold: 4.5, gap: 0.3 })],
  ),
  breather(6, 1.5),

  // B — incoming swarm: the sky fills up
  ...block(
    [0, [banner('INCOMING SWARM', 'Choir drones inbound'), cue('dawn')]],
    [1.2, sineTrain('mite', 6, { x: 44, d: 0.22, amp: 20, freq: 0.5 })],
    [1.8, sineTrain('mite', 6, { x: 196, d: 0.22, amp: 20, freq: 0.5, ph: PI })],
    [2.6, sineTrain('mite', 6, { x: 96, d: 0.22, amp: 22, freq: 0.5, ph: PI / 2, bonus: 'overdrive' })],
    [3.2, sineTrain('mite', 6, { x: 144, d: 0.22, amp: 22, freq: 0.5, ph: -PI / 2 })],
    [5.8, squad('dart', 'arrow', 7, swoop(-1, 'arc', 26, 100, 4.2, 110), { sp: 15 })],
    [9.4, holdRow('eye', [50, 120, 190], { tys: [84, 64, 84], hold: 6, gap: 0.35 })],
    [12.6, swoopers('dart', 4, 1, 's', 30, { depth: 130, gap: 0.34 })],
    [15.2, squad('dart', 'column', 4, swoop(-1, 's', 44, 130, 3.8, 110), { sp: 16 })],
    [17.6, sineTrain('wisp_ring', 2, { x: CX, vy: 30, amp: 64, freq: 0.22, d: 1.4 })],
    [19.4, pincer('mite', 5, { vx: 70, vy: 40, d: 0.2, y: 40 })],
    [22.6, halo('mite', 10, { x: CX, r: 32, core: 'wisp' })],
    [24.2, pickup('bomb', CX, 40)],
    [25.6, squad('dart', 'vee', 5, swoop(-1, 'hook', 30, 110, 3.4, 110), { sp: 15, bonus: 'power' })],
    [27.4, squad('dart', 'vee', 5, swoop(1, 'hook', 40, 110, 3.4, 110), { sp: 15 })],
  ),
  breather(7, 1.5),

  // C — set-piece: HEAVY GUNSHIP (the S1 stand-in for a mid-boss)
  ...block(
    [0, [banner('HEAVY GUNSHIP', 'Carapace-class escort detected'), cue('dawn')]],
    [1.4, holdRow('carapace', [CX], { ty: 96, hold: 9, sway: 26, swayF: 0.1 })],
    [3.0, sineTrain('mite', 6, { x: 36, d: 0.26, amp: 14, freq: 0.4 })],
    [3.4, sineTrain('mite', 6, { x: 204, d: 0.26, amp: 14, freq: 0.4, ph: PI })],
    [5.2, holdRow('eye', [40, 200], { ty: 118, hold: 5, gap: 0 })],
    [9.0, swoopers('dart', 3, -1, 'dip', 44, { gap: 0.4 })],
    [9.6, swoopers('dart', 3, 1, 'dip', 44, { gap: 0.4 })],
    [11.8, holdRow('carapace', [64, 176], { ty: 72, hold: 7, sway: 14, gap: 0.6 })],
    [13.5, halo('mite', 10, { x: CX, r: 34, vy: 30 })],
    [17.0, squad('dart', 'vee', 5, swoop(-1, 'pass', 40, 60, 3.0, 120), { sp: 15, bonus: 'bomb' })],
  ),
  breather(12, 2),
  { dt: 0.4, ...pickup('life', CX, 60) },

  // D — peak: squadrons from both flanks, ring-eyes, the last gunship
  ...block(
    [1.0, squad('dart', 'vee', 5, swoop(-1, 'u', 30, 90, 3.6, 110), { sp: 15 })],
    [1.0, squad('dart', 'vee', 5, swoop(1, 'u', 30, 90, 3.6, 110), { sp: 15 })],
    [4.2, holdRow('eye_ring', [CX], { ty: 78, hold: 6 })],
    [5.6, pincer('mite', 6, { vx: 64, vy: 46, d: 0.2, bonusR: 'overdrive' })],
    [8.0, sineTrain('wisp_ring', 2, { x: 70, vy: 30, amp: 40, freq: 0.25, d: 1.6 })],
    [8.4, sineTrain('wisp_ring', 2, { x: 170, vy: 30, amp: 40, freq: 0.25, d: 1.6, ph: PI })],
    [11.0, squad('dart', 'arrow', 5, swoop(-1, 'arc', 22, 110, 4.0, 110), { sp: 15 })],
    [11.8, squad('dart', 'arrow', 5, swoop(1, 'arc', 22, 110, 4.0, 110), { sp: 15 })],
    [14.6, holdRow('eye', [56, 184], { ty: 96, hold: 5 })],
    [16.0, holdRow('carapace', [CX], { ty: 84, hold: 7, sway: 30, swayF: 0.12 })],
    [18.0, sineTrain('mite', 7, { x: 60, d: 0.2, amp: 26, freq: 0.5 })],
    [18.4, sineTrain('mite', 7, { x: 180, d: 0.2, amp: 26, freq: 0.5, ph: PI })],
    [21.0, squad('dart', 'wall', 8, { path: 'line', x: CX, y: -20, vy: 46 }, { sp: 20, rot: 0 })],
    [24.6, holdRow('eye_ring', [70, 170], { ty: 70, hold: 4.5, gap: 0.4 })],
  ),
  breather(9, 2),

  // E — breather: a gem shower from weaving wisps, then the shipyard's guardian wakes
  ...block(
    [0.6, sineTrain('wisp', 5, { x: CX, vy: 44, amp: 84, freq: 0.24, d: 0.55 })],
    [3.0, cue('dawn')],
  ),
  breather(6, 4),
  ...finale('warden', 'THE WARDEN'),
];

// ======================================================================================
// S2 — CINDER BELT: asteroid mining belt at a red giant. Rocks drift through everything.
// lancets, weavers, mines, hornets; BASTION FRIGATE mid-boss; boss: THE WYRM
// ======================================================================================

const cinder = [
  // A — into the belt: debris, the first lock-on divers, the first curtain
  ...block(
    [1.2, rocks('rock_s', 5, 1.3, { seed: 0.1 })],
    [3.6, sineTrain('mite', 8, { x: CX, d: 0.22, amp: 70, freq: 0.32, vy: 48, bonus: 'power' })],
    [7.0, lancets('lancet', [60, 180, 120], { ty: 70, pause: 0.85, gap: 0.55 })],
    [9.8, rocks('rock_m', 3, 1.5, { seed: 0.4 })],
    [11.2, squad('dart', 'vee', 5, swoop(-1, 'pass', 44, 70, 3.2, 120), { sp: 15 })],
    [14.6, weaver('weaver', -1, 62)],
    [19.8, mines('mine', [50, 97, 143, 190], { vy: 26, fuse: 5 })],
    [22.4, lancets('lancet', [40, 200, 90, 150], { ty: 64, pause: 0.75, gap: 0.5 })],
    [26.2, holdRow('hornet', [CX], { ty: 100 })],
    [27.2, sineTrain('mite', 6, { x: 44, d: 0.22, amp: 16 })],
    [27.6, sineTrain('mite', 6, { x: 196, d: 0.22, amp: 16, ph: PI })],
    [31.0, [rocks('rock_l', 1, 0, { seed: 0.2 }), rocks('rock_m', 2, 1.4, { seed: 0.7 })]],
    [33.2, swoopers('dart', 3, -1, 'hook', 40, { gap: 0.4 })],
    [33.8, swoopers('dart', 3, 1, 'hook', 50, { gap: 0.4 })],
    [37.0, mines('mine', [70, 120, 170], { vy: 30 })],
    [38.6, lancets('lancet', [CX], { ty: 88, pause: 0.8 })],
    [40.0, rocks('rock_m', 2, 1.2, { seed: 0.9 })],
  ),
  breather(6, 1.5),

  // B — ASTEROID STORM
  ...block(
    [0, [banner('ASTEROID STORM', 'Brace for debris'), cue('flare')]],
    [0.4, rocks('rock_l', 3, 4.2, { seed: 0.3, vx: 6 })],
    [0.8, rocks('rock_m', 6, 1.9, { seed: 0.55 })],
    [1.4, rocks('rock_s', 10, 1.1, { seed: 0.05, vy0: 34, vy1: 48 })],
    [3.2, lancets('lancet', [50, 120, 190], { ty: 60, pause: 0.7, gap: 0.4 })],
    [7.0, mines('mine', [36, 84, 132, 180, 214], { vy: 24, vx: 6 })],
    [9.4, weaver('weaver', 1, 84)],
    [14.6, lancets('lancet', [70, 170, 30, 210], { ty: 76, pause: 0.7, gap: 0.45 })],
    [16.2, sineTrain('mite', 7, { x: 84, d: 0.22, amp: 24, bonus: 'overdrive' })],
    [18.6, holdRow('hornet', [66, 174], { tys: [92, 116], gap: 0.8 })],
    [22.6, squad('dart', 'vee', 5, swoop(1, 'u', 36, 90, 3.6, 110), { sp: 15 })],
    [26.0, rocks('rock_s', 4, 1.0, { seed: 0.33 })],
    [27.0, weaver('weaver', -1, 70)],
    [30.4, pickup('bomb', CX, 40)],
    [31.4, lancets('lancet', [40, 200], { ty: 80, pause: 0.7, gap: 0.3 })],
    [33.4, holdRow('hornet', [CX], { ty: 108 })],
    [35.0, sineTrain('mite', 6, { x: 60, d: 0.22, amp: 18 })],
    [35.4, sineTrain('mite', 6, { x: 180, d: 0.22, amp: 18, ph: PI })],
    [37.8, squad('dart', 'vee', 5, swoop(-1, 'u', 30, 90, 3.6, 110), { sp: 15 })],
    [39.8, mines('mine', [90, 150], { vy: 30 })],
  ),
  breather(8, 1.5),

  // C — MID-BOSS: BASTION FRIGATE
  ...block(
    [0, [banner('BASTION FRIGATE', 'Choir warship closing'), cue('flare')]],
    [0.8, bastion('bastion', { stay: 40 })],
  ),
  breather(50, 0.5),
  { dt: 1.0, ...pickup('life', CX, 70) },

  // D — peak: elite curtains, lance divers and mine fields through a dense belt
  ...block(
    [0.8, [cue('flare'), rocks('rock_m', 4, 1.6, { seed: 0.12 }), rocks('rock_s', 6, 1.2, { seed: 0.8 })]],
    [1.6, weaver('weaver_elite', -1, 66)],
    [4.0, lancets('lancet_elite', [70, 170], { ty: 70, pause: 0.7, gap: 0.5 })],
    [5.0, lancets('lancet', [30, 210, 110, 130], { ty: 58, pause: 0.7, gap: 0.35 })],
    [8.4, mines('mine_elite', [60, 180], { vy: 22, gap: 0.4 })],
    [8.8, mines('mine', [30, 105, 135, 210], { vy: 28 })],
    [11.2, holdRow('hornet_elite', [CX], { ty: 96 })],
    [13.6, rocks('rock_l', 2, 3.0, { seed: 0.66 })],
    [14.2, weaver('weaver', 1, 92)],
    [17.4, squad('dart_elite', 'vee', 5, swoop(-1, 'u', 32, 90, 3.6, 110), { sp: 16, bonus: 'overdrive' })],
    [19.6, lancets('lancet', [40, 200, 80, 160, 120, 20], { ty: 64, pause: 0.65, gap: 0.3 })],
  ),
  breather(9, 2),

  // E — breather in the dust: drifting rocks and gem wisps
  ...block(
    [0.4, rocks('rock_m', 3, 1.8, { seed: 0.25, vy0: 22, vy1: 30 })],
    [1.0, sineTrain('wisp', 4, { x: CX, vy: 42, amp: 80, freq: 0.24, d: 0.6 })],
    [3.4, cue('flare')],
  ),
  breather(5, 3.2),
  ...finale('wyrm', 'THE MAGMA WYRM'),
];

// ======================================================================================
// S3 — VEIL NEBULA: crystal storms in a stellar nursery. Lightning lights the clouds.
// shards, phantoms, wisps, sentinels, eyes; PRISM BASTION mid-boss; boss: THE PRISM
// ======================================================================================

const veil = [
  // A — things materialise out of the cloud
  ...block(
    [1.8, cue('lightning')],
    [3.6, sineTrain('wisp', 5, { x: CX, vy: 40, amp: 70, freq: 0.24, d: 0.45, bonus: 'power' })],
    [7.2, shardsAt('shard', [[60, 70], [120, 52], [180, 70]])],
    [11.6, sineTrain('mite_shot', 5, { x: 60, d: 0.3, amp: 22 })],
    [12.0, sineTrain('mite_shot', 5, { x: 180, d: 0.3, amp: 22, ph: PI })],
    [15.0, hoverAt('phantom', [[CX, 92]], { cycles: 3 })],
    [19.2, [cue('lightning'), shardsAt('shard', [[40, 104], [200, 104]])]],
    [20.2, sineTrain('wisp_ring', 2, { x: CX, vy: 30, amp: 50, freq: 0.24, d: 1.5 })],
    [24.2, holdRow('eye_ring', [66, 174], { ty: 70, hold: 6, gap: 0.5 })],
    [28.2, squad('dart', 'vee', 5, swoop(-1, 'u', 34, 90, 3.6, 110), { sp: 15 })],
    [28.8, squad('dart', 'vee', 5, swoop(1, 'u', 46, 90, 3.6, 110), { sp: 15 })],
    [31.6, hoverAt('phantom', [[64, 84], [176, 104]], { cycles: 2, gap: 0.8 })],
    [35.6, [cue('lightning'), shardsAt('shard', [[50, 60], [120, 90], [190, 60]])]],
    [39.4, hoverAt('phantom', [[CX, 70]], { cycles: 2 })],
    [41.0, sineTrain('mite_shot', 6, { x: CX, d: 0.26, amp: 60, freq: 0.3 })],
  ),
  breather(7, 1.5),

  // B — STORM FRONT: the first sentinel
  ...block(
    [0, [banner('STORM FRONT', 'Crystal lightning in the Veil'), cue('lightning', 1)]],
    [1.2, hoverAt('sentinel', [[CX, 84]], { warp: 1, life: 15 })],
    [3.4, halo('mite_shot', 8, { x: 60, r: 24 })],
    [4.4, halo('mite_shot', 8, { x: 180, r: 24, w: -1.8 })],
    [7.4, shardsAt('shard', [[36, 130], [204, 130]])],
    [10.2, sineTrain('wisp', 5, { x: CX, vy: 40, amp: 88, freq: 0.24, d: 0.45, bonus: 'power' })],
    [12.4, cue('lightning')],
    [13.2, hoverAt('phantom', [[70, 80], [170, 80]], { cycles: 2, gap: 0.6 })],
    [17.4, holdRow('eye_elite', [CX], { ty: 76, hold: 6 })],
    [19.6, pickup('bomb', CX, 40)],
    [21.0, [cue('lightning'), shardsAt('shard_elite', [[64, 64], [176, 64]])]],
    [22.4, squad('dart_elite', 'vee', 3, swoop(-1, 'hook', 50, 100, 3.4, 110), { sp: 16 })],
    [25.6, holdRow('eye_ring', [60, 180], { ty: 90, hold: 5, gap: 0.4 })],
    [27.4, [cue('lightning'), shardsAt('shard', [[CX, 60]])]],
    [29.0, halo('wisp', 6, { x: CX, r: 30, vy: 34 })],
    [32.4, hoverAt('phantom', [[CX, 76]], { cycles: 2 })],
  ),
  breather(9, 1.5),

  // C — MID-BOSS: PRISM BASTION
  ...block(
    [0, [banner('PRISM BASTION', 'Crystal frigate materialising'), cue('lightning', 1)]],
    [0.8, bastion('bastion_crystal', { stay: 44 })],
  ),
  breather(52, 0.5),
  { dt: 0.6, ...cue('lightning') },
  { dt: 0.6, ...pickup('life', CX, 70) },

  // D — peak: elite crystals, phase ghosts and a sentinel under constant lightning
  ...block(
    [0.8, [cue('lightning', 1), shardsAt('shard_elite', [[50, 70], [120, 50], [190, 70]], { gap: 0.25 })]],
    [3.4, hoverAt('phantom_elite', [[CX, 104]], { cycles: 3 })],
    [5.2, sineTrain('mite_shot', 6, { x: 40, d: 0.26, amp: 16 })],
    [5.6, sineTrain('mite_shot', 6, { x: 200, d: 0.26, amp: 16, ph: PI })],
    [8.4, [cue('lightning'), hoverAt('sentinel', [[CX, 72]], { warp: 1, life: 13 })]],
    [9.8, sineTrain('wisp_ring', 2, { x: 50, vy: 32, amp: 30, freq: 0.25, d: 1.6 })],
    [10.2, sineTrain('wisp_ring', 2, { x: 190, vy: 32, amp: 30, freq: 0.25, d: 1.6, ph: PI, bonus: 'power' })],
    [13.0, holdRow('eye_elite', [56, 184], { ty: 100, hold: 5, gap: 0.4 })],
    [15.4, [cue('lightning'), squad('dart_elite', 'vee', 5, swoop(1, 'u', 32, 90, 3.6, 110), { sp: 16 })]],
    [18.0, shardsAt('shard', [[CX, 50], [70, 90], [170, 90], [CX, 130]], { gap: 0.2 })],
    [19.8, hoverAt('phantom', [[60, 70], [180, 70]], { cycles: 2, gap: 0.4 })],
    [22.6, [cue('lightning', 1), squad('dart', 'arrow', 7, swoop(-1, 'arc', 24, 110, 4.2, 110), { sp: 15 })]],
    [24.8, shardsAt('shard_elite', [[CX, 76]])],
  ),
  breather(10, 2),

  // E — calm eye of the storm: wisps and a last gem shower
  ...block(
    [0.6, sineTrain('wisp', 6, { x: CX, vy: 46, amp: 86, freq: 0.26, d: 0.45 })],
    [2.6, cue('lightning')],
    [4.4, sineTrain('wisp', 4, { x: CX, vy: 40, amp: 50, freq: 0.3, d: 0.5, ph: PI })],
  ),
  breather(6, 4),
  { dt: 0.4, ...cue('lightning', 1) },
  ...finale('prism', 'THE PRISM'),
];

// ======================================================================================
// S4 — LEVIATHAN WRECK: low over the hull of a dead dreadnought. The hull shoots back.
// hull turrets, seekers, weavers, carapaces; DERELICT BASTION mid-boss; boss: DREADNOUGHT
// ======================================================================================

const wreck = [
  // A — the hull guns wake up
  ...block(
    [2.0, turrets('turret', [52, 188], { dy: 26 })],
    [3.6, sineTrain('mite', 7, { x: CX, d: 0.22, amp: 60, freq: 0.36, bonus: 'power' })],
    [7.0, seekers(4, { xs: [50, 190, 90, 150], gap: 0.4 })],
    [9.4, turrets('turret', [80, 160], { rail: 26 })],
    [11.6, squad('dart', 'vee', 5, swoop(-1, 'u', 34, 90, 3.6, 110), { sp: 15 })],
    [14.8, weaver('weaver', -1, 60)],
    [19.2, turrets('turret_heavy', [CX])],
    [20.8, seekers(3, { from: 'left', xs: [90, 140, 190], gap: 0.3 })],
    [21.4, seekers(3, { from: 'right', xs: [110, 160, 70], gap: 0.3 })],
    [24.6, holdRow('carapace', [CX], { ty: 88, hold: 7, sway: 30 })],
    [28.6, turrets('turret', [40, 200, 90, 150], { dy: 34 })],
    [31.6, sineTrain('mite_shot', 5, { x: 60, d: 0.3, amp: 20 })],
    [32.0, sineTrain('mite_shot', 5, { x: 180, d: 0.3, amp: 20, ph: PI })],
    [35.2, turrets('turret_flak', [CX])],
    [38.4, seekers(4, { from: 'right', xs: [80, 130, 180, 110], gap: 0.3 })],
    [40.2, turrets('turret_heavy', [64, 176], { dy: 24 })],
  ),
  breather(6, 1.5),

  // B — HULL BREACH: the defence grid comes online
  ...block(
    [0, [banner('HULL BREACH', 'Defence grid online'), cue('breach', breachPts)]],
    [1.0, turrets('turret_flak', [58, 182], { dy: 20 })],
    [1.6, turrets('turret', [120], { y: -40, rail: 40 })],
    [3.4, seekers(5, { gap: 0.28 })],
    [6.6, weaver('weaver', 1, 82)],
    [10.2, holdRow('carapace', [70, 170], { ty: 80, hold: 7, sway: 12, gap: 0.6 })],
    [14.4, turrets('turret_heavy', [60, 180], { dy: 30 })],
    [16.4, seekers(4, { from: 'left', xs: [70, 130, 180, 100], gap: 0.3 })],
    [18.8, sineTrain('mite', 7, { x: 70, d: 0.2, amp: 22, bonus: 'power' })],
    [19.4, cue('breach', breachPts)],
    [21.8, pickup('bomb', CX, 40)],
    [23.2, weaver('weaver_elite', -1, 64)],
    [25.0, turrets('turret', [30, 210], { rail: 18 })],
    [27.8, holdRow('carapace', [CX], { ty: 70, hold: 6, sway: 34 })],
    [30.4, seekers(5, { gap: 0.3 })],
    [32.6, turrets('turret_flak', [60, 180], { dy: 30 })],
    [35.2, seekers(4, { from: 'left', xs: [60, 120, 180, 90], gap: 0.3 })],
    [36.8, turrets('turret', [100, 140], { rail: 30 })],
  ),
  breather(8, 1.5),

  // C — MID-BOSS: DERELICT BASTION
  ...block(
    [0, [banner('DERELICT BASTION', 'Scavenged warship powering up'), cue('breach', breachPts)]],
    [0.8, bastion('bastion_wreck', { stay: 46 })],
  ),
  breather(54, 0.5),
  { dt: 1.0, ...pickup('life', CX, 70) },

  // D — peak: TURRET GAUNTLET
  ...block(
    [0.2, [banner('TURRET GAUNTLET', 'Thread the hull guns'), cue('breach', breachPts)]],
    [1.0, turrets('turret_heavy', [40, 200])],
    [1.2, turrets('turret_flak', [CX], { y: -30 })],
    [1.4, turrets('turret', [80, 160], { y: -62 })],
    [4.0, seekers(6, { gap: 0.26 })],
    [7.0, holdRow('carapace_elite', [CX], { ty: 84, hold: 8, sway: 28 })],
    [10.0, turrets('turret', [50, 190, 120], { dy: 30, rail: 22 })],
    [11.4, weaver('weaver', -1, 70)],
    [13.8, seekers(4, { from: 'left', xs: [80, 140, 200, 110], gap: 0.25 })],
    [14.2, seekers(4, { from: 'right', xs: [100, 160, 60, 130], gap: 0.25 })],
    [16.8, squad('dart_elite', 'vee', 5, swoop(1, 'u', 34, 90, 3.6, 110), { sp: 16, bonus: 'power' })],
    [17.4, turrets('turret_heavy', [CX], { y: -24 })],
    [20.0, cue('breach', breachPts)],
  ),
  breather(9, 2),

  // E — quiet stretch of hull: gem wisps drifting over the plating
  ...block(
    [0.6, sineTrain('wisp', 5, { x: CX, vy: 44, amp: 80, freq: 0.24, d: 0.55 })],
    [2.8, turrets('turret', [60, 180], { dy: 40 })],
  ),
  breather(6, 4),
  { dt: 0.2, ...cue('breach', breachPts) },
  ...finale('dread', 'THE DREADNOUGHT'),
];

// ======================================================================================
// S5 — EVENT HORIZON: the Choir's honour guard at the singularity. Densest, still fair.
// sentinels and elite variants; mid-boss GAUNTLET (sentinel pair → VOID BASTION);
// boss: THE CHOIR HEART
// ======================================================================================

const horizon = [
  // A — the whole Choir, elite
  ...block(
    [1.6, cue('pulse')],
    [3.6, sineTrain('mite_shot', 6, { x: 60, d: 0.26, amp: 22 })],
    [4.0, sineTrain('mite', 8, { x: CX, d: 0.2, amp: 70, freq: 0.34, bonus: 'power' })],
    [4.4, sineTrain('mite_shot', 6, { x: 180, d: 0.26, amp: 22, ph: PI })],
    [7.8, squad('dart_elite', 'vee', 5, swoop(-1, 'u', 32, 90, 3.6, 110), { sp: 16 })],
    [8.6, squad('dart_elite', 'vee', 5, swoop(1, 'u', 44, 90, 3.6, 110), { sp: 16 })],
    [12.0, hoverAt('sentinel', [[CX, 78]], { warp: 1, life: 13 })],
    [15.0, lancets('lancet_elite', [50, 190, 120], { ty: 66, pause: 0.75, gap: 0.45 })],
    [19.0, sineTrain('wisp_ring', 3, { x: CX, vy: 32, amp: 70, freq: 0.22, d: 1.2 })],
    [22.4, holdRow('eye_elite', [60, 180], { ty: 80, hold: 5.5, gap: 0.4 })],
    [28.6, holdRow('hornet_elite', [CX], { ty: 100 })],
    [29.4, mines('mine_elite', [40, 200], { vy: 22, gap: 0.3 })],
    [33.2, hoverAt('phantom_elite', [[70, 88], [170, 108]], { cycles: 2, gap: 0.7 })],
    [37.0, shardsAt('shard_elite', [[50, 66], [120, 48], [190, 66]], { gap: 0.25 })],
    [40.2, halo('mite_shot', 10, { x: CX, r: 34, vy: 38, core: 'wisp_ring' })],
  ),
  breather(8, 1.5),

  // B — GRAVITY WELL: twin sentinels, curtains, kamikazes
  ...block(
    [0, [banner('GRAVITY WELL', 'Space is folding'), cue('pulse')]],
    [1.2, hoverAt('sentinel', [[66, 76], [174, 96]], { warp: 1, life: 12, gap: 0.6 })],
    [6.0, seekers(4, { from: 'left', xs: [60, 110, 160, 210], gap: 0.3 })],
    [7.0, sineTrain('mite', 7, { x: 180, d: 0.2, amp: 24, bonus: 'power' })],
    [10.0, seekers(4, { from: 'right', xs: [80, 130, 180, 110], gap: 0.3 })],
    [13.6, weaver('weaver_elite', 1, 70)],
    [17.0, [cue('pulse'), pickup('bomb', CX, 40)]],
    [18.0, holdRow('carapace_elite', [CX], { ty: 84, hold: 7, sway: 30 })],
    [21.0, lancets('lancet_elite', [40, 200, 90, 150], { ty: 60, pause: 0.7, gap: 0.4 })],
    [23.6, squad('dart_elite', 'arrow', 5, swoop(-1, 'arc', 24, 110, 4.0, 110), { sp: 16 })],
  ),
  breather(9, 1.5),

  // C — THE GAUNTLET: honour guard sentinels, then the VOID BASTION
  ...block(
    [0, [banner('THE GAUNTLET', 'The Choir\'s honour guard'), cue('pulse')]],
    [1.2, hoverAt('sentinel_elite', [[70, 80], [170, 100]], { warp: 1, life: 13, gap: 1.0 })],
  ),
  breather(15, 1),
  ...block(
    [0.8, [banner('VOID BASTION', 'Last gate before the Heart'), cue('pulse')]],
    [1.6, bastion('bastion_void', { stay: 42 })],
  ),
  breather(48, 0.5),
  { dt: 1.0, ...pickup('life', CX, 70) },

  // D — peak: the final push
  ...block(
    [0.8, [cue('pulse'), squad('dart_elite', 'vee', 5, swoop(-1, 'u', 30, 90, 3.6, 110), { sp: 16 })]],
    [1.4, squad('dart_elite', 'vee', 5, swoop(1, 'u', 30, 90, 3.6, 110), { sp: 16 })],
    [4.0, holdRow('eye_elite', [CX], { ty: 76, hold: 6 })],
    [5.6, lancets('lancet_elite', [30, 210], { ty: 90, pause: 0.7, gap: 0.3 })],
    [8.2, hoverAt('sentinel', [[70, 70]], { warp: 1, life: 10 })],
    [9.0, sineTrain('mite_shot', 6, { x: 190, d: 0.24, amp: 18, ph: PI, bonus: 'power' })],
    [12.4, holdRow('hornet_elite', [176], { ty: 92 })],
    [14.4, mines('mine_elite', [50, 110, 170], { vy: 24, gap: 0.3 })],
    [16.6, [cue('pulse'), shardsAt('shard_elite', [[60, 90], [180, 90]], { gap: 0.2 })]],
    [18.6, squad('dart_elite', 'arrow', 7, swoop(1, 'arc', 24, 110, 4.0, 110), { sp: 15 })],
  ),
  breather(10, 2),

  // E — the calm before the Heart: a last shower of gems, the horizon pulses
  ...block(
    [0.6, sineTrain('wisp', 6, { x: CX, vy: 46, amp: 86, freq: 0.26, d: 0.45 })],
    [2.4, cue('pulse')],
  ),
  breather(5, 3.2),
  ...finale('heart', 'THE CHOIR HEART', 'finalboss', 1.2),
];

export const STAGES = {
  aurora: { script: aurora, cues: CUES },
  cinder: { script: cinder, cues: CUES },
  veil: { script: veil, cues: CUES },
  wreck: { script: wreck, cues: CUES },
  horizon: { script: horizon, cues: CUES },
};

void W; void FIELD_H;
