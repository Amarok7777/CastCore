/**
 * flowforgeEngine.js — runtime execution for FlowForge automation flows.
 *
 * attach({ timer, scenepilotService, tunapilotService }) must be called once
 * after servers start.  onChatMessage(msg) and onAlertEvent(item) are called
 * by server/index.js and chatdeckRoutes.js for every new event.
 */

const flowforge = require('../core/flowforge');

// Mirror of hotkeys.js KEY_MAP — must stay in sync with supported keys.
let _uiohook  = null;
let _UiohookKey = null;
let _KEY_MAP  = {};

try {
  const mod     = require('uiohook-napi');
  _uiohook      = mod.uIOhook;
  _UiohookKey   = mod.UiohookKey;
  _KEY_MAP = {
    Numpad0: _UiohookKey.Numpad0, Numpad1: _UiohookKey.Numpad1,
    Numpad2: _UiohookKey.Numpad2, Numpad3: _UiohookKey.Numpad3,
    Numpad4: _UiohookKey.Numpad4, Numpad5: _UiohookKey.Numpad5,
    Numpad6: _UiohookKey.Numpad6, Numpad7: _UiohookKey.Numpad7,
    Numpad8: _UiohookKey.Numpad8, Numpad9: _UiohookKey.Numpad9,
    F1:  _UiohookKey.F1,  F2:  _UiohookKey.F2,  F3:  _UiohookKey.F3,
    F4:  _UiohookKey.F4,  F5:  _UiohookKey.F5,  F6:  _UiohookKey.F6,
    F7:  _UiohookKey.F7,  F8:  _UiohookKey.F8,  F9:  _UiohookKey.F9,
    F10: _UiohookKey.F10, F11: _UiohookKey.F11, F12: _UiohookKey.F12,
    Space:  _UiohookKey.Space,
    Insert: _UiohookKey.Insert,
    Delete: _UiohookKey.Delete,
    Home:   _UiohookKey.Home,
    End:    _UiohookKey.End,
  };
} catch {
  // uiohook-napi not available (e.g. test environment) — hotkey triggers silently disabled
}

class FlowForgeEngine {
  constructor() {
    this._prevTimerState      = 'idle';
    this._currentScene        = null;
    this._sps                 = null;
    this._tps                 = null;
    this._timer               = null;
    this._obsListener         = null;
    this._streamStateListener = null;
    this._recordStateListener = null;
    this._hotkeyListener      = null;
    this._timerListeners      = [];
  }

  // ─── Attach / detach ──────────────────────────────────────────────────────

  detach() {
    if (this._timer) {
      for (const [evt, fn] of this._timerListeners) this._timer.off(evt, fn);
    }
    if (this._sps?.obs) {
      this._sps.obs.off?.('CurrentProgramSceneChanged', this._obsListener);
      this._sps.obs.off?.('StreamStateChanged',         this._streamStateListener);
      this._sps.obs.off?.('RecordStateChanged',         this._recordStateListener);
    }
    if (_uiohook && this._hotkeyListener) {
      _uiohook.off('keydown', this._hotkeyListener);
    }
    this._timerListeners      = [];
    this._obsListener         = null;
    this._streamStateListener = null;
    this._recordStateListener = null;
    this._hotkeyListener      = null;
    this._timer               = null;
    this._sps                 = null;
    this._tps                 = null;
  }

