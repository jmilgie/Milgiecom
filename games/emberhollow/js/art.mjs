import * as THREE from '../vendor/three.module.js';

const textureCache = new Map();
const imageTextureCache = new Map();
const textureLoader = new THREE.TextureLoader();

function surfaceTextureSet(name) {
  return {
    color: new URL(`../assets/textures/materials/${name}.webp`, import.meta.url).href,
    height: new URL(`../assets/textures/materials/${name}-height.webp`, import.meta.url).href,
  };
}

function actorTextureSet(name, extension = 'webp') {
  return {
    color: new URL(`../assets/textures/actors/${name}.${extension}`, import.meta.url).href,
    height: new URL(`../assets/textures/actors/${name}-height.${extension}`, import.meta.url).href,
  };
}

function actorMaskSet(name) {
  return {
    color: new URL(`../assets/textures/actors/${name}.png`, import.meta.url).href,
    alpha: new URL(`../assets/textures/actors/${name}-alpha.png`, import.meta.url).href,
  };
}

const SURFACE_TEXTURES = {
  townFloor: surfaceTextureSet('town-floor'),
  caveFloor: surfaceTextureSet('cave-floor'),
  townWall: surfaceTextureSet('town-wall'),
  caveWall: surfaceTextureSet('cave-wall'),
  mossFloor: surfaceTextureSet('moss-floor'),
  mossWall: surfaceTextureSet('moss-wall'),
  reservoirFloor: surfaceTextureSet('reservoir-floor'),
  reservoirWall: surfaceTextureSet('reservoir-wall'),
  echoFloor: surfaceTextureSet('echo-floor'),
  echoWall: surfaceTextureSet('echo-wall'),
  forgeFloor: surfaceTextureSet('forge-floor'),
  forgeWall: surfaceTextureSet('forge-wall'),
  archiveFloor: surfaceTextureSet('archive-floor'),
  archiveWall: surfaceTextureSet('archive-wall'),
  bossFloor: surfaceTextureSet('boss-floor'),
  bossWall: surfaceTextureSet('boss-wall'),
  roof: surfaceTextureSet('roof-shingles'),
  bark: surfaceTextureSet('tree-bark'),
  fabric: surfaceTextureSet('woven-trim'),
  carvedStone: surfaceTextureSet('stone-blocks'),
  metal: surfaceTextureSet('forge-metal'),
  paper: surfaceTextureSet('archive-paper'),
  water: surfaceTextureSet('water-surface'),
  crystal: surfaceTextureSet('crystal-facets'),
  hazard: surfaceTextureSet('rune-hazard'),
};

const ACTOR_TEXTURES = {
  skinAged: actorTextureSet('skin-aged'),
  skinYoung: actorTextureSet('skin-young'),
  hair: actorTextureSet('hair-strands'),
  frontierCloth: actorTextureSet('cloth-frontier'),
  brocadeCloth: actorTextureSet('cloth-brocade'),
  explorerCloth: actorTextureSet('cloth-explorer'),
  glassCloth: actorTextureSet('cloth-glass'),
  leather: actorTextureSet('leather-worn'),
  apron: actorTextureSet('apron-soot'),
  crawlerShell: actorTextureSet('crawler-carapace'),
  crawlerHide: actorTextureSet('crawler-underhide'),
  wardenArmor: actorTextureSet('warden-armor'),
  wispEnergy: actorTextureSet('wisp-energy'),
  choirObsidian: actorTextureSet('choir-obsidian'),
  choirGilded: actorTextureSet('choir-gilded'),
  choirVeil: actorTextureSet('choir-veil', 'png'),
  choirHeartSurface: actorTextureSet('choir-heart-surface', 'png'),
};

const ACTOR_MASKS = {
  elderFace: actorMaskSet('face-elder'),
  smithFace: actorMaskSet('face-smith'),
  bardFace: actorMaskSet('face-bard'),
  cartographerFace: actorMaskSet('face-cartographer'),
  glassweaverFace: actorMaskSet('face-glassweaver'),
  wispRunes: actorMaskSet('wisp-runes'),
  wardenRunes: actorMaskSet('warden-runes'),
  crawlerEyes: actorMaskSet('crawler-eyes'),
  choirRunes: actorMaskSet('choir-runes'),
  choirHeartMask: actorMaskSet('choir-heart-mask'),
};

