// "Heart of the Choir" — the final boss. Dark choir, organ and relentless drums in D minor,
// 144 BPM, transforming into a triumphant D-major reprise of the Lancers theme.
// Leitmotifs: the Choir motif 1–b2–1–5 (D–Eb–D–A, i–bII–i–V; also the spine of "Choir Assault")
// and the Lancers theme (motifs.js) — first remembered in the minor, then reclaimed in the title's
// own key, D major. At the very end the Choir motif itself is redeemed in the major (1–2–1–5).
// Form (88 bars ≈ 147 s; the whole song loops — after the triumph the Heart re-awakens):
//   intro (8)    the Heart awakens: organ + choir intone the motif two bars per note (Dm, Eb/D,
//                Dm, A) over a D pedal, heartbeat taiko, tolling bell; bars 1–2 stay sparse for
//                the WARNING siren; organ toccata flourish cascades into…
//   A (16)       THE HEART: the choir's hymn (the motif grown into a melody) over a 16th organ
//                ostinato, 8th-octave bass, heartbeat taiko inside the kit; brass joins at bar 9
//   B (16)       FURY: a fast minor melody on the lead, the choir chants 3+3+2 stabs (as in
//                "Choir Assault"), 16th bass
//   C (8)        TOCCATA: the organ takes the lead over a chromatic lament bass
//                (D C# C B Bb A G A: Dm A/C# F/C G/B Gm/Bb Dm/A Eb/G A7 — Neapolitan sixth → V)
//   break (8)    REMEMBER: drums fall away to the heartbeat; bells and strings pass the Lancers
//                call around in D minor, F major, Bb major and G minor
//   build (8)    RISE: Bb–C–Bb–C (the Lancers' own cadence chords), Gm–A, climbing calls, snare
//                build, riser… Dsus4 → D MAJOR
//   reprise (16) THE LANCERS THEME in D major: lead, brass, choir, organ, strings counter-melody;
//                second statement ends bVI–bVII–I (Bb–C–D) rising in thirds
//   finale (8)   the Choir motif redeemed (D–E–D–A over D, E/D, D, A), then Bb–C–D arpeggios
//                soaring to the top; a final hit rings out → the intro's D MINOR (the loop)
// Sections `reprise` and `finale` carry analysis-only `key`/`scale` fields (D major) for the
// harmony checker in dev/music-c.html; the engine ignores them.
// Intensity: ≥0.7 ride, ≥0.75 a second taiko, ≥0.8 lead doubled an octave down (square).

import { arp, voiceLead, chordInfo, transpose } from '../music.js';
import { themeEvents, themeHarmony } from './motifs.js';

// ── harmony ──────────────────────────────────────────────────────────────────────────
const INTRO_H = 'Dm Dm Eb/D Eb/D Dm Dm A7 A7';
const A_H = 'Dm Eb/D Dm A Bb Gm Eb A7 Dm Eb/D Dm A Bb Gm A7 Dm';
const B_H = 'Gm Dm Bb A Gm Dm Eb A Gm Dm Bb A Gm Bb A7 Dm';
const C_H = 'Dm A/C# F/C G/B Gm/Bb Dm/A Eb/G A7';
const BRK_H = 'Dm Gm F Bb Bb Eb Gm A';
const BUILD_H = 'Bb C Bb C Gm A Bb,C Dsus4,D';
const THEME_H = themeHarmony('D');                      // 'D G Bm7 Asus4,A D G Em7,A D'
const REP_H = THEME_H + ' D G Bm7 Asus4,A D G Bb,C D';
const FIN_H = 'D E/D D A Bb C D D';

