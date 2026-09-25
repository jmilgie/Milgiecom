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
//
// API
//   makeBossArt(onProgress?, { bosses?: ['warden'|'wyrm'|'prism'|'dread'|'heart'], lint?: [] })
//       -> { [spriteName]: def } in the registerSprite() shape (DESIGN.md §5)
//   buildBossArt(onProgress?, opt?)  makeBossArt + registerSprite() for every sprite
//   BOSS_META  attachment points / collision shapes (px, relative to the named sprite's
//              center, for dir 0 / unflipped art). Static: available at import time.
//
// Conventions
//   * Rotated sprites (dirs > 1): dir 0 points UP, clockwise. Their frames are square so every
//     baked direction fits (each def reports its true size): boss_prism_shard 35x35,
//     boss_heart_petal 41x41, boss_wyrm_head 51x51.
//   * Every frame keeps its 1-px outline inside the frame (dev lint: opt.lint), so some
//     frames are a little larger than the DESIGN targets: warden_core 23x19, warden_arm 37x59,
//     wyrm_tail 25x25, prism 51x69, dread_cannon 33x47, heart_core2 63x63. Centers (and so
//     every BOSS_META offset) are unchanged by the padding.
//   * Glow: the color frame holds the full glow color; the emissive frame holds it at 0.6
//     (EMI_K) because post adds light + bloom over main. White / near-white hot points stay 1.
//   * boss_warden_arm is the LEFT arm; draw the right one with flipX and mirror the x of
//     armPivot / armTip — or use boss_warden_arm_r (BOSS_META.warden.armRSprite), the same arm
//     re-rasterized mirrored so its lighting stays top-left (drawn without flipX).
//   * boss_wyrm_head frame = open ? 1 : 0; rotate BOSS_META.wyrm.mouth by the head angle.
//     boss_wyrm_seg frame 1 = cracked / exposed; segments have 16 dirs (pass the body tangent)
//     and 3 variants (BOSS_META.wyrm.segVariants). Tail dir = direction from the previous
//     segment to the tail (tip points away from the body).
//   * boss_prism_shard dir = its orbit angle (tip points outward).
//   * boss_dread_cannon frames 0..3 = idle .. full charge (fire on 3); hatch 0 closed / 1 open.
//   * boss_heart frames 0-3 iris pulse loop, 4 half-closed, 5 closed; halo 8 frames loop
//     seamlessly; petal k at heart + petalR * (sin a, -cos a) with dir a.
//   * Optional extras (additive, not in DESIGN §5): boss_warden_arm_r, boss_warden_hatch
//     (core bay doors, 5 frames shut..open), boss_wyrm_seg_b / _c, boss_dread_shutter (bridge
//     blast shutter, 5 frames), boss_dread_shadow (soft drop shadow). See BOSS_META.

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

// Voronoi cell distances (for rock plates / crystal crust): returns [d1, d2, cellId]
const _vor = [0, 0, 0];
function voronoi(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let d1 = 99, d2 = 99, bx = 0, by = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j;
    const dx = cx + 0.15 + 0.7 * hash2(cx, cy, seed) - x, dy = cy + 0.15 + 0.7 * hash2(cx, cy, seed + 7) - y;
    const d = dx * dx + dy * dy;
    if (d < d1) { d2 = d1; d1 = d; bx = cx; by = cy; } else if (d < d2) d2 = d;
  }
  _vor[0] = Math.sqrt(d1); _vor[1] = Math.sqrt(d2); _vor[2] = hash2(bx, by, seed + 13);
  return _vor;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const hyp = (a, b) => Math.sqrt(a * a + b * b);   // Math.hypot is slow in hot loops
const hyp3 = (a, b, c) => Math.sqrt(a * a + b * b + c * c);
const lerp = (a, b, t) => a + (b - a) * t;

// Packed little-endian RGBA (ImageData Uint32 view)
function pack(hex, a = 255) {
  const [r, g, b] = hexToRgb(hex);
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}
function lum32(c) { return (c & 255) * 0.3 + ((c >>> 8) & 255) * 0.59 + ((c >>> 16) & 255) * 0.11; }
function scale32(c, k) {
  return ((c & 0xff000000) | (Math.round(((c >>> 16) & 255) * k) << 16) | (Math.round(((c >>> 8) & 255) * k) << 8) | Math.round((c & 255) * k)) >>> 0;
}
// Light-layer intensity for area glows (post adds the light layer over the color layer and
// blooms it). Near-white ramp tops (lum >= EMI_HOT_LUM) and S.hot pixels stay at 1.
const EMI_K = 0.6, EMI_HOT_LUM = 200;

const OUTLINE = pack(C.outline);
const P = {}; // packed ramps
for (const k in RAMPS) P[k] = RAMPS[k].map((h) => pack(h));
const WHITE = pack('#ffffff');

// Key light: top-left, above.
const LX = -0.5, LY = -0.62, LZ = 0.6;
const LN = hyp3(LX, LY, LZ);
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
  M.rust = mat(r.rust, { amb: 0.1, dif: 0.95 });
  M.gmetal = mat(['#0c0a0c', '#1c1719', '#2e2729', '#463b3b', '#655450', '#8c7466', '#b89a82'], { amb: 0.1, dif: 0.95, spec: 0.94 });
  M.crysT = mat(['#051a1c', r.crystal[0], r.crystal[1], r.crystal[2], r.crystal[3], r.crystal[4], r.crystal[5]], { amb: 0.1, dif: 0.95, spec: 0.93, noSpill: true });
  // dark crystal for the Prism's orbiting blades: facets swing from near-black to bright teal
  M.crysTD = mat(['#020c0c', '#041617', r.crystal[0], r.crystal[1], r.crystal[2], r.crystal[3]], { amb: 0.05, dif: 1.05, spec: 0.95, noSpill: true });
  M.crysV = mat(['#12061f', r.plasma[0], r.plasma[1], r.plasma[2], r.plasma[3], r.plasma[4], r.plasma[5]], { amb: 0.1, dif: 0.95, spec: 0.93, noSpill: true });
  M.void = mat([r.void[0], r.void[1], r.void[2], r.void[3], r.void[4], r.void[5]], { amb: 0.1, dif: 0.9, spec: 0.96 });
  M.abyss = mat(['#000000', '#05040c', '#0a0818'], { amb: 0, dif: 0.3, rim: 0, noSpill: true });
  M.obs = mat(['#07050a', r.carapace[0], r.carapace[1], r.carapace[2], r.carapace[3], r.carapace[4], r.carapace[6]], { amb: 0.1, dif: 0.95, spec: 0.92 });
  M.bone = mat([r.plasma[0], r.carapace[3], r.carapace[5], r.carapace[6], '#c7a9c9', '#f1e2f0'], { amb: 0.15, dif: 0.9, spec: 0.93, dither: 0.6 });
  // Wyrm: near-black obsidian basalt (void/carapace darks) so the serpent stays a dark shape
  // against the red giant, and a cool dark iron that never matches the ember background
  // Dread: dark warm plating + rust belts with a strong top-left rim, so the dreadnought stands
  // off the grey-green RAMPS.hull ground of the Wreck sector
  M.dreadHull = mat(['#050406', '#0c0a0c', '#151112', '#201a1a', '#2d2524', '#3e3331', '#54463f'], { amb: 0.12, dif: 0.95, rim: 1.2 });
  M.rustB = mat(r.rust, { amb: 0.12, dif: 0.95, rim: 1.6 });
  // Heart petals: true obsidian (carapace darks only) so bright pink stays reserved for the iris
  // and the enemy bullets
  M.obsD = mat(['#040306', r.carapace[0], r.carapace[1], r.carapace[2], r.carapace[3], r.carapace[4]], { amb: 0.08, dif: 1, spec: 0.93 });
  M.basalt = mat(['#05040c', '#0d0912', '#181020', '#261930', '#382a3e', '#4e3f55', '#6a5a70'], { amb: 0.1, dif: 0.95, dither: 0.6, spec: 0.97 });
  M.iron = mat(['#060509', '#100e16', '#1b1824', '#2a2636', '#3d384d', '#575068', '#7c7594'], { amb: 0.1, dif: 0.95, spec: 0.94 });
  M.ready = true;
}

// ---------------------------------------------------------------------------------------
// G-buffer rasterizer
// ---------------------------------------------------------------------------------------

