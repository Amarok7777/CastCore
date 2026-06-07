const VALID_TIMER_ACTIONS = new Set(['start', 'pause', 'resume', 'reset', 'split', 'undo', 'skip']);

function registerTimerIpc({ ipcMain, timer, IPC_CHANNELS }) {
  const state = { lastAction: null };

  ipcMain.handle(IPC_CHANNELS.TIMER_ACTION, (_event, action) => {
    const safe = VALID_TIMER_ACTIONS.has(action) ? action : null;
    if (!safe) return timer.getSnapshot();
    state.lastAction = safe;
    timer.dispatch(safe);
    return timer.getSnapshot();
  });

  return {
    getState: () => ({ ...state }),
  };
}

module.exports = { registerTimerIpc };
