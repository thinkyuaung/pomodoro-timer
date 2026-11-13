---
paths:
  - "js/stats.js"
  - "js/app.js"
---

# Stats rules

## Data
- Each completed focus session is saved as `{ date: "YYYY-MM-DD" (local), completedAt: ISO string, durationMin }`
  under `pomodoro.v1.sessions`
- Only focus sessions that run to completion are saved (reset = nothing saved). Every completed focus session
  counts for stats, whatever its length (the garden has its own 25-min minimum — see garden rules)
- Corrupt entries are skipped on read; corrupt JSON → empty history, never an error

## Calculations (`stats.js`)
- Pure functions over the sessions array; no DOM, never reads or writes storage
- Dates use the user's local time zone; **weeks start on Monday**; day ranges stay correct across DST
  (`setDate`, not adding 24 h)
- Date keys come only from `AppStorage.toDateKey`
- Every function that depends on "today" takes an optional `now` (Date) for testing

## Display
- Tiles: sessions today, total focus time (`formatMinutes`: "45m", "1h", "12h 35m")
- History: Daily = last 7 days, Weekly = last 8 weeks, oldest → newest, zero-filled, current bar highlighted
- Bars are plain `<div>`s sized by the `--h` custom property; no canvas, no chart libraries
- Hover title: date, sessions, minutes; the chart has an `aria-label` summary
- "Today" figures refresh on mode change and when the tab becomes visible again (e.g. next morning)
