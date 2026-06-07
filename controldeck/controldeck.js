// ── State ─────────────────────────────────────────────────────────
let timerState   = null;
let musicState   = null;
let obsConnected    = false;
let isStreaming     = false;
let isRecording     = false;
let isRecordPaused  = false;
let isVirtualCam    = false;
let scenes          = [];
let hiddenScenes    = [];
let sceneManageMode = false;
let currentScene    = '';
let playlist        = [];
let playingIndex = -1;
let isPlaying    = false;
let musicShuffle = false;
let musicLoopMode = 'all';
let namedPlaylists   = [];
let activePlaylistId = null;
let timerBaseElapsedMs = 0;
let timerSnapshotAt = 0;

// Chat state
let cdMessages   = [];   // { id, platform, authorName, authorColor, text, time, hl, hlColor }
let cdKeywords   = [];
let cdScrollLock    = false;
let cdYtPoll        = null;
let cdLastMessageAt = 0;
const CD_MAX_MSG = 150;
let efEntries     = [];
let efBackfillTried = false;
const EF_MAX_ENTRIES = 50;

// ── WebSocket for live timer ──────────────────────────────────────
const _wsClient = createWsClient({
  onMessage(msg) {
    if (msg.type === 'UPDATE')                               applyTimerSnapshot(msg.payload);
    if (msg.type === 'TRACKPULSE_STATUS' && msg.payload)     applyMusicState(msg.payload);
    if (msg.type === 'TRACKPULSE_ANNOUNCE' && msg.payload?.text) showAnnounceBanner(msg.payload.text);
    if (msg.type === 'CHAT_HISTORY' && Array.isArray(msg.payload)) msg.payload.forEach(cdPush);
    if (msg.type === 'CHAT_MESSAGE' && msg.payload) {
      if (msg.payload.platform === 'twitch')  cdSetTwitchState(true, '#Twitch');
      if (msg.payload.platform === 'youtube') cdSetYtState(true);
      cdPush(msg.payload, true);
    }
    if (msg.type === 'ALERT_EVENT' && msg.payload) efPrepend(msg.payload);
    if (msg.type === 'SCENEPILOT_EVENT' && msg.payload?.type === 'OBS_INPUT_VOLUME_CHANGED') {
      const { inputName, inputVolumeMul } = msg.payload.payload || {};
      // Only sync if the changed source is the one linked to TrackPulse,
      // and the user hasn't touched the slider in the last 1.5 s (avoid feedback loop).
      if (inputName && obsLinkedSource && inputName === obsLinkedSource
          && Date.now() - sliderLastTouch > 1500) {
        const v = Math.round(Number(inputVolumeMul) * 100);
        const slider = document.getElementById('np-vol');
        const lbl    = document.getElementById('np-vol-val');
        if (slider) slider.value = v;
        if (lbl)    lbl.textContent = `${v}%`;
      }
    }
  },
});

// ── Timer ─────────────────────────────────────────────────────────
function applyTimerSnapshot(s) {
  if (!s) return;
  timerState = s;
  const el = document.getElementById('timer-time');
  const elapsedMs = Number.isFinite(Number(s.elapsedMs))
    ? Number(s.elapsedMs)
    : Math.floor((Number(s.elapsed) || 0) * 1000);
  timerBaseElapsedMs = elapsedMs;
  timerSnapshotAt = Date.now();
  const formatted = formatMs(elapsedMs);
  el.textContent = formatted;

  const stateStr = s.state || 'idle';
  el.className = '';
  const pill = document.getElementById('state-pill');
  pill.className = 'state-pill';

  const badge = document.getElementById('timer-badge');

  if (stateStr === 'running') {
    el.classList.add('running');
    pill.classList.add('running');
    pill.textContent = t('controldeck.timer.running');
    badge.textContent = t('controldeck.timer.running');
    badge.className = 'card-badge ok';
  } else if (stateStr === 'paused') {
    el.classList.add('paused');
    pill.classList.add('paused');
    pill.textContent = t('controldeck.timer.paused');
    badge.textContent = t('controldeck.timer.paused');
    badge.className = 'card-badge warn';
  } else if (stateStr === 'finished') {
    el.classList.add('finished');
    pill.classList.add('finished');
    pill.textContent = t('controldeck.timer.finished');
    badge.textContent = t('controldeck.timer.finished');
    badge.className = 'card-badge ok';
  } else {
    pill.textContent = t('controldeck.timer.ready');
    badge.textContent = t('controldeck.timer.ready');
    badge.className = 'card-badge warn';
  }

  // Profile name
  const profileEl = document.getElementById('timer-profile');
  const profileName = s.profile?.game || s.profile?.id || s.profileName || '';
  profileEl.textContent = profileName || t('controldeck.timer.no_profile');

  // Start button label
  const btnStart = document.getElementById('btn-start');
  if (stateStr === 'running') {
    btnStart.textContent = t('controldeck.timer.btn_split');
    btnStart.onclick = () => timerAction('split');
  } else if (stateStr === 'paused') {
    btnStart.textContent = t('controldeck.timer.btn_resume');
    btnStart.onclick = () => timerAction('resume');
  } else {
    btnStart.textContent = t('controldeck.timer.btn_start');
    btnStart.onclick = () => timerAction('start');
  }

  // Current split name
  const splits = s.segments || s.splits || [];
  const idx = Number.isInteger(s.currentSplit) ? s.currentSplit : (s.currentSplitIndex ?? -1);
  const splitEl = document.getElementById('split-name');
  if (idx >= 0 && splits[idx]) {
    splitEl.textContent = `#${idx + 1} — ${splits[idx].name}`;
  } else if (stateStr === 'finished') {
    splitEl.textContent = t('controldeck.split.finished');
  } else {
    splitEl.textContent = s.profileName ? t('controldeck.split.ready') : '—';
  }

  // Attempts + live delta
  const attEl   = document.getElementById('timer-attempts');
  const deltaEl = document.getElementById('timer-delta');
  if (attEl) {
    const attempts = s.attempts ?? s.attempt ?? null;
    attEl.textContent = attempts != null
      ? t(attempts === 1 ? 'controldeck.timer.attempt' : 'controldeck.timer.attempts', { n: attempts })
      : '';
  }
  if (deltaEl) {
    const delta = typeof s.liveDelta === 'number' ? s.liveDelta : null;
    if (delta !== null && stateStr === 'running') {
      const sign = delta >= 0 ? '+' : '';
      deltaEl.textContent  = `${sign}${delta.toFixed(2)}s`;
      deltaEl.className    = `timer-delta ${delta > 0 ? 'behind' : 'ahead'}`;
    } else {
      deltaEl.textContent = '';
      deltaEl.className   = 'timer-delta';
    }
  }
}

