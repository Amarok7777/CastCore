// ═══════════════════════════════════════════════════════════════════════════
//  State
// ═══════════════════════════════════════════════════════════════════════════

// Overlay port is always dashboard_port - 1 (7332 - 1 = 7331 by default)
const OVERLAY_PORT = parseInt(location.port || '7332', 10) - 1;
const OVERLAY_BASE = 'http://' + location.hostname + ':' + OVERLAY_PORT;

let ws          = null;
let snapshot    = null;
let settings    = {};
let profiles    = [];
let currentProfileId = null;
let captureTarget = null;
let rafId       = null;
let serverEpoch = 0;
let isDirty     = false;
let activeTimerProfileId = null;
let pulseTimer  = null;
let toastTimer  = null;
const saveDebounceTimers = new Map();

let hotkeys = {
  startSplit: 'Numpad1',
  pause:      'Numpad2',
  reset:      'Numpad3',
  undo:       'Numpad4',
  skip:       'Numpad5',
};

// ═══════════════════════════════════════════════════════════════════════════
//  Boot
// ═══════════════════════════════════════════════════════════════════════════

async function boot() {
  await loadSettings();
  await loadProfiles();
  connectWS();
  initNav();
  initThemeChips();
  applySettingsToForm();
  initAppearanceDesigner();
  updateNavStatus();
  updatePreviewGuide();
}

// ═══════════════════════════════════════════════════════════════════════════
//  Dirty tracking
// ═══════════════════════════════════════════════════════════════════════════

function markDirty() {
  if (isDirty) return;
  isDirty = true;
  const btn = document.getElementById('btn-save-profile');
  if (btn) btn.classList.add('dirty');
}

function markClean() {
  isDirty = false;
  const btn = document.getElementById('btn-save-profile');
  if (btn) btn.classList.remove('dirty');
}

// ═══════════════════════════════════════════════════════════════════════════
//  Navigation
// ═══════════════════════════════════════════════════════════════════════════

function initNav() {
  document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('panel-' + tab.dataset.panel).classList.add('active');
      updatePreviewGuide();
    });
  });
  document.getElementById('f-game').addEventListener('input', markDirty);
  document.getElementById('f-category').addEventListener('input', markDirty);
}

// ─── Sidebar status + setup guide ──────────────────────────────────────────
function updateNavStatus() {
  // Splits status
  const sub = document.getElementById('nav-sub-splits');
  if (sub) {
    if (profiles.length === 0) {
      sub.textContent = 'Noch kein Profil';
      sub.className = 'nav-item-status warn';
    } else if (currentProfileId) {
      const p = profiles.find(x => x.id === currentProfileId);
      sub.textContent = p ? `${p.game}` : `${profiles.length} Profil${profiles.length > 1 ? 'e' : ''}`;
      sub.className = 'nav-item-status ok';
    } else {
      sub.textContent = `${profiles.length} Profil${profiles.length > 1 ? 'e' : ''} vorhanden`;
      sub.className = 'nav-item-status';
    }
  }
  // Hotkeys status
  const hkSub = document.getElementById('nav-sub-hotkeys');
  if (hkSub) {
    const vals = Object.values(hotkeys).filter(Boolean);
    const dupes = vals.filter((v, i) => vals.indexOf(v) !== i);
    if (dupes.length > 0) {
      hkSub.textContent = `Konflikt: ${dupes[0]} doppelt`;
      hkSub.className = 'nav-item-status warn';
    } else {
      const defaults = ['Numpad1','Numpad2','Numpad3','Numpad4','Numpad5'];
      const isDefault = vals.every((v, i) => v === defaults[i]);
      hkSub.textContent = isDefault ? 'Standard: Numpad 1–5' : 'Angepasst';
      hkSub.className = isDefault ? 'nav-item-status' : 'nav-item-status ok';
    }
  }
  // Setup guide step indicators
  const hasProfile = profiles.length > 0;
  const timerActive = !!activeTimerProfileId;
  setSgStep(1, hasProfile);
  setSgStep(2, timerActive);
  // Step 3 (OBS) can't auto-verify, so leave it always pending
}
function setSgStep(n, done) {
  const num  = document.getElementById('sg-num' + n);
  const row  = document.getElementById('sg-step' + n);
  if (!num) return;
  if (done) {
    num.classList.add('done');
    num.innerHTML = `<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.5l2.5 2.5L10 3"/></svg>`;
    if (row) row.style.opacity = '0.55';
  } else {
    num.classList.remove('done');
    num.textContent = String(n);
    if (row) row.style.opacity = '1';
  }
}

