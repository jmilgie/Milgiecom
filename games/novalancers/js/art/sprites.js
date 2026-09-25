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
  TAU, makeCanvas, packHex, withAlpha, scaleRGB, newArt, cloneArt, plot, blit, whiteOf,
  parseMap, legend, makeRampShifter, recolorMap, outline, rimLight,
  remapColumns, shiftWhere, rng, vnoise, fbm, ditherIndex, sphereLight, lambert,
  pointInPoly, forEachPixel, emissiveFrom, R_, G_, B_,
  symmetricDirs, rot90Art, mirrorDiagArt, rasterAnalytic,
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

// Pack pending frames into atlas pages. Copies in time-sliced batches (yielding through
// `yielder` when given) so a slow phone never stalls the loading bar for long.
async function atlasFlush(yielder = null) {
  if (!pending.length) return;
  pending.sort((a, b) => b.h - a.h || b.w - a.w);
  // 1) shelf layout, 2) allocate each page at its used height, 3) copy + upload
  const layout = [];
  let cur = null, x = 0, y = 0, shelf = 0;
  const open = () => { cur = { items: [], used: 0 }; layout.push(cur); x = 1; y = 1; shelf = 0; };
  open();
  for (const it of pending) {
    if (x + it.w + 1 > PAGE_W) { x = 1; y += shelf + 1; shelf = 0; }
    if (y + it.h + 1 > PAGE_MAX_H) open();
    it.ref.sx = x; it.ref.sy = y;
    cur.items.push(it);
    x += it.w + 1;
    shelf = Math.max(shelf, it.h);
    cur.used = Math.max(cur.used, y + it.h + 1);
  }
  pending = [];
  for (const L of layout) {
    const h = Math.max(1, L.used);
    const id = new ImageData(PAGE_W, h);
    const buf = new Uint32Array(id.data.buffer);
    let t0 = performance.now();
    for (const it of L.items) {
      const { sx, sy } = it.ref;
      for (let r = 0; r < it.h; r++) buf.set(it.px.subarray(r * it.w, r * it.w + it.w), (sy + r) * PAGE_W + sx);
      it.px = null;
      if (yielder && performance.now() - t0 > 10) { await yielder.yield(); t0 = performance.now(); }
    }
    if (yielder) await yielder.yield();
    const cv = makeCanvas(PAGE_W, h);
    cv.getContext('2d').putImageData(id, 0, 0);
    for (const it of L.items) it.ref.img = cv;
    pages.push({ canvas: cv, used: h, refs: L.items.map((it) => it.ref) });
  }
}

// Internal sprite: public fields { name, w, h, frames, dirs, fps, emissive, teamed, bw, bh }
// plus _col[team][i], _emi[team][i] | null, _white[i] (refs), i = dirIndex * frames + frame.
// w/h = frame size (for rotated sprites: the square that holds every direction);
// bw/bh = opaque bounds of the unrotated base frame (e.g. pb_vulcan 11x11 frame, 3x10 art).
function makeEntry(name, w, h, frames, dirs, fps, teamed) {
  return {
    name, w, h, frames, dirs, fps, emissive: false, teamed, bw: w, bh: h,
    _col: null, _emi: null, _white: null, _dirK: dirs / TAU,
  };
}

function opaqueBounds(a) {
  let x0 = a.w, y0 = a.h, x1 = -1, y1 = -1;
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      if (!a.col[y * a.w + x]) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? [a.w, a.h] : [x1 - x0 + 1, y1 - y0 + 1];
}

// Team recolor: cyan ramp -> team ramp for the color layer. Glow layers hold cyan ramp
// colors scaled by arbitrary factors (0.3, 0.5, ...), so emissive pixels are matched to
// "cyan entry i scaled by k" and rebuilt as "team entry i scaled by k" (memoized).
const CYAN_P = RAMPS.cyan.map((h) => packHex(h));
const TEAM_MAPS = TEAM.map((t) => recolorMap(RAMPS.cyan, RAMPS[t]));
const TEAM_EMI = TEAM.map(() => new Map());

function teamEmi(t, p) {
  const memo = TEAM_EMI[t];
  const key = p | 0xff000000;
  let q = memo.get(key);
  if (q === undefined) {
    q = TEAM_MAPS[t].get(key);
    if (q === undefined) {
      q = key;                                   // not a (scaled) cyan: keep (e.g. white)
      const r = R_(p), g = G_(p), b = B_(p);
      for (let i = 0; i < CYAN_P.length; i++) {
        const c = CYAN_P[i], cr = R_(c), cg = G_(c), cb = B_(c);
        const k = (r + g + b) / (cr + cg + cb);
        if (k <= 0 || k > 1.001) continue;
        if (Math.abs(cr * k - r) <= 2 && Math.abs(cg * k - g) <= 2 && Math.abs(cb * k - b) <= 2) {
          q = scaleRGB(packHex(RAMPS[TEAM[t]][i]), k) | 0xff000000;
          break;
        }
      }
    }
    memo.set(key, q);
  }
  return withAlpha(q, p >>> 24);
}

function recolorTeam(a, t) {
  const m = TEAM_MAPS[t];
  const col = new Int32Array(a.col.length);
  for (let i = 0; i < col.length; i++) {
    const p = a.col[i];
    if (!p) continue;
    const q = m.get(p | 0xff000000);
    col[i] = q === undefined ? p : withAlpha(q, p >>> 24);
  }
  let emi = null;
  if (a.emi) {
    emi = new Int32Array(a.emi.length);
    for (let i = 0; i < emi.length; i++) if (a.emi[i]) emi[i] = teamEmi(t, a.emi[i]);
  }
  return { w: a.w, h: a.h, col, emi };
}

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
    const set = teamed && t > 0 ? arts.map((a) => recolorTeam(a, t)) : arts;
    e._col.push(set.map((a) => atlasAdd(a.col, w, h)));
    if (hasEmi) e._emi.push(set.map((a) => atlasAdd(a.emi, w, h)));
  }
  e._white = arts.map((a) => atlasAdd(whiteOf(a), w, h));
  e.emissive = hasEmi;
  if (dirs > 1) [e.bw, e.bh] = opaqueBounds(arts[0]);
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
  const e = makeEntry(name, w, h, frames, dirs, def.fps ?? 8, false);
  const pad = (arr) => { const o = []; for (let i = 0; i < n; i++) o.push(arr[i] || arr[i % Math.max(1, arr.length)]); return o; };
  const cols = pad(list);
  e._col = [cols.map(ref)];
  if (def.emissive && def.emissive.some(Boolean)) {
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
const L_SHIP = legend(['0', ST], ['a', CY, 0.3], ['A', CY, 0.75], ['m', EM], ['M', EM, 0.75], SPECIAL);
// The Choir: 0-6 carapace, a-f magenta / A-F glowing, g-l crystal / G-L glowing,
// m-r ember / M-R glowing, s-x plasma / S-X glowing
const L_EN = legend(['0', CA], ['a', MG], ['A', MG, true], ['g', CR], ['G', CR, true],
  ['m', EM], ['M', EM, true], ['s', PL], ['S', PL, true], SPECIAL);

const isSteel = (p) => { const i = SHIFT.info(p); return !!i && i.ramp.length === 8 && i.ramp[0] === P(ST[0]); };
const inRamp = (ramp) => { const set = new Set(ramp.map(P)); return (p) => set.has(p | 0xff000000); };

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
    engines: [[-2, 10], [2, 10]],
    guns: [[-8.5, -9], [8.5, -9]],
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
    engines: [[-2, 11], [2, 11]],
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
    engines: [[-2, 9], [2, 9], [-9, 7], [9, 7]],
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
    engines: [[0, 10], [-4, 9], [4, 9]],
    guns: [[-5, -10], [5, -10], [0, -7]],
  },
};

function buildShipLevel(def) {
  const a = parseMap(def.rows, L_SHIP, { mirror: true });
  shadeRight(a, -1, (p) => SHIFT.has(p));
  patch(a, def.patches || [], L_SHIP);
  return a;
}

// Column layout of a bank frame, b in -2..2 (negative = banking left): full[x] = source
// column copied into column x (-1 empty, -2 / -3 = hull flank on the left / right side).
// Wing columns listed in def.drop vanish first (foreshortening); hard banks reveal the
// fuselage flank on the rising side and slide the fuselage 1 px toward the turn.
function bankColumns(def, w, b) {
  const cx = (w - 1) >> 1;
  const n = Math.abs(b);
  const turnDrop = n === 1 ? 1 : 3;
  const riseDrop = n === 1 ? 0 : 1;
  const wingCols = cx - def.fuse;
  const keepSide = (dropN) => {
    const dropped = new Set(def.drop.slice(0, dropN));
    const keep = [];
    for (let x = 0; x < wingCols; x++) if (!dropped.has(x)) keep.push(x);
    return keep;
  };
  const leftKeep = keepSide(b < 0 ? turnDrop : riseDrop);
  const rightKeep = keepSide(b < 0 ? riseDrop : turnDrop).map((x) => w - 1 - x).reverse();
  const map = [...leftKeep];
  if (n === 2 && b > 0) map.push(-2);
  for (let x = cx - def.fuse; x <= cx + def.fuse; x++) map.push(x);
  if (n === 2 && b < 0) map.push(-3);
  map.push(...rightKeep);
  const fuseStart = leftKeep.length + (n === 2 && b > 0 ? 1 : 0);
  let off = (cx - def.fuse) - fuseStart;
  if (n === 2) off += b < 0 ? -1 : 1;
  const full = new Array(w).fill(-1);
  for (let i = 0; i < map.length; i++) {
    const tx = i + off;
    if (tx >= 0 && tx < w) full[tx] = map[i];
  }
  return { full, fuseL: fuseStart + off, fuseR: fuseStart + off + def.fuse * 2 };
}

// Where a level-frame x offset (may be fractional) lands in bank frame b.
function bankOffset(def, w, b, dx) {
  if (b === 0) return dx;
  const cx = (w - 1) >> 1;
  const { full } = bankColumns(def, w, b);
  const find = (sc) => {
    for (let k = 0; k < w; k++) {
      // a dropped column collapses onto its nearest surviving neighbour toward the fuselage
      const c = sc < cx ? sc + k : sc - k;
      const i = full.indexOf(c);
      if (i >= 0) return i;
    }
    return sc;
  };
  const x = cx + dx;
  return (find(Math.floor(x)) + find(Math.ceil(x))) / 2 - cx;
}

