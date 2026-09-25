// Nova Lancers — in-game canvas HUD, drawn in INTERNAL canvas coordinates (art px).
// Layout adapts to the screen (see DESIGN.md §10):
//   side    — wide screens (R.fx >= 76): arcade side panels left/right of the field
//   strips  — tall phones: top strip above the field (R.fy - safeTop >= 18) and a bottom
//             strip below it (>= 30 px); otherwise the same rows overlay the field edges
//             over a subtle dark gradient.
// The boss bar and WARNING hazard bands always live inside the field.

import { drawText, measureText } from '../art/font.js';
import { FIELD_W, FIELD_H, RULES } from '../config.js';
import { TEAM_HEX, RAMPS } from '../art/palette.js';

let SPR = null;
import('../art/sprites.js').then((m) => { SPR = m; }).catch(() => {});

const INK = '#dfe8f7';
const DIM = '#7c8fb3';
const MUTE = '#526283';
const DARK = '#05040c';
const GOLD = '#ffd966';
const GOLD2 = '#f0a92a';
const WARN = '#ff5a5a';
const MAG = RAMPS.magenta;
const TEAM_HI = ['#79ecff', '#ffd966', '#b8ff6e', '#c9b0ff'];

// Chain multiplier colour escalates with the multiplier.
function chainColor(m) {
  if (m >= 16) return '#ff6fb4';
  if (m >= 8) return '#ffab4f';
  if (m >= 4) return GOLD;
  return INK;
}

// ------------------------------------------------------------------ animated state
// Animation state lives per renderer object (the game has one; the dev bench draws several).
const states = new WeakMap();
const newState = () => ({
  last: 0, t: 0,
  score: 0,
  best: 0, runScore: 0,           // previous best of this run (0 = unknown / first run)
  bossK: 0, bossHp: 1, bossLag: 1, bossName: '', bossPhase: 0, bossFlash: 0,
  chainPop: 0, lastMult: 1,
  lifeFlash: 0, lastLives: -1,
  bombFlash: 0, lastBombs: -1,
  powFlash: 0, lastPower: -1,
  odFull: 0,
  touchT: 0, touch: false, btn: null,
});
let st = newState();

// ------------------------------------------------------------------ in-game messages
// UI.toast() routes here while the game is on screen: crisp outlined text in free HUD space
// (bottom strip / side panel / under the top rows) instead of an opaque box over the field.
const toasts = [];
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
export function hudToast(msg, ms = 1400) {
  const text = String(msg ?? '').replace(/…/g, '...').toUpperCase().trim();
  if (!text) return;
  const hot = /\b(1UP|MAX|REVIVED|EXTEND)\b/.test(text);
  toasts.push({ text, t0: nowMs(), ms: Math.max(900, Math.min(2000, +ms || 1400)), color: hot ? GOLD : INK, hot });
  while (toasts.length > 3) toasts.shift();
}
// Remaining messages (e.g. when a menu opens mid-message) so the UI can show them as HTML.
export function takeHudToasts() {
  const now = nowMs();
  const out = toasts.filter((t) => now - t.t0 < t.ms - 250).map((t) => ({ text: t.text, ms: t.ms - (now - t.t0) }));
  toasts.length = 0;
  return out;
}

// ------------------------------------------------------------------ icons (sprite or fallback)
const iconCache = new Map();
function bmpCanvas(key, rows, pal) {
  let c = iconCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = rows[0].length; c.height = rows.length;
  const g = c.getContext('2d');
  rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) { const col = pal[r[x]]; if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); } } });
  iconCache.set(key, c);
  return c;
}
const LIFE_BMP = ['....o....', '...oTo...', '...oto...', '..osTso..', '.ossssso.', 'ossssssso', 'o.otsto.o', '...oeo...', '....o....'];
const BOMB_BMP = ['.ooooo.', 'orrrrro', 'orwWwro', 'orWWWro', 'orwWwro', 'orrrrro', '.ooooo.'];
const POW_BMP = ['.ooo.', 'oyYyo', 'oYWYo', 'oyYyo', '.ooo.'];
function hasSpr(name) { try { return !!(SPR && SPR.hasSprite(name)); } catch { return false; } }

function drawIcon(ctx, lctx, name, x, y, team, glowA, white) {
  if (hasSpr(name)) {
    SPR.drawSprite(ctx, name, 0, x, y, white ? { team, white: true } : { team });
    if (lctx && glowA > 0) {
      const a = lctx.globalAlpha;
      lctx.globalAlpha = a * glowA;
      SPR.drawSpriteEmissive(lctx, name, 0, x, y, { team });
      lctx.globalAlpha = a;
    }
    return;
  }
  let c;
  if (name === 'ui_life') c = bmpCanvas('life' + team, LIFE_BMP, { o: DARK, s: '#aebfdc', t: TEAM_HEX[team], T: '#ffffff', e: TEAM_HI[team] });
  else if (name === 'ui_bomb') c = bmpCanvas('bomb', BOMB_BMP, { o: DARK, r: '#ec2f86', w: '#ff6fb4', W: '#ffffff' });
  else c = bmpCanvas('pow', POW_BMP, { o: DARK, y: '#f7721f', Y: '#ffab4f', W: '#fff0a8' });
  ctx.drawImage(c, Math.round(x - c.width / 2), Math.round(y - c.height / 2));
}

// ------------------------------------------------------------------ small drawing helpers
function rect(ctx, x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(x | 0, y | 0, w | 0, h | 0); }

// Score: 7 digits, dim leading zeros, lit digits with a soft glow.
function drawScore(ctx, lctx, x, y, value, opt) {
  const s = String(Math.max(0, Math.floor(value))).padStart(7, '0');
  let i = 0;
  while (i < s.length - 1 && s[i] === '0') i++;
  const font = opt.font || 'big', size = opt.size || 1;
  const w = measureText(s, { font, size });
  let x0 = opt.align === 'center' ? Math.round(x - w / 2) : opt.align === 'right' ? x - w : x;
  const zeros = s.slice(0, i), digits = s.slice(i);
  if (zeros) {
    drawText(ctx, zeros, x0, y, { cache: true, font, size, color: MUTE, shadow: DARK, alpha: 0.75 });
    x0 += measureText(zeros, { font, size }) + size;          // + glyph gap
  }
  drawText(ctx, digits, x0, y, { font, size, color: opt.color || INK, shadow: DARK, lctx, glow: opt.glow || '#79ecff', glowAlpha: opt.glowAlpha ?? 0.35 });
}

