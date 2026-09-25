// Nova Lancers — deterministic enemy movement paths.
//
// A path is a pure function (e, t, sim) that sets e.x, e.y from t (seconds since spawn)
// and the enemy's JSON params e.p. Because it's closed-form (no integration), every peer
// computes the same position from the same spawn event, no matter when it arrived.
// Paths may also read e.phase / e.phaseT0 (tick), e.pT (tick of the last setParams),
// sim.scrollY and the parent enemy (sim.enemies.get(e.parent)). They must NOT use
// Math.random, accumulate state between calls, read player positions or read e.data.
// Optional: set e.face (radians, sim angle convention) to override the heading used for
// rotated sprites (otherwise heading comes from motion). Return true when the path is
// finished (the enemy is then removed silently).
//
// Every param has a sensible default so `{ x }` alone is enough to put an enemy on screen.
// Host-side helpers at the bottom (hoverTo / hoverLeave / seekTurn / pathAt) re-plan a
// path mid-flight with ONE sim.setParams event while keeping the motion continuous.
//
// Units: positions px, velocities px/s, times s, angles rad (0 = right, PI/2 = down).

import { bez, clamp, easeOut, easeIn, easeInOut, TAU } from '../util.js';
import { FIELD_W, FIELD_H } from '../config.js';

const CX = FIELD_W / 2;
const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;   // times: keep sub-ms precision so re-plans stay seamless

// Derivative of a cubic bezier on scalars (for exit tangents / facing)
function bezD(p0, p1, p2, p3, u) {
  const v = 1 - u;
  return 3 * v * v * (p1 - p0) + 6 * v * u * (p2 - p1) + 3 * u * u * (p3 - p2);
}

// Evaluate a bezier control-point array [x0,y0,x1,y1,x2,y2,x3,y3] for `d` seconds, then
// continue along the end tangent at exitV px/s.
function runBezier(e, P, d, exitV, t) {
  if (t <= d) {
    const u = t / d;
    e.x = bez(P[0], P[2], P[4], P[6], u);
    e.y = bez(P[1], P[3], P[5], P[7], u);
  } else {
    let tx = P[6] - P[4], ty = P[7] - P[5];
    if (Math.abs(tx) + Math.abs(ty) < 1e-6) { tx = P[6] - P[0]; ty = P[7] - P[1]; }
    const l = Math.hypot(tx, ty) || 1;
    tx /= l; ty /= l;
    const ex = (exitV ?? 90) * (t - d);
    e.x = P[6] + tx * ex;
    e.y = P[7] + ty * ex;
  }
}

// Swoop presets, authored for side = -1 (entering from the LEFT edge); mirrored for side 1.
// y = entry height, d = depth (how far the swoop dips below y).
const SWOOPS = {
  // U-dip across the screen, leaves on the far side a little higher
  u: (y, d) => [-16, y, 70, y + d * 1.25, 170, y + d * 1.25, FIELD_W + 16, y - 10],
  // dive in, hook back toward the entry side and exit downward
  hook: (y, d) => [-16, y, 160, y - 10, 210, y + d, 70, y + d * 1.4],
  // S-curve across and down
  s: (y, d) => [-16, y, 230, y + d * 0.2, 10, y + d * 0.8, FIELD_W + 16, y + d],
  // poke in, dip, retreat to the same side
  dip: (y, d) => [-16, y, 150, y + d * 0.35, 150, y + d * 0.9, -16, y + d * 0.6],
  // wide arc from the top corner sweeping across and down
  arc: (y, d) => [-16, y, 90, y - 10, FIELD_W - 20, y + d * 0.4, FIELD_W - 60, y + d * 1.4],
  // straight dash across, sagging slightly
  pass: (y, d) => [-16, y, 80, y + d * 0.25, 160, y + d * 0.25, FIELD_W + 16, y],
};
export const SWOOP_PRESETS = Object.keys(SWOOPS);

