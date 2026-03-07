import * as THREE from '../vendor/three.module.js';
import { buildActorMaterials } from './art.mjs';

const HEAD_GEO = new THREE.SphereGeometry(0.34, 22, 22);
const HAIR_CAP_GEO = new THREE.SphereGeometry(0.37, 20, 20, 0, Math.PI * 2, 0, Math.PI * 0.62);
const TORSO_GEO = new THREE.CapsuleGeometry(0.34, 0.88, 6, 10);
const HIP_GEO = new THREE.CylinderGeometry(0.36, 0.42, 0.34, 12);
const ARM_GEO = new THREE.CylinderGeometry(0.1, 0.12, 0.72, 10);
const FOREARM_GEO = new THREE.CylinderGeometry(0.09, 0.1, 0.62, 10);
const HAND_GEO = new THREE.SphereGeometry(0.1, 10, 10);
const LEG_GEO = new THREE.CylinderGeometry(0.12, 0.15, 0.82, 10);
const SHIN_GEO = new THREE.CylinderGeometry(0.11, 0.14, 0.78, 10);
const BOOT_GEO = new THREE.BoxGeometry(0.24, 0.22, 0.4);
const ROBE_GEO = new THREE.LatheGeometry([
  new THREE.Vector2(0.18, 0),
  new THREE.Vector2(0.34, 0.08),
  new THREE.Vector2(0.44, 0.28),
  new THREE.Vector2(0.54, 0.72),
  new THREE.Vector2(0.68, 1.22),
], 18);
const MANTLE_GEO = new THREE.CylinderGeometry(0.52, 0.72, 0.74, 18, 1, true);
const SHAWL_GEO = new THREE.BoxGeometry(0.86, 0.38, 0.78);
const SATCHEL_GEO = new THREE.BoxGeometry(0.34, 0.44, 0.18);
const SCROLL_GEO = new THREE.CylinderGeometry(0.08, 0.08, 0.44, 12);
const CHARM_GEO = new THREE.OctahedronGeometry(0.09, 0);
const STAFF_GEO = new THREE.CylinderGeometry(0.05, 0.06, 2.15, 8);
const HAMMER_HEAD_GEO = new THREE.BoxGeometry(0.28, 0.18, 0.18);
const LUTE_BODY_GEO = new THREE.SphereGeometry(0.28, 18, 18);
const LUTE_NECK_GEO = new THREE.BoxGeometry(0.12, 0.72, 0.08);
const WARDEN_CHEST_GEO = new THREE.BoxGeometry(1.1, 1.45, 0.72);
const WARDEN_PELVIS_GEO = new THREE.BoxGeometry(0.92, 0.48, 0.54);
const WARDEN_HELM_GEO = new THREE.CylinderGeometry(0.44, 0.5, 0.86, 8);
const WARDEN_PAULDRON_GEO = new THREE.BoxGeometry(0.46, 0.42, 0.98);
const BOSS_BODY_GEO = new THREE.IcosahedronGeometry(1.4, 1);
const BOSS_HEART_GEO = new THREE.OctahedronGeometry(0.72, 1);
const BOSS_SPIKE_GEO = new THREE.BoxGeometry(0.28, 1.34, 0.72);
const FACE_DECAL_GEO = new THREE.PlaneGeometry(0.56, 0.68);
const SIGIL_PANEL_GEO = new THREE.PlaneGeometry(0.9, 0.9);
const RUNE_DISC_GEO = new THREE.CircleGeometry(1, 28);

function cloneMaterial(baseMaterial, color, extras = {}) {
  const mat = baseMaterial.clone();
  mat.color.setHex(color);
  if (extras.roughness !== undefined) mat.roughness = extras.roughness;
  if (extras.metalness !== undefined) mat.metalness = extras.metalness;
  mat.transparent = extras.transparent ?? mat.transparent;
  mat.opacity = extras.opacity ?? mat.opacity;
  mat.emissive.setHex(extras.emissive ?? 0x000000);
  mat.emissiveIntensity = extras.emissiveIntensity ?? mat.emissiveIntensity;
  return mat;
}

function shadeColor(color, amount) {
  const source = new THREE.Color(color);
  if (amount >= 0) {
    source.lerp(new THREE.Color(0xffffff), amount);
  } else {
    source.lerp(new THREE.Color(0x000000), Math.abs(amount));
  }
  return source.getHex();
}

function makeRing(color, radius = 0.34, tube = 0.06) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, tube, 10, 24),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.42, roughness: 0.22 }),
  );
  ring.rotation.x = Math.PI / 2;
  return ring;
}

function addLimb(group, geometry, material, x, y, z, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  group.add(mesh);
  return mesh;
}

