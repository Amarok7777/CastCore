const HISTORY_MAX = 500;
const fs   = require('fs');
const path = require('path');
const { atomicWriteJson } = require('../core/fileUtils');
const { inferActorFromText } = require('./textUtils');
const EVENTS_FILE = path.join(__dirname, '..', 'data', 'platformEvents.json');

const COUNTER_KEYS = [
  'total',
  'twitch',
  'youtube',
  'chat',
  'follower',
  'sub',
  'resub',
  'subgift',
  'raid',
  'bits',
  'donation',
  'superchat',
  'supersticker',
  'membership',
];

let history = [];
const seenIds = new Set();

function freshCounts() {
  return COUNTER_KEYS.reduce((acc, k) => {
    acc[k] = 0;
    return acc;
  }, {});
}

function freshLatest() {
  return COUNTER_KEYS.reduce((acc, k) => {
    if (k !== 'total') acc[k] = '';
    return acc;
  }, { any: '' });
}

let snapshot = {
  counts: freshCounts(),
  latest: freshLatest(),
  lastTs: 0,
};

function loadFromFile() {
  try {
    const data = fs.readFileSync(EVENTS_FILE, 'utf-8');
    const loaded = JSON.parse(data);
    if (Array.isArray(loaded.history)) {
      history = loaded.history.map(normalize).filter(Boolean);
      for (const item of history) seenIds.add(item.id);
      console.log(`[PlatformEvents] Loaded ${history.length} events from disk`);
      rebuildSnapshot();
    }
  } catch (err) {
    console.warn(`[PlatformEvents] Could not load events from ${EVENTS_FILE}:`, err.message);
  }
}

function saveToFile() {
  try {
    atomicWriteJson(EVENTS_FILE, { history });
  } catch (err) {
    console.error(`[PlatformEvents] Failed to save events:`, err.message);
  }
}

function rebuildSnapshot() {
  snapshot = {
    counts: freshCounts(),
    latest: freshLatest(),
    lastTs: 0,
  };
  for (const item of history) {
    const line = formatLine(item).slice(0, 180);
    snapshot.counts.total += 1;
    if (Object.prototype.hasOwnProperty.call(snapshot.counts, item.platform)) snapshot.counts[item.platform] += 1;
    if (Object.prototype.hasOwnProperty.call(snapshot.counts, item.eventType)) snapshot.counts[item.eventType] += 1;
    snapshot.latest.any = line;
    if (Object.prototype.hasOwnProperty.call(snapshot.latest, item.platform)) snapshot.latest[item.platform] = line;
    if (Object.prototype.hasOwnProperty.call(snapshot.latest, item.eventType)) snapshot.latest[item.eventType] = line;
    snapshot.lastTs = Math.max(snapshot.lastTs, item.ts);
  }
}

function normalize(raw) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const id = String(item.id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`).slice(0, 96);
  const platform = String(item.platform || 'chat').toLowerCase();
  const eventType = String(item.eventType || '').toLowerCase();
  const ts = Math.max(0, Number(item.ts || Date.now()) || Date.now());
  let author = String(item.author || item.authorName || '').trim().slice(0, 120);
  let text = String(item.text || '').trim().slice(0, 400);
  const amount = String(item.amount || '').trim().slice(0, 80);
  const viewers = String(item.viewers || '').trim().slice(0, 20);

  if (eventType === 'sub' || eventType === 'resub' || eventType === 'subgift') {
    const inferred = inferActorFromText(text);
    if (inferred && author.toLowerCase() !== inferred.toLowerCase()) {
      author = inferred;
    }
    if (author && text.toLowerCase().startsWith(author.toLowerCase() + ' ')) {
      text = text.slice(author.length).trim().slice(0, 400);
    }
  }

  if (!author && !text) return null;

  return { id, platform, eventType, ts, author, text, amount, viewers };
}

function formatLine(item) {
  if (item.eventType === 'raid') return item.viewers ? `${item.author} (${item.viewers} viewers)` : item.author;
  if (item.eventType === 'bits') return item.amount ? `${item.author} (${item.amount} bits)` : item.author;
  if (item.eventType === 'superchat' || item.eventType === 'supersticker' || item.eventType === 'donation') {
    return item.amount ? `${item.author} (${item.amount})` : item.author;
  }
  return item.author && item.text ? `${item.author}: ${item.text}` : (item.author || item.text);
}

function add(raw) {
  const item = normalize(raw);
  if (!item) return { added: false, item: null };
  if (seenIds.has(item.id)) return { added: false, item };

  seenIds.add(item.id);
  history.push(item);
  if (history.length > HISTORY_MAX) {
    const removed = history.splice(0, history.length - HISTORY_MAX);
    for (const r of removed) seenIds.delete(r.id);
  }

  const line = formatLine(item).slice(0, 180);
  snapshot.counts.total += 1;
  if (Object.prototype.hasOwnProperty.call(snapshot.counts, item.platform)) snapshot.counts[item.platform] += 1;
  if (Object.prototype.hasOwnProperty.call(snapshot.counts, item.eventType)) snapshot.counts[item.eventType] += 1;

  snapshot.latest.any = line;
  if (Object.prototype.hasOwnProperty.call(snapshot.latest, item.platform)) snapshot.latest[item.platform] = line;
  if (Object.prototype.hasOwnProperty.call(snapshot.latest, item.eventType)) snapshot.latest[item.eventType] = line;
  snapshot.lastTs = Math.max(snapshot.lastTs, item.ts);

  saveToFile();
  return { added: true, item };
}

function getHistory(limit = 50) {
  const max = Math.max(1, Math.min(500, Number(limit) || 50));
  return history
    .slice()
    .sort((a, b) => {
      const at = Number(a.ts || 0);
      const bt = Number(b.ts || 0);
      if (bt !== at) return bt - at;
      return String(b.id || '').localeCompare(String(a.id || ''));
    })
    .slice(0, max);
}

function getSnapshot() {
  return {
    counts: { ...snapshot.counts },
    latest: { ...snapshot.latest },
    lastTs: snapshot.lastTs,
    history: history.slice(),
  };
}

function reset() {
  history = [];
  seenIds.clear();
  snapshot = {
    counts: freshCounts(),
    latest: freshLatest(),
    lastTs: 0,
  };
  return getSnapshot();
}

module.exports = { add, getHistory, getSnapshot, reset, init: loadFromFile };
