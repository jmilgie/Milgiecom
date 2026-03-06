const AudioCtor = window.AudioContext || window.webkitAudioContext;

const THEME_NAMES = ['town', 'moss', 'reservoir', 'echo', 'forge', 'market', 'archive', 'boss'];
const THEME_ASSETS = Object.fromEntries(
  THEME_NAMES.map((theme) => [theme, new URL(`../assets/audio/${theme}.wav`, import.meta.url)]),
);

const THEME_SCORES = {
  town: {
    stepMs: 420,
    chords: [
      [220, 277, 330],
      [247, 311, 370],
      [196, 247, 330],
      [220, 277, 392],
    ],
    lead: [659, null, 784, 659, 587, null, 523, 494],
    bass: [110, 110, 123, 123, 98, 98, 110, 123],
    noise: 1200,
  },
  moss: {
    stepMs: 400,
    chords: [
      [174, 220, 261],
      [196, 247, 293],
      [165, 208, 261],
      [174, 220, 329],
    ],
    lead: [329, 392, null, 349, 329, 294, null, 261],
    bass: [87, 87, 98, 98, 82, 82, 87, 98],
    noise: 700,
  },
  reservoir: {
    stepMs: 360,
    chords: [
      [196, 247, 294],
      [220, 277, 330],
      [196, 262, 330],
      [175, 220, 294],
    ],
    lead: [392, 440, 494, null, 440, 392, 330, null],
    bass: [98, 110, 98, 87, 98, 110, 98, 87],
    noise: 1600,
  },
  echo: {
    stepMs: 340,
    chords: [
      [165, 208, 247],
      [185, 233, 277],
      [208, 247, 311],
      [185, 233, 294],
    ],
    lead: [523, 587, 659, 698, 659, 587, 523, 466],
    bass: [82, 93, 104, 93, 82, 93, 104, 93],
    noise: 900,
  },
  forge: {
    stepMs: 320,
    chords: [
      [130, 164, 196],
      [146, 185, 220],
      [130, 174, 220],
      [123, 164, 207],
    ],
    lead: [392, null, 440, 392, 349, 330, null, 294],
    bass: [65, 73, 65, 61, 65, 73, 65, 61],
    noise: 300,
  },
  market: {
    stepMs: 300,
    chords: [
      [220, 277, 330],
      [247, 311, 370],
      [262, 330, 392],
      [196, 247, 330],
    ],
    lead: [784, 880, 988, 880, 784, 659, 587, 659],
    bass: [110, 123, 131, 98, 110, 123, 131, 98],
    noise: 1800,
  },
  archive: {
    stepMs: 360,
    chords: [
      [196, 247, 311],
      [220, 277, 330],
      [233, 294, 349],
      [185, 247, 311],
    ],
    lead: [659, null, 698, 659, 587, 523, null, 587],
    bass: [98, 110, 117, 92, 98, 110, 117, 92],
    noise: 1400,
  },
  boss: {
    stepMs: 260,
    chords: [
      [110, 147, 175],
      [98, 131, 165],
      [123, 165, 196],
      [98, 131, 175],
    ],
    lead: [330, 349, 392, 466, 392, 349, 330, 294],
    bass: [55, 49, 62, 49, 55, 49, 62, 49],
    noise: 220,
  },
};

