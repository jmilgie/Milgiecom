// Sector 5 — "Event Horizon". Epic cosmic trance, B minor, 138 BPM.
// The last sector before the Choir Heart. The track's riff is the Lancers call stretched to the
// octave (tonic → 5th → octave, then a falling 7–5–3) sequenced down an Andalusian bass; the
// breakdown returns to the title's key (D major) for the Lancers theme itself, and the climax
// lifts a whole step into E MAJOR for the theme in full triumph.
// Form (100 bars ≈ 174 s; loops from A, a 146 s cycle):
//   intro (8)    the singularity: glass pads bloom, choir "oo", star-glints; bells ask the Lancers
//                call in the minor (from B, then from E), riser
//   build (8)    filtered kick opens up, the riff wakes under a sweeping filter, offbeat bass
//   A (16)       THE HORIZON RIFF over i–VII–VI–VII | i–VII–VI–V (Bm A G A | Bm A G F#): gated
//                supersaws, trance kit; second half adds a soaring choir line + 16th arp
//   B (16)       iv–VI–III–VII (Em7 G D A): the Horizon melody on the lead; repeated with choir and
//                gated saws, cadencing on A = V of D …
//   break (16)   … D MAJOR (the title's key): the Lancers theme on electric piano, strings + choir,
//                no drums; then the build G A Bm – G A Bsus4 B with snare roll, riser, filtered
//                gated saws and the call teased twice (in D, then in E)
//   climax (16)  KEY CHANGE ↑ E major: the Lancers theme, lead + brass octaves, choir, gated saws;
//                second half = the B phrase, the call again and the bVI–bVII–I cadence (C–D–E)
//   climax2 (16) the relative minor (C# minor): riff at full power, then the Horizon melody high
//   turn (4)     B → G → A → F#sus4–F#: falls back into B minor (loop)
// Intensity: ≥0.7 ride, ≥0.8 lead doubled an octave down; <0.15 drops the kit.

import { arp, voiceLead, chordInfo } from '../music.js';
import { themeEvents, themeHarmony } from './motifs.js';

// ── harmony ──────────────────────────────────────────────────────────────────────────
const INTRO_H = 'Bm Bm Gmaj7 Gmaj7 Em7 Em7 F#sus4 F#';
const A_H = 'Bm A G A Bm A G F#';
const B_H = 'Em7 G D A Em7 G Asus4 A';
const THEME_H = themeHarmony('D');                    // 'D G Bm7 Asus4,A D G Em7,A D'
const BUILD2_H = 'G A Bm Bm G A Bsus4 B';             // → B = V of E (the climax key)
const CLX2_H = 'Bm7 G D A D G Bb,C D';                // B phrase, the call again, bVI–bVII–I
const TURN_H = 'G A F#sus4 F#';

const segs = (harm) => {
  const out = [];
  harm.split(' ').forEach((bar, b) => bar.split(',').forEach((c, i, a) => out.push({ c, s: b * 16 + (i * 16) / a.length, l: 16 / a.length })));
  return out;
};
function chordEvents(harm, opt) {
  const S = segs(harm);
  return voiceLead(S.map((x) => x.c), opt).map((n, i) => [S[i].s, n, S[i].l * (opt.legato ?? 1), opt.vel ?? 0.7]);
}
const halves = (harm) => harm.split(' ').flatMap((b) => { const c = b.split(','); return [c[0], c[c.length - 1]]; });
// bass roots between F#1 and F2
const root = (sym) => 30 + ((chordInfo(sym).root - 6 + 12) % 12);
function bassFig(harm, fig) {
  const ev = [];
  for (const { c, s, l } of segs(harm)) {
    const b0 = Math.floor(s / 16) * 16, o = s % 16;
    for (const [st, oc, len, v] of fig) if (st >= o && st < o + l) ev.push([b0 + st, root(c) + 12 * oc, len, v]);
  }
  return ev;
}
// gated supersaw chords: voiced chords × a 16th gate rhythm
function gated(harm, rhythm, opt) {
  const S = segs(harm), V = voiceLead(S.map((x) => x.c), opt), ev = [];
  const bars = harm.split(' ').length;
  for (let b = 0; b < bars; b++) for (const [st, l, v] of rhythm) {
    const at = b * 16 + st, i = S.findIndex((x) => at >= x.s && at < x.s + x.l);
    ev.push([at, V[i], l, v * (opt.vel ?? 0.8)]);
  }
  return ev;
}

