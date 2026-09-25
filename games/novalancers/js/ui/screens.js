// Nova Lancers — HTML overlay screens (menus, lobby, results…) over the live canvas.
// Contract: DESIGN.md §10. Mobile-first, keyboard/gamepad navigable, pixel-styled
// (css/style.css). Sprites and UI sounds are optional (guarded dynamic imports).

import { SHIPS, SHIP_ORDER, SECTORS, VERSION, DEFAULT_SETTINGS } from '../config.js';
import { TEAM_HEX } from '../art/palette.js';
import { AudioSys } from '../audio/audio.js';
import { drawQR } from './qr.js';
import { drawText, measureText, textHeight } from '../art/font.js';
import { hudToast, takeHudToasts } from './hud.js';

// ------------------------------------------------------------------ optional modules
let sfxFn = null;
import('../audio/sfx.js').then((m) => { sfxFn = typeof m.sfx === 'function' ? m.sfx : null; }).catch(() => {});
let SPR = null;
import('../art/sprites.js').then((m) => { SPR = m; }).catch(() => {});
// Network module: only needed for invite URLs, so it is loaded the first time the co-op
// screen or a lobby opens (solo players never download it from here).
let NET = null, netP = null;
function loadNet() {
  if (!netP) netP = import('../net/session.js').then((m) => { NET = m; return m; }).catch(() => null);
  return netP;
}

function snd(name) {
  if (!sfxFn) return;
  try { sfxFn(name); } catch { /* sound is optional */ }
}
const hasSpr = (name) => { try { return !!(SPR && SPR.hasSprite && SPR.hasSprite(name)); } catch { return false; } };

// ------------------------------------------------------------------ helpers
const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad7 = (n) => String(Math.max(0, Math.floor(+n || 0))).padStart(7, '0');
const fmt = (n) => Math.max(0, Math.floor(+n || 0)).toLocaleString('en-US');
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const $ = (root, sel) => root.querySelector(sel);
const $$ = (root, sel) => Array.from(root.querySelectorAll(sel));
const reduceMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

// Digits inside Pixelify Sans copy: that face draws 5 like S, 2 like Z, 8 like B and 0 like
// O, so runs of digits switch to Silkscreen (.num). Escapes the text.
const numify = (s) => esc(s).replace(/[0-9]+(?:[.,:][0-9]+)*/g, (m) => `<span class="num">${m}</span>`);

// ------------------------------------------------------------------ device-pixel helpers
const dprNow = () => Math.max(1, +window.devicePixelRatio || 1);
// CSS px that cover a whole number of device pixels (nearest to `css`, at least one).
const devSnap = (css) => { const d = dprNow(); return Math.max(1, Math.round(css * d)) / d; };

// Silkscreen is an 8-units-per-em pixel face: it only renders crisp when one font pixel
// covers a whole number of device pixels, i.e. at k * 8 / dpr CSS px. Publish the label
// sizes for this screen as CSS variables (smallest crisp size at or above the target).
function applyTypeScale() {
  const d = dprNow();
  const up = (px) => (Math.ceil((px * d) / 8 - 0.05) * 8) / d;
  const s = document.documentElement.style;
  s.setProperty('--fs-xs', up(10).toFixed(3) + 'px');     // fine print, kickers
  s.setProperty('--fs-sm', up(12).toFixed(3) + 'px');     // status labels
  s.setProperty('--fs-md', up(15).toFixed(3) + 'px');     // numbers in rows / tables
  s.setProperty('--fs-lg', up(20).toFixed(3) + 'px');     // big stat values
}

// Crisp bitmap text (font.js) for room codes and scores — its glyphs keep 2/Z, 5/S, 8/B and
// 0/O apart. Drawn at 1 art px per canvas px and scaled by CSS in whole device pixels;
// the scale comes from the element's --pix (CSS px per art px, set by the stylesheet).
// opt: { font, color, dim (colour for leading zeros; pads to 7 digits), spacing, shadow }
function pix(cv, str, opt = {}) {
  if (!cv) return;
  cv._pix = [str, opt];
  paintPix(cv);
}
function paintPix(cv) {
  const [raw, o] = cv._pix;
  const font = o.font || 'big';
  const spacing = o.spacing | 0;
  let str = String(raw ?? '');
  let zeros = '';
  if (o.dim) {
    str = pad7(raw);
    const i = str.search(/[1-9]/);
    const n = i < 0 ? str.length - 1 : i;
    zeros = str.slice(0, n); str = str.slice(n);
  }
  const zw = zeros ? measureText(zeros, { font, spacing }) + 1 + spacing : 0;
  const w = Math.max(1, zw + measureText(str, { font, spacing }));
  const sh = o.shadow === null ? 0 : 1;
  const W = w + sh, Hh = textHeight({ font }) + sh;
  if (cv.width !== W) cv.width = W;
  if (cv.height !== Hh) cv.height = Hh;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, W, Hh);
  const shadow = sh ? (o.shadow || '#05040c') : null;
  if (zeros) drawText(g, zeros, 0, 0, { font, spacing, color: o.dim, shadow });
  drawText(g, str, zw, 0, { font, spacing, color: o.color || '#ffffff', shadow });
  let k = parseFloat(getComputedStyle(cv).getPropertyValue('--pix'));
  if (!(k > 0)) k = o.px || 3;
  const u = devSnap(k);
  cv.style.width = (W * u).toFixed(3) + 'px';
  cv.style.height = (Hh * u).toFixed(3) + 'px';
}
function repaintPix(scope) {
  if (scope) $$(scope, 'canvas.pix').forEach((c) => { if (c._pix) paintPix(c); });
}

// Score with dim leading zeros, as bitmap text.
function paintScore(cv, n, color = '#ffffff') { pix(cv, Math.max(0, Math.floor(+n || 0)), { dim: '#3f4c68', color }); }

// Pixel icons: bitmap rows -> crisp SVG path (cached).
const ICONS = {
  play: ['##.....', '####...', '######.', '#######', '######.', '####...', '##.....'],
  back: ['...##', '..##.', '.##..', '##...', '.##..', '..##.', '...##'],
  next: ['##...', '.##..', '..##.', '...##', '..##.', '.##..', '##...'],
  squad: ['..#.....#..', '.###...###.', '.#.#...#.#.', '##.##.##.##', '#####.#####', '.#.#...#.#.'],
  ship: ['...#...', '..###..', '..#.#..', '.##.##.', '#######', '#.#.#.#', '..#.#..'],
  gear: ['...###...', '.#.###.#.', '..#####..', '###...###', '###...###', '###...###', '..#####..', '.#.###.#.', '...###...'],
  help: ['.#####.', '##...##', '.....##', '...###.', '..##...', '..##...', '.......', '..##...', '..##...'],
  star: ['....#....', '...###...', '...###...', '#########', '.#######.', '..#####..', '..##.##..', '.##...##.', '.#.....#.'],
  share: ['...#...', '..###..', '.#.#.#.', '...#...', '...#...', '#..#..#', '#.....#', '#######'],
  qr: ['###.###', '#.#.#.#', '###.###', '.......', '###.#.#', '#.#..#.', '###.#.#'],
  check: ['......#', '.....##', '#...##.', '##.##..', '.###...', '..#....'],
  bolt: ['....###', '...###.', '..###..', '.######', '######.', '..###..', '.###...', '.##....', '##.....'],
  burst: ['....#....', '.#..#..#.', '..#.#.#..', '...###...', '#########', '...###...', '..#.#.#..', '.#..#..#.', '....#....'],
  pause: ['##.##', '##.##', '##.##', '##.##', '##.##', '##.##'],
  full: ['###.###', '#.....#', '#.....#', '.......', '#.....#', '#.....#', '###.###'],
  lock: ['.###.', '#...#', '#...#', '#####', '##.##', '##.##', '#####'],
  link: ['.##....', '#..#...', '#.##...', '.#.##..', '...##.#', '...#..#', '....##.'],
  paste: ['.###.', '##.##', '#...#', '#.#.#', '#...#', '#.#.#', '#####'],
  heart: ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'],
  globe: ['..###..', '.#.#.#.', '#..#..#', '#######', '#..#..#', '.#.#.#.', '..###..'],
  home: ['...#...', '..###..', '.#####.', '#######', '.#...#.', '.#.#.#.', '.#.#.#.'],
  retry: ['..####.', '.#....#', '#......', '#...###', '#....##', '.#...#.', '..###..'],
  graze: ['.......##', '......##.', '.....##..', '.........', '..#......', '.###.....', '#####....', '#.#.#....'],
  capsule: ['.#####.', '##...##', '#.###.#', '#.#.#.#', '#.###.#', '#.#...#', '##...##', '.#####.'],
};
const iconCache = new Map();
function icon(name, cls = '') {
  let path = iconCache.get(name);
  const rows = ICONS[name];
  if (!rows) return '';
  if (!path) {
    path = '';
    rows.forEach((r, y) => {
      for (let x = 0; x < r.length;) {
        if (r[x] !== '#') { x++; continue; }
        const s = x;
        while (x < r.length && r[x] === '#') x++;
        path += `M${s} ${y}h${x - s}v1h${s - x}z`;
      }
    });
    iconCache.set(name, path);
  }
  return `<svg class="ico ico-${name} ${cls}" viewBox="0 0 ${rows[0].length} ${rows.length}" width="${rows[0].length * 2}" height="${rows.length * 2}" style="--c:${rows[0].length};--r:${rows.length}" aria-hidden="true" focusable="false" shape-rendering="crispEdges"><path fill="currentColor" d="${path}"/></svg>`;
}

// Ship art for mini canvases (sprites if built, else a stylised placeholder).
const PH = [
  '.......o.......',
  '......oso......',
  '......oTo......',
  '.....osTso.....',
  '.....ossso.....',
  '..o.ossssso.o..',
  '.oto.ossso.oto.',
  '.oso.osdso.oso.',
  'ossssosdsossss.',
  'osssssdddsssso.',
  '.ooosssssssooo.',
  '....oteoeto....',
  '.....o...o.....',
];
function drawPlaceholderShip(g, cx, cy, team) {
  const col = { o: '#05040c', s: '#7c8fb3', d: '#36425f', t: TEAM_HEX[team & 3], T: '#ffffff', e: TEAM_HEX[team & 3] };
  const w = PH[0].length, h = PH.length;
  const x0 = Math.round(cx - w / 2), y0 = Math.round(cy - h / 2);
  PH.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (!col[ch]) continue;
      g.fillStyle = col[ch];
      g.fillRect(x0 + x, y0 + y, 1, 1);
    }
  });
}
// Ship icons are drawn at art size into a scratch canvas, then blitted into the icon canvas
// at its device resolution with a whole-number zoom, so every art pixel is the same size.
const ICON_ART = 26;            // fits the largest hull (25 px) around a centre pixel
let iconScratch = null;
function drawShipIcon(canvas, shipId, team = 0, frame = 2) {
  if (!canvas) return;
  canvas.dataset.ship = shipId;
  canvas.dataset.team = team & 3;
  if (!iconScratch) { iconScratch = document.createElement('canvas'); iconScratch.width = iconScratch.height = ICON_ART; }
  const s = iconScratch.getContext('2d');
  s.imageSmoothingEnabled = false;
  s.clearRect(0, 0, ICON_ART, ICON_ART);
  const def = SHIPS[shipId] || SHIPS.aurora;
  const c = ICON_ART >> 1;
  let drawn = false;
  if (hasSpr(def.sprite)) {
    try {
      SPR.drawSprite(s, def.sprite, frame, c, c, { team: team & 3 });
      if (SPR.drawSpriteEmissive) {
        s.globalCompositeOperation = 'lighter';
        s.globalAlpha = 0.55;
        SPR.drawSpriteEmissive(s, def.sprite, frame, c, c, { team: team & 3 });
      }
      drawn = true;
    } catch { /* fall through */ }
    s.globalAlpha = 1;
    s.globalCompositeOperation = 'source-over';
  }
  if (!drawn) drawPlaceholderShip(s, c, c, team);
  // device-resolution backing store sized from the element's CSS box
  const css = canvas.clientWidth || 0;
  const d = dprNow();
  const px = css > 0 ? Math.round(css * d) : ICON_ART;
  if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
  // whole-number zoom; only on low-density screens, where that would shrink the icon a lot,
  // fall back to the (slightly uneven) fractional fit
  let k = Math.max(1, Math.floor(px / ICON_ART));
  if (k * ICON_ART < px * 0.8) k = px / ICON_ART;
  const size = Math.round(ICON_ART * k);
  const off = (px - size) >> 1;
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, px, px);
  g.drawImage(iconScratch, 0, 0, ICON_ART, ICON_ART, off, off, size, size);
  canvas.dataset.px = css > 0 ? px : 0;
}
// Redraw icons whose CSS size changed (layout switch, rotation, zoom).
function refreshIcons(scope) {
  if (!scope) return;
  const d = dprNow();
  $$(scope, 'canvas[data-ship]').forEach((cv) => {
    const want = Math.round((cv.clientWidth || 0) * d);
    if (want > 0 && String(want) !== cv.dataset.px) drawShipIcon(cv, cv.dataset.ship, +cv.dataset.team || 0);
  });
}

// ------------------------------------------------------------------ copy
const TIPS = [
  'DRAG ANYWHERE TO FLY — YOUR FINGER NEVER COVERS YOUR SHIP.',
  'GRAZE ENEMY BULLETS TO CHARGE OVERDRIVE.',
  'CHAIN KILLS WITHIN 1.5 S TO BUILD UP TO ×16.',
  'A NOVA WIPES EVERY ENEMY BULLET. SAVE ONE FOR THE BOSS.',
  'IN CO-OP, HOVER OVER A FALLEN PILOT’S BEACON TO REVIVE THEM.',
  'ONLY THE GLOWING CORE OF YOUR SHIP CAN BE HIT.',
  'PICKUPS ARE SHARED — ONE PILOT GRABS, THE WHOLE SQUAD GAINS.',
];

const CONTROLS = {
  keyboard: [
    { act: 'FLY', keys: ['←', '↑', '↓', '→'], alt: 'OR W A S D' },
    { act: 'PRECISE / SLOW', keys: ['SHIFT'] },
    { act: 'NOVA BOMB', keys: ['X'], alt: 'OR K' },
    { act: 'OVERDRIVE', keys: ['C'], alt: 'OR SPACE' },
    { act: 'PAUSE', keys: ['ESC'], alt: 'OR P' },
    { act: 'FIRE', keys: ['AUTO'] },
  ],
  gamepad: [
    { act: 'FLY', keys: ['L-STICK'], alt: 'OR D-PAD' },
    { act: 'PRECISE / SLOW', keys: ['LT'], alt: 'OR LB' },
    { act: 'NOVA BOMB', keys: ['B'], alt: 'OR Y' },
    { act: 'OVERDRIVE', keys: ['X'], alt: 'OR RT' },
    { act: 'PAUSE', keys: ['START'] },
    { act: 'FIRE', keys: ['AUTO'] },
  ],
};

