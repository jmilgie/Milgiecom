// Nova Lancers — boot + flow controller.
// Loads every module defensively (a failing module degrades to a stub instead of breaking
// the game), runs the fixed-timestep loop, and wires sim <-> art/audio/UI/network.

import { VERSION, DT, FIELD_W, FIELD_H, SECTORS, SHIPS, SHIP_ORDER, DEFAULT_SETTINGS, RULES } from './config.js';
import { Renderer } from './engine/renderer.js';
import { Input } from './engine/input.js';
import { Haptics } from './engine/haptics.js';
import { AudioSys } from './audio/audio.js';
import { loadJSON, saveJSON, randomSeed, clamp } from './util.js';
import { TEAM_HEX, RAMPS } from './art/palette.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');

// ------------------------------------------------------------------ module loading
async function tryImport(path) {
  try { return await import(path); } catch (e) { console.warn('[nova] module failed:', path, e); return null; }
}

const M = {};                 // loaded modules
let R, input, UI, sim = null, session = null;
let fx = null, bg = null, bgKey = '';
let Music = null;
let settings = Object.assign({}, DEFAULT_SETTINGS, loadJSON('nvl-settings', {}));
let profile = Object.assign({ name: '', ship: 'aurora', best: 0, unlocked: 0, plays: 0 }, loadJSON('nvl-profile', {}));
if (!settings.name) settings.name = profile.name || ('ACE-' + String(10 + Math.floor(Math.random() * 89)));
let mode = 'boot';            // boot | title | menu | game | lobby
let paused = false;
let pendingRoom = null;
let lastScreen = '';
let solo = { ship: profile.ship || 'aurora', sector: 0 };

// ------------------------------------------------------------------ sprite kit (sim-facing)
const kit = {
  meta: {}, emeta: {},
  _draw: null, _drawE: null, _spr: null, _dirs: new Map(),
  _o: {}, _team: [0, 1, 2, 3].map((t) => ({ team: t })), _teamW: [0, 1, 2, 3].map((t) => ({ team: t, white: true })),
  _none: {},
  draw(ctx, name, frame, x, y, opt) { if (this._draw) this._draw(ctx, name, frame, x, y, opt || this._none); else stubDraw(ctx, name, x, y); },
  drawE(ctx, name, frame, x, y, opt) { if (this._drawE) this._drawE(ctx, name, frame, x, y, opt || this._none); },
  dirs(name) {
    let d = this._dirs.get(name);
    if (d === undefined) {
      // don't cache lookups for sprites that aren't built yet (lazily built boss art)
      if (this._has && !this._has(name)) return 1;
      try { d = this._spr ? (this._spr(name).dirs || 1) : 1; } catch { d = 1; }
      this._dirs.set(name, d);
    }
    return d;
  },
  optDir(name, angle, team) {
    const o = this._o;
    o.team = team; o.white = false; o.flipX = false; o.alpha = undefined;
    o.dir = this.dirs(name) > 1 ? angle + Math.PI / 2 : undefined;
    return o;
  },
  optNone() { const o = this._o; o.team = undefined; o.dir = undefined; o.white = false; o.flipX = false; o.alpha = undefined; return o; },
  withWhite(opt) { return Object.assign({}, opt, { white: true }); },
  teamOpt(t) { return this._team[t] || this._team[0]; },
  teamWhite(t) { return this._teamW[t] || this._teamW[0]; },
};

function stubDraw(ctx, name, x, y) {
  ctx.fillStyle = name.startsWith('eb_') ? '#ff5fae' : name.startsWith('pb_') ? '#79ecff' : name.startsWith('en_') || name.startsWith('boss') ? '#93709a' : '#dfe8f7';
  const s = name.startsWith('boss') ? 30 : name.startsWith('eb_') || name.startsWith('pb_') ? 2 : 6;
  ctx.fillRect(Math.round(x) - s, Math.round(y) - s, s * 2, s * 2);
}

// Glow sprites for the light layer (radial, cached per color)
const glowCache = new Map();
function glowSprite(color) {
  let c = glowCache.get(color);
  if (!c) {
    c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, color); grd.addColorStop(0.35, color + '88'); grd.addColorStop(1, color + '00');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    glowCache.set(color, c);
  }
  return c;
}
function glow(lctx, x, y, r, color, a = 1) {
  const img = glowSprite(color.length === 7 ? color : '#ffffff');
  lctx.globalAlpha = a;
  lctx.drawImage(img, x - r, y - r, r * 2, r * 2);
  lctx.globalAlpha = 1;
}

// FX stub (used only if particles.js failed to load)
function stubFX() {
  const noop = () => {};
  return {
    update: noop, draw: noop, explode: noop, hit: noop, spark: noop, muzzle: noop, trail: noop, debris: noop,
    shockwave: noop, nova: noop, overdrive: noop, graze: noop, warp: noop, pickup: noop, text: noop, clear: noop,
    flash: noop, chroma: noop, setTextRenderer: noop, count: 0,
    postState() { return { waves: [], flash: 0, chroma: 0 }; },
    drawBeam(ctx, lctx, x1, y1, x2, y2, w, phase) {
      ctx.strokeStyle = phase === 'warn' ? 'rgba(255,95,174,.5)' : '#ffc4e1';
      ctx.lineWidth = phase === 'warn' ? 1 : Math.max(1, w);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    },
    drawPlayerBeam(ctx, lctx, x, y1, y2, w) { ctx.fillStyle = '#d6fcff'; ctx.fillRect(x - w / 2, y2, w, y1 - y2); },
  };
}

