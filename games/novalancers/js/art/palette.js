// Nova Lancers — master palette.
// Every art module (sprites, bosses, backgrounds, fx, hud) pulls colors from here so the
// whole game reads as one visual system. Ramps run dark -> light.

export const RAMPS = {
  // deep space / UI darks
  void:     ['#05040c', '#0a0818', '#110e26', '#1a1638', '#252050', '#322c6a'],
  // player hull steel (cool silver)
  steel:    ['#141a28', '#222b42', '#36425f', '#526283', '#7c8fb3', '#aebfdc', '#dfe8f7', '#ffffff'],
  // team energy colors (player 1..4)
  cyan:     ['#07294a', '#0b4f7e', '#1386b8', '#27c2ea', '#79ecff', '#d6fcff'],
  gold:     ['#3d2106', '#7a430b', '#bf7412', '#f0a92a', '#ffd966', '#fff5c9'],
  lime:     ['#12330f', '#22611b', '#3c9a2a', '#6fd23f', '#b8ff6e', '#eeffcf'],
  violet:   ['#221247', '#3f2388', '#6a3fd0', '#9b73ff', '#c9b0ff', '#f1e9ff'],
  // enemy "Choir" carapace (obsidian with plum undertone)
  carapace: ['#0d0912', '#181020', '#261930', '#382543', '#503559', '#6d4b74', '#93709a'],
  // enemy energy (magenta/crimson) — enemy cores, enemy bullets
  magenta:  ['#3a0822', '#700f40', '#b3175f', '#ec2f86', '#ff6fb4', '#ffc4e1'],
  // hot orange (enemy bullets, molten rock, thrusters)
  ember:    ['#3d0d05', '#7d1e08', '#c4400f', '#f7721f', '#ffab4f', '#ffe2b3'],
  // violet enemy bullets
  plasma:   ['#240a3f', '#461575', '#7424b8', '#a950f0', '#d596ff', '#f3e0ff'],
  // crystal teal (Veil Nebula, prism boss)
  crystal:  ['#082b2c', '#0f5a57', '#17907f', '#2ec9a8', '#86f4d8', '#e2fff6'],
  // fire ramp for explosions (black -> white hot)
  fire:     ['#1a0806', '#4a1409', '#8f260b', '#d4470f', '#f7811e', '#fdbb3a', '#fff0a8', '#ffffff'],
  // smoke / ash
  smoke:    ['#141119', '#221d29', '#342d3d', '#4a4254', '#645b6e', '#847b8d'],
  // score gems
  emerald:  ['#06301e', '#0b5e36', '#16935a', '#2fd184', '#8cf7bf', '#e0fff0'],
  sapphire: ['#0a1a4d', '#132f8c', '#2150d0', '#4c86ff', '#9dc0ff', '#e3eeff'],
  // warm planet/sunlight accents
  dawn:     ['#2a0f2e', '#5a1a44', '#9c2f55', '#e0565b', '#ff9466', '#ffd49a', '#fff4d6'],
  // cold planet ocean
  ocean:    ['#04121f', '#072a45', '#0c4a73', '#16729e', '#2aa0c4', '#6fd0e6', '#c8f4ff'],
  // rust / derelict hull (Leviathan Wreck)
  rust:     ['#140d0b', '#261814', '#3d251c', '#5a3526', '#7d4a31', '#a86a45', '#d19a6c'],
  // hull grey-green (derelict plating)
  hull:     ['#0e1214', '#182024', '#253036', '#36444b', '#4c5d64', '#6a7e84', '#93a7ab'],
};

// Team colors in player-slot order (P1..P4)
export const TEAM = ['cyan', 'gold', 'lime', 'violet'];
export const TEAM_HEX = ['#27c2ea', '#f0a92a', '#6fd23f', '#9b73ff'];
export const TEAM_NAMES = ['Cyan', 'Gold', 'Lime', 'Violet'];

// Handy single colors
export const C = {
  black: '#000000',
  white: '#ffffff',
  outline: '#05040c',          // universal dark outline for sprites
  enemyCore: RAMPS.magenta[3],
  enemyBulletP: RAMPS.magenta[4],
  enemyBulletO: RAMPS.ember[4],
  enemyBulletV: RAMPS.plasma[4],
  hudText: '#dfe8f7',
  hudDim: '#7c8fb3',
  hudAccent: '#79ecff',
  warn: '#ff5a5a',
  good: '#6fd23f',
};

// "#rrggbb" -> [r,g,b]
export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// Nearest color in a list of hex colors (for palette quantization in procedural art)
export function nearest(rgb, list) {
  let best = list[0], bd = Infinity;
  for (const hex of list) {
    const c = hexToRgb(hex);
    const d = (c[0] - rgb[0]) ** 2 * 0.3 + (c[1] - rgb[1]) ** 2 * 0.59 + (c[2] - rgb[2]) ** 2 * 0.11;
    if (d < bd) { bd = d; best = hex; }
  }
  return best;
}
