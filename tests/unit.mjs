// Unit tests for the pure-logic files (storage.js, stats.js, timer.js) in plain Node — no browser.
// Each file is run in its own VM context, exactly as the browser would run the classic script.
// Run: node tests/unit.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { PROJECT_DIR } from './helpers.mjs';

let passed = 0;
let failed = 0;
function check(cond, label, extra = '') {
  if (cond) passed++;
  else failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && extra !== '' ? '  → ' + extra : ''}`);
}

/** Runs js/<file> in a fresh context and returns the named global it declares. */
function load(file, globalName, extras = {}) {
  const src = readFileSync(path.join(PROJECT_DIR, 'js', file), 'utf8');
  const ctx = vm.createContext({ console: { warn() {}, log: console.log }, ...extras });
  return vm.runInContext(`${src}\n;${globalName}`, ctx, { filename: file });
}

function fakeLocalStorage() {
  const store = {};
  return {
    store,
    api: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
  };
}

// ---------------------------------------------------------------- storage.js
{
  console.log('\n# storage.js');
  const ls = fakeLocalStorage();
  const S = load('storage.js', 'AppStorage', { localStorage: ls.api });
  const KEY = 'pomodoro.v1.settings';

  const d = S.getSettings();
  check(d.focus === 25 && d.short === 5 && d.long === 15 && d.longEvery === 4, 'defaults 25/5/15/4');
  check(d.blockMode === 'off' && d.blockedSites.length === 0 && d.allowedSites.length === 0, 'blocking defaults: off, empty lists');

  const norm = {
    'https://www.YouTube.com/watch?v=1': 'youtube.com', '*.reddit.com': 'reddit.com', 'news.ycombinator.com/': 'news.ycombinator.com',
    'http://user:pw@example.org:8080/x': 'example.org', '  Twitter.COM  ': 'twitter.com', 'localhost:3000': 'localhost', 'example.com.': 'example.com',
  };
  for (const [input, out] of Object.entries(norm)) check(S.normalizeSite(input) === out, `normalizeSite(${JSON.stringify(input)}) → ${out}`, S.normalizeSite(input));

  let r = S.saveSettings({ ...S.getSettings(), focus: 50, short: 10, long: 20, longEvery: 3 });
  check(r.ok && S.getSettings().focus === 50, 'valid durations saved and read back');
  r = S.saveSettings({ ...S.getSettings(), focus: 0, short: 'x' });
  check(!r.ok && r.invalidFields.join() === 'focus,short' && S.getSettings().focus === 50, 'invalid durations rejected, nothing written', JSON.stringify(r.invalidFields));

  r = S.saveSettings({ ...S.getSettings(), blockMode: 'blocklist', blockedSites: 'youtube.com\nhttps://www.reddit.com/r/x\nYOUTUBE.com, x.com' });
  check(r.ok && r.settings.blockedSites.join() === 'youtube.com,reddit.com,x.com', 'site list text parsed, normalized, de-duplicated', r.settings.blockedSites.join());
  r = S.saveSettings({ ...S.getSettings(), blockedSites: ['good.com', 'not a site', 'foo'] });
  check(!r.ok && r.invalidFields.includes('blockedSites') && r.errors[0].includes('not a site, foo'), 'invalid sites rejected and listed');
  r = S.saveSettings({ ...S.getSettings(), blockMode: 'allowlist', allowedSites: [] });
  check(!r.ok && r.invalidFields.includes('allowedSites') && r.settings.blockMode === 'off', 'empty allowlist rejected (falls back to off)');
  r = S.saveSettings({ ...S.getSettings(), blockMode: 'bogus' });
  check(!r.ok && r.invalidFields.includes('blockMode'), 'unknown blocking mode rejected');
  r = S.saveSettings({ ...S.getSettings(), blockedSites: Array.from({ length: 101 }, (_, i) => `s${i}.com`) });
  check(!r.ok, 'more than 100 sites rejected');

  ls.store[KEY] = JSON.stringify({ focus: 30, short: 5, long: 15, longEvery: 4 });
  check(S.getSettings().focus === 30 && S.getSettings().blockMode === 'off', 'old saved settings (no blocking fields) still load');
  ls.store[KEY] = JSON.stringify({ blockMode: 'allowlist', allowedSites: [] });
  check(S.getSettings().blockMode === 'off', 'tampered empty allowlist loads as off (safety)');
  ls.store[KEY] = '{not json';
  check(S.getSettings().focus === 25, 'corrupt settings JSON → defaults');
  const fresh = S.resetSettings();
  fresh.blockedSites.push('x.com');
  check(S.DEFAULTS.blockedSites.length === 0, 'resetSettings returns fresh arrays');

  const rec = S.addSession(25, new Date(2026, 10, 3, 9, 0));
  check(rec && rec.date === '2026-11-03' && rec.durationMin === 25, 'addSession stores local date + duration');
  check(S.addSession(-1) === null, 'invalid duration not saved');
  ls.store['pomodoro.v1.sessions'] = JSON.stringify([{ date: '2026-11-02', completedAt: 'x', durationMin: 25 }, { junk: 1 }, null]);
  check(S.getSessions().length === 1, 'corrupt session entries skipped');
  ls.store['pomodoro.v1.sessions'] = '{broken';
  check(S.getSessions().length === 0, 'corrupt sessions JSON → []');
  S.addSession(25);
  S.clearSessions();
  check(S.getSessions().length === 0, 'clearSessions empties history');
}

// ---------------------------------------------------------------- stats.js
{
  console.log('\n# stats.js');
  // stats.js uses AppStorage.toDateKey, so load storage.js first — same order as index.html
  const storageForStats = load('storage.js', 'AppStorage', { localStorage: fakeLocalStorage().api });
  const St = load('stats.js', 'Stats', { AppStorage: storageForStats });
  const now = new Date(2026, 10, 3, 14, 0); // Tue 3 Nov 2026
  const s = (date, min = 25) => ({ date, completedAt: 'x', durationMin: min });
  const data = [s('2026-11-03'), s('2026-11-03'), s('2026-11-02', 50), s('2026-11-01'), s('2026-10-26'), s('2026-10-20', 30), s('2026-08-01')];

  check(St.sessionsToday(data, now) === 2, 'sessionsToday');
  check(St.totalFocusMinutes(data) === 205, 'totalFocusMinutes');
  check([0, 45, 60, 755].map(St.formatMinutes).join() === '0m,45m,1h,12h 35m', 'formatMinutes');
  const daily = St.dailyHistory(data, 7, now);
  check(daily.length === 7 && daily[0].key === '2026-10-28' && daily[6].key === '2026-11-03' && daily[6].isCurrent, 'daily: 7 days, today last');
  check(daily.map((x) => x.minutes).join() === '0,0,0,0,25,50,50', 'daily: minutes zero-filled', daily.map((x) => x.minutes).join());
  const weekly = St.weeklyHistory(data, 8, now);
  check(weekly.length === 8 && weekly[7].key === '2026-11-02' && weekly[7].isCurrent, 'weekly: 8 weeks, starts Monday');
  check(weekly.map((x) => x.minutes).join() === '0,0,0,0,0,30,50,100', 'weekly: Sunday counts toward previous Monday', weekly.map((x) => x.minutes).join());
  check(St.weeklyHistory([], 1, new Date(2026, 10, 8, 23))[0].key === '2026-11-02', 'Sunday belongs to the week starting Monday before');
  check(St.dailyHistory([], 7, new Date(2026, 2, 9))[0].key === '2026-03-03', 'day ranges are correct across DST');
}

// ---------------------------------------------------------------- timer.js
{
  console.log('\n# timer.js');
  const T = load('timer.js', 'Timer');
  let now = 0;
  let fns = {};
  let id = 0;
  const clock = { now: () => now, setInterval: (f) => { fns[++id] = f; return id; }, clearInterval: (i) => { delete fns[i]; } };
  const advance = (ms) => { const end = now + ms; while (now < end) { now = Math.min(end, now + 250); Object.values(fns).forEach((f) => f()); } };

  const saved = [];
  const modes = [];
  const t = T.create({ focus: 1, short: 1, long: 2, longEvery: 2 },
    { onFocusComplete: (m) => saved.push(m), onModeChange: (st) => modes.push(st.mode) }, clock);

  check(t.getState().remainingMs === 60000 && !t.getState().running, 'starts idle at full length');
  t.start(); advance(30000);
  check(t.getState().remainingMs === 30000, 'counts down');
  t.pause(); advance(10000);
  check(t.getState().remainingMs === 30000 && !t.getState().running, 'pause holds the remaining time');
  t.start(); advance(30000);
  let st = t.getState();
  check(st.mode === 'short' && !st.running && st.remainingMs === 60000 && saved.join() === '1', 'focus ends → session saved, short break loaded but NOT started');
  advance(300000);
  check(t.getState().remainingMs === 60000, 'break does not count down without Start');
  t.start(); advance(60000);
  st = t.getState();
  check(st.mode === 'focus' && !st.running && st.cyclePosition === 2, 'break ends → focus 2 loaded but NOT started');
  t.start(); advance(60000);
  st = t.getState();
  check(st.mode === 'long' && !st.running && st.remainingMs === 120000, 'after longEvery focus sessions → long break (waiting)');
  t.start(); advance(120000);
  st = t.getState();
  check(st.mode === 'focus' && st.cyclePosition === 1 && modes.join() === 'short,focus,long,focus', 'long break ends → cycle restarts at 1', modes.join());

  t.start(); advance(20000); t.reset();
  check(t.getState().remainingMs === 60000 && !t.getState().running && saved.length === 2, 'reset mid-focus: full length, stopped, nothing saved');
  check(t.updateSettings({ focus: 3, short: 1, long: 2, longEvery: 2 }) === true && t.getState().remainingMs === 180000, 'settings apply immediately when idle');
  t.start(); advance(1000);
  check(t.updateSettings({ focus: 5, short: 1, long: 2, longEvery: 2 }) === false && t.getState().remainingMs === 179000, 'settings deferred while running');
  advance(179000);
  check(saved.at(-1) === 3, 'session saved with the length it actually ran (3), not the pending one (5)');

  // background-tab throttling: no ticks for 40 s, then one tick → still exact
  t.start();
  const paused = fns; fns = {}; now += 40000; fns = paused; Object.values(fns).forEach((f) => f());
  check(t.getState().remainingMs === 60000 - 40000, 'timestamp-based: no drift after throttled ticks', t.getState().remainingMs);
}

// ---------------------------------------------------------------- storage.js: garden
{
  console.log('\n# storage.js — garden');
  const ls = fakeLocalStorage();
  const S = load('storage.js', 'AppStorage', { localStorage: ls.api });
  const KEY = 'pomodoro.v1.garden';

  const g = S.getGarden();
  check(g.enabled === true && g.petals === 0 && g.unlocked.join() === 'sakura' && g.selected === 'sakura' && g.plants.length === 0,
    'garden defaults: on, 0 petals, sakura unlocked + selected, no plants');
  const plant = { date: '2026-11-03', type: 'tulip', state: 'bloom', minutes: 25 };
  let r = S.saveGarden({ ...g, petals: 40, unlocked: ['tulip'], selected: 'tulip', plants: [plant] });
  const back = S.getGarden();
  check(r.ok && back.petals === 40 && back.unlocked.join() === 'sakura,tulip' && back.selected === 'tulip' && back.plants.length === 1,
    'garden saved and read back (sakura always unlocked)', JSON.stringify(back));
  r = S.saveGarden({ ...back, selected: 'lotus' });
  check(r.garden.selected === 'sakura', 'selecting a locked flower falls back to sakura');

  ls.store[KEY] = JSON.stringify({ enabled: 'yes', petals: -5, unlocked: 'x', plants: [plant, { junk: 1 }, null, { ...plant, state: 'eaten' }, { ...plant, minutes: -1 }] });
  const messy = S.getGarden();
  check(messy.enabled === true && messy.petals === 0 && messy.unlocked.join() === 'sakura' && messy.plants.length === 1,
    'bad garden fields fall back, corrupt plants skipped', JSON.stringify(messy));
  ls.store[KEY] = '{not json';
  check(S.getGarden().petals === 0, 'corrupt garden JSON → defaults');

  const many = Array.from({ length: S.MAX_PLANTS + 20 }, (_, i) => ({ ...plant, minutes: i }));
  r = S.saveGarden({ ...S.getGarden(), petals: 9999, plants: many });
  check(r.garden.plants.length === S.MAX_PLANTS && r.garden.plants[0].minutes === 20 && S.getGarden().petals === 9999,
    `plants capped at ${S.MAX_PLANTS} (oldest dropped), petals kept`);

  S.addSession(25);
  S.resetGarden();
  check(S.getGarden().plants.length === 0 && S.getSessions().length === 1, 'resetGarden keeps focus history');
  S.saveGarden({ ...S.getGarden(), petals: 7 });
  S.clearSessions();
  check(S.getGarden().petals === 7, 'clearSessions keeps the garden');
  check(ls.store['pomodoro.v1.settings'] === undefined, 'garden never writes the settings key');
}

// ---------------------------------------------------------------- garden.js
{
  console.log('\n# garden.js');
  const S = load('storage.js', 'AppStorage', { localStorage: fakeLocalStorage().api });
  const G = load('garden.js', 'Garden', { AppStorage: S });
  const now = new Date(2026, 10, 3, 14, 0); // Tue 3 Nov 2026
  const fresh = S.getGarden();

  check(G.CATALOG.map((f) => f.cost).join() === '0,100,250,500,1000', 'catalog costs 0/100/250/500/1000');
  const stages = [0, 0.19, 0.2, 0.44, 0.45, 0.69, 0.7, 0.99, 1].map(G.stageFor).join();
  check(stages === 'seed,seed,sprout,sprout,leaves,leaves,bud,bud,bloom', 'stage thresholds 20/45/70/100 %', stages);
  check([25, 1, 0.9, 0, -3].map(G.petalsFor).join() === '25,1,0,0,0', '1 petal per whole focus minute');
  check(!G.shouldWilt('focus', 59999) && G.shouldWilt('focus', 60000) && !G.shouldWilt('short', 600000),
    'wilt only after 1 min of focus, never on breaks');

  let g = G.recordBloom(fresh, 25, now);
  check(g.petals === 25 && g.plants.length === 1 && g.plants[0].state === 'bloom' && g.plants[0].date === '2026-11-03' && g.plants[0].type === 'sakura',
    'recordBloom adds a dated bloom of the selected flower + petals');
  check(fresh.petals === 0 && fresh.plants.length === 0, 'changes return a new garden (input not mutated)');
  g = G.recordWilt(g, 12.7, now);
  check(g.petals === 25 && g.plants[1].state === 'wilted' && g.plants[1].minutes === 12, 'recordWilt adds a wilted plant, no petals');

  check(!G.canUnlock(g, 'tulip'), 'cannot unlock with too few petals');
  check(G.unlock(g, 'tulip') === g, 'unlock without enough petals changes nothing');
  g = { ...g, petals: 130 };
  check(!G.canUnlock(g, 'sakura') && !G.canUnlock(g, 'rose'), 'cannot unlock an owned or unknown flower');
  const u = G.unlock(g, 'tulip');
  check(u.petals === 30 && u.unlocked.join() === 'sakura,tulip' && u.selected === 'tulip', 'unlock spends petals and selects the flower');
  check(G.select(u, 'sakura').selected === 'sakura' && G.select(u, 'lotus').selected === 'tulip', 'select only unlocked flowers');
  check(JSON.stringify(G.nextUnlock(u)) === JSON.stringify({ flower: G.CATALOG[2], needed: 220 }), 'nextUnlock: cheapest locked flower + petals needed');
  check(G.nextUnlock({ ...u, unlocked: G.CATALOG.map((f) => f.id) }) === null, 'nextUnlock: null when everything is unlocked');

  const n = G.normalize({ ...fresh, unlocked: ['sakura', 'rose'], selected: 'rose', plants: [{ date: '2026-11-03', type: 'rose', state: 'bloom', minutes: 25 }] });
  check(n.unlocked.join() === 'sakura,rose' && n.selected === 'sakura' && n.plants[0].type === 'rose', 'normalize keeps unknown flowers (newer data) but grows a known one', JSON.stringify(n));
  check(G.normalize(fresh) === fresh && G.displayType('rose') === 'sakura' && G.displayType('tulip') === 'tulip', 'normalize leaves valid gardens alone; displayType falls back to sakura');

  const p = (date, state = 'bloom') => ({ date, type: 'sakura', state, minutes: 25 });
  const week = { ...fresh, plants: [p('2026-10-27'), p('2026-10-28'), p('2026-11-02'), p('2026-11-02', 'wilted'), p('2026-11-03'), p('2026-11-03'), p('2026-11-03')] };
  const recent = G.recentPlants(week, 7, now);
  check(recent.length === 6 && recent[0].date === '2026-11-03' && recent.at(-1).date === '2026-10-28', 'recentPlants: last 7 days, newest first');
  check(JSON.stringify(G.countStates(recent)) === '{"blooms":5,"wilted":1}', 'countStates: blooms vs wilted');
  check(G.bloomsOn(week, 0, now) === 3 && G.bloomsOn(week, 1, now) === 1, 'bloomsOn: today 3, yesterday 1 (wilted not counted)');

  const msg = (e, ctx) => G.message(e, ctx).text;
  check(msg('idle', { flower: 'tulip', focusMin: 25, bloomsToday: 2 }) === 'Plant a Tulip — 25 min to full bloom.', 'message idle');
  check(msg('idle', { flower: 'sakura', focusMin: 25, bloomsToday: 0 }).startsWith('First bloom of the day'), 'message first of the day');
  check(msg('stage', { stage: 'leaves' }) === 'Halfway — your leaves are out.' && G.message('stage', { stage: 'leaves' }).icon === 'leaves', 'message + icon per stage');
  const done = { earnedText: '25 petals', bloomsToday: 3, bloomsYesterday: 2, nextUnlock: { flower: G.CATALOG[1], needed: 80 } };
  check(msg('complete', done) === 'Bloom #3 today — 1 more than yesterday · +25 petals', 'message complete compares with yesterday', msg('complete', done));
  check(msg('complete', { ...done, bloomsYesterday: 5 }) === 'Bloom #3 today · +25 petals', 'message complete: no comparison when not ahead');
  check(msg('complete', { ...done, nextUnlock: { flower: G.CATALOG[1], needed: 38 } }) === '+25 petals — 38 more to unlock Tulip.', 'message complete: close to an unlock');
  check(msg('complete', { ...done, nextUnlock: { flower: G.CATALOG[1], needed: 0 } }) === '+25 petals — you can unlock Tulip now!', 'message complete: unlock available');
  check(G.message('wilt').icon === 'wilted' && msg('break', { breakMin: 5, bloomSaved: true }) === 'Bloom saved. Rest your eyes for 5 min.', 'message wilt + break');
  check(msg('break', { breakMin: 5, bloomSaved: false }) === 'Rest your eyes for 5 min.', 'message break without a saved bloom does not claim one');
  check(msg('complete', { ...done, earnedText: '1 petal', bloomsYesterday: 5 }) === 'Bloom #3 today · +1 petal', 'message complete: singular petal');
  check(msg('long', { cycleLength: 4 }) === 'Cycle of 4 complete — enjoy a long rest.' && msg('ready', { flower: 'lotus' }).includes('Lotus'), 'message long break + ready');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