// ------------------------------------------------------------------ audio helpers
let sfxFn = () => {}, sfxLoopFn = () => ({ stop() {}, setVol() {}, setPitch() {}, setX() {} });
function sfx(name, opt) { try { sfxFn(name, opt); } catch (e) { if (DEBUG) console.warn(e); } }

function playMusic(track, opt) { try { Music?.play(track, opt); } catch (e) { if (DEBUG) console.warn(e); } }

// ------------------------------------------------------------------ env bridge for the sim
const env = {
  sprites: kit,
  fx: null,
  bg: null,
  glow,
  text: null,
  hiScore: profile.best || 0,
  bossMeta: {},
  music: {
    play: (t, o) => playMusic(t, o),
    duck: (a, s) => { try { Music?.duck(a, s); } catch { /* */ } },
    stinger: (n) => { try { Music?.stinger(n); } catch { /* */ } },
  },
  sfx: (n, o) => sfx(n, o),
  sfxLoop: (n, o) => sfxLoopFn(n, o),
  haptic: (t) => { if (settings.haptics) Haptics.play(t); },
  shake: (a, d) => { if (settings.shake) R.shake(a, d); },
  setSector(sector) {
    ensureBossArt(sector.boss);
    setBackground(sector.key);
    env.bg = bg;
    playMusic(sector.music, { fade: 1.2 });
  },
  ui: { event: (name, data) => onSimEvent(name, data) },
};

const bossArtJobs = new Map();
function ensureBossArt(key, onProgress) {
  if (!M.bossart?.buildBossArt || !key) return Promise.resolve();
  let job = bossArtJobs.get(key);
  if (!job) {
    job = M.bossart.buildBossArt(onProgress || null, { bosses: [key] })
      .then(() => { kit._dirs.clear(); })
      .catch((e) => { console.error('boss art failed', key, e); bossArtJobs.delete(key); });
    bossArtJobs.set(key, job);
  }
  return job;
}

function setBackground(key) {
  if (bgKey === key && bg) return;
  try { bg?.dispose?.(); } catch { /* */ }
  bg = null;
  if (M.bg?.createBackground) {
    try {
      bg = M.bg.createBackground(key);
      bg.resize(R.W, R.H, R.fx, R.fy);
    } catch (e) { console.warn('background failed', key, e); bg = null; }
  }
  if (!bg) bg = starfieldBG();
  bgKey = key;
  env.bg = bg;
}

function starfieldBG() {
  const stars = Array.from({ length: 160 }, (_, i) => ({ x: (i * 97) % 997, y: (i * 61) % 991, l: 1 + (i % 3) }));
  return {
    scrollSpeed: 30, grade: null,
    resize() {}, update() {},
    draw(ctx, lctx, scrollY) {
      for (const s of stars) {
        const y = (s.y + scrollY * s.l * 0.3) % R.H;
        ctx.fillStyle = s.l === 3 ? '#dfe8f7' : s.l === 2 ? '#7c8fb3' : '#36425f';
        ctx.fillRect(s.x % R.W, y | 0, 1, 1);
      }
    },
    lensing() { return null; },
  };
}

