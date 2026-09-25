// Nova Lancers — hand-made bitmap pixel fonts for canvas text (HUD, floating score text,
// in-canvas labels). Three faces built from compact glyph strings:
//   'small' — 5x7 caps, proportional widths (default)
//   'big'   — 7x9 bold (2-px stems) for scores / banners
//   'tiny'  — 3x5 caps for dense labels
// Glyphs are baked once into a white mask atlas; per (font, color) tinted atlases are
// cached, so drawing is one drawImage per glyph with no per-call allocations.
//
// drawText(ctx, str, x, y, opt) -> width drawn (art px)
//   opt { color, align:'left'|'center'|'right', size: 1..3 (integer scale), font:'small'|'big'|'tiny',
//         shadow: color|null (1-px drop shadow), outline: color|null (1-px outline),
//         lctx: light-layer ctx|null, glow: color (defaults to color), glowAlpha: 0..1,
//         alpha: 0..1, baseline:'top'|'middle'|'bottom' (default 'top'), spacing: extra px }
//   (x, y) is the anchor; with baseline 'top' y is the top of the capitals.
// measureText(str, opt) -> width in art px (widest line for multi-line strings)

// Each glyph: rows separated by spaces, '#' = pixel on. Width = row length.
// Rows below the cap height (descenders) are allowed up to the cell height.
const SMALL = {
  h: 7, cell: 8, space: 3,
  g: {
    A: '.###. #...# #...# ##### #...# #...# #...#',
    B: '####. #...# #...# ####. #...# #...# ####.',
    C: '.###. #...# #.... #.... #.... #...# .###.',
    D: '####. #...# #...# #...# #...# #...# ####.',
    E: '##### #.... #.... ####. #.... #.... #####',
    F: '##### #.... #.... ####. #.... #.... #....',
    G: '.###. #...# #.... #.### #...# #...# .####',
    H: '#...# #...# #...# ##### #...# #...# #...#',
    I: '### .#. .#. .#. .#. .#. ###',
    J: '....# ....# ....# ....# #...# #...# .###.',
    K: '#...# #..#. #.#.. ##... #.#.. #..#. #...#',
    L: '#.... #.... #.... #.... #.... #.... #####',
    M: '#...# ##.## #.#.# #.#.# #...# #...# #...#',
    N: '#...# #...# ##..# #.#.# #..## #...# #...#',
    O: '.###. #...# #...# #...# #...# #...# .###.',
    P: '####. #...# #...# ####. #.... #.... #....',
    Q: '.###. #...# #...# #...# #.#.# #..#. .##.#',
    R: '####. #...# #...# ####. #.#.. #..#. #...#',
    S: '.#### #.... #.... .###. ....# ....# ####.',
    T: '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
    U: '#...# #...# #...# #...# #...# #...# .###.',
    V: '#...# #...# #...# #...# .#.#. .#.#. ..#..',
    W: '#...# #...# #...# #.#.# #.#.# ##.## #...#',
    X: '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
    Y: '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..',
    Z: '##### ....# ...#. ..#.. .#... #.... #####',
    0: '.###. #...# #..## #.#.# ##..# #...# .###.',
    1: '..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.',
    2: '.###. #...# ....# ...#. ..#.. .#... #####',
    3: '##### ...#. ..#.. ...#. ....# #...# .###.',
    4: '...#. ..##. .#.#. #..#. ##### ...#. ...#.',
    5: '##### #.... ####. ....# ....# #...# .###.',
    6: '..##. .#... #.... ####. #...# #...# .###.',
    7: '##### ....# ...#. ..#.. .#... .#... .#...',
    8: '.###. #...# #...# .###. #...# #...# .###.',
    9: '.###. #...# #...# .#### ....# ...#. .##..',
    '.': '. . . . . . #',
    ',': '.. .. .. .. .. .# .# #.',
    ':': '. . # . . # .',
    ';': '.. .. .# .. .. .# .# #.',
    '!': '# # # # # . #',
    '?': '.###. #...# ....# ...#. ..#.. ..... ..#..',
    "'": '# # . . . . .',
    '"': '#.# #.# ... ... ... ... ...',
    '-': '.... .... .... #### .... .... ....',
    '+': '..... ..#.. ..#.. ##### ..#.. ..#.. .....',
    '/': '....# ...#. ...#. ..#.. .#... .#... #....',
    '(': '..# .#. #.. #.. #.. .#. ..#',
    ')': '#.. .#. ..# ..# ..# .#. #..',
    '[': '## #. #. #. #. #. ##',
    ']': '## .# .# .# .# .# ##',
    '%': '##..# ##..# ...#. ..#.. .#... #..## #..##',
    '#': '.#.#. .#.#. ##### .#.#. ##### .#.#. .#.#.',
    '×': '..... ..... #...# .#.#. ..#.. .#.#. #...#',
    '*': '..... #.#.# .###. ##### .###. #.#.# .....',
    '=': '.... .... #### .... #### .... ....',
    '<': '...# ..#. .#.. #... .#.. ..#. ...#',
    '>': '#... .#.. ..#. ...# ..#. .#.. #...',
    '_': '.... .... .... .... .... .... ####',
    '|': '# # # # # # #',
    '&': '.##.. #..#. #.#.. .#... #.#.# #..#. .##.#',
    '·': '. . . # . . .',
    '—': '...... ...... ...... ###### ...... ...... ......',
    '→': '..... ..#.. ...#. ##### ...#. ..#.. .....',
    '←': '..... ..#.. .#... ##### .#... ..#.. .....',
    '↑': '..#.. .###. #.#.# ..#.. ..#.. ..#.. ..#..',
    '↓': '..#.. ..#.. ..#.. ..#.. #.#.# .###. ..#..',
    '★': '...#... ..###.. ####### .#####. ..###.. .##.##. .#...#.',
    '♥': '....... .##.##. ####### ####### .#####. ..###.. ...#...',
    '✓': '..... ....# ...## #.##. ###.. .#... .....',
    '▲': '..... ..#.. .###. ##### ..... ..... .....',
    '▼': '..... ##### .###. ..#.. ..... ..... .....',
  },
};