const split = (harm) => { const f = [], at = []; harm.split(' ').forEach((bar, b) => bar.split(',').forEach((c, i, a) => { f.push(c); at.push([b * 16 + (i * 16) / a.length, 16 / a.length]); })); return [f, at]; };
function chordEvents(harm, opt) {
  const [f, at] = split(harm);
  return voiceLead(f, opt).map((n, i) => [at[i][0], n, at[i][1] * (opt.legato ?? 1), opt.vel ?? 0.7]);
}
function halfList(harm, opt) {
  const f = [];
  harm.split(' ').forEach((bar) => { const c = bar.split(','); f.push(c[0], c[Math.min(c.length - 1, Math.floor(c.length / 2))]); });
  return voiceLead(f, opt);
}
// bass note (slash bass wins → pedals and the lament line) in A1..G#2
const root = (sym) => { const c = chordInfo(sym); return 33 + (((c.bass ?? c.root) - 9 + 12) % 12); };
function bassFig(harm, fig, base = 0) {
  const [f, at] = split(harm);
  const ev = [];
  f.forEach((c, i) => {
    const [s0, len] = at[i];
    for (const [st, iv, l, v] of fig) if (st >= s0 % 16 && st < (s0 % 16) + len) ev.push([Math.floor(s0 / 16) * 16 + st, root(c) + base + iv, l, v]);
  });
  return ev;
}
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
const cut = (evs, from, to) => evs.filter((e) => e[0] >= from && e[0] < to);

// ── rhythm figures ───────────────────────────────────────────────────────────────────
const OCT8 = [];      // relentless 8th octaves
for (let b = 0; b < 8; b++) OCT8.push([b * 2, (b % 2) * 12, 1.8, b % 2 ? 0.72 : b % 4 === 0 ? 0.98 : 0.88]);
const DRIVE = [];     // 16ths: root root OCT root
for (let b = 0; b < 4; b++) DRIVE.push([b * 4, 0, 0.9, 0.95], [b * 4 + 1, 0, 0.9, 0.66], [b * 4 + 2, 12, 0.9, 0.84], [b * 4 + 3, 0, 0.9, 0.7]);
const CHANT_332 = [[0, 1.5, 1], [3, 1.5, 0.78], [6, 1.5, 0.88], [8, 1.5, 0.95], [11, 1.5, 0.78], [14, 1.5, 0.85]];

// ── melodies (16th units) ─────────────────────────────────────────────────────────────
// A: the Heart's hymn — the motif (D, Eb, D, then the leading tone) grown into 16 bars
const HYMN =
  'D5*16 | Eb5*12 D5*4 | D5*8 A4*8 | C#5*16 | D5*8 F5*8 | G5*12 F5*4 | Eb5*8 Bb4*8 | A4*8 C#5*4 E5*4 | ' +
  'D5*16 | Eb5*12 D5*4 | D5*8 A4*8 | C#5*16 | D5*8 F5*8 | G5*8 Bb5*8 | A5*8 G5*4 E5*4 | F5*4 E5*4 D5*8';
// B: fury — a turning figure that climbs a register each phrase
const FURY =
  'G5*4 F5*2 G5*2 Bb5*4 A5*2 G5*2 | A5*6 F5*2 D5*8 | F5*4 E5*2 F5*2 Bb5*4 A5*2 F5*2 | E5*6 C#5*2 A4*8 | ' +
  'G5*4 F5*2 G5*2 Bb5*4 C6*2 D6*2 | F6*6 E6*2 D6*8 | Eb6*4 D6*2 C6*2 Bb5*4 G5*4 | A5*6 E5*2 C#5*4 E5*4 | ' +
  'G5*4 F5*2 G5*2 Bb5*4 A5*2 G5*2 | A5*6 F5*2 D5*8 | F5*4 E5*2 F5*2 Bb5*4 A5*2 F5*2 | E5*6 C#5*2 A4*8 | ' +
  'G5*4 F5*2 G5*2 Bb5*4 C6*2 D6*2 | F6*4 D6*4 Bb5*4 F5*4 | E6*4 C#6*4 A5*4 G5*4 | D6*12 .*4';
