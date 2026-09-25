// Nova Lancers — shared musical motifs (the score's leitmotifs) + helpers to quote them.
//
// THE LANCERS THEME
// An 8-bar heroic tune (antecedent + consequent). Its fingerprint is the "call": a pickup
// from the low 5th, the tonic held for a dotted quarter, then a syncopated leap UP A FIFTH
// that hangs over the bar ("da | DAAA – da-DAAAAA"). Bars 2/4/6 answer with running 8ths.
//   title     : first full statement, major key
//   victory   : triumphant major, bVI–bVII–I ending (see `cadence` below)
//   finalboss : reprise in the minor (themeEvents({ scale: 'minor' })) — the call is what
//               the listener must recognize, so keep bar 1 intact even when you re-harmonize.
// Everything is key-agnostic: melody = SCALE STEPS (0 = tonic, 7 = octave, -3 = 5th below),
// harmony = semitone roots relative to the tonic. Realize it with the helpers below.
//
// Usage in a song module:
//   import { THEME, themeEvents, themeHarmony, themeChords } from './motifs.js';
//   lead: themeEvents({ tonic: 'D5' })                                  // 8 bars, D major
//   lead: themeEvents({ tonic: 'A4', scale: 'minor', part: 'call', aug: 2 })   // slow minor call
//   chords: themeHarmony('D')             // → 'D G Bm7 A D G Em7,A D'   (section `chords` string)
//   pad:  themeChords('D', { low: 'F#3', high: 'E5' })                 // voice-led chord events

import { SCALES, midi, noteName, voiceLead, pitchClass } from '../music.js';

// [scaleStep, startStep, lengthSteps] on the 16th grid; bar = 16 steps.
const A = [
  [0, 0, 6], [4, 6, 10],                                                         // 1  call: tonic → 5th
  [3, 16, 2], [2, 18, 2], [3, 20, 2], [4, 22, 2], [5, 24, 4], [4, 28, 4],        // 2  turn up to the 6th
  [7, 32, 6], [6, 38, 2], [4, 40, 8],                                            // 3  octave leap, fall
  [5, 48, 2], [4, 50, 2], [3, 52, 2], [2, 54, 2], [1, 56, 8],                    // 4  descend to the 2nd
  [0, 64, 6], [4, 70, 10],                                                       // 5  call again
  [3, 80, 2], [2, 82, 2], [3, 84, 2], [4, 86, 2], [5, 88, 4], [7, 92, 4],        // 6  turn, reaching higher
  [8, 96, 6], [7, 102, 2], [6, 104, 4], [4, 108, 4],                             // 7  climax on the 9th
  [7, 112, 16],                                                                  // 8  home (high tonic)
];

// Contrasting 4-bar "B" phrase (heard in the title's breakdown): sighs from the 5th to the 6th
// and back, climbs to the octave, then outlines the V chord. Harmony: vi7 IV I V.
const B = [
  [4, 0, 4], [5, 4, 4], [4, 8, 2], [2, 10, 6],                                   // 1  (vi)
  [3, 16, 4], [4, 20, 4], [5, 24, 8],                                            // 2  (IV)
  [4, 32, 4], [2, 36, 2], [4, 38, 6], [7, 44, 4],                                // 3  (I)
  [6, 48, 6], [4, 54, 2], [8, 56, 4], [6, 60, 4],                                // 4  (V) arpeggiates the V chord
];

export const THEME = {
  pickup: [[-3, -2, 2]],        // low 5th, the 8th-note anacrusis into bar 1 (starts at step −2)
  a: A,                          // 8 bars (128 steps)
  call: A.slice(0, 2),           // bar 1 only: the motif to quote anywhere
  answer: A.slice(2, 8),         // bar 2: running-8ths answer
  front: A.slice(0, 11),         // bars 1–3
  b: B,                          // 4 bars (64 steps)
  // Harmony: per bar, [semitones above tonic, chord quality] or two of those for half bars.
  harmony: {
    major: [[[0, '']], [[5, '']], [[9, 'm7']], [[7, 'sus4'], [7, '']], [[0, '']], [[5, '']], [[2, 'm7'], [7, '']], [[0, '']]],
    minor: [[[0, 'm']], [[5, 'm']], [[8, 'maj7']], [[7, 'sus4'], [7, '']], [[0, 'm']], [[5, 'm']], [[2, 'm7b5'], [7, 'm']], [[0, 'm']]],
    b: [[[9, 'm7']], [[5, '']], [[0, '']], [[7, '']]],
  },
  // Triumphant alternative for bars 7–8 (victory / title climax): bVI – bVII – I,
  // with a melody rising in thirds: 3rd of bVI → 3rd of bVII → 3rd of I.
  cadence: {
    harmony: [[[8, ''], [10, '']], [[0, '']]],
    melody: [[7, 0, 6], [7, 6, 2], [8, 8, 8], [9, 16, 16]],   // steps relative to bar 7 (tonic octave+)
  },
};