const ENDING = [
  'The Choir Heart falls silent.',
  'Across the event horizon the song that devoured worlds dissolves into static, and for the first time in a hundred years the stars are quiet.',
  'On Aurora Station the beacons light up one by one. Somewhere out past the red giant, the Lancers are coming home.',
  'The singularity keeps its secrets. But tonight, the sky belongs to us again.',
];

const CREDITS = [
  ['NOVA LANCERS', 'A MILGIE.COM ORIGINAL'],
  ['CREATED BY', 'MILGIE'],
  ['BUILT WITH', 'CLAUDE CODE'],
  ['PIXEL ART', 'HAND-CODED PROCEDURAL SPRITES'],
  ['MUSIC', 'ORIGINAL SCORE · SEQUENCED LIVE IN WEBAUDIO'],
  ['SOUND', 'SYNTHESIZED IN YOUR BROWSER — NO SAMPLES'],
  ['NETWORK', 'WEBRTC VIA PEERJS · MQTT RELAY FALLBACK'],
  ['TYPE', 'PIXELIFY SANS · SILKSCREEN (OFL)'],
];

// ------------------------------------------------------------------ state
let root = null;
let H = {};
let layer = null, bannerEl = null, toastEl = null;
const screens = {};           // name -> { el, def }
let curName = null;
let settingsCache = null;
let lobbyState = { lobby: null, session: null };
const transports = new Map(); // slot -> 'p2p'|'relay'
let transportSession = null;
let hangarShip = null;
let solSector = 0;
let busyTimer = 0;

function call(name, ...args) {
  const fn = H && H[name];
  if (typeof fn !== 'function') return undefined;
  try {
    const r = fn.apply(H, args);
    if (r && typeof r.then === 'function') r.catch(() => clearBusy());
    return r;
  } catch (e) {
    console.error(`UI handler ${name} failed`, e);
    clearBusy();
    return undefined;
  }
}
function profile() {
  let p = null;
  try { p = call('getProfile'); } catch { /* */ }
  return p && typeof p === 'object' ? p : {};
}
function settings() {
  let s = null;
  try { s = call('getSettings'); } catch { /* */ }
  settingsCache = Object.assign({}, DEFAULT_SETTINGS, settingsCache || {}, s && typeof s === 'object' ? s : {});
  return settingsCache;
}
function curShip() {
  if (hangarShip && SHIPS[hangarShip]) return hangarShip;
  const p = profile();
  hangarShip = SHIPS[p.ship] ? p.ship : SHIP_ORDER[0];
  return hangarShip;
}
function setShip(id) {
  if (!SHIPS[id]) return;
  hangarShip = id;
  call('onShip', id);
}
function pilotName() {
  const s = settings();
  return (s.name || profile().name || '').toString().trim().toUpperCase();
}

// Busy state for network actions: the button shows a working label until the screen changes,
// the handler's promise rejects, or 20 s pass.
function setBusy(btn, label) {
  clearBusy();
  if (!btn) return;
  btn.classList.add('busy');
  btn.dataset.label = $(btn, '.btn-label')?.textContent || '';
  const l = $(btn, '.btn-label');
  if (l) l.textContent = label;
  busyTimer = setTimeout(clearBusy, 20000);
}
function clearBusy() {
  clearTimeout(busyTimer);
  if (!root) return;
  $$(root, '.btn.busy').forEach((b) => {
    b.classList.remove('busy');
    const l = $(b, '.btn-label');
    if (l && b.dataset.label) l.textContent = b.dataset.label;
  });
}

// ------------------------------------------------------------------ markup helpers
function btn(act, label, { cls = '', sub = '', ico = '', sfx = '', aria = '', attrs = '' } = {}) {
  return `<button type="button" class="btn ${cls}" data-act="${act}"${sfx ? ` data-sfx="${sfx}"` : ''}${aria ? ` aria-label="${esc(aria)}"` : ''} ${attrs}>` +
    (ico ? `<span class="btn-ico">${icon(ico)}</span>` : '') +
    `<span class="btn-text"><span class="btn-label">${label}</span>${sub ? `<span class="btn-sub">${sub}</span>` : ''}</span>` +
    `</button>`;
}
function head(title, { back = true, kicker = '', aux = '' } = {}) {
  return `<header class="head">` +
    (back ? `<button type="button" class="btn-back" data-act="back" data-sfx="ui_back" aria-label="Back">${icon('back')}</button>` : '<span class="head-spacer"></span>') +
    `<div class="head-title">${kicker ? `<span class="kicker">${kicker}</span>` : ''}<h2>${title}</h2></div>` +
    `<span class="head-aux">${aux}</span>` +
    `</header>`;
}
function stagger(el) {
  $$(el, '.stagger').forEach((box) => Array.from(box.children).forEach((c, i) => c.style.setProperty('--i', i)));
}

// ------------------------------------------------------------------ screens
const DEF = {};

// ---------- loading
DEF.loading = {
  cls: 'scr-loading',
  label: 'Loading',
  html: () => `
    <div class="load-wrap">
      <div class="load-kicker"><span>MILGIE.COM</span> PRESENTS</div>
      <div class="load-panel">
        <div class="load-bar" aria-hidden="true"><div class="load-fill"></div><div class="load-glint"></div></div>
        <div class="load-row"><span class="load-label">BOOTING</span><span class="load-pct">0%</span></div>
      </div>
      <p class="load-tip"></p>
    </div>`,
  enter(el) {
    $(el, '.load-tip').textContent = 'TIP · ' + TIPS[(Math.random() * TIPS.length) | 0];
  },
};

// ---------- title
DEF.title = {
  cls: 'scr-title',
  label: 'Title',
  html: () => `
    <div class="logo-fallback" aria-hidden="true">
      <div class="lf-nova" data-text="NOVA">NOVA</div>
      <div class="lf-lancers" data-text="LANCERS">LANCERS</div>
      <div class="lf-sub">CO-OP STARFIGHTER</div>
    </div>
    <button type="button" class="title-tap" data-act="start" data-sfx="ui_start" aria-label="Tap to start">
      <span class="tap-invite" hidden>${icon('squad')}<span>SQUAD INVITE</span><canvas class="pix inv-code" aria-hidden="true"></canvas></span>
      <span class="tap-text">TAP TO START</span>
      <span class="tap-keys">PRESS <kbd>ENTER</kbd> OR <kbd class="pad-a">A</kbd></span>
    </button>
    <div class="title-foot">
      <a class="title-back" href="../" data-sfx="ui_back">${icon('back')}<span>MILGIE.COM GAMES</span></a>
      <span class="title-best"></span>
      <span class="title-ver"></span>
    </div>`,
  enter(el, data = {}) {
    $(el, '.title-ver').textContent = 'V' + (data.version || VERSION);
    const best = data.best ?? profile().bestScore;
    $(el, '.title-best').innerHTML = best > 0 ? `HI <b>${pad7(best)}</b>` : '';
    const inv = $(el, '.tap-invite');
    const room = String(data.room || profile().room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    inv.hidden = !room;
    if (room) pix($(inv, '.inv-code'), room, { color: '#ffffff', spacing: 2 });
    const mouse = matchMedia('(hover: hover) and (pointer: fine)').matches;
    const cta = room ? (mouse ? 'CLICK TO JOIN' : 'TAP TO JOIN') : (mouse ? 'CLICK TO START' : 'TAP TO START');
    $(el, '.tap-text').textContent = cta;
    $(el, '.title-tap').setAttribute('aria-label', room ? `${cta} squad ${room.split('').join(' ')}` : cta);
    // Logo: main draws the sprite logo on the canvas; show the CSS fallback when it can't.
    const lf = $(el, '.logo-fallback');
    if (data.logoFallback != null) lf.classList.toggle('on', !!data.logoFallback);
    else if (!lf.dataset.manual) lf.classList.toggle('on', !hasSpr('logo'));
  },
  act(a, b, e, viaPad) {
    if (a !== 'start') return;
    AudioSys.unlock();
    // A gamepad press is not a user gesture, so browsers keep audio locked: say how to fix it.
    if (viaPad && !this.padHint) {
      this.padHint = true;
      setTimeout(() => { if (!audioRunning()) UI.toast('SOUND IS OFF — TAP OR PRESS ANY KEY TO TURN IT ON', 3600); }, 400);
    }
    call('onTitleTap');
    if (UI.current === 'title') UI.show('menu');
  },
  key(k) { if (k === 'Enter' || k === ' ') { snd('ui_start'); this.act('start'); return true; } return false; },
};
const audioRunning = () => { try { return !!AudioSys.ctx && AudioSys.ctx.state === 'running'; } catch { return false; } };

// ---------- menu
DEF.menu = {
  cls: 'scr-menu',
  label: 'Main menu',
  html: () => `
    <div class="col menu-col">
      <div class="menu-spacer"></div>
      <div class="pilot-card panel" aria-live="polite">
        <canvas class="ship-ico" width="29" height="29" aria-hidden="true"></canvas>
        <div class="pc-info">
          <span class="pc-kicker">PILOT</span>
          <span class="pc-name"></span>
          <span class="pc-ship"></span>
        </div>
        <div class="pc-best"><span>HI-SCORE</span><canvas class="pix pc-score" role="img"></canvas></div>
      </div>
      <nav class="menu-list" aria-label="Main menu">
        <div class="menu-main stagger">
          ${btn('solo', 'SOLO SORTIE', { cls: 'btn-primary btn-xl', ico: 'play', sub: '5 SECTORS · ONE PILOT', sfx: 'ui_start', attrs: 'data-autofocus' })}
          ${btn('coop', 'CO-OP SQUAD', { cls: 'btn-gold btn-xl', ico: 'squad', sub: 'UP TO 4 PILOTS · ONLINE' })}
        </div>
        <div class="grid2 stagger">
          ${btn('hangar', 'HANGAR', { ico: 'ship' })}
          ${btn('settings', 'SETTINGS', { ico: 'gear' })}
          ${btn('howto', 'HOW TO PLAY', { ico: 'help' })}
          ${btn('credits', 'CREDITS', { ico: 'star' })}
        </div>
      </nav>
    </div>`,
  enter(el) {
    const p = profile();
    const ship = curShip();
    $(el, '.pc-name').textContent = pilotName() || 'NEW PILOT';
    $(el, '.pc-ship').textContent = `${SHIPS[ship].name} · ${SHIPS[ship].weapon}`;
    const sc = $(el, '.pc-score');
    paintScore(sc, p.bestScore || 0, '#ffd966');
    sc.setAttribute('aria-label', 'Hi-score ' + fmt(p.bestScore || 0));
    drawShipIcon($(el, '.ship-ico'), ship, 0);
  },
  act(a) {
    if (a === 'solo') UI.show('hangar', { mode: 'solo', back: 'menu' });
    else if (a === 'coop') UI.show('coop');
    else if (a === 'hangar') UI.show('hangar', { mode: 'pick', back: 'menu' });
    else if (a === 'settings') UI.show('settings', { back: 'menu' });
    else if (a === 'howto') UI.show('howto', { back: 'menu' });
    else if (a === 'credits') UI.show('credits', { back: 'menu' });
    else if (a === 'back') UI.show('title', { version: VERSION });
  },
  back() { UI.show('title', { version: VERSION }); },
};

// ---------- hangar
const hangar = { raf: 0, t: 0, last: 0, idx: 0, team: 0, stars: null, shots: [], fireT: 0, cv: null, g: null, lc: null, lg: null, b1: null, b2: null, swipe: null };
const PREV_W = 88, PREV_H = 80;

DEF.hangar = {
  cls: 'scr-hangar',
  label: 'Hangar',
  html: () => `
    <div class="col">
      ${head('HANGAR', { kicker: 'SELECT YOUR LANCER' })}
      <div class="hg-stage panel" data-interactive>
        <canvas class="hg-preview" width="${PREV_W}" height="${PREV_H}" aria-hidden="true"></canvas>
        <div class="hg-hud">
          <span class="hg-name"></span>
          <span class="hg-weapon"></span>
        </div>
        <button type="button" class="hg-arrow hg-prev" data-act="prev" data-sfx="ui_move" aria-label="Previous ship">${icon('back')}</button>
        <button type="button" class="hg-arrow hg-next" data-act="next" data-sfx="ui_move" aria-label="Next ship">${icon('next')}</button>
      </div>
      <div class="hg-tabs" role="tablist" aria-label="Ships">
        ${SHIP_ORDER.map((id) => `<button type="button" class="hg-tab" role="tab" data-act="ship" data-ship="${id}" data-sfx="ui_move" aria-label="${SHIPS[id].name}"><canvas width="29" height="29" aria-hidden="true"></canvas><span>${SHIPS[id].name}</span></button>`).join('')}
      </div>
      <div class="hg-info">
        <div class="hg-stats">
          ${['power', 'speed', 'spread'].map((k) => `<div class="stat" data-stat="${k}"><span class="stat-k">${k.toUpperCase()}</span><span class="pips">${'<i></i>'.repeat(5)}</span></div>`).join('')}
        </div>
        <p class="hg-blurb"></p>
      </div>
      <div class="hg-sector" hidden>
        <button type="button" class="hg-sec-btn" data-act="secprev" data-sfx="ui_move" aria-label="Previous sector">${icon('back')}</button>
        <div class="hg-sec-mid"><span class="kicker">START AT</span><span class="hg-sec-name"></span></div>
        <button type="button" class="hg-sec-btn" data-act="secnext" data-sfx="ui_move" aria-label="Next sector">${icon('next')}</button>
      </div>
      <div class="foot">
        ${btn('confirm', 'LAUNCH', { cls: 'btn-primary btn-xl hg-confirm', ico: 'play', sfx: 'ui_start', attrs: 'data-autofocus' })}
      </div>
    </div>`,
  build(el) {
    hangar.cv = $(el, '.hg-preview');
    hangar.g = hangar.cv.getContext('2d');
    const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    hangar.lc = mk(PREV_W, PREV_H); hangar.lg = hangar.lc.getContext('2d');
    hangar.b1 = mk(PREV_W >> 1, PREV_H >> 1);
    hangar.b2 = mk(PREV_W >> 2, PREV_H >> 2);
    hangar.H = PREV_H;
    hangar.stars = Array.from({ length: 50 }, () => ({ x: Math.random() * PREV_W, y: Math.random() * 200, z: Math.random() }));
    const stage = $(el, '.hg-stage');
    // The preview keeps 120 art px of width and grows its height to fill the stage, so the
    // pixels stay square whatever space the layout leaves.
    const fit = () => {
      const r = stage.getBoundingClientRect();
      if (r.width < 20 || r.height < 20) return;
      const h = clamp(Math.round((PREV_W * r.height) / r.width), 64, 200);
      if (h === hangar.H) return;
      hangar.H = h;
      for (const c of [hangar.cv, hangar.lc]) c.height = h;
      hangar.b1.height = h >> 1; hangar.b2.height = h >> 2;
      hangar.beam = null;
    };
    hangar.fit = fit;
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(stage);
    else addEventListener('resize', fit);
    stage.addEventListener('pointerdown', (e) => { if (!e.target.closest('button')) hangar.swipe = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
    stage.addEventListener('pointerup', (e) => {
      const s = hangar.swipe; hangar.swipe = null;
      if (!s || s.id !== e.pointerId) return;
      const dx = e.clientX - s.x;
      if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(e.clientY - s.y)) { snd('ui_move'); this.select(hangar.idx + (dx < 0 ? 1 : -1)); }
    });
    stage.addEventListener('pointercancel', () => { hangar.swipe = null; });
  },
  enter(el, data = {}) {
    this.data = data;
    const mode = data.mode || 'pick';
    // Back cancels: browsing ships only previews them until CONFIRM / LAUNCH
    this.entryShip = curShip();
    hangar.team = clamp(data.team | 0, 0, 3);
    el.className = el.className.replace(/\bt[0-3]\b/g, '').trim() + ' t' + hangar.team;
    const conf = $(el, '.hg-confirm');
    $(conf, '.btn-label').textContent = mode === 'solo' ? 'LAUNCH' : 'CONFIRM';
    conf.dataset.sfx = mode === 'solo' ? 'ui_start' : 'ui_select';
    $(conf, '.btn-ico').innerHTML = icon(mode === 'solo' ? 'play' : 'check');
    // sector select (solo only, once more than one sector is unlocked; indices are 0-based)
    const unlocked = clamp(profile().unlockedSector | 0, 0, SECTORS.length - 1);
    const sec = $(el, '.hg-sector');
    sec.hidden = !(mode === 'solo' && unlocked > 0);
    solSector = clamp(solSector, 0, unlocked);
    this.renderSector(el);
    $$(el, '.hg-tab canvas').forEach((c, i) => drawShipIcon(c, SHIP_ORDER[i], hangar.team));
    this.select(SHIP_ORDER.indexOf(curShip()), true);
    requestAnimationFrame(() => hangar.fit && hangar.fit());
    this.start();
  },
  leave() { cancelAnimationFrame(hangar.raf); hangar.raf = 0; },
  renderSector(el) {
    const s = SECTORS[solSector];
    $(el, '.hg-sec-name').innerHTML = `<span class="num">${s.n}</span> · ${esc(s.name)}`;
    const unlocked = clamp(profile().unlockedSector | 0, 0, SECTORS.length - 1);
    $(el, '[data-act="secprev"]').disabled = solSector <= 0;
    $(el, '[data-act="secnext"]').disabled = solSector >= unlocked;
  },
  select(i, silent) {
    const el = screens.hangar.el;
    hangar.idx = (i + SHIP_ORDER.length) % SHIP_ORDER.length;
    const id = SHIP_ORDER[hangar.idx];
    const s = SHIPS[id];
    hangarShip = id;
    $(el, '.hg-name').textContent = s.name;
    $(el, '.hg-weapon').textContent = s.weapon;
    $(el, '.hg-blurb').textContent = s.blurb;
    for (const k of ['power', 'speed', 'spread']) {
      const v = clamp(s.stats?.[k] | 0, 0, 5);
      $$(el, `.stat[data-stat="${k}"] i`).forEach((pip, j) => pip.classList.toggle('on', j < v));
      $(el, `.stat[data-stat="${k}"]`).setAttribute('aria-label', `${k} ${v} of 5`);
    }
    $$(el, '.hg-tab').forEach((t, j) => { t.setAttribute('aria-selected', j === hangar.idx ? 'true' : 'false'); t.classList.toggle('on', j === hangar.idx); });
    hangar.shots.length = 0;
    hangar.fireT = 0;
    hangar.swapT = silent ? 1 : 0;
  },
  act(a, b) {
    if (a === 'prev') this.select(hangar.idx - 1);
    else if (a === 'next') this.select(hangar.idx + 1);
    else if (a === 'ship') this.select(SHIP_ORDER.indexOf(b.dataset.ship));
    else if (a === 'secprev' || a === 'secnext') {
      const unlocked = clamp(profile().unlockedSector | 0, 0, SECTORS.length - 1);
      solSector = clamp(solSector + (a === 'secnext' ? 1 : -1), 0, unlocked);
      call('onSectorSelect', solSector);
      this.renderSector(screens.hangar.el);
    } else if (a === 'confirm') {
      const ship = SHIP_ORDER[hangar.idx];
      setShip(ship);
      if ((this.data?.mode || 'pick') === 'solo') {
        call('onSectorSelect', solSector);
        call('onSolo', { ship, sector: solSector });
      } else UI.show(this.data?.back || 'menu', this.data?.backData);
    } else if (a === 'back') this.back();
  },
  back() {
    if (this.entryShip && SHIPS[this.entryShip]) hangarShip = this.entryShip;
    UI.show(this.data?.back || 'menu', this.data?.backData);
  },
  key(k) {
    // Left/right cycle ships when focus isn't on a specific control row.
    const f = document.activeElement;
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && (!f || !f.closest('.hg-tabs, .hg-sector'))) {
      snd('ui_move');
      this.select(hangar.idx + (k === 'ArrowRight' ? 1 : -1));
      return true;
    }
    return false;
  },
  start() {
    cancelAnimationFrame(hangar.raf);
    hangar.last = performance.now();
    const loop = (now) => {
      hangar.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - hangar.last) / 1000);
      hangar.last = now;
      if (document.hidden) return;
      drawHangar(dt);
    };
    hangar.raf = requestAnimationFrame(loop);
  },
};

