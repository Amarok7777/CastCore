let toolsRenderInFlight = false;
let nextAction = () => {};
const hubState = {
  tools: [],
  platforms: null,
  obs: null,
};

function setHubStatus(message, type = 'warn') {
  const el = document.getElementById('hub-platforms-status');
  if (!el) return;
  el.textContent = message || '';
  el.className = 'status-banner';
  if (message) el.classList.add(type);
}

function buildActionHint(message, context = 'general') {
  const lower = String(message || '').toLowerCase();
  if (!lower) return '';
  if (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('nicht geladen')) {
    return t('hint.app_offline');
  }
  if (context === 'obs' && (lower.includes('connection') || lower.includes('verbindung') || lower.includes('websocket'))) {
    return t('hint.obs_connection');
  }
  if (context === 'youtube' && (lower.includes('stream') || lower.includes('gefunden') || lower.includes('lookup'))) {
    return t('hint.yt_no_stream');
  }
  if (context === 'twitch' && lower.includes('kanal')) {
    return t('hint.twitch_channel');
  }
  return '';
}

function withHint(message, context) {
  const hint = buildActionHint(message, context);
  return hint ? `${message} ${hint}` : message;
}

(async function init() {
  await i18n.ready();
  i18n.createSwitcher(document.getElementById('lang-switcher'));
  document.addEventListener('langchange', () => {
    renderTools().catch(() => {});
    pollPlatformsStatus().catch(() => {});
    pollObsStatus().catch(() => {});
  });
  await renderTools();
  initPlatformsPanel();
  initObsPanel();
  document.getElementById('hub-next-action-btn').addEventListener('click', () => nextAction());
  checkHotkeyConflicts().catch(() => {});
  setInterval(() => {
    renderTools().catch(() => {});
    checkHotkeyConflicts().catch(() => {});
  }, 4000);
})();

async function checkHotkeyConflicts() {
  try {
    const settings = await safeJson('/api/settings');
    const hk = settings?.hotkeys || {};
    const vals = Object.values(hk).filter(Boolean);
    const dupes = vals.filter((v, i) => vals.indexOf(v) !== i);
    let banner = document.getElementById('hotkey-conflict-banner');
    if (dupes.length > 0) {
      if (!banner) {
        banner = document.createElement('p');
        banner.id = 'hotkey-conflict-banner';
        banner.className = 'status-banner warn';
        banner.style.marginTop = '10px';
        const grid = document.getElementById('tools-grid');
        if (grid) grid.after(banner);
      }
      banner.textContent = t('msg.hotkey_conflict', { key: dupes[0] });
    } else if (banner) {
      banner.remove();
    }
  } catch { /* non-fatal */ }
}

// ─── OBS Connection Panel ────────────────────────────────────────────────────
function initObsPanel() {
  document.getElementById('hub-obs-connect-btn').addEventListener('click', connectObs);
  document.getElementById('hub-obs-disconnect-btn').addEventListener('click', disconnectObs);
  pollObsStatus();
  setInterval(pollObsStatus, 3000);
}

// ─── Platforms Panel ──────────────────────────────────────────────────────────
function initPlatformsPanel() {
  const ytInput = document.getElementById('hub-yt-channel');
  ytInput.addEventListener('input', () => {
    ytInput.classList.remove('input-error');
  });
  pollPlatformsStatus();
  setInterval(pollPlatformsStatus, 3000);
}

