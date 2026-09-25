// Nova Lancers — multiplayer sessions (DESIGN.md §9).
//
// Star topology: the host is the hub. Each client reaches the host either over a WebRTC
// data channel (PeerJS, P2P) or through the MQTT relay; the host always listens on both,
// so rooms can be mixed. Session semantics are identical for both transports.
//
//   hostSession({ name, ship, isPublic })  -> Session (host)
//   joinSession(code, { name, ship })      -> Session (client)
//        rejects Error('ROOM_NOT_FOUND'|'ROOM_FULL'|'ALREADY_STARTED'|'NETWORK'|'VERSION')
//   quickMatch({ name, ship })             -> Session (host or client of a public room)
//   makeInviteUrl(code), parseRoomFromUrl()
//
// Wire format: JSON objects. Session internals carry a string `_` field (hello, welcome,
// lobby, ping, ...); anything without `_` is a game message and is surfaced through the
// 'message' event. Game messages must therefore not use a top-level `_` key.

import {
  PROTO, VERSION, MAX_PLAYERS, PUB_SLOTS, INVITE_BASE, P2P_TIMEOUT, HEARTBEAT_MS, LOST_MS,
  LOST_HIDDEN_MS, STALE_MS, CID_RE, BAD, Emitter, Bucket, netConfig, configureNet, randomCode,
  randomId, normalizeCode, roomPeerId, pubPeerId, sanitizeName, sanitizeShip, isObj, isInt,
  isNum, encodeMsg, now, sleep, netError, SHIP_ORDER, validInfo,
} from './common.js';
import { openEndpoint, loadPeerJS } from './p2p.js';
import { RelayHub, RelayProber, RelayClientLink } from './relay.js';

export { configureNet, netConfig, loadPeerJS };

const ERR_CODES = ['ROOM_NOT_FOUND', 'ROOM_FULL', 'ALREADY_STARTED', 'NETWORK', 'VERSION'];
const NET_KINDS = ['host', 'p2p', 'relay'];
const PENDING_TTL = 15000;
const RELAY_PROBE_DELAY = 700;
const MAX_PENDING = 24;

// ---------------------------------------------------------------------------
// Page lifecycle: close sessions on pagehide, tell peers when we go to the background.

const LIVE = new Set();
let lifecycleHooked = false;
function hookLifecycle() {
  if (lifecycleHooked || typeof window === 'undefined') return;
  lifecycleHooked = true;
  window.addEventListener('pagehide', () => {
    for (const s of Array.from(LIVE)) s._shutdown('LEFT', true, true);
  });
  document.addEventListener('visibilitychange', () => {
    for (const s of Array.from(LIVE)) s._onVisibility(document.hidden);
  });
}

// ---------------------------------------------------------------------------
// Validation helpers for data coming off the wire.

function normLobby(l) {
  if (!isObj(l) || !Array.isArray(l.players) || l.players.length > MAX_PLAYERS) return null;
  const seen = new Set();
  const players = [];
  for (const p of l.players) {
    if (!isObj(p) || !isInt(p.slot, 0, MAX_PLAYERS - 1) || seen.has(p.slot)) return null;
    seen.add(p.slot);
    players.push({
      slot: p.slot,
      name: sanitizeName(p.name, `PILOT ${p.slot + 1}`),
      ship: sanitizeShip(p.ship),
      ready: p.ready === true,
      connected: p.connected !== false,
      ping: isNum(p.ping) ? Math.max(0, Math.min(9999, Math.round(p.ping))) : 0,
      net: NET_KINDS.includes(p.net) ? p.net : 'p2p',
    });
  }
  players.sort((a, b) => a.slot - b.slot);
  return { players, started: l.started === true };
}

function joinableInfo(m) {
  return validInfo(m) && m.v === PROTO && m.gv === VERSION && !m.st && m.n < m.max;
}

// ---------------------------------------------------------------------------

class Session extends Emitter {
  constructor(isHost) {
    super();
    this.isHost = isHost;
    this.code = '';
    this.isPublic = false;
    this.selfSlot = 0;
    this.lobby = { players: [], started: false };
    this.closed = false;
    this.closeReason = null;
    this._lastTick = now();
    this._tickTimer = setInterval(() => this._tick(), 250);
    LIVE.add(this);
    hookLifecycle();
  }

  _tick() {
    if (this.closed) return;
    const t = now();
    const gap = t - this._lastTick;
    this._lastTick = t;
    // Our own timers were frozen (background tab): don't blame peers for that time.
    if (gap > 1500) this._frozen(gap - 250);
    this._update(t);
  }

  /** Leave the session (graceful: peers are told). Emits 'close' ('LEFT'). */
  close() { this._shutdown('LEFT', true, true); }

  _shutdown(reason, graceful, emit) {
    if (this.closed) return;
    this.closed = true;
    this.closeReason = reason;
    clearInterval(this._tickTimer);
    LIVE.delete(this);
    try { this._teardown(graceful); } catch (e) { console.error(e); }
    if (emit) this._emit('close', reason);
  }

  // Overridden:
  _update() {}
  _frozen() {}
  _teardown() {}
  _onVisibility() {}
}

