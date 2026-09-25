// "Choir Assault" — boss theme for sectors 1–4. Aggressive, urgent: G minor, 156 BPM.
// The Choir's own leitmotif runs through it: 1–b2–1–5 (G–Ab–G–D, harmonized i–bII–i–V), chanted
// by a power-chord choir; the finale ("Heart of the Choir") reuses it in D minor.
// Form (62 bars ≈ 95 s; loops from RIFF, a 58-bar / 89 s cycle):
//   intro (4)    right after the WARNING siren: low choir + brass chant the motif over a G pedal
//                with taiko (bars 1–2 stay low so the siren cuts through); then the 16th bass
//                fades in, snare roll, riser, reverse cymbal → downbeat
//   riff (8)     THE ASSAULT: 16th bass grouped 3+3+3+3+4 locked with kick, saw stabs and taiko;
//                the choir chants the motif in open fifths; brass stabs on 0/6/12
//   A (8)        the hook on a gritty saw lead (low octave) over i–VI–iv7–V7, spiccato strings
//   A2 (8)       hook an octave up with brass unison, choir, stabs; ends bII–V–i (Ab–D–Gm)
//   B (8)        half-time: a lyrical descending sequence around the circle of fifths
//                (Cm7 F7 Bbmaj7 Ebmaj7 Am7b5 D7 Gm D7), 16th arp keeps the pulse
//   B2 (8)       B up an octave on the lead, brass sings it below, choir, full-time drums
//   bridge (8)   chromatic power-chord climb G5→Ab5→…→D5 (one semitone per bar), the lead slides
//                up like the WARNING siren, snare builds, riser → V
//   climax (8)   the hook at full power: lead + brass octaves, choir, stabs, taiko, gallop bass
//   turn (2)     the motif chant again (Gm–Ab/G, Gm–D) with a tom fill → back to the riff
// Intensity: ≥0.7 ride, ≥0.75 a second taiko, ≥0.8 lead doubled an octave down (square).

import { arp, voiceLead, chordInfo, transpose, noteName } from '../music.js';

// ── harmony ──────────────────────────────────────────────────────────────────────────
const INTRO_H = 'Gm,Ab/G Gm,D Gm,Ab/G D';
const RIFF_H = 'Gm Gm,Ab Gm Eb,D Gm Gm,Ab Cm D';
const A_H = 'Gm Eb Cm7 D7 Gm Eb,Bb Cm,D7 D';
const A2_H = 'Gm Eb Cm7 D7 Gm Eb,Bb Ab,D Gm';
const B_H = 'Cm7 F7 Bbmaj7 Ebmaj7 Am7b5 D7 Gm D7';
const B_TRI = 'Cm F Bb Eb Adim D Gm D';          // sustained layers: triads (the melody carries the 7ths)
const BR_H = 'G5 Ab5 A5 Bb5 B5 C5 C#5 D5';
const TURN_H = 'Gm,Ab/G Gm,D';

