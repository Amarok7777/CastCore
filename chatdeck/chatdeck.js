// ── State ──────────────────────────────────────────────────────────
let allMessages     = [];
let keywords        = [];
let commands        = [];
let intervalMessages = [];
let intervalStatus   = {};
let filterPlatform  = 'all';
let scrollLocked    = false;
let twitchConnected = false;
let ytPolling       = null;
let cfg             = {};
let obsScenes       = [];
let ffFlows         = [];

// ── Local WebSocket (receives CHAT_MESSAGE from authManager) ───
const _localWsClient = createWsClient({
  onMessage(msg) {
    if (msg.type === 'CHAT_HISTORY' && Array.isArray(msg.payload)) msg.payload.forEach(pushMessage);
    if (msg.type === 'CHAT_MESSAGE' && msg.payload) pushMessage(msg.payload);
  },
});
function connectLocalWs() { _localWsClient.start(); }

// ── Init ───────────────────────────────────────────────────────────
async function init() {
  connectLocalWs();
  try {
    cfg = await safeJson('/api/chatdeck/config');
    applyConfig(cfg);
  } catch {}
  renderKeywords();
  renderCommands();
  renderIntervalList();
  loadIntervalStatus();
  setInterval(loadIntervalStatus, 30_000);
  try { await loadPlatformStatus(); } catch {}
  startPlatformStatusPolling();
  fetchObsScenes();
  fetchFlows();
}

async function fetchObsScenes() {
  try {
    const d = await safeJson('/api/scenepilot/scenes');
    obsScenes = Array.isArray(d) ? d : [];
  } catch { obsScenes = []; }
}

async function fetchFlows() {
  try {
    const d = await safeJson('/api/flowforge/flows');
    ffFlows = Array.isArray(d) ? d : [];
  } catch { ffFlows = []; }
}

function _applyPlatformStatus(status) {
  const tw = status.twitch || {}, yt = status.youtube || {};
  setTwitchState(!!tw.connected, tw);
  const ytReady = !!(yt.videoId);
  if (ytReady && !ytPolling) startYtPolling();
  if (!ytReady && ytPolling) stopYtPolling();
  if (!ytReady) setYtState(false, PlatformStatus.ytText(yt));
}
let stopPlatformPoll = null;
function loadPlatformStatus()         { return PlatformStatus.load().then(_applyPlatformStatus).catch(() => {}); }
function startPlatformStatusPolling() {
  if (stopPlatformPoll) stopPlatformPoll();
  stopPlatformPoll = PlatformStatus.poll(_applyPlatformStatus);
  window.addEventListener('beforeunload', () => stopPlatformPoll?.());
}

function applyConfig(c) {
  keywords         = c.keywords         || [];
  commands         = c.commands         || [];
  intervalMessages = c.intervalMessages || [];
}

async function saveKeywordsCommands() {
  cfg = await safeJson('/api/chatdeck/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywords, commands }),
  });
  // Re-highlight existing messages
  allMessages.forEach(m => applyHighlights(m));
  renderFeed();
}

// ── Twitch IRC ─────────────────────────────────────────────────────
// Twitch connection now managed centrally by authManager in Hub
// Chatdeck monitors status via /api/platforms endpoint

function setTwitchState(connected, tw = {}) {
  twitchConnected = connected;
  const pill = document.getElementById('twitch-pill');
  const text = document.getElementById('twitch-pill-text');
  if (connected) {
    if (pill) pill.classList.add('connected');
    if (text) text.textContent = tw.channel ? '#' + tw.channel : 'Twitch verbunden';
  } else {
    if (pill) pill.classList.remove('connected');
    const msg = tw.oauthLoggedIn && tw.channel ? tw.channel + ' (getrennt)'
              : tw.channel                     ? tw.channel + ' (kein OAuth)'
              : 'Twitch getrennt';
    if (text) text.textContent = msg;
  }
}

// ── YouTube polling ────────────────────────────────────────────────
function startYtPolling() {
  stopYtPolling();
  pollYt();
  ytPolling = setInterval(pollYt, 6000);
}

function stopYtPolling() {
  if (ytPolling) { clearInterval(ytPolling); ytPolling = null; }
  setYtState(false, null);
}

