'use strict';
let hotkeys = { startSplit:'Numpad1', pause:'Numpad2', reset:'Numpad3', undo:'Numpad4', skip:'Numpad5' };
let captureTarget = null;

async function boot() {
  try {
    const s = await safeJson('/api/settings');
    if (s && s.hotkeys) hotkeys = Object.assign({}, hotkeys, s.hotkeys);
    applyForm();
  } catch(_) {}
  try {
    const cfg = await safeJson('/api/oauth-clients');
    const el = document.getElementById('twitch-client-id');
    if (el && cfg?.twitch?.clientId) el.value = cfg.twitch.clientId;
  } catch(_) {}
}

async function saveClientId() {
  const clientId = document.getElementById('twitch-client-id').value.trim();
  if (!clientId) { toast('Bitte eine Client ID eingeben', 'error'); return; }
  try {
    await safeJson('/api/oauth-clients', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'twitch', clientId }),
    });
    toast('Client ID gespeichert', 'ok');
  } catch(_) { toast('Fehler beim Speichern', 'error'); }
}

function applyForm() {
  for (const [k, v] of Object.entries(hotkeys)) {
    const btn = document.getElementById('hk-' + k);
    if (btn) btn.textContent = v || '—';
  }
  checkConflicts();
}

function captureHotkey(key, btn) {
  if (captureTarget) {
    captureTarget.classList.remove('capture');
    captureTarget.textContent = hotkeys[captureTarget.id.replace('hk-', '')] || '—';
  }
  captureTarget = btn;
  btn.classList.add('capture');
  btn.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><circle cx="5" cy="5" r="4"/></svg> ${t('settings.hotkeys.capture')}`;
}

document.addEventListener('keydown', function(e) {
  if (!captureTarget) return;
  e.preventDefault();
  if (e.key === 'Escape') {
    captureTarget.classList.remove('capture');
    captureTarget.textContent = hotkeys[captureTarget.id.replace('hk-', '')] || '—';
    captureTarget = null;
    return;
  }
  const mapped = mapKey(e);
  if (!mapped) return;
  const key = captureTarget.id.replace('hk-', '');
  hotkeys[key] = mapped;
  captureTarget.classList.remove('capture');
  captureTarget.textContent = mapped;
  captureTarget = null;
  checkConflicts();
});

function mapKey(e) {
  if (e.code.startsWith('Numpad')) return e.code;
  if (/^F\d+$/.test(e.code)) return e.code;
  if (['Space','Insert','Delete','Home','End'].includes(e.code)) return e.code;
  return null;
}

function checkConflicts() {
  const vals = Object.values(hotkeys).filter(Boolean);
  const dupes = vals.filter((v, i) => vals.indexOf(v) !== i);
  for (const [k, v] of Object.entries(hotkeys)) {
    const btn = document.getElementById('hk-' + k);
    if (btn) btn.classList.toggle('conflict', dupes.includes(v));
  }
  return dupes.length === 0;
}

function resetHotkeys() {
  hotkeys = { startSplit:'Numpad1', pause:'Numpad2', reset:'Numpad3', undo:'Numpad4', skip:'Numpad5' };
  applyForm();
}

async function saveHotkeys() {
  if (!checkConflicts()) { toast(t('settings.hotkeys.conflict'), 'error'); return; }
  try {
    await safeJson('/api/settings', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hotkeys }),
    });
    toast(t('settings.hotkeys.saved'), 'ok');
  } catch(_) { toast(t('settings.hotkeys.save_error'), 'error'); }
}

boot();

document.querySelector('details')?.addEventListener('toggle', function() {
  const arrow = document.getElementById('adv-arrow');
  if (arrow) arrow.style.transform = this.open ? 'rotate(180deg)' : '';
});