const NO = {};
// scratch buffers for polygon scan conversion (max 256 vertices)
const XS = new Float64Array(256), WXB = new Float64Array(256), WYB = new Float64Array(256);
const PX = new Float64Array(256), PY = new Float64Array(256), PE = new Float64Array(256 * 11);

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
    this.hot = new Uint8Array(n); // 1 = deliberate hot point: light layer at full intensity
    this.ox = w / 2; this.oy = h / 2;
    this.reset(0);
  }
  reset(angle = 0) {
    this.m.fill(0); this.t.fill(0); this.e.fill(0); this.z.fill(0); this.p.fill(0); this.sp.fill(0); this.hot.fill(0);
    this.pid = 1;
    this.stack = [];
    this.T = [1, 0, 0, 1, 0, 0, 1]; // 2x2 linear part, translation, uniform scale
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
  // uniform scale of the local frame (normals are renormalized when shading)
  scale(k) { const T = this.T; T[0] *= k; T[1] *= k; T[2] *= k; T[3] *= k; T[6] *= k; this._inv(); return this; }
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
      if (S.n) { const ik = 1 / T[6]; this.nx[i] = (T[0] * nu + T[2] * nv) * ik; this.ny[i] = (T[1] * nu + T[3] * nv) * ik; this.nz[i] = nz; }
      if (S.em !== undefined) { this.e[i] = S.em; this.sp[i] = S.sp || 0; this.hot[i] = S.hot ? 1 : 0; }
      if (S.dz) this.z[i] += S.dz;
      return;
    }
    this.m[i] = S.m;
    const ik = 1 / T[6];
    this.nx[i] = (T[0] * nu + T[2] * nv) * ik; this.ny[i] = (T[1] * nu + T[3] * nv) * ik; this.nz[i] = nz;
    this.z[i] = z;
    this.t[i] = S.t || 0;
    this.p[i] = pid;
    this.e[i] = S.em || 0;
    this.sp[i] = S.sp || 0;
    this.hot[i] = S.hot ? 1 : 0;
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
      const du = u - cu, dv = v - cv, rr = hyp(du, dv);
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
    const pid = this._pid(S), z0 = S.z || 0, fn = S.n, pil = S.pil || 0;
    const facet = S.facet || 0, table = S.table ?? 1e9, bev = facet ? 1e9 : S.bev || 0, bk = S.bk ?? 1.1;
    const n = pts.length;
    let u0 = 1e9, v0 = 1e9, u1 = -1e9, v1 = -1e9;
    if (n > 256) throw new Error('poly: too many vertices');
    const X = PX, Y = PY;
    for (let k = 0; k < n; k++) {
      const u = pts[k][0], v = pts[k][1]; X[k] = u; Y[k] = v;
      if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2, iw = 2 / Math.max(1, u1 - u0), ih = 2 / Math.max(1, v1 - v0);
    // edges with outward normals: [ax, ay, ex, ey, 1/len2, nx, ny, bbox u0, v0, u1, v1 (grown by reach)]
    const reach = facet ? 1e9 : bev + 0.5;
    const E = PE, EL = n * 11;
    for (let k = 0; k < n; k++) {
      const ax = X[k], ay = Y[k], bx = X[(k + 1) % n], by = Y[(k + 1) % n];
      const ex = bx - ax, ey = by - ay, len = hyp(ex, ey) || 1e-6;
      let nx = ey / len, ny = -ex / len;
      if (inPolyF(X, Y, n, (ax + bx) / 2 + nx * 0.01, (ay + by) / 2 + ny * 0.01)) { nx = -nx; ny = -ny; }
      const o = k * 11;
      E[o] = ax; E[o + 1] = ay; E[o + 2] = ex; E[o + 3] = ey; E[o + 4] = 1 / (len * len); E[o + 5] = nx; E[o + 6] = ny;
      E[o + 7] = Math.min(ax, bx) - reach; E[o + 8] = Math.min(ay, by) - reach; E[o + 9] = Math.max(ax, bx) + reach; E[o + 10] = Math.max(ay, by) + reach;
    }
    const pix = (i, u, v) => {
      if (fn) { this.put(i, S, fn[0], fn[1], fn[2], z0, pid); return; }
      let pu = 0, pv = 0;
      if (pil) { pu = (u - cu) * iw * pil; pv = (v - cv) * ih * pil; }
      if (!bev) { this.put(i, S, pu, pv, 1, z0, pid); return; }
      let best = 1e9, bnx = 0, bny = 0;
      for (let o = 0; o < EL; o += 11) {
        if (u < E[o + 7] || u > E[o + 9] || v < E[o + 8] || v > E[o + 10]) continue;
        let t = ((u - E[o]) * E[o + 2] + (v - E[o + 1]) * E[o + 3]) * E[o + 4];
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = u - E[o] - E[o + 2] * t, dy = v - E[o + 1] - E[o + 3] * t;
        const d = dx * dx + dy * dy;
        if (d < best) { best = d; bnx = E[o + 5]; bny = E[o + 6]; }
      }
      if (best === 1e9) { this.put(i, S, pu, pv, 1, z0, pid); return; }
      best = Math.sqrt(best);
      if (facet) {
        // faceted roof: flat planes sloping down to every edge, flat table on top
        if (best * facet >= table) { this.put(i, S, pu, pv, 1, z0 + table, pid); return; }
        this.put(i, S, bnx * facet + pu, bny * facet + pv, 1, z0 + best * facet, pid);
        return;
      }
      if (best >= bev) { this.put(i, S, pu, pv, 1, z0, pid); return; }
      const k = (1 - best / bev) * bk;
      this.put(i, S, bnx * k + pu, bny * k + pv, 1, z0 - (1 - best / bev) * bev * 0.4, pid);
    };
    // scanline fill in world space (the transform is affine, so inside-ness is preserved)
    const T = this.T, I = this.I, W = this.w, ex0 = this.ox + T[4], ey0 = this.oy + T[5];
    let wy0 = 1e9, wy1 = -1e9;
    for (let k = 0; k < n; k++) {
      const wx = ex0 + T[0] * X[k] + T[2] * Y[k], wy = ey0 + T[1] * X[k] + T[3] * Y[k];
      WXB[k] = wx; WYB[k] = wy;
      if (wy < wy0) wy0 = wy; if (wy > wy1) wy1 = wy;
    }
    const ys = Math.max(0, Math.floor(wy0)), ye = Math.min(this.h - 1, Math.ceil(wy1));
    for (let y = ys; y <= ye; y++) {
      const yc = y + 0.5;
      let c = 0;
      for (let k = 0, j = n - 1; k < n; j = k++) {
        const ya = WYB[k], yb = WYB[j];
        if ((ya > yc) !== (yb > yc)) {
          const x = WXB[k] + ((yc - ya) * (WXB[j] - WXB[k])) / (yb - ya);
          let q = c++;
          while (q > 0 && XS[q - 1] > x) { XS[q] = XS[q - 1]; q--; }
          XS[q] = x;
        }
      }
      const dy = yc - ey0;
      for (let q = 0; q + 1 < c; q += 2) {
        // symmetric span rule: a pixel center lying exactly on the left OR right edge is in,
        // so mirror()ed polygons on odd-width sprites rasterize exactly symmetric
        const xa = Math.max(0, Math.ceil(XS[q] - 0.5 - 1e-7)), xb = Math.min(W - 1, Math.floor(XS[q + 1] - 0.5 + 1e-7));
        for (let x = xa; x <= xb; x++) {
          const dx = x + 0.5 - ex0;
          pix(y * W + x, I[0] * dx + I[2] * dy, I[1] * dx + I[3] * dy);
        }
      }
    }
    return this;
  }
  rect(u, v, w, h, S) { return this.poly([[u, v], [u + w, v], [u + w, v + h], [u, v + h]], S); }

  // Generic per-pixel shape. fn(u, v, o) -> truthy to write; may set o.nu,o.nv,o.nz,o.z,o.m,o.t,o.em
  // (+ o.hot, o.sp per pixel)
  fill(u0, v0, u1, v1, S, fn) {
    const pid = this._pid(S), o = {};
    const decalOnly = S.decal || S.clip;
    this.scan(u0, v0, u1, v1, (i, u, v, x, y) => {
      if (decalOnly && !this.m[i]) return;
      o.nu = 0; o.nv = 0; o.nz = 1; o.z = S.z || 0; o.m = S.m; o.t = S.t || 0; o.em = S.em || 0; o.hot = S.hot; o.sp = undefined; o.x = x; o.y = y; o.i = i;
      if (!fn(u, v, o)) return;
      if (S.decal) {
        if (!this.m[i]) return;
        if (o.m) this.m[i] = o.m;
        if (o.dt) this.t[i] = clamp(this.t[i] + o.dt, -8, 8);
        if (o.em) { this.e[i] = o.em; this.sp[i] = o.sp ?? S.sp ?? 0; this.hot[i] = o.hot ? 1 : 0; }
        o.dt = 0;
        return;
      }
      if (S.clip && !this.m[i]) return;
      const T = this.T;
      this.m[i] = o.m;
      const ik = 1 / T[6];
      this.nx[i] = (T[0] * o.nu + T[2] * o.nv) * ik; this.ny[i] = (T[1] * o.nu + T[3] * o.nv) * ik; this.nz[i] = o.nz;
      this.z[i] = o.z; this.t[i] = o.t; this.p[i] = o.pid || pid; this.e[i] = o.em; this.sp[i] = o.em ? o.sp ?? S.sp ?? 0 : 0; this.hot[i] = o.em && o.hot ? 1 : 0;
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
    const { w, h, m, nx, ny, nz, z, t, p, e, sp, hot } = this;
    const n = w * h;
    // output buffers are reused between frames: putImageData copies them into the canvas
    if (!this._col) {
      this._col = new Uint32Array(n); this._emi = new Uint32Array(n);
      this.imgCol = new ImageData(new Uint8ClampedArray(this._col.buffer), w, h);
      this.imgEmi = new ImageData(new Uint8ClampedArray(this._emi.buffer), w, h);
    }
    const col = this._col, emi = this._emi;
    col.fill(0); emi.fill(0);
    const edge = this._edge || (this._edge = new Uint8Array(n));
    edge.fill(0);
    const shadowReach = opt.shadowReach ?? 2, ao = opt.ao !== false, emiK = opt.emiK ?? EMI_K;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, mi = m[i];
      if (!mi) continue;
      if (e[i]) {
        // The color layer keeps the full glow color; the light layer (added on top of it AND
        // bloomed by post) gets a dimmed copy, so glowing areas read as lit color instead of
        // clipping to white/lavender. White and deliberate hot points stay at full strength.
        const c = e[i];
        col[i] = c;
        emi[i] = hot[i] || c === WHITE || lum32(c) >= EMI_HOT_LUM ? c : scale32(c, emiK);
        continue;
      }
      const Mt = MATS[mi], R = Mt.ramp, N = R.length;
      let ax = nx[i], ay = ny[i], az = nz[i];
      const nl = Math.sqrt(ax * ax + ay * ay + az * az) || 1; ax /= nl; ay /= nl; az /= nl;
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
      // ambient occlusion: crevices hemmed in by taller geometry on both sides go darker
      if (ao && x > 1 && y > 1 && x < w - 2 && y < h - 2) {
        const zr = zi + 1.6, w2 = w + w;
        const occ = (m[i - 2] && z[i - 2] > zr ? 1 : 0) + (m[i + 2] && z[i + 2] > zr ? 1 : 0) +
          (m[i - w2] && z[i - w2] > zr ? 1 : 0) + (m[i + w2] && z[i + w2] > zr ? 1 : 0);
        if (occ >= 2) I -= 0.07 * occ;
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

// ---------------------------------------------------------------------------------------
// Sprite building
// ---------------------------------------------------------------------------------------

function toCanvas(w, h, img) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  if (img) cv.getContext('2d').putImageData(img, 0, 0);
  return cv;
}

// Mirror a G-buffer left<->right into dst (normals' x flipped) — used to derive the
// directions of bilaterally symmetric rotated sprites from their mirror-image directions.
function mirrorGB(src, dst) {
  const { w, h } = src;
  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) {
      const i = r + x, j = r + (w - 1 - x);
      dst.m[j] = src.m[i]; dst.nx[j] = -src.nx[i]; dst.ny[j] = src.ny[i]; dst.nz[j] = src.nz[i];
      dst.z[j] = src.z[i]; dst.t[j] = src.t[i]; dst.p[j] = src.p[i]; dst.e[j] = src.e[i]; dst.sp[j] = src.sp[i]; dst.hot[j] = src.hot[i];
    }
  }
}

// copy every G-buffer channel of src into dst (same size); onlyFilled = composite src over dst
function copyGB(src, dst, onlyFilled) {
  if (!onlyFilled) {
    dst.m.set(src.m); dst.nx.set(src.nx); dst.ny.set(src.ny); dst.nz.set(src.nz); dst.z.set(src.z);
    dst.t.set(src.t); dst.p.set(src.p); dst.e.set(src.e); dst.sp.set(src.sp); dst.hot.set(src.hot);
    dst.pid = Math.max(dst.pid, src.pid);
    return;
  }
  const sm = src.m, snx = src.nx, sny = src.ny, snz = src.nz, sz = src.z, st = src.t, spp = src.p, se = src.e, ssp = src.sp, sh = src.hot;
  const dm = dst.m, dnx = dst.nx, dny = dst.ny, dnz = dst.nz, dz = dst.z, dt = dst.t, dp = dst.p, de = dst.e, dsp = dst.sp, dh = dst.hot;
  for (let i = 0, n = sm.length; i < n; i++) {
    if (!sm[i]) continue;
    dm[i] = sm[i]; dnx[i] = snx[i]; dny[i] = sny[i]; dnz[i] = snz[i]; dz[i] = sz[i]; dt[i] = st[i]; dp[i] = spp[i]; de[i] = se[i]; dsp[i] = ssp[i]; dh[i] = sh[i];
  }
}

// Build a registerSprite def. draw(g, frame, dirIndex, angle) paints the G-buffer.
//  sym:  the art is left/right symmetric (odd width) -> directions past 180 deg are mirrored
//        G-buffers of their counterparts (then shaded normally, so lighting stays top-left).
//  fx:   draw() is frame-independent geometry, painted once; fx(g, frame) adds the per-frame
//        lights on a copy of it (big hulls whose frames only differ in running lights).
//  over: over(g, dirIndex, angle) paints frame-independent layers once per direction; they
//        are composited over each frame's draw() (e.g. a head whose jaw alone animates).
//  chunk: yield after this many directions (generator), so long jobs never block the
//        loading bar for long; yields the fraction of the job done.
//  loop: the frames form a seamless loop (dev lint renders frame N and compares it to 0).
// Dev lint (opts.lint = array): reports art touching the frame border without an outline,
// and loops that do not close.
function* build(name, w, h, opts, draw) {
  const { frames = 1, dirs = 1, fps = 8, shade = NO, sym = false, fx = null, over = null, chunk = 8, loop = false, lint = null } = opts;
  const g = new GB(w, h);
  const out = { w, h, frameCount: frames, dirs, fps, frames: new Array(frames * dirs), emissive: new Array(frames * dirs) };
  const useSym = sym && dirs > 1 && (w & 1) && dirs % 2 === 0;
  const mg = useSym ? new GB(w, h) : null;
  const aux = fx || over ? new GB(w, h) : null;
  let anyEm = false, first = null, borderBad = 0;
  const emit = (gb, idx) => {
    const { col, emi } = gb.shade(shade);
    let has = false;
    for (let k = 0; k < emi.length; k++) if (emi[k]) { has = true; break; }
    anyEm = anyEm || has;
    out.frames[idx] = toCanvas(w, h, gb.imgCol);
    out.emissive[idx] = toCanvas(w, h, has ? gb.imgEmi : null);
    if (lint) {
      if (idx === 0) first = col.slice();
      if (borderPixels(col, w, h)) borderBad++;
    }
  };
  if (fx) {
    aux.reset(0);
    draw(aux, 0, 0, 0);
    for (let f = 0; f < frames; f++) {
      g.reset(0); copyGB(aux, g, false);
      fx(g, f);
      emit(g, f);
    }
    if (lint && loop) { g.reset(0); copyGB(aux, g, false); fx(g, frames); checkLoop(g); }
    return finish();
  }
  const last = useSym ? dirs / 2 : dirs - 1;
  for (let d = 0; d <= last; d++) {
    const ang = (d / dirs) * TAU;
    if (over) { aux.reset(ang); aux.pid = 30000; over(aux, d, ang); }
    for (let f = 0; f < frames; f++) {
      g.reset(ang);
      draw(g, f, d, ang);
      if (over) copyGB(aux, g, true);
      emit(g, d * frames + f);
      if (useSym && d > 0 && d < dirs / 2) {
        mirrorGB(g, mg);
        emit(mg, (dirs - d) * frames + f);
      }
    }
    if (d < last && (d + 1) % chunk === 0) yield (d + 1) / (last + 1);
  }
  if (lint && loop) {
    g.reset(0); draw(g, frames, 0, 0);
    if (over) { aux.reset(0); aux.pid = 30000; over(aux, 0, 0); copyGB(aux, g, true); }
    checkLoop(g);
  }
  return finish();
  function checkLoop(gb) {
    const { col } = gb.shade(shade);
    let n = 0;
    for (let i = 0; i < col.length; i++) if (col[i] !== first[i]) n++;
    if (n) lint.push(`${name}: loop does not close (frame ${frames} differs from frame 0 by ${n} px)`);
  }
  function finish() {
    if (lint && borderBad) lint.push(`${name}: ${borderBad}/${out.frames.length} frames have art on the frame border`);
    if (!anyEm) out.emissive = null;
    return out;
  }
}

// count opaque non-outline pixels on the outermost ring of a shaded frame
function borderPixels(col, w, h) {
  let n = 0;
  const bad = (i) => col[i] && col[i] !== OUTLINE;
  for (let x = 0; x < w; x++) { if (bad(x)) n++; if (bad((h - 1) * w + x)) n++; }
  for (let y = 1; y < h - 1; y++) { if (bad(y * w)) n++; if (bad(y * w + w - 1)) n++; }
  return n;
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
  const dx = u2 - u1, dy = v2 - v1, L = hyp(dx, dy) || 1, nx = -dy / L, ny = dx / L;
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
  const coreC = S.core ?? glow('magenta', 0.45);
  items.forEach((it, k) => {
    g.save().tr(u + it.du, v + it.dv).rot(it.a);
    shard(g, it.len, it.hw, { m: S.m || M.crysM, z: z + 1 + k * 1.2, core: it.len > 6 ? coreC : 0, sp: S.sp ?? SP.mag, tip: it.main ? S.tip : 0 });
    g.restore();
  });
}

// Choir crust: glossy organic carapace growth spreading over a surface, with glowing pores.
// (All the small Choir details stay at dim magenta[1..2]: bright magenta specks would read as
// enemy bullets, which must stay the most readable thing on screen.)
function crust(g, u, v, r, seed, S = {}) {
  const z = S.z || 0, f = 0.2;
  g.fill(u - r - 2, v - r - 2, u + r + 2, v + r + 2, { m: S.m || M.crust, z }, (uu, vv, o) => {
    if (S.sym) uu = u - Math.abs(uu - u); // left/right symmetric growth (for sym sprites)
    const du = uu - u, dv = vv - v, d = hyp(du, dv) / r;
    const nn = fbm(uu * f, vv * f, seed, 2);
    const k = d + (nn - 0.5) * 0.8;
    if (k > 1) return false;
    const e = 0.5;
    const gx = fbm((uu + e) * f, vv * f, seed, 2) - nn, gy = fbm(uu * f, (vv + e) * f, seed, 2) - nn;
    o.nu = -gx * 6 + (du / r) * 0.9; o.nv = -gy * 6 + (dv / r) * 0.9; o.nz = 1;
    o.z = z + (1 - k) * 2.5;
    const pore = hash2(Math.floor(uu), Math.floor(vv), seed + 5);
    if (pore > 0.93 && k < 0.75) o.em = glow(S.pore || 'magenta', 0.4);
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
    if (R() < 0.6) g.px(end[0], end[1], { em: glow('magenta', 0.4) });
  }
}

// Faceted gem mesh: verts [[u, v, h]...] (h = height toward the viewer), tris [[a, b, c]...].
// Each triangle is a flat facet whose normal comes from its 3D plane.
function gemMesh(g, verts, tris, S) {
  const pid = S.pid || g.pid++;
  for (const [a, b, c] of tris) {
    const A = verts[a], B = verts[b], Cc = verts[c];
    const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [Cc[0] - A[0], Cc[1] - A[1], Cc[2] - A[2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const zc = (S.z || 0) + (A[2] + B[2] + Cc[2]) / 3;
    g.poly([[A[0], A[1]], [B[0], B[1]], [Cc[0], Cc[1]]], { ...S, pid, z: zc, n: [nx, ny, nz * (S.flat ?? 1)] });
  }
}

// Mirror a half mesh (u <= 0) into a full symmetric mesh. Vertices on u = 0 are shared.
function mirrorMesh(verts, tris) {
  const V = verts.slice(), map = [];
  verts.forEach((p, i) => { if (p[0] === 0) map[i] = i; else { map[i] = V.length; V.push([-p[0], p[1], p[2]]); } });
  const T = tris.slice();
  for (const [a, b, c] of tris) T.push([map[a], map[c], map[b]]);
  return [V, T];
}

// Circuit veins: the infection creeping along panel lines — axis-aligned tendrils with
// right-angle turns, glowing near the source, darkening to magenta scars, bright end nodes.
function circuit(g, u, v, n, len, seed, S = {}) {
  const R = rng(seed);
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  for (let k = 0; k < n; k++) {
    let d = S.dir !== undefined ? (S.dir + (R() < 0.5 ? 0 : R() < 0.5 ? 1 : 3)) & 3 : (R() * 4) | 0;
    let x = Math.round(u), y = Math.round(v), walked = 0;
    const L = len * (0.5 + R() * 0.7);
    while (walked < L) {
      const step = 2 + ((R() * 4) | 0);
      const nx = x + dirs[d][0] * step, ny = y + dirs[d][1] * step;
      const near = walked < L * 0.4;
      g.line(x, y, nx, ny, near ? { em: glow('magenta', S.bright ?? 0.45), sp: SP.mag } : { m: M.crysM, t: -3 });
      x = nx; y = ny; walked += step;
      if (R() < 0.55) d = (d + (R() < 0.5 ? 1 : 3)) & 3;
      if (R() < 0.15) g.px(x, y, { em: glow('magenta', 0.4) });
    }
    g.px(x, y, { em: glow('magenta', 0.4), sp: SP.mag });
  }
}

// Rows of tiny hull windows: most lit warm amber, some dark, some possessed magenta.
function windows(g, u1, v1, u2, v2, step, seed, S = {}) {
  const R = rng(seed);
  const L = hyp(u2 - u1, v2 - v1), n = Math.max(1, Math.round(L / step));
  for (let k = 0; k <= n; k++) {
    const u = lerp(u1, u2, k / n), v = lerp(v1, v2, k / n), r = R();
    if (r < (S.dark ?? 0.25)) g.px(u, v, { m: M.dark, t: 0 });
    else if (r < (S.dark ?? 0.25) + (S.possessed ?? 0.1)) g.px(u, v, { em: glow('magenta', 0.4), sp: SP.mag });
    else g.px(u, v, { em: glow('gold', r > 0.9 ? 0.9 : 0.65) });
  }
}

// Row of rivets along a local line
function rivets(g, u1, v1, u2, v2, step, S = {}) {
  const L = hyp(u2 - u1, v2 - v1), n = Math.max(1, Math.round(L / step));
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
  // boss_warden_arm_r: the right arm pre-mirrored with its lighting kept top-left. Draw it
  // WITHOUT flipX at hull + armR - [-armPivot[0], armPivot[1]] (flipX of the left arm also works).
  armRSprite: 'boss_warden_arm_r',
  armCapsule: { from: [0, -20], to: [0, 26], r: 6 }, // arm collision (arm-sprite coords; mirror x for the right)
  turrets: [[-24, -22], [24, -22], [-31, 21], [31, 21]],
  turretMuzzle: 6.5,                  // barrel tips: turret center + turretMuzzle * (sin a, -cos a)
  core: [0, 8],                       // core sprite center (hangs in the bay)
  coreR: 9,
  // armored bay doors over the core: draw boss_warden_hatch over the core sprite at the core
  // position with frame = round(open * 4) (0 = shut .. 4 = fully retracted, only the rails)
  hatch: { sprite: 'boss_warden_hatch', frames: 5 },
  bay: [0, 24],                       // drone launch point (open bay)
  hullRadius: 46,
  // collision rects [x, y, w, h] relative to the hull center (the bay stays open)
  rects: [[-44, -39, 88, 34], [-41, -5, 19, 42], [22, -5, 19, 42], [-63, -32, 20, 26], [43, -32, 20, 26], [-14, -5, 28, 27]],
};

// Rear thruster bell: steel nozzle rim, dark throat, violet exhaust glowing white-hot at the
// center (the ship faces down, so its engines point up / backward).
function thruster(g, u, v, I) {
  g.ell(u, v, 6.2, 3.1, { m: M.steel, z: 10, h: 1.4 });
  g.ell(u, v - 0.3, 5, 2.3, { m: M.dark, z: 9.8 });
  g.ell(u, v - 0.3, 4.2, 1.9, {
    m: M.dark, z: 9.8, sp: SP.violetS,
    em2: (r2) => glow('plasma', clamp(0.45 + (1 - r2) * 0.5 * I + 0.1 * I, 0, 1)),
  });
  // 3x2 white-hot core
  g.rect(u - 1.5, v - 1.3, 3, 2, { decal: true, em: I > 0.9 ? WHITE : glow('plasma', 1), hot: true });
}

function wardenHull(g, f) {
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
    // bay-side rail with floodlights facing the core (per-frame lights in wardenLights)
    g.rect(-24, -4, 2, 32, { m: M.dark, z: 5 });
    // outer pipe run
    g.cyl(-41.5, -8, -41.5, 27, 1.1, { m: M.steel, z: 5 });
    hazard(g, -40, 27, 17, 12, { dir: s });
    g.circ(-31, 21, 6, { m: M.hullD, z: 6.5, h: 0.8 });
    g.ring(-31, 21, 4.8, 6, { m: M.armor, z: 6.8, flat: true });
  });
  text(g, '07', -35, 7, { m: M.gold, t: 0 });

  // ---- engine nacelles breaking the top silhouette, ending in big thruster bells
  g.sym(() => {
    g.fill(-26, -40, -10, -17, { m: M.armor, z: 6.5 }, (u, v, o) => {
      const a = (u + 18) / 7.5;
      if (Math.abs(a) > 1) return false;
      const top = -37 + 1.5 * (1 - Math.sqrt(1 - a * a));
      if (v < top || v > -18) return false;
      o.nu = a * 0.95; o.nv = 0; o.nz = Math.sqrt(1 - a * a * 0.85);
      o.z = 6.5 + 3 * Math.sqrt(1 - a * a);
      return true;
    });
    for (const v of [-29, -24]) seam(g, -25, v, -11, v);
    rivets(g, -23, -27, -13, -27, 3);
    // plasma conduit down the nacelle's outer flank
    g.line(-24.5, -32, -24.5, -21, { em: glow('plasma', 0.4), sp: SP.violet });
    g.rect(-21, -33.5, 6, 2.5, { m: M.steel, z: 9.6, bev: 0.8 });
  });

  // ---- bridge superstructure with a chevron canopy pointing at the bow
  g.poly(mirror([[0, -34], [-9, -34], [-12, -29], [-12, -19], [-8, -15], [0, -13]]), { m: M.steel, z: 7.5, bev: 1.5, bk: 1.3 });
  g.poly(mirror([[0, -32], [-6, -32], [-8, -28], [-8, -23], [0, -21]]), { m: M.steel, z: 9.5, bev: 1.2, bk: 1.3 });
  g.poly(mirror([[0, -17.5], [-8.5, -21.5], [-8.5, -19.5], [0, -15]]), { m: M.dark, z: 9, n: [0, 0.2, 1] });
  g.circ(0, -27, 2.6, { m: M.steel, z: 11.5, h: 2 });
  g.cyl(5, -29, 9, -35, 0.6, { m: M.steel, z: 11 });

  // ---- core cradle in the bay
  g.rect(-6, -7, 12, 6, { m: M.armor, z: 5, bev: 1 });
  seam(g, -2, -6, -2, -2); seam(g, 2, -6, 2, -2);
  g.circ(0, 8, 12, { m: M.dark, z: 3 });
  g.fill(-12, -4, 12, 20, { decal: true }, (u, v, o) => {
    const d = hyp(u, v - 8);
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
  g.sym(() => g.cyl(-13, 3, -22, -1, 1.7, { m: M.hullD, z: 4.5 }));

  // ---- gantry truss across the bay mouth (decorative)
  g.cyl(-22, 29, 22, 29, 0.8, { m: M.steel, z: 3 });
  g.cyl(-22, 32.5, 22, 32.5, 0.8, { m: M.steel, z: 3 });
  for (let u = -22; u < 22; u += 5.5) g.cyl(u, 29, u + 5.5, 32.5, 0.55, { m: M.hull, z: 2.5 });
  g.rect(-9, 27, 7, 7, { m: M.gold, z: 4, bev: 1 });
  g.rect(-8, 29, 5, 3, { m: M.dark, z: 4.2 });

  for (const u of [-11, -7, 7, 11]) g.px(u, -6, { em: glow('gold', 0.75), sp: SP.amber });

  // ---- scorched plating (old battle damage), port side
  g.fill(-44, -34, -18, -8, { decal: true }, (u, v, o) => {
    const n = fbm(u * 0.25, v * 0.25, 91) - hyp(u + 33, v + 25) * 0.04;
    if (n < 0.3) return false;
    o.dt = n > 0.45 ? -2 : -1;
    if (n > 0.52) o.m = M.rust;
    return true;
  });

  // ---- tiny hull windows (scale cues)
  g.sym(() => {
    windows(g, -39, -15, -30, -15, 2, 61, { possessed: 0 });
    windows(g, -37, 16, -37, 26, 2, 62, { possessed: 0 });
  });
  windows(g, -28, -12.5, -14, -12.5, 2, 63, { possessed: 0.05 });
  windows(g, 14, -12.5, 28, -12.5, 2, 64, { possessed: 0.5 });

  // ---- Choir infection (starboard engine block, one pylon foot, the cradle)
  crust(g, 37, -24, 9, 11, { z: 6 });
  circuit(g, 32, -18, 5, 26, 12);
  veins(g, 35, -20, 3.9, 3, 9, 13);
  crystalCluster(g, 34, -22, 0.35, 3, 11, 75, { z: 8, spread: 0.5 });
  crystalCluster(g, 41, -25, 1.0, 5, 19, 71, { z: 10, spread: 0.38, fat: 0.2, core: glow('magenta', 0.6) });
  crust(g, -33, 29, 6, 21, { z: 6 });
  circuit(g, -32, 24, 3, 18, 22, { dir: 3 });
  crystalCluster(g, -35, 31, -2.45, 3, 9, 72, { z: 7 });
  crust(g, 9, -3, 4, 31, { z: 6 });
  crystalCluster(g, 10, -4, 0.5, 3, 7, 73, { z: 7 });
  circuit(g, 7, -4, 2, 12, 32, { dir: 2 });
}

// Per-frame lights (applied over the static hull): engines, running lights, strobes,
// bridge canopy, floodlights.
function wardenLights(g, f) {
  const on = (f & 1) === 0;
  thruster(g, -18, -36.5, on ? 1 : 0.8);
  thruster(g, 18, -36.5, on ? 0.8 : 1);
  g.sym(() => {
    for (let v = -2; v <= 26; v += 4) g.px(-23, v, { em: glow('cyan', on === (v % 8 === 2) ? 0.7 : 0.45), sp: SP.cyan });
    g.px(-17, 1, { em: glow('magenta', on ? 0.4 : 0.3), sp: SP.mag });
  });
  // chevron canopy: amber cabin lights, one flickering
  for (const [u, v] of [[-7, -20], [-4, -18.5], [4, -18.5], [7, -20]]) g.px(u, v, { em: glow('gold', u === 4 && !on ? 0.35 : 0.7), sp: SP.amber });
  g.px(0, -16.5, { em: glow('cyan', 0.8), sp: SP.cyan });
  g.px(9, -35.5, { em: on ? pack('#ff5a5a') : pack('#5a1018'), hot: on });
  g.px(-6, 30, { em: on ? glow('gold', 0.8) : glow('gold', 0.4) });
  // nav lights: starboard green (screen-left), port red (screen-right) — the ship faces down
  g.circ(-62.5, -19, 1.1, { m: M.dark, z: 4, em: on ? glow('lime', 0.8) : glow('lime', 0.4), hot: on });
  g.circ(62.5, -19, 1.1, { m: M.dark, z: 4, em: on ? pack('#ff5a5a') : pack('#7a1420'), hot: on });
  g.px(-32, 36, { em: on ? WHITE : glow('steel', 0.3) });
  g.px(32, 36, { em: on ? glow('steel', 0.3) : WHITE });
}

// Crane arm (left arm; the right one is the same geometry rasterized mirrored)
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
  hazard(g, -6, 12, 12, 2.5, { dir: -1 });
  seam(g, -7, 8, 3, 7);
  g.px(-3, 11, { em: glow('gold', 0.8), sp: SP.amber });
  g.px(1, 11, { em: glow('gold', 0.8), sp: SP.amber });
  // elbow: clevis hinge — cheek plates on both sides of the joint, through pin, lug
  g.save().tr(-4, 2).rot(-0.2);
  g.rect(-3, -2.2, 6, 4.4, { m: M.gun, z: 6.8, bev: 0.8 });
  g.sym(() => {
    g.rect(-6.8, -3.2, 2.6, 6.4, { m: M.gun, z: 7.6, bev: 0.9, bk: 1.3 });
    g.circ(-5.5, 0, 1.3, { m: M.steel, z: 8.6, h: 0.8 });
  });
  g.restore();
  // shoulder: toothed turntable gear with a hex hub
  g.circ(0, -20, 7.4, { m: M.gun, z: 8.5, h: 1.2 });
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU;
    g.save().tr(0, -20).rot(a);
    g.rect(-0.9, -7.9, 1.8, 1.6, { m: M.steel, z: 9.2 });
    g.restore();
  }
  g.circ(0, -20, 5.4, { m: M.steel, z: 9.5, h: 1.8 });
  g.poly([0, 1, 2, 3, 4, 5].map((k) => { const a = (k / 6) * TAU; return [Math.sin(a) * 2.8, -20 - Math.cos(a) * 2.8]; }), { m: M.hullD, z: 11, bev: 0.9, bk: 1.3 });
  // wrist + claw
  g.circ(0, 16, 4.4, { m: M.hullD, z: 6, h: 1.5 });
  g.poly([[-6, 17], [6, 17], [9.5, 21], [-9.5, 21]], { m: M.steel, z: 6.5, bev: 1.2, bk: 1.3 });
  const tal = (pts, rs) => {
    for (let k = 0; k + 1 < pts.length; k++) g.cyl(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], rs[k], { m: k === pts.length - 2 ? M.car : M.gun, z: 7 - k * 0.5 });
  };
  tal([[-7, 20], [-11, 23], [-10, 26], [-6.5, 27.3]], [2, 1.6, 1.1]);
  tal([[7, 20], [11, 23], [10, 26], [6.5, 27.3]], [2, 1.6, 1.1]);
  tal([[0, 21], [0, 24.5], [0, 27]], [1.8, 1.2]);
  // infection creeping down the upper arm's outer edge
  crust(g, -6.5, -9, 2.4, 83, { z: 7 });
  crystalCluster(g, -7.5, -9, -1.75, 2, 6, 81, { z: 9 });
  veins(g, -6, -7, 3.3, 2, 7, 82, { spread: 0.4 });
}

function wardenTurret(g) {
  // twin-gun deck turret, pointing up at dir 0. It sits on the hull's own pad ring, so the
  // sprite is just a compact housing with long light barrels running out past it: the aim
  // reads at 1x. Dark bore pixel at each muzzle.
  g.sym(() => {
    g.cyl(-1.5, 0, -1.5, -6.3, 0.95, { m: M.steel, z: 6, cap: 'flat' });
    g.px(-1.5, -6, { decal: true, t: -9 }); // bore
  });
  g.poly(mirror([[0, -2.6], [-2.6, -2.6], [-4.3, -1], [-4.3, 2.2], [-2.6, 4.3], [0, 4.3]]), { m: M.gun, z: 5, bev: 1.3, bk: 1.4 });
  g.rect(-3, -3.6, 6, 1.6, { m: M.armor, z: 5.6, bev: 0.5 });  // mantlet
  g.line(-2, 1.5, 2, 1.5, { dt: -2 });
}

function wardenCore(g, f) {
  const I = [0.3, 0.6, 1, 0.65][f & 3];
  const oct = mirror([[0, -8], [-6, -8], [-10, -4], [-10, 4], [-6, 8], [0, 8]]);
  g.poly(oct, { m: M.steel, z: 2, bev: 2, bk: 1.3 });
  g.poly(mirror([[0, -6], [-5, -6], [-8, -3], [-8, 3], [-5, 6], [0, 6]]), { m: M.dark, z: 1 });
  const em = (t) => glow('magenta', clamp(t * I + (1 - I) * 0.1, 0, 1));
  const cz = 2.5;
  g.poly([[0, -5], [4, 0], [0, 0]], { m: M.crysM, z: cz, em: em(0.75), sp: SP.mag });
  g.poly([[0, -5], [-4, 0], [0, 0]], { m: M.crysM, z: cz, em: em(0.95), sp: SP.mag });
  g.poly([[-4, 0], [0, 5], [0, 0]], { m: M.crysM, z: cz, em: em(0.65), sp: SP.mag });
  g.poly([[4, 0], [0, 5], [0, 0]], { m: M.crysM, z: cz, em: em(0.5), sp: SP.mag });
  g.px(-1, -2, { em: I > 0.9 ? WHITE : glow('magenta', 0.95), hot: true });
  if (I > 0.5) g.px(0, -1, { em: glow('magenta', 1) });
  g.sym(() => { g.poly([[-9, -2], [-5, -1], [-5, 1], [-9, 2]], { m: M.hull, z: 3.5, bev: 0.8 }); });
  g.rect(-1, -8, 2, 2.5, { m: M.hull, z: 3.5 });
  g.rect(-1, 5.5, 2, 2.5, { m: M.hull, z: 3.5 });
  for (const [u, v] of [[-6, -7], [6, -7], [-6, 7], [6, 7]]) g.px(u, v, { dt: 2 });
}

// Bay doors over the core. f: 0 shut .. 4 open — two armored leaves retract sideways into
// the cradle; the guide rails stay. Shut, the core's magenta light leaks through the seam.
function wardenHatch(g, f) {
  const open = (f % 5) / 4, HW = 11.5, w = HW * (1 - open);
  g.sym((s) => {
    if (w > 0.6) {
      g.rect(-HW, -7.4, w, 14.8, { m: M.armor, z: 3, bev: 1.1, bk: 1.3, pil: 0.3 });
      for (const v of [-3.5, 0, 3.5]) seam(g, -HW + 0.5, v, -HW + w - 0.8, v);
      if (w > 2.5) {
        // hazard chevrons on the meeting edge
        g.fill(-HW + w - 2.2, -6.4, -HW + w - 0.4, 6.4, { decal: true }, (u, v, o) => {
          o.m = (Math.floor(v + 20) >> 1) & 1 ? M.gold : M.dark; o.dt = 0; return true;
        });
      }
      rivets(g, -HW + 1.5, -5.5, -HW + 1.5, 5.5, 3.6);
    }
  });
  if (f === 0) g.line(0, -6.5, 0, 6.5, { em: glow('magenta', 0.55), sp: SP.mag });
  // guide rails
  g.rect(-HW - 0.5, -8.4, 2 * HW + 1, 1.6, { m: M.steel, z: 4, bev: 0.5 });
  g.rect(-HW - 0.5, 6.8, 2 * HW + 1, 1.6, { m: M.steel, z: 4, bev: 0.5 });
}

function wardenJobs() {
  return [
    ['boss_warden', 129, 81, { frames: 2, fps: 3, fx: wardenLights, loop: true }, wardenHull],
    ['boss_warden_arm', 37, 59, {}, wardenArm],
    ['boss_warden_arm_r', 37, 59, {}, (g) => { g.flipX(); wardenArm(g); }],
    ['boss_warden_turret', 15, 15, { dirs: 16, sym: true }, wardenTurret],
    ['boss_warden_core', 23, 19, { frames: 4, fps: 8, loop: true }, wardenCore],
    ['boss_warden_hatch', 27, 19, { frames: 5, fps: 8 }, wardenHatch],
  ];
}

// =======================================================================================
// 2. WYRM — magma serpent of rock and machine (S2 Cinder Belt)
// Basalt plates (Voronoi facets) over an iron skeleton, molten seams glowing between the
// plates. Head and tail are rendered analytically at every baked angle.
// =======================================================================================

const WYRM = {
  segSpacing: 19,      // distance between consecutive body segment centers (px)
  tailSpacing: 15,     // last segment center -> tail center
  segR: 12,            // body segment collision radius
  headR: 15,           // head collision radius
  tailR: 8,
  mouth: [0, -22],     // fire point for dir 0 (head pointing up); rotate by the head angle
  eyes: [[-6, -7], [6, -7]],
  // Body segments come in 3 variants (different plates / cracks / crystal growths) with 16
  // baked dirs each: draw segment k as segVariants[k % 3] with dir = body tangent pointing
  // toward the head, so plates, dorsal crest and crystals follow the curve (without a dir
  // they all face up). Frame 1 = cracked / exposed.
  segVariants: ['boss_wyrm_seg', 'boss_wyrm_seg_b', 'boss_wyrm_seg_c'],
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

// Body segment variant: iron collar, basalt dome split by irregular Voronoi cracks that glow
// near an off-center magma vent, a dorsal crest running back toward the tail (it bridges the
// gap to the next segment so the body reads as one serpent, not beads), Choir crystals.
function wyrmSegment(variant) {
  const seed = [303, 317, 331][variant];
  const vent = [[2, -1.5], [-2.5, 1], [0.5, 2.5]][variant];
  const cryst = [[-1, 5.5], [1, 5], null][variant];
  return (g, f) => {
    const open = (f & 1) === 1;
    // iron collar ring (torus normals: its lower-right half falls into shadow)
    g.ring(0, 0, 9.6, 12.4, { m: M.iron, z: 3 });
    for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU + TAU / 16; g.px(Math.sin(a) * 11, -Math.cos(a) * 11, { dt: 2 }); }
    // basalt dome
    const R = 10.2;
    g.fill(-R, -R, R, R, { m: M.basalt, z: 5, sp: SP.ember }, (u, v, o) => {
      const d = hyp(u, v) / R;
      if (d > 1) return false;
      const w = Math.sqrt(1 - d * d);
      const V = voronoi(u * 0.21 + 11.3, v * 0.21 + 5.7, seed);
      const c = V[1] - V[0], ta = V[2] * TAU;
      o.nu = (u / R) * 1.25 + Math.cos(ta) * 0.3; o.nv = (v / R) * 1.25 + Math.sin(ta) * 0.3; o.nz = w + 0.12;
      o.z = 5 + 5 * w;
      o.t = V[2] > 0.8 ? 1 : V[2] < 0.2 ? -1 : 0;
      const dv = hyp(u - vent[0], v - vent[1]);
      if (dv < (open ? 2.1 : 1.3)) { o.em = glow('ember', open && dv < 1 ? 1 : 0.85); o.hot = open && dv < 1; return true; }
      o.sp = 0; // cracks stay crisp: the bloom provides their glow, spill would flood the dark rock
      const seamW = open ? 0.13 : 0.075;
      if (c < seamW) {
        // cracks: glowing near the vent (all of them once the plates split), dark grooves beyond
        const heat = open ? clamp(1.05 - dv / 14, 0.2, 1) : dv < 6.5 ? 1 - dv / 6.5 : 0;
        if (heat > 0.12) { o.em = glow('ember', 0.3 + heat * 0.55); return true; }
        o.t -= 2;
        return true;
      }
      if (c < seamW * 1.9) o.t -= 1;
      return true;
    });
    // dorsal crest: iron ridge plates along the spine, the last one a spike out over the
    // next segment (toward the tail)
    g.poly(mirror([[0, -4.5], [-1.6, -3.5], [-2, 1.5], [0, 2.5]]), { m: M.iron, z: 11, bev: 0.9, bk: 1.3 });
    g.poly(mirror([[0, 2.5], [-2.2, 3.5], [-1.8, 9.5], [0, 13.4]]), { m: M.iron, z: 10.5, bev: 0.9, bk: 1.3 });
    // Choir growth: magenta crystals bursting between the flank plates
    if (cryst) {
      const [side, size] = cryst;
      crust(g, side * 5, 3, 2.6, seed + 3, { z: 9 });
      crystalCluster(g, side * 5, 3, side * 2.0, 3, size, seed + 5, { z: 11, spread: 0.55, core: glow('magenta', 0.55) });
    }
  };
}

// Head, frame-independent layers (composited over the jaw frames): serpent skull with a
// narrow snout, jaw hinges flaring at the back, back-swept horns, magenta Choir eyes.
const SKULL_HALF = [[0, -22], [-2.6, -21.2], [-4, -18.5], [-4.6, -14.5], [-6.4, -10.5], [-9.4, -6.5], [-11, -2], [-12.2, 3], [-11.6, 7.5], [-9.4, 11], [-6.5, 13.4], [0, 14.5]];
const SKULL = mirror(SKULL_HALF);
const SKX = new Float64Array(SKULL.map((p) => p[0])), SKY = new Float64Array(SKULL.map((p) => p[1]));
function skullHalfWidth(v) {
  for (let k = 1; k < SKULL_HALF.length; k++) {
    const [u0, v0] = SKULL_HALF[k - 1], [u1, v1] = SKULL_HALF[k];
    if (v <= v1) return -lerp(u0, u1, clamp((v - v0) / (v1 - v0 || 1), 0, 1));
  }
  return 6;
}

function wyrmHead(g) {
  // skull: basalt plates over a domed wedge
  g.fill(-13, -22.5, 13, 15, { m: M.basalt, z: 8 }, (u, v, o) => {
    if (!inPolyF(SKX, SKY, SKX.length, u, v)) return false;
    const hw = Math.max(2.5, skullHalfWidth(v));
    const a = clamp(u / hw, -0.97, 0.97), b = clamp((v + 4) / 19, -1, 1);
    const w = Math.sqrt(Math.max(0.05, 1 - a * a * 0.85 - b * b * 0.3));
    const heat = basalt(Math.abs(u), v, o, 404, 0.19, 0, 0, 1, 0.07);
    if (u < 0) o.nu = -o.nu;
    o.nu = o.nu * 0.5 + a * 1.3; o.nv = o.nv * 0.5 + b * 0.75; o.nz = w + 0.2;
    o.z = 8 + 5 * w;
    if (heat > 0) o.t -= 2;
    return true;
  });
  // thin molten fissures along the jaw line (no spill: the bloom does the glow)
  g.sym(() => {
    g.polyline([[-7, 0], [-9.5, 3.5], [-10.5, 7.5]], { em: glow('ember', 0.5) });
    g.polyline([[-4.5, 5], [-5.5, 10]], { em: glow('ember', 0.4) });
  });
  // nasal ridge + dorsal crest scutes
  g.poly(mirror([[0, -20.5], [-1.3, -19], [-1.8, -11], [0, -9]]), { m: M.iron, z: 13, bev: 0.8, bk: 1.3 });
  for (let k = 0; k < 4; k++) {
    const v0 = -6 + k * 4.8;
    g.poly(mirror([[0, v0], [-1.7 - k * 0.35, v0 + 0.7], [-2.1 - k * 0.4, v0 + 4.2], [0, v0 + 5]]), { m: M.iron, z: 13 + k * 0.2, bev: 0.9, bk: 1.3 });
  }
  // two long horns from the brow, swept back over the cheeks and past the jaw hinges
  g.sym(() => {
    g.fill(-19, -9, -3, 20, { m: M.iron, z: 16 }, (u, v, o) => {
      // horn centerline: quadratic from the brow (-6,-6) curving out and back past the
      // skull to the tip (-16,17.3), leaving a V gap between horn and neck
      let best = 1e9, bt = 0, bx = 0, by = 0;
      for (let k = 0; k <= 24; k++) {
        const t = k / 24, it = 1 - t;
        const cx = it * it * -6 + 2 * it * t * -11.5 + t * t * -16, cy = it * it * -6 + 2 * it * t * 2 + t * t * 17.3;
        const d = hyp(u - cx, v - cy);
        if (d < best) { best = d; bt = t; bx = u - cx; by = v - cy; }
      }
      const r = lerp(2.2, 0.45, bt * bt);
      if (best > r) return false;
      const w = Math.sqrt(Math.max(0, 1 - (best / r) ** 2));
      o.nu = bx / r; o.nv = by / r; o.nz = w + 0.15;
      o.z = 16 + 2 * w;
      o.t = bt < 0.2 ? 0 : 1;
      return true;
    });
    // horn root boss over the brow
    g.circ(-6.3, -6.8, 2.1, { m: M.iron, z: 18, h: 1.2 });
  });
  // brow ridges over slanted magenta eyes (the Choir looks out of the rock)
  g.sym(() => beam(g, -2.5, -10.8, -8.5, -7.6, 2, 1.8, { m: M.iron, z: 13.5, bev: 0.8, bk: 1.3 }));
  g.sym(() => {
    g.poly([[-4, -8.6], [-8, -6.2], [-7.6, -5.2], [-3.9, -7.4]], { m: M.dark, z: 13, em: glow('magenta', 0.6), sp: SP.mag });
    g.px(-5, -7.6, { em: WHITE, hot: true });
    g.px(-2.2, -18.2, { em: glow('ember', 0.6) }); // nostril
  });
  // Choir crystals erupting from the back of the skull, streaming back over the neck
  // (symmetric: this sprite's far directions are mirrored)
  crust(g, 0, 10.5, 3, 606, { z: 14, sym: true });
  g.sym(() => { g.save().tr(-1.6, 10.5).rot(Math.PI + 0.6); shard(g, 5, 1.7, { z: 15, core: glow('magenta', 0.45), sp: SP.mag }); g.restore(); });
  g.save().tr(0, 11).rot(Math.PI); shard(g, 7, 2, { z: 16, core: glow('magenta', 0.55), sp: SP.mag }); g.restore();
}

// Jaw frames (under the skull): 0 closed, 1 open — the lower jaw halves swing out on their
// hinges and the molten maw blazes between them.
function wyrmJaw(g, f) {
  const open = (f & 1) === 1;
  const A = open ? 0.3 : 0;
  if (open) {
    // molten maw between the spread jaws: white-hot throat in front of the snout, ember
    // toward the teeth
    g.poly([[0, -8], [-8, -14], [-8.8, -20.5], [-4, -24.2], [0, -24.6], [4, -24.2], [8.8, -20.5], [8, -14]], {
      m: M.dark, z: 2, sp: SP.fire, n: [0, 0, 1],
    });
    g.fill(-11, -25, 11, -8, { decal: true }, (u, v, o) => {
      const d = hyp(u / 5.5, (v + 21.5) / 3.2);
      o.em = d < 0.6 ? WHITE : glow('ember', clamp(1.1 - d * 0.28, 0.4, 1));
      o.hot = d < 1;
      return true;
    });
  }
  g.sym(() => {
    // lower jaw half on its hinge: heavy iron bone with a row of fangs on the inner edge
    g.save().tr(-10, 4).rot(-A);
    beam(g, 0, 0, 6.8, -22, 5.2, 2.6, { m: M.iron, z: 4, bev: 1.2, bk: 1.3 });
    if (open) for (let k = 0; k < 4; k++) {
      const t = 0.5 + k * 0.13, bu = 6.8 * t + 1.2 - t * 0.5, bv = -22 * t;
      g.poly([[bu - 0.3, bv - 1.2], [bu + 2.2, bv - 0.2], [bu - 0.3, bv + 0.9]], { m: M.bone, z: 4.5 });
    }
    g.restore();
    if (open) g.poly([[-4.3, -17.8], [-6.4, -16.2], [-4.4, -15.2]], { m: M.bone, z: 5 }); // upper fang
  });
}

function wyrmTail(g) {
  // tip points up (dir 0), base toward the body: two tapering basalt scutes over an iron
  // spine, ending in an iron stinger
  g.poly(mirror([[0, -6], [-3, -4], [-5.5, 4], [-6, 9], [0, 10.8]]), { m: M.iron, z: 1, bev: 1.2 });
  const scute = (v0, v1, w0, w1, seed, z) => g.fill(-w1 - 1, v0 - 1, w1 + 1, v1 + 1, { m: M.basalt, z, sp: SP.ember }, (u, v, o) => {
    const k = (v - v0) / (v1 - v0);
    if (k < 0 || k > 1) return false;
    const e = 2 * k - 1, hw = lerp(w0, w1, k) * Math.sqrt(1 - e * e * e * e);
    if (Math.abs(u) > hw) return false;
    const a = u / (hw || 1);
    const heat = basalt(Math.abs(u), v, o, seed, 0.24, 0, 0, 1, 0.08);
    if (u < 0) o.nu = -o.nu;
    o.nu = o.nu * 0.5 + a * 1.1; o.nv = o.nv * 0.5 + e * 0.5 - 0.25; o.nz = Math.sqrt(1 - a * a * 0.8) + 0.2;
    o.z = z + 3 * Math.sqrt(1 - a * a);
    if (heat > 0) o.t -= 2;
    return true;
  });
  scute(0.5, 10.6, 5.4, 7.6, 505, 4);
  g.line(-4.5, 1.5, 4.5, 1.5, { em: glow('ember', 0.55), sp: SP.ember });
  scute(-6.2, 2.6, 3.2, 5.6, 509, 6);
  g.line(-2.5, -5, 2.5, -5, { em: glow('ember', 0.5), sp: SP.ember });
  // stinger
  g.poly([[0, -11.4], [-2.6, -5.5], [-1.6, -3.5], [1.6, -3.5], [2.6, -5.5]], { m: M.iron, z: 9, bev: 1, bk: 1.4 });
  g.line(0, -9.5, 0, -5.5, { em: glow('ember', 0.55), sp: SP.ember });
  g.px(0, -10.2, { em: glow('ember', 0.8) });
  // crest ridge continuing from the body
  g.poly(mirror([[0, -1], [-1.3, 0], [-1.5, 6], [0, 8]]), { m: M.iron, z: 10, bev: 0.8, bk: 1.3 });
  g.sym(() => { g.save().tr(-3.8, 5.5).rot(-2.2); shard(g, 4.5, 1.5, { z: 9, core: glow('magenta', 0.45) }); g.restore(); });
}

function wyrmJobs() {
  return [
    ['boss_wyrm_head', 51, 51, { frames: 2, dirs: 32, fps: 4, sym: true, over: wyrmHead }, wyrmJaw],
    ['boss_wyrm_seg', 29, 29, { frames: 2, dirs: 16, fps: 4 }, wyrmSegment(0)],
    ['boss_wyrm_seg_b', 29, 29, { frames: 2, dirs: 16, fps: 4 }, wyrmSegment(1)],
    ['boss_wyrm_seg_c', 29, 29, { frames: 2, dirs: 16, fps: 4 }, wyrmSegment(2)],
    ['boss_wyrm_tail', 25, 25, { dirs: 32, sym: true }, wyrmTail],
  ];
}

// =======================================================================================
// 3. PRISM — crystal array entity (S3 Veil Nebula)
// A great faceted teal crystal with violet satellite crystals, held in Choir carapace
// clamps, an eye of light suspended inside. Facets come from a straight-skeleton "roof"
// over each outline; a light band sweeps across the facets over the 4 shimmer frames.
// =======================================================================================

const PRISM = {
  shardOrbitR: 40,      // orbit radius of the shard sprites around the prism center
  eye: [0, -3],         // weak point
  coreR: 8,
  shardR: 5,            // shard collision: capsule of radius shardR, length shardLen along its dir
  shardLen: 28,
  bodyRx: 17, bodyRy: 30, // body collision ellipse
};

// Crystal column mesh pointing along -v (tip at -len, base at +base): side facets meet on a
// central ridge, tip facets converge on the point.
function crystalColumn(g, len, hw, S, base = len * 0.32) {
  const H = hw * (S.ridgeH ?? 1.3);
  const [V, T] = mirrorMesh(
    [[0, -len, 0], [-hw * 0.8, -len * 0.5, 0], [-hw, 0, 0], [-hw * 0.7, base * 0.8, 0], [0, base, 0], [0, -len * 0.5, H], [0, base * 0.45, H * 0.9]],
    [[0, 1, 5], [1, 2, 6], [1, 6, 5], [2, 3, 6], [3, 4, 6]]);
  gemMesh(g, V, T, S);
}

// sweeping shimmer band: brightens facets (decal) where the band crosses them. Bands repeat
// every 64 units of (0.55u + v), so phase += 16 per frame sweeps smoothly and loops in 4.
function shimmer(g, u0, v0, u1, v1, phase, width, mt) {
  g.fill(u0, v0, u1, v1, { decal: true }, (u, v, o) => {
    const k = ((((u * 0.55 + v - phase) % 64) + 96) % 64) - 32;
    if (Math.abs(k) > width) return false;
    const i = o.i;
    if (g.m[i] !== mt || g.e[i]) return false;
    o.dt = Math.abs(k) < width * 0.35 ? 2 : 1;
    return true;
  });
}

function sparkle(g, u, v, r, c) {
  g.px(u, v, { em: WHITE });
  for (let k = 1; k <= r; k++) {
    const cc = k === r ? glow(c, 0.6) : glow(c, 0.9);
    g.px(u + k, v, { em: cc }); g.px(u - k, v, { em: cc }); g.px(u, v + k, { em: cc }); g.px(u, v - k, { em: cc });
  }
}

// Choir claw: a carapace knuckle with two jointed talons curling over the crystal girdle
function choirClaw(g) {
  const fing = (pts, rs) => { for (let k = 0; k + 1 < pts.length; k++) g.cyl(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], rs[k], { m: M.car, z: 13 + k * 0.4 }); };
  fing([[-16.5, -4], [-16, -10], [-12.5, -13.5], [-8.2, -12]], [2, 1.5, 0.7]);
  fing([[-16.5, 1], [-15.5, 7.5], [-12, 10.5], [-7.8, 9.2]], [2, 1.5, 0.7]);
  g.ell(-17, -1.5, 3, 4.6, { m: M.car, z: 14, h: 1.6 });
  g.ell(-17.4, -1.5, 1.1, 1.5, { m: M.dark, z: 15, em: glow('magenta', 0.55), sp: SP.mag });
  g.px(-17.4, -2, { em: glow('magenta', 0.8) });
}