// Animated hangar preview: parallax stars, hologram pad, banking ship, engine flames and a
// looping weapon demo, with a cheap two-mip bloom from a separate light canvas.
function drawHangar(dt) {
  const { g, lg, lc } = hangar;
  const W = PREV_W, Hh = hangar.H || PREV_H;
  hangar.t += dt;
  hangar.swapT = Math.min(1, (hangar.swapT || 0) + dt * 3);
  const t = hangar.t;
  const team = hangar.team;
  const col = TEAM_HEX[team];
  const id = SHIP_ORDER[hangar.idx];
  const def = SHIPS[id];
  const meta = (SPR && SPR.SHIP_META && SPR.SHIP_META[id]) || {};
  g.imageSmoothingEnabled = false;
  lg.imageSmoothingEnabled = false;

  // background
  if (!hangar.grd || hangar.grdH !== Hh) {
    hangar.grd = g.createLinearGradient(0, 0, 0, Hh);
    hangar.grd.addColorStop(0, '#05040c'); hangar.grd.addColorStop(0.7, '#0e0b22'); hangar.grd.addColorStop(1, '#171236');
    hangar.grdH = Hh;
  }
  g.fillStyle = hangar.grd; g.fillRect(0, 0, W, Hh);
  lg.globalCompositeOperation = 'source-over';
  lg.fillStyle = '#000'; lg.fillRect(0, 0, W, Hh);
  for (const s of hangar.stars) {
    s.y += dt * (14 + s.z * 70);
    if (s.y > Hh) { s.y -= Hh; s.x = Math.random() * W; }
    g.fillStyle = s.z > 0.8 ? '#dfe8f7' : s.z > 0.45 ? '#7c8fb3' : '#36425f';
    const len = s.z > 0.8 ? 3 : 1;
    g.fillRect(s.x | 0, s.y | 0, 1, len);
  }

  const swap = hangar.swapT;
  const ease = 1 - Math.pow(1 - swap, 3);
  const cx = Math.round(W / 2 + (1 - ease) * 30);
  const cy = Math.round(Hh * 0.58 + Math.sin(t * 1.6) * 2);
  const padY = Math.round(Hh * 0.58) + 16;

  // hologram pad: rotating dotted ellipse + rising beam
  if (!hangar.beam || hangar.beamCol !== col) { hangar.beam = beamCanvas(col); hangar.beamCol = col; }
  g.globalCompositeOperation = 'lighter';
  g.drawImage(hangar.beam, cx - 22, padY - 46);
  g.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2 + t * 0.9;
    const x = Math.round(cx + Math.cos(a) * 19), y = Math.round(padY + Math.sin(a) * 4);
    const front = Math.sin(a) > 0;
    if (i % 2 === 0 || front) {
      g.fillStyle = front ? col : hexA(col, 0.45);
      g.fillRect(x, y, 1, 1);
      if (front) { lg.fillStyle = col; lg.fillRect(x, y, 1, 1); }
    }
  }

  // bank frame: gentle weave
  const weave = Math.sin(t * 1.3);
  const bank = clamp(Math.round(2 + weave * 1.6), 0, 4);
  const shipX = cx + Math.round(weave * 4);
  const haveShip = hasSpr(def.sprite);

  // weapon demo
  hangar.fireT -= dt;
  const guns = meta.guns || [[0, -10]];
  if (hangar.fireT <= 0 && swap > 0.6) {
    if (id === 'aurora') {
      hangar.fireT = 0.11;
      for (const gp of guns) for (const a of [-0.22, 0, 0.22]) hangar.shots.push({ k: 'vulcan', x: shipX + gp[0], y: cy + gp[1], vx: Math.sin(a) * 240, vy: -Math.cos(a) * 240, a });
    } else if (id === 'tempest') {
      hangar.fireT = 1;               // continuous beam, drawn below
    } else if (id === 'seraph') {
      hangar.fireT = 0.14;
      hangar.shots.push({ k: 'vulcan', x: shipX, y: cy - 9, vx: 0, vy: -250, a: 0 });
      hangar.mis = (hangar.mis || 0) + 1;
      if (hangar.mis % 4 === 0) {
        for (const sgn of [-1, 1]) hangar.shots.push({ k: 'missile', x: shipX + sgn * 9, y: cy - 4, vx: sgn * 70, vy: -30, a: 0 });
      }
    } else {
      hangar.fireT = 0.26;
      hangar.shots.push({ k: 'wave', x: shipX, y: cy - 10, vx: 0, vy: -170, a: 0, life: 0 });
    }
  }
  for (let i = hangar.shots.length - 1; i >= 0; i--) {
    const s = hangar.shots[i];
    if (s.k === 'missile') {
      s.vy -= dt * 420; s.vx *= Math.pow(0.1, dt);
      s.a = Math.atan2(s.vx, -s.vy);
    }
    s.x += s.vx * dt; s.y += s.vy * dt;
    s.life = (s.life || 0) + dt;
    if (s.y < -12 || s.x < -12 || s.x > W + 12) { hangar.shots.splice(i, 1); continue; }
    const opt = { team, dir: s.a };
    const name = s.k === 'vulcan' ? 'pb_vulcan' : s.k === 'missile' ? 'pb_missile' : (s.life > 0.25 ? 'pb_wave_l' : 'pb_wave');
    if (hasSpr(name)) {
      SPR.drawSprite(g, name, (t * 12) | 0, s.x, s.y, opt);
      SPR.drawSpriteEmissive(lg, name, (t * 12) | 0, s.x, s.y, opt);
    } else {
      g.fillStyle = col; lg.fillStyle = col;
      const w = s.k === 'wave' ? 12 : 2, h = s.k === 'wave' ? 3 : 6;
      g.fillRect(Math.round(s.x - w / 2), Math.round(s.y - h / 2), w, h);
      lg.fillRect(Math.round(s.x - w / 2), Math.round(s.y - h / 2), w, h);
    }
    if (s.k === 'missile' && ((t * 60) | 0) % 2 === 0) { lg.fillStyle = '#f7721f'; lg.fillRect(Math.round(s.x), Math.round(s.y + 4), 1, 2); }
  }
  if (id === 'tempest' && swap > 0.6) {
    const gx = shipX + (guns[0]?.[0] || 0), gy = cy + (guns[0]?.[1] || -11);
    if (hasSpr('pb_laser_body')) {
      const f = (t * 20) | 0;
      for (let y = gy - 4; y > -8; y -= 8) {
        SPR.drawSprite(g, 'pb_laser_body', f, gx, y, { team });
        SPR.drawSpriteEmissive(lg, 'pb_laser_body', f, gx, y, { team });
      }
      if (hasSpr('pb_laser_head')) {
        SPR.drawSprite(g, 'pb_laser_head', f, gx, gy - 2, { team });
        SPR.drawSpriteEmissive(lg, 'pb_laser_head', f, gx, gy - 2, { team });
      }
    } else {
      const w = 3 + Math.round(Math.sin(t * 40));
      g.fillStyle = col; g.fillRect(gx - (w >> 1), 0, w, gy);
      lg.fillStyle = '#ffffff'; lg.fillRect(gx, 0, 1, gy);
    }
  }

  // engine flames
  const engines = meta.engines || [[0, 12]];
  for (const e of engines) {
    const fx = shipX + e[0], fy = cy + e[1] + 3;
    if (hasSpr('flame_s')) {
      SPR.drawSprite(g, 'flame_s', (t * 16) | 0, fx, fy, { team });
      SPR.drawSpriteEmissive(lg, 'flame_s', (t * 16) | 0, fx, fy, { team });
    } else {
      const l = 3 + ((t * 30) | 0) % 3;
      lg.fillStyle = col; lg.fillRect(fx - 1, fy - 2, 2, l);
      lg.fillStyle = '#ffffff'; lg.fillRect(fx, fy - 2, 1, 2);
    }
  }
  // the ship
  if (haveShip) {
    SPR.drawSprite(g, def.sprite, bank, shipX, cy, { team });
    SPR.drawSpriteEmissive(lg, def.sprite, bank, shipX, cy, { team });
  } else {
    drawPlaceholderShip(g, shipX, cy, team);
  }
  // swap flash: brief silhouette as the new ship warps onto the pad
  if (swap < 0.35 && haveShip) {
    g.globalAlpha = 1 - swap / 0.35;
    SPR.drawSprite(g, def.sprite, bank, shipX, cy, { team, white: true });
    g.globalAlpha = 1;
  }

  // bloom: light layer added crisp, then two blurred mips
  g.globalCompositeOperation = 'lighter';
  g.drawImage(lc, 0, 0);
  const b1 = hangar.b1.getContext('2d'), b2 = hangar.b2.getContext('2d');
  b1.imageSmoothingEnabled = true; b2.imageSmoothingEnabled = true;
  b1.clearRect(0, 0, hangar.b1.width, hangar.b1.height);
  b1.drawImage(lc, 0, 0, hangar.b1.width, hangar.b1.height);
  b2.clearRect(0, 0, hangar.b2.width, hangar.b2.height);
  b2.drawImage(hangar.b1, 0, 0, hangar.b2.width, hangar.b2.height);
  g.imageSmoothingEnabled = true;
  g.globalAlpha = 0.7; g.drawImage(hangar.b1, 0, 0, W, Hh);
  g.globalAlpha = 0.9; g.drawImage(hangar.b2, 0, 0, W, Hh);
  g.globalAlpha = 1;
  g.imageSmoothingEnabled = false;
  g.globalCompositeOperation = 'source-over';

  // scan line sweep (hologram feel)
  const sy = Math.round(((t * 36) % (Hh + 30)) - 15);
  g.fillStyle = hexA(col, 0.07);
  g.fillRect(0, sy, W, 2);
}

