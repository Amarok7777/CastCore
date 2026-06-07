const fs   = require('fs');
const path = require('path');
const { atomicWriteJson, deepMerge } = require('../core/fileUtils');

const FILE = path.join(__dirname, '..', 'data', 'chatdeck.json');

const DEFAULTS = {
  twitch: {
    enabled: false,
    channel: '',
  },
  youtube: {
    enabled: false,
    apiKey: '',
    videoId: '',
    channelInput: '',
    noApiKey: false,
  },
  keywords: [
    // { id, text, color, caseSensitive }
  ],
  commands: [
    // { id, trigger, label, action, actionParam }
    // action: 'none' | 'obs-scene' | 'timer-start' | 'timer-reset'
  ],
  intervalMessages: [
    // { id, text, intervalMinutes, enabled }
  ],
  display: {
    maxMessages: 200,
    showTimestamp: true,
    twitchColor: '#9146ff',
    youtubeColor: '#ff4040',
  },
};


function load() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    return deepMerge(DEFAULTS, JSON.parse(raw));
  } catch {
    return { ...DEFAULTS, keywords: [], commands: [] };
  }
}

function save(next) {
  atomicWriteJson(FILE, next);
}

function getAll() {
  return load();
}

function update(patch) {
  const current = load();
  const next = deepMerge(current, patch);
  save(next);
  return next;
}

module.exports = { getAll, update };
