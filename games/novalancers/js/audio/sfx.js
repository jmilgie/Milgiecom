// Nova Lancers — procedural sound effects (DESIGN.md §8).
//
// Nothing is loaded from disk; every effect is synthesized at boot:
//  * Each sound is a small graph of oscillators, FM pairs, filtered noise, waveshapers and
//    envelopes rendered with OfflineAudioContext (off the main thread, several contexts in
//    parallel). All variants of one sound render back-to-back in a single context, each with
//    its own seeded randomization (pitch, noise offsets, envelope times, partial tunings).
//  * Layers WebAudio has no cheap primitive for are generated in JS and fed in as buffers:
//    modal metal/glass partials, reverse swells, and shared crackle / glass-shard textures.
//  * Space is baked in with a procedural convolution reverb: a short metallic 'hangar' IR and
//    a long dark 'void' IR. Each render has a separate reverb-send channel that is convolved
//    with an FFT at half rate (ConvolverNode setup alone costs 10–40 ms per context).
//  * Every variant is DC-blocked, click-faded, peak-normalized to −1 dBFS and loudness-matched
//    (phone-speaker weighted short-term loudness) so the mix follows each sound's `db` target.
//    This post-processing runs in Blob-URL workers (inline fallback), off the main thread.
// Runtime: voice gain → StereoPanner → AudioSys.sfxBus; per-name voice caps and retrigger
// cooldowns, a global voice cap with priority-aware oldest-steal, seamless loops.

import { AudioSys } from './audio.js';
import { FIELD_W } from '../config.js';

const HI = 44100;            // short, crisp sounds
const LO = 32000;            // mid-length sounds (16 kHz bandwidth)
const XLO = 22050;           // long, heavy sounds: booms, roars, sirens, beams (11 kHz bandwidth)
const GAP = 0.03;            // silence between variants inside one render
const PEAK = 0.891;          // −1 dBFS
const MAX_VOICES = 24;
const NOISE_SEC = 4;
const TAU = Math.PI * 2;

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const dbToGain = (db) => Math.pow(10, db / 20);
const semiToRate = (s) => Math.pow(2, s / 12);
const perfNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ---------------------------------------------------------------------------------------------
// Seeded randomness

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
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

function makeRng(seed) {
  const f = mulberry(seed);
  const r = () => f();
  r.range = (a, b) => a + (b - a) * f();
  r.jit = (x, amt) => x * (1 + (f() * 2 - 1) * amt);
  r.pick = (arr) => arr[Math.floor(f() * arr.length)];
  r.sgn = () => (f() < 0.5 ? -1 : 1);
  return r;
}

// ---------------------------------------------------------------------------------------------
// Envelopes. An envelope is a number or a flat array  [v0, dt1, v1, dt2, v2, ...]  (times are
// relative to the segment start). Tokens: 'l' linear ramps (default for gains), 'e' exponential
// ramps (default for frequencies), 'x', tau[, target] ends with an exponential decay.

function applyEnv(p, T, a, mode) {
  if (!Array.isArray(a)) { p.setValueAtTime(a, T); return; }
  p.setValueAtTime(mode === 'e' ? Math.max(1e-4, a[0]) : a[0], T);
  let tt = T;
  for (let i = 1; i < a.length; i++) {
    const k = a[i];
    if (k === 'e' || k === 'l') { mode = k; continue; }
    if (k === 'x') { p.setTargetAtTime(a.length > i + 2 ? a[i + 2] : 0, tt, Math.max(1e-4, a[i + 1])); break; }
    tt += k;
    const val = a[++i];
    if (mode === 'e') p.exponentialRampToValueAtTime(Math.max(1e-4, val), tt);
    else p.linearRampToValueAtTime(val, tt);
  }
}

function envMap(a, fn) {
  if (!Array.isArray(a)) return fn(a);
  const o = [fn(a[0])];
  for (let i = 1; i < a.length; i++) {
    const k = a[i];
    if (k === 'e' || k === 'l') { o.push(k); continue; }
    if (k === 'x') { o.push('x', a[i + 1]); if (a.length > i + 2) o.push(fn(a[i + 2])); break; }
    o.push(k, fn(a[++i]));
  }
  return o;
}

// Time for an envelope to finish: its ramps plus 4.5 τ of a trailing 'x' decay (≈ −39 dB).
function envLen(a) {
  if (!Array.isArray(a)) return 0;
  let t = 0;
  for (let i = 1; i < a.length; i++) {
    const k = a[i];
    if (k === 'e' || k === 'l') continue;
    if (k === 'x') return t + a[i + 1] * 4.5;
    t += k; i++;
  }
  return t;
}

const plainEnv = (a) => Array.isArray(a) && a.every((x) => typeof x === 'number');

// Geometric mean of an envelope's values (used to approximate FM depth / filter bandwidth).
function envMean(a) {
  if (!Array.isArray(a)) return a;
  let s = 0, n = 0;
  envMap(a, (x) => { s += Math.log(Math.max(1e-3, x)); n++; return x; });
  return Math.exp(s / n);
}

// True when every segment is slow enough for k-rate (per 128-frame block) automation.
function slowEnv(a) {
  for (let i = 1; i < a.length; i++) {
    const k = a[i];
    if (k === 'e' || k === 'l') continue;
    if (k === 'x') return a[i + 1] >= 0.05;
    if (k < 0.06) return false;
    i++;
  }
  return true;
}

function kRate(p) { try { p.automationRate = 'k-rate'; } catch { /* unsupported: stays a-rate */ } }

// ---------------------------------------------------------------------------------------------
// Small JS DSP helpers

function dcBlock(d, sr, fc = 12) {
  const R = Math.exp(-TAU * fc / sr);
  let x1 = 0, y1 = 0;
  for (let i = 0; i < d.length; i++) { const x = d[i]; const y = x - x1 + R * y1; x1 = x; y1 = y; d[i] = y; }
}

function normPeak(d, target) {
  let pk = 0;
  for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > pk) pk = a; }
  if (pk > 0) { const g = target / pk; for (let i = 0; i < d.length; i++) d[i] *= g; }
  return d;
}

function normRms(d, target) {
  let s = 0;
  for (let i = 0; i < d.length; i++) s += d[i] * d[i];
  const rms = Math.sqrt(s / d.length);
  if (rms > 0) { const g = target / rms; for (let i = 0; i < d.length; i++) d[i] *= g; }
  return d;
}

// Shared noise tables (4 s per color per sample rate); layers read them at random offsets.
const noiseCache = new Map();
function noiseTables(sr) {
  let t = noiseCache.get(sr);
  if (t) return t;
  const n = Math.round(sr * NOISE_SEC), rnd = mulberry(0x5eed + sr);
  const white = new Float32Array(n), pink = new Float32Array(n), brown = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
  for (let i = 0; i < n; i++) {
    const w = rnd() * 2 - 1;
    white[i] = w;
    // Paul Kellet's pink filter
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    pink[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
    br = (br + 0.02 * w) / 1.02; brown[i] = br;
  }
  for (const d of [white, pink, brown]) { dcBlock(d, sr, 20); normRms(d, 0.3); }
  t = { white, pink, brown, bufs: {} };
  noiseCache.set(sr, t);
  return t;
}

// Sum of exponentially decaying sinusoids (struck metal / glass). Recursive oscillators: cheap.
function modalData(sr, r, f, ratios, taus, amps, pair) {
  let tmax = 0;
  for (const t of taus) tmax = Math.max(tmax, t);
  const len = Math.ceil(tmax * 5.5 * sr) + 2, d = new Float32Array(len);
  const add = (fk, a, tau) => {
    if (fk >= sr * 0.45) return;
    const w = TAU * fk / sr, rr = Math.exp(-1 / (tau * sr)), c = 2 * rr * Math.cos(w), r2 = rr * rr;
    const n = Math.min(len, Math.ceil(tau * 5.5 * sr));
    let y2 = 0, y1 = a * rr * Math.sin(w);
    d[1] += y1;
    for (let i = 2; i < n; i++) { const y = c * y1 - r2 * y2; d[i] += y; y2 = y1; y1 = y; }
  };
  for (let k = 0; k < ratios.length; k++) {
    const fk = f * ratios[k] * (1 + (r() - 0.5) * 0.006);
    const a = amps[k] ?? amps[amps.length - 1], tau = taus[k] ?? taus[taus.length - 1];
    if (pair) { add(fk * (1 - pair), a * 0.55, tau); add(fk * (1 + pair), a * 0.45, tau * 0.85); } // beating pairs
    else add(fk, a, tau);
  }
  return normPeak(d, 1);
}

// Shared texture tables (4 s per rate, read at random offsets like the noise tables; the
// density/brightness envelope comes from an amp envelope in the graph):
//   crackle: sparse/dense tiny noise grains (debris, electric sparks)
//   shards:  short high partials (glass, sparkles)
function textureData(sr, kind) {
  const r = mulberry(0x7e77 + sr + kind.length * 31), len = Math.round(sr * NOISE_SEC), d = new Float32Array(len);
  if (kind === 'shards') {
    for (let k = 0, n = NOISE_SEC * 45; k < n; k++) {
      const i0 = Math.floor(r() * (len - 1)), f = 2500 * Math.pow(3.2, r()), tau = 0.01 + r() * 0.05, a = 0.3 + 0.7 * r();
      if (f > sr * 0.45) continue;
      const w = TAU * f / sr, rr = Math.exp(-1 / (tau * sr)), c = 2 * rr * Math.cos(w), r2 = rr * rr;
      const m = Math.min(len - i0, Math.ceil(tau * 5.5 * sr));
      let y2 = 0, y1 = a * rr * Math.sin(w);
      for (let i = 1; i < m; i++) { d[i0 + i] += y1; const y = c * y1 - r2 * y2; y2 = y1; y1 = y; }
    }
  } else {
    const n = NOISE_SEC * (kind === 'dense' ? 130 : 38);
    for (let k = 0; k < n; k++) {
      const i0 = Math.floor(r() * (len - 1)), a = (0.2 + 0.8 * r() * r()) * (r() < 0.5 ? -1 : 1);
      const g = Math.max(3, Math.round((0.0003 + r() * 0.0022) * sr)), kk = 5 / g;
      let e = 1;
      const m = Math.exp(-kk);
      for (let j = 0; j < g && i0 + j < len; j++) { d[i0 + j] += a * (r() * 2 - 1) * e; e *= m; }
    }
  }
  return normPeak(d, 1);
}

// Exponential crescendo of noise (a "reverse reverb" swell) ending cleanly.
function swellData(sr, r, dur, tau, color) {
  const tab = noiseTables(sr)[color || 'pink'], len = Math.ceil(dur * sr), d = new Float32Array(len);
  const off = Math.floor(r() * (tab.length - len - 1)), m = Math.exp(1 / (tau * sr));
  let e = Math.exp(-len / (tau * sr));
  for (let i = 0; i < len; i++) { d[i] = tab[off + i] * e; e *= m; }
  const f = Math.min(len, Math.round(0.004 * sr));
  for (let i = 0; i < f; i++) d[len - 1 - i] *= i / f;
  return normPeak(d, 1);
}

// ---------------------------------------------------------------------------------------------
// Procedural impulse responses (generated and convolved at half the sound's rate).
// 'hangar': 0.36 s metal room — dense early reflections off hull plates, fast bright decay,
// faint resonant ring. 'void': 1.6 s dark open space with a slow bloom, frequency-dependent
// decay (RT60 2.8 s low / 1.1 s high) and a few far echoes.

const irCache = new Map();

function bpResonate(d, rate, f, q, g) {
  // RBJ band-pass (0 dB peak), mixed back in with gain g
  const w = TAU * f / rate, al = Math.sin(w) / (2 * q), a0 = 1 + al;
  const b0 = al / a0, b2 = -al / a0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < d.length; i++) {
    const x = d[i], y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    d[i] = x + g * y;
  }
}

function getIR(kind, sr) {
  const key = kind + sr;
  let ir = irCache.get(key);
  if (ir) return ir;
  const hang = kind === 'hangar', rate = sr / 2;
  const len = Math.round((hang ? 0.36 : 1.6) * rate);
  const chans = [];
  for (let ch = 0; ch < 2; ch++) {
    const rnd = mulberry((hang ? 0x4a11 : 0x7011d) + ch * 977 + sr);
    const d = new Float32Array(len);
    const pre = (hang ? 0.003 : 0.02) + ch * 0.0009;
    if (hang) {
      for (let k = 0; k < 18; k++) {
        const t = pre + 0.002 + Math.pow(rnd(), 1.3) * 0.07, i = Math.floor(t * rate);
        const a = (0.3 + 0.7 * rnd()) * Math.exp(-t / 0.04) * (rnd() < 0.5 ? -1 : 1) * 0.9;
        if (i + 1 < len) { d[i] += a; d[i + 1] += a * 0.5; }
      }
    } else {
      for (let k = 0; k < 6; k++) { // far echoes off distant structures: short diffuse bursts
        const t = 0.07 + rnd() * 0.4, i0 = Math.floor(t * rate), a = 0.22 * Math.exp(-t / 0.5);
        for (let j = 0; j < rate * 0.02 && i0 + j < len; j++) d[i0 + j] += a * (rnd() * 2 - 1) * Math.exp(-j / (rate * 0.006));
      }
    }
    const rtLo = hang ? 0.5 : 2.8, rtHi = hang ? 0.26 : 1.1;
    const aS = 1 - Math.exp(-TAU * (hang ? 900 : 700) / rate);
    const mLo = Math.exp(-6.91 / (rtLo * rate)), mHi = Math.exp(-6.91 / (rtHi * rate));
    const i0 = Math.floor(pre * rate), bloom = (hang ? 0.012 : 0.1) * rate;
    let lo = 0, eLo = 1, eHi = 1;
    for (let i = i0; i < len; i++) {
      const n = i - i0, w = rnd() * 2 - 1;
      lo += aS * (w - lo);
      const b = n < bloom ? (hang ? 1 - Math.exp(-3 * n / bloom) : Math.sin(0.5 * Math.PI * n / bloom) ** 2) : 1;
      d[i] += (lo * 2.4 * eLo + (w - lo) * eHi) * b * 0.4;
      eLo *= mLo; eHi *= mHi;
    }
    // air absorption: one-pole low-pass whose cutoff falls over time
    let y = 0, a = 0;
    for (let i = 0; i < len; i++) {
      if ((i & 31) === 0) {
        const t = i / rate;
        const fc = hang ? 3000 + 8000 * Math.exp(-t / 0.1) : 1300 + 4800 * Math.exp(-t / 0.6);
        a = 1 - Math.exp(-TAU * Math.min(fc, rate * 0.45) / rate);
      }
      y += a * (d[i] - y); d[i] = y;
    }
    if (hang) { bpResonate(d, rate, 240 + ch * 7, 7, 0.14); bpResonate(d, rate, 610, 9, 0.12); bpResonate(d, rate, 1480 - ch * 20, 10, 0.1); }
    const f = Math.round(len * 0.15);
    for (let i = 0; i < f; i++) d[len - 1 - i] *= (i / f) ** 2;
    chans.push(d);
  }
  let e = 0;
  for (const d of chans) for (let i = 0; i < d.length; i++) e += d[i] * d[i];
  const g = 1 / Math.sqrt(e / 2);
  for (const d of chans) for (let i = 0; i < d.length; i++) d[i] *= g;
  ir = { rate, chans };
  irCache.set(key, ir);
  return ir;
}

