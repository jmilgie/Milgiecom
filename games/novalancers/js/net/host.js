// Nova Lancers — host side of a session (the hub of the star topology).
//
// The host listens on PeerJS (P2P) and on the MQTT relay at the same time; each client is
// a "link" of either kind. Per player it keeps a 32-byte key K (random for P2P joiners —
// delivered inside the encrypted welcome — or agreed with ECDH for relay joiners), used to
// authenticate relay envelopes and to prove who is asking when a player moves to another
// link: relay -> P2P upgrade in the lobby, or a rescue after its link died (network change).

import {
  PROTO, VERSION, MAX_PLAYERS, PUB_SLOTS, LOST_MS, LOST_HIDDEN_MS, LOBBY_HIDDEN_MS, STALE_MS,
  RESCUE_GRACE, P2P_HOLD_MS, CID_RE, BAD, Bucket, sanitizeName, sanitizeShip, isObj, isInt, isNum,
  encodeMsg, now, SHIP_ORDER, pubPeerId,
} from './common.js';
import { Session } from './base.js';
import { LinkAuth, rebindProof, sameTag, ecdhMaster, randomBytes, b64u } from './auth.js';
import { openEndpoint } from './p2p.js';

const PENDING_TTL = { p2p: 15000, relay: 5000 };   // an unadmitted link may linger this long
const MAX_PENDING = { p2p: 16, relay: 8 };          // separate budgets: one can't starve the other
const RETIRE_MS = 2000;       // a superseded link still delivers its stragglers this long
const DEPARTED_TTL = 60000;   // dropped players are remembered (stray kicks, refused rebinds)
const MAX_EPOCH_STEP = 1000;

/**
 * Find the lowest free public slot id by registering it (fast: the signaling server answers
 * "taken" immediately). Scans in small batches from slot 0 and stops at the first free one.
 * Returns { ep, slot, taken } (ep null when all are taken) or null when signaling is down.
 */
export async function scanPubSlots() {
  const taken = [];
  let keep = null, reachable = false;
  for (let base = 0; base < PUB_SLOTS && !keep; base += 3) {
    const ids = [base, base + 1, base + 2].filter((i) => i < PUB_SLOTS);
    const res = await Promise.all(ids.map((i) =>
      openEndpoint(pubPeerId(i), 6000).then((ep) => ({ i, ep }), (e) => ({ i, err: e.message }))));
    for (const r of res) {
      if (r.ep) {
        reachable = true;
        if (!keep) keep = r; else r.ep.destroy();
      } else if (r.err === 'ID_TAKEN') {
        reachable = true;
        taken.push(r.i);
      }
    }
    if (!reachable) return null;
  }
  return { ep: keep ? keep.ep : null, slot: keep ? keep.i : -1, taken };
}