// bar / half-bar / quarter-bar chord lists → [symbols, [startStep, lenSteps]]
const split = (harm) => { const f = [], at = []; harm.split(' ').forEach((bar, b) => bar.split(',').forEach((c, i, a) => { f.push(c); at.push([b * 16 + (i * 16) / a.length, 16 / a.length]); })); return [f, at]; };
function chordEvents(harm, opt) {
  const [f, at] = split(harm);
  return voiceLead(f, opt).map((n, i) => [at[i][0], n, at[i][1] * (opt.legato ?? 1), opt.vel ?? 0.7]);
}
// every chord → its open fifth ('Cm7' → 'C5'): the Choir sings in bare fifths and octaves, which
// also keeps it clear of the melody's passing tones
// (a chord with a diminished 5th keeps it: 'Am7b5' → 'Adim')
const power = (harm) => harm.split(' ').map((bar) => bar.split(',').map((c) => {
  const i = chordInfo(c), r = noteName(i.root, true).replace(/-?\d+$/, '');
  return r + (i.iv.includes(6) && !i.iv.includes(7) ? 'dim' : '5');
}).join(',')).join(' ');
// two chords per bar (a single-chord bar is repeated) → arp({ len: 8, continue: true })
function halfList(harm, opt) {
  const f = [];
  harm.split(' ').forEach((bar) => { const c = bar.split(','); f.push(c[0], c[Math.min(c.length - 1, Math.floor(c.length / 2))]); });
  return voiceLead(f, opt);
}
// bass note of a chord (slash bass wins: Ab/G stays on the G pedal) in F#1..F2 — G minor's
// bass lives around G1–G2
const root = (sym) => { const c = chordInfo(sym); return 30 + (((c.bass ?? c.root) - 6 + 12) % 12); };
// Apply a one-bar figure [[step, semitonesAboveRoot, len, vel], …] to every chord of `harm`
// (each chord only takes the figure steps inside its own span).
function bassFig(harm, fig, base = 0) {
  const [f, at] = split(harm);
  const ev = [];
  f.forEach((c, i) => {
    const [s0, len] = at[i];
    const pedal = c.includes('/');   // over a pedal the 5th would clash with the upper chord: use octaves
    for (const [st, iv, l, v] of fig) if (st >= s0 % 16 && st < (s0 % 16) + len) ev.push([Math.floor(s0 / 16) * 16 + st, root(c) + base + (pedal && iv % 12 === 7 ? iv + 5 : iv), l, v]);
  });
  return ev;
}
// Chord hits at fixed in-bar steps [[step, len, vel], …] with voice-led voicings.
function hits(harm, rhythm, opt) {
  const [f, at] = split(harm);
  const v = voiceLead(f, opt);
  const ev = [];
  f.forEach((c, i) => {
    const [s0, len] = at[i];
    for (const [st, l, vel] of rhythm) if (st >= s0 % 16 && st < (s0 % 16) + len) ev.push([Math.floor(s0 / 16) * 16 + st, v[i], l, vel]);
  });
  return ev;
}

// ── rhythm figures ───────────────────────────────────────────────────────────────────
// the assault: 16ths grouped 3+3+3+3+4 (root root OCT | … | root OCT 5th OCT)
const RIFF = [];
for (let g = 0; g < 4; g++) RIFF.push([g * 3, 0, 0.9, 0.98], [g * 3 + 1, 0, 0.9, 0.62], [g * 3 + 2, 12, 0.9, 0.8]);
RIFF.push([12, 0, 0.9, 0.95], [13, 12, 0.9, 0.7], [14, 7, 0.9, 0.82], [15, 12, 0.9, 0.72]);
const RIFF_ACC = [[0, 1.4, 1], [3, 1.4, 0.8], [6, 1.4, 0.9], [9, 1.4, 0.8], [12, 1.4, 0.95], [14, 1.4, 0.8]];
// driving 16ths: root root OCT root per beat
const DRIVE = [];
for (let b = 0; b < 4; b++) DRIVE.push([b * 4, 0, 0.9, 0.95], [b * 4 + 1, 0, 0.9, 0.66], [b * 4 + 2, 12, 0.9, 0.84], [b * 4 + 3, 0, 0.9, 0.7]);
// gallop (8th + two 16ths) for the half-time B section
const GALLOP = [];
for (let b = 0; b < 4; b++) GALLOP.push([b * 4, 0, 1.8, 0.95], [b * 4 + 2, 0, 0.9, 0.7], [b * 4 + 3, 12, 0.9, 0.78]);
// brass stab rhythms
const STAB_332 = [[0, 1.5, 1], [6, 1.5, 0.85], [12, 1.5, 0.95]];
const STAB_A = [[0, 1.5, 0.95], [3, 1.5, 0.75], [6, 1.5, 0.85], [10, 1.5, 0.8], [12, 1.5, 0.9]];

