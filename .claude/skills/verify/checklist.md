# Manual test checklist

Run the parts that match what changed; run all of it before a release.

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
- [ ] All five rows start closed; opening one closes the other; chevron flips; keyboard Enter/Space toggles a row
- [ ] Row summaries match saved settings (e.g. "50 / 10 / 20 min · long break every 3", "Blocking 3 sites during focus")
      and do not change until Save
- [ ] Invalid value in a closed row → Save opens that row and focuses the field
- [ ] Data → Clear focus history: Cancel keeps everything; OK empties stats/chart and the summary says "0 focus sessions saved"
- [ ] No page scrollbar at desktop (1280×760), laptop (1366×640) and phone (390×844) sizes
- [ ] Progress ring fills violet → pink as the session runs
- [ ] Scene: blobs drift, sparkles twinkle, petals fall; dark theme is dusky violet; OS "reduce motion" freezes it
- [ ] Appearance → System follows the OS live (switch OS light/dark without reloading); Light stays light on a
      dark OS and Dark stays dark on a light OS; summary "Match system" / "Light" / "Dark"
- [ ] Changing the theme does not lose unsaved edits in other rows; Save keeps the theme; Restore defaults → System
- [ ] Reload → theme kept with no light→dark flash; the blocked page uses the same theme
- [ ] Glass cards stay readable over the pastel background in light and dark mode

Sakura Garden (Focus must be ≥ 25 min for the garden; DevTools `Date.now` skew or patience needed):
- [ ] Focus = 1 min → coach "1-min focus won't grow the garden — plants need 25+ min."; plant stays a seed;
      completing or resetting it changes nothing in the garden, but "Sessions today" still +1
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
