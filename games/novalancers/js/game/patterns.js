// Nova Lancers — enemy bullet pattern library.
//
// A pattern is a pure function (sim, x, y, args, rng, src) that spawns enemy bullets with
// sim.eb(spec), beams with sim.beam(spec) and timed emitters with sim.emit(spec).
// Patterns run on EVERY peer (from host 'fire' events), so they must be deterministic:
// use only args, rng (seeded per fire event) and the emitter's own state — never
// Math.random, never player positions (except via bullet `home`/emitter `aimAt`).
//
// args.a  = angle chosen by the host (usually aimed at a player) — radians, 0 = right, PI/2 = down.
// args.v  = speed in px/tick. Extra bullet props (acc, vmin, vmax, spin, spinT, delay, life,
//           home, homeRate, homeT, grav, wave, burst, noGraze, r) pass through via bulletProps(),
//           so ANY pattern can be made to curve (spin/spinT), accelerate (acc/vmax), telegraph
//           (delay: bullets flicker harmlessly at the muzzle for `delay` ticks) or home.
// args.follow = 1 makes emitter/beam patterns ride on the firing enemy (they stop if it dies);
//           ox/oy = offset from the enemy center.
// args.target = player slot for homing/stream/stopAim patterns.
// args.silent = 1 suppresses the engine's per-event shot sound (patterns that voice their own
//           sounds set it themselves).
//
// Catalog (full arg lists next to each function):
//   single-shot: shot fan shotgun ring flower spray wall cluster lines petal polygon aimRing
//                accelRing layered homing snipe refract stopAim orbitRing implode crossfire
//                lattice fountain burstChain
//   emitters:    spiral rings stream sweep crossSpiral curtain rain wave barrage trail mineLayer
//   beams:       beam laserFan
//   internal:    _chainRing _fanPop _reaim _drop _popRing (used as bullet `burst` sub-patterns)

import { TAU } from '../util.js';
import { FIELD_W } from '../config.js';

const PASS = ['acc', 'vmin', 'vmax', 'spin', 'spinT', 'delay', 'life', 'home', 'homeRate', 'homeT', 'grav', 'wave', 'burst', 'noGraze', 'r'];

export function bulletProps(args, out = {}) {
  for (const k of PASS) if (args[k] !== undefined) out[k] = args[k];
  return out;
}

function shot(sim, x, y, a, v, spr, args, extra) {
  const s = bulletProps(args, { x, y, a, v, spr });
  if (extra) Object.assign(s, extra);
  // guard: a geometric arg that happens to be called `r` must never become a huge invisible
  // hitbox (the biggest bullet sprite has r = 6)
  if (s.r !== undefined && !(s.r > 0 && s.r <= 8)) delete s.r;
  return sim.eb(s);
}

