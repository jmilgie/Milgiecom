// Nova Lancers — sprite registry + all non-boss sprite art.
//
// Every sprite is generated at boot from hand-authored ASCII pixel maps (ships, enemies,
// glyphs) or small procedural painters (bullets, asteroids, gems, shields), then baked into
// atlas pages: per frame a color layer, an emissive (glow) layer and a white hit-flash
// silhouette, with team variants for teamed sprites. Drawing is a single drawImage from an
// atlas page.
//
// Contract: DESIGN.md §5.

import { RAMPS, TEAM, C } from './palette.js';
import {
  TAU, makeCanvas, packHex, pack, withAlpha, scaleRGB, mix, newArt, cloneArt, plot, blit,
  whiteOf, parseMap, legend, makeRampShifter, recolorMap, recolorArt, outline, rimLight,
  despeckle, makeRotator, remapColumns, pxToImageData, rng, hash2, vnoise, fbm, bayer,
  ditherIndex, sphereLight, lambert, pointInPoly, forEachPixel, emissiveFrom, flipArtX,
  cropArt, R_, G_, B_, A_,
} from './pixel.js';

// =======================================================================================
// Registry, atlas and draw API
// =======================================================================================

const REG = new Map();
const PAGE_W = 1024;
const PAGE_MAX_H = 2048;

// Pending atlas entries (packed at the end of the build, sorted by height for density).
let pending = [];
const pages = [];

function atlasAdd(px, w, h) {
  const ref = { img: null, sx: 0, sy: 0, w, h };
  pending.push({ px, w, h, ref });
  return ref;
}

function atlasFlush() {
  if (!pending.length) return;
  pending.sort((a, b) => b.h - a.h || b.w - a.w);
  let page = null, x = 0, y = 0, shelf = 0;
  const open = () => {
    page = { buf: new Uint32Array(PAGE_W * PAGE_MAX_H), used: 0, refs: [] };
    pages.push(page);
    x = 1; y = 1; shelf = 0;
  };
  open();
  for (const it of pending) {
    if (x + it.w + 1 > PAGE_W) { x = 1; y += shelf + 1; shelf = 0; }
    if (y + it.h + 1 > PAGE_MAX_H) open();
    const { buf } = page;
    for (let r = 0; r < it.h; r++) buf.set(it.px.subarray(r * it.w, r * it.w + it.w), (y + r) * PAGE_W + x);
    it.ref.sx = x; it.ref.sy = y;
    page.refs.push(it.ref);
    x += it.w + 1;
    shelf = Math.max(shelf, it.h);
    page.used = Math.max(page.used, y + it.h + 1);
  }
  pending = [];
  for (const p of pages) {
    if (p.canvas || !p.buf) continue;
    const h = Math.max(1, p.used);
    const cv = makeCanvas(PAGE_W, h);
    cv.getContext('2d').putImageData(pxToImageData(p.buf.subarray(0, PAGE_W * h), PAGE_W, h), 0, 0);
    p.canvas = cv;
    for (const r of p.refs) r.img = cv;
    p.buf = null; // free the CPU copy
  }
}

// Internal sprite: public fields { name, w, h, frames, dirs, fps, emissive, teamed } plus
// _col[team][i], _emi[team][i] | null, _white[i] (refs), i = dirIndex * frames + frame.
function makeEntry(name, w, h, frames, dirs, fps, teamed) {
  return {
    name, w, h, frames, dirs, fps, emissive: false, teamed,
    _col: null, _emi: null, _white: null, _dirK: dirs / TAU,
  };
}

// Team recolor maps: cyan ramp -> team ramp, including the dimmed emissive intensities
// used by legends (EMI_K), so glow layers recolor exactly too.
const EMI_K = [0.75, 0.5, 0.3];
const TEAM_MAPS = TEAM.map((t) => {
  const m = recolorMap(RAMPS.cyan, RAMPS[t]);
  for (const k of EMI_K) {
    RAMPS.cyan.forEach((h, i) => m.set(scaleRGB(packHex(h), k), scaleRGB(packHex(RAMPS[t][i]), k)));
  }
  return m;
});

// Register generated art. arts: Art[] (dir-major, length frames*dirs), authored with the
// cyan ramp as the team color when teamed.
function addArt(name, arts, { frames = arts.length, dirs = 1, fps = 8, teamed = false } = {}) {
  const { w, h } = arts[0];
  const e = makeEntry(name, w, h, frames, dirs, fps, teamed);
  let hasEmi = false;
  for (const a of arts) {
    if (a.emi) for (let i = 0; i < a.emi.length; i++) if (a.emi[i]) { hasEmi = true; break; }
    if (hasEmi) break;
  }
  const teams = teamed ? 4 : 1;
  e._col = []; e._emi = hasEmi ? [] : null;
  for (let t = 0; t < teams; t++) {
    const set = teamed && t > 0 ? arts.map((a) => recolorArt(a, TEAM_MAPS[t])) : arts;
    e._col.push(set.map((a) => atlasAdd(a.col, w, h)));
    if (hasEmi) e._emi.push(set.map((a) => atlasAdd(a.emi, w, h)));
  }
  e._white = arts.map((a) => atlasAdd(whiteOf(a), w, h));
  e.emissive = hasEmi;
  REG.set(name, e);
  return e;
}

