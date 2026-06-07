const { WebSocketServer } = require('ws');
const timer   = require('../core/timer');
const chatBus = require('./chatBus');

// Track ALL wss instances so every server (overlay + dashboard) gets broadcasts.
const wssInstances = new Set();
let updateListener = null;

// Cache the last known ScenePilot MIDI device state so newly connected clients
// (e.g. the UI window opening after the background runtime already booted) get
// the current device list without waiting for the next event.
let cachedMidiDevices = null;

function createWsServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer });
  wssInstances.add(wss);

  wss.on('connection', (ws) => {
    // Immediately send state snapshot so clients never start blank
    send(ws, { type: 'SNAPSHOT',     payload: timer.getSnapshot() });
    send(ws, { type: 'CHAT_HISTORY', payload: chatBus.getHistory() });
    // If the background runtime has already reported its MIDI devices, push them
    // to this new connection right away (handles UI loading after runtime start).
    if (cachedMidiDevices) {
      send(ws, { type: 'SCENEPILOT_MIDI_DEVICES', payload: cachedMidiDevices });
    }

    const VALID_ACTIONS = new Set(['start', 'pause', 'resume', 'reset', 'split', 'undo', 'skip']);

    ws.on('message', (raw) => {
      if (raw.length > 1024) return;
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      // Timer control from any client
      if (msg.type === 'ACTION' && VALID_ACTIONS.has(msg.action)) {
        timer.dispatch(msg.action);
      }

      // ScenePilot MIDI forwarding: relay between background runtime and UI clients.
      // SCENEPILOT_MIDI_DEVICES:    device list (cached for late-joining clients)
      // SCENEPILOT_MIDI_EVENT:      per-CC event for the live monitor
      // SCENEPILOT_BINDINGS_UPDATED: UI → background to sync new/edited mappings
      // SCENEPILOT_DISPATCH_LOG:    background → UI for diagnostics
      const SCENEPILOT_RELAY = new Set([
        'SCENEPILOT_MIDI_DEVICES',
        'SCENEPILOT_MIDI_EVENT',
        'SCENEPILOT_BINDINGS_UPDATED',
        'SCENEPILOT_DISPATCH_LOG',
      ]);
      if (SCENEPILOT_RELAY.has(msg.type)) {
        if (msg.type === 'SCENEPILOT_MIDI_DEVICES') {
          cachedMidiDevices = msg.payload;
        }
        const relayed = JSON.stringify(msg);
        for (const instance of wssInstances) {
          for (const client of instance.clients) {
            if (client !== ws && client.readyState === 1) {
              try { client.send(relayed); } catch {}
            }
          }
        }
      }
    });

    ws.on('error', () => {});
  });

  // Register the timer update listener only once — it broadcasts to all instances.
  if (!updateListener) {
    updateListener = (snapshot) => broadcast({ type: 'UPDATE', payload: snapshot });
    timer.on('update', updateListener);
  }

  return wss;
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const wss of wssInstances) {
    for (const client of wss.clients) {
      if (client.readyState === 1) {
        try { client.send(data); } catch {}
      }
    }
  }
}

function send(ws, msg) {
  if (ws.readyState === 1) {
    try { ws.send(JSON.stringify(msg)); } catch {}
  }
}

module.exports = { createWsServer, broadcast };
