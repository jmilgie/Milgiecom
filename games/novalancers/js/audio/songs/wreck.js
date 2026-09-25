// Sector 4 — "Leviathan Wreck". Tense, mechanical, cinematic: C minor, 124 BPM.
// Flying low over a dead dreadnought's hull. Everything grows out of one 16th-note machine
// ostinato accented 3+3+2 (bass octaves, rim clicks, low-brass stabs and taiko all lock to it).
// Form (62 bars ≈ 120 s; loops from A, a 112 s cycle):
//   intro (4)    hull groan: BRAAAM (low brass + choir + impact), sub drone, a Morse "SOS" beacon
//                from the wreck (· · · — — — · · ·), filtered ostinato wakes up, riser
//   A (8)        the machine: bass ostinato, taiko, 3+3+2 brass stabs, ticking clock   (i bVI iv V)
//   A2 (8)       + kick/snare, spiccato strings; cellos foreshadow the theme's "creep" motif
//                (down a 4th, up a semitone onto the chord change); servo arp; bII (Db) turn
//   B (8)        THE LEVIATHAN THEME on a saw lead over brass chords (i–bVI iv V i–bVI bII V)
//   B2 (8)       theme drops into low brass + cellos, a high descant answers it, choir, big taiko
//   break (8)    drums out: sub + reese, the SOS again, cellos sing the motif augmented; then the
//                build (taiko accelerando, snare roll, riser) lands on Ab7 = G#7 …
//   climax (8)   … the dominant of C# MINOR: the theme a semitone higher, lead + brass octaves,
//                four-on-the-floor, gallop bass, choir
//   climax2 (8)  bVI–bVII–i defiance (the Lancers' cadence, landing on minor), descant climbs to
//                the top; ends on G#
//   turn (2)     G# is re-heard as Ab (bVI of C minor) → G → back to A
// Intensity: ≥0.75 adds a second taiko section, ≥0.8 doubles the lead an octave down; <0.15 drops
// the kit (kick/snare/hats) and leaves the ostinato + taiko.

import { arp, voiceLead, chordInfo, transpose } from '../music.js';

// ── harmony ──────────────────────────────────────────────────────────────────────────
const INTRO_H = 'Cm Cm Db Gsus4,G';
const A_H = 'Cm Cm Ab Ab Fm Fm G G';
const A2_H = 'Cm Cm Ab Ab Fm Fm Db G';
const T_H = 'Cm,Ab Ab Fm G Cm,Ab Ab Db Gsus4,G';     // theme: the chord moves under the melody's creep
const BRK_H = 'Cm Cm Ab Ab Fm Fm Db Ab7';             // Ab7 = G#7, dominant of the climax key
const BUILD_H = 'Fm Fm Db Ab7';                       // break bars 5–8
const C2_H = 'Ab Bb Cm Cm Ab Bb Gsus4 G';
const TURN_H = 'Ab G';

