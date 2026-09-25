// Nova Lancers — deterministic enemy movement paths.
//
// A path is a pure function (e, t, sim) that sets e.x, e.y from t (seconds since spawn)
// and the enemy's JSON params e.p. Because it's closed-form (no integration), every peer
// computes the same position from the same spawn event, no matter when it arrived.
// Optional: set e.face (radians, sim angle convention) to override the heading used for
// rotated sprites (otherwise heading comes from motion). Return true when the path is
// finished (the enemy is then removed silently).
//
// Units: positions px, velocities px/s, times s, angles rad (0 = right, PI/2 = down).

import { bez, clamp, easeOut, easeIn, easeInOut, TAU } from '../util.js';
import { FIELD_W, FIELD_H } from '../config.js';

export const PATHS = {
  // straight line: {x, y, vx, vy, ax=0, ay=0}
  line(e, t) {
    const p = e.p;
    e.x = p.x + (p.vx || 0) * t + 0.5 * (p.ax || 0) * t * t;
    e.y = p.y + (p.vy || 0) * t + 0.5 * (p.ay || 0) * t * t;
  },

  // falling sine weave: {x, y, vy, amp, freq (Hz), ph}
  sine(e, t) {
    const p = e.p;
    e.x = p.x + (p.amp || 30) * Math.sin((p.freq || 0.5) * t * TAU + (p.ph || 0));
    e.y = p.y + (p.vy || 40) * t;
  },

  // zig-zag: {x, y, vy, amp, period}
  zigzag(e, t) {
    const p = e.p;
    const per = p.period || 1.6;
    const ph = ((t / per) % 1 + 1) % 1;
    const tri = ph < 0.5 ? ph * 4 - 1 : 3 - ph * 4;
    e.x = p.x + (p.amp || 40) * tri;
    e.y = p.y + (p.vy || 40) * t;
  },

  // cubic bezier over dur seconds then continue along the end tangent at exitV px/s:
  // {pts:[x0,y0,x1,y1,x2,y2,x3,y3], dur, exitV}
  bezier(e, t) {
    const p = e.p, P = p.pts, d = p.dur || 3;
    if (t <= d) {
      const u = t / d;
      e.x = bez(P[0], P[2], P[4], P[6], u);
      e.y = bez(P[1], P[3], P[5], P[7], u);
    } else {
      let tx = P[6] - P[4], ty = P[7] - P[5];
      const l = Math.hypot(tx, ty) || 1;
      tx /= l; ty /= l;
      const ex = (p.exitV ?? 90) * (t - d);
      e.x = P[6] + tx * ex;
      e.y = P[7] + ty * ex;
    }
  },

  // enter to a point, hold (with sway), then leave:
  // {x,y (start), tx,ty (hold point), tin, hold, sway, swayF, ex, ey (exit point), tout}
  hold(e, t) {
    const p = e.p;
    const tin = p.tin ?? 1.2, hold = p.hold ?? 4, tout = p.tout ?? 2;
    const sway = (p.sway || 0) * Math.sin(t * TAU * (p.swayF || 0.3));
    if (t < tin) {
      const u = easeOut(t / tin);
      e.x = p.x + (p.tx - p.x) * u + sway * u;
      e.y = p.y + (p.ty - p.y) * u;
    } else if (t < tin + hold) {
      e.x = p.tx + sway;
      e.y = p.ty + (p.bob || 0) * Math.sin((t - tin) * TAU * 0.5);
    } else {
      const u = easeIn(Math.min(1, (t - tin - hold) / tout));
      const ex = p.ex ?? p.tx, ey = p.ey ?? FIELD_H + 60;
      e.x = p.tx + sway + (ex - p.tx) * u;
      e.y = p.ty + (ey - p.ty) * u;
      if (t > tin + hold + tout) return true;
    }
  },

  // enter, pause, then dash in a straight line toward (dx,dy) at dv px/s (host may update dx/dy
  // with sim.setParams before the dash begins): {x,y,tx,ty,tin,pause,dx,dy,dv}
  dive(e, t) {
    const p = e.p;
    const tin = p.tin ?? 1, pause = p.pause ?? 0.6;
    if (t < tin) {
      const u = easeOut(t / tin);
      e.x = p.x + (p.tx - p.x) * u;
      e.y = p.y + (p.ty - p.y) * u;
    } else if (t < tin + pause) {
      e.x = p.tx; e.y = p.ty;
      e.face = Math.atan2((p.dy ?? FIELD_H) - p.ty, (p.dx ?? p.tx) - p.tx);
    } else {
      const ang = Math.atan2((p.dy ?? FIELD_H) - p.ty, (p.dx ?? p.tx) - p.tx);
      const s = (t - tin - pause);
      const dist = (p.dv || 220) * s + 60 * s * s;
      e.x = p.tx + Math.cos(ang) * dist;
      e.y = p.ty + Math.sin(ang) * dist;
      e.face = ang;
    }
  },

  // circle around a (possibly moving) center: {cx, cy, cvx, cvy, r, w (rad/s), ph, rin (grow-in time)}
  orbit(e, t) {
    const p = e.p;
    const cx = p.cx + (p.cvx || 0) * t, cy = p.cy + (p.cvy || 0) * t;
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

  // fixed to the scrolling ground (Leviathan Wreck hull): {x, y, sy0}
  ground(e, t, sim) {
    const p = e.p;
    e.x = p.x;
    e.y = p.y + (sim.scrollY - (p.sy0 || 0));
    e.face = e.face ?? Math.PI / 2;
  },

  // attached to a parent enemy: {ox, oy} (+ optional sway)
  attach(e, t, sim) {
    const par = sim.enemies.get(e.parent);
    if (par) {
      e.x = par.x + (e.p.ox || 0) + (e.p.sway || 0) * Math.sin(t * TAU * (e.p.swayF || 0.5));
      e.y = par.y + (e.p.oy || 0);
    }
  },

  // homing-by-segments: flies toward (dx,dy) set by the host (sim.setParams) at speed v.
  // Deterministic because the host re-issues the target: {x,y,dx,dy,v,t0p}
  seek(e, t) {
    const p = e.p;
    const since = t - (p.tp || 0);
    const ox = p.ox ?? p.x, oy = p.oy ?? p.y;
    const ang = Math.atan2(p.dy - oy, p.dx - ox);
    e.x = ox + Math.cos(ang) * (p.v || 100) * since;
    e.y = oy + Math.sin(ang) * (p.v || 100) * since;
    e.face = ang;
  },

  // static position (used by bosses with custom motion in their own path fn)
  still(e) { e.x = e.p.x; e.y = e.p.y; },
};

// Helpers for authors ------------------------------------------------------------------

// Build a bezier params object from points + duration.
export function bz(x0, y0, x1, y1, x2, y2, x3, y3, dur = 3, exitV = 90) {
  return { pts: [x0, y0, x1, y1, x2, y2, x3, y3], dur, exitV };
}

export function clampToField(x, pad = 12) { return clamp(x, pad, FIELD_W - pad); }

export { easeInOut };
