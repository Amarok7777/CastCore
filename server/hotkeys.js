const { UiohookKey, uIOhook } = require('uiohook-napi');
const timer    = require('../core/timer');
const settings = require('../core/settings');

// Map human-readable key names → uiohook key codes
const KEY_MAP = {
  Numpad0: UiohookKey.Numpad0, Numpad1: UiohookKey.Numpad1,
  Numpad2: UiohookKey.Numpad2, Numpad3: UiohookKey.Numpad3,
  Numpad4: UiohookKey.Numpad4, Numpad5: UiohookKey.Numpad5,
  Numpad6: UiohookKey.Numpad6, Numpad7: UiohookKey.Numpad7,
  Numpad8: UiohookKey.Numpad8, Numpad9: UiohookKey.Numpad9,
  F1:  UiohookKey.F1,  F2:  UiohookKey.F2,  F3:  UiohookKey.F3,
  F4:  UiohookKey.F4,  F5:  UiohookKey.F5,  F6:  UiohookKey.F6,
  F7:  UiohookKey.F7,  F8:  UiohookKey.F8,  F9:  UiohookKey.F9,
  F10: UiohookKey.F10, F11: UiohookKey.F11, F12: UiohookKey.F12,
  Space: UiohookKey.Space,
};

// Current bindings: keyCode → action
let bindings = {};
let running  = false;

function registerHotkeys() {
  const cfg = settings.get('hotkeys') || {};
  bindings = {};

  const map = {
    startSplit: 'start',
    pause:      'pause',
    reset:      'reset',
    undo:       'undo',
    skip:       'skip',
  };

  for (const [setting, action] of Object.entries(map)) {
    const keyName = cfg[setting];
    const keyCode = KEY_MAP[keyName];
    if (keyCode !== undefined) {
      bindings[keyCode] = action;
    }
  }

  // Re-register the keydown handler (off first to prevent duplicate listeners)
  uIOhook.off('keydown', handleKeydown);
  uIOhook.on('keydown', handleKeydown);

  // Only start the native hook once — just swap bindings on reload.
  // Calling stop()+start() in rapid succession causes a race condition
  // where the hook silently fails to restart on some platforms.
  if (!running) {
    try {
      uIOhook.start();
      running = true;
      console.log('[Hotkeys] Started hook. Registered:', cfg);
    } catch (e) {
      console.warn('[Hotkeys] Could not start uiohook:', e.message);
      // Non-fatal — timer still works via UI/WebSocket
    }
  } else {
    console.log('[Hotkeys] Reloaded bindings (hook already running):', cfg);
  }
}

function unregisterHotkeys() {
  uIOhook.off('keydown', handleKeydown);
  try { uIOhook.stop(); } catch {}
  running  = false;   // only cleared after stop so registerHotkeys sees correct state
  bindings = {};
}

function handleKeydown(event) {
  const action = bindings[event.keycode];
  if (action) timer.dispatch(action);
}

/** Call this after settings change to reload hotkeys. */
function reloadHotkeys() {
  registerHotkeys();
}

module.exports = { registerHotkeys, unregisterHotkeys, reloadHotkeys };