// chord segments: one per bar, or two when a bar token has a comma
const segs = (harm) => {
  const out = [];
  harm.split(' ').forEach((bar, b) => bar.split(',').forEach((c, i, a) => out.push({ c, s: b * 16 + (i * 16) / a.length, l: 16 / a.length })));
  return out;
};
function chordEvents(harm, opt) {
  const S = segs(harm);
  return voiceLead(S.map((x) => x.c), opt).map((n, i) => [S[i].s, n, S[i].l * (opt.legato ?? 1), opt.vel ?? 0.7]);
}
const barList = (harm) => harm.split(' ').map((b) => b.split(',').pop());   // one chord per bar (last of a split bar)
const halves = (harm) => harm.split(' ').flatMap((b) => { const c = b.split(','); return [c[0], c[c.length - 1]]; });   // two per bar
// bass roots between F1 and E2
const root = (sym) => 29 + ((chordInfo(sym).root - 5 + 12) % 12);
// apply a one-bar bass figure [[step, octave, len, vel]] to every chord segment
function bassFig(harm, fig) {
  const ev = [];
  for (const { c, s, l } of segs(harm)) {
    const b0 = Math.floor(s / 16) * 16, o = s % 16;
    for (const [st, oc, len, v] of fig) if (st >= o && st < o + l) ev.push([b0 + st, root(c) + 12 * oc, len, v]);
  }
  return ev;
}
// low-brass power voicing: root (G2..F#3), 5th, octave, and the 3rd (or 4th) on top
function power(sym) { const c = chordInfo(sym), r = 43 + ((c.root - 7 + 12) % 12); return [r, r + c.iv[2], r + 12, r + 12 + c.iv[1]]; }
// stabs: rhythms[bar % n] = [[step, len, vel], …]; each hit voices the chord sounding at that step
function stabs(harm, rhythms) {
  const S = segs(harm), bars = harm.split(' ').length, ev = [];
  for (let b = 0; b < bars; b++) for (const [st, l, v] of rhythms[b % rhythms.length]) {
    const at = b * 16 + st, sg = S.find((x) => at >= x.s && at < x.s + x.l);
    ev.push([at, power(sg.c), l, v]);
  }
  return ev;
}

// ── rhythm cells ─────────────────────────────────────────────────────────────────────
// the machine: 16ths, accents 3+3+2 (twice per bar), octave on the 2nd/3rd accent
const OST = [];
for (let h = 0; h < 2; h++) for (const [s, o, v] of [[0, 0, 1], [1, 0, 0.58], [2, 0, 0.64], [3, 1, 0.9], [4, 0, 0.58], [5, 0, 0.64], [6, 1, 0.86], [7, 0, 0.58]]) OST.push([h * 8 + s, o, 0.85, v]);
const EIGHTHS = [0, 2, 4, 6, 8, 10, 12, 14].map((s) => [s, 0, 1.7, s % 8 === 0 ? 0.9 : 0.62]);
const GALLOP = [];   // climax: 4-to-the-floor gallop, octave on the 16th before each beat's end
for (let b = 0; b < 4; b++) GALLOP.push([b * 4, 0, 0.85, 1], [b * 4 + 1, 0, 0.85, 0.6], [b * 4 + 2, 1, 0.85, 0.84], [b * 4 + 3, 0, 0.85, 0.62]);
const S332 = [[0, 1.5, 1], [3, 1.5, 0.78], [6, 1.5, 0.88]];
const S332B = [[8, 1.5, 0.95], [11, 1.5, 0.76], [14, 1.5, 0.86]];
const SFULL = S332.concat(S332B);
// Morse S-O-S on the 16th grid: dot 1, dash 3, gaps 1 / 3 (27 steps)
const SOS = [[0, 1], [2, 1], [4, 1], [8, 3], [12, 3], [16, 3], [22, 1], [24, 1], [26, 1]];
const sos = (at, note, vel = 0.75) => SOS.map(([s, l]) => [at + s, note, l * 0.8, vel]);

// ── melodies (8th-note tokens) ────────────────────────────────────────────────────────
// The Leviathan theme. Its head is a dark mirror of the Lancers call: instead of tonic → up a
// 5th, the tonic FALLS a 4th and creeps up a semitone onto the new chord (C – G – Ab).
const THEME = 'C5 - - G4 - Ab4 - - | - - - G4 Ab4 C5 Eb5 - | F5 - - C5 - Ab4 - - | G4 - - - - - B4 D5 | ' +
  'G5 - - D5 - Eb5 - - | - - - C5 Eb5 F5 - G5 | Ab5 - - F5 - Db5 - - | C5 - - - B4 - - -';
