// Nova Lancers — boss art.
// Five multi-part bosses, generated procedurally at boot into offscreen canvases.
//
// How it works: every sprite is described as layered vector primitives (bevelled plates,
// domes, pipes, faceted crystal polygons...) in LOCAL coordinates. A tiny rasterizer
// writes them into a G-buffer (material, normal, height, tone, part id, emissive) at the
// sprite's pixel grid. A shading pass then lights it with a fixed top-left key light,
// quantizes to the palette ramps (hard edges, ordered dithering only on big curved
// surfaces), adds rim light, cast shadows, inner part edges, emissive light spill and a
// 1-px dark outline. Rotated directions are rendered by re-rasterizing the geometry at
// each angle (with the light staying fixed in world space), so every baked direction
// keeps crisp single-pixel outlines and correct lighting — no resampled pixel mush.

import { RAMPS, C, hexToRgb } from './palette.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------------------

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// smooth value noise in [0,1)
function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, seed, oct = 3) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, seed + i * 31); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

// Voronoi-ish cell distance (for rock plates / crystal crust): returns [d1, d2, cellId]
const _vor = [0, 0, 0];
function voronoi(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let d1 = 9, d2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j;
    const px = cx + 0.15 + 0.7 * hash2(cx, cy, seed), py = cy + 0.15 + 0.7 * hash2(cx, cy, seed + 7);
    const d = Math.hypot(px - x, py - y);
    if (d < d1) { d2 = d1; d1 = d; id = hash2(cx, cy, seed + 13); } else if (d < d2) d2 = d;
  }
  _vor[0] = d1; _vor[1] = d2; _vor[2] = id;
  return _vor;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

// Packed little-endian RGBA (ImageData Uint32 view)
function pack(hex, a = 255) {
  const [r, g, b] = hexToRgb(hex);
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}
function lum32(c) { return (c & 255) * 0.3 + ((c >>> 8) & 255) * 0.59 + ((c >>> 16) & 255) * 0.11; }

const OUTLINE = pack(C.outline);
const P = {}; // packed ramps
for (const k in RAMPS) P[k] = RAMPS[k].map((h) => pack(h));
const WHITE = pack('#ffffff');

// Key light: top-left, above.
const LX = -0.5, LY = -0.62, LZ = 0.6;
const LN = Math.hypot(LX, LY, LZ);
const Lx = LX / LN, Ly = LY / LN, Lz = LZ / LN;

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);

// ---------------------------------------------------------------------------------------
// Materials: a palette ramp (dark -> light) + lighting response
// ---------------------------------------------------------------------------------------

const MATS = [null];
function mat(ramp, o = {}) {
  MATS.push({
    ramp: ramp.map((c) => (typeof c === 'number' ? c : pack(c))),
    amb: o.amb ?? 0.1,        // ambient term
    dif: o.dif ?? 0.95,       // diffuse term
    lift: o.lift ?? 0,        // constant ramp offset
    dither: o.dither ?? 0,    // ordered dither amplitude (in ramp steps)
    spec: o.spec ?? 0,        // specular threshold (0 = none), e.g. 0.93
    rim: o.rim ?? 1,          // bright rim on lit silhouette edges
    edge: o.edge ?? 0,        // ramp index used for inner edges
    shadow: o.shadow ?? 0.32, // cast-shadow darkening (fraction of range)
    noSpill: !!o.noSpill,     // self-lit materials ignore emissive spill
  });
  return MATS.length - 1;
}

const M = {};
function initMats() {
  if (M.ready) return;
  const r = RAMPS;
  M.hull = mat(r.hull, { amb: 0.12, dif: 0.95 });
  M.hullD = mat(['#07090b', r.hull[0], r.hull[1], r.hull[2], r.hull[3], r.hull[4]], { amb: 0.1, dif: 0.9 });
  M.steel = mat(r.steel.slice(0, 7), { amb: 0.12, dif: 0.95, spec: 0.94 });
  M.armor = mat(r.steel.slice(0, 6), { amb: 0.1, dif: 0.92 });
  M.paint = mat(['#1c1206', r.gold[0], r.gold[1], r.gold[2], r.gold[3], r.gold[4]], { amb: 0.1, dif: 0.92 });
  M.crust = mat([r.void[0], r.carapace[0], r.carapace[1], r.carapace[2], r.carapace[3], r.carapace[5]], { amb: 0.1, dif: 0.95, spec: 0.9 });
  M.gun = mat(['#0b0e16', r.steel[0], r.steel[1], r.steel[2], r.steel[3], r.steel[4]], { amb: 0.1, dif: 0.95, spec: 0.93 });
  M.gold = mat(['#1c1206', r.gold[0], r.gold[1], r.gold[2], r.gold[3], r.gold[4]], { amb: 0.15, dif: 0.95 });
  M.dark = mat([r.void[0], r.void[1], r.hull[0], r.hull[1], r.hull[2]], { amb: 0.1, dif: 0.8, rim: 0 });
  M.car = mat(r.carapace, { amb: 0.12, dif: 0.95, spec: 0.95 });
  M.crysM = mat([r.carapace[0], r.magenta[0], r.magenta[1], r.magenta[2], r.magenta[3], r.magenta[4], r.magenta[5]], { amb: 0.12, dif: 0.95, spec: 0.93, noSpill: true });
  M.rock = mat(r.smoke, { amb: 0.1, dif: 0.95, dither: 0.7 });
  M.iron = mat(['#0b0708', r.rust[0], r.rust[1], r.rust[2], r.rust[3], r.rust[4], r.rust[5]], { amb: 0.1, dif: 0.95, spec: 0.95 });
  M.rust = mat(r.rust, { amb: 0.1, dif: 0.95 });
  M.crysT = mat([r.crystal[0], r.crystal[1], r.crystal[2], r.crystal[3], r.crystal[4], r.crystal[5]], { amb: 0.12, dif: 0.95, spec: 0.9, edge: 0 });
  M.crysV = mat([r.plasma[0], r.plasma[1], r.plasma[2], r.plasma[3], r.plasma[4], r.plasma[5]], { amb: 0.12, dif: 0.95, spec: 0.9 });
  M.void = mat([r.void[0], r.void[1], r.void[2], r.void[3], r.void[4], r.void[5]], { amb: 0.1, dif: 0.9, spec: 0.96 });
  M.bone = mat([r.plasma[0], r.carapace[3], r.carapace[5], r.carapace[6], '#c7a9c9', '#f1e2f0'], { amb: 0.15, dif: 0.9, spec: 0.93, dither: 0.6 });
  M.ready = true;
}

// ---------------------------------------------------------------------------------------
// G-buffer rasterizer
// ---------------------------------------------------------------------------------------

const NO = {};

class GB {
  constructor(w, h) {
    this.w = w; this.h = h;
    const n = w * h;
    this.m = new Uint8Array(n);
    this.nx = new Float32Array(n); this.ny = new Float32Array(n); this.nz = new Float32Array(n);
    this.z = new Float32Array(n);
    this.t = new Int8Array(n);
    this.p = new Uint16Array(n);
    this.e = new Uint32Array(n);
    this.sp = new Uint8Array(n); // spill ramp id for emissive pixels
    this.ox = w / 2; this.oy = h / 2;
    this.reset(0);
  }
  reset(angle = 0) {
    this.m.fill(0); this.t.fill(0); this.e.fill(0); this.z.fill(0); this.p.fill(0); this.sp.fill(0);
    this.pid = 1;
    this.stack = [];
    this.T = [1, 0, 0, 1, 0, 0];
    this.angle = angle;
    if (angle) this.rot(angle);
    this._inv();
  }
  _inv() {
    const [a, b, c, d] = this.T;
    const det = a * d - b * c;
    this.I = [d / det, -b / det, -c / det, a / det];
  }
  save() { this.stack.push(this.T.slice()); return this; }
  restore() { this.T = this.stack.pop(); this._inv(); return this; }
  tr(u, v) { const T = this.T; T[4] += T[0] * u + T[2] * v; T[5] += T[1] * u + T[3] * v; return this; }
  rot(a) {
    const T = this.T, c = Math.cos(a), s = Math.sin(a);
    const a0 = T[0], b0 = T[1], c0 = T[2], d0 = T[3];
    // local rotation: clockwise positive in screen space (y down)
    T[0] = a0 * c + c0 * s; T[1] = b0 * c + d0 * s;
    T[2] = -a0 * s + c0 * c; T[3] = -b0 * s + d0 * c;
    this._inv();
    return this;
  }
  flipX() { this.T[0] = -this.T[0]; this.T[1] = -this.T[1]; this._inv(); return this; }
  // run fn twice: as is, and mirrored across the local vertical axis
  sym(fn) { fn(1); this.save(); this.flipX(); fn(-1); this.restore(); return this; }

