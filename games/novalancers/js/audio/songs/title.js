// "Lancers Rising" — title theme. Heroic, hopeful synthwave anthem in D major, 100 BPM.
// Form (48 bars ≈ 115 s; loops from BUILD, a 96 s cycle):
//   intro (8)     dawn: pad swell, harp, the "call" quoted on bells, impact + riser
//   build (8)     half-time pulse; brass sings the theme's skeleton in long notes; snare roll
//   full (16)     THE LANCERS THEME: lead (D4) → second statement an octave up with brass
//                 unison, strings counter-melody, choir; fills every 4 bars
//   breakdown (8) vi–IV–I–V: the contrasting B phrase on bells, then strings; heartbeat taiko
//   return (8)    four-on-the-floor climax, theme again, bVI–bVII–I cadence (Bb–C–D) rising in
//                 thirds to F#; the last bar rings out and hands back to the build.

import { arp, voiceLead, rep } from '../music.js';
import { themeEvents, themeChords, themeHarmony } from './motifs.js';

// ── harmony ────────────────────────────────────────────────────────────────────────
const THEME_H = themeHarmony('D');                    // 'D G Bm7 Asus4,A D G Em7,A D'
const BUILD_H = 'D G Bm7 A D G Em7 A';
const BREAK_H = 'Bm7 G D A Bm7 G D A';
const RETURN_H = 'D G Bm7 Asus4,A D G Bb,C D';

// events for chords, one per bar (or half bar when a token has a comma)
function chordEvents(harm, opt) {
  const flat = [], at = [];
  harm.split(' ').forEach((bar, b) => bar.split(',').forEach((c, i, a) => { flat.push(c); at.push([b * 16 + (i * 16) / a.length, 16 / a.length]); }));
  return voiceLead(flat, opt).map((n, i) => [at[i][0], n, at[i][1] * (opt.legato ?? 1), opt.vel ?? 0.7]);
}
// two chords per bar (a single-chord bar is repeated) → use with arp({ len: 8, continue: true })
function halfList(harm, opt) {
  const flat = [];
  harm.split(' ').forEach((bar) => { const c = bar.split(','); flat.push(c[0], c[c.length - 1]); });
  return voiceLead(flat, opt);
}
const cut = (evs, from, to) => evs.filter((e) => e[0] >= from && e[0] < to);

// ── melodies ───────────────────────────────────────────────────────────────────────
// Lead lives in the D5 octave (A4–E6) above the pads (E3–C#5). Statement 2 thickens it with
// brass an octave below; the return doubles it with strings in unison and climbs to F#6.
const stmt1 = themeEvents({ tonic: 'D5', vel: 0.8 }).map((e) => (e[0] === 112 ? [112, e[1], 14, e[3]] : e));
const stmt2 = themeEvents({ tonic: 'D5', pickup: true, start: 128, vel: 0.9 });
const brassUnison = themeEvents({ tonic: 'D4', start: 128, vel: 0.75 });
const returnLead = cut(themeEvents({ tonic: 'D5', vel: 0.9 }), 0, 96).concat(themeEvents({ tonic: 'D5', part: 'cadence', start: 96, vel: 0.95 }));
const returnStrings = returnLead.map(([s, n, l, v]) => [s, n, l, v * 0.75]);
const returnBrass = cut(themeEvents({ tonic: 'D4', vel: 0.8 }), 0, 96);

