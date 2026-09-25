// Nova Lancers — networking constants, configuration and small shared helpers.

import { SHIP_ORDER, VERSION, MAX_PLAYERS } from '../config.js';

export { SHIP_ORDER, VERSION, MAX_PLAYERS };

export const PROTO = 2;                          // wire protocol version (bump on breaking changes)
export const NS = 'nvl1';
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LEN = 5;
export const PUB_SLOTS = 12;
export const ROOM_PREFIX = `${NS}-room-`;
export const PUB_PREFIX = `${NS}-pub-`;
export const TOPIC_ROOT = `milgie/${NS}`;
export const LOBBY_TOPIC = `${TOPIC_ROOT}/lobby`;
export const INVITE_BASE = 'https://milgie.com/games/novalancers/';

export const MAX_MSG = 16000;                    // max serialized game/internal message (bytes)
export const MAX_IN = 16384;                     // max accepted inbound message (bytes)
export const MAX_ENVELOPE = 16384 + 512;         // max accepted relay envelope (bytes)
export const NAME_MAX = 12;

export const P2P_TIMEOUT = 6500;                 // data channel must open within this (ms from join start)
export const HEARTBEAT_MS = 1000;
export const LOST_MS = 6000;                     // silence before a peer is declared lost
export const LOST_HIDDEN_MS = 12000;             // ... when it told us its page went hidden (in game)
export const LOBBY_HIDDEN_MS = 30000;            // ... same, while still in the lobby
export const STALE_MS = 2500;                    // silence before lobby shows connected:false
export const RESCUE_MAX = 8000;                  // a client's link-rescue attempt (P2P -> relay) budget
export const RESCUE_GRACE = 8000;                // host holds a slot this long after a rescue probe
export const P2P_HOLD_MS = 8000;                 // silence before a rescue-capable P2P player is dropped

export const DEFAULT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];

export const DEFAULT_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

// ---------------------------------------------------------------------------
// Configuration: defaults, URL overrides (for local testing) and programmatic overrides.
//   ?peerhost=localhost&peerport=9107&peerpath=/&peersecure=0   PeerJS signaling server
//   ?mqtt=ws://localhost:9108[,ws://...]                         relay broker list
//   ?forcerelay=1                                                clients skip P2P
//   ?p2p=0                                                       no PeerJS at all (relay only)
//   ?ice=none                                                    no STUN servers (LAN / local tests)
//   ?auth=0                                                      unauthenticated relay (tests only)

let overrides = {};
let cached = null;

/** Programmatic override of any netConfig() field (used by test harnesses). */
export function configureNet(o) {
  overrides = { ...overrides, ...(o || {}) };
  cached = null;
}

function isLocalHost(h) {
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
}

export function netConfig() {
  if (cached) return cached;
  let q;
  try { q = new URLSearchParams(location.search); } catch { q = new URLSearchParams(''); }
  const flag = (k) => { const v = q.get(k); return v === '1' || v === 'true' || v === 'yes'; };

  const peer = { host: '0.peerjs.com', port: 443, path: '/', secure: true, key: 'peerjs' };
  const ph = q.get('peerhost');
  if (ph && /^[A-Za-z0-9.\-:[\]]{1,100}$/.test(ph)) {
    peer.host = ph;
    const pageSecure = typeof location !== 'undefined' && location.protocol === 'https:';
    peer.secure = pageSecure;
    peer.port = pageSecure ? 443 : 80;
  }
  const pp = parseInt(q.get('peerport') || '', 10);
  if (pp > 0 && pp < 65536) peer.port = pp;
  const ppath = q.get('peerpath');
  if (ppath && /^\/[A-Za-z0-9_\-./]*$/.test(ppath)) peer.path = ppath.endsWith('/') ? ppath : ppath + '/';
  if (q.has('peersecure')) peer.secure = flag('peersecure');
  const pk = q.get('peerkey');
  if (pk && /^[A-Za-z0-9_-]{1,40}$/.test(pk)) peer.key = pk;

  let brokers = DEFAULT_BROKERS.slice();
  const mq = q.get('mqtt');
  if (mq) {
    const list = mq.split(',').map((s) => s.trim()).filter((s) => /^wss?:\/\/[^\s]+$/i.test(s));
    if (list.length) brokers = list;
  }

  const iceParam = q.get('ice');
  const ice = (iceParam === 'none' || (!iceParam && isLocalHost(peer.host))) ? [] : DEFAULT_ICE.slice();

  cached = {
    peer,
    ice,
    brokers,
    forceRelay: flag('forcerelay'),
    p2p: q.get('p2p') !== '0',
    auth: q.get('auth') !== '0',                 // ?auth=0: no relay authentication (tests only)
    p2pTimeout: P2P_TIMEOUT,
    ...overrides,
  };
  return cached;
}

// ---------------------------------------------------------------------------
// Ids and codes

