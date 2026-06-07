// ── State ──────────────────────────────────────────────────────────────
let cfg            = {};
let state          = {};
let obsSources     = [];
let namedPlaylists = [];
let loopModes      = ['all', 'single', 'none'];
let loopLabels     = ['↻ All', '↻ 1x', '→ Stop'];
let currentLoop    = 0;
let dragSrc        = null;
let lastPlaylistHash = '';
let searchQuery    = '';

// ── Helpers ────────────────────────────────────────────────────────────
function log(id, msg) { const el = document.getElementById(id); if (el) el.textContent = msg; }

function fmt(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fmtDur(sec) {
  if (!sec || sec <= 0) return '';
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
}

function fmtTotal(sec) {
  if (!sec || sec <= 0) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? ` · ${h}h ${m}m` : ` · ${m}m`;
}

// ── Rendering ──────────────────────────────────────────────────────────
function renderStatus(s) {
  if (!s) return;
  state = s;
  const track = s.currentTrack || {};
  const p     = s.player || {};

  // Now Playing
  document.getElementById('np-title').textContent  = track.title  || '—';
  document.getElementById('np-artist').textContent = track.artist || '';

  const artEl  = document.getElementById('np-art');
  const trackId = p.currentTrackId;
  if (trackId) {
    const imgSrc = `/api/trackpulse/cover/${trackId}`;
    // Avoid flickering: only swap the img if the track changed
    if (!artEl.querySelector('img') || artEl.dataset.trackId !== trackId) {
      artEl.dataset.trackId = trackId;
      artEl.innerHTML = `<img src="${imgSrc}" alt="cover" onerror="this.parentNode.textContent='♪'">`;
    }
  } else if (!trackId && artEl.dataset.trackId) {
    delete artEl.dataset.trackId;
    artEl.textContent = '♪';
  }

  const dur = p.mediaDuration || 0;
  const cur = p.mediaCursor   || 0;
  document.getElementById('np-progress').style.width =
    dur > 0 ? `${Math.min(100, (cur / dur) * 100).toFixed(1)}%` : '0%';
  document.getElementById('np-time').textContent = `${fmt(cur)} / ${fmt(dur)}`;

  const stateLabel = { playing: '▶ Playing', paused: '⏸ Paused', stopped: '⏹ Stopped' }[p.state] || '—';
  document.getElementById('np-label').textContent = stateLabel;
  const badge = document.getElementById('player-state-badge');
  badge.textContent = stateLabel;
  badge.className = 'badge ' + (p.state === 'playing' ? 'ok' : p.state === 'paused' ? 'warn' : 'neutral');

  const lmIdx = loopModes.indexOf(p.loopMode || 'all');
  currentLoop = lmIdx >= 0 ? lmIdx : 0;
  const loopBtn = document.getElementById('loop-btn');
  loopBtn.textContent = loopLabels[currentLoop];
  loopBtn.classList.toggle('active', currentLoop !== 0);

  document.getElementById('shuffle-btn').classList.toggle('active', !!p.shuffle);

  renderPlaylist(s.playlist || [], s.totalDuration || 0);
}

function renderPlaylist(list, totalDuration) {
  const countBadge = document.getElementById('pl-count');
  countBadge.textContent = t('tunapilot.tracks', { count: list.length }) + fmtTotal(totalDuration);

  // Skip full DOM rebuild when only playback progress changed
  const hash = list.map(item => `${item.id}:${item.isCurrent ? 1 : 0}`).join(',');
  if (hash === lastPlaylistHash) return;
  lastPlaylistHash = hash;

  const host = document.getElementById('playlist');

  if (!list.length) {
    host.innerHTML = '<div class="pl-empty">' + t('tunapilot.empty_playlist') + '</div>';
    return;
  }

  host.innerHTML = list.map(item => `
    <div class="pl-item ${item.isCurrent ? 'current' : ''}" draggable="true" data-idx="${item.index}" data-id="${esc(item.id)}">
      <span class="pl-drag-handle" title="Ziehen zum Sortieren">⠿</span>
      <div class="pl-art">
        <img src="/api/trackpulse/cover/${esc(item.id)}" alt="" loading="lazy" onerror="this.style.display='none'">
      </div>
      <div class="pl-info">
        <div class="pl-title">${esc((item.artist ? item.artist + ' — ' : '') + (item.title || '?'))}</div>
        <div class="pl-meta">${esc(item.album || '')}${item.duration ? `<span class="pl-dur">${fmtDur(item.duration)}</span>` : ''}</div>
      </div>
      <div class="pl-actions">
        <button class="btn xs" data-play-next="${esc(item.id)}" title="Als Nächstes">⤵</button>
        <button class="btn xs primary" data-play-idx="${item.index}" title="Jetzt spielen">▶</button>
        <button class="btn xs danger"  data-del-id="${esc(item.id)}"  title="Entfernen">✕</button>
      </div>
    </div>
  `).join('');

  host.querySelectorAll('[data-play-idx]').forEach(b =>
    b.addEventListener('click', () => playerAction('play', { index: Number(b.dataset.playIdx) }))
  );
  host.querySelectorAll('[data-del-id]').forEach(b =>
    b.addEventListener('click', () => deleteTrack(b.dataset.delId))
  );
  host.querySelectorAll('[data-play-next]').forEach(b =>
    b.addEventListener('click', () => moveToNext(b.dataset.playNext))
  );

  // Drag-to-reorder
  host.querySelectorAll('.pl-item').forEach(item => {
    item.addEventListener('dragstart', e => {
      dragSrc = Number(item.dataset.idx);
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      host.querySelectorAll('.pl-item').forEach(i => i.classList.remove('drag-over'));
      item.classList.add('drag-over');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', async e => {
      e.preventDefault();
      item.classList.remove('drag-over');
      const to = Number(item.dataset.idx);
      if (dragSrc !== null && dragSrc !== to) await reorderTrack(dragSrc, to);
      dragSrc = null;
    });
    item.addEventListener('dragend', () => {
      host.querySelectorAll('.pl-item').forEach(i => i.classList.remove('drag-over'));
      dragSrc = null;
    });
  });

  applySearch();
}

function applySearch() {
  const q = searchQuery;
  document.querySelectorAll('#playlist .pl-item').forEach(item => {
    if (!q) { item.hidden = false; return; }
    const text = (item.querySelector('.pl-title')?.textContent || '').toLowerCase();
    item.hidden = !text.includes(q);
  });
}

function renderNamedPlaylists() {
  const host = document.getElementById('named-list');
  if (!namedPlaylists.length) {
    host.innerHTML = '<div style="font-size:12px;color:var(--text-s)">' + t('tunapilot.no_named_playlists') + '</div>';
    return;
  }
  host.innerHTML = namedPlaylists.map(p => `
    <div class="named-item">
      <span class="named-item-name">${esc(p.name)}</span>
      <span class="named-item-count">${(p.tracks || []).length} Tracks</span>
      <button class="btn xs primary" data-load-pl="${esc(p.id)}" title="Laden">▶</button>
      <button class="btn xs danger"  data-del-pl="${esc(p.id)}"  title="Löschen">✕</button>
    </div>
  `).join('');

  host.querySelectorAll('[data-load-pl]').forEach(b =>
    b.addEventListener('click', () => loadNamedPlaylist(b.dataset.loadPl))
  );
  host.querySelectorAll('[data-del-pl]').forEach(b =>
    b.addEventListener('click', () => deleteNamedPlaylist(b.dataset.delPl))
  );
}

function renderObsSources() {
  const sel      = document.getElementById('obs-source');
  const selected = (cfg?.obsPlayer?.sourceName || '').trim();
  sel.innerHTML  = '<option value="">-- Quelle wählen --</option>';
  obsSources.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.name;
    opt.textContent = s.label || s.name;
    opt.dataset.kind = s.kind || 'ffmpeg_source';
    sel.appendChild(opt);
  });
  sel.value = selected;
}

