const fs = require('fs');
const path = require('path');

let electronApi = null;
try {
  electronApi = require('electron');
} catch {
  electronApi = null;
}

function getTokenFilePath() {
  try {
    if (electronApi?.app?.getPath) {
      return path.join(electronApi.app.getPath('userData'), 'secure-oauth-tokens.bin');
    }
  } catch {
    // ignore
  }
  return path.join(__dirname, '..', 'data', 'secure-oauth-tokens.bin');
}

function canEncrypt() {
  try {
    return !!electronApi?.safeStorage?.isEncryptionAvailable?.();
  } catch {
    return false;
  }
}

function encrypt(text) {
  return electronApi.safeStorage.encryptString(text);
}

function decrypt(buffer) {
  return electronApi.safeStorage.decryptString(buffer);
}

function normalize(tokens) {
  const input = tokens && typeof tokens === 'object' ? tokens : {};
  return {
    twitch: input.twitch && typeof input.twitch === 'object' ? input.twitch : null,
    youtube: input.youtube && typeof input.youtube === 'object' ? input.youtube : null,
  };
}

function loadTokens() {
  const filePath = getTokenFilePath();
  try {
    if (!fs.existsSync(filePath)) return normalize({});
    const raw = fs.readFileSync(filePath, 'utf-8').trim();
    if (!raw) return normalize({});

    if (!canEncrypt()) {
      console.warn('[SecureTokenStore] Encryption unavailable. Ignoring persisted OAuth tokens.');
      return normalize({});
    }

    const decrypted = decrypt(Buffer.from(raw, 'base64'));
    return normalize(JSON.parse(decrypted));
  } catch (err) {
    console.warn('[SecureTokenStore] Failed to load secure tokens:', err.message);
    return normalize({});
  }
}

function saveTokens(tokens) {
  const filePath = getTokenFilePath();
  try {
    if (!canEncrypt()) {
      console.warn('[SecureTokenStore] Encryption unavailable. OAuth tokens are kept in memory only.');
      return false;
    }

    const normalized = normalize(tokens);
    const payload = JSON.stringify(normalized);
    const encrypted = encrypt(payload);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, encrypted.toString('base64'), 'utf-8');
    return true;
  } catch (err) {
    console.error('[SecureTokenStore] Failed to save secure tokens:', err.message);
    return false;
  }
}

module.exports = { loadTokens, saveTokens };
