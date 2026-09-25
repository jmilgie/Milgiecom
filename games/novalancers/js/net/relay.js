// Nova Lancers — relay transport over public MQTT brokers (fallback when WebRTC can't connect).
//
// Topics (all under milgie/nvl1/):
//   <CODE>/h          host inbox: clients publish envelopes {"f":cid,"m":[msg,...]}
//   <CODE>/c/<cid>    one client's inbox: host publishes {"m":[msg,...]}
//   <CODE>/b          room broadcast (every relay client subscribes): {"m":[msg,...]}
//   lobby             public-room announcements (quick match discovery)
//
// The host listens on every reachable broker; a client probes all brokers in parallel and
// keeps the first one on which the host answers. Messages are batched per ~50 ms flush so
// the publish rate on public brokers stays low (≤ 20/s per direction per link).

import { MqttClient } from './mqtt.js';
import {
  TOPIC_ROOT, LOBBY_TOPIC, MAX_ENVELOPE, CID_RE, BAD, isObj, now, sleep, validInfo,
} from './common.js';

const FLUSH_MS = 50;
const SPLIT = 12000;          // start a new envelope beyond this many chars
const MAX_QUEUE = 512;        // outbound backlog cap while a broker is reconnecting
const MAX_PENDING_CIDS = 32;  // unbound relay peers the host tracks at once
const PROBE_WAIT = 2200;      // how long a client waits for the host on one broker

export function roomTopics(code) {
  const root = `${TOPIC_ROOT}/${code}`;
  return { h: `${root}/h`, b: `${root}/b`, c: (cid) => `${root}/c/${cid}` };
}

/** Pack pre-serialized messages into one or more envelopes. */
function envelopes(prefix, items) {
  const out = [];
  let cur = [], size = 0;
  for (const s of items) {
    if (cur.length && size + s.length > SPLIT) {
      out.push(prefix + cur.join(',') + ']}');
      cur = [];
      size = 0;
    }
    cur.push(s);
    size += s.length + 1;
  }
  if (cur.length) out.push(prefix + cur.join(',') + ']}');
  return out;
}

function parseEnvelope(text, bytes) {
  if (bytes > MAX_ENVELOPE || text.includes('__proto__')) return null;
  try {
    const o = JSON.parse(text);
    if (!isObj(o) || !Array.isArray(o.m) || o.m.length > 256) return null;
    return o;
  } catch {
    return null;
  }
}

