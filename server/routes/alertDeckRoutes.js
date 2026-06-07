const fs         = require('node:fs');
const path       = require('node:path');
const express    = require('express');
const { asyncHandler } = require('./routeUtils');
const alertQueue = require('../alertQueue');

function registerAlertDeckRoutes(app, deps) {
  const { alertdeckConfig, platformEvents, alertdeckMediaDir } = deps;

  // Overlay polls this every 350 ms — drain and return queued alerts
  app.get('/api/alertdeck/poll', (req, res) => {
    res.json({ alerts: alertQueue.drain() });
  });

  // Test button: inject a synthetic alert into the queue so the OBS overlay shows it
  app.post('/api/alertdeck/inject', (req, res) => {
    const body = req.body || {};
    const eventType = String(body.eventType || 'follower').slice(0, 64);
    const platform  = String(body.platform  || 'test').slice(0, 32);
    const author    = String(body.author    || 'TestUser').slice(0, 128);
    const text      = String(body.text      || '').slice(0, 512);
    const amount    = String(body.amount    || '').slice(0, 64);
    const viewers   = String(body.viewers   || '').slice(0, 32);
    alertQueue.push({ id: `inject-${Date.now()}`, eventType, platform, author, text, amount, viewers, ts: Date.now() });
    res.json({ ok: true });
  });

  app.get('/api/alertdeck/history', (req, res) => {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 50) || 50));
    res.json({ history: platformEvents.getHistory(limit) });
  });

  app.get('/api/platforms/events/history', (req, res) => {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100) || 100));
    res.json({ history: platformEvents.getHistory(limit) });
  });

  // AlertDeck event config (for editor + overlay)
  app.get('/api/alertdeck/config', (req, res) => {
    res.json(alertdeckConfig.getConfig());
  });

  // Larger body limit for base64-encoded media (12 MB file → ~16 MB base64)
  app.post('/api/alertdeck/media/import', express.json({ limit: '20mb' }), asyncHandler(async (req, res) => {
      const b = req.body || {};
      const dataUrl     = String(b.dataUrl || '');
      const originalName = String(b.name || 'upload').slice(0, 255);
      const kind = String(b.kind || 'image').toLowerCase() === 'sound' ? 'sounds' : 'images';

      const m = dataUrl.match(/^data:([^;]{1,80});base64,(.+)$/i);
      if (!m) return res.status(400).json({ error: 'Invalid data URL' });

      // Strict MIME allowlist — only known-safe media types accepted
      const ALLOWED_MIME_EXT = {
        'image/png':      '.png',
        'image/jpeg':     '.jpg',
        'image/webp':     '.webp',
        'image/gif':      '.gif',
        'image/svg+xml':  '.svg',
        'video/mp4':      '.mp4',
        'video/webm':     '.webm',
        'audio/mpeg':     '.mp3',
        'audio/wav':      '.wav',
        'audio/ogg':      '.ogg',
        'audio/mp4':      '.m4a',
        'audio/aac':      '.aac',
      };

      const mime = String(m[1] || '').toLowerCase().trim();
      if (!ALLOWED_MIME_EXT[mime]) {
        return res.status(415).json({ error: `Nicht unterstützter Medientyp: ${mime}` });
      }

      const b64 = m[2] || '';
      const buf = Buffer.from(b64, 'base64');
      if (!buf.length) return res.status(400).json({ error: 'Empty media payload' });
      if (buf.length > 12 * 1024 * 1024) return res.status(413).json({ error: 'Media file too large (max 12 MB)' });

      // Derive extension exclusively from MIME — never trust the filename extension
      const ext = ALLOWED_MIME_EXT[mime];

      // Safe base name: strip path components, limit length, allow only safe chars
      const rawBase   = path.basename(originalName, path.extname(originalName));
      const safeBase  = rawBase.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'media';
      const fileName  = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${safeBase}${ext}`;

      // Final path-traversal guard before writing
      const dir      = path.resolve(alertdeckMediaDir, kind);
      const filePath = path.resolve(dir, fileName);
      if (!filePath.startsWith(dir + path.sep)) {
        return res.status(400).json({ error: 'Invalid filename' });
      }

      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, buf);

      const url = `/media/alertdeck/${kind}/${encodeURIComponent(fileName)}`;
      return res.json({ ok: true, url, bytes: buf.length, mime });
  }));

  app.post('/api/alertdeck/config', asyncHandler(async (req, res) => {
    res.json(alertdeckConfig.saveConfig(req.body));
  }));

  // Streamlabels replacement endpoints
  app.get('/api/alertdeck/labels', (req, res) => {
    res.json(platformEvents.getSnapshot());
  });

  app.post('/api/alertdeck/labels/reset', (req, res) => {
    res.json(platformEvents.reset());
  });

  app.get('/api/alertdeck/labels/:key.txt', (req, res) => {
    const key = String(req.params.key || '').toLowerCase();
    const s = platformEvents.getSnapshot();

    const latestMap = {
      latest_alert:        s.latest.any         || '',
      latest_twitch:       s.latest.twitch      || '',
      latest_youtube:      s.latest.youtube     || '',
      latest_follower:     s.latest.follower    || '',
      latest_sub:          s.latest.sub         || '',
      latest_resub:        s.latest.resub       || '',
      latest_subgift:      s.latest.subgift     || '',
      latest_raid:         s.latest.raid        || '',
      latest_bits:         s.latest.bits        || '',
      latest_donation:     s.latest.donation    || '',
      latest_superchat:    s.latest.superchat   || '',
      latest_supersticker: s.latest.supersticker|| '',
      latest_membership:   s.latest.membership  || '',
    };
    const countMap = {
      total_alerts:       String(s.counts.total      || 0),
      alerts_total:       String(s.counts.total      || 0),
      alerts_twitch:      String(s.counts.twitch     || 0),
      alerts_youtube:     String(s.counts.youtube    || 0),
      total_followers:    String(s.counts.follower   || 0),
      total_subs:         String(s.counts.sub        || 0),
      total_resubs:       String(s.counts.resub      || 0),
      total_subgifts:     String(s.counts.subgift    || 0),
      total_raids:        String(s.counts.raid       || 0),
      total_bits:         String(s.counts.bits       || 0),
      total_donations:    String(s.counts.donation   || 0),
      total_superchats:   String(s.counts.superchat  || 0),
      total_memberships:  String(s.counts.membership || 0),
    };

    if (latestMap[key] !== undefined) return res.type('text/plain; charset=utf-8').send(latestMap[key]);
    if (countMap[key]  !== undefined) return res.type('text/plain; charset=utf-8').send(countMap[key]);
    return res.status(404).type('text/plain').send('Unknown label key');
  });
}

module.exports = { registerAlertDeckRoutes };