// ─── Preview panel: contextual guidance ────────────────────────────────────
function updatePreviewGuide() {
  const el = document.getElementById('pv-guide-content');
  if (!el) return;
  if (profiles.length === 0) {
    el.innerHTML = `
      <svg class="pv-hint-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 20h8M12 16v4"/>
      </svg>
      <p><strong style="color:var(--tm)">Schritt 1:</strong> Erstelle dein erstes Profil mit Spielname, Kategorie und Splits.</p>
      <button class="btn sm" onclick="document.querySelector('[data-panel=splits]').click()">Zum Profil-Editor →</button>`;
  } else if (!activeTimerProfileId) {
    el.innerHTML = `
      <svg class="pv-hint-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="12" r="9"/><path d="M10 8.5l5 3.5-5 3.5z"/>
      </svg>
      <p><strong style="color:var(--tm)">Schritt 2:</strong> Wähle ein Profil und klicke <strong>„In Timer laden"</strong> — dann läuft der Timer im Overlay mit.</p>
      <button class="btn sm" onclick="document.querySelector('[data-panel=splits]').click()">Profil laden →</button>`;
  } else {
    el.innerHTML = `
      <svg class="pv-hint-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
      </svg>
      <p><strong style="color:var(--tm)">Schritt 3:</strong> Füge <code>${OVERLAY_BASE}/splitflow</code> als Browser-Source in OBS hinzu — fertig!</p>`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  WebSocket
// ═══════════════════════════════════════════════════════════════════════════

function setWsTopbar(ok) {
  const badge = document.getElementById('ws-topbar-badge');
  const dot   = document.getElementById('ws-topbar-dot');
  const text  = document.getElementById('ws-topbar-text');
  if (badge) badge.className = ok ? 'badge ok' : 'badge neutral';
  if (dot)   dot.style.opacity = ok ? '1' : '0.4';
  if (text)  text.textContent  = ok ? 'verbunden' : 'getrennt';
}

function connectWS() {
  const wsUrl = new URL(location.href);
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  wsUrl.port     = location.port || '7332';
  wsUrl.pathname = '/';
  ws = new WebSocket(wsUrl.toString());

  ws.onopen = () => {
    setWsTopbar(true);
    loadProfiles();
    safeJson('/api/timer/state').then(s => {
      snapshot = s; serverEpoch = Date.now();
      updatePreviewHeader(s);
      activeTimerProfileId = s.profile?.id || null;
      updateActiveBadge();
      updateNavStatus();
      updatePreviewGuide();
      if (s.state === 'running') startRaf();
    }).catch(() => {});
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'SNAPSHOT' || msg.type === 'UPDATE') {
      snapshot    = msg.payload;
      serverEpoch = Date.now();
      updatePreviewHeader(snapshot);
      activeTimerProfileId = snapshot.profile?.id || null;
      updateActiveBadge();
      updateNavStatus();
      updatePreviewGuide();
      if (snapshot.state === 'running') startRaf();
      else { stopRaf(); updatePreviewHeader(snapshot); }
    }
    if (msg.type === 'SETTINGS_UPDATE') {
      // Pulse the sync dot so the user knows the overlay iframe just updated
      pulseSyncDot();
    }
  };

  ws.onclose = () => {
    setWsTopbar(false);
    setTimeout(connectWS, 2000);
  };

  ws.onerror = () => ws.close();
}

function startRaf() {
  if (rafId) return;
  (function tick() {
    if (snapshot?.state === 'running') {
      const live = snapshot.elapsed + (Date.now() - serverEpoch) / 1000;
      renderTime(live);
    }
    rafId = requestAnimationFrame(tick);
  })();
}
function stopRaf() { if (rafId) cancelAnimationFrame(rafId); rafId = null; }

function renderTime(_secs) { /* pv-time display removed */ }

// SVG icons for the dynamic start button
const IC_PLAY    = `<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M3 2.5l6 3.5-6 3.5z"/></svg>`;
const IC_SPLIT   = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h6M7.5 3.5L10 6l-2.5 2.5"/></svg>`;
const IC_RESTART = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 6a4 4 0 1 0 .75-2.35"/><path d="M2 2.5V6h3.5"/></svg>`;

function updatePreviewHeader(s) {
  if (!s) return;
  const startBtn = document.getElementById('ctrl-start');
  if (startBtn) {
    if (s.state === 'running')       startBtn.innerHTML = `${IC_SPLIT} Split`;
    else if (s.state === 'paused')   startBtn.innerHTML = `${IC_PLAY} Fortsetzen`;
    else if (s.state === 'finished') startBtn.innerHTML = `${IC_RESTART} Neu starten`;
    else                             startBtn.innerHTML = `${IC_PLAY} Start`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Timer actions
// ═══════════════════════════════════════════════════════════════════════════

async function timerAction(action) {
  await safeJson(`/api/timer/${action}`, { method: 'POST' });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Profiles & Splits
// ═══════════════════════════════════════════════════════════════════════════

async function loadProfiles() {
  profiles = await safeJson('/api/splits');
  renderProfileSelect();
  updateNavStatus();
  updatePreviewGuide();
}

function renderProfileSelect() {
  const sel = document.getElementById('profile-select');
  const val = sel.value;
  sel.innerHTML = '<option value="">— Profil wählen —</option>' +
    profiles.map(p => `<option value="${p.id}">${p.game} — ${p.category}</option>`).join('');
  if (val) sel.value = val;
}

async function onProfileSelect() {
  const id = document.getElementById('profile-select').value;
  if (isDirty && currentProfileId) {
    if (!confirm('Ungespeicherte Änderungen gehen verloren. Trotzdem wechseln?')) {
      document.getElementById('profile-select').value = currentProfileId || '';
      return;
    }
  }
  markClean();
  if (!id) {
    currentProfileId = null;
    document.getElementById('btn-load-timer').disabled = true;
    document.getElementById('btn-delete-profile').style.display = 'none';
    const pvProfEl = document.getElementById('pv-profile');
    if (pvProfEl) pvProfEl.textContent = 'Kein Profil geladen';
    sendPreviewProfile(null);
    updateActiveBadge();
    updateNavStatus();
    updatePreviewGuide();
    return;
  }
  currentProfileId = id;
  document.getElementById('btn-load-timer').disabled = false;
  document.getElementById('btn-delete-profile').style.display = '';
  updateActiveBadge();
  const profile = await safeJson(`/api/splits/${id}`);
  document.getElementById('f-game').value     = profile.game     || '';
  document.getElementById('f-category').value = profile.category || '';
  renderSplitsTable(profile.splits || []);
  // Show selected profile in canvas header and preview overlay immediately
  const pvProfEl2 = document.getElementById('pv-profile');
  if (pvProfEl2) pvProfEl2.textContent = `${profile.game || ''}${profile.category ? ' — ' + profile.category : ''}`;
  sendPreviewProfile(profile);
  updateNavStatus();
  updatePreviewGuide();
}

function sendPreviewProfile(profile) {
  const frame = document.getElementById('appearance-preview');
  if (!frame?.contentWindow) return;
  frame.contentWindow.postMessage({ type: 'PREVIEW_PROFILE', payload: profile || null }, '*');
}

function renderSplitsTable(splits) {
  const tbody = document.getElementById('splits-tbody');
  tbody.innerHTML = '';
  if (splits.length === 0) tbody.appendChild(makeEmptyRow());
  else splits.forEach((s, i) => tbody.appendChild(makeSplitRow(s, i)));
  updateSplitsSummary();
}

function makeEmptyRow() {
  const tr = document.createElement('tr');
  tr.className = 'empty-state-row';
  tr.id = 'splits-empty-row';
  tr.innerHTML = '<td colspan="5">Noch keine Splits — klicke <strong>+ Hinzufügen</strong> oder importiere eine LSS-Datei von LiveSplit</td>';
  return tr;
}

function updateEmptyRow() {
  const tbody = document.getElementById('splits-tbody');
  const real  = [...tbody.querySelectorAll('tr:not(.empty-state-row)')];
  const empty = tbody.querySelector('.empty-state-row');
  if (real.length === 0 && !empty) tbody.appendChild(makeEmptyRow());
  else if (real.length > 0 && empty) empty.remove();
}

function makeSplitRow(s = {}, idx) {
  const tr = document.createElement('tr');
  tr.dataset.idx = idx;
  tr.draggable   = true;

  tr.innerHTML = `
    <td><span class="drag-handle" title="Ziehen zum Sortieren">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
        <circle cx="4" cy="3" r="1"/><circle cx="8" cy="3" r="1"/>
        <circle cx="4" cy="6" r="1"/><circle cx="8" cy="6" r="1"/>
        <circle cx="4" cy="9" r="1"/><circle cx="8" cy="9" r="1"/>
      </svg></span></td>
    <td><input type="text" value="${esc(s.name||'')}" placeholder="Split-Name"></td>
    <td><input type="number" class="pb-val" value="${s.pb ?? ''}" placeholder="Sek." step="0.001" min="0"></td>
    <td><input type="number" class="gold-val" value="${s.gold ?? ''}" placeholder="Sek." step="0.001" min="0"></td>
    <td><button class="del-btn" title="Löschen">
      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <path d="M2 2l8 8M10 2l-8 8"/>
      </svg></button></td>`;

  tr.querySelector('.del-btn').addEventListener('click', () => deleteSplitRow(tr.querySelector('.del-btn')));

  tr.addEventListener('dragstart', e => {
    const realRows = [...tr.closest('tbody').querySelectorAll('tr:not(.empty-state-row)')];
    e.dataTransfer.setData('text/plain', realRows.indexOf(tr));
    tr.style.opacity = '0.4';
  });
  tr.addEventListener('dragend',   () => tr.style.opacity = '1');
  tr.addEventListener('dragover',  e => { e.preventDefault(); tr.classList.add('drag-over'); });
  tr.addEventListener('dragleave', () => tr.classList.remove('drag-over'));
  tr.addEventListener('drop', e => {
    e.preventDefault(); tr.classList.remove('drag-over');
    const fromIdx = +e.dataTransfer.getData('text/plain');
    const tbody   = tr.closest('tbody');
    const rows    = [...tbody.querySelectorAll('tr:not(.empty-state-row)')];
    const toIdx   = rows.indexOf(tr);
    if (fromIdx === toIdx) return;
    const moved = rows.splice(fromIdx, 1)[0];
    rows.splice(toIdx, 0, moved);
    tbody.innerHTML = '';
    rows.forEach(r => tbody.appendChild(r));
    updateEmptyRow(); updateSplitsSummary(); markDirty();
  });

  tr.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => { updateSplitsSummary(); markDirty(); }));
  return tr;
}

function getSplitsFromTable() {
  return [...document.querySelectorAll('#splits-tbody tr:not(.empty-state-row)')].map(tr => {
    const [, nameCell, pbCell, goldCell] = tr.querySelectorAll('td');
    const name = nameCell.querySelector('input').value.trim();
    const pb   = parseFloat(pbCell.querySelector('input').value)   || null;
    const gold = parseFloat(goldCell.querySelector('input').value) || null;
    return { name, pb, gold, sobTime: gold };
  });
}

function updateSplitsSummary() {
  const splits = getSplitsFromTable();
  const pbTotal  = splits.reduce((a, s) => a + (s.pb   || 0), 0);
  const sobTotal = splits.reduce((a, s) => a + (s.gold || s.pb || 0), 0);
  const parts = [`${splits.length} Split${splits.length !== 1 ? 's' : ''}`];
  if (pbTotal  > 0) parts.push(`PB: ${fmtTime(pbTotal, false)}`);
  if (sobTotal > 0 && sobTotal !== pbTotal) parts.push(`SoB: ${fmtTime(sobTotal, false)}`);
  document.getElementById('splits-summary').textContent = parts.join(' · ');
}

function addSplit() {
  const tbody = document.getElementById('splits-tbody');
  const idx   = [...tbody.querySelectorAll('tr:not(.empty-state-row)')].length;
  const emptyRow = tbody.querySelector('.empty-state-row');
  if (emptyRow) emptyRow.remove();
  const newRow = makeSplitRow({}, idx);
  tbody.appendChild(newRow);
  updateSplitsSummary(); markDirty();
  requestAnimationFrame(() => {
    newRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    newRow.querySelector('input[type=text]')?.focus();
  });
}

function deleteSplitRow(btn) {
  btn.closest('tr').remove();
  updateEmptyRow(); updateSplitsSummary(); markDirty();
}

function clearSplits() {
  if (!confirm('Alle Splits leeren?')) return;
  const tbody = document.getElementById('splits-tbody');
  tbody.innerHTML = '';
  tbody.appendChild(makeEmptyRow());
  updateSplitsSummary(); markDirty();
}

function newProfile() {
  if (isDirty && currentProfileId) {
    if (!confirm('Ungespeicherte Änderungen gehen verloren. Trotzdem fortfahren?')) return;
  }
  document.getElementById('profile-select').value = '';
  document.getElementById('f-game').value     = '';
  document.getElementById('f-category').value = '';
  document.getElementById('btn-load-timer').disabled = true;
  document.getElementById('btn-delete-profile').style.display = 'none';
  currentProfileId = null;
  const tbody = document.getElementById('splits-tbody');
  tbody.innerHTML = '';
  tbody.appendChild(makeEmptyRow());
  updateSplitsSummary(); markClean();
  updateNavStatus();
  updatePreviewGuide();
}

async function saveProfile() {
  const game     = document.getElementById('f-game').value.trim();
  const category = document.getElementById('f-category').value.trim();
  if (!game || !category) { toast('Spielname und Kategorie erforderlich', 'error'); return; }

  let attempts = 0, finished = 0;
  if (currentProfileId) {
    try {
      const existing = await safeJson(`/api/splits/${currentProfileId}`);
      attempts = existing.attempts || 0;
      finished = existing.finished || 0;
    } catch { /* new profile */ }
  }

  const data = {
    id: currentProfileId || slugify(`${game}-${category}`),
    game, category, attempts, finished,
    splits: getSplitsFromTable(),
  };

  const { id } = await safeJson('/api/splits', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  currentProfileId = id;
  await loadProfiles();
  document.getElementById('profile-select').value = id;
  document.getElementById('btn-load-timer').disabled = false;
  document.getElementById('btn-delete-profile').style.display = '';
  markClean();
  toast('Profil gespeichert', 'success');
  updateNavStatus();
  updatePreviewGuide();
}

async function loadProfileIntoTimer() {
  if (!currentProfileId) { toast('Kein Profil ausgewählt', 'error'); return; }
  try {
    await safeJson('/api/splits/' + currentProfileId + '/load', { method: 'POST' });
    activeTimerProfileId = currentProfileId;
    updateActiveBadge();
    toast('Profil in Timer geladen', 'success');
    updateNavStatus();
    updatePreviewGuide();
  } catch (e) {
    toast('Fehler beim Laden: ' + (e.message || 'Unbekannt'), 'error');
  }
}

async function deleteProfile() {
  if (!currentProfileId) return;
  const profileName = document.getElementById('f-game').value || currentProfileId;
  if (!confirm(`Profil "${profileName}" wirklich löschen?`)) return;
  await safeJson('/api/splits/' + currentProfileId, { method: 'DELETE' });
  if (activeTimerProfileId === currentProfileId) activeTimerProfileId = null;
  currentProfileId = null;
  markClean();
  await loadProfiles();
  document.getElementById('profile-select').value = '';
  document.getElementById('f-game').value = '';
  document.getElementById('f-category').value = '';
  document.getElementById('btn-load-timer').disabled = true;
  document.getElementById('btn-delete-profile').style.display = 'none';
  const tbody = document.getElementById('splits-tbody');
  tbody.innerHTML = '';
  tbody.appendChild(makeEmptyRow());
  updateSplitsSummary();
  toast('Profil gelöscht', 'success');
  updateNavStatus();
  updatePreviewGuide();
}

function updateActiveBadge() {
  const badge = document.getElementById('active-badge');
  if (!badge) return;
  badge.style.display = (activeTimerProfileId && activeTimerProfileId === currentProfileId) ? '' : 'none';
}

async function importLSS() {
  if (window.splitflow) {
    const profile = await window.splitflow.importLSS();
    if (!profile) return;
    await loadProfiles();
    document.getElementById('profile-select').value = profile.id;
    onProfileSelect();
    toast('LSS importiert: ' + profile.game, 'success');
  } else {
    toast('LSS-Import nur in der Electron-App verfügbar', 'error');
  }
}

async function exportLSS() {
  if (!currentProfileId) { toast('Zuerst Profil speichern', 'error'); return; }
  if (window.splitflow) {
    await window.splitflow.exportLSS(currentProfileId);
    toast('LSS exportiert', 'success');
  } else {
    toast('LSS-Export nur in der Electron-App verfügbar', 'error');
  }
}

async function exportProfileJSON() {
  if (!currentProfileId) { toast('Zuerst Profil speichern oder laden', 'error'); return; }
  try {
    const profile = await safeJson('/api/splits/' + currentProfileId);
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const safeName = [profile.game, profile.category].filter(Boolean)
      .join(' — ').replace(/[/\\?%*:|"<>]/g, '_') || currentProfileId;
    a.href = url; a.download = safeName + '.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('JSON exportiert', 'success');
  } catch (e) {
    toast('Export fehlgeschlagen: ' + e.message, 'error');
  }
}

function copySidebarObsUrl() {
  const url = OVERLAY_BASE + '/splitflow';
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).catch(() => legacyCopy(url));
  } else {
    legacyCopy(url);
  }
  toast('OBS-URL kopiert', 'success');
}
function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch (_) {}
  document.body.removeChild(ta);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Settings
// ═══════════════════════════════════════════════════════════════════════════

async function loadSettings() {
  settings = await safeJson('/api/settings');
  hotkeys  = settings.hotkeys || hotkeys;
}

async function saveSetting(path, value) {
  const patch = setPath({}, path, value);
  settings = await safeJson('/api/settings', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  pulseSyncDot();
}

function pulseSyncDot() {
  const dot = document.getElementById('preview-sync-dot');
  if (!dot) return;
  dot.classList.remove('pulse');
  // Force reflow so re-adding the class restarts the animation
  void dot.offsetWidth;
  dot.classList.add('pulse');
  clearTimeout(pulseTimer);
  pulseTimer = setTimeout(() => dot.classList.remove('pulse'), 600);
}

function saveSettingDebounced(path, value, delay = 160) {
  setPath(settings, path, value);
  const key = String(path);
  const prev = saveDebounceTimers.get(key);
  if (prev) clearTimeout(prev);
  const t = setTimeout(() => {
    saveSetting(path, value);
    saveDebounceTimers.delete(key);
  }, delay);
  saveDebounceTimers.set(key, t);
}

async function saveColor(key, value) {
  await saveSetting(`overlay.colors.${key}`, value);
}

function applySettingsToForm() {
  const ov = settings.overlay || {};
  const hk = settings.hotkeys || {};
  const ob = settings.obs || {};

  setVal('s-width',      ov.width ?? 280);
  setVal('s-font',       ov.timerFontSize ?? 36);
  setVal('s-scale',      Math.round((ov.uiScale ?? 1) * 100));
  setVal('s-opacity',    Math.round((ov.opacity ?? 0.92) * 100));
  setVal('s-maxsplits',  ov.maxVisibleSplits ?? 10);
  setVal('s-timerpos',   ov.timerPosition ?? 'bottom');
  setVal('s-comparison', ov.showComparison ?? 'pb');
  setVal('s-customcss',  ov.customCSS ?? '');

  document.getElementById('s-width-val').textContent   = (ov.width ?? 280) + 'px';
  document.getElementById('s-font-val').textContent    = (ov.timerFontSize ?? 36) + 'px';
  document.getElementById('s-scale-val').textContent   = Math.round((ov.uiScale ?? 1) * 100) + '%';
  document.getElementById('s-opacity-val').textContent = Math.round((ov.opacity ?? 0.92) * 100) + '%';

  document.getElementById('s-showgold').checked     = ov.showGoldSplits ?? true;
  document.getElementById('s-showattempts').checked = ov.showAttempts   ?? true;
  document.getElementById('s-showsob').checked      = ov.showSobRow     ?? true;
  document.getElementById('s-simplemode').checked   = ov.simpleTimerMode ?? false;

  const c = ov.colors || {};
  const _colorDefaults = { background:'#0f0f14', timerText:'#ffffff', splitText:'#e8e8e8', mutedText:'#888888', ahead:'#4fc97a', behind:'#e05555', gold:'#f0c040', accent:'#7c6ef0' };
  const _alphaDefaults = { background: 92 };
  Object.keys(_colorDefaults).forEach(k => {
    const v = c[k] || '';
    const hexEl   = document.getElementById('c-'   + k);
    const alphaEl = document.getElementById('ca-'  + k);
    const valEl   = document.getElementById('cav-' + k);
    if (hexEl)   hexEl.value   = (v ? cssToHex(v) : null) || _colorDefaults[k];
    const alpha = v ? cssToAlpha(v) : (_alphaDefaults[k] ?? 100);
    if (alphaEl) alphaEl.value = alpha;
    if (valEl)   valEl.textContent = alpha + '%';
  });
  setVal('s-height', ov.height || 0);
  document.getElementById('s-height-val').textContent = ov.height ? (ov.height + 'px') : 'Auto';

  Object.entries(hk).forEach(([k, v]) => {
    const btn = document.getElementById('hk-' + k);
    if (btn) btn.textContent = v;
  });

  const _obs = id => document.getElementById(id);
  if (_obs('obs-enabled'))   _obs('obs-enabled').checked   = ob.enabled   || false;
  if (_obs('obs-address'))   _obs('obs-address').value     = ob.address   || 'ws://localhost:4455';
  if (_obs('obs-password'))  _obs('obs-password').value    = ob.password  || '';
  if (_obs('obs-autostart')) _obs('obs-autostart').checked = ob.autoStart || false;

  setTheme(ov.theme || 'dark');
  updateSimpleModeUiState(ov.simpleTimerMode ?? false);
  syncAppearancePreview();
}

// ═══════════════════════════════════════════════════════════════════════════
//  Themes
// ═══════════════════════════════════════════════════════════════════════════

const THEMES = {
  dark:     { background: 'rgba(15,15,20,0.92)', timerText: '#ffffff', splitText: '#e8e8e8', mutedText: '#888888', ahead: '#4fc97a', behind: '#e05555', gold: '#f0c040', accent: '#7c6ef0' },
  midnight: { background: 'rgba(8,6,30,0.95)',   timerText: '#d0ccf8', splitText: '#c8c4f0', mutedText: '#5858a0', ahead: '#74c6f5', behind: '#f07070', gold: '#ffd060', accent: '#9d7ef0' },
  clean:    { background: 'rgba(255,255,255,0.96)',timerText:'#111111', splitText: '#333333', mutedText: '#999999', ahead: '#1e9e55', behind: '#c03030', gold: '#b08000', accent: '#5040c0' },
  neon:     { background: 'rgba(4,8,20,0.97)',   timerText: '#00ffcc', splitText: '#00ddaa', mutedText: '#007755', ahead: '#00ff88', behind: '#ff3366', gold: '#ffcc00', accent: '#7755ff' },
};

function initThemeChips() {
  document.querySelectorAll('.theme-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      setTheme(chip.dataset.theme);
      saveSetting('overlay.theme', chip.dataset.theme);
    });
  });
}

function setTheme(name) {
  document.querySelectorAll('.theme-chip').forEach(c => c.classList.toggle('active', c.dataset.theme === name));
  const colorCard = document.getElementById('color-card');
  colorCard.classList.toggle('theme-locked', name !== 'custom');
  // Legacy inline styles cleared for backward-compat safety
  colorCard.style.opacity = '';
  colorCard.style.pointerEvents = '';
  settings.overlay = settings.overlay || {};
  settings.overlay.theme = name;
  if (name !== 'custom' && THEMES[name]) {
    Object.entries(THEMES[name]).forEach(([k, v]) => {
      const el = document.getElementById('c-' + k);
      if (el && el.type === 'color') el.value = cssToHex(v) || '#000000';
    });
  }
  syncAppearancePreview();
}

function initAppearanceDesigner() {
  const transToggle = document.getElementById('s-stage-transparent');
  const savedTrans = settings.overlay?.transparentBackground ?? false;
  if (transToggle) { transToggle.checked = savedTrans; togglePreviewTransparency(savedTrans); }
  currentZoom = 130;
  setAppearanceZoom(130);
  syncAppearancePreview();
}

function dismissAppearanceGuide() {
  localStorage.setItem('splitflow.appearanceGuideDismissed', '1');
  const guide = document.getElementById('appearance-onboarding');
  if (guide) guide.style.display = 'none';
}

function applyAppearancePreset(mode) {
  const presets = {
    compact:  { width: 250, timerFontSize: 30, maxVisibleSplits: 14, uiScale: 1.00, opacity: 0.88 },
    balanced: { width: 280, timerFontSize: 36, maxVisibleSplits: 10, uiScale: 1.00, opacity: 0.92 },
    focus:    { width: 320, timerFontSize: 44, maxVisibleSplits: 8,  uiScale: 1.15, opacity: 0.95 },
  };
  const p = presets[mode] || presets.balanced;
  setVal('s-width', p.width);
  setVal('s-font', p.timerFontSize);
  setVal('s-scale', Math.round((p.uiScale ?? 1) * 100));
  setVal('s-maxsplits', p.maxVisibleSplits);
  setVal('s-opacity', Math.round(p.opacity * 100));
  document.getElementById('s-width-val').textContent = p.width + 'px';
  document.getElementById('s-font-val').textContent = p.timerFontSize + 'px';
  document.getElementById('s-scale-val').textContent = Math.round((p.uiScale ?? 1) * 100) + '%';
  document.getElementById('s-opacity-val').textContent = Math.round(p.opacity * 100) + '%';
  saveSettingDebounced('overlay.width', p.width, 80);
  saveSettingDebounced('overlay.timerFontSize', p.timerFontSize, 80);
  saveSettingDebounced('overlay.uiScale', p.uiScale ?? 1, 80);
  saveSettingDebounced('overlay.maxVisibleSplits', p.maxVisibleSplits, 80);
  saveSettingDebounced('overlay.opacity', p.opacity, 80);
  syncAppearancePreview();
  toast('Preset angewendet: ' + mode, 'success');
}

function syncAppearancePreview() {
  const width = +(document.getElementById('s-width')?.value || settings.overlay?.width || 280);
  const manualHeight = +(settings.overlay?.height || 0);
  const maxSplits = +(document.getElementById('s-maxsplits')?.value || settings.overlay?.maxVisibleSplits || 10);
  const uiScale = +(document.getElementById('s-scale')?.value || Math.round((settings.overlay?.uiScale ?? 1) * 100)) / 100;
  const simpleMode = !!(document.getElementById('s-simplemode')?.checked ?? settings.overlay?.simpleTimerMode);
  const viewport = document.getElementById('appearance-viewport');
  const frame = document.getElementById('appearance-preview');
  const dim = document.getElementById('appearance-dim');
  if (!viewport || !frame || !dim) return;
  const scaledWidth = Math.round(width * uiScale);
  const autoH = Math.max(simpleMode ? 100 : 260, Math.round((simpleMode ? 120 : 170 + maxSplits * 26) * uiScale));
  const height = manualHeight > 0 ? Math.round(manualHeight * uiScale) : autoH;
  viewport.style.width = scaledWidth + 'px';
  frame.style.height = height + 'px';
  dim.textContent = `${scaledWidth} x ${height}`;
  adjustCanvasHeight();
}

function handleSimpleModeToggle(enabled) {
  saveSettingDebounced('overlay.simpleTimerMode', enabled, 80);
  updateSimpleModeUiState(enabled);
  syncAppearancePreview();
}

function updateSimpleModeUiState(enabled) {
  const ids = ['s-maxsplits', 's-comparison', 's-showgold', 's-showattempts', 's-showsob'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !!enabled;
  });
  ['tg-showgold', 'tg-showattempts', 'tg-showsob'].forEach(id => {
    const row = document.getElementById(id);
    if (row) row.classList.toggle('disabled', !!enabled);
  });
  const note = document.getElementById('simplemode-note');
  if (note) note.style.display = enabled ? '' : 'none';
}

