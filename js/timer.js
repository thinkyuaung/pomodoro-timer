/**
 * timer.js — countdown engine and focus/break switching. No DOM access.
 *
 * Exposes one global: Timer
 *
 * Usage:
 *   const t = Timer.create(settings, {
 *     onTick(state)          // display may need updating (fires when the shown second changes)
 *     onModeChange(state)    // mode switched (focus / short / long)
 *     onFocusComplete(min, state) // a focus session ran to completion
 *   });
 *   t.start(); t.pause(); t.toggle(); t.reset(); t.updateSettings(s); t.getState();
 *
 * Accuracy: remaining time is always computed from an absolute endTime
 * timestamp, so throttled timers in background tabs don't cause drift.
 */
const Timer = (() => {
  const MODES = Object.freeze(['focus', 'short', 'long']);
  const TICK_MS = 250;
  const MS_PER_MIN = 60 * 1000;

  const realClock = {
    now: () => Date.now(),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
  };

  function noop() {}

  /**
   * @param {{focus:number, short:number, long:number, longEvery:number}} settings
   * @param {object} [callbacks]
   * @param {object} [clock] injectable for tests: { now, setInterval, clearInterval }
   */
  function create(settings, callbacks = {}, clock = realClock) {
    const onTick = callbacks.onTick || noop;
    const onModeChange = callbacks.onModeChange || noop;
    const onFocusComplete = callbacks.onFocusComplete || noop;

    let active = { ...settings };   // settings used for the current session
    let pending = null;             // settings waiting for the next switch/reset

    let mode = 'focus';
    let durationMs = minutesToMs(active.focus); // full length of current session
    let remainingMs = durationMs;
    let endTime = null;             // set only while running
    let intervalId = null;
    let focusCount = 0;             // completed focus sessions since page load
    let lastShownSecond = null;

    function minutesToMs(min) {
      return min * MS_PER_MIN;
    }

    function durationFor(m) {
      return minutesToMs(active[m]);
    }

    function isRunning() {
      return endTime !== null;
    }

    /** Untouched = not running and still at full length (never started or just reset). */
    function isUntouched() {
      return !isRunning() && remainingMs === durationMs;
    }

    function currentRemaining() {
      return isRunning() ? Math.max(0, endTime - clock.now()) : remainingMs;
    }

    function applyPendingSettings() {
      if (pending) {
        active = pending;
        pending = null;
      }
    }

    function getState() {
      const longEvery = active.longEvery;
      return {
        mode,
        running: isRunning(),
        remainingMs: currentRemaining(),
        durationMs,
        focusCount,
        longEvery,
        // 1-based position of the focus session within the current cycle.
        // During a break this is the session just finished.
        cyclePosition: mode === 'focus'
          ? (focusCount % longEvery) + 1
          : ((focusCount - 1) % longEvery) + 1,
      };
    }

    function emitTick(force = false) {
      const second = Math.ceil(currentRemaining() / 1000);
      if (force || second !== lastShownSecond) {
        lastShownSecond = second;
        onTick(getState());
      }
    }

    function stopInterval() {
      if (intervalId !== null) {
        clock.clearInterval(intervalId);
        intervalId = null;
      }
    }

    function setMode(next) {
      applyPendingSettings();
      mode = next;
      durationMs = durationFor(next);
      remainingMs = durationMs;
      onModeChange(getState());
    }

    function nextMode() {
      if (mode !== 'focus') return 'focus';
      return focusCount % active.longEvery === 0 ? 'long' : 'short';
    }

    function finish() {
      stopInterval();
      endTime = null;
      remainingMs = 0;

      if (mode === 'focus') {
        focusCount += 1;
        // Record the length this session actually ran with, not any pending change.
        onFocusComplete(durationMs / MS_PER_MIN, getState());
      }

      setMode(nextMode());
      start(); // auto-start the next session
    }

    function tick() {
      if (currentRemaining() <= 0) {
        finish();
      } else {
        emitTick();
      }
    }

    // ---------- public API ----------

    function start() {
      if (isRunning()) return;
      endTime = clock.now() + remainingMs;
      intervalId = clock.setInterval(tick, TICK_MS);
      emitTick(true);
    }

    function pause() {
      if (!isRunning()) return;
      remainingMs = currentRemaining();
      endTime = null;
      stopInterval();
      emitTick(true);
    }

    function toggle() {
      if (isRunning()) pause();
      else start();
    }

    /** Stops and restores the current mode to full length. Nothing is recorded. */
    function reset() {
      stopInterval();
      endTime = null;
      applyPendingSettings();
      durationMs = durationFor(mode);
      remainingMs = durationMs;
      emitTick(true);
    }

    /**
     * New settings apply immediately if the timer is untouched,
     * otherwise at the next mode switch or reset.
     * @returns {boolean} true if applied immediately
     */
    function updateSettings(next) {
      pending = { ...next };
      if (isUntouched()) {
        reset();
        return true;
      }
      return false;
    }

    return Object.freeze({ start, pause, toggle, reset, updateSettings, getState });
  }

  return Object.freeze({ MODES, create });
})();
