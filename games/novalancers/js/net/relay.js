// Nova Lancers — relay transport over public MQTT brokers (fallback when WebRTC can't connect).
//
// Topics live under milgie/nvl1/<room>, where <room> is the first 16 hex digits of
// SHA-256('nvl1:' + CODE), so room codes can't simply be read off the broker firehose:
//   <room>/h          host inbox: clients publish envelopes
//   <room>/b          host -> admitted clients: broadcasts plus items addressed to one cid
//                     (a single stream, so everything the host sends stays in order)
//   <room>/c/<cid>    host -> one client that isn't admitted yet (probe answers, errors,
//                     the kick for a player that was already dropped)
//   milgie/nvl1/lobby public-room announcements (quick match discovery)
//
// Envelope = optional tag header, '\n', JSON body:
//   client -> host  <cid>:<tag>\n{"f":"<cid>","q":<seq>,"m":[msg,...]}
//   host -> client  <cid>:<tag>,<cid>:<tag>\n{"q":<seq>,"m":[msg | {"@":"<cid>","x":msg},...]}
// tag = 128-bit HMAC of the body bytes under that player's link key (see auth.js). Once a
// link has keys, envelopes without a valid tag or with a non-increasing seq are dropped, so
// other broker users can neither inject, replay nor spoof messages. Links without keys
// (no WebCrypto: insecure contexts only) simply omit the header.
//
// The host listens on every reachable broker; a client probes all brokers in parallel and
// keeps the first one on which the host answers. Messages queued in the same task share one
// publish, and a token bucket paces publishes (≤ 25/s per direction per link on average).

import { MqttClient } from './mqtt.js';
import { sha256, hex, sameTag } from './auth.js';
import {
  TOPIC_ROOT, LOBBY_TOPIC, MAX_ENVELOPE, CID_RE, BAD, isObj, isInt, now, sleep, safeJson, utf8Len,
} from './common.js';

const PUB_RATE = 25;          // sustained publishes/s per link direction (token bucket)
const PUB_BURST = 3;
const ITEM_BUDGET = MAX_ENVELOPE - 512;   // bytes of messages per envelope (header + wrapper fit in the rest)
const MAX_HEAD = 400;         // tag header (≤ 3 relay players)
const MAX_QUEUE = 512;        // outbound backlog cap while a broker is reconnecting
const PROBE_WAIT = 2200;      // how long a client waits for the host on one broker
const MAX_SEQ = 2 ** 52;
const te = new TextEncoder();

export function roomTopics(code) {
  const root = `${TOPIC_ROOT}/${hex(sha256(`nvl1:${code}`)).slice(0, 16)}`;
  return { h: `${root}/h`, b: `${root}/b`, c: (cid) => `${root}/c/${cid}` };
}

/**
 * Publish pacing: messages queued in the same task are coalesced into one publish, and a
 * token bucket keeps the average publish rate ≤ PUB_RATE without adding latency to a
 * steady 20 Hz stream (a fixed min-spacing rule would make such a stream drift late).
 */
class Pacer {
  constructor() {
    this.tokens = PUB_BURST;
    this.t = now();
  }
  _refill() {
    const t = now();
    this.tokens = Math.min(PUB_BURST, this.tokens + (t - this.t) * PUB_RATE / 1000);
    this.t = t;
  }
  delay() {
    this._refill();
    return this.tokens >= 1 ? 0 : Math.ceil((1 - this.tokens) * 1000 / PUB_RATE);
  }
  take() {
    this._refill();
    this.tokens = Math.max(-PUB_BURST, this.tokens - 1);
  }
}