function prismBody(g, f) {
  f &= 3;
  g.scale(1.12); // one size up from the first cut, so the S3 boss has the presence of the S1 one

  // ---- satellite crystals (violet), behind the main body
  g.sym(() => {
    g.save().tr(-11, 9).rot(-2.25);
    crystalColumn(g, 14, 5, { m: M.crysV, z: 2 });
    g.line(0, 1, 0, -7, { em: glow('plasma', 0.6), sp: SP.violet });
    g.restore();
    g.save().tr(-8, -15).rot(-0.6);
    crystalColumn(g, 12.5, 4.2, { m: M.crysV, z: 2 });
    g.line(0, 1, 0, -6, { em: glow('plasma', 0.6), sp: SP.violet });
    g.restore();
    g.save().tr(-5, 21).rot(-2.8);
    crystalColumn(g, 8.5, 3, { m: M.crysV, z: 2 });
    g.restore();
  });

  // ---- the great crystal: a hand-cut gem mesh
  const [V, T] = mirrorMesh(
    [[0, -29, 0], [-8, -19, 0], [-13.5, -5, 0], [-11, 13, 0], [-4, 25, 0], [0, 28, 0],
     [-4.5, -18, 9], [-8.5, -5, 10], [-7, 10, 10], [-2.5, 20, 9], [0, -13, 14], [0, -3, 16], [0, 13, 14]],
    [[0, 1, 6], [0, 6, 10], [1, 2, 7], [1, 7, 6], [2, 3, 8], [2, 8, 7], [3, 4, 9], [3, 9, 8], [4, 5, 9], [9, 5, 12],
     [6, 7, 11], [6, 11, 10], [7, 8, 11], [8, 12, 11], [8, 9, 12]]);
  gemMesh(g, V, T, { m: M.crysT, z: 4, t: -1 });

  // internal refraction: light paths flare in turn across the frames
  const paths = [
    [[-4.5, -18], [0, -3], [7, 10]], [[4.5, -18], [0, -3], [-7, 10]], [[-8.5, -5], [8.5, -5]], [[0, -13], [0, 13]],
    [[-7, 10], [2.5, 20]], [[7, 10], [-2.5, 20]], [[-4.5, -18], [4.5, -18]], [[-8.5, -5], [0, 13], [8.5, -5]],
  ];
  paths.forEach((pth, k) => {
    const hot = (k + f) % 4 === 0;
    g.polyline(pth, { em: glow('crystal', hot ? 0.95 : 0.55), sp: SP.teal, hot });
  });

  // shimmer bands sweeping down across the facets (16 px per frame, seamless over 4)
  shimmer(g, -15, -30, 15, 30, -32 + f * 16, 4, M.crysT);

  // ---- the eye of light: violet iris, vertical slit pupil, light bleeding into the crystal
  g.poly(mirror([[0, -12], [-6.5, -3], [0, 6]]), { m: M.void, z: 13, bev: 1.2, bk: 1.2 });
  g.fill(-9, -14.5, 9, 8.5, { decal: true }, (u, v, o) => {
    const k = Math.abs(u) / 6.5 + Math.abs(v + 3) / 9;
    if (k <= 1 || k > 1.3 || g.e[o.i]) return false;
    o.em = glow('plasma', k < 1.15 ? 0.45 : 0.3);
    o.sp = 0;
    return true;
  });
  const irisI = [0.8, 0.9, 1, 0.9][f];
  g.fill(-6, -11.5, 6, 5.5, { m: M.void, z: 13.5, sp: SP.violetS }, (u, v, o) => {
    const k = Math.abs(u) / 5.2 + Math.abs(v + 3) / 7.6;
    if (k > 1) return false;
    o.em = glow('plasma', clamp(irisI - k * 0.45, 0.25, 1));
    if (k < 0.3) o.em = glow('plasma', 1);
    const slit = 1.25 * (1 - Math.abs(v + 3) / 6.2);
    if (Math.abs(u) < slit) { o.em = 0; o.m = M.abyss; o.t = -9; }       // slit pupil
    else if (Math.abs(u) < slit + 0.9 && Math.abs(v + 3) < 5) { o.em = WHITE; o.hot = true; } // its rim
    return true;
  });

  // ---- Choir claws gripping the girdle + socket at the base
  g.sym(() => choirClaw(g));
  g.poly(mirror([[0, 21], [-5, 22.5], [-4, 27], [0, 28.5]]), { m: M.car, z: 12, bev: 0.9, bk: 1.3 });
  g.px(0, 25, { em: glow('magenta', 0.5), sp: SP.mag });

  const sp = [[[-8, -14], [6, 14]], [[9, -17], [-4, 19]], [[-9, 5], [3, -23]], [[8, 3], [-7, 15]]][f];
  for (const [u, v] of sp) sparkle(g, u, v, 1, 'crystal');
}

