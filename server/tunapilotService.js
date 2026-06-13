const fs = require('fs');
const path = require('path');
const id3Reader = require('./id3Reader');

function getScenepilotService() {
  return require('./scenepilotService');
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

class TunaPilotService {
  constructor() {
    this.running = false;
    this.lastError = null;
    this.currentTrack = {
      title: '',
      artist: '',
      album: '',
      coverArt: null,
      source: 'manual',
      updatedAt: null,
    };
    this.lastRenderedText = '';
    this.statusBroadcast = null;
    this.playerState = 'stopped'; // stopped | playing | paused
    this.currentIndex = -1;
    this.playlist = [];
    this.loopMode = 'all'; // all | none | single
    this.shuffle = false;
    this.playbackPollInterval = null;
    this.lastMediaState = null;
    this.mediaCursor   = 0;   // seconds elapsed
    this.mediaDuration = 0;   // seconds total
    this.lastScene     = null; // last known OBS scene name
  }

  attachStatusBroadcast(broadcast) {
    this.statusBroadcast = broadcast;
  }

  _broadcastStatus() {
    if (!this.statusBroadcast) return;
    try {
      const s = this.status();
      // Strip base64 cover art from broadcasts — frontend loads via /api/trackpulse/cover/:id
      const lean = {
        ...s,
        currentTrack: { title: s.currentTrack.title, artist: s.currentTrack.artist, album: s.currentTrack.album, source: s.currentTrack.source, updatedAt: s.currentTrack.updatedAt },
        playlist: s.playlist.map(({ coverArt: _drop, ...rest }) => rest),
      };
      this.statusBroadcast({ type: 'TRACKPULSE_STATUS', payload: lean });
    } catch (err) {
      console.error('[TrackPulse] broadcast error:', err.message);
    }
  }

  getCoverArt(trackId) {
    if (!trackId || trackId === 'current') {
      const cur = this.currentIndex >= 0 ? this.playlist[this.currentIndex] : null;
      return cur?.coverArt || this.currentTrack.coverArt || null;
    }
    return this.playlist.find(t => t.id === trackId)?.coverArt || null;
  }

  async start(config) {
    this.running = true;
    this.lastError = null;
    try {
      this.playlist = normalizePlaylist(config?.playlist || []);
      this.currentIndex = Number.isInteger(config?.player?.currentIndex)
        ? config.player.currentIndex
        : this.currentIndex;
      const lm = config?.player?.loopMode;
      this.loopMode = (lm === 'none' || lm === 'single') ? lm : 'all';
      this.shuffle = !!config?.player?.shuffle;
      if (this.currentIndex >= this.playlist.length) this.currentIndex = -1;
      this.renderAndWrite(config);
      this._startPlaybackPolling(config);
    } catch (e) {
      this.lastError = e.message || 'start failed';
    }
    this._broadcastStatus();
    return this.status();
  }

  async stop(config) {
    this.running = false;
    this._stopPlaybackPolling();
    try {
      // Ensure OBS media is fully stopped before clearing source settings.
      await this._mediaAction(config, 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP');
    } catch {
      // Non-fatal: service can still stop even if OBS is not reachable.
    }
    try {
      await this._clearObsSource(config);
    } catch {
      // Non-fatal: keep service shutdown resilient.
    }
    this.playerState = 'stopped';
    this.currentTrack = {
      title: '',
      artist: '',
      album: '',
      source: this.currentTrack.source || 'trackpulse-player',
      updatedAt: new Date().toISOString(),
    };
    this.renderAndWrite(config);
    this.lastMediaState = null;

    if (config?.autoClearOnStop) {
      try {
        this.writeOutput(config, config.fallbackText || '');
        this.lastRenderedText = config.fallbackText || '';
      } catch (e) {
        this.lastError = e.message || 'write failed';
      }
    }
    this._broadcastStatus();
    return this.status();
  }

  updateConfig(config) {
    this.playlist = normalizePlaylist(config?.playlist || []);
    const lm = config?.player?.loopMode;
    this.loopMode = (lm === 'none' || lm === 'single') ? lm : 'all';
    this.shuffle = !!config?.player?.shuffle;
    if (this.currentIndex >= this.playlist.length) {
      this.currentIndex = this.playlist.length ? this.playlist.length - 1 : -1;
    }
    this.renderAndWrite(config);
    this._broadcastStatus();
    return this.status();
  }

  async addTrack(filePath, config) {
    if (!filePath || !String(filePath).trim()) {
      throw new Error('Dateipfad fehlt');
    }

    const absPath = String(filePath).trim();

    // Only allow known audio extensions — blocks arbitrary file reads
    const AUDIO_EXTS = new Set(['.mp3','.flac','.ogg','.m4a','.aac','.wma','.wav','.opus','.alac','.aiff','.ape','.wv']);
    if (!AUDIO_EXTS.has(path.extname(absPath).toLowerCase())) {
      throw new Error(`Nicht unterstütztes Dateiformat: ${path.extname(absPath)}`);
    }

    // Reject path-traversal sequences
    if (absPath.includes('..') || absPath.includes('\0')) {
      throw new Error('Ungültiger Dateipfad');
    }

    // File must actually exist and be a regular file (not a directory/symlink loop)
    try {
      const stat = require('fs').statSync(absPath);
      if (!stat.isFile()) throw new Error('Kein reguläres File');
    } catch (e) {
      throw new Error(`Datei nicht gefunden: ${path.basename(absPath)}`);
    }
    let metadata;
    let duration = null;
    try {
      [metadata, duration] = await Promise.all([
        id3Reader.readMetadata(absPath),
        id3Reader.readDuration(absPath),
      ]);
    } catch {
      metadata = { title: path.basename(absPath, path.extname(absPath)) || path.basename(absPath), artist: '', album: '', coverArt: null };
    }

    const track = {
      id:       uid(),
      path:     absPath,
      title:    metadata.title    || path.basename(absPath, path.extname(absPath)) || path.basename(absPath),
      artist:   metadata.artist   || '',
      album:    metadata.album    || '',
      coverArt: metadata.coverArt || null,
      duration: duration          || null,
    };

    this.playlist.push(track);
    this._broadcastStatus();
    return { track, playlist: [...this.playlist], status: this.status() };
  }

  async addTracks(paths, config) {
    const list = Array.isArray(paths) ? paths : [];
    const added = [];
    const CONCURRENCY = 8;
    for (let i = 0; i < list.length; i += CONCURRENCY) {
      const batch = list.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(batch.map(p => this.addTrack(p, config)));
      for (const r of results) {
        if (r.status === 'fulfilled') added.push(r.value.track);
      }
    }
    return { added, playlist: [...this.playlist], status: this.status() };
  }

  async addTracksFromFolder(dirPath, config) {
    if (!dirPath || typeof dirPath !== 'string') throw new Error('Ordnerpfad fehlt');
    if (dirPath.includes('\0') || dirPath.includes('..')) throw new Error('Ungültiger Ordnerpfad');

    const AUDIO_EXTS = new Set(['.mp3','.flac','.ogg','.m4a','.aac','.wma','.wav','.opus','.alac','.aiff','.ape','.wv']);
    const collectFiles = (dir, depth = 0) => {
      if (depth > 4) return [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const found = [];
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) found.push(...collectFiles(full, depth + 1));
        else if (AUDIO_EXTS.has(path.extname(e.name).toLowerCase())) found.push(full);
      }
      return found;
    };

    const paths = collectFiles(dirPath);
    return this.addTracks(paths, config);
  }

  removeTrack(trackId) {
    const idx = this.playlist.findIndex((t) => t.id === trackId);
    if (idx < 0) return this.status();

    this.playlist.splice(idx, 1);
    if (this.currentIndex === idx) {
      this.currentIndex = -1;
      this.playerState = 'stopped';
    } else if (this.currentIndex > idx) {
      this.currentIndex -= 1;
    }
    this._broadcastStatus();
    return this.status();
  }

  clearPlaylist() {
    this.playlist = [];
    this.currentIndex = -1;
    this.playerState = 'stopped';
    this._broadcastStatus();
    return this.status();
  }

  reorderTrack(fromIndex, toIndex) {
    const n = this.playlist.length;
    if (fromIndex < 0 || fromIndex >= n || toIndex < 0 || toIndex >= n || fromIndex === toIndex) {
      return this.status();
    }
    const [item] = this.playlist.splice(fromIndex, 1);
    this.playlist.splice(toIndex, 0, item);
    // Keep currentIndex pointing at the same track after reorder
    if (this.currentIndex === fromIndex) {
      this.currentIndex = toIndex;
    } else if (fromIndex < toIndex) {
      if (this.currentIndex > fromIndex && this.currentIndex <= toIndex) this.currentIndex--;
    } else {
      if (this.currentIndex >= toIndex && this.currentIndex < fromIndex) this.currentIndex++;
    }
    this._broadcastStatus();
    return this.status();
  }

  playNext(trackId, config) {
    const idx = this.playlist.findIndex(t => t.id === trackId);
    if (idx < 0) return this.status();
    const [item] = this.playlist.splice(idx, 1);
    const insertAt = this.currentIndex + 1;
    this.playlist.splice(insertAt, 0, item);
    if (idx < insertAt && this.currentIndex > idx) this.currentIndex--;
    this._broadcastStatus();
    return this.status();
  }

  async play(config, index = null) {
    if (!this.running) throw new Error('TrackPulse ist nicht gestartet');
    if (!this.playlist.length) throw new Error('Playlist ist leer');

    if (index !== null && index !== undefined) {
      const i = Number(index);
      if (!Number.isInteger(i) || i < 0 || i >= this.playlist.length) {
        throw new Error('Ungultiger Index');
      }
      this.currentIndex = i;
    }

    if (this.currentIndex < 0) this.currentIndex = 0;

    const track = this.playlist[this.currentIndex];
    await this._playTrackOnObs(track, config);

    this.currentTrack = {
      title:    track.title    || '',
      artist:   track.artist   || '',
      album:    track.album    || '',
      coverArt: track.coverArt || null,
      source:   'trackpulse-player',
      updatedAt: new Date().toISOString(),
    };
    this.mediaCursor   = 0;
    this.mediaDuration = 0;
    this.playerState = 'playing';
    this.renderAndWrite(config);
    this._broadcastStatus();
    return this.status();
  }

  async pause(config) {
    await this._mediaAction(config, 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE');
    this.playerState = 'paused';
    this._broadcastStatus();
    return this.status();
  }

  async resume(config) {
    await this._mediaAction(config, 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY');
    this.playerState = 'playing';
    this._broadcastStatus();
    return this.status();
  }

  async stopPlayer(config) {
    await this._mediaAction(config, 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP');
    await this._clearObsSource(config);
    this.playerState = 'stopped';
    this.currentTrack = {
      title: '',
      artist: '',
      album: '',
      source: this.currentTrack.source || 'trackpulse-player',
      updatedAt: new Date().toISOString(),
    };
    this.renderAndWrite(config);
    this.lastMediaState = null;
    this._broadcastStatus();
    return this.status();
  }

  async next(config) {
    const loopMode = config?.player?.loopMode || this.loopMode || 'all';
    const shuffle  = !!(config?.player?.shuffle ?? this.shuffle);
    if (!this.playlist.length) throw new Error('Playlist ist leer');

    if (this.currentIndex < 0) return this.play(config, 0);

    if (loopMode === 'single') return this.play(config, this.currentIndex);

    if (shuffle && this.playlist.length > 1) {
      let next = this.currentIndex;
      while (next === this.currentIndex) next = Math.floor(Math.random() * this.playlist.length);
      return this.play(config, next);
    }

    let next = this.currentIndex + 1;
    if (next >= this.playlist.length) {
      if (loopMode === 'all') next = 0;
      else { await this.stopPlayer(config); return this.status(); }
    }
    return this.play(config, next);
  }

  async prev(config) {
    if (!this.playlist.length) throw new Error('Playlist ist leer');
    if (this.currentIndex <= 0) return this.play(config, 0);
    return this.play(config, this.currentIndex - 1);
  }

  updateTrack(trackPatch, config) {
    if (!this.running) {
      throw new Error('TrackPulse ist nicht gestartet');
    }
    const patch = trackPatch || {};
    this.currentTrack = {
      ...this.currentTrack,
      title: safeString(patch.title, this.currentTrack.title),
      artist: safeString(patch.artist, this.currentTrack.artist),
      album: safeString(patch.album, this.currentTrack.album),
      source: safeString(patch.source, this.currentTrack.source || 'manual'),
      updatedAt: new Date().toISOString(),
    };
    this.renderAndWrite(config);
    this._broadcastStatus();
    return this.status();
  }

  clearTrack(config) {
    this.currentTrack = {
      title: '',
      artist: '',
      album: '',
      source: this.currentTrack.source || 'manual',
      updatedAt: new Date().toISOString(),
    };
    this.renderAndWrite(config);
    this._broadcastStatus();
    return this.status();
  }

  _startPlaybackPolling(config) {
    this._stopPlaybackPolling();
    this.playbackPollInterval = setInterval(async () => {
      if (!this.running) return;
      try {
        const sp = getScenepilotService();
        if (!sp.connected || !sp.obs) return;
        const latestCfg = require('../core/tunapilot').getAll();

        // ── Scene-based playlist switching ──────────────────────────────
        try {
          const sceneResp = await sp.obs.call('GetCurrentProgramScene');
          const scene = sceneResp?.currentProgramSceneName || null;
          if (scene && scene !== this.lastScene) {
            this.lastScene = scene;
            const scenePlaylists = latestCfg.scenePlaylists || {};
            const mappedId = scenePlaylists[scene];
            if (mappedId) {
              const named = (latestCfg.namedPlaylists || []).find(p => p.id === mappedId);
              if (named?.tracks?.length) {
                // Snapshot tracks before any await to avoid race with concurrent mutations
                const tracks = named.tracks.slice();
                this.playlist = normalizePlaylist(tracks);
                this.currentIndex = -1;
                this.playerState = 'stopped';
                this._broadcastStatus();
                await this.play(latestCfg, 0);
              }
            }
          }
        } catch { /* scene query optional */ }

        // ── Media progress tracking ─────────────────────────────────────
        if (this.playerState === 'playing') {
          const src = (latestCfg?.obsPlayer?.sourceName || '').trim();
          if (src) {
            try {
              const media = await sp.obs.call('GetMediaInputStatus', { inputName: src });
              const state = media?.mediaState || null;
              // mediaCursor / mediaDuration come in milliseconds from OBS
              this.mediaCursor   = Math.max(0, Math.round((media?.mediaCursor   || 0) / 1000));
              this.mediaDuration = Math.max(0, Math.round((media?.mediaDuration || 0) / 1000));

              const endedNow    = state === 'OBS_MEDIA_STATE_ENDED';
              const endedBefore = this.lastMediaState === 'OBS_MEDIA_STATE_ENDED';
              this.lastMediaState = state;

              if (endedNow && !endedBefore) {
                await this.next(latestCfg);
              } else {
                this._broadcastStatus();
              }
            } catch { /* not all source kinds support media status */ }
          }
        }
      } catch (e) { console.error('[TrackPulse] Polling loop error:', e.message); }
    }, 1000);
  }

  _stopPlaybackPolling() {
    if (this.playbackPollInterval) {
      clearInterval(this.playbackPollInterval);
      this.playbackPollInterval = null;
    }
  }

  async _playTrackOnObs(track, config) {
    const source = (config?.obsPlayer?.sourceName || '').trim();
    if (!source) {
      throw new Error('OBS Ausgabe-Quelle fehlt');
    }

    const sourceKind = (config?.obsPlayer?.sourceKind || 'ffmpeg_source').trim();
    const sp = getScenepilotService();
    if (!sp.connected || !sp.obs) {
      throw new Error('OBS nicht verbunden. Bitte im Hub verbinden.');
    }

    if (sourceKind === 'vlc_source') {
      await sp.obs.call('SetInputSettings', {
        inputName: source,
        inputSettings: {
          playlist: [{ hidden: false, selected: true, value: track.path }],
          loop: false,
          shuffle: false,
        },
      });
    } else {
      await sp.obs.call('SetInputSettings', {
        inputName: source,
        inputSettings: {
          local_file: track.path,
          is_local_file: true,
        },
      });
    }

    await this._mediaAction(config, 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART');
  }

  async _clearObsSource(config) {
    const source = (config?.obsPlayer?.sourceName || '').trim();
    if (!source) {
      throw new Error('OBS Ausgabe-Quelle fehlt');
    }

    const sourceKind = (config?.obsPlayer?.sourceKind || 'ffmpeg_source').trim();
    const sp = getScenepilotService();
    if (!sp.connected || !sp.obs) {
      throw new Error('OBS nicht verbunden. Bitte im Hub verbinden.');
    }

    if (sourceKind === 'vlc_source') {
      await sp.obs.call('SetInputSettings', {
        inputName: source,
        inputSettings: {
          playlist: [],
          loop: false,
          shuffle: false,
        },
      });
      return;
    }

    await sp.obs.call('SetInputSettings', {
      inputName: source,
      inputSettings: {
        local_file: '',
        is_local_file: true,
      },
    });
  }

  async _mediaAction(config, action) {
    const source = (config?.obsPlayer?.sourceName || '').trim();
    if (!source) throw new Error('OBS Ausgabe-Quelle fehlt');

    const sp = getScenepilotService();
    if (!sp.connected || !sp.obs) {
      throw new Error('OBS nicht verbunden. Bitte im Hub verbinden.');
    }

    await sp.obs.call('TriggerMediaInputAction', {
      inputName: source,
      mediaAction: action,
    });
  }

  status() {
    const currentPlaylistTrack = this.currentIndex >= 0 ? this.playlist[this.currentIndex] : null;
    const totalDuration = this.playlist.reduce((sum, t) => sum + (t.duration || 0), 0);
    return {
      running:      this.running,
      lastError:    this.lastError,
      currentTrack: { ...this.currentTrack },
      outputText:   this.lastRenderedText,
      totalDuration,
      playlist: this.playlist.map((t, i) => ({
        id:        t.id,
        path:      t.path,
        title:     t.title,
        artist:    t.artist,
        album:     t.album,
        coverArt:  t.coverArt || null,
        duration:  t.duration || null,
        index:     i,
        isCurrent: i === this.currentIndex,
      })),
      player: {
        state:          this.playerState,
        currentIndex:   this.currentIndex,
        currentTrackId: currentPlaylistTrack?.id || null,
        loopMode:       this.loopMode,
        shuffle:        this.shuffle,
        mediaCursor:    this.mediaCursor,
        mediaDuration:  this.mediaDuration,
      },
      obsPlayback: {
        connected: !!getScenepilotService().connected,
      },
    };
  }

  renderAndWrite(config) {
    const text = this.render(config);
    this.writeOutput(config, text);
    this.lastRenderedText = text;
  }

  render(config) {
    const title = (this.currentTrack.title || '').trim();
    const artist = (this.currentTrack.artist || '').trim();
    const album = (this.currentTrack.album || '').trim();
    const fallback = (config?.fallbackText || '').trim();

    if (!title && !artist && !album) return fallback;

    const format = (config?.format || '{artist} - {title}').trim();
    return format
      .replace(/\{title\}/g, title)
      .replace(/\{artist\}/g, artist)
      .replace(/\{album\}/g, album)
      .replace(/\s+-\s+-/g, ' - ')
      .replace(/\s{2,}/g, ' ')
      .replace(/^-\s*/, '')
      .replace(/\s*-$/, '')
      .trim();
  }

  writeOutput(config, text) {
    const outputPath = (config?.outputPath || '').trim();
    if (!outputPath) {
      throw new Error('outputPath fehlt');
    }
    const dir = path.dirname(outputPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputPath, text || '', 'utf8');
  }
}

function normalizePlaylist(list) {
  return (Array.isArray(list) ? list : [])
    .filter((t) => t && t.path)
    .map((t) => ({
      id: t.id || uid(),
      path: String(t.path),
      title: String(t.title || path.basename(String(t.path), path.extname(String(t.path))) || ''),
      artist: String(t.artist || ''),
      album: String(t.album || ''),
      coverArt: t.coverArt || null,
      duration: t.duration || null,
    }));
}

function safeString(next, fallback) {
  if (next === undefined || next === null) return fallback || '';
  return String(next);
}

module.exports = new TunaPilotService();