// Soft light cone rising from the hologram pad (pre-rendered once per team colour).
function beamCanvas(col) {
  const c = document.createElement('canvas');
  c.width = 44; c.height = 50;
  const g = c.getContext('2d');
  for (let x = 0; x < 44; x++) {
    const d = Math.abs(x - 21.5) / 22;
    const a = 0.2 * Math.pow(Math.max(0, 1 - d), 1.6);
    const gr = g.createLinearGradient(0, 0, 0, 50);
    gr.addColorStop(0, hexA(col, 0)); gr.addColorStop(0.75, hexA(col, a * 0.6)); gr.addColorStop(1, hexA(col, a));
    g.fillStyle = gr;
    g.fillRect(x, 0, 1, 50);
  }
  return c;
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------- co-op
DEF.coop = {
  cls: 'scr-coop',
  label: 'Co-op squad',
  html: () => `
    <div class="col">
      ${head('CO-OP SQUAD', { kicker: 'UP TO 4 PILOTS · ONLINE' })}
      <div class="coop-hero panel">
        <div class="coop-ships" aria-hidden="true">
          ${[0, 1, 2, 3].map((i) => `<canvas class="t${i}" width="29" height="29"></canvas>`).join('')}
        </div>
        <ol class="coop-steps">
          <li><b>1</b><span>CREATE A SQUAD</span></li>
          <li><b>2</b><span>SHARE THE LINK OR QR</span></li>
          <li><b>3</b><span>FRIENDS TAP · JOINED!</span></li>
        </ol>
      </div>
      <label class="field callsign">
        <span class="field-k">CALLSIGN</span>
        <input class="coop-name" type="text" maxlength="12" autocomplete="nickname" autocapitalize="characters" spellcheck="false" enterkeyhint="done" placeholder="PILOT" aria-label="Callsign">
      </label>
      <button type="button" class="ship-chip" data-act="ship">
        <canvas width="29" height="29" aria-hidden="true"></canvas>
        <span class="chip-text"><span class="kicker">FLYING</span><b class="chip-ship"></b></span>
        <span class="chip-go">CHANGE ${icon('next')}</span>
      </button>
      <div class="coop-list stagger">
        ${btn('join', 'JOIN WITH CODE', { ico: 'link', sub: 'ENTER A 5-CHARACTER CODE' })}
        ${btn('quick', 'QUICK MATCH', { cls: 'btn-gold', ico: 'globe', sub: 'JOIN ANY OPEN SQUAD' })}
        ${btn('host', 'CREATE SQUAD', { cls: 'btn-primary btn-xl', ico: 'squad', sub: 'PRIVATE · INVITE FRIENDS', sfx: 'ui_start', attrs: 'data-autofocus' })}
      </div>
    </div>`,
  build(el) {
    const inp = $(el, '.coop-name');
    let t = 0;
    inp.addEventListener('input', () => {
      const v = inp.value.toUpperCase().replace(/[^A-Z0-9 \-_.!?]/g, '').slice(0, 12);
      if (v !== inp.value) inp.value = v;
      clearTimeout(t);
      t = setTimeout(() => saveSetting({ name: v.trim() }), 300);
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
  },
  enter(el) {
    loadNet();
    $$(el, '.coop-ships canvas').forEach((c, i) => drawShipIcon(c, SHIP_ORDER[i], i));
    const ship = curShip();
    drawShipIcon($(el, '.ship-chip canvas'), ship, 0);
    $(el, '.chip-ship').textContent = `${SHIPS[ship].name} · ${SHIPS[ship].weapon}`;
    $(el, '.coop-name').value = pilotName();
  },
  act(a, b) {
    const ship = curShip();
    if (a === 'host') { setBusy(b, 'OPENING CHANNEL'); call('onHost', { ship, isPublic: false }); }
    else if (a === 'quick') { setBusy(b, 'SEARCHING'); call('onQuickMatch', { ship }); }
    else if (a === 'join') UI.show('join');
    else if (a === 'ship') UI.show('hangar', { mode: 'pick', back: 'coop' });
    else if (a === 'back') this.back();
  },
  back() { UI.show('menu'); },
};

function saveSetting(patch) {
  const s = Object.assign({}, settings(), patch);
  settingsCache = s;
  call('onSettings', s);
}

// ---------- join
DEF.join = {
  cls: 'scr-join',
  label: 'Join squad',
  html: () => `
    <div class="col">
      ${head('JOIN SQUAD', { kicker: 'ENTER THE SQUAD CODE' })}
      <div class="join-box panel">
        <div class="code-cells">${'<span class="cell" aria-hidden="true"><canvas class="pix"></canvas></span>'.repeat(5)}
          <input class="code-input" type="text" inputmode="text" maxlength="300" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" aria-label="Squad code, 5 characters">
        </div>
        <p class="join-hint">5 CHARACTERS · A PASTED INVITE LINK WORKS TOO</p>
        <p class="join-err" role="alert"></p>
      </div>
      <div class="join-foot">
        ${btn('paste', 'PASTE', { cls: 'btn-sm', ico: 'paste', aria: 'Paste code from clipboard' })}
        ${btn('go', 'JOIN', { cls: 'btn-primary btn-xl', ico: 'play', sfx: 'ui_start' })}
      </div>
      <p class="join-note">No code? Ask the squad leader to tap SHARE INVITE — or scan their QR code with your camera.</p>
    </div>`,
  build(el) {
    const inp = $(el, '.code-input');
    inp.addEventListener('input', () => this.setCode(inp.value, true));
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.act('go', $(el, '[data-act="go"]')); }
    });
    inp.addEventListener('focus', () => el.classList.add('typing'));
    inp.addEventListener('blur', () => el.classList.remove('typing'));
    $(el, '.code-cells').addEventListener('click', () => inp.focus());
    if (!(navigator.clipboard && navigator.clipboard.readText)) $(el, '[data-act="paste"]').hidden = true;
  },
  setCode(raw, fromInput) {
    const el = screens.join.el;
    const inp = $(el, '.code-input');
    const s = String(raw || '');
    // Several characters at once (paste, drop, a share message): look for the code in it
    // before falling back to the per-character filter.
    const bulk = !fromInput || s.length - (this.code || '').length > 1;
    let code = bulk ? extractCode(s) : null;
    let rejected = false;
    const found = code != null;
    if (!found) {
      code = '';
      for (const ch of s.toUpperCase()) {
        if (ROOM_ALPHABET.includes(ch)) { if (code.length < 5) code += ch; } else if (/[A-Z0-9]/.test(ch)) rejected = true;
      }
    }
    if (inp.value !== code) inp.value = code;
    $$(el, '.cell').forEach((c, i) => {
      const cv = $(c, 'canvas');
      if (code[i]) { pix(cv, code[i], { color: '#ffffff' }); cv.hidden = false; } else cv.hidden = true;
      c.classList.toggle('filled', !!code[i]);
      c.classList.toggle('cur', i === Math.min(code.length, 4) && code.length < 5);
    });
    $(el, '[data-act="go"]').disabled = code.length !== 5;
    const err = $(el, '.join-err');
    if (fromInput && bulk && !found && s.trim().length > 6) {
      err.textContent = 'NO SQUAD CODE IN THAT TEXT — TYPE THE 5 CHARACTERS';
      snd('ui_error');
    } else if (rejected && fromInput && !bulk) {
      // only for characters typed one at a time
      err.textContent = 'CODES NEVER USE I, L, O, 0 OR 1';
      snd('ui_error');
      el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
    } else if (fromInput) err.textContent = '';
    if (fromInput && code.length > (this.prevLen || 0)) snd('ui_move');
    this.prevLen = code.length;
    this.code = code;
  },
  enter(el, data = {}) {
    this.setCode(data.code || this.code || '', false);
    const err = $(el, '.join-err');
    const msg = { ROOM_NOT_FOUND: 'SQUAD NOT FOUND — CHECK THE CODE', ROOM_FULL: 'THAT SQUAD IS FULL', ALREADY_STARTED: 'THAT SQUAD ALREADY LAUNCHED', NETWORK: 'NETWORK ERROR — TRY AGAIN' }[data.error];
    err.textContent = msg || (data.error ? String(data.error).toUpperCase() : '');
    // Focus the field right away on desktop; on touch let the player tap it (keyboard pop-up).
    if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => { if (UI.current === 'join') $(el, '.code-input').focus(); }, 60);
  },
  act(a, b) {
    const el = screens.join.el;
    if (a === 'go') {
      if ((this.code || '').length !== 5) { snd('ui_error'); el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); return; }
      $(el, '.code-input').blur();
      setBusy(b, 'CONNECTING');
      call('onJoin', { code: this.code, ship: curShip() });
    } else if (a === 'paste') {
      navigator.clipboard.readText().then((txt) => this.setCode(txt, true)).catch(() => UI.toast('CLIPBOARD NOT AVAILABLE — TYPE THE CODE', 2000));
    } else if (a === 'back') this.back();
  },
  back() { UI.show('coop'); },
};