async function pollPlatformsStatus() {
  try {
    const s = await safeJson('/api/platforms');
    hubState.platforms = s;
    const twStatus = document.getElementById('hub-tw-status');
    const twInput = document.getElementById('hub-tw-channel');
    if (s.twitch?.connected) {
      twStatus.innerHTML = `${t('status.prefix')}: <span style="color:#c9a0ff">${t('twitch.status.connected')}</span>${s.twitch?.channel ? ` · #${escapeHtml(s.twitch.channel)}` : ''}`;
    } else {
      twStatus.innerHTML = `${t('status.prefix')}: <span style="color:#ffb26b">${t('twitch.status.disconnected')}</span>`;
    }
    if (!twInput.value && s.twitch?.channel) twInput.value = s.twitch.channel;
    const twOauthBtn = document.getElementById('hub-tw-oauth-btn');
    if (twOauthBtn && !twOauthBtn.disabled) {
      if (s.twitch?.oauthLoggedIn) {
        twOauthBtn.textContent = t('twitch.logged_in', { user: s.twitch.username || 'Twitch' });
        twOauthBtn.classList.add('oauth-active');
      } else {
        twOauthBtn.textContent = t('twitch.login');
        twOauthBtn.classList.remove('oauth-active');
        twOauthBtn.onclick = startTwitchOAuth;
      }
    }

    const ytStatus = document.getElementById('hub-yt-status');
    const ytInput = document.getElementById('hub-yt-channel');
    const ytHasLookupError = !!s.youtube?.lookupError;
    if (s.youtube?.enabled && s.youtube?.videoId) {
      ytStatus.innerHTML = `${t('status.prefix')}: <span style="color:#ff9090">${t('yt.status.live')}</span>${s.youtube?.channel ? ` · ${escapeHtml(s.youtube.channel)}` : ''}${s.youtube?.title ? ` · ${escapeHtml(s.youtube.title)}` : ''}`;
    } else if (s.youtube?.channel) {
      ytStatus.innerHTML = `${t('status.prefix')}: <span style="color:#ffd36f">${t('yt.status.saved')}</span> · ${escapeHtml(s.youtube.channel)}`;
    } else {
      ytStatus.innerHTML = `${t('status.prefix')}: <span style="color:#ffb26b">${t('yt.status.disconnected')}</span>`;
    }
    if (!ytInput.value && s.youtube?.channel) ytInput.value = s.youtube.channel;
    ytInput.classList.toggle('input-error', ytHasLookupError);

    if (!document.getElementById('hub-platforms-status').textContent) {
      setHubStatus(t('msg.all_ready'), 'warn');
    }
    updateHubGuidance();
  } catch (e) {
    hubState.platforms = null;
    setHubStatus(withHint(e.message || t('msg.platform_status_failed'), 'general'), 'error');
    updateHubGuidance();
  }
}

async function connectTwitchHub() {
  const btn = document.getElementById('hub-tw-connect-btn');
  const channel = document.getElementById('hub-tw-channel').value.trim();
  if (!channel) {
    setHubStatus(t('msg.twitch.enter_channel'), 'warn');
    return;
  }
  btn.disabled = true;
  btn.textContent = t('btn.connecting');
  try {
    await safeJson('/api/platforms/twitch/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel }),
    });
    setHubStatus(t('msg.twitch.connected'), 'ok');
  } catch (e) {
    setHubStatus(withHint(e.message || t('msg.twitch.connect_failed'), 'twitch'), 'error');
  } finally {
    btn.textContent = t('btn.connect');
    btn.disabled = false;
    await pollPlatformsStatus();
  }
}

async function disconnectTwitchHub() {
  await fetch('/api/platforms/twitch/disconnect', { method: 'POST' }).catch(() => {});
  setHubStatus(t('msg.twitch.disconnected'), 'warn');
  await pollPlatformsStatus();
}

async function saveYouTubeHub() {
  const btn = document.getElementById('hub-yt-connect-btn');
  const channel = document.getElementById('hub-yt-channel').value.trim();
  if (!channel) {
    setHubStatus(t('msg.yt.enter_channel'), 'warn');
    return;
  }
  btn.disabled = true;
  btn.textContent = t('btn.saving');
  try {
    await safeJson('/api/platforms/youtube/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel }),
    });
    document.getElementById('hub-yt-channel').classList.remove('input-error');
    setHubStatus(t('msg.yt.saved'), 'ok');
  } catch (e) {
    setHubStatus(withHint(e.message || t('msg.yt.save_failed'), 'youtube'), 'error');
  } finally {
    btn.textContent = t('btn.save');
    btn.disabled = false;
    await pollPlatformsStatus();
  }
}

async function findYouTubeLiveHub() {
  const btn = document.getElementById('hub-yt-find-btn');
  const channel = document.getElementById('hub-yt-channel').value.trim();
  if (!channel) {
    setHubStatus(t('msg.yt.enter_first'), 'warn');
    return;
  }
  btn.disabled = true;
  btn.textContent = t('btn.searching');
  try {
    const data = await safeJson('/api/platforms/youtube/find-live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel }),
    });
    setHubStatus(data.title
      ? t('msg.yt.stream_found', { title: data.title })
      : t('msg.yt.stream_found_generic'), 'ok');
  } catch (e) {
    setHubStatus(withHint(e.message || t('msg.yt.stream_not_found'), 'youtube'), 'error');
  } finally {
    btn.textContent = t('yt.find_stream');
    btn.disabled = false;
    await pollPlatformsStatus();
  }
}