function bar(ctx, x, y, w, h, k, fill, back) {
  rect(ctx, x - 1, y - 1, w + 2, h + 2, DARK);
  rect(ctx, x, y, w, h, back || '#1a1638');
  const fw = Math.round(w * Math.max(0, Math.min(1, k)));
  if (fw > 0) rect(ctx, x, y, fw, h, fill);
  return fw;
}

// ------------------------------------------------------------------ layout
// Whether the touch buttons are showing, plus their measured edges (CSS px). Re-read from the
// DOM a few times a second: the buttons size themselves to the space under the field.
function touchVisible(R) {
  if (R && R.touchUI != null) return !!R.touchUI;         // explicit override (dev bench)
  const now = st.last;                                    // performance.now() of this frame
  if (now - st.touchT > 400 || st.touchT === 0) {
    st.touchT = now || 1;
    const doc = typeof document !== 'undefined' ? document : null;
    const el = doc ? doc.getElementById('touchControls') : null;
    st.touch = !!el && !el.classList.contains('hidden');
    st.btn = null;
    if (st.touch) {
      const rect = (id) => { const e = doc.getElementById(id); const r = e && e.getBoundingClientRect(); return r && r.width > 0 ? r : null; };
      const n = rect('btnNova'), o = rect('btnOver'), p = rect('btnPause');
      if (n && o) st.btn = { l: n.right, r: o.left, pl: p ? p.left : 0 };
    }
  }
  return st.touch;
}

function layout(R) {
  const safeT = (R.safeArt && R.safeArt.top) | 0;
  const safeB = (R.safeArt && R.safeArt.bottom) | 0;
  const scale = R.scale || 1;
  const L = { safeT, safeB, scale };
  L.side = R.fx >= 76;
  // side-panel text scale: aim for ~20 CSS px small text when the panels have room
  L.sz = L.side && R.fx >= 140 ? Math.max(1, Math.min(2, Math.round(20 / (7 * scale)))) : 1;
  L.topH = R.fy - safeT;
  L.topStrip = !L.side && L.topH >= 18;
  L.botY = R.fy + FIELD_H;
  L.botH = R.H - safeB - L.botY;
  L.botStrip = !L.side && L.botH >= 30;
  const touch = touchVisible(R);
  const b = touch && R.touchUI == null ? st.btn : null;
  L.x0 = R.fx + 4;
  L.x1 = R.fx + FIELD_W - 4;
  L.bx0 = R.fx + 4;
  L.bx1 = R.fx + FIELD_W - 4;
  if (b) {
    // measured: keep the top strip clear of the pause button, the bottom centre column
    // clear of the NOVA / OVERDRIVE buttons
    if (b.pl) L.x1 = Math.min(L.x1, Math.floor((b.pl - 6) / scale));
    L.bx0 = Math.max(L.bx0, Math.ceil((b.l + 6) / scale));
    L.bx1 = Math.min(L.bx1, Math.floor((b.r - 6) / scale));
  } else if (touch) {
    // same sizing rule as css .tbtn: 56..72 px, as large as the space under the field allows
    const below = (R.H - L.botY) * scale, beside = R.fx * scale;
    const size = Math.max(56, Math.min(72, Math.max(below - 14, beside - 20)));
    const btnArt = Math.ceil((14 + size + 6) / scale);
    L.x1 -= Math.max(0, Math.ceil(52 / scale) - (R.W - (R.fx + FIELD_W)));
    L.bx0 = Math.max(L.bx0, btnArt);
    L.bx1 = Math.min(L.bx1, R.W - btnArt);
  }
  return L;
}

// ------------------------------------------------------------------ public
export function drawHUD(ctx, lctx, hud, R) {
  if (!ctx || !hud || !R) return;
  st = states.get(R);
  if (!st) { st = newState(); states.set(R, st); }
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const dt = st.last ? Math.min(0.1, (now - st.last) / 1000) : 1 / 60;
  st.last = now;
  st.t += dt;
  animate(hud, dt);
  const L = layout(R);
  ctx.imageSmoothingEnabled = false;

  if (L.side) drawSide(ctx, lctx, hud, R, L);
  else drawStrips(ctx, lctx, hud, R, L);
  drawBoss(ctx, lctx, hud, R, L);
  if (hud.warning > 0) drawWarning(ctx, lctx, hud.warning, R, L);
  if (hud.downed) drawDowned(ctx, lctx, R);
  if (toasts.length) drawToasts(ctx, lctx, R, L);
}

// Hi-score shown in the HUD. hud.hiScore is max(best, score), so the previous best is only
// known while the score is below it: remember it per run. A record needs a previous best
// above 0 (a first run is not "a new record" from the first kill), and the shown value never
// runs ahead of the rolled-up SCORE.
function hiScore(hud) {
  const score = +hud.score || 0, hi = +hud.hiScore || 0;
  if (score < st.runScore) st.best = 0;                   // new run / continue
  st.runScore = score;
  if (hi > score && hi > st.best) st.best = hi;
  const rec = st.best > 0 && score > st.best;
  return { value: Math.max(st.best, Math.floor(st.score)), rec };
}

function local(hud) {
  const ps = Array.isArray(hud.players) ? hud.players : [];
  return ps.find((p) => p && p.isLocal) || ps[0] || null;
}

function animate(hud, dt) {
  const score = +hud.score || 0;
  if (score < st.score || score - st.score > 5e6) st.score = score;
  else if (score > st.score) st.score = Math.min(score, st.score + Math.max(7, (score - st.score) * Math.min(1, dt * 14)));

  const mult = chainMult(hud);
  if (mult > st.lastMult) st.chainPop = 1;
  st.lastMult = mult;
  st.chainPop = Math.max(0, st.chainPop - dt * 5);

  const me = local(hud);
  const lives = me ? me.lives | 0 : 0;
  if (st.lastLives >= 0 && lives < st.lastLives) st.lifeFlash = 1.2;
  st.lastLives = lives;
  st.lifeFlash = Math.max(0, st.lifeFlash - dt);

  const bombs = hud.bombs | 0;
  if (st.lastBombs >= 0 && bombs !== st.lastBombs) st.bombFlash = 0.8;
  st.lastBombs = bombs;
  st.bombFlash = Math.max(0, st.bombFlash - dt);

  const pow = hud.power | 0;
  if (st.lastPower >= 0 && pow > st.lastPower) st.powFlash = 0.8;
  st.lastPower = pow;
  st.powFlash = Math.max(0, st.powFlash - dt);

  st.odFull = (hud.overdrive >= 1 && !hud.overdriveActive) ? st.odFull + dt : 0;

  const b = hud.boss;
  if (b) {
    if (b.name) st.bossName = String(b.name).toUpperCase();
    st.bossPhase = b.phase | 0;
    const hp = Math.max(0, Math.min(1, +b.hp || 0));
    if (hp < st.bossHp - 0.001) st.bossFlash = 0.12;
    if (st.bossK <= 0.01) st.bossLag = hp;
    st.bossHp = hp;
    st.bossK = Math.min(1, st.bossK + dt * 2.2);
  } else {
    st.bossK = Math.max(0, st.bossK - dt * 1.6);
  }
  st.bossFlash = Math.max(0, st.bossFlash - dt);
  // damage trail catches up after a short delay
  if (st.bossLag > st.bossHp) st.bossLag = Math.max(st.bossHp, st.bossLag - dt * (0.08 + (st.bossLag - st.bossHp) * 1.6));
  else st.bossLag = st.bossHp;
}

