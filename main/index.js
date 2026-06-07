/**
 * main/index.js — Electron main process
 *
 * Responsibilities:
 *  - Create the BrowserWindow (dashboard) and tray icon
 *  - Start the HTTP/WS servers
 *  - Register all IPC handlers that preload.js exposes to the renderer
 */

const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, nativeImage, shell } = require('electron');

Menu.setApplicationMenu(null);
const path    = require('path');
const timer   = require('../core/timer');
const splits  = require('../core/splits');
const settings= require('../core/settings');
const tunapilot = require('../core/tunapilot');
const tunapilotService = require('../server/tunapilotService');
const splitflowService = require('../server/splitflowService');
const { startServers, stopServers } = require('../server');
const { reloadHotkeys }             = require('../server/hotkeys');
const { IPC_CHANNELS }              = require('../shared/ipc-channels');
const { registerCoreIpc }           = require('./ipc/registerCoreIpc');

// ─── Config ────────────────────────────────────────────────────────────────────

const OVERLAY_PORT   = 7331;
const DASHBOARD_PORT = 7332;

// ─── Tool runtime state ──────────────────────────────────────────────────────

let scenepilotRuntimeWindow = null;

const toolRuntimeState = {
  splitflow: {
    running: false,
    lastError: null,
  },
  scenepilot: {
    running: false,
    lastError: null,
  },
  trackpulse: {
    running: false,
    lastError: null,
  },
};

// ─── Single-instance lock ──────────────────────────────────────────────────────
// Prevents "port already in use" crash when a second copy is launched while
// the tray icon is still running in the background.
if (!app.requestSingleInstanceLock()) {
  // A SplitFlow instance is already running — bring its window to front and quit.
  app.quit();
  process.exit(0);
}

// Safety net: replace Electron's raw "A JavaScript error occurred" dialog with
// a user-friendly message box for any uncaught main-process exception.
process.on('uncaughtException', (err) => {
  const msg = err.code === 'EADDRINUSE'
    ? `Port ${err.port ?? OVERLAY_PORT} is already in use.\n\nAnother CastCore may already be running in the system tray — right-click its icon and choose Quit first.`
    : `Unexpected error:\n${err.message}`;
  try { dialog.showErrorBox('CastCore — Startup Error', msg); } catch {}
  app.exit(1);
});

// ─── App lifecycle ─────────────────────────────────────────────────────────────

let mainWindow = null;
let tray       = null;

// When a second instance is launched, focus the existing window instead.
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  try {
    const electronPickFiles = async () => {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'TrackPulse: Audio-Dateien auswahlen',
        filters: [{ name: 'Audio', extensions: ['mp3', 'flac', 'ogg', 'm4a', 'aac', 'wma', 'wav'] }],
        properties: ['openFile', 'multiSelections'],
      });
      if (canceled || !filePaths.length) return { paths: [] };
      return { paths: filePaths };
    };

    const electronPickFolder = async () => {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'TrackPulse: Ordner auswählen',
        properties: ['openDirectory'],
      });
      if (canceled || !filePaths.length) return { folder: null };
      return { folder: filePaths[0] };
    };

    await startServers({
      overlayPort: OVERLAY_PORT,
      dashboardPort: DASHBOARD_PORT,
      toolRuntime: {
        start: startToolRuntime,
        stop: stopToolRuntime,
        getStatus: getToolRuntimeStatus,
        getAllStatuses: getAllToolRuntimeStatuses,
      },
      electronPickFiles,
      electronPickFolder,
    });
  } catch (err) {
    const msg = err.code === 'EADDRINUSE'
      ? `Port ${err.port ?? (err.message.match(/\d+/) || [])[0] ?? 'required'} is already in use.\n\nClose the existing CastCore window and try again.`
      : `Failed to start servers:\n${err.message}`;
    dialog.showErrorBox('CastCore — Startup Error', msg);
    app.exit(1);
    return;
  }

  // Auto-start SplitFlow service (hotkeys + timer) just like TrackPulse auto-starts
  splitflowService.start().catch(err => {
    console.error('[SplitFlow] Auto-start failed:', err.message);
  });
  toolRuntimeState.splitflow.running = splitflowService.status().running;

  createMainWindow();
  createTray();
  registerIpcHandlers();
  checkForUpdates();
});

app.on('window-all-closed', () => {
  // keep alive in tray — never auto-quit when window closes
});

app.on('before-quit', async () => {
  destroyScenepilotRuntimeWindow();
  await splitflowService.stop().catch(() => {});
  await stopServers();
});

// ─── Tool runtime control ────────────────────────────────────────────────────