async function disconnectYouTubeHub() {
  await fetch('/api/platforms/youtube/disconnect', { method: 'POST' }).catch(() => {});
  document.getElementById('hub-yt-channel').classList.remove('input-error');
  setHubStatus(t('msg.yt.disconnected'), 'warn');
  await pollPlatformsStatus();
}

async function startTwitchOAuth() {
  const btn = document.getElementById('hub-tw-oauth-btn');
  btn.disabled = true;
  btn.textContent = t('btn.browser_opening');
  try {
    const d = await safeJson('/api/platforms/twitch/oauth/start', { method: 'POST' });
    if (d.flow === 'device') {
      if (!d.ok || !d.verificationUri || !d.userCode || !d.pollState) {
        throw new Error(d.error || t('msg.twitch.device_flow_failed'));
      }
      if (window.splitflow?.openExternal) await window.splitflow.openExternal(d.verificationUri);
      else window.open(d.verificationUri, '_blank', 'noopener,noreferrer');
      btn.textContent = `Code: ${d.userCode}`;
      setHubStatus(t('msg.twitch.code', { code: d.userCode }), 'warn');
      const timer = setInterval(async () => {
        try {
          const pollData = await safeJson(`/api/platforms/twitch/oauth/poll?state=${encodeURIComponent(d.pollState)}`);
          if (pollData.status === 'pending') return;
          clearInterval(timer);
          btn.disabled = false;
          await pollPlatformsStatus();
          btn.textContent = t('twitch.logged_in', { user: pollData.username || hubState.platforms?.twitch?.username || 'Twitch' });
          btn.classList.add('oauth-active');
          setHubStatus(t('msg.twitch.oauth_ok'), 'ok');
        } catch (e) {
          clearInterval(timer);
          btn.disabled = false;
          btn.textContent = t('twitch.login');
          btn.classList.remove('oauth-active');
          setHubStatus(e.message || t('msg.twitch.oauth_failed'), 'error');
        }
      }, Math.max(1000, Number(d.interval || 5) * 1000));
      return;
    }

    if (!d.ok || !d.url) throw new Error(d.error || t('msg.twitch.oauth_failed'));

    if (window.splitflow?.openExternal) await window.splitflow.openExternal(d.url);
    else window.open(d.url, '_blank', 'noopener,noreferrer');
    setHubStatus(t('msg.twitch.browser_opened'), 'warn');
    const timer = setInterval(async () => {
      await pollPlatformsStatus();
      if (hubState.platforms?.twitch?.oauthLoggedIn) {
        clearInterval(timer);
        btn.disabled = false;
        btn.textContent = t('twitch.logged_in', { user: hubState.platforms.twitch.username || 'Twitch' });
        btn.classList.add('oauth-active');
        setHubStatus(t('msg.twitch.oauth_ok'), 'ok');
      }
    }, 1200);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = t('twitch.login');
    setHubStatus(e.message || t('msg.twitch.oauth_failed'), 'error');
  }
}


async function pollObsStatus() {
  try {
    const s = await safeJson('/api/scenepilot/status');
    hubState.obs = s;
    const el = document.getElementById('hub-obs-status');
    if (s.connected) {
      el.innerHTML = `${t('status.prefix')}: <span style="color:#44db9b;font-weight:600">${t('obs.status.connected')}</span>`;
    } else {
      const err = s.lastError ? ` — ${escapeHtml(s.lastError)}` : '';
      el.innerHTML = `${t('status.prefix')}: <span style="color:#ffb26b;font-weight:600">${t('obs.status.disconnected')}</span>${err}`;
    }
    updateHubGuidance();
  } catch { /* non-fatal */ }
}

async function connectObs() {
  const btn = document.getElementById('hub-obs-connect-btn');
  btn.disabled = true;
  btn.textContent = t('btn.connecting');
  try {
    await safeJson('/api/scenepilot/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: document.getElementById('hub-obs-url').value.trim(),
        password: document.getElementById('hub-obs-password').value,
      }),
    });
    await pollObsStatus();
  } catch (e) {
    document.getElementById('hub-obs-status').innerHTML =
      `${t('status.prefix')}: <span style="color:#ff6b6b">${t('msg.obs.error', { msg: escapeHtml(e.message) })}</span>`;
    setHubStatus(withHint(e.message || t('msg.obs.connect_failed'), 'obs'), 'error');
  } finally {
    btn.textContent = t('btn.connect');
    btn.disabled = false;
  }
}