/** Scale step → MIDI note. step 0 = tonic; 7 = octave; negatives go below. */
export function degree(step, tonic, scale = 'major') {
  const s = SCALES[scale] || SCALES.major;
  const n = s.length, o = Math.floor(step / n), i = ((step % n) + n) % n;
  return midi(tonic) + 12 * o + s[i];
}

/**
 * The theme as an event array for a pattern line.
 * opt { tonic: 'D4' (tonic WITH octave), scale: 'major', part: 'a'|'b'|'call'|'answer'|'front'|
 *       'cadence', pickup: true (include the anacrusis at step −2 → put it in the previous
 *       bar's pattern, or use `start` ≥ 2), start: 0 (step offset), aug: 1 (time stretch: 2 =
 *       half-time), vel: 0.85, legato: 1 (length multiplier), octave: 0 }
 */
export function themeEvents(opt = {}) {
  const tonic = midi(opt.tonic ?? 'D4') + 12 * (opt.octave ?? 0);
  const scale = opt.scale ?? 'major', aug = opt.aug ?? 1, start = opt.start ?? 0;
  const vel = opt.vel ?? 0.85, leg = opt.legato ?? 1;
  const part = opt.part ?? 'a';
  const src = part === 'cadence' ? THEME.cadence.melody : THEME[part] || THEME.a;
  const notes = (opt.pickup && part !== 'b' && part !== 'cadence' ? THEME.pickup : []).concat(src);
  return notes.map(([st, s, l]) => [start + s * aug, degree(st, tonic, scale), Math.max(0.5, l * aug * leg), vel]);
}

/** The theme harmony as a section `chords` string: themeHarmony('D') → 'D G Bm7 Asus4,A …'. */
export function themeHarmony(key, scale = 'major', which) {
  const h = THEME.harmony[which || (scale === 'minor' || scale === 'harmonic' || scale === 'dorian' ? 'minor' : 'major')];
  const root = pitchClass(key);
  const flats = /b/.test(String(key).slice(1)) || ['F'].includes(key) || scale !== 'major';
  return h.map((bar) => bar.map(([st, q]) => noteName(root + st, flats).replace(/-?\d+$/, '') + q).join(',')).join(' ');
}

/** Voice-led chord events for the theme harmony (one chord per bar or half bar).
 *  opt { scale, which ('major'|'minor'|'b'), low: 'F#3', high: 'E5', voices: 4, vel: 0.7, start: 0 } */
export function themeChords(key, opt = {}) {
  const syms = themeHarmony(key, opt.scale ?? 'major', opt.which).split(' ');
  const flat = [], times = [];
  syms.forEach((bar, b) => {
    const parts = bar.split(',');
    parts.forEach((c, i) => { flat.push(c); times.push([b * 16 + (i * 16) / parts.length, 16 / parts.length]); });
  });
  const voiced = voiceLead(flat, { low: opt.low ?? 'F#3', high: opt.high ?? 'E5', voices: opt.voices ?? 4 });
  const start = opt.start ?? 0;
  return voiced.map((notes, i) => [start + times[i][0], notes, times[i][1], opt.vel ?? 0.7]);
}

/** Shift an event array in time and/or pitch. */
export function shift(events, steps = 0, semis = 0) {
  return events.map(([s, n, l, v, o]) => [s + steps, Array.isArray(n) ? n.map((m) => m + semis) : n + semis, l, v, o]);
}
