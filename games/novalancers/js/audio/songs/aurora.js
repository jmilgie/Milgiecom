// Sector 1 — "Aurora Ring". Driving, bright, adventurous synthwave / electro in A minor, 132 BPM.
// Form (66 bars ≈ 120 s; loops from A, a 113 s cycle):
//   intro (4)    filtered 16th arp opens up, riser → the beat drops in
//   A (8)        four-on-the-floor + offbeat rolling bass; the Aurora hook: broken-chord lead
//                over i–VI–III–VII (Am F C G)
//   A2 (8)       hook with glides, glass-bell unison, strings counter-line; the answer climbs to
//                a leading-tone B that resolves into…
//   B (8)        soaring long-note melody over Fmaj7 G Em7 Am Dm7 Fmaj7 Gsus4–G
//   B2 (8)       + choir, brass stabs, busier drums
//   break (8)    drums out, pads + glass motif echoes; brass quotes the LANCERS CALL in the minor,
//                then in the relative major (hope!) — the score's shared leitmotif
//   build (4)    Dm7 F G A: snare roll, riser, filters open; A→ lifts into the new key
//   climax (8)   the hook up a whole step (B minor) with brass octaves and choir
//   climax2 (8)  the B melody up a whole step, peaking on F#6
//   turn (2)     chromatic-mediant pivot A→F→G back to A minor (the call's pickup leads home)
// Intensity: ≥0.7 adds ride, ≥0.75 taiko, ≥0.8 a square-lead octave below; <0.15 drops the kit.

import { arp, voiceLead, chordInfo, transpose } from '../music.js';
import { themeEvents } from './motifs.js';

// ── harmony ──────────────────────────────────────────────────────────────────────────
const INTRO_H = 'Am F C G';
const A_H = 'Am F C G Am F C G';
const B_H = 'Fmaj7 G Em7 Am Dm7 Fmaj7 Gsus4,G G';
const BRK_H = 'Am Am Fadd9 Fadd9 C C G G';
const BUILD_H = 'Dm7 F G A';
const TURN_H = 'F G';

const split = (harm) => { const f = [], at = []; harm.split(' ').forEach((bar, b) => bar.split(',').forEach((c, i, a) => { f.push(c); at.push([b * 16 + (i * 16) / a.length, 16 / a.length]); })); return [f, at]; };
function chordEvents(harm, opt) {
  const [f, at] = split(harm);
  return voiceLead(f, opt).map((n, i) => [at[i][0], n, at[i][1] * (opt.legato ?? 1), opt.vel ?? 0.7]);
}
function halfList(harm, opt) {
  const f = [];
  harm.split(' ').forEach((bar) => { const c = bar.split(','); f.push(c[0], c[c.length - 1]); });
  return voiceLead(f, opt);
}
// bass root in E1..D#2
const root = (sym) => 28 + ((chordInfo(sym).root - 4 + 12) % 12);
// Apply a one-bar bass figure [[step, octave(0|1), len, vel], …] to every bar/half-bar chord.
function bassFig(harm, fig) {
  const [f, at] = split(harm);
  const ev = [];
  f.forEach((c, i) => {
    const [s0, len] = at[i];
    for (const [st, o, l, v] of fig) if (st >= s0 % 16 && st < (s0 % 16) + len) ev.push([Math.floor(s0 / 16) * 16 + st, root(c) + 12 * o, l, v]);
  });
  return ev;
}
const OFFBEAT = [];   // ". R R' R" per beat: rolls between the kicks
for (let b = 0; b < 4; b++) OFFBEAT.push([b * 4 + 1, 0, 0.9, 0.8], [b * 4 + 2, 1, 0.9, 0.9], [b * 4 + 3, 0, 0.9, 0.75]);
const EIGHTHS = [];
for (let b = 0; b < 8; b++) EIGHTHS.push([b * 2, b % 2, 1.8, b % 2 ? 0.75 : 0.9]);
const GALLOP = [];    // climax: 16th gallop with the octave on the offbeat 16th
for (let b = 0; b < 4; b++) GALLOP.push([b * 4, 0, 0.9, 0.95], [b * 4 + 1, 0, 0.9, 0.7], [b * 4 + 2, 1, 0.9, 0.85], [b * 4 + 3, 0, 0.9, 0.7]);

