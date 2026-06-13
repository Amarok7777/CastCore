// ─── Konstanten ──────────────────────────────────────────────────────────────
const CAT_LABELS = {
  'none':            '— Keine —',
  'scene-switching': 'Scene Switching',
  'audio-switching': 'Audio Switching',
  'video-switching': 'Video Switching',
  'trackpulse':      'TrackPulse',
};
const CAT_ACTIONS = {
  'none':            [],
  'scene-switching': [{ id: 'switch-scene',         label: 'Switch Scene' }],
  'audio-switching': [
    { id: 'change-source-volume', label: 'Change Source Volume' },
    { id: 'toggle-source-mute',   label: 'Toggle Source Mute' },
  ],
  'video-switching': [{ id: 'display-source',        label: 'Display Source' }],
  'trackpulse': [
    { id: 'trackpulse-play',     label: '▶ Play' },
    { id: 'trackpulse-pause',    label: '⏸ Pause' },
    { id: 'trackpulse-resume',   label: '▶ Resume' },
    { id: 'trackpulse-stop',     label: '⏹ Stop' },
    { id: 'trackpulse-next',     label: '⏭ Next Track' },
    { id: 'trackpulse-prev',     label: '⏮ Previous Track' },
    { id: 'trackpulse-volume',   label: '🔊 Volume (CC-Wert)' },
    { id: 'trackpulse-announce', label: '🎵 Now Playing ankündigen' },
  ],
};
const CAT_BADGE = {
  'none':            'badge-none',
  'scene-switching': 'badge-scene',
  'audio-switching': 'badge-audio',
  'video-switching': 'badge-video',
  'trackpulse':      'badge-tp',
};

// ─── State ───────────────────────────────────────────────────────────────────
let config       = null;
let scenes       = [];
let obsInputs    = [];
let midiAccess   = null;
let midiOutput   = null;
let midiBindings = [];
let editingId    = null;
let learnPending = false;
let syncing      = null;
let ws           = null;
let _bgRuntimeActive = false;
const isBackgroundRuntime = new URLSearchParams(window.location.search).get('runtime') === 'bg';

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  buildChannelOptions();
  _wsClient.start();
  try { await loadConfig(); } catch (e) { console.error('loadConfig', e); }
  await pollStatus();
  await initMidi();
  await initSyncedMappings();
  setInterval(pollStatus, 5000);
}

async function loadConfig() {
  config = await safeJson('/api/scenepilot/config');
  const ta  = config.timerAutomation || {};
  const taEnabledEl = document.getElementById('ta-enabled');
  if (taEnabledEl) taEnabledEl.checked = !!ta.enabled;
  midiBindings = Array.isArray(config.midi?.bindings)
    ? config.midi.bindings.map(b => ({ ...b, id: b.id || genId() }))
    : [];
  const savedInput = config.midi?.inputName;
  const midiInputEl = document.getElementById('midi-input');
  if (savedInput && midiInputEl) midiInputEl.value = savedInput;

  // Wire type selector label update
  const typeEl = document.getElementById('map-type');
  if (typeEl) typeEl.addEventListener('change', updateNumberLabel);

  await refreshObsData();
  // Restore timer automation fields including new ones
  fillSceneSelect('ta-pause',  scenes, ta.onPauseScene  || '');
  fillSceneSelect('ta-resume', scenes, ta.onResumeScene || '');
  renderSplitScenes(ta.splitScenes || {});
  renderMidiBindings();
  onCategoryChange();
  onValueModeChange();
}

// ─── WebSocket ───────────────────────────────────────────────────────────────
const _wsClient = createWsClient({
  onOpen() {
    // Background runtime: every time the WebSocket reconnects, re-publish the
    // current MIDI device list. The server will cache it and push it to the UI
    // window if it's already open, or serve it from cache when it opens later.
    if (isBackgroundRuntime && midiAccess?.inputs.size) {
      const devices = [...midiAccess.inputs.values()].map(i => i.name || i.id);
      const active  = document.getElementById('midi-input')?.value || '';
      _wsClient.send({ type: 'SCENEPILOT_MIDI_DEVICES', payload: { devices, active } });
    }
  },
  onMessage(msg) {
    if (msg.type === 'SCENEPILOT_EVENT' && msg.payload?.type === 'OBS_INPUT_VOLUME_CHANGED') {
      handleObsVolumeChange(msg.payload.payload);
    }
    if (isBackgroundRuntime && msg.type === 'SCENEPILOT_BINDINGS_UPDATED') {
      midiBindings = Array.isArray(msg.payload?.bindings) ? msg.payload.bindings : midiBindings;
    }
    if (!isBackgroundRuntime) {
      if (msg.type === 'SCENEPILOT_MIDI_EVENT')   handleMidiForwarded(msg.payload);
      if (msg.type === 'SCENEPILOT_MIDI_DEVICES') handleMidiDevicesForwarded(msg.payload);
    }
  },
});