// ------------------------------------------------------------------ boot
async function boot() {
  R = new Renderer($('screen'));
  input = new Input(R);
  Haptics.init();
  Haptics.setEnabled(settings.haptics);
  input.sensitivity = settings.sensitivity;
  R.shakeEnabled = settings.shake;
  R.quality = settings.quality;
  AudioSys.init();
  AudioSys.setVolume('music', settings.music);
  AudioSys.setVolume('sfx', settings.sfx);

  // UI first so we can show a loading screen
  const [screens, hud, font] = await Promise.all([tryImport('./ui/screens.js'), tryImport('./ui/hud.js'), tryImport('./art/font.js')]);
  M.hud = hud; M.font = font;
  if (font?.drawText) env.text = font.drawText;
  UI = screens?.UI || fallbackUI();
  try { UI.init($('ui'), handlers); } catch (e) { console.error('UI init failed', e); UI = fallbackUI(); UI.init($('ui'), handlers); }
  UI.show('loading');
  UI.setLoading(0.02, 'Booting');

  const post = await tryImport('./fx/post.js');
  await R.init(post?.createPost);
  R.onResize(() => { bg?.resize(R.W, R.H, R.fx, R.fy); layoutTouch(); });
  layoutTouch();
  requestAnimationFrame(frame);

  // art
  UI.setLoading(0.08, 'Forging sprites');
  const sprites = await tryImport('./art/sprites.js');
  if (sprites?.buildSprites) {
    try {
      await sprites.buildSprites((p) => UI.setLoading(0.08 + p * 0.35, 'Forging sprites'));
      kit._draw = sprites.drawSprite; kit._drawE = sprites.drawSpriteEmissive; kit._spr = sprites.spr; kit._has = sprites.hasSprite;
      kit.meta = sprites.SHIP_META || {}; kit.emeta = sprites.ENEMY_META || {};
    } catch (e) { console.error('sprites failed', e); }
  }
  UI.setLoading(0.45, 'Waking the Choir');
  const bossart = await tryImport('./art/bossart.js');
  M.bossart = bossart;
  if (bossart?.buildBossArt) {
    env.bossMeta = bossart.BOSS_META || {};
    // only the first boss at boot; the rest are built in the background when their sector starts
    try { await ensureBossArt('warden', (p) => UI.setLoading(0.45 + p * 0.15, 'Waking the Choir')); } catch (e) { console.error('boss art failed', e); }
  }
  UI.setLoading(0.62, 'Painting the stars');
  M.bg = await tryImport('./art/backgrounds.js');
  if (M.bg?.buildBackgrounds) {
    try { await M.bg.buildBackgrounds((p) => UI.setLoading(0.62 + p * 0.1, 'Painting the stars')); } catch (e) { console.error('bg failed', e); }
  }
  setBackground('title');
  const particles = await tryImport('./fx/particles.js');
  if (particles?.buildFX) {
    try { await particles.buildFX((p) => UI.setLoading(0.72 + p * 0.02, 'Arming warheads')); } catch (e) { console.error('fx build failed', e); }
  }
  try { fx = particles?.createFX ? particles.createFX() : stubFX(); } catch (e) { console.error('fx failed', e); fx = stubFX(); }
  const textOpt = { color: '#fff', align: 'center', font: 'small', shadow: '#05040c' };
  if (env.text && fx.setTextRenderer) fx.setTextRenderer((ctx, str, x, y, color) => { textOpt.color = color; env.text(ctx, str, x, y, textOpt); });
  env.fx = fx;

  // audio (rendered offline; no unlock needed to build)
  UI.setLoading(0.74, 'Tuning reactors');
  const sfxMod = await tryImport('./audio/sfx.js');
  if (sfxMod?.buildSfx) {
    try {
      await sfxMod.buildSfx((p) => UI.setLoading(0.74 + p * 0.14, 'Tuning reactors'));
      sfxFn = sfxMod.sfx; sfxLoopFn = sfxMod.sfxLoop;
    } catch (e) { console.error('sfx failed', e); }
  }
  UI.setLoading(0.9, 'Composing');
  const musicMod = await tryImport('./audio/music.js');
  if (musicMod?.Music) {
    Music = musicMod.Music;
    try { await Music.init((p) => UI.setLoading(0.9 + p * 0.1, 'Composing')); } catch (e) { console.error('music failed', e); Music = null; }
  }
  UI.setLoading(1, 'Ready');

  // Deep-link: ?room=CODE (parsed here so solo players never download the network modules)
  pendingRoom = parseRoomParam();

  input.onAnyInput = () => AudioSys.unlock();
  AudioSys.onUnlock(() => { if ((mode === 'title' || mode === 'menu') && Music && !Music.current) playMusic('title', { fade: 2 }); });
  document.addEventListener('visibilitychange', () => {
    const hidden = document.visibilityState === 'hidden';
    AudioSys.setPaused(hidden);
    if (hidden && mode === 'game' && sim && !sim.online && !paused) pauseGame();
  });

  if ('serviceWorker' in navigator && location.protocol === 'https:' && !DEBUG) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  mode = 'title';
  UI.show('title', { version: VERSION, room: pendingRoom, best: profile.best });
  lastScreen = 'title';
  if (DEBUG && params.get('autostart')) startSolo({ ship: params.get('ship') || 'aurora', sector: +(params.get('sector') || 0) });
}

// ?room=ABCDE / ?r=ABCDE / #room=ABCDE  (same alphabet as js/net: no I, L, O, 0, 1)
function parseRoomParam() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const raw = String(params.get('room') || params.get('r') || hash.get('room') || '').toUpperCase().replace(/[\s-]/g, '');
  return /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/.test(raw) ? raw : null;
}

// ------------------------------------------------------------------ UI handlers
const handlers = {
  onTitleTap() { toMenu(); },
  onSolo(o = {}) { startSolo(o); },
  onSectorSelect(n) { solo.sector = clamp(n | 0, 0, Math.min(profile.unlocked, SECTORS.length - 1)); },
  async onHost(o = {}) { await startOnline('host', o); },
  async onJoin(o = {}) { await startOnline('join', o); },
  async onQuickMatch(o = {}) { await startOnline('quick', o); },
  onLobbyReady(ready) { session?.setInfo({ ready: !!ready }); sfx(ready ? 'ui_select' : 'ui_back'); },
  onLobbyShip(ship) { if (SHIPS[ship]) { profile.ship = ship; saveProfile(); session?.setInfo({ ship }); } },
  onLaunch() { launchOnline(); },
  onLeaveLobby() { leaveSession('LEFT'); toMenu(); },
  onResume() { resumeGame(); },
  onQuitToMenu() { quitToMenu(); },
  onRetry() { retry(); },
  onContinue() { continueOrNext(); },
  onNext() { nextSector(); },
  onSettings(s) { applySettings(s); },
  onShare(code) { share(code); },
  onFullscreen() { goFullscreen(); },
  onShip(ship) { if (SHIPS[ship]) { profile.ship = ship; solo.ship = ship; saveProfile(); } },
  getSettings() { return Object.assign({}, settings); },
  getProfile() {
    return { name: settings.name, ship: profile.ship, bestScore: profile.best, unlockedSector: profile.unlocked, stats: profile.stats || {}, room: pendingRoom };
  },
};