let currentZoom = 100;

function adjustCanvasHeight() {
  const viewport = document.getElementById('appearance-viewport');
  const canvas   = document.getElementById('appearance-canvas');
  if (!viewport || !canvas) return;
  // transform:scale keeps the element's layout box unchanged; we need to grow
  // the canvas explicitly so the scaled content is never clipped by the parent.
  const scaledH = viewport.offsetHeight * (currentZoom / 100);
  canvas.style.minHeight = Math.ceil(scaledH + 40) + 'px';
}

function setAppearanceZoom(percent) {
  currentZoom = Math.max(60, Math.min(130, +percent || 100));
  const viewport = document.getElementById('appearance-viewport');
  const label = document.getElementById('s-preview-zoom-val');
  if (viewport) {
    viewport.style.transform = `scale(${currentZoom / 100})`;
    viewport.style.transformOrigin = 'center center';
    adjustCanvasHeight();
  }
  if (label) label.textContent = `${currentZoom}%`;
}

function setAppearanceScene(name) {
  const canvas = document.getElementById('appearance-canvas');
  if (!canvas) return;
  canvas.className = 'preview-canvas scene-' + name;
  document.querySelectorAll('.scene-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.scene === name));
}

function togglePreviewTransparency(enabled) {
  saveSettingDebounced('overlay.transparentBackground', enabled, 80);
  const viewport = document.getElementById('appearance-viewport');
  if (!viewport) return;
  // Checkerboard to visualise a transparent overlay in the preview
  viewport.style.background = enabled
    ? 'repeating-conic-gradient(#2a2a2a 0% 25%, #3e3e3e 0% 50%) 0 0 / 14px 14px'
    : 'rgba(0,0,0,0.45)';
  viewport.style.borderColor = enabled ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.16)';
}

