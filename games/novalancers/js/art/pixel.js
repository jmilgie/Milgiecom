// Nova Lancers — pixel-art toolkit.
//
// Low-level helpers shared by the sprite generator (and free for any other art module):
// packed-color pixel buffers with a separate emissive layer, ASCII pixel-map parsing,
// mirroring, auto outlines, ramp shifting / recoloring, RotSprite-style rotation that keeps
// crisp 1-px outlines, column remapping (bank frames), seeded noise, ordered dithering,
// lighting and small rasterizers.
//
// Data model: an "Art" is { w, h, col: Int32Array, emi: Int32Array|null }.
//   col = main color layer, emi = emissive (glow) layer, both packed RGBA in the byte order
//   of ImageData on little-endian machines (0xAABBGGRR). 0 = fully transparent.
//   Colors are kept as SIGNED int32 on purpose: opaque colors then fall in V8's small-integer
//   range, so passing them around never allocates (uint32 values > 2^31 would be boxed).

export const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------
// Canvases
// ---------------------------------------------------------------------------------------

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w | 0);
  c.height = Math.max(1, h | 0);
  return c;
}

// ---------------------------------------------------------------------------------------
// Packed colors
// ---------------------------------------------------------------------------------------

const HEX = new Map();

export function pack(r, g, b, a = 255) {
  return (a & 255) << 24 | (b & 255) << 16 | (g & 255) << 8 | (r & 255);
}

// "#rrggbb" (or "#rgb") -> packed; alpha 0..255
export function packHex(hex, a = 255) {
  const key = a === 255 ? hex : hex + '/' + a;
  let p = HEX.get(key);
  if (p !== undefined) return p;
  let h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  p = pack((n >> 16) & 255, (n >> 8) & 255, n & 255, a);
  HEX.set(key, p);
  return p;
}

export const R_ = (p) => p & 255;
export const G_ = (p) => (p >>> 8) & 255;
export const B_ = (p) => (p >>> 16) & 255;
export const A_ = (p) => p >>> 24;

export function withAlpha(p, a) {
  return (p & 0x00ffffff) | ((a & 255) << 24);
}

export function toHex(p) {
  const s = (v) => v.toString(16).padStart(2, '0');
  return '#' + s(R_(p)) + s(G_(p)) + s(B_(p));
}

// Linear blend of two packed colors (t = 0 -> a, 1 -> b); alpha blended too.
export function mix(a, b, t) {
  const u = 1 - t;
  return pack(R_(a) * u + R_(b) * t, G_(a) * u + G_(b) * t, B_(a) * u + B_(b) * t, A_(a) * u + A_(b) * t);
}

// Scale RGB of a packed color (for dimmer emissive layers).
export function scaleRGB(p, k) {
  return pack(Math.min(255, R_(p) * k), Math.min(255, G_(p) * k), Math.min(255, B_(p) * k), A_(p));
}

// ---------------------------------------------------------------------------------------
// Art buffers
// ---------------------------------------------------------------------------------------

export function newArt(w, h, withEmi = true) {
  return { w, h, col: new Int32Array(w * h), emi: withEmi ? new Int32Array(w * h) : null };
}

export function cloneArt(a) {
  return { w: a.w, h: a.h, col: a.col.slice(), emi: a.emi ? a.emi.slice() : null };
}

// Set a pixel (color + optional emissive). Out-of-range is ignored.
export function plot(a, x, y, c, e = 0) {
  x |= 0; y |= 0;
  if (x < 0 || y < 0 || x >= a.w || y >= a.h) return;
  const i = y * a.w + x;
  a.col[i] = c;
  if (a.emi) a.emi[i] = e;
}

export function getCol(a, x, y) {
  return (x < 0 || y < 0 || x >= a.w || y >= a.h) ? 0 : a.col[y * a.w + x];
}

