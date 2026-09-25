// Nova Lancers — compact QR Code (model 2) encoder for lobby invite links.
// Byte mode (UTF-8), error-correction levels L/M/Q/H (default M), versions 1–40 chosen
// automatically, all 8 masks evaluated with the standard penalty rules.
//
//   qrEncode(text, { ecl: 'M', minVersion: 1 }) -> { version, size, mask, ecl, get(x, y) -> bool, modules }
//   drawQR(canvas, text, { margin: 4, dark, light, ecl }) -> qr  (canvas sized to 1 px per module)

const ECL = {                      // formatBits per ISO/IEC 18004
  L: { ord: 0, bits: 1 }, M: { ord: 1, bits: 0 }, Q: { ord: 2, bits: 3 }, H: { ord: 3, bits: 2 },
};

// Indexed [ecl.ord][version]; index 0 unused.
const ECC_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

// Number of data+ecc bits available in a symbol (everything minus function patterns).
function rawDataModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const na = Math.floor(ver / 7) + 2;
    r -= (25 * na - 10) * na - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}
function dataCodewords(ver, e) {
  return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[e.ord][ver] * NUM_BLOCKS[e.ord][ver];
}

// --- GF(256) Reed–Solomon (primitive polynomial 0x11D) ---------------------------------
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
function rsDivisor(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < degree) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return r;
}
function rsRemainder(data, div) {
  const r = new Array(div.length).fill(0);
  for (const b of data) {
    const factor = b ^ r.shift();
    r.push(0);
    for (let i = 0; i < div.length; i++) r[i] ^= gfMul(div[i], factor);
  }
  return r;
}

function utf8(text) {
  if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(text));
  return Array.from(unescape(encodeURIComponent(text)), (c) => c.charCodeAt(0));
}

// --- Encoder ------------------------------------------------------------------------------
export function qrEncode(text, opt = {}) {
  const e = ECL[(opt.ecl || 'M').toUpperCase()] || ECL.M;
  const bytes = utf8(String(text));

  // 1. Smallest version that fits (byte mode: 4-bit mode + 8/16-bit count + data).
  let ver = Math.max(1, opt.minVersion | 0 || 1);
  for (; ; ver++) {
    if (ver > 40) throw new Error('QR: data too long');
    const need = 4 + (ver <= 9 ? 8 : 16) + bytes.length * 8;
    if (need <= dataCodewords(ver, e) * 8) break;
  }

  // 2. Bit stream: mode, count, data, terminator, byte align, pad bytes.
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0x4, 4);
  put(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const cap = dataCodewords(ver, e) * 8;
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    data.push(b);
  }

  // 3. Split into blocks, append ECC, interleave.
  const nBlocks = NUM_BLOCKS[e.ord][ver];
  const eccLen = ECC_PER_BLOCK[e.ord][ver];
  const raw = Math.floor(rawDataModules(ver) / 8);
  const nShort = nBlocks - (raw % nBlocks);
  const shortLen = Math.floor(raw / nBlocks);
  const div = rsDivisor(eccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < nShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const codewords = [];
  for (let i = 0; i < blocks[0].length; i++) {
    for (let j = 0; j < blocks.length; j++) {
      if (i !== shortLen - eccLen || j >= nShort) codewords.push(blocks[j][i]);
    }
  }

  // 4. Matrix with function patterns.
  const size = ver * 4 + 17;
  const mod = new Uint8Array(size * size);
  const fn = new Uint8Array(size * size);
  const setF = (x, y, dark) => { mod[y * size + x] = dark ? 1 : 0; fn[y * size + x] = 1; };

  for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      setF(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);

  if (ver > 1) {
    const na = Math.floor(ver / 7) + 2;
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2;
    const pos = [6];
    for (let p = size - 7; pos.length < na; p -= step) pos.splice(1, 0, p);
    for (let i = 0; i < na; i++) for (let j = 0; j < na; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        setF(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  const drawFormat = (mask) => {
    const d = (e.bits << 3) | mask;
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const fb = ((d << 10) | rem) ^ 0x5412;
    const bit = (i) => ((fb >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) setF(8, i, bit(i));
    setF(8, 7, bit(6)); setF(8, 8, bit(7)); setF(7, 8, bit(8));
    for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) setF(8, size - 15 + i, bit(i));
    setF(8, size - 8, true);                          // the always-dark module
  };
  drawFormat(0);                                      // reserve the area

  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const vb = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((vb >>> i) & 1) === 1;
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      setF(a, b, dark); setF(b, a, dark);
    }
  }

  // 5. Codewords in the zig-zag order.
  let bi = 0;
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const up = ((right + 1) & 2) === 0;
        const y = up ? size - 1 - v : v;
        const idx = y * size + x;
        if (!fn[idx] && bi < total) {
          mod[idx] = (codewords[bi >>> 3] >>> (7 - (bi & 7))) & 1;
          bi++;
        }
      }
    }
  }

  // 6. Try each mask, keep the lowest penalty.
  const applyMask = (m) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      if (fn[idx]) continue;
      let inv;
      switch (m) {
        case 0: inv = (x + y) % 2 === 0; break;
        case 1: inv = y % 2 === 0; break;
        case 2: inv = x % 3 === 0; break;
        case 3: inv = (x + y) % 3 === 0; break;
        case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: inv = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: inv = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: inv = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
      }
      if (inv) mod[idx] ^= 1;
    }
  };

  let mask = opt.mask != null ? opt.mask | 0 : -1;
  if (mask < 0 || mask > 7) {
    let best = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      const p = penalty(mod, size);
      if (p < best) { best = p; mask = m; }
      applyMask(m);                                   // XOR again = undo
    }
  }
  applyMask(mask); drawFormat(mask);

  return {
    version: ver, size, mask, ecl: Object.keys(ECL).find((k) => ECL[k] === e),
    modules: mod,
    get: (x, y) => x >= 0 && y >= 0 && x < size && y < size && mod[y * size + x] === 1,
  };
}

