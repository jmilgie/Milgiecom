// Nova Lancers — tiny MQTT 3.1.1 client over WebSocket (QoS 0 only).
//
// Just enough protocol for the multiplayer relay fallback: CONNECT/CONNACK,
// SUBSCRIBE/SUBACK, UNSUBSCRIBE/UNSUBACK, PUBLISH (QoS 0 both ways; an inbound QoS 1
// publish is PUBACKed), PINGREQ/PINGRESP keepalive and DISCONNECT. Topics and payloads
// are UTF-8 strings. Incoming packets are reassembled from arbitrary WebSocket framing.
//
//   const mq = new MqttClient('wss://broker.emqx.io:8084/mqtt');
//   await mq.connect();                        // rejects Error('MQTT_TIMEOUT'|'MQTT_CLOSED'|'MQTT_REFUSED'|'MQTT_WS')
//   mq.onmessage = (topic, text, bytes) => {};
//   mq.onclose = (reason) => {};               // unexpected loss only (not after close())
//   await mq.subscribe(['a/b', 'a/c']);
//   mq.publish('a/b', 'hello');                // -> false if not connected / socket backed up
//   mq.close();

const enc = new TextEncoder();
const dec = new TextDecoder();

const T_CONNECT = 1, T_CONNACK = 2, T_PUBLISH = 3, T_PUBACK = 4, T_SUBSCRIBE = 8, T_SUBACK = 9,
  T_UNSUBSCRIBE = 10, T_UNSUBACK = 11, T_PINGREQ = 12, T_PINGRESP = 13, T_DISCONNECT = 14;

const MAX_PACKET = 256 * 1024;        // larger inbound packets are skipped, not buffered
const MAX_BUFFERED = 1024 * 1024;     // refuse to queue more than this on a stalled socket
const PING_TIMEOUT = 10000;

const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function randomClientId() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  let s = 'nvl';
  for (let i = 0; i < b.length; i++) s += ALNUM[b[i] % ALNUM.length];
  return s; // 19 chars: within the 23-char limit every 3.1.1 broker must accept
}

// Remaining-length varint (1..4 bytes).
function lenBytes(n) {
  const out = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 128;
    out.push(b);
  } while (n > 0);
  return out;
}

