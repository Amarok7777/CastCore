/**
 * server/apiUtils.js — shared HTTP helpers for Twitch/YouTube API services.
 */

/**
 * POST form-encoded data to a URL and return parsed JSON.
 * Throws with a human-readable message on HTTP errors.
 */
async function postForm(url, data) {
  const body = new URLSearchParams(data).toString();
  const res  = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error_description || json.message || json.error
      || `OAuth token exchange failed (${res.status})`);
  }
  return json;
}

/**
 * Like postForm but returns { ok, status, json } instead of throwing on error.
 */
async function postFormDetailed(url, data) {
  const body = new URLSearchParams(data).toString();
  const res  = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

/**
 * GET JSON with Bearer token. Throws on non-2xx.
 */
async function apiFetch(url, { accessToken, clientId } = {}) {
  const headers = {};
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  if (clientId)    headers['Client-Id']     = clientId;
  const res  = await fetch(url, { headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || json.error || `API error ${res.status}`);
  return json;
}

module.exports = { postForm, postFormDetailed, apiFetch };
