// Sector 3 — "Veil Nebula". Ethereal, mysterious, awe-struck: C# dorian / E lydian (the same
// seven notes seen from two sides), 172 BPM written as a half-time 86 feel.
// Harmony lives in the B-major collection: dorian i–IV (C#m9 → F#9, its raised 6th A# is the
// "veil" colour), lydian I–II (E → F#/E), plus one chord from outside — Amaj7#11, a bVI with the
// #11 (D#) on top that makes the whole nebula shimmer.
//   THE VEIL MELODY  (theremin-like triangle lead, glass doubling): 5 → 1 → 9 rising question,
//                    a falling answer onto the dorian A#, the question sequenced on E, …
//   THE AWE MELODY   (glass bells + choir): three rising arpeggios, each one reaching higher
//                    (B–E–G#, D#–F#–B, C#–E–G#) with the lydian A# at the top of the first.
// Form (88 bars ≈ 123 s; loops from A, a 112 s cycle):
//   intro (8)    glass bells and harp shimmer in, choir swell, pad opens; reverse cymbal
//   A (16)       half-time breakbeat, warm sub, harp arps through the ping-pong delay; the VEIL
//                melody
//   B (16)       awe: E lydian, ride wash, choir, strings; the AWE melody on bells + choir
//   break (8)    drums out; the LANCERS CALL on glass bells in C# dorian, then in E major
//   build (4)    Amaj7#11 → Bsus4 → B: snare roll accelerates into double time
//   A2 (16)      full two-step drum & bass: rolling reese, the VEIL melody on lead + strings,
//                glass sparkles
//   B2 (16)      the AWE melody on lead, choir, strings and bells over the two-step — the peak
//                (C#6), then G#7sus4 hands back to…
//   outro (4)    half time again; the melody's opening echoes on glass, loop to A
// Intensity: ≥0.7 ride on the half-time grooves, ≥0.75 16th glass sparkles, ≥0.8 a second lead
// an octave down; <0.15 drops the drums (pad, arps, melody only).

import { arp, chordInfo, midi } from '../music.js';
import { themeEvents } from './motifs.js';

// ── harmony (one token per 172-BPM bar; chords change every two bars = one 86 bar) ─────
const INTRO_H = 'C#m9 C#m9 C#m9 C#m9 Amaj7#11 Amaj7#11 G#7sus4 G#7sus4';
const A_H = 'C#m9 C#m9 F#9 F#9 Eadd9 Eadd9 G#m7 G#m7 C#m9 C#m9 F#9 F#9 Amaj7#11 Amaj7#11 G#7sus4 G#7sus4';
const B_H = 'Eadd9 Eadd9 F#/E F#/E G#m7 G#m7 C#m11 C#m11 Amaj7 Amaj7 Bsus4 B C#m7 C#m7 G#7sus4 G#7sus4';
const BRK_H = 'C#m9 C#m9 Amaj7#11 Amaj7#11 Eadd9 Eadd9 F#/E F#/E';
const BUILD_H = 'Amaj7#11 Amaj7#11 Bsus4 B';
const OUTRO_H = 'C#m9 C#m9 G#7sus4 G#7sus4';

