// Saving and loading the player's progress.
//
// Everything worth keeping between visits — cash, cleared missions, the
// pistol, bought gear and clothes, the garage of owned cars and the time of
// day — sits in one localStorage record so the title screen can offer to
// continue. Storage is treated as unreliable and hostile: a browser may
// refuse it (the game then simply plays unsaved), and a record written by
// an older build, or tampered with by hand, is rebuilt field by field with
// defaults wherever a value is missing or unusable. Nothing in here throws.
import { DAY_START, SAVE_KEY } from './config.js';

// ---------------------------------------------------------------------------
// Small readers for untrusted values. Each one answers "the value if it is
// usable, otherwise this stand-in", so the cleaners below read as tables of
// fields rather than a thicket of guards.
// ---------------------------------------------------------------------------

/** A number squeezed into [lo, hi]; `standIn` when the input is no number. */
const numIn = (v, standIn, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : standIn);

/** A number taken as it stands, or null when it cannot be one. */
const numOrNull = (v) => (Number.isFinite(v) ? v : null);

/** Strictly the boolean true counts; everything else is false. */
const isTrue = (v) => v === true;

/** The value when it is a plain record, else null. */
const asRecord = (v) => (v !== null && typeof v === 'object' ? v : null);

// ---------------------------------------------------------------------------
// Fresh state. The property order in these builders IS the on-disk order:
// storeSave writes with JSON.stringify, which follows insertion order, and
// saves are compared and migrated by shape, so the order never changes.
// ---------------------------------------------------------------------------

/**
 * A wardrobe: the first four fields say what is on the figure right now
 * (setFit reads them), `own` says what has been bought. A purchase happens
 * once; after that, putting a piece on or taking it off is free both at the
 * Surf Shack and in the pause menu's CUSTOMIZE panel.
 */
export function freshFit() {
  const fit = { scarf: false, hat: false, shades: false, color: 0 };
  fit.own = { scarf: false, hat: false, shades: false };
  return fit;
}

/** The Ammo Hut's shelf before anything is bought. */
export function freshGear() {
  return { pistol: false, vest: 0, gloves: false, shoes: false };
}

/**
 * A new game's progress. The clock starts at the day's opening hour, the
 * garage is empty, and `lastStolen` — the single remembered stolen car,
 * { color, x, y, angle } — starts out as no car at all: stealing another
 * car replaces the record, wrecking the car erases it. Both a fresh game
 * and the reset path build on this shape, so every field exists from the
 * very first frame.
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

// ---------------------------------------------------------------------------
// Cleaners: saved sub-objects rebuilt to the current shape.
// ---------------------------------------------------------------------------

/** The last-stolen record, kept only when its spot is fully numeric. */
function readStolen(raw) {
  const s = asRecord(raw);
  if (!s) return null;
  if (![s.x, s.y, s.angle].every(Number.isFinite)) return null;
  return { color: numIn(s.color, 0, 0, 0xffffff), x: s.x, y: s.y, angle: s.angle };
}

/**
 * One owned car, its numbers held to the grades and tiers that exist.
 * `paints` is the set of colours this car has ever worn: a colour is bought
 * once ($60 at the Motors desk) and returning to it is free, so the set is
 * deduplicated in order, and the car's current paint is always a member —
 * a save from before the set existed starts out holding just that colour.
 * `neon` is the installed underglow colour or null; `glow` is only the
 * on/off switch for it (an absent switch reads as on). The pos fields are
 * where the car was last left, heading included; until a build records
 * them they stay null and the car keeps its Motors-lot spawn.
 */
function readCar(raw) {
  const c = asRecord(raw);
  if (!c) return null;
  const paint = numIn(c.paint, 0, 0, 9);
  const paints = [];
  if (Array.isArray(c.paints)) {
    for (const p of c.paints) {
      const v = numIn(p, -1, 0, 9);
      if (v >= 0 && !paints.includes(v)) paints.push(v);
    }
  }
  if (!paints.includes(paint)) paints.push(paint);
  const car = {
    grade: numIn(c.grade, 0, 0, 2),
    paint,
    paints,
    engine: numIn(c.engine, 0, 0, 2),
    armor: numIn(c.armor, 0, 0, 2),
    neon: c.neon === null || c.neon === undefined ? null : numIn(c.neon, null, 0, 4),
    glow: c.glow !== false,
    stolen: isTrue(c.stolen),
    stolenX: numOrNull(c.stolenX),
    stolenY: numOrNull(c.stolenY),
  };
  car.posX = numOrNull(c.posX);
  car.posY = numOrNull(c.posY);
  car.posA = numOrNull(c.posA);
  return car;
}

/** The gear block; the oldest saves kept the pistol as a loose flag. */
function readGear(data, gear) {
  return {
    pistol: isTrue(data.hasPistol) || isTrue(gear?.pistol),
    vest: gear ? numIn(gear.vest, 0, 0, 2) : 0,
    gloves: isTrue(gear?.gloves),
    shoes: isTrue(gear?.shoes),
  };
}

/**
 * The wardrobe block. Saves old enough to have no `own` map are read as
 * "whatever was being worn had been bought" — the worn flags were the only
 * record those builds kept (a piece bought and later taken off under such
 * a build comes back unowned; nothing better survives).
 */
function readFit(fit) {
  const worn = (k) => isTrue(fit?.[k]);
  const owned = (k) => isTrue(fit?.own?.[k]) || (fit?.own === undefined && worn(k));
  return {
    scarf: worn('scarf'),
    hat: worn('hat'),
    shades: worn('shades'),
    color: fit ? numIn(fit.color, 0, 0, 4) : 0,
    own: { scarf: owned('scarf'), hat: owned('hat'), shades: owned('shades') },
  };
}

// ---------------------------------------------------------------------------
// The store itself.
// ---------------------------------------------------------------------------

/**
 * The saved progress, rebuilt to the current shape, or null when there is
 * nothing usable to load. A five-field save from the oldest builds gains
 * every newer field at its default: no purchases, an empty wardrobe, the
 * opening hour on the clock.
 */
export function loadSave() {
  let data = null;
  try {
    const text = window.localStorage.getItem(SAVE_KEY);
    if (text) data = asRecord(JSON.parse(text));
  } catch {
    data = null;
  }
  if (!data) return null;
  const save = freshSave();
  save.money = numIn(data.money, 0, -Infinity, Infinity);
  save.missionsDone = Array.isArray(data.missionsDone) ? data.missionsDone.filter(Number.isInteger) : [];
  save.jobsDone = numIn(data.jobsDone, 0, -Infinity, Infinity);
  save.earned = numIn(data.earned, 0, -Infinity, Infinity);
  save.clock = numIn(data.clock, save.clock, -Infinity, Infinity);
  save.safehouse = isTrue(data.safehouse);
  save.gear = readGear(data, asRecord(data.gear));
  save.fit = readFit(asRecord(data.fit));
  save.owned = Array.isArray(data.owned) ? data.owned.map(readCar).filter(Boolean) : [];
  save.lastStolen = readStolen(data.lastStolen);
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

/** Whether a save holds anything a Continue (or a reset) would care about. */
export function hasProgress(data) {
  if (!data) return false;
  return data.money > 0
    || (Array.isArray(data.missionsDone) && data.missionsDone.length > 0)
    || isTrue(data.gear?.pistol)
    || isTrue(data.safehouse)
    || data.earned > 0
    || (Array.isArray(data.owned) && data.owned.length > 0);
}

/** Drop the saved record entirely (the title screen's New Game). */
export function clearSave() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    /* nothing there to drop */
  }
}
