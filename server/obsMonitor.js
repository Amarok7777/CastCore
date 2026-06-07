const OBSWebSocket = require('obs-websocket-js').default;
const path = require('path');
const fs = require('fs');

class OBSMonitor {
  constructor() {
    this.obs = null;
    this._externalObs = null;
    this.connected = false;
    this.connectionConfig = null;
    this.monitoringInterval = null;
    this.lastFileInfo = null;
    this.onTrackChange = null;
    this._mediaStartedHandler = null;
    this._monitoredSource = null;
    this._playlistIndex = -1; // -1 = unbekannt
    this._playlist = [];
    this._lastCursor = -1; // für Cursor-Reset-Erkennung
  }

  async connect(obsConfig) {
    try {
      if (!obsConfig?.url) {
        throw new Error('OBS URL erforderlich');
      }

      this.connectionConfig = obsConfig;
      this.obs = new OBSWebSocket();

      const [host, port = 4455] = obsConfig.url.split(':');
      
      await this.obs.connect(`ws://${host}:${port}`, obsConfig.password, {
        rpcVersion: 1,
      });

      this.connected = true;
      console.log('[OBSMonitor] Verbunden mit OBS');
      return { success: true, message: 'Mit OBS verbunden' };
    } catch (err) {
      this.connected = false;
      throw new Error(`OBS Verbindung fehlgeschlagen: ${err.message}`);
    }
  }

