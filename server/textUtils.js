/**
 * server/textUtils.js
 * Shared text-processing utilities used across server modules.
 */

/**
 * Infer the acting user from a Twitch system-message / alert text.
 * Matches patterns like "Username has subscribed" / "Username hat abonniert".
 * Returns the inferred username or empty string.
 */
function inferActorFromText(text) {
  const m = String(text || '').trim().match(/^([A-Za-z0-9_]{2,25})\s+(?:has|hat)\b/i);
  return m ? m[1] : '';
}

/**
 * Normalise a Twitch channel/username: lowercase, strip leading #.
 */
function normalizeChannel(value) {
  return String(value || '').trim().toLowerCase().replace(/^#/, '');
}

module.exports = { inferActorFromText, normalizeChannel };