// ---------------------------------------------------------------------------------------------
// FFT (radix-2, tables cached per size) and FFT convolution (stereo via L + i·R packing).

const fftTabs = new Map();
function fftTables(n) {
  let t = fftTabs.get(n);
  if (t) return t;
  const rev = new Uint32Array(n), twr = new Float64Array(n), twi = new Float64Array(n);
  const bits = Math.round(Math.log2(n));
  for (let i = 0; i < n; i++) {
    let x = i, y = 0;
    for (let b = 0; b < bits; b++) { y = (y << 1) | (x & 1); x >>= 1; }
    rev[i] = y;
  }
  // twiddles for the stage with half-size h live contiguously at [h, 2h)
  for (let h = 1; h < n; h <<= 1) for (let j = 0; j < h; j++) { twr[h + j] = Math.cos(Math.PI * j / h); twi[h + j] = Math.sin(Math.PI * j / h); }
  t = { rev, twr, twi, re: new Float64Array(n), im: new Float64Array(n), re2: new Float64Array(n), im2: new Float64Array(n) };
  fftTabs.set(n, t);
  return t;
}

// In-place complex radix-2 FFT (length = power of two). inverse: unscaled.
export function fft(re, im, inverse) {
  const n = re.length, { rev, twr, twi } = fftTables(n);
  prof.fft += n * Math.log2(n) * 1e-6;
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  const sg = inverse ? 1 : -1;
  // stages 1+2 fused: twiddles are 1 and ±i
  for (let a = 0; a < n; a += 4) {
    const a0r = re[a], a0i = im[a], a1r = re[a + 1], a1i = im[a + 1], a2r = re[a + 2], a2i = im[a + 2], a3r = re[a + 3], a3i = im[a + 3];
    const b0r = a0r + a1r, b0i = a0i + a1i, b1r = a0r - a1r, b1i = a0i - a1i;
    const b2r = a2r + a3r, b2i = a2i + a3i, b3r = a2r - a3r, b3i = a2i - a3i;
    const tr = -sg * b3i, ti = sg * b3r;
    re[a] = b0r + b2r; im[a] = b0i + b2i; re[a + 2] = b0r - b2r; im[a + 2] = b0i - b2i;
    re[a + 1] = b1r + tr; im[a + 1] = b1i + ti; re[a + 3] = b1r - tr; im[a + 3] = b1i - ti;
  }
  for (let half = 4; half < n; half <<= 1) {
    const size = half << 1;
    for (let i = 0; i < n; i += size) {
      for (let j = 0; j < half; j++) {
        const wr = twr[half + j], wi = sg * twi[half + j], a = i + j, b = a + half;
        const xr = re[b], xi = im[b], tr = xr * wr - xi * wi, ti = xr * wi + xi * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}

// Per-sound impulse response at half rate: rv[0]·hangar + rv[1]·void (stereo).
const sirCache = new Map();
function soundIR(rv, sr) {
  const key = rv[0] + ':' + rv[1] + ':' + sr;
  if (sirCache.has(key)) return sirCache.get(key);
  const h = rv[0] ? getIR('hangar', sr).chans : null, w = rv[1] ? getIR('void', sr).chans : null;
  const len = Math.max(h ? h[0].length : 0, w ? w[0].length : 0);
  const out = [0, 1].map((c) => {
    const d = new Float32Array(len);
    if (h) for (let i = 0; i < h[c].length; i++) d[i] += rv[0] * h[c][i];
    if (w) for (let i = 0; i < w[c].length; i++) d[i] += rv[1] * w[c][i];
    return d;
  });
  sirCache.set(key, out);
  return out;
}

// Half-band windowed-sinc decimator taps (11 taps, Blackman) for the ÷2 send.
const HB = (() => {
  const N = 5, h = [];
  let sum = 0;
  for (let k = -N; k <= N; k++) {
    const x = k / 2, sinc = k === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const w = 0.42 + 0.5 * Math.cos(Math.PI * k / (N + 1)) + 0.08 * Math.cos(2 * Math.PI * k / (N + 1));
    h.push(0.5 * sinc * w); sum += 0.5 * sinc * w;
  }
  return h.map((x) => x / sum);
})();

// Reverb for all variants of one sound (in place): out_c += send ⊛ IR_c, computed at half
// rate. Two variants share each forward FFT (packed real + i·imag); mono outputs also share
// the inverse. The send is limited to `span` seconds (its reverb still rings on).
function convolveAll(vars, def, sr) {
  const ir = soundIR(def.rv, sr), irLen = ir[0].length, spanN = Math.round((def.rs || Math.min(def.dur * 0.55, 1.3)) * sr);
  const jobs = [];
  for (const v of vars) {
    const s = v.send;
    if (!s) continue;
    let s0 = 0, s1 = s.length;
    while (s0 < s1 && Math.abs(s[s0]) < 1e-6) s0++;
    while (s1 > s0 && Math.abs(s[s1 - 1]) < 1e-6) s1--;
    s1 = Math.min(s1, s0 + spanN);
    if (s1 <= s0) continue;
    const yMax = Math.ceil((v.dry[0].length - s0) / 2);
    const m = Math.min(Math.ceil((s1 - s0) / 2), yMax);
    let irT = Math.min(irLen, Math.ceil(yMax / 2048) * 2048), n = 1024;
    while (n < m + irT - 1) n <<= 1;
    // near miss: halve the FFT and cut the (already faint) far tail of the IR instead
    const cut = Math.floor((n / 2 - m + 1) / 1024) * 1024;
    if (n > 2048 && cut >= 0.72 * irT) { n >>= 1; irT = cut; }
    jobs.push({ v, s0, s1, m, yMax, irT, n });
  }
  jobs.sort((a, b) => a.n - b.n || a.irT - b.irT);
  const stereo = vars[0].dry.length > 1, spec = new Map();
  const H = (n, irT) => {   // IR spectrum (H_L + i·H_R for stereo), cached per size
    const key = n + ':' + irT;
    let h = spec.get(key);
    if (!h) {
      const re = new Float64Array(n), im = new Float64Array(n), fo = irT < irLen ? Math.round(irT * 0.12) : 0;
      for (let i = 0; i < irT; i++) {
        const w = i >= irT - fo ? (irT - i) / fo : 1;   // fade a truncated IR
        re[i] = ir[0][i] * w; if (stereo) im[i] = ir[1][i] * w;
      }
      fft(re, im, false);
      h = { re, im };
      spec.set(key, h);
    }
    return h;
  };
  const h0 = HB[5], h1 = HB[4], h3 = HB[2], h5 = HB[0];   // symmetric half-band: even taps (except centre) are 0
  const load = (J, dst) => {   // ÷2 decimation with a half-band FIR, short fade if truncated
    const s = J.v.send, end = J.s1, m = J.m, fade = end < s.length ? Math.min(m, 128) : 0;
    const at = (j) => (j >= 0 && j < end ? s[j] : 0);
    for (let i = 0; i < m; i++) {
      const c = J.s0 + 2 * i;
      let acc;
      if (c >= 5 && c + 5 < end) acc = h0 * s[c] + h1 * (s[c - 1] + s[c + 1]) + h3 * (s[c - 3] + s[c + 3]) + h5 * (s[c - 5] + s[c + 5]);
      else acc = h0 * at(c) + h1 * (at(c - 1) + at(c + 1)) + h3 * (at(c - 3) + at(c + 3)) + h5 * (at(c - 5) + at(c + 5));
      dst[i] = i >= m - fade ? acc * (m - i) / fade : acc;
    }
  };
  for (let k = 0; k < jobs.length; k++) {
    const A = jobs[k];
    let B = jobs[k + 1] || null, n = A.n, irT = A.irT;
    if (B) {
      n = Math.max(A.n, B.n); irT = Math.max(A.irT, B.irT);
      if (n < A.m + irT - 1 || n < B.m + irT - 1) { B = null; n = A.n; irT = A.irT; } else k++;
    }
    A.yLen = Math.min(A.yMax, A.m + irT - 1);
    if (B) B.yLen = Math.min(B.yMax, B.m + irT - 1);
    const h = H(n, irT), t = fftTables(n), re = t.re, im = t.im;
    re.fill(0); im.fill(0);
    load(A, re);
    if (B) load(B, im);
    fft(re, im, false);
    const hr = h.re, hi = h.im, g = 1 / n;
    if (!stereo) {
      // (A + iB)·H with a real IR → IFFT = a⊛h + i·(b⊛h)
      for (let i = 0; i < n; i++) { const a = re[i], b = im[i]; re[i] = a * hr[i] - b * hi[i]; im[i] = a * hi[i] + b * hr[i]; }
      fft(re, im, true);
      emit(A, re, null, g);
      if (B) emit(B, im, null, g);
    } else {
      // split the packed spectrum into the two real signals' spectra, then × (H_L + i·H_R)
      const r2 = t.re2, i2 = t.im2;
      for (let i = 0; i < n; i++) {
        const j = (n - i) & (n - 1), xr = re[i], xi = im[i], yr = re[j], yi = im[j];
        const ar = 0.5 * (xr + yr), ai = 0.5 * (xi - yi), br = 0.5 * (xi + yi), bi = 0.5 * (yr - xr);
        r2[i] = br * hr[i] - bi * hi[i]; i2[i] = br * hi[i] + bi * hr[i];
        re[i] = ar * hr[i] - ai * hi[i]; im[i] = ar * hi[i] + ai * hr[i];
      }
      fft(re, im, true);
      emit(A, re, im, g);
      if (B) { fft(r2, i2, true); emit(B, r2, i2, g); }
    }
  }
}

// Add a half-rate convolution result into a variant's outputs, upsampling ×2 (4-tap cubic).
function emit(J, yl, yr, g) {
  const n = yl.length, s0 = J.s0, yLen = J.yLen;
  const g16 = g / 16;
  const put = (O, y) => {
    const outLen = O.length, at = (k) => (k >= 0 && k < n ? y[k] : 0);
    const kEnd = Math.min(yLen, ((outLen - s0) >> 1) - 1);
    for (let k = 0; k < yLen; k++) {
      const i = s0 + 2 * k;
      if (k > 0 && k < kEnd && k + 2 < n) {
        O[i] += y[k] * g;
        O[i + 1] += g16 * (9 * (y[k] + y[k + 1]) - y[k - 1] - y[k + 2]);
      } else {
        O[i] += y[k] * g;
        if (i + 1 < outLen) O[i + 1] += g16 * (9 * (y[k] + at(k + 1)) - at(k - 1) - at(k + 2));
      }
    }
  };
  put(J.v.dry[0], yl);
  if (J.v.dry.length > 1) put(J.v.dry[1], yr);
}

// ---------------------------------------------------------------------------------------------
// Graph builder: one V per variant, all sharing one OfflineAudioContext (job).

const prof = { conv: 0, fft: 0, nodes: 0, srcSec: 0 };   // profiling counters (dev page)

const curveCache = new Map();
function shaperCurve(drive, asym, scale) {
  const key = drive.toFixed(3) + ':' + asym + ':' + scale.toFixed(3);
  let c = curveCache.get(key);
  if (c) return c;
  const n = 512;
  c = new Float32Array(n);
  const off = Math.tanh(drive * asym);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = scale * (Math.tanh(drive * (x + asym)) - off); }
  curveCache.set(key, c);
  return c;
}

// Level compensation so filtered noise lands near RMS 0.3 regardless of band.
function noiseComp(color, type, f, q, sr) {
  const fc = envMean(f), ny = sr / 2;
  if (color === 'white') {
    const bw = type === 'bandpass' ? fc / q : type === 'lowpass' ? fc : type === 'highpass' ? Math.max(ny * 0.05, ny - fc) : ny;
    return clamp(Math.sqrt(ny / Math.max(20, bw)), 1, 14);
  }
  if (color === 'pink') {
    if (type === 'bandpass') return clamp(Math.sqrt(6.7 * q), 1, 8);
    if (type === 'lowpass') return clamp(Math.sqrt(6.7 / Math.log(Math.max(40, fc) / 20)), 1, 4);
    if (type === 'highpass') return clamp(Math.sqrt(6.7 / Math.max(0.3, Math.log(ny / Math.max(20, fc)))), 1, 6);
  }
  return 1;
}

class V {
  constructor(j, t0, r, i) {
    this.j = j; this.ac = j.ac; this.sr = j.sr; this.st = j.st; this.t0 = t0; this.r = r; this.i = i;
  }
  T(t) { return this.t0 + t; }
  end(t, d) { return this.t0 + Math.min(t + d, this.j.dur + GAP * 0.5); }
  ev(p, t, a, mode) { applyEnv(p, this.T(t), a, mode); }

  // FM modulators use a cosine so the carrier phase gets a sine term: no DC sideband at 1:1.
  cosWave() { return this.j.cos || (this.j.cos = this.ac.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0]))); }
  osc(type, f, t, d, det = 0, aRate = false) {
    const o = this.ac.createOscillator();
    prof.nodes++; prof.srcSec += Math.min(d, this.j.dur - t);
    if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
    if (Array.isArray(f)) { if (!aRate && slowEnv(f)) kRate(o.frequency); this.ev(o.frequency, t, f, 'e'); }
    else o.frequency.value = f;
    if (det) o.detune.value = det;
    o.start(this.T(t)); o.stop(this.end(t, d));
    return o;
  }
  noise(color, t, d, rate = 1) {
    const s = this.ac.createBufferSource(), tabs = noiseTables(this.sr);
    prof.nodes++; prof.srcSec += Math.min(d, this.j.dur - t);
    let b = tabs.bufs[color];
    if (!b) {
      const data = tabs[color] || (tabs[color] = textureData(this.sr, color));   // crackle / shards built lazily
      b = this.ac.createBuffer(1, data.length, this.sr); b.getChannelData(0).set(data); tabs.bufs[color] = b;
    }
    s.buffer = b;
    const need = d * rate;
    let off = 0;
    if (need < NOISE_SEC - 0.05) off = this.r() * (NOISE_SEC - need - 0.05); else s.loop = true;
    if (rate !== 1) s.playbackRate.value = rate;
    s.start(this.T(t), off); s.stop(this.end(t, d));
    return s;
  }
  buf(data, t, rate = 1) {
    const b = this.ac.createBuffer(1, data.length, this.sr);
    prof.nodes++; prof.srcSec += Math.min(data.length / this.sr, this.j.dur - t);
    b.getChannelData(0).set(data);
    const s = this.ac.createBufferSource();
    s.buffer = b;
    if (rate !== 1) s.playbackRate.value = rate;
    s.start(this.T(t)); s.stop(this.end(t, data.length / this.sr / rate));
    return s;
  }
  bq(type, f, q = 0.707, t = 0, gain) {
    const b = this.ac.createBiquadFilter();
    prof.nodes++;
    b.type = type;
    const lh = type === 'lowpass' || type === 'highpass';    // WebAudio LP/HP "Q" is resonance in dB
    const qv = (x) => (lh ? 20 * Math.log10(Math.max(0.1, x)) : x);
    if (Array.isArray(f)) { if (slowEnv(f)) { kRate(b.frequency); kRate(b.Q); } this.ev(b.frequency, t, f, 'e'); }
    else b.frequency.value = f;
    if (Array.isArray(q)) this.ev(b.Q, t, envMap(q, qv), 'l'); else b.Q.value = qv(q);
    if (gain != null) b.gain.value = gain;
    return b;
  }
  amp(t, env, lvl = 1) {
    const g = this.ac.createGain();
    prof.nodes++;
    g.gain.value = 0;
    this.ev(g.gain, t, lvl === 1 ? env : envMap(env, (x) => x * lvl), 'l');
    return g;
  }
  gain(v) { const g = this.ac.createGain(); prof.nodes++; g.gain.value = v; return g; }
  ws(drive, asym = 0, os, scale = 1) {
    const w = this.ac.createWaveShaper();
    prof.nodes++;
    w.curve = shaperCurve(drive, asym, scale);
    if (os) w.oversample = os;
    return w;
  }
  delay(max, time, t = 0) {
    const d = this.ac.createDelay(max);
    if (Array.isArray(time)) this.ev(d.delayTime, t, time, 'l'); else d.delayTime.value = time;
    return d;
  }
  lfo(type, f, depth, param, t, d) {
    const o = this.osc(type, f, t, d), g = this.gain(depth);
    o.connect(g); g.connect(param);
    return o;
  }
  chain(...ns) {
    let a = null;
    for (const n of ns) { if (!n) continue; if (a) a.connect(n); a = n; }
    return a;
  }
  // Route a finished layer to the dry bus (panned in stereo renders) and the reverb send.
  out(node, rev = 0, pan = 0, t = 0) {
    const j = this.j;
    const idx = j.outIdx++;
    if (j.solo != null && idx !== j.solo) return;
    if (!j.st) node.connect(j.dryL);
    else if (!pan) { node.connect(j.dryL); node.connect(j.dryR); }
    else {
      const L = (p) => Math.cos((clamp(p, -1, 1) + 1) * Math.PI / 4) * Math.SQRT2;
      const R = (p) => Math.sin((clamp(p, -1, 1) + 1) * Math.PI / 4) * Math.SQRT2;
      let pr;
      if (Array.isArray(pan)) {
        pr = [this.ac.createGain(), this.ac.createGain()];
        this.ev(pr[0].gain, t, envMap(pan, L), 'l'); this.ev(pr[1].gain, t, envMap(pan, R), 'l');
        pr[0].connect(j.dryL); pr[1].connect(j.dryR);
      } else {
        const key = pan.toFixed(2);   // static pans are shared by every layer of the render
        pr = j.pans.get(key);
        if (!pr) { pr = [this.gain(L(pan)), this.gain(R(pan))]; pr[0].connect(j.dryL); pr[1].connect(j.dryR); j.pans.set(key, pr); }
      }
      node.connect(pr[0]); node.connect(pr[1]);
    }
    if (rev && j.send) {
      let g = j.sends.get(rev);   // one send gain per level, shared across layers
      if (!g) { g = this.gain(rev); g.connect(j.send); j.sends.set(rev, g); }
      node.connect(g);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Layer recipes

// Broadband transient: the "crack" at the front of an impact.
function click(v, t, o = {}) {
  const { hp = 2000, bp, tau = 0.002, lvl = 1, rev = 0, pan = 0 } = o;
  return nz(v, t, tau * 9 + 0.004, { type: bp ? 'bandpass' : 'highpass', f: bp || hp, q: bp ? 1.3 : 0.707, env: [0, 0.0004, 1, 'x', tau], lvl, rev, pan });
}

// Filtered noise layer: noise → filter → (drive) → (post filter) → envelope.
function nz(v, t, d, o) {
  const { color = 'white', type = 'bandpass', f = 1000, q = 1, env, lvl = 1, rev = 0, pan = 0, drive = 0, asym = 0, post, rate = 1, route = true } = o;
  const comp = noiseComp(color, type, f, q, v.sr);
  let n = v.chain(v.noise(color, t, Math.max(d, envLen(env)), rate), v.bq(type, f, q, t));
  if (drive) n = v.chain(n, v.ws(drive * comp, asym, null, 1 / Math.tanh(drive * 0.9)));
  if (post) n = v.chain(n, v.bq(post[0], post[1], post[2] ?? 0.707, t));
  n = v.chain(n, v.amp(t, env || [0, 0.002, 1, 'x', d / 5], drive ? lvl : lvl * comp));
  if (route) v.out(n, rev, pan, t);
  return n;
}

// Sub-bass thump with pitch drop, saturated so its harmonics still read on phone speakers.
function thump(v, t, o = {}) {
  const { f0 = 120, f1 = 45, sweep = 0.1, tau = 0.08, lvl = 1, drive = 2, rev = 0, pan = 0 } = o;
  const s = v.chain(v.osc('sine', [f0, sweep, f1], t, sweep + tau * 4.5), v.amp(t, [0, 0.002, 1, 'x', tau]));
  const n = drive ? v.chain(s, v.ws(drive, 0, null, lvl / Math.tanh(drive))) : v.chain(s, v.gain(lvl));
  v.out(n, rev, pan, t);
  return n;
}

// Two-operator FM voice. f / index may be envelopes (same shape → exact depth tracking).
function fmTone(v, t, d, o) {
  const { f, ratio = 1, index = 1, type = 'sine', mtype, env, lvl = 1, rev = 0, pan = 0, filt, det = 0 } = o;
  d = Math.max(d, envLen(env));
  const car = v.osc(type, f, t, d, det, true);
  const dcRisk = Math.abs(1 / ratio - Math.round(1 / ratio)) < 1e-6;   // 1, 1/2, 1/3 …
  const mod = v.osc(mtype || (dcRisk ? v.cosWave() : 'sine'), envMap(f, (x) => x * ratio), t, d);
  let depth;
  if (Array.isArray(index)) {
    if (plainEnv(index) && plainEnv(f) && index.length === f.length) depth = index.map((x, k) => (k % 2 ? x : x * f[k] * ratio));
    else { const fm = envMean(f) * ratio; depth = envMap(index, (x) => x * fm); }
  } else depth = envMap(f, (x) => x * ratio * index);
  const mg = v.ac.createGain();
  if (Array.isArray(depth)) v.ev(mg.gain, t, depth, 'e'); else mg.gain.value = depth;
  mod.connect(mg); mg.connect(car.frequency);
  let n = car;
  if (filt) n = v.chain(n, v.bq(filt[0], filt[1], filt[2] ?? 0.707, t));
  n = v.chain(n, v.amp(t, env || [0, 0.003, 1, 'x', d / 5], lvl));
  v.out(n, rev, pan, t);
  return n;
}

const PLATE = [1, 1.594, 2.136, 2.296, 2.653, 2.918, 3.598];
const GLASS = [1, 2.0, 2.76, 5.4];

function modes(v, t, o) {
  const { f, ratios = PLATE, taus, amps = [1], lvl = 1, rev = 0, pan = 0, pair = 0, hp } = o;
  let n = v.buf(modalData(v.sr, v.r, f, ratios, taus, amps, pair), t);
  if (hp) n = v.chain(n, v.bq('highpass', hp));
  n = v.chain(n, v.gain(lvl));
  v.out(n, rev, pan, t);
  return n;
}

// Debris / electric crackle from the shared crackle tables; decaying (debris) or rising (charge)
// loudness. Split L/R in stereo renders for width.
function debris(v, t, d, o) {
  const { n = 30, tau = 0.2, rise = false, hp = 1500, bp, q = 0.9, lvl = 1, rev = 0, pan = 0 } = o;
  const kind = n / (rise ? d : tau * 1.6) > 90 ? 'dense' : 'crackle';
  const env = rise ? [0.15, d * 0.85, 1, d * 0.15, 1] : [0, 0.002, 1, 'x', tau * 1.3];
  const D = rise ? d : Math.max(d, envLen(env));
  const k = kind === 'dense' ? 2.2 : 3.5;   // the tables are mostly silence: bring grains up to layer level
  const one = (p, l) => v.out(v.chain(v.noise(kind, t, D), bp ? v.bq('bandpass', bp, q) : v.bq('highpass', hp, 0.707), v.amp(t, env, l * k)), rev, p, t);
  if (v.st) { one(-0.7, lvl * 0.8); one(0.7, lvl * 0.8); } else one(pan, lvl);
}

function swell(v, t, d, o) {
  const { tau = d / 3.5, color = 'pink', type = 'bandpass', f = 2000, q = 1, lvl = 1, rev = 0, pan = 0 } = o;
  const n = v.chain(v.buf(swellData(v.sr, v.r, d, tau, color), t), v.bq(type, f, q, t), v.gain(lvl * (type === 'bandpass' ? Math.sqrt(q) * 1.5 : 1)));
  v.out(n, rev, pan, t);
  return n;
}

// Chorused shimmer chord: sine partials slightly detuned (opposite ways in L and R), soft
// attack, long decay, optional tremolo.
function chord(v, t, d, notes, o = {}) {
  const { att = 0.05, tau = 1, det = 0.0025, trem = 0, depth = 0, lvl = 1, rev = 0, pan = 0 } = o;
  const one = (p, l, sg) => {
    const m = v.gain(l / Math.sqrt(notes.length));
    for (const f of notes) v.osc('sine', f * (1 + sg * det * (0.6 + 0.8 * v.r())), t, Math.max(d, att * 2.5 + tau * 4.5)).connect(m);
    v.out(v.chain(m, trem ? am(v, trem, depth, t, d) : null, v.amp(t, [0, att * 2.5, 1, 'x', tau])), rev, p, t);
  };
  if (v.st) { one(-0.55, lvl * 0.8, -1); one(0.55, lvl * 0.8, 1); } else { one(pan, lvl * 0.7, -1); one(pan, lvl * 0.7, 1); }
}

// Glass shards / sparkles from the shared shard table with a decaying envelope.
function grains(v, t, d, o) {
  const { tmax = 0.2, lvl = 1, rev = 0, pan = 0 } = o;
  const env = [0, 0.003, 1, 'x', tmax * 0.6], D = Math.max(d, envLen(env));
  const one = (p, l) => v.out(v.chain(v.noise('shards', t, D), v.amp(t, env, l * 2.5)), rev, p, t);
  if (v.st) { one(-0.6, lvl * 0.8); one(0.6, lvl * 0.8); } else one(pan, lvl);
}

// Detuned oscillator stack (returns the mix node for further processing).
function saws(v, t, d, o) {
  const { f, n = 2, spread = 12, type = 'sawtooth', lvl = 1 } = o;
  const m = v.gain(lvl / Math.sqrt(n));
  for (let k = 0; k < n; k++) {
    const det = n === 1 ? 0 : (k / (n - 1) * 2 - 1) * spread + (v.r() - 0.5) * 3;
    v.osc(type, f, t, d, det).connect(m);
  }
  return m;
}

// Tremolo / amplitude-modulation stage: gain oscillating between 1-depth and 1.
function am(v, rate, depth, t, d, type = 'sine') {
  const g = v.gain(1 - depth / 2);
  v.lfo(type, rate, depth / 2, g.gain, t, d);
  return g;
}

// Electrical short: an oscillator hopping to random pitches, band-passed and overdriven.
function zap(v, t, d, o) {
  const { fmin = 200, fmax = 1600, smin = 0.012, smax = 0.03, bp = 1800, q = 1.5, drive = 4, env, lvl = 1, rev = 0, pan = 0, type = 'sawtooth' } = o;
  const e = env || [0, 0.01, 1, 'x', d / 4];
  const osc = v.osc(type, fmin, t, Math.max(d, envLen(e)));
  for (let tt = t; tt < t + d; tt += v.r.range(smin, smax)) osc.frequency.setValueAtTime(fmin * Math.pow(fmax / fmin, v.r()), v.T(tt));
  const n = v.chain(osc, v.bq('bandpass', bp, q), v.gain(2.5), v.ws(drive), v.amp(t, e, lvl));
  v.out(n, rev, pan, t);
  return n;
}

// Rapid data chirps (network / computer chatter).
function blips(v, t, o) {
  const { n = 6, gap = 0.02, len = 0.012, fmin = 1800, fmax = 4200, lvl = 1, rev = 0, pan = 0, type = 'square' } = o;
  const osc = v.osc(type, fmin, t, n * gap + 0.02), g = v.ac.createGain();
  g.gain.value = 0;
  for (let k = 0; k < n; k++) {
    const tk = v.T(t + k * gap);
    osc.frequency.setValueAtTime(fmin * Math.pow(fmax / fmin, v.r()), tk);
    g.gain.setValueAtTime(0, tk); g.gain.linearRampToValueAtTime(1, tk + 0.001);
    g.gain.setValueAtTime(1, tk + len - 0.002); g.gain.linearRampToValueAtTime(0, tk + len);
  }
  v.out(v.chain(osc, v.bq('lowpass', 6500), g, v.gain(lvl)), rev, pan, t);
}

// Explosion: crack + overdriven crunch + fireball whoomph + sub thump + rumble + debris.
// s: 0 (popcorn) … 1 (capital ship). Everything scales in weight and length.
function boom(v, t, s, o = {}) {
  const r = v.r, L = (a, b) => a + (b - a) * s, k = o.lvl ?? 1, pan = o.pan || 0;
  if (!o.lite) click(v, t, { hp: r.jit(L(2200, 800), 0.2), tau: L(0.005, 0.014), lvl: 1.1 * k, rev: 0.35, pan });
  const ct = L(0.045, 0.2) * r.range(0.85, 1.2);
  nz(v, t, ct * 5 + 0.02, { f: r.jit(L(1300, 480), 0.2), q: 0.9, drive: 3, post: ['lowpass', [7500, ct * 3, L(1800, 700)], 0.7], env: [0, 0.0015, 1, 'x', ct], lvl: 0.5 * k, rev: 0.35, pan });
  const ft = L(0.09, 0.45) * r.range(0.85, 1.2);
  nz(v, t, ft * 4.5 + 0.03, { color: 'pink', type: 'lowpass', f: [L(3400, 2600), ft * 2.5, L(300, 110)], q: 0.8, env: [0, L(0.005, 0.02), 1, 'x', ft], lvl: 0.75 * k, rev: 0.4, pan });
  thump(v, t, { f0: r.jit(L(150, 72), 0.1), f1: L(52, 24), sweep: L(0.1, 0.8), tau: L(0.06, 0.38), lvl: 0.6 * k, drive: 2.6, pan });
  if (o.lite) return;   // secondary blasts: the main blast supplies rumble and debris
  const rt = L(0.15, 1.0) * r.range(0.85, 1.2), t2 = t + L(0.008, 0.03), rd = rt * 4.5 + 0.1;
  const rum = nz(v, t2, rd, { color: 'brown', type: 'lowpass', f: [L(1100, 750), rt * 2, L(220, 70)], q: 0.7, env: [0, L(0.03, 0.14), 1, 'x', rt], lvl: 0.6 * k, rev: 0.25, pan, route: s < 0.5 });
  if (s >= 0.5) {
    // big blasts "roll": slow random amplitude undulation, like echoes off distant hulls
    const roll = v.gain(0.75), fr = r.range(4, 7);
    v.chain(v.noise('white', t2, rd), v.bq('lowpass', fr, 0.7), v.gain(0.25 / (0.3 * Math.sqrt(1.11 * fr / (v.sr / 2)))), roll.gain);
    v.out(v.chain(rum, roll), 0.25, pan, t);
  }
  const dt = L(0.12, 0.8);
  debris(v, t + 0.006, dt * 3.5, { n: Math.round(L(14, 110)), tau: dt, hp: L(1800, 1100), lvl: 0.35 * k, rev: 0.3, pan });
}

// Heavy metal clank (hull plates, girders).
function clank(v, t, o = {}) {
  const r = v.r, { f = r.range(280, 560), lvl = 0.4, rev = 0.3, pan = 0 } = o;
  modes(v, t, { f, ratios: PLATE.slice(0, 5), taus: [0.3, 0.22, 0.16, 0.12, 0.09], amps: [1, 0.8, 0.6, 0.5, 0.4], lvl, rev, pan });
  nz(v, t, 0.05, { f: f * 3, q: 1.5, env: [0, 0.0005, 1, 'x', 0.006], lvl: lvl * 0.9, pan });
}

// ---------------------------------------------------------------------------------------------
// Sound definitions.
//   dur  seconds per variant      n     variants           sr    render rate
//   st   stereo render            rv    [hangar, void] IR weights of the reverb send (or none)
//   db   target loudness (phone-weighted short-term, dBFS at the sfx bus)
//   max  voices per name          cd    retrigger cooldown (s)   pj  ± random pitch (semitones)
//   pri  steal priority (0 spam … 3 critical)
//   loop loopStart (s) for loopable sounds (loopEnd = dur);  os  one-shot sustain for sfx()

const S = {
  // ---- player weapons -----------------------------------------------------------------------
  shot_aurora: {
    dur: 0.26, n: 5, sr: HI, rv: [1, 0], db: -24, max: 3, cd: 0.045, pj: 0.8, pri: 0,
    fn(v, r) {
      const f0 = r.jit(1650, 0.08), fe = f0 * r.range(0.28, 0.34), sw = r.range(0.05, 0.07);
      click(v, 0, { hp: 3200, tau: 0.0012, lvl: 0.55 });
      nz(v, 0, 0.05, { f: r.jit(1500, 0.12), q: 2.2, env: [0, 0.0008, 1, 'x', 0.006], lvl: 0.7, rev: 0.15 });
      fmTone(v, 0, 0.14, { f: [f0, sw, fe], ratio: 1.41, index: [2.4, sw, 0.3], type: 'triangle', env: [0, 0.002, 1, 'x', r.range(0.018, 0.026)], lvl: 0.5, filt: ['lowpass', [6000, sw, 1400], 1.5], rev: 0.2 });
      thump(v, 0, { f0: r.jit(200, 0.1), f1: 70, sweep: 0.035, tau: 0.014, lvl: 0.45, drive: 2.5 });
    },
  },

  shot_tempest_loop: {
    dur: 1.25, n: 3, sr: XLO, loop: 0.25, os: 0.22, db: -25, max: 4, cd: 0.08, pj: 0, pri: 1,
    fn(v, r) {
      // ignition
      click(v, 0, { hp: 2500, tau: 0.003, lvl: 0.5 });
      fmTone(v, 0, 0.15, { f: [2600, 0.09, 900], ratio: 2.01, index: [3, 0.09, 0.5], env: [0, 0.002, 1, 'x', 0.03], lvl: 0.35, filt: ['lowpass', 7000, 1] });
      // steady lance — every rate is an integer Hz so the body repeats exactly every second
      const b = r.pick([108, 110, 112]), T = 1.3;
      const hum = v.gain(1);
      v.chain(v.osc('sawtooth', b, 0.01, T), v.gain(0.5), hum);
      v.chain(v.osc('sawtooth', b + 1, 0.01, T), v.gain(0.5), hum);
      v.chain(v.osc('square', b / 2, 0.01, T), v.gain(0.3), hum);
      const lp = v.bq('lowpass', 1500, 4);
      v.lfo('sine', 6, 400, lp.frequency, 0.01, T);
      v.out(v.chain(hum, lp, v.ws(1.8), v.amp(0, [0, 0.04, 0.5])));
      const wh = v.osc('sine', b * 16, 0.01, T);
      v.lfo('sine', 8, b * 16 * 0.004, wh.frequency, 0.01, T);
      v.out(v.chain(wh, v.amp(0, [0, 0.05, 0.06])));
      const sz = am(v, 24, 0.7, 0, T, 'square');
      v.out(v.chain(v.noise('white', 0, T), v.bq('bandpass', 6500, 1.2), v.gain(noiseComp('white', 'bandpass', 6500, 1.2, v.sr)), sz, v.amp(0, [0, 0.03, 0.12])));
    },
  },

  shot_seraph: {
    dur: 0.46, n: 4, sr: HI, rv: [1, 0], db: -23, max: 3, cd: 0.07, pj: 1, pri: 0,
    fn(v, r) {
      click(v, 0, { hp: 900, tau: 0.003, lvl: 0.5 });
      thump(v, 0, { f0: 160, f1: 80, sweep: 0.02, tau: 0.012, lvl: 0.35, drive: 2 });
      const f1 = r.jit(3200, 0.12);
      nz(v, 0.004, 0.42, { f: [r.jit(700, 0.1), 0.09, f1, 0.25, f1 * 0.55], q: 2.2, env: [0, 0.012, 1, 0.06, 0.75, 'x', 0.09], lvl: 0.7, rev: 0.2 });
      const sp = am(v, r.jit(47, 0.1), 0.5, 0, 0.4, 'square');
      v.out(v.chain(v.noise('brown', 0, 0.6), v.bq('lowpass', 900, 0.8), sp, v.amp(0, [0, 0.015, 1, 'x', 0.1], 0.6)), 0.15);
      nz(v, 0, 0.3, { type: 'highpass', f: 6500, env: [0, 0.005, 1, 'x', 0.05], lvl: 0.18, rev: 0.1 });
    },
  },

  shot_valkyrie: {
    dur: 0.34, n: 4, sr: HI, rv: [1, 0], db: -23, max: 3, cd: 0.06, pj: 0.8, pri: 0,
    fn(v, r) {
      const f = r.jit(310, 0.08), T = 0.2;
      click(v, 0, { bp: 3200, tau: 0.003, lvl: 0.4 });
      // plasma body: sub-harmonic FM growl through a closing resonant band + moving comb
      const car = v.osc('sine', [f, T, f * 0.5], 0, 0.4, 0, true);
      const mod = v.osc(v.cosWave(), [f * 0.5, T, f * 0.25], 0, 0.28), mg = v.ac.createGain();
      v.ev(mg.gain, 0, [f * 2.5, T, f * 0.25], 'e');
      mod.connect(mg); mg.connect(car.frequency);
      const hiss = v.osc(v.cosWave(), f * 7.1, 0, 0.28), hg = v.gain(f * 0.8);
      hiss.connect(hg); hg.connect(car.frequency);
      const body = v.chain(car, v.bq('bandpass', [2600, 0.22, 650], 2.5), v.gain(2.2), v.ws(2), v.amp(0, [0, 0.006, 1, 0.04, 0.75, 'x', 0.06], 0.55));
      v.out(body, 0.2);
      v.out(v.chain(body, v.delay(0.01, [0.0009, 0.25, 0.004]), v.gain(0.7)), 0.1);
      const fz = am(v, 36, 0.8, 0, 0.3, 'square');
      nz(v, 0, 0.3, { type: 'highpass', f: 5000, env: [0, 0.01, 0.6, 'x', 0.07], lvl: 0.12, route: false }).connect(fz);
      v.out(fz, 0.1);
    },
  },

  shot_option: {
    dur: 0.1, n: 4, sr: HI, db: -30, max: 2, cd: 0.06, pj: 1, pri: 0,
    fn(v, r) {
      click(v, 0, { hp: 4500, tau: 0.0008, lvl: 0.5 });
      const f = r.jit(2700, 0.06);
      v.out(v.chain(v.osc('square', [f, 0.025, f * 0.6], 0, 0.06), v.bq('lowpass', 6000, 1), v.amp(0, [0, 0.001, 1, 'x', 0.011], 0.35)));
    },
  },

  // ---- impacts ----------------------------------------------------------------------------
  hit_enemy: {
    dur: 0.12, n: 6, sr: HI, rv: [1, 0], db: -28, max: 3, cd: 0.035, pj: 1.2, pri: 0,
    fn(v, r) {
      nz(v, 0, 0.03, { f: r.jit(4200, 0.2), q: 1.4, env: [0, 0.0003, 1, 'x', 0.0025], lvl: 0.8 });
      nz(v, 0, 0.05, { f: r.jit(950, 0.15), q: 3, env: [0, 0.0005, 1, 'x', 0.006], lvl: 0.6 });
      modes(v, 0, { f: r.jit(2600, 0.15), ratios: [1, 1.47, 2.09, 2.83], taus: [0.016, 0.011, 0.008, 0.006], amps: [1, 0.6, 0.4, 0.25], lvl: 0.22, rev: 0.1 });
    },
  },

  hit_armor: {
    dur: 0.4, n: 5, sr: HI, rv: [1, 0], db: -24, max: 2, cd: 0.06, pj: 1, pri: 0,
    fn(v, r) {
      click(v, 0, { hp: 3000, tau: 0.0015, lvl: 0.6 });
      nz(v, 0, 0.05, { f: 700, q: 2, env: [0, 0.0005, 1, 'x', 0.008], lvl: 0.5 });
      modes(v, 0, { f: r.jit(1250, 0.12), taus: [0.22, 0.16, 0.12, 0.1, 0.08, 0.06, 0.04], amps: [1, 0.8, 0.6, 0.55, 0.4, 0.3, 0.2], pair: 0.003, lvl: 0.45, rev: 0.25 });
      const w0 = r.jit(3400, 0.1);
      v.out(v.chain(v.osc('triangle', [w0, 0.2, w0 * 0.62], 0.005, 0.4), v.amp(0.005, [0, 0.01, 1, 'x', 0.06], 0.1)), 0.3);
    },
  },

  // ---- explosions -------------------------------------------------------------------------
  explode_small: {
    dur: 0.8, n: 5, sr: LO, rv: [0.6, 0.4], db: -17, max: 4, cd: 0.03, pj: 1.5, pri: 1, sat: 1.2,
    fn(v) { boom(v, 0, 0); },
  },

  explode_medium: {
    dur: 1.2, n: 4, sr: LO, st: 1, rv: [0.4, 0.6], db: -14, max: 3, cd: 0.05, pj: 1.2, pri: 1, sat: 1.4,
    fn(v, r) {
      boom(v, 0, 0.35);
      if (r() < 0.75) boom(v, r.range(0.08, 0.22), 0.05, { lvl: 0.45, pan: r.range(-0.4, 0.4), lite: 1 });
    },
  },

  explode_large: {
    dur: 1.9, n: 3, sr: XLO, st: 1, rv: [0.3, 0.7], db: -11, max: 2, cd: 0.08, pj: 1, pri: 2, sat: 1.7,
    fn(v, r) {
      boom(v, 0, 0.65);
      const n2 = 1 + (r() < 0.5 ? 1 : 0);
      for (let k = 0; k < n2; k++) boom(v, r.range(0.07, 0.35), 0.15, { lvl: 0.5, pan: r.range(-0.6, 0.6), lite: 1 });
      clank(v, r.range(0.05, 0.3), { lvl: 0.18, pan: r.range(-0.5, 0.5) });
    },
  },

  explode_boss: {
    dur: 3.4, n: 3, sr: XLO, st: 1, rv: [0.2, 0.8], db: -9, max: 2, cd: 0.3, pj: 0.6, pri: 3, sat: 2.4,
    fn(v, r) {
      boom(v, 0, 1);
      let t = 0;
      for (let k = 0; k < 2; k++) { t += r.range(0.16, 0.36); boom(v, t, r.range(0.4, 0.6), { lvl: 0.6, pan: k ? r.range(0.3, 0.7) : r.range(-0.7, -0.3), lite: 1 }); }
      thump(v, 0.02, { f0: 62, f1: 22, sweep: 1.5, tau: 0.7, lvl: 0.7, drive: 1.6 });
      // roaring fire storm, slowly modulated
      const fl = am(v, r.range(3, 5), 0.5, 0, 3.7);
      nz(v, 0.05, 3.6, { color: 'pink', f: [900, 2.5, 300], q: 0.6, env: [0, 0.2, 1, 'x', 0.6], lvl: 0.5, route: false }).connect(fl);
      v.out(fl, 0.4);
      for (let k = 0; k < 2; k++) clank(v, r.range(0.1, 1.0), { f: r.range(220, 480), lvl: 0.28, pan: k ? r.range(0.2, 0.8) : r.range(-0.8, -0.2) });
      grains(v, 0.2, 2.6, { n: 26, fmin: 2500, fmax: 7000, tmax: 1.8, taumin: 0.01, taumax: 0.05, lvl: 0.12, rev: 0.6 });
    },
  },

  // ---- enemy weapons ------------------------------------------------------------------------
  enemy_shot: {
    dur: 0.2, n: 5, sr: HI, rv: [1, 0], db: -27, max: 3, cd: 0.06, pj: 1, pri: 0,
    fn(v, r) {
      const f = r.jit(1500, 0.1), e = f * r.range(0.55, 0.65);
      fmTone(v, 0, 0.12, { f: [f, 0.05, e], ratio: 3.53, index: [1.8, 0.05, 0.25], env: [0, 0.002, 1, 'x', 0.028], lvl: 0.5, rev: 0.15 });
      nz(v, 0, 0.04, { f: r.jit(3600, 0.1), q: 2, env: [0, 0.002, 1, 'x', 0.01], lvl: 0.4 });
      thump(v, 0, { f0: 420, f1: 250, sweep: 0.02, tau: 0.012, lvl: 0.2, drive: 0 });
    },
  },

  enemy_shot_heavy: {
    dur: 0.45, n: 4, sr: LO, rv: [0.7, 0.3], db: -22, max: 2, cd: 0.1, pj: 1, pri: 1,
    fn(v, r) {
      const f = r.jit(430, 0.08);
      fmTone(v, 0, 0.35, { f: [f, 0.18, f * 0.33], ratio: 1.5, index: [3.2, 0.18, 0.6], env: [0, 0.005, 1, 0.04, 0.7, 'x', 0.07], lvl: 0.55, rev: 0.25, filt: ['lowpass', [5000, 0.2, 900], 1] });
      fmTone(v, 0, 0.3, { f: [f * 2.01, 0.18, f * 0.66], ratio: 1, index: 1, env: [0, 0.004, 1, 'x', 0.05], lvl: 0.2 });
      thump(v, 0, { f0: 130, f1: 60, sweep: 0.06, tau: 0.05, lvl: 0.5, drive: 2 });
      nz(v, 0, 0.3, { f: [1400, 0.2, 500], q: 1.6, env: [0, 0.01, 1, 'x', 0.06], lvl: 0.45, rev: 0.2 });
      click(v, 0, { hp: 2000, tau: 0.002, lvl: 0.35 });
    },
  },

  enemy_laser_charge: {
    dur: 1.2, n: 3, sr: XLO, rv: [0.6, 0.4], db: -20, max: 2, cd: 0.2, pj: 0.5, pri: 1,
    fn(v, r) {
      const T = 1.0, f0 = r.jit(170, 0.08), f1 = f0 * r.range(7.5, 8.5);
      const mix = saws(v, 0, T + 0.05, { f: [f0, T, f1], n: 2, spread: 9 });
      const trem = v.gain(0.55);
      v.lfo('sine', [5, T, 34], 0.45, trem.gain, 0, T + 0.05);
      v.out(v.chain(mix, v.bq('bandpass', [f0 * 3, T, f1 * 2], [3, T, 8]), v.gain(3), trem, v.amp(0, [0, 0.5, 0.5, 0.45, 1, 0.05, 0], 0.6)), 0.3);
      debris(v, 0, T, { n: 70, tau: 0.3, rise: true, bp: 5000, lvl: 0.3, rev: 0.2 });
      v.out(v.chain(v.osc('sine', [55, T, 110], 0, T + 0.05), v.amp(0, [0, 0.6, 0.5, 0.4, 1, 0.05, 0]), v.ws(2), v.gain(0.2)));
      nz(v, 0, T + 0.05, { type: 'highpass', f: [400, T, 4500], env: [0, 0.8, 0.4, 0.2, 1, 0.05, 0], lvl: 0.25, rev: 0.3 });
    },
  },

  enemy_laser_fire: {
    dur: 1.35, n: 3, sr: XLO, loop: 0.35, os: 0.9, db: -17, max: 2, cd: 0.15, pj: 0, pri: 1,
    fn(v, r) {
      click(v, 0, { hp: 1500, tau: 0.005, lvl: 0.7 });
      thump(v, 0, { f0: 110, f1: 45, sweep: 0.06, tau: 0.045, lvl: 0.6, drive: 2.5 });
      fmTone(v, 0, 0.2, { f: [3200, 0.12, 420], ratio: 1.5, index: [4, 0.12, 0.5], env: [0, 0.002, 1, 'x', 0.035], lvl: 0.4 });
      // sustained beam (integer-Hz rates → exactly periodic over the 1 s loop)
      const b = r.pick([72, 73, 74]), T = 1.4, roar = v.gain(1);
      for (const [f, a] of [[b, 0.4], [b + 1, 0.4], [b * 2, 0.25], [b * 2 + 1, 0.25]]) v.chain(v.osc('sawtooth', f, 0.01, T), v.gain(a), roar);
      const lp = v.bq('lowpass', 2400, 2);
      v.lfo('sine', 4, 500, lp.frequency, 0.01, T);
      v.out(v.chain(roar, v.ws(3), lp, am(v, 30, 0.35, 0.01, T), v.amp(0, [0, 0.03, 0.5])));
      v.out(v.chain(v.noise('white', 0, T), v.bq('bandpass', 5200, 1), v.gain(noiseComp('white', 'bandpass', 5200, 1, v.sr)), am(v, 18, 0.8, 0, T), v.amp(0, [0, 0.03, 0.25])));
      const wh = v.osc('sine', b * 16, 0.01, T), wh2 = v.osc('sine', b * 24, 0.01, T), wm = v.gain(1);
      v.lfo('sine', 7, b * 16 * 0.005, wh.frequency, 0.01, T);
      wh.connect(wm); v.chain(wh2, v.gain(0.6), wm);
      v.out(v.chain(wm, v.amp(0, [0, 0.05, 0.05])));
    },
  },

  // ---- player events ----------------------------------------------------------------------
  player_hit: {
    dur: 0.65, n: 3, sr: LO, rv: [0.7, 0.3], db: -13, max: 2, cd: 0.1, pj: 0.8, pri: 2, sat: 1.3,
    fn(v, r) {
      click(v, 0, { hp: 1400, tau: 0.006, lvl: 0.7, rev: 0.2 });
      thump(v, 0, { f0: 150, f1: 48, sweep: 0.07, tau: 0.07, lvl: 0.6, drive: 3 });
      nz(v, 0, 0.5, { f: 800, q: 1, drive: 4, env: [0, 0.002, 1, 'x', 0.07], lvl: 0.6, rev: 0.25 });
      zap(v, 0.01, 0.3, { fmin: 180, fmax: 1500, bp: 1800, drive: 4, env: [0, 0.01, 0.8, 'x', 0.09], lvl: 0.65, rev: 0.2 });
      v.out(v.chain(v.osc('triangle', [1400, 0.3, 300], 0.02, 0.6), v.amp(0.02, [0, 0.01, 1, 'x', 0.1], 0.16)), 0.3);
    },
  },

  player_explode: {
    dur: 2.1, n: 3, sr: XLO, st: 1, rv: [0.3, 0.7], db: -10, max: 2, cd: 0.2, pj: 0.6, pri: 3, sat: 1.7,
    fn(v, r) {
      boom(v, 0, 0.72);
      const wf = r.jit(1500, 0.08);
      const wh = saws(v, 0, 2, { f: [wf, 0.9, 70], n: 2, spread: 15 });
      v.chain(v.osc('sine', [wf * 2, 0.9, 140], 0, 2), v.gain(0.4), wh);
      v.out(v.chain(wh, v.bq('lowpass', [5000, 0.9, 400], 1.5), v.amp(0, [0, 0.01, 1, 'x', 0.3], 0.22)), 0.4);
      grains(v, 0.01, 0.6, { n: 16, fmin: 3000, fmax: 8000, tmax: 0.25, taumin: 0.015, taumax: 0.07, lvl: 0.2, rev: 0.3 });
      clank(v, r.range(0.12, 0.3), { lvl: 0.2, pan: -0.4 });
      clank(v, r.range(0.3, 0.6), { lvl: 0.15, pan: 0.4 });
    },
  },

  shield_up: {
    dur: 0.95, n: 3, sr: LO, rv: [0.3, 0.7], db: -19, max: 2, cd: 0.2, pj: 0.5, pri: 2,
    fn(v, r) {
      const k = semiToRate(r.pick([0, 1, -1]));
      const sw = saws(v, 0, 0.95, { f: [220 * k, 0.35, 880 * k], n: 2, spread: 10 });
      v.out(v.chain(sw, v.bq('bandpass', [440 * k, 0.35, 1760 * k], 4), v.gain(2), v.amp(0, [0, 0.05, 1, 0.3, 0.6, 'x', 0.1], 0.35)), 0.3);
      nz(v, 0, 0.6, { f: [400, 0.35, 2200], q: 2, env: [0, 0.25, 1, 'x', 0.08], lvl: 0.35, rev: 0.3 });
      [659.3, 987.8, 1318.5].forEach((f, j) => fmTone(v, 0.22 + j * 0.03, 0.65, { f: f * k, ratio: 3.5, index: [1.2, 0.3, 0.1], env: [0, 0.003, 1, 'x', 0.18], lvl: 0.22, rev: 0.5 }));
      v.out(v.chain(v.osc('sine', 2637 * k, 0.25, 0.7), am(v, 12, 0.8, 0.25, 0.7), v.amp(0.25, [0, 0.1, 1, 'x', 0.2], 0.07)), 0.5);
    },
  },

  respawn: {
    dur: 1.15, n: 3, sr: LO, rv: [0.3, 0.7], db: -17, max: 2, cd: 0.3, pj: 0.5, pri: 2,
    fn(v, r) {
      const T = r.range(0.4, 0.45);
      swell(v, 0, T, { f: [300, T, 3500], q: 1.2, lvl: 0.7, rev: 0.3 });
      v.out(v.chain(v.osc('triangle', [150, T, 1000], 0, T + 0.02), v.amp(0, [0, T * 0.8, 1, T * 0.2, 0.6, 0.02, 0], 0.25)), 0.2);
      click(v, T, { hp: 2000, tau: 0.004, lvl: 0.5, rev: 0.3 });
      thump(v, T, { f0: 130, f1: 55, sweep: 0.05, tau: 0.06, lvl: 0.6, drive: 2 });
      [880, 1108.7, 1318.5].forEach((f, j) => fmTone(v, T + j * 0.018, 0.6, { f, ratio: 2, index: [1.5, 0.2, 0.2], env: [0, 0.003, 1, 'x', 0.16], lvl: 0.2, rev: 0.5 }));
      nz(v, T, 0.2, { type: 'highpass', f: 6000, env: [0, 0.002, 1, 'x', 0.04], lvl: 0.25, rev: 0.3 });
    },
  },

  // ---- pickups ------------------------------------------------------------------------------
  pickup_power: {
    dur: 0.55, n: 3, sr: LO, rv: [0.3, 0.7], db: -17, max: 2, cd: 0.05, pj: 0.3, pri: 1,
    fn(v, r) {
      const root = 587.3;
      [1, 1.5, 2, 3].forEach((m, j) => fmTone(v, j * 0.035, 0.3, { f: root * m, ratio: 2, index: [r.range(2.5, 3.5), 0.06, 0.4], env: [0, 0.002, 1, 'x', 0.07], lvl: 0.3, rev: 0.25 }));
      v.out(v.chain(v.osc('square', [300, 0.15, 1200], 0, 0.18), v.bq('lowpass', 2500, 1), v.amp(0, [0, 0.01, 1, 0.12, 0.5, 0.05, 0], 0.12)));
      nz(v, 0.1, 0.2, { type: 'highpass', f: 7000, env: [0, 0.005, 1, 'x', 0.05], lvl: 0.15, rev: 0.4 });
    },
  },

  pickup_bomb: {
    dur: 0.6, n: 3, sr: LO, rv: [0.8, 0.2], db: -16, max: 2, cd: 0.05, pj: 0.5, pri: 1,
    fn(v, r) {
      click(v, 0, { bp: 2600, tau: 0.004, lvl: 0.6 });
      const t2 = r.range(0.045, 0.06);
      nz(v, t2, 0.06, { f: 900, q: 1.5, env: [0, 0.0008, 1, 'x', 0.012], lvl: 0.7, rev: 0.2 });
      modes(v, t2, { f: r.jit(310, 0.08), ratios: [1, 2.32, 3.87, 5.1], taus: [0.12, 0.08, 0.05, 0.03], amps: [1, 0.6, 0.35, 0.2], lvl: 0.5, rev: 0.2 });
      thump(v, t2, { f0: 140, f1: 70, sweep: 0.04, tau: 0.04, lvl: 0.5, drive: 2 });
      const hum = v.gain(1);
      v.chain(v.osc('sawtooth', [110, 0.25, 220], 0.1, 0.5), hum);
      v.chain(v.osc('square', [55, 0.25, 110], 0.1, 0.5), v.gain(0.5), hum);
      v.out(v.chain(hum, v.bq('lowpass', [300, 0.25, 2400], 6), v.amp(0.1, [0, 0.03, 1, 0.15, 0.7, 'x', 0.06], 0.3)), 0.2);
      fmTone(v, 0.14, 0.12, { f: 440, ratio: 1, index: 0.8, env: [0, 0.002, 1, 'x', 0.03], lvl: 0.2 });
      fmTone(v, 0.21, 0.25, { f: 660, ratio: 1, index: 0.8, env: [0, 0.002, 1, 'x', 0.06], lvl: 0.22, rev: 0.2 });
    },
  },

  pickup_gem: {
    dur: 0.34, n: 5, sr: HI, rv: [0.2, 0.8], db: -24, max: 4, cd: 0.03, pj: 0.2, pri: 0,
    fn(v, r, i) {
      const f = [2093, 2349.3, 2637, 3136, 3520][i % 5];
      v.out(v.chain(v.osc('sine', [f * 0.7, 0.015, f], 0, 0.03), v.amp(0, [0, 0.002, 1, 0.015, 0.6, 0.01, 0], 0.25)));
      modes(v, 0.012, { f, ratios: GLASS, taus: [0.16, 0.08, 0.05, 0.025], amps: [1, 0.35, 0.3, 0.15], pair: 0.0015, lvl: 0.45, rev: 0.25 });
      click(v, 0.012, { hp: 6000, tau: 0.001, lvl: 0.2 });
    },
  },

  pickup_life: {
    dur: 1.05, n: 3, sr: LO, rv: [0.2, 0.8], db: -15, max: 1, cd: 0.2, pj: 0, pri: 2,
    fn(v, r) {
      [1046.5, 1318.5, 1568, 2093, 2637].forEach((f, j) => {
        fmTone(v, j * 0.06, 0.5, { f, ratio: 1, index: [r.range(1.2, 1.6), 0.15, 0.2], env: [0, 0.003, 1, 'x', j === 4 ? 0.2 : 0.1], lvl: 0.25, rev: 0.4 });
        fmTone(v, j * 0.06, 0.2, { f, ratio: 3.01, index: 0.6, env: [0, 0.002, 1, 'x', 0.04], lvl: 0.08 });
      });
      const pad = saws(v, 0.05, 0.9, { f: 523.25, n: 2, spread: 7 });
      v.chain(saws(v, 0.05, 0.9, { f: 784, n: 2, spread: 7 }), pad);
      v.out(v.chain(pad, v.bq('lowpass', [600, 0.4, 3000], 1), v.amp(0.05, [0, 0.15, 1, 0.4, 0.8, 'x', 0.15], 0.1)), 0.6);
      v.out(v.chain(v.osc('sine', 4186, 0.25, 0.8), am(v, 9, 0.8, 0.25, 0.8), v.amp(0.25, [0, 0.05, 1, 'x', 0.2], 0.05)), 0.6);
    },
  },

  pickup_overdrive: {
    dur: 0.75, n: 3, sr: LO, rv: [0.4, 0.6], db: -16, max: 2, cd: 0.1, pj: 0.5, pri: 1,
    fn(v, r) {
      const car = v.osc('sawtooth', [90, 0.25, 1300], 0, 0.3, 0, true), mod = v.osc('square', 57, 0, 0.3), mg = v.gain(180);
      mod.connect(mg); mg.connect(car.frequency);
      v.out(v.chain(car, v.bq('bandpass', [300, 0.25, 3000], 3), v.gain(2), v.ws(3), v.amp(0, [0, 0.02, 1, 0.2, 0.8, 0.05, 0], 0.3)), 0.2);
      debris(v, 0, 0.3, { n: 40, tau: 0.2, rise: true, bp: 4500, lvl: 0.35, rev: 0.2 });
      click(v, 0.24, { hp: 3000, tau: 0.002, lvl: 0.3 });
      fmTone(v, 0.24, 0.45, { f: 1760, ratio: 2.76, index: [1.5, 0.2, 0.1], env: [0, 0.003, 1, 'x', 0.16], lvl: 0.3, rev: 0.5 });
      fmTone(v, 0.25, 0.45, { f: 2637, ratio: 2.76, index: [1.2, 0.2, 0.1], env: [0, 0.003, 1, 'x', 0.14], lvl: 0.18, rev: 0.5 });
    },
  },

  powerup_max: {
    dur: 1.25, n: 3, sr: LO, rv: [0.3, 0.7], db: -14, max: 1, cd: 0.3, pj: 0, pri: 2,
    fn(v, r) {
      const T = 0.48;
      const rs = saws(v, 0, T + 0.02, { f: [200, T, 1600], n: 3, spread: 8 });
      v.out(v.chain(rs, v.bq('lowpass', [700, T, 6000], 1.2), v.amp(0, [0, T * 0.9, 1, T * 0.1, 1, 0.02, 0], 0.22)), 0.3);
      nz(v, 0, T + 0.02, { type: 'highpass', f: [500, T, 6000], env: [0, T, 1, 0.02, 0], lvl: 0.2 });
      click(v, T, { hp: 1500, tau: 0.005, lvl: 0.5, rev: 0.3 });
      thump(v, T, { f0: 120, f1: 50, sweep: 0.08, tau: 0.07, lvl: 0.6, drive: 2 });
      const st = v.gain(1);
      for (const f of [440, 554.4, 659.3, 880]) v.chain(saws(v, T, 0.8, { f, n: 2, spread: 6 }), st);
      v.out(v.chain(st, v.bq('lowpass', [6000, 0.35, 700], 1), v.amp(T, [0, 0.004, 1, 'x', 0.3], 0.12)), 0.4);
      for (const f of [1760, 2637, 3520]) fmTone(v, T + 0.02, 0.7, { f, ratio: 3.5, index: 0.8, env: [0, 0.003, 1, 'x', 0.35], lvl: 0.12, rev: 0.6 });
    },
  },

  // ---- nova / overdrive ---------------------------------------------------------------------
  nova: {
    dur: 3.4, n: 3, sr: XLO, st: 1, rv: [0.15, 0.85], db: -8, max: 2, cd: 0.3, pj: 0.4, pri: 3, sat: 1.8,
    fn(v, r) {
      const T = r.range(0.3, 0.34);
      // inhale: reverse swell + rising tone
      swell(v, 0, T, { f: [250, T, 3800], q: 1.1, lvl: 0.6, rev: 0.5, pan: -0.3 });
      swell(v, 0, T, { f: [260, T, 3600], q: 1.1, lvl: 0.6, rev: 0.5, pan: 0.3 });
      const rt = saws(v, 0, T + 0.01, { f: [70, T, 300], n: 2, spread: 14 });
      v.out(v.chain(rt, v.bq('lowpass', [400, T, 2500], 1), v.amp(0, [0, T, 1, 0.01, 0], 0.25)), 0.3);
      // detonation
      click(v, T, { hp: 700, tau: 0.016, lvl: 0.8, rev: 0.3 });
      thump(v, T, { f0: 95, f1: 24, sweep: 1.1, tau: 0.5, lvl: 1, drive: 2.2 });
      nz(v, T, 2.2, { type: 'lowpass', f: [8000, 1.4, 160], q: 0.8, drive: 3, env: [0, 0.003, 1, 'x', 0.38], lvl: 0.75, rev: 0.45 });
      nz(v, T + 0.02, 3, { color: 'brown', type: 'lowpass', f: [500, 2, 90], env: [0, 0.06, 1, 'x', 0.8], lvl: 0.45, rev: 0.3, pan: -0.5 });
      nz(v, T + 0.02, 3, { color: 'brown', type: 'lowpass', f: [520, 2, 95], env: [0, 0.06, 1, 'x', 0.8], lvl: 0.45, rev: 0.3, pan: 0.5 });
      // shimmering aftermath
      chord(v, T, 3.4 - T, [587.3, 880, 1480, 2349.3], { att: 0.08, tau: 1.0, det: 0.003, trem: 6, depth: 0.35, lvl: 0.3, rev: 0.7 });
      debris(v, T + 0.05, 2.5, { n: 60, tau: 0.9, bp: 6000, lvl: 0.18, rev: 0.6, gmin: 0.0002, gmax: 0.001 });
    },
  },

  overdrive_on: {
    dur: 1.25, n: 3, sr: LO, rv: [0.3, 0.7], db: -12, max: 1, cd: 0.3, pj: 0.3, pri: 2,
    fn(v, r) {
      const T = 0.26;
      const tb = saws(v, 0, T + 0.7, { f: [220, T, 1760], n: 2, spread: 12 });
      v.chain(v.osc('square', [110, T, 880], 0, T + 0.7), v.gain(0.5), tb);
      v.out(v.chain(tb, v.bq('bandpass', [440, T, 3500], 5), v.gain(2), v.ws(2), v.amp(0, [0, T, 1, 0.02, 0.3, 'x', 0.15], 0.3)), 0.2);
      click(v, T, { hp: 1200, tau: 0.008, lvl: 0.7, rev: 0.3 });
      thump(v, T, { f0: 130, f1: 45, sweep: 0.12, tau: 0.09, lvl: 0.6, drive: 2.5 });
      nz(v, T, 0.6, { f: 900, q: 0.9, drive: 4, env: [0, 0.002, 1, 'x', 0.08], lvl: 0.5, rev: 0.3 });
      const gc = v.gain(1);
      for (const f of [329.6, 493.9, 659.3]) v.chain(saws(v, T, 1.0, { f, n: 2, spread: 8 }), gc);
      const lp = v.bq('lowpass', 3000, 1.5);
      v.lfo('sine', 6, 800, lp.frequency, T, 0.95);
      v.out(v.chain(gc, lp, v.amp(T, [0, 0.03, 1, 0.2, 0.7, 'x', 0.25], 0.12)), 0.5);
      for (const f of [1318.5, 1975.5]) fmTone(v, T + 0.01, 0.8, { f, ratio: 3.5, index: 0.8, env: [0, 0.003, 1, 'x', 0.4], lvl: 0.28, rev: 0.6 });
      debris(v, T, 0.7, { n: 50, tau: 0.25, bp: 5000, lvl: 0.5, rev: 0.3 });
    },
  },

  overdrive_off: {
    dur: 0.85, n: 3, sr: LO, rv: [0.6, 0.4], db: -18, max: 1, cd: 0.2, pj: 0.3, pri: 2,
    fn(v) {
      const pd = saws(v, 0, 0.85, { f: [1500, 0.55, 110], n: 2, spread: 12 });
      v.out(v.chain(pd, v.bq('lowpass', [6000, 0.55, 300], 2), v.amp(0, [0, 0.01, 1, 0.3, 0.7, 'x', 0.1], 0.3)), 0.25);
      thump(v, 0, { f0: 110, f1: 50, sweep: 0.06, tau: 0.05, lvl: 0.45, drive: 2 });
      debris(v, 0, 0.5, { n: 25, tau: 0.15, bp: 4000, lvl: 0.25, rev: 0.2 });
      click(v, 0, { hp: 1500, tau: 0.003, lvl: 0.3 });
    },
  },

  // ---- scoring / feedback ---------------------------------------------------------------------
  graze: {
    dur: 0.09, n: 5, sr: HI, db: -30, max: 2, cd: 0.05, pj: 1.5, pri: 0,
    fn(v, r) {
      nz(v, 0, 0.05, { f: [r.jit(6800, 0.1), 0.03, 9500], q: 4, env: [0, 0.003, 1, 'x', 0.012], lvl: 0.7 });
      v.out(v.chain(v.osc('sine', [4200, 0.025, 5200], 0, 0.05), v.amp(0, [0, 0.002, 1, 'x', 0.01], 0.18)));
    },
  },

  chain_up: {
    dur: 0.28, n: 4, sr: HI, rv: [0.5, 0.5], db: -22, max: 2, cd: 0.05, pj: 0, pri: 1,
    fn(v, r) {
      const f = 1046.5;
      fmTone(v, 0, 0.1, { f, ratio: 2, index: [r.range(1.2, 1.6), 0.05, 0.3], type: 'triangle', env: [0, 0.002, 1, 'x', 0.03], lvl: 0.35, rev: 0.15 });
      fmTone(v, 0.045, 0.2, { f: f * 1.5, ratio: 2, index: [r.range(1.4, 1.8), 0.06, 0.3], type: 'triangle', env: [0, 0.002, 1, 'x', 0.06], lvl: 0.4, rev: 0.25 });
      click(v, 0, { hp: 5000, tau: 0.001, lvl: 0.15 });
    },
  },

  // ---- boss -------------------------------------------------------------------------------
  warning: {
    dur: 2.3, n: 3, sr: XLO, st: 1, rv: [0.7, 0.3], db: -12, max: 1, cd: 1, pj: 0, pri: 3,
    fn(v, r) {
      const lo = r.jit(360, 0.03), hi = lo * 2;
      const fEnv = [lo];
      for (let c = 0; c < 2; c++) fEnv.push(0.75, hi, 0.12, hi * 0.995, 0.12, lo);
      for (const [pan, det] of [[-0.45, -9], [0.45, 9]]) {
        const m = v.gain(1);
        v.chain(v.osc('sawtooth', fEnv, 0, 2.05, det), v.gain(0.5), m);
        v.chain(v.osc('sawtooth', fEnv, 0, 2.05, det + 6), v.gain(0.5), m);
        v.chain(v.osc('square', envMap(fEnv, (x) => x / 2), 0, 2.05, det), v.gain(0.35), m);
        v.out(v.chain(m, v.ws(2.5, 0, '2x'), v.bq('peaking', 1150, 1.2, 0, 6), v.bq('lowpass', 3500, 0.9),
          v.amp(0, [0, 0.03, 1, 0.9, 1, 0.07, 0.15, 0.03, 1, 0.9, 1, 0.1, 0], 0.35)), 0.35, pan);
      }
      for (let c = 0; c < 2; c++) thump(v, c * 0.99, { f0: 70, f1: 45, sweep: 0.1, tau: 0.18, lvl: 0.6, drive: 1.8 });
    },
  },

  boss_roar: {
    dur: 2.4, n: 3, sr: XLO, st: 1, rv: [0.25, 0.75], db: -10, max: 1, cd: 0.8, pj: 0.7, pri: 3, sat: 1.6,
    fn(v, r) {
      const f0 = r.jit(55, 0.08), T = 2.25;
      const fe = [f0 * 0.8, 0.28, f0 * 1.3, 0.85, f0 * 1.05, 0.75, f0 * 0.6];
      const src = v.gain(1);
      const s1 = v.osc('sawtooth', fe, 0, T, 0, true), s2 = v.osc('square', fe, 0, T, 17, true);
      const jit = v.chain(v.noise('white', 0, T), v.bq('lowpass', 22, 0.7), v.gain(520));   // vocal-fold jitter
      jit.connect(s1.frequency); jit.connect(s2.frequency);
      v.chain(s1, v.gain(0.55), src);
      v.chain(s2, v.gain(0.3), src);
      v.chain(v.noise('pink', 0, T), v.gain(0.9), src);   // breath
      const fb = v.gain(1);
      const forms = [[[500, 0.28, 760, 0.9, 640, 0.8, 430], 5, 1], [[900, 0.28, 1250, 1.7, 800], 6, 0.6], [[2500, 1.2, 2800, 0.8, 2200], 9, 0.3]];
      for (const [fa, q, a] of forms) v.chain(src, v.bq('bandpass', fa, q, 0), v.gain(a * 3), fb);
      v.chain(src, v.bq('lowpass', 260, 0.9), v.gain(0.8), fb);   // chest
      const env = [0, 0.3, 1, 1.1, 0.8, 'x', 0.28];
      const body = v.chain(fb, v.ws(3, 0.12, '2x'), v.bq('lowpass', 4800), am(v, 29, 0.5, 0, T), v.amp(0, env, 0.8));
      v.out(body, 0.35);
      const rm = v.gain(0);   // machine layer: ring-modulated copy
      v.lfo('sine', r.jit(173, 0.05), 1, rm.gain, 0, T);
      v.out(v.chain(body, rm, v.bq('highpass', 300), v.gain(0.45)), 0.3, [-0.4, T, 0.4]);
      v.out(v.chain(v.osc('sine', envMap(fe, (x) => x / 2), 0, T), v.amp(0, env, 0.45)));
    },
  },

  boss_phase: {
    dur: 1.9, n: 3, sr: XLO, st: 1, rv: [0.3, 0.7], db: -12, max: 1, cd: 0.5, pj: 0.5, pri: 3, sat: 1.4,
    fn(v, r) {
      click(v, 0, { hp: 1000, tau: 0.01, lvl: 0.6, rev: 0.3 });
      thump(v, 0, { f0: 90, f1: 28, sweep: 0.4, tau: 0.25, lvl: 0.65, drive: 2.4 });
      nz(v, 0, 0.8, { f: 600, q: 0.9, drive: 3, env: [0, 0.002, 1, 'x', 0.12], lvl: 0.45, rev: 0.35 });
      // stressed metal groan through resonant hull modes
      const g0 = r.jit(95, 0.08), gr = saws(v, 0.05, 1.85, { f: [g0, 1.2, g0 * 0.74], n: 2, spread: 20 }), gm = v.gain(1);
      for (const [f, q, a] of [[340, 14, 1], [720, 14, 0.7], [1450, 12, 0.4]]) v.chain(gr, v.bq('bandpass', r.jit(f, 0.06), q), v.gain(a * 4), gm);
      v.out(v.chain(gm, v.ws(2), v.amp(0.05, [0, 0.15, 1, 0.8, 0.6, 'x', 0.25], 0.4)), 0.4);
      debris(v, 0.05, 1.0, { n: 60, tau: 0.35, bp: 3500, lvl: 0.6, rev: 0.3 });
      zap(v, 0.1, 0.5, { fmin: 150, fmax: 2200, bp: 2200, env: [0, 0.01, 1, 'x', 0.15], lvl: 0.2, rev: 0.3, pan: 0.3 });
      const ts = saws(v, 0.1, 1.4, { f: [110, 1.3, 220], n: 2, spread: 10 });
      v.out(v.chain(ts, v.bq('lowpass', [500, 1.3, 2600], 1), v.amp(0.1, [0, 1.2, 1, 0.1, 0], 0.18)), 0.4);
    },
  },

  warp_in: {
    dur: 0.8, n: 4, sr: LO, rv: [0.3, 0.7], db: -22, max: 2, cd: 0.08, pj: 1.5, pri: 1,
    fn(v, r) {
      const T = r.range(0.2, 0.26);
      swell(v, 0, T, { color: 'white', f: [1200, T, 5500], q: 1.4, lvl: 0.5, rev: 0.3 });
      fmTone(v, 0, T + 0.02, { f: [180, T, 1900], ratio: 1.5, index: 2, env: [0, T, 1, 0.015, 0], lvl: 0.25 });
      click(v, T, { hp: 1800, tau: 0.003, lvl: 0.5 });
      thump(v, T, { f0: 240, f1: 90, sweep: 0.03, tau: 0.03, lvl: 0.45, drive: 2 });
      modes(v, T, { f: r.jit(1700, 0.1), ratios: GLASS, taus: [0.14, 0.07, 0.05, 0.03], amps: [1, 0.4, 0.3, 0.2], lvl: 0.3, rev: 0.5 });
    },
  },

  // ---- co-op --------------------------------------------------------------------------------
  revive: {
    dur: 1.35, n: 3, sr: LO, rv: [0.2, 0.8], db: -15, max: 1, cd: 0.5, pj: 0, pri: 2,
    fn(v, r) {
      [440, 554.4, 659.3, 880, 1108.7, 1318.5].forEach((f, j) => fmTone(v, j * 0.065, 0.5, { f, ratio: 2, index: [r.range(1.3, 1.8), 0.08, 0.3], env: [0, 0.003, 1, 'x', j === 5 ? 0.25 : 0.12], lvl: 0.22, rev: 0.45 }));
      const pad = saws(v, 0, 1.35, { f: 220, n: 2, spread: 8 });
      v.chain(saws(v, 0, 1.35, { f: 330, n: 2, spread: 8 }), pad);
      v.out(v.chain(pad, v.bq('lowpass', [400, 0.5, 2600], 1), v.amp(0, [0, 0.3, 1, 0.5, 0.8, 'x', 0.2], 0.1)), 0.5);
      nz(v, 0, 0.6, { f: [500, 0.5, 3200], q: 1.2, env: [0, 0.45, 1, 'x', 0.1], lvl: 0.2, rev: 0.4 });
      for (const f of [1760, 2637]) fmTone(v, 0.42, 0.8, { f, ratio: 3.5, index: 0.8, env: [0, 0.003, 1, 'x', 0.4], lvl: 0.14, rev: 0.6 });
    },
  },

  beacon_ping: {
    dur: 0.8, n: 3, sr: LO, rv: [0.1, 0.9], db: -21, max: 2, cd: 0.3, pj: 0, pri: 1,
    fn(v, r, i) {
      const f = 1318.5 * semiToRate([0, -0.3, 0.3][i % 3]);
      fmTone(v, 0, 0.75, { f: [f, 0.5, f * 0.985], ratio: 1, index: [0.9, 0.5, 0.1], env: [0, 0.003, 1, 'x', 0.16], lvl: 0.4, rev: 0.6 });
      fmTone(v, 0, 0.4, { f: f * 2.005, ratio: 1, index: 0.3, env: [0, 0.002, 1, 'x', 0.07], lvl: 0.12, rev: 0.5 });
      click(v, 0, { bp: 3000, tau: 0.002, lvl: 0.12 });
    },
  },

  player_join: {
    dur: 0.9, n: 3, sr: LO, rv: [0.3, 0.7], db: -17, max: 2, cd: 0.2, pj: 0, pri: 2,
    fn(v, r) {
      blips(v, 0, { n: 6, gap: 0.018, len: 0.011, lvl: 0.07 });
      fmTone(v, 0.1, 0.2, { f: 784, ratio: 2, index: [r.range(1.1, 1.5), 0.1, 0.2], env: [0, 0.003, 1, 0.08, 0.6, 'x', 0.03], lvl: 0.3, rev: 0.3 });
      fmTone(v, 0.22, 0.65, { f: 1174.7, ratio: 2, index: [r.range(1.1, 1.5), 0.1, 0.2], env: [0, 0.003, 1, 'x', 0.15], lvl: 0.32, rev: 0.4 });
      v.out(v.chain(v.osc('sine', 2349.3, 0.22, 0.6), am(v, 10, 0.8, 0.22, 0.6), v.amp(0.22, [0, 0.05, 1, 'x', 0.15], 0.05)), 0.5);
    },
  },

  player_leave: {
    dur: 0.9, n: 3, sr: LO, rv: [0.3, 0.7], db: -18, max: 2, cd: 0.2, pj: 0, pri: 2,
    fn(v, r) {
      fmTone(v, 0, 0.2, { f: 1174.7, ratio: 1, index: [r.range(0.8, 1.1), 0.1, 0.2], env: [0, 0.003, 1, 0.08, 0.6, 'x', 0.03], lvl: 0.3, rev: 0.3 });
      fmTone(v, 0.12, 0.5, { f: 784, ratio: 1, index: [r.range(0.8, 1.1), 0.1, 0.2], env: [0, 0.003, 1, 'x', 0.13], lvl: 0.3, rev: 0.4 });
      v.out(v.chain(v.osc('square', [220, 0.06, 110], 0.34, 0.08), v.bq('lowpass', 1500, 1), v.amp(0.34, [0, 0.003, 1, 0.05, 0.6, 0.02, 0], 0.18)), 0.3);
    },
  },

  // ---- UI -----------------------------------------------------------------------------------
  ui_move: {
    dur: 0.06, n: 4, sr: HI, db: -26, max: 2, cd: 0.03, pj: 0.5, pri: 1,
    fn(v, r) {
      nz(v, 0, 0.02, { f: r.jit(3500, 0.08), q: 1.5, env: [0, 0.0003, 1, 'x', 0.0016], lvl: 0.6 });
      v.out(v.chain(v.osc('sine', r.jit(2400, 0.03), 0, 0.04), v.amp(0, [0, 0.001, 1, 'x', 0.006], 0.3)));
    },
  },

  ui_select: {
    dur: 0.24, n: 3, sr: HI, rv: [1, 0], db: -20, max: 2, cd: 0.05, pj: 0, pri: 2,
    fn(v, r) {
      click(v, 0, { hp: 3000, tau: 0.001, lvl: 0.25 });
      fmTone(v, 0, 0.08, { f: 1320, ratio: 2, index: [r.range(0.8, 1.2), 0.03, 0.2], env: [0, 0.002, 1, 'x', 0.025], lvl: 0.35, rev: 0.1 });
      fmTone(v, 0.045, 0.16, { f: 1980, ratio: 2, index: [r.range(0.8, 1.2), 0.03, 0.2], env: [0, 0.002, 1, 'x', 0.04], lvl: 0.35, rev: 0.15 });
    },
  },

  ui_back: {
    dur: 0.24, n: 3, sr: HI, rv: [1, 0], db: -22, max: 2, cd: 0.05, pj: 0, pri: 2,
    fn(v, r) {
      fmTone(v, 0, 0.08, { f: 1480, ratio: 1, index: r.range(0.4, 0.7), type: 'triangle', env: [0, 0.002, 1, 'x', 0.025], lvl: 0.3, rev: 0.1 });
      fmTone(v, 0.05, 0.14, { f: 990, ratio: 1, index: r.range(0.4, 0.7), type: 'triangle', env: [0, 0.002, 1, 'x', 0.035], lvl: 0.3, rev: 0.15 });
    },
  },

  ui_start: {
    dur: 1.15, n: 3, sr: LO, rv: [0.3, 0.7], db: -14, max: 1, cd: 0.3, pj: 0, pri: 3,
    fn(v, r) {
      const T = 0.26;
      swell(v, 0, T, { f: [400, T, 4200], q: 1.1, lvl: 0.55, rev: 0.3 });
      const rz = saws(v, 0, T + 0.01, { f: [147, T, 587], n: 2, spread: 10 });
      v.out(v.chain(rz, v.bq('lowpass', [500, T, 4000], 1), v.amp(0, [0, T, 1, 0.01, 0], 0.15)), 0.2);
      click(v, T, { hp: 1500, tau: 0.005, lvl: 0.5, rev: 0.3 });
      thump(v, T, { f0: 120, f1: 45, sweep: 0.1, tau: 0.08, lvl: 0.7, drive: 2.2 });
      const ch = v.gain(1);
      for (const f of [293.7, 440, 587.3, 740]) v.chain(saws(v, T, 0.9, { f, n: 2, spread: 6 }), ch);
      v.out(v.chain(ch, v.bq('lowpass', [6500, 0.3, 800], 1), v.amp(T, [0, 0.004, 1, 'x', 0.28], 0.12)), 0.45);
      for (const f of [1174.7, 1760]) fmTone(v, T + 0.02, 0.8, { f, ratio: 3.5, index: r.range(0.8, 1.1), env: [0, 0.003, 1, 'x', 0.4], lvl: 0.16, rev: 0.6 });
    },
  },

  ui_error: {
    dur: 0.34, n: 3, sr: HI, rv: [1, 0], db: -20, max: 1, cd: 0.1, pj: 0, pri: 2,
    fn(v, r) {
      for (const t of [0, 0.12]) {
        const m = v.gain(1);
        v.chain(v.osc('square', r.jit(150, 0.02), t, 0.1), m);
        v.chain(v.osc('square', 157, t, 0.1), m);
        v.out(v.chain(m, v.bq('lowpass', 1800, 2), v.amp(t, [0, 0.004, 1, 0.075, 0.9, 0.01, 0], 0.25)), 0.1);
      }
    },
  },

  countdown: {
    dur: 0.5, n: 3, sr: LO, rv: [0.6, 0.4], db: -17, max: 1, cd: 0.2, pj: 0, pri: 2,
    fn(v) {
      const m = v.gain(1);
      v.chain(v.osc('sine', 880, 0, 0.35), m);
      v.chain(v.osc('triangle', 880, 0, 0.35), v.gain(0.4), m);
      v.chain(v.osc('sine', 1760, 0, 0.35), v.gain(0.15), m);
      v.out(v.chain(m, v.amp(0, [0, 0.004, 1, 0.11, 0.85, 'x', 0.05], 0.35)), 0.25);
      click(v, 0, { bp: 4000, tau: 0.001, lvl: 0.15 });
    },
  },

  stage_clear_whoosh: {
    dur: 2.0, n: 3, sr: XLO, st: 1, rv: [0.2, 0.8], db: -14, max: 1, cd: 0.5, pj: 0.5, pri: 3,
    fn(v, r) {
      const P = r.range(0.8, 0.95), pan = [-0.85, P, 0, 0.6, 0.85];
      nz(v, 0, 1.8, { color: 'pink', f: [250, P, 3600, 0.8, 700], q: 1.2, env: [0, P, 1, 'x', 0.22], lvl: 0.7, rev: 0.3, pan });
      nz(v, 0, 1.6, { type: 'highpass', f: [2000, P, 7000], env: [0, P, 1, 'x', 0.15], lvl: 0.12, rev: 0.3, pan });
      const rs = saws(v, 0, 2.1, { f: [110, P, 880], n: 3, spread: 10 });
      v.out(v.chain(rs, v.bq('lowpass', [500, P, 5000], 1), v.amp(0, [0, P, 1, 'x', 0.15], 0.15)), 0.3, pan);
      v.out(v.chain(v.osc('sine', [1300, 0.15, 780], P - 0.05, 0.3), v.amp(P - 0.05, [0, 0.03, 1, 'x', 0.08], 0.08)), 0.3, [0, 0.3, 0.8], P - 0.05);
      v.out(v.chain(v.osc('sine', 55, 0, 2.1), v.amp(0, [0, P, 1, 'x', 0.2], 0.35)));
      for (const f of [1760, 2637]) fmTone(v, P, 0.9, { f, ratio: 3.5, index: 0.8, env: [0, 0.003, 1, 'x', 0.5], lvl: 0.12, rev: 0.6 });
    },
  },
};

// ---------------------------------------------------------------------------------------------
// Rendering pipeline

function newOAC(ch, len, sr) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  return new OAC(ch, len, sr);   // positional form (Safari)
}

function renderOAC(ac) {
  return new Promise((resolve, reject) => {
    ac.oncomplete = (e) => resolve(e.renderedBuffer);
    let p;
    try { p = ac.startRendering(); } catch (e) { reject(e); return; }
    if (p && p.then) p.then(resolve, reject);
  });
}

// Build one context holding the given variants of a sound. solo: debug — only the k-th layer.
function buildGraph(name, def, list, solo = null) {
  let sr = def.sr || LO, rv = !!def.rv;
  const st = !!def.st, slot = def.dur + GAP;
  const mk = () => {
    const nOut = (st ? 2 : 1) + (rv ? 1 : 0);
    return { ac: newOAC(nOut, Math.ceil(slot * list.length * sr), sr), nOut };
  };
  let made;
  try { made = mk(); } catch {
    try { sr = HI; made = mk(); } catch { rv = false; made = mk(); }
  }
  const { ac, nOut } = made, dest = ac.destination;
  let dryL, dryR, send = null;
  if (nOut === 1) { dryL = dryR = ac.createGain(); dryL.connect(dest); }
  else {
    try { dest.channelInterpretation = 'discrete'; } catch { /* ignore */ }
    const m = ac.createChannelMerger(nOut);
    m.connect(dest);
    dryL = ac.createGain(); dryL.connect(m, 0, 0);
    if (st) { dryR = ac.createGain(); dryR.connect(m, 0, 1); } else dryR = dryL;
    if (rv) { send = ac.createGain(); send.connect(m, 0, nOut - 1); }
  }
  const j = { ac, sr, st, dur: def.dur, dryL, dryR, send, solo, outIdx: 0, layers: 0, sends: new Map(), pans: new Map() };
  list.forEach((vi, k) => {
    const r = makeRng(hashStr(name) ^ Math.imul(vi + 1, 0x9e3779b1));
    j.outIdx = 0;
    def.fn(new V(j, k * slot, r, vi), r, vi);
    j.layers = Math.max(j.layers, j.outIdx);
  });
  return { j, slot, sr, st, rv };
}

// Split a rendered job into per-variant channel arrays: { dry: [L(,R)], send }.
function sliceVariants(buf, g, count) {
  const n = Math.round(g.j.dur * g.sr), step = Math.round(g.slot * g.sr), out = [];
  const ch = (c) => buf.getChannelData(Math.min(c, buf.numberOfChannels - 1));
  for (let k = 0; k < count; k++) {
    const o = k * step, cut = (d) => d.slice(o, o + n);
    const dry = g.st ? [cut(ch(0)), cut(ch(1))] : [cut(ch(0))];
    out.push({ dry, send: g.rv ? cut(ch(g.st ? 2 : 1)) : null });
  }
  return out;
}

function addReverb(def, sr, vars) {
  if (!def.rv) return;
  const tc = perfNow();
  convolveAll(vars, def, sr);
  prof.conv += perfNow() - tc;
}

// DC block, saturation, loop crossfade, fades, zero-mean. Returns channel arrays (not normalized).
function finishVariant(def, sr, v) {
  const outs = v.dry;
  for (const d of outs) dcBlock(d, sr, 12);
  if (def.sat) {   // glue: tanh-like soft saturation lowers the crest factor of big sounds
    const pk = peakOf(outs), k = def.sat;
    const sat = (x) => (x >= 3 ? 1 : x <= -3 ? -1 : (x * (27 + x * x)) / (27 + 9 * x * x));   // Padé tanh
    const norm = pk / sat(k), kk = k / pk;
    if (pk > 0) for (const d of outs) for (let i = 0; i < d.length; i++) d[i] = sat(kk * d[i]) * norm;
  }
  const n = outs[0].length;
  if (def.loop != null) {
    // crossfade the end of the loop into the audio just before loopStart → seamless wrap
    const a = Math.round(def.loop * sr), L = n - a, X = Math.min(Math.round(0.1 * sr), a - 1);
    for (const d of outs) for (let k = 0; k < X; k++) { const i = n - X + k, w = (k + 1) / X; d[i] = d[i] * (1 - w) + d[i - L] * w; }
  }
  if (def.loop != null) {   // loops: remove the loop body's mean as a constant (keeps the seam intact)
    const a = Math.round(def.loop * sr);
    for (const d of outs) { let m = 0; for (let i = a; i < n; i++) m += d[i]; m /= n - a; for (let i = 0; i < n; i++) d[i] -= m; }
  }
  const smooth = (x) => x * x * (3 - 2 * x);   // 0→1 S-curve (click-free fades)
  const fi = Math.round(0.0015 * sr);
  for (const d of outs) for (let i = 0; i < fi; i++) d[i] *= smooth(i / fi);
  if (def.loop == null) {
    const fo = Math.max(Math.round(0.005 * sr), Math.round(Math.min(0.25, def.dur * 0.15) * sr));
    for (const d of outs) for (let i = 0; i < fo; i++) d[n - 1 - i] *= smooth(i / fo);
    // remove any residual mean with a smooth parabolic correction (zero at both ends: no step)
    for (const d of outs) {
      let m = 0;
      for (let i = 0; i < n; i++) m += d[i];
      m /= n;
      if (Math.abs(m) > 1e-6) { const k = 6 * m / n; for (let i = 0; i < n; i++) { const x = (i + 0.5) / n; d[i] -= k * n * x * (1 - x); } }
    }
  }
  return outs;
}

// Reverb → DC block / loop / fades → peak-normalize → loudness. Pure JS on typed arrays so it
// can run in a worker. def: { rv, rs, dur, loop, sat }.
function postProcess(def, sr, vars) {
  const t0 = perfNow();
  addReverb(def, sr, vars);
  const t1 = perfNow(), out = [], loud = [];
  let tf = 0;
  for (const v of vars) {
    const a = perfNow(), chs = finishVariant(def, sr, v);
    tf += perfNow() - a;
    const pk = peakOf(chs), k = pk > 0 ? PEAK / pk : 1;
    for (const d of chs) for (let i = 0; i < d.length; i++) d[i] *= k;
    out.push(chs);
    loud.push(loudness(chs, sr));
  }
  return { vars: out, loud, ms: [t1 - t0, tf, perfNow() - t1 - tf] };   // reverb / finish / normalize+loudness
}

// JIT warm-up: run the hot DSP paths on a small synthetic job so real jobs (largest first) don't
// execute in unoptimized code. Workers call this while the main thread builds the first graphs.
function warmUp() {
  const mk = (len, k) => { const d = new Float32Array(len); for (let i = 0; i < len; i++) d[i] = Math.sin(i * k) * Math.exp(-i / 3000); return d; };
  for (let r = 0; r < 4; r++) {
    postProcess({ rv: [0.5, 0.5], rs: 0, dur: 0.4, loop: null, sat: 1.5 }, 32000, [0, 1, 2].map((k) => ({ dry: [mk(12800, 0.05 + k * 0.01)], send: mk(12800, 0.03) })));
    postProcess({ rv: [0.3, 0.7], rs: 0, dur: 0.4, loop: 0.2, sat: 0 }, 32000, [0, 1, 2].map((k) => ({ dry: [mk(12800, 0.02), mk(12800, 0.04 + k * 0.01)], send: mk(12800, 0.07) })));
  }
}

function peakOf(chs) {
  let pk = 0;
  for (const d of chs) for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > pk) pk = a; }
  return pk;
}