async function disconnectObs() {
  await fetch('/api/scenepilot/disconnect', { method: 'POST' }).catch(() => {});
  await pollObsStatus();
}

// ─── Tools Grid ──────────────────────────────────────────────────────────────

async function renderTools() {
  if (toolsRenderInFlight) return;
  toolsRenderInFlight = true;
  const grid = document.getElementById('tools-grid');
  try {
    const tools = await safeJson('/api/tools');
    hubState.tools = Array.isArray(tools) ? tools : [];
    grid.innerHTML = '';

    // Render ControlDeck into the sidebar placeholder
    const cdTool = tools.find(t => t.id === 'controldeck');
    const cdCard = document.getElementById('hub-cd-card');
    if (cdTool && cdCard) {
      cdCard.innerHTML = `
        <div class="card-head">
          <h2 class="title">${escapeHtml(cdTool.name)}</h2>
        </div>
        <p class="tagline">${escapeHtml(cdTool.taglineKey ? t(cdTool.taglineKey) : (cdTool.tagline || ''))}</p>
        <div class="meta">
          <span class="category">${escapeHtml(cdTool.categoryKey ? t(cdTool.categoryKey) : (cdTool.category || t('tool.category.general')))}</span>
          <a class="btn" href="${cdTool.route}">${t('btn.open')}</a>
        </div>
      `;
    }

    tools.filter(tool => tool.showInGrid !== false).forEach(tool => {
      const card = document.createElement('article');
      card.className = 'card';
      const ready = tool.status === 'ready';
      const hasBgService = tool.bgService !== false;
      const running = hasBgService && !!tool.runtime?.running;
      // Badge im Header: aktiv/inaktiv für bgService-Tools
      const headerBadge = hasBgService
        ? (running
          ? `<span class="badge running">${t('badge.active')}</span>`
          : `<span class="badge stopped">${t('badge.inactive')}</span>`)
        : '';
      const startButton = (hasBgService && !running)
        ? `<button class="btn primary" data-tool-start="${escapeHtml(tool.id)}">${t('btn.start')}</button>`
        : '';
      const stopButton = (hasBgService && running)
        ? `<button class="btn warn" data-tool-stop="${escapeHtml(tool.id)}">${t('btn.stop')}</button>`
        : '';
      card.innerHTML = `
        <div class="card-head">
          <h2 class="title">${escapeHtml(tool.name)}</h2>
          ${headerBadge}
        </div>
        <p class="tagline">${escapeHtml(tool.taglineKey ? t(tool.taglineKey) : (tool.tagline || ''))}</p>
        <div class="meta">
          <span class="category">${escapeHtml(tool.categoryKey ? t(tool.categoryKey) : (tool.category || t('tool.category.general')))}</span>
          ${ready
            ? `<div class="actions">
                ${startButton}
                ${stopButton}
                <a class="btn" href="${tool.route}">${t('btn.open')}</a>
              </div>`
            : `<button class="btn" disabled>${t('badge.unavailable')}</button>`}
        </div>
      `;
      grid.appendChild(card);
    });

    const startButtons = grid.querySelectorAll('[data-tool-start]');
    startButtons.forEach(btn => {
      btn.addEventListener('click', async () => {
        const toolId = btn.getAttribute('data-tool-start');
        btn.disabled = true;
        const prevText = btn.textContent;
        btn.textContent = t('btn.starting');
        try {
          await safeJson(`/api/tools/${encodeURIComponent(toolId)}/start`, { method: 'POST' });
          setHubStatus(t('msg.tool.started'), 'ok');
        } catch (e) {
          setHubStatus(withHint(t('msg.tool.start_failed', { msg: e.message }), 'general'), 'error');
        } finally {
          btn.textContent = prevText;
          btn.disabled = false;
          await renderTools();
          updateHubGuidance();
        }
      });
    });

    const stopButtons = grid.querySelectorAll('[data-tool-stop]');
    stopButtons.forEach(btn => {
      btn.addEventListener('click', async () => {
        const toolId = btn.getAttribute('data-tool-stop');
        btn.disabled = true;
        const prevText = btn.textContent;
        btn.textContent = t('btn.stopping');
        try {
          await safeJson(`/api/tools/${encodeURIComponent(toolId)}/stop`, { method: 'POST' });
          setHubStatus(t('msg.tool.stopped'), 'warn');
        } catch (e) {
          setHubStatus(withHint(t('msg.tool.stop_failed', { msg: e.message }), 'general'), 'error');
        } finally {
          btn.textContent = prevText;
          btn.disabled = false;
          await renderTools();
          updateHubGuidance();
        }
      });
    });
    updateHubGuidance();
  } catch (e) {
    hubState.tools = [];
    grid.innerHTML = `<article class="card"><h2 class="title">${t('msg.tool.unavailable')}</h2><p class="tagline">${t('msg.tool.load_failed')}</p></article>`;
    setHubStatus(withHint(t('msg.tool.list_failed'), 'general'), 'error');
    updateHubGuidance();
  } finally {
    toolsRenderInFlight = false;
  }
}

