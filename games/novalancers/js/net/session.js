// Nova Lancers — multiplayer sessions (DESIGN.md §9). Public API of js/net.
//
// Star topology: the host is the hub. Each client reaches the host either over a WebRTC
// data channel (PeerJS, P2P) or through the MQTT relay; the host always listens on both,
// so rooms can be mixed. Session semantics are identical for both transports.
//
//   hostSession({ name, ship, isPublic }, { signal }?)  -> Session (host)
//   joinSession(code, { name, ship }, { signal }?)      -> Session (client)
//        rejects Error('ROOM_NOT_FOUND'|'ROOM_FULL'|'ALREADY_STARTED'|'NETWORK'|'VERSION'|'ABORTED')
//   quickMatch({ name, ship }, { signal }?)             -> Session (host or client of a public room)
//   makeInviteUrl(code), parseRoomFromUrl()
//
// Only one connection attempt runs at a time: starting a new one (or aborting `signal`)
// cancels a pending one, which rejects with Error('ABORTED') — so a player who backs out
// and tries again never ends up with a stray second session.
//
// Wire format: JSON objects. Session internals carry a string `_` field (hello, welcome,
// lobby, ping, ...); anything without `_` is a game message and is surfaced through the
// 'message' event. Game messages must therefore not use a top-level `_` key.
// Modules: host.js (HostSession), client.js (ClientSession, Joiner), relay.js + mqtt.js
// (MQTT relay), p2p.js (PeerJS), auth.js (relay authentication), common.js, base.js.

import {
  INVITE_BASE, netConfig, configureNet, randomCode, normalizeCode, roomPeerId, pubPeerId,
  sleep, netError, validInfo, PROTO, VERSION,
} from './common.js';
import { openEndpoint, loadPeerJS } from './p2p.js';
import { RelayHub } from './relay.js';
import { ecdhKeyPair } from './auth.js';
import { HostSession, scanPubSlots } from './host.js';
import { Joiner, ERR_CODES } from './client.js';

export { configureNet, netConfig, loadPeerJS };

// ---------------------------------------------------------------------------
// One attempt at a time (+ AbortSignal support)

class Attempt {
  constructor() {
    this.aborted = false;
    this.hooks = new Set();
  }
  onAbort(fn) {
    if (this.aborted) { fn(); return () => {}; }
    this.hooks.add(fn);
    return () => this.hooks.delete(fn);
  }
  abort() {
    if (this.aborted) return;
    this.aborted = true;
    for (const fn of Array.from(this.hooks)) { try { fn(); } catch { /* ignore */ } }
    this.hooks.clear();
  }
}

let current = null;

function guarded(signal, run) {
  if (current) current.abort();
  const at = new Attempt();
  current = at;
  return new Promise((resolve, reject) => {
    let settled = false;
    const onSignal = () => at.abort();
    const finish = () => {
      settled = true;
      if (current === at) current = null;
      if (signal) signal.removeEventListener('abort', onSignal);
    };
    at.onAbort(() => { if (!settled) { finish(); reject(netError('ABORTED')); } });
    if (signal) {
      if (signal.aborted) { at.abort(); return; }
      signal.addEventListener('abort', onSignal);
    }
    Promise.resolve().then(() => run(at)).then((s) => {
      // Resolved after being aborted / superseded: nobody wants this session any more.
      if (settled) { if (s && !s.closed) s._shutdown('LEFT', true, false); return; }
      finish();
      resolve(s);
    }, (e) => {
      if (settled) return;
      finish();
      reject(e);
    });
  });
}

/** Run a Joiner under an attempt (aborting it cancels the join). */
function runJoiner(j, at) {
  const off = at.onAbort(() => j.abort());
  return j.run().finally(off);
}

// ---------------------------------------------------------------------------
// Hosting

async function createHost({ name, ship, isPublic, pubEP = null, pubSlot = -1, tentative = false, p2p = true }) {
  const cfg = netConfig();
  const keyP = cfg.auth ? ecdhKeyPair() : Promise.resolve(null);
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
    const ecdh = await keyP;
    return new HostSession({ code, name, ship, isPublic, pubEP, pubSlot, tentative, roomEP, hub, ecdh });
  }
  if (pubEP) pubEP.destroy();
  throw netError('NETWORK');
}

