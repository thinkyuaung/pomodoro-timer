/**
 * storage.js — the ONLY file that touches localStorage.
 *
 * Exposes one global: AppStorage
 * (Not named "Storage" because that would shadow the browser's built-in
 *  window.Storage interface.)
 *
 * Data shapes
 *   settings: {
 *     focus, short, long, longEvery,          // minutes, minutes, minutes, count
 *     blockMode: 'off' | 'blocklist' | 'allowlist',
 *     blockedSites: string[], allowedSites: string[]   // bare domains, e.g. "youtube.com"
 *   }
 *   session:  { date: "YYYY-MM-DD" (local), completedAt: ISO string, durationMin: number }
 *   garden:   { enabled: boolean, petals: number, unlocked: string[], selected: string,
 *               plants: [{ date: "YYYY-MM-DD", type: string, state: 'bloom' | 'wilted', minutes: number }] }
 *             (storage checks the shape only; which flowers exist is Garden's job, see garden.js)
 */
const AppStorage = (() => {
  const KEYS = {
    settings: 'pomodoro.v1.settings',
    sessions: 'pomodoro.v1.sessions',
    garden: 'pomodoro.v1.garden',
  };

  const MAX_PLANTS = 500; // oldest plants are dropped first; earned petals are kept
  const STARTER_FLOWER = 'sakura';
  const PLANT_STATES = Object.freeze(['bloom', 'wilted']);
  const FLOWER_ID_RE = /^[a-z]{1,20}$/;
  const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

  const BLOCK_MODES = Object.freeze(['off', 'blocklist', 'allowlist']);
  const MAX_SITES = 100;

  const DEFAULTS = Object.freeze({
    focus: 25,
    short: 5,
    long: 15,
    longEvery: 4,
    blockMode: 'off',
    blockedSites: Object.freeze([]),
    allowedSites: Object.freeze([]),
  });

  /** Numeric settings and their allowed [min, max]. */
  const LIMITS = Object.freeze({
    focus: [1, 120],
    short: [1, 120],
    long: [1, 120],
    longEvery: [1, 12],
  });

  const SITE_LIST_FIELDS = Object.freeze(['blockedSites', 'allowedSites']);

  const LABELS = Object.freeze({
    focus: 'Focus',
    short: 'Short break',
    long: 'Long break',
    longEvery: 'Long break after',
    blockMode: 'Site blocking mode',
    blockedSites: 'Disallowed sites',
    allowedSites: 'Allowed sites',
  });

  // ---------- low-level helpers (never throw) ----------

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (err) {
      console.warn(`[storage] could not read "${key}", using fallback`, err);
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.warn(`[storage] could not write "${key}"`, err);
      return false;
    }
  }

  function remove(key) {
    try {
      localStorage.removeItem(key);
    } catch (err) {
      console.warn(`[storage] could not remove "${key}"`, err);
    }
  }

  /** Local-time date key, e.g. "2026-11-03". */
  function toDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // ---------- validation ----------

  /** Returns the integer if it is within [min, max], otherwise null. */
  function validInt(value, [min, max]) {
    const n = Number(value);
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
  }

  /**
   * Checks a candidate settings object.
   * @returns {{ ok: boolean, settings: object, errors: string[], invalidFields: string[] }}
   *   settings always contains a full, valid object (invalid fields fall back to defaults).
   */
  function validateSettings(candidate) {
    const input = candidate && typeof candidate === 'object' ? candidate : {};
    const settings = {};
    const errors = [];
    const invalidFields = [];

    function fail(field, message) {
      errors.push(message);
      if (!invalidFields.includes(field)) invalidFields.push(field);
    }

    // Numbers
    for (const field of Object.keys(LIMITS)) {
      const n = validInt(input[field], LIMITS[field]);
      if (n === null) {
        const [min, max] = LIMITS[field];
        fail(field, `${LABELS[field]} must be a whole number from ${min} to ${max}.`);
        settings[field] = DEFAULTS[field];
      } else {
        settings[field] = n;
      }
    }

    // Blocking mode (missing = default; unknown value = error)
    const mode = input.blockMode === undefined ? DEFAULTS.blockMode : input.blockMode;
    if (BLOCK_MODES.includes(mode)) {
      settings.blockMode = mode;
    } else {
      fail('blockMode', `${LABELS.blockMode} is not valid.`);
      settings.blockMode = DEFAULTS.blockMode;
    }

    // Site lists (missing = empty)
    for (const field of SITE_LIST_FIELDS) {
      const { sites, invalid } = parseSiteList(input[field]);
      if (invalid.length > 0) {
        fail(field, `${LABELS[field]}: not a valid site: ${invalid.join(', ')}.`);
      }
      if (sites.length > MAX_SITES) {
        fail(field, `${LABELS[field]}: at most ${MAX_SITES} sites.`);
      }
      settings[field] = sites.slice(0, MAX_SITES);
    }

    // An empty allowlist would block the entire web — never allow it.
    if (settings.blockMode === 'allowlist' && settings.allowedSites.length === 0) {
      fail('allowedSites', 'Allowlist mode needs at least one allowed site.');
      settings.blockMode = 'off';
    }

    return { ok: errors.length === 0, settings, errors, invalidFields };
  }

  // ---------- site lists ----------

  const DOMAIN_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

  /**
   * Turns whatever the user typed into a bare domain.
   * "https://www.YouTube.com:443/watch?v=1" → "youtube.com"; "*.reddit.com" → "reddit.com".
   * @returns {string} normalized domain, or "" for blank input (validity is checked separately)
   */
  function normalizeSite(text) {
    let s = String(text).trim().toLowerCase();
    if (s === '') return '';
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // scheme
    s = s.split(/[/?#]/)[0];                       // path, query, hash
    s = s.replace(/^[^@]*@/, '');                  // user:pass@
    s = s.replace(/:\d*$/, '');                    // port
    s = s.replace(/^\*\./, '').replace(/^www\./, '').replace(/\.$/, '');
    return s;
  }

  function isValidSite(domain) {
    return domain === 'localhost' || DOMAIN_RE.test(domain);
  }

  /**
   * Accepts an array or newline/comma-separated text.
   * @returns {{ sites: string[], invalid: string[] }} sites: normalized, valid, de-duplicated
   */
  function parseSiteList(value) {
    let entries = [];
    if (Array.isArray(value)) entries = value;
    else if (typeof value === 'string') entries = value.split(/[\n,]+/);

    const sites = [];
    const invalid = [];
    for (const entry of entries) {
      if (typeof entry !== 'string' || entry.trim() === '') continue;
      const domain = normalizeSite(entry);
      if (!isValidSite(domain)) invalid.push(entry.trim());
      else if (!sites.includes(domain)) sites.push(domain);
    }
    return { sites, invalid };
  }

  function isValidSession(s) {
    return (
      s !== null &&
      typeof s === 'object' &&
      typeof s.date === 'string' &&
      DATE_KEY_RE.test(s.date) &&
      typeof s.completedAt === 'string' &&
      Number.isFinite(s.durationMin) &&
      s.durationMin > 0
    );
  }

  // ---------- settings ----------

  /** Always returns a complete, valid settings object. */
  function getSettings() {
    const stored = read(KEYS.settings, {});
    // Merge so newly added fields get defaults; invalid fields fall back silently.
    return validateSettings({ ...DEFAULTS, ...stored }).settings;
  }

  /**
   * Validates and saves. Nothing is written if any field is invalid.
   * @returns {{ ok: boolean, settings: object, errors: string[] }}
   */
  function saveSettings(candidate) {
    const result = validateSettings(candidate);
    if (result.ok && !write(KEYS.settings, result.settings)) {
      return { ...result, ok: false, errors: ['Could not save settings in this browser.'] };
    }
    return result;
  }

  function resetSettings() {
    remove(KEYS.settings);
    return validateSettings(DEFAULTS).settings; // fresh copy (new arrays)
  }

  // ---------- sessions ----------

  /** Returns all valid saved sessions, oldest first. Corrupt entries are skipped. */
  function getSessions() {
    const stored = read(KEYS.sessions, []);
    return Array.isArray(stored) ? stored.filter(isValidSession) : [];
  }

  /**
   * Records one completed focus session.
   * @param {number} durationMin
   * @param {Date}   [completedAt=new Date()]
   * @returns {object|null} the saved record, or null if invalid / not saved
   */
  function addSession(durationMin, completedAt = new Date()) {
    const record = {
      date: toDateKey(completedAt),
      completedAt: completedAt.toISOString(),
      durationMin: Number(durationMin),
    };
    if (!isValidSession(record)) return null;

    const sessions = getSessions();
    sessions.push(record);
    return write(KEYS.sessions, sessions) ? record : null;
  }

  function clearSessions() {
    remove(KEYS.sessions);
  }

  // ---------- garden ----------

  function defaultGarden() {
    return { enabled: true, petals: 0, unlocked: [STARTER_FLOWER], selected: STARTER_FLOWER, plants: [] };
  }

  function isFlowerId(value) {
    return typeof value === 'string' && FLOWER_ID_RE.test(value);
  }

  function isValidPlant(plant) {
    return (
      plant !== null &&
      typeof plant === 'object' &&
      typeof plant.date === 'string' &&
      DATE_KEY_RE.test(plant.date) &&
      isFlowerId(plant.type) &&
      PLANT_STATES.includes(plant.state) &&
      Number.isFinite(plant.minutes) &&
      plant.minutes >= 0
    );
  }

  /** Unique flower ids, always starting with the free starter flower. */
  function cleanUnlocked(list) {
    const ids = Array.isArray(list) ? list.filter(isFlowerId) : [];
    return [...new Set([STARTER_FLOWER, ...ids])];
  }

  /** Always returns a complete garden object: bad fields fall back, bad plants are skipped. */
  function cleanGarden(candidate) {
    const input = candidate && typeof candidate === 'object' ? candidate : {};
    const garden = defaultGarden();
    if (typeof input.enabled === 'boolean') garden.enabled = input.enabled;
    if (Number.isInteger(input.petals) && input.petals >= 0) garden.petals = input.petals;
    garden.unlocked = cleanUnlocked(input.unlocked);
    if (garden.unlocked.includes(input.selected)) garden.selected = input.selected;
    const plants = Array.isArray(input.plants) ? input.plants.filter(isValidPlant) : [];
    garden.plants = plants.slice(-MAX_PLANTS).map((p) => ({ date: p.date, type: p.type, state: p.state, minutes: p.minutes }));
    return garden;
  }

  function getGarden() {
    return cleanGarden(read(KEYS.garden, {}));
  }

  /**
   * Cleans and saves the garden (oldest plants beyond MAX_PLANTS are dropped).
   * @returns {{ ok: boolean, garden: object }} garden = what is now stored (or would have been)
   */
  function saveGarden(candidate) {
    const garden = cleanGarden(candidate);
    return { ok: write(KEYS.garden, garden), garden };
  }

  function resetGarden() {
    remove(KEYS.garden);
    return defaultGarden();
  }

  return Object.freeze({
    DEFAULTS,
    LIMITS,
    BLOCK_MODES,
    MAX_SITES,
    toDateKey,
    normalizeSite,
    validateSettings,
    getSettings,
    saveSettings,
    resetSettings,
    getSessions,
    addSession,
    clearSessions,
    MAX_PLANTS,
    getGarden,
    saveGarden,
    resetGarden,
  });
})();
