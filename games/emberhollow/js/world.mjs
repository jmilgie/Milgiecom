import * as THREE from '../vendor/three.module.js';
import { addStringLights, buildThemeMaterials } from './art.mjs';
import {
  createBossVisual as createDetailedBossVisual,
  createEnemyVisual as createDetailedEnemyVisual,
  createNpcVisual as createDetailedNpcVisual,
} from './actors.mjs';

export const TILE_SIZE = 4;

const FLOOR_GEOMETRY = new THREE.BoxGeometry(TILE_SIZE, 0.5, TILE_SIZE);
const WALL_GEOMETRY = new THREE.BoxGeometry(TILE_SIZE, 4.4, TILE_SIZE);
const PILLAR_GEOMETRY = new THREE.CylinderGeometry(0.8, 1.2, 2.8, 8);
const CRYSTAL_GEOMETRY = new THREE.OctahedronGeometry(0.85, 0);
const ORB_GEOMETRY = new THREE.SphereGeometry(0.55, 18, 18);
const TORUS_GEOMETRY = new THREE.TorusGeometry(1.05, 0.14, 12, 32);
const SLAB_GEOMETRY = new THREE.BoxGeometry(2.4, 0.4, 2.4);
const POT_GEOMETRY = new THREE.CylinderGeometry(0.45, 0.35, 0.9, 10);
const BRAZIER_GEOMETRY = new THREE.CylinderGeometry(0.35, 0.55, 1.1, 12);
const BOX_GEOMETRY = new THREE.BoxGeometry(1.6, 1.1, 1.2);
const PLATE_GEOMETRY = new THREE.CylinderGeometry(1.1, 1.1, 0.18, 20);
const SPIKE_GEOMETRY = new THREE.ConeGeometry(0.36, 1.2, 4);

export const THEMES = {
  town: {
    clear: 0xe8e6d5,
    fog: 0xe1dcc3,
    floor: 0x4d7440,
    floorAlt: 0x64844d,
    wall: 0xc49b6d,
    wallTrim: 0x8c633a,
    accent: 0xffca6e,
    accentSoft: 0x7ed7a1,
    hazard: 0x6bb9e4,
    ambient: 0xfdf6d8,
    sky: 0x8ac7db,
  },
  moss: {
    clear: 0x0d1718,
    fog: 0x132123,
    floor: 0x22322e,
    floorAlt: 0x2d433a,
    wall: 0x4f5f58,
    wallTrim: 0x7d8f7f,
    accent: 0xffc36b,
    accentSoft: 0x80ffd4,
    hazard: 0x7bd39c,
    ambient: 0xd9f1d8,
    sky: 0x182f2e,
  },
  reservoir: {
    clear: 0x0f1628,
    fog: 0x121c31,
    floor: 0x222d45,
    floorAlt: 0x273b55,
    wall: 0x4c5b73,
    wallTrim: 0x85a2b9,
    accent: 0x7fd7ff,
    accentSoft: 0x89b0ff,
    hazard: 0xff8f54,
    ambient: 0xcfe5ff,
    sky: 0x1a2f52,
  },
  echo: {
    clear: 0x131225,
    fog: 0x171932,
    floor: 0x2d2745,
    floorAlt: 0x3c3563,
    wall: 0x58608d,
    wallTrim: 0xb0d2ff,
    accent: 0xaa98ff,
    accentSoft: 0x5ee7ff,
    hazard: 0xf273ff,
    ambient: 0xf0e7ff,
    sky: 0x201d3f,
  },
  forge: {
    clear: 0x24150d,
    fog: 0x2c1b14,
    floor: 0x553427,
    floorAlt: 0x6a4028,
    wall: 0x8a6c5a,
    wallTrim: 0xffc278,
    accent: 0xff8657,
    accentSoft: 0xffd485,
    hazard: 0xffc36b,
    ambient: 0xffebc5,
    sky: 0x49261a,
  },
  market: {
    clear: 0x201827,
    fog: 0x291d2d,
    floor: 0x67503f,
    floorAlt: 0x856448,
    wall: 0xa77d62,
    wallTrim: 0xf2cf9a,
    accent: 0xffa95c,
    accentSoft: 0x8ef3df,
    hazard: 0x79a0ff,
    ambient: 0xffefd1,
    sky: 0x5c3253,
  },
  archive: {
    clear: 0x111820,
    fog: 0x18202b,
    floor: 0x384d59,
    floorAlt: 0x476373,
    wall: 0x6d7c8a,
    wallTrim: 0xd2dbe3,
    accent: 0xffd07c,
    accentSoft: 0x89ebff,
    hazard: 0x91b6ff,
    ambient: 0xe7f3ff,
    sky: 0x203245,
  },
  boss: {
    clear: 0x120910,
    fog: 0x1f0f1c,
    floor: 0x341728,
    floorAlt: 0x48203a,
    wall: 0x72566a,
    wallTrim: 0xffd4e1,
    accent: 0xff5da4,
    accentSoft: 0x9bfff5,
    hazard: 0xffd86b,
    ambient: 0xf9d8e5,
    sky: 0x2d1124,
  },
};

