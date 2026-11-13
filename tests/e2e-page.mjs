// Page e2e suite: drives index.html (file://) in headless Chrome via the DevTools protocol
// (Node 22+ built-in WebSocket). Date.now is skewed from the test so minutes pass instantly.
// Run: node tests/e2e-page.mjs
import { pathToFileURL } from 'node:url';
import path from 'node:path';

import { findBrowser, launchBrowser, PROJECT_DIR, tempProfile } from './helpers.mjs';

const browser = findBrowser('chrome');
const projectDir = PROJECT_DIR;
const profileDir = tempProfile('page');
const pageUrl = pathToFileURL(path.join(projectDir, 'index.html')).href;
const { port: PORT, close: closeBrowser } = await launchBrowser(browser, profileDir, ['--allow-file-access-from-files']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page'); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));

let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value).join(' '));
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
  return r.result.result.value;
};

await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__skew = 0; const __n = Date.now.bind(Date); Date.now = () => __n() + window.__skew;` });

const load = async () => { await send('Page.navigate', { url: pageUrl }); await sleep(800); };
const skip = async (sec) => { await ev(`window.__skew += ${sec * 1000}`); await sleep(400); };
const q = (sel, prop = 'textContent') => ev(`document.querySelector(${JSON.stringify(sel)})?.${prop}`);
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
const setSettings = (o) => ev(`(() => { const f = document.getElementById('settingsForm');
  ${Object.entries(o).map(([k, v]) => `f.elements.${k}.value = ${JSON.stringify(String(v))};`).join('')}
  f.requestSubmit(); })()`);
const state = async () => ({
  time: await q('#time'), mode: await ev(`document.querySelector('.app').dataset.mode`),
  btn: await q('#startPause'), cycle: await q('#cycle'), today: await q('#todayCount'),
  total: await q('#totalFocus'), bars: await ev(`document.querySelectorAll('.bar-col').length`),
});

let failed = 0;
const check = (cond, label, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  → ' + extra : ''}`); if (!cond) failed++; };

// 1. First load
await load();
let s = await state();
check(s.time === '25:00' && s.mode === 'focus' && s.btn === 'Start', 'first load: 25:00, focus, Start', JSON.stringify(s));
check(s.cycle === 'Session 1 of 4' && s.today === '0' && s.total === '0m', 'first load: cycle + empty stats');
check((await q('.chart-empty')) !== undefined, 'empty chart message shown');
check((await ev('document.title')) === '25:00 – Focus', 'tab title shows time + mode');

// 2. Settings: valid
await setSettings({ focus: 1, short: 1, long: 2, longEvery: 2 });
check((await q('#time')) === '01:00' && (await q('#settingsError')) === 'Saved.', 'settings saved and applied immediately when idle');
check((await q('#cycle')) === 'Session 1 of 2', 'cycle label uses new longEvery');

// 3. Settings: invalid
await setSettings({ focus: 0, short: '', long: 2, longEvery: 2 });
const err = await q('#settingsError');
check(err.includes('Focus') && err.includes('Short break') && (await ev(`document.querySelector('[name=focus]').getAttribute('aria-invalid')`)) === 'true',
  'invalid settings rejected with field errors', err);
check(JSON.parse(await ev(`localStorage.getItem('pomodoro.v1.settings')`)).focus === 1, 'invalid settings not written');
await setSettings({ focus: 1, short: 1, long: 2, longEvery: 2 });

// 4. Start / pause
await click('#startPause'); await skip(30);
s = await state();
check(s.time === '00:30' && s.btn === 'Pause', 'start counts down', s.time);
await click('#startPause'); await skip(60);
s = await state();
check(s.time === '00:30' && s.btn === 'Start', 'pause holds time', s.time);

// 5. Complete focus → short break, saved
await click('#startPause'); await skip(31);
s = await state();
check(s.mode === 'short' && s.btn === 'Start' && s.time === '01:00' && s.today === '1' && s.total === '1m', 'focus completes → short break ready but NOT started, session saved', JSON.stringify(s));
await skip(30); s = await state();
check(s.mode === 'short' && s.time === '01:00' && s.btn === 'Start', 'break waits: no countdown without Start', JSON.stringify(s));
check(s.bars === 7, 'daily chart shows 7 bars');
const saved = JSON.parse(await ev(`localStorage.getItem('pomodoro.v1.sessions')`));
check(saved.length === 1 && saved[0].durationMin === 1 && /^\d{4}-\d{2}-\d{2}$/.test(saved[0].date), 'stored record shape', JSON.stringify(saved[0]));