  // world pixel of a local point
  wx(u, v) { return this.ox + this.T[4] + this.T[0] * u + this.T[2] * v; }
  wy(u, v) { return this.oy + this.T[5] + this.T[1] * u + this.T[3] * v; }

  // Iterate over the pixels whose centers map inside the local AABB; fn(i, u, v, x, y)
  scan(u0, v0, u1, v1, fn) {
    const T = this.T, I = this.I, w = this.w, h = this.h;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let k = 0; k < 4; k++) {
      const u = k & 1 ? u1 : u0, v = k & 2 ? v1 : v0;
      const x = this.ox + T[4] + T[0] * u + T[2] * v, y = this.oy + T[5] + T[1] * u + T[3] * v;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    x0 = Math.max(0, Math.floor(x0) - 1); y0 = Math.max(0, Math.floor(y0) - 1);
    x1 = Math.min(w - 1, Math.ceil(x1) + 1); y1 = Math.min(h - 1, Math.ceil(y1) + 1);
    const ex = this.ox + T[4], ey = this.oy + T[5];
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - ey;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - ex;
        const u = I[0] * dx + I[2] * dy, v = I[1] * dx + I[3] * dy;
        if (u < u0 || u > u1 || v < v0 || v > v1) continue;
        fn(y * w + x, u, v, x, y);
      }
    }
  }

  // write one surface sample. (nu,nv,nz) = local normal (unnormalized ok)
  put(i, S, nu, nv, nz, z, pid) {
    if (S.clip && !this.m[i]) return;
    if (S.cut) { this.m[i] = 0; this.e[i] = 0; return; }
    const T = this.T;
    if (S.decal) {
      if (!this.m[i]) return;
      if (S.m) this.m[i] = S.m;
      if (S.dt) this.t[i] = clamp(this.t[i] + S.dt, -8, 8);
      if (S.t !== undefined) this.t[i] = S.t;
      if (S.n) { this.nx[i] = T[0] * nu + T[2] * nv; this.ny[i] = T[1] * nu + T[3] * nv; this.nz[i] = nz; }
      if (S.em !== undefined) { this.e[i] = S.em; this.sp[i] = S.sp || 0; }
      if (S.dz) this.z[i] += S.dz;
      return;
    }
    this.m[i] = S.m;
    this.nx[i] = T[0] * nu + T[2] * nv; this.ny[i] = T[1] * nu + T[3] * nv; this.nz[i] = nz;
    this.z[i] = z;
    this.t[i] = S.t || 0;
    this.p[i] = pid;
    this.e[i] = S.em || 0;
    this.sp[i] = S.sp || 0;
  }

  _pid(S) { return S.pid || (S.decal ? 0 : this.pid++); }

  // Ellipse / ellipsoid dome. S.h = dome height (0 = flat)
  ell(cu, cv, rx, ry, S) {
    const pid = this._pid(S), h = S.h ?? 0, z0 = S.z || 0, fx = S.flat;
    const irx = 1 / rx, iry = 1 / ry;
    this.scan(cu - rx, cv - ry, cu + rx, cv + ry, (i, u, v) => {
      const a = (u - cu) * irx, b = (v - cv) * iry, r2 = a * a + b * b;
      if (r2 > 1) return;
      if (S.em2) S.em = S.em2(r2, u - cu, v - cv);
      if (!h || fx) { this.put(i, S, 0, 0, 1, z0, pid); return; }
      const w = Math.sqrt(1 - r2);
      this.put(i, S, a * irx, b * iry, (w / h) * 1.0, z0 + h * w, pid);
    });
    return this;
  }
  circ(cu, cv, r, S) { return this.ell(cu, cv, r, r, S); }

  // Ring (torus-like cross-section). S.flat for flat
  ring(cu, cv, r0, r1, S) {
    const pid = this._pid(S), z0 = S.z || 0, mid = (r0 + r1) / 2, half = (r1 - r0) / 2, k = S.k ?? 1;
    this.scan(cu - r1, cv - r1, cu + r1, cv + r1, (i, u, v) => {
      const du = u - cu, dv = v - cv, rr = Math.hypot(du, dv);
      if (rr < r0 || rr > r1) return;
      if (S.flat) { this.put(i, S, 0, 0, 1, z0, pid); return; }
      const s = clamp((rr - mid) / half, -1, 1), w = Math.sqrt(1 - s * s * 0.9);
      const ir = rr > 0 ? 1 / rr : 0;
      this.put(i, S, du * ir * s * k, dv * ir * s * k, w, z0 + half * w, pid);
    });
    return this;
  }

  // Capsule / pipe from (u1,v1) to (u2,v2) of radius r. S.cap: 'round' (default) | 'flat'
  cyl(u1, v1, u2, v2, r, S) {
    const pid = this._pid(S), z0 = S.z || 0, flatCap = S.cap === 'flat', flat = S.flat;
    const du = u2 - u1, dv = v2 - v1, L2 = du * du + dv * dv || 1e-6;
    const pad = r + 0.01;
    this.scan(Math.min(u1, u2) - pad, Math.min(v1, v2) - pad, Math.max(u1, u2) + pad, Math.max(v1, v2) + pad, (i, u, v) => {
      let t = ((u - u1) * du + (v - v1) * dv) / L2;
      if (flatCap && (t < 0 || t > 1)) return;
      t = clamp(t, 0, 1);
      const pu = u - (u1 + du * t), pv = v - (v1 + dv * t);
      const d2 = pu * pu + pv * pv;
      if (d2 > r * r) return;
      if (flat) { this.put(i, S, 0, 0, 1, z0, pid); return; }
      const w = Math.sqrt(Math.max(0, 1 - d2 / (r * r)));
      this.put(i, S, pu / r, pv / r, w, z0 + r * w, pid);
    });
    return this;
  }

  // Polygon (any simple polygon). S.bev = bevel width, S.bk = bevel tilt, S.n = fixed normal,
  // S.pil = pillow curvature (subtle light->dark gradient across big plates)
  poly(pts, S) {
    const pid = this._pid(S), z0 = S.z || 0, bev = S.bev || 0, bk = S.bk ?? 1.1, fn = S.n, pil = S.pil || 0;
    const n = pts.length;
    let u0 = 1e9, v0 = 1e9, u1 = -1e9, v1 = -1e9;
    const X = new Float64Array(n), Y = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const u = pts[k][0], v = pts[k][1]; X[k] = u; Y[k] = v;
      if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2, iw = 2 / Math.max(1, u1 - u0), ih = 2 / Math.max(1, v1 - v0);
    // edges with outward normals: [ax, ay, ex, ey, 1/len2, nx, ny]
    const E = new Float64Array(n * 7);
    for (let k = 0; k < n; k++) {
      const ax = X[k], ay = Y[k], bx = X[(k + 1) % n], by = Y[(k + 1) % n];
      const ex = bx - ax, ey = by - ay, len = Math.hypot(ex, ey) || 1e-6;
      let nx = ey / len, ny = -ex / len;
      if (inPolyF(X, Y, n, (ax + bx) / 2 + nx * 0.01, (ay + by) / 2 + ny * 0.01)) { nx = -nx; ny = -ny; }
      const o = k * 7;
      E[o] = ax; E[o + 1] = ay; E[o + 2] = ex; E[o + 3] = ey; E[o + 4] = 1 / (len * len); E[o + 5] = nx; E[o + 6] = ny;
    }
    this.scan(u0, v0, u1, v1, (i, u, v) => {
      if (!inPolyF(X, Y, n, u, v)) return;
      if (fn) { this.put(i, S, fn[0], fn[1], fn[2], z0, pid); return; }
      let pu = 0, pv = 0;
      if (pil) { pu = (u - cu) * iw * pil; pv = (v - cv) * ih * pil; }
      if (!bev) { this.put(i, S, pu, pv, 1, z0, pid); return; }
      let best = 1e9, bnx = 0, bny = 0;
      for (let o = 0; o < E.length; o += 7) {
        let t = ((u - E[o]) * E[o + 2] + (v - E[o + 1]) * E[o + 3]) * E[o + 4];
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = u - E[o] - E[o + 2] * t, dy = v - E[o + 1] - E[o + 3] * t;
        const d = dx * dx + dy * dy;
        if (d < best) { best = d; bnx = E[o + 5]; bny = E[o + 6]; }
      }
      best = Math.sqrt(best);
      if (best >= bev) { this.put(i, S, pu, pv, 1, z0, pid); return; }
      const k = (1 - best / bev) * bk;
      this.put(i, S, bnx * k + pu, bny * k + pv, 1, z0 - (1 - best / bev) * bev * 0.4, pid);
    });
    return this;
  }
  rect(u, v, w, h, S) { return this.poly([[u, v], [u + w, v], [u + w, v + h], [u, v + h]], S); }

  // Generic per-pixel shape. fn(u, v, o) -> truthy to write; may set o.nu,o.nv,o.nz,o.z,o.m,o.t,o.em
  fill(u0, v0, u1, v1, S, fn) {
    const pid = this._pid(S), o = {};
    this.scan(u0, v0, u1, v1, (i, u, v, x, y) => {
      o.nu = 0; o.nv = 0; o.nz = 1; o.z = S.z || 0; o.m = S.m; o.t = S.t || 0; o.em = S.em || 0; o.x = x; o.y = y; o.i = i;
      if (!fn(u, v, o)) return;
      if (S.decal) {
        if (!this.m[i]) return;
        if (o.m) this.m[i] = o.m;
        if (o.dt) this.t[i] = clamp(this.t[i] + o.dt, -8, 8);
        if (o.em) { this.e[i] = o.em; this.sp[i] = S.sp || 0; }
        o.dt = 0;
        return;
      }
      if (S.clip && !this.m[i]) return;
      const T = this.T;
      this.m[i] = o.m;
      this.nx[i] = T[0] * o.nu + T[2] * o.nv; this.ny[i] = T[1] * o.nu + T[3] * o.nv; this.nz[i] = o.nz;
      this.z[i] = o.z; this.t[i] = o.t; this.p[i] = o.pid || pid; this.e[i] = o.em; this.sp[i] = o.em ? S.sp || 0 : 0;
    });
    return this;
  }

  // 1-px Bresenham line between local points (decal by default: only on existing pixels)
  line(u1, v1, u2, v2, S) {
    const x0 = Math.floor(this.wx(u1, v1)), y0 = Math.floor(this.wy(u1, v1));
    const x1 = Math.floor(this.wx(u2, v2)), y1 = Math.floor(this.wy(u2, v2));
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, x = x0, y = y0;
    const D = S.solid ? S : { ...S, decal: true };
    const pid = S.solid ? this._pid(S) : 0;
    for (let guard = 0; guard < 2000; guard++) {
      this.dot(x, y, D, pid);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
    return this;
  }
  polyline(pts, S) { for (let k = 0; k + 1 < pts.length; k++) this.line(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], S); return this; }
  // world-pixel write
  dot(x, y, S, pid = 0) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    if (S.decal) this.put(i, S, S.n ? S.n[0] : 0, S.n ? S.n[1] : 0, S.n ? S.n[2] : 1, 0, 0);
    else this.put(i, S, 0, 0, 1, S.z || 0, pid || this._pid(S));
  }
  // local-point pixel
  px(u, v, S) { this.dot(Math.floor(this.wx(u, v)), Math.floor(this.wy(u, v)), S.solid || S.m && !S.decal && !S.clip ? S : { ...S, decal: true }); return this; }

  // -------------------------------------------------------------------------------------
  // Shading: G-buffer -> color + emissive Uint32 buffers
  // -------------------------------------------------------------------------------------
  shade(opt = NO) {
    const { w, h, m, nx, ny, nz, z, t, p, e, sp } = this;
    const n = w * h;
    const col = new Uint32Array(n), emi = new Uint32Array(n);
    const edge = this._edge || (this._edge = new Uint8Array(n));
    edge.fill(0);
    const shadowReach = opt.shadowReach ?? 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, mi = m[i];
      if (!mi) continue;
      if (e[i]) { col[i] = e[i]; emi[i] = e[i]; continue; }
      const Mt = MATS[mi], R = Mt.ramp, N = R.length;
      let ax = nx[i], ay = ny[i], az = nz[i];
      const nl = Math.hypot(ax, ay, az) || 1; ax /= nl; ay /= nl; az /= nl;
      const ndl = ax * Lx + ay * Ly + az * Lz;
      let I = Mt.amb + Mt.dif * Math.max(0, ndl);
      // cast shadow from taller geometry toward the light (up-left)
      const zi = z[i];
      for (let k = 1; k <= shadowReach; k++) {
        const qx = x - k, qy = y - k;
        if (qx < 0 || qy < 0) break;
        const q = qy * w + qx;
        if (m[q] && z[q] - zi > 0.9 * k + 0.4) { I -= Mt.shadow; break; }
      }
      let tv = I * (N - 1) + t[i] + Mt.lift;
      if (Mt.dither) tv += BAYER[(y & 3) * 4 + (x & 3)] * Mt.dither;
      // rim light on edges facing the light (silhouette or step down)
      if (Mt.rim && ndl > 0.15) {
        const up = y > 0 ? i - w : -1, lf = x > 0 ? i - 1 : -1;
        if (up < 0 || !m[up] || zi - z[up] > 1.2 || lf < 0 || !m[lf] || zi - z[lf] > 1.2) tv += Mt.rim;
      }
      let idx = Math.round(tv);
      if (Mt.spec) {
        const rz = 2 * ndl * az - Lz;
        if (rz > Mt.spec) idx = N - 1;
      }
      // inner edge: a taller, different part touches this pixel
      const pi = p[i];
      if ((x > 0 && m[i - 1] && p[i - 1] !== pi && z[i - 1] - zi > 0.75) ||
          (x < w - 1 && m[i + 1] && p[i + 1] !== pi && z[i + 1] - zi > 0.75) ||
          (y > 0 && m[i - w] && p[i - w] !== pi && z[i - w] - zi > 0.75) ||
          (y < h - 1 && m[i + w] && p[i + w] !== pi && z[i + w] - zi > 0.75)) {
        idx = Math.min(idx, Mt.edge);
        edge[i] = 1;
      }
      col[i] = R[clamp(idx, 0, N - 1)];
    }
    // emissive light spill onto nearby surfaces (splat from glowing pixels)
    if (!opt.noSpill) {
      const best = this._spill || (this._spill = new Uint16Array(n));
      best.fill(0);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!e[i] || !sp[i]) continue;
        for (let dy = -2; dy <= 2; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx; if (xx < 0 || xx >= w) continue;
            const q = yy * w + xx;
            if (!m[q] || e[q] || edge[q] || MATS[m[q]].noSpill) continue;
            const near = Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
            if (!near && !SPILL[sp[i]][1]) continue;
            const s = near ? 2 : 1;
            if (s > (best[q] >> 8)) best[q] = (s << 8) | sp[i];
          }
        }
      }
      for (let i = 0; i < n; i++) {
        const b = best[i];
        if (!b) continue;
        const c = SPILL[b & 255][2 - (b >> 8)];
        if (lum32(c) > lum32(col[i])) col[i] = c;
      }
    }
    // 1-px dark outline around the silhouette (4-neighbour)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (m[i]) continue;
      if ((x > 0 && m[i - 1]) || (x < w - 1 && m[i + 1]) || (y > 0 && m[i - w]) || (y < h - 1 && m[i + w])) col[i] = OUTLINE;
    }
    return { col, emi };
  }
}