const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randomFrom(alphabet, n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  let s = '';
  for (let i = 0; i < n; i++) s += alphabet[b[i] % alphabet.length];
  return s;
}

export function randomCode() { return randomFrom(CODE_ALPHABET, CODE_LEN); }
export function randomId(n = 12) { return randomFrom(ALNUM, n); }

const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LEN}}$`);

/** Uppercase / trim a user-typed code; returns null when it cannot be a room code. */
export function normalizeCode(code) {
  if (typeof code !== 'string') return null;
  const c = code.trim().toUpperCase().replace(/[\s-]/g, '');
  return CODE_RE.test(c) ? c : null;
}

export const roomPeerId = (code) => ROOM_PREFIX + code;
export const pubPeerId = (i) => PUB_PREFIX + i;
export const CID_RE = /^[A-Za-z0-9]{8,24}$/;

// ---------------------------------------------------------------------------
// Validation / sanitizing

// Control, format, surrogate, private-use, unassigned and line/paragraph separator chars.
const BAD_CHARS = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/gu;

export function sanitizeName(name, fallback) {
  let s = typeof name === 'string' ? name.slice(0, 64) : '';
  s = s.replace(BAD_CHARS, '').replace(/\s+/g, ' ').trim();
  const cps = Array.from(s);
  if (cps.length > NAME_MAX) s = cps.slice(0, NAME_MAX).join('').trim();
  return s || fallback;
}

export function sanitizeShip(ship, fallback = SHIP_ORDER[0]) {
  return typeof ship === 'string' && SHIP_ORDER.includes(ship) ? ship : fallback;
}

export const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
export const isInt = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;
export const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

/** Room info (probe answer / lobby announcement) shape check. */
export function validInfo(m) {
  return isObj(m) && isInt(m.v, 0, 1e6) && typeof m.gv === 'string' && m.gv.length <= 24 &&
    normalizeCode(m.code) === m.code && isInt(m.n, 0, MAX_PLAYERS) && isInt(m.max, 1, MAX_PLAYERS) &&
    isInt(m.slot, -1, PUB_SLOTS - 1);
}

/** Marker for inbound data that failed validation. */
export const BAD = Object.freeze({ _bad: 1 });

// JSON.parse makes "__proto__" an own data property (no pollution by itself), but a consumer
// that later Object.assign()s a message would hit the setter. Such keys are dropped at any
// depth; the reviver only runs when the text could contain one (literal or \u-escaped).
const PROTO_RISK = /__proto__|\\u/;
const dropProto = (k, v) => (k === '__proto__' ? undefined : v);

/** JSON.parse that strips "__proto__" keys; returns undefined on malformed input. */
export function safeJson(s) {
  try {
    return PROTO_RISK.test(s) ? JSON.parse(s, dropProto) : JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** Parse one inbound JSON message; returns a plain object or BAD. Never throws. */
export function parseMsg(s) {
  if (typeof s !== 'string' || s.length > MAX_IN) return BAD;
  const o = safeJson(s);
  return isObj(o) ? o : BAD;
}

/** UTF-8 byte length of a string (no allocation). */
export function utf8Len(s) {
  let n = s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) continue;
    if (c < 0x800) n += 1;
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { n += 2; i++; }
    else n += 2;
  }
  return n;
}

/** Serialize an outbound message; returns null if not an object or too large. */
export function encodeMsg(msg) {
  if (!isObj(msg)) return null;
  let s;
  try { s = JSON.stringify(msg); } catch { return null; }
  if (typeof s !== 'string') return null;
  if (s.length > MAX_MSG / 3 && utf8Len(s) > MAX_MSG) return null;
  return s;
}

// ---------------------------------------------------------------------------

/** Minimal event emitter; listener exceptions are contained (logged, not propagated). */
export class Emitter {
  constructor() { this._ev = new Map(); }
  on(ev, fn) {
    if (typeof fn !== 'function') return this;
    let s = this._ev.get(ev);
    if (!s) this._ev.set(ev, (s = new Set()));
    s.add(fn);
    return this;
  }
  off(ev, fn) {
    const s = this._ev.get(ev);
    if (s) { if (fn) s.delete(fn); else s.clear(); }
    return this;
  }
  _emit(ev, a, b) {
    const s = this._ev.get(ev);
    if (!s || !s.size) return;
    for (const fn of Array.from(s)) {
      try { fn(a, b); } catch (e) { console.error(e); }
    }
  }
}

/** Token bucket rate limiter. */
export class Bucket {
  constructor(rate, burst) {
    this.rate = rate / 1000;
    this.burst = burst;
    this.tokens = burst;
    this.t = performance.now();
    this.drops = 0;
  }
  take(n = 1) {
    const now = performance.now();
    this.tokens = Math.min(this.burst, this.tokens + (now - this.t) * this.rate);
    this.t = now;
    if (this.tokens >= n) { this.tokens -= n; return true; }
    this.drops++;
    return false;
  }
}

export const now = () => performance.now();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function netError(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}