// Draw src over dst at (dx,dy). Opaque src pixels overwrite (and take over the emissive
// value, so a solid pixel hides the glow beneath it); translucent src pixels alpha-blend.
export function blit(dst, src, dx = 0, dy = 0) {
  for (let y = 0; y < src.h; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= dst.h) continue;
    for (let x = 0; x < src.w; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= dst.w) continue;
      const si = y * src.w + x, di = ty * dst.w + tx;
      const c = src.col[si];
      const e = src.emi ? src.emi[si] : 0;
      if (c) {
        const al = c >>> 24;
        if (al === 255 || !dst.col[di]) dst.col[di] = c;
        else dst.col[di] = mix(dst.col[di], withAlpha(c, 255), al / 255);
        if (dst.emi && (al === 255 || e)) dst.emi[di] = e;
      } else if (e && dst.emi) {
        dst.emi[di] = e;
      }
    }
  }
  return dst;
}

// Flip horizontally (new Art).
export function flipArtX(a) {
  const o = newArt(a.w, a.h, !!a.emi);
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      const s = y * a.w + x, d = y * a.w + (a.w - 1 - x);
      o.col[d] = a.col[s];
      if (a.emi) o.emi[d] = a.emi[s];
    }
  }
  return o;
}

// Solid white silhouette of the color layer (for hit flashes).
export function whiteOf(a) {
  const o = new Int32Array(a.w * a.h);
  for (let i = 0; i < o.length; i++) {
    const c = a.col[i];
    if (c) o[i] = 0x00ffffff | ((c >>> 24) << 24);
  }
  return o;
}

// Pad an art on every side (useful before outlining art that touches its borders).
export function padArt(a, l, t = l, r = l, b = t) {
  const o = newArt(a.w + l + r, a.h + t + b, !!a.emi);
  blit(o, a, l, t);
  return o;
}

// Crop to a rectangle (new Art).
export function cropArt(a, x0, y0, w, h) {
  const o = newArt(w, h, !!a.emi);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x + x0, sy = y + y0;
      if (sx < 0 || sy < 0 || sx >= a.w || sy >= a.h) continue;
      o.col[y * w + x] = a.col[sy * a.w + sx];
      if (a.emi) o.emi[y * w + x] = a.emi[sy * a.w + sx];
    }
  }
  return o;
}

// ---------------------------------------------------------------------------------------
// ASCII pixel maps
// ---------------------------------------------------------------------------------------

// Legend: char -> null | { c: packed, e: packed } (e = emissive color, 0 = none).
// Build one from ramp ranges:   legend(['0', RAMPS.steel], ['A', RAMPS.cyan, true], ...)
// Each entry: [firstChar, colors[], emissive?(bool|number: RGB multiplier), alpha?]
// Chars run consecutively from firstChar (e.g. 'a' -> 'a','b','c',...).
export function legend(...entries) {
  const L = { '.': null, ' ': null };
  for (const ent of entries) {
    if (!Array.isArray(ent)) { Object.assign(L, ent); continue; }
    const [first, colors, emis = false, alpha = 255] = ent;
    const list = Array.isArray(colors) ? colors : [colors];
    const code = first.charCodeAt(0);
    list.forEach((hex, i) => {
      const c = packHex(hex, alpha);
      const k = typeof emis === 'number' ? emis : 1;
      L[String.fromCharCode(code + i)] = { c, e: emis ? scaleRGB(packHex(hex), k) : 0 };
    });
  }
  return L;
}

// rows: array of equal-length strings. opt.mirror: rows hold the LEFT half including the
// center column; the result is mirrored to width 2*len-1. opt.mirrorEven: mirror without a
// shared center column (width 2*len). Unknown chars throw (catches typos early).
export function parseMap(rows, L, opt = {}) {
  const src = rows.map((r) => r.replace(/\s+$/, ''));
  const hw = Math.max(...src.map((r) => r.length));
  const w = opt.mirror ? hw * 2 - 1 : opt.mirrorEven ? hw * 2 : hw;
  const h = src.length;
  const a = newArt(w, h, true);
  for (let y = 0; y < h; y++) {
    const row = src[y];
    for (let x = 0; x < hw; x++) {
      const ch = x < row.length ? row[x] : '.';
      const ent = L[ch];
      if (ent === undefined) throw new Error(`pixel map: unknown char '${ch}' at ${x},${y}`);
      if (!ent) continue;
      a.col[y * w + x] = ent.c;
      a.emi[y * w + x] = ent.e;
      if (opt.mirror || opt.mirrorEven) {
        const mx = opt.mirror ? w - 1 - x : w - 1 - x;
        a.col[y * w + mx] = ent.c;
        a.emi[y * w + mx] = ent.e;
      }
    }
  }
  return a;
}

