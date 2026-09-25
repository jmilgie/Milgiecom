// Nova Lancers — music engine.
//
// A small "DAW in a module": instruments are synthesized once into AudioBuffers with
// OfflineAudioContext (multi-sampled, perfectly looping) or played by light live-synth
// voices (leads / acid / risers), sequenced by a lookahead scheduler from data-only song
// modules in ./songs/*.js, and mixed through per-channel strips, reverb + ping-pong delay
// sends, kick-keyed sidechain ducking, glue compression and a ceiling limiter into
// AudioSys.musicBus.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
//  SONG FORMAT  (for composers — read this once, then copy title.js / aurora.js)
// ═══════════════════════════════════════════════════════════════════════════════════════
//
//  A song is `export default { ... }` in js/audio/songs/<track>.js. Plain data (plus any
//  helper calls you like — songs may import from '../music.js' and './motifs.js').
//
//  TIME GRID: one "step" = a 16th note (stepsPerBeat 4, beatsPerBar 4 → 16 steps/bar).
//
//  {
//    title: 'Aurora Ring',
//    bpm: 132,
//    swing: 0,                  // 0..0.5: delays odd 16ths by swing × step (0.33 ≈ triplet shuffle)
//    beatsPerBar: 4,            // optional (default 4)
//    stepsPerBeat: 4,           // optional (default 4)
//    key: 'E', scale: 'minor',  // tonic + scale: used by stingers (transposed to your key) + the
//                               //   dev harmony checker (dev/music.html). Scales: see SCALES.
//    gain: 0.8,                 // song master level (default 0.8). Keep peaks ≤ −1 dBFS (dev page).
//    reverb: 1,                 // reverb return level multiplier (default 1)
//    delay: { beats: 0.75, feedback: 0.35, lp: 3800, hp: 300 },  // tempo-synced ping-pong delay
//    duck: { release: 0.22 },   // sidechain duck recovery time (s)
//    seed: 7,                   // RNG seed for humanize (deterministic renders)
//
//    instruments: {             // optional custom patches (tweaks of library patches)
//      myPad:  { base: 'pad', cutoff: 1400, detune: 30, a: 1.2, r: 2.5 },
//      myLead: { type: 'lead', wave: 'square', vib: 20 },   // or a raw type + params
//    },                         // (see LIBRARY / TYPES below for every patch + param)
//
//    channels: {                // one mixer strip per channel; key = channel name
//      kick:  { gain: 0.9, sidechain: true },       // inst defaults to the channel name
//      bass:  { inst: 'bass', gain: 0.55, duck: 0.5, lpf: 1200 },
//      pad:   { inst: 'myPad', gain: 0.4, duck: 0.6, reverb: 0.35, pan: 0 },
//      hat16: { inst: 'hat', gain: 0.3, pan: 0.3, layer: { min: 0.7 } },   // intensity layer
//    },
//
//    patterns: {                // multi-channel clips. key = channel name → line
//      beat:  { kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.' },
//      bassA: { bass: 'E1 - E2 . E1 - E2 . C2 - C3 . D2 - D3 .' },
//      padA:  { step: 16, pad: 'E3m7 C3maj7 G3maj D3sus4' },          // 1 token = 1 bar
//      arpA:  { arp: arp(voiceLead(['Em','C','G','D']), { rate: 2 }) },  // helper-generated events
//    },
//
//    sections: {
//      intro: { bars: 4, play: ['padA', 'arpA'], chords: 'Em C G D',
//               auto: { 'pad.lpf': [[0, 400], [4, 6000]] } },
//      verse: { bars: 8, play: ['padA', 'bassA', ['beat', 'beat', 'beat', 'fill']] },
//      drop:  { bars: 8, play: [...], mute: ['arp'] },
//    },
//    arrangement: ['intro', 'verse', 'verse', { s: 'drop', tr: 2 }, 'verse'],
//    loop: 1,                   // arrangement index (or section name) to jump back to at the
//                               //   end; `false` = play once and stop (jingles)
//  }
//
//  LINES (the value of a channel key inside a pattern) — three forms:
//   1. Drum string: every char is one step: X accent(1.0)  x normal(0.8)  o soft(0.55)
//      g ghost(0.3)  . rest  - hold  r roll (2 hits)  R roll (3 hits)  f flam.  '|' and spaces
//      are ignored. Plays the instrument's default pitch.  e.g. 'x..x ..x. x... x.xx'
//   2. Token string: whitespace-separated tokens, each lasting `step` steps (pattern.step,
//      default 1 = a 16th). '|' tokens are ignored (use them as bar lines).
//        .        rest               -      hold (extends the previous note by one token)
//        A4 C#5 Bb3                 single notes (scientific pitch, C4 = middle C = MIDI 60)
//        A3m7  C4maj  F3sus2        chord symbols with the ROOT's octave (a bare "C4" is a note;
//                                    use C4maj / C4M for a major triad). Qualities: CHORD_TYPES.
//        A3m7^1                     inversion (^1 first, ^2 second…)
//        E3+B3+D4+G4               explicit voicing (notes joined with +)
//        x X o g                    drum hits (in a token line)
//        suffixes:  !  accent (vel 1.0)   ?  soft (×0.6)   @0.65  explicit velocity
//        prefix:    ~  glide/slide from the previous note (mono lead/acid: legato portamento)
//        repeat:    *n  the token lasts n slots, e.g. 'A4*6 C5*2' == 'A4 - - - - - C5 -'
//   3. Event array: [[step, note, len = 1, vel = pattern vel, { glide }], ...]  (steps are grid
//      steps regardless of pattern.step; note may be a name, MIDI number, chord token, array)
//   A line may also be { step, vel, n: <line> } to give that line its own resolution.
//  Pattern options: step (token length in steps), len (total steps; default: longest line
//  rounded UP to whole bars), vel (default velocity, 0.8).
//
//  SECTIONS: bars + play (lanes). Each lane loops independently to fill the section:
//      'patName'                        loop one pattern
//      ['a', 'a', 'b', 'fill']          a chain (each item plays its own length, then the next)
//      null or '_' inside a chain       one bar of silence
//      { p: 'name' | [...], at: 2, until: 6, once: true, tr: 5, vel: 0.8, when: { min: 0.7 } }
//        at/until = bar offsets inside the section, once = don't loop, tr = semitones,
//        when = intensity gate (checked each time the item starts → switches on bar lines)
//   Chain items may be objects too: { p: 'bassA', tr: -2 }.
//   Section options: chords (analysis only: one token per bar, 'Am7,G' splits a bar),
//   mute: [channels], tr (semitones, whole section), auto (automation, below).
//   Arrangement entries: 'name' or { s: 'name', tr: 2, when: { min: 0.8 } } (skipped if the
//   gate fails). Transposition never applies to drum/FX instruments.
//
//  AUTOMATION: auto: { 'channel.param': [[bar, value], ...] } (bar may be fractional; values
//   ramp from the channel's base value / previous point; last value holds to section end; at
//   the next section a param that is not automated there glides back to its base value).
//   Shorthand [from, to] = ramp across the whole section.
//     Strip params (smooth AudioParam ramps): vol (× channel gain), pan, lpf, hpf (Hz; the
//       strip filter is created automatically), reverb, delay (send levels).
//     Anything else is a PATCH param sampled at each note-on, e.g. 'acid.cutoff', 'acid.env',
//       'lead.vib', 'pad.a' — great for 303 knob twists.
//
//  CHANNEL OPTIONS: inst, gain (0.7), pan, reverb, delay (send levels 0..1), lpf, hpf, lpq
//   (strip filter resonance, dB), drive (0..1 saturation), duck (0..1 sidechain depth),
//   sidechain (true: this channel's notes trigger the ducking), layer ({min|max}: intensity
//   layer, fades in/out smoothly with Music.setIntensity), poly (voice limit), tr / oct
//   (transpose), vel (velocity scale), tune (semitones, drums), swing (false = ignore song
//   swing), human ({ t: sec, v: 0..1 } timing/velocity jitter), choke (['ohat']: cut those
//   channels' voices on each hit), note (default pitch for drum-string lines on melodic insts).
//
//  INTENSITY: Music.setIntensity(0..1), default 0.5 = the normal arrangement. Use channel
//   `layer` for extra parts that fade in at high intensity (boss: 1.0) or drop out at low
//   intensity, and lane/arrangement `when` gates for alternate grooves / sections.
//
//  MIXING TIPS: phones cannot reproduce < 90 Hz — give basses and kicks upper harmonics (the
//   library patches do) and never rely on 'sub' alone. Sustained notes use a/d/s/r envelopes;
//   one-shots (drums, pluck, bell, harp) ring out unless the patch sets gate: true. Check the
//   dev page (dev/music.html): peak ≤ −1 dBFS, no out-of-key notes, readable piano roll.
//
//  INSTRUMENT LIBRARY (LIBRARY below; every patch is levelled so a single note at channel gain
//  1 sits near −20 dBFS RMS — drums peak near −7 dBFS — so channel gains are pure mix decisions):
//    pads/ensembles  pad padBright padDark padGlass · strings stringsDark · brass brassSoft
//                    brassStab (gated) · choir choirOo choirOh · organ organFull
//    keys/plucks     pluck pluckSoft pluckLong (filtered saw) · harp (Karplus-Strong)
//                    bell glass keys (2-op FM)
//    basses          bass bassPluck bassSoft (saw+square+sub, filter pluck) · sub · reese · acid (live 303)
//    leads (live)    lead leadSquare leadSoft leadBright
//    drums           kick kickHard kick808 · snare snareBig (80s gated) snareTight · clap · hat ohat
//                    shaker · tom (pitched, base A2) · taiko (deep, base A1) · crash ride · rim
//    fx              impact · revcym (peak lands on the note END) · riser downlifter (live, length =
//                    note length; riser/downlifter lines with notes set the tonal sweep start)
//  Main params by type (render-time unless noted; see TYPES[type].defaults for all):
//    supersaw voices detune(cents) cutoff q kt(key-track) sub hp width air
//    strings  voices detune cutoff vib vibRate body     brass  cutoff peak fa fd sus q blip pulse drive
//    choir    vowel('ah','oh','oo','ee','eh') detune vib breath bright       organ  bars('868000000') chorus click
//    bass     square sub cutoff env fd q drive          reese  detune cutoff q sub drive
//    pluck    cutoff env decay amp q square detune      harp   bright t60 pos
//    fm       ratio index isus idecay decay (+ c2 m2 i2 d2 l2: second operator pair)
//    kick     f0 f1 pdecay decay click drive            snare  tone tone2 tdecay noise ndecay hp snap gateAt
//    lead     wave('saw'|'square'|'tri'|'sine'|'pulse') pw voices detune sub cutoff q env fa fd vib
//             vibRate vibDelay glide a d s r   (all play-time — automate them per section!)
//    acid     wave cutoff q env decay accent slide      (play-time; accent = vel ≥ 0.95)
//    all      vol a d s r (play-time envelope for sustained types) · gate (one-shots)
//  Render-time params are baked into samples when a song loads (each distinct combination costs
//  memory ~1–4 MB and render time, so prefer library patches and small variations).
//
//  INTEGRATION (main.js): Music.init() resolves once the title's first section is rendered
//  (~1 s); the rest renders in the background by priority. play() waits for the first section of
//  its track (a fade covers the gap), so it can be called any time. Music.preload(['cinder',
//  'boss']) during a results screen avoids render work while the next sector is being played.
//  Stingers are transposed to the current song's key and duck it while they play.
//
//  DEV TOOLS: dev/music.html — play/stop per track, intensity, stingers, offline render with
//  level plot, spectrogram, piano roll, harmony checker and per-channel level table. Programmatic:
//  Music.renderOffline(track | songObject, seconds, { intensity, section, solo, mute, raw }),
//  Music.validate(track) (compile warnings), Music.inspect(track), Music.stats(true).
//
//  Mini example (a complete, valid song):
//    import { arp, voiceLead } from '../music.js';
//    export default {
//      bpm: 120, key: 'A', scale: 'minor',
//      channels: { kick: { sidechain: true }, hat: { gain: 0.3 }, bass: { duck: 0.5 },
//                  pad: { gain: 0.4, duck: 0.6, reverb: 0.4 }, arp: { inst: 'pluck', delay: 0.3 } },
//      patterns: {
//        beat: { kick: 'x...x...x...x...', hat: '..x...x...x...x.' },
//        bass: { step: 2, bass: 'A1 A1 A2 A1 F1 F1 F2 F1 | C2 C2 C3 C2 G1 G1 G2 G1' },
//        pad:  { step: 16, pad: 'A3m F3maj C4maj G3maj' },
//        arp:  { arp: arp(voiceLead(['Am', 'F', 'C', 'G'], { low: 'A4', high: 'A5', voices: 3 }), { rate: 2 }) },
//      },
//      sections: { a: { bars: 4, play: ['beat', 'bass', 'pad', 'arp'], chords: 'Am F C G' } },
//      arrangement: ['a'], loop: 0,
//    };
// ═══════════════════════════════════════════════════════════════════════════════════════

import { AudioSys } from './audio.js';

const TAU = Math.PI * 2;
const LOOKAHEAD = 0.14;        // seconds scheduled ahead of ctx.currentTime (foreground)
const HIDDEN_LOOKAHEAD = 1.2;  // background tabs throttle timers to ~1 Hz
const TIMER_MS = 25;
const MAX_VOICES = 56;         // per deck (song instance)
export const TRACKS = ['title', 'aurora', 'cinder', 'veil', 'wreck', 'horizon', 'boss', 'finalboss', 'victory', 'gameover', 'lobby'];

// ─────────────────────────────────────────────────────────────────────────────────────
// 1. Music theory helpers (exported for song modules)
// ─────────────────────────────────────────────────────────────────────────────────────