function canvasWhite(c) {
  const o = makeCanvas(c.width, c.height);
  const g = o.getContext('2d');
  g.drawImage(c, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#fff';
  g.fillRect(0, 0, o.width, o.height);
  return o;
}

/** Register externally built sprite frames (boss art). def: see DESIGN.md §5. */
export function registerSprite(name, def) {
  const frames = Math.max(1, def.frameCount | 0 || 1);
  const dirs = Math.max(1, def.dirs | 0 || 1);
  const n = frames * dirs;
  const list = def.frames || [];
  if (list.length < n) console.warn(`registerSprite(${name}): expected ${n} frames, got ${list.length}`);
  const w = def.w || (list[0] && list[0].width) || 1;
  const h = def.h || (list[0] && list[0].height) || 1;
  const ref = (c) => ({ img: c, sx: 0, sy: 0, w: c ? c.width : w, h: c ? c.height : h });
  const e = makeEntry(name, w, h, frames, dirs, def.fps || 8, false);
  const pad = (arr) => { const o = []; for (let i = 0; i < n; i++) o.push(arr[i] || arr[i % Math.max(1, arr.length)]); return o; };
  const cols = pad(list);
  e._col = [cols.map(ref)];
  if (def.emissive && def.emissive.length) {
    e._emi = [pad(def.emissive).map(ref)];
    e.emissive = true;
  }
  const whites = def.white && def.white.length ? pad(def.white) : cols.map((c) => (c ? canvasWhite(c) : null));
  e._white = whites.map(ref);
  REG.set(name, e);
  return e;
}

export function hasSprite(name) {
  return REG.has(name);
}

// Visible placeholder for unknown names (magenta/black checker), warned once per name.
const warned = new Set();
let missingEntry = null;
function missing(name) {
  if (!warned.has(name)) {
    warned.add(name);
    console.warn(`sprite '${name}' not found`);
  }
  if (!missingEntry) {
    const c = makeCanvas(8, 8);
    const g = c.getContext('2d');
    g.fillStyle = '#ff00ff'; g.fillRect(0, 0, 8, 8);
    g.fillStyle = '#000'; g.fillRect(0, 0, 4, 4); g.fillRect(4, 4, 4, 4);
    const r = { img: c, sx: 0, sy: 0, w: 8, h: 8 };
    missingEntry = makeEntry('?', 8, 8, 1, 1, 1, false);
    missingEntry._col = [[r]];
    missingEntry._white = [{ img: canvasWhite(c), sx: 0, sy: 0, w: 8, h: 8 }];
  }
  return missingEntry;
}

/** Sprite info { name, w, h, frames, dirs, fps, emissive, teamed } (placeholder if unknown). */
export function spr(name) {
  return REG.get(name) || missing(name);
}

// Resolve (sprite, frame, opt) -> atlas ref. layer: 0 color, 1 emissive.
function pick(s, frame, opt, layer) {
  const fc = s.frames;
  let f = frame | 0;
  if (f >= fc || f < 0) { f %= fc; if (f < 0) f += fc; }
  let d = 0;
  if (s.dirs > 1 && opt && opt.dir) {
    d = Math.round(opt.dir * s._dirK) % s.dirs;
    if (d < 0) d += s.dirs;
  }
  const i = d * fc + f;
  if (layer === 1) {
    if (!s._emi) return null;
    return s._emi[s.teamed && opt && opt.team ? opt.team & 3 : 0][i];
  }
  if (opt && opt.white) return s._white[i];
  return s._col[s.teamed && opt && opt.team ? opt.team & 3 : 0][i];
}

function blitRef(ctx, r, x, y, opt) {
  if (!r || !r.img) return;
  const w = r.w, h = r.h;
  const dx = Math.round(x) - (w >> 1), dy = Math.round(y) - (h >> 1);
  let a = 1, flip = false;
  if (opt) {
    if (opt.alpha !== undefined) a = opt.alpha;
    flip = !!opt.flipX;
  }
  if (a <= 0) return;
  let prev = 1;
  if (a < 1) { prev = ctx.globalAlpha; ctx.globalAlpha = prev * a; }
  if (flip) {
    ctx.save();
    ctx.translate(dx + w, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(r.img, r.sx, r.sy, w, h, 0, 0, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(r.img, r.sx, r.sy, w, h, dx, dy, w, h);
  }
  if (a < 1) ctx.globalAlpha = prev;
}

/** Draw a sprite centered at (x,y). `name` may also be a sprite object from spr(). */
export function drawSprite(ctx, name, frame, x, y, opt) {
  const s = typeof name === 'string' ? (REG.get(name) || missing(name)) : name;
  blitRef(ctx, pick(s, frame, opt, 0), x, y, opt);
}

/** Draw the emissive (glow) layer of a sprite, if it has one, onto the light layer. */
export function drawSpriteEmissive(lctx, name, frame, x, y, opt) {
  const s = typeof name === 'string' ? REG.get(name) : name;
  if (!s || !s._emi) return;
  blitRef(lctx, pick(s, frame, opt, 1), x, y, opt);
}

/** All registered sprite names (dev/test pages). */
export function listSprites() {
  return [...REG.keys()];
}

/** A standalone canvas holding one frame (for DOM use, e.g. <img> icons or UI previews). */
export function spriteCanvas(name, frame = 0, opt = {}, layer = 'col') {
  const s = spr(name);
  const r = layer === 'emi' ? pick(s, frame, opt, 1) : pick(s, frame, opt, 0);
  const c = makeCanvas(s.w, s.h);
  if (r && r.img) c.getContext('2d').drawImage(r.img, r.sx, r.sy, r.w, r.h, (s.w - r.w) >> 1, (s.h - r.h) >> 1, r.w, r.h);
  return c;
}

/** Atlas statistics (dev). */
export function atlasInfo() {
  return pages.map((p) => ({ w: PAGE_W, h: p.used, frames: p.refs.length, canvas: p.canvas }));
}

// =======================================================================================
// Palette shortcuts, legends and shared painters
// =======================================================================================

const ST = RAMPS.steel, CY = RAMPS.cyan, CA = RAMPS.carapace, MG = RAMPS.magenta;
const EM = RAMPS.ember, PL = RAMPS.plasma, CR = RAMPS.crystal;
const OUT = packHex(C.outline);
const WHITE = packHex('#ffffff');
const P = (hex) => packHex(hex);

const SHIFT = makeRampShifter([ST, CY, RAMPS.gold, RAMPS.lime, RAMPS.violet, CA, MG, EM, PL, CR,
  RAMPS.emerald, RAMPS.sapphire, RAMPS.hull, RAMPS.rust, RAMPS.dawn, RAMPS.fire, RAMPS.smoke, RAMPS.void]);

const SPECIAL = {
  '#': { c: OUT, e: 0 },
  '+': { c: WHITE, e: 0 },
  '*': { c: WHITE, e: WHITE },
};

// Player craft: 0-7 steel, a-f team (cyan) / A-F glowing team, m-r ember / M-R glowing ember
const L_SHIP = legend(['0', ST], ['a', CY], ['A', CY, 0.75], ['m', EM], ['M', EM, 0.75], SPECIAL);
// The Choir: 0-6 carapace, a-f magenta / A-F glowing, g-l crystal / G-L glowing,
// m-r ember / M-R glowing, s-x plasma / S-X glowing
const L_EN = legend(['0', CA], ['a', MG], ['A', MG, true], ['g', CR], ['G', CR, true],
  ['m', EM], ['M', EM, true], ['s', PL], ['S', PL, true], SPECIAL);

const isSteel = (p) => { const i = SHIFT.info(p); return !!i && i.ramp.length === 8 && i.ramp[0] === P(ST[0]); };
const inRamp = (ramp) => { const set = new Set(ramp.map(P)); return (p) => set.has((p | 0xff000000) >>> 0); };

// Darken the right half of a mirrored design by `d` ramp steps (key light from the left),
// for colors passing `test`. Emissive colors in the ramps are shifted along with them.
function shadeRight(a, d, test, from = null) {
  const cx = from == null ? (a.w - 1) / 2 : from;
  for (let y = 0; y < a.h; y++) {
    for (let x = Math.floor(cx) + 1; x < a.w; x++) {
      const i = y * a.w + x, p = a.col[i];
      if (!p || !test(p)) continue;
      a.col[i] = SHIFT.shift(p, d);
      if (a.emi && a.emi[i]) a.emi[i] = SHIFT.shift(a.emi[i], d);
    }
  }
  return a;
}

// Apply [x, y, char] patches after mirroring.
function patch(a, list, L) {
  for (const [x, y, ch] of list) {
    const ent = L[ch];
    plot(a, x, y, ent ? ent.c : 0, ent ? ent.e : 0);
  }
  return a;
}

// =======================================================================================
// PLAYER SHIPS
// =======================================================================================
// Level frames are hand-drawn (left half + center column, mirrored). The right half is
// darkened one step (key light from the upper left). Bank frames are derived by
// foreshortening the wings column-by-column in a per-ship drop order, darkening the dipping
// wing and revealing the fuselage flank on the rising side.

const SHIPS = {
  ship_aurora: {
    // balanced gunship: forward-swept wings, twin wing-tip cannons
    rows: [
      '...........',
      '..........7',
      '.........57',
      '.76......57',
      '.63......56',
      '.75.....5cd',
      '.63.....6+e',
      '.63.....6dc',
      '.637....5cb',
      '.6Dd7...422',
      '.6D5d7..576',
      '.6245d7.576',
      '.52445d7466',
      '.512445d46E',
      '.41.2444576',
      '.....243565',
      '......23465',
      '.......3253',
      '.......5362',
      '.......4251',
      '.......464.',
      '.......1E1.',
      '...........',
    ],
    patches: [[11, 6, 'd']],
    fuse: 3,               // fuselage half-width (columns cx-fuse..cx+fuse stay rigid)
    drop: [5, 4, 3, 6],    // left-wing columns removed first when foreshortening
    engines: [[-2, 14], [2, 14]],
    guns: [[-8, -8], [8, -8]],
  },
  ship_tempest: {
    // slim needle interceptor with a long glowing lance emitter
    rows: [
      '.........',
      '........F',
      '........E',
      '.......5E',
      '.......6D',
      '.......6D',
      '.......5C',
      '......567',
      '.....6567',
      '....6d467',
      '......4cd',
      '......5+e',
      '......5dc',
      '.....7422',
      '....7d576',
      '...7d5576',
      '..7d5445E',
      '.7d544466',
      '.64224456',
      '.52..4355',
      '.D...3454',
      '.....3542',
      '.....464.',
      '.....1E1.',
      '.........',
    ],
    patches: [[9, 11, 'd']],
    fuse: 2,
    drop: [3, 4, 2, 5],
    engines: [[-2, 15], [2, 15]],
    guns: [[0, -11]],
  },
  ship_seraph: {
    // broad heavy frame with wing missile pods (pods carry their own small engines)
    rows: [
      '.............',
      '...........67',
      '..........567',
      '..........467',
      '.........45cd',
      '...q.....56+e',
      '..opn....56dc',
      '..653....55cb',
      '..653..774422',
      '..76477dd5676',
      '.7653dd565676',
      '.665354444676',
      '.6ddc4443456E',
      '.565344435676',
      '.265344444565',
      '..54222234565',
      '..432...34554',
      '..2D2....4542',
      '.........464.',
      '.........1E1.',
      '.............',
    ],
    patches: [[13, 5, 'd']],
    fuse: 3,
    drop: [6, 5, 7, 1],
    engines: [[-2, 13], [2, 13], [-9, 11], [9, 11]],
    guns: [[-9, -5], [9, -5], [0, -9]],
  },
  ship_valkyrie: {
    // delta striker: twin forward prongs that arc plasma between their tips
    rows: [
      '............',
      '......F.....',
      '......E4....',
      '.....6D4....',
      '.....653...7',
      '.....653..67',
      '.....653.567',
      '.....753.576',
      '.....6d3.5cd',
      '.....6d475+e',
      '....76d4d5dc',
      '....d5545422',
      '...754444576',
      '...d44444576',
      '..754443456E',
      '..d444334576',
      '.75444333465',
      '.d4443333465',
      '.22222222354',
      '.......4.245',
      '.......D..46',
      '..........1E',
      '............',
    ],
    patches: [[12, 9, 'd']],
    fuse: 2,
    drop: [3, 2, 4, 1],
    engines: [[0, 14], [-4, 13], [4, 13]],
    guns: [[-5, -10], [5, -10], [0, -7]],
  },
};

function buildShipLevel(def) {
  const a = parseMap(def.rows, L_SHIP, { mirror: true });
  shadeRight(a, -1, (p) => SHIFT.has(p));
  patch(a, def.patches || [], L_SHIP);
  return a;
}

// Bank frame: b in -2..2 (negative = banking left). Returns outlined art.
function buildShipBank(level, def, b) {
  const w = level.w, cx = (w - 1) >> 1;
  let a;
  if (b === 0) {
    a = cloneArt(level);
  } else {
    const n = Math.abs(b);
    const turnDrop = n === 1 ? 1 : 3;
    const riseDrop = n === 1 ? 0 : 1;
    // columns of the left half (0..cx-fuse-1) that survive, per side
    const wingCols = cx - def.fuse;
    const keepSide = (dropN) => {
      const dropped = new Set(def.drop.slice(0, dropN));
      const keep = [];
      for (let x = 0; x < wingCols; x++) if (!dropped.has(x)) keep.push(x);
      return keep;
    };
    const leftKeep = keepSide(b < 0 ? turnDrop : riseDrop);
    const rightKeep = keepSide(b < 0 ? riseDrop : turnDrop).map((x) => w - 1 - x).reverse();
    const fuseCols = [];
    for (let x = cx - def.fuse; x <= cx + def.fuse; x++) fuseCols.push(x);
    // flank column on the rising side for hard banks
    const map = [];
    for (const x of leftKeep) map.push(x);
    if (n === 2 && b > 0) map.push(-2); // flank on the left side (rising left wing)
    for (const x of fuseCols) map.push(x);
    if (n === 2 && b < 0) map.push(-3); // flank on the right side
    for (const x of rightKeep) map.push(x);
    // center the fuselage: shift toward the turning side by 1 on hard banks
    const fuseStart = leftKeep.length + (n === 2 && b > 0 ? 1 : 0);
    let off = (cx - def.fuse) - fuseStart;
    if (n === 2) off += b < 0 ? -1 : 1;
    const full = new Array(w).fill(-1);
    for (let i = 0; i < map.length; i++) {
      const tx = i + off;
      if (tx >= 0 && tx < w) full[tx] = map[i];
    }
    const flankL = full.indexOf(-2), flankR = full.indexOf(-3);
    const src = full.map((v) => (v < 0 ? -1 : v));
    a = remapColumns(level, src, w);
    // dipping wing falls into shadow, rising wing catches more light
    const fuseL = fuseStart + off, fuseR = fuseL + def.fuse * 2;
    for (let y = 0; y < a.h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, p = a.col[i];
        if (!p || !isSteel(p) || (x >= fuseL && x <= fuseR)) continue;
        const dipping = (b < 0) === (x < fuseL);
        const d = n === 2 ? (dipping ? -1 : 1) : 0;
        if (d) a.col[i] = SHIFT.shift(p, d);
      }
    }
    // flank: the side of the hull, copied from the fuselage edge column and darkened
    const flank = (fx, from) => {
      if (fx < 0) return;
      for (let y = 0; y < a.h; y++) {
        const p = level.col[y * w + from];
        if (!p) continue;
        a.col[y * w + fx] = isSteel(p) ? SHIFT.shift(p, -2) : SHIFT.shift(p, -1);
        a.emi[y * w + fx] = 0;
      }
    };
    flank(flankL, cx - def.fuse);
    flank(flankR, cx + def.fuse);
  }
  outline(a, OUT);
  return a;
}

function buildShip(name) {
  const def = SHIPS[name];
  const level = buildShipLevel(def);
  const arts = [-2, -1, 0, 1, 2].map((b) => buildShipBank(level, def, b));
  addArt(name, arts, { frames: 5, fps: 0, teamed: true });
}

/** Engine + gun mount offsets (px from sprite center, level frame) for every player ship. */
export const SHIP_META = {};
for (const k in SHIPS) SHIP_META[k] = { engines: SHIPS[k].engines, guns: SHIPS[k].guns };

// =======================================================================================
// SHIP ACCESSORIES: flames, option drone, revive beacon, shield bubble
// =======================================================================================

const cyP = CY.map(P);                       // team ramp (packed), recolored per team
const stP = ST.map(P);
const emi = (p, k = 1) => (k === 1 ? p : scaleRGB(p, k));

// All-emissive team legend for flames / energy (a-f team, '*' white-hot).
const L_GLOW = legend(['a', CY, true], ['A', CY, 0.75], SPECIAL);

function flameFrames() {
  // teardrop plume; the top row hides under the nozzle. Side flickers ('c' at the edges)
  // make the 4-frame loop feel turbulent.
  const F = [
    ['.e*e.', '.f*f.', 'cefe.', '.dfd.', '.ded.', '..d..', '..c..', '..b..', '.....'],
    ['.e*e.', '.f*f.', '.efe.', '.ded.', '..d..', '..c..', '.....', '.....', '.....'],
    ['.e*e.', '.f*f.', '.fff.', '.efec', '.ded.', '..e..', '..d..', '..c..', '..b..'],
    ['.e*e.', '.f*f.', '.efe.', '.ded.', '..d..', '..d..', '..c..', '.....', '.....'],
  ];
  return F.map((rows) => {
    const a = parseMap(rows, L_GLOW);
    for (let y = 0; y < a.h; y++) {
      for (let x = 0; x < a.w; x++) {
        const i = y * a.w + x;
        if (!a.col[i]) continue;
        const edge = x === 0 || x === 4;
        if (edge || y >= 4) a.col[i] = withAlpha(a.col[i], edge ? 130 : y >= 6 ? 140 : 200);
      }
    }
    return a;
  });
}

function droneFrames() {
  const out = [];
  for (let f = 0; f < 4; f++) {
    const a = newArt(9, 9);
    const ph = (f / 4) * (Math.PI / 2);
    forEachPixel(a, (x, y, dx, dy) => {
      const r = Math.hypot(dx, dy);
      const lit = r > 0 ? (-dx * 0.6 - dy * 0.8) / r : 0;
      if (r <= 0.5) { plot(a, x, y, WHITE, cyP[5]); return; }
      if (r <= 1.5) { plot(a, x, y, cyP[4], cyP[3]); return; }
      if (r <= 2.3) { plot(a, x, y, stP[lit > 0.2 ? 6 : lit > -0.4 ? 4 : 2]); return; }
      if (r > 3.7) return;
      // four rotating arms
      for (let k = 0; k < 4; k++) {
        const ang = ph + k * (Math.PI / 2);
        const ax = Math.sin(ang), ay = -Math.cos(ang);
        const along = dx * ax + dy * ay, across = Math.abs(dx * ay - dy * ax);
        if (along > 1.5 && across < 0.72) {
          if (r > 3.1) plot(a, x, y, cyP[3], emi(cyP[3], 0.75));
          else plot(a, x, y, stP[lit > 0 ? 6 : 4]);
          return;
        }
      }
    });
    outline(a, OUT);
    out.push(a);
  }
  return out;
}

function beaconFrames() {
  const out = [];
  for (let f = 0; f < 6; f++) {
    const a = newArt(15, 15);
    const t = f / 6;
    const R = 2.5 + t * 4.6;                 // expanding pulse ring
    forEachPixel(a, (x, y, dx, dy) => {
      const r = Math.hypot(dx, dy);
      if (Math.abs(r - R) < 0.55 && r > 3.2) {
        const k = 1 - t;
        const c = k > 0.6 ? cyP[4] : k > 0.3 ? cyP[3] : cyP[2];
        plot(a, x, y, withAlpha(c, 110 + 145 * k | 0), emi(c, k > 0.5 ? 1 : 0.5));
      }
    });
    // escape pod: small steel capsule with a blinking team light
    const pod = parseMap([
      '.....', '.656.', '65+54', '5E*E3', '45a42', '.343.', '.....',
    ], L_SHIP);
    if (f >= 3) { plot(pod, 2, 3, cyP[3], 0); plot(pod, 1, 3, stP[5], 0); plot(pod, 3, 3, stP[3], 0); }
    outline(pod, OUT);
    blit(a, pod, 5, 4);
    // four chevrons pointing at the pod (static, dim)
    for (const [cx, cy] of [[7, 1], [7, 13], [1, 7], [13, 7]]) {
      const on = (f & 1) === 0;
      plot(a, cx, cy, withAlpha(cyP[on ? 4 : 3], 200), on ? cyP[3] : 0);
    }
    out.push(a);
  }
  return out;
}

function shieldFrames() {
  const out = [];
  const R = 14.2;
  for (let f = 0; f < 4; f++) {
    const a = newArt(31, 31);
    const ph = f / 4;
    forEachPixel(a, (x, y, dx, dy) => {
      const r = Math.hypot(dx, dy);
      if (r > R + 0.4) return;
      const u = dx / R, v = dy / R;
      // hex lattice (axial coordinates), cell ~7px, drawn as thin lines
      const s3 = Math.sqrt(3), cs = 4.2;
      const qx = (dx * s3 / 3 - dy / 3) / cs, qz = (dy * 2 / 3) / cs, qy = -qx - qz;
      let rx = Math.round(qx), ry = Math.round(qy), rz = Math.round(qz);
      const ex = Math.abs(rx - qx), ey = Math.abs(ry - qy), ez = Math.abs(rz - qz);
      if (ex > ey && ex > ez) rx = -ry - rz; else if (ey > ez) ry = -rx - rz; else rz = -rx - ry;
      const edge = Math.max(Math.abs(rx - qx), Math.abs(ry - qy), Math.abs(rz - qz));
      const wave = 0.5 + 0.5 * Math.cos((u + v) * 2.6 - ph * TAU);     // shimmer band
      const fres = Math.pow(r / R, 3);                                    // stronger at the rim
      if (r > R - 0.9) {
        const lit = (-u - v) * 0.7;
        const c = lit > 0.3 ? cyP[5] : lit > -0.25 ? cyP[4] : cyP[3];
        plot(a, x, y, withAlpha(c, 235), emi(c, 0.75));
      } else if (r > R - 1.9) {
        plot(a, x, y, withAlpha(cyP[3], 120), emi(cyP[2], 0.5));
      } else if (edge > 0.47 && wave > 0.35) {
        const k = (wave - 0.35) / 0.65;
        const c = k > 0.7 ? cyP[4] : cyP[3];
        plot(a, x, y, withAlpha(c, (40 + 150 * k * (0.35 + 0.65 * fres)) | 0), k > 0.6 ? emi(cyP[2], 0.5) : 0);
      } else if (fres > 0.35) {
        plot(a, x, y, withAlpha(cyP[2], (fres * 70) | 0), 0);
      }
    });
    // specular arc highlight (upper left) + glint
    for (let i = 0; i < 8; i++) {
      const ang = Math.PI * 1.1 + i * 0.08;
      plot(a, Math.round(15 + Math.cos(ang) * 11.2), Math.round(15 + Math.sin(ang) * 11.2), withAlpha(WHITE, i === 3 || i === 4 ? 235 : 160), emi(cyP[4], 0.5));
    }
    plot(a, 9, 8, withAlpha(WHITE, 200), 0);
    out.push(a);
  }
  return out;
}

// =======================================================================================
// PLAYER BULLETS (team colored, lighter/less saturated + translucent so enemy fire pops)
// =======================================================================================

// Rotate a base art into `dirs` square frames and finish each (outline/rim) with `post`.
function bakeDirs(base, dirs, size, post) {
  const rot = makeRotator(base);
  const out = [];
  for (let d = 0; d < dirs; d++) {
    const ang = (d / dirs) * TAU;
    let a;
    if (d === 0) {
      a = newArt(size, size);
      blit(a, base, ((size - base.w) >> 1), ((size - base.h) >> 1));
    } else {
      a = rot(ang, size, size);
    }
    out.push(post ? post(a, d) || a : a);
  }
  return out;
}

// translucent team pixel: color index i, alpha, emissive factor
function tp(a, x, y, i, al = 255, k = 0.5) {
  plot(a, x, y, withAlpha(cyP[i], al), k ? emi(cyP[i], k) : 0);
}

// Bake `dirs` square frames by sampling an analytic shape at every pixel center in the
// bullet's local frame: shade(across, along) -> [color, emissive] | null, along > 0 = forward.
function bakeAnalytic(size, dirs, shade, post) {
  const out = [];
  const c = (size - 1) / 2;
  for (let d = 0; d < dirs; d++) {
    const th = (d / dirs) * TAU;
    const fx = Math.sin(th), fy = -Math.cos(th);
    const a = newArt(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - c, dy = y - c;
        const along = dx * fx + dy * fy, across = dx * -fy + dy * fx;
        const r = shade(across, along);
        if (r) plot(a, x, y, r[0], r[1] || 0);
      }
    }
    out.push(post ? post(a, d) || a : a);
  }
  return out;
}

// Vulcan tracer: 3-px white-hot head, 1-px team body fading into a translucent tail.
function vulcanShade(big) {
  const L = big ? 5.4 : 4.6;         // half length
  return (u, v) => {
    const au = Math.abs(u);
    if (v > L || v < -L) return null;
    const headR = big ? 1.55 : 1.05, bodyR = big ? 1.0 : 0.56;
    const headStart = L - (big ? 3.6 : 2.6);
    if (v >= headStart) {
      const rr = v > L - 0.8 ? headR * 0.55 : headR;
      if (au > rr) return null;
      if (au < (big ? 0.9 : 0.5) && v < L - 0.8) return [WHITE, cyP[4]];
      return [withAlpha(cyP[5], 235), emi(cyP[4], 0.5)];
    }
    const t = (headStart - v) / (headStart + L);         // 0 at head .. 1 at tail
    const r = bodyR * (1 - t * 0.35);
    if (au > r) return null;
    const i = t < 0.3 ? 5 : t < 0.65 ? 4 : 3;
    const al = Math.round(255 * (0.95 - t * 0.55) * (big && au > 0.5 ? 0.7 : 1));
    return [withAlpha(cyP[i], al), emi(cyP[Math.max(2, i - 1)], 0.5)];
  };
}

// Micro-missile: steel body, team nose band, tail fins, glowing team exhaust.
function missileShade(u, v) {
  const au = Math.abs(u);
  if (v > 3.4 || v < -4.6) return null;
  if (v > 2.2) return au < 0.55 ? [stP[7]] : null;                          // nose tip
  if (v > -2.2) {
    if (au > 1.05) return null;
    if (v > 1.2) return [u < 0 ? cyP[4] : cyP[3], 0];                        // team band
    return [stP[u < -0.4 ? 6 : u > 0.4 ? 3 : 5]];
  }
  if (v > -3.3) {                                                           // fins
    if (au > 1.9) return null;
    return [stP[au > 1.05 ? (u < 0 ? 5 : 3) : 4]];
  }
  if (au < 0.6) return [v > -4 ? WHITE : withAlpha(cyP[4], 210), v > -4 ? cyP[5] : cyP[3]];
  return null;
}


function laserBodyFrames() {
  const out = [];
  for (let f = 0; f < 4; f++) {
    const a = newArt(7, 8);
    for (let y = 0; y < 8; y++) {
      // shimmer: brightness ripple that tiles every 8 rows, travelling up the beam
      const s = 0.5 + 0.5 * Math.sin(((y + f * 2) / 8) * TAU);
      for (let x = 0; x < 7; x++) {
        const d = Math.abs(x - 3);
        if (d === 0) plot(a, x, y, WHITE, cyP[5]);
        else if (d === 1) tp(a, x, y, s > 0.45 ? 5 : 4, 235, 1);
        else if (d === 2) tp(a, x, y, s > 0.6 ? 4 : 3, 170, 0.75);
        else if (s > 0.55 || ((y + f) & 3) === 0) tp(a, x, y, 3, 90, 0.5);
      }
    }
    out.push(a);
  }
  return out;
}

function laserHeadFrames() {
  const out = [];
  for (let f = 0; f < 4; f++) {
    const a = newArt(11, 11);
    const len = [5, 4, 5, 3][f], dlen = [2, 3, 2, 3][f];
    forEachPixel(a, (x, y, dx, dy) => {
      const r = Math.hypot(dx, dy);
      const ax = Math.abs(dx), ay = Math.abs(dy);
      let i = -1, al = 255;
      if (r <= 1.2) i = 6;
      else if (r <= 2.3) i = 5;
      else if (r <= 3.1 && f !== 3) { i = 4; al = 200; }
      else if ((ax === 0 && ay <= len) || (ay === 0 && ax <= len)) { i = Math.max(ay, ax) > 3 ? 3 : 4; al = 230; }
      else if (ax === ay && ax <= dlen) { i = 3; al = 170; }
      if (i < 0) return;
      if (i === 6) plot(a, x, y, WHITE, cyP[5]);
      else tp(a, x, y, i, al, 1);
    });
    out.push(a);
  }
  return out;
}

// Plasma crescent (convex side forward/up). w,h frame size.
function waveFrames(w, h, seed) {
  const out = [];
  const cx = (w - 1) / 2, cy = h - 0.6;               // ellipse center below the bottom edge
  const rx = w / 2 - 0.2, ry = h - 0.9;
  for (let f = 0; f < 3; f++) {
    const a = newArt(w, h);
    forEachPixel(a, (x, y) => {
      const nx = (x - cx) / rx, ny = (y - cy) / ry;
      if (ny > 0.05) return;
      const e = Math.hypot(nx, ny);                     // 1 on the outer edge
      const up = Math.min(1, -ny);                      // 1 at the crest, 0 at the tips
      const th = (0.2 + 0.28 * up) * (h > 8 ? 1 : 1.1); // band thickness (normalized)
      if (e > 1 || e < 1 - th) return;
      const k = (1 - e) / th;                           // 0 outer .. 1 inner
      const n = vnoise(x * 0.8 + f * 5.3, y * 0.9, seed);
      let i, al = 255;
      if (k < 0.34) i = up > 0.35 && n > 0.3 ? 6 : 5;
      else if (k < 0.7) i = n > 0.55 ? 5 : 4;
      else { i = n > 0.5 ? 4 : 3; al = 185; }
      if (up < 0.25) { i = Math.min(i, 4); al = Math.min(al, 200); }
      if (i === 6) plot(a, x, y, withAlpha(WHITE, 240), cyP[4]);
      else tp(a, x, y, i, al, 0.75);
    });
    out.push(a);
  }
  return out;
}

function optionShot() {
  const L = legend(['a', CY], SPECIAL);
  const a = parseMap(['.e.', 'e*e', '.f.', '.e.', '.d.', '.c.', '.c.'], L);
  for (let i = 0; i < a.col.length; i++) {
    const c = a.col[i];
    if (!c) continue;
    const y = (i / a.w) | 0;
    a.col[i] = withAlpha(c, y > 4 ? 150 : 225);
    a.emi[i] = emi((c | 0xff000000) >>> 0, 0.5);
  }
  return a;
}

// =======================================================================================
// ENEMY BULLETS — the most readable objects on screen: white-hot center, bright core,
// darker colored ring, 1-px dark rim, strong glow. Four color families.
// =======================================================================================

const EB_RAMPS = { p: MG, o: EM, v: PL, c: CR };
const rampP = (r) => r.map(P);

// Concentric radial painter. bands: [[maxR, rampIndex|'w'], ...] (ascending radius).
function radial(size, bands, R, opt = {}) {
  const a = newArt(size, size);
  const { spec = null, emiK = 1 } = opt;
  forEachPixel(a, (x, y, dx, dy) => {
    const d = Math.hypot(dx, dy);
    for (const [mr, idx] of bands) {
      if (d <= mr) {
        if (idx === 'w') plot(a, x, y, WHITE, R[4]);
        else plot(a, x, y, R[idx], emi(R[Math.min(idx, 4)], emiK));
        return;
      }
    }
  });
  if (spec) plot(a, spec[0], spec[1], WHITE, R[4]);
  outline(a, OUT);
  return a;
}

function ebSmall(R) {
  const f0 = newArt(5, 5), f1 = newArt(5, 5);
  const L0 = ['.....', '.cbc.', '.bwb.', '.cbc.', '.....'];
  const L1 = ['.....', '.dbd.', '.bwb.', '.dbd.', '.....'];
  const put = (a, rows) => rows.forEach((r, y) => [...r].forEach((ch, x) => {
    if (ch === 'w') plot(a, x, y, WHITE, R[5]);
    else if (ch === 'b') plot(a, x, y, R[5], R[4]);
    else if (ch === 'c') plot(a, x, y, R[3], R[3]);
    else if (ch === 'd') plot(a, x, y, R[4], R[3]);
  }));
  put(f0, L0); put(f1, L1);
  outline(f0, OUT); outline(f1, OUT);
  return [f0, f1];
}

function ebOrb(R) {
  return [
    radial(9, [[0.9, 'w'], [1.9, 5], [2.75, 4], [3.6, 2]], R, { spec: [3, 2] }),
    radial(9, [[1.2, 'w'], [2.2, 5], [3.0, 4], [3.6, 3]], R, { spec: [3, 2] }),
  ];
}

function ebBig(R) {
  const out = [];
  for (let f = 0; f < 4; f++) {
    const a = newArt(15, 15);
    const ph = (f / 4) * (TAU / 3);
    forEachPixel(a, (x, y, dx, dy) => {
      const d = Math.hypot(dx, dy);
      if (d > 6.4) return;
      const th = Math.atan2(dy, dx);
      if (d <= 1.4) return plot(a, x, y, WHITE, R[5]);
      if (d <= 2.6) return plot(a, x, y, R[5], R[4]);
      if (d > 5.6) return plot(a, x, y, R[2], R[2]);
      const arm = Math.sin(3 * th + d * 1.15 - ph * 3);
      if (arm > 0.35) plot(a, x, y, R[4], R[4]);
      else if (arm > -0.45) plot(a, x, y, R[3], R[3]);
      else plot(a, x, y, R[2], R[3]);
    });
    plot(a, 5, 4, WHITE, R[4]); plot(a, 6, 4, R[5], R[4]);
    outline(a, OUT);
    out.push(a);
  }
  return out;
}

// needle/shard: 1-px hot core along the flight direction
function ebNeedleShade(R) {
  return (u, v) => {
    if (Math.abs(u) > 0.56 || v > 3.9 || v < -3.9) return null;
    if (v > 2.6) return [R[5], R[4]];
    if (v > -0.4) return [WHITE, R[4]];
    if (v > -2.2) return [R[4], R[3]];
    return [R[3], R[3]];
  };
}

function ebStar(R) {
  const out = [];
  for (let f = 0; f < 4; f++) {
    const a = newArt(9, 9);
    const ph = (f / 4) * (Math.PI / 2);
    const pts = [];
    for (let k = 0; k < 8; k++) {
      const ang = ph + (k * Math.PI) / 4;
      const r = k & 1 ? 1.55 : 3.95;
      pts.push([4.5 + Math.sin(ang) * r, 4.5 - Math.cos(ang) * r]);
    }
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 9; x++) {
        if (!pointInPoly(x + 0.5, y + 0.5, pts)) continue;
        const d = Math.hypot(x - 4, y - 4);
        if (d < 0.7) plot(a, x, y, WHITE, R[5]);
        else if (d < 1.8) plot(a, x, y, R[5], R[4]);
        else if (d < 2.9) plot(a, x, y, R[4], R[4]);
        else plot(a, x, y, R[3], R[3]);
      }
    }
    outline(a, OUT);
    out.push(a);
  }
  return out;
}

