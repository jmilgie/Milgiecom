// Nova Lancers — enemy bullets, beams and emitters (deterministic, pooled) + player bullets.
//
// Enemy bullets are spawned ONLY by pattern functions (js/game/patterns.js) which run on
// every peer from host 'fire' events, so all peers simulate identical bullets. Units:
// positions in field px, speeds in px/tick (60 ticks/s), angles in radians (0 = right,
// PI/2 = down).

import { FIELD_W, FIELD_H } from '../config.js';
import { toSpriteDir } from '../util.js';

const MARGIN = 28;

// Default hit radius per enemy-bullet sprite family
export function bulletRadius(spr) {
  if (spr.startsWith('eb_small')) return 2;
  if (spr.startsWith('eb_orb')) return 3.5;
  if (spr.startsWith('eb_big')) return 6;
  if (spr.startsWith('eb_needle')) return 1.6;
  if (spr.startsWith('eb_star')) return 3;
  if (spr.startsWith('eb_ring')) return 4;
  return 2.5;
}

export class EnemyBullets {
  constructor() {
    this.list = [];
    this.pool = [];
  }

  // spec: { x, y, a, v, spr, r, acc, vmin, vmax, spin, spinT, delay, life, home, homeRate, homeT,
  //         grav, wave:{amp, freq}, burst:{t, pat, args}, noGraze }
  spawn(spec) {
    const b = this.pool.pop() || {};
    b.x = spec.x; b.y = spec.y;
    b.a = spec.a || 0; b.v = spec.v ?? 1.5;
    b.spr = spec.spr || 'eb_small_p';
    b.r = spec.r ?? bulletRadius(b.spr);
    b.acc = spec.acc || 0;
    b.vmin = spec.vmin ?? 0; b.vmax = spec.vmax ?? 8;
    b.spin = spec.spin || 0; b.spinT = spec.spinT ?? 1e9;
    b.delay = spec.delay || 0;
    b.life = spec.life || 900;
    b.home = spec.home ?? -1; b.homeRate = spec.homeRate || 0.03; b.homeT = spec.homeT ?? 90;
    b.grav = spec.grav || 0; b.gy = 0;
    b.wave = spec.wave || null;
    b.burst = spec.burst || null;
    b.grazed = !!spec.noGraze;
    b.age = 0; b.dead = false;
    b.seed = spec.seed || 0;
    b.vx = Math.cos(b.a) * b.v; b.vy = Math.sin(b.a) * b.v;
    b.dirty = false;
    b.frameOff = (spec.frameOff ?? ((b.x * 7 + b.y * 13) | 0)) & 7;
    this.list.push(b);
    return b;
  }

  step(b, sim) {
    b.age++;
    if (b.age <= b.delay) return;
    let turned = false;
    if (b.spin && b.age < b.spinT) { b.a += b.spin; turned = true; }
    if (b.acc) {
      const nv = Math.min(b.vmax, Math.max(b.vmin, b.v + b.acc));
      if (nv !== b.v) { b.v = nv; turned = true; }
    }
    if (b.home >= 0 && b.age < b.homeT) {
      const p = sim.players[b.home];
      if (p && p.alive) {
        const want = Math.atan2(p.y - b.y, p.x - b.x);
        let d = want - b.a;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        b.a += Math.max(-b.homeRate, Math.min(b.homeRate, d));
        turned = true;
      }
    }
    if (turned) { b.vx = Math.cos(b.a) * b.v; b.vy = Math.sin(b.a) * b.v; }
    b.x += b.vx;
    b.y += b.vy;
    if (b.grav) { b.gy += b.grav; b.y += b.gy; }
    if (b.wave) {
      const w = b.wave, k = b.age - b.delay;
      const off = w.amp * (Math.sin(k * w.freq) - Math.sin((k - 1) * w.freq));
      b.x += -Math.sin(b.a) * off;
      b.y += Math.cos(b.a) * off;
    }
    if (b.burst && b.age - b.delay === b.burst.t) {
      b.dead = true;
      sim.runPattern(b.burst.pat, b.x, b.y, b.burst.args || {}, (b.seed ^ (b.age * 2654435761)) >>> 0, 0);
      return;
    }
    if (b.age > b.life || b.x < -MARGIN || b.x > FIELD_W + MARGIN || b.y < -MARGIN - 40 || b.y > FIELD_H + MARGIN) {
      b.dead = true;
    }
  }

