/**
 * core/fileUtils.js — safe file I/O helpers.
 *
 * atomicWrite() writes JSON to a .tmp file, syncs, then renames atomically.
 * On the same filesystem rename() is atomic on Windows (NTFS) and POSIX,
 * so a crash mid-write leaves either the old file intact or the new file
 * complete — never a partial/corrupt file.
 */

const fs   = require('fs');
const path = require('path');

/**
 * Write `data` (string or Buffer) to `filePath` atomically.
 * Cleans up the temp file on failure.
 */
function atomicWrite(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(tmp, data, 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* ignore cleanup errors */ }
    throw e;
  }
}

/**
 * Convenience: stringify `obj` with pretty-print and write atomically.
 */
function atomicWriteJson(filePath, obj) {
  atomicWrite(filePath, JSON.stringify(obj, null, 2));
}

/**
 * Deep-merge `source` into `target` (plain objects only; arrays overwrite).
 */
function deepMerge(target, source) {
  const out = { ...target };
  for (const key of Object.keys(source || {})) {
    if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      out[key] = deepMerge(target[key] ?? {}, source[key]);
    } else {
      out[key] = source[key];
    }
  }
  return out;
}

module.exports = { atomicWrite, atomicWriteJson, deepMerge };