// ── melodies (16th units: 'G4*6' = G4 for six 16ths) ────────────────────────────────────
// The hook: a dotted "call" cell (3+1+2+2 eighths) climbing through i–VI–iv7, a 16th run over
// V7, then the answer reaches up to the 7th of the key and falls back to the dominant.
const HOOK_LO =
  'G4*6 D4*2 G4*4 A4*4 | Bb4*6 A4*2 G4*4 F4*4 | G4*6 D4*2 G4*4 Bb4*4 | D5*4 C5 Bb4 A4 G4 F#4*4 A4*2 D4*2 | ' +
  'G4*6 D4*2 G4*4 A4*4 | Bb4*6 C5*2 D5*4 F5*4 | G5*4 F5*2 Eb5*2 D5*4 C5*4 | D5*12 A5 Bb5 A5 F#5';
const HOOK_HI =
  'G5*6 D5*2 G5*4 A5*4 | Bb5*6 A5*2 G5*4 F5*4 | G5*6 D5*2 G5*4 Bb5*4 | D6*4 C6 Bb5 A5 G5 F#5*4 A5*2 D5*2 | ' +
  'G5*6 D5*2 G5*4 A5*4 | Bb5*6 C6*2 D6*4 F6*4 | Eb6*6 C6*2 A5*4 F#5*4 | G5*16';
// B: guide tones falling around the circle of fifths (3rd → 7th → 3rd …), each bar a long note
// and a two-8th pickup; the last bar climbs out on the dominant.
const B_LO =
  'Eb5*12 D5*2 C5*2 | Eb5*12 C5*2 A4*2 | D5*12 C5*2 Bb4*2 | D5*12 Bb4*2 G4*2 | ' +
  'C5*12 Bb4*2 A4*2 | C5*12 A4*2 F#4*2 | Bb4*8 G4*4 A4*4 | F#4*8 A4*4 D5*4';
// bridge: a siren-like chromatic slide, one semitone per bar
const SIREN = 'G5*16 ~Ab5*16 ~A5*16 ~Bb5*16 ~B5*16 ~C6*16 ~C#6*16 ~D6*16';

// explicit chant voicings (open fifths + octave: the motif is the top voice)
const CHANT_INTRO = 'G3+D4+G4*8 Ab3+Eb4+Ab4*8 | G3+D4+G4*8 D3+A3+D4*8 | G3+D4+G4*8 Ab3+Eb4+Ab4*8 | D3+A3+D4*16';
const CHANT_RIFF = 'G3+D4+G4*16 | G3+D4+G4*8 Ab3+Eb4+Ab4*8 | G3+D4+G4*16 | Eb3+Bb3+Eb4*8 D3+A3+D4*8 | ' +
  'G3+D4+G4*16 | G3+D4+G4*8 Ab3+Eb4+Ab4*8 | C3+G3+C4*16 | D3+A3+D4*16';
// over the G pedal the Ab chord's low brass takes C+Eb (an Ab in the low register would grind a
// minor 9th against the sub)
const LOWBRASS_INTRO = 'G2+D3*8 C3+Eb3*8 | G2+D3*8 D2+A2*8 | G2+D3*8 C3+Eb3*8 | D2+A2+D3*16';

// power-chord arp (root 5th 8ve 12th 15th 12th 8ve 5th) for the bridge
const brArp = (() => {
  const ev = [];
  ['G3', 'Ab3', 'A3', 'Bb3', 'B3', 'C4', 'C#4', 'D4'].forEach((r, b) => {
    const R = chordInfo(r.replace(/\d/, '')).root + 12 * (+r.slice(-1) + 1);
    [0, 7, 12, 19, 24, 19, 12, 7, 0, 7, 12, 19, 12, 7, 12, 19].forEach((iv, i) => ev.push([b * 16 + i, R + iv, 0.85, i % 4 === 0 ? 0.8 : 0.62]));
  });
  return ev;
})();

