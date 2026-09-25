// Nova Lancers — WebGL post-processing (DESIGN.md §7).
//
// Per frame:  main + light canvases -> textures
//             light -> 1/2 -> 1/4 -> 1/8 bloom mips (downsample + separable Gaussian)
//             final pass onto the display canvas: pixel-crisp "sharp bilinear" upscale of
//             main (only the 1-display-px seam between art pixels is filtered), distortion
//             waves + gravitational lensing (UV warps in art space), chromatic aberration,
//             main + light + bloom, colour grade, flash, vignette, art-pixel scanlines.
// WebGL1 only (GLSL ES 1.00), no extensions. Returns null when WebGL is unavailable.

const MAX_WAVES = 8;

// quality presets: bloom mips, blur taps, chroma, distortion, DPR cap
const QUALITY = {
  high:   { mips: 3, hq: true,  chroma: true,  distort: true,  dpr: 2,   bloomW: [0.4, 0.5, 0.6] },
  medium: { mips: 2, hq: false, chroma: false, distort: true,  dpr: 2,   bloomW: [0.55, 0.8, 0] },
  low:    { mips: 1, hq: false, chroma: false, distort: false, dpr: 1.5, bloomW: [1.1, 0, 0] },
};
const ORDER = ['high', 'medium', 'low'];