// ---------------------------------------------------------------------------------------
// Ramps: shifting (lighting) and recoloring (team variants)
// ---------------------------------------------------------------------------------------

// Build a lookup from every ramp color to (ramp, index). Ramps listed earlier win when a
// color appears in more than one ramp. Returns { shift(p, d), info(p), rampOf(p) }.
export function makeRampShifter(rampList) {
  const map = new Map();
  for (const ramp of rampList) {
    const packed = ramp.map((h) => packHex(h));
    packed.forEach((p, i) => { if (!map.has(p)) map.set(p, { ramp: packed, i }); });
  }
  return {
    info(p) { return map.get(p | 0xff000000) || null; },
    // Move a color d steps along its ramp (clamped); keeps alpha. Non-ramp colors unchanged.
    shift(p, d) {
      if (!p || !d) return p;
      const inf = map.get(p | 0xff000000);
      if (!inf) return p;
      const j = Math.max(0, Math.min(inf.ramp.length - 1, inf.i + d));
      return withAlpha(inf.ramp[j], p >>> 24);
    },
    has(p) { return map.has(p | 0xff000000); },
  };
}

// Map every color of ramp `from` to the same index of ramp `to` (hex arrays).
export function recolorMap(from, to) {
  const m = new Map();
  from.forEach((h, i) => m.set(packHex(h), packHex(to[Math.min(i, to.length - 1)])));
  return m;
}

function remapPx(px, m) {
  const o = new Int32Array(px.length);
  for (let i = 0; i < px.length; i++) {
    const p = px[i];
    if (!p) continue;
    const q = m.get(p | 0xff000000);
    o[i] = q === undefined ? p : withAlpha(q, p >>> 24);
  }
  return o;
}

// Recolor both layers of an art with a color map (from recolorMap). Emissive colors that
// were dimmed/scaled are matched by nearest ramp entry through `emiMap` if provided.
export function recolorArt(a, m, emiMap = m) {
  return { w: a.w, h: a.h, col: remapPx(a.col, m), emi: a.emi ? remapPx(a.emi, emiMap) : null };
}

// Shift ramp colors of pixels that pass `test(x, y, p)` by d steps.
export function shiftWhere(a, shifter, d, test) {
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      const i = y * a.w + x, p = a.col[i];
      if (p && test(x, y, p)) a.col[i] = shifter.shift(p, d);
    }
  }
  return a;
}

// ---------------------------------------------------------------------------------------
// Outlines and edge lighting
// ---------------------------------------------------------------------------------------

// Adds a 1-px outline in `color` around all opaque pixels (4-neighbourhood by default, which
// gives the cleanest single-pixel diagonals; diag:true closes corners too).
// `inside`: also outline interior holes (default true). Pixels are only added on transparent
// cells, so the art needs a free 1-px margin.
export function outline(a, color, opt = {}) {
  const { diag = false, alphaMin = 1 } = opt;
  const { w, h, col } = a;
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = (col[i] >>> 24) >= alphaMin ? 1 : 0;
  const S = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : solid[y * w + x];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (solid[i]) continue;
      let n = S(x - 1, y) | S(x + 1, y) | S(x, y - 1) | S(x, y + 1);
      if (!n && diag) n = S(x - 1, y - 1) | S(x + 1, y - 1) | S(x - 1, y + 1) | S(x + 1, y + 1);
      if (n) { col[i] = color; if (a.emi) a.emi[i] = 0; }
    }
  }
  return a;
}

// Rim lighting for a key light from the top-left: pixels whose upper/left neighbour is empty
// get `lit` ramp steps, pixels whose lower/right neighbour is empty get `shade` steps.
// `test(p)` limits which colors are affected (e.g. only hull ramps, not glowing parts).
export function rimLight(a, shifter, opt = {}) {
  const { lit = 1, shade = -1, test = null, corner = 0 } = opt;
  const { w, h, col } = a;
  const src = col.slice();
  const E = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? true : !src[y * w + x];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, p = src[i];
      if (!p || (test && !test(p))) continue;
      const ul = E(x - 1, y) || E(x, y - 1);
      const dr = E(x + 1, y) || E(x, y + 1);
      let d = 0;
      if (ul && !dr) d = lit;
      else if (dr && !ul) d = shade;
      else if (ul && dr) d = corner;
      if (d) col[i] = shifter.shift(p, d);
    }
  }
  return a;
}

