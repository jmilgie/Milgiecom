// Nova Lancers — Session base class, page-lifecycle hooks and lobby validation shared by
// the host (host.js) and client (client.js) sessions.

import {
  MAX_PLAYERS, Emitter, isObj, isInt, isNum, sanitizeName, sanitizeShip, now,
} from './common.js';

const TRANSPORTS = ['host', 'p2p', 'relay'];

// ---------------------------------------------------------------------------
// Page lifecycle: close sessions on pagehide, tell peers when we go to the background,
// re-check connections as soon as the device changes network.

const LIVE = new Set();
let hooked = false;

function hookLifecycle() {
  if (hooked || typeof window === 'undefined') return;
  hooked = true;
  const each = (fn) => { for (const s of Array.from(LIVE)) fn(s); };
  window.addEventListener('pagehide', () => each((s) => s._shutdown('LEFT', true, true)));
  document.addEventListener('visibilitychange', () => each((s) => s._onVisibility(document.hidden)));
  const changed = () => each((s) => s._netChanged());
  window.addEventListener('online', changed);
  const c = typeof navigator !== 'undefined' ? navigator.connection : null;
  if (c && typeof c.addEventListener === 'function') c.addEventListener('change', changed);
}

export class Session extends Emitter {
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
  _netChanged() {}
}

// ---------------------------------------------------------------------------
// Validation of lobby snapshots coming off the wire.

export function normLobby(l) {
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
      transport: TRANSPORTS.includes(p.transport) ? p.transport : 'p2p',
    });
  }
  players.sort((a, b) => a.slot - b.slot);
  return { players, started: l.started === true };
}