const BIG = {
  h: 9, cell: 10, space: 4,
  g: {
    A: '.#####. ##...## ##...## ##...## ####### ##...## ##...## ##...## ##...##',
    B: '######. ##...## ##...## ##...## ######. ##...## ##...## ##...## ######.',
    C: '.#####. ##...## ##..... ##..... ##..... ##..... ##..... ##...## .#####.',
    D: '######. ##...## ##...## ##...## ##...## ##...## ##...## ##...## ######.',
    E: '####### ##..... ##..... ##..... ######. ##..... ##..... ##..... #######',
    F: '####### ##..... ##..... ##..... ######. ##..... ##..... ##..... ##.....',
    G: '.#####. ##...## ##..... ##..... ##..### ##...## ##...## ##...## .######',
    H: '##...## ##...## ##...## ##...## ####### ##...## ##...## ##...## ##...##',
    I: '#### .##. .##. .##. .##. .##. .##. .##. ####',
    J: '.....## .....## .....## .....## .....## .....## ##...## ##...## .#####.',
    K: '##...## ##..##. ##.##.. ####... ###.... ####... ##.##.. ##..##. ##...##',
    L: '##..... ##..... ##..... ##..... ##..... ##..... ##..... ##..... #######',
    M: '##...## ###.### ####### ##.#.## ##...## ##...## ##...## ##...## ##...##',
    N: '##...## ##...## ###..## ####.## ##.#### ##..### ##...## ##...## ##...##',
    O: '.#####. ##...## ##...## ##...## ##...## ##...## ##...## ##...## .#####.',
    P: '######. ##...## ##...## ##...## ######. ##..... ##..... ##..... ##.....',
    Q: '.#####. ##...## ##...## ##...## ##...## ##...## ##.#### ##..##. .###.##',
    R: '######. ##...## ##...## ##...## ######. ##.##.. ##..##. ##...## ##...##',
    S: '.#####. ##...## ##..... ##..... .#####. .....## .....## ##...## .#####.',
    T: '######## ...##... ...##... ...##... ...##... ...##... ...##... ...##... ...##...',
    U: '##...## ##...## ##...## ##...## ##...## ##...## ##...## ##...## .#####.',
    V: '##...## ##...## ##...## ##...## ##...## .##.##. .##.##. ..###.. ...#...',
    W: '##...## ##...## ##...## ##...## ##.#.## ##.#.## ####### ###.### ##...##',
    X: '##...## ##...## .##.##. ..###.. ...#... ..###.. .##.##. ##...## ##...##',
    Y: '##....## ##....## .##..##. ..####.. ...##... ...##... ...##... ...##... ...##...',
    Z: '####### .....## .....## ....##. ...##.. ..##... .##.... ##..... #######',
    0: '.#####. ##...## ##...## ##..### ##.#.## ###..## ##...## ##...## .#####.',
    1: '...##.. ..###.. .####.. ...##.. ...##.. ...##.. ...##.. ...##.. .######',
    2: '.#####. ##...## .....## .....## ..####. .##.... ##..... ##..... #######',
    3: '.#####. ##...## .....## .....## ..####. .....## .....## ##...## .#####.',
    4: '##...## ##...## ##...## ##...## ####### .....## .....## .....## .....##',
    5: '####### ##..... ##..... ######. .....## .....## .....## ##...## .#####.',
    6: '.#####. ##...## ##..... ##..... ######. ##...## ##...## ##...## .#####.',
    7: '####### .....## .....## ....##. ...##.. ..##... ..##... ..##... ..##...',
    8: '.#####. ##...## ##...## ##...## .#####. ##...## ##...## ##...## .#####.',
    9: '.#####. ##...## ##...## ##...## .###### .....## .....## ##...## .#####.',
    '.': '.. .. .. .. .. .. .. ## ##',
    ',': '.. .. .. .. .. .. .. ## ## #.',
    ':': '.. .. ## ## .. .. ## ## ..',
    ';': '.. .. ## ## .. .. ## ## #.',
    '!': '## ## ## ## ## ## .. ## ##',
    '?': '.#####. ##...## .....## ....##. ...##.. ...##.. ....... ...##.. ...##..',
    "'": '## ## #. .. .. .. .. .. ..',
    '"': '##.## ##.## #..#. ..... ..... ..... ..... ..... .....',
    '-': '..... ..... ..... ..... ##### ..... ..... ..... .....',
    '+': '...... ...... ..##.. ..##.. ###### ..##.. ..##.. ...... ......',
    '/': '....## ....## ...##. ...##. ..##.. .##... .##... ##.... ##....',
    '(': '..## .##. ##.. ##.. ##.. ##.. ##.. .##. ..##',
    ')': '##.. .##. ..## ..## ..## ..## ..## .##. ##..',
    '[': '#### ##.. ##.. ##.. ##.. ##.. ##.. ##.. ####',
    ']': '#### ..## ..## ..## ..## ..## ..## ..## ####',
    '%': '....... ##....# ##...## ....##. ...##.. ..##... .##.... ##...## #....##',
    '#': '.##.##. .##.##. ####### .##.##. .##.##. .##.##. ####### .##.##. .##.##.',
    '×': '...... ...... ...... ##..## .####. ..##.. .####. ##..## ......',
    '*': '...... #.##.# .####. ###### .####. #.##.# ...... ...... ......',
    '=': '...... ...... ...... ###### ...... ###### ...... ...... ......',
    '<': '...... ....## ...##. ..##.. .##... ..##.. ...##. ....## ......',
    '>': '...... ##.... .##... ..##.. ...##. ..##.. .##... ##.... ......',
    '_': '####### ....... ....... ....... ....... ....... ....... ....... #######',
    '|': '## ## ## ## ## ## ## ## ##',
    '&': '.###... ##.##.. ##.##.. .###... .###.## ##.###. ##..##. ##.###. .###.##',
    '·': '.. .. .. .. ## ## .. .. ..',
    '—': '........ ........ ........ ........ ######## ........ ........ ........ ........',
    '→': '........ ....##.. .....##. ######## ######## .....##. ....##.. ........ ........',
    '←': '........ ..##.... .##..... ######## ######## .##..... ..##.... ........ ........',
    '↑': '...#... ..###.. .#####. ##.#.## ...#... ...#... ...#... ...#... ...#...',
    '↓': '...#... ...#... ...#... ...#... ...#... ##.#.## .#####. ..###.. ...#...',
    '★': '....#.... ...###... ...###... ######### .#######. ..#####.. ..##.##.. .##...##. .#.....#.',
    '♥': '.##...##. ####.#### ######### ######### .#######. ..#####.. ...###... ....#.... .........',
    '✓': '....... ......# .....## ....##. ##.##.. .###... ..#.... ....... .......',
    '▲': '....... ...#... ..###.. .#####. ####### ....... ....... ....... .......',
    '▼': '....... ####### .#####. ..###.. ...#... ....... ....... ....... .......',
  },
};
// Fix the underscore: only the bottom row.
BIG.g._ = '....... ....... ....... ....... ....... ....... ....... ....... #######';