function buildHumanoid(profile, theme, levelTheme, mats = buildActorMaterials(theme, levelTheme)) {
  const group = new THREE.Group();
  const animators = [];

  const bodyMat = cloneMaterial(profile.bodyBase, profile.bodyColor, { roughness: profile.bodyRoughness ?? 0.86 });
  const overlayMat = cloneMaterial(profile.overlayBase, profile.overlayColor, { roughness: profile.overlayRoughness ?? 0.8, emissive: profile.overlayEmissive ?? 0x000000, emissiveIntensity: profile.overlayEmissiveIntensity ?? 0 });
  const beltMat = cloneMaterial(mats.leatherMat, profile.leatherColor ?? 0x6a4c38, { roughness: 0.9 });
  const bootMat = cloneMaterial(mats.leatherMat, shadeColor(profile.leatherColor ?? 0x6a4c38, -0.08), { roughness: 0.9 });
  const hairMat = cloneMaterial(mats.hairMat, profile.hairColor, { roughness: 0.82 });
  const skinMat = profile.skin === 'aged' ? mats.skinAgedMat : mats.skinYoungMat;

  const pelvis = addLimb(group, HIP_GEO, bodyMat, 0, 0.98, 0);
  const robe = addLimb(group, ROBE_GEO, bodyMat, 0, 0.28, 0);
  robe.scale.set(profile.bodyWidth ?? 1, profile.bodyHeight ?? 1, profile.bodyWidth ?? 1);

  const torso = addLimb(group, TORSO_GEO, overlayMat, 0, 1.66, 0.02);
  torso.scale.set(profile.shoulderScale ?? 1, 1.04, profile.chestDepth ?? 1);
  const mantle = addLimb(group, MANTLE_GEO, overlayMat, 0, 1.96, -0.02);
  mantle.scale.set(profile.shoulderScale ?? 1.08, 1, 1.02);
  const shawl = addLimb(group, SHAWL_GEO, cloneMaterial(mats.frontierClothMat, profile.shawlColor ?? profile.overlayColor, { roughness: 0.84 }), 0, 1.98, 0.02);
  shawl.scale.set(profile.shawlScale ?? 1, 1, 1);

  const belt = addLimb(group, new THREE.TorusGeometry(0.37, 0.045, 10, 24), beltMat, 0, 1.18, 0.02, Math.PI / 2, 0, 0);
  belt.scale.set(profile.beltScale ?? 1, 1, 1);

  const leftLeg = addLimb(group, LEG_GEO, bodyMat, -0.18, 0.48, 0.02);
  const rightLeg = addLimb(group, LEG_GEO, bodyMat, 0.18, 0.48, 0.02);
  const leftShin = addLimb(group, SHIN_GEO, bootMat, -0.18, 0.07, 0.04);
  const rightShin = addLimb(group, SHIN_GEO, bootMat, 0.18, 0.07, 0.04);
  addLimb(group, BOOT_GEO, bootMat, -0.18, -0.25, 0.11);
  addLimb(group, BOOT_GEO, bootMat, 0.18, -0.25, 0.11);

  const leftUpperArm = addLimb(group, ARM_GEO, overlayMat, -0.54 * (profile.shoulderScale ?? 1), 1.74, 0, 0, 0, 0.22);
  const rightUpperArm = addLimb(group, ARM_GEO, overlayMat, 0.54 * (profile.shoulderScale ?? 1), 1.74, 0, 0, 0, -0.22);
  const leftForearm = addLimb(group, FOREARM_GEO, cloneMaterial(mats.frontierClothMat, profile.forearmColor ?? profile.bodyColor, { roughness: 0.84 }), -0.68, 1.14, 0.02, 0, 0, 0.12);
  const rightForearm = addLimb(group, FOREARM_GEO, cloneMaterial(mats.frontierClothMat, profile.forearmColor ?? profile.bodyColor, { roughness: 0.84 }), 0.68, 1.14, 0.02, 0, 0, -0.12);
  addLimb(group, HAND_GEO, skinMat, -0.72, 0.78, 0.06);
  addLimb(group, HAND_GEO, skinMat, 0.72, 0.78, 0.06);

  const head = addLimb(group, HEAD_GEO, skinMat, 0, 2.52, 0.04);
  head.scale.set(1, 1.04, 0.96);
  const hairCap = addLimb(group, HAIR_CAP_GEO, hairMat, 0, 2.58, -0.02);
  hairCap.scale.set(1.02, 1.02, 1.02);
  const hairBack = addLimb(group, new THREE.CylinderGeometry(0.16, 0.24, profile.hairLength ?? 0.56, 12), hairMat, 0, 2.22 - (profile.hairLength ?? 0.56) * 0.18, -0.2, 0.22, 0, 0);
  if (profile.faceMat) {
    const face = addLimb(group, FACE_DECAL_GEO, profile.faceMat, 0, 2.48 + (profile.faceOffsetY ?? 0), 0.34 + (profile.faceOffsetZ ?? 0));
    face.scale.set(profile.faceScale ?? 0.92, profile.faceScaleY ?? 0.98, 1);
    face.renderOrder = 5;
  }

  const halo = makeRing(theme.accentSoft, 0.34, 0.05);
  halo.position.y = 3.1;
  group.add(halo);

  if (profile.staff) {
    const staff = addLimb(group, STAFF_GEO, cloneMaterial(mats.leatherMat, 0x684f3b, { roughness: 0.88 }), -0.82, 1.02, 0.18, 0, 0, 0.1);
    const topper = addLimb(group, new THREE.OctahedronGeometry(0.18, 0), cloneMaterial(mats.crystalMat, theme.accent, { emissive: theme.accent, emissiveIntensity: 0.7, roughness: 0.14 }), -0.82, 2.12, 0.18);
    animators.push((elapsed) => {
      topper.rotation.y += 0.02;
      staff.rotation.z = 0.08 + Math.sin(elapsed * 1.3) * 0.02;
    });
  }

  if (profile.apron) {
    const apron = addLimb(group, new THREE.BoxGeometry(0.72, 1.1, 0.08), cloneMaterial(mats.apronMat, profile.apronColor ?? 0x7b5644, { roughness: 0.92 }), 0, 1.14, 0.42, 0.08, 0, 0);
    apron.scale.x = 0.98;
  }

  if (profile.hammer) {
    const haft = addLimb(group, new THREE.CylinderGeometry(0.03, 0.03, 0.72, 8), cloneMaterial(mats.leatherMat, 0x6a4f3b, { roughness: 0.88 }), 0.44, 1.02, -0.24, 0.4, 0, 0.1);
    addLimb(group, HAMMER_HEAD_GEO, mats.metalMat, 0.44, 1.33, -0.18, 0.2, 0, 0);
    animators.push((elapsed) => {
      haft.rotation.z = 0.1 + Math.sin(elapsed * 1.4) * 0.03;
    });
  }

  if (profile.lute) {
    const luteBody = addLimb(group, LUTE_BODY_GEO, cloneMaterial(mats.frontierClothMat, 0x6f4a34, { roughness: 0.72 }), -0.52, 1.52, -0.32, 0.38, 0.2, 0);
    luteBody.scale.set(0.85, 1.05, 0.58);
    addLimb(group, LUTE_NECK_GEO, cloneMaterial(mats.leatherMat, 0x5b4030, { roughness: 0.74 }), -0.3, 1.96, -0.28, 0.68, 0.1, -0.2);
  }

  if (profile.satchel) {
    const satchel = addLimb(group, SATCHEL_GEO, cloneMaterial(mats.leatherMat, 0x79583f, { roughness: 0.9 }), 0.52, 1.16, 0.34, 0.08, 0, -0.16);
    const strap = addLimb(group, new THREE.TorusGeometry(0.52, 0.03, 8, 24, Math.PI), cloneMaterial(mats.leatherMat, 0x79583f, { roughness: 0.9 }), 0.04, 1.68, 0.14, Math.PI * 0.36, 0.18, Math.PI * 0.32);
    satchel.userData.sway = Math.random() * Math.PI * 2;
    strap.userData.sway = satchel.userData.sway;
    animators.push((elapsed) => {
      const sway = Math.sin(elapsed * 1.8 + satchel.userData.sway) * 0.08;
      satchel.rotation.z = -0.16 + sway * 0.35;
      strap.rotation.x = Math.PI * 0.36 + sway * 0.06;
    });
  }

  if (profile.scrolls) {
    for (let i = 0; i < 2; i += 1) {
      addLimb(group, SCROLL_GEO, mats.paperMat, 0.38 + i * 0.14, 1.56 - i * 0.12, -0.3 + i * 0.08, Math.PI / 2 - 0.18, 0, 0.24);
    }
  }

  if (profile.charms) {
    const charmMat = cloneMaterial(mats.crystalMat, theme.accentSoft, { emissive: theme.accentSoft, emissiveIntensity: 0.8, roughness: 0.12 });
    const charms = [];
    for (let i = 0; i < 3; i += 1) {
      const charm = addLimb(group, CHARM_GEO, charmMat, -0.24 + i * 0.22, 1.88 - i * 0.12, 0.42 - i * 0.08);
      charms.push(charm);
    }
    animators.push((elapsed) => {
      charms.forEach((charm, index) => {
        charm.position.y += Math.sin(elapsed * 2.2 + index * 0.8) * 0.0015;
        charm.rotation.y += 0.02;
      });
    });
  }

  animators.push((elapsed) => {
    const bob = Math.sin(elapsed * 1.6 + (profile.phase || 0)) * 0.03;
    group.position.y = bob;
    halo.rotation.z = elapsed * 0.7;
    leftUpperArm.rotation.x = Math.sin(elapsed * 1.3 + 0.4) * 0.08;
    rightUpperArm.rotation.x = Math.sin(elapsed * 1.3 + 1.1) * 0.08;
    leftForearm.rotation.z = 0.12 + Math.sin(elapsed * 1.7) * 0.05;
    rightForearm.rotation.z = -0.12 - Math.sin(elapsed * 1.7) * 0.05;
    hairBack.rotation.z = Math.sin(elapsed * 1.9 + (profile.phase || 0)) * 0.08;
    mantle.rotation.y = Math.sin(elapsed * 1.1 + (profile.phase || 0)) * 0.04;
  });

  return { mesh: group, animators };
}

