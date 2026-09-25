// Sector 2 — "Cinder Belt". Heavy, gritty darksynth / industrial in E minor, 116 BPM.
// The belt is a furnace: a machine pulse of metal clanks and struck-pipe FM "anvils", a
// distorted reese pumping under the kick, and a 16th-note pedal riff grinding down the
// Andalusian line i–bVII–bVI–V (Em D C B). Over it, two opposing voices:
//   THE HOOK     ominous: each phrase holds the chord's 5th, sighs a step up and back, then
//                falls through the triad — sequenced down a step every two bars.
//   THE COUNTER  heroic: opens with the LANCERS CALL in the minor (tonic → up a fifth,
//                "da | DAAA – da-DAAAAA"), re-calls it a seventh higher on bVII, then climbs.
// Form (58 bars ≈ 120 s; loops from A, a 103 s cycle):
//   intro (8)    the machine wakes: clank loop, anvil tolls the hook, reese drone; the riff
//                grinds in behind a closing filter; riser → impact
//   A (8)        full kit (four-on-the-floor + gated snare), riff, reese, dark pad; the HOOK
//   A2 (8)       the COUNTER on bright lead; low strings carry the hook underneath; stabs
//   B (8)        heroic lift into the relative major (C D G Em C D Bsus4 B): rock beat with
//                ride, octave-8ths riff, choir; a soaring anthem line (peaks on D6)
//   break (8)    the kit drops out; anvils echo the hook; brass calls in E minor, answers in
//                C major (hope), strings reply over Am; heartbeat taiko → snare build
//   climax (8)   everything: counter on lead + brass, the choir sings the hook beneath it
//   climax2 (8)  the anthem again with brass, strings and choir, taiko thunder
//   tag (2)      stop-time hits on bVI → V7 (C → B7): the machine stutters, then drops back into A
// Intensity: ≥0.7 ride on the A grooves, ≥0.75 taiko, ≥0.8 a square lead doubles the tune in
// octaves; <0.15 drops the kit (machine, riff, reese, pad and melodies carry on).
// Mix: song gain 0.77 lands at ≈ −14 LUFS integrated like aurora.js. Note that a channel `drive`
// also adds gain to quiet signals (hook, snare), hence their low channel gains.

import { voiceLead, chordInfo } from '../music.js';
import { themeEvents } from './motifs.js';

// ── harmony ──────────────────────────────────────────────────────────────────────────
const INTRO_H = 'Em Em Em Em Em Em C B';
const A_H = 'Em Em D D C C B B';
const B_H = 'C D G Em C D Bsus4 B';
const BRK_H = 'Em Em C C Am Am B B';
const TAG_H = 'C B7';