// Bank frame art (outlined).
function buildShipBank(level, def, b) {
  const w = level.w, cx = (w - 1) >> 1;
  let a;
  if (b === 0) {
    a = cloneArt(level);
  } else {
    const n = Math.abs(b);
    const { full, fuseL, fuseR } = bankColumns(def, w, b);
    const flankL = full.indexOf(-2), flankR = full.indexOf(-3);
    a = remapColumns(level, full.map((v) => (v < 0 ? -1 : v)), w);
    // hard banks: the dipping wing falls into shadow (never darker than steel[2], so a
    // shaded wing still reads as metal), the rising wing catches more light
    if (n === 2) {
      for (let y = 0; y < a.h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x, p = a.col[i];
          if (!p || !isSteel(p) || (x >= fuseL && x <= fuseR)) continue;
          const dipping = (b < 0) === (x < fuseL);
          if (!dipping) { a.col[i] = SHIFT.shift(p, 1); continue; }
          const idx = SHIFT.info(p).i;
          if (idx > 2) a.col[i] = SHIFT.shift(p, -1);
        }
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

/** Vertical offset from an engine's nozzle exit to the flame_s center (its top row tucks
 *  under the nozzle): draw flame_s at (x + dx, y + dy + FLAME_DY). */
export const FLAME_DY = 4;

/** Mount points per player ship, px from the sprite center:
 *  engines = nozzle exit points (see FLAME_DY), guns = muzzle points (bullet spawn / flash),
 *  both for the level frame; enginesByFrame[f] / gunsByFrame[f] give the exact points for
 *  bank frame f (0 = hard left .. 4 = hard right), since banking moves wing-mounted parts.
 *  Keyed by sprite name ('ship_aurora') and by ship id ('aurora'). */
export const SHIP_META = {};
for (const k in SHIPS) {
  const def = SHIPS[k];
  const w = def.rows[0].length * 2 - 1;
  const byFrame = (pts) => [-2, -1, 0, 1, 2].map((b) => pts.map(([dx, dy]) => [bankOffset(def, w, b, dx), dy]));
  SHIP_META[k] = { engines: def.engines, guns: def.guns, enginesByFrame: byFrame(def.engines), gunsByFrame: byFrame(def.guns) };
  SHIP_META[k.slice(5)] = SHIP_META[k];
}

// =======================================================================================
// SHIP ACCESSORIES: flames, option drone, revive beacon, shield bubble
// =======================================================================================

const cyP = CY.map(P);                       // team ramp (packed), recolored per team
const stP = ST.map(P);
const emi = (p, k = 1) => (k === 1 ? p : scaleRGB(p, k));


// Team-colored glow rule: the light layer is ADDED to the color layer, so a pixel whose glow
// equals its own color clips to white and loses its team. Only the white-hot base glows at
// full strength; the plume/ring glows at ~40% so P1..P4 stay cyan / gold / lime / violet.
const TEAM_GLOW = { hot: (i) => emi(cyP[i], 0.8), body: (i) => emi(cyP[i], 0.42) };

function flameFrames() {
  // teardrop plume; the top rows hide under the nozzle. White-hot base, saturated team
  // body, dark tail; 7-9 rows long, flickering through core offsets and tail alpha.
  const F = [
    ['.e*e.', '.e*e.', '.dfd.', '.ded.', '.cdc.', '..d..', '..c..', '..b..', '.....'],
    ['.e*e.', '.e*e.', '.dfd.', '.cec.', '.cdc.', '..c..', '..b..', '.....', '.....'],
    ['.e*e.', '.e*e.', '.dfd.', '.ded.', '.cdc.', '..d..', '..d..', '..c..', '..b..'],
    ['.e*e.', '.e*e.', '.dfd.', '.ded.', '.dc..', '..d..', '..c..', '..b..', '.....'],
  ];
  const tail = [150, 185, 130, 165];
  const IDX = { b: 1, c: 2, d: 3, e: 4, f: 5 };
  return F.map((rows, f) => {
    const a = newArt(5, 9);
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === '.') return;
      const al = y >= 6 ? tail[f] : y >= 4 ? 215 : 255;
      if (ch === '*') return plot(a, x, y, WHITE, TEAM_GLOW.hot(4));
      const i = IDX[ch];
      plot(a, x, y, withAlpha(cyP[i], al), i >= 4 ? TEAM_GLOW.body(3) : TEAM_GLOW.body(Math.max(1, i)));
    }));
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
      if (r <= 0.5) { plot(a, x, y, WHITE, TEAM_GLOW.hot(4)); return; }
      if (r <= 1.5) { plot(a, x, y, cyP[3], TEAM_GLOW.body(3)); return; }
      if (r <= 2.3) { plot(a, x, y, stP[lit > 0.2 ? 6 : lit > -0.4 ? 4 : 2]); return; }
      if (r > 4.1) return;
      // four rotating arms with glowing team tips (same reach in every frame)
      for (let k = 0; k < 4; k++) {
        const ang = ph + k * (Math.PI / 2);
        const ax = Math.sin(ang), ay = -Math.cos(ang);
        const along = dx * ax + dy * ay, across = Math.abs(dx * ay - dy * ax);
        if (along > 1.5 && along < 3.75 && across < 0.72) {
          if (along > 2.9) plot(a, x, y, cyP[3], TEAM_GLOW.body(3));
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
    const R = 3.8 + t * 3.4;                 // expanding pulse ring (always a closed ring)
    forEachPixel(a, (x, y, dx, dy) => {
      const r = Math.hypot(dx, dy);
      if (Math.abs(r - R) < 0.6) {
        const k = 1 - t;
        const c = k > 0.6 ? cyP[3] : k > 0.3 ? cyP[3] : cyP[2];
        plot(a, x, y, withAlpha(c, 110 + 145 * k | 0), emi(c, k > 0.5 ? 0.5 : 0.3));
      }
    });
    // escape pod: small steel capsule with a steady team-lit window; the center blinks
    const pod = parseMap([
      '.....', '.656.', '65+54', '5d*d3', '45a42', '.343.', '.....',
    ], L_SHIP);
    plot(pod, 1, 3, cyP[3], TEAM_GLOW.body(3)); plot(pod, 3, 3, cyP[3], TEAM_GLOW.body(3));
    plot(pod, 2, 3, f >= 3 ? cyP[4] : WHITE, f >= 3 ? TEAM_GLOW.body(3) : TEAM_GLOW.hot(4));
    outline(pod, OUT);
    blit(a, pod, 5, 4);
    // four chevrons pointing at the pod
    for (const [cx, cy] of [[7, 1], [7, 13], [1, 7], [13, 7]]) {
      const on = (f & 1) === 0;
      plot(a, cx, cy, withAlpha(cyP[3], on ? 235 : 170), on ? TEAM_GLOW.body(3) : 0);
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

// Direction frames for analytic shapes: supersampled rasterization at the first-octant
// angles, exact pixel permutations for the rest (see pixel.js symmetricDirs), then `post`
// (outline etc.) per frame. shade(u, v) must be mirror-symmetric in u.
function bakeAnalytic(size, dirs, shade, post, ss = 4, thr = 0.45) {
  const frames = symmetricDirs(dirs, (i, ang) => rasterAnalytic(size, ang, shade, ss, thr, (size - 1) / 2),
    (t, op) => (op === 'rot' ? rot90Art(t) : mirrorDiagArt(t)));
  return frames.map((a, d) => (post ? post(cloneArt(a), d) || a : a));
}

// Label-based direction frames for lit sprites: rasterize small integer labels at the
// first-octant angles (labelShade(u, v) -> label | 0), permute exactly (mirroring swaps
// left/right labels via `swap`), then paint(labels, heading) each frame with lighting from
// its true heading, so the key light stays top-left in all directions.
function bakeLabeled(size, dirs, labelShade, swap, paint, overlay = null, maxR = Infinity) {
  const frames = symmetricDirs(dirs, (i, ang) => {
    const a = rasterAnalytic(size, ang, (u, v) => { const l = labelShade(u, v); return l ? [l, 0] : null; }, 4, 0.5, maxR);
    if (overlay) overlay(a, ang);
    return a;
  }, (t, op) => {
    if (op === 'rot') return rot90Art(t);
    const m = mirrorDiagArt(t);
    for (let i = 0; i < m.col.length; i++) if (swap[m.col[i]] !== undefined) m.col[i] = swap[m.col[i]];
    return m;
  });
  return frames.map((lab, d) => paint(lab, (d / dirs) * TAU));
}

// Unit vector of the sprite's local +u (its right side) in screen space for a heading.
const acrossVec = (ang) => [Math.cos(ang), Math.sin(ang)];
// Light (0..1) on a face whose normal leans `tilt` toward local side s (-1 left, +1 right).
function faceLight(ang, s, tilt = 0.6) {
  const [ax, ay] = acrossVec(ang);
  const nz = Math.sqrt(1 - tilt * tilt);
  return lambert(ax * s * tilt, ay * s * tilt, nz);
}

// Paint a 1-px line of `label` along the heading axis (v0..v1, pixel units), one pixel per
// row (headings in the first octant are y-major), so thin spines never break or double.
function axisLabel(a, ang, v0, v1, label, inside = true) {
  const n = a.w, c = (n - 1) / 2;
  const fx = Math.sin(ang), fy = -Math.cos(ang);
  for (let y = 0; y < n; y++) {
    const dy = y - c;
    const t = dy / fy;                              // distance along the axis for this row
    const v = t;
    if (v < Math.min(v0, v1) || v > Math.max(v0, v1)) continue;
    const x = Math.round(c + fx * t);
    const i = y * n + x;
    if (inside && !a.col[i]) continue;
    a.col[i] = label;
  }
}

// translucent team pixel: color index i, alpha, emissive factor
function tp(a, x, y, i, al = 255, k = 0.3) {
  plot(a, x, y, withAlpha(cyP[i], al), k ? emi(cyP[i], k) : 0);
}

// Vulcan tracer: single white-hot tip, pale team core, faint translucent sheath with no
// glow of its own; the whole round glows at ~30% so enemy bullets always out-shine it.
function vulcanShade(big) {
  const HEAD = big ? 6.3 : 5.4, TAIL = big ? -5.4 : -4.4;   // 12 / 10 px long
  const R = big ? 2.05 : 1.05;                               // 5 / 3 px wide
  const CORE = big ? 1.05 : 0.5;                             // 3 / 1 px hot core
  return (u, v) => {
    if (v > HEAD || v < TAIL) return null;
    const au = Math.abs(u);
    const t = (HEAD - v) / (HEAD - TAIL);                    // 0 at the head .. 1 at the tail
    let r;
    if (big) {
      // teardrop: rounded plasma head, long tapering tail
      const hc = HEAD - R;
      r = v > hc ? R * Math.sqrt(Math.max(0, 1 - ((v - hc) / R) ** 2)) + 0.25 : R * (1 - Math.max(0, t - 0.35) * 1.15);
    } else {
      r = v > HEAD - 1 ? R * 0.5 : R * (1 - Math.max(0, t - 0.5) * 1.1);
    }
    if (au > r) return null;
    if (au < CORE) {
      if (v > HEAD - (big ? 2.2 : 1) && au < 0.5) return [WHITE, emi(cyP[4], 0.3)];
      if (t < 0.4) return [withAlpha(cyP[5], 225), emi(cyP[3], 0.3)];
      const i = t < 0.68 ? 4 : 3;
      return [withAlpha(cyP[i], Math.round(225 * (1 - t * 0.5))), t < 0.68 ? emi(cyP[2], 0.3) : 0];
    }
    return [withAlpha(cyP[t < 0.4 ? 4 : 3], Math.round(165 * (1 - t * 0.75))), 0];
  };
}

// Micro-missile labels: steel body halves, team nose band, tail fins, glowing exhaust.
const MS = { bodyL: 1, bodyR: 2, bandL: 3, bandR: 4, finL: 5, finR: 6, nose: 7, hot: 8, tail: 9 };
const MS_SWAP = { 1: 2, 2: 1, 3: 4, 4: 3, 5: 6, 6: 5 };
function missileLabel(u, v) {
  const au = Math.abs(u), L = u < 0;
  if (v > 4.3 || v < -4.4) return 0;
  if (v > 2.8) return au < 0.5 + (4.3 - v) * 0.25 ? MS.nose : 0;                    // nose cone
  if (v > -2.0) {
    if (au > 1.05) return 0;
    if (v > 1.6) return L ? MS.bandL : MS.bandR;                                       // team band
    return L ? MS.bodyL : MS.bodyR;
  }
  if (v > -3.5) {
    if (au <= 1.05) return L ? MS.bodyL : MS.bodyR;
    return au <= 1.05 + (-2.0 - v) * 1.25 ? (L ? MS.finL : MS.finR) : 0;               // swept fins
  }
  if (au < 0.55) return v > -3.9 ? MS.hot : MS.tail;
  return 0;
}
function missilePaint(lab, ang) {
  const a = newArt(lab.w, lab.h);
  const lL = faceLight(ang, -1), lR = faceLight(ang, 1);
  const litL = lL >= lR;
  for (let i = 0; i < lab.col.length; i++) {
    const l = lab.col[i];
    if (!l) continue;
    const leftSide = l === MS.bodyL || l === MS.bandL || l === MS.finL;
    const lit = leftSide === litL;
    let c = 0, e = 0;
    switch (l) {
      case MS.bodyL: case MS.bodyR: c = stP[lit ? 6 : 4]; break;
      case MS.bandL: case MS.bandR: c = cyP[lit ? 4 : 3]; break;
      case MS.finL: case MS.finR: c = stP[lit ? 5 : 3]; break;
      case MS.nose: c = stP[7]; break;
      case MS.hot: c = WHITE; e = emi(cyP[4], 0.75); break;
      case MS.tail: c = withAlpha(cyP[4], 200); e = emi(cyP[3], 0.5); break;
    }
    a.col[i] = c; a.emi[i] = e;
  }
  return outline(a, OUT);
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
        if (d === 0) plot(a, x, y, withAlpha(cyP[5], 235), emi(cyP[3], 0.5));
        else if (d === 1) tp(a, x, y, s > 0.45 ? 4 : 3, 200, s > 0.6 ? 0.3 : 0);
        else if (d === 2) tp(a, x, y, s > 0.6 ? 4 : 3, 130, 0);
        else if (s > 0.55 || ((y + f) & 3) === 0) tp(a, x, y, 3, 70, 0);
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
      else if (r <= 2.3) { i = 5; al = 215; }
      else if (r <= 3.1 && f !== 3) { i = 4; al = 150; }
      else if ((ax === 0 && ay <= len) || (ay === 0 && ax <= len)) { i = Math.max(ay, ax) > 3 ? 3 : 4; al = 190; }
      else if (ax === ay && ax <= dlen) { i = 3; al = 140; }
      if (i < 0) return;
      if (i === 6) plot(a, x, y, WHITE, emi(cyP[4], 0.5));
      else tp(a, x, y, i, al, i >= 5 && r <= 1.5 ? 0.3 : 0);
    });
    out.push(a);
  }
  return out;
}

// Plasma crescent (convex side forward/up). w,h frame size. Pale and translucent: the
// crest is the team's lightest tone (never white) and only glows at 30%.
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
      let i, al;
      if (k < 0.34) { i = up > 0.35 && n > 0.3 ? 5 : 4; al = 205; }
      else if (k < 0.7) { i = n > 0.55 ? 4 : 3; al = 175; }
      else { i = n > 0.5 ? 3 : 2; al = 140; }
      if (up < 0.25) { i = Math.min(i, 4); al = Math.min(al, 165); }
      tp(a, x, y, i, al, k < 0.34 && i >= 5 ? 0.3 : 0);   // only the crest glows
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
    a.col[i] = withAlpha(c === WHITE ? cyP[5] : c, y > 4 ? 140 : 215);
    a.emi[i] = y === 1 ? emi(cyP[4], 0.3) : 0;
  }
  return a;
}

// =======================================================================================
// ENEMY BULLETS — the most readable objects on screen: white-hot center, bright core,
// darker colored ring, 1-px dark rim, strong glow. Four color families.
// =======================================================================================

// Each family has a main ramp R and a glow ramp G. Interiors glow at reduced strength so
// main + light never clips to a common pink-white; the saturated ring and the white-hot
// center feed the bloom. Violet glows from the bluer violet ramp so it stays far from
// magenta after the additive pass, and carries a shape cue (dark inner ring) as well.
const VI = RAMPS.violet;
const EB_FAM = {
  p: { R: MG, G: MG },
  o: { R: EM, G: EM },
  v: { R: PL, G: [VI[0], VI[1], VI[2], VI[3], VI[3], VI[4]] },
  c: { R: CR, G: CR },
};
const famP = (k) => ({ k, R: EB_FAM[k].R.map(P), G: EB_FAM[k].G.map(P) });