// Called in the UI window when the background runtime forwards a CC/Note event.
function handleMidiForwarded(p) {
  if (!p || p.channel == null) return;
  const { channel, data1, data2, msgType, typeLabel } = p;
  const label = `${typeLabel} · Ch ${channel + 1} · #${data1} · Val ${data2}`;
  const monEl = document.getElementById('monitor-display');
  if (monEl) monEl.textContent = label;
  // Only log the row here if the UI has no direct MIDI access; otherwise
  // onMidiMessage already added it and we'd get duplicates.
  if (!midiAccess?.inputs.size) addEventRow(channel, data1, data2, typeLabel);

  if (learnPending) {
    if (data2 === 0 || msgType === 'noteoff') return;
    const typeEl = document.getElementById('map-type');
    if (typeEl) typeEl.value = msgType;
    document.getElementById('map-channel').value = String(channel);
    document.getElementById('map-number').value  = String(data1);
    updateNumberLabel();
    learnPending = false;
    const btn = document.getElementById('learn-btn');
    btn.classList.remove('active');
    btn.innerHTML = `<span class="learn-dot"></span>${t('scenepilot.learn')}`;
    if (monEl) monEl.textContent =
      `Gelernt: ${typeLabel} · Ch ${channel + 1} · #${data1} (Val ${data2}) — jetzt Aktion wählen ↓`;
  }
}

// Called in the UI window when the background runtime publishes its device list.
// This is a fallback path: if the UI's own requestMIDIAccess() already found the
// device, the dropdown is already populated and this is a no-op. If Web MIDI is
// unavailable in the UI context for any reason, this ensures the dropdown still
// shows the correct device and dispatch prevention stays active.
function handleMidiDevicesForwarded(p) {
  if (!p?.devices?.length) return;
  _bgRuntimeActive = true;

  if (midiAccess?.inputs.size) return;

  const sel = document.getElementById('midi-input');
  if (!sel) return;
  sel.replaceChildren(...p.devices.map(d => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    return opt;
  }));
  if (p.active) sel.value = p.active;
  const statusEl = document.getElementById('midi-dev-status');
  if (statusEl) statusEl.textContent = `Aktiv (BG): ${p.active || p.devices[0]}`;
}

function handleObsVolumeChange(payload) {
  const { inputName, inputVolumeMul } = payload || {};
  if (!inputName) return;
  // Skip if we just triggered this ourselves
  if (syncing === inputName) return;

  for (const b of midiBindings) {
    if (b.action === 'change-source-volume' && b.synced && b.inputName === inputName) {
      // Konvertiere OBS Multiplier (0-1.0) zu CC-Wert
      // Basierend auf der Custom Range (CC-Wertebereich)
      const min = b.rangeMin || 0;
      const max = b.rangeMax || 100;
      const ccValue = Math.round((inputVolumeMul || 0) * (max - min) + min);
      sendMidiCC(b.channel, b.number, ccValue);
    }
  }
}

// ─── MIDI Output ─────────────────────────────────────────────────────────────
async function initMidiOutput() {
  if (!midiAccess) {
    midiOutput = null;
    return;
  }
  const selectedInput = document.getElementById('midi-input')?.value || '';
  const outputs = [...midiAccess.outputs.values()];
  if (!outputs.length) {
    midiOutput = null;
    return;
  }
  const matched = outputs.find(o => (o.name || o.id) === selectedInput);
  midiOutput = matched || outputs[0];
}

function sendMidiCC(channel, controller, value) {
  if (!midiOutput) return;
  const status = 0xb0 | (channel & 0x0f);
  const msg = [status, controller & 0x7f, value & 0x7f];
  try {
    midiOutput.send(msg);
  } catch (e) {
    console.error('MIDI send error', e);
  }
}

async function initSyncedMappings() {
  for (const b of midiBindings) {
    if (b.action === 'change-source-volume' && b.synced && b.inputName) {
      try {
        const mulValue = await safeJson(`/api/scenepilot/input-volume/${encodeURIComponent(b.inputName)}`);
        if (mulValue !== null && mulValue !== undefined) {
          // Konvertiere OBS Multiplier (0-1.0) zurück zu CC-Wert
          // Basierend auf der Custom Range (CC-Wertebereich)
          const min = b.rangeMin || 0;
          const max = b.rangeMax || 100;
          const ccValue = Math.round(mulValue * (max - min) + min);
          sendMidiCC(b.channel, b.number, ccValue);
        }
      } catch (e) {
        console.error('init synced mapping failed', e);
      }
    }
  }
}
async function pollStatus() {
  try {
    const s  = await safeJson('/api/scenepilot/status');
    const el = document.getElementById('obs-status');
    if (el) {
      if (s.connected) {
        el.innerHTML = 'Status: <span class="pill ok">verbunden</span>';
      } else {
        const err = s.lastError ? ` — ${esc(s.lastError)}` : '';
        el.innerHTML = `Status: <span class="pill err">getrennt</span>${err}`;
      }
    }
  } catch { /* non-fatal */ }
  if (!isBackgroundRuntime) {
    try {
      const ts = await safeJson('/api/tools/scenepilot/status');
      _bgRuntimeActive = !!(ts?.runtime?.running);
    } catch { /* non-fatal */ }
  }
}

async function connectObs() {
  // Verbindung wird im Hub verwaltet – hier nur Daten neu laden
  await refreshObsData();
}

async function disconnectObs() {
  await fetch('/api/scenepilot/disconnect', { method: 'POST' });
  await pollStatus();
}

async function refreshObsData() {
  try {
    [scenes, obsInputs] = await Promise.all([
      safeJson('/api/scenepilot/scenes'),
      safeJson('/api/scenepilot/inputs'),
    ]);
    const ta = config?.timerAutomation || {};
    fillSceneSelect('ta-start',  scenes, ta.onStartScene  || '');
    fillSceneSelect('ta-finish', scenes, ta.onFinishScene || '');
    fillSceneSelect('ta-reset',  scenes, ta.onResetScene  || '');
    fillSceneSelect('ta-pause',  scenes, ta.onPauseScene  || '');
    fillSceneSelect('ta-resume', scenes, ta.onResumeScene || '');
    renderSplitScenes(ta.splitScenes || {});
    rebuildParams(document.getElementById('map-action')?.value || '');
  } catch { /* OBS not connected — silent */ }
}

