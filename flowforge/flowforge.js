'use strict';

// ── Metadata ──────────────────────────────────────────────────────────────────

const TRIGGER_DEFS = {
  'timer.start':  { get label(){ return t('flowforge.trigger.timer_start'); },  group: 'Timer', color: 'timer',
    desc: 'Wird ausgelöst wenn der Timer aus dem Ruhezustand gestartet wird.',
    fields: [] },
  'timer.resume': { get label(){ return t('flowforge.trigger.timer_resume'); }, group: 'Timer', color: 'timer',
    desc: 'Wird ausgelöst wenn der Timer nach einer Pause fortgesetzt wird.',
    fields: [] },
  'timer.pause':  { get label(){ return t('flowforge.trigger.timer_pause'); },  group: 'Timer', color: 'timer',
    desc: 'Wird ausgelöst wenn der Timer pausiert wird.',
    fields: [] },
  'timer.reset':  { get label(){ return t('flowforge.trigger.timer_reset'); },  group: 'Timer', color: 'timer',
    desc: 'Wird ausgelöst wenn der Timer zurückgesetzt wird.',
    fields: [] },
  'timer.split':  { get label(){ return t('flowforge.trigger.timer_split'); },  group: 'Timer', color: 'timer',
    desc: 'Wird nach einem Split ausgelöst. Ohne Index bei jedem Split.',
    fields: [{ key: 'splitIndex', get label(){ return t('flowforge.split_index'); }, type: 'number', optional: true }] },
  'timer.finish': { get label(){ return t('flowforge.trigger.timer_finish'); }, group: 'Timer', color: 'timer',
    desc: 'Wird ausgelöst wenn der letzte Split abgeschlossen wird (Zieleinlauf).',
    fields: [] },
  'obs.scene':    { get label(){ return t('flowforge.trigger.obs_scene'); },    group: 'OBS',   color: 'obs',
    desc: 'Wird ausgelöst wenn OBS die aktive Szene wechselt.',
    fields: [{ key: 'scene', get label(){ return t('flowforge.scene_filter'); }, type: 'scene', optional: true }] },
  'chat.keyword': { get label(){ return t('flowforge.trigger.chat_keyword'); }, group: 'Chat',  color: 'chat',
    desc: 'Wird ausgelöst wenn eine Chat-Nachricht ein bestimmtes Stichwort enthält.',
    fields: [
      { key: 'keyword',   get label(){ return t('flowforge.keyword'); },    type: 'text' },
      { key: 'matchType', get label(){ return t('flowforge.match_type'); }, type: 'select', options: [
        { value: 'contains',   get label(){ return t('flowforge.match.contains'); } },
        { value: 'exact',      get label(){ return t('flowforge.match.exact'); } },
        { value: 'startswith', get label(){ return t('flowforge.match.startswith'); } },
      ]},
    ]},
  'hotkey':       { label: 'Hotkey (Tastenkombination)', group: 'System', color: 'timer',
    desc: 'Wird ausgelöst wenn eine bestimmte Taste gedrückt wird — systemweit, auch wenn ein Spiel im Vordergrund ist.',
    fields: [{ key: 'key', label: 'Taste', type: 'hotkey' }] },
  'obs.stream_start': { label: 'OBS: Stream gestartet', group: 'OBS', color: 'obs',
    desc: 'Wird ausgelöst wenn OBS den Livestream startet.',
    fields: [] },
  'obs.stream_stop':  { label: 'OBS: Stream beendet',   group: 'OBS', color: 'obs',
    desc: 'Wird ausgelöst wenn OBS den Livestream beendet.',
    fields: [] },
  'obs.record_start': { label: 'OBS: Aufnahme gestartet', group: 'OBS', color: 'obs',
    desc: 'Wird ausgelöst wenn OBS die Aufnahme startet.',
    fields: [] },
  'obs.record_stop':  { label: 'OBS: Aufnahme beendet',   group: 'OBS', color: 'obs',
    desc: 'Wird ausgelöst wenn OBS die Aufnahme beendet.',
    fields: [] },
  'alert.event':  { label: 'Alert-Event (Follow / Sub / Raid …)', group: 'Events', color: 'event',
    desc: 'Wird ausgelöst wenn ein EventForge-Alert eintrifft. Variablen in Aktionen: {author}, {text}, {amount}, {viewers}.',
    fields: [
      { key: 'eventType', label: 'Event-Typ', type: 'select', optional: true, options: [
        { value: 'any',         label: 'Beliebig' },
        { value: 'follower',    label: 'Follow' },
        { value: 'sub',         label: 'Sub' },
        { value: 'resub',       label: 'Resub' },
        { value: 'subgift',     label: 'Sub-Gift' },
        { value: 'raid',        label: 'Raid' },
        { value: 'bits',        label: 'Bits / Cheers' },
        { value: 'superchat',   label: 'Super Chat' },
        { value: 'membership',  label: 'Membership' },
        { value: 'donation',    label: 'Donation' },
      ]},
      { key: 'platform', label: 'Plattform', type: 'select', optional: true, options: [
        { value: 'any',     label: 'Beliebig' },
        { value: 'twitch',  label: 'Twitch' },
        { value: 'youtube', label: 'YouTube' },
      ]},
    ]},
};

