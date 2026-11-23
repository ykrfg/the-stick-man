// save.js — the player's progress record: load, store, wipe.
//
// One localStorage entry holds everything that survives between visits:
// cash, finished missions, side-job count, lifetime earnings, the clock,
// the safehouse flag, the Ammo Hut gear, the wardrobe, the garage of
// owned cars and the last stolen car's parking spot. The title screen
// reads it to offer Continue; the game writes it back as play proceeds.
//
// The record is untrusted input. It may come from an older build with
// fewer fields, or have been edited by hand, and the browser may refuse
// storage outright. So loading rebuilds the record field by field —
// every value is clamped, type-checked or replaced by its default — and
// every storage call is wrapped so a refusal just means "plays unsaved".
// Nothing exported from here throws, and nothing here touches the RNG:
// a load must leave the game's random stream exactly where it was.
import { DAY_START, SAVE_KEY } from './config.js';

/* ------------------------------------------------------------------ *
 * Readers for raw values. Each answers a single question — "is this
 * usable, and if so as what?" — so the shape builders below can stay
 * declarative instead of nesting a guard around every field.
 * ------------------------------------------------------------------ */

/** Finite number clamped into [lo, hi]; `fallback` for anything else. */
const bounded = (v, fallback, lo, hi) =>
  (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);

/** The number itself when finite, otherwise null. */
const finiteOrNull = (v) => (Number.isFinite(v) ? v : null);

/** Only the literal boolean true passes; all else reads as false. */
const onlyTrue = (v) => v === true;

/** Objects (arrays included) pass through; primitives become null. */
const recordOrNull = (v) => (v !== null && typeof v === 'object' ? v : null);

/* ------------------------------------------------------------------ *
 * Fresh shapes. Property order in these literals is the on-disk order:
 * storeSave serialises with JSON.stringify, which walks insertion
 * order, and the record's shape is what migrations key off — so the
 * field order here is fixed and must not drift.
 * ------------------------------------------------------------------ */

/**
 * A wardrobe in two halves: the first four fields are what the figure
 * is wearing right now (setFit consumes them) and `own` is what has
 * been bought. Buying is once-only; afterwards a piece goes on or off
 * for free, both at the Surf Shack and in the pause menu's CUSTOMIZE.
 */
export function freshFit() {
  const fit = { scarf: false, hat: false, shades: false, color: 0 };
  fit.own = { scarf: false, hat: false, shades: false };
  return fit;
}

/** The Ammo Hut's shelf before a single purchase. */
export function freshGear() {
  return { pistol: false, vest: 0, gloves: false, shoes: false };
}

/**
 * A brand-new progress record. The clock opens at DAY_START, the garage
 * is empty, and `lastStolen` — the one remembered stolen car, shaped
 * { color, x, y, angle } — begins as no car at all: stealing a different
 * car replaces the record and wrecking that car erases it. Fresh games
 * and the reset path both start from this exact shape, so every field
 * exists from the first frame onward.
 */
export function freshSave() {
  const save = {
    money: 0,
    missionsDone: [],
    jobsDone: 0,
    earned: 0,
    clock: DAY_START,
    safehouse: false,
    gear: freshGear(),
    fit: freshFit(),
    owned: [],
  };
  save.lastStolen = null;
  return save;
}

/* ------------------------------------------------------------------ *
 * Cleaners: rebuild one saved sub-object to the current shape, or
 * return null when there is nothing salvageable in it.
 * ------------------------------------------------------------------ */

/**
 * The last-stolen record survives only with a fully numeric spot —
 * colour may fall back to 0, but a car without a place and a heading
 * cannot be respawned, so the whole record goes.
 */
function cleanStolen(raw) {
  const s = recordOrNull(raw);
  if (!s) return null;
  const spot = [s.x, s.y, s.angle];
  if (!spot.every(Number.isFinite)) return null;
  return { color: bounded(s.color, 0, 0, 0xffffff), x: s.x, y: s.y, angle: s.angle };
}

/**
 * The paint set of one owned car: every colour the car has ever worn,
 * in purchase order, deduplicated. A colour is bought once ($60 at the
 * Motors desk) and returning to it is free, so the set is the memory of
 * those purchases — and the car's current paint is always a member,
 * appended when a save predates the set and names only the paint.
 */
function cleanPaints(rawPaints, paint) {
  const kept = [];
  const seen = new Set();
  if (Array.isArray(rawPaints)) {
    for (const entry of rawPaints) {
      const v = bounded(entry, -1, 0, 9);
      if (v >= 0 && !seen.has(v)) {
        seen.add(v);
        kept.push(v);
      }
    }
  }
  if (!seen.has(paint)) kept.push(paint);
  return kept;
}