export default {
  title: 'Choir Assault',
  bpm: 156,
  key: 'G', scale: 'minor',
  gain: 0.78,
  reverb: 0.9,
  delay: { beats: 0.75, feedback: 0.3, lp: 3800, hp: 500 },
  duck: { release: 0.16 },
  seed: 23,

  instruments: {
    // same render as aurora's bass (shared samples in sector 1), gated a little tighter
    xBass: { base: 'bass', env: 2.8, fd: 0.12, cutoff: 460, q: 4, drive: 0.45, d: 0.12, s: 0.55, r: 0.05 },
    xArp: { base: 'pluck', cutoff: 950, env: 3.6, decay: 0.2, amp: 0.55, q: 4 },          // = aurora's arp render
    xSpic: { base: 'strings', a: 0.008, d: 0.12, s: 0.55, r: 0.09 },                       // spiccato (play-time env)
    xLead: { base: 'lead', wave: 'saw', voices: 3, detune: 13, sub: 0.18, cutoff: 2600, q: 2.5, env: 1.6, fd: 0.28, vib: 20, vibRate: 5.8, vibDelay: 0.2, glide: 0.11, r: 0.22, vol: 0.6 },
    xLead2: { base: 'leadSquare', cutoff: 1900, vib: 12, r: 0.16 },
    xPad: { base: 'padDark', r: 1.0 },                                                      // shorter tails (play-time)
    xChoir: { base: 'choir', r: 0.9 },
    xSaw: { base: 'lead', wave: 'saw', voices: 3, detune: 16, cutoff: 1700, q: 3, env: 2.2, fd: 0.12, vib: 0, a: 0.003, d: 0.1, s: 0.5, r: 0.06, vol: 0.6 },
  },

  channels: {
    kick: { inst: 'kickHard', gain: 0.4, sidechain: true },
    snare: { inst: 'snareBig', gain: 0.46, reverb: 0.22 },
    roll: { inst: 'snareTight', gain: 0.4, reverb: 0.2, pan: 0.05 },
    clap: { gain: 0.3, reverb: 0.2, pan: -0.08 },
    hat: { gain: 0.38, pan: 0.25, choke: ['ohat'], human: { t: 0.002, v: 0.1 } },
    ohat: { gain: 0.3, pan: 0.3 },
    ride: { gain: 0.22, pan: -0.3, layer: { min: 0.7 } },
    crash: { gain: 0.42, reverb: 0.15, pan: -0.2 },
    tom: { gain: 0.4, reverb: 0.16 },
    taiko: { gain: 0.26, reverb: 0.22 },
    taiko2: { inst: 'taiko', gain: 0.26, reverb: 0.25, pan: 0.2, tune: 5, layer: { min: 0.75 } },
    impact: { gain: 0.42, reverb: 0.25 },
    rev: { inst: 'revcym', gain: 0.4 },
    riser: { gain: 0.4, reverb: 0.3 },
    sub: { gain: 0.5, duck: 0.3 },
    bass: { inst: 'xBass', gain: 0.78, duck: 0.4 },
    pad: { inst: 'xPad', gain: 0.26, duck: 0.6, reverb: 0.3 },
    spic: { inst: 'xSpic', gain: 0.4, reverb: 0.2, pan: 0.22, duck: 0.25 },
    strings: { gain: 0.36, reverb: 0.35, duck: 0.3, pan: -0.15 },
    choir: { inst: 'xChoir', gain: 0.24, reverb: 0.45, duck: 0.25 },
    chant: { inst: 'xChoir', gain: 0.3, reverb: 0.4, duck: 0.2 },
    brass: { gain: 0.4, reverb: 0.28 },
    lowbrass: { inst: 'brass', gain: 0.36, reverb: 0.3, pan: -0.05 },
    stab: { inst: 'brassStab', gain: 0.38, reverb: 0.22, pan: -0.12, delay: 0.1 },
    saw: { inst: 'xSaw', gain: 0.55, pan: 0.1, reverb: 0.12, duck: 0.2 },
    arp: { inst: 'xArp', gain: 0.36, delay: 0.25, reverb: 0.15, pan: -0.25, duck: 0.35, poly: 5 },
    lead: { inst: 'xLead', gain: 0.8, reverb: 0.2, delay: 0.2 },
    lead2: { inst: 'xLead2', gain: 0.36, reverb: 0.15, layer: { min: 0.8 } },
  },

  patterns: {
    // ── intro ──
    introChant: { chant: CHANT_INTRO, lowbrass: LOWBRASS_INTRO, sub: 'G1*16 | G1*8 D2*8 | G1*16 | D2*16' },
    introPad: { len: 64, pad: chordEvents(INTRO_H.replace(/\/G/g, ''), { low: 'D3', high: 'D5', voices: 4, vel: 0.6 }) },
    introDr: {
      taiko: 'X.......x.......|X.......x.......|X.......x...x...|X...x...X.x.xxxx',
      kick: '................|................|X.......X.......|X...X...X.X.X.XX',
      hat: '................|................|o.o.o.o.o.o.o.o.|x.x.x.x.xxxxxxxx',
      roll: '.*48 x@0.28 x@0.32 x@0.36 x@0.4 x@0.45 x@0.5 x@0.55 x@0.6 x@0.65 x@0.7 x@0.75 x@0.8 x@0.85 x@0.9 x@0.95 X',
      tom: '.*60 G3 D3 Bb2 G2',
      impact: '................|................|X...............|................',
      riser: [[32, 'x', 32, 0.8]],
      rev: [[48, 'x', 16, 0.85]],
    },
    introBass: { len: 64, bass: bassFig('Gm,Ab/G D', RIFF).map(([s, n, l, v]) => [s + 32, n, l, v * 0.85]) },

    // ── riff ──
    riffBass: { len: 128, bass: bassFig(RIFF_H, RIFF) },
    riffSaw: { len: 128, saw: bassFig(RIFF_H, RIFF_ACC.map(([s, l, v]) => [s, 0, l, v]), 24) },
    riffChant: { chant: CHANT_RIFF },
    riffStab: { len: 128, stab: hits(RIFF_H, STAB_332, { low: 'G3', high: 'F4', voices: 3 }) },
    riffPad: { len: 128, pad: chordEvents(RIFF_H, { low: 'D3', high: 'D5', voices: 4, vel: 0.62 }) },
    riffBeat: { kick: 'X..X..X..X..X.x.', snare: '....X.......X...', clap: '....x.......x...', hat: 'x.xgx.xgx.xgx.xg', taiko: 'X.....x.....o...' },
    riffFill: { kick: 'X..X..X..X..X...', snare: '....X.......X.xx', clap: '....x.......x...', hat: 'x.xgx.xgx.xg....', taiko: 'X.....x.....o...', tom: '.*12 G3 D3 Bb2 G2' },
    riffFill2: { kick: 'X..X..X.X.......', snare: '....X...........', roll: '.*8 x@0.5 x@0.55 x@0.6 x@0.65 x@0.7 x@0.8 x@0.9 X', hat: 'x.xgx.xg........', taiko: 'X.....X.X.X.X.XX', tom: '.*8 G3 G3 D3 D3 Bb2 Bb2 G2 G2' },

    // ── A / A2 ──
    leadA: { lead: HOOK_LO, lead2: transpose(HOOK_LO, -12) },
    leadA2: { lead: HOOK_HI, lead2: transpose(HOOK_HI, -12), brass: transpose(HOOK_HI, -12) },
    bassA: { len: 128, bass: bassFig(A_H, DRIVE) },
    bassA2: { len: 128, bass: bassFig(A2_H, DRIVE) },
    padA: { len: 128, pad: chordEvents(A_H, { low: 'D3', high: 'G4', voices: 4, vel: 0.66 }) },
    padA2: { len: 128, pad: chordEvents(A2_H, { low: 'D3', high: 'G4', voices: 4, vel: 0.7 }) },
    spicA: { len: 128, spic: arp(halfList(A_H, { low: 'G3', high: 'G4', voices: 3 }), { rate: 1, len: 8, continue: true, order: [0, 1, 2, 1], vel: 0.6, accent: 0.18 }) },
    spicA2: { len: 128, spic: arp(halfList(A2_H, { low: 'G3', high: 'G4', voices: 3 }), { rate: 1, len: 8, continue: true, order: [0, 1, 2, 1], vel: 0.62, accent: 0.18 }) },
    choirA2: { len: 128, choir: chordEvents(power(A2_H), { low: 'D4', high: 'D5', voices: 3, vel: 0.62 }) },
    stabA2: { len: 128, stab: hits(A2_H, STAB_A, { low: 'G3', high: 'F4', voices: 3 }) },
    beatA: { kick: 'X...X...X...X.x.', snare: '....X.......X...', clap: '....x.......x...', hat: 'xgxgxgxgxgxgxgxg', ohat: '..x.......x.....' },
    beatA2: { kick: 'X...X...X..xX.x.', snare: '....X..g....X...', clap: '....x.......x...', hat: 'xgxgxgxgxgxgxgxg', ohat: '..x...x...x...x.', taiko: 'X.......X.......' },
    fillA: { kick: 'X...X...X...X...', snare: '....X.......X.xx', clap: '....x.......x...', hat: 'xgxgxgxgxgxg....', tom: '.*12 D3 Bb2 G2 D2' },
    fillA2: { kick: 'X...X...X.......', snare: '....X...........', roll: '.*8 x@0.5 x@0.6 x@0.65 x@0.7 x@0.75 x@0.8 x@0.9 X', hat: 'xgxgxgxg........', tom: '.*8 G3 . D3 . Bb2 Bb2 G2 G2' },
    crash1: { crash: 'X' },
    crashImp: { crash: 'X', impact: 'x' },
    rideA: { ride: 'x.x.x.x.x.x.x.x.' },
    taikoL: { taiko2: 'X.......x.x.....' },

    // ── B / B2 ──
    leadB: { lead: B_LO, lead2: transpose(B_LO, -12) },
    leadB2: { lead: transpose(B_LO, 12), lead2: B_LO, brass: B_LO },
    bassB: { len: 128, bass: bassFig(B_H, GALLOP) },
    bassB2: { len: 128, bass: bassFig(B_H, DRIVE) },
    padB: { len: 128, pad: chordEvents(B_TRI, { low: 'D3', high: 'Bb4', voices: 4, vel: 0.7 }) },
    stringsB: { len: 128, strings: chordEvents(B_TRI, { low: 'G3', high: 'G4', voices: 3, vel: 0.62 }) },
    arpB: { len: 128, arp: arp(halfList(B_H, { low: 'G3', high: 'G4', voices: 3 }), { rate: 1, len: 8, continue: true, oct: 2, order: [0, 1, 2, 3, 4, 5, 4, 3, 1, 2, 3, 4, 5, 3, 2, 1], vel: 0.66, accent: 0.16 }) },
    choirB2: { len: 128, choir: chordEvents(power(B_H), { low: 'D4', high: 'D5', voices: 3, vel: 0.62 }) },
    spicB2: { len: 128, spic: arp(halfList(B_H, { low: 'G3', high: 'G4', voices: 3 }), { rate: 1, len: 8, continue: true, order: [0, 1, 2, 1], vel: 0.58, accent: 0.16 }) },
    halfB: { kick: 'X.........x.....', snare: '........X.......', hat: 'xgxgxgxgxgxgxgxg', ohat: '......x.......x.', taiko: 'X.........x.....' },
    halfB2: { kick: 'X......x..x.....', snare: '........X.......', hat: 'xgxgxgxgxgxgxgxg', ohat: '......x.......x.', taiko: 'X......x..x.....' },
    halfFill: { kick: 'X.........x.....', snare: '........X...x.xx', hat: 'xgxgxgxgxgxg....', tom: '.*12 D3 Bb2 G2 D2' },

    // ── bridge ──
    brBass: { len: 128, bass: bassFig(BR_H, RIFF) },
    brSaw: { len: 128, saw: bassFig(BR_H, RIFF_ACC.map(([s, l, v]) => [s, 0, l, v * 0.9]), 24) },
    brChoir: { len: 128, chant: chordEvents(BR_H, { low: 'G3', high: 'D5', voices: 3, vel: 0.62 }) },
    brStab: { len: 128, stab: hits(BR_H, STAB_332, { low: 'G3', high: 'F4', voices: 3 }) },
    brArp: { len: 128, arp: brArp },
    brLead: { lead: SIREN },
    brPad: { len: 128, pad: chordEvents(BR_H, { low: 'D3', high: 'D5', voices: 3, vel: 0.6 }) },
    bu1: { kick: 'X.x.X.x.X.x.X.x.', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.', taiko: 'X...............' },
    bu2: { kick: 'X.x.X.x.X.x.X.x.', snare: 'x.x.x.x.x.x.x.x.', hat: 'x.x.x.x.x.x.x.x.', taiko: 'X.......X.......' },
    bu3: { kick: 'X.x.X.x.X.x.X.x.', roll: 'xxxxxxxxxxxxxxxx', hat: 'xxxxxxxxxxxxxxxx', taiko: 'X...X...X...X...' },
    bu4: { kick: 'X.X.X.X.X.X.X.X.', roll: 'xxxxxxxxxxxxrrRR', taiko: 'X.X.X.X.X.XXXXXX', tom: '.*8 G3 G3 D3 D3 Bb2 Bb2 G2 G2' },
    brFx: { len: 128, riser: [[64, 'x', 64, 0.85]], rev: [[104, 'x', 24, 0.9]], impact: [[0, 'x', 1, 0.7]] },

    // ── climax ──
    clxLead: { lead: HOOK_HI, lead2: transpose(HOOK_HI, -12), brass: transpose(HOOK_HI, -12) },
    clxBass: { len: 128, bass: bassFig(A2_H, DRIVE) },
    clxBeat: { kick: 'X...X...X...X..x', snare: '....X.......X...', clap: '....x.......x...', hat: 'xgxgxgxgxgxgxgxg', ohat: '..x...x...x...x.', taiko: 'X..x..X.X..x..X.' },
    clxFill: { kick: 'X...X...X...X...', snare: '....X.......X.XX', clap: '....x.......x...', hat: 'xgxgxgxgxgxg....', taiko: 'X..x..X.X.X.X.XX', tom: '.*12 G3 D3 Bb2 G2' },

    // ── turn ──
    turnChant: { chant: 'G3+D4+G4*8 Ab3+Eb4+Ab4*8 | G3+D4+G4*8 D3+A3+D4*8', lowbrass: 'G2+D3*8 C3+Eb3*8 | G2+D3*8 D2+A2+D3*8', sub: 'G1*16 | G1*8 D2*8' },
    turnBass: { len: 32, bass: bassFig('Gm,Ab/G Gm,D', GALLOP) },
    turnPad: { len: 32, pad: chordEvents('Gm,Ab Gm,D', { low: 'D3', high: 'D5', voices: 4, vel: 0.62 }) },
    turnDr: {
      kick: 'X.......X.......|X.......X...X.X.',
      taiko: 'X.......X.......|X.......X.X.XXXX',
      crash: 'X...............|................',
      roll: '.*16 .*8 x@0.5 x@0.6 x@0.65 x@0.7 x@0.8 x@0.85 x@0.9 X',
      tom: '.*16 .*8 G3 G3 D3 D3 Bb2 Bb2 G2 G2',
      rev: [[20, 'x', 12, 0.8]],
    },
  },

  sections: {
    intro: {
      bars: 4, chords: INTRO_H,
      play: ['introChant', 'introPad', 'introDr', 'introBass'],
      // bars 1–2 sit back under the WARNING siren, then everything swells into the riff
      auto: { 'bass.lpf': [[2, 300], [4, 5000]], 'pad.lpf': [[0, 700], [4, 4000]], 'chant.vol': [[0, 0.55], [2, 0.7], [4, 1]], 'lowbrass.vol': [[0, 0.6], [4, 1]], 'sub.vol': [[0, 0.6], [4, 1]] },
    },
    riff: {
      bars: 8, chords: RIFF_H,
      play: ['riffBass', 'riffSaw', 'riffChant', 'riffStab', 'riffPad', { p: 'crashImp', once: true },
        ['riffBeat', 'riffBeat', 'riffBeat', 'riffFill', 'riffBeat', 'riffBeat', 'riffBeat', 'riffFill2'], 'taikoL'],
    },
    A: {
      bars: 8, chords: A_H,
      play: ['leadA', 'bassA', 'padA', 'spicA', { p: 'crash1', once: true },
        ['beatA', 'beatA', 'beatA', 'fillA', 'beatA', 'beatA', 'beatA', 'fillA2'], 'taikoL'],
    },
    A2: {
      bars: 8, chords: A2_H,
      play: ['leadA2', 'bassA2', 'padA2', 'spicA2', 'choirA2', 'stabA2', ['crash1', null, null, null, 'crash1', null, null, null],
        ['beatA2', 'beatA2', 'beatA2', 'fillA', 'beatA2', 'beatA2', 'beatA2', 'fillA2'], 'rideA', 'taikoL'],
    },
    B: {
      bars: 8, chords: B_H,
      play: ['leadB', 'bassB', 'padB', 'stringsB', 'arpB', { p: 'crash1', once: true },
        ['halfB', 'halfB2', 'halfB', 'halfFill', 'halfB', 'halfB2', 'halfB', 'fillA2'], 'taikoL'],
      auto: { 'lead.cutoff': [[0, 2200]] },
    },
    B2: {
      bars: 8, chords: B_H,
      play: ['leadB2', 'bassB2', 'padB', 'choirB2', 'arpB', 'spicB2', ['crash1', null, null, null, 'crash1', null, null, null],
        ['beatA2', 'beatA2', 'beatA2', 'fillA', 'beatA2', 'beatA2', 'beatA2', 'fillA2'], 'rideA', 'taikoL'],
      auto: { 'lead.cutoff': [[0, 1800]] },
    },
    bridge: {
      bars: 8, chords: BR_H,
      play: ['brBass', 'brSaw', 'brChoir', 'brStab', 'brArp', 'brLead', 'brPad', 'brFx', { p: 'crash1', once: true },
        ['bu1', 'bu1', 'bu1', 'bu1', 'bu2', 'bu2', 'bu3', 'bu4']],
      auto: { 'arp.lpf': [[0, 1200], [8, 12000]], 'lead.cutoff': [[0, 1600], [8, 3200]] },
    },
    climax: {
      bars: 8, chords: A2_H,
      play: ['clxLead', 'clxBass', 'padA2', 'spicA2', 'choirA2', 'stabA2', { p: 'crashImp', once: true }, { p: 'crash1', at: 4, once: true },
        ['clxBeat', 'clxBeat', 'clxBeat', 'clxFill', 'clxBeat', 'clxBeat', 'clxBeat', 'fillA2'], 'rideA', 'taikoL'],
    },
    turn: {
      bars: 2, chords: TURN_H,
      play: ['turnChant', 'turnBass', 'turnPad', 'turnDr'],
    },
  },

  arrangement: ['intro', 'riff', 'A', 'A2', 'B', 'B2', 'bridge', 'climax', 'turn'],
  loop: 'riff',
};
