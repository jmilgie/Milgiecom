// Nova Lancers — core simulation.
//
// One Sim runs on every peer. Modes:
//   'solo'   — single player; this instance is the authority, no network.
//   'host'   — multiplayer authority; runs the stage script and enemy brains, broadcasts events.
//   'client' — replays host events; simulates enemy motion (closed-form paths), bullets
//              (deterministic patterns) and its own ship locally.
//
// Authority split (see DESIGN.md §11): host owns enemies, pickups, score, stage flow;
// each peer owns its own ship (movement, getting hit, lives/bombs/power/overdrive) and the
// damage its own bullets deal (clients report damage to the host in batches).

import { FIELD_W, FIELD_H, RULES, SECTORS, DT } from '../config.js';
import { RNG, clamp, dist2, hash32 } from '../util.js';
import { EnemyBullets, Beams, Emitters, PlayerBullets } from './bullets.js';
import { PATHS } from './paths.js';
import { PATTERNS } from './patterns.js';
import { ENEMIES } from './enemies.js';
import { STAGES } from './stages.js';
import { BOSSES } from './bosses.js';
import {
  makePlayer, controlLocal, tickTimers, fireWeapons, resolveBeam, drawPlayer, drawBeamFor, playerFlags, PF,
} from './player.js';

const TAG_COLORS = ['#79ecff', '#ffd966', '#b8ff6e', '#c9b0ff'];
const NET_EVERY = 3;           // ticks between network flushes (20 Hz)
const INTERP_DELAY = 6;        // ticks of interpolation delay for remote ships
const ENEMY_MARGIN = 40;

export class Sim {
  constructor(o) {
    this.mode = o.mode || 'solo';
    this.isHost = this.mode !== 'client';
    this.online = this.mode !== 'solo';
    this.env = o.env;
    this.net = o.net || null;               // { send(msg), hostTime() }
    this.localSlot = o.localSlot ?? 0;
    this.players = [null, null, null, null];
    for (const info of o.players) this.players[info.slot] = makePlayer(info, info.slot === this.localSlot);
    this.me = this.players[this.localSlot];
    this.enemies = new Map();
    this.elist = [];
    this.ebs = new EnemyBullets();
    this.pbs = new PlayerBullets();
    this.beams = new Beams();
    this.emitters = new Emitters();
    this.pickups = new Map();
    this.nextId = 1;
    this.tick = 0;
    this.score = o.score || 0;
    this.chain = 0; this.chainT = 0; this.maxChain = 0;
    this.state = 'play';                     // play | clear | gameover | victory
    this.outbox = [];
    this.pendingDmg = new Map();
    this.queue = [];                         // client: future events
    this.hostTk = 0; this.hostHt = 0; this.lastHostMsg = performance.now();
    this.appliedPickups = new Set();
    this.reviving = new Map();               // slot -> seconds of revive progress (local reviver)
    this.hpDirty = new Set();
    this.killsBy = [0, 0, 0, 0];
    this.statsBy = [null, null, null, null];
    this.bossIds = [];
    this.magnetAll = false;
    this.sectorIndex = o.sector || 0;
    this.lastSfx = new Map();
    this.warnT = 0;
    this.sectorT = 0;
    this.grazeTick = 0;
    this.diff = this.computeDiff();
    this.startSector(this.sectorIndex, o.seed ?? 1, false);
  }

  get nPlayers() { return this.players.filter(Boolean).length; }
  get t() { return this.tick / 60; }

  computeDiff() {
    const n = Math.max(1, this.players.filter(Boolean).length);
    return { hp: 1 + 0.55 * (n - 1), density: n > 1 ? 1.12 : 1, n };
  }

  // ------------------------------------------------------------------ sector lifecycle
  startSector(n, seed, reset) {
    this.sectorIndex = clamp(n, 0, SECTORS.length - 1);
    this.sector = SECTORS[this.sectorIndex];
    this.seed = seed >>> 0;
    this.rng = new RNG(hash32(this.seed, 77));
    this.tick = 0;
    if (this.beams) this.stopLoops();
    this.enemies.clear(); this.elist.length = 0;
    this.ebs.clear(); this.pbs.list.length = 0; this.beams.list.length = 0; this.emitters.list.length = 0;
    this.pickups.clear(); this.queue.length = 0; this.pendingDmg.clear(); this.bossIds.length = 0;
    this.appliedPickups.clear();
    this.magnetAll = false;
    this.state = 'play';
    this.chain = 0; this.chainT = 0;
    this.sectorT = 0;
    this.stage = STAGES[this.sector.key] || STAGES.aurora;
    this.runner = this.isHost ? new StageRunner(this, this.stage) : null;
    this.env.setSector?.(this.sector);
    this.scrollSpeed = this.env.bg?.scrollSpeed || 30;
    this.scrollY = 0;
    for (const p of this.players) {
      if (!p) continue;
      if (reset) { p.lives = RULES.lives; p.bombs = RULES.bombs; p.power = RULES.powerStart; p.od = 0; }
      if (p.local) {
        p.down = false; p.beacon = null;
        if (reset || !p.alive) { p.alive = true; p.respawnT = 0; }
        p.x = FIELD_W / 2 + (p.slot - (this.nPlayers - 1) / 2) * 34;
        p.y = FIELD_H + 20; p.entryT = 0; p.inv = RULES.invulnAfterRespawn;
      }
    }
    this.env.ui.event('sector', { n: this.sectorIndex, sector: this.sector });
  }

  // ------------------------------------------------------------------ main tick
  update(inp) {
    this.tick++;
    this.inUpdate = true;
    // client: apply host events that are due this tick
    if (!this.isHost) this.drainQueue();

    this.sectorT += DT;
    this.scrollY = this.tick / 60 * this.scrollSpeed;

    // host: stage script + brains
    if (this.isHost && this.state === 'play') this.runner.update();
    if (this.isHost) this.hostBrains();

    // enemies move (all peers)
    this.moveEnemies();

    // players
    const me = this.me;
    if (me) {
      if (inp) controlLocal(this, me, inp);
      if (inp && inp.bomb) this.tryBomb();
      if (inp && inp.overdrive) this.tryOverdrive();
    }
    for (const p of this.players) {
      if (!p) continue;
      if (!p.local) this.interpolateRemote(p);
      tickTimers(this, p);
      fireWeapons(this, p, this.tick);
    }

    // bullets & hazards
    this.emitters.update(this);
    this.ebs.update(this);
    const beamsBefore = this.beams.list.length;
    this.beams.update(this);
    for (const b of this.beams.list) {
      if (b.age === b.warn + 1) {
        if (!b.sfxLoop) b.sfxLoop = this.env.sfxLoop('enemy_laser_fire', { x: b.x, vol: 0.8 });
        this.env.shake(2, 0.2);
      } else if (b.age === 1) this.sfxAt('enemy_laser_charge', b.x, 0.7);
    }
    void beamsBefore;
    this.updateBeamHum();
    this.pbs.update(this);
    this.updatePickups();

    // collisions
    this.collidePlayerShots();
    this.collideLocalPlayer();
    this.updateRevive();

    // chain decay (host)
    if (this.isHost && this.chainT > 0) {
      this.chainT -= DT;
      if (this.chainT <= 0) { this.chain = 0; }
    }
    if (this.warnT > 0) this.warnT -= DT;

    for (const e of this.elist) if (e.flash > 0) e.flash--;

    // periodic net flush
    if (this.online && this.tick % NET_EVERY === 0) this.flushNet();
    if (this.isHost && this.online && this.tick % 60 === 0) this.checkGameOver();
    this.inUpdate = false;
  }

  // ------------------------------------------------------------------ enemies
  // Host API: spawn an enemy of `type` with JSON params p (p.path overrides def.move).
  spawn(type, p = {}, parent = 0) {
    if (!this.isHost) return null;
    const def = ENEMIES[type];
    if (!def) { console.warn('unknown enemy', type); return null; }
    const id = this.nextId++;
    const ev = { k: 'sp', tk: this.tick, id, ty: type, p, par: parent || 0 };
    this.emitEvent(ev);
    return this.enemies.get(id) || null;
  }

