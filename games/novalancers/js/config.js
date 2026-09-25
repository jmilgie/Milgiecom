// Nova Lancers — global constants and ship / sector definitions shared by sim + UI.

export const VERSION = '1.0.0';

export const FIELD_W = 240;
export const FIELD_H = 400;
export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;

// HUD strips the renderer tries to reserve around the field (art px) when the screen allows it.
export const HUD_TOP = 22;
export const HUD_BOTTOM = 40;

export const MAX_PLAYERS = 4;

export const SHIPS = {
  aurora: {
    id: 'aurora', name: 'AURORA', sprite: 'ship_aurora',
    weapon: 'VULCAN SPREAD',
    blurb: 'Balanced gunship. A fan of vulcan rounds that widens with power — covers the whole sky.',
    stats: { power: 3, speed: 3, spread: 5 },
    speed: 1.0, hitbox: 2.5,
  },
  tempest: {
    id: 'tempest', name: 'TEMPEST', sprite: 'ship_tempest',
    weapon: 'LANCE LASER',
    blurb: 'Needle interceptor. A piercing lance beam that melts anything in front of it. Fastest hull.',
    stats: { power: 5, speed: 5, spread: 1 },
    speed: 1.15, hitbox: 2.2,
  },
  seraph: {
    id: 'seraph', name: 'SERAPH', sprite: 'ship_seraph',
    weapon: 'SEEKER SWARM',
    blurb: 'Heavy frame. Forward cannons plus homing micro-missiles that hunt targets anywhere on screen.',
    stats: { power: 4, speed: 2, spread: 4 },
    speed: 0.9, hitbox: 2.8,
  },
  valkyrie: {
    id: 'valkyrie', name: 'VALKYRIE', sprite: 'ship_valkyrie',
    weapon: 'PLASMA WAVE',
    blurb: 'Delta striker. Rippling plasma crescents that pass through bullets-light targets and hit wide.',
    stats: { power: 4, speed: 4, spread: 3 },
    speed: 1.05, hitbox: 2.5,
  },
};
export const SHIP_ORDER = ['aurora', 'tempest', 'seraph', 'valkyrie'];

export const SECTORS = [
  { n: 1, key: 'aurora',  name: 'AURORA RING',     sub: 'Orbital Shipyard · Kepler-442',   music: 'aurora',  boss: 'warden' },
  { n: 2, key: 'cinder',  name: 'CINDER BELT',     sub: 'Mining Belt · Red Giant Hadar',   music: 'cinder',  boss: 'wyrm' },
  { n: 3, key: 'veil',    name: 'VEIL NEBULA',     sub: 'Stellar Nursery · Deep Veil',     music: 'veil',    boss: 'prism' },
  { n: 4, key: 'wreck',   name: 'LEVIATHAN WRECK', sub: 'Derelict Dreadnought · 40 km',    music: 'wreck',   boss: 'dread' },
  { n: 5, key: 'horizon', name: 'EVENT HORIZON',   sub: 'Singularity · The Choir Heart',   music: 'horizon', boss: 'heart' },
];

export const RULES = {
  lives: 3,
  bombs: 2,
  maxBombs: 5,
  maxLives: 6,
  powerStart: 1,
  powerMax: 8,
  powerLossOnDeath: 2,
  invulnAfterRespawn: 2.6,   // seconds
  overdriveDuration: 6,      // seconds
  chainWindow: 1.5,          // seconds
  chainMax: 16,
  grazeRadius: 10,
  reviveTime: 1.5,
  reviveRadius: 18,
};

export const DEFAULT_SETTINGS = {
  name: '',
  music: 0.7,
  sfx: 0.85,
  haptics: true,
  shake: true,
  quality: 'auto',
  sensitivity: 1.25,
  scanlines: true,
};