export default {
  title: 'Lancers Rising',
  bpm: 100,
  key: 'D', scale: 'major',
  gain: 0.8,
  reverb: 1,
  delay: { beats: 0.75, feedback: 0.36, lp: 3600, hp: 350 },
  duck: { release: 0.26 },
  seed: 11,

  instruments: {
    tBass: { base: 'bass', cutoff: 420, env: 2.2, q: 2, drive: 0.3 },
    tPad: { base: 'pad', cutoff: 3000, detune: 26, a: 0.6, r: 1.6, air: 0.03 },
    tArp: { base: 'pluck', cutoff: 800, env: 3.2, decay: 0.22, amp: 0.7 },
    tLead: { base: 'leadBright', cutoff: 3800, vib: 18, vibDelay: 0.3, glide: 0.06, r: 0.3 },
    tBell: { base: 'bell', decay: 3.2, index: 2, vol: 0.4 },
  },

  channels: {
    kick: { gain: 0.55, sidechain: true },
    snare: { inst: 'snareBig', gain: 0.5, reverb: 0.3 },
    clap: { gain: 0.3, reverb: 0.25, pan: 0.1 },
    hat: { gain: 0.28, pan: 0.22, choke: ['ohat'], human: { t: 0.003, v: 0.12 } },
    ohat: { gain: 0.24, pan: 0.25 },
    crash: { gain: 0.4, reverb: 0.15, pan: -0.15 },
    tom: { gain: 0.35, reverb: 0.18 },
    taiko: { gain: 0.45, reverb: 0.22 },
    rev: { inst: 'revcym', gain: 0.45 },
    riser: { gain: 0.45, reverb: 0.3 },
    down: { inst: 'downlifter', gain: 0.4, reverb: 0.35 },
    impact: { gain: 0.45, reverb: 0.25 },
    drone: { inst: 'bassSoft', gain: 0.5, duck: 0.3 },
    bass: { inst: 'tBass', gain: 0.75, duck: 0.45 },
    pad: { inst: 'tPad', gain: 0.25, duck: 0.5, reverb: 0.32, lpf: 20000 },
    strings: { gain: 0.23, duck: 0.3, reverb: 0.4, pan: -0.1 },
    counter: { inst: 'strings', gain: 0.5, reverb: 0.4, pan: 0.18 },
    choir: { gain: 0.2, reverb: 0.5 },
    brass: { gain: 0.45, reverb: 0.28 },
    arp: { inst: 'tArp', gain: 0.35, delay: 0.32, reverb: 0.18, pan: -0.2, duck: 0.35 },
    harp: { gain: 0.35, reverb: 0.38, delay: 0.2, pan: 0.22 },
    bell: { inst: 'tBell', gain: 0.35, reverb: 0.5, delay: 0.3, pan: 0.1 },
    lead: { inst: 'tLead', gain: 0.68, reverb: 0.24, delay: 0.24 },
  },

  patterns: {
    // ── INTRO ──
    introPad: { step: 16, pad: 'F#3+A3+D4+E4 - F#3+A3+B3+D4 - F#3+G3+B3+D4 - E3+A3+D4+E4 E3+A3+C#4+E4' },
    introDrone: { step: 16, drone: 'D2 - B1 - G1 - A1 -' },
    introChoir: { step: 16, choir: '. . D4+B4 - D4+B4 - E4+A4 C#4+A4' },
    introHarp: {
      len: 96,
      harp: arp(voiceLead(['Bm7', 'Bm7', 'Gmaj7', 'Gmaj7', 'Asus4', 'A'], { low: 'B3', high: 'A4', voices: 4 }), { rate: 2, oct: 2, order: [0, 2, 4, 6, 7, 5, 3, 1], vel: 0.62, accent: 0.12 }),
    },
    introBell: {
      len: 128,
      bell: [...themeEvents({ tonic: 'D5', part: 'call', pickup: true, start: 16, vel: 0.7 }), ...themeEvents({ tonic: 'D5', part: 'call', pickup: true, start: 80, vel: 0.6 })],
    },
    introFx: { len: 128, impact: [[0, 'x', 1, 0.8]], rev: [[104, 'x', 24, 0.8]], riser: [[96, 'x', 32, 0.75]] },

    // ── BUILD ──
    buildBass: {
      step: 2,
      bass: 'D2 D2 D2 D2 D2 D2 D2 D3 | G1 G1 G1 G1 G1 G1 G1 G2 | B1 B1 B1 B1 B1 B1 B1 B2 | A1 A1 A1 A1 A1 A1 A1 A2 | ' +
            'D2 D2 D2 D2 D2 D2 D2 D3 | G1 G1 G1 G1 G1 G1 G1 G2 | E2 E2 E2 E2 E2 E2 E2 E3 | A1 A1 A1 A1 A2 A2 A2 A2',
    },
    buildPad: { len: 128, pad: chordEvents(BUILD_H, { low: 'E3', high: 'C#5', voices: 4 }) },
    buildBrass: { brass: 'D4*12 A4*20 D5*12 C#5*4 A4*16 D4*12 A4*20 E5*12 D5*4 C#5*8 A4*8', vel: 0.72 },
    buildStrings: { len: 64, strings: chordEvents('D G Em7 A', { low: 'A4', high: 'A5', voices: 3, vel: 0.6 }) },
    buildArp: {
      len: 128,
      arp: arp(halfList(BUILD_H, { low: 'A3', high: 'A4', voices: 3 }), { rate: 2, len: 8, continue: true, oct: 2, order: [0, 1, 2, 3, 4, 5, 4, 3], vel: 0.66 }),
    },
    buildLead: { len: 128, lead: [[126, 'A4', 2, 0.8]] },
    bHalf: { kick: 'X.......X.......', taiko: 'X...............' },
    bHalf2: { kick: 'X.......X.......', taiko: '........x.......' },
    bDrive: { kick: 'X.....x.X.......', hat: 'x.o.x.o.x.o.x.o.', taiko: 'X...............' },
    bDrive2: { kick: 'X.....x.X.......', snare: '....x.......x...', hat: 'x.o.x.o.x.o.x.oo' },
    bRoll: {
      kick: 'X...X...X...X...',
      snare: 'x@0.3 . x@0.35 . x@0.4 . x@0.45 . x@0.5 x@0.55 x@0.6 x@0.65 x@0.7 x@0.8 x@0.9 X',
      tom: '.*12 D3 B2 G2 E2',
      hat: 'x.x.x.x.x.x.x.x.',
    },
    buildFx: { len: 128, riser: [[96, 'x', 32, 0.8]], rev: [[112, 'x', 16, 0.8]] },

    // ── FULL (two statements of the theme) ──
    fullLead: { len: 256, lead: [...stmt1, ...stmt2] },
    fullBrass: {
      len: 256,
      brass: [...chordEvents(THEME_H, { low: 'D3', high: 'A4', voices: 3, vel: 0.5, legato: 0.95 }), ...brassUnison],
    },
    fullPad: { len: 128, pad: themeChords('D', { low: 'E3', high: 'C#5', vel: 0.72 }) },
    fullBass: {
      step: 2,
      bass: 'D2 D3 D2 D3 D2 D3 D2 D3 | G1 G2 G1 G2 G1 G2 G1 G2 | B1 B2 B1 B2 B1 B2 B1 B2 | A1 A2 A1 A2 A1 A2 A1 A2 | ' +
            'D2 D3 D2 D3 D2 D3 D2 D3 | G1 G2 G1 G2 G1 G2 G1 G2 | E2 E3 E2 E3 A1 A2 A1 A2 | D2 D3 D2 D3 D2 A2 B2 C#3',
    },
    fullArp8: { len: 128, arp: arp(halfList(THEME_H, { low: 'A3', high: 'A4', voices: 3 }), { rate: 2, len: 8, continue: true, oct: 2, order: [0, 1, 2, 3, 4, 5, 4, 3], vel: 0.7 }) },
    fullArp16: { len: 128, arp: arp(halfList(THEME_H, { low: 'A3', high: 'A4', voices: 3 }), { rate: 1, len: 8, continue: true, oct: 2, order: [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 2, 3, 4, 5, 4, 3], vel: 0.62, accent: 0.18 }) },
    fullCounter: { step: 4, counter: 'A4 - F#4 - | G4 - B4 - | A4 - - F#4 | E4 - C#4 - | D4 - F#4 - | G4 - B4 D5 | B4 - C#5 - | D5 - - -', vel: 0.7 },
    fullChoir: { len: 128, choir: themeChords('D', { low: 'D4', high: 'B4', voices: 3, vel: 0.6 }) },
    grooveA: { kick: 'X.....x.X.......', snare: '....X.......X...', clap: '....x.......x...', hat: 'xgxgxgxgxgxgxg.g', ohat: '..............x.' },
    fillA: { kick: 'X.....x.X.......', snare: '....X.......X.xx', clap: '....x.......x...', hat: 'xgxgxgxgxgxg....', tom: '.*12 D3 B2 G2 E2' },
    fillB: {
      kick: 'X.....x.X.......',
      snare: '. . . . X . . . x@0.5 . x@0.6 . X x@0.7 x@0.8 x@0.9',
      clap: '....x...........',
      hat: 'xgxgxgxg........',
      tom: '.*8 D3 . B2 . G2 G2 E2 E2',
    },
    crashBar: { crash: 'X' },
    taikoHi: { taiko: 'X.......X.....x.' },

    // ── BREAKDOWN ──
    brPad: { len: 128, pad: chordEvents(BREAK_H, { low: 'E3', high: 'C#5', voices: 4, vel: 0.65 }) },
    brChoir: { len: 128, choir: chordEvents(BREAK_H, { low: 'A4', high: 'A5', voices: 2, vel: 0.55 }) },
    brDrone: { step: 16, drone: 'B1 G1 D2 A1' },
    brBass: { step: 2, bass: rep('B1 B1 B1 B1 B1 B1 B1 B2', 1) + ' ' + rep('G1 G1 G1 G1 G1 G1 G1 G2', 1) + ' D2 D2 D2 D2 D2 D2 D2 D3 A1 A1 A1 A1 A2 A2 A2 A2' },
    brHarp: { len: 128, harp: arp(halfList(BREAK_H, { low: 'B3', high: 'B4', voices: 4 }), { rate: 2, len: 8, continue: true, oct: 2, order: [0, 2, 4, 6, 7, 5, 3, 1], vel: 0.58 }) },
    brBell: { len: 64, bell: themeEvents({ tonic: 'D5', part: 'b', vel: 0.72 }) },
    brStrings: { len: 64, counter: themeEvents({ tonic: 'D4', part: 'b', vel: 0.8, legato: 1 }) },
    brLead: { len: 64, lead: [[62, 'A4', 2, 0.8]] },
    heart: { taiko: 'X.......X.......' },
    heart2: { taiko: 'X.......X.......', hat: 'x.x.x.x.x.x.x.x.' },
    brRoll: {
      taiko: 'X.......X...x.x.',
      snare: 'x@0.3 . . . x@0.4 . . . x@0.5 . x@0.6 . x@0.7 x@0.8 x@0.9 X',
      hat: 'x.x.x.x.x.x.x.x.',
    },
    brFx: { len: 128, riser: [[96, 'x', 32, 0.8]], rev: [[104, 'x', 24, 0.85]] },

    // ── RETURN (climax) ──
    retLead: { len: 128, lead: returnLead },
    retStrings: { len: 128, counter: returnStrings },
    retPad: { len: 128, pad: chordEvents(RETURN_H, { low: 'E3', high: 'C#5', voices: 4, vel: 0.75 }) },
    retChoir: { len: 128, choir: chordEvents(RETURN_H, { low: 'D4', high: 'B4', voices: 3, vel: 0.62 }) },
    retBrass: {
      len: 128,
      brass: [
        ...returnBrass,
        [96, 'Bb3+D4+F4', 6, 0.9], [102, 'Bb3+D4+F4', 2, 0.8], [104, 'C4+E4+G4', 8, 0.95], [112, 'D4+F#4+A4+D5', 16, 1],
      ],
    },
    retBass: {
      step: 2,
      bass: 'D2 D3 D2 D3 D2 D3 D2 D3 | G1 G2 G1 G2 G1 G2 G1 G2 | B1 B2 B1 B2 B1 B2 B1 B2 | A1 A2 A1 A2 A1 A2 A1 A2 | ' +
            'D2 D3 D2 D3 D2 D3 D2 D3 | G1 G2 G1 G2 G1 G2 G1 G2 | Bb1 Bb2 Bb1 Bb2 C2 C3 C2 C3 | D2 - - - - - - -',
    },
    retArp: { len: 128, arp: arp(halfList(RETURN_H, { low: 'A3', high: 'A4', voices: 3 }), { rate: 1, len: 8, continue: true, oct: 2, order: [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 2, 3, 4, 5, 4, 3], vel: 0.62, accent: 0.18 }) },
    four: { kick: 'X...X...X...X...', snare: '....X.......X...', clap: '....x.......x...', hat: 'xgxgxgxgxgxgxg.g', ohat: '..x...x...x...x.' },
    fourFill: { kick: 'X...X...X...X...', snare: '....X.......X...', clap: '....x.......x...', hat: 'xgxgxgxgxgxg....', taiko: '........X.x.xxXX' },
    finalHit: { kick: 'X...............', crash: 'X...............', taiko: 'X...............' },
    retFx: { len: 128, crash: [[0, 'x', 1, 1], [64, 'x', 1, 0.9]], rev: [[88, 'x', 8, 0.8]], down: [[116, 'x', 12, 0.7]] },
  },

  sections: {
    intro: {
      bars: 8, chords: 'Dadd9 Dadd9 Bm7 Bm7 Gmaj7 Gmaj7 Asus4 A',
      play: ['introPad', 'introDrone', 'introChoir', { p: 'introHarp', at: 2, once: true }, 'introBell', 'introFx'],
      auto: { 'pad.lpf': [[0, 500], [7, 5200]] },
    },
    build: {
      bars: 8, chords: BUILD_H,
      play: ['buildBass', 'buildPad', 'buildBrass', { p: 'buildStrings', at: 4 }, 'buildArp', 'buildLead', 'buildFx',
        ['bHalf', 'bHalf2', 'bHalf', 'bHalf2', 'bDrive', 'bDrive', 'bDrive2', 'bRoll']],
      auto: { 'bass.lpf': [[0, 350], [8, 2600]], 'arp.lpf': [[0, 900], [8, 9000]], 'pad.lpf': [[0, 2400], [8, 9000]] },
    },
    full: {
      bars: 16, chords: THEME_H + ' ' + THEME_H,
      play: ['fullLead', 'fullBrass', 'fullPad', 'fullBass',
        ['fullArp8', 'fullArp16'],
        { p: 'fullCounter', at: 8 }, { p: 'fullChoir', at: 8 },
        ['grooveA', 'grooveA', 'grooveA', 'fillA', 'grooveA', 'grooveA', 'grooveA', 'fillB'],
        ['crashBar', null, null, null, null, null, null, null],
        { p: 'taikoHi', when: { min: 0.75 } }],
    },
    breakdown: {
      bars: 8, chords: BREAK_H,
      play: ['brPad', 'brChoir', { p: 'brDrone', until: 4 }, { p: 'brBass', at: 4 }, 'brHarp', { p: 'brBell', once: true },
        { p: 'brStrings', at: 4 }, { p: 'brLead', at: 4 }, 'brFx',
        [null, null, null, null, 'heart', 'heart', 'heart2', 'brRoll']],
      auto: { 'pad.lpf': [[0, 1100], [4, 1800], [8, 7000]] },
    },
    return: {
      bars: 8, chords: RETURN_H,
      play: ['retLead', 'retStrings', 'retPad', 'retChoir', 'retBrass', 'retBass', { p: 'retArp', until: 7 }, 'retFx',
        ['four', 'four', 'four', 'four', 'four', 'fourFill', 'four', 'finalHit'],
        { p: 'taikoHi', when: { min: 0.75 }, until: 7 }],
    },
  },

  arrangement: ['intro', 'build', 'full', 'breakdown', 'return'],
  loop: 'build',
};