// ── Player actions ─────────────────────────────────────────────────────
async function playerAction(name, body = null) {
  try {
    await saveConfig();
    const resp = await safeJson(`/api/trackpulse/player/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (resp.status) renderStatus(resp.status);
  } catch (e) {
    log('pl-log', '❌ ' + e.message);
  }
  await refresh();
}

async function deleteTrack(id) {
  try {
    await safeJson(`/api/trackpulse/playlist/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) { log('pl-log', '❌ ' + e.message); }
  await refresh();
}

async function moveToNext(id) {
  try {
    await safeJson('/api/trackpulse/playlist/play-next', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
  } catch (e) { log('pl-log', '❌ ' + e.message); }
  await refresh();
}

async function reorderTrack(from, to) {
  try {
    const r = await safeJson('/api/trackpulse/playlist/reorder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to }),
    });
    if (r.status) renderStatus(r.status);
  } catch (e) { log('pl-log', '❌ ' + e.message); }
  await refresh();
}

async function cycleLoop() {
  currentLoop = (currentLoop + 1) % loopModes.length;
  cfg = await safeJson('/api/trackpulse/config', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player: { ...(cfg.player || {}), loopMode: loopModes[currentLoop] } }),
  });
  await refresh();
}

async function toggleShuffle() {
  const shuffle = !(cfg?.player?.shuffle);
  cfg = await safeJson('/api/trackpulse/config', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player: { ...(cfg.player || {}), shuffle } }),
  });
  await refresh();
}