async function pollYt() {
  try {
    const d = await safeJson('/api/chatdeck/youtube/poll');
    if (d.error && !d.messages?.length) {
      setYtState(false, d.error);
      return;
    }
    if (d.liveChatId) setYtState(true, null);
    // Messages arrive via WebSocket CHAT_MESSAGE broadcast — no push here to avoid duplicates.
    // Adjust polling interval based on YouTube's recommendation (cap at 60 s to avoid long gaps).
    if (d.pollingMs && ytPolling) {
      clearInterval(ytPolling);
      ytPolling = setInterval(pollYt, Math.max(Math.min(d.pollingMs, 60000), 4000));
    }
  } catch (e) {
    setYtState(false, e.message);
  }
}

function setYtState(connected, errorMsg) {
  const pill = document.getElementById('yt-pill');
  const text = document.getElementById('yt-pill-text');
  if (connected) {
    if (pill) pill.classList.add('connected');
    if (text) text.textContent = 'YouTube live';
  } else {
    if (pill) pill.classList.remove('connected');
    if (text) text.textContent = errorMsg ? `YT: ${errorMsg.slice(0, 30)}` : 'YouTube getrennt';
  }
}

// ── Message pipeline ───────────────────────────────────────────────
function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function pushMessage(raw) {
  if (raw?.id && allMessages.some(m => m.id === raw.id)) return;
  const msg = {
    id:          raw.id || uid(),
    platform:    raw.platform,
    authorName:  String(raw.authorName || 'Unknown'),
    authorColor: String(raw.authorColor || '#ffffff'),
    text:        String(raw.text || ''),
    time:        raw.time ? new Date(raw.time) : (raw._time ? new Date(raw._time) : (raw.publishedAt ? new Date(raw.publishedAt) : new Date())),
    highlighted: false,
    isCommand:   false,
    matchedColor: null,
    matchedKeyword: null,
    matchedCaseSensitive: false,
  };
  applyHighlights(msg);
  checkCommands(msg);

  const maxMsg = cfg?.display?.maxMessages || 200;
  allMessages.push(msg);
  if (allMessages.length > maxMsg) allMessages.splice(0, allMessages.length - maxMsg);

  // Check if we should show empty placeholder
  document.getElementById('chat-empty').style.display = 'none';

  appendMessageToFeed(msg);
}

function applyHighlights(msg) {
  msg.highlighted = false;
  msg.matchedColor = null;
  msg.matchedKeyword = null;
  msg.matchedCaseSensitive = false;
  for (const kw of keywords) {
    const keywordText = String(kw?.text || '').trim();
    if (!keywordText) continue;
    const pattern = kw.caseSensitive
      ? keywordText
      : keywordText.toLowerCase();
    const haystack = kw.caseSensitive ? msg.text : msg.text.toLowerCase();
    if (haystack.includes(pattern)) {
      msg.highlighted = true;
      msg.matchedColor = kw.color || '#02cda4';
      msg.matchedKeyword = keywordText;
      msg.matchedCaseSensitive = !!kw.caseSensitive;
      break;
    }
  }
}

function checkCommands(msg) {
  const lower = String(msg.text || '').trim().toLowerCase();
  for (const cmd of commands) {
    if (!cmd.trigger) continue;
    const trigger = cmd.trigger.trim().toLowerCase();
    if (lower === trigger || lower.startsWith(trigger + ' ')) {
      msg.isCommand = true;
      executeCommandAction(cmd, msg);
      break;
    }
  }
}

