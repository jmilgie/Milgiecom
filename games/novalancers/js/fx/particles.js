// Nova Lancers — FX system (DESIGN.md §7): explosions, sparks, smoke, debris, shockwaves,
// nova bombs, beams, floating text and the post-fx state (distortion waves / flash / chroma).
//
// Look
//  * MAIN layer is pixel-exact: pre-rendered, Bayer-dithered flipbooks and sprites drawn 1:1
//    at integer positions, or pixel-run rect paths (rings, lightning, beams). No soft
//    gradients here.
//  * LIGHT layer gets everything soft (radial glows, anamorphic flare streaks, beam haloes).
//    post.js adds it on top of MAIN and blooms it; the 2D fallback blends it with 'lighter'.
//
// Performance
//  * Typed-array pools per particle kind (stable order, 1500 particles total), one atlas
//    canvas per palette so each kind batches from a single texture.
//  * Zero allocations per frame in steady state (postState() reuses its objects).
//  * All coordinates are FIELD coordinates; draw() expects ctx/lctx translated to the field.

import { RAMPS } from '../art/palette.js';

const TAU = Math.PI * 2;
const DRIFT = 9;            // px/s: lingering smoke/debris slides down as the squadron flies on
const NOVA_T = 1.25;        // nova duration (s)
const MAX_WAVES = 8;        // distortion waves handed to post.js

// ---------------------------------------------------------------------------------------
// RNG (xorshift32). `rnd` drives spawning; `brnd` is a separate stream for flickering
// geometry that is regenerated every few frames inside draw().
// ---------------------------------------------------------------------------------------
let _rs = 0x2545f491;
function rnd() { let s = _rs; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; _rs = s; return (s >>> 0) * 2.3283064365386963e-10; }
function rr(a, b) { return a + (b - a) * rnd(); }
function reseed(n) { _rs = (Math.imul((n | 0) ^ 0x5bd1e995, 2654435761) ^ 0x9e3779b9) | 0 || 1; rnd(); rnd(); }
let _bs = 1;
function brnd() { let s = _bs; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; _bs = s; return (s >>> 0) * 2.3283064365386963e-10; }
function bseed(n) { _bs = (Math.imul((n | 0) ^ 0x68e31da4, 2246822519) ^ 0x1b873593) | 0 || 1; brnd(); brnd(); }

// ---------------------------------------------------------------------------------------
// Palettes: every palette is an 8-step ramp dark -> white.
// ---------------------------------------------------------------------------------------
const PAL_NAMES = ['fire', 'magenta', 'crystal', 'ember', 'plasma', 'cyan', 'gold', 'lime', 'violet', 'white', 'emerald', 'sapphire'];
const NPAL = PAL_NAMES.length;
const P_FIRE = 0, P_MAG = 1, P_CRY = 2, P_EMB = 3, P_PLA = 4, P_TEAM = 5, P_GOLD = 6, P_WHITE = 9;
const PAL_IDX = Object.create(null);
PAL_NAMES.forEach((n, i) => { PAL_IDX[n] = i; });
Object.assign(PAL_IDX, {
  steel: 9, orange: 3, pink: 1, teal: 2, purple: 4, blue: 11, green: 10,
  team0: 5, team1: 6, team2: 7, team3: 8,
});
function palOf(p) {
  if (typeof p === 'number') return P_TEAM + ((p | 0) & 3);
  if (typeof p === 'string') { const i = PAL_IDX[p]; if (i !== undefined) return i; }
  return P_FIRE;
}

const R6 = (dark, r) => [dark, ...r, '#ffffff'];
const RAMP8 = [
  RAMPS.fire.slice(),
  R6('#170510', RAMPS.magenta),
  R6('#031312', RAMPS.crystal),
  R6('#1a0806', RAMPS.ember),
  R6('#0f0419', RAMPS.plasma),
  R6('#031220', RAMPS.cyan),
  R6('#1c0e02', RAMPS.gold),
  R6('#071606', RAMPS.lime),
  R6('#0f0822', RAMPS.violet),
  ['#141a28', '#36425f', '#526283', '#7c8fb3', '#aebfdc', '#dfe8f7', '#f4f8ff', '#ffffff'],
  R6('#03170e', RAMPS.emerald),
  R6('#050c26', RAMPS.sapphire),
];
const CSTR = RAMP8;   // hex strings usable directly as fillStyle (no per-frame string building)

