# Pomodoro Timer with Stats

A browser-based Pomodoro timer that records completed focus sessions, shows usage stats, rewards focus with
a growing **Sakura Garden** plus smart messages, and (when installed as a Chrome/Edge extension) blocks
distracting websites during focus sessions.

## Stack
- HTML5, CSS3, vanilla JavaScript (ES2015+) only
- Optional Chrome/Edge Manifest V3 extension wrapper (same files, loaded unpacked) for site blocking

## Rules
- No React, Vue, Angular, or any other framework
- No backend — everything runs in the browser; data persists in `localStorage`
- No external libraries, CDNs, or npm packages (no build step, no `package.json`)
- All storage code lives in `js/storage.js` — no other file may call `localStorage` directly
- Only `js/app.js` (timer page) and `js/blocked.js` (blocked page) touch the DOM; `timer.js`, `stats.js`,
  `garden.js` and `blocker.js` have no DOM access
- `chrome.*` extension APIs are used only in `js/blocker.js` (page side) and `js/background.js` (service worker)
- `js/background.js` keeps no persistent state: only session blocking rules + one `chrome.alarms` alarm
- The app must keep working as a plain page opened from `file://`; blocking is then simply unavailable
- No inline scripts or `onclick` attributes (extension pages forbid them via CSP)
- Use meaningful variable names
- Keep functions small and readable


## Structure
```
index.html        Markup only: pastel scene, plant SVG sprite, one-screen app; loads the scripts in order
blocked.html      "Blocked during focus" page (same pastel scene); loads only blocker.js + blocked.js
manifest.json     Manifest V3 extension definition (permissions, background worker, toolbar action)
css/style.css     Theme tokens, pastel scene, glass cards, progress ring, plants/garden, settings drop-down, chart, blocked page
js/storage.js     AppStorage object: settings (incl. site lists), session history and garden in localStorage
js/timer.js       Timer object: countdown engine and focus/break mode switching
js/stats.js       Stats object: pure calculations over saved sessions (uses AppStorage.toDateKey)
js/garden.js      Garden object: pure garden rules (flowers, stages, petals, unlocks) + smart messages
js/blocker.js     SiteBlocker object: sends block/clear/open-timer messages to the extension background
js/background.js  Extension service worker: applies/removes blocking rules, finds/focuses the timer tab
js/blocked.js     Blocked page only: "Back to timer" switches to the running timer tab (link fallback)
js/app.js         Wires UI events to Timer/Storage/Stats/Garden/SiteBlocker and renders everything
tests/            Dev-only test scripts (never loaded by the app) — see Testing
```

## Features
- Start, pause, reset
- Auto switch: focus (25 min) → short break (5 min); long break (15 min) after every 4 focus sessions
  - The timer switches to the next session automatically, but **never auto-starts** it: when focus ends the
    break is loaded and waits for Start; when a break ends the next focus is loaded and waits for Start
