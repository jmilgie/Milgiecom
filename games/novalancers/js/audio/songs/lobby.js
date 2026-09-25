// Co-op lobby — "Hangar Lights". Relaxed lo-fi synthwave in C major, 90 BPM, lazy swing.
// Waiting for your wingmates: warm e-piano ninth chords, a round bass, dusty boom-bap and a
// sing-along hook on a soft triangle lead. The B section slips the LANCERS THEME in, laid back.
// Form (36 bars ≈ 96 s; loops from A, an 85 s cycle):
//   intro (4)  filtered e-piano ii–V–I–vi, rim + shaker, the bass slides in; filter opens
//   A (8)      the hook: "da-DA da-DAA da-da" over Dm9 G13 Cmaj9 Am9 | Dm9 G13 Em7 A7
//              (A7 = the secondary dominant that pulls back to Dm9)
//   A2 (8)     the hook again with a plucked arp, glass answers, and a new ending over
//              Fmaj9 Em7 Dm9 G13 that turns home to C with the theme's pickup
//   B (8)      the Lancers theme, reharmonized lo-fi (Cadd9 Fmaj9 Am7 G7sus4,G13 …), bell doubling
//              the second half; bass walks, the drums open up with ride-ish open hats
//   break (8)  kick drops out, e-piano through a closed filter, glass hums the hook's skeleton;
//              the lead returns with a variation and a snare fill brings the loop back to A
// Every chord is hand-voiced as one 6-note set (below); all parts take register slices of it,
// so the ninth / major-7th colours never rub (no minor 2nds/9ths between parts or the tune).

import { arp, chordInfo, midi } from '../music.js';
import { themeEvents } from './motifs.js';

// ── harmony ──────────────────────────────────────────────────────────────────────────
const INTRO_H = 'Dm9 G13 Cmaj9 Am9';
const A_H = 'Dm9 G13 Cmaj9 Am9 Dm9 G13 Em7 A7';
const A2_H = 'Dm9 G13 Cmaj9 Am9 Fmaj9 Em7 Dm9 G13';
const B_H = 'Cadd9 Fmaj9 Am7 G7sus4,G13 Cadd9 Fmaj9 Dm9,G13 Cadd9';
const BRK_H = A_H;

const V = {
  Dm9: 'D3 C4 F4 A4 C5 E5', G13: 'G2 F3 B3 E4 A4 D5', Cmaj9: 'C3 B3 D4 E4 G4 B4',
  Am9: 'A2 G3 C4 E4 G4 B4', Em7: 'E3 B3 D4 G4 B4 D5', A7: 'A2 G3 C#4 E4 G4 A4',
  Fmaj9: 'F2 C3 A3 E4 G4 C5', Cadd9: 'C3 G3 D4 E4 G4 C5', Am7: 'A2 E3 G3 C4 E4 A4',
  G7sus4: 'G2 F3 C4 D4 G4 C5',
};
const vset = (sym) => V[sym].split(' ').map(midi);

// 'C Am,G' → [chord symbols, [start, length] in steps]
function split(harm, bar = 16) {
  const f = [], at = [];
  harm.split(' ').forEach((b, i) => b.split(',').forEach((c, k, a) => { f.push(c); at.push([i * bar + (k * bar) / a.length, bar / a.length]); }));
  return [f, at];
}
// sustained register slice of each chord set
const part = (harm, lo, hi, vel) => { const [f, at] = split(harm); return f.map((c, i) => [at[i][0], vset(c).slice(lo, hi), at[i][1], vel]); };
// e-piano comp: "push" rhythm — hit, short ghost, then an anticipation on the and of 3
function comp(harm, vel = 0.62) {
  const [f, at] = split(harm), ev = [];
  f.forEach((c, i) => {
    const [s, len] = at[i], v = vset(c).slice(1, 5);
    ev.push([s, v, 5, vel], [s + 6, v, 1.5, vel * 0.62]);
    if (len >= 16) ev.push([s + 10, v, 5, vel * 0.82]);
  });
  return ev;
}
// plucked 8th-note arp through each chord's upper voices
function pluckArp(harm, vel = 0.5) {
  const [f, at] = split(harm), ev = [];
  f.forEach((c, i) => ev.push(...arp([vset(c).slice(2, 6)], { rate: 2, len: at[i][1], order: [0, 1, 2, 3, 2, 1, 3, 2], vel, accent: 0.1, start: at[i][0] })));
  return ev;
}
// bass root in F1..E2
const root = (sym) => 29 + ((chordInfo(sym).root - 5 + 12) % 12);
function bassFig(harm, fig) {
  const [f, at] = split(harm), ev = [];
  f.forEach((c, i) => {
    const [s0, len] = at[i], off = s0 % 16;
    for (const [st, iv, l, v] of fig) if (st >= off && st < off + len) ev.push([s0 - off + st, root(c) + iv, l, v]);
  });
  return ev;
}
// "DUM . . . . . dum . . . DUM . . . dum ." — root, octave ghost, fifth push, octave
const LAZY = [[0, 0, 5, 0.92], [6, 12, 1.5, 0.55], [10, 7, 3, 0.78], [14, 12, 1.5, 0.6]];
const WALK = [[0, 0, 3, 0.92], [4, 7, 2, 0.7], [6, 12, 1.5, 0.55], [8, 0, 3, 0.85], [12, 7, 2, 0.72], [14, 12, 1.5, 0.6]];