  _createEnemy(ev) {
    const def = ENEMIES[ev.ty];
    if (!def || this.enemies.has(ev.id)) return null;
    const hpMul = def.hpScale === false ? 1 : this.diff.hp;
    const hp = (ev.p.hp ?? def.hp) * hpMul;
    const e = {
      id: ev.id, type: ev.ty, def, p: ev.p, t0: ev.tk, parent: ev.par || 0,
      hp, maxHp: hp, x: ev.p.x ?? FIELD_W / 2, y: ev.p.y ?? -20, px: 0, py: 0,
      alive: true, dying: false, flash: 0, entered: false, heading: Math.PI / 2, face: undefined,
      phase: 0, phaseT0: ev.tk, path: ev.p.path || def.move || 'line', fs: null, data: {},
      r: ev.p.r ?? def.r ?? 8, z: def.z ?? 0, predT: 0,
      armor: !!def.armor,
    };
    this.enemies.set(e.id, e);
    this.elist.push(e);
    this.elist.sort((a, b) => a.z - b.z || a.id - b.id);
    this.pathStep(e);
    e.px = e.x; e.py = e.y;
    if (this.nextId <= e.id) this.nextId = e.id + 1;
    if (def.onSpawn) def.onSpawn(e, this);
    if (def.warp) this.env.fx.warp(e.x, e.y, def.palette || 'magenta');
    if (def.boss || def.bar) this.bossIds.push(e.id);
    return e;
  }

  pathStep(e) {
    const t = (this.tick - e.t0) / 60;
    const fn = typeof e.path === 'function' ? e.path : (PATHS[e.path] || (e.def.paths && e.def.paths[e.path]));
    if (!fn) return false;
    return fn(e, t, this);
  }

  moveEnemies() {
    let removed = false;
    for (const e of this.elist) {
      if (!e.alive) continue;
      e.px = e.x; e.py = e.y;
      const done = this.pathStep(e);
      const mx = e.x - e.px, my = e.y - e.py;
      if (mx * mx + my * my > 0.0004) e.heading = Math.atan2(my, mx);
      const inside = e.x > -4 && e.x < FIELD_W + 4 && e.y > -4 && e.y < FIELD_H + 4;
      if (inside) e.entered = true;
      const out = e.x < -ENEMY_MARGIN || e.x > FIELD_W + ENEMY_MARGIN || e.y < -ENEMY_MARGIN - 60 || e.y > FIELD_H + ENEMY_MARGIN;
      const tooOld = (this.tick - e.t0) > 60 * (e.def.maxLife || 60);
      if (!e.def.boss && !e.parent && (done === true || (e.entered && out) || tooOld)) {
        e.alive = false; removed = true;
      }
      if (e.dying && !this.isHost) {
        e.predT++;
        if (e.predT > 90) { e.dying = false; e.hp = Math.max(1, e.hp); e.predT = 0; } // host never confirmed
      }
    }
    if (removed) this.pruneEnemies();
  }

  pruneEnemies() {
    for (const e of this.elist) if (!e.alive) this.enemies.delete(e.id);
    this.elist = this.elist.filter((e) => e.alive);
  }

  // Host: evaluate fire schedules and custom brains
  hostBrains() {
    for (const e of this.elist) {
      if (!e.alive || e.dying) continue;
      const def = e.def;
      const t = (this.tick - e.t0) / 60;
      if (def.fire && def.fire.length) {
        if (!e.fs) e.fs = def.fire.map((f) => ({ next: f.at ?? 1, n: 0 }));
        for (let i = 0; i < def.fire.length; i++) {
          const f = def.fire[i], s = e.fs[i];
          if (t < s.next || (f.times && s.n >= f.times)) continue;
          const onScreen = e.y > 6 && e.y < FIELD_H * (f.maxY ?? 0.78) && e.x > 4 && e.x < FIELD_W - 4;
          if (f.when ? f.when(e, this, t) : onScreen) {
            const args = Object.assign({}, f.args || {});
            if (f.aim !== false) {
              const tg = this.targetPlayer(e, f.target);
              if (tg) args.a = Math.atan2(tg.y - (e.y + (f.from ? f.from[1] : 0)), tg.x - (e.x + (f.from ? f.from[0] : 0))) + (f.jitter ? (this.rng.next() - 0.5) * f.jitter : 0);
              if (tg && args.target === undefined && (f.pat === 'stream')) args.target = tg.slot;
            }
            if (f.density !== false && this.diff.density > 1 && args.n) args.n = Math.round(args.n * this.diff.density);
            this.fire(e, f.pat, args, f.from);
            s.n++;
          }
          s.next = f.every ? t + f.every * (f.everyJitter ? 1 + (this.rng.next() - 0.5) * f.everyJitter : 1) : Infinity;
        }
      }
      if (def.brain) def.brain(e, this, t);
    }
  }

  targetPlayer(e, mode) {
    const alive = this.players.filter((p) => p && p.alive && !p.down && p.respawnT <= 0);
    if (!alive.length) return null;
    if (mode === 'rand') return alive[Math.floor(this.rng.next() * alive.length)];
    let best = alive[0], bd = Infinity;
    for (const p of alive) { const d = dist2(p.x, p.y, e.x, e.y); if (d < bd) { bd = d; best = p; } }
    return best;
  }