// Concentric radial painter. bands: [[maxR, color, emissive], ...] (ascending radius).
function radial(size, bands, spec = null, S = null) {
  const a = newArt(size, size);
  forEachPixel(a, (x, y, dx, dy) => {
    const d = Math.hypot(dx, dy);
    for (const [mr, c, e] of bands) {
      if (d <= mr) { if (c) plot(a, x, y, c, e); return; }
    }
  });
  if (spec) plot(a, spec[0], spec[1], WHITE, S);
  outline(a, OUT);
  return a;
}

// Glow recipe shared by the round bullets: the white-hot center and pale inner band carry
// the bloom in the family's saturated light tone (those pixels may clip to white); the
// saturated bands only glow as much as keeps main + light from clipping to a common pink.
const ebGlow = (G) => ({ core: G[4], inner: scaleRGB(G[4], 0.5), band: scaleRGB(G[2], 0.5), ring: scaleRGB(G[2], 0.42) });

function ebSmall(F) {
  const { R, G } = F;
  const E = ebGlow(G);
  const f0 = newArt(5, 5), f1 = newArt(5, 5);
  const L0 = ['.....', '.ebe.', '.bwb.', '.ebe.', '.....'];
  const L1 = ['.....', '.cbc.', '.bwb.', '.cbc.', '.....'];
  const put = (a, rows) => rows.forEach((r, y) => [...r].forEach((ch, x) => {
    if (ch === 'w') plot(a, x, y, WHITE, E.core);
    else if (ch === 'b') plot(a, x, y, F.k === 'v' ? R[4] : R[5], E.inner);
    else if (ch === 'c') plot(a, x, y, R[3], E.band);
    else if (ch === 'e') plot(a, x, y, R[2], E.ring);
  }));
  put(f0, L0); put(f1, L1);
  outline(f0, OUT); outline(f1, OUT);
  return [f0, f1];
}

function ebOrb(F) {
  const { R, G } = F;
  const E = ebGlow(G);
  if (F.k === 'v') {
    // violet: hot core, dark inner ring, bright outer ring ("donut", kin of eb_ring_v)
    return [
      radial(9, [[0.9, WHITE, E.core], [1.5, R[4], E.inner], [2.3, R[1], 0], [3.0, R[3], E.band], [3.6, R[2], E.ring]], [3, 2], E.core),
      radial(9, [[1.2, WHITE, E.core], [1.5, R[4], E.inner], [2.3, R[1], scaleRGB(G[1], 0.5)], [3.0, R[3], E.band], [3.6, R[3], E.ring]], [3, 2], E.core),
    ];
  }
  return [
    radial(9, [[0.9, WHITE, E.core], [1.9, R[5], E.inner], [2.75, R[3], E.band], [3.6, R[2], E.ring]], [3, 2], E.core),
    radial(9, [[1.2, WHITE, E.core], [2.2, R[5], E.inner], [3.0, R[3], E.band], [3.6, R[2], E.ring]], [3, 2], E.core),
  ];
}

function ebBig(F) {
  const { R, G } = F;
  const E = ebGlow(G);
  const out = [];
  for (let f = 0; f < 4; f++) {
    const a = newArt(15, 15);
    const ph = (f / 4) * (TAU / 3);
    forEachPixel(a, (x, y, dx, dy) => {
      const d = Math.hypot(dx, dy);
      if (d > 6.4) return;
      if (F.k === 'v') {
        // violet pulsar: small hot core, concentric ripples travelling outward
        if (d <= 1.0) return plot(a, x, y, WHITE, E.core);
        if (d <= 2.0) return plot(a, x, y, R[4], E.inner);
        if (d > 5.6) return plot(a, x, y, R[2], E.ring);
        const w = Math.cos((d - 2.0) * 2.0 - f * (Math.PI / 2));
        if (w > 0.35) plot(a, x, y, R[3], E.band);
        else if (w > -0.3) plot(a, x, y, R[2], E.ring);
        else plot(a, x, y, R[1], 0);
        return;
      }
      if (d <= 1.4) return plot(a, x, y, WHITE, E.core);
      if (d <= 2.6) return plot(a, x, y, R[5], E.inner);
      if (d > 5.6) return plot(a, x, y, R[2], E.ring);
      const th = Math.atan2(dy, dx);
      const arm = Math.sin(3 * th + d * 1.15 - ph * 3);
      if (arm > 0.35) plot(a, x, y, R[4], E.band);
      else if (arm > -0.45) plot(a, x, y, R[3], E.band);
      else plot(a, x, y, R[2], E.ring);
    });
    if (F.k !== 'v') { plot(a, 5, 4, WHITE, E.core); plot(a, 6, 4, R[5], E.inner); }
    outline(a, OUT);
    out.push(a);
  }
  return out;
}

// Needle / shard: a 3-px shard (5 px with its dark rim) with a white-hot core, clearly
// fatter and brighter than any player tracer at the same angle.
function ebNeedleShade(F) {
  const { R, G } = F;
  const E = ebGlow(G);
  return (u, v) => {
    if (v > 4.4 || v < -4.1) return null;
    const au = Math.abs(u);
    const hw = v > 3.0 ? 1.05 * (4.4 - v) / 1.4 + 0.1 : v < -3.0 ? 0.5 : 1.05;
    if (au > hw) return null;
    if (au < 0.5 && v > -1.8 && v < 2.6) return [WHITE, E.core];
    if (v > 2.6) return [R[5], E.inner];
    if (v < -2.2) return [R[2], E.ring];
    return [R[3], E.band];
  };
}

// 4-point spinning star; coverage-rasterized so every spin phase keeps its points.
function ebStar(F) {
  const { R, G } = F;
  const out = [];
  for (let f = 0; f < 4; f++) {
    const a = newArt(9, 9);
    const ph = (f / 4) * (Math.PI / 2);
    const pts = [];
    for (let k = 0; k < 8; k++) {
      const ang = ph + (k * Math.PI) / 4;
      const r = k & 1 ? 2.0 : 4.3;
      pts.push([4.5 + Math.sin(ang) * r, 4.5 - Math.cos(ang) * r]);
    }
    for (let y = 1; y < 8; y++) {
      for (let x = 1; x < 8; x++) {
        let hit = 0;
        for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) if (pointInPoly(x + (i + 0.5) / 3, y + (j + 0.5) / 3, pts)) hit++;
        if (hit < 4) continue;
        const d = Math.hypot(x - 4, y - 4);
        const E = ebGlow(G);
        if (d < 0.7) plot(a, x, y, WHITE, E.core);
        else if (d < 1.8) plot(a, x, y, R[5], E.inner);
        else if (d < 2.9) plot(a, x, y, R[3], E.band);
        else plot(a, x, y, R[2], E.ring);
      }
    }
    if (f === 2) {
      // the 45-degree phase is hand-pixeled: an X star with 2-px arms (rasterizing it
      // collapses the points into a square)
      a.col.fill(0); a.emi.fill(0);
      const X = ['.........', '.#.....#.', '.##...##.', '..#####..', '...###...', '..#####..', '.##...##.', '.#.....#.', '.........'];
      const E = ebGlow(G);
      X.forEach((row, y) => [...row].forEach((ch, x) => {
        if (ch !== '#') return;
        const d = Math.hypot(x - 4, y - 4);
        if (d < 0.7) plot(a, x, y, WHITE, E.core);
        else if (d < 1.5) plot(a, x, y, R[5], E.inner);
        else if (d < 3.0) plot(a, x, y, R[3], E.band);
        else plot(a, x, y, R[2], E.ring);
      }));
    }
    if (f === 3) { out.push(mirrorDiagArt(out[1])); continue; }
    outline(a, OUT);
    out.push(a);
  }
  return out;
}

function ebRing(F) {
  const { R, G } = F;
  const out = [];
  for (let f = 0; f < 2; f++) {
    const a = newArt(11, 11);
    forEachPixel(a, (x, y, dx, dy) => {
      const d = Math.hypot(dx, dy);
      if (d < 2.3 || d > 4.3) return;
      const lit = (-dx - dy) / (d * 1.414);          // -1..1, 1 toward the upper left
      const hot = f === 0 ? lit > 0.72 : lit < -0.72;
      const E = ebGlow(G);
      if (hot) plot(a, x, y, WHITE, E.core);
      else if (d < 3.1) plot(a, x, y, R[4], E.inner);
      else plot(a, x, y, f ? R[3] : R[2], E.band);
    });
    outline(a, OUT);
    out.push(a);
  }
  return out;
}

function buildEnemyBulletFamily(k) {
  const F = famP(k);
  addArt('eb_small_' + k, ebSmall(F), { frames: 2, fps: 12 });
  addArt('eb_orb_' + k, ebOrb(F), { frames: 2, fps: 10 });
  if (k !== 'c') addArt('eb_big_' + k, ebBig(F), { frames: 4, fps: 12 });
  if (k !== 'v') addArt('eb_needle_' + k, bakeAnalytic(11, 32, ebNeedleShade(F), (a) => outline(a, OUT)), { frames: 1, dirs: 32 });
}

const T_ENEMY_BULLETS = [
  ...['p', 'o', 'v', 'c'].map((k) => ['eb_*_' + k, () => buildEnemyBulletFamily(k)]),
  ['eb_star_o', () => addArt('eb_star_o', ebStar(famP('o')), { frames: 4, fps: 16 })],
  ['eb_ring_v', () => addArt('eb_ring_v', ebRing(famP('v')), { frames: 2, fps: 8 })],
];

// =======================================================================================
// ENEMIES — the Choir: obsidian/plum carapace, glowing magenta cores, some crystal
// =======================================================================================

const caP = CA.map(P), mgP = MG.map(P), crP = CR.map(P), plP = PL.map(P), emP = EM.map(P);
const hullP = RAMPS.hull.map(P), rustP = RAMPS.rust.map(P);
const SOLID = new Set([...caP, ...hullP, ...rustP, ...stP]);
const isSolid = (p) => SOLID.has(p | 0xff000000);
const isCrystal = inRamp(CR);
const isCara = (p) => SOLID.has(p | 0xff000000) || isCrystal(p);

const isCarapace = inRamp(CA);
const CHOIR_RIM = scaleRGB(P(MG[2]), 0.42);

// Rim light (key light upper-left) on solid materials + 1-px dark outline.
// opt.choir: the Choir's obsidian needs more separation from dark space and plum nebulae:
// a stronger top-left rim (+2), small bodies lifted one ramp step, and a faint magenta
// underglow on the lower-right silhouette edge (emissive only), as if lit by their cores.
function finish(a, opt = {}) {
  if (opt.choir) {
    if (opt.small) shiftWhere(a, SHIFT, 1, (x, y, p) => isCarapace(p));
    rimLight(a, SHIFT, { lit: 2, shade: -1, test: isCarapace });
    choirRim(a);
  } else if (opt.rim !== false) {
    rimLight(a, SHIFT, { lit: 1, shade: -1, test: opt.test || isSolid });
  }
  outline(a, OUT, opt);
  return a;
}

function choirRim(a) {
  const { w, h, col, emi: E } = a;
  const empty = (x, y) => x < 0 || y < 0 || x >= w || y >= h || !col[y * w + x];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!col[i] || E[i] || !isCarapace(col[i])) continue;
      if ((empty(x + 1, y) || empty(x, y + 1)) && !empty(x - 1, y) && !empty(x, y - 1)) E[i] = CHOIR_RIM;
    }
  }
}

// Ellipsoid light at offset (dx,dy) inside radii (rx,ry): 0..1, or -1 outside.
function domeLight(dx, dy, rx, ry, flat = 1) {
  const nx = dx / rx, ny = dy / ry;
  const r2 = nx * nx + ny * ny;
  if (r2 > 1) return -1;
  const nz = Math.sqrt(1 - r2) * flat;
  const l = Math.hypot(nx, ny, nz) || 1;
  return lambert(nx / l, ny / l, nz / l);
}
const pickIdx = (l, lo, hi) => Math.max(lo, Math.min(hi, lo + Math.floor(l * (hi - lo + 1))));

// Paint a shaded ellipsoid dome (ramp indices lo..hi).
function dome(a, cx, cy, rx, ry, ramp, lo = 1, hi = ramp.length - 1, flat = 1, emiK = 0) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const l = domeLight(x - cx, y - cy, rx, ry, flat);
      if (l < 0) continue;
      const c = ramp[pickIdx(l, lo, hi)];
      plot(a, x, y, c, emiK ? emi(c, emiK) : 0);
    }
  }
}

// Tapered spike from radius r0 to r1 along angle ang (0 = right, clockwise), half width hw.
function spike(a, cx, cy, ang, r0, r1, hw, ramp, lo = 2, hi = 5) {
  const fx = Math.cos(ang), fy = Math.sin(ang);
  const R = Math.ceil(r1 + 1);
  for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++) {
    for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
      const dx = x - cx, dy = y - cy;
      const al = dx * fx + dy * fy, ac = -dx * fy + dy * fx;
      if (al < r0 || al > r1) continue;
      const w = hw * (r1 - al) / (r1 - r0);
      if (Math.abs(ac) > w + 0.15) continue;
      // face normal of the side we are on, tilted up
      const sx = ac < 0 ? fy : -fy, sy = ac < 0 ? -fx : fx;
      const l = lambert(sx * 0.7, sy * 0.7, 0.7);
      plot(a, x, y, ramp[l > 0.55 ? hi : l > 0.3 ? (lo + hi) >> 1 : lo]);
    }
  }
}

