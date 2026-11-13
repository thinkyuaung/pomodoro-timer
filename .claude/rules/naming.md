# Naming, code style and reuse (always loaded)

## Names
- Use meaningful variable names; no single letters except tiny callbacks (`(p) => p.date`) and loop indexes
- Keep functions small and readable: one job each, named after that job
- **Files:** lowercase, one word, `.js` / `.mjs` (`garden.js`, `e2e-page.mjs`)
- **Globals:** each page-side file exposes ONE PascalCase object named after its job: `AppStorage`, `Theme`,
  `Timer`, `Stats`, `Garden`, `SiteBlocker` (never `Storage` — that is the browser's built-in `window.Storage`)
- **Functions** (camelCase, verb first), by prefix:
  - `render…` writes to the DOM (`renderTimer`, `renderGarden`) — only in `app.js` / `blocked.js`
  - `on…` is an event handler (`onThemeChange`, `onResetGarden`)
  - `create…` builds and returns a new DOM node (`createPlant`, `createFlowerOption`)
  - `get…` / `save…` / `reset…` / `clear…` / `add…` are storage operations (`AppStorage` only)
  - `record…`, `unlock`, `select` return a NEW garden (`Garden`, never mutate)
  - `is…` / `can…` / `should…` / `affects…` return booleans
- **Constants:** `UPPER_SNAKE_CASE` for fixed values and lookup tables (`MIN_FOCUS_MINUTES`, `MODE_NAMES`);
  regexes end in `_RE` (`DOMAIN_RE`); frozen with `Object.freeze` when exported
- **Units in names** when not obvious: `remainingMs`, `durationMin`, `WILT_AFTER_MS`, `sessionMinutes`
- **Storage keys:** `pomodoro.v1.<name>` (`settings`, `sessions`, `garden`); bump `v1` only with a migration
- **HTML ids:** camelCase when JS uses them (`startPause`, `gardenRow`, `appearanceSummary`). Two kebab-case
  exceptions: heading ids for `aria-labelledby` end in `-heading` (`timer-heading`); SVG sprite symbols are
  `plant-<stage>` / `icon-<name>`. Settings row summaries are `#<row>Summary`
- **CSS classes:** kebab-case (`setting-row`, `garden-bed`); state classes start with `is-` (`is-growing`,
  `is-wilted`, `is-locked`, `is-current`, `is-success`); variants are `<thing>-<variant>` (`btn-primary`, `flower-tulip`)
- **CSS custom properties:** kebab-case tokens named by role, not by color (`--primary`, `--glass-strong`,
  `--btn-glow`, `--flower-<id>-edge`)
- **Data attributes:** `data-<noun>` holding a value JS reads (`data-mode`, `data-range`, `data-for-mode`, `data-theme`)
- **Test labels:** `area: what is checked` in plain words (`garden: reset after 1 min wilts (no petals)`)

## Code style
- `const`/`let` (never `var`), `===`, small named functions, early returns
- No inline `onclick` attributes or inline `<script>` (extension pages forbid them via CSP)

## Reuse instead of copying
- One date-key helper: `AppStorage.toDateKey` (stats.js and garden.js reuse it)
- In `app.js`: one `plural()`, one `blockingPhrase()`; saved/restored settings always go through `applySettings()`;
  plants are drawn only via `createPlant()` / `setPlant()`
- Gradient headings/numbers use the `.gradient-text` class; violet → pink fills use `var(--gradient-brand)`
- Before writing a helper, search for an existing one; if two places need it, move it, don't copy it