const DEFAULT_THEME_SURFACE_PROFILE = {
  floor: SURFACE_TEXTURES.caveFloor,
  floorAlt: SURFACE_TEXTURES.echoFloor,
  wall: SURFACE_TEXTURES.caveWall,
  stone: SURFACE_TEXTURES.caveWall,
  carvedStone: SURFACE_TEXTURES.carvedStone,
  roof: SURFACE_TEXTURES.roof,
  bark: SURFACE_TEXTURES.bark,
  fabric: SURFACE_TEXTURES.fabric,
  metal: SURFACE_TEXTURES.metal,
  paper: SURFACE_TEXTURES.paper,
  water: SURFACE_TEXTURES.water,
  crystal: SURFACE_TEXTURES.crystal,
  hazard: SURFACE_TEXTURES.hazard,
};

const THEME_SURFACE_PROFILES = {
  town: {
    ...DEFAULT_THEME_SURFACE_PROFILE,
    floor: SURFACE_TEXTURES.townFloor,
    floorAlt: SURFACE_TEXTURES.townFloor,
    wall: SURFACE_TEXTURES.townWall,
    stone: SURFACE_TEXTURES.carvedStone,
  },
  market: {
    ...DEFAULT_THEME_SURFACE_PROFILE,
    floor: SURFACE_TEXTURES.townFloor,
    floorAlt: SURFACE_TEXTURES.townFloor,
    wall: SURFACE_TEXTURES.townWall,
    stone: SURFACE_TEXTURES.carvedStone,
  },
  moss: {
    ...DEFAULT_THEME_SURFACE_PROFILE,
    floor: SURFACE_TEXTURES.mossFloor,
    floorAlt: SURFACE_TEXTURES.caveFloor,
    wall: SURFACE_TEXTURES.mossWall,
    stone: SURFACE_TEXTURES.mossWall,
  },
  reservoir: {
    ...DEFAULT_THEME_SURFACE_PROFILE,
    floor: SURFACE_TEXTURES.reservoirFloor,
    floorAlt: SURFACE_TEXTURES.reservoirFloor,
    wall: SURFACE_TEXTURES.reservoirWall,
    stone: SURFACE_TEXTURES.reservoirWall,
  },
  echo: {
    ...DEFAULT_THEME_SURFACE_PROFILE,
    floor: SURFACE_TEXTURES.echoFloor,
    floorAlt: SURFACE_TEXTURES.caveFloor,
    wall: SURFACE_TEXTURES.echoWall,
    stone: SURFACE_TEXTURES.echoWall,
  },
  forge: {
    ...DEFAULT_THEME_SURFACE_PROFILE,
    floor: SURFACE_TEXTURES.forgeFloor,
    floorAlt: SURFACE_TEXTURES.forgeFloor,
    wall: SURFACE_TEXTURES.forgeWall,
    stone: SURFACE_TEXTURES.forgeWall,
  },
  archive: {
    ...DEFAULT_THEME_SURFACE_PROFILE,
    floor: SURFACE_TEXTURES.archiveFloor,
    floorAlt: SURFACE_TEXTURES.archiveFloor,
    wall: SURFACE_TEXTURES.archiveWall,
    stone: SURFACE_TEXTURES.archiveWall,
  },
  boss: {
    ...DEFAULT_THEME_SURFACE_PROFILE,
    floor: SURFACE_TEXTURES.bossFloor,
    floorAlt: SURFACE_TEXTURES.bossFloor,
    wall: SURFACE_TEXTURES.bossWall,
    stone: SURFACE_TEXTURES.bossWall,
  },
};

function clampChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hexToRgb(hex) {
  return {
    r: (hex >> 16) & 255,
    g: (hex >> 8) & 255,
    b: hex & 255,
  };
}

function rgbToHex({ r, g, b }) {
  return (clampChannel(r) << 16) | (clampChannel(g) << 8) | clampChannel(b);
}

function mixColor(a, b, amount) {
  const left = hexToRgb(a);
  const right = hexToRgb(b);
  return rgbToHex({
    r: left.r + (right.r - left.r) * amount,
    g: left.g + (right.g - left.g) * amount,
    b: left.b + (right.b - left.b) * amount,
  });
}

function shade(color, amount) {
  return amount >= 0 ? mixColor(color, 0xffffff, amount) : mixColor(color, 0x000000, Math.abs(amount));
}

