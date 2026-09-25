// Nova Lancers — WebRTC data-channel transport (PeerJS, vendored UMD build, loaded lazily).

import { netConfig, randomId, parseMsg, BAD, MAX_IN, NS, netError } from './common.js';

let loadPromise = null;

/** Load vendor/peerjs.min.js once (the promise is reused; a failed load can be retried). */
export function loadPeerJS() {
  if (typeof window === 'undefined') return Promise.reject(netError('NETWORK'));
  if (window.Peer) return Promise.resolve(window.Peer);
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    if (typeof RTCPeerConnection === 'undefined') { reject(netError('NETWORK')); return; }
    const s = document.createElement('script');
    s.src = new URL('../../vendor/peerjs.min.js', import.meta.url).href;
    s.async = true;
    const fail = () => {
      clearTimeout(timer);
      loadPromise = null;
      s.remove();
      reject(netError('NETWORK'));
    };
    const timer = setTimeout(fail, 20000);
    s.onload = () => {
      clearTimeout(timer);
      const ok = window.Peer && !(window.peerjs && window.peerjs.util &&
        window.peerjs.util.supports && window.peerjs.util.supports.data === false);
      if (ok) resolve(window.Peer); else fail();
    };
    s.onerror = fail;
    document.head.appendChild(s);
  });
  return loadPromise;
}

const dec = new TextDecoder();

/**
 * Harden a PeerJS DataConnection: replace its JSON decode path with a bounded,
 * exception-safe one (a hostile peer can't throw inside PeerJS) and let send() accept
 * pre-serialized JSON strings, so a broadcast is stringified once for all peers.
 */
function patchConn(conn, deliver) {
  if (typeof conn._handleDataMessage === 'function') {
    conn._handleDataMessage = (ev) => {
      const d = ev && ev.data;
      let obj = BAD;
      try {
        if (d instanceof ArrayBuffer) { if (d.byteLength <= MAX_IN) obj = parseMsg(dec.decode(d)); }
        else if (typeof d === 'string') obj = parseMsg(d);
      } catch { obj = BAD; }
      const pd = obj.__peerData;
      if (pd !== undefined) {
        if (pd && pd.type === 'close') conn.close();
        return;
      }
      deliver(obj);
    };
  } else {
    conn.on('data', (o) => deliver(o));
  }
  conn.stringify = (x) => (typeof x === 'string' ? x : JSON.stringify(x));
}

/** A host<->client channel over a PeerJS DataConnection. */
export class P2PLink {
  constructor(conn) {
    this.kind = 'p2p';
    this.conn = conn;
    this.open = !!conn.open;
    this.closed = false;
    this.slot = null;
    this.onmessage = null;  // (obj) => void
    this.onclose = null;    // () => void
    this.onopen = null;
    patchConn(conn, (obj) => { if (!this.closed && this.onmessage) this.onmessage(obj); });
    conn.on('open', () => {
      if (this.closed) return;
      this.open = true;
      this._watchPc();
      if (this.onopen) this.onopen();
    });
    conn.on('close', () => this._gone());
    conn.on('error', () => {}); // fatal errors are followed by 'close'
    if (this.open) this._watchPc();
  }

  _watchPc() {
    const pc = this.conn.peerConnection;
    if (!pc || this._pcWatched) return;
    this._pcWatched = true;
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this._gone();
    });
  }

  /** Remote description received => the remote peer exists and answered our offer. */
  get answered() {
    const pc = this.conn.peerConnection;
    return !!(pc && pc.remoteDescription);
  }

  sendRaw(str) {
    if (!this.open || this.closed) return false;
    const dc = this.conn.dataChannel;
    if (!dc || dc.readyState !== 'open') return false;
    try { this.conn.send(str); return true; } catch { return false; }
  }

  _gone() {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    try { this.conn.close(); } catch { /* ignore */ }
    if (this.onclose) this.onclose();
  }

  /** Close. graceful: close the data channel first so queued messages flush. */
  close(graceful = false) {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.onmessage = null;
    const conn = this.conn;
    const dc = conn.dataChannel;
    if (graceful && dc && dc.readyState === 'open') {
      try { dc.close(); } catch { /* ignore */ }
      setTimeout(() => { try { conn.close(); } catch { /* ignore */ } }, 1000);
    } else {
      try { conn.close(); } catch { /* ignore */ }
    }
  }
}

/**
 * One registered PeerJS identity (a Peer) with error routing for outgoing connects.
 * Events: onconnection(link), ondisconnected(), onfatal()
 */