const TINY = {
  h: 5, cell: 6, space: 2,
  g: {
    A: '.#. #.# ### #.# #.#',
    B: '##. #.# ##. #.# ##.',
    C: '.## #.. #.. #.. .##',
    D: '##. #.# #.# #.# ##.',
    E: '### #.. ##. #.. ###',
    F: '### #.. ##. #.. #..',
    G: '.## #.. #.# #.# .##',
    H: '#.# #.# ### #.# #.#',
    I: '### .#. .#. .#. ###',
    J: '..# ..# ..# #.# .#.',
    K: '#.# #.# ##. #.# #.#',
    L: '#.. #.. #.. #.. ###',
    M: '#...# ##.## #.#.# #...# #...#',
    N: '#..# ##.# #.## #..# #..#',
    O: '.#. #.# #.# #.# .#.',
    P: '##. #.# ##. #.. #..',
    Q: '.#. #.# #.# ##. .##',
    R: '##. #.# ##. #.# #.#',
    S: '.## #.. .#. ..# ##.',
    T: '### .#. .#. .#. .#.',
    U: '#.# #.# #.# #.# ###',
    V: '#.# #.# #.# #.# .#.',
    W: '#...# #...# #.#.# ##.## #...#',
    X: '#.# #.# .#. #.# #.#',
    Y: '#.# #.# .#. .#. .#.',
    Z: '### ..# .#. #.. ###',
    0: '### #.# #.# #.# ###',
    1: '.#. ##. .#. .#. ###',
    2: '##. ..# .#. #.. ###',
    3: '##. ..# .#. ..# ##.',
    4: '#.# #.# ### ..# ..#',
    5: '### #.. ##. ..# ##.',
    6: '.## #.. ### #.# ###',
    7: '### ..# .#. .#. .#.',
    8: '### #.# ### #.# ###',
    9: '### #.# ### ..# ##.',
    '.': '. . . . #',
    ',': '. . . . # #',
    ':': '. # . # .',
    '!': '# # # . #',
    '?': '##. ..# .#. ... .#.',
    "'": '# # . . .',
    '-': '.. .. ## .. ..',
    '+': '... .#. ### .#. ...',
    '/': '..# ..# .#. #.. #..',
    '(': '.# #. #. #. .#',
    ')': '#. .# .# .# #.',
    '%': '#.# ..# .#. #.. #.#',
    '×': '... #.# .#. #.# ...',
    '=': '... ### ... ### ...',
    '<': '..# .#. #.. .#. ..#',
    '>': '#.. .#. ..# .#. #..',
    '·': '. . # . .',
    '—': '.... .... #### .... ....',
    '→': '.... ..#. #### ..#. ....',
    '←': '.... .#.. #### .#.. ....',
    '↑': '.#. ### .#. .#. .#.',
    '↓': '.#. .#. .#. ### .#.',
    '★': '..#.. ##### .###. .#.#. #...#',
    '♥': '.#.#. ##### ##### .###. ..#..',
    '✓': '... ..# #.# .#. ...',
    '▲': '... .#. ### ... ...',
    '▼': '... ### .#. ... ...',
    '|': '# # # # #',
  },
};

