/**
 * garden.js — the Sakura Garden reward rules and the smart messages. Pure logic:
 * no DOM, never reads or writes storage (app.js loads/saves through AppStorage).
 *
 * Exposes one global: Garden
 * Depends on: AppStorage.toDateKey (storage.js loads first), like stats.js.
 *
 * A garden is the object AppStorage.getGarden() returns:
 *   { enabled, petals, unlocked: [flowerId], selected: flowerId,
 *     plants: [{ date: "YYYY-MM-DD", type: flowerId, state: 'bloom' | 'wilted', minutes }] }
 * Functions that change a garden return a NEW object and never mutate their input.
 * Every function that depends on "today" takes an optional `now` (Date) for testing.
 */
const Garden = (() => {
  const toDateKey = AppStorage.toDateKey;

  /** Flowers in unlock order. Sakura is free and always unlocked. */
  const CATALOG = Object.freeze([
    Object.freeze({ id: 'sakura', name: 'Sakura', cost: 0 }),
    Object.freeze({ id: 'tulip', name: 'Tulip', cost: 100 }),
    Object.freeze({ id: 'sunflower', name: 'Sunflower', cost: 250 }),
    Object.freeze({ id: 'lotus', name: 'Lotus', cost: 500 }),
    Object.freeze({ id: 'moonflower', name: 'Moonflower', cost: 1000 }),
  ]);
  const STARTER = CATALOG[0];

  /** Growth stages and the share of the focus session each one starts at. */
  const STAGES = Object.freeze([
    Object.freeze({ id: 'seed', from: 0 }),
    Object.freeze({ id: 'sprout', from: 0.2 }),
    Object.freeze({ id: 'leaves', from: 0.45 }),
    Object.freeze({ id: 'bud', from: 0.7 }),
    Object.freeze({ id: 'bloom', from: 1 }),
  ]);

  /** Resetting a focus session wilts the plant only after this much focus. */
  const WILT_AFTER_MS = 60 * 1000;

  // ---------- catalog ----------

  function flowerById(id) {
    return CATALOG.find((flower) => flower.id === id) || null;
  }

  /** Display name for any stored type; unknown types show as the starter flower. */
  function flowerName(id) {
    return (flowerById(id) || STARTER).name;
  }

  /** A flower id this version can draw: unknown ids (e.g. from a newer version) show as the starter flower. */
  function displayType(id) {
    return flowerById(id) ? id : STARTER.id;
  }

  /**
   * Makes sure the flower that grows next is one this version knows. Unknown unlocked ids and plant
   * types are KEPT (petals were spent on them), so saving never loses a newer version's data.
   */
  function normalize(garden) {
    const selectable = flowerById(garden.selected) && garden.unlocked.includes(garden.selected);
    return selectable ? garden : { ...garden, selected: STARTER.id };
  }

  // ---------- growth ----------

  /** @param {number} fraction share of the focus session done (0…1) → stage id */
  function stageFor(fraction) {
    let stage = STAGES[0].id;
    for (const { id, from } of STAGES) {
      if (fraction >= from) stage = id;
    }
    return stage;
  }

  /** 1 petal per whole focus minute. */
  function petalsFor(minutes) {
    return Math.max(0, Math.floor(minutes));
  }

  /** Should resetting now wilt the plant? Only during focus and after the first minute. */
  function shouldWilt(mode, elapsedMs) {
    return mode === 'focus' && elapsedMs >= WILT_AFTER_MS;
  }

  // ---------- changes (each returns a new garden) ----------

  function addPlant(garden, state, minutes, now) {
    const plant = { date: toDateKey(now), type: garden.selected, state, minutes: Math.floor(minutes) };
    return { ...garden, plants: [...garden.plants, plant] };
  }

  /** A focus session completed: add a bloom and earn its petals. */
  function recordBloom(garden, minutes, now = new Date()) {
    const grown = addPlant(garden, 'bloom', minutes, now);
    return { ...grown, petals: garden.petals + petalsFor(minutes) };
  }

  /** A focus session was reset after the first minute: add a wilted plant, no petals. */
  function recordWilt(garden, minutes, now = new Date()) {
    return addPlant(garden, 'wilted', minutes, now);
  }

  function canUnlock(garden, id) {
    const flower = flowerById(id);
    return flower !== null && !garden.unlocked.includes(id) && garden.petals >= flower.cost;
  }

  /** Spends petals on a flower and selects it. Returns the same garden if not allowed. */
  function unlock(garden, id) {
    if (!canUnlock(garden, id)) return garden;
    return {
      ...garden,
      petals: garden.petals - flowerById(id).cost,
      unlocked: [...garden.unlocked, id],
      selected: id,
    };
  }

  /** Chooses which unlocked flower grows next. Returns the same garden if not unlocked. */
  function select(garden, id) {
    return garden.unlocked.includes(id) ? { ...garden, selected: id } : garden;
  }

  // ---------- reading ----------

  function dayKey(now, daysAgo) {
    return toDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo));
  }

  /** Plants from the last `days` days (today included), newest first. */
  function recentPlants(garden, days = 7, now = new Date()) {
    const oldest = dayKey(now, days - 1);
    return garden.plants.filter((p) => p.date >= oldest).reverse();
  }

  /** { blooms, wilted } among the given plants. */
  function countStates(plants) {
    const blooms = plants.filter((p) => p.state === 'bloom').length;
    return { blooms, wilted: plants.length - blooms };
  }

  function bloomsOn(garden, daysAgo, now = new Date()) {
    const key = dayKey(now, daysAgo);
    return garden.plants.filter((p) => p.date === key && p.state === 'bloom').length;
  }

  /** The cheapest flower still locked and how many more petals it needs (0 = can unlock now), or null. */
  function nextUnlock(garden) {
    const flower = CATALOG.find((f) => !garden.unlocked.includes(f.id));
    return flower ? { flower, needed: Math.max(0, flower.cost - garden.petals) } : null;
  }

  // ---------- smart messages ----------

  const STAGE_TEXT = {
    seed: 'Seed planted. See you at bloom.',
    sprout: 'It sprouted — keep going.',
    leaves: 'Halfway — your leaves are out.',
    bud: 'A bud is forming — almost there.',
    bloom: 'Full bloom!',
  };

  /** "+25 petals" plus either the unlock progress (when close) or today's bloom count. */
  function completeText(ctx) {
    const earned = `+${ctx.earnedText}`;
    const next = ctx.nextUnlock;
    if (next && next.needed === 0) return `${earned} — you can unlock ${next.flower.name} now!`;
    if (next && next.needed <= 50) return `${earned} — ${next.needed} more to unlock ${next.flower.name}.`;
    const diff = ctx.bloomsToday - ctx.bloomsYesterday;
    const compare = ctx.bloomsYesterday > 0 && diff > 0 ? ` — ${diff} more than yesterday` : '';
    return `Bloom #${ctx.bloomsToday} today${compare} · ${earned}`;
  }

  /**
   * Picks the message for a timer/garden event, built from the user's own numbers.
   * @param {string} event  'idle' | 'stage' | 'paused' | 'complete' | 'wilt' | 'break' | 'long' | 'ready'
   * @param {object} ctx    { flower, focusMin, stage, bloomsToday, bloomsYesterday, earnedText ("25 petals"),
   *                          nextUnlock, breakMin, bloomSaved, cycleLength } — only the fields the event needs
   * @returns {{ text: string, icon: string }} icon = sprite stage id for the small plant before the text
   */
  function message(event, ctx = {}) {
    const name = flowerName(ctx.flower);
    switch (event) {
      case 'idle':
        return ctx.bloomsToday === 0
          ? { text: `First bloom of the day starts here — plant a ${name}.`, icon: 'seed' }
          : { text: `Plant a ${name} — ${ctx.focusMin} min to full bloom.`, icon: 'seed' };
      case 'stage':
        return { text: STAGE_TEXT[ctx.stage] || STAGE_TEXT.seed, icon: ctx.stage || 'seed' };
      case 'paused':
        return { text: 'Paused — your plant will wait for you.', icon: ctx.stage || 'seed' };
      case 'complete':
        return { text: completeText(ctx), icon: 'bloom' };
      case 'wilt':
        return { text: 'That one wilted — it happens. Plant another?', icon: 'wilted' };
      case 'break':
        return ctx.bloomSaved
          ? { text: `Bloom saved. Rest your eyes for ${ctx.breakMin} min.`, icon: 'bloom' }
          : { text: `Rest your eyes for ${ctx.breakMin} min.`, icon: 'seed' };
      case 'long':
        return { text: `Cycle of ${ctx.cycleLength} complete — enjoy a long rest.`, icon: 'bloom' };
      case 'ready':
        return { text: `Break over — a new ${name} seed is ready.`, icon: 'seed' };
      default:
        return { text: '', icon: 'seed' };
    }
  }

  return Object.freeze({
    CATALOG,
    STAGES,
    WILT_AFTER_MS,
    flowerById,
    flowerName,
    displayType,
    normalize,
    stageFor,
    petalsFor,
    shouldWilt,
    recordBloom,
    recordWilt,
    canUnlock,
    unlock,
    select,
    recentPlants,
    countStates,
    bloomsOn,
    nextUnlock,
    message,
  });
})();
