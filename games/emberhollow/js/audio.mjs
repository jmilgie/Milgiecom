const AudioCtor = window.AudioContext || window.webkitAudioContext;

const midi = (note) => 440 * 2 ** ((note - 69) / 12);
const patternAt = (pattern, index) => pattern[index % pattern.length];

const THEME_AUDIO_ASSETS = {
  town: new URL('../assets/audio/theme-town.mp3', import.meta.url).href,
  moss: new URL('../assets/audio/theme-moss.mp3', import.meta.url).href,
  reservoir: new URL('../assets/audio/theme-reservoir.mp3', import.meta.url).href,
  echo: new URL('../assets/audio/theme-echo.mp3', import.meta.url).href,
  forge: new URL('../assets/audio/theme-forge.mp3', import.meta.url).href,
  market: new URL('../assets/audio/theme-market.mp3', import.meta.url).href,
  archive: new URL('../assets/audio/theme-archive.mp3', import.meta.url).href,
  boss: new URL('../assets/audio/theme-boss.mp3', import.meta.url).href,
};

const SFX_AUDIO_ASSETS = {
  shoot: new URL('../assets/audio/sfx-shoot.mp3', import.meta.url).href,
  hit: new URL('../assets/audio/sfx-hit.mp3', import.meta.url).href,
  enemyDown: new URL('../assets/audio/sfx-enemyDown.mp3', import.meta.url).href,
  pickup: new URL('../assets/audio/sfx-pickup.mp3', import.meta.url).href,
  unlock: new URL('../assets/audio/sfx-unlock.mp3', import.meta.url).href,
  hurt: new URL('../assets/audio/sfx-hurt.mp3', import.meta.url).href,
  heal: new URL('../assets/audio/sfx-heal.mp3', import.meta.url).href,
  dash: new URL('../assets/audio/sfx-dash.mp3', import.meta.url).href,
  magnet: new URL('../assets/audio/sfx-magnet.mp3', import.meta.url).href,
  bossCharge: new URL('../assets/audio/sfx-bossCharge.mp3', import.meta.url).href,
  nova: new URL('../assets/audio/sfx-nova.mp3', import.meta.url).href,
};

const SFX_LEVELS = {
  shoot: 0.8,
  hit: 0.84,
  enemyDown: 0.9,
  pickup: 0.66,
  unlock: 0.82,
  hurt: 0.8,
  heal: 0.72,
  dash: 0.8,
  magnet: 0.78,
  bossCharge: 0.92,
  nova: 0.98,
};