function hex2(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function packRGBA(r, g, b, a) { return (((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0; }
function packHex(h, a = 255) { const c = hex2(h); return packRGBA(c[0], c[1], c[2], a); }
function mixHex(a, b, t) {
  const A = hex2(a), B = hex2(b);
  return '#' + [0, 1, 2].map((i) => Math.round(A[i] + (B[i] - A[i]) * t).toString(16).padStart(2, '0')).join('');
}

// smoke tint per palette (smoke ramp pulled toward the palette's darks)
const SMOKE_TINT = [0.14, 0.34, 0.28, 0.22, 0.32, 0.2, 0.18, 0.18, 0.24, 0.06, 0.22, 0.22];
const SMOKE6 = RAMP8.map((r, p) => RAMPS.smoke.map((c, i) => mixHex(c, r[1 + (i >> 1)], SMOKE_TINT[p])));

function debrisRamp(p) {
  const S = RAMPS.steel, K = RAMPS.carapace, Cr = RAMPS.crystal, Ru = RAMPS.rust, H = RAMPS.hull;
  if (p === P_MAG || p === P_PLA) return [K[0], K[2], K[3], K[5], K[6]];
  if (p === P_CRY) return [Cr[0], Cr[1], Cr[3], Cr[4], Cr[5]];
  if (p === P_EMB) return [Ru[0], Ru[2], Ru[3], Ru[5], Ru[6]];
  if ((p >= P_TEAM && p < P_TEAM + 4) || p === P_WHITE) return [S[0], S[2], S[3], S[5], S[6]];
  return [H[0], H[2], H[3], H[5], H[6]];
}

// light colour (0..1 floats) per palette, for screen flashes
const LIGHT_RGB = RAMP8.map((r) => hex2(r[6]).map((v) => v / 255));
const WHITE_RGB = [1, 1, 1];

// ---------------------------------------------------------------------------------------
// Noise (value noise + fbm) for the procedural flipbooks
// ---------------------------------------------------------------------------------------
function makeNoise(seed) {
  const perm = new Uint8Array(512), val = new Float32Array(256);
  let s = seed >>> 0 || 1;
  const r = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  for (let i = 0; i < 256; i++) { perm[i] = i; val[i] = r(); }
  for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const n2 = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = val[perm[X + perm[Y]]], b = val[perm[X + 1 + perm[Y]]];
    const c = val[perm[X + perm[Y + 1]]], d = val[perm[X + 1 + perm[Y + 1]]];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x, y) => n2(x, y) * 0.5 + n2(x * 2.03 + 17.1, y * 2.03 + 3.7) * 0.3 + n2(x * 4.1 + 5.3, y * 4.1 + 11.9) * 0.2;
}
// stretch fbm (which clusters around 0.5) toward a flatter 0..1 distribution
function st(v) { v = (v - 0.5) * 2.3 + 0.5; return v < 0 ? 0 : v > 1 ? 1 : v; }
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bay = (x, y) => (BAYER[((y & 3) << 2) | (x & 3)] + 0.5) / 16;   // 0..1

// ---------------------------------------------------------------------------------------
// Pre-rendered art. Atlas layouts are palette-independent: pixel INDEX buffers are built
// once, then colourised per palette through a small LUT.
//   index 1..8   -> RAMP8[p][0..7]
//   index 9..14  -> SMOKE6[p][0..5]
//   index 16..20 -> debris material ramp, 21 -> debris hot pixel
// ---------------------------------------------------------------------------------------
// fireball flipbooks: [size, frames, variants]
const FB = [[12, 10, 4], [20, 12, 4], [30, 12, 4], [44, 14, 2], [64, 15, 2]];
const FB_T = [0.36, 0.5, 0.66, 0.86, 1.08];              // natural lifetimes (s)
// smoke puffs
const SMK = [[7, 10, 4], [11, 10, 4], [17, 11, 4], [25, 12, 4]];
// spark streak lengths
const SPL = new Int8Array([1, 2, 3, 4, 5, 7]);
const LEN_IDX = new Uint8Array([0, 0, 1, 2, 3, 4, 4, 5]);
const K16 = 16 / TAU;
const SB = 41, SB_F = 7;                                  // starburst flare
const DOT_C = 7;                                          // dot cell size
const GC = 66;                                            // glow atlas cell pitch

const FBX = new Int16Array(20), FBY = new Int16Array(20);
const SMX = new Int16Array(16), SMY = new Int16Array(16);
const SPX = new Int16Array(6), SPY = new Int16Array(6);
const POS = { db: [0, 0], dot: [0, 0], mz: [0, 0], im: [0, 0], sb: [0, 0], rp: [0, 0] };
// flare sprite table, indexed by flare type (muzzle, impact, starburst +, starburst x)
const FL_X = new Int16Array(4), FL_Y = new Int16Array(4);
const FL_W = new Int16Array([9, 7, 41, 41]), FL_H = new Int16Array([11, 7, 41, 41]);
const FL_AX = new Int16Array([4, 3, 20, 20]), FL_AY = new Int16Array([7, 3, 20, 20]), FL_F = new Int16Array([3, 3, 7, 7]);

// dot shapes (cell 7x7 around 3,3): [dx, dy, level]; level darkens the colour
const DOTS = (() => {
  const plus = [[0, 0, 0], [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1]];
  const star5 = plus.concat([[2, 0, 2], [-2, 0, 2], [0, 2, 2], [0, -2, 2]]);
  const star7 = star5.concat([[3, 0, 3], [-3, 0, 3], [0, 3, 3], [0, -3, 3], [1, 1, 3], [-1, 1, 3], [1, -1, 3], [-1, -1, 3]]);
  const disk = (r) => {
    const out = [];
    for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) {
      const d = Math.sqrt(x * x + y * y);
      if (d <= r) out.push([x, y, d < r * 0.4 ? 0 : d < r * 0.75 ? 1 : 2]);
    }
    return out;
  };
  return [
    [[0, 0, 0]],                                   // 0 px1
    [[0, 0, 0], [1, 0, 1], [0, 1, 1], [1, 1, 2]],  // 1 px2
    plus,                                          // 2 plus3
    star5,                                         // 3 star5
    star7,                                         // 4 star7
    plus.concat([[1, 1, 2], [-1, 1, 2], [1, -1, 2], [-1, -1, 2]]), // 5 disk3
    disk(2.3),                                     // 6 disk5
    disk(3.2),                                     // 7 disk7
  ];
})();
const SHR = [0, 1, 5, 6, 7];                       // trail puff shrink sequence (small -> big)

const IMPACT = [
  [[0, 0, 7], [1, 0, 7], [-1, 0, 7], [0, 1, 7], [0, -1, 7], [2, 0, 6], [-2, 0, 6], [0, 2, 6], [0, -2, 6],
    [3, 0, 4], [-3, 0, 4], [0, 3, 4], [0, -3, 4], [1, 1, 5], [-1, 1, 5], [1, -1, 5], [-1, -1, 5]],
  [[0, 0, 7], [1, 0, 6], [-1, 0, 6], [0, 1, 6], [0, -1, 6], [2, 0, 4], [-2, 0, 4], [0, 2, 4], [0, -2, 4],
    [2, 2, 4], [-2, 2, 4], [2, -2, 4], [-2, -2, 4]],
  [[0, 0, 6], [3, 0, 3], [-3, 0, 3], [0, 3, 3], [0, -3, 3], [2, 2, 3], [-2, -2, 3], [2, -2, 3], [-2, 2, 3]],
];

function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
// Atlases are static: keep them CPU-backed so drawing them into a canvas of either kind
// (GPU- or CPU-backed target) never forces a per-call GPU readback; GPU targets cache the upload.
function ctx2d(c) { return c.getContext('2d', { willReadFrequently: true }) || c.getContext('2d'); }

// first-fit shelf packer; sets b.x / b.y, returns atlas size
function pack(blocks, maxW) {
  const order = blocks.map((_, i) => i).sort((a, b) => blocks[b].h - blocks[a].h || blocks[b].w - blocks[a].w);
  const shelves = [];
  let H = 0, W = 0;
  for (const i of order) {
    const b = blocks[i];
    let sh = shelves.find((s) => s.h >= b.h && s.x + b.w <= maxW);
    if (!sh) { sh = { y: H, h: b.h, x: 0 }; shelves.push(sh); H += b.h + 1; }
    b.x = sh.x; b.y = sh.y; sh.x += b.w + 1;
    if (sh.x > W) W = sh.x;
  }
  return { w: W, h: H };
}

// Billowy "cauliflower" structure: a few overlapping lobes; each pixel belongs to the lobe
// with the strongest field and takes that lobe's top-left lighting, so lobes read as puffs.
function makeLobes(seed, n, spread, rmin, rmax) {
  let s = (Math.imul(seed + 1, 0x9e3779b1) | 0) || 1;
  const r = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  const L = [0, 0, rmax * 1.3];
  for (let i = 0; i < n; i++) {
    const a = r() * TAU, d = spread * (0.35 + 0.65 * Math.sqrt(r()));
    L.push(Math.cos(a) * d, Math.sin(a) * d, rmin + (rmax - rmin) * r());
  }
  return new Float32Array(L);
}
const LB = { q: 0, lx: 0, ly: 0 };
function lobeAt(L, dx, dy, spread, size) {
  let best = -9, lx = 0, ly = 0;
  for (let i = 0; i < L.length; i += 3) {
    const rr = L[i + 2] * size, ex = (dx - L[i] * spread) / rr, ey = (dy - L[i + 1] * spread) / rr;
    const q = 1 - Math.sqrt(ex * ex + ey * ey);
    if (q > best) { best = q; lx = ex; ly = ey; }
  }
  LB.q = best; LB.lx = lx; LB.ly = ly;
}

function genFire(S, F, k, fbm) {
  const out = new Uint8Array(S * S * F), R = S / 2;
  const ox = 3.1 + k * 19.7, oy = 7.9 + k * 11.3;
  const lobes = makeLobes(k * 31 + S, S >= 30 ? 11 : S >= 20 ? 8 : 4, 0.5, 0.24, 0.44);
  for (let f = 0; f < F; f++) {
    const u = f / (F - 1);
    const grow = 0.28 + 0.72 * (1 - Math.pow(1 - Math.min(1, u / 0.52), 2.2));
    const temp = Math.pow(1 - u, 0.85);
    const hole = u > 0.4 ? (u - 0.4) / 0.6 : 0;
    const spread = grow * (1 + 0.3 * u);
    const fo = f * S * S;
    for (let y = 0; y < S; y++) {
      const dy = (y + 0.5 - R) / R;
      for (let x = 0; x < S; x++) {
        const dx = (x + 0.5 - R) / R;
        if (dx * dx + dy * dy > 1.02) continue;
        lobeAt(lobes, dx, dy, spread, grow);
        const n1 = st(fbm((dx / grow) * 2.4 + ox, (dy / grow) * 2.4 + oy - u * 0.5));
        const q = LB.q + (n1 - 0.5) * 0.32;
        if (q <= 0) continue;
        if (hole > 0) {
          const n3 = st(fbm((dx / grow) * 2.1 + ox + 57, (dy / grow) * 2.1 + oy + 73 + u * 0.3));
          if (n3 * 0.8 + Math.min(1, q * 3) * 0.2 < hole * 1.05) continue;
        }
        const rel = Math.sqrt(dx * dx + dy * dy) / grow;
        const lit = -LB.lx * 0.55 - LB.ly * 0.7;
        const rim = Math.min(1, q * 3.2);
        const n2 = st(fbm(dx * 4.1 + ox + 31, dy * 4.1 + oy + 17));
        const heat = temp * (0.97 - 0.55 * rel * rel) + lit * 0.3 * (0.35 + 0.65 * temp)
          - (1 - rim) * 0.24 + (n2 - 0.5) * 0.12 - u * 0.08;
        let id = Math.floor(heat * 7 + (bay(x, y) - 0.5) * 0.7 + 0.5);
        if (id > 7) id = 7;
        if (id < 1) { if (u < 0.45) id = 1; else if (id < 0) continue; else id = 0; }
        out[fo + y * S + x] = id + 1;
      }
    }
  }
  return out;
}

function genSmoke(S, F, k, fbm) {
  const out = new Uint8Array(S * S * F), R = S / 2;
  const ox = 41.3 + k * 23.9, oy = 5.1 + k * 17.7;
  const lobes = makeLobes(k * 17 + S * 3 + 5, S >= 17 ? 6 : 4, 0.38, 0.32, 0.55);
  for (let f = 0; f < F; f++) {
    const u = f / (F - 1);
    const grow = 0.55 + 0.45 * (1 - (1 - u) * (1 - u));
    const spread = grow * (1 + 0.25 * u);
    const fo = f * S * S;
    for (let y = 0; y < S; y++) {
      const dy = (y + 0.5 - R) / R;
      for (let x = 0; x < S; x++) {
        const dx = (x + 0.5 - R) / R;
        if (dx * dx + dy * dy > 1.02) continue;
        lobeAt(lobes, dx, dy, spread, grow);
        const n1 = st(fbm((dx / grow) * 2.2 + ox, (dy / grow) * 2.2 + oy));
        const q = LB.q + (n1 - 0.5) * 0.3;
        if (q <= 0) continue;
        const b = bay(x, y);
        const n3 = st(fbm((dx / grow) * 2.6 + ox + 61, (dy / grow) * 2.6 + oy + 5 + u * 0.5));
        if (n3 * 0.7 + b * 0.3 < (u - 0.2) * 1.3 + (1 - Math.min(1, q * 3)) * 0.3 * u) continue;
        const lit = -LB.lx * 0.6 - LB.ly * 0.75;
        const rim = Math.min(1, q * 3);
        const shade = 0.36 + 0.3 * lit - (1 - rim) * 0.14 - u * 0.14;
        let id = Math.floor(shade * 5.5 + (b - 0.5) * 0.6 + 0.5);
        if (id < 0) id = 0; else if (id > 5) id = 5;
        out[fo + y * S + x] = id + 1;
      }
    }
  }
  return out;
}

function blitMap(idx, W, bx, by, map, S, F, flip, base) {
  for (let f = 0; f < F; f++) {
    for (let y = 0; y < S; y++) {
      const sy = flip & 2 ? S - 1 - y : y;
      const row = (by + y) * W + bx + f * S, src = f * S * S + sy * S;
      for (let x = 0; x < S; x++) {
        const v = map[src + (flip & 1 ? S - 1 - x : x)];
        if (v) idx[row + x] = base + v;
      }
    }
  }
}

function linePts(x0, y0, x1, y1, px, py) {
  px.length = 0; py.length = 0;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0;
  for (;;) {
    px.push(x); py.push(y);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

function writeSparks(idx, W, bx, by, L) {
  const c = 2 * L + 1, px = [], py = [];
  for (let d = 0; d < 16; d++) {
    const th = (d / 16) * TAU;
    linePts(0, 0, Math.round(-Math.cos(th) * L), Math.round(-Math.sin(th) * L), px, py);
    const n = px.length - 1;
    for (let h = 0; h < 4; h++) {
      for (let k = 0; k <= n; k++) {
        let ci = k === 0 ? 7 - h : 7 - h - 1 - Math.floor(((k - 1) * 3) / Math.max(1, n));
        if (ci < 2) ci = 2;
        idx[(by + h * c + L + py[k]) * W + bx + d * c + L + px[k]] = ci + 1;
      }
    }
  }
}

function writeDots(idx, W, bx, by) {
  DOTS.forEach((shape, s) => {
    for (let h = 0; h < 4; h++) {
      for (const [dx, dy, lv] of shape) {
        const ci = Math.max(1, 7 - h - lv);
        idx[(by + h * DOT_C + 3 + dy) * W + bx + s * DOT_C + 3 + dx] = ci + 1;
      }
    }
  });
}

function writeMuzzle(idx, W, bx, by) {      // 3 frames of 9x11, anchor (4, 7), pointing up
  const sc = [1, 0.7, 0.42];
  for (let fr = 0; fr < 3; fr++) {
    const s = sc[fr];
    for (let y = 0; y < 11; y++) {
      for (let x = 0; x < 9; x++) {
        const dx = x - 4, dy = y - 7;
        const ax = Math.abs(dx) / (3.3 * s + 0.35);
        const ay = dy < 0 ? -dy / (7.2 * s + 0.4) : dy / (2.4 * s + 0.4);
        const r = Math.sqrt(ax * ax + ay * ay);
        if (r >= 1) continue;
        if (r > 0.78 && bay(x, y) > 0.55) continue;
        let ci = r < 0.3 ? 7 : r < 0.6 ? 6 : 5;
        if (fr === 2) ci--;
        idx[(by + y) * W + bx + fr * 9 + x] = ci + 1;
      }
    }
  }
}

function writeImpact(idx, W, bx, by) {      // 3 frames of 7x7
  IMPACT.forEach((fr, f) => { for (const [dx, dy, ci] of fr) idx[(by + 3 + dy) * W + bx + f * 7 + 3 + dx] = ci + 1; });
}

function writeStarburst(idx, W, bx, by) {  // 2 variants (+, x) x 7 frames of 41x41
  const SL = [12, 20, 18, 15, 11, 7, 4], SC = [5.5, 5, 4, 3, 2.2, 1.5, 1];
  const spike = (a, b, L) => {
    if (a >= L) return 0;
    const t = 1 - a / L;
    return b > t * 1.3 ? 0 : t * (b < 0.5 ? 1 : 0.7);
  };
  const dspike = (ax, ay, L) => spike((ax + ay) * 0.7071, Math.abs(ax - ay) * 0.7071, L);
  const c = (SB - 1) / 2;
  for (let v = 0; v < 2; v++) {
    for (let f = 0; f < SB_F; f++) {
      const L = SL[f], Ld = L * 0.5, core = SC[f];
      for (let y = 0; y < SB; y++) {
        for (let x = 0; x < SB; x++) {
          const dx = x - c, dy = y - c, ax = Math.abs(dx), ay = Math.abs(dy);
          let I = v === 0
            ? Math.max(spike(ax, ay, L), spike(ay, ax, L), dspike(ax, ay, Ld) * 0.8)
            : Math.max(dspike(ax, ay, L * 0.85), spike(ax, ay, Ld) * 0.8, spike(ay, ax, Ld) * 0.8);
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < core) I = 1.2; else if (d < core + 1.2) I = Math.max(I, 0.72);
          if (I <= 0) continue;
          if (I < 0.2 && bay(x, y) > I * 5) continue;
          let ci = I >= 1 ? 7 : I > 0.62 ? 6 : I > 0.36 ? 5 : 4;
          if (f >= 5) ci = Math.max(4, ci - 1);
          idx[(by + v * SB + y) * W + bx + f * SB + x] = ci + 1;
        }
      }
    }
  }
}

function writeRipple(idx, W, bx, by) {     // beam edge flames: 8 frames x 4px, right then left (mirrored)
  for (let f = 0; f < 8; f++) {
    const ph = f / 8;
    for (let y = 0; y < 64; y++) {
      const a = 0.6
        + 1.1 * (0.5 + 0.5 * Math.sin(TAU * (y / 16 - ph)))
        + 0.9 * (0.5 + 0.5 * Math.sin(TAU * (y / 32 + 2 * ph) + 1.7))
        + 0.7 * (0.5 + 0.5 * Math.sin(TAU * (y / 8 - 3 * ph) + 0.6));
      for (let x = 0; x < 4; x++) {
        let ci = 0;
        if (x + 1 <= a) ci = x === 0 ? 4 : 3;
        else if (x < a && a - x > bay(x, y)) ci = 2;
        if (!ci) continue;
        idx[(by + y) * W + bx + f * 4 + x] = ci + 1;
        idx[(by + y) * W + bx + 32 + f * 4 + (3 - x)] = ci + 1;
      }
    }
  }
}

function writeDebris(idx, W, bx, by) {     // 6 shapes x 8 rotations of 9x9
  let s = 0x1234567;
  const r = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  const mask = new Uint8Array(81);
  const inPoly = (x, y, vx, vy) => {
    let c = false;
    for (let i = 0, j = vx.length - 1; i < vx.length; j = i++) {
      if ((vy[i] > y) !== (vy[j] > y) && x < ((vx[j] - vx[i]) * (y - vy[i])) / (vy[j] - vy[i]) + vx[i]) c = !c;
    }
    return c;
  };
  for (let sh = 0; sh < 6; sh++) {
    const nv = 3 + (sh % 3), base = sh < 2 ? 1.8 : sh < 4 ? 2.5 : 3.4;
    const vx = [], vy = [];
    for (let k = 0; k < nv; k++) {
      const a = (k / nv) * TAU + (r() - 0.5) * 0.9, rad = base * (0.7 + r() * 0.5);
      vx.push(Math.cos(a) * rad); vy.push(Math.sin(a) * rad);
    }
    for (let rot = 0; rot < 8; rot++) {
      const ang = (rot / 8) * TAU, ca = Math.cos(ang), sa = Math.sin(ang);
      mask.fill(0);
      let any = false;
      for (let y = 0; y < 9; y++) {
        for (let x = 0; x < 9; x++) {
          const px = x + 0.5 - 4.5, py = y + 0.5 - 4.5;
          if (inPoly(px * ca + py * sa, -px * sa + py * ca, vx, vy)) { mask[y * 9 + x] = 1; any = true; }
        }
      }
      if (!any) mask[40] = 1;
      let hot = -1, hs = -1;
      const M = (x, y) => x >= 0 && y >= 0 && x < 9 && y < 9 && mask[y * 9 + x];
      for (let y = 0; y < 9; y++) {
        for (let x = 0; x < 9; x++) {
          if (!mask[y * 9 + x]) continue;
          const up = M(x, y - 1), lf = M(x - 1, y), dn = M(x, y + 1), rt = M(x + 1, y);
          let lv = 3;
          if (!up && !lf) lv = 5; else if (!up || !lf) lv = 4; else if (!dn && !rt) lv = 1; else if (!dn || !rt) lv = 2;
          idx[(by + sh * 9 + y) * W + bx + rot * 9 + x] = 15 + lv;
          if ((!dn || !rt) && x + y > hs) { hs = x + y; hot = y * 9 + x; }
        }
      }
      if (hot >= 0 && sh % 2 === 0) idx[(by + sh * 9 + ((hot / 9) | 0)) * W + bx + rot * 9 + (hot % 9)] = 21;
    }
  }
}

// Fireball heat -> ramp step. Fire/ember ramps are true temperature ramps; the energy
// palettes have pastel top ends, so their billows are pushed one step deeper.
const FIRE_SHIFT = [0, 1, 1, 2, 3, 4, 5, 7];
function makeLut(p, ex) {
  const lut = new Uint32Array(32);
  const r8 = RAMP8[p], s6 = SMOKE6[p], d = debrisRamp(p);
  const shift = ex && p !== P_FIRE && p !== P_EMB;
  for (let i = 0; i < 8; i++) lut[1 + i] = packHex(r8[shift ? FIRE_SHIFT[i] : i]);
  for (let i = 0; i < 6; i++) lut[9 + i] = packHex(s6[i]);
  for (let i = 0; i < 5; i++) lut[16 + i] = packHex(d[i]);
  lut[21] = packHex(r8[5]);
  return lut;
}

function paint(idx, w, h, lut) {
  const c = mkCanvas(w, h), g = ctx2d(c);
  const img = g.createImageData(w, h);
  const px = new Uint32Array(img.data.buffer);
  for (let i = 0; i < idx.length; i++) px[i] = lut[idx[i]];
  g.putImageData(img, 0, 0);
  return c;
}

function buildGlow() {
  const W = NPAL * GC, H = GC * 2 + 12;
  const c = mkCanvas(W, H), g = ctx2d(c);
  const img = g.createImageData(W, H), d = img.data;
  const put = (x, y, rgb, a) => {
    const o = (y * W + x) * 4;
    d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
  };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const WH = [255, 255, 255];
  for (let p = 0; p < NPAL; p++) {
    const c1 = hex2(RAMP8[p][6]), c2 = hex2(RAMP8[p][5]), c3 = hex2(RAMP8[p][4]);
    const ox = p * GC;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const dx = (x + 0.5 - 32) / 32, dy = (y + 0.5 - 32) / 32, r2 = dx * dx + dy * dy;
        if (r2 >= 1) continue;
        const fade = (1 - r2) * (1 - r2);
        // hot: white core, saturated halo
        const core = Math.exp(-r2 * 38), mid = Math.exp(-r2 * 8) * 0.75, out = Math.exp(-r2 * 2.6) * 0.5;
        const sum = core + mid + out + 1e-6;
        let rgb = mix(c3, c2, mid / (mid + out + 1e-6));
        rgb = mix(rgb, WH, core / sum);
        put(ox + x, y, rgb, Math.min(1, sum) * fade);
        // soft: plain coloured halo
        put(ox + x, GC + y, mix(c2, c3, Math.sqrt(r2)), Math.exp(-r2 * 3.2) * fade * 0.85);
      }
    }
    // beam cross-section strips (3 identical rows each; draw from the middle row)
    for (let x = 0; x < 32; x++) {
      const s = (x + 0.5 - 16) / 16, s2 = s * s;
      const body = Math.exp(-s2 * 4.5) * (1 - s2);
      const core = Math.exp(-s2 * 16) * (1 - s2);
      for (let k = 0; k < 3; k++) {
        put(ox + x, GC * 2 + 1 + k, mix(c3, c2, body), body);
        put(ox + x, GC * 2 + 6 + k, mix(WH, c1, 0.35), core);
      }
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}
const STRIP_BODY_Y = GC * 2 + 2, STRIP_CORE_Y = GC * 2 + 7;

let ART = null;
function buildArt() {
  if (ART) return ART;
  const fbm = makeNoise(0x5eed);

  // explosion atlas: fire + smoke + debris
  const exB = [];
  FB.forEach(([S, F, V], si) => { for (let v = 0; v < V; v++) exB.push({ w: S * F, h: S, k: 0, si, v }); });
  SMK.forEach(([S, F, V], si) => { for (let v = 0; v < V; v++) exB.push({ w: S * F, h: S, k: 1, si, v }); });
  exB.push({ w: 72, h: 54, k: 2 });
  const exL = pack(exB, 1024);
  const exIdx = new Uint8Array(exL.w * exL.h);
  const fireMaps = FB.map(([S, F, V], si) => (V > 2 ? [genFire(S, F, si * 2, fbm), genFire(S, F, si * 2 + 1, fbm)] : [genFire(S, F, si * 2, fbm)]));
  const smokeMaps = SMK.map(([S, F], si) => [genSmoke(S, F, si * 2, fbm), genSmoke(S, F, si * 2 + 1, fbm)]);
  for (const b of exB) {
    if (b.k === 0) {
      const [S, F, V] = FB[b.si];
      FBX[b.si * 4 + b.v] = b.x; FBY[b.si * 4 + b.v] = b.y;
      const maps = fireMaps[b.si];
      const map = V > 2 ? maps[b.v & 1] : maps[0];
      const flip = V > 2 ? [0, 0, 1, 3][b.v] : [0, 1][b.v];
      blitMap(exIdx, exL.w, b.x, b.y, map, S, F, flip, 0);
    } else if (b.k === 1) {
      const [S, F] = SMK[b.si];
      SMX[b.si * 4 + b.v] = b.x; SMY[b.si * 4 + b.v] = b.y;
      blitMap(exIdx, exL.w, b.x, b.y, smokeMaps[b.si][b.v & 1], S, F, [0, 0, 1, 3][b.v], 8);
    } else {
      POS.db[0] = b.x; POS.db[1] = b.y;
      writeDebris(exIdx, exL.w, b.x, b.y);
    }
  }

  // spark atlas: streaks, dots, flares, beam ripples
  const spB = [];
  Array.from(SPL).forEach((L, li) => spB.push({ w: 16 * (2 * L + 1), h: 4 * (2 * L + 1), k: 0, li }));
  spB.push({ w: DOTS.length * DOT_C, h: 4 * DOT_C, k: 1 });
  spB.push({ w: 27, h: 11, k: 2 });
  spB.push({ w: 21, h: 7, k: 3 });
  spB.push({ w: SB_F * SB, h: 2 * SB, k: 4 });
  spB.push({ w: 64, h: 64, k: 5 });
  const spL = pack(spB, 512);
  const spIdx = new Uint8Array(spL.w * spL.h);
  for (const b of spB) {
    if (b.k === 0) { SPX[b.li] = b.x; SPY[b.li] = b.y; writeSparks(spIdx, spL.w, b.x, b.y, SPL[b.li]); }
    else if (b.k === 1) { POS.dot[0] = b.x; POS.dot[1] = b.y; writeDots(spIdx, spL.w, b.x, b.y); }
    else if (b.k === 2) { POS.mz[0] = b.x; POS.mz[1] = b.y; writeMuzzle(spIdx, spL.w, b.x, b.y); }
    else if (b.k === 3) { POS.im[0] = b.x; POS.im[1] = b.y; writeImpact(spIdx, spL.w, b.x, b.y); }
    else if (b.k === 4) { POS.sb[0] = b.x; POS.sb[1] = b.y; writeStarburst(spIdx, spL.w, b.x, b.y); }
    else { POS.rp[0] = b.x; POS.rp[1] = b.y; writeRipple(spIdx, spL.w, b.x, b.y); }
  }

  FL_X[0] = POS.mz[0]; FL_Y[0] = POS.mz[1]; FL_X[1] = POS.im[0]; FL_Y[1] = POS.im[1];
  FL_X[2] = FL_X[3] = POS.sb[0]; FL_Y[2] = POS.sb[1]; FL_Y[3] = POS.sb[1] + SB;
  const luts = RAMP8.map((_, p) => makeLut(p, false));
  const exLuts = RAMP8.map((_, p) => makeLut(p, true));
  ART = {
    exIdx, exW: exL.w, exH: exL.h, luts: exLuts,
    ex: new Array(NPAL).fill(null),
    sp: luts.map((lut) => paint(spIdx, spL.w, spL.h, lut)),
    glow: buildGlow(),
  };
  // explosion atlases for the explosion palettes up front; others (team colours...) lazily
  for (let p = 0; p <= P_PLA; p++) ART.ex[p] = paint(exIdx, exL.w, exL.h, exLuts[p]);
  return ART;
}
function exAtlas(p) {
  let c = ART.ex[p];
  if (!c) c = ART.ex[p] = paint(ART.exIdx, ART.exW, ART.exH, ART.luts[p]);
  return c;
}

// ---------------------------------------------------------------------------------------
// Pixel geometry: filled annuli / disks as merged rect runs, and Bresenham lines as runs.
// Works on a CanvasRenderingContext2D path or a Path2D (both have rect()).
// Pixel (cx+i, cy+j) is covered when ri² <= i² + j² < ro²  (centred on a pixel centre).
// ---------------------------------------------------------------------------------------
const CLIP = new Float32Array([-16, -16, 256, 416]);
function emitRect(t, x, y, w, h, clip) {
  if (clip && (x + w < CLIP[0] || x > CLIP[2] || y + h < CLIP[1] || y > CLIP[3])) return;
  t.rect(x, y, w, h);
}
function addAnnulus(t, cx, cy, ro, ri, clip) {
  const ro2 = ro * ro, ri2 = ri > 0 ? ri * ri : 0;
  const J = Math.floor(ro);
  let Lx = 0, Lw = 0, Ly = 0, Lh = 0, Rx = 0, Rw = 0, Ry = 0, Rh = 0;
  for (let j = -J; j <= J + 1; j++) {
    let lx = 0, lw = 0, rx = 0, rw = 0;
    if (j <= J) {
      const A = ro2 - j * j;
      if (A > 0) {
        const m = Math.ceil(Math.sqrt(A)) - 1;
        const B = ri2 - j * j;
        const mi = B > 0 ? Math.ceil(Math.sqrt(B)) - 1 : -1;
        if (m > mi && m >= 0) {
          if (mi < 0) { lx = -m; lw = 2 * m + 1; }
          else { lx = -m; lw = m - mi; rx = mi + 1; rw = m - mi; }
        }
      }
    }
    if (lw && Lh && lx === Lx && lw === Lw) Lh++;
    else { if (Lh) emitRect(t, cx + Lx, cy + Ly, Lw, Lh, clip); Lx = lx; Lw = lw; Ly = j; Lh = lw ? 1 : 0; }
    if (rw && Rh && rx === Rx && rw === Rw) Rh++;
    else { if (Rh) emitRect(t, cx + Rx, cy + Ry, Rw, Rh, clip); Rx = rx; Rw = rw; Ry = j; Rh = rw ? 1 : 0; }
  }
}
function addPixLine(t, x0, y0, x1, y1) {   // integer endpoints
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  if (dx >= dy) {
    let e = dx >> 1, y = y0, rs = x0;
    for (let x = x0; ; x += sx) {
      if (x === x1) { t.rect(Math.min(rs, x), y, Math.abs(x - rs) + 1, 1); break; }
      e -= dy;
      if (e < 0) { t.rect(Math.min(rs, x), y, Math.abs(x - rs) + 1, 1); y += sy; e += dx; rs = x + sx; }
    }
  } else {
    let e = dy >> 1, x = x0, rs = y0;
    for (let y = y0; ; y += sy) {
      if (y === y1) { t.rect(x, Math.min(rs, y), 1, Math.abs(y - rs) + 1); break; }
      e -= dx;
      if (e < 0) { t.rect(x, Math.min(rs, y), 1, Math.abs(y - rs) + 1); x += sx; e += dy; rs = y + sy; }
    }
  }
}
// cached ring paths for small radii (key: radius*4 + thickness)
const RING_MAX = 100;
const ringCache = new Array((RING_MAX + 1) * 4).fill(null);
// ri: integer radius, ti: integer thickness 1..4 (ints keep V8 from boxing per call)
function ringFill(g, cx, cy, ri, ti) {
  if (ri <= RING_MAX && typeof Path2D !== 'undefined') {
    const key = ri * 4 + ti - 1;
    let p = ringCache[key];
    if (!p) { p = new Path2D(); addAnnulus(p, 0, 0, ri + 0.5, ri + 0.5 - ti, false); ringCache[key] = p; }
    g.translate(cx, cy); g.fill(p); g.translate(-cx, -cy);
  } else {
    g.beginPath(); addAnnulus(g, cx, cy, ri + 0.5, ri + 0.5 - ti, true); g.fill();
  }
}
const thIdx = (th) => (th < 1.5 ? 1 : th < 2.5 ? 2 : th < 3.5 ? 3 : 4);
function diskFill(g, cx, cy, r) { g.beginPath(); addAnnulus(g, cx, cy, r + 0.5, 0, false); g.fill(); }

// jagged lightning bolt from (x0,y0) outward; pixel=true appends pixel runs, else a polyline
function bolt(g, x0, y0, ang, len, pixel, start) {
  const r0 = start || 3, span = len - r0;
  if (span < 2) return;
  const segs = Math.max(3, Math.min(14, (span / 11) | 0));
  const ca = Math.cos(ang), sa = Math.sin(ang), jag = 2.5 + span * 0.035;
  let px = ((x0 + ca * r0 + 1024.5) | 0) - 1024, py = ((y0 + sa * r0 + 1024.5) | 0) - 1024;
  if (!pixel) g.moveTo(px, py);
  const branchAt = 1 + ((brnd() * (segs - 1)) | 0);
  for (let k = 1; k <= segs; k++) {
    const t = r0 + (k / segs) * span, off = (brnd() - 0.5) * 2 * jag;
    const nx = ((x0 + ca * t - sa * off + 1024.5) | 0) - 1024, ny = ((y0 + sa * t + ca * off + 1024.5) | 0) - 1024;
    if (pixel) addPixLine(g, px, py, nx, ny); else g.lineTo(nx, ny);
    if (k === branchAt) {
      const ba = ang + (brnd() < 0.5 ? -0.7 : 0.7), bl = span * 0.18;
      const bx = ((nx + Math.cos(ba) * bl + 1024.5) | 0) - 1024, by = ((ny + Math.sin(ba) * bl + 1024.5) | 0) - 1024;
      const b2 = ba + (brnd() - 0.5);
      const bx2 = ((bx + Math.cos(b2) * bl * 0.7 + 1024.5) | 0) - 1024, by2 = ((by + Math.sin(b2) * bl * 0.7 + 1024.5) | 0) - 1024;
      if (pixel) { addPixLine(g, nx, ny, bx, by); addPixLine(g, bx, by, bx2, by2); }
      else { g.moveTo(nx, ny); g.lineTo(bx, by); g.lineTo(bx2, by2); g.moveTo(nx, ny); }
    }
    px = nx; py = ny;
  }
}

// ---------------------------------------------------------------------------------------
// Particle pools (structure of arrays)
// ---------------------------------------------------------------------------------------
class Pool {
  constructor(cap) {
    this.cap = cap; this.n = 0;
    const F = () => new Float32Array(cap), U = () => new Uint8Array(cap);
    this.x = F(); this.y = F(); this.vx = F(); this.vy = F(); this.age = F(); this.life = F();
    this.drag = F(); this.grav = F(); this.c = F(); this.a = F(); this.b = F(); this.d = F();
    this.pal = U(); this.s = U(); this.v = U(); this.f = U();
  }
  // claim a slot and reset the common fields; -1 if full
  add(x, y, vx, vy, life, delay) {
    if (this.n >= this.cap) return -1;
    const i = this.n++;
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.age[i] = -delay; this.life[i] = life > 0.001 ? life : 0.001;
    this.drag[i] = 0; this.grav[i] = 0; this.c[i] = 0; this.a[i] = 0; this.b[i] = 0; this.d[i] = 0;
    this.pal[i] = 0; this.s[i] = 0; this.v[i] = 0; this.f[i] = 0;
    return i;
  }
  mv(i, w) {
    this.x[w] = this.x[i]; this.y[w] = this.y[i]; this.vx[w] = this.vx[i]; this.vy[w] = this.vy[i];
    this.age[w] = this.age[i]; this.life[w] = this.life[i]; this.drag[w] = this.drag[i]; this.grav[w] = this.grav[i];
    this.c[w] = this.c[i]; this.a[w] = this.a[i]; this.b[w] = this.b[i]; this.d[w] = this.d[i];
    this.pal[w] = this.pal[i]; this.s[w] = this.s[i]; this.v[w] = this.v[i]; this.f[w] = this.f[i];
  }
  // integrate: drag (1/s), grav (px/s², +y), c = constant drift velocity (+y); stable compaction
  step(dt) {
    const n = this.n;
    let w = 0;
    for (let i = 0; i < n; i++) {
      const age = this.age[i] + dt;
      if (age >= this.life[i]) continue;
      this.age[i] = age;
      if (age > 0) {
        let k = 1 - this.drag[i] * dt;
        if (k < 0) k = 0;
        const vx = this.vx[i] * k, vy = this.vy[i] * k + this.grav[i] * dt;
        this.vx[i] = vx; this.vy[i] = vy;
        this.x[i] += vx * dt; this.y[i] += (vy + this.c[i]) * dt;
      }
      if (w !== i) this.mv(i, w);
      w++;
    }
    this.n = w;
  }
}

// dot flags
const D_TWINKLE = 1, D_GLOW = 2, D_BLINK = 4, D_SHRINK = 8;
// spark flags
const S_GLOW = 1, S_REV = 4;
// glow profiles
const G_HOT = 0, G_SOFT = 1, G_STREAK = 2, G_VSTREAK = 3;
// flare types
const F_MUZZLE = 0, F_IMPACT = 1, F_SB_PLUS = 2, F_SB_X = 3;
// event kinds
const EV_BOOM = 0, EV_BOSS_FINAL = 1, EV_WARP_POP = 2;

const SIZE = { tiny: 0, small: 1, medium: 2, large: 3, huge: 4, boss: 5 };

// explosion recipes (index = size code)
const REC = [
  { glow: 12, glowT: 0.16, fire: 0, nSec: 0, secSpread: 0, secDelay: 0, nSpark: 6, spd: 120, nFast: 0, nDeb: 0, nSmk: 1, smkSi: 0, smkSpread: 2, ringR: 0, ringTh: 0, dist: 0, embers: 3, flash: 0, chroma: 0, sb: 0 },
  { glow: 20, glowT: 0.2, fire: 1, nSec: 2, secSpread: 7, secDelay: 0.12, nSpark: 12, spd: 170, nFast: 2, nDeb: 2, nSmk: 3, smkSi: 1, smkSpread: 5, ringR: 16, ringTh: 1.5, dist: 0.15, embers: 5, flash: 0, chroma: 0, sb: 0 },
  { glow: 34, glowT: 0.26, fire: 2, nSec: 4, secSpread: 12, secDelay: 0.2, nSpark: 22, spd: 220, nFast: 5, nDeb: 5, nSmk: 6, smkSi: 2, smkSpread: 9, ringR: 34, ringTh: 2, dist: 0.4, embers: 9, flash: 0, chroma: 0.06, sb: 1 },
  { glow: 56, glowT: 0.34, fire: 3, nSec: 6, secSpread: 20, secDelay: 0.34, nSpark: 34, spd: 260, nFast: 10, nDeb: 10, nSmk: 10, smkSi: 3, smkSpread: 15, ringR: 58, ringTh: 2.5, dist: 0.65, embers: 14, flash: 0.12, chroma: 0.25, sb: 1 },
  { glow: 90, glowT: 0.44, fire: 4, nSec: 9, secSpread: 32, secDelay: 0.5, nSpark: 50, spd: 300, nFast: 16, nDeb: 16, nSmk: 16, smkSi: 3, smkSpread: 24, ringR: 96, ringTh: 3, dist: 0.95, embers: 24, flash: 0.22, chroma: 0.45, sb: 2 },
];

// ---------------------------------------------------------------------------------------
// Tiny built-in 3x5 font for floating text (fallback when font.js is not wired in)
// ---------------------------------------------------------------------------------------
const GLYPHS = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001111',
  '+': '000010111010000', '-': '000000111000000', x: '000101010101000', '.': '000000000000010', ',': '000000000010100',
  '!': '010010010000010', ':': '000010000010000', '%': '101001010100101', '/': '001001010100100', ' ': '000000000000000',
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111',
};
const GLYPH_KEYS = Object.keys(GLYPHS);
const GLYPH_OF = new Int16Array(128).fill(-1);
GLYPH_KEYS.forEach((k, i) => {
  GLYPH_OF[k.charCodeAt(0)] = i;
  if (k >= 'A' && k <= 'Z' && k !== 'X') GLYPH_OF[k.toLowerCase().charCodeAt(0)] = i;
});
GLYPH_OF['X'.charCodeAt(0)] = GLYPH_KEYS.indexOf('X');
const fontCache = new Map();
function fontAtlas(color) {
  let c = fontCache.get(color);
  if (c) return c;
  if (fontCache.size > 24) fontCache.clear();
  c = mkCanvas(GLYPH_KEYS.length * 5, 7);
  const g = ctx2d(c);
  GLYPH_KEYS.forEach((k, gi) => {
    const bits = GLYPHS[k];
    g.fillStyle = '#05040c';
    for (let i = 0; i < 15; i++) if (bits[i] === '1') g.fillRect(gi * 5 + (i % 3), ((i / 3) | 0), 3, 3);
  });
  g.fillStyle = color;
  GLYPH_KEYS.forEach((k, gi) => {
    const bits = GLYPHS[k];
    for (let i = 0; i < 15; i++) if (bits[i] === '1') g.fillRect(gi * 5 + 1 + (i % 3), 1 + ((i / 3) | 0), 1, 1);
  });
  fontCache.set(color, c);
  return c;
}
function builtinText(ctx, str, x, y, color) {
  const at = fontAtlas(color || '#ffffff');
  const n = str.length, x0 = x - ((n * 4 - 1) >> 1), y0 = y;
  for (let k = 0; k < n; k++) {
    const code = str.charCodeAt(k);
    const gi = code < 128 ? GLYPH_OF[code] : -1;
    if (gi < 0) continue;
    ctx.drawImage(at, gi * 5, 0, 5, 7, x0 + k * 4 - 1, y0 - 1, 5, 7);
  }
}

// ---------------------------------------------------------------------------------------
// createFX
// ---------------------------------------------------------------------------------------
export function createFX() {
  const A = buildArt();
  const SPA = A.sp, GLOW = A.glow;

  const SPK = new Pool(560), DOT = new Pool(420), FIRE = new Pool(100), SMOKE = new Pool(170),
    DEB = new Pool(80), GLW = new Pool(100), FLR = new Pool(70);
  const POOLS = [SPK, DOT, FIRE, SMOKE, DEB, GLW, FLR];

  // shockwave rings
  const RG = 48;
  const rgX = new Float32Array(RG), rgY = new Float32Array(RG), rgR0 = new Float32Array(RG), rgR1 = new Float32Array(RG),
    rgAge = new Float32Array(RG), rgLife = new Float32Array(RG), rgTh = new Float32Array(RG), rgDist = new Float32Array(RG),
    rgPal = new Uint8Array(RG), rgF = new Uint8Array(RG);
  let rgN = 0;
  // novas
  const NV = 4;
  const nvX = new Float32Array(NV), nvY = new Float32Array(NV), nvAge = new Float32Array(NV), nvPal = new Uint8Array(NV), nvSeed = new Int32Array(NV);
  let nvN = 0;
  // lightning bursts
  const BO = 10;
  const boX = new Float32Array(BO), boY = new Float32Array(BO), boAge = new Float32Array(BO), boLife = new Float32Array(BO),
    boR = new Float32Array(BO), boN = new Uint8Array(BO), boPal = new Uint8Array(BO), boSeed = new Int32Array(BO);
  let boN_ = 0;
  // floating texts
  const TX = 32;
  const txX = new Float32Array(TX), txY = new Float32Array(TX), txAge = new Float32Array(TX), txLife = new Float32Array(TX);
  const txStr = new Array(TX).fill(''), txCol = new Array(TX).fill('#ffffff');
  let txN = 0;
  // scheduled events (boss chains, secondary pops, warp pops)
  const EV = 128;
  const evT = new Float32Array(EV), evX = new Float32Array(EV), evY = new Float32Array(EV), evVX = new Float32Array(EV),
    evVY = new Float32Array(EV), evSz = new Uint8Array(EV), evPal = new Uint8Array(EV), evK = new Uint8Array(EV);
  let evN = 0;

  let flashA = 0, flashR = 1, flashG = 1, flashB = 1, chromaA = 0;
  let frameNo = 0, seedCounter = 1, live = 0;
  let textFn = null;
  let curPal = 0;   // palette used by addFire (set by the recipes)

  const waveObjs = [];
  for (let i = 0; i < MAX_WAVES; i++) waveObjs.push({ x: 0, y: 0, r: 0, strength: 0 });
  const post = { waves: [], flash: 0, flashColor: [1, 1, 1], chroma: 0 };

  // ---- spawn helpers ----------------------------------------------------------------
  function addSpark(x, y, vx, vy, life, drag, grav, heat0, streak, p, flags, delay) {
    const i = SPK.add(x, y, vx, vy, life, delay);
    if (i < 0) return;
    SPK.drag[i] = drag; SPK.grav[i] = grav; SPK.a[i] = heat0; SPK.b[i] = streak; SPK.pal[i] = p; SPK.f[i] = flags;
  }
  function addDot(x, y, vx, vy, life, drag, shape, heat0, p, flags, delay) {
    const i = DOT.add(x, y, vx, vy, life, delay);
    if (i < 0) return;
    DOT.drag[i] = drag; DOT.s[i] = shape; DOT.a[i] = heat0; DOT.pal[i] = p; DOT.f[i] = flags;
    return i;
  }
  function addFire(x, y, vx, vy, si, life, lightA, delay, drag) {
    const i = FIRE.add(x, y, vx, vy, life, delay);
    if (i < 0) return;
    FIRE.s[i] = si; FIRE.v[i] = (rnd() * FB[si][2]) | 0; FIRE.a[i] = lightA; FIRE.drag[i] = drag || 2.2;
    FIRE.pal[i] = curPal;
  }
  function addSmoke(x, y, vx, vy, si, life, delay, p) {
    const i = SMOKE.add(x, y, vx, vy, life, delay);
    if (i < 0) return;
    SMOKE.s[i] = si; SMOKE.v[i] = (rnd() * 4) | 0; SMOKE.drag[i] = 1.4; SMOKE.c[i] = DRIFT; SMOKE.pal[i] = p;
  }
  function addDebris(x, y, vx, vy, life, shape, smoky, p) {
    const i = DEB.add(x, y, vx, vy, life, 0);
    if (i < 0) return;
    DEB.s[i] = shape; DEB.a[i] = rnd() * 8; DEB.b[i] = rr(7, 18) * (rnd() < 0.5 ? -1 : 1);
    DEB.drag[i] = 0.7; DEB.c[i] = DRIFT; DEB.f[i] = smoky ? 1 : 0; DEB.pal[i] = p;
  }
  function addGlow(x, y, r0, r1, life, inten, prof, p, delay) {
    const i = GLW.add(x, y, 0, 0, life, delay);
    if (i < 0) return;
    GLW.a[i] = r0; GLW.b[i] = r1; GLW.d[i] = inten; GLW.s[i] = prof; GLW.pal[i] = p;
  }
  function addFlare(x, y, type, life, p, delay) {
    const i = FLR.add(x, y, 0, 0, life, delay);
    if (i < 0) return;
    FLR.s[i] = type; FLR.pal[i] = p;
  }
  function addRing(x, y, r0, r1, life, th, dist, p, flags, delay) {
    if (rgN >= RG) return;
    const i = rgN++;
    rgX[i] = x; rgY[i] = y; rgR0[i] = r0; rgR1[i] = r1; rgAge[i] = -delay; rgLife[i] = life;
    rgTh[i] = th; rgDist[i] = dist; rgPal[i] = p; rgF[i] = flags;
  }
  function addBolt(x, y, life, r, n, p) {
    if (boN_ >= BO) return;
    const i = boN_++;
    boX[i] = x; boY[i] = y; boAge[i] = 0; boLife[i] = life; boR[i] = r; boN[i] = n; boPal[i] = p; boSeed[i] = seedCounter++ * 977;
  }
  function schedule(t, x, y, sz, p, vx, vy, kind) {
    if (evN >= EV) return;
    const i = evN++;
    evT[i] = t; evX[i] = x; evY[i] = y; evSz[i] = sz; evPal[i] = p; evVX[i] = vx; evVY[i] = vy; evK[i] = kind;
  }
  function flashKick(a, rgb) {
    if (a <= 0) return;
    const tot = flashA + a;
    flashR = (flashR * flashA + rgb[0] * a) / tot;
    flashG = (flashG * flashA + rgb[1] * a) / tot;
    flashB = (flashB * flashA + rgb[2] * a) / tot;
    flashA = Math.min(1, Math.max(flashA, a));
  }
  function chromaKick(a) { chromaA = Math.min(1, Math.max(chromaA, a)); }

  // ---- explosion recipes ---------------------------------------------------------------
  function boom(x, y, sz, p, vx, vy) {
    const R = REC[sz];
    curPal = p;
    const ivx = vx * 0.3, ivy = vy * 0.3;
    // light: flash core + halo (+ anamorphic streak for big ones)
    addGlow(x, y, R.glow * 0.2, R.glow * 0.8, R.glowT, 0.75, G_HOT, p, 0);
    addGlow(x, y, R.glow * 0.6, R.glow * 1.2, R.glowT * 2.6, 0.26, G_SOFT, p, 0);
    if (sz >= 3) addGlow(x, y, R.glow * 0.7, R.glow * 0.9, R.glowT * 0.8, 0.45, G_STREAK, p, 0);
    if (R.sb) {
      addFlare(x, y, rnd() < 0.5 ? F_SB_PLUS : F_SB_X, 0.12 + 0.025 * sz, p, 0);
      if (R.sb > 1) addFlare(x + rr(-10, 10), y + rr(-10, 10), F_SB_X, 0.2, P_WHITE, 0.16);
    } else if (sz >= 0) addFlare(x, y, F_IMPACT, 0.08 + sz * 0.02, p, 0);
    if (R.flash) flashKick(R.flash, LIGHT_RGB[p]);
    if (R.chroma) chromaKick(R.chroma);

    // fireballs: main + staggered secondary pops
    addFire(x, y, ivx, ivy, R.fire, FB_T[R.fire] * rr(0.9, 1.1), 0.5, 0);
    for (let k = 0; k < R.nSec; k++) {
      const a = rnd() * TAU, d = R.secSpread * Math.sqrt(rr(0.12, 1));
      const si = Math.max(0, R.fire - 1 - (rnd() < 0.35 ? 1 : 0));
      const delay = (R.secDelay * (k + rnd())) / R.nSec;
      const fx = x + Math.cos(a) * d, fy = y + Math.sin(a) * d;
      addFire(fx, fy, ivx + Math.cos(a) * 12, ivy + Math.sin(a) * 12, si, FB_T[si] * rr(0.8, 1), 0.4, delay);
      if (sz >= 2 && rnd() < 0.6) addGlow(fx, fy, 3, 10 + si * 7, 0.16, 0.7, G_HOT, p, delay);
    }
    if (sz >= 3) {
      for (let k = 0; k < sz - 1; k++) {
        const a = rnd() * TAU, d = R.secSpread * rr(0.5, 1.1);
        schedule(rr(0.1, R.secDelay + 0.12), x + Math.cos(a) * d, y + Math.sin(a) * d, rnd() < 0.5 ? 0 : 1, p, vx, vy, EV_BOOM);
      }
    }

    // sparks: radial spray or a few jets (variation), plus long fast streaks
    const jets = sz >= 1 && rnd() < 0.45;
    const nj = 2 + ((rnd() * 3) | 0), j0 = rnd() * TAU;
    const bias = rr(0, 0.35), ba = rnd() * TAU, bx = Math.cos(ba) * bias, by = Math.sin(ba) * bias;
    const lifeK = 0.8 + sz * 0.12;
    for (let k = 0; k < R.nSpark; k++) {
      const a = jets ? j0 + ((k % nj) / nj) * TAU + rr(-0.35, 0.35) : rnd() * TAU;
      const sp = R.spd * rr(0.25, 1);
      addSpark(x, y, (Math.cos(a) + bx) * sp + ivx, (Math.sin(a) + by) * sp + ivy, rr(0.22, 0.5) * lifeK,
        rr(1.8, 3.4), 0, rr(0, 1.2), 1, p, S_GLOW, 0);
    }
    for (let k = 0; k < R.nFast; k++) {
      const a = rnd() * TAU, sp = R.spd * rr(1.2, 1.75);
      addSpark(x, y, Math.cos(a) * sp + ivx, Math.sin(a) * sp + ivy, rr(0.28, 0.48), 1.3, 0, 0, 1.35, p, S_GLOW, rr(0, 0.05));
    }
    // debris chunks with glowing trails
    for (let k = 0; k < R.nDeb; k++) {
      const a = rnd() * TAU, sp = rr(35, 80 + 22 * sz);
      addDebris(x + rr(-2, 2), y + rr(-2, 2), Math.cos(a) * sp + vx * 0.5, Math.sin(a) * sp + vy * 0.5, rr(0.6, 1.1) + sz * 0.12,
        sz < 2 ? (rnd() * 3) | 0 : (rnd() * 6) | 0, sz >= 2 && rnd() < 0.55, p);
    }
    // smoke that lingers and drifts (emerges from the fire)
    for (let k = 0; k < R.nSmk; k++) {
      const a = rnd() * TAU, d = R.smkSpread * Math.sqrt(rnd());
      const si = Math.max(0, R.smkSi - (rnd() < 0.4 ? 1 : 0));
      addSmoke(x + Math.cos(a) * d, y + Math.sin(a) * d, Math.cos(a) * rr(4, 16) + ivx * 0.6, Math.sin(a) * rr(4, 16) + ivy * 0.6,
        si, rr(1.0, 1.6) * (0.8 + 0.16 * sz), rr(0.06, 0.18) + FB_T[R.fire] * 0.25, p);
    }
    // shockwave rings (+ post distortion)
    if (R.ringR && (sz >= 3 || rnd() < 0.55)) {
      addRing(x, y, 2, R.ringR, 0.22 + R.ringR / 260, R.ringTh, R.dist, p, 1, 0);
      if (sz >= 3) addRing(x, y, 2, R.ringR * 0.62, 0.45 + R.ringR / 300, 1, 0, p, 1, 0.08);
    }
    // embers
    for (let k = 0; k < R.embers; k++) {
      const a = rnd() * TAU, sp = rr(10, 55 + sz * 8);
      addDot(x + rr(-3, 3), y + rr(-3, 3), Math.cos(a) * sp, Math.sin(a) * sp, rr(0.6, 1.3) + sz * 0.15, 1.3,
        rnd() < 0.7 ? 0 : 1, rr(0.3, 1.4), p, D_TWINKLE | D_GLOW | D_BLINK, rr(0, 0.15));
    }
  }

  function bossFinal(x, y, p, vx, vy) {
    flashKick(1, WHITE_RGB);
    chromaKick(1);
    boom(x, y, 4, p, vx, vy);
    curPal = p;
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * TAU + rnd() * 0.5, sp = rr(60, 130), si = rnd() < 0.5 ? 3 : 2;
      addFire(x + Math.cos(a) * 8, y + Math.sin(a) * 8, Math.cos(a) * sp, Math.sin(a) * sp, si, FB_T[si] * rr(1, 1.25), 0.7, rr(0, 0.12), 1.6);
    }
    addRing(x, y, 4, 210, 0.9, 4, 1.25, p, 1, 0);
    addRing(x, y, 4, 140, 1.0, 2, 0.6, P_WHITE, 1, 0.12);
    addRing(x, y, 4, 290, 1.35, 1, 0.35, p, 1, 0.22);
    addGlow(x, y, 30, 150, 0.9, 1, G_HOT, P_WHITE, 0);
    addGlow(x, y, 60, 220, 0.8, 0.8, G_STREAK, p, 0);
    addFlare(x, y, F_SB_PLUS, 0.3, P_WHITE, 0);
    addBolt(x, y, 0.75, 110, 10, p);
    for (let k = 0; k < 70; k++) {
      const a = rnd() * TAU, sp = rr(120, 460);
      addSpark(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rr(0.4, 0.9), rr(1.2, 2.2), 0, rr(0, 1), 1.3, k & 1 ? p : P_WHITE, S_GLOW, rr(0, 0.1));
    }
    for (let k = 0; k < 24; k++) {
      const a = rnd() * TAU, sp = rr(50, 170);
      addDebris(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rr(1, 1.9), (rnd() * 6) | 0, rnd() < 0.6, p);
    }
    for (let k = 0; k < 18; k++) {
      const a = rnd() * TAU, d = 44 * Math.sqrt(rnd());
      addSmoke(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.8, Math.cos(a) * rr(6, 20), Math.sin(a) * rr(6, 20), 3, rr(2.2, 3.4), rr(0.15, 0.6), p);
    }
    for (let k = 0; k < 50; k++) {
      const a = rnd() * TAU, sp = rr(15, 110);
      addDot(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rr(1.5, 3.2), 0.9, rnd() < 0.6 ? 0 : 2, rr(0, 1.2), k & 1 ? p : P_GOLD, D_TWINKLE | D_GLOW | D_BLINK, rr(0, 0.4));
    }
  }

  function bossChain(x, y, p, vx, vy) {
    const n = 14;
    for (let i = 0; i < n; i++) {
      const t = 2.3 * Math.pow(i / n, 0.72);
      const a = rnd() * TAU, r = Math.sqrt(rnd());
      schedule(t, x + Math.cos(a) * r * 58, y + Math.sin(a) * r * 34, i % 3 === 2 ? 3 : i % 4 === 3 ? 1 : 2, i & 1 ? p : P_FIRE, vx, vy, EV_BOOM);
    }
    schedule(2.5, x, y, 4, p, vx, vy, EV_BOSS_FINAL);
  }

  function warpPop(x, y, p) {
    addGlow(x, y, 3, 22, 0.24, 1, G_HOT, p, 0);
    addRing(x, y, 2, 16, 0.24, 1.5, 0.22, p, 1, 0);
    addFlare(x, y, F_IMPACT, 0.1, P_WHITE, 0);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU + rr(-0.2, 0.2), sp = rr(60, 130);
      addSpark(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rr(0.15, 0.3), 3.5, 0, 0, 1, p, S_GLOW, 0);
    }
    for (let k = 0; k < 4; k++) addDot(x + rr(-6, 6), y + rr(-6, 6), 0, rr(-20, 20), rr(0.3, 0.5), 2, 3, 0, p, D_TWINKLE | D_GLOW, rr(0, 0.1));
  }

  function runEvent(k, x, y, sz, p, vx, vy) {
    if (k === EV_BOOM) boom(x, y, sz, p, vx, vy);
    else if (k === EV_BOSS_FINAL) bossFinal(x, y, p, vx, vy);
    else if (k === EV_WARP_POP) warpPop(x, y, p);
  }

  // ---- update -----------------------------------------------------------------------------
  function update(dt) {
    if (!(dt > 0)) return;
    if (dt > 0.1) dt = 0.1;
    frameNo++;
    // scheduled events
    for (let i = 0; i < evN;) {
      evT[i] -= dt;
      if (evT[i] <= 0) {
        const k = evK[i], x = evX[i], y = evY[i], sz = evSz[i], p = evPal[i], vx = evVX[i], vy = evVY[i];
        evN--;
        if (i !== evN) {
          evT[i] = evT[evN]; evX[i] = evX[evN]; evY[i] = evY[evN]; evSz[i] = evSz[evN];
          evPal[i] = evPal[evN]; evVX[i] = evVX[evN]; evVY[i] = evVY[evN]; evK[i] = evK[evN];
        }
        runEvent(k, x, y, sz, p, vx, vy);
      } else i++;
    }
    for (let k = 0; k < POOLS.length; k++) POOLS[k].step(dt);

    // debris: tumble + smoke puffs from smoky chunks
    for (let i = 0; i < DEB.n; i++) {
      DEB.a[i] += DEB.b[i] * dt;
      if (DEB.f[i] & 1 && DEB.age[i] < DEB.life[i] * 0.6 && rnd() < dt * 16) {
        addSmoke(DEB.x[i], DEB.y[i], 0, 0, 0, rr(0.35, 0.6), 0, DEB.pal[i]);
      }
    }
    // rings
    let w = 0;
    for (let i = 0; i < rgN; i++) {
      const age = rgAge[i] + dt;
      if (age >= rgLife[i]) continue;
      rgAge[i] = age;
      if (w !== i) {
        rgX[w] = rgX[i]; rgY[w] = rgY[i]; rgR0[w] = rgR0[i]; rgR1[w] = rgR1[i]; rgAge[w] = rgAge[i]; rgLife[w] = rgLife[i];
        rgTh[w] = rgTh[i]; rgDist[w] = rgDist[i]; rgPal[w] = rgPal[i]; rgF[w] = rgF[i];
      }
      w++;
    }
    rgN = w;
    // novas: sustain the flash, shed sparks off the expanding front
    w = 0;
    for (let i = 0; i < nvN; i++) {
      const age = nvAge[i] + dt;
      if (age >= NOVA_T) continue;
      nvAge[i] = age;
      const p = nvPal[i];
      if (age < 0.2) flashKick(0.25 * (1 - age / 0.2), LIGHT_RGB[p]);
      const R = novaR(age);
      if (R < 470) {
        for (let k = 0; k < 5; k++) {
          const a = rnd() * TAU, sx = nvX[i] + Math.cos(a) * R, sy = nvY[i] + Math.sin(a) * R;
          if (sx < -4 || sx > 244 || sy < -4 || sy > 404) continue;
          const sp = rr(60, 170);
          if (k & 1) addSpark(sx, sy, Math.cos(a) * sp, Math.sin(a) * sp, rr(0.15, 0.32), 3, 0, 0, 1, k & 2 ? p : P_WHITE, S_GLOW, 0);
          else addDot(sx, sy, Math.cos(a) * sp * 0.4, Math.sin(a) * sp * 0.4, rr(0.2, 0.45), 2.5, rnd() < 0.5 ? 2 : 3, 0, p, D_GLOW | D_TWINKLE, 0);
        }
      }
      if (w !== i) { nvX[w] = nvX[i]; nvY[w] = nvY[i]; nvAge[w] = nvAge[i]; nvPal[w] = nvPal[i]; nvSeed[w] = nvSeed[i]; }
      w++;
    }
    nvN = w;
    // lightning bursts
    w = 0;
    for (let i = 0; i < boN_; i++) {
      const age = boAge[i] + dt;
      if (age >= boLife[i]) continue;
      boAge[i] = age;
      if (w !== i) {
        boX[w] = boX[i]; boY[w] = boY[i]; boAge[w] = boAge[i]; boLife[w] = boLife[i]; boR[w] = boR[i];
        boN[w] = boN[i]; boPal[w] = boPal[i]; boSeed[w] = boSeed[i];
      }
      w++;
    }
    boN_ = w;
    // texts
    w = 0;
    for (let i = 0; i < txN; i++) {
      const age = txAge[i] + dt;
      if (age >= txLife[i]) { txStr[i] = ''; continue; }
      txAge[i] = age;
      if (w !== i) { txX[w] = txX[i]; txY[w] = txY[i]; txAge[w] = txAge[i]; txLife[w] = txLife[i]; txStr[w] = txStr[i]; txCol[w] = txCol[i]; txStr[i] = ''; }
      w++;
    }
    txN = w;
    // post kicks decay
    flashA *= Math.exp(-dt * 7.5);
    if (flashA < 0.003) flashA = 0;
    chromaA *= Math.exp(-dt * 3.2);
    if (chromaA < 0.003) chromaA = 0;

    let n = rgN + nvN + boN_ + txN;
    for (let k = 0; k < POOLS.length; k++) n += POOLS[k].n;
    live = n;
  }

  // ---- draw -------------------------------------------------------------------------------
  function drawSmoke(ctx) {
    const P = SMOKE;
    for (let i = 0; i < P.n; i++) {
      const age = P.age[i];
      if (age < 0) continue;
      const s = P.s[i], S = SMK[s][0], F = SMK[s][1];
      let f = ((age / P.life[i]) * F) | 0;
      if (f >= F) f = F - 1;
      const k = s * 4 + P.v[i], h = S >> 1;
      ctx.drawImage(exAtlas(P.pal[i]), SMX[k] + f * S, SMY[k], S, S, ((P.x[i] + 1024.5) | 0) - 1024 - h, ((P.y[i] + 1024.5) | 0) - 1024 - h, S, S);
    }
  }

  function drawDebris(ctx, lctx) {
    const P = DEB, dbx = POS.db[0], dby = POS.db[1], g = ctx || lctx;
    for (let i = 0; i < P.n; i++) {
      const u = P.age[i] / P.life[i];
      if (u > 0.8 && (frameNo & 2)) continue;       // blink out
      const heat = u < 0.2 ? 0 : u < 0.45 ? 1 : u < 0.7 ? 2 : 3;
      if (lctx && heat === 3) continue;
      const vx = P.vx[i], vy = P.vy[i];
      const ix = ((P.x[i] + 1024.5) | 0) - 1024, iy = ((P.y[i] + 1024.5) | 0) - 1024;
      // glowing trail streak behind the chunk
      const p = P.pal[i], tp = p === P_CRY || p >= P_TEAM ? p : P_FIRE;
      const sp = Math.sqrt(vx * vx + vy * vy) * 0.0336;
      const li = LEN_IDX[sp >= 7 ? 7 : (sp + 0.5) | 0], L = SPL[li], c = 2 * L + 1;
      const d = ((Math.atan2(vy, vx) * K16 + 16.5) | 0) & 15;
      const bx = ((vx * 0.02 + 1024.5) | 0) - 1024, by = ((vy * 0.02 + 1024.5) | 0) - 1024;
      g.drawImage(SPA[tp], SPX[li] + d * c, SPY[li] + heat * c, c, c, ix - bx - L, iy - by - L, c, c);
      if (lctx) continue;
      ctx.drawImage(exAtlas(p), dbx + ((P.a[i] | 0) & 7) * 9, dby + P.s[i] * 9, 9, 9, ix - 4, iy - 4, 9, 9);
    }
  }

  function drawFire(ctx, lctx) {
    const P = FIRE;
    for (let i = 0; i < P.n; i++) {
      const age = P.age[i];
      if (age < 0) continue;
      const u = age / P.life[i];
      const s = P.s[i], S = FB[s][0], F = FB[s][1];
      let f = (u * F) | 0;
      if (f >= F) f = F - 1;
      const k = s * 4 + P.v[i], h = S >> 1;
      const at = exAtlas(P.pal[i]);
      const sx = FBX[k] + f * S, sy = FBY[k], dx = ((P.x[i] + 1024.5) | 0) - 1024 - h, dy = ((P.y[i] + 1024.5) | 0) - 1024 - h;
      if (ctx) ctx.drawImage(at, sx, sy, S, S, dx, dy, S, S);
      if (lctx) {
        const a = P.a[i] * Math.pow(1 - u, 1.4);
        if (a > 0.02) { lctx.globalAlpha = a; lctx.drawImage(at, sx, sy, S, S, dx, dy, S, S); }
      }
    }
    if (lctx) lctx.globalAlpha = 1;
  }

  function drawRings(ctx, lctx) {
    for (let i = 0; i < rgN; i++) {
      const age = rgAge[i];
      if (age < 0) continue;
      const u = age / rgLife[i], e = 1 - (1 - u) * (1 - u) * (1 - u);
      const r = rgR0[i] + (rgR1[i] - rgR0[i]) * e;
      if (r < 1) continue;
      const p = rgPal[i], ramp = CSTR[p], ti = thIdx(rgTh[i] * (1 - u * 0.55));
      const cx = ((rgX[i] + 1024.5) | 0) - 1024, cy = ((rgY[i] + 1024.5) | 0) - 1024, ri = (r + 0.5) | 0;
      const step = Math.min(4, (u * 5) | 0);
      if (ctx) { ctx.fillStyle = ramp[rgF[i] & 2 ? 3 + step : 7 - step]; ringFill(ctx, cx, cy, ri, ti); }
      if (lctx) {
        lctx.globalAlpha = (1 - u) * 0.8;
        lctx.fillStyle = ramp[5];
        ringFill(lctx, cx, cy, ri, ti);
        if (rgF[i] & 1) {
          lctx.globalAlpha = (1 - u) * 0.4;
          lctx.strokeStyle = ramp[4];
          lctx.lineWidth = ti * 3 + 2;
          lctx.beginPath(); lctx.arc(cx, cy, ri > ti ? ri - (ti >> 1) : 1, 0, TAU); lctx.stroke();
        }
      }
    }
    if (lctx) lctx.globalAlpha = 1;
  }

  function bigRing(g, cx, cy, r, th) {
    if (r < 1) return;
    ringFill(g, cx, cy, (r + 0.5) | 0, thIdx(th));
  }

  function drawNovas(ctx, lctx) {
    for (let i = 0; i < nvN; i++) {
      const age = nvAge[i], u = age / NOVA_T, p = nvPal[i], ramp = CSTR[p];
      const R = novaR(age), cx = ((nvX[i] + 1024.5) | 0) - 1024, cy = ((nvY[i] + 1024.5) | 0) - 1024;
      const th = 2 + 6 * (1 - u);
      const fade = u < 0.75 ? 1 : (1 - u) / 0.25;
      const boltsOn = u < 0.62 && frameNo % 3 !== 2;
      const bIn = Math.max(4, R - 95), bFade = u < 0.4 ? 1 : 1 - (u - 0.4) / 0.22;
      const bs = nvSeed[i] + ((frameNo / 3) | 0) * 131;
      if (ctx) {
        // main: crisp front + echoes + lightning filaments
        ctx.globalAlpha = fade;
        if (u < 0.85) {
          ctx.fillStyle = ramp[3]; bigRing(ctx, cx, cy, R * 0.64, 1);
          ctx.fillStyle = ramp[4]; bigRing(ctx, cx, cy, R * 0.82, 1.6);
        }
        ctx.fillStyle = ramp[5]; bigRing(ctx, cx, cy, R - 1, th);
        ctx.fillStyle = ramp[3]; bigRing(ctx, cx, cy, R - th - 1, 1.2);
        ctx.fillStyle = u < 0.55 ? ramp[7] : ramp[6]; bigRing(ctx, cx, cy, R, 1.3);
        if (boltsOn) {
          bseed(bs);
          ctx.fillStyle = ramp[7];
          ctx.beginPath();
          ctx.globalAlpha = fade * bFade;
          for (let b = 0; b < 9; b++) bolt(ctx, cx, cy, (b / 9) * TAU + (brnd() - 0.5) * 0.6, R * (0.86 + 0.12 * brnd()), true, bIn);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      if (!lctx) continue;
      // light: interior wash, thick glowing front, bolts, core
      glowAt(lctx, p, G_SOFT, cx, cy, R * 1.05, R * 1.05, 0.34 * Math.pow(1 - u, 1.5));
      lctx.globalAlpha = 0.85 * fade * (1 - u * 0.4);
      lctx.strokeStyle = ramp[4]; lctx.lineWidth = th * 2.8;
      lctx.beginPath(); lctx.arc(cx + 0.5, cy + 0.5, Math.max(1, R - th * 0.5), 0, TAU); lctx.stroke();
      lctx.globalAlpha = 0.7 * fade;
      lctx.strokeStyle = ramp[7]; lctx.lineWidth = 1.5;
      lctx.beginPath(); lctx.arc(cx + 0.5, cy + 0.5, Math.max(1, R - 0.5), 0, TAU); lctx.stroke();
      if (u < 0.85) {
        lctx.globalAlpha = 0.4 * fade;
        lctx.strokeStyle = ramp[3]; lctx.lineWidth = 3;
        lctx.beginPath(); lctx.arc(cx + 0.5, cy + 0.5, Math.max(1, R * 0.82), 0, TAU); lctx.stroke();
      }
      if (boltsOn) {
        bseed(bs);
        lctx.globalAlpha = 0.75 * fade * bFade;
        lctx.strokeStyle = ramp[5]; lctx.lineWidth = 1.8;
        lctx.beginPath();
        for (let b = 0; b < 9; b++) bolt(lctx, cx, cy, (b / 9) * TAU + (brnd() - 0.5) * 0.6, R * (0.86 + 0.12 * brnd()), false, bIn);
        lctx.stroke();
      }
      glowAt(lctx, p, G_HOT, cx, cy, 14 + 40 * (1 - u), 14 + 40 * (1 - u), 0.9 * (1 - u) * (1 - u) * (1 - u));
      lctx.globalAlpha = 1;
    }
  }

  function drawBolts(ctx, lctx) {
    for (let i = 0; i < boN_; i++) {
      if (frameNo % 3 === 2) continue;
      const u = boAge[i] / boLife[i], p = boPal[i], ramp = CSTR[p];
      const cx = ((boX[i] + 1024.5) | 0) - 1024, cy = ((boY[i] + 1024.5) | 0) - 1024, n = boN[i], R = boR[i] * (0.6 + 0.4 * u);
      const bs = boSeed[i] + ((frameNo / 3) | 0) * 131;
      if (ctx) {
        bseed(bs);
        ctx.fillStyle = u < 0.5 ? ramp[7] : ramp[6];
        ctx.beginPath();
        for (let b = 0; b < n; b++) bolt(ctx, cx, cy, brnd() * TAU, R * (0.5 + 0.5 * brnd()), true);
        ctx.fill();
      }
      if (!lctx) continue;
      bseed(bs);
      lctx.globalAlpha = 0.9 * (1 - u);
      lctx.strokeStyle = ramp[5]; lctx.lineWidth = 2;
      lctx.beginPath();
      for (let b = 0; b < n; b++) bolt(lctx, cx, cy, brnd() * TAU, R * (0.5 + 0.5 * brnd()), false);
      lctx.stroke();
      lctx.globalAlpha = 1;
    }
  }

  function drawSparks(ctx, lctx) {
    const P = SPK, g = ctx || lctx;
    for (let i = 0; i < P.n; i++) {
      const age = P.age[i];
      if (age < 0) continue;
      let h = (P.a[i] + (age / P.life[i]) * 4) | 0;
      if (h > 3) h = 3;
      if (P.f[i] & S_REV) h = 3 - h;
      if (lctx && (h === 3 || !(P.f[i] & S_GLOW))) continue;
      const vx = P.vx[i], vy = P.vy[i];
      const sp = Math.sqrt(vx * vx + vy * vy) * P.b[i] * 0.024;
      const li = LEN_IDX[sp >= 7 ? 7 : (sp + 0.5) | 0], L = SPL[li], c = 2 * L + 1;
      const d = ((Math.atan2(vy, vx) * K16 + 16.5) | 0) & 15;
      g.drawImage(SPA[P.pal[i]], SPX[li] + d * c, SPY[li] + h * c, c, c,
        ((P.x[i] + 1024.5) | 0) - 1024 - L, ((P.y[i] + 1024.5) | 0) - 1024 - L, c, c);
    }
  }

  function drawDots(ctx, lctx) {
    const P = DOT, ox = POS.dot[0], oy = POS.dot[1];
    for (let i = 0; i < P.n; i++) {
      const age = P.age[i];
      if (age < 0) continue;
      const u = age / P.life[i], f = P.f[i];
      if (f & D_BLINK && u > 0.72 && ((frameNo + i) & 2)) continue;
      let h = (P.a[i] + u * 4) | 0;
      if (h > 3) h = 3;
      let s = P.s[i];
      if (f & D_SHRINK) {
        const st0 = P.v[i];
        let k = st0 - ((u * (st0 + 1)) | 0);
        if (k < 0) k = 0;
        s = SHR[k];
      } else if (f & D_TWINKLE && s > 0 && ((frameNo + i * 3) >> 2) & 1) s = s === 5 ? 0 : s - 1;
      const sx = ox + s * DOT_C, sy = oy + h * DOT_C, dx = ((P.x[i] + 1024.5) | 0) - 1027, dy = ((P.y[i] + 1024.5) | 0) - 1027;
      const at = SPA[P.pal[i]];
      if (ctx) ctx.drawImage(at, sx, sy, DOT_C, DOT_C, dx, dy, DOT_C, DOT_C);
      else if (f & D_GLOW && h < 3) lctx.drawImage(at, sx, sy, DOT_C, DOT_C, dx, dy, DOT_C, DOT_C);
    }
  }

  function drawFlares(ctx, lctx) {
    const P = FLR, g = ctx || lctx;
    for (let i = 0; i < P.n; i++) {
      const age = P.age[i];
      if (age < 0) continue;
      const t = P.s[i], nf = FL_F[t], w = FL_W[t], h = FL_H[t];
      let f = ((age / P.life[i]) * nf) | 0;
      if (f >= nf) f = nf - 1;
      g.drawImage(SPA[P.pal[i]], FL_X[t] + f * w, FL_Y[t], w, h, ((P.x[i] + 1024.5) | 0) - 1024 - FL_AX[t], ((P.y[i] + 1024.5) | 0) - 1024 - FL_AY[t], w, h);
    }
  }

  // soft glow sprite on the light layer; dest rect snapped to ints (invisible on a soft glow,
  // and it avoids boxing four doubles per draw)
  function glowAt(l, p, prof, x, y, rx, ry, alpha) {
    if (alpha <= 0.004 || rx < 0.5 || ry < 0.5) return;
    l.globalAlpha = alpha > 1 ? 1 : alpha;
    const w = ((rx * 2 + 0.5) | 0) || 1, h = ((ry * 2 + 0.5) | 0) || 1;
    l.drawImage(GLOW, p * GC, prof === G_HOT ? 0 : GC, 64, 64, ((x + 1024.5) | 0) - 1024 - (w >> 1), ((y + 1024.5) | 0) - 1024 - (h >> 1), w, h);
  }

  function drawGlows(lctx) {
    const P = GLW;
    for (let i = 0; i < P.n; i++) {
      const age = P.age[i];
      if (age < 0) continue;
      const u = age / P.life[i], e = 1 - (1 - u) * (1 - u);
      const r = P.a[i] + (P.b[i] - P.a[i]) * e, prof = P.s[i];
      const k = 1 - u;
      let al = P.d[i] * (prof === G_SOFT ? k : k * k);
      if (al <= 0.004) continue;
      if (al > 1) al = 1;
      let rx = r, ry = r;
      if (prof === G_STREAK) { rx = r * 2.4; ry = r * 0.12 > 1.5 ? r * 0.12 : 1.5; }
      else if (prof === G_VSTREAK) { rx = r * 0.5 > 1.5 ? r * 0.5 : 1.5; ry = r * 5; }
      const w = ((rx * 2 + 0.5) | 0) || 1, h = ((ry * 2 + 0.5) | 0) || 1;
      lctx.globalAlpha = al;
      lctx.drawImage(GLOW, P.pal[i] * GC, prof === G_HOT ? 0 : GC, 64, 64,
        ((P.x[i] + 1024.5) | 0) - 1024 - (w >> 1), ((P.y[i] + 1024.5) | 0) - 1024 - (h >> 1), w, h);
    }
    lctx.globalAlpha = 1;
  }

  function drawTexts(ctx) {
    const fn = textFn || builtinText;
    for (let i = 0; i < txN; i++) {
      const u = txAge[i] / txLife[i];
      if (u > 0.7 && ((frameNo >> 1) & 1)) continue;
      const rise = 1 - (1 - Math.min(1, u * 2.2)) * (1 - Math.min(1, u * 2.2));
      fn(ctx, txStr[i], ((txX[i] + 1024.5) | 0) - 1024, ((txY[i] - 4 - rise * 12 + 1024.5) | 0) - 1024, txCol[i]);
    }
  }

  function draw(ctx, lctx) {
    // MAIN, back to front. All main draws are issued before any light draws: interleaving
    // two canvases per particle makes Chrome flush its raster queue constantly.
    const prevSmooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    drawSmoke(ctx);
    drawDebris(ctx, null);
    drawFire(ctx, null);
    drawRings(ctx, null);
    drawNovas(ctx, null);
    drawBolts(ctx, null);
    drawSparks(ctx, null);
    drawDots(ctx, null);
    drawFlares(ctx, null);
    drawTexts(ctx);
    ctx.imageSmoothingEnabled = prevSmooth;
    if (!lctx) return;
    // LIGHT: additive, so order does not matter
    const pOp = lctx.globalCompositeOperation, pSm = lctx.imageSmoothingEnabled, pA = lctx.globalAlpha;
    lctx.globalCompositeOperation = 'lighter';
    lctx.imageSmoothingEnabled = true;
    lctx.globalAlpha = 1;
    drawGlows(lctx);
    drawFire(null, lctx);
    drawDebris(null, lctx);
    drawRings(null, lctx);
    drawNovas(null, lctx);
    drawBolts(null, lctx);
    drawSparks(null, lctx);
    drawDots(null, lctx);
    drawFlares(null, lctx);
    lctx.globalCompositeOperation = pOp;
    lctx.imageSmoothingEnabled = pSm;
    lctx.globalAlpha = pA;
  }

  // ---- beams --------------------------------------------------------------------------------
  function beam(ctx, lctx, x1, y1, x2, y2, width, fire, t, p, player) {
    const dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return;
    const L = Math.round(len);
    let ca = dy / len, sa = -dx / len;             // local +y runs along the beam
    if (Math.abs(ca) > 0.9995) { ca = Math.sign(ca); sa = 0; } else if (Math.abs(sa) > 0.9995) { sa = Math.sign(sa); ca = 0; }
    const ox = Math.round(x1), oy = Math.round(y1);
    const W = Math.max(1, Math.round(width)) | 1;  // odd: centred on a pixel column
    const hw = W >> 1, lft = -hw;
    const ramp = CSTR[p], at = SPA[p];
    const fr = (t * 30) | 0;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.transform(ca, sa, -sa, ca, ox, oy);
    if (fire) {
      // bands: outer body -> inner body -> hot rim -> white core
      if (player) ctx.globalAlpha = 0.88;
      ctx.fillStyle = ramp[3]; ctx.fillRect(lft, 0, W, L);
      if (W >= 3) { ctx.fillStyle = ramp[4]; ctx.fillRect(lft + 1, 0, W - 2, L); }
      // energy pulses flowing along the beam
      if (W >= 5) {
        ctx.fillStyle = ramp[5];
        const per = 34, off = (t * 240) % per;
        ctx.beginPath();
        for (let s = off - per; s < L; s += per) {
          const a = Math.max(0, Math.round(s)), b = Math.min(L, Math.round(s) + 5);
          if (b > a) ctx.rect(lft + 1, a, W - 2, b - a);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // white-hot core (flickers by a pixel on wide beams)
      let cw = Math.max(1, Math.round(W * 0.26)) | 1;
      if (W >= 7 && fr & 1) cw += 2;
      if (W >= 5) { ctx.fillStyle = ramp[5]; ctx.fillRect(-(cw >> 1) - 1, 0, cw + 2, L); }
      ctx.fillStyle = ramp[7]; ctx.fillRect(-(cw >> 1), 0, cw, L);
      // animated edge ripples
      if (W >= 3) {
        const sw = Math.min(4, Math.max(1, hw - 1)), f1 = (fr >> 1) & 7, f2 = ((fr >> 1) + 3) & 7;
        const rx = POS.rp[0], ry = POS.rp[1];
        for (let s = 0; s < L; s += 64) {
          const h = Math.min(64, L - s);
          ctx.drawImage(at, rx + f1 * 4, ry, sw, h, lft + W, s, sw, h);
          ctx.drawImage(at, rx + 32 + f2 * 4 + (4 - sw), ry, sw, h, lft - sw, s, sw, h);
        }
      }
      // origin + impact splash
      const r0 = hw + (fr & 1), r1 = Math.max(1, hw) + ((fr >> 1) & 1);
      ctx.fillStyle = ramp[5]; diskFill(ctx, 0, 0, r0 + 1);
      ctx.fillStyle = ramp[7]; diskFill(ctx, 0, 0, Math.max(1, r0 - 1));
      ctx.fillStyle = ramp[6]; diskFill(ctx, 0, L, r1 + 1);
      ctx.fillStyle = ramp[7]; diskFill(ctx, 0, L, Math.max(0, r1 - 1));
    } else {
      // warn: thin flickering dotted guide + danger-width ticks + charging orb
      if (fr % 4 !== 3) {
        const off = (t * 80) % 8;
        ctx.fillStyle = ramp[5];
        ctx.beginPath();
        for (let s = off - 8; s < L; s += 8) {
          const a = Math.max(0, Math.round(s)), b = Math.min(L, Math.round(s) + 4);
          if (b > a) ctx.rect(0, a, 1, b - a);
        }
        ctx.fill();
        if (W >= 3) {
          ctx.fillStyle = ramp[3];
          ctx.beginPath();
          for (let s = ((t * 40) % 6) - 6; s < L; s += 6) {
            const a = Math.round(s);
            if (a < 0 || a >= L) continue;
            ctx.rect(lft - 1, a, 1, 1); ctx.rect(hw + 1, a, 1, 1);
          }
          ctx.fill();
        }
      }
      const cr = 1 + W * 0.3 * (0.75 + 0.25 * Math.sin(t * 38));
      ctx.fillStyle = ramp[5]; diskFill(ctx, 0, 0, cr + 1);
      ctx.fillStyle = ramp[7]; diskFill(ctx, 0, 0, Math.max(0, cr - 1));
    }
    ctx.restore();

    if (lctx) {
      lctx.save();
      lctx.globalCompositeOperation = 'lighter';
      lctx.imageSmoothingEnabled = true;
      lctx.transform(ca, sa, -sa, ca, ox, oy);
      const gx = p * GC;
      if (fire) {
        const k = player ? 0.65 : 1, fl = 0.9 + 0.1 * Math.sin(t * 50);
        lctx.globalAlpha = 0.42 * k * fl;
        lctx.drawImage(GLOW, gx, STRIP_BODY_Y, 32, 1, 0.5 - W * 2.1, 0, W * 4.2, L);
        lctx.globalAlpha = 0.22 * k;
        lctx.drawImage(GLOW, gx, STRIP_CORE_Y, 32, 1, 0.5 - W * 0.6, 0, W * 1.2, L);
        glowAt(lctx, p, G_HOT, 0.5, 0.5, W * 2.2 + 4, W * 2.2 + 4, 0.75 * k * fl);
        glowAt(lctx, p, G_HOT, 0.5, L + 0.5, W * 1.9 + 4, W * 1.9 + 4, 0.7 * k * fl);
      } else {
        lctx.globalAlpha = (0.25 + 0.15 * Math.sin(t * 40)) * (fr % 4 !== 3 ? 1 : 0.4);
        lctx.drawImage(GLOW, gx, STRIP_BODY_Y, 32, 1, -2.5, 0, 6, L);
        glowAt(lctx, p, G_HOT, 0.5, 0.5, 5 + W, 5 + W, 0.6 + 0.3 * Math.sin(t * 38));
      }
      lctx.restore();
    }

    // sparks spraying from the impact point (and a few off the emitter)
    if (fire) {
      const back = Math.atan2(-dy, -dx);
      if (rnd() < 0.7) {
        const a = back + rr(-1.2, 1.2), sp = rr(60, 200);
        addSpark(x2, y2, Math.cos(a) * sp, Math.sin(a) * sp, rr(0.12, 0.3), 3, 0, rr(0, 1), 1, p, S_GLOW, 0);
      }
      if (rnd() < 0.18) {
        const a = back + Math.PI + rr(-1.4, 1.4), sp = rr(40, 110);
        addSpark(x1, y1, Math.cos(a) * sp, Math.sin(a) * sp, rr(0.1, 0.22), 3, 0, 0.5, 1, p, S_GLOW, 0);
      }
    }
  }

  // ---- post state -----------------------------------------------------------------------------
  function postState() {
    const ws = post.waves;
    ws.length = 0;
    let k = 0;
    for (let i = 0; i < nvN && k < MAX_WAVES; i++) {
      const u = nvAge[i] / NOVA_T, o = waveObjs[k++];
      o.x = nvX[i]; o.y = nvY[i]; o.r = novaR(nvAge[i]); o.strength = 1.1 * (1 - u) * Math.min(1, nvAge[i] * 12);
      ws.push(o);
    }
    for (let i = rgN - 1; i >= 0 && k < MAX_WAVES; i--) {
      if (rgDist[i] === 0 || rgAge[i] < 0) continue;
      const u = rgAge[i] / rgLife[i], e = 1 - (1 - u) * (1 - u) * (1 - u), o = waveObjs[k++];
      o.x = rgX[i]; o.y = rgY[i]; o.r = rgR0[i] + (rgR1[i] - rgR0[i]) * e;
      o.strength = rgDist[i] * Math.pow(1 - u, 1.5);
      ws.push(o);
    }
    post.flash = flashA;
    post.flashColor[0] = flashR; post.flashColor[1] = flashG; post.flashColor[2] = flashB;
    post.chroma = chromaA;
    return post;
  }

  // ---- public API -------------------------------------------------------------------------------
  const fx = {
    update,
    draw,

    explode(x, y, size, opt) {
      const sz = SIZE[size] !== undefined ? SIZE[size] : 1;
      const p = palOf(opt && opt.palette);
      const vx = (opt && opt.vx) || 0, vy = (opt && opt.vy) || 0;
      if (opt && opt.seed != null) reseed(opt.seed);
      if (sz === 5) bossChain(x, y, p, vx, vy);
      else boom(x, y, sz, p, vx, vy);
    },

    hit(x, y, palette) {
      const p = palOf(palette);
      addFlare(x, y, F_IMPACT, 0.07, p, 0);
      addGlow(x, y, 2, 8, 0.1, 0.6, G_HOT, p, 0);
      const n = 2 + ((rnd() * 3) | 0);
      for (let k = 0; k < n; k++) {
        const a = Math.PI / 2 + rr(-1.2, 1.2), sp = rr(50, 160);
        addSpark(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rr(0.1, 0.26), 4, 0, rr(0, 1.5), 1, p, S_GLOW, 0);
      }
    },

    spark(x, y, angle, palette, n) {
      const p = palOf(palette), cnt = n == null ? 6 : n;
      for (let k = 0; k < cnt; k++) {
        const a = (angle || 0) + rr(-0.45, 0.45), sp = rr(80, 240);
        addSpark(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rr(0.18, 0.42), 3, 0, rr(0, 1), 1, p, S_GLOW, 0);
      }
    },

    muzzle(x, y, team) {
      const p = palOf(team);
      addFlare(x, y, F_MUZZLE, 0.05, p, 0);
      addGlow(x, y - 1, 3, 6, 0.06, 0.45, G_HOT, p, 0);
    },

    trail(x, y, palette, size) {
      const p = palOf(palette), s = Math.max(1, Math.min(3, (size || 1) | 0));
      const i = addDot(x + rr(-0.6, 0.6), y + rr(-0.6, 0.6), rr(-6, 6), 22 + s * 6 + rr(0, 10), rr(0.14, 0.22) + s * 0.04, 2, 0, 1, p, D_SHRINK | D_GLOW, 0);
      if (i !== undefined) DOT.v[i] = s;
      if (s >= 2 && rnd() < 0.18 * s) addSmoke(x, y + 2, rr(-5, 5), rr(8, 20), 0, rr(0.4, 0.7), 0.06, P_FIRE);
    },

    debris(x, y, n, palette) {
      const p = palOf(palette);
      for (let k = 0; k < (n || 4); k++) {
        const a = rnd() * TAU, sp = rr(40, 130);
        addDebris(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rr(0.7, 1.4), (rnd() * 6) | 0, rnd() < 0.4, p);
      }
    },

    shockwave(x, y, radius, palette) {
      const p = palOf(palette), R = radius || 40;
      addRing(x, y, 2, R, 0.25 + R / 260, R > 40 ? 3 : 2, Math.min(1.1, 0.35 + R / 150), p, 1, 0);
      addGlow(x, y, R * 0.2, R * 0.6, 0.2, 0.6, G_HOT, p, 0);
    },

    nova(x, y, team) {
      const p = palOf(team);
      let i = nvN;
      if (i >= NV) {           // replace the oldest
        i = 0;
        for (let k = 1; k < NV; k++) if (nvAge[k] > nvAge[i]) i = k;
      } else nvN++;
      nvX[i] = x; nvY[i] = y; nvAge[i] = 0; nvPal[i] = p; nvSeed[i] = seedCounter++ * 7919;
      flashKick(0.5, LIGHT_RGB[p]);
      chromaKick(0.9);
      addFlare(x, y, F_SB_PLUS, 0.24, p, 0);
      addFlare(x, y, F_SB_X, 0.3, P_WHITE, 0.08);
      addGlow(x, y, 8, 60, 0.4, 0.9, G_HOT, p, 0);
      addGlow(x, y, 30, 120, 0.45, 0.7, G_STREAK, p, 0);
      addRing(x, y, 3, 56, 0.32, 3, 0.5, P_WHITE, 1, 0);
      for (let k = 0; k < 70; k++) {
        const a = rnd() * TAU, sp = rr(140, 420);
        addSpark(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rr(0.35, 0.75), rr(1.2, 2.2), 0, rr(0, 0.8), 1.25, k % 3 ? p : P_WHITE, S_GLOW, 0);
      }
      for (let k = 0; k < 28; k++) {
        const a = rnd() * TAU, sp = rr(40, 230);
        addDot(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rr(0.6, 1.2), 1.8, 3 + ((rnd() * 2) | 0), 0, p, D_TWINKLE | D_GLOW | D_BLINK, rr(0, 0.2));
      }
    },

    overdrive(x, y, team) {
      const p = palOf(team);
      flashKick(0.25, LIGHT_RGB[P_GOLD]);
      chromaKick(0.35);
      addRing(x, y, 4, 70, 0.45, 2.5, 0.5, P_GOLD, 1, 0);
      addRing(x, y, 4, 44, 0.5, 1.5, 0, p, 1, 0.06);
      addGlow(x, y, 10, 60, 0.4, 1, G_HOT, P_GOLD, 0);
      addGlow(x, y, 30, 60, 0.35, 0.7, G_STREAK, P_GOLD, 0);
      addFlare(x, y, F_SB_X, 0.2, P_GOLD, 0);
      addBolt(x, y, 0.45, 34, 5, P_GOLD);
      for (let k = 0; k < 50; k++) {
        const a = rnd() * TAU, sp = rr(110, 300);
        addSpark(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rr(0.25, 0.5), 2.5, 0, rr(0, 0.8), 1.1, k < 36 ? P_GOLD : p, S_GLOW, 0);
      }
      for (let k = 0; k < 20; k++) {
        addDot(x + rr(-12, 12), y + rr(-6, 10), rr(-10, 10), rr(-120, -40), rr(0.6, 1.1), 1.2, rnd() < 0.5 ? 2 : 3, 0, k & 1 ? p : P_GOLD, D_TWINKLE | D_GLOW | D_BLINK, rr(0, 0.25));
      }
    },

    graze(x, y) {
      addGlow(x, y, 2, 7, 0.12, 0.7, G_HOT, P_WHITE, 0);
      addDot(x, y, 0, 0, 0.14, 0, 3, 0, P_WHITE, D_GLOW | D_TWINKLE, 0);
      for (let k = 0; k < 2; k++) {
        const a = rnd() * TAU, sp = rr(40, 90);
        addSpark(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rr(0.1, 0.18), 4, 0, 0, 1, P_WHITE, S_GLOW, 0);
      }
    },

    warp(x, y, palette) {
      const p = palOf(palette || 'magenta');
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * TAU + rnd() * 0.3, d = rr(18, 32), t = rr(0.22, 0.3);
        addSpark(x + Math.cos(a) * d, y + Math.sin(a) * d, (-Math.cos(a) * d) / t, (-Math.sin(a) * d) / t, t, 0, 0, 0, 1, p, S_GLOW | S_REV, 0);
      }
      addRing(x, y, 30, 2, 0.3, 1.5, -0.35, p, 1 | 2, 0);
      addGlow(x, y, 4, 8, 0.36, 0.8, G_VSTREAK, p, 0);
      schedule(0.28, x, y, 0, p, 0, 0, EV_WARP_POP);
    },

    pickup(x, y, palette) {
      const p = palOf(palette || 'gold');
      addRing(x, y, 2, 15, 0.26, 1, 0, p, 1, 0);
      addGlow(x, y, 3, 18, 0.24, 0.9, G_HOT, p, 0);
      addFlare(x, y, F_IMPACT, 0.1, P_WHITE, 0);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU + rr(-0.25, 0.25), sp = rr(30, 75);
        addDot(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rr(0.45, 0.75), 3.5, 3, 0, p, D_TWINKLE | D_GLOW | D_BLINK, 0);
      }
      for (let k = 0; k < 5; k++) addDot(x + rr(-5, 5), y + rr(-3, 3), rr(-6, 6), rr(-50, -20), rr(0.4, 0.7), 1, 0, 0, p, D_GLOW | D_BLINK, rr(0, 0.1));
    },

    text(x, y, str, color) {
      let i = txN;
      if (i >= TX) {            // recycle the oldest
        i = 0;
        for (let k = 1; k < TX; k++) if (txAge[k] / txLife[k] > txAge[i] / txLife[i]) i = k;
      } else txN++;
      txX[i] = x; txY[i] = y; txAge[i] = 0; txLife[i] = 0.9;
      txStr[i] = str == null ? '' : '' + str;
      txCol[i] = color || '#ffffff';
    },

    drawBeam(ctx, lctx, x1, y1, x2, y2, width, phase, t, palette) {
      beam(ctx, lctx, x1, y1, x2, y2, width, phase !== 'warn', t || 0, palOf(palette || 'magenta'), false);
    },

    drawPlayerBeam(ctx, lctx, x, y1, y2, width, team, t) {
      beam(ctx, lctx, x, y1, x, y2, width, true, t || 0, palOf(team), true);
    },

    clear() {
      for (let k = 0; k < POOLS.length; k++) POOLS[k].n = 0;
      rgN = 0; nvN = 0; boN_ = 0; evN = 0;
      for (let i = 0; i < txN; i++) txStr[i] = '';
      txN = 0;
      flashA = 0; chromaA = 0; live = 0;
    },

    postState,

    flash(amount, color) {
      let rgb = WHITE_RGB;
      if (typeof color === 'string' && color[0] === '#') rgb = hex2(color).map((v) => v / 255);
      else if (color && color.length >= 3) rgb = color[0] > 1 || color[1] > 1 || color[2] > 1 ? [color[0] / 255, color[1] / 255, color[2] / 255] : color;
      flashKick(amount == null ? 0.5 : amount, rgb);
    },

    chroma(amount) { chromaKick(amount == null ? 0.5 : amount); },

    setTextRenderer(fn) { textFn = typeof fn === 'function' ? fn : null; },

    get count() { return live; },
  };
  return fx;
}

function novaR(age) {
  const k = Math.min(1, age / 1.05);
  return 470 * (1 - Math.pow(1 - k, 2.3));
}

// Exposed for dev/fx.html (atlas inspection); not part of the game contract.
export function _fxArt() { return buildArt(); }