export class P2PEndpoint {
  constructor(peer) {
    this.peer = peer;
    this.id = peer.id;
    this.destroyed = false;
    this.onconnection = null;
    this.ondisconnected = null;
    this._connects = new Map(); // remote id -> fail(code)
    peer.on('error', (e) => this._onError(e));
    peer.on('connection', (conn) => {
      if (this.destroyed) { try { conn.close(); } catch { /* ignore */ } return; }
      if (conn.serialization !== 'json') { try { conn.close(); } catch { /* ignore */ } return; }
      const link = new P2PLink(conn);
      if (this.onconnection) this.onconnection(link); else link.close();
    });
    peer.on('disconnected', () => {
      if (!this.destroyed && this.ondisconnected) this.ondisconnected();
    });
  }

  get signaling() { return !this.destroyed && !!this.peer.open; }

  _onError(e) {
    const type = e && e.type;
    if (type === 'peer-unavailable') {
      const m = /(\S+)$/.exec(String(e.message || ''));
      const fail = m && this._connects.get(m[1]);
      if (fail) fail('UNAVAILABLE');
    } else if (type === 'network' || type === 'server-error' || type === 'socket-error' ||
               type === 'socket-closed' || type === 'browser-incompatible' || type === 'webrtc') {
      for (const fail of Array.from(this._connects.values())) fail('NETWORK');
    }
  }

  /**
   * Open a data connection to remoteId. Returns { link, done } where done resolves with
   * the open link or rejects Error('UNAVAILABLE'|'TIMEOUT'|'NETWORK'|'FAILED').
   */
  connect(remoteId, timeoutMs = 6000) {
    let conn;
    try {
      conn = this.peer.connect(remoteId, { serialization: 'json', reliable: true });
    } catch {
      conn = null;
    }
    if (!conn) return { link: null, done: Promise.reject(netError('NETWORK')) };
    const link = new P2PLink(conn);
    const done = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this._connects.get(remoteId) === fail) this._connects.delete(remoteId);
        link.onopen = null;
        link.onclose = null;
        if (err) { link.close(); reject(netError(err)); } else resolve(link);
      };
      const fail = (code) => finish(code);
      const timer = setTimeout(() => finish('TIMEOUT'), timeoutMs);
      this._connects.set(remoteId, fail);
      link.onopen = () => finish(null);
      link.onclose = () => finish('FAILED');
      if (this.destroyed || !this.peer.open) finish('NETWORK');
    });
    return { link, done };
  }

  /** Re-register with the signaling server after a drop (keeps existing connections). */
  reconnect() {
    if (this.destroyed || !this.peer.disconnected) return;
    try { this.peer.reconnect(); } catch { /* ignore */ }
  }

  /** Leave the signaling server but keep data connections alive. */
  disconnectSignaling() {
    if (this.destroyed) return;
    try { this.peer.disconnect(); } catch { /* ignore */ }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const fail of Array.from(this._connects.values())) fail('NETWORK');
    try { this.peer.destroy(); } catch { /* ignore */ }
  }
}

/**
 * Register a PeerJS identity (random client id when id is null).
 * Resolves a P2PEndpoint; rejects Error('ID_TAKEN'|'NETWORK').
 */
export async function openEndpoint(id, timeoutMs = 8000) {
  const cfg = netConfig();
  if (!cfg.p2p) throw netError('NETWORK');
  const Peer = await loadPeerJS();
  return new Promise((resolve, reject) => {
    let peer;
    try {
      peer = new Peer(id || `${NS}-c-${randomId(12)}`, {
        host: cfg.peer.host,
        port: cfg.peer.port,
        path: cfg.peer.path,
        secure: cfg.peer.secure,
        key: cfg.peer.key,
        config: { iceServers: cfg.ice },
        debug: 0,
      });
    } catch {
      reject(netError('NETWORK'));
      return;
    }
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      peer.off('open', onOpen);
      peer.off('error', onErr);
      if (err) {
        try { peer.destroy(); } catch { /* ignore */ }
        reject(netError(err));
      } else {
        resolve(new P2PEndpoint(peer));
      }
    };
    const onOpen = () => finish(null);
    const onErr = (e) => finish(e && e.type === 'unavailable-id' ? 'ID_TAKEN' : 'NETWORK');
    const timer = setTimeout(() => finish('NETWORK'), timeoutMs);
    peer.on('open', onOpen);
    peer.on('error', onErr);
  });
}