function ebRing(R) {
  const out = [];
  for (let f = 0; f < 2; f++) {
    const a = newArt(11, 11);
    forEachPixel(a, (x, y, dx, dy) => {
      const d = Math.hypot(dx, dy);
      if (d < 2.3 || d > 4.3) return;
      const lit = (-dx - dy) / (d * 1.414);          // -1..1, 1 toward the upper left
      const hot = f === 0 ? lit > 0.72 : lit < -0.72;
      if (hot) plot(a, x, y, WHITE, R[5]);
      else if (d < 3.1) plot(a, x, y, R[5], R[4]);
      else plot(a, x, y, f ? R[4] : R[3], R[4]);
    });
    outline(a, OUT);
    out.push(a);
  }
  return out;
}

function buildEnemyBullets() {
  for (const k of ['p', 'o', 'v', 'c']) {
    const R = rampP(EB_RAMPS[k]);
    addArt('eb_small_' + k, ebSmall(R), { frames: 2, fps: 12 });
    addArt('eb_orb_' + k, ebOrb(R), { frames: 2, fps: 10 });
    if (k !== 'c') addArt('eb_big_' + k, ebBig(R), { frames: 4, fps: 12 });
    if (k !== 'v') addArt('eb_needle_' + k, bakeAnalytic(11, 32, ebNeedleShade(R), (a) => outline(a, OUT)), { frames: 1, dirs: 32 });
  }
  addArt('eb_star_o', ebStar(rampP(EM)), { frames: 4, fps: 16 });
  addArt('eb_ring_v', ebRing(rampP(PL)), { frames: 2, fps: 8 });
}