export function swoopPts(side = -1, preset = 'u', y = 60, depth = 120, x0 = 0) {
  const f = SWOOPS[preset] || SWOOPS.u;
  const P = f(y, depth);
  if (side > 0) for (let i = 0; i < 8; i += 2) P[i] = FIELD_W - P[i];
  if (x0) for (let i = 0; i < 8; i += 2) P[i] += x0 * (side > 0 ? -1 : 1);
  return P;
}

// Base (un-swayed) position of the 'hover' path at time t
export function hoverBase(p, t) {
  const tx = p.tx ?? p.x ?? CX, ty = p.ty ?? 90;
  if (p.mt !== undefined) {
    // (t can sit a hair before mt because mt is rounded — clamp instead of falling through)
    const u = easeInOut(clamp((t - p.mt) / (p.md || 1), 0, 1));
    const mx = p.mx ?? tx, my = p.my ?? ty;
    return [mx + (tx - mx) * u, my + (ty - my) * u, u];
  }
  const tin = p.tin ?? 1.2;
  const u = easeOut(clamp(t / tin, 0, 1));
  const x0 = p.x ?? tx, y0 = p.y ?? -24;
  return [x0 + (tx - x0) * u, y0 + (ty - y0) * u, 1];
}

export const PATHS = {
  // straight line: {x, y, vx, vy, ax=0, ay=0}
  line(e, t) {
    const p = e.p;
    e.x = (p.x ?? CX) + (p.vx || 0) * t + 0.5 * (p.ax || 0) * t * t;
    e.y = (p.y ?? -20) + (p.vy ?? 40) * t + 0.5 * (p.ay || 0) * t * t;
  },

  // falling sine weave: {x, y, vy, amp, freq (Hz), ph}
  sine(e, t) {
    const p = e.p;
    e.x = (p.x ?? CX) + (p.amp ?? 30) * Math.sin((p.freq || 0.5) * t * TAU + (p.ph || 0));
    e.y = (p.y ?? -20) + (p.vy ?? 40) * t;
  },

  // zig-zag: {x, y, vy, amp, period}
  zigzag(e, t) {
    const p = e.p;
    const per = p.period || 1.6;
    const ph = ((t / per) % 1 + 1) % 1;
    const tri = ph < 0.5 ? ph * 4 - 1 : 3 - ph * 4;
    e.x = (p.x ?? CX) + (p.amp ?? 40) * tri;
    e.y = (p.y ?? -20) + (p.vy ?? 40) * t;
  },

  // cubic bezier over dur seconds then continue along the end tangent at exitV px/s:
  // {pts:[x0,y0,x1,y1,x2,y2,x3,y3], dur, exitV}   (build with bz(...))
  bezier(e, t) {
    const p = e.p;
    const P = p.pts || [CX, -20, CX, 100, CX, 200, CX, 420];
    runBezier(e, P, p.dur || 3, p.exitV, t);
  },

  // swoop in from a side along a preset curve: {side:-1 (from left)|1, y (entry height),
  // preset:'u'|'hook'|'s'|'dip'|'arc'|'pass', depth (px), dur (s), exitV (px/s), x0 (inset)}
  swoop(e, t) {
    const p = e.p;
    const P = swoopPts(p.side || -1, p.preset || 'u', p.y ?? 60, p.depth ?? 120, p.x0 || 0);
    runBezier(e, P, p.dur || 3, p.exitV ?? 110, t);
  },

  // enter to a point, hold (with sway), then leave:
  // {x,y (start), tx,ty (hold point), tin, hold, sway, swayF, bob, ex, ey (exit point), tout}
  hold(e, t) {
    const p = e.p;
    const x0 = p.x ?? CX, y0 = p.y ?? -24;
    const tx = p.tx ?? x0, ty = p.ty ?? 90;
    const tin = p.tin ?? 1.2, hold = p.hold ?? 4, tout = p.tout ?? 2;
    const sway = (p.sway || 0) * Math.sin(t * TAU * (p.swayF || 0.3));
    if (t < tin) {
      const u = easeOut(t / tin);
      e.x = x0 + (tx - x0) * u + sway * u;
      e.y = y0 + (ty - y0) * u;
    } else if (t < tin + hold) {
      e.x = tx + sway;
      e.y = ty + (p.bob || 0) * Math.sin((t - tin) * TAU * 0.5);
    } else {
      const u = easeIn(Math.min(1, (t - tin - hold) / tout));
      const ex = p.ex ?? tx, ey = p.ey ?? FIELD_H + 60;
      e.x = tx + sway + (ex - tx) * u;
      e.y = ty + (ey - ty) * u;
      if (t > tin + hold + tout) return true;
    }
  },

  // enter, pause, then dash in a straight line toward (dx,dy) at dv px/s (accelerating).
  // The host updates dx/dy with sim.setParams at/after t = tin (the lancet does this):
  // {x,y,tx,ty,tin,pause,dx,dy,dv,dacc}
  dive(e, t) {
    const p = e.p;
    const x0 = p.x ?? CX, y0 = p.y ?? -24;
    const tx = p.tx ?? x0, ty = p.ty ?? 80;
    const tin = p.tin ?? 1, pause = p.pause ?? 0.6;
    const ang = Math.atan2((p.dy ?? FIELD_H) - ty, (p.dx ?? tx) - tx);
    if (t < tin) {
      const u = easeOut(t / tin);
      e.x = x0 + (tx - x0) * u;
      e.y = y0 + (ty - y0) * u;
      e.face = Math.PI / 2;
    } else if (t < tin + pause) {
      // wind-up: back off a few px against the dive direction (reads as "coiling")
      const k = (t - tin) / pause;
      const back = 4 * Math.sin(k * Math.PI * 0.5);
      e.x = tx - Math.cos(ang) * back;
      e.y = ty - Math.sin(ang) * back;
      e.face = ang;
    } else {
      const s = (t - tin - pause);
      const dist = (p.dv || 220) * s + 0.5 * (p.dacc ?? 120) * s * s - 4;
      e.x = tx + Math.cos(ang) * dist;
      e.y = ty + Math.sin(ang) * dist;
      e.face = ang;
    }
  },

  // circle around a (possibly moving) center: {cx, cy, cvx, cvy, r, w (rad/s), ph, rin (grow-in time)}
  orbit(e, t) {
    const p = e.p;
    const cx = (p.cx ?? CX) + (p.cvx || 0) * t, cy = (p.cy ?? 100) + (p.cvy || 0) * t;
    const r = (p.r || 40) * (p.rin ? Math.min(1, t / p.rin) : 1);
    const a = (p.ph || 0) + (p.w || 1.5) * t;
    e.x = cx + Math.cos(a) * r;
    e.y = cy + Math.sin(a) * r;
  },

  // swoop in from a side, loop, and exit: {side:-1|1, y, r, speed}
  loop(e, t) {
    const p = e.p;
    const side = p.side || -1;
    const sp = p.speed || 120;
    const r = p.r || 36;
    const y0 = p.y ?? 80;
    const startX = side < 0 ? -20 : FIELD_W + 20;
    const cx = FIELD_W / 2 + side * -10;
    const t1 = Math.abs(cx - startX) / sp;
    if (t < t1) {
      e.x = startX - side * sp * t;
      e.y = y0;
    } else {
      const circ = TAU * r / sp;
      if (t < t1 + circ) {
        const a = ((t - t1) / circ) * TAU;
        e.x = cx + side * -Math.sin(a) * r;
        e.y = y0 + r - Math.cos(a) * r;
      } else {
        e.x = cx - side * sp * (t - t1 - circ);
        e.y = y0;
      }
    }
  },

  // fixed to the scrolling ground (Leviathan Wreck hull): {x, y, sy0, rail, railF}
  // sy0 = sim.scrollY at spawn (pass it!). Fallback when missing: derived from the spawn tick.
  // rail: optional lateral slide amplitude (px) along a hull track, railF Hz.
  ground(e, t, sim) {
    const p = e.p;
    const sy0 = p.sy0 ?? (e.t0 / 60) * (sim.scrollSpeed || 30);
    e.x = (p.x ?? CX) + (p.rail ? p.rail * Math.sin(t * TAU * (p.railF || 0.15)) : 0);
    e.y = (p.y ?? -16) + (sim.scrollY - sy0);
    e.face = e.face ?? Math.PI / 2;
  },

  // attached to a parent enemy: {ox, oy} (+ optional sway, swayF)
  attach(e, t, sim) {
    const par = sim.enemies.get(e.parent);
    if (par) {
      e.x = par.x + (e.p.ox || 0) + (e.p.sway || 0) * Math.sin(t * TAU * (e.p.swayF || 0.5));
      e.y = par.y + (e.p.oy || 0);
    }
  },

  // orbit a parent enemy: {r, w (rad/s), ph, rin (grow-in s), ox, oy (center offset)}
  satellite(e, t, sim) {
    const par = sim.enemies.get(e.parent);
    const p = e.p;
    const cx = (par ? par.x : (p.x ?? CX)) + (p.ox || 0);
    const cy = (par ? par.y : (p.y ?? 100)) + (p.oy || 0);
    const r = (p.r || 30) * (p.rin ? Math.min(1, t / p.rin) : 1);
    const a = (p.ph || 0) + (p.w ?? 1.2) * t;
    e.x = cx + Math.cos(a) * r;
    e.y = cy + Math.sin(a) * r;
    e.face = a + Math.PI / 2 * Math.sign(p.w ?? 1.2);
  },

  // Homing-by-segments. The host re-issues the steering with sim.setParams (see seekTurn):
  //  - straight form (legacy): {x,y,dx,dy,v,tp,ox,oy} flies from (ox,oy) toward (dx,dy)
  //  - arc form: {ox,oy,tp,a0,a1,tt,v} turns from heading a0 to a1 over tt seconds at a
  //    constant rate (closed-form arc), then continues straight along a1.
  seek(e, t) {
    const p = e.p;
    const v = p.v || 100;
    const s = Math.max(0, t - (p.tp || 0));
    const ox = p.ox ?? p.x ?? CX, oy = p.oy ?? p.y ?? -20;
    if (p.a1 === undefined) {
      const ang = Math.atan2((p.dy ?? FIELD_H) - oy, (p.dx ?? ox) - ox);
      e.x = ox + Math.cos(ang) * v * s;
      e.y = oy + Math.sin(ang) * v * s;
      e.face = ang;
      return;
    }
    const a0 = p.a0 ?? p.a1, a1 = p.a1, tt = p.tt || 0.25;
    const w = (a1 - a0) / tt;
    if (Math.abs(w) < 1e-4) {
      e.x = ox + Math.cos(a1) * v * s;
      e.y = oy + Math.sin(a1) * v * s;
      e.face = a1;
      return;
    }
    const sa = Math.min(s, tt);
    const a = a0 + w * sa;
    let x = ox + v * (Math.sin(a) - Math.sin(a0)) / w;
    let y = oy - v * (Math.cos(a) - Math.cos(a0)) / w;
    if (s > tt) { x += Math.cos(a1) * v * (s - tt); y += Math.sin(a1) * v * (s - tt); }
    e.x = x; e.y = y;
    e.face = s > tt ? a1 : a;
  },

  // static position (used by bosses with custom motion in their own path fn)
  still(e) { e.x = e.p.x ?? CX; e.y = e.p.y ?? 90; },

  // horizontal strafing pass at a height: {side:-1 (enter left)|1, y, v (px/s), amp, freq (Hz),
  // dip (px/s downward drift), x0 (start x override)}
  strafe(e, t) {
    const p = e.p;
    const side = p.side || -1;
    const x0 = p.x0 ?? (side < 0 ? -22 : FIELD_W + 22);
    e.x = x0 - side * (p.v ?? 60) * t;
    e.y = (p.y ?? 70) + (p.dip || 0) * t + (p.amp || 0) * Math.sin(t * TAU * (p.freq || 0.3));
    e.face = side < 0 ? 0 : Math.PI;
  },

  // rigid offset from a moving leader: {lpath (any path name, default 'line'), lp (leader
  // params object), ox, oy (offset), grow (s: offsets fan out from 0), rot (1: rotate offset
  // with the leader's heading; offsets are authored for a leader heading DOWN)}
  formation(e, t, sim) {
    const p = e.p;
    const fn = PATHS[p.lpath || 'line'];
    const L = { p: p.lp || {}, x: 0, y: 0, parent: e.parent, phase: e.phase, phaseT0: e.phaseT0, t0: e.t0, id: e.id, face: undefined };
    const done = fn(L, t, sim);
    let ox = p.ox || 0, oy = p.oy || 0;
    if (p.grow) { const g = easeOut(Math.min(1, t / p.grow)); ox *= g; oy *= g; }
    if (p.rot) {
      let hd = L.face;
      if (hd === undefined) {
        // heading from a short chord of the leader path. Near t = 0 look FORWARD instead of back:
        // a zero-length chord used to fall back to "down", so rotated members popped up to ~50 px
        // on their 2nd tick (the host could reap a member that popped outside the field while a
        // late-joining client never saw it inside → ghost enemy on the client).
        const lx = L.x, ly = L.y;
        const back = t >= 1 / 30;
        fn(L, back ? t - 1 / 30 : t + 1 / 30, sim);
        const dx = back ? lx - L.x : L.x - lx, dy = back ? ly - L.y : L.y - ly;
        hd = Math.hypot(dx, dy) > 1e-3 ? Math.atan2(dy, dx) : Math.PI / 2;
        L.x = lx; L.y = ly;
      }
      const r = hd - Math.PI / 2, c = Math.cos(r), s = Math.sin(r);
      const rx = ox * c - oy * s, ry = ox * s + oy * c;
      ox = rx; oy = ry;
      e.face = hd;
    }
    e.x = L.x + ox;
    e.y = L.y + oy;
    return done;
  },

  // spiral in toward a center, orbit, then spiral out and leave:
  // {cx, cy, r0, r1, w (rad/s, sign = direction), ph, dur (spiral-in s), hold (s), outV (px/s)}
  spiralIn(e, t) {
    const p = e.p;
    const cx = p.cx ?? CX, cy = p.cy ?? 110;
    const r0 = p.r0 ?? 170, r1 = p.r1 ?? 50, dur = p.dur ?? 2.5, hold = p.hold ?? 3;
    let r;
    if (t < dur) r = r0 + (r1 - r0) * easeOut(t / dur);
    else if (t < dur + hold) r = r1;
    else r = r1 + (p.outV ?? 70) * (t - dur - hold);
    const a = (p.ph ?? -Math.PI / 2) + (p.w ?? 1.4) * t;
    e.x = cx + Math.cos(a) * r;
    e.y = cy + Math.sin(a) * r;
    if (r > 420) return true;
  },

  // asteroid drift: slow line + gentle wobble ("tumble"): {x, y, vx, vy, wob (px), wobF (Hz), ph}
  drift(e, t) {
    const p = e.p;
    const wob = p.wob ?? 3;
    const w = Math.sin(t * TAU * (p.wobF || 0.35) + (p.ph || 0));
    e.x = (p.x ?? CX) + (p.vx || 0) * t + wob * w;
    e.y = (p.y ?? -24) + (p.vy ?? 32) * t + wob * 0.4 * Math.cos(t * TAU * (p.wobF || 0.35) * 0.5 + (p.ph || 0));
  },

  // enter to a hover point and stay; the host can re-plan with hoverTo()/hoverLeave():
  // {x,y (start), tx,ty (hover point), tin (entry s), sway (px), swayF (Hz), bob (px), bobF (Hz), ph,
  //  mx,my,mt,md (current move: from, start time, duration — written by hoverTo), lv (1 = leaving:
  //  path ends when the move completes)}
  hover(e, t) {
    const p = e.p;
    const b = hoverBase(p, t);
    const k = Math.min(1, t / (p.tin ?? 1.2));
    e.x = b[0] + (p.sway || 0) * Math.sin(t * TAU * (p.swayF || 0.25) + (p.ph || 0)) * k;
    e.y = b[1] + (p.bob ?? 3) * Math.sin(t * TAU * (p.bobF || 0.5) + (p.ph || 0) * 0.7) * k;
    if (p.lv && b[2] >= 1) return true;
  },

  // figure-8 (lissajous) hover around a center, then leave:
  // {x,y (start), cx,cy, ax,ay (px), fx,fy (Hz), ph, tin, life (s, 0 = forever), ex,ey (exit), tout}
  lissa(e, t) {
    const p = e.p;
    const tin = p.tin ?? 1.4;
    const cx = p.cx ?? p.x ?? CX, cy = p.cy ?? 100;
    const u = easeOut(Math.min(1, t / tin));
    const ox = (p.ax ?? 50) * Math.sin(t * TAU * (p.fx ?? 0.2) + (p.ph || 0));
    const oy = (p.ay ?? 18) * Math.sin(t * TAU * (p.fy ?? 0.4) + (p.ph || 0) * 2);
    const x0 = p.x ?? cx, y0 = p.y ?? -24;
    let x = x0 + (cx - x0) * u + ox * u;
    let y = y0 + (cy - y0) * u + oy * u;
    if (p.life && t > tin + p.life) {
      const tout = p.tout ?? 2;
      const k = easeIn(Math.min(1, (t - tin - p.life) / tout));
      const ex = p.ex ?? x, ey = p.ey ?? -60;
      x += (ex - x) * k; y += (ey - y) * k;
      if (k >= 1) { e.x = x; e.y = y; return true; }
    }
    e.x = x; e.y = y;
  },

  // circular arc from angle a0 to a1 around (cx,cy) over dur, then exit on the tangent:
  // {cx, cy, r, a0, a1, dur, exitV}
  arc(e, t) {
    const p = e.p;
    const cx = p.cx ?? CX, cy = p.cy ?? 0, r = p.r ?? 120;
    const a0 = p.a0 ?? Math.PI, a1 = p.a1 ?? 0, dur = p.dur || 3;
    if (t <= dur) {
      const a = a0 + (a1 - a0) * (t / dur);
      e.x = cx + Math.cos(a) * r;
      e.y = cy + Math.sin(a) * r;
    } else {
      const dir = Math.sign(a1 - a0) || 1;
      const tx = -Math.sin(a1) * dir, ty = Math.cos(a1) * dir;
      const s = (p.exitV ?? 100) * (t - dur);
      e.x = cx + Math.cos(a1) * r + tx * s;
      e.y = cy + Math.sin(a1) * r + ty * s;
    }
  },
};

