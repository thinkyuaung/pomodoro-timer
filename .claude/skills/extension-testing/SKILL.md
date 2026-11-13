---
name: extension-testing
description: How to load, test and debug the Pomodoro timer's Chrome/Edge extension (site blocking) — loading unpacked, inspecting the background service worker, session blocking rules and the focus-end alarm, running the Edge e2e suite, and adding a new page↔background message type. Use when site blocking "doesn't work", when changing manifest.json, background.js, blocker.js or blocked.html, or when testing the extension.
---

# Extension: load, test, debug

Read `.claude/rules/extension.md` first.

## Load it
1. `edge://extensions` (or `chrome://extensions`) → Developer mode → **Load unpacked** → the project folder.
2. Open the timer from the extension's **toolbar icon** (URL `chrome-extension://<id>/index.html`).
3. After editing any file: press the extension card's **reload** button, then reload the timer tab.

## "Blocking doesn't work" — check in this order
1. **Is the timer running inside the extension?** `file://` and Live Server (`http://127.0.0.1:5500`) are plain
   pages: no `chrome.runtime`, no blocking, and the settings note "install as extension" is shown. Their
   `localStorage` is separate from the extension's, so settings saved there do not apply.
2. Mode is not `off`, the list has sites, and a **focus** session is **running** (paused/idle/breaks are unblocked).
3. Service worker console (extension card → "service worker"):
   - `await chrome.declarativeNetRequest.getSessionRules()` → one rule (id 1) while focus runs
   - `await chrome.alarms.get('focus-end')` → `scheduledTime` = the session's end time
4. A tab that was still loading when focus started can slip through (`redirectOpenTabs` reads `tab.url`, which is
   empty until the page commits) — known issue; reload that tab.

## Automated suite
```
node tests/e2e-extension.mjs
```
- Needs **Edge** (current Chrome ignores `--load-extension`); finds it automatically or via `EDGE_PATH`
- Uses a free DevTools port and a throw-away profile; `close()` sends `Browser.close` (Edge relaunches itself
  under a new process id, so killing the spawned process alone leaves it running)
- Wait for real page loads/redirects by **polling** (`visit()`), never a fixed sleep — fixed sleeps made checks flaky
- Skips the "Back to timer" checks while that button is commented out in `blocked.html`
- If old headless Edge processes linger, stop only those started by the tests (`--headless` and a `pomodoro-*`
  profile), never the user's own browser

## Add a page ↔ background message type
1. `js/blocker.js`: a function returning `send({ type: '<name>', ... })` — keep `send()` the only caller of
   `chrome.runtime.sendMessage`; export it from `SiteBlocker`.
2. `js/background.js`: validate the payload (like `isValidRequest`) and add an `else if (msg.type === '<name>')`
   branch in `onMessage`; keep the `sender.id === chrome.runtime.id` check first. Store nothing outside session
   rules + the one alarm.
3. Page side calls it from `app.js` or `blocked.js` only.
4. Add a check to `tests/e2e-extension.mjs`, then run the `verify` skill.