// Pull a squad code out of pasted text: an invite link (?room= / ?r=), else the last
// 5-character word made only of code characters (capitals and digits preferred).
function extractCode(s) {
  const ok = (c) => c.length === 5 && [...c].every((ch) => ROOM_ALPHABET.includes(ch));
  const m = s.match(/[?&#](?:room|r)=([A-Za-z0-9]+)/i);
  if (m && ok(m[1].toUpperCase())) return m[1].toUpperCase();
  const toks = s.match(/\b[A-HJKMNP-Z2-9]{5}\b/gi);
  if (!toks) return null;
  let best = null, bs = -1;
  for (const t of toks) {
    const sc = (t === t.toUpperCase() ? 2 : 0) + (/[0-9]/.test(t) ? 1 : 0);
    if (sc >= bs) { bs = sc; best = t; }
  }
  return best.toUpperCase();
}

// ---------- lobby
DEF.lobby = {
  cls: 'scr-lobby',
  label: 'Squad lobby',
  html: () => `
    <div class="col">
      <header class="head">
        <button type="button" class="btn-back lb-back" data-act="leave" data-sfx="none" aria-label="Leave squad">${icon('back')}</button>
        <div class="head-title"><span class="kicker lb-kind">PRIVATE SQUAD</span><h2>SQUAD LOBBY</h2></div>
        <span class="head-aux lb-count">1/4</span>
      </header>
      <div class="lb-top">
        <div class="lb-code panel">
          <span class="kicker">SQUAD CODE</span>
          <div class="lb-code-val" role="img" aria-label="Squad code pending">${'<span><canvas class="pix" hidden></canvas></span>'.repeat(5)}</div>
          ${btn('share', 'SHARE INVITE', { cls: 'btn-sm btn-primary', ico: 'share', aria: 'Share invite link' })}
        </div>
        <button type="button" class="lb-qr panel" data-act="qr" aria-label="Show QR code full screen">
          <canvas class="qr-cv" aria-hidden="true"></canvas>
          <span class="lb-qr-cap">${icon('qr')} SCAN TO JOIN</span>
        </button>
      </div>
      <ul class="lb-slots" aria-label="Pilots">
        ${[0, 1, 2, 3].map((i) => `
          <li class="slot t${i} empty" data-slot="${i}">
            <span class="slot-tag">P${i + 1}</span>
            <canvas class="slot-ship" width="26" height="26" aria-hidden="true"></canvas>
            <span class="slot-main"><span class="slot-name-row"><span class="slot-name"></span><em class="slot-badge" hidden></em></span><span class="slot-sub"></span></span>
            <span class="slot-state"></span>
          </li>`).join('')}
      </ul>
      <div class="lb-picker" role="radiogroup" aria-label="Your ship">
        ${SHIP_ORDER.map((id) => `<button type="button" class="lb-ship" role="radio" data-act="lbship" data-ship="${id}" data-sfx="ui_move" aria-label="${SHIPS[id].name}"><canvas width="26" height="26" aria-hidden="true"></canvas><span>${SHIPS[id].name}</span></button>`).join('')}
      </div>
      <p class="lb-status" aria-live="polite"></p>
      <div class="foot lb-actions">
        ${btn('leave', 'LEAVE', { cls: 'btn-sm btn-ghost lb-leave', sub: ' ', sfx: 'none' })}
        ${btn('ready', 'READY', { cls: 'btn-primary btn-xl lb-ready', ico: 'check', attrs: 'data-autofocus' })}
        ${btn('launch', 'LAUNCH', { cls: 'btn-gold btn-xl lb-launch', ico: 'play', sfx: 'ui_start' })}
      </div>
    </div>
    <div class="qr-modal" hidden data-act="qrclose" data-sfx="ui_back" role="dialog" aria-modal="true" aria-label="Invite QR code">
      <div class="qr-modal-box panel">
        <canvas class="qr-big" aria-hidden="true"></canvas>
        <div class="qr-modal-side">
          <span class="kicker">SCAN WITH YOUR CAMERA</span>
          <canvas class="pix qr-modal-code" role="img"></canvas>
          ${btn('qrclose', 'CLOSE', { cls: 'btn-sm', sfx: 'ui_back' })}
        </div>
      </div>
    </div>`,
  enter(el, data = {}) {
    const session = data.session || (data.isHost != null && data.code ? data : null) || lobbyState.session;
    const lobby = data.lobby || session?.lobby || lobbyState.lobby;
    $(el, '.qr-modal').hidden = true;
    this.qrFor = null;
    this.armLeave(false);
    renderLobby(lobby, session);
    requestAnimationFrame(() => { if (UI.current === 'lobby') renderLobby(lobbyState.lobby, lobbyState.session); });
  },
  leave() { this.armLeave(false); },
  // Leaving is two-step (the host's leave closes the squad for everyone): the first press
  // arms LEAVE for 3 s, the second one leaves. Esc / gamepad B only ever arm it.
  armLeave(on) {
    const el = screens.lobby?.el;
    clearTimeout(this.lt);
    this.leaveArmed = !!on;
    if (!el) return;
    el.classList.toggle('leave-armed', this.leaveArmed);
    const b = $(el, '.lb-leave');
    b.classList.toggle('armed', this.leaveArmed);
    b.classList.toggle('btn-danger', this.leaveArmed);
    b.classList.toggle('btn-ghost', !this.leaveArmed);
    $(el, '.lb-back').classList.toggle('armed', this.leaveArmed);
    this.leaveLabel();
    if (this.leaveArmed) this.lt = setTimeout(() => this.armLeave(false), 3000);
  },
  leaveLabel() {
    const el = screens.lobby?.el;
    if (!el) return;
    const host = !!lobbyState.session?.isHost;
    const b = $(el, '.lb-leave');
    $(b, '.btn-label').textContent = this.leaveArmed ? (host ? 'CLOSE SQUAD?' : 'LEAVE SQUAD?') : 'LEAVE';
    $(b, '.btn-sub').textContent = this.leaveArmed ? (root.classList.contains('kbd') ? 'PRESS AGAIN TO CONFIRM' : 'TAP AGAIN TO CONFIRM') : '';
    b.setAttribute('aria-label', this.leaveArmed ? (host ? 'Confirm: close the squad for everyone' : 'Confirm: leave the squad') : (host ? 'Close squad' : 'Leave squad'));
  },
  act(a, b) {
    const { lobby, session } = lobbyState;
    const me = myEntry(lobby, session);
    if (a === 'leave') {
      if (this.leaveArmed) { snd('ui_back'); this.armLeave(false); call('onLeaveLobby'); }
      else { snd('ui_move'); this.armLeave(true); }
    } else if (a === 'share') { if (session?.code) call('onShare', session.code); }
    else if (a === 'qr') this.openQR();
    else if (a === 'qrclose') {
      $(screens.lobby.el, '.qr-modal').hidden = true;
      if (root.classList.contains('kbd')) $(screens.lobby.el, '.lb-qr').focus();
    } else if (a === 'lbship') {
      const id = b.dataset.ship;
      hangarShip = id;
      call('onShip', id);
      call('onLobbyShip', id);
      // optimistic update so the picker feels instant
      pending = { ship: id, ready: pending.ready, t: performance.now() };
      renderLobby(lobby, session);
    } else if (a === 'ready') {
      const want = !me?.ready;
      call('onLobbyReady', want);
      pending = { ship: pending.ship, ready: want, t: performance.now() };
      renderLobby(lobby, session);
    } else if (a === 'launch') {
      if (me && !me.ready) call('onLobbyReady', true);
      setBusy(b, 'LAUNCHING');
      call('onLaunch');
    }
  },
  openQR() {
    const el = screens.lobby.el;
    const code = lobbyState.session?.code;
    if (!code) return;
    const m = $(el, '.qr-modal');
    m.hidden = false;
    // big enough to scan across a room, small enough to leave the code + CLOSE on screen
    const land = innerWidth > innerHeight && innerHeight < 560;
    const target = land ? Math.min(innerHeight - 64, innerWidth * 0.5) : Math.min(innerWidth * 0.74, innerHeight - 230);
    sizeQR($(m, '.qr-big'), inviteUrl(code), Math.max(120, target));
    const c = $(m, '.qr-modal-code');
    pix(c, code, { color: '#ffffff', spacing: 3 });
    c.setAttribute('aria-label', 'Squad code ' + code.split('').join(' '));
    if (root.classList.contains('kbd')) $(m, '[data-act="qrclose"]').focus();
  },
  back() {
    const el = screens.lobby.el;
    const m = $(el, '.qr-modal');
    if (!m.hidden) { m.hidden = true; if (root.classList.contains('kbd')) $(el, '.lb-qr').focus(); return; }
    this.armLeave(true);
    if (root.classList.contains('kbd')) $(el, '.lb-leave').focus();
  },
};

function myEntry(lobby, session) {
  if (!lobby || !Array.isArray(lobby.players)) return null;
  const slot = session ? session.selfSlot | 0 : 0;
  const me = lobby.players.find((p) => p && p.slot === slot) || null;
  if (!me || !pending.t) return me;
  return Object.assign({}, me, pending.ship !== undefined ? { ship: pending.ship } : null, pending.ready !== undefined ? { ready: pending.ready } : null);
}

function inviteUrl(code) {
  if (!code) return '';
  try { if (NET?.makeInviteUrl) return NET.makeInviteUrl(code); } catch { /* */ }
  const u = new URL(location.href);
  u.search = ''; u.hash = '';
  u.searchParams.set('room', code);
  return u.toString();
}

// Draw a QR (4-module quiet zone, as the spec asks) scaled by a whole number of DEVICE
// pixels per module, so every module is identical on any screen density.
function sizeQR(canvas, url, targetCss) {
  try {
    const qr = drawQR(canvas, url, { margin: 4, dark: '#05040c', light: '#e9f1ff', ecl: 'M' });
    const n = qr.size + 8;
    const d = dprNow();
    const k = Math.max(1, Math.floor((targetCss * d) / n)) / d;
    canvas.style.width = canvas.style.height = (n * k).toFixed(3) + 'px';
    return true;
  } catch { return false; }
}

// Optimistic local changes (ship / ready) shown until the session's lobby echoes them back,
// so taps feel instant even over a slow relay. The session's own objects are never mutated.
let pending = { ship: undefined, ready: undefined, t: 0 };

function renderLobby(lobby, session) {
  lobbyState = { lobby, session };
  const S = screens.lobby;
  if (!S || !S.el) return;
  const el = S.el;
  const isHost = !!session?.isHost;
  const selfSlot = session ? session.selfSlot | 0 : 0;
  let players = (lobby && Array.isArray(lobby.players)) ? lobby.players.filter((p) => p && p.connected !== false) : [];
  if (pending.t) {
    const raw = players.find((p) => p.slot === selfSlot);
    const echoed = raw && (pending.ship === undefined || raw.ship === pending.ship) && (pending.ready === undefined || !!raw.ready === pending.ready);
    if (echoed || performance.now() - pending.t > 4000) pending = { ship: undefined, ready: undefined, t: 0 };
    else players = players.map((p) => (p.slot !== selfSlot ? p : Object.assign({}, p,
      pending.ship !== undefined ? { ship: pending.ship } : null, pending.ready !== undefined ? { ready: pending.ready } : null)));
  }
  const me = players.find((p) => p.slot === selfSlot) || null;
  const code = session?.code || '';

  el.classList.toggle('is-host', isHost);
  el.className = el.className.replace(/\bt[0-3]\b/g, '').trim() + ' t' + (selfSlot & 3);
  $(el, '.lb-kind').textContent = session?.isPublic ? 'PUBLIC SQUAD' : 'PRIVATE SQUAD';
  $(el, '.lb-count').textContent = `${players.length}/4`;
  // squad code: one bitmap glyph per cell (Pixelify's 2/Z, 5/S and 8/B are too alike)
  const cv = $(el, '.lb-code-val');
  if (cv.dataset.code !== code) {
    cv.dataset.code = code;
    $$(cv, 'canvas').forEach((c, i) => {
      if (code[i]) { pix(c, code[i], { color: '#ffffff' }); c.hidden = false; } else c.hidden = true;
    });
    cv.classList.toggle('pending', !code);
    cv.setAttribute('aria-label', code ? 'Squad code ' + code.split('').join(' ') : 'Squad code pending');
  }
  // QR of the invite link, redrawn only when the link or the box size changes
  const qrBtn = $(el, '.lb-qr');
  if (!code) qrBtn.hidden = true;
  else {
    if (!NET) loadNet().then((m) => { if (m && UI.current === 'lobby') renderLobby(lobbyState.lobby, lobbyState.session); });
    const url = inviteUrl(code);
    const key = url + '|' + qrBtn.clientWidth + '|' + dprNow();
    if (S.def.qrFor !== key && qrBtn.clientWidth > 40) {      // needs layout: sized to its box
      S.def.qrFor = key;
      qrBtn.hidden = !sizeQR($(el, '.qr-cv'), url, qrBtn.clientWidth - 16);
    } else if (S.def.qrFor !== key) qrBtn.hidden = false;
  }

  // per-slot transports (host sees each link; clients see their link to the host)
  if (session && transportSession !== session) {
    transports.clear();
    pending = { ship: undefined, ready: undefined, t: 0 };
    transportSession = session;
    try {
      session.on?.('transport', (ev) => {
        if (ev && typeof ev.slot === 'number') transports.set(ev.slot, ev.kind === 'relay' ? 'relay' : 'p2p');
        if (lobbyState.session === session) renderLobby(lobbyState.lobby, session);
      });
    } catch { /* */ }
  }
  const linkKind = (p) => {
    if (!session || p.slot === selfSlot) return '';
    const k = !isHost && p.slot === 0 ? session.transportKind : (transports.get(p.slot) || p.transport);
    return k === 'relay' || k === 'p2p' ? k : '';
  };

  let others = 0, othersReady = 0;
  $$(el, '.slot').forEach((li) => {
    const i = +li.dataset.slot;
    const p = players.find((q) => q.slot === i);
    li.classList.toggle('empty', !p);
    li.classList.toggle('ready', !!p?.ready);
    li.classList.toggle('self', !!p && i === selfSlot);
    li.classList.toggle('host', !!p && i === 0);
    const nameEl = $(li, '.slot-name'), badge = $(li, '.slot-badge'), subEl = $(li, '.slot-sub'), stEl = $(li, '.slot-state');
    const cvs = $(li, '.slot-ship');
    if (!p) {
      nameEl.textContent = 'OPEN SLOT';
      badge.hidden = true;
      subEl.textContent = code ? 'WAITING FOR PILOT…' : '';
      stEl.textContent = '';
      if (cvs.dataset.k !== '') { cvs.getContext('2d').clearRect(0, 0, cvs.width, cvs.height); cvs.dataset.k = ''; delete cvs.dataset.ship; }
      li.setAttribute('aria-label', `Player ${i + 1}: open slot`);
      return;
    }
    if (i !== selfSlot) { others++; if (p.ready) othersReady++; }
    const nm = String(p.name || `PILOT ${i + 1}`).toUpperCase().slice(0, 12);
    nameEl.textContent = nm;
    // one tag per row, outside the truncating name: HOST wins (your own row is highlighted)
    const tag = i === 0 ? 'HOST' : i === selfSlot ? 'YOU' : '';
    badge.hidden = !tag;
    badge.textContent = tag;
    badge.classList.toggle('hosttag', i === 0);
    const ship = SHIPS[p.ship] ? p.ship : 'aurora';
    const lk = linkKind(p);
    const ping = typeof p.ping === 'number' && p.ping > 0 && i !== selfSlot ? `${Math.round(p.ping)}MS` : '';
    subEl.innerHTML = [esc(SHIPS[ship].name), lk ? `<b class="link ${lk}">${lk === 'relay' ? 'RELAY' : 'P2P'}</b>` : '', ping ? `<span class="ping ${p.ping < 90 ? 'good' : p.ping < 180 ? 'ok' : 'bad'}">${ping}</span>` : ''].filter(Boolean).join(' · ');
    stEl.innerHTML = p.ready ? `${icon('check')}<span>READY</span>` : '<span>NOT READY</span>';
    const key = ship + ':' + (hasSpr(SHIPS[ship].sprite) ? 1 : 0);
    if (cvs.dataset.k !== key) { drawShipIcon(cvs, ship, i); cvs.dataset.k = key; }
    li.setAttribute('aria-label', `Player ${i + 1}${tag ? ' (' + tag.toLowerCase() + ')' : ''}: ${nm}, ${SHIPS[ship].name}, ${p.ready ? 'ready' : 'not ready'}`);
  });

  // ship picker (aria-disabled rather than disabled, so a tap can explain why)
  const myShip = SHIPS[me?.ship] ? me.ship : curShip();
  const locked = !isHost && !!me?.ready;               // the host has no READY toggle
  $$(el, '.lb-ship').forEach((b) => {
    const on = b.dataset.ship === myShip;
    b.setAttribute('aria-checked', on ? 'true' : 'false');
    b.classList.toggle('on', on);
    setDenied(b, locked ? 'UN-READY TO CHANGE SHIPS' : '');
    const c = $(b, 'canvas');
    const key = (selfSlot & 3) + ':' + (hasSpr(SHIPS[b.dataset.ship].sprite) ? 1 : 0);
    if (c.dataset.k !== key) { drawShipIcon(c, b.dataset.ship, selfSlot & 3); c.dataset.k = key; }
  });

  // actions
  const readyBtn = $(el, '.lb-ready'), launchBtn = $(el, '.lb-launch');
  readyBtn.hidden = isHost;
  launchBtn.hidden = !isHost;
  readyBtn.classList.toggle('is-ready', !!me?.ready);
  $(readyBtn, '.btn-label').textContent = me?.ready ? 'READY!' : 'READY';
  readyBtn.setAttribute('aria-pressed', me?.ready ? 'true' : 'false');
  const canLaunch = isHost && othersReady === others && !!lobby && !lobby.started;
  if (!launchBtn.classList.contains('busy')) {
    const waiting = others - othersReady;
    setDenied(launchBtn, canLaunch ? '' : lobby?.started ? 'LAUNCHING…' : `WAITING FOR ${waiting} PILOT${waiting > 1 ? 'S' : ''} TO READY UP`);
  }
  if (lobby?.started) clearBusy();
  S.def.leaveLabel?.();

  const status = $(el, '.lb-status');
  if (!session) status.textContent = 'CONNECTING…';
  else if (lobby?.started) status.textContent = 'LAUNCHING…';
  else if (isHost) {
    if (others === 0) status.textContent = 'SHARE THE CODE — OR LAUNCH SOLO. PILOTS CAN JOIN LATER.';
    else if (othersReady < others) status.textContent = `WAITING FOR ${others - othersReady} PILOT${others - othersReady > 1 ? 'S' : ''} TO READY UP`;
    else status.textContent = 'ALL PILOTS READY — LAUNCH WHEN YOU ARE';
  } else {
    status.textContent = me?.ready ? 'WAITING FOR THE HOST TO LAUNCH…' : 'PICK YOUR SHIP, THEN TAP READY';
  }
}

// Soft-disable a control: it stays focusable and a tap plays the error sound and shows
// `why` (browsers send no click to a real disabled button, so it could never explain).
function setDenied(b, why) {
  if (why) { b.setAttribute('aria-disabled', 'true'); b.dataset.deny = why; }
  else { b.removeAttribute('aria-disabled'); delete b.dataset.deny; }
}

// ---------- pause
DEF.pause = {
  cls: 'scr-pause scrim-dark',
  label: 'Paused',
  html: () => `
    <div class="col center">
      <div class="modal panel">
        <span class="kicker pz-kicker">GAME PAUSED</span>
        <h2 class="modal-title glitch" data-text="PAUSED">PAUSED</h2>
        <p class="pz-note" hidden>${icon('squad')} CO-OP: THE BATTLE CONTINUES WITHOUT YOU!</p>
        <div class="modal-list stagger">
          ${btn('resume', 'RESUME', { cls: 'btn-primary btn-xl', ico: 'play', attrs: 'data-autofocus' })}
          ${btn('settings', 'SETTINGS', { ico: 'gear' })}
          ${btn('howto', 'HOW TO PLAY', { ico: 'help' })}
          ${btn('quit', 'QUIT TO MENU', { cls: 'btn-danger', ico: 'home', sfx: 'ui_back' })}
        </div>
      </div>
    </div>`,
  enter(el, data = {}) {
    this.data = data;
    const online = !!(data.online || data.multiplayer || data.coop);
    $(el, '.pz-note').hidden = !online;
    $(el, '.pz-kicker').textContent = online ? 'SQUAD LINK ACTIVE' : 'GAME PAUSED';
    this.armQuit(false);
  },
  armQuit(on) {
    const el = screens.pause.el;
    const q = $(el, '[data-act="quit"]');
    q.classList.toggle('armed', on);
    $(q, '.btn-label').textContent = on ? 'TAP AGAIN TO QUIT' : 'QUIT TO MENU';
    clearTimeout(this.qt);
    if (on) this.qt = setTimeout(() => this.armQuit(false), 3000);
  },
  act(a, b) {
    if (a === 'resume') call('onResume');
    else if (a === 'settings') UI.show('settings', { back: 'pause', backData: this.data });
    else if (a === 'howto') UI.show('howto', { back: 'pause', backData: this.data });
    else if (a === 'quit') {
      if (b.classList.contains('armed')) { this.armQuit(false); call('onQuitToMenu'); } else this.armQuit(true);
    }
  },
  back() { call('onResume'); },
};

// ---------- game over
DEF.gameover = {
  cls: 'scr-gameover scrim-dark',
  label: 'Game over',
  html: () => `
    <div class="col center">
      <div class="modal panel go-panel">
        <span class="kicker go-kicker">SIGNAL LOST</span>
        <h2 class="modal-title go-title glitch" data-text="GAME OVER">GAME OVER</h2>
        <p class="go-sector"></p>
        <div class="big-score"><span class="kicker">SCORE</span><canvas class="pix score go-score" role="img"></canvas></div>
        <p class="go-best"></p>
        <div class="modal-list stagger">
          ${btn('continue', 'CONTINUE', { cls: 'btn-primary btn-xl go-continue', ico: 'play', sub: 'KEEP YOUR SECTOR · SCORE RESETS', sfx: 'ui_start', attrs: 'data-autofocus' })}
          ${btn('retry', 'RETRY SECTOR', { cls: 'go-retry', ico: 'retry', sfx: 'ui_start' })}
          ${btn('menu', 'MAIN MENU', { ico: 'home', sfx: 'ui_back' })}
        </div>
      </div>
    </div>`,
  enter(el, data = {}) {
    const solo = data.solo ?? !(data.online || data.multiplayer || data.coop);
    const score = +data.score || 0;
    const best = Math.max(+data.best || +data.hiScore || 0, 0);
    const gs = $(el, '.go-score');
    paintScore(gs, score);
    gs.setAttribute('aria-label', 'Score ' + fmt(score));
    const sec = data.sector && typeof data.sector === 'object' ? data.sector : SECTORS[(data.sector | 0) - 1] || null;
    $(el, '.go-sector').textContent = sec ? `SECTOR ${sec.n} · ${sec.name}` : (data.sectorName || '');
    const newBest = data.newBest ?? (score > 0 && score >= best);
    $(el, '.go-best').innerHTML = newBest && score > 0 ? `<span class="badge-new">${icon('star')} NEW HI-SCORE</span>` : best ? `HI-SCORE <b>${pad7(best)}</b>` : '';
    $(el, '.go-kicker').textContent = solo ? 'SIGNAL LOST' : 'SQUAD DOWN';
    $(el, '.go-title').textContent = 'GAME OVER';
    $(el, '.go-continue').hidden = !solo;
    const retry = $(el, '.go-retry');
    const canRetry = data.isHost !== false;
    setDenied(retry, canRetry ? '' : 'THE SQUAD HOST DECIDES WHETHER TO RETRY');
    $(retry, '.btn-label').textContent = canRetry ? (solo ? 'RETRY SECTOR' : 'RETRY AS SQUAD') : 'HOST DECIDES';
    if (!solo) retry.classList.add('btn-primary'); else retry.classList.remove('btn-primary');
  },
  act(a) {
    if (a === 'continue') call('onContinue');
    else if (a === 'retry') call('onRetry');
    else if (a === 'menu') call('onQuitToMenu');
  },
};

// ---------- results (sector clear)
DEF.results = {
  cls: 'scr-results scrim-dark',
  label: 'Sector clear',
  html: () => `
    <div class="col center">
      <div class="modal panel res-panel">
        <span class="kicker res-kicker">SECTOR CLEAR</span>
        <h2 class="modal-title res-title">MISSION COMPLETE</h2>
        <div class="res-totals">
          <div class="big-score"><span class="kicker">SCORE</span><canvas class="pix score res-score" role="img"></canvas></div>
          <div class="res-bonus"></div>
        </div>
        <div class="res-body"></div>
        <p class="res-wait" hidden>WAITING FOR THE HOST…</p>
        <div class="foot">
          ${btn('menu', 'MAIN MENU', { cls: 'btn-sm btn-ghost res-menu', ico: 'home', sub: ' ', sfx: 'none' })}
          ${btn('next', 'NEXT SECTOR', { cls: 'btn-primary btn-xl res-next', ico: 'play', sfx: 'ui_start', attrs: 'data-autofocus' })}
        </div>
      </div>
    </div>`,
  enter(el, data = {}) {
    this.data = data;
    this.armMenu(false);
    const sec = data.sector && typeof data.sector === 'object' ? data.sector : SECTORS[(data.sector | 0) - 1] || null;
    $(el, '.res-kicker').textContent = sec ? `SECTOR ${sec.n} CLEAR` : 'SECTOR CLEAR';
    $(el, '.res-title').textContent = sec ? sec.name : 'MISSION COMPLETE';
    const rows = Array.isArray(data.stats) ? data.stats : Array.isArray(data.players) ? data.players : [];
    const coop = rows.length > 1;
    const maxChain = data.maxChain | 0;
    const acc = (r) => { let a = r.accuracy ?? (r.shots ? (r.hits / r.shots) * 100 : 0); if (a <= 1 && a > 0 && !Number.isInteger(a)) a *= 100; return Math.round(a); };
    const body = $(el, '.res-body');
    if (!coop) {
      const r = rows[0] || {};
      const items = [
        ['KILLS', r.kills | 0, ''], ['ACCURACY', acc(r), '%'], ['GRAZES', r.grazes | 0, ''],
        ['MAX CHAIN', maxChain || r.maxChain | 0, '', '×'], ['GEMS', r.gems | 0, ''],
      ];
      body.innerHTML = `<dl class="res-list stagger">${items.map(([k, v, suf, pre]) => `<div class="res-row"><dt>${k}</dt><dd><span class="count" data-to="${v}" data-pre="${pre || ''}" data-suf="${suf}">0</span></dd></div>`).join('')}</dl>`;
    } else {
      const cols = [['KILLS', (r) => r.kills | 0], ['ACC', (r) => acc(r) + '%'], ['GRAZE', (r) => r.grazes | 0], ['GEMS', (r) => r.gems | 0], ['REVIVE', (r) => r.revives | 0]];
      body.innerHTML = `<table class="res-table"><thead><tr><th>PILOT</th>${cols.map((c) => `<th>${c[0]}</th>`).join('')}</tr></thead><tbody>` +
        rows.map((r) => `<tr class="t${(r.slot | 0) & 3}"><td class="pn"><i></i>${esc(String(r.name || `P${(r.slot | 0) + 1}`).toUpperCase().slice(0, 10))}</td>${cols.map((c) => `<td>${esc(c[1](r))}</td>`).join('')}</tr>`).join('') +
        `</tbody></table>` + (maxChain ? `<p class="res-chain">SQUAD MAX CHAIN <b>×${maxChain}</b></p>` : '');
    }
    const score = +data.score || 0, bonus = +data.bonus || 0;
    $(el, '.res-bonus').innerHTML = bonus ? `CLEAR BONUS <b>+${fmt(bonus)}</b>` : '';
    countUp($(el, '.res-score'), score, 1100, true);
    $(el, '.res-score').setAttribute('aria-label', 'Score ' + fmt(score));
    $$(body, '.count').forEach((c, i) => setTimeout(() => countUp(c, +c.dataset.to, 700, false, c.dataset.pre, c.dataset.suf), 250 + i * 140));
    const canNext = data.isHost !== false;
    const next = $(el, '.res-next');
    next.hidden = !canNext;
    el.classList.toggle('res-client', !canNext);
    $(el, '.res-wait').hidden = canNext;
    const last = sec && sec.n >= SECTORS.length;
    $(next, '.btn-label').textContent = last ? 'CONTINUE' : 'NEXT SECTOR';
  },
  // A way out that never depends on the host: two presses (the run / squad is left behind).
  armMenu(on) {
    const el = screens.results?.el;
    clearTimeout(this.mt);
    this.menuArmed = !!on;
    if (!el) return;
    const online = !!(this.data?.online || this.data?.isHost === false);
    const b = $(el, '.res-menu');
    b.classList.toggle('armed', this.menuArmed);
    b.classList.toggle('btn-danger', this.menuArmed);
    b.classList.toggle('btn-ghost', !this.menuArmed);
    $(b, '.btn-label').textContent = this.menuArmed ? (online ? 'LEAVE SQUAD?' : 'QUIT TO MENU?') : (online ? 'LEAVE SQUAD' : 'MAIN MENU');
    $(b, '.btn-sub').textContent = this.menuArmed ? (root.classList.contains('kbd') ? 'PRESS AGAIN TO CONFIRM' : 'TAP AGAIN TO CONFIRM') : '';
    if (this.menuArmed) this.mt = setTimeout(() => this.armMenu(false), 3000);
  },
  act(a) {
    if (a === 'menu') {
      if (this.menuArmed) { snd('ui_back'); this.armMenu(false); call('onQuitToMenu'); } else { snd('ui_move'); this.armMenu(true); }
      return;
    }
    if (a !== 'next') return;
    if (typeof this.data?.onNext === 'function') this.data.onNext();
    else if (typeof H.onNext === 'function') call('onNext');
    else call('onResume');
  },
  back() {
    this.armMenu(true);
    if (root.classList.contains('kbd')) $(screens.results.el, '.res-menu').focus();
  },
  leave() { this.armMenu(false); },
};

function countUp(el, to, ms, score, pre = '', suf = '') {
  if (!el) return;
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    const v = Math.round(to * (1 - Math.pow(1 - k, 3)));
    if (score) paintScore(el, v); else el.textContent = pre + v + suf;
    if (k < 1 && el.isConnected) requestAnimationFrame(step);
    else if (!score && k >= 1) { el.classList.add('done'); }
  };
  if (reduceMotion()) { if (score) paintScore(el, to); else el.textContent = pre + to + suf; return; }
  if (score) paintScore(el, 0);
  requestAnimationFrame(step);
}

// ---------- victory
DEF.victory = {
  cls: 'scr-victory scrim-dark',
  label: 'Victory',
  html: () => `
    <div class="col">
      <div class="vic-head">
        <span class="kicker">THE CHOIR IS SILENT</span>
        <h2 class="vic-title" data-text="VICTORY">VICTORY</h2>
        <div class="big-score"><span class="kicker">FINAL SCORE</span><canvas class="pix score vic-score" role="img"></canvas></div>
      </div>
      <div class="vic-roll" aria-live="off"><div class="vic-roll-track"><div class="vic-roll-inner"></div></div></div>
      <div class="foot">
        ${btn('menu', 'RETURN TO BASE', { cls: 'btn-primary btn-xl', ico: 'home', attrs: 'data-autofocus' })}
      </div>
    </div>`,
  enter(el, data = {}) {
    countUp($(el, '.vic-score'), +data.score || 0, 1800, true);
    $(el, '.vic-score').setAttribute('aria-label', 'Final score ' + fmt(+data.score || 0));
    const rows = Array.isArray(data.stats) ? data.stats : [];
    const pilots = rows.map((r) => `<li class="t${(r.slot | 0) & 3}"><i></i>${esc(String(r.name || `PILOT ${(r.slot | 0) + 1}`).toUpperCase())} <span>· ${esc(SHIPS[r.ship]?.name || '')}</span></li>`).join('');
    const inner = $(el, '.vic-roll-inner');
    inner.innerHTML =
      ENDING.map((p) => `<p class="vic-p">${esc(p)}</p>`).join('') +
      (pilots ? `<div class="vic-sec"><span class="kicker">THE NOVA LANCERS</span><ul class="vic-pilots">${pilots}</ul></div>` : '') +
      CREDITS.map(([k, v]) => `<div class="vic-sec"><span class="kicker">${esc(k)}</span><b>${esc(v)}</b></div>`).join('') +
      `<div class="vic-sec vic-end"><b>THANK YOU FOR PLAYING</b><span class="kicker">MILGIE.COM</span></div>`;
    // the roll is two transform animations (track: from 55% down to the top; text: up by its
    // own height), so it never triggers layout while it plays
    const track = $(el, '.vic-roll-track');
    for (const e of [track, inner]) e.classList.remove('roll');
    void inner.offsetWidth;
    for (const e of [track, inner]) e.classList.add('roll');
  },
  act(a) { if (a === 'menu') call('onQuitToMenu'); },
};

// ---------- settings
DEF.settings = {
  cls: 'scr-settings',
  label: 'Settings',
  html: () => `
    <div class="col">
      ${head('SETTINGS', { kicker: 'CONFIGURE YOUR COCKPIT' })}
      <div class="set-list scroll stagger">
        <label class="set-row set-text"><span class="set-k">CALLSIGN</span>
          <input class="set-name" type="text" maxlength="12" autocomplete="nickname" autocapitalize="characters" spellcheck="false" enterkeyhint="done" placeholder="PILOT"></label>
        ${slider('music', 'MUSIC', 0, 100, 5)}
        ${slider('sfx', 'SOUND FX', 0, 100, 5)}
        ${slider('sensitivity', 'TOUCH SENSITIVITY', 60, 200, 5)}
        <div class="set-row"><span class="set-k">GRAPHICS</span>
          <div class="seg" role="radiogroup" aria-label="Graphics quality">
            ${['auto', 'high', 'low'].map((q) => `<button type="button" role="radio" data-act="quality" data-q="${q}" data-sfx="ui_move">${q.toUpperCase()}</button>`).join('')}
          </div></div>
        ${toggle('haptics', 'HAPTICS')}
        ${toggle('shake', 'SCREEN SHAKE')}
        ${toggle('scanlines', 'CRT SCANLINES')}
        <div class="set-row set-fs">${btn('fullscreen', 'FULLSCREEN', { cls: 'btn-sm', ico: 'full' })}</div>
      </div>
      <div class="foot">${btn('back', 'DONE', { cls: 'btn-primary', ico: 'check', sfx: 'ui_back' })}</div>
    </div>`,
  build(el) {
    $$(el, 'input[type="range"]').forEach((r) => {
      let lastSnd = 0;
      r.addEventListener('input', () => {
        const k = r.dataset.k;
        const v = +r.value;
        this.paint(r);
        const patch = {};
        patch[k] = k === 'sensitivity' ? v / 100 : v / 100;
        saveSetting(patch);
        const now = performance.now();
        if (now - lastSnd > 90) { lastSnd = now; snd(k === 'sfx' ? 'ui_select' : 'ui_move'); }
      });
    });
    const nm = $(el, '.set-name');
    let t = 0;
    nm.addEventListener('input', () => {
      const v = nm.value.toUpperCase().replace(/[^A-Z0-9 \-_.!?]/g, '').slice(0, 12);
      if (v !== nm.value) nm.value = v;
      clearTimeout(t); t = setTimeout(() => saveSetting({ name: v.trim() }), 300);
    });
    nm.addEventListener('keydown', (e) => { if (e.key === 'Enter') nm.blur(); });
    const fsOk = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
    if (!fsOk) $(el, '.set-fs').hidden = true;
  },
  paint(r) {
    const min = +r.min, max = +r.max, v = +r.value;
    r.style.setProperty('--p', ((v - min) / (max - min)) * 100 + '%');
    const out = r.parentElement.parentElement.querySelector('output');
    if (out) out.textContent = r.dataset.k === 'sensitivity' ? (v / 100).toFixed(2) + '×' : v + '%';
  },
  enter(el, data = {}) {
    this.data = data;
    const s = settings();
    $(el, '.set-name').value = String(s.name || '').toUpperCase();
    for (const k of ['music', 'sfx']) { const r = $(el, `input[data-k="${k}"]`); r.value = Math.round(clamp(+s[k], 0, 1) * 100); this.paint(r); }
    const sr = $(el, 'input[data-k="sensitivity"]'); sr.value = Math.round(clamp(+s.sensitivity || 1.25, 0.6, 2) * 100); this.paint(sr);
    for (const k of ['haptics', 'shake', 'scanlines']) $(el, `[data-toggle="${k}"]`).setAttribute('aria-checked', s[k] ? 'true' : 'false');
    $$(el, '[data-act="quality"]').forEach((b) => b.setAttribute('aria-checked', b.dataset.q === (s.quality || 'auto') ? 'true' : 'false'));
    const fsBtn = $(el, '[data-act="fullscreen"]');
    if (fsBtn) fsBtn.hidden = !!document.fullscreenElement;
  },
  act(a, b) {
    if (a === 'toggle') {
      const k = b.dataset.toggle;
      const on = b.getAttribute('aria-checked') !== 'true';
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      saveSetting({ [k]: on });
    } else if (a === 'toggle-row') {
      const sw = $(b, '.switch');
      if (sw) this.act('toggle', sw);
    } else if (a === 'quality') {
      $$(screens.settings.el, '[data-act="quality"]').forEach((x) => x.setAttribute('aria-checked', x === b ? 'true' : 'false'));
      saveSetting({ quality: b.dataset.q });
    } else if (a === 'fullscreen') call('onFullscreen');
    else if (a === 'back') this.back();
  },
  back() { UI.show(this.data?.back || 'menu', this.data?.backData); },
};

function slider(k, label, min, max, step) {
  return `<div class="set-row set-slider"><label class="set-k" for="set-${k}">${label}</label>` +
    `<div class="set-ctl"><input id="set-${k}" type="range" min="${min}" max="${max}" step="${step}" data-k="${k}"><output for="set-${k}"></output></div></div>`;
}
// The whole row is a tap target (forwarded to the switch), not only the switch itself.
function toggle(k, label) {
  return `<div class="set-row set-toggle" data-act="toggle-row" data-sfx="ui_move"><span class="set-k" id="lbl-${k}">${label}</span>` +
    `<button type="button" class="switch" role="switch" data-act="toggle" data-toggle="${k}" data-sfx="ui_move" aria-labelledby="lbl-${k}" aria-checked="false"><span class="knob"></span><span class="sw-on">ON</span><span class="sw-off">OFF</span></button></div>`;
}

// ---------- how to play
DEF.howto = {
  cls: 'scr-howto',
  label: 'How to play',
  html: () => `
    <div class="col">
      ${head('HOW TO PLAY', { kicker: 'FLIGHT MANUAL' })}
      <div class="scroll howto-body">
        <div class="seg ctl-tabs" role="tablist" aria-label="Control scheme">
          <button type="button" role="tab" data-act="tab" data-tab="touch" data-sfx="ui_move">TOUCH</button>
          <button type="button" role="tab" data-act="tab" data-tab="keyboard" data-sfx="ui_move">KEYS</button>
          <button type="button" role="tab" data-act="tab" data-tab="gamepad" data-sfx="ui_move">PAD</button>
        </div>
        <section class="ctl-pane panel" data-pane="touch">${touchIllustration()}
          <ul class="ctl-notes">
            <li><b>DRAG ANYWHERE</b> — your ship moves with your finger, offset, so you never cover it.</li>
            <li><b>FIRE IS AUTOMATIC.</b> Focus on dodging.</li>
            <li><b>NOVA</b> — bottom-left. <b>OVERDRIVE</b> — bottom-right when charged. Two-finger tap also fires a NOVA.</li>
          </ul>
        </section>
        <section class="ctl-pane panel" data-pane="keyboard" hidden>${keyList(CONTROLS.keyboard)}</section>
        <section class="ctl-pane panel" data-pane="gamepad" hidden>${keyList(CONTROLS.gamepad)}</section>
        <h3 class="sect">RULES OF ENGAGEMENT</h3>
        <div class="rules stagger">
          ${rule('burst', 'NOVA BOMB', 'Erases every enemy bullet on screen and hits everything hard. Start with 2, carry up to 5.', 'nova')}
          ${rule('graze', 'GRAZE', 'Only your glowing core can be hit. Skim bullets close to score and charge OVERDRIVE.', 'graze')}
          ${rule('bolt', 'OVERDRIVE', 'When the meter is full: 6 s of double damage, bigger shots and ×2 score.', 'od')}
          ${rule('star', 'CHAIN', 'Kill again within 1.5 s to grow the chain — up to a ×16 score multiplier.', 'chain')}
          ${rule('squad', 'CO-OP REVIVE', 'Out of lives? You become a beacon. A squadmate hovering over it for 1.5 s brings you back.', 'revive')}
          ${rule('capsule', 'POWER-UPS', 'P raises weapon power (8 levels), B adds a NOVA, gems are pure score. Pickups are shared by the squad.', 'power')}
        </div>
      </div>
    </div>`,
  enter(el, data = {}) {
    this.data = data;
    let tab = this.tab;
    if (!tab) {
      const coarse = matchMedia('(pointer: coarse)').matches;
      const pad = navigator.getGamepads && Array.from(navigator.getGamepads() || []).some(Boolean);
      tab = pad ? 'gamepad' : coarse ? 'touch' : 'keyboard';
    }
    this.setTab(el, tab);
    const sc = $(el, '.scroll'); if (sc) sc.scrollTop = 0;
  },
  setTab(el, tab) {
    this.tab = tab;
    $$(el, '[data-act="tab"]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false'));
    $$(el, '.ctl-pane').forEach((p) => { p.hidden = p.dataset.pane !== tab; });
  },
  act(a, b) {
    if (a === 'tab') this.setTab(screens.howto.el, b.dataset.tab);
    else if (a === 'back') this.back();
  },
  back() { UI.show(this.data?.back || 'menu', this.data?.backData); },
};

