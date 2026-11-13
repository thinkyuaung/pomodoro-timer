---
paths:
  - "js/garden.js"
  - "js/app.js"
  - "index.html"
  - "css/style.css"
---

# Sakura Garden rules (reward system, original design)

## What counts
- **Only focus sessions of at least 25 min (`Garden.MIN_FOCUS_MINUTES`) affect the garden.** Shorter focus
  (e.g. 1 min) never grows, blooms, earns petals or wilts; the plant stays a seed and the coach says
  "N-min focus won't grow the garden — plants need 25+ min." The session itself is still saved for stats
- The length checked is the loaded/running session's (`durationMs`), never a pending settings edit.
  In `app.js` every garden touchpoint goes through `gardenGrows(state)` → `Garden.affectsGarden(mode, minutes)`
- Breaks never count. Garden switched off → nothing is recorded

## Growth, bloom, wilt, petals
- While focus runs the plant grows by share of the session done:
  seed 0 % → sprout 20 % → leaves 45 % → bud 70 % → bloom 100 %
- Completed focus → a **bloom** of the selected flower + **1 petal per whole focus minute**
- **Pause never wilts.** Reset after ≥ 1 min of focus → a **wilted** plant (no petals); reset in the first minute → nothing
- Petals are spent to unlock flowers: Sakura (free) · Tulip 100 · Sunflower 250 · Lotus 500 · Moonflower 1000;
  unlocking selects the flower; the selected flower grows next

## Smart messages (`#coach` line under Start/Reset)
- Built from the user's own numbers (blooms today vs yesterday, petals to the next unlock), never random quotes
- Change only on events (start, new stage, pause, reset, complete, break, settings change), never every tick
- Never claim a bloom or petals that were not saved ("Bloom saved" only when one was)
- Text lives in `Garden.message(event, ctx)` (pure, unit-tested); `app.js` only picks the event

## View and settings
- Stats card **Garden** toggle (next to Daily/Weekly): petal count, the live plant ("Sakura · bud · 4 min to
  bloom"), the last 7 days of plants on a soil strip (newest on the right), "N blooms · M wilted" summary
- The garden view fills the same area as the chart; below 860px it becomes a compact strip (no page scroll)
- Settings → Garden: "Show garden and messages" switch, flower picker (built once, updated in place so keyboard
  focus survives), unlock button (disabled until affordable). Applies immediately, no Save
- Switch off → coach line and Garden toggle hidden (the app looks as before the garden)

## Code
- `garden.js` is pure (no DOM, no storage). Its functions never mutate a garden; they return a new object.
  `app.js` changes the garden ONLY via `updateGarden((latest) => Garden.<change>(latest, …))`: it re-reads the
  saved garden, applies the change, saves and re-renders. Never save the in-memory `garden` directly — another
  timer tab may have saved blooms/petals since (two-tab e2e check). Read-then-decide code calls `reloadGarden()`
  first; returning to the tab reloads too. Only Reset garden replaces everything on purpose
- Storage checks only the shape; which flowers exist is `Garden.CATALOG`. Unknown flower ids (from a newer
  version) are kept, shown as Sakura
- Stored as `pomodoro.v1.garden`: `{ enabled, petals, unlocked[], selected, plants: [{ date, type,
  state: 'bloom' | 'wilted', minutes }] }`; at most 500 plants (oldest dropped, petals kept)
- Plants are one inline SVG **sprite** in `index.html` (`<symbol id="plant-seed|sprout|leaves|bud|bloom|wilted">`)
  reused with `<use>`; colors come from `--flower`, `--flower-edge`, `--flower-center`, `--leaf`, … set by the
  `.flower-<id>` / `.is-wilted` classes. `app.js` draws plants only via `createPlant()` / `setPlant()`