  nearestPlayer(x, y) {
    let best = null, bd = Infinity;
    for (const p of this.players) {
      if (!p || !p.alive || p.down) continue;
      const d = dist2(p.x, p.y, x, y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  aimAt(e, dx = 0, dy = 0) {
    const p = this.targetPlayer(e);
    return p ? Math.atan2(p.y - (e.y + dy), p.x - (e.x + dx)) : Math.PI / 2;
  }

  nearestEnemy(x, y, onScreen) {
    let best = null, bd = Infinity;
    for (const e of this.elist) {
      if (!e.alive || e.dying || e.def.noHit || e.armor) continue;
      if (onScreen && (e.y < 0 || e.y > FIELD_H || e.x < 0 || e.x > FIELD_W)) continue;
      const d = dist2(e.x, e.y, x, y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // Host API: fire pattern `pat` from enemy e (or {x,y}) — broadcast + run locally.
  fire(e, pat, args = {}, from) {
    if (!this.isHost) return;
    const x = (e.x || 0) + (from ? from[0] : 0), y = (e.y || 0) + (from ? from[1] : 0);
    const s = (this.rng.next() * 4294967296) >>> 0;
    this.emitEvent({ k: 'f', tk: this.tick, id: e.id || 0, pat, x: +x.toFixed(2), y: +y.toFixed(2), a: args, s });
  }

  setParams(e, obj) {
    if (!this.isHost || !e) return;
    this.emitEvent({ k: 'es', tk: this.tick, id: e.id, p: obj });
  }

  setPhase(e, ph) {
    if (!this.isHost || !e) return;
    this.emitEvent({ k: 'ph', tk: this.tick, id: e.id, ph });
  }

  cue(name, data, e) {
    if (!this.isHost) return;
    this.emitEvent({ k: 'cu', tk: this.tick, id: e ? e.id : 0, n: name, d: data ?? null });
  }

  announce(name, data) {
    if (!this.isHost) return;
    this.emitEvent({ k: 'ev', e: name, d: data ?? null });
  }

  kill(e, by = -1, quiet = false) {
    if (!this.isHost || !e || !e.alive) return;
    this.emitEvent({ k: 'x', tk: this.tick, id: e.id, by, q: quiet ? 1 : 0 });
  }

  // pattern API (all peers) ------------------------------------------------------------
  eb(spec) {
    const b = this.ebs.spawn(spec);
    if (this._catch) this._catch.b.push(b);
    return b;
  }
  beam(spec) {
    const b = this.beams.spawn(spec);
    if (this._catch) this._catch.beams.push(b);
    return b;
  }
  emit(spec) {
    const em = this.emitters.spawn(spec);
    if (this._catch) this._catch.em.push(em);
    return em;
  }
  runPattern(name, x, y, args, seed, src) {
    const fn = PATTERNS[name];
    if (!fn) { console.warn('unknown pattern', name); return; }
    fn(this, x, y, args || {}, new RNG(seed || 1), src || 0);
  }
  sfxAt(name, x, vol = 1) {
    const now = this.tick;
    const last = this.lastSfx.get(name) || -99;
    if (now - last < 3) return;
    this.lastSfx.set(name, now);
    this.env.sfx(name, { x, vol });
  }

  // ------------------------------------------------------------------ events
  emitEvent(ev) {
    this.applyEvent(ev);
    if (this.online) this.outbox.push(ev);
  }

  drainQueue() {
    if (!this.queue.length) return;
    let keep = 0;
    for (let i = 0; i < this.queue.length; i++) {
      const ev = this.queue[i];
      if ((ev.tk ?? 0) <= this.tick) this.applyEvent(ev);
      else this.queue[keep++] = ev;
    }
    this.queue.length = keep;
  }

  applyEvent(ev) {
    switch (ev.k) {
      case 'sp': this._createEnemy(ev); break;
      case 'f': this._applyFire(ev); break;
      case 'x': this._applyKill(ev); break;
      case 'ph': {
        const e = this.enemies.get(ev.id);
        if (e) { e.phase = ev.ph; e.phaseT0 = ev.tk; if (e.def.onPhase) e.def.onPhase(e, ev.ph, this); }
        break;
      }
      case 'es': {
        const e = this.enemies.get(ev.id);
        if (e) { Object.assign(e.p, ev.p); e.pT = ev.tk; }
        break;
      }
      case 'cu': {
        const e = ev.id ? this.enemies.get(ev.id) : null;
        if (ev.n === '_pts' && Array.isArray(ev.d)) {
          this.env.fx.text(ev.d[0], ev.d[1] - 8, String(ev.d[2]), ev.d[2] >= 10000 ? '#ffd966' : '#dfe8f7');
          break;
        }
        const fn = e ? e.def.cues?.[ev.n] : this.stage.cues?.[ev.n];
        if (fn) fn(e || this, this, ev.d);
        break;
      }
      case 'hp': {
        for (const [id, hp] of ev.l) {
          const e = this.enemies.get(id);
          if (e && !this.isHost) e.hp = Math.min(e.hp, hp);
        }
        break;
      }
      case 'pk': this._createPickup(ev); break;
      case 'pc': this._applyPickupCollected(ev); break;
      case 'cl': {
        const p = this.players[ev.by];
        if (p && !p.local) {
          this.env.fx.nova(ev.x, ev.y, ev.by);
          this.env.sfx('nova', { x: ev.x, vol: 0.7 });
          this.clearBullets(true);
        } else if (ev.by < 0) {
          this.clearBullets(true);
        }
        break;
      }
      case 'od': {
        const p = this.players[ev.by];
        if (p && !p.local) { this.env.fx.overdrive(p.x, p.y, ev.by); this.env.sfx('overdrive_on', { x: p.x, vol: 0.5 }); }
        break;
      }
      case 'dth': {
        const p = this.players[ev.by];
        if (p && !p.local) {
          this.env.fx.explode(ev.x, ev.y, 'large', { palette: 'fire' });
          this.env.sfx('player_explode', { x: ev.x, vol: 0.7 });
          p.alive = false;
          if (ev.down) { p.down = true; p.beacon = { x: ev.x, y: Math.min(ev.y, FIELD_H - 40) }; }
        }
        break;
      }
      case 'rv': this._applyRevive(ev); break;
      case 'ev': this._applyAnnounce(ev); break;
      case 'sec': {
        if (!this.isHost) this.startSector(ev.n, ev.seed, !!ev.reset);
        if (ev.reset) this.score = 0;
        break;
      }
      case 'left': {
        const p = this.players[ev.s];
        if (p && !p.local) { this.players[ev.s] = null; this.diff = this.computeDiff(); }
        break;
      }
      default: break;
    }
  }

  _applyFire(ev) {
    const src = ev.id ? this.enemies.get(ev.id) : null;
    if (ev.id && !this.isHost && src && src.dying) return; // predicted-dead: ignore
    // Inside update() the new objects still get this tick's step; outside it they missed it.
    const behind = Math.max(0, this.tick - ev.tk + (this.inUpdate ? 0 : 1));
    const cap = { b: [], beams: [], em: [] };
    this._catch = cap;
    this.runPattern(ev.pat, ev.x, ev.y, ev.a, ev.s, ev.id);
    // fast-forward everything this event created so it lines up with the host's timeline
    for (let i = 0; i < behind && i < 240; i++) {
      for (const em of cap.em) if (!em.dead) this.emitters.step(em, this);
      for (const b of cap.b) if (!b.dead) this.ebs.step(b, this);
      for (const bm of cap.beams) this.beams.step(bm, this);
    }
    this._catch = null;
    if (!ev.a || !ev.a.silent) {
      const heavy = ev.pat === 'ring' || ev.pat === 'rings' || ev.pat === 'cluster' || ev.pat === 'shotgun' || ev.pat === 'flower';
      if (ev.pat !== 'beam' && ev.pat !== 'spiral' && ev.pat !== 'stream' && ev.pat !== 'sweep') {
        this.sfxAt(heavy ? 'enemy_shot_heavy' : 'enemy_shot', ev.x, heavy ? 0.6 : 0.45);
      }
    }
  }

  _applyKill(ev) {
    const e = this.enemies.get(ev.id);
    if (!e) return;
    const wasPredicted = e.dying;
    e.alive = false;
    const def = e.def;
    if (!ev.q) {
      if (!wasPredicted) this.explodeEnemy(e);
      if (ev.by >= 0) {
        this.killsBy[ev.by] = (this.killsBy[ev.by] || 0) + 1;
        const p = this.players[ev.by];
        if (p) p.stats.kills++;
        if (p && p.local) p.od = Math.min(1, p.od + (def.odGain ?? 0.012));
      }
      if (this.isHost) this.onHostKill(e, ev.by);
      if (def.onDeath) def.onDeath(e, this);
    }
    // children die with their parent
    for (const c of this.elist) {
      if (c.alive && c.parent === e.id) {
        c.alive = false;
        if (!ev.q) this.explodeEnemy(c);
      }
    }
    this.bossIds = this.bossIds.filter((id) => id !== e.id);
    this.pruneEnemies();
  }

  explodeEnemy(e) {
    const def = e.def;
    const size = def.explode || (e.r > 20 ? 'large' : e.r > 9 ? 'medium' : 'small');
    this.env.fx.explode(e.x, e.y, size, { palette: def.palette || 'fire', vx: (e.x - e.px) * 0.5, vy: (e.y - e.py) * 0.5 });
    const snd = size === 'boss' ? 'explode_boss' : size === 'huge' || size === 'large' ? 'explode_large' : size === 'medium' ? 'explode_medium' : 'explode_small';
    this.sfxAt(snd, e.x, size === 'small' || size === 'tiny' ? 0.7 : 1);
    if (size === 'large' || size === 'huge') { this.env.shake(4, 0.3); this.env.haptic('medium'); }
    if (size === 'boss') { this.env.shake(9, 1.4); this.env.haptic('death'); }
    if (size === 'medium') this.env.shake(1.5, 0.12);
  }

  onHostKill(e, by) {
    const def = e.def;
    // score + chain
    this.chain++;
    this.chainT = RULES.chainWindow;
    this.maxChain = Math.max(this.maxChain, this.chain);
    const mult = this.chainMult();
    const p = this.players[by];
    const od = p && p.odT > 0 ? 2 : 1;
    const pts = Math.round((def.score || 100) * mult * od);
    this.score += pts;
    if (pts >= 1000) this.emitEvent({ k: 'cu', tk: this.tick, id: 0, n: '_pts', d: [Math.round(e.x), Math.round(e.y), pts] });
    // drops
    const d = def.drops || {};
    const rng = this.rng;
    const gems = (d.gem || 0) + (rng.chance(0.5) ? 1 : 0) * (d.gem ? 1 : 0);
    for (let i = 0; i < gems; i++) this.spawnPickup('gem_s', e.x, e.y, rng);
    for (let i = 0; i < (d.gemL || 0); i++) this.spawnPickup('gem_l', e.x, e.y, rng);
    if (d.power && rng.chance(d.power)) this.spawnPickup('power', e.x, e.y, rng);
    if (d.bomb && rng.chance(d.bomb)) this.spawnPickup('bomb', e.x, e.y, rng);
    if (d.od && rng.chance(d.od)) this.spawnPickup('overdrive', e.x, e.y, rng);
    if (d.life && rng.chance(d.life)) this.spawnPickup('life', e.x, e.y, rng);
    // wave bonus: last of a tagged group drops a power core
    if (e.p.grp) {
      const left = this.elist.some((o) => o.alive && o !== e && o.p.grp === e.p.grp);
      if (!left && e.p.grpDrop) this.spawnPickup(e.p.grpDrop, e.x, e.y, rng);
    }
    if (def.deathFire) {
      const df = Array.isArray(def.deathFire) ? def.deathFire : [def.deathFire];
      for (const f of df) {
        const args = Object.assign({}, f.args || {});
        if (f.aim) args.a = this.aimAt(e);
        this.fire(e, f.pat, args, f.from);
      }
    }
    if (def.onKill) def.onKill(e, this, by);
    if (def.boss && !def.midboss) this.onBossDefeated(e, by);
  }

  chainMult() { return Math.min(RULES.chainMax, 1 + Math.floor(this.chain / 10)); }

  // ------------------------------------------------------------------ damage
  // Local authority: called when the LOCAL player's weapon hits an enemy.
  dealDamage(e, dmg, slot) {
    if (!e.alive || e.dying) return;
    if (e.armor || e.def.armor) { this.flashEnemy(e); return false; }
    this.flashEnemy(e);
    if (this.isHost) {
      e.hp -= dmg;
      this.hpDirty.add(e.id);
      if (e.hp <= 0) this.kill(e, slot);
    } else {
      e.hp -= dmg;
      this.pendingDmg.set(e.id, (this.pendingDmg.get(e.id) || 0) + dmg);
      if (e.hp <= 0 && !e.def.noPredict && !e.def.boss) {
        e.dying = true; e.predT = 0;
        this.explodeEnemy(e);
      }
    }
    return true;
  }

  // host: damage reported by a client
  applyRemoteDamage(list, slot) {
    for (const item of list) {
      if (!Array.isArray(item)) continue;
      const [id, dmg] = item;
      const e = this.enemies.get(id);
      if (!e || !e.alive || typeof dmg !== 'number' || !(dmg > 0) || dmg > 5000) continue;
      if (e.armor || e.def.armor) continue;
      e.hp -= dmg;
      this.hpDirty.add(e.id);
      if (e.hp <= 0) this.kill(e, slot);
    }
  }

  collidePlayerShots() {
    const list = this.pbs.list;
    const ens = this.elist;
    let hitSound = false, armorSound = false;
    for (const b of list) {
      if (b.dead) continue;
      for (const e of ens) {
        if (!e.alive || e.dying || e.def.noHit || e.y < -8) continue;
        const rr = e.r + b.r;
        const dx = b.x - e.x, dy = b.y - e.y;
        if (dx * dx + dy * dy > rr * rr) continue;
        if (b.pierce) {
          if (b.hit.has(e.id)) continue;
          b.hit.add(e.id);
        } else b.dead = true;
        const me = this.players[b.owner];
        if (me && me.local) {
          const ok = this.dealDamage(e, b.dmg, b.owner);
          if (ok === false) armorSound = true; else hitSound = true;
          me.stats.hits++;
        } else this.flashEnemy(e);
        this.env.fx.hit(b.x, b.y - 2, e.def.palette === 'crystal' ? 'crystal' : 'ember');
        if (!b.pierce) break;
      }
    }
    // Tempest beams
    for (const p of this.players) {
      if (!p || !p.beam) continue;
      const res = resolveBeam(this, p);
      const targets = Array.isArray(res) ? res : res ? [res] : [];
      for (const e of targets) {
        if (p.local) {
          const ok = this.dealDamage(e, p.beam.dps / 60, p.slot);
          if (ok === false) armorSound = true; else hitSound = true;
        } else this.flashEnemy(e);
        if ((this.tick & 3) === 0) this.env.fx.hit(e.x + (Math.random() - 0.5) * 6, e.y + e.r * 0.4, 'cyan');
      }
    }
    if (hitSound) this.sfxAt('hit_enemy', this.me ? this.me.x : 120, 0.5);
    if (armorSound) this.sfxAt('hit_armor', this.me ? this.me.x : 120, 0.5);
  }

  // ------------------------------------------------------------------ local player hits
  collideLocalPlayer() {
    const p = this.me;
    if (!p || !p.alive || p.respawnT > 0 || p.down || this.state !== 'play' && this.state !== 'clear') return;
    const hb = p.def.hitbox;
    const inv = p.inv > 0 || p.entryT < 1 || this.god;
    const gr = RULES.grazeRadius;
    let grazed = 0;
    for (const b of this.ebs.list) {
      if (b.dead || b.age <= b.delay) continue;
      const dx = b.x - p.x, dy = b.y - p.y;
      if (dx > gr + 8 || dx < -gr - 8 || dy > gr + 8 || dy < -gr - 8) continue;
      const d2 = dx * dx + dy * dy;
      const rr = b.r + hb;
      if (!inv && d2 < rr * rr) { this.localDeath(); return; }
      if (!b.grazed && d2 < (gr + b.r) * (gr + b.r)) { b.grazed = true; grazed++; }
    }
    if (!inv) {
      for (const bm of this.beams.list) {
        if (this.beams.hits(bm, p.x, p.y, hb)) { this.localDeath(); return; }
      }
      for (const e of this.elist) {
        if (!e.alive || e.dying || e.def.ground || e.def.noCollide) continue;
        const rr = e.r * 0.75 + hb;
        if (dist2(e.x, e.y, p.x, p.y) < rr * rr) { this.localDeath(); return; }
      }
    }
    if (grazed) {
      p.stats.grazes += grazed;
      p.od = Math.min(1, p.od + 0.008 * grazed);
      this.pendingGraze = (this.pendingGraze || 0) + grazed;
      if (this.isHost) { this.score += 10 * grazed * this.chainMult(); this.pendingGraze = 0; }
      this.env.fx.graze(p.x, p.y);
      if (this.tick - this.grazeTick > 5) { this.env.sfx('graze', { x: p.x, vol: 0.5 }); this.grazeTick = this.tick; }
    }
  }

  localDeath() {
    const p = this.me;
    p.alive = false;
    p.stats.deaths++;
    p.lives--;
    p.power = Math.max(1, p.power - RULES.powerLossOnDeath);
    p.bombs = Math.max(p.bombs, RULES.bombs);
    p.odT = 0;
    this.env.fx.explode(p.x, p.y, 'large', { palette: 'fire' });
    this.env.fx.shockwave(p.x, p.y, 60, 'fire');
    this.env.sfx('player_hit', { x: p.x });
    this.env.sfx('player_explode', { x: p.x });
    this.env.shake(7, 0.6);
    this.env.haptic('death');
    this.env.fx.flash?.(0.35, [1, 0.4, 0.3]);
    // clear nearby bullets so the respawn is fair
    this.clearBullets(false, p.x, p.y, 70);
    const down = p.lives <= 0;
    if (!down) {
      p.respawnT = 1.1;
    } else if (!this.online) {
      p.down = true;
      this.state = 'gameover';
      this.env.ui.event('gameover', { score: this.score, solo: true });
    } else {
      p.down = true;
      p.beacon = { x: p.x, y: Math.min(p.y, FIELD_H - 40) };
    }
    this.sendUp({ k: 'dth', x: Math.round(p.x), y: Math.round(p.y), down: down ? 1 : 0 });
    if (this.isHost) this.checkGameOver();
  }

  // ------------------------------------------------------------------ bombs / overdrive
  tryBomb() {
    const p = this.me;
    if (!p || !p.alive || p.respawnT > 0 || p.down || p.bombs <= 0 || p.entryT < 1) return;
    if (this.state !== 'play' && this.state !== 'clear') return;
    if (p.bombCd > 0) return;
    p.bombs--;
    p.bombCd = 40;
    p.stats.bombs++;
    p.inv = Math.max(p.inv, 2.2);
    this.env.fx.nova(p.x, p.y, p.slot);
    this.env.sfx('nova', { x: p.x });
    this.env.shake(6, 0.8);
    this.env.haptic('bomb');
    this.env.music?.duck?.(0.6, 1.2);
    this.clearBullets(true);
    // damage everything on screen (local authority)
    for (const e of this.elist) {
      if (!e.alive || e.dying || e.y < -10 || e.y > FIELD_H + 10) continue;
      this.dealDamage(e, e.def.boss ? 45 : 60, p.slot);
    }
    this.sendUp({ k: 'bomb', x: Math.round(p.x), y: Math.round(p.y) });
    if (this.isHost && this.online) this.outbox.push({ k: 'cl', by: p.slot, x: Math.round(p.x), y: Math.round(p.y) });
  }

  tryOverdrive() {
    const p = this.me;
    if (!p || !p.alive || p.down || p.od < 1 || p.odT > 0) return;
    p.od = 0;
    p.odT = RULES.overdriveDuration;
    this.env.fx.overdrive(p.x, p.y, p.slot);
    this.env.sfx('overdrive_on', { x: p.x });
    this.env.haptic('heavy');
    this.env.shake(3, 0.3);
    this.sendUp({ k: 'od' });
    if (this.isHost && this.online) this.outbox.push({ k: 'od', by: p.slot });
  }

  clearBullets(pop, cx, cy, radius) {
    const fx = this.env.fx;
    if (cx === undefined) {
      let n = 0;
      this.ebs.clear((b) => { if (pop && (n++ & 1) === 0) fx.spark(b.x, b.y, -Math.PI / 2, 'gold', 1); });
      for (const bm of this.beams.list) { bm.dead = true; if (bm.sfxLoop) { bm.sfxLoop.stop(0.2); bm.sfxLoop = null; } }
      this.beams.update(this);
    } else {
      const r2 = radius * radius;
      for (const b of this.ebs.list) if (!b.dead && dist2(b.x, b.y, cx, cy) < r2) b.dead = true;
      this.ebs.compact();
    }
  }

  // ------------------------------------------------------------------ pickups
  spawnPickup(type, x, y, rng) {
    if (!this.isHost) return;
    const r = rng || this.rng;
    const id = this.nextId++;
    const cap = type !== 'gem_s' && type !== 'gem_l';
    const ev = {
      k: 'pk', tk: this.tick, id, ty: type, x: Math.round(x), y: Math.round(y),
      vx: +((r.next() - 0.5) * (cap ? 50 : 70)).toFixed(1), vy: cap ? 18 : 40,
    };
    this.emitEvent(ev);
  }

  _createPickup(ev) {
    if (this.pickups.has(ev.id) || this.appliedPickups.has(ev.id)) return;
    this.pickups.set(ev.id, {
      id: ev.id, type: ev.ty, x: ev.x, y: ev.y, x0: ev.x, y0: ev.y, vx: ev.vx, vy: ev.vy, t0: ev.tk,
      mag: false, taken: false, cap: ev.ty !== 'gem_s' && ev.ty !== 'gem_l',
    });
    if (this.nextId <= ev.id) this.nextId = ev.id + 1;
  }

  updatePickups() {
    const me = this.me;
    for (const pk of this.pickups.values()) {
      if (pk.taken) continue;
      const t = (this.tick - pk.t0) / 60;
      if (pk.mag && me) {
        const a = Math.atan2(me.y - pk.y, me.x - pk.x);
        const sp = 4 + Math.min(6, t);
        pk.x += Math.cos(a) * sp; pk.y += Math.sin(a) * sp;
      } else if (pk.cap) {
        // toss up, then drift down while bouncing between the walls
        let x = pk.x0 + pk.vx * t;
        const lo = 8, hi = FIELD_W - 8, span = hi - lo;
        let u = ((x - lo) % (2 * span) + 2 * span) % (2 * span);
        x = lo + (u > span ? 2 * span - u : u);
        pk.x = x;
        pk.y = pk.y0 - 40 * t + 0.5 * 55 * t * t;
        if (t > 1.2) pk.y = pk.y0 - 40 * 1.2 + 0.5 * 55 * 1.44 + pk.vy * (t - 1.2) * 0.9;
      } else {
        const tt = Math.min(t, 0.45);
        pk.x = pk.x0 + pk.vx * tt * (1 - tt);
        pk.y = pk.y0 - 60 * tt + 60 * tt * tt + (t > 0.45 ? pk.vy * (t - 0.45) : 0);
      }
      if (pk.y > FIELD_H + 16) { this.pickups.delete(pk.id); continue; }
      if (!me || !me.alive || me.down || me.respawnT > 0) continue;
      const d2 = dist2(pk.x, pk.y, me.x, me.y);
      const magR = pk.cap ? 14 : (this.magnetAll ? 999 : 44);
      if (!pk.cap && !pk.mag && d2 < magR * magR) pk.mag = true;
      if (d2 < (pk.cap ? 12 * 12 : 9 * 9)) this.collectLocal(pk);
    }
  }

  collectLocal(pk) {
    pk.taken = true;
    this.pickups.delete(pk.id);
    this.applyPickupEffect(pk.id, pk.type, this.me.slot);
    if (this.isHost) this.emitEvent({ k: 'pc', id: pk.id, by: this.me.slot, ty: pk.type });
    else this.sendUp({ k: 'pc', id: pk.id });
  }

  _applyPickupCollected(ev) {
    const pk = this.pickups.get(ev.id);
    const type = ev.ty || (pk && pk.type);
    this.pickups.delete(ev.id);
    if (this.isHost && (ev.ty === 'gem_s' || ev.ty === 'gem_l')) this.score += (ev.ty === 'gem_l' ? 500 : 100) * this.chainMult();
    if (this.isHost && ev.ty === 'power' && this.players[ev.by] && this.players[ev.by].power >= 8) this.score += 5000;
    if (type) this.applyPickupEffect(ev.id, type, ev.by);
  }

  // Team-wide effects: every peer applies them to its own local ship exactly once per pickup.
  applyPickupEffect(id, type, by) {
    if (this.appliedPickups.has(id)) return;
    this.appliedPickups.add(id);
    const me = this.me;
    const fx = this.env.fx;
    const collector = this.players[by];
    if (collector) {
      const pal = type === 'power' ? 'ember' : type === 'bomb' ? 'magenta' : type === 'overdrive' ? 'cyan' : type === 'life' ? 'gold' : 'emerald';
      fx.pickup(collector.x, collector.y, pal);
      if (type === 'gem_s' || type === 'gem_l') collector.stats.gems++;
    }
    if (!me) return;
    const mine = by === me.slot;
    switch (type) {
      case 'power':
        if (me.power < RULES.powerMax) {
          me.power++;
          this.env.sfx(me.power >= RULES.powerMax ? 'powerup_max' : 'pickup_power', { x: me.x, vol: mine ? 1 : 0.6 });
          if (mine || true) this.env.ui.event('toast', { text: me.power >= RULES.powerMax ? 'MAX POWER' : `POWER ${me.power}` });
        } else this.env.sfx('pickup_gem', { x: me.x });
        break;
      case 'bomb':
        me.bombs = Math.min(RULES.maxBombs, me.bombs + 1);
        this.env.sfx('pickup_bomb', { x: me.x, vol: mine ? 1 : 0.6 });
        break;
      case 'overdrive':
        me.od = Math.min(1, me.od + 0.5);
        this.env.sfx('pickup_overdrive', { x: me.x, vol: mine ? 1 : 0.6 });
        break;
      case 'life':
        me.lives = Math.min(RULES.maxLives, me.lives + 1);
        this.env.sfx('pickup_life', { x: me.x });
        this.env.music?.stinger?.('extend');
        this.env.ui.event('toast', { text: '1UP' });
        break;
      default:
        if (mine) this.env.sfx('pickup_gem', { x: me.x, vol: 0.55, pitch: Math.min(12, this.chainMult()) });
    }
    if (mine) this.env.haptic('light');
  }

  // ------------------------------------------------------------------ co-op revive
  updateRevive() {
    const me = this.me;
    if (!this.online || !me || !me.alive || me.down || me.respawnT > 0) { this.reviving.clear(); return; }
    for (const p of this.players) {
      if (!p || p === me || !p.down || !p.beacon) continue;
      const near = dist2(p.beacon.x, p.beacon.y, me.x, me.y) < RULES.reviveRadius * RULES.reviveRadius;
      let v = this.reviving.get(p.slot) || 0;
      v = near ? v + DT : Math.max(0, v - DT * 2);
      if (near && ((this.tick % 20) === 0)) this.env.sfx('beacon_ping', { x: p.beacon.x, vol: 0.5, pitch: v * 6 });
      if (v >= RULES.reviveTime) {
        v = 0;
        me.stats.revives++;
        if (this.isHost) this.emitEvent({ k: 'rv', s: p.slot, by: me.slot });
        else this.sendUp({ k: 'rv', s: p.slot });
      }
      this.reviving.set(p.slot, v);
    }
  }

  // Tempest's lance beam hum (local ship only) — a seamless loop while the beam is live
  updateBeamHum() {
    const me = this.me;
    const on = !!(me && me.beam && me.alive && me.respawnT <= 0);
    if (on && !this.beamHum) this.beamHum = this.env.sfxLoop('shot_tempest_loop', { x: me.x, vol: 0.55 });
    else if (!on && this.beamHum) { this.beamHum.stop(0.15); this.beamHum = null; }
    if (this.beamHum && me) {
      this.beamHum.setX?.(me.x);
      this.beamHum.setPitch?.(me.odT > 0 ? 3 : 0);
    }
  }

  // stop every looping sound this sim owns (sector change, quit)
  stopLoops() {
    if (this.beamHum) { this.beamHum.stop(0.1); this.beamHum = null; }
    for (const b of this.beams.list) if (b.sfxLoop) { b.sfxLoop.stop(0.1); b.sfxLoop = null; }
  }

  reviveProgress(slot) { return Math.min(1, (this.reviving.get(slot) || 0) / RULES.reviveTime); }

  _applyRevive(ev) {
    const p = this.players[ev.s];
    if (!p || !p.down) return;
    this.env.sfx('revive', { x: p.beacon ? p.beacon.x : 120 });
    if (p.beacon) this.env.fx.shockwave(p.beacon.x, p.beacon.y, 40, ['cyan', 'gold', 'lime', 'violet'][p.slot]);
    this.env.ui.event('toast', { text: `${p.name} REVIVED` });
    if (p.local) {
      p.down = false; p.lives = 1; p.beacon = null;
      p.respawnT = 0.4; p.alive = false;
    } else {
      p.down = false; p.beacon = null;
    }
  }

  checkGameOver() {
    if (this.state !== 'play' && this.state !== 'clear') return;
    const ps = this.players.filter(Boolean);
    if (!ps.length) return;
    const allDown = ps.every((p) => p.down || (!p.alive && p.lives <= 0));
    if (allDown) {
      this.announce('gameover', { score: this.score });
    }
  }

  // ------------------------------------------------------------------ boss / stage flow
  onBossDefeated(e) {
    this.clearBullets(true);
    this.announce('bossdown', { name: e.def.name || 'BOSS', x: Math.round(e.x), y: Math.round(e.y) });
    this.runner?.bossDown();
  }

  sectorClear() {
    if (!this.isHost || this.state !== 'play') return;
    const bonus = 10000 * (this.sectorIndex + 1);
    this.score += bonus;
    const last = this.sectorIndex >= SECTORS.length - 1;
    this.announce(last ? 'victory' : 'clear', { bonus, score: this.score, sector: this.sectorIndex, maxChain: this.maxChain, kills: this.killsBy });
  }

  nextSector(reset = false, same = false) {
    if (!this.isHost) return;
    const n = same ? this.sectorIndex : this.sectorIndex + 1;
    const seed = (this.rng.next() * 4294967296) >>> 0;
    if (reset) this.score = 0;
    this.startSector(n, seed, reset);
    if (this.online) this.outbox.push({ k: 'sec', n, seed, reset: reset ? 1 : 0 });
  }

  continueSolo() {
    const p = this.me;
    this.score = 0;
    p.lives = RULES.lives; p.bombs = RULES.bombs; p.down = false; p.beacon = null;
    p.respawnT = 0.3; p.alive = false;
    this.state = 'play';
  }

  _applyAnnounce(ev) {
    const d = ev.d || {};
    switch (ev.e) {
      case 'banner': this.env.ui.event('banner', d); break;
      case 'warning':
        this.warnT = 3;
        this.env.sfx('warning');
        this.env.haptic('warning');
        this.env.ui.event('warning', d);
        this.env.music?.play?.(d.music || 'boss', { fade: 1.5 });
        break;
      case 'music': this.env.music?.play?.(d.track, { fade: d.fade ?? 1.5 }); break;
      case 'bossdown':
        this.magnetAll = true;
        this.env.music?.stinger?.('boss_defeated');
        this.env.fx.flash?.(0.6, [1, 1, 1]);
        this.clearBullets(true);
        break;
      case 'clear':
        this.state = 'clear';
        this.clearBullets(true);
        this.env.ui.event('clear', Object.assign({}, d, { stats: this.collectStats() }));
        break;
      case 'victory':
        this.state = 'victory';
        this.clearBullets(true);
        this.env.ui.event('victory', Object.assign({}, d, { stats: this.collectStats() }));
        break;
      case 'gameover':
        this.state = 'gameover';
        this.env.ui.event('gameover', { score: d.score ?? this.score, solo: !this.online });
        break;
      case 'scroll': this.scrollSpeed = d.v; break;
      default: this.env.ui.event(ev.e, d);
    }
  }

  collectStats() {
    return this.players.filter(Boolean).map((p) => {
      const s = p.local ? p.stats : (this.statsBy[p.slot] || p.stats);
      return {
        slot: p.slot, name: p.name, ship: p.ship, kills: this.killsBy[p.slot] || s.kills || 0,
        grazes: s.grazes || 0, deaths: s.deaths || 0, bombs: s.bombs || 0,
        accuracy: s.shots ? Math.min(100, Math.round((s.hits / s.shots) * 100)) : 0, gems: s.gems || 0, revives: s.revives || 0,
      };
    });
  }

  // ------------------------------------------------------------------ networking
  sendUp(msg) {
    if (!this.online) return;
    if (this.isHost) {
      // host's own actions are relayed to clients as events
      if (msg.k === 'dth') this.outbox.push({ k: 'dth', by: this.localSlot, x: msg.x, y: msg.y, down: msg.down });
      return;
    }
    this.outbox.push(msg);
  }

  playerState(p) {
    return [p.slot, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, playerFlags(p), Math.round(p.bank * 10) / 10,
      p.lives, p.bombs, p.power, Math.round(p.od * 100), p.beacon ? Math.round(p.beacon.x) : -1, p.beacon ? Math.round(p.beacon.y) : -1];
  }

  flushNet() {
    if (!this.net) return;
    if (this.isHost) {
      const pl = [];
      for (const p of this.players) if (p) pl.push(this.playerState(p));
      const msg = { k: 'B', tk: this.tick, ht: Math.round(this.net.hostTime()), pl };
      // keep every message well under the 16 KB transport cap: overflow goes in extra batches
      const CH = 40;
      let extra = null;
      if (this.outbox.length > CH) {
        extra = [];
        for (let i = CH; i < this.outbox.length; i += CH) extra.push(this.outbox.slice(i, i + CH));
        this.outbox = this.outbox.slice(0, CH);
      }
      if (this.outbox.length) msg.m = this.outbox;
      this._extra = extra;
      if (this.tick % 12 === 0) {
        msg.st = { sc: this.score, ch: this.chain, ct: +this.chainT.toFixed(2), mc: this.maxChain, sec: this.sectorIndex, state: this.state };
        if (this.hpDirty.size) {
          const l = [];
          for (const id of this.hpDirty) { const e = this.enemies.get(id); if (e && e.alive) l.push([id, Math.round(e.hp * 10) / 10]); }
          if (l.length) (msg.m || (msg.m = [])).push({ k: 'hp', l });
          this.hpDirty.clear();
        }
      }
      this.net.send(msg);
      if (this._extra) {
        for (const m of this._extra) this.net.send({ k: 'B', tk: this.tick, ht: msg.ht, m });
        this._extra = null;
      }
      this.outbox = [];
    } else {
      const me = this.me;
      const msg = { k: 'C', tk: this.tick, pl: me ? this.playerState(me) : null };
      if (this.pendingDmg.size) {
        msg.d = [];
        for (const [id, dmg] of this.pendingDmg) msg.d.push([id, Math.round(dmg * 100) / 100]);
        this.pendingDmg.clear();
      }
      if (this.pendingGraze) { msg.g = this.pendingGraze; this.pendingGraze = 0; }
      if (this.outbox.length) msg.m = this.outbox;
      if (this.tick % 60 === 0 && me) msg.ps = me.stats;
      this.net.send(msg);
      this.outbox = [];
    }
  }

  // Host: message from a client
  onClientMessage(msg, from) {
    if (!msg || typeof msg !== 'object' || msg.k !== 'C') return;
    const p = this.players[from];
    if (!p) return;
    if (Array.isArray(msg.pl)) this.ingestPlayerState(p, msg.pl, msg.tk);
    if (Array.isArray(msg.d)) this.applyRemoteDamage(msg.d, from);
    if (typeof msg.g === 'number' && msg.g > 0 && msg.g < 200) this.score += 10 * msg.g * this.chainMult();
    if (msg.ps && typeof msg.ps === 'object') this.statsBy[from] = msg.ps;
    if (Array.isArray(msg.m)) {
      for (const m of msg.m.slice(0, 32)) this.onClientEvent(m, from);
    }
  }

  onClientEvent(m, from) {
    if (!m || typeof m !== 'object') return;
    switch (m.k) {
      case 'dth': this.emitEvent({ k: 'dth', by: from, x: +m.x || 0, y: +m.y || 0, down: m.down ? 1 : 0 }); break;
      case 'bomb': this.emitEvent({ k: 'cl', by: from, x: +m.x || 0, y: +m.y || 0 }); break;
      case 'od': this.emitEvent({ k: 'od', by: from }); break;
      case 'pc': {
        const pk = this.pickups.get(m.id);
        if (pk) this.emitEvent({ k: 'pc', id: pk.id, by: from, ty: pk.type });
        break;
      }
      case 'rv': {
        const t = this.players[m.s];
        if (t && t.down) this.emitEvent({ k: 'rv', s: m.s, by: from });
        break;
      }
      default: break;
    }
  }

  // Client: message from the host
  onHostMessage(msg) {
    if (!msg || typeof msg !== 'object' || msg.k !== 'B') return;
    this.lastHostMsg = performance.now();
    if (typeof msg.tk === 'number') { this.hostTk = msg.tk; this.hostHt = msg.ht || 0; }
    if (Array.isArray(msg.pl)) {
      for (const s of msg.pl) {
        const p = this.players[s[0]];
        if (p && !p.local) this.ingestPlayerState(p, s.slice(1), msg.tk);
      }
    }
    if (msg.st) {
      this.score = msg.st.sc; this.chain = msg.st.ch; this.chainT = msg.st.ct; this.maxChain = msg.st.mc;
    }
    if (Array.isArray(msg.m)) {
      for (const ev of msg.m) {
        if (!ev || typeof ev !== 'object') continue;
        if (ev.k === 'sec' || ev.k === 'ev' || ev.k === 'left' || ev.tk === undefined || ev.tk <= this.tick) this.applyEvent(ev);
        else this.queue.push(ev);
      }
    }
  }

  // state array: [x, y, flags, bank, lives, bombs, power, od, bx, by]  (slot stripped)
  ingestPlayerState(p, s, tk) {
    if (s.length > 10) s = s.slice(s.length - 10); // host 'C' form includes slot first
    const [x, y, f, bank, lives, bombs, power, od, bx, by] = s;
    if (typeof x !== 'number' || typeof y !== 'number') return;
    p.buf.push([tk, clamp(x, -20, FIELD_W + 20), clamp(y, -20, FIELD_H + 30), bank || 0]);
    if (p.buf.length > 20) p.buf.shift();
    p.firing = !!(f & PF.FIRING);
    const wasAlive = p.alive;
    p.alive = !!(f & PF.ALIVE) && !(f & PF.AWAY);
    p.respawnT = (f & PF.AWAY) ? 1 : 0;
    p.inv = (f & PF.INV) ? 0.5 : 0;
    const odOn = !!(f & PF.OD);
    p.odT = odOn ? Math.max(p.odT, 0.2) : 0;
    p.down = !!(f & PF.DOWN);
    if (p.down && bx >= 0) p.beacon = { x: bx, y: by };
    else if (!p.down) p.beacon = null;
    p.lives = lives | 0; p.bombs = bombs | 0; p.power = clamp(power | 0, 1, 8); p.od = (od | 0) / 100;
    if (!wasAlive && p.alive) p.entryT = 1;
  }

  interpolateRemote(p) {
    const buf = p.buf;
    if (!buf.length) return;
    const rt = this.tick - INTERP_DELAY;
    let a = null, b = null;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i][0] <= rt) a = buf[i];
      else { b = buf[i]; break; }
    }
    const px = p.x;
    if (a && b) {
      const u = (rt - a[0]) / Math.max(1, b[0] - a[0]);
      p.x = a[1] + (b[1] - a[1]) * u; p.y = a[2] + (b[2] - a[2]) * u; p.bank = a[3] + (b[3] - a[3]) * u;
    } else {
      const last = a || b;
      p.x += (last[1] - p.x) * 0.5; p.y += (last[2] - p.y) * 0.5; p.bank = last[3];
    }
    p.vx = p.x - px;
  }

  // Client: how many ticks we should be ahead/behind the host's estimated tick right now.
  tickError() {
    if (this.isHost || !this.net) return 0;
    const now = this.net.hostTime();
    let est = this.hostTk + (now - this.hostHt) * 0.06;
    est = Math.min(est, this.hostTk + 30);   // don't run far ahead of a silent host
    return est - this.tick;
  }

  hostSilentFor() { return this.isHost ? 0 : performance.now() - this.lastHostMsg; }

  onPeerLeave(slot) {
    if (!this.isHost) return;
    if (this.players[slot]) {
      this.players[slot] = null;
      this.diff = this.computeDiff();
      this.emitEvent({ k: 'left', s: slot });
      this.checkGameOver();
    }
  }

  // ------------------------------------------------------------------ drawing
  draw(R) {
    const env = this.env;
    const { ctx, lctx } = R;
    const tick = this.tick;
    // background (full canvas)
    if (env.bg) env.bg.draw(ctx, lctx, this.scrollY, this.sectorT);

    R.beginField(true);
    // ground enemies first, then by z
    for (const e of this.elist) if (e.alive && !e.dying && e.def.ground) this.drawEnemy(e, ctx, lctx, tick);
    for (const e of this.elist) if (e.alive && !e.dying && !e.def.ground) this.drawEnemy(e, ctx, lctx, tick);

    // pickups
    const S = env.sprites;
    for (const pk of this.pickups.values()) {
      const spr = 'pk_' + pk.type;
      const fr = (tick >> 2) + pk.id;
      S.draw(ctx, spr, fr, pk.x, pk.y, null);
      S.drawE(lctx, spr, fr, pk.x, pk.y, null);
    }

    // player shots + beams
    this.pbs.draw(ctx, lctx, env, tick);
    for (const p of this.players) if (p) drawBeamFor(this, p, ctx, lctx, tick);

    // players (remote first, local on top)
    for (const p of this.players) if (p && !p.local) drawPlayer(this, p, ctx, lctx, tick);
    if (this.me) drawPlayer(this, this.me, ctx, lctx, tick);
    // remote name tags
    if (this.online && env.text) {
      for (const p of this.players) {
        if (!p || p.local || !p.alive || p.respawnT > 0) continue;
        const o = this._tagOpt || (this._tagOpt = { color: '', align: 'center', font: 'small', alpha: 0.75 });
        o.color = TAG_COLORS[p.slot];
        env.text(ctx, p.name, Math.round(p.x), Math.round(p.y + 15), o);
      }
    }

    env.fx.draw(ctx, lctx);
    this.beams.draw(ctx, lctx, env, tick);
    this.ebs.draw(ctx, lctx, env, tick);
    R.endField();
  }

  drawEnemy(e, ctx, lctx, tick) {
    const def = e.def;
    const S = this.env.sprites;
    if (def.draw) { def.draw(e, ctx, lctx, this, this.env); return; }
    const t = (tick - e.t0) / 60;
    const fps = def.fps ?? 8;
    let fr = Math.floor(t * fps);
    if (def.frame) fr = def.frame(e, t, this);
    const heading = e.face ?? e.heading;
    const opt = def.rot ? S.optDir(def.spr, heading) : S.optNone();
    S.draw(ctx, def.spr, fr, e.x, e.y, opt);
    if (e.flash > 0) this.drawFlash(ctx, def.spr, fr, e.x, e.y, opt, def.boss || e.r > 16 ? 0.45 : 0.85);
    S.drawE(lctx, def.spr, fr, e.x, e.y, opt);
    if (def.drawOver) def.drawOver(e, ctx, lctx, this, this.env);
  }

  // translucent white hit-flash overlay (throttled so sustained fire doesn't strobe)
  drawFlash(ctx, spr, fr, x, y, opt, alpha) {
    const w = this.env.sprites.withWhite(opt);
    w.alpha = alpha;
    this.env.sprites.draw(ctx, spr, fr, x, y, w);
  }

  // mark an enemy as hit (visual only); cooldown prevents strobing under constant fire
  flashEnemy(e) {
    if ((e.flashCd || 0) > this.tick) return;
    e.flash = 2;
    e.flashCd = this.tick + 6;
  }

  hudState() {
    const me = this.me;
    const boss = this.bossIds.length ? this.enemies.get(this.bossIds[0]) : null;
    return {
      score: this.score,
      hiScore: Math.max(this.env.hiScore || 0, this.score),
      chain: this.chain, chainMult: this.chainMult(), chainTimer: clamp(this.chainT / RULES.chainWindow, 0, 1),
      players: this.players.filter(Boolean).map((p) => ({
        slot: p.slot, name: p.name, ship: p.ship, lives: p.lives, alive: p.alive, beacon: !!p.down,
        power: p.power, isLocal: p.local, bombs: p.bombs,
      })),
      bombs: me ? me.bombs : 0,
      power: me ? me.power : 1, powerMax: RULES.powerMax,
      overdrive: me ? me.od : 0, overdriveActive: me ? me.odT > 0 : false,
      boss: boss && boss.alive ? { name: boss.def.name || 'BOSS', hp: clamp(this.bossHp(boss), 0, 1), phase: boss.phase } : null,
      sector: this.sectorIndex + 1, sectorName: this.sector.name,
      warning: this.warnT > 0 ? this.warnT / 3 : 0,
      downed: me ? me.down : false,
    };
  }

  bossHp(boss) {
    // total hp across the boss and its bar-flagged parts
    if (boss.def.hpFn) return boss.def.hpFn(boss, this);
    return boss.hp / boss.maxHp;
  }
}

// ---------------------------------------------------------------------------------------
// Stage runner (host only): executes the sector's script steps in sequence.
// Step fields: dt (seconds before this step), and one of:
//   spawn:type n gap p(object | (i, rng, sim) => object)   — spawn a group (p.path chooses the path)
//   call:(sim, rng) => void                                  — custom logic
//   wait:'clear' max                                         — wait until non-ground enemies are gone
//   wait:'boss'                                              — wait until the boss is defeated
//   banner:{title, sub}  warning:{name, music}  music:track   boss:key  pickup:{type, x, y}  end:true
class StageRunner {
  constructor(sim, stage) {
    this.sim = sim;
    this.steps = (typeof stage.script === 'function' ? stage.script(sim) : stage.script) || [];
    this.i = 0;
    this.timer = this.steps.length ? (this.steps[0].dt || 0) : 0;
    this.waiting = null;
    this.spawning = [];
    this.bossDead = false;
    this.done = false;
    this.clearT = -1;
    this.rng = new RNG(hash32(sim.seed, 1234));
    this.grp = 1;
  }

  update() {
    const sim = this.sim;
    // group spawns in progress
    for (const s of this.spawning) {
      s.t -= DT;
      while (s.t <= 0 && s.i < s.n) {
        this.spawnOne(s.step, s.i, s.grp);
        s.i++;
        s.t += s.step.gap || 0.0001;
      }
    }
    this.spawning = this.spawning.filter((s) => s.i < s.n);

    if (this.clearT >= 0) {
      this.clearT -= DT;
      if (this.clearT < 0) { this.clearT = -1; sim.sectorClear(); this.done = true; }
      return;
    }
    if (this.done) return;
    if (this.waiting) {
      const w = this.waiting;
      w.t += DT;
      let ok = false;
      if (w.kind === 'clear') ok = !sim.elist.some((e) => e.alive && !e.def.ground && !e.def.ignoreClear) && !this.spawning.length;
      if (w.kind === 'boss') ok = this.bossDead;
      if (ok || (w.max && w.t >= w.max)) {
        this.waiting = null;
        this.i++;
        this.timer = this.steps[this.i] ? (this.steps[this.i].dt || 0) : 0;
      }
      return;
    }
    this.timer -= DT;
    while (this.timer <= 0 && this.i < this.steps.length && !this.waiting && !this.done) {
      const step = this.steps[this.i];
      const blocking = this.exec(step);
      if (blocking) return;
      this.i++;
      if (this.i < this.steps.length) this.timer += this.steps[this.i].dt || 0;
    }
  }

  spawnOne(step, i, grp) {
    const sim = this.sim;
    let p = typeof step.p === 'function' ? step.p(i, this.rng, sim) : Object.assign({}, step.p || {});
    if (!p) return;
    p = Object.assign({}, p);
    if (step.bonus) { p.grp = grp; p.grpDrop = step.bonus; }
    for (const k of Object.keys(p)) if (typeof p[k] === 'number') p[k] = Math.round(p[k] * 100) / 100;
    sim.spawn(step.spawn, p);
  }

  exec(step) {
    const sim = this.sim;
    if (step.spawn) {
      const n = Math.max(1, Math.round((step.n || 1) * (step.scale === false ? 1 : 1)));
      const grp = this.grp++;
      this.spawning.push({ step, n, i: 0, t: 0, grp });
      // spawn the first immediately
      const s = this.spawning[this.spawning.length - 1];
      this.spawnOne(step, 0, grp); s.i = 1; s.t = step.gap || 0;
    }
    if (step.call) step.call(sim, this.rng);
    if (step.banner) sim.announce('banner', step.banner);
    if (step.warning) sim.announce('warning', step.warning === true ? {} : step.warning);
    if (step.music) sim.announce('music', { track: step.music });
    if (step.pickup) sim.spawnPickup(step.pickup.type, step.pickup.x ?? FIELD_W / 2, step.pickup.y ?? -10, this.rng);
    if (step.boss) {
      const B = BOSSES[step.boss];
      if (B) B.spawn(sim, this.rng); else console.warn('unknown boss', step.boss);
    }
    if (step.end) { this.clearT = 3.5; return true; }
    if (step.wait) {
      this.waiting = { kind: step.wait, t: 0, max: step.max || (step.wait === 'boss' ? 0 : 20) };
      return true;
    }
    return false;
  }

  bossDown() { this.bossDead = true; }
}
