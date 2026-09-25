// Nova Lancers — procedural parallax backgrounds (DESIGN.md §6).
//
// Every stage is a stack of pre-rendered offscreen canvases (procedural seeded noise,
// palette-quantized with ordered dithering so it reads as hand-pixelled art) plus a few
// cheap animated details drawn per frame. Size-independent layers are tiles (periodic in
// x and y) generated once per stage and cached; size-dependent set pieces (planets, suns,
// the black hole) are rendered in resize().
//
// Conventions
//   * "Ground" content moves DOWN the screen as scrollY grows. A layer with parallax
//     factor f is offset by round(scrollY * f) px. The 'wreck' hull uses f = 1 exactly.
//   * Tiles are TW px wide and are horizontally centred on the field centre, so phones
//     (W <= TW) never see a horizontal repeat.
//   * ctx is the opaque main layer; lctx is the additive light layer (the renderer leaves
//     it in 'lighter' mode — we always restore whatever mode we found).

import { RAMPS, hexToRgb } from './palette.js';

const TW = 320;               // tile width for horizontally repeating layers
const FIELD_W = 240, FIELD_H = 400;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Small math / RNG
// ---------------------------------------------------------------------------

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  constructor(seed) { this.f = mulberry32(seed >>> 0); }
  next() { return this.f(); }
  range(a, b) { return a + (b - a) * this.f(); }
  int(a, b) { return a + Math.floor((b - a + 1) * this.f()); }
  chance(p) { return this.f() < p; }
  pick(arr) { return arr[Math.floor(this.f() * arr.length)]; }
  sign() { return this.f() < 0.5 ? -1 : 1; }
}

// Optional dev profiling: set globalThis.__BG_PROF = [] to collect [label, ms] entries.
let _pt = 0;
function prof(label) {
  const P = globalThis.__BG_PROF; if (!P) return;
  const now = performance.now(); if (label) P.push([label, +(now - _pt).toFixed(1)]); _pt = now;
}

// ---------------------------------------------------------------------------
// Time-sliced job runner. All generation is written as generators that yield every few
// milliseconds of work; jobs run in short slices between frames so building the next
// sector (or re-laying out after a resize) never freezes the game or starves the music
// scheduler. A job can also be finished synchronously (drain) when its result is needed now.
// ---------------------------------------------------------------------------

function runGen(it) { let r; do { r = it.next(); } while (!r.done); return r.value; }

const JOBS = [];
let pumping = false;
const nowMs = () => performance.now();
// Dev hook: globalThis.__BG_SLICES = [] collects the duration of every slice.
function pump() {
  const t0 = nowMs();
  while (JOBS.length) {
    const j = JOBS[0];
    if (j.state !== 'run') { JOBS.shift(); continue; }
    let r;
    try { r = j.it.next(); } catch (e) { JOBS.shift(); j.state = 'error'; j.reject(e); continue; }
    if (r.done) { JOBS.shift(); j.state = 'done'; j.value = r.value; j.resolve(r.value); }
    if (nowMs() - t0 >= j.budget) break;
  }
  if (globalThis.__BG_SLICES) globalThis.__BG_SLICES.push(+(nowMs() - t0).toFixed(2));
  if (JOBS.length) setTimeout(pump, 0); else pumping = false;
}
// pri: higher runs first; budget: ms per slice
function startJob(it, pri = 0, budget = 4) {
  const j = { it, pri, budget, state: 'run', value: undefined, resolve: null, reject: null };
  j.promise = new Promise((res, rej) => { j.resolve = res; j.reject = rej; });
  j.promise.catch(() => {});
  let i = JOBS.length; while (i > 0 && JOBS[i - 1].pri < pri) i--;
  JOBS.splice(i, 0, j);
  if (!pumping) { pumping = true; setTimeout(pump, 0); }
  return j;
}
function cancelJob(j) { if (j && j.state === 'run') { j.state = 'cancelled'; j.resolve(undefined); } }
// finish a running job right now (its remaining steps run synchronously)
function drainJob(j) {
  if (!j) return undefined;
  if (j.state === 'run') { j.state = 'done'; j.value = runGen(j.it); j.resolve(j.value); }
  return j.value;
}
// yield inside a row loop every `n` rows
const every = (y, n) => (y % n) === n - 1;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const fract = (v) => v - Math.floor(v);
const mod = (a, n) => ((a % n) + n) % n;
// cheap wrap for small offsets (|v| < 2n)
const wr = (v, n) => (v < 0 ? v + n : v >= n ? v - n : v);

// ---------------------------------------------------------------------------
// Colour, dithering and palette quantisation
// ---------------------------------------------------------------------------

// Packed pixel for a Uint32Array view over RGBA bytes (little-endian: 0xAABBGGRR).
const pack = (r, g, b, a = 255) => (((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
const packHex = (hex, a = 255) => { const c = hexToRgb(hex); return pack(c[0], c[1], c[2], a); };
const unR = (p) => p & 255, unG = (p) => (p >>> 8) & 255, unB = (p) => (p >>> 16) & 255, unA = (p) => p >>> 24;

// 4x4 Bayer thresholds in (0,1)
const BAYER4 = new Float32Array([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16));
const bay = (x, y) => BAYER4[((y & 3) << 2) | (x & 3)];

// Ramp as packed pixels, optionally with alpha
const packRamp = (hexes, a = 255) => Uint32Array.from(hexes.map((h) => packHex(h, a)));

// Ordered-dither a continuous ramp position v (0..n-1) to an index.
function qi(v, x, y, n) {
  if (v <= 0) return 0;
  if (v >= n - 1) return n - 1;
  const i = v | 0;
  return v - i > bay(x, y) ? i + 1 : i;
}
// Like qi, but flat bands with dithering only in a narrow window (width w, in ramp steps)
// around each band edge: large surfaces read as clean colour areas instead of a
// checkerboard "screen door", and scrolling surfaces don't shimmer.
function qe(v, x, y, n, w = 0.3) {
  if (v <= 0) return 0;
  if (v >= n - 1) return n - 1;
  const i = v | 0, p = (v - i - 0.5) / w + 0.5;
  return p > bay(x, y) ? i + 1 : i;
}

// RGB -> palette quantiser with a lazily filled 18-bit lookup table and ordered dithering.
class Quant {
  constructor(hexes) {
    const list = [...new Set(hexes)];
    this.n = list.length;
    this.rgb = list.map(hexToRgb);
    this.packed = Uint32Array.from(this.rgb.map((c) => pack(c[0], c[1], c[2])));
    this.lut = new Uint8Array(1 << 18).fill(255);
  }
  _nearest(r, g, b) {
    let best = 0, bd = 1e18;
    for (let i = 0; i < this.n; i++) {
      const c = this.rgb[i];
      const rm = (c[0] + r) * 0.5, dr = c[0] - r, dg = c[1] - g, db = c[2] - b;
      const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  idx(r, g, b) {
    const ri = r <= 0 ? 0 : r >= 255 ? 63 : r >> 2;
    const gi = g <= 0 ? 0 : g >= 255 ? 63 : g >> 2;
    const bi = b <= 0 ? 0 : b >= 255 ? 63 : b >> 2;
    const k = (ri << 12) | (gi << 6) | bi;
    let v = this.lut[k];
    if (v === 255) v = this.lut[k] = this._nearest(ri * 4 + 2, gi * 4 + 2, bi * 4 + 2);
    return v;
  }
  // dithered quantise -> packed colour (opaque)
  dq(r, g, b, x, y, spread) {
    const d = (bay(x, y) - 0.5) * spread;
    return this.packed[this.idx(r + d, g + d, b + d)];
  }
}

// ---------------------------------------------------------------------------
// Noise: periodic gradient (Perlin) fbm for tiles, hashed value noise for spheres
// ---------------------------------------------------------------------------

class Perlin {
  // px, py: period in lattice cells (powers of two, so wrapping is a bit mask)
  constructor(rng, px, py) {
    this.px = px; this.mx = px - 1; this.my = py - 1;
    const n = px * py;
    this.g = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { const a = rng.next() * TAU; this.g[i * 2] = Math.cos(a); this.g[i * 2 + 1] = Math.sin(a); }
  }
  at(x, y) {
    const xf = Math.floor(x), yf = Math.floor(y);
    const fx = x - xf, fy = y - yf, g = this.g, mx = this.mx, my = this.my, px = this.px;
    const x0 = xf & mx, x1 = (xf + 1) & mx, r0 = (yf & my) * px, r1 = ((yf + 1) & my) * px;
    let i = (r0 + x0) << 1;
    const d00 = g[i] * fx + g[i + 1] * fy;
    i = (r0 + x1) << 1;
    const d10 = g[i] * (fx - 1) + g[i + 1] * fy;
    i = (r1 + x0) << 1;
    const d01 = g[i] * fx + g[i + 1] * (fy - 1);
    i = (r1 + x1) << 1;
    const d11 = g[i] * (fx - 1) + g[i + 1] * (fy - 1);
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = d00 + (d10 - d00) * u, b = d01 + (d11 - d01) * u;
    return a + (b - a) * v;
  }
}

const pow2 = (v) => 1 << Math.max(0, Math.round(Math.log2(Math.max(1, v))));

// Periodic fbm over a w x h pixel domain. at() returns roughly 0..1 (0.5 mean).
class Fbm {
  constructor(rng, w, h, cell, oct = 5, gain = 0.5, lac = 2) {
    this.w = w; this.h = h; this.n = oct;
    this.p = []; this.sx = new Float64Array(oct); this.sy = new Float64Array(oct); this.amp = new Float64Array(oct);
    let amp = 1, cs = cell, norm = 0;
    for (let o = 0; o < oct; o++) {
      const px = pow2(w / cs), py = pow2(h / cs);
      this.p.push(new Perlin(rng, px, py));
      this.sx[o] = px / w; this.sy[o] = py / h; this.amp[o] = amp;
      norm += amp; amp *= gain; cs /= lac;
    }
    this.k = 0.5 * 1.45 / norm; this.norm = norm;
  }
  at(x, y) {
    let s = 0;
    for (let i = 0; i < this.n; i++) s += this.amp[i] * this.p[i].at(x * this.sx[i], y * this.sy[i]);
    return 0.5 + s * this.k;
  }
  // ridged variant: 1 at creases
  ridge(x, y) {
    let s = 0;
    for (let i = 0; i < this.n; i++) s += this.amp[i] * (1 - Math.abs(this.p[i].at(x * this.sx[i], y * this.sy[i])) * 1.6);
    return s / this.norm;
  }
  // Fill a Float32Array (w*h) sampling every `step` px then bilinear upsampling (fast path).
  field(step = 2, ridged = false) {
    const { w, h } = this;
    const cw = Math.ceil(w / step), ch = Math.ceil(h / step);
    const coarse = new Float32Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++)
      coarse[y * cw + x] = ridged ? this.ridge(x * step, y * step) : this.at(x * step, y * step);
    if (step === 1) return coarse;
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const fy = y / step, y0 = Math.floor(fy), ty = fy - y0, y1 = (y0 + 1) % ch;
      for (let x = 0; x < w; x++) {
        const fx = x / step, x0 = Math.floor(fx), tx = fx - x0, x1 = (x0 + 1) % cw;
        const a = coarse[y0 * cw + x0], b = coarse[y0 * cw + x1], c = coarse[y1 * cw + x0], d = coarse[y1 * cw + x1];
        out[y * w + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
      }
    }
    return out;
  }
}

// Evaluate fn(x, y, out) (k channels) every `step` px over a region; bilinear sampler.
function coarseGrid(x0, y0, w, h, step, k, fn) {
  const cw = Math.ceil(w / step) + 2, ch = Math.ceil(h / step) + 2;
  const data = new Float32Array(cw * ch * k), tmp = new Float32Array(k);
  for (let gy = 0; gy < ch; gy++) for (let gx = 0; gx < cw; gx++) {
    fn(x0 + gx * step, y0 + gy * step, tmp);
    data.set(tmp, (gy * cw + gx) * k);
  }
  return {
    get(x, y, out) {
      const fx = clamp((x - x0) / step, 0, cw - 1.001), fy = clamp((y - y0) / step, 0, ch - 1.001);
      const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy;
      const a = (iy * cw + ix) * k, b = a + k, c = a + cw * k, d = c + k;
      for (let j = 0; j < k; j++) {
        const top = data[a + j] + (data[b + j] - data[a + j]) * tx, bot = data[c + j] + (data[d + j] - data[c + j]) * tx;
        out[j] = top + (bot - top) * ty;
      }
    },
  };
}

// Hashed 3D value noise (non-periodic) for spheres.
function hash3(x, y, z, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177) + Math.imul(s, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const PERM = new Uint8Array(512), PVAL = new Float32Array(256);
{
  const r = mulberry32(0x9e3779b9);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  for (let i = 0; i < 256; i++) PVAL[i] = r();
}
function vnoise3(x, y, z, s) {
  const xf = Math.floor(x), yf = Math.floor(y), zf = Math.floor(z);
  const fx = x - xf, fy = y - yf, fz = z - zf;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const X = (xf + s * 37) & 255, Y = (yf + s * 17) & 255, Z = (zf + s * 5) & 255;
  const A = PERM[X] + Y, AA = PERM[A & 511] + Z, AB = PERM[(A + 1) & 511] + Z;
  const B = PERM[X + 1] + Y, BA = PERM[B & 511] + Z, BB = PERM[(B + 1) & 511] + Z;
  const a = PVAL[PERM[AA & 511]], b = PVAL[PERM[BA & 511]], c = PVAL[PERM[AB & 511]], d = PVAL[PERM[BB & 511]];
  const e = PVAL[PERM[(AA + 1) & 511]], f = PVAL[PERM[(BA + 1) & 511]], g = PVAL[PERM[(AB + 1) & 511]], h = PVAL[PERM[(BB + 1) & 511]];
  const k0 = a + (b - a) * u, k1 = c + (d - c) * u, k2 = e + (f - e) * u, k3 = g + (h - g) * u;
  const m0 = k0 + (k1 - k0) * v, m1 = k2 + (k3 - k2) * v;
  return m0 + (m1 - m0) * w;
}
function fbm3(x, y, z, oct, s) {
  let sum = 0, amp = 1, n = 0;
  for (let o = 0; o < oct; o++) { sum += amp * vnoise3(x, y, z, s + o * 31); n += amp; amp *= 0.5; x *= 2.03; y *= 2.03; z *= 2.03; }
  return sum / n;
}

// ---------------------------------------------------------------------------
// Raster: a Uint32 pixel buffer with pixel-art primitives (optionally wrapping)
// ---------------------------------------------------------------------------

class Raster {
  constructor(w, h, wrap = false) {
    this.w = w; this.h = h; this.wrap = wrap;
    this.d = new Uint32Array(w * h);
  }
  i(x, y) {
    x |= 0; y |= 0;
    if (this.wrap) {
      if (x < 0 || x >= this.w) x = mod(x, this.w);
      if (y < 0 || y >= this.h) y = mod(y, this.h);
    } else if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    return y * this.w + x;
  }
  set(x, y, c) { const i = this.i(x, y); if (i >= 0) this.d[i] = c; }
  get(x, y) { const i = this.i(x, y); return i >= 0 ? this.d[i] : 0; }
  // alpha-blend colour c (packed, its alpha ignored) with opacity a over the pixel
  blend(x, y, c, a) {
    const i = this.i(x, y); if (i < 0 || a <= 0) return;
    if (a >= 1) { this.d[i] = (c & 0xffffff) | 0xff000000; return; }
    const p = this.d[i], pa = unA(p) / 255;
    const oa = a + pa * (1 - a);
    if (oa <= 0) return;
    const r = (unR(c) * a + unR(p) * pa * (1 - a)) / oa;
    const g = (unG(c) * a + unG(p) * pa * (1 - a)) / oa;
    const b = (unB(c) * a + unB(p) * pa * (1 - a)) / oa;
    this.d[i] = pack(r, g, b, oa * 255);
  }
  // additive light (keeps alpha at max of both)
  add(x, y, r, g, b, a = 255) {
    const i = this.i(x, y); if (i < 0) return;
    const p = this.d[i];
    this.d[i] = pack(Math.min(255, unR(p) + r), Math.min(255, unG(p) + g), Math.min(255, unB(p) + b), Math.max(unA(p), a));
  }
  rect(x, y, w, h, c) {
    x = Math.round(x); y = Math.round(y);
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
  }
  hline(x0, x1, y, c) { for (let x = Math.round(x0); x <= Math.round(x1); x++) this.set(x, y, c); }
  vline(x, y0, y1, c) { for (let y = Math.round(y0); y <= Math.round(y1); y++) this.set(x, y, c); }
  line(x0, y0, x1, y1, c) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 4096; n++) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  disc(cx, cy, r, c) {
    const r2 = r * r;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) this.set(x, y, c);
      }
  }
  // scanline polygon fill; pts = [x0,y0,x1,y1,...]
  poly(pts, c, fn) {
    let minY = Infinity, maxY = -Infinity;
    for (let i = 1; i < pts.length; i += 2) { minY = Math.min(minY, pts[i]); maxY = Math.max(maxY, pts[i]); }
    const n = pts.length / 2, xs = [];
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const sy = y + 0.5; xs.length = 0;
      for (let i = 0; i < n; i++) {
        const ax = pts[i * 2], ay = pts[i * 2 + 1], bx = pts[((i + 1) % n) * 2], by = pts[((i + 1) % n) * 2 + 1];
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) fn ? fn(x, y) : this.set(x, y, c);
    }
  }
  toCanvas() {
    const cv = makeCanvas(this.w, this.h);
    const cx = cv.getContext('2d');
    cx.putImageData(new ImageData(new Uint8ClampedArray(this.d.buffer), this.w, this.h), 0, 0);
    return cv;
  }
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
  return c;
}
function ctx2d(c) { const x = c.getContext('2d'); x.imageSmoothingEnabled = false; return x; }
// Draw a canvas once onto a tiny scratch canvas so the browser uploads its texture now
// (during loading) instead of on the first gameplay frame that uses it.
let warmCtx = null;
function warm(v) {
  if (!v) return;
  if (Array.isArray(v)) { v.forEach(warm); return; }
  if (typeof v !== 'object') return;
  if (v.bands) { v.bands.forEach((b) => warm(b.c)); return; }
  if (v.getContext) {
    if (!v.width || !v.height) return;
    if (!warmCtx) { const c = makeCanvas(2, 2); warmCtx = c.getContext('2d'); }
    warmCtx.drawImage(v, 0, 0, 1, 1);
  } else if (v.constructor === Object) for (const k in v) warm(v[k]);
}
function freeCanvas(c) {
  if (c && c.bands) { c.free(); return; }
  if (c && c.getContext) { c.width = 0; c.height = 0; }
}

// Draw `img` repeated to cover [0,W)x[0,H), with tile origin at (ax, oy).
// shift: extra vertical offset per tile column (fraction of the tile height) so wide
// screens don't show an obvious side-by-side repeat (only for layers whose objects never
// cross the tile's left/right edges). The centre column (k = 0) is never shifted.
function drawTiled(ctx, img, ax, oy, W, H, shift = 0) {
  if (img.bands) { img.draw(ctx, ax, oy, W, H, shift); return; }
  const tw = img.width, th = img.height;
  let x0 = mod(ax, tw); if (x0 > 0) x0 -= tw;
  for (let x = x0; x < W; x += tw) {
    const k = Math.round((x - ax) / tw);
    let y0 = mod(oy + (shift ? Math.round(k * shift * th) : 0), th); if (y0 > 0) y0 -= th;
    for (let y = y0; y < H; y += th) ctx.drawImage(img, x, y);
  }
}
// Vertical-only tiling of a strip at x.
function drawStrip(ctx, img, x, oy, H) {
  if (img.bands) { img.draw(ctx, x, oy, x + img.width, H, 0, true); return; }
  const th = img.height;
  let y0 = mod(oy, th); if (y0 > 0) y0 -= th;
  for (let y = y0; y < H; y += th) ctx.drawImage(img, x, y);
}
// A mostly transparent tile stored as cropped horizontal bands (saves memory for sparse
// layers such as emissive maps, rock fields and structures). Drawn like a canvas tile.
class BandTile {
  constructor(w, h) { this.width = w; this.height = h; this.bands = []; }
  // generator: crops raster r into bands (yields per band)
  static *from(r, bandH = 48) {
    const t = new BandTile(r.w, r.h);
    const { w, h, d } = r;
    for (let y0 = 0; y0 < h; y0 += bandH) {
      const y1 = Math.min(h, y0 + bandH);
      let minX = w, maxX = -1, minY = y1, maxY = -1;
      for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) if (d[y * w + x]) {
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      if (maxX < 0) continue;
      const bw = maxX - minX + 1, bh = maxY - minY + 1, sub = new Raster(bw, bh);
      for (let y = 0; y < bh; y++) sub.d.set(d.subarray((minY + y) * w + minX, (minY + y) * w + minX + bw), y * bw);
      t.bands.push({ x: minX, y: minY, w: bw, h: bh, c: sub.toCanvas() });
      yield;
    }
    return t;
  }
  draw(ctx, ax, oy, W, H, shift, strip = false) {
    const tw = this.width, th = this.height, B = this.bands;
    let x0 = strip ? ax : mod(ax, tw); if (x0 > 0 && !strip) x0 -= tw;
    for (let x = x0; x < (strip ? ax + 1 : W); x += tw) {
      const k = Math.round((x - ax) / tw);
      let y0 = mod(oy + (shift ? Math.round(k * shift * th) : 0), th); if (y0 > 0) y0 -= th;
      for (let y = y0; y < H; y += th) for (let i = 0; i < B.length; i++) {
        const b = B[i], by = y + b.y, bx = x + b.x;
        if (by >= H || by + b.h <= 0 || bx >= W || bx + b.w <= 0) continue;
        ctx.drawImage(b.c, bx, by);
      }
    }
  }
  // draw once (no tiling) with the tile's origin at (x, y)
  blit(ctx, x, y) { const B = this.bands; for (let i = 0; i < B.length; i++) ctx.drawImage(B[i].c, x + B[i].x, y + B[i].y); }
  free() { for (const b of this.bands) freeCanvas(b.c); this.bands = []; }
}
// draw a canvas or BandTile once at (x, y)
const blit = (ctx, img, x, y) => { if (img.bands) img.blit(ctx, x, y); else ctx.drawImage(img, x, y); };
const banded = (r) => runGen(BandTile.from(r));
const bandedG = (r) => BandTile.from(r);
// Erase the light layer behind an opaque layer that is about to be drawn in front of it
// (so far emissive layers don't shine through near structures). lctx is opaque, so
// 'destination-out' leaves black; with an alpha-enabled light canvas it leaves
// transparent pixels, which the post pass reads as black too (premultiplied upload).
function occlude(lctx, fn) {
  const op = lctx.globalCompositeOperation, a = lctx.globalAlpha;
  lctx.globalCompositeOperation = 'destination-out'; lctx.globalAlpha = 1;
  fn(lctx);
  lctx.globalCompositeOperation = op; lctx.globalAlpha = a;
}

const colShift = (sx, x, ax, w, shift, h) => (shift ? Math.round(Math.round((sx - x - ax) / w) * shift * h) : 0);

// ---------------------------------------------------------------------------
// Stars
// ---------------------------------------------------------------------------

const STAR_COLS = ['#9db4ff', '#b5c6ff', '#d4dcff', '#f4f4ff', '#fff4ea', '#ffe6c4', '#ffd29c', '#ffb98e'];
const STAR_LV = [0.16, 0.24, 0.34, 0.46, 0.6, 0.78, 1];
const qLevel = (b) => { for (let i = 0; i < STAR_LV.length; i++) if (b <= STAR_LV[i]) return STAR_LV[i]; return 1; };

// Tileable star layer, meant to be composited with 'lighter'.
// density(x, y) -> 0..1 acceptance; cols: hex list; maxB: brightness cap; big: chance of cross stars
function starTile(rng, w, h, count, { density = null, cols = STAR_COLS, maxB = 1, pow = 2.6, big = 0.04, raster = false } = {}) {
  const r = new Raster(w, h, true);
  const rgbs = cols.map(hexToRgb);
  for (let i = 0; i < count; i++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    if (density && rng.next() > density(x, y)) continue;
    const c = rng.pick(rgbs);
    const b = qLevel(maxB * Math.pow(rng.next(), pow));
    const put = (dx, dy, k) => r.add(x + dx, y + dy, (c[0] * k) | 0, (c[1] * k) | 0, (c[2] * k) | 0);
    put(0, 0, b);
    if (b >= 0.6 && rng.chance(big * 8)) {
      const k = qLevel(b * 0.34);
      put(1, 0, k); put(-1, 0, k); put(0, 1, k); put(0, -1, k);
      if (b >= 0.78 && rng.chance(0.5)) { const k2 = qLevel(b * 0.16); put(2, 0, k2); put(-2, 0, k2); put(0, 2, k2); put(0, -2, k2); }
    }
  }
  return raster ? r : r.toCanvas();
}

// Per-frame twinkling stars living in a virtual (w x h) tile with parallax factor f.
class Twinkles {
  constructor(rng, n, w, h, f, { cols = STAR_COLS, density = null, bigChance = 0.25, speed = [0.6, 2.2], glow = true } = {}) {
    this.w = w; this.h = h; this.f = f; this.glow = glow;
    const list = [];
    for (let i = 0; i < n * 4 && list.length < n; i++) {
      const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
      if (density && rng.next() > density(x, y)) continue;
      list.push({ x, y, ph: rng.range(0, TAU), sp: rng.range(speed[0], speed[1]), c: rng.int(0, cols.length - 1), k: rng.chance(bigChance) ? (rng.chance(0.3) ? 2 : 1) : 0 });
    }
    list.sort((a, b) => a.c - b.c);
    this.n = list.length;
    this.x = Int16Array.from(list.map((s) => s.x));
    this.y = Int16Array.from(list.map((s) => s.y));
    this.ph = Float32Array.from(list.map((s) => s.ph));
    this.sp = Float32Array.from(list.map((s) => s.sp));
    this.ci = Uint8Array.from(list.map((s) => s.c));
    this.kind = Uint8Array.from(list.map((s) => s.k));
    this.css = cols.map((c) => c);
  }
  // ax: tile origin x on screen; oy: vertical offset (already multiplied by factor); dx: extra drift
  draw(ctx, lctx, ax, oy, W, H, t, alpha = 1, clipY = null, shift = 0) {
    const { w, h } = this;
    let cur = -1;
    for (let i = 0; i < this.n; i++) {
      if (!shift && mod(this.y[i] + oy, h) >= H) continue;
      let a = 0.5 + 0.5 * Math.sin(t * this.sp[i] + this.ph[i]);
      a = a * a * alpha;
      if (a < 0.04) continue;
      if (this.ci[i] !== cur) { cur = this.ci[i]; ctx.fillStyle = this.css[cur]; lctx.fillStyle = this.css[cur]; }
      const k = this.kind[i];
      for (let sx = mod(this.x[i] + ax, w); sx < W; sx += w) {
        const sy = mod(this.y[i] + oy + colShift(sx, this.x[i], ax, w, shift, h), h);
        if (sy >= H || (clipY && sy >= clipY[sx] - 2)) continue;
        ctx.globalAlpha = a;
        ctx.fillRect(sx, sy, 1, 1);
        if (k) {
          ctx.globalAlpha = a * 0.45;
          ctx.fillRect(sx - 1, sy, 1, 1); ctx.fillRect(sx + 1, sy, 1, 1);
          ctx.fillRect(sx, sy - 1, 1, 1); ctx.fillRect(sx, sy + 1, 1, 1);
          if (k === 2) {
            ctx.globalAlpha = a * 0.2;
            ctx.fillRect(sx - 2, sy, 1, 1); ctx.fillRect(sx + 2, sy, 1, 1);
            ctx.fillRect(sx, sy - 2, 1, 1); ctx.fillRect(sx, sy + 2, 1, 1);
          }
          if (this.glow) { lctx.globalAlpha = a * 0.5; lctx.fillRect(sx, sy, 1, 1); }
        }
      }
    }
    ctx.globalAlpha = 1; lctx.globalAlpha = 1;
  }
}

// Ordered-dither dissolve between two baked frames (canvas or BandTile) of the same size.
// Instead of an alpha crossfade (off-palette ghost blends), a Bayer mask picks each pixel
// from one frame or the other. prep() builds the masked frames once; put() draws them on
// any number of layers.
let DPATS = null;
function dissolvePattern(cx, level) {
  if (!DPATS) {
    DPATS = [];
    for (let l = 0; l <= 16; l++) {
      const c = makeCanvas(4, 4), x = c.getContext('2d'), id = x.createImageData(4, 4);
      for (let i = 0; i < 16; i++) id.data[i * 4 + 3] = BAYER4[i] < l / 16 ? 255 : 0;
      x.putImageData(id, 0, 0);
      DPATS.push(c);
    }
  }
  return cx.createPattern(DPATS[level], 'repeat');
}
class Dissolve {
  constructor(w, h) { this.w = w; this.h = h; this.ca = null; this.cb = null; this.L = 0; this.A = null; this.B = null; this.pats = {}; }
  pat(cx, l) { return this.pats[l] || (this.pats[l] = dissolvePattern(cx, l)); }
  prep(A, B, k, additive = false) {
    const L = Math.round(clamp01(k) * 16);
    this.L = L; this.A = A; this.B = B; this.add = additive;
    if (L === 0 || L === 16) return;
    if (!this.cb) { this.cb = makeCanvas(this.w, this.h); this.bx = ctx2d(this.cb); this.ca = makeCanvas(this.w, this.h); this.ax = ctx2d(this.ca); }
    const { bx, ax, w, h } = this;
    bx.clearRect(0, 0, w, h); blit(bx, B, 0, 0);
    bx.globalCompositeOperation = 'destination-in'; bx.fillStyle = this.pat(bx, L); bx.fillRect(0, 0, w, h);
    bx.globalCompositeOperation = 'source-over';
    if (additive) {        // additive frames: A must be masked out where B is chosen
      ax.clearRect(0, 0, w, h); blit(ax, A, 0, 0);
      ax.globalCompositeOperation = 'destination-out'; ax.fillStyle = this.pat(ax, L); ax.fillRect(0, 0, w, h);
      ax.globalCompositeOperation = 'source-over';
    }
  }
  put(ctx, x, y) {
    const L = this.L;
    if (L === 0) { blit(ctx, this.A, x, y); return; }
    if (L === 16) { blit(ctx, this.B, x, y); return; }
    if (this.add) ctx.drawImage(this.ca, x, y); else blit(ctx, this.A, x, y);
    ctx.drawImage(this.cb, x, y);
  }
  free() { freeCanvas(this.ca); freeCanvas(this.cb); this.ca = this.cb = null; }
}

// 1-px pixel ellipse outline (no anti-aliasing): one horizontal run per row and quadrant.
function pixelRing(ctx, cx, cy, rx, ry) {
  cx = Math.round(cx); cy = Math.round(cy);
  const R = Math.round(ry);
  for (let y = 0; y <= R; y++) {
    const xa = Math.round(rx * Math.sqrt(Math.max(0, 1 - ((y + 0.5) / ry) ** 2)));
    const xb = Math.max(xa, Math.round(rx * Math.sqrt(Math.max(0, 1 - ((y - 0.5) / ry) ** 2))));
    const w = xb - xa + 1;
    ctx.fillRect(cx + xa, cy + y, w, 1); ctx.fillRect(cx - xb, cy + y, w, 1);
    if (y) { ctx.fillRect(cx + xa, cy - y, w, 1); ctx.fillRect(cx - xb, cy - y, w, 1); }
  }
}

// Additive light sprite from an intensity function: f(dx, dy) -> 0..1, coloured through ramp.
function glowSprite(w, h, ramp, f, levels = 0) {
  const r = new Raster(w, h, false);
  const cols = ramp.map(hexToRgb), n = cols.length;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = f(x + 0.5 - w / 2, y + 0.5 - h / 2);
    if (v <= 0.002) continue;
    v = clamp01(v) * (n - 1);
    if (levels) v = Math.round(v * levels) / levels;
    const i = qi(v, x, y, n);
    const c = cols[i];
    if (i > 0 || c[0] + c[1] + c[2] > 0) r.d[y * w + x] = pack(c[0], c[1], c[2]);
  }
  return r.toCanvas();
}