const THEME_SCORES = {
  town: {
    stepMs: 410,
    padType: 'triangle',
    leadType: 'sine',
    bassType: 'triangle',
    drone: 40,
    drumFreq: 980,
    shimmerFreq: 2500,
    chords: [[52, 56, 59], [55, 59, 62], [50, 54, 57], [52, 56, 59]],
    bass: [40, 40, 43, 43, 38, 38, 40, 43],
    leadA: [71, 73, 75, null, 78, 75, 73, 71],
    leadB: [68, 71, 73, 75, 73, 71, 68, null],
    counterA: [59, null, 61, null, 63, null, 61, null],
    bellsA: [83, null, null, 80, null, 78, null, 80],
  },
  moss: {
    stepMs: 430,
    padType: 'sine',
    leadType: 'triangle',
    bassType: 'triangle',
    drone: 33,
    drumFreq: 620,
    shimmerFreq: 1700,
    chords: [[48, 52, 55], [50, 53, 57], [45, 48, 52], [47, 50, 55]],
    bass: [33, 33, 36, 36, 31, 31, 33, 36],
    leadA: [64, 67, null, 69, 67, 64, 62, null],
    leadB: [62, null, 64, 67, 64, 62, 60, null],
    counterA: [55, null, 57, null, 55, null, 53, null],
    bellsA: [76, null, null, 74, null, 72, null, null],
  },
  reservoir: {
    stepMs: 360,
    padType: 'sine',
    leadType: 'triangle',
    bassType: 'triangle',
    drone: 38,
    drumFreq: 1500,
    shimmerFreq: 3000,
    chords: [[50, 53, 57], [52, 55, 59], [48, 52, 57], [47, 50, 55]],
    bass: [38, 40, 38, 35, 38, 40, 38, 35],
    leadA: [69, 71, 74, null, 71, 69, 66, null],
    leadB: [66, 69, 71, 74, 71, 69, 66, 64],
    counterA: [57, null, 59, null, 57, null, 55, null],
    bellsA: [81, null, 78, null, 76, null, 74, null],
  },
  echo: {
    stepMs: 335,
    padType: 'triangle',
    leadType: 'sine',
    bassType: 'triangle',
    drone: 33,
    drumFreq: 860,
    shimmerFreq: 2400,
    chords: [[45, 48, 52], [50, 53, 57], [52, 55, 59], [48, 52, 55]],
    bass: [33, 36, 38, 36, 33, 36, 38, 36],
    leadA: [72, 74, 76, 79, 76, 74, 72, 69],
    leadB: [69, 72, 74, 76, 74, 72, 69, 67],
    counterA: [57, null, 60, null, 62, null, 60, null],
    bellsA: [84, null, null, 81, null, 79, null, 81],
  },
  forge: {
    stepMs: 300,
    padType: 'square',
    leadType: 'triangle',
    bassType: 'square',
    drone: 28,
    drumFreq: 320,
    shimmerFreq: 1600,
    chords: [[40, 43, 47], [45, 48, 52], [43, 47, 50], [38, 42, 45]],
    bass: [28, 31, 29, 26, 28, 31, 29, 26],
    leadA: [67, null, 69, 67, 64, 62, null, 59],
    leadB: [59, 62, 64, 67, 64, 62, 59, null],
    counterA: [52, null, 50, null, 48, null, 47, null],
    bellsA: [76, null, 74, null, null, 72, null, null],
  },
  market: {
    stepMs: 285,
    padType: 'triangle',
    leadType: 'triangle',
    bassType: 'triangle',
    drone: 40,
    drumFreq: 1900,
    shimmerFreq: 3200,
    chords: [[52, 56, 59], [55, 59, 62], [57, 61, 64], [50, 54, 57]],
    bass: [40, 43, 45, 38, 40, 43, 45, 38],
    leadA: [79, 81, 83, 86, 83, 81, 79, 76],
    leadB: [76, 79, 81, 83, 81, 79, 76, 74],
    counterA: [64, null, 67, null, 69, null, 67, null],
    bellsA: [88, null, 91, null, 88, null, 86, null],
  },
  archive: {
    stepMs: 350,
    padType: 'sine',
    leadType: 'triangle',
    bassType: 'triangle',
    drone: 38,
    drumFreq: 1280,
    shimmerFreq: 2800,
    chords: [[50, 53, 57], [52, 55, 59], [53, 57, 60], [48, 52, 57]],
    bass: [38, 40, 41, 36, 38, 40, 41, 36],
    leadA: [76, null, 78, 76, 74, 71, null, 74],
    leadB: [71, 74, 76, 78, 76, 74, 71, null],
    counterA: [60, null, 62, null, 64, null, 62, null],
    bellsA: [84, null, null, 81, null, 79, null, 78],
  },
  boss: {
    stepMs: 250,
    padType: 'sawtooth',
    leadType: 'sawtooth',
    bassType: 'square',
    drone: 31,
    drumFreq: 240,
    shimmerFreq: 1800,
    chords: [[43, 46, 50], [41, 45, 48], [45, 48, 52], [41, 45, 50]],
    bass: [31, 29, 33, 29, 31, 29, 33, 29],
    leadA: [64, 65, 67, 70, 67, 65, 64, 60],
    leadB: [60, 64, 65, 67, 65, 64, 60, 57],
    counterA: [52, null, 53, null, 55, null, 53, null],
    bellsA: [76, null, 77, null, 79, null, 77, null],
  },
};