function renderLiveTimerTick() {
  if (!timerState) return;
  const el = document.getElementById('timer-time');
  if (!el) return;
  const stateStr = timerState.state || 'idle';
  let ms = timerBaseElapsedMs;
  if (stateStr === 'running') {
    ms += Math.max(0, Date.now() - timerSnapshotAt);
  }
  el.textContent = formatMs(ms);
}

function formatMs(ms) {
  if (ms < 0) ms = 0;
  const h  = Math.floor(ms / 3600000);
  const m  = Math.floor((ms % 3600000) / 60000);
  const s  = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  const cc = String(cs).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}.${cc}0` : `${mm}:${ss}.${cc}0`;
}

async function timerAction(action) {
  try {
    const d = await safeJson(`/api/timer/${action}`, { method: 'POST' });
    if (d.state) applyTimerSnapshot(d.state);
  } catch (e) { console.error('timer action failed', e); }
}

// ── OBS Controls ──────────────────────────────────────────────────
function formatDuration(ms) {
  if (!ms || ms <= 0) return '';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${ss}`;
  return `${String(m).padStart(2,'0')}:${ss}`;
}

function updateObsCtrlBar({ connected, streaming, recording, recordPaused, streamMs, recordMs, fps, virtualCam = false, cpu = 0, ram = 0, droppedFrames = 0, totalFrames = 0 }) {
  isStreaming    = streaming;
  isRecording    = recording;
  isRecordPaused = recordPaused;
  isVirtualCam   = virtualCam;

  const get = id => document.getElementById(id);

  const streamBtn = get('stream-btn');
  if (streamBtn) {
    streamBtn.disabled = !connected;
    streamBtn.classList.toggle('streaming', streaming);
    get('stream-dot').classList.toggle('active', streaming);
    get('stream-label').textContent = streaming ? t('controldeck.stream.stop') : t('controldeck.stream.start');
    get('stream-time').textContent  = formatDuration(streamMs);
  }

  const recordBtn = get('record-btn');
  if (recordBtn) {
    recordBtn.disabled = !connected;
    recordBtn.classList.toggle('recording', recording && !recordPaused);
    get('record-dot').classList.toggle('active', recording && !recordPaused);
    get('record-label').textContent = recording ? t('controldeck.record.stop') : t('controldeck.record.start');
    get('record-time').textContent  = formatDuration(recordMs);
    const pauseBtn = get('record-pause-btn');
    if (pauseBtn) {
      pauseBtn.style.display = recording ? '' : 'none';
      pauseBtn.textContent   = recordPaused ? '▶' : '⏸';
      pauseBtn.title = recordPaused ? t('controldeck.record.resume') : t('controldeck.record.pause');
    }
  }

  // Stats panel
  const fpsEl     = get('ctrl-fps');
  const cpuEl     = get('ctrl-cpu');
  const ramEl     = get('ctrl-ram');
  const droppedEl = get('ctrl-dropped');

  if (fpsEl) {
    fpsEl.textContent = connected && fps > 0 ? String(Math.round(fps)) : '—';
    fpsEl.className = 'obs-stat-val';
  }
  if (cpuEl) {
    cpuEl.textContent = connected && cpu > 0 ? `${cpu.toFixed(1)}%` : '—';
    cpuEl.className = `obs-stat-val${cpu > 80 ? ' warn' : ''}`;
  }
  if (ramEl) {
    ramEl.textContent = connected && ram > 0 ? `${(ram / 1024).toFixed(1)}G` : '—';
    ramEl.className = 'obs-stat-val';
  }
  if (droppedEl) {
    const pct = totalFrames > 0 ? (droppedFrames / totalFrames) * 100 : 0;
    droppedEl.textContent = connected && totalFrames > 0 ? `${pct.toFixed(1)}%` : '—';
    droppedEl.className = `obs-stat-val${pct > 1 ? ' warn' : pct === 0 && connected ? ' ok' : ''}`;
  }

  const vcamBtn = get('vcam-btn');
  if (vcamBtn) {
    vcamBtn.disabled = !connected;
    vcamBtn.classList.toggle('streaming', virtualCam);
    get('vcam-dot').classList.toggle('active', virtualCam);
    get('vcam-label').textContent = virtualCam ? t('controldeck.vcam.active') : t('controldeck.vcam.label');
  }
}

async function toggleStream() {
  if (!obsConnected) return;
  const next = !isStreaming;
  if (isStreaming && !confirm(t('controldeck.stream.confirm_stop'))) return;
  isStreaming = next;
  document.getElementById('stream-btn').classList.toggle('streaming', next);
  document.getElementById('stream-dot').classList.toggle('active', next);
  document.getElementById('stream-label').textContent = next ? t('controldeck.stream.stop') : t('controldeck.stream.start');
  if (!next) document.getElementById('stream-time').textContent = '';
  try {
    await safeJson(`/api/scenepilot/stream/${next ? 'start' : 'stop'}`, { method: 'POST' });
  } catch (e) { console.error('toggleStream failed', e); }
}