// ---------------------------------------------------------------------------
// Stage base
// ---------------------------------------------------------------------------

// Approximate bytes held by canvases reachable from v (canvases, BandTiles, arrays, plain objects).
function bytesOf(v, seen = new Set()) {
  if (!v || typeof v !== 'object' || seen.has(v)) return 0;
  seen.add(v);
  if (Array.isArray(v)) { let n = 0; for (const x of v) n += bytesOf(x, seen); return n; }
  if (v.bands) { let n = 0; for (const b of v.bands) n += b.w * b.h * 4; return n; }
  if (v.getContext) return (v.width * v.height * 4) || 0;
  if (v.constructor !== Object) return 0;
  let n = 0; for (const k in v) n += bytesOf(v[k], seen); return n;
}
function freeAll(v) {
  if (!v || typeof v !== 'object') return;
  if (Array.isArray(v)) { v.forEach(freeAll); return; }
  if (v.bands || v.getContext) { freeCanvas(v); return; }
  if (v.constructor === Object) for (const k in v) freeAll(v[k]);
}

let lastVP = null;           // last viewport any background was sized to (used to prebuild layouts)

// A layout can be kept when only the height wobbles (mobile URL bar) or fy shifts slightly.
const layoutFits = (S, W, H, fx, fy) => S && S.W === W && S.fx === fx && H <= S.LH && H >= S.LH - 120 && Math.abs(fy - S.fy) <= 24;

class Stage {
  constructor(key, assets) {
    this.key = key; this.A = assets;
    // Size of the current layout. H and fy follow the viewport while the layout still fits.
    this.W = 0; this.H = 0; this.fx = 0; this.fy = 0; this.LH = 0;
    this.S = null;               // current layout: size-dependent canvases + derived geometry
    this.want = null;            // viewport waiting for an async relayout ({ W, H, fx, fy })
    this.rjob = null; this._rt = 0;
    this.time = 0; this.flashT = 0;
    this.scrollSpeed = 30;
    this.grade = { tint: [1, 1, 1], lift: [0, 0, 0], sat: 1, contrast: 1 };
  }
  resize(W, H, fx = Math.floor((W - FIELD_W) / 2), fy = Math.floor((H - FIELD_H) / 2)) {
    W |= 0; H |= 0; fx |= 0; fy |= 0;
    if (!this.A || W <= 0 || H <= 0) return;
    lastVP = { W, H, fx, fy };
    if (W > TW) wideTiles(this.key);
    if (layoutFits(this.S, W, H, fx, fy)) {      // cheap path: keep the layout, follow the field
      this.cancelRelayout(); this.want = null;
      this.H = H; this.fy = fy;
      return;
    }
    if (!this.S && !this.asyncFirst) { this.applyLayout(runGen(this.buildLayout(W, H, fx, fy))); return; }
    // Keep drawing the previous layout (translated to follow the field) and rebuild in time
    // slices once the viewport has been stable for a moment (rotations, window drags).
    this.want = { W, H, fx, fy };
    this.cancelRelayout();
    this._rt = setTimeout(() => this.relayout(), this.S ? 200 : 0);
  }
  relayout() {
    const w = this.want; this._rt = 0;
    if (!w || !this.A) return;
    // bigger slices while the old layout leaves part of the screen uncovered
    const cover = this.S ? Math.min(1, this.W / w.W) * Math.min(1, this.LH / w.H) : 0;
    const j = this.rjob = startJob(this.buildLayout(w.W, w.H, w.fx, w.fy), 3, cover > 0.95 ? 5 : 10);
    j.promise.then((S) => {
      if (this.rjob !== j || j.state !== 'done' || !this.A) { if (S) freeAll(S); return; }
      this.rjob = null; this.want = null;
      this.applyLayout(S);
    });
  }
  cancelRelayout() {
    if (this._rt) { clearTimeout(this._rt); this._rt = 0; }
    if (this.rjob) { cancelJob(this.rjob); this.rjob = null; }
  }
  *buildLayout(W, H, fx, fy) {
    const S = { W, H0: H, LH: H + 48, fx, fy, ax: Math.round(fx + FIELD_W / 2 - TW / 2) };
    yield* this.layout(S);
    yield;
    warm(S);
    return S;
  }
  applyLayout(S) {
    freeAll(this.S);
    this.S = S;
    this.W = S.W; this.H = S.H0; this.LH = S.LH; this.fx = S.fx; this.fy = S.fy;
    if (!this._warmed) { warm(this.A); this._warmed = true; }
  }
  // reset transient state when a pooled instance is reused
  revive() { this.time = 0; this.flashT = 0; }
  get cx() { return this.fx + FIELD_W / 2; }
  // tile origin that centres a tile of width w on the field
  axw(w) { return Math.round(this.fx + FIELD_W / 2 - w / 2); }
  get ax() { return this.axw(TW); }
  // a noise layer: the shared wide variant on wide screens once built, else the phone tile
  L(name) {
    if (this.W > TW) { const wd = CACHE.get(this.key)?.wide; if (wd && wd[name]) return wd[name]; }
    return this.A[name];
  }
  // draw a (possibly wide) tile layer centred on the field
  tile(ctx, img, oy, shift = 0, dx = 0) { drawTiled(ctx, img, this.axw(img.width) + dx, oy, this.W, this.H, shift); }
  *layout() {}
  update(dt) {
    if (!this.A) return;
    this.time += dt;
    if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt);
    if (this.S) this.step(dt);
  }
  step() {}
  draw(ctx, lctx, scrollY, t) {
    if (!this.A) return;
    const S = this.S;
    if (!S) { if (this.want) this.placeholder(ctx, lctx, t || 0); return; }
    let dx = 0, dy = 0;
    if (this.want) { dx = this.want.fx - this.fx; dy = this.want.fy - this.fy; }
    if (dx || dy) { ctx.save(); lctx.save(); ctx.translate(dx, dy); lctx.translate(dx, dy); }
    this.render(ctx, lctx, scrollY || 0, t || 0, S);
    if (dx || dy) { ctx.restore(); lctx.restore(); }
  }
  placeholder() {}
  render() {}
  lensing() { return null; }
  flash() { this.flashT = 1; }
  // Approximate bytes held by this stage's canvases (shared assets + size-dependent ones).
  memory() { return bytesOf(this.A) + this.layoutBytes(); }
  layoutBytes() { return bytesOf(this.S); }
  // back to the pool: keeps the layout so the next createBackground(key) is instant
  dispose() {
    if (!this.A || this.pooled) return;
    this.cancelRelayout();
    this.pooled = true;
    poolAdd(this);
  }
  // really free the size-dependent canvases (pool eviction)
  destroy() {
    this.cancelRelayout();
    freeAll(this.S); this.S = null;
    this.A = null;
  }
}

// Additive nebula tile (periodic in x and y). Returns an opaque-black canvas meant for
// 'lighter' compositing. dens(x, y, v) can reshape the noise value v -> 0..1 density.
function nebulaTile(...a) { return runGen(nebulaTileG(...a)); }
function* nebulaTileG(rng, w, h, { cell = 160, oct = 5, warp = 40, ramp, bias = 0.45, contrast = 2.2, profile = null, step = 2, ridged = 0, levels = 0 }) {
  const f = new Fbm(rng, w, h, cell, oct, 0.52);
  const wx = new Fbm(rng, w, h, cell * 1.3, 3, 0.5).field(4);
  const wy = new Fbm(rng, w, h, cell * 1.3, 3, 0.5).field(4);
  const rf = ridged ? new Fbm(rng, w, h, cell * 0.7, 4, 0.55) : null;
  const cw = Math.ceil(w / step), ch = Math.ceil(h / step);
  const coarse = new Float32Array(cw * ch);
  yield;
  for (let y = 0; y < ch; y++) {
    if (every(y, 12)) yield;
    for (let x = 0; x < cw; x++) {
      const px = x * step, py = y * step, i = py * w + px;
      const ox = (wx[i] - 0.5) * warp * 2, oy = (wy[i] - 0.5) * warp * 2;
      let v = f.at(px + ox, py + oy);
      if (rf) v = lerp(v, rf.ridge(px + ox * 0.5, py + oy * 0.5), ridged);
      coarse[y * cw + x] = v;
    }
  }
  const r = new Raster(w, h, true);
  const cols = packRamp(ramp), n = cols.length;
  for (let y = 0; y < h; y++) {
    if (every(y, 64)) yield;
    const fy = y / step, y0 = Math.floor(fy), ty = fy - y0, y1 = (y0 + 1) % ch;
    const pr = profile ? profile(y) : 1;
    for (let x = 0; x < w; x++) {
      const fx = x / step, x0 = Math.floor(fx), tx = fx - x0, x1 = (x0 + 1) % cw;
      const a = coarse[y0 * cw + x0], b = coarse[y0 * cw + x1], c = coarse[y1 * cw + x0], d = coarse[y1 * cw + x1];
      const v = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
      let dens = clamp01((v - bias) * contrast) * pr;
      if (dens <= 0) { r.d[y * w + x] = cols[0]; continue; }
      let s = dens * (n - 1);
      if (levels) s = Math.round(s * levels) / levels;
      r.d[y * w + x] = cols[qi(s, x, y, n)];
    }
  }
  return r.toCanvas();
}

// Two-colour emission nebula (additive, opaque black background), quantised to palette q.
// Density fields A and B are warped fbm; `fil` adds ridged filaments; colours mix in RGB.
function* nebula2TileG(rng, w, h, q, { cell = 150, oct = 5, warp = 60, colA, colB, biasA = 0.5, biasB = 0.55, gainA = 1, gainB = 1, fil = 0.4, filCol = null, spread = 14, step = 2, hot = null, hotAt = 0.8 }) {
  const fa = new Fbm(rng, w, h, cell, oct, 0.52), fb = new Fbm(rng, w, h, cell * 1.2, 4, 0.5);
  const fr = new Fbm(rng, w, h, cell * 0.55, 3, 0.55);
  const wx = new Fbm(rng, w, h, cell * 1.4, 3, 0.5).field(4);
  yield;
  const wy = new Fbm(rng, w, h, cell * 1.4, 3, 0.5).field(4);
  yield;
  const cw = Math.ceil(w / step), ch = Math.ceil(h / step), K = 3;
  const co = new Float32Array(cw * ch * K);
  for (let y = 0; y < ch; y++) {
    if (every(y, 8)) yield;
    for (let x = 0; x < cw; x++) {
      const px = x * step, py = y * step, i = py * w + px;
      const ox = (wx[i] - 0.5) * warp * 2, oy = (wy[i] - 0.5) * warp * 2, j = (y * cw + x) * K;
      co[j] = fa.at(px + ox, py + oy);
      co[j + 1] = fb.at(px - oy * 0.7, py + ox * 0.7);
      co[j + 2] = fr.ridge(px + ox * 0.6, py + oy * 0.6);
    }
  }
  const A = hexToRgb(colA), B = hexToRgb(colB), F = hexToRgb(filCol || colA), HT = hot ? hexToRgb(hot) : null;
  const r = new Raster(w, h, true), v = new Float32Array(K);
  for (let y = 0; y < h; y++) {
    if (every(y, 48)) yield;
    const fy = y / step, y0 = Math.floor(fy), ty = fy - y0, y1 = (y0 + 1) % ch, uy = 1 - ty;
    for (let x = 0; x < w; x++) {
      const fx = x / step, x0 = Math.floor(fx), tx = fx - x0, x1 = (x0 + 1) % cw;
      const ia = (y0 * cw + x0) * 3, ib = (y0 * cw + x1) * 3, ic = (y1 * cw + x0) * 3, id = (y1 * cw + x1) * 3;
      const w00 = (1 - tx) * uy, w10 = tx * uy, w01 = (1 - tx) * ty, w11 = tx * ty;
      v[0] = co[ia] * w00 + co[ib] * w10 + co[ic] * w01 + co[id] * w11;
      v[1] = co[ia + 1] * w00 + co[ib + 1] * w10 + co[ic + 1] * w01 + co[id + 1] * w11;
      v[2] = co[ia + 2] * w00 + co[ib + 2] * w10 + co[ic + 2] * w01 + co[id + 2] * w11;
      const ta = clamp01((v[0] - biasA) * 2.4), tb = clamp01((v[1] - biasB) * 2.6);
      const da = ta * Math.sqrt(ta) * gainA, db = tb * Math.sqrt(tb) * gainB;
      const ff = clamp01((v[2] - 0.78) * 4.5) * fil * (0.3 + da + db);
      let R = A[0] * da + B[0] * db + F[0] * ff, G = A[1] * da + B[1] * db + F[1] * ff, Bl = A[2] * da + B[2] * db + F[2] * ff;
      if (HT && da > hotAt) { const k = (da - hotAt) * 2.2; R += HT[0] * k; G += HT[1] * k; Bl += HT[2] * k; }
      r.d[y * w + x] = R + G + Bl < 3 ? 0xff000000 : q.dq(R, G, Bl, x, y, spread);
    }
  }
  return r.toCanvas();
}

// Flat anamorphic streak (additive): length W, 5 px tall
function streakSprite(w, ramp, falloff) {
  return glowSprite(w, 5, ramp, (dx, dy) => {
    const ay = Math.abs(dy);
    const k = ay < 1 ? 1 : ay < 2 ? 0.42 : 0.12;
    return Math.exp(-Math.abs(dx) / falloff) * k;
  });
}

// Starburst sun/flare (additive), size s
function flareSprite(s, ramp, { rays = 6, rot = 0.3, core = 2.4, rayLen = 0.45 } = {}) {
  return glowSprite(s, s, ramp, (dx, dy) => {
    const d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    let v = Math.exp(-((d / core) ** 2)) * 1.3 + Math.exp(-d / (s * 0.06)) * 0.55 + Math.exp(-d / (s * 0.2)) * 0.18;
    const rr = Math.pow(Math.abs(Math.cos((a - rot) * rays / 2)), 70) * Math.exp(-d / (s * rayLen * 0.4));
    const r2 = Math.pow(Math.abs(Math.cos((a - rot - 0.5) * rays / 2)), 120) * Math.exp(-d / (s * rayLen * 0.22)) * 0.6;
    const cross = Math.exp(-Math.abs(dy) * 1.4) * Math.exp(-Math.abs(dx) / (s * 0.3)) * 0.7 + Math.exp(-Math.abs(dx) * 1.6) * Math.exp(-Math.abs(dy) / (s * 0.14)) * 0.45;
    return v + (rr + r2) * 0.9 + cross;
  });
}

