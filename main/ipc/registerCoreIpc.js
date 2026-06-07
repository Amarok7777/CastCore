const { registerTimerIpc } = require('./timerIpc');
const { registerSplitsIpc } = require('./splitsIpc');
const { registerSettingsIpc } = require('./settingsIpc');
const { registerAppIpc } = require('./appIpc');
const { registerTrackpulseIpc } = require('./trackpulseIpc');

function registerCoreIpc(deps) {
  return {
    timer: registerTimerIpc(deps),
    splits: registerSplitsIpc(deps),
    settings: registerSettingsIpc(deps),
    app: registerAppIpc(deps),
    trackpulse: registerTrackpulseIpc(deps),
  };
}

module.exports = { registerCoreIpc };