// Remove isolated single pixels (no 4-neighbour of any kind) — cleans rotation specks.
export function despeckle(a) {
  const { w, h, col } = a;
  const src = col.slice();
  const O = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : src[y * w + x];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!src[i]) continue;
      if (!O(x - 1, y) && !O(x + 1, y) && !O(x, y - 1) && !O(x, y + 1)) {
        col[i] = 0;
        if (a.emi) a.emi[i] = 0;
      }
    }
  }
  return a;
}

// ---------------------------------------------------------------------------------------
// RotSprite-style rotation
// ---------------------------------------------------------------------------------------

// One EPX / Scale2x pass over an index image. `src` holds source-pixel indices (-1 = empty)
// and `key[idx]` the color used for equality tests. Returns the 2x index image.
export function scale2xIndex(src, w, h, key) {
  const W = w * 2, out = new Int32Array(W * h * 2);
  const K = (i) => (i < 0 ? 0 : key[i]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = src[y * w + x];
      const a = y > 0 ? src[(y - 1) * w + x] : -1;      // up
      const b = x < w - 1 ? src[y * w + x + 1] : -1;    // right
      const c = x > 0 ? src[y * w + x - 1] : -1;        // left
      const d = y < h - 1 ? src[(y + 1) * w + x] : -1;  // down
      const ka = K(a), kb = K(b), kc = K(c), kd = K(d);
      let e0 = p, e1 = p, e2 = p, e3 = p;
      if (kc === ka && kc !== kd && ka !== kb) e0 = a;
      if (ka === kb && ka !== kc && kb !== kd) e1 = b;
      if (kd === kc && kd !== kb && kc !== ka) e2 = c;
      if (kb === kd && kb !== ka && kd !== kc) e3 = d;
      const o = y * 2 * W + x * 2;
      out[o] = e0; out[o + 1] = e1; out[o + W] = e2; out[o + W + 1] = e3;
    }
  }
  return out;
}

// Prepare an art for repeated rotation: Scale2x x3 (8x) once, then rotate(angle) samples
// the smooth 8x image with a 3x3 majority vote per output pixel. Rotation is clockwise
// (screen space, y down). Both layers rotate together (sampling source indices), so
// emissive parts stay registered with their pixels.
export function makeRotator(a, passes = 3) {
  const n = a.w * a.h;
  let idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = a.col[i] ? i : -1;
  // equality key: color, disambiguated by emissive so glowing/non-glowing never merge
  const key = new Int32Array(n);
  for (let i = 0; i < n; i++) key[i] = a.col[i] ? (a.col[i] ^ (a.emi ? Math.imul(a.emi[i], -1640531535) : 0)) || 1 : 0;
  let w = a.w, h = a.h;
  for (let p = 0; p < passes; p++) { idx = scale2xIndex(idx, w, h, key); w *= 2; h *= 2; }
  const S = 1 << passes;
  const votesI = new Int32Array(9), votesN = new Int32Array(9);

  return function rotate(angle, ow = a.w, oh = a.h) {
    const o = newArt(ow, oh, !!a.emi);
    const cs = Math.cos(angle), sn = Math.sin(angle);
    const cx = a.w / 2, cy = a.h / 2, ocx = ow / 2, ocy = oh / 2;
    const off = S / 6; // 3x3 taps spread across ~1/3 source pixel
    const at = (px, py) => {
      const bx = Math.floor(px), by = Math.floor(py);
      return (bx < 0 || by < 0 || bx >= w || by >= h) ? -1 : idx[by * w + bx];
    };
    for (let y = 0; y < oh; y++) {
      for (let x = 0; x < ow; x++) {
        const dx = x + 0.5 - ocx, dy = y + 0.5 - ocy;
        const sx = (dx * cs + dy * sn + cx) * S;
        const sy = (-dx * sn + dy * cs + cy) * S;
        const center = at(sx, sy);
        let best = center;
        if (at(sx - off, sy - off) !== center || at(sx + off, sy - off) !== center ||
          at(sx - off, sy + off) !== center || at(sx + off, sy + off) !== center) {
          // edge pixel: 3x3 majority vote (center weighted double)
          let nv = 0;
          for (let j = -1; j <= 1; j++) {
            for (let i = -1; i <= 1; i++) {
              const v = at(sx + i * off, sy + j * off);
              let k = 0;
              while (k < nv && votesI[k] !== v) k++;
              if (k === nv) { votesI[nv] = v; votesN[nv] = 0; nv++; }
              votesN[k] += (i === 0 && j === 0) ? 2 : 1;
            }
          }
          let bn = -1;
          for (let k = 0; k < nv; k++) if (votesN[k] > bn) { bn = votesN[k]; best = votesI[k]; }
        }
        if (best >= 0) {
          const t = y * ow + x;
          o.col[t] = a.col[best];
          if (a.emi) o.emi[t] = a.emi[best];
        }
      }
    }
    return o;
  };
}