// Phone-speaker-weighted short-term loudness: 2nd-order high-pass at 150 Hz, max 50 ms RMS.
function loudness(chs, sr) {
  // every other sample is plenty for an energy estimate; 12.5 ms blocks, 50 ms windows
  const n = chs[0].length, a = Math.exp(-TAU * 150 / (sr / 2)), bl = Math.max(1, Math.round(0.0125 * sr / 2));
  const nb = Math.ceil(n / 2 / bl), blocks = new Float64Array(nb);
  for (const d of chs) {
    let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
    for (let i = 0, j = 0; i < n; i += 2, j++) {
      const x = d[i], y = a * (y1 + x - x1); x1 = x; y1 = y;
      const z = a * (y2 + y - x2); x2 = y; y2 = z;
      blocks[(j / bl) | 0] += z * z;
    }
  }
  let mx = 0;
  for (let b = 0; b < nb; b++) { let e = 0, c = 0; for (let k = b; k < b + 4 && k < nb; k++) { e += blocks[k]; c++; } mx = Math.max(mx, e / (c * bl * chs.length)); }
  return 10 * Math.log10(mx + 1e-12);
}

function toAudioBuffer(chs, sr) {
  const n = chs[0].length;
  let b = null;
  try { b = new AudioBuffer({ numberOfChannels: chs.length, length: n, sampleRate: sr }); } catch { /* old Safari */ }
  if (!b) b = AudioSys.ctx.createBuffer(chs.length, n, sr);
  chs.forEach((d, c) => b.getChannelData(c).set(d));
  return b;
}