// Stamp a map onto an art ('.' = skip, '_' = clear). mirrorAt: also stamp mirrored around
// that column (absolute x).
function stamp(a, rows, L, x0, y0, mirrorAt = null) {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      const px = x0 + x, py = y0 + y;
      const put = (X) => {
        if (ch === '_') { plot(a, X, py, 0, 0); return; }
        const e = L[ch];
        if (e === undefined) throw new Error(`stamp: unknown char '${ch}'`);
        plot(a, X, py, e.c, e.e);
      };
      put(px);
      if (mirrorAt != null) put(2 * mirrorAt - px);
    }
  });
}

// Parse a mirrored enemy map and darken its right half (key light from the left).
function enemyMap(rows, dark = -1, L = L_EN) {
  const a = parseMap(rows, L, { mirror: true });
  if (dark) shadeRight(a, dark, isCara);
  return a;
}

// ---- en_mite: tiny swarm drone, wing flicker ----------------------------------------
function miteFrames() {
  const F = [
    ['......', '.54...', '.65445', '.34356', '...245', '...1BE', '....1C', '....2.', '......'],
    ['......', '......', '....45', '..5456', '.54245', '.431BE', '.2..1C', '....2.', '......'],
  ];
  return F.map((rows) => finish(enemyMap(rows), { choir: true, small: true }));
}

// ---- en_dart / en_lancet: rotating fighters, 16 dirs ----------------------------------
// Vector silhouettes rasterized at 0 / 22.5 / 45 degrees and permuted exactly for the
// other 13 directions (same pixel structure at every angle); the magenta spine is a
// continuous 1-px line, and the two hull facets are lit from each frame's true heading.
const FT = { L: 1, R: 2, spine: 3, engine: 4, exhaust: 5, tipL: 6, tipR: 7 };
const FT_SWAP = { 1: 2, 2: 1, 6: 7, 7: 6 };

const mirrorPoly = (half) => [...half, ...half.slice().reverse().map(([u, v]) => [-u, v])];
const DART_POLY = mirrorPoly([[0, 6.9], [5.55, -3.3], [5.55, -5.55], [4.5, -5.55], [2.45, -3.5], [1.55, -4.45], [1.55, -5.55], [0.55, -6.55], [0, -6.55]]);
const LANCET_POLY = mirrorPoly([[0, 9.95], [1.55, 4.0], [3.55, -1.4], [6.55, -4.1], [6.55, -7.55], [2.45, -4.5], [1.55, -5.45], [1.55, -7.55], [0.55, -9.55], [0, -9.55]]);

function fighterDirs(poly, size, o) {
  // right half closed along the axis (u = 0), for a cheaper symmetric inside test
  const half = poly.filter(([u]) => u >= 0);
  const shape = (u, v) => {
    if (!pointInPoly(Math.max(1e-6, Math.abs(u)), v, half)) return 0;   // symmetric: test one half
    if (v < o.tipV && Math.abs(u) > o.tipU) return u < 0 ? FT.tipL : FT.tipR;
    return u < 0 ? FT.L : FT.R;
  };
  const overlay = (a, ang) => {
    axisLabel(a, ang, o.spine[0], o.spine[1], FT.spine);
    axisLabel(a, ang, o.engine[0], o.engine[1], FT.engine);
    axisLabel(a, ang, o.engine[1], o.exhaust, FT.exhaust);
  };
  const paint = (lab, ang) => {
    const a = newArt(size, size);
    const lL = faceLight(ang, -1, 0.55), lR = faceLight(ang, 1, 0.55);
    const tone = (l) => (l > 0.62 ? 5 : l > 0.38 ? 4 : 3);
    for (let i = 0; i < lab.col.length; i++) {
      switch (lab.col[i]) {
        case FT.L: a.col[i] = caP[tone(lL)]; break;
        case FT.R: a.col[i] = caP[tone(lR)]; break;
        case FT.spine: a.col[i] = mgP[4]; a.emi[i] = mgP[3]; break;
        case FT.engine: a.col[i] = mgP[5]; a.emi[i] = mgP[4]; break;
        case FT.exhaust: a.col[i] = mgP[3]; a.emi[i] = mgP[2]; break;
        case FT.tipL: case FT.tipR: a.col[i] = mgP[3]; a.emi[i] = scaleRGB(mgP[3], 0.75); break;
      }
    }
    return finish(a, { choir: true });
  };
  const maxR = Math.max(...poly.map(([u, v]) => Math.hypot(u, v)));
  return bakeLabeled(size, 16, shape, FT_SWAP, paint, overlay, maxR);
}

// ---- en_wisp: plasma spore held by four curling carapace claws ----------------------
// The dark claws (with glowing tips) and the slit pupil mark it as a creature, never a
// bullet; only the orb radius and the claws' curl breathe, so all 4 frames read as one.
function wispFrames() {
  const out = [];
  for (let f = 0; f < 4; f++) {
    const a = newArt(13, 13);
    const ph = (f / 4) * TAU;
    const R = 2.55 + 0.4 * Math.sin(ph);
    const curl = 1.05 + 0.3 * Math.sin(ph + 1.2);
    for (let k = 0; k < 4; k++) {
      const a0 = (k / 4) * TAU + Math.PI / 4;
      let px = null, py = null;
      for (let st = 0; st <= 24; st++) {
        const t = st / 24;
        const r = 3.0 + t * 2.45;
        const ang = a0 + t * curl;
        const x = Math.round(6 + Math.cos(ang) * r), y = Math.round(6 + Math.sin(ang) * r);
        if (x === px && y === py) continue;
        const tip = t > 0.9;
        plot(a, x, y, tip ? mgP[4] : caP[t > 0.5 ? 4 : 5], tip ? mgP[3] : 0);
        px = x; py = y;
      }
    }
    forEachPixel(a, (x, y, dx, dy) => {
      const d = Math.hypot(dx, dy);
      if (d > R) return;
      const l = sphereLight(dx / (R + 0.4), dy / (R + 0.4), 0.7);
      const idx = l > 0.85 ? 5 : l > 0.62 ? 4 : l > 0.38 ? 3 : 2;
      plot(a, x, y, mgP[idx], mgP[Math.max(1, idx - 1)]);
    });
    // slit pupil (vertical), only while the orb is wide open
    if (R > 2.4) { plot(a, 6, 5, caP[0], 0); plot(a, 6, 6, caP[0], 0); plot(a, 6, 7, caP[0], 0); }
    out.push(finish(a, { choir: true }));
  }
  return out;
}

// ---- en_eye: floating turret eye, open -> closed ----------------------------------
function eyeFrames() {
  const out = [];
  const open = [3.4, 2.2, 1.1, 0];
  for (let f = 0; f < 4; f++) {
    const a = newArt(17, 17);
    for (const ang of [0.785, 2.356, 3.927, 5.498]) spike(a, 8, 8, ang, 5.2, 7.6, 1.7, caP, 3, 6);
    dome(a, 8, 8, 6.3, 6.3, caP, 2, 6, 0.8);
    const ry = open[f], rx = 4.9, ey0 = 8.5;
    forEachPixel(a, (x, y, dx, dy) => {
      const ddy = y - ey0;
      if (ry > 0) {
        const e = (dx / rx) ** 2 + (ddy / ry) ** 2;
        if (e <= 1) {
          const d = Math.hypot(dx, ddy);
          if (Math.abs(dx) < 0.6 && Math.abs(ddy) < Math.min(1.7, ry) && ry > 1.5) plot(a, x, y, caP[0], 0);
          else if (d < 1.7) plot(a, x, y, mgP[5], mgP[4]);
          else if (d < 3.0) plot(a, x, y, mgP[3], mgP[3]);
          else plot(a, x, y, mgP[1], mgP[1]);
          return;
        }
        const eo = (dx / (rx + 1.2)) ** 2 + (ddy / (ry + 1.2)) ** 2;
        if (eo <= 1) plot(a, x, y, ddy < 0 ? caP[6] : caP[4]);
      } else if (y === 9 && Math.abs(dx) <= rx) {
        plot(a, x, y, Math.abs(dx) < 2 ? mgP[2] : caP[0], Math.abs(dx) < 2 ? mgP[1] : 0);
      } else if (y === 8 && Math.abs(dx) <= rx - 0.5) {
        plot(a, x, y, caP[6]);
      } else if (y === 10 && Math.abs(dx) <= rx - 0.5) {
        plot(a, x, y, caP[4]);
      }
    });
    if (ry > 1.5) plot(a, 7, 7, WHITE, 0);
    out.push(finish(a, { choir: true }));
  }
  return out;
}

// ---- en_carapace: armored beetle gunship --------------------------------------------
function carapaceFrames() {
  const out = [];
  for (let f = 0; f < 2; f++) {
    const a = newArt(25, 21);
    // legs / side thrusters
    // three jointed legs per side, rooted in the shell edge (drawn first, shell on top)
    for (const [x, y, c] of [[3, 5, 3], [2, 4, 3], [1, 3, 2], [2, 8, 4], [1, 8, 3], [1, 9, 2], [3, 11, 3], [2, 12, 3], [1, 13, 2]]) {
      plot(a, x, y, caP[c]); plot(a, 24 - x, y, caP[Math.max(1, c - 1)]);
    }
    dome(a, 12, 7.8, 9.6, 7.2, caP, 1, 6, 0.75);
    // elytra plates: dark seams with a lit lip above
    for (const ry of [5, 10]) {
      for (let x = 0; x < 25; x++) {
        const i = ry * 25 + x;
        if (!a.col[i] || x === 12) continue;
        const yy = ry + (Math.abs(x - 12) > 6 ? 1 : 0);
        const j = yy * 25 + x;
        if (a.col[j]) a.col[j] = SHIFT.shift(a.col[j], -2);
        const k = (yy - 1) * 25 + x;
        if (a.col[k]) a.col[k] = SHIFT.shift(a.col[k], 1);
      }
    }
    // central glowing seam between the wing cases
    for (let y = 1; y <= 15; y++) {
      if (!a.col[y * 25 + 12]) continue;
      plot(a, 12, y, f ? mgP[4] : mgP[3], f ? mgP[4] : mgP[3]);
      plot(a, 11, y, f ? mgP[1] : caP[0], f ? mgP[1] : 0);
      plot(a, 13, y, f ? mgP[1] : caP[0], f ? mgP[1] : 0);
    }
    // bio-lights on the shell
    for (const [x, y] of [[7, 8], [17, 8]]) {
      plot(a, x, y, f ? mgP[5] : mgP[4], mgP[3]);
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) plot(a, x + ox, y + oy, mgP[1], f ? mgP[1] : 0);
    }
    // head with twin mandible guns
    stamp(a, [
      '...344',
      '.13455',
      '235E43',
      '343122',
      '43..21',
      '42....',
      f ? 'E1....' : 'C1....',
    ], L_EN, 7, 13, 12);
    out.push(finish(a, { choir: true }));
  }
  return out;
}

// ---- en_weaver: wide strafing bomber (flying wing) ----------------------------------
function weaverFrames() {
  const M = [
    '.......................',
    '.##.................##.',
    '.####.............####.',
    '..#####...###...#####..',
    '..#######.###.#######..',
    '...#################...',
    '...#################...',
    '....###############....',
    '.....#############.....',
    '......###########......',
    '.......#########.......',
    '........#######........',
    '.........#####.........',
    '..........###..........',
    '.......................',
  ];
  const out = [];
  for (let f = 0; f < 2; f++) {
    const a = newArt(23, 15);
    M.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch !== '#') return;
      const spine = x >= 10 && x <= 12;
      plot(a, x, y, caP[spine ? 4 : x < 11 ? 4 : 3]);
    }));
    // panel line across the wings + wing root seams
    for (let x = 0; x < 23; x++) {
      const i = 6 * 23 + x;
      if (a.col[i] && (x < 9 || x > 13)) a.col[i] = caP[2];
      const j = 5 * 23 + x;
      if (a.col[j] && (x < 9 || x > 13)) a.col[j] = caP[5];
    }
    dome(a, 11, 6.2, 2.4, 2.2, caP, 3, 6);
    // glowing strakes parallel to the leading edge
    for (const [x, y] of [[4, 4], [5, 5], [6, 7], [7, 8], [8, 9]]) {
      plot(a, x, y, mgP[3], mgP[f ? 3 : 2]);
      plot(a, 22 - x, y, mgP[2], mgP[f ? 3 : 2]);
    }
    // wing-tip lights, engines (rear = top), bomb bay core
    plot(a, 1, 1, mgP[f ? 5 : 3], mgP[3]); plot(a, 21, 1, mgP[f ? 5 : 3], mgP[3]);
    stamp(a, [f ? 'CF' : 'BE'], L_EN, 10, 3, 11);
    stamp(a, ['.b.', 'bEb', '.b.'], L_EN, 10, 9);
    if (f) plot(a, 11, 10, WHITE, mgP[5]);
    out.push(finish(a, { choir: true }));
  }
  return out;
}