// THE HORIZON RIFF — per bar, 3+3+2 | 3+3+2 sixteenths: root–5th–octave (the Lancers call
// expanded) on the first half-bar chord, then 7th–5th–3rd falling on the second. The 7th is the
// diatonic one (B natural minor = D major notes); chords outside the key use the octave 3rd
// instead. `climb` bars end rising (9th–3rd–5th, an octave up) into the next phrase.
const KEY_PCS = [11, 1, 2, 4, 6, 7, 9];
function riff(harm, climbBars = [], vel = 0.85) {
  const ev = [];
  harm.split(' ').forEach((bar, b) => {
    const parts = bar.split(','), c1 = chordInfo(parts[0]), c2 = chordInfo(parts[parts.length - 1]);
    const r1 = 66 + ((c1.root - 6 + 12) % 12), r2 = 66 + ((c2.root - 6 + 12) % 12);   // roots F#4..F5
    const b0 = b * 16;
    ev.push([b0, r1, 2.6, vel], [b0 + 3, r1 + c1.iv[2], 2.6, vel * 0.8], [b0 + 6, r1 + 12, 1.8, vel * 0.9]);
    let tail;
    if (climbBars.includes(b)) tail = [r2 + 14, r2 + 12 + c2.iv[1], r2 + 12 + c2.iv[2]];
    else {
      const k = KEY_PCS.indexOf(c2.root), sev = k >= 0 ? (KEY_PCS[(k + 6) % 7] - c2.root + 12) % 12 : null;
      tail = [sev != null ? r2 + sev : r2 + 12 + c2.iv[1], r2 + c2.iv[2], r2 + c2.iv[1]];
    }
    ev.push([b0 + 8, tail[0], 2.6, vel * 0.95], [b0 + 11, tail[1], 2.6, vel * 0.8], [b0 + 14, tail[2], 1.8, vel * 0.88]);
  });
  return ev;
}

// ── rhythm cells ─────────────────────────────────────────────────────────────────────
const OFFBASS = [];   // offbeat 8th + the octave on the following 16th ("..xX" per beat)
for (let b = 0; b < 4; b++) OFFBASS.push([b * 4 + 2, 0, 0.9, 0.95], [b * 4 + 3, 1, 0.7, 0.72]);
const OFF8 = [2, 6, 10, 14].map((s) => [s, 0, 1.4, 0.85]);
const GATE = [[0, 0.7, 1], [1, 0.6, 0.7], [3, 0.7, 0.86], [4, 0.6, 0.7], [6, 0.7, 0.82], [8, 0.7, 0.96], [9, 0.6, 0.7], [11, 0.7, 0.86], [12, 0.6, 0.7], [14, 0.7, 0.82]];

// ── melodies ─────────────────────────────────────────────────────────────────────────
// The Horizon melody (8ths) over Em7 G D A | Em7 G Asus4 A
const HMEL = 'E5 - - F#5 - G5 - B5 | - - - A5 - G5 - F#5 | - - - - - - E5 F#5 | E5 - - - - - - - | ' +
  'E5 - - F#5 - G5 - B5 | - - - D6 - B5 - A5 | - - - - - B5 D6 - | C#6 - - - - - - -';
const CHOIR_LINE = 'F#5 E5 D5 E5 F#5 A5 B5 A#5';    // A section, 2nd half (whole notes)

// Lancers theme (motifs.js) in D; the climax plays it +2 (E major)
const inRange = (evs, a, b, d = 0) => evs.filter((e) => e[0] >= a && e[0] < b).map(([s, n, l, v]) => [s + d, n, l, v]);
const themeA = (tonic, vel) => themeEvents({ tonic, vel });
const themeClimax = (tonic, vel) => [
  ...themeA(tonic, vel),                                                        // bars 1–8
  ...themeEvents({ tonic, part: 'b', start: 128, vel }),                        // bars 9–12: the B phrase
  ...inRange(themeA(tonic, vel), 64, 96, 128),                                  // bars 13–14: the call again
  ...themeEvents({ tonic, part: 'cadence', start: 224, vel: Math.min(1, vel + 0.08) }),   // 15–16: bVI–bVII–I
];
// the call as a minor-key question (intro bells, augmented) and as teases in the build
const callMinor = (tonic, start, vel) => themeEvents({ tonic, scale: 'minor', part: 'call', pickup: true, aug: 2, start, vel });