// Post-processing workers, built from this module's own functions (Blob URL: no extra file).
// Falls back to the main thread if workers are unavailable.
const POST_FNS = [mulberry, bpResonate, getIR, soundIR, fftTables, fft, convolveAll, emit, addReverb, dcBlock, finishVariant, postProcess, peakOf, loudness, warmUp];
let workers = null, allWorkers = [], workerSeq = 0;
const workerJobs = new Map();

function startWorkers(count) {
  try {
    const src = [
      `const TAU = Math.PI * 2, PEAK = ${PEAK}, HB = ${JSON.stringify(HB)};`,
      'const irCache = new Map(), fftTabs = new Map(), sirCache = new Map(), prof = { conv: 0, fft: 0 }, perfNow = () => performance.now();',
      ...POST_FNS.map((f) => f.toString()),
      'onmessage = (e) => { const { id, def, sr, vars } = e.data; let res;',
      '  try { res = postProcess(def, sr, vars); } catch (err) { postMessage({ id, error: String(err) }); return; }',
      '  const tr = []; for (const chs of res.vars) for (const d of chs) tr.push(d.buffer);',
      '  postMessage({ id, vars: res.vars, loud: res.loud, ms: res.ms }, tr); };',
      'try { warmUp(); } catch (e) { /* warm-up is optional */ }',
    ].join('\n');
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    workers = [];
    for (let i = 0; i < count; i++) {
      const w = new Worker(url);
      w.busy = 0;
      w.onmessage = (e) => {
        const job = workerJobs.get(e.data.id);
        if (!job) return;
        workerJobs.delete(e.data.id);
        w.busy--;
        if (e.data.error) job.reject(new Error(e.data.error)); else job.resolve(e.data);
      };
      w.onerror = () => { workers = null; for (const j of workerJobs.values()) j.reject(new Error('worker')); workerJobs.clear(); };
      workers.push(w); allWorkers.push(w);
    }
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch { workers = null; }
}

function postAsync(def, sr, vars) {
  const plain = { rv: def.rv || null, rs: def.rs || 0, dur: def.dur, loop: def.loop ?? null, sat: def.sat || 0 };
  if (workers && workers.length) {
    stats.offloaded++;
    const w = workers.reduce((a, b) => (b.busy < a.busy ? b : a));
    const id = ++workerSeq;
    const tr = [];
    for (const v of vars) { for (const d of v.dry) tr.push(d.buffer); if (v.send) tr.push(v.send.buffer); }
    return new Promise((resolve, reject) => {
      workerJobs.set(id, { resolve, reject });
      w.busy++;
      w.postMessage({ id, def: plain, sr, vars }, tr);
    });
  }
  stats.inline++;
  return Promise.resolve(postProcess(plain, sr, vars));
}

const bank = new Map();   // name -> { def, bufs, gains, loud, loopStart, loopEnd, last, lastT, voices }
const stats = { buildMs: 0, jobs: [], offloaded: 0, inline: 0, workers: 0 };
let buildPromise = null;
let warned = false;

async function buildOne(name) {
  const def = S[name], list = Array.from({ length: def.n }, (_, i) => i);
  const t0 = perfNow();
  const g = buildGraph(name, def, list);
  const t1 = perfNow();
  const rendered = await renderOAC(g.j.ac);
  const t2 = perfNow();
  let res;
  try { res = await postAsync(def, g.sr, sliceVariants(rendered, g, def.n)); }
  catch { workers = null; stats.inline++; res = postProcess(def, g.sr, sliceVariants(rendered, g, def.n)); }   // worker failed: redo inline
  const loud = res.loud, bufs = res.vars.map((chs) => toAudioBuffer(chs, g.sr));
  const mean = loud.reduce((a, b) => a + b, 0) / loud.length;
  const gains = loud.map((l) => clamp(dbToGain(def.db - (0.5 * l + 0.5 * mean)), 0.02, 1.6));
  bank.set(name, {
    name, def, bufs, gains, loud,
    loopStart: def.loop != null ? Math.round(def.loop * g.sr) / g.sr : 0,
    loopEnd: def.loop != null ? Math.round(def.dur * g.sr) / g.sr : 0,
    last: -1, lastT: -1e9, voices: [],
  });
  stats.jobs.push({ name, graphMs: t1 - t0, renderMs: t2 - t1, postMs: perfNow() - t2, layers: g.j.layers, sr: g.sr, work: res.ms });
}

export async function buildSfx(onProgress) {
  if (!buildPromise) buildPromise = runBuild(onProgress);
  return buildPromise;
}

async function runBuild(onProgress) {
  const t0 = perfNow();
  const report = (p) => { try { if (onProgress) onProgress(p); } catch { /* ignore */ } };
  if (!(window.OfflineAudioContext || window.webkitOfflineAudioContext) || !(AudioSys.ctx || window.AudioBuffer)) { report(1); return; }
  const cost = (n) => { const d = S[n]; return d.dur * d.n * (d.sr || LO) / LO * (d.st ? 1.3 : 1) * (d.rv ? 1.2 : 1); };
  const names = Object.keys(S).sort((a, b) => cost(b) - cost(a));
  const total = names.reduce((s, n) => s + cost(n), 0);
  let next = 0, done = 0;
  const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && !_sfxDebug.noWorkers) startWorkers(hc >= 6 ? 3 : 2);
  const worker = async () => {
    while (next < names.length) {
      const name = names[next++];
      try { await buildOne(name); } catch (e) {
        if (!warned) { warned = true; console.warn('sfx: failed to render', name, e); }
      }
      done += cost(name);
      report(Math.min(1, done / total));
    }
  };
  await Promise.all(Array.from({ length: clamp(hc, 3, 6) }, worker));
  stats.buildMs = perfNow() - t0;
  stats.workers = workers ? workers.length : 0;
  if (!_sfxDebug.keepWorkers) { for (const w of allWorkers) w.terminate(); allWorkers = []; workers = null; }
  report(1);
}

