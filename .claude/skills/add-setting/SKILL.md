---
name: add-setting
description: Step-by-step guide for adding or changing a user setting in the Pomodoro timer's ⚙ settings card — storage validation, defaults, the settings row and form field, summaries, Save vs apply-immediately, and the tests to update. Use when adding a new option, toggle, number, choice or settings row, or changing how an existing setting is saved or validated.
---

# Add a setting

Read `.claude/rules/settings.md` first. Decide up front:
- **Save or immediate?** Durations / site blocking use the footer Save. Visual or reward choices (theme, garden)
  apply and save immediately on change.
- **Which row?** An existing row, or a new `<details class="setting-row" name="settings">` row.

## 1. Storage — `js/storage.js`
1. Add the field to the settings shape comment at the top of the file.
2. Add the default to `DEFAULTS` and a human label to `LABELS`.
3. Validate it in `validateSettings`:
   - number → add `[min, max]` to `LIMITS`. It then appears in `app.js` `NUMBER_FIELDS` automatically, and
     `NUMBER_FIELDS` is ALSO used as "the timer durations" by `durationsChanged()` (the "New durations apply from
     the next session" message). For a number that is NOT a duration (e.g. volume), first split that out:
     a `DURATION_FIELDS` list for `durationsChanged()`, `NUMBER_FIELDS` only for fill/read/validation
   - one of a list → add a frozen list constant (like `THEMES`) and add `['field', LIST]` to the existing
     one-of loop; export the list if `app.js` or `theme.js` needs it
   - missing → default (old saved settings must still load); unknown → `fail(...)`
4. `getSettings()` already merges `DEFAULTS`; do not write migrations for a new field.

## 2. Markup — `index.html`
- Field inside its row's `.row-body`; reuse existing patterns: `.field` (number/textarea), `.segmented` radio
  group (one-of), `.switch` (on/off)
- `name="<field>"` must equal the settings key; a new row also gets an icon, `.row-title` and
  `<span id="<row>Summary" class="row-summary">`

## 3. Wiring — `js/app.js`
1. `els`: add any new element (summary span, button).
2. `ALL_FIELDS`: add the field (radio groups are skipped by `markInvalid`, but keep the list complete).
3. `fillForm(settings)`: set the field from saved settings.
4. `readForm()`: read it. **Every settings field must be here**, or Save silently resets it to the default.
5. `renderSettingSummaries()`: summary text for the saved value (use `plural()` for counts).
6. Make it take effect: through `applySettings()` (Save / Restore defaults path). For apply-immediately, add an
   `on<Field>Change` handler modelled on `onThemeChange`: save `{ ...currentSettings, field }` (NOT the form,
   so unsaved edits in other rows survive), update `currentSettings`, apply, re-render the summary; branch on
   `event.target.name` in the form's `change` listener.

## 4. Tests
- `tests/unit.mjs` (storage block): default, valid value saved, invalid rejected with `invalidFields`, old saved
  settings without the field still load, tampered value falls back
- `tests/e2e-page.mjs`: the user flow (change → effect → reload persists → Restore defaults); for apply-immediately
  also "unsaved edits in other rows are kept" and "Save keeps it"
- **A new row changes the row-count checks** (`[false,false,false,false,false]` → one more `false`, three places)

## 5. Docs and verify
- Update `.claude/rules/settings.md` (row list, Save vs immediate) and the settings section of
  `.claude/skills/verify/checklist.md`
- Run the `verify` skill
