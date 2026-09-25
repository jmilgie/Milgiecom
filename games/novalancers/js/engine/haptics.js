// Nova Lancers — haptics.
// Android/Chrome: navigator.vibrate. iOS 18+ Safari has no vibrate API, but toggling an
// <input type="checkbox" switch> produces a system haptic tick, so we click a hidden label.

let enabled = true;
let label = null;
let lastAt = 0;
const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
const isIOS = typeof navigator !== 'undefined' &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

function ensureSwitch() {
  if (label || canVibrate || !isIOS) return;
  const id = 'nvl-haptic-switch';
  label = document.createElement('label');
  label.setAttribute('for', id);
  label.setAttribute('aria-hidden', 'true');
  label.style.cssText = 'position:fixed;left:-100px;top:-100px;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.id = id;
  input.tabIndex = -1;
  input.style.cssText = 'all:initial;appearance:auto;';
  label.appendChild(input);
  document.body.appendChild(label);
}

const PATTERNS = {
  tap: [8],
  light: [12],
  medium: [22],
  heavy: [40],
  bomb: [30, 40, 60],
  hit: [60, 30, 40],
  death: [90, 40, 120],
  success: [15, 60, 25],
  warning: [40, 80, 40, 80, 40],
};

export const Haptics = {
  setEnabled(v) { enabled = !!v; },
  get enabled() { return enabled; },
  init() { ensureSwitch(); },
  // type: key of PATTERNS
  play(type = 'light') {
    if (!enabled) return;
    const now = performance.now();
    if (now - lastAt < 35) return;
    lastAt = now;
    const pat = PATTERNS[type] || PATTERNS.light;
    if (canVibrate) {
      // browsers reject vibrate() before the first user gesture (and log an error)
      if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
      try { navigator.vibrate(pat); } catch { /* ignore */ }
      return;
    }
    if (label) {
      try {
        label.click();
        // multi-pulse patterns on iOS: a second tick for heavier events
        if (pat.length > 1) setTimeout(() => { try { label.click(); } catch { /* ignore */ } }, pat[0] + pat[1]);
      } catch { /* ignore */ }
    }
  },
};