function reloadAppearancePreview() {
  document.getElementById('appearance-preview')?.contentWindow?.location.reload();
}

function openOverlayInBrowser() {
  window.open(OVERLAY_BASE + '/splitflow', '_blank');
}

function applyThemePaletteToCustom() {
  const active = document.querySelector('.theme-chip.active')?.dataset.theme;
  if (!active || active === 'custom' || !THEMES[active]) {
    toast('Wähle zuerst ein Preset-Theme', 'error');
    return;
  }
  Object.entries(THEMES[active]).forEach(([k, v]) => {
    const el = document.getElementById('c-' + k);
    if (el && el.type === 'color') el.value = cssToHex(v) || '#000000';
  });
  saveSetting('overlay.theme', 'custom');
  setTheme('custom');
  const colors = {
    background: document.getElementById('c-background').value,
    timerText: document.getElementById('c-timerText').value,
    splitText: document.getElementById('c-splitText').value,
    mutedText: document.getElementById('c-mutedText').value,
    ahead: document.getElementById('c-ahead').value,
    behind: document.getElementById('c-behind').value,
    gold: document.getElementById('c-gold').value,
    accent: document.getElementById('c-accent').value,
  };
  saveSetting('overlay.colors', colors);
  toast('Preset als Custom-Palette geladen', 'success');
}

