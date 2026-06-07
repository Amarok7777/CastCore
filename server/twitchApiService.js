const { postForm, postFormDetailed, apiFetch } = require('./apiUtils');

class TwitchApiService {
  async startDeviceFlow(clientId, scopes) {
    return postForm('https://id.twitch.tv/oauth2/device', {
      client_id: clientId,
      scopes: Array.isArray(scopes) ? scopes.join(' ') : String(scopes || ''),
    });
  }

  buildAuthorizationUrl({ clientId, redirectUri, scopes, challenge, state }) {
    const url = new URL('https://id.twitch.tv/oauth2/authorize');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', Array.isArray(scopes) ? scopes.join(' ') : String(scopes || ''));
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    return url.toString();
  }

  async pollDeviceToken({ clientId, deviceCode, scopes }) {
    return postFormDetailed('https://id.twitch.tv/oauth2/token', {
      client_id: clientId,
      device_code: deviceCode,
      scopes: Array.isArray(scopes) ? scopes.join(' ') : String(scopes || ''),
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
  }

  async exchangeAuthorizationCode({ clientId, clientSecret, code, redirectUri, codeVerifier }) {
    const tokenBody = {
      client_id: clientId,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    };
    if (clientSecret) tokenBody.client_secret = clientSecret;
    return postForm('https://id.twitch.tv/oauth2/token', tokenBody);
  }

  async fetchCurrentUser({ accessToken, clientId }) {
    const userRes = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Client-Id': clientId,
      },
    });
    const userJson = await userRes.json().catch(() => ({}));
    return (userJson.data || [])[0] || null;
  }

  async fetchFollowers({ accessToken, clientId, broadcasterId, first = 30 }) {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': clientId,
    };
    const res = await fetch(`https://api.twitch.tv/helix/channels/followers?broadcaster_id=${encodeURIComponent(broadcasterId)}&first=${Math.max(1, Math.min(100, Number(first) || 30))}`, { headers });
    const json = await res.json().catch(() => ({}));
    return Array.isArray(json.data) ? json.data : [];
  }

  async deleteMessage({ accessToken, clientId, broadcasterId, moderatorId, messageId }) {
    const url = `https://api.twitch.tv/helix/moderation/chat?broadcaster_id=${encodeURIComponent(broadcasterId)}&moderator_id=${encodeURIComponent(moderatorId)}&message_id=${encodeURIComponent(messageId)}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}`, 'Client-Id': clientId },
    });
    return { ok: res.ok, status: res.status };
  }

  async timeoutUser({ accessToken, clientId, broadcasterId, moderatorId, userId, duration = 600, reason = '' }) {
    const res = await fetch(`https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${encodeURIComponent(broadcasterId)}&moderator_id=${encodeURIComponent(moderatorId)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Client-Id': clientId, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { user_id: String(userId), duration: Number(duration), reason: String(reason) } }),
    });
    return { ok: res.ok, status: res.status };
  }

  async banUser({ accessToken, clientId, broadcasterId, moderatorId, userId, reason = '' }) {
    const res = await fetch(`https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${encodeURIComponent(broadcasterId)}&moderator_id=${encodeURIComponent(moderatorId)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Client-Id': clientId, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { user_id: String(userId), reason: String(reason) } }),
    });
    return { ok: res.ok, status: res.status };
  }

  async sendChatMessage({ accessToken, clientId, broadcasterId, senderId, message }) {
    const res = await fetch('https://api.twitch.tv/helix/chat/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Client-Id': clientId, 'Content-Type': 'application/json' },
      body: JSON.stringify({ broadcaster_id: String(broadcasterId), sender_id: String(senderId), message: String(message).slice(0, 500) }),
    });
    return { ok: res.ok, status: res.status };
  }

  async fetchSubscriptions({ accessToken, clientId, broadcasterId, first = 30 }) {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': clientId,
    };
    const res = await fetch(`https://api.twitch.tv/helix/subscriptions?broadcaster_id=${encodeURIComponent(broadcasterId)}&first=${Math.max(1, Math.min(100, Number(first) || 30))}`, { headers });
    const json = await res.json().catch(() => ({}));
    return Array.isArray(json.data) ? json.data : [];
  }
}

module.exports = new TwitchApiService();