// Spill entries: [color at distance 1, color at distance 2 (0 = none)].
// Plain keys are soft (1 px of dim light); keys ending in 'S' are strong emitters.
const SPILL = [null];
const SP = {};
function initSpill() {
  if (SP.ready) return;
  const add = (k, a, b) => { SPILL.push([pack(a), b ? pack(b) : 0]); SP[k] = SPILL.length - 1; };
  const R = RAMPS;
  add('mag', R.magenta[1]); add('magS', R.magenta[2], R.magenta[1]);
  add('ember', R.ember[1]); add('emberS', R.ember[2], R.ember[1]);
  add('fire', R.ember[2]); add('fireS', R.ember[3], R.ember[2]);
  add('teal', R.crystal[1]); add('tealS', R.crystal[2], R.crystal[1]);
  add('violet', R.plasma[1]); add('violetS', R.plasma[2], R.plasma[1]);
  add('amber', R.gold[1]); add('amberS', R.gold[2], R.gold[1]);
  add('cyan', R.cyan[1]); add('cyanS', R.cyan[2], R.cyan[1]);
  add('red', '#4a0a12'); add('redS', '#8a1422', '#4a0a12');
  SP.ready = true;
}

function inPolyF(X, Y, n, x, y) {
  let c = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = Y[i], yj = Y[j];
    if ((yi > y) !== (yj > y) && x < ((X[j] - X[i]) * (y - yi)) / (yj - yi) + X[i]) c = !c;
  }
  return c;
}