export class AudioController {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.theme = 'town';
    this.enabled = true;
    this.timers = new Set();
    this.themeRunning = false;
    this.stepIndex = 0;
    this.buffersPromise = null;
    this.themeBuffers = new Map();
    this.musicSource = null;
    this.musicGain = null;
    this.musicTheme = null;
  }

  ensure() {
    if (!AudioCtor || !this.enabled) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.24;
      this.master.connect(this.ctx.destination);

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.76;
      this.musicBus.connect(this.master);
    }
    return this.ctx;
  }

  async resume() {
    const ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        return;
      }
    }
    this.applyTheme(true);
    this.loadThemeBuffers().then(() => {
      if (this.ctx?.state === 'running') this.applyTheme(true);
    }).catch(() => {});
  }

  loadThemeBuffers() {
    const ctx = this.ensure();
    if (!ctx) return Promise.resolve();
    if (!this.buffersPromise) {
      this.buffersPromise = Promise.all(
        Object.entries(THEME_ASSETS).map(async ([theme, url]) => {
          if (this.themeBuffers.has(theme)) return;
          try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Theme fetch failed for ${theme}`);
            const data = await response.arrayBuffer();
            const buffer = await ctx.decodeAudioData(data.slice(0));
            this.themeBuffers.set(theme, buffer);
          } catch {
            // Fall back to synth loops if asset decoding or loading fails.
          }
        }),
      );
    }
    return this.buffersPromise;
  }

  clearTimers() {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
    this.themeRunning = false;
  }

  queue(fn, delay) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, delay);
    this.timers.add(timer);
    return timer;
  }

  setTheme(theme) {
    this.theme = theme;
    if (this.ctx?.state === 'running') {
      this.applyTheme();
      this.loadThemeBuffers().then(() => {
        if (this.theme === theme && this.ctx?.state === 'running') this.applyTheme(true);
      }).catch(() => {});
    }
  }

  applyTheme(force = false) {
    const ctx = this.ensure();
    if (!ctx || ctx.state !== 'running') return;

    if (this.startAssetTheme(force)) {
      this.clearTimers();
      return;
    }

    this.stopAssetTheme(force ? 0.08 : 0.4);
    this.startThemeLoop(force);
  }

  startAssetTheme(force = false) {
    const ctx = this.ensure();
    const buffer = this.themeBuffers.get(this.theme);
    if (!ctx || ctx.state !== 'running' || !buffer) return false;
    if (!force && this.musicSource && this.musicTheme === this.theme) return true;

    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    const targetVolume = this.theme === 'boss' ? 0.74 : this.theme === 'market' ? 0.64 : 0.56;

    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    gain.connect(this.musicBus);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(targetVolume, now + (force ? 0.2 : 0.65));
    source.start(now + 0.01);

    if (this.musicSource && this.musicGain) {
      const oldSource = this.musicSource;
      const oldGain = this.musicGain;
      oldGain.gain.cancelScheduledValues(now);
      oldGain.gain.setValueAtTime(Math.max(oldGain.gain.value, 0.0001), now);
      oldGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.75);
      try {
        oldSource.stop(now + 0.82);
      } catch {
        // No-op if the source already stopped.
      }
      window.setTimeout(() => {
        try {
          oldSource.disconnect();
        } catch {
          // Ignore disconnection issues.
        }
        try {
          oldGain.disconnect();
        } catch {
          // Ignore disconnection issues.
        }
      }, 1100);
    }

    this.musicSource = source;
    this.musicGain = gain;
    this.musicTheme = this.theme;
    return true;
  }

  stopAssetTheme(fadeOut = 0.4) {
    const ctx = this.ensure();
    if (!ctx || !this.musicSource || !this.musicGain) return;

    const source = this.musicSource;
    const gain = this.musicGain;
    const now = ctx.currentTime;

    this.musicSource = null;
    this.musicGain = null;
    this.musicTheme = null;

    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + fadeOut);
    try {
      source.stop(now + fadeOut + 0.08);
    } catch {
      // No-op if the source already stopped.
    }

    window.setTimeout(() => {
      try {
        source.disconnect();
      } catch {
        // Ignore disconnection issues.
      }
      try {
        gain.disconnect();
      } catch {
        // Ignore disconnection issues.
      }
    }, Math.max(250, Math.round((fadeOut + 0.22) * 1000)));
  }

  tone(freq, duration, options = {}) {
    const ctx = this.ensure();
    if (!ctx || ctx.state !== 'running') return;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const now = ctx.currentTime + (options.delay || 0);
    oscillator.type = options.type || 'sine';
    oscillator.frequency.setValueAtTime(freq, now);
    if (options.detune) oscillator.detune.setValueAtTime(options.detune, now);
    filter.type = options.filter || 'lowpass';
    filter.frequency.value = options.cutoff || 2200;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(options.volume ?? 0.08, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.05);
  }

  noise(duration, options = {}) {
    const ctx = this.ensure();
    if (!ctx || ctx.state !== 'running') return;
    const buffer = ctx.createBuffer(1, Math.max(1, ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * 0.4;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    filter.type = options.filter || 'bandpass';
    filter.frequency.value = options.frequency || 1000;
    gain.gain.value = options.volume || 0.04;
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(ctx.currentTime + (options.delay || 0));
    source.stop(ctx.currentTime + (options.delay || 0) + duration);
  }

  chord(frequencies, duration, options = {}) {
    frequencies.forEach((freq, index) => {
      this.tone(freq, duration, {
        type: options.type || (index === 0 ? 'triangle' : 'sine'),
        volume: (options.volume || 0.025) * (index === 0 ? 1 : 0.7),
        detune: index * 4,
        cutoff: options.cutoff || 1800,
        delay: options.delay || 0,
      });
    });
  }

  play(name) {
    switch (name) {
      case 'shoot':
        this.tone(510, 0.08, { type: 'triangle', volume: 0.06, detune: 120, cutoff: 2600 });
        this.tone(860, 0.05, { type: 'sine', volume: 0.04, cutoff: 3200 });
        break;
      case 'hit':
        this.tone(150, 0.18, { type: 'square', volume: 0.07, cutoff: 1400 });
        this.noise(0.08, { frequency: 520, volume: 0.04 });
        break;
      case 'enemyDown':
        this.tone(420, 0.16, { type: 'sawtooth', volume: 0.06, cutoff: 1600 });
        this.tone(240, 0.24, { type: 'triangle', volume: 0.05, cutoff: 1200 });
        break;
      case 'pickup':
        [523, 659, 784].forEach((freq, index) => {
          this.queue(() => this.tone(freq, 0.14, { type: 'sine', volume: 0.05, cutoff: 2800 }), index * 70);
        });
        break;
      case 'unlock':
        [294, 392, 523, 659].forEach((freq, index) => {
          this.queue(() => this.tone(freq, 0.22, { type: 'triangle', volume: 0.07, cutoff: 2400 }), index * 80);
        });
        break;
      case 'hurt':
        this.tone(110, 0.24, { type: 'sawtooth', volume: 0.08, cutoff: 900 });
        break;
      case 'heal':
        this.tone(660, 0.18, { type: 'sine', volume: 0.05, cutoff: 3200 });
        this.tone(880, 0.22, { type: 'sine', volume: 0.05, cutoff: 3200, delay: 0.03 });
        break;
      case 'dash':
        this.noise(0.12, { frequency: 1400, volume: 0.03 });
        this.tone(320, 0.12, { type: 'triangle', volume: 0.04, cutoff: 1800 });
        break;
      case 'magnet':
        this.tone(220, 0.08, { type: 'square', volume: 0.05, cutoff: 1800 });
        this.tone(660, 0.18, { type: 'triangle', volume: 0.05, cutoff: 2200, delay: 0.04 });
        break;
      case 'bossCharge':
        this.tone(90, 0.6, { type: 'sawtooth', volume: 0.08, cutoff: 700 });
        break;
      case 'nova':
        [330, 494, 659, 988].forEach((freq, index) => {
          this.queue(() => this.tone(freq, 0.24, { type: 'triangle', volume: 0.07, cutoff: 2600 }), index * 45);
        });
        this.noise(0.25, { frequency: 1800, volume: 0.05 });
        break;
      default:
        break;
    }
  }

  startThemeLoop(force = false) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx || ctx.state !== 'running') return;
    if (this.musicSource) return;
    if (this.themeRunning && !force) return;

    this.clearTimers();
    this.themeRunning = true;
    this.stepIndex = 0;

    const scheduleStep = () => {
      if (!this.themeRunning || this.musicSource) return;
      const score = THEME_SCORES[this.theme] || THEME_SCORES.town;
      const step = this.stepIndex;
      const chord = score.chords[step % score.chords.length];
      const lead = score.lead[step % score.lead.length];
      const bass = score.bass[step % score.bass.length];
      const isDownbeat = step % 4 === 0;

      this.chord(chord, score.stepMs / 1000 * 2.4, {
        volume: this.theme === 'boss' ? 0.028 : 0.022,
        cutoff: this.theme === 'market' ? 2600 : 1900,
      });
      this.tone(bass, score.stepMs / 1000 * 0.8, {
        type: this.theme === 'forge' ? 'square' : 'triangle',
        volume: 0.028,
        cutoff: 900,
      });

      if (lead) {
        this.tone(lead, score.stepMs / 1000 * 0.66, {
          type: this.theme === 'market' ? 'triangle' : 'sine',
          volume: this.theme === 'boss' ? 0.035 : 0.026,
          cutoff: 2800,
          delay: 0.03,
        });
      }

      if (isDownbeat) {
        this.noise(0.06, { frequency: score.noise, volume: this.theme === 'boss' ? 0.045 : 0.018 });
      }
      if (step % 2 === 1 && this.theme !== 'town') {
        this.tone(chord[1], score.stepMs / 1000 * 0.22, {
          type: 'triangle',
          volume: 0.015,
          cutoff: 2200,
          delay: 0.12,
        });
      }

      this.stepIndex += 1;
      this.queue(scheduleStep, score.stepMs);
    };

    scheduleStep();
  }
}
