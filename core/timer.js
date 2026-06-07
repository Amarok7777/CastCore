const EventEmitter = require('events');

/**
 * Timer state machine.
 *
 * States:   idle → running ⇄ paused → finished → idle
 * Segments: each split stores { startedAt, endedAt, duration, skipped, isGold }
 *
 * All times are in milliseconds internally; exposed as seconds to consumers.
 */
class Timer extends EventEmitter {
  constructor() {
    super();
    this._reset();
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /** Dispatch a timer action by name. */
  dispatch(action) {
    // 'start' acts as start/split/resume/new-run depending on state
    if (action === 'start') {
      if (this.state === 'idle')     return this._start();
      if (this.state === 'paused')   return this._resume();
      if (this.state === 'running')  return this._split();
      if (this.state === 'finished') { this._reset(); return this._start(); }
      return;
    }

    const handlers = {
      pause:  () => this._pause(),
      resume: () => this._resume(),
      reset:  () => this._reset(),
      split:  () => this._split(),
      undo:   () => this._undo(),
      skip:   () => this._skip(),
    };

    if (handlers[action]) handlers[action]();
  }

  /** Load a splits profile into the timer (resets first). */
  loadProfile(profile) {
    this._reset();
    this.attempts      = profile.attempts || 0;
    this.finishedCount = profile.finished  || 0;
    this.profile = profile;
    // Guard: tolerate profiles with missing/null splits array
    this.segments = (profile.splits || []).map(s => ({
      name:     s.name,
      pb:       s.pb,       // seconds
      gold:     s.gold,     // seconds (best segment ever)
      sobTime:  s.sobTime,  // seconds (sum-of-best contribution)
      // runtime fields:
      startedAt: null,
      endedAt:   null,
      duration:  null,      // ms
      skipped:   false,
      isGold:    false,
      _prevGold: undefined, // saved before potential gold overwrite — allows _undo() to restore it
    }));
    this._emit();
  }

  /** Return a serializable snapshot of the current state. */
  getSnapshot() {
    const elapsed = this._getElapsed();
    return {
      state:        this.state,
      currentSplit: this.currentSplit,
      elapsed,                                   // seconds (float)
      elapsedMs:    Math.floor(elapsed * 1000),  // integer ms for display
      attempts:     this.attempts,
      finishedCount:this.finishedCount,
      profile:      this.profile,
      segments:     this.segments.map(s => ({
        name:      s.name,
        pb:        s.pb,
        gold:      s.gold,
        duration:  s.duration !== null ? s.duration / 1000 : null,
        skipped:   s.skipped,
        isGold:    s.isGold,
        // cumulative split time for done splits
        splitTime: this._getCumulativeSplitTime(s),
        // delta vs pb at this split position
        delta:     this._getDelta(s),
      })),
      // derived totals
      pbTotal:     this._getPbTotal(),
      sobTotal:    this._getSobTotal(),
      liveDelta:   this._getLiveDelta(elapsed),
    };
  }

  // ─── State transitions ──────────────────────────────────────────────────────

  _start() {
    if (this.state !== 'idle') return;
    this.attempts++;
    this.startTime = this._now();
    this.state = 'running';

    if (this.segments.length > 0) {
      this.segments[0].startedAt = this.startTime;
    }
    this._emit('stateChange');
  }

  _pause() {
    if (this.state !== 'running') return;
    this.pausedAt = this._now();
    this.state = 'paused';
    this._emit('stateChange');
  }

  _resume() {
    if (this.state !== 'paused') return;
    // Absorb pause duration into offset so elapsed stays correct
    this.pauseOffset += this._now() - this.pausedAt;
    this.pausedAt = null;
    this.state = 'running';
    this._emit('stateChange');
  }

  _split() {
    if (this.state !== 'running') return;
    if (this.currentSplit >= this.segments.length) return;

    const seg = this.segments[this.currentSplit];

    // duration = elapsed now minus cumulative elapsed of all prior splits
    seg.duration = this._getElapsed() * 1000 - this._getCumulativeMs(this.currentSplit - 1);
    seg.skipped  = false;

    seg._prevGold = seg.gold;
    seg.isGold    = seg.gold !== null && seg.duration / 1000 < seg.gold;
    if (seg.isGold) seg.gold = seg.duration / 1000;

    const now = this._now();
    seg.endedAt = now;

    this.currentSplit++;
    this._startNextSegment(now);
    this._emit('split');
  }

  _undo() {
    if (this.currentSplit === 0) return;
    this.currentSplit--;
    const seg = this.segments[this.currentSplit];

    if (seg._prevGold !== undefined) {
      seg.gold      = seg._prevGold;
      seg._prevGold = undefined;
    }

    seg.endedAt  = null;
    seg.duration = null;
    seg.skipped  = false;
    seg.isGold   = false;

    if (this.state === 'finished') {
      this.state       = 'running';
      this._finishedAt = null;   // prevent stale _finishedAt if run finishes again
    }
    this._emit('undo');
  }

  _skip() {
    if (this.state !== 'running') return;
    if (this.currentSplit >= this.segments.length) return;

    const seg = this.segments[this.currentSplit];
    seg.skipped  = true;
    seg.duration = null;
    seg.isGold   = false;

    this.currentSplit++;
    this._startNextSegment(this._now());
    this._emit('skip');
  }

  _reset() {
    this.state        = 'idle';
    this.startTime    = null;
    this.pausedAt     = null;
    this.pauseOffset  = 0;
    this.currentSplit = 0;
    // attempts/finishedCount survive reset — only loadProfile() resets them from disk
    this.attempts      = this.attempts      || 0;
    this.finishedCount = this.finishedCount || 0;
    this.profile      = null;
    this.segments     = [];
    // cleared before _emit — first snapshot after reset must not carry a stale finish time
    this._finishedAt  = null;
    this._emit('reset');
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  _now() { return Date.now(); }

  _getElapsed() {
    if (!this.startTime) return 0;
    if (this.state === 'paused') {
      return (this.pausedAt - this.startTime - this.pauseOffset) / 1000;
    }
    if (this.state === 'finished') {
      if (!this._finishedAt) return 0;
      return (this._finishedAt - this.startTime - this.pauseOffset) / 1000;
    }
    return (this._now() - this.startTime - this.pauseOffset) / 1000;
  }

  _getCumulativeMs(upToIndex) {
    // Called with -1 on the very first split: loop condition (0 <= -1) is false
    // immediately, so 0 is returned correctly without any special guard needed.
    let total = 0;
    for (let i = 0; i <= upToIndex; i++) {
      if (i >= this.segments.length) break;
      if (this.segments[i].duration !== null) total += this.segments[i].duration;
    }
    return total;
  }

  _getCumulativeSplitTime(seg) {
    const idx = this.segments.indexOf(seg);
    if (idx < 0 || seg.duration === null) return null;
    return this._getCumulativeMs(idx) / 1000;
  }

  _getDelta(seg) {
    const idx = this.segments.indexOf(seg);
    if (idx < 0 || seg.duration === null) return null;
    const actualCum = this._getCumulativeMs(idx) / 1000;
    const pbCum = this.segments.slice(0, idx + 1).reduce((a, s) => a + (s.pb || 0), 0);
    return actualCum - pbCum;
  }

  _getLiveDelta(elapsed) {
    if (this.state !== 'running' || this.currentSplit === 0) return null;
    const pbCumSoFar = this.segments.slice(0, this.currentSplit).reduce((a, s) => a + (s.pb || 0), 0);
    const actualSoFar = this._getCumulativeMs(this.currentSplit - 1) / 1000;
    return actualSoFar - pbCumSoFar;
  }

  _getPbTotal() {
    if (!this.segments.length) return null;
    return this.segments.reduce((a, s) => a + (s.pb || 0), 0);
  }

  _getSobTotal() {
    if (!this.segments.length) return null;
    return this.segments.reduce((a, s) => a + (s.sobTime ?? s.gold ?? s.pb ?? 0), 0);
  }

  _startNextSegment(now) {
    if (this.currentSplit < this.segments.length) {
      this.segments[this.currentSplit].startedAt = now;
    } else {
      // All splits done — finish run
      this._finishedAt = now;
      this.state = 'finished';
      this.finishedCount++;
      this._emit('finished');
    }
  }

  _emit(event = 'update') {
    // guard prevents double-broadcast when event === 'update'
    if (event !== 'update') {
      this.emit(event, this.getSnapshot());
    }
    this.emit('update', this.getSnapshot());
  }
}

module.exports = new Timer(); // singleton
