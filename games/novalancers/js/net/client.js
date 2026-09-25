// Nova Lancers — client side of a session, and the join procedure.
//
// Liveness is judged by the host's answers to our 1 s pings (pongs), not by broadcast
// traffic: a client the host no longer counts as a player gets no pongs even while other
// players' game broadcasts keep flowing.
//
// Link rescue: when the host goes quiet (or the P2P channel closes without a goodbye) the
// client doesn't give up at once. A relay link re-checks its broker and fails over to the
// next one; a P2P client looks for the host on the relay and re-binds its slot there
// (proving its identity with the per-player key), keeping the game running across a
// Wi-Fi <-> cellular switch.

import {
  PROTO, VERSION, MAX_PLAYERS, HEARTBEAT_MS, LOST_HIDDEN_MS, LOBBY_HIDDEN_MS, STALE_MS,
  RESCUE_MAX, BAD, Bucket, netConfig, randomId, roomPeerId, sanitizeName, sanitizeShip, isObj,
  isInt, isNum, encodeMsg, now, netError, SHIP_ORDER, validInfo,
} from './common.js';
import { Session, normLobby } from './base.js';
import { LinkAuth, rebindProof, hasECDH, ecdhKeyPair, ecdhMaster, unb64u } from './auth.js';
import { openEndpoint } from './p2p.js';
import { RelayProber, RelayClientLink } from './relay.js';

export const ERR_CODES = ['ROOM_NOT_FOUND', 'ROOM_FULL', 'ALREADY_STARTED', 'NETWORK', 'VERSION'];
const UPGRADE_WINDOW = 30000;   // a slow P2P attempt may still replace the relay (lobby only)
const EP_SLOW = 4000;           // PeerJS signaling not even registered by then: probe the relay too
const ANSWER_SLOW = 2000;       // offer sent, no answer from the host yet: probe the relay too
const ICE_SLOW = 2500;          // answered, but the channel isn't open yet (strict NAT?): same
const RESCUE_COOLDOWN = 3000;

// ---------------------------------------------------------------------------

export class ClientSession extends Session {
  constructor(o) {
    super(false);
    this.link = o.link;
    this.ep = o.ep || null;
    this.code = o.code;
    this.cid = o.cid;
    this.K = o.K || null;          // per-player key shared with the host (null: unauthenticated relay)
    this.epoch = 0;
    this.nextEpoch = 1;
    this.isPublic = !!o.isPublic;
    this.selfSlot = o.slot;
    this.lobby = o.lobby;
    this.rev = isInt(o.rev, 0, 2 ** 52) ? o.rev : -1;
    this.started = o.lobby.started;
    this._gotStart = false;
    this.rtt = Math.max(0, o.rtt);
    this.offset = o.hostNow + this.rtt / 2 - now();
    this.samples = [];
    this.lastPong = now();
    this.hostHidden = o.hostHidden;
    this.pings = 0;
    this.nextPing = now() + 120;
    this.bucket = new Bucket(1000, 3000);
    this.ship = o.ship;
    this._upgrade = null;
    this._rescue = null;
    this._rescueAfter = 0;
    this._wire(this.link);
    setTimeout(() => {
      if (this.closed) return;
      this._emit('transport', { slot: this.selfSlot, kind: this.link.kind });
      if (typeof document !== 'undefined' && document.hidden) this._onVisibility(true);
    }, 0);
    if (o.upgrade) this._tryUpgrade(o.upgrade);
  }

  _wire(link) {
    link.onmessage = (obj) => { if (link === this.link) this._onMsg(obj); };
    link.onclose = () => { if (link === this.link) this._onLinkLost(); };
  }

