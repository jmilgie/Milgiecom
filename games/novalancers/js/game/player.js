// Nova Lancers — player ships: state, local control, weapons (all 4 ships), drawing.
//
// Every peer simulates every player's weapon from that player's replicated state
// (x, y, firing, power, overdrive), so shots look right everywhere; only the OWNER's
// bullets deal damage (each peer is authoritative for its own damage).

import { FIELD_W, FIELD_H, SHIPS, RULES } from '../config.js';
import { clamp, approach, TAU } from '../util.js';

export const PF = { ALIVE: 1, FIRING: 2, INV: 4, OD: 8, DOWN: 16, AWAY: 32 };

export function makePlayer(info, local) {
  const def = SHIPS[info.ship] || SHIPS.aurora;
  return {
    slot: info.slot, name: info.name || `LANCER ${info.slot + 1}`, ship: def.id, def,
    local: !!local,
    x: FIELD_W / 2 + (info.slot - 1.5) * 34, y: FIELD_H - 50,
    vx: 0, vy: 0,
    alive: true, lives: RULES.lives, bombs: RULES.bombs, power: RULES.powerStart,
    od: 0, odT: 0, inv: RULES.invulnAfterRespawn, respawnT: 0, down: false, beacon: null,
    bank: 0, firing: true, fireT: info.slot, missileT: 0,
    beam: null,                     // Tempest beam state { y2, hitId, w }
    opts: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
    reviveProg: 0,
    connected: true,
    // remote interpolation buffer: [tick, x, y, flags, bank]
    buf: [],
    stats: { kills: 0, grazes: 0, shots: 0, hits: 0, deaths: 0, bombs: 0, gems: 0, revives: 0 },
    flash: 0, entryT: 1.0,
  };
}

export function playerFlags(p) {
  let f = 0;
  if (p.alive) f |= PF.ALIVE;
  if (p.firing) f |= PF.FIRING;
  if (p.inv > 0) f |= PF.INV;
  if (p.odT > 0) f |= PF.OD;
  if (p.down) f |= PF.DOWN;
  if (p.respawnT > 0) f |= PF.AWAY;
  return f;
}

// --- local control -------------------------------------------------------------------

export function controlLocal(sim, p, inp) {
  const def = p.def;
  const px = p.x, py = p.y;
  if (p.alive && p.respawnT <= 0) {
    // relative drag (already in art px, sensitivity applied by input)
    let dx = inp.dx, dy = inp.dy;
    const maxStep = 18;
    dx = clamp(dx, -maxStep, maxStep); dy = clamp(dy, -maxStep, maxStep);
    const speed = 2.35 * def.speed * (inp.slow ? 0.45 : 1);
    dx += inp.ax * speed; dy += inp.ay * speed;
    p.x = clamp(p.x + dx, 7, FIELD_W - 7);
    p.y = clamp(p.y + dy, 12, FIELD_H - 10);
    p.slow = inp.slow;
  }
  p.vx = p.x - px; p.vy = p.y - py;
  const targetBank = clamp(p.vx / 1.6, -2, 2);
  p.bank = approach(p.bank, targetBank, Math.abs(targetBank) > Math.abs(p.bank) ? 0.35 : 0.18);
}

// Respawn fly-in / timers, called every tick for every player on every peer (local owns timers)
export function tickTimers(sim, p) {
  if (p.inv > 0) p.inv -= 1 / 60;
  if (p.odT > 0) {
    p.odT -= 1 / 60;
    if (p.odT <= 0 && p.local) { p.odT = 0; sim.env.sfx('overdrive_off', { x: p.x }); }
  }
  if (p.flash > 0) p.flash--;
  if (p.bombCd > 0) p.bombCd--;
  if (p.respawnT > 0 && p.local) {
    p.respawnT -= 1 / 60;
    if (p.respawnT <= 0) {
      p.respawnT = 0; p.alive = true; p.inv = RULES.invulnAfterRespawn;
      p.x = FIELD_W / 2; p.y = FIELD_H + 20; p.entryT = 0;
      sim.env.sfx('respawn', { x: p.x });
    }
  }
  if (p.local && p.alive && p.entryT < 1) {
    // fly-in from below the field after respawn
    p.entryT = Math.min(1, p.entryT + 1 / 40);
    if (p.entryT >= 1 && p.inv > 0) sim.env.sfx('shield_up', { x: p.x, vol: 0.7 });
    const target = FIELD_H - 60;
    p.y = Math.min(p.y, FIELD_H + 20 - (FIELD_H + 20 - target) * easeOutQuad(p.entryT));
  }
}