async function executeCommandAction(cmd, msg) {
  if (!cmd.action || cmd.action === 'none') return;
  const post = (url, body) => safeJson(url, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  try {
    switch (cmd.action) {
      case 'obs-scene':
        if (cmd.actionParam) await post('/api/scenepilot/scene', { scene: cmd.actionParam }); break;
      case 'obs-record-start':
        await post('/api/scenepilot/record/start'); break;
      case 'obs-record-stop':
        await post('/api/scenepilot/record/stop'); break;
      case 'timer-start':
        await post('/api/timer/start'); break;
      case 'timer-split':
        await post('/api/timer/split'); break;
      case 'timer-pause':
        await post('/api/timer/pause'); break;
      case 'timer-reset':
        await post('/api/timer/reset'); break;
      case 'trackpulse-song':
        await safeJson('/api/trackpulse/announce'); break;
      case 'trackpulse-next':
        await post('/api/trackpulse/player/next'); break;
      case 'trackpulse-play':
        await post('/api/trackpulse/player/play'); break;
      case 'trackpulse-pause':
        await post('/api/trackpulse/player/pause'); break;
      case 'alert-trigger':
        await post('/api/alertdeck/inject', { eventType: 'custom', platform: msg.platform || 'twitch', author: msg.authorName, text: cmd.actionParam || '' }); break;
      case 'flowforge-run':
        if (cmd.actionParam) await post(`/api/flowforge/flows/${encodeURIComponent(cmd.actionParam)}/run`); break;
      case 'chat-reply':
        if (cmd.actionParam) await post('/api/chatdeck/twitch/send', { message: cmd.actionParam }); break;
    }
  } catch (e) { console.error('command action failed', e); }
}

// ── Render ─────────────────────────────────────────────────────────
function appendMessageToFeed(msg) {
  const visible = isVisible(msg);
  if (!visible) return;

  const feed = document.getElementById('chat-feed');
  const el = buildMsgEl(msg);
  feed.appendChild(el);

  if (!scrollLocked) feed.scrollTop = feed.scrollHeight;

  // Update count
  updateCount();
}

function buildMsgEl(msg) {
  const el = document.createElement('div');
  el.className = `chat-msg ${msg.highlighted ? 'highlighted' : ''} ${msg.isCommand ? 'command-msg' : ''}`;
  el.dataset.id = msg.id;

  const searchTerm = document.getElementById('filter-search')?.value?.toLowerCase() || '';

  const timeStr = msg.time.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const textHtml = highlightText(escHtml(msg.text), msg, searchTerm);

  el.innerHTML = `
    <span class="msg-platform ${msg.platform}">${msg.platform === 'twitch' ? 'TW' : 'YT'}</span>
    <span class="msg-time">${timeStr}</span>
    <span class="msg-author" style="color:${escHtml(msg.authorColor)}">${escHtml(msg.authorName)}</span>
    <span class="msg-text">${textHtml}</span>
  `;
  return el;
}

function highlightText(escapedText, msg, searchTerm) {
  let html = escapedText;
  // Highlight only the actually matched keyword for this message.
  // This keeps the render path cheap and avoids pathological regex/replacement work.
  if (msg?.matchedKeyword) {
    const keywordText = escHtml(msg.matchedKeyword);
    const keywordColor = msg.matchedColor || '#02cda4';
    const re = new RegExp(escRegex(keywordText), msg.matchedCaseSensitive ? 'g' : 'gi');
    html = html.replace(re, m => `<mark style="background:${keywordColor}22;color:${keywordColor}">${m}</mark>`);
  }
  // Highlight search
  if (searchTerm) {
    const re = new RegExp(escRegex(escHtml(searchTerm)), 'gi');
    html = html.replace(re, m => `<mark>${m}</mark>`);
  }
  return html;
}

function renderFeed() {
  const feed = document.getElementById('chat-feed');
  const searchTerm = document.getElementById('filter-search').value.toLowerCase();
  const visible = allMessages.filter(isVisible);

  if (visible.length === 0) {
    feed.innerHTML = '';
    document.getElementById('chat-empty').style.display = '';
    feed.appendChild(document.getElementById('chat-empty'));
    document.getElementById('chat-empty').style.display = 'flex';
  } else {
    document.getElementById('chat-empty').style.display = 'none';
    feed.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const msg of visible) frag.appendChild(buildMsgEl(msg));
    feed.appendChild(frag);
    if (!scrollLocked) feed.scrollTop = feed.scrollHeight;
  }
  updateCount();
}

function isVisible(msg) {
  if (filterPlatform !== 'all' && msg.platform !== filterPlatform) return false;
  const s = document.getElementById('filter-search')?.value?.toLowerCase() || '';
  if (s && !msg.text.toLowerCase().includes(s) && !msg.authorName.toLowerCase().includes(s)) return false;
  return true;
}

function updateCount() {
  const visible = allMessages.filter(isVisible).length;
  document.getElementById('msg-count').textContent = t('chatdeck.messages', {count: visible, total: allMessages.length});
}

function clearChat() {
  allMessages = [];
  renderFeed();
}

function setFilter(platform) {
  filterPlatform = platform;
  document.querySelectorAll('.filter-btn').forEach(b => {
    b.className = 'filter-btn';
  });
  document.getElementById(`filter-${platform}`).classList.add(`active-${platform}`);
  renderFeed();
}

function toggleScrollLock() {
  scrollLocked = !scrollLocked;
  const btn = document.getElementById('btn-scroll-lock');
  btn.textContent = scrollLocked ? t('chatdeck.scroll_locked') : t('chatdeck.scroll_auto');
  btn.style.color = scrollLocked ? '#ffb26b' : '';
  if (!scrollLocked) {
    const feed = document.getElementById('chat-feed');
    feed.scrollTop = feed.scrollHeight;
  }
}

