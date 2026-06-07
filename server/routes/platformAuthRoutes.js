const {
  createOAuthState,
  peekOAuthState,
  deleteOAuthState,
} = require('../oauthUtils');
const alertQueue = require('../alertQueue');
const { jsonError } = require('./routeResponses');
const { asyncHandler } = require('./routeUtils');

// State tokens are exactly 48 hex chars (crypto.randomBytes(24).toString('hex'))
const STATE_RE = /^[0-9a-f]{48}$/;
function isValidState(s) { return STATE_RE.test(String(s || '')); }

// Safe string from query/body — max length 512 to prevent DoS
function str(v, max = 512) { return String(v || '').trim().slice(0, max); }

function registerPlatformAuthRoutes(app, deps) {
  const {
    authManager,
    twitchApiService,
    chatdeck,
    chatdeckService,
    platformEvents,
    broadcastSafely,
    TWITCH_SCOPES,
  } = deps;

  // ── OAuth client config ───────────────────────────────────────────────────

  app.get('/api/oauth-clients', (req, res) => {
    const twitch = authManager.getOAuthClientConfig('twitch');
    res.json({ twitch: { clientId: twitch.clientId } });
  });

  app.patch('/api/oauth-clients', (req, res) => {
    const { provider, clientId } = req.body || {};
    if (!provider || typeof clientId !== 'string') return jsonError(res, 400, 'provider und clientId erforderlich');
    authManager.saveOAuthClientConfig(String(provider).toLowerCase(), { clientId: clientId.trim() });
    res.json({ ok: true });
  });

  // ── Platform state ────────────────────────────────────────────────────────

  app.get('/api/platforms', (req, res) => {
    res.json(authManager.getAuthState());
  });

  // ── Twitch ────────────────────────────────────────────────────────────────

  app.post('/api/platforms/twitch/connect', asyncHandler(async (req, res) => {
    const channel = str(req.body?.channel, 100);
    if (!channel) return jsonError(res, 400, 'Channel required');
    res.json(await authManager.connectTwitch(channel));
  }));

  app.post('/api/platforms/twitch/disconnect', (req, res) => {
    authManager.disconnectTwitch();
    res.json({ ok: true });
  });

  app.post('/api/platforms/twitch/logout', (req, res) => {
    authManager.disconnectTwitch();
    authManager.clearTwitchOAuthSession();
    res.json({ ok: true });
  });

  // Twitch backfill: load recent followers + subs via Helix on connect
  app.post('/api/platforms/twitch/backfill', asyncHandler(async (req, res) => {
    try {
      const oauth = await authManager.getTwitchOAuthSessionWithRefresh?.();
      const cfg = authManager.getOAuthClientConfig?.('twitch') || {};
      const broadcasterId = String(oauth?.userId || '').trim();
      if (!oauth?.accessToken || !cfg.clientId || !broadcasterId) {
        return jsonError(res, 400, 'Twitch OAuth nicht bereit');
      }

      let imported = 0;

      try {
        const followers = await twitchApiService.fetchFollowers({
          accessToken: oauth.accessToken,
          clientId: cfg.clientId,
          broadcasterId,
          first: 30,
        });
        for (const f of followers) {
          const evt = {
            id: `tw-follow-${f.user_id || f.user_login || Math.random().toString(36).slice(2)}-${f.followed_at || ''}`,
            platform: 'twitch',
            eventType: 'follower',
            author: String(f.user_name || f.user_login || 'twitch-user'),
            text: 'has followed.',
            ts: f.followed_at ? (Date.parse(f.followed_at) || Date.now()) : Date.now(),
          };
          const r = platformEvents.add(evt);
          if (r.added) imported += 1;
        }
      } catch { /* optional endpoint */ }

      try {
        const subscriptions = await twitchApiService.fetchSubscriptions({
          accessToken: oauth.accessToken,
          clientId: cfg.clientId,
          broadcasterId,
          first: 30,
        });
        const ownChannel = String(authManager.getTwitchChannel?.() || '').trim().toLowerCase().replace(/^#/, '');
        for (const s of subscriptions) {
          const isGift = !!s.is_gift;
          const author = String(s.user_name || s.user_login || s.gifter_name || 'twitch-user');
          const authorNorm = author.trim().toLowerCase().replace(/^#/, '');
          const userId = String(s.user_id || '').trim();
          if ((ownChannel && authorNorm && authorNorm === ownChannel) || (userId && userId === broadcasterId)) continue;
          const evt = {
            id: `tw-sub-${s.user_id || s.user_login || Math.random().toString(36).slice(2)}-${s.tier || ''}-${isGift ? 'gift' : 'sub'}`,
            platform: 'twitch',
            eventType: isGift ? 'subgift' : 'sub',
            author,
            text: isGift ? 'has gifted a sub.' : 'has subscribed.',
            ts: Date.now(),
          };
          const r = platformEvents.add(evt);
          if (r.added) imported += 1;
        }
      } catch { /* optional endpoint */ }

      return res.json({ ok: true, imported });
    } catch (e) {
      return jsonError(res, 500, e.message || 'Twitch backfill fehlgeschlagen');
    }
  }));

  // Twitch Device Flow (the only login method)
  app.post('/api/platforms/twitch/oauth/start', (req, res) => {
    const cfg = authManager.getOAuthClientConfig('twitch');
    if (!cfg.clientId) {
      return jsonError(res, 400, 'Twitch Client ID nicht konfiguriert');
    }

    twitchApiService.startDeviceFlow(cfg.clientId, TWITCH_SCOPES).then((device) => {
      const state = createOAuthState('twitch-device', {
        deviceCode: String(device.device_code || ''),
        interval: Number(device.interval || 5),
        expiresAt: Date.now() + (Number(device.expires_in || 0) * 1000),
      });
      res.json({
        ok: true,
        flow: 'device',
        verificationUri: String(device.verification_uri || ''),
        userCode: String(device.user_code || ''),
        pollState: state,
        interval: Number(device.interval || 5),
        expiresIn: Number(device.expires_in || 0),
      });
    }).catch((e) => {
      jsonError(res, 400, e.message || 'Twitch Device Flow konnte nicht gestartet werden');
    });
  });

  app.get('/api/platforms/twitch/oauth/poll', asyncHandler(async (req, res) => {
    const state = String(req.query.state || '').slice(0, 96);
    if (!isValidState(state)) return jsonError(res, 400, 'Ungültiger OAuth-State');
    const flow = peekOAuthState(state);
    if (!flow || flow.provider !== 'twitch-device') {
      return jsonError(res, 400, 'Ungültiger Twitch OAuth-Status');
    }

    const cfg = authManager.getOAuthClientConfig('twitch');
    const result = await twitchApiService.pollDeviceToken({
      clientId: cfg.clientId,
      deviceCode: String(flow.deviceCode || ''),
      scopes: TWITCH_SCOPES,
    }).catch((e) => ({ ok: false, status: 500, json: { message: e.message } }));

    if (!result.ok) {
      const msg = String(result.json?.message || result.json?.error || '').toLowerCase();
      if (msg === 'authorization_pending' || msg === 'slow_down') return res.json({ ok: true, status: 'pending' });
      if (msg === 'access_denied') { deleteOAuthState(state); return jsonError(res, 400, 'Twitch-Freigabe wurde abgelehnt', { status: 'denied' }); }
      if (msg === 'expired_token' || msg === 'invalid device code') { deleteOAuthState(state); return jsonError(res, 400, 'Twitch-Code ist abgelaufen. Bitte neu starten.', { status: 'expired' }); }
      return jsonError(res, 400, result.json?.message || result.json?.error || 'Twitch OAuth fehlgeschlagen');
    }

    const token = result.json || {};
    const user = await twitchApiService.fetchCurrentUser({ accessToken: token.access_token, clientId: cfg.clientId });
    if (!user?.login) return jsonError(res, 400, 'Twitch Benutzer konnte nicht geladen werden');

    const expiresAt = Date.now() + (Number(token.expires_in || 0) * 1000);
    authManager.setTwitchOAuthSession({
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt,
      username: user.login,
      userId: user.id,
    });
    const targetChannel = authManager.getTwitchChannel?.() || user.login;
    authManager.connectTwitch(targetChannel).catch(() => {});
    deleteOAuthState(state);
    res.json({ success: true, username: user.login, channel: targetChannel, expiresAt });
  }));

  // ── YouTube (InnerTube — kein OAuth) ─────────────────────────────────────

  app.post('/api/platforms/youtube/save', (req, res) => {
    const channel = str(req.body?.channel, 100);
    if (!channel) return jsonError(res, 400, 'Channel required');

    authManager.setYouTubeStreamState({
      channelInput: channel,
      videoId: '',
      streamTitle: '',
      enabled: false,
      lookupError: false,
    });
    try {
      chatdeck.update({ youtube: { enabled: false, noApiKey: true, apiKey: '', channelInput: channel, videoId: '' } });
      chatdeckService.reset();
    } catch { /* non-fatal */ }

    res.json({ ok: true, channel });
  });

  app.post('/api/platforms/youtube/find-live', asyncHandler(async (req, res) => {
    const channelInput = authManager.getAuthState?.().youtube?.channel;
    if (!channelInput) return jsonError(res, 400, 'Kein YouTube-Kanal gespeichert');

    try {
      const live = await chatdeckService.findLiveStreamNoKey(channelInput);
      authManager.setYouTubeStreamState({
        channelInput: live.channelTitle || channelInput,
        videoId: live.videoId,
        streamTitle: live.title || '',
        enabled: true,
        lookupError: false,
      });
      chatdeckService.reset();
      res.json({ ok: true, videoId: live.videoId, title: live.title || '', channelTitle: live.channelTitle || '' });
    } catch (e) {
      authManager.setYouTubeStreamState({ lookupError: true, enabled: false, videoId: '' });
      chatdeckService.reset();
      return jsonError(res, 400, e.message || 'YouTube-Stream nicht gefunden');
    }
  }));

  app.post('/api/platforms/youtube/connect', asyncHandler(async (req, res) => {
    const channelInput = authManager.getAuthState?.().youtube?.channel;
    if (!channelInput) return jsonError(res, 400, 'Kein YouTube-Kanal gespeichert');

    try {
      const live = await chatdeckService.findLiveStreamNoKey(channelInput);
      authManager.setYouTubeStreamState({
        channelInput: live.channelTitle || channelInput,
        videoId: live.videoId,
        streamTitle: live.title || '',
        enabled: true,
        lookupError: false,
      });
      chatdeckService.reset();
      res.json({ ok: true, videoId: live.videoId, title: live.title || '' });
    } catch (e) {
      authManager.setYouTubeStreamState({ lookupError: true, enabled: false, videoId: '' });
      chatdeckService.reset();
      return jsonError(res, 400, e.message || 'YouTube-Stream nicht gefunden');
    }
  }));

  app.post('/api/platforms/youtube/disconnect', (req, res) => {
    authManager.disconnectYouTube();
    chatdeckService.reset();
    res.json({ ok: true });
  });
}

module.exports = { registerPlatformAuthRoutes };