export class HostSession extends Session {
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
    this.ecdh = o.ecdh || null;   // { priv, pub } host ECDH key for relay joiners
    this.players = [{
      slot: 0, name: sanitizeName(o.name, 'PILOT 1'), ship: sanitizeShip(o.ship), ready: true,
      connected: true, ping: 0, transport: 'host', link: null,
    }];
    for (let i = 1; i < MAX_PLAYERS; i++) this.players.push(null);
    this.pending = new Set();
    this.departed = new Map();   // cid -> { K, auth, at, kickAt, reason }
    this.hidden = typeof document !== 'undefined' && document.hidden;
    this.rev = 0;                // lobby revision (clients ignore older snapshots)
    this.startMsg = null;        // resent to a player that comes back mid-game
    this._dirtyQueued = false;
    this._pingsAt = 0;
    this._annAt = 0;
    this._pubTryAt = now();
    this._pubBusy = false;
    this._lobbyPings = [];
    this.probeBucket = new Bucket(5, 10);   // relay probe answers + stray kicks (global)
    this.helloBucket = new Bucket(20, 20);  // new relay links (each costs an ECDH derivation)
    for (const ep of [this.roomEP, this.pubEP]) if (ep) this._attachEndpoint(ep);
    if (this.hub) {
      this.hub.onhello = (link) => this._onNewLink(link);
      this.hub.onprobe = (cid, b) => this._onRelayProbe(cid, b);
      this.hub.onstray = (cid, b) => this._onRelayStray(cid, b);
    }
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
    this.startMsg = str;
    this._broadcastRaw(str, true);
    this._releasePub(); // a running game doesn't need to be discoverable
    this.lobby = this._buildLobby();
    this._dirty();
    this._emit('start', payload);
    return true;
  }

  /** Extra (not in §9): reopen the lobby after a game (clears ready flags). */
  endGame() {
    if (this.closed || !this.started) return;
    this.started = false;
    this.startMsg = null;
    this._pubTryAt = -1e9; // re-register a public slot id right away
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

  // ---- links ----

  _attachEndpoint(ep) {
    ep.onconnection = (link) => this._onNewLink(link);
    let delay = 1000;
    ep.onopen = () => { delay = 1000; }; // re-registered: the next drop starts a fresh backoff
    ep.ondisconnected = () => {
      // Signaling socket dropped: existing data channels live on; re-register for new joins.
      if (this.closed) return;
      setTimeout(() => { if (!this.closed) ep.reconnect(); }, delay);
      delay = Math.min(delay * 2, 30000);
    };
  }

  _onNewLink(link) {
    if (this.closed) { link.close(); return; }
    const kind = link.kind;
    if (kind === 'relay' && !this.helloBucket.take()) { link.close(); return; }
    let n = 0, oldest = null;
    for (const l of this.pending) {
      if (l.kind !== kind) continue;
      n++;
      if (!l.verifying && (!oldest || l.born < oldest.born)) oldest = l;
    }
    if (n >= MAX_PENDING[kind]) {
      // Evict the oldest half-open link rather than refusing everyone new (a flood of fake
      // joiners can't lock the room); a very fresh table means a burst: refuse this one.
      if (!oldest || now() - oldest.born < 3000) { link.close(); return; }
      this._dropPending(oldest);
    }
    link.slot = null;
    link.born = now();
    link.strikes = 0;
    link.bucket = new Bucket(120, 360);
    link.onmessage = (obj) => this._onLinkMsg(link, obj);
    link.onclose = () => this._onLinkClose(link);
    this.pending.add(link);
  }

  _dropPending(link) {
    this.pending.delete(link);
    link.onclose = null;
    link.onmessage = null;
    link.close();
  }

  _onLinkClose(link) {
    this.pending.delete(link);
    if (link.slot == null) return;
    const p = this.players[link.slot];
    if (!p || p.link !== link) return;
    if (!p.K) { this._removePlayer(link.slot, 'left'); return; }
    // Closed without a goodbye: the player's network may be changing. Hold the slot (it
    // shows as not connected) while it tries to come back over the relay; the regular
    // silence timeout removes it otherwise.
    p.lastSeen = Math.min(p.lastSeen, now() - STALE_MS);
    if (p.connected) { p.connected = false; this._dirty(); }
  }

  _dropLink(link) {
    if (link.slot != null) { this.kick(link.slot); return; }
    this._dropPending(link);
  }

  _onLinkMsg(link, obj) {
    if (this.closed) return;
    if (!link.bucket.take()) {
      if (link.bucket.drops > 1500) this._dropLink(link);
      return;
    }
    if (obj === BAD) {
      if (++link.strikes > 40) this._dropLink(link);
      return;
    }
    const type = obj._;
    if (type !== undefined && typeof type !== 'string') return;
    if (link.slot == null) {
      if (type === 'probe' && link.kind === 'p2p') link.sendRaw(this._infoStr(false), true);
      else if (type === 'hello') this._hello(link, obj);
      return;
    }
    const p = this.players[link.slot];
    if (!p || p.link !== link) return;
    this._fromPlayer(p, link, obj, type, false);
  }

  _fromPlayer(p, link, obj, type, retired) {
    p.lastSeen = now();
    if (!p.connected) { p.connected = true; this._dirty(); }
    if (type === undefined) { this._emit('message', obj, p.slot); return; }
    switch (type) {
      case 'ping':
        if (retired) break;
        if (isNum(obj.t)) link.sendRaw(JSON.stringify({ _: 'pong', t: obj.t, h: now() }), true);
        if (isNum(obj.r) && obj.r >= 0) p.ping = Math.min(9999, Math.round(obj.r));
        break;
      case 'info': this._applyInfo(p, obj); break;
      case 'vis': p.hidden = obj.h === 1; break;
      case 'bye': this._removePlayer(p.slot, 'left'); break;
      case 'hello': if (!retired && obj.cid === p.cid) this._welcome(p); break; // resent hello (relay): idempotent
      default: break; // unknown internal type: ignore
    }
  }

  /** A superseded link keeps delivering the player's stragglers briefly, then closes. */
  _retire(old, p) {
    old.slot = null;
    old.onclose = null;
    old.bound = false;
    if (old.closed) return;
    old.onmessage = (obj) => {
      if (this.closed || this.players[p.slot] !== p || obj === BAD || !old.bucket.take()) return;
      const type = obj._;
      if (type !== undefined && typeof type !== 'string') return;
      if (type === 'hello' || type === 'probe') return;
      this._fromPlayer(p, old, obj, type, true);
    };
    setTimeout(() => { old.onmessage = null; old.close(); }, RETIRE_MS);
  }

  // ---- handshake ----

  _byCid(cid) {
    for (let i = 1; i < MAX_PLAYERS; i++) if (this.players[i] && this.players[i].cid === cid) return this.players[i];
    return null;
  }

  /** Hello on any link. Relay links first agree on / look up keys and check the envelope. */
  async _hello(link, m) {
    if (this.closed || link.verifying) return;
    if (typeof m.cid !== 'string' || !CID_RE.test(m.cid)) { link.strikes += 5; return; }
    if (link.kind === 'relay' && link.first) {
      if (m.cid !== link.cid) { this._dropPending(link); return; }
      let K = null;
      let epoch = 0;
      if (m.re !== undefined) {
        // Rebind over the relay (rescue): the envelope must be tagged with the player's key.
        const known = this._byCid(m.cid) || this.departed.get(m.cid);
        if (!known || !known.K || !isInt(m.re, 1, 2 ** 40)) { link.first = null; this._reject(link, 'GONE'); return; }
        K = known.K;
        epoch = m.re;
      } else if (typeof m.pk === 'string' && this.ecdh) {
        link.verifying = true;
        K = await ecdhMaster(this.ecdh.priv, m.pk, m.cid);
        link.verifying = false;
        if (this.closed || link.closed) return;
        if (!K) { this._dropPending(link); return; }
      }
      if (K) {
        if (!link.adopt(new LinkAuth(K, epoch))) { this._dropPending(link); return; }
        link.K = K;
      } else {
        link.first = null; // unauthenticated relay client (no WebCrypto on one side)
      }
    }
    this._onHello(link, m);
  }

  _onHello(link, m) {
    if (m.v !== PROTO || m.gv !== VERSION) { this._reject(link, 'VERSION'); return; }
    const p = this._byCid(m.cid);
    if (p) {
      if (p.link === link) { this._welcome(p); return; } // retransmitted hello
      const err = this._rebind(p, link, m);
      if (err) this._reject(link, err);
      return;
    }
    if (m.re !== undefined) { this._reject(link, 'GONE'); return; } // rebind for a player we dropped
    if (this.started) { this._reject(link, 'ALREADY_STARTED'); return; }
    let slot = -1;
    for (let i = 1; i < MAX_PLAYERS; i++) if (!this.players[i]) { slot = i; break; }
    if (slot < 0) { this._reject(link, 'ROOM_FULL'); return; }
    const np = {
      slot, cid: m.cid, name: sanitizeName(m.name, `PILOT ${slot + 1}`), ship: sanitizeShip(m.ship),
      ready: false, connected: true, ping: 0, transport: link.kind, link, lastSeen: now(),
      hidden: m.hid === 1, rescueUntil: 0, epoch: 0,
      K: link.kind === 'p2p' ? randomBytes(32) : (link.K || null),
    };
    this.players[slot] = np;
    this.departed.delete(m.cid);
    this._bind(link, np);
    this.lobby = this._buildLobby();
    this._welcome(np);
    this._emit('peerjoin', slot, this._pubInfo(np));
    this._emit('transport', { slot, kind: link.kind });
    this._dirty();
    if (this._count() >= MAX_PLAYERS) this._releasePub();
  }

  _bind(link, p) {
    this.pending.delete(link);
    link.slot = p.slot;
    link.bound = true;
    link.bucket = new Bucket(300, 900);
  }

  /**
   * The same player on another link. Returns null when accepted, an error code to send
   * back, or '' to ignore silently (bad proof).
   */
  _rebind(p, link, m) {
    if (!p.K || !isInt(m.re, p.epoch + 1, p.epoch + MAX_EPOCH_STEP) || !sameTag(m.pr, rebindProof(p.K, p.cid, m.re))) {
      link.strikes += 5;
      return '';
    }
    if (link.kind === 'relay' && (!link.auth || link.auth.epoch !== m.re)) return '';
    if (m.up === 1) {
      // Relay -> P2P upgrade (lobby only): once the game runs, the transport stays put. The
      // host decides: a client that already sent its upgrade hello waits for this answer.
      if (link.kind !== 'p2p') return '';
      if (this.started) return 'ALREADY_STARTED';
    } else if (m.f !== 1 && !p.link.closed && now() - p.lastSeen < 1000) {
      return 'LINK_OK'; // a rescue while its link demonstrably works (we stalled?): stay, unless it insists
    }
    p.epoch = m.re;
    this._retire(p.link, p);
    this._bind(link, p);
    p.link = link;
    p.transport = link.kind;
    p.lastSeen = now();
    p.rescueUntil = 0;
    p.connected = true;
    this._emit('transport', { slot: p.slot, kind: link.kind });
    this.lobby = this._buildLobby();
    this._welcome(p);
    if (this.started && this.startMsg) link.sendRaw(this.startMsg, true); // it may have missed it
    this._dirty();
    return null;
  }

  _welcome(p) {
    const m = {
      _: 'welcome', slot: p.slot, code: this.code, pub: this.isPublic ? 1 : 0,
      lobby: this.lobby, r: this.rev, h: now(), hid: this.hidden ? 1 : 0,
    };
    if (p.link.kind === 'p2p' && p.K) m.k = b64u(p.K); // the data channel is encrypted (DTLS)
    p.link.sendRaw(JSON.stringify(m), true);
  }

  _reject(link, code) {
    if (link.rejected || link.slot != null) return; // never on a player's live link
    link.rejected = true;
    link.sendRaw(JSON.stringify({ _: 'err', e: code }), true);
    setTimeout(() => { this.pending.delete(link); link.close(true); }, 600);
  }

  // ---- relay traffic from cids without a link ----

  _onRelayProbe(cid, b) {
    if (this.closed || !this.probeBucket.take()) return;
    const p = this._byCid(cid);
    // It is trying to come back over the relay: hold its slot a little longer (bounded, so
    // probes alone can't keep a dead player's slot forever).
    if (p) p.rescueUntil = Math.min(now() + RESCUE_GRACE, p.lastSeen + P2P_HOLD_MS + RESCUE_GRACE);
    this.hub.sendDirect(cid, b, [this._infoStr(true)]);
  }

  _onRelayStray(cid, b) {
    // A player we dropped (e.g. timed out while its phone slept) still talks to us:
    // tell it, authenticated with its old keys, so it doesn't linger in a dead game.
    const d = this.departed.get(cid);
    const t = now();
    if (!d || !d.auth || t - d.kickAt < 2000 || !this.probeBucket.take()) return;
    d.kickAt = t;
    this.hub.sendDirect(cid, b, [d.reason === 'kicked' ? '{"_":"kick"}' : '{"_":"kick","r":"timeout"}'], d.auth);
  }

  // ---- lobby ----

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
    // A client we time out may just be frozen (background tab): tell it why once it wakes.
    if (reason === 'timeout') link.sendRaw('{"_":"kick","r":"timeout"}', true);
    if (reason !== 'left' && p.K) {
      if (this.departed.size >= 16) this.departed.delete(this.departed.keys().next().value);
      this.departed.set(p.cid, { K: p.K, auth: link.kind === 'relay' ? link.auth : null, at: now(), kickAt: now(), reason });
    }
    link.slot = null;
    link.onclose = null;
    link.onmessage = null;
    link.close(true);
    this._emit('peerleave', slot, { ...this._pubInfo(p), reason });
    this._dirty();
  }

  _pubInfo(p) {
    return { slot: p.slot, name: p.name, ship: p.ship, ready: p.ready, connected: p.connected, ping: p.ping, transport: p.transport };
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
      this.rev++;
      this._lobbyPings = this.players.map((p) => (p ? p.ping : -1));
      this._broadcastRaw(JSON.stringify({ _: 'lobby', l: this.lobby, r: this.rev }), false);
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

  _infoStr(withKey) {
    const o = { _: 'info', ...this._info() };
    if (withKey && this.ecdh) o.hpk = this.ecdh.pub;
    return JSON.stringify(o);
  }

  _announce() {
    if (!this.hub || !this.isPublic || this.started || this.closed) return;
    if (this._count() >= MAX_PLAYERS) return;
    this._annAt = now();
    this.hub.announce(JSON.stringify({ _: 'ann', ...this._info() }));
  }

  // Public slot ids are only held while the room is joinable, so running or full games
  // don't make every quick-matcher probe them.
  _releasePub() {
    const ep = this.pubEP;
    if (!ep) return;
    this.pubEP = null;
    ep.onconnection = ep.ondisconnected = ep.onopen = null;
    ep.destroy();
  }

  async _reacquirePub() {
    this._pubTryAt = now();
    this._pubBusy = true;
    let ep = null, slot = -1;
    try {
      if (this.pubSlot >= 0) {
        ep = await openEndpoint(pubPeerId(this.pubSlot), 6000).catch(() => null);
        slot = this.pubSlot;
      }
      if (!ep) {
        const scan = await scanPubSlots();
        if (scan && scan.ep) { ep = scan.ep; slot = scan.slot; }
      }
    } finally {
      this._pubBusy = false;
    }
    if (!ep) return;
    if (this.closed || this.started || this.pubEP || this._count() >= MAX_PLAYERS) { ep.destroy(); return; }
    this.pubEP = ep;
    this.pubSlot = slot;
    this._attachEndpoint(ep);
    this._announce();
  }

  _update(t) {
    const suspect = this.hub && t - this.hub.troubleAt < 10000; // our own network just hiccuped
    let stale = false;
    for (let i = 1; i < MAX_PLAYERS; i++) {
      const p = this.players[i];
      if (!p) continue;
      const silence = t - p.lastSeen;
      let limit = p.hidden ? (this.started ? LOST_HIDDEN_MS : LOBBY_HIDDEN_MS)
        : (p.K && p.link.kind === 'p2p' ? P2P_HOLD_MS : LOST_MS);
      if (suspect) limit = Math.max(limit, LOST_HIDDEN_MS);
      if (silence > limit && t > p.rescueUntil) { this._removePlayer(i, 'timeout'); continue; }
      if (silence > STALE_MS) {
        stale = true;
        if (p.connected) { p.connected = false; this._dirty(); }
      }
    }
    // A silent player may be our own fault: make sure our broker connections are alive, so
    // it can reach us over the relay (checks are throttled inside the hub).
    if (stale && this.hub) this.hub.check();
    for (const link of Array.from(this.pending)) {
      if (t - link.born > PENDING_TTL[link.kind] && !link.verifying) this._dropPending(link);
    }
    for (const [cid, d] of this.departed) if (t - d.at > DEPARTED_TTL) this.departed.delete(cid);
    if (t - this._pingsAt >= 2000) {
      this._pingsAt = t;
      if (this.started) {
        const arr = this.players.map((p) => (p ? p.ping : null));
        if (arr.some((v, i) => i > 0 && v !== null)) this._broadcastRaw(JSON.stringify({ _: 'pings', p: arr }), false);
      } else if (this.players.some((p, i) => p && Math.abs(p.ping - (this._lobbyPings[i] ?? -1)) >= Math.max(8, p.ping * 0.25))) {
        this._dirty(); // lobby shows pings: refresh when one moved noticeably
      }
    }
    if (t - this._annAt >= 2000) this._announce();
    if (this.isPublic && !this.pubEP && !this._pubBusy && !this.started && !this.tentative &&
        this._count() < MAX_PLAYERS && this.roomEP && this.roomEP.signaling && t - this._pubTryAt > 15000) {
      this._reacquirePub();
    }
    if (this.hub) this.hub.maintain(t);
  }

  _frozen(gap) {
    for (let i = 1; i < MAX_PLAYERS; i++) {
      const p = this.players[i];
      if (p) { p.lastSeen += gap; if (p.rescueUntil) p.rescueUntil += gap; }
    }
  }

  _onVisibility(hidden) {
    if (this.closed) return;
    this.hidden = hidden;
    this._broadcastRaw(JSON.stringify({ _: 'vis', h: hidden ? 1 : 0 }), true);
    if (!hidden && this.hub) this.hub.check();
  }

  _netChanged() {
    if (!this.closed && this.hub) this.hub.check();
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
    // Joiners mid-handshake learn right away that the room is gone.
    for (const link of this.pending) {
      link.onclose = null;
      link.onmessage = null;
      if (!link.rejected) link.sendRaw('{"_":"err","e":"ROOM_NOT_FOUND"}', true);
      link.close(true);
    }
    this.pending.clear();
    if (this.hub) this.hub.close();
    const eps = [this.roomEP, this.pubEP].filter(Boolean);
    for (const ep of eps) { ep.onconnection = null; ep.ondisconnected = null; ep.onopen = null; }
    if (graceful) setTimeout(() => { for (const ep of eps) ep.destroy(); }, 700);
    else for (const ep of eps) ep.destroy();
  }
}