// ---- en_mine: spiked mine, blinking --------------------------------------------------
function mineFrames() {
  const out = [];
  for (let f = 0; f < 2; f++) {
    const a = newArt(13, 13);
    for (let k = 0; k < 8; k++) spike(a, 6, 6, (k * Math.PI) / 4 - Math.PI / 2, 2.8, k & 1 ? 5.0 : 5.6, 1.25, caP, 2, 6);
    dome(a, 6, 6, 3.4, 3.4, caP, 1, 6);
    if (f === 0) {
      plot(a, 6, 6, WHITE, mgP[5]);
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) plot(a, 6 + ox, 6 + oy, mgP[4], mgP[3]);
    } else {
      plot(a, 6, 6, mgP[2], mgP[1]);
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) plot(a, 6 + ox, 6 + oy, mgP[1], 0);
    }
    out.push(finish(a, { choir: true }));
  }
  return out;
}

// ---- en_hornet: tri-blade stop-and-spin turret craft ---------------------------------
function hornetFrames() {
  const out = [];
  for (let f = 0; f < 3; f++) {
    const a = newArt(19, 19);
    const ph = (f / 3) * (TAU / 3);
    for (let k = 0; k < 3; k++) {
      const ang = ph + (k * TAU) / 3 - Math.PI / 2;
      const fx = Math.cos(ang), fy = Math.sin(ang);
      forEachPixel(a, (x, y, dx, dy) => {
        const al = dx * fx + dy * fy, ac = -dx * fy + dy * fx;
        const hw = 2.1 - (al - 2) * 0.12;
        if (al < 1.5 || al > 6.4 || Math.abs(ac) > hw) return;
        // beveled arm: ridge along the middle, faces lit by the key light
        const face = Math.abs(ac) < 0.6 ? lambert(0, 0, 1) :
          ac < 0 ? lambert(fy * 0.7, -fx * 0.7, 0.7) : lambert(-fy * 0.7, fx * 0.7, 0.7);
        plot(a, x, y, caP[face > 0.62 ? 5 : face > 0.45 ? 4 : face > 0.25 ? 3 : 2]);
      });
      const px = 9 + fx * 6.3, py = 9 + fy * 6.3;
      dome(a, px, py, 2.0, 2.0, caP, 2, 6);
      plot(a, Math.round(px + fx * 1.4), Math.round(py + fy * 1.4), mgP[4], mgP[3]);
    }
    dome(a, 9, 9, 3.6, 3.6, caP, 1, 6);
    plot(a, 9, 9, WHITE, mgP[4]);
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) plot(a, 9 + ox, 9 + oy, mgP[4], mgP[3]);
    for (const [ox, oy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) plot(a, 9 + ox, 9 + oy, mgP[2], mgP[1]);
    out.push(finish(a, { choir: true }));
  }
  return out;
}

// ---- en_seeker: small homing kamikaze -----------------------------------------------
function seekerFrames() {
  const out = [];
  for (let f = 0; f < 2; f++) {
    const a = newArt(9, 9);
    for (let k = 0; k < 4; k++) spike(a, 4, 4, (k * Math.PI) / 2 - Math.PI / 2, 1.8, f ? 3.7 : 3.3, 1.1, caP, 2, 6);
    dome(a, 4, 4, 2.2, 2.2, caP, 2, 6);
    plot(a, 4, 4, f ? WHITE : mgP[5], f ? mgP[5] : mgP[3]);
    for (const [ox, oy] of [[1, 0], [0, 1]]) plot(a, 4 + ox, 4 + oy, mgP[3], mgP[3]);
    plot(a, 3, 4, mgP[4], mgP[3]); plot(a, 4, 3, mgP[4], mgP[3]);
    out.push(finish(a, { choir: true, small: true }));
  }
  return out;
}

// ---- en_bastion: mid-boss frigate -----------------------------------------------------
function bastionArt() {
  const W = 49, H = 37, cx = 24;
  const a = newArt(W, H);
  const mir = (pts) => [...pts, ...pts.slice().reverse().map(([x, y]) => [W - x, y])];
  const fillPoly = (pts, fn) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (pointInPoly(x + 0.5, y + 0.5, pts)) fn(x, y);
  };
  // wings / sponsons
  fillPoly(mir([[15, 11], [6, 13.5], [2.5, 17.5], [3.5, 23], [8, 25], [15, 25.5]]), (x, y) => plot(a, x, y, caP[x < cx ? 3 : 2]));
  // hull
  const hullPts = mir([[24.5, 1], [19, 2], [15.5, 5.5], [14.5, 24], [19.5, 31.5], [24.5, 35.8]]);
  // rounded hull: shade each row as a cylinder lit from the upper left
  for (let y = 0; y < H; y++) {
    let x0 = -1, x1 = -1;
    for (let x = 0; x < W; x++) {
      if (!pointInPoly(x + 0.5, y + 0.5, hullPts)) continue;
      if (x0 < 0) x0 = x;
      x1 = x;
    }
    if (x0 < 0) continue;
    const hw = (x1 - x0) / 2 + 0.5, mid = (x0 + x1) / 2;
    for (let x = x0; x <= x1; x++) {
      const nx = (x - mid) / hw;
      const l = lambert(nx * 0.75, -0.25, Math.sqrt(Math.max(0, 1 - nx * nx * 0.56)));
      plot(a, x, y, caP[pickIdx(l, 2, 5)]);
    }
  }
  // armor plating: horizontal seams with lit lips, vertical seams
  for (const ry of [8, 14, 25]) {
    for (let x = 0; x < W; x++) {
      if (!a.col[ry * W + x]) continue;
      a.col[ry * W + x] = caP[1];
      if (a.col[(ry - 1) * W + x]) a.col[(ry - 1) * W + x] = SHIFT.shift(a.col[(ry - 1) * W + x], 1);
    }
  }
  for (let y = 4; y < 31; y++) {
    for (const sx of [18, 30]) {
      const i = y * W + sx;
      if (a.col[i] && y !== 8 && y !== 14 && y !== 25) a.col[i] = SHIFT.shift(a.col[i], -1);
    }
  }
  // wing armor chevrons
  for (let y = 15; y <= 23; y++) {
    for (const x of [8, 11]) {
      const xx = x + Math.abs(y - 19) * 0;
      if (a.col[y * W + xx]) { a.col[y * W + xx] = caP[2]; a.col[y * W + (W - 1 - xx)] = caP[1]; }
    }
  }
  // raised spine
  for (let y = 3; y < 14; y++) {
    plot(a, 23, y, caP[6]); plot(a, 24, y, caP[5]); plot(a, 25, y, caP[3]);
  }
  // engine nozzles at the stern (top) with magenta exhaust glow
  for (const ex of [19, 24, 29]) {
    stamp(a, ['BEB', '313', '424'], L_EN, ex - 1, 0);
  }
  // bridge dome with a ring of lit windows
  dome(a, 24, 19.5, 4.6, 4.2, caP, 2, 6, 0.9);
  for (let k = 0; k < 7; k++) {
    const ang = Math.PI + (k / 6) * Math.PI;
    plot(a, Math.round(24 + Math.cos(ang) * 3.4), Math.round(19.5 + Math.sin(ang) * 3.1), mgP[4], mgP[3]);
  }
  plot(a, 22, 17, caP[6]);
  // prow main gun: dark socket with a hot core
  forEachPixel(a, (x, y) => {
    const d = Math.hypot(x - 24, y - 29.5);
    if (d < 1.3) plot(a, x, y, d < 0.6 ? WHITE : mgP[5], mgP[4]);
    else if (d < 2.3) plot(a, x, y, mgP[2], mgP[2]);
    else if (d < 3.1) plot(a, x, y, caP[1]);
  });
  // turrets: domes with barrels pointing forward (down)
  for (const [tx, ty] of [[7, 18], [41, 18], [19, 11], [29, 11], [20, 27], [28, 27]]) {
    const bx = Math.round(tx);
    for (let k = 1; k <= 4; k++) plot(a, bx, Math.round(ty) + k, k === 4 ? mgP[4] : caP[k < 3 ? 5 : 4], k === 4 ? mgP[3] : 0);
    dome(a, tx, ty, 2.3, 2.1, caP, 2, 6);
    plot(a, bx, Math.round(ty), mgP[3], mgP[3]);
  }
  // glowing weapon trenches along the wings and hull flanks
  for (let x = 4; x <= 12; x++) {
    const y = 21, on = (x & 1) === 0;
    for (const X of [x, W - 1 - x]) {
      if (!a.col[y * W + X]) continue;
      plot(a, X, y, on ? mgP[3] : caP[0], on ? mgP[2] : 0);
      if (a.col[(y - 1) * W + X]) a.col[(y - 1) * W + X] = SHIFT.shift(a.col[(y - 1) * W + X], 1);
    }
  }
  for (let y = 16; y <= 23; y++) {
    for (const X of [16, W - 1 - 16]) {
      if (!a.col[y * W + X]) continue;
      plot(a, X, y, (y & 1) ? mgP[2] : caP[0], (y & 1) ? mgP[1] : 0);
    }
  }
  // bridge rim highlight
  for (let k = 0; k < 5; k++) plot(a, 20 + k, 15 + (k < 2 ? 2 - k : 0), caP[6]);
  // running lights
  for (const [x, y] of [[3, 18], [45, 18], [15, 7], [33, 7], [16, 25], [32, 25]]) plot(a, x, y, mgP[4], mgP[4]);
  return finish(a, { choir: true });
}

// ---- en_shard: crystal drone (Veil) ---------------------------------------------------
function shardFrames() {
  const rows = [
    '.......', '......l', '.....kl', '.....kj', '....kjj', '....kji', '...kjji',
    '..k.lkji', '.kj.lkji', '.jh.lkaD', '.ih.lkaF', '..h.lkaD', '....lkji', '...kjih',
    '....jih', '....iih', '.....ih', '.....hg', '.....hh', '......h', '.......',
  ].map((r) => r.length > 7 ? r.slice(0, 1) + r.slice(2) : r);
  const out = [];
  for (let f = 0; f < 2; f++) {
    const a = enemyMap(rows);
    if (f) {
      // glint sweeps across the facets, core flares
      for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
        const i = y * a.w + x;
        if (a.col[i] && isCrystal(a.col[i]) && Math.abs((x - 2) - (y - 6) * 0.6) < 0.7) a.col[i] = crP[5];
      }
      plot(a, 6, 10, WHITE, mgP[5]);
    }
    // crystal edges glow faintly
    emissiveFrom(a, (p) => (p === crP[5] ? emi(crP[3], 0.5) : 0));
    out.push(finish(a, { test: isCara }));
  }
  return out;
}

// ---- en_phantom: phase-shifting manta ghost (Veil) -----------------------------------
function phantomFrames() {
  const rows = [
    '..........', '........t.', '........u.', '.......uv.', '.......vw.', '.....uvwwv',
    '...uvwwvvw', '.uvwwvvuvw', '.vwvvuuuvx', '.uvuuttuvw', '..uttstuvw', '...ss.tuvv',
    '......sLuv', '.......tuu', '........tt', '.........s', '..........',
  ];
  const base = enemyMap(rows, -1);
  const out = [];
  const alphaK = [1, 0.62, 0.3, 0.62];
  const edgeOf = (x, y) => x <= 0 || y <= 0 || x >= base.w - 1 || y >= base.h - 1 ||
    !base.col[y * base.w + x - 1] || !base.col[y * base.w + x + 1] || !base.col[(y - 1) * base.w + x] || !base.col[(y + 1) * base.w + x];
  for (let f = 0; f < 4; f++) {
    const a = cloneArt(base);
    for (let y = 0; y < a.h; y++) {
      // phase wobble: rows slide sideways while shifting
      const sh = f === 2 ? Math.round(Math.sin(y * 1.3) * 1) : 0;
      const row = a.col.slice(y * a.w, y * a.w + a.w), erow = a.emi.slice(y * a.w, y * a.w + a.w);
      for (let x = 0; x < a.w; x++) {
        const sx = x - sh;
        const c = sx >= 0 && sx < a.w ? row[sx] : 0;
        const e = sx >= 0 && sx < a.w ? erow[sx] : 0;
        const i = y * a.w + x;
        if (!c) { a.col[i] = 0; a.emi[i] = 0; continue; }
        const k = alphaK[f];
        const ghost = f === 2 && !e && !edgeOf(sx, y);
        a.col[i] = ghost ? 0 : withAlpha(c, Math.round(235 * (f === 2 ? 0.75 : k)));
        a.emi[i] = e || (k < 1 ? emi(plP[2], f === 2 ? 0.5 : 0.3) : 0);
      }
    }
    outline(a, withAlpha(OUT, f === 0 ? 255 : 150));
    out.push(a);
  }
  return out;
}

// ---- en_turret: ground turret base on the wreck hull ---------------------------------
function turretBase() {
  const a = newArt(19, 19);
  forEachPixel(a, (x, y, dx, dy) => {
    const od = Math.max(Math.abs(dx), Math.abs(dy), (Math.abs(dx) + Math.abs(dy)) * 0.7071);
    if (od > 8.2) return;
    const d = Math.hypot(dx, dy) || 1;
    const lit = (-dx * 0.62 - dy * 0.78) / d;
    if (od > 7.1) plot(a, x, y, hullP[lit > 0.3 ? 5 : lit > -0.3 ? 4 : 2]);
    else if (od > 6.1) plot(a, x, y, hullP[3]);
    else if (od > 4.4) plot(a, x, y, hullP[lit > 0.2 ? 2 : 1]);
    else if (d > 3.4) plot(a, x, y, hullP[lit < -0.2 ? 5 : lit > 0.3 ? 2 : 3]);   // recessed ring: lit inner wall faces up-left
    else plot(a, x, y, hullP[1]);
  });
  // bolts
  for (let k = 0; k < 8; k++) {
    const ang = (k * Math.PI) / 4 + Math.PI / 8;
    const x = Math.round(9 + Math.cos(ang) * 5.4), y = Math.round(9 + Math.sin(ang) * 5.4);
    plot(a, x, y, hullP[6]);
  }
  // magenta infection lights on the diagonals
  for (const [x, y] of [[4, 4], [14, 4], [4, 14], [14, 14]]) plot(a, x, y, mgP[3], mgP[3]);
  return finish(a);
}