/** Host a room. Resolves once the room is reachable over P2P and/or the relay. */
export function hostSession({ name, ship, isPublic = false } = {}, { signal } = {}) {
  return guarded(signal, async () => {
    const cfg = netConfig();
    let scan = null;
    if (isPublic && cfg.p2p) scan = await scanPubSlots();
    return createHost({
      name, ship, isPublic: !!isPublic, pubEP: scan ? scan.ep : null, pubSlot: scan ? scan.slot : -1,
      p2p: !isPublic || !!scan,
    });
  });
}

/** Join a room by code (P2P first, relay fallback). */
export function joinSession(code, { name, ship } = {}, { signal } = {}) {
  const c = normalizeCode(code);
  if (!c) return Promise.reject(netError('ROOM_NOT_FOUND'));
  return guarded(signal, (at) => runJoiner(new Joiner(c, { name, ship }), at));
}

// ---------------------------------------------------------------------------
// Quick match
//
// 1. Take the lowest free public slot id nvl1-pub-<0..11> (registration scan) and open a
//    *tentative* public room on it right away, so concurrent seekers can find us.
// 2. Discover for ~2.6 s: probe (up to 4 of) the taken slots below ours over P2P and listen
//    to relay lobby announcements (every public host announces there; also covers hosts
//    without PeerJS and the case where signaling is down).
// 3. Announcements travel over a public broker where anyone can publish, so each announced
//    room is verified with a relay probe (it must answer); only rooms that answered a P2P
//    or relay probe are ever joined.
// 4. Try the best room while our own room stays open: established before tentative, then
//    fuller, lower slot, code. Two tentative seekers break the tie deterministically: the
//    "larger" one yields. If someone joins us meanwhile we stay host; if the join fails we
//    try the next candidate and otherwise stay host.

