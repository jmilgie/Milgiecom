// Nova Lancers — WebGL post-processing (DESIGN.md §7).
//
// Per frame:  main + light canvases -> textures
//             light -> 1/2 -> 1/4 -> 1/8 bloom mips (downsample + separable Gaussian)
//             final pass onto the display canvas: pixel-crisp "sharp bilinear" upscale of
//             main (only the 1-display-px seam between art pixels is filtered), distortion
//             waves + gravitational lensing (bounded UV warps in art space, field only),
//             chromatic aberration (field only), bloom-driven illumination of the main layer,
//             main + light + bloom, colour grade, flash, vignette, art-pixel scanlines.
// WebGL1 only (GLSL ES 1.00), no extensions. Returns null when WebGL is unavailable.
//
// Gameplay-safety rules baked in here:
//  * The HUD (everything outside the play field) never moves or colour-fringes: warps and
//    chroma are masked to the field rect (s.field, or a guess mirroring the renderer layout).
//  * In-field displacement is bounded: distortion waves move pixels by <= 3 art px (more only
//    for |strength| > 1, which particles.js uses for the nova / boss-final blasts, when enemy
//    bullets are cleared) and never fold; lensing is capped at ~5 px and never darkens.

import { FIELD_W, FIELD_H, HUD_TOP, HUD_BOTTOM } from '../config.js';

const MAX_WAVES = 8;

// quality presets: bloom mips, blur taps, chroma, distortion, DPR cap
const QUALITY = {
  high:   { mips: 3, hq: true,  chroma: true,  distort: true,  dpr: 3,   bloomW: [0.4, 0.5, 0.6] },
  medium: { mips: 2, hq: false, chroma: false, distort: true,  dpr: 2,   bloomW: [0.55, 0.85, 0] },
  low:    { mips: 1, hq: false, chroma: false, distort: false, dpr: 1.5, bloomW: [1.25, 0, 0] },
};
const ORDER = ['high', 'medium', 'low'];

// wave displacement (art px): gameplay-safe cap for |strength| <= 1, bigger for "event" waves
const WAVE_PX = 7, WAVE_CAP = 3, WAVE_CAP_BIG = 20, WAVE_CAP_MAX = 10;
// lensing: s.lensing = { x, y, shadow, strength } (internal art px). shadow = radius of the
// black disc the background paints; strength 0..1 (1 = ~5 px peak deflection). Point-lens
// deflection K/d with K = strength*(LENS_RE*R)^2 inside a lensing zone of radius
// R = LENS_ZONE*shadow; it fades to exactly 0 at LENS_OUT*R and soft-saturates at
// min(LENS_CAP, LENS_CAPK*strength*R) px. Legacy shape {x, y, r, strength} (no shadow): the
// old near-field deflection K = strength*(1.6 r)^2 in a zone R = min(9.6 r, 120).
// Post never darkens anything: the background paints the shadow itself.
const LENS_ZONE = 3.4, LENS_RE = 0.5, LENS_IN = 0.5, LENS_OUT = 1.25, LENS_CAP = 5, LENS_CAPK = 0.09;

const VS = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// 4-tap tent downsample (taps straddle source texels -> 4x4 footprint, stable for moving sparks).
// Precision comes from the program header (highp when the GPU has it): fp16 UVs would make
// the taps wobble by a quarter texel on tall textures.
const FS_DOWN = `
uniform sampler2D uTex;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(uTex, vUv + uTexel * vec2(-1.0, -1.0)).rgb
         + texture2D(uTex, vUv + uTexel * vec2( 1.0, -1.0)).rgb
         + texture2D(uTex, vUv + uTexel * vec2(-1.0,  1.0)).rgb
         + texture2D(uTex, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  c *= 0.25;
#ifdef PREFILTER
  c = max(c - 0.012, 0.0) * 1.08;     // drop faint haze so only real emitters bloom
#endif
  gl_FragColor = vec4(c, 1.0);
}`;