// 6. Cycle: every switch waits for Start
await click('#startPause'); await skip(61); s = await state();
check(s.mode === 'focus' && s.cycle === 'Session 2 of 2' && s.btn === 'Start' && s.time === '01:00', 'break ends → focus 2 loaded but NOT started', JSON.stringify(s));
await skip(30); s = await state();
check(s.time === '01:00' && s.btn === 'Start', 'focus waits: no countdown without Start', JSON.stringify(s));
await click('#startPause'); await skip(61); s = await state();
check(s.mode === 'long' && s.today === '2' && s.time === '02:00' && s.btn === 'Start', 'after longEvery sessions → long break, waiting', JSON.stringify(s));
await click('#startPause'); await skip(121); s = await state();
check(s.mode === 'focus' && s.cycle === 'Session 1 of 2' && s.btn === 'Start', 'long break ends → focus loaded, waiting, cycle restarts', JSON.stringify(s));

// 7. Reset mid-session saves nothing
await click('#startPause'); await skip(20); await click('#reset'); s = await state();
check(s.time === '01:00' && s.btn === 'Start' && s.today === '2', 'reset mid-focus: full time, stopped, nothing saved', JSON.stringify(s));

// 8. Settings while running are deferred
await click('#startPause'); await skip(5);
await setSettings({ focus: 3, short: 1, long: 2, longEvery: 2 });
check((await q('#settingsError')).includes('next session') && (await q('#time')) === '00:55', 'settings while running deferred', await q('#time'));
await click('#reset');
check((await q('#time')) === '03:00', 'deferred settings applied on reset');

// 9. Weekly toggle
await click('[data-range=weekly]');
check((await ev(`document.querySelectorAll('.bar-col').length`)) === 8 &&
  (await ev(`document.querySelector('[data-range=weekly]').getAttribute('aria-pressed')`)) === 'true', 'weekly view: 8 bars, toggle pressed');
const bar = await ev(`[...document.querySelectorAll('.bar-col')].at(-1).title`);
check(bar.includes('2 sessions') && bar.includes('2m'), 'current week bar tooltip', bar);