const CONDITION_DEFS = {
  'split.index':     { label: 'Split-Index ist',
    fields: [{ key: 'index', label: 'Index (0 = erster Split)', type: 'number' }] },
  'split.is_pb':     { label: 'Split ist Gold (neues PB-Segment)',
    fields: [] },
  'obs.scene_is':    { label: 'OBS-Szene ist gerade',
    fields: [{ key: 'scene', label: 'Szene', type: 'scene' }] },
  'timer.state_is':  { label: 'Timer-Status ist',
    fields: [{ key: 'state', label: 'Status', type: 'select', options: [
      { value: 'running', label: 'Läuft' },
      { value: 'paused',  label: 'Pausiert' },
      { value: 'idle',    label: 'Gestoppt / Bereit' },
    ]}] },
  'alert.type_is':   { label: 'Alert-Typ ist',
    fields: [{ key: 'eventType', label: 'Event-Typ', type: 'select', options: [
      { value: 'follower',   label: 'Follow' },
      { value: 'sub',        label: 'Sub' },
      { value: 'resub',      label: 'Resub' },
      { value: 'subgift',    label: 'Sub-Gift' },
      { value: 'raid',       label: 'Raid' },
      { value: 'bits',       label: 'Bits / Cheers' },
      { value: 'superchat',  label: 'Super Chat' },
      { value: 'membership', label: 'Membership' },
      { value: 'donation',   label: 'Donation' },
    ]}] },
  'chat.platform_is': { label: 'Chat-Plattform ist',
    fields: [{ key: 'platform', label: 'Plattform', type: 'select', options: [
      { value: 'twitch',  label: 'Twitch' },
      { value: 'youtube', label: 'YouTube' },
    ]}] },
  'obs.is_streaming': { label: 'OBS streamt gerade',     fields: [] },
  'obs.is_recording': { label: 'OBS nimmt gerade auf',   fields: [] },
};

const ACTION_DEFS = {
  'obs.set_scene':         { get label(){ return t('flowforge.action.obs_set_scene'); },         group: 'OBS',         fields: [{ key: 'scene',  get label(){ return t('flowforge.target_scene'); }, type: 'scene' }] },
  'obs.source_visibility': { get label(){ return t('flowforge.action.obs_source_visibility'); }, group: 'OBS',         fields: [
    { key: 'scene',   get label(){ return 'Szene'; },     type: 'scene' },
    { key: 'source',  get label(){ return t('flowforge.source_selector'); }, type: 'source' },
    { key: 'visible', get label(){ return t('flowforge.visibility'); }, type: 'bool' },
  ]},
  'obs.start_recording':   { get label(){ return t('flowforge.action.obs_start_recording'); },   group: 'OBS',         fields: [] },
  'obs.stop_recording':    { get label(){ return t('flowforge.action.obs_stop_recording'); },    group: 'OBS',         fields: [] },
  'obs.start_streaming':   { get label(){ return t('flowforge.action.obs_start_streaming'); },   group: 'OBS',         fields: [] },
  'obs.stop_streaming':    { get label(){ return t('flowforge.action.obs_stop_streaming'); },    group: 'OBS',         fields: [] },
  'trackpulse.play_playlist': { get label(){ return t('flowforge.action.trackpulse_play'); },    group: 'TrackPulse', fields: [{ key: 'playlistId', get label(){ return t('flowforge.playlist'); }, type: 'playlist' }] },
  'trackpulse.play_next':  { label: 'Nächster Track',                group: 'TrackPulse', fields: [] },
  'trackpulse.pause':      { label: 'Musik pausieren',               group: 'TrackPulse', fields: [] },
  'trackpulse.resume':     { label: 'Musik fortsetzen',              group: 'TrackPulse', fields: [] },
  'trackpulse.set_volume': { label: 'Lautstärke setzen',             group: 'TrackPulse',
    fields: [{ key: 'volume', label: 'Lautstärke (0–100)', type: 'number' }] },
  'trackpulse.stop':       { get label(){ return t('flowforge.action.trackpulse_stop'); },       group: 'TrackPulse', fields: [] },
  'obs.mute_source':       { label: 'OBS Quelle muten',               group: 'OBS',
    fields: [{ key: 'source', label: 'Quellenname (Mikrofon o.ä.)', type: 'text' }] },
  'obs.unmute_source':     { label: 'OBS Quelle unmuten',             group: 'OBS',
    fields: [{ key: 'source', label: 'Quellenname (Mikrofon o.ä.)', type: 'text' }] },
  'obs.filter_visibility': { label: 'OBS Filter ein-/ausblenden',    group: 'OBS',
    fields: [
      { key: 'source',  label: 'Quellenname (exakt)',  type: 'text' },
      { key: 'filter',  label: 'Filtername (exakt)',   type: 'text' },
      { key: 'visible', label: 'Aktion',               type: 'bool' },
    ]},
  'obs.set_text':          { label: 'OBS Text-Quelle setzen',        group: 'OBS',
    fields: [
      { key: 'source', label: 'Text-Quellenname',                    type: 'text' },
      { key: 'text',   label: 'Text ({author} {text} {amount} …)',   type: 'text' },
    ]},
  'http.request':          { label: 'Webhook / HTTP-Request',        group: 'Sonstiges',
    fields: [
      { key: 'url',    label: 'URL (https://…)',                     type: 'text' },
      { key: 'method', label: 'Methode',  type: 'select', options: [
        { value: 'POST',   label: 'POST' },
        { value: 'GET',    label: 'GET' },
        { value: 'PUT',    label: 'PUT' },
        { value: 'PATCH',  label: 'PATCH' },
        { value: 'DELETE', label: 'DELETE' },
      ]},
      { key: 'body', label: 'Body (JSON, optional — {author} {text} …)', type: 'text', optional: true },
    ]},
  'flow.run':              { label: 'Flow ausführen (Verkettung)',    group: 'Sonstiges',
    fields: [{ key: 'flowId', label: 'Ziel-Flow', type: 'flow' }] },
  'delay':                 { get label(){ return t('flowforge.action.delay'); },                 group: 'Sonstiges',   fields: [{ key: 'ms', get label(){ return t('flowforge.duration_ms'); }, type: 'number' }] },
};

