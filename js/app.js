/**
 * app.js — wires the timer page to AppStorage, Timer, Stats, Garden and SiteBlocker and renders it.
 * The only file that touches the timer page's DOM (blocked.js handles the blocked page). Exposes no globals.
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
    chartTitle: $('#chart-heading'),
    gardenPanel: $('#gardenPanel'),
    coach: $('#coach'),
    coachIcon: $('#coach .plant'),
    coachText: $('#coachText'),
    livePlant: $('#livePlant'),
    liveStage: $('#liveStage'),
    gardenToggle: $('#gardenToggle'),
    petalCount: $('#petalCount'),
    gardenRow: $('#gardenRow'),
    gardenSummaryLine: $('#gardenSummaryLine'),
    gardenSummary: $('#gardenSummary'),
    gardenEnabled: $('#gardenEnabled'),
    flowerPicker: $('#flowerPicker'),
    unlockFlower: $('#unlockFlower'),
    resetGarden: $('#resetGarden'),
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
    appearanceSummary: $('#appearanceSummary'),
    clearHistory: $('#clearHistory'),
    settingsMenu: $('.settings-menu'),
    gearBtn: $('.gear-btn'),
    closeSettings: $('#closeSettings'),
  };

  const MODE_NAMES = { focus: 'Focus', short: 'Short Break', long: 'Long Break' };
  const NUMBER_FIELDS = Object.keys(AppStorage.LIMITS);
  const SITE_FIELDS = ['blockedSites', 'allowedSites'];
  const ALL_FIELDS = [...NUMBER_FIELDS, 'blockMode', ...SITE_FIELDS, 'theme'];
  const THEME_NAMES = { system: 'Match system', light: 'Light', dark: 'Dark' };

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
  let garden = Garden.normalize(AppStorage.getGarden());
  let lastStage = null;  // growth stage the coach last announced (null = announce the next one)
  let lastEarned = 0;    // petals from the focus session that just completed
  let lastBloomSaved = false; // did the last completed focus session record a bloom?
  let lastLivePlantKey = '';  // flower|stage|growing last drawn in the live plant (redraw only on change)

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

  /** "Blocking 3 sites" / "Only 2 sites allowed" — shared by the settings summary and the timer status. */
  function blockingPhrase(mode, siteCount) {
    return mode === 'blocklist'
      ? `Blocking ${plural(siteCount, 'site')}`
      : `Only ${plural(siteCount, 'site')} allowed`;
  }

  function blockingSummaryText(settings) {
    const { blockMode, blockedSites, allowedSites } = settings;
    if (blockMode === 'off') return 'Off';
    const sites = blockMode === 'blocklist' ? blockedSites : allowedSites;
    const text = `${blockingPhrase(blockMode, sites.length)} during focus`;
    return SiteBlocker.isAvailable() ? text : `${text} · needs the extension`;
  }

  function renderSettingSummaries(sessions = AppStorage.getSessions()) {
    const s = currentSettings;
    els.durationsSummary.textContent =
      `${s.focus} / ${s.short} / ${s.long} min · long break every ${s.longEvery}`;
    els.blockingSummary.textContent = blockingSummaryText(s);
    els.dataSummary.textContent = `${plural(sessions.length, 'focus session')} saved`;
    els.appearanceSummary.textContent = THEME_NAMES[s.theme];
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
    if (chartRange === 'garden') return; // the garden view replaces the chart
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
      col.title = `${d.title}: ${plural(d.count, 'session')}, ${Stats.formatMinutes(d.minutes)}`;

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
    const showGarden = range === 'garden';
    els.gardenPanel.hidden = !showGarden;
    els.chart.hidden = showGarden;
    els.chartTitle.hidden = showGarden;
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
    els.form.elements.theme.value = settings.theme;
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
    values.theme = els.form.elements.theme.value; // already saved on change; Save must not reset it
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
    const appliedNow = applySettings(result.settings); // form shows normalized sites ("https://www.x.com/a" → "x.com")
    showFormMessage(appliedMessage(appliedNow || !durationsChanged(before, result.settings)), true);
  }

  /**
   * Theme applies and saves immediately (no Save needed). Only the theme changes: unsaved edits in
   * other rows stay in the form, because the SAVED settings + new theme are written, not the form.
   */
  function onThemeChange(theme) {
    const result = AppStorage.saveSettings({ ...currentSettings, theme });
    if (!result.ok) {
      showFormMessage(result.errors.join(' '));
      els.form.elements.theme.value = currentSettings.theme;
      return;
    }
    currentSettings = result.settings;
    Theme.apply(theme);
    renderSettingSummaries();
  }

  function onRestoreDefaults() {
    const appliedNow = applySettings(AppStorage.resetSettings());
    showFormMessage(appliedMessage(appliedNow).replace('Saved', 'Defaults restored'), true);
  }

  /**
   * Makes freshly saved settings live everywhere: form, summaries, timer and site blocking.
   * @returns {boolean} true if the new durations applied to the timer immediately
   */
  function applySettings(settings) {
    fillForm(settings);
    currentSettings = settings;
    Theme.apply(settings.theme);
    renderSettingSummaries();
    const appliedNow = timer.updateSettings(settings);
    renderMode(timer.getState());
    syncBlocking(timer.getState()); // site settings apply immediately
    if (appliedNow) {
      renderLivePlant(timer.getState());
      coachWaiting(timer.getState()); // e.g. "Plant a Sakura — 50 min to full bloom."
    }
    return appliedNow;
  }

  // ---------- garden: live plant + smart messages ----------

  /** Points a plant <svg> at a sprite stage and colors it as the given flower. */
  function setPlant(svg, flowerId, stage, extraClass = '') {
    const wilted = stage === 'wilted' ? ' is-wilted' : '';
    svg.setAttribute('class', `plant flower-${flowerId}${wilted}${extraClass}`);
    svg.querySelector('use').setAttribute('href', `#plant-${stage}`);
  }

  function elapsedMs(state) {
    return state.durationMs - state.remainingMs;
  }

  function stageOf(state) {
    return Garden.stageFor(elapsedMs(state) / state.durationMs);
  }

  /** Length of the loaded/running session in minutes (not pending settings). */
  function sessionMinutes(state) {
    return state.durationMs / 60000;
  }

  /** Does this session count for the garden? Focus of at least Garden.MIN_FOCUS_MINUTES (garden switch aside). */
  function gardenGrows(state) {
    return Garden.affectsGarden(state.mode, sessionMinutes(state));
  }

  function liveStageText(state) {
    const name = Garden.flowerName(garden.selected);
    if (state.mode !== 'focus') return `Resting · next up: ${name}`;
    if (!gardenGrows(state)) return `${name} · needs ${Garden.MIN_FOCUS_MINUTES}+ min focus to grow`;
    if (elapsedMs(state) === 0) return `${name} · ready to plant`;
    const minutesLeft = Math.ceil(state.remainingMs / 60000);
    return `${name} · ${stageOf(state)} · ${minutesLeft} min to bloom`;
  }

  function renderLivePlant(state) {
    const growing = gardenGrows(state) && state.running;
    const stage = gardenGrows(state) ? stageOf(state) : 'seed';
    const key = `${garden.selected}|${stage}|${growing}`;
    if (key !== lastLivePlantKey) {
      lastLivePlantKey = key;
      setPlant(els.livePlant, garden.selected, stage, growing ? ' is-growing' : '');
    }
    els.liveStage.textContent = liveStageText(state);
  }

  /** The numbers the smart messages are built from. */
  function messageContext(extra) {
    return {
      flower: garden.selected,
      focusMin: currentSettings.focus,
      breakMin: currentSettings.short,
      cycleLength: currentSettings.longEvery,
      bloomsToday: Garden.bloomsOn(garden, 0),
      bloomsYesterday: Garden.bloomsOn(garden, 1),
      nextUnlock: Garden.nextUnlock(garden),
      earnedText: plural(lastEarned, 'petal'),
      bloomSaved: lastBloomSaved,
      ...extra,
    };
  }

  function coach(event, extra = {}) {
    const { text, icon } = Garden.message(event, messageContext(extra));
    setPlant(els.coachIcon, garden.selected, icon);
    els.coachText.textContent = text;
  }

  /** Message for a loaded session (and a running break): uses the session's real length, not pending settings. */
  function coachWaiting(state) {
    if (state.mode === 'focus') {
      if (gardenGrows(state)) coach('idle');
      else coach('tooShort', { focusMin: Math.round(sessionMinutes(state)) });
    } else if (state.mode === 'long') coach('long', { cycleLength: state.longEvery });
    else coach('break', { breakMin: Math.round(state.durationMs / 60000) });
  }

  /** Announces each new growth stage once while focus runs (never every tick). */
  function coachGrowth(state) {
    if (!gardenGrows(state) || !state.running) return;
    const stage = stageOf(state);
    if (stage === lastStage) return;
    lastStage = stage;
    coach('stage', { stage });
  }

  /** Re-reads the saved garden: another timer tab may have changed it since this tab last looked. */
  function reloadGarden() {
    garden = Garden.normalize(AppStorage.getGarden());
  }

  function storeGarden(next) {
    const result = AppStorage.saveGarden(next);
    if (!result.ok) console.warn('[app] garden could not be saved');
    garden = Garden.normalize(result.garden);
    renderGarden();
  }

  /**
   * The ONLY way to change the garden: re-read the latest saved garden, apply `change` to it, save.
   * Saving this tab's in-memory copy instead would erase blooms/petals another timer tab saved meanwhile.
   * @param {(latest: object) => object} change  e.g. (g) => Garden.recordBloom(g, 25)
   */
  function updateGarden(change) {
    reloadGarden();
    storeGarden(change(garden));
  }

  /** Before a reset: a garden-sized focus session reset after the first minute wilts its plant. */
  function wiltIfNeeded(state) {
    reloadGarden(); // the switch may have been changed in another tab
    if (!garden.enabled || !gardenGrows(state) || !Garden.shouldWilt(state.mode, elapsedMs(state))) return false;
    const minutes = elapsedMs(state) / 60000;
    updateGarden((latest) => Garden.recordWilt(latest, minutes));
    return true;
  }

  // ---------- garden: view, settings row, on/off ----------

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const fmtPlantDay = new Intl.DateTimeFormat(undefined, { weekday: 'short' });

  /** A new plant <svg> that reuses a sprite stage. */
  function createPlant(flowerId, stage) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 40 48');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.appendChild(document.createElementNS(SVG_NS, 'use'));
    setPlant(svg, flowerId, stage);
    return svg;
  }

  /** "Today" / "Yesterday" / "Mon" for a plant's date key. */
  function plantDayLabel(dateKey) {
    const today = new Date();
    if (dateKey === AppStorage.toDateKey(today)) return 'Today';
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (dateKey === AppStorage.toDateKey(yesterday)) return 'Yesterday';
    const [year, month, day] = dateKey.split('-').map(Number);
    return fmtPlantDay.format(new Date(year, month - 1, day));
  }

  function plantTitle(plant) {
    const what = plant.state === 'bloom' ? `bloom · ${plant.minutes} min` : `wilted after ${plant.minutes} min`;
    return `${plantDayLabel(plant.date)} · ${Garden.flowerName(plant.type)} · ${what}`;
  }

  function createPlantItem(plant) {
    const item = document.createElement('li');
    item.title = plantTitle(plant);
    item.appendChild(createPlant(Garden.displayType(plant.type), plant.state === 'bloom' ? 'bloom' : 'wilted'));
    return item;
  }

  /** The soil strip: plants from the last 7 days, newest first (CSS shows newest on the right). */
  function renderGardenRow(recent) {
    els.gardenRow.replaceChildren();
    if (recent.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'garden-empty';
      empty.textContent = 'Finish a focus session to grow your first bloom.';
      els.gardenRow.appendChild(empty);
      return;
    }
    recent.forEach((plant) => els.gardenRow.appendChild(createPlantItem(plant)));
  }

  function weekSummaryText(recent) {
    const { blooms, wilted } = Garden.countStates(recent);
    return wilted === 0 ? `${plural(blooms, 'bloom')} this week` : `${plural(blooms, 'bloom')} · ${wilted} wilted this week`;
  }

  function renderGardenView() {
    const recent = Garden.recentPlants(garden, 7);
    els.petalCount.textContent = String(garden.petals);
    renderGardenRow(recent);
    els.gardenSummaryLine.textContent = weekSummaryText(recent);
  }

  function flowerCostText(flower) {
    if (flower.cost === 0) return 'Free';
    return garden.unlocked.includes(flower.id) ? 'Unlocked' : `${flower.cost} petals`;
  }

  /** One picker option, built once at init; updateFlowerOption() refreshes it (rebuilding would drop keyboard focus). */
  function createFlowerOption(flower) {
    const label = document.createElement('label');
    label.dataset.flower = flower.id;
    const radio = document.createElement('input');
    Object.assign(radio, { type: 'radio', name: 'gardenFlower', value: flower.id });
    const card = document.createElement('span');
    card.className = 'flower-card';
    const name = document.createElement('span');
    name.className = 'flower-name';
    name.textContent = flower.name;
    const cost = document.createElement('span');
    cost.className = 'flower-cost';
    card.append(createPlant(flower.id, 'bloom'), name, cost);
    label.append(radio, card);
    return label;
  }

  function updateFlowerOption(label) {
    const flower = Garden.flowerById(label.dataset.flower);
    const locked = !garden.unlocked.includes(flower.id);
    const radio = label.querySelector('input');
    label.className = `flower-option${locked ? ' is-locked' : ''}`;
    radio.disabled = locked;
    radio.checked = garden.selected === flower.id;
    label.querySelector('.flower-cost').textContent = flowerCostText(flower);
  }

  function buildFlowerPicker() {
    els.flowerPicker.append(...Garden.CATALOG.map(createFlowerOption));
  }

  function renderUnlockButton() {
    const next = Garden.nextUnlock(garden);
    els.unlockFlower.hidden = next === null;
    if (!next) return;
    els.unlockFlower.disabled = next.needed > 0;
    els.unlockFlower.textContent = next.needed > 0
      ? `${next.flower.name}: ${plural(next.needed, 'more petal')} to unlock`
      : `Unlock ${next.flower.name} · ${next.flower.cost} petals`;
  }

  function renderGardenSettings() {
    els.gardenEnabled.checked = garden.enabled;
    els.flowerPicker.querySelectorAll('label[data-flower]').forEach(updateFlowerOption);
    renderUnlockButton();
    els.gardenSummary.textContent = garden.enabled
      ? `On · ${plural(garden.petals, 'petal')} · growing ${Garden.flowerName(garden.selected)}`
      : 'Off';
  }

  /** "Show garden and messages" off = the timer and stats look exactly as they did before the garden. */
  function renderGardenVisibility() {
    els.coach.hidden = !garden.enabled;
    els.gardenToggle.hidden = !garden.enabled;
    if (!garden.enabled && chartRange === 'garden') setChartRange('daily');
  }

  function renderGarden() {
    renderGardenView();
    renderGardenSettings();
    renderGardenVisibility();
  }

  /** After the flower or the on/off switch changes, refresh the plant and message if nothing is running. */
  function refreshIdleGarden() {
    const state = timer.getState();
    renderLivePlant(state);
    if (!state.running) coachWaiting(state);
  }

  function onGardenEnabledChange() {
    const enabled = els.gardenEnabled.checked;
    updateGarden((latest) => ({ ...latest, enabled }));
    refreshIdleGarden();
  }

  function onFlowerSelect(flowerId) {
    updateGarden((latest) => Garden.select(latest, flowerId));
    refreshIdleGarden();
  }

  function onUnlockFlower() {
    reloadGarden(); // another tab may have spent or earned petals since this button was drawn
    const next = Garden.nextUnlock(garden);
    if (!next || !Garden.canUnlock(garden, next.flower.id)) {
      renderGarden(); // redraw the button from the latest petals instead of acting on a stale one
      return;
    }
    updateGarden((latest) => Garden.unlock(latest, next.flower.id));
    refreshIdleGarden();
    showFormMessage(`${next.flower.name} unlocked — it grows next.`, true);
  }

  function onResetGarden() {
    reloadGarden(); // count and confirm what is really saved, incl. other tabs' plants
    if (garden.petals === 0 && garden.plants.length === 0) {
      showFormMessage('Your garden is already empty.', true);
      return;
    }
    const question = `Reset your garden? ${plural(garden.plants.length, 'plant')} and ${plural(garden.petals, 'petal')} will be removed. Focus history is kept.`;
    if (!window.confirm(question)) return;
    const wasEnabled = garden.enabled;
    storeGarden({ ...AppStorage.resetGarden(), enabled: wasEnabled });
    refreshIdleGarden();
    showFormMessage('Garden reset.', true);
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

  function renderBlockStatus(block) {
    const show = block !== null && SiteBlocker.isAvailable();
    els.blockStatus.hidden = !show;
    els.blockStatus.textContent = show ? blockingPhrase(block.mode, block.sites.length) : '';
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
      renderLivePlant(state);
      coachGrowth(state);
    },

    onModeChange(state) {
      renderMode(state);
      renderStats(); // also keeps "today" correct after midnight
      beep();
      announce(state.mode === 'focus'
        ? 'Break over. Focus is ready — press Start when you are.'
        : `Focus complete. ${MODE_NAMES[state.mode]} is ready — press Start when you are.`);
      lastStage = null;
      if (state.mode === 'focus') coach('ready');
      else if (lastBloomSaved) coach('complete'); // onFocusComplete already saved the bloom
      else coachWaiting(state); // garden off: no bloom and no petals to announce
    },

    onFocusComplete(durationMin) {
      if (!AppStorage.addSession(durationMin)) {
        console.warn('[app] focus session could not be saved');
      }
      // Garden switched off, or a session shorter than Garden.MIN_FOCUS_MINUTES: the garden is untouched
      reloadGarden(); // the switch may have been changed in another tab
      const grows = garden.enabled && Garden.affectsGarden('focus', durationMin);
      lastBloomSaved = grows;
      lastEarned = grows ? Garden.petalsFor(durationMin) : 0;
      if (!grows) return;
      updateGarden((latest) => Garden.recordBloom(latest, durationMin));
    },
  });

  // ---------- events ----------

  els.startPause.addEventListener('click', () => {
    unlockAudio();
    lastStage = null; // starting/resuming focus re-announces the current stage
    timer.toggle();
    const state = timer.getState();
    announce(state.running ? 'Timer started.' : 'Timer paused.');
    if (state.mode !== 'focus' || !gardenGrows(state)) coachWaiting(state); // breaks / short focus: no growth messages
    else if (!state.running) coach('paused', { stage: stageOf(state) });
  });

  els.reset.addEventListener('click', () => {
    const wilted = wiltIfNeeded(timer.getState()); // read BEFORE reset clears the elapsed time
    timer.reset();
    lastStage = null;
    announce(wilted ? 'Timer reset. That plant wilted.' : 'Timer reset.');
    if (wilted) coach('wilt');
    else coachWaiting(timer.getState());
  });

  els.toggleBtns.forEach((btn) => {
    btn.addEventListener('click', () => setChartRange(btn.dataset.range));
  });

  els.form.addEventListener('submit', onSettingsSubmit);
  els.restoreDefaults.addEventListener('click', onRestoreDefaults);
  els.clearHistory.addEventListener('click', onClearHistory);
  els.gardenEnabled.addEventListener('change', onGardenEnabledChange);
  els.unlockFlower.addEventListener('click', onUnlockFlower);
  els.resetGarden.addEventListener('click', onResetGarden);

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
    if (event.target.name === 'theme') onThemeChange(event.target.value);
    if (event.target.name === 'gardenFlower') onFlowerSelect(event.target.value);
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
    if (!document.hidden) {
      renderStats();
      reloadGarden(); // another timer tab may have grown, wilted or unlocked something meanwhile
      renderGarden();
      renderLivePlant(timer.getState());
    }
  });

  // ---------- init ----------

  fillForm(currentSettings);
  els.blockerNote.hidden = SiteBlocker.isAvailable();
  const initial = timer.getState();
  renderMode(initial);
  renderTimer(initial);
  renderStats();
  renderBlockStatus(null);
  buildFlowerPicker();
  renderGarden();
  renderLivePlant(initial);
  coachWaiting(initial);
})();
