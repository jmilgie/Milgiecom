// Game over — "Embers". D minor, 76 BPM. Somber and beautiful, never harsh.
// Form (21 bars; loops from DRIFT, a 50 s cycle):
//   fall (5)    ≈ 16 s cue: a single low boom, then a solo violin sings the Lancers CALL in the
//               minor (D → A), sighs down over Bbmaj7, echoes the call a fourth lower over Gm7,
//               leans on the leading tone (Asus4 → A) and comes to rest on D over Dm(add9).
//               Choir "oo", dark strings, low e-piano and a soft drone underneath.
//   drift (16)  quiet ambient loop: Dm9 Bbmaj7 Gm9 Dm9 | Bbmaj7 Fmaj7 Gm7 Asus4 (twice), a slow
//               dark pad breathing through its filter, glass bells echoing the call as a
//               distant memory, a slow harp in the second half. Asus4 → Dm9 loops seamlessly.
// No drums in the loop; no intensity layers (the game-over screen is quiet whatever happened).

import { arp, chordInfo, midi } from '../music.js';

// ── harmony ──────────────────────────────────────────────────────────────────────────
const FALL_H = 'Dm Bbmaj7 Gm7 Asus4,A Dmadd9';
const DRIFT_A = 'Dm9 Bbmaj7 Gm9 Dm9 Bbmaj7 Fmaj7 Gm7 Asus4';
const DRIFT_H = DRIFT_A + ' ' + DRIFT_A;

// 'C Am,G' → [chord symbols, [start, length] in steps]
function split(harm, bar = 16) {
  const f = [], at = [];
  harm.split(' ').forEach((b, i) => b.split(',').forEach((c, k, a) => { f.push(c); at.push([i * bar + (k * bar) / a.length, bar / a.length]); }));
  return [f, at];
}
// low root per chord span (D2..C#3 region)
const root = (sym) => 38 + ((chordInfo(sym).root - 2 + 12) % 12);
const roots = (harm, vel, oct = 0) => { const [f, at] = split(harm); return f.map((c, i) => [at[i][0], root(c) + 12 * oct, at[i][1], vel]); };
// Hand-voiced: one 6-note set per chord (low → high). The maj7 / add9 colours are spread a
// major 7th or more apart, never a minor 2nd/9th, and every part takes a register slice of the
// set, so pad, strings, choir and piano never rub against each other or against the melody.
const V = {
  Dm: 'D3 A3 D4 F4 A4 D5', Dm9: 'D3 A3 C4 F4 A4 E5', Dmadd9: 'D3 A3 F4 A4 D5 E5',
  Bbmaj7: 'Bb2 F3 A3 D4 F4 D5', Gm9: 'G2 D3 F3 Bb3 D4 A4', Gm7: 'G2 D3 F3 Bb3 D4 G4',
  Fmaj7: 'F2 C3 A3 E4 A4 C5', Asus4: 'A2 E3 A3 D4 E4 A4', A: 'A2 E3 A3 C#4 E4 A4',
};
const vset = (sym) => V[sym].split(' ').map(midi);
const part = (harm, lo, hi, vel, keep = () => true) => { const [f, at] = split(harm); return f.map((c, i) => [at[i][0], vset(c).slice(lo, hi), at[i][1], vel]).filter((e) => keep(e[0])); };

// ── the cue melody (solo violin): the call, a sigh, the call's echo, the leading tone, home ──
const LAMENT = [
  [0, 'D5', 6, 0.7], [6, 'A5', 10, 0.78],                           // Dm      the call
  [16, 'G5', 2, 0.66], [18, 'F5', 4, 0.7], [22, 'E5', 2, 0.6], [24, 'D5', 8, 0.66],   // Bbmaj7  sigh
  [32, 'D5', 6, 0.64], [38, 'G5', 6, 0.7], [44, 'F5', 4, 0.62],     // Gm7     the call, a 4th lower-sounding answer
  [48, 'E5', 8, 0.68], [56, 'C#5', 8, 0.62],                        // Asus4,A leading tone
  [64, 'D5', 16, 0.6],                                               // Dmadd9  rest
];

