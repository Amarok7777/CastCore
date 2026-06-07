/**
 * splitflowService.js — SplitFlow tool service
 *
 * Manages the SplitFlow-specific runtime:
 *   - Hotkey registration / deregistration
 *   - time_left.txt polling
 *   - Active split profile loading
 *
 * The HTTP/WS servers are app infrastructure and run independently.
 * This service can be started and stopped from the Tool Hub just like
 * ScenePilot or TrackPulse.
 */

const fs   = require('fs');
const path = require('path');

const { registerHotkeys, unregisterHotkeys } = require('./hotkeys');
const timer    = require('../core/timer');
const splits   = require('../core/splits');
const settings = require('../core/settings');

const TIME_LEFT_PATH = path.join(__dirname, '..', 'data', 'time_left.txt');

let running          = false;
let lastError        = null;
let timeLeftInterval = null;

// ─── Helpers ────────────────────────────────────────────────────────────────────

function fmtTime(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined) return '';
  const s   = Math.max(0, totalSeconds);
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function writeTimeLeft() {
  try {
    const snap = timer.getSnapshot();
    let text = '';
    if (snap.state === 'running' || snap.state === 'paused') {
      text = snap.pbTotal !== null
        ? fmtTime(snap.pbTotal - snap.elapsed)
        : fmtTime(snap.elapsed);
    }
    fs.writeFileSync(TIME_LEFT_PATH, text, 'utf8');
  } catch { /* non-fatal */ }
}

// ─── Public API ─────────────────────────────────────────────────────────────────

async function start() {
  if (running) return status();

  try {
    // Restore the last active split profile
    const activeId = settings.get('activeProfileId');
    if (activeId) {
      try {
        const profile = splits.loadProfile(activeId);
        timer.loadProfile(profile);
      } catch { /* profile was deleted — ignore */ }
    }

    registerHotkeys();

    if (timeLeftInterval) clearInterval(timeLeftInterval);
    timeLeftInterval = setInterval(writeTimeLeft, 500);
    writeTimeLeft();

    running   = true;
    lastError = null;
    console.log('[SplitFlow] Service started');
  } catch (e) {
    running   = false;
    lastError = e.message || 'start-failed';
    throw e;
  }

  return status();
}

async function stop() {
  unregisterHotkeys();

  if (timeLeftInterval) {
    clearInterval(timeLeftInterval);
    timeLeftInterval = null;
  }
  try { fs.writeFileSync(TIME_LEFT_PATH, '', 'utf8'); } catch { /* non-fatal */ }

  running   = false;
  lastError = null;
  console.log('[SplitFlow] Service stopped');

  return status();
}

function status() {
  return { running: running, lastError: lastError };
}

module.exports = { start, stop, status };