// Standard penalty: N1 runs, N2 2x2 blocks, N3 finder-like patterns, N4 dark balance.
function penalty(mod, size) {
  let score = 0;
  const hist = [0, 0, 0, 0, 0, 0, 0];
  const addHist = (len) => {
    if (hist[0] === 0) len += size;                   // light border before first run
    hist.pop(); hist.unshift(len);
  };
  const countFinder = () => {
    const n = hist[1];
    const core = n > 0 && hist[2] === n && hist[3] === n * 3 && hist[4] === n && hist[5] === n;
    return (core && hist[0] >= n * 4 && hist[6] >= n ? 1 : 0) + (core && hist[6] >= n * 4 && hist[0] >= n ? 1 : 0);
  };
  const terminate = (color, len) => {
    if (color) { addHist(len); len = 0; }
    len += size;
    addHist(len);
    return countFinder();
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < size; a++) {
      let color = 0, run = 0;
      hist.fill(0);
      for (let b = 0; b < size; b++) {
        const c = pass === 0 ? mod[a * size + b] : mod[b * size + a];
        if (c === color) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score++;
        } else {
          addHist(run);
          if (!color) score += countFinder() * 40;
          color = c; run = 1;
        }
      }
      score += terminate(color, run) * 40;
    }
  }
  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = mod[y * size + x];
    dark += c;
    if (x < size - 1 && y < size - 1 && c === mod[y * size + x + 1] && c === mod[(y + 1) * size + x] && c === mod[(y + 1) * size + x + 1]) score += 3;
  }
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

// Render to a canvas at 1 px per module (scale it up with CSS `image-rendering: pixelated`).
export function drawQR(canvas, text, opt = {}) {
  const qr = qrEncode(text, opt);
  const m = opt.margin == null ? 4 : opt.margin;
  const n = qr.size + m * 2;
  canvas.width = n; canvas.height = n;
  const g = canvas.getContext('2d');
  g.fillStyle = opt.light || '#ffffff';
  g.fillRect(0, 0, n, n);
  g.fillStyle = opt.dark || '#000000';
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) {
    if (qr.modules[y * qr.size + x]) g.fillRect(x + m, y + m, 1, 1);
  }
  return qr;
}