function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }

// --- weapons ---------------------------------------------------------------------------

const SPREADS = {
  1: [[0, -3], [0, 3]],
  2: [[0, 0], [-0.07, -3], [0.07, 3]],
  3: [[-0.05, -2], [0.05, 2], [-0.15, -4], [0.15, 4]],
  4: [[0, 0], [-0.1, -3], [0.1, 3], [-0.22, -5], [0.22, 5]],
  5: [[0, 0, 1], [-0.1, -3], [0.1, 3], [-0.22, -5], [0.22, 5]],
  6: [[0, 0, 1], [-0.08, -3], [0.08, 3], [-0.18, -4], [0.18, 4], [-0.3, -6], [0.3, 6]],
  7: [[-0.02, -2, 1], [0.02, 2, 1], [-0.1, -4], [0.1, 4], [-0.2, -5], [0.2, 5], [-0.32, -6], [0.32, 6]],
  8: [[0, 0, 1], [-0.05, -3, 1], [0.05, 3, 1], [-0.14, -4], [0.14, 4], [-0.24, -5], [0.24, 5], [-0.36, -6], [0.36, 6]],
};

function gunOffsets(sim, p) {
  const m = sim.env.sprites.meta[p.def.sprite];
  return (m && m.guns && m.guns.length) ? m.guns : [[-4, -8], [4, -8]];
}