  _onLinkLost() {
    if (this.closed) return;
    // A P2P channel closing without a goodbye: the host's tab may be gone — or our network
    // changed. Look for the host on the relay before giving up.
    if (this.link.kind === 'p2p' && this.K) { this._startRescue(true); return; }
    this._shutdown(this.link.kind === 'p2p' ? 'HOST_LEFT' : 'NETWORK', false, true);
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

  // ---- inbound ----

  _onMsg(obj) {
    if (this.closed || !this.bucket.take() || obj === BAD) return;
    const type = obj._;
    if (type === undefined) { this._emit('message', obj, 0); return; }
    switch (type) {
      case 'pong': this._onPong(obj); break;
      case 'lobby': this._onLobby(obj.l, obj.r); break;
      case 'start': this._onStart(obj.p); break;
      case 'pings':
        if (Array.isArray(obj.p) && obj.p.length <= MAX_PLAYERS) {
          // The host lists every slot; null for ours means it no longer counts us as a player.
          if (obj.p[this.selfSlot] === null) { this._shutdown('NETWORK', false, true); return; }
          for (const p of this.lobby.players) {
            const v = obj.p[p.slot];
            if (isNum(v)) p.ping = Math.max(0, Math.min(9999, Math.round(v)));
          }
        }
        break;
      case 'vis': this.hostHidden = obj.h === 1; break;
      case 'bye': this._shutdown('HOST_LEFT', false, true); break;
      case 'kick': this._shutdown(obj.r === 'timeout' ? 'NETWORK' : 'KICKED', false, true); break;
      default: break; // duplicate welcome, unknown internal type: ignore
    }
  }

  _onStart(payload) {
    if (this._gotStart) return; // resent after a link rescue: already running
    this._gotStart = true;
    this.started = true;
    if (this._upgrade && !this._upgrade.sent) this._dropUpgrade(); // keep the transport stable once the game runs
    this.lobby = { ...this.lobby, started: true };
    this._emit('start', payload);
  }

  _onLobby(l, r) {
    if (isInt(r, 0, 2 ** 52)) {
      if (r <= this.rev) return; // an older snapshot (e.g. a straggler from a retired link)
      this.rev = r;
    }
    const lobby = normLobby(l);
    if (!lobby) return;
    const before = new Map(this.lobby.players.map((p) => [p.slot, p]));
    const after = new Map(lobby.players.map((p) => [p.slot, p]));
    this.lobby = lobby;
    this.started = lobby.started;
    if (!lobby.started) this._gotStart = false; // the host reopened the lobby (endGame)
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
    this.lastPong = t;
    if (this._rescue && !this._rescue.sent) this._endRescue(); // our link came back by itself
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

  // ---- liveness & rescue ----

  _update(t) {
    if (t >= this.nextPing) {
      this.pings++;
      this.nextPing = t + (this.pings < 6 ? 200 : HEARTBEAT_MS);
      this._sendPing();
    }
    const r = this._rescue;
    if (r) {
      if (t > r.deadline) this._shutdown(r.fail, false, true);
      return;
    }
    const quiet = t - this.lastPong;
    if (this.hostHidden) {
      // The host said its page went to the background (phones throttle / freeze it).
      if (quiet > (this.started ? LOST_HIDDEN_MS : LOBBY_HIDDEN_MS)) this._shutdown('NETWORK', false, true);
    } else if (quiet > STALE_MS && t >= this._rescueAfter) {
      this._startRescue(false);
    }
  }

  _startRescue(linkClosed) {
    if (this._rescue || this.closed) return;
    const t = now();
    const r = (this._rescue = { t0: t, deadline: t + RESCUE_MAX, fail: 'NETWORK', prober: null, link: null, sent: false, timers: [] });
    if (this.link.kind === 'relay') { this.link.recover(); return; }
    if (!this.K) { if (linkClosed) this._shutdown('HOST_LEFT', false, true); return; }
    r.prober = new RelayProber(this.code, this.cid, netConfig().brokers,
      (info, mq, url) => this._rescueFound(r, mq, url),
      (state) => {
        if (this._rescue !== r) return;
        // Brokers answer but the host isn't there, and our channel to it is closed: gone.
        if (state === 'negative' && this.link.closed) this._shutdown('HOST_LEFT', false, true);
        else if (state === 'unreachable' && this.link.closed) this._shutdown('NETWORK', false, true);
      }, true);
    r.prober.start();
  }

  _rescueFound(r, mq, url) {
    if (this._rescue !== r || this.closed) { mq.close(); return; }
    r.prober.stop(mq);
    r.prober = null;
    if (!this.link.closed && this.lastPong > r.t0) { mq.close(); this._endRescue(); return; }
    const epoch = this.nextEpoch++;
    const link = new RelayClientLink(mq, url, this.code, this.cid, netConfig().brokers, new LinkAuth(this.K, epoch));
    r.link = link;
    link.onmessage = (obj) => {
      if (this._rescue !== r) return;
      if (obj._ === 'welcome' && obj.slot === this.selfSlot) this._rescued(r, link, epoch, obj);
      else if (obj._ === 'err') {
        if (obj.e === 'LINK_OK') this._endRescue(); // the host still hears us fine: stay
        else this._shutdown('NETWORK', false, true); // it dropped us already
      }
    };
    link.onclose = () => { if (this._rescue === r) this._endRescue(); };
    const hello = JSON.stringify({
      _: 'hello', v: PROTO, gv: VERSION, cid: this.cid, re: epoch, pr: rebindProof(this.K, this.cid, epoch),
      hid: typeof document !== 'undefined' && document.hidden ? 1 : 0,
    });
    r.sent = true;
    link.sendRaw(hello, true);
    r.timers.push(setInterval(() => link.sendRaw(hello, true), 1500));
  }

  _rescued(r, link, epoch, welcome) {
    for (const tm of r.timers) clearInterval(tm);
    this._rescue = null;
    const old = this.link;
    this.epoch = epoch;
    this.link = link;
    this._wire(link);
    old.onclose = null;
    old.onmessage = null;
    old.close();
    if (this.ep) { this.ep.destroy(); this.ep = null; }
    this.lastPong = now();
    this.nextPing = 0;
    this._onLobby(welcome.lobby, welcome.r);
    if (!this.closed) this._emit('transport', { slot: this.selfSlot, kind: link.kind });
  }

  _endRescue() {
    const r = this._rescue;
    if (!r) return;
    this._rescue = null;
    this._rescueAfter = now() + RESCUE_COOLDOWN;
    for (const tm of r.timers) clearInterval(tm);
    if (r.prober) r.prober.stop(null);
    if (r.link) { r.link.onmessage = null; r.link.onclose = null; r.link.close(); }
  }

  // ---- relay -> P2P upgrade (lobby only) ----

  // A client that fell back to the relay only because P2P was slow keeps trying P2P. When the
  // channel opens it re-hellos there (same cid, next epoch, proof under K); the host rebinds
  // the slot and answers with a welcome on that link — or refuses once the game has started.
  // Once our hello is out, the host's answer decides (never 'start' racing it).
  _tryUpgrade({ promise, cancel }) {
    const up = (this._upgrade = { cancel, ep: null, link: null, sent: false, re: 0, timer: 0 });
    promise.then(({ ep, link }) => {
      if (this._upgrade !== up) { link.close(); ep.destroy(); return; }
      up.ep = ep;
      up.link = link;
      if (this.closed || this.started || !this.K || this._rescue) { this._dropUpgrade(); return; }
      up.re = this.nextEpoch++;
      link.onclose = () => { if (this._upgrade === up) this._dropUpgrade(); };
      link.onmessage = (obj) => {
        if (obj._ === 'welcome' && obj.slot === this.selfSlot) this._switchTo(up, obj);
        else if (obj._ === 'err') this._dropUpgrade();
      };
      up.sent = true;
      link.sendRaw(JSON.stringify({
        _: 'hello', v: PROTO, gv: VERSION, cid: this.cid, up: 1, re: up.re, pr: rebindProof(this.K, this.cid, up.re),
      }), true);
      up.timer = setTimeout(() => { if (this._upgrade === up) this._dropUpgrade(); }, 6000);
    }, () => { if (this._upgrade === up) this._upgrade = null; });
  }

  _dropUpgrade() {
    const up = this._upgrade;
    if (!up) return;
    this._upgrade = null;
    clearTimeout(up.timer);
    if (up.link) {
      up.link.onmessage = null;
      up.link.onclose = null;
      up.link.close();
      up.ep.destroy();
    } else {
      up.cancel();
    }
  }

  _switchTo(up, welcome) {
    clearTimeout(up.timer);
    const old = this.link;
    this._upgrade = null;
    this.epoch = up.re;
    this.link = up.link;
    this.ep = up.ep;
    this._wire(up.link);
    up.ep.disconnectSignaling();
    // Stragglers still in flight on the relay are accepted briefly, then it is closed.
    old.onclose = null;
    old.onmessage = (obj) => { if (!this.closed && obj !== BAD && obj._ !== 'pong' && obj._ !== 'welcome') this._onMsg(obj); };
    setTimeout(() => { old.onmessage = null; old.close(); }, 2000);
    this._onLobby(welcome.lobby, welcome.r);
    if (!this.closed) this._emit('transport', { slot: this.selfSlot, kind: 'p2p' });
  }

  // ---- lifecycle ----

  _frozen(gap) {
    this.lastPong += gap;
    this.nextPing = 0;
    if (this._rescue) this._rescue.deadline += gap;
  }

  _onVisibility(hidden) {
    if (this.closed) return;
    this.link.sendRaw(JSON.stringify({ _: 'vis', h: hidden ? 1 : 0 }), true);
    if (!hidden) {
      this.nextPing = 0;
      if (this.link.kind === 'relay') this.link.recover();
    }
  }

  _netChanged() {
    if (!this.closed && this.link.kind === 'relay') this.link.recover();
  }

  _teardown(graceful) {
    this._dropUpgrade();
    this._endRescue();
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
// Joining: P2P first; the relay is probed only when P2P looks unlikely to work (so quick P2P
// joins never touch the public brokers). Commit to whichever the rules pick (see _decide).

export class Joiner {
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
    this.answeredAt = 0;
    this.connectAt = 0;
    this.ep = null;
    this.p2pLink = null;
    this.prober = null;
    this.link = null;
    this.K = null;
    this.done = false;
    this.committing = false;
    this.timers = [];
    this.upgrade = null;
    this.p2pCancelled = false;
    // Resolves { ep, link } once the data channel opens (possibly after we fell back to relay).
    this.p2pOpen = new Promise((res, rej) => { this._p2pRes = res; this._p2pRej = rej; });
    this.p2pOpen.catch(() => {});
  }

  run() {
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      this.t0 = now();
      const cfg = netConfig();
      // Relay key agreement is prepared up front (a few ms) in case the relay is needed.
      this.kp = cfg.auth && hasECDH() ? ecdhKeyPair() : Promise.resolve(null);
      this.timers.push(setInterval(() => this._decide(), 200));
      this.timers.push(setTimeout(() => this._fail('NETWORK'), 20000));
      if (this.pre) {
        this.ep = this.pre.ep || null;
        this._commit(this.pre.link);
        return;
      }
      this._startP2P().catch(() => { this.p2p = 'NETWORK'; this._startRelay(); this._decide(); });
    });
  }

  /** Cancel (e.g. the player backed out): rejects with Error('ABORTED'). */
  abort() { this._fail('ABORTED'); }

  async _startP2P() {
    const cfg = netConfig();
    if (!cfg.p2p || cfg.forceRelay) {
      this.p2p = 'OFF';
      this._p2pRej();
      this._startRelay();
      return;
    }
    let ep;
    try {
      ep = await openEndpoint(null, 15000);
    } catch {
      this.p2p = 'NETWORK';
      this._p2pRej();
      this._startRelay();
      this._decide();
      return;
    }
    if (this.p2pCancelled) { ep.destroy(); return; }
    this.ep = ep;
    this.connectAt = now();
    // The attempt outlives the P2P deadline: if we fall back to the relay meanwhile, a
    // late-opening channel can still upgrade the session while in the lobby.
    const { link, done } = ep.connect(roomPeerId(this.code), Math.max(2000, UPGRADE_WINDOW - (now() - this.t0)));
    this.p2pLink = link;
    done.then(() => {
      if (this.p2pCancelled) { link.close(); ep.destroy(); return; }
      this.p2p = 'open';
      this._p2pRes({ ep, link });
      this._decide();
    }, (e) => {
      if (this.p2p === 'pending') this.p2p = e.message;
      this._p2pRej();
      if (!(this.link && this.link.kind === 'p2p')) { ep.destroy(); if (this.ep === ep) this.ep = null; }
      this._startRelay();
      this._decide();
    });
  }

  /** Abandon the P2P attempt (idempotent). */
  _cancelP2P() {
    this.p2pCancelled = true;
    if (this.p2pLink && !(this.link === this.p2pLink)) this.p2pLink.close();
    if (this.ep && !(this.link && this.link.kind === 'p2p' && this.done)) this.ep.destroy();
  }

  _startRelay() {
    if (this.prober || this.done || this.link || this.committing) return;
    const cfg = netConfig();
    this.prober = new RelayProber(this.code, this.cid, cfg.brokers,
      (info, mq, url) => { this.relayInfo = info; this.relayMq = mq; this.relayUrl = url; this._decide(); },
      (state) => { this.relay = state; this._decide(); });
    this.prober.start();
  }

  _decide() {
    if (this.done || this.link || this.committing) return;
    const t = now();
    if (this.p2pLink && this.p2pLink.answered && !this.answeredAt) this.answeredAt = t;
    this.answered = this.answeredAt > 0;
    if (this.p2p === 'open') { this._commit(this.p2pLink); return; }
    if (this.p2p === 'pending') {
      // Probe the relay only once P2P shows signs of trouble.
      if ((!this.ep && t - this.t0 > EP_SLOW) ||
          (this.connectAt && !this.answeredAt && t - this.connectAt > ANSWER_SLOW) ||
          (this.answeredAt && t - this.answeredAt > ICE_SLOW)) this._startRelay();
      if (t - this.t0 > netConfig().p2pTimeout) { this.p2pSlow = true; this._startRelay(); }
    }
    const p2pDead = this.p2p !== 'pending' || this.p2pSlow;
    const info = this.relayInfo;
    if (info) {
      if (!validInfo(info)) { this.relayInfo = null; return; }
      if (info.v !== PROTO || info.gv !== VERSION) { this._fail('VERSION'); return; }
      if (info.st) { this._fail('ALREADY_STARTED'); return; }
      if (info.n >= info.max) { this._fail('ROOM_FULL'); return; }
      if (p2pDead || !info.p2p) this._commitRelay();
      return; // host exists: keep waiting for the data channel (until the P2P deadline)
    }
    if (this.relay === 'pending') return;
    if (p2pDead) {
      if (this.p2p === 'UNAVAILABLE') this._fail('ROOM_NOT_FOUND');
      else if (this.relay === 'unreachable' || this.answered) this._fail('NETWORK');
      else this._fail('ROOM_NOT_FOUND');
      return;
    }
    // Relay says "nobody home" and P2P signaling hasn't produced an answer either.
    if (this.relay === 'negative' && !this.answered && t - this.t0 > 4000) this._fail('ROOM_NOT_FOUND');
  }

  async _commitRelay() {
    this.committing = true;
    const cfg = netConfig();
    const info = this.relayInfo;
    const mq = this.relayMq;
    this.prober.stop(mq);
    // Agree on this player's relay key with the host (ECDH against its announced key).
    let auth = null, pub = null;
    if (typeof info.hpk === 'string' && info.hpk.length < 200) {
      const kp = await this.kp;
      const K = kp ? await ecdhMaster(kp.priv, info.hpk, this.cid) : null;
      if (K) { this.K = K; auth = new LinkAuth(K, 0); pub = kp.pub; }
    }
    if (this.done) { mq.close(); return; }
    this.committing = false;
    // P2P merely slow (the host is on PeerJS): keep trying it in the background.
    if (this.p2p === 'pending' && info.p2p && !this.p2pCancelled) {
      this.upgrade = { promise: this.p2pOpen, cancel: () => this._cancelP2P() };
    }
    this._commit(new RelayClientLink(mq, this.relayUrl, this.code, this.cid, cfg.brokers, auth), pub);
  }

  _commit(link, pk = null) {
    this.link = link;
    if (link.kind === 'p2p') {
      if (this.prober) this.prober.stop(null);
    } else if (!this.upgrade) {
      this._cancelP2P();
    }
    link.onmessage = (obj) => {
      try { this._onHandshake(obj); } catch { if (!this.settled) { this.done = false; this._fail('NETWORK'); } }
    };
    link.onclose = () => this._fail('NETWORK');
    const m = {
      _: 'hello', v: PROTO, gv: VERSION, cid: this.cid,
      name: sanitizeName(this.name, ''), ship: this.ship,
      hid: typeof document !== 'undefined' && document.hidden ? 1 : 0,
    };
    if (pk) m.pk = pk;
    const hello = JSON.stringify(m);
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
      const p2p = this.link.kind === 'p2p';
      let K = this.K;
      if (p2p) {
        const k = unb64u(obj.k);
        K = k && k.length === 32 ? k : null;
        if (this.ep) this.ep.disconnectSignaling(); // the data channel is up; free the server slot
      }
      const s = new ClientSession({
        link: this.link, ep: p2p ? this.ep : null, code: this.code, cid: this.cid, slot: obj.slot, lobby,
        rev: obj.r, K, isPublic: obj.pub === 1, hostNow: obj.h, rtt: now() - this.helloAt,
        hostHidden: obj.hid === 1, upgrade: p2p ? null : this.upgrade, ship: this.ship,
      });
      this.settled = true;
      this.resolve(s);
    } else if (obj._ === 'err') {
      this._fail(ERR_CODES.includes(obj.e) ? obj.e : 'NETWORK');
    } else if (obj._ === 'bye') {
      this._fail('ROOM_NOT_FOUND'); // the host closed the room while we were knocking
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
    if (this.link) { this.link.onclose = null; this.link.onmessage = null; this.link.close(); }
    this.p2pCancelled = true;
    if (this.p2pLink) this.p2pLink.close();
    if (this.ep) this.ep.destroy();
    this.reject(netError(code));
  }
}
