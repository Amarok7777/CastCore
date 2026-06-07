const { asyncHandler }          = require('./routeUtils');
const { deprecatedOAuthOnly }   = require('./routeResponses');
const alertQueue                = require('../alertQueue');
const flowforgeEngine           = require('../flowforgeEngine');
const chatdeckIntervalService   = require('../chatdeckIntervalService');

function registerChatdeckRoutes(app, deps) {
  const { chatdeck, chatdeckService, authManager, twitchApiService, chatBus, platformEvents, broadcastSafely } = deps;

  chatdeckIntervalService.init(authManager, twitchApiService);
  chatdeckIntervalService.sync(chatdeck.getAll().intervalMessages || []);

  app.get('/api/chatdeck/config', (req, res) => res.json(chatdeck.getAll()));

  app.post('/api/chatdeck/config', asyncHandler(async (req, res) => {
    const updated = chatdeck.update(req.body || {});
    chatdeckService.reset();
    chatdeckIntervalService.sync(updated.intervalMessages || []);
    res.json(updated);
  }));

  app.get('/api/chatdeck/intervals/status', (_req, res) => {
    res.json(chatdeckIntervalService.getStatus());
  });

  app.get('/api/chatdeck/youtube/poll', async (req, res) => {
    const authState = authManager.getAuthState?.() || {};
    const channelInput = authState.youtube?.channel;
    let videoId = authManager.getYouTubeVideoId?.();

    if (!channelInput) {
      return res.json({ messages: [], error: 'Kein YouTube-Kanal konfiguriert' });
    }

    // Auto-discover live stream if no video ID known yet
    if (!videoId) {
      try {
        const live = await chatdeckService.findLiveStreamNoKey(channelInput);
        videoId = live.videoId || '';
        if (videoId) {
          authManager.setYouTubeStreamState({
            channelInput: live.channelTitle || channelInput,
            videoId,
            streamTitle: live.title || '',
            enabled: true,
            lookupError: false,
          });
        }
      } catch { /* not live yet */ }
    }

    if (!videoId) {
      return res.json({ messages: [], error: 'Kein aktiver YouTube-Livestream gefunden' });
    }

    const result = await chatdeckService.fetchMessagesNoKey(videoId);

    // Reset videoId if stream ended so next poll re-discovers
    if (result.error) {
      authManager.setYouTubeStreamState({ videoId: '', enabled: false, lookupError: false });
    }

    const added = chatBus.addMessages(result.messages || []);
    for (const item of added) broadcastSafely({ type: 'CHAT_MESSAGE', payload: item });

    for (const item of (result.messages || [])) {
      if (!['superchat', 'supersticker', 'membership'].includes(String(item.eventType || '').toLowerCase())) continue;
      const ev = {
        id: `yt-event-${item.id || Date.now()}`,
        platform: 'youtube',
        eventType: String(item.eventType || '').toLowerCase(),
        author: String(item.authorName || 'Unknown'),
        text: String(item.text || ''),
        amount: String(item.amount || ''),
        ts: item.publishedAt ? Date.parse(item.publishedAt) || Date.now() : Date.now(),
      };
      const r = platformEvents.add(ev);
      if (r.added) { alertQueue.push(r.item); broadcastSafely({ type: 'ALERT_EVENT', payload: r.item }); flowforgeEngine.onAlertEvent(r.item); }
    }

    res.json(result);
  });

  // ── Twitch moderation ────────────────────────────────────────────────────

  async function getTwitchModContext() {
    const oauth = await authManager.getTwitchOAuthSessionWithRefresh?.();
    const cfg   = authManager.getOAuthClientConfig?.('twitch') || {};
    if (!oauth?.accessToken || !cfg.clientId || !oauth?.userId) return null;
    return { accessToken: oauth.accessToken, clientId: cfg.clientId, broadcasterId: oauth.userId, moderatorId: oauth.userId };
  }

  app.post('/api/chatdeck/twitch/delete', asyncHandler(async (req, res) => {
    const { msgId } = req.body || {};
    if (!msgId) return res.status(400).json({ error: 'msgId required' });
    const ctx = await getTwitchModContext();
    if (!ctx) return res.status(403).json({ error: 'Twitch nicht verbunden oder fehlende Berechtigung' });
    const result = await twitchApiService.deleteMessage({ ...ctx, messageId: String(msgId) });
    res.json({ ok: result.ok, status: result.status });
  }));

  app.post('/api/chatdeck/twitch/timeout', asyncHandler(async (req, res) => {
    const { userId, duration = 600, reason = '' } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const ctx = await getTwitchModContext();
    if (!ctx) return res.status(403).json({ error: 'Twitch nicht verbunden oder fehlende Berechtigung' });
    const result = await twitchApiService.timeoutUser({ ...ctx, userId: String(userId), duration: Number(duration) || 600, reason: String(reason).slice(0, 500) });
    res.json({ ok: result.ok, status: result.status });
  }));

  app.post('/api/chatdeck/twitch/send', asyncHandler(async (req, res) => {
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ error: 'message required' });
    const ctx = await getTwitchModContext();
    if (!ctx) return res.status(403).json({ error: 'Twitch nicht verbunden oder fehlende Berechtigung' });
    const result = await twitchApiService.sendChatMessage({ ...ctx, senderId: ctx.broadcasterId, message: String(message).slice(0, 500) });
    res.json({ ok: result.ok, status: result.status });
  }));

  app.post('/api/chatdeck/twitch/ban', asyncHandler(async (req, res) => {
    const { userId, reason = '' } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const ctx = await getTwitchModContext();
    if (!ctx) return res.status(403).json({ error: 'Twitch nicht verbunden oder fehlende Berechtigung' });
    const result = await twitchApiService.banUser({ ...ctx, userId: String(userId), reason: String(reason).slice(0, 500) });
    res.json({ ok: result.ok, status: result.status });
  }));

  app.get('/api/chatdeck/youtube/find-live-nokey', (req, res) => {
    deprecatedOAuthOnly(res);
  });
  app.get('/api/chatdeck/youtube/find-live', (req, res) => {
    deprecatedOAuthOnly(res);
  });
}

module.exports = { registerChatdeckRoutes };
