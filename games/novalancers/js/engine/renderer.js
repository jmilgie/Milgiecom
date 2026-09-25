// Nova Lancers — renderer.
// Owns the two internal art-resolution canvases (main + light), computes the layout
// (scale, field placement around safe areas) and presents a frame through the WebGL
// post-processor (js/fx/post.js) or a 2D fallback.

import { FIELD_W, FIELD_H, HUD_TOP, HUD_BOTTOM } from '../config.js';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Reads env(safe-area-inset-*) in CSS px via a probe element.
function readSafeArea() {
  let probe = document.getElementById('safe-probe');
  if (!probe) {
    probe = document.createElement('div');
    probe.id = 'safe-probe';
    probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);' +
      'padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right);';
    document.body.appendChild(probe);
  }
  const cs = getComputedStyle(probe);
  return {
    top: parseFloat(cs.paddingTop) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
    right: parseFloat(cs.paddingRight) || 0,
  };
}

export class Renderer {
  constructor(screen) {
    this.screen = screen;
    this.main = makeCanvas(FIELD_W, FIELD_H);
    this.light = makeCanvas(FIELD_W, FIELD_H);
    this.ctx = this.main.getContext('2d', { alpha: false });
    this.lctx = this.light.getContext('2d', { alpha: false });
    this.post = null;
    this.ctx2d = null;          // 2D fallback context on the screen canvas
    this.W = FIELD_W; this.H = FIELD_H;
    this.fx = 0; this.fy = 0;   // field origin inside the internal canvas
    this.scale = 1;             // CSS px per art px
    this.cssW = 1; this.cssH = 1; this.dpr = 1;
    this.safe = { top: 0, bottom: 0, left: 0, right: 0 };
    this.safeArt = { top: 0, bottom: 0 };
    this.shakeAmt = 0; this.shakeTime = 0; this.shakeX = 0; this.shakeY = 0;
    this.shakeEnabled = true;
    this.quality = 'auto';
    this.time = 0;
    this.fxState = null;
    this.frameMs = 16;
    this._listeners = [];
  }

