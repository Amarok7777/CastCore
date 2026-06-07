function registerSettingsIpc({ ipcMain, settings, reloadHotkeys, IPC_CHANNELS }) {
  const state = { hotkeysReloadedAt: 0 };

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => settings.getAll());

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (_event, rawPatch) => {
    // Only accept plain objects; reject null, arrays, primitives
    if (!rawPatch || typeof rawPatch !== 'object' || Array.isArray(rawPatch)) return settings.getAll();
    const updated = settings.update(rawPatch);
    if (rawPatch.hotkeys) {
      reloadHotkeys();
      state.hotkeysReloadedAt = Date.now();
    }
    return updated;
  });

  return {
    getState: () => ({ ...state }),
  };
}

module.exports = { registerSettingsIpc };
