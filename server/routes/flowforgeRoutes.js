const { getFlows, getFlow, upsertFlow, deleteFlow } = require('../../core/flowforge');
const { asyncHandler } = require('./routeUtils');

const uid = () => `flow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function registerFlowForgeRoutes(app) {
  app.get('/api/flowforge/flows', (_req, res) => res.json(getFlows()));

  app.post('/api/flowforge/flows', asyncHandler(async (req, res) => {
    const body = req.body || {};
    res.json(upsertFlow({
      id:         uid(),
      name:       String(body.name || 'Neuer Flow'),
      enabled:    body.enabled !== false,
      trigger:    body.trigger    || { type: 'timer.start' },
      conditions: body.conditions || [],
      actions:    body.actions    || [],
    }));
  }));

  app.put('/api/flowforge/flows/:id', asyncHandler(async (req, res) => {
    const existing = getFlow(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Flow not found' });
    res.json(upsertFlow({ ...existing, ...(req.body || {}), id: existing.id }));
  }));

  app.delete('/api/flowforge/flows/:id', (req, res) => {
    deleteFlow(req.params.id);
    res.json({ ok: true });
  });
}

module.exports = { registerFlowForgeRoutes };
