const http    = require('http');
const express = require('express');
const path    = require('path');
const timer   = require('../core/timer');
const splits  = require('../core/splits');
const settings= require('../core/settings');
const scenepilot = require('../core/scenepilot');
const tunapilot = require('../core/tunapilot');
const chatdeck = require('../core/chatdeck');
const alertdeckConfig = require('../core/alertdeckConfig');
const authManager = require('./authManager');
const scenepilotService = require('./scenepilotService');
const tunapilotService = require('./tunapilotService');
const chatdeckService = require('./chatdeckService');
const twitchApiService = require('./twitchApiService');
const chatBus = require('./chatBus');
const platformEvents = require('./platformEvents');
const { registerCoreStateRoutes } = require('./routes/coreStateRoutes');
const { registerPlatformAuthRoutes } = require('./routes/platformAuthRoutes');
const { registerChatdeckRoutes } = require('./routes/chatdeckRoutes');
const { registerAlertDeckRoutes } = require('./routes/alertDeckRoutes');
const { registerToolPageRoutes }  = require('./routes/toolRoutes');
const { registerFlowForgeRoutes } = require('./routes/flowforgeRoutes');
const { getTools, getToolById } = require('../tools/registry');

// Broadcast is resolved lazily to avoid a circular-require during startup.
function getBroadcast() { return require('./wsServer').broadcast; }
function broadcastSafely(msg) {
  try { getBroadcast()(msg); } catch (e) { console.error('broadcast error', e.message); }
}