// ---------------------------------------------------------------------------
// Host

class HostSession extends Session {
  constructor(o) {
    super(true);
    this.code = o.code;
    this.isPublic = !!o.isPublic;
    this.pubSlot = o.pubEP ? o.pubSlot : -1;
    this.tentative = !!o.tentative;
    this.started = false;
    this.roomEP = o.roomEP || null;
    this.pubEP = o.pubEP || null;
    this.hub = o.hub || null;
    this.players = [{
      slot: 0, name: sanitizeName(o.name, 'PILOT 1'), ship: sanitizeShip(o.ship), ready: true,
      connected: true, ping: 0, net: 'host', link: null,
    }];
    for (let i = 1; i < MAX_PLAYERS; i++) this.players.push(null);
    this.pending = new Set();
    this.hidden = typeof document !== 'undefined' && document.hidden;
    this._dirtyQueued = false;
    this._pingsAt = 0;
    this._annAt = 0;
    this._lobbyPings = '';
    for (const ep of [this.roomEP, this.pubEP]) if (ep) this._attachEndpoint(ep);
    if (this.hub) this.hub.onlink = (link) => this._onNewLink(link);
    this.lobby = this._buildLobby();
    this._announce();
  }

  hostTime() { return now(); }

  ping(slot) {
    if (slot == null || slot === 0) return 0;
    const p = this.players[slot];
    return p ? p.ping : 0;
  }

  get transportKind() {
    let p2p = false, relay = false;
    for (let i = 1; i < MAX_PLAYERS; i++) {
      const p = this.players[i];
      if (!p) continue;
      if (p.link.kind === 'p2p') p2p = true; else relay = true;
    }
    if (p2p && relay) return 'mixed';
    if (relay) return 'relay';
    if (p2p) return 'p2p';
    return this.roomEP && this.roomEP.signaling ? 'p2p' : 'relay';
  }

  // ---- public API ----

  setInfo(info) {
    if (this.closed || !isObj(info)) return;
    this._applyInfo(this.players[0], info);
  }

  startGame(payload) {
    if (this.closed || this.started) return false;
    const str = encodeMsg({ _: 'start', p: payload === undefined ? null : payload });
    if (!str) return false;
    this.started = true;
    this.tentative = false;
    this._broadcastRaw(str, true);
    this.lobby = this._buildLobby();
    this._dirty();
    this._emit('start', payload);
    return true;
  }

  /** Extra (not in §9): reopen the lobby after a game (clears ready flags). */
  endGame() {
    if (this.closed || !this.started) return;
    this.started = false;
    for (let i = 1; i < MAX_PLAYERS; i++) if (this.players[i]) this.players[i].ready = false;
    this._dirty();
  }

  send(msg) {
    if (this.closed || !isObj(msg) || msg._ !== undefined) return false;
    const str = encodeMsg(msg);
    if (!str) return false;
    this._broadcastRaw(str, false);
    return true;
  }

  sendTo(slot, msg) {
    if (this.closed || !isObj(msg) || msg._ !== undefined) return false;
    const p = isInt(slot, 1, MAX_PLAYERS - 1) ? this.players[slot] : null;
    if (!p) return false;
    const str = encodeMsg(msg);
    return str ? p.link.sendRaw(str, false) : false;
  }

  /** Extra (not in §9): remove a player; they receive close('KICKED'). */
  kick(slot) {
    const p = isInt(slot, 1, MAX_PLAYERS - 1) ? this.players[slot] : null;
    if (!p || this.closed) return;
    p.link.sendRaw('{"_":"kick"}', true);
    this._removePlayer(slot, 'kicked');
  }

  // ---- internals ----

  _attachEndpoint(ep) {
    ep.onconnection = (link) => this._onNewLink(link);
    let delay = 1000;
    ep.ondisconnected = () => {
      // Signaling socket dropped: existing data channels live on; re-register for new joins.
      if (this.closed) return;
      setTimeout(() => { if (!this.closed) ep.reconnect(); }, delay);
      delay = Math.min(delay * 2, 30000);
    };
  }

  _onNewLink(link) {
    if (this.closed || this.pending.size >= MAX_PENDING) { link.close(); return; }
    link.slot = null;
    link.born = now();
    link.strikes = 0;
    link.bucket = new Bucket(120, 360);
    link.onmessage = (obj) => this._onLinkMsg(link, obj);
    link.onclose = () => this._onLinkClose(link);
    this.pending.add(link);
  }

  _onLinkClose(link) {
    this.pending.delete(link);
    if (link.slot != null) {
      const p = this.players[link.slot];
      if (p && p.link === link) this._removePlayer(link.slot, 'left');
    }
  }

  _dropLink(link) {
    if (link.slot != null) { this.kick(link.slot); return; }
    this.pending.delete(link);
    link.close();
  }