// ── melodies (8th-note tokens) ───────────────────────────────────────────────────────
const HOOK_Q = '. E5 . G5 A5 - G5 E5 | D5 - - - . B4 D5 E5 | . E5 . G5 B5 - A5 G5 | E5 - - - . C5 D5 . |';
const HOOK_A = HOOK_Q + ' . E5 . G5 A5 - G5 E5 | D5 - - B4 D5 - E5 F5 | G5 - - - . E5 G5 B5 | A5 - - G5 E5 - C#5 . ';
const HOOK_A2 = HOOK_Q + ' . E5 . G5 A5 - G5 E5 | G5 - - E5 - - D5 E5 | D6 - - C6 - - A5 . | B5 - - - A5 G5 . G4';
const BRK_LEAD = '. . . . . . . . | . . . . . . . . | . . . . . . . . | . . . . . . . . |' +
                 ' . A5 . C6 D6 - C6 A5 | B5 - - - . G5 A5 B5 | G5 - - E5 - - B4 D5 | E5 - - - C#5 - A4 .';
const THEME = themeEvents({ tonic: 'C5', vel: 0.8 });

export default {
  title: 'Hangar Lights',
  bpm: 90,
  swing: 0.2,
  key: 'C', scale: 'major',
  gain: 0.86,
  reverb: 0.9,
  delay: { beats: 0.75, feedback: 0.34, lp: 3000, hp: 400 },
  duck: { release: 0.28 },
  seed: 31,

  instruments: {
    lLead: { base: 'leadSoft', vib: 10, vibDelay: 0.25, glide: 0.05, r: 0.28 },
    lKeys: { base: 'keys', vol: 0.85 },
    lPad: { base: 'pad', cutoff: 2200, detune: 24, a: 0.5, r: 1.4, air: 0.02 },
  },

  channels: {
    kick: { gain: 0.6, sidechain: true, human: { t: 0.004, v: 0.08 } },
    snare: { gain: 0.42, reverb: 0.22, human: { t: 0.005, v: 0.1 } },
    clap: { gain: 0.16, reverb: 0.3, pan: 0.1 },
    rim: { gain: 0.26, pan: -0.18, reverb: 0.2, human: { t: 0.006, v: 0.15 } },
    hat: { gain: 0.2, pan: 0.24, choke: ['ohat'], human: { t: 0.006, v: 0.18 } },
    ohat: { gain: 0.15, pan: 0.28 },
    shaker: { gain: 0.16, pan: -0.3, human: { t: 0.006, v: 0.2 } },
    rev: { inst: 'revcym', gain: 0.26 },
    bass: { inst: 'bassSoft', gain: 0.82, duck: 0.3 },
    keys: { inst: 'lKeys', gain: 0.58, reverb: 0.3, delay: 0.08, pan: -0.08, lpf: 20000, human: { t: 0, v: 0.1 } },
    pad: { inst: 'lPad', gain: 0.16, duck: 0.4, reverb: 0.35, lpf: 1800, pan: 0.1 },
    pluck: { inst: 'pluckSoft', gain: 0.38, delay: 0.3, reverb: 0.2, pan: 0.3, duck: 0.3 },
    lead: { inst: 'lLead', gain: 0.62, reverb: 0.28, delay: 0.26, human: { t: 0, v: 0.08 } },
    glass: { gain: 0.24, reverb: 0.45, delay: 0.35, pan: 0.26 },
    bell: { gain: 0.3, reverb: 0.4, delay: 0.3, pan: -0.22 },
  },

  patterns: {
    // ── harmony beds ─────────────────────────────────────────────────────────────────
    introKeys: { len: 64, keys: comp(INTRO_H, 0.56), pad: part(INTRO_H, 1, 4, 0.5) },
    introBass: { len: 64, bass: [[32, 'C2', 5, 0.8], [38, 'C3', 1.5, 0.5], [42, 'G2', 3, 0.72], [46, 'C3', 1.5, 0.56], [48, 'A1', 5, 0.86], [54, 'A2', 1.5, 0.55], [58, 'E2', 3, 0.74], [62, 'C2', 2, 0.7]] },
    aBed: { len: 128, keys: comp(A_H), pad: part(A_H, 1, 4, 0.5), bass: bassFig(A_H, LAZY) },
    a2Bed: { len: 128, keys: comp(A2_H), pad: part(A2_H, 1, 4, 0.52), bass: bassFig(A2_H, LAZY), pluck: pluckArp(A2_H) },
    bBed: { len: 128, keys: comp(B_H, 0.6), pad: part(B_H, 1, 5, 0.55), bass: bassFig(B_H, WALK), pluck: pluckArp(B_H, 0.44) },
    brBed: { len: 128, keys: comp(BRK_H, 0.55), pad: part(BRK_H, 1, 4, 0.46), bass: bassFig(BRK_H, [[0, 0, 12, 0.8], [14, 12, 1.5, 0.5]]) },

    // ── tunes ────────────────────────────────────────────────────────────────────────
    hookA: { step: 2, len: 128, lead: HOOK_A, vel: 0.78 },
    hookA2: {
      len: 128,
      lead: { step: 2, n: HOOK_A2, vel: 0.8 },
      // glass answers in the hook's gaps (bars 2 and 4)
      glass: [[24, 'B5', 2, 0.5], [26, 'D6', 2, 0.5], [28, 'E6', 4, 0.55], [56, 'E6', 2, 0.5], [58, 'D6', 2, 0.48], [60, 'C6', 2, 0.46], [62, 'A5', 2, 0.44]],
    },
    themeB: { len: 128, lead: THEME, bell: THEME.filter((e) => e[0] >= 64).map(([s, n, l, v]) => [s, n + 12, l, v * 0.6]) },
    brTune: {
      len: 128,
      glass: [[2, 'E5', 2, 0.46], [6, 'G5', 2, 0.46], [8, 'A5', 8, 0.5], [16, 'D5', 8, 0.44], [26, 'D5', 2, 0.4], [28, 'E5', 4, 0.44],
        [34, 'E5', 2, 0.44], [38, 'G5', 2, 0.44], [40, 'B5', 8, 0.5], [48, 'E5', 12, 0.44]],
      lead: { step: 2, n: BRK_LEAD, vel: 0.7 },
    },

    // ── drums ────────────────────────────────────────────────────────────────────────
    dust: { rim: '....o.......o...', shaker: 'g.o.g.o.g.o.g.og' },
    dust2: { rim: '....o.......o..g', shaker: 'g.o.g.o.g.o.g.og', kick: 'o...............' },
    beat: { kick: 'X......x..X.....', snare: '....X.......X...', clap: '....o.......o...', hat: 'x.o.x.oxx.o.x.o.', shaker: 'g.g.g.g.g.g.g.g.', rim: '...............g' },
    beat2: { kick: 'X......x..X...x.', snare: '....X.......X...', clap: '....o.......o...', hat: 'x.o.x.oxx.o.x.og', shaker: 'g.g.g.g.g.g.g.g.' },
    beatFill: { kick: 'X......x..X.....', snare: '....X.......X.gx', clap: '....o.......o...', hat: 'x.o.x.oxx.o.....', rim: '..........g.g...' },
    beatB: { kick: 'X......x..X.....', snare: '....X.......X...', clap: '....o.......o...', hat: 'x.o.x.o.x.o.x.o.', ohat: '..o.......o.....', shaker: 'g.g.g.g.g.g.g.g.' },
    halfKick: { kick: 'X.........x.....', rim: '....o.......o...', hat: 'x...x...x...x...', shaker: 'g.o.g.o.g.o.g.og' },
    lastFill: { kick: 'X.........x.....', snare: '........g.o.xox.', hat: 'x...x...x.......', rev: [[0, 'x', 16, 0.6]] },
  },

  sections: {
    intro: {
      bars: 4, chords: INTRO_H,
      play: ['introKeys', 'introBass', ['dust', 'dust', 'dust', 'dust2']],
      auto: { 'keys.lpf': [[0, 700], [3, 1800], [4, 8000]], 'pad.lpf': [[0, 600], [4, 1800]] },
    },
    A: {
      bars: 8, chords: A_H,
      play: ['aBed', 'hookA', ['beat', 'beat', 'beat', 'beat2', 'beat', 'beat', 'beat', 'beatFill']],
    },
    A2: {
      bars: 8, chords: A2_H,
      play: ['a2Bed', 'hookA2', ['beat', 'beat2', 'beat', 'beat2', 'beat', 'beat2', 'beat', 'beatFill']],
    },
    B: {
      bars: 8, chords: B_H,
      play: ['bBed', 'themeB', ['beatB', 'beatB', 'beatB', 'beat2', 'beatB', 'beatB', 'beatB', 'beatFill']],
      auto: { 'pad.lpf': [[0, 1800], [8, 2600]] },
    },
    break: {
      bars: 8, chords: BRK_H,
      play: ['brBed', 'brTune', ['dust', 'dust', 'dust', 'dust2', 'halfKick', 'halfKick', 'halfKick', 'lastFill']],
      auto: { 'keys.lpf': [[0, 900], [4, 1200], [7, 2400], [8, 9000]], 'pad.lpf': [[0, 900], [8, 1800]] },
    },
  },

  arrangement: ['intro', 'A', 'A2', 'B', 'break'],
  loop: 'A',
};