function material(color, extras = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    map: extras.map ?? null,
    bumpMap: extras.bumpMap ?? null,
    bumpScale: extras.bumpScale ?? 0,
    roughness: extras.roughness ?? 0.74,
    metalness: extras.metalness ?? 0.08,
    emissive: extras.emissive ?? 0x000000,
    emissiveIntensity: extras.emissiveIntensity ?? 0,
    transparent: extras.transparent ?? false,
    opacity: extras.opacity ?? 1,
  });
}

function tintMaterial(baseMaterial, color, extras = {}) {
  const mat = baseMaterial.clone();
  mat.color.setHex(color);
  mat.roughness = extras.roughness ?? mat.roughness;
  mat.metalness = extras.metalness ?? mat.metalness;
  mat.transparent = extras.transparent ?? mat.transparent;
  mat.opacity = extras.opacity ?? mat.opacity;
  mat.emissive.setHex(extras.emissive ?? 0x000000);
  mat.emissiveIntensity = extras.emissiveIntensity ?? mat.emissiveIntensity;
  return mat;
}

export function tileToWorld(level, x, z) {
  const width = level.map[0].length;
  const depth = level.map.length;
  return new THREE.Vector3(
    (x - width / 2 + 0.5) * TILE_SIZE,
    0,
    (z - depth / 2 + 0.5) * TILE_SIZE,
  );
}

export function worldToTile(level, x, z) {
  const width = level.map[0].length;
  const depth = level.map.length;
  return {
    x: Math.floor(x / TILE_SIZE + width / 2),
    z: Math.floor(z / TILE_SIZE + depth / 2),
  };
}

export function isBaseSolid(char) {
  return char === '#' || char === 'h' || char === 't' || char === 'b' || char === '!';
}

export function isHazard(char) {
  return char === '^';
}