  _onLinkMsg(link, obj) {
    if (this.closed) return;
    if (!link.bucket.take()) {
      if (link.bucket.drops > 600) this._dropLink(link);
      return;
    }
    if (obj === BAD) {
      if (++link.strikes > 40) this._dropLink(link);
      return;
    }
    const type = obj._;
    if (type !== undefined && typeof type !== 'string') return;
    if (link.slot == null) {
      if (type === 'probe') link.sendRaw(this._infoStr(), true);
      else if (type === 'hello') this._onHello(link, obj);
      return;
    }
    const slot = link.slot;
    const p = this.players[slot];
    if (!p || p.link !== link) return;
    p.lastSeen = now();
    if (!p.connected) { p.connected = true; this._dirty(); }
    if (type === undefined) { this._emit('message', obj, slot); return; }
    switch (type) {
      case 'ping':
        if (isNum(obj.t)) link.sendRaw(JSON.stringify({ _: 'pong', t: obj.t, h: now() }), true);
        if (isNum(obj.r) && obj.r >= 0) p.ping = Math.min(9999, Math.round(obj.r));
        break;
      case 'info': this._applyInfo(p, obj); break;
      case 'vis': p.hidden = obj.h === 1; break;
      case 'bye': this._removePlayer(slot, 'left'); break;
      case 'hello': this._welcome(p); break; // resent hello (relay): idempotent
      default: break; // unknown internal type: ignore
    }
  }

  _onHello(link, m) {
    if (m.v !== PROTO || m.gv !== VERSION) { this._reject(link, 'VERSION'); return; }
    if (typeof m.cid !== 'string' || !CID_RE.test(m.cid)) { link.strikes += 5; return; }
    // Same client again (retransmit, or re-hello over another transport): rebind.
    for (let i = 1; i < MAX_PLAYERS; i++) {
      const p = this.players[i];
      if (!p || p.cid !== m.cid) continue;
      if (p.link !== link) {
        const old = p.link;
        old.slot = null;
        old.onclose = null;
        old.close();
        this.pending.delete(link);
        link.slot = i;
        link.bound = true;
        p.link = link;
        p.net = link.kind;
        p.lastSeen = now();
        this._emit('transport', { slot: i, kind: link.kind });
        this._dirty();
      }
      this._welcome(p);
      return;
    }
    if (this.started) { this._reject(link, 'ALREADY_STARTED'); return; }
    let slot = -1;
    for (let i = 1; i < MAX_PLAYERS; i++) if (!this.players[i]) { slot = i; break; }
    if (slot < 0) { this._reject(link, 'ROOM_FULL'); return; }
    const p = {
      slot, cid: m.cid, name: sanitizeName(m.name, `PILOT ${slot + 1}`), ship: sanitizeShip(m.ship),
      ready: false, connected: true, ping: 0, net: link.kind, link, lastSeen: now(),
      hidden: m.hid === 1,
    };
    this.players[slot] = p;
    this.pending.delete(link);
    link.slot = slot;
    link.bound = true;
    link.bucket = new Bucket(150, 450);
    this.lobby = this._buildLobby();
    this._welcome(p);
    this._emit('peerjoin', slot, this._pubInfo(p));
    this._emit('transport', { slot, kind: link.kind });
    this._dirty();
  }

  _welcome(p) {
    p.link.sendRaw(JSON.stringify({
      _: 'welcome', slot: p.slot, code: this.code, pub: this.isPublic ? 1 : 0,
      lobby: this.lobby, h: now(), hid: this.hidden ? 1 : 0,
    }), true);
  }

  _reject(link, code) {
    if (link.rejected) return;
    link.rejected = true;
    link.sendRaw(JSON.stringify({ _: 'err', e: code }), true);
    setTimeout(() => { this.pending.delete(link); link.close(true); }, 600);
  }

  _applyInfo(p, info) {
    let changed = false;
    if (info.name !== undefined) {
      const n = sanitizeName(info.name, p.name);
      if (n !== p.name) { p.name = n; changed = true; }
    }
    if (typeof info.ship === 'string' && SHIP_ORDER.includes(info.ship) && info.ship !== p.ship) {
      p.ship = info.ship;
      changed = true;
    }
    if (typeof info.ready === 'boolean' && info.ready !== p.ready) { p.ready = info.ready; changed = true; }
    if (changed) this._dirty();
  }

  _removePlayer(slot, reason) {
    const p = this.players[slot];
    if (!p || slot === 0) return;
    this.players[slot] = null;
    const link = p.link;
    link.slot = null;
    link.onclose = null;
    link.onmessage = null;
    link.close(true);
    this._emit('peerleave', slot, { ...this._pubInfo(p), reason });
    this._dirty();
  }

  _pubInfo(p) {
    return { slot: p.slot, name: p.name, ship: p.ship, ready: p.ready, connected: p.connected, ping: p.ping, net: p.net };
  }

  _buildLobby() {
    const players = [];
    for (const p of this.players) if (p) players.push(this._pubInfo(p));
    return { players, started: this.started };
  }

  _count() {
    let n = 0;
    for (const p of this.players) if (p) n++;
    return n;
  }

  // Lobby changes are coalesced per task and then broadcast + emitted once.
  _dirty() {
    if (this._dirtyQueued) return;
    this._dirtyQueued = true;
    queueMicrotask(() => {
      this._dirtyQueued = false;
      if (this.closed) return;
      this.lobby = this._buildLobby();
      this._lobbyPings = this.lobby.players.map((p) => p.ping).join(',');
      this._broadcastRaw(JSON.stringify({ _: 'lobby', l: this.lobby }), false);
      this._emit('lobby', this.lobby);
      this._announce();
    });
  }

