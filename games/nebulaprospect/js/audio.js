/* ============================================================
   NEBULA PROSPECT — AUDIO ENGINE
   ============================================================
   Light-weight Web Audio SFX. No external files; everything is
   synthesized on demand. Call NPAudio.play('id') from any event.

   Respects user setting `nebula-mute` in localStorage.
   ============================================================ */

window.NPAudio = (function () {
  let ctx = null;
  let muted = localStorage.getItem('nebula-mute') === '1';

  function ensureCtx() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
    } catch (e) { ctx = null; }
    return ctx;
  }

  function beep({ freq = 440, type = 'sine', dur = 0.12, gain = 0.08, slide = 0, delay = 0 }) {
    if (muted) return;
    const c = ensureCtx();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function noise(dur = 0.12, gain = 0.04, delay = 0) {
    if (muted) return;
    const c = ensureCtx();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = c.createBufferSource();
    const g = c.createGain();
    s.buffer = buf;
    g.gain.value = gain;
    s.connect(g).connect(c.destination);
    s.start(t0);
    s.stop(t0 + dur + 0.02);
  }

  const SFX = {
    tick:      () => beep({ freq: 880, type: 'square', dur: 0.04, gain: 0.025 }),
    click:     () => beep({ freq: 640, type: 'square', dur: 0.05, gain: 0.05 }),
    confirm:   () => { beep({ freq: 520, dur: 0.07, gain: 0.06 }); beep({ freq: 780, dur: 0.10, gain: 0.06, delay: 0.06 }); },
    cancel:    () => beep({ freq: 220, type: 'sawtooth', dur: 0.12, gain: 0.05, slide: -120 }),
    deploy:    () => { beep({ freq: 200, type: 'sawtooth', dur: 0.22, gain: 0.07, slide: 360 }); noise(0.14, 0.02, 0.06); },
    opDone:    () => { beep({ freq: 660, dur: 0.09, gain: 0.07 }); beep({ freq: 880, dur: 0.09, gain: 0.07, delay: 0.08 }); beep({ freq: 1320, dur: 0.12, gain: 0.07, delay: 0.16 }); },
    alert:     () => { beep({ freq: 440, type: 'square', dur: 0.14, gain: 0.08 }); beep({ freq: 330, type: 'square', dur: 0.14, gain: 0.08, delay: 0.16 }); },
    raid:      () => { beep({ freq: 120, type: 'sawtooth', dur: 0.3, gain: 0.1, slide: 80 }); noise(0.3, 0.05); },
    scan:      () => { beep({ freq: 440, dur: 0.05, gain: 0.04 }); beep({ freq: 660, dur: 0.05, gain: 0.04, delay: 0.06 }); beep({ freq: 880, dur: 0.05, gain: 0.04, delay: 0.12 }); },
    research:  () => { beep({ freq: 740, dur: 0.08, gain: 0.06 }); beep({ freq: 988, dur: 0.10, gain: 0.06, delay: 0.08 }); beep({ freq: 1319, dur: 0.14, gain: 0.06, delay: 0.18 }); },
    codex:     () => { beep({ freq: 523, type: 'triangle', dur: 0.14, gain: 0.06 }); beep({ freq: 659, type: 'triangle', dur: 0.14, gain: 0.06, delay: 0.1 }); },
    achieve:   () => { beep({ freq: 784, dur: 0.12, gain: 0.08 }); beep({ freq: 1047, dur: 0.12, gain: 0.08, delay: 0.10 }); beep({ freq: 1568, dur: 0.16, gain: 0.08, delay: 0.22 }); },
    mission:   () => { beep({ freq: 330, type: 'triangle', dur: 0.18, gain: 0.08 }); beep({ freq: 494, type: 'triangle', dur: 0.18, gain: 0.08, delay: 0.18 }); beep({ freq: 659, type: 'triangle', dur: 0.24, gain: 0.08, delay: 0.36 }); },
    dilemma:   () => { beep({ freq: 262, type: 'triangle', dur: 0.22, gain: 0.07 }); beep({ freq: 392, type: 'triangle', dur: 0.22, gain: 0.07, delay: 0.2 }); },
    victory:   () => { [523, 659, 784, 1047, 1318].forEach((f, i) => beep({ freq: f, dur: 0.14, gain: 0.09, delay: i * 0.12 })); },
    defeat:    () => { [392, 330, 262, 196].forEach((f, i) => beep({ freq: f, type: 'sawtooth', dur: 0.2, gain: 0.09, delay: i * 0.15 })); },
  };

  return {
    play(id) { try { (SFX[id] || SFX.click)(); } catch(_) {} },
    isMuted() { return muted; },
    setMuted(v) { muted = !!v; localStorage.setItem('nebula-mute', muted ? '1' : '0'); },
    toggle() { this.setMuted(!muted); return muted; },
    resume() { const c = ensureCtx(); if (c && c.state === 'suspended') c.resume(); },
  };
})();
