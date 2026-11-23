// Progress saving: money, finished missions, the pistol, the bought gear and
// wardrobe, the owned cars and the day clock live in localStorage so the title
// screen can offer a Continue. Saving is best effort only — a browser that
// refuses storage loses the feature, never the game. Everything read back is
// validated field by field: a save written by an older build (or edited by
// hand) loads with defaults standing in for whatever it lacks.
import { DAY_START, SAVE_KEY } from './config.js';

/** A finite number held inside [min, max]; the fallback when it is not finite. */
function clampNum(v, fallback, min, max) {
  return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
}

/** A finite number kept as it is; null when the saved value is unusable. */
function finiteOrNull(v) {
  return Number.isFinite(v) ? v : null;
}

/**
 * A wardrobe with nothing worn and the first colour. The first four fields
 * are what is WORN right now (the figure's setFit reads them); `own` is what
 * has been BOUGHT: buying is once-only, and wearing or taking off an owned
 * piece is free everywhere — at the Surf Shack and in the pause screen's
 * CUSTOMIZE panel alike.
 */
export function freshFit() {
  const fit = { scarf: false, hat: false, shades: false, color: 0 };
  fit.own = { scarf: false, hat: false, shades: false };
  return fit;
}

/** Ammo Hut gear with nothing bought. */
export function freshGear() {
  return { pistol: false, vest: 0, gloves: false, shoes: false };
}

/**
 * A brand-new progress object. `clock` starts at noon; the owned list is
 * empty; `lastStolen` is the one record of the last car the player stole and
 * drove ({ color, x, y, angle } or null — stealing a different car moves it,
 * a wreck clears it). Save and reset both build on this, so every field
 * exists from the first frame.
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

/** The recorded last-stolen car, validated: a colour and a finite spot. */
function cleanStolen(s) {
  if (!s || typeof s !== 'object') return null;
  const spot = [s.x, s.y, s.angle];
  if (spot.some((n) => !Number.isFinite(n))) return null;
  return { color: clampNum(s.color, 0, 0, 0xffffff), x: s.x, y: s.y, angle: s.angle };
}

/** One owned car, clamped to the grades and upgrade levels that exist. */
function cleanCar(c) {
  if (!c || typeof c !== 'object') return null;
  const paint = clampNum(c.paint, 0, 0, 9);
  // Paint ownership: the set of colours this car has ever been painted in.
  // A colour is bought once ($60 at the Motors desk) and switching back to
  // it is free. Saves from before the set existed start with just the car's
  // current colour in the set — and the current colour is always in it.
  const paints = [];
  if (Array.isArray(c.paints)) {
    for (const p of c.paints) {
      const v = clampNum(p, -1, 0, 9);
      if (v >= 0 && !paints.includes(v)) paints.push(v);
    }
  }
  if (!paints.includes(paint)) paints.push(paint);
  const car = {
    grade: clampNum(c.grade, 0, 0, 2),
    paint,
    paints,
    engine: clampNum(c.engine, 0, 0, 2),
    armor: clampNum(c.armor, 0, 0, 2),
    // Neon: null when no underglow colour is installed. The glow switch is
    // separate (the colour stays installed; the pause panel flips only the
    // switch) and an absent switch means on.
    neon: c.neon === null || c.neon === undefined ? null : clampNum(c.neon, null, 0, 4),
    glow: c.glow !== false,
    stolen: c.stolen === true,
    stolenX: finiteOrNull(c.stolenX),
    stolenY: finiteOrNull(c.stolenY),
  };
  // Last place the player left this car: where it spawns on the next load,
  // heading included. Null until the car has been in the world under a build
  // that records it — a car without a recorded spot (every car in an older
  // save) keeps the Motors-lot spawn.
  car.posX = finiteOrNull(c.posX);
  car.posY = finiteOrNull(c.posY);
  car.posA = finiteOrNull(c.posA);
  return car;
}

/** The saved gear block, with the oldest saves' loose hasPistol folded in. */
function cleanGear(data, gear) {
  return {
    pistol: data.hasPistol === true || gear?.pistol === true,
    vest: gear ? clampNum(gear.vest, 0, 0, 2) : 0,
    gloves: gear?.gloves === true,
    shoes: gear?.shoes === true,
  };
}

/**
 * The saved wardrobe block. Old saves have no `own`: whatever was worn at
 * the time counts as owned (a piece that had been bought and taken off in
 * an old save comes back as unowned — the worn state was the only record
 * those saves kept).
 */
function cleanFit(fit) {
  const worn = (k) => fit?.[k] === true;
  const ownedBefore = (k) => fit?.own === undefined && worn(k);
  return {
    scarf: worn('scarf'),
    hat: worn('hat'),
    shades: worn('shades'),
    color: fit ? clampNum(fit.color, 0, 0, 4) : 0,
    own: {
      scarf: fit?.own?.scarf === true || ownedBefore('scarf'),
      hat: fit?.own?.hat === true || ownedBefore('hat'),
      shades: fit?.own?.shades === true || ownedBefore('shades'),
    },
  };
}

/**
 * The saved progress object, or null when there is none (or storage is
 * unavailable). Old five-field saves gain the new fields at their defaults:
 * no purchases, an empty wardrobe, and a noon start.
 */
export function loadSave() {
  let data;
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const gear = data.gear && typeof data.gear === 'object' ? data.gear : null;
  const fit = data.fit && typeof data.fit === 'object' ? data.fit : null;
  const save = freshSave();
  save.money = Number.isFinite(data.money) ? data.money : 0;
  save.missionsDone = Array.isArray(data.missionsDone) ? data.missionsDone.filter((n) => Number.isInteger(n)) : [];
  save.jobsDone = Number.isFinite(data.jobsDone) ? data.jobsDone : 0;
  save.earned = Number.isFinite(data.earned) ? data.earned : 0;
  save.clock = Number.isFinite(data.clock) ? data.clock : save.clock;
  save.safehouse = data.safehouse === true;
  save.gear = cleanGear(data, gear);
  save.fit = cleanFit(fit);
  save.owned = Array.isArray(data.owned) ? data.owned.map(cleanCar).filter(Boolean) : [];
  save.lastStolen = cleanStolen(data.lastStolen);
  return save;
}

/** Write the progress object (the same shape loadSave returns). */
export function storeSave(data) {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable: play on without saving */
  }
}

/** True when a save object holds anything worth continuing (or wiping). */
export function hasProgress(data) {
  if (!data) return false;
  return data.money > 0
    || (Array.isArray(data.missionsDone) && data.missionsDone.length > 0)
    || data.gear?.pistol === true
    || data.safehouse === true
    || data.earned > 0
    || (Array.isArray(data.owned) && data.owned.length > 0);
}

/** Forget all progress (the title screen's New Game). */
export function clearSave() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    /* nothing to clear */
  }
}
