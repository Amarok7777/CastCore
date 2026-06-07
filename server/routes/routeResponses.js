// All user-controlled strings passed into HTML must go through h().
function h(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function _htmlPage(body) {
  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"></head><body style="font-family:sans-serif;padding:32px;background:#0e0e10;color:#efece8">${body}</body></html>`;
}

function jsonError(res, status, error, extra = {}) {
  return res.status(status).json({ error, ...extra });
}

function deprecatedOAuthOnly(res) {
  return jsonError(res, 410, 'Deprecated: OAuth-only Modus aktiv');
}

function oauthRequired(res, platform) {
  return jsonError(res, 401, `${platform} OAuth erforderlich`);
}

function oauthHtmlError(res, platform, message) {
  return res.status(400).send(_htmlPage(`<h3>${h(platform)} OAuth Fehler: ${h(message)}</h3>`));
}

function oauthProviderError(res, message) {
  return res.status(400).send(_htmlPage(`<h3>OAuth Fehler vom Anbieter: ${h(message)}</h3>`));
}

function oauthHtmlFailure(res, platform, message = 'Session abgelaufen oder ungültiger State. Bitte Login erneut starten.') {
  return res.status(400).send(_htmlPage(`<h3>${h(platform)} OAuth fehlgeschlagen: ${h(message)}</h3>`));
}

function oauthHtmlSuccess(res, platform, bodyHtml, closeDelayMs = 1500) {
  const ms = Math.max(0, Math.min(30000, Number(closeDelayMs) || 1500));
  return res.send(_htmlPage(
    `<h3>✅ ${h(platform)} Login erfolgreich!</h3>${bodyHtml}<script>setTimeout(()=>window.close(),${ms});<\/script>`
  ));
}

module.exports = {
  jsonError,
  deprecatedOAuthOnly,
  oauthRequired,
  oauthHtmlError,
  oauthProviderError,
  oauthHtmlFailure,
  oauthHtmlSuccess,
};