// intro flourish (organ): a cascade of falling 4-note groups over A7, then a run up A harmonic minor
const FLOURISH = 'A5 G5 F5 E5 F5 E5 D5 C#5 D5 C#5 Bb4 A4 Bb4 A4 G4 F4 | A3 Bb3 C#4 D4 E4 F4 G4 A4 Bb4 C#5 D5 E5 F5 G5 A5*2';
// C: common-tone line over the lament (strings)
const LAMENT_TOP = 'A5*16 | A5*16 | A5*16 | G5*16 | G5*16 | F5*16 | G5*16 | E5*16';
// build: call-shaped gestures (6 + 10) climbing chord by chord
const RISE = 'D5*6 F5*10 | E5*6 G5*10 | F5*6 Bb5*10 | G5*6 C6*10 | Bb5*6 D6*10 | C#6*6 E6*10 | D6*8 E6*8 | D6*8 F#6*8';
// reprise: the theme twice; the second statement ends with the bVI–bVII–I cadence
const stmt1 = themeEvents({ tonic: 'D5', vel: 0.86 }).map((e) => (e[0] === 112 ? [112, e[1], 14, e[3]] : e));
const stmt2 = cut(themeEvents({ tonic: 'D5', pickup: true, start: 128, vel: 0.92 }), 120, 224).concat(themeEvents({ tonic: 'D5', part: 'cadence', start: 224, vel: 0.98 }));
const REP_LEAD = [...stmt1, ...stmt2];
const REP_BRASS2 = cut(themeEvents({ tonic: 'D4', start: 128, vel: 0.78 }), 128, 224).concat([
  [224, 'Bb3+D4+F4', 6, 0.9], [230, 'Bb3+D4+F4', 2, 0.8], [232, 'C4+E4+G4', 8, 0.95], [240, 'D4+F#4+A4+D5', 16, 1],
]);
const COUNTER1 = 'A4 - F#4 - | G4 - B4 - | A4 - - F#4 | E4 - C#4 - | D4 - F#4 - | G4 - B4 D5 | B4 - C#5 - | D5 - - -';   // (the title's counter-line)
const DESCANT2 = 'F#5*16 | G5*16 | F#5*16 | E5*16 | F#5*16 | G5*8 B5*8 | D6*8 E6*8 | F#6*16';
// finale: the motif in the major on top of the choir; the lead soars in arpeggios
const FIN_CHOIR = 'F#4+A4+D5*16 | G#4+B4+E5*16 | F#4+A4+D5*16 | A4+C#5+E5+A5*16 | F4+Bb4+D5*16 | G4+C5+E5*16 | A4+D5+F#5*16 | A4+D5+F#5*4 .*12';
const FIN_LEAD = 'D5*6 A5*10 | B5*6 G#5*2 E5*8 | A5*6 D6*10 | C#6*6 A5*2 E5*8 | F5*6 Bb5*2 D6*8 | G5*6 C6*2 E6*8 | A5*6 D6*2 F#6*8 | D6*12 .*4';

