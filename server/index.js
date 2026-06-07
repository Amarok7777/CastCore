const { createOverlayServer }   = require('./httpServer');
const { createWsServer }        = require('./wsServer');
const authManager = require('./authManager');
const chatBus = require('./chatBus');
const platformEvents = require('./platformEvents');
const alertQueue = require('./alertQueue');
const timer = require('../core/timer');
const scenepilot = require('../core/scenepilot');
const tunapilot = require('../core/tunapilot');
const scenepilotService = require('./scenepilotService');
const tunapilotService  = require('./tunapilotService');
const flowforgeEngine   = require('./flowforgeEngine');

// Lazy getter to avoid circular requires
function getBroadcast() { return require('./wsServer').broadcast; }

let overlayServer   = null;
let dashboardServer = null;
let oauthLoopbackServer = null;

function createOAuthLoopbackServer(dashboardPort) {
  return require('http').createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body style="font-family:sans-serif;padding:24px;background:#0e0e10;color:#efece8"><h3>CastCore OAuth bereit</h3><p>Dieser lokale Callback wird fuer Twitch- und YouTube-Logins verwendet.</p></body></html>');
        return;
      }
      const target = new URL(`http://localhost:${dashboardPort}/auth/oauth/callback`);
      for (const [key, value] of url.searchParams.entries()) target.searchParams.set(key, value);
      res.writeHead(302, { Location: target.toString() });
      res.end();
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('OAuth callback forwarding failed');
    }
  });
}

async function startServers({ overlayPort, dashboardPort, toolRuntime = null, electronPickFiles = null, electronPickFolder = null }) {
  // Initialize centralized auth manager
  authManager.init();
  
  // Load persisted platform events
  platformEvents.init();

  const { server: oSrv } = createOverlayServer({ overlayPort, dashboardPort });
  const { server: dSrv } = createOverlayServer({ dashboard: true, toolRuntime, electronPickFiles, electronPickFolder, overlayPort, dashboardPort });

  overlayServer   = oSrv;
  dashboardServer = dSrv;

  // Attach WebSocket to both servers — overlay + dashboard both need live timer updates.
  createWsServer(overlayServer);
  createWsServer(dashboardServer);

  await listen(overlayServer,   overlayPort);
  await listen(dashboardServer, dashboardPort);
  oauthLoopbackServer = createOAuthLoopbackServer(dashboardPort);
  try {
    await listen(oauthLoopbackServer, 80);
  } catch (err) {
    console.warn(`[OAuth] Port 80 nicht verfügbar (${err.code}) — OAuth-Callback über externen Browser funktioniert möglicherweise nicht.`);
    oauthLoopbackServer = null;
  }

  scenepilotService.attachTimer(timer, () => scenepilot.getAll());
  flowforgeEngine.attach({ timer, scenepilotService, tunapilotService });
  scenepilotService.attachOBSVolumeSync((msg) => {
    try { getBroadcast()({ type: 'SCENEPILOT_EVENT', payload: msg }); } catch { /* non-fatal */ }
  });

  tunapilotService.attachStatusBroadcast((msg) => {
    try { getBroadcast()(msg); } catch { /* non-fatal */ }
  });

  // Forward Twitch chat messages from authManager to all WS clients
  // so that ChatLink (and any other tool) can receive them without a separate IRC connection
  authManager.onTwitchChat((msg) => {
    const result = chatBus.addMessage(msg);
    if (!result.added) return;
    try { getBroadcast()({ type: 'CHAT_MESSAGE', payload: result.message }); } catch { /* non-fatal */ }
    flowforgeEngine.onChatMessage(result.message);
  });

  authManager.onTwitchEvent((evt) => {
    const result = platformEvents.add(evt);
    if (!result.added) return;
    alertQueue.push(result.item);
    try { getBroadcast()({ type: 'ALERT_EVENT', payload: result.item }); } catch { /* non-fatal */ }
    flowforgeEngine.onAlertEvent(result.item);
  });

  const cfg = scenepilot.getAll();
  if (cfg.obs?.enabled && cfg.obs?.autoConnect) {
    scenepilotService.connect(cfg.obs.address, cfg.obs.password).catch(() => {
      // non-fatal: user can connect manually in ScenePilot UI
    });
  }

  const tunaCfg = tunapilot.getAll();
  if (tunaCfg.enabled) {
    try {
      await tunapilotService.start(tunaCfg);
    } catch (err) {
      console.error('[TrackPulse] Auto-start failed:', err.message);
      // non-fatal: user can start manually in Tool Hub
    }
  }

  console.log(`[CastCore] Overlay    → http://localhost:${overlayPort}`);
  console.log(`[CastCore] Dashboard  → http://localhost:${dashboardPort}`);
}

async function stopServers() {
  try { await tunapilotService.stop(tunapilot.getAll()); } catch { /* non-fatal */ }
  await scenepilotService.disconnect();
  await closeServer(oauthLoopbackServer);
  await closeServer(overlayServer);
  await closeServer(dashboardServer);
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', resolve).on('error', (err) => {
      err.port = port;   // attach port number so callers can show it
      reject(err);
    });
  });
}

function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise(resolve => server.close(resolve));
}

module.exports = { startServers, stopServers };