  attach({ timer, scenepilotService, tunapilotService }) {
    this.detach();
    this._sps   = scenepilotService;
    this._tps   = tunapilotService;
    this._timer = timer;

    // ── Timer events ──────────────────────────────────────────────────────
    const onStateChange = (snap) => {
      const prev = this._prevTimerState;
      const cur  = snap.state;
      this._prevTimerState = cur;
      if (prev !== 'running' && cur === 'running')
        this._fire(prev === 'paused' ? 'timer.resume' : 'timer.start', { snapshot: snap });
      if (prev !== 'paused' && cur === 'paused')
        this._fire('timer.pause', { snapshot: snap });
      if (cur === 'idle' && prev !== 'idle')
        this._fire('timer.reset', { snapshot: snap });
    };
    const onSplit = () => {
      const snap = timer.getSnapshot();
      this._fire('timer.split', { snapshot: snap, splitIndex: snap.currentSplit - 1 });
    };
    const onFinished = () => this._fire('timer.finish', { snapshot: timer.getSnapshot() });

    timer.on('stateChange', onStateChange);
    timer.on('split',       onSplit);
    timer.on('finished',    onFinished);
    this._timerListeners = [
      ['stateChange', onStateChange],
      ['split',       onSplit],
      ['finished',    onFinished],
    ];

    // ── OBS events ────────────────────────────────────────────────────────
    if (scenepilotService.obs) {
      this._obsListener = ({ sceneName }) => {
        this._currentScene = sceneName;
        this._fire('obs.scene', { scene: sceneName });
      };
      scenepilotService.obs.on?.('CurrentProgramSceneChanged', this._obsListener);

      this._streamStateListener = ({ outputActive }) => {
        this._fire(outputActive ? 'obs.stream_start' : 'obs.stream_stop', {});
      };
      scenepilotService.obs.on?.('StreamStateChanged', this._streamStateListener);

      this._recordStateListener = ({ outputActive }) => {
        this._fire(outputActive ? 'obs.record_start' : 'obs.record_stop', {});
      };
      scenepilotService.obs.on?.('RecordStateChanged', this._recordStateListener);
    }

    // ── Global hotkeys ────────────────────────────────────────────────────
    if (_uiohook) {
      this._hotkeyListener = (event) => {
        this._fire('hotkey', { keyCode: event.keycode });
      };
      _uiohook.on('keydown', this._hotkeyListener);
    }
  }

  // ─── External event entry-points ──────────────────────────────────────────

  onChatMessage(msg) {
    this._fire('chat.keyword', { message: msg });
  }

  onAlertEvent(item) {
    this._fire('alert.event', { alert: item });
  }

  // ─── Template resolver ─────────────────────────────────────────────────────

  _resolveTemplate(tpl, ctx) {
    const a = ctx.alert   || {};
    const m = ctx.message || {};
    return String(tpl || '')
      .replace(/{author}/g,  String(a.author  || m.authorName || ''))
      .replace(/{name}/g,    String(a.author  || m.authorName || ''))
      .replace(/{text}/g,    String(a.text    || m.text       || ''))
      .replace(/{amount}/g,  String(a.amount  || ''))
      .replace(/{viewers}/g, String(a.viewers || ''))
      .replace(/{scene}/g,   String(ctx.scene || ''))
      .replace(/{platform}/g,String(a.platform || m.platform || ''));
  }

  // ─── Trigger matching ──────────────────────────────────────────────────────

  _matchesTrigger(trigger, type, ctx) {
    if (!trigger || trigger.type !== type) return false;

    if (type === 'timer.split') {
      const cfg = trigger.splitIndex;
      if (cfg !== null && cfg !== undefined && cfg !== '') {
        if (Number(cfg) !== ctx.splitIndex) return false;
      }
    }

    if (type === 'obs.scene' && trigger.scene) {
      if (trigger.scene !== ctx.scene) return false;
    }

    if (type === 'chat.keyword' && trigger.keyword) {
      const kw   = trigger.keyword.toLowerCase();
      const text = (ctx.message?.text || '').toLowerCase();
      const mt   = trigger.matchType || 'contains';
      if (mt === 'exact'      && text !== kw)          return false;
      if (mt === 'startswith' && !text.startsWith(kw)) return false;
      if (mt === 'contains'   && !text.includes(kw))   return false;
    }

    if (type === 'alert.event') {
      const et = trigger.eventType;
      if (et && et !== 'any' && et !== ctx.alert?.eventType) return false;
      const pl = trigger.platform;
      if (pl && pl !== 'any' && pl !== ctx.alert?.platform)  return false;
    }

    if (type === 'hotkey') {
      if (!trigger.key) return false;
      const code = _KEY_MAP[trigger.key];
      if (code === undefined) return false;
      return ctx.keyCode === code;
    }

    return true;
  }

  // ─── Condition checks ──────────────────────────────────────────────────────