function inPoly(pts, x, y) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// ---------------------------------------------------------------------------------------
// Sprite building
// ---------------------------------------------------------------------------------------

function toCanvas(w, h, u32, any = true) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  if (any) {
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(w, h);
    new Uint32Array(img.data.buffer).set(u32);
    ctx.putImageData(img, 0, 0);
  }
  return cv;
}

// Build a registerSprite def. draw(g, frame, dirIndex, angle) paints the G-buffer.
function build(w, h, { frames = 1, dirs = 1, fps = 8, shade = NO }, draw) {
  const g = new GB(w, h);
  const out = { w, h, frameCount: frames, dirs, fps, frames: [], emissive: [] };
  let anyEm = false;
  for (let d = 0; d < dirs; d++) {
    const ang = (d / dirs) * TAU;
    for (let f = 0; f < frames; f++) {
      const _t0 = performance.now();
      g.reset(ang);
      draw(g, f, d, ang);
      const _t1 = performance.now();
      const { col, emi } = g.shade(shade);
      const _t2 = performance.now();
      (globalThis.__prof ||= { draw: 0, shade: 0, canvas: 0 }); __prof.draw += _t1 - _t0; __prof.shade += _t2 - _t1;
      let has = false;
      for (let k = 0; k < emi.length; k++) if (emi[k]) { has = true; break; }
      anyEm = anyEm || has;
      const _t3 = performance.now();
      out.frames.push(toCanvas(w, h, col));
      out.emissive.push(toCanvas(w, h, emi, has));
      __prof.canvas += performance.now() - _t3;
    }
  }
  if (!anyEm) out.emissive = null;
  return out;
}

// Emissive color from a ramp, t in 0..1 (0 = darkest glow, 1 = white hot)
function glow(rampName, t) {
  const R = P[rampName];
  return R[clamp(Math.round(t * (R.length - 1)), 0, R.length - 1)];
}

// Tiny 3x5 font for hull markings
const GLYPH = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001111',
  A: '010101111101101', R: '110101110101101', W: '101101101111101', X: '101101010101101', '-': '000000111000000',
  N: '110101101101101', V: '101101101101010', L: '100100100100111', S: '011100010001110', C: '011100100100011',
};
function text(g, str, u, v, S) {
  let cu = u;
  for (const ch of str) {
    const gl = GLYPH[ch];
    if (gl) for (let k = 0; k < 15; k++) if (gl[k] === '1') g.px(cu + (k % 3), v + ((k / 3) | 0), S);
    cu += 4;
  }
}

// ---------------------------------------------------------------------------------------
// Shared motifs
// ---------------------------------------------------------------------------------------

// Full symmetric polygon from its left half (points listed top -> bottom, u <= 0)
function mirror(half) {
  const out = half.slice();
  for (let k = half.length - 1; k >= 0; k--) {
    const [u, v] = half[k];
    if (u === 0) continue;
    out.push([-u, v]);
  }
  return out;
}

// Tapered beam (quad) from p1 (width w1) to p2 (width w2)
function beam(g, u1, v1, u2, v2, w1, w2, S) {
  const dx = u2 - u1, dy = v2 - v1, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
  return g.poly([[u1 + nx * w1 / 2, v1 + ny * w1 / 2], [u2 + nx * w2 / 2, v2 + ny * w2 / 2],
    [u2 - nx * w2 / 2, v2 - ny * w2 / 2], [u1 - nx * w1 / 2, v1 - ny * w1 / 2]], S);
}

// A faceted crystal shard pointing along local -v, base at (0,0): a hexagonal prism seen
// from above — lit face, narrow camera-facing ridge face, shadow face — with light trapped
// inside glowing up from the root.
function shard(g, len, hw, S) {
  const pid = S.pid || g.pid++;
  const z = S.z || 0, m = S.m || M.crysM;
  const sh = -len * (S.shoulder ?? 0.42), bw = hw * (S.base ?? 0.8);
  const cw = hw * (S.ridge ?? 0.3), cs = sh * 0.92;
  g.poly([[-bw, 0.5], [-hw, sh], [0, -len], [-cw, cs], [-cw * 0.9, 0.5]], { m, z, pid, n: [-0.9, -0.2, 0.7] });
  g.poly([[bw, 0.5], [hw, sh], [0, -len], [cw, cs], [cw * 0.9, 0.5]], { m, z, pid, n: [0.9, -0.2, 0.7] });
  g.poly([[-cw * 0.9, 0.5], [-cw, cs], [0, -len], [cw, cs], [cw * 0.9, 0.5]], { m, z, pid, n: [0, -0.35, 1] });
  if (S.core) g.line(hw * 0.45, -0.5, hw * 0.35, -len * (S.coreLen ?? 0.35), { em: S.core, sp: S.sp });
  if (S.tip) g.px(0, -len + 1, { em: S.tip });
}

// Crystal cluster (Choir infection): n shards fanning around direction `dir` (radians, 0 = up)
function crystalCluster(g, u, v, dir, n, size, seed, S = {}) {
  const R = rng(seed);
  const items = [];
  const mid = (n - 1) / 2;
  for (let k = 0; k < n; k++) {
    const a = dir + (k - mid) * (S.spread ?? 0.45) + (R() - 0.5) * 0.25;
    const main = Math.abs(k - mid) < 0.6;
    const len = size * (main ? 1 : 0.45 + R() * 0.4);
    items.push({ a, len, hw: Math.max(1.4, len * (S.fat ?? 0.22) * (0.85 + R() * 0.3)), du: (R() - 0.5) * size * 0.2, dv: (R() - 0.5) * size * 0.2, main });
  }
  items.sort((a, b) => a.len - b.len);
  const z = S.z || 0;
  const coreC = S.core ?? glow('magenta', 0.6);
  items.forEach((it, k) => {
    g.save().tr(u + it.du, v + it.dv).rot(it.a);
    shard(g, it.len, it.hw, { m: S.m || M.crysM, z: z + 1 + k * 1.2, core: it.len > 6 ? coreC : 0, sp: S.sp ?? SP.mag, tip: it.main ? S.tip : 0 });
    g.restore();
  });
}