export const PATTERNS = {
  // single bullet
  shot(sim, x, y, A) {
    shot(sim, x, y, A.a ?? Math.PI / 2, A.v ?? 1.6, A.spr || 'eb_orb_p', A);
  },

  // n bullets spread over `spread` radians centered on a
  fan(sim, x, y, A) {
    const n = A.n || 3, sp = A.spread ?? 0.5, a = A.a ?? Math.PI / 2;
    for (let i = 0; i < n; i++) {
      const aa = n === 1 ? a : a - sp / 2 + (sp * i) / (n - 1);
      shot(sim, x, y, aa, A.v ?? 1.6, A.spr || 'eb_small_p', A);
    }
  },

  // layered fan: `layers` fans with increasing speed (classic "shotgun")
  shotgun(sim, x, y, A) {
    const layers = A.layers || 3;
    for (let l = 0; l < layers; l++) {
      PATTERNS.fan(sim, x, y, Object.assign({}, A, { v: (A.v ?? 1.3) + l * (A.dv ?? 0.35), n: (A.n || 5) - (l % 2) }));
    }
  },

  // full ring of n bullets
  ring(sim, x, y, A) {
    const n = A.n || 16, a0 = A.a0 ?? A.a ?? 0;
    for (let i = 0; i < n; i++) shot(sim, x, y, a0 + (TAU * i) / n, A.v ?? 1.2, A.spr || 'eb_small_v', A);
  },

  // ring with alternating speeds (flower/petal look)
  flower(sim, x, y, A) {
    const n = A.n || 24, a0 = A.a0 ?? 0, v = A.v ?? 1.2, dv = A.dv ?? 0.5;
    for (let i = 0; i < n; i++) {
      const k = Math.abs(Math.sin((i / n) * Math.PI * (A.petals || 4)));
      shot(sim, x, y, a0 + (TAU * i) / n, v + dv * k, A.spr || 'eb_small_p', A);
    }
  },

  // random spray inside a cone
  spray(sim, x, y, A, rng) {
    const n = A.n || 8, a = A.a ?? Math.PI / 2, sp = A.spread ?? 1.2;
    for (let i = 0; i < n; i++) {
      shot(sim, x, y, a + (rng.next() - 0.5) * sp, (A.vmin ?? 1.0) + rng.next() * ((A.vmax ?? 2.2) - (A.vmin ?? 1.0)),
        A.spr || 'eb_small_o', A, { vmin: 0, vmax: 8 });
    }
  },

  // horizontal wall of bullets falling with one gap: {n, gap (index), v, spr, width}
  wall(sim, x, y, A) {
    const n = A.n || 13, w = A.width || 220, gap = A.gap ?? -1, gw = A.gapW || 2;
    for (let i = 0; i < n; i++) {
      if (gap >= 0 && i >= gap && i < gap + gw) continue;
      const bx = x - w / 2 + (w * i) / (n - 1);
      shot(sim, bx, y, Math.PI / 2, A.v ?? 1.1, A.spr || 'eb_orb_o', A);
    }
  },

  // bullets that fly then burst into a ring: {n (carriers), a, spread, v, t (ticks), ringN, ringV, spr, ringSpr}
  cluster(sim, x, y, A) {
    const n = A.n || 1, sp = A.spread ?? 0.6, a = A.a ?? Math.PI / 2;
    for (let i = 0; i < n; i++) {
      const aa = n === 1 ? a : a - sp / 2 + (sp * i) / (n - 1);
      sim.eb({
        x, y, a: aa, v: A.v ?? 1.8, acc: -0.02, vmin: 0.3, spr: A.spr || 'eb_big_o',
        burst: { t: A.t || 50, pat: 'ring', args: { n: A.ringN || 12, v: A.ringV || 1.3, spr: A.ringSpr || 'eb_small_o', a0: aa } },
      });
    }
  },

  // --- timed emitters -------------------------------------------------------------------

  // rotating spiral: {arms, v, every (ticks), count, da (rad/shot), a0, spr, follow}
  spiral(sim, x, y, A, rng, src) {
    const arms = A.arms || 2, da = A.da ?? 0.22, a0 = A.a0 ?? 0;
    sim.emit({
      x, y, follow: A.follow ? src : 0, ox: A.ox || 0, oy: A.oy || 0,
      every: A.every || 5, count: A.count || 24, delay: A.delay0 || 0,
      fn(sim, em, k) {
        for (let j = 0; j < arms; j++) {
          shot(sim, em.x, em.y, a0 + k * da + (TAU * j) / arms, A.v ?? 1.3, A.spr || 'eb_small_v', A);
        }
        if (k % 3 === 0) sim.sfxAt('enemy_shot', em.x, 0.35);
      },
    });
  },

  // repeated rings: {n, v, count, every, rot, spr}
  rings(sim, x, y, A, rng, src) {
    const n = A.n || 12, rot = A.rot ?? 0.13;
    sim.emit({
      x, y, follow: A.follow ? src : 0, ox: A.ox || 0, oy: A.oy || 0,
      every: A.every || 18, count: A.count || 4,
      fn(sim, em, k) {
        for (let i = 0; i < n; i++) shot(sim, em.x, em.y, (A.a0 || 0) + k * rot + (TAU * i) / n, A.v ?? 1.2, A.spr || 'eb_orb_v', A);
        sim.sfxAt('enemy_shot_heavy', em.x, 0.5);
      },
    });
  },

  // aimed stream at a target slot, re-aimed each shot: {target, v, count, every, spread, spr}
  // (re-aiming uses local player positions; the targeted player sees it exactly on their own device)
  stream(sim, x, y, A, rng, src) {
    sim.emit({
      x, y, follow: A.follow ? src : 0, ox: A.ox || 0, oy: A.oy || 0,
      every: A.every || 6, count: A.count || 8,
      fn(sim, em, k) {
        const p = sim.players[A.target ?? 0];
        const a = p && p.alive ? Math.atan2(p.y - em.y, p.x - em.x) : (A.a ?? Math.PI / 2);
        const n = A.n || 1, sp = A.spread || 0;
        for (let i = 0; i < n; i++) {
          const aa = n === 1 ? a : a - sp / 2 + (sp * i) / (n - 1);
          shot(sim, em.x, em.y, aa, A.v ?? 2.0, A.spr || 'eb_needle_p', A);
        }
        if (k % 2 === 0) sim.sfxAt('enemy_shot', em.x, 0.4);
      },
    });
  },

  // sweeping fan: a fan whose center angle sweeps from a0 to a1 over count volleys
  sweep(sim, x, y, A, rng, src) {
    const a0 = A.a0 ?? 0.4, a1 = A.a1 ?? Math.PI - 0.4, count = A.count || 16;
    sim.emit({
      x, y, follow: A.follow ? src : 0, ox: A.ox || 0, oy: A.oy || 0,
      every: A.every || 4, count,
      fn(sim, em, k) {
        const u = count === 1 ? 0 : k / (count - 1);
        const a = a0 + (a1 - a0) * (A.pingpong ? (u < 0.5 ? u * 2 : 2 - u * 2) : u);
        PATTERNS.fan(sim, em.x, em.y, Object.assign({}, A, { a }));
        if (k % 3 === 0) sim.sfxAt('enemy_shot', em.x, 0.35);
      },
    });
  },

  // telegraphed laser: {a, av, avT, w, warn, dur, len, pal, follow, ox, oy}
  beam(sim, x, y, A, rng, src) {
    sim.beam({
      x, y, a: A.a ?? Math.PI / 2, av: A.av || 0, avT: A.avT, w: A.w || 10, warn: A.warn ?? 48, dur: A.dur ?? 70,
      len: A.len || 520, pal: A.pal || 'magenta', follow: A.follow ? src : 0, ox: A.ox || 0, oy: A.oy || 0,
    });
  },
};