function css(hex) {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

function configureTexture(texture, repeat = [1, 1], colorSpace = THREE.SRGBColorSpace) {
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function loadTextureAsset(url, repeat = [1, 1], colorSpace = THREE.SRGBColorSpace) {
  const cacheKey = `${url}:${repeat.join('x')}:${colorSpace}`;
  if (imageTextureCache.has(cacheKey)) return imageTextureCache.get(cacheKey);
  const texture = textureLoader.load(url);
  configureTexture(texture, repeat, colorSpace);
  imageTextureCache.set(cacheKey, texture);
  return texture;
}

function makeTexture(key, painter, repeat = [1, 1]) {
  if (textureCache.has(key)) return textureCache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  painter(ctx, canvas.width, canvas.height);
  const texture = configureTexture(new THREE.CanvasTexture(canvas), repeat, THREE.SRGBColorSpace);
  textureCache.set(key, texture);
  return texture;
}

function makeStoneTexture(base, accent, crack, repeat) {
  return makeTexture(`stone:${base}:${accent}:${crack}:${repeat.join('x')}`, (ctx, w, h) => {
    ctx.fillStyle = css(base);
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = css(accent);
    ctx.lineWidth = 4;
    for (let x = 0; x < w; x += 32) {
      const offset = (x / 8) % 2 === 0 ? 0 : 14;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      for (let y = offset; y < h; y += 28) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(Math.min(w, x + 32), y);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = css(crack);
    ctx.lineWidth = 2;
    for (let i = 0; i < 18; i += 1) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (Math.random() - 0.5) * 18, y + Math.random() * 22);
      ctx.stroke();
    }
  }, repeat);
}

function makeRoofTexture(base, accent, repeat) {
  return makeTexture(`roof:${base}:${accent}:${repeat.join('x')}`, (ctx, w, h) => {
    ctx.fillStyle = css(base);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = css(accent);
    for (let y = 0; y < h; y += 14) {
      const offset = (y / 14) % 2 === 0 ? 0 : 10;
      for (let x = -offset; x < w + 20; x += 20) {
        ctx.fillRect(x, y, 16, 8);
      }
    }
  }, repeat);
}

function makeBarkTexture(base, accent) {
  return makeTexture(`bark:${base}:${accent}`, (ctx, w, h) => {
    ctx.fillStyle = css(base);
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = css(accent);
    ctx.lineWidth = 4;
    for (let i = 0; i < 14; i += 1) {
      const x = 8 + i * 9;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x - 6, 28, x + 6, 68, x - 3, h);
      ctx.stroke();
    }
  }, [1, 1]);
}

function makeLeafTexture(base, accent) {
  return makeTexture(`leaf:${base}:${accent}`, (ctx, w, h) => {
    ctx.fillStyle = css(base);
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 120; i += 1) {
      ctx.fillStyle = css(i % 3 === 0 ? accent : shade(base, Math.random() * 0.18));
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * h, 3 + Math.random() * 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [1, 1]);
}

function makeWaterTexture(base, accent, repeat) {
  return makeTexture(`water:${base}:${accent}:${repeat.join('x')}`, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, css(shade(base, 0.14)));
    gradient.addColorStop(1, css(shade(base, -0.12)));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = css(accent);
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2;
    for (let y = 10; y < h; y += 16) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= w; x += 12) {
        ctx.lineTo(x, y + Math.sin((x + y) * 0.12) * 3);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }, repeat);
}

function makeFabricTexture(base, accent) {
  return makeTexture(`fabric:${base}:${accent}`, (ctx, w, h) => {
    ctx.fillStyle = css(base);
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = css(accent);
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.lineWidth = 4;
    for (let x = 0; x < w; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 10, h);
      ctx.stroke();
    }
  }, [1, 1]);
}

function material(color, extras = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    map: extras.map ?? null,
    alphaMap: extras.alphaMap ?? null,
    bumpMap: extras.bumpMap ?? null,
    bumpScale: extras.bumpScale ?? 0,
    roughness: extras.roughness ?? 0.72,
    metalness: extras.metalness ?? 0.08,
    emissive: extras.emissive ?? 0x000000,
    emissiveMap: extras.emissiveMap ?? null,
    emissiveIntensity: extras.emissiveIntensity ?? 0,
    transparent: extras.transparent ?? false,
    opacity: extras.opacity ?? 1,
    alphaTest: extras.alphaTest ?? 0,
    side: extras.side ?? THREE.FrontSide,
    depthWrite: extras.depthWrite ?? true,
  });
}