export default {
  title: 'Embers',
  bpm: 76,
  key: 'D', scale: 'minor',
  gain: 0.92,
  reverb: 1.2,
  delay: { beats: 1.5, feedback: 0.42, lp: 3000, hp: 400 },
  seed: 13,

  instruments: {
    gStr: { base: 'strings', a: 0.18, d: 0.5, s: 0.9, r: 1.1, vib: 18 },       // solo violin line
    gPad: { base: 'padDark', a: 1.6, r: 3 },
    gKeys: { base: 'keys', vol: 0.8 },
    gGlass: { base: 'glass' },
  },

  channels: {
    taiko: { gain: 0.36, reverb: 0.5 },
    down: { inst: 'downlifter', gain: 0.22, reverb: 0.6 },
    violin: { inst: 'gStr', gain: 0.7, reverb: 0.55, delay: 0.1, pan: 0.08 },
    strings: { inst: 'stringsDark', gain: 0.28, reverb: 0.5, pan: -0.12 },
    oo: { inst: 'choirOo', gain: 0.3, reverb: 0.6 },
    pad: { inst: 'gPad', gain: 0.32, reverb: 0.5, lpf: 1600 },
    keys: { inst: 'gKeys', gain: 0.44, reverb: 0.5, pan: -0.1 },
    drone: { inst: 'bassSoft', gain: 0.42 },
    glass: { inst: 'gGlass', gain: 0.55, reverb: 0.6, delay: 0.45, pan: 0.25 },
    bell: { gain: 0.2, reverb: 0.6, delay: 0.35, pan: -0.25 },
    harp: { gain: 0.3, reverb: 0.55, delay: 0.2, pan: 0.18 },
  },

  patterns: {
    // ── FALL (the cue) ───────────────────────────────────────────────────────────────
    fallLine: { len: 80, violin: LAMENT },
    fallBed: {
      len: 80,
      strings: part(FALL_H, 1, 5, 0.6),
      oo: part(FALL_H, 3, 6, 0.52, (t) => t >= 16),
      pad: part(FALL_H, 0, 4, 0.62),
      drone: roots(FALL_H, 0.62),
      keys: part(FALL_H, 0, 4, 0.48),          // low piano, one chord per change
      bell: [[64, 'A5', 6, 0.36], [70, 'D6', 10, 0.32]],
    },
    fallHit: {
      len: 80,
      taiko: [[0, 'x', 1, 0.9], [12, 'x', 1, 0.3], [64, 'x', 1, 0.45]],
      down: [[0, 'x', 16, 0.6]],
    },

    // ── DRIFT (ambient loop) ─────────────────────────────────────────────────────────
    drBed: {
      len: 256,
      pad: part(DRIFT_H, 0, 4, 0.5),
      oo: part(DRIFT_H, 3, 6, 0.42, (t) => t % 64 < 48 || t >= 128),
      drone: roots(DRIFT_H, 0.48),
    },
    // strings swell in only on the second pass
    drStr: { len: 256, strings: part(DRIFT_H, 1, 4, 0.44, (t) => t >= 128) },
    // distant memories of the call (on D, then on G), glass through the long delay; then the
    // violin once, very softly
    drEcho: {
      len: 256,
      glass: [[2, 'D5', 6, 0.5], [8, 'A5', 14, 0.46], [34, 'G5', 6, 0.42], [40, 'D6', 14, 0.4],
        [130, 'D5', 6, 0.46], [136, 'A5', 10, 0.42], [146, 'G5', 4, 0.36], [150, 'F5', 10, 0.34],
        [194, 'D5', 6, 0.4], [200, 'A5', 14, 0.36]],
      violin: [[160, 'A4', 8, 0.44], [168, 'D5', 8, 0.48], [176, 'C5', 8, 0.44], [184, 'A4', 8, 0.4],
        [224, 'D5', 8, 0.42], [232, 'Bb4', 8, 0.4], [240, 'A4', 8, 0.38], [248, 'E4', 8, 0.34]],
      bell: [[96, 'D6', 8, 0.3], [224, 'D6', 8, 0.28]],
    },
    // slow harp (quarter notes) through the second half
    drHarp: {
      len: 256,
      harp: arp(DRIFT_A.split(' ').map((c) => vset(c).slice(2, 6)), { rate: 4, order: [0, 1, 2, 3], vel: 0.42, accent: 0.08, start: 128 }),
    },
    drKeys: { len: 256, keys: part(DRIFT_H, 0, 3, 0.32, (t) => [0, 48, 112, 128, 176, 240].includes(t)) },
  },

  sections: {
    fall: {
      bars: 5, chords: FALL_H,
      play: ['fallLine', 'fallBed', 'fallHit'],
      auto: { 'pad.lpf': [[0, 500], [2, 1800], [5, 900]] },
    },
    drift: {
      bars: 16, chords: DRIFT_H,
      play: ['drBed', 'drStr', 'drEcho', 'drHarp', 'drKeys'],
      auto: { 'pad.lpf': [[0, 900], [4, 1500], [8, 800], [12, 1500], [16, 900]] },
    },
  },

  arrangement: ['fall', 'drift'],
  loop: 'drift',
};