// ---------------------------------------------------------------------------------------------
// Runtime playback

const active = [];   // live voices, oldest first
const EMPTY = {};
const panFor = (x) => (x == null || !isFinite(x) ? 0 : clamp((x / FIELD_W) * 1.6 - 0.8, -0.8, 0.8));

function unlink(vc) {
  if (vc.gone) return;
  vc.gone = true;
  let i = active.indexOf(vc);
  if (i >= 0) active.splice(i, 1);
  i = vc.s.voices.indexOf(vc);
  if (i >= 0) vc.s.voices.splice(i, 1);
}

function release(vc, t, fade) {
  if (vc.stopping) return;
  vc.stopping = true;
  const p = vc.g.gain;
  try {
    if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t); else p.cancelScheduledValues(t);
    p.setTargetAtTime(0, t, fade / 4);
    vc.src.stop(t + fade + 0.02);
  } catch { /* already stopped */ }
  unlink(vc);
}

function start(name, opt, asLoop) {
  const ctx = AudioSys.ctx;
  if (!ctx || !AudioSys.unlocked || !AudioSys.sfxBus) return null;
  const s = bank.get(name);
  if (!s) return null;
  const d = s.def, now = ctx.currentTime;
  const t = Math.max(now, +opt.when || 0);
  if (!asLoop) {
    if (Math.abs(t - s.lastT) < d.cd) return null;                 // retrigger cooldown
    while (s.voices.length >= d.max) {                              // per-name cap: steal oldest
      const old = s.voices.find((x) => !x.loop);
      if (!old) return null;
      release(old, now, 0.015);
    }
  }
  if (active.length >= MAX_VOICES) {                                // global cap
    const victim = active.find((x) => !x.loop && x.pri <= d.pri);
    if (!victim) return null;
    release(victim, now, 0.015);
  }
  const nb = s.bufs.length;
  let vi = opt.variant;
  if (!(vi >= 0 && vi < nb)) vi = nb < 2 ? 0 : s.last < 0 ? Math.floor(Math.random() * nb) : (s.last + 1 + Math.floor(Math.random() * (nb - 1))) % nb;
  s.last = vi;
  const buf = s.bufs[vi];
  const dens = d.pri < 2 ? 1 / Math.sqrt(1 + 0.3 * s.voices.length) : 1;   // swarm compensation
  const vol = opt.vol == null ? 1 : clamp(+opt.vol || 0, 0, 1.5);
  const base = s.gains[vi] * vol * dens;
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = buf;
  src.playbackRate.value = semiToRate((+opt.pitch || 0) + (d.pj ? (Math.random() * 2 - 1) * d.pj : 0));
  g.gain.value = base;
  src.connect(g);
  let p = null;
  if ((opt.x != null || asLoop) && typeof ctx.createStereoPanner === 'function') {
    p = ctx.createStereoPanner();
    p.pan.value = panFor(opt.x);
    g.connect(p); p.connect(AudioSys.sfxBus);
  } else g.connect(AudioSys.sfxBus);
  const loopDef = d.loop != null;
  if (asLoop || loopDef) {
    src.loop = true;
    src.loopStart = loopDef ? s.loopStart : 0;
    src.loopEnd = loopDef ? s.loopEnd : buf.duration;
  }
  if (!asLoop && loopDef) {             // loopable sound used as a one-shot: sustain, then fade
    const te = t + d.os;
    g.gain.setValueAtTime(base, te);
    g.gain.linearRampToValueAtTime(0, te + 0.18);
    src.stop(te + 0.2);
  }
  src.start(t);
  const vc = { s, src, g, p, t, pri: d.pri, loop: asLoop, base, gone: false, stopping: false };
  src.onended = () => {
    unlink(vc);
    try { src.disconnect(); g.disconnect(); if (p) p.disconnect(); } catch { /* ignore */ }
  };
  active.push(vc);
  s.voices.push(vc);
  if (!asLoop) s.lastT = t;
  return vc;
}

