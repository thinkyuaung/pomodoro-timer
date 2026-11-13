---
name: verify
description: Verify a change to the Pomodoro timer before reporting it done or committing — runs the 3 test suites, the static rule checks, light/dark/System and no-scroll screenshots, and the matching parts of the manual checklist. Use after any code, CSS or HTML change, before a commit, or when asked to test, check or verify the app.
---

# Verify a change

Run every step from the project root. Report each result plainly: counts of passed/failed, and any FAIL with its output.
A failing check is either an app bug (fix the app) or a wrong expectation in the test (fix the test and say so) — find out which before changing anything.

## 1. Static rule checks (~1 s)
```
node .claude/skills/verify/check-rules.mjs
```
Checks: `localStorage` only in storage.js · DOM only in app.js / blocked.js (+ theme.js `data-theme`) ·
`chrome.*` only in blocker.js / background.js · no hard-coded colors outside the token blocks · no
`prefers-color-scheme` media query and exactly one dark block · every page loads storage.js + theme.js
un-deferred in `<head>` · no inline scripts / `on*` attributes.

## 2. Test suites (run all three before committing)
```
node tests/unit.mjs            # ~1 s
node tests/e2e-page.mjs        # ~1 min, headless Chrome on file://
node tests/e2e-extension.mjs   # ~2 min, headless Edge with the extension
```
- Redirect long output to a file in `tests/output/` (git-ignored) and grep `^FAIL`; delete the logs afterwards
- The extension suite needs Edge; one check waits ~60 s in real time for the end-of-session alarm
- If a check is flaky, find the race (fixed `sleep` vs. polling, network load) before re-running; never
  "fix" flakiness by retrying until green
- When behaviour changed on purpose, update the matching checks in the same commit (e.g. settings row counts
  `[false,false,false,false,false]` when a row is added)

## 3. Visual checks (UI changes only)
- Sizes: 1280×760, 1366×640, 390×844 — no page scroll
  (`document.documentElement.scrollHeight <= innerHeight`)
- Themes: Light, Dark, and System with the OS emulated light and dark
  (`Emulation.setEmulatedMedia({ features: [{ name: 'prefers-color-scheme', value }] })`); assert
  `document.documentElement.dataset.theme`
- Reduced motion: `prefers-reduced-motion: reduce` stops animations
- Use `tests/helpers.mjs` (`findBrowser`, `tempProfile`, `launchBrowser`) for one-off screenshot scripts; put
  those scripts in the session scratchpad, not in the repo, and look at every screenshot you take

## 4. Manual checklist
Run the sections of [checklist.md](checklist.md) that match the change (timer, settings/theme, garden, site
blocking); the whole list before a release.
