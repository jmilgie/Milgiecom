// "Dawn After" — ending + credits. Triumphant, then tender. D major, 96 BPM.
// The fullest statement of the Lancers theme: the whole 8-bar tune, its B phrase, a lift into E
// major for the climax (with choir singing the theme and the bVI–bVII–I cadence), then a new
// farewell melody and the theme once more, quietly, on solo strings.
// Form (49 bars ≈ 122 s; loops from ANTHEM, a 112 s cycle):
//   dawn (4)       sunrise swell → brass fanfare: the "call" on D, then echoed on Bb and C
//                  (I – bVI – bVII: the victory cadence stretched out as an introduction)
//   anthem (8)     THE LANCERS THEME, full band: lead + horn chords + string counter-line
//   bridge (8)     the B phrase sung by strings and choir over a half-time heartbeat, then the
//                  call climbs by step (Em7 F#m7 G A) while the drums build
//   lift (1)       C – D: bVI – bVII of E, brass stabs, the key change
//   anthem2 (8)    climax in E: lead + strings unison, brass and choir an octave below, four on
//                  the floor, ends with the bVI–bVII–I cadence rising in thirds to G#6
//   afterglow (2)  the E chord rings out, bells and harp cascade down
//   tender (16)    back in D, softly: a new farewell melody on electric piano over harp (8 bars),
//                  then the theme reharmonized (Gadd9 Em9 …) on solo strings, ending on vi
//   rise (2)       Bb – C: the dawn's fanfare again, snare roll → loops to the anthem
// No intensity layers: the credits should sound the same whatever the last boss fight set.

import { arp, voiceLead, chordInfo, midi } from '../music.js';
import { themeEvents, themeChords, themeHarmony, shift } from './motifs.js';

// ── harmony ──────────────────────────────────────────────────────────────────────────
const DAWN_H = 'Dsus2 D Bb C';
const THEME_H = themeHarmony('D');                                  // 'D G Bm7 Asus4,A D G Em7,A D'
const BRIDGE_H = 'Bm7 G D A Em7 F#m7 G A';
const LIFT_H = 'C,D';
const ANTHEM2_H = 'D G Bm7 Asus4,A D G Bb,C D';                     // played +2 → E major
const GLOW_H = 'D D';                                                // +2 → E
const TENDER_H = 'Gmaj7 Dadd9/F# Em7 Asus4,A Bm7 Gadd9 Em7,A7 D ' + // farewell melody
                 'Gadd9 Em9 Bm7 Gmaj7,Asus4 D/F# Gmaj7 Em7,A Bm7';    // the theme, reharmonized
const RISE_H = 'Bb C';

