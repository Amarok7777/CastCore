const { postForm } = require('./apiUtils');

class YouTubeApiService {
  buildAuthorizationUrl({ clientId, redirectUri, challenge, state }) {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('scope', 'https://www.googleapis.com/auth/youtube.readonly');
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    return url.toString();
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
    return postForm('https://oauth2.googleapis.com/token', tokenBody);
  }

  async fetchOwnChannel(accessToken) {
    const meRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const meJson = await meRes.json().catch(() => ({}));
    return (meJson.items || [])[0] || null;
  }
}

module.exports = new YouTubeApiService();