async function toggleRecord() {
  if (!obsConnected) return;
  const next = !isRecording;
  if (isRecording && !confirm(t('controldeck.record.confirm_stop'))) return;
  isRecording = next;
  document.getElementById('record-btn').classList.toggle('recording', next);
  document.getElementById('record-dot').classList.toggle('active', next);
  document.getElementById('record-label').textContent = next ? t('controldeck.record.stop') : t('controldeck.record.start');
  document.getElementById('record-pause-btn').style.display = next ? '' : 'none';
  if (!next) document.getElementById('record-time').textContent = '';
  try {
    await safeJson(`/api/scenepilot/record/${next ? 'start' : 'stop'}`, { method: 'POST' });
  } catch (e) { console.error('toggleRecord failed', e); }
}

async function toggleRecordPause() {
  if (!obsConnected || !isRecording) return;
  const next = !isRecordPaused;
  isRecordPaused = next;
  const pauseBtn = document.getElementById('record-pause-btn');
  if (pauseBtn) { pauseBtn.textContent = next ? '▶' : '⏸'; pauseBtn.title = next ? t('controldeck.record.resume') : t('controldeck.record.pause'); }
  document.getElementById('record-dot').classList.toggle('active', !next);
  document.getElementById('record-btn').classList.toggle('recording', !next);
  try {
    await safeJson(`/api/scenepilot/record/${next ? 'pause' : 'resume'}`, { method: 'POST' });
  } catch (e) { console.error('toggleRecordPause failed', e); }
}

// ── Music ─────────────────────────────────────────────────────────
async function loadMusicState() {
  try {
    const [status, cfg] = await Promise.all([
      safeJson('/api/trackpulse/status'),
      safeJson('/api/trackpulse/config'),
    ]);

    const cfgPlayer = cfg?.player || {};
    if (status?.player) {
      status.player.loopMode = status.player.loopMode || cfgPlayer.loopMode || 'all';
      status.player.shuffle = (status.player.shuffle !== undefined)
        ? !!status.player.shuffle
        : !!cfgPlayer.shuffle;
    }

    if (Array.isArray(status.playlist)) playlist = status.playlist;
    playingIndex = status.player?.currentIndex ?? -1;
    isPlaying    = status.player?.state === 'playing';

    const savedVol = cfg?.player?.volume ?? 100;
    const volSlider = document.getElementById('np-vol');
    const volLabel  = document.getElementById('np-vol-val');
    if (volSlider) volSlider.value = savedVol;
    if (volLabel)  volLabel.textContent = `${savedVol}%`;

    // Sync slider to live OBS volume if a source is linked
    obsLinkedSource = (cfg?.obsPlayer?.sourceName || '').trim();
    if (obsLinkedSource) {
      try {
        const mul = await safeJson(`/api/scenepilot/input-volume/${encodeURIComponent(obsLinkedSource)}`);
        const obsVol = Math.round(Number(mul) * 100);
        if (volSlider) volSlider.value = obsVol;
        if (volLabel)  volLabel.textContent = `${obsVol}%`;
      } catch { /* OBS not connected — keep saved value */ }
    }

    applyMusicState(status);
  } catch (e) { console.error('music state load failed', e); }
}

function applyMusicState(s) {
  if (!s) return;
  musicState = s;
  if (Array.isArray(s.playlist)) playlist = s.playlist;
  const state   = s.player?.state || 'idle';
  isPlaying     = state === 'playing';
  playingIndex  = s.player?.currentIndex ?? -1;
  const lm      = s.player?.loopMode;
  musicLoopMode = (lm === 'none' || lm === 'single') ? lm : 'all';
  musicShuffle  = !!s.player?.shuffle;

  // Track info
  const ct     = s.currentTrack || {};
  const track  = playlist[playingIndex] ?? null;
  const title  = ct.title  || track?.title  || track?.filename || t('controldeck.no_playback');
  const artist = ct.artist || track?.artist || (track ? '—' : '—');

  document.getElementById('np-title').textContent  = title;
  document.getElementById('np-artist').textContent = artist;

  const artEl   = document.getElementById('np-art');
  const trackId = s.player?.currentTrackId;
  if (artEl) {
    if (trackId) {
      if (artEl.dataset.trackId !== trackId) {
        artEl.dataset.trackId = trackId;
        artEl.innerHTML = `<img src="/api/trackpulse/cover/${trackId}" alt="cover" onerror="this.parentNode.innerHTML='♪'">`;
      }
    } else if (artEl.dataset.trackId) {
      delete artEl.dataset.trackId;
      artEl.innerHTML = '♪';
    }
  }

  // Progress bar
  const dur = s.player?.mediaDuration || 0;
  const cur = s.player?.mediaCursor   || 0;
  const prog = document.getElementById('np-progress');
  if (prog) prog.style.width = dur > 0 ? `${Math.min(100,(cur/dur)*100).toFixed(1)}%` : '0%';
  const timeEl = document.getElementById('np-time');
  if (timeEl) timeEl.textContent = dur > 0 ? `${fmtSec(cur)} / ${fmtSec(dur)}` : '';

  const stateEl = document.getElementById('np-state');
  const badge   = document.getElementById('music-badge');
  const playBtn = document.getElementById('btn-play-pause');

  if (state === 'playing') {
    stateEl.textContent = '▶'; stateEl.className = 'np-state playing';
    badge.textContent = t('controldeck.music.playing'); badge.className = 'card-badge ok';
    playBtn.textContent = '⏸'; playBtn.title = t('controldeck.timer.pause');
  } else if (state === 'paused') {
    stateEl.textContent = '⏸'; stateEl.className = 'np-state';
    badge.textContent = t('controldeck.timer.paused'); badge.className = 'card-badge warn';
    playBtn.textContent = '▶'; playBtn.title = t('tunapilot.resume');
  } else {
    stateEl.textContent = '—'; stateEl.className = 'np-state';
    badge.textContent = t('controldeck.music.stopped'); badge.className = 'card-badge warn';
    playBtn.textContent = '▶'; playBtn.title = 'Play';
  }

  updateMusicModeButtons();
  renderPlaylist();
}