export function createNpcVisual(object, theme, levelTheme) {
  const mats = buildActorMaterials(theme, levelTheme);
  const profiles = {
    elder: {
      skin: 'aged',
      bodyBase: mats.frontierClothMat,
      bodyColor: 0x776255,
      overlayBase: mats.brocadeClothMat,
      overlayColor: 0xb28d5f,
      leatherColor: 0x755946,
      shawlColor: 0xd7c29a,
      hairColor: 0xd4d0cc,
      hairLength: 0.86,
      shoulderScale: 1.05,
      faceMat: mats.elderFaceMat,
      faceScale: 0.9,
      faceScaleY: 1.02,
      staff: true,
      phase: 0.4,
    },
    smith: {
      skin: 'young',
      bodyBase: mats.frontierClothMat,
      bodyColor: 0x514740,
      overlayBase: mats.apronMat,
      overlayColor: 0x8a583f,
      leatherColor: 0x684734,
      shawlColor: 0x5a4f47,
      hairColor: 0x3f332d,
      hairLength: 0.38,
      shoulderScale: 1.15,
      faceMat: mats.smithFaceMat,
      faceScale: 0.89,
      faceScaleY: 0.98,
      apron: true,
      hammer: true,
      phase: 1.2,
    },
    bard: {
      skin: 'young',
      bodyBase: mats.brocadeClothMat,
      bodyColor: 0x6f4f68,
      overlayBase: mats.frontierClothMat,
      overlayColor: 0xb48a54,
      leatherColor: 0x6a4b36,
      shawlColor: 0x7d576b,
      hairColor: 0x524539,
      hairLength: 0.62,
      shoulderScale: 1.02,
      faceMat: mats.bardFaceMat,
      faceScale: 0.87,
      faceScaleY: 0.95,
      lute: true,
      phase: 2.4,
    },
    cartographer: {
      skin: 'young',
      bodyBase: mats.explorerClothMat,
      bodyColor: 0x4b6e84,
      overlayBase: mats.frontierClothMat,
      overlayColor: 0xd0bb97,
      leatherColor: 0x73553d,
      shawlColor: 0x456b80,
      hairColor: 0x413730,
      hairLength: 0.68,
      shoulderScale: 1.06,
      faceMat: mats.cartographerFaceMat,
      faceScale: 0.88,
      faceScaleY: 0.98,
      satchel: true,
      scrolls: true,
      phase: 3.1,
    },
    glassweaver: {
      skin: 'young',
      bodyBase: mats.glassClothMat,
      bodyColor: 0xc2d4de,
      overlayBase: mats.brocadeClothMat,
      overlayColor: 0x8db9cf,
      leatherColor: 0x6b594d,
      shawlColor: 0xdfe8ef,
      hairColor: 0x5e4e44,
      hairLength: 0.54,
      shoulderScale: 1,
      faceMat: mats.glassweaverFaceMat,
      faceScale: 0.9,
      faceScaleY: 0.98,
      charms: true,
      phase: 4.2,
    },
  };

  return buildHumanoid(profiles[object.id] || profiles.elder, theme, levelTheme, mats);
}

