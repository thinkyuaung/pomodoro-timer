// Page e2e suite: drives index.html (file://) in headless Chrome via the DevTools protocol
// (Node 22+ built-in WebSocket). Date.now is skewed from the test so minutes pass instantly.
// Run: node tests/e2e-page.mjs
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

import { findBrowser, PROJECT_DIR, tempProfile } from './helpers.mjs';

const browser = findBrowser('chrome');
const projectDir = PROJECT_DIR;
const profileDir = tempProfile('page');
const pageUrl = pathToFileURL(path.join(projectDir, 'index.html')).href;
const PORT = 9333;

const proc = spawn(browser, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`,
  '--no-first-run', '--allow-file-access-from-files', 'about:blank',
], { stdio: 'ignore' });

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
check(JSON.stringify(await rowsOpen()) === '[false,false,false]', 'three rows, all closed initially');
await ev(`document.querySelectorAll('.setting-row summary')[0].click()`); await sleep(100);
await ev(`document.querySelectorAll('.setting-row summary')[1].click()`); await sleep(100);
check(JSON.stringify(await rowsOpen()) === '[false,true,false]', 'opening a row closes the other (exclusive)', JSON.stringify(await rowsOpen()));
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
check(JSON.stringify(await rowsOpen()) === '[true,false,false]' && (await ev(`document.activeElement.name`)) === 'long', 'invalid value opens its row and focuses the field');
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

check(errors.length === 0, 'no console errors / exceptions', errors.join(' | '));

ws.close(); proc.kill();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