function keyList(list) {
  return `<dl class="keys">${list.map((r) => `<div class="key-row"><dt>${r.keys.map((k) => `<kbd>${esc(k)}</kbd>`).join('')}${r.alt ? `<span class="alt">${esc(r.alt)}</span>` : ''}</dt><dd>${esc(r.act)}</dd></div>`).join('')}</dl>`;
}
function rule(ico, title, text, art) {
  return `<article class="rule panel"><div class="rule-art art-${art}" aria-hidden="true">${icon(ico)}</div><div><h4>${title}</h4><p>${numify(text)}</p></div></article>`;
}
// Inline pixel illustration: phone, relative drag, the ship offset from the finger, buttons.
function touchIllustration() {
  const dots = [[40, 16], [78, 22], [52, 40], [84, 48], [44, 70], [70, 12], [36, 54]].map(([x, y]) => `<rect x="${x}" y="${y}" width="1" height="1"/>`).join('');
  return `<svg class="touch-ill" viewBox="0 0 120 100" role="img" aria-label="Drag anywhere on the screen; the ship follows your finger with an offset. NOVA bottom left, OVERDRIVE bottom right." shape-rendering="crispEdges">
    <rect x="31" y="1" width="58" height="98" fill="#05040c"/>
    <rect x="32" y="2" width="56" height="96" fill="#1a1638" stroke="#526283" stroke-width="2"/>
    <rect x="35" y="8" width="50" height="84" fill="#0a0818"/>
    <rect x="55" y="4" width="10" height="2" fill="#322c6a"/>
    <g fill="#526283">${dots}</g>
    <g class="ill-move">
      <path d="M59 26h2v2h1v2h1v3h2v2h1v2h-12v-2h1v-2h2v-3h1v-2h1z" fill="#aebfdc"/>
      <rect x="59" y="30" width="2" height="2" fill="#27c2ea"/>
      <rect x="58" y="37" width="1" height="3" fill="#79ecff"/><rect x="61" y="37" width="1" height="3" fill="#79ecff"/>
      <path d="M60 43v12" stroke="#79ecff" stroke-width="1" stroke-dasharray="1 2"/>
      <rect x="54" y="56" width="12" height="12" fill="rgba(121,236,255,.14)"/>
      <rect x="56" y="58" width="8" height="8" fill="rgba(121,236,255,.32)"/>
      <rect x="58" y="60" width="4" height="4" fill="#d6fcff"/>
    </g>
    <path d="M42 62h6M42 62l2-2M42 62l2 2M78 62h-6M78 62l-2-2M78 62l-2 2" stroke="#dfe8f7" stroke-width="1"/>
    <rect x="37" y="79" width="10" height="10" fill="rgba(255,79,123,.3)" stroke="#ff4f7b" stroke-width="1"/>
    <rect x="41" y="81" width="2" height="6" fill="#ff8fab"/><rect x="39" y="83" width="6" height="2" fill="#ff8fab"/>
    <rect x="73" y="79" width="10" height="10" fill="rgba(240,169,42,.3)" stroke="#f0a92a" stroke-width="1"/>
    <path d="M79 81h-2l-1 3h2l-1 3 3-4h-2z" fill="#ffd966"/>
    <text x="28" y="87" text-anchor="end" fill="#ff8fab" font-size="5" font-family="Silkscreen, monospace">NOVA</text>
    <text x="92" y="87" fill="#ffd966" font-size="5" font-family="Silkscreen, monospace">OVER</text>
    <text x="92" y="93" fill="#ffd966" font-size="5" font-family="Silkscreen, monospace">DRIVE</text>
    <text x="28" y="64" text-anchor="end" fill="#79ecff" font-size="5" font-family="Silkscreen, monospace">DRAG</text>
    <text x="92" y="30" fill="#aebfdc" font-size="5" font-family="Silkscreen, monospace">SHIP</text>
  </svg>`;
}