  async _checkConditions(conditions, ctx) {
    for (const c of (conditions || [])) {
      if (!await this._checkCondition(c, ctx)) return false;
    }
    return true;
  }

  async _checkCondition(cond, ctx) {
    const snap = ctx.snapshot;
    switch (cond.type) {

      case 'split.index':
        return ctx.splitIndex === Number(cond.index);

      case 'split.is_pb': {
        if (!snap) return false;
        const idx = ctx.splitIndex != null ? ctx.splitIndex : snap.currentSplit - 1;
        return snap.segments?.[idx]?.isGold === true;
      }

      case 'obs.scene_is':
        return this._currentScene === cond.scene;

      case 'timer.state_is':
        return (this._timer?.getSnapshot()?.state || 'idle') === cond.state;

      case 'alert.type_is':
        return ctx.alert?.eventType === cond.eventType;

      case 'chat.platform_is':
        return ctx.message?.platform === cond.platform;

      case 'obs.is_streaming': {
        if (!this._sps?.connected || !this._sps?.obs) return false;
        try {
          const s = await this._sps.obs.call('GetStreamStatus');
          return !!s?.outputActive;
        } catch { return false; }
      }

      case 'obs.is_recording': {
        if (!this._sps?.connected || !this._sps?.obs) return false;
        try {
          const r = await this._sps.obs.call('GetRecordStatus');
          return !!r?.outputActive;
        } catch { return false; }
      }

      default:
        return true;
    }
  }

  // ─── Action execution ──────────────────────────────────────────────────────