// ---------------------------------------------------------------------------------------
// Lossless direction frames (square, odd-sized frames centered on the middle pixel)
// ---------------------------------------------------------------------------------------
// Tiny sprites do not survive arbitrary rotation, so direction sets are built from a few
// authored/rasterized "base" angles in the first octant (0..45 deg) plus exact pixel
// permutations: a 90-degree turn and a mirror across the 45-degree diagonal. Every frame
// then has the same pixel structure as its base, whatever the angle.

// Rotate a square pixel array 90 degrees clockwise (screen space, y down).
export function rot90Px(px, n) {
  const o = new px.constructor(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) o[x * n + (n - 1 - y)] = px[y * n + x];
  return o;
}

// Mirror a square pixel array across the up-right diagonal: a direction at angle a
// (0 = up, clockwise) becomes 90deg - a. Pixel offset (dx, dy) -> (-dy, -dx).
export function mirrorDiagPx(px, n) {
  const o = new px.constructor(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) o[(n - 1 - x) * n + (n - 1 - y)] = px[y * n + x];
  return o;
}

function mapArt(a, fn) {
  return { w: a.w, h: a.h, col: fn(a.col, a.w), emi: a.emi ? fn(a.emi, a.w) : null };
}
export const rot90Art = (a) => mapArt(a, rot90Px);
export const mirrorDiagArt = (a) => mapArt(a, mirrorDiagPx);

// For `dirs` directions (multiple of 8): which first-octant base index (0..dirs/8), whether
// it is mirrored across the diagonal, and how many clockwise quarter turns follow.
export function dirSymmetry(d, dirs) {
  const quarter = dirs / 4, eighth = dirs / 8;
  const q = Math.floor(d / quarter), r = d % quarter;
  return r <= eighth ? { base: r, mirror: false, turns: q } : { base: quarter - r, mirror: true, turns: q };
}

// Build `dirs` frames from first-octant bases. makeBase(i, angle) -> T (cached), with
// angle = i * TAU / dirs. xform(T, 'rot' | 'mirror') -> T applies one exact permutation.
export function symmetricDirs(dirs, makeBase, xform) {
  const cache = [];
  const out = [];
  for (let d = 0; d < dirs; d++) {
    const s = dirSymmetry(d, dirs);
    if (!cache[s.base]) cache[s.base] = makeBase(s.base, (s.base / dirs) * TAU);
    let t = cache[s.base];
    if (s.mirror) t = xform(t, 'mirror');
    for (let k = 0; k < s.turns; k++) t = xform(t, 'rot');
    out.push(t);
  }
  return out;
}