// B2 descant (quarters) — echoes the creep (G→Ab) at the top of the texture
const DESCANT = 'G5 - Ab5 - | C6 - - - | Ab5 - F5 - | G5 - - - | G5 - Ab5 - | C6 - Ab5 - | F5 - Ab5 - | G5 - - -';
// climax2: the melody climbs with the bVI–bVII–i roots, then arpeggios and a 4–3 over the dominant
const DEFY = 'Ab5 - - - - - G5 Ab5 | Bb5 - - - - - Ab5 Bb5 | C6 - - - - - - - | - - - - G5 - Eb5 - | ' +
  'Ab5 - - - C6 - Eb6 - | D6 - - - Bb5 - F5 - | C6 - - - - - - - | B5 - - - - - D6 -';

export default {
  title: 'Leviathan Wreck',
  bpm: 124,
  key: 'C', scale: 'minor',
  gain: 0.8,
  delay: { beats: 0.75, feedback: 0.4, lp: 3200, hp: 450 },
  duck: { release: 0.18 },
  seed: 41,

  instruments: {
    wBass: { base: 'bass', cutoff: 430, env: 3.1, fd: 0.1, q: 5, drive: 0.5, square: 0.5, d: 0.12, s: 0.55, r: 0.05 },
    wSpicc: { base: 'stringsDark', a: 0.006, d: 0.11, s: 0.4, r: 0.08 },        // play-time only: shares the stringsDark samples
    wArp: { base: 'pluck', cutoff: 520, env: 4.2, decay: 0.11, amp: 0.36, q: 7, square: 0.5 },
    wLead: { base: 'lead', wave: 'saw', voices: 3, detune: 11, sub: 0.25, cutoff: 1900, q: 3, env: 1.7, fd: 0.28, vib: 13, vibDelay: 0.3, glide: 0.06, s: 0.75, r: 0.2, vol: 0.62 },
    wBeep: { base: 'lead', wave: 'pulse', pw: 0.3, voices: 1, cutoff: 2600, env: 0.6, q: 2, vib: 0, a: 0.003, d: 0.06, s: 0.7, r: 0.05, vol: 0.5 },
    clank: { type: 'fm', ratio: 1.414, index: 5, isus: 0.04, idecay: 0.1, decay: 0.9, c2: 2.76, m2: 1.83, i2: 2.6, d2: 0.22, l2: 0.55, detune: 12, vol: 0.62 },
  },

  channels: {
    kick: { inst: 'kickHard', gain: 0.4, sidechain: true, layer: { min: 0.15 } },
    snare: { inst: 'snareBig', gain: 0.5, reverb: 0.26, layer: { min: 0.15 } },
    hat: { gain: 0.34, pan: 0.24, choke: ['ohat'], human: { t: 0.002, v: 0.1 }, layer: { min: 0.15 } },
    ohat: { gain: 0.26, pan: 0.28, layer: { min: 0.15 } },
    rim: { gain: 0.3, pan: -0.22, delay: 0.12 },
    clank: { gain: 0.3, pan: 0.3, reverb: 0.42, delay: 0.18, note: 'C4' },
    ride: { gain: 0.2, pan: -0.3 },
    crash: { gain: 0.4, reverb: 0.15, pan: -0.18 },
    tom: { gain: 0.34, reverb: 0.16 },
    taiko: { gain: 0.2, reverb: 0.24, tune: -2 },
    tkm: { inst: 'taiko', gain: 0.25, reverb: 0.2, pan: 0.12 },
    tk2: { inst: 'taiko', gain: 0.22, reverb: 0.22, pan: -0.16, layer: { min: 0.75 } },
    rev: { inst: 'revcym', gain: 0.42 },
    riser: { gain: 0.4, reverb: 0.3 },
    down: { inst: 'downlifter', gain: 0.38, reverb: 0.35 },
    impact: { gain: 0.45, reverb: 0.28 },
    sub: { gain: 0.55 },
    reese: { gain: 0.42, lpf: 20000 },
    bass: { inst: 'wBass', gain: 0.74, duck: 0.35, lpf: 20000 },
    pad: { inst: 'padDark', gain: 0.3, duck: 0.45, reverb: 0.35, lpf: 20000 },
    spicc: { inst: 'wSpicc', gain: 0.4, reverb: 0.22, pan: 0.2, duck: 0.25 },
    cello: { inst: 'stringsDark', gain: 0.5, reverb: 0.3, pan: -0.12 },
    brass: { gain: 0.4, reverb: 0.3 },
    stab: { inst: 'brassStab', gain: 0.42, reverb: 0.24, pan: -0.08, delay: 0.1 },
    horn: { inst: 'brass', gain: 0.78, reverb: 0.3, pan: 0.06 },
    choir: { inst: 'choirOh', gain: 0.24, reverb: 0.5, duck: 0.2 },
    arp: { inst: 'wArp', gain: 0.3, delay: 0.32, reverb: 0.15, pan: -0.3, duck: 0.3 },
    beacon: { inst: 'wBeep', gain: 0.3, reverb: 0.5, delay: 0.45, pan: 0.35 },
    lead: { inst: 'wLead', gain: 0.8, reverb: 0.22, delay: 0.2 },
    lead2: { inst: 'wLead', gain: 0.4, reverb: 0.16, layer: { min: 0.8 } },
  },

  patterns: {
    // ── INTRO ──
    introPad: { len: 64, pad: chordEvents(INTRO_H, { low: 'C3', high: 'Ab4', voices: 4, vel: 0.62 }) },
    introSub: { step: 16, sub: 'C2 - Db2 G1' },
    introBraam: { len: 64, brass: [[0, 'C2+G2+C3', 26, 0.95], [32, 'Db3+Ab3', 14, 0.7], [48, 'G2+D3+G3', 16, 0.8]], choir: [[0, 'G3+C4+Eb4', 30, 0.62], [32, 'F3+Ab3+Db4', 16, 0.55], [48, 'G3+C4+D4', 8, 0.55], [56, 'G3+B3+D4', 8, 0.6]] },
    introBeacon: { len: 64, beacon: sos(6, 'G5', 0.7) },
    introBass: { len: 48, bass: bassFig('Cm Db Gsus4,G', EIGHTHS) },
    introTaiko: { taiko: 'X............... ................ X.....x......... X..x..x.X.x.XXXX', tom: '.*56 G3 . Eb3 . C3 C3 G2 G2' },
    introFx: {
      len: 64, impact: [[0, 'x', 1, 0.95]], riser: [[32, 'x', 32, 0.7]], rev: [[52, 'x', 12, 0.8]],
      clank: '......x......... ..........o..... ....x.......o... x.......x...o...',
    },

    // ── A: the machine ──
    ostA: { len: 128, bass: bassFig(A_H, OST) },
    padA: { len: 128, pad: chordEvents(A_H, { low: 'C3', high: 'Bb4', voices: 4, vel: 0.6 }) },
    stabA: { len: 128, stab: stabs(A_H, [S332, [[14, 1.5, 0.7]]]) },
    tickA: { hat: 'o.g.o.g.o.g.o.g.', clank: '....x.......o...' },
    choirA: { len: 64, choir: chordEvents('Fm Fm G G', { low: 'Eb4', high: 'C5', voices: 3, rootless: true, vel: 0.6 }) },
    tkA: { taiko: 'X.....X.X.......', tkm: '. . . . . . . . . . . C2 . . C2 Eb2' },
    tkA2: { taiko: 'X.....X.X.....x.', tkm: '. . . . . . . . . . . . G2 Eb2 C2 C2' },
    tkFill: { taiko: 'X.....X.X.X.XXXX', tkm: '. . . . . . . . . C2 . Eb2 . G2 G2 G2' },
    crash1: { crash: 'X' },

    // ── A2: + drums, strings ──
    ostA2: { len: 128, bass: bassFig(A2_H, OST) },
    padA2: { len: 128, pad: chordEvents(A2_H, { low: 'C3', high: 'Bb4', voices: 4, vel: 0.62 }) },
    stabA2: { len: 128, stab: stabs(A2_H, [S332, S332B]) },
    spA2: { len: 128, spicc: arp(voiceLead(barList(A2_H), { low: 'G4', high: 'G5', voices: 3 }), { rate: 2, order: [0, 1, 0, 2, 0, 1, 0, 2], gate: 0.7, vel: 0.62, accent: 0.14 }) },
    celloA2: { len: 128, cello: [[24, 'C4', 6, 0.72], [30, 'G3', 2, 0.62], [32, 'Ab3', 16, 0.75], [88, 'F3', 6, 0.72], [94, 'C3', 2, 0.62], [96, 'Db3', 16, 0.75]] },
    arpA2: { len: 64, arp: arp(voiceLead(['Fm', 'Fm', 'Db', 'G'], { low: 'C5', high: 'C6', voices: 3 }), { rate: 1, order: [0, 1, 2, 1, 0, 2, 1, 2], gate: 0.6, vel: 0.6, accent: 0.2 }) },
    grA2: { kick: 'X.....x.X.......', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.', rim: '...x..x....x..x.' },
    fillA: { kick: 'X.....x.X.......', snare: '....X.......X.xx', hat: 'x.x.x.x.x.x.....', rim: '...x..x.........' },
    fillA2: { kick: 'X.....x.X.......', snare: '....X...x.x.xxxx', hat: 'x.x.x.x.........', tom: '.*8 G3 G3 Eb3 Eb3 C3 C3 G2 G2' },
    fxA2: { len: 128, rev: [[116, 'x', 12, 0.8]], riser: [[96, 'x', 32, 0.55]] },

    // ── B: the theme ──
    themeB: { step: 2, lead: THEME, lead2: transpose(THEME, -12) },
    pickup: { len: 16, lead: [[14, 'G4', 2, 0.75]], lead2: [[14, 'G3', 2, 0.75]] },       // into the theme (lead)
    pickupBr: { len: 16, horn: [[14, 'G3', 2, 0.75]], cello: [[14, 'G3', 2, 0.7]] },       // into the theme (low brass)
    pickupC: { len: 16, lead: [[14, 'Ab4', 2, 0.8]], lead2: [[14, 'Ab3', 2, 0.8]] },      // Ab = G#: 5th of the climax key
    brassB: { len: 128, brass: chordEvents(T_H, { low: 'C3', high: 'C4', voices: 3, vel: 0.5, legato: 0.96 }) },
    ostB: { len: 128, bass: bassFig(T_H, OST) },
    padB: { len: 128, pad: chordEvents(T_H, { low: 'C3', high: 'Bb4', voices: 4, vel: 0.62 }) },
    spB: { len: 128, spicc: arp(voiceLead(halves(T_H), { low: 'G4', high: 'G5', voices: 3 }), { rate: 2, len: 8, order: [0, 1, 0, 2], gate: 0.7, vel: 0.62, accent: 0.14 }) },
    stabB: { len: 128, stab: stabs(T_H, [[[0, 1.5, 1], [3, 1.5, 0.78]], [[8, 1.5, 0.9], [11, 1.5, 0.75], [14, 1.5, 0.85]]]) },
    grB: { kick: 'X.....x.X..x....', snare: '....X.......X...', hat: 'xgxgxgxgxgxgxgxg', ohat: '..............x.', rim: '...x..x....x..x.' },
    fillB: { kick: 'X.....x.X..x....', snare: '....X.......X.Xx', hat: 'xgxgxgxgxgxg....', rim: '...x..x.........', tom: '.*13 Eb3 C3 G2' },
    fillB2: {
      kick: 'X.....x.X.......', hat: 'xgxgxgxg........',
      snare: '. . . . X . . . x@0.55 . x@0.65 x@0.7 x@0.8 x@0.85 x@0.9 X',
      tom: '.*8 G3 . Eb3 . C3 . G2 G2',
    },
    tkB: { taiko: 'X.....x.X.....x.', tkm: '. . . C2 . . Eb2 . . . . C2 . . G2 .' },
    tk2B: { tk2: '. . C2 . . Eb2 . . . . C2 . G2 . Eb2 C2' },

    // ── B2: theme in the low brass, descant above ──
    themeB2: { step: 2, horn: transpose(THEME, -12), cello: transpose(THEME, -12) },
    descB2: { step: 4, lead: DESCANT, vel: 0.78 },
    choirB2: { len: 128, choir: chordEvents(T_H, { low: 'G4', high: 'Eb5', voices: 3, rootless: true, vel: 0.62 }) },
    arpB2: { len: 128, arp: arp(voiceLead(halves(T_H), { low: 'C5', high: 'C6', voices: 3 }), { rate: 1, len: 8, continue: true, order: [0, 1, 2, 1, 0, 2, 1, 2], gate: 0.6, vel: 0.56, accent: 0.2 }) },
    rideB2: { ride: 'x.x.x.x.x.x.x.x.' },

    // ── BREAK: into the belly ──
    brkDrone: { len: 64, sub: [[0, 'C2', 32, 0.8], [32, 'Ab1', 32, 0.8]], reese: [[0, 'C2', 30, 0.55], [32, 'Ab1', 30, 0.6]] },
    brkPad: { len: 128, pad: chordEvents(BRK_H, { low: 'C3', high: 'Bb4', voices: 4, vel: 0.62 }) },
    brkCello: { cello: 'C4*12 G3*20 Ab3*32 F3*16 Ab3*16 Db4*16 C4*16', vel: 0.78 },
    brkChoir: { len: 64, choir: chordEvents('Cm Cm Ab Ab', { low: 'Eb4', high: 'C5', voices: 3, rootless: true, vel: 0.5 }) },
    brkBeacon: { len: 64, beacon: [...sos(4, 'G5', 0.72), ...sos(36, 'G5', 0.6)] },
    brkTick: { hat: 'o.......o.......', clank: '......o.........' },
    bldBass: { len: 64, bass: bassFig(BUILD_H, OST) },
    bldBrass: { len: 64, brass: chordEvents(BUILD_H, { low: 'C3', high: 'C4', voices: 3, vel: 0.55 }).map(([s, n, l, v], i) => [s, n, l, v + i * 0.1]) },
    bldSpicc: { len: 32, spicc: arp(voiceLead(['Db', 'Ab7'], { low: 'Ab4', high: 'Ab5', voices: 3 }), { rate: 1, order: [0, 1, 2, 1], gate: 0.65, vel: 0.62, accent: 0.2 }) },
    bldStab: { len: 64, stab: stabs(BUILD_H, [[[0, 1.5, 0.8]], [[0, 1.5, 0.85], [8, 1.5, 0.85]], [[0, 1.5, 0.9], [6, 1.5, 0.85], [8, 1.5, 0.9], [14, 1.5, 0.85]], SFULL]) },
    bldDrums: {
      len: 64,
      taiko: 'X.......X....... X...X...X...X... X.X.X.X.X.X.X.X. XXXXXXXXXXXXrrRR',
      tkm: '.*48 C2 C2 Eb2 Eb2 G2 G2 C2 C2 Eb2 Eb2 G2 G2 G2 G2 G2 G2',
      snare: '................ ................ ..x...x...x...x. x.x.x.x.xxxxxxxx',
      rim: '...x..x....x..x. ...x..x....x..x. ...x..x....x..x. ...x..x....x..x.',
    },
    bldFx: { len: 64, riser: [[0, 'x', 64, 0.85]], rev: [[48, 'x', 16, 0.9]] },

    // ── CLIMAX (played a semitone up) ──
    themeC: { step: 2, lead: THEME, lead2: transpose(THEME, -12), horn: transpose(THEME, -12) },
    choirC: { len: 128, choir: chordEvents(T_H, { low: 'G4', high: 'Eb5', voices: 3, rootless: true, vel: 0.66 }) },
    spC: { len: 128, spicc: arp(voiceLead(halves(T_H), { low: 'G4', high: 'G5', voices: 3 }), { rate: 1, len: 8, order: [0, 1, 2, 1], gate: 0.65, vel: 0.6, accent: 0.18 }) },
    galC: { len: 128, bass: bassFig(T_H, GALLOP) },
    stabC: { len: 128, stab: stabs(T_H, [[[0, 1.5, 1]], S332B]) },
    grC: { kick: 'X...X...X...X...', snare: '....X.......X...', hat: 'xgxgxgxgxgxgxgxg', ohat: '..x...x...x...x.', rim: '...x..x....x..x.' },
    fillC: { kick: 'X...X...X...X...', snare: '....X...X.X.XXXX', hat: 'xgxgxgxgxgxg....', tom: '.*12 G3 Eb3 C3 G2' },
    tkC: { taiko: 'X..x..x.X..x..x.', tkm: 'C2 . Eb2 . . . C2 . C2 . Eb2 . G2 . C2 Eb2' },
    tk2C: { tk2: 'G2 G2 . G2 . . Eb2 . G2 G2 . G2 . . C2 C2' },
    fxC: { len: 128, impact: [[0, 'x', 1, 0.95]], crash: [[0, 'x', 1, 1], [64, 'x', 1, 0.9]] },

    // ── CLIMAX 2: defiance (bVI–bVII–i) ──
    defyC2: { step: 2, lead: DEFY, lead2: transpose(DEFY, -12) },
    brassC2: { len: 128, brass: chordEvents(C2_H, { low: 'C3', high: 'D4', voices: 3, vel: 0.62, legato: 0.96 }) },
    choirC2: { len: 128, choir: chordEvents(C2_H, { low: 'G4', high: 'Eb5', voices: 3, rootless: true, vel: 0.66 }) },
    padC2: { len: 128, pad: chordEvents(C2_H, { low: 'C3', high: 'Bb4', voices: 4, vel: 0.62 }) },
    spC2: { len: 128, spicc: arp(voiceLead(barList(C2_H), { low: 'G4', high: 'G5', voices: 3 }), { rate: 1, order: [0, 1, 2, 1], gate: 0.65, vel: 0.6, accent: 0.18 }) },
    galC2: { len: 128, bass: bassFig(C2_H, GALLOP) },
    stabC2: { len: 128, stab: stabs(C2_H, [SFULL, [[0, 1.5, 1]]]) },
    fxC2: { len: 128, crash: [[0, 'x', 1, 0.9], [64, 'x', 1, 0.9]], rev: [[116, 'x', 12, 0.85]] },

    // ── TURN (G# = Ab → G → home) ──
    turnAll: {
      len: 32,
      stab: stabs(TURN_H, [SFULL, [[0, 1.5, 1], [3, 1.5, 0.85], [6, 1.5, 0.95], [8, 4, 1]]]),
      bass: bassFig(TURN_H, OST),
      pad: chordEvents(TURN_H, { low: 'C3', high: 'Bb4', voices: 4, vel: 0.62 }),
      lead: [[0, 'C6', 14, 0.8], [16, 'B5', 12, 0.75]],
      brass: [[0, 'Ab2+Eb3+Ab3+C4', 14, 0.8], [16, 'G2+D3+G3+B3', 12, 0.85]],
      taiko: 'X..X..X.X..X..X. X.X.X.X.XXXXrrRR',
      tkm: '.*16 C2 . Eb2 . G2 . C2 . C2 C2 Eb2 Eb2 G2 G2 G2 G2',
      kick: 'X...X...X...X... X...X...X.......',
      snare: '....X.......X... ....X...xxxxrrRR',
      crash: 'X',
      down: [[0, 'x', 24, 0.6]],
    },
  },

  sections: {
    intro: {
      bars: 4, chords: INTRO_H,
      play: ['introPad', 'introSub', 'introBraam', 'introBeacon', 'introTaiko', 'introFx', { p: 'introBass', at: 1, once: true }],
      auto: { 'pad.lpf': [[0, 320], [4, 2600]], 'bass.lpf': [[1, 220], [4, 1100]] },
    },
    A: {
      bars: 8, chords: A_H,
      play: ['ostA', 'padA', 'stabA', 'tickA', { p: 'choirA', at: 4 }, ['crash1', null, null, null, null, null, null, null],
        ['tkA', 'tkA2', 'tkA', 'tkA2', 'tkA', 'tkA2', 'tkA', 'tkFill']],
      auto: { 'bass.lpf': [[0, 650], [8, 3400]], 'pad.lpf': [[0, 1100], [8, 3200]] },
    },
    A2: {
      bars: 8, chords: A2_H,
      play: ['ostA2', 'padA2', 'stabA2', 'spA2', 'celloA2', { p: 'arpA2', at: 4 }, 'fxA2', ['crash1', null, null, null, null, null, null, null],
        ['grA2', 'grA2', 'grA2', 'fillA', 'grA2', 'grA2', 'grA2', 'fillA2'], ['tkA', 'tkA2'], { p: 'pickup', at: 7 }],
      auto: { 'arp.lpf': [[0, 900], [4, 5000]] },
    },
    B: {
      bars: 8, chords: T_H,
      play: ['themeB', 'brassB', 'ostB', 'padB', 'spB', 'stabB', ['crash1', null, null, null, null, null, null, null],
        ['grB', 'grB', 'grB', 'fillB', 'grB', 'grB', 'grB', 'fillB2'], 'tkB', 'tk2B', { p: 'pickupBr', at: 7 }],
    },
    B2: {
      bars: 8, chords: T_H,
      play: ['themeB2', 'descB2', 'choirB2', 'ostB', 'padB', 'arpB2', 'stabB', 'rideB2', ['crash1', null, null, null, 'crash1', null, null, null],
        ['grB', 'grB', 'grB', 'fillB', 'grB', 'grB', 'grB', 'fillB2'], 'tkB', 'tk2B'],
      auto: { 'lead.vol': [[0, 0.62]], 'pad.vol': [[0, 0.7]], 'pad.lpf': [[0, 1800]] },
    },
    break: {
      bars: 8, chords: BRK_H,
      play: ['brkPad', { p: 'brkDrone', once: true }, 'brkCello', { p: 'brkChoir', once: true }, { p: 'brkBeacon', once: true }, { p: 'brkTick', until: 4 },
        { p: 'bldBass', at: 4 }, { p: 'bldBrass', at: 4 }, { p: 'bldSpicc', at: 6 }, { p: 'bldStab', at: 4 }, { p: 'bldDrums', at: 4 }, { p: 'bldFx', at: 4 }, { p: 'pickupC', at: 7 }],
      auto: { 'pad.lpf': [[0, 700], [4, 1200], [8, 4000]], 'bass.lpf': [[4, 300], [8, 3200]], 'reese.lpf': [[0, 400], [2, 1400], [4, 500]] },
    },
    climax: {
      bars: 8, chords: T_H,
      play: ['themeC', 'choirC', 'spC', 'galC', 'padB', 'stabC', 'fxC', 'rideB2',
        ['grC', 'grC', 'grC', 'fillC', 'grC', 'grC', 'grC', 'fillC'], 'tkC', 'tk2C'],
    },
    climax2: {
      bars: 8, chords: C2_H,
      play: ['defyC2', 'brassC2', 'choirC2', 'padC2', 'spC2', 'galC2', 'stabC2', 'fxC2', 'rideB2',
        ['grC', 'grC', 'grC', 'fillC', 'grC', 'grC', 'grC', 'fillC'], 'tkC', 'tk2C'],
    },
    turn: {
      bars: 2, chords: TURN_H,
      play: ['turnAll'],
    },
  },

  arrangement: ['intro', 'A', 'A2', 'B', 'B2', 'break', { s: 'climax', tr: 1 }, { s: 'climax2', tr: 1 }, 'turn'],
  loop: 'A',
};