// Helpers for authors ------------------------------------------------------------------

// Build a bezier params object from points + duration.
export function bz(x0, y0, x1, y1, x2, y2, x3, y3, dur = 3, exitV = 90) {
  return { pts: [x0, y0, x1, y1, x2, y2, x3, y3], dur, exitV };
}

// Mirror a bz(...) params object horizontally (left <-> right).
export function mirrorBz(o) {
  const P = o.pts.slice();
  for (let i = 0; i < 8; i += 2) P[i] = FIELD_W - P[i];
  return Object.assign({}, o, { pts: P });
}

// Swoop params: swoop(-1, 'hook', 50) -> { path:'swoop', side:-1, preset:'hook', y:50, ... }
export function swoop(side, preset = 'u', y = 60, depth = 120, dur = 3, exitV = 110) {
  return { path: 'swoop', side, preset, y, depth, dur, exitV };
}

// Formation offsets (px) for n members: shape 'vee'|'line'|'column'|'diamond'|'circle'|'arrow'|'wall'
export function formationOffsets(shape, n, sp = 18) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = i - (n - 1) / 2;
    switch (shape) {
      case 'line': out.push([k * sp, 0]); break;
      case 'column': out.push([0, -i * sp]); break;
      case 'wall': out.push([(i % 4 - 1.5) * sp, -Math.floor(i / 4) * sp]); break;
      case 'circle': { const a = (TAU * i) / n; out.push([Math.cos(a) * sp * 1.4, Math.sin(a) * sp * 1.4]); break; }
      case 'diamond': {
        const D = [[0, sp], [-sp, 0], [sp, 0], [0, -sp], [-2 * sp, -sp], [2 * sp, -sp], [0, -2 * sp], [-sp, -2 * sp], [sp, -2 * sp]];
        out.push(D[i % D.length]); break;
      }
      case 'arrow': { const j = Math.ceil(i / 2), s = i % 2 ? -1 : 1; out.push([s * j * sp * 0.8, -j * sp * 0.9]); break; }
      default: { // vee: leader in front, wings trailing back
        const j = Math.ceil(i / 2), s = i % 2 ? -1 : 1; out.push([s * j * sp, -j * sp * 0.7]);
      }
    }
  }
  return out;
}