export function buildLevelGeometry(level) {
  const theme = THEMES[level.theme] || THEMES.town;
  const group = new THREE.Group();
  const animators = [];
  const staticMeshes = new Map();

  const {
    floorMat,
    floorAltMat,
    wallMat,
    wallTrimMat,
    hazardMat,
    waterMat,
    barkMat,
    leafMat,
    roofMat,
    stoneMat,
  } = buildThemeMaterials(theme, level.theme);

  level.map.forEach((row, z) => {
    row.split('').forEach((char, x) => {
      const pos = tileToWorld(level, x, z);
      const tile = new THREE.Mesh((char === '^' ? FLOOR_GEOMETRY : FLOOR_GEOMETRY), (x + z) % 2 === 0 ? floorMat : floorAltMat);
      tile.position.set(pos.x, -0.3, pos.z);
      tile.receiveShadow = false;
      group.add(tile);

      if (char === '.' && (level.theme === 'town' || level.theme === 'market') && Math.random() > 0.88) {
        const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.5, 5), leafMat);
        tuft.position.set(pos.x + (Math.random() - 0.5) * 1.4, 0.02, pos.z + (Math.random() - 0.5) * 1.4);
        tuft.rotation.z = (Math.random() - 0.5) * 0.5;
        group.add(tuft);
      }

      if (char === '#') {
        const wall = new THREE.Mesh(WALL_GEOMETRY, wallMat);
        wall.position.set(pos.x, 1.9, pos.z);
        group.add(wall);

        const trim = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * 0.86, 0.35, TILE_SIZE * 0.86), wallTrimMat);
        trim.position.set(pos.x, 4.2, pos.z);
        group.add(trim);
      } else if (char === 'b') {
        const boulder = new THREE.Mesh(PILLAR_GEOMETRY, stoneMat);
        boulder.position.set(pos.x, 1.45, pos.z);
        boulder.rotation.y = (x + z) * 0.3;
        boulder.scale.set(1.1, 1.05, 1.1);
        group.add(boulder);
      } else if (char === 't') {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.48, 2.5, 8), barkMat);
        trunk.position.set(pos.x, 1.1, pos.z);
        group.add(trunk);
        const crown = new THREE.Mesh(new THREE.ConeGeometry(1.45, 3.1, 8), leafMat);
        crown.position.set(pos.x, 3, pos.z);
        group.add(crown);
      } else if (char === 'h') {
        const house = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.8, 3.2), wallMat);
        house.position.set(pos.x, 1.25, pos.z);
        group.add(house);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(2.5, 1.8, 4), roofMat);
        roof.position.set(pos.x, 3.3, pos.z);
        roof.rotation.y = Math.PI * 0.25;
        group.add(roof);
        const windowMat = material(theme.accent, { emissive: theme.accent, emissiveIntensity: 0.8, roughness: 0.24 });
        [-0.72, 0.72].forEach((offset) => {
          const window = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.44), windowMat);
          window.position.set(pos.x + offset, 1.4, pos.z + 1.63);
          group.add(window);
        });
      } else if (char === '^') {
        const base = new THREE.Mesh(FLOOR_GEOMETRY, hazardMat);
        base.position.set(pos.x, -0.24, pos.z);
        group.add(base);
        for (let i = 0; i < 4; i += 1) {
          const spike = new THREE.Mesh(SPIKE_GEOMETRY, hazardMat);
          spike.position.set(pos.x + (i % 2 === 0 ? -0.7 : 0.7), 0.45, pos.z + (i < 2 ? -0.7 : 0.7));
          group.add(spike);
        }
      } else if (char === '!') {
        const cracked = new THREE.Mesh(WALL_GEOMETRY, material(theme.wallTrim, { emissive: theme.accent, emissiveIntensity: 0.08 }));
        cracked.position.set(pos.x, 1.9, pos.z);
        cracked.userData.tileKey = `${x},${z}`;
        staticMeshes.set(`cracked:${x},${z}`, cracked);
        group.add(cracked);
      } else if (char === 'F') {
        const water = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.55, 0.5, 24), stoneMat);
        water.position.set(pos.x, 0.18, pos.z);
        group.add(water);
        const pool = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.18, 0.2, 24), waterMat);
        pool.position.set(pos.x, 0.36, pos.z);
        group.add(pool);
        animators.push((elapsed) => {
          pool.position.y = 0.34 + Math.sin(elapsed * 2 + x) * 0.03;
        });
      }
    });
  });

  if (level.theme === 'market') {
    const lights = new THREE.Group();
    addStringLights(lights, theme.accent, level.map[0].length * TILE_SIZE * 0.3, 9, 4.6);
    group.add(lights);
  }

  const fireflies = new THREE.Group();
  const particleMaterial = new THREE.MeshBasicMaterial({ color: theme.accentSoft });
  for (let i = 0; i < 28; i += 1) {
    const mote = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), particleMaterial);
    mote.position.set(
      (Math.random() - 0.5) * level.map[0].length * TILE_SIZE * 0.9,
      1.8 + Math.random() * 2.5,
      (Math.random() - 0.5) * level.map.length * TILE_SIZE * 0.9,
    );
    mote.userData.offset = Math.random() * Math.PI * 2;
    fireflies.add(mote);
  }
  animators.push((elapsed) => {
    fireflies.children.forEach((mote, index) => {
      const offset = mote.userData.offset;
      mote.position.y += Math.sin(elapsed * 1.3 + offset + index) * 0.002;
      mote.position.x += Math.cos(elapsed * 0.6 + offset) * 0.003;
      mote.position.z += Math.sin(elapsed * 0.5 + offset) * 0.003;
    });
  });
  group.add(fireflies);

  return { group, theme, animators, staticMeshes };
}