function overlayMaterial(map, alphaMap, color = 0xffffff, extras = {}) {
  return material(color, {
    map,
    alphaMap,
    transparent: true,
    opacity: extras.opacity ?? 1,
    roughness: extras.roughness ?? 0.58,
    metalness: extras.metalness ?? 0.06,
    emissive: extras.emissive ?? 0x000000,
    emissiveMap: extras.emissiveMap ?? map,
    emissiveIntensity: extras.emissiveIntensity ?? 0,
    alphaTest: extras.alphaTest ?? 0.08,
    side: extras.side ?? THREE.DoubleSide,
    depthWrite: extras.depthWrite ?? false,
  });
}

function resolveSurfaceProfile(themeId) {
  return THEME_SURFACE_PROFILES[themeId] || DEFAULT_THEME_SURFACE_PROFILE;
}

export function buildThemeMaterials(theme, themeId = 'town') {
  const surfaceProfile = resolveSurfaceProfile(themeId);
  const floorMap = loadTextureAsset(surfaceProfile.floor.color, [2.1, 2.1], THREE.SRGBColorSpace);
  const floorHeightMap = loadTextureAsset(surfaceProfile.floor.height, [2.1, 2.1], THREE.NoColorSpace);
  const floorAltMap = loadTextureAsset(surfaceProfile.floorAlt.color, [2.7, 2.7], THREE.SRGBColorSpace);
  const floorAltHeightMap = loadTextureAsset(surfaceProfile.floorAlt.height, [2.7, 2.7], THREE.NoColorSpace);
  const wallMap = loadTextureAsset(surfaceProfile.wall.color, [1.55, 1.55], THREE.SRGBColorSpace);
  const wallHeightMap = loadTextureAsset(surfaceProfile.wall.height, [1.55, 1.55], THREE.NoColorSpace);
  const barkMap = loadTextureAsset(surfaceProfile.bark.color, [1, 2.2], THREE.SRGBColorSpace);
  const barkHeightMap = loadTextureAsset(surfaceProfile.bark.height, [1, 2.2], THREE.NoColorSpace);
  const leafMap = makeLeafTexture(0x5f8b4a, 0x8ed16c);
  const roofMap = loadTextureAsset(surfaceProfile.roof.color, [1.8, 1.8], THREE.SRGBColorSpace);
  const roofHeightMap = loadTextureAsset(surfaceProfile.roof.height, [1.8, 1.8], THREE.NoColorSpace);
  const fabricMap = loadTextureAsset(surfaceProfile.fabric.color, [2.3, 2.3], THREE.SRGBColorSpace);
  const fabricHeightMap = loadTextureAsset(surfaceProfile.fabric.height, [2.3, 2.3], THREE.NoColorSpace);
  const stoneMap = loadTextureAsset(surfaceProfile.stone.color, [1.35, 1.35], THREE.SRGBColorSpace);
  const stoneHeightMap = loadTextureAsset(surfaceProfile.stone.height, [1.35, 1.35], THREE.NoColorSpace);
  const carvedStoneMap = loadTextureAsset(surfaceProfile.carvedStone.color, [1.55, 1.55], THREE.SRGBColorSpace);
  const carvedStoneHeightMap = loadTextureAsset(surfaceProfile.carvedStone.height, [1.55, 1.55], THREE.NoColorSpace);
  const metalMap = loadTextureAsset(surfaceProfile.metal.color, [1.6, 1.6], THREE.SRGBColorSpace);
  const metalHeightMap = loadTextureAsset(surfaceProfile.metal.height, [1.6, 1.6], THREE.NoColorSpace);
  const paperMap = loadTextureAsset(surfaceProfile.paper.color, [1.4, 1.4], THREE.SRGBColorSpace);
  const paperHeightMap = loadTextureAsset(surfaceProfile.paper.height, [1.4, 1.4], THREE.NoColorSpace);
  const waterMap = loadTextureAsset(surfaceProfile.water.color, [1.6, 1.6], THREE.SRGBColorSpace);
  const waterHeightMap = loadTextureAsset(surfaceProfile.water.height, [1.6, 1.6], THREE.NoColorSpace);
  const crystalMap = loadTextureAsset(surfaceProfile.crystal.color, [1.5, 1.5], THREE.SRGBColorSpace);
  const crystalHeightMap = loadTextureAsset(surfaceProfile.crystal.height, [1.5, 1.5], THREE.NoColorSpace);
  const hazardMap = loadTextureAsset(surfaceProfile.hazard.color, [1.7, 1.7], THREE.SRGBColorSpace);
  const hazardHeightMap = loadTextureAsset(surfaceProfile.hazard.height, [1.7, 1.7], THREE.NoColorSpace);

  return {
    floorMat: material(theme.floor, { map: floorMap, bumpMap: floorHeightMap, bumpScale: 0.1, roughness: 0.9 }),
    floorAltMat: material(theme.floorAlt, { map: floorAltMap, bumpMap: floorAltHeightMap, bumpScale: 0.085, roughness: 0.88 }),
    wallMat: material(theme.wall, { map: wallMap, bumpMap: wallHeightMap, bumpScale: 0.09, roughness: 0.94 }),
    wallTrimMat: material(theme.wallTrim, { map: fabricMap, bumpMap: fabricHeightMap, bumpScale: 0.018, roughness: 0.68, emissive: theme.wallTrim, emissiveIntensity: 0.03 }),
    hazardMat: material(theme.hazard, { map: hazardMap, bumpMap: hazardHeightMap, bumpScale: 0.06, emissive: theme.hazard, emissiveIntensity: 0.42, roughness: 0.3 }),
    waterMat: material(theme.accentSoft, { map: waterMap, bumpMap: waterHeightMap, bumpScale: 0.035, transparent: true, opacity: 0.78, emissive: theme.accentSoft, emissiveIntensity: 0.26, roughness: 0.12 }),
    barkMat: material(0x5a3d24, { map: barkMap, bumpMap: barkHeightMap, bumpScale: 0.12, roughness: 0.92 }),
    leafMat: material(0x5f8b4a, { map: leafMap, roughness: 0.82, emissive: 0x224415, emissiveIntensity: 0.05 }),
    roofMat: material(0x5a2b1c, { map: roofMap, bumpMap: roofHeightMap, bumpScale: 0.08, roughness: 0.74 }),
    stoneMat: material(shade(theme.wallTrim, -0.1), { map: stoneMap, bumpMap: stoneHeightMap, bumpScale: 0.075, roughness: 0.9 }),
    carvedStoneMat: material(shade(theme.wallTrim, -0.05), { map: carvedStoneMap, bumpMap: carvedStoneHeightMap, bumpScale: 0.07, roughness: 0.92 }),
    metalMat: material(shade(theme.wallTrim, 0.08), { map: metalMap, bumpMap: metalHeightMap, bumpScale: 0.05, roughness: 0.36, metalness: 0.72 }),
    potteryMat: material(0x8f5d34, { roughness: 0.92 }),
    fabricMat: material(shade(theme.wallTrim, -0.04), { map: fabricMap, bumpMap: fabricHeightMap, bumpScale: 0.018, roughness: 0.74 }),
    paperMat: material(shade(theme.ambient, 0.08), { map: paperMap, bumpMap: paperHeightMap, bumpScale: 0.01, roughness: 0.95 }),
    crystalMat: material(theme.accent, { map: crystalMap, bumpMap: crystalHeightMap, bumpScale: 0.06, roughness: 0.16, emissive: theme.accent, emissiveIntensity: 0.42 }),
  };
}