  update(sim) {
    const L = this.list;
    for (let i = 0; i < L.length; i++) { const b = L[i]; if (!b.dead) this.step(b, sim); }
    this.compact();
  }

  compact() {
    const L = this.list;
    let j = 0;
    for (let i = 0; i < L.length; i++) {
      const b = L[i];
      if (b.dead) this.pool.push(b); else L[j++] = b;
    }
    L.length = j;
  }

  // Turn every live bullet into a little pop (nova / stage clear / boss death)
  clear(onEach) {
    for (const b of this.list) {
      if (b.dead) continue;
      b.dead = true;
      if (onEach) onEach(b);
    }
    this.compact();
  }

  draw(ctx, lctx, env, tick) {
    const S = env.sprites;
    for (const b of this.list) {
      if (b.dead || b.age < 0) continue;
      const fr = ((tick >> 2) + b.frameOff);
      const opt = S.optDir(b.spr, b.a);
      if (b.age <= b.delay) {
        // telegraph: bullets waiting to launch flicker in
        if ((b.age >> 1) & 1) continue;
      }
      S.draw(ctx, b.spr, fr, b.x, b.y, opt);
      S.drawE(lctx, b.spr, fr, b.x, b.y, opt);
    }
  }
}

// Beams: telegraphed lasers. { x, y, a, av (rad/tick), len, w, warn (ticks), dur (ticks),
// follow (enemy id), ox, oy, pal }
export class Beams {
  constructor() { this.list = []; }
  spawn(spec) {
    const b = {
      x: spec.x, y: spec.y, a: spec.a ?? Math.PI / 2, av: spec.av || 0,
      len: spec.len || 520, w: spec.w || 8, warn: spec.warn ?? 50, dur: spec.dur ?? 70,
      follow: spec.follow || 0, ox: spec.ox || 0, oy: spec.oy || 0, pal: spec.pal || 'magenta',
      age: 0, dead: false, avT: spec.avT ?? 1e9, sfxLoop: null,
    };
    this.list.push(b);
    return b;
  }
  step(b, sim) {
    b.age++;
    if (b.follow) {
      const e = sim.enemies.get(b.follow);
      if (e && e.alive) { b.x = e.x + b.ox; b.y = e.y + b.oy; }
      else if (b.age < b.warn) { b.dead = true; }
    }
    if (b.age > b.warn && b.age - b.warn < b.avT) b.a += b.av;
    if (b.age > b.warn + b.dur) b.dead = true;
  }
  update(sim) {
    for (const b of this.list) this.step(b, sim);
    if (this.list.some((b) => b.dead)) {
      for (const b of this.list) if (b.dead && b.sfxLoop) { b.sfxLoop.stop(0.15); b.sfxLoop = null; }
      this.list = this.list.filter((b) => !b.dead);
    }
  }
  firing(b) { return b.age > b.warn && b.age <= b.warn + b.dur; }
  // distance from point to beam segment
  hits(b, px, py, r) {
    if (!this.firing(b)) return false;
    const dx = Math.cos(b.a), dy = Math.sin(b.a);
    const rx = px - b.x, ry = py - b.y;
    const along = rx * dx + ry * dy;
    if (along < 0 || along > b.len) return false;
    const perp = Math.abs(rx * dy - ry * dx);
    // beam thickness ramps up over the first few ticks of firing
    const k = Math.min(1, (b.age - b.warn) / 6);
    return perp < b.w * 0.5 * k + r;
  }
  draw(ctx, lctx, env, tick) {
    for (const b of this.list) {
      const x2 = b.x + Math.cos(b.a) * b.len, y2 = b.y + Math.sin(b.a) * b.len;
      const phase = b.age <= b.warn ? 'warn' : 'fire';
      let w = b.w;
      if (phase === 'fire') {
        const k = Math.min(1, (b.age - b.warn) / 6);
        const endFade = Math.min(1, (b.warn + b.dur - b.age) / 8);
        w = b.w * k * Math.max(0.15, endFade);
      }
      env.fx.drawBeam(ctx, lctx, b.x, b.y, x2, y2, w, phase, tick / 60, b.pal);
    }
  }
}

