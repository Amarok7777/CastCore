const fs   = require('fs');
const path = require('path');
const { atomicWriteJson, deepMerge } = require('../core/fileUtils');

const SETTINGS_PATH = path.join(__dirname, '..', 'data', 'settings.json');

const DEFAULTS = {
  onboardingComplete: false,

  // Hotkeys (uses uiohook-napi key codes or Electron accelerators)
  hotkeys: {
    startSplit: 'Numpad1',
    pause:      'Numpad2',
    reset:      'Numpad3',
    undo:       'Numpad4',
    skip:       'Numpad5',
  },

  // Overlay appearance
  overlay: {
    theme:            'dark',      // 'dark' | 'midnight' | 'clean' | 'neon' | 'custom'
    opacity:          0.92,        // 0–1
    uiScale:          1.0,         // 0.8–2.2 (global overlay scale)
    width:            280,         // px
    timerFontSize:    36,          // px
    timerPosition:    'bottom',    // 'top' | 'bottom'
    showSplits:       true,
    showComparison:   'pb',        // 'pb' | 'sob' | 'wr' | 'none'
    showGoldSplits:   true,
    showAttempts:     true,
    showSobRow:       true,
    simpleTimerMode:  false,       // if true: only timer, no splits/footer/meta
    maxVisibleSplits: 10,          // scrolling window
    customCSS:        '',

    // Custom theme colors (used when theme === 'custom')
    colors: {
      background:   'rgba(15,15,20,0.92)',
      timerText:    '#ffffff',
      splitText:    '#e8e8e8',
      mutedText:    '#888888',
      ahead:        '#4fc97a',
      behind:       '#e05555',
      gold:         '#f0c040',
      accent:       '#7c6ef0',
    },
  },

  // OBS integration (optional)
  obs: {
    enabled:   false,
    address:   'ws://localhost:4455',
    password:  '',
    autoStart: false,  // start timer when OBS starts recording
    autoReset: false,  // reset timer when OBS stops recording
  },

  // Active splits profile
  activeProfileId: null,
};

function load() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    return deepMerge(DEFAULTS, JSON.parse(raw));
  } catch {
    return { ...DEFAULTS };
  }
}

function getAll() {
  return load();
}

const ALLOWED_HOTKEY_NAMES = new Set(['startSplit', 'pause', 'reset', 'undo', 'skip']);
const ALLOWED_TOP_KEYS     = new Set(['hotkeys', 'overlay', 'obs', 'activeProfileId', 'onboardingComplete']);

function sanitizePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return {};
  const out = {};
  for (const key of Object.keys(patch)) {
    if (!ALLOWED_TOP_KEYS.has(key)) continue;
    out[key] = patch[key];
  }
  // Hotkeys: only known names, string values, max 100 chars
  if (out.hotkeys && typeof out.hotkeys === 'object') {
    const hk = {};
    for (const [k, v] of Object.entries(out.hotkeys)) {
      if (ALLOWED_HOTKEY_NAMES.has(k) && typeof v === 'string') hk[k] = v.slice(0, 100);
    }
    out.hotkeys = hk;
  }
  // Cap customCSS to 50 KB to prevent disk-fill attacks
  if (typeof out.overlay?.customCSS === 'string') {
    out.overlay = { ...out.overlay, customCSS: out.overlay.customCSS.slice(0, 50_000) };
  }
  return out;
}

function update(patch) {
  const current = load();
  const merged  = deepMerge(current, sanitizePatch(patch));
  atomicWriteJson(SETTINGS_PATH, merged);
  return merged;
}

const ALLOWED_GET_ROOTS = new Set(['hotkeys', 'overlay', 'obs', 'activeProfileId']);

function get(key) {
  const keys = String(key || '').split('.');
  // Reject prototype-pollution attempts
  if (keys.some(k => k === '__proto__' || k === 'constructor' || k === 'prototype')) return undefined;
  if (!ALLOWED_GET_ROOTS.has(keys[0])) return undefined;
  let val = load();
  for (const k of keys) {
    if (val == null) return undefined;
    val = val[k];
  }
  return val;
}


module.exports = { getAll, update, get, DEFAULTS };
