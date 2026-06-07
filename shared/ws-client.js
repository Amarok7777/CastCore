/**
 * shared/ws-client.js — WebSocket client with auto-reconnect.
 * Usage: const ws = createWsClient({ onMessage(msg){...} });
 *        ws.start(); / ws.stop();
 * No defer — must be available before inline scripts run.
 */
window.createWsClient = function(opts) {
  let ws      = null;
  let stopped = false;
  const port  = opts.port || (location.port || '7332');

  function connect() {
    if (stopped) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.hostname + ':' + port);

    ws.addEventListener('message', function(e) {
      try {
        const msg = JSON.parse(e.data || '{}');
        if (opts.onMessage) opts.onMessage(msg);
      } catch {}
    });

    ws.addEventListener('open', function() {
      if (opts.onOpen) opts.onOpen();
    });

    ws.addEventListener('close', function() {
      ws = null;
      if (opts.onClose) opts.onClose();
      if (!stopped) setTimeout(connect, 2000);
    });

    ws.addEventListener('error', function() { /* close fires next */ });
  }

  return {
    start: function()     { stopped = false; connect(); },
    stop:  function()     { stopped = true; if (ws) { ws.close(); ws = null; } },
    send:  function(data) { if (ws && ws.readyState === 1) ws.send(typeof data === 'string' ? data : JSON.stringify(data)); },
    get connected()       { return !!ws && ws.readyState === 1; },
  };
};