function resetAppearanceDefaults() {
  const defaults = {
    theme: 'dark',
    width: 280,
    height: 500,
    timerFontSize: 36,
    uiScale: 1,
    opacity: 0.92,
    maxVisibleSplits: 10,
    timerPosition: 'bottom',
    showComparison: 'pb',
    showGoldSplits: true,
    showAttempts: true,
    showSobRow: true,
    simpleTimerMode: false,
    customCSS: '',
  };
  Object.entries(defaults).forEach(([k, v]) => saveSettingDebounced(`overlay.${k}`, v, 60));
  settings.overlay = { ...(settings.overlay || {}), ...defaults };
  applySettingsToForm();
  const transToggle = document.getElementById('s-stage-transparent');
  if (transToggle) { transToggle.checked = false; togglePreviewTransparency(false); }
  toast('Appearance auf Standardwerte zurückgesetzt', 'success');
}

// ═══════════════════════════════════════════════════════════════════════════
//  Hotkeys
// ═══════════════════════════════════════════════════════════════════════════

function setHkStatus(text, active) {
  const dot  = document.getElementById('hk-status-dot');
  const label = document.getElementById('hk-status-text');
  if (dot)  { dot.style.background = active ? 'var(--acc2)' : 'var(--line3)'; dot.style.boxShadow = active ? '0 0 6px var(--acc)' : 'none'; }
  if (label) label.textContent = text;
}

