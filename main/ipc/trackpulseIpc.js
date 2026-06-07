function registerTrackpulseIpc({ ipcMain, dialog, IPC_CHANNELS }) {
  const state = { lastSelectionCount: 0 };

  ipcMain.handle(IPC_CHANNELS.TRACKPULSE_PICK_FILES, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'TrackPulse: Audio-Dateien auswahlen',
      filters: [{ name: 'Audio', extensions: ['mp3', 'flac', 'ogg', 'm4a', 'aac', 'wma', 'wav'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (canceled || !filePaths.length) {
      state.lastSelectionCount = 0;
      return { paths: [] };
    }
    state.lastSelectionCount = filePaths.length;
    return { paths: filePaths };
  });

  return {
    getState: () => ({ ...state }),
  };
}

module.exports = { registerTrackpulseIpc };
