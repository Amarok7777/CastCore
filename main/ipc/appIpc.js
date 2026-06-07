function registerAppIpc({ ipcMain, shell, overlayPort, IPC_CHANNELS }) {
  const state = { lastOpenedUrl: '' };

  ipcMain.handle(IPC_CHANNELS.APP_OPEN_OVERLAY, () => {
    const url = `http://localhost:${overlayPort}`;
    state.lastOpenedUrl = url;
    shell.openExternal(url);
    return { url };
  });

  ipcMain.handle(IPC_CHANNELS.APP_OPEN_EXTERNAL, (_event, targetUrl) => {
    const url = String(targetUrl || '').trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('Invalid external URL');
    state.lastOpenedUrl = url;
    return shell.openExternal(url);
  });

  return {
    getState: () => ({ ...state }),
  };
}

module.exports = { registerAppIpc };