function captureHotkey(key, btn) {
  if (captureTarget) {
    captureTarget.classList.remove('capture');
    captureTarget.textContent = hotkeys[captureTarget.dataset.key] || '—';
  }
  captureTarget = btn;
  btn.dataset.key = key;
  btn.classList.add('capture');
  btn.textContent = 'Taste drücken…';
  setHkStatus('Warte auf Taste — Escape zum Abbrechen', true);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && captureTarget) {
    captureTarget.textContent = hotkeys[captureTarget.dataset.key] || '—';
    captureTarget.classList.remove('capture');
    captureTarget = null;
    setHkStatus('Abgebrochen — klicke einen Button', false);
    return;
  }
  if (!captureTarget) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      const splitsPanel = document.getElementById('panel-splits');
      if (splitsPanel?.classList.contains('active')) {
        e.preventDefault();
        saveProfile();
      }
    }
    return;
  }
  e.preventDefault();
  const name = keyEventToName(e);
  if (!name) return;
  const key = captureTarget.dataset.key;
  hotkeys[key] = name;
  captureTarget.textContent = name;
  captureTarget.classList.remove('capture');
  captureTarget = null;
  setHkStatus(`"${name}" zugewiesen — vergiss nicht zu speichern`, false);
});

function keyEventToName(e) {
  if (e.location === 3) return `Numpad${e.code.replace('Numpad', '')}`;
  if (e.code.startsWith('F') && !isNaN(e.code.slice(1))) return e.code;
  if (e.code === 'Space') return 'Space';
  return null;
}

