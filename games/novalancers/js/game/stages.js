// Nova Lancers — sector scripts.
// STAGES[key] = { script: Step[] | (sim) => Step[], cues?: { name(sim, sim, data) } }
// See StageRunner in sim.js for step fields. This placeholder is replaced by the full
// five-sector campaign.

import { bz } from './paths.js';
import { FIELD_W } from '../config.js';

const W = FIELD_W;

const test = [
  { dt: 1.5, spawn: 'mite', n: 6, gap: 0.3, bonus: 'power', p: (i) => ({ path: 'sine', x: 60 + (i % 2) * 120, y: -10, vy: 55, amp: 30, freq: 0.5, ph: i }) },
  { dt: 3, spawn: 'dart', n: 5, gap: 0.35, p: (i) => ({ path: 'bezier', ...bz(-10, 60, 80, 200, 160, 40, W + 20, 120, 3.2, 90) }) },
  { dt: 3, spawn: 'dart', n: 5, gap: 0.35, p: (i) => ({ path: 'bezier', ...bz(W + 10, 60, 160, 200, 80, 40, -20, 120, 3.2, 90) }) },
  { dt: 4, spawn: 'eye', n: 2, gap: 0.8, p: (i) => ({ path: 'hold', x: 60 + i * 120, y: -20, tx: 60 + i * 120, ty: 90, tin: 1.4, hold: 6, sway: 10, swayF: 0.25 }) },
  { dt: 6, spawn: 'carapace', n: 1, p: { path: 'hold', x: W / 2, y: -30, tx: W / 2, ty: 110, tin: 2, hold: 8, sway: 30, swayF: 0.1 } },
  { dt: 0, wait: 'clear', max: 14 },
  { dt: 2, warning: { name: 'THE WARDEN', music: 'boss' } },
  { dt: 3.5, boss: 'warden' },
  { dt: 0, wait: 'boss' },
  { dt: 1, end: true },
];

export const STAGES = {
  aurora: { script: test },
  cinder: { script: test },
  veil: { script: test },
  wreck: { script: test },
  horizon: { script: test },
};
