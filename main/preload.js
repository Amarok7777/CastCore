const { contextBridge, ipcRenderer } = require('electron');
const { IPC_CHANNELS } = require('../shared/ipc-channels');

// Expose a safe, typed API to the dashboard renderer process.
// The renderer never gets direct access to Node or Electron internals.
contextBridge.exposeInMainWorld('splitflow', {
  // Timer
  timerAction: (action) => ipcRenderer.invoke(IPC_CHANNELS.TIMER_ACTION, action),

  // Splits profiles
  getAllProfiles:  ()     => ipcRenderer.invoke(IPC_CHANNELS.SPLITS_GET_ALL),
  loadProfile:    (id)   => ipcRenderer.invoke(IPC_CHANNELS.SPLITS_LOAD, id),
  saveProfile:    (data) => ipcRenderer.invoke(IPC_CHANNELS.SPLITS_SAVE, data),
  deleteProfile:  (id)   => ipcRenderer.invoke(IPC_CHANNELS.SPLITS_DELETE, id),
  importLSS:      ()     => ipcRenderer.invoke(IPC_CHANNELS.SPLITS_IMPORT_LSS),
  exportLSS:      (id)   => ipcRenderer.invoke(IPC_CHANNELS.SPLITS_EXPORT_LSS, id),

  // Settings
  getSettings: ()       => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
  setSettings: (patch)  => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, patch),

  // Utility
  openOverlay: () => ipcRenderer.invoke(IPC_CHANNELS.APP_OPEN_OVERLAY),
  openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.APP_OPEN_EXTERNAL, url),
});