// ── melodies (8th-note tokens) ────────────────────────────────────────────────────────
const HOOK_1 = 'A4 C5 E5 A5 - - G5 E5 | F5 - - E5 C5 - A4 - | G4 C5 E5 G5 - - F5 E5 | D5 - - B4 G4 - - - |';
const HOOK_A = HOOK_1 + ' A4 C5 E5 A5 - - B5 C6 | - - - B5 A5 - F5 - | G5 - - E5 C5 - E5 G5 | D6 - - B5 G5 - - -';
const HOOK_A2 = 'A4 C5 E5 ~A5 - - G5 E5 | F5 - - E5 C5 - A4 - | G4 C5 E5 ~G5 - - F5 E5 | D5 - - B4 G4 - - - |' +
  ' A4 C5 E5 ~A5 - - B5 C6 | - - - D6 C6 - A5 - | G5 - - C6 E6 - D6 C6 | D6 - - - - - B5 -';
const SOAR = 'C6 - - - - - B5 A5 | B5 - - - D6 - - - | B5 - - G5 - - E5 - | A5 - - - - - E5 G5 |' +
  ' F5 - - A5 - - C6 - | C6 - - - E6 - D6 C6 | C6 - - - B5 - - - | D6 - - B5 G5 - - -';
// descending "line cliché" counter (strings, whole notes): E C C B A A G G
const COUNTER = 'E4 C4 C4 B3 A3 A3 G3 G3';