function createOverlayServer({ dashboard = false, toolRuntime = null, electronPickFiles = null, electronPickFolder = null, overlayPort = 7331, dashboardPort = 7332 } = {}) {
  const app = express();

  // ── Path traversal guard ────────────────────────────────────────────────────
  app.use((req, res, next) => {
    const raw = decodeURIComponent(req.path || '');
    if (raw.includes('..') || raw.includes('\0')) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    next();
  });

  // ── Security headers ────────────────────────────────────────────────────────
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // Allow inline scripts/styles needed by the tool pages; restrict external sources
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline'; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; " +
      "connect-src 'self' ws://localhost:* wss://localhost:* " +
        "https://id.twitch.tv https://api.twitch.tv " +
        "https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com; " +
      "img-src 'self' data: blob:; " +
      "media-src 'self' blob:; " +
      "frame-src 'self';"
    );
    next();
  });

  // Default 2 MB; the media-import endpoint overrides this with a larger limit
  app.use(express.json({ limit: '2mb' }));

  // ── Meta endpoint — lets client pages discover ports without hardcoding ──
  app.get('/api/meta', (_req, res) => {
    res.json({ overlayPort, dashboardPort });
  });

  const TWITCH_SCOPES = [
    'chat:read',
    'bits:read',
    'channel:read:subscriptions',
    'channel:read:redemptions',
    'moderator:read:followers',
    'moderator:manage:chat_messages',
    'moderator:manage:banned_users',
    'user:write:chat',
  ];

  const splitflowDir  = path.join(__dirname, '..', 'splitflow');
  const launcherDir   = path.join(__dirname, '..', 'launcher');
  const settingsDir   = path.join(__dirname, '..', 'settings');
  const widgeturlsDir = path.join(__dirname, '..', 'widgeturls');
  const flowforgeDir  = path.join(__dirname, '..', 'flowforge');
  const scenepilotDir  = path.join(__dirname, '..', 'scenepilot');
  const tunapilotDir   = path.join(__dirname, '..', 'tunapilot');
  const controldeckDir = path.join(__dirname, '..', 'controldeck');
  const chatdeckDir    = path.join(__dirname, '..', 'chatdeck');
  const alertdeckDir   = path.join(__dirname, '..', 'alertdeck');
  const alertdeckMediaDir = path.join(__dirname, '..', 'data', 'alertdeck-media');
  const sharedDir         = path.join(__dirname, '..', 'shared');

  const staticDir = dashboard ? launcherDir : splitflowDir;

  // Shared design system — served at /shared/* for all tool pages
  app.use('/shared', express.static(sharedDir));

  if (dashboard) {
    app.use(express.static(staticDir));
  }
  app.use('/media/alertdeck', express.static(alertdeckMediaDir, { maxAge: '365d', fallthrough: true }));

  if (dashboard) {
    // Tool Hub API and routes (dashboard server only)
    app.get('/api/tools', (req, res) => {
      const statuses = toolRuntime?.getAllStatuses ? toolRuntime.getAllStatuses() : {};
      const tools = getTools().map(tool => ({
        ...tool,
        runtime: statuses[tool.id] || { running: false, lastError: null },
      }));
      res.json(tools);
    });

    app.get('/api/tools/:id/status', (req, res) => {
      const tool = getToolById(req.params.id);
      if (!tool) return res.status(404).json({ error: 'Unknown tool' });
      const runtime = toolRuntime?.getStatus
        ? toolRuntime.getStatus(tool.id)
        : { running: false, lastError: null };
      res.json({ id: tool.id, runtime });
    });

    app.post('/api/tools/:id/start', async (req, res) => {
      const tool = getToolById(req.params.id);
      if (!tool) return res.status(404).json({ error: 'Unknown tool' });
      if (!toolRuntime?.start) {
        return res.status(501).json({ error: 'Tool runtime controller unavailable' });
      }
      const runtime = await toolRuntime.start(tool.id);
      res.json({ ok: true, id: tool.id, runtime });
    });

    app.post('/api/tools/:id/stop', async (req, res) => {
      const tool = getToolById(req.params.id);
      if (!tool) return res.status(404).json({ error: 'Unknown tool' });
      if (!toolRuntime?.stop) {
        return res.status(501).json({ error: 'Tool runtime controller unavailable' });
      }
      const runtime = await toolRuntime.stop(tool.id);
      res.json({ ok: true, id: tool.id, runtime });
    });

    registerFlowForgeRoutes(app);

    registerToolPageRoutes(app, [
      { base: '/tool/splitflow', dir: splitflowDir, overlay: 'overlay.html' },
      { base: '/tool/scenepilot', dir: scenepilotDir },
      { base: '/tool/trackpulse', dir: tunapilotDir, overlay: 'overlay.html' },
      { base: '/tool/controldeck', dir: controldeckDir },
      { base: '/tool/chatdeck', dir: chatdeckDir, overlay: 'overlay.html' },
      { base: '/tool/alertdeck', dir: alertdeckDir, overlay: 'overlay.html' },
      { base: '/tool/hub',        dir: launcherDir },
      { base: '/tool/settings',   dir: settingsDir },
      { base: '/tool/widgeturls', dir: widgeturlsDir },
      { base: '/tool/flowforge',  dir: flowforgeDir },
      { base: '/tool/trackflow', dir: tunapilotDir, redirectTo: '/tool/trackpulse' },
      { base: '/tool/trackpilot', dir: tunapilotDir, redirectTo: '/tool/trackpulse' },
      { base: '/tool/tunapilot', dir: tunapilotDir, redirectTo: '/tool/trackpulse' },
    ]);

    // ScenePilot API
    app.get('/api/scenepilot/config', (req, res) => {
      res.json(scenepilot.getAll());
    });

    app.patch('/api/scenepilot/config', (req, res) => {
      const updated = scenepilot.update(req.body || {});
      res.json(updated);
    });

    app.get('/api/scenepilot/status', (req, res) => {
      res.json(scenepilotService.status());
    });

    app.post('/api/scenepilot/connect', async (req, res) => {
      try {
        const body = req.body || {};
        const cfg = scenepilot.update({ obs: { address: body.address, password: body.password } });
        await scenepilotService.connect(cfg.obs.address, cfg.obs.password);
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ error: e.message || 'connect failed' });
      }
    });

    app.post('/api/scenepilot/disconnect', async (req, res) => {
      await scenepilotService.disconnect();
      res.json({ ok: true });
    });

    app.get('/api/scenepilot/scenes', async (req, res) => {
      try {
        res.json(await scenepilotService.listScenes());
      } catch (e) {
        res.status(500).json({ error: e.message || 'failed to list scenes' });
      }
    });

    app.get('/api/scenepilot/current-scene', async (req, res) => {
      try {
        if (!scenepilotService.connected) return res.json({ currentScene: null });
        const r = await scenepilotService.obs.call('GetCurrentProgramScene');
        res.json({ currentScene: r.currentProgramSceneName || null });
      } catch (e) {
        res.status(500).json({ error: e.message || 'failed to get current scene' });
      }
    });

    app.get('/api/scenepilot/obs-stats', async (req, res) => {
      try {
        if (!scenepilotService.connected || !scenepilotService.obs) {
          return res.status(503).json({ error: 'OBS nicht verbunden' });
        }
        const [statsData, streamData, recordData, vcamData] = await Promise.all([
          scenepilotService.obs.call('GetStats').catch(() => ({})),
          scenepilotService.obs.call('GetStreamStatus').catch(() => ({})),
          scenepilotService.obs.call('GetRecordStatus').catch(() => ({})),
          scenepilotService.obs.call('GetVirtualCamStatus').catch(() => ({})),
        ]);
        res.json({
          activeFps:           statsData.activeFps           || 0,
          cpuUsage:            statsData.cpuUsage            || 0,
          memoryUsage:         statsData.memoryUsage         || 0,
          outputSkippedFrames: statsData.outputSkippedFrames || 0,
          outputTotalFrames:   statsData.outputTotalFrames   || 0,
          outputActive:   streamData.outputActive  || false,
          outputTimecode: streamData.outputTimecode || null,
          outputDuration: streamData.outputDuration || 0,
          recordActive:   recordData.outputActive  || false,
          recordPaused:   recordData.outputPaused  || false,
          recordDuration: recordData.outputDuration || 0,
          virtualCamActive: vcamData.outputActive  || false,
        });
      } catch (e) {
        res.status(500).json({ error: e.message || 'stats unavailable' });
      }
    });

    // OBS stream / record controls
    const _obsCtrl = (action) => async (req, res) => {
      if (!scenepilotService.connected || !scenepilotService.obs)
        return res.status(503).json({ ok: false, error: 'OBS nicht verbunden' });
      try { await scenepilotService.obs.call(action); res.json({ ok: true }); }
      catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    };
    app.post('/api/scenepilot/stream/start',   _obsCtrl('StartStream'));
    app.post('/api/scenepilot/stream/stop',    _obsCtrl('StopStream'));
    app.post('/api/scenepilot/record/start',   _obsCtrl('StartRecord'));
    app.post('/api/scenepilot/record/stop',    _obsCtrl('StopRecord'));
    app.post('/api/scenepilot/record/pause',      _obsCtrl('PauseRecord'));
    app.post('/api/scenepilot/record/resume',     _obsCtrl('ResumeRecord'));
    app.post('/api/scenepilot/virtualcam/start',  _obsCtrl('StartVirtualCam'));
    app.post('/api/scenepilot/virtualcam/stop',   _obsCtrl('StopVirtualCam'));

    // OBS output list (includes Multi-RTMP plugin outputs)
    app.get('/api/scenepilot/outputs', async (req, res) => {
      if (!scenepilotService.connected || !scenepilotService.obs)
        return res.json({ outputs: [] });
      try {
        const r = await scenepilotService.obs.call('GetOutputList');
        res.json({ outputs: r.outputs || [] });
      } catch (e) {
        res.json({ outputs: [], error: e.message });
      }
    });

    app.post('/api/scenepilot/outputs/:name/start', async (req, res) => {
      if (!scenepilotService.connected || !scenepilotService.obs)
        return res.status(503).json({ ok: false, error: 'OBS nicht verbunden' });
      try {
        await scenepilotService.obs.call('StartOutput', { outputName: req.params.name });
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    app.post('/api/scenepilot/outputs/:name/stop', async (req, res) => {
      if (!scenepilotService.connected || !scenepilotService.obs)
        return res.status(503).json({ ok: false, error: 'OBS nicht verbunden' });
      try {
        await scenepilotService.obs.call('StopOutput', { outputName: req.params.name });
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    app.get('/api/scenepilot/inputs', async (req, res) => {
      try {
        res.json(await scenepilotService.listInputs());
      } catch (e) {
        res.status(500).json({ error: e.message || 'failed to list inputs' });
      }
    });

    app.get('/api/scenepilot/scene-items/:sceneName', async (req, res) => {
      try {
        if (!scenepilotService.connected) {
          return res.json([]);
        }
        res.json(await scenepilotService.listSceneItems(req.params.sceneName));
      } catch (e) {
        console.error('scene-items error:', e.message);
        res.json([]);
      }
    });

    // Scene thumbnail — cached for 3 s to avoid hammering OBS
    const _screenshotCache = new Map(); // name → { buf, ts }
    app.get('/api/scenepilot/screenshot/:name', async (req, res) => {
      if (!scenepilotService.connected || !scenepilotService.obs) return res.status(503).end();
      const name = String(req.params.name || '').trim();
      if (!name || name.includes('\0')) return res.status(400).end();

      const now    = Date.now();
      const cached = _screenshotCache.get(name);
      if (cached && now - cached.ts < 1200) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=3');
        return res.send(cached.buf);
      }

      try {
        const result = await scenepilotService.obs.call('GetSourceScreenshot', {
          sourceName: name,
          imageFormat: 'jpeg',
          imageWidth: 320,
          imageHeight: 180,
          imageCompressionQuality: 70,
        });
        const data = String(result?.imageData || '');
        if (!data) return res.status(404).end();
        const buf = Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
        _screenshotCache.set(name, { buf, ts: now });
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=3');
        res.send(buf);
      } catch { res.status(503).end(); }
    });

    app.get('/api/scenepilot/input-volume/:inputName', async (req, res) => {
      try {
        if (!scenepilotService.connected) {
          return res.json(null);
        }
        const mul = await scenepilotService.getInputVolume(req.params.inputName);
        res.json(mul);
      } catch (e) {
        console.error('input-volume error:', e.message);
        res.json(null);
      }
    });

    app.post('/api/scenepilot/scene', async (req, res) => {
      try {
        const { scene } = req.body || {};
        if (!scene) return res.status(400).json({ error: 'scene name required' });
        await scenepilotService.setScene(scene);
        res.json({ ok: true, scene });
      } catch (e) {
        res.status(500).json({ error: e.message || 'scene switch failed' });
      }
    });

    app.post('/api/scenepilot/action', async (req, res) => {
      try {
        await scenepilotService.executeAction(req.body || {});
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ error: e.message || 'action failed' });
      }
    });

    app.post('/api/scenepilot/macro/:id', async (req, res) => {
      try {
        const cfg = scenepilot.getAll();
        const macro = (cfg.macros || []).find(m => m.id === req.params.id);
        if (!macro) return res.status(404).json({ error: 'macro not found' });
        await scenepilotService.executeMacro(macro);
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ error: e.message || 'macro failed' });
      }
    });

    // TrackPulse API
    app.get(['/api/trackpulse/config', '/api/trackflow/config', '/api/trackpilot/config', '/api/tunapilot/config'], (req, res) => {
      res.json(tunapilot.getAll());
    });

    app.patch(['/api/trackpulse/config', '/api/trackflow/config', '/api/trackpilot/config', '/api/tunapilot/config'], (req, res) => {
      const updated = tunapilot.update(req.body || {});
      if (tunapilotService.status().running) {
        try {
          tunapilotService.updateConfig(updated);
        } catch (e) {
          console.error('trackpulse apply config failed:', e.message);
        }
      }
      res.json(updated);
    });

    app.get(['/api/trackpulse/status', '/api/trackflow/status', '/api/trackpilot/status', '/api/tunapilot/status'], (req, res) => {
      res.json(tunapilotService.status());
    });

    app.post(['/api/trackpulse/track', '/api/trackflow/track', '/api/trackpilot/track', '/api/tunapilot/track'], (req, res) => {
      try {
        const state = tunapilotService.updateTrack(req.body || {}, tunapilot.getAll());
        res.json({ ok: true, state });
      } catch (e) {
        res.status(409).json({ error: e.message || 'track update failed' });
      }
    });

    app.post(['/api/trackpulse/ingest', '/api/trackflow/ingest', '/api/trackpilot/ingest', '/api/tunapilot/ingest'], (req, res) => {
      try {
        const state = tunapilotService.updateTrack(req.body || {}, tunapilot.getAll());
        res.json({ ok: true, state });
      } catch (e) {
        res.status(409).json({ error: e.message || 'ingest failed' });
      }
    });

    app.post(['/api/trackpulse/clear', '/api/trackflow/clear', '/api/trackpilot/clear', '/api/tunapilot/clear'], (req, res) => {
      try {
        const state = tunapilotService.clearTrack(tunapilot.getAll());
        res.json({ ok: true, state });
      } catch (e) {
        res.status(500).json({ error: e.message || 'clear failed' });
      }
    });

    // TrackPulse OBS helpers (source list for player target)
    app.post(['/api/trackpulse/obs/sources', '/api/trackflow/obs/sources', '/api/trackpilot/obs/sources', '/api/tunapilot/obs/sources'], async (req, res) => {
      try {
        // Nutze die bereits bestehende ScenePilot-OBS-Verbindung
        if (!scenepilotService.connected) {
          return res.status(503).json({ ok: false, error: 'OBS nicht verbunden. Bitte zuerst im Hub verbinden.' });
        }

        const inputs = await scenepilotService.listInputs();

        // Audio-relevante Source-Typen
        const audioSourceTypes = new Set([
          'vlc_source', 'ffmpeg_source',
          'wasapi_input_capture', 'wasapi_output_capture',
          'pulse_input_capture', 'pulse_output_capture',
          'av_capture_input', 'coreaudio_input_capture',
        ]);

        const categorized = { vlc: [], media: [], audio: [], browser: [], other: [] };

        inputs.forEach(inp => {
          const item = { name: inp.inputName, kind: inp.inputKind };
          if (inp.inputKind === 'vlc_source') categorized.vlc.push(item);
          else if (inp.inputKind === 'ffmpeg_source') categorized.media.push(item);
          else if (audioSourceTypes.has(inp.inputKind)) categorized.audio.push(item);
          else if (inp.inputKind === 'browser_source') categorized.browser.push(item);
          else categorized.other.push(item);
        });

        const allSources = [
          ...categorized.vlc.map(s => ({ ...s, label: `[VLC] ${s.name}` })),
          ...categorized.media.map(s => ({ ...s, label: `[Media] ${s.name}` })),
          ...categorized.audio.map(s => ({ ...s, label: `[Audio] ${s.name}` })),
          ...categorized.browser.map(s => ({ ...s, label: `[Browser] ${s.name}` })),
          ...categorized.other.map(s => ({ ...s, label: s.name })),
        ];

        res.json({ ok: true, sources: allSources, categorized });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message || 'Failed to fetch sources' });
      }
    });

    // New TrackPulse playlist/player APIs
    app.get(['/api/trackpulse/playlist', '/api/trackflow/playlist', '/api/trackpilot/playlist', '/api/tunapilot/playlist'], (req, res) => {
      const cfg = tunapilot.getAll();
      res.json({ playlist: cfg.playlist || [] });
    });

    app.post(['/api/trackpulse/playlist/add', '/api/trackflow/playlist/add', '/api/trackpilot/playlist/add', '/api/tunapilot/playlist/add'], async (req, res) => {
      try {
        const cfg = tunapilot.getAll();
        const out = await tunapilotService.addTrack(req.body?.path, cfg);
        const nextCfg = tunapilot.update({
          playlist: out.playlist,
          player: { ...(cfg.player || {}), currentIndex: out.status.player.currentIndex },
        });
        res.json({ ok: true, playlist: nextCfg.playlist, status: out.status });
      } catch (e) {
        res.status(400).json({ ok: false, error: e.message || 'add track failed' });
      }
    });

    app.post(['/api/trackpulse/playlist/add-many', '/api/trackflow/playlist/add-many', '/api/trackpilot/playlist/add-many', '/api/tunapilot/playlist/add-many'], async (req, res) => {
      try {
        const cfg = tunapilot.getAll();
        const out = await tunapilotService.addTracks(req.body?.paths || [], cfg);
        const nextCfg = tunapilot.update({
          playlist: out.playlist,
          player: { ...(cfg.player || {}), currentIndex: out.status.player.currentIndex },
        });
        res.json({ ok: true, added: out.added, playlist: nextCfg.playlist, status: out.status });
      } catch (e) {
        res.status(400).json({ ok: false, error: e.message || 'add tracks failed' });
      }
    });

    app.post(['/api/trackpulse/playlist/add-folder', '/api/tunapilot/playlist/add-folder'], async (req, res) => {
      try {
        const { folder } = req.body || {};
        if (!folder) return res.status(400).json({ ok: false, error: 'Ordner fehlt' });
        const cfg = tunapilot.getAll();
        const out = await tunapilotService.addTracksFromFolder(folder, cfg);
        const nextCfg = tunapilot.update({
          playlist: out.playlist,
          player: { ...(cfg.player || {}), currentIndex: out.status.player.currentIndex },
        });
        res.json({ ok: true, added: out.added, playlist: nextCfg.playlist, status: out.status });
      } catch (e) {
        res.status(400).json({ ok: false, error: e.message || 'Ordner Import fehlgeschlagen' });
      }
    });

    app.delete(['/api/trackpulse/playlist/:id', '/api/trackflow/playlist/:id', '/api/trackpilot/playlist/:id', '/api/tunapilot/playlist/:id'], (req, res) => {
      try {
        const cfg = tunapilot.getAll();
        const status = tunapilotService.removeTrack(req.params.id);
        const nextCfg = tunapilot.update({
          playlist: status.playlist || [],
          player: { ...(cfg.player || {}), currentIndex: status.player?.currentIndex ?? -1 },
        });
        res.json({ ok: true, playlist: nextCfg.playlist, status });
      } catch (e) {
        res.status(400).json({ ok: false, error: e.message || 'remove track failed' });
      }
    });

    app.post(['/api/trackpulse/playlist/clear', '/api/trackflow/playlist/clear', '/api/trackpilot/playlist/clear', '/api/tunapilot/playlist/clear'], (req, res) => {
      try {
        const cfg = tunapilot.getAll();
        const status = tunapilotService.clearPlaylist();
        const nextCfg = tunapilot.update({
          playlist: [],
          player: { ...(cfg.player || {}), currentIndex: -1 },
        });
        res.json({ ok: true, playlist: nextCfg.playlist, status });
      } catch (e) {
        res.status(400).json({ ok: false, error: e.message || 'clear playlist failed' });
      }
    });

    app.post(['/api/trackpulse/player/play', '/api/trackflow/player/play', '/api/trackpilot/player/play', '/api/tunapilot/player/play'], async (req, res) => {
      try {
        const cfg = tunapilot.getAll();
        if (!tunapilotService.running) {
          await tunapilotService.start(cfg);
        }
        const status = await tunapilotService.play(cfg, req.body?.index);
        const nextCfg = tunapilot.update({ player: { ...(cfg.player || {}), currentIndex: status.player.currentIndex } });
        res.json({ ok: true, status: { ...status, playlist: nextCfg.playlist || status.playlist } });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message || 'Failed to play track' });
      }
    });

    app.post(['/api/trackpulse/player/pause', '/api/trackflow/player/pause', '/api/trackpilot/player/pause', '/api/tunapilot/player/pause'], async (req, res) => {
      try {
        const cfg = tunapilot.getAll();
        const status = await tunapilotService.pause(cfg);
        res.json({ ok: true, status });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message || 'Failed to pause player' });
      }
    });

    app.post(['/api/trackpulse/player/resume', '/api/trackflow/player/resume', '/api/trackpilot/player/resume', '/api/tunapilot/player/resume'], async (req, res) => {
      try {
        const cfg = tunapilot.getAll();
        const status = await tunapilotService.resume(cfg);
        res.json({ ok: true, status });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message || 'Failed to resume player' });
      }
    });

    app.post(['/api/trackpulse/player/stop', '/api/trackflow/player/stop', '/api/trackpilot/player/stop', '/api/tunapilot/player/stop'], async (req, res) => {
      try {
        const cfg = tunapilot.getAll();
        const status = await tunapilotService.stopPlayer(cfg);
        res.json({ ok: true, status });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message || 'Failed to stop player' });
      }
    });

    app.post(['/api/trackpulse/player/next', '/api/trackflow/player/next', '/api/trackpilot/player/next', '/api/tunapilot/player/next'], async (req, res) => {
      try {
        const cfg = tunapilot.getAll();
        const status = await tunapilotService.next(cfg);
        const nextCfg = tunapilot.update({ player: { ...(cfg.player || {}), currentIndex: status.player.currentIndex } });
        res.json({ ok: true, status: { ...status, playlist: nextCfg.playlist || status.playlist } });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message || 'Failed to switch to next track' });
      }
    });

    app.post(['/api/trackpulse/player/prev', '/api/trackflow/player/prev', '/api/trackpilot/player/prev', '/api/tunapilot/player/prev'], async (req, res) => {
      try {
        const cfg = tunapilot.getAll();
        const status = await tunapilotService.prev(cfg);
        const nextCfg = tunapilot.update({ player: { ...(cfg.player || {}), currentIndex: status.player.currentIndex } });
        res.json({ ok: true, status: { ...status, playlist: nextCfg.playlist || status.playlist } });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message || 'Failed to switch to previous track' });
      }
    });

    // ── Volume control ────────────────────────────────────────────────
    app.post(['/api/trackpulse/player/volume', '/api/tunapilot/player/volume'], async (req, res) => {
      try {
        const volume = Math.max(0, Math.min(100, Number(req.body?.volume ?? 100)));
        const cfg = tunapilot.update({ player: { ...(tunapilot.getAll().player || {}), volume } });
        const src = (cfg?.obsPlayer?.sourceName || '').trim();
        if (src && scenepilotService.connected && scenepilotService.obs) {
          // OBS uses multiplier 0.0–1.0 for SetInputVolume (mul mode)
          await scenepilotService.obs.call('SetInputVolume', { inputName: src, inputVolumeMul: volume / 100 });
        }
        res.json({ ok: true, volume });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message || 'Volume fehlgeschlagen' });
      }
    });

    // ── Playlist reorder ──────────────────────────────────────────────
    app.post(['/api/trackpulse/playlist/reorder', '/api/tunapilot/playlist/reorder'], (req, res) => {
      try {
        const { from, to } = req.body || {};
        const status = tunapilotService.reorderTrack(Number(from), Number(to));
        tunapilot.update({ playlist: status.playlist, player: { ...(tunapilot.getAll().player || {}), currentIndex: status.player.currentIndex } });
        res.json({ ok: true, status });
      } catch (e) {
        res.status(400).json({ ok: false, error: e.message || 'Reorder fehlgeschlagen' });
      }
    });

    // ── Play next (queue jump) ────────────────────────────────────────
    app.post(['/api/trackpulse/playlist/play-next', '/api/tunapilot/playlist/play-next'], (req, res) => {
      try {
        const cfg = tunapilot.getAll();
        const status = tunapilotService.playNext(req.body?.id, cfg);
        tunapilot.update({ playlist: status.playlist, player: { ...(cfg.player || {}), currentIndex: status.player.currentIndex } });
        res.json({ ok: true, status });
      } catch (e) {
        res.status(400).json({ ok: false, error: e.message || 'Play-Next fehlgeschlagen' });
      }
    });

    // ── M3U export ────────────────────────────────────────────────────
    app.get(['/api/trackpulse/playlist/export.m3u', '/api/tunapilot/playlist/export.m3u'], (req, res) => {
      const cfg = tunapilot.getAll();
      const lines = ['#EXTM3U'];
      for (const t of (cfg.playlist || [])) {
        const dur = -1;
        const label = [t.artist, t.title].filter(Boolean).join(' - ') || t.path;
        lines.push(`#EXTINF:${dur},${label}`);
        lines.push(t.path);
      }
      res.setHeader('Content-Type', 'audio/x-mpegurl');
      res.setHeader('Content-Disposition', 'attachment; filename="trackpulse.m3u"');
      res.send(lines.join('\r\n'));
    });

    // ── M3U import ────────────────────────────────────────────────────
    app.post(['/api/trackpulse/playlist/import-m3u', '/api/tunapilot/playlist/import-m3u'], async (req, res) => {
      try {
        const text = String(req.body?.content || '');
        const lines = text.split(/\r?\n/);
        const paths = [];
        let extTitle = '', extArtist = '';
        for (const line of lines) {
          const l = line.trim();
          if (!l || l === '#EXTM3U') continue;
          if (l.startsWith('#EXTINF:')) {
            const info = l.slice(l.indexOf(',') + 1).trim();
            const dashIdx = info.indexOf(' - ');
            extArtist = dashIdx >= 0 ? info.slice(0, dashIdx).trim() : '';
            extTitle  = dashIdx >= 0 ? info.slice(dashIdx + 3).trim() : info;
          } else if (!l.startsWith('#')) {
            // Reject URLs and non-absolute paths — only local absolute file paths allowed
            if (/^https?:\/\//i.test(l) || /^ftp:\/\//i.test(l)) continue;
            if (l.includes('\0') || l.includes('..')) continue;
            paths.push(l);
          }
        }
        const cfg = tunapilot.getAll();
        const out = await tunapilotService.addTracks(paths, cfg);
        const nextCfg = tunapilot.update({ playlist: out.playlist, player: { ...(cfg.player || {}), currentIndex: out.status.player.currentIndex } });
        res.json({ ok: true, added: out.added.length, playlist: nextCfg.playlist });
      } catch (e) {
        res.status(400).json({ ok: false, error: e.message || 'M3U Import fehlgeschlagen' });
      }
    });

    // ── Now-Playing announce (for !song command) ──────────────────────
    app.get(['/api/trackpulse/announce', '/api/tunapilot/announce'], (req, res) => {
      const s = tunapilotService.status();
      const t = s.currentTrack || {};
      const text = [t.artist, t.title].filter(Boolean).join(' — ') || 'Keine Wiedergabe';
      broadcastSafely({ type: 'TRACKPULSE_ANNOUNCE', payload: { text, track: t } });
      res.json({ ok: true, text });
    });

    // ── Named playlists CRUD ──────────────────────────────────────────
    app.get(['/api/trackpulse/named-playlists', '/api/tunapilot/named-playlists'], (req, res) => {
      const cfg = tunapilot.getAll();
      res.json({ namedPlaylists: cfg.namedPlaylists || [] });
    });

    app.post(['/api/trackpulse/named-playlists', '/api/tunapilot/named-playlists'], (req, res) => {
      try {
        const { id, name, tracks } = req.body || {};
        const cfg = tunapilot.getAll();
        const list = [...(cfg.namedPlaylists || [])];
        const uid = id || `pl-${Date.now().toString(36)}`;
        const existing = list.findIndex(p => p.id === uid);
        const entry = { id: uid, name: String(name || uid), tracks: Array.isArray(tracks) ? tracks : [] };
        if (existing >= 0) list[existing] = entry; else list.push(entry);
        const updated = tunapilot.update({ namedPlaylists: list });
        res.json({ ok: true, namedPlaylists: updated.namedPlaylists });
      } catch (e) {
        res.status(400).json({ ok: false, error: e.message });
      }
    });

    app.delete(['/api/trackpulse/named-playlists/:id', '/api/tunapilot/named-playlists/:id'], (req, res) => {
      const cfg = tunapilot.getAll();
      const list = (cfg.namedPlaylists || []).filter(p => p.id !== req.params.id);
      const updated = tunapilot.update({ namedPlaylists: list });
      res.json({ ok: true, namedPlaylists: updated.namedPlaylists });
    });

    // ── Scene → Playlist mapping ──────────────────────────────────────
    app.get(['/api/trackpulse/scene-playlists', '/api/tunapilot/scene-playlists'], (req, res) => {
      const cfg = tunapilot.getAll();
      res.json({ scenePlaylists: cfg.scenePlaylists || {} });
    });

    app.patch(['/api/trackpulse/scene-playlists', '/api/tunapilot/scene-playlists'], (req, res) => {
      try {
        const patch = req.body || {};
        const cfg = tunapilot.getAll();
        const updated = tunapilot.update({ scenePlaylists: { ...(cfg.scenePlaylists || {}), ...patch } });
        res.json({ ok: true, scenePlaylists: updated.scenePlaylists });
      } catch (e) {
        res.status(400).json({ ok: false, error: e.message });
      }
    });

    registerPlatformAuthRoutes(app, {
      authManager,
      twitchApiService,
      chatdeck,
      chatdeckService,
      platformEvents,
      broadcastSafely,
      TWITCH_SCOPES,
    });

    registerChatdeckRoutes(app, {
      chatdeck,
      chatdeckService,
      authManager,
      twitchApiService,
      chatBus,
      platformEvents,
      broadcastSafely,
    });

    registerAlertDeckRoutes(app, {
      alertdeckConfig,
      platformEvents,
      alertdeckMediaDir,
    });

    // Electron file picker API (only available in Electron app)
    app.post('/api/electron/pick-files', async (req, res) => {
      if (!electronPickFiles) {
        return res.status(503).json({ ok: false, error: 'Datei-Auswahl ist nur in der Electron-App verfügbar' });
      }
      try {
        const result = await electronPickFiles();
        res.json({ ok: true, paths: result.paths || [] });
      } catch (e) {
        res.status(400).json({ ok: false, error: e.message || 'File picker failed' });
      }
    });

    app.post('/api/electron/pick-folder', async (req, res) => {
      if (!electronPickFolder) {
        return res.status(503).json({ ok: false, error: 'Ordner-Auswahl ist nur in der Electron-App verfügbar' });
      }
      try {
        const result = await electronPickFolder();
        res.json({ ok: true, folder: result.folder || null });
      } catch (e) {
        res.status(400).json({ ok: false, error: e.message || 'Folder picker failed' });
      }
    });

    // Cover art endpoint — serves embedded cover art by track ID without bloating WS broadcasts
    app.get(['/api/trackpulse/cover/:id', '/api/tunapilot/cover/:id'], (req, res) => {
      const art = tunapilotService.getCoverArt(req.params.id);
      if (!art) return res.status(404).end();
      try {
        const commaIdx = art.indexOf(',');
        const mime = art.slice(0, commaIdx).match(/data:([^;]+)/)?.[1] || 'image/jpeg';
        const buf  = Buffer.from(art.slice(commaIdx + 1), 'base64');
        res.setHeader('Content-Type', mime);
        res.setHeader('Cache-Control', 'max-age=3600, private');
        res.send(buf);
      } catch {
        res.status(500).end();
      }
    });

    // Generic tool route for future modules
    app.get('/tool/:id', (req, res) => {
      const tool = getToolById(req.params.id);
      if (!tool) return res.status(404).json({ error: 'Unknown tool' });
      if (tool.status !== 'ready') return res.status(409).json({ error: 'Tool not ready yet' });
      if (tool.id === 'splitflow')  return res.sendFile(path.join(splitflowDir, 'index.html'));
      if (tool.id === 'flowforge')  return res.sendFile(path.join(flowforgeDir, 'index.html'));
      if (tool.id === 'scenepilot') return res.sendFile(path.join(scenepilotDir, 'index.html'));
      if (tool.id === 'trackpulse')  return res.sendFile(path.join(tunapilotDir,   'index.html'));
      if (tool.id === 'controldeck') return res.sendFile(path.join(controldeckDir, 'index.html'));
      if (tool.id === 'chatdeck')   return res.sendFile(path.join(chatdeckDir,    'index.html'));
      if (tool.id === 'alertdeck')  return res.sendFile(path.join(alertdeckDir,   'index.html'));
      return res.status(501).json({ error: 'Tool route not implemented yet' });
    });

    // OAuth Setup Page
    app.get('/auth', (req, res) => {
      res.sendFile(path.join(__dirname, 'views', 'auth.html'));
    });
    app.get('/auth/setup', (req, res) => {
      res.sendFile(path.join(__dirname, 'views', 'auth.html'));
    });

    // Backward-compatible legacy route — 301 permanent redirect
    app.get('/dashboard',   (req, res) => res.redirect(301, '/tool/splitflow'));
    app.get('/dashboard/*', (req, res) => res.redirect(301, '/tool/splitflow'));
  }

  // Overlay server: serves overlay.html + minimal read-only API so the overlay
  // can load its saved settings and initial timer state on boot.
  if (!dashboard) {
    // Specific routes BEFORE express.static — static middleware would otherwise
    // find index.html in splitflowDir and serve the dashboard for /splitflow.
    app.get('/', (req, res) => res.redirect('/splitflow'));
    app.get('/splitflow', (req, res) => {
      res.sendFile(path.join(splitflowDir, 'overlay.html'));
    });
    // Static middleware for sub-path assets (fonts, injected CSS, etc.)
    app.use('/splitflow', express.static(splitflowDir));
    app.get('/splitflow/*', (req, res) => {
      res.sendFile(path.join(splitflowDir, 'overlay.html'));
    });

    // Read-only API — overlay.html needs these two endpoints on boot to apply
    // saved appearance settings and show the current timer state immediately.
    app.get('/api/settings', (req, res) => {
      try { res.json(settings.getAll()); } catch { res.json({}); }
    });
    app.get('/api/timer/state', (req, res) => {
      try { res.json(timer.getSnapshot()); } catch { res.json({ state: 'idle', elapsed: 0 }); }
    });

    const server = http.createServer(app);
    return { app, server };
  }

  // ─── REST API (dashboard server only) ──
  registerCoreStateRoutes(app, {
    timer,
    splits,
    settings,
    getBroadcast,
    reloadHotkeys: () => require('./hotkeys').reloadHotkeys(),
  });

  // Fallback → index.html (SPA)
  app.get('*', (req, res) => {
    res.sendFile(path.join(staticDir, 'index.html'));
  });

  const server = http.createServer(app);
  return { app, server };
}

module.exports = { createOverlayServer };