const ACTION_GROUP_CLASS = { OBS: 'act-obs', TrackPulse: 'act-tp', Sonstiges: 'act-misc', Events: 'act-misc' };

// ── State ─────────────────────────────────────────────────────────────────────

let flows           = [];
let scenes          = [];
let sourcesPerScene = {};
let playlists       = [];
let editingId       = null;
let isDirty         = false;

// ── Hotkey capture ────────────────────────────────────────────────────────────

let _hkCapturing = null; // { btn, hiddenId }

function captureFlowHotkey(btn) {
  if (_hkCapturing) {
    _hkCapturing.btn.classList.remove('capture');
    const prev = document.getElementById(_hkCapturing.hiddenId);
    _hkCapturing.btn.textContent = prev?.value || '— Taste drücken —';
  }
  _hkCapturing = { btn, hiddenId: btn.dataset.hiddenId };
  btn.classList.add('capture');
  btn.textContent = '⬤ Taste drücken…';
}

function mapFlowKey(e) {
  if (e.code.startsWith('Numpad')) return e.code;
  if (/^F\d+$/.test(e.code)) return e.code;
  if (['Space','Insert','Delete','Home','End'].includes(e.code)) return e.code;
  return null;
}

// Runs in capture phase so it fires before onGlobalKey
document.addEventListener('keydown', (e) => {
  if (!_hkCapturing) return;
  const { btn, hiddenId } = _hkCapturing;
  const hidden = document.getElementById(hiddenId);
  if (e.key === 'Escape') {
    btn.classList.remove('capture');
    btn.textContent = hidden?.value || '— Taste drücken —';
    _hkCapturing = null;
    e.stopPropagation();
    return;
  }
  const mapped = mapFlowKey(e);
  if (!mapped) return;
  e.preventDefault();
  e.stopPropagation();
  if (hidden) hidden.value = mapped;
  btn.textContent = mapped;
  btn.classList.remove('capture');
  _hkCapturing = null;
}, { capture: true });

// ── Boot ──────────────────────────────────────────────────────────────────────

async function boot() {
  await Promise.all([loadObs(), loadFlows(), loadPlaylists()]);
  document.addEventListener('keydown', onGlobalKey);
}