// 10. Keyboard
await ev(`document.activeElement.blur(); document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }))`);
check((await q('#startPause')) === 'Pause', 'Space starts timer');
await ev(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }))`);
check((await q('#startPause')) === 'Start' && (await q('#time')) === '03:00', 'R resets timer');

// 11. Persistence after reload
await load(); s = await state();
check(s.today === '2' && s.time === '03:00' && (await ev(`document.forms[0].elements.focus.value`)) === '3', 'reload: stats + settings persist', JSON.stringify(s));

// 12. Restore defaults
await click('#restoreDefaults');
check((await q('#time')) === '25:00' && (await q('#cycle')) === 'Session 1 of 4', 'restore defaults');

// 13. Corrupt storage
await ev(`localStorage.setItem('pomodoro.v1.sessions', '{broken'); localStorage.setItem('pomodoro.v1.settings', 'nope')`);
const before = errors.length;
await load(); s = await state();
check(s.time === '25:00' && s.today === '0' && errors.length === before, 'corrupt storage → defaults, no crash', JSON.stringify(s));

// 14. Site-blocking settings UI
const visible = (name) => ev(`!document.querySelector('[name=${name}]').closest('.site-list').hidden`);
const pick = (mode) => ev(`(() => { const r = document.querySelector('input[name=blockMode][value=${mode}]'); r.click(); })()`);
check(!(await visible('blockedSites')) && !(await visible('allowedSites')), 'mode off: no site lists shown');
await pick('blocklist');
check((await visible('blockedSites')) && !(await visible('allowedSites')) && (await q('#modeHint')).includes('blocked'), 'blocklist: only disallowed list shown');
await pick('allowlist');
check(!(await visible('blockedSites')) && (await visible('allowedSites')), 'allowlist: only allowed list shown');
await ev(`document.forms[0].elements.allowedSites.value = ''; document.forms[0].requestSubmit()`);
check((await q('#settingsError')).includes('at least one') && (await ev(`document.querySelector('[name=allowedSites]').getAttribute('aria-invalid')`)) === 'true', 'empty allowlist rejected + highlighted');
await pick('blocklist');
await ev(`document.forms[0].elements.blockedSites.value = 'https://www.YouTube.com/watch?v=1\\nreddit.com\\nnot a site'; document.forms[0].requestSubmit()`);
check((await q('#settingsError')).includes('not a site') && (await ev(`document.querySelector('[name=blockedSites]').getAttribute('aria-invalid')`)) === 'true', 'invalid site rejected + highlighted');
await ev(`document.forms[0].elements.blockedSites.value = 'https://www.YouTube.com/watch?v=1\\nreddit.com'; document.forms[0].requestSubmit()`);
check((await ev(`document.forms[0].elements.blockedSites.value`)) === 'youtube.com\nreddit.com' && (await q('#settingsError')) === 'Saved.', 'sites saved and shown normalized');
await load();
check((await ev(`document.querySelector('input[name=blockMode]:checked').value`)) === 'blocklist' && (await visible('blockedSites')) &&
  (await ev(`document.forms[0].elements.blockedSites.value`)) === 'youtube.com\nreddit.com', 'reload: mode + sites restored');
await ev(`document.forms[0].elements.focus.value = '2'; document.forms[0].requestSubmit()`);
check(JSON.parse(await ev(`localStorage.getItem('pomodoro.v1.settings')`)).blockedSites.length === 2 && (await q('#time')) === '02:00', 'saving durations keeps site lists');
await click('#startPause'); await skip(30);
check((await ev(`getComputedStyle(document.getElementById('progressBar')).width !== '0px'`)), 'progress bar advances');
check((await ev(`document.getElementById('blockerNote').hidden`)) === false, 'extension note shown on file://');
await click('#reset');

// 15. Settings rows (accordion), summaries, reveal-on-error, clear history
await load();
const rowsOpen = () => ev(`[...document.querySelectorAll('.setting-row')].map(d => d.open)`);
check(JSON.stringify(await rowsOpen()) === '[false,false,false,false,false]', 'five rows, all closed initially');
await ev(`document.querySelectorAll('.setting-row summary')[0].click()`); await sleep(100);
await ev(`document.querySelectorAll('.setting-row summary')[1].click()`); await sleep(100);
check(JSON.stringify(await rowsOpen()) === '[false,true,false,false,false]', 'opening a row closes the other (exclusive)', JSON.stringify(await rowsOpen()));
const sums = () => ev(`['#durationsSummary','#blockingSummary','#dataSummary'].map(s => document.querySelector(s).textContent)`);
let sm = await sums();
check(sm[0] === '2 / 5 / 15 min · long break every 4' && sm[1] === 'Blocking 2 sites during focus · needs the extension' && sm[2] === '0 focus sessions saved',
  'summaries reflect saved settings on load', JSON.stringify(sm));
await ev(`document.forms[0].elements.focus.value = '40'`);
check((await sums())[0].startsWith('2 /'), 'summary unchanged before Save');
await ev(`document.forms[0].requestSubmit()`);
check((await sums())[0] === '40 / 5 / 15 min · long break every 4', 'summary updates after Save', (await sums())[0]);
await ev(`document.querySelectorAll('.setting-row')[1].open = true`); // durations row closed
await ev(`document.forms[0].elements.long.value = '500'; document.forms[0].requestSubmit()`); await sleep(200);
check(JSON.stringify(await rowsOpen()) === '[true,false,false,false,false]' && (await ev(`document.activeElement.name`)) === 'long', 'invalid value opens its row and focuses the field');
check((await ev(`document.querySelector('.settings-menu').open`)) === true, 'invalid value also opens the settings drop-down');

// 16. Settings drop-down card: open/close paths + one-screen layout
const menuOpen = () => ev(`document.querySelector('.settings-menu').open`);
await ev(`document.querySelector('.settings-menu').open = false`);
await ev(`document.querySelector('.gear-btn').click()`);
check((await menuOpen()) === true, 'gear opens settings card');
await ev(`document.querySelector('.gear-btn').click()`);
check((await menuOpen()) === false, 'gear click again closes it');
await ev(`document.querySelector('.gear-btn').click(); document.getElementById('closeSettings').click()`);
check((await menuOpen()) === false && (await ev(`document.activeElement.classList.contains('gear-btn')`)), '✕ closes and returns focus to gear');
await ev(`document.querySelector('.gear-btn').click(); document.querySelector('[name=focus]').focus()`);
await ev(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
check((await menuOpen()) === false && (await ev(`document.activeElement.classList.contains('gear-btn')`)), 'Esc (even from an input) closes and focuses gear');
await ev(`document.querySelector('.gear-btn').click()`);
await ev(`document.querySelector('.settings-card').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
check((await menuOpen()) === true, 'click inside the card keeps it open');
await ev(`document.querySelector('#chart').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
check((await menuOpen()) === false, 'click outside closes it');
for (const [w, h] of [[1280, 760], [1366, 640], [390, 844]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 }); await sleep(300);
  check((await ev(`document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth`)), `no page scroll at ${w}×${h}`);
}
await send('Emulation.clearDeviceMetricsOverride');
await ev(`document.forms[0].elements.long.value = '15'; document.forms[0].requestSubmit()`);
// seed 3 sessions, then clear (cancel first)
await ev(`localStorage.setItem('pomodoro.v1.sessions', JSON.stringify([1,2,3].map(() => ({date:'2026-11-04',completedAt:'x',durationMin:25}))))`);
await load();
check((await sums())[2] === '3 focus sessions saved', 'data summary counts sessions');
await ev(`window.confirm = () => false; document.getElementById('clearHistory').click()`);
check((await q('#totalFocus')) === '1h 15m', 'clear history: Cancel keeps data');
await ev(`window.confirm = () => true; document.getElementById('clearHistory').click()`);
check((await q('#totalFocus')) === '0m' && (await sums())[2] === '0 focus sessions saved' && (await q('#settingsError')) === 'Focus history cleared.', 'clear history: OK empties stats + summary');
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
check((await ev(`getComputedStyle(document.querySelector('.petal')).animationName`)) === 'none', 'reduced motion stops scene animation');

// 17. Garden: live plant grows with focus, smart messages, bloom on complete, wilt on reset
await send('Emulation.setEmulatedMedia', { features: [] });
await ev(`localStorage.clear()`);
await load();
const coachText = () => q('#coachText');
const coachIcon = () => ev(`document.querySelector('#coach use').getAttribute('href')`);
const liveHref = () => ev(`document.querySelector('#livePlant use').getAttribute('href')`);
const growing = () => ev(`document.getElementById('livePlant').classList.contains('is-growing')`);
const savedGarden = () => ev(`JSON.parse(localStorage.getItem('pomodoro.v1.garden') || 'null')`);
check((await coachText()) === 'First bloom of the day starts here — plant a Sakura.' && (await coachIcon()) === '#plant-seed', 'garden: first-of-day message on load', await coachText());
// default focus = 25 min, the shortest session that counts for the garden
await click('#startPause'); await sleep(300);
check((await coachText()) === 'Seed planted. See you at bloom.' && (await liveHref()) === '#plant-seed' && (await growing()), 'garden: Start plants a seed (growing)', await coachText());
await skip(301);
check((await coachText()) === 'It sprouted — keep going.' && (await liveHref()) === '#plant-sprout', 'garden: sprout at 20 %', await coachText());
await skip(375);
check((await coachText()) === 'Halfway — your leaves are out.' && (await liveHref()) === '#plant-leaves' && (await q('#liveStage')).startsWith('Sakura · leaves · 14 min'), 'garden: leaves at 45 % + live stage text', await q('#liveStage'));
await click('#startPause'); await skip(300);
check((await coachText()) === 'Paused — your plant will wait for you.' && !(await growing()) && (await liveHref()) === '#plant-leaves' && (await savedGarden()) === null,
  'garden: pause keeps the stage, no wilt', await coachText());
await click('#startPause'); await sleep(300);
check((await coachText()) === 'Halfway — your leaves are out.', 'garden: resume re-announces the stage', await coachText());
await click('#reset'); await sleep(200);
let gd = await savedGarden();
check((await coachText()).startsWith('That one wilted') && (await coachIcon()) === '#plant-wilted' && gd.plants.length === 1 && gd.plants[0].state === 'wilted' && gd.petals === 0,
  'garden: reset after 1 min wilts (no petals)', JSON.stringify(gd));
await click('#startPause'); await skip(30); await click('#reset'); await sleep(200);
check((await savedGarden()).plants.length === 1 && (await coachText()).startsWith('First bloom of the day'), 'garden: reset in the first minute does not wilt', await coachText());
await click('#startPause'); await skip(1501);
gd = await savedGarden();
check(gd.petals === 25 && gd.plants.length === 2 && gd.plants[1].state === 'bloom' && gd.plants[1].minutes === 25, 'garden: completed 25-min focus adds a bloom + 25 petals', JSON.stringify(gd));
check((await coachText()) === 'Bloom #1 today · +25 petals' && (await coachIcon()) === '#plant-bloom', 'garden: completion message', await coachText());
await click('#startPause'); await sleep(200);
check((await coachText()) === 'Bloom saved. Rest your eyes for 5 min.' && !(await growing()), 'garden: break message, nothing grows on breaks', await coachText());
await skip(301);
check((await coachText()) === 'Break over — a new Sakura seed is ready.', 'garden: break over message', await coachText());
await load();
check((await coachText()) === 'Plant a Sakura — 25 min to full bloom.' && (await savedGarden()).petals === 25, 'garden: persists across reload; idle message uses today\'s blooms', await coachText());
await click('[data-range=garden]');
check((await q('#liveStage')) === 'Sakura · ready to plant' && (await ev(`!document.getElementById('gardenPanel').hidden && document.getElementById('chart').hidden`)),
  'garden view: live plant ready to plant, chart hidden', await q('#liveStage'));
await click('[data-range=daily]');
check((await ev(`document.getElementById('gardenPanel').hidden && !document.getElementById('chart').hidden`)) && (await ev(`document.querySelectorAll('.bar-col').length`)) === 7, 'daily view restores the chart');

// 17b. Focus shorter than Garden.MIN_FOCUS_MINUTES (25) never touches the garden; stats still count it
const gardenBefore = JSON.stringify(await savedGarden());
const sessionCount = () => ev(`JSON.parse(localStorage.getItem('pomodoro.v1.sessions') || '[]').length`);
const sessionsBeforeShort = await sessionCount();
const TOO_SHORT = "2-min focus won't grow the garden — plants need 25+ min.";
await setSettings({ focus: 2 }); await sleep(200);
check((await coachText()) === TOO_SHORT && (await q('#liveStage')) === 'Sakura · needs 25+ min focus to grow', 'short focus: message + live text explain the 25-min minimum', await coachText());
await click('#startPause'); await skip(45);
check(!(await growing()) && (await liveHref()) === '#plant-seed' && (await coachText()) === TOO_SHORT, 'short focus: plant does not grow, no stage messages');
await click('#startPause'); await sleep(100);
check((await coachText()) === TOO_SHORT, 'short focus: pause does not say "your plant will wait"', await coachText());
await click('#startPause'); await skip(20); await click('#reset'); await sleep(200); // 65 s of a 2-min session: would wilt a 25-min plant
check(JSON.stringify(await savedGarden()) === gardenBefore && (await coachText()) === TOO_SHORT, 'short focus: reset after 1 min does not wilt');
await click('#startPause'); await skip(121);
check(JSON.stringify(await savedGarden()) === gardenBefore && (await sessionCount()) === sessionsBeforeShort + 1,
  'short focus: completing it saves the session (stats) but adds no bloom or petals');
check((await coachText()) === 'Rest your eyes for 5 min.', 'short focus: break message does not claim a bloom', await coachText());

// 18. Garden view, flower picker, unlocks, on/off switch, reset garden
await ev(`localStorage.clear()`);
await load();
await click('[data-range=garden]');
check((await q('#petalCount')) === '0' && (await q('#gardenRow .garden-empty')) !== undefined && (await q('#gardenSummaryLine')) === '0 blooms this week',
  'garden view (empty): 0 petals, empty-row hint, 0 blooms');
await ev(`(() => { const k = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
  const p = (n, type, state, minutes = 25) => ({ date: k(n), type, state, minutes });
  localStorage.setItem('pomodoro.v1.garden', JSON.stringify({ enabled: true, petals: 260, unlocked: ['sakura', 'tulip'], selected: 'tulip',
    plants: [p(10, 'sakura', 'bloom'), p(1, 'tulip', 'bloom'), p(0, 'sakura', 'wilted', 12), p(0, 'tulip', 'bloom')] })); })()`);
await load();
await click('[data-range=garden]');
const rowTitles = await ev(`[...document.querySelectorAll('#gardenRow li')].map(li => li.title)`);
check((await q('#petalCount')) === '260' && rowTitles.length === 3 && rowTitles[0] === 'Today · Tulip · bloom · 25 min' && rowTitles[1] === 'Today · Sakura · wilted after 12 min' && rowTitles[2].startsWith('Yesterday · Tulip'),
  'garden view: petals + last 7 days, newest first (10-day-old plant left out)', JSON.stringify(rowTitles));
check((await q('#gardenSummaryLine')) === '2 blooms · 1 wilted this week' && (await q('#gardenSummary')) === 'On · 260 petals · growing Tulip', 'garden summaries', await q('#gardenSummaryLine'));
check((await ev(`document.querySelector('#gardenRow li:nth-child(2) use').getAttribute('href')`)) === '#plant-wilted', 'wilted plant drawn wilted');
const picker = () => ev(`[...document.querySelectorAll('[name=gardenFlower]')].map(r => r.value + (r.checked ? '*' : '') + (r.disabled ? '-' : ''))`);
check((await picker()).join() === 'sakura,tulip*,sunflower-,lotus-,moonflower-', 'picker: 5 flowers from the catalog, locked ones disabled', (await picker()).join());
check((await q('#unlockFlower')) === 'Unlock Sunflower · 250 petals' && !(await q('#unlockFlower', 'disabled')), 'unlock button offers the next flower');
await click('#unlockFlower'); await sleep(200);
gd = await savedGarden();
check(gd.petals === 10 && gd.unlocked.includes('sunflower') && gd.selected === 'sunflower' && (await picker()).join() === 'sakura,tulip,sunflower*,lotus-,moonflower-',
  'unlock spends 250 petals and selects Sunflower', JSON.stringify(gd));
check((await q('#unlockFlower')) === 'Lotus: 490 more petals to unlock' && (await q('#unlockFlower', 'disabled')) === true, 'next unlock shown as disabled until affordable', await q('#unlockFlower'));
check((await coachText()).includes('Sunflower') && (await ev(`document.querySelector('#coach .plant').classList.contains('flower-sunflower')`)), 'coach + plant follow the new flower', await coachText());
await ev(`(() => { const r = document.querySelector('[name=gardenFlower][value=sakura]'); window.pickedRadio = r; r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(200);
check((await savedGarden()).selected === 'sakura' && (await q('#liveStage')) === 'Sakura · ready to plant', 'picking an unlocked flower saves it');
check(await ev(`window.pickedRadio.isConnected && window.pickedRadio === document.querySelector('[name=gardenFlower]:checked')`),
  'picking a flower keeps the same radio element (picker not rebuilt, so keyboard focus survives)');
// switch off: looks like the app before the garden, and nothing grows
await ev(`(() => { const c = document.getElementById('gardenEnabled'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(200);
check((await q('#coach', 'hidden')) === true && (await q('#gardenToggle', 'hidden')) === true && (await q('#gardenPanel', 'hidden')) === true && (await q('#chart', 'hidden')) === false
  && (await ev(`document.querySelector('[data-range=daily]').getAttribute('aria-pressed')`)) === 'true' && (await q('#gardenSummary')) === 'Off',
  'switch off: coach + Garden toggle hidden, back to the Daily chart');
const plantsBefore = (await savedGarden()).plants.length;
await click('#startPause'); await skip(120); await click('#reset'); await sleep(100); // 25-min focus reset after 2 min: would wilt if on
await click('#startPause'); await skip(1501);
check((await savedGarden()).plants.length === plantsBefore && (await savedGarden()).petals === 10, 'switch off: a 25-min session neither wilts nor blooms');
await click('#reset');
await load();
check((await q('#coach', 'hidden')) === true && (await q('#gardenEnabled', 'checked')) === false, 'switch off persists across reload');
await ev(`(() => { const c = document.getElementById('gardenEnabled'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(200);
check((await q('#coach', 'hidden')) === false && (await q('#gardenToggle', 'hidden')) === false, 'switch on: coach + Garden toggle back');
// reset garden (focus history is kept)
const sessionsBefore = (await ev(`JSON.parse(localStorage.getItem('pomodoro.v1.sessions') || '[]').length`));
await ev(`window.confirm = () => false; document.getElementById('resetGarden').click()`);
check((await savedGarden()).petals === 10, 'reset garden: Cancel keeps everything');
await ev(`window.confirm = () => true; document.getElementById('resetGarden').click()`); await sleep(100);
check((await savedGarden()).petals === 0 && (await savedGarden()).plants.length === 0 && (await q('#petalCount')) === '0' && (await q('#settingsError')) === 'Garden reset.'
  && (await ev(`JSON.parse(localStorage.getItem('pomodoro.v1.sessions') || '[]').length`)) === sessionsBefore,
  'reset garden: OK empties the garden, keeps focus history');
await ev(`document.getElementById('resetGarden').click()`);
check((await q('#settingsError')) === 'Your garden is already empty.', 'reset garden on an empty garden just says so');
// one screen with a full garden row
await ev(`localStorage.setItem('pomodoro.v1.garden', JSON.stringify({ enabled: true, petals: 5, unlocked: ['sakura'], selected: 'sakura',
  plants: Array.from({ length: 60 }, () => ({ date: '${new Date().toISOString().slice(0, 10)}', type: 'sakura', state: 'bloom', minutes: 25 })) }))`);
await load();
await click('[data-range=garden]');
for (const [w, h] of [[1280, 760], [1366, 640], [390, 844]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 }); await sleep(300);
  check((await ev(`document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth`)), `garden view with 60 plants: no page scroll at ${w}×${h}`);
}
await send('Emulation.clearDeviceMetricsOverride');

// 19. Appearance: System / Light / Dark theme (Settings → Appearance), applied on every page
const osScheme = (value) => send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
const themeNow = () => ev(`document.documentElement.dataset.theme`);
const textToken = () => ev(`getComputedStyle(document.documentElement).getPropertyValue('--text').trim()`);
const savedTheme = () => ev(`JSON.parse(localStorage.getItem('pomodoro.v1.settings') || '{}').theme`);
const pickTheme = (value) => ev(`(() => { const r = document.querySelector('[name=theme][value=${value}]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await osScheme('light');
await ev(`localStorage.clear()`);
await load();
check((await ev(`[...document.head.querySelectorAll('script')].map(s => s.src.split('/').pop() + (s.defer ? '+defer' : '')).join()`)) === 'storage.js,theme.js',
  'theme: storage.js + theme.js load un-deferred in <head> (theme set before paint)');
check((await themeNow()) === 'light' && (await q('#appearanceSummary')) === 'Match system' && (await q('[name=theme][value=system]', 'checked')) === true,
  'theme: default System → light on a light OS');
await osScheme('dark'); await sleep(150);
check((await themeNow()) === 'dark' && (await textToken()) === '#f3e8ff' && (await ev(`getComputedStyle(document.documentElement).colorScheme`)) === 'dark',
  'theme: System follows the OS live (dark tokens + color-scheme)', await textToken());
await ev(`document.forms[0].elements.focus.value = '33'`); // unsaved edit in another row
await pickTheme('light'); await sleep(100);
check((await themeNow()) === 'light' && (await textToken()) === '#3b2f5c' && (await savedTheme()) === 'light' && (await q('#appearanceSummary')) === 'Light',
  'theme: Light overrides a dark OS, saved immediately');
check((await ev(`document.forms[0].elements.focus.value`)) === '33' && JSON.parse(await ev(`localStorage.getItem('pomodoro.v1.settings')`)).focus === 25,
  'theme: changing it keeps unsaved edits in other rows (and does not save them)');
await pickTheme('dark'); await sleep(100);
await ev(`document.forms[0].requestSubmit()`); await sleep(100);
check((await savedTheme()) === 'dark' && JSON.parse(await ev(`localStorage.getItem('pomodoro.v1.settings')`)).focus === 33, 'theme: Save keeps the chosen theme');
await osScheme('light'); await sleep(150);
check((await themeNow()) === 'dark', 'theme: Dark stays dark on a light OS');
await load();
check((await themeNow()) === 'dark' && (await q('[name=theme][value=dark]', 'checked')) === true && (await q('#appearanceSummary')) === 'Dark', 'theme: persists across reload');
await send('Page.navigate', { url: pathToFileURL(path.join(projectDir, 'blocked.html')).href }); await sleep(600);
check((await themeNow()) === 'dark' && (await textToken()) === '#f3e8ff', 'theme: blocked page uses the same saved theme');
await load();
await ev(`document.getElementById('restoreDefaults').click()`); await sleep(100);
check((await ev(`localStorage.getItem('pomodoro.v1.settings')`)) === null && (await themeNow()) === 'light' && (await q('#appearanceSummary')) === 'Match system',
  'theme: Restore defaults → System (follows the light OS again)');
await ev(`localStorage.setItem('pomodoro.v1.settings', JSON.stringify({ theme: 'neon' }))`);
await load();
check((await themeNow()) === 'light' && (await q('#appearanceSummary')) === 'Match system', 'theme: tampered value falls back to System');
await send('Emulation.setEmulatedMedia', { features: [] });

// 20. Two timer tabs share one garden: a change in one tab must never erase the other tab's progress
await ev(`localStorage.clear()`);
await load();
const tabB = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const wsB = new WebSocket(tabB.webSocketDebuggerUrl);
await new Promise((r) => wsB.addEventListener('open', r));
let idB = 0; const pendingB = new Map();
wsB.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pendingB.has(m.id)) { pendingB.get(m.id)(m); pendingB.delete(m.id); } });
const sendB = (method, params = {}) => new Promise((r) => { const i = ++idB; pendingB.set(i, r); wsB.send(JSON.stringify({ id: i, method, params })); });
const evB = async (expr) => (await sendB('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.result.value;
await sendB('Page.enable');
await sendB('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__skew = 0; const __n = Date.now.bind(Date); Date.now = () => __n() + window.__skew;' });
await sendB('Page.navigate', { url: pageUrl }); await sleep(800);
await sendB('Page.bringToFront');
await evB(`document.getElementById('startPause').click()`);                 // tab B starts a 25-min focus first
await send('Page.bringToFront');
await click('#startPause'); await skip(1501); await sleep(300);                   // tab A completes its 25-min focus
check((await savedGarden()).petals === 25, 'two tabs: tab A saved its bloom (+25 petals)', JSON.stringify(await savedGarden()));
await sendB('Page.bringToFront');
await evB('window.__skew += 120000'); await sleep(500);
await evB(`document.getElementById('reset').click()`); await sleep(200);    // tab B resets after 2 min → wilt
gd = await savedGarden();
check(gd.petals === 25 && gd.plants.map((p) => p.state).join() === 'bloom,wilted',
  'two tabs: tab B\'s wilt keeps tab A\'s bloom and petals (no stale overwrite)', JSON.stringify(gd));
check((await evB(`document.getElementById('petalCount').textContent`)) === '25', 'two tabs: tab B shows the shared petal count after saving');
wsB.close();
await fetch(`http://127.0.0.1:${PORT}/json/close/${tabB.id}`);
await send('Page.bringToFront');

check(errors.length === 0, 'no console errors / exceptions', errors.join(' | '));

ws.close(); await closeBrowser();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