function fmtSec(s) {
  const t = Math.max(0, Math.round(s || 0));
  return `${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}`;
}

const LOOP_CYCLE = ['all', 'single', 'none'];
const LOOP_ICONS = { all: '↻ All', single: '🔂 1×', none: '→' };

function updateMusicModeButtons() {
  const shuffleBtn = document.getElementById('btn-shuffle');
  const loopBtn    = document.getElementById('btn-loop');
  if (shuffleBtn) {
    shuffleBtn.classList.toggle('toggle-on', musicShuffle);
    shuffleBtn.title = musicShuffle ? t('tunapilot.shuffle_on') : t('tunapilot.shuffle_off');
  }
  if (loopBtn) {
    loopBtn.textContent = LOOP_ICONS[musicLoopMode] || '↻';
    loopBtn.classList.toggle('toggle-on', musicLoopMode !== 'none');
    loopBtn.title = `Loop: ${musicLoopMode}`;
  }
}

async function setMusicPlayerSettings(patch) {
  const d = await safeJson('/api/trackpulse/config', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player: {
      loopMode: patch.loopMode !== undefined ? patch.loopMode : musicLoopMode,
      shuffle:  patch.shuffle  !== undefined ? !!patch.shuffle  : musicShuffle,
    }}),
  });
  const lm = d?.player?.loopMode;
  musicLoopMode = (lm === 'none' || lm === 'single') ? lm : 'all';
  musicShuffle  = !!d?.player?.shuffle;
  updateMusicModeButtons();
}

async function toggleMusicShuffle() {
  try { await setMusicPlayerSettings({ shuffle: !musicShuffle }); await loadMusicState(); }
  catch (e) { console.error('toggle shuffle failed', e); }
}

async function toggleMusicLoop() {
  const next = LOOP_CYCLE[(LOOP_CYCLE.indexOf(musicLoopMode) + 1) % LOOP_CYCLE.length];
  try { await setMusicPlayerSettings({ loopMode: next }); await loadMusicState(); }
  catch (e) { console.error('toggle loop failed', e); }
}

// ── Volume slider ─────────────────────────────────────────────────
let volTimer            = null;
let obsLinkedSource     = '';   // OBS input name linked via TrackPulse obsPlayer config
let sliderLastTouch     = 0;    // timestamp of last user interaction with the vol slider
function initVolumeSlider() {
  const slider = document.getElementById('np-vol');
  if (!slider) return;
  slider.addEventListener('input', e => {
    const v = Number(e.target.value);
    sliderLastTouch = Date.now();
    const lbl = document.getElementById('np-vol-val');
    if (lbl) lbl.textContent = `${v}%`;
    clearTimeout(volTimer);
    volTimer = setTimeout(async () => {
      try {
        await safeJson('/api/trackpulse/player/volume', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ volume: v }),
        });
      } catch { /* non-fatal */ }
    }, 200);
  });
}

// ── Named Playlist Switcher ───────────────────────────────────────
async function loadNamedPlaylists() {
  try {
    const r = await safeJson('/api/trackpulse/named-playlists');
    namedPlaylists = r.namedPlaylists || [];
  } catch { namedPlaylists = []; }
  renderNamedPlaylistSwitcher();
}

function renderNamedPlaylistSwitcher() {
  const section = document.getElementById('pl-switcher');
  const list    = document.getElementById('pl-switch-list');
  if (!section || !list) return;
  if (!namedPlaylists.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  list.innerHTML = namedPlaylists.map(p => `
    <button class="pl-switch-btn${activePlaylistId === p.id ? ' active' : ''}" onclick="switchToPlaylist('${escHtml(p.id)}')">
      <span class="pl-switch-name">${escHtml(p.name)}</span>
      <span class="pl-switch-count">${(p.tracks || []).length}</span>
    </button>
  `).join('');
}

async function switchToPlaylist(id) {
  const pl = namedPlaylists.find(p => p.id === id);
  if (!pl) return;
  const wasPlaying = isPlaying;
  try {
    await safeJson('/api/trackpulse/playlist/clear', { method: 'POST' });
    await safeJson('/api/trackpulse/playlist/add-many', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: (pl.tracks || []).map(tr => tr.path) }),
    });
    activePlaylistId = id;
    renderNamedPlaylistSwitcher();
    if (wasPlaying) {
      const d = await safeJson('/api/trackpulse/player/play', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index: 0 }),
      });
      if (d.status) applyMusicState(d.status);
    } else {
      await loadMusicState();
    }
  } catch (e) { console.error('playlist switch failed', e); }
}

function renderPlaylist() {
  const el = document.getElementById('mini-playlist');
  if (!playlist.length) {
    el.innerHTML = `<div class="empty-hint">${t('controldeck.no_tracks')}</div>`;
    return;
  }
  el.innerHTML = playlist.map((t, i) => {
    const active = i === playingIndex;
    const title  = t.title || t.filename || t.path?.split(/[\\/]/).pop() || `Track ${i+1}`;
    return `<div class="playlist-item ${active ? 'active' : ''}" onclick="playTrack(${i})">
      <span class="pi-num">${i + 1}</span>
      <span class="pi-title">${escHtml(title)}</span>
      ${active ? '<span class="pi-playing">▶</span>' : ''}
    </div>`;
  }).join('');
}