// Choir crust: glossy organic carapace growth spreading over a surface, with glowing pores
function crust(g, u, v, r, seed, S = {}) {
  const z = S.z || 0, f = 0.2;
  g.fill(u - r - 2, v - r - 2, u + r + 2, v + r + 2, { m: S.m || M.crust, z }, (uu, vv, o) => {
    const du = uu - u, dv = vv - v, d = Math.hypot(du, dv) / r;
    const nn = fbm(uu * f, vv * f, seed, 2);
    const k = d + (nn - 0.5) * 0.8;
    if (k > 1) return false;
    const e = 0.5;
    const gx = fbm((uu + e) * f, vv * f, seed, 2) - nn, gy = fbm(uu * f, (vv + e) * f, seed, 2) - nn;
    o.nu = -gx * 6 + (du / r) * 0.9; o.nv = -gy * 6 + (dv / r) * 0.9; o.nz = 1;
    o.z = z + (1 - k) * 2.5;
    const pore = hash2(Math.floor(uu), Math.floor(vv), seed + 5);
    if (pore > 0.93 && k < 0.75) o.em = glow(S.pore || 'magenta', 0.5);
    return true;
  });
}

// Creeping veins: seeded random walks from (u,v) heading `dir`; glowing near the root,
// dark-magenta scars further out
function veins(g, u, v, dir, n, len, seed, S = {}) {
  const R = rng(seed);
  for (let k = 0; k < n; k++) {
    let a = dir + (R() - 0.5) * (S.spread ?? 1.6), x = u, y = v;
    const L = len * (0.5 + R() * 0.6);
    const pts = [[x, y]];
    for (let s = 0; s < L; s += 2.5) {
      a += (R() - 0.5) * 0.9;
      x += Math.sin(a) * 2.5; y -= Math.cos(a) * 2.5;
      pts.push([x, y]);
      if (R() < 0.12 && pts.length > 2) {
        const b = a + (R() < 0.5 ? -1 : 1) * (0.7 + R() * 0.5);
        g.line(x, y, x + Math.sin(b) * 4, y - Math.cos(b) * 4, { m: M.crysM, t: -3 });
      }
    }
    for (let q = 0; q + 1 < pts.length; q++) {
      const near = q / pts.length < 0.45;
      g.line(pts[q][0], pts[q][1], pts[q + 1][0], pts[q + 1][1], near ? { em: glow('magenta', S.bright ?? 0.4), sp: SP.mag } : { m: M.crysM, t: -3 });
    }
    const end = pts[pts.length - 1];
    if (R() < 0.6) g.px(end[0], end[1], { em: glow('magenta', 0.6) });
  }
}

// Row of rivets along a local line
function rivets(g, u1, v1, u2, v2, step, S = {}) {
  const L = Math.hypot(u2 - u1, v2 - v1), n = Math.max(1, Math.round(L / step));
  for (let k = 0; k <= n; k++) {
    const u = lerp(u1, u2, k / n), v = lerp(v1, v2, k / n);
    g.px(u, v, { dt: S.dt ?? 2 });
    if (S.shadow !== false) g.px(u + 1, v + 1, { dt: -1 });
  }
}

// Engraved panel seam: dark groove with a lit lip under it
function seam(g, u1, v1, u2, v2, depth = -2) {
  g.line(u1, v1, u2, v2, { dt: depth });
}

// Vent grille in a local rect (dark slots)
function vent(g, u, v, w, h, horiz = true, S = {}) {
  g.rect(u, v, w, h, { m: M.dark, z: (S.z ?? 0) - 0.5, t: 0 });
  if (horiz) for (let k = 1; k < h; k += 2) g.line(u + 0.5, v + k + 0.5, u + w - 0.5, v + k + 0.5, { m: S.slat || M.hull, t: S.st ?? 0 });
  else for (let k = 1; k < w; k += 2) g.line(u + k + 0.5, v + 0.5, u + k + 0.5, v + h - 0.5, { m: S.slat || M.hull, t: S.st ?? 0 });
}

// Hazard stripes decal inside a local rect
function hazard(g, u, v, w, h, S = {}) {
  g.fill(u, v, u + w, v + h, { decal: true }, (uu, vv, o) => {
    const s = Math.floor((uu + vv * (S.dir ?? 1)) / 2.5) & 1;
    o.m = s ? M.gold : M.dark;
    o.dt = s ? 0 : 1;
    return true;
  });
}

export const BOSS_META = {};

// =======================================================================================
// 1. WARDEN — hijacked shipyard carrier (S1 Aurora Ring)
// A dry-dock carrier: rear engine block + bridge, two forward pylons framing an open bay in
// which the reactor core hangs in a cradle, crane turntables on the wings. The Choir's
// crystal crust erupts from the starboard engine block and a pylon tip.
// =======================================================================================

const WARDEN = {
  armL: [-53, -18], armR: [53, -18], // arm pivots on the hull (turntable centers)
  armPivot: [0, -20],                 // pivot inside the (unflipped, left) arm sprite
  armTip: [0, 26],                    // claw grip point inside the (unflipped) arm sprite
  turrets: [[-24, -22], [24, -22], [-31, 21], [31, 21]],
  core: [0, 8],                       // core sprite center (hangs in the bay)
  coreR: 9,
  bay: [0, 24],                       // drone launch point (open bay)
  hullRadius: 46,
  // collision rects [x, y, w, h] relative to the hull center (the bay stays open)
  rects: [[-44, -39, 88, 34], [-41, -5, 19, 42], [22, -5, 19, 42], [-63, -32, 20, 26], [43, -32, 20, 26], [-14, -5, 28, 27]],
};

