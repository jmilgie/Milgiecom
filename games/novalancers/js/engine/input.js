// Nova Lancers — input.
// Touch/pen/mouse: relative "trackpad" drag anywhere (finger never covers the ship).
// Keyboard: arrows/WASD move, Shift slow, X/K nova, C/L/Space overdrive, Esc/P pause.
// Gamepad: stick/d-pad move, B/Y nova, X/RT overdrive, LT slow, Start pause.
// On-screen buttons: #btnNova, #btnOver, #btnPause.

import { Haptics } from './haptics.js';

export class Input {
  constructor(renderer) {
    this.R = renderer;
    this.sensitivity = 1.25;
    this.enabled = false;         // gameplay input active (menus handle their own)
    this.dx = 0; this.dy = 0;     // accumulated relative drag (art px)
    this.keys = new Set();
    this.bombQ = false; this.overQ = false; this.pauseQ = false;
    this.dragId = null; this.lastX = 0; this.lastY = 0;
    this.touching = false;
    this.secondTap = null;        // for two-finger tap nova
    this.lastPointerType = 'mouse';
    this.usingTouch = false;
    this.gpPrev = {};
    this.onAnyInput = null;       // callback(kind) — used to unlock audio etc.
    this._bind();
  }

  _bind() {
    const target = window;
    const isUiTarget = (e) => {
      const t = e.target;
      return t && t.closest && (t.closest('#ui button, #ui input, #ui a, #ui select, #ui [data-interactive], .tbtn, .tbtn-small'));
    };

    target.addEventListener('pointerdown', (e) => {
      this.lastPointerType = e.pointerType;
      if (e.pointerType === 'touch') this.usingTouch = true;
      this.onAnyInput?.('pointer');
      if (!this.enabled || isUiTarget(e)) return;
      if (this.dragId === null) {
        this.dragId = e.pointerId;
        this.lastX = e.clientX; this.lastY = e.clientY;
        this.touching = true;
      } else if (e.pointerType === 'touch') {
        this.secondTap = { id: e.pointerId, t: performance.now(), x: e.clientX, y: e.clientY };
      }
    }, { passive: true });

    target.addEventListener('pointermove', (e) => {
      if (!this.enabled) return;
      if (e.pointerId === this.dragId) {
        // Coalesced events give smoother, lower-latency motion on high-rate touch screens.
        const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
        const list = evs && evs.length ? evs : [e];
        for (const ev of list) {
          const k = this.sensitivity / this.R.scale;
          this.dx += (ev.clientX - this.lastX) * k;
          this.dy += (ev.clientY - this.lastY) * k;
          this.lastX = ev.clientX; this.lastY = ev.clientY;
        }
      }
    }, { passive: true });

    const end = (e) => {
      if (e.pointerId === this.dragId) {
        this.dragId = null;
        this.touching = false;
      }
      if (this.secondTap && e.pointerId === this.secondTap.id) {
        const st = this.secondTap;
        this.secondTap = null;
        const moved = Math.hypot(e.clientX - st.x, e.clientY - st.y);
        if (this.enabled && performance.now() - st.t < 280 && moved < 24) this.bombQ = true;
      }
    };
    target.addEventListener('pointerup', end, { passive: true });
    target.addEventListener('pointercancel', end, { passive: true });

    // Prevent iOS double-tap zoom / scroll while playing.
    document.addEventListener('touchmove', (e) => { if (this.enabled) e.preventDefault(); }, { passive: false });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => { if (this.enabled) e.preventDefault(); });

    window.addEventListener('keydown', (e) => {
      this.onAnyInput?.('key');
      this.usingTouch = false;
      const k = e.key.toLowerCase();
      if (this.enabled && ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(k);
      if (!this.enabled) return;
      if (k === 'x' || k === 'k' || k === 'b') this.bombQ = true;
      if (k === 'c' || k === 'l' || k === ' ' || k === 'v') this.overQ = true;
      if (k === 'escape' || k === 'p') this.pauseQ = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => { this.keys.clear(); this.dragId = null; this.touching = false; });

    const btn = (id, fn) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        this.onAnyInput?.('pointer');
        if (!this.enabled) return;
        fn();
        Haptics.play('tap');
      });
      el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
    };
    btn('btnNova', () => { this.bombQ = true; });
    btn('btnOver', () => { this.overQ = true; });
    btn('btnPause', () => { this.pauseQ = true; });
  }

  // Polls the gamepad and returns this tick's intent. Relative drag is consumed.
  read() {
    let ax = 0, ay = 0, slow = false;
    const K = this.keys;
    if (K.has('arrowleft') || K.has('a')) ax -= 1;
    if (K.has('arrowright') || K.has('d')) ax += 1;
    if (K.has('arrowup') || K.has('w')) ay -= 1;
    if (K.has('arrowdown') || K.has('s')) ay += 1;
    if (K.has('shift')) slow = true;

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
      const lx = gp.axes[0] || 0, ly = gp.axes[1] || 0;
      const dz = 0.18;
      if (Math.abs(lx) > dz) ax += (lx - Math.sign(lx) * dz) / (1 - dz);
      if (Math.abs(ly) > dz) ay += (ly - Math.sign(ly) * dz) / (1 - dz);
      if (b(14)) ax -= 1; if (b(15)) ax += 1; if (b(12)) ay -= 1; if (b(13)) ay += 1;
      if (b(6) || b(4)) slow = true;
      const edge = (i) => b(i) && !this.gpPrev[gp.index + ':' + i];
      if (this.enabled) {
        if (edge(1) || edge(3)) this.bombQ = true;
        if (edge(2) || edge(7) || edge(5)) this.overQ = true;
        if (edge(9)) this.pauseQ = true;
      }
      for (let i = 0; i < gp.buttons.length; i++) this.gpPrev[gp.index + ':' + i] = b(i);
      if (Math.abs(lx) > 0.5 || Math.abs(ly) > 0.5) this.usingTouch = false;
    }
    const len = Math.hypot(ax, ay);
    if (len > 1) { ax /= len; ay /= len; }

    const out = {
      dx: this.dx, dy: this.dy, ax, ay, slow,
      touching: this.touching,
      bomb: this.bombQ, overdrive: this.overQ, pause: this.pauseQ,
    };
    this.dx = 0; this.dy = 0;
    this.bombQ = false; this.overQ = false; this.pauseQ = false;
    return out;
  }

  setEnabled(v) {
    this.enabled = v;
    if (!v) { this.dragId = null; this.touching = false; this.dx = this.dy = 0; }
  }
}