function toMenu() {
  AudioSys.unlock();
  mode = 'menu';
  setBackground('title');
  if (Music && Music.current !== 'title') playMusic('title', { fade: 1.5 });
  if (pendingRoom) {
    const code = pendingRoom; pendingRoom = null;
    UI.show('menu');
    startOnline('join', { code });
    return;
  }
  UI.show('menu');
}

// ------------------------------------------------------------------ solo
function startSolo(o) {
  AudioSys.unlock();
  const ship = SHIPS[o.ship] ? o.ship : (profile.ship || 'aurora');
  profile.ship = ship; profile.plays = (profile.plays || 0) + 1; saveProfile();
  // debug runs may start anywhere; players can start at any sector they've reached
  const maxSector = DEBUG ? SECTORS.length - 1 : Math.min(profile.unlocked, SECTORS.length - 1);
  const sector = clamp(o.sector ?? solo.sector ?? 0, 0, maxSector);
  leaveSession('LEFT');
  beginGame({ mode: 'solo', players: [{ slot: 0, name: settings.name, ship }], localSlot: 0, sector, seed: randomSeed() });
}

function beginGame(o) {
  fx?.clear?.();
  sim = new Sim(Object.assign({ env }, o));
  if (DEBUG) { sim.god = params.has('god'); sim.bot = params.has('bot'); }
  mode = 'game';
  paused = false;
  UI.show('none');
  input.setEnabled(true);
  $('touchControls').classList.remove('hidden');
  try { R.post?.resetAuto?.(); } catch { /* */ }
  if (settings.fullscreenAuto !== false && matchMedia('(pointer: coarse)').matches) goFullscreen(true);
  acc = 0;
}

function pauseGame() {
  if (mode !== 'game' || !sim) return;
  if (sim.online) { UI.show('pause', { online: true }); input.setEnabled(false); paused = false; return; }
  paused = true;
  input.setEnabled(false);
  Music?.duck?.(0.5, 0.3);
  UI.show('pause', { online: false });
  sfx('ui_back');
}

function resumeGame() {
  if (!sim) return;
  paused = false;
  UI.show('none');
  input.setEnabled(true);
  sfx('ui_select');
}

function quitToMenu() {
  saveBest();
  sim?.stopLoops?.();
  sim = null; paused = false;
  input.setEnabled(false);
  $('touchControls').classList.add('hidden');
  leaveSession('LEFT');
  fx?.clear?.();
  toMenu();
}

function retry() {
  if (!sim) return;
  if (sim.online) {
    if (sim.isHost) { sim.nextSector(true, true); UI.show('none'); input.setEnabled(true); }
    return;
  }
  const p = sim.me;
  const sector = sim.sectorIndex;
  beginGame({ mode: 'solo', players: [{ slot: 0, name: settings.name, ship: p.ship }], localSlot: 0, sector, seed: randomSeed() });
}

function continueOrNext() {
  if (!sim) return;
  if (sim.state === 'gameover' && !sim.online) {
    sim.continueSolo();
    UI.show('none');
    input.setEnabled(true);
    playMusic(sim.sector.music, { fade: 1 });
    return;
  }
  if (sim.state === 'clear') nextSector();
}

function nextSector() {
  if (!sim || sim.state !== 'clear') return;
  if (sim.online && !sim.isHost) { UI.toast('Waiting for the host to launch…'); return; }
  sim.nextSector(false);
  UI.show('none');
  input.setEnabled(true);
}

