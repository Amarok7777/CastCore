/**
 * shared/platform-status.js — platform connection helpers used by
 * ChatLink, ControlDeck and EventForge.
 * No defer — must be available before inline scripts run.
 */
window.PlatformStatus = (function() {
  function twText(tw) {
    if (!tw) return 'Twitch nicht verbunden';
    if (tw.connected)     return '#' + (tw.channel || 'twitch');
    if (tw.oauthLoggedIn) return (tw.channel || 'Twitch') + ' (getrennt)';
    if (tw.channel)       return tw.channel + ' (nicht eingeloggt)';
    return 'Twitch nicht verbunden';
  }

  function ytText(yt) {
    if (!yt) return 'YouTube nicht verbunden';
    if (yt.videoId)  return 'YouTube live';
    if (yt.channel)  return yt.channel + ' (kein aktiver Stream)';
    return 'YouTube nicht verbunden';
  }

  async function load() {
    return safeJson('/api/platforms');
  }

  /**
   * Start polling /api/platforms.
   * callback(state) is called immediately and every `ms` milliseconds.
   * Returns a stop function.
   */
  function poll(callback, ms) {
    ms = ms || 3000;
    let stopped = false;
    async function run() {
      if (stopped) return;
      try { callback(await load()); } catch {}
    }
    run();
    const id = setInterval(run, ms);
    return function stop() { stopped = true; clearInterval(id); };
  }

  return { twText, ytText, load, poll };
})();
