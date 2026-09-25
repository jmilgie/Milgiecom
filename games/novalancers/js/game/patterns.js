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
//           home, homeRate, homeT, grav, wave, burst, noGraze, r) pass through via bulletProps().

import { TAU } from '../util.js';

const PASS = ['acc', 'vmin', 'vmax', 'spin', 'spinT', 'delay', 'life', 'home', 'homeRate', 'homeT', 'grav', 'wave', 'burst', 'noGraze', 'r'];

export function bulletProps(args, out = {}) {
  for (const k of PASS) if (args[k] !== undefined) out[k] = args[k];
  return out;
}

function shot(sim, x, y, a, v, spr, args, extra) {
  const s = bulletProps(args, { x, y, a, v, spr });
  if (extra) Object.assign(s, extra);
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

export function registerPatterns(obj) { Object.assign(PATTERNS, obj); }