async function togglePlayPause() {
  try {
    if (isPlaying) {
      const d = await safeJson('/api/trackpulse/player/pause', { method: 'POST' });
      if (d.status) applyMusicState(d.status);
    } else if (musicState?.player?.state === 'paused') {
      const d = await safeJson('/api/trackpulse/player/resume', { method: 'POST' });
      if (d.status) applyMusicState(d.status);
    } else {
      const idx = playingIndex >= 0 ? playingIndex : 0;
      const d = await safeJson('/api/trackpulse/player/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index: idx }),
      });
      if (d.status) applyMusicState(d.status);
    }
  } catch (e) { console.error('play/pause failed', e); }
}

async function musicAction(action) {
  try {
    const d = await safeJson(`/api/trackpulse/player/${action}`, { method: 'POST' });
    if (d.status) {
      playlist = d.status.playlist || playlist;
      applyMusicState(d.status);
    }
  } catch (e) { console.error('music action failed', e); }
}

async function playTrack(index) {
  try {
    const d = await safeJson('/api/trackpulse/player/play', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index }),
    });
    if (d.status) {
      playlist = d.status.playlist || playlist;
      applyMusicState(d.status);
    }
  } catch (e) { console.error('play track failed', e); }
}

// ── OBS Scenes + Stats ───────────────────────────────────────────
async function loadObsData() {
  try {
    const s = await safeJson('/api/scenepilot/status');
    obsConnected = s.connected === true;
    updateObsPill(obsConnected);

    if (obsConnected) {
      document.getElementById('scenes-badge').textContent = t('obs.status.connected');
      document.getElementById('scenes-badge').className   = 'card-badge ok';
      document.getElementById('scenes-manage-btn').style.display = '';

      const [scenesData, currentData, cfg] = await Promise.all([
        safeJson('/api/scenepilot/scenes'),
        safeJson('/api/scenepilot/current-scene'),
        safeJson('/api/scenepilot/config'),
      ]);
      hiddenScenes = Array.isArray(cfg.hiddenScenes) ? cfg.hiddenScenes : [];
      scenes = (scenesData || []).map(sc => sc.sceneName).filter(Boolean);
      const current = currentData.currentScene || '';
      document.getElementById('obs-current-scene').textContent = current ? t('controldeck.obs_scene_active', { scene: current }) : '';
      renderScenes(scenes, current);

      // OBS stats (streaming status, record status, FPS)
      try {
        const stats     = await safeJson('/api/scenepilot/obs-stats');
        const streaming = stats.outputActive || false;
        updateObsCtrlBar({
          connected:     true,
          streaming:     streaming,
          recording:     stats.recordActive            || false,
          recordPaused:  stats.recordPaused            || false,
          streamMs:      stats.outputDuration          || 0,
          recordMs:      stats.recordDuration          || 0,
          virtualCam:    stats.virtualCamActive        || false,
          fps:           stats.activeFps               || 0,
          cpu:           stats.cpuUsage                || 0,
          ram:           stats.memoryUsage             || 0,
          droppedFrames: stats.outputSkippedFrames     || 0,
          totalFrames:   stats.outputTotalFrames       || 0,
        });
      } catch { /* stats endpoint optional */ }
    } else {
      renderScenes([], '');
      updateObsCtrlBar({ connected: false, streaming: false, recording: false, recordPaused: false, streamMs: 0, recordMs: 0, fps: 0, virtualCam: false });
    }
  } catch (e) { console.error('obs data load failed', e); }
}

// ── EventForge ────────────────────────────────────────────
async function loadEventForgeState() {
  try {
    const state = await safeJson('/api/alertdeck/labels');
    applyEventForgeState(state);
  } catch (e) {
    console.error('eventforge labels load failed', e);
    document.getElementById('ef-badge').textContent = t('controldeck.badge.offline');
    document.getElementById('ef-badge').className = 'card-badge err';
  }

  // Always attempt backfill on load (once per session)
  if (!efBackfillTried) {
    efBackfillTried = true;
    try { await safeJson('/api/platforms/twitch/backfill', { method: 'POST' }); } catch {}
  }

  try {
    const histData = await safeJson('/api/alertdeck/history?limit=200');
    if (Array.isArray(histData.history)) {
      efEntries = histData.history.map(normalizeEfItem);
      renderEventForgeFeed();
    }
  } catch (_) { /* history not available yet */ }
}

function normalizeEfItem(raw) {
  return {
    id: String(raw.id || raw.ts || Date.now()),
    platform: String(raw.platform || 'chat').toLowerCase(),
    author: String(raw.author || '').trim(),
    eventType: String(raw.eventType || '').toLowerCase(),
    text: String(raw.text || '').trim(),
    amount: String(raw.amount || '').trim(),
    viewers: String(raw.viewers || '').trim(),
    time: new Date(Number(raw.ts) || Date.now()),
  };
}

function efPrepend(raw) {
  const item = normalizeEfItem(raw);
  // Deduplicate
  if (efEntries.some(e => e.id === item.id)) return;
  efEntries.unshift(item);
  if (efEntries.length > EF_MAX_ENTRIES) efEntries.splice(EF_MAX_ENTRIES);
  renderEventForgeFeed();
  const firstItem = document.querySelector('#ef-feed .alert-item');
  if (firstItem) {
    firstItem.classList.add('alert-item-new');
    firstItem.addEventListener('animationend', () => firstItem.classList.remove('alert-item-new'), { once: true });
  }
  // Also update counters/badge
  loadEfCounters();
}