function onGlobalKey(e) {
  const open = !document.getElementById('modal-backdrop').classList.contains('hidden');
  if (!open) return;
  if (e.key === 'Escape')                       { closeEditor(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveFlow(); }
}

async function loadObs() {
  try {
    const s  = await safeJson('/api/scenepilot/status');
    const ok = s.connected === true;
    const badge = document.getElementById('obs-badge');
    badge.className = ok ? 'badge ok' : 'badge neutral';
    badge.innerHTML = `<span class="dot" style="opacity:${ok?'1':'.4'}"></span> ${t(ok ? 'controldeck.obs_connected' : 'flowforge.obs_disconnected')}`;
    if (ok) {
      const r = await safeJson('/api/scenepilot/scenes');
      scenes = (r || []).map(sc => sc.sceneName || sc).filter(Boolean);
      await Promise.all(scenes.map(sc => loadSourcesForScene(sc)));
    }
  } catch(_) {}
}

async function loadSourcesForScene(sceneName) {
  if (!sceneName || sourcesPerScene[sceneName]) return;
  try {
    const r = await safeJson(`/api/scenepilot/scene-items/${encodeURIComponent(sceneName)}`);
    sourcesPerScene[sceneName] = (r || []).map(i => i.sourceName).filter(Boolean);
  } catch(_) { sourcesPerScene[sceneName] = []; }
}

async function reloadObs() {
  const btn = document.getElementById('obs-reload-btn');
  btn.disabled = true;
  scenes = []; sourcesPerScene = {};
  await loadObs();
  btn.disabled = false;
  toast(scenes.length ? `${scenes.length} Szenen geladen` : t('flowforge.obs_disconnected'), scenes.length ? 'ok' : 'warn');
}

async function loadFlows() {
  try { flows = await safeJson('/api/flowforge/flows'); }
  catch(_) { flows = []; }
  renderFlows();
}

async function loadPlaylists() {
  try {
    const r = await safeJson('/api/trackpulse/named-playlists');
    playlists = r.namedPlaylists || [];
  } catch(_) { playlists = []; }
}

// ── Render flow list ──────────────────────────────────────────────────────────

function triggerGroup(type) { return TRIGGER_DEFS[type]?.color ?? 'timer'; }
function triggerLabel(type) { return TRIGGER_DEFS[type]?.label ?? type; }
function actionLabel(type)  { return ACTION_DEFS[type]?.label  ?? type; }
function actionGroupClass(type) { return ACTION_GROUP_CLASS[ACTION_DEFS[type]?.group] ?? 'act-misc'; }

function renderFlows() {
  const el = document.getElementById('flows-container');
  if (!flows.length) {
    el.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="9" y1="13" x2="15" y2="13"/>
          <line x1="9" y1="17" x2="12" y2="17"/>
        </svg>
        <h3 data-i18n="flowforge.empty.title">Noch keine Flows</h3>
        <p data-i18n="flowforge.empty.desc">Verknüpfe Timer-Events, OBS-Szenen und Chat mit Aktionen — ohne eine einzige Zeile Code.</p>
        <button class="btn primary" onclick="openEditor(null)">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 1v10M1 6h10"/></svg>
          <span data-i18n="flowforge.new_flow">Ersten Flow erstellen</span>
        </button>
      </div>`;
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'flows-grid';
  flows.forEach(f => grid.appendChild(buildFlowCard(f)));
  el.innerHTML = '';
  el.appendChild(grid);
}

function buildFlowCard(flow) {
  const card = document.createElement('article');
  card.className = 'card flow-card' + (flow.enabled === false ? ' flow-disabled' : '');
  card.id = `flow-card-${flow.id}`;

  const grp = triggerGroup(flow.trigger?.type);
  const accentClass = grp === 'obs' ? 'obs' : grp === 'chat' ? 'chat' : grp === 'event' ? 'event' : '';

  const actionPills = (flow.actions || []).slice(0, 4).map(a =>
    `<span class="flow-pill ${actionGroupClass(a.type)}">${esc(actionLabel(a.type))}</span>`
  ).join('');
  const more = (flow.actions?.length || 0) > 4
    ? `<span class="flow-pill">+${flow.actions.length - 4}</span>` : '';
  const condPill = flow.conditions?.length
    ? `<span class="flow-chain-sep">·</span><span class="flow-pill cond">${t('flowforge.conditions_count', {count: flow.conditions.length})}</span>`
    : '';

  card.innerHTML = `
    <div class="flow-card-accent ${accentClass}"></div>
    <div class="flow-card-body">
      <div class="flow-card-head">
        <input type="checkbox" class="toggle" ${flow.enabled !== false ? 'checked' : ''}
          onchange="toggleFlow('${esc(flow.id)}', this.checked)" title="Flow aktivieren/deaktivieren">
        <span class="flow-name" title="${esc(flow.name)}">${esc(flow.name)}</span>
      </div>
      <div class="flow-chain">
        <span class="flow-pill trig-${grp}">${esc(triggerLabel(flow.trigger?.type))}</span>
        ${condPill}
        <span class="flow-chain-sep">→</span>
        ${actionPills || `<span style="font-size:11px;color:var(--text-s);font-style:italic">${t('flowforge.actions')}</span>`}
        ${more}
      </div>
    </div>
    <div class="flow-card-footer">
      <button class="btn sm" onclick="openEditor('${esc(flow.id)}')">
        <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2.5l2 2L5 11H3v-2L9.5 2.5z"/></svg>
        ${t('btn.edit')}
      </button>
      <button class="btn sm danger" onclick="startDelete(this,'${esc(flow.id)}','${esc(flow.name)}')">
        <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,3 12,3"/><path d="M5 3V2h4v1M3 3l1 9h6l1-9"/></svg>
        ${t('btn.delete')}
      </button>
    </div>`;
  return card;
}

// ── Toggle ─────────────────────────────────────────────────────────────────────

async function toggleFlow(id, enabled) {
  const flow = flows.find(f => f.id === id);
  if (!flow) return;
  flow.enabled = enabled;
  document.getElementById(`flow-card-${id}`)?.classList.toggle('flow-disabled', !enabled);
  try {
    await safeJson(`/api/flowforge/flows/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(flow),
    });
  } catch { toast(t('flowforge.save_error'), 'error'); }
}