  _broadcastRaw(str, urgent) {
    let relay = false;
    for (let i = 1; i < MAX_PLAYERS; i++) {
      const p = this.players[i];
      if (!p) continue;
      if (p.link.kind === 'relay') relay = true; else p.link.sendRaw(str);
    }
    if (relay && this.hub) this.hub.enqueue(str, null, urgent);
  }

  _info() {
    return {
      v: PROTO, gv: VERSION, code: this.code, n: this._count(), max: MAX_PLAYERS,
      st: this.started ? 1 : 0, pub: this.isPublic ? 1 : 0, tent: this.tentative ? 1 : 0,
      slot: this.pubSlot, p2p: this.roomEP && this.roomEP.signaling ? 1 : 0,
    };
  }

  _infoStr() { return JSON.stringify({ _: 'info', ...this._info() }); }

  _announce() {
    if (!this.hub || !this.isPublic || this.started || this.closed) return;
    if (this._count() >= MAX_PLAYERS) return;
    this._annAt = now();
    this.hub.announce(JSON.stringify({ _: 'ann', ...this._info() }));
  }

  _update(t) {
    for (let i = 1; i < MAX_PLAYERS; i++) {
      const p = this.players[i];
      if (!p) continue;
      const silence = t - p.lastSeen;
      if (silence > (p.hidden ? LOST_HIDDEN_MS : LOST_MS)) this._removePlayer(i, 'timeout');
      else if (silence > STALE_MS && p.connected) { p.connected = false; this._dirty(); }
    }
    for (const link of Array.from(this.pending)) {
      if (t - link.born > PENDING_TTL) { this.pending.delete(link); link.close(); }
    }
    if (t - this._pingsAt >= 2000) {
      this._pingsAt = t;
      if (this.started) {
        const arr = this.players.map((p) => (p ? p.ping : null));
        if (arr.some((v, i) => i > 0 && v !== null)) this._broadcastRaw(JSON.stringify({ _: 'pings', p: arr }), false);
      } else {
        const sig = this.players.filter(Boolean).map((p) => p.ping).join(',');
        if (sig !== this._lobbyPings) this._dirty();
      }
    }
    if (t - this._annAt >= 2000) this._announce();
    if (this.hub) this.hub.maintain(t);
  }

  _frozen(gap) {
    for (let i = 1; i < MAX_PLAYERS; i++) if (this.players[i]) this.players[i].lastSeen += gap;
  }

  _onVisibility(hidden) {
    if (this.closed) return;
    this.hidden = hidden;
    this._broadcastRaw(JSON.stringify({ _: 'vis', h: hidden ? 1 : 0 }), true);
  }

  /** Quick match: stop being tentative (becomes a normal public room). */
  _settle() {
    this.tentative = false;
    this._announce();
  }

  _teardown(graceful) {
    if (graceful) this._broadcastRaw('{"_":"bye"}', true);
    for (let i = 1; i < MAX_PLAYERS; i++) {
      const p = this.players[i];
      if (!p) continue;
      p.link.onclose = null;
      p.link.onmessage = null;
      p.link.close(graceful);
    }
    for (const link of this.pending) { link.onclose = null; link.close(); }
    this.pending.clear();
    if (this.hub) this.hub.close();
    const eps = [this.roomEP, this.pubEP].filter(Boolean);
    for (const ep of eps) { ep.onconnection = null; ep.ondisconnected = null; }
    if (graceful) setTimeout(() => { for (const ep of eps) ep.destroy(); }, 700);
    else for (const ep of eps) ep.destroy();
  }
}

// ---------------------------------------------------------------------------
// Client

class ClientSession extends Session {
  constructor(o) {
    super(false);
    this.link = o.link;
    this.ep = o.ep || null;
    this.code = o.code;
    this.cid = o.cid;
    this.isPublic = !!o.isPublic;
    this.selfSlot = o.slot;
    this.lobby = o.lobby;
    this.started = o.lobby.started;
    this.rtt = Math.max(0, o.rtt);
    this.offset = o.hostNow + this.rtt / 2 - now();
    this.samples = [];
    this.lastSeen = now();
    this.hostHidden = o.hostHidden;
    this.pings = 0;
    this.nextPing = now() + 120;
    this.bucket = new Bucket(500, 1500);
    this.link.onmessage = (obj) => this._onMsg(obj);
    // A P2P channel that closes on us without a 'bye' is most likely the host's tab going away.
    this.link.onclose = () => this._shutdown(this.link.kind === 'p2p' ? 'HOST_LEFT' : 'NETWORK', false, true);
    setTimeout(() => {
      if (this.closed) return;
      this._emit('transport', { slot: this.selfSlot, kind: this.link.kind });
      if (typeof document !== 'undefined' && document.hidden) this._onVisibility(true);
    }, 0);
  }

  hostTime() { return now() + this.offset; }