- Save each completed focus session: `{ date: "YYYY-MM-DD" (local), completedAt: ISO string, durationMin }`
- Stats: sessions today, total focus time, daily (last 7 days) and weekly (last 8 weeks) history as CSS bars
- Settings live in a **drop-down card** opened by the ⚙ button (top right); it closes on ⚙, ✕, Esc
  (focus returns to ⚙) or a click outside. Inside are browser-style expandable rows (one open at a time),
  each with a live one-line summary:
  - **Timer durations** — custom durations (validated 1–120 min) and "long break after N sessions" (1–12)
  - **Site blocking** — see below
  - **Garden** — "Show garden and messages" switch, flower picker, unlock button (applies immediately, no Save)
  - **Data** — "Clear focus history" and "Reset garden" (each asks for confirmation; neither deletes the other's data)
  - Save / Restore defaults live in a footer below the rows; a failed save opens the card and the row with the invalid field
- Site blocking settings (extension only):
  - Mode: `off` (default) | `blocklist` (block only disallowed sites) | `allowlist` (block every site except allowed ones)
  - Lists: one site per line; input like `https://www.youtube.com/watch` is normalized to `youtube.com`;
    a domain also covers its subdomains; max 100 per list; allowlist mode requires at least one site
  - Active **only while a focus session is running** — paused, idle and breaks are unblocked
  - Changes to site settings apply immediately (durations still apply from the next session)
  - Rules end automatically at the focus session's end time, even if the timer tab is closed
  - Blocked page "Back to timer" returns to the running timer tab (most recently used one) and closes the
    blocked tab; if no timer tab is open, the blocked tab becomes the timer
- Sakura Garden (reward system, original design):
  - While focus runs the plant grows by share of the session done: seed 0 % → sprout 20 % → leaves 45 % →
    bud 70 % → bloom 100 %. Breaks grow nothing
  - Completed focus → a **bloom** of the selected flower + **1 petal per focus minute**
  - **Pause never wilts.** Reset after ≥ 1 min of focus → a **wilted** plant (no petals); reset in the first minute → nothing
  - Petals are spent to unlock flowers: Sakura (free) · Tulip 100 · Sunflower 250 · Lotus 500 · Moonflower 1000;
    the selected flower grows next
  - Stats card **Garden** toggle (next to Daily/Weekly): petal count, the live plant with "Sakura · bud · 4 min
    to bloom", and the last 7 days of plants on a soil strip (newest on the right)
  - **Smart messages** (`#coach` line under Start/Reset) come from the user's own numbers, never random quotes,
    and change only on events (start, new stage, pause, reset, complete, break), never every tick
  - Switch off → coach line and Garden toggle hidden (the app looks as before the garden) and nothing is recorded
  - Stored as `pomodoro.v1.garden`: `{ enabled, petals, unlocked[], selected, plants: [{ date, type,
    state: 'bloom' | 'wilted', minutes }] }`; at most 500 plants (oldest dropped, petals kept)

## Conventions
- Scripts load with `<script defer>` in dependency order:
  `storage.js` → `timer.js` → `stats.js` → `garden.js` → `blocker.js` → `app.js`
- Each page-side JS file exposes exactly one global object: `AppStorage`, `Timer`, `Stats`, `Garden`, `SiteBlocker`;
  `app.js`, `blocked.js` and `background.js` expose nothing
  (not `Storage` — that name is the browser's built-in `window.Storage` interface)
- Timer accuracy: compute remaining time from an `endTime` timestamp, never by counting ticks
- Wrap every `localStorage` read/write in `try/catch` and fall back to defaults
- Only focus sessions that run to completion are saved (reset = nothing saved)
- `garden.js` functions never mutate a garden: they return a new object; `app.js` saves it via `storeGarden()`
  (`AppStorage.saveGarden` + re-render). Storage checks only the shape; which flowers exist is `Garden.CATALOG`
- Dates use the user's local time zone; weeks start on Monday
- Charts: plain `<div>` bars sized via a CSS custom property (`--h`); no canvas libraries
- Use `const`/`let`, `===`, small named functions; no inline `onclick` attributes in HTML
- Accessibility: real `<button>` elements, visible focus styles, `aria-live` on the time display

## Design
- Theme: **soft pastel dreamy** — lavender → pink → baby-blue gradient, large blurred drifting light blobs,
  twinkling four-point sparkles, a few falling sakura petals; dark mode (`prefers-color-scheme: dark`) = dusky violet
- **One screen, no page scroll:** `body { overflow: hidden }`, `.app` is `100dvh` (top bar + `.stage`);
  timer and stats side by side, stacked below 860px; sizes use `clamp()`/`vh` so it fits from phone to desktop.
  Only windows shorter than 560px fall back to page scrolling. The settings card scrolls inside itself if needed
- Timer is a **progress ring**: `#progressBar.ring-progress` is a conic-gradient masked into a ring, driven by the
  `--p` percentage that `app.js` sets; ring size is the `--ring` custom property on `.timer`
- Settings drop-down is native `<details class="settings-menu">` (⚙ = its `<summary>`) holding
  `<section class="settings-card">`; rows are `<details class="setting-row" name="settings">` (exclusive accordion);
  row summaries (`#durationsSummary`, `#blockingSummary`, `#gardenSummary`, `#dataSummary`) always describe the **saved** settings
- Plants are one inline SVG **sprite** in `index.html` (`<symbol id="plant-seed|sprout|leaves|bud|bloom|wilted">`)
  reused with `<use>`; flower colors come from variables (`--flower`, `--flower-edge`, `--flower-center`, `--leaf`, …)
  set by the `.flower-<id>` / `.is-wilted` classes. `app.js` draws plants only via `createPlant()` / `setPlant()`
- The garden view fills the same area as the chart; below 860px it becomes a compact strip so the page never scrolls
- All artwork is original CSS + inline SVG: **no images, web fonts, icon fonts or CDNs**; rounded system fonts only
  (`ui-rounded` / `Segoe UI Variable Display`; `Yu Gothic UI` / `Meiryo` for Japanese)
- The scene is one `<div class="scene" aria-hidden="true">` fixed behind `.app` (`pointer-events: none`);
  `index.html` and `blocked.html` contain the same scene markup — keep them in sync
- Cards are frosted glass (`--glass`, `--glass-strong` + `backdrop-filter`); accents: violet `--primary`,
  sakura pink `--sakura`; mode colors focus lavender / short mint / long sky; buttons use a violet → pink gradient
- Colors are CSS custom properties on `:root`, redefined in the dark-mode media query — never hard-code colors in rules.
  This includes glows, tints and gradients (`--gradient-brand`, `--gradient-text`, `--icon-tint`, `--btn-glow`, …);
  the only literal allowed outside `:root` is `black` in the progress-ring `mask` (alpha, not a visible color)
- Reuse instead of copying: gradient headings/numbers use the `.gradient-text` class; violet → pink fills use
  `var(--gradient-brand)`; one date-key helper (`AppStorage.toDateKey`); one `plural()` and one
  `blockingPhrase()` in `app.js`; saved/restored settings go through `applySettings()`
- Animate only `transform`/`opacity`; `prefers-reduced-motion: reduce` stops every animation and hides petals

## Running
- **Timer only:** open `index.html` directly in a browser (works from `file://`). No install or server required.
- **With site blocking (Chrome/Edge):** `chrome://extensions` (or `edge://extensions`) → enable Developer mode →
  Load unpacked → select this project folder → click the extension's toolbar icon to open the timer.
  After editing files, press the reload button on the extension card.
- The two ways of running have **separate** `localStorage` (different origins), so stats/settings are not shared.

## Testing
Automated tests use **Node 22+ built-ins only** (no npm, no `package.json`) and drive real browsers through the
Chrome DevTools protocol. Run from the project root:
```
node tests/unit.mjs            # storage.js, stats.js, timer.js, garden.js in Node        ~1 s
node tests/e2e-page.mjs        # index.html via file:// in headless Chrome (or Edge)     ~30 s
node tests/e2e-extension.mjs   # loads the extension unpacked in headless Edge            ~2 min
```
- Each prints PASS/FAIL per check and exits non-zero on any failure; run all three before committing
- Browsers are found automatically; override with `CHROME_PATH` / `EDGE_PATH`
- The extension suite needs **Edge** (current Chrome ignores `--load-extension`) and includes one real-time
  (~60 s) alarm check; it skips the "Back to timer" checks if that button is commented out in `blocked.html`
- Screenshots go to `tests/output/` (git-ignored); browser profiles are throw-away folders in the OS temp dir
- When behaviour changes, update the matching checks in the same commit

## Manual test checklist
Tip: set Focus/Short = 1 min, Long = 2, "Long break after" = 2 in Settings for a fast cycle.
- [ ] First load: 25:00, Focus, "Session 1 of 4", stats 0 / 0m, empty-chart message, tab title "25:00 – Focus"
- [ ] Start counts down; Pause holds the time (also after switching tabs and coming back)
- [ ] Focus ends → beep, Short Break shown at full time but stopped (button says Start), "Sessions today" +1,
      today's bar grows; pressing Start runs the break; when the break ends, Focus is shown at full time but
      stopped (button says Start) and site blocking stays off until Start
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
- [ ] ⚙ opens the settings card (gear turns violet); ✕, Esc (focus back on ⚙) and a click outside close it
- [ ] All four rows start closed; opening one closes the other; chevron flips; keyboard Enter/Space toggles a row
- [ ] Row summaries match saved settings (e.g. "50 / 10 / 20 min · long break every 3", "Blocking 3 sites during focus")
      and do not change until Save
- [ ] Invalid value in a closed row → Save opens that row and focuses the field
- [ ] Data → Clear focus history: Cancel keeps everything; OK empties stats/chart and the summary says "0 focus sessions saved"
- [ ] No page scrollbar at desktop (1280×760), laptop (1366×640) and phone (390×844) sizes
- [ ] Progress ring fills violet → pink as the session runs
- [ ] Scene: blobs drift, sparkles twinkle, petals fall; dark mode is dusky violet; OS "reduce motion" freezes it
- [ ] Glass cards stay readable over the pastel background in light and dark mode

Sakura Garden (tip: Focus = 5 min makes each stage ~1 min):
- [ ] Load → coach says "First bloom of the day starts here — plant a Sakura."
- [ ] Start → "Seed planted"; the Garden view's plant sways and becomes sprout → leaves → bud as time passes,
      each with its own message (once, not every second)
- [ ] Pause → "Paused — your plant will wait for you", stage kept; resume → stage message again
- [ ] Reset after 1+ min → "That one wilted…", a wilted plant appears in the row, petals unchanged;
      reset in the first minute → nothing added
- [ ] Focus completes → "+N petals" message, petal count +N, a bloom appears on the right of the row;
      start the break → "Bloom saved. Rest your eyes…"; break ends → "Break over — a new … seed is ready."
- [ ] Hover a plant → "Today · Sakura · bloom · 25 min"; summary line "N blooms · M wilted this week"
- [ ] Settings → Garden: locked flowers greyed; unlock button disabled until enough petals; unlocking spends
      petals, selects the flower and the coach/plant use its color
- [ ] Switch off → coach line and Garden toggle disappear (Daily chart shown), sessions grow nothing; switch on → back
- [ ] Data → Reset garden: Cancel keeps it; OK empties garden but not focus history (and vice versa for Clear focus history)
- [ ] Garden view fits one screen at 1280×760, 1366×640 and 390×844 even with many plants

Site blocking (load the extension unpacked first; use `example.com` / `example.org` as test sites):
- [ ] Extension page: "install as extension" note hidden; toolbar icon opens/focuses the timer tab
- [ ] `file://` page: note shown, no blocking, no console errors
- [ ] Blocklist `example.com` + start focus → status "Blocking 1 site"; `example.com` and `sub.example.com` show
      the "Stay focused" page; `example.org` loads
- [ ] A tab already open on `example.com` switches to the blocked page when focus starts
- [ ] Pause → status disappears, `example.com` loads; resume → blocked again
- [ ] Focus ends → break: nothing blocked; break ends → focus waiting: nothing blocked; press Start → blocked
      again; Reset → nothing blocked
- [ ] Allowlist `example.com` → `example.org` blocked; `example.com`, `docs.example.com` and the timer itself load
- [ ] Editing the site list or switching mode to Off mid-focus applies immediately
- [ ] "Back to timer" on the blocked page switches to the **already running** timer tab (countdown continues),
      closes the blocked tab, does NOT open a second timer and does NOT end blocking
- [ ] With no timer tab open, "Back to timer" turns the blocked tab itself into the timer
- [ ] Close the timer tab mid-focus → still blocked until the session's end time, then unblocked
- [ ] Blocked page shows the pastel scene and "集中しよう！ Stay focused" card in light and dark mode

Known behaviour: the timer itself is not persisted, so reloading the timer tab mid-focus shows an idle
timer while blocking continues until that session's original end time (the background alarm ends it).

## Workflow
Implement one phase at a time and stop after each phase for review.