async function saveHotkeys() {
  const vals = Object.values(hotkeys).filter(Boolean);
  const dupes = vals.filter((v, i) => vals.indexOf(v) !== i);
  // Highlight conflicting buttons
  for (const [k, v] of Object.entries(hotkeys)) {
    const btn = document.getElementById('hk-' + k);
    if (btn) btn.style.borderColor = (dupes.includes(v) && dupes.length) ? 'var(--behind)' : '';
  }
  if (dupes.length > 0) {
    toast(`Konflikt: Taste "${dupes[0]}" ist mehrfach vergeben — bitte korrigieren`, 'error');
    return;
  }
  await saveSetting('hotkeys', { ...hotkeys });
  toast('Hotkeys gespeichert', 'success');
  updateNavStatus();
}

function resetHotkeys() {
  hotkeys = { startSplit: 'Numpad1', pause: 'Numpad2', reset: 'Numpad3', undo: 'Numpad4', skip: 'Numpad5' };
  for (const [k, v] of Object.entries(hotkeys)) {
    const btn = document.getElementById('hk-' + k);
    if (btn) btn.textContent = v;
  }
  saveHotkeys();
}

// ═══════════════════════════════════════════════════════════════════════════
//  OBS
// ═══════════════════════════════════════════════════════════════════════════