// Small helper for a set of moving lights / ships along straight paths.
class Traffic {
  constructor(list) { this.list = list; }   // [{x0,y0,x1,y1,period,phase,col,eng}]
  draw(ctx, lctx, t) {
    for (const s of this.list) {
      const u = fract((t + s.phase) / s.period);
      const a = smooth(0, 0.08, u) * (1 - smooth(0.9, 1, u));
      if (a <= 0.02) continue;
      const x = Math.round(lerp(s.x0, s.x1, u)), y = Math.round(lerp(s.y0, s.y1, u));
      const ex = Math.sign(s.x0 - s.x1), ey = Math.sign(s.y0 - s.y1);
      ctx.globalAlpha = a;
      ctx.fillStyle = s.col; ctx.fillRect(x, y, 1, 1);
      ctx.fillStyle = s.eng; ctx.fillRect(x + ex, y + ey, 1, 1);
      lctx.globalAlpha = a * (0.6 + 0.4 * Math.sin(t * 30 + s.phase));
      lctx.fillStyle = s.eng; lctx.fillRect(x + ex, y + ey, 1, 1);
    }
    ctx.globalAlpha = 1; lctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------
// TITLE — a dawn-lit ocean world, the Aurora Station ring, sun flare
// ---------------------------------------------------------------------------

const PAL_DAWN = [
  ...RAMPS.void, ...RAMPS.ocean, ...RAMPS.dawn, ...RAMPS.sapphire.slice(0, 5), ...RAMPS.violet.slice(0, 4),
  '#27c2ea', '#79ecff', '#d6fcff', ...RAMPS.steel.slice(0, 7), '#3a0822', '#700f40', '#240a3f', '#461575',
  '#ffd966', '#fff5c9', '#ffffff', '#081a33', '#0d2342', '#13294f', '#1b3a66', '#0b1530',
  '#7a430b', '#bf7412', '#f0a92a', '#3d2106', '#0f1d2e', '#16283d', '#1f3550', '#6a3a22', '#a8602e', '#d98c48',
  '#1a0c26', '#2a1030', '#3a1640', '#4a1a4c', '#5a2458', '#7a2442', '#9a3050', '#b8465a',
];
const FLARE_RAMP = ['#000000', '#1a0a14', '#3d1430', '#7a2442', '#c4474f', '#f08a5c', '#ffc98a', '#fff1d0', '#ffffff'];
const STREAK_RAMP = ['#000000', '#06182c', '#0b3558', '#13658f', '#3aa7d0', '#9fe6ff', '#ffffff'];
const AURORA_RAMP = ['#000000', '#03170f', '#06301e', '#0b5e36', '#16935a', '#2fd184', '#8cf7bf'];

function* genTitle() {
  const rng = new Rng(0x7171e);
  const A = { q: new Quant(PAL_DAWN) };
  A.starsFar = starTile(rng, TW, 320, 1100, { maxB: 0.5, pow: 2.2, big: 0 });
  yield;
  A.starsMid = starTile(rng, TW, 320, 170, { maxB: 1, pow: 1.8, big: 0.1 });
  A.tw = new Twinkles(rng, 34, TW, 360, 0, { bigChance: 0.35 });
  A.ghost = glowSprite(15, 15, ['#000000', '#0a1f2a', '#123a44', '#1c5a5c'], (dx, dy) => {
    const d = Math.hypot(dx, dy); return Math.exp(-(((d - 5.2) / 1.3) ** 2)) * 0.9 + (d < 5 ? 0.25 : 0);
  });
  A.ghost2 = glowSprite(9, 9, ['#000000', '#0a1a22', '#10303a', '#184a52'], (dx, dy) => {
    const d = Math.hypot(dx, dy); return d < 3.6 ? 0.8 : 0;
  });
  yield;
  return A;
}

class TitleStage extends Stage {
  constructor(A) {
    super('title', A);
    this.scrollSpeed = 12;
    this.grade = { tint: [1.0, 0.98, 1.03], lift: [0.012, 0.004, 0.03], sat: 1.12, contrast: 1.06 };
    this.asyncFirst = true;      // menu backdrop: lay out in time slices, stars meanwhile
    this.dis = null;
  }

  // shown while the first layout is being built (boot)
  placeholder(ctx, lctx, t) {
    const w = this.want, A = this.A;
    ctx.fillStyle = '#05040c'; ctx.fillRect(0, 0, w.W, w.H);
    ctx.globalCompositeOperation = 'lighter';
    const ax = Math.round(w.fx + FIELD_W / 2 - TW / 2);
    drawTiled(ctx, A.starsFar, ax + Math.round(-t * 0.35), 0, w.W, w.H);
    drawTiled(ctx, A.starsMid, ax + Math.round(-t * 0.7), 0, w.W, w.H);
    ctx.globalCompositeOperation = 'source-over';
  }

  *layout(S) {
    const { W, LH: H } = S, A = this.A, q = A.q;
    prof();
    const portrait = H >= W * 1.2;
    const R = portrait ? Math.max(W * 1.0, 230) : Math.max(W * 0.95, H * 1.2);
    const top = Math.round(portrait ? H * 0.66 : H * 0.6);
    const pcx = W * (portrait ? 0.58 : 0.55), pcy = top + R;
    S.geo = { R, top, pcx, pcy };
    // Flare point on the limb, left of centre.
    const fxp = W * (portrait ? 0.2 : 0.3);
    const fyp = pcy - Math.sqrt(Math.max(0, R * R - (fxp - pcx) ** 2));
    S.flarePos = [Math.round(fxp), Math.round(fyp) - 1];
    // Sun: behind the planet, to the left -> a lit crescent along the limb, night elsewhere.
    let L = [-0.8, -0.3, -0.5]; const ll = Math.hypot(...L); L = L.map((v) => v / ll);
    const s2l = Math.hypot(L[0], L[1]), s2x = L[0] / s2l, s2y = L[1] / s2l;
    // glint centre (a sphere normal just below-right of the flare)
    const gx = (fxp + 10 - pcx) / R, gy = (fyp + 16 - pcy) / R, gz = Math.sqrt(Math.max(0, 1 - gx * gx - gy * gy));

    // Surface noise on a coarse grid (bilinear) — the dither supplies pixel-level texture.
    const noise = coarseGrid(0, top - 2, W, H - top + 2, 2, 4, (x, y, o) => {
      let dx = (x - pcx) / R, dy = (y - pcy) / R; const d = Math.hypot(dx, dy);
      if (d > 0.999) { dx *= 0.999 / d; dy *= 0.999 / d; }
      const nz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
      const wv = fbm3(dx * 2.2, dy * 2.2 + 9, nz * 2.2, 2, 3);
      o[0] = fbm3(dx * 3 + 5, dy * 3, nz * 3, 3, 7);                                   // ocean depth
      o[1] = fbm3(dx * 3.2 + wv * 2.4, dy * 12 + wv * 4, nz * 3.2, 4, 13);             // banded clouds
      o[2] = fbm3(dx * 4.5 + 3, dy * 4.5, nz * 4.5, 4, 21);                            // islands
      o[3] = fbm3(dx * 14, dy * 14, nz * 14, 2, 41);                                   // city clusters
    });
    const nv = new Float32Array(4);
    prof('title noise');
    yield;

    const sky = new Raster(W, H), pl = new Raster(W, H), em = new Raster(W, H);
    const cityR = hexToRgb('#f0a92a'), cityW = hexToRgb('#fff1c9');
    const gk1 = 1 / (Math.max(W, H) * 0.3), gk2 = 1 / (W * 0.05);
    for (let y = 0; y < H; y++) {
      if (every(y, 24)) yield;
      const ty = y / H;
      for (let x = 0; x < W; x++) {
        const dx = (x + 0.5 - pcx) / R, dy = (y + 0.5 - pcy) / R, d2 = dx * dx + dy * dy;
        const sdx = x - fxp, sdy = (y - fyp) * 1.9, sd = Math.sqrt(sdx * sdx + sdy * sdy);
        const g1 = Math.exp(-sd * gk1), g2 = Math.exp(-sd * gk2);
        if (d2 >= 1) {
          // --- sky ---
          const d = Math.sqrt(d2), h = (d - 1) * R;
          let r = lerp(4, 12, ty * ty), g = lerp(3, 10, ty * ty), b = lerp(11, 34, ty);
          // indigo band hugging the horizon
          const band = Math.exp(-h / (H * 0.16));
          r += 18 * band; g += 10 * band; b += 40 * band;
          r += 95 * g1 + 150 * g2; g += 30 * g1 + 110 * g2; b += 46 * g1 + 70 * g2;
          const ux = dx / d, uy = dy / d, sdot = Math.max(0, ux * s2x + uy * s2y);
          const s15 = sdot * Math.sqrt(sdot), s2 = sdot * sdot, rim = 0.22 + 0.78 * s15;
          const a1 = Math.exp(-h / 1.6) * rim, a2 = Math.exp(-h / 7) * rim * 0.5, a3 = Math.exp(-h / 34) * rim * 0.2;
          const warm = s2 * s2 * s2;
          r += (60 + 195 * warm) * a1 + (30 + 150 * warm) * a2 + 26 * a3;
          g += (170 + 50 * warm) * a1 + (100 + 20 * warm) * a2 + 36 * a3;
          b += (255 - 110 * warm) * a1 + (230 - 150 * warm) * a2 + 90 * a3;
          // wide dither spread where the flare glow ramps (avoids a flat magenta plateau)
          sky.d[y * W + x] = q.dq(r, g, b, x, y, 20 + 26 * g1);
          if (a1 > 0.05) em.d[y * W + x] = pack(r * 0.25 * a1, g * 0.25 * a1, b * 0.25 * a1);
          continue;
        }
        // --- planet ---
        noise.get(x, y, nv);
        const nz = Math.sqrt(1 - d2), nx = dx, ny = dy;
        const ndl = nx * L[0] + ny * L[1] + nz * L[2];
        const cloud = smooth(0.56, 0.72, nv[1]);
        const isl = smooth(0.62, 0.66, nv[2]);
        let r = lerp(3, 12, nv[0]), g = lerp(18, 64, nv[0]), b = lerp(42, 112, nv[0]);
        r = lerp(r, 44, isl); g = lerp(g, 70, isl); b = lerp(b, 62, isl);
        r = lerp(r, 214, cloud); g = lerp(g, 222, cloud); b = lerp(b, 236, cloud);
        const lit = smooth(-0.04, 0.6, ndl);
        let R0 = r * (0.03 + lit * 0.85), G0 = g * (0.04 + lit * 0.85), B0 = b * (0.07 + lit * 0.88);
        // first light: cloud tops glow gold along the terminator
        const band = Math.exp(-(((ndl - 0.07) / 0.06) ** 2)) * cloud;
        R0 += band * 150; G0 += band * 78; B0 += band * 26;
        // night: deep navy with airglow; clouds faintly visible
        R0 += (3 + 8 * cloud) * (1 - lit); G0 += (7 + 12 * cloud) * (1 - lit); B0 += (18 + 20 * cloud) * (1 - lit);
        // sun glint on open ocean
        const gd = nx * gx + ny * gy + nz * gz;
        const spec = gd > 0.9 ? Math.pow(gd, 150) * (1 - cloud * 0.85) * (1 - isl) : 0;
        R0 += 255 * spec; G0 += 200 * spec; B0 += 140 * spec;
        // atmosphere haze near the limb (blue on the day side, faint violet at night)
        const d = Math.sqrt(d2), ux = dx / d, uy = dy / d, sdot = Math.max(0, ux * s2x + uy * s2y);
        const limb = (1 - nz) * (1 - nz) * (1 - nz);
        const s2 = sdot * sdot, haze = limb * (0.12 + 0.88 * sdot * Math.sqrt(sdot));
        const warm = s2 * s2 * s2;
        R0 += (50 + 170 * warm) * haze; G0 += (140 + 40 * warm) * haze; B0 += (255 - 110 * warm) * haze;
        R0 += 14 * limb * (1 - sdot); B0 += 36 * limb * (1 - sdot);
        // flare bloom spilling over the planet
        R0 += 70 * g2; G0 += 50 * g2; B0 += 30 * g2;
        // city lights: strung along coastlines across the whole night side, clustered into
        // metropolitan areas (nv[3]) with dim suburbs between them; none under thick cloud
        const dark = 1 - smooth(0.02, 0.25, lit);
        if (dark > 0 && nv[2] > 0.6 && cloud < 0.7) {
          const coast = 1 - smooth(0.64, 0.74, nv[2]);               // 1 near the shore, 0 inland
          const metro = smooth(0.4, 0.72, nv[3]);
          const dens = dark * (1 - cloud / 0.7) * smooth(0.6, 0.64, nv[2]) * (0.15 + 0.85 * coast) * (0.25 + 0.75 * metro);
          const hsh = hash3(x, y, 7, 3);
          if (hsh < dens * 0.3) {
            const hot = hsh < dens * 0.05 * (0.4 + metro);
            const c = hot ? cityW : cityR, k = (hot ? 0.95 : 0.4 + 0.3 * metro) * dark;
            R0 = lerp(R0, c[0], k); G0 = lerp(G0, c[1], k); B0 = lerp(B0, c[2], k);
            em.d[y * W + x] = pack(c[0] * k * 0.5, c[1] * k * 0.45, c[2] * k * 0.35);
          }
        }
        pl.d[y * W + x] = q.dq(R0, G0, B0, x, y, 18);
      }
    }
    // crisp 1px bright limb on the sun side
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - pcx; if (Math.abs(dx) >= R) continue;
      const y = Math.floor(pcy - Math.sqrt(R * R - dx * dx));
      const ux = dx / R, uy = (y - pcy) / R, sdot = Math.max(0, ux * s2x + uy * s2y);
      if (sdot > 0.3) {
        const k = smooth(0.3, 1, sdot);
        pl.set(x, y, q.dq(150 + 105 * k, 200 + 50 * k, 255 - 40 * k, x, y, 30));
        em.add(x, y, (80 * k) | 0, (90 * k) | 0, (90 * k) | 0);
      }
    }
    prof('title pixels');
    yield;
    S.sky = sky.toCanvas();
    S.planet = yield* bandedG(pl);
    S.em = yield* bandedG(em);
    prof('title toCanvas');

    // Nebula wisps above the planet, periodic in x; calm band where the logo sits. The tile
    // reaches down to the lowest visible limb point and fades out before its bottom edge,
    // so no hard horizontal edge shows beside the planet.
    const limbAt = (x) => (Math.abs(x - pcx) < R ? pcy - Math.sqrt(R * R - (x - pcx) ** 2) : H);
    const nh = Math.min(H, Math.max(64, Math.ceil(Math.max(limbAt(0), limbAt(W - 1))) + 4));
    const nprof = (y) => {
      const v = y / H;
      const calm = 1 - 0.92 * Math.exp(-(((v - 0.25) / 0.13) ** 2));
      return calm * (0.55 + 0.45 * smooth(0, 0.12, v)) * (1 - 0.5 * smooth(top * 0.8, top, y)) * (1 - smooth(nh - 40, nh - 2, y));
    };
    const nrng = new Rng(0xabc1);
    const ntw = W > TW ? Math.ceil(W / 64) * 64 : TW;
    S.nebFar = yield* nebulaTileG(nrng, ntw, nh, { cell: 110, oct: 5, warp: 34, bias: 0.5, contrast: 2.4, step: 3, profile: nprof,
      ramp: ['#000000', '#050414', '#0a0822', '#100c34', '#18124a', '#231a60'] });
    S.nebNear = yield* nebulaTileG(nrng, ntw, nh, { cell: 70, oct: 5, warp: 26, bias: 0.57, contrast: 3.0, ridged: 0.55, profile: nprof,
      ramp: ['#000000', '#0c0412', '#1a071e', '#2c0b2a', '#441434', '#5e1e3c'] });

    prof('title nebula');
    // Aurora curtains along the night-side limb: 8 looping frames.
    yield* this.buildAurora(S, R, pcx, pcy, s2x, s2y);
    prof('title aurora');
    this.buildRing(S, portrait);
    prof('title ring');
    yield;
    // Flare sprites
    S.flare = flareSprite(portrait ? 71 : 91, FLARE_RAMP, { rays: 6, rot: 0.35 });
    S.streak = streakSprite(Math.round(W * 1.4), STREAK_RAMP, W * 0.24);
    // Traffic from the station down toward the planet
    const [rx, ry] = S.ring.c;
    S.traffic = new Traffic([
      { x0: rx - 4, y0: ry + 2, x1: rx - W * 0.45, y1: top + 30, period: 26, phase: 0, col: '#aebfdc', eng: '#79ecff' },
      { x0: rx + 6, y0: ry - 3, x1: W + 10, y1: ry - H * 0.2, period: 34, phase: 13, col: '#aebfdc', eng: '#ffab4f' },
      { x0: -10, y0: top - H * 0.08, x1: rx - 8, y1: ry, period: 40, phase: 22, col: '#7c8fb3', eng: '#79ecff' },
    ]);
  }

  *buildAurora(S, R, pcx, pcy, s2x, s2y) {
    const W = S.W, H = S.LH;
    const x0 = Math.floor(pcx), x1 = W, y0 = Math.max(0, Math.floor(S.geo.top - 26)), y1 = Math.min(H, Math.floor(S.geo.top + 60));
    const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
    const cols = AURORA_RAMP.map(hexToRgb), n = cols.length, top = hexToRgb('#6a3fd0');
    const frames = [];
    for (let f = 0; f < 8; f++) {
      const r = new Raster(w, h), ph = (f / 8) * TAU;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const X = x + x0 + 0.5, Y = y + y0 + 0.5;
        const dx = (X - pcx) / R, dy = (Y - pcy) / R, d = Math.hypot(dx, dy);
        const hgt = (d - 1) * R;                     // px above limb
        if (hgt < -3 || hgt > 22) continue;
        const ang = Math.atan2(dy, dx);             // around the limb
        const nightness = 1 - smooth(-0.2, 0.25, (dx / d) * s2x + (dy / d) * s2y);
        if (nightness <= 0) continue;
        const u = ang * R;                           // arc length
        const curtain = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(u * 0.07 + ph + Math.sin(u * 0.023 - ph) * 2.2));
        const rays = 0.55 + 0.45 * Math.sin(u * 1.3 + Math.sin(u * 0.11 + ph * 2) * 4);
        const base = Math.sin(u * 0.05 - ph) * 2;
        const hh = 7 + 10 * curtain, hb = hgt - base * 0.5;
        const prof = smooth(-1.5, 0.5, hb) * (1 - smooth(hh * 0.25, hh, hb));
        let v = prof * curtain * (0.5 + 0.5 * rays) * nightness * 1.7;
        if (v <= 0.03) continue;
        const i = qi(clamp01(v) * (n - 1), X | 0, Y | 0, n);
        if (i === 0) continue;
        const c = cols[i], tp = smooth(hh * 0.4, hh, hgt) * 0.8;
        r.d[y * w + x] = pack(lerp(c[0], top[0] * v, tp), lerp(c[1], top[1] * v * 0.4, tp), lerp(c[2], top[2] * v, tp));
      }
      frames.push(r.toCanvas());
      yield;
    }
    S.aurora = frames;
    S.auroraPos = [x0, y0];
  }

  // Aurora Station: a tilted torus of habitat segments with spokes, hub and solar wings,
  // backlit by the sun on the left. Windows glow on the light layer.
  buildRing(S, portrait) {
    const W = S.W, H = S.LH, top = S.geo.top;
    const a = Math.round(portrait ? W * 0.24 : H * 0.26), b = Math.round(a * 0.36);
    // landscape: keep the ring right of and below the logo + subtitle
    const cx = Math.round(W * (portrait ? 0.7 : 0.78)), cy = Math.round(portrait ? top - H * 0.15 : top - H * 0.2);
    S.ring = { c: [cx, cy], a, b };
    const pad = 16, w = a * 2 + pad * 2, h = b * 2 + pad * 2 + 20;
    const ox = cx - w / 2, oy = cy - h / 2 - 6;
    const r = new Raster(w, h), e = new Raster(w, h);
    const rot = -0.16, cr = Math.cos(rot), sr = Math.sin(rot);
    const P = (th, rad = 1) => {
      const lx = Math.cos(th) * a * rad, ly = Math.sin(th) * b * rad;
      return [cx - ox + lx * cr - ly * sr, cy - oy + lx * sr + ly * cr];
    };
    const ST = packRamp(['#080b14', '#0f1420', '#18202f', '#243044', '#34425c', '#4c5e7c', '#6f84a4']);
    const rimW = packHex('#ffd49a'), rimC = packHex('#c8d8f0'), win = packHex('#ffd27a'), winD = packHex('#a0782e'), winC = packHex('#79ecff');
    const seg = 20;
    const tube = (front) => {
      const tr = front ? Math.max(2.5, a * 0.075) : Math.max(1.8, a * 0.055);
      for (let th = 0; th < TAU; th += 0.3 / a) {
        if ((Math.sin(th) > 0) !== front) continue;
        const [px, py] = P(th);
        const segEdge = Math.abs(fract((th / TAU) * seg) - 0.5) > 0.46;       // gaps between habitat segments
        const sunSide = -Math.cos(th) * 0.5 + 0.5;                            // left side faces the sun
        for (let yy = -4; yy <= 4; yy++) for (let xx = -4; xx <= 4; xx++) {
          const dd = Math.sqrt(xx * xx + yy * yy); if (dd > tr) continue;
          const ny = yy / tr, nx = xx / tr;
          let v = (front ? 3 : 2) - ny * 1.6 - nx * 0.6 + sunSide * 0.8;
          if (segEdge) v -= 1.2;
          let c = ST[qi(clamp(v, 0, 6), px + xx, py + yy, 7)];
          if (dd > tr - 1 && ny < -0.3 && sunSide > 0.45) c = sunSide > 0.8 ? rimW : rimC;   // sunlit top edge
          r.set(px + xx, py + yy, c);
        }
      }
      // continuous strip of windows along the visible face
      for (let th = 0.05; th < TAU; th += 1.6 / a) {
        if ((Math.sin(th) > 0) !== front) continue;
        if (Math.abs(fract((th / TAU) * seg) - 0.5) > 0.4) continue;
        const [px, py] = P(th, front ? 1.0 : 0.985);
        const lit = hash3(Math.round(th * 100), 1, 2, 3) < (front ? 0.75 : 0.5);
        if (!lit) continue;
        const c = front ? win : winD;
        r.set(px, py + (front ? 1 : 0), c); e.set(px, py + (front ? 1 : 0), c);
      }
      // habitat blocks on the outer rim
      for (let k = 0; k < seg; k += 2) {
        const th = ((k + 0.5) / seg) * TAU;
        if ((Math.sin(th) > 0) !== front) continue;
        const [px, py] = P(th, 1.1);
        const sz = front ? 4 : 3;
        for (let yy = 0; yy < sz - 1; yy++) for (let xx = 0; xx < sz; xx++) r.set(px - 1 + xx, py - 1 + yy, ST[yy === 0 ? 5 : front ? 3 : 2]);
        if (Math.cos(th) < -0.3) r.set(px - 1, py - 1, rimW);
        if (front) { r.set(px + 1, py, win); e.set(px + 1, py, win); }
      }
    };
    const spokes = (front) => {
      for (let k = 0; k < 4; k++) {
        const th = 0.5 + (k * Math.PI) / 2;
        if ((Math.sin(th) > 0) !== front) continue;
        const [px, py] = P(th, 0.93);
        r.line(cx - ox, cy - oy, px, py, ST[front ? 3 : 2]);
        r.line(cx - ox, cy - oy - 1, px, py - 1, ST[front ? 5 : 3]);
        const [mx, my] = P(th, 0.5);
        r.set(mx, my - 1, winC); e.set(mx, my - 1, winC);
      }
    };
    tube(false);
    spokes(false);
    // hub, solar wings, docking spire, docked ships
    const hx = cx - ox, hy = cy - oy;
    for (const k of [-1, 1]) for (let i = 5; i < a * 0.5; i++) {
      const x = hx + k * i, y = hy + Math.round(k * i * sr);
      r.set(x, y - 2, packHex('#0d2342')); r.set(x, y - 1, packHex(i % 3 ? '#13294f' : '#2150d0')); r.set(x, y, packHex('#0b1530'));
    }
    kCyl(r, hx - 3, hy - 7, 12, 3, false, mat(['#0f1420', '#18202f', '#243044', '#34425c', '#4c5e7c', '#6f84a4'], '#ffd49a'), [-0.8, -0.5], { seg: 4 });
    r.rect(hx - 4, hy - 1, 9, 2, ST[4]); r.set(hx - 4, hy - 1, rimW);
    r.vline(hx, hy - 14, hy - 8, ST[4]); r.set(hx, hy - 14, rimC);
    for (const [sx, sy] of [[hx + 6, hy - 5], [hx - 8, hy + 3]]) { r.rect(sx, sy, 3, 1, ST[5]); r.set(sx + (sx > hx ? 3 : -1), sy, winC); e.set(sx + (sx > hx ? 3 : -1), sy, winC); }
    e.set(hx, hy - 14, packHex('#ff5a5a'));
    for (let k = 0; k < 3; k++) { r.set(hx + 1, hy - 5 + k * 2, winC); e.set(hx + 1, hy - 5 + k * 2, winC); }
    spokes(true);
    tube(true);
    S.ringC = outlined(r, packHex('#05040c', 210)).toCanvas();
    S.ringE = e.toCanvas();
    S.ringPos = [Math.round(ox), Math.round(oy)];
    const tipL = P(Math.PI), tipR = P(0);
    S.beacons = [[hx + ox, hy - 14 + oy, 0], [tipL[0] + ox - 2, tipL[1] + oy, 1.3], [tipR[0] + ox + 2, tipR[1] + oy, 2.1]].map((p) => [Math.round(p[0]), Math.round(p[1]), p[2]]);
  }

  render(ctx, lctx, scrollY, t, S) {
    const { W, H, A } = this;
    const lop = lctx.globalCompositeOperation;
    ctx.drawImage(S.sky, 0, 0);
    const vy = Math.round(scrollY * 0.02);
    ctx.globalCompositeOperation = 'lighter';
    drawTiled(ctx, A.starsFar, Math.round(-t * 0.35), vy, W, H);
    drawTiled(ctx, S.nebFar, Math.round(-t * 0.8), 0, W, S.nebFar.height);
    drawTiled(ctx, A.starsMid, Math.round(-t * 0.7), vy * 2, W, H);
    drawTiled(ctx, S.nebNear, Math.round(-t * 1.6), 0, W, S.nebNear.height);
    ctx.globalCompositeOperation = 'source-over';
    A.tw.draw(ctx, lctx, Math.round(-t * 0.7), vy * 2, W, S.geo.top - 4, t);
    blit(ctx, S.planet, 0, 0);
    // aurora curtains: Bayer dissolve between baked frames (no off-palette alpha ghosts)
    const af = (t * 1.6) % 8, i0 = Math.floor(af), i1 = (i0 + 1) % 8, k = af - i0;
    const [ax0, ay0] = S.auroraPos;
    const dis = this.dis && this.dis.w === S.aurora[0].width && this.dis.h === S.aurora[0].height ? this.dis
      : (this.dis = new Dissolve(S.aurora[0].width, S.aurora[0].height));
    dis.prep(S.aurora[i0], S.aurora[i1], k, true);
    ctx.globalCompositeOperation = 'lighter';
    dis.put(ctx, ax0, ay0);
    lctx.globalCompositeOperation = 'lighter';
    lctx.globalAlpha = 0.5; dis.put(lctx, ax0, ay0);
    lctx.globalAlpha = 0.9; blit(lctx, S.em, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    // station (occludes the light behind it)
    const [rx, ry] = S.ringPos;
    ctx.drawImage(S.ringC, rx, ry);
    occlude(lctx, (l) => l.drawImage(S.ringC, rx, ry));
    lctx.globalAlpha = 0.8; lctx.drawImage(S.ringE, rx, ry);
    const bc = S.beacons;
    for (let i = 0; i < bc.length; i++) {
      const bx = bc[i][0], by = bc[i][1];
      if (fract(t * 0.7 + bc[i][2]) >= 0.12) continue;
      ctx.fillStyle = '#ff5a5a'; ctx.fillRect(bx, by, 1, 1);
      lctx.globalAlpha = 1; lctx.fillStyle = '#ff5a5a'; lctx.fillRect(bx - 1, by, 3, 1); lctx.fillRect(bx, by - 1, 1, 3);
    }
    S.traffic.draw(ctx, lctx, t);
    // sun flare + anamorphic streak + ghosts
    const [fx, fy] = S.flarePos;
    const breathe = 0.85 + 0.15 * Math.sin(t * 0.7) + this.flashT * 0.8;
    // (canvas ignores globalAlpha > 1, so extra flash brightness is a second additive pass)
    ctx.globalCompositeOperation = 'lighter';
    const fxo = fx - (S.flare.width >> 1), fyo = fy - (S.flare.height >> 1);
    ctx.globalAlpha = clamp01(breathe); ctx.drawImage(S.flare, fxo, fyo);
    if (breathe > 1) { ctx.globalAlpha = clamp01(breathe - 1); ctx.drawImage(S.flare, fxo, fyo); }
    ctx.globalAlpha = clamp01(0.55 * breathe);
    ctx.drawImage(S.streak, fx - (S.streak.width >> 1), fy - 2);
    lctx.globalAlpha = clamp01(0.75 * breathe);
    lctx.drawImage(S.flare, fxo, fyo);
    lctx.globalAlpha = clamp01(0.35 * breathe);
    lctx.drawImage(S.streak, fx - (S.streak.width >> 1), fy - 2);
    const gcx = W * 0.5, gcy = H * 0.45;
    const gs = this.ghosts || (this.ghosts = [[0.5, A.ghost, 0.3], [0.9, A.ghost2, 0.3], [1.3, A.ghost, 0.2], [1.62, A.ghost2, 0.22]]);
    for (let i = 0; i < gs.length; i++) {
      const u = gs[i][0], img = gs[i][1], al = gs[i][2];
      const gx = Math.round(lerp(fx, gcx, u)) - (img.width >> 1), gy = Math.round(lerp(fy, gcy, u)) - (img.height >> 1);
      ctx.globalAlpha = clamp01(al * breathe); ctx.drawImage(img, gx, gy);
      lctx.globalAlpha = clamp01(al * 0.5 * breathe); lctx.drawImage(img, gx, gy);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    lctx.globalAlpha = 1; lctx.globalCompositeOperation = lop;
  }
  destroy() { if (this.dis) this.dis.free(); this.dis = null; super.destroy(); }
}

// ---------------------------------------------------------------------------
// Structure kit: pixel-art primitives for stations, rigs and hulls.
// `sun` is a 2D screen direction TOWARD the light, e.g. [0.6, -0.8] = upper right.
// A material is a dark->light ramp of packed colours plus a rim highlight.
// ---------------------------------------------------------------------------

function mat(hexes, rim) { return { c: packRamp(hexes), n: hexes.length, rim: packHex(rim || hexes[hexes.length - 1]) }; }
const mc = (m, i) => m.c[clamp(Math.round(i), 0, m.n - 1)];

// Bevelled box. panels: panel-line spacing (0 = none). base: ramp index of the face.
function kBox(r, x, y, w, h, m, sun, { panels = 0, base = 2, rim = true } = {}) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  if (w <= 0 || h <= 0) return;
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    let i = base;
    if (panels && xx > 0 && yy > 0 && xx < w - 1 && yy < h - 1 && ((xx % panels) === 0 || (yy % panels) === 0)) i = base - 1;
    if (yy === 0) i = sun[1] < 0 ? base + 1 : base - 1;
    else if (yy === h - 1) i = sun[1] > 0 ? base + 1 : base - 2;
    if (xx === 0) i = sun[0] < 0 ? base + 1 : Math.min(i, base - 1);
    else if (xx === w - 1) i = sun[0] > 0 ? base + 1 : Math.min(i, base - 1);
    r.set(x + xx, y + yy, mc(m, i));
  }
  if (rim) r.set(sun[0] > 0 ? x + w - 1 : x, sun[1] < 0 ? y : y + h - 1, m.rim);
}

// Cylinder: horizontal (axis along x) or vertical. seg: seam spacing.
function kCyl(r, x, y, len, rad, horiz, m, sun, { seg = 0, caps = true } = {}) {
  x = Math.round(x); y = Math.round(y);
  const d = Math.max(2, Math.round(rad * 2));
  for (let a = 0; a < len; a++) for (let b = 0; b < d; b++) {
    const nn = (b + 0.5 - d / 2) / (d / 2), nz = Math.sqrt(Math.max(0, 1 - nn * nn));
    const l = (horiz ? nn * sun[1] : nn * sun[0]) * 0.85 + nz * 0.35;   // sun-facing side brighter
    let v = clamp01(0.45 + l * 0.6) * (m.n - 1);
    if (seg && a % seg === 0) v -= 1.2;
    if (caps && (a === 0 || a === len - 1)) v += ((horiz ? sun[0] : sun[1]) * (a === 0 ? -1 : 1)) > 0 ? 0.8 : -0.8;
    const px = horiz ? x + a : x + b, py = horiz ? y + b : y + a;
    r.set(px, py, m.c[qi(clamp(v, 0, m.n - 1), px, py, m.n)]);
  }
}

// Sphere / tank
function kBall(r, cx, cy, rad, m, sun, { spec = true } = {}) {
  const L = [sun[0] * 0.8, sun[1] * 0.8, 0.5];
  for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y++) for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x++) {
    const dx = (x + 0.5 - cx) / rad, dy = (y + 0.5 - cy) / rad, d2 = dx * dx + dy * dy;
    if (d2 > 1) continue;
    const nz = Math.sqrt(1 - d2), l = dx * L[0] + dy * L[1] + nz * L[2];
    let v = clamp01(0.2 + l * 0.75) * (m.n - 1);
    if (d2 > 0.8) v -= 0.6;
    r.set(x, y, m.c[qi(clamp(v, 0, m.n - 1), x, y, m.n)]);
    if (spec && l > 0.93) r.set(x, y, m.rim);
  }
}

// Lattice truss between two points. w: width in px.
function kTruss(r, x0, y0, x1, y1, w, m, sun, { rungs = true, heavy = false } = {}) {
  const dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux, hw = w / 2;
  const litPlus = nx * sun[0] + ny * sun[1] > 0;
  const A = [x0 + nx * hw, y0 + ny * hw], B = [x0 - nx * hw, y0 - ny * hw];
  const step = Math.max(3, w * 1.1);
  for (let s = 0, k = 0; s < len; s += step, k++) {
    const s2 = Math.min(len, s + step);
    const p = k % 2 ? A : B, q = k % 2 ? B : A;
    r.line(p[0] + ux * s, p[1] + uy * s, q[0] + ux * s2, q[1] + uy * s2, mc(m, 1));
    if (rungs) r.line(A[0] + ux * s, A[1] + uy * s, B[0] + ux * s, B[1] + uy * s, mc(m, 1));
  }
  const rail = (P, lit) => {
    r.line(P[0], P[1], P[0] + dx, P[1] + dy, mc(m, lit ? m.n - 2 : 1));
    if (heavy) { const k = lit ? -1 : 1; r.line(P[0] + nx * k * (litPlus ? 1 : -1), P[1] + ny * k * (litPlus ? 1 : -1), P[0] + nx * k * (litPlus ? 1 : -1) + dx, P[1] + ny * k * (litPlus ? 1 : -1) + dy, mc(m, lit ? m.n - 3 : 0)); }
  };
  rail(litPlus ? B : A, false);
  rail(litPlus ? A : B, true);
  // nodes
  for (let s = 0; s <= len; s += step) {
    r.set(A[0] + ux * s, A[1] + uy * s, mc(m, litPlus ? m.n - 1 : 2));
    r.set(B[0] + ux * s, B[1] + uy * s, mc(m, litPlus ? 2 : m.n - 1));
  }
}

// Solid beam (thick shaded line)
function kBeam(r, x0, y0, x1, y1, t, m, sun) {
  const dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;
  const nx = -dy / len, ny = dx / len, litDir = nx * sun[0] + ny * sun[1];
  for (let k = 0; k < t; k++) {
    const o = k - (t - 1) / 2, f = t > 1 ? o / ((t - 1) / 2) : 0;
    const v = 2 + f * Math.sign(litDir) * 1.4 + (Math.abs(f) > 0.99 ? (f * litDir > 0 ? 0.6 : -0.6) : 0);
    r.line(x0 + nx * o, y0 + ny * o, x1 + nx * o, y1 + ny * o, mc(m, v));
  }
}

// Solar array: dark blue cells with a reflective sheen band
function kSolar(r, x, y, w, h, sheen = 0.3) {
  const cell = [packHex('#0b1530'), packHex('#0d2342'), packHex('#13294f'), packHex('#1b3a66'), packHex('#2150d0')];
  const frame = packHex('#526283'), grid = packHex('#081a33');
  x = Math.round(x); y = Math.round(y);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    let c;
    if (xx === 0 || yy === 0 || xx === w - 1 || yy === h - 1) c = frame;
    else if (xx % 3 === 0 || yy % 4 === 0) c = grid;
    else {
      const band = Math.exp(-((((xx / w + yy / h) - 1 + sheen) * 3.2) ** 2));
      c = cell[qi(clamp(1 + band * 3.2, 0, 4), x + xx, y + yy, 5)];
    }
    r.set(x + xx, y + yy, c);
  }
}

// Outline everything opaque in `r` with colour c (1 px, 4-neighbourhood), into a copy.
function outlined(r, c) {
  const { w, h, d } = r, o = new Raster(w, h, r.wrap), od = o.d, wrap = r.wrap;
  od.set(d);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const up = y > 0 ? row - w : wrap ? (h - 1) * w : -1;
    const dn = y < h - 1 ? row + w : wrap ? 0 : -1;
    for (let x = 0; x < w; x++) {
      if (d[row + x]) continue;
      const l = x > 0 ? x - 1 : wrap ? w - 1 : -1, rr = x < w - 1 ? x + 1 : wrap ? 0 : -1;
      if ((l >= 0 && d[row + l]) || (rr >= 0 && d[row + rr]) || (up >= 0 && d[up + x]) || (dn >= 0 && d[dn + x])) od[row + x] = c;
    }
  }
  return o;
}