// ---------------------------------------------------------------------------------------
// Atlas building

const FONT_DEFS = { small: SMALL, big: BIG, tiny: TINY };
const FONTS = {};

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function buildFont(name) {
  const def = FONT_DEFS[name];
  const glyphs = [];
  let x = 1;
  for (const ch of Object.keys(def.g)) {
    const rows = def.g[ch].split(' ');
    const w = rows[0].length;
    glyphs.push({ ch, rows, w, sx: x });
    x += w + 2;               // 2-px gutter so 1-px outlines never bleed into neighbours
  }
  const aw = x + 1, ah = def.cell + 2;
  const mask = makeCanvas(aw, ah);
  const g = mask.getContext('2d');
  g.fillStyle = '#fff';
  for (const gl of glyphs) {
    gl.rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) if (row[rx] === '#') g.fillRect(gl.sx + rx, 1 + ry, 1, 1);
    });
  }
  // Dilated mask (for outlines and soft glows): mask stamped at the 8 neighbours.
  const dil = makeCanvas(aw, ah);
  const dg = dil.getContext('2d');
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) dg.drawImage(mask, ox, oy);

  // Lookup: ASCII table + Map for everything else; lowercase maps to uppercase.
  const ascii = new Array(128).fill(null);
  const map = new Map();
  for (const gl of glyphs) {
    const code = gl.ch.charCodeAt(0);
    if (code < 128) ascii[code] = gl; else map.set(code, gl);
  }
  for (let c = 97; c <= 122; c++) if (!ascii[c]) ascii[c] = ascii[c - 32];
  // Friendly aliases
  const alias = (from, to) => { const gl = map.get(to.charCodeAt(0)) || ascii[to.charCodeAt(0)]; if (gl) map.set(from.charCodeAt(0), gl); };
  alias('–', '—'); alias('✔', '✓'); alias('❤', '♥'); alias('☆', '★'); alias('•', '·'); alias('’', "'");
  alias('▶', '→'); alias('◀', '←');

  return {
    name, h: def.h, cell: def.cell, space: def.space,
    mask, dil, ascii, map, tints: new Map(), dtints: new Map(),
  };
}