// Every part reads its notes from one table, so the colour tones sit in agreed octaves: a
// semitone pair inside a chord (3rd/9th of C#m9, root/7th and 5th/#11 of Amaj7#11) is always
// spread a major 7th apart, never a minor 2nd or 9th — lush, not muddy.
//              pad                      choir           harp pool (low → high)               sparkle            strings
const CH = {
  'C#m9':     ['C#3+G#3+E4+B4+D#5',    'G#4+B4+D#5',  'G#3 B3 C#4 E4 G#4 B4 C#5 D#5',      'G#5 B5 C#6 D#6',  'G#3+B3+E4'],
  'C#m7':     ['C#3+G#3+E4+G#4+B4',    'G#4+B4+E5',   'G#3 B3 C#4 E4 G#4 B4 C#5 E5',       'E5 G#5 B5 C#6',   'G#3+B3+E4'],
  'C#m11':    ['C#3+G#3+E4+G#4+B4',    'G#4+B4+D#5',  'G#3 B3 C#4 E4 G#4 B4 C#5 D#5',      'G#5 B5 C#6 D#6',  'G#3+B3+E4'],
  'F#9':      ['F#3+A#3+E4+G#4+C#5',   'E4+A#4+C#5',  'F#3 A#3 C#4 E4 F#4 G#4 A#4 C#5',    'F#5 G#5 A#5 C#6', 'A#3+C#4+E4'],
  'Eadd9':    ['E3+B3+F#4+G#4+B4',     'G#4+B4+F#5',  'G#3 B3 E4 F#4 G#4 B4 E5 F#5',       'E5 F#5 G#5 B5',   'G#3+B3+F#4'],
  'G#m7':     ['G#3+B3+F#4+B4',        'G#4+B4+F#5',  'G#3 B3 F#4 G#4 B4 F#5 G#5 B5',      'F#5 G#5 B5 D#6',  'G#3+B3+F#4'],
  'Amaj7#11': ['A3+E4+G#4+C#5+D#5',    'G#4+C#5+D#5', 'A3 C#4 E4 G#4 C#5 D#5 G#5 C#6',     'G#5 C#6 D#6 G#6', 'A3+C#4+G#4'],
  'Amaj7':    ['A3+E4+G#4+C#5',        'G#4+C#5+E5',  'A3 C#4 E4 G#4 C#5 E5 G#5 C#6',      'E5 G#5 C#6 E6',   'A3+C#4+E4'],
  'G#7sus4':  ['G#3+C#4+D#4+F#4+C#5',  'G#4+C#5+D#5', 'G#3 C#4 D#4 F#4 G#4 C#5 D#5 F#5',   'F#5 G#5 C#6 D#6', 'C#4+D#4+F#4'],
  'F#/E':     ['E3+A#3+C#4+F#4+A#4',   'A#4+C#5+F#5', 'A#3 C#4 E4 F#4 A#4 C#5 F#5 A#5',    'F#5 A#5 C#6 F#6', 'A#3+C#4+F#4'],
  'Bsus4':    ['B3+E4+F#4+B4',         'B4+E5+F#5',   'B3 E4 F#4 B4 E5 F#5 B5 E6',         'E5 F#5 B5 E6',    'B3+E4+F#4'],
  'B':        ['B3+D#4+F#4+B4',        'B4+D#5+F#5',  'B3 D#4 F#4 B4 D#5 F#5 B5 D#6',      'D#5 F#5 B5 D#6',  'B3+D#4+F#4'],
};
const PAD = 0, CHOIR = 1, HARP = 2, SPARK = 3, STR = 4;

const BAR = 16;
// [symbol, startStep, lenSteps]; merge = join repeated bars into one long chord
function flat(harm, merge = false) {
  const out = [];
  harm.split(' ').forEach((sym, b) => {
    const p = out[out.length - 1];
    if (merge && p && p[0] === sym) p[2] += BAR; else out.push([sym, b * BAR, BAR]);
  });
  return out;
}
// sustained chord events from a table column
const held = (harm, col, vel = 0.66, oct = 0) => flat(harm, true).map(([c, s, l]) => [s, CH[c][col].split('+').map((n) => n.replace(/\d/, (d) => +d + oct)).join('+'), l, vel]);
// bass root (the slash bass when there is one) in the window [lo, lo + 11]
function bassRoot(sym, lo = 37) {
  const c = chordInfo(sym);
  const pc = c.bass != null ? c.bass : c.root;
  return lo + ((pc - (lo % 12) + 12) % 12);
}
// half time: a long root, a pickup octave before the change
function htBass(harm, vel = 0.8) {
  return flat(harm, true).flatMap(([c, s, l]) => {
    const r = bassRoot(c);
    return [[s, r, l - 4, vel], [s + l - 3, r + 12, 2, vel * 0.7]];
  });
}
// double time: rolling reese — root on the one, syncopated re-strikes, an octave flick
const ROLL = [[0, 0, 6, 1], [6, 0, 4, 0.8], [10, 0, 4, 0.85], [14, 12, 2, 0.7]];
function rollBass(harm, vel = 0.85) {
  return flat(harm).flatMap(([c, s]) => ROLL.map(([o, oc, l, v]) => [s + o, bassRoot(c, 30) + oc, l, v * vel]));
}
// arpeggios from the table pools, one pool per bar; `continue` lets a two-bar figure flow
// straight through the chord changes
const pools = (harm, col) => flat(harm).map(([c]) => CH[c][col].split(' ').map(midi));
const harpArp = (harm, opt = {}) => arp(pools(harm, HARP), { rate: opt.rate ?? 2, len: 16, continue: true,
  order: opt.order ?? [0, 2, 4, 6, 7, 5, 3, 1, 2, 4, 6, 7, 6, 4, 3, 1], vel: opt.vel ?? 0.6, accent: 0.12 });