function fillSceneSelect(id, list, current) {
  const sel = document.getElementById(id);
  if (!sel) return;
  sel.innerHTML = `<option value="">${t('scenepilot.obs_not_connected')}</option>`
    + list.map(s => `<option value="${esc(s.sceneName)}">${esc(s.sceneName)}</option>`).join('');
  if (current) sel.value = current;
}

// ─── Save ─────────────────────────────────────────────────────────────────────
async function saveAllConfig() {
  const patch = {
    obs: config?.obs || {},
    timerAutomation: {
      enabled:       document.getElementById('ta-enabled')?.checked ?? false,
      onStartScene:  document.getElementById('ta-start')?.value  || '',
      onFinishScene: document.getElementById('ta-finish')?.value || '',
      onResetScene:  document.getElementById('ta-reset')?.value  || '',
      onPauseScene:  document.getElementById('ta-pause')?.value  || '',
      onResumeScene: document.getElementById('ta-resume')?.value || '',
      splitScenes:   _getSplitScenes(),
    },
    midi: {
      enabled:   true,
      inputName: document.getElementById('midi-input').value || '',
      bindings:  midiBindings,
    },
  };
  config = await safeJson('/api/scenepilot/config', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  });
  // Push updated bindings to the background runtime so it can dispatch immediately
  // without needing to reload. The background's midiBindings would otherwise stay
  // at the state from its last boot.
  if (!isBackgroundRuntime) {
    _wsClient.send({ type: 'SCENEPILOT_BINDINGS_UPDATED', payload: { bindings: midiBindings } });
  }
  const hint = document.getElementById('save-hint');
  hint.textContent = t('scenepilot.saved');
  setTimeout(() => { hint.textContent = ''; }, 2400);
  await pollStatus();
}

// ─── MIDI Device ──────────────────────────────────────────────────────────────
function buildChannelOptions() {
  const sel = document.getElementById('map-channel');
  if (sel.options.length) return;
  sel.innerHTML = Array.from({ length: 16 }, (_, i) =>
    `<option value="${i}">Kanal ${i + 1}</option>`
  ).join('');
}

async function initMidi() {
  const statusEl = document.getElementById('midi-dev-status');
  if (!navigator.requestMIDIAccess) {
    if (statusEl) statusEl.textContent = t('scenepilot.midi.not_available');
    return;
  }
  let access;
  try { access = await navigator.requestMIDIAccess({ sysex: false }); }
  catch (e) {
    if (statusEl) statusEl.textContent = 'MIDI-Zugriff verweigert: ' + e.message;
    return;
  }
  midiAccess = access;

  midiAccess.onstatechange = async () => {
    await refreshMidiInputsUI();
    await initSyncedMappings();
  };

  await refreshMidiInputsUI();
  await initSyncedMappings();

  // Retry once after a short delay in case the device wasn't enumerated immediately.
  if (!midiAccess.inputs.size) {
    setTimeout(async () => {
      await refreshMidiInputsUI();
      if (midiAccess.inputs.size) await initSyncedMappings();
    }, 600);
  }
}

async function refreshMidiInputsUI() {
  const statusEl = document.getElementById('midi-dev-status');
  const sel = document.getElementById('midi-input');
  const inputs = [...midiAccess.inputs.values()];
  const currentValue = sel.value;

  if (!inputs.length) {
    if (!isBackgroundRuntime && _bgRuntimeActive) return;
    sel.innerHTML = `<option value="">${t('scenepilot.no_midi_device')}</option>`;
    statusEl.textContent = t('scenepilot.no_midi');
    await initMidiOutput();
    return;
  }

  // Capture names as plain strings; build options via DOM API (no esc() needed,
  // textContent/value assignment handles all encoding automatically).
  const inputNames = inputs.map(i => i.name || i.id);

  sel.replaceChildren(...inputNames.map(n => {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;
    return opt;
  }));
  // Select the right option by index, then activate using the captured name.
  const saved = config?.midi?.inputName;
  let activeIdx = 0;
  if (currentValue && inputNames.includes(currentValue)) {
    activeIdx = inputNames.indexOf(currentValue);
  } else if (saved && inputNames.includes(saved)) {
    activeIdx = inputNames.indexOf(saved);
  }
  sel.selectedIndex = activeIdx;

  // Use the captured name directly — do not rely on sel.value which can be ""
  // if esc() produced an empty attribute value for any reason.
  const nameToActivate = inputNames[activeIdx] || '';
  activateInput(nameToActivate);
  sel.onchange = async () => {
    const n = inputNames[sel.selectedIndex] || sel.value || '';
    activateInput(n);
    await initMidiOutput();
    await initSyncedMappings();
    // Notify UI window about the newly selected device
    if (isBackgroundRuntime) {
      const devs = [...midiAccess.inputs.values()].map(i => i.name || i.id);
      _wsClient.send({ type: 'SCENEPILOT_MIDI_DEVICES', payload: { devices: devs, active: n } });
    }
  };
  await initMidiOutput();

  // Background runtime: push current device list to the UI window via WebSocket
  if (isBackgroundRuntime) {
    const devices = [...midiAccess.inputs.values()].map(i => i.name || i.id);
    _wsClient.send({ type: 'SCENEPILOT_MIDI_DEVICES', payload: { devices, active: nameToActivate } });
  }
}