function font(name) {
  const key = FONT_DEFS[name] ? name : 'small';
  return FONTS[key] || (FONTS[key] = buildFont(key));
}

function glyphOf(f, code) {
  return code < 128 ? f.ascii[code] : f.map.get(code) || null;
}

const MAX_TINTS = 48;
function tinted(f, color, dilated) {
  const cache = dilated ? f.dtints : f.tints;
  let c = cache.get(color);
  if (c) return c;
  const src = dilated ? f.dil : f.mask;
  c = makeCanvas(src.width, src.height);
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  if (cache.size >= MAX_TINTS) cache.delete(cache.keys().next().value);
  cache.set(color, c);
  return c;
}

// ---------------------------------------------------------------------------------------
// Public API

const EMPTY = {};
const DEFAULT_COLOR = '#dfe8f7';

function lineWidth(f, str, from, to, spacing) {
  let w = 0, n = 0;
  for (let i = from; i < to; i++) {
    const code = str.charCodeAt(i);
    if (code === 32) { w += f.space; n++; continue; }
    const gl = glyphOf(f, code);
    w += gl ? gl.w : f.space;
    n++;
  }
  return n > 0 ? w + (n - 1) * (1 + spacing) : 0;
}

export function measureText(str, opt = EMPTY) {
  str = String(str);
  const f = font(opt.font || 'small');
  const size = Math.max(1, Math.min(8, opt.size | 0 || 1));
  const spacing = opt.spacing | 0;
  let best = 0, start = 0;
  for (let i = 0; i <= str.length; i++) {
    if (i === str.length || str.charCodeAt(i) === 10) {
      const w = lineWidth(f, str, start, i, spacing);
      if (w > best) best = w;
      start = i + 1;
    }
  }
  return best * size;
}

