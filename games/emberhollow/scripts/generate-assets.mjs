import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const uiDir = path.join(root, 'assets', 'ui');
const audioDir = path.join(root, 'assets', 'audio');

fs.mkdirSync(uiDir, { recursive: true });
fs.mkdirSync(audioDir, { recursive: true });

function writeSvg(name, svg) {
  fs.writeFileSync(path.join(uiDir, name), svg.trimStart(), 'utf8');
}

function writeWav(filePath, samples, sampleRate = 16000) {
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = channels * bitsPerSample / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }

  fs.writeFileSync(filePath, buffer);
}

function midi(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

function synth(type, phase) {
  const wrapped = phase % (Math.PI * 2);
  if (type === 'triangle') return 2 * Math.abs(2 * (wrapped / (Math.PI * 2)) - 1) - 1;
  if (type === 'saw') return 2 * (wrapped / (Math.PI * 2)) - 1;
  if (type === 'square') return wrapped < Math.PI ? 1 : -1;
  return Math.sin(wrapped);
}

function addTone(samples, sampleRate, start, duration, frequency, volume, type = 'sine', attack = 0.02, release = 0.08) {
  const startIndex = Math.floor(start * sampleRate);
  const length = Math.floor(duration * sampleRate);
  for (let i = 0; i < length && startIndex + i < samples.length; i += 1) {
    const t = i / sampleRate;
    const fadeIn = Math.min(1, t / attack);
    const fadeOut = Math.min(1, Math.max(0, (duration - t) / release));
    const env = fadeIn * fadeOut;
    const vibrato = Math.sin(t * 5.2) * 0.0025;
    const phase = (t * frequency * (1 + vibrato)) * Math.PI * 2;
    samples[startIndex + i] += synth(type, phase) * env * volume;
  }
}

function addNoise(samples, sampleRate, start, duration, volume, decay = 6) {
  const startIndex = Math.floor(start * sampleRate);
  const length = Math.floor(duration * sampleRate);
  for (let i = 0; i < length && startIndex + i < samples.length; i += 1) {
    const t = i / sampleRate;
    const env = Math.exp(-t * decay);
    samples[startIndex + i] += (Math.random() * 2 - 1) * env * volume;
  }
}

const THEMES = {
  town: {
    tempo: 92,
    step: 0.5,
    chords: [[52, 56, 59], [55, 59, 62], [50, 54, 57], [52, 56, 59]],
    melody: [71, 73, 75, 78, 75, 73, 71, 68],
    bass: [40, 40, 43, 43, 38, 38, 40, 43],
    percussion: 0.06,
  },
  moss: {
    tempo: 88,
    step: 0.5,
    chords: [[48, 52, 55], [50, 53, 57], [45, 48, 52], [47, 50, 55]],
    melody: [64, 67, null, 69, 67, 64, 62, null],
    bass: [33, 33, 36, 36, 31, 31, 33, 36],
    percussion: 0.035,
  },
  reservoir: {
    tempo: 100,
    step: 0.5,
    chords: [[50, 53, 57], [52, 55, 59], [48, 52, 57], [47, 50, 55]],
    melody: [69, 71, 74, null, 71, 69, 66, null],
    bass: [38, 40, 38, 35, 38, 40, 38, 35],
    percussion: 0.08,
  },
  echo: {
    tempo: 104,
    step: 0.5,
    chords: [[45, 48, 52], [50, 53, 57], [52, 55, 59], [48, 52, 55]],
    melody: [72, 74, 76, 79, 76, 74, 72, 69],
    bass: [33, 36, 38, 36, 33, 36, 38, 36],
    percussion: 0.05,
  },
  forge: {
    tempo: 108,
    step: 0.5,
    chords: [[40, 43, 47], [45, 48, 52], [43, 47, 50], [38, 42, 45]],
    melody: [67, null, 69, 67, 64, 62, null, 59],
    bass: [28, 31, 29, 26, 28, 31, 29, 26],
    percussion: 0.09,
  },
  market: {
    tempo: 112,
    step: 0.5,
    chords: [[52, 56, 59], [55, 59, 62], [57, 61, 64], [50, 54, 57]],
    melody: [79, 81, 83, 86, 83, 81, 79, 76],
    bass: [40, 43, 45, 38, 40, 43, 45, 38],
    percussion: 0.07,
  },
  archive: {
    tempo: 96,
    step: 0.5,
    chords: [[50, 53, 57], [52, 55, 59], [53, 57, 60], [48, 52, 57]],
    melody: [76, null, 78, 76, 74, 71, null, 74],
    bass: [38, 40, 41, 36, 38, 40, 41, 36],
    percussion: 0.045,
  },
  boss: {
    tempo: 118,
    step: 0.5,
    chords: [[43, 46, 50], [41, 45, 48], [45, 48, 52], [41, 45, 50]],
    melody: [64, 65, 67, 70, 67, 65, 64, 60],
    bass: [31, 29, 33, 29, 31, 29, 33, 29],
    percussion: 0.12,
  },
};

function renderTheme(config) {
  const sampleRate = 16000;
  const duration = 16;
  const samples = new Float32Array(sampleRate * duration);
  const steps = Math.floor(duration / config.step);

  for (let step = 0; step < steps; step += 1) {
    const time = step * config.step;
    const chord = config.chords[step % config.chords.length];
    const bassNote = config.bass[step % config.bass.length];
    const melodyNote = config.melody[step % config.melody.length];

    chord.forEach((note, index) => {
      addTone(samples, sampleRate, time, config.step * 1.8, midi(note), 0.045 / (index + 1), index === 0 ? 'triangle' : 'sine', 0.03, 0.18);
      addTone(samples, sampleRate, time, config.step * 1.5, midi(note + 12), 0.012 / (index + 1), 'sine', 0.04, 0.2);
    });

    addTone(samples, sampleRate, time, config.step * 0.78, midi(bassNote), 0.055, step % 2 === 0 ? 'triangle' : 'square', 0.01, 0.12);

    if (melodyNote) {
      addTone(samples, sampleRate, time + 0.06, config.step * 0.62, midi(melodyNote), 0.04, config === THEMES.market ? 'triangle' : 'sine', 0.01, 0.08);
    }

    if (step % 2 === 0) {
      addNoise(samples, sampleRate, time, 0.06, config.percussion, 10);
    }
    if (step % 4 === 2) {
      addNoise(samples, sampleRate, time + 0.18, 0.04, config.percussion * 0.6, 13);
    }
  }

  const fadeLength = Math.floor(sampleRate * 0.35);
  for (let i = 0; i < fadeLength; i += 1) {
    const mix = i / fadeLength;
    samples[i] *= mix;
    samples[samples.length - 1 - i] *= mix;
  }

  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const gain = peak > 0 ? 0.88 / peak : 1;
  for (let i = 0; i < samples.length; i += 1) samples[i] *= gain;

  return { samples, sampleRate };
}

writeSvg('title-card.svg', `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 520">
  <defs>
    <linearGradient id="bg" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#1b2434"/>
      <stop offset="55%" stop-color="#513826"/>
      <stop offset="100%" stop-color="#120d12"/>
    </linearGradient>
    <linearGradient id="sun" x1="0" x2="1">
      <stop offset="0%" stop-color="#ffd980"/>
      <stop offset="100%" stop-color="#ff9a5d"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="38%" r="48%">
      <stop offset="0%" stop-color="#fff0ba" stop-opacity=".9"/>
      <stop offset="100%" stop-color="#fff0ba" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="960" height="520" rx="42" fill="url(#bg)"/>
  <circle cx="480" cy="180" r="160" fill="url(#glow)"/>
  <path d="M0 390 C110 328 180 308 298 320 C430 334 500 242 616 246 C728 250 804 318 960 280 V520 H0 Z" fill="#253646"/>
  <path d="M0 438 C152 392 246 398 366 414 C514 434 624 336 768 350 C842 358 896 382 960 360 V520 H0 Z" fill="#6a4630"/>
  <path d="M470 128 L508 170 L560 178 L522 214 L532 266 L480 244 L428 266 L438 214 L400 178 L452 170 Z" fill="url(#sun)" stroke="#fff1bc" stroke-width="6"/>
  <g fill="none" stroke="#8ef3df" stroke-width="6" stroke-linecap="round">
    <path d="M244 244 Q332 162 480 182 Q634 156 720 246"/>
    <path d="M276 270 Q364 204 480 214 Q598 204 684 270"/>
  </g>
  <g fill="none" stroke="#f2cf9a" stroke-width="4" opacity=".8">
    <path d="M220 92 L316 138 L220 184"/>
    <path d="M740 92 L644 138 L740 184"/>
  </g>
  <text x="480" y="328" text-anchor="middle" font-family="Cinzel, Georgia, serif" font-size="86" fill="#f8f0d7" letter-spacing="8">EMBERHOLLOW</text>
  <text x="480" y="376" text-anchor="middle" font-family="Space Mono, monospace" font-size="24" fill="#8ef3df" letter-spacing="7">BELLROOT / ECHO CAVE / STARFALL</text>
  <text x="480" y="446" text-anchor="middle" font-family="Space Mono, monospace" font-size="20" fill="#f2cf9a" letter-spacing="5">A FIRST-PERSON ADVENTURE OF PUZZLES, RELICS, AND LANTERN SONGS</text>
</svg>
`);

writeSvg('panel-ornament.svg', `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 200">
  <rect width="640" height="200" fill="none"/>
  <g fill="none" stroke="#f2cf9a" stroke-width="3" opacity=".66">
    <path d="M32 100 H256"/>
    <path d="M384 100 H608"/>
    <path d="M164 64 Q224 100 164 136"/>
    <path d="M476 64 Q416 100 476 136"/>
  </g>
  <g fill="#8ef3df" opacity=".9">
    <circle cx="320" cy="100" r="22"/>
    <circle cx="320" cy="100" r="10" fill="#1a2230"/>
    <path d="M320 32 L334 72 L376 86 L334 100 L320 168 L306 100 L264 86 L306 72 Z" fill="#ffd980"/>
  </g>
</svg>
`);

writeSvg('minimap-frame.svg', `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="frame" x1="0" x2="1">
      <stop offset="0%" stop-color="#f2cf9a"/>
      <stop offset="100%" stop-color="#8ef3df"/>
    </linearGradient>
  </defs>
  <rect x="6" y="6" width="244" height="244" rx="28" fill="none" stroke="url(#frame)" stroke-width="12"/>
  <path d="M38 30 H96 L118 52 V88" fill="none" stroke="#ffd980" stroke-width="6"/>
  <path d="M218 218 H160 L138 196 V160" fill="none" stroke="#8ef3df" stroke-width="6"/>
  <circle cx="128" cy="128" r="90" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="2"/>
</svg>
`);

writeSvg('wayfinder-badge.svg', `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <radialGradient id="g" cx="50%" cy="45%" r="55%">
      <stop offset="0%" stop-color="#fff0ba"/>
      <stop offset="55%" stop-color="#8ef3df"/>
      <stop offset="100%" stop-color="#132130"/>
    </radialGradient>
  </defs>
  <circle cx="64" cy="64" r="58" fill="url(#g)" stroke="#f2cf9a" stroke-width="8"/>
  <circle cx="64" cy="64" r="22" fill="#12202f" stroke="#f6f0d8" stroke-width="5"/>
  <path d="M64 10 L75 44 L110 64 L75 84 L64 118 L53 84 L18 64 L53 44 Z" fill="#ffd980" opacity=".9"/>
</svg>
`);

for (const [name, config] of Object.entries(THEMES)) {
  const { samples, sampleRate } = renderTheme(config);
  writeWav(path.join(audioDir, `${name}.wav`), samples, sampleRate);
}

console.log('Emberhollow assets generated.');