// ── Delete (inline 2-step) ────────────────────────────────────────────────────

function startDelete(btn, id, name) {
  const footer = btn.closest('.flow-card-footer');
  if (footer.querySelector('.delete-confirm')) return;
  const overlay = document.createElement('div');
  overlay.className = 'delete-confirm';
  overlay.innerHTML = `
    <span>${t('flowforge.delete_confirm', {name: esc(name)})}</span>
    <div class="delete-confirm-btns">
      <button class="btn xs" onclick="cancelDelete(this)">${t('btn.no')}</button>
      <button class="btn xs danger" onclick="doDelete('${esc(id)}')">${t('btn.yes_delete')}</button>
    </div>`;
  footer.appendChild(overlay);
  // Auto-cancel after 4s
  overlay._t = setTimeout(() => overlay.remove(), 4000);
}

function cancelDelete(btn) {
  const overlay = btn.closest('.delete-confirm');
  clearTimeout(overlay._t);
  overlay.remove();
}

async function doDelete(id) {
  try {
    await fetch(`/api/flowforge/flows/${id}`, { method: 'DELETE' });
    flows = flows.filter(f => f.id !== id);
    renderFlows();
    toast(t('flowforge.saved'), 'ok');
  } catch(_) { toast(t('flowforge.delete_error'), 'error'); }
}

// ── Modal open / close ────────────────────────────────────────────────────────

function openEditor(idOrNull) {
  editingId = idOrNull;
  isDirty   = false;
  const flow = idOrNull ? flows.find(f => f.id === idOrNull) : null;

  document.getElementById('modal-title').textContent = flow ? t('flowforge.flow.name_label') + ' bearbeiten' : t('flowforge.new_flow');
  document.getElementById('flow-name').value    = flow?.name ?? '';
  document.getElementById('flow-enabled').checked = flow?.enabled !== false;

  // Trigger select
  const trigSel = document.getElementById('trigger-type');
  trigSel.innerHTML = Object.entries(
    Object.entries(TRIGGER_DEFS).reduce((g, [k, v]) => {
      (g[v.group] = g[v.group] || []).push([k, v]);
      return g;
    }, {})
  ).map(([grp, entries]) =>
    `<optgroup label="${esc(grp)}">${entries.map(([k, v]) =>
      `<option value="${k}"${(flow?.trigger?.type ?? 'timer.start') === k ? ' selected' : ''}>${esc(v.label)}</option>`
    ).join('')}</optgroup>`
  ).join('');

  renderTriggerConfig(flow?.trigger);

  // Conditions
  const condList = document.getElementById('conditions-list');
  condList.innerHTML = '';
  (flow?.conditions || []).forEach(c => addConditionRow(c));
  refreshCondEmpty();

  // Actions
  const actList = document.getElementById('actions-list');
  actList.innerHTML = '';
  (flow?.actions || []).forEach(a => addActionRow(a));
  refreshActEmpty();

  document.getElementById('val-error').classList.remove('show');
  document.getElementById('modal-backdrop').classList.remove('hidden');

  // Track dirty state
  const modal = document.getElementById('modal');
  modal.addEventListener('input', markDirty, { once: true });

  setTimeout(() => document.getElementById('flow-name').select(), 60);
}

function markDirty() { isDirty = true; }

function closeEditor() {
  if (isDirty) {
    if (!confirm(t('flowforge.unsaved'))) return;
  }
  if (_hkCapturing) {
    _hkCapturing.btn.classList.remove('capture');
    _hkCapturing = null;
  }
  document.getElementById('modal-backdrop').classList.add('hidden');
  editingId = null; isDirty = false;
}

