# OAuth 2.0 Setup Guide (2026)

## Overview

SplitFlow uses OAuth 2.0 for secure authentication with Twitch and YouTube. This guide covers setting up credentials and understanding the authentication flow.

## Twitch Authentication

### Option 1: Device Flow (Recommended for Desktop)
Device Flow is the standard OAuth method for desktop applications that don't have a web browser built-in. It requires only `clientId`.

**Requirements:**
- Twitch Application (clientId) from https://dev.twitch.tv/console/apps
- No clientSecret needed

**Setup:**
1. Get your Twitch `clientId` from https://dev.twitch.tv/console/apps
2. In SplitFlow Dashboard, go to **Twitch OAuth** → **Device Flow**
3. Enter your clientId
4. Click "Start Device Flow"
5. Follow the on-screen instructions to authorize on Twitch
6. Token will be saved and auto-refreshes

**Auto-Refresh:**
- Tokens automatically refresh when expired
- No manual re-authentication needed
- Backfill operations trigger automatic refresh

### Option 2: Authorization Code Flow (With clientSecret)
If you have a clientSecret configured, this method provides additional security.

**Requirements:**
- Twitch Application with clientId AND clientSecret
- clientSecret configured in `data/oauthClients.json`:
```json
{
  "twitch": {
    "clientId": "your_client_id",
    "clientSecret": "your_client_secret"
  }
}
```

**Setup:**
1. Configure clientSecret in `data/oauthClients.json`
2. In SplitFlow Dashboard, click "Login with Twitch"
3. Browser opens, authorize the application
4. You're redirected back with access token
5. Token auto-refreshes using clientSecret

## YouTube Authentication

### Setup:
1. Create OAuth 2.0 credentials in https://console.cloud.google.com/
2. Add credentials to `data/oauthClients.json`:
```json
{
  "youtube": {
    "clientId": "your_client_id.apps.googleusercontent.com",
    "clientSecret": "your_client_secret"
  }
}
```
3. In SplitFlow Dashboard, click "Login with YouTube"
4. Authorize access to YouTube Data API
5. Token auto-refreshes when expired

**Required Scopes:**
- `https://www.googleapis.com/auth/youtube.readonly` - Read live chat and stream info
- `https://www.googleapis.com/auth/youtube.force-ssl` - Secure access

## How It Works

### Token Storage
Credentials are stored locally in `data/platformAuth.json`:
- Access tokens for API calls
- Refresh tokens for automatic renewal
- Expiration timestamps
- User profile information

**Note:** Refresh tokens are stored locally. Ensure you secure this file.

### Automatic Token Refresh
When making API calls (backfill, polling), SplitFlow automatically:
1. Checks if token is expired (or expiring within 1 minute)
2. If expired, uses refresh token to get new access token
3. Updates stored token with new values
4. Continues with original API call

### Event Collection Flow

**Twitch:**
1. IRC connection → Real-time chat, bits, subs, raids
2. Helix API backfill → Historical followers (last 30)
3. Auto-refresh ensures backfill always has valid token

**YouTube:**
1. Live chat polling (6s interval) → Real-time superchat, membership
2. Auto-refresh ensures polling always has valid token
3. No backfill available (historical superchat requires special API access)

## Troubleshooting

### "Twitch OAuth erforderlich"
- No valid Twitch token
- Solution: Complete Device Flow or Authorization Code Flow in Dashboard

### "Token expired and cannot be refreshed"
- Token expired and no refresh token available
- Twitch Device Flow: Re-authenticate via Device Flow
- clientSecret method: Check clientSecret is correct in `data/oauthClients.json`

### YouTube not showing events
- Check YouTube is enabled in Dashboard
- Verify stream is live with valid `videoId`
- Ensure OAuth token has YouTube Data API scopes

### Backfill shows 0 events
- Check token is valid (not expired)
- Verify Twitch account is broadcaster/moderator
- Note: Only last 30 followers/subs available via API

## FAQ

**Q: Do I need clientSecret for Twitch?**
A: No. Device Flow works with just clientId. clientSecret is optional for Authorization Code Flow.

**Q: Are credentials sent to external servers?**
A: Only to Twitch (api.twitch.tv) and Google (googleapis.com) for authentication and API calls. No credentials leave your system otherwise.

**Q: How often are tokens refreshed?**
A: Automatically when expiring, before API calls. Manual refresh not needed.

**Q: Can I revoke tokens?**
A: Yes. Visit your Twitch/YouTube account settings and disconnect the application.

## Scopes Used

**Twitch:**
- `chat:read` - Read chat messages
- `bits:read` - Read bits notifications
- `channel:read:subscriptions` - Read subscription data
- `channel:read:redemptions` - Read channel points
- `moderator:read:followers` - Read follower list

**YouTube:**
- `youtube.readonly` - Read public data
- `youtube.force-ssl` - Secure access

---

**Last Updated:** 2026-05-05
**SplitFlow Version:** OAuth 2.0 (2026 Standard)