const LETTERS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NOTE_RE = /^([A-G])(##|#|bb|b)?(-?\d)/;
const PC_RE = /^([A-G])(##|#|bb|b)?/;
const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const accVal = (a) => (!a ? 0 : a[0] === '#' ? a.length : -a.length);

/** MIDI note number → Hz. */
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** 'C#4' → 61 (numbers pass through). NaN if invalid. */
export function midi(x) {
  if (typeof x === 'number') return x;
  const m = NOTE_RE.exec(String(x));
  return m ? 12 * (+m[3] + 1) + LETTERS[m[1]] + accVal(m[2]) : NaN;
}

/** 61 → 'C#4' (or 'Db4' with flats = true). */
export function noteName(n, flats = false) {
  n = Math.round(n);
  return (flats ? FLATS : SHARPS)[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
}

/** Pitch class of a note / key name: 'Eb' → 3. */
export function pitchClass(name) {
  const m = PC_RE.exec(String(name));
  return m ? (LETTERS[m[1]] + accVal(m[2]) + 12) % 12 : NaN;
}

/** Chord qualities: intervals in semitones, ordered [root, 3rd-ish, 5th-ish, extensions…]. */
export const CHORD_TYPES = {
  '': [0, 4, 7], maj: [0, 4, 7], M: [0, 4, 7], m: [0, 3, 7], min: [0, 3, 7],
  '5': [0, 7, 12], dim: [0, 3, 6], aug: [0, 4, 8],
  sus2: [0, 2, 7], sus4: [0, 5, 7], sus: [0, 5, 7],
  '6': [0, 4, 7, 9], m6: [0, 3, 7, 9], '69': [0, 4, 7, 9, 14],
  '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], M7: [0, 4, 7, 11], m7: [0, 3, 7, 10], mM7: [0, 3, 7, 11],
  m7b5: [0, 3, 6, 10], dim7: [0, 3, 6, 9], '7sus4': [0, 5, 7, 10], '7b9': [0, 4, 7, 10, 13],
  add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14], sus2add9: [0, 2, 7, 14], add11: [0, 4, 7, 17],
  '9': [0, 4, 7, 10, 14], maj9: [0, 4, 7, 11, 14], m9: [0, 3, 7, 10, 14], m11: [0, 3, 7, 10, 14, 17],
  'maj7#11': [0, 4, 7, 11, 18], '13': [0, 4, 7, 10, 14, 21],
};

/** Scales as semitone sets (for degree helpers + the dev harmony checker). */
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11], melodic: [0, 2, 3, 5, 7, 9, 11], locrian: [0, 1, 3, 5, 6, 8, 10],
  pentatonic: [0, 2, 4, 7, 9], minpent: [0, 3, 5, 7, 10], chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

/** Parse a harmony symbol without octave: 'F#m7', 'C/E', 'Bbmaj9' → { root, iv, bass } | null. */
export function chordInfo(sym) {
  const m = PC_RE.exec(String(sym));
  if (!m) return null;
  let rest = sym.slice(m[0].length), bass = null;
  const sl = rest.indexOf('/');
  if (sl >= 0) { bass = pitchClass(rest.slice(sl + 1)); rest = rest.slice(0, sl); }
  const iv = CHORD_TYPES[rest];
  if (!iv) return null;
  return { root: (LETTERS[m[1]] + accVal(m[2]) + 12) % 12, iv, bass };
}

/** Pitch classes of a harmony symbol ('Am7' → [9, 0, 4, 7]). */
export function chordPcs(sym) {
  const c = chordInfo(sym);
  if (!c) return [];
  const s = c.iv.map((i) => (c.root + i) % 12);
  if (c.bass != null && !s.includes(c.bass)) s.push(c.bass);
  return s;
}

/** Parse a line note token ('A4', 'A3m7', 'C4maj^1', 'E3+B3+G4', '60') → MIDI array | null. */
function parseNotes(tok) {
  if (typeof tok === 'number') return [tok];
  if (Array.isArray(tok)) {
    const out = [];
    for (const t of tok) { const n = parseNotes(t); if (!n) return null; out.push(...n); }
    return out;
  }
  tok = String(tok);
  if (/\+[A-G0-9]/.test(tok)) return parseNotes(tok.split('+'));
  if (/^\d+$/.test(tok)) return [+tok];
  let inv = 0;
  const ci = tok.indexOf('^');
  if (ci > 0) { inv = parseInt(tok.slice(ci + 1), 10) || 0; tok = tok.slice(0, ci); }
  const m = NOTE_RE.exec(tok);
  if (!m) return null;
  const root = midi(m[0]);
  const rest = tok.slice(m[0].length);
  if (rest === '') return [root];
  const iv = CHORD_TYPES[rest];
  if (!iv) return null;
  const notes = iv.map((i) => root + i);
  for (let k = 0; k < inv; k++) notes.push(notes.shift() + 12);
  return notes;
}

/** Chord → MIDI array. Accepts line tokens ('A3m7', 'C4maj^1', 'E3+G3+C4') or an octave-less
 *  symbol plus octave: chord('Am7', 3). */
export function chord(sym, octave = 4) {
  const n = parseNotes(sym);
  if (n) return n;
  const c = chordInfo(sym);
  if (!c) return [];
  const root = 12 * (octave + 1) + c.root;
  return c.iv.map((i) => root + i);
}

/** Smooth voice leading: turns ['Am7', 'Fmaj7', 'C', 'G'] into close voicings (MIDI arrays)
 *  inside [low, high] that move as little as possible. opt { low:'E3', high:'E5', voices:4,
 *  from: previous voicing (token or MIDI array), span: max semitone span (default 17),
 *  rootless: false (true: upper-structure voicing — 3rd, 7th/extensions, 5th before the root;
 *  good for choirs/strings above a pad) }. Tone priority when trimming: 3rd, extensions
 *  (7th/9th…), root, 5th. Adjacent minor 2nds are avoided when possible. null/'-' repeats. */
export function voiceLead(symbols, opt = {}) {
  const lo = midi(opt.low ?? 'E3'), hi = midi(opt.high ?? 'E5');
  const n = opt.voices ?? 4, maxSpan = opt.span ?? 17;
  let prev = opt.from ? (Array.isArray(opt.from) ? opt.from.slice() : parseNotes(opt.from)) : null;
  const out = [];
  for (const sym of symbols) {
    if (sym == null || sym === '-') { out.push(prev ? prev.slice() : []); continue; }
    const c = chordInfo(sym);
    if (!c) { out.push(prev ? prev.slice() : []); continue; }
    const order = [1];
    for (let i = 3; i < c.iv.length; i++) order.push(i);
    if (opt.rootless) order.push(2, 0); else order.push(0, 2);
    const pcs = [];
    for (const i of order) { const p = (c.root + c.iv[i]) % 12; if (!pcs.includes(p)) pcs.push(p); }
    let tones = pcs.slice(0, n);
    const fill = [c.root, (c.root + c.iv[2]) % 12, (c.root + c.iv[1]) % 12];
    for (let k = 0; tones.length < n && k < 6; k++) tones.push(fill[k % 3]);
    const cands = tones.map((p) => { const a = []; for (let m = lo; m <= hi; m++) if (((m % 12) + 12) % 12 === p) a.push(m); return a; });
    let best = null, bestCost = Infinity;
    const cur = new Array(tones.length);
    const walk = (i) => {
      if (i === tones.length) {
        const s = cur.slice().sort((a, b) => a - b);
        for (let k = 1; k < s.length; k++) if (s[k] === s[k - 1]) return;
        if (s[s.length - 1] - s[0] > maxSpan) return;
        let cost = 0;
        if (prev && prev.length === s.length) for (let k = 0; k < s.length; k++) cost += Math.abs(s[k] - prev[k]);
        else cost = Math.abs((s[0] + s[s.length - 1]) / 2 - (lo + hi) / 2) * 2;
        for (let k = 1; k < s.length; k++) {
          const d = s[k] - s[k - 1];
          if (d < 3 && s[k] < 55) cost += 4;          // low mud
          if (d === 1) cost += 9;                     // semitone rub between adjacent voices
        }
        cost += (s[s.length - 1] - s[0]) * 0.05;
        if (cost < bestCost) { bestCost = cost; best = s; }
        return;
      }
      for (const m of cands[i]) { cur[i] = m; walk(i + 1); }
    };
    walk(0);
    if (!best) best = tones.map((p) => lo + ((p - lo) % 12 + 12) % 12).sort((a, b) => a - b);
    out.push(best);
    prev = best;
  }
  return out;
}

/** Arpeggiator → event array for a pattern line. chords: MIDI arrays or chord tokens, one per
 *  `len` steps. opt { rate: 1 (steps per note), len: 16, order: 'up'|'down'|'updown'|'downup'|
 *  'random'|[indices into the note pool; ≥ pool size wraps up an octave], oct: 1 (octaves),
 *  gate: 0.9, vel: 0.75, accent: 0.15 (added on beats), start: 0 (step offset), seed,
 *  continue: false (true: the order index keeps counting across chords instead of restarting —
 *  use it with half-bar chords so a bar-long figure flows through a mid-bar chord change) }. */
export function arp(chords, opt = {}) {
  const rate = opt.rate ?? 1, span = opt.len ?? 16, oct = opt.oct ?? 1, gate = opt.gate ?? 0.9;
  const vel = opt.vel ?? 0.75, accent = opt.accent ?? 0.15, start = opt.start ?? 0;
  const rnd = rng32(opt.seed ?? 3);
  const evs = [];
  let K = 0;
  chords.forEach((c, ci) => {
    if (c == null) return;
    const notes = (Array.isArray(c) ? c : parseNotes(c) || []).slice().sort((a, b) => a - b);
    if (!notes.length) return;
    const pool = [];
    for (let k = 0; k < oct; k++) for (const m of notes) pool.push(m + 12 * k);
    let seq;
    const order = opt.order ?? 'up';
    if (Array.isArray(order)) seq = order.map((i) => pool[((i % pool.length) + pool.length) % pool.length] + 12 * Math.floor(i / pool.length));
    else if (order === 'down') seq = pool.slice().reverse();
    else if (order === 'updown') seq = pool.concat(pool.slice(1, -1).reverse());
    else if (order === 'downup') { const d = pool.slice().reverse(); seq = d.concat(d.slice(1, -1).reverse()); }
    else seq = pool;
    for (let s = 0, k = 0; s < span - 1e-9; s += rate, k++, K++) {
      const m = order === 'random' ? pool[Math.floor(rnd() * pool.length)] : seq[(opt.continue ? K : k) % seq.length];
      const at = start + ci * span + s;
      const onBeat = Math.abs(at % 4) < 1e-6;
      evs.push([at, m, rate * gate, Math.min(1, onBeat ? vel + accent : vel)]);
    }
  });
  return evs;
}

/** Transpose every note name in a token line: transpose('A4 - C5m7 ~E5', 3). */
export function transpose(line, semis, flats = false) {
  if (Array.isArray(line)) {
    return line.map((e) => {
      const c = e.slice();
      const n = parseNotes(c[1]);
      if (n) c[1] = n.length === 1 ? n[0] + semis : n.map((m) => m + semis);
      return c;
    });
  }
  return String(line).replace(/(^|[\s+~])([A-G](?:##|#|bb|b)?-?\d)/g, (_, pre, n) => pre + noteName(midi(n) + semis, flats || /b/.test(n.slice(1))));
}

/** Repeat a token string n times: rep('x . x .', 4). */
export const rep = (s, n) => new Array(n).fill(s).join(' ');

// ─────────────────────────────────────────────────────────────────────────────────────
// 2. DSP utilities
// ─────────────────────────────────────────────────────────────────────────────────────

function rng32(seed) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    let t = (s = (s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const OACtor = () => (typeof window !== 'undefined' ? window.OfflineAudioContext || window.webkitOfflineAudioContext : null);

function renderOAC(oac) {
  return new Promise((resolve, reject) => {
    let done = false;
    const fin = (b) => { if (!done) { done = true; resolve(b); } };
    oac.oncomplete = (e) => fin(e.renderedBuffer);
    try {
      const p = oac.startRendering();
      if (p && p.then) p.then(fin, reject);
    } catch (e) { reject(e); }
  });
}

const yieldTask = () => new Promise((r) => setTimeout(r, 0));

function newBuffer(nch, len, sr) {
  try { return new AudioBuffer({ numberOfChannels: nch, length: Math.max(1, len), sampleRate: sr }); } catch { /* old Safari */ }
  const C = OACtor();
  return new C(nch, Math.max(1, len), sr).createBuffer(nch, Math.max(1, len), sr);
}

let NOISE = null; // shared 2 s mono white noise
function noiseBuffer() {
  if (!NOISE) {
    const sr = 44100, b = newBuffer(1, sr * 2, sr), d = b.getChannelData(0), r = rng32(12345);
    for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
    NOISE = b;
  }
  return NOISE;
}

const waveCache = new WeakMap();
function sawWave(ctx, phase, n = 160) {
  const re = new Float32Array(n + 1), im = new Float32Array(n + 1);
  for (let k = 1; k <= n; k++) { re[k] = Math.sin(k * phase) / k; im[k] = Math.cos(k * phase) / k; }
  return ctx.createPeriodicWave(re, im);
}
function pulseWave(ctx, duty, phase = 0, n = 160) {
  const re = new Float32Array(n + 1), im = new Float32Array(n + 1);
  for (let k = 1; k <= n; k++) {
    const a = (2 / (k * Math.PI)) * Math.sin(Math.PI * k * duty);
    re[k] = a * Math.cos(k * phase); im[k] = a * Math.sin(k * phase);
  }
  return ctx.createPeriodicWave(re, im);
}
const SAW_PHASES = (() => { const r = rng32(99), a = []; for (let i = 0; i < 9; i++) a.push(r() * TAU); return a; })();
function waves(ctx) {
  let w = waveCache.get(ctx);
  if (!w) {
    // saw[i] is built on first use (PeriodicWave tables cost ~1 ms each on the main thread)
    const saws = [];
    w = {
      saw: new Proxy(saws, { get: (t, k) => (k === 'length' ? 9 : typeof k === 'string' && /^\d+$/.test(k) ? (t[k] || (t[k] = sawWave(ctx, SAW_PHASES[+k % 9]))) : t[k]) }),
      pulse: new Map(), organ: new Map(),
    };
    waveCache.set(ctx, w);
  }
  return w;
}
function getPulse(ctx, duty) {
  const w = waves(ctx), k = Math.round(duty * 100);
  if (!w.pulse.has(k)) w.pulse.set(k, pulseWave(ctx, k / 100));
  return w.pulse.get(k);
}
function setWave(o, ctx, wave, pw) {
  if (wave === 'saw' || wave === 'sawtooth') o.type = 'sawtooth';
  else if (wave === 'tri' || wave === 'triangle') o.type = 'triangle';
  else if (wave === 'sine') o.type = 'sine';
  else if (wave === 'square' && !(pw > 0 && pw !== 0.5)) o.type = 'square';
  else o.setPeriodicWave(getPulse(ctx, pw || 0.5));
}

let NYQ = 20000;   // highest safe frequency for the context being built (set while rendering sets)
function mkOsc(ctx, wave, f, t0, t1) {
  const o = ctx.createOscillator();
  if (typeof wave === 'string') o.type = wave; else o.setPeriodicWave(wave);
  o.frequency.value = Math.min(f, NYQ);
  o.start(t0);
  if (t1 != null) o.stop(t1);
  return o;
}
function mkGain(ctx, v) { const g = ctx.createGain(); g.gain.value = v; return g; }
function mkFilter(ctx, type, f, q = 0, db = 0) {
  const b = ctx.createBiquadFilter();
  b.type = type; b.frequency.value = Math.min(f, NYQ); b.Q.value = q;
  if (db) b.gain.value = db;
  return b;
}
function mkNoise(ctx, t0, t1, off = 0) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(); s.loop = true;
  s.start(t0, off % 1.9);
  if (t1 != null) s.stop(t1);
  return s;
}
function mkPan(ctx, v) { const p = ctx.createStereoPanner(); p.pan.value = v; return p; }
function tanhCurve(drive) {
  const n = 1024, c = new Float32Array(n), k = 1 + drive * 8, norm = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / norm; }
  return c;
}
function mkShaper(ctx, drive) { const w = ctx.createWaveShaper(); w.curve = tanhCurve(drive); return w; }
function chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }
const clampF = (f) => Math.max(20, Math.min(NYQ, f));
const velGain = (v) => Math.pow(Math.max(0, v), 1.4);

/** Cancel future automation and hold the current value (fallback for Firefox). */
function holdAt(param, t) {
  if (param.cancelAndHoldAtTime) { try { param.cancelAndHoldAtTime(t); return; } catch { /* fall through */ } }
  const v = param.value;
  param.cancelScheduledValues(t);
  param.setValueAtTime(v, t);
}

// Generated stereo hall IR: pre-delay, early reflections, dense tail that darkens as it decays.
const irCache = new Map();
function impulse(ctx) {
  const sr = ctx.sampleRate;
  if (irCache.has(sr)) return irCache.get(sr);
  const secs = 1.9, rt60 = 2.3, len = Math.floor(secs * sr), fadeFrom = Math.floor(1.6 * sr);
  const b = ctx.createBuffer(2, len, sr), r = rng32(777);
  const pre = Math.floor(0.014 * sr);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const env = Math.exp((-6.91 * t) / rt60) * Math.min(1, t / 0.03 + 0.15);
      const fc = 1400 + 9500 * Math.exp(-t / 0.55);
      const a = 1 - Math.exp((-TAU * fc) / sr);
      lp += a * (r() * 2 - 1 - lp);
      d[i] = lp * env * (i > fadeFrom ? (len - i) / (len - fadeFrom) : 1);
    }
    for (let k = 0; k < 10; k++) {
      const i = pre + Math.floor((0.004 + r() * 0.075) * sr);
      if (i < len) d[i] += (r() < 0.5 ? -1 : 1) * 0.5 * (1 - k / 11) * (c === k % 2 ? 1 : 0.4);
    }
  }
  irCache.set(sr, b);
  return b;
}

// ─────────────────────────────────────────────────────────────────────────────────────
// 3. Instrument types
//    kind 'sample': rendered once per patch into one AudioBuffer holding a region per
//      sampled pitch. Sustained types render a perfectly periodic loop (every oscillator is
//      snapped to a multiple of 1/L Hz, L = loop length) so loops are seamless; the exact
//      rendered pitch is stored and playbackRate corrects the tuning.
//    kind 'live': synthesized per note at play time (modulation, glide, length-dependent FX).
//    Common play-time params: vol (level), a d s r (envelope, sustained types), gate
//    (one-shots: release at note end), poly (default voice limit).
// ─────────────────────────────────────────────────────────────────────────────────────

const PLAY_KEYS = new Set(['vol', 'a', 'd', 's', 'r', 'gate', 'poly', 'type', 'base', 'note']);

const VOWELS = {
  ah: [[800, 80, 1], [1150, 90, 0.5], [2900, 120, 0.12], [3900, 130, 0.06]],
  oh: [[450, 70, 1], [800, 80, 0.4], [2830, 100, 0.06], [3800, 130, 0.03]],
  oo: [[350, 50, 1], [600, 60, 0.2], [2700, 170, 0.04], [3800, 180, 0.02]],
  ee: [[280, 60, 1], [2250, 90, 0.3], [2950, 100, 0.2], [3900, 120, 0.06]],
  eh: [[530, 60, 1], [1840, 90, 0.35], [2480, 120, 0.15], [3500, 130, 0.05]],
};

// Vibrato in cents raises the MEAN frequency by I0(ln2·depth/1200) (exponential FM). Dividing the
// carrier by it keeps the phase closing exactly after each loop, so vibrato'd loops stay seamless.
function vibComp(cents) { const x = (Math.LN2 * cents) / 1200, x2 = x * x; return 1 + x2 / 4 + (x2 * x2) / 64; }

// voice detune spread: returns offsets in Hz snapped to 1/L multiples, distinct and symmetric
function spreadHz(f, n, cents, L, curve = 1.3) {
  const out = [];
  let lastK = 0;
  const half = Math.floor(n / 2);
  for (let j = 1; j <= half; j++) {
    const x = n > 1 ? j / half : 0;
    const c = cents * Math.pow(x, curve);
    let k = Math.round((f * (Math.pow(2, c / 1200) - 1)) * L);
    if (k <= lastK) k = lastK + 1;
    lastK = k;
    out.push(k / L, -k / L);
  }
  if (n % 2) out.unshift(0);
  return out;
}

export const TYPES = {
  // ── lush detuned pad ──
  supersaw: {
    kind: 'sample', sustain: true, stereo: true, sr: 24000, range: [41, 89], every: 6, poly: 10, fdiv: 2,
    defaults: { voices: 7, detune: 24, cutoff: 2600, q: -1, kt: 0.35, sub: 0, hp: 110, width: 0.9, air: 0.015, pre: 0.25, L: 1.5, xf: 0.08, a: 0.45, d: 0.8, s: 0.85, r: 1.3, vol: 1.0 },
    render({ ctx, out, t0, f, p, end, L }) {
      const W = waves(ctx).saw;
      const sum = mkGain(ctx, 0);
      sum.gain.setValueAtTime(0, t0); sum.gain.linearRampToValueAtTime(1, t0 + 0.005);
      chain(sum, mkFilter(ctx, 'lowpass', clampF(p.cutoff * Math.pow(f / 261.6, p.kt)), p.q), mkFilter(ctx, 'highpass', p.hp, -3), out);
      const offs = spreadHz(f, Math.max(1, p.voices | 0), p.detune, L);
      offs.forEach((df, i) => {
        const o = mkOsc(ctx, W[i % W.length], f + df, t0, end);
        const side = i === 0 && df === 0 ? 0 : (i % 2 ? 1 : -1) * (0.35 + 0.65 * Math.min(1, Math.abs(df) / (offs[offs.length - 1] ? Math.abs(offs[offs.length - 1]) : 1)));
        chain(o, mkGain(ctx, (df === 0 ? 1 : 0.8) / Math.sqrt(offs.length)), mkPan(ctx, side * p.width), sum);
      });
      if (p.sub > 0) chain(mkOsc(ctx, 'sine', f / 2, t0, end), mkGain(ctx, p.sub * 0.5), sum);
      if (p.air > 0) chain(mkNoise(ctx, t0, end, f), mkFilter(ctx, 'bandpass', 6000, 0.7), mkGain(ctx, p.air), sum);
    },
  },

  // ── analog string machine / ensemble ──
  strings: {
    kind: 'sample', sustain: true, stereo: true, sr: 24000, range: [43, 97], every: 6, poly: 10,
    defaults: { voices: 4, detune: 10, cutoff: 3600, kt: 0.3, hp: 200, vib: 9, vibRate: 5.5, body: 3, pre: 0.2, L: 1.5, xf: 0, a: 0.28, d: 0.5, s: 0.9, r: 0.9, vol: 1.2 },
    render({ ctx, out, t0, f, p, end, L, snap }) {
      const W = waves(ctx).saw;
      const sum = mkGain(ctx, 0);
      sum.gain.setValueAtTime(0, t0); sum.gain.linearRampToValueAtTime(1, t0 + 0.005);
      chain(sum, mkFilter(ctx, 'peaking', 1300, 0.8, p.body), mkFilter(ctx, 'lowpass', clampF(p.cutoff * Math.pow(f / 261.6, p.kt)), -2), mkFilter(ctx, 'highpass', p.hp, -3), out);
      const offs = spreadHz(f, Math.max(2, p.voices | 0), p.detune, L, 1);
      offs.forEach((df, i) => {
        const o = mkOsc(ctx, W[(i + 3) % W.length], (f + df) / vibComp(p.vib), t0, end);
        const lfo = mkOsc(ctx, 'sine', Math.max(1 / L, snap(p.vibRate * (0.85 + 0.3 * (i / offs.length)))), t0, end);
        chain(lfo, mkGain(ctx, p.vib), o.detune);
        chain(o, mkGain(ctx, 1 / Math.sqrt(offs.length)), mkPan(ctx, (i % 2 ? 0.7 : -0.7) * (0.4 + 0.6 * i / offs.length)), sum);
      });
    },
  },

  // ── analog poly brass (filter swell + pitch blip baked in) ──
  brass: {
    kind: 'sample', sustain: true, stereo: false, sr: 24000, range: [38, 86], every: 6, poly: 8,
    defaults: { detune: 8, pulse: 0.35, cutoff: 1500, kt: 0.5, peak: 2.6, sus: 1, fa: 0.07, fd: 0.3, q: 1, blip: 35, drive: 0.25, pre: 0.45, L: 1.5, xf: 0, a: 0.006, d: 0.3, s: 0.92, r: 0.28, vol: 0.65 },
    render({ ctx, out, t0, f, p, end, L }) {
      const sum = mkGain(ctx, 0);
      sum.gain.setValueAtTime(0, t0); sum.gain.linearRampToValueAtTime(1, t0 + 0.008);
      const base = clampF(p.cutoff * Math.pow(f / 261.6, p.kt));
      const lp = mkFilter(ctx, 'lowpass', base, p.q);
      lp.frequency.setValueAtTime(clampF(base * 0.25), t0);
      lp.frequency.exponentialRampToValueAtTime(clampF(base * p.peak), t0 + p.fa);
      lp.frequency.exponentialRampToValueAtTime(clampF(base * p.sus), t0 + Math.min(p.pre - 0.02, p.fa + p.fd));
      chain(sum, lp, mkShaper(ctx, p.drive), mkFilter(ctx, 'highpass', 80, -3), out);
      const W = waves(ctx).saw;
      const offs = spreadHz(f, 2, p.detune, L, 1);
      const oscs = offs.map((df, i) => mkOsc(ctx, W[i + 1], f + df, t0, end));
      if (p.pulse > 0) oscs.push(mkOsc(ctx, getPulse(ctx, 0.3), f, t0, end));
      oscs.forEach((o, i) => {
        o.detune.setValueAtTime(-p.blip, t0); o.detune.linearRampToValueAtTime(0, t0 + 0.07);
        chain(o, mkGain(ctx, i === 2 ? p.pulse * 0.8 : 0.6), sum);
      });
    },
  },

  // ── formant choir ──
  choir: {
    kind: 'sample', sustain: true, stereo: true, sr: 24000, range: [45, 87], every: 6, poly: 10,
    defaults: { vowel: 'ah', detune: 12, vib: 16, vibRate: 5, breath: 0.03, bright: 0.25, pre: 0.25, L: 1.5, xf: 0.1, a: 0.55, d: 0.5, s: 0.9, r: 1.4, vol: 1.75 },
    render({ ctx, out, t0, f, p, end, L, snap }) {
      const W = waves(ctx).saw;
      const V = VOWELS[p.vowel] || VOWELS.ah;
      [-1, 1].forEach((side, si) => {
        const src = mkGain(ctx, 0);
        src.gain.setValueAtTime(0, t0); src.gain.linearRampToValueAtTime(1, t0 + 0.01);
        spreadHz(f, 2, p.detune * (si ? 1 : 0.7), L, 1).forEach((df, i) => {
          const o = mkOsc(ctx, W[(i + si * 2) % W.length], (f + df * (si ? 1 : -1)) / vibComp(p.vib), t0, end);
          const lfo = mkOsc(ctx, 'sine', Math.max(1 / L, snap(p.vibRate * (0.9 + 0.1 * i + 0.07 * si))), t0, end);
          chain(lfo, mkGain(ctx, p.vib), o.detune);
          chain(o, mkGain(ctx, 0.5), src);
        });
        const pan = mkPan(ctx, side * 0.55);
        pan.connect(out);
        for (const [F, bw, g] of V) chain(src, mkFilter(ctx, 'bandpass', F * (1 + 0.02 * si), F / bw), mkGain(ctx, g * 3), pan);
        chain(src, mkFilter(ctx, 'lowpass', 2600, -3), mkGain(ctx, p.bright * 0.25), pan);
      });
      if (p.breath > 0) chain(mkNoise(ctx, t0, end, f), mkFilter(ctx, 'bandpass', 2400, 0.8), mkGain(ctx, p.breath), out);
    },
  },

  // ── drawbar organ ──
  organ: {
    kind: 'sample', sustain: true, stereo: false, sr: 24000, range: [36, 96], every: 6, poly: 10, fdiv: 2,
    defaults: { bars: '868000000', chorus: 1, click: 0.25, drive: 0.25, pre: 0.08, L: 1, xf: 0, a: 0.006, d: 0.1, s: 1, r: 0.12, vol: 0.34 },
    render({ ctx, out, t0, f, p, end, L, snap }) {
      const H = [1, 3, 2, 4, 6, 8, 10, 12, 16];
      const key = p.bars;
      let wave = waves(ctx).organ.get(key);
      if (!wave) {
        const re = new Float32Array(17), im = new Float32Array(17);
        String(key).split('').forEach((c, i) => { const v = +c; if (v > 0 && i < 9) im[H[i]] += Math.pow(10, ((v - 8) * 3) / 20); });
        wave = ctx.createPeriodicWave(re, im);
        waves(ctx).organ.set(key, wave);
      }
      const sum = mkGain(ctx, 0);
      sum.gain.setValueAtTime(0, t0); sum.gain.linearRampToValueAtTime(1, t0 + 0.004);
      chain(sum, mkShaper(ctx, p.drive), mkFilter(ctx, 'lowpass', 7000, -3), out);
      const half = f / 2;
      chain(mkOsc(ctx, wave, half, t0, end), mkGain(ctx, 0.6), sum);
      if (p.chorus > 0) chain(mkOsc(ctx, wave, half + p.chorus, t0, end), mkGain(ctx, 0.4), sum);
      if (p.click > 0) {
        const g = mkGain(ctx, 0);
        g.gain.setValueAtTime(p.click, t0); g.gain.setTargetAtTime(0, t0, 0.004);
        chain(mkNoise(ctx, t0, t0 + 0.05, f), mkFilter(ctx, 'bandpass', 2500, 1), g, out);
      }
    },
  },

  // ── analog bass (saw + square + sub, filter pluck baked into the attack) ──
  bass: {
    kind: 'sample', sustain: true, stereo: false, sr: 24000, range: [23, 65], every: 6, poly: 2,
    defaults: { square: 0.45, sub: 0.55, cutoff: 520, kt: 0.4, env: 2.4, fd: 0.22, q: 3, drive: 0.35, pre: 0.3, L: 1, xf: 0, a: 0.004, d: 0.25, s: 0.8, r: 0.07, vol: 0.6 },
    render({ ctx, out, t0, f, p, end }) {
      const sum = mkGain(ctx, 0);
      sum.gain.setValueAtTime(0, t0); sum.gain.linearRampToValueAtTime(1, t0 + 0.003);
      const base = clampF(p.cutoff * Math.pow(f / 65.4, p.kt));
      const lp = mkFilter(ctx, 'lowpass', base, p.q);
      lp.frequency.setValueAtTime(clampF(base * Math.pow(2, p.env)), t0);
      lp.frequency.exponentialRampToValueAtTime(base, t0 + Math.min(p.fd, p.pre - 0.02));
      chain(sum, lp, mkShaper(ctx, p.drive), mkFilter(ctx, 'highpass', 28, -3), out);
      chain(mkOsc(ctx, waves(ctx).saw[4], f, t0, end), mkGain(ctx, 0.55), sum);
      if (p.square > 0) chain(mkOsc(ctx, getPulse(ctx, 0.5), f, t0, end), mkGain(ctx, p.square * 0.5), sum);
      if (p.sub > 0) chain(mkOsc(ctx, 'sine', f, t0, end), mkGain(ctx, p.sub * 0.6), sum);
    },
  },

  // ── clean sub (sine + a touch of 2nd harmonic so phones hear it) ──
  sub: {
    kind: 'sample', sustain: true, stereo: false, sr: 24000, range: [23, 59], every: 6, poly: 2,
    defaults: { harm: 0.25, drive: 0.2, pre: 0.04, L: 1, xf: 0, a: 0.005, d: 0.2, s: 0.95, r: 0.08, vol: 0.3 },
    render({ ctx, out, t0, f, p, end }) {
      const sum = mkGain(ctx, 0);
      sum.gain.setValueAtTime(0, t0); sum.gain.linearRampToValueAtTime(1, t0 + 0.004);
      chain(sum, mkShaper(ctx, p.drive), out);
      chain(mkOsc(ctx, 'sine', f, t0, end), mkGain(ctx, 0.8), sum);
      if (p.harm > 0) chain(mkOsc(ctx, 'sine', f * 2, t0, end), mkGain(ctx, p.harm * 0.5), sum);
    },
  },

  // ── reese: detuned saws phasing against each other ──
  reese: {
    kind: 'sample', sustain: true, stereo: false, sr: 24000, range: [23, 59], every: 6, poly: 2, fdiv: 2,
    defaults: { detune: 16, cutoff: 900, kt: 0.3, q: 1, sub: 0.5, drive: 0.45, pre: 0.1, L: 2, xf: 0, a: 0.01, d: 0.3, s: 0.9, r: 0.12, vol: 0.6 },
    render({ ctx, out, t0, f, p, end, L, snap }) {
      const W = waves(ctx).saw;
      const sum = mkGain(ctx, 0);
      sum.gain.setValueAtTime(0, t0); sum.gain.linearRampToValueAtTime(1, t0 + 0.006);
      chain(sum, mkFilter(ctx, 'lowpass', clampF(p.cutoff * Math.pow(f / 65.4, p.kt)), p.q), mkShaper(ctx, p.drive), mkFilter(ctx, 'highpass', 28, -3), out);
      spreadHz(f, 3, p.detune, L, 1).forEach((df, i) => chain(mkOsc(ctx, W[i + 5], f + df, t0, end), mkGain(ctx, 0.4), sum));
      if (p.sub > 0) chain(mkOsc(ctx, 'sine', f / 2, t0, end), mkGain(ctx, p.sub * 0.5), sum);
    },
  },

  // ── filtered-saw pluck (arps) ──
  pluck: {
    kind: 'sample', sustain: false, stereo: false, sr: 32000, range: [38, 98], every: 6, poly: 8,
    len: (p) => Math.min(2.6, p.amp * 1.6 + 0.05),
    defaults: { square: 0.35, detune: 7, cutoff: 700, kt: 0.55, env: 3.6, decay: 0.26, amp: 0.75, q: 3, vol: 1.05, r: 0.12 },
    render({ ctx, out, t0, f, p, end }) {
      const W = waves(ctx).saw;
      const amp = mkGain(ctx, 0);
      amp.gain.setValueAtTime(0, t0); amp.gain.linearRampToValueAtTime(1, t0 + 0.002);
      amp.gain.setTargetAtTime(0, t0 + 0.002, p.amp / 4.5);
      const base = clampF(p.cutoff * Math.pow(f / 261.6, p.kt));
      const lp = mkFilter(ctx, 'lowpass', base, p.q);
      lp.frequency.setValueAtTime(clampF(base * Math.pow(2, p.env)), t0);
      lp.frequency.setTargetAtTime(base, t0, p.decay / 3);
      chain(lp, amp, out);
      const c = Math.pow(2, p.detune / 1200);
      chain(mkOsc(ctx, W[2], f * c, t0, end), mkGain(ctx, 0.5), lp);
      chain(mkOsc(ctx, W[6], f / c, t0, end), mkGain(ctx, 0.4), lp);
      if (p.square > 0) chain(mkOsc(ctx, getPulse(ctx, 0.5), f, t0, end), mkGain(ctx, p.square * 0.45), lp);
    },
  },

  // ── Karplus-Strong plucked string (computed in JS) ──
  harp: {
    kind: 'sample', sustain: false, stereo: false, sr: 32000, range: [38, 98], every: 6, poly: 8,
    len: (p, f) => p.t60 * Math.pow(220 / f, 0.3) * 0.8 + 0.1,
    defaults: { bright: 0.55, t60: 2.4, pos: 0.2, vol: 1.0, r: 0.2 },
    js(ch, sr, f, p, rng) {
      const out = ch[0], N = sr / f;
      const Lint = Math.max(2, Math.floor(N - 0.5)), frac = N - 0.5 - Lint;
      const C = (1 - frac) / (1 + frac);
      const buf = new Float32Array(Lint);
      const a = 0.12 + 0.85 * p.bright;
      let s = 0;
      for (let i = 0; i < Lint; i++) { s += a * (rng() * 2 - 1 - s); buf[i] = s; }
      const pp = Math.max(1, Math.round(p.pos * Lint));
      const exc = buf.slice();
      for (let i = 0; i < Lint; i++) buf[i] = exc[i] - exc[(i + pp) % Lint];
      const t60 = p.t60 * Math.pow(220 / f, 0.3);
      const loss = Math.pow(10, -3 / (t60 * f));
      let idx = 0, prev = 0, apx = 0, apy = 0, dc = 0, dcy = 0;
      for (let n = 0; n < out.length; n++) {
        const y = buf[idx];
        const avg = 0.5 * (y + prev); prev = y;
        const ap = C * avg + apx - C * apy; apx = avg; apy = ap;
        buf[idx] = ap * loss;
        dcy = y - dc + 0.995 * dcy; dc = y;
        out[n] = dcy;
        if (++idx >= Lint) idx = 0;
      }
      const fade = Math.floor(0.03 * sr);
      for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
    },
  },

  // ── 2-operator FM (bells, glass, electric piano) ──
  fm: {
    kind: 'sample', sustain: false, stereo: false, sr: 32000, range: [47, 101], every: 6, poly: 8,
    len: (p, f) => Math.min(4, p.decay * Math.pow(523 / f, 0.3) * 1.1 + 0.1),
    defaults: { ratio: 3.5, index: 2.4, isus: 0.2, idecay: 1.2, decay: 3, detune: 3, c2: 4.07, m2: 1, i2: 0.6, d2: 0.5, l2: 0.25, att: 0.002, vol: 0.78, r: 0.3 },
    render({ ctx, out, t0, f, p, end }) {
      [-1, 1].forEach((side) => {
        const fc = f * Math.pow(2, (side * p.detune) / 1200);
        const pan = mkPan(ctx, side * 0.35);
        pan.connect(out);
        const op = (cf, ratio, index, ideca, isus, dec, level) => {
          const car = mkOsc(ctx, 'sine', cf, t0, end);
          if (cf * ratio > NYQ) return;
          const mod = mkOsc(ctx, 'sine', cf * ratio, t0, end);
          const mg = mkGain(ctx, 0), dev = cf * ratio * index;
          mg.gain.setValueAtTime(dev, t0); mg.gain.setTargetAtTime(dev * isus, t0, ideca / 3);
          chain(mod, mg, car.frequency);
          const amp = mkGain(ctx, 0);
          amp.gain.setValueAtTime(0, t0); amp.gain.linearRampToValueAtTime(level, t0 + p.att);
          amp.gain.setTargetAtTime(0, t0 + p.att, dec / 4.5);
          chain(car, amp, pan);
        };
        op(fc, p.ratio, p.index, p.idecay, p.isus, p.decay * Math.pow(523 / f, 0.3), 0.7);
        if (p.l2 > 0 && fc * p.c2 * Math.max(1, p.m2 * (1 + p.i2)) < NYQ) op(fc * p.c2, p.m2, p.i2, p.d2, 0.1, p.d2, p.l2);
      });
    },
  },

  // ── drums ──
  kick: {
    kind: 'sample', fixed: true, note: 36, stereo: false, sr: 44100, poly: 2,
    len: (p) => p.decay * 1.3 + 0.05,
    defaults: { f0: 200, f1: 50, pdecay: 0.032, decay: 0.45, click: 0.5, drive: 0.4, vol: 0.9 },
    render({ ctx, out, t0, p, end }) {
      const o = mkOsc(ctx, 'sine', p.f0, t0, end);
      o.frequency.setValueAtTime(p.f0, t0); o.frequency.setTargetAtTime(p.f1, t0, p.pdecay);
      const amp = mkGain(ctx, 0);
      amp.gain.setValueAtTime(0, t0); amp.gain.linearRampToValueAtTime(1, t0 + 0.002);
      amp.gain.setValueAtTime(1, t0 + 0.03); amp.gain.setTargetAtTime(0, t0 + 0.03, p.decay / 5);
      chain(o, amp, mkShaper(ctx, p.drive), out);
      if (p.click > 0) {
        const g = mkGain(ctx, 0);
        g.gain.setValueAtTime(p.click, t0); g.gain.setTargetAtTime(0, t0, 0.0025);
        chain(mkNoise(ctx, t0, t0 + 0.04, 0.3), mkFilter(ctx, 'highpass', 1800, 0), g, out);
        const tick = mkOsc(ctx, 'triangle', 1500, t0, t0 + 0.02);
        const tg = mkGain(ctx, 0);
        tg.gain.setValueAtTime(p.click * 0.6, t0); tg.gain.setTargetAtTime(0, t0, 0.003);
        chain(tick, tg, out);
      }
    },
  },
  snare: {
    kind: 'sample', fixed: true, note: 50, stereo: false, sr: 44100, poly: 3,
    len: (p) => Math.max(p.ndecay * 1.6, p.gateAt || 0) + 0.08,
    defaults: { tone: 185, tone2: 330, tdecay: 0.11, noise: 0.85, ndecay: 0.22, hp: 1300, snap: 0.5, gateAt: 0, vol: 0.8 },
    render({ ctx, out, t0, p, end }) {
      [[p.tone, 1], [p.tone2, 0.55]].forEach(([fq, lv]) => {
        const o = mkOsc(ctx, 'triangle', fq * 1.35, t0, end);
        o.frequency.setValueAtTime(fq * 1.35, t0); o.frequency.exponentialRampToValueAtTime(fq, t0 + 0.02);
        const g = mkGain(ctx, 0);
        g.gain.setValueAtTime(lv, t0); g.gain.setTargetAtTime(0, t0, p.tdecay / 4);
        chain(o, g, out);
      });
      const ng = mkGain(ctx, 0);
      ng.gain.setValueAtTime(p.noise, t0);
      if (p.gateAt > 0) {
        ng.gain.setTargetAtTime(p.noise * 0.35, t0, 0.06);
        ng.gain.setValueAtTime(p.noise * 0.3, t0 + p.gateAt - 0.02); ng.gain.linearRampToValueAtTime(0, t0 + p.gateAt);
      } else ng.gain.setTargetAtTime(0, t0, p.ndecay / 4.5);
      chain(mkNoise(ctx, t0, end, 0.7), mkFilter(ctx, 'highpass', p.hp, 0), mkFilter(ctx, 'peaking', 5500, 0.8, 4), ng, out);
      if (p.snap > 0) {
        const g = mkGain(ctx, 0);
        g.gain.setValueAtTime(p.snap, t0); g.gain.setTargetAtTime(0, t0, 0.006);
        chain(mkNoise(ctx, t0, t0 + 0.05, 1.1), mkFilter(ctx, 'bandpass', 3200, 1.2), g, out);
      }
    },
  },
  clap: {
    kind: 'sample', fixed: true, note: 50, stereo: true, sr: 44100, poly: 2,
    len: (p) => p.tail * 1.7 + 0.08,
    defaults: { bursts: 4, spacing: 0.0105, bp: 1250, tail: 0.24, vol: 0.75 },
    render({ ctx, out, t0, p, end }) {
      [-1, 1].forEach((side, si) => {
        const g = mkGain(ctx, 0);
        for (let i = 0; i < p.bursts; i++) {
          const tb = t0 + i * p.spacing * (1 + 0.12 * si) + (si ? 0.0012 : 0);
          g.gain.setValueAtTime(0.8 + 0.2 * (i / p.bursts), tb);
          g.gain.setTargetAtTime(0, tb + 0.0004, i === p.bursts - 1 ? p.tail / 4.5 : 0.0032);
        }
        chain(mkNoise(ctx, t0, end, 0.2 + si * 0.9), mkFilter(ctx, 'bandpass', p.bp * (1 + 0.06 * side), 1.3), mkFilter(ctx, 'peaking', 3000, 1, 3), g, mkPan(ctx, side * 0.3), out);
      });
    },
  },
  hat: {
    kind: 'sample', fixed: true, note: 60, stereo: false, sr: 44100, poly: 3,
    len: (p) => p.decay * 1.8 + 0.03,
    defaults: { decay: 0.05, hp: 7200, metal: 0.65, noise: 0.45, tone: 1, vol: 0.75 },
    render({ ctx, out, t0, p, end }) {
      const amp = mkGain(ctx, 0);
      amp.gain.setValueAtTime(0, t0); amp.gain.linearRampToValueAtTime(1, t0 + 0.0015);
      amp.gain.setTargetAtTime(0, t0 + 0.0015, p.decay / 4);
      chain(amp, mkFilter(ctx, 'highpass', p.hp, 0), mkFilter(ctx, 'peaking', 10500, 1, 3), out);
      const metal = mkGain(ctx, p.metal / 6);
      metal.connect(mkFilter(ctx, 'bandpass', 10000, 0.8)).connect(amp);
      for (const fq of [205.3, 304.4, 369.6, 522.7, 540, 800]) mkOsc(ctx, 'square', fq * p.tone * 1.7, t0, end).connect(metal);
      chain(mkNoise(ctx, t0, end, 0.9), mkGain(ctx, p.noise), amp);
    },
  },
  shaker: {
    kind: 'sample', fixed: true, note: 60, stereo: false, sr: 44100, poly: 3,
    len: () => 0.16,
    defaults: { bp: 7500, vol: 0.6 },
    render({ ctx, out, t0, p, end }) {
      const g = mkGain(ctx, 0);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(1, t0 + 0.012); g.gain.setTargetAtTime(0, t0 + 0.014, 0.02);
      chain(mkNoise(ctx, t0, end, 1.3), mkFilter(ctx, 'bandpass', p.bp, 1.1), g, out);
    },
  },
  tom: {
    kind: 'sample', fixed: true, note: 45, stereo: false, sr: 44100, poly: 3,
    len: (p) => p.decay * 1.4 + 0.05,
    defaults: { decay: 0.5, bend: 1.6, noise: 0.3, drive: 0.25, vol: 0.8 },
    render({ ctx, out, t0, f, p, end }) {
      const amp = mkGain(ctx, 0);
      amp.gain.setValueAtTime(0, t0); amp.gain.linearRampToValueAtTime(1, t0 + 0.002); amp.gain.setTargetAtTime(0, t0 + 0.004, p.decay / 5);
      chain(amp, mkShaper(ctx, p.drive), out);
      const o = mkOsc(ctx, 'sine', f * p.bend, t0, end);
      o.frequency.setValueAtTime(f * p.bend, t0); o.frequency.exponentialRampToValueAtTime(f, t0 + 0.07);
      chain(o, mkGain(ctx, 0.9), amp);
      const o2 = mkOsc(ctx, 'sine', f * 1.59 * p.bend, t0, end);
      o2.frequency.setValueAtTime(f * 1.59 * p.bend, t0); o2.frequency.exponentialRampToValueAtTime(f * 1.59, t0 + 0.06);
      const g2 = mkGain(ctx, 0.3); g2.gain.setTargetAtTime(0, t0, p.decay / 12);
      chain(o2, g2, amp);
      const ng = mkGain(ctx, 0);
      ng.gain.setValueAtTime(p.noise, t0); ng.gain.setTargetAtTime(0, t0, 0.012);
      chain(mkNoise(ctx, t0, t0 + 0.1, 0.5), mkFilter(ctx, 'lowpass', 3000, 0), ng, out);
    },
  },
  taiko: {
    kind: 'sample', fixed: true, note: 33, stereo: false, sr: 44100, poly: 3,
    len: (p) => p.decay * 1.5 + 0.1,
    defaults: { decay: 1.1, bend: 1.45, skin: 0.6, slap: 0.35, drive: 0.3, vol: 1 },
    render({ ctx, out, t0, f, p, end }) {
      const amp = mkGain(ctx, 0);
      amp.gain.setValueAtTime(0, t0); amp.gain.linearRampToValueAtTime(1, t0 + 0.004); amp.gain.setTargetAtTime(0, t0 + 0.02, p.decay / 5);
      chain(amp, mkShaper(ctx, p.drive), out);
      const o = mkOsc(ctx, 'sine', f * p.bend, t0, end);
      o.frequency.setValueAtTime(f * p.bend, t0); o.frequency.exponentialRampToValueAtTime(f, t0 + 0.12);
      chain(o, mkGain(ctx, 1), amp);
      [[1.52, 0.35, 5], [2.18, 0.18, 9], [2.9, 0.08, 14]].forEach(([r, l, dd]) => {
        const m = mkOsc(ctx, 'sine', f * r * p.bend, t0, end);
        m.frequency.setValueAtTime(f * r * p.bend, t0); m.frequency.exponentialRampToValueAtTime(f * r, t0 + 0.1);
        const g = mkGain(ctx, l); g.gain.setTargetAtTime(0, t0, p.decay / dd);
        chain(m, g, amp);
      });
      const sk = mkGain(ctx, 0);
      sk.gain.setValueAtTime(p.skin, t0); sk.gain.setTargetAtTime(0, t0, 0.035);
      chain(mkNoise(ctx, t0, t0 + 0.4, 0.1), mkFilter(ctx, 'lowpass', 900, 0), sk, out);
      const sl = mkGain(ctx, 0);
      sl.gain.setValueAtTime(p.slap, t0); sl.gain.setTargetAtTime(0, t0, 0.008);
      chain(mkNoise(ctx, t0, t0 + 0.08, 0.6), mkFilter(ctx, 'bandpass', 2200, 1.5), sl, out);
    },
  },
  cymbal: {
    kind: 'sample', fixed: true, note: 60, stereo: true, sr: 44100, poly: 2,
    len: (p) => p.decay + 0.15,
    defaults: { decay: 2.6, hp: 3200, metal: 0.5, stick: 0.5, ping: 0, pingF: 540, bright: 1, vol: 0.67 },
    render({ ctx, out, t0, p, end }) {
      [-1, 1].forEach((side, si) => {
        const pan = mkPan(ctx, side * 0.45);
        pan.connect(out);
        const amp = mkGain(ctx, 0);
        amp.gain.setValueAtTime(0, t0); amp.gain.linearRampToValueAtTime(1, t0 + 0.003); amp.gain.setTargetAtTime(0, t0 + 0.003, p.decay / 5.5);
        chain(mkNoise(ctx, t0, end, 0.25 + si * 0.8), mkFilter(ctx, 'highpass', p.hp, 0), mkFilter(ctx, 'peaking', 7500 * p.bright, 0.7, 4), amp, pan);
        if (p.metal > 0) {
          const mg = mkGain(ctx, p.metal / 6);
          chain(mg, mkFilter(ctx, 'bandpass', 6500 * p.bright, 0.7), amp);
          for (const fq of [205.3, 304.4, 369.6, 522.7, 540, 800]) mkOsc(ctx, 'square', fq * (1.18 + 0.03 * si), t0, end).connect(mg);
        }
        if (p.stick > 0) {
          const sg = mkGain(ctx, 0);
          sg.gain.setValueAtTime(p.stick, t0); sg.gain.setTargetAtTime(0, t0, 0.02);
          chain(mkNoise(ctx, t0, t0 + 0.15, 1.7 + si), mkFilter(ctx, 'bandpass', 4800, 1), sg, pan);
        }
        if (p.ping > 0) {
          [1, 1.47, 1.98, 2.56, 3.21].forEach((r, i) => {
            const g = mkGain(ctx, 0);
            g.gain.setValueAtTime(p.ping / (i + 1.5), t0); g.gain.setTargetAtTime(0, t0, p.decay / (4 + i * 1.5));
            chain(mkOsc(ctx, 'sine', p.pingF * r * (1 + 0.004 * si), t0, end), g, pan);
          });
        }
      });
    },
  },
  rim: {
    kind: 'sample', fixed: true, note: 60, stereo: false, sr: 44100, poly: 2,
    len: () => 0.12,
    defaults: { vol: 0.6 },
    render({ ctx, out, t0, end }) {
      const g = mkGain(ctx, 0);
      g.gain.setValueAtTime(1, t0); g.gain.setTargetAtTime(0, t0, 0.007);
      chain(mkNoise(ctx, t0, end, 0.4), mkFilter(ctx, 'bandpass', 1800, 3), g, out);
      const t = mkOsc(ctx, 'triangle', 480, t0, end);
      const tg = mkGain(ctx, 0); tg.gain.setValueAtTime(0.7, t0); tg.gain.setTargetAtTime(0, t0, 0.01);
      chain(t, tg, out);
    },
  },

  // ── FX ──
  impact: {
    kind: 'sample', fixed: true, note: 36, stereo: true, sr: 44100, poly: 2,
    len: () => 4,
    defaults: { vol: 0.85 },
    render({ ctx, out, t0, end }) {
      const o = mkOsc(ctx, 'sine', 70, t0, end);
      o.frequency.setValueAtTime(70, t0); o.frequency.exponentialRampToValueAtTime(30, t0 + 1.4);
      const g = mkGain(ctx, 0);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(1, t0 + 0.005); g.gain.setTargetAtTime(0, t0 + 0.05, 0.45);
      chain(o, g, mkShaper(ctx, 0.5), out);
      [-1, 1].forEach((side, si) => {
        const lp = mkFilter(ctx, 'lowpass', 7000, 0);
        lp.frequency.setValueAtTime(7000, t0); lp.frequency.exponentialRampToValueAtTime(180, t0 + 2.2);
        const ng = mkGain(ctx, 0);
        ng.gain.setValueAtTime(0.75, t0); ng.gain.setTargetAtTime(0, t0 + 0.02, 0.6);
        chain(mkNoise(ctx, t0, end, si * 0.77), lp, ng, mkPan(ctx, side * 0.6), out);
      });
    },
  },
  revcym: {
    kind: 'sample', fixed: true, note: 60, stereo: true, sr: 44100, poly: 2, reverse: true,
    len: () => 2.4,
    defaults: { vol: 0.67 },
    render(c) {
      TYPES.cymbal.render({ ...c, p: { ...TYPES.cymbal.defaults, decay: 2.2, stick: 0.2 } });
    },
  },
  riser: {
    kind: 'live', poly: 2,
    defaults: { from: 300, to: 9000, q: 2.5, tone: 0.3, rise: 12, note: 60, vol: 0.6 },
    voice(d, ch, m, t, dur, vel, ev, p) {
      const ctx = d.ctx, end = t + dur + 0.25;
      const src = mkNoise(ctx, t, end, d.rng() * 1.9);
      const bp = mkFilter(ctx, 'bandpass', p.from, p.q);
      bp.frequency.setValueAtTime(p.from, t); bp.frequency.exponentialRampToValueAtTime(p.to, t + dur);
      const amp = mkGain(ctx, 0), peak = velGain(vel) * p.vol;
      amp.gain.setValueAtTime(peak * 0.03, t); amp.gain.exponentialRampToValueAtTime(peak, t + dur);
      amp.gain.setTargetAtTime(0, t + dur, 0.035);
      chain(src, bp, amp, ch.input);
      const srcs = [src];
      if (p.tone > 0) {
        const f = mtof(m == null ? p.note : m);
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * Math.pow(2, p.rise / 12), t + dur);
        o.start(t); o.stop(end);
        const lp = mkFilter(ctx, 'lowpass', p.from, 2);
        lp.frequency.setValueAtTime(p.from, t); lp.frequency.exponentialRampToValueAtTime(p.to * 0.6, t + dur);
        chain(o, lp, mkGain(ctx, p.tone * 0.5), amp);
        srcs.push(o);
      }
      src.onended = () => amp.disconnect();
      d.addVoice(ch, { t, end, g: amp, srcs });
    },
  },
  downlifter: {
    kind: 'live', poly: 2,
    defaults: { from: 7000, to: 150, q: 2, tone: 0.25, fall: -12, note: 72, vol: 0.6 },
    voice(d, ch, m, t, dur, vel, ev, p) {
      const ctx = d.ctx, end = t + dur + 0.1;
      const src = mkNoise(ctx, t, end, d.rng() * 1.9);
      const bp = mkFilter(ctx, 'bandpass', p.from, p.q);
      bp.frequency.setValueAtTime(p.from, t); bp.frequency.exponentialRampToValueAtTime(p.to, t + dur);
      const amp = mkGain(ctx, 0), peak = velGain(vel) * p.vol;
      amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(peak, t + 0.01);
      amp.gain.exponentialRampToValueAtTime(peak * 0.004, t + dur);
      amp.gain.linearRampToValueAtTime(0, t + dur + 0.05);
      chain(src, bp, amp, ch.input);
      const srcs = [src];
      if (p.tone > 0) {
        const f = mtof(m == null ? p.note : m);
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * Math.pow(2, p.fall / 12), t + dur);
        o.start(t); o.stop(end);
        chain(o, mkFilter(ctx, 'lowpass', 2500, 0), mkGain(ctx, p.tone * 0.5), amp);
        srcs.push(o);
      }
      src.onended = () => amp.disconnect();
      d.addVoice(ch, { t, end, g: amp, srcs });
    },
  },

  // ── live mono lead: detuned oscs, filter env, delayed vibrato, legato portamento (~) ──
  lead: {
    kind: 'live', poly: 1,
    defaults: { wave: 'saw', pw: 0.5, voices: 2, detune: 9, sub: 0, cutoff: 2400, q: 1, kt: 0.5, env: 1.3, fa: 0.012, fd: 0.35, vib: 16, vibRate: 5.6, vibDelay: 0.28, glide: 0.07, a: 0.006, d: 0.3, s: 0.8, r: 0.2, vol: 0.6 },
    voice(d, ch, m, t, dur, vel, ev, p) {
      const ctx = d.ctx, f = mtof(m), prev = ch.last;
      const legato = !!(ev && ev.g && prev && prev.f && prev.rel >= t - 0.03);
      const f0 = legato ? prev.f : f;
      const end = t + Math.max(dur, 0.01) + p.r * 1.6 + 0.03;
      const amp = mkGain(ctx, 0);
      const lp = mkFilter(ctx, 'lowpass', 1000, p.q);
      chain(lp, amp, ch.input);
      const srcs = [];
      const n = Math.max(1, p.voices | 0);
      const lfoG = p.vib > 0 ? mkGain(ctx, 0) : null;
      const addOsc = (wave, fr, det, lvl) => {
        const o = ctx.createOscillator();
        setWave(o, ctx, wave, p.pw);
        o.frequency.setValueAtTime(fr * f0 / f, t);
        if (legato) o.frequency.setTargetAtTime(fr, t, Math.max(0.004, p.glide / 3));
        o.detune.value = det;
        if (lfoG) lfoG.connect(o.detune);
        chain(o, mkGain(ctx, lvl), lp);
        o.start(t); o.stop(end);
        srcs.push(o);
      };
      for (let i = 0; i < n; i++) addOsc(p.wave, f, n > 1 ? (i / (n - 1) * 2 - 1) * p.detune : 0, 0.7 / Math.sqrt(n));
      if (p.sub > 0) addOsc('sine', f / 2, 0, p.sub * 0.5);
      if (lfoG) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = p.vibRate;
        lfo.connect(lfoG);
        const vd = legato ? 0.05 : p.vibDelay;
        lfoG.gain.setValueAtTime(0, t); lfoG.gain.setValueAtTime(0, t + vd);
        lfoG.gain.linearRampToValueAtTime(p.vib, t + vd + 0.35);
        lfo.start(t); lfo.stop(end);
        srcs.push(lfo);
      }
      const base = clampF(p.cutoff * Math.pow(f / 440, p.kt) * (0.55 + 0.45 * vel));
      const fq = lp.frequency;
      if (legato) { fq.setValueAtTime(clampF(base * Math.pow(2, p.env * 0.3)), t); fq.setTargetAtTime(base, t, p.fd / 3); }
      else { fq.setValueAtTime(base, t); fq.linearRampToValueAtTime(clampF(base * Math.pow(2, p.env)), t + p.fa); fq.setTargetAtTime(base, t + p.fa, p.fd / 3); }
      const peak = velGain(vel) * p.vol, g = amp.gain;
      const a = legato ? 0.012 : Math.max(0.003, Math.min(p.a, dur));
      g.setValueAtTime(0, t); g.linearRampToValueAtTime(legato ? peak * p.s : peak, t + a);
      if (!legato && p.s < 1) g.setTargetAtTime(peak * p.s, t + a, p.d / 3);
      g.setTargetAtTime(0, t + Math.max(dur, a), Math.max(0.005, p.r / 4));
      srcs[0].onended = () => { amp.disconnect(); if (lfoG) lfoG.disconnect(); };
      d.addVoice(ch, { t, end, g: amp, srcs, f, rel: t + dur });
    },
  },

  // ── live 303-style acid: resonant filter env, accent (vel ≥ 0.95), slide (~) ──
  acid: {
    kind: 'live', poly: 1,
    defaults: { wave: 'saw', pw: 0.5, cutoff: 360, q: 16, env: 3.2, decay: 0.26, accent: 0.6, slide: 0.065, drive: 0, a: 0.003, s: 0.85, r: 0.03, vol: 0.3 },
    voice(d, ch, m, t, dur, vel, ev, p) {
      const ctx = d.ctx, f = mtof(m), prev = ch.last;
      const legato = !!(ev && ev.g && prev && prev.f && prev.rel >= t - 0.03);
      const acc = vel >= 0.95;
      const end = t + Math.max(dur, 0.01) + p.r * 2 + 0.03;
      const o = ctx.createOscillator();
      setWave(o, ctx, p.wave, p.pw);
      o.frequency.setValueAtTime(legato ? prev.f : f, t);
      if (legato) o.frequency.setTargetAtTime(f, t, p.slide / 3);
      const lp = mkFilter(ctx, 'lowpass', p.cutoff, p.q + (acc ? 2 : 0));
      const amp = mkGain(ctx, 0);
      chain(o, lp, amp, ch.input);
      o.start(t); o.stop(end);
      const env = p.env * (acc ? 1 + p.accent : 1), dec = p.decay * (acc ? 0.7 : 1);
      const base = clampF(p.cutoff);
      if (legato) { lp.frequency.setValueAtTime(clampF(base * Math.pow(2, env * 0.35)), t); lp.frequency.setTargetAtTime(base, t, dec / 3); }
      else { lp.frequency.setValueAtTime(clampF(base * Math.pow(2, env)), t); lp.frequency.setTargetAtTime(base, t + 0.003, dec / 3); }
      const peak = velGain(Math.min(1, vel)) * p.vol * (acc ? 1.25 : 1);
      amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(peak, t + (legato ? 0.008 : p.a));
      amp.gain.setTargetAtTime(peak * p.s, t + 0.01, 0.15);
      amp.gain.setTargetAtTime(0, t + Math.max(dur, 0.012), Math.max(0.004, p.r / 3));
      o.onended = () => amp.disconnect();
      d.addVoice(ch, { t, end, g: amp, srcs: [o], f, rel: t + dur });
    },
  },
};

