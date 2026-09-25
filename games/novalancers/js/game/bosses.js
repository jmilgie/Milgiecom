// Nova Lancers — bosses.
// BOSSES[key] = { spawn(sim, rng) } — host-only; spawns the boss core (+ parts as child
// enemies) via sim.spawn(). The core's ENEMIES def has boss:true (not midboss) so killing it
// completes the sector. Boss movement must be closed-form (a path function of t, e.p, e.phase,
// e.phaseT0); decisions (attacks, phase changes) happen in the host brain.
//
// This is a minimal placeholder boss; the full five bosses live here once authored.

import { ENEMIES } from './enemies.js';
import { FIELD_W } from '../config.js';

ENEMIES.warden_core = {
  spr: 'boss_warden', hp: 2600, r: 30, score: 50000, boss: true, bar: true, name: 'THE WARDEN', z: 2,
  move: 'bossHover', explode: 'boss', palette: 'fire', hpScale: true,
  paths: {
    bossHover(e, t) {
      const enter = Math.min(1, t / 3);
      e.x = FIELD_W / 2 + Math.sin(t * 0.5) * 50 * enter;
      e.y = -60 + 150 * (1 - (1 - enter) * (1 - enter));
    },
  },
  brain(e, sim, t) {
    if (t < 3) return;
    const k = Math.floor((t - 3) * 60);
    if (k % 150 === 0) sim.fire(e, 'spiral', { arms: 4, v: 1.2, every: 4, count: 30, da: 0.17, spr: 'eb_small_v', follow: 1 });
    if (k % 150 === 75) sim.fire(e, 'fan', { a: sim.aimAt(e), n: 7, spread: 1.0, v: 1.6, spr: 'eb_orb_p' });
    if (e.hp < e.maxHp * 0.5 && e.phase === 0) sim.setPhase(e, 1);
    if (e.phase === 1 && k % 200 === 100) sim.fire(e, 'beam', { a: Math.PI / 2 - 0.6, av: 0.01, avT: 120, w: 12, warn: 50, dur: 120, follow: 1 });
  },
};

export const BOSSES = {
  warden: { spawn(sim) { return sim.spawn('warden_core', { x: FIELD_W / 2, y: -60 }); } },
};

export function registerBosses(obj) { Object.assign(BOSSES, obj); }