// Cap height (px) for a font/size; line advance is cell + 2.
export function textHeight(opt = EMPTY) {
  const f = font(opt.font || 'small');
  return f.h * Math.max(1, opt.size | 0 || 1);
}
export function lineHeight(opt = EMPTY) {
  const f = font(opt.font || 'small');
  return (f.cell + 2) * Math.max(1, opt.size | 0 || 1);
}

function drawRun(ctx, atlas, f, str, from, to, x, y, size, spacing, dil) {
  const pad = dil ? 1 : 0;
  const h = f.cell + pad * 2;
  const sy = 1 - pad;
  let cx = x;
  for (let i = from; i < to; i++) {
    const code = str.charCodeAt(i);
    if (code === 32) { cx += (f.space + 1 + spacing) * size; continue; }
    const gl = glyphOf(f, code);
    if (!gl) { cx += (f.space + 1 + spacing) * size; continue; }
    ctx.drawImage(atlas, gl.sx - pad, sy, gl.w + pad * 2, h,
      cx - pad * size, y - pad * size, (gl.w + pad * 2) * size, h * size);
    cx += (gl.w + 1 + spacing) * size;
  }
}

// Pre-rendered strings for opt.cache (static labels/names drawn every frame): one drawImage
// instead of one per glyph (x2 with shadow/outline, x2 again for the glow layer).
const strCache = new Map();
const STR_MAX = 160;
function cachedText(str, f, size, spacing, opt, glow) {
  const key = `${f.name}|${size}|${spacing}|${glow ? 'G' + (opt.glow || opt.color) : (opt.color || '') + '|' + (opt.shadow || '') + '|' + (opt.outline || '')}|${str}`;
  let c = strCache.get(key);
  if (c) { strCache.delete(key); strCache.set(key, c); return c; }   // refresh LRU position
  const pad = size * 2;
  const w = lineWidth(f, str, 0, str.length, spacing) * size;
  c = makeCanvas(Math.max(1, w + pad * 2), (f.cell + 2) * size + pad * 2);
  const g = c.getContext('2d');
  if (glow) {
    drawText(g, str, pad, pad, { font: f.name, size, spacing, glowOnly: true, lctx: g, glow: opt.glow || opt.color || DEFAULT_COLOR });
  } else {
    drawText(g, str, pad, pad, { font: f.name, size, spacing, color: opt.color, shadow: opt.shadow, outline: opt.outline });
  }
  c.pad = pad;
  if (strCache.size >= STR_MAX) strCache.delete(strCache.keys().next().value);
  strCache.set(key, c);
  return c;
}