function activateInput(name) {
  if (!midiAccess) return;
  for (const i of midiAccess.inputs.values()) i.onmidimessage = null;
  const found = [...midiAccess.inputs.values()].find(i => (i.name || i.id) === name);
  if (!found) return;
  found.onmidimessage = onMidiMessage;
  document.getElementById('midi-dev-status').textContent = 'Aktiv: ' + name;
}

// ─── MIDI Learn ───────────────────────────────────────────────────────────────
function toggleLearn() {
  learnPending = !learnPending;
  const btn = document.getElementById('learn-btn');
  if (learnPending) {
    btn.classList.add('active');
    btn.innerHTML = `<span class="learn-dot"></span>${t('scenepilot.learn.cancel')}`;
    document.getElementById('monitor-display').textContent = t('scenepilot.learn.waiting');
  } else {
    btn.classList.remove('active');
    btn.innerHTML = `<span class="learn-dot"></span>${t('scenepilot.learn')}`;
  }
}

// ─── MIDI Messages ────────────────────────────────────────────────────────────
function _nibbleToType(nibble) {
  if (nibble === 0x90) return 'noteon';
  if (nibble === 0x80) return 'noteoff';
  return 'cc';
}

async function onMidiMessage(ev) {
  const [status, data1, data2] = ev.data;
  const nibble   = status & 0xf0;
  const channel  = status & 0x0f;

  // Accept CC (0xB0), Note On (0x90), Note Off (0x80)
  if (nibble !== 0xb0 && nibble !== 0x90 && nibble !== 0x80) return;

  const msgType  = _nibbleToType(nibble);
  const typeLabel = msgType === 'noteon' ? 'Note On' : msgType === 'noteoff' ? 'Note Off' : 'CC';
  const label = `${typeLabel} · Ch ${channel + 1} · #${data1} · Val ${data2}`;
  document.getElementById('monitor-display').textContent = label;
  addEventRow(channel, data1, data2, typeLabel);

  // Forward to the UI window so it can show the monitor and handle MIDI Learn
  if (isBackgroundRuntime) {
    _wsClient.send({ type: 'SCENEPILOT_MIDI_EVENT',
      payload: { channel, data1, data2, msgType, typeLabel } });
  }

  if (learnPending) {
    // Ignore val=0 CC events — these are button releases or encoder zeros and
    // would silently capture the wrong control (e.g. a button released just
    // before the intended press). Note Off is also skipped for the same reason.
    if (data2 === 0 || msgType === 'noteoff') return;
    const typeEl = document.getElementById('map-type');
    if (typeEl) typeEl.value = msgType;
    document.getElementById('map-channel').value = String(channel);
    document.getElementById('map-number').value  = String(data1);
    updateNumberLabel();
    learnPending = false;
    const btn = document.getElementById('learn-btn');
    btn.classList.remove('active');
    btn.innerHTML = `<span class="learn-dot"></span>${t('scenepilot.learn')}`;
    document.getElementById('monitor-display').textContent =
      `Gelernt: ${typeLabel} · Ch ${channel + 1} · #${data1} (Val ${data2}) — jetzt Aktion wählen ↓`;
    return;
  }

  // UI window: don't dispatch when the background runtime is already handling it.
  // Background runtime always dispatches; UI window dispatches only when running standalone.
  if (!isBackgroundRuntime && _bgRuntimeActive) return;

  const binding = midiBindings.find(b =>
    !b.disabled &&
    b.channel === channel &&
    b.number  === data1 &&
    (b.type || 'cc') === msgType
  );

  if (!binding || binding.category === 'none') return;
  // Note Off: always trigger (ignore threshold); CC/Note On: respect threshold
  if (msgType !== 'noteoff') {
    const thr = binding.threshold ?? 1;
    if (binding.valueMode === 'threshold' && data2 < thr) return;
  }
  await dispatchBinding(binding, data2);
}

function updateNumberLabel() {
  const typeEl = document.getElementById('map-type');
  const lbl    = document.getElementById('map-number-label');
  if (!lbl || !typeEl) return;
  lbl.textContent = typeEl.value === 'cc' ? 'Control Nr.' : 'Note Nr.';
}

async function dispatchBinding(b, ccValue) {
  try {
    if (b.action === 'switch-scene') {
      await postAction({ type: 'scene', sceneName: b.sceneName });
    } else if (b.action === 'change-source-volume') {
      let mul = 0;
      if (b.valueMode === 'custom-range') {
        const min = b.rangeMin ?? 0;
        const max = b.rangeMax ?? 100;
        // Custom Range ist die tatsächliche CC-Wertebereich des Faders
        // Z.B. Fader 0-100 CC → min=0, max=100
        // Dann: Fader Position 100 = 100% = 1.0 Multiplier
        mul = Math.max(0, Math.min(1, (ccValue - min) / (max - min)));
      } else {
        mul = Math.max(0, Math.min(1, ccValue / 127));
      }
      if (b.synced) syncing = b.inputName;
      try {
        await postAction({ type: 'volume', inputName: b.inputName, multiplier: mul });
      } finally {
        syncing = null;
      }
    } else if (b.action === 'toggle-source-mute') {
      await postAction({ type: 'toggle-mute', inputName: b.inputName });
    } else if (b.action === 'display-source') {
      if (b.displayMode === 'toggle') {
        await postAction({ type: 'toggle-visibility', sceneName: b.sourceScene, sourceName: b.sourceName });
      } else {
        await postAction({ type: 'source-visibility', sceneName: b.sourceScene, sourceName: b.sourceName, enabled: b.displayMode === 'show' });
      }
    } else if (b.action === 'trackpulse-play') {
      await safeJson('/api/trackpulse/player/play',   { method: 'POST' });
    } else if (b.action === 'trackpulse-pause') {
      await safeJson('/api/trackpulse/player/pause',  { method: 'POST' });
    } else if (b.action === 'trackpulse-resume') {
      await safeJson('/api/trackpulse/player/resume', { method: 'POST' });
    } else if (b.action === 'trackpulse-stop') {
      await safeJson('/api/trackpulse/player/stop',   { method: 'POST' });
    } else if (b.action === 'trackpulse-next') {
      await safeJson('/api/trackpulse/player/next',   { method: 'POST' });
    } else if (b.action === 'trackpulse-prev') {
      await safeJson('/api/trackpulse/player/prev',   { method: 'POST' });
    } else if (b.action === 'trackpulse-volume') {
      const min = b.rangeMin ?? 0;
      const max = b.rangeMax ?? 127;
      const pct = max > min ? Math.max(0, Math.min(1, (ccValue - min) / (max - min))) : 0;
      const vol = Math.round(pct * 100);
      await safeJson('/api/trackpulse/player/volume', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volume: vol }),
      });
    } else if (b.action === 'trackpulse-announce') {
      await safeJson('/api/trackpulse/announce');
    }
  } catch (e) {
    console.error('dispatch error', e);
  }
}