// Blinking beacons / lights in tile space (x, y), drawn per frame. Light-layer glow is a
// single pixel (bloom softens it) so nothing reads as a bullet; size 2 adds a faint cross.
// fade: smooth pulse instead of a hard blink (steady running lights).
class Blinkers {
  // strip = true: the layer does not repeat horizontally (x is used as-is)
  constructor(w, h, strip = false) { this.w = w; this.h = h; this.strip = strip; this.list = []; }
  add(x, y, col, period = 1.6, phase = 0, duty = 0.14, size = 1, fade = false) { this.list.push({ x: Math.round(mod(x, this.w)), y: Math.round(mod(y, this.h)), col, period, phase, duty, size, fade }); return this; }
  draw(ctx, lctx, ax, oy, W, H, t, shift = 0, gain = 1) {
    const { w, h } = this;
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i];
      const u = fract(t / b.period + b.phase);
      let a;
      if (b.fade) a = 0.35 + 0.65 * (0.5 + 0.5 * Math.cos(u * TAU));
      else { if (u > b.duty) continue; a = 1 - u / b.duty * 0.6; }
      ctx.fillStyle = b.col; lctx.fillStyle = b.col;
      const step = this.strip ? 1e9 : w;
      for (let sx = this.strip ? b.x + ax : mod(b.x + ax, w); sx < W + 2; sx += step) {
        const sy = mod(b.y + oy + colShift(sx, b.x, ax, w, shift, h), h);
        if (sy >= H + 2) continue;
        ctx.globalAlpha = a; ctx.fillRect(sx, sy, 1, b.fade ? 2 : 1);
        lctx.globalAlpha = clamp01(a * gain); lctx.fillRect(sx, sy, 1, b.fade ? 2 : 1);
        if (b.size > 1) { lctx.globalAlpha = a * 0.3 * gain; lctx.fillRect(sx - 1, sy, 3, 1); lctx.fillRect(sx, sy - 1, 1, 3); ctx.globalAlpha = a * 0.5; ctx.fillRect(sx - 1, sy, 3, 1); ctx.fillRect(sx, sy - 1, 1, 3); }
      }
    }
    ctx.globalAlpha = 1; lctx.globalAlpha = 1;
  }
}

// Flickering spark sources (welding arcs, grinding). Each burst is a hot core pixel plus a
// few short-lived pixels sprayed along dir. cols[0] is the core colour.
const SPARK_WELD = ['#f4f8ff', '#c8e4ff', '#9fd0ff', '#fff5c9'];
const SPARK_HOT = ['#fff5c9', '#ffe6a0', '#ffd966', '#ffab4f'];
class Sparks {
  constructor(w, h, strip = false, cols = SPARK_HOT, burst = 0.45) { this.w = w; this.h = h; this.strip = strip; this.list = []; this.cols = cols; this.burst = burst; }
  add(x, y, dirx = 0, diry = 1, rate = 1, phase = 0) { this.list.push({ x: Math.round(mod(x, this.w)), y: Math.round(mod(y, this.h)), dirx, diry, rate, phase }); return this; }
  draw(ctx, lctx, ax, oy, W, H, t, shift = 0) {
    const { w, h, cols } = this;
    for (let i = 0; i < this.list.length; i++) {
      const s = this.list[i];
      const u = fract(t * 0.25 * s.rate + s.phase);
      if (u > this.burst) continue;               // bursts
      const fr = Math.floor(t * 24 + i * 7);
      const step = this.strip ? 1e9 : w;
      for (let sx = this.strip ? s.x + ax : mod(s.x + ax, w); sx < W + 8; sx += step) {
        const sy = mod(s.y + oy + colShift(sx, s.x, ax, w, shift, h), h);
        if (sy >= H + 8) continue;
        const flick = hash3(fr, i, 1, 3);
        ctx.globalAlpha = 0.6 + 0.4 * flick; ctx.fillStyle = cols[0]; ctx.fillRect(sx, sy, 1, 1);
        lctx.globalAlpha = 0.45 + 0.35 * flick; lctx.fillStyle = cols[1]; lctx.fillRect(sx, sy, 1, 1);
        for (let k = 0; k < 3; k++) {
          const hsh = hash3(fr, k, i, 5), hsh2 = hash3(fr, k, i, 9);
          if (hsh > 0.8) continue;
          const dist = 1 + hsh * 5, ang = Math.atan2(s.diry, s.dirx) + (hsh2 - 0.5) * 2.2;
          const px = Math.round(sx + Math.cos(ang) * dist), py = Math.round(sy + Math.sin(ang) * dist);
          ctx.fillStyle = cols[1 + ((hsh * 3) | 0)]; ctx.globalAlpha = 1 - hsh * 0.7;
          ctx.fillRect(px, py, 1, 1);
          lctx.fillStyle = ctx.fillStyle; lctx.globalAlpha = 0.35; lctx.fillRect(px, py, 1, 1);
        }
      }
    }
    ctx.globalAlpha = 1; lctx.globalAlpha = 1;
  }
}

// Brighten the edges of opaque pixels that face toward tile column cx (the field centre):
// near silhouettes then separate from dark enemy hulls that cross them.
function rimToward(r, cx, col, col2) {
  const { w, h, d } = r, src = d.slice();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!src[i] || unA(src[i]) < 250) continue;
    const dir = x < cx ? 1 : -1, nx = x + dir;
    if (nx < 0 || nx >= w || src[y * w + nx]) continue;
    d[i] = col;
    const ix = x - dir;
    if (col2 && ix >= 0 && ix < w && src[y * w + ix] && unA(src[y * w + ix]) >= 250) d[y * w + ix] = col2;
  }
}

// ---------------------------------------------------------------------------
// AURORA (S1) — orbital shipyard above a blue ocean world at dawn
// ---------------------------------------------------------------------------

const SUN_UR = [0.6, -0.8];
const M_FAR = () => mat(['#18324a', '#1f3d58', '#284a68', '#335a7a', '#436e8e', '#5a86a4'], '#a8d0e6');
const M_MID = () => mat(['#0e121c', '#171d2c', '#232c40', '#34405a', '#4c5c7c', '#71849f'], '#d6e4f4');
const M_NEAR = () => mat(['#06070d', '#0b0e17', '#131826', '#1e2537', '#2f3a52', '#4a5876'], '#ffcf9a');
const M_HULL = () => mat(['#141a26', '#202938', '#2f3b4f', '#46556c', '#65778f', '#8a9cb3'], '#e6eefa');
const M_HAZ = () => mat(['#3d2106', '#7a430b', '#bf7412', '#f0a92a'], '#ffd966');

// Ocean planet surface + city lights tile (tw x 512, periodic).
function auroraSurface(tw) {
  const rng = new Rng(0xa11ce + tw);
  const TH = 512;
  // --- planet surface: ocean, archipelagos, city lights (periodic) ---
  const oc = new Fbm(rng, tw, TH, 128, 4, 0.5).field(2);
  const il = new Fbm(rng, tw, TH, 80, 5, 0.55).field(2);
  const ct = new Fbm(rng, tw, TH, 12, 2, 0.5).field(2);
  const surf = new Raster(tw, TH, true), lights = new Raster(tw, TH, true);
  lights.d.fill(0xff000000);   // opaque black: multiply by the night mask must not accumulate
  const OC = packRamp(['#041526', '#062238', '#08304e', '#0c4166', '#115680', '#18709c']);
  const SH = packRamp(['#12628c', '#1c86ab', '#3aa6c4', '#7cc9d8']);
  const LD = packRamp(['#1d3a30', '#2a4f38', '#3d6440', '#5b7a4c', '#8a8a5e', '#b0a070']);
  const amber = hexToRgb('#f0a92a'), hot = hexToRgb('#fff1c9');
  for (let y = 0; y < TH; y++) for (let x = 0; x < tw; x++) {
    const i = y * tw + x, l = il[i];
    let c;
    if (l > 0.665) c = LD[qi((l - 0.665) * 30 + (oc[i] - 0.5) * 2, x, y, 6)];
    else if (l > 0.63) c = SH[qi((l - 0.63) * 90, x, y, 4)];
    else c = OC[qi(clamp((oc[i] - 0.28) * 9 + (l - 0.5) * 6, 0, 5), x, y, 6)];
    surf.d[i] = c;
    if (l > 0.64 && l < 0.74) {
      const dens = smooth(0.5, 0.8, ct[i]) * (1 - Math.abs(l - 0.675) * 16);
      const hs = hash3(x, y, 3, 77);
      if (hs < dens * 0.45) {
        const k = hs < dens * 0.1 ? 1 : 0.6, cc = hs < dens * 0.1 ? hot : amber;
        lights.d[i] = pack(cc[0] * k, cc[1] * k, cc[2] * k);
      }
    }
  }
  return { surf: surf.toCanvas(), lights: lights.toCanvas() };
}