  async _runAction(action, ctx, _depth = 0) {
    const sps = this._sps;
    const tps = this._tps;

    switch (action.type) {

      // ── OBS ──────────────────────────────────────────────────────────────
      case 'obs.set_scene':
        if (sps?.connected && action.scene) await sps.setScene(action.scene);
        break;

      case 'obs.source_visibility':
        if (sps?.connected && action.scene && action.source) {
          await sps.executeAction({
            type:       'source-visibility',
            sceneName:  action.scene,
            sourceName: action.source,
            visible:    action.visible !== false,
          });
        }
        break;

      case 'obs.filter_visibility':
        if (sps?.connected && action.source && action.filter) {
          await sps.obs.call('SetSourceFilterEnabled', {
            sourceName:    action.source,
            filterName:    action.filter,
            filterEnabled: action.visible !== false,
          }).catch(e => console.error('[FlowForge] obs.filter_visibility:', e.message));
        }
        break;

      case 'obs.set_text':
        if (sps?.connected && action.source) {
          const text = this._resolveTemplate(action.text || '', ctx);
          await sps.obs.call('SetInputSettings', {
            inputName:     action.source,
            inputSettings: { text },
          }).catch(e => console.error('[FlowForge] obs.set_text:', e.message));
        }
        break;

      case 'obs.mute_source':
        if (sps?.connected && action.source) {
          await sps.obs.call('SetInputMute', {
            inputName:  action.source,
            inputMuted: true,
          }).catch(e => console.error('[FlowForge] obs.mute_source:', e.message));
        }
        break;

      case 'obs.unmute_source':
        if (sps?.connected && action.source) {
          await sps.obs.call('SetInputMute', {
            inputName:  action.source,
            inputMuted: false,
          }).catch(e => console.error('[FlowForge] obs.unmute_source:', e.message));
        }
        break;

      case 'obs.start_recording':
        if (sps?.connected) await sps.obs.call('StartRecord').catch(() => {});
        break;
      case 'obs.stop_recording':
        if (sps?.connected) await sps.obs.call('StopRecord').catch(() => {});
        break;
      case 'obs.start_streaming':
        if (sps?.connected) await sps.obs.call('StartStream').catch(() => {});
        break;
      case 'obs.stop_streaming':
        if (sps?.connected) await sps.obs.call('StopStream').catch(() => {});
        break;

      // ── TrackPulse ────────────────────────────────────────────────────────
      case 'trackpulse.play_playlist': {
        if (!tps || !action.playlistId) break;
        const tunapilot = require('../core/tunapilot');
        const cfg = tunapilot.getAll();
        const pl  = (cfg.namedPlaylists || []).find(p => p.id === action.playlistId);
        if (!pl?.tracks?.length) break;
        try {
          if (!tps.running) await tps.start(cfg);
          tps.clearPlaylist();
          await tps.addTracks(pl.tracks.map(t => t.path).filter(Boolean), tunapilot.getAll());
          await tps.play(tunapilot.getAll(), 0);
        } catch (e) {
          console.error('[FlowForge] trackpulse.play_playlist:', e.message);
        }
        break;
      }

      case 'trackpulse.play_next':
        if (tps?.running) {
          await tps.next(require('../core/tunapilot').getAll()).catch(() => {});
        }
        break;

      case 'trackpulse.pause':
        if (tps?.running) {
          await tps.pause(require('../core/tunapilot').getAll()).catch(() => {});
        }
        break;

      case 'trackpulse.resume':
        if (tps?.running) {
          await tps.resume(require('../core/tunapilot').getAll()).catch(() => {});
        }
        break;

      case 'trackpulse.set_volume': {
        const vol       = Math.max(0, Math.min(100, Number(action.volume) || 50));
        const tunapilot = require('../core/tunapilot');
        tunapilot.update({ player: { ...(tunapilot.getAll().player || {}), volume: vol } });
        const src = (tunapilot.getAll()?.obsPlayer?.sourceName || '').trim();
        if (src && sps?.connected && sps?.obs) {
          await sps.obs.call('SetInputVolume', {
            inputName:      src,
            inputVolumeMul: vol / 100,
          }).catch(() => {});
        }
        break;
      }

      case 'trackpulse.stop':
        if (tps) await tps.stopPlayer(require('../core/tunapilot').getAll()).catch(() => {});
        break;

      // ── Webhook ───────────────────────────────────────────────────────────
      case 'http.request': {
        if (!action.url) break;
        const url = String(action.url).trim();
        if (!/^https?:\/\//i.test(url)) {
          console.warn('[FlowForge] http.request: URL must start with http:// or https://');
          break;
        }
        const method  = ['GET','POST','PUT','PATCH','DELETE']
          .includes(String(action.method || '').toUpperCase())
          ? action.method.toUpperCase() : 'POST';
        const rawBody = action.body ? this._resolveTemplate(String(action.body), ctx) : undefined;
        try {
          await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'SplitFlow-FlowForge/1.0' },
            body: method !== 'GET' && rawBody ? rawBody : undefined,
          });
        } catch (e) {
          console.error('[FlowForge] http.request failed:', e.message);
        }
        break;
      }

      // ── Flow chaining ─────────────────────────────────────────────────────
      case 'flow.run': {
        if (_depth >= 5) {
          console.warn('[FlowForge] flow.run: max recursion depth reached — aborting chain');
          break;
        }
        const target = flowforge.getFlow(action.flowId);
        if (!target || target.enabled === false) break;
        for (const a of (target.actions || [])) {
          try { await this._runAction(a, ctx, _depth + 1); }
          catch (e) {
            console.error(`[FlowForge] flow.run "${target.name}" action ${a.type}:`, e.message);
          }
        }
        break;
      }

      // ── Misc ──────────────────────────────────────────────────────────────
      case 'delay':
        await new Promise(r => setTimeout(r, Math.max(0, Number(action.ms) || 0)));
        break;

      default:
        break;
    }
  }

  // ─── Core dispatch ─────────────────────────────────────────────────────────

  async _fire(triggerType, ctx) {
    const flows = flowforge.getFlows().filter(f => f.enabled !== false);
    for (const flow of flows) {
      if (!this._matchesTrigger(flow.trigger, triggerType, ctx)) continue;
      if (!await this._checkConditions(flow.conditions, ctx)) continue;
      for (const action of (flow.actions || [])) {
        try { await this._runAction(action, ctx, 0); }
        catch (e) {
          console.error(`[FlowForge] "${flow.name}" action ${action.type} error:`, e.message);
        }
      }
    }
  }
}

module.exports = new FlowForgeEngine();