// ── Trigger ───────────────────────────────────────────────────────────────────

function renderTriggerConfig(existing) {
  const type = document.getElementById('trigger-type').value;
  const def  = TRIGGER_DEFS[type];

  // Description
  document.getElementById('trigger-desc').textContent = def?.desc ?? '';

  // Accent color on trigger box
  const box = document.getElementById('trigger-box');
  box.style.borderColor = type.startsWith('obs')    ? 'rgba(74,158,255,.3)'   :
                          type.startsWith('chat')   ? 'rgba(165,124,251,.3)'  :
                          type.startsWith('alert')  ? 'rgba(255,155,60,.3)'   :
                          'rgba(2,205,164,.22)';
  box.style.background  = type.startsWith('obs')    ? 'rgba(74,158,255,.04)'  :
                          type.startsWith('chat')   ? 'rgba(165,124,251,.04)' :
                          type.startsWith('alert')  ? 'rgba(255,155,60,.04)'  :
                          'rgba(2,205,164,.04)';

  const cfg = document.getElementById('trigger-config');
  if (!def?.fields?.length) { cfg.innerHTML = ''; return; }

  cfg.innerHTML = `<div class="row2">${def.fields.map(f =>
    `<div class="field-group">
      <label>${esc(f.label)}</label>
      ${buildInput(f, existing?.[f.key] ?? '', 'trig-' + f.key, existing?.scene ?? '')}
    </div>`
  ).join('')}</div>`;

  initDependencies(cfg);
  isDirty = true;
}

// ── Condition rows ────────────────────────────────────────────────────────────

function addConditionRow(existing) {
  const list = document.getElementById('conditions-list');
  const row  = document.createElement('div');
  row.className = 'rule-row';
  row.dataset.ruleType = 'condition';
  row.innerHTML = buildRuleRowInner(existing?.type ?? Object.keys(CONDITION_DEFS)[0], existing, CONDITION_DEFS);
  list.appendChild(row);
  initDependencies(row);
  refreshCondEmpty();
}

function refreshCondEmpty() {
  const list = document.getElementById('conditions-list');
  let ph = list.querySelector('.rules-empty');
  if (!list.querySelector('.rule-row')) {
    if (!ph) {
      ph = document.createElement('div');
      ph.className = 'rules-empty';
      ph.textContent = 'Keine Bedingungen — Flow wird immer ausgeführt.';
      list.appendChild(ph);
    }
  } else if (ph) ph.remove();
}

// ── Action rows ───────────────────────────────────────────────────────────────

function addActionRow(existing) {
  const list = document.getElementById('actions-list');
  const ph   = list.querySelector('.rules-empty');
  if (ph) ph.remove();

  const row  = document.createElement('div');
  row.className = 'rule-row';
  row.dataset.ruleType = 'action';
  row.innerHTML = buildRuleRowInner(existing?.type ?? Object.keys(ACTION_DEFS)[0], existing, ACTION_DEFS);
  list.appendChild(row);
  initDependencies(row);
  updateActionNumbers();
  document.getElementById('val-error').classList.remove('show');
}

function refreshActEmpty() {
  const list = document.getElementById('actions-list');
  let ph = list.querySelector('.rules-empty');
  if (!list.querySelector('.rule-row')) {
    if (!ph) {
      ph = document.createElement('div');
      ph.className = 'rules-empty';
      ph.innerHTML = 'Noch keine Aktionen — klicke <strong>Hinzufügen</strong> um eine Aktion zu ergänzen.';
      list.appendChild(ph);
    }
  } else if (ph) ph.remove();
}

function removeRow(btn) {
  btn.closest('.rule-row').remove();
  updateActionNumbers();
  refreshCondEmpty();
  refreshActEmpty();
}

function updateActionNumbers() {
  document.querySelectorAll('#actions-list .rule-row').forEach((row, i) => {
    let num = row.querySelector('.action-num');
    if (!num) { num = document.createElement('span'); num.className = 'action-num'; row.prepend(num); }
    num.textContent = i + 1;
  });
}

// ── Rule row builder ──────────────────────────────────────────────────────────