// ── helpers ──────────────────────────────────────────────────────────────────────────
// 'C Am,G' → [['C','Am','G'], [[0,16],[16,8],[24,8]]] (chord symbols + [start, length] in steps)
function split(harm, bar = 16) {
  const f = [], at = [];
  harm.split(' ').forEach((b, i) => b.split(',').forEach((c, k, a) => { f.push(c); at.push([i * bar + (k * bar) / a.length, bar / a.length]); }));
  return [f, at];
}
// voice-led chord events; opt = voiceLead options + { vel, legato, start }
function chordEvents(harm, opt) {
  const [f, at] = split(harm);
  return voiceLead(f, opt).map((n, i) => [(opt.start ?? 0) + at[i][0], n, at[i][1] * (opt.legato ?? 1), opt.vel ?? 0.7]);
}
// two voicings per bar (a one-chord bar is repeated) → arp({ len: 8, continue: true })
function halfList(harm, opt) {
  const f = [];
  harm.split(' ').forEach((b) => { const c = b.split(','); f.push(c[0], c[c.length - 1]); });
  return voiceLead(f, opt);
}
const cut = (evs, from, to) => evs.filter((e) => e[0] >= from && e[0] < to);
const at = (evs, steps) => evs.map(([s, ...r]) => [s + steps, ...r]);          // time shift only
const octave = (evs, semis) => evs.map(([s, n, ...r]) => [s, midi(n) + semis, ...r]);   // single notes
// bass root (slash bass if given) placed in G1..F#2
const root = (sym) => { const c = chordInfo(sym); return 31 + (((c.bass ?? c.root) - 7 + 12) % 12); };
// apply a one-bar bass figure [[step, semis above root, len, vel], …] to every chord span
function bassFig(harm, fig, start = 0) {
  const [f, spans] = split(harm);
  const ev = [];
  f.forEach((c, i) => {
    const [s0, len] = spans[i], off = s0 % 16;
    for (const [st, iv, l, v] of fig) if (st >= off && st < off + len) ev.push([start + s0 - off + st, root(c) + iv, l, v]);
  });
  return ev;
}
// one sustained root per chord span
const roots = (harm, vel = 0.7, start = 0) => { const [f, spans] = split(harm); return f.map((c, i) => [start + spans[i][0], root(c), spans[i][1], vel]); };
const DRIVE = [];      // anthem: rock 8ths with a pushed octave ("dum . dum DUM dum . dum DUM")
for (let h = 0; h < 2; h++) DRIVE.push([h * 8, 0, 3, 0.95], [h * 8 + 3, 0, 1, 0.6], [h * 8 + 4, 12, 2, 0.8], [h * 8 + 6, 0, 2, 0.78]);
const GALLOP = [];     // climax: 16th gallop
for (let b = 0; b < 4; b++) GALLOP.push([b * 4, 0, 0.9, 0.95], [b * 4 + 1, 0, 0.9, 0.66], [b * 4 + 2, 12, 0.9, 0.82], [b * 4 + 3, 0, 0.9, 0.66]);
const EIGHTHS = [];
for (let b = 0; b < 8; b++) EIGHTHS.push([b * 2, b % 2 ? 12 : 0, 1.8, b % 2 ? 0.72 : 0.9]);
// 16th-note roll with a velocity ramp: roll(from, to, v0, v1)
const roll = (s0, s1, v0, v1) => { const e = []; for (let s = s0; s < s1; s++) e.push([s, 'x', 1, v0 + ((v1 - v0) * (s - s0)) / Math.max(1, s1 - s0 - 1)]); return e; };
const oneOf = (sym, opt) => voiceLead([sym], opt)[0];

// Tender section: hand-voiced. One 6-note set per chord (low → high, no minor 2nds/9ths inside),
// every part takes a register slice of it, so pad, strings, choir and piano never rub against
// each other or against the melody's long notes (maj7 / 9th colours stay clean).
const TV = {
  Gmaj7: 'G3 B3 D4 F#4 B4 D5', 'Dadd9/F#': 'F#3 A3 D4 E4 A4 D5', Em7: 'E3 G3 B3 D4 G4 B4',
  Asus4: 'A3 D4 E4 A4 D5 E5', A: 'A3 C#4 E4 A4 C#5 E5', Bm7: 'B3 D4 F#4 A4 B4 D5',
  Gadd9: 'G3 B3 D4 A4 B4 D5', A7: 'A3 C#4 E4 G4 A4 C#5', D: 'D3 F#3 A3 D4 F#4 A4',
  Em9: 'E3 G3 B3 D4 F#4 B4', 'D/F#': 'F#3 A3 D4 F#4 A4 D5',
};
const tset = (sym) => TV[sym].split(' ').map(midi);
const tPart = (harm, lo, hi, vel, from = 0) => { const [f, sp] = split(harm); return f.map((c, i) => [sp[i][0], tset(c).slice(lo, hi), sp[i][1], vel]).filter((e) => e[0] >= from); };
// harp: 8ths up and down the lower five notes of each set, the pattern flowing across chord changes
function tHarp(harm) {
  const [f, sp] = split(harm), ORDER = [0, 1, 2, 3, 4, 3, 2, 1], ev = [];
  let k = 0;
  f.forEach((c, i) => { const pool = tset(c); for (let s = 0; s < sp[i][1]; s += 2, k++) ev.push([sp[i][0] + s, pool[ORDER[k % 8]], 1.8, s === 0 ? 0.72 : 0.62]); });
  return ev;
}
// piano comp for the theme reprise: the farewell rhythm (q. e h) on every chord
function tComp(harm, start) {
  const [f, sp] = split(harm), ev = [];
  f.forEach((c, i) => {
    const s = start + sp[i][0], v = tset(c).slice(2, 5);
    ev.push([s, v, 6, 0.62], [s + 6, v, 2, 0.46]);
    if (sp[i][1] >= 16) ev.push([s + 8, v, 8, 0.55]);
  });
  return ev;
}