/** Group serialized items into bodies of at most ITEM_BUDGET UTF-8 bytes each. */
function pack(items) {
  const out = [];
  let cur = [], size = 0;
  for (const s of items) {
    const n = utf8Len(s) + 1;
    if (cur.length && size + n > ITEM_BUDGET) { out.push(cur); cur = []; size = 0; }
    cur.push(s);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Split a payload into { head, body, off } (off = byte offset of the body); null if malformed. */
function splitFrame(text) {
  const nl = text.indexOf('\n');
  if (nl < 0) return { head: '', body: text, off: 0 };
  if (nl > MAX_HEAD) return null;
  return { head: text.slice(0, nl), body: text.slice(nl + 1), off: nl + 1 }; // header is ASCII
}

/** The tag for `cid` in a header "cid:tag,cid:tag" (or null). */
function findTag(head, cid) {
  if (!head) return null;
  let i = head.indexOf(`${cid}:`);
  while (i > 0 && head[i - 1] !== ',') i = head.indexOf(`${cid}:`, i + 1);
  if (i < 0) return null;
  const s = i + cid.length + 1;
  const e = head.indexOf(',', s);
  return head.slice(s, e < 0 ? head.length : e);
}

function parseEnvelope(body) {
  const o = safeJson(body);
  if (!isObj(o) || !Array.isArray(o.m) || o.m.length > 256) return null;
  return o;
}

/** Parse a lobby announcement / probe answer payload (validated by the caller). */
export function parseJson(text, bytes) {
  if (bytes > 4096) return null;
  const o = safeJson(text);
  return isObj(o) ? o : null;
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
    this.bound = false;       // true once it is a player (receives the /b stream)
    this.open = true;
    this.closed = false;
    this.slot = null;
    this.auth = null;         // LinkAuth once keys are agreed
    this.verifying = false;   // key agreement in progress: incoming envelopes are dropped
    this.rq = 0;              // last accepted sequence number
    this.first = null;        // the envelope that created the link (verified once keys exist)
    this.onmessage = null;
    this.onclose = null;
  }

  /** Check the envelope that opened this link against `auth`; on success adopt the keys. */
  adopt(auth) {
    const f = this.first;
    this.first = null;
    if (!f) return false;
    const tag = findTag(f.head, this.cid);
    if (!tag || !sameTag(tag, auth.c2h.tag(f.body)) || !isInt(f.q, 1, MAX_SEQ)) return false;
    this.auth = auth;
    this.rq = f.q;
    return true;
  }

  _accept(fr, raw, env) {
    const tag = findTag(fr.head, this.cid);
    if (!tag || !sameTag(tag, this.auth.c2h.tag(raw.subarray(fr.off)))) return false;
    if (!isInt(env.q, this.rq + 1, MAX_SEQ)) return false; // replayed or reordered
    this.rq = env.q;
    return true;
  }

  sendRaw(str, urgent = false) {
    if (this.closed) return false;
    if (this.bound) this.hub.enqueue(str, this, urgent);
    else this.hub.sendDirect(this.cid, this.b, [str], this.auth);
    return true;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.bound = false;
    this.onmessage = null;
    if (this.hub.links.get(this.cid) === this) this.hub.links.delete(this.cid);
  }
}

export class RelayHub {
  constructor(code, urls) {
    this.code = code;
    this.t = roomTopics(code);
    this.brokers = urls.map((url) => ({ url, mq: null, state: 'idle', retryAt: 0, backoff: 4000, checkAt: 0 }));
    this.links = new Map();   // cid -> RelayHostLink
    this.onhello = null;      // (link) => void   an unknown cid sent a hello (link created)
    this.onprobe = null;      // (cid, broker) => void   an unknown cid asks for room info
    this.onstray = null;      // (cid, broker) => void   other traffic from an unknown cid
    this.q = [];
    this.flushTimer = 0;
    this.pacer = new Pacer();
    this.seq = 0;
    this.troubleAt = -1e9;    // last time a broker connection was found dead
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
      mq.onmessage = (topic, text, raw) => this._onMsg(b, topic, text, raw);
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
      this.troubleAt = now();
    };
    return true;
  }

  /** Periodic upkeep (called from the session tick): reconnect dropped brokers. */
  maintain(t) {
    if (this.closed) return;
    for (const b of this.brokers) if (b.state === 'down' && t >= b.retryAt) this._connect(b);
  }

  /**
   * Verify broker connections now (half-open sockets after a network change send and
   * receive nothing without ever closing): a broker that doesn't answer PINGREQ is dropped
   * and reconnected by maintain(). `b` = one broker record, or all when omitted.
   */
  check(b = null) {
    if (this.closed) return;
    const t = now();
    for (const x of b ? [b] : this.brokers) {
      if (x.state !== 'up' || !x.mq || t - x.checkAt < 4000) continue;
      x.checkAt = t;
      const mq = x.mq;
      mq.ping(2500).then((ok) => { if (!ok && x.mq === mq && !this.closed) mq.kill(); });
    }
  }

  _onMsg(b, topic, text, raw) {
    if (this.closed) return;
    if (topic === LOBBY_TOPIC) {
      if (this._lobbyFn) {
        const a = parseJson(text, raw.length);
        if (a) this._lobbyFn(a);
      }
      return;
    }
    if (topic !== this.t.h || raw.length > MAX_ENVELOPE) return;
    const fr = splitFrame(text);
    const env = fr && parseEnvelope(fr.body);
    if (!env || typeof env.f !== 'string' || !CID_RE.test(env.f)) return;
    const cid = env.f;
    let link = this.links.get(cid);
    if (link) {
      if (link.verifying) return;
      if (link.auth && !link._accept(fr, raw, env)) return;
    } else {
      let hello = false, probe = false;
      for (const m of env.m) {
        if (!isObj(m)) continue;
        if (m._ === 'hello') hello = true;
        else if (m._ === 'probe') probe = true;
      }
      if (!hello) {
        // Probes are answered without keeping any state (a probe flood can't fill tables).
        if (probe) { if (this.onprobe) this.onprobe(cid, b); } else if (this.onstray) this.onstray(cid, b);
        return;
      }
      link = new RelayHostLink(this, cid, b);
      link.first = { head: fr.head, body: raw.slice(fr.off), q: env.q };
      this.links.set(cid, link);
      if (this.onhello) this.onhello(link);
      if (link.closed || !link.onmessage) { link.close(); return; }
    }
    link.b = b; // answer on the broker we last heard it on (handles client broker failover)
    for (const m of env.m) {
      if (link.closed || !link.onmessage) break;
      link.onmessage(isObj(m) ? m : BAD);
    }
  }

  /** Publish right away to one client's inbox (clients that aren't admitted yet). */
  sendDirect(cid, b, items, auth = null) {
    if (this.closed || !b || !b.mq) return;
    const body = `{"q":${++this.seq},"m":[${items.join(',')}]}`;
    b.mq.publish(this.t.c(cid), auth ? `${cid}:${auth.h2c.tag(body)}\n${body}` : body);
  }

  /** Queue for the /b stream: to = a bound RelayHostLink (addressed item) or null (broadcast). */
  enqueue(str, to, urgent = false) {
    if (this.closed) return;
    if (this.q.length >= MAX_QUEUE) this.q.shift();
    this.q.push({ s: str, to });
    if (urgent) { this.flush(); return; }
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), this.pacer.delay());
  }

  flush() {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = 0; }
    const q = this.q;
    if (!q.length) return;
    this.q = [];
    this.pacer.take();
    const players = [];
    for (const l of this.links.values()) if (l.bound && !l.closed) players.push(l);
    if (!players.length) return;
    // Pack in order; an envelope is tagged for every player it carries something for.
    let items = [], size = 0, all = false;
    const to = new Set();
    const emit = () => {
      if (items.length) this._publishStream(items, all ? players : Array.from(to));
      items = [];
      size = 0;
      all = false;
      to.clear();
    };
    for (const e of q) {
      if (e.to && (!e.to.bound || e.to.closed)) continue;
      const s = e.to ? `{"@":"${e.to.cid}","x":${e.s}}` : e.s;
      const n = utf8Len(s) + 1;
      if (items.length && size + n > ITEM_BUDGET) emit();
      items.push(s);
      size += n;
      if (e.to) to.add(e.to); else all = true;
    }
    emit();
  }

  _publishStream(items, targets) {
    const body = `{"q":${++this.seq},"m":[${items.join(',')}]}`;
    let head = '', bytes = null;
    const brokers = new Set();
    for (const r of targets) {
      brokers.add(r.b);
      if (!r.auth) continue;
      if (!bytes) bytes = te.encode(body);
      head += `${head ? ',' : ''}${r.cid}:${r.auth.h2c.tag(bytes)}`;
    }
    const payload = head ? `${head}\n${body}` : body;
    for (const b of brokers) if (b.mq) b.mq.publish(this.t.b, payload);
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
 * subscribes to its own inbox + the room stream, and asks the host for room info.
 *   onInfo(info, mq, url)  host answered (first answer wins)
 *   onDone(state)          'negative' (brokers reachable, no host) | 'unreachable' (no broker)
 * persistent: keep re-probing every second until stop() (link rescue); 'negative' is still
 * reported once after PROBE_WAIT.
 */
export class RelayProber {
  constructor(code, cid, urls, onInfo, onDone, persistent = false) {
    this.code = code;
    this.cid = cid;
    this.urls = urls;
    this.t = roomTopics(code);
    this.onInfo = onInfo;
    this.onDone = onDone;
    this.persistent = persistent;
    this.clients = new Set();
    this.found = false;
    this.stopped = false;
    this.reported = false;
    this.failed = 0;
    this.settled = 0;
    this.reachable = 0;
    this.timers = [];
  }

  start() {
    if (!this.urls.length) { this._report('unreachable'); return; }
    for (const url of this.urls) this._try(url);
  }

  async _try(url) {
    const mq = new MqttClient(url);
    this.clients.add(mq);
    const inbox = this.t.c(this.cid);
    try {
      await mq.connect(5000);
      if (this.stopped) throw new Error('stopped');
      mq.onmessage = (topic, text, raw) => {
        if (topic !== inbox || this.stopped || this.found || raw.length > MAX_ENVELOPE) return;
        const fr = splitFrame(text);
        const env = fr && parseEnvelope(fr.body);
        if (!env) return;
        for (const m of env.m) {
          if (isObj(m) && m._ === 'info' && m.code === this.code) {
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
    const send = () => { if (!this.stopped && !this.found && mq.connected) mq.publish(this.t.h, probe); };
    send();
    if (this.persistent) this.timers.push(setInterval(send, 1000));
    else this.timers.push(setTimeout(send, 800));
    this.timers.push(setTimeout(() => { this.settled++; this._check(); }, PROBE_WAIT));
  }

  _report(state) {
    if (this.reported || this.stopped || this.found) return;
    this.reported = true;
    this.onDone(state);
  }

  _check() {
    if (this.failed + this.settled >= this.urls.length) this._report(this.reachable ? 'negative' : 'unreachable');
  }

  /** Stop probing; close every broker connection except `keep`. */
  stop(keep = null) {
    this.stopped = true;
    for (const t of this.timers) { clearTimeout(t); clearInterval(t); }
    for (const mq of this.clients) if (mq !== keep) mq.close();
    this.clients.clear();
  }
}

/**
 * Client's link to the host through one broker. Fails over to the other brokers when the
 * connection drops, and on recover() (the session heard nothing from the host lately).
 */
export class RelayClientLink {
  constructor(mq, url, code, cid, urls, auth = null) {
    this.kind = 'relay';
    this.code = code;
    this.cid = cid;
    this.urls = urls;
    this.url = url;
    this.auth = auth;
    this.t = roomTopics(code);
    this.inbox = this.t.c(cid);
    this.open = true;
    this.closed = false;
    this.onmessage = null;
    this.onclose = null;
    this.q = [];
    this.flushTimer = 0;
    this.pacer = new Pacer();
    this.seq = 0;
    this.rq = { b: 0, c: 0 };   // last accepted host sequence per topic
    this.reconnecting = false;
    this.rotating = false;
    this.recoverAt = -1e9;
    this._bind(mq, url);
  }

  get secure() { return !!this.auth; }

  _bind(mq, url) {
    this.mq = mq;
    this.url = url;
    mq.onmessage = (topic, text, raw) => this._onPublish(topic, text, raw);
    mq.onclose = () => { if (this.mq === mq) this._reconnect(); };
  }

  _onPublish(topic, text, raw) {
    if (this.closed || raw.length > MAX_ENVELOPE) return;
    const key = topic === this.t.b ? 'b' : topic === this.inbox ? 'c' : null;
    if (!key) return;
    const fr = splitFrame(text);
    if (!fr) return;
    if (this.auth) {
      const tag = findTag(fr.head, this.cid);
      if (!tag || !sameTag(tag, this.auth.h2c.tag(raw.subarray(fr.off)))) return; // not for us / forged
    }
    const env = parseEnvelope(fr.body);
    if (!env) return;
    if (this.auth) {
      if (!isInt(env.q, this.rq[key] + 1, MAX_SEQ)) return; // replayed or reordered
      this.rq[key] = env.q;
    }
    for (const m of env.m) {
      if (this.closed || !this.onmessage) break;
      if (isObj(m) && m['@'] !== undefined) {
        if (m['@'] === this.cid) this.onmessage(isObj(m.x) ? m.x : BAD);
      } else {
        this.onmessage(isObj(m) ? m : BAD);
      }
    }
  }

  async _connectTo(url) {
    const mq = new MqttClient(url);
    try {
      await mq.connect(5000);
      await mq.subscribe([this.inbox, this.t.b]);
      return mq;
    } catch {
      mq.close();
      return null;
    }
  }

  async _reconnect() {
    if (this.closed || this.reconnecting) return;
    this.reconnecting = true;
    this.mq = null;
    const order = [this.url, ...this.urls.filter((u) => u !== this.url)];
    const deadline = now() + 20000;
    while (!this.closed && now() < deadline) {
      for (const url of order) {
        if (this.closed) break;
        const mq = await this._connectTo(url);
        if (!mq) continue;
        if (this.closed) { mq.close(); break; }
        this.reconnecting = false;
        this._bind(mq, url);
        this.flush();
        return;
      }
      if (!this.closed) await sleep(1000);
    }
    this.reconnecting = false;
    if (!this.closed) {
      this.closed = true;
      this.open = false;
      if (this.onclose) this.onclose();
    }
  }

  /**
   * The host has gone quiet: make sure our broker connection is alive (a half-open socket
   * never closes by itself), and if it is, move to the next broker — the host listens on
   * all of them, so one of its own broker connections may be the broken one.
   */
  recover() {
    const t = now();
    if (this.closed || this.reconnecting || t - this.recoverAt < 4000) return;
    this.recoverAt = t;
    const mq = this.mq;
    if (!mq) return;
    mq.ping(2000).then(async (ok) => {
      if (this.closed || this.mq !== mq) return;
      if (!ok) { mq.kill(); return; } // -> onclose -> _reconnect()
      if (this.urls.length < 2 || this.rotating) return;
      const i = this.urls.indexOf(this.url);
      const order = [...this.urls.slice(i + 1), ...this.urls.slice(0, Math.max(0, i))];
      this.rotating = true;
      try {
        for (const url of order) {
          const next = await this._connectTo(url);
          if (!next) continue;
          // Our socket may have died meanwhile (then _reconnect() owns the link): discard.
          if (this.closed || this.mq !== mq || this.reconnecting) { next.close(); return; }
          mq.onclose = null;
          mq.close();
          this._bind(next, url);
          this.flush();
          return;
        }
      } finally {
        this.rotating = false;
      }
    });
  }

  sendRaw(str, urgent = false) {
    if (this.closed) return false;
    if (this.q.length >= MAX_QUEUE) this.q.shift();
    this.q.push(str);
    if (urgent) this.flush();
    else if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), this.pacer.delay());
    return true;
  }

  flush() {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = 0; }
    if (!this.mq || !this.mq.connected || !this.q.length) return;
    this.pacer.take();
    const items = this.q;
    this.q = [];
    for (const group of pack(items)) {
      const body = `{"f":"${this.cid}","q":${++this.seq},"m":[${group.join(',')}]}`;
      this.mq.publish(this.t.h, this.auth ? `${this.cid}:${this.auth.c2h.tag(body)}\n${body}` : body);
    }
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