// One-shot. opt { x: field x (0..240) → stereo pan, vol: 0..1.5, pitch: semitones, when: ctx time }
export function sfx(name, opt) {
  try {
    const vc = start(name, opt || EMPTY, false);
    return vc ? { stop: (fade = 0.05) => { try { release(vc, AudioSys.ctx.currentTime, fade); } catch { /* ignore */ } } } : null;
  } catch {
    return null;
  }
}

const NOOP_LOOP = Object.freeze({ playing: false, stop() {}, setVol() {}, setPitch() {}, setX() {} });

// Looping sound -> { stop(fadeSec), setVol(v), setPitch(semi), setX(x) }
export function sfxLoop(name, opt) {
  let vc = null;
  try { vc = start(name, opt || EMPTY, true); } catch { vc = null; }
  if (!vc) return NOOP_LOOP;
  const at = () => AudioSys.ctx.currentTime;
  return {
    get playing() { return !vc.stopping; },
    stop(fade = 0.12) { if (!vc.stopping) try { release(vc, at(), Math.max(0.005, +fade || 0)); } catch { /* ignore */ } },
    setVol(v) { if (!vc.stopping) try { vc.g.gain.setTargetAtTime(vc.base * clamp(+v || 0, 0, 1.5), at(), 0.03); } catch { /* ignore */ } },
    setPitch(semi) { if (!vc.stopping) try { vc.src.playbackRate.setTargetAtTime(semiToRate(+semi || 0), at(), 0.03); } catch { /* ignore */ } },
    setX(x) { if (!vc.stopping && vc.p) try { vc.p.pan.setTargetAtTime(panFor(x), at(), 0.03); } catch { /* ignore */ } },
  };
}