const VS = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// 4-tap tent downsample (taps straddle source texels -> 4x4 footprint, stable for moving sparks)
const FS_DOWN = `
precision mediump float;
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
precision mediump float;
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
uniform vec4 uWaves[${MAX_WAVES}];   // x, y, radius, strength (art px)
uniform float uWaveN;
uniform vec4 uLens;         // x, y, radius, strength (strength 0 = off)
uniform float uChroma;
uniform vec4 uFlash;        // rgb, amount
uniform vec3 uTint, uLift;
uniform vec2 uSatCon;       // saturation, contrast
uniform vec4 uBloom;        // mip weights xyz, intensity w
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
  vec2 p = art;
  float hole = 1.0;
#ifdef DISTORT
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    if (float(i) >= uWaveN) break;
    vec4 w = uWaves[i];
    vec2 d = p - w.xy;
    float dist = length(d);
    float width = 6.0 + w.z * 0.18;
    float k = (dist - w.z) / width;
    if (abs(k) < 1.0) {
      float amt = w.w * 7.0 * (0.5 + 0.5 * cos(k * 3.14159265)) * clamp(w.z / 10.0, 0.0, 1.0);
      p -= d / max(dist, 0.001) * amt;
    }
  }
  if (uLens.w > 0.0) {
    vec2 d = p - uLens.xy;
    float dist = max(length(d), 0.001);
    float re = uLens.z * 1.6;                                   // Einstein radius
    float defl = uLens.w * re * re / dist;
    defl /= 1.0 + (dist * dist) / (36.0 * re * re);            // keep the far field calm
    p = uLens.xy + d * ((dist - defl) / dist);
    hole = smoothstep(uLens.z * 0.9, uLens.z * 1.06, dist);
  }
#endif
  vec3 col;
#ifdef CHROMA
  if (uChroma > 0.002) {
    vec2 ca = (art / uTexSize - 0.5) * vec2(uTexSize.x / uTexSize.y, 1.0) * uChroma * 7.0;
    col = vec3(sharp(uMain, p + ca).r, sharp(uMain, p).g, sharp(uMain, p - ca).b);
  } else {
    col = sharp(uMain, p);
  }
#else
  col = sharp(uMain, p);
#endif
  col *= mix(0.1, 1.0, hole);
  // scanlines in art-pixel space (last device pixel row of every art row), main layer only
  float fy = fract(art.y);
  col *= 1.0 - uScan * clamp((fy - (1.0 - 1.0 / uScale)) * uScale, 0.0, 1.0);

  vec2 luv = p / uTexSize;
  vec3 light = texture2D(uLight, luv).rgb;
  vec3 bloom = texture2D(uB1, luv).rgb * uBloom.x;
#if MIPS > 1
  bloom += texture2D(uB2, luv).rgb * uBloom.y;
#endif
#if MIPS > 2
  bloom += texture2D(uB3, luv).rgb * uBloom.z;
#endif
  col += (light + bloom * uBloom.w) * mix(0.35, 1.0, hole);

  col = col * uTint + uLift;
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, uSatCon.x);
  col = (col - 0.5) * uSatCon.y + 0.5;
  col = col * (1.0 + uFlash.a * 1.4) + uFlash.rgb * (uFlash.a * 0.55);   // exposure kick + tinted veil
  vec2 q = gl_FragCoord.xy / uOut - 0.5;
  col *= 1.0 - uVig * dot(q, q) * 2.0;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

export function createPost(canvas) {
  if (!canvas || typeof canvas.getContext !== 'function') return null;
  const attrs = {
    alpha: false, antialias: false, depth: false, stencil: false,
    premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance',
  };
  let gl = null;
  try { gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs); } catch (e) { gl = null; }
  if (!gl) return null;

  let lost = false;
  let progs = {};
  let vbo = null, texMain = null, texLight = null, texBlack = null;
  let fbA = [], fbB = [];            // per mip: { tex, fb, w, h }
  let texW = 0, texH = 0;
  let precision = 'mediump';

  // sizing
  let cssW = canvas.clientWidth || canvas.width, cssH = canvas.clientHeight || canvas.height, dprReq = 1;
  let artScale = 0;                  // optional explicit CSS px per art px (0 = cover-fit)

  // quality
  let quality = 'high', auto = true;
  let emaDt = 16.7, slow = 0, lastT = 0, grace = 90;

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
    // (re)allocate the upload textures at the new size on next upload
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

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; }, false);
  canvas.addEventListener('webglcontextrestored', () => {
    try { initGL(); lost = false; applySize(); } catch (e) { lost = true; }
  }, false);

  function applySize() {
    const d = Math.min(dprReq || 1, QUALITY[quality].dpr);
    const w = Math.max(1, Math.round(cssW * d)), h = Math.max(1, Math.round(cssH * d));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    grace = 60;
  }

  function upload(tex, src) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
  }

  function bindTex(unit, t) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); }

  function pass(prog, target, w, h) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog.p);
  }

  function setQuality(q) {
    if (q === 'auto' || q == null) { auto = true; return; }
    if (!QUALITY[q]) return;
    auto = false;
    if (q !== quality) { quality = q; applySize(); }
  }

  function trackFrame(now) {
    if (lastT) {
      const d = now - lastT;
      if (d > 0 && d < 250) {
        emaDt += (d - emaDt) * 0.05;
        if (grace > 0) grace--;
        else if (auto && emaDt > 23) {
          slow += d;
          if (slow > 2500 && quality !== 'low') {
            quality = ORDER[ORDER.indexOf(quality) + 1];
            slow = 0; emaDt = 16.7;
            applySize();
          }
        } else slow = Math.max(0, slow - d * 0.5);
      }
    }
    lastT = now;
  }

  const ID_TINT = [1, 1, 1], ID_LIFT = [0, 0, 0];
  const EMPTY = {};

  function render(mainCanvas, lightCanvas, s) {
    if (lost || gl.isContextLost()) return false;
    s = s || EMPTY;
    // s.quality is authoritative each frame: an explicit level locks it, undefined/'auto'
    // lets frame-time monitoring step it down (never back up).
    const rq = s.quality;
    if (rq === 'high' || rq === 'medium' || rq === 'low') {
      auto = false;
      if (rq !== quality) { quality = rq; applySize(); }
    } else auto = true;
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

    if (Q.distort) {
      const ws = s.waves;
      let n = 0;
      if (ws) {
        for (let i = 0; i < ws.length && n < MAX_WAVES; i++) {
          const w = ws[i];
          if (!w || !(w.r > 0) || !w.strength) continue;
          wavesBuf[n * 4] = w.x; wavesBuf[n * 4 + 1] = w.y; wavesBuf[n * 4 + 2] = w.r; wavesBuf[n * 4 + 3] = w.strength;
          n++;
        }
      }
      gl.uniform4fv(u.uWaves, wavesBuf);
      gl.uniform1f(u.uWaveN, n);
      const L = s.lensing;
      if (L && L.strength > 0 && L.r > 0) gl.uniform4f(u.uLens, L.x, L.y, L.r, L.strength);
      else gl.uniform4f(u.uLens, 0, 0, 0, 0);
    }
    if (Q.chroma) gl.uniform1f(u.uChroma, Math.min(1, Math.max(0, s.chroma || 0)));
    const fc = s.flashColor || ID_TINT;
    gl.uniform4f(u.uFlash, fc[0], fc[1], fc[2], Math.min(1, Math.max(0, s.flash || 0)));
    const g = s.grade;
    const tint = (g && g.tint) || ID_TINT, lift = (g && g.lift) || ID_LIFT;
    gl.uniform3f(u.uTint, tint[0], tint[1], tint[2]);
    gl.uniform3f(u.uLift, lift[0], lift[1], lift[2]);
    gl.uniform2f(u.uSatCon, g && g.sat != null ? g.sat : 1, g && g.contrast != null ? g.contrast : 1);
    const bw = Q.bloomW;
    gl.uniform4f(u.uBloom, bw[0], bw[1], bw[2], s.bloom != null ? s.bloom : 0.9);
    gl.uniform1f(u.uScan, s.scanlines ? 0.16 * Math.min(1, Math.max(0, (scale - 1.6) / 1.4)) : 0);
    gl.uniform1f(u.uVig, s.vignette != null ? s.vignette : 0.3);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }

  return {
    gl,
    // cssW/cssH: display size in CSS px; dpr: devicePixelRatio (capped at 2, 1.5 on 'low');
    // W/H: internal canvas size; scale (optional): CSS px per art px (default: cover-fit, top-left).
    resize(w, h, dpr, W, H, scale) {
      cssW = Math.max(1, w | 0); cssH = Math.max(1, h | 0); dprReq = dpr || 1;
      artScale = scale > 0 ? scale : 0;
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
      applySize();
      if (!lost && W > 0 && H > 0 && (W !== texW || H !== texH)) allocTargets(W, H);
    },
    render,
    setQuality,
    get quality() { return quality; },
    get autoQuality() { return auto; },
    get lost() { return lost; },
    get frameMs() { return emaDt; },
    dispose() {
      if (lost) return;
      freeTargets();
      for (const k in progs) gl.deleteProgram(progs[k].p);
      progs = {};
      gl.deleteTexture(texMain); gl.deleteTexture(texLight); gl.deleteTexture(texBlack); gl.deleteBuffer(vbo);
    },
  };
}