// ---- en_turret_gun: one 3-px barrel on a domed cap, 16 dirs ----------------------------
// Barrel = lit edge | dark bore | shaded edge with a glowing 2-px muzzle; it reaches 2 px
// past the cap so the aim reads at 1x in every direction.
const TG = { cap: 1, L: 2, R: 3, bore: 4, muzzle: 5, sensor: 6 };  // labels
const TG_SWAP = { 2: 3, 3: 2 };
function turretGunDirs() {
  const size = 13, c = 6;
  const shape = (u, v) => {
    if (v >= -0.5 && v <= 5.45 && Math.abs(u) <= 1.5) return u < 0 ? TG.L : TG.R;
    return Math.hypot(u, v) <= 3.05 ? TG.cap : 0;
  };
  const overlay = (a, ang) => {
    axisLabel(a, ang, 0.6, 3.9, TG.bore);
    axisLabel(a, ang, 3.9, 5.45, TG.muzzle);
    axisLabel(a, ang, -1.4, -2.2, TG.sensor);
  };
  const paint = (lab, ang) => {
    const a = newArt(size, size);
    const litL = faceLight(ang, -1) >= faceLight(ang, 1);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        switch (lab.col[i]) {
          case TG.cap: a.col[i] = hullP[pickIdx(domeLight(x - c, y - c, 3.4, 3.4), 1, 4)]; break;
          case TG.L: a.col[i] = hullP[litL ? 6 : 4]; break;
          case TG.R: a.col[i] = hullP[litL ? 4 : 6]; break;
          case TG.bore: a.col[i] = hullP[0]; break;
          case TG.muzzle: a.col[i] = mgP[4]; a.emi[i] = mgP[3]; break;
          case TG.sensor: a.col[i] = mgP[3]; a.emi[i] = mgP[2]; break;
        }
      }
    }
    return finish(a);
  };
  return bakeLabeled(size, 16, shape, TG_SWAP, paint, overlay);
}

// ---- asteroids (Cinder Belt): lumpy rock, craters, molten cracks ---------------------
function rockArt(w, h, seed) {
  const a = newArt(w, h);
  const R = rng(seed);
  const cx = (w - 1) / 2 + (R() - 0.5) * 0.8, cy = (h - 1) / 2 + (R() - 0.5) * 0.8;
  const rx = w / 2 - 1.3, ry = h / 2 - 1.3;
  const big = w > 20, mid = w > 12;
  const craters = [];
  const nc = big ? 4 : mid ? 2 : 1;
  for (let i = 0; i < nc; i++) {
    const ang = R() * TAU, dist = 0.15 + R() * 0.45;
    craters.push({ x: cx + Math.cos(ang) * rx * dist, y: cy + Math.sin(ang) * ry * dist, r: (big ? 2.4 : mid ? 1.8 : 1.3) + R() * (big ? 2.2 : 1.0) });
  }
  const inside = new Float32Array(w * h).fill(9);
  const e = big ? 0.2 : 0.28;
  forEachPixel(a, (x, y) => {
    const dx = (x - cx) / rx, dy = (y - cy) / ry;
    const ang = Math.atan2(dy, dx);
    const lump = 0.8 + 0.32 * fbm(Math.cos(ang) * 1.5 + 7, Math.sin(ang) * 1.5 + 3, seed, 3);
    const d = Math.hypot(dx, dy);
    if (d > lump) return;
    const k = d / lump;
    inside[y * w + x] = k;
    // sphere normal + low-frequency bumps
    const b0 = fbm(x * e, y * e, seed + 5, 2);
    let nx = dx / lump + (fbm((x + 1) * e, y * e, seed + 5, 2) - b0) * 1.6;
    let ny = dy / lump + (fbm(x * e, (y + 1) * e, seed + 5, 2) - b0) * 1.6;
    const nz = Math.sqrt(Math.max(0.04, 1 - k * k));
    let l = lambert(nx, ny, nz) / Math.hypot(nx, ny, nz);
    for (const c of craters) {
      const bx = (x - c.x) / c.r, by = (y - c.y) / c.r;
      const cd = Math.hypot(bx, by);
      if (cd < 0.85) l = 0.18 + 0.75 * Math.max(0, bx * 0.62 + by * 0.7) * (cd / 0.85);   // bowl
      else if (cd < 1.25) l += (-bx * 0.62 - by * 0.7) * 0.3;                            // raised rim
    }
    l = Math.max(0, Math.min(1, l * 1.08 + 0.04 - k * 0.1));
    const idx = big ? 1 + ditherIndex(l, 5, x, y, 0.35) : pickIdx(l, 1, 5);
    plot(a, x, y, rustP[idx]);
  });
  // molten veins: random walks from near the center, with short branches
  const hot = new Uint8Array(w * h);
  const walk = (x, y, dir, len, heat) => {
    for (let i = 0; i < len; i++) {
      const xi = Math.round(x), yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= w || yi >= h || inside[yi * w + xi] > 0.84) return;
      hot[yi * w + xi] = Math.max(hot[yi * w + xi], heat - Math.floor((i / len) * 2));
      dir += (R() - 0.5) * 0.9;
      x += Math.cos(dir); y += Math.sin(dir);
      if (len > 5 && R() < 0.1) walk(x, y, dir + (R() < 0.5 ? 1.1 : -1.1), 2 + (R() * 4 | 0), heat - 1);
    }
  };
  const nv = big ? 3 : mid ? 2 : 1;
  for (let i = 0; i < nv; i++) {
    const ang = R() * TAU;
    const sx = cx + Math.cos(ang) * rx * 0.2, sy = cy + Math.sin(ang) * ry * 0.2;
    const len = big ? 11 + (R() * 6 | 0) : mid ? 6 + (R() * 3 | 0) : 3 + (R() * 2 | 0);
    walk(sx, sy, R() * TAU, len, 3);
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (hot[i]) {
        const t = hot[i];
        plot(a, x, y, t >= 3 ? emP[5] : t === 2 ? emP[4] : emP[3], t >= 3 ? emP[4] : emP[3]);
      } else if (a.col[i]) {
        // scorched rim around veins with a faint glow bleed
        const n = (x > 0 && hot[i - 1]) || (x < w - 1 && hot[i + 1]) || (y > 0 && hot[i - w]) || (y < h - 1 && hot[i + w]);
        if (n) { a.col[i] = rustP[1]; a.emi[i] = emi(emP[1], 0.9); }
      }
    }
  }
  return finish(a);
}

// ---- en_sentinel: rotating halo guardian (Horizon) ---------------------------------
function sentinelFrames() {
  const out = [];
  for (let f = 0; f < 4; f++) {
    const a = newArt(21, 21);
    const ph = (f / 4) * (TAU / 8);
    forEachPixel(a, (x, y, dx, dy) => {
      const d = Math.hypot(dx, dy);
      const th = Math.atan2(dy, dx);
      if (d >= 6.9 && d <= 9.4) {
        const seg = ((((th - ph) % TAU) + TAU) % TAU) / (TAU / 8);
        const s = seg - Math.floor(seg);
        if (s < 0.13) return;
        const nr = Math.max(-1, Math.min(1, (d - 8.15) / 1.3));
        const nz = Math.sqrt(1 - nr * nr);
        const l = lambert((nr * dx) / d, (nr * dy) / d, nz);
        if (Math.abs(d - 8.15) < 0.5) return plot(a, x, y, s > 0.8 ? plP[5] : plP[3], emi(plP[3], 0.75));
        return plot(a, x, y, caP[pickIdx(l, 2, 6)]);
      }
      if (d >= 5.1 && d <= 5.8) {
        const seg = ((((th + ph * 2) % TAU) + TAU) % TAU) / (TAU / 16);
        if (seg - Math.floor(seg) < 0.55) plot(a, x, y, withAlpha(plP[4], 210), plP[3]);
        return;
      }
      if (d <= 3.7) {
        if (Math.abs(dx) < 0.6 && Math.abs(dy) < 1.7) return plot(a, x, y, caP[0], mgP[1]);
        const l = sphereLight(dx / 4, dy / 4, 0.8);
        if (l > 0.92) return plot(a, x, y, WHITE, mgP[3]);
        plot(a, x, y, mgP[l > 0.7 ? 5 : l > 0.45 ? 4 : 3], mgP[2]);
      }
    });
    out.push(finish(a, { choir: true }));
  }
  return out;
}

const T_ENEMIES = [
  ['en_mite', () => addArt('en_mite', miteFrames(), { frames: 2, fps: 16 })],
  ['en_dart', () => addArt('en_dart', fighterDirs(DART_POLY, 21, { spine: [3.7, -3.0], engine: [-3.6, -5.2], exhaust: -6.6, tipU: 4.4, tipV: -4.7 }), { frames: 1, dirs: 16 })],
  ['en_wisp', () => addArt('en_wisp', wispFrames(), { frames: 4, fps: 8 })],
  ['en_lancet', () => addArt('en_lancet', fighterDirs(LANCET_POLY, 27, { spine: [7.2, -2.5], engine: [-5.2, -7.6], exhaust: -9.6, tipU: 5.5, tipV: -6.6 }), { frames: 1, dirs: 16 })],
  ['en_eye', () => addArt('en_eye', eyeFrames(), { frames: 4, fps: 8 })],
  ['en_carapace', () => addArt('en_carapace', carapaceFrames(), { frames: 2, fps: 4 })],
  ['en_weaver', () => addArt('en_weaver', weaverFrames(), { frames: 2, fps: 6 })],
  ['en_mine', () => addArt('en_mine', mineFrames(), { frames: 2, fps: 3 })],
  ['en_hornet', () => addArt('en_hornet', hornetFrames(), { frames: 3, fps: 12 })],
  ['en_seeker', () => addArt('en_seeker', seekerFrames(), { frames: 2, fps: 10 })],
];

const T_ENEMIES2 = [
  ['en_bastion', () => addArt('en_bastion', [bastionArt()], { frames: 1 })],
  ['en_shard', () => addArt('en_shard', shardFrames(), { frames: 2, fps: 4 })],
  ['en_phantom', () => addArt('en_phantom', phantomFrames(), { frames: 4, fps: 6 })],
  ['en_turret', () => addArt('en_turret', [turretBase()], { frames: 1 })],
  ['en_turret_gun', () => addArt('en_turret_gun', turretGunDirs(), { frames: 1, dirs: 16 })],
  ['en_sentinel', () => addArt('en_sentinel', sentinelFrames(), { frames: 4, fps: 8 })],
];

const T_ROCKS = [
  ['en_rock_s', () => addArt('en_rock_s', [0, 1, 2, 3].map((k) => rockArt(11, 11, 101 + k * 17)), { frames: 4, fps: 0 })],
  ['en_rock_m', () => addArt('en_rock_m', [0, 1, 2, 3].map((k) => rockArt(19, 17, 211 + k * 23)), { frames: 4, fps: 0 })],
  ['en_rock_l', () => addArt('en_rock_l', [0, 1, 2, 3].map((k) => rockArt(31, 27, 307 + k * 29)), { frames: 4, fps: 0 })],
];

// =======================================================================================
// PICKUPS — capsules with a clear glyph and a spinning glint; sparkling gems
// =======================================================================================

// red capsule ramp (plum -> crimson -> hot red), all palette colors
// warm red capsule ramp (ember shadows -> coral -> warning red -> warm highlight), all palette
// colors; no magenta, so the bomb never glows in the enemy-bullet pink
const REDX = [P(EM[0]), P(EM[1]), P(RAMPS.fire[2]), P(RAMPS.dawn[3]), P(C.warn), P(RAMPS.dawn[5])];

const GLYPH = {
  P: ['###', '#.#', '###', '#..', '#..'],
  B: ['##.', '#.#', '###', '#.#', '##.'],
  Z: ['..##', '.##.', '####', '..##', '.##.', '.#..'],                // lightning bolt
  1: ['.#', '##', '.#', '.#', '.#'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
};

// Draw a glyph with a dark drop shadow (down-right) — always readable. ring: full outline.
function glyph(a, g, x0, y0, col, shadow, e = 0, ring = false) {
  const rows = GLYPH[g];
  if (ring) {
    rows.forEach((r, y) => [...r].forEach((ch, x) => {
      if (ch !== '#') return;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1]]) plot(a, x0 + x + ox, y0 + y + oy, shadow, 0);
    }));
  }
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === '#') plot(a, x0 + x + 1, y0 + y + 1, shadow, 0); }));
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === '#') plot(a, x0 + x, y0 + y, col, e); }));
}