async function loadEfCounters() {
  try {
    const state = await safeJson('/api/alertdeck/labels');
    applyEventForgeState(state);
  } catch {}
}

function applyEventForgeState(state) {
  const counts = state?.counts || {};
  const latest = state?.latest || {};
  const lastTs = Number(state?.lastTs || 0);

  document.getElementById('ef-total').textContent = String(counts.total || 0);
  document.getElementById('ef-twitch').textContent = String(counts.twitch || 0);
  document.getElementById('ef-youtube').textContent = String(counts.youtube || 0);
  document.getElementById('ef-latest').textContent = latest.any || t('controldeck.no_alerts');

  const badge = document.getElementById('ef-badge');
  if (!lastTs) {
    badge.textContent = t('controldeck.timer.ready');
    badge.className = 'card-badge warn';
  } else if (Date.now() - lastTs < 10 * 60 * 1000) {
    badge.textContent = t('badge.active');
    badge.className = 'card-badge ok';
  } else {
    badge.textContent = t('controldeck.badge.still');
    badge.className = 'card-badge warn';
  }
}

function formatAlertDescription(item) {
  const et = item.eventType;
  const author = escHtml(item.author || item.text || '?');
  if (et === 'raid')      return item.viewers ? t('controldeck.alert.raid_viewers', { author, viewers: item.viewers }) : t('controldeck.alert.raid', { author });
  if (et === 'sub')       return t('controldeck.alert.sub', { author });
  if (et === 'resub')     return t('controldeck.alert.resub', { author });
  if (et === 'subgift')   return t('controldeck.alert.subgift', { author });
  if (et === 'bits')      return item.amount ? t('controldeck.alert.bits_amount', { author, amount: escHtml(item.amount) }) : t('controldeck.alert.bits', { author });
  if (et === 'follow' || et === 'follower') return t('controldeck.alert.follow', { author });
  if (et === 'donation')  return item.amount ? t('controldeck.alert.donation_amount', { author, amount: escHtml(item.amount) }) : t('controldeck.alert.donation', { author });
  if (et === 'superchat') return item.amount ? `${author} (${escHtml(item.amount)})` : author;
  if (et === 'membership') return t('controldeck.alert.membership', { author });
  return item.author ? escHtml(item.text || item.author) : escHtml(item.text);
}

function renderEventForgeFeed() {
  const feed = document.getElementById('ef-feed');
  const empty = document.getElementById('ef-empty');
  document.getElementById('ef-count').textContent = t('controldeck.eventforge.count', { count: efEntries.length });
  if (!efEntries.length) {
    feed.innerHTML = '';
    feed.appendChild(empty);
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  const platformClass = p => p === 'twitch' ? 'twitch' : p === 'youtube' ? 'youtube' : 'other';
  const etLabel = et => et ? et.charAt(0).toUpperCase() + et.slice(1) : 'Alert';
  feed.innerHTML = efEntries.map(item => `
    <div class="alert-item">
      <div class="alert-item-time">${item.time.toLocaleString(i18n.getLang(), {
        day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'
      })}</div>
      <div class="alert-item-row">
        <span class="alert-platform-badge ${platformClass(item.platform)}"></span>
        <span class="alert-event-type">${etLabel(item.eventType)}</span>
        <span class="alert-item-text" style="margin:0">${formatAlertDescription(item)}</span>
      </div>
    </div>
  `).join('');
}

let _renderedSceneList = []; // tracks last fully rendered list for diff

function renderScenes(sceneList, active) {
  if (active !== undefined) currentScene = active;
  if (sceneList) scenes = sceneList;

  const el = document.getElementById('scene-grid');
  const visible = scenes.filter(n => !hiddenScenes.includes(n));

  if (!visible.length) {
    _renderedSceneList = [];
    const allHidden = scenes.length > 0 && visible.length === 0;
    el.innerHTML = allHidden
      ? `<div class="empty-hint">${t('controldeck.scenes.all_hidden_label')} — <button class="btn xs" onclick="toggleSceneManage()" style="margin-left:4px">${t('controldeck.scenes.manage')}</button></div>`
      : (obsConnected
        ? `<div class="empty-hint">${t('controldeck.no_scenes_found')}</div>`
        : `<div class="empty-hint">${t('controldeck.no_scenes')}</div>`);
    return;
  }

  // If only the active scene changed, skip full re-render to avoid thumbnail flicker
  const sameList = _renderedSceneList.length === visible.length &&
    visible.every((n, i) => n === _renderedSceneList[i]);

  if (sameList) {
    el.querySelectorAll('.scene-btn').forEach(btn => {
      const label = btn.querySelector('.scene-btn-label');
      btn.classList.toggle('active', label?.textContent === currentScene);
    });
    return;
  }

  _renderedSceneList = [...visible];
  el.innerHTML = visible.map(name =>
    `<button class="scene-btn ${name === currentScene ? 'active' : ''}" onclick="switchScene('${escHtml(name)}')">${escHtml(name)}</button>`
  ).join('');
}

async function switchScene(name) {
  try {
    await safeJson('/api/scenepilot/scene', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene: name }),
    });
    currentScene = name;
    document.querySelectorAll('.scene-btn').forEach(b => {
      b.classList.toggle('active', b.textContent === name);
    });
  } catch (e) { console.error('switch scene failed', e); }
}

// ── Scene visibility management ──────────────────────────────────
const _EYE_ON  = `<svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 7s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z"/><circle cx="7" cy="7" r="1.8"/></svg>`;
const _EYE_OFF = `<svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.5 2.5l-11 11M5.1 5.2A3.5 3.5 0 0 0 4 7s1 3 3 3a3.4 3.4 0 0 0 1.8-.5M7 4a3 3 0 0 1 3 3 3 3 0 0 1-.2 1M1 7s1.2-2 3.2-3.2M10 4C11.5 5 13 7 13 7s-2.5 4-6 4"/></svg>`;