// ── Config ─────────────────────────────────────────────────────────────
function selectedObsKind() {
  const sel = document.getElementById('obs-source');
  return sel?.options[sel.selectedIndex]?.dataset?.kind || 'ffmpeg_source';
}

async function saveConfig() {
  const source     = document.getElementById('obs-source')?.value || '';
  const outputPath = document.getElementById('output-path')?.value?.trim() || '';
  const format     = document.getElementById('format')?.value || '{artist} - {title}';
  cfg = await safeJson('/api/trackpulse/config', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      enabled: true, outputPath, format,
      obsPlayer: { ...(cfg?.obsPlayer || {}), enabled: true, sourceName: source, sourceKind: selectedObsKind() },
    }),
  });
}

async function loadConfig() {
  cfg = await safeJson('/api/trackpulse/config');
  const outputPath = document.getElementById('output-path');
  const format     = document.getElementById('format');
  const volSlider  = document.getElementById('vol-slider');
  if (outputPath) outputPath.value = cfg.outputPath || '';
  if (format)     format.value     = cfg.format || '{artist} - {title}';
  if (volSlider)  volSlider.value  = cfg.player?.volume ?? 100;
  document.getElementById('vol-val').textContent = `${cfg.player?.volume ?? 100}%`;

  const lm = cfg?.player?.loopMode || 'all';
  currentLoop = loopModes.indexOf(lm);
  if (currentLoop < 0) currentLoop = 0;
  document.getElementById('loop-btn').textContent = loopLabels[currentLoop];
  populateOverlayForm(cfg.overlay || {});
}

// ── Track import ────────────────────────────────────────────────────────
async function addTracks() {
  log('pl-log', 'Dateien werden ausgewählt…');
  try {
    const res = await safeJson('/api/electron/pick-files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!res.ok || !res.paths?.length) { log('pl-log', 'Abgebrochen'); return; }
    log('pl-log', `${res.paths.length} Tracks werden importiert…`);
    await saveConfig();
    await safeJson('/api/trackpulse/playlist/add-many', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: res.paths }),
    });
    log('pl-log', t('tunapilot.track_added', { count: res.paths.length }));
  } catch (e) { log('pl-log', '❌ ' + e.message); }
  await refresh();
}

async function addFolder() {
  log('pl-log', 'Ordner wird ausgewählt…');
  try {
    const res = await safeJson('/api/electron/pick-folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!res.ok || !res.folder) { log('pl-log', 'Abgebrochen'); return; }
    log('pl-log', 'Ordner wird gescannt…');
    await saveConfig();
    const out = await safeJson('/api/trackpulse/playlist/add-folder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: res.folder }),
    });
    log('pl-log', t('tunapilot.track_added', { count: out.added?.length ?? 0 }));
  } catch (e) { log('pl-log', '❌ ' + e.message); }
  await refresh();
}

async function clearPlaylist() {
  try {
    await safeJson('/api/trackpulse/playlist/clear', { method: 'POST' });
  } catch (e) { log('pl-log', '❌ ' + e.message); }
  await refresh();
}

// ── M3U ─────────────────────────────────────────────────────────────────
async function importM3U(file) {
  const text = await file.text();
  try {
    const r = await safeJson('/api/trackpulse/playlist/import-m3u', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
    });
    log('pl-log', t('tunapilot.m3u_imported', { count: r.added }));
  } catch (e) { log('pl-log', '❌ M3U: ' + e.message); }
  await refresh();
}

// ── OBS sources ─────────────────────────────────────────────────────────
async function loadObsSources() {
  try {
    const out = await safeJson('/api/trackpulse/obs/sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    obsSources = out.sources || [];
    renderObsSources();
    log('integration-log', `OBS Quellen: ${obsSources.length}`);
  } catch (e) { log('integration-log', '❌ ' + e.message); }
}

// ── Named playlists ─────────────────────────────────────────────────────
async function saveNamedPlaylist() {
  const name = document.getElementById('new-pl-name').value.trim();
  if (!name) return;
  const id = `pl-${Date.now().toString(36)}`;
  try {
    const r = await safeJson('/api/trackpulse/named-playlists', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name, tracks: state.playlist || [] }),
    });
    namedPlaylists = r.namedPlaylists || [];
    renderNamedPlaylists();
    document.getElementById('new-pl-name').value = '';
    log('integration-log', t('tunapilot.playlist_saved', { name }));
  } catch (e) { log('integration-log', '❌ ' + e.message); }
}