/** Named patches. Composers reference these by name (channel `inst`) or extend them in
 *  song.instruments with { base: 'name', ...overrides }. Params per type: TYPES[type].defaults. */
export const LIBRARY = {
  // pads & ensembles
  pad: { type: 'supersaw' },
  padBright: { type: 'supersaw', cutoff: 5200, detune: 20, kt: 0.2, a: 0.25, vol: 1.0 },
  padDark: { type: 'supersaw', cutoff: 1000, detune: 30, sub: 0.2, a: 0.9, r: 1.8, vol: 1.08 },
  padGlass: { type: 'supersaw', voices: 5, detune: 12, cutoff: 4200, q: 3, air: 0.04, sub: 0, a: 0.7, r: 2.2, vol: 1.39 },
  strings: { type: 'strings' },
  stringsDark: { type: 'strings', cutoff: 1900, body: 1, a: 0.45, r: 1.2, vol: 1.1 },
  brass: { type: 'brass' },
  brassSoft: { type: 'brass', peak: 1.6, fa: 0.2, fd: 0.2, cutoff: 1100, blip: 15, a: 0.05, vol: 0.65 },
  brassStab: { type: 'brass', peak: 3.4, fa: 0.02, fd: 0.15, sus: 0.7, cutoff: 1300, gate: true, vol: 0.64 },
  choir: { type: 'choir' },
  choirOo: { type: 'choir', vowel: 'oo', bright: 0.15, vol: 1.6 },
  choirOh: { type: 'choir', vowel: 'oh', vol: 1.21 },
  organ: { type: 'organ' },
  organFull: { type: 'organ', bars: '888808008', drive: 0.35, vol: 0.34 },
  // keys, plucks, bells
  pluck: { type: 'pluck' },
  pluckSoft: { type: 'pluck', cutoff: 500, env: 2.6, decay: 0.2, q: 1, square: 0.2, vol: 1.1 },
  pluckLong: { type: 'pluck', amp: 1.6, decay: 0.5, env: 3, vol: 1.1 },
  harp: { type: 'harp' },
  bell: { type: 'fm' },
  glass: { type: 'fm', ratio: 1, index: 0.9, isus: 0.3, idecay: 0.5, decay: 2.4, c2: 7.13, m2: 1, i2: 0.8, d2: 0.25, l2: 0.35, vol: 0.81 },
  keys: { type: 'fm', ratio: 1, index: 1.7, isus: 0.12, idecay: 0.45, decay: 1.7, c2: 1, m2: 14, i2: 0.9, d2: 0.1, l2: 0.3, detune: 5, vol: 0.82 },
  // basses
  bass: { type: 'bass' },
  bassPluck: { type: 'bass', env: 3, fd: 0.14, cutoff: 380, s: 0.55, d: 0.18, gate: false },
  bassSoft: { type: 'bass', square: 0.2, env: 1.4, cutoff: 380, q: 0, drive: 0.15 },
  sub: { type: 'sub' },
  reese: { type: 'reese' },
  acid: { type: 'acid' },
  // leads
  lead: { type: 'lead' },
  leadSquare: { type: 'lead', wave: 'square', pw: 0.5, voices: 1, sub: 0.3, cutoff: 3000, env: 1, vib: 18, vol: 0.34 },
  leadSoft: { type: 'lead', wave: 'tri', voices: 2, detune: 6, cutoff: 4000, env: 0.4, vib: 14, a: 0.03, r: 0.35, vol: 0.53 },
  leadBright: { type: 'lead', wave: 'saw', voices: 3, detune: 14, cutoff: 4200, env: 1.2, q: 3, vol: 0.6 },
  // drums
  kick: { type: 'kick' },
  kickHard: { type: 'kick', f0: 260, click: 0.8, drive: 0.6, decay: 0.38 },
  kick808: { type: 'kick', f0: 150, f1: 44, pdecay: 0.05, decay: 1.2, click: 0.2, drive: 0.3 },
  snare: { type: 'snare' },
  snareBig: { type: 'snare', tone: 175, ndecay: 0.5, gateAt: 0.34, noise: 0.95, vol: 0.8 },
  snareTight: { type: 'snare', tone: 220, tone2: 390, ndecay: 0.13, hp: 2000, vol: 0.75 },
  clap: { type: 'clap' },
  hat: { type: 'hat' },
  ohat: { type: 'hat', decay: 0.42, vol: 0.67 },
  shaker: { type: 'shaker' },
  tom: { type: 'tom' },
  taiko: { type: 'taiko' },
  crash: { type: 'cymbal' },
  ride: { type: 'cymbal', decay: 1.9, hp: 5000, metal: 0.35, stick: 0.3, ping: 0.5, vol: 0.6 },
  rim: { type: 'rim' },
  // fx
  impact: { type: 'impact' },
  revcym: { type: 'revcym' },
  riser: { type: 'riser' },
  downlifter: { type: 'downlifter' },
};