function wardenHull(g, f) {
  const on = f === 0;

  // ---- wings with crane turntables (behind the main hull)
  g.sym(() => {
    g.poly([[-42, -32], [-50, -37], [-58, -37], [-63, -31], [-63, -12], [-58, -7], [-42, -10]], { m: M.hull, z: 3, bev: 2, pil: 0.35, t: -1 });
    g.poly([[-44, -31], [-50, -35], [-57, -35], [-61, -30], [-61, -28], [-44, -28]], { m: M.armor, z: 3.6, bev: 1, t: -1 });
    rivets(g, -61, -24, -61, -13, 3);
    g.circ(-53, -18, 8.6, { m: M.hullD, z: 4, h: 1.2 });
    g.ring(-53, -18, 6.6, 8.6, { m: M.paint, z: 4.6 });
    for (let k = 0; k < 20; k++) { const a = (k / 20) * TAU; g.px(-53 + Math.cos(a) * 7.6, -18 + Math.sin(a) * 7.6, { dt: k & 1 ? -2 : 0 }); }
    g.circ(-53, -18, 4, { m: M.dark, z: 3.5 });
    hazard(g, -63, -11, 20, 6, { dir: 1 });
  });

  // ---- main hull: rear engine block + two forward pylons (structure)
  const hull = mirror([[0, -36], [-26, -36], [-41, -32], [-44, -27], [-44, -12], [-41, -7], [-41, 24], [-35, 36], [-29, 38], [-23, 30], [-22, -2], [-16, -5], [0, -5]]);
  g.poly(hull, { m: M.hull, z: 4, bev: 2.5, bk: 1.2, t: -1 });

  // raised armor on the rear block: three plates per side
  g.sym(() => {
    g.poly([[-27, -35], [-29, -34], [-29, -21], [-27, -21]], { m: M.armor, z: 5.5, bev: 1, t: -1 });
    g.poly([[-31, -33], [-39, -30], [-40, -21], [-31, -21]], { m: M.armor, z: 5.5, bev: 1.4, bk: 1.3, pil: 0.3, t: -1 });
    g.poly([[-13, -19], [-40, -19], [-40, -13], [-30, -9], [-13, -9]], { m: M.armor, z: 5.5, bev: 1.4, bk: 1.3, pil: 0.3 });
    rivets(g, -38, -11, -31, -11, 3);
    vent(g, -38, -29, 5, 6, true, { z: 5.2, slat: M.armor, st: -1 });
    // turret pad
    g.circ(-24, -22, 6, { m: M.hullD, z: 6, h: 0.8 });
    g.ring(-24, -22, 4.8, 6, { m: M.armor, z: 6.3, flat: true });
  });

  // pylons
  g.sym((s) => {
    g.poly([[-39, -6], [-24, -6], [-24, 28], [-28, 35], [-33, 34], [-39, 23]], { m: M.armor, z: 5.5, bev: 1.5, bk: 1.3, pil: 0.3 });
    seam(g, -39, 5, -24, 5); seam(g, -39, 14, -24, 14);
    rivets(g, -37, -4, -37, 3, 3); rivets(g, -26, 7, -26, 12, 3);
    g.rect(-38, 8, 3, 5, { m: M.hullD, z: 5.8 });
    // bay-side rail with floodlights facing the core
    g.rect(-24, -4, 2, 32, { m: M.dark, z: 5 });
    for (let v = -2; v <= 26; v += 4) g.px(-23, v, { em: glow('cyan', on === (v % 8 === 2) ? 0.7 : 0.45), sp: SP.cyan });
    // outer pipe run
    g.cyl(-41.5, -8, -41.5, 27, 1.1, { m: M.steel, z: 5 });
    hazard(g, -40, 27, 17, 12, { dir: s });
    g.circ(-31, 21, 6, { m: M.hullD, z: 6.5, h: 0.8 });
    g.ring(-31, 21, 4.8, 6, { m: M.armor, z: 6.8, flat: true });
  });
  text(g, '07', -35, 7, { m: M.gold, t: 0 });

  // ---- engine nacelles breaking the top silhouette
  g.sym(() => {
    g.fill(-26, -40, -10, -17, { m: M.armor, z: 6.5 }, (u, v, o) => {
      const a = (u + 18) / 7.5;
      if (Math.abs(a) > 1) return false;
      const top = -39 + 2.5 * (1 - Math.sqrt(1 - a * a));
      if (v < top || v > -18) return false;
      o.nu = a * 0.95; o.nv = v < top + 2 ? -0.7 : 0; o.nz = Math.sqrt(1 - a * a * 0.85);
      o.z = 6.5 + 3 * Math.sqrt(1 - a * a);
      return true;
    });
    for (const v of [-31, -24]) seam(g, -25, v, -11, v);
    rivets(g, -23, -29, -13, -29, 3);
    g.ell(-18, -36, 5.2, 2.4, { m: M.steel, z: 10, h: 1.3 });
    g.ell(-18, -36.2, 3.8, 1.5, { m: M.dark, z: 9.8 });
  });
  g.ell(-18, -36.2, 2.8, 0.9, { m: M.dark, z: 9.8, em: glow('plasma', on ? 0.85 : 0.7), sp: SP.violet });
  g.ell(18, -36.2, 2.8, 0.9, { m: M.dark, z: 9.8, em: glow('plasma', on ? 0.7 : 0.85), sp: SP.violet });
  g.px(-18, -36, { em: glow('plasma', 1) }); g.px(18, -36, { em: glow('plasma', 1) });

  // ---- bridge superstructure
  g.poly(mirror([[0, -34], [-9, -34], [-12, -29], [-12, -19], [-8, -15], [0, -15]]), { m: M.steel, z: 7.5, bev: 1.5, bk: 1.3 });
  g.poly(mirror([[0, -32], [-6, -32], [-8, -28], [-8, -22], [0, -22]]), { m: M.steel, z: 9.5, bev: 1.2, bk: 1.3 });
  g.rect(-8, -18.5, 16, 2, { m: M.dark, z: 7.6 });
  for (let k = -7; k <= 6; k++) if (k & 1) g.px(k + 0.5, -17.5, { em: glow('gold', k === 3 && !on ? 0.35 : 0.7), sp: SP.amber });
  g.circ(0, -27, 2.6, { m: M.steel, z: 11.5, h: 2 });
  g.cyl(5, -29, 9, -35, 0.6, { m: M.steel, z: 11 });
  g.px(9, -35.5, { em: on ? pack('#ff5a5a') : pack('#5a1018') });

  // ---- core cradle in the bay
  g.rect(-6, -7, 12, 6, { m: M.armor, z: 5, bev: 1 });
  seam(g, -2, -6, -2, -2); seam(g, 2, -6, 2, -2);
  g.circ(0, 8, 12, { m: M.dark, z: 3 });
  g.fill(-12, -4, 12, 20, { decal: true }, (u, v, o) => {
    const d = Math.hypot(u, v - 8);
    if (d > 11.5 || d < 9) return false;
    if (hash2(Math.round(u * 3), Math.round(v * 3), 3) > 0.75) { o.em = glow('magenta', 0.3); return true; }
    return false;
  });
  g.ring(0, 8, 11.6, 14.2, { m: M.steel, z: 5.5 });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + TAU / 12;
    g.save().tr(Math.sin(a) * 12.6, 8 - Math.cos(a) * 12.6).rot(a);
    g.poly([[-2, -1.5], [2, -1.5], [1.2, 2.2], [-1.2, 2.2]], { m: M.hull, z: 7, bev: 0.8 });
    g.restore();
  }
  g.sym(() => {
    g.cyl(-13, 3, -22, -1, 1.7, { m: M.hullD, z: 4.5 });
    g.px(-17, 1, { em: glow('magenta', on ? 0.6 : 0.4), sp: SP.mag });
    g.px(-18, 1, { em: glow('magenta', on ? 0.45 : 0.6), sp: SP.mag });
  });

  // ---- gantry truss across the bay mouth (decorative)
  g.cyl(-22, 29, 22, 29, 0.8, { m: M.steel, z: 3 });
  g.cyl(-22, 32.5, 22, 32.5, 0.8, { m: M.steel, z: 3 });
  for (let u = -22; u < 22; u += 5.5) g.cyl(u, 29, u + 5.5, 32.5, 0.55, { m: M.hull, z: 2.5 });
  g.rect(-9, 27, 7, 7, { m: M.gold, z: 4, bev: 1 });
  g.rect(-8, 29, 5, 3, { m: M.dark, z: 4.2 });
  g.px(-6, 30, { em: on ? glow('gold', 0.8) : glow('gold', 0.4) });

  for (const u of [-11, -7, 7, 11]) g.px(u, -6, { em: glow('gold', 0.75), sp: SP.amber });

  // nav lights: starboard green (screen-left), port red (screen-right) — the ship faces down
  g.circ(-62.5, -19, 1.1, { m: M.dark, z: 4, em: on ? glow('lime', 0.8) : glow('lime', 0.4) });
  g.circ(62.5, -19, 1.1, { m: M.dark, z: 4, em: on ? pack('#ff5a5a') : pack('#7a1420') });
  g.px(-32, 36, { em: on ? WHITE : glow('steel', 0.3) });
  g.px(32, 36, { em: on ? glow('steel', 0.3) : WHITE });

  // ---- scorched plating (old battle damage), port side
  g.fill(-44, -34, -18, -8, { decal: true }, (u, v, o) => {
    const n = fbm(u * 0.25, v * 0.25, 91) - Math.hypot(u + 33, v + 25) * 0.04;
    if (n < 0.3) return false;
    o.dt = n > 0.45 ? -2 : -1;
    if (n > 0.52) o.m = M.rust;
    return true;
  });

  // ---- Choir infection
  crust(g, 37, -24, 9, 11, { z: 6 });
  veins(g, 33, -21, 3.8, 6, 20, 12);
  crystalCluster(g, 34, -22, 0.35, 3, 11, 75, { z: 8, spread: 0.5 });
  crystalCluster(g, 41, -25, 1.0, 5, 19, 71, { z: 10, tip: WHITE, spread: 0.38, fat: 0.2 });
  crust(g, -33, 29, 6, 21, { z: 6 });
  veins(g, -32, 26, 0.3, 3, 12, 22);
  crystalCluster(g, -35, 31, -2.45, 3, 9, 72, { z: 7, tip: glow('magenta', 1) });
  crust(g, 9, -3, 4, 31, { z: 6 });
  crystalCluster(g, 10, -4, 0.5, 3, 7, 73, { z: 7 });
  veins(g, 6, -3, -1.2, 2, 10, 32);
}