async function postAction(action) {
  await safeJson('/api/scenepilot/action', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action),
  });
}

// ─── Mapping Form ─────────────────────────────────────────────────────────────
function onCategoryChange() {
  const cat     = document.getElementById('map-category').value;
  const actions = CAT_ACTIONS[cat] || [];
  const row     = document.getElementById('action-row');
  const sel     = document.getElementById('map-action');
  if (!actions.length) {
    row.style.display = 'none';
    document.getElementById('action-params').innerHTML = '';
    return;
  }
  row.style.display = '';
  sel.innerHTML = actions.map(a =>
    `<option value="${esc(a.id)}">${esc(a.label)}</option>`
  ).join('');
  onActionChange();
}

function onActionChange() {
  const action = document.getElementById('map-action')?.value || '';
  rebuildParams(action);
  applyValueDefaults(action);
}

function rebuildParams(action) {
  const el = document.getElementById('action-params');
  if (!el) return;
  if (action === 'switch-scene') {
    el.innerHTML = frow('Szene', sceneOpts('param-scene', '', ''));
  } else if (action === 'change-source-volume') {
    const synced = '<label style="display:flex;align-items:center;gap:6px"><input id="param-synced" type="checkbox"> Keep synced</label>';
    const hint = '<p class="hint">Mit <strong>Keep synced</strong>: MIDI-Fader und OBS Lautstärke werden automatisch synchronisiert. Der Fader wird auf die OBS-Wert beim Start gesetzt.</p>';
    el.innerHTML = frow('Audio Source', inputOpts('param-input', ''))
      + frow('', synced) + hint;
  } else if (action === 'toggle-source-mute') {
    el.innerHTML = frow('Audio Source', inputOpts('param-input', ''));
  } else if (action === 'display-source') {
    el.innerHTML =
      frow('Szene (OBS)',  sceneOpts('param-source-scene', '', 'loadSources(this.value)'))
      + frow('Quelle',     `<select id="param-source-name"><option value="">${t('scenepilot.first_select_scene')}</option></select>`)
      + frow('Verhalten',  `<select id="param-display-mode">
          <option value="toggle">Toggle (Sichtbarkeit umschalten)</option>
          <option value="show">Show (einblenden)</option>
          <option value="hide">Hide (ausblenden)</option>
        </select>`);
    const sceneEl = document.getElementById('param-source-scene');
    if (sceneEl?.value) loadSources(sceneEl.value);
  } else if (action === 'trackpulse-volume') {
    el.innerHTML = '<p class="hint">CC-Wert (0–127) wird auf TrackPulse-Lautstärke (0–100 %) gemappt. Nutze <strong>Custom Range</strong> um den nutzbaren CC-Bereich einzuschränken (z.B. Fader 0–100).</p>';
  } else {
    el.innerHTML = '';
  }
}

async function loadSources(sceneName) {
  const sel = document.getElementById('param-source-name');
  if (!sel || !sceneName) return;
  sel.innerHTML = '<option value="">L&auml;dt …</option>';
  try {
    const items = await safeJson(`/api/scenepilot/scene-items/${encodeURIComponent(sceneName)}`);
    sel.innerHTML = items.length
      ? items.map(i => `<option value="${esc(i.sourceName)}">${esc(i.sourceName)}</option>`).join('')
      : `<option value="">${t('scenepilot.no_sources')}</option>`;
  } catch {
    sel.innerHTML = '<option value="">Fehler beim Laden</option>';
  }
}

function applyValueDefaults(action) {
  const sel = document.getElementById('map-value-mode');
  if (action === 'change-source-volume' || action === 'trackpulse-volume') {
    sel.value = 'custom-range';
    document.getElementById('map-range-min').value = 0;
    document.getElementById('map-range-max').value = action === 'trackpulse-volume' ? 127 : 100;
  } else if (sel.value === 'custom-range' || sel.value === 'use-value') {
    sel.value = 'threshold';
  }
  onValueModeChange();
}

