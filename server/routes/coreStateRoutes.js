const { asyncHandler } = require('./routeUtils');

function registerCoreStateRoutes(app, deps) {
  const { timer, splits, settings, getBroadcast, reloadHotkeys } = deps;

  const VALID_ACTIONS = new Set(['start', 'pause', 'resume', 'reset', 'split', 'undo', 'skip']);

  app.get('/api/timer/state', (req, res) => res.json(timer.getSnapshot()));

  app.post('/api/timer/:action', (req, res) => {
    if (!VALID_ACTIONS.has(req.params.action))
      return res.status(400).json({ error: `Unknown timer action: ${req.params.action}` });
    timer.dispatch(req.params.action);
    return res.json({ ok: true, state: timer.getSnapshot() });
  });

  app.get('/api/splits',    (req, res) => res.json(splits.getAllProfiles()));
  app.post('/api/splits',   (req, res) => res.json({ id: splits.saveProfile(req.body) }));
  app.delete('/api/splits/:id', (req, res) => { splits.deleteProfile(req.params.id); res.json({ ok: true }); });

  app.get('/api/splits/:id', asyncHandler(async (req, res) => {
    res.json(splits.loadProfile(req.params.id));
  }));

  app.post('/api/splits/:id/load', asyncHandler(async (req, res) => {
    const profile = splits.loadProfile(req.params.id);
    timer.loadProfile(profile);
    res.json({ ok: true, state: timer.getSnapshot() });
  }));

  app.get('/api/settings', (req, res) => res.json(settings.getAll()));

  app.patch('/api/settings', (req, res) => {
    const updated = settings.update(req.body);
    if (req.body.hotkeys) try { reloadHotkeys(); } catch { /* non-fatal */ }
    try { getBroadcast()({ type: 'SETTINGS_UPDATE', payload: updated }); } catch { /* non-fatal */ }
    res.json(updated);
  });
}

module.exports = { registerCoreStateRoutes };
