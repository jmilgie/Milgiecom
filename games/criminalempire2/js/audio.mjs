const NOTE_FREQ = {
  C2: 65.41,
  D2: 73.42,
  Eb2: 77.78,
  F2: 87.31,
  G2: 98.0,
  Bb2: 116.54,
  C3: 130.81,
  D3: 146.83,
  Eb3: 155.56,
  F3: 174.61,
  G3: 196.0,
  Bb3: 233.08,
  C4: 261.63,
  D4: 293.66,
  Eb4: 311.13,
  F4: 349.23,
  G4: 392.0,
  Bb4: 466.16,
};

function note(name) {
  return NOTE_FREQ[name] || 220;
}

export class AudioDirector {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.delay = null;
    this.musicTimer = null;
    this.step = 0;
    this.nextTime = 0;
    this.booted = false;
    this.soundEnabled = true;
    this.musicEnabled = true;
    this.intensity = "quiet";
    this.beatId = "";
  }

  async boot() {
    if (this.booted) {
      if (this.ctx?.state === "suspended") {
        await this.ctx.resume();
      }
      return;
    }

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      return;
    }

    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.42;
    this.delay = this.ctx.createDelay(0.6);
    const delayFeedback = this.ctx.createGain();
    delayFeedback.gain.value = 0.22;
    this.delay.delayTime.value = 0.19;
    this.delay.connect(delayFeedback);
    delayFeedback.connect(this.delay);
    this.delay.connect(this.master);
    this.master.connect(this.ctx.destination);
    this.booted = true;
    this.nextTime = this.ctx.currentTime + 0.12;
    this.startMusicLoop();
  }

  setToggles({ sound, music }) {
    this.soundEnabled = sound;
    this.musicEnabled = music;
  }

  setScene({ intensity, beatId }) {
    this.intensity = intensity;
    this.beatId = beatId || "";
  }

  startMusicLoop() {
    if (this.musicTimer || !this.ctx) {
      return;
    }
    this.musicTimer = window.setInterval(() => {
      if (!this.musicEnabled || !this.ctx) {
        return;
      }
      const lookAhead = this.ctx.currentTime + 0.18;
      while (this.nextTime < lookAhead) {
        this.scheduleStep(this.step, this.nextTime);
        this.nextTime += 60 / 92 / 2;
        this.step = (this.step + 1) % 16;
      }
    }, 90);
  }

  pulse(freq, time, duration, type, gainValue, target = this.master) {
    if (!this.ctx) {
      return;
    }
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(type === "square" ? 900 : 1800, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(gainValue, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(target);
    osc.start(time);
    osc.stop(time + duration + 0.05);
  }

  scheduleStep(step, time) {
    const bassLine = ["C2", null, "Eb2", null, "Bb2", null, "G2", null, "C2", null, "Eb2", null, "F2", null, "G2", null];
    const padHits = [0, 4, 8, 12];
    const leadLine = ["C4", "Eb4", "G4", "Bb4", "G4", "F4", "Eb4", "D4", "C4", "Bb3", "C4", "Eb4", "G4", "F4", "Eb4", "D4"];

    const bassNote = bassLine[step];
    if (bassNote) {
      this.pulse(note(bassNote), time, 0.28, "sawtooth", 0.11);
    }

    if (padHits.includes(step)) {
      this.pulse(note(step === 8 ? "Bb3" : "C3"), time, 0.8, "triangle", 0.04, this.delay);
      this.pulse(note(step === 8 ? "Eb4" : "G4"), time, 0.7, "triangle", 0.03, this.delay);
    }

    if (this.intensity === "hunted" || this.intensity === "redline") {
      this.pulse(note(leadLine[step]), time, 0.12, "square", this.intensity === "redline" ? 0.05 : 0.035, this.delay);
    } else if (this.beatId === "synth_carnival" && step % 2 === 0) {
      this.pulse(note(leadLine[step]), time, 0.08, "square", 0.03, this.delay);
    }
  }

  fxTone(freq, duration, type = "triangle", gainValue = 0.08) {
    if (!this.soundEnabled || !this.ctx) {
      return;
    }
    const now = this.ctx.currentTime;
    this.pulse(freq, now, duration, type, gainValue);
  }

  playFx(name) {
    if (!this.soundEnabled || !this.ctx) {
      return;
    }
    switch (name) {
      case "hustle":
        this.fxTone(660, 0.08, "square", 0.03);
        this.fxTone(880, 0.06, "triangle", 0.02);
        break;
      case "buy":
        this.fxTone(330, 0.12, "triangle", 0.04);
        this.fxTone(495, 0.15, "triangle", 0.03);
        break;
      case "claim":
        this.fxTone(523.25, 0.14, "triangle", 0.045);
        this.fxTone(659.25, 0.18, "triangle", 0.03);
        break;
      case "heistSuccess":
        this.fxTone(392, 0.18, "square", 0.05);
        window.setTimeout(() => this.fxTone(523.25, 0.2, "square", 0.05), 70);
        window.setTimeout(() => this.fxTone(659.25, 0.22, "square", 0.04), 130);
        break;
      case "heistFail":
        this.fxTone(196, 0.2, "sawtooth", 0.05);
        window.setTimeout(() => this.fxTone(174.61, 0.24, "sawtooth", 0.04), 90);
        break;
      case "toggle":
        this.fxTone(440, 0.08, "triangle", 0.03);
        break;
      case "alert":
        this.fxTone(740, 0.1, "triangle", 0.025);
        break;
      default:
        this.fxTone(300, 0.08, "triangle", 0.02);
        break;
    }
  }
}
