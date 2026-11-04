/**
 * app.js — wires the page to AppStorage, Timer and Stats.
 * The only file that touches the DOM. Exposes no globals.
 */
(() => {
  'use strict';

  // ---------- elements ----------

  const $ = (sel) => document.querySelector(sel);

  const els = {
    app: $('.app'),
    modes: document.querySelectorAll('.mode'),
    time: $('#time'),
    cycle: $('#cycle'),
    startPause: $('#startPause'),
    reset: $('#reset'),
    status: $('#status'),
    todayCount: $('#todayCount'),
    totalFocus: $('#totalFocus'),
    toggleBtns: document.querySelectorAll('.toggle-btn'),
    chart: $('#chart'),
    form: $('#settingsForm'),
    formMsg: $('#settingsError'),
    restoreDefaults: $('#restoreDefaults'),
    progressBar: $('#progressBar'),
    modeHint: $('#modeHint'),
    siteLists: document.querySelectorAll('.site-list'),
  };

  const MODE_NAMES = { focus: 'Focus', short: 'Short Break', long: 'Long Break' };
  const NUMBER_FIELDS = Object.keys(AppStorage.LIMITS);
  const SITE_FIELDS = ['blockedSites', 'allowedSites'];
  const ALL_FIELDS = [...NUMBER_FIELDS, 'blockMode', ...SITE_FIELDS];

  const MODE_HINTS = {
    off: 'Blocking is off. All sites are allowed during focus.',
    blocklist: 'During focus, the sites below (and their subdomains) are blocked.',
    allowlist: 'During focus, every site is blocked except the ones below.',
  };

  let chartRange = 'daily';

  // ---------- formatting ----------

  function formatClock(ms) {
    const totalSec = Math.ceil(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function cycleText(state) {
    const { mode, cyclePosition, longEvery } = state;
    if (mode === 'focus') return `Session ${cyclePosition} of ${longEvery}`;
    if (mode === 'long') return `Cycle complete — enjoy your long break`;
    return `Break after session ${cyclePosition} of ${longEvery}`;
  }

  function announce(text) {
    els.status.textContent = text;
  }

  // ---------- timer rendering ----------

  function renderTimer(state) {
    const clock = formatClock(state.remainingMs);
    els.time.textContent = clock;
    els.startPause.textContent = state.running ? 'Pause' : 'Start';
    document.title = `${clock} – ${MODE_NAMES[state.mode]}`;
    const elapsed = 1 - state.remainingMs / state.durationMs;
    els.progressBar.style.setProperty('--p', `${Math.min(100, Math.max(0, elapsed * 100))}%`);
  }

  function renderMode(state) {
    els.app.dataset.mode = state.mode;
    els.modes.forEach((li) => {
      if (li.dataset.mode === state.mode) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    });
    els.cycle.textContent = cycleText(state);
  }

  // ---------- stats rendering ----------

  function renderStats() {
    const sessions = AppStorage.getSessions();
    els.todayCount.textContent = String(Stats.sessionsToday(sessions));
    els.totalFocus.textContent = Stats.formatMinutes(Stats.totalFocusMinutes(sessions));
    renderChart(sessions);
  }

  function renderChart(sessions) {
    const data = chartRange === 'daily'
      ? Stats.dailyHistory(sessions, 7)
      : Stats.weeklyHistory(sessions, 8);

    els.chart.replaceChildren();

    const max = Math.max(...data.map((d) => d.minutes));
    if (max === 0) {
      const p = document.createElement('p');
      p.className = 'chart-empty';
      p.textContent = chartRange === 'daily'
        ? 'No focus sessions in the last 7 days.'
        : 'No focus sessions in the last 8 weeks.';
      els.chart.appendChild(p);
      els.chart.setAttribute('aria-label', p.textContent);
      return;
    }

    const summary = [];
    for (const d of data) {
      const col = document.createElement('div');
      col.className = 'bar-col' + (d.isCurrent ? ' is-current' : '');
      const sessionWord = d.count === 1 ? 'session' : 'sessions';
      col.title = `${d.title}: ${d.count} ${sessionWord}, ${Stats.formatMinutes(d.minutes)}`;

      const value = document.createElement('span');
      value.className = 'bar-value';
      value.textContent = d.minutes > 0 ? Stats.formatMinutes(d.minutes) : '';

      const track = document.createElement('div');
      track.className = 'bar-track';
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.style.setProperty('--h', `${(d.minutes / max) * 100}%`);
      track.appendChild(bar);

      const label = document.createElement('span');
      label.className = 'bar-label';
      label.textContent = d.label;

      col.append(value, track, label);
      els.chart.appendChild(col);
      summary.push(`${d.title} ${Stats.formatMinutes(d.minutes)}`);
    }
    els.chart.setAttribute('aria-label', `Focus minutes: ${summary.join('; ')}`);
  }

  function setChartRange(range) {
    chartRange = range;
    els.toggleBtns.forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.range === range));
    });
    renderChart(AppStorage.getSessions());
  }

  // ---------- sound (Web Audio, no files) ----------

  let audioCtx = null;

  /** Must be called from a user gesture so browsers allow audio later. */
  function unlockAudio() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  function beep() {
    if (!audioCtx) return;
    try {
      const t = audioCtx.currentTime;
      [0, 0.25].forEach((offset) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, t + offset);
        gain.gain.exponentialRampToValueAtTime(0.25, t + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.2);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t + offset);
        osc.stop(t + offset + 0.22);
      });
    } catch (err) {
      console.warn('[app] could not play sound', err);
    }
  }

  // ---------- settings form ----------

  function fillForm(settings) {
    for (const field of SETTING_FIELDS) {
      const input = els.form.elements[field];
      input.value = settings[field];
      input.removeAttribute('aria-invalid');
    }
  }

  function showFormMessage(text, isSuccess = false) {
    els.formMsg.textContent = text;
    els.formMsg.classList.toggle('is-success', isSuccess);
  }

  function readForm() {
    const values = { ...AppStorage.getSettings() }; // keep fields the form doesn't show yet
    for (const field of SETTING_FIELDS) {
      const raw = els.form.elements[field].value.trim();
      values[field] = raw === '' ? NaN : Number(raw);
    }
    return values;
  }

  function appliedMessage(appliedNow) {
    return appliedNow ? 'Saved.' : 'Saved. New durations apply from the next session.';
  }

  function onSettingsSubmit(event) {
    event.preventDefault();
    const result = AppStorage.saveSettings(readForm());

    for (const field of SETTING_FIELDS) {
      const input = els.form.elements[field];
      if (result.invalidFields.includes(field)) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }

    if (!result.ok) {
      showFormMessage(result.errors.join(' '));
      return;
    }
    const appliedNow = timer.updateSettings(result.settings);
    showFormMessage(appliedMessage(appliedNow), true);
    renderMode(timer.getState());
  }

  function onRestoreDefaults() {
    const defaults = AppStorage.resetSettings();
    fillForm(defaults);
    const appliedNow = timer.updateSettings(defaults);
    showFormMessage(appliedMessage(appliedNow).replace('Saved', 'Defaults restored'), true);
    renderMode(timer.getState());
  }

  // ---------- timer ----------

  const timer = Timer.create(AppStorage.getSettings(), {
    onTick: renderTimer,

    onModeChange(state) {
      renderMode(state);
      renderStats(); // also keeps "today" correct after midnight
      beep();
      announce(`${MODE_NAMES[state.mode]} started.`);
    },

    onFocusComplete(durationMin) {
      if (!AppStorage.addSession(durationMin)) {
        console.warn('[app] focus session could not be saved');
      }
    },
  });

  // ---------- events ----------

  els.startPause.addEventListener('click', () => {
    unlockAudio();
    timer.toggle();
    announce(timer.getState().running ? 'Timer started.' : 'Timer paused.');
  });

  els.reset.addEventListener('click', () => {
    timer.reset();
    announce('Timer reset.');
  });

  els.toggleBtns.forEach((btn) => {
    btn.addEventListener('click', () => setChartRange(btn.dataset.range));
  });

  els.form.addEventListener('submit', onSettingsSubmit);
  els.restoreDefaults.addEventListener('click', onRestoreDefaults);

  // Keyboard: Space = start/pause, R = reset.
  // Ignored while typing; Space is also left alone on buttons/summary (native activation).
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    if (event.target.closest('input, textarea, select')) return;

    if (event.code === 'Space') {
      if (event.target.closest('button, summary')) return;
      event.preventDefault();
      els.startPause.click();
    } else if (event.key === 'r' || event.key === 'R') {
      els.reset.click();
    }
  });

  // Refresh "today" figures when the user comes back to the tab (e.g. next morning).
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) renderStats();
  });

  // ---------- init ----------

  fillForm(AppStorage.getSettings());
  const initial = timer.getState();
  renderMode(initial);
  renderTimer(initial);
  renderStats();
})();
