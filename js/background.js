/**
 * background.js — extension service worker. Exposes nothing.
 *
 * Keeps NO persistent state. Everything lives in:
 *   - one declarativeNetRequest *session* rule (auto-removed when the browser restarts)
 *   - one chrome.alarms alarm at the focus session's end time (safety net if the timer tab
 *     is closed or asleep — the rule is removed even without a message from the page)
 *
 * Messages (from js/blocker.js):
 *   { type: 'block', mode: 'blocklist' | 'allowlist', sites: string[], endTime: number }
 *   { type: 'clear' }
 *   { type: 'open-timer' }   (from blocked.html: go back to the running timer tab)
 */
'use strict';

const RULE_ID = 1;
const ALARM_NAME = 'focus-end';
const BLOCKED_PAGE = '/blocked.html';
const TIMER_PAGE = 'index.html';

// ---------- rules ----------

function buildRule(mode, sites) {
  const condition = mode === 'blocklist'
    ? { requestDomains: sites, resourceTypes: ['main_frame'] }
    // allowlist: every http(s) page except the allowed domains (and their subdomains)
    : { urlFilter: '|http', excludedRequestDomains: sites, resourceTypes: ['main_frame'] };

  return {
    id: RULE_ID,
    priority: 1,
    action: { type: 'redirect', redirect: { extensionPath: BLOCKED_PAGE } },
    condition,
  };
}

async function clearBlocking() {
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [RULE_ID] });
  await chrome.alarms.clear(ALARM_NAME);
}

function isValidRequest(msg) {
  return (
    (msg.mode === 'blocklist' || msg.mode === 'allowlist') &&
    Array.isArray(msg.sites) &&
    msg.sites.length > 0 &&
    msg.sites.every((s) => typeof s === 'string' && s.length > 0) &&
    Number.isFinite(msg.endTime)
  );
}

async function applyBlocking(msg) {
  if (!isValidRequest(msg) || msg.endTime <= Date.now()) {
    await clearBlocking();
    return;
  }
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [RULE_ID],
    addRules: [buildRule(msg.mode, msg.sites)],
  });
  await chrome.alarms.create(ALARM_NAME, { when: msg.endTime });
  await redirectOpenTabs(msg.mode, msg.sites);
}

// ---------- already-open tabs ----------

function matchesDomain(hostname, sites) {
  return sites.some((site) => hostname === site || hostname.endsWith(`.${site}`));
}

/** Rules only affect new navigations, so send open tabs on blocked sites to the blocked page. */
async function redirectOpenTabs(mode, sites) {
  const blockedUrl = chrome.runtime.getURL(BLOCKED_PAGE);
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.url || !/^https?:/.test(tab.url)) continue;
    const listed = matchesDomain(new URL(tab.url).hostname, sites);
    const blocked = mode === 'blocklist' ? listed : !listed;
    if (blocked) {
      chrome.tabs.update(tab.id, { url: blockedUrl }).catch(() => {});
    }
  }
}

// ---------- open the timer ----------

/** The most recently used timer tab, ignoring `excludeTabId` (e.g. the blocked tab itself). */
async function findTimerTab(excludeTabId) {
  const timerUrl = chrome.runtime.getURL(TIMER_PAGE);
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter((tab) => tab.id !== excludeTabId && tab.url && tab.url.startsWith(timerUrl))
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
}

async function focusTab(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

/** Toolbar icon: switch to the open timer, or open one. */
async function openTimer() {
  const existing = await findTimerTab();
  if (existing) await focusTab(existing);
  else await chrome.tabs.create({ url: chrome.runtime.getURL(TIMER_PAGE) });
}

/**
 * "Back to timer" on the blocked page: switch to the running timer and close the blocked tab;
 * if no timer is open, turn the blocked tab itself into the timer (never a second timer).
 */
async function returnToTimer(blockedTab) {
  const existing = await findTimerTab(blockedTab.id);
  if (existing) {
    await focusTab(existing);
    await chrome.tabs.remove(blockedTab.id);
  } else {
    await chrome.tabs.update(blockedTab.id, { url: chrome.runtime.getURL(TIMER_PAGE) });
  }
}

// ---------- listeners (registered synchronously at top level) ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg !== 'object') return false;

  let task;
  if (msg.type === 'block') task = applyBlocking(msg);
  else if (msg.type === 'clear') task = clearBlocking();
  else if (msg.type === 'open-timer' && sender.tab) task = returnToTimer(sender.tab);
  else return false;

  task.then(
    () => sendResponse({ ok: true }),
    (err) => {
      console.warn('[background] blocking update failed', err);
      sendResponse({ ok: false, error: String(err) });
    },
  );
  return true; // respond asynchronously
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) clearBlocking();
});

chrome.action.onClicked.addListener(() => {
  openTimer();
});

// Start clean after install/update/browser start (no focus session is running then).
chrome.runtime.onInstalled.addListener(() => clearBlocking());
chrome.runtime.onStartup.addListener(() => clearBlocking());
