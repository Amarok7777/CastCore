const IPC_CHANNELS = Object.freeze({
  TIMER_ACTION: 'timer:action',
  SPLITS_GET_ALL: 'splits:getAll',
  SPLITS_LOAD: 'splits:load',
  SPLITS_SAVE: 'splits:save',
  SPLITS_DELETE: 'splits:delete',
  SPLITS_IMPORT_LSS: 'splits:importLSS',
  SPLITS_EXPORT_LSS: 'splits:exportLSS',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  APP_OPEN_OVERLAY: 'app:openOverlay',
  APP_OPEN_EXTERNAL: 'app:openExternal',
  TRACKPULSE_PICK_FILES: 'trackpulse:pickFiles',
});

module.exports = { IPC_CHANNELS };