// Round capsule: steel frame ring + shaded colored core + glyph; glint orbits the ring.
function capsuleFrames(ramp, g, top = 4, glyphE = null, emiK = 0.6) {
  const out = [];
  for (let f = 0; f < 6; f++) {
    const a = newArt(11, 11);
    const gAng = -2.35 + (f / 6) * TAU;
    forEachPixel(a, (x, y, dx, dy) => {
      const d = Math.hypot(dx, dy);
      if (d > 4.45) return;
      if (d > 3.45) {
        const th = Math.atan2(dy, dx);
        let da = Math.abs(th - gAng) % TAU; if (da > Math.PI) da = TAU - da;
        if (da < 0.42) return plot(a, x, y, WHITE, WHITE);
        const lit = (-dx * 0.62 - dy * 0.78) / d;
        return plot(a, x, y, stP[lit > 0.45 ? 6 : lit > 0 ? 5 : lit > -0.5 ? 3 : 2]);
      }
      const l = sphereLight(dx / 3.6, dy / 3.6, 0.5);
      const i = Math.min(top, l > 0.8 ? 4 : l > 0.55 ? 3 : l > 0.3 ? 2 : 1);
      plot(a, x, y, ramp[i], emi(ramp[Math.max(1, i - 1)], emiK));
    });
    const gw = GLYPH[g][0].length, gh = GLYPH[g].length;
    glyph(a, g, 5 - (gw >> 1), gh > 5 ? 2 : 3, WHITE, ramp[0], glyphE || emi(ramp[3], 0.5), gh > 6);
    // sweeping specular band across the core
    const bx = -5 + (f / 6) * 14;
    forEachPixel(a, (x, y, dx, dy) => {
      const d = Math.hypot(dx, dy);
      if (d > 3.3) return;
      const i = y * 11 + x;
      if (Math.abs(dx + dy * 0.6 - bx) < 0.7 && a.col[i] !== WHITE) a.col[i] = SHIFT.shift(a.col[i], 1) === a.col[i] ? ramp[5] : SHIFT.shift(a.col[i], 1);
    });
    outline(a, OUT);
    out.push(a);
  }
  return out;
}

function lifeFrames() {
  const G = RAMPS.lime.map(P);
  const out = [];
  for (let f = 0; f < 6; f++) {
    const a = newArt(13, 11);
    // stadium (pill) shape
    forEachPixel(a, (x, y, dx, dy) => {
      const ex = Math.max(0, Math.abs(dx) - 1.5);
      const d = Math.hypot(ex, dy);
      if (d > 4.45) return;
      if (d > 3.45) {
        const lit = (-Math.sign(dx) * (ex > 0 ? 0.6 : 0) - (dy / (d || 1)) * 0.8);
        return plot(a, x, y, stP[lit > 0.4 ? 6 : lit > -0.1 ? 5 : lit > -0.5 ? 3 : 2]);
      }
      const l = sphereLight(dx / 6.5, dy / 3.8, 0.4);
      const i = l > 0.78 ? 4 : l > 0.52 ? 3 : l > 0.3 ? 2 : 1;
      plot(a, x, y, G[i], emi(G[Math.max(1, i - 1)], 0.6));
    });
    // glint travelling along the frame
    const gx = 1 + ((f * 2) % 12);
    for (const y of [1, 9]) {
      const x = y === 1 ? gx : 12 - gx;
      const i = y * 13 + x;
      if (a.col[i] && x > 1 && x < 11) { a.col[i] = WHITE; a.emi[i] = WHITE; }
    }
    glyph(a, '1', 2, 3, WHITE, G[0], G[4]);
    glyph(a, 'U', 5, 3, WHITE, G[0], G[4]);
    glyph(a, 'P', 9, 3, WHITE, G[0], G[4]);
    outline(a, OUT);
    out.push(a);
  }
  return out;
}

function gemFrames(ramp, big) {
  const R = ramp.map(P);
  const inner = big
    ? ['..f..', '.fed.', 'ffedc', 'fedcb', 'edcbb', '.cbb.', '..b..']
    : ['.f.', 'fed', 'edc', 'dcb', '.b.'];
  const out = [];
  const iw = inner[0].length, ih = inner.length;
  for (let f = 0; f < 4; f++) {
    const a = newArt(iw + 2, ih + 2);
    inner.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === '.') return;
      const i = ch.charCodeAt(0) - 97;
      plot(a, x + 1, y + 1, R[i], emi(R[Math.max(1, i - 2)], 0.8));
    }));
    // sparkle: a highlight hops across the facets, then a white-hot glint
    const hops = big ? [[3, 2], [2, 3], [3, 4], null] : [[2, 1], [1, 2], [2, 3], null];
    if (hops[f]) plot(a, hops[f][0], hops[f][1], WHITE, R[4]);
    if (f === 3) {
      const cx = (iw + 1) >> 1, cy = big ? 3 : 2;
      plot(a, cx, cy, WHITE, WHITE);
      plot(a, cx - 1, cy, R[5], R[4]); plot(a, cx + 1, cy, R[5], R[4]);
      plot(a, cx, cy - 1, R[5], R[4]); plot(a, cx, cy + 1, R[5], R[4]);
    }
    outline(a, OUT);
    out.push(a);
  }
  return out;
}

const T_PICKUPS = [
  ['pk_power', () => addArt('pk_power', capsuleFrames(EM.map(P), 'P'), { frames: 6, fps: 10 })],
  ['pk_bomb', () => addArt('pk_bomb', capsuleFrames(REDX, 'B', 4, null, 0.5), { frames: 6, fps: 10 })],
  ['pk_overdrive', () => addArt('pk_overdrive', capsuleFrames(CY.map(P), 'Z', 4, P(CY[4])), { frames: 6, fps: 10 })],
  ['pk_life', () => addArt('pk_life', lifeFrames(), { frames: 6, fps: 10 })],
  ['pk_gem_s', () => addArt('pk_gem_s', gemFrames(RAMPS.emerald, false), { frames: 4, fps: 8 })],
  ['pk_gem_l', () => addArt('pk_gem_l', gemFrames(RAMPS.sapphire, true), { frames: 4, fps: 8 })],
];

// =======================================================================================
// UI SPRITES
// =======================================================================================

function buildUI() {
  const life = parseMap([
    '.....',
    '....7',
    '...6d',
    '..56e',
    '.d565',
    '.5454',
    '.2.3E',
    '.....',
    '.....',
  ], L_SHIP, { mirror: true });
  shadeRight(life, -1, (p) => SHIFT.has(p));
  // shift content down one row so the icon is vertically centered
  const lifeC = newArt(9, 9);
  blit(lifeC, life, 0, 1);
  addArt('ui_life', [outline(lifeC, OUT)], { frames: 1, teamed: true });

  const GD = RAMPS.gold.map(P);
  const bomb = newArt(7, 7);
  [['..e..', '.ede.', 'ed*de', '.ede.', '..e..']].forEach((rows) => rows.forEach((r, y) => [...r].forEach((ch, x) => {
    if (ch === '.') return;
    const c = ch === '*' ? WHITE : GD[ch.charCodeAt(0) - 97];
    plot(bomb, x + 1, y + 1, c, ch === '*' ? GD[4] : emi(c, 0.6));
  })));
  plot(bomb, 3, 3, WHITE, GD[4]);
  addArt('ui_bomb', [outline(bomb, OUT)], { frames: 1 });

  const pip = newArt(5, 5);
  [['.e.', 'e*d', '.d.']].forEach((rows) => rows.forEach((r, y) => [...r].forEach((ch, x) => {
    if (ch === '.') return;
    const c = ch === '*' ? WHITE : EM.map(P)[ch.charCodeAt(0) - 97];
    plot(pip, x + 1, y + 1, c, emi(ch === '*' ? P(EM[4]) : c, 0.6));
  })));
  addArt('ui_power', [outline(pip, OUT)], { frames: 1 });
}

// =======================================================================================
// LOGO — "NOVA LANCERS": chunky beveled chrome letterforms with a cyan energy edge
// =======================================================================================

// Glyphs in an 8x7 unit box: { add: [poly...], sub: [poly...], cham: {tl,tr,bl,br} }
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const LOGO_GLYPHS = {
  N: { add: [rect(0, 0, 2, 7), rect(6, 0, 8, 7), [[0, 0], [2.4, 0], [8, 7], [5.6, 7]]] },
  O: { add: [rect(0, 0, 8, 1.8), rect(0, 0, 2, 7), rect(6, 0, 8, 7), rect(0, 5.2, 8, 7)], cham: { tl: 1.6, tr: 1.6, bl: 1.6, br: 1.6 } },
  V: { add: [[[0, 0], [2.25, 0], [4, 4.4], [5.75, 0], [8, 0], [5.15, 7], [2.85, 7]]] },
  A: { add: [[[2.85, 0], [5.15, 0], [8, 7], [5.75, 7], [4, 2.5], [2.25, 7], [0, 7]], rect(1.4, 4.3, 6.6, 5.7)] },
  L: { add: [rect(0, 0, 2, 7), rect(0, 5.2, 8, 7)], cham: { bl: 1.4 } },
  C: { add: [rect(0, 0, 8, 1.8), rect(0, 0, 2, 7), rect(0, 5.2, 8, 7)], cham: { tl: 1.6, bl: 1.6 } },
  E: { add: [rect(0, 0, 8, 1.8), rect(0, 0, 2, 7), rect(0, 2.6, 6.4, 4.4), rect(0, 5.2, 8, 7)], cham: { tl: 1.4, bl: 1.4 } },
  R: {
    add: [rect(0, 0, 2, 7), [[0, 0], [6.4, 0], [8, 1.6], [8, 2.9], [6.5, 4.4], [0, 4.4]], [[3.4, 4.4], [5.8, 4.4], [8, 7], [5.6, 7]]],
    sub: [rect(2, 1.8, 6, 2.6)],
  },
  S: { add: [rect(0, 0, 8, 1.8), rect(0, 0, 2, 4.4), rect(0, 2.6, 8, 4.4), rect(6, 2.6, 8, 7), rect(0, 5.2, 8, 7)], cham: { tl: 1.6, br: 1.6 } },
};

function glyphHit(g, u, v) {
  if (u < 0 || v < 0 || u > 8 || v > 7) return false;
  const c = g.cham || {};
  if (c.tl && u + v < c.tl) return false;
  if (c.tr && (8 - u) + v < c.tr) return false;
  if (c.bl && u + (7 - v) < c.bl) return false;
  if (c.br && (8 - u) + (7 - v) < c.br) return false;
  if (g.sub && g.sub.some((p) => pointInPoly(u, v, p))) return false;
  return g.add.some((p) => pointInPoly(u, v, p));
}

// Rasterize a word into mask (1 = letter), returns width used.
function logoWord(mask, W, word, x0, y0, s, gap) {
  let x = x0;
  const H = Math.round(7 * s), LW = Math.round(8 * s);
  for (const ch of word) {
    const g = LOGO_GLYPHS[ch];
    for (let y = 0; y < H; y++) {
      for (let xx = 0; xx < LW; xx++) {
        if (glyphHit(g, (xx + 0.5) / s, (y + 0.5) / s)) mask[(y0 + y) * W + x + xx] = 1;
      }
    }
    x += LW + gap;
  }
  return x - gap - x0;
}

function wordWidth(word, s, gap) { return word.length * Math.round(8 * s) + (word.length - 1) * gap; }

// Built in several small tasks (base, then one per frame) so the loader never stalls.
let LOGO = null;

// Letters, 80s horizon chrome, energy underline, speed-line wings and a 3-px extrusion.
function logoBase() {
  const W = 200, H = 56;
  const mask = new Uint8Array(W * H);
  const s1 = 4, g1 = 5, s2 = 2.6, g2 = 3;
  const w1 = wordWidth('NOVA', s1, g1), w2 = wordWidth('LANCERS', s2, g2);
  const y1 = 2, h1 = 7 * s1, y2 = y1 + h1 + 5, h2 = Math.round(7 * s2);
  const x1 = (W - w1) >> 1, x2 = (W - w2) >> 1;
  logoWord(mask, W, 'NOVA', x1, y1, s1, g1);
  logoWord(mask, W, 'LANCERS', x2, y2, s2, g2);
  const M = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 0 : mask[y * W + x];
  const DW = RAMPS.dawn.map(P);

  // Chrome face: a cool sky reflection above a dark horizon line, the warm dawn below it,
  // and a glowing cyan energy edge at the bottom. tone(t) -> [ramp, index] | null (energy).
  const tone = (t) => t < 0.1 ? [stP, 7] : t < 0.3 ? [stP, 6] : t < 0.42 ? [stP, 5] : t < 0.5 ? [stP, 4] :
    t < 0.55 ? [stP, 1] : t < 0.63 ? [DW, 2] : t < 0.72 ? [DW, 3] : t < 0.8 ? [DW, 4] : t < 0.87 ? [DW, 5] : null;
  const at = (ramp, i) => ramp[Math.max(0, Math.min(ramp.length - 1, i))];
  const base = newArt(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!M(x, y)) continue;
      const big = y < y2 - 2;
      const top = big ? y1 : y2, hh = big ? h1 : h2;
      const t = (y - top + 0.5) / hh;
      const bv = big ? 2 : 1;       // bevel depth
      let upE = 99, dnE = 99, lE = 99, rE = 99;
      for (let k = 1; k <= bv; k++) {
        if (upE === 99 && !M(x, y - k)) upE = k;
        if (dnE === 99 && !M(x, y + k)) dnE = k;
        if (lE === 99 && !M(x - k, y)) lE = k;
        if (rE === 99 && !M(x + k, y)) rE = k;
      }
      const tn = tone(t);
      let c, e = 0;
      if (!tn) {
        c = cyP[t > 0.94 ? 3 : 4]; e = emi(cyP[3], 0.9);
        if (dnE === 1) { c = cyP[5]; e = emi(cyP[4], 0.9); }
        else if (rE === 1) c = cyP[2];
        else if (upE === 1 || lE === 1) c = cyP[5];
      } else {
        const [ramp, i] = tn;
        const warm = ramp === DW;
        c = ramp[i];
        if (upE === 1) c = warm ? DW[6] : stP[7];
        else if (lE === 1) c = at(ramp, i + 1);
        else if (upE === 2) c = warm ? DW[5] : stP[6];
        if (dnE === 1) {
          if (t > 0.8) { c = cyP[5]; e = emi(cyP[4], 0.9); } else c = warm ? DW[1] : stP[2];
        } else if (rE === 1 && upE !== 1) c = at(ramp, i - 2);
        else if (rE === 2 && big && upE > 1) c = at(ramp, i - 1);
      }
      plot(base, x, y, c, e);
    }
  }
  // energy underline beneath NOVA, widening past the word, plus side streaks ("wings")
  const uy = y1 + h1 + 2;
  for (let x = x1 - 26; x < x1 + w1 + 26; x++) {
    const edge = Math.min(x - (x1 - 26), x1 + w1 + 25 - x);
    if (M(x, uy)) continue;
    const c = edge < 6 ? cyP[2] : edge < 14 ? cyP[3] : cyP[4];
    plot(base, x, uy, c, emi(c, 0.9));
  }
  for (const [dy, len] of [[-9, 20], [-5, 14], [-1, 9]]) {
    for (let k = 0; k < len; k++) {
      const c = k < 3 ? cyP[5] : k < len * 0.5 ? cyP[4] : cyP[3];
      const yy = y1 + (h1 >> 1) + dy + 4;
      plot(base, x1 - 5 - k, yy, withAlpha(c, 255 - k * 6), emi(c, 0.8));
      plot(base, x1 + w1 + 4 + k, yy, withAlpha(c, 255 - k * 6), emi(c, 0.8));
    }
  }
  // extrusion (down-right, 3 px deep) under the outlined letters so they lift off any backdrop
  const shadowed = newArt(W, H);
  const ex = [P(RAMPS.void[4]), P(RAMPS.void[4]), P(RAMPS.void[3])];
  for (let k = 3; k >= 1; k--) {
    for (let y = 0; y < H - k; y++) for (let x = 0; x < W - k; x++) {
      if (mask[y * W + x]) plot(shadowed, x + k, y + k, ex[k - 1]);
    }
  }
  outline(base, OUT);
  blit(shadowed, base, 0, 0);
  // the nova: a star living in the O's counter (between pixels: the counter is 16 px wide)
  const LW = Math.round(8 * s1);
  const nova = { x: x1 + LW + g1 + 15.5, y: y1 + 13.5 };
  return { W, H, mask, base: shadowed, nova, frames: [] };
}