function prismShard(g) {
  // orbiting crystal blade; dir 0 = tip pointing up (orbit code points it outward). Dark
  // faceted body, bright ridge, serrated edges, white-hot tip.
  crystalColumn(g, 16.5, 4.8, { m: M.crysTD, z: 2, ridgeH: 1.6 }, 13.5);
  // serrations: small notches bitten out of both edges
  g.sym(() => {
    for (const v of [-8, -3.5, 1]) g.poly([[-6.5, v - 2], [-2.4, v], [-6.5, v + 0.8]], { cut: true });
  });
  g.line(0, -12, 0, 7, { em: glow('crystal', 0.75), sp: SP.teal });
  g.px(0, -15, { em: WHITE, hot: true });
  g.px(0, -14, { em: glow('crystal', 0.9) });
  // carapace socket at the base with a Choir node
  g.poly(mirror([[0, 11], [-2.8, 11.8], [-2.4, 14.8], [0, 15.8]]), { m: M.car, z: 5, facet: 1.2 });
  g.px(0, 13, { em: glow('magenta', 0.5), sp: SP.mag });
}

function prismJobs() {
  return [
    ['boss_prism', 51, 69, { frames: 4, fps: 8, loop: true }, prismBody],
    ['boss_prism_shard', 35, 35, { dirs: 16, sym: true }, prismShard],
  ];
}