export function drawText(ctx, str, x, y, opt = EMPTY) {
  if (!ctx || str == null) return 0;
  str = typeof str === 'string' ? str : String(str);
  if (opt.cache && str.indexOf('\n') < 0 && str.length) return drawCached(ctx, str, x, y, opt);
  const f = font(opt.font || 'small');
  const size = Math.max(1, Math.min(8, opt.size | 0 || 1));
  const spacing = opt.spacing | 0;
  const color = opt.color || DEFAULT_COLOR;
  const align = opt.align || 'left';
  const alpha = opt.alpha == null ? 1 : opt.alpha;
  if (alpha <= 0) return 0;
  const lineAdv = (f.cell + 2) * size;

  let lines = 1;
  for (let i = 0; i < str.length; i++) if (str.charCodeAt(i) === 10) lines++;
  let top = Math.round(y);
  if (opt.baseline === 'middle') top = Math.round(y - (f.h * size + (lines - 1) * lineAdv) / 2);
  else if (opt.baseline === 'bottom') top = Math.round(y - f.h * size - (lines - 1) * lineAdv);

  const main = opt.glowOnly ? null : tinted(f, color, false);
  const shadow = opt.shadow ? tinted(f, opt.shadow, false) : null;
  const outline = opt.outline ? tinted(f, opt.outline, true) : null;
  const lctx = opt.lctx || null;
  const glowCol = opt.glow || color;
  const glowAtlas = lctx ? tinted(f, glowCol, false) : null;
  const glowDil = lctx ? tinted(f, glowCol, true) : null;
  const glowAlpha = opt.glowAlpha == null ? 1 : opt.glowAlpha;

  const prevA = ctx.globalAlpha;
  ctx.imageSmoothingEnabled = false;
  let maxW = 0, start = 0, ly = top;
  for (let i = 0; i <= str.length; i++) {
    if (i !== str.length && str.charCodeAt(i) !== 10) continue;
    const w = lineWidth(f, str, start, i, spacing) * size;
    if (w > maxW) maxW = w;
    let lx = Math.round(x);
    if (align === 'center') lx = Math.round(x - w / 2);
    else if (align === 'right') lx = Math.round(x - w);
    ctx.globalAlpha = prevA * alpha;
    if (!opt.glowOnly) {
      if (outline) drawRun(ctx, outline, f, str, start, i, lx, ly, size, spacing, true);
      if (shadow) drawRun(ctx, shadow, f, str, start, i, lx + size, ly + size, size, spacing, false);
      drawRun(ctx, main, f, str, start, i, lx, ly, size, spacing, false);
    }
    if (lctx) {
      const la = lctx.globalAlpha;
      lctx.imageSmoothingEnabled = false;
      lctx.globalAlpha = la * alpha * glowAlpha * 0.16;
      drawRun(lctx, glowDil, f, str, start, i, lx, ly, size, spacing, true);
      lctx.globalAlpha = la * alpha * glowAlpha;
      drawRun(lctx, glowAtlas, f, str, start, i, lx, ly, size, spacing, false);
      lctx.globalAlpha = la;
    }
    ly += lineAdv;
    start = i + 1;
  }
  ctx.globalAlpha = prevA;
  return maxW;
}

function drawCached(ctx, str, x, y, opt) {
  const f = font(opt.font || 'small');
  const size = Math.max(1, Math.min(8, opt.size | 0 || 1));
  const spacing = opt.spacing | 0;
  const alpha = opt.alpha == null ? 1 : opt.alpha;
  const w = lineWidth(f, str, 0, str.length, spacing) * size;
  if (alpha <= 0) return w;
  let lx = Math.round(x);
  if (opt.align === 'center') lx = Math.round(x - w / 2);
  else if (opt.align === 'right') lx = Math.round(x - w);
  let top = Math.round(y);
  if (opt.baseline === 'middle') top = Math.round(y - (f.h * size) / 2);
  else if (opt.baseline === 'bottom') top = Math.round(y - f.h * size);
  const c = cachedText(str, f, size, spacing, opt, false);
  const pa = ctx.globalAlpha;
  ctx.imageSmoothingEnabled = false;
  if (alpha !== 1) ctx.globalAlpha = pa * alpha;
  ctx.drawImage(c, lx - c.pad, top - c.pad);
  ctx.globalAlpha = pa;
  const lctx = opt.lctx;
  if (lctx) {
    const gcv = cachedText(str, f, size, spacing, opt, true);
    const la = lctx.globalAlpha;
    lctx.imageSmoothingEnabled = false;
    lctx.globalAlpha = la * alpha * (opt.glowAlpha == null ? 1 : opt.glowAlpha);
    lctx.drawImage(gcv, lx - gcv.pad, top - gcv.pad);
    lctx.globalAlpha = la;
  }
  return w;
}

// Every character each face can draw (for specimen / tests).
export function fontGlyphs(name = 'small') {
  return Object.keys((FONT_DEFS[name] || SMALL).g).join('');
}