const sparkle = (harm) => arp(pools(harm, SPARK), { rate: 1, len: 16, continue: true, order: [0, 2, 1, 3, 2, 0, 3, 1], vel: 0.34, accent: 0.1 });

// ── melodies (16th-step tokens at 172 BPM: *4 = an 8th of the 86 feel, *16 = a half) ────
// THE VEIL: 5–1–9 question, falling answer onto the dorian A#; the question on E; …; the #11
// (D#) sung over the Amaj7#11 before the sus4 cadence.
const VEIL = 'G#4*12 C#5*4 D#5*16 | E5*6 D#5*2 C#5*8 A#4*16 | B4*12 E5*4 F#5*16 | G#5*8 F#5*4 E5*4 D#5*16 |' +
  ' G#4*12 C#5*4 D#5*8 G#5*8 | F#5*12 E5*4 C#5*16 | D#5*12 C#5*4 G#4*16 | F#5*8 D#5*8 C#5*16';
// THE AWE: three rising arpeggios, each reaching higher; the lydian A# crowns the first.
const AWE = 'B4*8 E5*8 G#5*16 | A#5*12 G#5*4 F#5*16 | D#5*8 F#5*8 B5*16 | G#5*12 F#5*4 D#5*16 |' +
  ' C#5*8 E5*8 G#5*16 | F#5*8 E5*8 D#5*16 | E5*8 G#5*8 C#6*16 | C#6*8 F#5*8 G#5*16';
