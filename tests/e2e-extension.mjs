// Extension e2e suite: loads the project unpacked in headless Edge and checks real site blocking.
// (Current Chrome ignores --load-extension, so this suite needs Edge.) Takes ~2 min (one real-time alarm test).
// Run: node tests/e2e-extension.mjs
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { findBrowser, launchBrowser, OUTPUT_DIR, PROJECT_DIR, tempProfile } from './helpers.mjs';

const browser = findBrowser('edge');
const ext = PROJECT_DIR;
const profile = tempProfile('ext');
const outDir = OUTPUT_DIR;
const { port: PORT, close: closeBrowser } = await launchBrowser(browser, profile,
  [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- find extension + connect to the browser endpoint ----
let swInfo, browserWs;
for (let i = 0; i < 40 && !swInfo; i++) {
  await sleep(300);
  try {
    swInfo = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.url.endsWith('/js/background.js'));
    browserWs = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl;
  } catch {}
}
if (!swInfo) { console.log('FAIL  extension service worker not found'); await closeBrowser(); process.exit(1); }
const EXT = swInfo.url.match(/^chrome-extension:\/\/[a-z]+/)[0];
const BLOCKED = `${EXT}/blocked.html`;
console.log('extension:', EXT);

const ws = new WebSocket(browserWs);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push(`[${m.sessionId?.slice(0, 4)}] ` + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const i = ++id; pending.set(i, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
  ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const attach = async (targetId) => (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
const evalIn = async (sessionId, expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const urlOf = async (targetId) => (await send('Target.getTargets')).targetInfos.find((t) => t.targetId === targetId)?.url;

// Background service worker session (to inspect rules/alarms directly)
const swSession = await attach(swInfo.id);
const rules = () => evalIn(swSession, 'chrome.declarativeNetRequest.getSessionRules().then(r => r.length)');
const alarm = () => evalIn(swSession, `chrome.alarms.get('focus-end').then(a => a ? a.scheduledTime : null)`);

// Timer page with a skewable clock
async function openTimer() {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const s = await attach(targetId);
  await send('Runtime.enable', {}, s); await send('Page.enable', {}, s);
  await send('Page.addScriptToEvaluateOnNewDocument', { source:
    'window.__skew = 0; const __n = Date.now.bind(Date); Date.now = () => __n() + window.__skew;' }, s);
  await send('Page.navigate', { url: `${EXT}/index.html` }, s);
  await sleep(1000);
  return { targetId, s };
}
let timer = await openTimer();
const T = (expr) => evalIn(timer.s, expr);
const click = (sel) => T(`document.querySelector(${JSON.stringify(sel)}).click()`);
const skip = async (sec) => { await T(`window.__skew += ${sec * 1000}`); await sleep(600); };
const saveSettings = (o) => T(`(() => { const f = document.forms[0];
  ${Object.entries(o).map(([k, v]) => k === 'blockMode'
    ? `f.querySelector('[name=blockMode][value=${v}]').checked = true; f.querySelector('[name=blockMode][value=${v}]').dispatchEvent(new Event('change', {bubbles:true}));`
    : `f.elements.${k}.value = ${JSON.stringify(Array.isArray(v) ? v.join('\n') : String(v))};`).join('')}
  f.requestSubmit(); return document.getElementById('settingsError').textContent; })()`);
const status = () => T(`(() => { const b = document.getElementById('blockStatus'); return b.hidden ? null : b.textContent; })()`);

// Open a URL in a new tab and report whether it ended on blocked.html
const opened = [];
// Polls instead of one fixed wait: returns as soon as the tab lands on blocked.html,
// otherwise reports "not blocked" after 2.5 s (enough even when the machine is busy).
async function visit(url) {
  const { targetId } = await send('Target.createTarget', { url });
  opened.push(targetId);
  for (let waited = 0; waited < 2500; waited += 250) {
    await sleep(250);
    if ((await urlOf(targetId))?.startsWith(BLOCKED)) return true;
  }
  return false;
}
async function closeOpened() {
  for (const t of opened.splice(0)) await send('Target.closeTarget', { targetId: t }).catch(() => {});
}

let failed = 0;
const check = (cond, label, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra !== '' ? '  → ' + extra : ''}`); if (!cond) failed++; };

// 1. Extension page basics
check((await T('SiteBlocker.isAvailable()')) === true, 'SiteBlocker available inside extension');
check((await T(`document.getElementById('blockerNote').hidden`)) === true, 'install note hidden inside extension');
check((await status()) === null && (await rules()) === 0, 'idle: no status line, no rules');

// 2. Blocklist
let msg = await saveSettings({ focus: 1, short: 1, long: 2, longEvery: 2, blockMode: 'blocklist', blockedSites: ['example.com'] });
check(msg === 'Saved.', 'blocklist settings saved', msg);

const { targetId: preTab } = await send('Target.createTarget', { url: 'https://example.com/already-open' });
opened.push(preTab); await sleep(1000);
// Wait until example.com has really loaded: while loading, tab.url is still empty (only pendingUrl is set)
const preTabLoaded = () => evalIn(swSession, `chrome.tabs.query({}).then(t => t.some(x => x.status === 'complete' && (x.url || '').includes('example.com/already-open')))`);
for (let waited = 0; waited < 10000 && !(await preTabLoaded()); waited += 200) await sleep(200);
check(!(await urlOf(preTab)).startsWith(BLOCKED), 'pre-open tab not blocked before focus');

await click('#startPause'); await sleep(1200);
check((await status()) === 'Blocking 1 site', 'status line while focus runs', await status());
check((await rules()) === 1 && (await alarm()) !== null, 'session rule + end alarm created');
for (let waited = 0; waited < 3000 && !(await urlOf(preTab)).startsWith(BLOCKED); waited += 100) await sleep(100); // redirect can lag under load
check((await urlOf(preTab)).startsWith(BLOCKED), 'already-open example.com tab redirected to blocked page', await urlOf(preTab));
check(await visit('https://example.com/'), 'blocklist: example.com blocked');
check(await visit('https://sub.example.com/page'), 'blocklist: sub.example.com blocked');
check(!(await visit('https://example.org/')), 'blocklist: example.org allowed');
await closeOpened();

// 3. Pause / resume
await click('#startPause'); await sleep(800);
check((await rules()) === 0 && (await alarm()) === null && (await status()) === null, 'pause: rules + alarm + status cleared');
check(!(await visit('https://example.com/')), 'pause: example.com allowed');
await click('#startPause'); await sleep(800);
check((await rules()) === 1, 'resume: rule back');
check(await visit('https://example.com/'), 'resume: example.com blocked again');
await closeOpened();

// 4. Focus ends → break → free; next focus → blocked again
await skip(61);
check((await T(`document.querySelector('.app').dataset.mode`)) === 'short' && (await rules()) === 0, 'focus ends → short break, rules cleared');
check(!(await visit('https://example.com/')), 'break: example.com allowed');
check((await T(`document.getElementById('startPause').textContent`)) === 'Start', 'break waits for Start');
await click('#startPause'); await skip(61);
check((await T(`document.querySelector('.app').dataset.mode`)) === 'focus' && (await T(`document.getElementById('startPause').textContent`)) === 'Start' && (await rules()) === 0, 'break ends → focus waiting, still NOT blocked');
await click('#startPause'); await sleep(800);
check((await rules()) === 1, 'Start focus → blocked again');
await click('#reset'); await sleep(600);
check((await rules()) === 0, 'reset: rules cleared');
await closeOpened();

// 5. Allowlist
msg = await saveSettings({ blockMode: 'allowlist', allowedSites: ['example.com'] });
check(msg === 'Saved.', 'allowlist settings saved', msg);
await click('#startPause'); await sleep(1000);
check((await status()) === 'Only 1 site allowed', 'allowlist status line', await status());
check(await visit('https://example.org/'), 'allowlist: example.org blocked');
check(!(await visit('https://example.com/')), 'allowlist: example.com allowed');
check(!(await visit('https://docs.example.com/')), 'allowlist: docs.example.com allowed (subdomain)');
check(!(await visit(`${EXT}/index.html`)), 'allowlist: extension pages never blocked');

await closeOpened(); // close the extra timer page opened by the previous check
// 6. Blocked page "Back to timer"
const { targetId: bp } = await send('Target.createTarget', { url: 'https://example.net/' });
opened.push(bp); await sleep(1200);
const bpS = await attach(bp);
const hasBack = await evalIn(bpS, `!!document.getElementById('backToTimer')`);
if (!hasBack) console.log('SKIP  Back to timer checks: button is commented out in blocked.html');
if (hasBack) {
const timerTabs = async () => (await send('Target.getTargets')).targetInfos.filter((t) => t.type === 'page' && t.url === `${EXT}/index.html`);
const activeUrl = () => evalIn(swSession, 'chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(t => t[0] && t[0].url)');
await evalIn(bpS, `document.getElementById('backToTimer').click()`); await sleep(1200);
check((await urlOf(bp)) === undefined, 'Back to timer: blocked tab closed', String(await urlOf(bp)));
check((await timerTabs()).length === 1 && (await timerTabs())[0].targetId === timer.targetId, 'Back to timer: no second timer, original timer tab kept', JSON.stringify((await timerTabs()).map(t => t.targetId === timer.targetId)));
check((await activeUrl()) === `${EXT}/index.html`, 'Back to timer: running timer tab is now active', await activeUrl());
check((await T(`document.getElementById('startPause').textContent`)) === 'Pause' && (await rules()) === 1, 'countdown still running, blocking still on');
}
await closeOpened();

// 7. Change list while running → applied immediately
msg = await saveSettings({ allowedSites: ['example.org'] });
await sleep(800);
check(!(await visit('https://example.org/')) && (await visit('https://example.com/')), 'list changed mid-focus applies immediately', msg);
await closeOpened();

// 8. Mode off while running
await saveSettings({ blockMode: 'off' }); await sleep(800);
check((await rules()) === 0 && (await status()) === null && !(await visit('https://example.com/')), 'mode off mid-focus: nothing blocked');
await click('#reset');
await closeOpened();

// 9. Screenshots (timer with status, blocked page light + dark)
await saveSettings({ blockMode: 'blocklist', blockedSites: ['example.com', 'youtube.com', 'reddit.com'], focus: 25 });
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 640, deviceScaleFactor: 1, mobile: false }, timer.s);
await click('#startPause'); await sleep(1500);
writeFileSync(path.join(outDir, 'ext-timer.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, timer.s)).data, 'base64'));
const { targetId: shotTab } = await send('Target.createTarget', { url: 'https://youtube.com/' });
await sleep(1200);
const shotS = await attach(shotTab);
await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 560, deviceScaleFactor: 1, mobile: false }, shotS);
await sleep(300);
writeFileSync(path.join(outDir, 'blocked-light.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, shotS)).data, 'base64'));
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, shotS);
await sleep(300);
writeFileSync(path.join(outDir, 'blocked-dark.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, shotS)).data, 'base64'));
await send('Target.closeTarget', { targetId: shotTab });
await click('#reset');

// 10. Close the timer tab mid-focus → blocking continues until the end-time alarm (real time, ~60 s)
await send('Target.closeTarget', { targetId: timer.targetId });
timer = await openTimer(); // fresh page = clock skew 0
await saveSettings({ focus: 1, blockMode: 'blocklist', blockedSites: ['example.com'] });
await click('#startPause'); await sleep(800);
const endAt = await alarm();
await send('Target.closeTarget', { targetId: timer.targetId });
await sleep(1000);
check((await rules()) === 1 && (await visit('https://example.com/')), 'timer tab closed: still blocked');
{ // no timer tab open → Back to timer turns the blocked tab into the timer
  const { targetId: lone } = await send('Target.createTarget', { url: 'https://example.com/x' }); opened.push(lone); await sleep(1200);
  const loneS = await attach(lone);
  if (await evalIn(loneS, `!!document.getElementById('backToTimer')`)) {
  await evalIn(loneS, `document.getElementById('backToTimer').click()`); await sleep(1200);
  const tabsNow = (await send('Target.getTargets')).targetInfos.filter((t) => t.type === 'page' && t.url === `${EXT}/index.html`);
  check((await urlOf(lone)) === `${EXT}/index.html` && tabsNow.length === 1, 'no timer open: blocked tab becomes the timer (one timer only)', await urlOf(lone));
  check((await rules()) === 1, '…and blocking continues until the alarm');
  }
}
await closeOpened();
const wait = Math.max(0, endAt - Date.now()) + 3000;
console.log(`      … waiting ${Math.round(wait / 1000)} s for the focus-end alarm`);
await sleep(wait);
check((await rules()) === 0 && (await alarm()) === null, 'alarm at session end removed the rule');
check(!(await visit('https://example.com/')), 'after alarm: example.com allowed');
await closeOpened();

check(errors.length === 0, 'no console errors / exceptions', errors.join(' | '));
ws.close(); await closeBrowser();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