function wardenArm(g) {
  // upper arm: armored box with a hydraulic ram on the outer side
  g.cyl(-7.5, -15, -10.5, -1, 1.8, { m: M.hullD, z: 4, cap: 'flat' });
  g.cyl(-9.5, -7, -11.5, 2, 1.0, { m: M.steel, z: 4.5 });
  beam(g, 0, -17, -4, 2, 11, 9, { m: M.paint, z: 5, bev: 1.8, bk: 1.3, pil: 0.3 });
  beam(g, -0.7, -13.5, -1.3, -10.5, 11.4, 11, { m: M.hullD, z: 5.3, bev: 0.8 });
  seam(g, -6, -4, 2, -6);
  rivets(g, 3.5, -9, 1.5, -1, 3);
  // forearm
  g.cyl(-1, 4, 5, 13, 1.2, { m: M.steel, z: 4.5 });
  beam(g, -4, 2, 0, 15, 10, 7.5, { m: M.paint, z: 5.5, bev: 1.6, bk: 1.3, pil: 0.3 });
  hazard(g, -8, 10, 14, 4, { dir: -1 });
  seam(g, -7, 8, 3, 7);
  g.px(-3, 11, { em: glow('gold', 0.8), sp: SP.amber });
  g.px(1, 11, { em: glow('gold', 0.8), sp: SP.amber });
  // joints
  g.circ(-4, 2, 4.6, { m: M.steel, z: 8, h: 2 });
  g.circ(-4, 2, 1.6, { m: M.dark, z: 8.5 });
  g.circ(0, -20, 7.2, { m: M.steel, z: 9, h: 2.5 });
  g.ring(0, -20, 5.2, 7.2, { m: M.gun, z: 9.5, k: 1.3 });
  for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; g.px(Math.cos(a) * 6.2, -20 + Math.sin(a) * 6.2, { dt: -2 }); }
  g.circ(0, -20, 2.8, { m: M.hullD, z: 10, h: 1.5 });
  g.px(0, -20, { em: glow('magenta', 0.8), sp: SP.mag });
  // wrist + claw
  g.circ(0, 16, 4.4, { m: M.hullD, z: 6, h: 1.5 });
  g.poly([[-6, 17], [6, 17], [9.5, 21], [-9.5, 21]], { m: M.steel, z: 6.5, bev: 1.2, bk: 1.3 });
  const tal = (pts, rs) => {
    for (let k = 0; k + 1 < pts.length; k++) g.cyl(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], rs[k], { m: k === pts.length - 2 ? M.crysM : M.gun, z: 7 - k * 0.5 });
    const t = pts[pts.length - 1];
    g.px(t[0], t[1], { em: glow('magenta', 0.95), sp: SP.mag });
  };
  tal([[-7, 20], [-11, 23], [-10, 26.5], [-6.5, 28]], [2, 1.6, 1.1]);
  tal([[7, 20], [11, 23], [10, 26.5], [6.5, 28]], [2, 1.6, 1.1]);
  tal([[0, 21], [0, 25], [0, 27.5]], [1.8, 1.2]);
  // infection creeping down to the claw
  crystalCluster(g, -7, 5, -1.9, 2, 6, 81, { z: 9, tip: glow('magenta', 1) });
  veins(g, -5, 6, 3.0, 2, 9, 82, { spread: 0.5 });
}

function wardenTurret(g) {
  // rotating turret, pointing up at dir 0
  g.circ(0, 0.5, 6.4, { m: M.hullD, z: 1, h: 1 });
  g.ring(0, 0.5, 5.2, 6.4, { m: M.hull, z: 1.5 });
  g.cyl(-1.7, -1, -1.7, -6.7, 1.05, { m: M.gun, z: 4, cap: 'flat' });
  g.cyl(1.7, -1, 1.7, -6.7, 1.05, { m: M.gun, z: 4, cap: 'flat' });
  g.poly(mirror([[0, -3], [-3, -3], [-4.2, -1], [-4.2, 2.5], [-2.5, 4.2], [0, 4.2]]), { m: M.armor, z: 5, bev: 1.3, bk: 1.4 });
  g.px(-1.7, -6.2, { em: glow('magenta', 0.85) });
  g.px(1.7, -6.2, { em: glow('magenta', 0.85) });
  g.px(0, 1, { em: glow('magenta', 0.95), sp: SP.mag });
}

function wardenCore(g, f) {
  const I = [0.3, 0.6, 1, 0.65][f];
  const oct = mirror([[0, -8], [-6, -8], [-10, -4], [-10, 4], [-6, 8], [0, 8]]);
  g.poly(oct, { m: M.steel, z: 2, bev: 2, bk: 1.3 });
  g.poly(mirror([[0, -6], [-5, -6], [-8, -3], [-8, 3], [-5, 6], [0, 6]]), { m: M.dark, z: 1 });
  const em = (t) => glow('magenta', clamp(t * I + (1 - I) * 0.1, 0, 1));
  const cz = 2.5;
  g.poly([[0, -5], [4, 0], [0, 0]], { m: M.crysM, z: cz, em: em(0.75), sp: SP.mag });
  g.poly([[0, -5], [-4, 0], [0, 0]], { m: M.crysM, z: cz, em: em(0.95), sp: SP.mag });
  g.poly([[-4, 0], [0, 5], [0, 0]], { m: M.crysM, z: cz, em: em(0.65), sp: SP.mag });
  g.poly([[4, 0], [0, 5], [0, 0]], { m: M.crysM, z: cz, em: em(0.5), sp: SP.mag });
  g.px(-1, -2, { em: I > 0.9 ? WHITE : glow('magenta', 0.95) });
  if (I > 0.5) g.px(0, -1, { em: glow('magenta', 1) });
  g.sym(() => { g.poly([[-9, -2], [-5, -1], [-5, 1], [-9, 2]], { m: M.hull, z: 3.5, bev: 0.8 }); });
  g.rect(-1, -8, 2, 2.5, { m: M.hull, z: 3.5 });
  g.rect(-1, 5.5, 2, 2.5, { m: M.hull, z: 3.5 });
  for (const [u, v] of [[-6, -7], [6, -7], [-6, 7], [6, 7]]) g.px(u, v, { dt: 2 });
}

function makeWarden() {
  const hull = build(129, 81, { frames: 2, fps: 3 }, wardenHull);
  const arm = build(37, 57, {}, wardenArm);
  const turret = build(15, 15, { dirs: 16 }, wardenTurret);
  const core = build(21, 17, { frames: 4, fps: 8 }, wardenCore);
  BOSS_META.warden = WARDEN;
  return { boss_warden: hull, boss_warden_arm: arm, boss_warden_turret: turret, boss_warden_core: core };
}

// =======================================================================================
// 2. WYRM — magma serpent of rock and machine (S2 Cinder Belt)
// Basalt plates (Voronoi facets) over an iron skeleton, molten seams glowing between the
// plates. Head and tail are rendered analytically at every baked angle.
// =======================================================================================

const WYRM = {
  segSpacing: 19,      // distance between consecutive body segment centers (px)
  segR: 12,            // body segment collision radius
  headR: 15,           // head collision radius
  tailR: 8,
  mouth: [0, -18],     // fire point for dir 0 (head pointing up); rotate by the head angle
  eyes: [[-8, -3], [8, -3]],
};

// Basalt plate texture: Voronoi cells with per-cell facet tilt and molten seams.
// Returns the seam heat (0 = none .. 1 = hottest) and writes normal/tone into o.
function basalt(u, v, o, seed, scale, nu, nv, nz, seamW) {
  const V = voronoi(u * scale + 11.3, v * scale + 5.7, seed);
  const d1 = V[0], d2 = V[1], id = V[2];
  const ta = id * TAU;
  o.nu = nu + Math.cos(ta) * 0.42; o.nv = nv + Math.sin(ta) * 0.42; o.nz = nz;
  o.t = id > 0.78 ? 1 : id < 0.18 ? -1 : 0;
  const c = d2 - d1;
  if (c < seamW) return 1 - c / seamW;
  if (c < seamW * 1.9) o.t -= 1; // darkened plate lip next to the seam
  return 0;
}