// glass doubles the long notes of a line an octave up
const longNotes = (line, min = 16, vel = 0.6) => {
  const ev = [];
  let s = 0;
  for (const t of line.split(/\s+/).filter((x) => x && x !== '|')) {
    const [n, r] = t.split('*'), l = +r || 1;
    if (l >= min) { const m = n.match(/^([A-G][#b]?)(\d)$/); ev.push([s, m[1] + (+m[2] + 1), l, vel]); }
    s += l;
  }
  return ev;
};

export default {
  title: 'Veil Nebula',
  bpm: 172,
  key: 'C#', scale: 'dorian',
  gain: 0.8,
  reverb: 1.15,
  delay: { beats: 1.5, feedback: 0.42, lp: 4200, hp: 500 },
  duck: { release: 0.3 },
  seed: 31,

  instruments: {
    vKick: { base: 'kick', f0: 170, f1: 47, pdecay: 0.04, decay: 0.5, click: 0.35, drive: 0.3 },
    vReese: { base: 'reese', detune: 12, cutoff: 620, q: 1, sub: 0.35, drive: 0.3, range: [25, 47] },
    // theremin-like: two soft triangles, wide slow vibrato, long glide
    vLead: { type: 'lead', wave: 'tri', voices: 2, detune: 5, cutoff: 3600, q: 0, env: 0.3, vib: 24, vibRate: 5.1, vibDelay: 0.32, glide: 0.14, a: 0.05, d: 0.5, s: 0.88, r: 0.55, vol: 0.62 },
    vLead2: { type: 'lead', wave: 'saw', voices: 2, detune: 9, cutoff: 1500, q: 1, env: 0.8, fd: 0.6, vib: 18, vibRate: 5.1, vibDelay: 0.35, glide: 0.12, a: 0.04, r: 0.5, vol: 0.5 },
    vBell: { base: 'bell', decay: 3.2, index: 2 },   // same render as the title's bell (shared samples)
  },

  channels: {
    kick: { inst: 'vKick', gain: 0.4, sidechain: true, layer: { min: 0.15 } },
    snare: { gain: 0.62, reverb: 0.4, layer: { min: 0.15 } },
    hat: { gain: 0.48, pan: 0.24, human: { t: 0.003, v: 0.14 }, layer: { min: 0.15 } },
    shaker: { gain: 0.32, pan: -0.3, human: { t: 0.004, v: 0.2 }, layer: { min: 0.15 } },
    rim: { gain: 0.22, pan: 0.3, reverb: 0.35, delay: 0.3 },
    ride: { gain: 0.2, pan: -0.25, reverb: 0.2, layer: { min: 0.7 } },
    ride2: { inst: 'ride', gain: 0.22, pan: -0.25, reverb: 0.2 },
    crash: { gain: 0.34, reverb: 0.3, pan: 0.2 },
    tom: { gain: 0.3, reverb: 0.3 },
    rev: { inst: 'revcym', gain: 0.4, reverb: 0.3 },
    riser: { gain: 0.34, reverb: 0.45 },
    down: { inst: 'downlifter', gain: 0.32, reverb: 0.4 },
    impact: { gain: 0.4, reverb: 0.4 },
    bass: { inst: 'bassSoft', gain: 0.62, duck: 0.35 },
    reese: { inst: 'vReese', gain: 0.4, duck: 0.45, lpf: 1600 },
    pad: { inst: 'padGlass', gain: 0.26, duck: 0.35, reverb: 0.4, lpf: 20000 },
    choir: { inst: 'choirOo', gain: 0.5, reverb: 0.55, duck: 0.2 },
    strings: { gain: 0.3, reverb: 0.45, duck: 0.2, pan: -0.14 },
    harp: { gain: 0.66, reverb: 0.35, delay: 0.36, pan: 0.2, duck: 0.2, lpf: 20000 },
    glass: { gain: 0.6, reverb: 0.5, delay: 0.32, pan: -0.18 },
    sparkle: { inst: 'glass', gain: 0.22, reverb: 0.45, delay: 0.3, pan: 0.3, layer: { min: 0.75 } },
    bell: { inst: 'vBell', gain: 0.78, reverb: 0.55, delay: 0.3, pan: 0.12 },
    lead: { inst: 'vLead', gain: 0.7, reverb: 0.38, delay: 0.26 },
    lead2: { inst: 'vLead2', gain: 0.34, reverb: 0.3, delay: 0.2, pan: -0.08, layer: { min: 0.8 } },
  },

  patterns: {
    // ── drums: half time (snare on 3 = the 86 backbeat) ──
    ht: {
      kick: 'X.........x.....|X.....x...x.....',
      snare: '........X.......|........X.....g.',
      hat: '..x...x...x...x.|..x...x...x.x.x.',
      shaker: 'gogogogogogogogo|gogogogogogogogo',
    },
    htFill: {
      kick: 'X.........x.....|X.....x.........',
      snare: '........X.......|........X..g.gxX',
      hat: '..x...x...x...x.|..x...x.........',
      shaker: 'gogogogogogogogo|gogogogo........',
      tom: '.*16 . . . . . . . . . . . . C#3 G#2 E2 .',
    },
    htRim: { rim: '.............x..|.....x..........' },
    rideHT: { ride: 'x...x...x...x...' },
    rideB: { ride2: 'x.o.x.o.x.o.x.o.' },
    // ── drums: two-step double time (snare on 2 and 4) ──
    dt: {
      kick: 'X.........X.....|X.........X..x..',
      snare: '....X..g....X...|....X..g.g..X..g',
      hat: 'x.x.x.x.x.x.x.x.|x.x.x.x.x.x.x.x.',
      shaker: '.g.g.g.g.g.g.g.g|.g.g.g.g.g.g.g.g',
    },
    dtFill: {
      kick: 'X.........X.....|X.........X.....',
      snare: '....X..g....X...|....X..gX.XgXXrR',
      hat: 'x.x.x.x.x.x.x.x.|x.x.x.x.........',
      tom: '.*24 G#3 . E3 . C#3 G#2 . .',
    },
    crash1: { crash: 'X' },

    // ── intro ──
    introPad: { len: 128, pad: held(INTRO_H, PAD, 0.6) },
    introChoir: { len: 128, choir: [[32, CH['C#m9'][CHOIR], 32, 0.48], [64, CH['Amaj7#11'][CHOIR], 32, 0.52], [96, CH['G#7sus4'][CHOIR], 32, 0.55]] },
    introBell: { len: 128, bell: [[0, 'G#5', 8, 0.6], [16, 'C#6', 8, 0.5], [32, 'D#6', 16, 0.55], [64, 'C#6', 8, 0.55], [80, 'D#6', 8, 0.5], [96, 'C#6', 16, 0.55], [112, 'F#5', 8, 0.45]] },
    introHarp: { len: 96, harp: harpArp(INTRO_H.split(' ').slice(2).join(' '), { vel: 0.5 }) },   // enters at bar 3
    introFx: { len: 128, rev: [[112, 'x', 16, 0.8]], bass: [[64, 'A2', 28, 0.6], [96, 'G#2', 28, 0.65]] },

    // ── A: the veil melody ──
    padA: { len: 256, pad: held(A_H, PAD, 0.64) },
    bassA: { len: 256, bass: htBass(A_H) },
    harpA: { len: 256, harp: harpArp(A_H) },
    veilA: { lead: VEIL, lead2: VEIL, glass: longNotes(VEIL, 16, 0.5) },
    sparkA: { len: 256, sparkle: sparkle(A_H) },

    // ── B: awe ──
    padB: { len: 256, pad: held(B_H, PAD, 0.66) },
    bassB: { len: 256, bass: htBass(B_H) },
    harpB: { len: 256, harp: harpArp(B_H, { order: [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 2, 3] }) },
    aweB: { bell: AWE, choir: { n: AWE, vel: 0.55 }, strings: held(B_H, STR, 0.5) },
    sparkB: { len: 256, sparkle: sparkle(B_H) },

    // ── break: the Lancers call on glass (C# dorian → E major) ──
    padBrk: { len: 128, pad: held(BRK_H, PAD, 0.6) },
    choirBrk: { len: 128, choir: held(BRK_H, CHOIR, 0.5) },
    harpBrk: { len: 128, harp: harpArp(BRK_H, { vel: 0.46 }) },
    callBrk: {
      len: 128,
      glass: [...themeEvents({ tonic: 'C#5', scale: 'dorian', part: 'call', pickup: true, aug: 2, start: 4, vel: 0.72 }),
        ...themeEvents({ tonic: 'E5', scale: 'lydian', part: 'call', pickup: true, aug: 2, start: 68, vel: 0.78 }).map((e) => (e[0] + e[2] > 96 ? [e[0], e[1], 96 - e[0], e[3]] : e))],
      strings: [[32, 'E4', 32, 0.5], [96, 'A#3+F#4', 32, 0.55]],
    },
    brkFx: { len: 128, down: [[0, 'x', 32, 0.6]], rev: [[112, 'x', 16, 0.8]], bass: [[0, 'C#2', 28, 0.6], [32, 'A1', 28, 0.6], [64, 'E2', 28, 0.6], [96, 'E2', 28, 0.62]] },

    // ── build ──
    padBuild: { len: 64, pad: held(BUILD_H, PAD, 0.7) },
    harpBuild: { len: 64, harp: harpArp(BUILD_H, { rate: 1, order: [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 2, 3], vel: 0.55 }) },
    buildBass: { len: 64, reese: [[0, 'A1', 14, 0.8], [16, 'A1', 14, 0.8], [32, 'B1', 14, 0.85], [48, 'B1', 16, 0.9]] },
    buildDrums: {
      len: 64, vel: 0.7,
      kick: 'X.......X.......|X.......X.......|X...X...X...X...|X.X.X.X.X.X.XXXX',
      snare: 'x.......x.......|x...x...x...x...|x.x.x.x.x.x.x.x.|xxxxxxxxxxxxrrRR',
      hat: 'x.x.x.x.x.x.x.x.|x.x.x.x.x.x.x.x.|xxxxxxxxxxxxxxxx|xxxxxxxxxxxx....',
    },
    buildFx: { len: 64, riser: [[0, 'x', 64, 0.85]], rev: [[40, 'x', 24, 0.9]], lead: [[60, 'D#4', 4, 0.7]] },

    // ── A2 / B2: double time ──
    reeseA: { len: 256, reese: rollBass(A_H) },
    reeseB: { len: 256, reese: rollBass(B_H) },
    veilA2: { lead: VEIL, lead2: VEIL, strings: { n: VEIL, vel: 0.5 }, glass: longNotes(VEIL, 8, 0.52) },
    choirA2: { len: 256, choir: held(A_H, CHOIR, 0.5) },
    aweB2: { lead: AWE, lead2: AWE, bell: AWE, choir: { n: AWE, vel: 0.58 }, strings: held(B_H, STR, 0.55) },
    impact1: { impact: 'X' },

    // ── outro ──
    padOut: { len: 64, pad: held(OUTRO_H, PAD, 0.6) },
    bassOut: { len: 64, bass: htBass(OUTRO_H) },
    harpOut: { len: 64, harp: harpArp(OUTRO_H, { vel: 0.5 }) },
    echoOut: { len: 64, glass: [[0, 'G#5', 12, 0.55], [12, 'C#6', 4, 0.5], [16, 'D#6', 16, 0.5], [32, 'G#5', 12, 0.45], [44, 'C#6', 4, 0.42], [48, 'D#6', 12, 0.4]], rev: [[48, 'x', 16, 0.6]] },
  },

  sections: {
    intro: {
      bars: 8, chords: INTRO_H,
      play: ['introPad', 'introChoir', 'introBell', { p: 'introHarp', at: 2 }, 'introFx'],
      auto: { 'pad.lpf': [[0, 500], [8, 6000]], 'harp.lpf': [[2, 900], [8, 9000]] },
    },
    A: {
      bars: 16, chords: A_H,
      play: ['padA', 'bassA', 'harpA', 'veilA', 'sparkA', ['crash1', null, null, null, null, null, null, null],
        ['ht', 'ht', 'ht', 'htFill', 'ht', 'ht', 'ht', 'htFill'], 'htRim', 'rideHT'],
    },
    B: {
      bars: 16, chords: B_H,
      play: ['padB', 'bassB', 'harpB', 'aweB', 'sparkB', ['crash1', null, null, null, null, null, null, null, 'crash1', null, null, null, null, null, null, null],
        ['ht', 'ht', 'ht', 'htFill', 'ht', 'ht', 'ht', 'htFill'], 'rideB'],
    },
    break: {
      bars: 8, chords: BRK_H,
      play: ['padBrk', 'choirBrk', 'harpBrk', 'callBrk', 'brkFx'],
      auto: { 'pad.lpf': [[0, 1200], [6, 2500], [8, 7000]], 'harp.lpf': [[0, 1500], [8, 6000]] },
    },
    build: {
      bars: 4, chords: BUILD_H,
      play: ['padBuild', 'harpBuild', 'buildBass', 'buildDrums', 'buildFx'],
      auto: { 'harp.lpf': [[0, 1500], [4, 12000]], 'reese.lpf': [[0, 400], [4, 1600]] },
    },
    A2: {
      bars: 16, chords: A_H,
      play: ['padA', 'reeseA', 'harpA', 'veilA2', 'choirA2', 'sparkA', 'impact1', ['crash1', null, null, null, 'crash1', null, null, null],
        ['dt', 'dt', 'dt', 'dtFill', 'dt', 'dt', 'dt', 'dtFill'], 'rideHT'],
    },
    B2: {
      bars: 16, chords: B_H,
      play: ['padB', 'reeseB', 'harpB', 'aweB2', 'sparkB', ['crash1', null, null, null, 'crash1', null, null, null],
        ['dt', 'dt', 'dt', 'dtFill', 'dt', 'dt', 'dt', 'dtFill'], 'rideB'],
    },
    outro: {
      bars: 4, chords: OUTRO_H,
      play: ['padOut', 'bassOut', 'harpOut', 'echoOut', ['ht', 'htFill']],
    },
  },

  arrangement: ['intro', 'A', 'B', 'break', 'build', 'A2', 'B2', 'outro'],
  loop: 'A',
};