// =======================================================================================
// 4. DREAD — the awakening dreadnought bridge section (S4 Leviathan Wreck)
// A colossal bow section torn from the wreck: exposed ribs along the torn stern edge,
// rust-streaked armor, a stepped command tower whose bridge windows now burn Choir
// magenta, a spinal cannon down the centerline, flank turrets and drone hatches.
// =======================================================================================

const DREAD = {
  cannon: [0, 25],            // main cannon sprite center on the body
  cannonMuzzle: [0, 21],      // muzzle relative to the cannon sprite center
  turrets: [[-61, -12], [61, -12], [-38, 4], [38, 4], [-23, 27], [23, 27]],
  turretMuzzle: 7.5,          // barrel tips: turret center + turretMuzzle * (sin a, -cos a)
  hatches: [[-45, -27], [45, -27], [-73, 1], [73, 1]],
  bridge: [0, -7],            // weak point (bridge windows)
  bridgeR: 9,
  // blast shutter over the chevron bridge window: draw boss_dread_shutter over the body at
  // body + at, frame = round(open * 4) (0 = shut .. 4 = retracted under its hood)
  shutter: { sprite: 'boss_dread_shutter', at: [0, -10], frames: 5 },
  hullRadius: 70,
  // collision rects [x, y, w, h] relative to the body center
  rects: [[-62, -38, 124, 40], [-87, -26, 174, 26], [-70, 0, 140, 16], [-44, 16, 88, 16], [-20, 32, 40, 15]],
  // Soft drop shadow (body + cannon silhouette) for flying low over the Wreck hull: draw it on
  // the main layer BEFORE the boss at body + (dx, dy). Not emissive.
  shadow: { sprite: 'boss_dread_shadow', dx: 6, dy: 8 },
};

