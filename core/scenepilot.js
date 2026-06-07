const fs = require('fs');
const path = require('path');
const { atomicWriteJson, deepMerge } = require('../core/fileUtils');

const FILE = path.join(__dirname, '..', 'data', 'scenepilot.json');

const DEFAULTS = {
  obs: {
    enabled: false,
    address: 'ws://localhost:4455',
    password: '',
    autoConnect: true,
  },
  timerAutomation: {
    enabled: false,
    onStartScene:  '',
    onFinishScene: '',
    onResetScene:  '',
    onPauseScene:  '',
    onResumeScene: '',
    splitScenes: {},   // { "splitIndex": "Scene Name" }
  },
  macros: [
    {
      id: 'go-live',
      name: 'Go Live Scene',
      actions: [
        { type: 'scene', sceneName: '' },
      ],
    },
    {
      id: 'be-right-back',
      name: 'BRB Scene',
      actions: [
        { type: 'scene', sceneName: '' },
      ],
    },
  ],
  midi: {
    enabled: true,
    inputName: '',
    bindings: [
      // Example:
      // { type: 'cc', channel: 0, number: 1, mode: 'macro', macroId: 'go-live' }
      // { type: 'noteon', channel: 0, number: 36, mode: 'scene', sceneName: 'Gameplay' }
      // { type: 'cc', channel: 0, number: 16, mode: 'volume', inputName: 'Desktop Audio' }
    ],
  },
  hiddenScenes: [],
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
  const merged = deepMerge(load(), patch);
  save(merged);
  return merged;
}

function replaceAll(config) {
  const merged = deepMerge(DEFAULTS, config || {});
  save(merged);
  return merged;
}


module.exports = { getAll, update, replaceAll, DEFAULTS };
