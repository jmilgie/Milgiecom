import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const uiDir = path.join(root, 'assets', 'ui');
const audioDir = path.join(root, 'assets', 'audio');
const iconDir = path.join(uiDir, 'icons');
const portraitDir = path.join(uiDir, 'portraits');

fs.mkdirSync(uiDir, { recursive: true });
fs.mkdirSync(audioDir, { recursive: true });
fs.mkdirSync(iconDir, { recursive: true });
fs.mkdirSync(portraitDir, { recursive: true });

function writeSvg(name, svg) {
  fs.writeFileSync(path.join(uiDir, name), svg.trimStart(), 'utf8');
}

function writeNestedSvg(folder, name, svg) {
  const dir = path.join(uiDir, folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), svg.trimStart(), 'utf8');
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

function hashSeed(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeRng(seedValue) {
  let state = hashSeed(seedValue) || 1;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

function addNoise(samples, sampleRate, start, duration, volume, decay = 6, random = Math.random) {
  const startIndex = Math.floor(start * sampleRate);
  const length = Math.floor(duration * sampleRate);
  for (let i = 0; i < length && startIndex + i < samples.length; i += 1) {
    const t = i / sampleRate;
    const env = Math.exp(-t * decay);
    samples[startIndex + i] += (random() * 2 - 1) * env * volume;
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

function renderTheme(config, seedLabel) {
  const sampleRate = 16000;
  const duration = 16;
  const samples = new Float32Array(sampleRate * duration);
  const steps = Math.floor(duration / config.step);
  const random = makeRng(seedLabel);

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
      addNoise(samples, sampleRate, time, 0.06, config.percussion, 10, random);
    }
    if (step % 4 === 2) {
      addNoise(samples, sampleRate, time + 0.18, 0.04, config.percussion * 0.6, 13, random);
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

function writeIcon(name, accent, markup, glow = '#fff0ba') {
  writeNestedSvg('icons', `${name}.svg`, `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg-${name}" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#1b2637"/>
      <stop offset="100%" stop-color="#0d131d"/>
    </linearGradient>
    <radialGradient id="halo-${name}" cx="50%" cy="42%" r="55%">
      <stop offset="0%" stop-color="${glow}" stop-opacity=".78"/>
      <stop offset="100%" stop-color="${glow}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#bg-${name})"/>
  <circle cx="64" cy="56" r="42" fill="url(#halo-${name})"/>
  <circle cx="64" cy="64" r="42" fill="none" stroke="#f2cf9a" stroke-width="5"/>
  <g fill="none" stroke="${accent}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">
    ${markup}
  </g>
  <circle cx="64" cy="64" r="53" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="2"/>
</svg>
`);
}

function writePortrait(name, config) {
  writeNestedSvg('portraits', `${name}.svg`, `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 440">
  <defs>
    <linearGradient id="bg-${name}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${config.skyTop}"/>
      <stop offset="100%" stop-color="${config.skyBottom}"/>
    </linearGradient>
    <radialGradient id="glow-${name}" cx="72%" cy="24%" r="36%">
      <stop offset="0%" stop-color="${config.glow}" stop-opacity=".86"/>
      <stop offset="100%" stop-color="${config.glow}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="360" height="440" rx="34" fill="url(#bg-${name})"/>
  <circle cx="274" cy="92" r="96" fill="url(#glow-${name})"/>
  <path d="M0 286 C70 224 122 232 182 240 C244 250 290 214 360 204 V440 H0 Z" fill="#253646"/>
  <path d="M0 326 C82 282 136 288 200 300 C270 314 320 284 360 268 V440 H0 Z" fill="${config.trim}"/>
  <path d="M38 438 L64 334 Q116 258 180 250 Q246 258 296 334 L322 438 Z" fill="${config.robe}"/>
  <path d="M100 438 L120 338 Q138 292 180 286 Q222 292 240 338 L260 438 Z" fill="${config.trim}" opacity=".72"/>
  <ellipse cx="180" cy="214" rx="68" ry="82" fill="${config.skin}"/>
  <path d="M112 226 Q110 144 180 142 Q250 144 248 226 L232 184 Q216 164 180 162 Q144 164 128 184 Z" fill="${config.hair}"/>
  <circle cx="154" cy="220" r="5" fill="#171512"/>
  <circle cx="206" cy="220" r="5" fill="#171512"/>
  <path d="M162 254 Q180 264 198 254" fill="none" stroke="#7a443f" stroke-width="4" stroke-linecap="round"/>
  <circle cx="286" cy="312" r="36" fill="rgba(12,17,26,.48)" stroke="#f2cf9a" stroke-width="4"/>
  <path d="${config.sigil}" fill="none" stroke="${config.accent}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  ${config.extra || ''}
  <text x="180" y="402" text-anchor="middle" font-family="Cinzel, Georgia, serif" font-size="24" fill="#f8f0d7" letter-spacing="2">${config.label}</text>
</svg>
`);
}

writeIcon('spark-bolt', '#ffd980', `
  <path d="M76 28 L50 64 H70 L54 100 L84 58 H62 Z"/>
  <path d="M32 86 Q44 70 56 72"/>
  <path d="M88 42 Q98 50 100 62"/>
`);

writeIcon('glow-lantern', '#8ef3df', `
  <path d="M44 48 H84"/>
  <path d="M52 48 V88 Q64 100 76 88 V48"/>
  <path d="M58 40 Q64 28 70 40"/>
  <path d="M58 66 Q64 54 70 66 Q64 76 58 66 Z" fill="#ffd980" stroke="#ffd980"/>
`, '#8ef3df');

writeIcon('dash-boots', '#ff9a5d', `
  <path d="M36 78 L58 56 L70 56 L74 70 L92 76 L92 88 H38 Z"/>
  <path d="M74 52 L92 40"/>
  <path d="M80 62 L104 54"/>
`);

writeIcon('aether-hook', '#8ef3df', `
  <path d="M80 34 Q92 44 92 62 Q92 88 64 88 Q42 88 42 72 Q42 60 56 56"/>
  <path d="M64 88 L54 102"/>
  <path d="M80 34 L72 50"/>
  <circle cx="62" cy="54" r="10"/>
`, '#9bdcff');

writeIcon('forge-heart', '#ff6b8d', `
  <path d="M50 46 Q38 32 26 48 Q20 64 34 76 L64 100 L94 76 Q108 64 102 48 Q90 32 78 46 Q70 56 64 62 Q58 56 50 46 Z" fill="#ff6b8d" stroke="#ff6b8d"/>
  <path d="M42 94 H86"/>
  <path d="M54 82 V106"/>
  <path d="M74 82 V106"/>
`, '#ff9da4');

writeIcon('wayfinder-lens', '#8ef3df', `
  <circle cx="58" cy="58" r="24"/>
  <path d="M74 74 L96 96"/>
  <path d="M58 30 V46"/>
  <path d="M58 70 V86"/>
  <path d="M30 58 H46"/>
  <path d="M70 58 H86"/>
`, '#8ef3df');

writeIcon('starfall-core', '#ffd980', `
  <path d="M64 20 L76 52 L108 64 L76 76 L64 108 L52 76 L20 64 L52 52 Z" fill="#ffd980" stroke="#ffd980"/>
  <circle cx="64" cy="64" r="14" stroke="#ff6b8d"/>
`, '#ffd980');

writePortrait('elder-suri', {
  label: 'Elder Suri',
  skyTop: '#1d2a3c',
  skyBottom: '#422b26',
  glow: '#ffd980',
  robe: '#5e6d86',
  trim: '#314960',
  skin: '#e0b996',
  hair: '#dad8dd',
  accent: '#ffd980',
  sigil: 'M286 288 L296 312 L320 322 L296 332 L286 356 L276 332 L252 322 L276 312 Z',
  extra: '<path d="M144 264 Q180 300 216 264" fill="#dad8dd" opacity=".86"/>',
});

writePortrait('brakka-smith', {
  label: 'Brakka Forgehand',
  skyTop: '#261d22',
  skyBottom: '#553322',
  glow: '#ff9a5d',
  robe: '#704638',
  trim: '#aa6b42',
  skin: '#c79069',
  hair: '#3a2c26',
  accent: '#ffcb72',
  sigil: 'M262 306 H310 M276 290 V338 M256 338 H316',
  extra: '<rect x="132" y="282" width="96" height="84" rx="18" fill="#3a2c26" opacity=".32"/>',
});

writePortrait('pippin-bard', {
  label: 'Pippin the Bard',
  skyTop: '#1a2440',
  skyBottom: '#3b2444',
  glow: '#8ef3df',
  robe: '#5a386d',
  trim: '#2c8a88',
  skin: '#e0b090',
  hair: '#18233c',
  accent: '#8ef3df',
  sigil: 'M264 340 Q286 278 308 340 M254 324 H318 M270 300 H302',
  extra: '<path d="M130 188 Q180 120 230 188" fill="#18233c"/>',
});

writePortrait('mara-cartographer', {
  label: 'Mara Cartographer',
  skyTop: '#15263a',
  skyBottom: '#234155',
  glow: '#8ef3df',
  robe: '#3a5b6b',
  trim: '#d9b56f',
  skin: '#ddb493',
  hair: '#f1d5a8',
  accent: '#8ef3df',
  sigil: 'M256 332 L286 292 L316 332 M286 292 V356',
  extra: '<path d="M128 176 Q180 132 232 176" fill="#f1d5a8"/>',
});

writePortrait('ilya-glassweaver', {
  label: 'Ilya Glassweaver',
  skyTop: '#1b2a34',
  skyBottom: '#2c4251',
  glow: '#9bdcff',
  robe: '#41637b',
  trim: '#8ef3df',
  skin: '#dfb698',
  hair: '#5e4b58',
  accent: '#9bdcff',
  sigil: 'M286 286 L320 320 L286 354 L252 320 Z M286 298 L308 320 L286 342 L264 320 Z',
  extra: '<path d="M136 170 Q180 144 224 170" fill="#5e4b58"/>',
});

writePortrait('choir-king', {
  label: 'Choir King',
  skyTop: '#130f18',
  skyBottom: '#351a25',
  glow: '#ff6b8d',
  robe: '#3f2437',
  trim: '#7b2b4d',
  skin: '#d6d0d8',
  hair: '#f2cf9a',
  accent: '#ff6b8d',
  sigil: 'M286 284 L302 320 L338 336 L302 352 L286 388 L270 352 L234 336 L270 320 Z',
  extra: '<path d="M126 160 L146 118 L180 150 L214 118 L234 160" fill="none" stroke="#f2cf9a" stroke-width="10" stroke-linejoin="round"/>',
});

for (const [name, config] of Object.entries(THEMES)) {
  const { samples, sampleRate } = renderTheme(config, name);
  writeWav(path.join(audioDir, `${name}.wav`), samples, sampleRate);
}

console.log('Emberhollow assets generated.');