/**
 * One owned car, its numbers held to the grades and tiers that exist.
 * `neon` is the installed underglow colour or null, and `glow` merely
 * the switch for it (a missing switch reads as on). The stolenX/Y pair
 * remembers where a stolen car was taken from; the pos fields are where
 * the car was last left, heading included — until a build records them
 * they stay null and the car keeps its Motors-lot spawn.
 */
function cleanCar(raw) {
  const c = recordOrNull(raw);
  if (!c) return null;
  const paint = bounded(c.paint, 0, 0, 9);
  const car = {
    grade: bounded(c.grade, 0, 0, 2),
    paint,
    paints: cleanPaints(c.paints, paint),
    engine: bounded(c.engine, 0, 0, 2),
    armor: bounded(c.armor, 0, 0, 2),
    neon: c.neon === null || c.neon === undefined ? null : bounded(c.neon, null, 0, 4),
    glow: c.glow !== false,
    stolen: onlyTrue(c.stolen),
    stolenX: finiteOrNull(c.stolenX),
    stolenY: finiteOrNull(c.stolenY),
  };
  car.posX = finiteOrNull(c.posX);
  car.posY = finiteOrNull(c.posY);
  car.posA = finiteOrNull(c.posA);
  return car;
}

/**
 * The gear block. The oldest saves carried the pistol as a loose
 * top-level flag (`hasPistol`) rather than inside the block, so the
 * pistol reads from either home; the rest lives only in the block.
 */
function cleanGear(data, gear) {
  return {
    pistol: onlyTrue(data.hasPistol) || onlyTrue(gear?.pistol),
    vest: gear ? bounded(gear.vest, 0, 0, 2) : 0,
    gloves: onlyTrue(gear?.gloves),
    shoes: onlyTrue(gear?.shoes),
  };
}

/**
 * The wardrobe block. A save old enough to have no `own` map is read as
 * "whatever was being worn had been bought" — the worn flags were the
 * only record those builds kept. (A piece bought and later taken off
 * under such a build comes back unowned; nothing better survives.)
 */
function cleanFit(fit) {
  const wearing = (k) => onlyTrue(fit?.[k]);
  const bought = (k) => onlyTrue(fit?.own?.[k]) || (fit?.own === undefined && wearing(k));
  return {
    scarf: wearing('scarf'),
    hat: wearing('hat'),
    shades: wearing('shades'),
    color: fit ? bounded(fit.color, 0, 0, 4) : 0,
    own: { scarf: bought('scarf'), hat: bought('hat'), shades: bought('shades') },
  };
}

/* ------------------------------------------------------------------ *
 * The storage calls themselves.
 * ------------------------------------------------------------------ */

/**
 * The saved progress rebuilt to the current shape, or null when there
 * is nothing usable stored. A five-field record from the oldest builds
 * gains every newer field at its default: no purchases, an empty
 * wardrobe, an empty garage, the opening hour on the clock.
 */
export function loadSave() {
  let data = null;
  try {
    const text = window.localStorage.getItem(SAVE_KEY);
    if (text) data = recordOrNull(JSON.parse(text));
  } catch {
    data = null;
  }
  if (!data) return null;
  const save = freshSave();
  // The unbounded scalars: whatever finite number was stored stands,
  // and the fresh default fills in for anything else.
  for (const key of ['money', 'jobsDone', 'earned', 'clock']) {
    save[key] = bounded(data[key], save[key], -Infinity, Infinity);
  }
  save.missionsDone = Array.isArray(data.missionsDone)
    ? data.missionsDone.filter(Number.isInteger)
    : [];
  save.safehouse = onlyTrue(data.safehouse);
  save.gear = cleanGear(data, recordOrNull(data.gear));
  save.fit = cleanFit(recordOrNull(data.fit));
  save.owned = Array.isArray(data.owned)
    ? data.owned.map(cleanCar).filter(Boolean)
    : [];
  save.lastStolen = cleanStolen(data.lastStolen);
  return save;
}

/** Persist a progress object of the shape loadSave returns. Best effort. */
export function storeSave(data) {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    /* storage refused: the run continues unsaved */
  }
}

/** Whether a record holds anything Continue (or a reset) would care about. */
export function hasProgress(data) {
  if (!data) return false;
  const marks = [
    data.money > 0,
    Array.isArray(data.missionsDone) && data.missionsDone.length > 0,
    onlyTrue(data.gear?.pistol),
    onlyTrue(data.safehouse),
    data.earned > 0,
    Array.isArray(data.owned) && data.owned.length > 0,
  ];
  return marks.some(Boolean);
}

/** Drop the saved record entirely (the title screen's New Game). */
export function clearSave() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    /* nothing there to drop */
  }
}
