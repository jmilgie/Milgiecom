// Nova Lancers — small crypto toolkit for the multiplayer relay.
//
// Relay traffic travels through public MQTT brokers where anyone can subscribe and publish,
// so every relay envelope is authenticated with a per-player key:
//   * sync SHA-256 / HMAC-SHA256 (pure JS): envelopes are signed and checked inline, in
//     order, even from a pagehide handler (WebCrypto's promises would reorder / never run);
//   * ECDH P-256 through WebCrypto (async, secure contexts only) to agree on that key over
//     the public broker. P2P joiners get their key inside the (DTLS-encrypted) welcome.
//
// Key schedule (K = 32-byte per-player master key shared by the host and that client):
//   link keys for epoch e:  c2h = HMAC(K, 'c2h|e'), h2c = HMAC(K, 'h2c|e')
//   rebind proof:           HMAC(K, 'rebind|<cid>|<e>')   (e strictly increases per rebind)
// Tags are HMAC outputs truncated to 128 bits, base64url (22 chars).

const IV = new Int32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);
const KT = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const W = new Int32Array(64);

/** Compress every whole 64-byte block of bytes[off, end) into state h (Int32Array(8)). */
function blocks(h, bytes, off, end) {
  let h0 = h[0], h1 = h[1], h2 = h[2], h3 = h[3], h4 = h[4], h5 = h[5], h6 = h[6], h7 = h[7];
  for (let p = off; p + 64 <= end; p += 64) {
    for (let i = 0; i < 16; i++) {
      const j = p + i * 4;
      W[i] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15], b = W[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, k = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (k + S1 + ((e & f) ^ (~e & g)) + KT[i] + W[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + k) | 0;
  }
  h[0] = h0; h[1] = h1; h[2] = h2; h[3] = h3; h[4] = h4; h[5] = h5; h[6] = h6; h[7] = h7;
}

/**
 * Hash the rest of a message: `h` already absorbed `prior` bytes (a multiple of 64);
 * `bytes` is the remainder. Returns the 32-byte digest (h is consumed).
 */
function finish(h, prior, bytes) {
  const n = bytes.length;
  const whole = n - (n % 64);
  blocks(h, bytes, 0, whole);
  const rem = n - whole;
  const tail = new Uint8Array(rem < 56 ? 64 : 128);
  tail.set(bytes.subarray(whole));
  tail[rem] = 0x80;
  const bits = (prior + n) * 8;
  const hi = Math.floor(bits / 0x100000000), lo = bits >>> 0;
  const t = tail.length;
  tail[t - 8] = hi >>> 24; tail[t - 7] = hi >>> 16; tail[t - 6] = hi >>> 8; tail[t - 5] = hi;
  tail[t - 4] = lo >>> 24; tail[t - 3] = lo >>> 16; tail[t - 2] = lo >>> 8; tail[t - 1] = lo;
  blocks(h, tail, 0, t);
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = h[i] >>> 24; out[i * 4 + 1] = h[i] >>> 16; out[i * 4 + 2] = h[i] >>> 8; out[i * 4 + 3] = h[i];
  }
  return out;
}

const te = new TextEncoder();
const bytesOf = (x) => (typeof x === 'string' ? te.encode(x) : x);

/** SHA-256 of a Uint8Array or string (UTF-8). */
export function sha256(data) {
  return finish(IV.slice(), 0, bytesOf(data));
}

/** HMAC-SHA256 with the key schedule precomputed (one extra block per message). */
export class Hmac {
  constructor(key) {
    let k = bytesOf(key);
    if (k.length > 64) k = sha256(k);
    const ipad = new Uint8Array(64).fill(0x36), opad = new Uint8Array(64).fill(0x5c);
    for (let i = 0; i < k.length; i++) { ipad[i] ^= k[i]; opad[i] ^= k[i]; }
    this.inner = IV.slice();
    blocks(this.inner, ipad, 0, 64);
    this.outer = IV.slice();
    blocks(this.outer, opad, 0, 64);
  }
  mac(data) {
    const ih = finish(this.inner.slice(), 64, bytesOf(data));
    return finish(this.outer.slice(), 64, ih);
  }
  /** 128-bit truncated tag, base64url. */
  tag(data) { return b64u(this.mac(data).subarray(0, 16)); }
}

// ---------------------------------------------------------------------------
// Encoding helpers

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_INV = new Int16Array(128).fill(-1);
for (let i = 0; i < 64; i++) B64_INV[B64.charCodeAt(i)] = i;

export function b64u(bytes) {
  let s = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    s += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  if (i < bytes.length) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8);
    s += B64[n >> 18] + B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) s += B64[(n >> 6) & 63];
  }
  return s;
}

/** Decode base64url (no padding); null if malformed. */
export function unb64u(s) {
  if (typeof s !== 'string' || s.length % 4 === 1 || s.length > 4096) return null;
  const out = new Uint8Array(Math.floor(s.length * 3 / 4));
  let o = 0, acc = 0, bits = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? B64_INV[c] : -1;
    if (v < 0) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 255; }
  }
  return out;
}

export function hex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  return s;
}

export function randomBytes(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

// ---------------------------------------------------------------------------
// Keys

/** Per-epoch link keys for relay envelopes (both directions). */
export class LinkAuth {
  constructor(K, epoch) {
    const h = new Hmac(K);
    this.epoch = epoch;
    this.c2h = new Hmac(h.mac(`c2h|${epoch}`));
    this.h2c = new Hmac(h.mac(`h2c|${epoch}`));
  }
}

/** Proof that a (re)binding hello comes from the holder of K, for this cid and epoch. */
export function rebindProof(K, cid, epoch) {
  return new Hmac(K).tag(`rebind|${cid}|${epoch}`);
}

/** Constant-time-ish string comparison for tags. */
export function sameTag(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const subtle = typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : null;

/** WebCrypto ECDH is available (secure contexts: https, localhost). */
export function hasECDH() {
  return !!(subtle && typeof subtle.deriveBits === 'function');
}

/** Fresh ECDH P-256 key pair -> { priv: CryptoKey, pub: base64url(raw public point) } or null. */
export async function ecdhKeyPair() {
  if (!hasECDH()) return null;
  try {
    const kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    const raw = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
    return { priv: kp.privateKey, pub: b64u(raw) };
  } catch {
    return null;
  }
}

/**
 * Master key for a relay player: HMAC('nvl1/ecdh', ECDH(priv, peerPub)) bound to its cid.
 * Returns a 32-byte Uint8Array, or null if the peer key is malformed / ECDH is unavailable.
 */
export async function ecdhMaster(priv, peerPub, cid) {
  const raw = unb64u(peerPub);
  if (!hasECDH() || !priv || !raw || raw.length !== 65 || raw[0] !== 4) return null;
  try {
    const pub = await subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256));
    return new Hmac('nvl1/ecdh').mac(concat(shared, te.encode(`|${cid}`)));
  } catch {
    return null;
  }
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
