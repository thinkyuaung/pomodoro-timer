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

async function openTimer() {
  const url = chrome.runtime.getURL(TIMER_PAGE);
  const [existing] = await chrome.tabs.query({ url });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

// ---------- listeners (registered synchronously at top level) ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg !== 'object') return false;

  let task;
  if (msg.type === 'block') task = applyBlocking(msg);
  else if (msg.type === 'clear') task = clearBlocking();
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
