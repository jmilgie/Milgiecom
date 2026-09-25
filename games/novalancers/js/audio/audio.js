// Nova Lancers — shared audio core.
// One AudioContext, a master chain (bus -> compressor/limiter -> destination) and two
// sub-buses (sfx, music). sfx.js and music.js build on top of this.

const store = (() => { try { return window.localStorage; } catch { return null; } })();

export const AudioSys = {
  ctx: null,
  master: null,     // GainNode: master volume
  sfxBus: null,     // GainNode: all sound effects connect here
  musicBus: null,   // GainNode: all music connects here
  limiter: null,    // DynamicsCompressorNode acting as a soft limiter
  unlocked: false,
  volumes: { master: 0.9, sfx: 0.85, music: 0.7 },
  _listeners: [],

  init() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      this.ctx = new AC({ latencyHint: 'interactive' });
    } catch {
      this.ctx = new AC();
    }
    const ctx = this.ctx;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.18;
    this.master = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.master.connect(this.limiter);
    this.limiter.connect(ctx.destination);
    try {
      const saved = JSON.parse(store?.getItem('nvl-volumes') || 'null');
      if (saved) Object.assign(this.volumes, saved);
    } catch { /* ignore */ }
    this._applyVolumes();
    // iOS 17+: let game audio play even when the ring/silent switch is set to silent.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* ignore */ }
    return ctx;
  },

  // Must be called from inside a user gesture handler (touchend/click/keydown).
  unlock() {
    const ctx = this.init();
    if (!ctx) return;
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    if (!this.unlocked) {
      // Play one silent sample: required by older iOS to fully unlock output.
      try {
        const b = ctx.createBuffer(1, 1, 22050);
        const s = ctx.createBufferSource();
        s.buffer = b; s.connect(ctx.destination); s.start(0);
      } catch { /* ignore */ }
      this.unlocked = true;
      for (const fn of this._listeners) { try { fn(); } catch (e) { console.error(e); } }
      this._listeners.length = 0;
    }
  },

  onUnlock(fn) { if (this.unlocked) fn(); else this._listeners.push(fn); },

  setVolume(kind, v) {
    this.volumes[kind] = Math.max(0, Math.min(1, v));
    this._applyVolumes();
    try { store?.setItem('nvl-volumes', JSON.stringify(this.volumes)); } catch { /* ignore */ }
  },

  _applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // perceptual curve
    const curve = (v) => v * v;
    this.master.gain.setTargetAtTime(curve(this.volumes.master), t, 0.02);
    this.sfxBus.gain.setTargetAtTime(curve(this.volumes.sfx), t, 0.02);
    this.musicBus.gain.setTargetAtTime(curve(this.volumes.music), t, 0.02);
  },

  // Suspend when the tab is hidden (saves battery on phones), resume when visible.
  setPaused(paused) {
    if (!this.ctx) return;
    if (paused) this.ctx.suspend().catch(() => {});
    else if (this.unlocked) this.ctx.resume().catch(() => {});
  },

  get now() { return this.ctx ? this.ctx.currentTime : 0; },
};