// Dev / analysis hooks (used by dev/sfx.html; not part of the game contract).
export const _sfxDebug = {
  defs: S,
  bank,
  stats,
  voices: () => active.length,
  prof,
  ir: (kind, sr) => getIR(kind, sr),
  // Sequential re-render of every sound with per-stage timings (profiling only).
  async profile() {
    const rows = [];
    for (const name of Object.keys(S)) {
      const def = S[name], list = Array.from({ length: def.n }, (_, i) => i);
      const c0 = prof.conv, f0 = prof.fft, n0 = prof.nodes, s0 = prof.srcSec, t0 = perfNow();
      const g = buildGraph(name, def, list);
      const t1 = perfNow();
      const buf = await renderOAC(g.j.ac);
      const t2 = perfNow();
      const sl = sliceVariants(buf, g, def.n);
      addReverb(def, g.sr, sl);
      sl.map((v) => finishVariant(def, g.sr, v));
      rows.push({ name, graph: t1 - t0, render: t2 - t1, post: perfNow() - t2, conv: prof.conv - c0, audio: def.dur * def.n, fft: prof.fft - f0, nodes: prof.nodes - n0, srcSec: prof.srcSec - s0 });
    }
    return rows;
  },
  // Render one variant with only layer `solo` audible (dry path, before reverb) → Float32Array[]
  async renderLayer(name, variant, solo) {
    const def = S[name], g = buildGraph(name, def, [variant], solo);
    const buf = await renderOAC(g.j.ac);
    return { chans: sliceVariants(buf, g, 1)[0].dry, sr: g.sr, layers: g.j.layers };
  },
};
