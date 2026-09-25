// Nova Lancers — small shared helpers (math, deterministic RNG).
//
// Angle convention in the sim: standard screen-space atan2 with y pointing DOWN:
//   direction(a) = (cos a, sin a); a = 0 -> right, a = PI/2 -> down, a = -PI/2 -> up.
// Sprite direction frames use 0 = up, clockwise, so spriteDir = a + PI/2 (see toSpriteDir).

export const TAU = Math.PI * 2;
export const UP = -Math.PI / 2;
export const DOWN = Math.PI / 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const easeOut = (t) => 1 - (1 - t) * (1 - t);
export const easeIn = (t) => t * t;
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
export const angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
export const toSpriteDir = (a) => a + Math.PI / 2;
export const wrapAngle = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
export const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));

// Cubic bezier on scalars
export function bez(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

// Deterministic 32-bit RNG (mulberry32). Same seed -> same sequence on every peer.
export class RNG {
  constructor(seed = 1) { this.s = (seed >>> 0) || 0x9e3779b9; }
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
}

// Hash helpers for seeding
export function hash32(...nums) {
  let h = 2166136261 >>> 0;
  for (const n of nums) {
    h ^= (n | 0);
    h = Math.imul(h, 16777619) >>> 0;
    h ^= h >>> 13;
  }
  return h >>> 0;
}

export function randomSeed() {
  if (window.crypto?.getRandomValues) {
    const a = new Uint32Array(1);
    window.crypto.getRandomValues(a);
    return a[0] >>> 0;
  }
  return (Math.random() * 4294967296) >>> 0;
}

export function fmtScore(n, digits = 7) {
  const s = String(Math.floor(n));
  return s.length >= digits ? s : '0'.repeat(digits - s.length) + s;
}

// Safe localStorage JSON helpers
const store = (() => { try { return window.localStorage; } catch { return null; } })();
export function loadJSON(key, fallback) {
  try { const v = store?.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
export function saveJSON(key, value) {
  try { store?.setItem(key, JSON.stringify(value)); } catch { /* quota / private mode */ }
}