export default {
  title: 'Aurora Ring',
  bpm: 132,
  key: 'A', scale: 'minor',
  gain: 0.8,
  delay: { beats: 0.75, feedback: 0.38, lp: 4200, hp: 400 },
  duck: { release: 0.2 },
  seed: 5,

  instruments: {
    aBass: { base: 'bass', env: 2.8, fd: 0.12, cutoff: 460, q: 4, drive: 0.45, d: 0.15, s: 0.6 },
    aPad: { base: 'pad', cutoff: 3400, detune: 22, a: 0.3, r: 1.1, air: 0.03 },
    aArp: { base: 'pluck', cutoff: 950, env: 3.6, decay: 0.2, amp: 0.55, q: 4 },
    aLead: { base: 'lead', voices: 2, detune: 8, cutoff: 3200, env: 1.4, q: 2, vib: 14, vibDelay: 0.22, glide: 0.05, r: 0.22 },
    aLead2: { base: 'leadSquare', cutoff: 2200, vib: 10, r: 0.18 },
  },

  channels: {
    kick: { gain: 0.39, sidechain: true, layer: { min: 0.15 } },
    snare: { gain: 0.53, reverb: 0.22, layer: { min: 0.15 } },
    clap: { gain: 0.34, reverb: 0.2, pan: -0.08, layer: { min: 0.15 } },
    hat: { gain: 0.42, pan: 0.25, choke: ['ohat'], human: { t: 0.002, v: 0.1 } },
    ohat: { gain: 0.34, pan: 0.3 },
    ride: { gain: 0.22, pan: -0.3, layer: { min: 0.7 } },
    crash: { gain: 0.4, reverb: 0.15, pan: -0.2 },
    tom: { gain: 0.36, reverb: 0.15 },
    taiko: { gain: 0.45, reverb: 0.2, layer: { min: 0.75 } },
    rev: { inst: 'revcym', gain: 0.42 },
    riser: { gain: 0.42, reverb: 0.3 },
    impact: { gain: 0.4, reverb: 0.25 },
    bass: { inst: 'aBass', gain: 0.8, duck: 0.4 },
    pad: { inst: 'aPad', gain: 0.28, duck: 0.6, reverb: 0.3, lpf: 20000 },
    strings: { gain: 0.45, reverb: 0.35, duck: 0.3, pan: 0.15 },
    choir: { gain: 0.2, reverb: 0.45, duck: 0.3 },
    stab: { inst: 'brassStab', gain: 0.32, reverb: 0.25, pan: -0.12, delay: 0.12 },
    brass: { gain: 0.42, reverb: 0.3 },
    arp: { inst: 'aArp', gain: 0.4, delay: 0.3, reverb: 0.15, pan: -0.25, duck: 0.35, lpf: 20000 },
    glass: { gain: 0.3, reverb: 0.45, delay: 0.3, pan: 0.25 },
    lead: { inst: 'aLead', gain: 0.84, reverb: 0.2, delay: 0.22 },
    lead2: { inst: 'aLead2', gain: 0.4, reverb: 0.15, layer: { min: 0.8 } },
  },

  patterns: {
    // ── drums ──
    beatA: { kick: 'X...X...X...X...', snare: '....X.......X...', clap: '....x.......x...', hat: 'xg.gxg.gxg.gxg.g', ohat: '..x...x...x...x.' },
    beatA2: { kick: 'X...X...X...X..x', snare: '....X.......X...', clap: '....x.......x...', hat: 'xgxgxg.gxgxgxg.g', ohat: '......x.......x.' },
    fill1: { kick: 'X...X...X...X...', snare: '....X.......X.xx', clap: '....x.......x...', hat: 'xg.gxg.gxg.g....', ohat: '..x...x...x.....' },
    fill2: {
      kick: 'X...X...X.......', snare: '....X...........', clap: '....x...........', hat: 'xg.gxg.g........', ohat: '..x...x.........',
      tom: '.*8 E3 E3 C3 C3 A2 A2 E2 E2',
    },
    beatB: { kick: 'X...X...X...X...', snare: '....X.......X...', clap: '....x.......x...', hat: 'x.xgx.xgx.xgx.xg', ohat: '..............x.' },
    fillB: {
      kick: 'X...X...X...X...', clap: '....x...........', hat: 'x.xgx.xg........',
      snare: '. . . . X . . . x@0.5 . x@0.6 . x@0.7 x@0.75 x@0.85 X',
    },
    brkHat: { hat: 'o.o.o.o.o.o.o.o.', clap: '....o.......o...' },
    bu1: { vel: 0.55, kick: 'X...X...X...X...', snare: 'x...x...x...x...' },
    bu2: { vel: 0.62, kick: 'X...X...X...X...', snare: 'x.x.x.x.x.x.x.x.', hat: 'x.x.x.x.x.x.x.x.' },
    bu3: { vel: 0.7, kick: 'X...X...X...X...', snare: 'xxxxxxxxxxxxxxxx', hat: 'x.x.x.x.x.x.x.x.' },
    bu4: { vel: 0.85, kick: 'X.X.X.X.X.X.X.X.', snare: 'xxxxxxxxxxxxrrRR', tom: '.*12 E3 C3 A2 E2' },
    crash1: { crash: 'X' },
    rideA: { ride: 'x.x.x.x.x.x.x.x.' },
    taikoA: { taiko: 'X.......x.x.....' },
    taikoB: { taiko: 'X.....x.X.......' },

    // ── intro ──
    introArp: { len: 64, arp: arp(halfList(INTRO_H, { low: 'A3', high: 'A4', voices: 3 }), { rate: 1, len: 8, continue: true, oct: 2, order: [0, 1, 2, 3, 4, 5, 4, 3, 1, 2, 3, 4, 5, 3, 2, 1], vel: 0.7 }) },
    introPad: { len: 64, pad: chordEvents(INTRO_H, { low: 'E3', high: 'C5', voices: 4, vel: 0.55 }) },
    introBass: { step: 16, bass: 'A1 F1 C2 G1' },
    introFx: { len: 64, riser: [[32, 'x', 32, 0.75]], rev: [[52, 'x', 12, 0.8]], hat: '.*32 o.o.o.o.o.o.o.o.x.x.x.x.x.x.xxxx', kick: '.*48 X...X...X.X.XXXX' },

    // ── A / A2 ──
    arpA: { len: 128, arp: arp(halfList(A_H, { low: 'A3', high: 'A4', voices: 3 }), { rate: 1, len: 8, continue: true, oct: 2, order: [0, 1, 2, 3, 4, 5, 4, 3, 1, 2, 3, 4, 5, 3, 2, 1], vel: 0.68, accent: 0.16 }) },
    padA: { len: 128, pad: chordEvents(A_H, { low: 'E3', high: 'C5', voices: 4, vel: 0.7 }) },
    bassA: { len: 128, bass: bassFig(A_H, OFFBEAT) },
    leadA: { step: 2, lead: HOOK_A, lead2: transpose(HOOK_A, -12) },
    leadA2: { step: 2, lead: HOOK_A2, glass: HOOK_A2.replace(/~/g, ''), lead2: transpose(HOOK_A2, -12) },
    counterA: { step: 16, strings: COUNTER, vel: 0.62 },

    // ── B / B2 ──
    arpB: { len: 128, arp: arp(halfList(B_H, { low: 'A3', high: 'A4', voices: 3 }), { rate: 1, len: 8, continue: true, oct: 2, order: [0, 2, 1, 3, 2, 4, 3, 5], vel: 0.66, accent: 0.16 }) },
    padB: { len: 128, pad: chordEvents(B_H, { low: 'E3', high: 'C5', voices: 4, vel: 0.75 }) },
    bassB: { len: 128, bass: bassFig(B_H, EIGHTHS) },
    leadB: { step: 2, lead: SOAR, lead2: transpose(SOAR, -12) },
    choirB: { len: 128, choir: chordEvents(B_H, { low: 'E4', high: 'D5', voices: 3, rootless: true, vel: 0.6 }) },
    stabB: { len: 128, stab: chordEvents(B_H, { low: 'G3', high: 'E4', voices: 3, vel: 0.8 }).flatMap(([s, n, l, v]) => (l >= 16 ? [[s, n, 1.5, v], [s + 3, n, 1.5, v * 0.8], [s + 6, n, 2, v * 0.9], [s + 10, n, 1.5, v * 0.8]] : [[s, n, 1.5, v], [s + 3, n, 1.5, v * 0.8], [s + 6, n, 1.5, v * 0.85]])) },

    // ── breakdown ──
    padBrk: { len: 128, pad: chordEvents(BRK_H, { low: 'E3', high: 'C5', voices: 4, vel: 0.72 }) },
    arpBrk: { len: 128, arp: arp(halfList(BRK_H, { low: 'A3', high: 'A4', voices: 3 }), { rate: 2, len: 8, continue: true, oct: 2, order: [0, 1, 2, 3, 4, 5, 4, 3], vel: 0.6 }) },
    bassBrk: { step: 16, bass: 'A1 - F1 - C2 - G1 -' },
    choirBrk: { len: 128, choir: chordEvents(BRK_H, { low: 'E4', high: 'D5', voices: 3, rootless: true, vel: 0.55 }) },
    glassBrk: { step: 2, glass: 'A4 C5 E5 A5 - - . . | . . . . . . . . | F4 A4 C5 F5 - - . . | . . . . . . . . | G4 C5 E5 G5 - - . . | . . . . . . . . | G4 B4 D5 G5 - - . . | . . . . . . . .' },
    callBrk: {
      len: 128,
      brass: [...themeEvents({ tonic: 'A4', scale: 'minor', part: 'call', pickup: true, start: 16, vel: 0.8 }),
        ...themeEvents({ tonic: 'C5', scale: 'major', part: 'call', pickup: true, start: 80, vel: 0.85 })],
    },
    brkFx: { len: 128, rev: [[112, 'x', 16, 0.6]] },

    // ── build ──
    padBuild: { len: 64, pad: chordEvents(BUILD_H, { low: 'E3', high: 'C#5', voices: 4, vel: 0.8 }) },
    arpBuild: { len: 64, arp: arp(halfList(BUILD_H, { low: 'A3', high: 'A4', voices: 3 }), { rate: 1, len: 8, continue: true, oct: 2, order: [0, 1, 2, 3, 4, 5, 4, 3], vel: 0.68 }) },
    bassBuild: { len: 64, bass: bassFig(BUILD_H, EIGHTHS) },
    stabBuild: { len: 64, stab: chordEvents(BUILD_H, { low: 'A3', high: 'F#4', voices: 3, vel: 0.85 }).flatMap(([s, n, l, v]) => [[s, n, 1.5, v], [s + 6, n, 1.5, v * 0.9], [s + 12, n, 1.5, v]]) },
    fxBuild: { len: 64, riser: [[0, 'x', 64, 0.85]], rev: [[40, 'x', 24, 0.9]] },

    // ── climax (played up a whole step) ──
    climaxLead: { step: 2, lead: HOOK_A2, lead2: transpose(HOOK_A2, -12), brass: transpose(HOOK_A2.replace(/~/g, ''), -12) },
    climax2Lead: { step: 2, lead: SOAR, lead2: transpose(SOAR, -12), strings: transpose(SOAR, -12) },
    bassGallopA: { len: 128, bass: bassFig(A_H, GALLOP) },
    bassGallopB: { len: 128, bass: bassFig(B_H, GALLOP) },
    choirA: { len: 128, choir: chordEvents(A_H, { low: 'E4', high: 'D5', voices: 3, rootless: true, vel: 0.62 }) },
    climaxFx: { len: 128, impact: [[0, 'x', 1, 0.9]] },

    // ── turn (A major → F → G → A minor) ──
    padTurn: { len: 32, pad: chordEvents(TURN_H, { low: 'E3', high: 'C5', voices: 4, vel: 0.75 }) },
    arpTurn: { len: 32, arp: arp(halfList(TURN_H, { low: 'A3', high: 'A4', voices: 3 }), { rate: 1, len: 8, continue: true, oct: 2, order: [0, 1, 2, 3, 4, 5, 4, 3], vel: 0.66 }) },
    bassTurn: { len: 32, bass: bassFig(TURN_H, OFFBEAT) },
    leadTurn: { len: 32, lead: [[16, 'D5', 6, 0.8], [22, 'B4', 6, 0.75], [30, 'E4', 2, 0.8]], lead2: [[16, 'D4', 6, 0.8], [22, 'B3', 6, 0.75], [30, 'E3', 2, 0.8]] },
  },

  sections: {
    intro: {
      bars: 4, chords: INTRO_H,
      play: ['introArp', 'introPad', 'introBass', 'introFx'],
      auto: { 'arp.lpf': [[0, 450], [4, 9000]], 'pad.lpf': [[0, 600], [4, 6000]] },
    },
    A: {
      bars: 8, chords: A_H,
      play: ['arpA', 'padA', 'bassA', 'leadA', ['crash1', null, null, null, null, null, null, null],
        ['beatA', 'beatA', 'beatA', 'fill1', 'beatA', 'beatA', 'beatA', 'fill2'], 'rideA', 'taikoA'],
    },
    A2: {
      bars: 8, chords: A_H,
      play: ['arpA', 'padA', 'bassA', 'leadA2', 'counterA', ['crash1', null, null, null, null, null, null, null],
        ['beatA2', 'beatA2', 'beatA2', 'fill1', 'beatA2', 'beatA2', 'beatA2', 'fillB'], 'rideA', 'taikoA'],
    },
    B: {
      bars: 8, chords: B_H,
      play: ['arpB', 'padB', 'bassB', 'leadB', ['crash1', null, null, null, null, null, null, null],
        ['beatB', 'beatB', 'beatB', 'fill1', 'beatB', 'beatB', 'beatB', 'fill2'], 'rideA', 'taikoB'],
    },
    B2: {
      bars: 8, chords: B_H,
      play: ['arpB', 'padB', 'bassB', 'leadB', 'choirB', 'stabB', ['crash1', null, null, null, 'crash1', null, null, null],
        ['beatA2', 'beatA2', 'beatA2', 'fill1', 'beatA2', 'beatA2', 'beatA2', 'fillB'], 'rideA', 'taikoB'],
    },
    break: {
      bars: 8, chords: BRK_H,
      play: ['padBrk', 'arpBrk', 'bassBrk', 'choirBrk', 'glassBrk', 'callBrk', 'brkFx', { p: 'brkHat', at: 4 }],
      auto: { 'pad.lpf': [[0, 900], [4, 1500], [8, 5000]], 'arp.lpf': [[0, 700], [8, 3000]] },
    },
    build: {
      bars: 4, chords: BUILD_H,
      play: ['padBuild', 'arpBuild', 'bassBuild', 'stabBuild', 'fxBuild', ['bu1', 'bu2', 'bu3', 'bu4']],
      auto: { 'arp.lpf': [[0, 1500], [4, 12000]], 'pad.lpf': [[0, 1800], [4, 9000]] },
    },
    climax: {
      bars: 8, chords: A_H,
      play: ['arpA', 'padA', 'bassGallopA', 'climaxLead', 'choirA', 'climaxFx', ['crash1', null, null, null, 'crash1', null, null, null],
        ['beatA2', 'beatA2', 'beatA2', 'fill1', 'beatA2', 'beatA2', 'beatA2', 'fillB'], 'rideA', 'taikoA'],
    },
    climax2: {
      bars: 8, chords: B_H,
      play: ['arpB', 'padB', 'bassGallopB', 'climax2Lead', 'choirB', 'stabB', ['crash1', null, null, null, 'crash1', null, null, null],
        ['beatA2', 'beatA2', 'beatA2', 'fill1', 'beatA2', 'beatA2', 'beatA2', 'fill2'], 'rideA', 'taikoB'],
    },
    turn: {
      bars: 2, chords: TURN_H,
      play: ['padTurn', 'arpTurn', 'bassTurn', 'leadTurn', ['beatB', 'fillB']],
    },
  },

  arrangement: ['intro', 'A', 'A2', 'B', 'B2', 'break', 'build', { s: 'climax', tr: 2 }, { s: 'climax2', tr: 2 }, 'turn'],
  loop: 'A',
};