// Supersampled rasterization of an analytic shape into a square frame, in the shape's local
// frame (u = across, positive to the shape's right; v = along, positive forward) for a
// heading `angle` (0 = up, clockwise). shade(u, v) -> [col, emi] | null. A pixel is filled
// when at least `thr` of its ss x ss subsamples hit the shape; its color comes from the
// center sample (or the hit closest to the center), so line weight stays even at all angles.
export function rasterAnalytic(size, angle, shade, ss = 4, thr = 0.45, maxR = Infinity) {
  const a = newArt(size, size);
  const c = (size - 1) / 2;
  const fx = Math.sin(angle), fy = -Math.cos(angle);
  const need = Math.ceil(thr * ss * ss - 1e-6);
  const cull = (maxR + 0.75) ** 2;             // skip pixels the shape cannot reach
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((x - c) ** 2 + (y - c) ** 2 > cull) continue;
      let hits = 0, best = null, bd = 1e9;
      for (let j = 0; j < ss; j++) {
        for (let i = 0; i < ss; i++) {
          const dx = x - c + (i + 0.5) / ss - 0.5, dy = y - c + (j + 0.5) / ss - 0.5;
          const r = shade(dx * -fy + dy * fx, dx * fx + dy * fy);
          if (!r) continue;
          hits++;
          const d2 = (dx - (x - c)) ** 2 + (dy - (y - c)) ** 2;
          if (d2 < bd) { bd = d2; best = r; }
        }
      }
      if (hits < need || !best) continue;
      const u = (x - c) * -fy + (y - c) * fx, v = (x - c) * fx + (y - c) * fy;
      const r = shade(u, v) || best;
      const i = y * size + x;
      a.col[i] = r[0];
      a.emi[i] = r[1] || 0;
    }
  }
  return a;
}

// Nearest-neighbour upscale (integer factor) — handy for previews and chunky letterforms.
export function scaleArt(a, k) {
  const o = newArt(a.w * k, a.h * k, !!a.emi);
  for (let y = 0; y < o.h; y++) {
    for (let x = 0; x < o.w; x++) {
      const s = ((y / k) | 0) * a.w + ((x / k) | 0), d = y * o.w + x;
      o.col[d] = a.col[s];
      if (a.emi) o.emi[d] = a.emi[s];
    }
  }
  return o;
}

// Build a new art whose column x copies source column map[x] (-1 = empty), shifted
// vertically by dy[x] (optional). Used for foreshortened bank frames.
export function remapColumns(a, map, ow = map.length, dy = null) {
  const o = newArt(ow, a.h, !!a.emi);
  for (let x = 0; x < ow; x++) {
    const sx = map[x];
    if (sx == null || sx < 0 || sx >= a.w) continue;
    const off = dy ? dy[x] | 0 : 0;
    for (let y = 0; y < a.h; y++) {
      const sy = y - off;
      if (sy < 0 || sy >= a.h) continue;
      o.col[y * ow + x] = a.col[sy * a.w + sx];
      if (a.emi) o.emi[y * ow + x] = a.emi[sy * a.w + sx];
    }
  }
  return o;
}

// ---------------------------------------------------------------------------------------
// Conversion to canvases
// ---------------------------------------------------------------------------------------

export function pxToImageData(px, w, h) {
  const id = new ImageData(w, h);
  new Uint32Array(id.data.buffer).set(px);
  return id;
}

export function pxToCanvas(px, w, h) {
  const c = makeCanvas(w, h);
  c.getContext('2d').putImageData(pxToImageData(px, w, h), 0, 0);
  return c;
}

// layer: 'col' | 'emi' | 'white'
export function artToCanvas(a, layer = 'col') {
  const px = layer === 'white' ? whiteOf(a) : a[layer];
  return pxToCanvas(px || new Int32Array(a.w * a.h), a.w, a.h);
}

// Read a canvas back into an Art (color layer only).
export function canvasToArt(c) {
  const ctx = c.getContext('2d');
  const id = ctx.getImageData(0, 0, c.width, c.height);
  return { w: c.width, h: c.height, col: new Int32Array(id.data.buffer.slice(0)), emi: null };
}

// ---------------------------------------------------------------------------------------
// Seeded randomness and noise
// ---------------------------------------------------------------------------------------

// mulberry32 PRNG -> () => [0,1)
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Integer lattice hash -> [0,1)
export function hash2(x, y, seed = 0) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Smooth value noise in [0,1)
export function vnoise(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Fractal Brownian motion of value noise, normalized to [0,1)
export function fbm(x, y, seed = 0, oct = 4, lac = 2.03, gain = 0.5) {
  let s = 0, amp = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += amp * vnoise(x * f, y * f, seed + i * 71);
    n += amp; amp *= gain; f *= lac;
  }
  return s / n;
}

// ---------------------------------------------------------------------------------------
// Ordered dithering
// ---------------------------------------------------------------------------------------