  disconnect() {
    this._unsubscribeEvents();
    if (this._externalObs) {
      this._externalObs = null;
      this.obs = null;
      this.connected = false;
    } else if (this.obs) {
      try {
        this.obs.disconnect();
      } catch (e) {
        console.log('[OBSMonitor] Fehler beim Trennen:', e.message);
      }
    }
    this.connected = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  useExternalObs(obsInstance) {
    this._externalObs = obsInstance;
    this.obs = obsInstance;
    this.connected = true;
    console.log('[OBSMonitor] Nutze externe OBS-Verbindung (ScenePilot)');
  }

  startMonitoring(sourceNameOrId, pollingIntervalMs = 1000) {
    if (!this.connected) {
      throw new Error('Nicht mit OBS verbunden');
    }

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    this._unsubscribeEvents();

    this.lastFileInfo = null;
    this._monitoredSource = sourceNameOrId;
    this._playlistIndex = -1;
    this._playlist = [];
    this._lastCursor = -1;

    // OBS-Event: feuert wenn VLC zum nächsten Track wechselt
    this._mediaStartedHandler = (event) => {
      if (
        event.inputName &&
        event.inputName.toLowerCase() === sourceNameOrId.toLowerCase()
      ) {
        this._onVlcTrackStarted(sourceNameOrId);
      }
    };
    try {
      this.obs.on('MediaInputPlaybackStarted', this._mediaStartedHandler);
    } catch { /* obs-websocket-js version may differ */ }

    // Sofort einmal prüfen (erkennt aktuell laufenden Track beim Start)
    this._checkVlcSource(sourceNameOrId, false).catch(() => {});

    // Heartbeat-Poll für nicht-VLC Quellen und Reconnect-Erkennung
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.checkAudioSource(sourceNameOrId);
      } catch (err) {
        console.error('[OBSMonitor] Fehler beim Check:', err.message);
      }
    }, pollingIntervalMs);

    console.log(`[OBSMonitor] Monitore Audio-Quelle: ${sourceNameOrId}`);
  }

  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    this._unsubscribeEvents();
  }

  _unsubscribeEvents() {
    if (this._mediaStartedHandler && this.obs) {
      try {
        this.obs.off('MediaInputPlaybackStarted', this._mediaStartedHandler);
      } catch { /* ignore */ }
    }
    this._mediaStartedHandler = null;
  }

  // Wird durch das OBS-Event aufgerufen – Track hat gewechselt
  _onVlcTrackStarted(sourceName) {
    this._checkVlcSource(sourceName, true).catch(() => {});
  }

  async _checkVlcSource(sourceName, isTrackChange) {
    if (!this.connected || !this.obs) return;
    try {
      const settings = await this.obs.call('GetInputSettings', { inputName: sourceName });
      const playlist = (settings.inputSettings.playlist || []).filter(
        (item) => item.value && !this._isDirectory(item.value)
      );

      if (playlist.length === 0) return;

      // Option 1: OBS markiert das aktive Item mit selected: true
      const selectedItem = playlist.find((item) => item.selected);
      if (selectedItem) {
        this._playlistIndex = playlist.indexOf(selectedItem);
        return this._emitTrack(selectedItem.value);
      }

      // Option 2: Index-Tracking (inkrementieren bei jedem Track-Wechsel-Event)
      if (isTrackChange) {
        this._playlist = playlist;
        this._playlistIndex = (this._playlistIndex + 1) % playlist.length;
        return this._emitTrack(playlist[this._playlistIndex].value);
      }

      // Option 3: Startup – nehme erstes Element wenn noch kein Index bekannt
      if (this._playlistIndex < 0) {
        this._playlist = playlist;
        this._playlistIndex = 0;
        return this._emitTrack(playlist[0].value);
      }
    } catch (err) {
      console.error('[OBSMonitor] VLC-Check Fehler:', err.message);
    }
  }

  _isDirectory(filePath) {
    try {
      return fs.statSync(filePath).isDirectory();
    } catch {
      return false;
    }
  }

  _emitTrack(filePath) {
    if (!filePath || filePath === this.lastFileInfo?.path) return;
    this.lastFileInfo = {
      path: filePath,
      name: filePath.split(/[\\/]/).pop() || filePath,
      timestamp: Date.now(),
    };
    console.log('[OBSMonitor] Track erkannt:', this.lastFileInfo.name);
    if (this.onTrackChange) {
      this.onTrackChange(filePath);
    }
  }

  async checkAudioSource(sourceName) {
    if (!this.connected || !this.obs) return;

    try {
      const sources = await this.obs.call('GetInputList');
      const audioSource = sources.inputs.find(
        (inp) => inp.inputName.toLowerCase() === sourceName.toLowerCase()
      );
      if (!audioSource) return null;

      // VLC-Quellen: Cursor-Reset-Erkennung + Event-Fallback
      if (audioSource.inputKind === 'vlc_source') {
        try {
          const mediaStatus = await this.obs.call('GetMediaInputStatus', { inputName: sourceName });
          const cursor = mediaStatus.mediaCursor ?? -1;
          // Cursor-Reset: neuer Track hat angefangen (Sprung rückwärts > 2 Sek.)
          const isReset = this._lastCursor > 2000 && cursor < this._lastCursor - 2000;
          this._lastCursor = cursor;
          if (isReset) {
            await this._onVlcTrackStarted(sourceName);
          } else if (this._playlistIndex < 0) {
            // Erster Start: aktuellen Track einmalig ermitteln
            await this._checkVlcSource(sourceName, false);
          }
        } catch { /* ignore */ }
        return null;
      }

      const settings = await this.obs.call('GetInputSettings', {
        inputName: audioSource.inputName,
      });

      let currentFile = null;

      if (audioSource.inputKind === 'ffmpeg_source') {
        try {
          const mediaStatus = await this.obs.call('GetMediaInputStatus', {
            inputName: audioSource.inputName,
          });
          if (mediaStatus.mediaPath) currentFile = mediaStatus.mediaPath;
        } catch { /* ignore */ }
        if (!currentFile) currentFile = settings.inputSettings.local_file;
      } else {
        currentFile =
          settings.inputSettings.file ||
          settings.inputSettings.local_file ||
          settings.inputSettings.path;
      }

      if (!currentFile || currentFile.trim() === '') return null;
      if (this._isDirectory(currentFile)) return null;
      if (currentFile === this.lastFileInfo?.path) return null;

      return this._emitTrack(currentFile);
    } catch (err) {
      console.error('[OBSMonitor] Check-Fehler:', err.message);
      return null;
    }
  }

  setOnTrackChange(callback) {
    this.onTrackChange = callback;
  }

  status() {
    return {
      connected: this.connected,
      config: this.connectionConfig ? { url: this.connectionConfig.url } : null,
      isMonitoring: this.monitoringInterval !== null,
      lastFile: this.lastFileInfo,
    };
  }
}

module.exports = new OBSMonitor();

