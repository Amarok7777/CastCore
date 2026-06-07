let OBSWebSocketCtor = null;
try {
  const pkg = require('obs-websocket-js');
  OBSWebSocketCtor = pkg.default || pkg.OBSWebSocket || pkg;
} catch {
  OBSWebSocketCtor = null;
}

class ScenePilotService {
  constructor() {
    this.obs = OBSWebSocketCtor ? new OBSWebSocketCtor() : null;
    this.connected = false;
    this.lastError = OBSWebSocketCtor ? null : 'obs-websocket-js is not installed';
    this.lastState = 'idle';

    if (this.obs) {
      this.obs.on?.('ConnectionClosed', () => {
        this.connected = false;
      });
      this.obs.on?.('ConnectionError', (e) => {
        this.connected = false;
        this.lastError = e?.message || 'OBS connection error';
      });
    }
  }

  attachOBSVolumeSync(broadcast) {
    if (!this.obs) return;
    this.obs.on?.('InputVolumeChanged', (event) => {
      try {
        broadcast({
          type: 'OBS_INPUT_VOLUME_CHANGED',
          payload: {
            inputName: event.inputName,
            inputVolumeMul: event.inputVolumeMul,
          },
        });
      } catch (e) {
        console.error('broadcast volume change failed', e);
      }
    });
  }

  attachTimer(timer, readConfig) {
    this.timer = timer;
    this.readConfig = readConfig;

    timer.on('stateChange', async (snapshot) => {
      try {
        const cfg = this.readConfig?.() || {};
        if (!cfg.timerAutomation?.enabled || !this.connected) return;
        const ta = cfg.timerAutomation;

        if (this.lastState !== 'running' && snapshot.state === 'running') {
          const scene = this.lastState === 'paused' ? ta.onResumeScene : ta.onStartScene;
          if (scene) await this.setScene(scene);
        }
        if (this.lastState !== 'paused' && snapshot.state === 'paused' && ta.onPauseScene) {
          await this.setScene(ta.onPauseScene);
        }
        if (snapshot.state === 'idle' && ta.onResetScene) {
          await this.setScene(ta.onResetScene);
        }

        this.lastState = snapshot.state;
      } catch (e) {
        this.lastError = e?.message || 'timer automation error';
      }
    });

    timer.on('split', async () => {
      try {
        const cfg = this.readConfig?.() || {};
        if (!cfg.timerAutomation?.enabled || !this.connected) return;
        const splitScenes = cfg.timerAutomation.splitScenes || {};
        const snapshot    = timer.getSnapshot();
        const scene       = splitScenes[String(snapshot.currentSplit)];
        if (scene) await this.setScene(scene);
      } catch (e) {
        this.lastError = e?.message || 'split automation error';
      }
    });

    timer.on('finished', async () => {
      try {
        const cfg = this.readConfig?.() || {};
        if (!cfg.timerAutomation?.enabled || !this.connected) return;
        if (cfg.timerAutomation.onFinishScene) {
          await this.setScene(cfg.timerAutomation.onFinishScene);
        }
      } catch (e) {
        this.lastError = e?.message || 'finish automation error';
      }
    });
  }

  async connect(address, password) {
    if (!this.obs) throw new Error('OBS library unavailable');

    if (this.connected) return { ok: true };

    try {
      // obs-websocket-js v5 signature
      await this.obs.connect(address, password || undefined);
    } catch {
      // compatibility fallback
      await this.obs.connect(address, password || undefined, { eventSubscriptions: 0 });
    }

    this.connected = true;
    this.lastError = null;
    return { ok: true };
  }

  async disconnect() {
    try {
      if (this.obs && this.connected) {
        await this.obs.disconnect();
      }
    } catch {
      // ignore
    }
    this.connected = false;
    return { ok: true };
  }

  status() {
    return {
      connected: this.connected,
      lastError: this.lastError,
      obsLibAvailable: !!this.obs,
    };
  }

  async listScenes() {
    this._requireConnected();
    const res = await this.obs.call('GetSceneList');
    return (res.scenes || []).map(s => ({ sceneName: s.sceneName }));
  }