// Called every tick for every alive player. `owner` = bullets deal damage (local player).
export function fireWeapons(sim, p, tick) {
  if (!p.alive || p.respawnT > 0 || !p.firing || p.down) { p.beam = null; return; }
  const od = p.odT > 0;
  const pw = clamp(p.power | 0, 1, 8);
  const team = p.slot;
  const pb = sim.pbs;
  const owner = p.slot;
  const mul = od ? 2 : 1;
  const fx = sim.env.fx;

  // option drones (power >= 4): trail the ship, fire straight up
  updateOptions(p, pw);
  if (pw >= 4) {
    const period = pw >= 7 ? 5 : 7;
    if ((tick + p.slot) % period === 0) {
      for (const o of p.opts) {
        pb.spawn({ x: o.x, y: o.y - 4, vx: 0, vy: -7.5, spr: 'pb_option', dmg: 0.7 * mul, owner, team, r: 2.5 });
      }
      if (p.local && ((tick / period) | 0) % 3 === 0) sim.env.sfx('shot_option', { x: p.x, vol: 0.45 });
    }
  }

  switch (p.ship) {
    case 'tempest': {
      // continuous lance beam; damage applied by the sim's beam pass
      const w = (5 + pw) * (od ? 1.6 : 1);
      p.beam = { w, dps: (26 + pw * 11) * mul, pierce: od, y2: 0, hitId: 0 };
      // side needles from power 5
      if (pw >= 5 && (tick + p.slot) % 8 === 0) {
        pb.spawn({ x: p.x - 7, y: p.y - 2, vx: -0.6, vy: -7, spr: 'pb_vulcan', dmg: 0.8 * mul, owner, team, r: 2 });
        pb.spawn({ x: p.x + 7, y: p.y - 2, vx: 0.6, vy: -7, spr: 'pb_vulcan', dmg: 0.8 * mul, owner, team, r: 2 });
      }
      if ((tick & 7) === 0 && p.local) p.stats.shots++;
      break;
    }
    case 'seraph': {
      p.beam = null;
      if ((tick + p.slot) % 6 === 0) {
        const g = gunOffsets(sim, p);
        for (const [gx, gy] of g) {
          pb.spawn({ x: p.x + gx, y: p.y + gy, vx: 0, vy: -7.5, spr: od ? 'pb_vulcan_big' : 'pb_vulcan', dmg: 1.05 * mul, owner, team, r: 2.5 });
        }
        if (p.local) p.stats.shots += g.length;
        if (p.local) sim.env.sfx('shot_aurora', { x: p.x, vol: 0.55, pitch: -3 });
      }
      p.missileT--;
      if (p.missileT <= 0) {
        const n = 1 + Math.floor(pw / 3) + (od ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const side = i % 2 === 0 ? -1 : 1;
          const tgt = sim.nearestEnemy(p.x, p.y - 40, true);
          pb.spawn({
            x: p.x + side * 9, y: p.y + 2, vx: side * (1.4 + i * 0.3), vy: -1.5 - i * 0.2, spr: 'pb_missile',
            dmg: 2.5 * mul, owner, team, home: tgt ? tgt.id : 0, homeRate: 0.13, life: 150, r: 3, trail: true,
          });
        }
        p.missileT = od ? 10 : Math.max(14, 40 - pw * 3);
        sim.env.sfx('shot_seraph', { x: p.x, vol: p.local ? 0.7 : 0.35 });
        if (p.local) p.stats.shots += n;
      }
      break;
    }
    case 'valkyrie': {
      p.beam = null;
      if ((tick + p.slot) % 9 === 0) {
        const big = pw >= 5 || od;
        const waves = pw >= 7 ? [-0.3, -0.15, 0, 0.15, 0.3] : pw >= 3 ? [-0.2, 0, 0.2] : pw >= 2 ? [-0.08, 0.08] : [0];
        for (const a of waves) {
          const center = Math.abs(a) < 0.01;
          const spr = (big && (center || od)) ? 'pb_wave_l' : 'pb_wave';
          const sp = 5.5;
          pb.spawn({
            x: p.x + a * 20, y: p.y - 10, vx: Math.sin(a) * sp, vy: -Math.cos(a) * sp, spr,
            dmg: (spr === 'pb_wave_l' ? 3 : 2.2) * mul, owner, team, pierce: true, r: spr === 'pb_wave_l' ? 10 : 7, life: 90,
          });
        }
        if (p.local) p.stats.shots += waves.length;
        sim.env.sfx('shot_valkyrie', { x: p.x, vol: p.local ? 0.8 : 0.3 });
      }
      break;
    }
    default: { // aurora
      p.beam = null;
      if ((tick + p.slot) % 5 === 0) {
        const pattern = SPREADS[pw];
        const sp = 7;
        for (const [a, dx, big] of pattern) {
          const aa = od ? a * 1.25 : a;
          const isBig = big || od;
          pb.spawn({
            x: p.x + dx, y: p.y - 9, vx: Math.sin(aa) * sp, vy: -Math.cos(aa) * sp,
            spr: isBig ? 'pb_vulcan_big' : 'pb_vulcan', dmg: (isBig ? 1.5 : 1) * mul, owner, team, r: isBig ? 3 : 2.2,
          });
        }
        if (p.local) p.stats.shots += pattern.length;
        if ((tick + p.slot) % 10 === 0) sim.env.sfx('shot_aurora', { x: p.x, vol: p.local ? 0.75 : 0.3 });
        if ((tick & 15) === 0) fx.muzzle(p.x, p.y - 11, team);
      }
    }
  }
}

function updateOptions(p, pw) {
  const n = pw >= 4 ? 2 : 0;
  for (let i = 0; i < 2; i++) {
    const o = p.opts[i];
    if (i >= n) { o.x = p.x; o.y = p.y; o.on = false; continue; }
    const side = i === 0 ? -1 : 1;
    const spread = p.slow ? 9 : 16;
    const tx = p.x + side * spread, ty = p.y + 6 + (p.odT > 0 ? Math.sin(performance.now() / 120 + i * Math.PI) * 3 : 0);
    if (!o.on) { o.x = tx; o.y = ty; o.on = true; }
    o.x += (tx - o.x) * 0.35; o.y += (ty - o.y) * 0.35;
  }
}

// Tempest beam: find first enemy in the column above the ship; returns hit enemy or null.
export function resolveBeam(sim, p) {
  const b = p.beam;
  if (!b) return null;
  let best = null, bestY = -Infinity;
  const half = b.w / 2;
  const hits = b.pierce ? [] : null;
  for (const e of sim.elist) {
    if (!e.alive || e.dying || e.def.noHit || e.y > p.y || e.y < -10) continue;
    const r = e.r;
    if (Math.abs(e.x - p.x) > half + r) continue;
    if (b.pierce) { hits.push(e); continue; }
    if (e.y > bestY) { bestY = e.y; best = e; }
  }
  if (b.pierce) {
    b.y2 = -10;
    b.hitList = hits;
    return hits;
  }
  b.y2 = best ? best.y + best.r * 0.5 : -10;
  b.hitId = best ? best.id : 0;
  return best;
}