function chainMult(hud) {
  const m = hud.chainMult != null ? +hud.chainMult : +hud.chain || 1;
  return Math.max(1, Math.min(RULES.chainMax || 16, Math.floor(m)));
}
function chainT(hud) {
  let t = +hud.chainTimer || 0;
  if (t > 1.0001) t /= RULES.chainWindow || 1.5;           // seconds -> 0..1
  return Math.max(0, Math.min(1, t));
}

// ------------------------------------------------------------------ strips (phones)
function drawStrips(ctx, lctx, hud, R, L) {
  const me = local(hud);
  const team = me ? me.slot & 3 : 0;
  const coop = Array.isArray(hud.players) && hud.players.length > 1;
  const cx = R.fx + (FIELD_W >> 1);

  // --- top rows. Modes by available strip height:
  //   tall (>= 28): labels + score, second row below     compact (>= 21): no labels, two tight rows
  //   short (>= 18): first row in the strip, second row overlays the field top
  //   overlay (< 18): both rows overlay the field top over a dark gradient
  const topH = L.topStrip ? L.topH : 0;
  // strips: darken toward the screen edges so the HUD reads over busy backgrounds, and a faint
  // rule marks where the playfield starts / ends
  if (L.topStrip) {
    shade(ctx, 0, 0, R.W, R.fy, true);
    rect(ctx, R.fx, R.fy - 1, FIELD_W, 1, 'rgba(121,236,255,0.10)');
  }
  if (L.botStrip) {
    shade(ctx, 0, L.botY, R.W, R.H - L.botY, false);
    rect(ctx, R.fx, L.botY, FIELD_W, 1, 'rgba(121,236,255,0.10)');
  }
  const mode = topH >= 28 ? 'tall' : topH >= 21 ? 'compact' : topH >= 18 ? 'short' : 'overlay';
  const labels = mode === 'tall' || mode === 'overlay';
  let y0;
  if (mode === 'overlay') {
    y0 = R.fy + 3;
    shade(ctx, R.fx, R.fy, FIELD_W, 36, true);
    L.fieldTop = 30;
  } else {
    const need = mode === 'tall' ? 27 : mode === 'compact' ? 21 : 9;
    y0 = L.safeT + Math.max(1, Math.floor((topH - need) / 2));
    L.fieldTop = mode === 'short' ? 14 : 0;
  }
  const sy = labels ? y0 + 7 : y0;                       // score row
  if (labels) drawText(ctx, 'SCORE', cx, y0, { cache: true, font: 'tiny', color: DIM, align: 'center' });
  drawScore(ctx, lctx, cx, sy, st.score, { align: 'center', font: 'big' });

  // lives (left)
  drawLives(ctx, lctx, me, L.x0, labels ? y0 + 2 : y0, team, 1);
  // hi-score (right). Changing numbers are drawn glyph by glyph (cache: false) so they
  // never churn the string cache.
  const hi = hiScore(hud);
  const newHi = hi.rec;
  const hiStr = String(hi.value).padStart(7, '0');
  const hiW = measureText(hiStr, { font: 'small' });
  if (labels) {
    drawText(ctx, newHi ? 'HI ★' : 'HI', L.x1, y0, { cache: true, font: 'tiny', color: newHi ? GOLD : DIM, align: 'right' });
    drawText(ctx, hiStr, L.x1 - hiW, y0 + 7, { font: 'small', color: newHi ? GOLD : INK, shadow: DARK });
  } else {
    drawText(ctx, hiStr, L.x1 - hiW, y0 + 1, { font: 'small', color: newHi ? GOLD : INK, shadow: DARK });
    drawText(ctx, newHi ? '★' : 'HI', L.x1 - hiW - 3, y0 + 2, { cache: true, font: 'tiny', color: newHi ? GOLD : DIM, align: 'right' });
  }

  // second row: bombs (left), chain (centre); power pips go right when there is room
  let rowB = mode === 'tall' || mode === 'overlay' ? y0 + 19 : y0 + 11;
  if (mode === 'short') { rowB = R.fy + 3; shade(ctx, R.fx, R.fy, FIELD_W, 16, true); }
  drawBombs(ctx, lctx, hud, L.x0 + 3, rowB + 3, 1);
  drawChain(ctx, lctx, hud, cx, rowB, 1);
  const powerTop = !L.botStrip && L.x1 >= R.fx + FIELD_W - 8;
  if (powerTop) drawPower(ctx, lctx, hud, L.x1, rowB + 1, 'right', 1);
  if (hud.fps) drawText(ctx, Math.round(hud.fps) + 'FPS', R.fx + 3, R.fy + FIELD_H - 8, { font: 'tiny', color: DIM });

  if (L.botStrip) {
    // bottom strip (centre column between the touch buttons): power + overdrive, then roster
    const bx0 = L.bx0, bx1 = L.bx1, bw = bx1 - bx0;
    let by = L.botY + (L.botH >= 60 ? 6 : 4);
    const pw = drawPower(ctx, lctx, hud, bx0 + 14, by, 'left', 1);
    drawOverdrive(ctx, lctx, hud, bx0, by, bw, 1, { labelRight: true, labelW: bw - pw - 20 });
    by += 16;
    if (coop) {
      const n = hud.players.length;
      const room = L.botY + L.botH - by;
      let cols = bw >= 150 ? 2 : 1;
      if (Math.ceil(n / cols) * 10 > room) cols = 2;
      if (Math.ceil(n / cols) * 10 <= room + 3) { drawRoster(ctx, lctx, hud, bx0, by, bw, cols, 1); by += Math.ceil(n / cols) * 10; }
      else { drawRoster(ctx, lctx, hud, R.fx + 4, R.fy + (L.fieldTop || 0) + 4, 116, 1, 1, true); L.fieldTop = (L.fieldTop || 0) + n * 10 + 4; }
    }
    // messages use whatever is left of the strip
    const lines = Math.floor((L.botY + L.botH - 2 - (by + 2)) / 10);
    if (lines >= 1) L.toast = { x: (bx0 + bx1) >> 1, y: by + 2, w: bw, align: 'center', s: 1, lines };
  } else {
    // no bottom strip: meters overlay the bottom of the field, roster under the top rows
    const fyB = R.fy + FIELD_H;
    shade(ctx, R.fx, fyB - 18, FIELD_W, 18, false);
    const mx0 = L.bx0, mx1 = L.bx1;
    const ox = mx0, ow = mx1 - mx0;
    if (!powerTop) drawPower(ctx, lctx, hud, mx0 + 14, fyB - 16, 'left', 1);
    drawOverdrive(ctx, lctx, hud, ox, fyB - 16, ow, 1, { labelRight: true, labelW: powerTop ? ow : ow - 70 });
    if (coop) { drawRoster(ctx, lctx, hud, R.fx + 4, R.fy + (L.fieldTop || 0) + 4, 116, 1, 1, true); L.fieldTop = (L.fieldTop || 0) + hud.players.length * 10 + 4; }
  }
}