// ------------------------------------------------------------------ sim events -> UI
function onSimEvent(name, d = {}) {
  switch (name) {
    case 'sector': {
      const s = d.sector;
      // a new sector (next / retry by the host) always returns everyone to live play
      if (mode === 'game' && UI.current !== 'none' && UI.current !== 'pause') {
        UI.show('none');
        input.setEnabled(true);
        $('touchControls').classList.remove('hidden');
      }
      setTimeout(() => { if (mode === 'game') UI.banner(`SECTOR ${s.n} — ${s.name}`, s.sub, 3200); }, 400);
      if (sim && sim.sectorIndex > profile.unlocked) { profile.unlocked = sim.sectorIndex; saveProfile(); }
      break;
    }
    case 'banner': UI.banner(d.title || '', d.sub || '', d.ms || 2800); break;
    case 'warning': UI.banner('WARNING', d.name ? `${d.name} APPROACHING` : 'HOSTILE SIGNATURE', 2800); break;
    case 'toast': UI.toast(d.text, 1400); break;
    case 'clear': {
      saveBest();
      const nextN = (sim?.sectorIndex ?? 0) + 1;
      if (nextN > profile.unlocked && nextN < SECTORS.length) { profile.unlocked = nextN; saveProfile(); }
      Music?.stinger?.('stage_clear');
      sfx('stage_clear_whoosh');
      // build the next sector's background while players read the results
      const nk = SECTORS[nextN]?.key;
      if (nk && M.bg?.prewarmBackground) { try { M.bg.prewarmBackground(nk); } catch { /* */ } }
      if (SECTORS[nextN]) ensureBossArt(SECTORS[nextN].boss);
      setTimeout(() => {
        if (!sim || sim.state !== 'clear') return;
        input.setEnabled(false);
        UI.show('results', { stats: d.stats, score: d.score, bonus: d.bonus, sector: SECTORS[d.sector], maxChain: d.maxChain, isHost: !sim.online || sim.isHost, online: sim.online });
      }, 1600);
      break;
    }
    case 'victory': {
      saveBest();
      profile.unlocked = SECTORS.length - 1; profile.cleared = true; saveProfile();
      playMusic('victory', { fade: 2 });
      setTimeout(() => {
        input.setEnabled(false);
        $('touchControls').classList.add('hidden');
        UI.show('victory', { stats: d.stats, score: d.score });
      }, 2500);
      break;
    }
    case 'gameover': {
      saveBest();
      playMusic('gameover', { fade: 1.5 });
      setTimeout(() => {
        if (!sim || sim.state !== 'gameover') return;
        input.setEnabled(false);
        UI.show('gameover', { score: d.score ?? sim.score, solo: !sim.online, isHost: !sim.online || sim.isHost, best: profile.best });
      }, 1800);
      break;
    }
    default: break;
  }
}

function saveBest() {
  if (!sim) return;
  if (sim.score > (profile.best || 0)) { profile.best = Math.floor(sim.score); env.hiScore = profile.best; }
  saveProfile();
}
function saveProfile() { profile.name = settings.name; saveJSON('nvl-profile', profile); }

function applySettings(s) {
  settings = Object.assign({}, settings, s || {});
  settings.name = String(settings.name || '').replace(/[^\w\- .!?]/g, '').slice(0, 12).toUpperCase() || settings.name;
  saveJSON('nvl-settings', settings);
  AudioSys.setVolume('music', settings.music);
  AudioSys.setVolume('sfx', settings.sfx);
  Haptics.setEnabled(settings.haptics);
  input.sensitivity = settings.sensitivity;
  R.shakeEnabled = settings.shake;
  if (R.quality !== settings.quality) { R.setQuality(settings.quality); R.resize(); }
  session?.setInfo?.({ name: settings.name });
  saveProfile();
}

// ------------------------------------------------------------------ online
async function loadNet() {
  if (M.net?.hostSession) return M.net;
  M.net = await tryImport('./net/session.js');
  if (!M.net?.hostSession) throw new Error('NETWORK');
  return M.net;
}

async function startOnline(kind, o = {}) {
  AudioSys.unlock();
  leaveSession('LEFT');
  const ship = SHIPS[o.ship] ? o.ship : profile.ship;
  const info = { name: settings.name, ship };
  UI.toast(kind === 'quick' ? 'Searching for a squad…' : kind === 'host' ? 'Opening a channel…' : 'Connecting…', 2500);
  try {
    const net = await loadNet();
    if (kind === 'host') session = await net.hostSession({ ...info, isPublic: !!o.isPublic });
    else if (kind === 'join') session = await net.joinSession(String(o.code || '').toUpperCase().trim(), info);
    else session = await net.quickMatch(info);
  } catch (e) {
    const code = e && e.message;
    if (code === 'ABORTED') return;   // superseded by a newer attempt (or cancelled): stay quiet
    const msg = {
      ROOM_NOT_FOUND: 'Squad not found. Check the code.',
      ROOM_FULL: 'That squad is full (4/4).',
      ALREADY_STARTED: 'That squad already launched.',
      VERSION: 'Version mismatch — refresh the page.',
    }[code] || 'Could not connect. Check your connection and try again.';
    UI.toast(msg, 3500);
    sfx('ui_error');
    if (kind === 'join') UI.show('join', { code: String(o.code || '').toUpperCase(), error: code || 'NETWORK' });
    else UI.show('coop');
    return;
  }
  wireSession(session);
  mode = 'lobby';
  playMusic('lobby', { fade: 1.5 });
  UI.show('lobby', { session, lobby: session.lobby });
  UI.updateLobby(session.lobby, session);
  sfx('player_join');
}

