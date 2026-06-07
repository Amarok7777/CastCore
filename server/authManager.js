/**
 * server/authManager.js
 * Centralized platform authentication manager
 * Manages Twitch & YouTube credentials and connections
 */

const fs   = require('fs');
const path = require('path');
const { atomicWriteJson } = require('../core/fileUtils');
const secureTokenStore = require('./secureTokenStore');
const { inferActorFromText, normalizeChannel } = require('./textUtils');

const AUTH_PATH = path.join(__dirname, '..', 'data', 'platformAuth.json');
const OAUTH_CLIENTS_PATH = path.join(__dirname, '..', 'data', 'oauthClients.json');

// Default Client ID — registered CastCore Twitch app, works out of the box.
// Users can override this in Settings with their own app.
const CASTCORE_TWITCH_CLIENT_ID = 'tp5x0hwtl8eh34k1v4m3zihdnf6shy';

let authConfig = {};
let twitchWs   = null;
let twitchConnected = false;
const _chatListeners = new Set();
const _eventListeners = new Set();

// Register a callback to receive parsed Twitch chat messages
// cb({ platform:'twitch', authorName, authorColor, text })
function onTwitchChat(cb) { _chatListeners.add(cb); }
function offTwitchChat(cb) { _chatListeners.delete(cb); }
function _emitChat(msg) { _chatListeners.forEach(cb => { try { cb(msg); } catch {} }); }
function onTwitchEvent(cb) { _eventListeners.add(cb); }
function offTwitchEvent(cb) { _eventListeners.delete(cb); }
function _emitEvent(evt) { _eventListeners.forEach(cb => { try { cb(evt); } catch {} }); }

function decodeIrcTagValue(value) {
  return String(value || '').replace(/\\([snr:\\])/g, (_m, ch) => {
    if (ch === 's') return ' ';
    if (ch === 'n') return '\n';
    if (ch === 'r') return '\r';
    if (ch === ':') return ';';
    if (ch === '\\') return '\\';
    return ch;
  });
}

function ensureYouTubeState() {
  authConfig.youtube = authConfig.youtube || {};
  if (typeof authConfig.youtube.lookupError !== 'boolean') authConfig.youtube.lookupError = false;
  return authConfig.youtube;
}

function disableStaleTwitchSession(reason) {
  authConfig.twitch = authConfig.twitch || {};
  authConfig.twitch.enabled = false;
  delete authConfig.twitch.oauth;
  twitchConnected = false;
  try {
    if (twitchWs) {
      twitchWs.onclose = null;
      twitchWs.close();
      twitchWs = null;
    }
  } catch { /* non-fatal */ }
  saveAuthConfig();
  console.error(`[AuthManager] CRITICAL: ${reason}`);
}

// ── Init ────────────────────────────────────────────────────────────────

function loadAuthConfig() {
  let fileConfig = {};
  try {
    const data = fs.readFileSync(AUTH_PATH, 'utf-8');
    fileConfig = JSON.parse(data);
  } catch (err) {
    console.warn('[AuthManager] Failed to load auth config:', err.message);
    fileConfig = { twitch: {}, youtube: {} };
  }

  authConfig = fileConfig && typeof fileConfig === 'object' ? fileConfig : { twitch: {}, youtube: {} };
  authConfig.twitch = authConfig.twitch || {};
  authConfig.youtube = authConfig.youtube || {};

  const secureTokens = secureTokenStore.loadTokens();
  const fileTwitchOauth = authConfig.twitch.oauth || null;

  if (secureTokens.twitch) authConfig.twitch.oauth = secureTokens.twitch;

  // One-time migration: if legacy plaintext OAuth exists in config file,
  // move it into encrypted storage and scrub plaintext fields from disk.
  if (!secureTokens.twitch && fileTwitchOauth) {
    authConfig.twitch.oauth = fileTwitchOauth;
    saveAuthConfig();
  }

  // Clean up any legacy YouTube OAuth data
  if (authConfig.youtube?.oauth) {
    delete authConfig.youtube.oauth;
    saveAuthConfig();
  }

  return authConfig;
}

