# Pomodoro Timer with Stats

A browser-based Pomodoro timer that records completed focus sessions, shows usage stats,
and (when installed as a Chrome/Edge extension) blocks distracting websites during focus sessions.

## Stack
- HTML5, CSS3, vanilla JavaScript (ES2015+) only
- Optional Chrome/Edge Manifest V3 extension wrapper (same files, loaded unpacked) for site blocking

## Rules
- No React, Vue, Angular, or any other framework
- No backend — everything runs in the browser; data persists in `localStorage`
- No external libraries, CDNs, or npm packages (no build step, no `package.json`)
- All storage code lives in `js/storage.js` — no other file may call `localStorage` directly
- Only `js/app.js` touches the DOM; `timer.js`, `stats.js` and `blocker.js` are pure logic
- `chrome.*` extension APIs are used only in `js/blocker.js` (page side) and `js/background.js` (service worker)
- `js/background.js` keeps no persistent state: only session blocking rules + one `chrome.alarms` alarm
- The app must keep working as a plain page opened from `file://`; blocking is then simply unavailable
- No inline scripts or `onclick` attributes (extension pages forbid them via CSP)

## Structure
```
index.html        Markup only; loads the scripts in order
blocked.html      Static "blocked during focus" page shown in place of a blocked site (no scripts)
manifest.json     Manifest V3 extension definition (permissions, background worker, toolbar action)
css/style.css     Layout, theme variables, per-mode accent colors, CSS bar chart, blocked page
js/storage.js     AppStorage object: settings (incl. site lists) + session history in localStorage
js/timer.js       Timer object: countdown engine and focus/break mode switching
js/stats.js       Stats object: pure calculations over saved sessions
js/blocker.js     SiteBlocker object: sends block/clear messages to the extension background
js/background.js  Extension service worker: applies/removes blocking rules, opens the timer tab
js/app.js         Wires UI events to Timer/Storage/Stats/SiteBlocker and renders everything
```

## Features
- Start, pause, reset
- Auto switch: focus (25 min) → short break (5 min); long break (15 min) after every 4 focus sessions
- Save each completed focus session: `{ date: "YYYY-MM-DD" (local), completedAt: ISO string, durationMin }`
- Stats: sessions today, total focus time, daily (last 7 days) and weekly (last 8 weeks) history as CSS bars
- Settings for custom durations (validated 1–120 min)
- Site blocking settings (extension only):
  - Mode: `off` (default) | `blocklist` (block only disallowed sites) | `allowlist` (block every site except allowed ones)
  - Lists: one site per line; input like `https://www.youtube.com/watch` is normalized to `youtube.com`;
    a domain also covers its subdomains; max 100 per list; allowlist mode requires at least one site
  - Active **only while a focus session is running** — paused, idle and breaks are unblocked
  - Changes to site settings apply immediately (durations still apply from the next session)
  - Rules end automatically at the focus session's end time, even if the timer tab is closed

## Conventions
- Scripts load with `<script defer>` in dependency order: `storage.js` → `timer.js` → `stats.js` → `blocker.js` → `app.js`
- Each page-side JS file exposes exactly one global object: `AppStorage`, `Timer`, `Stats`, `SiteBlocker`;
  `app.js` and `background.js` expose nothing
  (not `Storage` — that name is the browser's built-in `window.Storage` interface)
- Timer accuracy: compute remaining time from an `endTime` timestamp, never by counting ticks
- Wrap every `localStorage` read/write in `try/catch` and fall back to defaults
- Only focus sessions that run to completion are saved (reset = nothing saved)
- Dates use the user's local time zone; weeks start on Monday
- Charts: plain `<div>` bars sized via a CSS custom property (`--h`); no canvas libraries
- Use `const`/`let`, `===`, small named functions; no inline `onclick` attributes in HTML
- Accessibility: real `<button>` elements, visible focus styles, `aria-live` on the time display

## Running
- **Timer only:** open `index.html` directly in a browser (works from `file://`). No install or server required.
- **With site blocking (Chrome/Edge):** `chrome://extensions` (or `edge://extensions`) → enable Developer mode →
  Load unpacked → select this project folder → click the extension's toolbar icon to open the timer.
  After editing files, press the reload button on the extension card.
- The two ways of running have **separate** `localStorage` (different origins), so stats/settings are not shared.

## Manual test checklist
Tip: set Focus/Short = 1 min, Long = 2, "Long break after" = 2 in Settings for a fast cycle.
- [ ] First load: 25:00, Focus, "Session 1 of 4", stats 0 / 0m, empty-chart message, tab title "25:00 – Focus"
- [ ] Start counts down; Pause holds the time (also after switching tabs and coming back)
- [ ] Focus ends → beep, short break auto-starts, "Sessions today" +1, today's bar grows
- [ ] After N focus sessions → long break; after long break → "Session 1 of N"
- [ ] Reset mid-focus → full time, stopped, nothing saved
- [ ] Settings: invalid values (0, empty, 121) show errors and highlight fields; nothing saved
- [ ] Settings while idle apply immediately; while running → "applies from the next session"
- [ ] Restore defaults → 25/5/15/4
- [ ] Daily (7 bars) / Weekly (8 bars) toggle; hover a bar for date, sessions, minutes
- [ ] Keyboard: Space = start/pause, R = reset; ignored while typing in a settings field
- [ ] Reload → sessions and settings persist
- [ ] DevTools → corrupt `pomodoro.v1.sessions` → page still loads with 0 stats, no errors
- [ ] Dark mode and ~360px width look correct

## Workflow
Implement one phase at a time and stop after each phase for review.