export const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// Bayer threshold in (0,1) for pixel (x,y)
export function bayer(x, y) {
  return (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
}

// Map continuous t (0..1) to an integer index 0..n-1 with 4x4 ordered dithering between
// neighbouring steps. `spread` < 1 narrows the dithered transition band (crisper bands).
export function ditherIndex(t, n, x, y, spread = 1) {
  const v = Math.max(0, Math.min(1, t)) * (n - 1);
  const lo = Math.floor(v);
  let f = v - lo;
  if (spread < 1) f = Math.max(0, Math.min(1, (f - 0.5) / spread + 0.5));
  return Math.min(n - 1, lo + (f > bayer(x, y) ? 1 : 0));
}

// ---------------------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------------------

// Key light from the top-left, slightly toward the viewer (screen space: +x right, +y down,
// +z toward the camera).
export const LIGHT = (() => {
  const v = [-0.58, -0.62, 0.53];
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
})();

export function lambert(nx, ny, nz) {
  return Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
}

// Shade of a sphere point: (u,v) in -1..1 (unit disc) -> light 0..1 with a specular kick.
export function sphereLight(u, v, spec = 0.35) {
  const r2 = u * u + v * v;
  if (r2 > 1) return -1;
  const nz = Math.sqrt(1 - r2);
  const d = lambert(u, v, nz);
  // Blinn-ish specular toward the viewer
  const hx = LIGHT[0], hy = LIGHT[1], hz = LIGHT[2] + 1;
  const hl = Math.hypot(hx, hy, hz);
  const s = Math.pow(Math.max(0, (u * hx + v * hy + nz * hz) / hl), 24) * spec;
  return Math.min(1, d * 0.85 + 0.12 + s);
}

// Pick a ramp color from light level t (0..1) with optional dithering.
export function rampAt(ramp, t, x = 0, y = 0, dither = false) {
  const n = ramp.length;
  const i = dither ? ditherIndex(t, n, x, y, 0.6) : Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))));
  return typeof ramp[i] === 'number' ? ramp[i] : packHex(ramp[i]);
}

// ---------------------------------------------------------------------------------------
// Rasterizers (all crisp: a pixel is covered when its center is inside)
// ---------------------------------------------------------------------------------------

export function pointInPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Fill a polygon (points in pixel units) calling fn(x, y) per covered pixel.
export function rasterPoly(pts, fn, clipW = 1e9, clipH = 1e9) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(clipW - 1, Math.ceil(x1)); y1 = Math.min(clipH - 1, Math.ceil(y1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) if (pointInPoly(x + 0.5, y + 0.5, pts)) fn(x, y);
  }
}

// Bresenham line calling fn(x, y)
export function rasterLine(x0, y0, x1, y1, fn) {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    fn(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// Visit every pixel of an art with its center-relative coordinates (for SDF-style
// procedural sprites): fn(x, y, dx, dy, i) where dx/dy are offsets from the art center.
export function forEachPixel(a, fn) {
  const cx = (a.w - 1) / 2, cy = (a.h - 1) / 2;
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) fn(x, y, x - cx, y - cy, y * a.w + x);
  }
}

// ---------------------------------------------------------------------------------------
// Emissive helpers
// ---------------------------------------------------------------------------------------

// Derive (or extend) the emissive layer from colors: `map` is a Map(packedColor -> packed
// emissive) or a function (p, x, y) -> packed|0.
export function emissiveFrom(a, map) {
  if (!a.emi) a.emi = new Int32Array(a.w * a.h);
  const fn = typeof map === 'function' ? map : (p) => map.get(p | 0xff000000) || 0;
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      const i = y * a.w + x, p = a.col[i];
      if (!p) continue;
      const e = fn(p, x, y);
      if (e) a.emi[i] = e;
    }
  }
  return a;
}

// Scale the whole emissive layer brightness.
export function dimEmissive(a, k) {
  if (!a.emi) return a;
  for (let i = 0; i < a.emi.length; i++) if (a.emi[i]) a.emi[i] = scaleRGB(a.emi[i], k);
  return a;
}

// Is the emissive layer empty?
export function emiEmpty(a) {
  if (!a.emi) return true;
  for (let i = 0; i < a.emi.length; i++) if (a.emi[i]) return false;
  return true;
}