export class AudioController {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.fxBus = null;
    this.theme = 'town';
    this.enabled = true;
    this.musicTimers = new Set();
    this.fxTimers = new Set();
    this.themeRunning = false;
    this.stepIndex = 0;
    this.musicEntries = new Map();
    this.musicLoads = new Map();
    this.sfxBuffers = new Map();
    this.sfxLoads = new Map();
    this.activeMusicTheme = null;
  }

  ensure() {
    if (!AudioCtor || !this.enabled) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.24;
      this.master.connect(this.ctx.destination);

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.78;
      this.musicBus.connect(this.master);

      this.fxBus = this.ctx.createGain();
      this.fxBus.gain.value = 0.92;
      this.fxBus.connect(this.master);
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
    this.preloadCommonEffects();
    this.primeThemeAsset(this.theme);
    this.startThemeLoop(true);
  }

  clearMusicTimers() {
    this.musicTimers.forEach((timer) => clearTimeout(timer));
    this.musicTimers.clear();
    this.themeRunning = false;
  }

  queueMusic(fn, delay) {
    const timer = setTimeout(() => {
      this.musicTimers.delete(timer);
      fn();
    }, delay);
    this.musicTimers.add(timer);
    return timer;
  }

  queueFx(fn, delay) {
    const timer = setTimeout(() => {
      this.fxTimers.delete(timer);
      fn();
    }, delay);
    this.fxTimers.add(timer);
    return timer;
  }

  setTheme(theme) {
    this.theme = theme;
    this.primeThemeAsset(theme);
    if (this.ctx?.state === 'running') this.startThemeLoop(true);
  }

  preloadCommonEffects() {
    Object.keys(SFX_AUDIO_ASSETS).forEach((name) => this.loadSfxBuffer(name));
  }

  primeThemeAsset(theme) {
    const url = THEME_AUDIO_ASSETS[theme];
    const ctx = this.ensure();
    if (!ctx || !url) return Promise.resolve(null);
    if (this.musicEntries.has(theme)) return Promise.resolve(this.musicEntries.get(theme));
    if (this.musicLoads.has(theme)) return this.musicLoads.get(theme);

    const audio = new Audio(url);
    audio.preload = 'auto';
    audio.loop = true;
    audio.crossOrigin = 'anonymous';

    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    const source = ctx.createMediaElementSource(audio);
    source.connect(gain);
    gain.connect(this.musicBus);

    const entry = {
      theme,
      audio,
      gain,
      ready: false,
      failed: false,
    };
    this.musicEntries.set(theme, entry);

    const loadPromise = new Promise((resolve, reject) => {
      const finish = () => {
        audio.removeEventListener('canplaythrough', onReady);
        audio.removeEventListener('loadeddata', onReady);
        audio.removeEventListener('error', onError);
      };
      const onReady = () => {
        entry.ready = true;
        finish();
        resolve(entry);
      };
      const onError = () => {
        entry.failed = true;
        finish();
        reject(new Error(`Music asset failed to load: ${theme}`));
      };

      if (audio.readyState >= 2) {
        entry.ready = true;
        resolve(entry);
        return;
      }

      audio.addEventListener('canplaythrough', onReady, { once: true });
      audio.addEventListener('loadeddata', onReady, { once: true });
      audio.addEventListener('error', onError, { once: true });
      audio.load();
    }).then((loaded) => {
      if (this.theme === theme && this.ctx?.state === 'running') {
        this.startThemeLoop(true);
      }
      return loaded;
    }).catch(() => entry).finally(() => {
      this.musicLoads.delete(theme);
    });

    this.musicLoads.set(theme, loadPromise);
    return loadPromise;
  }

  fadeMusicEntry(entry, target, duration = 0.55) {
    const ctx = this.ensure();
    if (!ctx || !entry?.gain) return;
    const now = ctx.currentTime;
    entry.gain.gain.cancelScheduledValues(now);
    entry.gain.gain.setValueAtTime(Math.max(0.0001, entry.gain.gain.value), now);
    entry.gain.gain.linearRampToValueAtTime(Math.max(0.0001, target), now + duration);
  }

  stopActiveMusicEntry(duration = 0.45) {
    if (!this.activeMusicTheme) return;
    const entry = this.musicEntries.get(this.activeMusicTheme);
    if (!entry) {
      this.activeMusicTheme = null;
      return;
    }
    const previousTheme = this.activeMusicTheme;
    this.fadeMusicEntry(entry, 0.0001, duration);
    setTimeout(() => {
      if (this.activeMusicTheme !== previousTheme) {
        entry.audio.pause();
        entry.audio.currentTime = 0;
      }
    }, duration * 1000 + 100);
  }

  startAssetTheme(force = false) {
    const ctx = this.ensure();
    if (!ctx || ctx.state !== 'running') return false;

    const url = THEME_AUDIO_ASSETS[this.theme];
    if (!url) return false;

    const entry = this.musicEntries.get(this.theme);
    if (!entry) {
      this.primeThemeAsset(this.theme);
      return false;
    }
    if (entry.failed) return false;
    if (!entry.ready) return false;

    if (!force && this.activeMusicTheme === this.theme && !entry.audio.paused) return true;

    this.clearMusicTimers();

    const previousTheme = this.activeMusicTheme;
    if (previousTheme && previousTheme !== this.theme) {
      this.stopActiveMusicEntry(0.65);
    }

    this.activeMusicTheme = this.theme;
    if (previousTheme !== this.theme) {
      entry.audio.currentTime = 0;
    }
    this.fadeMusicEntry(entry, 0.88, 0.75);
    entry.audio.play().catch(() => {
      entry.failed = true;
    });
    return true;
  }

  async loadSfxBuffer(name) {
    const url = SFX_AUDIO_ASSETS[name];
    const ctx = this.ensure();
    if (!ctx || !url) return null;
    if (this.sfxBuffers.has(name)) return this.sfxBuffers.get(name);
    if (this.sfxLoads.has(name)) return this.sfxLoads.get(name);

    const loadPromise = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to fetch SFX asset: ${name}`);
        return response.arrayBuffer();
      })
      .then((buffer) => ctx.decodeAudioData(buffer.slice(0)))
      .then((decoded) => {
        this.sfxBuffers.set(name, decoded);
        return decoded;
      })
      .catch(() => null)
      .finally(() => {
        this.sfxLoads.delete(name);
      });

    this.sfxLoads.set(name, loadPromise);
    return loadPromise;
  }

  playBufferedSfx(name) {
    const ctx = this.ensure();
    if (!ctx || ctx.state !== 'running') return false;
    const buffer = this.sfxBuffers.get(name);
    if (!buffer) {
      this.loadSfxBuffer(name);
      return false;
    }

    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = name === 'unlock' || name === 'bossCharge' ? 1 : 0.97 + Math.random() * 0.06;
    gain.gain.value = SFX_LEVELS[name] ?? 0.8;
    source.connect(gain);
    gain.connect(this.fxBus);
    source.start();
    return true;
  }

  tone(freq, duration, options = {}) {
    const ctx = this.ensure();
    if (!ctx || ctx.state !== 'running') return;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const targetBus = options.bus || this.fxBus || this.master;
    const now = ctx.currentTime + (options.delay || 0);
    const attack = options.attack || 0.02;
    const release = options.release || 0.08;
    oscillator.type = options.type || 'sine';
    oscillator.frequency.setValueAtTime(freq, now);
    if (options.detune) oscillator.detune.setValueAtTime(options.detune, now);
    filter.type = options.filter || 'lowpass';
    filter.frequency.value = options.cutoff || 2200;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(options.volume ?? 0.08, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(attack + 0.01, duration - release * 0.45));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(targetBus);
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
    gain.connect(options.bus || this.fxBus || this.master);
    source.start(ctx.currentTime + (options.delay || 0));
    source.stop(ctx.currentTime + (options.delay || 0) + duration);
  }

  musicTone(note, duration, options = {}) {
    this.tone(midi(note), duration, {
      bus: this.musicBus,
      attack: options.attack || 0.02,
      release: options.release || 0.12,
      cutoff: options.cutoff || 2200,
      volume: options.volume ?? 0.04,
      delay: options.delay || 0,
      detune: options.detune || 0,
      type: options.type || 'sine',
      filter: options.filter || 'lowpass',
    });
  }

  playPad(chord, score, phrase) {
    chord.forEach((note, index) => {
      this.musicTone(note, score.stepMs / 1000 * 2.8, {
        type: score.padType,
        volume: index === 0 ? 0.02 : 0.015,
        cutoff: score.padType === 'square' ? 1200 : 2000 + index * 140,
        detune: (phrase % 2 === 0 ? 1 : -1) * index * 3,
        attack: 0.05,
        release: 0.35,
      });
      this.musicTone(note + 12, score.stepMs / 1000 * 1.9, {
        type: 'sine',
        volume: 0.008,
        cutoff: 2600,
        detune: index === 0 ? 0 : -4,
        attack: 0.04,
        release: 0.22,
      });
    });
  }

  playThemeStep(score, step, phrase) {
    const chord = patternAt(score.chords, step + phrase);
    const bass = patternAt(score.bass, step + phrase);
    const leadPattern = phrase % 2 === 0 ? score.leadA : (score.leadB || score.leadA);
    const lead = patternAt(leadPattern, step);
    const counter = patternAt(score.counterA, step + phrase % 2);
    const bell = patternAt(score.bellsA, step + phrase);
    const stepSec = score.stepMs / 1000;
    const isDownbeat = step % 4 === 0;
    const isMeasureStart = step % 8 === 0;

    if (isMeasureStart && score.drone) {
      this.musicTone(score.drone + (phrase % 3 === 2 ? 12 : 0), stepSec * 7.4, {
        type: 'sine',
        volume: this.theme === 'boss' ? 0.012 : 0.01,
        cutoff: 880,
        attack: 0.3,
        release: 0.8,
      });
    }

    this.playPad(chord, score, phrase);
    this.musicTone(bass, stepSec * 0.86, {
      type: score.bassType,
      volume: this.theme === 'boss' ? 0.032 : 0.026,
      cutoff: score.bassType === 'square' ? 980 : 860,
      release: 0.16,
    });

    if (lead !== null) {
      this.musicTone(lead, stepSec * 0.7, {
        type: score.leadType,
        volume: this.theme === 'boss' ? 0.038 : 0.03,
        cutoff: this.theme === 'market' ? 3000 : 2500,
        delay: 0.03,
        release: 0.1,
      });
    }

    if (counter !== null && step % 2 === 1) {
      this.musicTone(counter, stepSec * 0.4, {
        type: 'triangle',
        volume: 0.014,
        cutoff: 1900,
        delay: 0.08,
        release: 0.08,
      });
    }

    if (bell !== null && (isDownbeat || phrase % 2 === 1)) {
      this.musicTone(bell, stepSec * 0.46, {
        type: 'sine',
        volume: 0.012,
        cutoff: score.shimmerFreq,
        delay: 0.05,
        release: 0.12,
      });
    }

    if (isDownbeat) {
      this.noise(0.05, { bus: this.musicBus, frequency: score.drumFreq, volume: this.theme === 'boss' ? 0.05 : 0.02 });
    }
    if (step % 2 === 1) {
      this.noise(0.03, { bus: this.musicBus, frequency: score.shimmerFreq, volume: this.theme === 'forge' ? 0.014 : 0.01, delay: 0.06 });
    }
  }

  playSynth(name) {
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
          this.queueFx(() => this.tone(freq, 0.14, { type: 'sine', volume: 0.05, cutoff: 2800 }), index * 70);
        });
        break;
      case 'unlock':
        [294, 392, 523, 659].forEach((freq, index) => {
          this.queueFx(() => this.tone(freq, 0.22, { type: 'triangle', volume: 0.07, cutoff: 2400 }), index * 80);
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
          this.queueFx(() => this.tone(freq, 0.24, { type: 'triangle', volume: 0.07, cutoff: 2600 }), index * 45);
        });
        this.noise(0.25, { frequency: 1800, volume: 0.05 });
        break;
      default:
        break;
    }
  }

  play(name) {
    if (this.playBufferedSfx(name)) return;
    this.playSynth(name);
  }

  startSynthThemeLoop() {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx || ctx.state !== 'running') return;

    this.stopActiveMusicEntry(0.35);
    this.clearMusicTimers();
    this.themeRunning = true;
    this.stepIndex = 0;

    const scheduleStep = () => {
      if (!this.themeRunning) return;
      const score = THEME_SCORES[this.theme] || THEME_SCORES.town;
      const step = this.stepIndex;
      const phrase = Math.floor(step / 8);
      this.playThemeStep(score, step, phrase);
      this.stepIndex += 1;
      this.queueMusic(scheduleStep, score.stepMs);
    };

    scheduleStep();
  }

  startThemeLoop(force = false) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx || ctx.state !== 'running') return;
    if (this.startAssetTheme(force)) return;
    this.startSynthThemeLoop();
  }
}