export function clampToField(x, pad = 12) { return clamp(x, pad, FIELD_W - pad); }

// Evaluate an enemy's path at an arbitrary time t without touching the enemy.
// Returns { x, y, face }. Pure — safe on every peer.
export function pathAt(e, t, sim, p) {
  const fn = typeof e.path === 'function' ? e.path : (PATHS[e.path] || (e.def && e.def.paths && e.def.paths[e.path]));
  const tmp = { p: p || e.p, x: e.x, y: e.y, parent: e.parent, phase: e.phase, phaseT0: e.phaseT0, t0: e.t0, pT: e.pT, id: e.id, face: undefined, def: e.def };
  if (fn) fn(tmp, t, sim);
  return tmp;
}

// HOST: move a 'hover' enemy to (tx,ty) over dur seconds (eased), continuing smoothly from
// wherever it is now. extra: more params to set in the same event (e.g. { lv: 1 }).
export function hoverTo(sim, e, tx, ty, dur = 1.2, extra) {
  const t = (sim.tick - e.t0) / 60;
  const b = hoverBase(e.p, t);
  sim.setParams(e, Object.assign({ mx: r2(b[0]), my: r2(b[1]), tx: r2(tx), ty: r2(ty), mt: r4(t), md: dur }, extra || {}));
}

// HOST: send a 'hover' enemy off screen (up by default) — the path ends when it arrives.
export function hoverLeave(sim, e, ex, ey = -70, dur = 1.8) {
  hoverTo(sim, e, ex ?? e.x, ey, dur, { lv: 1 });
}

// HOST: steer a 'seek' enemy toward (tx,ty), turning at most maxTurn radians over tt seconds.
export function seekTurn(sim, e, tx, ty, maxTurn = 1.1, tt = 0.3) {
  const t = (sim.tick - e.t0) / 60;
  const cur = pathAt(e, t, sim);
  let a0 = cur.face ?? Math.PI / 2;
  let want = Math.atan2(ty - cur.y, tx - cur.x);
  let d = want - a0;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  d = clamp(d, -maxTurn, maxTurn);
  // keep angles small numbers
  while (a0 > Math.PI) a0 -= TAU;
  while (a0 < -Math.PI) a0 += TAU;
  sim.setParams(e, { ox: r2(cur.x), oy: r2(cur.y), tp: r4(t), a0: r4(a0), a1: r4(a0 + d), tt });
}

export { easeInOut };