// dark gradient behind overlaid HUD rows so they read over the playfield
const shadeCache = new Map();
function shade(ctx, x, y, w, h, fromTop) {
  const key = `${y}|${h}|${fromTop ? 1 : 0}`;
  let g = shadeCache.get(key);
  if (!g) {
    g = ctx.createLinearGradient(0, y, 0, y + h);
    const a = 'rgba(5,4,12,0.62)', b = 'rgba(5,4,12,0)';
    g.addColorStop(0, fromTop ? a : b);
    g.addColorStop(1, fromTop ? b : a);
    if (shadeCache.size > 16) shadeCache.clear();
    shadeCache.set(key, g);
  }
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

// ------------------------------------------------------------------ components
function drawLives(ctx, lctx, me, x, y, team, s) {
  const lives = me ? Math.max(0, me.lives | 0) : 0;
  const blink = st.lifeFlash > 0 && ((st.t * 10) | 0) % 2 === 0;
  if (me && (me.beacon || me.alive === false) && lives <= 0) {
    drawText(ctx, me.beacon ? 'SOS' : 'DOWN', x, y + 1, { cache: true, font: 'small', size: s, color: WARN, shadow: DARK, alpha: ((st.t * 3) | 0) % 2 ? 1 : 0.4 });
    return;
  }
  const shown = Math.min(lives, 4);
  withScale(ctx, s, x, y, (ox, oy) => {
    // just lost one: the lost icon flickers out in red
    if (blink && st.lastLives < 4) drawIcon(ctx, null, 'ui_life', ox + 4 + shown * 10, oy + 4, team, 0, true);
    for (let i = 0; i < shown; i++) drawIcon(ctx, null, 'ui_life', ox + 4 + i * 10, oy + 4, team, 0);
    if (lives > 4) drawText(ctx, '×' + lives, ox + 4 * 10, oy + 1, { cache: true, font: 'small', color: INK, shadow: DARK });
    if (lives === 0 && !blink) drawText(ctx, '×0', ox, oy + 1, { cache: true, font: 'small', color: WARN, shadow: DARK });
  });
}

function drawBombs(ctx, lctx, hud, x, y, s) {
  const n = Math.max(0, hud.bombs | 0);
  const glowA = st.bombFlash > 0 ? 0.35 + 0.65 * Math.abs(Math.sin(st.bombFlash * 14)) : 0.3;
  withScale(ctx, s, x, y, (ox, oy) => {
    if (n === 0) { drawText(ctx, 'NO NOVA', ox - 3, oy - 2, { cache: true, font: 'tiny', color: DIM }); return; }
    const shown = Math.min(n, 5);
    for (let i = 0; i < shown; i++) drawIcon(ctx, s === 1 ? lctx : null, 'ui_bomb', ox + i * 8, oy, 0, glowA);
    if (n > 5) drawText(ctx, '+' + (n - 5), ox + 5 * 8 - 3, oy - 3, { cache: true, font: 'tiny', color: INK });
  });
}

// Power pips (8). align 'right': pips end at x, label left of them; 'left': pips start at x,
// label left of x. Returns the total width drawn (label + pips).
function drawPower(ctx, lctx, hud, x, y, align, s) {
  const max = Math.max(1, hud.powerMax | 0 || RULES.powerMax || 8);
  const p = Math.max(0, Math.min(max, hud.power | 0));
  const full = p >= max;
  const w = max * 6 - 1;
  const x0 = align === 'right' ? x - w * s : x;
  withScale(ctx, s, x0, y, (ox, oy) => {
    for (let i = 0; i < max; i++) {
      const px = ox + i * 6;
      if (i < p) drawIcon(ctx, s === 1 ? lctx : null, 'ui_power', px + 2, oy + 2, 0, full ? 0.9 : 0.35);
      else { rect(ctx, px + 1, oy + 1, 3, 3, '#1a1638'); rect(ctx, px + 2, oy + 2, 1, 1, MUTE); }
    }
  });
  const label = full ? 'MAX' : 'PWR';
  const lcol = full ? (((st.t * 4) | 0) % 2 ? GOLD : '#ffab4f') : DIM;
  const lw = measureText(label, { font: 'tiny', size: s });
  drawText(ctx, label, x0 - 3 * s, y, { cache: true, font: 'tiny', size: s, color: lcol, align: 'right', lctx: full ? lctx : null, glow: GOLD2, glowAlpha: 0.6 });
  if (st.powFlash > 0 && lctx) {
    lctx.globalAlpha = st.powFlash;
    const i = Math.max(0, p - 1);
    rect(lctx, x0 + i * 6 * s, y, 5 * s, 5 * s, '#ffab4f');
    lctx.globalAlpha = 1;
  }
  return w * s + lw + 3 * s;
}

function drawChain(ctx, lctx, hud, cx, y, s) {
  const m = chainMult(hud);
  if (m <= 1) return;
  const col = chainColor(m);
  const pop = st.chainPop;
  const str = '×' + m;
  const w = measureText(str, { font: 'small', size: s });
  const lw = measureText('CHAIN', { font: 'tiny', size: s });
  const total = w + 3 * s + lw;
  const x = Math.round(cx - total / 2);
  drawText(ctx, str, x, y - (pop > 0.5 ? s : 0), { cache: true, font: 'small', size: s, color: pop > 0.6 ? '#ffffff' : col, shadow: DARK, lctx, glow: col, glowAlpha: 0.5 + pop * 0.5 });
  drawText(ctx, 'CHAIN', x + w + 3 * s, y + 2 * s, { cache: true, font: 'tiny', size: s, color: DIM });
  // draining timer bar
  const k = chainT(hud);
  const bw = Math.max(20, total);
  const by = y + 9 * s;
  rect(ctx, x, by, bw, s, '#1a1638');
  const fw = Math.round(bw * k);
  if (fw > 0) {
    rect(ctx, x, by, fw, s, k < 0.3 && ((st.t * 12) | 0) % 2 ? WARN : col);
    if (lctx) { lctx.globalAlpha = 0.6; rect(lctx, x, by, fw, s, col); lctx.globalAlpha = 1; }
  }
}

// Overdrive meter. opt.labelRight: status text right-aligned on the first row (sharing it
// with the power pips) and the bar underneath; otherwise label left + percentage right.
function drawOverdrive(ctx, lctx, hud, x, y, w, s, opt = {}) {
  const k = Math.max(0, Math.min(1, +hud.overdrive || 0));
  const active = !!hud.overdriveActive;
  const full = k >= 1 && !active;
  const h = 4 * s;
  const blink = ((st.t * (active ? 8 : 3)) | 0) % 2 === 1;
  let label, lcol;
  if (active) { label = 'OVERDRIVE ×2'; lcol = blink ? '#ffffff' : GOLD; }
  else if (full) { label = 'OVERDRIVE READY'; lcol = blink ? GOLD : '#ffffff'; }
  else { label = 'OVERDRIVE ' + Math.floor(k * 100) + '%'; lcol = DIM; }
  const glowTxt = full || active;
  if (opt.labelRight) {
    const maxW = opt.labelW || w;
    if (measureText(label, { font: 'tiny', size: s }) > maxW) label = active ? 'OD ×2' : full ? 'OD READY' : 'OD ' + Math.floor(k * 100) + '%';
    drawText(ctx, label, x + w, y + s, { cache: glowTxt, font: 'tiny', size: s, color: lcol, align: 'right', lctx: glowTxt ? lctx : null, glow: GOLD2, glowAlpha: 0.7 });
  } else {
    drawText(ctx, label, x, y, { cache: glowTxt, font: 'tiny', size: s, color: lcol, lctx: glowTxt ? lctx : null, glow: GOLD2, glowAlpha: 0.7 });
  }
  const by = y + 9 * s;
  const fillK = active ? (hud.overdriveLeft != null ? +hud.overdriveLeft : 1) : k;
  const pulse = full ? 0.5 + 0.5 * Math.sin(st.odFull * 7) : 0;
  const fill = active ? (((st.t * 16) | 0) % 2 ? '#fff5c9' : GOLD) : full ? (pulse > 0.5 ? '#fff5c9' : GOLD) : GOLD2;
  const fw = bar(ctx, x, by, w, h, fillK, fill, '#231c10');
  for (let i = 1; i < 10; i++) rect(ctx, x + Math.round((w * i) / 10), by, 1, h, 'rgba(5,4,12,0.55)');
  if (fw > 1) rect(ctx, x, by, fw, s, 'rgba(255,255,255,0.45)');
  // travelling shine while charging
  if (!full && !active && fw > 6) {
    const sx = x + Math.round(((st.t * 40) % (fw + 20)) - 10);
    if (sx >= x && sx < x + fw) rect(ctx, sx, by, 2 * s, h, 'rgba(255,245,201,0.55)');
  }
  if (lctx && fw > 0) {
    lctx.globalAlpha = active ? 0.85 : full ? 0.35 + pulse * 0.5 : 0.2;
    rect(lctx, x, by, fw, h, full || active ? GOLD : GOLD2);
    lctx.globalAlpha = 1;
  }
}

// Co-op roster: team pip, name, lives, state (SOS beacon / down), link / ping bars.
// Extras are dropped (link tag, then ping bars) before the name gets truncated too hard.
function drawRoster(ctx, lctx, hud, x, y, w, cols, s, overlay) {
  const ps = (Array.isArray(hud.players) ? hud.players : []).slice().sort((a, b) => (a.slot | 0) - (b.slot | 0));
  const cw = Math.floor(w / cols);
  const rowH = 10 * s;
  if (overlay) shade(ctx, x - 4, y - 2, cw * cols + 8, Math.ceil(ps.length / cols) * rowH + 4, true);
  const blinkOn = ((st.t * 4) | 0) % 2 === 0;
  const gap = cols > 1 ? 6 * s : 0;
  ps.forEach((p, i) => {
    const cx = x + (i % cols) * cw, cy = y + Math.floor(i / cols) * rowH;
    const team = p.slot & 3;
    const col = TEAM_HI[team];
    const sos = !!p.beacon;
    const dead = !sos && p.alive === false && (p.lives | 0) <= 0;
    rect(ctx, cx, cy, 2 * s, 7 * s, sos ? (blinkOn ? WARN : col) : dead ? MUTE : TEAM_HEX[team]);
    if (lctx && !dead) { lctx.globalAlpha = sos && blinkOn ? 0.8 : 0.4; rect(lctx, cx, cy, 2 * s, 7 * s, sos && blinkOn ? WARN : TEAM_HEX[team]); lctx.globalAlpha = 1; }
    const rx = cx + cw - gap - s;
    const nameX = cx + 4 * s;
    // right side first
    let right;
    if (sos) right = measureText('SOS', { font: 'tiny', size: s });
    else right = measureText('♥' + Math.max(0, p.lives | 0), { font: 'tiny', size: s });
    const nameRaw = String(p.name || 'P' + (team + 1)).toUpperCase();
    const fullNameW = measureText(nameRaw.slice(0, 10), { font: 'small', size: s });
    let extra = '';
    if (!sos) {
      if (p.isLocal && hud.net) extra = 'tag';
      else if (!p.isLocal && p.ping > 0) extra = 'bars';
    }
    const extraW = extra === 'tag' ? measureText(hud.net.kind === 'relay' ? 'RELAY' : 'P2P', { font: 'tiny', size: s }) + 4 * s : extra === 'bars' ? 9 * s : 0;
    if (extra && nameX + Math.min(fullNameW, 36 * s) + 4 * s + extraW + right > rx) extra = '';
    const room = rx - nameX - right - (extra ? extraW : 0) - 4 * s;
    let nm = nameRaw.slice(0, 10);
    while (nm.length > 2 && measureText(nm, { font: 'small', size: s }) > room) nm = nm.slice(0, -1);
    drawText(ctx, nm, nameX, cy, { cache: true, font: 'small', size: s, color: dead ? MUTE : p.isLocal ? '#ffffff' : col, shadow: DARK });
    if (sos) {
      drawText(ctx, 'SOS', rx, cy + s, { cache: true, font: 'tiny', size: s, color: WARN, align: 'right', alpha: blinkOn ? 1 : 0.35, lctx, glow: WARN, glowAlpha: 0.7 });
      return;
    }
    drawText(ctx, '♥' + Math.max(0, p.lives | 0), rx, cy + s, { cache: true, font: 'tiny', size: s, color: dead ? MUTE : INK, align: 'right' });
    if (extra === 'tag') {
      drawText(ctx, hud.net.kind === 'relay' ? 'RELAY' : 'P2P', rx - right - 4 * s, cy + s, { cache: true, font: 'tiny', size: s, color: hud.net.kind === 'relay' ? GOLD2 : MUTE, align: 'right' });
    } else if (extra === 'bars') {
      const pc = p.ping < 90 ? '#6fd23f' : p.ping < 180 ? GOLD : WARN;
      const bars = p.ping < 90 ? 3 : p.ping < 180 ? 2 : 1;
      const bx = rx - right - 9 * s;
      for (let b = 0; b < 3; b++) rect(ctx, bx + b * 2 * s, cy + (5 - (b + 1) * 2) * s + s, s, (b + 1) * 2 * s - s, b < bars ? pc : '#252050');
    }
  });
}

function drawNet(ctx, hud, x, y, align, size = 1) {
  let s = '';
  if (hud.net) {
    const kind = hud.net.kind === 'relay' ? 'RELAY' : hud.net.kind === 'mixed' ? 'MIX' : 'P2P';
    s = kind + (hud.net.ping > 0 ? ' ' + Math.round(hud.net.ping) + 'MS' : '');
  }
  if (hud.fps) s = (s ? s + ' · ' : '') + Math.round(hud.fps) + 'FPS';
  if (!s) return;
  const col = hud.net && hud.net.ping > 180 ? WARN : hud.net && hud.net.ping > 90 ? GOLD : DIM;
  drawText(ctx, s, x, y, { font: 'tiny', size, color: col, align });
}

// ------------------------------------------------------------------ side panels (wide screens)
function drawSide(ctx, lctx, hud, R, L) {
  const s = L.sz;
  const me = local(hud);
  const team = me ? me.slot & 3 : 0;
  const bigS = Math.min(3, 9 * (s + 1) * (L.scale || 1) <= 44 ? s + 1 : s);
  const hi = hiScore(hud);
  // panel width follows the real digit count (4-player runs can pass 9,999,999)
  const digits = Math.max(7, String(Math.floor(Math.max(+hud.score || 0, hi.value))).length);
  const scoreW = measureText('0'.repeat(digits), { font: 'big', size: bigS });
  const pw = Math.max(scoreW, 64 * s);
  const gap = 10 * s;
  const pad = 6 * s;
  const lx = Math.max(4 + pad, R.fx - pw - 12 * s - pad);
  const rx = R.fx + FIELD_W + 12 * s + pad;
  const top = R.fy + 8 * s;
  const lab = (str, x, yy, col) => drawText(ctx, str, x, yy, { cache: true, font: 'tiny', size: s, color: col || DIM });
  const coop = Array.isArray(hud.players) && hud.players.length > 1;

  // backing panels (heights mirror the rows below)
  const leftH = 7 * s + 9 * bigS + gap + 14 * s + gap + 20 * s + gap + (hud.sector ? 14 * s : -gap);
  let rightH = 17 * s + gap + 15 * s + gap + 13 * s + gap + 13 * s;
  if (coop) rightH += gap + 8 * s + hud.players.length * 10 * s;
  if (hud.net || hud.fps) rightH += gap + 5 * s;
  sidePanel(ctx, lctx, lx - pad, top - pad, pw + pad * 2, leftH + pad * 2, team, s);
  sidePanel(ctx, lctx, rx - pad, top - pad, pw + pad * 2 + 8 * s, rightH + pad * 2, team, s);
  // messages go under the left panel
  const ty = top + leftH + pad + gap;
  const tl = Math.floor((R.H - (L.safeB || 0) - 4 - ty) / (10 * s));
  if (tl >= 1) L.toast = { x: lx - pad, y: ty, w: Math.max(pw + pad * 2, R.fx - 8 - (lx - pad)), align: 'left', s, lines: tl };

  // left: score, hi, chain, sector
  let y = top;
  lab('SCORE', lx, y);
  drawScore(ctx, lctx, lx, y + 7 * s, st.score, { align: 'left', font: 'big', size: bigS });
  y += 7 * s + 9 * bigS + gap;
  const newHi = hi.rec;
  lab(newHi ? 'HI-SCORE ★' : 'HI-SCORE', lx, y, newHi ? GOLD : DIM);
  drawText(ctx, String(hi.value).padStart(7, '0'), lx, y + 7 * s, { font: 'small', size: s, color: newHi ? GOLD : INK, shadow: DARK });
  y += 7 * s + 7 * s + gap;
  const m = chainMult(hud);
  lab('CHAIN', lx, y);
  const col = chainColor(m);
  drawText(ctx, '×' + m, lx, y + 7 * s - (st.chainPop > 0.5 ? s : 0), { cache: true, font: 'big', size: s, color: m > 1 ? (st.chainPop > 0.6 ? '#ffffff' : col) : MUTE, shadow: DARK, lctx: m > 1 ? lctx : null, glow: col, glowAlpha: 0.5 + st.chainPop * 0.5 });
  const by = y + 7 * s + 11 * s;
  const k = m > 1 ? chainT(hud) : 0;
  rect(ctx, lx, by, pw, 2 * s, '#1a1638');
  if (k > 0) {
    rect(ctx, lx, by, Math.round(pw * k), 2 * s, k < 0.3 && ((st.t * 12) | 0) % 2 ? WARN : col);
    if (lctx) { lctx.globalAlpha = 0.5; rect(lctx, lx, by, Math.round(pw * k), 2 * s, col); lctx.globalAlpha = 1; }
  }
  y = by + 2 * s + gap;
  if (hud.sector) {
    lab('SECTOR ' + hud.sector, lx, y);
    if (hud.sectorName) drawText(ctx, String(hud.sectorName).toUpperCase(), lx, y + 7 * s, { cache: true, font: 'small', size: s, color: TEAM_HI[team] });
  }

  // right: lives, nova, power, overdrive, squad, net
  y = top;
  lab('LIVES', rx, y);
  drawLives(ctx, lctx, me, rx, y + 7 * s, team, s);
  y += 17 * s + gap;
  lab('NOVA', rx, y);
  drawBombs(ctx, lctx, hud, rx + 3 * s, y + 10 * s, s);
  y += 15 * s + gap;
  lab('POWER', rx, y);
  drawPowerSide(ctx, lctx, hud, rx, y + 7 * s, s);
  y += 13 * s + gap;
  drawOverdrive(ctx, lctx, hud, rx, y, pw + 8 * s, s);
  y += 13 * s;
  if (coop) {
    y += gap;
    lab('SQUAD', rx, y);
    drawRoster(ctx, lctx, hud, rx, y + 8 * s, pw + 8 * s, 1, s);
    y += 8 * s + hud.players.length * 10 * s;
  }
  if (hud.net || hud.fps) drawNet(ctx, hud, rx, y + gap, 'left', s);
}

// Translucent HUD panel with pixel corner brackets in the local team colour.
function sidePanel(ctx, lctx, x, y, w, h, team, s) {
  rect(ctx, x, y, w, h, 'rgba(5,4,12,0.58)');
  const c = 'rgba(121,236,255,0.14)';
  rect(ctx, x, y, w, 1, c); rect(ctx, x, y + h - 1, w, 1, c);
  rect(ctx, x, y, 1, h, c); rect(ctx, x + w - 1, y, 1, h, c);
  const t = TEAM_HEX[team], L = 6 * s, T = s;
  rect(ctx, x, y, L, T, t); rect(ctx, x, y, T, L, t);
  rect(ctx, x + w - L, y + h - T, L, T, t); rect(ctx, x + w - T, y + h - L, T, L, t);
  if (lctx) {
    lctx.globalAlpha = 0.35;
    rect(lctx, x, y, L, T, t); rect(lctx, x, y, T, L, t);
    rect(lctx, x + w - L, y + h - T, L, T, t); rect(lctx, x + w - T, y + h - L, T, L, t);
    lctx.globalAlpha = 1;
  }
}

function drawPowerSide(ctx, lctx, hud, x, y, s) {
  const max = Math.max(1, hud.powerMax | 0 || RULES.powerMax || 8);
  const p = Math.max(0, Math.min(max, hud.power | 0));
  withScale(ctx, s, x, y, (ox, oy) => {
    for (let i = 0; i < max; i++) {
      const px = ox + i * 6;
      if (i < p) drawIcon(ctx, s === 1 ? lctx : null, 'ui_power', px + 2, oy + 2, 0, p >= max ? 0.9 : 0.4);
      else { rect(ctx, px + 1, oy + 1, 3, 3, '#1a1638'); rect(ctx, px + 2, oy + 2, 1, 1, MUTE); }
    }
  });
  if (p >= max) drawText(ctx, 'MAX', x + max * 6 * s + 2 * s, y, { cache: true, font: 'tiny', size: s, color: ((st.t * 4) | 0) % 2 ? GOLD : '#ffab4f', lctx, glow: GOLD2, glowAlpha: 0.6 });
}

// Draw a group at an integer scale (for icons on wide screens) without blurring.
function withScale(ctx, s, x, y, fn) {
  if (s === 1) { fn(x, y); return; }
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  fn(0, 0);
  ctx.restore();
}

// ------------------------------------------------------------------ boss bar (inside the field)
function drawBoss(ctx, lctx, hud, R, L) {
  if (st.bossK <= 0) return;
  const k = st.bossK;
  const e = 1 - Math.pow(1 - k, 3);
  // text scale: follow the side-panel scale on wide/landscape screens when the name still fits
  let s = L.side ? L.sz : 1;
  if (s > 1 && measureText(st.bossName || 'BOSS', { font: 'small', size: s }) > FIELD_W - 18) s = 1;
  const baseY = R.fy + 4 + (L.side ? 0 : L.fieldTop || 0);
  const y = Math.round(baseY - (1 - e) * 24 * s);
  const x = R.fx + 8, w = FIELD_W - 16;
  const a0 = ctx.globalAlpha;
  // slide in/out from under the top edge of the free field area
  ctx.save();
  ctx.beginPath();
  ctx.rect(R.fx - 4, baseY - 4, FIELD_W + 8, FIELD_H);
  ctx.clip();
  ctx.globalAlpha = a0 * Math.min(1, k * 1.5);
  shade(ctx, R.fx, y - 3, FIELD_W, 14 + 6 * s + 4, true);
  const low = st.bossHp < 0.25 && hud.boss;
  drawText(ctx, st.bossName || 'BOSS', x, y, { cache: true, font: 'small', size: s, color: low && ((st.t * 6) | 0) % 2 ? '#ffffff' : '#ffc4e1', shadow: DARK, lctx: e > 0.92 ? lctx : null, glow: MAG[3], glowAlpha: 0.45 });
  if (st.bossPhase > 0) {
    const ph = 'PHASE ' + (st.bossPhase + 1);
    const room = w - measureText(st.bossName || 'BOSS', { font: 'small', size: s }) - 6 * s;
    if (measureText(ph, { font: 'tiny', size: s }) <= room) drawText(ctx, ph, x + w, y + s, { cache: true, font: 'tiny', size: s, color: MAG[4], align: 'right' });
    else if (measureText('P' + (st.bossPhase + 1), { font: 'tiny', size: s }) <= room) drawText(ctx, 'P' + (st.bossPhase + 1), x + w, y + s, { cache: true, font: 'tiny', size: s, color: MAG[4], align: 'right' });
  }
  const by = y + 9 * s, h = 3 + 2 * s;
  rect(ctx, x - 1, by - 1, w + 2, h + 2, DARK);
  rect(ctx, x, by, w, h, '#2a0a1c');
  const lagW = Math.round(w * st.bossLag), hpW = Math.round(w * st.bossHp);
  if (lagW > hpW) rect(ctx, x + hpW, by, lagW - hpW, h, '#ffe3f0');
  if (hpW > 0) {
    rect(ctx, x, by, hpW, h, st.bossFlash > 0 ? '#ffffff' : MAG[3]);
    rect(ctx, x, by, hpW, 1, MAG[5]);
    rect(ctx, x, by + h - 1, hpW, 1, MAG[1]);
  }
  for (let i = 1; i < 10; i++) rect(ctx, x + Math.round((w * i) / 10), by + 1, 1, h - 2, 'rgba(5,4,12,0.6)');
  // end caps
  rect(ctx, x - 3, by - 2, 2, h + 4, MAG[4]);
  rect(ctx, x + w + 1, by - 2, 2, h + 4, MAG[4]);
  if (lctx && hpW > 0 && e > 0.92) {
    lctx.globalAlpha = (0.55 + (low ? 0.4 * Math.abs(Math.sin(st.t * 8)) : 0)) * Math.min(1, k * 1.5);
    rect(lctx, x, by, hpW, h, MAG[3]);
    lctx.globalAlpha = 1;
  }
  ctx.globalAlpha = a0;
  ctx.restore();
}

// ------------------------------------------------------------------ WARNING hazard bands
// One pre-rendered hazard band (dark backing + slanted stripes, period 8 px). Drawing a
// FIELD_W window of it at a moving offset scrolls the stripes with a single drawImage.
let warnBand = null;
function hazardBand() {
  if (warnBand) return warnBand;
  const c = document.createElement('canvas');
  c.width = FIELD_W + 8; c.height = 9;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(5,4,12,0.8)';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = WARN;
  for (let x0 = -8; x0 < c.width; x0 += 8) for (let r = 0; r < 7; r++) g.fillRect(x0 + r, 1 + r, 4, 1);
  warnBand = c;
  return c;
}

function drawWarning(ctx, lctx, w, R, L) {
  const t = st.t;
  const k = Math.max(0, Math.min(1, w));
  const env = Math.min(1, k * 4) * Math.min(1, (1 - k) * 6 + 0.25);
  const blink = 0.55 + 0.45 * Math.sin(t * 12);
  const a = env * blink;
  if (a <= 0.01) return;
  const x = R.fx, y1 = R.fy + Math.max(56, (L && !L.side ? L.fieldTop || 0 : 0) + 36), y2 = R.fy + FIELD_H - 118;
  const bandH = 7;
  const off = (t * 28) | 0;
  const src = (8 - (off % 8)) % 8;
  const band = hazardBand();
  const a0 = ctx.globalAlpha;
  for (const by of [y1, y2]) {
    ctx.globalAlpha = a0 * a;
    ctx.drawImage(band, src, 0, FIELD_W, 9, x, by - 1, FIELD_W, 9);
    if (lctx) { lctx.globalAlpha = a * 0.35; rect(lctx, x, by, FIELD_W, bandH, WARN); }
  }
  // red edge pulse
  ctx.globalAlpha = a0 * a * 0.8;
  rect(ctx, x, R.fy, 2, FIELD_H, WARN);
  rect(ctx, x + FIELD_W - 2, R.fy, 2, FIELD_H, WARN);
  if (lctx) {
    lctx.globalAlpha = a * 0.5;
    rect(lctx, x, R.fy, 3, FIELD_H, WARN);
    rect(lctx, x + FIELD_W - 3, R.fy, 3, FIELD_H, WARN);
    lctx.globalAlpha = 1;
  }
  ctx.globalAlpha = a0;
}

// Local pilot downed in co-op: a calm, readable prompt across the middle of the field.
function drawDowned(ctx, lctx, R) {
  const cx = R.fx + (FIELD_W >> 1), y = R.fy + (FIELD_H >> 1) - 12;
  const on = ((st.t * 2) | 0) % 2 === 0;
  rect(ctx, R.fx, y - 6, FIELD_W, 28, 'rgba(5,4,12,0.45)');
  drawText(ctx, 'BEACON ACTIVE', cx, y, { cache: true, font: 'small', color: on ? '#ffffff' : WARN, align: 'center', shadow: DARK, lctx, glow: WARN, glowAlpha: 0.6 });
  drawText(ctx, 'A SQUADMATE CAN REVIVE YOU', cx, y + 11, { cache: true, font: 'tiny', color: INK, align: 'center' });
}

// In-game messages: newest at the bottom of the stack, outlined (no backing box), a short
// rise-in and fade-out. Placed in the space the layout left free (see L.toast), otherwise
// under the top rows / boss bar inside the field.
function drawToasts(ctx, lctx, R, L) {
  const now = st.last;
  for (let i = toasts.length - 1; i >= 0; i--) if (now - toasts[i].t0 >= toasts[i].ms) toasts.splice(i, 1);
  if (!toasts.length) return;
  let spot = L.toast;
  if (!spot) {
    const bossH = st.bossK > 0 ? Math.round((24 + 6 * (L.side ? L.sz : 1)) * Math.min(1, st.bossK * 1.5)) : 0;
    spot = { x: R.fx + (FIELD_W >> 1), y: R.fy + (L.fieldTop || 0) + 6 + bossH, w: FIELD_W - 12, align: 'center', s: 1, lines: 3 };
  }
  const s = spot.s || 1;
  const list = toasts.slice(-Math.max(1, spot.lines));
  let y = spot.y;
  for (const t of list) {
    const age = (now - t.t0) / 1000, life = t.ms / 1000;
    const a = Math.max(0, Math.min(1, age / 0.12) * Math.min(1, (life - age) / 0.35));
    const rise = Math.round((1 - Math.min(1, age / 0.2)) * 3 * s);
    let font = 'small', str = t.text;
    if (measureText(str, { font, size: s }) > spot.w) font = 'tiny';
    while (str.length > 4 && measureText(str, { font, size: s }) > spot.w) str = str.slice(0, -4) + '...';
    drawText(ctx, str, spot.x, y + rise, { cache: true, font, size: s, color: t.color, outline: DARK, align: spot.align, alpha: a, lctx: t.hot ? lctx : null, glow: GOLD2, glowAlpha: 0.5 });
    y += 10 * s;
  }
}