// Torn stern edge (full outline, asymmetric jags) + the bow wedge
const DREAD_TORN_R = [[0, -35], [4, -40], [9, -37], [14, -41], [20, -36], [26, -44], [31, -38], [38, -40], [44, -35], [51, -41], [57, -37], [61, -34]];
const DREAD_TORN_L = [[-61, -34], [-56, -39], [-50, -36], [-43, -42], [-36, -35], [-30, -40], [-23, -37], [-17, -43], [-11, -36], [-5, -39]];
const DREAD_HULL = [...DREAD_TORN_R, [71, -31], [81, -26], [87, -17], [87, -5], [79, 5], [60, 18], [38, 31], [20, 41], [8, 47], [0, 47],
  [-8, 47], [-20, 41], [-38, 31], [-60, 18], [-79, 5], [-87, -5], [-87, -17], [-81, -26], [-71, -31], ...DREAD_TORN_L];

function dreadBody(g) {
  const R = rng(4404);

  // ---- torn stern: bent girders and ripped plates sticking out behind the tear
  for (let k = 0; k < 11; k++) {
    const u = -56 + k * 11 + (R() - 0.5) * 5, base = -34;
    const top = -41 - R() * 5.5, bend = (R() - 0.5) * 7, mid = lerp(base, top, 0.55);
    const m = R() < 0.5 ? M.dreadHull : M.rustB;
    g.cyl(u, base, u + bend * 0.3, mid, 1.2, { m, z: 1.5 });
    g.cyl(u + bend * 0.3, mid, u + bend, top, 0.9, { m, z: 1.5 });
    g.px(u + bend, top + 0.5, { em: glow('ember', 0.5) }); // cut end still glowing
  }
  for (const [u, v, a] of [[-47, -38, -0.5], [-8, -39, 0.35], [34, -40, -0.25], [55, -37, 0.6]]) {
    g.save().tr(u, v).rot(a);
    g.poly([[-3.5, 2], [-2.5, -3], [3, -4.2], [3.5, 2]], { m: M.rustB, z: 2, bev: 0.8, pil: 0.6 });
    g.restore();
  }

  // ---- main hull: dark warm plating, bow wedge
  g.poly(DREAD_HULL, { m: M.dreadHull, z: 3, bev: 2.5, bk: 1.2, pil: 0.15 });
  // ember-hot cut edge along the tear (decal just inside the torn outline)
  const edge = [...DREAD_TORN_L, ...DREAD_TORN_R];
  for (let k = 0; k + 1 < edge.length; k++) {
    const [u0, v0] = edge[k], [u1, v1] = edge[k + 1];
    const hot = hash2(k, 3, 77);
    g.line(u0, v0 + 1, u1, v1 + 1, { em: glow('ember', hot > 0.6 ? 0.75 : hot > 0.25 ? 0.5 : 0.35) });
  }

  // armor belts: rust-dominant raised plating with bright top-left rims
  g.sym(() => {
    g.poly([[-61, -31], [-71, -27], [-80, -22], [-84, -15], [-84, -6], [-77, 3], [-66, 9], [-52, 5], [-50, -31]], { m: M.rustB, z: 5, bev: 1.6, bk: 1.3, pil: 0.3 });
    g.poly([[-62, 13], [-48, 9], [-32, 12], [-30, 26], [-25, 36], [-38, 28]], { m: M.rustB, z: 5, bev: 1.6, bk: 1.3, pil: 0.3, t: -1 });
    g.poly([[-47, -33], [-27, -33], [-27, 0], [-31, 8], [-47, 4]], { m: M.rustB, z: 5.5, bev: 1.6, bk: 1.3, pil: 0.3 });
    seam(g, -50, -18, -82, -18); seam(g, -65, -29, -65, 7); seam(g, -47, -12, -27, -12); seam(g, -44, 16, -32, 14);
    rivets(g, -79, -14, -68, -14, 3.5); rivets(g, -44, -31, -44, -15, 4); rivets(g, -56, 12, -36, 13, 4); rivets(g, -30, -31, -30, -15, 4);
    // trenches with pipe runs
    g.cyl(-49, -32, -49, 5, 1.1, { m: M.gun, z: 4.5 });
    g.cyl(-26, -33, -26, 22, 1.0, { m: M.gun, z: 4.5 });
    vent(g, -83, -12, 5, 6, true, { z: 5.2, slat: M.dreadHull });
    vent(g, -45, -9, 7, 5, false, { z: 5.7, slat: M.dreadHull });
    // turret pads (dark wells with a warm ring) and hatch wells
    for (const [u, v] of [[-61, -12], [-38, 4], [-23, 27]]) {
      g.circ(u, v, 7.6, { m: M.dreadHull, z: 6, h: 0.8, t: -2 });
      g.ring(u, v, 6.6, 7.6, { m: M.rustB, z: 6.3, flat: true });
    }
    for (const [u, v] of [[-45, -27], [-73, 1]]) g.rect(u - 11.5, v - 7.5, 23, 15, { m: M.dreadHull, z: 5.4, bev: 1, t: -1 });
  });

  // ---- spinal cannon mount down the bow
  g.poly(mirror([[0, -2], [-14, -2], [-15, 26], [-9, 45], [0, 47]]), { m: M.dreadHull, z: 6, bev: 2, bk: 1.3, pil: 0.3 });
  g.poly(mirror([[0, 2], [-9, 2], [-9, 30], [-6, 44], [0, 45]]), { m: M.dark, z: 5 });
  for (let v = 5; v <= 41; v += 4) g.line(-8, v, 8, v, { m: M.hullD, t: 1 });
  g.sym(() => rivets(g, -12.5, 2, -12.5, 26, 3));

  // ---- command tower: stepped tiers forming a prow that points at the bow, chevron bridge
  g.poly(mirror([[0, -36], [-20, -36], [-23, -32], [-23, -9], [-12, 2], [0, 6]]), { m: M.dreadHull, z: 8, bev: 2, bk: 1.3, pil: 0.3 });
  g.poly(mirror([[0, -32], [-14, -32], [-16, -28], [-16, -9], [-8, -1], [0, 2]]), { m: M.rustB, z: 10.5, bev: 1.8, bk: 1.3, pil: 0.3 });
  g.poly(mirror([[0, -27], [-8, -27], [-10, -22], [-10, -12], [-4, -5.5], [0, -3.5]]), { m: M.steel, z: 13, bev: 1.6, bk: 1.4, t: -1 });
  // chevron bridge window following the prow (possessed: burning magenta)
  g.poly(mirror([[0, -8.5], [-8.6, -14.5], [-9.4, -12.5], [0, -5.6]]), { m: M.dark, z: 13.4, n: [0, 0.3, 1] });
  // tower roof: centered radar dome, mast and array
  g.circ(0, -19.5, 3.4, { m: M.steel, z: 15, h: 2.2 });
  g.ring(0, -19.5, 3.4, 4.3, { m: M.dreadHull, z: 14, flat: true });
  g.cyl(0, -23, 0, -34, 0.7, { m: M.steel, z: 15.5 });
  g.rect(-3.5, -30, 7, 1.6, { m: M.steel, z: 15.2, bev: 0.5 });
  g.sym(() => {
    vent(g, -14, -29, 4, 8, true, { z: 10.7, slat: M.rustB });
    rivets(g, -20, -33, -20, -12, 4);
    g.rect(-14, -8, 4, 3, { m: M.dreadHull, z: 10.8 });
  });

  // ---- faded hull numbers
  text(g, '04', -71, -24, { m: M.bone, t: -1 });
  text(g, '04', 64, -24, { m: M.bone, t: -1 });

  // ---- grime: vertical rust/soot streaks running down from seams and rivets, only on the
  // plating (never on steel superstructure or the cannon channel)
  g.fill(-87, -43, 87, 47, { decal: true }, (u, v, o) => {
    const m = g.m[o.i];
    if (m !== M.dreadHull && m !== M.rustB) return false;
    const col = Math.floor(u), start = hash2(col, 1, 91) * 90 - 45, len = 4 + hash2(col, 2, 92) * 14;
    if (hash2(col, 3, 93) > 0.3 || v < start || v > start + len) return false;
    o.dt = -1;
    if (m === M.dreadHull && hash2(col, 4, 94) > 0.55) o.m = M.rustB; // rust bleeding down
    return true;
  });

  // ---- rows of tiny hull windows along the armor belts (scale cues)
  g.sym((sg) => {
    windows(g, -80, -21, -53, -21, 2, 450 + (sg > 0 ? 0 : 7), { possessed: sg > 0 ? 0.05 : 0.35 });
    windows(g, -58, 22, -36, 30, 2, 451 + (sg > 0 ? 0 : 7), { possessed: sg > 0 ? 0.05 : 0.35 });
    windows(g, -46, -30, -46, -16, 2, 452 + (sg > 0 ? 0 : 7), { possessed: sg > 0 ? 0.1 : 0.4 });
  });

  // ---- Choir awakening: glowing veins down the pipe trenches, crystal growth bursting from
  // the tower and the belts
  for (const [u, v0, v1, s] of [[-50.8, -30, 3, 461], [48.2, -31, 4, 462], [-24.2, -30, 20, 463], [27.8, -26, 18, 464]]) {
    const Rv = rng(s);
    const pts = [];
    for (let v = v0; v <= v1; v += 2) pts.push([u + (Rv() < 0.3 ? (Rv() < 0.5 ? -1 : 1) : 0), v]);
    const half = pts.length >> 1;
    g.polyline(pts.slice(0, half + 1), { em: glow('magenta', 0.4), sp: SP.mag });
    g.polyline(pts.slice(half), { em: glow('magenta', 0.2) });
  }
  crust(g, 18, -30, 5, 441, { z: 12 });
  crystalCluster(g, 19, -31, 0.75, 4, 12, 442, { z: 13, core: glow('magenta', 0.6) });
  crust(g, -32, 20, 4, 443, { z: 7 });
  crystalCluster(g, -33, 21, -2.3, 3, 8, 444, { z: 8 });
  crust(g, -66, -24, 4.5, 447, { z: 7 });
  crystalCluster(g, -67, -25, -0.9, 3, 9, 449, { z: 8 });
  crust(g, 52, 13, 4, 453, { z: 7 });
  crystalCluster(g, 53, 13, 2.2, 3, 8, 454, { z: 8 });
  crust(g, -15, 36, 3, 455, { z: 8 });
  crystalCluster(g, -16, 36, -2.6, 2, 6, 456, { z: 9 });
  circuit(g, 16, -26, 6, 30, 445, { dir: 0 });
  veins(g, 17, -28, 2.6, 2, 8, 448);
  circuit(g, -30, 18, 4, 20, 446, { dir: 2 });
}

// Per-frame lights over the static body: alternating running lights, bridge flicker, sparks.
function dreadLights(g, f) {
  const on = (f & 1) === 0;
  // chevron bridge window: two rows of possessed magenta panes along the V
  for (let k = 0; k <= 8; k++) {
    const u = k, v = -6.7 - k * 0.68;
    for (const s of [1, -1]) {
      if (k & 1) g.px(s * u, v, { em: glow('magenta', on || k !== 3 ? 0.85 : 0.55), sp: SP.magS });
      else g.px(s * u, v, { em: glow('magenta', 0.6), sp: SP.magS });
    }
  }
  g.px(0, -6.5, { em: WHITE, hot: true });
  g.px(0, -34.5, { em: on ? pack('#ff5a5a') : pack('#5a1018'), hot: on });
  g.sym(() => g.px(-12, 34, { em: glow('gold', on ? 0.6 : 0.4), sp: SP.amber }));
  const lights = [[-86, -10], [-79, 4], [-60, 17], [-40, 29], [-21, 40], [-80, -25], [-66, -31]];
  lights.forEach(([u, v], k) => {
    const lit = (k & 1) === (on ? 0 : 1);
    for (const s of [1, -1]) g.px(u * s, v, { em: lit ? pack('#ff5a5a') : pack('#5a1018'), sp: lit ? SP.red : 0, hot: lit });
  });
  // sparks spitting from the tear
  for (const [u, v] of (on ? [[-47, -44], [22, -44.5], [49, -42]] : [[-13, -41], [-33, -45], [38, -43]])) g.px(u, v, { em: glow('ember', 0.8) });
}

function dreadCannon(g, f) {
  // Spinal railgun pointing down (toward the player). f: 0 idle .. 3 full charge:
  // plasma fills the channel between the rails from the breech to the muzzle.
  const c = [0, 0.34, 0.68, 1][f & 3];
  // breech block
  g.poly(mirror([[0, -21.5], [-11, -21.5], [-15.5, -17], [-15.5, -8], [-12, -4], [0, -4]]), { m: M.dreadHull, z: 4, bev: 2, bk: 1.3, pil: 0.3 });
  g.sym(() => {
    vent(g, -14, -17, 3, 9, true, { z: 4.2, slat: M.rustB });
    g.cyl(-12.5, -4, -10.5, 8, 1.6, { m: M.gun, z: 3.5 });
    rivets(g, -9.5, -20, -9.5, -6, 3.5);
  });
  // capacitor window
  g.rect(-6, -19.5, 12, 7, { m: M.hullD, z: 4.5, bev: 0.8 });
  g.fill(-5, -18.5, 5, -13.5, { m: M.dark, z: 4.6, sp: c > 0.3 ? SP.violetS : SP.violet }, (u, v, o) => {
    const k = (u + 5) / 10;
    if (c > 0 && k <= c + 0.05) o.em = glow('plasma', clamp(0.35 + c * 0.5 + (((u + v) & 1) ? 0.1 : 0), 0, 1));
    return true;
  });
  // plasma channel between the rails
  const top = -8, bot = 20, fillTo = top + (bot - top) * c;
  g.fill(-2.6, top, 2.6, bot, { m: M.dark, z: 3, sp: c > 0.5 ? SP.violetS : SP.violet }, (u, v, o) => {
    if (c > 0 && v <= fillTo) {
      const core = Math.abs(u) < 1.1;
      const head = fillTo - v < 2.5;
      o.em = glow('plasma', clamp((core ? 0.75 : 0.5) + c * 0.3 + (head ? 0.2 : 0), 0, 1));
      if (c >= 1 && core) { o.em = WHITE; o.hot = true; }
    } else if (Math.abs(u) < 1.1 && ((Math.round(v) + f) % 3) === 0) o.em = pack(RAMPS.plasma[1]); // residual glow
    return true;
  });
  // twin rails
  g.sym(() => {
    g.poly([[-2.6, -8], [-7.5, -8], [-7.5, 16], [-6, 22], [-2.6, 20]], { m: M.steel, z: 6, bev: 1.6, bk: 1.4, t: -1 });
    g.line(-3.4, -7, -3.4, 19, { dt: -2 });
  });
  // armored straps across the rails
  for (const v of [0, 11]) {
    g.poly(mirror([[0, v - 1.4], [-8.8, v - 1.4], [-9.4, v], [-8.8, v + 1.4], [0, v + 1.4]]), { m: M.rustB, z: 7.5, bev: 0.8, bk: 1.2 });
    g.sym(() => g.px(-7.5, v, { dt: 2 }));
    if (c > 0) g.px(0, v, { decal: true, em: glow('plasma', 0.5 + c * 0.5) });
  }
  // muzzle
  g.ell(0, 20.8, 2.6, 1.4, { m: M.dark, z: 6.5, em: c > 0 ? glow('plasma', 0.35 + c * 0.65) : pack(RAMPS.plasma[0]), sp: c > 0.3 ? SP.violetS : 0, hot: c >= 1 });
  if (c >= 1) g.ell(0, 20.8, 1.3, 0.8, { decal: true, em: WHITE, hot: true });
  if (c >= 0.68) {
    const R = rng(90 + f);
    for (let k = 0; k < 2 + f; k++) {
      const v = -6 + R() * 24, side = R() < 0.5 ? -1 : 1;
      g.polyline([[side * 3, v], [side * (4.5 + R() * 2), v + 1], [side * (5 + R() * 3), v + 2.5]], { em: glow('plasma', 0.95), hot: true });
    }
  }
}