// ── Keywords ───────────────────────────────────────────────────────
function renderKeywords() {
  const el = document.getElementById('keyword-list');
  if (!keywords.length) {
    el.innerHTML = '<div style="font-size:12px;color:rgba(243,249,248,0.3);text-align:center;padding:8px 0">Keine Keywords</div>';
    return;
  }
  el.innerHTML = keywords.map((kw, i) => `
    <div class="keyword-item">
      <span class="keyword-swatch" style="background:${escHtml(kw.color)}"></span>
      <span class="keyword-text">${escHtml(kw.text)}</span>
      <button class="keyword-del" onclick="removeKeyword(${i})" title="Löschen">×</button>
    </div>
  `).join('');
}

function addKeyword() {
  const text  = document.getElementById('new-kw-text').value.trim();
  const color = document.getElementById('new-kw-color').value;
  if (!text) return;
  keywords.push({ id: uid(), text, color, caseSensitive: false });
  document.getElementById('new-kw-text').value = '';
  renderKeywords();
  saveKeywordsCommands();
}

function removeKeyword(i) {
  keywords.splice(i, 1);
  renderKeywords();
  saveKeywordsCommands();
}

// ── Commands ───────────────────────────────────────────────────────
const ACTION_NO_PARAM = new Set([
  'none', 'obs-record-start', 'obs-record-stop',
  'timer-start', 'timer-split', 'timer-pause', 'timer-reset',
  'trackpulse-song', 'trackpulse-next', 'trackpulse-play', 'trackpulse-pause',
]);

function updateCmdParam() {
  const action = document.getElementById('new-cmd-action').value;
  const row    = document.getElementById('cmd-param-row');

  if (ACTION_NO_PARAM.has(action)) {
    row.style.display = 'none';
    row.innerHTML = '';
    return;
  }

  row.style.display = 'flex';

  if (action === 'obs-scene') {
    if (obsScenes.length) {
      row.innerHTML = `
        <span class="field-label">Szene</span>
        <select class="field-input" id="cmd-param-value">
          ${obsScenes.map(s => `<option value="${escHtml(s.sceneName)}">${escHtml(s.sceneName)}</option>`).join('')}
        </select>`;
    } else {
      row.innerHTML = `
        <span class="field-label">Szenenname (OBS nicht verbunden)</span>
        <input class="field-input" id="cmd-param-value" placeholder="Szenenname">`;
    }
  } else if (action === 'flowforge-run') {
    if (ffFlows.length) {
      row.innerHTML = `
        <span class="field-label">Flow</span>
        <select class="field-input" id="cmd-param-value">
          ${ffFlows.map(f => `<option value="${escHtml(f.id)}">${escHtml(f.name)}</option>`).join('')}
        </select>`;
    } else {
      row.innerHTML = `
        <span class="field-label">Flow ID (keine Flows gefunden)</span>
        <input class="field-input" id="cmd-param-value" placeholder="flow-id">`;
    }
  } else if (action === 'chat-reply') {
    row.innerHTML = `
      <span class="field-label">Nachricht</span>
      <input class="field-input" id="cmd-param-value" placeholder="z. B. Schau mal auf discord.gg/…">`;
  } else if (action === 'alert-trigger') {
    row.innerHTML = `
      <span class="field-label">Text (optional)</span>
      <input class="field-input" id="cmd-param-value" placeholder="z. B. Hype!">`;
  }
}

function getCmdParamValue() {
  const el = document.getElementById('cmd-param-value');
  return el ? el.value.trim() : '';
}

const ACTION_BADGE = {
  'obs-scene':        { cls: 'obs',    label: 'OBS' },
  'obs-record-start': { cls: 'obs',    label: 'OBS' },
  'obs-record-stop':  { cls: 'obs',    label: 'OBS' },
  'chat-reply':       { cls: 'twitch', label: 'Twitch' },
};

const ACTION_LABEL = {
  none:              'Hervorheben',
  'obs-scene':       'OBS Szene',
  'obs-record-start':'Aufnahme Start',
  'obs-record-stop': 'Aufnahme Stop',
  'timer-start':     'Timer Start',
  'timer-split':     'Timer Split',
  'timer-pause':     'Timer Pause',
  'timer-reset':     'Timer Reset',
  'trackpulse-song': 'Now Playing',
  'trackpulse-next': 'TrackPulse Next',
  'trackpulse-play': 'TrackPulse Play',
  'trackpulse-pause':'TrackPulse Pause',
  'alert-trigger':   'Alert',
  'flowforge-run':   'Flow',
  'chat-reply':      'Chat Antwort',
};