// ── melodies ─────────────────────────────────────────────────────────────────────────
const THEME = themeEvents({ tonic: 'D5', vel: 0.86 });                              // 8 bars
const CLIMAX = cut(themeEvents({ tonic: 'D5', vel: 0.92 }), 0, 96)
  .concat(themeEvents({ tonic: 'D5', part: 'cadence', start: 96, vel: 0.97 }));    // → bVI bVII I
// farewell melody (e-piano): "q. e h" sighs that rise and fall, ending on the 3rd
const FAREWELL = 'B4*6 D5*2 F#5*8 | E5*6 D5*2 A4*8 | G4*6 B4*2 E5*8 | D5*8 C#5*8 | ' +
                 'B4*6 D5*2 A5*8 | G5*6 F#5*2 D5*8 | E5*6 G5*2 A5*4 G5*4 | F#5*16';
// string counter-line under the first statement (contrary motion to the call)
const COUNTER = 'A4*12 F#4*4 | G4*8 B4*8 | F#4*8 A4*8 | D5*8 C#5*8 | D5*12 A4*4 | B4*8 D5*8 | E5*8 C#5*8 | D5*16';
// the call climbing by step (bridge, bars 5–8)
const CLIMB = [[0, 'E5', 6], [6, 'B5', 10], [16, 'F#5', 6], [22, 'C#6', 10], [32, 'G5', 6], [38, 'D6', 10],
  [48, 'A5', 2], [50, 'B5', 2], [52, 'C#6', 2], [54, 'D6', 2], [56, 'E6', 8]].map(([s, n, l]) => [s, n, l, 0.86]);