function dreadTurret(g) {
  // battleship twin turret, dir 0 = up: dark gunmetal housing with lit top edges, long light
  // barrels running out over the dark pad well so the aim reads at 1x, dark bores.
  g.sym(() => {
    g.cyl(-1.7, 0, -1.7, -7.3, 1.0, { m: M.steel, z: 6, cap: 'flat' });
    g.px(-1.7, -7, { decal: true, t: -9 });
    g.line(-1.7, -3.5, -1.7, -3.5, { dt: -2 }); // blast-bag joint
  });
  g.fill(-5, -4.2, 5, 5.6, { m: M.gun, z: 5 }, (u, v, o) => {
    // rounded-rear housing with a sloped front plate
    if (v > 1.2 && u * u / 23 + (v - 1.2) * (v - 1.2) / 19 > 1) return false;
    if (Math.abs(u) > 4.6) return false;
    o.nu = (u / 5) * 0.8; o.nv = v < -2.8 ? -0.9 : v > 2 ? (v - 2) / 4 : 0; o.nz = 1;
    o.z = 5 + (v < -2.8 ? 0 : 1);
    return true;
  });
  g.line(-4, -2.8, 4, -2.8, { dt: 1 });
  g.line(-2, 3, 2, 3, { dt: -2 }); // rear hatch seam (no dots: two dots + barrels read as a face)
}

function dreadHatch(g, f) {
  const open = (f & 1) === 1;
  g.rect(-9.5, -5.5, 19, 11, { m: M.hullD, z: 1, bev: 1 });
  g.rect(-8, -4, 16, 8, { m: M.dark, z: 0.5 });
  if (open) {
    // interior: launch rails and the Choir glow below
    g.fill(-8, -4, 8, 4, { m: M.dark, z: 0.5 }, (u, v, o) => {
      const d = hyp(u / 7.5, v / 4);
      if (d < 0.8 && ((Math.round(u) + Math.round(v)) & 1)) o.em = glow('magenta', 0.55 - d * 0.35);
      else o.t = 1;
      return true;
    });
    g.line(-5.5, -3.5, -5.5, 3.5, { m: M.hullD, t: 2 }); g.line(5.5, -3.5, 5.5, 3.5, { m: M.hullD, t: 2 });
    g.ell(0, 0, 2.2, 1.6, { decal: true, em: glow('magenta', 0.9) });
    // retracted door leaves
    g.rect(-9.5, -5.5, 2.5, 11, { m: M.hull, z: 3, bev: 0.8 });
    g.rect(7, -5.5, 2.5, 11, { m: M.hull, z: 3, bev: 0.8 });
  } else {
    g.rect(-8, -4, 8, 8, { m: M.hull, z: 2.5, bev: 1 });
    g.rect(0, -4, 8, 8, { m: M.hull, z: 2.5, bev: 1 });
    hazard(g, -7.5, -3, 15, 6, { dir: 1 });
    g.line(0, -4, 0, 4, { dt: -3 });
  }
  g.px(-8.5, -4.5, { em: glow('gold', open ? 0.9 : 0.5), sp: SP.amber });
  g.px(8.5, -4.5, { em: glow('gold', open ? 0.9 : 0.5), sp: SP.amber });
}

// Blast shutter for the chevron bridge window (body coords, translated to the sprite center
// at DREAD.shutter.at). A V-shaped armored band slides up under a fixed hood as f goes 0..4.
function dreadShutter(g, f) {
  const open = (f % 5) / 4, lift = open * 7;
  g.tr(-DREAD.shutter.at[0], -DREAD.shutter.at[1]);
  const vTop = (u) => -9.6 - (Math.abs(u) / 9.6) * 6;   // hood's lower edge = shutter top at rest
  const vBot = (u) => -4.6 - (Math.abs(u) / 10.4) * 7;
  g.fill(-10.6, -17, 10.6, -4, { m: M.rustB, z: 14 }, (u, v, o) => {
    if (Math.abs(u) > 10.4 || v <= vTop(u) || v < vTop(u) - lift || v > vBot(u) - lift) return false;
    const k = (v - (vTop(u) - lift)) / (vBot(u) - vTop(u));  // 0 top .. 1 bottom of the band
    o.nu = u < 0 ? -0.45 : 0.45; o.nv = (k - 0.5) * 0.9; o.nz = 1;
    o.t = Math.abs(u) < 0.6 ? 1 : 0;                        // crease along the V
    if (k > 0.8) o.t -= 2;                                  // shadowed lower lip
    return true;
  });
  // rivets along the band
  if (open < 0.9) for (const u of [-7, -4, 4, 7]) g.px(u, (vTop(u) + vBot(u)) / 2 - lift + 0.3, { dt: 2 });
  // hood: fixed armored brow the shutter retracts under
  g.fill(-11.4, -18, 11.4, -8, { m: M.dreadHull, z: 15 }, (u, v, o) => {
    if (Math.abs(u) > 11.2 || v > vTop(u) || v < vTop(u) - 2.2) return false;
    o.nu = u < 0 ? -0.3 : 0.3; o.nv = -0.6; o.nz = 1;
    return true;
  });
}

// Soft drop shadow from the body + cannon silhouettes: alpha mask, box-blurred, 38% black.
function dreadShadow(body, cannon) {
  const pad = 3, w = body.w + pad * 2, h = body.h + pad * 2;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const x = cv.getContext('2d');
  x.drawImage(body.frames[0], pad, pad);
  if (cannon) x.drawImage(cannon.frames[0], pad + (body.w >> 1) + DREAD.cannon[0] - (cannon.w >> 1), pad + (body.h >> 1) + DREAD.cannon[1] - (cannon.h >> 1));
  const img = x.getImageData(0, 0, w, h), d = img.data;
  const a = new Float32Array(w * h), b = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) a[i] = d[i * 4 + 3] ? 1 : 0;
  // two passes of a 3x3 box blur (separable)
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
      const i = y * w + xx;
      b[i] = (a[i] + (xx > 0 ? a[i - 1] : 0) + (xx < w - 1 ? a[i + 1] : 0)) / 3;
    }
    for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
      const i = y * w + xx;
      a[i] = (b[i] + (y > 0 ? b[i - w] : 0) + (y < h - 1 ? b[i + w] : 0)) / 3;
    }
  }
  for (let i = 0; i < w * h; i++) { d[i * 4] = 5; d[i * 4 + 1] = 4; d[i * 4 + 2] = 12; d[i * 4 + 3] = Math.round(a[i] * 0.38 * 255); }
  x.putImageData(img, 0, 0);
  return { w, h, frameCount: 1, dirs: 1, fps: 1, frames: [cv], emissive: null };
}

function dreadJobs() {
  return [
    ['boss_dread', 177, 97, { frames: 2, fps: 2, fx: dreadLights, loop: true }, dreadBody],
    ['boss_dread_cannon', 33, 47, { frames: 4, fps: 6 }, dreadCannon],
    ['boss_dread_turret', 17, 17, { dirs: 16, sym: true }, dreadTurret],
    ['boss_dread_hatch', 21, 13, { frames: 2, fps: 2 }, dreadHatch],
    ['boss_dread_shutter', 27, 19, { frames: 5, fps: 8 }, dreadShutter],
  ];
}

// =======================================================================================
// 5. HEART — the Choir Heart (S5 Event Horizon)
// A colossal eye of glossy void: a magenta fibre iris around a black pupil ringed with a
// thin photon ring and a white singularity point, in a socket of carapace plates with
// crystal teeth. A 12-fold machine-crystal halo turns around it (8 frames = one period
// of its symmetry, so it loops seamlessly), blade petals fan out beyond the halo, and a
// raw singularity core is exposed in the final phase.
// =======================================================================================

const HEART = {
  iris: [0, 2],          // iris center relative to the eye sprite center (it gazes down)
  coreR: 7,              // eye weak point radius (pupil)
  eyeR: 23,              // eyeball radius
  haloR: 44,             // halo ring mid radius: its solid band (>= 78% opaque) is haloR ± haloBand
  haloBand: 3.5,
  petalR: 64,            // petal sprite centers sit petalR from the heart center, dir = outward angle
  petalLen: 36,          // petal blade spans petalR ± 18 along its dir
  petalW: 7,
  petalTip: 18,          // blade tip = petal center + petalTip * (sin a, -cos a)
  core2R: 11,            // boss_heart_core2 hit radius (event horizon + photon ring)
};

// lid plates: which armor band a lid pixel belongs to (0 = at the opening, 1 = outer),
// -1 = the dark gap between them. The seam arcs like the lid rim (deep at the center,
// shallow at the corners), so the plates read as curved armor, not flat stripes.
function lidBand(u, dv) {
  const seam = 2.5 + 7.5 * Math.sqrt(Math.max(0, 1 - (u / 23.8) ** 2));
  if (dv < seam - 0.7) return 0;
  if (dv < seam + 0.3) return -1;
  return 1;
}

function heartEye(g, f) {
  const pulse = f < 4 ? [0.7, 0.85, 1, 0.85][f] : 0.8;
  const pupilR = f < 4 ? [3.6, 4.4, 5.4, 4.4][f] : 4;
  const slit = f === 4 ? 7.5 : f === 5 ? 0 : 99;   // half-height of the lid opening
  const [iu, iv] = HEART.iris;

  g.circ(0, 0, 30, { m: M.car, z: 1, h: 3 });

  // ---- eyeball: glossy void sphere, fibre iris, photon-ringed alien pupil
  const IR = 12;
  g.fill(-23.5, -23.5, 23.5, 23.5, { m: M.void, z: 2, sp: SP.mag }, (u, v, o) => {
    const r = hyp(u, v) / 23;
    if (r > 1) return false;
    const w = Math.sqrt(1 - r * r);
    o.nu = u / 23; o.nv = v / 23; o.nz = w; o.z = 2 + 7 * w;
    const du = u - iu, dv = v - iv;
    const pd = hyp(du, dv) / pupilR;                // the pupil is a tiny event horizon
    if (pd < 1) { o.m = M.abyss; o.t = -9; if (f === 2 && Math.abs(du) < 0.6 && Math.abs(dv) < 0.6) o.em = glow('plasma', 0.8); return true; }
    if (pd < 1 + 1 / pupilR) { o.em = glow('plasma', f === 2 ? 1 : 0.85); o.hot = true; return true; } // photon ring
    const d = hyp(du, dv);
    if (d < IR) {
      const a = Math.atan2(du, -dv);
      const fib = hash2(Math.floor(((a / TAU) + 1) * 40), 3, 57), fib2 = hash2(Math.floor(((a / TAU) + 1) * 40), 9, 58);
      const k = d / IR;
      if (k > 0.86) { o.em = glow('magenta', 0.18); return true; }           // dark limbal ring
      let t = pulse * (1.02 - k * 0.6) + (fib - 0.5) * 0.45;
      if (k > 0.35 && k < 0.45) t += 0.2;                                     // collarette
      if (fib2 > 0.8 && k > 0.45) t -= 0.35;                                  // crypts
      o.em = glow('magenta', clamp(t, 0.15, 1));
      return true;
    }
    return true;
  });
  // capillaries crawling toward the iris
  const R = rng(5505);
  for (let k = 0; k < 11; k++) {
    let a = (k / 11) * TAU + R() * 0.3, rr = 22;
    const pts = [];
    while (rr > 15.5) {
      pts.push([Math.sin(a) * rr + iu * (1 - rr / 23), -Math.cos(a) * rr + iv * (1 - rr / 23)]);
      rr -= 1.6 + R(); a += (R() - 0.5) * 0.35;
    }
    g.polyline(pts, { em: glow('magenta', 0.35), sp: 0 });
    if (R() < 0.5) g.px(pts[pts.length - 1][0], pts[pts.length - 1][1], { em: glow('magenta', 0.4) });
  }
  // wet specular glint (upper-left): a 2x2 white-hot highlight and a short curved plasma arc
  g.rect(-12, -12, 2, 2, { decal: true, em: WHITE, hot: true });
  for (let k = 0; k < 5; k++) {
    const a = -0.62 - k * 0.11;
    g.px(Math.sin(a) * 18.5, -Math.cos(a) * 18.5, { em: glow('plasma', k === 0 || k === 4 ? 0.6 : 0.8) });
  }

  // ---- lids (half-closed / closed): two armored carapace plates per lid, seams following
  // the lid arc, a dark gap between the plates, a lit top edge on each plate and crystal
  // teeth along the glowing lid rim
  if (slit < 99) {
    const cv = slit ? iv * 0.3 : 0;
    const hOf = (u) => slit * Math.sqrt(Math.max(0, 1 - (u / 23.5) ** 2));
    const band = (u, v) => {
      const dv = Math.abs(v - cv) - hOf(u);
      if (dv < 0) return -2;
      return lidBand(u, dv);
    };
    g.fill(-24, -24, 24, 24, { m: M.car, z: 12, sp: SP.mag }, (u, v, o) => {
      const r = hyp(u, v) / 23.8;
      if (r > 1) return false;
      const h = hOf(u), dv = Math.abs(v - cv) - h;
      if (dv < 0) return false;
      const b = band(u, v);
      const w = Math.sqrt(1 - r * r);
      const up = v < cv;
      if (b === -1) { o.m = M.dark; o.nz = 1; o.z = 12; return true; }
      // each plate bulges: brighter toward its upper edge (top-left light)
      const seam = 2.5 + 7.5 * Math.sqrt(Math.max(0, 1 - (u / 23.8) ** 2));
      const f2 = b === 0 ? dv / seam : clamp((dv - seam) / Math.max(1, 23.8 - h - seam), 0, 1);
      o.nu = u / 23.8 * 0.8; o.nv = v / 23.8 * 0.6 + (up ? 1 : -1) * (0.5 - f2) * 0.9; o.nz = w + 0.25;
      o.z = 12 + 3 * w + (b === 0 ? 1.5 : 0);
      o.t = b === 0 ? 0 : -1;
      // the outer plate is split into overlapping scales
      if (b === 1 && Math.abs(((u + 40) % 9) - 4.5) > 4) { o.t = -3; return true; }
      if (band(u, v - 1) !== b && band(u, v - 1) !== -2) o.t += 2;          // lit top edge of the plate
      if (dv < 1.1) { o.em = glow('magenta', slit ? 0.65 : 0.75); return true; }  // glowing lid rim
      return true;
    });
    // crystal teeth along the rim (interlocking when closed)
    for (let u = -16; u <= 16; u += 4) {
      const h = hOf(u);
      const off = slit ? 0 : 2;
      g.save().tr(u - off, cv - h - 0.5).rot(Math.PI);
      shard(g, slit ? 3 : 2.5, 1.1, { m: M.crysM, z: 16 });
      g.restore();
      g.save().tr(u + off, cv + h + 0.5);
      shard(g, slit ? 3 : 2.5, 1.1, { m: M.crysM, z: 16 });
      g.restore();
    }
    if (!slit) g.px(0, 0, { em: WHITE, hot: true });
  }
}