function wireSession(s) {
  s.on('lobby', (l) => { if (mode === 'lobby') UI.updateLobby(l, s); });
  s.on('start', (payload) => beginOnline(s, payload));
  s.on('message', (msg, from) => {
    if (!sim || session !== s) return;
    if (s.isHost) sim.onClientMessage(msg, from); else sim.onHostMessage(msg);
  });
  s.on('peerjoin', (slot, info) => { sfx('player_join'); UI.toast(`${info?.name || 'A pilot'} joined`, 1600); });
  s.on('peerleave', (slot, info) => {
    sfx('player_leave');
    UI.toast(`${info?.name || 'A pilot'} left`, 1600);
    if (sim && s.isHost) sim.onPeerLeave(slot);
  });
  s.on('close', (reason) => {
    if (session !== s) return;
    session = null;
    const msg = { HOST_LEFT: 'The host ended the session.', KICKED: 'Removed from squad.', NETWORK: 'Connection lost.' }[reason];
    if (msg) UI.toast(msg, 3500);
    if (mode === 'game' || mode === 'lobby') { sim = null; input.setEnabled(false); $('touchControls').classList.add('hidden'); toMenu(); }
  });
}

function launchOnline() {
  if (!session || !session.isHost) return;
  // Everyone in the lobby gets a ship (a briefly lagging player still receives 'start');
  // anyone who never comes back is removed by the normal 'peerleave' path.
  const players = session.lobby.players.map((p) => ({ slot: p.slot, name: p.name, ship: p.ship }));
  session.startGame({ sector: 0, seed: randomSeed(), players, v: VERSION });
}

function beginOnline(s, payload) {
  if (!payload || !Array.isArray(payload.players)) return;
  sfx('ui_start');
  beginGame({
    mode: s.isHost ? 'host' : 'client',
    net: { send: (m) => s.send(m), hostTime: () => s.hostTime() },
    players: payload.players.filter((p) => p && p.slot >= 0 && p.slot < 4).map((p) => ({ slot: p.slot, name: String(p.name || '').slice(0, 12), ship: SHIPS[p.ship] ? p.ship : 'aurora' })),
    localSlot: s.selfSlot,
    sector: payload.sector | 0,
    seed: payload.seed >>> 0,
  });
}

function leaveSession(reason) {
  if (!session) return;
  const s = session;
  session = null;
  try { s.close(reason); } catch { /* */ }
}

async function share(code) {
  const url = M.net?.makeInviteUrl ? M.net.makeInviteUrl(code) : `${location.origin}${location.pathname}?room=${code}`;
  const data = { title: 'Nova Lancers', text: `Join my Nova Lancers squad! Code ${code}`, url };
  try {
    if (navigator.share) { await navigator.share(data); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(url); UI.toast('Invite link copied!', 2000); } catch { UI.toast(url, 5000); }
}

function goFullscreen(auto) {
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' }).then(() => {
    try { screen.orientation?.lock?.('portrait').catch(() => {}); } catch { /* */ }
  }).catch(() => { if (!auto) UI.toast('Fullscreen not available here', 1500); });
}

// ------------------------------------------------------------------ touch control layout
function layoutTouch() {
  const tc = $('touchControls');
  if (!tc) return;
  const f = R.fieldRectCss();
  tc.style.setProperty('--field-bottom', f.bottom + 'px');
  tc.style.setProperty('--field-left', f.x + 'px');
  tc.style.setProperty('--field-right', (R.cssW - f.x - f.w) + 'px');
  tc.style.setProperty('--below-field', Math.max(0, R.cssH - f.bottom) + 'px');
}

function updateTouchButtons() {
  if (!sim || !sim.me) return;
  const me = sim.me;
  const nova = $('btnNova'), over = $('btnOver');
  const cnt = $('novaCount');
  if (cnt && cnt.textContent !== String(me.bombs)) cnt.textContent = String(me.bombs);
  nova.classList.toggle('disabled', me.bombs <= 0 || !me.alive);
  nova.classList.toggle('ready', me.bombs > 0 && me.alive);
  const od = me.odT > 0 ? me.odT / RULES.overdriveDuration : me.od;
  over.style.setProperty('--charge', od.toFixed(3));
  over.classList.toggle('ready', me.od >= 1 && me.odT <= 0);
  over.classList.toggle('active', me.odT > 0);
  over.classList.toggle('disabled', me.od < 1 && me.odT <= 0);
}

// ------------------------------------------------------------------ main loop
let last = performance.now();
let acc = 0;
let fpsT = 0, fpsN = 0, fps = 60;
let titleT = 0;
let lastChainMult = 1;
let Sim = null;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;
  if (dt < 0) dt = 0;
  fpsT += dt; fpsN++;
  if (fpsT >= 0.5) { fps = Math.round(fpsN / fpsT); fpsT = 0; fpsN = 0; }

  try {
    if (mode === 'game' && sim) stepGame(dt);
    render(dt);
  } catch (e) {
    console.error(e);
  }
}

