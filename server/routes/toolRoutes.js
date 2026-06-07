const path     = require('node:path');
const express  = require('express');

function registerToolPageRoutes(app, routes) {
  for (const route of routes) {
    if (route.redirectTo) {
      app.get(route.base,      (_req, res) => res.redirect(route.redirectTo));
      app.get(`${route.base}/*`, (_req, res) => res.redirect(route.redirectTo));
      continue;
    }

    const indexFile = path.join(route.dir, route.index || 'index.html');
    const base      = route.base;

    // Serve extracted CSS/JS assets (e.g. splitflow.css, alertdeck.js) as static files.
    // Falls through to the catch-all for unknown paths so client-side routing still works.
    app.use(base, express.static(route.dir, { index: false, fallthrough: true }));

    app.get(base, (_req, res) => res.sendFile(indexFile));

    if (route.overlay) {
      app.get(`${base}/overlay`, (_req, res) =>
        res.sendFile(path.join(route.dir, route.overlay))
      );
    }

    // SPA catch-all — must come after static so existing files are served directly
    app.get(`${base}/*`, (_req, res) => res.sendFile(indexFile));
  }
}

module.exports = { registerToolPageRoutes };
