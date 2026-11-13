---
paths:
  - "js/timer.js"
  - "js/app.js"
---

# Timer rules

## Behaviour
- Start, pause, reset (button, Space = start/pause, R = reset; keys ignored while typing in a field)
- Auto switch: focus (25 min) → short break (5 min); long break (15 min) after every 4 focus sessions
- The timer switches to the next session automatically but **never auto-starts** it: when focus ends the break
  is loaded and waits for Start; when a break ends the next focus is loaded and waits for Start
- Reset mid-session → full length, stopped; a reset focus session is not saved
- Durations changed while the timer runs apply from the next session; when idle they apply immediately
  (`timer.updateSettings` returns `true` when applied now)

## Implementation
- Accuracy: remaining time is computed from an `endTime` timestamp, never by counting ticks
  (background tabs throttle intervals; the timer must not drift)
- `Timer.create(settings, { onTick, onModeChange, onFocusComplete }, clock)`; the `clock` parameter
  (`now`, `setInterval`, `clearInterval`) exists so tests can fake time — keep it
- `onFocusComplete(durationMin)` receives the length the session actually ran with, not a pending setting,
  and fires BEFORE `onModeChange`
- `timer.js` has no DOM and no storage access; `app.js` renders and saves

## Known behaviour
- The timer itself is not persisted: reloading the timer tab mid-focus shows an idle timer while site blocking
  continues until that session's original end time (the background alarm ends it)