// Debug autopilot (?debug&bot): hunts the nearest enemy horizontally, sidesteps close bullets.
function botInput() {
  const me = sim.me;
  const inp = { dx: 0, dy: 0, ax: 0, ay: 0, slow: false, bomb: false, overdrive: me.od >= 1, pause: false };
  if (!me.alive) return inp;
  let tx = FIELD_W / 2;
  const tgt = sim.nearestEnemy(me.x, me.y - 200, true);
  if (tgt) tx = tgt.x;
  let danger = 0, push = 0;
  for (const b of sim.ebs.list) {
    const dx = b.x - me.x, dy = b.y - me.y;
    if (dy > -60 && dy < 12 && Math.abs(dx) < 16) { danger++; push += dx > 0 ? -1 : 1; }
  }
  inp.ax = clamp((tx - me.x) / 20, -1, 1) + clamp(push, -1, 1) * 1.2;
  inp.ay = clamp((FIELD_H - 70 - me.y) / 20, -1, 1);
  if (danger > 14 && me.bombs > 0) inp.bomb = true;
  return inp;
}

function stepGame(dt) {
  if (paused) return;
  const inp0 = () => (sim.bot ? botInput() : input.enabled ? input.read() : null);
  // pause key
  if (input.enabled && input.pauseQ) { input.pauseQ = false; pauseGame(); return; }
  acc += dt;
  let steps = 0;
  if (sim.mode === 'client') {
    const err = sim.tickError();
    if (err > 45) {
      // far behind the host: catch up quickly
      const n = Math.min(40, Math.floor(err));
      for (let i = 0; i < n; i++) sim.update(i === 0 ? inp0() : null);
      acc = 0;
      return;
    }
    if (err > 2.5) acc += DT;             // gently speed up
    else if (err < -2.5) acc -= DT * 0.5; // gently slow down
  }
  const speed = DEBUG ? Math.max(1, +(params.get('speed') || 1)) : 1;
  if (speed > 1) acc += dt * (speed - 1);
  while (acc >= DT && steps < 4 * speed) {
    sim.update(steps === 0 || sim.bot ? inp0() : (input.enabled ? input.read() : null));
    acc -= DT;
    steps++;
  }
  if (acc > DT * 4) acc = 0;
  fx.update(dt);
  updateTouchButtons();
}

function render(dt) {
  R.beginFrame(dt);
  const { ctx, lctx } = R;
  if (bg) bg.update(dt);
  if (mode === 'game' && sim) {
    sim.draw(R);
    drawFieldFrame(ctx);
    const hudS = sim.hudState();
    if (hudS.chainMult > lastChainMult && hudS.chainMult > 1) sfx('chain_up', { pitch: Math.min(12, hudS.chainMult - 1), vol: 0.6 });
    lastChainMult = hudS.chainMult;
    if (M.hud?.drawHUD) {
      const hud = hudS;
      hud.fps = DEBUG ? fps : 0;
      hud.net = sim.online ? { kind: session?.transportKind || 'p2p', ping: session?.ping?.() || 0 } : null;
      hud.players.forEach((p) => { p.ping = session?.lobby?.players?.find((q) => q.slot === p.slot)?.ping || 0; });
      try { M.hud.drawHUD(ctx, lctx, hud, R); } catch (e) { if (DEBUG) console.warn(e); }
    }
    if (sim.online && !sim.isHost && sim.hostSilentFor() > 2500 && env.text) {
      env.text(ctx, 'WAITING FOR HOST…', R.fx + FIELD_W / 2, R.fy + FIELD_H / 2, { color: '#ffd966', align: 'center', font: 'big', shadow: '#05040c' });
    }
  } else {
    // title / menus: background + logo + attract flyby
    titleT += dt;
    if (bg) bg.draw(ctx, lctx, titleT * 6, titleT);
    drawAttract(ctx, lctx, titleT);
    const scr = UI.current;
    if (scr === 'title' || scr === 'menu' || scr === 'loading') drawLogo(ctx, lctx, titleT, scr);
    if (fx) { R.beginField(false); fx.update(dt); fx.draw(ctx, lctx); R.endField(); }
  }
  // post
  const ps = fx ? fx.postState() : { waves: [] };
  R.present({
    grade: bg?.grade || null,
    waves: ps.waves, flash: ps.flash, flashColor: ps.flashColor, chroma: ps.chroma,
    lensing: currentLensing(dt),
    scanlines: settings.scanlines,
  });
}

// Gravitational lensing warps the whole composite (gameplay included), so keep it gentle while
// playing and fade it out completely once the final boss is on screen (readability first).
let lensFade = 1;
const lensOut = { x: 0, y: 0, r: 0, strength: 0 };
function currentLensing(dt) {
  const L = bg?.lensing ? bg.lensing(R.W, R.H) : null;
  if (!L) return null;
  let target = 1;
  if (mode === 'game' && sim) target = sim.bossIds.length ? 0 : 0.45;
  lensFade += (target - lensFade) * Math.min(1, dt * 1.5);
  if (lensFade < 0.02) return null;
  lensOut.x = L.x; lensOut.y = L.y; lensOut.r = L.r; lensOut.strength = L.strength * lensFade;
  return lensOut;
}