function toggleSceneManage() {
  sceneManageMode = !sceneManageMode;
  const btn   = document.getElementById('scenes-manage-btn');
  const panel = document.getElementById('scene-manage-panel');
  const grid  = document.getElementById('scene-grid');
  if (sceneManageMode) {
    btn.innerHTML   = `<svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7.5l3.5 3.5L12 3"/></svg> ${t('controldeck.scenes.done')}`;
    grid.style.display  = 'none';
    panel.style.display = '';
    renderSceneManageList();
  } else {
    btn.innerHTML   = `<svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="1.5"/><path d="M1 7s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z"/></svg> ${t('controldeck.scenes.manage')}`;
    panel.style.display = 'none';
    grid.style.display  = '';
    renderScenes();
  }
}

function renderSceneManageList() {
  const list = document.getElementById('scene-manage-list');
  if (!scenes.length) {
    list.innerHTML = `<div class="empty-hint">${t('controldeck.no_scenes_loaded')}</div>`;
    return;
  }
  list.innerHTML = scenes.map(name => {
    const hidden = hiddenScenes.includes(name);
    return `<div class="scene-manage-row">
      <span class="scene-manage-name${hidden ? ' is-hidden' : ''}">${escHtml(name)}</span>
      <button class="scene-eye-btn${hidden ? ' is-hidden' : ''}" onclick="toggleHideScene('${escHtml(name)}')" title="${hidden ? t('controldeck.scene_show') : t('controldeck.scene_hide')}">${hidden ? _EYE_OFF : _EYE_ON}</button>
    </div>`;
  }).join('');
}

async function toggleHideScene(name) {
  const idx = hiddenScenes.indexOf(name);
  if (idx >= 0) hiddenScenes.splice(idx, 1);
  else hiddenScenes.push(name);
  renderSceneManageList();
  try {
    await safeJson('/api/scenepilot/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hiddenScenes }),
    });
  } catch (e) { console.error('hiddenScenes save failed', e); }
}

function updateObsPill(connected) {
  const pill = document.getElementById('obs-pill');
  if (connected) {
    pill.className = 'obs-pill connected';
    pill.innerHTML = `<span class="obs-dot"></span> ${t('controldeck.obs_connected')}`;
  } else {
    pill.className = 'obs-pill';
    pill.innerHTML = `<span class="obs-dot"></span> ${t('controldeck.obs_disconnected')}`;
    document.getElementById('scenes-badge').textContent = t('controldeck.obs_disconnected');
    document.getElementById('scenes-badge').className   = 'card-badge warn';
  }
}

// ── Announce Banner ───────────────────────────────────────────────
let announceTimer = null;
function showAnnounceBanner(text) {
  const el = document.getElementById('announce-banner');
  if (!el) return;
  el.textContent = `🎵 ${text}`;
  el.classList.add('show');
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => el.classList.remove('show'), 5000);
}

// ── Init & polling ────────────────────────────────────────────────
const escHtml = esc;

// ── Chat integration ─────────────────────────────────────────────
function cdUid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`; }

function cdApplyHighlight(msg) {
  msg.hl = false; msg.hlColor = null;
  for (const kw of cdKeywords) {
    const hay = kw.caseSensitive ? msg.text : msg.text.toLowerCase();
    const pin = kw.caseSensitive ? kw.text  : kw.text.toLowerCase();
    if (hay.includes(pin)) { msg.hl = true; msg.hlColor = kw.color || '#02cda4'; break; }
  }
}

function cdHighlightText(escaped, kws) {
  let html = escaped;
  for (const kw of kws) {
    if (!kw.text) continue;
    const re = new RegExp(kw.text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), kw.caseSensitive ? 'g' : 'gi');
    html = html.replace(re, m => `<mark style="background:${kw.color}28;color:${kw.color}">${m}</mark>`);
  }
  return html;
}

function cdPush(raw, live = false) {
  if (raw?.id && cdMessages.some(m => m.id === raw.id)) return;
  const flash = live && (Date.now() - cdLastMessageAt >= 60_000);
  if (live) cdLastMessageAt = Date.now();
  const msg = {
    id: raw.id || cdUid(), platform: raw.platform,
    authorName: raw.authorName, authorColor: raw.authorColor,
    text: raw.text, time: raw.time ? new Date(raw.time) : (raw._time ? new Date(raw._time) : (raw.publishedAt ? new Date(raw.publishedAt) : new Date())),
    hl: false, hlColor: null,
    msgId: raw.msgId || '', userId: raw.userId || '', flash,
  };
  cdApplyHighlight(msg);
  cdMessages.push(msg);
  if (cdMessages.length > CD_MAX_MSG) cdMessages.splice(0, cdMessages.length - CD_MAX_MSG);
  cdRenderMessage(msg);
}

function cdRenderMessage(msg) {
  document.getElementById('cd-empty').style.display = 'none';
  const feed = document.getElementById('cd-feed');
  const el = document.createElement('div');
  el.className = `cmsg${msg.hl ? ' hl' : ''}`;
  const textHtml = cdHighlightText(escHtml(msg.text), cdKeywords);
  const modHtml = msg.platform === 'twitch'
    ? `<span class="cmod">
        <button class="cmod-btn"      title="Nachricht löschen" data-action="delete">✕</button>
        <button class="cmod-btn warn" title="Timeout 10 min"    data-action="timeout">⏱</button>
        <button class="cmod-btn err"  title="Bannen"            data-action="ban">🚫</button>
       </span>`
    : '';
  el.innerHTML = `
    <span class="cplat ${msg.platform}">${msg.platform === 'twitch' ? 'TW' : 'YT'}</span>
    <span class="cauthor" style="color:${escHtml(msg.authorColor)}">${escHtml(msg.authorName)}</span>
    <span class="ctext">${textHtml}</span>
    ${modHtml}`;
  if (msg.platform === 'twitch') {
    el.querySelectorAll('.cmod-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        cdModAction(btn.dataset.action, msg.msgId, msg.userId, el);
      });
    });
  }
  feed.appendChild(el);
  if (msg.flash) {
    el.classList.add('cmsg-new');
    el.addEventListener('animationend', () => el.classList.remove('cmsg-new'), { once: true });
  }
  if (!cdScrollLock) feed.scrollTop = feed.scrollHeight;
  document.getElementById('cd-msg-count').textContent = t('controldeck.chat.messages', { count: cdMessages.length });
}

async function cdModAction(action, msgId, userId, el) {
  try {
    const body = action === 'delete'  ? { msgId }
               : action === 'timeout' ? { userId, duration: 600 }
               :                        { userId };
    const r = await safeJson(`/api/chatdeck/twitch/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok && action === 'delete') el.classList.add('cmsg-deleted');
  } catch (e) { console.error('mod action failed', e); }
}