  ping(slot) {
    if (slot == null || slot === this.selfSlot || slot === 0) return Math.round(this.rtt);
    const p = this.lobby.players.find((q) => q.slot === slot);
    return p ? p.ping : 0;
  }

  get transportKind() { return this.link.kind; }

  setInfo(info) {
    if (this.closed || !isObj(info)) return;
    const msg = { _: 'info' };
    const me = this.lobby.players.find((p) => p.slot === this.selfSlot);
    const upd = me ? { ...me } : null;
    if (info.name !== undefined) {
      msg.name = sanitizeName(info.name, me ? me.name : `PILOT ${this.selfSlot + 1}`);
      if (upd) upd.name = msg.name;
    }
    if (typeof info.ship === 'string' && SHIP_ORDER.includes(info.ship)) { msg.ship = info.ship; if (upd) upd.ship = info.ship; }
    if (typeof info.ready === 'boolean') { msg.ready = info.ready; if (upd) upd.ready = info.ready; }
    this.link.sendRaw(JSON.stringify(msg), true);
    if (upd) {
      // Optimistic local update; the host's broadcast confirms it.
      this.lobby = { ...this.lobby, players: this.lobby.players.map((p) => (p.slot === upd.slot ? upd : p)) };
      this._emit('lobby', this.lobby);
    }
  }

  startGame() { return false; }

  send(msg) {
    if (this.closed || !isObj(msg) || msg._ !== undefined) return false;
    const str = encodeMsg(msg);
    return str ? this.link.sendRaw(str, false) : false;
  }

  sendTo(slot, msg) { return slot === 0 ? this.send(msg) : false; }

  _onMsg(obj) {
    if (this.closed || !this.bucket.take() || obj === BAD) return;
    this.lastSeen = now();
    const type = obj._;
    if (type === undefined) { this._emit('message', obj, 0); return; }
    switch (type) {
      case 'pong': this._onPong(obj); break;
      case 'lobby': this._onLobby(obj.l); break;
      case 'start':
        this.started = true;
        this.lobby = { ...this.lobby, started: true };
        this._emit('start', obj.p);
        break;
      case 'pings':
        if (Array.isArray(obj.p) && obj.p.length <= MAX_PLAYERS) {
          for (const p of this.lobby.players) {
            const v = obj.p[p.slot];
            if (isNum(v)) p.ping = Math.max(0, Math.min(9999, Math.round(v)));
          }
        }
        break;
      case 'vis': this.hostHidden = obj.h === 1; break;
      case 'bye': this._shutdown('HOST_LEFT', false, true); break;
      case 'kick': this._shutdown('KICKED', false, true); break;
      default: break;
    }
  }

  _onLobby(l) {
    const lobby = normLobby(l);
    if (!lobby) return;
    const before = new Map(this.lobby.players.map((p) => [p.slot, p]));
    const after = new Map(lobby.players.map((p) => [p.slot, p]));
    this.lobby = lobby;
    this.started = lobby.started;
    for (const [slot, p] of before) if (!after.has(slot)) this._emit('peerleave', slot, p);
    for (const [slot, p] of after) if (!before.has(slot)) this._emit('peerjoin', slot, p);
    if (!after.has(this.selfSlot)) { this._shutdown('KICKED', false, true); return; }
    this._emit('lobby', lobby);
  }

  _onPong(m) {
    if (!isNum(m.t) || !isNum(m.h)) return;
    const t = now();
    const rtt = t - m.t;
    if (rtt < 0 || rtt > 20000) return;
    this.rtt = rtt;
    this.samples.push({ rtt, off: m.h + rtt / 2 - t, at: t });
    while (this.samples.length > 16 || (this.samples.length > 4 && t - this.samples[0].at > 60000)) this.samples.shift();
    // Lowest-RTT samples carry the least asymmetric queueing delay: average the best 3.
    const best = this.samples.slice().sort((a, b) => a.rtt - b.rtt).slice(0, 3);
    let target = 0;
    for (const s of best) target += s.off;
    target /= best.length;
    const d = target - this.offset;
    if (this.samples.length <= 2 || Math.abs(d) > 150) this.offset = target;
    else this.offset += d * 0.25;
  }

  _sendPing() {
    this.link.sendRaw(JSON.stringify({ _: 'ping', t: now(), r: Math.round(this.rtt) }), true);
  }

  _update(t) {
    if (t >= this.nextPing) {
      this.pings++;
      this.nextPing = t + (this.pings < 6 ? 200 : HEARTBEAT_MS);
      this._sendPing();
    }
    if (t - this.lastSeen > (this.hostHidden ? LOST_HIDDEN_MS : LOST_MS)) this._shutdown('NETWORK', false, true);
  }

  _frozen(gap) {
    this.lastSeen += gap;
    this.nextPing = 0;
  }

  _onVisibility(hidden) {
    if (this.closed) return;
    this.link.sendRaw(JSON.stringify({ _: 'vis', h: hidden ? 1 : 0 }), true);
    if (!hidden) this.nextPing = 0;
  }