function saveAuthConfig() {
  try {
    const twitch = authConfig.twitch || {};
    const youtube = authConfig.youtube || {};

    secureTokenStore.saveTokens({ twitch: twitch.oauth || null });

    const persisted = {
      ...authConfig,
      twitch: { ...twitch },
      youtube: { ...youtube },
    };
    delete persisted.twitch.oauth;
    delete persisted.youtube.oauth;

    atomicWriteJson(AUTH_PATH, persisted);
  } catch (err) {
    console.error('[AuthManager] Failed to save auth config:', err.message);
  }
}

function loadOAuthClientConfigFile() {
  try {
    const data = fs.readFileSync(OAUTH_CLIENTS_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function saveOAuthClientConfig(provider, config) {
  const key = String(provider || '').trim().toLowerCase();
  const current = loadOAuthClientConfigFile();
  current[key] = { ...(current[key] || {}), ...config };
  atomicWriteJson(OAUTH_CLIENTS_PATH, current);
}

function init() {
  loadAuthConfig();
  // Auto-connect Twitch if enabled & configured
  if (authConfig.twitch?.enabled && authConfig.twitch?.channel) {
    setTimeout(() => {
      getTwitchOAuthSessionWithRefresh().then((session) => {
        if (!session?.accessToken) {
          console.warn('[AuthManager] Skipping Twitch auto-connect: no valid OAuth session available');
          return;
        }
        connectTwitch(authConfig.twitch.channel).catch(err => {
          console.warn('[AuthManager] Initial Twitch connect failed:', err.message);
        });
      }).catch((err) => {
        console.warn('[AuthManager] Initial Twitch session check failed:', err.message);
      });
    }, 500);
  }
  console.log('[AuthManager] Initialized');
}

// ── Getters ─────────────────────────────────────────────────────────────

function getAuthState() {
  const youtube = ensureYouTubeState();
  const twitchOauthConfig = getOAuthClientConfig('twitch');
  const youtubeOauthConfig = getOAuthClientConfig('youtube');
  return {
    twitch: {
      enabled: !!authConfig.twitch?.enabled,
      channel: authConfig.twitch?.channel || '',
      connected: twitchConnected,
      oauthLoggedIn: !!authConfig.twitch?.oauth?.accessToken,
      username: authConfig.twitch?.oauth?.username || '',
    },
    youtube: {
      enabled: !!youtube.enabled,
      channel: youtube.channelInput || '',
      videoId: youtube.videoId || '',
      title: youtube.streamTitle || '',
      lookupError: !!youtube.lookupError,
    },
    oauth: {
      twitchConfigured: !!twitchOauthConfig?.clientId,
      twitchFlow: 'device',
    },
  };
}

function getTwitchChannel() {
  return authConfig.twitch?.channel || '';
}

function getYouTubeApiKey() {
  return authConfig.youtube?.apiKey || '';
}

function getYouTubeVideoId() {
  return authConfig.youtube?.videoId || '';
}

// ── Twitch IRC helpers ──────────────────────────────────────────────────

function _parseTwitchTags(line) {
  let tags = {};
  let rest = line;
  if (rest.startsWith('@')) {
    const sp = rest.indexOf(' ');
    for (const part of rest.slice(1, sp).split(';')) {
      const eq = part.indexOf('=');
      if (eq >= 0) tags[part.slice(0, eq)] = part.slice(eq + 1);
    }
    rest = rest.slice(sp + 1);
  }
  return { tags, rest };
}

function _handleTwitchIrcLine(line, channel, resolveFn, timeout) {
  if (line.startsWith('PING')) {
    twitchWs.send('PONG :tmi.twitch.tv');
    return;
  }
  if (line.includes('ROOMSTATE')) {
    twitchConnected = true;
    clearTimeout(timeout);
    console.log(`[AuthManager] Twitch connected to #${channel}`);
    resolveFn?.({ success: true, channel });
    return;
  }

  const { tags, rest } = _parseTwitchTags(line);

  // PRIVMSG (chat message)
  const pm = rest.match(/^:[^!]+![^ ]+ PRIVMSG #\S+ :(.*)$/);
  if (pm) {
    const nick = rest.match(/^:([^!]+)!/)?.[1] || 'unknown';
    const text = pm[1].trim();
    const bits = parseInt(tags.bits || '0', 10) || 0;
    _emitChat({ platform: 'twitch', authorName: tags['display-name'] || nick, authorColor: tags['color'] || '#9146ff', text, msgId: tags.id || '', userId: tags['user-id'] || '', time: new Date().toISOString() });
    if (bits > 0) {
      _emitEvent({ id: `tw-bits-${tags.id || Date.now()}`, platform: 'twitch', eventType: 'bits', author: tags['display-name'] || nick, text, amount: String(bits), ts: Date.now() });
    }
    return;
  }

  // USERNOTICE (sub / resub / subgift / raid)
  const notice = rest.match(/^:tmi\.twitch\.tv USERNOTICE #\S+(?: :(.*))?$/);
  if (!notice) return;
  const msgId = String(tags['msg-id'] || '');
  const eventType = msgId === 'sub' ? 'sub'
    : msgId === 'resub' ? 'resub'
    : (msgId === 'subgift' || msgId === 'anonsubgift') ? 'subgift'
    : msgId === 'raid' ? 'raid'
    : '';
  if (!eventType) return;

  const systemMsg      = decodeIrcTagValue(tags['system-msg'] || notice[1] || msgId);
  const inferredAuthor = inferActorFromText(systemMsg);
  const author         = inferredAuthor || decodeIrcTagValue(tags['display-name'] || tags.login || 'twitch-user');

  // Skip own-channel subs (broadcaster subscribing to themselves)
  if (['sub', 'resub', 'subgift'].includes(eventType) && normalizeChannel(channel) === normalizeChannel(author)) return;

  const text = inferredAuthor && systemMsg.toLowerCase().startsWith(inferredAuthor.toLowerCase() + ' ')
    ? systemMsg.slice(inferredAuthor.length).trim()
    : systemMsg;

  _emitEvent({ id: `tw-event-${tags.id || Date.now()}-${eventType}`, platform: 'twitch', eventType, author, text, viewers: String(tags['msg-param-viewerCount'] || ''), ts: Date.now() });
}

// ── Twitch Management ───────────────────────────────────────────────────

function connectTwitch(channel) {
  channel = normalizeChannel(channel);

  if (!channel) {
    console.warn('[AuthManager] Empty channel name');
    return Promise.reject(new Error('Channel name required'));
  }

  const oauthToken = authConfig.twitch?.oauth?.accessToken || '';
  const oauthUser  = authConfig.twitch?.oauth?.username || '';
  if (!oauthToken || !oauthUser) {
    return Promise.reject(new Error('Twitch OAuth erforderlich. Bitte zuerst einloggen.'));
  }

  authConfig.twitch = authConfig.twitch || {};
  authConfig.twitch.channel = channel;
  authConfig.twitch.enabled = true;
  saveAuthConfig();

  return new Promise((resolve, reject) => {
    if (twitchWs) { twitchWs.onclose = null; twitchWs.close(); }

    twitchWs = new WebSocket('wss://irc-ws.chat.twitch.tv:443');

    const timeout = setTimeout(() => {
      reject(new Error('Twitch connection timeout'));
      if (twitchWs) twitchWs.close();
    }, 5000);

    let resolved = false;
    const resolveOnce = (val) => { if (!resolved) { resolved = true; resolve(val); } };

    twitchWs.onopen = () => {
      clearTimeout(timeout);
      twitchWs.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      twitchWs.send(`PASS oauth:${oauthToken.replace(/^oauth:/i, '')}`);
      twitchWs.send(`NICK ${oauthUser}`);
      twitchWs.send(`JOIN #${channel}`);
      console.log(`[AuthManager] Twitch connecting to #${channel}`);
    };

    twitchWs.onmessage = (e) => {
      for (const line of e.data.split('\r\n').filter(Boolean)) {
        _handleTwitchIrcLine(line, channel, resolveOnce, timeout);
      }
    };

    twitchWs.onerror = (err) => {
      clearTimeout(timeout);
      twitchConnected = false;
      console.error('[AuthManager] Twitch WebSocket error:', err?.message || String(err));
      reject(err);
    };

    twitchWs.onclose = () => {
      twitchConnected = false;
      console.log('[AuthManager] Twitch disconnected');
      if (!authConfig.twitch?.enabled) return;
      setTimeout(() => {
        getTwitchOAuthSessionWithRefresh().then((session) => {
          if (!session?.accessToken) {
            disableStaleTwitchSession('Twitch auto-reconnect stopped: no valid OAuth session available. Re-authentication required.');
            return;
          }
          if (!authConfig.twitch?.enabled) return;
          connectTwitch(channel).catch(err => console.warn('[AuthManager] Auto-reconnect failed:', err.message));
        }).catch(err => console.warn('[AuthManager] Auto-reconnect session check failed:', err.message));
      }, 3000);
    };
  });
}

function disconnectTwitch() {
  if (twitchWs) {
    twitchWs.onclose = null;
    twitchWs.close();
    twitchWs = null;
  }
  twitchConnected = false;
  authConfig.twitch = authConfig.twitch || {};
  authConfig.twitch.enabled = false;
  saveAuthConfig();
  console.log('[AuthManager] Twitch disconnected');
}

// ── YouTube Management ──────────────────────────────────────────────────

function setYouTubeApiKey(apiKey) {
  apiKey = (apiKey || '').trim();
  authConfig.youtube = authConfig.youtube || {};
  authConfig.youtube.apiKey = apiKey;
  authConfig.youtube.enabled = !!apiKey;
  saveAuthConfig();
  console.log('[AuthManager] YouTube API key updated');
}

function setYouTubeVideoId(videoId) {
  videoId = (videoId || '').trim();
  const youtube = ensureYouTubeState();
  youtube.videoId = videoId;
  youtube.enabled = !!videoId || !!youtube.apiKey;
  if (videoId) youtube.lookupError = false;
  saveAuthConfig();
  console.log('[AuthManager] YouTube video ID updated');
}

function setYouTubeStreamState({ channelInput, videoId, streamTitle, enabled, lookupError } = {}) {
  const youtube = ensureYouTubeState();
  if (channelInput !== undefined) youtube.channelInput = String(channelInput || '').trim();
  if (videoId !== undefined) youtube.videoId = String(videoId || '').trim();
  if (streamTitle !== undefined) youtube.streamTitle = String(streamTitle || '').trim();
  if (enabled !== undefined) youtube.enabled = !!enabled;
  else youtube.enabled = !!youtube.videoId || !!youtube.apiKey;
  if (lookupError !== undefined) youtube.lookupError = !!lookupError;
  else if (youtube.enabled && youtube.videoId) youtube.lookupError = false;
  youtube.noApiKey = true;
  youtube.apiKey = '';
  saveAuthConfig();
}

function getOAuthClientConfig(provider) {
  const key = String(provider || '').trim().toLowerCase();
  const envPrefix = key === 'twitch' ? 'TWITCH' : 'YOUTUBE';
  const fileCfg = authConfig.oauth?.[key] || {};
  const localCfg = loadOAuthClientConfigFile()?.[key] || {};
  return {
    clientId: String(process.env[`${envPrefix}_CLIENT_ID`] || localCfg.clientId || fileCfg.clientId || (key === 'twitch' ? CASTCORE_TWITCH_CLIENT_ID : '')).trim(),
    clientSecret: String(process.env[`${envPrefix}_CLIENT_SECRET`] || localCfg.clientSecret || fileCfg.clientSecret || '').trim(),
  };
}

function setTwitchOAuthSession(session) {
  authConfig.twitch = authConfig.twitch || {};
  authConfig.twitch.oauth = {
    accessToken: String(session?.accessToken || '').trim(),
    refreshToken: String(session?.refreshToken || '').trim(),
    expiresAt: Number(session?.expiresAt || 0),
    username: String(session?.username || '').trim().toLowerCase(),
    userId: String(session?.userId || '').trim(),
  };
  saveAuthConfig();
}

function clearTwitchOAuthSession() {
  authConfig.twitch = authConfig.twitch || {};
  delete authConfig.twitch.oauth;
  saveAuthConfig();
}

function getTwitchOAuthSession() {
  return authConfig.twitch?.oauth || null;
}

// ── Generic OAuth token refresh ─────────────────────────────────────────

// Returns a fresh session object on success, null if the server rejected the refresh
// (bad credentials / expired). Throws on network errors so callers can decide how to handle.
async function _refreshOAuthToken({ provider, session, tokenUrl, clientId, clientSecret }) {
  if (!clientId || !session.refreshToken) return null;
  const params = { client_id: clientId, grant_type: 'refresh_token', refresh_token: session.refreshToken };
  if (clientSecret) params.client_secret = clientSecret;
  // Intentionally no try/catch — network errors propagate to the caller.
  const res  = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
  const json = await res.json().catch(() => ({}));
  if (res.ok && json.access_token) {
    console.log(`[AuthManager] ${provider} token refreshed`);
    return {
      ...session,
      accessToken:  String(json.access_token).trim(),
      refreshToken: String(json.refresh_token || session.refreshToken).trim(),
      expiresAt:    Date.now() + Number(json.expires_in || 3600) * 1000,
    };
  }
  console.warn(`[AuthManager] ${provider} refresh failed:`, json.message || json.error || res.status);
  return null;
}

async function getTwitchOAuthSessionWithRefresh() {
  const session = getTwitchOAuthSession();
  if (!session?.accessToken) return session;
  if (Number(session.expiresAt) > Date.now() + 60_000) return session;

  const cfg = getOAuthClientConfig('twitch') || {};
  if (!cfg.clientId) { console.warn('[AuthManager] Cannot refresh Twitch: clientId missing'); return session; }
  if (!cfg.clientSecret && !session.refreshToken) {
    disableStaleTwitchSession('Twitch token expired and cannot be refreshed. User must re-authenticate via Device Flow.');
    return null;
  }

  let fresh;
  try {
    fresh = await _refreshOAuthToken({ provider: 'Twitch', session, tokenUrl: 'https://id.twitch.tv/oauth2/token', clientId: cfg.clientId, clientSecret: cfg.clientSecret });
  } catch (err) {
    // Network error — keep the expired session so a transient failure doesn't log the user out.
    console.error('[AuthManager] Twitch refresh network error:', err.message);
    return session;
  }

  if (fresh) { authConfig.twitch = authConfig.twitch || {}; authConfig.twitch.oauth = fresh; saveAuthConfig(); return fresh; }

  disableStaleTwitchSession('Twitch token expired and cannot be refreshed. User must re-authenticate via Device Flow.');
  return null;
}

function setYouTubeChannel(channelInput) {
  channelInput = (channelInput || '').trim();
  const youtube = ensureYouTubeState();
  youtube.channelInput = channelInput;
  saveAuthConfig();
  console.log('[AuthManager] YouTube channel input updated');
}

function disconnectYouTube() {
  const youtube = ensureYouTubeState();
  youtube.enabled = false;
  youtube.videoId = '';
  youtube.streamTitle = '';
  youtube.channelInput = '';
  youtube.lookupError = false;
  youtube.noApiKey = true;
  youtube.apiKey = '';
  saveAuthConfig();
  console.log('[AuthManager] YouTube disconnected');
}

function getStreamState() {
  return {
    twitch: {
      enabled: authConfig.twitch?.enabled || false,
      channel: authConfig.twitch?.channel || '',
      connected: twitchConnected,
    },
    youtube: {
      enabled: authConfig.youtube?.enabled || false,
      channel: authConfig.youtube?.channelInput || '',
      videoId: authConfig.youtube?.videoId || '',
    },
  };
}

// ── Exports ─────────────────────────────────────────────────────────────

module.exports = {
  init,
  loadAuthConfig,
  saveAuthConfig,
  getAuthState,
  getTwitchChannel,
  getYouTubeApiKey,
  getYouTubeVideoId,
  connectTwitch,
  disconnectTwitch,
  setYouTubeApiKey,
  setYouTubeVideoId,
  setYouTubeStreamState,
  setYouTubeChannel,
  disconnectYouTube,
  getOAuthClientConfig,
  saveOAuthClientConfig,
  setTwitchOAuthSession,
  clearTwitchOAuthSession,
  getTwitchOAuthSession,
  getTwitchOAuthSessionWithRefresh,
  getStreamState,
  onTwitchChat,
  offTwitchChat,
  onTwitchEvent,
  offTwitchEvent,
  // Direct access for internal usage
  get twitchWs() { return twitchWs; },
  get twitchConnected() { return twitchConnected; },
};