// Emitters: deterministic timed bullet sources (spirals, streams, sprays).
// { x, y, follow, ox, oy, delay, every, count, fn(sim, em, k) }  — fn spawns the k-th volley.
export class Emitters {
  constructor() { this.list = []; }
  spawn(spec) {
    const em = Object.assign({ age: 0, fired: 0, dead: false, delay: 0, every: 6, count: 10, follow: 0, ox: 0, oy: 0 }, spec);
    this.list.push(em);
    return em;
  }
  step(em, sim) {
    em.age++;
    if (em.follow) {
      const e = sim.enemies.get(em.follow);
      if (!e || !e.alive) { em.dead = true; return; }
      em.x = e.x + em.ox; em.y = e.y + em.oy;
    }
    if (em.age < em.delay) return;
    if ((em.age - em.delay) % em.every === 0) {
      em.fn(sim, em, em.fired);
      em.fired++;
      if (em.fired >= em.count) em.dead = true;
    }
  }
  update(sim) {
    for (const em of this.list) if (!em.dead) this.step(em, sim);
    if (this.list.some((e) => e.dead)) this.list = this.list.filter((e) => !e.dead);
  }
}

// ---------------------------------------------------------------------------------------
// Player bullets: { x, y, vx, vy, spr, dmg, owner (slot), pierce, hit:Set|null, home, life, r, a }
export class PlayerBullets {
  constructor() { this.list = []; this.pool = []; }
  spawn(o) {
    const b = this.pool.pop() || {};
    b.x = o.x; b.y = o.y; b.vx = o.vx || 0; b.vy = o.vy ?? -8;
    b.spr = o.spr; b.dmg = o.dmg || 1; b.owner = o.owner; b.team = o.team ?? o.owner;
    b.pierce = !!o.pierce; b.hit = o.pierce ? (b.hit || new Set()) : null;
    if (b.hit) b.hit.clear();
    b.home = o.home || 0; b.homeRate = o.homeRate || 0.12; b.speed = Math.hypot(b.vx, b.vy);
    b.life = o.life || 120; b.age = 0; b.r = o.r || 3; b.dead = false;
    b.a = Math.atan2(b.vy, b.vx);
    b.frame = 0; b.trail = !!o.trail;
    this.list.push(b);
    return b;
  }
  update(sim) {
    for (const b of this.list) {
      if (b.dead) continue;
      b.age++;
      if (b.home) {
        let t = sim.enemies.get(b.home);
        if (!t || !t.alive || t.dying) { t = sim.nearestEnemy(b.x, b.y, true); b.home = t ? t.id : 0; }
        if (t) {
          const want = Math.atan2(t.y - b.y, t.x - b.x);
          let d = want - b.a;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          b.a += Math.max(-b.homeRate, Math.min(b.homeRate, d));
          b.speed = Math.min(b.speed + 0.15, 7);
          b.vx = Math.cos(b.a) * b.speed; b.vy = Math.sin(b.a) * b.speed;
        }
      }
      b.x += b.vx; b.y += b.vy;
      if (b.trail && (b.age & 1) === 0) sim.env.fx.trail(b.x - b.vx, b.y - b.vy, 'ember', 1);
      if (b.age > b.life || b.y < -20 || b.y > FIELD_H + 20 || b.x < -20 || b.x > FIELD_W + 20) b.dead = true;
    }
    const L = this.list;
    let j = 0;
    for (let i = 0; i < L.length; i++) { const b = L[i]; if (b.dead) this.pool.push(b); else L[j++] = b; }
    L.length = j;
  }
  draw(ctx, lctx, env, tick) {
    const S = env.sprites;
    for (const b of this.list) {
      const opt = S.optDir(b.spr, b.a, b.team);
      const fr = (tick >> 2) + (b.age >> 2);
      ctx.globalAlpha = 0.9;
      S.draw(ctx, b.spr, fr, b.x, b.y, opt);
      ctx.globalAlpha = 1;
      S.drawE(lctx, b.spr, fr, b.x, b.y, opt);
    }
  }
}

export { toSpriteDir };
