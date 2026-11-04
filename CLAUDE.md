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
index.html        Markup only: decorative sky scene + app cards; loads the scripts in order
blocked.html      Static "blocked during focus" page (same sky scene, no scripts)
manifest.json     Manifest V3 extension definition (permissions, background worker, toolbar action)
css/style.css     Theme tokens, sky scene art, glass cards, settings rows, CSS bar chart, blocked page
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
- Settings shown as browser-style expandable rows (one open at a time), each with a live one-line summary:
  - **Timer durations** — custom durations (validated 1–120 min) and "long break after N sessions" (1–12)
  - **Site blocking** — see below
  - **Data** — "Clear focus history" (asks for confirmation; cannot be undone)
  - Save / Restore defaults live in a footer below the rows; a failed save opens the row with the invalid field
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

## Design
- Theme: **anime blue sky** — sky gradient, sun glow, drifting clouds, layered hills, falling sakura petals;
  dark mode (`prefers-color-scheme: dark`) = starry night sky with a crescent moon
- All artwork is original CSS + inline SVG: **no images, web fonts, icon fonts or CDNs**; system fonts only
  (`Yu Gothic UI` / `Meiryo` cover the Japanese text)
- The scene is one `<div class="scene" aria-hidden="true">` fixed behind `.app` (`pointer-events: none`);
  `index.html` and `blocked.html` contain the same scene markup — keep them in sync
- Cards are frosted glass (`--glass` + `backdrop-filter`); accents: mode colors (focus blue, short cyan,
  long indigo) + sakura pink (`--sakura`) for badges, progress gradient and today's bar
- Colors are CSS custom properties on `:root`, redefined in the dark-mode media query — never hard-code colors in rules
- Animate only `transform`/`opacity`/`translate`; `prefers-reduced-motion: reduce` stops every animation
- Settings rows are native `<details class="setting-row" name="settings">` (exclusive accordion, no JS);
  row summaries (`#durationsSummary`, `#blockingSummary`, `#dataSummary`) always describe the **saved** settings
- Layout: card grid — header full width, timer + stats side by side ≥ 880px, settings full width; single column below

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

Settings rows and theme:
- [ ] All three rows start closed; opening one closes the other; chevron flips; keyboard Enter/Space toggles a row
- [ ] Row summaries match saved settings (e.g. "50 / 10 / 20 min · long break every 3", "Blocking 3 sites during focus")
      and do not change until Save
- [ ] Invalid value in a closed row → Save opens that row and focuses the field
- [ ] Data → Clear focus history: Cancel keeps everything; OK empties stats/chart and the summary says "0 focus sessions saved"
- [ ] Sky scene: clouds drift, petals fall; dark mode shows stars + moon; OS "reduce motion" freezes the scene
- [ ] Glass cards stay readable over the sky in light and dark mode

Site blocking (load the extension unpacked first; use `example.com` / `example.org` as test sites):
- [ ] Extension page: "install as extension" note hidden; toolbar icon opens/focuses the timer tab
- [ ] `file://` page: note shown, no blocking, no console errors
- [ ] Blocklist `example.com` + start focus → status "Blocking 1 site"; `example.com` and `sub.example.com` show
      the "Stay focused" page; `example.org` loads
- [ ] A tab already open on `example.com` switches to the blocked page when focus starts
- [ ] Pause → status disappears, `example.com` loads; resume → blocked again
- [ ] Focus ends → break: nothing blocked; next focus → blocked again; Reset → nothing blocked
- [ ] Allowlist `example.com` → `example.org` blocked; `example.com`, `docs.example.com` and the timer itself load
- [ ] Editing the site list or switching mode to Off mid-focus applies immediately
- [ ] "Back to timer" on the blocked page opens the timer and does NOT end blocking
- [ ] Close the timer tab mid-focus → still blocked until the session's end time, then unblocked
- [ ] Blocked page shows the sky scene and "集中しよう！ Stay focused" card in light and dark mode

Known behaviour: the timer itself is not persisted, so reloading the timer tab mid-focus shows an idle
timer while blocking continues until that session's original end time (the background alarm ends it).

## Workflow
Implement one phase at a time and stop after each phase for review.