  _teardown(graceful) {
    if (graceful) this.link.sendRaw('{"_":"bye"}', true);
    this.link.onclose = null;
    this.link.onmessage = null;
    this.link.close(graceful);
    const ep = this.ep;
    if (ep) {
      if (graceful) setTimeout(() => ep.destroy(), 700); else ep.destroy();
    }
  }
}

// ---------------------------------------------------------------------------
// Joining: P2P first, relay in parallel; commit to whichever the rules pick (see _decide).

class Joiner {
  constructor(code, opts, pre = null) {
    this.code = code;
    this.name = opts.name;
    this.ship = sanitizeShip(opts.ship);
    this.pre = pre;
    this.cid = randomId(12);
    this.p2p = 'pending';     // 'pending' | 'open' | 'UNAVAILABLE' | 'TIMEOUT' | 'FAILED' | 'NETWORK' | 'OFF'
    this.relay = 'pending';   // 'pending' | 'negative' | 'unreachable'
    this.relayInfo = null;
    this.relayMq = null;
    this.relayUrl = null;
    this.answered = false;
    this.ep = null;
    this.p2pLink = null;
    this.prober = null;
    this.link = null;
    this.done = false;
    this.timers = [];
  }

  run() {
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      this.t0 = now();
      this.timers.push(setInterval(() => this._decide(), 200));
      this.timers.push(setTimeout(() => this._fail('NETWORK'), 20000));
      if (this.pre) {
        this.ep = this.pre.ep || null;
        this._commit(this.pre.link);
        return;
      }
      this._startP2P();
      // Give P2P a head start so quick P2P joins never touch the public brokers.
      this.timers.push(setTimeout(() => this._startRelay(), RELAY_PROBE_DELAY));
    });
  }

  async _startP2P() {
    const cfg = netConfig();
    if (!cfg.p2p || cfg.forceRelay) { this.p2p = 'OFF'; this._startRelay(); return; }
    let ep;
    try {
      ep = await openEndpoint(null, P2P_TIMEOUT);
    } catch {
      this.p2p = 'NETWORK';
      this._startRelay();
      this._decide();
      return;
    }
    if (this.done || this.link) { ep.destroy(); return; }
    this.ep = ep;
    const left = Math.max(800, P2P_TIMEOUT - (now() - this.t0));
    const { link, done } = ep.connect(roomPeerId(this.code), left);
    this.p2pLink = link;
    done.then(
      () => { this.p2p = 'open'; this._decide(); },
      (e) => { if (this.p2p === 'pending') this.p2p = e.message; this._startRelay(); this._decide(); },
    );
  }

  _startRelay() {
    if (this.prober || this.done || this.link) return;
    const cfg = netConfig();
    this.prober = new RelayProber(this.code, this.cid, cfg.brokers,
      (info, mq, url) => { this.relayInfo = info; this.relayMq = mq; this.relayUrl = url; this._decide(); },
      (state) => { this.relay = state; this._decide(); });
    this.prober.start();
  }

  _decide() {
    if (this.done || this.link) return;
    if (this.p2pLink && this.p2pLink.answered) this.answered = true;
    if (this.p2p === 'open') { this._commit(this.p2pLink); return; }
    const p2pDead = this.p2p !== 'pending';
    const info = this.relayInfo;
    if (info) {
      if (!validInfo(info)) { this.relayInfo = null; return; }
      if (info.v !== PROTO || info.gv !== VERSION) { this._fail('VERSION'); return; }
      if (info.st) { this._fail('ALREADY_STARTED'); return; }
      if (info.n >= info.max) { this._fail('ROOM_FULL'); return; }
      if (p2pDead || !info.p2p) this._commitRelay();
      return; // host exists: keep waiting for the data channel (until P2P_TIMEOUT)
    }
    if (this.relay === 'pending') return;
    if (p2pDead) {
      if (this.p2p === 'UNAVAILABLE') this._fail('ROOM_NOT_FOUND');
      else if (this.relay === 'unreachable' || this.answered) this._fail('NETWORK');
      else this._fail('ROOM_NOT_FOUND');
      return;
    }
    // Relay says "nobody home" and P2P signaling hasn't produced an answer either.
    if (this.relay === 'negative' && !this.answered && now() - this.t0 > 4000) this._fail('ROOM_NOT_FOUND');
  }

  _commitRelay() {
    const cfg = netConfig();
    const mq = this.relayMq;
    this.prober.stop(mq);
    this._commit(new RelayClientLink(mq, this.relayUrl, this.code, this.cid, cfg.brokers));
  }

  _commit(link) {
    this.link = link;
    if (link.kind === 'p2p') {
      if (this.prober) this.prober.stop(null);
    } else {
      if (this.p2pLink) this.p2pLink.close();
      if (this.ep) { this.ep.destroy(); this.ep = null; }
    }
    link.onmessage = (obj) => this._onHandshake(obj);
    link.onclose = () => this._fail('NETWORK');
    const hello = JSON.stringify({
      _: 'hello', v: PROTO, gv: VERSION, cid: this.cid,
      name: sanitizeName(this.name, ''), ship: this.ship,
      hid: typeof document !== 'undefined' && document.hidden ? 1 : 0,
    });
    this.helloAt = now();
    link.sendRaw(hello, true);
    if (link.kind === 'relay') this.timers.push(setInterval(() => link.sendRaw(hello, true), 1500));
    this.timers.push(setTimeout(() => this._fail('NETWORK'), 8000));
  }

  _onHandshake(obj) {
    if (this.done || obj === BAD) return;
    if (obj._ === 'welcome') {
      const lobby = normLobby(obj.lobby);
      if (!isInt(obj.slot, 1, MAX_PLAYERS - 1) || !lobby || !isNum(obj.h)) { this._fail('NETWORK'); return; }
      this._cleanup();
      this.done = true;
      if (this.ep) this.ep.disconnectSignaling(); // the data channel is up; free the server slot
      const s = new ClientSession({
        link: this.link, ep: this.ep, code: this.code, cid: this.cid, slot: obj.slot, lobby,
        isPublic: obj.pub === 1, hostNow: obj.h, rtt: now() - this.helloAt, hostHidden: obj.hid === 1,
      });
      this.resolve(s);
    } else if (obj._ === 'err') {
      this._fail(ERR_CODES.includes(obj.e) ? obj.e : 'NETWORK');
    }
  }

  _cleanup() {
    for (const t of this.timers) { clearTimeout(t); clearInterval(t); }
    this.timers = [];
  }

  _fail(code) {
    if (this.done) return;
    this.done = true;
    this._cleanup();
    if (this.prober) this.prober.stop(null);
    if (this.link) { this.link.onclose = null; this.link.close(); }
    if (this.p2pLink && this.p2pLink !== this.link) this.p2pLink.close();
    if (this.ep) this.ep.destroy();
    this.reject(netError(code));
  }
}

