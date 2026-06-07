/**
 * shared/utils.js — global utilities loaded on every tool page.
 * No defer — must be available before inline scripts run.
 */

window.esc = function(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
};

/**
 * Fetch JSON with error handling.
 * Returns parsed body or throws with a meaningful message.
 */
window.safeJson = async function(url, opts) {
  const r = await fetch(url, opts);
  const ct = r.headers.get('content-type') || '';
  const raw = await r.text();
  if (!ct.includes('application/json')) {
    if (/<!doctype html>/i.test(raw)) throw new Error('Server nicht erreichbar — App neu starten.');
    throw new Error(raw.trim() || 'HTTP ' + r.status);
  }
  let data;
  try { data = JSON.parse(raw || '{}'); } catch { throw new Error('Ungültiges JSON'); }
  if (!r.ok) throw new Error(data.error || data.message || 'HTTP ' + r.status);
  return data;
};