function wyrmSeg(g, f) {
  const open = f === 1;
  const R = 12.8;
  // iron collar with bolts
  g.circ(0, 0, R, { m: M.iron, z: 1, h: 3 });
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * TAU + 0.3;
    g.px(Math.cos(a) * 11.9, Math.sin(a) * 11.9, { dt: 2 });
  }
  // basalt carapace: closed = a few hot seams; open = the plates split over a molten core
  const rr = open ? 11.2 : 10.8;
  g.fill(-rr, -rr, rr, rr, { m: M.rock, z: 4, sp: open ? SP.fireS : SP.ember }, (u, v, o) => {
    const d = Math.hypot(u, v) / rr;
    if (d > 1) return false;
    const w = Math.sqrt(1 - d * d);
    const heat = basalt(u, v, o, 303, 0.17, (u / rr) * 1.2, (v / rr) * 1.2, w + 0.15, open ? 0.2 : 0.075);
    o.z = 4 + 5 * w;
    if (open && d < 0.32) { o.em = glow('fire', 0.95 - d * 1.1); return true; }
    if (heat > 0) {
      if (open) o.em = glow('fire', clamp(0.35 + heat * (0.75 - d * 0.35), 0, 1));
      else if (d < 0.75 && hash2(Math.round(u / 4), Math.round(v / 4), 9) > 0.45) o.em = glow('ember', 0.4 + heat * 0.35);
      else o.t -= 2;
    }
    return true;
  });
  if (!open) g.circ(0, 0, 1.2, { decal: true, em: glow('ember', 0.6), sp: SP.ember });
}

function wyrmHead(g, f) {
  const open = f === 1;
  // horns sweeping back along the flanks
  g.sym(() => {
    const H = [[-9, -1], [-14, 5], [-17, 12], [-16.5, 19]];
    const r = [2.9, 2.3, 1.4];
    for (let k = 0; k < 3; k++) g.cyl(H[k][0], H[k][1], H[k + 1][0], H[k + 1][1], r[k], { m: M.iron, z: 4 - k * 0.5 });
  });
  // molten maw between the mandibles
  g.ell(0, -13.5, open ? 6 : 3, open ? 6.5 : 4, { m: M.dark, z: 2, em2: (r2) => glow('fire', clamp(1.05 - r2 * 0.8, 0.3, 1)), sp: SP.fireS });
  if (open) {
    g.ell(0, -12, 2.2, 2.6, { decal: true, em: WHITE });
    g.sym(() => { for (let k = 0; k < 3; k++) g.poly([[-5.5 + k * 0.5, -16 + k * 3], [-3 + k * 0.5, -15 + k * 3], [-5.2 + k * 0.5, -14 + k * 3]], { m: M.bone, z: 3 }); });
  }
  // mandibles: pivot on the cheeks, swing outward when open
  g.sym(() => {
    g.save().tr(-6.5, -8.5).rot(open ? -0.62 : 0);
    g.poly([[2, 1.5], [-2.5, 0.5], [-4.5, -3], [-4.5, -7.5], [-2.5, -11], [1.5, -13], [5.5, -12.5], [3, -10.5], [2.2, -7], [2.8, -3]], { m: M.iron, z: 6, bev: 1.4, bk: 1.3 });
    for (let k = 0; k < 3; k++) g.poly([[2.4, -2.8 - k * 3], [4.4, -4 - k * 3], [2.4, -5.2 - k * 3]], { m: M.bone, z: 6.5 });
    g.line(-3.3, -3, -2, -9.5, { dt: 1 });
    g.restore();
  });
  // skull: basalt wedge
  const skull = mirror([[0, -13.5], [-3.5, -13], [-6.5, -9.5], [-9.5, -4], [-12, 2], [-12.5, 8], [-10, 13.5], [-5, 16.5], [0, 17]]);
  const SX = new Float64Array(skull.map((p) => p[0])), SY = new Float64Array(skull.map((p) => p[1]));
  g.fill(-13, -14, 13, 17.5, { m: M.rock, z: 7, sp: SP.ember }, (u, v, o) => {
    if (!inPolyF(SX, SY, SX.length, u, v)) return false;
    const a = u / 12.5, b = (v - 3) / 16;
    const r2 = Math.min(0.96, a * a + b * b), w = Math.sqrt(1 - r2);
    const heat = basalt(u, v, o, 404, 0.2, a * 1.2, b * 1.0, w + 0.25, 0.07);
    o.z = 7 + 5 * w;
    if (heat > 0) o.t -= 2;
    return true;
  });
  // hand-placed molten cracks running back from the brows
  g.sym(() => {
    g.polyline([[-3, -6], [-5, -1], [-4.5, 4], [-7, 9], [-6, 13]], { em: glow('ember', 0.55), sp: SP.ember });
    g.px(-5, -1, { em: glow('ember', 0.8) });
  });
  // machine plating at the back of the skull
  g.poly(mirror([[0, 7], [-5.5, 8], [-7.5, 12], [-5, 15.5], [0, 16.5]]), { m: M.iron, z: 12.5, bev: 1.3, bk: 1.3 });
  g.line(0, 8, 0, 16, { dt: -2 });
  rivets(g, -4, 10, -4, 14, 2.5); rivets(g, 4, 10, 4, 14, 2.5);
  // snout plate + nostrils
  g.poly(mirror([[0, -13.5], [-3, -13], [-4, -9], [-2, -6], [0, -6]]), { m: M.iron, z: 12, bev: 1, bk: 1.2 });
  g.sym(() => g.px(-1.5, -11.5, { em: glow('ember', 0.85), sp: SP.ember }));
  // brow ridges
  g.sym(() => beam(g, -2.5, -8, -11, -1.5, 3, 2.2, { m: M.rock, z: 12.5, bev: 1, bk: 1.3, t: 1 }));
  // eyes: slits under the brows
  g.sym(() => {
    g.line(-5.5, -4.5, -9.5, -1.5, { em: glow('fire', 0.85), sp: SP.fireS });
    g.px(-6.5, -4, { em: glow('fire', 1) });
  });
}

function wyrmTail(g) {
  // tip points up (dir 0)
  g.poly(mirror([[0, -1], [-4.5, 0], [-6.5, 4], [-5.5, 8], [0, 9.5]]), { m: M.iron, z: 1, bev: 1.5 });
  g.fill(-6.5, -6, 6.5, 9, { m: M.rock, z: 3, sp: SP.ember }, (u, v, o) => {
    const k = (v + 6) / 15;
    const hw = 1.5 + k * 5;
    if (Math.abs(u) > hw || v > 8.5) return false;
    const heat = basalt(u, v, o, 505, 0.24, (u / hw) * 0.9, -0.3, 0.8, 0.08);
    o.z = 3 + 3 * (1 - Math.abs(u / hw));
    if (heat > 0) o.t -= 2;
    return true;
  });
  g.line(-4, 2.5, 4, 2.5, { em: glow('ember', 0.75), sp: SP.ember });
  g.poly([[0, -9.5], [-2.2, -4], [-1.2, -2], [1.2, -2], [2.2, -4]], { m: M.iron, z: 8, bev: 1, bk: 1.4 });
  g.px(0, -4, { em: glow('fire', 0.9), sp: SP.fire });
}

function makeWyrm() {
  let _t = performance.now();
  const seg = build(29, 29, { frames: 2, fps: 4 }, wyrmSeg);
  __prof.seg = (__prof.seg || 0) + performance.now() - _t; _t = performance.now();
  const head = build(45, 45, { frames: 2, dirs: 32, fps: 4 }, wyrmHead);
  __prof.head = (__prof.head || 0) + performance.now() - _t; _t = performance.now();
  const tail = build(21, 21, { dirs: 32 }, wyrmTail);
  __prof.tail = (__prof.tail || 0) + performance.now() - _t;
  BOSS_META.wyrm = WYRM;
  return { boss_wyrm_head: head, boss_wyrm_seg: seg, boss_wyrm_tail: tail };
}

// @@BOSSES@@

const BOSSES = [makeWarden, makeWyrm];

// ---------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------

export async function makeBossArt(onProgress) {
  initMats(); initSpill();
  const out = {};
  const yieldNow = () => new Promise((r) => setTimeout(r, 0));
  for (let k = 0; k < BOSSES.length; k++) {
    Object.assign(out, BOSSES[k]());
    if (onProgress) onProgress((k + 1) / BOSSES.length);
    await yieldNow();
  }
  return out;
}

export async function buildBossArt(onProgress) {
  const { registerSprite } = await import('./sprites.js');
  const defs = await makeBossArt(onProgress);
  for (const name in defs) registerSprite(name, defs[name]);
  return defs;
}