function resolveParamLabel(cmd) {
  if (cmd.action === 'flowforge-run' && cmd.actionParam) {
    const flow = ffFlows.find(f => f.id === cmd.actionParam);
    return flow ? flow.name : cmd.actionParam;
  }
  return cmd.actionParam;
}

function renderCommands() {
  const el = document.getElementById('command-list');
  if (!commands.length) {
    el.innerHTML = '<div style="font-size:12px;color:rgba(243,249,248,0.3);text-align:center;padding:8px 0">Keine Commands</div>';
    return;
  }
  el.innerHTML = commands.map((cmd, i) => {
    const label = ACTION_LABEL[cmd.action] || cmd.action;
    const param = resolveParamLabel(cmd);
    const badge = ACTION_BADGE[cmd.action];
    const badgeHtml = badge ? `<span class="cmd-badge ${badge.cls}">${badge.label}</span>` : '';
    return `
    <div class="command-item">
      <div class="command-item-row">
        <div>
          <div class="command-trigger-row">
            <span class="command-trigger">${escHtml(cmd.trigger)}</span>
            ${badgeHtml}
          </div>
          <div class="command-desc">${label}${param ? ': ' + escHtml(param) : ''}</div>
        </div>
        <button class="keyword-del" onclick="removeCommand(${i})" title="Löschen">×</button>
      </div>
    </div>`;
  }).join('');
}

function addCommand() {
  const trigger     = document.getElementById('new-cmd-trigger').value.trim();
  const action      = document.getElementById('new-cmd-action').value;
  const actionParam = getCmdParamValue();
  if (!trigger) return;
  commands.push({ id: uid(), trigger, action, actionParam });
  document.getElementById('new-cmd-trigger').value = '';
  updateCmdParam();
  renderCommands();
  saveKeywordsCommands();
}

function removeCommand(i) {
  commands.splice(i, 1);
  renderCommands();
  saveKeywordsCommands();
}

// ── Interval messages ──────────────────────────────────────────────
function renderIntervalList() {
  const el = document.getElementById('interval-list');
  if (!el) return;
  if (!intervalMessages.length) {
    el.innerHTML = `<div style="font-size:12px;color:rgba(243,249,248,0.3);text-align:center;padding:8px 0;">${t('chatdeck.interval.empty')}</div>`;
    _updateImBadge();
    return;
  }
  el.innerHTML = intervalMessages.map((msg, i) => {
    const st   = intervalStatus[msg.id] || {};
    const meta = _buildImMeta(msg, st);
    return `
    <div class="interval-item ${msg.enabled ? 'im-active' : ''}">
      <div class="interval-item-main">
        <label class="toggle" title="${msg.enabled ? t('chatdeck.interval.toggle.active') : t('chatdeck.interval.toggle.inactive')}">
          <input type="checkbox" ${msg.enabled ? 'checked' : ''} onchange="toggleIntervalMsg(${i})">
          <span class="toggle-slider"></span>
        </label>
        <span class="interval-msg-text" title="${escHtml(msg.text)}">${escHtml(msg.text)}</span>
        <span class="interval-badge">${msg.intervalMinutes} min</span>
        <button class="keyword-del" onclick="removeIntervalMsg(${i})" title="Löschen">×</button>
      </div>
      ${meta ? `<div class="interval-meta">${meta}</div>` : ''}
    </div>`;
  }).join('');
  _updateImBadge();
}

function _buildImMeta(msg, st) {
  if (!msg.enabled) return t('chatdeck.interval.meta.disabled');
  const parts = [];
  if (st.lastSentAt) {
    const m = Math.round((Date.now() - st.lastSentAt) / 60000);
    parts.push(t('chatdeck.interval.meta.sent_ago', { min: m < 1 ? '&lt;1' : m }));
  } else {
    parts.push(t('chatdeck.interval.meta.not_yet'));
  }
  if (st.nextSendAt) {
    const m = Math.max(0, Math.round((st.nextSendAt - Date.now()) / 60000));
    parts.push(t('chatdeck.interval.meta.next_in', { min: m < 1 ? '&lt;1' : m }));
  }
  return parts.join(' · ');
}

function _updateImBadge() {
  const active = intervalMessages.filter(m => m.enabled).length;
  const badge  = document.getElementById('im-active-badge');
  if (!badge) return;
  badge.style.display = active ? '' : 'none';
  badge.textContent   = t('chatdeck.interval.active_badge', { count: active });
}