export function createEnemyVisual(type, theme, levelTheme) {
  const mats = buildActorMaterials(theme, levelTheme);
  const group = new THREE.Group();
  const animators = [];

  if (type === 'wisp') {
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.46, 1), cloneMaterial(mats.wispEnergyMat, theme.accentSoft, { emissive: theme.accentSoft, emissiveIntensity: 0.92, opacity: 0.9, transparent: true }));
    core.position.y = 1.24;
    group.add(core);

    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.74, 0), cloneMaterial(mats.wispEnergyMat, theme.accent, { emissive: theme.accent, emissiveIntensity: 0.55, opacity: 0.34, transparent: true, roughness: 0.12 }));
    shell.position.y = 1.24;
    group.add(shell);

    const sigils = [];
    for (let i = 0; i < 3; i += 1) {
      const sigil = addLimb(group, i === 2 ? RUNE_DISC_GEO : SIGIL_PANEL_GEO, mats.wispRuneMat.clone(), 0, 1.24, 0);
      sigil.scale.set(i === 2 ? 1.28 : 1.36, i === 2 ? 1.28 : 1.36, 1);
      if (i === 2) {
        sigil.rotation.x = Math.PI / 2;
      } else {
        sigil.rotation.y = i * (Math.PI / 3);
      }
      sigils.push(sigil);
    }

    const rings = [];
    for (let i = 0; i < 3; i += 1) {
      const ring = makeRing(i % 2 === 0 ? theme.accent : theme.accentSoft, 0.58 + i * 0.14, 0.03);
      ring.position.y = 1.2;
      ring.rotation.y = i * 0.6;
      rings.push(ring);
      group.add(ring);
    }

    const shards = [];
    for (let i = 0; i < 6; i += 1) {
      const shard = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.62, 0.28), cloneMaterial(mats.crystalMat, i % 2 === 0 ? theme.accentSoft : theme.accent, { emissive: i % 2 === 0 ? theme.accentSoft : theme.accent, emissiveIntensity: 0.72, roughness: 0.08 }));
      shard.userData.angle = (Math.PI * 2 * i) / 6;
      shard.position.y = 1.24;
      shards.push(shard);
      group.add(shard);
    }

    animators.push((elapsed) => {
      core.rotation.y += 0.012;
      shell.rotation.x = elapsed * 0.3;
      shell.rotation.y = elapsed * 0.24;
      group.position.y = Math.sin(elapsed * 2.3) * 0.08;
      rings.forEach((ring, index) => {
        ring.rotation.z = elapsed * (0.9 + index * 0.35);
      });
      sigils.forEach((sigil, index) => {
        if (index === 2) {
          sigil.rotation.z = elapsed * 0.8;
          sigil.position.y = 1.14 + Math.sin(elapsed * 2.2) * 0.05;
        } else {
          sigil.rotation.y = elapsed * (0.5 + index * 0.2) + index * 1.1;
        }
        sigil.material.opacity = 0.72 + Math.sin(elapsed * 3 + index) * 0.12;
      });
      shards.forEach((shard, index) => {
        const angle = elapsed * 1.2 + shard.userData.angle;
        shard.position.set(Math.cos(angle) * (0.78 + index * 0.01), 1.24 + Math.sin(elapsed * 3 + index) * 0.18, Math.sin(angle) * (0.78 + index * 0.01));
        shard.lookAt(core.position);
      });
    });
  } else if (type === 'warden') {
    const torso = addLimb(group, WARDEN_CHEST_GEO, cloneMaterial(mats.wardenArmorMat, shadeColor(theme.wallTrim, -0.08), { metalness: 0.62, roughness: 0.4 }), 0, 1.56, 0);
    addLimb(group, WARDEN_PELVIS_GEO, cloneMaterial(mats.carvedStoneMat, theme.wall, { roughness: 0.82 }), 0, 0.82, 0);
    const helm = addLimb(group, WARDEN_HELM_GEO, cloneMaterial(mats.wardenArmorMat, shadeColor(theme.wallTrim, -0.04), { metalness: 0.64, roughness: 0.36 }), 0, 2.52, 0.04);
    addLimb(group, new THREE.BoxGeometry(0.82, 0.18, 0.3), cloneMaterial(mats.wispEnergyMat, theme.accentSoft, { emissive: theme.accentSoft, emissiveIntensity: 0.88, opacity: 0.92, transparent: true }), 0, 2.5, 0.42);
    const visorSigil = addLimb(group, SIGIL_PANEL_GEO, mats.wardenRuneMat.clone(), 0, 2.48, 0.48);
    visorSigil.scale.set(0.72, 0.72, 1);
    const chestSigil = addLimb(group, RUNE_DISC_GEO, mats.wardenRuneMat.clone(), 0, 1.54, 0.41);
    chestSigil.scale.set(0.56, 0.56, 1);

    [-1, 1].forEach((side) => {
      addLimb(group, WARDEN_PAULDRON_GEO, cloneMaterial(mats.carvedStoneMat, theme.wallTrim, { roughness: 0.8 }), side * 0.78, 1.92, 0);
      addLimb(group, new THREE.CylinderGeometry(0.14, 0.18, 0.84, 10), mats.wardenArmorMat, side * 0.88, 1.28, 0.02, 0, 0, side * 0.08);
      addLimb(group, new THREE.CylinderGeometry(0.12, 0.14, 0.72, 10), mats.metalMat, side * 0.96, 0.7, 0.08, 0, 0, side * 0.12);
      addLimb(group, new THREE.CylinderGeometry(0.16, 0.18, 0.96, 10), cloneMaterial(mats.wardenArmorMat, shadeColor(theme.wallTrim, -0.08), { metalness: 0.58, roughness: 0.42 }), side * 0.32, 0.28, 0.06, 0, 0, side * 0.04);
      addLimb(group, new THREE.CylinderGeometry(0.13, 0.15, 0.88, 10), mats.metalMat, side * 0.32, -0.34, 0.14, 0, 0, side * 0.02);
      addLimb(group, BOOT_GEO, mats.metalMat, side * 0.32, -0.78, 0.18);
    });

    const crown = addLimb(group, new THREE.OctahedronGeometry(0.28, 1), cloneMaterial(mats.crystalMat, theme.accent, { emissive: theme.accent, emissiveIntensity: 0.86 }), 0, 3.08, 0);
    const staff = addLimb(group, STAFF_GEO, mats.metalMat, 0.92, 1.08, 0.12, 0, 0, 0.14);
    addLimb(group, new THREE.OctahedronGeometry(0.18, 0), cloneMaterial(mats.crystalMat, theme.accentSoft, { emissive: theme.accentSoft, emissiveIntensity: 0.9 }), 0.92, 2.08, 0.12);

    const bannerStrips = [];
    for (let i = 0; i < 2; i += 1) {
      const strip = addLimb(group, new THREE.BoxGeometry(0.2, 1.2, 0.04), cloneMaterial(mats.frontierClothMat, theme.wallTrim, { roughness: 0.78, emissive: theme.accent, emissiveIntensity: 0.06 }), -0.22 + i * 0.44, 0.8, -0.3);
      bannerStrips.push(strip);
    }

    animators.push((elapsed) => {
      crown.rotation.y += 0.024;
      helm.rotation.y = Math.sin(elapsed * 0.8) * 0.08;
      torso.rotation.y = Math.sin(elapsed * 0.9) * 0.06;
      staff.rotation.z = 0.14 + Math.sin(elapsed * 1.2) * 0.03;
      visorSigil.material.opacity = 0.84 + Math.sin(elapsed * 3.2) * 0.08;
      chestSigil.rotation.z = -elapsed * 0.6;
      chestSigil.material.emissiveIntensity = 0.9 + Math.sin(elapsed * 2.4) * 0.14;
      bannerStrips.forEach((strip, index) => {
        strip.rotation.z = Math.sin(elapsed * 2.4 + index * 0.8) * 0.08;
      });
    });
  } else {
    const abdomen = addLimb(group, new THREE.SphereGeometry(0.62, 20, 20), cloneMaterial(mats.crawlerShellMat, 0x83907f, { roughness: 0.48 }), 0, 0.82, -0.18);
    abdomen.scale.set(1.08, 0.82, 1.34);
    const thorax = addLimb(group, new THREE.SphereGeometry(0.5, 18, 18), cloneMaterial(mats.crawlerShellMat, 0x758372, { roughness: 0.5 }), 0, 0.94, 0.32);
    thorax.scale.set(1, 0.88, 1);
    const underbody = addLimb(group, new THREE.SphereGeometry(0.56, 18, 18), cloneMaterial(mats.crawlerHideMat, 0x8f7666, { roughness: 0.68 }), 0, 0.66, 0.02);
    underbody.scale.set(0.92, 0.5, 1.28);
    const head = addLimb(group, new THREE.OctahedronGeometry(0.38, 1), cloneMaterial(mats.crawlerShellMat, 0x93a084, { roughness: 0.42, emissive: theme.accentSoft, emissiveIntensity: 0.08 }), 0, 1.02, 0.98);
    const eyeBand = addLimb(group, SIGIL_PANEL_GEO, mats.crawlerEyesMat.clone(), 0, 1.08, 1.19, -0.04, 0, 0);
    eyeBand.scale.set(0.88, 0.34, 1);

    const eyes = [];
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 2; i += 1) {
        const eye = addLimb(group, new THREE.SphereGeometry(0.06, 10, 10), cloneMaterial(mats.wispEnergyMat, theme.accentSoft, { emissive: theme.accentSoft, emissiveIntensity: 0.95, opacity: 0.92, transparent: true }), side * (0.14 + i * 0.08), 1.1 + i * 0.04, 1.12);
        eyes.push(eye);
      }
    }

    const mandibles = [];
    for (let side = -1; side <= 1; side += 2) {
      const mandible = addLimb(group, new THREE.ConeGeometry(0.08, 0.48, 5), cloneMaterial(mats.crawlerHideMat, 0x7b5f4d, { roughness: 0.72 }), side * 0.18, 0.94, 1.3, Math.PI / 2, 0, side * 0.5);
      mandibles.push(mandible);
    }

    const legs = [];
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 4; i += 1) {
        const upper = addLimb(group, new THREE.BoxGeometry(0.14, 0.14, 0.72), mats.crawlerShellMat, side * (0.54 + i * 0.06), 0.56, -0.34 + i * 0.38, 0, 0, side * 0.72);
        const lower = addLimb(group, new THREE.BoxGeometry(0.12, 0.12, 0.78), mats.crawlerHideMat, side * (0.92 + i * 0.08), 0.3, -0.34 + i * 0.4, 0.1, 0, side * 0.4);
        legs.push({ upper, lower, index: i, side });
      }
    }

    const spines = [];
    for (let i = 0; i < 3; i += 1) {
      const spine = addLimb(group, new THREE.ConeGeometry(0.08, 0.34, 5), cloneMaterial(mats.crystalMat, theme.accent, { emissive: theme.accent, emissiveIntensity: 0.52, roughness: 0.12 }), 0, 1.18, -0.12 + i * 0.36, -0.2, 0, 0);
      spines.push(spine);
    }

    animators.push((elapsed) => {
      abdomen.position.y = 0.82 + Math.sin(elapsed * 5.1) * 0.05;
      thorax.position.y = 0.94 + Math.sin(elapsed * 5.1 + 0.25) * 0.04;
      head.rotation.y = Math.sin(elapsed * 2.6) * 0.24;
      mandibles.forEach((mandible, index) => {
        mandible.rotation.z = (index === 0 ? -0.5 : 0.5) + Math.sin(elapsed * 6.2 + index) * 0.06;
      });
      legs.forEach(({ upper, lower, index, side }) => {
        upper.rotation.x = Math.sin(elapsed * 7 + index) * 0.18;
        lower.rotation.x = -0.18 + Math.sin(elapsed * 7 + index + 0.8) * 0.16;
        upper.rotation.z = side * (0.72 + Math.sin(elapsed * 5 + index) * 0.04);
        lower.rotation.z = side * (0.4 + Math.sin(elapsed * 5 + index + 0.4) * 0.03);
      });
      spines.forEach((spine, index) => {
        spine.position.y = 1.18 + Math.sin(elapsed * 4 + index) * 0.03;
      });
      eyeBand.material.opacity = 0.82 + Math.sin(elapsed * 7.4) * 0.1;
      eyes.forEach((eye, index) => {
        eye.material.emissiveIntensity = 0.85 + Math.sin(elapsed * 9 + index) * 0.1;
      });
    });
  }

  return { mesh: group, animators };
}

