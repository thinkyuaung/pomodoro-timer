/**
 * stats.js — pure calculations over saved sessions. No DOM, no storage access.
 *
 * Exposes one global: Stats
 *
 * Input: sessions = [{ date: "YYYY-MM-DD" (local), completedAt, durationMin }]
 * Every function that depends on "today" takes an optional `now` (Date) for testing.
 */
const Stats = (() => {
  // ---------- date helpers (local time) ----------

  /** Same format as AppStorage.toDateKey: "YYYY-MM-DD" in local time. */
  function toDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /** "YYYY-MM-DD" → local midnight Date. */
  function fromDateKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n); // calendar-safe across DST changes
    return d;
  }

  /** Monday of the week containing `date`, at local midnight. */
  function startOfWeek(date) {
    const d = startOfDay(date);
    const daysSinceMonday = (d.getDay() + 6) % 7; // Sun=0 → 6, Mon=1 → 0
    return addDays(d, -daysSinceMonday);
  }

  const fmtWeekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
  const fmtMonthDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  const fmtFull = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

  // ---------- aggregation ----------

  /** Map of dateKey → { minutes, count }. */
  function groupByDate(sessions) {
    const map = new Map();
    for (const s of sessions) {
      const entry = map.get(s.date) || { minutes: 0, count: 0 };
      entry.minutes += s.durationMin;
      entry.count += 1;
      map.set(s.date, entry);
    }
    return map;
  }

  // ---------- summary numbers ----------

  function sessionsToday(sessions, now = new Date()) {
    const today = toDateKey(now);
    return sessions.filter((s) => s.date === today).length;
  }

  function focusMinutesToday(sessions, now = new Date()) {
    const today = toDateKey(now);
    return sessions.reduce((sum, s) => (s.date === today ? sum + s.durationMin : sum), 0);
  }

  function totalFocusMinutes(sessions) {
    return sessions.reduce((sum, s) => sum + s.durationMin, 0);
  }

  /** 0 → "0m", 45 → "45m", 60 → "1h", 755 → "12h 35m". */
  function formatMinutes(totalMin) {
    const min = Math.round(totalMin);
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h === 0) return `${m}m`;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }

  // ---------- chart data (oldest → newest, zero-filled) ----------

  /**
   * @returns {Array<{ key, label, title, minutes, count, isCurrent }>}
   *   label: "Mon"; title: "Monday, Nov 3"
   */
  function dailyHistory(sessions, days = 7, now = new Date()) {
    const byDate = groupByDate(sessions);
    const today = startOfDay(now);
    const result = [];

    for (let i = days - 1; i >= 0; i--) {
      const day = addDays(today, -i);
      const key = toDateKey(day);
      const { minutes, count } = byDate.get(key) || { minutes: 0, count: 0 };
      result.push({
        key,
        label: fmtWeekday.format(day),
        title: fmtFull.format(day),
        minutes,
        count,
        isCurrent: i === 0,
      });
    }
    return result;
  }

  /**
   * Weeks start on Monday.
   * @returns {Array<{ key, label, title, minutes, count, isCurrent }>}
   *   key: Monday's date key; label: "Oct 27"; title: "Week of Oct 27"
   */
  function weeklyHistory(sessions, weeks = 8, now = new Date()) {
    const thisWeek = startOfWeek(now);
    const buckets = new Map();
    const result = [];

    for (let i = weeks - 1; i >= 0; i--) {
      const monday = addDays(thisWeek, -7 * i);
      const key = toDateKey(monday);
      const bucket = {
        key,
        label: fmtMonthDay.format(monday),
        title: `Week of ${fmtMonthDay.format(monday)}`,
        minutes: 0,
        count: 0,
        isCurrent: i === 0,
      };
      buckets.set(key, bucket);
      result.push(bucket);
    }

    for (const s of sessions) {
      const bucket = buckets.get(toDateKey(startOfWeek(fromDateKey(s.date))));
      if (bucket) {
        bucket.minutes += s.durationMin;
        bucket.count += 1;
      }
    }
    return result;
  }

  return Object.freeze({
    toDateKey,
    sessionsToday,
    focusMinutesToday,
    totalFocusMinutes,
    formatMinutes,
    dailyHistory,
    weeklyHistory,
  });
})();
