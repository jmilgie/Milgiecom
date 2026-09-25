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

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const fract = (v) => v - Math.floor(v);
const mod = (a, n) => ((a % n) + n) % n;

// ---------------------------------------------------------------------------
// Colour, dithering and palette quantisation
// ---------------------------------------------------------------------------

// Packed pixel for a Uint32Array view over RGBA bytes (little-endian: 0xAABBGGRR).
const pack = (r, g, b, a = 255) => (((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
const packHex = (hex, a = 255) => { const c = hexToRgb(hex); return pack(c[0], c[1], c[2], a); };
const unR = (p) => p & 255, unG = (p) => (p >>> 8) & 255, unB = (p) => (p >>> 16) & 255, unA = (p) => p >>> 24;
const cssOf = (hex, a) => { const c = hexToRgb(hex); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };

// 4x4 Bayer thresholds in (0,1)
const BAYER4 = new Float32Array([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16));
const bay = (x, y) => BAYER4[((y & 3) << 2) | (x & 3)];

// Interpolated ramp: stops (hex) -> n colours (hex)
function gradRamp(stops, n) {
  const cs = stops.map(hexToRgb), out = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (cs.length - 1), k = Math.min(cs.length - 2, Math.floor(t)), f = t - k;
    const a = cs[k], b = cs[k + 1];
    out.push('#' + [0, 1, 2].map((j) => Math.round(lerp(a[j], b[j], f)).toString(16).padStart(2, '0')).join(''));
  }
  return out;
}

// Ramp as packed pixels, optionally with alpha
const packRamp = (hexes, a = 255) => Uint32Array.from(hexes.map((h) => packHex(h, a)));

// Ordered-dither a continuous ramp position v (0..n-1) to an index.
function qi(v, x, y, n) {
  if (v <= 0) return 0;
  if (v >= n - 1) return n - 1;
  const i = v | 0;
  return v - i > bay(x, y) ? i + 1 : i;
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

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

class Perlin {
  // px, py: period in lattice cells
  constructor(rng, px, py) {
    this.px = px; this.py = py;
    const n = px * py;
    this.gx = new Float32Array(n); this.gy = new Float32Array(n);
    for (let i = 0; i < n; i++) { const a = rng.next() * TAU; this.gx[i] = Math.cos(a); this.gy[i] = Math.sin(a); }
  }
  at(x, y) {
    const px = this.px, py = this.py, gx = this.gx, gy = this.gy;
    let xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    xi %= px; if (xi < 0) xi += px;
    yi %= py; if (yi < 0) yi += py;
    const x1 = xi + 1 === px ? 0 : xi + 1, y1 = yi + 1 === py ? 0 : yi + 1;
    const r0 = yi * px, r1 = y1 * px;
    const i00 = r0 + xi, i10 = r0 + x1, i01 = r1 + xi, i11 = r1 + x1;
    const d00 = gx[i00] * fx + gy[i00] * fy;
    const d10 = gx[i10] * (fx - 1) + gy[i10] * fy;
    const d01 = gx[i01] * fx + gy[i01] * (fy - 1);
    const d11 = gx[i11] * (fx - 1) + gy[i11] * (fy - 1);
    const u = fade(fx), v = fade(fy);
    const a = d00 + (d10 - d00) * u, b = d01 + (d11 - d01) * u;
    return a + (b - a) * v;
  }
}

// Periodic fbm over a w x h pixel domain. at() returns roughly 0..1 (0.5 mean).
class Fbm {
  constructor(rng, w, h, cell, oct = 5, gain = 0.5, lac = 2) {
    this.w = w; this.h = h; this.oct = [];
    let amp = 1, cs = cell, norm = 0;
    for (let o = 0; o < oct; o++) {
      const px = Math.max(1, Math.round(w / cs)), py = Math.max(1, Math.round(h / cs));
      this.oct.push({ p: new Perlin(rng, px, py), sx: px / w, sy: py / h, amp });
      norm += amp; amp *= gain; cs /= lac;
    }
    this.k = 0.5 * 1.45 / norm;
  }
  at(x, y) {
    let s = 0;
    for (let i = 0; i < this.oct.length; i++) { const o = this.oct[i]; s += o.amp * o.p.at(x * o.sx, y * o.sy); }
    return 0.5 + s * this.k;
  }
  // ridged variant: 1 at creases
  ridge(x, y) {
    let s = 0, n = 0;
    for (let i = 0; i < this.oct.length; i++) {
      const o = this.oct[i];
      s += o.amp * (1 - Math.abs(o.p.at(x * o.sx, y * o.sy)) * 1.6);
      n += o.amp;
    }
    return s / n;
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
function vnoise3(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const a = hash3(xi, yi, zi, s), b = hash3(xi + 1, yi, zi, s), c = hash3(xi, yi + 1, zi, s), d = hash3(xi + 1, yi + 1, zi, s);
  const e = hash3(xi, yi, zi + 1, s), f = hash3(xi + 1, yi, zi + 1, s), g = hash3(xi, yi + 1, zi + 1, s), h = hash3(xi + 1, yi + 1, zi + 1, s);
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
function freeCanvas(c) { if (c && c.width !== undefined) { c.width = 0; c.height = 0; } }

// Draw `img` repeated to cover [0,W)x[0,H), with tile origin at (ax, oy).
function drawTiled(ctx, img, ax, oy, W, H, repeatX = true) {
  const tw = img.width, th = img.height;
  let x0 = ax;
  if (repeatX) { x0 = mod(ax, tw); if (x0 > 0) x0 -= tw; }
  let y0 = mod(oy, th); if (y0 > 0) y0 -= th;
  for (let y = y0; y < H; y += th) {
    if (repeatX) for (let x = x0; x < W; x += tw) ctx.drawImage(img, x, y);
    else ctx.drawImage(img, x0, y);
  }
}

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
  draw(ctx, lctx, ax, oy, W, H, t, alpha = 1, clipY = null) {
    const { w, h } = this;
    let cur = -1;
    for (let i = 0; i < this.n; i++) {
      const sy = mod(this.y[i] + oy, h);
      if (sy >= H) continue;
      let a = 0.5 + 0.5 * Math.sin(t * this.sp[i] + this.ph[i]);
      a = a * a * alpha;
      if (a < 0.04) continue;
      if (this.ci[i] !== cur) { cur = this.ci[i]; ctx.fillStyle = this.css[cur]; lctx.fillStyle = this.css[cur]; }
      const k = this.kind[i];
      for (let sx = mod(this.x[i] + ax, w); sx < W; sx += w) {
        if (clipY && sy >= clipY[sx] - 2) continue;
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

class Stage {
  constructor(key, assets) {
    this.key = key; this.A = assets;
    this.W = 0; this.H = 0; this.fx = 0; this.fy = 0;
    this.time = 0; this.flashT = 0;
    this.S = {};                 // size-dependent canvases
    this.scrollSpeed = 30;
    this.grade = { tint: [1, 1, 1], lift: [0, 0, 0], sat: 1, contrast: 1 };
  }
  resize(W, H, fx = Math.floor((W - FIELD_W) / 2), fy = Math.floor((H - FIELD_H) / 2)) {
    W |= 0; H |= 0; fx |= 0; fy |= 0;
    if (W === this.W && H === this.H && fx === this.fx && fy === this.fy) return;
    this.W = W; this.H = H; this.fx = fx; this.fy = fy;
    this.freeSized();
    this.layout();
  }
  get cx() { return this.fx + FIELD_W / 2; }
  get ax() { return Math.round(this.fx + FIELD_W / 2 - TW / 2); }
  layout() {}
  update(dt) {
    this.time += dt;
    if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt);
    this.step(dt);
  }
  step() {}
  draw() {}
  lensing() { return null; }
  flash() { this.flashT = 1; }
  freeSized() {
    for (const k in this.S) { const v = this.S[k]; if (Array.isArray(v)) v.forEach(freeCanvas); else freeCanvas(v); }
    this.S = {};
  }
  dispose() {
    this.freeSized();
    if (this.A) { release(this.key); this.A = null; }
  }
}

// Additive nebula tile (periodic in x and y). Returns an opaque-black canvas meant for
// 'lighter' compositing. dens(x, y, v) can reshape the noise value v -> 0..1 density.
function nebulaTile(rng, w, h, { cell = 160, oct = 5, warp = 40, ramp, bias = 0.45, contrast = 2.2, profile = null, step = 2, ridged = 0, levels = 0 }) {
  const f = new Fbm(rng, w, h, cell, oct, 0.52);
  const wx = new Fbm(rng, w, h, cell * 1.3, 3, 0.5).field(4);
  const wy = new Fbm(rng, w, h, cell * 1.3, 3, 0.5).field(4);
  const rf = ridged ? new Fbm(rng, w, h, cell * 0.7, 4, 0.55) : null;
  const cw = Math.ceil(w / step), ch = Math.ceil(h / step);
  const coarse = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const px = x * step, py = y * step, i = py * w + px;
    const ox = (wx[i] - 0.5) * warp * 2, oy = (wy[i] - 0.5) * warp * 2;
    let v = f.at(px + ox, py + oy);
    if (rf) v = lerp(v, rf.ridge(px + ox * 0.5, py + oy * 0.5), ridged);
    coarse[y * cw + x] = v;
  }
  const r = new Raster(w, h, true);
  const cols = packRamp(ramp), n = cols.length;
  for (let y = 0; y < h; y++) {
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
  }

  layout() {
    const { W, H } = this, A = this.A, q = A.q;
    const S = this.S;
    prof();
    const portrait = H >= W * 1.2;
    const R = portrait ? Math.max(W * 1.0, 230) : Math.max(W * 0.95, H * 1.2);
    const top = Math.round(portrait ? H * 0.7 : H * 0.62);
    const pcx = W * (portrait ? 0.58 : 0.55), pcy = top + R;
    this.geo = { R, top, pcx, pcy };
    // Flare point on the limb, left of centre.
    const fxp = W * (portrait ? 0.2 : 0.3);
    const fyp = pcy - Math.sqrt(Math.max(0, R * R - (fxp - pcx) ** 2));
    this.flarePos = [Math.round(fxp), Math.round(fyp) - 1];
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

    const sky = new Raster(W, H), pl = new Raster(W, H), em = new Raster(W, H);
    const cityR = hexToRgb('#f0a92a'), cityW = hexToRgb('#fff1c9');
    const gk1 = 1 / (Math.max(W, H) * 0.3), gk2 = 1 / (W * 0.05);
    for (let y = 0; y < H; y++) {
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
          const rim = 0.22 + 0.78 * Math.pow(sdot, 1.6);
          const a1 = Math.exp(-h / 1.6) * rim, a2 = Math.exp(-h / 7) * rim * 0.5, a3 = Math.exp(-h / 34) * rim * 0.2;
          const warm = Math.pow(sdot, 6);
          r += (60 + 195 * warm) * a1 + (30 + 150 * warm) * a2 + 26 * a3;
          g += (170 + 50 * warm) * a1 + (100 + 20 * warm) * a2 + 36 * a3;
          b += (255 - 110 * warm) * a1 + (230 - 150 * warm) * a2 + 90 * a3;
          sky.d[y * W + x] = q.dq(r, g, b, x, y, 20);
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
        const haze = limb * (0.12 + 0.88 * Math.pow(sdot, 1.4));
        const warm = Math.pow(sdot, 6);
        R0 += (50 + 170 * warm) * haze; G0 += (140 + 40 * warm) * haze; B0 += (255 - 110 * warm) * haze;
        R0 += 14 * limb * (1 - sdot); B0 += 36 * limb * (1 - sdot);
        // flare bloom spilling over the planet
        R0 += 70 * g2; G0 += 50 * g2; B0 += 30 * g2;
        // city lights: clustered speckles on islands in the dark
        const dark = 1 - smooth(0.02, 0.25, lit);
        if (dark > 0 && isl > 0.4 && cloud < 0.5) {
          const dens = smooth(0.45, 0.75, nv[3]) * dark * (1 - cloud * 2);
          const hsh = hash3(x, y, 7, 3);
          if (hsh < dens * 0.5) {
            const hot = hsh < dens * 0.12;
            const c = hot ? cityW : cityR, k = (hot ? 0.95 : 0.55) * dark;
            R0 = lerp(R0, c[0], k); G0 = lerp(G0, c[1], k); B0 = lerp(B0, c[2], k);
            em.d[y * W + x] = pack(c[0] * k * 0.55, c[1] * k * 0.5, c[2] * k * 0.4);
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
    S.sky = sky.toCanvas();
    S.planet = pl.toCanvas();
    S.em = em.toCanvas();
    prof('title toCanvas');

    // Nebula wisps above the planet, periodic in x; calm band where the logo sits.
    const nh = Math.max(64, top);
    const nprof = (y) => {
      const v = y / H;
      const calm = 1 - 0.92 * Math.exp(-(((v - 0.25) / 0.13) ** 2));
      return calm * (0.55 + 0.45 * smooth(0, 0.12, v)) * (1 - 0.5 * smooth(top * 0.8, top, y));
    };
    const nrng = new Rng(0xabc1);
    S.nebFar = nebulaTile(nrng, TW, nh, { cell: 110, oct: 5, warp: 34, bias: 0.5, contrast: 2.4, profile: nprof,
      ramp: ['#000000', '#050414', '#0a0822', '#100c34', '#18124a', '#231a60'] });
    S.nebNear = nebulaTile(nrng, TW, nh, { cell: 70, oct: 5, warp: 26, bias: 0.57, contrast: 3.0, ridged: 0.55, profile: nprof,
      ramp: ['#000000', '#0c0412', '#1a071e', '#2c0b2a', '#441434', '#5e1e3c'] });

    prof('title nebula');
    // Aurora curtains along the night-side limb: 8 looping frames.
    this.buildAurora(R, pcx, pcy, s2x, s2y);
    prof('title aurora');
    this.buildRing(portrait);
    prof('title ring');
    // Flare sprites
    S.flare = flareSprite(portrait ? 71 : 91, FLARE_RAMP, { rays: 6, rot: 0.35 });
    S.streak = streakSprite(Math.round(W * 1.4), STREAK_RAMP, W * 0.24);
    // Traffic from the station down toward the planet
    const [rx, ry] = this.ring.c;
    this.traffic = new Traffic([
      { x0: rx - 4, y0: ry + 2, x1: rx - W * 0.45, y1: top + 30, period: 26, phase: 0, col: '#aebfdc', eng: '#79ecff' },
      { x0: rx + 6, y0: ry - 3, x1: W + 10, y1: ry - H * 0.2, period: 34, phase: 13, col: '#aebfdc', eng: '#ffab4f' },
      { x0: -10, y0: top - H * 0.08, x1: rx - 8, y1: ry, period: 40, phase: 22, col: '#7c8fb3', eng: '#79ecff' },
    ]);
  }

  buildAurora(R, pcx, pcy, s2x, s2y) {
    const { W, H } = this;
    const x0 = Math.floor(pcx), x1 = W, y0 = Math.max(0, Math.floor(this.geo.top - 26)), y1 = Math.min(H, Math.floor(this.geo.top + 60));
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
    }
    this.S.aurora = frames;
    this.auroraPos = [x0, y0];
  }

  // Aurora Station: a tilted torus with spokes, hub and solar wings, backlit from the left.
  buildRing(portrait) {
    const { W, H } = this, top = this.geo.top;
    const a = Math.round(portrait ? W * 0.23 : H * 0.25), b = Math.round(a * 0.34);
    const cx = Math.round(W * (portrait ? 0.7 : 0.72)), cy = Math.round(portrait ? top - H * 0.14 : top - H * 0.24);
    this.ring = { c: [cx, cy], a, b };
    const pad = 14, w = a * 2 + pad * 2, h = b * 2 + pad * 2 + 16;
    const ox = cx - w / 2, oy = cy - h / 2 - 6;
    const r = new Raster(w, h), e = new Raster(w, h);
    const rot = -0.16, cr = Math.cos(rot), sr = Math.sin(rot);
    const P = (th, rad = 1) => {
      const lx = Math.cos(th) * a * rad, ly = Math.sin(th) * b * rad;
      return [cx - ox + lx * cr - ly * sr, cy - oy + lx * sr + ly * cr];
    };
    const cD = packHex('#0b0f1a'), c1 = packHex('#141a28'), c2 = packHex('#222b42'), c3 = packHex('#36425f'), c4 = packHex('#526283'),
      rimW = packHex('#ffd49a'), rimC = packHex('#aebfdc'), win = packHex('#ffd966'), winC = packHex('#79ecff');
    const tube = (front) => {
      const tr = front ? Math.max(2, a * 0.055) : Math.max(1.5, a * 0.045);
      for (let th = 0; th < TAU; th += 0.35 / a) {
        const s = Math.sin(th);
        if ((s > 0) !== front) continue;
        const [px, py] = P(th);
        for (let yy = -3; yy <= 3; yy++) for (let xx = -3; xx <= 3; xx++) {
          const dd = Math.hypot(xx, yy); if (dd > tr) continue;
          // lighting: sun from the left/behind -> rim on the left/top edge of the tube
          const nx = xx / (tr + 0.01), ny = yy / (tr + 0.01);
          const lit = -nx * 0.8 - ny * 0.5;
          const edge = dd > tr - 1.1;
          let c = front ? c2 : c1;
          if (lit > 0.35) c = front ? c3 : c2;
          if (edge && lit > 0.55) c = Math.cos(th) < -0.2 ? rimW : front ? c4 : c3;
          if (!edge && lit < -0.3) c = front ? c1 : cD;
          r.set(px + xx, py + yy, c);
        }
      }
      // habitat modules along the outer edge
      for (let k = 0; k < 16; k++) {
        const th = (k / 16) * TAU + 0.1;
        if ((Math.sin(th) > 0) !== front) continue;
        const [px, py] = P(th, 1.07);
        const sz = front ? 3 : 2;
        r.rect(px - 1, py - 1, sz, sz - 1, front ? c2 : c1);
        r.set(px - 1, py - 1, Math.cos(th) < 0 ? rimW : c4);
        if (front) e.set(px, py, win);
      }
      // windows on the inner face
      if (front) for (let th = 0.3; th < Math.PI - 0.3; th += 0.13) {
        if (Math.sin(th * 7) < -0.2) continue;
        const [px, py] = P(th, 0.95);
        r.set(px, py, win); e.set(px, py, win);
      }
    };
    const spokes = (front) => {
      for (let k = 0; k < 4; k++) {
        const th = 0.5 + (k * Math.PI) / 2;
        if ((Math.sin(th) > 0) !== front) continue;
        const [px, py] = P(th, 0.94);
        r.line(cx - ox, cy - oy, px, py, front ? c2 : c1);
        r.line(cx - ox, cy - oy - 1, px, py - 1, front ? c3 : c2);
      }
    };
    tube(false);
    spokes(false);
    // hub + solar wings
    const hx = cx - ox, hy = cy - oy;
    for (let k = -1; k <= 1; k += 2) {
      for (let i = 4; i < a * 0.55; i++) {
        const x = hx + k * i, y = hy + Math.round(k * i * sr) + 0;
        r.set(x, y - 2, packHex('#0d2342')); r.set(x, y - 1, packHex(i % 3 ? '#13294f' : '#1b3a66'));
        r.set(x, y, packHex('#0b1530'));
        if (i % 3 === 0 && k < 0) r.set(x, y - 2, packHex('#4c86ff'));
      }
    }
    r.rect(hx - 2, hy - 6, 5, 10, c2);
    r.vline(hx - 2, hy - 6, hy + 3, c4); r.vline(hx + 2, hy - 6, hy + 3, c1);
    r.set(hx - 2, hy - 6, rimW);
    r.vline(hx, hy - 12, hy - 7, c3); r.set(hx, hy - 12, rimC);
    r.rect(hx - 3, hy - 1, 7, 2, c3); r.set(hx - 3, hy - 1, rimW);
    e.set(hx, hy - 12, packHex('#ff5a5a'));
    e.set(hx + 1, hy - 4, winC); r.set(hx + 1, hy - 4, winC); e.set(hx + 1, hy - 2, winC); r.set(hx + 1, hy - 2, winC);
    spokes(true);
    tube(true);
    // dark 1px outline around the silhouette so it separates from the glow behind
    const out = new Raster(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = r.d[y * w + x];
      if (v) { out.d[y * w + x] = v; continue; }
      if ((x > 0 && r.d[y * w + x - 1]) || (x < w - 1 && r.d[y * w + x + 1]) || (y > 0 && r.d[(y - 1) * w + x]) || (y < h - 1 && r.d[(y + 1) * w + x]))
        out.d[y * w + x] = packHex('#05040c', 200);
    }
    this.S.ring = out.toCanvas();
    this.S.ringE = e.toCanvas();
    this.ringPos = [Math.round(ox), Math.round(oy)];
    // blinking beacons: hub top and both ring tips
    const tipL = P(Math.PI), tipR = P(0);
    this.beacons = [[hx + ox, hy - 12 + oy, 0], [tipL[0] + ox - 1, tipL[1] + oy, 1.3], [tipR[0] + ox + 1, tipR[1] + oy, 2.1]].map((p) => [Math.round(p[0]), Math.round(p[1]), p[2]]);
  }

  draw(ctx, lctx, scrollY, t) {
    const { W, H, S, A } = this;
    if (!S.sky) return;
    const lop = lctx.globalCompositeOperation;
    ctx.drawImage(S.sky, 0, 0);
    const vy = Math.round(scrollY * 0.02);
    ctx.globalCompositeOperation = 'lighter';
    drawTiled(ctx, A.starsFar, Math.round(-t * 0.35), vy, W, H);
    drawTiled(ctx, S.nebFar, Math.round(-t * 0.8), 0, W, S.nebFar.height);
    drawTiled(ctx, A.starsMid, Math.round(-t * 0.7), vy * 2, W, H);
    drawTiled(ctx, S.nebNear, Math.round(-t * 1.6), 0, W, S.nebNear.height);
    ctx.globalCompositeOperation = 'source-over';
    A.tw.draw(ctx, lctx, Math.round(-t * 0.7), vy * 2, W, this.geo.top - 4, t);
    ctx.drawImage(S.planet, 0, 0);
    // aurora curtains (crossfade between baked frames)
    const af = (t * 1.6) % 8, i0 = Math.floor(af), i1 = (i0 + 1) % 8, k = af - i0;
    const [ax0, ay0] = this.auroraPos;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 1 - k; ctx.drawImage(S.aurora[i0], ax0, ay0);
    ctx.globalAlpha = k; ctx.drawImage(S.aurora[i1], ax0, ay0);
    lctx.globalCompositeOperation = 'lighter';
    lctx.globalAlpha = 0.5 * (1 - k); lctx.drawImage(S.aurora[i0], ax0, ay0);
    lctx.globalAlpha = 0.5 * k; lctx.drawImage(S.aurora[i1], ax0, ay0);
    lctx.globalAlpha = 0.9; lctx.drawImage(S.em, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // station
    const [rx, ry] = this.ringPos;
    ctx.drawImage(S.ring, rx, ry);
    lctx.globalAlpha = 0.8; lctx.drawImage(S.ringE, rx, ry);
    for (const [bx, by, ph] of this.beacons) {
      const on = fract(t * 0.7 + ph) < 0.12;
      if (!on) continue;
      ctx.fillStyle = '#ff5a5a'; ctx.fillRect(bx, by, 1, 1);
      lctx.globalAlpha = 1; lctx.fillStyle = '#ff5a5a'; lctx.fillRect(bx - 1, by, 3, 1); lctx.fillRect(bx, by - 1, 1, 3);
    }
    this.traffic.draw(ctx, lctx, t);
    // sun flare + anamorphic streak + ghosts
    const [fx, fy] = this.flarePos;
    const breathe = 0.85 + 0.15 * Math.sin(t * 0.7);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = breathe;
    ctx.drawImage(S.flare, fx - (S.flare.width >> 1), fy - (S.flare.height >> 1));
    ctx.globalAlpha = 0.55 * breathe;
    ctx.drawImage(S.streak, fx - (S.streak.width >> 1), fy - 2);
    lctx.globalAlpha = 0.75 * breathe;
    lctx.drawImage(S.flare, fx - (S.flare.width >> 1), fy - (S.flare.height >> 1));
    lctx.globalAlpha = 0.35 * breathe;
    lctx.drawImage(S.streak, fx - (S.streak.width >> 1), fy - 2);
    const gcx = W * 0.5, gcy = H * 0.45;
    const gs = [[0.5, A.ghost, 0.3], [0.9, A.ghost2, 0.3], [1.3, A.ghost, 0.2], [1.62, A.ghost2, 0.22]];
    for (const [u, img, al] of gs) {
      const gx = Math.round(lerp(fx, gcx, u) * 1) - (img.width >> 1), gy = Math.round(lerp(fy, gcy, u)) - (img.height >> 1);
      ctx.globalAlpha = al * breathe; ctx.drawImage(img, gx, gy);
      lctx.globalAlpha = al * 0.5 * breathe; lctx.drawImage(img, gx, gy);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    lctx.globalAlpha = 1; lctx.globalCompositeOperation = lop;
  }
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
  const { w, h, d } = r, o = new Raster(w, h, r.wrap);
  o.d.set(d);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[y * w + x]) continue;
    const l = r.wrap ? mod(x - 1, w) : x - 1, rr = r.wrap ? mod(x + 1, w) : x + 1, u = r.wrap ? mod(y - 1, h) : y - 1, dn = r.wrap ? mod(y + 1, h) : y + 1;
    if ((l >= 0 && d[y * w + l]) || (rr < w && d[y * w + rr]) || (u >= 0 && d[u * w + x]) || (dn < h && d[dn * w + x])) o.d[y * w + x] = c;
  }
  return o;
}

// Blinking beacons / lights in tile space (x, y), drawn per frame.
class Blinkers {
  constructor(w, h) { this.w = w; this.h = h; this.list = []; }
  add(x, y, col, period = 1.6, phase = 0, duty = 0.14, size = 1) { this.list.push({ x: Math.round(mod(x, this.w)), y: Math.round(mod(y, this.h)), col, period, phase, duty, size }); return this; }
  draw(ctx, lctx, ax, oy, W, H, t) {
    const { w, h } = this;
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i];
      const u = fract(t / b.period + b.phase);
      if (u > b.duty) continue;
      const a = 1 - u / b.duty * 0.6;
      const sy = mod(b.y + oy, h);
      if (sy >= H + 2) continue;
      ctx.fillStyle = b.col; lctx.fillStyle = b.col;
      for (let sx = mod(b.x + ax, w); sx < W + 2; sx += w) {
        ctx.globalAlpha = a; ctx.fillRect(sx, sy, 1, 1);
        lctx.globalAlpha = a; lctx.fillRect(sx - 1, sy, 3, 1); lctx.fillRect(sx, sy - 1, 1, 3);
        if (b.size > 1) { lctx.globalAlpha = a * 0.4; lctx.fillRect(sx - 2, sy - 1, 5, 3); lctx.fillRect(sx - 1, sy - 2, 3, 5); ctx.globalAlpha = a * 0.6; ctx.fillRect(sx - 1, sy, 3, 1); ctx.fillRect(sx, sy - 1, 1, 3); }
      }
    }
    ctx.globalAlpha = 1; lctx.globalAlpha = 1;
  }
}

// Flickering spark sources (welding, grinding). Each source sprays a few pixels.
const SPARK_COLS = ['#fff5c9', '#ffd966', '#ffab4f', '#f7721f'];
class Sparks {
  constructor(w, h) { this.w = w; this.h = h; this.list = []; }
  add(x, y, dirx = 0, diry = 1, rate = 1, phase = 0) { this.list.push({ x: Math.round(mod(x, this.w)), y: Math.round(mod(y, this.h)), dirx, diry, rate, phase }); return this; }
  draw(ctx, lctx, ax, oy, W, H, t) {
    const { w, h } = this;
    for (let i = 0; i < this.list.length; i++) {
      const s = this.list[i];
      const u = fract(t * 0.25 * s.rate + s.phase);
      if (u > 0.45) continue;               // bursts
      const sy = mod(s.y + oy, h);
      if (sy >= H + 8 || sy < -8) continue;
      const fr = Math.floor(t * 24 + i * 7);
      for (let sx = mod(s.x + ax, w); sx < W + 8; sx += w) {
        lctx.globalAlpha = 0.7; lctx.fillStyle = '#ffab4f'; lctx.fillRect(sx - 1, sy - 1, 3, 3);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(sx, sy, 1, 1);
        for (let k = 0; k < 4; k++) {
          const hsh = hash3(fr, k, i, 5), hsh2 = hash3(fr, k, i, 9);
          const dist = 1 + hsh * 6, ang = Math.atan2(s.diry, s.dirx) + (hsh2 - 0.5) * 2.2;
          const px = Math.round(sx + Math.cos(ang) * dist), py = Math.round(sy + Math.sin(ang) * dist);
          ctx.fillStyle = SPARK_COLS[(hsh * 4) | 0]; ctx.globalAlpha = 1 - hsh * 0.6;
          ctx.fillRect(px, py, 1, 1);
          lctx.fillStyle = ctx.fillStyle; lctx.globalAlpha = 0.8; lctx.fillRect(px, py, 1, 1);
        }
        ctx.globalAlpha = 1;
      }
    }
    ctx.globalAlpha = 1; lctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------
// AURORA (S1) — orbital shipyard above a blue ocean world at dawn
// ---------------------------------------------------------------------------

const SUN_UR = [0.6, -0.8];
const M_FAR = () => mat(['#0c1a2a', '#142638', '#1e3449', '#2c465e', '#3f5d78', '#5a7a96'], '#9cc4dc');
const M_MID = () => mat(['#0e121c', '#171d2c', '#232c40', '#34405a', '#4c5c7c', '#71849f'], '#d6e4f4');
const M_NEAR = () => mat(['#06070d', '#0b0e17', '#131826', '#1e2537', '#2f3a52', '#4a5876'], '#ffcf9a');
const M_HULL = () => mat(['#141a26', '#202938', '#2f3b4f', '#46556c', '#65778f', '#8a9cb3'], '#e6eefa');
const M_HAZ = () => mat(['#3d2106', '#7a430b', '#bf7412', '#f0a92a'], '#ffd966');

function* genAurora() {
  const rng = new Rng(0xa11ce);
  const A = {};
  const TH = 512;
  // --- planet surface: ocean, archipelagos, city lights (periodic) ---
  const oc = new Fbm(rng, TW, TH, 128, 4, 0.5).field(2);
  const il = new Fbm(rng, TW, TH, 80, 5, 0.55).field(2);
  const ct = new Fbm(rng, TW, TH, 12, 2, 0.5).field(1);
  const surf = new Raster(TW, TH, true), lights = new Raster(TW, TH, true);
  lights.d.fill(0xff000000);   // opaque black: multiply by the night mask must not accumulate
  const OC = packRamp(['#041526', '#062238', '#08304e', '#0c4166', '#115680', '#18709c']);
  const SH = packRamp(['#12628c', '#1c86ab', '#3aa6c4', '#7cc9d8']);
  const LD = packRamp(['#1d3a30', '#2a4f38', '#3d6440', '#5b7a4c', '#8a8a5e', '#b0a070']);
  const amber = hexToRgb('#f0a92a'), hot = hexToRgb('#fff1c9');
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
    const i = y * TW + x, l = il[i];
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
  A.surf = surf.toCanvas(); A.lights = lights.toCanvas();
  yield;
  // --- cloud bands with shadows (alpha) ---
  const cf = new Fbm(rng, TW, TH * 2, 120, 5, 0.55);
  const cw = new Fbm(rng, TW, TH * 2, 90, 3, 0.5);
  const dens = new Float32Array(TW * TH);
  for (let y = 0; y < TH; y += 2) for (let x = 0; x < TW; x += 2) {
    const w = cw.at(x, y * 2);
    const v = cf.at(x + (w - 0.5) * 60, y * 2 + (w - 0.5) * 30);
    dens[y * TW + x] = smooth(0.5, 0.7, v);
  }
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {       // bilinear fill of odd pixels
    if (!(y & 1) && !(x & 1)) continue;
    const x0 = x & ~1, y0 = y & ~1, x1 = (x0 + 2) % TW, y1 = (y0 + 2) % TH, tx = (x - x0) / 2, ty = (y - y0) / 2;
    const a = dens[y0 * TW + x0], b = dens[y0 * TW + x1], c = dens[y1 * TW + x0], d = dens[y1 * TW + x1];
    dens[y * TW + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }
  const cl = new Raster(TW, TH, true);
  const CL = packRamp(['#4d6d90', '#7394b4', '#a2bfd6', '#cadcec', '#e8f1f9']);
  const shadow = pack(2, 10, 22, 150);
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
    const v = dens[y * TW + x];
    const a = v > 0.12 ? (v > 0.45 ? 1 : bay(x, y) < (v - 0.12) * 3 ? 1 : 0) : 0;
    if (a) { cl.d[y * TW + x] = CL[qi(v * 4.4 - 0.4, x, y, 5)]; continue; }
    const s = dens[mod(y - 3, TH) * TW + mod(x + 2, TW)];
    if (s > 0.3) cl.d[y * TW + x] = shadow;
  }
  A.clouds = cl.toCanvas();
  yield;

  // --- far station layer (f = 0.22): ring-station spine trusses, modules, solar wings ---
  {
    const H = 768, r = new Raster(TW, H, true), e = new Raster(TW, H, true), m = M_FAR(), sun = SUN_UR;
    const bl = new Blinkers(TW, H);
    const spine = (y, w) => {
      kTruss(r, 0, y, TW, y, w, m, sun);
      for (let x = 10; x < TW; x += 64 + rng.int(0, 30)) {
        const len = rng.int(18, 34), rad = rng.int(2, 3);
        if (rng.chance(0.55)) {
          kCyl(r, x, y - rad, len, rad, true, m, sun, { seg: 5 });
          for (let k = 2; k < len - 2; k += 3) if (rng.chance(0.6)) e.set(x + k, y, packHex(rng.chance(0.8) ? '#c9a24e' : '#6fb8d8'));
        } else {
          const sw = rng.int(10, 16), sh = rng.int(5, 7);
          kBeam(r, x + 4, y - w / 2 - sh - 1, x + 4, y + w / 2 + sh + 1, 1, m, sun);
          kSolar(r, x - sw / 2 + 4, y - w / 2 - sh - 2, sw, sh, 0.4);
          kSolar(r, x - sw / 2 + 4, y + w / 2 + 3, sw, sh, 0.1);
        }
        bl.add(x, y - w / 2 - 1, '#ff5a5a', 2.2, rng.next(), 0.12);
      }
    };
    spine(110, 9);
    spine(468, 6);
    // docking hub on the upper spine
    kBall(r, 246, 110, 9, m, sun);
    kCyl(r, 243, 86, 16, 3, false, m, sun, { seg: 4 });
    kCyl(r, 243, 121, 12, 3, false, m, sun, { seg: 4 });
    bl.add(246, 84, '#ffffff', 1.3, 0.2, 0.1);
    e.set(244, 106, packHex('#c9a24e')); e.set(248, 108, packHex('#c9a24e')); e.set(246, 113, packHex('#6fb8d8'));
    // loose cargo pods and a tug between the spines
    for (let k = 0; k < 7; k++) {
      const x = rng.int(0, TW), y = rng.int(180, 420);
      kBox(r, x, y, rng.int(4, 7), rng.int(3, 4), m, sun);
    }
    kTruss(r, 60, 468, 110, 610, 5, m, sun);
    kBox(r, 100, 606, 18, 9, m, sun, { panels: 3 });
    bl.add(118, 606, '#ff5a5a', 1.9, 0.5, 0.12);
    A.far = outlined(r, pack(8, 14, 24, 180)).toCanvas(); A.farE = e.toCanvas(); A.farB = bl;
  }
  yield;

  // --- mid layer (f = 0.5): a warship under construction in its dock cradle, fuel depot ---
  {
    const H = 1024, r = new Raster(TW, H, true), e = new Raster(TW, H, true), m = M_MID(), hm = M_HULL(), sun = SUN_UR;
    const bl = new Blinkers(TW, H), sp = new Sparks(TW, H);
    // hull profile: nose at top (y0), widest at 40%, engine block at the bottom
    const cx = 248, y0 = 250, len = 230;
    const half = (u) => (u < 0.35 ? 4 + 20 * Math.sqrt(u / 0.35) : u < 0.85 ? 24 - (u - 0.35) * 8 : 20);
    // cradle frame
    kTruss(r, cx - 36, y0 - 30, cx - 36, y0 + len + 20, 6, m, sun, { heavy: true });
    kTruss(r, cx + 36, y0 - 30, cx + 36, y0 + len + 20, 6, m, sun, { heavy: true });
    for (let k = 0; k < 5; k++) {
      const yy = y0 + 10 + k * 52;
      kBeam(r, cx - 36, yy, cx + 36, yy, 2, m, sun);
    }
    // ribs & plating
    const plated = (u) => (u > 0.08 && u < 0.3) || (u > 0.52 && u < 0.7) || u > 0.86;
    for (let yy = 0; yy < len; yy++) {
      const u = yy / len, hw = half(u), Y = y0 + yy;
      if (plated(u)) {
        for (let xx = -hw; xx <= hw; xx++) {
          const nx = xx / (hw + 0.5), nz = Math.sqrt(Math.max(0, 1 - nx * nx));
          const l = nx * sun[0] * 0.9 + nz * 0.35 + (yy % 14 === 0 ? -0.35 : 0) + ((xx + 40) % 9 === 0 ? -0.12 : 0);
          const v = clamp01(0.42 + l * 0.6) * (hm.n - 1);
          r.set(cx + xx, Y, hm.c[qi(v, cx + xx, Y, hm.n)]);
        }
        if (Math.abs(yy % 14) === 1) { r.set(cx - hw, Y, mc(hm, 0)); }
      } else {
        // open ribs every 5 px + keel + stringers
        if (yy % 5 === 0) for (let xx = -hw; xx <= hw; xx++) r.set(cx + xx, Y + Math.round((xx / hw) ** 2 * 2), mc(m, xx > 0 ? 4 : 2));
        r.set(cx, Y, mc(m, 3)); r.set(cx - 1, Y, mc(m, 1));
        r.set(cx - Math.round(hw * 0.6), Y, mc(m, 1)); r.set(cx + Math.round(hw * 0.6), Y, mc(m, 3));
        r.set(cx - hw, Y, mc(m, 2)); r.set(cx + hw, Y, mc(m, 4));
      }
      // welding sparks along plating edges
      if (plated(u) !== plated((yy - 1) / len) && yy > 0) {
        sp.add(cx + rng.int(-hw + 2, hw - 2), Y, 0, -1, rng.range(0.8, 1.6), rng.next());
        sp.add(cx + (rng.chance(0.5) ? -hw : hw), Y + 2, rng.sign(), 0.5, rng.range(0.8, 1.6), rng.next());
      }
    }
    // engine bells + bridge tower
    for (let k = -1; k <= 1; k++) kCyl(r, cx + k * 12 - 4, y0 + len, 6, 4, false, hm, sun, { seg: 0 });
    kBox(r, cx - 6, y0 + 118, 12, 18, hm, sun, { panels: 4, base: 3 });
    for (let k = 0; k < 4; k++) e.set(cx - 4 + k * 3, y0 + 121, packHex('#79ecff'));
    bl.add(cx, y0 - 2, '#ff5a5a', 1.2, 0, 0.18, 2);
    bl.add(cx - 36, y0 - 32, '#ffffff', 2.0, 0.3, 0.1);
    bl.add(cx + 36, y0 - 32, '#ffffff', 2.0, 0.8, 0.1);
    bl.add(cx - 36, y0 + len + 22, '#6fd23f', 1.7, 0.1, 0.15);
    bl.add(cx + 36, y0 + len + 22, '#ff5a5a', 1.7, 0.6, 0.15);
    // hazard stripes on the cradle foot
    const hz = M_HAZ();
    for (let xx = 0; xx < 72; xx++) for (let yy = 0; yy < 3; yy++) r.set(cx - 36 + xx, y0 + len + 24 + yy, ((xx + yy) >> 2) & 1 ? mc(hz, 2) : mc(hz, 0));
    // fuel depot on the left
    const fx = 70, fy = 690;
    kTruss(r, 0, fy, TW, fy, 7, m, sun);
    for (let k = 0; k < 3; k++) kBall(r, fx - 20 + k * 22, fy - 13, 9, hm, sun);
    for (let k = 0; k < 2; k++) kBall(r, fx - 9 + k * 22, fy + 14, 8, hm, sun);
    kCyl(r, 160, fy - 4, 40, 4, true, m, sun, { seg: 6 });
    for (let k = 0; k < 6; k++) e.set(163 + k * 6, fy - 1, packHex('#ffd966'));
    bl.add(fx - 20, fy - 23, '#ff5a5a', 1.5, 0.35, 0.13);
    bl.add(fx + 24, fy - 23, '#ff5a5a', 1.5, 0.85, 0.13);
    // a gantry crossing everything with a traveling crane
    const gy = 930;
    kTruss(r, 0, gy, TW, gy, 12, m, sun, { heavy: true });
    kBox(r, 150, gy - 9, 22, 18, m, sun, { panels: 5, base: 3 });
    r.line(161, gy + 9, 161, gy + 40, mc(m, 2));
    kBox(r, 154, gy + 40, 14, 8, hz, sun);
    e.set(152, gy - 6, packHex('#ffd966')); e.set(169, gy - 6, packHex('#ffd966'));
    bl.add(161, gy - 10, '#ffab4f', 0.9, 0, 0.35);
    A.mid = outlined(r, pack(4, 6, 12, 220)).toCanvas(); A.midE = e.toCanvas(); A.midB = bl; A.midS = sp;
  }
  yield;

  // --- near layer (f = 0.9): massive dark girders, a crane reaching in, a docking arm ---
  {
    const H = 1024, r = new Raster(TW, H, true), e = new Raster(TW, H, true), m = M_NEAR(), sun = SUN_UR, hz = M_HAZ();
    const bl = new Blinkers(TW, H);
    // left crane tower + jib + hanging container
    kTruss(r, 44, 60, 44, 520, 14, m, sun, { heavy: true });
    kTruss(r, 30, 120, 170, 120, 9, m, sun, { heavy: true });
    kBox(r, 36, 104, 18, 12, m, sun, { panels: 4, base: 3 });
    e.set(50, 108, packHex('#ffd966')); e.set(47, 108, packHex('#ffd966'));
    r.line(162, 124, 162, 196, mc(m, 3));
    kBox(r, 150, 196, 26, 14, hz, sun, { panels: 6 });
    for (let yy = 196; yy < 210; yy += 2) r.hline(150, 175, yy, mc(m, 1));
    bl.add(170, 116, '#ff5a5a', 1.4, 0, 0.14, 2);
    bl.add(44, 56, '#ff5a5a', 1.4, 0.5, 0.14, 2);
    // right docking arm with cradle clamps
    kTruss(r, 300, 640, 212, 700, 12, m, sun, { heavy: true });
    kBox(r, 196, 692, 22, 20, m, sun, { panels: 5, base: 3 });
    kBeam(r, 196, 712, 186, 740, 4, m, sun);
    kBeam(r, 218, 712, 228, 740, 4, m, sun);
    for (let k = 0; k < 5; k++) e.set(199 + k * 4, 697, packHex(k % 2 ? '#79ecff' : '#ffd966'));
    bl.add(186, 742, '#ffffff', 1.1, 0.25, 0.12, 2);
    bl.add(228, 742, '#ffffff', 1.1, 0.75, 0.12, 2);
    kTruss(r, 280, 300, 280, 1000, 16, m, sun, { heavy: true });
    bl.add(280, 300, '#ff5a5a', 1.6, 0.2, 0.14, 2);
    // bridge girder crossing the whole screen
    const by = 900;
    kTruss(r, 0, by, TW, by, 18, m, sun, { heavy: true });
    for (let x = 0; x < TW; x += 40) {
      e.set(x + 6, by - 10, packHex('#ffd966'));
      bl.add(x + 26, by + 10, '#ff5a5a', 2.4, x / TW, 0.1);
    }
    for (let xx = 0; xx < TW; xx++) for (let yy = 0; yy < 2; yy++) r.set(xx, by + 10 + yy, ((xx + yy) >> 2) & 1 ? mc(hz, 2) : mc(hz, 0));
    A.near = outlined(r, pack(2, 2, 6, 235)).toCanvas(); A.nearE = e.toCanvas(); A.nearB = bl;
  }
  A.stars = starTile(rng, TW, 320, 500, { maxB: 0.8, pow: 2.2, big: 0.05, raster: true });
  A.tw = new Twinkles(rng, 30, TW, 400, 0.02, { bigChance: 0.3 });
  return A;
}

const PAL_AURORA_SKY = [...RAMPS.void, ...RAMPS.ocean, ...RAMPS.dawn, ...RAMPS.sapphire.slice(0, 5), '#27c2ea', '#79ecff', '#d6fcff', '#ffffff', '#fff5c9', '#ffd966', '#081a33', '#0d2342', '#13294f', '#1b3a66'];

class AuroraStage extends Stage {
  constructor(A) {
    super('aurora', A);
    this.scrollSpeed = 28;
    this.grade = { tint: [0.98, 1.0, 1.04], lift: [0.0, 0.008, 0.024], sat: 1.08, contrast: 1.06 };
    this.q = new Quant(PAL_AURORA_SKY);
  }
  layout() {
    const { W, H } = this, S = this.S, q = this.q;
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
        const rim = 0.3 + 0.7 * Math.pow(sdot, 1.5), warm = Math.pow(sdot, 5);
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
      const limbF = (1 - nz) ** 3 * (0.2 + 0.8 * Math.pow(sdot, 1.2));
      const hv = clamp01(limbF * 1.3 + g2 * 0.9 + g1 * 0.15);
      if (hv > 0.03) {
        const hk = qi(hv * 5, x, y, 6) / 5, warm = Math.pow(sdot, 6) * 0.8 + g2;
        hz.d[i] = pack((40 + 180 * warm) * hk, (110 + 50 * warm) * hk, (200 - 60 * warm) * hk);
      } else hz.d[i] = 0xff000000;
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
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (y > this.limb[x]) { sky.d[i] = 0; continue; }
      if (y >= this.limb[x] - 1) continue;
      const s = st.d[(y % st.h) * st.w + mod(x - ax, st.w)];
      if (s & 0xffffff) { const p = sky.d[i]; sky.d[i] = pack(Math.min(255, unR(p) + unR(s)), Math.min(255, unG(p) + unG(s)), Math.min(255, unB(p) + unB(s))); }
    }
    prof('aurora pixels');
    S.sky = sky.toCanvas(); S.lm = lm.toCanvas(); S.haze = hz.toCanvas(); S.nm = nm.toCanvas(); S.em = em.toCanvas();
    // city-light composite
    S.lc = makeCanvas(W, H); this.lcx = ctx2d(S.lc);
    S.flare = flareSprite(portrait ? 61 : 81, FLARE_RAMP, { rays: 4, rot: 0.2 });
    S.streak = streakSprite(Math.round(W * 1.2), STREAK_RAMP, W * 0.2);
    prof('aurora canvases');
  }
  draw(ctx, lctx, scrollY, t) {
    const { W, H, S, A } = this;
    if (!S.sky) return;
    const lop = lctx.globalCompositeOperation;
    const ax = this.ax;
    // planet surface + clouds, lit by a multiply light map, hazed at the limb
    drawTiled(ctx, A.surf, ax, Math.round(scrollY * 0.045), W, H);
    drawTiled(ctx, A.clouds, ax + Math.round(t * 0.6), Math.round(scrollY * 0.07), W, H);
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(S.lm, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(S.haze, 0, 0);
    // city lights masked to the night side
    const lc = this.lcx;
    lc.globalCompositeOperation = 'source-over';
    drawTiled(lc, A.lights, ax, Math.round(scrollY * 0.045), W, H);
    lc.globalCompositeOperation = 'multiply';
    lc.drawImage(S.nm, 0, 0);
    ctx.drawImage(S.lc, 0, 0);
    lctx.globalCompositeOperation = 'lighter';
    lctx.globalAlpha = 0.7; lctx.drawImage(S.lc, 0, 0);
    // space above the limb
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(S.sky, 0, 0);
    A.tw.draw(ctx, lctx, ax, 0, W, H, t, 1, this.limb);
    lctx.globalAlpha = 1; lctx.drawImage(S.em, 0, 0);
    // sun
    const [sx, sy] = this.sun;
    const br = 0.9 + 0.1 * Math.sin(t * 0.9);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = br; ctx.drawImage(S.flare, sx - (S.flare.width >> 1), sy - (S.flare.height >> 1));
    ctx.globalAlpha = 0.45 * br; ctx.drawImage(S.streak, sx - (S.streak.width >> 1), sy - 2);
    lctx.globalAlpha = 0.7 * br; lctx.drawImage(S.flare, sx - (S.flare.width >> 1), sy - (S.flare.height >> 1));
    lctx.globalAlpha = 0.3 * br; lctx.drawImage(S.streak, sx - (S.streak.width >> 1), sy - 2);
    ctx.globalAlpha = 1; lctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // station layers
    const layers = [[A.far, A.farE, A.farB, null, 0.22, 0.55], [A.mid, A.midE, A.midB, A.midS, 0.5, 0.8], [A.near, A.nearE, A.nearB, null, 0.9, 1]];
    for (let i = 0; i < 3; i++) {
      const [img, em, bl, sp, f, ea] = layers[i];
      const oy = Math.round(scrollY * f);
      drawTiled(ctx, img, ax, oy, W, H);
      ctx.globalCompositeOperation = 'lighter';
      drawTiled(ctx, em, ax, oy, W, H);
      ctx.globalCompositeOperation = 'source-over';
      lctx.globalAlpha = ea; drawTiled(lctx, em, ax, oy, W, H); lctx.globalAlpha = 1;
      bl.draw(ctx, lctx, ax, oy, W, H, t);
      if (sp) sp.draw(ctx, lctx, ax, oy, W, H, t);
    }
    lctx.globalCompositeOperation = lop;
  }
}

// ---------------------------------------------------------------------------
// Registry, asset cache and public API
// ---------------------------------------------------------------------------

const STAGES = {
  title: [genTitle, TitleStage],
  aurora: [genAurora, AuroraStage],
};
export const BG_KEYS = Object.keys(STAGES);

const CACHE = new Map();   // key -> { A, refs }
let warned = false;

function runGen(it) { let r; do { r = it.next(); } while (!r.done); return r.value; }
function freeAssets(A) {
  for (const k in A) {
    const v = A[k];
    if (typeof HTMLCanvasElement !== 'undefined' && v instanceof HTMLCanvasElement) freeCanvas(v);
    else if (Array.isArray(v)) v.forEach((x) => { if (typeof HTMLCanvasElement !== 'undefined' && x instanceof HTMLCanvasElement) freeCanvas(x); });
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