function withGlow(mesh, color, intensity = 0.5) {
  mesh.material = mesh.material.clone();
  mesh.material.emissive = new THREE.Color(color);
  mesh.material.emissiveIntensity = intensity;
  return mesh;
}

function makeLabelRing(color) {
  const ring = new THREE.Mesh(TORUS_GEOMETRY, material(color, { emissive: color, emissiveIntensity: 0.45, roughness: 0.32 }));
  ring.rotation.x = Math.PI / 2;
  return ring;
}

export function createObjectVisual(object, levelTheme) {
  const theme = THEMES[levelTheme] || THEMES.town;
  const group = new THREE.Group();
  const animators = [];
  const accent = theme.accent;
  const mats = buildThemeMaterials(theme, levelTheme);
  const npcRobes = {
    elder: 0xf1b86c,
    smith: 0xc56b56,
    bard: 0x79d8c8,
    cartographer: 0x9bc1ff,
    glassweaver: 0xff9eb8,
  };

  switch (object.kind) {
    case 'npc': {
      return createDetailedNpcVisual(object, theme, levelTheme);
    }
    case 'fountain': {
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.75, 0.8, 24), tintMaterial(mats.carvedStoneMat, theme.wallTrim, { roughness: 0.92 }));
      basin.position.y = 0.4;
      group.add(basin);
      const water = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.22, 0.24, 24), tintMaterial(mats.waterMat, theme.accentSoft, { transparent: true, opacity: 0.78, emissive: theme.accentSoft, emissiveIntensity: 0.35 }));
      water.position.y = 0.74;
      group.add(water);
      animators.push((elapsed) => {
        water.scale.y = 1 + Math.sin(elapsed * 2.5) * 0.08;
      });
      break;
    }
    case 'shrine': {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.8, 1.4), tintMaterial(mats.carvedStoneMat, theme.wallTrim, { emissive: accent, emissiveIntensity: 0.08 }));
      slab.position.y = 1.4;
      group.add(slab);
      const crystal = new THREE.Mesh(CRYSTAL_GEOMETRY, tintMaterial(mats.crystalMat, accent, { emissive: accent, emissiveIntensity: 0.6, roughness: 0.2 }));
      crystal.position.y = 3.1;
      crystal.scale.setScalar(1.2);
      group.add(crystal);
      animators.push((elapsed) => {
        crystal.rotation.y = elapsed;
        crystal.position.y = 3.1 + Math.sin(elapsed * 2.1) * 0.16;
      });
      break;
    }
    case 'portal': {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.22, 16, 48), material(accent, { emissive: accent, emissiveIntensity: 0.6, roughness: 0.2 }));
      ring.rotation.y = Math.PI / 2;
      ring.position.y = 1.5;
      group.add(ring);
      const core = new THREE.Mesh(new THREE.CircleGeometry(1.05, 32), material(theme.accentSoft, { emissive: theme.accentSoft, emissiveIntensity: 0.55, transparent: true, opacity: 0.6, roughness: 0.15 }));
      core.rotation.y = Math.PI / 2;
      core.position.y = 1.5;
      group.add(core);
      const light = new THREE.PointLight(accent, 1.4, 16, 2);
      light.position.y = 1.4;
      group.add(light);
      animators.push((elapsed) => {
        ring.rotation.z = elapsed * 1.3;
        core.scale.setScalar(1 + Math.sin(elapsed * 2.2) * 0.05);
      });
      break;
    }
    case 'gate': {
      const gate = new THREE.Mesh(new THREE.BoxGeometry(2.8, 3.8, 0.8), tintMaterial(mats.wallMat, theme.wall, { roughness: 0.88, emissive: theme.wallTrim, emissiveIntensity: 0.04 }));
      gate.position.y = 1.8;
      group.add(gate);
      break;
    }
    case 'brazier': {
      const stand = new THREE.Mesh(BRAZIER_GEOMETRY, material(theme.wallTrim, { roughness: 0.9 }));
      stand.position.y = 0.55;
      group.add(stand);
      const flame = new THREE.Mesh(ORB_GEOMETRY, material(theme.accent, { emissive: theme.accent, emissiveIntensity: 0.1, transparent: true, opacity: 0.85 }));
      flame.position.y = 1.45;
      flame.scale.set(0.55, 0.78, 0.55);
      flame.userData.base = flame.scale.clone();
      group.add(flame);
      const light = new THREE.PointLight(theme.accent, 0.2, 12, 2);
      light.position.y = 1.4;
      group.add(light);
      animators.push((elapsed, entity) => {
        const lit = entity?.state?.active;
        flame.visible = true;
        flame.material.emissiveIntensity = lit ? 0.9 : 0.06;
        flame.scale.y = (flame.userData.base?.y || 0.78) * (lit ? 1 + Math.sin(elapsed * 6) * 0.12 : 0.45);
        light.intensity = lit ? 1.2 + Math.sin(elapsed * 12) * 0.12 : 0.05;
      });
      break;
    }
    case 'chest': {
      const base = new THREE.Mesh(BOX_GEOMETRY, mats.potteryMat);
      base.position.y = 0.56;
      group.add(base);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.42, 1.18), material(0x5d3720, { roughness: 0.78 }));
      lid.position.y = 1.03;
      group.add(lid);
      const band = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.24, 1.26), material(accent, { emissive: accent, emissiveIntensity: 0.18, metalness: 0.55, roughness: 0.32 }));
      band.position.y = 0.75;
      group.add(band);
      break;
    }
    case 'pedestal': {
      const column = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.92, 1.6, 10), tintMaterial(mats.carvedStoneMat, theme.wallTrim, { roughness: 0.84 }));
      column.position.y = 0.8;
      group.add(column);
      const item = new THREE.Mesh(CRYSTAL_GEOMETRY, tintMaterial(mats.crystalMat, accent, { emissive: accent, emissiveIntensity: 0.65, roughness: 0.1 }));
      item.position.y = 2.15;
      item.scale.setScalar(object.grants === 'starfall' ? 1.45 : 1.05);
      group.add(item);
      const halo = makeLabelRing(theme.accentSoft);
      halo.position.y = 1.95;
      group.add(halo);
      animators.push((elapsed) => {
        item.rotation.y = elapsed * 1.3;
        item.position.y = 2.15 + Math.sin(elapsed * 2.4) * 0.18;
        halo.rotation.z = elapsed * 0.8;
      });
      break;
    }
    case 'plate': {
      const plate = new THREE.Mesh(PLATE_GEOMETRY, tintMaterial(mats.hazardMat, theme.accentSoft, { emissive: theme.accentSoft, emissiveIntensity: 0.06, roughness: 0.22 }));
      plate.position.y = 0.08;
      group.add(plate);
      animators.push((elapsed, entity) => {
        plate.material.emissiveIntensity = entity?.state?.active ? 0.75 : 0.08;
        plate.position.y = entity?.state?.active ? 0.02 : 0.08 + Math.sin(elapsed * 2 + object.x) * 0.01;
      });
      break;
    }
    case 'anchor': {
      const ring = makeLabelRing(accent);
      ring.position.y = 1.2;
      group.add(ring);
      const core = new THREE.Mesh(ORB_GEOMETRY, material(theme.accentSoft, { emissive: theme.accentSoft, emissiveIntensity: 0.6, roughness: 0.18 }));
      core.position.y = 1.2;
      core.scale.setScalar(0.62);
      group.add(core);
      animators.push((elapsed, entity) => {
        ring.rotation.z = elapsed * 1.7;
        core.position.y = 1.2 + Math.sin(elapsed * 3 + object.x) * 0.18;
        core.material.emissiveIntensity = entity?.state?.active ? 1 : 0.55;
      });
      break;
    }
    case 'resonator': {
      const column = new THREE.Mesh(PILLAR_GEOMETRY, tintMaterial(mats.stoneMat, theme.wall, { roughness: 0.88 }));
      column.position.y = 1.2;
      group.add(column);
      const crystal = new THREE.Mesh(CRYSTAL_GEOMETRY, tintMaterial(mats.crystalMat, runeColor(object.rune), { emissive: runeColor(object.rune), emissiveIntensity: 0.55, roughness: 0.14 }));
      crystal.position.y = 2.65;
      crystal.scale.setScalar(1.25);
      group.add(crystal);
      animators.push((elapsed, entity) => {
        crystal.rotation.y = elapsed * 1.15;
        crystal.position.y = 2.65 + Math.sin(elapsed * 2 + object.x) * 0.14;
        crystal.material.emissiveIntensity = entity?.state?.active ? 0.95 : 0.45;
      });
      break;
    }
    case 'lore': {
      const plaque = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.6, 0.2), mats.paperMat);
      plaque.position.y = 1.15;
      group.add(plaque);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(2.04, 1.84, 0.16), mats.metalMat);
      frame.position.y = 1.15;
      frame.position.z = -0.03;
      group.add(frame);
      break;
    }
    case 'pot': {
      const pot = new THREE.Mesh(POT_GEOMETRY, mats.potteryMat);
      pot.position.y = 0.46;
      group.add(pot);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.05, 8, 18), material(theme.accent, { emissive: theme.accent, emissiveIntensity: 0.1 }));
      ring.position.y = 0.58;
      ring.rotation.x = Math.PI / 2;
      group.add(ring);
      break;
    }
    case 'stall': {
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.18, 2), mats.fabricMat);
      canopy.position.y = 2.3;
      group.add(canopy);
      [-1.15, 1.15].forEach((x) => {
        [-0.75, 0.75].forEach((z) => {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.2, 6), mats.barkMat);
          post.position.set(x, 1.1, z);
          group.add(post);
        });
      });
      const table = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.16, 1.6), mats.carvedStoneMat);
      table.position.y = 1.06;
      group.add(table);
      for (let i = 0; i < 3; i += 1) {
        const crate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), material(i % 2 === 0 ? theme.accent : theme.accentSoft, { emissive: i % 2 === 0 ? theme.accent : theme.accentSoft, emissiveIntensity: 0.18 }));
        crate.position.set(-0.7 + i * 0.7, 1.34, 0);
        group.add(crate);
      }
      break;
    }
    case 'lanternPost': {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 3.2, 8), mats.metalMat);
      post.position.y = 1.6;
      group.add(post);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 0.1), mats.metalMat);
      arm.position.set(0.42, 2.9, 0);
      group.add(arm);
      const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.52, 0.36), material(theme.accent, { emissive: theme.accent, emissiveIntensity: 0.95, roughness: 0.2, transparent: true, opacity: 0.82 }));
      lantern.position.set(0.92, 2.58, 0);
      group.add(lantern);
      const lampGlow = new THREE.PointLight(theme.accent, 1.6, 18, 2);
      lampGlow.position.copy(lantern.position);
      group.add(lampGlow);
      animators.push((elapsed) => {
        lantern.scale.y = 1 + Math.sin(elapsed * 5 + object.x) * 0.05;
        lampGlow.intensity = 1.5 + Math.sin(elapsed * 9 + object.z) * 0.15;
      });
      break;
    }
    case 'banner': {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.3, 8), mats.metalMat);
      pole.position.y = 1.65;
      group.add(pole);
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.8, 1, 6), mats.fabricMat);
      cloth.position.set(0.6, 2.1, 0);
      cloth.rotation.y = -Math.PI / 2;
      group.add(cloth);
      animators.push((elapsed) => {
        cloth.rotation.z = Math.sin(elapsed * 1.8 + object.x) * 0.08;
      });
      break;
    }
    case 'bench': {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.14, 0.45), mats.carvedStoneMat);
      seat.position.y = 0.7;
      group.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.14, 0.45), mats.carvedStoneMat);
      back.position.set(0, 1.15, -0.2);
      back.rotation.x = 0.35;
      group.add(back);
      [-0.62, 0.62].forEach((x) => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.62, 0.14), mats.metalMat);
        leg.position.set(x, 0.32, 0);
        group.add(leg);
      });
      break;
    }
    case 'bookshelf': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(2, 2.6, 0.5), mats.carvedStoneMat);
      body.position.y = 1.3;
      group.add(body);
      for (let shelf = 0; shelf < 3; shelf += 1) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.46), mats.metalMat);
        plank.position.set(0, 0.62 + shelf * 0.7, 0);
        group.add(plank);
        for (let book = 0; book < 4; book += 1) {
          const volume = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.44 + (book % 2) * 0.08, 0.18), material(book % 2 === 0 ? theme.accentSoft : theme.accent, { emissive: book % 2 === 0 ? theme.accentSoft : theme.accent, emissiveIntensity: 0.12 }));
          volume.position.set(-0.62 + book * 0.42, 0.82 + shelf * 0.7, 0.06);
          group.add(volume);
        }
      }
      break;
    }
    case 'cart': {
      const bed = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 1.4), mats.carvedStoneMat);
      bed.position.y = 0.85;
      group.add(bed);
      [-0.9, 0.9].forEach((x) => {
        const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.08, 10, 18), mats.metalMat);
        wheel.position.set(x, 0.42, 0.72);
        wheel.rotation.y = Math.PI / 2;
        group.add(wheel);
        const wheel2 = wheel.clone();
        wheel2.position.z = -0.72;
        group.add(wheel2);
      });
      break;
    }
    case 'enemy': {
      return createEnemyVisual(object.enemyType, levelTheme);
    }
    case 'boss': {
      return createBossVisual(levelTheme);
    }
    case 'crackedWall': {
      const sigil = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.64, 5), material(accent, { emissive: accent, emissiveIntensity: 0.3, transparent: true, opacity: 0.92 }));
      sigil.position.set(0, 1.6, 0.05);
      sigil.rotation.y = Math.PI;
      group.add(sigil);
      animators.push((elapsed) => {
        sigil.rotation.z = elapsed;
      });
      break;
    }
    default:
      break;
  }

  return { mesh: group, animators };
}