/** Parse a lobby announcement / probe answer payload (validated by the caller). */
export function parseJson(text, bytes) {
  if (bytes > 4096 || text.includes('__proto__')) return null;
  try {
    const o = JSON.parse(text);
    return isObj(o) ? o : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Host side

/** Host's view of one relay peer (keyed by the client's random cid). */
class RelayHostLink {
  constructor(hub, cid, broker) {
    this.kind = 'relay';
    this.hub = hub;
    this.cid = cid;
    this.b = broker;          // broker record the peer was last heard on
    this.bound = false;       // true once it is a player (receives broadcasts)
    this.open = true;
    this.closed = false;
    this.slot = null;
    this.onmessage = null;
    this.onclose = null;
  }
  sendRaw(str, urgent = false) {
    if (this.closed) return false;
    this.hub.enqueue(str, this, urgent);
    return true;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.onmessage = null;
    if (this.hub.links.get(this.cid) === this) this.hub.links.delete(this.cid);
  }
}

export class RelayHub {
  constructor(code, urls) {
    this.code = code;
    this.t = roomTopics(code);
    this.brokers = urls.map((url) => ({ url, mq: null, state: 'idle', retryAt: 0, backoff: 4000 }));
    this.links = new Map();
    this.onlink = null;       // (link) => void, first valid envelope from an unknown cid
    this.q = [];
    this.flushTimer = 0;
    this.lastFlush = 0;
    this.closed = false;
    this._lobbyFn = null;
  }

  get up() {
    let n = 0;
    for (const b of this.brokers) if (b.state === 'up') n++;
    return n;
  }

  /** Connect every broker in parallel; resolves true on the first success, false if all fail. */
  start() {
    return new Promise((resolve) => {
      let left = this.brokers.length, done = false;
      if (!left) { resolve(false); return; }
      for (const b of this.brokers) {
        this._connect(b).then((ok) => {
          left--;
          if (done) return;
          if (ok) { done = true; resolve(true); } else if (!left) { done = true; resolve(false); }
        });
      }
    });
  }

  async _connect(b) {
    if (this.closed || b.state === 'connecting' || b.state === 'up') return b.state === 'up';
    b.state = 'connecting';
    const mq = new MqttClient(b.url);
    try {
      await mq.connect(6000);
      if (this.closed) throw new Error('closed');
      mq.onmessage = (topic, text, bytes) => this._onMsg(b, topic, text, bytes);
      await mq.subscribe(this._lobbyFn ? [this.t.h, LOBBY_TOPIC] : [this.t.h]);
      if (this.closed) throw new Error('closed');
    } catch {
      mq.close();
      b.state = 'down';
      b.retryAt = now() + b.backoff;
      b.backoff = Math.min(b.backoff * 2, 60000);
      return false;
    }
    b.mq = mq;
    b.state = 'up';
    b.backoff = 4000;
    mq.onclose = () => {
      if (b.mq !== mq) return;
      b.mq = null;
      b.state = 'down';
      b.retryAt = now() + 1000;
    };
    return true;
  }

  /** Periodic upkeep (called from the session tick): reconnect dropped brokers. */
  maintain(t) {
    if (this.closed) return;
    for (const b of this.brokers) if (b.state === 'down' && t >= b.retryAt) this._connect(b);
  }

  _onMsg(b, topic, text, bytes) {
    if (this.closed) return;
    if (topic === LOBBY_TOPIC) {
      if (this._lobbyFn) {
        const a = parseJson(text, bytes);
        if (a) this._lobbyFn(a);
      }
      return;
    }
    if (topic !== this.t.h) return;
    const env = parseEnvelope(text, bytes);
    if (!env || typeof env.f !== 'string' || !CID_RE.test(env.f)) return;
    let link = this.links.get(env.f);
    if (!link) {
      let pending = 0;
      for (const l of this.links.values()) if (!l.bound) pending++;
      if (pending >= MAX_PENDING_CIDS) return;
      link = new RelayHostLink(this, env.f, b);
      this.links.set(env.f, link);
      if (this.onlink) this.onlink(link);
      if (link.closed) return;
    }
    link.b = b; // answer on the broker we last heard it on (handles client broker failover)
    for (const m of env.m) {
      if (link.closed || !link.onmessage) break;
      link.onmessage(isObj(m) ? m : BAD);
    }
  }

  /** Queue a message: to = RelayHostLink (direct) or null (broadcast to bound links). */
  enqueue(str, to, urgent = false) {
    if (this.closed) return;
    if (this.q.length >= MAX_QUEUE) this.q.shift();
    this.q.push({ s: str, to });
    if (urgent) { this.flush(); return; }
    if (!this.flushTimer) {
      const wait = Math.max(0, FLUSH_MS - (now() - this.lastFlush));
      this.flushTimer = setTimeout(() => this.flush(), wait);
    }
  }

  flush() {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = 0; }
    this.lastFlush = now();
    const q = this.q;
    if (!q.length) return;
    this.q = [];
    let allBroadcast = true;
    for (const e of q) if (e.to) { allBroadcast = false; break; }
    if (allBroadcast) {
      // One publish per broker that has at least one bound relay player.
      const brokers = new Set();
      for (const l of this.links.values()) if (l.bound && !l.closed) brokers.add(l.b);
      if (!brokers.size) return;
      const envs = envelopes('{"m":[', q.map((e) => e.s));
      for (const b of brokers) if (b.mq) for (const env of envs) b.mq.publish(this.t.b, env);
      return;
    }
    // Mixed batch: per-recipient envelopes on their own topic, preserving order.
    const recipients = new Set();
    for (const l of this.links.values()) if (l.bound && !l.closed) recipients.add(l);
    for (const e of q) if (e.to) recipients.add(e.to);
    for (const r of recipients) {
      const items = [];
      for (const e of q) if (e.to === r || (!e.to && r.bound && !r.closed)) items.push(e.s);
      if (!items.length || !r.b.mq) continue;
      for (const env of envelopes('{"m":[', items)) r.b.mq.publish(this.t.c(r.cid), env);
    }
  }

  /** Publish a public-room announcement on every connected broker. */
  announce(str) {
    for (const b of this.brokers) if (b.mq) b.mq.publish(LOBBY_TOPIC, str);
  }

  /** Receive lobby announcements (quick-match discovery) until stopLobby(). */
  listenLobby(fn) {
    this._lobbyFn = fn;
    for (const b of this.brokers) if (b.mq) b.mq.subscribe(LOBBY_TOPIC).catch(() => {});
  }

  stopLobby() {
    if (!this._lobbyFn) return;
    this._lobbyFn = null;
    for (const b of this.brokers) if (b.mq) b.mq.unsubscribe(LOBBY_TOPIC).catch(() => {});
  }

  close() {
    if (this.closed) return;
    this.flush();
    this.closed = true;
    for (const l of Array.from(this.links.values())) l.close();
    this.links.clear();
    for (const b of this.brokers) {
      if (b.mq) b.mq.close();
      b.mq = null;
      b.state = 'closed';
    }
  }
}

// ---------------------------------------------------------------------------
// Client side

/**
 * Client's discovery of a room on the relay: connects to every broker in parallel,
 * subscribes to its own inbox + the room broadcast, and asks the host for room info.
 *   onInfo(info, mq, url)  host answered (first answer wins)
 *   onDone(state)          'negative' (brokers reachable, no host) | 'unreachable' (no broker)
 */
export class RelayProber {
  constructor(code, cid, urls, onInfo, onDone) {
    this.code = code;
    this.cid = cid;
    this.urls = urls;
    this.t = roomTopics(code);
    this.onInfo = onInfo;
    this.onDone = onDone;
    this.clients = new Set();
    this.found = false;
    this.stopped = false;
    this.failed = 0;
    this.settled = 0;
    this.reachable = 0;
    this.timers = [];
  }

  start() {
    if (!this.urls.length) { this.onDone('unreachable'); return; }
    for (const url of this.urls) this._try(url);
  }

  async _try(url) {
    const mq = new MqttClient(url);
    this.clients.add(mq);
    const inbox = this.t.c(this.cid);
    try {
      await mq.connect(5000);
      if (this.stopped) throw new Error('stopped');
      mq.onmessage = (topic, text, bytes) => {
        if (topic !== inbox || this.stopped || this.found) return;
        const env = parseEnvelope(text, bytes);
        if (!env) return;
        for (const m of env.m) {
          if (isObj(m) && m._ === 'info' && m.code === this.code && validInfo(m)) {
            this.found = true;
            this.onInfo(m, mq, url);
            return;
          }
        }
      };
      await mq.subscribe([inbox, this.t.b]);
      if (this.stopped) throw new Error('stopped');
    } catch {
      this.clients.delete(mq);
      mq.close();
      if (this.stopped) return;
      this.failed++;
      this._check();
      return;
    }
    this.reachable++;
    const probe = `{"f":"${this.cid}","m":[{"_":"probe"}]}`;
    mq.publish(this.t.h, probe);
    this.timers.push(setTimeout(() => { if (!this.stopped && !this.found) mq.publish(this.t.h, probe); }, 800));
    this.timers.push(setTimeout(() => { this.settled++; this._check(); }, PROBE_WAIT));
  }

  _check() {
    if (this.stopped || this.found) return;
    if (this.failed + this.settled >= this.urls.length) this.onDone(this.reachable ? 'negative' : 'unreachable');
  }

  /** Stop probing; close every broker connection except `keep`. */
  stop(keep = null) {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    for (const mq of this.clients) if (mq !== keep) mq.close();
    this.clients.clear();
  }
}

/** Client's link to the host through one broker (fails over to other brokers if it drops). */
export class RelayClientLink {
  constructor(mq, url, code, cid, urls) {
    this.kind = 'relay';
    this.code = code;
    this.cid = cid;
    this.urls = urls;
    this.url = url;
    this.t = roomTopics(code);
    this.inbox = this.t.c(cid);
    this.prefix = `{"f":"${cid}","m":[`;
    this.open = true;
    this.closed = false;
    this.onmessage = null;
    this.onclose = null;
    this.q = [];
    this.flushTimer = 0;
    this.lastFlush = 0;
    this.reconnecting = false;
    this._bind(mq, url);
  }

  _bind(mq, url) {
    this.mq = mq;
    this.url = url;
    mq.onmessage = (topic, text, bytes) => {
      if (this.closed || (topic !== this.inbox && topic !== this.t.b)) return;
      const env = parseEnvelope(text, bytes);
      if (!env) return;
      for (const m of env.m) {
        if (this.closed || !this.onmessage) break;
        this.onmessage(isObj(m) ? m : BAD);
      }
    };
    mq.onclose = () => { if (this.mq === mq) this._reconnect(); };
  }

  async _reconnect() {
    if (this.closed || this.reconnecting) return;
    this.reconnecting = true;
    this.mq = null;
    const order = [this.url, ...this.urls.filter((u) => u !== this.url)];
    const deadline = now() + 20000;
    while (!this.closed && now() < deadline) {
      for (const url of order) {
        if (this.closed) return;
        const mq = new MqttClient(url);
        try {
          await mq.connect(5000);
          await mq.subscribe([this.inbox, this.t.b]);
        } catch {
          mq.close();
          continue;
        }
        if (this.closed) { mq.close(); return; }
        this.reconnecting = false;
        this._bind(mq, url);
        this.flush();
        return;
      }
      await sleep(1000);
    }
    this.reconnecting = false;
    if (!this.closed) {
      this.closed = true;
      this.open = false;
      if (this.onclose) this.onclose();
    }
  }

  sendRaw(str, urgent = false) {
    if (this.closed) return false;
    if (this.q.length >= MAX_QUEUE) this.q.shift();
    this.q.push(str);
    if (urgent) this.flush();
    else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), Math.max(0, FLUSH_MS - (now() - this.lastFlush)));
    }
    return true;
  }

  flush() {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = 0; }
    if (!this.mq || !this.q.length) return;
    this.lastFlush = now();
    const items = this.q;
    this.q = [];
    for (const env of envelopes(this.prefix, items)) this.mq.publish(this.t.h, env);
  }

  close() {
    if (this.closed) return;
    this.flush();
    this.closed = true;
    this.open = false;
    this.onmessage = null;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.mq) this.mq.close();
    this.mq = null;
  }
}