// cheap crystal spike: one roof-faceted polygon (facets meet on the central ridge)
function spike(g, len, hw, S, base) {
  g.poly(mirror([[0, -len], [-hw * 0.8, -len * 0.5], [-hw, 0], [-hw * 0.7, base * 0.8], [0, base]]), { ...S, facet: 1.3 });
}

// socket: 12 carapace plates with glowing seams and crystal teeth (shared by all eye frames)
function heartSocket(g) {
  g.ring(0, 0, 24, 30, { m: M.car, z: 1 });
  for (let k = 0; k < 12; k++) {
    const a0 = (k / 12) * TAU + 0.05, a1 = ((k + 1) / 12) * TAU - 0.05;
    const pts = [];
    for (let s = 0; s <= 4; s++) { const a = lerp(a0, a1, s / 4); pts.push([Math.sin(a) * 30, -Math.cos(a) * 30]); }
    for (let s = 4; s >= 0; s--) { const a = lerp(a0, a1, s / 4); pts.push([Math.sin(a) * 24.5, -Math.cos(a) * 24.5]); }
    g.poly(pts, { m: M.car, z: 3, bev: 1.6, bk: 1.3, pil: 0 });
    const am = (k / 12) * TAU;
    g.line(Math.sin(am) * 25, -Math.cos(am) * 25, Math.sin(am) * 29.3, -Math.cos(am) * 29.3, { em: glow('magenta', 0.4), sp: SP.mag });
    const ac = am + TAU / 24;
    g.px(Math.sin(ac) * 27.3, -Math.cos(ac) * 27.3, { dt: 2 });
  }
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU + TAU / 24;
    g.save().tr(Math.sin(a) * 25.5, -Math.cos(a) * 25.5).rot(a + Math.PI);
    shard(g, 4.5, 1.6, { m: M.crysM, z: 6 });
    g.restore();
  }
}

function heartHalo(g, f) {
  // 12-fold symmetric outer ring turning clockwise, inner rune ring (24 dots, alternating
  // bright/dim = 12-fold) turning back: over 8 frames each ring turns exactly one period
  // (TAU/12), so frame 8 == frame 0 and the loop is seamless (checked by the dev lint).
  // angles come from integer steps of TAU/96 (mod 96) so the wrap is bit-exact
  const ang = (i) => ((((i % 96) + 96) % 96) / 96) * TAU;
  // inner rune ring
  g.ring(0, 0, 33.5, 36, { m: M.car, z: 2 });
  for (let k = 0; k < 24; k++) {
    const a = ang(4 * k - f);
    g.px(Math.sin(a) * 34.7, -Math.cos(a) * 34.7, { em: glow('magenta', k % 2 === 0 ? 0.6 : 0.35), sp: SP.mag });
  }
  // 12 spokes linking inner and outer rings
  for (let k = 0; k < 12; k++) {
    const a = ang(8 * k + 4 + f);
    g.cyl(Math.sin(a) * 36, -Math.cos(a) * 36, Math.sin(a) * 41, -Math.cos(a) * 41, 0.8, { m: M.car, z: 1.5 });
  }
  // outer ring: 12 armored segments, crystal spikes between them
  for (let k = 0; k < 12; k++) {
    const a = ang(8 * k + f);
    g.save().rot(a);
    // segment: annular plate spanning +-12 deg
    const pts = [];
    for (let s = 0; s <= 5; s++) { const t = (-0.2 + s * 0.08); pts.push([Math.sin(t) * 47.5, -Math.cos(t) * 47.5]); }
    for (let s = 5; s >= 0; s--) { const t = (-0.19 + s * 0.076); pts.push([Math.sin(t) * 40.5, -Math.cos(t) * 40.5]); }
    g.poly(pts, { m: M.car, z: 4, bev: 1.5, bk: 1.3 });
    g.line(-4, -44, 4, -44, { dt: -2 });
    // glowing node
    g.ell(0, -44, 1.6, 1.3, { m: M.dark, z: 5, em: glow('magenta', 0.6), sp: SP.mag });
    g.px(0, -44, { em: glow('magenta', 0.8) });
    // crystal spikes: long violet ones between segments, short obsidian ones on the segment
    g.save().rot(TAU / 24).tr(0, -44);
    spike(g, 10.5, 2.9, { m: M.crysV, z: 6 }, 2);
    g.line(0, -1, 0, -6, { em: glow('plasma', 0.55), sp: SP.violet });
    g.restore();
    g.save().tr(0, -47);
    spike(g, 6, 2, { m: M.obs, z: 6 }, 1.5);
    g.restore();
    g.restore();
  }
}

function heartPetal(g) {
  // obsidian blade pointing outward (dir 0 = up); base (inner end) at +v. True obsidian:
  // near-black facets, a thin dim-magenta cutting edge and a single glowing center vein.
  const [V, T] = mirrorMesh(
    [[0, -18.5, 0], [-4.5, -9.5, 0], [-6.8, 2, 0], [-5.5, 10.5, 0], [-2.5, 16, 0], [0, 17.5, 0], [0, -8, 6.5], [0, 9.5, 6]],
    [[0, 1, 6], [1, 2, 6], [2, 7, 6], [2, 3, 7], [3, 4, 7], [4, 5, 7]]);
  gemMesh(g, V, T, { m: M.obsD, z: 3 });
  g.sym(() => g.polyline([[0, -18], [-4.3, -9.5], [-6.5, 2], [-5.3, 9.5]], { em: glow('magenta', 0.2) }));
  g.line(0, 13, 0, -13, { em: glow('magenta', 0.45), sp: SP.mag });
  // carapace root collar
  g.poly(mirror([[0, 10.5], [-5, 11.5], [-5.5, 15], [-3, 18], [0, 18.3]]), { m: M.car, z: 8, bev: 1.2, bk: 1.3 });
  g.line(-4.5, 14, 4.5, 14, { dt: -2 });
  g.px(0, 16, { em: glow('magenta', 0.6), sp: SP.mag });
}

function heartCore2(g, f) {
  // The exposed singularity: a perfectly round event horizon with a 1-px photon ring, a thin
  // accretion disk crossing in front of it, the far side of the disk lensed into a separate
  // thin arc over the top (1-px dark gap), polar jets, a Doppler hot spot orbiting the disk,
  // all inside a broken ring of Choir crystal. 4 frames: the hot spot laps the disk.
  f &= 3;
  const ph = (f / 4) * TAU;
  const RH = 9.2, DISK_IN = 12, DISK_OUT = 25.5, SQ = 0.17;
  // ---- the broken containment ring (3 breaks) with crystal shards anchored on it
  const breaks = [0.55, 2.75, 4.6];
  g.fill(-30.5, -30.5, 30.5, 30.5, { m: M.car, z: 2 }, (u, v, o) => {
    const r = hyp(u, v);
    if (r < 26.6 || r > 30) return false;
    const a = (Math.atan2(u, -v) + TAU) % TAU;
    for (const b of breaks) { const d = Math.abs(((a - b + Math.PI) % TAU + TAU) % TAU - Math.PI); if (d < 0.16 + 0.03 * Math.sin(r * 3)) return false; }
    const s = (r - 28.3) / 1.7;
    o.nu = (u / r) * s; o.nv = (v / r) * s; o.nz = Math.sqrt(Math.max(0.1, 1 - s * s * 0.8));
    o.z = 2 + 1.5 * o.nz;
    return true;
  });
  for (let k = 0; k < 8; k++) {
    const am = (k / 8) * TAU + TAU / 16;
    g.save().tr(Math.sin(am) * 27.5, -Math.cos(am) * 27.5).rot(am + Math.PI);
    shard(g, 4.5 + (k & 1) * 2.5, 2, { m: k & 1 ? M.crysV : M.crysM, z: 4 });
    g.restore();
    g.px(Math.sin(am) * 28.3, -Math.cos(am) * 28.3, { em: glow('magenta', 0.4) });
  }
  // ---- polar jets (behind everything else inside the cage)
  g.fill(-3, -26, 3, 26, { m: M.dark, z: 1, sp: 0 }, (u, v, o) => {
    const av = Math.abs(v);
    if (av < RH) return false;
    const k = (av - RH) / (26 - RH), wdt = lerp(1.6, 0.4, k);
    if (Math.abs(u) > wdt) return false;
    o.em = glow('plasma', clamp(0.95 - k * 0.6 + (Math.abs(u) < 0.6 ? 0.1 : -0.15), 0.3, 1));
    o.hot = k < 0.25 && Math.abs(u) < 0.6;
    return true;
  });
  // ---- lensed far side of the disk: a thin arc over the top, separated by a dark gap
  g.fill(-14, -14, 14, 1, { m: M.dark, z: 4, sp: 0 }, (u, v, o) => {
    const d = hyp(u, v);
    if (d < RH + 2 || d > RH + 3.6 || v > -1) return false;
    const a = Math.atan2(u, -v);
    const t = (1 - Math.abs(d - (RH + 2.8)) / 1.2) * (0.75 + 0.25 * Math.cos(a * 2 + ph));
    o.em = t > 0.8 ? WHITE : glow('magenta', clamp(0.45 + t * 0.5, 0, 1));
    o.hot = t > 0.8;
    return true;
  });
  // ---- event horizon + photon ring
  g.circ(0, 0, RH, { m: M.abyss, z: 8, t: -9 });
  g.ring(0, 0, RH - 0.9, RH + 0.1, { decal: true, em: glow('plasma', 0.9), sp: 0 });
  // ---- accretion disk: thin tilted ellipse; its back half is hidden behind the horizon
  const hsu = Math.sin(ph) * 18.5, hsv = Math.cos(ph) * 18.5 * SQ;  // Doppler hot spot
  g.fill(-DISK_OUT, -5, DISK_OUT, 5, { m: M.dark, z: 10, sp: SP.mag }, (u, v, o) => {
    const r = hyp(u, v / SQ);
    if (r < DISK_IN || r > DISK_OUT) return false;
    if (v < 0 && hyp(u, v) < RH + 0.2) return false;           // far side: behind the hole
    const k = (r - DISK_IN) / (DISK_OUT - DISK_IN);               // 0 inner .. 1 outer edge
    const a = Math.atan2(v / SQ, u);
    let t = (1 - k) * 0.85 + 0.12 * Math.sin(a * 5 - ph * 2 + r * 0.6);
    if (u < 0) t += 0.12;                                          // approaching side is brighter
    const hs = hyp(u - hsu, (v - hsv) / SQ * 0.6);
    if (hs < 3.2 && (v > 0 || hyp(u, v) > RH + 0.2)) t += (1 - hs / 3.2) * 0.9;
    if (t < 0.12) return false;
    o.em = t > 0.9 ? WHITE : t > 0.62 ? glow('magenta', 0.85) : t > 0.35 ? glow('magenta', 0.6) : glow('plasma', 0.45);
    o.hot = t > 0.9;
    return true;
  });
}

function heartJobs() {
  return [
    ['boss_heart', 63, 63, { frames: 6, fps: 6, over: heartSocket }, heartEye],
    ['boss_heart_halo', 111, 111, { frames: 8, fps: 10, loop: true }, heartHalo],
    ['boss_heart_petal', 41, 41, { dirs: 16, sym: true }, heartPetal],
    ['boss_heart_core2', 63, 63, { frames: 4, fps: 10, loop: true }, heartCore2],
  ];
}

// Boss name -> job list: [spriteName, w, h, buildOptions, drawFn]
const BOSSES = { warden: wardenJobs, wyrm: wyrmJobs, prism: prismJobs, dread: dreadJobs, heart: heartJobs };
Object.assign(BOSS_META, { warden: WARDEN, wyrm: WYRM, prism: PRISM, dread: DREAD, heart: HEART });

// Yield to the event loop without setTimeout's nested-timer clamping (4 ms per hop)
const yieldNow = typeof MessageChannel !== 'undefined'
  ? () => new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); r(); }; ch.port2.postMessage(0); })
  : () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------

/**
 * Generate boss sprite defs (registerSprite shape) for every boss, or only `opt.bosses`
 * (e.g. { bosses: ['wyrm'] } to build the next sector's boss lazily).
 * Yields between sprites (and inside long rotated ones) and reports cost-weighted progress 0..1.
 * Dev only: opt.lint = [] collects art-on-frame-border and loop-seam problems.
 */
export async function makeBossArt(onProgress, opt = {}) {
  initMats(); initSpill();
  const names = opt.bosses || Object.keys(BOSSES);
  const jobs = [];
  for (const n of names) {
    if (!BOSSES[n]) throw new Error('makeBossArt: unknown boss ' + n);
    jobs.push(...BOSSES[n]());
  }
  const cost = (j) => j[1] * j[2] * (j[3].frames || 1) * ((j[3].dirs || 1) / (j[3].sym ? 2 : 1)) * (j[3].fx ? 0.6 : 1) + 2000;
  const total = jobs.reduce((a, j) => a + cost(j), 0);
  const out = {};
  let done = 0;
  for (const j of jobs) {
    const it = build(j[0], j[1], j[2], opt.lint ? { ...j[3], lint: opt.lint } : j[3], j[4]);
    let r;
    while (!(r = it.next()).done) {
      if (onProgress) onProgress(Math.min(1, (done + cost(j) * r.value) / total));
      await yieldNow();
    }
    out[j[0]] = r.value;
    if (j[0] === 'boss_dread_hatch' && out.boss_dread) out.boss_dread_shadow = dreadShadow(out.boss_dread, out.boss_dread_cannon);
    done += cost(j);
    if (onProgress) onProgress(Math.min(1, done / total));
    await yieldNow();
  }
  return out;
}

/** Generate every boss sprite and register it with sprites.js. Returns the defs. */
export async function buildBossArt(onProgress, opt = {}) {
  const { registerSprite } = await import('./sprites.js');
  const defs = await makeBossArt(onProgress, opt);
  for (const name in defs) registerSprite(name, defs[name]);
  return defs;
}
