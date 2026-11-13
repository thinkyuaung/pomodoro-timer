# Pomodoro Timer with Stats

A browser-based Pomodoro timer that records completed focus sessions, shows usage stats, rewards focus with
a growing **Sakura Garden** plus smart messages, and (when installed as a Chrome/Edge extension) blocks
distracting websites during focus sessions.

## Stack
- HTML5, CSS3, vanilla JavaScript (ES2015+) only
- Optional Chrome/Edge Manifest V3 extension wrapper (same files, loaded unpacked) for site blocking

## Rules (every file)
- No React, Vue, Angular, or any other framework
- No backend — everything runs in the browser; data persists in `localStorage`
- No external libraries, CDNs, or npm packages (no build step, no `package.json`)
- All storage code lives in `js/storage.js` — no other file may call `localStorage` directly; every
  read/write is wrapped in `try/catch` and falls back to defaults
- Only `js/app.js` (timer page) and `js/blocked.js` (blocked page) touch the DOM; `timer.js`, `stats.js`,
  `garden.js` and `blocker.js` have no DOM access. Single exception: `js/theme.js` sets ONLY `<html data-theme>`
- `chrome.*` extension APIs are used only in `js/blocker.js` (page side) and `js/background.js` (service worker)
- The app must keep working as a plain page opened from `file://`; blocking is then simply unavailable
- No inline scripts or `onclick` attributes (extension pages forbid them via CSP)

## Area rules and skills
Rules in `.claude/rules/` load automatically: `naming.md` always; the others when a matching file is opened.
```
naming.md     names, code style, reuse                          (always)
timer.md      countdown, cycle, never auto-start                js/timer.js, js/app.js
stats.md      sessions data, dates, charts                      js/stats.js, js/app.js
settings.md   settings card, Save vs immediate, validation      js/storage.js, js/app.js, js/theme.js, index.html
garden.md     25-min minimum, growth, petals, messages          js/garden.js, js/app.js, index.html, css/style.css
extension.md  site blocking, background worker, blocked page    manifest.json, js/background.js, js/blocker.js, ...
design.md     theme (light/dark), colors, one screen, motion    css/**, *.html, js/theme.js
```
Skills in `.claude/skills/` are step-by-step guides, loaded when the task matches (or typed as `/<name>`):
```
/verify             3 test suites + rule checks (check-rules.mjs) + visual checks + manual checklist.md
/add-setting        add/change a setting: storage validation, row, form, summary, Save vs immediate, tests
/garden-content     add a flower, growth stage or coach message: catalog, CSS tokens, sprite, tests
/extension-testing  load/debug the extension, blocking rules + alarm, Edge e2e suite, new message types
```

## Structure
```
index.html        Markup only: pastel scene, plant SVG sprite, one-screen app; loads the scripts in order
blocked.html      "Blocked during focus" page (same pastel scene); loads storage.js + theme.js, blocker.js + blocked.js
manifest.json     Manifest V3 extension definition (permissions, background worker, toolbar action)
css/style.css     Theme tokens, pastel scene, glass cards, progress ring, plants/garden, settings drop-down, chart, blocked page
js/storage.js     AppStorage object: settings (incl. site lists, theme), session history and garden in localStorage
js/theme.js       Theme object: applies the saved theme as <html data-theme="light|dark"> before paint (every page)
js/timer.js       Timer object: countdown engine and focus/break mode switching
js/stats.js       Stats object: pure calculations over saved sessions (uses AppStorage.toDateKey)
js/garden.js      Garden object: pure garden rules (flowers, stages, petals, unlocks) + smart messages
js/blocker.js     SiteBlocker object: sends block/clear/open-timer messages to the extension background
js/background.js  Extension service worker: applies/removes blocking rules, finds/focuses the timer tab
js/blocked.js     Blocked page only: "Back to timer" switches to the running timer tab (link fallback)
js/app.js         Wires UI events to Timer/Storage/Stats/Garden/SiteBlocker and renders everything
tests/            Dev-only test scripts (never loaded by the app) — see Testing
.claude/rules/    Area rules (auto-loaded, see above)
.claude/skills/   Step-by-step task guides (loaded on demand)
```

## Script loading
- `storage.js` → `theme.js` load **without `defer` in `<head>`** on every page (theme set before paint);
  the rest load with `<script defer>` at the end of `<body>`: `timer.js` → `stats.js` → `garden.js` → `blocker.js` → `app.js`
- Each page-side file exposes exactly one global: `AppStorage`, `Theme`, `Timer`, `Stats`, `Garden`, `SiteBlocker`;
  `app.js`, `blocked.js` and `background.js` expose nothing

## Running
- **Timer only:** open `index.html` directly in a browser (works from `file://`). No install or server required.
- **With site blocking:** load the folder as an unpacked extension (steps in `.claude/rules/extension.md`).
  The extension and `file://` have separate `localStorage`, so stats/settings are not shared.

## Testing
Node 22+ built-ins only (no npm, no `package.json`); the e2e suites drive real browsers through the Chrome
DevTools protocol. Run all three from the project root before committing:
```
node tests/unit.mjs            # storage.js, stats.js, timer.js, garden.js in Node        ~1 s
node tests/e2e-page.mjs        # index.html via file:// in headless Chrome (or Edge)     ~1 min
node tests/e2e-extension.mjs   # loads the extension unpacked in headless Edge            ~2 min
```
- Each prints PASS/FAIL per check and exits non-zero on any failure; browsers are found automatically
  (override with `CHROME_PATH` / `EDGE_PATH`)
- Screenshots go to `tests/output/` (git-ignored); browser profiles are throw-away folders in the OS temp dir
- When behaviour changes, update the matching checks in the same commit

## Workflow
Implement one phase at a time and stop after each phase for review.
Before reporting a phase done or committing, run the `verify` skill (manual checklist: `.claude/skills/verify/checklist.md`).