async function loadNamedPlaylist(id) {
  const pl = namedPlaylists.find(p => p.id === id);
  if (!pl) return;
  try {
    await safeJson('/api/trackpulse/playlist/clear', { method: 'POST' });
    await safeJson('/api/trackpulse/playlist/add-many', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: (pl.tracks || []).map(tr => tr.path) }),
    });
    log('integration-log', t('tunapilot.playlist_loaded', { name: pl.name }));
  } catch (e) { log('integration-log', '❌ ' + e.message); }
  await refresh();
}

async function deleteNamedPlaylist(id) {
  try {
    const r = await safeJson(`/api/trackpulse/named-playlists/${encodeURIComponent(id)}`, { method: 'DELETE' });
    namedPlaylists = r.namedPlaylists || [];
    renderNamedPlaylists();
  } catch (e) { log('integration-log', '❌ ' + e.message); }
}

// ── Volume ──────────────────────────────────────────────────────────────
let volTimer = null;
function onVolumeChange(v) {
  document.getElementById('vol-val').textContent = `${v}%`;
  clearTimeout(volTimer);
  volTimer = setTimeout(async () => {
    try {
      await safeJson('/api/trackpulse/player/volume', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volume: Number(v) }),
      });
    } catch { /* non-fatal */ }
  }, 200);
}

// ── OBS status ──────────────────────────────────────────────────────────
async function pollObs() {
  const s = await safeJson('/api/scenepilot/status').catch(() => ({}));
  const pill = document.getElementById('obs-pill');
  if (s.connected) {
    pill.textContent = 'OBS verbunden';
    pill.className   = 'badge ok';
  } else {
    pill.textContent = t('tunapilot.obs_disconnected');
    pill.className   = 'badge warn';
  }
}

// ── Refresh ──────────────────────────────────────────────────────────────
async function refresh() {
  const s = await safeJson('/api/trackpulse/status').catch(() => ({}));
  renderStatus(s);
}

// ── WebSocket ────────────────────────────────────────────────────────────
const wsClient = createWsClient({
  onMessage(msg) {
    if (msg.type === 'TRACKPULSE_STATUS' && msg.payload) renderStatus(msg.payload);
  },
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === ' ') {
    e.preventDefault();
    const p = state.player;
    if      (p?.state === 'playing') playerAction('pause');
    else if (p?.state === 'paused')  playerAction('resume');
    else                              playerAction('play');
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    playerAction('next');
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    playerAction('prev');
  }
});

// ── Init ──────────────────────────────────────────────────────────────────
async function boot() {
  try { await safeJson('/api/tools/trackpulse/start', { method: 'POST' }); } catch {}
  await loadConfig();
  await pollObs();
  await loadObsSources();
  await refresh();

  const np = await safeJson('/api/trackpulse/named-playlists').catch(() => ({}));
  namedPlaylists = np.namedPlaylists || [];
  renderNamedPlaylists();

  wsClient.start();
  setInterval(pollObs, 3000);
}

// ── Overlay Editor ──────────────────────────────────────────────────────────
const OV_DEFAULTS = {
  position: 'bottom-left', maxWidth: 420,
  bgColor: '#060c10', bgOpacity: 0.82,
  radius: 14, blur: 12,
  accentColor: '#02cda4', titleColor: '#f3f9f8', artistColor: '#9bbab5',
  showArt: true, artSize: 52,
  showProgress: true, progressHeight: 3,
  showTime: false, labelText: 'Now Playing',
  font: 'system', titleSize: 15, artistSize: 12,
};