// ─────────────────────────────────────────────────────────────────────────────────────
// 4. Bank: renders sample patches (cached by render-relevant params)
// ─────────────────────────────────────────────────────────────────────────────────────

function patchKey(p) {
  const keys = Object.keys(p).filter((k) => !PLAY_KEYS.has(k)).sort();
  return p.type + ':' + keys.map((k) => k + '=' + JSON.stringify(p[k])).join(',');
}

const BANK_BUDGET = 56 * 1048576;   // bytes of rendered samples kept before LRU eviction (~title+sector+boss+stingers)

const Bank = {
  sets: new Map(),     // key → { key, set, promise, used }
  bytes: 0,
  renderMs: 0,
  inUse: () => new Set(),   // replaced by Music: keys referenced by playing decks
  // Renders are queued (at most 3 offline contexts at once) and served by priority:
  // 0 = needed to start a song now, 1 = rest of a playing song, 2 = background preload.
  queue: [],
  running: 0,
  ensure(p, prio = 1) {
    const T = TYPES[p.type];
    if (!T || T.kind !== 'sample') return Promise.resolve(null);
    const key = patchKey(p);
    let e = this.sets.get(key);
    if (!e) {
      e = { key, set: null, promise: null, used: 0, prio, p, T };
      e.promise = new Promise((res, rej) => { e.res = res; e.rej = rej; });
      this.sets.set(key, e);
      this.queue.push(e);
      this.pump();
    } else if (!e.set && prio < e.prio) e.prio = prio;
    e.used = ++this.clock;
    return e.promise;
  },
  pump() {
    while (this.queue.length) {
      let bi = 0;
      for (let i = 1; i < this.queue.length; i++) if (this.queue[i].prio < this.queue[bi].prio) bi = i;
      const e = this.queue[bi];
      // urgent work runs 3-wide; background preloads run one at a time with breathing room so
      // allocations (and the GC they trigger) are spread out while the game is running
      if (this.running >= (e.prio >= 2 ? 1 : 3)) break;
      this.queue.splice(bi, 1);
      this.running++;
      renderSet(e.T, e.p, e.key).then((s) => {
        e.set = s; s.key = e.key; this.bytes += s.bytes; e.res(s); this.evict();
      }, (err) => {
        this.sets.delete(e.key); this.errors.push(e.key.slice(0, 40) + ': ' + (err && err.message)); e.rej(err);
      }).finally(() => { this.running--; setTimeout(() => this.pump(), e.prio >= 2 ? 60 : 0); });
    }
  },
  clock: 0,
  errors: [],
  evict() {
    if (this.bytes <= BANK_BUDGET) return;
    const keep = this.inUse();
    const cands = [...this.sets.values()].filter((e) => e.set && !keep.has(e.key)).sort((a, b) => a.used - b.used);
    for (const e of cands) {
      if (this.bytes <= BANK_BUDGET * 0.85) break;
      this.sets.delete(e.key);
      this.bytes -= e.set.bytes;
      if (this.onEvict) this.onEvict(e.set);
    }
  },
};