// Cloud bands with baked shadows (tw x 512, alpha).
function auroraClouds(tw) {
  const rng = new Rng(0xc10d + tw);
  const TH = 512;
  // --- cloud bands with shadows (alpha) ---
  const cf = new Fbm(rng, tw, TH * 2, 120, 5, 0.55);
  const cw = new Fbm(rng, tw, TH * 2, 90, 3, 0.5);
  const dens = new Float32Array(tw * TH);
  for (let y = 0; y < TH; y += 2) for (let x = 0; x < tw; x += 2) {
    const w = cw.at(x, y * 2);
    const v = cf.at(x + (w - 0.5) * 60, y * 2 + (w - 0.5) * 30);
    dens[y * tw + x] = smooth(0.5, 0.7, v);
  }
  for (let y = 0; y < TH; y++) for (let x = 0; x < tw; x++) {       // bilinear fill of odd pixels
    if (!(y & 1) && !(x & 1)) continue;
    const x0 = x & ~1, y0 = y & ~1, x1 = (x0 + 2) % tw, y1 = (y0 + 2) % TH, tx = (x - x0) / 2, ty = (y - y0) / 2;
    const a = dens[y0 * tw + x0], b = dens[y0 * tw + x1], c = dens[y1 * tw + x0], d = dens[y1 * tw + x1];
    dens[y * tw + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }
  const cl = new Raster(tw, TH, true);
  const CL = packRamp(['#4d6d90', '#7394b4', '#a2bfd6', '#cadcec', '#e8f1f9']);
  const shadow = pack(2, 10, 22, 150);
  for (let y = 0; y < TH; y++) for (let x = 0; x < tw; x++) {
    const v = dens[y * tw + x];
    const a = v > 0.12 ? (v > 0.45 ? 1 : bay(x, y) < (v - 0.12) * 3 ? 1 : 0) : 0;
    if (a) { cl.d[y * tw + x] = CL[qi(v * 4.4 - 0.4, x, y, 5)]; continue; }
    const s = dens[wr(y - 3, TH) * tw + wr(x + 2, tw)];
    if (s > 0.3) cl.d[y * tw + x] = shadow;
  }
  return cl.toCanvas();
}

function* genAurora() {
  const rng = new Rng(0xa11ce);
  const A = {};
  Object.assign(A, auroraSurface(TW));
  yield;
  A.clouds = auroraClouds(TW);
  yield;

  // --- far station layer (f = 0.2): the ring's spine seen from far above — small, hazy ---
  {
    const H = 768, r = new Raster(TW, H, true), e = new Raster(TW, H, true), m = M_FAR(), sun = SUN_UR;
    const bl = new Blinkers(TW, H);
    const spine = (y, w) => {
      kTruss(r, 0, y, TW, y, w, m, sun, { rungs: false });
      for (let x = 12; x < TW - 8; x += rng.int(38, 60)) {
        const kind = rng.int(0, 2);
        if (kind === 0) {                                   // habitat module
          const len = rng.int(12, 20);
          kCyl(r, x, y - 2, len, 2, true, m, sun, { seg: 4 });
          for (let k = 2; k < len - 1; k += 2) if (rng.chance(0.55)) e.set(x + k, y - 1, packHex(rng.chance(0.8) ? '#b08a44' : '#5aa0c0'));
        } else if (kind === 1) {                            // solar wings on a stalk
          const sw = rng.int(7, 10);
          r.vline(x + 3, y - w / 2 - 8, y + w / 2 + 8, mc(m, 3));
          kSolar(r, x + 3 - sw / 2, y - w / 2 - 9, sw, 5, 0.45);
          kSolar(r, x + 3 - sw / 2, y + w / 2 + 4, sw, 5, 0.1);
        } else {                                            // radiator fins
          for (let k = 0; k < 4; k++) r.vline(x + k * 2, y + w / 2 + 1, y + w / 2 + 7, mc(m, k % 2 ? 4 : 3));
        }
        if (rng.chance(0.5)) bl.add(x, y - w / 2 - 1, '#ff5a5a', 2.2, rng.next(), 0.12);
      }
    };
    spine(110, 5);
    spine(468, 4);
    kBall(r, 250, 110, 6, m, sun);
    kCyl(r, 248, 94, 10, 2, false, m, sun, { seg: 3 });
    bl.add(250, 92, '#ffffff', 1.3, 0.2, 0.1);
    for (let k = 0; k < 9; k++) kBox(r, rng.int(10, TW - 10), rng.int(170, 420), rng.int(3, 5), 2, m, sun);
    kTruss(r, 70, 468, 104, 600, 3, m, sun, { rungs: false });
    kBox(r, 96, 598, 14, 7, m, sun, { panels: 3 });
    bl.add(110, 598, '#ff5a5a', 1.9, 0.5, 0.12);
    A.far = banded(outlined(r, pack(12, 26, 42, 160))); A.farE = banded(e); A.farB = bl;
  }
  yield;

  // --- mid layer (f = 0.5): a warship under construction in its dock cradle, fuel depot ---
  {
    const H = 1024, r = new Raster(TW, H, true), e = new Raster(TW, H, true), m = M_MID(), hm = M_HULL(), sun = SUN_UR, hz = M_HAZ();
    const bl = new Blinkers(TW, H), sp = new Sparks(TW, H);
    const cx = 244, y0 = 236, len = 250;
    const half = (u) => u < 0.22 ? 2 + (u / 0.22) * 13 : u < 0.5 ? 15 + (u - 0.22) * 8 : u < 0.56 ? 17 + ((u - 0.5) / 0.06) * 13
      : u < 0.74 ? 30 : u < 0.78 ? 30 - ((u - 0.74) / 0.04) * 12 : u < 0.92 ? 18 : 20;
    // cradle
    kTruss(r, cx - 44, y0 - 30, cx - 44, y0 + len + 24, 6, m, sun, { heavy: true });
    kTruss(r, cx + 44, y0 - 30, cx + 44, y0 + len + 24, 6, m, sun, { heavy: true });
    for (let k = 0; k < 6; k++) {
      const yy = y0 + 6 + k * 48;
      kBeam(r, cx - 44, yy, cx + 44, yy, 2, m, sun);
      e.set(cx - 40, yy - 2, packHex('#ffd966')); e.set(cx + 40, yy - 2, packHex('#ffd966'));
    }
    const plated = (u) => (u > 0.06 && u < 0.3) || (u > 0.5 && u < 0.62) || (u > 0.7 && u < 0.8) || u > 0.88;
    for (let yy = 0; yy < len; yy++) {
      const u = yy / len, hw = Math.round(half(u)), Y = y0 + yy;
      if (plated(u)) {
        for (let xx = -hw; xx <= hw; xx++) {
          const nx = xx / (hw + 0.5), ridge = Math.abs(xx) <= 1 ? 0.35 : 0;
          const panel = (yy % 12 === 0 ? -0.3 : 0) + ((xx + 40) % 7 === 0 ? -0.1 : 0);
          const l = nx * sun[0] * 0.8 + (1 - Math.abs(nx)) * 0.35 + ridge + panel;
          r.set(cx + xx, Y, hm.c[qi(clamp01(0.42 + l * 0.6) * (hm.n - 1), cx + xx, Y, hm.n)]);
        }
        r.set(cx - hw, Y, mc(hm, 1)); r.set(cx + hw, Y, hm.rim);
      } else {
        if (yy % 5 === 0) for (let xx = -hw; xx <= hw; xx++) r.set(cx + xx, Y, mc(m, xx > 0 ? 4 : 2));
        r.set(cx, Y, mc(m, 4)); r.set(cx - 1, Y, mc(m, 1));
        r.set(cx - Math.round(hw * 0.55), Y, mc(m, 2)); r.set(cx + Math.round(hw * 0.55), Y, mc(m, 3));
        r.set(cx - hw, Y, mc(m, 2)); r.set(cx + hw, Y, mc(m, 4));
      }
      if (yy > 0 && plated(u) !== plated((yy - 1) / len)) {
        sp.add(cx + rng.int(-hw + 2, hw - 2), Y, 0, -1, rng.range(0.8, 1.6), rng.next());
        if (rng.chance(0.6)) sp.add(cx + (rng.chance(0.5) ? -hw : hw), Y + 2, rng.sign(), 0.5, rng.range(0.8, 1.6), rng.next());
      }
    }
    // sponson turrets, bridge, engines
    for (const k of [-1, 1]) { kBall(r, cx + k * 22, y0 + len * 0.64, 4, hm, sun); kBeam(r, cx + k * 22, y0 + len * 0.64, cx + k * 22, y0 + len * 0.64 - 9, 1, hm, sun); }
    kBox(r, cx - 5, y0 + len * 0.4, 10, 16, hm, sun, { panels: 4, base: 3 });
    for (let k = 0; k < 3; k++) e.set(cx - 3 + k * 3, y0 + len * 0.4 + 3, packHex('#79ecff'));
    for (let k = -1; k <= 1; k++) kCyl(r, cx + k * 12 - 3, y0 + len, 7, 3, false, hm, sun, { seg: 0 });
    bl.add(cx, y0 - 2, '#ff5a5a', 1.2, 0, 0.18, 2);
    bl.add(cx - 44, y0 - 32, '#ffffff', 2.0, 0.3, 0.1);
    bl.add(cx + 44, y0 - 32, '#ffffff', 2.0, 0.8, 0.1);
    bl.add(cx - 44, y0 + len + 26, '#6fd23f', 1.7, 0.1, 0.15);
    bl.add(cx + 44, y0 + len + 26, '#ff5a5a', 1.7, 0.6, 0.15);
    for (let xx = 0; xx < 88; xx++) for (let yy = 0; yy < 3; yy++) r.set(cx - 44 + xx, y0 + len + 28 + yy, ((xx + yy) >> 2) & 1 ? mc(hz, 2) : mc(hz, 0));
    // fuel depot on the left, on its own truss
    const fx = 70, fy = 690;
    kTruss(r, 12, fy, TW - 12, fy, 6, m, sun);
    kBox(r, 6, fy - 7, 8, 14, m, sun, { base: 3 }); kBox(r, TW - 14, fy - 7, 8, 14, m, sun, { base: 3 });
    for (let k = 0; k < 3; k++) kBall(r, fx - 20 + k * 20, fy - 12, 8, hm, sun);
    for (let k = 0; k < 2; k++) kBall(r, fx - 10 + k * 20, fy + 12, 7, hm, sun);
    kCyl(r, 140, fy - 4, 36, 3, true, m, sun, { seg: 6 });
    for (let k = 0; k < 6; k++) e.set(142 + k * 6, fy - 2, packHex('#ffd966'));
    bl.add(fx - 20, fy - 21, '#ff5a5a', 1.5, 0.35, 0.13);
    bl.add(fx + 20, fy - 21, '#ff5a5a', 1.5, 0.85, 0.13);
    // gantry with a traveling crane
    const gy = 940;
    kTruss(r, 12, gy, TW - 12, gy, 8, m, sun, { heavy: true });
    kBox(r, 5, gy - 9, 10, 18, m, sun, { panels: 4, base: 3 }); kBox(r, TW - 15, gy - 9, 10, 18, m, sun, { panels: 4, base: 3 });
    kBox(r, 110, gy - 7, 18, 14, m, sun, { panels: 5, base: 3 });
    r.line(119, gy + 7, 119, gy + 32, mc(m, 2));
    kBox(r, 113, gy + 32, 12, 7, hz, sun);
    e.set(111, gy - 5, packHex('#ffd966')); e.set(126, gy - 5, packHex('#ffd966'));
    bl.add(119, gy - 8, '#ffab4f', 0.9, 0, 0.35);
    A.mid = banded(outlined(r, pack(4, 6, 12, 220))); A.midE = banded(e); A.midB = bl; A.midS = sp;
  }
  yield;

  // --- near layer (f = 0.9): massive dark girders with warm dawn rims ---
  {
    const H = 1024, r = new Raster(TW, H, true), e = new Raster(TW, H, true), m = M_NEAR(), sun = SUN_UR, hz = M_HAZ();
    const bl = new Blinkers(TW, H);
    // left crane: tower, jib, counter-jib, cab, cable + container
    kTruss(r, 46, 40, 46, 380, 18, m, sun, { heavy: true });
    kTruss(r, 20, 112, 196, 112, 12, m, sun, { heavy: true });
    kBox(r, 14, 100, 16, 24, m, sun, { panels: 4, base: 2 });
    kBox(r, 36, 124, 22, 16, m, sun, { panels: 5, base: 3 });
    for (let k = 0; k < 4; k++) { r.set(39 + k * 4, 129, packHex('#ffd27a')); e.set(39 + k * 4, 129, packHex('#8a6420')); }
    r.line(186, 118, 186, 210, mc(m, 3)); r.line(187, 118, 187, 210, mc(m, 1));
    kBox(r, 170, 210, 34, 18, hz, sun, { panels: 6 });
    for (let yy = 212; yy < 227; yy += 3) r.hline(171, 202, yy, mc(hz, 1));
    bl.add(196, 104, '#ff5a5a', 1.4, 0, 0.14, 2);
    bl.add(46, 36, '#ff5a5a', 1.4, 0.5, 0.14, 2);
    bl.add(20, 104, '#ffffff', 2.1, 0.2, 0.1);
    // right docking arm with a clamp head
    kTruss(r, 310, 640, 214, 704, 14, m, sun, { heavy: true });
    kBox(r, 194, 694, 26, 22, m, sun, { panels: 5, base: 3 });
    kBeam(r, 196, 716, 184, 748, 4, m, sun);
    kBeam(r, 218, 716, 230, 748, 4, m, sun);
    for (let k = 0; k < 5; k++) { const c = packHex(k % 2 ? '#79ecff' : '#ffd966'); r.set(198 + k * 5, 700, c); e.set(198 + k * 5, 700, c); }
    bl.add(184, 750, '#ffffff', 1.1, 0.25, 0.12, 2);
    bl.add(230, 750, '#ffffff', 1.1, 0.75, 0.12, 2);
    kTruss(r, 290, 300, 290, 600, 20, m, sun, { heavy: true });
    bl.add(290, 298, '#ff5a5a', 1.6, 0.2, 0.14, 2);
    // bridge girder crossing the whole screen
    const by = 900;
    kTruss(r, 16, by, TW - 16, by, 22, m, sun, { heavy: true });
    kBox(r, 4, by - 16, 16, 32, m, sun, { panels: 5, base: 2 }); kBox(r, TW - 20, by - 16, 16, 32, m, sun, { panels: 5, base: 2 });
    for (let x = 20; x < TW - 20; x += 40) {
      r.set(x + 6, by - 12, packHex('#ffd27a')); e.set(x + 6, by - 12, packHex('#8a6420'));
      bl.add(x + 26, by + 12, '#ff5a5a', 2.4, x / TW, 0.1);
    }
    for (let xx = 18; xx < TW - 18; xx++) for (let yy = 0; yy < 3; yy++) r.set(xx, by + 12 + yy, ((xx + yy) >> 2) & 1 ? mc(hz, 2) : mc(hz, 0));
    A.near = banded(outlined(r, pack(2, 2, 6, 235))); A.nearE = banded(e); A.nearB = bl;
  }
  A.stars = starTile(rng, TW, 320, 500, { maxB: 0.8, pow: 2.2, big: 0.05, raster: true });
  A.tw = new Twinkles(rng, 30, TW, 400, 0.02, { bigChance: 0.3 });
  return A;
}

const PAL_AURORA_SKY = [...RAMPS.void, ...RAMPS.ocean, ...RAMPS.dawn, ...RAMPS.sapphire.slice(0, 5), '#27c2ea', '#79ecff', '#d6fcff', '#ffffff', '#fff5c9', '#ffd966', '#081a33', '#0d2342', '#13294f', '#1b3a66'];

class AuroraStage extends Stage {
  wide() { return { surf: (tw) => auroraSurface(tw), clouds: (tw) => auroraClouds(tw) }; }
  constructor(A) {
    super('aurora', A);
    this.scrollSpeed = 28;
    this.grade = { tint: [0.98, 1.0, 1.04], lift: [0.0, 0.008, 0.024], sat: 1.08, contrast: 1.06 };
    this.q = new Quant(PAL_AURORA_SKY);
  }
  layout() {
    const W = this.W, H = this.LH, S = this.S, q = this.q;
    prof();
    const portrait = H >= W * 1.2;
    // limb passes through (0, ya) and (W, yb); planet centre lower-left
    const ya = H * (portrait ? 0.07 : 0.1), yb = H * (portrait ? 0.3 : 0.52);
    const R = portrait ? H * 1.25 : W * 1.1;
    const chx = W, chy = yb - ya, cl = Math.hypot(chx, chy);
    const mx = W / 2, my = (ya + yb) / 2, dist = Math.sqrt(Math.max(0, R * R - (cl / 2) ** 2));
    const pcx = mx + (-chy / cl) * dist, pcy = my + (chx / cl) * dist;
    let L = [0.62, -0.62, -0.42]; const ll = Math.hypot(...L); L = L.map((v) => v / ll);
    const s2l = Math.hypot(L[0], L[1]), s2x = L[0] / s2l, s2y = L[1] / s2l;
    this.limb = new Int16Array(W);
    for (let x = 0; x < W; x++) { const dx = x + 0.5 - pcx; this.limb[x] = Math.abs(dx) < R ? Math.floor(pcy - Math.sqrt(R * R - dx * dx)) : H; }
    // sun just above the limb near the right edge
    const sx = W * (portrait ? 0.86 : 0.8), sy = this.limb[Math.min(W - 1, Math.round(sx))] - (portrait ? 10 : 14);
    this.sun = [Math.round(sx), Math.round(sy)];
    const sky = new Raster(W, H), lm = new Raster(W, H), hz = new Raster(W, H), nm = new Raster(W, H), em = new Raster(W, H);
    const LM = [[26, 36, 78], [46, 56, 104], [110, 88, 122], [188, 140, 134], [210, 196, 196], [218, 222, 236]];
    const gk = 1 / (Math.max(W, H) * 0.35);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const dx = (x + 0.5 - pcx) / R, dy = (y + 0.5 - pcy) / R, d2 = dx * dx + dy * dy;
      const sdx = x - sx, sdy = (y - sy) * 1.6, sd = Math.sqrt(sdx * sdx + sdy * sdy);
      const g1 = Math.exp(-sd * gk), g2 = Math.exp(-sd * 0.12);
      if (d2 >= 1) {
        const d = Math.sqrt(d2), h = (d - 1) * R, ux = dx / d, uy = dy / d, sdot = Math.max(0, ux * s2x + uy * s2y);
        const s2 = sdot * sdot, rim = 0.3 + 0.7 * sdot * Math.sqrt(sdot), warm = s2 * s2 * sdot;
        const a1 = Math.exp(-h / 1.7) * rim, a2 = Math.exp(-h / 8) * rim * 0.55, a3 = Math.exp(-h / 38) * rim * 0.28;
        let r = 4 + 70 * g1 + 180 * g2, g = 4 + 36 * g1 + 150 * g2, b = 14 + 40 * g1 + 110 * g2;
        r += (50 + 180 * warm) * a1 + (20 + 120 * warm) * a2 + 14 * a3;
        g += (160 + 60 * warm) * a1 + (100 + 40 * warm) * a2 + 40 * a3;
        b += (255 - 90 * warm) * a1 + (230 - 110 * warm) * a2 + 100 * a3;
        sky.d[i] = q.dq(r, g, b, x, y, 18);
        if (a1 > 0.08) em.d[i] = pack(r * 0.22 * a1, g * 0.22 * a1, b * 0.22 * a1);
        lm.d[i] = 0xffffffff;
        continue;
      }
      // inside the disc: light map (multiply), haze (add), night mask (multiply for city lights)
      const nz = Math.sqrt(1 - d2), ndl = dx * L[0] + dy * L[1] + nz * L[2];
      const v = clamp(smooth(-0.1, 0.5, ndl) * 5, 0, 5);
      const k = qi(v, x, y, 6);
      const c = LM[k];
      lm.d[i] = pack(c[0], c[1], c[2]);
      const d = Math.sqrt(d2), ux = dx / d, uy = dy / d, sdot = Math.max(0, ux * s2x + uy * s2y);
      const inz = 1 - nz, limbF = inz * inz * inz * (0.2 + 0.8 * sdot);
      const hv = clamp01(limbF * 1.3 + g2 * 0.9 + g1 * 0.15);
      if (hv > 0.03) {
        const s2 = sdot * sdot, hk = qi(hv * 5, x, y, 6) / 5, warm = s2 * s2 * s2 * 0.8 + g2;
        hz.d[i] = pack((40 + 180 * warm) * hk, (110 + 50 * warm) * hk, (200 - 60 * warm) * hk);
      }
      const night = 1 - smooth(-0.06, 0.12, ndl);
      const nk = qi(night * 3, x, y, 4) / 3;
      nm.d[i] = pack(255 * nk, 255 * nk, 255 * nk);
    }
    // bright 1 px limb line on the lit side
    for (let x = 0; x < W; x++) {
      const y = this.limb[x]; if (y < 0 || y >= H) continue;
      const dx = (x + 0.5 - pcx) / R, dy = (y + 0.5 - pcy) / R, d = Math.hypot(dx, dy);
      const sdot = Math.max(0, (dx / d) * s2x + (dy / d) * s2y);
      if (sdot > 0.2) { const kk = smooth(0.2, 1, sdot); sky.set(x, y, q.dq(130 + 120 * kk, 200 + 50 * kk, 255, x, y, 24)); em.add(x, y, 60 * kk, 80 * kk, 90 * kk); }
    }
    // sky is transparent inside the disc; far stars are baked into the sky (they barely move)
    const st = this.A.stars, ax = this.ax;
    const sx0 = mod(-ax, st.w);
    for (let y = 0; y < H; y++) for (let x = 0, sx = sx0; x < W; x++, sx = sx + 1 === st.w ? 0 : sx + 1) {
      const i = y * W + x;
      if (y > this.limb[x]) { sky.d[i] = 0; continue; }
      if (y >= this.limb[x] - 1) continue;
      const s = st.d[(y % st.h) * st.w + sx];
      if (s & 0xffffff) { const p = sky.d[i]; sky.d[i] = pack(Math.min(255, unR(p) + unR(s)), Math.min(255, unG(p) + unG(s)), Math.min(255, unB(p) + unB(s))); }
    }
    prof('aurora pixels');
    S.sky = banded(sky); S.lm = lm.toCanvas(); S.haze = banded(hz); S.nm = nm.toCanvas(); S.em = banded(em);
    // city-light composite
    S.lc = makeCanvas(W, H); this.lcx = ctx2d(S.lc);
    S.flare = flareSprite(portrait ? 61 : 81, FLARE_RAMP, { rays: 4, rot: 0.2 });
    S.streak = streakSprite(Math.round(W * 1.2), STREAK_RAMP, W * 0.2);
    prof('aurora canvases');
  }
  render(ctx, lctx, scrollY, t) {
    const { W, H, S, A } = this;
    if (!S.sky) return;
    const lop = lctx.globalCompositeOperation;
    const ax = this.ax;
    // planet surface + clouds, lit by a multiply light map, hazed at the limb
    this.tile(ctx, this.L('surf'), Math.round(scrollY * 0.045));
    this.tile(ctx, this.L('clouds'), Math.round(scrollY * 0.07), 0, Math.round(t * 0.6));
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(S.lm, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    blit(ctx, S.haze, 0, 0);
    // city lights masked to the night side
    const lc = this.lcx;
    lc.globalCompositeOperation = 'source-over';
    this.tile(lc, this.L('lights'), Math.round(scrollY * 0.045));
    lc.globalCompositeOperation = 'multiply';
    lc.drawImage(S.nm, 0, 0);
    ctx.drawImage(S.lc, 0, 0);
    lctx.globalCompositeOperation = 'lighter';
    lctx.globalAlpha = 0.7; lctx.drawImage(S.lc, 0, 0);
    // space above the limb
    ctx.globalCompositeOperation = 'source-over';
    blit(ctx, S.sky, 0, 0);
    A.tw.draw(ctx, lctx, ax, 0, W, H, t, 1, this.limb);
    lctx.globalAlpha = 1; blit(lctx, S.em, 0, 0);
    // sun
    const [sx, sy] = this.sun;
    const br = 0.9 + 0.1 * Math.sin(t * 0.9) + this.flashT * 0.9;
    if (this.flashT > 0) { lctx.globalAlpha = this.flashT * this.flashT * 0.18; lctx.fillStyle = '#ffd49a'; lctx.fillRect(0, 0, W, H); lctx.globalAlpha = 1; }
    ctx.globalCompositeOperation = 'lighter';
    const sxo = sx - (S.flare.width >> 1), syo = sy - (S.flare.height >> 1);
    ctx.globalAlpha = clamp01(br); ctx.drawImage(S.flare, sxo, syo);
    if (br > 1) { ctx.globalAlpha = clamp01(br - 1); ctx.drawImage(S.flare, sxo, syo); }
    ctx.globalAlpha = clamp01(0.45 * br); ctx.drawImage(S.streak, sx - (S.streak.width >> 1), sy - 2);
    lctx.globalAlpha = clamp01(0.7 * br); lctx.drawImage(S.flare, sxo, syo);
    lctx.globalAlpha = clamp01(0.3 * br); lctx.drawImage(S.streak, sx - (S.streak.width >> 1), sy - 2);
    ctx.globalAlpha = 1; lctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // station layers
    // [image, emissive, blinkers, sparks, parallax, light alpha, column shift]
    const layers = this.layers || (this.layers = [[A.far, A.farE, A.farB, null, 0.2, 0.55, 0], [A.mid, A.midE, A.midB, A.midS, 0.5, 0.8, 0.37], [A.near, A.nearE, A.nearB, null, 0.9, 1, 0.61]]);
    for (let i = 0; i < 3; i++) {
      const [img, em, bl, sp, f, ea, sh] = layers[i];
      const oy = Math.round(scrollY * f);
      drawTiled(ctx, img, ax, oy, W, H, sh);
      ctx.globalCompositeOperation = 'lighter';
      drawTiled(ctx, em, ax, oy, W, H, sh);
      ctx.globalCompositeOperation = 'source-over';
      lctx.globalAlpha = ea; drawTiled(lctx, em, ax, oy, W, H, sh); lctx.globalAlpha = 1;
      bl.draw(ctx, lctx, ax, oy, W, H, t, sh);
      if (sp) sp.draw(ctx, lctx, ax, oy, W, H, t, sh);
    }
    lctx.globalCompositeOperation = lop;
  }
}

// ---------------------------------------------------------------------------
// Asteroids (shared by Cinder and others)
// ---------------------------------------------------------------------------

// 2D value noise (non-periodic) for small surface detail
const vn2 = (x, y, s) => vnoise3(x, y, 0.5, s);

// Shaded asteroid. M: material (dark->light); L3: [lx, ly, lz] toward the light.
// e (optional): emissive raster for molten cracks.
function kRock(r, e, cx, cy, rad, rng, M, L3, { cracks = 0, craters = 3, rim = null, squash = 1, rot = 0, crackRamp = null, seed = 1 } = {}) {
  const K = 5, amps = [], phs = [];
  for (let k = 0; k < K; k++) { amps.push(rng.range(0.03, 0.16) / (1 + k * 0.6)); phs.push(rng.range(0, TAU)); }
  const cr = [];
  for (let i = 0; i < craters; i++) { const a = rng.range(0, TAU), d = rng.range(0, 0.65); cr.push([Math.cos(a) * d * rad, Math.sin(a) * d * rad, rng.range(0.12, 0.3) * rad]); }
  const bb = Math.ceil(rad * 1.5), cs = Math.cos(rot), sn = Math.sin(rot);
  const rimC = rim ? packHex(rim) : M.rim;
  const CR = crackRamp ? crackRamp.map(hexToRgb) : null;
  const lx = L3[0], ly = L3[1], lz = L3[2];
  for (let y = -bb; y <= bb; y++) for (let x = -bb; x <= bb; x++) {
    const X = (x * cs + y * sn) / squash, Y = -x * sn + y * cs;
    const ang = Math.atan2(Y, X);
    let rr = rad;
    for (let k = 0; k < K; k++) rr *= 1 + amps[k] * Math.sin((k + 2) * ang + phs[k]);
    const d = Math.sqrt(X * X + Y * Y) / rr;
    if (d > 1) continue;
    const px = cx + x, py = cy + y;
    let nx = x / rr, ny = y / rr, nz = Math.sqrt(Math.max(0.02, 1 - d * d));
    // surface bumps
    const s1 = 0.22, n0 = vn2(px * s1, py * s1, seed);
    nx += (vn2((px + 1) * s1, py * s1, seed) - n0) * 2.2; ny += (vn2(px * s1, (py + 1) * s1, seed) - n0) * 2.2;
    let cav = 0;
    for (let i = 0; i < cr.length; i++) {
      const c = cr[i], ddx = x - c[0], ddy = y - c[1], dd = Math.sqrt(ddx * ddx + ddy * ddy) / c[2];
      if (dd < 1) { nx -= (ddx / c[2]) * 0.9; ny -= (ddy / c[2]) * 0.9; cav = Math.max(cav, 1 - dd); }
      else if (dd < 1.3) { nx += (ddx / c[2]) * 0.35; ny += (ddy / c[2]) * 0.35; }
    }
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
    const l = (nx * lx + ny * ly + nz * lz) / nl;
    let v = (0.1 + Math.max(0, l) * 0.95 - cav * 0.15) * (M.n - 1);
    v += (vn2(px * 0.6, py * 0.6, seed + 7) - 0.5) * 0.9;
    let c = M.c[qi(clamp(v, 0, M.n - 1), px, py, M.n)];
    // rim light on the lit edge
    if (d > 0.82 && (x * lx + y * ly) / (Math.sqrt(x * x + y * y) + 0.01) > 0.45) c = d > 0.92 ? rimC : M.c[M.n - 1];
    r.set(px, py, c);
    // molten cracks
    if (cracks && CR && d < 0.88) {
      const rv = 1 - Math.abs(vnoise3(px * 0.09, py * 0.09, 3.3, seed + 11) * 2 - 1);
      const rv2 = 1 - Math.abs(vnoise3(px * 0.2, py * 0.2, 1.7, seed + 13) * 2 - 1);
      const k = rv * 0.78 + rv2 * 0.3;
      const th = 1.045 - cracks * 0.035;
      if (k > th) {
        const heat = clamp((k - th) * 40 + 0.5, 0, CR.length - 1);
        const ci = qi(heat, px, py, CR.length), col = CR[ci];
        r.set(px, py, pack(col[0], col[1], col[2]));
        if (e) e.set(px, py, pack(col[0] * 0.8, col[1] * 0.7, col[2] * 0.6));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// CINDER (S2) — asteroid mining belt near the red giant Hadar
// ---------------------------------------------------------------------------

const PAL_CINDER = [...RAMPS.void.slice(0, 5), '#1a1030', '#140c26', '#0e0a1c', ...RAMPS.ember, ...RAMPS.fire, ...RAMPS.dawn.slice(0, 6), ...RAMPS.rust, ...RAMPS.smoke.slice(0, 4),
  '#1e0808', '#2e0c0a', '#420f0c', '#5a140e', '#12060a', '#1a0a10', '#240c12'];
const ROCK_RAMP = ['#0a0506', '#140a0a', '#20110f', '#2f1914', '#42231a', '#5a3021', '#77432b', '#9c5c38'];
const CRACK_RAMP = ['#5a1206', '#9a2a08', '#d4470f', '#f7811e', '#fdbb3a', '#fff0a8'];
const L_CINDER = (() => { const v = [-0.62, -0.58, 0.52], l = Math.hypot(...v); return v.map((a) => a / l); })();

// Cinder dust lanes: dark absorbing filaments with faint sun-lit edges (alpha tile).
function cinderDust(tw, h, cell, bias, alphaMax, seed) {
  const f = new Fbm(new Rng(seed + tw), tw, h * 2, cell, 4, 0.5);
  const r = new Raster(tw, h, true);
  const D = [[26, 8, 8], [40, 14, 11], [58, 22, 14]];
  const E = hexToRgb('#7d2a12');
  const val = new Float32Array(tw * h);
  for (let y = 0; y < h; y += 2) for (let x = 0; x < tw; x += 2) { const v = f.at(x, y * 2); val[y * tw + x] = v; val[y * tw + x + 1] = v; val[(y + 1) * tw + x] = v; val[(y + 1) * tw + x + 1] = v; }
  for (let y = 0; y < h; y++) for (let x = 0; x < tw; x++) {
    const v = val[y * tw + x];
    const dns = clamp01((v - bias) * 3);
    if (dns <= 0) continue;
    const a = qi(dns * 3, x, y, 4) / 3 * alphaMax;
    if (a <= 0) continue;
    const up = val[wr(y - 4, h) * tw + wr(x - 4, tw)];
    const edge = dns < 0.34 && up < bias && bay(x, y) < 0.5;
    const c = edge ? E : D[Math.min(2, (dns * 3) | 0)];
    r.d[y * tw + x] = pack(c[0], c[1], c[2], (edge ? 0.6 : a) * 255);
  }
  return r.toCanvas();
}
const cinderDust1 = (tw) => cinderDust(tw, 640, 220, 0.5, 0.6, 0xd1);
const cinderDust2 = (tw) => cinderDust(tw, 768, 170, 0.56, 0.7, 0xd2);

function* genCinder() {
  const rng = new Rng(0xc1de5);
  const A = {};
  A.dust1 = cinderDust1(TW);
  yield;
  A.dust2 = cinderDust2(TW);
  yield;
  const M = mat(ROCK_RAMP, '#ff8a4a');
  // --- far rocks (f = 0.2): a dense scatter of small bodies ---
  {
    const H = 640, r = new Raster(TW, H, true), e = new Raster(TW, H, true);
    for (let i = 0; i < 110; i++) {
      const rad = rng.chance(0.15) ? rng.range(5, 9) : rng.range(1.6, 4.5);
      // concentrate the belt in a diagonal band (periodic in the tile)
      const y = rng.int(0, H), x0 = rng.int(0, TW);
      if (rng.next() > 0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.cos(((x0 / TW) - (y / H)) * TAU), 3)) continue;
      kRock(r, e, clamp(x0, rad * 1.5 + 2, TW - rad * 1.5 - 2), y, rad, rng, M, L_CINDER, { craters: rad > 5 ? 2 : 0, cracks: rng.chance(0.2) ? 1 : 0, crackRamp: CRACK_RAMP, rot: rng.range(0, TAU), squash: rng.range(0.7, 1.3), seed: i });
    }
    A.rocksFar = banded(outlined(r, pack(6, 2, 3, 200))); A.rocksFarE = banded(e);
  }
  yield;
  // --- mid rocks (f = 0.45): big asteroids with molten cracks and mining rigs ---
  {
    const H = 1024, r = new Raster(TW, H, true), e = new Raster(TW, H, true), las = new Raster(TW, H, true);
    const bl = new Blinkers(TW, H), sp = new Sparks(TW, H);
    const big = [[70, 150, 34], [258, 420, 40], [96, 640, 26], [226, 850, 30], [292, 150, 14], [24, 420, 12], [150, 236, 10], [150, 560, 9], [34, 870, 13], [170, 980, 8]];
    big.forEach(([x, y, rad], i) => kRock(r, e, x, y, rad, rng, M, L_CINDER, { craters: rad > 20 ? 5 : 2, cracks: rad > 20 ? 2 : 1, crackRamp: CRACK_RAMP, rot: rng.range(0, TAU), squash: rng.range(0.8, 1.2), seed: 100 + i }));
    // mining rigs
    const steel = mat(['#0f0d12', '#1c1820', '#2c2630', '#403744', '#5a4d5c', '#7a6a78'], '#ffb27a'), hz = M_HAZ();
    const sunR = [-0.7, -0.7];
    const rig = (x, y, flip) => {
      const s = flip ? -1 : 1;
      kBox(r, x - 9, y - 6, 18, 12, steel, sunR, { panels: 4, base: 3 });
      kBox(r, x - 5, y - 11, 10, 5, steel, sunR, { base: 3 });
      for (let k = 0; k < 3; k++) e.set(x - 6 + k * 4, y - 3, packHex('#ffd966'));
      for (let k = 0; k < 18; k++) r.set(x - 9 + k, y + 6, ((k >> 1) & 1) ? mc(hz, 3) : mc(hz, 0));
      kTruss(r, x + s * 9, y, x + s * 30, y + 14, 4, steel, sunR);
      kBox(r, x + s * 30 - 3, y + 12, 6, 6, hz, sunR);
      sp.add(x + s * 30, y + 18, s * 0.3, 1, rng.range(0.9, 1.5), rng.next());
      bl.add(x - 9, y - 7, '#ff5a5a', 1.3, rng.next(), 0.15, 2);
      bl.add(x + 9, y - 7, '#ffab4f', 0.8, rng.next(), 0.3);
      // tether pipes
      r.line(x - s * 9, y + 2, x - s * 22, y + 10, mc(steel, 2)); r.line(x - s * 9, y + 3, x - s * 22, y + 11, mc(steel, 1));
    };
    rig(70, 120, false);
    rig(226, 830, false);
    // refinery station built into the biggest rock: tank farm, stack venting fire, landing pad
    {
      const x = 252, y = 408;
      kBox(r, x - 30, y - 16, 34, 22, steel, sunR, { panels: 5, base: 3 });
      kBox(r, x - 22, y - 26, 14, 10, steel, sunR, { panels: 4, base: 3 });
      for (let k = 0; k < 3; k++) kBall(r, x + 12 + k * 9, y - 10, 4, steel, sunR);
      kCyl(r, x - 6, y - 40, 22, 3, false, steel, sunR, { seg: 5 });
      for (let k = 0; k < 5; k++) { r.set(x - 27 + k * 6, y - 8, packHex('#ffd966')); e.set(x - 27 + k * 6, y - 8, packHex('#b08a30')); }
      // flare stack flame
      const FL = ['#8f260b', '#d4470f', '#f7811e', '#fdbb3a', '#fff0a8'].map(hexToRgb);
      for (let k = 0; k < 7; k++) for (let j = -1; j <= 1; j++) {
        const c = FL[clamp(4 - k + (j ? -1 : 0), 0, 4)];
        r.set(x - 3 + j, y - 42 - k, pack(c[0], c[1], c[2])); e.set(x - 3 + j, y - 42 - k, pack(c[0], c[1], c[2]));
      }
      // landing pad with lights
      for (let a = 0; a < TAU; a += 0.05) r.set(x - 36 + Math.cos(a) * 9, y + 20 + Math.sin(a) * 9, mc(hz, 3));
      kBox(r, x - 43, y + 17, 14, 6, steel, sunR, { base: 2 });
      bl.add(x - 45, y + 20, '#79ecff', 1.2, 0, 0.3); bl.add(x - 27, y + 20, '#79ecff', 1.2, 0.5, 0.3);
      bl.add(x - 30, y - 18, '#ff5a5a', 1.5, 0.2, 0.14, 2);
      sp.add(x + 30, y + 4, 1, 0.4, 1.3, 0.3);
    }
    // mining laser beams (drawn per frame with flicker)
    const beam = (x0, y0, x1, y1) => {
      const hot = packHex('#fff0a8'), mid = packHex('#f7811e'), dk = packHex('#8f260b');
      const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
      r.line(x0 + nx, y0 + ny, x1 + nx, y1 + ny, 0); // no-op keeps signature symmetrical
      las.line(x0 + nx, y0 + ny, x1 + nx, y1 + ny, dk); las.line(x0 - nx, y0 - ny, x1 - nx, y1 - ny, dk);
      las.line(x0 + nx * 0.5, y0 + ny * 0.5, x1 + nx * 0.5, y1 + ny * 0.5, mid);
      las.line(x0, y0, x1, y1, hot);
      sp.add(x1, y1, -dx / len, -dy / len, 2.2, rng.next());
    };
    beam(100, 138, 146, 228);
    beam(226, 842, 170, 972);
    // ore haulers on a short tether between neighbouring rocks
    r.line(150, 560, 96, 626, mc(steel, 1));
    for (let k = 1; k < 4; k++) { const u = k / 4; kBox(r, lerp(150, 96, u) - 2, lerp(560, 626, u) - 1, 4, 3, hz, sunR, { base: 2 }); }
    A.rocksMid = banded(outlined(r, pack(5, 2, 2, 220))); A.rocksMidE = banded(e); A.laser = banded(las);
    A.midB = bl; A.midS = sp;
  }
  yield;
  // --- near rocks (f = 0.9): dark silhouettes at the sides with hot rims ---
  {
    const H = 1024, r = new Raster(TW, H, true), e = new Raster(TW, H, true);
    const dark = mat(['#030102', '#060304', '#0b0506', '#120809', '#1b0c0c', '#281210'], '#c4400f');
    const L2 = [-0.75, -0.55, 0.36];
    [[40, 200, 30], [292, 520, 26], [36, 760, 22], [296, 950, 16], [150, 60, 7]].forEach(([x, y, rad], i) =>
      kRock(r, e, x, y, rad, rng, dark, L2, { craters: 3, cracks: i < 2 ? 1 : 0, crackRamp: CRACK_RAMP, rot: rng.range(0, TAU), seed: 200 + i }));
    A.rocksNear = banded(outlined(r, pack(2, 0, 0, 230))); A.rocksNearE = banded(e);
  }
  A.tw = new Twinkles(rng, 22, TW, 480, 0.02, { cols: ['#ffd29c', '#ffe6c4', '#f4f4ff', '#ffb98e'], bigChance: 0.2 });
  // drifting embers (free-running)
  const N = 46;
  A.emb = { n: N, x: new Float32Array(N), y: new Float32Array(N), vx: new Float32Array(N), vy: new Float32Array(N), ph: new Float32Array(N) };
  for (let i = 0; i < N; i++) { A.emb.x[i] = rng.range(0, 800); A.emb.y[i] = rng.range(0, 600); A.emb.vx[i] = rng.range(4, 14); A.emb.vy[i] = rng.range(6, 18); A.emb.ph[i] = rng.range(0, TAU); }
  return A;
}

class CinderStage extends Stage {
  wide() { return { dust1: cinderDust1, dust2: cinderDust2 }; }
  constructor(A) {
    super('cinder', A);
    this.scrollSpeed = 32;
    this.grade = { tint: [1.06, 0.97, 0.92], lift: [0.03, 0.006, 0.0], sat: 1.12, contrast: 1.1 };
    this.q = new Quant(PAL_CINDER);
    this.emb = { x: Float32Array.from(A.emb.x), y: Float32Array.from(A.emb.y) };
  }
  layout() {
    const W = this.W, H = this.LH, S = this.S, q = this.q;
    prof();
    const portrait = H >= W * 1.2;
    const R = Math.round(portrait ? W * 0.62 : H * 0.62);
    const cx = portrait ? -W * 0.18 : this.fx - R * 0.72, cy = portrait ? H * 0.1 : H * 0.3;
    this.sunC = [cx, cy, R];
    const sky = new Raster(W, H), em = new Raster(W, H);
    // sun surface: two granulation phases, crossfaded for a boiling look
    const bx0 = 0, by0 = 0, bw = Math.min(W, Math.ceil(cx + R + 2)), bh = Math.min(H, Math.ceil(cy + R + 2));
    const discs = [new Raster(Math.max(1, bw), Math.max(1, bh)), new Raster(Math.max(1, bw), Math.max(1, bh))];
    const SUN = ['#2a0806', '#4a0f08', '#6e1a0a', '#932a0c', '#b83d10', '#d75a18', '#ee7d26', '#fca443', '#ffd07a'].map(hexToRgb);
    const worley = (u, v, s) => {
      const iu = Math.floor(u), iv = Math.floor(v);
      let f1 = 9, f2 = 9;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const px = iu + i + hash3(iu + i, iv + j, 1, s), py = iv + j + hash3(iu + i, iv + j, 2, s);
        const d = (px - u) ** 2 + (py - v) ** 2;
        if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
      }
      return Math.sqrt(f2) - Math.sqrt(f1);
    };
    // surface noise on a 2 px grid (bilinear); dithering supplies per-pixel texture
    const sn = coarseGrid(0, 0, bw, bh, 2, 6, (x, y, o) => {
      let dx = (x - cx) / R, dy = (y - cy) / R; const dd = Math.sqrt(dx * dx + dy * dy);
      if (dd > 0.999) { dx *= 0.999 / dd; dy *= 0.999 / dd; }
      const nz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
      const lon = Math.atan2(dx, nz), lat = Math.asin(clamp(dy, -1, 1));
      o[0] = smooth(0.66, 0.72, fbm3(dx * 2.5, dy * 2.5, nz * 2.5, 3, 91));
      o[1] = fbm3(dx * 3, dy * 3, nz * 3, 3, 17);
      for (let k = 0; k < 2; k++) {
        o[2 + k] = smooth(0.0, 0.6, worley(lon * 16 + k * 0.37, lat * 16 + k * 0.21, 5 + k));
        o[4 + k] = vnoise3(dx * 38 + k * 3.1, dy * 38, nz * 38, 23 + k);
      }
    });
    const nv = new Float32Array(6);
    for (let y = by0; y < bh; y++) for (let x = bx0; x < bw; x++) {
      const dx = (x + 0.5 - cx) / R, dy = (y + 0.5 - cy) / R, d2 = dx * dx + dy * dy;
      if (d2 >= 1) continue;
      const nz = Math.sqrt(1 - d2), limbD = 0.28 + 0.72 * Math.sqrt(nz);
      sn.get(x, y, nv);
      for (let k = 0; k < 2; k++) {
        const I = limbD * (0.86 + 0.14 * nv[2 + k]) * (0.72 + nv[1] * 0.5) * (0.9 + nv[4 + k] * 0.2) * (1 - nv[0] * 0.5);
        const c = SUN[qi(clamp(I * 6.5 - 0.2, 0, 8), x, y, 9)];
        discs[k].d[y * bw + x] = pack(c[0], c[1], c[2]);
      }
    }
    // sky: deep maroon glow near the sun, black-violet far away; corona + stars
    const cor = hexToRgb('#ff6a2a');
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.sqrt(dx * dx + dy * dy), h = d - R;
      const i = y * W + x;
      if (h < 0) { sky.d[i] = q.dq(40, 8, 6, x, y, 10); continue; }
      const g1 = Math.exp(-h / (R * 1.6)), g2 = Math.exp(-h / (R * 0.18)), g3 = Math.exp(-h / 4);
      const ang = Math.atan2(dy, dx);
      const streak = 0.75 + 0.25 * Math.sin(ang * 23 + Math.sin(ang * 7) * 2) * Math.sin(ang * 11 + 1);
      let r = 6 + 64 * g1 + 150 * g2 * streak + 200 * g3, g = 3 + 10 * g1 + 44 * g2 * streak + 90 * g3, b = 8 + 8 * g1 + 16 * g2 + 30 * g3;
      // cold violet far from the sun
      b += 22 * (1 - g1) * (1 - g1); r += 6 * (1 - g1);
      sky.d[i] = q.dq(r, g, b, x, y, 16);
      if (g2 > 0.2) em.d[i] = pack(cor[0] * g2 * 0.22 * streak, cor[1] * g2 * 0.18, cor[2] * g2 * 0.1);
    }
    // baked stars away from the glare
    const srng = new Rng(77);
    for (let k = 0; k < W * H * 0.004; k++) {
      const x = srng.int(0, W - 1), y = srng.int(0, H - 1), d = Math.hypot(x - cx, y - cy) - R;
      if (d < R * 0.5 || srng.next() > smooth(R * 0.5, R * 2.2, d)) continue;
      const c = hexToRgb(srng.pick(['#ffd29c', '#ffe6c4', '#ffb98e', '#d4dcff'])), b = qLevel(0.6 * srng.next() ** 2);
      sky.add(x, y, c[0] * b, c[1] * b, c[2] * b);
    }
    // prominences: glowing loops standing on the limb (emissive)
    const pr = new Raster(W, H);
    const PR = ['#5a1206', '#9a2a08', '#d4470f', '#f7811e', '#fdbb3a'].map(hexToRgb);
    const angs = portrait ? [0.25, 0.75, 1.25] : [-0.9, -0.3, 0.4, 0.9];
    for (const a0 of angs) {
      const span = srng.range(0.1, 0.18), hgt = R * srng.range(0.1, 0.18), lean = srng.range(-0.3, 0.3);
      for (let st = 0; st < 4; st++) {
        const hs = 0.7 + st * 0.12, sp = span * (0.8 + st * 0.08);
        for (let s = 0; s <= 1; s += 0.003) {
          const a = a0 - sp / 2 + sp * s + lean * Math.sin(s * Math.PI) * 0.05;
          const lift = Math.sin(s * Math.PI) * hgt * hs;
          const rr = R - 1 + lift;
          const x = Math.round(cx + Math.cos(a) * rr), y = Math.round(cy + Math.sin(a) * rr);
          const k = clamp(3.6 - st * 0.7 - (lift / hgt) * 1.2 + (vn2(s * 40, st, 9) - 0.5) * 1.4, 0, 4), c = PR[qi(k, x, y, 5)];
          const p = pr.get(x, y);
          if (!p || unR(p) < c[0]) pr.set(x, y, pack(c[0], c[1], c[2]));
        }
      }
    }
    prof('cinder pixels');
    S.sky = sky.toCanvas(); S.em = banded(em); S.sun0 = discs[0].toCanvas(); S.sun1 = discs[1].toCanvas(); S.prom = banded(pr);
    S.glow = glowSprite(Math.round(R * 2.8), Math.round(R * 2.8), ['#000000', '#1a0604', '#300a06', '#4a1208', '#6a1c0a'], (dx, dy) => {
      const d = Math.hypot(dx, dy) / R; if (d < 1) return 1; const u = Math.max(0, 1 - (d - 1) / 0.4); return u * u * 0.9;
    });
    prof('cinder canvases');
  }
  step(dt) {
    const e = this.emb, A = this.A.emb, W = Math.max(this.W, 1) + 40, H = Math.max(this.H, 1) + 40;
    for (let i = 0; i < A.n; i++) {
      e.x[i] += A.vx[i] * dt; e.y[i] += A.vy[i] * dt;
      if (e.x[i] > W) e.x[i] -= W; if (e.y[i] > H) e.y[i] -= H;
    }
  }
  render(ctx, lctx, scrollY, t) {
    const { W, H, S, A } = this;
    if (!S.sky) return;
    const lop = lctx.globalCompositeOperation;
    const ax = this.ax, [cx, cy] = this.sunC;
    ctx.drawImage(S.sky, 0, 0);
    // boiling sun: crossfade two granulation phases
    const k = 0.5 + 0.5 * Math.sin(t * 0.35);
    ctx.drawImage(S.sun0, 0, 0);
    ctx.globalAlpha = k; ctx.drawImage(S.sun1, 0, 0); ctx.globalAlpha = 1;
    const fl = this.flashT;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp01(0.75 + 0.25 * Math.sin(t * 1.3) + fl);
    blit(ctx, S.prom, 0, 0);
    const gx = Math.round(cx - S.glow.width / 2), gy = Math.round(cy - S.glow.height / 2);
    if (fl > 0) { ctx.globalAlpha = fl * 0.8; ctx.drawImage(S.glow, gx, gy); }
    ctx.globalAlpha = 1;
    lctx.globalCompositeOperation = 'lighter';
    lctx.globalAlpha = clamp01(0.55 + fl * 0.6); lctx.drawImage(S.glow, gx, gy);
    lctx.globalAlpha = 0.9; blit(lctx, S.prom, 0, 0);
    lctx.globalAlpha = 1; blit(lctx, S.em, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    A.tw.draw(ctx, lctx, ax, Math.round(scrollY * 0.02), W, H, t, 0.8);
    // dust lanes
    this.tile(ctx, this.L('dust1'), Math.round(scrollY * 0.06));
    drawTiled(ctx, A.rocksFar, ax, Math.round(scrollY * 0.2), W, H, 0.41);
    lctx.globalAlpha = 0.7; drawTiled(lctx, A.rocksFarE, ax, Math.round(scrollY * 0.2), W, H, 0.41);
    this.tile(ctx, this.L('dust2'), Math.round(scrollY * 0.3));
    // mid rocks with rigs, lasers, sparks
    const oy = Math.round(scrollY * 0.45);
    drawTiled(ctx, A.rocksMid, ax, oy, W, H, 0.37);
    ctx.globalCompositeOperation = 'lighter';
    const duty = fract(t / 5.5), lf = duty < 0.62 ? (0.75 + 0.25 * Math.sin(t * 37) * Math.sin(t * 13)) * smooth(0, 0.04, duty) * (1 - smooth(0.58, 0.62, duty)) : 0;
    if (lf > 0) { ctx.globalAlpha = lf; drawTiled(ctx, A.laser, ax, oy, W, H, 0.37); ctx.globalAlpha = 1; }
    ctx.globalCompositeOperation = 'source-over';
    lctx.globalAlpha = 0.9; drawTiled(lctx, A.rocksMidE, ax, oy, W, H, 0.37);
    if (lf > 0) { lctx.globalAlpha = lf; drawTiled(lctx, A.laser, ax, oy, W, H, 0.37); }
    lctx.globalAlpha = 1;
    A.midB.draw(ctx, lctx, ax, oy, W, H, t, 0.37);
    A.midS.draw(ctx, lctx, ax, oy, W, H, t, 0.37);
    // near silhouettes
    const oy2 = Math.round(scrollY * 0.9);
    drawTiled(ctx, A.rocksNear, ax, oy2, W, H, 0.53);
    lctx.globalAlpha = 0.8; drawTiled(lctx, A.rocksNearE, ax, oy2, W, H, 0.53); lctx.globalAlpha = 1;
    // embers
    const e = this.emb, EA = A.emb;
    ctx.fillStyle = '#ffab4f'; lctx.fillStyle = '#f7721f';
    for (let i = 0; i < EA.n; i++) {
      const x = Math.round(e.x[i]) - 20, y = Math.round(e.y[i]) - 20;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const a = 0.5 + 0.5 * Math.sin(t * 5 + EA.ph[i]);
      ctx.globalAlpha = a; ctx.fillRect(x, y, 1, 1);
      lctx.globalAlpha = a * 0.8; lctx.fillRect(x, y, 1, 1);
    }
    ctx.globalAlpha = 1; lctx.globalAlpha = 1;
    lctx.globalCompositeOperation = lop;
  }
}

// ---------------------------------------------------------------------------
// Crystals (Veil)
// ---------------------------------------------------------------------------

// One faceted crystal prism from base (bx, by) along angle ang. M: ramp (dark->light).
function kCrystal(r, e, bx, by, ang, len, wid, M, core, sunX = -0.7) {
  const ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux, hw = wid / 2;
  const sh = len * 0.78;
  const L = [bx + nx * hw, by + ny * hw], Rr = [bx - nx * hw, by - ny * hw];
  const PL = [L[0] + ux * sh, L[1] + uy * sh], PR = [Rr[0] + ux * sh, Rr[1] + uy * sh], T = [bx + ux * len, by + uy * len];
  // which facet faces the light
  const leftLit = nx * sunX > 0;
  const fL = leftLit ? 3 : 1, fR = leftLit ? 1 : 3;
  const mid = [bx, by], midT = T;
  const shade = (i0) => (x, y) => {
    // brighten toward the tip, add a dithered sheen band
    const u = ((x - bx) * ux + (y - by) * uy) / len;
    const band = Math.exp(-(((u - 0.62) / 0.12) ** 2)) * 1.3;
    r.set(x, y, M.c[qi(clamp(i0 + u * 1.1 + band - 0.3, 0, M.n - 1), x, y, M.n)]);
  };
  r.poly([L[0], L[1], PL[0], PL[1], midT[0], midT[1], mid[0], mid[1]], 0, shade(fL));
  r.poly([mid[0], mid[1], midT[0], midT[1], PR[0], PR[1], Rr[0], Rr[1]], 0, shade(fR));
  // edges
  r.line(PL[0], PL[1], T[0], T[1], leftLit ? M.rim : M.c[1]);
  r.line(PR[0], PR[1], T[0], T[1], leftLit ? M.c[1] : M.rim);
  r.line(L[0], L[1], PL[0], PL[1], leftLit ? M.c[M.n - 1] : M.c[0]);
  // glowing core
  if (e && core) {
    const cc = hexToRgb(core);
    for (let s = len * 0.15; s < len * 0.85; s += 0.5) {
      const x = Math.round(bx + ux * s), y = Math.round(by + uy * s);
      const k = Math.sin((s / len) * Math.PI) * 0.8;
      e.set(x, y, pack(cc[0] * k, cc[1] * k, cc[2] * k));
      if (((s * 2) | 0) % 3 === 0) r.set(x, y, M.c[M.n - 1]);
    }
    e.set(T[0], T[1], pack(cc[0], cc[1], cc[2]));
  }
}

// Cluster of crystals bursting from a small rock.
function kCrystalCluster(r, e, cx, cy, size, rng, M, rockM, core) {
  const base = rng.range(0, TAU);
  kRock(r, null, cx - Math.cos(base) * size * 0.1, cy - Math.sin(base) * size * 0.1, size * 0.36, rng, rockM, [-0.6, -0.6, 0.5], { craters: 1, seed: rng.int(1, 999) });
  const n = rng.int(3, 5), list = [];
  for (let i = 0; i < n; i++) {
    const a = base + ((i + 0.5) / n - 0.5) * 1.9 + rng.range(-0.2, 0.2);
    list.push([a, size * (i === (n >> 1) ? 1.25 : rng.range(0.6, 1.0)), size * rng.range(0.26, 0.36)]);
  }
  // a few loose shards
  for (let i = 0; i < 3; i++) {
    const a = rng.range(0, TAU), d = size * rng.range(0.9, 1.4);
    kCrystal(r, e, cx + Math.cos(a) * d, cy + Math.sin(a) * d, rng.range(0, TAU), size * 0.28, Math.max(3, size * 0.14), M, null);
  }
  // draw back-to-front: crystals pointing up first
  list.sort((p, q) => Math.sin(p[0]) - Math.sin(q[0]));
  for (const [a, len, wid] of list) kCrystal(r, e, cx + Math.cos(a) * size * 0.15, cy + Math.sin(a) * size * 0.15, a, len, wid, M, core);
}

// ---------------------------------------------------------------------------
// VEIL (S3) — the Veil Nebula stellar nursery
// ---------------------------------------------------------------------------

const PAL_VEIL = ['#000000', ...RAMPS.void, ...RAMPS.magenta, ...RAMPS.plasma.slice(0, 5), ...RAMPS.crystal, ...RAMPS.violet.slice(0, 4), ...RAMPS.sapphire.slice(0, 4),
  '#12040f', '#210719', '#360b27', '#4e1136', '#6c1a45', '#912a58', '#e4708e', '#041414', '#07201f', '#0a2f2d', '#0e403b', '#14584e',
  '#1e1440', '#2a1a52', '#3a2266', '#50307c', '#241030', '#3a1640', '#5a2458', '#ffc4e1', '#ffffff'];
const NEB_BLUE = ['#000000', '#05061a', '#090b2a', '#0e123c', '#151b52', '#1f276a'];

// Veil noise layers as standalone seeded functions (regenerated at viewport width on desktop).
function veilBase(tw) {
  const rng = new Rng(0x7e11 + tw), H = 640;
  const blue = nebulaTile(rng, tw, H, { cell: 160, oct: 4, warp: 40, bias: 0.4, contrast: 1.8, ramp: NEB_BLUE, step: 4 });
  const cx = ctx2d(blue);
  cx.globalCompositeOperation = 'lighter';
  cx.drawImage(starTile(rng, tw, H, Math.round(1500 * tw / TW), { maxB: 0.7, pow: 2.4, big: 0.02 }), 0, 0);
  cx.drawImage(starTile(rng, tw, H, Math.round(90 * tw / TW), { maxB: 1, pow: 1.5, big: 0.12, cols: ['#9db4ff', '#b5c6ff', '#e6c4ff', '#ffc4e1', '#c8fff0'] }), 0, 0);
  return blue;
}
let veilQ = null;
const veilQuant = () => veilQ || (veilQ = new Quant(PAL_VEIL));
function veilFar(tw) {
  return nebula2Tile(new Rng(0xfa7 + tw), tw, 640, veilQuant(), { cell: 200, oct: 4, warp: 70, colA: '#1a6a70', colB: '#24306e', biasA: 0.47, biasB: 0.45, gainA: 0.9, gainB: 0.9, fil: 0.5, filCol: '#2e9a8c', step: 3 });
}
// magenta emission clouds with star nurseries -> { nebMid, nebMidE }
function veilMid(tw) {
  const rng = new Rng(0x3a9 + tw), H = 1024;
  const neb = nebula2Tile(rng, tw, H, veilQuant(), { cell: 150, warp: 80, colA: '#c02a78', colB: '#2aa08c', biasA: 0.49, biasB: 0.55, gainA: 1.25, gainB: 0.9, fil: 0.9, filCol: '#ff7ab0', step: 3, hot: '#ffb0d0', hotAt: 0.75 });
  const e = new Raster(tw, H, true), stars = new Raster(tw, H, true);
  const KN = [[0, 0, 0], [40, 14, 34], [70, 26, 60], [110, 50, 96], [170, 110, 150]];
  const n = Math.round(9 * tw / TW);
  for (let i = 0; i < n; i++) {
    const x = rng.int(20, tw - 20), y = rng.int(0, H), big = rng.chance(0.4);
    const gr = big ? 16 : 9;
    for (let yy = -gr; yy <= gr; yy++) for (let xx = -gr; xx <= gr; xx++) {
      const d = Math.sqrt(xx * xx + yy * yy) / gr; if (d > 1) continue;
      const v = qi((1 - d) * (1 - d) * (big ? 1 : 0.7) * 4, x + xx, y + yy, 5);
      if (!v) continue;
      const cc = KN[v];
      stars.add(x + xx, y + yy, cc[0], cc[1], cc[2]);
      if (v >= 2) e.add(x + xx, y + yy, cc[0] * 0.5, cc[1] * 0.5, cc[2] * 0.5);
    }
    const sl = big ? 7 : 4, col = hexToRgb(rng.pick(['#f4f4ff', '#d4dcff', '#ffe6f4', '#e2fff6']));
    for (let k = -sl; k <= sl; k++) {
      const f = (1 - Math.abs(k) / (sl + 1)) ** 1.5;
      stars.add(x + k, y, col[0] * f, col[1] * f, col[2] * f);
      if (k) stars.add(x, y + k, col[0] * f, col[1] * f, col[2] * f);
      e.add(x + k, y, col[0] * f * 0.6, col[1] * f * 0.6, col[2] * f * 0.6);
      if (k) e.add(x, y + k, col[0] * f * 0.6, col[1] * f * 0.6, col[2] * f * 0.6);
    }
    stars.add(x, y, 255, 255, 255);
  }
  const nc = ctx2d(neb);
  nc.globalCompositeOperation = 'lighter';
  nc.drawImage(stars.toCanvas(), 0, 0);
  return { nebMid: neb, nebMidE: banded(e) };
}
// dark dust filaments (alpha) with a thin ionised rim along their upper edges
function veilDust(tw) {
  const rng = new Rng(0xd057 + tw), H = 1024;
  const f = new Fbm(rng, tw, H, 150, 4, 0.55), g = new Fbm(rng, tw, H, 80, 2, 0.5), m = new Fbm(rng, tw, H, 260, 2, 0.5);
  const r = new Raster(tw, H, true);
  const val = new Float32Array(tw * H);
  for (let y = 0; y < H; y += 2) for (let x = 0; x < tw; x += 2) {
    const w = g.at(x, y);
    const v = f.ridge(x + (w - 0.5) * 70, y + (w - 0.5) * 70) * (0.75 + 0.5 * m.at(x, y));
    val[y * tw + x] = v; val[y * tw + x + 1] = v; val[(y + 1) * tw + x] = v; val[(y + 1) * tw + x + 1] = v;
  }
  const TH0 = 0.86;
  const D = [pack(10, 6, 18, 110), pack(8, 5, 15, 170), pack(6, 4, 11, 215), pack(4, 3, 8, 240)];
  const rimM = packHex('#912a58', 210);
  for (let y = 0; y < H; y++) for (let x = 0; x < tw; x++) {
    const v = val[y * tw + x];
    const dens = clamp01((v - TH0) * 7);
    if (dens <= 0) continue;
    const k = qi(dens * 3.99, x, y, 4);
    if (k === 0 && bay(x, y) > 0.5) continue;
    let c = D[k];
    const ul = val[wr(y - 1, H) * tw + x];
    if (ul <= TH0 && val[wr(y + 2, H) * tw + x] > TH0 + 0.07) c = bay(x, y) < 0.75 ? rimM : c;
    r.d[y * tw + x] = c;
  }
  return r.toCanvas();
}

function* genVeil() {
  const rng = new Rng(0x7e11);
  const A = {};
  A.base = veilBase(TW);
  yield;
  A.nebFar = veilFar(TW);
  yield;
  Object.assign(A, veilMid(TW));
  yield;
  A.dust = veilDust(TW);
  yield;
  // --- crystal spires (f = 0.42) ---
  {
    const H = 1024, r = new Raster(TW, H, true), e = new Raster(TW, H, true);
    const CM = mat(['#061a1c', '#0b2f31', '#0f4a48', '#17706a', '#2ea08c', '#6fe0c6', '#c8fff0'], '#ffffff');
    const PM = mat(['#140a26', '#241244', '#3c1f6c', '#5c3aa0', '#8a64d8', '#bca0ff', '#efe2ff'], '#ffffff');
    const rockM = mat(['#07050c', '#0e0a16', '#171022', '#221830', '#302242', '#443058'], '#9b73ff');
    const spots = [[72, 120, 40, 0], [252, 360, 52, 1], [86, 620, 34, 1], [246, 830, 44, 0], [170, 480, 16, 0], [140, 950, 18, 1], [44, 380, 12, 0], [290, 620, 13, 1]];
    for (const [x, y, s, kind] of spots) kCrystalCluster(r, e, x, y, s, rng, kind ? PM : CM, rockM, kind ? '#c9b0ff' : '#86f4d8');
    A.crys = banded(outlined(r, pack(3, 2, 8, 230))); A.crysE = banded(e);
    A.glints = new Twinkles(rng, 26, TW, H, 0.42, { cols: ['#e2fff6', '#f1e9ff', '#ffffff'], bigChance: 0.6, speed: [0.8, 2], density: (x, y) => { let best = 0; for (const [sx, sy, s] of spots) best = Math.max(best, 1 - Math.hypot(x - sx, y - sy) / (s * 1.1)); return best > 0 ? 1 : 0; } });
  }
  yield;
  // --- near dust globules (f = 0.72): irregular dark clouds at the sides, rim-lit from above ---
  {
    const H = 1024, f = new Fbm(rng, TW, H, 44, 4, 0.55), g = new Fbm(rng, TW, H, 18, 2, 0.5), f2 = new Fbm(rng, TW, H, 12, 2, 0.5);
    const r = new Raster(TW, H, true), e = new Raster(TW, H, true);
    const D = packRamp(['#040209', '#07040e', '#0b0615', '#110a1f', '#190e2b', '#23133a']);
    const RIM = packRamp(['#3a0b27', '#6c1a45', '#bc4470', '#ffb0c8']);
    const TRIM = packHex('#1e6a60');
    // [x, y, rx, ry] — kept inside the tile so columns can be shifted
    const glob = [[60, 150, 34, 58], [40, 250, 18, 26], [262, 540, 40, 64], [282, 640, 20, 30], [56, 860, 30, 44], [150, 70, 10, 12]];
    const field = new Float32Array(TW * H).fill(-1);
    for (const [px, py, rx, ry] of glob) {
      for (let y = Math.floor(py - ry * 1.6); y < py + ry * 1.6; y++) for (let x = Math.max(0, Math.floor(px - rx * 1.6)); x < Math.min(TW, px + rx * 1.6); x++) {
        const Y = mod(y, H), dx = (x - px) / rx, dy = (y - py) / ry;
        const v = 1 - (dx * dx + dy * dy) + (f.at(x, Y) - 0.5) * 1.9 + (f2.at(x, Y) - 0.5) * 0.7;
        field[Y * TW + x] = Math.max(field[Y * TW + x], v);
      }
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < TW; x++) {
      const v = field[y * TW + x];
      if (v <= 0) continue;
      const up1 = field[wr(y - 1, H) * TW + x], up2 = field[wr(y - 2, H) * TW + wr(x + 1, TW)], up4 = field[wr(y - 4, H) * TW + wr(x + 1, TW)];
      const dn1 = field[wr(y + 1, H) * TW + x];
      let c;
      if (up1 <= 0) { c = RIM[3]; e.set(x, y, packHex('#bc4470')); }
      else if (up2 <= 0) { c = RIM[2]; e.set(x, y, packHex('#3a0b27')); }
      else if (up4 <= 0) c = RIM[bay(x, y) < 0.5 ? 1 : 0];
      else if (dn1 <= 0) c = TRIM;                                          // faint teal back-light underneath
      else {
        const bil = g.at(x, y) * 1.2 + clamp01(v) * 0.5 - (1 - smooth(0, 0.3, v)) * 0.5;
        c = D[qi(clamp(bil * 4 - 1, 0, 5), x, y, 6)];
      }
      r.d[y * TW + x] = c;
    }
    A.pillars = banded(r); A.pillarsE = banded(e);
  }
  // lightning: bolt sprites + a radial mask for lighting up the clouds
  A.bolts = [];
  for (let b = 0; b < 5; b++) {
    const w = 64, h = 96, r = new Raster(w, h);
    const hot = packHex('#ffffff'), mid = packHex('#ffc4e1'), dk = packHex('#b3175f');
    const walk = (x, y, ang, len, depth) => {
      for (let i = 0; i < len; i++) {
        const nx = x + Math.cos(ang) * 3, ny = y + Math.sin(ang) * 3;
        r.line(x + 1, y, nx + 1, ny, dk); r.line(x - 1, y, nx - 1, ny, dk);
        r.line(x, y, nx, ny, depth ? mid : hot);
        x = nx; y = ny; ang += rng.range(-0.7, 0.7);
        ang = lerp(ang, Math.PI / 2, 0.25);
        if (depth < 2 && rng.chance(0.18)) walk(x, y, ang + rng.sign() * rng.range(0.5, 1), Math.floor(len * 0.4), depth + 1);
        if (y > h - 4 || x < 3 || x > w - 3) break;
      }
    };
    walk(w / 2, 2, Math.PI / 2, 34, 0);
    A.bolts.push(r.toCanvas());
  }
  A.flashMask = glowSprite(96, 96, ['#000000', '#404040', '#808080', '#c0c0c0', '#ffffff'], (dx, dy) => Math.max(0, 1 - Math.hypot(dx, dy) / 48) ** 1.4);
  A.flashGlow = glowSprite(72, 72, ['#000000', '#200818', '#40102e', '#702048', '#a83a68', '#e0709a'], (dx, dy) => Math.max(0, 1 - Math.hypot(dx, dy) / 36) ** 2);
  A.tw = new Twinkles(rng, 40, TW, 640, 0.02, { cols: ['#9db4ff', '#e6c4ff', '#ffc4e1', '#c8fff0', '#ffffff'], bigChance: 0.25 });
  return A;
}

class VeilStage extends Stage {
  wide() { return { base: veilBase, nebFar: veilFar, nebMid: veilMid, dust: veilDust }; }
  constructor(A) {
    super('veil', A);
    this.scrollSpeed = 24;
    this.grade = { tint: [1.02, 0.97, 1.06], lift: [0.018, 0.0, 0.03], sat: 1.14, contrast: 1.05 };
    this.bolt = { t: 0, x: 0, y: 0, i: 0, big: 0, next: 2.5 };
    this.rnd = mulberry32(0x5eed);
  }
  layout() {
    this.S.comp = makeCanvas(96, 96);
    this.compCtx = ctx2d(this.S.comp);
  }
  flash() {
    super.flash();
    this.strike(true);
  }
  strike(big) {
    const b = this.bolt, R = this.rnd;
    b.t = big ? 0.9 : 0.55; b.big = big ? 1 : 0;
    b.x = Math.round(this.fx + 30 + R() * (FIELD_W - 60)); b.y = Math.round(this.fy + 20 + R() * (FIELD_H * 0.6));
    b.i = Math.floor(R() * this.A.bolts.length);
    b.next = 2 + R() * 5;
  }
  step(dt) {
    const b = this.bolt;
    if (b.t > 0) b.t = Math.max(0, b.t - dt);
    b.next -= dt;
    if (b.next <= 0 && b.t <= 0) this.strike(false);
  }
  render(ctx, lctx, scrollY, t) {
    const { W, H, A } = this;
    const lop = lctx.globalCompositeOperation;
    const ax = this.ax;
    this.tile(ctx, this.L('base'), Math.round(scrollY * 0.02));
    A.tw.draw(ctx, lctx, ax, Math.round(scrollY * 0.02), W, H, t);
    ctx.globalCompositeOperation = 'lighter';
    this.tile(ctx, this.L('nebFar'), Math.round(scrollY * 0.07), 0, Math.round(t * 0.4));
    const om = Math.round(scrollY * 0.14);
    const nebMid = this.L('nebMid'), nax = this.axw(nebMid.width);
    this.tile(ctx, nebMid, om);
    lctx.globalCompositeOperation = 'lighter';
    lctx.globalAlpha = 0.75 + 0.25 * Math.sin(t * 1.7); this.tile(lctx, this.L('nebMidE'), om); lctx.globalAlpha = 1;
    // lightning inside the clouds: re-light the local cloud structure + bolt
    const b = this.bolt;
    if (b.t > 0) {
      const life = b.big ? 0.9 : 0.55, u = 1 - b.t / life;
      const flick = u < 0.35 ? (Math.sin(u * 90) > -0.2 ? 1 : 0.35) : 1;
      const a = (1 - u) * (1 - u) * flick * (b.big ? 1.4 : 1);
      const c = this.compCtx, sx = b.x - 48, sy = b.y - 48;
      c.globalCompositeOperation = 'copy';
      // copy the nebula patch under the flash (tile space) into the comp canvas
      const tx = mod(sx - nax, nebMid.width), ty = mod(sy - om, nebMid.height);
      drawTiled(c, nebMid, -tx, -ty, 96, 96);
      c.globalCompositeOperation = 'destination-in';
      c.drawImage(A.flashMask, 0, 0);
      ctx.globalAlpha = clamp01(a * 1.6); ctx.drawImage(this.S.comp, sx, sy); ctx.drawImage(this.S.comp, sx, sy);
      ctx.globalAlpha = clamp01(a * 0.7); ctx.drawImage(A.flashGlow, b.x - 36, b.y - 36);
      lctx.globalAlpha = clamp01(a); lctx.drawImage(this.S.comp, sx, sy); lctx.drawImage(A.flashGlow, b.x - 36, b.y - 36);
      if (u < 0.4 && flick > 0.5) {
        const bo = A.bolts[b.i];
        ctx.globalAlpha = 1; ctx.drawImage(bo, b.x - 32, b.y - 40);
        lctx.globalAlpha = 0.9; lctx.drawImage(bo, b.x - 32, b.y - 40);
      }
      ctx.globalAlpha = 1; lctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';
    this.tile(ctx, this.L('dust'), Math.round(scrollY * 0.24));
    const oc = Math.round(scrollY * 0.42);
    drawTiled(ctx, A.crys, ax, oc, W, H, 0.43);
    lctx.globalAlpha = 0.8 + 0.2 * Math.sin(t * 2.3); drawTiled(lctx, A.crysE, ax, oc, W, H, 0.43); lctx.globalAlpha = 1;
    A.glints.draw(ctx, lctx, ax, oc, W, H, t * 1.5, 1, null, 0.43);
    const op = Math.round(scrollY * 0.72);
    drawTiled(ctx, A.pillars, ax, op, W, H, 0.29);
    lctx.globalAlpha = 0.6; drawTiled(lctx, A.pillarsE, ax, op, W, H, 0.29); lctx.globalAlpha = 1;
    // big flash: a faint wash over everything
    if (this.flashT > 0) {
      lctx.globalAlpha = this.flashT * this.flashT * 0.1; lctx.fillStyle = '#b3175f'; lctx.fillRect(0, 0, W, H); lctx.globalAlpha = 1;
    }
    lctx.globalCompositeOperation = lop;
  }
}

// ---------------------------------------------------------------------------
// WRECK (S4) — skimming the hull of a 40 km derelict dreadnought
// ---------------------------------------------------------------------------

// 5x7 stencil glyphs for hull markings
const GLYPHS = {
  0: ['01110', '11011', '11011', '11011', '11011', '11011', '01110'], 1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00110', '01000', '10000', '11111'], 3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'], 5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'], 7: ['11111', '11111', '00011', '00110', '00110', '01100', '01100'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'], 9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'], V: ['10001', '10001', '10001', '10001', '01010', '01010', '00100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
};

const HULL_W = 336;
const L_HULL = [-0.6, -0.8];      // key light from the upper left (matches sprites)

function* genWreck() {
  const rng = new Rng(0x1e71a7);
  const A = {};
  const HH = 1024, HW = HULL_W;
  const r = new Raster(HW, HH, true), e = new Raster(HW, HH, true);
  const HR = packRamp(['#0b0e10', '#12181b', '#1a2226', '#232d32', '#2e3a40', '#3a484e', '#4a5a60', '#5f7176', '#7d9094']);
  const RU = packRamp(['#1a1311', '#2a1d18', '#3c2a20', '#523626', '#6a452e']);
  const grime = new Fbm(rng, HW, HH, 90, 5, 0.55);
  const grimeF = grime.field(3);
  const fine = new Fbm(rng, HW, HH, 16, 2, 0.5).field(3);
  const rust = new Fbm(rng, HW, HH, 60, 4, 0.55).field(3);
  yield;
  // --- plates: BSP subdivision, each plate bevelled and weathered ---
  const plates = [];
  const split = (x, y, w, h, d) => {
    if ((w < 70 && h < 90 && rng.chance(0.55)) || w < 26 || h < 26 || d > 7) { plates.push([x, y, w, h]); return; }
    if (w > h * 0.8 ? rng.chance(0.75) : rng.chance(0.25)) {
      const k = Math.round(w * rng.range(0.3, 0.7)); split(x, y, k, h, d + 1); split(x + k, y, w - k, h, d + 1);
    } else {
      const k = Math.round(h * rng.range(0.3, 0.7)); split(x, y, w, k, d + 1); split(x, y + k, w, h - k, d + 1);
    }
  };
  for (let y = 0; y < HH; y += 128) split(14, y, HW - 28, 128, 0);
  for (const [px, py, pw, ph] of plates) {
    const tone = rng.pick([-0.7, -0.3, 0, 0, 0.2, 0.5]);
    const rusty = rng.chance(0.18);
    for (let y = py; y < py + ph; y++) for (let x = px; x < px + pw; x++) {
      const i = y * HW + x;
      let v = 4.2 + tone + (grimeF[i] - 0.5) * 3.4 + (fine[i] - 0.5) * 0.9;
      // bevel: top/left lit, bottom/right in shadow
      if (y === py || x === px) v += 1.6;
      else if (y === py + ph - 1 || x === px + pw - 1) v = 1.2 + tone * 0.3;
      else if (y === py + 1 || x === px + 1) v += 0.5;
      let c = HR[qi(clamp(v, 0, 8), x, y, 9)];
      if (rusty && rust[i] > 0.56 && y > py + 1 && x > px + 1) c = RU[qi(clamp((rust[i] - 0.56) * 22, 0, 4), x, y, 5)];
      r.d[i] = c;
    }
    // rivets along the long edges
    if (rng.chance(0.5)) {
      const rv = HR[7], rs = HR[1];
      for (let x = px + 3; x < px + pw - 2; x += 4) { r.set(x, py + 2, rv); r.set(x + 1, py + 3, rs); r.set(x, py + ph - 3, rv); }
    }
  }
  yield;
  // --- faded paint panels and hazard bands ---
  const paint = (x, y, w, h, hex, a = 0.5) => {
    const c = hexToRgb(hex);
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const i = mod(yy, HH) * HW + xx;
      if (grimeF[i] > 0.62 || fine[i] > 0.7) continue;           // chipped
      const p = r.d[i], k = a * (0.7 + fine[i] * 0.5);
      r.d[i] = pack(lerp(unR(p), c[0] * (0.5 + unR(p) / 255), k), lerp(unG(p), c[1] * (0.5 + unG(p) / 255), k), lerp(unB(p), c[2] * (0.5 + unB(p) / 255), k));
    }
  };
  const hazard = (x, y, w, h) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const i = mod(yy, HH) * HW + xx;
      if (grimeF[i] > 0.6) continue;
      const on = ((xx + yy) >> 2) & 1;
      r.d[i] = on ? packHex(fine[i] > 0.5 ? '#9a7424' : '#7a5c1e') : packHex('#15120e');
    }
  };
  paint(100, 40, 136, 150, '#3a1e1c', 0.4);
  paint(130, 600, 80, 120, '#1e2a36', 0.5);
  hazard(100, 210, 136, 6);
  hazard(126, 590, 84, 5);
  // --- giant hull numbers ---
  const stencil = (str, x0, y0, s, hex) => {
    const c = hexToRgb(hex);
    let cx = x0;
    for (const ch of str) {
      const g = GLYPHS[ch];
      if (g) for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) {
        if (g[gy][gx] !== '1') continue;
        for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) {
          const X = cx + gx * s + xx, Y = y0 + gy * s + yy, i = mod(Y, HH) * HW + X;
          if (grimeF[i] > 0.6 || (fine[i] > 0.72 && grimeF[i] > 0.45)) continue;
          const p = r.d[i], k = 0.7;
          r.d[i] = pack(lerp(unR(p), c[0] * (0.55 + unR(p) / 200), k), lerp(unG(p), c[1] * (0.55 + unG(p) / 200), k), lerp(unB(p), c[2] * (0.55 + unB(p) / 200), k));
        }
      }
      cx += 6 * s;
    }
  };
  stencil('07', 112, 56, 11, '#b8b09a');
  stencil('LV-7', 142, 612, 4, '#c8a050');
  yield;
  // --- raised superstructure blocks (bevelled, casting shadows to the lower right) ---
  const block = (x, y, w, h, kind) => {
    for (let yy = 0; yy < h + 5; yy++) for (let xx = 0; xx < w + 5; xx++) {
      if (xx < 4 && yy < 4) continue;
      const X = x + xx, Y = mod(y + yy, HH), i = Y * HW + X;
      if (xx >= w || yy >= h) { const p = r.d[i]; if (p && bay(X, Y) < 0.85) r.d[i] = pack(unR(p) * 0.45, unG(p) * 0.45, unB(p) * 0.5); }
    }
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const X = x + xx, Y = mod(y + yy, HH), i = Y * HW + X;
      let v = 5 + (grimeF[i] - 0.5) * 2.6 + (fine[i] - 0.5) * 0.8;
      if (yy === 0 || xx === 0) v = 7.6; else if (yy === h - 1 || xx === w - 1) v = 1.4;
      else if (yy === 1 || xx === 1) v += 0.8;
      else if (kind === 'ribbed' && yy % 4 === 2) v -= 1.2;
      r.d[i] = HR[qi(clamp(v, 0, 8), X, Y, 9)];
    }
    if (kind === 'windows') {
      for (let xx = 4; xx < w - 4; xx += 3) {
        const lit = rng.chance(0.3);
        r.set(x + xx, y + 4, lit ? packHex('#ffd27a') : HR[0]);
        if (lit) e.set(x + xx, y + 4, packHex('#6a4a18'));
      }
    }
    if (kind === 'hatch') {
      const hx = x + (w >> 1) - 5, hy = y + (h >> 1) - 5;
      for (let yy = 0; yy < 10; yy++) for (let xx = 0; xx < 10; xx++) r.set(hx + xx, hy + yy, ((xx + yy) >> 1) & 1 ? packHex('#9a7424') : packHex('#15120e'));
      kBox(r, hx + 2, hy + 2, 6, 6, mat(['#0b0e10', '#1a2226', '#2e3a40', '#4a5a60', '#7d9094'], '#c8d8da'), L_HULL, { base: 2 });
    }
  };
  block(104, 250, 40, 22, 'windows');
  block(196, 262, 34, 30, 'hatch');
  block(22, 380, 30, 60, 'ribbed');
  block(110, 700, 56, 26, 'windows');
  block(284, 560, 36, 44, 'ribbed');
  block(170, 1000, 44, 20, 'hatch');
  block(96, 470, 24, 14, 'plain');
  yield;
  // --- trenches with pipes, bracing and rim lights ---
  const bl = new Blinkers(HW, HH, true), steam = [], arcs = new Sparks(HW, HH, true);
  const TR = packRamp(['#040506', '#07090b', '#0c1013', '#12181b', '#1a2226', '#26323a', '#34444c']);
  const PIPE = mat(['#0e1214', '#182024', '#253036', '#36444b', '#4c5d64', '#6a7e84'], '#a8bcc0');
  const trench = (x0, w) => {
    for (let y = 0; y < HH; y++) for (let x = x0; x < x0 + w; x++) {
      const u = x - x0;
      let v;
      if (u < 3) v = 1 + u * 0.3;                         // left wall faces away from the light
      else if (u >= w - 3) v = 5 + (u - (w - 3)) * 0.5;   // right wall catches it
      else v = u < 9 ? 0.6 : 2 + (u / w) * 1.2;           // floor, shadowed near the left wall
      r.set(x, y, TR[qi(clamp(v + (fine[y * HW + x] - 0.5), 0, 6), x, y, 7)]);
    }
    // pipes along the floor
    const pr = [[x0 + 9, 3], [x0 + 15, 2], [x0 + w - 8, 2]];
    for (const [px, rad] of pr) if (px + rad * 2 < x0 + w - 2) kCyl(r, px, 0, HH, rad, false, PIPE, L_HULL, { seg: 23, caps: false });
    // cross braces + rim lights
    for (let y = 20; y < HH; y += 64) {
      kBox(r, x0 + 2, y, w - 4, 4, PIPE, L_HULL, { base: 3 });
      bl.add(x0 - 1, y + 16, '#ffab4f', 2.4, (y / 64) * 0.08, 0.2);
      bl.add(x0 + w, y + 16, '#ffab4f', 2.4, (y / 64) * 0.08 + 0.5, 0.2);
      e.set(x0 - 1, y + 16, packHex('#3d1d06')); e.set(x0 + w, y + 16, packHex('#3d1d06'));
    }
    // rim lips
    for (let y = 0; y < HH; y++) { r.set(x0 - 1, y, HR[7]); r.set(x0 + w, y, HR[1]); }
  };
  trench(62, 26);
  trench(250, 24);
  // cross trench segments
  const xtrench = (y0, h, x0, x1) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x1; x++) {
      const u = y - y0;
      const v = u < 3 ? 1 + u * 0.3 : u >= h - 3 ? 5 : u < 7 ? 0.6 : 2.4;
      r.set(x, y, TR[qi(clamp(v + (fine[mod(y, HH) * HW + x] - 0.5), 0, 6), x, y, 7)]);
    }
    kCyl(r, x0, y0 + 8, x1 - x0, 2, true, PIPE, L_HULL, { seg: 17, caps: false });
    for (let x = x0; x < x1; x++) { r.set(x, y0 - 1, HR[7]); r.set(x, y0 + h, HR[1]); }
  };
  xtrench(300, 16, 88, 250);
  xtrench(784, 14, 14, 62);
  xtrench(784, 14, 274, HW - 14);
  yield;
  // --- vents: grilles, some glowing hot, some venting steam ---
  const vent = (x, y, w, h, kind) => {
    kBox(r, x - 1, y - 1, w + 2, h + 2, PIPE, L_HULL, { base: 1 });
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const slat = yy % 3 === 0;
      let c = slat ? HR[4] : HR[0];
      if (!slat && kind === 'hot') {
        const k = 1 - Math.abs(xx - w / 2) / (w / 2);
        const hc = hexToRgb(k > 0.6 ? '#f7811e' : k > 0.3 ? '#c4400f' : '#7d1e08');
        c = pack(hc[0], hc[1], hc[2]); e.set(x + xx, y + yy, pack(hc[0] * 0.7, hc[1] * 0.6, hc[2] * 0.5));
      }
      r.set(x + xx, y + yy, c);
    }
    if (kind === 'steam') steam.push([x + (w >> 1), y + (h >> 1), rng.range(0, 10), rng.range(0.8, 1.3)]);
  };
  vent(160, 240, 16, 10, 'hot'); vent(186, 240, 16, 10, 'hot');
  vent(110, 360, 12, 9, 'steam'); vent(226, 520, 12, 9, 'steam'); vent(30, 640, 14, 8, 'hot');
  vent(296, 150, 14, 9, 'steam'); vent(150, 960, 20, 10, 'hot'); vent(296, 700, 12, 8, 'steam'); vent(30, 250, 12, 8, 'steam');
  // domes, antenna bases, dead turret rings
  const dome = (cx, cy, rad) => { kBall(r, cx, cy, rad, mat(['#0b0e10', '#1a2226', '#2e3a40', '#4a5a60', '#7d9094'], '#c8d8da'), L_HULL); };
  dome(40, 90, 7); dome(300, 420, 6); dome(120, 880, 5);
  const ring = (cx, cy, rad) => {
    for (let a = 0; a < TAU; a += 0.02) { r.set(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, Math.sin(a + 0.9) < 0 ? HR[7] : HR[1]); r.set(cx + Math.cos(a) * (rad - 2), cy + Math.sin(a) * (rad - 2), HR[2]); }
  };
  ring(200, 430, 9); ring(40, 960, 8);
  yield;
  // --- a dead main-battery turret: barbette, armoured gunhouse and twin barrels ---
  {
    const tx = 176, ty = 540, ang = -Math.PI / 2 - 0.42, ca = Math.cos(ang + Math.PI / 2), sa = Math.sin(ang + Math.PI / 2);
    const rot = (x, y) => [tx + x * ca - y * sa, ty + x * sa + y * ca];          // local y points along the barrels
    const TM = mat(['#0b0e10', '#151c20', '#212b30', '#2e3a40', '#3e4c53', '#556870', '#728a90'], '#a8bcc0');
    const shadowPoly = (pts) => r.poly(pts.map((v, i) => v + (i % 2 ? 7 : 6)), 0, (x, y) => {
      const i = mod(y, HH) * HW + x, p = r.d[i]; if (p && bay(x, y) < 0.9) r.d[i] = pack(unR(p) * 0.4, unG(p) * 0.4, unB(p) * 0.45);
    });
    const gun = [[-19, 12], [-16, -12], [-10, -18], [10, -18], [16, -12], [19, 12]].flatMap(([x, y]) => rot(x, y));
    const barrels = [-6, 6].map((bx) => [rot(bx, -16), rot(bx, -64)]);
    // shadows first
    for (let a = 0; a < TAU; a += 0.02) r.poly([...rot(0, 0), ...rot(Math.cos(a) * 25, Math.sin(a) * 25), ...rot(Math.cos(a + 0.03) * 25, Math.sin(a + 0.03) * 25)].map((v, i) => v + (i % 2 ? 6 : 5)), 0, (x, y) => {
      const i = mod(y, HH) * HW + x, p = r.d[i]; if (p && bay(x, y) < 0.9) r.d[i] = pack(unR(p) * 0.5, unG(p) * 0.5, unB(p) * 0.55);
    });
    shadowPoly(gun);
    for (const [[x0, y0], [x1, y1]] of barrels) for (let k = -2; k <= 2; k++) r.line(x0 + k * ca + 6, y0 + k * sa + 7, x1 + k * ca + 6, y1 + k * sa + 7, pack(10, 12, 13));
    // barbette ring
    for (let y = -26; y <= 26; y++) for (let x = -26; x <= 26; x++) {
      const d = Math.sqrt(x * x + y * y); if (d > 24.5) continue;
      const lit = (x * L_HULL[0] + y * L_HULL[1]) / (d + 0.01);
      const v = d > 22.5 ? (lit > 0 ? 6 : 1) : d > 20.5 ? 1.6 : 2.7 + (fine[mod(ty + y, HH) * HW + tx + x] - 0.5) * 1.5;
      r.set(tx + x, ty + y, TM.c[qi(clamp(v, 0, 6), tx + x, ty + y, 7)]);
    }
    // barrels (dark, with a lit top edge and blast-scorched muzzles)
    for (const [[x0, y0], [x1, y1]] of barrels) {
      kBeam(r, x0, y0, x1, y1, 5, TM, L_HULL);
      r.disc(x1, y1, 2.6, TM.c[0]);
      r.set(x1, y1, pack(4, 4, 5));
    }
    // gunhouse: flat-shaded faces
    r.poly(gun, 0, (x, y) => {
      const i = mod(y, HH) * HW + x;
      r.d[i] = TM.c[qi(clamp(4.5 + (fine[i] - 0.5) * 1.4 + (grimeF[i] - 0.5) * 1.2, 0, 6), x, y, 7)];
    });
    for (let k = 0; k < gun.length; k += 2) {
      const x0 = gun[k], y0 = gun[k + 1], x1 = gun[(k + 2) % gun.length], y1 = gun[(k + 3) % gun.length];
      const nx = y1 - y0, ny = -(x1 - x0), facing = (nx * L_HULL[0] + ny * L_HULL[1]) < 0;
      r.line(x0, y0, x1, y1, facing ? TM.c[6] : TM.c[0]);
    }
    const [hx0, hy0] = rot(-6, 2), [hx1, hy1] = rot(6, 2);
    r.line(hx0, hy0, hx1, hy1, TM.c[1]);                                         // roof hatch seam
    const [rx, ry] = rot(10, 6); kBall(r, rx, ry, 3, TM, L_HULL);                // rangefinder dome
  }
  yield;
  // --- burn scars and breaches (breaches are transparent: the lower decks show through) ---
  const scars = [[150, 440, 38, true], [220, 870, 24, true], [40, 520, 16, false], [296, 250, 14, false], [180, 150, 12, false]];
  for (const [cx, cy, rad, hole] of scars) {
    const bb = Math.ceil(rad * 2.2);
    const rmax2 = (rad * 1.25 * 1.9) ** 2;
    for (let y = -bb; y <= bb; y++) for (let x = -bb; x <= bb; x++) {
      const X = cx + x, Y = mod(cy + y, HH);
      if (X < 14 || X >= HW - 14 || x * x + y * y > rmax2) continue;
      const i = Y * HW + X, ang = Math.atan2(y, x);
      const rr = rad * (0.75 + 0.35 * vnoise3(Math.cos(ang) * 2 + cx, Math.sin(ang) * 2, cy * 0.1, 3) + 0.15 * Math.sin(ang * 7 + cx));
      const d = Math.hypot(x, y) / rr;
      // torn petals: sharp spikes of bent plating poking into the hole
      const s5 = Math.sin(ang * 5 + cx * 0.1), s11 = Math.sin(ang * 11 + cy);
      const p5 = s5 * s5 * s5 * s5 * s5 * s5, p11 = s11 * s11 * s11 * s11 * s11 * s11;
      const spike = p5 * 0.22 + p11 * p11 * 0.14;
      const hr = 0.62 - spike;
      if (hole && d < hr) { r.d[i] = 0; e.d[i] = 0; continue; }
      if (hole && d < hr + 0.1) {                                   // torn edge: lit lip on the far side, dark underside near
        const facing = (x * L_HULL[0] + y * L_HULL[1]) / (Math.hypot(x, y) + 0.01);
        r.d[i] = d < hr + 0.04 ? (facing < 0 ? HR[7] : HR[0]) : facing < 0 ? HR[5] : HR[2];
        continue;
      }
      if (d < 1.9) {
        const k = (1 - smooth(0.3, 1.9, d)) * (0.75 + fine[i] * 0.6);
        const p = r.d[i], s = 1 - k * 0.85;
        r.d[i] = bay(X, Y) < k * 1.4 ? pack(unR(p) * s, unG(p) * s * 0.95, unB(p) * s * 0.9) : p;
        if (d < (hole ? 0.95 : 0.5) && fine[i] > (hole ? 0.6 : 0.7)) {   // glowing embers in the scar
          const hc = hexToRgb(fine[i] > 0.75 ? '#f7811e' : '#8f260b');
          r.d[i] = pack(hc[0], hc[1], hc[2]); e.d[i] = pack(hc[0] * 0.8, hc[1] * 0.6, hc[2] * 0.5);
        }
      }
    }
    if (hole) {
      arcs.add(cx - rad * 0.55, cy - rad * 0.2, 1, 0.3, 1.6, rng.next());
      arcs.add(cx + rad * 0.4, cy + rad * 0.3, -1, -0.4, 1.2, rng.next());
    }
  }
  // armour belts along both hull edges (ragged outer edge)
  for (let y = 0; y < HH; y++) {
    const rag = (s) => Math.round(2 + 2 * vnoise3(y * 0.08, s, 0.3, 9) + (((y + s * 40) % 96) < 30 ? 3 : 0));
    const l = rag(1), rr = rag(2);
    for (let x = 0; x < 14; x++) {
      const vL = x < l ? -1 : x === l ? 7.5 : x < l + 3 ? 6 : x === 13 ? 1 : 4 + (fine[y * HW + x] - 0.5) * 2;
      r.d[y * HW + x] = vL < 0 ? 0 : HR[qi(clamp(vL, 0, 8), x, y, 9)];
      const X = HW - 1 - x;
      const vR = x < rr ? -1 : x === rr ? 1 : x < rr + 3 ? 2.2 : x === 13 ? 7 : 3.6 + (fine[y * HW + X] - 0.5) * 2;
      r.d[y * HW + X] = vR < 0 ? 0 : HR[qi(clamp(vR, 0, 8), X, y, 9)];
    }
    if (y % 48 === 8) { bl.add(8, y, '#ff5a5a', 1.8, y / 480, 0.12); bl.add(HW - 9, y, '#6fd23f', 1.8, y / 480 + 0.4, 0.12); }
  }
  A.hull = r.toCanvas(); A.hullE = banded(e); A.hullB = bl; A.arcs = arcs;
  A.steam = steam;
  yield;

  // --- lower decks (f = 0.62): exposed skeleton in the middle (seen through breaches),
  //     stepped lower-hull plating further out (seen past the hull edges on wide screens) ---
  {
    const W2 = 560, H2 = 576, C2 = W2 / 2, d = new Raster(W2, H2, true), de = new Raster(W2, H2, true);
    const DR = packRamp(['#060506', '#0b0909', '#120e0e', '#1a1414', '#241c1b', '#302624', '#3e322e']);
    const PL = packRamp(['#06080a', '#0a0e11', '#0f1519', '#151d22', '#1c262c', '#253139', '#2f3d46', '#3b4a53']);
    const f2 = new Fbm(rng, W2, H2, 40, 3, 0.5).field(3);
    // outer plating: rows of bevelled plates
    for (let py = 0; py < H2; py += 64) {
      for (const side of [-1, 1]) {
        let x = side < 0 ? 24 : C2 + 150;
        const xe = side < 0 ? C2 - 150 : W2 - 24;
        while (x < xe) {
          const w = Math.min(xe - x, rng.int(28, 60)), h = rng.chance(0.3) ? 32 : 64;
          for (let yy = 0; yy < 64; yy++) for (let xx = 0; xx < w; xx++) {
            const X = x + xx, Y = py + yy, i = Y * W2 + X, top = yy % h === 0, left = xx === 0, bot = yy % h === h - 1, right = xx === w - 1;
            let v = 3.4 + (f2[i] - 0.5) * 2.6;
            if (top || left) v = 6.4; else if (bot || right) v = 1;
            d.d[i] = PL[qi(clamp(v, 0, 7), X, Y, 8)];
          }
          x += w;
        }
      }
    }
    // turret barbettes and missile-tube arrays on the outer plating
    const PM = mat(['#06080a', '#0f1519', '#1c262c', '#2f3d46', '#4a5a64'], '#6a7e88');
    for (let k = 0; k < 6; k++) {
      const side = k % 2 ? 1 : -1, x = C2 + side * rng.int(180, 240), y = rng.int(10, H2 - 10);
      if (rng.chance(0.5)) {
        kBall(d, x, y, 9, PM, L_HULL, { spec: false });
        for (let a = 0; a < TAU; a += 0.03) d.set(x + Math.cos(a) * 11, y + Math.sin(a) * 11, Math.sin(a + 0.9) < 0 ? PL[6] : PL[1]);
        kBeam(d, x, y, x + side * 4, y - 16, 3, PM, L_HULL);
      } else {
        for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) { d.disc(x + i * 7 - 10, y + j * 7 - 7, 2.2, PL[0]); d.set(x + i * 7 - 11, y + j * 7 - 8, PL[5]); }
      }
      if (rng.chance(0.6)) { d.set(x, y - 12, packHex('#ff5a5a')); de.set(x, y - 12, packHex('#8a1a1a')); }
    }
    // exposed skeleton in the middle: girders, ribs, machinery, conduits, fires (lit red by emergency lamps)
    const f3 = new Fbm(rng, W2, H2, 90, 3, 0.5).field(4);
    for (let y = 0; y < H2; y++) for (let x = C2 - 150; x < C2 + 150; x++) {
      const glow = f3[y * W2 + x];
      d.d[y * W2 + x] = glow > 0.5 && bay(x, y) < (glow - 0.5) * 4 ? pack(46, 12, 10) : glow > 0.4 && bay(x, y) < 0.5 ? pack(24, 8, 8) : pack(12, 6, 7);
    }
    for (const gx of [C2 - 120, C2 - 60, C2, C2 + 60, C2 + 120]) for (let y = 0; y < H2; y++) for (let x = gx - 5; x < gx + 5; x++) {
      const u = x - (gx - 5);
      d.set(x, y, DR[qi(clamp((u < 2 ? 5.5 : u > 7 ? 1 : 3.2) + (f2[y * W2 + x] - 0.5) * 2, 0, 6), x, y, 7)]);
    }
    for (let ry = 0; ry < H2; ry += 48) for (let y = ry; y < ry + 12; y++) for (let x = C2 - 150; x < C2 + 150; x++) {
      const u = y - ry;
      if (Math.abs(x - C2 + 20) < 40 && ry % 144 === 0) continue;
      d.set(x, y, DR[qi(clamp((u < 2 ? 5.8 : u > 9 ? 0.8 : 3) + (f2[y * W2 + x] - 0.5) * 2.4, 0, 6), x, y, 7)]);
    }
    for (let k = 0; k < 22; k++) {
      const x = rng.int(C2 - 140, C2 + 110), y = rng.int(0, H2 - 30), w = rng.int(10, 28), h = rng.int(8, 18);
      kBox(d, x, y, w, h, mat(['#0a0808', '#140f0f', '#1f1716', '#2c2220', '#3c2f2b'], '#5a4640'), L_HULL, { panels: 5, base: 2 });
      if (rng.chance(0.45)) { de.set(x + 2, y + 2, packHex('#8a1a1a')); d.set(x + 2, y + 2, packHex('#ff5a5a')); }
    }
    for (let k = 0; k < 7; k++) { const y = rng.int(0, H2); kCyl(d, C2 - 150, y, 300, 2, true, PIPE, L_HULL, { seg: 29, caps: false }); }
    for (let k = 0; k < 10; k++) {
      const x = rng.int(C2 - 130, C2 + 130), y = rng.int(0, H2);
      for (let yy = -6; yy <= 6; yy++) for (let xx = -7; xx <= 7; xx++) {
        const q = 1 - Math.hypot(xx, yy * 1.3) / 7;
        if (q <= 0 || bay(x + xx, y + yy) > q * 1.3) continue;
        const hc = hexToRgb(q > 0.6 ? '#fdbb3a' : q > 0.3 ? '#f7721f' : '#8f260b');
        d.set(x + xx, y + yy, pack(hc[0], hc[1], hc[2])); de.set(x + xx, y + yy, pack(hc[0] * 0.7, hc[1] * 0.55, hc[2] * 0.4));
      }
    }
    // ragged outer edges and a few holes to space in the outer plating
    for (let y = 0; y < H2; y++) {
      const edge = 24 + Math.round(10 * vnoise3(y * 0.05, 1, 0.2, 5) + (((y % 192) < 60) ? 16 : 0));
      for (let x = 0; x < edge; x++) { d.d[y * W2 + x] = 0; d.d[y * W2 + W2 - 1 - x] = 0; de.d[y * W2 + x] = 0; de.d[y * W2 + W2 - 1 - x] = 0; }
    }
    for (let k = 0; k < 4; k++) {
      const side = k % 2 ? 1 : -1, x = C2 + side * rng.int(170, 230), y = rng.int(0, H2), rad = rng.range(8, 14);
      for (let yy = -rad; yy <= rad; yy++) for (let xx = -rad * 1.4; xx <= rad * 1.4; xx++) {
        const q = Math.hypot(xx / 1.4, yy) / (rad * (0.8 + 0.3 * vnoise3(xx * 0.3, yy * 0.3, k, 2)));
        if (q < 1) d.set(x + xx, y + yy, 0);
      }
    }
    A.deck = outlined(d, pack(2, 2, 3, 255)).toCanvas(); A.deckE = banded(de);
  }
  yield;
  // --- deep space below: stars, a cold nebula glow and far debris ---
  {
    const H3 = 640;
    const neb = nebulaTile(rng, TW, H3, { cell: 180, oct: 4, warp: 50, bias: 0.46, contrast: 2, step: 4, ramp: ['#000000', '#030a0e', '#061318', '#0a1c22', '#0f2830', '#15363e'] });
    const nc = ctx2d(neb);
    nc.globalCompositeOperation = 'lighter';
    nc.drawImage(starTile(rng, TW, H3, 700, { maxB: 0.75, pow: 2.3, big: 0.04 }), 0, 0);
    A.space = neb;
    const deb = new Raster(TW, 768, true);
    const DM = mat(['#040506', '#07090b', '#0c1013', '#12181b', '#1a2226', '#26323a'], '#4c5d64');
    for (let k = 0; k < 18; k++) {
      const x = rng.int(12, TW - 12), y = rng.int(0, 768);
      if (rng.chance(0.5)) kRock(deb, null, x, y, rng.range(2, 6), rng, DM, [-0.6, -0.6, 0.5], { craters: 0, seed: k });
      else { kBox(deb, x, y, rng.int(6, 16), rng.int(3, 6), DM, L_HULL, { base: 2 }); kBeam(deb, x, y, x + rng.int(-12, 12), y + rng.int(8, 20), 2, DM, L_HULL); }
    }
    A.debris = banded(outlined(deb, pack(1, 1, 2, 200)));
  }
  // steam puff sprites (dithered, 3 sizes)
  A.puffs = [5, 9, 13].map((s) => glowSprite(s, s, ['#000000', '#343c40', '#5a666c', '#8a969c', '#c2ccd0'], (dx, dy) => Math.max(0, 1 - Math.hypot(dx, dy) / (s / 2)) * 1.1));
  return A;
}