export default {
  title: 'Heart of the Choir',
  bpm: 144,
  key: 'D', scale: 'minor',
  gain: 0.78,
  reverb: 1,
  delay: { beats: 0.75, feedback: 0.32, lp: 3600, hp: 450 },
  duck: { release: 0.18 },
  seed: 31,

  instruments: {
    fBass: { base: 'bass', env: 2.8, fd: 0.12, cutoff: 460, q: 4, drive: 0.45, d: 0.14, s: 0.6, r: 0.06 },   // aurora's bass render
    fArp: { base: 'pluck', cutoff: 950, env: 3.6, decay: 0.2, amp: 0.55, q: 4 },                             // aurora's arp render
    fBell: { base: 'bell', decay: 3.2, index: 2, vol: 0.4 },                                                 // the title's bell render
    fChant: { base: 'choir', a: 0.012, d: 0.12, s: 0.7, r: 0.16 },                                           // choir samples, short: chant stabs
    fToc: { base: 'organ', r: 0.08 },
    fPad: { base: 'padDark', r: 0.7 },                                                       // shorter tails (play-time)
    fChoir: { base: 'choir', r: 0.8 },
    fLead: { base: 'leadBright', cutoff: 3600, vib: 18, vibDelay: 0.26, glide: 0.06, r: 0.3 },
    fLead2: { base: 'leadSquare', cutoff: 2000, vib: 12, r: 0.18 },
  },

  channels: {
    kick: { inst: 'kickHard', gain: 0.4, sidechain: true },
    snare: { inst: 'snareBig', gain: 0.46, reverb: 0.25 },
    roll: { inst: 'snareTight', gain: 0.4, reverb: 0.2, pan: 0.05 },
    clap: { gain: 0.3, reverb: 0.22, pan: -0.08 },
    hat: { gain: 0.36, pan: 0.25, choke: ['ohat'], human: { t: 0.002, v: 0.1 } },
    ohat: { gain: 0.28, pan: 0.3 },
    ride: { gain: 0.22, pan: -0.3, layer: { min: 0.7 } },
    crash: { gain: 0.42, reverb: 0.15, pan: -0.2 },
    tom: { gain: 0.4, reverb: 0.18 },
    taiko: { gain: 0.26, reverb: 0.24, poly: 2 },
    taiko2: { inst: 'taiko', gain: 0.26, reverb: 0.25, pan: 0.2, tune: 5, poly: 2, layer: { min: 0.75 } },
    impact: { gain: 0.42, reverb: 0.25 },
    rev: { inst: 'revcym', gain: 0.4 },
    riser: { gain: 0.4, reverb: 0.3 },
    down: { inst: 'downlifter', gain: 0.38, reverb: 0.35 },
    sub: { gain: 0.5, duck: 0.3 },
    bass: { inst: 'fBass', gain: 0.74, duck: 0.4 },
    pad: { inst: 'fPad', gain: 0.24, duck: 0.55, reverb: 0.3 },
    organ: { inst: 'organFull', gain: 0.3, reverb: 0.4, duck: 0.3 },
    toccata: { inst: 'fToc', gain: 0.7, reverb: 0.3, delay: 0.12, pan: 0.12, duck: 0.25 },
    choir: { inst: 'fChoir', gain: 0.34, reverb: 0.45, duck: 0.2 },
    voice: { inst: 'fChoir', gain: 0.48, reverb: 0.42, duck: 0.12 },      // the choir as a melody (same samples)
    chant: { inst: 'fChant', gain: 0.32, reverb: 0.35, pan: -0.06 },
    oo: { inst: 'choirOo', gain: 0.28, reverb: 0.5 },
    strings: { gain: 0.38, reverb: 0.38, pan: -0.15, duck: 0.25 },
    brass: { gain: 0.42, reverb: 0.3 },
    stab: { inst: 'brassStab', gain: 0.32, reverb: 0.22, pan: -0.12, delay: 0.1, poly: 6 },
    bell: { inst: 'fBell', gain: 0.36, reverb: 0.5, delay: 0.25, pan: 0.15 },
    arp: { inst: 'fArp', gain: 0.32, delay: 0.25, reverb: 0.15, pan: -0.25, duck: 0.35, poly: 5 },
    lead: { inst: 'fLead', gain: 0.72, reverb: 0.22, delay: 0.2 },
    lead2: { inst: 'fLead2', gain: 0.34, reverb: 0.15, layer: { min: 0.8 } },
  },

  patterns: {
    // ── intro: the Heart awakens ──
    inOrgan: { organ: 'D3+A3+D4+F4*32 | Eb3+G3+Bb3+Eb4*32 | D3+A3+D4+F4*32 | A2+E3+A3*32', vel: 0.75 },
    inChoir: { choir: 'D4+A4+D5*32 | Eb4+Bb4+Eb5*32 | D4+A4+D5*32 | A3+E4+A4*32', vel: 0.7 },
    inSub: { sub: 'D2*32 D1*32 D2*32 A1*32' },   // the floor drops an octave under the Choir's bII
    inPad: { len: 128, pad: chordEvents('Dm Dm Eb Eb Dm Dm A A', { low: 'D3', high: 'A4', voices: 4, vel: 0.55 }) },
    inBell: { len: 128, bell: [[0, 'D4', 16, 0.85], [32, 'Eb4', 16, 0.8], [64, 'D4', 16, 0.85], [96, 'A3', 16, 0.85]] },
    inToc: { toccata: FLOURISH, vel: 0.78 },
    heart: { taiko: 'X.x.....X.x.....' },
    heartK: { taiko: 'X.x.....X.x.....', kick: 'X.x.....X.x.....' },
    inBuild7: { taiko: 'X.x.X...X.x.X.x.', kick: 'X...X...X...X.X.', hat: 'x.x.x.x.x.x.x.x.', roll: '.*8 x@0.3 x@0.35 x@0.4 x@0.45 x@0.5 x@0.55 x@0.6 x@0.65' },
    inBuild8: { taiko: 'X.x.X.x.X.XXXXXX', kick: 'X.X.X.X.X.X.X.X.', hat: 'xxxxxxxxxxxxxxxx', roll: 'x@0.66 x@0.68 x@0.7 x@0.72 x@0.74 x@0.76 x@0.78 x@0.8 x@0.82 x@0.84 x@0.86 x@0.88 x@0.9 x@0.93 x@0.96 X', tom: '.*8 D3 D3 A2 A2 F2 F2 D2 D2' },
    inFx: { len: 128, impact: [[32, 'x', 1, 0.75], [64, 'x', 1, 0.8]], riser: [[64, 'x', 64, 0.8]], rev: [[112, 'x', 16, 0.9]] },

    // ── A: the Heart ──
    hymn: { voice: HYMN, vel: 0.78 },
    hymnBrass: { brass: transpose(HYMN.split('|').slice(8).join('|'), -12), vel: 0.74 },   // bars 9–16, an octave below
    tocA: { len: 256, toccata: arp(halfList(A_H, { low: 'A3', high: 'A4', voices: 3 }), { rate: 1, len: 8, order: [2, 0, 1, 0], vel: 0.62, accent: 0.14 }) },
    bassA: { len: 256, bass: bassFig(A_H, OCT8) },
    padA: { len: 256, pad: chordEvents(A_H, { low: 'D3', high: 'C4', voices: 3, vel: 0.62 }) },   // stays under the brass
    stabA: { len: 256, stab: cut(hits(A_H, [[0, 2, 1], [6, 1.5, 0.8]], { low: 'A3', high: 'F4', voices: 3 }), 128, 256) },
    beatA: { kick: 'X...X...X...X...', snare: '....X.......X...', clap: '....x.......x...', hat: 'xgxgxgxgxgxgxgxg', taiko: 'X.x.....X.x.....' },
    beatA2: { kick: 'X...X...X..xX...', snare: '....X.......X..g', clap: '....x.......x...', hat: 'xgxgxgxgxgxgxgxg', ohat: '..x.......x.....', taiko: 'X.x.....X.x.....' },
    fillA: { kick: 'X...X...X...X...', snare: '....X.......XfXf', clap: '....x.......x...', hat: 'xgxgxgxgxgxg....', taiko: 'X.x.....X.x.....' },
    fillA2: { kick: 'X...X...X.......', snare: '....X...........', roll: '.*8 x@0.55 x@0.6 x@0.65 x@0.7 x@0.75 x@0.8 x@0.9 X', hat: 'xgxgxgxg........', tom: '.*8 D3 . A2 . F2 F2 D2 D2', taiko: 'X.x.....X.X.X.X.' },
    crash1: { crash: 'X' },
    crashImp: { crash: 'X', impact: 'x' },
    rideA: { ride: 'x.x.x.x.x.x.x.x.' },
    taikoL: { taiko2: 'X.......x.x.....' },

    // ── B: fury ──
    fury: { lead: FURY, lead2: transpose(FURY, -12) },
    chantB: { len: 256, chant: hits(B_H, CHANT_332, { low: 'D4', high: 'D5', voices: 3 }) },
    brassB: { len: 256, brass: chordEvents(B_H, { low: 'D3', high: 'A3', voices: 2, vel: 0.62 }) },
    tocB: { len: 256, toccata: arp(halfList(B_H, { low: 'A3', high: 'A4', voices: 3 }), { rate: 1, len: 8, order: [0, 1, 2, 1], vel: 0.58, accent: 0.14 }) },
    bassB: { len: 256, bass: bassFig(B_H, DRIVE) },
    padB: { len: 256, pad: chordEvents(B_H, { low: 'D3', high: 'A4', voices: 3, vel: 0.62 }) },
    beatB: { kick: 'X..xX...X..xX...', snare: '....X.......X...', clap: '....x.......x...', hat: 'xgxgxgxgxgxgxgxg', ohat: '..x...x...x...x.', taiko: 'X.....x.X.....x.' },
    fillB: { kick: 'X..xX...X..xX...', snare: '....X.......X.xx', clap: '....x.......x...', hat: 'xgxgxgxgxgxg....', taiko: 'X.....x.X.....x.', tom: '.*12 D3 A2 F2 D2' },

    // ── C: toccata over the lament ──
    tocC: { len: 128, toccata: arp(voiceLead(C_H.split(' '), { low: 'D4', high: 'D5', voices: 4 }), { rate: 1, len: 16, oct: 2, order: [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 2, 3], vel: 0.7, accent: 0.16 }) },
    bassC: { len: 128, bass: bassFig(C_H, OCT8) },
    subC: { len: 128, sub: bassFig(C_H, [[0, 0, 16, 0.55]]) },
    choirC: { len: 128, choir: chordEvents(C_H, { low: 'D4', high: 'D5', voices: 3, vel: 0.62 }) },
    stringsC: { strings: LAMENT_TOP, vel: 0.66 },
    stabC: { len: 128, stab: hits(C_H, [[0, 3, 1], [8, 1.5, 0.8]], { low: 'A3', high: 'F4', voices: 3 }) },
    beatC: { kick: 'X...X...X...X...', snare: '....X.......X...', clap: '....x.......x...', hat: 'xgxgxgxgxgxgxgxg', taiko: 'x...g...o...g...' },
    fillC: { kick: 'X...X...X.......', snare: '....X...........', roll: '.*8 x@0.5 x@0.6 x@0.7 x@0.75 x@0.8 x@0.85 x@0.9 X', tom: '.*8 D3 D3 A2 A2 F2 F2 D2 D2', taiko: 'X...X...X.X.XXXX' },

    // ── break: remember ──
    brkBell: {
      len: 128,
      bell: [...themeEvents({ tonic: 'D5', scale: 'minor', part: 'call', vel: 0.78 }),
        ...themeEvents({ tonic: 'F5', part: 'call', pickup: true, start: 32, vel: 0.74 }),
        ...themeEvents({ tonic: 'Bb4', part: 'call', pickup: true, start: 64, vel: 0.76 }),
        [112, 'A4', 16, 0.7]],
    },
    brkStrings: {
      len: 128,
      strings: [...themeEvents({ tonic: 'D5', scale: 'minor', part: 'answer', vel: 0.7 }),
        ...themeEvents({ tonic: 'F5', part: 'answer', start: 32, vel: 0.7 }),
        ...themeEvents({ tonic: 'Bb4', part: 'answer', start: 64, vel: 0.72 }),
        [112, 'E5', 16, 0.66]],
    },
    brkLead: { len: 128, lead: themeEvents({ tonic: 'G4', scale: 'minor', part: 'call', pickup: true, start: 96, vel: 0.72 }) },
    brkOo: { len: 128, oo: chordEvents(BRK_H, { low: 'D4', high: 'D5', voices: 3, vel: 0.52 }) },
    brkPad: { len: 128, pad: chordEvents(BRK_H, { low: 'D3', high: 'A4', voices: 4, vel: 0.5 }) },
    brkSub: { len: 128, sub: bassFig(BRK_H, [[0, 0, 16, 0.5]]) },
    brkHeart: { taiko: 'o.g.....o.g.....' },
    brkHeartK: { taiko: 'x.o.....x.o.....', kick: 'o.......o.......' },
    brkFx: { len: 128, rev: [[112, 'x', 16, 0.8]] },

    // ── build: rise ──
    riseStr: { strings: RISE, vel: 0.74 },
    riseBrass: { brass: transpose(RISE, -12), vel: 0.72 },
    riseChoir: { len: 128, choir: chordEvents(BUILD_H, { low: 'D4', high: 'D5', voices: 3, vel: 0.62 }) },
    riseOrgan: { len: 128, organ: chordEvents(BUILD_H, { low: 'D3', high: 'A4', voices: 4, vel: 0.7 }) },
    riseBass: { len: 128, bass: bassFig(BUILD_H, OCT8) },
    riseLead: { len: 128, lead: [[126, 'A4', 2, 0.85]] },
    bu1: { kick: 'X...X...X...X...', snare: 'x...x...x...x...', hat: 'x.x.x.x.x.x.x.x.', taiko: 'X.......X.......' },
    bu2: { kick: 'X...X...X...X...', snare: 'x.x.x.x.x.x.x.x.', hat: 'x.x.x.x.x.x.x.x.', taiko: 'X...X...X...X...' },
    bu3: { kick: 'X.x.X.x.X.x.X.x.', roll: 'xxxxxxxxxxxxxxxx', hat: 'xxxxxxxxxxxxxxxx', taiko: 'X...X...X...X...' },
    bu4: { kick: 'X.X.X.X.X.X.X.X.', roll: 'xxxxxxxxxxxxrrRR', taiko: 'X.X.X.X.X.XXXXXX', tom: '.*8 D3 D3 A2 A2 F2 F2 D2 D2' },
    riseFx: { len: 128, riser: [[0, 'x', 128, 0.85]], rev: [[104, 'x', 24, 0.9]] },

    // ── reprise: the Lancers theme ──
    repLead: { len: 256, lead: REP_LEAD, lead2: REP_LEAD.map(([s, n, l, v]) => [s, n - 12, l, v]) },
    repBrass: { len: 256, brass: [...chordEvents(THEME_H, { low: 'D3', high: 'A4', voices: 3, vel: 0.52, legato: 0.95 }), ...REP_BRASS2] },
    repCounter: { step: 4, strings: COUNTER1, vel: 0.7 },
    repDescant: { strings: DESCANT2, vel: 0.66 },
    repChoir: { len: 256, choir: chordEvents(REP_H, { low: 'D4', high: 'B4', voices: 3, vel: 0.62 }) },
    repOrgan: { len: 256, organ: chordEvents(REP_H, { low: 'D3', high: 'A4', voices: 4, vel: 0.62 }) },
    repToc: { len: 256, toccata: arp(halfList(REP_H, { low: 'A3', high: 'A4', voices: 3 }), { rate: 1, len: 8, order: [2, 0, 1, 0], vel: 0.52, accent: 0.12 }) },
    repArp: { len: 256, arp: arp(halfList(REP_H, { low: 'A4', high: 'A5', voices: 3 }), { rate: 1, len: 8, continue: true, oct: 1, order: [0, 1, 2, 1, 2, 0, 1, 2], vel: 0.58, accent: 0.16 }) },
    repBass: { len: 256, bass: bassFig(REP_H, OCT8) },
    repBell: {
      len: 256,
      bell: [...themeEvents({ tonic: 'D6', part: 'call', pickup: true, start: 128, vel: 0.62 }), ...themeEvents({ tonic: 'D6', part: 'call', start: 192, vel: 0.6 })],
    },
    four: { kick: 'X...X...X...X...', snare: '....X.......X...', clap: '....x.......x...', hat: 'xgxgxgxgxgxgxgxg', ohat: '..x...x...x...x.', taiko: 'X.......X.....x.' },
    fourFill: { kick: 'X...X...X...X...', snare: '....X.......X.xx', clap: '....x.......x...', hat: 'xgxgxgxgxgxg....', taiko: 'X.......X.x.xxXX' },
    fourFill2: { kick: 'X...X...X.......', snare: '....X...........', roll: '.*8 x@0.55 x@0.6 x@0.65 x@0.7 x@0.8 x@0.85 x@0.9 X', hat: 'xgxgxgxg........', tom: '.*8 D3 . A2 . F#2 F#2 D2 D2', taiko: 'X.......X.X.XXXX' },

    // ── finale: the motif redeemed ──
    finChoir: { voice: FIN_CHOIR, vel: 0.74 },
    finBrass: { brass: 'D4*16 | E4*16 | D4*16 | A4*16 | D4*16 | E4*16 | F#4*16 | F#4*4 .*12', vel: 0.8 },
    finLead: { lead: FIN_LEAD, lead2: transpose(FIN_LEAD, -12) },
    finOrgan: { len: 128, organ: cut(chordEvents(FIN_H, { low: 'D3', high: 'A4', voices: 4, vel: 0.7 }), 0, 112).concat([[112, 'D3+A3+D4+F#4', 16, 0.8]]) },
    finBell: { len: 128, bell: [[0, 'D5', 16, 0.72], [16, 'E5', 16, 0.7], [32, 'D5', 16, 0.72], [48, 'A5', 16, 0.74]] },
    finBass: { len: 128, bass: cut(bassFig(FIN_H, OCT8), 0, 112).concat([[112, 'D2', 16, 1]]) },
    finStab: { len: 128, stab: cut(hits(FIN_H, [[0, 2, 1], [6, 1.5, 0.8], [12, 1.5, 0.85]], { low: 'A3', high: 'F#4', voices: 3 }), 64, 112) },
    finArp: { len: 128, arp: cut(arp(halfList(FIN_H, { low: 'A4', high: 'A5', voices: 3 }), { rate: 1, len: 8, continue: true, order: [0, 1, 2, 1, 2, 0, 1, 2], vel: 0.58, accent: 0.16 }), 0, 112) },
    finEnd: {
      kick: 'X...............', crash: 'X...............', taiko: 'X...............', impact: 'x...............',
      down: [[2, 'x', 14, 0.7]],
    },
  },

  sections: {
    intro: {
      bars: 8, chords: INTRO_H,
      play: ['inOrgan', 'inChoir', 'inSub', 'inPad', 'inBell', 'inFx', { p: 'inToc', at: 6, once: true },
        ['heart', 'heart', 'heart', 'heart', 'heartK', 'heartK', 'inBuild7', 'inBuild8']],
      // the Heart wakes slowly (and bars 1–2 leave room for the WARNING siren)
      auto: { 'organ.vol': [[0, 0.5], [2, 0.6], [6, 1]], 'choir.vol': [[0, 0.5], [2, 0.65], [6, 1]], 'pad.vol': [[0, 0.5], [6, 1]], 'sub.vol': [[0, 0.7], [6, 1]] },
    },
    A: {
      bars: 16, chords: A_H,
      play: ['hymn', 'tocA', 'bassA', 'padA', { p: 'hymnBrass', at: 8, once: true }, 'stabA', { p: 'crashImp', once: true }, { p: 'crash1', at: 8, once: true },
        ['beatA', 'beatA', 'beatA', 'fillA', 'beatA', 'beatA', 'beatA', 'fillA2', 'beatA2', 'beatA2', 'beatA2', 'fillA', 'beatA2', 'beatA2', 'beatA2', 'fillA2'],
        { p: 'rideA', at: 8 }, 'taikoL'],
    },
    B: {
      bars: 16, chords: B_H,
      play: ['fury', 'chantB', 'brassB', 'tocB', 'bassB', 'padB', { p: 'crash1', once: true }, { p: 'crash1', at: 8, once: true },
        ['beatB', 'beatB', 'beatB', 'fillB', 'beatB', 'beatB', 'beatB', 'fillA2'], 'rideA', 'taikoL'],
      auto: { 'lead.cutoff': [[0, 2600]] },
    },
    C: {
      bars: 8, chords: C_H,
      play: ['tocC', 'bassC', 'subC', 'choirC', 'stringsC', 'stabC', { p: 'crashImp', once: true },
        ['beatC', 'beatC', 'beatC', 'beatC', 'beatC', 'beatC', 'beatC', 'fillC'], 'taikoL'],
      auto: { 'toccata.vol': [[0, 1.5]] },        // the organ is the soloist here
    },
    break: {
      bars: 8, chords: BRK_H,
      play: ['brkBell', 'brkStrings', 'brkLead', 'brkOo', 'brkPad', 'brkSub', 'brkFx',
        ['brkHeart', 'brkHeart', 'brkHeart', 'brkHeart', 'brkHeartK', 'brkHeartK', 'brkHeartK', 'brkHeartK']],
      auto: { 'pad.lpf': [[0, 900], [8, 3000]] },
    },
    build: {
      bars: 8, chords: BUILD_H,
      play: ['riseStr', 'riseBrass', 'riseChoir', 'riseOrgan', 'riseBass', 'riseLead', 'riseFx',
        ['bu1', 'bu1', 'bu2', 'bu2', 'bu3', 'bu3', 'bu4', 'bu4']],
      auto: { 'organ.vol': [[0, 0.6], [8, 1]], 'bass.lpf': [[0, 500], [8, 6000]] },
    },
    reprise: {
      bars: 16, chords: REP_H, key: 'D', scale: 'major',
      play: ['repLead', 'repBrass', ['repCounter', 'repDescant'], 'repChoir', 'repOrgan', 'repToc', 'repArp', 'repBass', 'repBell',
        { p: 'crashImp', once: true }, { p: 'crash1', at: 4, once: true }, { p: 'crash1', at: 8, once: true }, { p: 'crash1', at: 12, once: true },
        ['four', 'four', 'four', 'fourFill', 'four', 'four', 'four', 'fourFill2'], 'rideA', 'taikoL'],
    },
    finale: {
      bars: 8, chords: FIN_H, key: 'D', scale: 'major',
      play: ['finChoir', 'finBrass', 'finLead', 'finOrgan', 'finBell', 'finBass', 'finStab', 'finArp',
        { p: 'crashImp', once: true }, { p: 'crash1', at: 4, once: true },
        ['four', 'four', 'four', 'fourFill', 'four', 'four', 'fourFill2', 'finEnd'], { p: 'rideA', until: 7 }, { p: 'taikoL', until: 7 }],
    },
  },

  arrangement: ['intro', 'A', 'B', 'C', 'break', 'build', 'reprise', 'finale'],
  loop: 'intro',
};