function buildRuleRowInner(type, existing, defs) {
  const isGrouped = Object.values(defs).some(d => d.group);
  let typeSelect;
  if (isGrouped) {
    const groups = Object.entries(
      Object.entries(defs).reduce((g, [k, v]) => {
        const gr = v.group ?? 'Sonstiges';
        (g[gr] = g[gr] || []).push([k, v]); return g;
      }, {})
    );
    typeSelect = `<select class="rule-type-sel" onchange="onRuleTypeChange(this)">${
      groups.map(([gr, entries]) =>
        `<optgroup label="${esc(gr)}">${entries.map(([k, v]) =>
          `<option value="${k}"${k===type?' selected':''}>${esc(v.label)}</option>`
        ).join('')}</optgroup>`
      ).join('')}</select>`;
  } else {
    typeSelect = `<select class="rule-type-sel" onchange="onRuleTypeChange(this)">${
      Object.entries(defs).map(([k, v]) =>
        `<option value="${k}"${k===type?' selected':''}>${esc(v.label)}</option>`
      ).join('')}</select>`;
  }

  const fields = buildRuleFields(type, existing, defs);
  return `
    <div class="rule-row-fields">
      ${typeSelect}
      ${fields ? `<div class="row2">${fields}</div>` : ''}
    </div>
    <button class="btn xs danger" onclick="removeRow(this)" title="Entfernen" style="flex-shrink:0;margin-top:3px">
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 1l10 10M11 1L1 11"/></svg>
    </button>`;
}

function buildRuleFields(type, existing, defs) {
  const def = defs[type];
  if (!def?.fields?.length) return '';
  return def.fields.map(f => {
    const id = 'rf-' + Math.random().toString(36).slice(2, 7);
    return `<div class="field-group">
      <label>${esc(f.label)}</label>
      ${buildInput(f, existing?.[f.key] ?? '', id, existing?.scene ?? '')}
    </div>`;
  }).join('');
}

function onRuleTypeChange(sel) {
  const row   = sel.closest('.rule-row');
  const defs  = row.dataset.ruleType === 'condition' ? CONDITION_DEFS : ACTION_DEFS;
  const fields = buildRuleFields(sel.value, {}, defs);
  let row2 = row.querySelector('.row2');
  if (!row2) { row2 = document.createElement('div'); row2.className = 'row2'; row.querySelector('.rule-row-fields').appendChild(row2); }
  row2.innerHTML = fields;
  initDependencies(row);
}

// ── Scene↔Source dependency wiring ───────────────────────────────────────────

function initDependencies(container) {
  const sceneSel  = container.querySelector('[data-scene-sel]');
  const sourceSel = container.querySelector('[data-source-sel]');
  if (!sceneSel || !sourceSel) return;

  function refresh() {
    const scene = sceneSel.value;
    const prev  = sourceSel.value;
    sourceSel.innerHTML = buildSourceOptions(scene, prev);
    if (prev && sourcesPerScene[scene]?.includes(prev)) sourceSel.value = prev;
  }

  sceneSel.addEventListener('change', async () => {
    if (sceneSel.value && !sourcesPerScene[sceneSel.value]) await loadSourcesForScene(sceneSel.value);
    refresh();
  });

  if (sceneSel.value) refresh();
}

// ── Input builders ────────────────────────────────────────────────────────────

function buildSceneOptions(value, optional) {
  const ph = optional ? '<option value="">— Alle Szenen —</option>' : '<option value="">— Szene wählen —</option>';
  if (!scenes.length) return ph + `<option disabled>${t('flowforge.obs_disconnected')}</option>`;
  return ph + scenes.map(s => `<option value="${esc(s)}"${s===value?' selected':''}>${esc(s)}</option>`).join('');
}

function buildSourceOptions(scene, value) {
  if (!scene) return '<option value="">— Erst Szene wählen —</option>';
  const sources = sourcesPerScene[scene] || [];
  if (!sources.length) return '<option value="">— Keine Quellen in dieser Szene —</option>';
  return '<option value="">— Quelle wählen —</option>' +
    sources.map(s => `<option value="${esc(s)}"${s===value?' selected':''}>${esc(s)}</option>`).join('');
}

