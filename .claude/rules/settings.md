---
paths:
  - "js/storage.js"
  - "js/app.js"
  - "js/theme.js"
  - "index.html"
---

# Settings rules

## The settings card
- A **drop-down card** opened by the ⚙ button (top right): native `<details class="settings-menu">` (⚙ is its
  `<summary>`) holding `<section class="settings-card">`. Closes on ⚙, ✕, Esc (focus returns to ⚙) or a click outside
- Rows are `<details class="setting-row" name="settings">` — an exclusive accordion (one open at a time), all
  closed on load, each with a one-line summary that always describes the **saved** settings:
  `#durationsSummary`, `#blockingSummary`, `#gardenSummary`, `#appearanceSummary`, `#dataSummary`
- Row order: Timer durations · Site blocking · Garden · Appearance · Data
  - **Timer durations** — focus / short / long validated 1–120 min; "long break after N sessions" 1–12
  - **Site blocking** — mode + site lists (details in the extension rules)
  - **Garden** — switch, flower picker, unlock (details in the garden rules)
  - **Appearance** — theme `System` (default, follows the OS live) | `Light` | `Dark`, stored as `settings.theme`;
    applies to the timer AND the blocked page
  - **Data** — "Clear focus history" and "Reset garden"; each asks for confirmation; neither deletes the other's data

## Save vs apply-immediately
- Durations and site blocking use the footer **Save**; **Restore defaults** resets them (and theme → System)
- Garden and Appearance **apply and save immediately** on change (no Save) and must NOT write or reset unsaved
  edits in other rows: save the SAVED settings plus the one changed field, not the form
- `readForm()` must include every settings field (incl. `theme`), or Save silently resets it to its default
- Saved/restored settings go through `applySettings()` (form, summaries, timer, blocking, theme in one place)

## Validation and storage
- All validation lives in `AppStorage.validateSettings`; nothing is written if any field is invalid
- One-of fields (`blockMode`, `theme`) share one validation loop: missing → default, unknown → error
- `getSettings()` merges defaults, so old saved settings without newer fields still load
- A failed Save opens the settings card AND the row containing the first invalid field, and focuses it
- Every `localStorage` read/write is wrapped in `try/catch` and falls back to defaults