function toggleIntervalMsg(i) {
  intervalMessages[i] = { ...intervalMessages[i], enabled: !intervalMessages[i].enabled };
  _saveIntervalMessages();
}

function removeIntervalMsg(i) {
  intervalMessages.splice(i, 1);
  _saveIntervalMessages();
}

function addIntervalMsg() {
  const ta   = document.getElementById('new-im-text');
  const text = (ta?.value || '').trim();
  if (!text) { if (ta) ta.focus(); return; }
  const mins = Math.max(5, Math.min(1440, parseInt(document.getElementById('new-im-interval')?.value || '30') || 30));
  intervalMessages.push({ id: uid(), text, intervalMinutes: mins, enabled: true });
  if (ta) ta.value = '';
  if (document.getElementById('new-im-interval')) document.getElementById('new-im-interval').value = '30';
  updateImCharCount();
  _saveIntervalMessages();
}

async function _saveIntervalMessages() {
  try {
    const updated = await safeJson('/api/chatdeck/config', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ intervalMessages }),
    });
    applyConfig(updated);
  } catch {}
  renderIntervalList();
}

async function loadIntervalStatus() {
  try {
    intervalStatus = await safeJson('/api/chatdeck/intervals/status');
    renderIntervalList();
  } catch {}
}

function updateImCharCount() {
  const ta  = document.getElementById('new-im-text');
  const el  = document.getElementById('im-char-count');
  if (!ta || !el) return;
  const len = ta.value.length;
  el.textContent  = len + '/500';
  el.style.color  = len > 450 ? 'var(--warn)' : 'rgba(243,249,248,0.3)';
}

// ── Helpers ────────────────────────────────────────────────────────
const escHtml = esc;
function escRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── OBS BrowserSource URL builder ─────────────────────────────────
function updateObsUrl() {
  const platform = document.getElementById('obs-platform').value;
  const max      = document.getElementById('obs-max').value || '30';
  const fs       = document.getElementById('obs-fs').value  || '14';
  const bg       = document.getElementById('obs-bg').checked    ? '1' : '0';
  const badge    = document.getElementById('obs-badge').checked ? '1' : '0';
  const newest   = document.getElementById('obs-newest').value; // 'top' | 'bottom'
  const font     = document.getElementById('obs-font').value;   // font key

  // Persist
  try {
    localStorage.setItem('cd_obs', JSON.stringify({ platform, max, fs, bg, badge, newest, font }));
  } catch (_) {}

  const params = new URLSearchParams();
  if (platform !== 'all') params.set('platform', platform);
  if (max !== '30')       params.set('max', max);
  if (fs  !== '14')       params.set('fs', fs);
  if (bg  === '0')        params.set('bg', '0');
  if (badge === '0')      params.set('badge', '0');
  if (newest === 'top')   params.set('newest', 'top');
  if (font !== 'archivo') params.set('font', font);

  const base = `${location.protocol}//${location.host}/tool/chatdeck/overlay`;
  const qs   = params.toString();
  document.getElementById('obs-url-output').value = qs ? `${base}?${qs}` : base;
}

function copyObsUrl() {
  const input = document.getElementById('obs-url-output');
  input.select();
  navigator.clipboard.writeText(input.value).catch(() => document.execCommand('copy'));
  const btn = document.getElementById('btn-obs-copy');
  btn.textContent = '✓ ' + t('toast.copied');
  setTimeout(() => { btn.textContent = t('btn.copy'); }, 1800);
}

// ── Toggle Twitch connect shortcut ─────────────────────────────────
function toggleTwitchConnect() {
  window.location.href = '/';
}

// ── Start ──────────────────────────────────────────────────────────
function restoreObsSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('cd_obs') || 'null');
    if (!s) return;
    if (s.platform !== undefined) document.getElementById('obs-platform').value = s.platform;
    if (s.max      !== undefined) document.getElementById('obs-max').value       = s.max;
    if (s.fs       !== undefined) document.getElementById('obs-fs').value        = s.fs;
    if (s.bg       !== undefined) document.getElementById('obs-bg').checked      = s.bg !== '0';
    if (s.badge    !== undefined) document.getElementById('obs-badge').checked   = s.badge !== '0';
    if (s.newest   !== undefined) document.getElementById('obs-newest').value    = s.newest;
    if (s.font     !== undefined) document.getElementById('obs-font').value      = s.font;
  } catch (_) {}
}

restoreObsSettings();
updateObsUrl();
init();