// Nova star centered between pixels: 2x2 white core, 2-px arms of length L, short diagonals.
function drawNova(a, cx, cy, L, diag) {
  const x0 = Math.floor(cx), y0 = Math.floor(cy);           // core = (x0..x0+1, y0..y0+1)
  const put = (x, y, c, e) => plot(a, x, y, c, e);
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) put(x0 + i, y0 + j, WHITE, WHITE);
  for (let k = 1; k <= L; k++) {
    const f = k / L;
    const c = f < 0.35 ? WHITE : f < 0.6 ? cyP[5] : f < 0.85 ? cyP[4] : cyP[3];
    const e = f < 0.35 ? emi(WHITE, 0.9) : emi(f < 0.6 ? cyP[5] : cyP[4], f < 0.85 ? 0.9 : 0.6);
    const al = f < 0.85 ? 255 : 200;
    for (let i = 0; i < 2; i++) {
      put(x0 + i, y0 - k, withAlpha(c, al), e); put(x0 + i, y0 + 1 + k, withAlpha(c, al), e);
      put(x0 - k, y0 + i, withAlpha(c, al), e); put(x0 + 1 + k, y0 + i, withAlpha(c, al), e);
    }
  }
  for (let k = 1; k <= diag; k++) {
    const c = k === diag ? cyP[4] : cyP[5], e = emi(c, 0.8);
    put(x0 - k, y0 - k, c, e); put(x0 + 1 + k, y0 - k, c, e);
    put(x0 - k, y0 + 1 + k, c, e); put(x0 + 1 + k, y0 + 1 + k, c, e);
  }
}

// Frame f: 0 = rest (shown most of the time), 1..7 = a light sweep crossing the chrome;
// the sweep ignites the nova as it passes the O (frames 3..5).
function logoFrame(L, f) {
  const { W, H, mask } = L;
  const a = cloneArt(L.base);
  if (f > 0) {
    const c = 20 + (f - 1) * 33;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!mask[y * W + x]) continue;
        const d = Math.abs(x + y * 0.55 - c);
        if (d >= 11) continue;
        const i = y * W + x;
        if (d < 2) { a.col[i] = WHITE; a.emi[i] = emi(WHITE, 0.55); }
        else {
          a.col[i] = SHIFT.shift(a.col[i], d < 6 ? 2 : 1);
          if (!a.emi[i] && d < 6) a.emi[i] = emi(cyP[3], 0.3);
        }
      }
    }
  }
  const arms = [3, 3, 4, 7, 12, 8, 5, 4][f], diag = [1, 1, 1, 2, 3, 2, 1, 1][f];
  drawNova(a, L.nova.x, L.nova.y, arms, diag);
  return a;
}

// logo_sub "CO-OP STARFIGHTER": 5x7 small caps
const SUB_FONT = {
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  '-': ['...', '...', '...', '###', '...', '...', '...'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  ' ': ['..', '..', '..', '..', '..', '..', '..'],
};

function logoSub() {
  const text = 'CO-OP STARFIGHTER';
  const gap = 2;
  let w = 0;
  for (const ch of text) w += SUB_FONT[ch][0].length + gap;
  w = w - gap + 2;
  const a = newArt(w, 9);
  const tone = [5, 5, 4, 4, 4, 3, 3];
  let x = 1;
  for (const ch of text) {
    const g = SUB_FONT[ch];
    g.forEach((row, y) => [...row].forEach((c, xx) => {
      if (c !== '#') return;
      const col = y === 0 ? WHITE : cyP[tone[y]];
      plot(a, x + xx, y + 1, col, emi(cyP[Math.min(4, tone[y])], 0.5));
    }));
    x += g[0].length + gap;
  }
  return outline(a, OUT);
}

const T_LOGO = [
  ['logo base', () => { LOGO = logoBase(); }],
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((f) => ['logo f' + f, () => LOGO.frames.push(logoFrame(LOGO, f))]),
  ['logo', () => { addArt('logo', LOGO.frames, { frames: 8, fps: 10 }); LOGO = null; }],
  ['logo_sub', () => addArt('logo_sub', [logoSub()], { frames: 1 })],
];

const T_PLAYER_EXTRAS = [
  ['flame_s', () => addArt('flame_s', flameFrames(), { frames: 4, fps: 20, teamed: true })],
  ['option_drone', () => addArt('option_drone', droneFrames(), { frames: 4, fps: 12, teamed: true })],
  ['beacon', () => addArt('beacon', beaconFrames(), { frames: 6, fps: 8, teamed: true })],
  ['shield_bubble', () => addArt('shield_bubble', shieldFrames(), { frames: 4, fps: 10, teamed: true })],
];

const T_PLAYER_BULLETS = [
  ['pb_vulcan', () => addArt('pb_vulcan', bakeAnalytic(11, 16, vulcanShade(false)), { frames: 1, dirs: 16, teamed: true })],
  ['pb_vulcan_big', () => addArt('pb_vulcan_big', bakeAnalytic(13, 16, vulcanShade(true)), { frames: 1, dirs: 16, teamed: true })],
  ['pb_missile', () => addArt('pb_missile', bakeLabeled(11, 16, missileLabel, MS_SWAP, missilePaint), { frames: 1, dirs: 16, teamed: true })],
  ['pb_laser_body', () => addArt('pb_laser_body', laserBodyFrames(), { frames: 4, fps: 24, teamed: true })],
  ['pb_laser_head', () => addArt('pb_laser_head', laserHeadFrames(), { frames: 4, fps: 20, teamed: true })],
  ['pb_wave', () => addArt('pb_wave', waveFrames(17, 7, 11), { frames: 3, fps: 15, teamed: true })],
  ['pb_wave_l', () => addArt('pb_wave_l', waveFrames(25, 9, 23), { frames: 3, fps: 15, teamed: true })],
  ['pb_option', () => addArt('pb_option', [optionShot()], { frames: 1, teamed: true })],
];

// =======================================================================================
// Gameplay metadata: collision radii (px) and notable offsets from the sprite center
// =======================================================================================

/** Circular collision radius for every enemy and pickup (+ core / gun offsets where useful). */
export const ENEMY_META = {
  en_mite: { r: 4 },
  en_dart: { r: 5.5 },                         // rotating; radius covers all directions
  en_wisp: { r: 4.5 },
  en_lancet: { r: 6.5 },
  en_eye: { r: 7, core: [0, 1] },              // iris (only vulnerable while open, if the sim wants)
  en_carapace: { r: 10, core: [0, -2], guns: [[-5, 9], [5, 9]] },
  en_weaver: { r: 8, core: [0, 2], guns: [[0, 3]] },
  en_mine: { r: 4.5 },
  en_hornet: { r: 6.5, pods: 6.3 },            // gun pods orbit at this radius (3 arms)
  en_seeker: { r: 3.5 },
  en_bastion: {
    r: 16, core: [0, 11], circles: [[0, 0, 12], [0, 12, 6], [-15, 1, 6], [15, 1, 6]],
    guns: [[-17, 4], [17, 4], [-5, -3], [5, -3], [-4, 13], [4, 13]],   // L, R, top-L, top-R, low-L, low-R muzzles
  },
  en_shard: { r: 5.5, core: [0, 0] },
  en_phantom: { r: 7 },
  en_turret: { r: 8 },
  en_turret_gun: { r: 3, muzzle: 5 },          // barrel tip distance along the aim direction
  en_rock_s: { r: 4.5 },
  en_rock_m: { r: 7.5 },
  en_rock_l: { r: 12 },
  en_sentinel: { r: 8, core: [0, 0] },
  pk_power: { r: 5.5 },
  pk_bomb: { r: 5.5 },
  pk_overdrive: { r: 5.5 },
  pk_life: { r: 6 },
  pk_gem_s: { r: 3.5 },
  pk_gem_l: { r: 4.5 },
};

/** Suggested hit radii for bullets (enemy bullets are generous to the player: small). */
export const BULLET_META = {
  eb_small: { r: 1.8 }, eb_orb: { r: 2.8 }, eb_big: { r: 5 }, eb_needle: { r: 1.4 },
  eb_star_o: { r: 2.8 }, eb_ring_v: { r: 3.8 },
  pb_vulcan: { r: 2.5 }, pb_vulcan_big: { r: 3.5 }, pb_missile: { r: 3 },
  pb_laser_head: { r: 4 }, pb_wave: { r: 7 }, pb_wave_l: { r: 10 }, pb_option: { r: 2 },
};

// =======================================================================================
// Build
// =======================================================================================

// [label, fn] — small units so the loader can yield often and the bar moves smoothly
const TASKS = [
  ...Object.keys(SHIPS).map((k) => [k, () => buildShip(k)]),
  ...T_PLAYER_EXTRAS, ...T_PLAYER_BULLETS, ...T_ENEMY_BULLETS,
  ...T_ENEMIES, ...T_ENEMIES2, ...T_ROCKS, ...T_PICKUPS,
  ['ui', buildUI], ...T_LOGO,
];

let buildPromise = null;

/** Generate every sprite (idempotent). onProgress(0..1). */
export function buildSprites(onProgress) {
  if (!buildPromise) buildPromise = runBuild(onProgress);
  else if (onProgress) buildPromise.then(() => onProgress(1));
  return buildPromise;
}

/** Build timing (dev): { ms: wall time, work: time spent building, tasks: [{ name, ms }] } */
export const buildStats = { ms: 0, work: 0, tasks: [] };

// Yield to the event loop without setTimeout's 4 ms nesting clamp, so the loading bar can
// repaint between chunks without padding the build. Returns { yield, close }.
function makeYielder() {
  if (typeof scheduler !== 'undefined' && scheduler.yield) return { yield: () => scheduler.yield(), close() {} };
  if (typeof MessageChannel !== 'undefined') {
    const ch = new MessageChannel();
    const q = [];
    ch.port1.onmessage = () => { const r = q.shift(); if (r) r(); };
    return {
      yield: () => new Promise((r) => { q.push(r); ch.port2.postMessage(0); }),
      close() { ch.port1.close(); ch.port2.close(); },
    };
  }
  return { yield: () => new Promise((r) => setTimeout(r, 0)), close() {} };
}

async function runBuild(onProgress) {
  const yielder = makeYielder();
  const tStart = performance.now();
  let t0 = tStart, work = 0;
  for (let i = 0; i < TASKS.length; i++) {
    const ts = performance.now();
    TASKS[i][1]();
    const dt = performance.now() - ts;
    work += dt;
    buildStats.tasks.push({ name: TASKS[i][0], ms: dt });
    if (performance.now() - t0 > 14) {
      if (onProgress) onProgress((i + 1) / TASKS.length * 0.95);
      await yielder.yield();
      t0 = performance.now();
    }
  }
  const tf = performance.now();
  if (onProgress) onProgress(0.96);
  await atlasFlush(yielder);
  const tfe = performance.now() - tf;
  work += tfe;
  buildStats.tasks.push({ name: 'atlasFlush (incl. yields)', ms: tfe });
  buildStats.ms = performance.now() - tStart;
  buildStats.work = work;
  yielder.close();
  if (onProgress) onProgress(1);
}