function sampleNotes(range, every) {
  const out = [];
  for (let m = range[0]; m <= range[1] + every / 2; m += every) out.push(m);
  return out;
}

async function renderSet(T, p, key) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const sr = p.sr || T.sr || 44100;
  const notes = T.fixed ? [p.note ?? T.note ?? 60] : sampleNotes(p.range || T.range, p.every || T.every);
  const L = T.sustain ? p.L : 0;
  const gap = 0.03;
  const nch = (p.stereo ?? T.stereo) ? 2 : 1;
  const rng = rng32(hashStr(key));
  const snap = (x) => (L > 0 ? Math.max(1, Math.round(x * L)) / L : x);
  const fd = T.fdiv || 1;   // types that also play f/2 snap f to 2/L so f/2 stays periodic
  const snapF = (x) => Math.max(fd, Math.round((x * L) / fd) * fd) / L;
  const regions = [];
  let pos = Math.round(gap * sr);
  for (const m of notes) {
    const f = T.sustain ? snapF(mtof(m)) : mtof(m);
    const pre = T.sustain ? p.pre : 0;
    const len = T.sustain ? p.pre + L + 0.01 : T.len(p, f);
    const frames = Math.ceil(len * sr);
    regions.push({ m, f, frame: pos, frames, off: pos / sr, len: frames / sr, ls: (pos + Math.round(pre * sr)) / sr, le: (pos + Math.round((pre + L) * sr)) / sr });
    pos += frames + Math.round(gap * sr);
  }
  const total = pos;
  let buf;
  if (T.js) {
    buf = newBuffer(nch, total, sr);
    const chans = [];
    for (let c = 0; c < nch; c++) chans.push(buf.getChannelData(c));
    for (const r of regions) {
      T.js(chans.map((d) => d.subarray(r.frame, r.frame + r.frames)), sr, r.f, p, rng);
      await yieldTask();
    }
  } else {
    // One OfflineAudioContext per set, but each region's graph is built just before it starts
    // (suspend/resume) and the previous region is detached — the live graph stays tiny, which is
    // much cheaper than keeping every region's filters running for the whole render.
    const C = OACtor();
    const oac = new C(nch, total, sr);
    let prev = null;
    const build = (r) => {
      if (prev) prev.disconnect();
      const out = (prev = oac.createGain());
      out.connect(oac.destination);
      NYQ = sr * 0.45;
      try { T.render({ ctx: oac, out, t0: r.off, f: r.f, m: r.m, p, rng, snap, L, end: r.off + r.len }); } finally { NYQ = 20000; }
    };
    if (typeof oac.suspend === 'function') {
      build(regions[0]);
      for (let i = 1; i < regions.length; i++) {
        const r = regions[i];
        oac.suspend(Math.floor((r.off - gap / 2) * sr / 128) * 128 / sr).then(() => { build(r); oac.resume(); });
      }
    } else for (const r of regions) { prev = null; build(r); }
    buf = await renderOAC(oac);
  }
  // normalize to a common peak so patch `vol` values are comparable (chunked: this runs on the
  // main thread while the game may be running, so never hog it for more than a slice)
  const SLICE = 65536;
  let peak = 1e-9;
  for (let c = 0; c < nch; c++) {
    const d = buf.getChannelData(c);
    for (let i0 = 0; i0 < d.length; i0 += SLICE) {
      const i1 = Math.min(d.length, i0 + SLICE);
      for (let i = i0; i < i1; i++) { const a = d[i] < 0 ? -d[i] : d[i]; if (a > peak) peak = a; }
      await yieldTask();
    }
  }
  const k = 0.9 / peak;
  const xf = T.sustain ? Math.round((p.xf || 0) * sr) : 0;
  for (let c = 0; c < nch; c++) {
    const d = buf.getChannelData(c);
    for (let i0 = 0; i0 < d.length; i0 += SLICE) {
      const i1 = Math.min(d.length, i0 + SLICE);
      for (let i = i0; i < i1; i++) d[i] *= k;
      await yieldTask();
    }
    for (const r of regions) {
      if (xf > 0) {
        // linear crossfade the loop end into the audio just before loop start (for noise parts)
        const ls = Math.round(r.ls * sr), le = Math.round(r.le * sr), n = Math.min(xf, ls - r.frame);
        for (let i = 0; i < n; i++) { const w = i / n; d[le - n + i] = d[le - n + i] * (1 - w) + d[ls - n + i] * w; }
      }
      if (T.reverse) {
        const a = d.subarray(r.frame, r.frame + r.frames);
        a.reverse();
        const fade = Math.floor(0.008 * sr);
        for (let i = 0; i < fade; i++) a[a.length - 1 - i] *= i / fade;
      }
    }
  }
  const ms = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  Bank.renderMs += ms;
  return { buffer: buf, regions, sustain: !!T.sustain, fixed: !!T.fixed, reverse: !!T.reverse, bytes: total * nch * 4, ms, type: p.type };
}