const MAX_PROBES = 4;          // P2P probes of taken public slots
const MAX_VERIFY = 6;          // relay probes of announced rooms
const keyOf = (i) => [i.tent ? 1 : 0, -i.n, i.slot >= 0 ? i.slot : 99, i.code];
function cmpKey(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

function joinableInfo(m) {
  return validInfo(m) && m.v === PROTO && m.gv === VERSION && !m.st && m.n < m.max;
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

function pickCandidate(cands, selfKey, tried) {
  let best = null, bestKey = null;
  for (const c of cands.values()) {
    if (tried.has(c.info.code) || !(c.link || c.verified) || !joinableInfo(c.info)) continue;
    const k = keyOf(c.info);
    if (c.info.tent && cmpKey(k, selfKey) >= 0) continue; // they yield to us
    if (!best || cmpKey(k, bestKey) < 0 || (cmpKey(k, bestKey) === 0 && c.link && !best.link)) { best = c; bestKey = k; }
  }
  return best;
}

/**
 * Join `c` while our tentative room stays open. Resolves { s } (joined), { guest: true }
 * (someone joined our room first; the join is abandoned) or { e } (join failed).
 */
function joinWhileHosting(host, c, name, ship, seekEP, at) {
  return new Promise((resolve) => {
    let over = false;
    const pre = c.link && seekEP ? { link: c.link, ep: seekEP } : null;
    if (c.link && !pre) c.link.close();
    c.link = null;
    const j = new Joiner(c.info.code, { name, ship }, pre);
    const onGuest = () => {
      if (over) return;
      over = true;
      host.off('peerjoin', onGuest);
      j.abort();
      resolve({ guest: true });
    };
    host.on('peerjoin', onGuest);
    runJoiner(j, at).then((s) => {
      if (over) { s._shutdown('LEFT', true, false); return; }
      over = true;
      host.off('peerjoin', onGuest);
      resolve({ s });
    }, (e) => {
      if (over) return;
      over = true;
      host.off('peerjoin', onGuest);
      resolve({ e });
    });
  });
}

async function quickAttempt(name, ship, last, at) {
  const cfg = netConfig();
  const useP2P = cfg.p2p && !cfg.forceRelay;
  let scan = null, seekEP = null;
  if (useP2P) {
    [scan, seekEP] = await Promise.all([scanPubSlots(), openEndpoint(null).catch(() => null)]);
  }
  const dropSeek = () => { if (seekEP) { seekEP.destroy(); seekEP = null; } };
  if (at.aborted) { if (scan && scan.ep) scan.ep.destroy(); dropSeek(); return null; }
  let host;
  try {
    host = await createHost({
      name, ship, isPublic: true, pubEP: scan ? scan.ep : null, pubSlot: scan ? scan.slot : -1, tentative: !last,
      p2p: !useP2P || !!scan, // the slot scan already showed signaling is down: go relay-only
    });
  } catch (e) {
    dropSeek();
    throw e;
  }
  if (at.aborted) { dropSeek(); return host; } // the attempt wrapper closes it
  if (last) { dropSeek(); return host; }

  const selfKey = keyOf({ tent: 1, n: 1, slot: host.pubSlot, code: host.code });
  const cands = new Map();
  const verifying = [];
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
      cands.set(info.code, { info, link, verified: true });
      if (!info.tent) wake(); // an established room answered over P2P: take it now
    } else if (prev) {
      if (!prev.verified) prev.info = info;
    } else {
      const c = { info, link: null, verified: false };
      cands.set(info.code, c);
      if (host.hub && verifying.length < MAX_VERIFY) {
        verifying.push(host.hub.probeRoom(info.code).then((real) => {
          if (real && real.pub && !c.link) { c.info = real; c.verified = true; }
        }));
      }
    }
  };
  if (host.hub) host.hub.listenLobby((a) => { if (a._ === 'ann') consider(a, null); });
  const probeIds = seekEP && scan ? scan.taken.slice(0, MAX_PROBES) : [];
  const probes = probeIds.map((i) => probeSlot(seekEP, i).then((r) => { if (r) consider(r.info, r.link); }));
  await Promise.race([early, Promise.all([sleep(2600), Promise.all(probes)])]);
  decided = true;
  if (host.hub) host.hub.stopLobby();
  await Promise.all(verifying); // each settles within 1.5 s of its announcement

  const closeCands = () => { for (const c of cands.values()) if (c.link) { c.link.close(); c.link = null; } };
  const tried = new Set();
  while (!host.closed && !at.aborted && host._count() === 1) {
    const best = pickCandidate(cands, selfKey, tried);
    if (!best) break;
    tried.add(best.info.code);
    const usesSeek = !!(best.link && seekEP);
    if (usesSeek) { for (const c of cands.values()) if (c !== best && c.link) { c.link.close(); c.link = null; } }
    const r = await joinWhileHosting(host, best, name, ship, usesSeek ? seekEP : null, at);
    if (usesSeek) seekEP = null; // owned (and destroyed on failure) by that Joiner now
    if (r.s) {
      if (host._count() > 1 || host.closed) { r.s._shutdown('LEFT', true, false); break; } // keep our squad
      closeCands();
      dropSeek();
      host._shutdown('LEFT', true, false); // abandon our tentative room silently
      return r.s;
    }
    if (r.e && (r.e.message === 'ABORTED' || !ERR_CODES.includes(r.e.message))) break;
  }
  closeCands();
  dropSeek();
  if (host.closed) return null;
  host._settle();
  return host;
}

/** Join an open public room, or host one and wait. */
export function quickMatch({ name, ship } = {}, { signal } = {}) {
  return guarded(signal, async (at) => {
    for (let attempt = 0; attempt < 3 && !at.aborted; attempt++) {
      const s = await quickAttempt(name, ship, attempt === 2, at);
      if (s) return s;
    }
    throw netError(at.aborted ? 'ABORTED' : 'NETWORK');
  });
}

// ---------------------------------------------------------------------------
// Invite links

// Test-server overrides are carried into invites made off milgie.com, so a second device
// opening the link talks to the same (local) signaling server / brokers.
const CARRY_PARAMS = ['peerhost', 'peerport', 'peerpath', 'peersecure', 'peerkey', 'mqtt', 'ice', 'p2p', 'auth'];

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