  async init(createPost) {
    if (createPost) {
      try { this.post = createPost(this.screen); } catch (e) { console.warn('post-fx unavailable', e); this.post = null; }
    }
    if (!this.post) this.ctx2d = this.screen.getContext('2d', { alpha: false });
    this.resize();
    const onResize = () => this.resize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => setTimeout(onResize, 120));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
  }

  onResize(fn) { this._listeners.push(fn); }

  setQuality(q) {
    this.quality = q;
    if (this.post?.setQuality) this.post.setQuality(q === 'auto' ? 'high' : q);
  }

  resize() {
    const vv = window.visualViewport;
    const cssW = Math.max(1, Math.round(vv ? vv.width : window.innerWidth));
    const cssH = Math.max(1, Math.round(vv ? vv.height : window.innerHeight));
    const dprCap = this.quality === 'low' ? 1.5 : 2;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    this.safe = readSafeArea();
    const usableH = Math.max(100, cssH - this.safe.top - this.safe.bottom);
    // Field + HUD strips must fit; horizontally the field must fit the width.
    let s = Math.min(cssW / FIELD_W, usableH / (FIELD_H + HUD_TOP + HUD_BOTTOM));
    // On very wide/short screens don't let the HUD reservation shrink the field too much.
    const sFieldOnly = Math.min(cssW / FIELD_W, usableH / FIELD_H);
    if (s < sFieldOnly * 0.86) s = sFieldOnly * 0.86;
    // Snap to a gentle grid to avoid sub-pixel shimmer at near-integer scales.
    const nearInt = Math.round(s);
    if (nearInt >= 1 && Math.abs(s - nearInt) < 0.04) s = nearInt;
    this.scale = s;
    this.cssW = cssW; this.cssH = cssH; this.dpr = dpr;
    const W = Math.ceil(cssW / s);
    const H = Math.ceil(cssH / s);
    this.W = W; this.H = H;
    const safeT = Math.ceil(this.safe.top / s);
    const safeB = Math.ceil(this.safe.bottom / s);
    this.safeArt = { top: safeT, bottom: safeB };
    this.fx = Math.floor((W - FIELD_W) / 2);
    const free = H - safeT - safeB - FIELD_H;
    if (free >= HUD_TOP + HUD_BOTTOM) {
      const extra = free - HUD_TOP - HUD_BOTTOM;
      this.fy = safeT + HUD_TOP + Math.floor(extra * 0.35);
    } else if (free > 0) {
      this.fy = safeT + Math.floor(free * (HUD_TOP / (HUD_TOP + HUD_BOTTOM)));
    } else {
      this.fy = Math.max(0, Math.floor((H - FIELD_H) / 2));
    }
    if (this.main.width !== W || this.main.height !== H) {
      this.main.width = W; this.main.height = H;
      this.light.width = W; this.light.height = H;
      this.ctx.imageSmoothingEnabled = false;
      this.lctx.imageSmoothingEnabled = false;
    }
    this.screen.style.width = cssW + 'px';
    this.screen.style.height = cssH + 'px';
    if (this.post) {
      this.post.resize(cssW, cssH, dpr, W, H);
    } else {
      this.screen.width = Math.round(cssW * dpr);
      this.screen.height = Math.round(cssH * dpr);
    }
    for (const fn of this._listeners) fn(this);
  }

  // Field-relative coordinates for a client (CSS px) point.
  toField(clientX, clientY) {
    return { x: clientX / this.scale - this.fx, y: clientY / this.scale - this.fy };
  }

  // Field rect in CSS px (for positioning DOM overlays)
  fieldRectCss() {
    const s = this.scale;
    return { x: this.fx * s, y: this.fy * s, w: FIELD_W * s, h: FIELD_H * s, bottom: (this.fy + FIELD_H) * s };
  }

  shake(amount, duration = 0.25) {
    if (!this.shakeEnabled) return;
    if (amount > this.shakeAmt * (this.shakeTime > 0 ? 1 : 0)) this.shakeAmt = amount;
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  beginFrame(dt) {
    this.time += dt;
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const a = this.shakeAmt * Math.min(1, this.shakeTime * 4);
      this.shakeX = Math.round((Math.random() * 2 - 1) * a);
      this.shakeY = Math.round((Math.random() * 2 - 1) * a);
      if (this.shakeTime <= 0) { this.shakeAmt = 0; this.shakeX = this.shakeY = 0; }
    }
    const { ctx, lctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; lctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    lctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#05040c';
    ctx.fillRect(0, 0, this.W, this.H);
    lctx.fillStyle = '#000';
    lctx.fillRect(0, 0, this.W, this.H);
    // light layer is additive by nature
    lctx.globalCompositeOperation = 'lighter';
  }

  // Translate both contexts into field space (with shake). Call endField() after.
  beginField(clip = true) {
    const { ctx, lctx } = this;
    const ox = this.fx + this.shakeX, oy = this.fy + this.shakeY;
    for (const c of [ctx, lctx]) {
      c.save();
      c.translate(ox, oy);
      if (clip) { c.beginPath(); c.rect(0, 0, FIELD_W, FIELD_H); c.clip(); }
    }
  }

  endField() {
    this.ctx.restore();
    this.lctx.restore();
  }

  // s: { grade, waves (FIELD coords), flash, flashColor, chroma, lensing (internal coords), scanlines }
  present(s = {}) {
    const t0 = performance.now();
    if (this.post) {
      const waves = (s.waves || []).map((w) => ({
        x: w.x + this.fx + this.shakeX, y: w.y + this.fy + this.shakeY, r: w.r, strength: w.strength,
      }));
      this.post.render(this.main, this.light, {
        grade: s.grade || null,
        waves,
        flash: s.flash || 0,
        flashColor: s.flashColor || [1, 1, 1],
        chroma: s.chroma || 0,
        lensing: s.lensing || null,
        time: this.time,
        quality: this.quality === 'auto' ? undefined : this.quality,
        scanlines: s.scanlines !== false,
      });
    } else {
      const c = this.ctx2d;
      const k = this.scale * this.dpr;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = 1;
      c.imageSmoothingEnabled = false;
      c.drawImage(this.main, 0, 0, this.W, this.H, 0, 0, this.W * k, this.H * k);
      c.globalCompositeOperation = 'lighter';
      c.imageSmoothingEnabled = true;
      c.globalAlpha = 0.9;
      c.drawImage(this.light, 0, 0, this.W, this.H, 0, 0, this.W * k, this.H * k);
      if (s.flash > 0) {
        const fc = s.flashColor || [1, 1, 1];
        c.globalAlpha = Math.min(1, s.flash);
        c.fillStyle = `rgb(${fc[0] * 255 | 0},${fc[1] * 255 | 0},${fc[2] * 255 | 0})`;
        c.fillRect(0, 0, this.screen.width, this.screen.height);
      }
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
    }
    this.frameMs = this.frameMs * 0.95 + (performance.now() - t0) * 0.05;
  }
}
