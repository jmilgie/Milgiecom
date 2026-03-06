import * as THREE from '../vendor/three.module.js';

const textureCache = new Map();

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

function makeTexture(key, painter, repeat = [1, 1]) {
  if (textureCache.has(key)) return textureCache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  painter(ctx, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.anisotropy = 4;
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
    roughness: extras.roughness ?? 0.72,
    metalness: extras.metalness ?? 0.08,
    emissive: extras.emissive ?? 0x000000,
    emissiveIntensity: extras.emissiveIntensity ?? 0,
    transparent: extras.transparent ?? false,
    opacity: extras.opacity ?? 1,
  });
}

export function buildThemeMaterials(theme) {
  const floorMap = makeStoneTexture(theme.floor, shade(theme.floorAlt, 0.08), shade(theme.wallTrim, -0.22), [2.2, 2.2]);
  const floorAltMap = makeStoneTexture(theme.floorAlt, shade(theme.floor, 0.1), shade(theme.wallTrim, -0.28), [2.2, 2.2]);
  const wallMap = makeStoneTexture(theme.wall, shade(theme.wallTrim, 0.12), shade(theme.wallTrim, -0.26), [1.6, 1.6]);
  const trimMap = makeFabricTexture(theme.wallTrim, shade(theme.accent, 0.18));
  const waterMap = makeWaterTexture(theme.hazard, theme.accentSoft, [1.5, 1.5]);
  const barkMap = makeBarkTexture(0x5a3d24, 0x7d5735);
  const leafMap = makeLeafTexture(0x5f8b4a, 0x8ed16c);
  const roofMap = makeRoofTexture(0x5a2b1c, 0x8f5337, [1.8, 1.8]);
  const fabricMap = makeFabricTexture(shade(theme.wallTrim, -0.06), theme.accent);

  return {
    floorMat: material(theme.floor, { map: floorMap, roughness: 0.9 }),
    floorAltMat: material(theme.floorAlt, { map: floorAltMap, roughness: 0.88 }),
    wallMat: material(theme.wall, { map: wallMap, roughness: 0.94 }),
    wallTrimMat: material(theme.wallTrim, { map: trimMap, roughness: 0.68, emissive: theme.wallTrim, emissiveIntensity: 0.03 }),
    hazardMat: material(theme.hazard, { map: fabricMap, emissive: theme.hazard, emissiveIntensity: 0.35, roughness: 0.32 }),
    waterMat: material(theme.hazard, { map: waterMap, transparent: true, opacity: 0.74, emissive: theme.hazard, emissiveIntensity: 0.22, roughness: 0.18 }),
    barkMat: material(0x5a3d24, { map: barkMap, roughness: 0.92 }),
    leafMat: material(0x5f8b4a, { map: leafMap, roughness: 0.82, emissive: 0x224415, emissiveIntensity: 0.05 }),
    roofMat: material(0x5a2b1c, { map: roofMap, roughness: 0.74 }),
    stoneMat: material(shade(theme.wallTrim, -0.1), { map: wallMap, roughness: 0.9 }),
    metalMat: material(shade(theme.wallTrim, 0.08), { roughness: 0.36, metalness: 0.72 }),
    potteryMat: material(0x8f5d34, { roughness: 0.92 }),
    fabricMat: material(shade(theme.wallTrim, -0.04), { map: fabricMap, roughness: 0.74 }),
    paperMat: material(shade(theme.ambient, 0.08), { roughness: 0.95 }),
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