export default {
  title: 'Event Horizon',
  bpm: 138,
  key: 'B', scale: 'minor',
  gain: 0.85,
  delay: { beats: 0.75, feedback: 0.42, lp: 4600, hp: 380 },
  duck: { release: 0.2 },
  seed: 23,

  instruments: {
    hBass: { base: 'bass', cutoff: 560, env: 2.2, fd: 0.14, q: 3, drive: 0.4, sub: 0.32, d: 0.16, s: 0.62 },
    hGate: { base: 'padBright', a: 0.003, d: 0.09, s: 0.72, r: 0.045 },        // play-time only: shares padBright
    hRiff: { base: 'lead', wave: 'saw', voices: 5, detune: 20, cutoff: 1900, kt: 0.4, q: 2.5, env: 1.7, fa: 0.003, fd: 0.22, vib: 0, a: 0.002, d: 0.25, s: 0.55, r: 0.12, glide: 0, vol: 0.55 },
    hLead: { base: 'leadBright', voices: 3, detune: 13, cutoff: 3000, kt: 0.3, q: 2, env: 1.1, vib: 17, vibDelay: 0.24, glide: 0.05, r: 0.28 },
    hVast: { base: 'padGlass', r: 1.1 },                                           // play-time: shorter tails keep the voice count low
    hPad: { base: 'pad', r: 0.9 },
    hChoir: { base: 'choir', r: 1.0 },
    hOo: { base: 'choirOo', r: 0.9 },
    hArp: { base: 'pluck', cutoff: 900, env: 3.4, decay: 0.18, amp: 0.5, q: 3 },
  },

  channels: {
    kick: { gain: 0.38, sidechain: true, lpf: 20000, layer: { min: 0.15 } },
    clap: { gain: 0.7, reverb: 0.22, poly: 2, layer: { min: 0.15 } },
    snare: { inst: 'snareTight', gain: 0.34, reverb: 0.2, poly: 2 },
    hat: { gain: 0.34, pan: 0.22, human: { t: 0.002, v: 0.12 }, poly: 2, layer: { min: 0.15 } },
    ohat: { gain: 0.38, pan: -0.18, poly: 2, layer: { min: 0.15 } },
    shaker: { gain: 0.3, pan: 0.32, human: { t: 0.003, v: 0.15 }, poly: 2, layer: { min: 0.15 } },
    ride: { gain: 0.2, pan: 0.3, poly: 1, layer: { min: 0.7 } },
    crash: { gain: 0.4, reverb: 0.18, pan: -0.15, poly: 1 },
    rev: { inst: 'revcym', gain: 0.42 },
    riser: { gain: 0.42, reverb: 0.3 },
    down: { inst: 'downlifter', gain: 0.38, reverb: 0.4 },
    impact: { gain: 0.45, reverb: 0.3 },
    sub: { gain: 0.5 },
    bass: { inst: 'hBass', gain: 0.72, duck: 0.55, lpf: 20000 },
    vast: { inst: 'hVast', gain: 0.3, reverb: 0.45, duck: 0.35, lpf: 20000, poly: 7 },
    pad: { inst: 'hPad', gain: 0.24, reverb: 0.3, duck: 0.55, lpf: 20000, poly: 6 },
    gate: { inst: 'hGate', gain: 0.46, reverb: 0.2, delay: 0.1, duck: 0.4, lpf: 20000, poly: 8 },
    strings: { gain: 0.36, reverb: 0.4, pan: 0.16, duck: 0.25, poly: 6 },
    choirOo: { inst: 'hOo', gain: 0.24, reverb: 0.55, duck: 0.2, poly: 5 },
    choir: { inst: 'hChoir', gain: 0.24, reverb: 0.5, duck: 0.25, poly: 5 },
    brass: { gain: 0.62, reverb: 0.3, pan: -0.06, poly: 2 },
    riff: { inst: 'hRiff', gain: 1.2, delay: 0.3, reverb: 0.2, pan: 0.08, duck: 0.3, lpf: 20000 },
    arp: { inst: 'hArp', gain: 0.32, delay: 0.3, reverb: 0.18, pan: -0.28, duck: 0.35, lpf: 20000, poly: 3 },
    keys: { gain: 0.42, reverb: 0.4, delay: 0.18, poly: 4 },
    keysL: { inst: 'keys', gain: 0.28, reverb: 0.4, pan: -0.15, poly: 4 },
    glass: { gain: 0.26, reverb: 0.55, delay: 0.35, pan: 0.3, poly: 4 },
    lead: { inst: 'hLead', gain: 0.74, reverb: 0.24, delay: 0.22 },
    lead2: { inst: 'hLead', gain: 0.36, reverb: 0.16, layer: { min: 0.8 } },
  },

  patterns: {
    // ── INTRO: the singularity ──
    introVast: { len: 128, vast: chordEvents(INTRO_H, { low: 'F#3', high: 'D5', voices: 4, vel: 0.7 }) },
    introSub: { step: 16, sub: 'B1 - G1 - E1 - F#1 -' },
    introOo: { len: 96, choirOo: chordEvents('Gmaj7 Gmaj7 Em7 Em7 F#sus4 F#', { low: 'D4', high: 'D5', voices: 3, rootless: true, vel: 0.55 }) },
    introBells: { len: 128, glass: [...callMinor('B4', 8, 0.62), ...callMinor('E5', 72, 0.58)] },
    introStars: { len: 96, glass: arp(voiceLead(['Bm', 'Gmaj7', 'Gmaj7', 'Em7', 'Em7', 'F#sus4'], { low: 'B5', high: 'B6', voices: 4 }), { rate: 3, len: 16, order: 'random', gate: 0.5, vel: 0.26, accent: 0, seed: 9 }).filter((e, i) => i % 3 !== 1) },
    introFx: { len: 128, impact: [[0, 'x', 1, 0.85]], riser: [[96, 'x', 32, 0.72]], rev: [[112, 'x', 16, 0.8]] },

    // ── BUILD ──
    kickOnly: { kick: 'X...X...X...X...' },
    bldRiff: { len: 128, riff: riff(A_H, [3]) },
    bldVast: { len: 128, vast: chordEvents(A_H, { low: 'F#3', high: 'D5', voices: 4, vel: 0.6 }) },
    bldBass: { len: 64, bass: bassFig('Bm A G F#', OFF8) },
    bldDrums: { len: 64, hat: '.g.o.g.o.g.o.g.o .g.o.g.o.g.o.g.o .g.o.g.o.g.o.g.o .g.o.g.o.g.o.g.o', clap: '....x.......x... ....x.......x... ....x.......x... ....x...........' },
    bldRoll: { len: 64, snare: '.*32 x@0.3 . . . x@0.35 . . . x@0.4 . x@0.45 . x@0.5 . x@0.55 . x@0.55 x@0.6 x@0.6 x@0.65 x@0.7 x@0.72 x@0.75 x@0.8 x@0.8 x@0.85 x@0.88 x@0.9 x@0.92 x@0.95 X X' },
    bldFx: { len: 128, riser: [[64, 'x', 64, 0.8]], rev: [[112, 'x', 16, 0.85]] },

    // ── A: the Horizon riff ──
    riffA: { len: 128, riff: riff(A_H, [3]) },
    gateA: { len: 128, gate: gated(A_H, GATE, { low: 'F#3', high: 'D5', voices: 4, vel: 0.8 }) },
    padA: { len: 128, pad: chordEvents(A_H, { low: 'D3', high: 'B4', voices: 4, vel: 0.62 }) },
    bassA: { len: 128, bass: bassFig(A_H, OFFBASS) },
    choirA: { step: 16, choir: CHOIR_LINE, vel: 0.66 },
    arpA: { len: 128, arp: arp(voiceLead(A_H.split(' '), { low: 'F#4', high: 'E5', voices: 3 }), { rate: 1, oct: 2, order: [0, 1, 2, 3, 4, 5, 4, 3, 1, 2, 3, 4, 5, 4, 3, 2], vel: 0.6, accent: 0.18 }) },
    dA: { kick: 'X...X...X...X...', clap: '....x.......x...', hat: '.gxg.gxg.gxg.gxg', ohat: '..x...x...x...x.', shaker: 'gogxgogxgogxgogx' },
    dRide: { ride: 'x.x.x.x.x.x.x.x.' },
    dFill: { kick: 'X...X...X...X...', clap: '....x.......x...', hat: '.g.o.g.o........', ohat: '..x...x.........', snare: '........x.x.xxxx' },
    dFill2: { kick: 'X...X...X.......', clap: '....x...........', ohat: '..x...x.........', snare: '. . . . . . . . x@0.5 x@0.55 x@0.6 x@0.65 x@0.7 x@0.8 x@0.9 X' },
    crash1: { crash: 'X' },

    // ── B: the Horizon melody ──
    melB: { step: 2, lead: HMEL, lead2: HMEL },                // high intensity: a unison double (an octave down would rub the pads)
    choirB: { step: 2, choir: HMEL, vel: 0.6 },                 // vocal unison with the lead
    gateB: { len: 128, gate: gated(B_H, GATE, { low: 'F#3', high: 'D5', voices: 4, vel: 0.8 }) },
    padB: { len: 128, pad: chordEvents(B_H, { low: 'D3', high: 'B4', voices: 4, vel: 0.62 }) },
    vastB: { len: 128, vast: chordEvents(B_H, { low: 'F#3', high: 'D5', voices: 4, vel: 0.6 }) },
    bassB: { len: 128, bass: bassFig(B_H, OFFBASS) },
    arpB: { len: 128, arp: arp(voiceLead(halves(B_H), { low: 'F#4', high: 'E5', voices: 3 }), { rate: 1, len: 8, continue: true, oct: 2, order: [0, 2, 1, 3, 2, 4, 3, 5], vel: 0.58, accent: 0.18 }) },
    dB: { kick: 'X...X...X...X...', clap: '....x.......x...', hat: '.g.o.g.o.g.o.g.o' },
    fxB: { len: 128, down: [[112, 'x', 16, 0.55]], rev: [[120, 'x', 8, 0.7]] },   // bars 9–16 only

    // ── BREAK: the Lancers theme in D major (the title's key) ──
    keysTheme: { len: 128, keys: themeA('D5', 0.72) },
    keysComp: { len: 128, keysL: arp(voiceLead(halves(THEME_H), { low: 'F#3', high: 'D5', voices: 3 }), { rate: 2, len: 8, continue: true, order: [0, 1, 2, 1], vel: 0.5, accent: 0.1 }) },
    brkStrings: { len: 128, strings: chordEvents(THEME_H, { low: 'F#3', high: 'D5', voices: 4, vel: 0.55 }) },   // below the melody
    brkOo: { len: 128, choirOo: chordEvents(THEME_H, { low: 'D4', high: 'D5', voices: 3, rootless: true, vel: 0.5 }) },
    brkVast: { len: 128, vast: chordEvents(THEME_H, { low: 'F#3', high: 'D5', voices: 4, vel: 0.55 }) },
    brkSub: { len: 128, sub: segs(THEME_H).map(({ c, s, l }) => [s, root(c), l, 0.7]) },
    brkStars: { len: 128, glass: arp(voiceLead(THEME_H.split(' ').map((b) => b.split(',')[0]), { low: 'A5', high: 'A6', voices: 3 }), { rate: 3, len: 16, order: 'random', gate: 0.5, vel: 0.22, accent: 0, seed: 4 }).filter((e, i) => i % 2 === 0) },
    // build 2: G A Bm Bm G A Bsus4 B
    b2Gate: { len: 128, gate: gated(BUILD2_H, GATE, { low: 'F#3', high: 'D#5', voices: 4, vel: 0.78 }) },
    b2Vast: { len: 128, vast: chordEvents(BUILD2_H, { low: 'F#3', high: 'D#5', voices: 4, vel: 0.62 }) },
    b2Choir: { len: 128, choir: chordEvents(BUILD2_H, { low: 'F#4', high: 'E5', voices: 3, rootless: true, vel: 0.55 }) },
    b2Bass: { len: 64, bass: bassFig('G A Bsus4 B', OFF8) },
    b2Lead: {
      len: 128,
      lead: [...themeEvents({ tonic: 'D5', part: 'call', pickup: true, start: 32, vel: 0.72 }),
        ...themeEvents({ tonic: 'E5', part: 'call', pickup: true, start: 96, vel: 0.82 }), [126, 'B4', 2, 0.85]],
      lead2: [...themeEvents({ tonic: 'D4', part: 'call', pickup: true, start: 32, vel: 0.72 }),
        ...themeEvents({ tonic: 'E4', part: 'call', pickup: true, start: 96, vel: 0.82 }), [126, 'B3', 2, 0.85]],
    },
    b2Drums: {
      len: 128,
      snare: '................ ................ x...x...x...x... x...x...x...x... x.x.x.x.x.x.x.x. x.x.x.x.x.x.x.x. xxxxxxxxxxxxxxxx xxxxxxxxrrrrRRRR',
      kick: '................ ................ ................ ................ X...X...X...X... X...X...X...X... X...X...X...X... ................',
      hat: '................ ................ ................ ................ .g.o.g.o.g.o.g.o .g.o.g.o.g.o.g.o .g.o.g.o.g.o.g.o ................',
    },
    b2Fx: { len: 128, riser: [[0, 'x', 128, 0.85]], rev: [[104, 'x', 24, 0.9]] },

    // ── CLIMAX (written in D, played +2 = E major) ──
    clxLead: { len: 256, lead: themeClimax('D5', 0.9), lead2: themeClimax('D4', 0.9) },
    clxBrass: { len: 256, brass: themeClimax('D4', 0.8) },
    clxChoir: { len: 256, choir: chordEvents(THEME_H + ' ' + CLX2_H, { low: 'F#4', high: 'D5', voices: 3, rootless: true, vel: 0.64 }) },
    clxGate: { len: 256, gate: gated(THEME_H + ' ' + CLX2_H, GATE, { low: 'F#3', high: 'D5', voices: 4, vel: 0.85 }) },
    clxPad: { len: 256, pad: chordEvents(THEME_H + ' ' + CLX2_H, { low: 'D3', high: 'B4', voices: 4, vel: 0.62 }) },
    clxBass: { len: 256, bass: bassFig(THEME_H + ' ' + CLX2_H, OFFBASS) },
    clxArp: { len: 256, arp: arp(voiceLead(halves(THEME_H + ' ' + CLX2_H), { low: 'F#4', high: 'E5', voices: 3 }), { rate: 1, len: 8, continue: true, oct: 2, order: [0, 1, 2, 3, 4, 5, 4, 3], vel: 0.56, accent: 0.18 }) },
    clxFx: { len: 256, impact: [[0, 'x', 1, 0.95]], crash: [[0, 'x', 1, 1], [64, 'x', 1, 0.85], [128, 'x', 1, 0.95], [192, 'x', 1, 0.85]], rev: [[248, 'x', 8, 0.8]] },

    // ── CLIMAX 2 (C# minor): riff at full power, then the Horizon melody ──
    c2Choir: { step: 16, choir: CHOIR_LINE, vel: 0.7 },
    c2Fx: { len: 256, crash: [[0, 'x', 1, 0.95], [128, 'x', 1, 0.95]], down: [[240, 'x', 16, 0.5]] },

    // ── TURN: B → G → A → F# → (Bm) ──
    turnAll: {
      len: 64,
      vast: chordEvents(TURN_H, { low: 'F#3', high: 'D5', voices: 4, vel: 0.62 }),
      gate: gated(TURN_H, GATE, { low: 'F#3', high: 'D5', voices: 4, vel: 0.7 }),
      riff: riff(TURN_H, [1], 0.8),
      bass: bassFig(TURN_H, OFFBASS),
      lead: [[0, 'B5', 14, 0.75], [16, 'C#6', 14, 0.72], [32, 'B5', 16, 0.7], [48, 'A#5', 14, 0.7]],
      choir: chordEvents(TURN_H, { low: 'F#4', high: 'D5', voices: 3, rootless: true, vel: 0.55 }),
      kick: 'X...X...X...X... X...X...X...X... X...X...X...X... X...X...X.......',
      clap: '....x.......x... ....x.......x... ....x.......x... ....x...........',
      ohat: '..x...x...x...x. ..x...x...x...x. ..x...x...x...x. ..x...x.........',
      snare: '................ ................ ................ ........x.x.xxxx',
      rev: [[56, 'x', 8, 0.75]],
    },
  },

  sections: {
    intro: {
      bars: 8, chords: INTRO_H,
      play: ['introVast', 'introSub', { p: 'introOo', at: 2 }, 'introBells', { p: 'introStars', at: 1 }, 'introFx'],
      auto: { 'vast.lpf': [[0, 500], [6, 5000], [8, 7000]] },
    },
    build: {
      bars: 8, chords: A_H,
      play: ['kickOnly', 'bldRiff', 'bldVast', { p: 'bldBass', at: 4 }, { p: 'bldDrums', at: 4 }, { p: 'bldRoll', at: 4, once: true }, 'bldFx'],
      auto: { 'kick.lpf': [[0, 180], [4, 900], [8, 20000]], 'riff.lpf': [[0, 500], [8, 7000]], 'bass.lpf': [[4, 300], [8, 2400]] },
    },
    A: {
      bars: 16, chords: A_H,
      play: ['riffA', 'gateA', 'padA', 'bassA', { p: 'choirA', at: 8 }, { p: 'arpA', at: 8 }, 'dRide',
        ['crash1', null, null, null, null, null, null, null],
        ['dA', 'dA', 'dA', 'dA', 'dA', 'dA', 'dA', 'dFill', 'dA', 'dA', 'dA', 'dA', 'dA', 'dA', 'dA', 'dFill2']],
      auto: { 'gate.lpf': [[0, 2400], [8, 9000]] },
    },
    B: {
      bars: 16, chords: B_H,
      play: ['melB', { p: 'choirB', at: 8 }, { p: 'gateB', at: 8 }, 'padB', 'vastB', 'bassB', 'arpB', { p: 'fxB', at: 8 }, 'dRide',
        ['crash1', null, null, null, null, null, null, null],
        ['dB', 'dB', 'dB', 'dB', 'dB', 'dB', 'dB', 'dFill', 'dA', 'dA', 'dA', 'dA', 'dA', 'dA', 'dA', 'dFill2']],
      auto: { 'arp.lpf': [[0, 1600], [8, 6000]] },
    },
    break: {
      bars: 16, chords: THEME_H + ' ' + BUILD2_H,
      play: [{ p: 'keysTheme', once: true }, { p: 'keysComp', until: 8 }, { p: 'brkStrings', until: 8 }, { p: 'brkOo', until: 8 }, { p: 'brkVast', until: 8 },
        { p: 'brkSub', until: 8 }, { p: 'brkStars', until: 8 }, { p: 'crash1', once: true },
        { p: 'b2Gate', at: 8 }, { p: 'b2Vast', at: 8 }, { p: 'b2Choir', at: 8 }, { p: 'b2Bass', at: 12 }, { p: 'b2Lead', at: 8 }, { p: 'b2Drums', at: 8 }, { p: 'b2Fx', at: 8 }],
      auto: { 'vast.lpf': [[0, 900], [8, 3000], [16, 9000]], 'gate.lpf': [[8, 350], [16, 9000]], 'bass.lpf': [[12, 300], [16, 2400]] },
    },
    climax: {
      bars: 16, chords: THEME_H + ' ' + CLX2_H,
      play: ['clxLead', 'clxBrass', 'clxChoir', 'clxGate', 'clxPad', 'clxBass', 'clxArp', 'clxFx', 'dRide',
        ['dA', 'dA', 'dA', 'dA', 'dA', 'dA', 'dA', 'dFill', 'dA', 'dA', 'dA', 'dA', 'dA', 'dA', 'dA', 'dFill2']],
    },
    climax2: {
      bars: 16, chords: A_H + ' ' + B_H,
      play: [{ p: 'riffA', until: 8 }, { p: 'gateA', until: 8 }, { p: 'c2Choir', until: 8 }, { p: 'padA', until: 8 }, { p: 'bassA', until: 8 }, { p: 'arpA', until: 8 },
        { p: 'melB', at: 8 }, { p: 'choirB', at: 8 }, { p: 'gateB', at: 8 }, { p: 'padB', at: 8 }, { p: 'bassB', at: 8 }, { p: 'arpB', at: 8 },
        'c2Fx', 'dRide',
        ['dA', 'dA', 'dA', 'dA', 'dA', 'dA', 'dA', 'dFill', 'dA', 'dA', 'dA', 'dA', 'dA', 'dA', 'dA', 'dFill2']],
    },
    turn: {
      bars: 4, chords: TURN_H,
      play: ['turnAll'],
    },
  },

  arrangement: ['intro', 'build', 'A', 'B', 'break', { s: 'climax', tr: 2 }, { s: 'climax2', tr: 2 }, 'turn'],
  loop: 'A',
};
