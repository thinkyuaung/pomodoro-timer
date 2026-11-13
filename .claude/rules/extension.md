---
paths:
  - "manifest.json"
  - "js/background.js"
  - "js/blocker.js"
  - "js/blocked.js"
  - "blocked.html"
---

# Extension and site-blocking rules

## Architecture
- The app is also a Manifest V3 extension (same files, loaded unpacked). A plain web page cannot block other
  sites, so blocking exists only in the extension; from `file://` it is simply unavailable (no errors)
- `blocker.js` (page side, `SiteBlocker`) sends `block` / `clear` / `open-timer` messages; `background.js`
  (service worker) applies them. These two are the only files that use `chrome.*`
- `background.js` keeps **no persistent state**: only declarativeNetRequest **session** rules + one
  `chrome.alarms` alarm (`focus-end`). It accepts messages only from its own extension
- `blocked.html` loads `storage.js` + `theme.js` (in `<head>`), then `blocker.js` + `blocked.js`

## Blocking behaviour
- Mode: `off` (default) | `blocklist` (block only disallowed sites) | `allowlist` (block every site except allowed ones)
- Lists: one site per line; input like `https://www.youtube.com/watch` is normalized to `youtube.com`; a domain
  also covers its subdomains; max 100 per list; allowlist mode requires at least one site (never block the whole web)
- Active **only while a focus session is running** — paused, idle and breaks are unblocked
- Site setting changes apply immediately (durations still apply from the next session)
- Tabs already open on a blocked site are redirected to `blocked.html` when focus starts
- Rules end automatically at the focus session's end time via the alarm, even if the timer tab is closed
- A freshly opened timer page never clears rules another timer tab set (`lastBlockKey` starts as `'none'`)
- Blocked page "Back to timer" returns to the running timer tab (most recently used) and closes the blocked tab;
  if no timer tab is open, the blocked tab becomes the timer. (The button is currently commented out in
  `blocked.html`; the extension tests skip its checks while it is.)

## Running and testing
- Load: `chrome://extensions` (or `edge://extensions`) → Developer mode → Load unpacked → project folder →
  click the extension's toolbar icon to open (or focus) the timer tab; after editing files press the
  extension card's reload button
- The extension and `file://` have separate `localStorage` (different origins)
- `tests/e2e-extension.mjs` needs **Edge** (current Chrome ignores `--load-extension`) and includes one
  real-time (~60 s) alarm check