async function startToolFromCoach(toolId) {
  try {
    await safeJson(`/api/tools/${encodeURIComponent(toolId)}/start`, { method: 'POST' });
    setHubStatus(t('msg.tool.started'), 'ok');
    await renderTools();
  } catch (e) {
    document.getElementById('hub-coach-note').textContent = t('msg.tool.start_failed', { msg: e.message });
    setHubStatus(withHint(t('msg.tool.start_failed', { msg: e.message }), 'general'), 'error');
  }
}

function markStep(stepId, stateId, done, active, text) {
  const step = document.getElementById(stepId);
  const state = document.getElementById(stateId);
  if (!step || !state) return;
  const wasDone = step.classList.contains('done');
  step.classList.toggle('done', !!done);
  step.classList.toggle('active', !!active);
  state.textContent = text;
  if (done && !wasDone) {
    step.classList.remove('pop');
    void step.offsetWidth;
    step.classList.add('pop');
  }
}

function updateHubGuidance() {
  const p = hubState.platforms || {};
  const obs = hubState.obs || {};
  const tools = hubState.tools || [];

  const platformReady = !!(p.twitch?.connected || p.youtube?.channel);
  const obsReady = !!obs.connected;
  const runningTool = tools.find(t => t?.runtime?.running && t?.id !== 'splitflow');
  const toolsReady = platformReady && obsReady && !!runningTool;

  const coachNote = document.getElementById('hub-coach-note');
  const nextBtn = document.getElementById('hub-next-action-btn');

  markStep('hub-step-platforms', 'hub-step-platforms-state', platformReady, !platformReady, platformReady ? t('quickstart.done') : t('quickstart.open'));
  markStep('hub-step-obs', 'hub-step-obs-state', obsReady, platformReady && !obsReady, obsReady ? t('quickstart.done') : t('quickstart.open'));
  markStep(
    'hub-step-tools',
    'hub-step-tools-state',
    toolsReady,
    platformReady && obsReady && !toolsReady,
    toolsReady
      ? t('guide.tool_running', { name: runningTool.name || runningTool.id })
      : (platformReady && obsReady ? t('quickstart.open') : t('guide.waiting'))
  );

  if (!platformReady) {
    const isFreshSetup = !p.twitch?.channel && !p.youtube?.channel;
    coachNote.textContent = isFreshSetup
      ? t('guide.fresh_setup')
      : t('guide.connect_first');
    nextBtn.textContent = t('guide.platforms_btn');
    nextAction = () => {
      const input = document.getElementById('hub-tw-channel');
      input.focus();
      input.select();
    };
    return;
  }

  if (!obsReady) {
    coachNote.textContent = t('guide.connect_obs');
    nextBtn.textContent = t('guide.obs_btn');
    nextAction = () => connectObs();
    return;
  }

  if (!toolsReady) {
    coachNote.textContent = t('guide.open_tool');
    nextBtn.textContent = t('guide.tool_btn');
    nextAction = () => { window.location.href = '/tool/controldeck'; };
    return;
  }

  coachNote.textContent = t('guide.all_done');
  const preferredTool = tools.find(tool => tool?.runtime?.running && tool?.route);
  nextBtn.textContent = preferredTool ? t('guide.tool_open', { name: preferredTool.name }) : t('guide.chatlink_open');
  nextAction = () => {
    window.location.href = preferredTool?.route || '/tool/chatdeck';
  };
}

const escapeHtml = esc;

// ── Onboarding ────────────────────────────────────────────────────────────────

async function checkOnboarding() {
  try {
    const s = await safeJson('/api/settings');
    if (!s.onboardingComplete) {
      document.getElementById('onboarding-backdrop').style.display = 'flex';
    }
  } catch {}
}

async function dismissOnboarding() {
  document.getElementById('onboarding-backdrop').style.display = 'none';
  try {
    await safeJson('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onboardingComplete: true }),
    });
  } catch {}
}

checkOnboarding();