// Build a packet from its first header byte and a list of body parts (Uint8Array | number[]).
function packet(h, parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const lb = lenBytes(len);
  const out = new Uint8Array(1 + lb.length + len);
  out[0] = h;
  out.set(lb, 1);
  let o = 1 + lb.length;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function u16(n) { return [(n >> 8) & 255, n & 255]; }
function utf8Str(s) {
  const b = enc.encode(s);
  const out = new Uint8Array(2 + b.length);
  out[0] = (b.length >> 8) & 255;
  out[1] = b.length & 255;
  out.set(b, 2);
  return out;
}

export class MqttClient {
  constructor(url, opts = {}) {
    this.url = url;
    this.clientId = opts.clientId || randomClientId();
    this.keepalive = opts.keepalive || 30; // seconds
    this.connected = false;
    this.closed = false;
    this.onmessage = null;
    this.onclose = null;
    this._ws = null;
    this._buf = null;
    this._skip = 0;
    this._pid = 0;
    this._pending = new Map(); // packet id -> { resolve, reject, timer }
    this._kaTimer = 0;
    this._lastPing = 0;
    this._pingOut = 0;
    this._connack = null;
    this._abort = false;
  }

  /** Open the socket and complete the CONNECT handshake. */
  connect(timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this._connack = null;
        if (err) { this._teardown(); reject(err); } else resolve(this);
      };
      const timer = setTimeout(() => { this._abort = true; finish(new Error('MQTT_TIMEOUT')); }, timeoutMs);
      let ws;
      try {
        ws = new WebSocket(this.url, ['mqtt']);
      } catch {
        finish(new Error('MQTT_WS'));
        return;
      }
      ws.binaryType = 'arraybuffer';
      this._ws = ws;
      ws.onopen = () => {
        // CONNECT: protocol "MQTT" level 4, clean session, no will / credentials.
        this._write(packet(T_CONNECT << 4, [
          utf8Str('MQTT'), [4, 0x02], u16(this.keepalive), utf8Str(this.clientId),
        ]));
      };
      ws.onmessage = (ev) => this._onData(ev.data);
      ws.onerror = () => {}; // a close event always follows
      ws.onclose = () => {
        if (!settled) finish(new Error('MQTT_CLOSED'));
        else this._lost('closed');
      };
      this._connack = (rc) => {
        if (rc !== 0) { finish(new Error('MQTT_REFUSED')); return; }
        this.connected = true;
        this._lastPing = performance.now();
        this._kaTimer = setInterval(() => this._keepalive(), 2500);
        finish(null);
      };
    });
  }

  subscribe(topics) { return this._request(T_SUBSCRIBE, topics); }
  unsubscribe(topics) { return this._request(T_UNSUBSCRIBE, topics); }

  /** Fire-and-forget QoS 0 publish. Returns false if it could not be queued. */
  publish(topic, text, retain = false) {
    if (!this.connected) return false;
    const ws = this._ws;
    if (!ws || ws.readyState !== 1 || ws.bufferedAmount > MAX_BUFFERED) return false;
    const payload = typeof text === 'string' ? enc.encode(text) : text;
    return this._write(packet((T_PUBLISH << 4) | (retain ? 1 : 0), [utf8Str(topic), payload]));
  }

  /** Graceful disconnect. Does not fire onclose. */
  close() {
    if (this.closed) return;
    if (this.connected) this._write(new Uint8Array([T_DISCONNECT << 4, 0]));
    this._teardown();
  }

  // ---- internals ----

  _request(type, topics) {
    if (!Array.isArray(topics)) topics = [topics];
    if (!this.connected || !topics.length) return Promise.reject(new Error('MQTT_CLOSED'));
    this._pid = (this._pid % 65535) + 1;
    const pid = this._pid;
    const parts = [u16(pid)];
    for (const t of topics) {
      parts.push(utf8Str(t));
      if (type === T_SUBSCRIBE) parts.push([0]); // requested QoS 0
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(pid);
        reject(new Error('MQTT_TIMEOUT'));
      }, 8000);
      this._pending.set(pid, { resolve, reject, timer });
      // SUBSCRIBE / UNSUBSCRIBE carry the mandatory 0b0010 flags.
      if (!this._write(packet((type << 4) | 2, parts))) {
        clearTimeout(timer);
        this._pending.delete(pid);
        reject(new Error('MQTT_CLOSED'));
      }
    });
  }

  _write(bytes) {
    const ws = this._ws;
    if (!ws || ws.readyState !== 1) return false;
    try { ws.send(bytes); return true; } catch { return false; }
  }

  _keepalive() {
    if (!this.connected) return;
    const now = performance.now();
    if (this._pingOut && now - this._pingOut > PING_TIMEOUT) { this._lost('timeout'); return; }
    if (!this._pingOut && now - this._lastPing >= this.keepalive * 500) {
      this._pingOut = now;
      this._lastPing = now;
      this._write(new Uint8Array([T_PINGREQ << 4, 0]));
    }
  }

  _onData(data) {
    if (this.closed || !(data instanceof ArrayBuffer)) return;
    let chunk = new Uint8Array(data);
    if (this._skip > 0) {
      const n = Math.min(this._skip, chunk.length);
      this._skip -= n;
      chunk = chunk.subarray(n);
      if (!chunk.length) return;
    }
    let buf = chunk;
    if (this._buf) {
      buf = new Uint8Array(this._buf.length + chunk.length);
      buf.set(this._buf, 0);
      buf.set(chunk, this._buf.length);
    }
    let off = 0;
    while (buf.length - off >= 2 && !this.closed) {
      // Decode the remaining-length varint.
      let len = 0, mult = 1, i = off + 1, b = 0, complete = false;
      for (let k = 0; k < 4; k++) {
        if (i >= buf.length) break;
        b = buf[i++];
        len += (b & 127) * mult;
        mult *= 128;
        if (!(b & 128)) { complete = true; break; }
      }
      if (!complete) {
        if (i - off > 4) { this._lost('protocol'); return; } // malformed length
        break; // need more bytes
      }
      const total = (i - off) + len;
      if (len > MAX_PACKET) {
        const avail = buf.length - off;
        if (avail >= total) { off += total; continue; }
        this._skip = total - avail;
        off = buf.length;
        break;
      }
      if (buf.length - off < total) break;
      this._handle(buf[off], buf.subarray(i, i + len));
      off += total;
    }
    this._buf = (!this.closed && off < buf.length) ? buf.slice(off) : null;
  }

  _handle(h, body) {
    const type = h >> 4;
    if (type === T_PUBLISH) {
      if (body.length < 2) return;
      const tlen = (body[0] << 8) | body[1];
      let p = 2 + tlen;
      if (p > body.length) return;
      const qos = (h >> 1) & 3;
      if (qos > 0) {
        if (p + 2 > body.length) return;
        const pid = (body[p] << 8) | body[p + 1];
        p += 2;
        if (qos === 1) this._write(new Uint8Array([T_PUBACK << 4, 2, pid >> 8, pid & 255]));
        else return; // QoS 2 is never requested; ignore
      }
      const topic = dec.decode(body.subarray(2, 2 + tlen));
      const payload = body.subarray(p);
      if (this.onmessage) {
        try { this.onmessage(topic, dec.decode(payload), payload.length); } catch (e) { console.error(e); }
      }
    } else if (type === T_CONNACK) {
      if (this._connack && body.length >= 2) this._connack(body[1]);
    } else if (type === T_SUBACK || type === T_UNSUBACK) {
      if (body.length < 2) return;
      const pid = (body[0] << 8) | body[1];
      const req = this._pending.get(pid);
      if (!req) return;
      this._pending.delete(pid);
      clearTimeout(req.timer);
      let refused = false;
      if (type === T_SUBACK) for (let i = 2; i < body.length; i++) if (body[i] === 0x80) refused = true;
      if (refused) req.reject(new Error('MQTT_SUB_REFUSED')); else req.resolve();
    } else if (type === T_PINGRESP) {
      this._pingOut = 0;
    }
  }

  _lost(reason) {
    if (this.closed) return;
    const wasConnected = this.connected;
    this._teardown();
    if (wasConnected && this.onclose) {
      try { this.onclose(reason); } catch (e) { console.error(e); }
    }
  }

  _teardown() {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    clearInterval(this._kaTimer);
    this._buf = null;
    for (const req of this._pending.values()) {
      clearTimeout(req.timer);
      req.reject(new Error('MQTT_CLOSED'));
    }
    this._pending.clear();
    const ws = this._ws;
    this._ws = null;
    if (ws) {
      ws.onmessage = ws.onerror = ws.onclose = null;
      if (ws.readyState === 0 && !this._abort) {
        // Closing a CONNECTING socket makes browsers log a warning; let it open, then close.
        // (A connect timeout aborts for real: a stuck socket would block others to that host.)
        ws.onopen = () => { try { ws.close(1000); } catch { /* ignore */ } };
      } else {
        ws.onopen = null;
        try { ws.close(1000); } catch { /* already closing */ }
      }
    }
  }
}