// ---------------------------------------------------------------------------------------
// Extended library (roster + boss authors). Every entry: deterministic, args documented.

const PI = Math.PI;
const HALF = Math.PI / 2;

// n angles spread over `sp` radians centered on a (single angle when n = 1)
function spreadAngle(a, sp, i, n) { return n === 1 ? a : a - sp / 2 + (sp * i) / (n - 1); }

// Take over the event's sound: silence the engine's default shot sfx and play our own.
function voice(sim, A, x, name, vol) {
  A.silent = 1;
  if (name) sim.sfxAt(name, x, vol ?? 0.5);
}

function emitterBase(A, x, y, src) {
  return { x, y, follow: A.follow ? src : 0, ox: A.ox || 0, oy: A.oy || 0, delay: A.delay0 || 0 };
}

const LIB = {
  // aimed spread of bullet LINES: `ways` directions × `per` bullets each (speeds v, v+dv, …)
  // {a, ways=3, spread=0.5, per=4, v=1.6, dv=0.22, spr='eb_needle_p'}
  lines(sim, x, y, A) {
    const ways = A.ways || 3, per = A.per || 4, sp = A.spread ?? 0.5, a = A.a ?? HALF;
    for (let i = 0; i < ways; i++) {
      const aa = spreadAngle(a, sp, i, ways);
      for (let j = 0; j < per; j++) shot(sim, x, y, aa, (A.v ?? 1.6) + j * (A.dv ?? 0.22), A.spr || 'eb_needle_p', A);
    }
  },

  // flower of pointed petals: {n=6 petals, per=5 bullets/petal, width=0.55 rad, v=1.0,
  //  dv=0.55 (tip speed bonus), a0=0, curl=0 (rad/tick spin, mirrored across each petal so
  //  petals open like a blossom), curlT=40 (ticks of curl), spr='eb_small_p'}
  petal(sim, x, y, A) {
    const n = A.n || 6, per = A.per || 5, w = A.width ?? 0.55, v = A.v ?? 1.0, dv = A.dv ?? 0.55;
    const a0 = A.a0 ?? A.a ?? 0, curl = A.curl || 0;
    for (let i = 0; i < n; i++) {
      const c = a0 + (TAU * i) / n;
      for (let j = 0; j < per; j++) {
        const u = per === 1 ? 0 : (j / (per - 1)) * 2 - 1;
        const extra = curl ? { spin: -curl * u, spinT: A.curlT ?? 40 } : null;
        shot(sim, x, y, c + u * w * 0.5, v + dv * (1 - u * u), A.spr || 'eb_small_p', A, extra);
      }
    }
    voice(sim, A, x, 'enemy_shot_heavy', 0.55);
  },

  // expanding polygon / star outline: {sides=5, per=5 (bullets per edge), v=1.1, a0=-PI/2,
  //  star=0 (inner-vertex radius ratio, e.g. 0.45, turns it into a star), spr='eb_small_v'}
  polygon(sim, x, y, A) {
    const sides = A.sides || 5, per = A.per || 5, v = A.v ?? 1.1, a0 = A.a0 ?? -HALF, star = A.star || 0;
    const nv = star ? sides * 2 : sides;
    const vx = [], vy = [];
    for (let k = 0; k < nv; k++) {
      const r = star && (k & 1) ? star : 1, a = a0 + (TAU * k) / nv;
      vx.push(Math.cos(a) * r); vy.push(Math.sin(a) * r);
    }
    for (let k = 0; k < nv; k++) {
      const k2 = (k + 1) % nv;
      for (let j = 0; j < per; j++) {
        const u = j / per;
        const px = vx[k] + (vx[k2] - vx[k]) * u, py = vy[k] + (vy[k2] - vy[k]) * u;
        shot(sim, x, y, Math.atan2(py, px), v * Math.hypot(px, py), A.spr || 'eb_small_v', A);
      }
    }
    voice(sim, A, x, 'enemy_shot_heavy', 0.55);
  },

  // ring locked to the aim angle: offset 0 puts a bullet ON the aim line, 0.5 straddles it
  // (target sits between two bullets): {n=16, a, v=1.1, offset=0.5, spr='eb_orb_p'}
  aimRing(sim, x, y, A) {
    const n = A.n || 16, a = (A.a ?? HALF) + (TAU / n) * (A.offset ?? 0.5);
    for (let i = 0; i < n; i++) shot(sim, x, y, a + (TAU * i) / n, A.v ?? 1.1, A.spr || 'eb_orb_p', A);
    voice(sim, A, x, 'enemy_shot_heavy', 0.5);
  },

  // ring(s) that start almost still then accelerate — reads as a "breath in, blast out":
  // {n=18, a0, v0=0.25, acc=0.035, vmax=2.2, layers=1, dv0=0.12 (per-layer v0 step),
  //  twist=PI/n (per-layer angle offset), delay=0, spr='eb_orb_v'}
  accelRing(sim, x, y, A) {
    const n = A.n || 18, L = A.layers || 1, a0 = A.a0 ?? A.a ?? 0;
    for (let l = 0; l < L; l++) {
      for (let i = 0; i < n; i++) {
        sim.eb(Object.assign(bulletProps(A), {
          x, y, a: a0 + (TAU * i) / n + l * (A.twist ?? PI / n), v: (A.v0 ?? 0.25) + l * (A.dv0 ?? 0.12),
          acc: A.acc ?? 0.035, vmax: A.vmax ?? 2.2, spr: A.spr || 'eb_orb_v',
        }));
      }
    }
    voice(sim, A, x, 'enemy_shot_heavy', 0.5);
  },

  // thick ring: `layers` concentric rings at increasing speed (optionally twisted):
  // {n=14, layers=3, v=0.9, dv=0.22, a0=0, twist=0 (rad per layer), spr='eb_small_v'}
  layered(sim, x, y, A) {
    const n = A.n || 14, L = A.layers || 3, a0 = A.a0 ?? A.a ?? 0;
    for (let l = 0; l < L; l++) {
      for (let i = 0; i < n; i++) shot(sim, x, y, a0 + (TAU * i) / n + l * (A.twist || 0), (A.v ?? 0.9) + l * (A.dv ?? 0.22), A.spr || 'eb_small_v', A);
    }
    voice(sim, A, x, 'enemy_shot_heavy', 0.55);
  },

  // needles that curve toward a player for a short time, then fly straight:
  // {n=4, a, spread=1.4, v=1.7, target (slot), homeRate=0.04 (rad/tick), homeT=50 (ticks), spr='eb_needle_c'}
  homing(sim, x, y, A) {
    const n = A.n || 4, a = A.a ?? HALF, sp = A.spread ?? 1.4;
    const extra = { home: A.target ?? 0, homeRate: A.homeRate ?? 0.04, homeT: A.homeT ?? 50 };
    for (let i = 0; i < n; i++) shot(sim, x, y, spreadAngle(a, sp, i, n), A.v ?? 1.7, A.spr || 'eb_needle_c', A, extra);
  },

  // telegraphed sniper needles: they appear and flicker (harmless) at the muzzle for `delay`
  // ticks, then launch fast: {n=1, a, spread=0.2, v=2.8, delay=20, spr='eb_needle_p'}
  snipe(sim, x, y, A) {
    const n = A.n || 1, a = A.a ?? HALF, sp = A.spread ?? 0.2;
    for (let i = 0; i < n; i++) shot(sim, x, y, spreadAngle(a, sp, i, n), A.v ?? 2.8, A.spr || 'eb_needle_p', A, { delay: A.delay ?? 20 });
  },

  // needles that split ("refract") mid-flight into `split` needles around their own heading:
  // {n=3, a, spread=0.5, v=2.0, t=34 (ticks), split=2, sp=0.6 (split spread), v2=1.5, spr='eb_needle_c', spr2}
  refract(sim, x, y, A) {
    const n = A.n || 3, a = A.a ?? HALF, sp = A.spread ?? 0.5;
    for (let i = 0; i < n; i++) {
      const aa = spreadAngle(a, sp, i, n);
      sim.eb(Object.assign(bulletProps(A), {
        x, y, a: aa, v: A.v ?? 2.0, spr: A.spr || 'eb_needle_c',
        burst: { t: A.t || 34, pat: '_fanPop', args: { a: aa, n: A.split || 2, spread: A.sp ?? 0.6, v: A.v2 ?? 1.5, spr: A.spr2 || A.spr || 'eb_needle_c', glint: 'crystal' } },
      }));
    }
  },

  // freeze & re-aim: a ring flies out, brakes to a stop, holds, then every bullet snaps toward
  // the target player and fires as a fast needle.
  // {n=12, a0=0, v=1.6, stopT=30 (ticks braking), hold=24 (ticks), v2=2.1, target (slot), spr='eb_orb_p', spr2='eb_needle_p'}
  stopAim(sim, x, y, A) {
    const n = A.n || 12, v = A.v ?? 1.6, st = A.stopT || 30, a0 = A.a0 ?? 0;
    for (let i = 0; i < n; i++) {
      const a = a0 + (TAU * i) / n;
      sim.eb({
        x, y, a, v, acc: -v / st, vmin: 0, spr: A.spr || 'eb_orb_p',
        burst: { t: st + (A.hold ?? 24), pat: '_reaim', args: { a, v: A.v2 ?? 2.1, spr: A.spr2 || 'eb_needle_p', home: A.target ?? 0, homeRate: 4, homeT: 2 } },
      });
    }
    voice(sim, A, x, 'enemy_shot_heavy', 0.5);
  },

  // halo: bullets spawn on a circle around the source moving tangentially and curving
  // around it, then release on their tangent after spinT ticks. k=1 keeps a rotating ring of
  // radius r; k<1 makes the ring "breathe" out to (2/k-1)·r and back while it spins.
  // {n=12, r=16 (ring radius), v=1.1, dir=1 (1 clockwise, -1 counter), k=0.9, spinT=60, a0=0,
  //  spr='eb_orb_v', hitR (optional bullet hit radius; default = the sprite's)}
  orbitRing(sim, x, y, A) {
    const n = A.n || 12, r = A.r || 16, v = A.v ?? 1.1, dir = A.dir || 1, k = A.k ?? 0.9, a0 = A.a0 ?? 0;
    // A.r is the ring radius, NOT the bullet hit radius (bulletProps would pass it through)
    const extra = { spin: (dir * k * v) / r, spinT: A.spinT ?? 60, r: A.hitR };
    for (let i = 0; i < n; i++) {
      const th = a0 + (TAU * i) / n;
      shot(sim, x + Math.cos(th) * r, y + Math.sin(th) * r, th + dir * HALF, v, A.spr || 'eb_orb_v', A, extra);
    }
    voice(sim, A, x, 'enemy_shot_heavy', 0.5);
  },

  // bullets materialise on a circle of radius r (flickering, harmless, for `delay` ticks) and
  // converge through the center, then keep flying out the far side:
  // {n=16, r=90 (ring radius), v=1.0, delay=36, a0=0, spr='eb_small_c', hitR (optional bullet hit radius)}
  implode(sim, x, y, A) {
    const n = A.n || 16, r = A.r || 90, a0 = A.a0 ?? 0;
    for (let i = 0; i < n; i++) {
      const th = a0 + (TAU * i) / n;
      // A.r is the ring radius, NOT the bullet hit radius (bulletProps would pass it through)
      shot(sim, x + Math.cos(th) * r, y + Math.sin(th) * r, th + PI, A.v ?? 1.0, A.spr || 'eb_small_c', A, { delay: A.delay ?? 36, r: A.hitR });
    }
    voice(sim, A, x, 'enemy_laser_charge', 0.35);
  },

  // needles fired inward from both side edges, tilted down, rows staggered between sides:
  // {n=5 (rows per side), y0 (first row y; default = source y), dy=22, v=1.4, tilt=0.3,
  //  delay=20 (flicker telegraph), stagger=0.5 (right rows offset, in rows), spr='eb_needle_o'}
  crossfire(sim, x, y, A) {
    const n = A.n || 5, y0 = A.y0 ?? y, dy = A.dy ?? 22, tilt = A.tilt ?? 0.3, spr = A.spr || 'eb_needle_o';
    const extra = { delay: A.delay ?? 20 };
    for (let i = 0; i < n; i++) {
      shot(sim, -4, y0 + i * dy, tilt, A.v ?? 1.4, spr, A, extra);
      shot(sim, FIELD_W + 4, y0 + (i + (A.stagger ?? 0.5)) * dy, PI - tilt, A.v ?? 1.4, spr, A, extra);
    }
    voice(sim, A, x, 'enemy_shot', 0.45);
  },

  // criss-cross lattice: a row of emitters across the source height each firing two diagonal
  // bullets → a falling diamond mesh: {n=9, width=220, v=0.9, ang=0.55 (rad off vertical), spr='eb_small_p'}
  lattice(sim, x, y, A) {
    const n = A.n || 9, w = A.width || 220, ang = A.ang ?? 0.55, spr = A.spr || 'eb_small_p';
    for (let i = 0; i < n; i++) {
      const bx = x - w / 2 + (w * i) / Math.max(1, n - 1);
      shot(sim, bx, y, HALF - ang, A.v ?? 0.9, spr, A);
      shot(sim, bx, y, HALF + ang, A.v ?? 0.9, spr, A);
    }
    voice(sim, A, x, 'enemy_shot_heavy', 0.45);
  },

  // lob: bullets launched (usually upward) that arc down under gravity:
  // {n=8, a=-PI/2, spread=1.4, v=2.0, vj=0.6 (random extra speed), grav=0.028, spr='eb_small_o'}
  fountain(sim, x, y, A, rng) {
    const n = A.n || 8, a = A.a ?? -HALF, sp = A.spread ?? 1.4;
    for (let i = 0; i < n; i++) {
      shot(sim, x, y, spreadAngle(a, sp, i, n) + (rng.next() - 0.5) * 0.08, (A.v ?? 2.0) + rng.next() * (A.vj ?? 0.6),
        A.spr || 'eb_small_o', A, { grav: A.grav ?? 0.028 });
    }
    voice(sim, A, x, 'enemy_shot_heavy', 0.45);
  },

  // cluster → ring → needles: a heavy orb decelerates, bursts into a ring of orbs, each of which
  // later splits into a small fan of needles along its own heading.
  // {a, v=1.6, t1=42, n1=6, v1=1.0, t2=34, n2=3, sp2=0.5, v2=1.9, spr='eb_big_v', spr1='eb_orb_v', spr2='eb_needle_p'}
  burstChain(sim, x, y, A) {
    const a = A.a ?? HALF, v = A.v ?? 1.6, t1 = A.t1 || 42;
    sim.eb({
      x, y, a, v, acc: -v / (t1 * 1.3), vmin: 0.2, spr: A.spr || 'eb_big_v',
      burst: {
        t: t1, pat: '_chainRing',
        args: { n: A.n1 || 6, v: A.v1 ?? 1.0, spr: A.spr1 || 'eb_orb_v', a0: a, t: A.t2 || 34, sub: { n: A.n2 || 3, spread: A.sp2 ?? 0.5, v: A.v2 ?? 1.9, spr: A.spr2 || 'eb_needle_p' } },
      },
    });
    voice(sim, A, x, 'enemy_shot_heavy', 0.5);
  },

  // --- emitters ---------------------------------------------------------------------------

  // two counter-rotating spirals: {arms=3, v=1.1, every=6, count=30, da=0.19, a0=0,
  //  spr='eb_small_v', spr2='eb_small_p', follow, ox, oy, delay0}
  crossSpiral(sim, x, y, A, rng, src) {
    voice(sim, A, x);
    const arms = A.arms || 3, da = A.da ?? 0.19, a0 = A.a0 ?? 0, v = A.v ?? 1.1;
    sim.emit(Object.assign(emitterBase(A, x, y, src), {
      every: A.every || 6, count: A.count || 30,
      fn(sim, em, k) {
        for (let j = 0; j < arms; j++) {
          const b = (TAU * j) / arms;
          shot(sim, em.x, em.y, a0 + k * da + b, v, A.spr || 'eb_small_v', A);
          shot(sim, em.x, em.y, a0 - k * da + b + PI / arms, v, A.spr2 || A.spr || 'eb_small_p', A);
        }
        if (k % 3 === 0) sim.sfxAt('enemy_shot', em.x, 0.35);
      },
    }));
  },

  // falling curtain rows across the field with a (drifting) gap — rows spawn at the source y:
  // {rows=5, every=22 (ticks), n=15 (bullets per row), gap=120 (gap center x), gapW=40,
  //  drift=0 (gap shift px per row), width=228, v=0.9, spr='eb_orb_o', follow}
  curtain(sim, x, y, A, rng, src) {
    voice(sim, A, x);
    const n = A.n || 15, w = A.width || 228, x0 = FIELD_W / 2 - w / 2, gw = (A.gapW || 40) / 2;
    sim.emit(Object.assign(emitterBase(A, x, y, src), {
      every: A.every || 22, count: A.rows || 5,
      fn(sim, em, k) {
        let g = (A.gap ?? FIELD_W / 2) + (A.drift || 0) * k;
        g = Math.max(gw + 4, Math.min(FIELD_W - gw - 4, g));
        for (let i = 0; i < n; i++) {
          const bx = x0 + (w * i) / (n - 1);
          if (Math.abs(bx - g) < gw) continue;
          shot(sim, bx, em.y, HALF, A.v ?? 0.9, A.spr || 'eb_orb_o', A);
        }
        sim.sfxAt('enemy_shot', em.x, 0.35);
      },
    }));
  },

  // bullets raining from the top edge at seeded-random x:
  // {count=24, every=4, per=1, v=1.3, vj=0.4, spread=0.12 (angle jitter), xMin=8, xMax=232, y=-6, spr='eb_small_o'}
  rain(sim, x, y, A, rng) {
    voice(sim, A, x);
    const xa = A.xMin ?? 8, xb = A.xMax ?? FIELD_W - 8;
    sim.emit({
      x, y, every: A.every || 4, count: A.count || 24,
      fn(sim, em, k) {
        for (let i = 0; i < (A.per || 1); i++) {
          const bx = xa + rng.next() * (xb - xa);
          shot(sim, bx, A.y ?? -6, HALF + (rng.next() - 0.5) * (A.spread ?? 0.12), (A.v ?? 1.3) + rng.next() * (A.vj ?? 0.4), A.spr || 'eb_small_o', A);
        }
        if (k % 4 === 0) sim.sfxAt('enemy_shot', FIELD_W / 2, 0.22);
      },
    });
  },

  // sine-weaving bullet streams (pair:1 adds a mirrored partner → double helix):
  // {ways=1, a, spread=0.6, count=12, every=5, v=1.2, amp=10 (px), freq=0.09 (rad/tick), pair=0,
  //  spr='eb_small_c', spr2, follow, ox, oy}
  wave(sim, x, y, A, rng, src) {
    voice(sim, A, x);
    const ways = A.ways || 1, sp = A.spread ?? 0.6, a = A.a ?? HALF;
    const w1 = { wave: { amp: A.amp ?? 10, freq: A.freq ?? 0.09 } };
    const w2 = { wave: { amp: -(A.amp ?? 10), freq: A.freq ?? 0.09 } };
    sim.emit(Object.assign(emitterBase(A, x, y, src), {
      every: A.every || 5, count: A.count || 12,
      fn(sim, em, k) {
        for (let i = 0; i < ways; i++) {
          const aa = spreadAngle(a, sp, i, ways);
          shot(sim, em.x, em.y, aa, A.v ?? 1.2, A.spr || 'eb_small_c', A, w1);
          if (A.pair) shot(sim, em.x, em.y, aa, A.v ?? 1.2, A.spr2 || A.spr || 'eb_small_c', A, w2);
        }
        if (k % 3 === 0) sim.sfxAt('enemy_shot', em.x, 0.3);
      },
    }));
  },

  // gatling: a stream of seeded-random-spread volleys around the aim angle:
  // {count=12, every=4, a, spread=0.35, per=1, v=2.0, vj=0.3, spr='eb_small_p', follow, ox, oy}
  barrage(sim, x, y, A, rng, src) {
    voice(sim, A, x);
    const a = A.a ?? HALF, sp = A.spread ?? 0.35;
    sim.emit(Object.assign(emitterBase(A, x, y, src), {
      every: A.every || 4, count: A.count || 12,
      fn(sim, em, k) {
        for (let i = 0; i < (A.per || 1); i++) {
          shot(sim, em.x, em.y, a + (rng.next() - 0.5) * sp, (A.v ?? 2.0) + rng.next() * (A.vj ?? 0.3), A.spr || 'eb_small_p', A);
        }
        if (k % 2 === 0) sim.sfxAt('enemy_shot', em.x, 0.35);
      },
    }));
  },

  // a moving source lays a trail of bullets (weaver curtains). Every `every` ticks it drops `n`
  // bullets; `gaps` = [start,len, start,len, …] volley indices left empty (safe lanes).
  // sync:1 → the bullets HANG where they were laid and the whole row releases together `hold`
  // ticks after the last volley — a horizontal net with gaps that then drops as one wall.
  // {count=40, every=5, a=PI/2, spread=0, n=1, v=0.6, acc=0.012, vmax=1.5, gaps=[], twin=0 (px: a
  //  second bullet this far below), sync=0, hold=24, spr='eb_orb_o', follow:1}
  trail(sim, x, y, A, rng, src) {
    voice(sim, A, x);
    const gaps = Array.isArray(A.gaps) ? A.gaps : [];
    const n = A.n || 1, sp = A.spread || 0, a = A.a ?? HALF, every = A.every || 5, count = A.count || 40;
    const spr = A.spr || 'eb_orb_o', v = A.v ?? 0.6;
    const extra = { acc: A.acc ?? 0.012, vmax: A.vmax ?? 1.5 };
    const lay = (bx, by, aa, k) => {
      if (!A.sync) { shot(sim, bx, by, aa, v, spr, A, extra); return; }
      sim.eb({ x: bx, y: by, a: aa, v: 0, spr, burst: { t: (count - 1 - k) * every + (A.hold ?? 24), pat: '_drop', args: { a: aa, v, acc: extra.acc, vmax: extra.vmax, spr } } });
    };
    sim.emit(Object.assign(emitterBase(A, x, y, src), {
      every, count,
      fn(sim, em, k) {
        if (A.sync && k === count - 1) sim.sfxAt('enemy_laser_charge', em.x, 0.25);
        for (let g = 0; g + 1 < gaps.length; g += 2) if (k >= gaps[g] && k < gaps[g] + gaps[g + 1]) return;
        if (em.x < -6 || em.x > FIELD_W + 6) return;
        for (let i = 0; i < n; i++) {
          const aa = spreadAngle(a, sp, i, n);
          lay(em.x, em.y, aa, k);
          if (A.twin) lay(em.x, em.y + A.twin, aa, k);
        }
        if (k % 4 === 0) sim.sfxAt('enemy_shot', em.x, 0.25);
      },
    }));
  },

  // drops mines behind a (moving) source: each mine drifts, brakes to a stop, then bursts into
  // a ring after `fuse` ticks: {count=6, every=14, a=PI/2, v=0.5, fuse=80, ringN=8, ringV=1.0,
  //  spr='eb_orb_o', ringSpr='eb_small_o', follow, ox, oy}
  mineLayer(sim, x, y, A, rng, src) {
    voice(sim, A, x);
    const v = A.v ?? 0.5;
    sim.emit(Object.assign(emitterBase(A, x, y, src), {
      every: A.every || 14, count: A.count || 6,
      fn(sim, em, k) {
        sim.eb({
          x: em.x, y: em.y, a: A.a ?? HALF, v, acc: -v / 40, vmin: 0, spr: A.spr || 'eb_orb_o',
          burst: { t: A.fuse || 80, pat: '_popRing', args: { n: A.ringN || 8, v: A.ringV ?? 1.0, spr: A.ringSpr || 'eb_small_o', a0: k * 0.37 } },
        });
        sim.sfxAt('enemy_shot', em.x, 0.3);
      },
    }));
  },

  // several telegraphed beams in a fan (or evenly around a full circle with full:1):
  // {n=3, a=PI/2, spread=0.9, full=0, w=8, warn=48, dur=60, len=520, av=0 (rad/tick sweep once
  //  firing), avT, mirror=0 (1: symmetric sweep — av>0 opens outward, av<0 closes inward),
  //  pal='magenta', follow, ox, oy}
  laserFan(sim, x, y, A, rng, src) {
    const n = A.n || 3, a = A.a ?? HALF, sp = A.spread ?? 0.9;
    for (let i = 0; i < n; i++) {
      const aa = A.full ? a + (TAU * i) / n : spreadAngle(a, sp, i, n);
      let av = A.av || 0;
      if (A.mirror && !A.full) { const side = i - (n - 1) / 2; av = side < 0 ? -av : side > 0 ? av : 0; }
      sim.beam({
        x, y, a: aa, av, avT: A.avT, w: A.w || 8, warn: A.warn ?? 48, dur: A.dur ?? 60, len: A.len || 520,
        pal: A.pal || 'magenta', follow: A.follow ? src : 0, ox: A.ox || 0, oy: A.oy || 0,
      });
    }
    voice(sim, A, x);
  },

  // --- internal sub-patterns (bullet `burst` targets) --------------------------------------

  // ring whose bullets each burst into a fan along their own heading (burstChain stage 2)
  // {n, v, spr, a0, t (ticks), sub: { n, spread, v, spr }}
  _chainRing(sim, x, y, A) {
    const n = A.n || 6, a0 = A.a0 || 0;
    for (let i = 0; i < n; i++) {
      const a = a0 + (TAU * i) / n;
      sim.eb({
        x, y, a, v: A.v ?? 1.0, acc: -0.012, vmin: 0.35, spr: A.spr || 'eb_orb_v',
        burst: { t: A.t || 34, pat: '_fanPop', args: Object.assign({}, A.sub, { a }) },
      });
    }
    sim.sfxAt('enemy_shot_heavy', x, 0.45);
    sim.env.fx.spark?.(x, y, -HALF, 'plasma', 4);
  },
  // fan + a soft pop (split / chain stages): fan args + glint (fx palette for a spark)
  _fanPop(sim, x, y, A) {
    PATTERNS.fan(sim, x, y, A);
    sim.sfxAt('enemy_shot', x, 0.28);
    if (A.glint) sim.env.fx.spark?.(x, y, A.a ?? HALF, A.glint, 2);
  },
  // re-launch toward the target (stopAim stage 2): shot args incl. home/homeRate/homeT
  _reaim(sim, x, y, A) {
    shot(sim, x, y, A.a ?? HALF, A.v ?? 2.1, A.spr || 'eb_needle_p', A);
    sim.sfxAt('enemy_shot', x, 0.3);
  },
  // release a hanging curtain bullet (trail sync): shot args incl. acc/vmax
  _drop(sim, x, y, A) {
    shot(sim, x, y, A.a ?? HALF, A.v ?? 0.6, A.spr || 'eb_orb_o', A);
    sim.sfxAt('enemy_shot', x, 0.2);
  },
  // ring + pop sound (mines)
  _popRing(sim, x, y, A) {
    PATTERNS.ring(sim, x, y, A);
    sim.sfxAt('enemy_shot_heavy', x, 0.4);
    sim.env.fx.spark?.(x, y, -HALF, 'ember', 3);
  },
};

Object.assign(PATTERNS, LIB);

export function registerPatterns(obj) { Object.assign(PATTERNS, obj); }