function cdSetTwitchState(on, label) {
  const pill = document.getElementById('cd-twitch-pill');
  document.getElementById('cd-twitch-label').textContent = label || (on ? 'Twitch' : 'Twitch');
  pill.className = `cpill twitch${on ? ' on' : ''}`;
}
function cdSetYtState(on) {
  const pill = document.getElementById('cd-yt-pill');
  pill.className = `cpill youtube${on ? ' on' : ''}`;
}

async function cdLoadPlatformStatus() {
  try {
    const status = await PlatformStatus.load();
    const tw = status.twitch || {}, yt = status.youtube || {};
    cdSetTwitchState(!!tw.connected, tw.channel ? `#${tw.channel}` : 'Twitch');
    if (!(yt.videoId)) cdSetYtState(false);
    return status;
  } catch {
    cdSetTwitchState(false, 'Twitch'); cdSetYtState(false); return null;
  }
}

async function cdPollYt() {
  try {
    const d = await safeJson('/api/chatdeck/youtube/poll');
    if (d.error && !d.messages?.length) { cdSetYtState(false); return; }
    if (d.liveChatId) cdSetYtState(true);
    for (const msg of (d.messages || [])) cdPush({ id: msg.id, platform:'youtube', authorName: msg.authorName, authorColor:'#ff4040', text: msg.text, _time: msg.publishedAt });
    if (d.pollingMs && cdYtPoll) { clearInterval(cdYtPoll); cdYtPoll = setInterval(cdPollYt, Math.max(d.pollingMs, 4000)); }
  } catch { cdSetYtState(false); }
}

async function cdInit() {
  try {
    const cfg = await safeJson('/api/chatdeck/config');
    cdKeywords = cfg.keywords || [];
    const status = await cdLoadPlatformStatus();
    if (status?.youtube?.videoId) {
      cdPollYt();
      cdYtPoll = setInterval(cdPollYt, 6000);
    }
  } catch(e) { console.error('cdInit failed', e); }
}

async function toggleVirtualCam() {
  if (!obsConnected) return;
  const next = !isVirtualCam;
  isVirtualCam = next;
  document.getElementById('vcam-btn').classList.toggle('streaming', next);
  document.getElementById('vcam-dot').classList.toggle('active', next);
  document.getElementById('vcam-label').textContent = next ? t('controldeck.vcam.active') : t('controldeck.vcam.label');
  try {
    await safeJson(`/api/scenepilot/virtualcam/${next ? 'start' : 'stop'}`, { method: 'POST' });
  } catch (e) { console.error('toggleVirtualCam failed', e); }
}

// ── Scene Preview ─────────────────────────────────────────────────
function refreshScenePreview() {
  const img      = document.getElementById('scene-preview-img');
  const offline  = document.getElementById('scene-preview-offline');
  if (!img) return;
  if (!obsConnected || !currentScene) {
    img.style.opacity     = '0';
    offline.style.display = '';
    return;
  }
  offline.style.display = 'none';
  img.style.opacity     = '1';
  img.src = `/api/scenepilot/screenshot/${encodeURIComponent(currentScene)}?_=${Date.now()}`;
}

async function init() {
  await i18n.ready();
  _wsClient.start();
  initVolumeSlider();

  // Initial timer state
  try {
    const s = await safeJson('/api/timer/state');
    applyTimerSnapshot(s);
  } catch {}

  await loadMusicState();
  await loadNamedPlaylists();
  await loadObsData();
  await loadEventForgeState();
  await cdInit();

  setInterval(renderLiveTimerTick, 100);

  // Scene preview — refresh current scene every 1.5 s
  setInterval(refreshScenePreview, 1500);

  // Poll every 3s for music + obs
  setInterval(async () => {
    await loadMusicState();
    await loadObsData();
    await loadEventForgeState();
    await cdLoadPlatformStatus();
  }, 3000);

  // Named playlists change rarely — refresh every 10s
  setInterval(loadNamedPlaylists, 10000);

  // Keyword sync every 30s — keeps highlighting in sync with ChatLink
  setInterval(async () => {
    try {
      const cfg = await safeJson('/api/chatdeck/config');
      if (Array.isArray(cfg.keywords)) {
        cdKeywords = cfg.keywords;
        // Re-apply highlights to existing messages
        cdMessages.forEach(m => cdApplyHighlight(m));
      }
    } catch { /* non-fatal */ }
  }, 30_000);
}

init();