export function createEnemyVisual(type, levelTheme) {
  const theme = THEMES[levelTheme] || THEMES.town;
  return createDetailedEnemyVisual(type, theme, levelTheme);
}

export function createBossVisual(levelTheme) {
  const theme = THEMES[levelTheme] || THEMES.boss;
  return createDetailedBossVisual(theme, levelTheme);
}

export function runeColor(rune) {
  switch (rune) {
    case 'Amber':
      return 0xffba61;
    case 'Tide':
      return 0x67dfff;
    case 'Ember':
      return 0xff6a67;
    case 'Dawn':
      return 0xfff2ae;
    case 'Verse':
      return 0x9cf3ff;
    case 'Chord':
      return 0xffc67d;
    case 'Crescent':
      return 0xd0bcff;
    default:
      return 0xffffff;
  }
}

export function makeImpactBurst(color = 0xffffff, count = 10) {
  const group = new THREE.Group();
  const pieces = [];
  const mat = material(color, { emissive: color, emissiveIntensity: 0.6, roughness: 0.18 });
  for (let i = 0; i < count; i += 1) {
    const bit = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.5), mat);
    const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize();
    bit.userData.velocity = dir.multiplyScalar(4 + Math.random() * 6);
    pieces.push(bit);
    group.add(bit);
  }
  group.userData.pieces = pieces;
  return group;
}