// --- drawing --------------------------------------------------------------------------

export function drawPlayer(sim, p, ctx, lctx, tick) {
  const S = sim.env.sprites;
  const fx = sim.env.fx;
  if (p.down && p.beacon) {
    // downed beacon
    const bx = p.beacon.x, by = p.beacon.y;
    S.draw(ctx, 'beacon', tick >> 3, bx, by, S.teamOpt(p.slot));
    S.drawE(lctx, 'beacon', tick >> 3, bx, by, S.teamOpt(p.slot));
    const prog = sim.reviveProgress(p.slot);
    if (prog > 0) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(bx, by, 11, -Math.PI / 2, -Math.PI / 2 + TAU * prog);
      ctx.stroke();
    }
    return;
  }
  if (!p.alive || p.respawnT > 0) return;
  // invulnerability blink
  const blink = p.inv > 0 && ((tick >> 2) & 1) === 0 && p.inv < RULES.invulnAfterRespawn - 0.2;
  const frame = clamp(Math.round(p.bank) + 2, 0, 4);
  const spr = p.def.sprite;
  const meta = S.meta[spr];
  const opt = S.teamOpt(p.slot);

  // engine flames (under the ship)
  const engines = (meta && ((meta.enginesByFrame && meta.enginesByFrame[frame]) || meta.engines)) || [[0, 10]];
  const perFrame = !!(meta && meta.enginesByFrame);
  for (const [ex, ey] of engines) {
    const fl = (tick >> 1) + p.slot;
    const bx = perFrame ? ex : ex * (1 - Math.abs(p.bank) * 0.08);
    S.draw(ctx, 'flame_s', fl, p.x + bx, p.y + ey + 4, opt);
    S.drawE(lctx, 'flame_s', fl, p.x + bx, p.y + ey + 4, opt);
    if ((tick & 3) === 0) fx.trail(p.x + bx, p.y + ey + 8, p.odT > 0 ? 'ember' : ['cyan', 'gold', 'lime', 'violet'][p.slot], 1);
  }
  // options
  if (p.power >= 4) {
    for (const o of p.opts) {
      if (!o.on) continue;
      S.draw(ctx, 'option_drone', tick >> 2, o.x, o.y, opt);
      S.drawE(lctx, 'option_drone', tick >> 2, o.x, o.y, opt);
    }
  }
  if (!blink) {
    const o2 = p.flash > 0 ? S.teamWhite(p.slot) : opt;
    S.draw(ctx, spr, frame, p.x, p.y, o2);
    S.drawE(lctx, spr, frame, p.x, p.y, opt);
  }
  // overdrive aura
  if (p.odT > 0) {
    sim.env.glow(lctx, p.x, p.y, 16 + Math.sin(tick * 0.3) * 3, "#ffc040", 0.6);
    if ((tick & 1) === 0) fx.spark(p.x + (Math.random() - 0.5) * 14, p.y + 6, Math.PI / 2, 'gold', 1);
  }
  // respawn shield bubble
  if (p.inv > 0 && p.entryT >= 1) {
    ctx.globalAlpha = Math.min(0.55, p.inv);
    S.draw(ctx, 'shield_bubble', tick >> 2, p.x, p.y, opt);
    ctx.globalAlpha = 1;
    S.drawE(lctx, 'shield_bubble', tick >> 2, p.x, p.y, opt);
  }
  // local hitbox core (helps dodging on touch)
  if (p.local) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2);
    lctx.fillStyle = 'rgba(255,120,200,0.9)';
    lctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2);
  }
}

export function drawBeamFor(sim, p, ctx, lctx, tick) {
  if (!p.beam || !p.alive || p.respawnT > 0) return;
  const y1 = p.y - 10;
  const y2 = Math.min(y1, p.beam.y2);
  sim.env.fx.drawPlayerBeam(ctx, lctx, p.x, y1, y2, p.beam.w, p.slot, tick / 60);
}