class WreckStage extends Stage {
  constructor(A) {
    super('wreck', A);
    this.scrollSpeed = 36;
    this.grade = { tint: [0.97, 1.0, 1.0], lift: [0.004, 0.01, 0.014], sat: 0.88, contrast: 1.14 };
  }
  // Hull-space helpers for gameplay (the hull tile is 336 x 1024, centred on the field and
  // scrolling at exactly 1.0 x scrollY): field coords of hull pixel (hx, hy).
  hullX(hx) { return hx - HULL_W / 2 + FIELD_W / 2; }
  hullY(hy, scrollY) { return mod(hy + Math.round(scrollY), 1024) - this.fy; }
  render(ctx, lctx, scrollY, t) {
    const { W, H, A } = this;
    const lop = lctx.globalCompositeOperation;
    const cx = this.cx;
    drawTiled(ctx, A.space, this.ax, Math.round(scrollY * 0.03), W, H);
    drawTiled(ctx, A.debris, this.ax, Math.round(scrollY * 0.25), W, H, 0.31);
    // lower decks
    const dx = Math.round(cx - A.deck.width / 2), dy = Math.round(scrollY * 0.62);
    drawStrip(ctx, A.deck, dx, dy, H);
    lctx.globalCompositeOperation = 'lighter';
    const fl = 0.7 + 0.3 * Math.sin(t * 9) * Math.sin(t * 5.3);
    lctx.globalAlpha = fl; drawStrip(lctx, A.deckE, dx, dy, H); lctx.globalAlpha = 1;
    // hull (exactly 1.0 x scrollY)
    const hx = Math.round(cx - HULL_W / 2), hy = Math.round(scrollY);
    let y0 = mod(hy, 1024); if (y0 > 0) y0 -= 1024;
    for (let y = y0; y < H; y += 1024) ctx.drawImage(A.hull, hx, y);
    const surge = this.flashT;
    lctx.globalAlpha = clamp01(0.85 + surge);
    drawStrip(lctx, A.hullE, hx, hy, H);
    if (surge > 0.15) { lctx.globalAlpha = clamp01(surge - 0.15); drawStrip(lctx, A.hullE, hx, hy, H); }
    lctx.globalAlpha = 1;
    A.hullB.draw(ctx, lctx, hx, hy, hx + HULL_W, H, surge > 0 ? t * 6 : t);
    A.arcs.draw(ctx, lctx, hx, hy, hx + HULL_W, H, t * (1 + surge * 3));
    // steam from vents: puffs drift down-screen (relative wind) and dissolve
    for (let i = 0; i < A.steam.length; i++) {
      const st = A.steam[i], vx = st[0], vy = st[1], ph = st[2], sp = st[3];
      const sy0 = mod(vy + hy, 1024);
      if (sy0 > H + 30) continue;
      for (let k = 0; k < 4; k++) {
        const u = fract(t * 0.55 * sp + ph + k / 4);
        const px = hx + vx + Math.round(Math.sin(u * 5 + ph) * 2 * u), py = sy0 + Math.round(u * 26);
        const img = A.puffs[Math.min(2, (u * 3) | 0)];
        ctx.globalAlpha = (1 - u) * 0.8;
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(img, px - (img.width >> 1), py - (img.height >> 1));
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    lctx.globalCompositeOperation = lop;
  }
}

// ---------------------------------------------------------------------------
// HORIZON (S5) — the singularity: Doppler-beamed accretion disk, photon ring, jets
// ---------------------------------------------------------------------------

const PAL_HOLE = ['#000000', '#05040c', '#0a0818', '#110e26', ...RAMPS.fire, ...RAMPS.ember, ...RAMPS.dawn,
  '#d6fcff', '#9fe6ff', '#fff5c9', '#ffd966', '#f0a92a', '#bf7412', '#7a430b', '#3d2106', '#2a0a06', '#12060a', '#e8f4ff', '#c4e2ff'];
const DISK_INC = 0.13;       // projected minor/major axis ratio of the disk
const PHASES = 4;

// Renders every canvas of the hole at shadow radius rs. Yields between pieces so it can
// run incrementally inside update(); returns { rs, cw, ch, back[], front[], halo[], glow, shadow }.
function* renderHole(rs, q) {
  const rin = rs * 2.05, rout = rs * 6.2, k = DISK_INC;
  const cw = Math.ceil(rout * 2 + 8) | 1, ch = Math.ceil(rs * 7.2) | 1;
  const cx = cw / 2, cy = ch / 2;
  const out = { rs, cw, ch, back: [], front: [], halo: [] };
  const col = new Float32Array(3);
  const tint = (I, dop) => {
    const hot = clamp01(I), blue = clamp01((dop - 1.15) * 1.6) * hot;
    const sh = Math.sqrt(hot), h2 = hot * hot;
    col[0] = clamp(255 * sh - 40 * blue, 0, 255);
    col[1] = clamp(250 * hot * Math.sqrt(sh) + 25 * blue, 0, 255);
    col[2] = clamp(240 * h2 * hot + 170 * blue, 0, 255);
  };
  // lensed background star arcs (same for every phase, rotated slightly per phase)
  const arng = new Rng(rs * 131 + 7), arcs = [];
  for (let i = 0; i < 10; i++) arcs.push([rs * arng.range(2.2, 3.4), ((i + arng.range(0.2, 0.8)) / 10) * TAU, arng.range(0.2, 0.6), arng.range(0.25, 0.55)]);
  for (let p = 0; p < PHASES; p++) {
    const ph = (p / PHASES) * 4;
    const back = new Raster(cw, ch), front = new Raster(cw, ch), halo = new Raster(cw, ch);
    const diskH = rout * k + 1, haloR = rs * 2.02;
    for (let y = 0; y < ch; y++) {
      if ((y & 15) === 15) yield;                     // keep incremental re-renders smooth
      const dyy = y + 0.5 - cy;
      if (Math.abs(dyy) > diskH && Math.abs(dyy) > haloR) continue;
      for (let x = 0; x < cw; x++) {
      const dx = x + 0.5 - cx, dy = dyy;
      // --- the disk (flattened ellipse), split into far (above centre) and near halves ---
      const X = dx, Y = dy / k, rho = Math.sqrt(X * X + Y * Y);
      if (rho > rin && rho < rout) {
        const th = Math.atan2(Y, X), u = (rho - rin) / (rout - rin);
        const qq = rin / rho, sq = Math.sqrt(qq), temp = qq * Math.sqrt(sq), om = qq * sq;
        const a1 = th + ph * om * 1.5708, a3 = th * 3 + ph * om * 4.712;
        const tex = 0.5 + 0.5 * vnoise3(rho * 0.6, Math.cos(a1) * 2.2, Math.sin(a1) * 2.2, 3);
        const tex2 = 0.65 + 0.35 * vnoise3(rho * 1.9, Math.cos(a3) * 1.5, Math.sin(a3) * 1.5, 8);
        const edge = smooth(0, 0.05, u) * (1 - smooth(0.5, 1, u));
        const dop = 1 + 0.7 * -Math.cos(th);
        const I = temp * temp * tex * tex2 * edge * dop * (dy >= 0 ? 1.35 : 1.1);
        if (I > 0.025) {
          tint(I, dop);
          const c = q.dq(col[0], col[1], col[2], x, y, 26);
          if (dy < 0) back.d[y * cw + x] = c; else front.d[y * cw + x] = c;
        }
      }
      // --- lensed image of the disk's far side and the photon ring ---
      const d = Math.sqrt(dx * dx + dy * dy) / rs;
      if (d > 0.98 && d < 2) {
        const phi = Math.atan2(dy, dx), up = -Math.sin(phi), dop = 1 + 0.7 * -Math.cos(phi);
        let Ih = 0;
        {
          // thick arc over the top, thin one under the bottom
          const w = up > 0 ? 0.14 + 0.5 * up * up : 0.1 + 0.05 * -up;
          const c0 = 1.1 + w * 0.5;
          const ring = Math.max(0, 1 - Math.abs(d - c0) / (w * 0.6 + 0.02));
          const tex = 0.55 + 0.45 * vnoise3(d * 6, Math.cos(phi * 2 + ph * 1.5708) * 3, Math.sin(phi * 2 + ph * 1.5708) * 3, 21);
          Ih = ring * ring * tex * dop * (up > 0 ? 1 : 0.6);
          const pr = Math.exp(-(((d - 1.03) / 0.028) ** 2)) * 1.25 * (0.75 + 0.25 * dop);   // photon ring
          Ih = Math.max(Ih, pr);
        }
        if (Ih > 0.04) {
          tint(Ih, dop);
          halo.d[y * cw + x] = q.dq(col[0], col[1], col[2], x, y, 24);
        }
      }
      }
    }
    // lensed background starlight: thin blue-white arcs hugging the hole
    const AC = [packHex('#1b3a66'), packHex('#4c86ff'), packHex('#9dc0ff'), packHex('#e3eeff')];
    for (const [ar, a0, span, br] of arcs) {
      const steps = Math.ceil(ar * span * 2);
      for (let j = 0; j <= steps; j++) {
        const a = a0 + p * 0.025 + (j / steps - 0.5) * span;
        if (Math.abs(Math.sin(a)) < 0.25) continue;               // hidden by the disk plane
        const f = (1 - Math.abs(j / steps - 0.5) * 2) * br;
        const X = Math.round(cx + Math.cos(a) * ar), Y = Math.round(cy + Math.sin(a) * ar);
        if (!halo.get(X, Y)) halo.set(X, Y, AC[qi(f * 4.5, X, Y, 4)]);
      }
    }
    out.back.push(banded(back)); out.front.push(banded(front)); out.halo.push(banded(halo));
    warm([out.back[p], out.front[p], out.halo[p]]);
    yield;
  }
  // soft outer glow (additive) hugging the disk plane
  const gw = Math.ceil(rout * 2.3) | 1, gh = Math.ceil(rout * 0.9) | 1;
  out.glow = glowSprite(gw, gh, ['#000000', '#100604', '#200a06', '#341208', '#4a1c0a'], (dx, dy) => {
    const X = dx / (rout * 1.1), Y = dy / (rout * 0.42); const d = 1 - Math.sqrt(X * X + Y * Y); return d > 0 ? d * d : 0;
  });
  yield;
  const sh = new Raster(Math.ceil(rs * 2 + 2) | 1, Math.ceil(rs * 2 + 2) | 1);
  const sc = sh.w / 2;
  for (let y = 0; y < sh.h; y++) for (let x = 0; x < sh.w; x++) if (Math.hypot(x + 0.5 - sc, y + 0.5 - sc) <= rs + 0.3) sh.d[y * sh.w + x] = 0xff000000;
  out.shadow = sh.toCanvas();
  yield;
  warm([out.glow, out.shadow]);
  return out;
}

function* genHorizon() {
  const rng = new Rng(0x40121);
  const A = {};
  A.q = new Quant(PAL_HOLE);
  // far stars (baked into the static sky at layout time)
  A.starsFar = starTile(rng, TW, 640, 1900, { maxB: 0.7, pow: 2.3, big: 0.02, raster: true });
  yield;
  A.starsMid = starTile(rng, TW, 512, 160, { maxB: 1, pow: 1.8, big: 0.12 });
  // streaking near stars (short vertical smears)
  {
    const r = new Raster(TW, 512, true);
    for (let i = 0; i < 46; i++) {
      const x = rng.int(0, TW - 1), y = rng.int(0, 511), len = rng.int(3, 8), c = hexToRgb(rng.pick(STAR_COLS));
      for (let k = 0; k < len; k++) { const f = qLevel((1 - k / len) * 0.8); r.add(x, y - k, c[0] * f, c[1] * f, c[2] * f); }
    }
    A.streaks = r.toCanvas();
  }
  A.tw = new Twinkles(rng, 36, TW, 512, 0.02, { bigChance: 0.3 });
  // lensed star arcs (thin arcs hugging the hole), rendered at runtime scale from this template
  A.jet = glowSprite(9, 140, ['#000000', '#120a2a', '#241450', '#3a2080', '#6a3fd0', '#c9b0ff'], (dx, dy) => {
    const u = Math.abs(dy) / 70; return Math.max(0, 1 - Math.abs(dx) / (1.5 + u * 3)) * Math.max(0, 1 - u) ** 1.3 * (0.8 + 0.2 * Math.sin(dy * 0.4));
  });
  // infalling matter: particles on shrinking elliptical orbits (free-running)
  const N = 40;
  A.inf = { n: N, r0: new Float32Array(N), th0: new Float32Array(N), per: new Float32Array(N), ph: new Float32Array(N) };
  for (let i = 0; i < N; i++) { A.inf.r0[i] = rng.range(4, 7.5); A.inf.th0[i] = rng.range(0, TAU); A.inf.per[i] = rng.range(5, 11); A.inf.ph[i] = rng.range(0, 1); }
  return A;
}

class HorizonStage extends Stage {
  constructor(A) {
    super('horizon', A);
    this.scrollSpeed = 30;
    this.grade = { tint: [1.0, 0.97, 1.05], lift: [0.012, 0.0, 0.024], sat: 1.08, contrast: 1.12 };
    this.hole = null; this.job = null; this.jobRs = 0; this.lastScroll = 0; this.pulse = 0;
  }
  // shadow radius grows as the squad closes in (deterministic in scrollY)
  rsFor(scrollY) {
    const base = Math.max(14, Math.min(this.W, this.H) * 0.075);
    return Math.round(base * (1 + 0.5 * smooth(0, 11000, scrollY)));
  }
  holeCenter() { return [Math.round(this.cx), Math.round(this.fy + Math.min(FIELD_H * 0.36, this.H * 0.36))]; }
  layout() {
    this.freeHole(this.hole); this.hole = null; this.job = null;
    this.hole = runGen(renderHole(this.rsFor(this.lastScroll), this.A.q));
    // static sky: one galactic band crossing behind the hole, dust lanes, baked stars
    const W = this.W, H = this.LH, r = new Raster(W, H), [hx, hy] = this.holeCenter();
    const q = new Quant(['#000000', '#05040c', '#0a0818', '#110e26', '#1a1638', '#252050', '#221247', '#3f2388', '#2a0f2e', '#3a1a3e',
      '#5a1a44', '#3d2106', '#5a3418', '#1a0806', '#0a1a4d', '#132f8c', '#4a2a50', '#6a4a60']);
    const ang = -0.95, ca = Math.cos(ang), sa = Math.sin(ang);
    const n = coarseGrid(0, 0, W, H, 2, 2, (x, y, o) => {
      const along = (x - hx) * ca + (y - hy) * sa, across = (x - hx) * -sa + (y - hy) * ca;
      o[0] = fbm3(x * 0.012, y * 0.012, 0.5, 4, 5);
      o[1] = fbm3(along * 0.011, across * 0.05, 2.5, 3, 9);         // dust lanes stretched along the band
    });
    const v2 = new Float32Array(2);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      n.get(x, y, v2);
      const dd = ((x - hx) * -sa + (y - hy) * ca) / (Math.min(W, H) * 0.32);      // distance from the band's axis
      const band = Math.exp(-dd * dd) * (0.45 + v2[0] * 0.75);
      const dust = smooth(0.52, 0.7, v2[1]) * Math.exp(-dd * dd * 2.5);
      const v = Math.max(0, band * (1 - dust * 0.85));
      r.d[y * W + x] = q.dq(6 + 58 * v + 40 * v * v, 4 + 30 * v + 34 * v * v, 14 + 46 * v + 10 * v * v, x, y, 12);
    }
    const st = this.A.starsFar, ax = this.ax;
    const sx0 = mod(-ax, st.w);
    for (let y = 0; y < H; y++) for (let x = 0, sx = sx0; x < W; x++, sx = sx + 1 === st.w ? 0 : sx + 1) {
      const s = st.d[(y % st.h) * st.w + sx];
      if (s & 0xffffff) { const i = y * W + x, p = r.d[i]; r.d[i] = pack(Math.min(255, unR(p) + unR(s)), Math.min(255, unG(p) + unG(s)), Math.min(255, unB(p) + unB(s))); }
    }
    this.S.sky = r.toCanvas();
  }
  freeHole(h) { if (!h) return; for (const k of ['back', 'front', 'halo']) h[k].forEach(freeCanvas); freeCanvas(h.glow); freeCanvas(h.shadow); }
  step(dt) {
    if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - dt * 0.8);
    if (!this.W) return;
    const want = this.rsFor(this.lastScroll);
    if (this.hole && want !== this.hole.rs && !this.job) { this.jobRs = want; this.job = renderHole(want, this.A.q); }
    if (this.job) {
      // incremental re-render: one disk phase per frame, then swap
      const r = this.job.next();
      if (r.done) { this.freeHole(this.hole); this.hole = r.value; this.job = null; }
    }
  }
  flash() { super.flash(); this.pulse = 1; }
  lensing() {
    if (!this.hole) return null;
    const [x, y] = this.holeCenter();
    return { x, y, r: this.hole.rs * 3.4, strength: 0.55 + 0.25 * smooth(0, 11000, this.lastScroll) };
  }
  dispose() { this.freeHole(this.hole); this.hole = null; this.job = null; super.dispose(); }
  render(ctx, lctx, scrollY, t) {
    const { W, H, A } = this, h = this.hole;
    if (!h) return;
    this.lastScroll = scrollY;
    const lop = lctx.globalCompositeOperation;
    const ax = this.ax, [cx, cy] = this.holeCenter();
    ctx.drawImage(this.S.sky, 0, 0);
    A.tw.draw(ctx, lctx, ax, 0, W, H, t);
    ctx.globalCompositeOperation = 'lighter';
    drawTiled(ctx, A.starsMid, ax, Math.round(scrollY * 0.08), W, H);
    drawTiled(ctx, A.streaks, ax, Math.round(scrollY * 0.5), W, H);
    lctx.globalCompositeOperation = 'lighter';
    // outer glow + jets
    const fl = this.flashT, pu = this.pulse;
    const gx = cx - (h.glow.width >> 1), gy = cy - (h.glow.height >> 1);
    ctx.globalAlpha = clamp01(0.8 + fl * 0.5); ctx.drawImage(h.glow, gx, gy);
    lctx.globalAlpha = clamp01(0.4 + fl * 0.6); lctx.drawImage(h.glow, gx, gy);
    const jl = 0.55 + 0.15 * Math.sin(t * 2.1) + fl * 0.5;
    const jh = A.jet.height, jsc = h.rs / 18;
    ctx.globalAlpha = clamp01(jl); lctx.globalAlpha = clamp01(jl * 0.8);
    const jw = Math.max(5, Math.round(9 * jsc)) | 1, jhh = Math.round(jh * jsc);
    ctx.drawImage(A.jet, 0, 0, 9, jh >> 1, cx - (jw >> 1), cy - jhh / 2 | 0, jw, jhh >> 1);
    ctx.drawImage(A.jet, 0, jh >> 1, 9, jh >> 1, cx - (jw >> 1), cy, jw, jhh >> 1);
    lctx.drawImage(A.jet, 0, 0, 9, jh >> 1, cx - (jw >> 1), cy - jhh / 2 | 0, jw, jhh >> 1);
    lctx.drawImage(A.jet, 0, jh >> 1, 9, jh >> 1, cx - (jw >> 1), cy, jw, jhh >> 1);
    // jet knots travelling outward
    ctx.fillStyle = '#c9b0ff'; lctx.fillStyle = '#9b73ff';
    for (let i = 0; i < 4; i++) {
      const u = fract(t * 0.18 + i / 4), d = Math.round(h.rs * 1.3 + u * jhh * 0.45), a = (1 - u) * 0.9;
      ctx.globalAlpha = a; lctx.globalAlpha = a;
      ctx.fillRect(cx, cy - d, 1, 2); ctx.fillRect(cx, cy + d - 1, 1, 2);
      lctx.fillRect(cx - 1, cy - d, 3, 2); lctx.fillRect(cx - 1, cy + d - 1, 3, 2);
    }
    // disk: crossfade texture phases -> slow differential rotation
    const pf = (t * 0.55) % PHASES, p0 = Math.floor(pf), p1 = (p0 + 1) % PHASES, k = pf - p0;
    const dx0 = cx - (h.cw >> 1), dy0 = cy - (h.ch >> 1);
    const bright = 1 + fl * 0.6;
    const layer = (arr, la) => {
      ctx.globalAlpha = 1; blit(ctx, arr[p0], dx0, dy0);
      ctx.globalAlpha = k; blit(ctx, arr[p1], dx0, dy0);
      lctx.globalAlpha = clamp01(la * bright * (1 - k)); blit(lctx, arr[p0], dx0, dy0);
      lctx.globalAlpha = clamp01(la * bright * k); blit(lctx, arr[p1], dx0, dy0);
    };
    ctx.globalCompositeOperation = 'source-over';
    layer(h.back, 0.45);
    layer(h.halo, 0.6);
    // the shadow is pure black on both layers (punch it out of the light layer too)
    ctx.globalAlpha = 1; lctx.globalAlpha = 1;
    const shx = cx - (h.shadow.width >> 1), shy = cy - (h.shadow.height >> 1);
    ctx.drawImage(h.shadow, shx, shy);
    lctx.globalCompositeOperation = 'source-over'; lctx.drawImage(h.shadow, shx, shy); lctx.globalCompositeOperation = 'lighter';
    // infalling matter (behind the shadow it's hidden by drawing order: skip those)
    const I = A.inf;
    ctx.fillStyle = '#fff0a8'; lctx.fillStyle = '#fdbb3a';
    for (let i = 0; i < I.n; i++) {
      const u = fract(t / I.per[i] + I.ph[i]);
      const rho = h.rs * (2.05 + (I.r0[i] - 2.05) * (1 - u) * (1 - u));
      const th = I.th0[i] + (t / I.per[i]) * 2 + Math.pow(1 - u + 0.05, -0.6) * 0.8;
      const px = Math.round(cx + Math.cos(th) * rho), py = Math.round(cy + Math.sin(th) * rho * DISK_INC);
      if (Math.sin(th) < 0 && Math.abs(px - cx) < h.rs) continue;
      const a = smooth(0, 0.15, u) * (0.5 + 0.5 * u);
      ctx.globalAlpha = a; ctx.fillRect(px, py, 1, 1);
      lctx.globalAlpha = a; lctx.fillRect(px, py, 1, 1);
    }
    ctx.globalAlpha = 1;
    layer(h.front, 0.5);
    // flare pulse ring
    if (pu > 0) {
      const rr = h.rs * (1.2 + (1 - pu) * 4);
      lctx.globalAlpha = pu * 0.8; lctx.strokeStyle = '#fff0a8'; lctx.lineWidth = 2;
      lctx.beginPath(); lctx.ellipse(cx, cy, rr, rr * 0.9, 0, 0, TAU); lctx.stroke();
    }
    ctx.globalAlpha = 1; lctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    lctx.globalCompositeOperation = lop;
  }
}