  async listInputs() {
    this._requireConnected();
    const res = await this.obs.call('GetInputList');
    return (res.inputs || []).map(i => ({ inputName: i.inputName, inputKind: i.inputKind }));
  }

  async listSceneItems(sceneName) {
    this._requireConnected();
    if (!sceneName) throw new Error('sceneName is required');
    const res = await this.obs.call('GetSceneItemList', { sceneName });
    return (res.sceneItems || []).map(i => ({
      sourceName: i.sourceName,
      sceneItemId: i.sceneItemId,
    }));
  }

  async getInputVolume(inputName) {
    this._requireConnected();
    if (!inputName) throw new Error('inputName is required');
    const res = await this.obs.call('GetInputVolume', { inputName });
    return res.inputVolumeMul || 0;
  }

  async executeMacro(macro) {
    this._requireConnected();

    let fallbackSceneName = '';
    for (const action of macro.actions || []) {
      if (action?.type === 'scene' && !String(action.sceneName || '').trim()) {
        if (!fallbackSceneName) {
          const current = await this.obs.call('GetCurrentProgramScene').catch(() => ({}));
          fallbackSceneName = String(current?.currentProgramSceneName || '').trim();
        }
        if (!fallbackSceneName) {
          // Keep default macros safe: skip empty scene actions when no fallback is available.
          continue;
        }
        await this.executeAction({ ...action, sceneName: fallbackSceneName });
        continue;
      }

      await this.executeAction(action);
    }
    return { ok: true };
  }

  async executeAction(action) {
    this._requireConnected();

    switch (action?.type) {
      case 'scene': {
        if (!action.sceneName) throw new Error('sceneName is required');
        await this.setScene(action.sceneName);
        return;
      }
      case 'source-visibility': {
        if (!action.sceneName || !action.sourceName) throw new Error('sceneName and sourceName are required');
        const idRes = await this.obs.call('GetSceneItemId', {
          sceneName: action.sceneName,
          sourceName: action.sourceName,
        });
        await this.obs.call('SetSceneItemEnabled', {
          sceneName: action.sceneName,
          sceneItemId: idRes.sceneItemId,
          sceneItemEnabled: !!action.enabled,
        });
        return;
      }
      case 'toggle-mute': {
        if (!action.inputName) throw new Error('inputName is required');
        const cur = await this.obs.call('GetInputMute', { inputName: action.inputName });
        await this.obs.call('SetInputMute', {
          inputName: action.inputName,
          inputMuted: !cur.inputMuted,
        });
        return;
      }
      case 'toggle-visibility': {
        if (!action.sceneName || !action.sourceName) throw new Error('sceneName and sourceName are required');
        const idRes2 = await this.obs.call('GetSceneItemId', {
          sceneName: action.sceneName,
          sourceName: action.sourceName,
        });
        const curEnabled = await this.obs.call('GetSceneItemEnabled', {
          sceneName: action.sceneName,
          sceneItemId: idRes2.sceneItemId,
        });
        await this.obs.call('SetSceneItemEnabled', {
          sceneName: action.sceneName,
          sceneItemId: idRes2.sceneItemId,
          sceneItemEnabled: !curEnabled.sceneItemEnabled,
        });
        return;
      }
      case 'mute': {
        if (!action.inputName) throw new Error('inputName is required');
        await this.obs.call('SetInputMute', {
          inputName: action.inputName,
          inputMuted: !!action.muted,
        });
        return;
      }
      case 'volume': {
        if (!action.inputName) throw new Error('inputName is required');
        const mul = Number(action.multiplier);
        const safeMul = Number.isFinite(mul) ? Math.max(0, Math.min(1, mul)) : 1;
        await this.obs.call('SetInputVolume', {
          inputName: action.inputName,
          inputVolumeMul: safeMul,
        });
        return;
      }
      default:
        throw new Error(`Unknown action type: ${action?.type}`);
    }
  }

  async setScene(sceneName) {
    this._requireConnected();
    await this.obs.call('SetCurrentProgramScene', { sceneName });
  }

  _requireConnected() {
    if (!this.obs) throw new Error('OBS library unavailable');
    if (!this.connected) throw new Error('OBS is not connected');
  }
}

module.exports = new ScenePilotService();
