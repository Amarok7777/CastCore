function registerSplitsIpc({ ipcMain, dialog, splits, timer, settings, IPC_CHANNELS }) {
  const state = { activeProfileId: null };

  ipcMain.handle(IPC_CHANNELS.SPLITS_GET_ALL, () => splits.getAllProfiles());

  ipcMain.handle(IPC_CHANNELS.SPLITS_LOAD, (_event, id) => {
    const profile = splits.loadProfile(id);
    timer.loadProfile(profile);
    state.activeProfileId = String(id || '');
    settings.update({ activeProfileId: id });
    return profile;
  });

  ipcMain.handle(IPC_CHANNELS.SPLITS_SAVE, (_event, data) => {
    const id = splits.saveProfile(data);
    return { id };
  });

  ipcMain.handle(IPC_CHANNELS.SPLITS_DELETE, (_event, id) => {
    splits.deleteProfile(id);
    if (settings.get('activeProfileId') === id) {
      settings.update({ activeProfileId: null });
      state.activeProfileId = null;
    }
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.SPLITS_IMPORT_LSS, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Import LiveSplit file',
      filters: [{ name: 'LiveSplit', extensions: ['lss'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths.length) return null;

    const profile = splits.importLSS(filePaths[0]);
    timer.loadProfile(profile);
    state.activeProfileId = String(profile.id || '');
    settings.update({ activeProfileId: profile.id });
    return profile;
  });

  ipcMain.handle(IPC_CHANNELS.SPLITS_EXPORT_LSS, async (_event, id) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export as LiveSplit file',
      defaultPath: `${id}.lss`,
      filters: [{ name: 'LiveSplit', extensions: ['lss'] }],
    });
    if (canceled || !filePath) return { ok: false };

    splits.exportLSS(id, filePath);
    return { ok: true, filePath };
  });

  return {
    getState: () => ({ ...state }),
  };
}

module.exports = { registerSplitsIpc };