// ---------------------------------------------------------------------------
// Registry, asset cache and public API
// ---------------------------------------------------------------------------

const STAGES = {
  title: [genTitle, TitleStage],
  aurora: [genAurora, AuroraStage],
  cinder: [genCinder, CinderStage],
  veil: [genVeil, VeilStage],
  wreck: [genWreck, WreckStage],
  horizon: [genHorizon, HorizonStage],
};
export const BG_KEYS = Object.keys(STAGES);

const CACHE = new Map();   // key -> { A, refs }
let warned = false;

function runGen(it) { let r, n = 0; prof(); do { r = it.next(); prof('step ' + n++); } while (!r.done); return r.value; }
function freeAssets(A) {
  for (const k in A) {
    const v = A[k];
    if (Array.isArray(v)) v.forEach((x) => { if (x && (x.bands || x.getContext)) freeCanvas(x); });
    else if (v && (v.bands || v.getContext)) freeCanvas(v);
  }
}
function acquire(key) {
  let c = CACHE.get(key);
  if (!c) { c = { A: runGen(STAGES[key][0]()), refs: 0 }; CACHE.set(key, c); }
  c.refs++;
  return c.A;
}
function release(key) {
  const c = CACHE.get(key);
  if (!c) return;
  if (--c.refs <= 0) { freeAssets(c.A); CACHE.delete(key); }
}

// Pre-generate stage assets asynchronously (yields between chunks so a loading bar can
// animate). By default only the title and first sector are built; others are generated
// lazily by createBackground (< 250 ms each) or ahead of time via prewarmBackground().
export async function buildBackgrounds(onProgress, keys = ['title', 'aurora']) {
  keys = keys.filter((k) => STAGES[k]);
  let done = 0;
  for (const key of keys) {
    if (!CACHE.has(key)) {
      const it = STAGES[key][0]();
      let r;
      while (!(r = it.next()).done) {
        if (onProgress) onProgress(Math.min(0.99, (done + 0.5) / keys.length));
        await new Promise((res) => setTimeout(res, 0));
      }
      if (!CACHE.has(key)) CACHE.set(key, { A: r.value, refs: 0 });
    }
    done++;
    if (onProgress) onProgress(done / keys.length);
  }
}

// Optional: warm a stage's assets during a quiet moment (e.g. the results screen).
export function prewarmBackground(key) { return buildBackgrounds(null, [key]); }

export function createBackground(key) {
  if (!STAGES[key]) {
    if (!warned) { console.warn('[backgrounds] unknown key', key); warned = true; }
    key = 'title';
  }
  const A = acquire(key);
  return new STAGES[key][1](A);
}