function populateOverlayForm(ov) {
  const d = Object.assign({}, OV_DEFAULTS, ov || {});
  const g = id => document.getElementById(id);
  if (!g('ov-position')) return;
  g('ov-position').value        = d.position;
  g('ov-maxwidth').value        = d.maxWidth;
  g('ov-bg-color').value        = d.bgColor;
  const opPct = Math.round((d.bgOpacity ?? 0.82) * 100);
  g('ov-bg-opacity').value      = opPct;
  g('ov-bg-op-val').textContent = opPct + '%';
  g('ov-blur').value            = d.blur;
  g('ov-radius').value          = d.radius;
  g('ov-accent').value          = d.accentColor;
  g('ov-title-color').value     = d.titleColor;
  g('ov-artist-color').value    = d.artistColor;
  g('ov-show-art').checked      = d.showArt;
  g('ov-art-size').value        = d.artSize;
  g('ov-show-progress').checked = d.showProgress;
  g('ov-prog-height').value     = d.progressHeight;
  g('ov-show-time').checked     = d.showTime;
  g('ov-label-text').value      = d.labelText;
  g('ov-font').value            = d.font;
  g('ov-title-size').value      = d.titleSize;
  g('ov-artist-size').value     = d.artistSize;
}

function collectOverlayCfg() {
  const g = id => document.getElementById(id);
  return {
    position:       g('ov-position').value,
    maxWidth:       Number(g('ov-maxwidth').value),
    bgColor:        g('ov-bg-color').value,
    bgOpacity:      Number(g('ov-bg-opacity').value) / 100,
    blur:           Number(g('ov-blur').value),
    radius:         Number(g('ov-radius').value),
    accentColor:    g('ov-accent').value,
    titleColor:     g('ov-title-color').value,
    artistColor:    g('ov-artist-color').value,
    showArt:        g('ov-show-art').checked,
    artSize:        Number(g('ov-art-size').value),
    showProgress:   g('ov-show-progress').checked,
    progressHeight: Number(g('ov-prog-height').value),
    showTime:       g('ov-show-time').checked,
    labelText:      g('ov-label-text').value || 'Now Playing',
    font:           g('ov-font').value,
    titleSize:      Number(g('ov-title-size').value),
    artistSize:     Number(g('ov-artist-size').value),
  };
}

async function saveOverlay() {
  const ov = collectOverlayCfg();
  try {
    cfg = await safeJson('/api/trackpulse/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overlay: ov }),
    });
    log('integration-log', 'Overlay-Einstellungen gespeichert.');
    reloadOvPreview();
  } catch (e) { log('integration-log', '❌ ' + e.message); }
}

function reloadOvPreview() {
  const iframe = document.getElementById('ov-preview');
  if (iframe) { const s = iframe.src; iframe.src = ''; iframe.src = s; }
}

// ── Wire up controls ──────────────────────────────────────────────────────
document.getElementById('prev-btn')      .addEventListener('click', () => playerAction('prev'));
document.getElementById('play-btn')      .addEventListener('click', () => playerAction('play'));
document.getElementById('pause-btn')     .addEventListener('click', () => playerAction('pause'));
document.getElementById('resume-btn')    .addEventListener('click', () => playerAction('resume'));
document.getElementById('next-btn')      .addEventListener('click', () => playerAction('next'));
document.getElementById('stop-btn')      .addEventListener('click', () => playerAction('stop'));
document.getElementById('loop-btn')      .addEventListener('click', cycleLoop);
document.getElementById('shuffle-btn')   .addEventListener('click', toggleShuffle);
document.getElementById('add-btn')       .addEventListener('click', addTracks);
document.getElementById('add-folder-btn').addEventListener('click', addFolder);
document.getElementById('clear-btn')     .addEventListener('click', clearPlaylist);
document.getElementById('save-btn')      .addEventListener('click', async () => {
  await saveConfig(); await refresh(); log('integration-log', t('tunapilot.saved'));
});
document.getElementById('load-sources-btn').addEventListener('click', loadObsSources);
document.getElementById('save-named-btn')  .addEventListener('click', saveNamedPlaylist);
document.getElementById('vol-slider')      .addEventListener('input', e => onVolumeChange(e.target.value));

document.getElementById('pl-search').addEventListener('input', e => {
  searchQuery = e.target.value.toLowerCase().trim();
  applySearch();
});

const dropZone = document.getElementById('drop-zone');
dropZone.addEventListener('click',    () => addTracks());
dropZone.addEventListener('dragover', e  => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave',()  => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop',  async e => { e.preventDefault(); dropZone.classList.remove('dragover'); await addTracks(); });

document.getElementById('import-m3u-btn').addEventListener('click', () => document.getElementById('m3u-input').click());
document.getElementById('m3u-input').addEventListener('change', e => {
  const f = e.target.files?.[0];
  if (f) importM3U(f);
  e.target.value = '';
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => i18n.ready().then(boot).catch(e => log('integration-log', '❌ Boot: ' + e.message)));
} else {
  i18n.ready().then(boot).catch(e => log('integration-log', '❌ Boot: ' + e.message));
}