function onValueModeChange() {
  const mode   = document.getElementById('map-value-mode').value;
  const thrRow = document.getElementById('threshold-row');
  const rangeRow = document.getElementById('custom-range-row');
  const hint   = document.getElementById('value-mode-hint');
  thrRow.style.display = mode === 'threshold' ? '' : 'none';
  rangeRow.style.display = mode === 'custom-range' ? '' : 'none';
  const n = document.getElementById('map-threshold').value || '1';
  if      (mode === 'threshold') hint.textContent = `Trigger wird ausgelöst wenn CC-Wert ≥ ${n}. (Button drücken → 127, loslassen → 0)`;
  else if (mode === 'any')       hint.textContent = t('scenepilot.valuemode.hint_any');
  else if (mode === 'use-value') hint.textContent = 'Der CC-Wert (0–127) wird direkt als Parameter weitergegeben — ideal für Fader und Regler.';
  else if (mode === 'custom-range') {
    const min = document.getElementById('map-range-min').value || '0';
    const max = document.getElementById('map-range-max').value || '100';
    hint.textContent = `CC-Wert wird von deinem Bereich [${min}, ${max}] linear auf OBS-Wertebereich skaliert. Z.B. Fader 0–100 → Lautstärke 0–100%.`;
  }
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────
function submitMapping() {
  const trigType  = document.getElementById('map-type')?.value || 'cc';
  const channel   = Number(document.getElementById('map-channel').value);
  const number    = Number(document.getElementById('map-number').value);
  const category  = document.getElementById('map-category').value;
  const action    = document.getElementById('map-action')?.value || '';
  const valueMode = document.getElementById('map-value-mode').value;
  const threshold = Number(document.getElementById('map-threshold').value) || 1;
  const rangeMin  = Number(document.getElementById('map-range-min').value) || 0;
  const rangeMax  = Number(document.getElementById('map-range-max').value) || 100;
  const synced    = document.getElementById('param-synced')?.checked || false;
  const disabled  = document.getElementById('map-disabled')?.checked || false;

  if (isNaN(number) || number < 0 || number > 127) {
    alert(t('scenepilot.error.control_number')); return;
  }
  if (valueMode === 'custom-range' && rangeMin >= rangeMax) {
    alert(t('scenepilot.error.custom_range')); return;
  }

  // Conflict detection
  const conflict = midiBindings.find(b =>
    b.id !== editingId &&
    b.channel === channel && b.number === number &&
    (b.type || 'cc') === trigType
  );
  if (conflict && !confirm(`Kanal ${channel + 1} / #${number} (${trigType.toUpperCase()}) ist bereits belegt. Trotzdem hinzufügen?`)) return;

  const b = { id: editingId || genId(), type: trigType, channel, number, category, action, valueMode, threshold, rangeMin, rangeMax, synced, disabled };

  if (action === 'switch-scene') {
    b.sceneName = document.getElementById('param-scene')?.value || '';
    if (!b.sceneName) { alert(t('scenepilot.error.select_scene')); return; }
  }
  if (action === 'change-source-volume' || action === 'toggle-source-mute') {
    b.inputName = document.getElementById('param-input')?.value || '';
    if (!b.inputName) { alert(t('scenepilot.error.select_source')); return; }
  }
  if (action === 'display-source') {
    b.sourceScene  = document.getElementById('param-source-scene')?.value || '';
    b.sourceName   = document.getElementById('param-source-name')?.value  || '';
    b.displayMode  = document.getElementById('param-display-mode')?.value || 'toggle';
    if (!b.sourceScene) { alert(t('scenepilot.error.select_scene')); return; }
    if (!b.sourceName)  { alert(t('scenepilot.error.select_source')); return; }
  }

  if (editingId) {
    const idx = midiBindings.findIndex(x => x.id === editingId);
    if (idx >= 0) midiBindings[idx] = b; else midiBindings.push(b);
  } else {
    midiBindings.push(b);
  }
  cancelEdit();
  renderMidiBindings();
  saveAllConfig(); // auto-save after every add/edit
}

function editMapping(id) {
  const b = midiBindings.find(x => x.id === id);
  if (!b) return;
  editingId = id;

  const typeEl = document.getElementById('map-type');
  if (typeEl) { typeEl.value = b.type || 'cc'; updateNumberLabel(); }
  document.getElementById('map-channel').value  = String(b.channel);
  document.getElementById('map-number').value   = String(b.number);
  document.getElementById('map-category').value = b.category || 'none';
  const disabledEl = document.getElementById('map-disabled');
  if (disabledEl) disabledEl.checked = !!b.disabled;
  onCategoryChange();

  requestAnimationFrame(() => {
    if (b.action) {
      const sel = document.getElementById('map-action');
      if (sel) { sel.value = b.action; rebuildParams(b.action); }
    }
    requestAnimationFrame(() => {
      if (b.sceneName) { const e = document.getElementById('param-scene');        if (e) e.value = b.sceneName; }
      if (b.inputName) { const e = document.getElementById('param-input');        if (e) e.value = b.inputName; }
      if (b.sourceScene) {
        const e = document.getElementById('param-source-scene');
        if (e) {
          e.value = b.sourceScene;
          loadSources(b.sourceScene).then(() => {
            const s = document.getElementById('param-source-name');
            if (s && b.sourceName) s.value = b.sourceName;
          });
        }
      }
      if (b.displayMode) { const e = document.getElementById('param-display-mode'); if (e) e.value = b.displayMode; }
      if (b.synced !== undefined) { const e = document.getElementById('param-synced'); if (e) e.checked = b.synced; }
      document.getElementById('map-value-mode').value = b.valueMode || 'threshold';
      document.getElementById('map-threshold').value  = b.threshold ?? 1;
      document.getElementById('map-range-min').value  = b.rangeMin ?? 0;
      document.getElementById('map-range-max').value  = b.rangeMax ?? 100;
      onValueModeChange();
    });
  });

  document.getElementById('form-title').textContent   = t('scenepilot.form.edit');
  document.getElementById('submit-btn').textContent   = t('scenepilot.save_mapping');
  document.getElementById('cancel-btn').style.display = '';
  renderMidiBindings();
}

function deleteMapping(id) {
  if (!confirm(t('scenepilot.confirm_delete'))) return;
  midiBindings = midiBindings.filter(b => b.id !== id);
  if (editingId === id) cancelEdit();
  markUnsaved();
  renderMidiBindings();
}

function cancelEdit() {
  editingId = null;
  document.getElementById('form-title').textContent   = t('scenepilot.form.new');
  document.getElementById('submit-btn').textContent   = t('scenepilot.add_mapping');
  document.getElementById('cancel-btn').style.display = 'none';
  renderMidiBindings();
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderMidiBindings() {
  const el = document.getElementById('midi-bindings');
  const countEl = document.getElementById('mapping-count');
  if (countEl) countEl.textContent = midiBindings.length;
  if (!midiBindings.length) {
    el.innerHTML = `<div class="empty-map">${t('scenepilot.empty_mapping')}</div>`;
    return;
  }
  el.innerHTML = midiBindings.map(b => {
    const trigType = b.type === 'noteon' ? 'Note On' : b.type === 'noteoff' ? 'Note Off' : 'CC';
    const trig   = `${trigType} · Ch ${b.channel + 1} · #${b.number}`;
    const cat    = b.category || 'none';
    const badge  = CAT_BADGE[cat] || 'badge-none';
    const catLbl = CAT_LABELS[cat] || cat;
    const valHint = b.valueMode === 'use-value'    ? 'Val als Wert'
                  : b.valueMode === 'any'          ? 'Immer'
                  : b.valueMode === 'custom-range' ? `[${b.rangeMin ?? 0}–${b.rangeMax ?? 100}]`
                  : `Wert ≥ ${b.threshold ?? 1}`;

    let actionTxt = esc(b.action || '—');
    if (b.action === 'switch-scene')          actionTxt = `Switch Scene &rarr; <strong>${esc(b.sceneName || '?')}</strong>`;
    if (b.action === 'change-source-volume') {
      let volumeHint = '';
      if (b.synced) volumeHint = ` <span class="pill ok">synced</span>`;
      if (b.valueMode === 'custom-range') volumeHint += ` <span class="muted">[${b.rangeMin ?? 0}&#8211;${b.rangeMax ?? 100}]</span>`;
      actionTxt = `Volume &rarr; <strong>${esc(b.inputName || '?')}</strong>${volumeHint}`;
    }
    if (b.action === 'toggle-source-mute')    actionTxt = `Mute Toggle &rarr; <strong>${esc(b.inputName || '?')}</strong>`;
    if (b.action === 'display-source') {
      const m = { toggle: 'Toggle', show: 'Show', hide: 'Hide' };
      actionTxt = `${m[b.displayMode] || 'Toggle'} &rarr; <strong>${esc(b.sourceName || '?')}</strong> <span class="muted">(${esc(b.sourceScene || '?')})</span>`;
    }
    const tpLabels = {
      'trackpulse-play':     '▶ Play',
      'trackpulse-pause':    '⏸ Pause',
      'trackpulse-resume':   '▶ Resume',
      'trackpulse-stop':     '⏹ Stop',
      'trackpulse-next':     '⏭ Next Track',
      'trackpulse-prev':     '⏮ Prev Track',
      'trackpulse-announce': '🎵 Now Playing',
    };
    if (tpLabels[b.action]) {
      actionTxt = `<strong>${tpLabels[b.action]}</strong>`;
    }
    if (b.action === 'trackpulse-volume') {
      const hint = b.valueMode === 'custom-range' ? ` <span class="muted">[${b.rangeMin ?? 0}&#8211;${b.rangeMax ?? 127}]</span>` : '';
      actionTxt = `<strong>🔊 Volume</strong> (CC → 0–100 %)${hint}`;
    }
    const disabledStyle = b.disabled ? 'opacity:.4' : '';
    return `<div class="mrow${editingId === b.id ? ' editing' : ''}" style="${disabledStyle}">
      <div class="mrow-info">
        <div class="mrow-top">
          <span class="trigger-tag">${esc(trig)}</span>
          <span class="badge ${badge}">${esc(catLbl)}</span>
          <span class="mrow-val">${esc(valHint)}</span>
          ${b.disabled ? '<span class="badge-none" style="font-size:9px">deaktiviert</span>' : ''}
        </div>
        <div class="mrow-action">${actionTxt}</div>
      </div>
      <div class="mrow-btns">
        <button class="ibtn" title="${b.disabled ? t('scenepilot.activate') : t('scenepilot.deactivate')}" onclick='toggleDisable(${JSON.stringify(b.id)})'>${b.disabled ? '✓' : '○'}</button>
        <button class="ibtn" title="${t('btn.edit')}" onclick='editMapping(${JSON.stringify(b.id)})'>&#9998;</button>
        <button class="ibtn del" title="${t('btn.delete')}" onclick='deleteMapping(${JSON.stringify(b.id)})'>&#10005;</button>
      </div>
    </div>`;
  }).join('');
}

function addEventRow(channel, number, value, typeLabel = 'CC') {
  const list = document.getElementById('midi-events');
  const row  = document.createElement('div');
  row.className = 'ev-row';

  const timeSpan = document.createElement('span');
  timeSpan.className = 'mono muted';
  timeSpan.textContent = new Date().toLocaleTimeString();

  const trigSpan = document.createElement('span');
  trigSpan.className = 'trigger-tag';
  trigSpan.textContent = `${typeLabel} · Ch ${channel + 1} · #${number}`;

  const valSpan = document.createElement('span');
  valSpan.className = 'muted';
  valSpan.textContent = `Val ${value}`;

  row.append(timeSpan, ' ', trigSpan, ' ', valSpan);

  const matched = midiBindings.some(b =>
    !b.disabled && b.channel === channel && b.number === number
  );
  if (matched) {
    const badge = document.createElement('span');
    badge.className = 'badge-scene';
    badge.style.fontSize = '9px';
    badge.textContent = '▶ Mapping';
    row.append(' ', badge);
  }

  list.prepend(row);
  while (list.children.length > 14) list.removeChild(list.lastChild);
}

// ─── Disable toggle ───────────────────────────────────────────────────────────
function toggleDisable(id) {
  const b = midiBindings.find(x => x.id === id);
  if (!b) return;
  b.disabled = !b.disabled;
  markUnsaved();
  renderMidiBindings();
  saveAllConfig();
}

// ─── Export / Import ──────────────────────────────────────────────────────────
function exportMappings() {
  const data = JSON.stringify({ version: 1, bindings: midiBindings }, null, 2);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  a.download = 'scenepilot-mappings.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function importMappings(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = JSON.parse(e.target.result);
      const imported = Array.isArray(parsed.bindings) ? parsed.bindings : Array.isArray(parsed) ? parsed : [];
      if (!imported.length) { alert('Keine Mappings in der Datei gefunden.'); return; }
      if (!confirm(`${imported.length} Mapping(s) importieren und aktuelle Liste ersetzen?`)) return;
      midiBindings = imported.map(b => ({ ...b, id: b.id || genId() }));
      renderMidiBindings();
      saveAllConfig();
    } catch { alert(t('scenepilot.import_error')); }
  };
  reader.readAsText(file);
  input.value = '';
}