function drawFieldFrame(ctx) {
  // subtle darkening outside the field + thin luminous edges so the play area reads clearly
  const x = R.fx + R.shakeX, y = R.fy + R.shakeY;
  ctx.fillStyle = 'rgba(5,4,12,0.55)';
  if (x > 0) { ctx.fillRect(0, 0, x, R.H); ctx.fillRect(x + FIELD_W, 0, R.W - x - FIELD_W, R.H); }
  ctx.fillStyle = 'rgba(5,4,12,0.35)';
  if (y > 0) ctx.fillRect(x, 0, FIELD_W, y);
  if (y + FIELD_H < R.H) ctx.fillRect(x, y + FIELD_H, FIELD_W, R.H - y - FIELD_H);
  ctx.fillStyle = 'rgba(121,236,255,0.18)';
  if (x > 0) { ctx.fillRect(x - 1, y, 1, FIELD_H); ctx.fillRect(x + FIELD_W, y, 1, FIELD_H); }
}

// Attract mode: squadron formations sweeping across the title scene
function drawAttract(ctx, lctx, t) {
  if (!kit._draw) return;
  const cycle = 14;
  const k = t % cycle;
  if (k > 6) return;
  const u = k / 6;
  const cx = R.W * (1.15 - u * 1.3);
  const cy = R.H * (0.78 - u * 0.25);
  for (let i = 0; i < 4; i++) {
    const ox = i * 18 - 27 + Math.abs(i - 1.5) * 0, oy = Math.abs(i - 1.5) * 10;
    const x = cx + ox + (i % 2) * 2, y = cy + oy;
    const ship = SHIP_ORDER[i];
    kit.draw(ctx, SHIPS[ship].sprite, 0, x, y, kit.teamOpt(i));
    kit.drawE(lctx, SHIPS[ship].sprite, 0, x, y, kit.teamOpt(i));
    glow(lctx, x + 4, y + 10, 5, TEAM_HEX[i], 0.8);
  }
}

function drawLogo(ctx, lctx, t, scr) {
  if (!kit._spr) return;
  let s;
  try { s = kit._spr('logo'); } catch { return; }
  if (!s || !s.w) return;
  const x = Math.round(R.W / 2);
  const baseY = R.safeArt.top + Math.max(46, Math.round(R.H * (scr === 'menu' ? 0.13 : 0.24)));
  const y = baseY + Math.round(Math.sin(t * 1.2) * 1.5);
  const fr = Math.floor(t * 10) % 40;
  kit.draw(ctx, 'logo', fr < 8 ? fr : 0, x, y);
  kit.drawE(lctx, 'logo', fr < 8 ? fr : 0, x, y);
  if (kit._spr('logo_sub')?.w) {
    kit.draw(ctx, 'logo_sub', 0, x, y + Math.round(s.h / 2) + 8);
    kit.drawE(lctx, 'logo_sub', 0, x, y + Math.round(s.h / 2) + 8);
  }
}

// ------------------------------------------------------------------ fallback UI
function fallbackUI() {
  let root, h;
  const el = (html) => { root.innerHTML = html; };
  return {
    current: 'none',
    init(r, hh) { root = r; h = hh; },
    show(name, data) {
      this.current = name;
      root.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;color:#dfe8f7;font:16px monospace;pointer-events:' + (name === 'none' ? 'none' : 'auto');
      if (name === 'none') { el(''); return; }
      if (name === 'loading') { el('<div id="fl">Loading…</div>'); return; }
      if (name === 'title' || name === 'menu') {
        el('<div style="text-align:center"><h1>NOVA LANCERS</h1><button id="fs" style="font:20px monospace;padding:14px 28px">PLAY SOLO</button></div>');
        root.querySelector('#fs').onclick = () => h.onSolo({ ship: 'aurora' });
        return;
      }
      if (name === 'gameover' || name === 'results' || name === 'victory' || name === 'pause') {
        el(`<div style="text-align:center"><h2>${name.toUpperCase()}</h2><button id="fa" style="font:18px monospace;padding:12px 24px">${name === 'pause' ? 'RESUME' : name === 'results' ? 'NEXT' : 'RETRY'}</button> <button id="fm" style="font:18px monospace;padding:12px 24px">MENU</button></div>`);
        root.querySelector('#fa').onclick = () => (name === 'pause' ? h.onResume() : name === 'results' ? h.onNext() : h.onRetry());
        root.querySelector('#fm').onclick = () => h.onQuitToMenu();
      }
    },
    setLoading(p) { const e = root.querySelector('#fl'); if (e) e.textContent = `Loading ${Math.round(p * 100)}%`; },
    updateLobby() {}, toast(m) { console.log('[toast]', m); }, banner() {},
  };
}

// ------------------------------------------------------------------ go
(async () => {
  const simMod = await import('./game/sim.js');
  Sim = simMod.Sim;
  window.__nova = { get sim() { return sim; }, get R() { return R; }, settings, profile, kit, M, handlers, get session() { return session; }, get mode() { return mode; }, get ui() { return UI; } };
  await boot();
})().catch((e) => {
  console.error(e);
  const ui = $('ui');
  if (ui) ui.innerHTML = '<div style="position:fixed;inset:0;display:grid;place-items:center;color:#dfe8f7;font:16px monospace;text-align:center;padding:24px">Nova Lancers failed to start.<br>Please refresh the page.</div>';
});

void FIELD_H; void RAMPS;
