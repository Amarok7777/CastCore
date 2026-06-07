const fs = require('fs');
const path = require('path');
const { atomicWriteJson, deepMerge } = require('../core/fileUtils');

const FILE = path.join(__dirname, '..', 'data', 'tunapilot.json');

const DEFAULTS = {
  enabled: false,
  outputPath: path.join(__dirname, '..', 'data', 'nowplaying.txt'),
  format: '{artist} - {title}',
  fallbackText: 'Kein Song aktiv',
  autoClearOnStop: false,
  playlist: [],
  player: {
    currentIndex: -1,
    loopMode: 'all', // all | none | single
    shuffle: false,
    volume: 100, // 0–100, maps to OBS input volume
  },
  obsPlayer: {
    enabled: true,
    sourceName: '',
    sourceKind: 'ffmpeg_source',
  },
  // Named playlists: [{ id, name, tracks: [...] }]
  namedPlaylists: [],
  // Scene → playlist mapping: { "Scene Name": playlistId }
  scenePlaylists: {},
  // Legacy compatibility (old system)
  obsAutoSync: {
    enabled: false,
    url: 'localhost:4455',
    password: '',
    vlcSourceName: '',
    pollingIntervalMs: 1000,
  },
};

function load() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    return deepMerge(DEFAULTS, JSON.parse(raw));
  } catch {
    return { ...DEFAULTS };
  }
}

function save(next) {
  atomicWriteJson(FILE, next);
}

function getAll() {
  return load();
}

function update(patch) {
  const merged = deepMerge(load(), patch || {});
  save(merged);
  return merged;
}

function replaceAll(config) {
  const merged = deepMerge(DEFAULTS, config || {});
  save(merged);
  return merged;
}


module.exports = { getAll, update, replaceAll, DEFAULTS };
