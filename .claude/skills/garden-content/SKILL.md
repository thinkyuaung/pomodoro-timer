---
name: garden-content
description: Step-by-step guide for adding or changing Sakura Garden content in the Pomodoro timer — a new flower (catalog, colors, unlock cost), a growth stage, or a smart coach message — including the CSS tokens, SVG sprite and tests to update. Use when adding/renaming a flower, changing petal costs or stage thresholds, or adding/rewording a garden message.
---

# Change garden content

Read `.claude/rules/garden.md` first. Garden logic stays pure in `js/garden.js`; `app.js` only renders and saves.

## Add a flower
1. `js/garden.js` → `CATALOG`: `Object.freeze({ id, name, cost })` in unlock order (cost ascending).
   `id` is lowercase letters only, ≤ 20 chars (storage's `FLOWER_ID_RE`); never rename an existing id
   (saved gardens reference it).
2. `css/style.css` → light `:root`: `--flower-<id>`, `--flower-<id>-edge`, `--flower-<id>-center`.
   Dark block `:root[data-theme="dark"]`: the same three tokens tuned for the dark background (design rule:
   every color in both places).
3. `css/style.css` → one class next to the others:
   `.flower-<id> { --flower: var(--flower-<id>); --flower-edge: var(--flower-<id>-edge); --flower-center: var(--flower-<id>-center); }`
4. Nothing else in `app.js`/`index.html`: the picker and unlock button are built from `CATALOG`.
5. Tests: unit `catalog costs ...` check; e2e picker string
   (`sakura,tulip*,sunflower-,lotus-,moonflower-`) and any "next unlock" text that changes.
6. Look at the new flower in Light and Dark (picker, soil strip, live plant).

## Change a growth stage or threshold
- `STAGES` in `garden.js` (`{ id, from }`, ascending `from`, last is `bloom` at 1)
- A new stage id also needs a sprite `<symbol id="plant-<id>" viewBox="0 0 40 48">` in `index.html` built from the
  `p-soil` / `p-stem` / `p-leaf` / `p-petal` / `p-center` classes (colors come from variables, no literals),
  and a `STAGE_TEXT` entry
- Tests: unit `stage thresholds` check; e2e garden section skips (`skip(seconds)`) are computed from a
  25-min session — recompute them (20 % = 300 s, 45 % = 675 s, 70 % = 1050 s)

## Add or reword a message
1. `Garden.message(event, ctx)`: add a `case` returning `{ text, icon }` (icon = a sprite stage id).
   Text uses the user's numbers from `ctx`, never random quotes; never claim a bloom/petals not saved.
2. New `ctx` fields come from `messageContext()` in `app.js`; call `coach('<event>')` only on events
   (never from every tick).
3. Tests: a unit check for the exact text; e2e checks that assert `#coachText` for that flow.

## Rules that must keep holding
- Only focus sessions ≥ `Garden.MIN_FOCUS_MINUTES` (25) affect the garden — every new garden touchpoint in
  `app.js` goes through `gardenGrows(state)`
- `garden.js` functions return a new garden, never mutate; `app.js` changes it only via
  `updateGarden((latest) => …)` (re-read → change → save), never by saving its in-memory copy
- Run the `verify` skill