export function createBossVisual(theme, levelTheme) {
  const mats = buildActorMaterials(theme, levelTheme);
  const group = new THREE.Group();
  const animators = [];

  const lowerRing = addLimb(group, new THREE.TorusGeometry(2.1, 0.28, 12, 36), cloneMaterial(mats.choirGildedMat, theme.wallTrim, { emissive: theme.wallTrim, emissiveIntensity: 0.14, metalness: 0.82 }), 0, 1.5, 0, Math.PI / 2, 0, 0);
  const body = addLimb(group, BOSS_BODY_GEO, cloneMaterial(mats.choirObsidianMat, shadeColor(theme.wall, 0.02), { emissive: theme.accent, emissiveIntensity: 0.08, roughness: 0.22 }), 0, 2.28, 0);
  body.scale.set(1.05, 1.34, 1.05);
  const heart = addLimb(group, BOSS_HEART_GEO, cloneMaterial(mats.choirHeartSurfaceMat, theme.accentSoft, { emissive: theme.accentSoft, emissiveIntensity: 0.92, roughness: 0.08 }), 0, 2.22, 0.18);
  const heartShell = addLimb(group, new THREE.IcosahedronGeometry(0.88, 1), cloneMaterial(mats.choirHeartSurfaceMat, theme.accentSoft, { emissive: theme.accentSoft, emissiveIntensity: 0.28, roughness: 0.12, transparent: true, opacity: 0.88 }), 0, 2.22, 0.18);
  heartShell.scale.set(0.86, 1.1, 0.86);
  const heartSigil = addLimb(group, SIGIL_PANEL_GEO, mats.choirHeartMaskMat.clone(), 0, 2.22, 1.02);
  heartSigil.scale.set(1.18, 1.18, 1);
  const frontHalo = addLimb(group, RUNE_DISC_GEO, mats.choirRuneMat.clone(), 0, 2.18, 1.18);
  frontHalo.scale.set(1.82, 1.82, 1);
  const rearHalo = addLimb(group, RUNE_DISC_GEO, mats.choirRuneMat.clone(), 0, 2.18, -1.18, 0, Math.PI, 0);
  rearHalo.scale.set(1.64, 1.64, 1);

  const crown = [];
  for (let i = 0; i < 7; i += 1) {
    const spike = addLimb(group, BOSS_SPIKE_GEO, cloneMaterial(mats.choirGildedMat, theme.wallTrim, { emissive: theme.wallTrim, emissiveIntensity: 0.12, metalness: 0.82 }), 0, 3.58, 0);
    const angle = (Math.PI * 2 * i) / 7;
    spike.position.set(Math.cos(angle) * 1.54, 3.14, Math.sin(angle) * 1.54);
    spike.lookAt(0, 4.8, 0);
    crown.push(spike);
  }

  const mantle = [];
  for (let i = 0; i < 6; i += 1) {
    const shard = addLimb(group, new THREE.BoxGeometry(0.34, 1.48, 0.82), cloneMaterial(mats.choirObsidianMat, shadeColor(theme.wall, 0.04), { emissive: theme.accent, emissiveIntensity: 0.06, roughness: 0.24 }), 0, 1.58, 0);
    const angle = (Math.PI * 2 * i) / 6;
    shard.position.set(Math.cos(angle) * 1.9, 1.72, Math.sin(angle) * 1.9);
    shard.lookAt(0, 1.7, 0);
    mantle.push(shard);
  }

  const banners = [];
  for (let i = 0; i < 3; i += 1) {
    const banner = addLimb(group, new THREE.BoxGeometry(0.24, 2.2, 0.05), cloneMaterial(mats.choirVeilMat, i % 2 === 0 ? theme.accent : theme.hazard, { emissive: i % 2 === 0 ? theme.accent : theme.hazard, emissiveIntensity: 0.12, roughness: 0.7 }), -0.5 + i * 0.5, 0.76, -1.28 + i * 0.24);
    banners.push(banner);
  }

  const orbiters = [];
  for (let i = 0; i < 4; i += 1) {
    const orb = addLimb(group, new THREE.OctahedronGeometry(0.46, 1), cloneMaterial(mats.crystalMat, theme.hazard, { emissive: theme.hazard, emissiveIntensity: 0.84, roughness: 0.08 }), 0, 2.2, 0);
    orb.userData.angle = (Math.PI * 2 * i) / 4;
    orbiters.push(orb);
  }

  animators.push((elapsed, entity) => {
    lowerRing.rotation.z = elapsed * 0.36;
    body.rotation.x = elapsed * 0.22;
    body.rotation.y = elapsed * 0.46;
    heart.rotation.y += 0.04;
    heartShell.rotation.x -= 0.016;
    heartShell.rotation.y += 0.03;
    heart.scale.setScalar(1 + Math.sin(elapsed * 4.2) * 0.1);
    heartShell.scale.setScalar(0.98 + Math.sin(elapsed * 4.2 + 0.3) * 0.08);
    heartSigil.material.opacity = 0.82 + Math.sin(elapsed * 5.2) * 0.12;
    frontHalo.rotation.z = elapsed * 0.32;
    rearHalo.rotation.z = -elapsed * 0.28;
    crown.forEach((spike, index) => {
      spike.rotation.y += 0.01;
      spike.position.y = 3.14 + Math.sin(elapsed * 2.2 + index) * 0.08;
    });
    mantle.forEach((shard, index) => {
      shard.position.y = 1.72 + Math.sin(elapsed * 2 + index) * 0.14;
      shard.rotation.y += 0.012;
    });
    banners.forEach((banner, index) => {
      banner.rotation.z = Math.sin(elapsed * 1.8 + index) * 0.08;
    });
    const shieldCount = entity?.state?.shieldCount ?? 3;
    orbiters.forEach((orb, index) => {
      orb.visible = index < shieldCount;
      if (orb.visible) {
        const angle = elapsed * 1.2 + orb.userData.angle;
        orb.position.set(Math.cos(angle) * 2.8, 2.22 + Math.sin(elapsed * 3 + index) * 0.3, Math.sin(angle) * 2.8);
      }
    });
  });

  return { mesh: group, animators };
}
