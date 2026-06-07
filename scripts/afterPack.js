'use strict';

const fs   = require('fs');
const path = require('path');

// Locale files to keep — everything else is deleted.
// Chromium ships ~60 locales; we only need German + English.
const KEEP_LOCALES = new Set(['de.pak', 'en-US.pak']);

exports.default = async function afterPack(context) {
  const out = context.appOutDir;

  // ── Remove unused locale files (~40 MB) ──────────────────────────────
  const localesDir = path.join(out, 'locales');
  if (fs.existsSync(localesDir)) {
    for (const file of fs.readdirSync(localesDir)) {
      if (!KEEP_LOCALES.has(file)) {
        fs.rmSync(path.join(localesDir, file), { force: true });
      }
    }
    const kept = fs.readdirSync(localesDir);
    console.log(`[afterPack] Locales: kept ${kept.join(', ')}`);
  }

  // ── Remove Chromium license HTML (~18 MB) ────────────────────────────
  // The license text is still included via electron's own LICENSE.electron.txt
  const chromiumLicense = path.join(out, 'LICENSES.chromium.html');
  if (fs.existsSync(chromiumLicense)) {
    fs.rmSync(chromiumLicense, { force: true });
    console.log('[afterPack] Removed LICENSES.chromium.html');
  }
};