// ---------------------------------------------------------------------------
// Hosting

/** Register every public slot id in parallel; keep the lowest free one. */
async function scanPubSlots() {
  const res = await Promise.all(Array.from({ length: PUB_SLOTS }, (_, i) =>
    openEndpoint(pubPeerId(i), 6000).then((ep) => ({ i, ep }), (e) => ({ i, err: e.message }))));
  const free = res.filter((r) => r.ep);
  const taken = res.filter((r) => r.err === 'ID_TAKEN').map((r) => r.i);
  if (!free.length && !taken.length) return null; // signaling unreachable
  for (const r of free.slice(1)) r.ep.destroy();
  return { ep: free.length ? free[0].ep : null, slot: free.length ? free[0].i : -1, taken };
}

async function createHost({ name, ship, isPublic, pubEP = null, pubSlot = -1, tentative = false, p2p = true }) {
  const cfg = netConfig();
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = randomCode();
    const hub = new RelayHub(code, cfg.brokers);
    const relayReady = hub.start();
    let roomEP = null, taken = false;
    if (cfg.p2p && p2p) {
      try { roomEP = await openEndpoint(roomPeerId(code)); } catch (e) { taken = e.message === 'ID_TAKEN'; }
    }
    if (taken) { hub.close(); continue; }
    const relayOk = roomEP
      ? await Promise.race([relayReady, sleep(4000).then(() => hub.up > 0)])
      : await relayReady;
    if (!roomEP && !relayOk) {
      hub.close();
      if (pubEP) pubEP.destroy();
      throw netError('NETWORK');
    }
    return new HostSession({ code, name, ship, isPublic, pubEP, pubSlot, tentative, roomEP, hub });
  }
  if (pubEP) pubEP.destroy();
  throw netError('NETWORK');
}

/** Host a room. Resolves once the room is reachable over P2P and/or the relay. */
export async function hostSession({ name, ship, isPublic = false } = {}) {
  const cfg = netConfig();
  let scan = null;
  if (isPublic && cfg.p2p) scan = await scanPubSlots();
  return createHost({
    name, ship, isPublic: !!isPublic, pubEP: scan ? scan.ep : null, pubSlot: scan ? scan.slot : -1,
    p2p: !isPublic || !!scan,
  });
}

/** Join a room by code (P2P first, relay fallback). */
export async function joinSession(code, { name, ship } = {}) {
  const c = normalizeCode(code);
  if (!c) throw netError('ROOM_NOT_FOUND');
  return new Joiner(c, { name, ship }).run();
}

// ---------------------------------------------------------------------------
// Quick match
//
// 1. Register the public slot ids nvl1-pub-0..11 in parallel (fast "taken or free" scan);
//    keep the lowest free id and open a *tentative* public room on it right away, so
//    concurrent seekers can find us.
// 2. Discover for ~2.6 s: probe every taken slot over P2P and listen to relay lobby
//    announcements (covers rooms whose host has no PeerJS, or when signaling is down).
// 3. Join the best open room: established rooms first, then fuller, then lower slot, then
//    code. Two tentative seekers break the tie deterministically: the "larger" one yields.
//    Otherwise stay as the host.