// ---------- credits
DEF.credits = {
  cls: 'scr-credits',
  label: 'Credits',
  html: () => `
    <div class="col">
      ${head('CREDITS', { kicker: 'THE FLIGHT CREW' })}
      <div class="scroll credits-body">
        <div class="cr-hero"><span class="cr-logo">NOVA LANCERS</span><span class="kicker">A MILGIE.COM ORIGINAL</span></div>
        <dl class="cr-list stagger">
          ${CREDITS.slice(1).map(([k, v]) => `<div class="cr-row panel"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}
        </dl>
        <p class="cr-note">Every sprite, sound and note in this game is generated by code when the page loads — no image or audio files are downloaded.</p>
        <p class="cr-ver"></p>
      </div>
      <div class="foot">${btn('back', 'BACK', { ico: 'back', sfx: 'ui_back', attrs: 'data-autofocus' })}</div>
    </div>`,
  enter(el, data = {}) {
    this.data = data;
    $(el, '.cr-ver').textContent = 'VERSION ' + VERSION;
    const sc = $(el, '.scroll'); if (sc) sc.scrollTop = 0;
  },
  act(a) { if (a === 'back') this.back(); },
  back() { UI.show(this.data?.back || 'menu', this.data?.backData); },
};

// ------------------------------------------------------------------ navigation (keys / pad)
function focusables(scope) {
  return $$(scope, 'button, input, a[href], [tabindex="0"]').filter((e) => {
    if (e.disabled || e.hidden || e.closest('[hidden]')) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}
function scopeEl() {
  const S = screens[curName];
  if (!S) return null;
  const modal = $(S.el, '.qr-modal:not([hidden])');
  return modal || S.el;
}
function focusFirst() {
  const sc = scopeEl();
  if (!sc) return;
  const list = focusables(sc);
  const pref = list.find((e) => e.hasAttribute('data-autofocus')) || list.find((e) => !e.classList.contains('btn-back')) || list[0];
  if (pref) pref.focus({ preventScroll: false });
}
function moveFocus(dir) {
  const sc = scopeEl();
  if (!sc) return;
  const list = focusables(sc);
  if (!list.length) return;
  const cur = document.activeElement;
  if (!cur || !list.includes(cur)) { focusFirst(); snd('ui_move'); return; }
  const r0 = cur.getBoundingClientRect();
  const c0 = { x: r0.left + r0.width / 2, y: r0.top + r0.height / 2 };
  let best = null, bestScore = Infinity;
  // Score candidates in the pressed direction: distance along it, plus a penalty for the gap
  // across it (0 when the two boxes overlap on that axis, so stacked rows win over diagonals).
  const pick = (wrap) => {
    for (const e of list) {
      if (e === cur) continue;
      const r = e.getBoundingClientRect();
      const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      const gapX = Math.max(0, r.left - r0.right, r0.left - r.right);
      const gapY = Math.max(0, r.top - r0.bottom, r0.top - r.bottom);
      let primary, secondary;
      if (dir === 'down') { if (!wrap && r.top < r0.bottom - 2) continue; primary = wrap ? c.y : c.y - c0.y; secondary = gapX * 3 + Math.abs(c.x - c0.x) * 0.15; }
      else if (dir === 'up') { if (!wrap && r.bottom > r0.top + 2) continue; primary = wrap ? -c.y : c0.y - c.y; secondary = gapX * 3 + Math.abs(c.x - c0.x) * 0.15; }
      else if (dir === 'right') { if (r.left < r0.right - 2 || gapY > 8) continue; primary = c.x - c0.x; secondary = gapY * 3 + Math.abs(c.y - c0.y) * 0.3; }
      else { if (r.right > r0.left + 2 || gapY > 8) continue; primary = c0.x - c.x; secondary = gapY * 3 + Math.abs(c.y - c0.y) * 0.3; }
      const score = (wrap ? primary * 20 : primary) + secondary;
      if (score < bestScore) { bestScore = score; best = e; }
    }
  };
  pick(false);
  if (!best && (dir === 'up' || dir === 'down')) pick(true);
  if (best) {
    best.focus();
    best.scrollIntoView?.({ block: 'nearest' });
    snd('ui_move');
  }
}
function activate() {
  const sc = scopeEl();
  const f = document.activeElement;
  if (sc && f && sc.contains(f) && f.tagName !== 'INPUT') { f.click(); return; }
  if (sc && f && f.tagName === 'INPUT' && f.type === 'range') return;
  const S = screens[curName];
  if (S?.def.key && S.def.key('Enter')) return;
  focusFirst();
}
function goBack() {
  const S = screens[curName];
  if (!S || !S.def.back) return false;
  snd('ui_back');
  S.def.back.call(S.def);
  return true;
}

function onKeyDown(e) {
  if (!curName || curName === 'none' || curName === 'loading') return;
  const k = e.key;
  const t = e.target;
  const isText = t && t.tagName === 'INPUT' && t.type !== 'range';
  const isRange = t && t.tagName === 'INPUT' && t.type === 'range';
  const S = screens[curName];
  let handled = false;
  const nav = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  let dir = nav[k];
  if (!dir && !isText && !e.ctrlKey && !e.metaKey && !e.altKey) dir = { w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' }[k];
  if (dir || k === 'Tab') root.classList.add('kbd');

  if (k === 'Tab') {
    // keep focus inside the active screen (or the QR view on top of the lobby)
    const list = focusables(scopeEl());
    if (list.length) {
      const i = list.indexOf(document.activeElement);
      const n = i < 0 ? (e.shiftKey ? list.length - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + list.length) % list.length;
      list[n].focus();
      list[n].scrollIntoView?.({ block: 'nearest' });
    }
    e.preventDefault();
    return;
  }
  if (k === 'Escape') {
    // Deferred so the game's own key handler sees this Escape while it is still disabled
    // (otherwise resuming from pause would immediately re-pause).
    if (isText) t.blur(); else if (screens[curName]?.def.back) setTimeout(goBack, 0);
    handled = true;
  } else if (dir) {
    if ((dir === 'left' || dir === 'right') && (isText || isRange) && nav[k]) return; // native caret / slider
    if (S?.def.key && S.def.key(k)) handled = true;
    else { moveFocus(dir); handled = true; }
  } else if ((k === 'Enter' || k === ' ') && !isText) {
    root.classList.add('kbd');
    const f = document.activeElement;
    const inScope = f && scopeEl()?.contains(f) && f !== document.body;
    if (!inScope) {
      if (!(S?.def.key && S.def.key(k))) focusFirst();
      handled = true;
    } else if (f.tagName === 'A') { handled = false; }
    // focused buttons activate natively (click event)
  }
  if (handled) e.preventDefault();
}

// Gamepad polling while a menu is visible (edge-detected, with auto-repeat).
const pad = { raf: 0, prev: {}, held: null, heldT: 0, armed: false };
function padStart() {
  if (pad.raf || !navigator.getGamepads) return;
  pad.armed = false;
  const loop = () => {
    pad.raf = requestAnimationFrame(loop);
    if (!curName || curName === 'none' || curName === 'loading') return;
    let pads;
    try { pads = navigator.getGamepads(); } catch { return; }
    const cur = {};
    let any = false;
    for (const gp of pads || []) {
      if (!gp || !gp.connected) continue;
      any = true;
      const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      cur.up = cur.up || b(12) || ay < -0.55;
      cur.down = cur.down || b(13) || ay > 0.55;
      cur.left = cur.left || b(14) || ax < -0.55;
      cur.right = cur.right || b(15) || ax > 0.55;
      cur.a = cur.a || b(0);
      cur.b = cur.b || b(1);
      cur.start = cur.start || b(9);
    }
    if (!any) return;
    if (!pad.armed) { pad.prev = cur; pad.armed = true; return; }   // ignore buttons held when a screen opened
    const edge = (k) => cur[k] && !pad.prev[k];
    const now = performance.now();
    for (const d of ['up', 'down', 'left', 'right']) {
      if (edge(d)) { root.classList.add('kbd'); padDir(d); pad.held = d; pad.heldT = now + 380; }
      else if (cur[d] && pad.held === d && now > pad.heldT) { padDir(d); pad.heldT = now + 110; }
    }
    if (edge('a')) { root.classList.add('kbd'); if (curName === 'title') { snd('ui_start'); DEF.title.act('start', null, null, true); } else activate(); }
    if (edge('b')) goBack();
    if (edge('start')) {
      if (curName === 'pause') call('onResume');
      else if (curName === 'title') { snd('ui_start'); DEF.title.act('start', null, null, true); }
      else activate();
    }
    pad.prev = cur;
  };
  pad.raf = requestAnimationFrame(loop);
}
function padDir(d) {
  const S = screens[curName];
  const key = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }[d];
  const f = document.activeElement;
  if (f && f.tagName === 'INPUT' && f.type === 'range' && (d === 'left' || d === 'right')) {
    const step = +f.step || 1;
    f.value = clamp(+f.value + (d === 'right' ? step : -step), +f.min, +f.max);
    f.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  if (S?.def.key && S.def.key(key)) return;
  moveFocus(d);
}
function padStop() { cancelAnimationFrame(pad.raf); pad.raf = 0; }

// ------------------------------------------------------------------ banner & toast
const GLITCH_CH = 'ABCDEFGHJKMNPQRSTUVWXYZ0123456789#%*+<>/';
let bannerTimers = [];
function scramble(el, text, ms) {
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    const n = Math.floor(text.length * k);
    let s = text.slice(0, n);
    for (let i = n; i < text.length; i++) s += text[i] === ' ' ? ' ' : GLITCH_CH[(Math.random() * GLITCH_CH.length) | 0];
    if (k < 1) { el.textContent = s; bannerTimers.push(requestAnimationFrame(step)); }
    else el.innerHTML = numify(text);
  };
  bannerTimers.push(requestAnimationFrame(step));
}

// ------------------------------------------------------------------ public API
export const UI = {
  current: null,

  init(rootEl, handlers) {
    root = rootEl || document.getElementById('ui');
    H = handlers || {};
    root.classList.add('ui-root');
    root.innerHTML = `
      <div class="ui-screens"></div>
      <div class="ui-banner" aria-live="polite" aria-atomic="true">
        <div class="bn-bar bn-top"></div><div class="bn-bar bn-bot"></div>
        <div class="bn-center">
          <div class="bn-line"></div>
          <div class="bn-title"></div>
          <div class="bn-sub"></div>
          <div class="bn-line bn-line2"></div>
        </div>
      </div>
      <div class="ui-toasts" role="status" aria-live="polite"></div>`;
    layer = $(root, '.ui-screens');
    bannerEl = $(root, '.ui-banner');
    toastEl = $(root, '.ui-toasts');

    // Delegated clicks: sound + screen action.
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || !root.contains(b)) return;
      const scr = b.closest('.screen');
      if (!scr || scr.dataset.screen !== curName) return;
      if (b.disabled || b.classList.contains('busy')) { snd('ui_error'); return; }
      if (b.getAttribute('aria-disabled') === 'true') {
        snd('ui_error');
        if (b.dataset.deny) UI.toast(b.dataset.deny, 1800);
        return;
      }
      AudioSys.unlock();
      const s = b.dataset.sfx || 'ui_select';
      if (s !== 'none') snd(s);
      const S = screens[curName];
      if (b.dataset.act === 'back' && S.def.back && !S.def.act) { S.def.back.call(S.def); return; }
      S.def.act && S.def.act.call(S.def, b.dataset.act, b, e);
    });
    // Title link plays its sound too.
    root.addEventListener('pointerdown', (e) => {
      root.classList.remove('kbd');
      const b = e.target.closest('.btn, .hg-tab, .lb-ship, .switch, .seg button, .btn-back, .hg-arrow, .ship-chip, .hg-sec-btn');
      if (b) { b.classList.add('pressed'); const up = () => { b.classList.remove('pressed'); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); }; addEventListener('pointerup', up); addEventListener('pointercancel', up); }
    }, { passive: true });
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('gamepadconnected', () => { if (curName && curName !== 'none') padStart(); });
    applyTypeScale();
    let rz = 0;
    window.addEventListener('resize', () => {
      // DPR can change too (browser zoom, moving the window to another monitor)
      cancelAnimationFrame(rz);
      rz = requestAnimationFrame(() => {
        applyTypeScale();
        repaintPix(root);
        const S = screens[curName];
        if (S) refreshIcons(S.el);
        if (curName === 'lobby') renderLobby(lobbyState.lobby, lobbyState.session);
      });
    });
    // Audio can only start inside a real gesture (gamepad presses don't count): retry on
    // every tap / key until the context runs.
    const unlock = () => { if (!audioRunning()) AudioSys.unlock(); };
    for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, unlock, { capture: true, passive: true });
    // iOS: enables :active styles on touch
    document.addEventListener('touchstart', () => {}, { passive: true });
    this.current = null;
    return this;
  },

  show(name, data) {
    if (!root) return;
    const prev = curName;
    if (prev && screens[prev]) {
      const P = screens[prev];
      P.el.classList.remove('active');
      P.el.setAttribute('aria-hidden', 'true');
      P.def.leave && P.def.leave.call(P.def);
    }
    clearBusy();
    curName = name;
    this.current = name;
    // in-game messages still on screen move over to the HTML toasts
    if (name && name !== 'none' && DEF[name]) for (const t of takeHudToasts()) this.toast(t.text, t.ms);
    if (!name || name === 'none' || !DEF[name]) {
      root.classList.remove('has-screen');
      root.dataset.screen = 'none';
      padStop();
      if (document.activeElement && root.contains(document.activeElement)) document.activeElement.blur();
      if (name && name !== 'none' && !DEF[name]) console.warn('UI: unknown screen', name);
      return;
    }
    let S = screens[name];
    if (!S) {
      const def = DEF[name];
      const el = document.createElement('section');
      el.className = `screen ${def.cls || ''}`;
      el.dataset.screen = name;
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-label', def.label || name);
      el.innerHTML = def.html();
      layer.appendChild(el);
      S = screens[name] = { el, def };
      def.build && def.build.call(def, el);
      stagger(el);
    }
    root.classList.add('has-screen');
    root.dataset.screen = name;
    S.el.removeAttribute('aria-hidden');
    try { S.def.enter && S.def.enter.call(S.def, S.el, data || {}); } catch (e) { console.error('UI screen enter failed', name, e); }
    // restart the entrance animation
    S.el.classList.remove('active');
    void S.el.offsetWidth;
    S.el.classList.add('active');
    const sc = $(S.el, '.scroll');
    if (sc && prev !== name) sc.scrollTop = 0;
    // canvases drawn while the screen was hidden had no CSS size yet
    requestAnimationFrame(() => { if (curName === name) { refreshIcons(S.el); repaintPix(S.el); } });
    if (root.classList.contains('kbd')) setTimeout(() => { if (curName === name) focusFirst(); }, 30);
    else if (document.activeElement && root.contains(document.activeElement)) document.activeElement.blur();
    padStart();
  },

  setLoading(p, label) {
    if (!root) return;
    if (!screens.loading) { const cur = curName; this.show('loading'); if (cur && cur !== 'loading') this.show(cur); }
    const el = screens.loading.el;
    const v = clamp(+p || 0, 0, 1);
    const stepped = Math.round(v * 32) / 32;                    // pixel-stepped fill
    $(el, '.load-fill').style.width = (stepped * 100).toFixed(2) + '%';
    $(el, '.load-glint').style.left = (stepped * 100).toFixed(2) + '%';
    $(el, '.load-pct').textContent = Math.round(v * 100) + '%';
    if (label != null) $(el, '.load-label').textContent = String(label).toUpperCase() + (v < 1 ? '…' : '');
    el.classList.toggle('done', v >= 1);
  },

  updateLobby(lobby, session) {
    if (session) lobbyState.session = session;
    lobbyState.lobby = lobby || lobbyState.lobby;
    if (!screens.lobby) return;                                  // rendered on show
    renderLobby(lobbyState.lobby, lobbyState.session);
  },

  toast(msg, ms = 2400) {
    if (!toastEl || msg == null) return;
    // during play: drawn by the HUD in free space instead of a box over the playfield
    if (curName === 'none') { hudToast(msg, ms); return; }
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = numify(String(msg));
    toastEl.appendChild(t);
    while (toastEl.children.length > 3) toastEl.firstElementChild.remove();
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 320);
    }, Math.max(800, +ms || 2400));
  },

  banner(title, sub, ms = 3000) {
    if (!bannerEl) return;
    bannerTimers.forEach((id) => { clearTimeout(id); cancelAnimationFrame(id); });
    bannerTimers = [];
    const T = String(title || '').toUpperCase();
    const warn = /^WARNING/.test(T);
    const tEl = $(bannerEl, '.bn-title');
    tEl.dataset.text = T;
    tEl.style.setProperty('--len', Math.max(6, T.length));
    $(bannerEl, '.bn-sub').textContent = String(sub || '').toUpperCase();
    bannerEl.classList.toggle('warn', warn);
    bannerEl.classList.remove('show', 'hide');
    void bannerEl.offsetWidth;
    bannerEl.classList.add('show');
    if (reduceMotion()) tEl.innerHTML = numify(T);
    else { tEl.textContent = ''; bannerTimers.push(setTimeout(() => scramble(tEl, T, 520), 240)); }
    const total = Math.max(1200, +ms || 3000);
    bannerTimers.push(setTimeout(() => bannerEl.classList.add('hide'), total - 450));
    bannerTimers.push(setTimeout(() => bannerEl.classList.remove('show', 'hide'), total));
  },

  // Extras (not in the core contract; safe to ignore)
  setLogoFallback(on) {
    const el = root && $(root, '.logo-fallback');
    if (!el) return;
    el.dataset.manual = '1';
    el.classList.toggle('on', !!on);
  },
  back() { return goBack(); },
};

export default UI;