function getToolRuntimeStatus(id) {
  id = normalizeToolId(id);
  if (!toolRuntimeState[id]) {
    return { running: false, lastError: 'unknown-tool' };
  }
  if (id === 'splitflow') {
    const s = splitflowService.status();
    toolRuntimeState.splitflow.running   = s.running;
    toolRuntimeState.splitflow.lastError = s.lastError;
  }
  if (id === 'scenepilot') {
    const running = !!(scenepilotRuntimeWindow && !scenepilotRuntimeWindow.isDestroyed());
    toolRuntimeState.scenepilot.running = running;
  }
  if (id === 'trackpulse') {
    toolRuntimeState.trackpulse.running = !!tunapilotService.status().running;
  }
  return { ...toolRuntimeState[id] };
}

function getAllToolRuntimeStatuses() {
  return {
    splitflow: getToolRuntimeStatus('splitflow'),
    scenepilot: getToolRuntimeStatus('scenepilot'),
    trackpulse: getToolRuntimeStatus('trackpulse'),
  };
}

async function startToolRuntime(id) {
  id = normalizeToolId(id);

  if (id === 'splitflow') {
    try {
      await splitflowService.start();
      toolRuntimeState.splitflow.running   = true;
      toolRuntimeState.splitflow.lastError = null;
    } catch (e) {
      toolRuntimeState.splitflow.running   = false;
      toolRuntimeState.splitflow.lastError = e.message || 'start-failed';
    }
    return getToolRuntimeStatus('splitflow');
  }

  if (id === 'trackpulse') {
    try {
      const cfg = tunapilot.getAll();
      await tunapilotService.start(cfg);
      toolRuntimeState.trackpulse.running   = true;
      toolRuntimeState.trackpulse.lastError = null;
    } catch (e) {
      toolRuntimeState.trackpulse.running   = false;
      toolRuntimeState.trackpulse.lastError = e.message || 'runtime-start-failed';
    }
    return getToolRuntimeStatus('trackpulse');
  }

  if (id !== 'scenepilot') return { running: false, lastError: 'unknown-tool' };

  if (scenepilotRuntimeWindow && !scenepilotRuntimeWindow.isDestroyed()) {
    toolRuntimeState.scenepilot.running = true;
    toolRuntimeState.scenepilot.lastError = null;
    return getToolRuntimeStatus('scenepilot');
  }

  const win = new BrowserWindow({
    show: false,
    width: 1000,
    height: 760,
    title: 'ScenePilot Runtime',
    webPreferences: {
      preload:                   path.join(__dirname, 'preload.js'),
      contextIsolation:          true,
      nodeIntegration:           false,
      webSecurity:               true,
      allowRunningInsecureContent: false,
      sandbox:                   true,
      backgroundThrottling:      false,
    },
  });

  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'midi' || permission === 'midiSysex');
  });

  scenepilotRuntimeWindow = win;
  toolRuntimeState.scenepilot.running = false;
  toolRuntimeState.scenepilot.lastError = null;

  win.on('closed', () => {
    scenepilotRuntimeWindow = null;
    toolRuntimeState.scenepilot.running = false;
  });

  win.webContents.on('did-fail-load', (_e, code, desc) => {
    toolRuntimeState.scenepilot.running = false;
    toolRuntimeState.scenepilot.lastError = `load-failed:${code}:${desc}`;
  });

  try {
    await win.loadURL(`http://localhost:${DASHBOARD_PORT}/tool/scenepilot?runtime=bg`);
    toolRuntimeState.scenepilot.running = true;
    toolRuntimeState.scenepilot.lastError = null;
  } catch (e) {
    toolRuntimeState.scenepilot.running = false;
    toolRuntimeState.scenepilot.lastError = e.message || 'runtime-start-failed';
    destroyScenepilotRuntimeWindow();
  }

  return getToolRuntimeStatus('scenepilot');
}

async function stopToolRuntime(id) {
  id = normalizeToolId(id);

  if (id === 'splitflow') {
    try {
      await splitflowService.stop();
    } catch { /* non-fatal */ }
    toolRuntimeState.splitflow.running   = false;
    toolRuntimeState.splitflow.lastError = null;
    return getToolRuntimeStatus('splitflow');
  }

  if (id === 'trackpulse') {
    try {
      await tunapilotService.stop(tunapilot.getAll());
      toolRuntimeState.trackpulse.running   = false;
      toolRuntimeState.trackpulse.lastError = null;
    } catch (e) {
      toolRuntimeState.trackpulse.lastError = e.message || 'runtime-stop-failed';
    }
    return getToolRuntimeStatus('trackpulse');
  }

  if (id !== 'scenepilot') return { running: false, lastError: 'unknown-tool' };

  destroyScenepilotRuntimeWindow();
  toolRuntimeState.scenepilot.running = false;
  return getToolRuntimeStatus('scenepilot');
}