const keyOf = (i) => [i.tent ? 1 : 0, -i.n, i.slot >= 0 ? i.slot : 99, i.code];
function cmpKey(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

function probeSlot(ep, i) {
  const { done } = ep.connect(pubPeerId(i), 3500);
  return done.then((link) => new Promise((resolve) => {
    const timer = setTimeout(() => { link.close(); resolve(null); }, 2000);
    link.onmessage = (m) => {
      if (m && m._ === 'info' && validInfo(m)) {
        clearTimeout(timer);
        link.onmessage = null;
        link.onclose = null;
        resolve({ info: m, link });
      }
    };
    link.onclose = () => { clearTimeout(timer); resolve(null); };
    link.sendRaw('{"_":"probe"}', true);
  }), () => null);
}

async function quickAttempt(name, ship, last) {
  const cfg = netConfig();
  const useP2P = cfg.p2p && !cfg.forceRelay;
  let scan = null, seekEP = null;
  if (useP2P) {
    [scan, seekEP] = await Promise.all([scanPubSlots(), openEndpoint(null).catch(() => null)]);
  }
  let host;
  try {
    host = await createHost({
      name, ship, isPublic: true, pubEP: scan ? scan.ep : null, pubSlot: scan ? scan.slot : -1, tentative: !last,
      p2p: !useP2P || !!scan, // the slot scan already showed signaling is down: go relay-only
    });
  } catch (e) {
    if (seekEP) seekEP.destroy();
    throw e;
  }
  if (last) { if (seekEP) seekEP.destroy(); return host; }

  const selfKey = keyOf({ tent: 1, n: 1, slot: host.pubSlot, code: host.code });
  const cands = new Map();
  let decided = false;
  let wake;
  const early = new Promise((r) => { wake = r; });
  const consider = (info, link) => {
    if (decided || !validInfo(info) || info.code === host.code || !joinableInfo(info) || !info.pub) {
      if (link) link.close();
      return;
    }
    const prev = cands.get(info.code);
    if (link) {
      if (prev && prev.link) prev.link.close();
      cands.set(info.code, { info, link });
      if (!info.tent) wake(); // an established room answered over P2P: take it now
    } else if (prev) {
      prev.info = info;
    } else {
      cands.set(info.code, { info, link: null });
    }
  };
  if (host.hub) host.hub.listenLobby((a) => { if (a._ === 'ann') consider(a, null); });
  const probes = seekEP && scan ? scan.taken.map((i) => probeSlot(seekEP, i).then((r) => { if (r) consider(r.info, r.link); })) : [];
  await Promise.race([early, Promise.all([sleep(2600), Promise.all(probes)])]);
  decided = true;
  if (host.hub) host.hub.stopLobby();

  const closeCands = (except) => { for (const c of cands.values()) if (c !== except && c.link) c.link.close(); };
  if (host.closed) { closeCands(null); if (seekEP) seekEP.destroy(); return null; }
  let best = null;
  if (host._count() === 1) {
    for (const c of cands.values()) {
      const k = keyOf(c.info);
      if (c.info.tent && cmpKey(k, selfKey) >= 0) continue; // they yield to us
      if (!best || cmpKey(k, keyOf(best.info)) < 0 || (cmpKey(k, keyOf(best.info)) === 0 && c.link && !best.link)) best = c;
    }
  }
  if (!best) {
    closeCands(null);
    if (seekEP) seekEP.destroy();
    host._settle();
    return host;
  }
  closeCands(best);
  host._shutdown('LEFT', true, false); // abandon our tentative room silently
  try {
    if (best.link && seekEP) return await new Joiner(best.info.code, { name, ship }, { link: best.link, ep: seekEP }).run();
    if (seekEP) seekEP.destroy();
    return await joinSession(best.info.code, { name, ship });
  } catch (e) {
    if (ERR_CODES.includes(e.message) && e.message !== 'VERSION') return null; // try again
    throw e;
  }
}

/** Join an open public room, or host one and wait. */
export async function quickMatch({ name, ship } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const s = await quickAttempt(name, ship, attempt === 2);
    if (s) return s;
  }
  throw netError('NETWORK');
}

// ---------------------------------------------------------------------------
// Invite links

// Test-server overrides are carried into invites made off milgie.com, so a second device
// opening the link talks to the same (local) signaling server / brokers.
const CARRY_PARAMS = ['peerhost', 'peerport', 'peerpath', 'peersecure', 'peerkey', 'mqtt', 'ice', 'p2p'];

export function makeInviteUrl(code) {
  const c = normalizeCode(code) || '';
  try {
    if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol) &&
        !/(^|\.)milgie\.com$/i.test(location.hostname)) {
      const url = new URL('../../', import.meta.url); // game root on this deployment
      const cur = new URLSearchParams(location.search);
      url.search = '';
      for (const k of CARRY_PARAMS) if (cur.has(k)) url.searchParams.set(k, cur.get(k));
      url.searchParams.set('room', c);
      return url.href;
    }
  } catch { /* fall through to the canonical link */ }
  return `${INVITE_BASE}?room=${encodeURIComponent(c)}`;
}

export function parseRoomFromUrl() {
  try {
    const q = new URLSearchParams(location.search);
    const v = q.get('room') || q.get('r') || (location.hash.match(/room=([^&]+)/) || [])[1];
    return v ? normalizeCode(decodeURIComponent(v)) : null;
  } catch {
    return null;
  }
}