// ─────────────────────────────────────────────────────────────────────────────────────
// 5. Song compiler: data → fast step-indexed structures
// ─────────────────────────────────────────────────────────────────────────────────────

const RESERVED = new Set(['step', 'len', 'vel']);
const STRIP = { vol: 'lin', pan: 'lin', lpf: 'exp', hpf: 'exp', reverb: 'lin', delay: 'lin' };
const VEL_CHAR = { X: 1, x: 0.8, o: 0.55, g: 0.3 };
const DRUM_LINE = /^[xXog.\-rRf|]+$/;
const DRUM_TOKEN = /^[xXog.\-rRf]+$/;   // a compact drum run inside a token line, e.g. '.*32 x.x.xxxx'

function resolvePatch(name, songInst, warn) {
  const own = songInst && songInst[name];
  let d, lib;
  if (own) {
    if (own.type) d = { ...own };
    else if (own.base && LIBRARY[own.base]) { lib = LIBRARY[own.base]; d = { ...lib, ...own }; delete d.base; }
    else { warn(`instrument "${name}": needs type or a valid base`); return null; }
  } else if (LIBRARY[name]) d = { ...LIBRARY[name] };
  else { warn(`unknown instrument "${name}"`); return null; }
  const T = TYPES[d.type];
  if (!T) { warn(`instrument "${name}": unknown type "${d.type}"`); return null; }
  return { ...T.defaults, ...d };
}

function parseLine(src, step, vel0, warn, where) {
  const events = [];
  if (Array.isArray(src)) {
    let len = 0;
    for (const e of src) {
      if (!Array.isArray(e)) continue;
      const [s, note, l = 1, v = vel0, o] = e;
      const n = note == null || note === 'x' ? null : parseNotes(note);
      if (note != null && note !== 'x' && !n) { warn(`${where}: bad note ${note}`); continue; }
      events.push({ s, n, l, v, g: !!(o && o.glide) });
      len = Math.max(len, s + Math.min(l, 1));
    }
    return { events, len };
  }
  if (typeof src !== 'string') { warn(`${where}: line must be a string or array`); return { events, len: 0 }; }
  const compact = src.replace(/\s+/g, '');
  const toks = DRUM_LINE.test(compact)
    ? compact.replace(/\|/g, '').split('')
    : src.split(/\s+/).filter((t) => t && t !== '|').flatMap((t) => (t.length > 1 && DRUM_TOKEN.test(t) ? t.split('') : [t]));
  const dv = vel0 / 0.8;
  let pos = 0, last = null;
  for (let tok of toks) {
    let reps = 1;
    const star = tok.lastIndexOf('*');
    if (star > 0) { reps = Math.max(1, parseInt(tok.slice(star + 1), 10) || 1); tok = tok.slice(0, star); }
    const s = pos * step, L = step * reps;
    pos += reps;
    if (tok === '.') { last = null; continue; }
    if (tok === '-') { if (last) last.l += L; continue; }
    if (VEL_CHAR[tok] != null) { last = { s, n: null, l: L, v: VEL_CHAR[tok] * dv, g: false }; events.push(last); continue; }
    if (tok === 'r' || tok === 'R') {
      const k = tok === 'r' ? 2 : 3;
      for (let i = 0; i < k; i++) events.push({ s: s + (i * step) / k, n: null, l: step / k, v: (0.62 + 0.15 * i) * dv, g: false });
      last = null; continue;
    }
    if (tok === 'f') { events.push({ s: s - 0.22 * step, n: null, l: step, v: 0.42 * dv, g: false }); last = { s, n: null, l: L, v: 0.9 * dv, g: false }; events.push(last); continue; }
    let v = vel0, glide = false, explicit = false;
    if (tok[0] === '~') { glide = true; tok = tok.slice(1); }
    const at = tok.indexOf('@');
    if (at > 0) { v = parseFloat(tok.slice(at + 1)); tok = tok.slice(0, at); explicit = v >= 0; if (!explicit) v = vel0; }
    let mul = 1, acc = false;
    while (tok.endsWith('!') || tok.endsWith('?')) {
      if (tok.endsWith('!')) acc = true; else mul *= 0.6;
      tok = tok.slice(0, -1);
    }
    if (VEL_CHAR[tok] != null) {           // drum hit with modifiers, e.g. x@0.4  X?
      v = (explicit ? v : VEL_CHAR[tok] * dv) * mul;
      last = { s, n: null, l: L, v: acc ? Math.max(v, 1) : v, g: false };
      events.push(last);
      continue;
    }
    v = (acc ? Math.max(v, 1) : v) * mul;
    const n = parseNotes(tok);
    if (!n) { warn(`${where}: bad token "${tok}"`); last = null; continue; }
    last = { s, n, l: L, v, g: glide };
    events.push(last);
  }
  return { events, len: pos * step };
}

function compilePattern(name, def, song, warn) {
  if (!def || typeof def !== 'object' || Array.isArray(def)) { warn(`pattern ${name}: must be an object { channel: line }`); return null; }
  const step = def.step ?? 1, vel = def.vel ?? 0.8, bar = song.bar;
  const evs = [];
  let maxLen = 0;
  for (const key of Object.keys(def)) {
    if (RESERVED.has(key)) continue;
    if (!song.channels[key]) { warn(`pattern ${name}: unknown channel "${key}"`); continue; }
    let line = def[key], ls = step, lv = vel;
    if (line && typeof line === 'object' && !Array.isArray(line)) { ls = line.step ?? step; lv = line.vel ?? vel; line = line.n; }
    const r = parseLine(line, ls, lv, warn, `${name}.${key}`);
    if (def.len == null && typeof line === 'string' && r.len > bar / 2 && r.len % bar > 1e-6) warn(`pattern ${name}.${key}: ${+r.len.toFixed(3)} steps is not a whole number of bars`);
    maxLen = Math.max(maxLen, r.len);
    for (const e of r.events) { e.c = key; evs.push(e); }
  }
  const len = Math.max(1, Math.round(def.len ?? Math.max(bar, Math.ceil(maxLen / bar - 1e-6) * bar)));
  const byStep = new Array(len).fill(null);
  for (const e of evs) {
    let i = Math.floor(e.s + 1e-6);
    if (i >= len) { warn(`pattern ${name}: event at step ${e.s} is beyond len ${len}`); continue; }
    if (i < 0) i = 0;
    if (!byStep[i]) byStep[i] = [];
    byStep[i].push({ c: e.c, n: e.n, l: e.l, v: e.v, g: e.g, f: e.s - i });
  }
  const chans = new Set(evs.map((e) => e.c));
  return { name, len, byStep, chans };
}

const passes = (w, x) => !w || ((w.min == null || x >= w.min) && (w.max == null || x < w.max));

function compileSection(name, def, song, warn) {
  const bar = song.bar;
  const bars = def.bars ?? 4, steps = Math.max(1, Math.round(bars * bar));
  const lanes = [];
  for (const L0 of def.play || []) {
    const o = typeof L0 === 'string' || Array.isArray(L0) || L0 == null ? { p: L0 } : L0;
    const chainArr = Array.isArray(o.p) ? o.p : [o.p];
    const items = [];
    for (const x of chainArr) {
      if (x == null || x === '_') { items.push({ pat: null, len: bar, tr: 0, vel: 1, when: null }); continue; }
      const io = typeof x === 'string' ? { p: x } : x;
      const pat = song.patterns[io.p];
      if (!pat) { warn(`section ${name}: unknown pattern "${io.p}"`); continue; }
      items.push({ pat, len: pat.len, tr: (io.tr ?? 0) + (o.tr ?? 0), vel: (io.vel ?? 1) * (o.vel ?? 1), when: io.when ?? o.when ?? null });
    }
    if (items.length) lanes.push({ items, at: Math.round((o.at ?? 0) * bar), until: o.until != null ? Math.round(o.until * bar) : Infinity, once: !!o.once });
  }
  const auto = [];
  const autoKeys = new Set();
  for (const [key, pts0] of Object.entries(def.auto || {})) {
    const [ch, param] = key.split('.');
    if (!song.channels[ch] || !param) { warn(`section ${name}: bad automation target "${key}"`); continue; }
    let pts = pts0;
    if (Array.isArray(pts) && pts.length === 2 && typeof pts[0] === 'number') pts = [[0, pts[0]], [bars, pts[1]]];
    if (!Array.isArray(pts)) continue;
    pts = pts.map(([b, v]) => [Math.min(steps, Math.max(0, b * bar)), v]).sort((a, b) => a[0] - b[0]);
    const strip = STRIP[param] != null;
    if (strip) { song.channels[ch].needs[param] = true; autoKeys.add(key); }
    auto.push({ ch, param, pts, strip, exp: STRIP[param] === 'exp' });
  }
  let chords = null;
  if (typeof def.chords === 'string') chords = def.chords.trim().split(/\s+/).map((t) => t.split(','));
  return { name, bars, steps, lanes, auto, autoKeys, mute: new Set(def.mute || []), chords, tr: def.tr ?? 0 };
}

function compileSong(def, name) {
  const warnings = [];
  const warn = (m) => { if (warnings.length < 200) warnings.push(m); };
  const bpb = def.beatsPerBar ?? 4, spb = def.stepsPerBeat ?? 4;
  const song = {
    name, title: def.title ?? name, bpm: def.bpm ?? 120, spb, bar: bpb * spb, swing: def.swing ?? 0,
    gain: def.gain ?? 0.8, reverb: def.reverb ?? 1, key: def.key ?? 'C', scale: def.scale ?? 'major',
    delay: { beats: 0.75, feedback: 0.35, lp: 3800, hp: 300, ...(def.delay || {}) },
    duckRelease: (def.duck && def.duck.release) ?? 0.22, seed: def.seed ?? 1,
    channels: {}, patterns: {}, sections: {}, arr: [], loop: 0, warnings, src: def,
  };
  for (const [cn, cd0] of Object.entries(def.channels || {})) {
    const cd = cd0 || {};
    const patch = resolvePatch(cd.inst ?? cn, def.instruments, warn);
    if (!patch) continue;
    const T = TYPES[patch.type];
    song.channels[cn] = {
      name: cn, patch, T, gain: cd.gain ?? 0.7, pan: cd.pan ?? 0, reverb: cd.reverb ?? 0, delay: cd.delay ?? 0,
      lpf: cd.lpf, hpf: cd.hpf, lpq: cd.lpq ?? 0, drive: cd.drive ?? 0, duck: cd.duck ?? 0, sidechain: !!cd.sidechain,
      layer: cd.layer ?? null, poly: cd.poly ?? patch.poly ?? T.poly ?? 8, tr: (cd.tr ?? 0) + 12 * (cd.oct ?? 0),
      vel: cd.vel ?? 1, tune: cd.tune ?? 0, swing: cd.swing !== false, human: cd.human ?? null, choke: cd.choke ?? null,
      note: cd.note != null ? midi(cd.note) : 60, fixed: !!T.fixed || (T.kind === 'live' && !!T.defaults.from),
      needs: { lpf: cd.lpf != null, hpf: cd.hpf != null, pan: !!cd.pan, reverb: (cd.reverb ?? 0) > 0, delay: (cd.delay ?? 0) > 0 },
      set: null,
    };
  }
  for (const [pn, pd] of Object.entries(def.patterns || {})) {
    const p = compilePattern(pn, pd, song, warn);
    if (p) song.patterns[pn] = p;
  }
  for (const [sn, sd] of Object.entries(def.sections || {})) song.sections[sn] = compileSection(sn, sd, song, warn);
  for (const e0 of def.arrangement || []) {
    const e = typeof e0 === 'string' ? { s: e0 } : e0 || {};
    const sec = song.sections[e.s];
    if (!sec) { warn(`arrangement: unknown section "${e.s}"`); continue; }
    song.arr.push({ sec, tr: e.tr ?? 0, when: e.when ?? null });
  }
  if (!song.arr.length) warn('arrangement is empty');
  if (def.loop === false || def.loop === null) song.loop = -1;
  else if (typeof def.loop === 'string') { song.loop = song.arr.findIndex((e) => e.sec.name === def.loop); if (song.loop < 0) { warn(`loop: unknown section "${def.loop}"`); song.loop = 0; } }
  else song.loop = Math.max(0, Math.min(song.arr.length - 1, def.loop ?? 0));
  song.patches = Object.values(song.channels).map((c) => c.patch);
  // channels the first section plays: a song can start as soon as these are rendered
  song.firstChans = new Set();
  if (song.arr.length) for (const L of song.arr[0].sec.lanes) for (const it of L.items) if (it.pat) for (const c of it.pat.chans) song.firstChans.add(c);
  return song;
}

// ─────────────────────────────────────────────────────────────────────────────────────
// 6. Core (per AudioContext): shared reverb, glue compressor, ceiling limiter, duck gain
// ─────────────────────────────────────────────────────────────────────────────────────