export default {
  title: 'Dawn After',
  bpm: 96,
  key: 'D', scale: 'major',
  gain: 0.77,
  reverb: 1.05,
  delay: { beats: 0.75, feedback: 0.38, lp: 3600, hp: 350 },
  duck: { release: 0.26 },
  seed: 23,

  // vBass / vPad / vArp / vBell use exactly the title's render parameters, so after the title has
  // played they cost no extra memory or render time (only play-time params differ).
  instruments: {
    vBass: { base: 'bass', cutoff: 420, env: 2.2, q: 2, drive: 0.3 },
    vPad: { base: 'pad', cutoff: 3000, detune: 26, a: 0.6, r: 1.6, air: 0.03 },
    vArp: { base: 'pluck', cutoff: 800, env: 3.2, decay: 0.22, amp: 0.7 },
    vBell: { base: 'bell', decay: 3.2, index: 2, vol: 0.4 },
    vLead: { base: 'leadBright', cutoff: 3800, vib: 18, vibDelay: 0.3, glide: 0.06, r: 0.3 },
    vStr: { base: 'strings', a: 0.1, d: 0.4, s: 0.92, r: 0.7 },          // melodic strings (faster bow)
    vVoice: { base: 'choir', a: 0.1, d: 0.4, s: 0.9, r: 0.7 },           // choir singing a line
    vKeys: { base: 'keys', vol: 0.9 },
  },

  channels: {
    kick: { gain: 0.55, sidechain: true },
    snare: { inst: 'snareBig', gain: 0.52, reverb: 0.3 },
    clap: { gain: 0.28, reverb: 0.25, pan: 0.1 },
    hat: { gain: 0.26, pan: 0.22, choke: ['ohat'], human: { t: 0.003, v: 0.12 } },
    ohat: { gain: 0.22, pan: 0.26 },
    crash: { gain: 0.4, reverb: 0.15, pan: -0.15 },
    tom: { gain: 0.34, reverb: 0.2 },
    taiko: { gain: 0.42, reverb: 0.24 },
    rev: { inst: 'revcym', gain: 0.4 },
    riser: { gain: 0.38, reverb: 0.3 },
    down: { inst: 'downlifter', gain: 0.34, reverb: 0.4 },
    impact: { gain: 0.42, reverb: 0.25 },
    bass: { inst: 'vBass', gain: 0.72, duck: 0.4 },
    drone: { inst: 'bassSoft', gain: 0.46, duck: 0.2 },
    pad: { inst: 'vPad', gain: 0.25, duck: 0.45, reverb: 0.32, lpf: 20000 },
    strings: { gain: 0.24, duck: 0.25, reverb: 0.4, pan: -0.14 },
    counter: { inst: 'vStr', gain: 0.46, reverb: 0.42, pan: 0.16 },
    choir: { gain: 0.2, reverb: 0.5, duck: 0.2 },
    oo: { inst: 'choirOo', gain: 0.2, reverb: 0.55 },
    voice: { inst: 'vVoice', gain: 0.3, reverb: 0.5, pan: -0.08 },
    brass: { gain: 0.44, reverb: 0.3 },
    horn: { inst: 'brass', gain: 0.32, reverb: 0.45, lpf: 1500, pan: -0.2 },
    arp: { inst: 'vArp', gain: 0.32, delay: 0.3, reverb: 0.18, pan: -0.22, duck: 0.35, lpf: 20000 },
    harp: { gain: 0.34, reverb: 0.42, delay: 0.18, pan: 0.24 },
    bell: { inst: 'vBell', gain: 0.32, reverb: 0.5, delay: 0.28, pan: 0.1 },
    glass: { gain: 0.26, reverb: 0.5, delay: 0.3, pan: 0.28 },
    keys: { inst: 'vKeys', gain: 0.9, reverb: 0.42, delay: 0.14, pan: -0.06 },        // tender melody
    keysC: { inst: 'vKeys', gain: 0.42, reverb: 0.4, pan: 0.12 },                     // tender comp
    lead: { inst: 'vLead', gain: 0.66, reverb: 0.26, delay: 0.24 },
  },

  patterns: {
    // ── DAWN ──────────────────────────────────────────────────────────────────────────
    dawnPad: { len: 64, pad: chordEvents(DAWN_H, { low: 'E3', high: 'C#5', voices: 4, vel: 0.72 }) },
    dawnStr: { len: 64, strings: chordEvents(DAWN_H, { low: 'A3', high: 'A5', voices: 4, vel: 0.62 }) },
    dawnChoir: { len: 64, choir: chordEvents('D Bb C', { low: 'D4', high: 'B4', voices: 3, vel: 0.6, start: 16 }) },
    dawnLow: {
      len: 64,
      drone: [[0, 'D2', 16, 0.8]],
      bass: [[16, 'D2', 16, 0.85], [32, 'Bb1', 16, 0.85], [48, 'C2', 8, 0.85], [56, 'C2', 2, 0.7], [58, 'C3', 2, 0.72], [60, 'C2', 2, 0.76], [62, 'C3', 2, 0.8]],
    },
    // the call in octaves: on D, echoed on Bb and C
    dawnBrass: {
      len: 64,
      brass: [[14, 'A3+A4', 2, 0.72], [16, 'D4+D5', 6, 0.92], [22, 'A4+A5', 10, 0.86], [32, 'Bb3+Bb4', 6, 0.9], [38, 'F4+F5', 10, 0.84],
        [48, 'C4+C5', 6, 0.92], [54, 'G4+G5', 8, 0.88]],
      bell: [[16, 'D6', 6, 0.5], [22, 'A6', 10, 0.46], [38, 'F6', 10, 0.42], [54, 'G6', 8, 0.42]],
      lead: [[62, 'A4', 2, 0.8]],
    },
    // sunrise glissando into the fanfare, then glittering 8ths
    dawnHarp: {
      len: 64,
      harp: ['A3', 'D4', 'E4', 'A4', 'D5', 'E5', 'A5', 'D6', 'E6', 'A6'].map((n, i) => [6 + i, n, 1, 0.34 + i * 0.04])
        .concat(at(arp(halfList('D Bb C', { low: 'A4', high: 'A5', voices: 3 }), { rate: 2, len: 8, continue: true, order: [0, 1, 2, 1], vel: 0.42, accent: 0.1 }), 16)),
    },
    dawnDrums: {
      len: 64,
      taiko: '....g...o...x.x. X.......X....... X.......X...x.x. X.......X.x.xxXX',
      kick: [[16, 'x', 1, 1], [32, 'x', 1, 0.9], [48, 'x', 1, 0.9], [56, 'x', 1, 0.8], [60, 'x', 1, 0.85]],
      snare: roll(52, 64, 0.3, 0.9),
      crash: [[16, 'x', 1, 1]],
      impact: [[16, 'x', 1, 0.85]],
      rev: [[8, 'x', 8, 0.7], [48, 'x', 16, 0.8]],
      riser: [[32, 'x', 32, 0.7]],
    },

    // ── ANTHEM (first statement) ─────────────────────────────────────────────────────
    anLead: { len: 128, lead: THEME },
    anBrass: { len: 128, brass: chordEvents(THEME_H, { low: 'D3', high: 'A4', voices: 3, vel: 0.5, legato: 0.95 }) },
    anCounter: { counter: COUNTER, vel: 0.6 },
    anPad: { len: 128, pad: themeChords('D', { low: 'E3', high: 'C#5', vel: 0.72 }) },
    anChoir: { len: 128, choir: cut(themeChords('D', { low: 'D4', high: 'B4', voices: 3, vel: 0.58 }), 64, 128) },
    anBass: { len: 128, bass: bassFig(THEME_H, DRIVE) },
    anArp: { len: 128, arp: arp(halfList(THEME_H, { low: 'A3', high: 'A4', voices: 3 }), { rate: 1, len: 8, continue: true, oct: 2, order: [0, 2, 4, 1, 3, 5, 2, 4], vel: 0.58, accent: 0.16 }) },
    anBell: { len: 128, bell: [[0, 'D6', 6, 0.58], [6, 'A6', 10, 0.52], [64, 'D6', 6, 0.58], [70, 'A6', 10, 0.52]] },
    groove: { kick: 'X......xX.x.....', snare: '....X.......X...', clap: '....x.......x...', hat: 'xgxgxgxgxgxgxg.g', ohat: '..............x.', taiko: 'o...............' },
    fill1: { kick: 'X......xX.x.....', snare: '....X.......X...', clap: '....x.......x...', hat: 'xgxgxgxgxgxg....', taiko: 'o...............', tom: '.*12 D3 B2 G2 E2' },
    fill2: {
      kick: 'X......xX.......', clap: '....x...........', hat: 'xgxgxgxg........', taiko: 'o...............',
      snare: '. . . . X . . . x@0.5 . x@0.6 . X x@0.7 x@0.8 x@0.9', tom: '.*8 D3 . B2 . G2 G2 E2 E2',
    },
    crashBar: { crash: 'X' },

    // ── BRIDGE ───────────────────────────────────────────────────────────────────────
    brPad: { len: 128, pad: chordEvents(BRIDGE_H, { low: 'E3', high: 'C#5', voices: 4, vel: 0.66 }) },
    brSing: { len: 64, counter: themeEvents({ tonic: 'D5', part: 'b', vel: 0.78 }), voice: themeEvents({ tonic: 'D4', part: 'b', vel: 0.72 }) },
    brHarp: { len: 64, harp: arp(halfList('Bm7 G D A', { low: 'B3', high: 'B4', voices: 4 }), { rate: 2, len: 8, continue: true, oct: 2, order: [0, 2, 4, 6, 7, 5, 3, 1], vel: 0.52 }) },
    brLow: {
      len: 128,
      bass: [[0, 'B1', 12, 0.85], [12, 'B1', 2, 0.6], [14, 'B2', 2, 0.66], [16, 'G1', 12, 0.85], [28, 'G1', 2, 0.6], [30, 'G2', 2, 0.66],
        [32, 'D2', 12, 0.85], [44, 'D2', 2, 0.6], [46, 'D3', 2, 0.66], [48, 'A1', 12, 0.85], [60, 'A1', 2, 0.66], [62, 'A2', 2, 0.72]]
        .concat(bassFig('Em7 F#m7 G A', EIGHTHS, 64)),
    },
    brClimb: {
      len: 128,
      lead: at(CLIMB, 64),
      brass: at(octave(CLIMB, -12), 64).map(([s, n, l, v]) => [s, n, l, v * 0.85]),
      strings: at(chordEvents('Em7 F#m7 G A', { low: 'A3', high: 'A4', voices: 3, vel: 0.56 }), 64),
      choir: at(chordEvents('Em7 F#m7 G A', { low: 'D4', high: 'B4', voices: 3, rootless: true, vel: 0.55 }), 64),
      arp: at(arp(halfList('Em7 F#m7 G A', { low: 'A3', high: 'A4', voices: 3 }), { rate: 1, len: 8, continue: true, oct: 2, order: [0, 1, 2, 3, 4, 5, 4, 3], vel: 0.6 }), 64),
    },
    brFx: { len: 128, riser: [[96, 'x', 32, 0.75]], crash: [[64, 'x', 1, 0.85]] },
    half: { kick: 'X.........x.....', snare: '........X.......', hat: 'x.x.x.x.x.x.x.x.', taiko: 'X...............' },
    half2: { kick: 'X.........x.....', snare: '........X.....x.', hat: 'x.x.x.x.x.x.xxxx', taiko: 'X...............' },
    drive: { kick: 'X.....x.X.......', snare: '....X.......X...', clap: '....x.......x...', hat: 'xgxgxgxgxgxgxgxg', taiko: 'o.......o.......' },
    push: { kick: 'X.X.X.X.X.X.X.X.', snare: '....X.......X.X.', clap: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', taiko: 'X...X...X...X...' },
    buildRoll: {
      kick: 'X...X...X.X.XXXX',
      snare: roll(0, 8, 0.4, 0.75),
      tom: '.*8 D3 D3 B2 B2 G2 G2 E2 E2',
      taiko: 'X.......X.x.xxXX',
    },

    // ── LIFT (C – D → E) ─────────────────────────────────────────────────────────────
    lift: {
      brass: [[0, 'C4+E4+G4+C5', 6, 0.95], [6, 'C4+E4+G4+C5', 2, 0.8], [8, 'D4+F#4+A4+D5', 8, 0.97]],
      lead: [[0, 'E6', 8, 0.92], [8, 'F#6', 8, 0.96]],
      counter: [[0, 'E5', 8, 0.8], [8, 'F#5', 6, 0.84], [14, 'B4', 2, 0.8]],
      pad: chordEvents(LIFT_H, { low: 'E3', high: 'C#5', voices: 4, vel: 0.8 }),
      choir: chordEvents(LIFT_H, { low: 'D4', high: 'B4', voices: 3, vel: 0.66 }),
      strings: chordEvents(LIFT_H, { low: 'A3', high: 'A4', voices: 3, vel: 0.62 }),
      bass: [[0, 'C2', 6, 0.95], [6, 'C2', 2, 0.8], [8, 'D2', 6, 0.95], [14, 'D2', 2, 0.8]],
      kick: 'X.....X.X.....X.',
      snare: 'X.....X.X.......',
      taiko: 'X.....X.X...XxXX',
      tom: '.*12 D3 B2 G2 E2',
      crash: 'X...............',
      rev: [[0, 'x', 16, 0.8]],
    },

    // ── ANTHEM 2 (climax, played +2 = E major) ───────────────────────────────────────
    a2Tune: {
      len: 128,
      lead: CLIMAX,
      counter: CLIMAX.map(([s, n, l, v]) => [s, n, l, v * 0.72]),
      voice: shift(CLIMAX, 0, -12).map(([s, n, l, v]) => [s, n, l, v * 0.66]),
      brass: cut(themeEvents({ tonic: 'D4', vel: 0.78 }), 0, 96)
        .concat([[96, 'Bb3+D4+F4', 6, 0.92], [102, 'Bb3+D4+F4', 2, 0.8], [104, 'C4+E4+G4', 8, 0.96], [112, 'D4+F#4+A4+D5', 16, 1]]),
    },
    a2Pad: { len: 128, pad: chordEvents(ANTHEM2_H, { low: 'E3', high: 'C#5', voices: 4, vel: 0.76 }) },
    a2Str: { len: 128, strings: chordEvents(ANTHEM2_H, { low: 'A3', high: 'A4', voices: 3, vel: 0.58 }) },
    a2Bass: {
      len: 128,
      bass: bassFig('D G Bm7 Asus4,A D G', GALLOP)
        .concat([[96, 'Bb1', 6, 0.95], [102, 'Bb1', 2, 0.8], [104, 'C2', 8, 0.95], [112, 'D2', 16, 0.95]]),
    },
    a2Arp: { len: 128, arp: cut(arp(halfList(ANTHEM2_H, { low: 'A3', high: 'A4', voices: 3 }), { rate: 1, len: 8, continue: true, oct: 2, order: [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 2, 3, 4, 5, 4, 3], vel: 0.6, accent: 0.18 }), 0, 112) },
    a2Fx: {
      len: 128,
      impact: [[0, 'x', 1, 0.8]],
      crash: [[0, 'x', 1, 1], [64, 'x', 1, 0.9]],
      bell: [[112, 'A5+D6+F#6', 16, 0.5]],
      down: [[112, 'x', 16, 0.6]],
    },
    four: { kick: 'X...X...X...X...', snare: '....X.......X...', clap: '....x.......x...', hat: 'xgxgxgxgxgxgxg.g', ohat: '..x...x...x...x.', taiko: 'o...............' },
    fourFill: { kick: 'X...X...X...X...', snare: '....X.......X...', clap: '....x.......x...', hat: 'xgxgxgxgxgxg....', taiko: '........o.o.xxXX' },
    cadHits: { kick: 'X.....X.X.......', snare: 'X.....X.X...x.xx', taiko: 'X.....X.X...XXXX', crash: '........X.......' },
    finalHit: { kick: 'X...............', crash: 'X...............', taiko: 'X...............' },

    // ── AFTERGLOW (+2) ───────────────────────────────────────────────────────────────
    glow: {
      len: 32,
      pad: [[0, oneOf('D', { low: 'E3', high: 'C#5', voices: 4 }), 28, 0.7]],
      strings: [[0, 'D3+A3+F#4+D5', 26, 0.55]],
      choir: [[0, 'D4+F#4+A4', 22, 0.55]],
      drone: [[0, 'D2', 28, 0.7]],
      bell: [[0, 'D6', 4, 0.48], [4, 'A5', 4, 0.44], [8, 'F#5', 4, 0.4], [12, 'D5', 8, 0.38], [20, 'A5', 4, 0.3], [24, 'F#5', 8, 0.26]],
      harp: ['D6', 'A5', 'F#5', 'E5', 'D5', 'A4', 'F#4', 'E4', 'D4'].map((n, i) => [2 + i, n, 1, 0.5 - i * 0.025]),
    },

    // ── TENDER (back in D) ───────────────────────────────────────────────────────────
    tdMelody: { len: 256, keys: FAREWELL, vel: 0.72 },
    tdComp: { len: 256, keysC: tComp(TENDER_H.split(' ').slice(8).join(' '), 128) },
    tdHarp: { len: 256, harp: tHarp(TENDER_H) },
    tdBed: {
      len: 256,
      pad: tPart(TENDER_H, 0, 4, 0.45),
      strings: tPart(TENDER_H, 1, 4, 0.46),
      oo: tPart(TENDER_H, 3, 6, 0.5, 64),
      drone: roots(TENDER_H, 0.45),
    },
    tdTheme: {
      len: 256,
      counter: themeEvents({ tonic: 'D5', start: 128, vel: 0.74 }),
      horn: [[192, 'F#4', 16, 0.66], [208, 'B4', 8, 0.66], [216, 'D5', 8, 0.68], [224, 'B4', 8, 0.68], [232, 'A4', 8, 0.66], [240, 'F#4', 16, 0.66]],
      glass: [[56, 'A5', 2, 0.5], [58, 'C#6', 2, 0.5], [60, 'E6', 4, 0.5], [120, 'A5', 2, 0.5], [122, 'D6', 2, 0.5], [124, 'F#6', 4, 0.5]],
      taiko: [192, 200, 208, 216, 224, 232, 240, 248].map((s, i) => [s, 'x', 1, 0.3 + i * 0.03]),
    },

    // ── RISE (Bb – C → the anthem) ───────────────────────────────────────────────────
    rise: {
      len: 32,
      brass: [[0, 'Bb3+Bb4', 6, 0.86], [6, 'F4+F5', 10, 0.8], [16, 'C4+C5', 6, 0.9], [22, 'G4+G5', 8, 0.86]],
      strings: chordEvents(RISE_H, { low: 'A3', high: 'A5', voices: 4, vel: 0.62 }),
      pad: chordEvents(RISE_H, { low: 'E3', high: 'C#5', voices: 4, vel: 0.72 }),
      choir: chordEvents(RISE_H, { low: 'D4', high: 'B4', voices: 3, vel: 0.6 }),
      bass: [[0, 'Bb1', 16, 0.85], [16, 'C2', 8, 0.85], [24, 'C2', 2, 0.7], [26, 'C3', 2, 0.72], [28, 'C2', 2, 0.76], [30, 'C3', 2, 0.8]],
      harp: ['C4', 'E4', 'G4', 'C5', 'E5', 'G5', 'C6', 'E6'].map((n, i) => [24 + i, n, 1, 0.36 + i * 0.04]),
      lead: [[30, 'A4', 2, 0.82]],
      taiko: 'X.......X...x.x. X...X...X.x.xxXX',
      kick: [[0, 'x', 1, 0.9], [16, 'x', 1, 0.9], [24, 'x', 1, 0.8], [28, 'x', 1, 0.85]],
      snare: roll(20, 32, 0.28, 0.9),
      riser: [[0, 'x', 32, 0.75]],
      rev: [[16, 'x', 16, 0.8]],
    },
  },

  sections: {
    dawn: {
      bars: 4, chords: DAWN_H,
      play: ['dawnPad', 'dawnStr', 'dawnChoir', 'dawnLow', 'dawnBrass', 'dawnHarp', 'dawnDrums'],
      auto: { 'pad.lpf': [[0, 500], [1, 2600], [4, 9000]] },
    },
    anthem: {
      bars: 8, chords: THEME_H,
      play: ['anLead', 'anBrass', 'anCounter', 'anPad', 'anChoir', 'anBass', 'anArp', 'anBell',
        ['crashBar', null, null, null, 'crashBar', null, null, null],
        ['groove', 'groove', 'groove', 'fill1', 'groove', 'groove', 'groove', 'fill2']],
    },
    bridge: {
      bars: 8, chords: BRIDGE_H,
      play: ['brPad', { p: 'brSing', once: true }, { p: 'brHarp', until: 4 }, 'brLow', 'brClimb', 'brFx',
        ['half', 'half', 'half', 'half2', 'drive', 'drive', 'push', 'buildRoll']],
      auto: { 'pad.lpf': [[0, 1500], [4, 2600], [8, 9000]], 'arp.lpf': [[4, 900], [8, 9000]] },
    },
    lift: { bars: 1, chords: LIFT_H, play: ['lift'] },
    anthem2: {
      bars: 8, chords: ANTHEM2_H,
      play: ['a2Tune', 'a2Pad', 'a2Str', 'a2Bass', 'a2Arp', 'a2Fx',
        ['four', 'four', 'four', 'fourFill', 'four', 'four', 'cadHits', 'finalHit']],
    },
    afterglow: {
      bars: 2, chords: GLOW_H,
      play: ['glow'],
      auto: { 'pad.lpf': [[0, 6000], [2, 700]] },
    },
    tender: {
      bars: 16, chords: TENDER_H,
      play: ['tdMelody', 'tdComp', 'tdHarp', 'tdBed', 'tdTheme'],
      auto: { 'pad.lpf': [[0, 1100], [12, 1600], [16, 2400]] },
    },
    rise: {
      bars: 2, chords: RISE_H,
      play: ['rise'],
      auto: { 'pad.lpf': [[0, 1400], [2, 9000]] },
    },
  },

  arrangement: ['dawn', 'anthem', 'bridge', 'lift', { s: 'anthem2', tr: 2 }, { s: 'afterglow', tr: 2 }, 'tender', 'rise'],
  loop: 'anthem',
};