function buildInput(field, value, id, siblingScene) {
  switch (field.type) {
    case 'scene':
      return `<select id="${id}" class="field-val" data-key="${field.key}" data-scene-sel>${buildSceneOptions(value, field.optional)}</select>`;
    case 'source':
      return `<select id="${id}" class="field-val" data-key="${field.key}" data-source-sel>${buildSourceOptions(siblingScene||'', value)}</select>`;
    case 'playlist':
      if (!playlists.length)
        return `<p style="font-size:11px;color:var(--text-s);margin:4px 0">Keine Playlists — TrackPulse starten &amp; Playlists anlegen.</p>`;
      return `<select id="${id}" class="field-val" data-key="${field.key}">
        <option value="">— Playlist wählen —</option>
        ${playlists.map(p => `<option value="${esc(p.id)}"${p.id===value?' selected':''}>${esc(p.name)} (${p.tracks?.length||0} Tracks)</option>`).join('')}
      </select>`;
    case 'bool':
      return `<select id="${id}" class="field-val" data-key="${field.key}">
        <option value="true"${value!==false?' selected':''}>${t('flowforge.visibility.show')}</option>
        <option value="false"${value===false?' selected':''}>${t('flowforge.visibility.hide')}</option>
      </select>`;
    case 'select':
      return `<select id="${id}" class="field-val" data-key="${field.key}">
        ${field.options.map(o => `<option value="${esc(o.value)}"${o.value===value?' selected':''}>${esc(o.label)}</option>`).join('')}
      </select>`;
    case 'hotkey': {
      const display = value || '— Taste drücken —';
      return `<div style="display:flex;gap:6px;align-items:center">
        <input type="hidden" id="${id}" class="field-val" data-key="${field.key}" value="${esc(value)}">
        <button type="button" class="hotkey-capture-btn" data-hidden-id="${id}"
          onclick="captureFlowHotkey(this)">${esc(display)}</button>
      </div>`;
    }
    case 'flow': {
      const others = flows.filter(f => f.id !== editingId);
      if (!others.length)
        return `<p style="font-size:11px;color:var(--text-s);margin:4px 0">Noch keine anderen Flows vorhanden.</p>`;
      return `<select id="${id}" class="field-val" data-key="${field.key}">
        <option value="">— Flow wählen —</option>
        ${others.map(f => `<option value="${esc(f.id)}"${f.id===value?' selected':''}>${esc(f.name)}</option>`).join('')}
      </select>`;
    }
    case 'number':
      return `<input id="${id}" class="field-val" data-key="${field.key}" type="number"
        value="${value!==''&&value!=null?value:''}" placeholder="${field.optional?'Leer = alle':'0'}" min="0">`;
    default:
      return `<input id="${id}" class="field-val" data-key="${field.key}" type="text" value="${esc(value)}" placeholder="${esc(field.label)}">`;
  }
}

// ── Collect state ─────────────────────────────────────────────────────────────

function collectTrigger() {
  const type = document.getElementById('trigger-type').value;
  const def  = TRIGGER_DEFS[type];
  const t    = { type };
  (def?.fields || []).forEach(f => {
    const el = document.getElementById('trig-' + f.key);
    if (el) t[f.key] = parseVal(el, f);
  });
  return t;
}

function collectRules(containerId, defs) {
  return Array.from(document.querySelectorAll(`#${containerId} .rule-row`)).map(row => {
    const type = row.querySelector('.rule-type-sel')?.value;
    if (!type) return null;
    const rule = { type };
    (defs[type]?.fields || []).forEach(f => {
      const el = row.querySelector(`.field-val[data-key="${f.key}"]`);
      if (el) rule[f.key] = parseVal(el, f);
    });
    return rule;
  }).filter(Boolean);
}

function parseVal(el, field) {
  const raw = el.value;
  if (field.type === 'number') return raw === '' ? (field.optional ? '' : 0) : Number(raw);
  if (field.type === 'bool')   return raw !== 'false';
  return raw;
}

// ── Save ──────────────────────────────────────────────────────────────────────

async function saveFlow() {
  const nameEl = document.getElementById('flow-name');
  const name   = nameEl.value.trim();
  if (!name) { nameEl.classList.add('error'); nameEl.focus(); return; }
  nameEl.classList.remove('error');

  const actions = collectRules('actions-list', ACTION_DEFS);
  if (!actions.length) {
    document.getElementById('val-error').classList.add('show');
    document.getElementById('actions-list').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const saveBtn = document.getElementById('save-btn');
  const spinner = document.getElementById('save-spinner');
  const icon    = document.getElementById('save-icon');
  saveBtn.disabled = true;
  spinner.classList.add('active');
  icon.style.display = 'none';

  const body = {
    name, enabled: document.getElementById('flow-enabled').checked,
    trigger:    collectTrigger(),
    conditions: collectRules('conditions-list', CONDITION_DEFS),
    actions,
  };

  try {
    let saved;
    if (editingId) {
      saved = await safeJson(`/api/flowforge/flows/${editingId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const idx = flows.findIndex(f => f.id === editingId);
      if (idx >= 0) flows[idx] = saved;
    } else {
      saved = await safeJson('/api/flowforge/flows', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      flows.push(saved);
    }
    isDirty = false;
    renderFlows();
    closeSilent();
    toast(editingId ? t('flowforge.saved') : t('flowforge.created'), 'ok');
  } catch(_) {
    toast(t('flowforge.save_error'), 'error');
  } finally {
    saveBtn.disabled = false;
    spinner.classList.remove('active');
    icon.style.display = '';
  }
}

function closeSilent() {
  document.getElementById('modal-backdrop').classList.add('hidden');
  editingId = null; isDirty = false;
}

i18n.ready().then(boot);