function destroyScenepilotRuntimeWindow() {
  if (!scenepilotRuntimeWindow || scenepilotRuntimeWindow.isDestroyed()) return;
  scenepilotRuntimeWindow.destroy();
  scenepilotRuntimeWindow = null;
}

function normalizeToolId(id) {
  return (id === 'tunapilot' || id === 'trackpilot' || id === 'trackflow') ? 'trackpulse' : id;
}

// ─── BrowserWindow ─────────────────────────────────────────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width:  960,
    height: 700,
    title:  'CastCore',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color:       '#060c10',
      symbolColor: '#8ca8b4',
      height:      47,
    },
    webPreferences: {
      preload:                   path.join(__dirname, 'preload.js'),
      contextIsolation:          true,
      nodeIntegration:           false,
      webSecurity:               true,
      allowRunningInsecureContent: false,
      sandbox:                   true,
    },
  });

  // setPermissionRequestHandler: called when the renderer requests a new permission.
  // setPermissionCheckHandler:   called synchronously for every permission check —
  //   overrides any cached denial so the user never has to re-grant manually.
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'midi' || permission === 'midiSysex');
  });
  mainWindow.webContents.session.setPermissionCheckHandler((_wc, permission) => {
    if (permission === 'midi' || permission === 'midiSysex') return true;
    return null; // default handling for all other permissions
  });

  mainWindow.loadURL(`http://localhost:${DASHBOARD_PORT}`);

  // Log renderer console output to main-process stdout for debugging
  mainWindow.webContents.on('console-message', (event) => {
    const level = event.level ?? event.arguments?.[0];
    const msg   = event.message ?? event.arguments?.[1];
    const line  = event.lineNumber ?? event.arguments?.[3];
    const src   = event.sourceId ?? event.arguments?.[4];
    if (level >= 2) console.error(`[Renderer ERROR] ${msg}  (${src}:${line})`);
    else if (level === 1) console.warn(`[Renderer WARN] ${msg}`);
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error(`[Renderer] did-fail-load: ${desc} (${code})`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[Renderer] render-process-gone:', details.reason);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── Tray ──────────────────────────────────────────────────────────────────────

function createTray() {
  // Use a blank 16×16 image as fallback if no icon asset exists yet.
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('CastCore');
  refreshTrayMenu();

  // Update tray label whenever the timer state changes
  timer.on('update', (snapshot) => {
    tray.setToolTip(`CastCore — ${snapshot.state}`);
    refreshTrayMenu(snapshot);
  });
}

function refreshTrayMenu(snapshot = null) {
  const state = snapshot?.state ?? 'idle';

  const menu = Menu.buildFromTemplate([
    { label: 'Open Tool Hub', click: () => {
        if (mainWindow) { mainWindow.focus(); }
        else { createMainWindow(); }
      }
    },
    { type: 'separator' },
    { label: `Timer: ${state}`, enabled: false },
    { label: 'Start / Split', click: () => timer.dispatch('start') },
    { label: 'Pause',         click: () => timer.dispatch('pause') },
    { label: 'Reset',         click: () => timer.dispatch('reset') },
    { type: 'separator' },
    { label: 'Quit CastCore', click: () => app.quit() },
  ]);

  tray.setContextMenu(menu);
}

// ─── IPC handlers ──────────────────────────────────────────────────────────────
// These correspond 1-to-1 with the channels exposed in preload.js.

function registerIpcHandlers() {
  registerCoreIpc({
    ipcMain,
    dialog,
    shell,
    timer,
    splits,
    settings,
    reloadHotkeys,
    overlayPort: OVERLAY_PORT,
    IPC_CHANNELS,
  });

}

// ─── Auto-Update ───────────────────────────────────────────────────────────────

function checkForUpdates() {
  if (!app.isPackaged) return;

  // Lazy-load so the module-level crash from electron-updater doesn't affect dev mode
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = false;
  autoUpdater.logger = null;

  autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox({
      type: 'info',
      title: 'Update verfügbar',
      message: `Version ${info.version} ist verfügbar.`,
      detail: 'Soll das Update jetzt heruntergeladen werden? Die App startet danach neu.',
      buttons: ['Jetzt herunterladen', 'Später'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.downloadUpdate();
      }
    });
  });

  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox({
      type: 'info',
      title: 'Update bereit',
      message: 'Update wurde heruntergeladen.',
      detail: 'Die App wird jetzt neu gestartet und das Update installiert.',
      buttons: ['Neu starten'],
    }).then(() => {
      autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.on('error', (err) => {
    console.warn('[AutoUpdate] Fehler:', err.message);
  });

  autoUpdater.checkForUpdates().catch(() => {});
}
