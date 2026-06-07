class ChatdeckIntervalService {
  constructor() {
    this._timers    = new Map();   // id → { timer, intervalMs, lastSentAt, nextSendAt }
    this._auth      = null;
    this._twitchApi = null;
  }

  init(authManager, twitchApiService) {
    this._auth      = authManager;
    this._twitchApi = twitchApiService;
  }

  sync(messages) {
    for (const entry of this._timers.values()) clearInterval(entry.timer);
    this._timers.clear();

    for (const msg of (messages || [])) {
      if (!msg.enabled || !msg.text || !(Number(msg.intervalMinutes) > 0)) continue;
      const intervalMs = Math.max(60_000, Number(msg.intervalMinutes) * 60_000);
      const entry = { timer: null, intervalMs, lastSentAt: null, nextSendAt: Date.now() + intervalMs };
      entry.timer = setInterval(() => this._fire(msg, entry), intervalMs);
      this._timers.set(msg.id, entry);
    }
  }

  getStatus() {
    const out = {};
    for (const [id, e] of this._timers) {
      out[id] = { lastSentAt: e.lastSentAt, nextSendAt: e.nextSendAt };
    }
    return out;
  }

  stop() {
    for (const e of this._timers.values()) clearInterval(e.timer);
    this._timers.clear();
  }

  async _fire(msg, entry) {
    try {
      const oauth = await this._auth?.getTwitchOAuthSessionWithRefresh?.();
      const cfg   = this._auth?.getOAuthClientConfig?.('twitch') || {};
      if (!oauth?.accessToken || !cfg.clientId || !oauth?.userId) return;
      await this._twitchApi.sendChatMessage({
        accessToken:   oauth.accessToken,
        clientId:      cfg.clientId,
        broadcasterId: oauth.userId,
        senderId:      oauth.userId,
        message:       String(msg.text).slice(0, 500),
      });
      entry.lastSentAt = Date.now();
      entry.nextSendAt = Date.now() + entry.intervalMs;
    } catch (e) {
      console.error(`[IntervalMsg] "${msg.id}" failed:`, e.message);
    }
  }
}

module.exports = new ChatdeckIntervalService();