export function buildActorMaterials(theme, themeId = 'town') {
  const base = buildThemeMaterials(theme, themeId);
  const skinAgedMap = loadTextureAsset(ACTOR_TEXTURES.skinAged.color, [1.2, 1.2], THREE.SRGBColorSpace);
  const skinAgedHeightMap = loadTextureAsset(ACTOR_TEXTURES.skinAged.height, [1.2, 1.2], THREE.NoColorSpace);
  const skinYoungMap = loadTextureAsset(ACTOR_TEXTURES.skinYoung.color, [1.2, 1.2], THREE.SRGBColorSpace);
  const skinYoungHeightMap = loadTextureAsset(ACTOR_TEXTURES.skinYoung.height, [1.2, 1.2], THREE.NoColorSpace);
  const hairMap = loadTextureAsset(ACTOR_TEXTURES.hair.color, [1.4, 1.4], THREE.SRGBColorSpace);
  const hairHeightMap = loadTextureAsset(ACTOR_TEXTURES.hair.height, [1.4, 1.4], THREE.NoColorSpace);
  const frontierClothMap = loadTextureAsset(ACTOR_TEXTURES.frontierCloth.color, [2, 2], THREE.SRGBColorSpace);
  const frontierClothHeightMap = loadTextureAsset(ACTOR_TEXTURES.frontierCloth.height, [2, 2], THREE.NoColorSpace);
  const brocadeMap = loadTextureAsset(ACTOR_TEXTURES.brocadeCloth.color, [2, 2], THREE.SRGBColorSpace);
  const brocadeHeightMap = loadTextureAsset(ACTOR_TEXTURES.brocadeCloth.height, [2, 2], THREE.NoColorSpace);
  const explorerMap = loadTextureAsset(ACTOR_TEXTURES.explorerCloth.color, [2, 2], THREE.SRGBColorSpace);
  const explorerHeightMap = loadTextureAsset(ACTOR_TEXTURES.explorerCloth.height, [2, 2], THREE.NoColorSpace);
  const glassClothMap = loadTextureAsset(ACTOR_TEXTURES.glassCloth.color, [1.8, 1.8], THREE.SRGBColorSpace);
  const glassClothHeightMap = loadTextureAsset(ACTOR_TEXTURES.glassCloth.height, [1.8, 1.8], THREE.NoColorSpace);
  const leatherMap = loadTextureAsset(ACTOR_TEXTURES.leather.color, [2.1, 2.1], THREE.SRGBColorSpace);
  const leatherHeightMap = loadTextureAsset(ACTOR_TEXTURES.leather.height, [2.1, 2.1], THREE.NoColorSpace);
  const apronMap = loadTextureAsset(ACTOR_TEXTURES.apron.color, [1.8, 1.8], THREE.SRGBColorSpace);
  const apronHeightMap = loadTextureAsset(ACTOR_TEXTURES.apron.height, [1.8, 1.8], THREE.NoColorSpace);
  const crawlerShellMap = loadTextureAsset(ACTOR_TEXTURES.crawlerShell.color, [2.4, 2.4], THREE.SRGBColorSpace);
  const crawlerShellHeightMap = loadTextureAsset(ACTOR_TEXTURES.crawlerShell.height, [2.4, 2.4], THREE.NoColorSpace);
  const crawlerHideMap = loadTextureAsset(ACTOR_TEXTURES.crawlerHide.color, [2.1, 2.1], THREE.SRGBColorSpace);
  const crawlerHideHeightMap = loadTextureAsset(ACTOR_TEXTURES.crawlerHide.height, [2.1, 2.1], THREE.NoColorSpace);
  const wardenArmorMap = loadTextureAsset(ACTOR_TEXTURES.wardenArmor.color, [1.9, 1.9], THREE.SRGBColorSpace);
  const wardenArmorHeightMap = loadTextureAsset(ACTOR_TEXTURES.wardenArmor.height, [1.9, 1.9], THREE.NoColorSpace);
  const wispMap = loadTextureAsset(ACTOR_TEXTURES.wispEnergy.color, [2.5, 2.5], THREE.SRGBColorSpace);
  const wispHeightMap = loadTextureAsset(ACTOR_TEXTURES.wispEnergy.height, [2.5, 2.5], THREE.NoColorSpace);
  const choirObsidianMap = loadTextureAsset(ACTOR_TEXTURES.choirObsidian.color, [1.9, 1.9], THREE.SRGBColorSpace);
  const choirObsidianHeightMap = loadTextureAsset(ACTOR_TEXTURES.choirObsidian.height, [1.9, 1.9], THREE.NoColorSpace);
  const choirGildedMap = loadTextureAsset(ACTOR_TEXTURES.choirGilded.color, [1.7, 1.7], THREE.SRGBColorSpace);
  const choirGildedHeightMap = loadTextureAsset(ACTOR_TEXTURES.choirGilded.height, [1.7, 1.7], THREE.NoColorSpace);
  const choirVeilMap = loadTextureAsset(ACTOR_TEXTURES.choirVeil.color, [1.4, 1.4], THREE.SRGBColorSpace);
  const choirVeilHeightMap = loadTextureAsset(ACTOR_TEXTURES.choirVeil.height, [1.4, 1.4], THREE.NoColorSpace);
  const choirHeartSurfaceMap = loadTextureAsset(ACTOR_TEXTURES.choirHeartSurface.color, [1.25, 1.25], THREE.SRGBColorSpace);
  const choirHeartSurfaceHeightMap = loadTextureAsset(ACTOR_TEXTURES.choirHeartSurface.height, [1.25, 1.25], THREE.NoColorSpace);

  const elderFaceMap = loadTextureAsset(ACTOR_MASKS.elderFace.color, [1, 1], THREE.SRGBColorSpace);
  const elderFaceAlpha = loadTextureAsset(ACTOR_MASKS.elderFace.alpha, [1, 1], THREE.NoColorSpace);
  const smithFaceMap = loadTextureAsset(ACTOR_MASKS.smithFace.color, [1, 1], THREE.SRGBColorSpace);
  const smithFaceAlpha = loadTextureAsset(ACTOR_MASKS.smithFace.alpha, [1, 1], THREE.NoColorSpace);
  const bardFaceMap = loadTextureAsset(ACTOR_MASKS.bardFace.color, [1, 1], THREE.SRGBColorSpace);
  const bardFaceAlpha = loadTextureAsset(ACTOR_MASKS.bardFace.alpha, [1, 1], THREE.NoColorSpace);
  const cartographerFaceMap = loadTextureAsset(ACTOR_MASKS.cartographerFace.color, [1, 1], THREE.SRGBColorSpace);
  const cartographerFaceAlpha = loadTextureAsset(ACTOR_MASKS.cartographerFace.alpha, [1, 1], THREE.NoColorSpace);
  const glassweaverFaceMap = loadTextureAsset(ACTOR_MASKS.glassweaverFace.color, [1, 1], THREE.SRGBColorSpace);
  const glassweaverFaceAlpha = loadTextureAsset(ACTOR_MASKS.glassweaverFace.alpha, [1, 1], THREE.NoColorSpace);
  const wispRuneMap = loadTextureAsset(ACTOR_MASKS.wispRunes.color, [1, 1], THREE.SRGBColorSpace);
  const wispRuneAlpha = loadTextureAsset(ACTOR_MASKS.wispRunes.alpha, [1, 1], THREE.NoColorSpace);
  const wardenRuneMap = loadTextureAsset(ACTOR_MASKS.wardenRunes.color, [1, 1], THREE.SRGBColorSpace);
  const wardenRuneAlpha = loadTextureAsset(ACTOR_MASKS.wardenRunes.alpha, [1, 1], THREE.NoColorSpace);
  const crawlerEyesMap = loadTextureAsset(ACTOR_MASKS.crawlerEyes.color, [1, 1], THREE.SRGBColorSpace);
  const crawlerEyesAlpha = loadTextureAsset(ACTOR_MASKS.crawlerEyes.alpha, [1, 1], THREE.NoColorSpace);
  const choirRuneMap = loadTextureAsset(ACTOR_MASKS.choirRunes.color, [1, 1], THREE.SRGBColorSpace);
  const choirRuneAlpha = loadTextureAsset(ACTOR_MASKS.choirRunes.alpha, [1, 1], THREE.NoColorSpace);
  const choirHeartMaskMap = loadTextureAsset(ACTOR_MASKS.choirHeartMask.color, [1, 1], THREE.SRGBColorSpace);
  const choirHeartMaskAlpha = loadTextureAsset(ACTOR_MASKS.choirHeartMask.alpha, [1, 1], THREE.NoColorSpace);

  return {
    ...base,
    skinAgedMat: material(0xd0af95, { map: skinAgedMap, bumpMap: skinAgedHeightMap, bumpScale: 0.012, roughness: 0.92 }),
    skinYoungMat: material(0xe0bc9b, { map: skinYoungMap, bumpMap: skinYoungHeightMap, bumpScale: 0.01, roughness: 0.9 }),
    hairMat: material(0x79665a, { map: hairMap, bumpMap: hairHeightMap, bumpScale: 0.03, roughness: 0.82 }),
    frontierClothMat: material(0x9d856d, { map: frontierClothMap, bumpMap: frontierClothHeightMap, bumpScale: 0.03, roughness: 0.88 }),
    brocadeClothMat: material(0x8a6a7a, { map: brocadeMap, bumpMap: brocadeHeightMap, bumpScale: 0.032, roughness: 0.8 }),
    explorerClothMat: material(0x6d7b6f, { map: explorerMap, bumpMap: explorerHeightMap, bumpScale: 0.032, roughness: 0.84 }),
    glassClothMat: material(0xa5c3d6, { map: glassClothMap, bumpMap: glassClothHeightMap, bumpScale: 0.026, roughness: 0.62 }),
    leatherMat: material(0x7b5a3f, { map: leatherMap, bumpMap: leatherHeightMap, bumpScale: 0.04, roughness: 0.9 }),
    apronMat: material(0x7d5a47, { map: apronMap, bumpMap: apronHeightMap, bumpScale: 0.04, roughness: 0.92 }),
    crawlerShellMat: material(0x7f8a79, { map: crawlerShellMap, bumpMap: crawlerShellHeightMap, bumpScale: 0.065, roughness: 0.52 }),
    crawlerHideMat: material(0x8b7467, { map: crawlerHideMap, bumpMap: crawlerHideHeightMap, bumpScale: 0.05, roughness: 0.72 }),
    wardenArmorMat: material(shade(theme.wallTrim, -0.08), { map: wardenArmorMap, bumpMap: wardenArmorHeightMap, bumpScale: 0.055, roughness: 0.42, metalness: 0.62 }),
    wispEnergyMat: material(theme.accentSoft, { map: wispMap, bumpMap: wispHeightMap, bumpScale: 0.02, roughness: 0.08, transparent: true, opacity: 0.82, emissive: theme.accentSoft, emissiveIntensity: 0.72 }),
    choirObsidianMat: material(shade(theme.wall, -0.02), { map: choirObsidianMap, bumpMap: choirObsidianHeightMap, bumpScale: 0.06, roughness: 0.24, metalness: 0.12, emissive: theme.accent, emissiveIntensity: 0.06 }),
    choirGildedMat: material(shade(theme.wallTrim, 0.08), { map: choirGildedMap, bumpMap: choirGildedHeightMap, bumpScale: 0.05, roughness: 0.25, metalness: 0.78, emissive: theme.wallTrim, emissiveIntensity: 0.1 }),
    choirVeilMat: material(theme.accent, { map: choirVeilMap, bumpMap: choirVeilHeightMap, bumpScale: 0.03, roughness: 0.74, emissive: theme.accent, emissiveIntensity: 0.06 }),
    choirHeartSurfaceMat: material(theme.accentSoft, { map: choirHeartSurfaceMap, bumpMap: choirHeartSurfaceHeightMap, bumpScale: 0.05, roughness: 0.16, emissive: theme.accentSoft, emissiveIntensity: 0.18 }),
    elderFaceMat: overlayMaterial(elderFaceMap, elderFaceAlpha, 0xffffff, { roughness: 0.66 }),
    smithFaceMat: overlayMaterial(smithFaceMap, smithFaceAlpha, 0xffffff, { roughness: 0.7 }),
    bardFaceMat: overlayMaterial(bardFaceMap, bardFaceAlpha, 0xffffff, { roughness: 0.62 }),
    cartographerFaceMat: overlayMaterial(cartographerFaceMap, cartographerFaceAlpha, 0xffffff, { roughness: 0.66 }),
    glassweaverFaceMat: overlayMaterial(glassweaverFaceMap, glassweaverFaceAlpha, 0xffffff, { roughness: 0.58, emissive: theme.accentSoft, emissiveIntensity: 0.03 }),
    wispRuneMat: overlayMaterial(wispRuneMap, wispRuneAlpha, 0xffffff, { emissive: theme.accentSoft, emissiveMap: wispRuneMap, emissiveIntensity: 0.95, roughness: 0.14, opacity: 0.94 }),
    wardenRuneMat: overlayMaterial(wardenRuneMap, wardenRuneAlpha, 0xffffff, { emissive: theme.accentSoft, emissiveMap: wardenRuneMap, emissiveIntensity: 0.88, roughness: 0.22, metalness: 0.24 }),
    crawlerEyesMat: overlayMaterial(crawlerEyesMap, crawlerEyesAlpha, 0xffffff, { emissive: theme.accentSoft, emissiveMap: crawlerEyesMap, emissiveIntensity: 0.94, roughness: 0.08, opacity: 0.92 }),
    choirRuneMat: overlayMaterial(choirRuneMap, choirRuneAlpha, 0xffffff, { emissive: theme.accent, emissiveMap: choirRuneMap, emissiveIntensity: 0.96, roughness: 0.18, metalness: 0.18, opacity: 0.96 }),
    choirHeartMaskMat: overlayMaterial(choirHeartMaskMap, choirHeartMaskAlpha, 0xffffff, { emissive: theme.accentSoft, emissiveMap: choirHeartMaskMap, emissiveIntensity: 1.08, roughness: 0.08, opacity: 0.98 }),
  };
}

export function addStringLights(group, color, span = 5, count = 5, height = 3.3) {
  const cable = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-span, height, 0),
      new THREE.Vector3(span, height - 0.25, 0),
    ]),
    new THREE.LineBasicMaterial({ color: shade(color, -0.4) }),
  );
  group.add(cable);

  for (let i = 0; i < count; i += 1) {
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 10, 10),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.2 }),
    );
    const t = count === 1 ? 0.5 : i / (count - 1);
    orb.position.set(-span + span * 2 * t, height - 0.15 - Math.sin(t * Math.PI) * 0.25, 0);
    group.add(orb);
  }
}
