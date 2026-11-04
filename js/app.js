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
    blockStatus: $('#blockStatus'),
    blockerNote: $('#blockerNote'),
    durationsSummary: $('#durationsSummary'),
    blockingSummary: $('#blockingSummary'),
    dataSummary: $('#dataSummary'),
    clearHistory: $('#clearHistory'),
    settingsMenu: $('.settings-menu'),
    gearBtn: $('.gear-btn'),
    closeSettings: $('#closeSettings'),
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
  let currentSettings = AppStorage.getSettings();
  // What was last sent to SiteBlocker (avoids a message every tick). Starts as 'none' so a
  // freshly opened page (e.g. "Back to timer" from the blocked page) never clears rules
  // another timer tab set; leftover rules always expire via the background's end-time alarm.
  let lastBlockKey = 'none';

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
    renderSettingSummaries(sessions);
  }

  // ---------- settings row summaries (always describe what is SAVED) ----------

  function plural(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
  }

  function blockingSummaryText(settings) {
    const { blockMode, blockedSites, allowedSites } = settings;
    if (blockMode === 'off') return 'Off';
    const text = blockMode === 'blocklist'
      ? `Blocking ${plural(blockedSites.length, 'site')} during focus`
      : `Only ${plural(allowedSites.length, 'site')} allowed during focus`;
    return SiteBlocker.isAvailable() ? text : `${text} · needs the extension`;
  }

  function renderSettingSummaries(sessions = AppStorage.getSessions()) {
    const s = currentSettings;
    els.durationsSummary.textContent =
      `${s.focus} / ${s.short} / ${s.long} min · long break every ${s.longEvery}`;
    els.blockingSummary.textContent = blockingSummaryText(s);
    els.dataSummary.textContent = `${plural(sessions.length, 'focus session')} saved`;
  }

  /** Opens the settings row that contains the given field so its error is visible. */
  function revealField(field) {
    const el = els.form.elements[field];
    const target = el instanceof HTMLElement ? el : el && el[0]; // RadioNodeList → first radio
    if (!target) return;
    const menu = target.closest('.settings-menu');
    if (menu) menu.open = true; // the settings drop-down card
    const row = target.closest('.setting-row');
    if (row) row.open = true;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function onClearHistory() {
    const count = AppStorage.getSessions().length;
    if (count === 0) {
      showFormMessage('There is no focus history to clear.', true);
      return;
    }
    if (!window.confirm(`Delete all ${plural(count, 'saved focus session')}? This cannot be undone.`)) return;
    AppStorage.clearSessions();
    renderStats();
    showFormMessage('Focus history cleared.', true);
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

  /** Sets aria-invalid on every field listed (radio groups are skipped). */
  function markInvalid(invalidFields) {
    for (const field of ALL_FIELDS) {
      const el = els.form.elements[field];
      if (!(el instanceof HTMLElement)) continue; // RadioNodeList
      if (invalidFields.includes(field)) el.setAttribute('aria-invalid', 'true');
      else el.removeAttribute('aria-invalid');
    }
  }

  function selectedBlockMode() {
    return els.form.elements.blockMode.value || 'off';
  }

  /** Shows only the site list that belongs to the selected mode. */
  function renderBlockModeUI() {
    const mode = selectedBlockMode();
    els.siteLists.forEach((list) => {
      list.hidden = list.dataset.forMode !== mode;
    });
    els.modeHint.textContent = MODE_HINTS[mode];
  }

  function fillForm(settings) {
    for (const field of NUMBER_FIELDS) {
      els.form.elements[field].value = settings[field];
    }
    els.form.elements.blockMode.value = settings.blockMode;
    for (const field of SITE_FIELDS) {
      els.form.elements[field].value = settings[field].join('\n');
    }
    markInvalid([]);
    renderBlockModeUI();
  }

  function showFormMessage(text, isSuccess = false) {
    els.formMsg.textContent = text;
    els.formMsg.classList.toggle('is-success', isSuccess);
  }

  /** Raw form values; AppStorage does all validation and site normalization. */
  function readForm() {
    const values = {};
    for (const field of NUMBER_FIELDS) {
      const raw = els.form.elements[field].value.trim();
      values[field] = raw === '' ? NaN : Number(raw);
    }
    values.blockMode = selectedBlockMode();
    for (const field of SITE_FIELDS) {
      values[field] = els.form.elements[field].value; // newline-separated text
    }
    return values;
  }

  function appliedMessage(appliedNow) {
    return appliedNow ? 'Saved.' : 'Saved. New durations apply from the next session.';
  }

  function durationsChanged(before, after) {
    return NUMBER_FIELDS.some((field) => before[field] !== after[field]);
  }

  function onSettingsSubmit(event) {
    event.preventDefault();
    const before = AppStorage.getSettings();
    const result = AppStorage.saveSettings(readForm());
    markInvalid(result.invalidFields);

    if (!result.ok) {
      showFormMessage(result.errors.join(' '));
      revealField(result.invalidFields[0]); // never leave an error hidden in a closed row
      return;
    }
    fillForm(result.settings); // show normalized sites (e.g. "https://www.x.com/a" → "x.com")
    currentSettings = result.settings;
    renderSettingSummaries();
    const appliedNow = timer.updateSettings(result.settings);
    showFormMessage(appliedMessage(appliedNow || !durationsChanged(before, result.settings)), true);
    renderMode(timer.getState());
    syncBlocking(timer.getState()); // site settings apply immediately
  }

  function onRestoreDefaults() {
    const defaults = AppStorage.resetSettings();
    fillForm(defaults);
    currentSettings = defaults;
    renderSettingSummaries();
    const appliedNow = timer.updateSettings(defaults);
    showFormMessage(appliedMessage(appliedNow).replace('Saved', 'Defaults restored'), true);
    renderMode(timer.getState());
    syncBlocking(timer.getState());
  }

  // ---------- site blocking ----------

  /** What should be blocked right now, or null. Only while a focus session is running. */
  function desiredBlock(state) {
    if (state.mode !== 'focus' || !state.running) return null;
    const { blockMode, blockedSites, allowedSites } = currentSettings;
    if (blockMode === 'blocklist' && blockedSites.length > 0) return { mode: blockMode, sites: blockedSites };
    if (blockMode === 'allowlist' && allowedSites.length > 0) return { mode: blockMode, sites: allowedSites };
    return null;
  }

  function blockStatusText(block) {
    const n = block.sites.length;
    const sites = n === 1 ? 'site' : 'sites';
    return block.mode === 'blocklist' ? `Blocking ${n} ${sites}` : `Only ${n} ${sites} allowed`;
  }

  function renderBlockStatus(block) {
    const show = block !== null && SiteBlocker.isAvailable();
    els.blockStatus.hidden = !show;
    els.blockStatus.textContent = show ? blockStatusText(block) : '';
  }

  /** Sends apply/clear to the extension only when the desired blocking actually changes. */
  function syncBlocking(state) {
    const block = desiredBlock(state);
    const key = block ? JSON.stringify(block) : 'none';
    if (key === lastBlockKey) return;
    lastBlockKey = key;

    renderBlockStatus(block);
    if (block) SiteBlocker.apply({ ...block, endTime: Date.now() + state.remainingMs });
    else SiteBlocker.clear();
  }

  // ---------- timer ----------

  const timer = Timer.create(currentSettings, {
    onTick(state) {
      renderTimer(state);
      syncBlocking(state); // start/pause/reset/mode switch all emit a tick
    },

    onModeChange(state) {
      renderMode(state);
      renderStats(); // also keeps "today" correct after midnight
      beep();
      announce(state.mode === 'focus'
        ? 'Focus started.'
        : `Focus complete. ${MODE_NAMES[state.mode]} is ready — press Start when you are.`);
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
  els.clearHistory.addEventListener('click', onClearHistory);

  // Settings drop-down card (<details class="settings-menu">): ⚙ toggles it natively;
  // ✕, Esc and a click outside also close it.
  function closeSettingsMenu(returnFocus) {
    if (!els.settingsMenu.open) return;
    els.settingsMenu.open = false;
    if (returnFocus) els.gearBtn.focus();
  }

  els.closeSettings.addEventListener('click', () => closeSettingsMenu(true));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && els.settingsMenu.open) {
      event.preventDefault();
      closeSettingsMenu(true);
    }
  });

  document.addEventListener('pointerdown', (event) => {
    if (els.settingsMenu.open && !els.settingsMenu.contains(event.target)) closeSettingsMenu(false);
  });
  els.form.addEventListener('change', (event) => {
    if (event.target.name === 'blockMode') renderBlockModeUI();
  });

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

  fillForm(currentSettings);
  els.blockerNote.hidden = SiteBlocker.isAvailable();
  const initial = timer.getState();
  renderMode(initial);
  renderTimer(initial);
  renderStats();
  renderBlockStatus(null);
})();
