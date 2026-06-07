/**
 * server/oauthUtils.js
 * PKCE helpers and short-lived OAuth state management.
 * Previously embedded in httpServer.js.
 */

const crypto = require('crypto');

// ── PKCE ─────────────────────────────────────────────────────────────────────

function toBase64Url(buf) {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function createPkcePair() {
  const verifier  = toBase64Url(crypto.randomBytes(48));
  const challenge = toBase64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// ── OAuth state tokens (10-min TTL) ──────────────────────────────────────────

const states = new Map();
const STATE_TTL_MS = 10 * 60 * 1000;

function createOAuthState(provider, extra = {}) {
  const token = crypto.randomBytes(24).toString('hex');
  states.set(token, { provider, expiresAt: Date.now() + STATE_TTL_MS, ...extra });
  return token;
}

function peekOAuthState(token) {
  const key  = String(token || '');
  const item = states.get(key);
  if (!item) return null;
  if (item.expiresAt < Date.now()) { states.delete(key); return null; }
  return item;
}

function consumeOAuthState(provider, token) {
  const item = states.get(String(token || ''));
  states.delete(String(token || ''));
  if (!item) return null;
  if (item.provider !== provider) return null;
  if (item.expiresAt < Date.now()) return null;
  return item;
}

function deleteOAuthState(token) {
  states.delete(String(token || ''));
}

module.exports = { createPkcePair, createOAuthState, peekOAuthState, consumeOAuthState, deleteOAuthState };