// ─── Split-Szenen UI ──────────────────────────────────────────────────────────
function renderSplitScenes(splitScenes) {
  const host = document.getElementById('split-scenes-list');
  if (!host) return;
  const entries = Object.entries(splitScenes || {});
  if (!entries.length) { host.innerHTML = ''; return; }
  const sceneOpts = scenes.map(s => `<option value="${esc(s.sceneName)}">${esc(s.sceneName)}</option>`).join('');
  host.innerHTML = entries.map(([idx, scene]) => `
    <div style="display:grid;grid-template-columns:90px 1fr auto;gap:6px;align-items:center" data-split-row="${esc(idx)}">
      <div style="display:flex;align-items:center;gap:5px">
        <span style="font-size:11px;color:var(--muted)">Split</span>
        <input type="number" min="0" max="999" value="${esc(idx)}" style="width:52px"
          onchange="renameSplitRow(this,${esc(idx)})">
      </div>
      <select onchange="setSplitScene(${esc(idx)},this.value)">
        <option value="">— keine —</option>${sceneOpts}
      </select>
      <button class="ibtn del" onclick="removeSplitRow(${esc(idx)})">&#10005;</button>
    </div>
  `).join('');
  // Restore selected values
  entries.forEach(([idx, scene]) => {
    const row = host.querySelector(`[data-split-row="${esc(idx)}"]`);
    const sel = row?.querySelector('select');
    if (sel && scene) sel.value = scene;
  });
}