const BAR = 16;
// flatten 'Am,G' style bars into [symbol, startStep, lenSteps]
function flat(harm) {
  const out = [];
  harm.split(' ').forEach((bar, b) => bar.split(',').forEach((c, i, a) => out.push([c, b * BAR + (i * BAR) / a.length, BAR / a.length])));
  return out;
}
// voice-led chord events (one per bar / half bar)
function chordEvents(harm, opt) {
  const f = flat(harm);
  return voiceLead(f.map((x) => x[0]), opt).map((n, i) => [f[i][1], n, f[i][2] * (opt.legato ?? 1), opt.vel ?? 0.7]);
}
// chord root placed in a fixed octave window starting at `lo` (MIDI)
const rootIn = (sym, lo) => lo + ((chordInfo(sym).root - (lo % 12) + 12) % 12);
// reese: the root re-struck every bar (B1..A#2 → E2 D2 C2 B1: the Andalusian descent)
function reeseLine(harm, lo = 35, vel = 0.85) {
  return flat(harm).flatMap(([c, s, l]) => {
    const ev = [];
    for (let k = 0; k < l; k += BAR) ev.push([s + k, rootIn(c, lo), Math.min(BAR, l - k), vel]);
    return ev;
  });
}
// 16th pedal riff: per-bar figures of semitone offsets from the pedal root (null = rest).
// The first bar of a chord plays figs[0], the second figs[1] (a lead-in to the next chord).
function riffLine(harm, figs, lo = 47, vel = 0.85) {
  const ev = [];
  const f = [];
  for (const x of flat(harm)) { const p = f[f.length - 1]; if (p && p[0] === x[0] && p[1] + p[2] === x[1]) p[2] += x[2]; else f.push(x.slice()); }
  f.forEach(([c, s, l]) => {
    const r = rootIn(c, lo);
    for (let b = 0; b < l / BAR; b++) {
      const fig = typeof figs === 'function' ? figs(c, b) : figs[Math.min(b, figs.length - 1)];
      fig.forEach((o, i) => { if (o != null) ev.push([s + b * BAR + i, r + o, 0.9, (i % 4 === 0 ? 1 : i % 2 ? 0.72 : 0.84) * vel]); });
    }
  });
  return ev;
}
const _ = null;
// pedal figures (minor 3rd = 3, b7 = 10, maj7 = 11 …): root root · root | 8ve root · root | 5 root · root | …
const RIFF_MIN = [[0, 0, _, 0, 12, 0, _, 0, 7, 0, _, 0, 10, 0, 7, 0], [0, 0, _, 0, 12, 0, _, 0, 7, 0, _, 0, 3, _, 5, 7]];
const RIFF_MAJ = [[0, 0, _, 0, 12, 0, _, 0, 7, 0, _, 0, 10, 0, 7, 0], [0, 0, _, 0, 12, 0, _, 0, 7, 0, _, 0, 4, _, 7, 9]];   // b7 = C over D
const RIFF_C = [[0, 0, _, 0, 12, 0, _, 0, 7, 0, _, 0, 11, 0, 7, 0], [0, 0, _, 0, 12, 0, _, 0, 7, 0, _, 0, 4, _, 7, 11]];
const RIFF_V = [[0, 0, _, 0, 12, 0, _, 0, 7, 0, _, 0, 10, 0, 7, 0], [0, 0, _, 0, 12, 0, _, 0, 7, 0, 4, 0, 7, 0, 10, 12]];   // B7 climbs out
function riffFor(c, b) {
  const q = c.replace(/^[A-G][#b]?/, '');
  const set = c === 'B' || c === 'Bsus4' ? RIFF_V : c === 'C' ? RIFF_C : q === 'm' ? RIFF_MIN : RIFF_MAJ;
  return set[Math.min(b, 1)];
}
// B section: driving 8th octaves (root, root, 8ve, root …)
const OCT8 = [[0, _, 0, _, 12, _, 0, _, 0, _, 12, _, 0, _, 12, _]];

// ── melodies (16th-step tokens; `*n` = n steps) ──────────────────────────────────────
// THE HOOK — 5th held, a sigh to the step above and back, fall through the triad; sequenced down.
const HOOK = 'B4*12 C5*2 B4*10 G4*4 E4*4 | A4*12 B4*2 A4*10 F#4*4 D4*4 | G4*12 A4*2 G4*10 E4*4 C4*4 | F#4*12 G4*2 F#4*10 D#4*4 B3*4';
// the same line without the sighs, for sustaining sections (strings, choir): a neighbour note
// that a mono lead passes through would ring on as a rub in a pad-like part
const HOOK_HELD = 'B4*24 G4*4 E4*4 | A4*24 F#4*4 D4*4 | G4*24 E4*4 C4*4 | F#4*24 D#4*4 B3*4';
// THE COUNTER — the Lancers call (E→B), the call again on D (D→A an octave up), a climb, B7 home.
const COUNTER = 'E4*6 B4*10 | A4*2 G4*2 A4*2 B4*2 E5*4 D5*4 | D5*6 A5*10 | G5*2 F#5*2 G5*2 A5*2 F#5*4 D5*4 |' +
  ' E5*6 G5*6 C6*4 | B5*2 A5*2 G5*4 E5*8 | F#5*4 A5*4 B5*8 | B5*2 A5*2 F#5*4 D#5*8';
// THE ANTHEM (B) — rising cells over C D G Em, then the climb to D6 and the dominant
const ANTHEM = 'G4*2 C5*4 D5*2 E5*8 | F#5*4 E5*2 D5*2 A4*8 | B4*2 D5*4 E5*2 G5*8 | G5*4 F#5*2 E5*2 B4*8 |' +
  ' C5*2 E5*4 G5*2 C6*8 | A5*4 F#5*2 A5*2 D6*8 | B5*8 F#5*4 E5*4 | F#5*4 D#5*4 B4*8';
// shift every note of a token line by whole octaves
const oct = (line, k) => line.replace(/([A-G][#b]?)(\d)/g, (_, n, o) => n + (+o + k));

// anvils: a struck-pipe clang on the "and" of 4, pitched to each bar's chord
const ANVIL_A = [[14, 'B4'], [30, 'E5'], [46, 'A4'], [62, 'D5'], [78, 'G4'], [94, 'E5'], [110, 'F#4'], [126, 'B4']].map(([s, n]) => [s, n, 2, 0.75]);
const ANVIL_B = [[14, 'G4'], [30, 'A4'], [46, 'D5'], [62, 'B4'], [78, 'G4'], [94, 'A4'], [110, 'E5'], [126, 'D#5']].map(([s, n]) => [s, n, 2, 0.75]);

// stabs: 3-3-2 syncopation on every bar's chord
const stab = (harm, opt) => chordEvents(harm, opt).flatMap(([s, n, l, v]) => {
  const out = [];
  for (let k = 0; k < l; k += BAR) for (const [o, w] of [[0, 1], [3, 0.8], [6, 0.9], [10, 0.8], [13, 0.75]]) out.push([s + k + o, n, 1.4, v * w]);
  return out;
});

export default {
  title: 'Cinder Belt',
  bpm: 116,
  key: 'E', scale: 'minor',
  gain: 0.77,
  reverb: 0.9,
  delay: { beats: 0.75, feedback: 0.34, lp: 3000, hp: 450 },
  duck: { release: 0.24 },
  seed: 23,

  instruments: {
    // distorted reese: three detuned saws phasing, pushed hard into the waveshaper
    cReese: { base: 'reese', detune: 24, cutoff: 1300, q: 3, sub: 0.1, drive: 0.85, range: [29, 53] },
    // gritty mid-bass for the pedal riff: resonant filter pluck, heavy drive
    cRiff: { base: 'bass', square: 0.5, sub: 0.15, cutoff: 620, kt: 0.6, env: 2.7, fd: 0.14, q: 6, drive: 0.75, d: 0.12, s: 0.5, r: 0.05, range: [41, 71] },
    // ominous saw lead (live): dark filter, slow vibrato
    cHook: { type: 'lead', wave: 'saw', voices: 3, detune: 12, cutoff: 1500, q: 3, kt: 0.5, env: 1.9, fa: 0.015, fd: 0.5, vib: 13, vibRate: 5.2, vibDelay: 0.4, glide: 0.08, a: 0.01, d: 0.5, s: 0.75, r: 0.3, vol: 0.6 },
    // heroic lead (live): bright detuned saws
    cHero: { base: 'leadBright', cutoff: 3400, env: 1.4, vib: 17, vibDelay: 0.26, glide: 0.05, r: 0.28 },
    cOct: { base: 'leadSquare', cutoff: 2600, vib: 12, r: 0.2 },
    // metallic percussion
    cKick: { base: 'kickHard', f0: 240, f1: 48, decay: 0.42, drive: 0.7 },
    cHat: { base: 'hat', tone: 1.3, metal: 0.95, decay: 0.045, hp: 6500 },
    clank: { type: 'cymbal', decay: 0.3, hp: 3500, metal: 0.7, stick: 0.9, ping: 1.6, pingF: 494, bright: 0.8, vol: 0.7 },   // struck pipe, rings on B
    ping: { type: 'cymbal', decay: 0.8, hp: 2400, metal: 0.55, stick: 0.7, ping: 1.3, pingF: 988, bright: 0.85, vol: 0.62 },    // metal bar, rings on B
    anvil: { type: 'fm', ratio: 1.41, index: 4.2, isus: 0.06, idecay: 0.16, decay: 1.1, detune: 7, c2: 2.76, m2: 1.53, i2: 1.8, d2: 0.22, l2: 0.55, range: [53, 83], vol: 0.72 },
  },

  channels: {
    kick: { inst: 'cKick', gain: 0.44, sidechain: true, layer: { min: 0.15 } },
    snare: { inst: 'snareBig', gain: 0.22, reverb: 0.26, drive: 0.25, layer: { min: 0.15 } },
    clap: { gain: 0.3, reverb: 0.22, pan: 0.1, layer: { min: 0.15 } },
    hat: { inst: 'cHat', gain: 0.36, pan: 0.22, choke: ['ohat'], human: { t: 0.002, v: 0.12 } },
    ohat: { gain: 0.26, pan: 0.28 },
    ride: { gain: 0.24, pan: -0.28, layer: { min: 0.7 } },
    ride2: { inst: 'ride', gain: 0.26, pan: -0.28 },
    clank: { gain: 0.34, pan: -0.32, reverb: 0.18, delay: 0.1, human: { t: 0.002, v: 0.1 } },
    ping: { gain: 0.26, pan: 0.36, reverb: 0.3 },
    rim: { gain: 0.28, pan: 0.15, reverb: 0.2 },
    anvil: { gain: 0.52, poly: 3, reverb: 0.35, delay: 0.18, pan: 0.18 },
    crash: { gain: 0.4, reverb: 0.15, pan: -0.2 },
    tom: { gain: 0.3, reverb: 0.2, drive: 0.2, poly: 2 },
    taiko: { gain: 0.46, reverb: 0.22, layer: { min: 0.75 } },
    boom: { inst: 'taiko', gain: 0.38, reverb: 0.25 },
    rev: { inst: 'revcym', gain: 0.4 },
    riser: { gain: 0.4, reverb: 0.3 },
    down: { inst: 'downlifter', gain: 0.34, reverb: 0.3 },
    impact: { gain: 0.44, reverb: 0.25, poly: 1 },
    reese: { inst: 'cReese', gain: 0.25, duck: 0.6, drive: 0.3, lpf: 2400 },
    riff: { inst: 'cRiff', gain: 1.4, duck: 0.35, lpf: 20000, pan: 0.04 },
    pad: { inst: 'padDark', gain: 0.27, poly: 8, duck: 0.55, reverb: 0.3, lpf: 2600 },
    strings: { gain: 0.42, reverb: 0.35, duck: 0.25, pan: -0.15, lpf: 3200 },
    choir: { gain: 0.24, reverb: 0.45, duck: 0.25 },
    stab: { inst: 'brassStab', gain: 0.26, poly: 5, reverb: 0.22, drive: 0.35, pan: 0.12, delay: 0.1, duck: 0.3 },
    brass: { gain: 0.44, reverb: 0.3, pan: -0.06 },
    hook: { inst: 'cHook', gain: 0.38, reverb: 0.24, delay: 0.2, drive: 0.3 },
    lead: { inst: 'cHero', gain: 0.8, reverb: 0.22, delay: 0.22 },
    lead2: { inst: 'cOct', gain: 0.34, reverb: 0.2, pan: 0.1, layer: { min: 0.8 } },
  },

  patterns: {
    // ── drums ──
    beatA: { kick: 'X...X...X...X...', snare: '....X.......X...', clap: '....x.......x...', hat: 'xgxgxgxgxgxgxgxg', clank: '..x..x....x..x..' },
    beatA2: { kick: 'X...X...X...X..x', snare: '....X.......X...', clap: '....x.......x...', hat: 'xgxgxgxgxgxgxgxg', ohat: '......x.......x.', clank: 'x..x..x.x..x..x.' },
    fillA: { kick: 'X...X...X...X...', snare: '....X.......X.xx', clap: '....x.......x...', hat: 'xgxgxgxgxgxg....', clank: '..x..x..........', tom: '.*12 E3 C3 A2 E2' },
    fillB: {
      kick: 'X...X...X.......', clap: '....x...........', hat: 'xgxgxgxg........', ping: '........x.......',
      snare: '. . . . X . . . x@0.5 . x@0.6 x@0.66 x@0.72 x@0.8 x@0.9 X',
      tom: '.*8 E3 . C3 . A2 A2 E2 E2',
    },
    pingA: { ping: '..............x.|..............x.' },
    rideA: { ride: 'x.x.x.x.x.x.x.x.' },
    taikoA: { taiko: 'X.......x.x.....' },
    crash1: { crash: 'X' },
    // B: rock beat on the ride
    beatB: { kick: 'X.....x.X.....x.', snare: '....X.......X...', clap: '....x.......x...', ride2: 'x.x.x.x.x.x.x.x.', hat: '.g.g.g.g.g.g.g.g', clank: '..........x.....' },
    beatB2: { kick: 'X.....x.X.x...x.', snare: '....X.......X...', clap: '....x.......x...', ride2: 'x.x.x.x.x.x.x.x.', hat: '.g.g.g.g.g.g.g.g', clank: '..x.......x.....' },
    fillBB: { kick: 'X.....x.X.......', snare: '....X...x.xxX.XX', ride2: 'x.x.x.x.........', tom: '.*8 E3 E3 C3 . A2 . E2 E2' },
    taikoB: { taiko: 'X.....x.X.......' },
    // intro / break machine loop (2 bars, 3-3-2 clanks, rim ticks)
    machine: { clank: 'X..x..x.x..x..x.|x..x..x.x..x.xx.', rim: '........o.......|........o.....g.' },
    machine2: { clank: 'X..x..x.x..x..x.|x..x..x.x..x.xx.', rim: '....o.......o...|....o.......o.g.', hat: 'g.g.g.g.g.g.g.g.|g.g.g.g.g.g.g.g.' },
    introKick: { len: 32, kick: 'X...X...X...X...|X...X...X.X.XXXX', snare: '.*16 x@0.3 . x@0.35 . x@0.4 . x@0.45 . x@0.5 x@0.55 x@0.6 x@0.65 x@0.7 x@0.8 x@0.9 X' },
    // break heartbeat + build
    heart: { boom: 'X.......X.......' },
    heart2: { boom: 'X.......X.....x.', hat: 'x.x.x.x.x.x.x.x.' },
    bu1: { vel: 0.6, kick: 'X...X...X...X...', snare: 'x...x...x...x...', hat: 'x.x.x.x.x.x.x.x.' },
    bu2: { vel: 0.72, kick: 'X...X...X.X.X.X.', snare: 'x.x.x.x.xxxxrrRR', tom: '.*12 E3 C3 A2 E2', hat: 'x.x.x.x.x.x.x.x.' },

    // ── intro ──
    introDrone: { step: 16, reese: 'E2 E2 E2 E2 E2 E2 C2 B1', vel: 0.8 },
    introPad: { len: 128, pad: [[0, 'E3+B3+G4', 48, 0.6], [48, 'E3+B3+G4+B4', 48, 0.66], [96, 'C3+G3+E4+G4', 16, 0.7], [112, 'B2+F#3+D#4+F#4', 16, 0.72]] },
    introChoir: { len: 128, choir: [[32, 'E4+B4', 64, 0.5], [96, 'E4+G4', 16, 0.55], [112, 'D#4+F#4', 16, 0.6]] },
    introAnvil: { len: 128, anvil: [[0, 'E4', 4, 0.8], [32, 'B4', 12, 0.7], [46, 'B4', 10, 0.6], [56, 'G4', 4, 0.6], [60, 'E4', 4, 0.64], [64, 'E4', 4, 0.8],
      [96, 'E5', 4, 0.7], [108, 'C5', 4, 0.6], [112, 'D#5', 4, 0.7], [120, 'B4', 4, 0.66]] },
    introRiff: { len: 64, riff: riffLine('Em Em C B', riffFor, 47, 0.8) },
    introFx: { len: 128, riser: [[64, 'x', 64, 0.75]], rev: [[112, 'x', 16, 0.8]], down: [[0, 'x', 32, 0.5]] },

    // ── A / A2 ──
    reeseA: { len: 128, reese: reeseLine(A_H) },
    riffA: { len: 128, riff: riffLine(A_H, riffFor) },
    padA: { len: 128, pad: chordEvents(A_H, { low: 'E3', high: 'B4', voices: 4, vel: 0.66 }) },
    hookA: { hook: HOOK, lead2: oct(HOOK, 1) },
    anvilA: { len: 128, anvil: ANVIL_A },
    counterA: { lead: COUNTER, lead2: oct(COUNTER, -1), strings: { n: oct(HOOK_HELD, -1), vel: 0.62 } },
    stabA: { len: 128, stab: stab(A_H, { low: 'G3', high: 'E4', voices: 3, vel: 0.72 }) },
    impactA: { impact: 'X' },

    // ── B ──
    reeseB: { len: 128, reese: reeseLine(B_H) },
    riffB: { len: 128, riff: riffLine(B_H, OCT8, 47, 0.9) },
    padB: { len: 128, pad: chordEvents(B_H, { low: 'E3', high: 'C5', voices: 4, vel: 0.72 }) },
    choirB: { len: 128, choir: chordEvents(B_H, { low: 'E4', high: 'D5', voices: 3, rootless: true, vel: 0.55 }) },
    anthemB: { lead: ANTHEM, lead2: oct(ANTHEM, -1) },
    anvilB: { len: 128, anvil: ANVIL_B },
    stabB: { len: 128, stab: stab(B_H, { low: 'G3', high: 'E4', voices: 3, vel: 0.78 }) },

    // ── break ──
    reeseBrk: { step: 16, reese: 'E2 - C2 - A1 - B1 B1', vel: 0.7 },
    padBrk: { len: 128, pad: chordEvents(BRK_H, { low: 'E3', high: 'B4', voices: 4, vel: 0.62 }) },
    choirBrk: { len: 128, choir: chordEvents(BRK_H, { low: 'E4', high: 'D5', voices: 3, rootless: true, vel: 0.5 }) },
    anvilBrk: { len: 128, anvil: [[0, 'B4', 12, 0.9], [14, 'B4', 10, 0.75], [24, 'G4', 4, 0.78], [28, 'E4', 4, 0.82],
      [64, 'E5', 12, 0.85], [78, 'E5', 10, 0.72], [88, 'C5', 4, 0.74], [92, 'A4', 4, 0.8]] },
    callBrk: {
      len: 128,
      brass: [...themeEvents({ tonic: 'E4', scale: 'minor', part: 'call', pickup: true, start: 16, vel: 0.95 }),
        ...themeEvents({ tonic: 'C5', scale: 'major', part: 'call', pickup: true, start: 48, vel: 1 })],
      strings: [[64, 'A4', 4, 0.6], [68, 'C5', 4, 0.64], [72, 'E5', 6, 0.68], [78, 'D5', 2, 0.62], [80, 'C5', 16, 0.64],
        [96, 'D#4+F#4+B4', 32, 0.62]],
    },
    brkFx: { len: 128, riser: [[96, 'x', 32, 0.8]], rev: [[104, 'x', 24, 0.85]], down: [[0, 'x', 32, 0.6]], crash: [[0, 'x', 1, 0.8]] },
    riffBrk: { len: 32, riff: riffLine('B B', riffFor, 47, 0.75) },

    // ── climax ──
    climaxA: { lead: COUNTER, lead2: oct(COUNTER, -1), brass: { n: oct(COUNTER, -1), vel: 0.85 }, choir: { n: oct(HOOK_HELD, -1), vel: 0.9 } },
    climaxB: { lead: ANTHEM, lead2: oct(ANTHEM, -1), brass: { n: oct(ANTHEM, -1), vel: 0.85 }, strings: { n: ANTHEM, vel: 0.6 } },
    thunder: { boom: 'X.....x.X.......' },

    // ── tag (stop-time on the dominant) ──
    tagHits: {
      kick: 'X..X..X...X.X...|X..X..X.........', snare: 'X..X..X...X.X...|X..X..X.....xxxx', crash: 'X...............|................',
      clank: '....x..x.x...x.x|....x..x.xxx....', tom: '.*24 E3 . C3 . A2 A2 E2 E2',
    },
    tagRiff: {
      riff: 'C3 . . C3 . . C3 . . . B2 . C3 . . . | B2 . . B2 . . B2 . D#3 F#3 A3 B3 . . . .',
      reese: 'C2*16 | B1*6 . . . . . . . . . .',
      stab: 'C4+E4+G4 . . C4+E4+G4 . . C4+E4+G4 . . . C4+E4+G4 . C4+E4+G4 . . . | D#4+F#4+B4 . . D#4+F#4+B4 . . D#4+F#4+B4 . . . . . . . . .',
    },
    tagLead: { lead: 'G4*6 C5*4 E5*6 | F#5*6 A5*4 F#5*2 D#5*2 B4*2', lead2: 'G3*6 C4*4 E4*6 | F#4*6 A4*4 F#4*2 D#4*2 B3*2' },
    tagPad: { len: 32, pad: [[0, 'C3+G3+E4+G4', 16, 0.7], [16, 'B2+F#3+D#4+A4', 16, 0.72]], choir: [[0, 'E4+G4+C5', 16, 0.55], [16, 'D#4+F#4+B4', 16, 0.58]] },
  },

  sections: {
    intro: {
      bars: 8, chords: INTRO_H,
      play: [{ p: 'machine', until: 4 }, { p: 'machine2', at: 4 }, 'introDrone', 'introPad', 'introChoir', 'introAnvil', { p: 'introRiff', at: 4 }, 'introFx', { p: 'introKick', at: 6 }],
      auto: { 'reese.lpf': [[0, 220], [6, 900], [8, 2400]], 'riff.lpf': [[4, 260], [8, 5000]], 'pad.lpf': [[0, 500], [8, 2600]], 'pad.vol': [[0, 0.45], [6, 1]] },
    },
    A: {
      bars: 8, chords: A_H,
      play: ['reeseA', 'riffA', 'padA', 'hookA', 'anvilA', 'impactA', ['crash1', null, null, null, null, null, null, null],
        ['beatA', 'beatA', 'beatA', 'fillA', 'beatA', 'beatA', 'beatA', 'fillB'], 'pingA', 'rideA', 'taikoA'],
    },
    A2: {
      bars: 8, chords: A_H,
      play: ['reeseA', 'riffA', 'padA', 'counterA', 'anvilA', 'stabA', ['crash1', null, null, null, 'crash1', null, null, null],
        ['beatA2', 'beatA2', 'beatA2', 'fillA', 'beatA2', 'beatA2', 'beatA2', 'fillB'], 'pingA', 'rideA', 'taikoA'],
    },
    B: {
      bars: 8, chords: B_H,
      play: ['reeseB', 'riffB', 'padB', 'choirB', 'anthemB', 'anvilB', ['crash1', null, null, null, 'crash1', null, null, null],
        ['beatB', 'beatB', 'beatB', 'fillBB', 'beatB2', 'beatB2', 'beatB2', 'fillB'], 'taikoB'],
      auto: { 'riff.lpf': [[0, 2400], [8, 6000]] },
    },
    break: {
      bars: 8, chords: BRK_H,
      play: ['reeseBrk', 'padBrk', 'choirBrk', 'anvilBrk', 'callBrk', 'brkFx', { p: 'machine', until: 6 }, { p: 'riffBrk', at: 6 },
        [null, null, 'heart', 'heart', 'heart', 'heart2', 'bu1', 'bu2']],
      auto: { 'reese.lpf': [[0, 500], [6, 700], [8, 2400]], 'reese.vol': [[0, 0.6], [6, 0.6], [8, 1]], 'pad.lpf': [[0, 900], [6, 1500], [8, 3000]], 'riff.lpf': [[6, 400], [8, 4000]] },
    },
    climax: {
      bars: 8, chords: A_H,
      play: ['reeseA', 'riffA', 'padA', 'climaxA', 'stabA', 'anvilA', 'impactA', ['crash1', null, null, null, 'crash1', null, null, null],
        ['beatA2', 'beatA2', 'beatA2', 'fillA', 'beatA2', 'beatA2', 'beatA2', 'fillB'], 'pingA', 'rideA', 'taikoA'],
    },
    climax2: {
      bars: 8, chords: B_H,
      play: ['reeseB', 'riffB', 'padB', 'choirB', 'climaxB', 'stabB', 'anvilB', ['crash1', null, null, null, 'crash1', null, null, null],
        ['beatB2', 'beatB2', 'beatB2', 'fillBB', 'beatB2', 'beatB2', 'beatB2', 'fillBB'], 'taikoB', 'thunder'],
    },
    tag: {
      bars: 2, chords: TAG_H,
      play: ['tagHits', 'tagRiff', 'tagLead', 'tagPad'],
    },
  },

  arrangement: ['intro', 'A', 'A2', 'B', 'break', 'climax', 'climax2', 'tag'],
  loop: 'A',
};