function getObsConfig() {
  return {
    enabled:   document.getElementById('obs-enabled')?.checked   || false,
    address:   document.getElementById('obs-address')?.value     || 'ws://localhost:4455',
    password:  document.getElementById('obs-password')?.value    || '',
    autoStart: document.getElementById('obs-autostart')?.checked || false,
  };
}

function copyUrl() {
  navigator.clipboard.writeText(OVERLAY_BASE + '/splitflow');
  toast('URL kopiert', 'success');
}

function copyObsSize(splits, w, h) {
  navigator.clipboard.writeText(`${w}x${h}`);
  toast(`${splits} Splits: ${w} × ${h} px kopiert`, 'success');
}

// ═══════════════════════════════════════════════════════════════════════════
//  Utilities
// ═══════════════════════════════════════════════════════════════════════════

function fmtTime(secs, showMs = true) {
  if (!secs) return showMs ? '0:00:00.000' : '0:00:00';
  const h  = Math.floor(secs / 3600);
  const m  = Math.floor((secs % 3600) / 60);
  const s  = Math.floor(secs % 60);
  const ms = Math.floor((secs % 1) * 1000);
  const hms = `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return showMs ? `${hms}.${String(ms).padStart(3,'0')}` : hms;
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  keys.slice(0,-1).forEach(k => { cur[k] = cur[k] || {}; cur = cur[k]; });
  cur[keys.at(-1)] = value;
  return obj;
}

function setVal(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function slugify(str) { return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g,''); }

function hexFromCss(val) {
  if (/^#[0-9a-f]{6}/i.test(val)) return val.slice(0,7);
  return null;
}

function cssToHex(val) {
  if (!val) return null;
  const hex = hexFromCss(val);
  if (hex) return hex;
  const m = String(val).match(/^rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map(n => Math.max(0, Math.min(255, +n)));
  return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
}

function cssToAlpha(val) {
  if (!val) return 100;
  const m = String(val).match(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/i);
  return m ? Math.round(parseFloat(m[1]) * 100) : 100;
}

function saveColorWithAlpha(key) {
  const colorEl = document.getElementById('c-' + key);
  const alphaEl = document.getElementById('ca-' + key);
  if (!colorEl) return;
  const hex = colorEl.value;
  const alpha = alphaEl ? +alphaEl.value / 100 : 1;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const val = alpha < 1 ? `rgba(${r},${g},${b},${alpha.toFixed(2)})` : `rgb(${r},${g},${b})`;
  saveColor(key, val);
  syncAppearancePreview();
}

function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = 'visible ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 2800);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Init
// ═══════════════════════════════════════════════════════════════════════════

i18n.ready().then(boot);