// separable Gaussian using linear-sampling offsets (9-tap in 5 fetches / 5-tap in 3)
const FS_BLUR = `
uniform sampler2D uTex;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
#ifdef HQ
  vec3 c = texture2D(uTex, vUv).rgb * 0.2270270270;
  c += (texture2D(uTex, vUv + uDir * 1.3846153846).rgb + texture2D(uTex, vUv - uDir * 1.3846153846).rgb) * 0.3162162162;
  c += (texture2D(uTex, vUv + uDir * 3.2307692308).rgb + texture2D(uTex, vUv - uDir * 3.2307692308).rgb) * 0.0702702703;
#else
  vec3 c = texture2D(uTex, vUv).rgb * 0.2941176471;
  c += (texture2D(uTex, vUv + uDir * 1.3333333333).rgb + texture2D(uTex, vUv - uDir * 1.3333333333).rgb) * 0.3529411765;
#endif
  gl_FragColor = vec4(c, 1.0);
}`;

const FS_FINAL = `
uniform sampler2D uMain, uLight, uB1, uB2, uB3;
uniform vec2 uTexSize;      // internal canvas size (art px)
uniform vec2 uOut;          // display canvas size (device px)
uniform float uScale;       // device px per art px
uniform vec2 uOff;          // device px offset of the art origin
uniform vec4 uField;        // play field rect x0, y0, x1, y1 (art px); huge when unknown
uniform vec4 uWaves[${MAX_WAVES}];   // x, y, radius, signed amplitude (art px, pre-capped)
uniform float uWaveN, uWaveMax;
uniform vec4 uLens;         // x, y, deflection cap (px), on (>0)
uniform vec3 uLensK;        // strength*re^2, fade start, fade end (art px)
uniform float uChroma;
uniform vec4 uFlash;        // rgb, amount
uniform vec3 uTint, uLift;
uniform vec2 uSatCon;       // saturation, contrast
uniform vec4 uBloom;        // mip weights xyz, intensity w
uniform float uIllum;       // how strongly bloom light illuminates the main layer
uniform float uScan, uVig;
varying vec2 vUv;

// sharp bilinear: nearest inside an art pixel, linear only across the 1-device-px seam
vec3 sharp(sampler2D t, vec2 art) {
  vec2 fl = floor(art);
  vec2 cd = art - fl - 0.5;
  vec2 rr = vec2(max(0.5 - 0.5 / uScale, 0.0));
  vec2 ff = (cd - clamp(cd, -rr, rr)) * uScale + 0.5;
  return texture2D(t, (fl + ff) / uTexSize).rgb;
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uOut.y - gl_FragCoord.y);     // device px, top-left origin
  vec2 art = (frag - uOff) / uScale;                             // art px
  // signed distance inside the field: warps/chroma feather in over 2 art px, HUD stays put
  float fe = min(min(art.x - uField.x, uField.z - art.x), min(art.y - uField.y, uField.w - art.y));
  float inF = clamp(fe * 0.5, 0.0, 1.0);
  vec2 p = art;
#ifdef DISTORT
  if (inF > 0.0) {
    vec2 disp = vec2(0.0);
    for (int i = 0; i < ${MAX_WAVES}; i++) {
      if (float(i) >= uWaveN) break;
      vec4 w = uWaves[i];
      vec2 d = art - w.xy;
      float dist = length(d);
      float k = (dist - w.z) / (6.0 + w.z * 0.18);
      if (abs(k) < 1.0) disp -= d / max(dist, 0.001) * (w.w * (0.5 + 0.5 * cos(k * 3.14159265)));
    }
    float dl = length(disp);
    if (dl > uWaveMax) disp *= uWaveMax / dl;          // overlapping waves never stack past the cap
    if (uLens.w > 0.0) {
      vec2 d = art - uLens.xy;
      float dist = max(length(d), 0.001);
      float raw = uLensK.x / dist;                       // point-lens deflection
      float a = uLens.z * raw / (uLens.z + raw);         // soft-saturates at the cap
      a *= 1.0 - smoothstep(uLensK.y, uLensK.z, dist);   // exactly 0 outside the lensing zone
      a = min(a, dist * 0.8);                            // monotonic: never folds or flips
      disp -= d / dist * a;
    }
    p = clamp(art + disp * inF, uField.xy, uField.zw - 0.01);   // field never samples the HUD
  }
#endif
  vec3 col;
#ifdef CHROMA
  if (uChroma > 0.002 && inF > 0.0) {
    vec2 ca = (art / uTexSize - 0.5) * vec2(uTexSize.x / uTexSize.y, 1.0) * (uChroma * 5.0 * inF);
    col = vec3(sharp(uMain, p + ca).r, sharp(uMain, p).g, sharp(uMain, p - ca).b);
  } else {
    col = sharp(uMain, p);
  }
#else
  col = sharp(uMain, p);
#endif
  // scanlines in art-pixel space: band-limited cos^2 profile, darkest on the art-row seam,
  // so every art row gets the same darkness at any non-integer scale (no beat pattern)
  float sl = 0.5 + 0.5 * cos(6.2831853 * art.y);
  col *= 1.0 - uScan * 0.9 * sl * sl;

  vec2 luv = p / uTexSize;
  vec3 light = texture2D(uLight, luv).rgb;
  vec3 bloom = texture2D(uB1, luv).rgb * uBloom.x;
#if MIPS > 1
  vec3 wide = texture2D(uB2, luv).rgb * uBloom.y;
#if MIPS > 2
  wide += texture2D(uB3, luv).rgb * uBloom.z;
#endif
  bloom += wide;
#else
  vec3 wide = bloom;
#endif
  // Emissive light illuminates the surfaces around it: the wide (low-frequency) bloom acts
  // as a light field that multiplies the main layer, so hulls, rocks and nebula gas near a
  // blast or beam pick up its colour while dark outlines stay dark (unlike additive haze).
  // Then the light layer and its bloom are added on top.
  col = col * (1.0 + min(wide, vec3(0.6)) * uIllum) + light + bloom * uBloom.w;

  col = col * uTint + uLift;
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, uSatCon.x);
  col = (col - 0.5) * uSatCon.y + 0.5;
  // flash: an exposure kick (multiplicative, so darks stay dark and the frame stays punchy)
  // with a faint tinted veil; only the top of a big flash (boss death) blows out to the
  // flash colour, for 2-3 frames, instead of fogging the whole screen
  float fa = uFlash.a;
  col = col * (1.0 + fa * 2.2) + uFlash.rgb * (fa * 0.1);
  col = mix(col, uFlash.rgb, smoothstep(0.65, 1.0, fa) * 0.95);
  vec2 q = gl_FragCoord.xy / uOut - 0.5;
  float vs = clamp(1.0 + fe / 12.0, 0.0, 1.0);          // vignette eases off over the HUD strips
  col *= 1.0 - uVig * dot(q, q) * 2.0 * mix(0.35, 1.0, vs);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// Mirrors Renderer.resize() (js/engine/renderer.js) so the field mask works even when the
// renderer does not pass s.field. Returns false when the layout cannot be derived.
function guessField(out, W, H, s) {
  if (!(s > 0) || W < FIELD_W || typeof document === 'undefined') return false;
  let st = 0, sb = 0;
  const probe = document.getElementById('safe-probe');
  if (probe && typeof getComputedStyle === 'function') {
    const cs = getComputedStyle(probe);
    st = parseFloat(cs.paddingTop) || 0; sb = parseFloat(cs.paddingBottom) || 0;
  }
  const safeT = Math.ceil(st / s), safeB = Math.ceil(sb / s);
  const fx = Math.floor((W - FIELD_W) / 2);
  const free = H - safeT - safeB - FIELD_H;
  let fy;
  if (free >= HUD_TOP + HUD_BOTTOM) fy = safeT + HUD_TOP + Math.floor((free - HUD_TOP - HUD_BOTTOM) * 0.35);
  else if (free > 0) fy = safeT + Math.floor(free * (HUD_TOP / (HUD_TOP + HUD_BOTTOM)));
  else fy = Math.max(0, Math.floor((H - FIELD_H) / 2));
  out[0] = fx; out[1] = fy; out[2] = fx + FIELD_W; out[3] = fy + FIELD_H;
  return true;
}

export function createPost(canvas) {
  if (!canvas || typeof canvas.getContext !== 'function') return null;
  const attrs = {
    alpha: false, antialias: false, depth: false, stencil: false,
    premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance',
  };
  // Prefer a hardware context. A software-rasterised one (blocklisted GPU) still beats the
  // 2D fallback visually, but auto quality then never goes above 'medium'.
  let gl = null, software = false;
  try { gl = canvas.getContext('webgl', Object.assign({ failIfMajorPerformanceCaveat: true }, attrs)); } catch (e) { gl = null; }
  if (!gl) {
    try { gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs); } catch (e) { gl = null; }
    software = !!gl;
  }
  if (!gl) return null;
  const autoMax = software ? 'medium' : 'high';

  let lost = false;
  let progs = {};
  let vbo = null, texMain = null, texLight = null, texBlack = null;
  let fbA = [], fbB = [];            // per mip: { tex, fb, w, h }
  let texW = 0, texH = 0;
  let precision = 'mediump';

  // sizing
  let cssW = canvas.clientWidth || canvas.width, cssH = canvas.clientHeight || canvas.height, dprReq = 1;
  let artScale = 0;                  // optional explicit CSS px per art px (0 = cover-fit)
  const fieldGuess = new Float32Array(4);
  let hasGuess = false, guessW = 0, guessH = 0;

  // ---- quality ------------------------------------------------------------------------------
  // Auto mode steps down when frames are persistently slow, but only for load the post pass
  // can actually fix: hitches (> 100 ms: loading, GC, tab switches) and a steady vsync-locked
  // 30 fps cadence (iOS Low Power Mode, battery saver) are ignored, and every downgrade is
  // probed: if frame time did not improve by 15 % within ~2 s the old level comes back and
  // auto is switched off (until resetAuto()); a step that doesn't help gets one further step
  // tried first. After 20 s at a solid 60 fps it tries one level
  // up again (at most twice per session).
  let quality = autoMax, auto = true, autoOff = false;
  let emaDt = 16.7, jit = 0, slow = 0, lastT = 0, grace = 120, calm = 0, ups = 0;
  let probeFrom = '', probeRef = 0, probeT = 0, probeSum = 0, probeN = 0;

  const wavesBuf = new Float32Array(MAX_WAVES * 4);

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('shader: ' + log);
    }
    return sh;
  }
  function program(fsSrc, defines) {
    const head = `precision ${precision} float;\n` + defines.map((d) => `#define ${d}\n`).join('');
    const vs = compile(gl.VERTEX_SHADER, VS);
    const fs = compile(gl.FRAGMENT_SHADER, head + fsSrc);
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('link: ' + gl.getProgramInfoLog(p));
    gl.deleteShader(vs); gl.deleteShader(fs);
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) || 0;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u };
  }
  function getProg(key) {
    let pr = progs[key];
    if (pr) return pr;
    switch (key) {
      case 'down': pr = program(FS_DOWN, []); break;
      case 'downPre': pr = program(FS_DOWN, ['PREFILTER']); break;
      case 'blurHQ': pr = program(FS_BLUR, ['HQ']); break;
      case 'blurLQ': pr = program(FS_BLUR, []); break;
      default: {
        const Q = QUALITY[key.slice(6)];
        const defs = ['MIPS ' + Q.mips];
        if (Q.distort) defs.push('DISTORT');
        if (Q.chroma) defs.push('CHROMA');
        pr = program(FS_FINAL, defs);
        gl.useProgram(pr.p);
        gl.uniform1i(pr.u.uMain, 0); gl.uniform1i(pr.u.uLight, 1);
        gl.uniform1i(pr.u.uB1, 2); gl.uniform1i(pr.u.uB2, 3); gl.uniform1i(pr.u.uB3, 4);
      }
    }
    progs[key] = pr;
    return pr;
  }

  function makeTex(filter) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function makeTarget(w, h) {
    const tex = makeTex(gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fb, w, h };
  }
  function freeTargets() {
    for (const t of fbA.concat(fbB)) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
    fbA = []; fbB = [];
  }
  function allocTargets(W, H) {
    freeTargets();
    let w = W, h = H;
    for (let i = 0; i < 3; i++) {
      w = Math.max(1, Math.ceil(w / 2)); h = Math.max(1, Math.ceil(h / 2));
      fbA.push(makeTarget(w, h)); fbB.push(makeTarget(w, h));
    }
    texW = W; texH = H;
    // (re)allocate the upload textures at the new size
    gl.bindTexture(gl.TEXTURE_2D, texMain);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, texLight);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }

  function initGL() {
    const hp = gl.getShaderPrecisionFormat && gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    precision = hp && hp.precision > 0 ? 'highp' : 'mediump';
    progs = {};
    vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.disable(gl.DITHER);
    gl.clearColor(0, 0, 0, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);   // canvas rgb as stored = additive light
    texMain = makeTex(gl.LINEAR);      // LINEAR + sharp-bilinear UVs = nearest aligned to the art grid
    texLight = makeTex(gl.LINEAR);
    texBlack = makeTex(gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    texW = texH = 0; fbA = []; fbB = [];
    // compile the programs we need now so the first frame does not hitch
    getProg('downPre'); getProg('down'); getProg('blurHQ'); getProg('blurLQ'); getProg('final_' + quality);
  }

  try { initGL(); } catch (e) { return null; }

  const onLost = (e) => { e.preventDefault(); lost = true; };
  const onRestored = () => { try { initGL(); lost = false; applySize(); } catch (e) { lost = true; } };
  const onVis = () => { if (document.visibilityState === 'visible') { lastT = 0; grace = Math.max(grace, 60); slow = 0; } };
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);

  function applySize() {
    const d = Math.min(dprReq || 1, QUALITY[quality].dpr);
    const w = Math.max(1, Math.round(cssW * d)), h = Math.max(1, Math.round(cssH * d));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    grace = Math.max(grace, 60);
    lastT = 0;
  }

  function upload(tex, src) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
  }

  function bindTex(unit, t) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); }

  function pass(prog, target, w, h) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);     // lets tiled mobile GPUs skip loading the old contents
    gl.useProgram(prog.p);
  }

  function setLevel(q) {
    if (q !== quality) { quality = q; applySize(); }
  }

  function setQuality(q) {
    if (q === 'auto' || q == null) { enableAuto(); return; }
    if (!QUALITY[q]) return;
    auto = false;
    setLevel(q);
  }

  function enableAuto() {
    if (auto) return;
    auto = true;
    if (ORDER.indexOf(quality) < ORDER.indexOf(autoMax)) setLevel(autoMax);
  }

  function resetAuto() {
    autoOff = false; probeFrom = ''; slow = 0; calm = 0; emaDt = 16.7; jit = 0; lastT = 0;
    grace = Math.max(grace, 120);
  }

  function trackFrame(now) {
    const d = lastT ? now - lastT : 0;
    lastT = now;
    if (!(d > 0)) return;
    if (d > 100) { grace = Math.max(grace, 30); return; }      // hitch, not steady GPU load
    emaDt += (d - emaDt) * 0.05;
    jit += (Math.abs(d - emaDt) - jit) * 0.05;
    if (grace > 0) { grace--; return; }
    if (!auto || autoOff) return;
    if (probeFrom) {
      // judge the downgrade on the frames after it settled: keep it if frame time improved
      // by 15 %, else try one more step (only 'low' drops the DPR further), else restore
      probeT += d; probeSum += d; probeN++;
      if (probeT > 2000) {
        if (probeSum / probeN <= probeRef * 0.85) probeFrom = '';
        else if (quality !== 'low') { probeT = probeSum = probeN = 0; setLevel(ORDER[ORDER.indexOf(quality) + 1]); }
        else { autoOff = true; setLevel(probeFrom); probeFrom = ''; }
      }
      return;
    }
    const capped30 = emaDt > 30.5 && emaDt < 36.5 && jit < 2.5;
    if (emaDt > 23 && !capped30) {
      calm = 0;
      slow += d;
      if (slow > 2500 && quality !== 'low') {
        probeFrom = quality; probeRef = emaDt; probeT = probeSum = probeN = 0;
        slow = 0;
        setLevel(ORDER[ORDER.indexOf(quality) + 1]);
      }
    } else {
      slow = Math.max(0, slow - d * 0.5);
      if (emaDt < 17.5 && ups < 2 && ORDER.indexOf(quality) > ORDER.indexOf(autoMax)) {
        calm += d;
        if (calm > 20000) { calm = 0; ups++; setLevel(ORDER[ORDER.indexOf(quality) - 1]); }
      } else calm = 0;
    }
  }

  const ID_TINT = [1, 1, 1], ID_LIFT = [0, 0, 0];
  const EMPTY = {};

  function render(mainCanvas, lightCanvas, s) {
    if (lost || gl.isContextLost()) return false;
    s = s || EMPTY;
    // s.quality is authoritative each frame: an explicit level locks it, undefined/'auto'
    // hands control to the frame-time monitor.
    const rq = s.quality;
    if (rq === 'high' || rq === 'medium' || rq === 'low') { auto = false; setLevel(rq); }
    else enableAuto();
    trackFrame(performance.now());

    const W = mainCanvas.width, H = mainCanvas.height;
    if (W !== texW || H !== texH) allocTargets(W, H);
    const Q = QUALITY[quality];

    upload(texMain, mainCanvas);
    if (lightCanvas) upload(texLight, lightCanvas);

    // bloom chain from the light layer
    const blur = getProg(Q.hq ? 'blurHQ' : 'blurLQ');
    let src = lightCanvas ? texLight : texBlack, sw = W, sh = H;
    for (let i = 0; i < Q.mips; i++) {
      const A = fbA[i], B = fbB[i];
      const dn = getProg(i === 0 ? 'downPre' : 'down');
      pass(dn, A, A.w, A.h);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
      gl.uniform1i(dn.u.uTex, 0);
      gl.uniform2f(dn.u.uTexel, 1 / sw, 1 / sh);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      pass(blur, B, B.w, B.h);
      gl.bindTexture(gl.TEXTURE_2D, A.tex);
      gl.uniform1i(blur.u.uTex, 0);
      gl.uniform2f(blur.u.uDir, 1 / A.w, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      pass(blur, A, A.w, A.h);
      gl.bindTexture(gl.TEXTURE_2D, B.tex);
      gl.uniform2f(blur.u.uDir, 0, 1 / A.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      src = A.tex; sw = A.w; sh = A.h;
    }

    // final composite onto the display canvas
    const outW = canvas.width, outH = canvas.height;
    const fin = getProg('final_' + quality);
    pass(fin, null, outW, outH);
    bindTex(0, texMain);
    bindTex(1, lightCanvas ? texLight : texBlack);
    bindTex(2, fbA[0].tex);
    bindTex(3, Q.mips > 1 ? fbA[1].tex : texBlack);
    bindTex(4, Q.mips > 2 ? fbA[2].tex : texBlack);
    gl.activeTexture(gl.TEXTURE0);

    const u = fin.u;
    const scale = artScale > 0 ? artScale * (outW / Math.max(1, cssW)) : Math.max(outW / W, outH / H);
    gl.uniform2f(u.uTexSize, W, H);
    gl.uniform2f(u.uOut, outW, outH);
    gl.uniform1f(u.uScale, scale);
    gl.uniform2f(u.uOff, 0, 0);
    const F = s.field;
    if (F && F.w > 0 && F.h > 0) gl.uniform4f(u.uField, F.x, F.y, F.x + F.w, F.y + F.h);
    else if (F !== false && hasGuess && W === guessW && H === guessH) gl.uniform4f(u.uField, fieldGuess[0], fieldGuess[1], fieldGuess[2], fieldGuess[3]);
    else gl.uniform4f(u.uField, -1e5, -1e5, 1e5, 1e5);

    if (Q.distort) {
      const ws = s.waves;
      let n = 0, amax = 0;
      if (ws) {
        for (let i = 0; i < ws.length && n < MAX_WAVES; i++) {
          const w = ws[i];
          if (!w || !(w.r > 0) || !w.strength) continue;
          const st = Math.abs(w.strength);
          const cap = st <= 1 ? WAVE_CAP : Math.min(WAVE_CAP_MAX, WAVE_CAP + (st - 1) * WAVE_CAP_BIG);
          // amplitude: capped, and < width/2 so the radial warp stays monotonic (no folding)
          let a = Math.min(st * WAVE_PX, cap, 0.5 * (6 + w.r * 0.18)) * Math.min(1, w.r / 10);
          if (a > amax) amax = a;
          if (w.strength < 0) a = -a;
          wavesBuf[n * 4] = w.x; wavesBuf[n * 4 + 1] = w.y; wavesBuf[n * 4 + 2] = w.r; wavesBuf[n * 4 + 3] = a;
          n++;
        }
      }
      gl.uniform4fv(u.uWaves, wavesBuf);
      gl.uniform1f(u.uWaveN, n);
      gl.uniform1f(u.uWaveMax, amax);
      const L = s.lensing;
      let R = 0, K = 0;
      if (L && L.strength > 0) {
        if (L.shadow > 0) { R = L.shadow * LENS_ZONE; K = Math.min(1, L.strength) * (R * LENS_RE) * (R * LENS_RE); }
        else if (L.r > 0) { R = Math.min(9.6 * L.r, 120); K = L.strength * 2.56 * L.r * L.r; }
      }
      if (R > 0) {
        gl.uniform4f(u.uLens, L.x, L.y, Math.min(LENS_CAP, LENS_CAPK * Math.min(1, L.strength) * R), 1);
        gl.uniform3f(u.uLensK, K, R * LENS_IN, R * LENS_OUT);
      } else gl.uniform4f(u.uLens, 0, 0, 0, 0);
    }
    const fl = Math.min(1, Math.max(0, s.flash || 0));
    // colour fringing eases off while a big flash blows the frame out (reads cleaner)
    if (Q.chroma) gl.uniform1f(u.uChroma, Math.min(1, Math.max(0, s.chroma || 0)) * (1 - 0.7 * Math.max(0, fl - 0.5) * 2));
    const fc = s.flashColor || ID_TINT;
    gl.uniform4f(u.uFlash, fc[0], fc[1], fc[2], fl);
    const g = s.grade;
    const tint = (g && g.tint) || ID_TINT, lift = (g && g.lift) || ID_LIFT;
    gl.uniform3f(u.uTint, tint[0], tint[1], tint[2]);
    gl.uniform3f(u.uLift, lift[0], lift[1], lift[2]);
    gl.uniform2f(u.uSatCon, g && g.sat != null ? g.sat : 1, g && g.contrast != null ? g.contrast : 1);
    const bw = Q.bloomW;
    gl.uniform4f(u.uBloom, bw[0], bw[1], bw[2], s.bloom != null ? s.bloom : 0.8);
    gl.uniform1f(u.uIllum, s.illum != null ? s.illum : 3.6);
    gl.uniform1f(u.uScan, s.scanlines ? 0.16 * Math.min(1, Math.max(0, (scale - 1.6) / 1.4)) : 0);
    gl.uniform1f(u.uVig, s.vignette != null ? s.vignette : 0.3);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }

  return {
    gl,
    // cssW/cssH: display size in CSS px; dpr: devicePixelRatio (capped per quality level:
    // high 3, medium 2, low 1.5); W/H: internal canvas size; scale (optional): CSS px per
    // art px (default: cover-fit, top-left).
    resize(w, h, dpr, W, H, scale) {
      cssW = Math.max(1, w | 0); cssH = Math.max(1, h | 0); dprReq = dpr || 1;
      artScale = scale > 0 ? scale : 0;
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
      hasGuess = artScale > 0 && guessField(fieldGuess, W, H, artScale);
      guessW = W; guessH = H;
      applySize();
      if (!lost && W > 0 && H > 0 && (W !== texW || H !== texH)) allocTargets(W, H);
    },
    render,
    setQuality,
    // Re-arm auto quality (e.g. when a sortie starts): fresh timing window, probe cleared,
    // re-enabled if an earlier probe had switched it off.
    resetAuto,
    get quality() { return quality; },
    get autoQuality() { return auto && !autoOff; },
    get software() { return software; },
    get lost() { return lost; },
    get frameMs() { return emaDt; },
    dispose() {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
      if (lost) return;
      freeTargets();
      for (const k in progs) gl.deleteProgram(progs[k].p);
      progs = {};
      gl.deleteTexture(texMain); gl.deleteTexture(texLight); gl.deleteTexture(texBlack); gl.deleteBuffer(vbo);
    },
  };
}