class Core {
  constructor(ctx, dest) {
    this.ctx = ctx;
    this.mix = mkGain(ctx, 1);
    this.duckGain = mkGain(ctx, 1);
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -16; glue.knee.value = 10; glue.ratio.value = 2.2; glue.attack.value = 0.02; glue.release.value = 0.25;
    const ceil = ctx.createDynamicsCompressor();
    ceil.threshold.value = -4; ceil.knee.value = 0; ceil.ratio.value = 20; ceil.attack.value = 0.002; ceil.release.value = 0.12;
    this.out = mkGain(ctx, 0.62);   // compensates the compressors' automatic makeup gain
    // gentle "mastering" tilt: a little less sub boom, a little more air
    const lows = mkFilter(ctx, 'lowshelf', 70, 0, -1.5), air = mkFilter(ctx, 'highshelf', 8000, 0, 2.5);
    chain(this.mix, this.duckGain, lows, air, glue, ceil, this.out, dest);
    this.revIn = mkGain(ctx, 1);
    const conv = ctx.createConvolver();
    conv.buffer = impulse(ctx);
    chain(this.revIn, mkFilter(ctx, 'highpass', 240, -3), conv, mkFilter(ctx, 'lowpass', 8500, -3), mkGain(ctx, 0.5), this.mix);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────
// 7. Deck: one playing song instance (channel strips, sequencer cursor, voices)
// ─────────────────────────────────────────────────────────────────────────────────────

function interp(pts, step, exp) {
  if (step <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [s1, v1] = pts[i];
    if (step <= s1) {
      const [s0, v0] = pts[i - 1], w = s1 > s0 ? (step - s0) / (s1 - s0) : 1;
      return exp && v0 > 0 && v1 > 0 ? v0 * Math.pow(v1 / v0, w) : v0 + (v1 - v0) * w;
    }
  }
  return pts[pts.length - 1][1];
}

class Deck {
  constructor(core, song, o = {}) {
    const ctx = (this.ctx = core.ctx);
    this.core = core; this.song = song; this.o = o;
    this.stepDur = 60 / song.bpm / song.spb;
    this.tr = o.tr || 0;
    this.getI = o.intensity != null ? () => o.intensity : () => Music.intensity;
    this.log = o.log ? [] : null;
    this.rng = rng32(song.seed * 7919 + 1);
    this.level = song.gain;
    this.out = mkGain(ctx, 0);
    this.out.connect(o.dest || core.mix);
    this.bus = mkGain(ctx, 1);
    this.bus.connect(this.out);
    this.revOut = mkGain(ctx, 0);
    this.revOut.connect(core.revIn);
    this.revBus = mkGain(ctx, 1);
    this.revBus.connect(this.revOut);
    const chans = Object.values(song.channels);
    if (chans.some((c) => c.needs.delay)) this.buildDelay();
    if (chans.some((c) => c.duck > 0)) this.buildSidechain();
    this.chans = {};
    this.chanList = [];
    const I = this.getI();
    for (const c of chans) { const ch = this.buildChannel(c, I); this.chans[c.name] = ch; this.chanList.push(ch); }
    for (const ch of this.chanList) ch.chokes = (ch.c.choke || []).map((n) => this.chans[n]).filter(Boolean);
    this.all = [];
    this.t0 = null; this.g = 0; this.secStep = 0;
    this.arrIdx = 0;
    if (o.section != null) { const i = song.arr.findIndex((e) => e.sec.name === o.section); if (i >= 0) this.arrIdx = i; } this.sec = null; this.secTr = 0; this.lanes = [];
    this.autoKeys = new Set();
    this.stopAt = Infinity; this.ended = false; this.disposed = false;
    this.fadeIn = o.fadeIn ?? 0;
  }

  buildDelay() {
    const ctx = this.ctx, d = this.song.delay;
    const time = Math.min(1.9, (d.beats * 60) / this.song.bpm);
    const inp = mkGain(ctx, 1);
    inp.channelCount = 1; inp.channelCountMode = 'explicit'; inp.channelInterpretation = 'speakers';
    const dl = ctx.createDelay(2), dr = ctx.createDelay(2);
    dl.delayTime.value = time; dr.delayTime.value = time;
    const fb = Math.min(0.7, d.feedback);
    const lpL = mkFilter(ctx, 'lowpass', d.lp, -3), lpR = mkFilter(ctx, 'lowpass', d.lp, -3);
    const merger = ctx.createChannelMerger(2);
    chain(inp, mkFilter(ctx, 'highpass', d.hp, -3), dl, lpL);
    chain(dr, lpR);
    lpL.connect(merger, 0, 0);
    lpR.connect(merger, 0, 1);
    chain(lpL, mkGain(ctx, fb), dr);
    chain(lpR, mkGain(ctx, fb), dl);
    const ret = mkGain(ctx, 0.9);
    chain(merger, ret, this.bus);
    chain(ret, mkGain(ctx, 0.3), this.revBus);
    this.dlyIn = inp;
    this.dlyNodes = [inp, dl, dr, merger, ret];
  }

  buildSidechain() {
    const ctx = this.ctx, sr = ctx.sampleRate;
    const rel = Math.max(0.05, this.song.duckRelease), att = 0.004, hold = 0.02;
    const n = Math.ceil((att + hold + rel) * sr), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if (t < att) d[i] = t / att;
      else if (t < att + hold) d[i] = 1;
      else { const x = (t - att - hold) / rel; d[i] = x >= 1 ? 0 : (1 - x) * (1 - x) * (1 + 2 * x); }
    }
    this.scBuf = b;
    this.scIn = mkGain(ctx, 1);
    const clamp = ctx.createWaveShaper();
    clamp.curve = new Float32Array([0, 0, 1]);   // ≤0 → 0, overlapping pulses clamp at 1
    this.scIn.connect(clamp);
    this.scOut = clamp;
  }

  buildChannel(c, I) {
    const ctx = this.ctx;
    const ch = { name: c.name, c, p: c.patch, T: c.T, voices: [], last: null, vauto: null, muted: false, layerOn: true, silentAfter: Infinity, chokes: [] };
    const input = (ch.input = mkGain(ctx, 1));
    let node = input;
    if (c.drive > 0) node = chain(node, mkShaper(ctx, c.drive));
    if (c.needs.hpf) node = chain(node, (ch.hp = mkFilter(ctx, 'highpass', c.hpf ?? 20, -3)));
    if (c.needs.lpf) node = chain(node, (ch.lp = mkFilter(ctx, 'lowpass', c.lpf ?? 20000, c.lpq)));
    node = chain(node, (ch.vol = mkGain(ctx, c.gain)));
    if (c.layer) {
      ch.layerOn = passes(c.layer, I);
      if (!ch.layerOn) ch.silentAfter = -Infinity;
      node = chain(node, (ch.layer = mkGain(ctx, ch.layerOn ? 1 : 0)));
    }
    if (c.duck > 0 && this.scOut) {
      ch.duck = mkGain(ctx, 1);
      const depth = mkGain(ctx, -Math.min(0.95, c.duck));
      chain(this.scOut, depth, ch.duck.gain);
      node = chain(node, ch.duck);
    }
    if (c.needs.pan) node = chain(node, (ch.pan = mkPan(ctx, c.pan)));
    node.connect(this.bus);
    if (c.needs.reverb) chain(node, (ch.rev = mkGain(ctx, c.reverb)), this.revBus);
    if (c.needs.delay && this.dlyIn) chain(node, (ch.dly = mkGain(ctx, c.delay)), this.dlyIn);
    return ch;
  }

  stripParam(ch, name) {
    switch (name) {
      case 'vol': return ch.vol && ch.vol.gain;
      case 'pan': return ch.pan && ch.pan.pan;
      case 'lpf': return ch.lp && ch.lp.frequency;
      case 'hpf': return ch.hp && ch.hp.frequency;
      case 'reverb': return ch.rev && ch.rev.gain;
      case 'delay': return ch.dly && ch.dly.gain;
    }
    return null;
  }

  stripBase(ch, name) {
    const c = ch.c;
    switch (name) {
      case 'vol': return c.gain;
      case 'pan': return c.pan;
      case 'lpf': return c.lpf ?? 20000;
      case 'hpf': return c.hpf ?? 20;
      case 'reverb': return c.reverb;
      case 'delay': return c.delay;
    }
    return 0;
  }

  start(t0, fade = 0) {
    this.t0 = t0;
    const lv = this.level, rv = this.level * this.song.reverb;
    const g = this.out.gain, r = this.revOut.gain;
    g.cancelScheduledValues(0); r.cancelScheduledValues(0);
    if (fade > 0.03) {
      g.setValueAtTime(0, t0); g.linearRampToValueAtTime(lv, t0 + fade);
      r.setValueAtTime(0, t0); r.linearRampToValueAtTime(rv, t0 + fade);
    } else { g.setValueAtTime(lv, t0); r.setValueAtTime(rv, t0); }
  }

  fadeOut(t, dur) {
    for (const prm of [this.out.gain, this.revOut.gain]) { holdAt(prm, t); prm.setTargetAtTime(0, t, Math.max(0.005, dur / 5)); }
    this.stopAt = Math.min(this.stopAt, t + dur);
  }

  nextTime() { return this.t0 + this.g * this.stepDur; }

  tick(until) {
    while (!this.ended) {
      const t = this.t0 + this.g * this.stepDur;
      if (t >= until) break;
      if (t >= this.stopAt) { this.ended = true; break; }
      this.step(t, true);
    }
  }

  // Resync after the timer was starved (throttled background tab): drop missed steps.
  skipTo(time) {
    let guard = 0;
    while (!this.ended && this.t0 + this.g * this.stepDur < time && guard++ < 1e6) {
      const t = this.t0 + this.g * this.stepDur;
      if (t >= this.stopAt) { this.ended = true; break; }
      this.step(t, false);
    }
  }

  step(t, emit) {
    if (this.secStep === 0) this.enterSection(t);
    const ss = this.secStep;
    for (const L of this.lanes) {
      if (L.done || ss < L.def.at || ss >= L.def.until) continue;
      if (emit && L.on && L.item.pat) {
        const evs = L.item.pat.byStep[L.pstep];
        if (evs) for (const ev of evs) this.emit(ev, L.item, t);
      }
      if (++L.pstep >= L.item.len) this.nextItem(L);
    }
    this.g++;
    if (++this.secStep >= this.sec.steps) this.nextSection();
  }

  setItem(L) {
    L.item = L.def.items[L.ci];
    L.on = passes(L.item.when, this.getI());
  }

  nextItem(L) {
    L.pstep = 0;
    if (++L.ci >= L.def.items.length) {
      if (L.def.once) { L.done = true; return; }
      L.ci = 0;
    }
    this.setItem(L);
  }

  enterSection(t) {
    const e = this.song.arr[this.arrIdx];
    const sec = (this.sec = e.sec);
    this.secTr = e.tr + sec.tr;
    this.lanes = sec.lanes.map((def) => { const L = { def, ci: 0, pstep: 0, done: false, item: null, on: true }; this.setItem(L); return L; });
    const o = this.o;
    for (const ch of this.chanList) ch.muted = sec.mute.has(ch.name) || !!(o.mute && o.mute.includes(ch.name)) || !!(o.solo && !o.solo.includes(ch.name));
    this.applyAuto(sec, t);
    if (this.log) this.log.push({ sec: sec.name, t, i: this.arrIdx, tr: this.secTr + this.tr, bars: sec.bars, chords: sec.chords });
  }

  nextSection() {
    this.secStep = 0;
    const arr = this.song.arr, I = this.getI();
    let idx = this.arrIdx;
    for (let tries = 0; tries <= arr.length; tries++) {
      idx++;
      if (idx >= arr.length) {
        if (this.song.loop < 0) { this.ended = true; this.naturalEnd = true; return; }
        idx = this.song.loop;
      }
      if (passes(arr[idx].when, I)) break;
    }
    this.arrIdx = idx;
  }

  applyAuto(sec, t) {
    for (const key of this.autoKeys) {
      if (sec.autoKeys.has(key)) continue;
      const [cn, pn] = key.split('.');
      const ch = this.chans[cn], prm = ch && this.stripParam(ch, pn);
      if (!prm) continue;
      prm.cancelScheduledValues(t);
      prm.setTargetAtTime(pn === 'vol' ? ch.c.gain : this.stripBase(ch, pn), t, 0.04);
    }
    this.autoKeys = sec.autoKeys;
    for (const ch of this.chanList) ch.vauto = null;
    const sd = this.stepDur;
    for (const a of sec.auto) {
      const ch = this.chans[a.ch];
      if (!ch) continue;
      if (!a.strip) { (ch.vauto || (ch.vauto = [])).push({ name: a.param, t0: t, pts: a.pts }); continue; }
      const prm = this.stripParam(ch, a.param);
      if (!prm) continue;
      const conv = (v) => (a.param === 'vol' ? v * ch.c.gain : a.exp ? clampF(v) : v);
      prm.cancelScheduledValues(t);
      if (a.pts[0][0] > 0) prm.setValueAtTime(conv(a.param === 'vol' ? 1 : this.stripBase(ch, a.param)), t);
      for (const [s, v] of a.pts) {
        if (s === 0) prm.setValueAtTime(conv(v), t);
        else if (a.exp) prm.exponentialRampToValueAtTime(conv(v), t + s * sd);
        else prm.linearRampToValueAtTime(conv(v), t + s * sd);
      }
    }
  }

  params(ch, t) {
    if (!ch.vauto) return ch.p;
    const p = Object.assign({}, ch.p);
    for (const a of ch.vauto) p[a.name] = interp(a.pts, (t - a.t0) / this.stepDur, false);
    return p;
  }

  emit(ev, item, t) {
    const ch = this.chans[ev.c];
    if (!ch || ch.muted) return;
    if (!ch.layerOn && t > ch.silentAfter) return;   // intensity layer fully faded out: save CPU
    const c = ch.c, sd = this.stepDur;
    let time = t + ev.f * sd;
    if (this.song.swing && c.swing && ev.f === 0 && (this.secStep & 1)) time += this.song.swing * sd;
    let vel = ev.v * item.vel * c.vel;
    if (c.human) {
      time += (this.rng() - 0.5) * 2 * (c.human.t || 0);
      vel *= 1 + (this.rng() - 0.5) * 2 * (c.human.v || 0);
    }
    if (!this.o.offline) time = Math.max(time, this.ctx.currentTime + 0.005);
    const dur = ev.l * sd;
    const tr = c.fixed ? 0 : item.tr + this.secTr + this.tr + c.tr;
    for (const k of ch.chokes) for (const v of k.voices) this.cut(v, time);
    const p = this.params(ch, time);
    if (ev.n) for (const m of ev.n) this.play(ch, m + tr, time, dur, vel, ev, p);
    else this.play(ch, null, time, dur, vel, ev, p);
    if (c.sidechain && this.scIn) this.pulse(time);
    if (this.log) this.log.push({ t: time, c: ev.c, n: ev.n ? ev.n.map((m) => m + tr) : null, d: dur, v: vel, s: this.sec.name, b: Math.floor(this.secStep / this.song.bar) });
  }

  play(ch, m, t, dur, vel, ev, p) {
    if (ch.T.kind === 'live') {
      if (m == null) m = ch.c.fixed ? null : ch.c.note;
      ch.T.voice(this, ch, m, t, dur, vel, ev, p);
    } else this.playSample(ch, m, t, dur, vel, ev, p);
  }

  playSample(ch, m, t, dur, vel, ev, p) {
    const set = ch.c.set;       // looked up live: sets can finish rendering after the song starts
    if (!set) return;
    const ctx = this.ctx;
    let r, rate;
    if (set.fixed) {
      r = set.regions[0];
      rate = Math.pow(2, ((m == null ? r.m : m) - r.m + ch.c.tune) / 12);
    } else {
      if (m == null) m = ch.c.note;
      const regs = set.regions;
      r = regs[0];
      for (let i = 1; i < regs.length; i++) if (Math.abs(regs[i].m - m) < Math.abs(r.m - m)) r = regs[i];
      rate = mtof(m) / r.f;
    }
    const src = ctx.createBufferSource();
    src.buffer = set.buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    src.connect(g);
    g.connect(ch.input);
    const peak = velGain(vel) * p.vol, gp = g.gain;
    let end, start = t;
    if (set.sustain) {
      src.loop = true; src.loopStart = r.ls; src.loopEnd = r.le;
      const a = Math.max(0.003, Math.min(p.a, Math.max(dur, 0.01)));
      const rel = t + Math.max(dur, a);
      gp.setValueAtTime(0, t);
      gp.linearRampToValueAtTime(peak, t + a);
      if (p.s < 1) gp.setTargetAtTime(peak * p.s, t + a, Math.max(0.005, p.d / 3));
      gp.setTargetAtTime(0, rel, Math.max(0.004, p.r / 4));
      end = rel + p.r * 1.6 + 0.02;
      src.start(t, r.off);
    } else if (set.reverse) {
      // reverse cymbal: its peak lands exactly at the END of the note
      const want = Math.max(0.05, dur) * rate, full = r.len;
      let off = r.off;
      if (want < full) off += full - want; else start = t + (want - full) / rate;
      gp.setValueAtTime(peak, start);
      end = start + (r.off + full - off) / rate + 0.01;
      src.start(start, off);
    } else {
      gp.setValueAtTime(peak, t);
      end = t + r.len / rate;
      if (p.gate && t + dur < end) {
        gp.setTargetAtTime(0, t + dur, Math.max(0.004, p.r / 4));
        end = Math.min(end, t + dur + p.r * 1.6 + 0.02);
      }
      src.start(t, r.off);
    }
    src.stop(end);
    src.onended = () => g.disconnect();
    this.addVoice(ch, { t: start, end, g, srcs: [src] });
  }

  addVoice(ch, v) {
    const list = ch.voices;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].end <= v.t) list.splice(i, 1);
    while (list.length >= ch.c.poly) this.cut(list.shift(), v.t);
    list.push(v);
    ch.last = v;
    const all = this.all;
    if (all.length > MAX_VOICES) {
      let w = 0;
      for (let i = 0; i < all.length; i++) if (all[i].end > v.t) all[w++] = all[i];
      all.length = w;
      if (all.length > MAX_VOICES) this.cut(all.shift(), v.t);
    }
    all.push(v);
  }

  cut(v, t) {
    if (!v || v.end <= t + 0.001) return;
    const g = v.g.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(0, t, 0.006);
    for (const s of v.srcs) { try { s.stop(t + 0.05); } catch { /* old engines: runs silent until original stop */ } }
    v.end = t + 0.05;
  }

  pulse(t) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.scBuf;
    s.connect(this.scIn);
    s.start(t);
    s.onended = () => s.disconnect();
  }

  setIntensity(x, now) {
    for (const ch of this.chanList) {
      if (!ch.layer) continue;
      const on = passes(ch.c.layer, x);
      if (on === ch.layerOn) continue;
      ch.layerOn = on;
      ch.silentAfter = on ? Infinity : now + 2.5;
      ch.layer.gain.setTargetAtTime(on ? 1 : 0, now, 0.45);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try { this.out.disconnect(); } catch { /* ignore */ }
    try { this.revOut.disconnect(); } catch { /* ignore */ }
    if (this.scIn) try { this.scIn.disconnect(); } catch { /* ignore */ }
    this.all.length = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────
// 8. Stingers (short one-shot cues, written in C and transposed to the current song's key)
// ─────────────────────────────────────────────────────────────────────────────────────

const STINGERS = {
  // 1UP: a bright rising sparkle
  extend: {
    bpm: 150, key: 'C', loop: false, gain: 0.95, duck: 0.35,
    channels: { bell: { inst: 'glass', gain: 0.55, reverb: 0.45, delay: 0.25 }, harp: { gain: 0.6, reverb: 0.3, pan: -0.2 }, pad: { inst: 'padBright', gain: 0.3, reverb: 0.5 } },
    delay: { beats: 0.5, feedback: 0.3 },
    patterns: {
      a: {
        bell: 'G5 C6 E6 G6 C7*12',
        harp: 'G4 C5 E5 G5 C6*12',
        pad: '. . . . C5maj*12',
      },
    },
    sections: { s: { bars: 1, play: ['a'], chords: 'C' } },
    arrangement: ['s'],
  },
  // sector clear: the Lancers call ("rising fifth") then a bVI–bVII–I victory cadence
  stage_clear: {
    bpm: 120, key: 'C', loop: false, gain: 0.8, duck: 0.7,
    channels: {
      lead: { inst: 'leadBright', gain: 0.95, reverb: 0.3, delay: 0.18 },
      brass: { gain: 0.43, reverb: 0.35 },
      strings: { gain: 0.26, reverb: 0.4, pan: 0.15 },
      bass: { gain: 0.55 },
      taiko: { gain: 0.4, reverb: 0.25 },
      crash: { gain: 0.45, reverb: 0.2 },
      rev: { inst: 'revcym', gain: 0.4 },
      bell: { inst: 'glass', gain: 0.35, reverb: 0.5, delay: 0.3 },
    },
    delay: { beats: 0.75, feedback: 0.3 },
    patterns: {
      a: {
        len: 32,
        lead: 'G4*2 C5*3 C5 G5*6 Eb5*2 F5*2 G5*16',
        brass: '. . C4+E4+G4*10 Ab3+C4+Eb4*2 Bb3+D4+F4*2 C4+E4+G4+C5*16',
        strings: '. . G4+C5+E5*10 Ab4+C5+Eb5*2 Bb4+D5+F5*2 G4+C5+E5+G5*16',
        bass: '. . C2*10 Ab1*2 Bb1*2 C2*16',
        taiko: '..X.........x.x.X...............',
        crash: '................X...............',
        rev: '.*8 x*8',
        bell: '.*16 E6 G6 C7 G6 C7*12',
      },
    },
    sections: { s: { bars: 2, play: ['a'], chords: 'C,C,C,C,C,C,Ab,Bb C' } },
    arrangement: ['s'],
  },
  // boss defeated: impact, then a IV–V–I cadence with the rising-fifth call on top
  boss_defeated: {
    bpm: 100, key: 'C', loop: false, gain: 0.8, duck: 0.75,
    channels: {
      impact: { gain: 0.7, reverb: 0.2 },
      choir: { gain: 0.33, reverb: 0.5 },
      brass: { gain: 0.5, reverb: 0.35 },
      lead: { inst: 'leadBright', gain: 0.88, reverb: 0.35, delay: 0.2 },
      bass: { gain: 0.55 },
      taiko: { gain: 0.47, reverb: 0.25 },
      crash: { gain: 0.45, reverb: 0.2 },
      rev: { inst: 'revcym', gain: 0.4 },
    },
    delay: { beats: 0.75, feedback: 0.3 },
    patterns: {
      a: {
        len: 32,
        impact: 'X',
        choir: 'G3+C4+E4*8 A3+C4+F4*4 B3+D4+G4*4 G3+C4+E4+G4*16',
        brass: '.*8 F3+A3+C4*4 G3+B3+D4*4 G3+C4+E4+C5*16',
        lead: '.*8 A4*4 B4*2 D5*2 C5*4 G5*12',
        bass: '.*8 F1*4 G1*4 C2*16',
        taiko: 'X.......X...X.x.X...............',
        crash: '................X...............',
        rev: '.*8 x*8',
      },
    },
    sections: { s: { bars: 2, play: ['a'], chords: 'C,C,F,G C' } },
    arrangement: ['s'],
  },
  // game over: a descending lament in the minor, i–bVI–iv–V–i
  game_over: {
    bpm: 72, key: 'C', scale: 'minor', loop: false, gain: 0.8, duck: 0.9,
    channels: {
      pad: { inst: 'padDark', gain: 0.36, reverb: 0.5 },
      choir: { inst: 'choirOo', gain: 0.3, reverb: 0.6 },
      lead: { inst: 'leadSoft', gain: 0.78, reverb: 0.45, delay: 0.25 },
      bass: { inst: 'bassSoft', gain: 0.4 },
    },
    delay: { beats: 1, feedback: 0.35 },
    patterns: {
      a: {
        pad: 'C3+G3+Eb4*6 Ab2+Eb3+C4*6 F2+C3+Ab3*6 G2+D3+B3*2 C3+G3+Eb4*12',
        choir: 'G4+C5*6 Ab4+C5*6 Ab4+C5*6 G4+B4*2 G4+C5*12',
        lead: 'G4*3 F4 Eb4*2 Eb4*3 D4 C4*2 C4*3 Bb3 Ab3*2 B3*2 C4*12',
        bass: 'C2*6 Ab1*6 F1*6 G1*2 C2*12',
      },
    },
    sections: { s: { bars: 2, play: ['a'], chords: 'Cm,Cm,Cm,Ab,Ab,Ab,Fm,Fm Fm,G,Cm,Cm,Cm,Cm,Cm,Cm' } },
    arrangement: ['s'],
  },
};

// ─────────────────────────────────────────────────────────────────────────────────────
// 9. Public API
// ─────────────────────────────────────────────────────────────────────────────────────

const songCache = new Map();   // name → Promise<{ song, err }> (compiled, sets not guaranteed)
const allSongs = new Set();    // compiled songs (to drop references to evicted sample sets)
const warned = new Set();

function importSong(name) {
  return import(new URL(`./songs/${name}.js`, import.meta.url).href);
}

// (Re)attach rendered sample sets to a compiled song's channels (renders what is missing).
// mode 'first': resolve once the first section's instruments are ready; the rest keep rendering
// (lower priority) and become audible the moment they finish. onProgress(0..1) tracks what is awaited.
async function ensureSets(song, mode = 'all', onProgress = null, prio = 0) {
  const chans = Object.values(song.channels);
  const need = chans.filter((c) => mode !== 'first' || song.firstChans.has(c.name));
  let done = 0;
  const jobs = chans.map((c) => {
    const needed = need.includes(c);
    return Bank.ensure(c.patch, needed ? prio : prio + 1).then((st) => {
      c.set = st;
      if (needed && onProgress) onProgress(++done / need.length);
      return st;
    });
  });
  const wait = jobs.filter((j, i) => need.includes(chans[i]));
  jobs.forEach((j) => j.catch(() => {}));
  await Promise.all(wait);
  return song;
}

function compiled(name) {
  let p = songCache.get(name);
  if (!p) {
    p = (async () => {
      if (!/^[a-z0-9_-]{1,32}$/i.test(String(name))) throw new Error('invalid track name');
      const mod = await importSong(name);
      if (!mod || !mod.default) throw new Error('song module has no default export');
      const song = compileSong(mod.default, name);
      allSongs.add(song);
      return { song, err: null };
    })().catch((err) => ({ song: null, err }));
    songCache.set(name, p);
  }
  return p;
}

async function loadSong(name, mode = 'all', onProgress = null, prio = 0) {
  const r = await compiled(name);
  if (r.song) {
    try { await ensureSets(r.song, mode, onProgress, prio); } catch (err) { return { song: null, err }; }
  }
  return r;
}

const stingerSongs = new Map();
async function loadStinger(name, prio = 0) {
  const def = STINGERS[name];
  if (!def) return null;
  let song = stingerSongs.get(name);
  if (!song) {
    song = compileSong(def, 'stinger:' + name);
    song.duckAmount = def.duck ?? 0.6;
    stingerSongs.set(name, song);
    allSongs.add(song);
  }
  try { return await ensureSets(song, 'all', null, prio); } catch { return null; }
}

Bank.onEvict = (set) => {
  for (const song of allSongs) for (const c of Object.values(song.channels)) if (c.set === set) c.set = null;
};

function songDuration(song) {
  let steps = 0;
  for (const e of song.arr) steps += e.sec.steps;
  return (steps * 60) / song.bpm / song.spb;
}

export const Music = {
  current: null,
  intensity: 0.5,
  ready: false,
  enabled: true,
  debug: false,
  lastLog: null,
  _core: null,
  _main: null,
  _decks: new Set(),
  _timer: null,
  _token: 0,
  _initP: null,
  _key: 'C',

  /** Render instruments for the first tracks + stingers. Call after AudioSys.init(). */
  init(onProgress) {
    if (this._initP) return this._initP;
    this._initP = (async () => {
      const ctx = AudioSys.init();
      if (!ctx || !OACtor()) { this.enabled = false; if (onProgress) onProgress(1); return; }
      this._core = new Core(ctx, AudioSys.musicBus);
      Bank.inUse = () => {
        const s = new Set();
        for (const d of this._decks) for (const ch of d.chanList) if (ch.c.set) s.add(ch.c.set.key);
        return s;
      };
      // Blocking: only what the title's first section needs (the intro is long enough for the
      // rest of the title to render behind it). Stingers + sector 1 + boss follow in the background.
      await loadSong('title', 'first', onProgress, 0);
      this.ready = true;
      if (onProgress) onProgress(1);
      for (const n of Object.keys(STINGERS)) loadStinger(n, 2);
      setTimeout(() => this.preload(['aurora', 'boss'], 2), 200);
    })();
    return this._initP;
  },

  /** Warm up (import + render instruments) tracks ahead of time, e.g. when a sector starts:
   *  Music.preload(['cinder', 'boss']). Missing tracks are skipped silently. */
  async preload(names, prio = 1) {
    for (const n of [].concat(names || [])) {
      await loadSong(n, 'all', null, prio);
      await new Promise((r) => setTimeout(r, 30));
    }
  },

  /** opt { fade = 1, restart = false, section (dev: start at a named section) } */
  play(track, opt = {}) {
    if (!this.enabled) return;
    const fade = Math.max(0, opt.fade ?? 1.0);
    if (!opt.restart && track === this.current && this._main && !this._main.ended) return;
    this.current = track || null;
    const token = ++this._token;
    const had = !!this._main;
    if (this._main) { this._fadeOut(this._main, fade); this._main = null; }
    if (!track) return;
    const go = async () => {
      await this.init();
      const { song, err } = await loadSong(track, 'first', null, 0);
      if (token !== this._token) return;
      if (!song) {
        if (!warned.has(track)) { warned.add(track); console.warn(`[music] track "${track}" unavailable (${err && err.message}); playing silence`); }
        return;
      }
      this._key = song.key;
      const deck = new Deck(this._core, song, { fadeIn: had ? fade : 0.02, log: this.debug, section: opt.section });
      this._main = deck;
      this._decks.add(deck);
      this._startTimer();
      this._tick();
    };
    go();
  },

  /** Fade out everything (current track and any stingers still ringing). */
  stop(fade = 1) {
    this._token++;
    this.current = null;
    this._main = null;
    if (!this._core) return;
    for (const d of this._decks) if (!d.ended && d.disposeAt == null) this._fadeOut(d, fade);
  },

  setIntensity(x) {
    x = Math.max(0, Math.min(1, +x || 0));
    this.intensity = x;
    if (!this._core) return;
    const now = this._core.ctx.currentTime;
    for (const d of this._decks) d.setIntensity(x, now);
  },

  duck(amount = 0.5, seconds = 1) {
    if (!this._core) return;
    const g = this._core.duckGain.gain, now = this._core.ctx.currentTime;
    holdAt(g, now);
    g.setTargetAtTime(1 - Math.max(0, Math.min(1, amount)), now, 0.04);
    g.setTargetAtTime(1, now + Math.max(0.05, seconds), 0.35);
  },

  stinger(name) {
    if (!this.enabled || !this._core) return;
    if (!STINGERS[name]) { if (!warned.has('st:' + name)) { warned.add('st:' + name); console.warn(`[music] unknown stinger "${name}"`); } return; }
    loadStinger(name).then((song) => {
      if (!song) return;
      const shift = ((pitchClass(this._key) || 0) + 18) % 12 - 6;   // nearest transposition, −6..+5
      const deck = new Deck(this._core, song, { tr: shift, intensity: 0.5 });
      deck.oneShot = true;
      this._decks.add(deck);
      this.duck(song.duckAmount, songDuration(song) * 0.85);
      this._startTimer();
      this._tick();
    });
  },

  /** Debug: render `seconds` of a track (or 'stinger:<name>') offline through the same engine.
   *  opt { intensity, sampleRate, solo: [channels], mute: [channels], section: 'name' (start
   *  there), raw (no reverb/master bus) }. `track` may also be an inline song object. The returned
   *  AudioBuffer carries `.notes` (event log: notes + section markers). */
  async renderOffline(track, seconds = 30, opt = {}) {
    await this.init();
    let song;
    if (track && typeof track === 'object') song = await ensureSets(compileSong(track, 'inline'));   // dev: inline song object
    else if (String(track).startsWith('stinger:')) song = await loadStinger(track.slice(8));
    else song = (await loadSong(track)).song;
    const sr = opt.sampleRate || 44100;
    const C = OACtor();
    const oac = new C(2, Math.ceil(seconds * sr), sr);
    if (!song) return renderOAC(oac);
    // raw: bypass reverb + master bus (instrument calibration)
    const core = opt.raw ? { ctx: oac, mix: oac.destination, revIn: mkGain(oac, 0) } : new Core(oac, oac.destination);
    const deck = new Deck(core, song, { log: true, offline: true, intensity: opt.intensity ?? this.intensity, tr: opt.tr || 0, solo: opt.solo, mute: opt.mute, section: opt.section });
    deck.start(0.02, 0);
    if (typeof oac.suspend === 'function') {
      // schedule in 1 s chunks like the realtime scheduler (keeps the live graph small)
      const CH = 1;
      deck.tick(Math.min(seconds, CH + 0.25));
      for (let t = CH; t < seconds; t += CH) {
        const until = Math.min(seconds, t + CH + 0.25);
        oac.suspend(t).then(() => { deck.tick(until); oac.resume(); });
      }
    } else deck.tick(seconds);
    const buf = await renderOAC(oac);
    try { buf.notes = deck.log; } catch { /* ignore */ }
    this.lastLog = deck.log;
    return buf;
  },

  /** Debug: compile warnings for a track (unknown patterns, bad tokens, misaligned lines…). */
  async validate(track) {
    try {
      const mod = await importSong(track);
      return compileSong(mod.default, track).warnings;
    } catch (e) { return ['load failed: ' + e.message]; }
  },

  /** Debug: compiled song object (sections, channels) for tools. */
  async inspect(track) {
    if (String(track).startsWith('stinger:')) { const d = STINGERS[track.slice(8)]; return d ? compileSong(d, track) : null; }
    return (await compiled(track)).song;
  },

  /** Debug: the sample bank (rendered sets) for dev tools. */
  _bank() { return Bank; },

  /** Debug stats. */
  stats(detail = false) {
    let voices = 0;
    for (const d of this._decks) voices += d.all.filter((v) => v.end > (this._core ? this._core.ctx.currentTime : 0)).length;
    const r = { decks: this._decks.size, voices, bankMB: +(Bank.bytes / 1048576).toFixed(1), renderMs: Math.round(Bank.renderMs), sets: Bank.sets.size };
    if (Bank.errors.length) r.errors = Bank.errors.slice(-5);
    if (detail) r.detail = [...Bank.sets.values()].filter((e) => e.set).map((e) => ({ type: e.set.type, MB: +(e.set.bytes / 1048576).toFixed(2), ms: Math.round(e.set.ms), n: e.set.regions.length, key: e.key.slice(0, 90) }));
    return r;
  },

  _fadeOut(deck, fade) {
    const now = this._core.ctx.currentTime;
    if (deck.t0 == null) { deck.ended = true; deck.stopAt = now; }
    else deck.fadeOut(now, Math.max(0.02, fade));
    deck.disposeAt = now + Math.max(0.02, fade) + 0.3;
  },

  _startTimer() {
    if (this._timer) return;
    this._timer = setInterval(() => this._tick(), TIMER_MS);
  },

  _tick() {
    const core = this._core;
    if (!core) return;
    const ctx = core.ctx;
    if (ctx.state !== 'running') return;   // suspended: schedule nothing (no pile-up)
    const now = ctx.currentTime;
    const ahead = typeof document !== 'undefined' && document.hidden ? HIDDEN_LOOKAHEAD : LOOKAHEAD;
    for (const d of this._decks) {
      if (d.t0 == null && !d.ended) d.start(now + 0.06, d.fadeIn);
      if (!d.ended) {
        if (d.nextTime() < now) d.skipTo(now + 0.02);
        d.tick(now + ahead);
      }
      if (d.ended && d.disposeAt == null) d.disposeAt = (d.naturalEnd || d.oneShot ? d.nextTime() + 4 : now + 0.5);
      if (d.disposeAt != null && now > d.disposeAt) {
        d.dispose();
        this._decks.delete(d);
        if (d === this._main) this._main = null;
      }
    }
    if (!this._decks.size && this._timer) { clearInterval(this._timer); this._timer = null; }
  },
};

export default Music;