function _getSplitScenes() {
  const result = {};
  document.querySelectorAll('#split-scenes-list [data-split-row]').forEach(row => {
    const idx  = row.getAttribute('data-split-row');
    const sel  = row.querySelector('select');
    if (sel?.value) result[idx] = sel.value;
  });
  return result;
}

function addSplitSceneRow() {
  const existing = _getSplitScenes();
  const nextIdx  = String(Object.keys(existing).length);
  const newMap   = { ...existing, [nextIdx]: '' };
  renderSplitScenes(newMap);
}

function setSplitScene(idx, scene) {
  // Handled by _getSplitScenes() on save
}

function renameSplitRow(input, oldIdx) {
  const map = _getSplitScenes();
  const val = map[String(oldIdx)] || '';
  delete map[String(oldIdx)];
  map[String(input.value)] = val;
  renderSplitScenes(map);
}

function removeSplitRow(idx) {
  const map = _getSplitScenes();
  delete map[String(idx)];
  renderSplitScenes(map);
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────
function frow(labelTxt, inputHtml) {
  return `<div class="frow"><label>${esc(labelTxt)}</label>${inputHtml}</div>`;
}
function sceneOpts(id, current, onchange) {
  const oc = onchange ? ` onchange="${onchange}"` : '';
  const opts = scenes.length
    ? scenes.map(s => `<option value="${esc(s.sceneName)}"${s.sceneName === current ? ' selected' : ''}>${esc(s.sceneName)}</option>`).join('')
    : '<option value="">&#8212; OBS verbinden &#8212;</option>';
  return `<select id="${id}"${oc}>${opts}</select>`;
}
function inputOpts(id, current) {
  const opts = obsInputs.length
    ? obsInputs.map(i => `<option value="${esc(i.inputName)}"${i.inputName === current ? ' selected' : ''}>${esc(i.inputName)}</option>`).join('')
    : '<option value="">&#8212; OBS verbinden &#8212;</option>';
  return `<select id="${id}">${opts}</select>`;
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function markUnsaved() {
  document.getElementById('save-hint').textContent = '● Nicht gespeichert';
}
function genId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function esc(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

boot();