function buildPlayerExtras() {
  addArt('flame_s', flameFrames(), { frames: 4, fps: 20, teamed: true });
  addArt('option_drone', droneFrames(), { frames: 4, fps: 12, teamed: true });
  addArt('beacon', beaconFrames(), { frames: 6, fps: 8, teamed: true });
  addArt('shield_bubble', shieldFrames(), { frames: 4, fps: 10, teamed: true });
}

function buildPlayerBullets() {
  addArt('pb_vulcan', bakeAnalytic(11, 16, vulcanShade(false)), { frames: 1, dirs: 16, teamed: true });
  addArt('pb_vulcan_big', bakeAnalytic(13, 16, vulcanShade(true)), { frames: 1, dirs: 16, teamed: true });
  addArt('pb_missile', bakeAnalytic(11, 16, missileShade, (a) => outline(a, OUT)), { frames: 1, dirs: 16, teamed: true });
  addArt('pb_laser_body', laserBodyFrames(), { frames: 4, fps: 24, teamed: true });
  addArt('pb_laser_head', laserHeadFrames(), { frames: 4, fps: 20, teamed: true });
  addArt('pb_wave', waveFrames(17, 7, 11), { frames: 3, fps: 15, teamed: true });
  addArt('pb_wave_l', waveFrames(25, 9, 23), { frames: 3, fps: 15, teamed: true });
  addArt('pb_option', [optionShot()], { frames: 1, teamed: true });
}

// =======================================================================================
// Build
// =======================================================================================

const TASKS = [];
for (const k in SHIPS) TASKS.push(() => buildShip(k));
TASKS.push(buildPlayerExtras, buildPlayerBullets, buildEnemyBullets);

let buildPromise = null;

/** Generate every sprite (idempotent). onProgress(0..1). */
export function buildSprites(onProgress) {
  if (!buildPromise) buildPromise = runBuild(onProgress);
  else if (onProgress) buildPromise.then(() => onProgress(1));
  return buildPromise;
}

async function runBuild(onProgress) {
  const yieldNow = () => new Promise((r) => setTimeout(r, 0));
  let t0 = performance.now();
  for (let i = 0; i < TASKS.length; i++) {
    TASKS[i]();
    if (performance.now() - t0 > 10) {
      if (onProgress) onProgress((i + 1) / TASKS.length * 0.95);
      await yieldNow();
      t0 = performance.now();
    }
  }
  atlasFlush();
  if (onProgress) onProgress(1);
}
