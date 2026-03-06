import { EmberhollowGame } from './game.mjs';

const dom = {
  canvas: document.getElementById('game-canvas'),
  overlay: document.getElementById('overlay'),
  panel: document.getElementById('overlay-panel'),
  areaName: document.getElementById('area-name'),
  objective: document.getElementById('objective-text'),
  health: document.getElementById('health-hearts'),
  shards: document.getElementById('shard-count'),
  bolts: document.getElementById('bolt-level'),
  abilities: document.getElementById('ability-bar'),
  bossHud: document.getElementById('boss-hud'),
  bossBar: document.getElementById('boss-fill'),
  bossLabel: document.getElementById('boss-label'),
  prompt: document.getElementById('interact-prompt'),
  toasts: document.getElementById('toast-stack'),
  minimap: document.getElementById('minimap'),
  flash: document.getElementById('damage-flash'),
  touchControls: document.getElementById('touch-controls'),
  movePad: document.getElementById('move-pad'),
  moveThumb: document.getElementById('move-thumb'),
  lookPad: document.getElementById('look-pad'),
  lookThumb: document.getElementById('look-thumb'),
  touchShoot: document.getElementById('touch-shoot'),
  touchInteract: document.getElementById('touch-interact'),
  touchDash: document.getElementById('touch-dash'),
  touchHook: document.getElementById('touch-hook'),
  touchNova: document.getElementById('touch-nova'),
};

window.emberhollow = new EmberhollowGame(dom);
