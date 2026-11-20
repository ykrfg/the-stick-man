// Progress saving: money, finished missions, the pistol, the bought gear and
// wardrobe, the owned cars and the day clock are kept in localStorage so the
// title screen can offer a Continue. Saving is best effort only — a browser
// that refuses storage just loses the feature, never the game.
import { DAY_START, SAVE_KEY } from './config.js';

/** A wardrobe with nothing bought and the first colour. */
export function freshFit() {
  return { scarf: false, hat: false, shades: false, color: 0 };
}

/** Ammo Hut gear with nothing bought. */
export function freshGear() {
  return { pistol: false, vest: 0, gloves: false, shoes: false };
}

/**
 * A brand-new progress object. `clock` starts at noon; the owned list is empty.
 * Both save and reset build on this so every field exists from the first frame.
 */
export function freshSave() {
  return {
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
}

const int = (v, fallback, min, max) => (
  Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback
);

/** One owned car, clamped to the grades and upgrade levels that exist. */
function cleanCar(c) {
  if (!c || typeof c !== 'object') return null;
  return {
    grade: int(c.grade, 0, 0, 2),
    paint: int(c.paint, 0, 0, 9),
    engine: int(c.engine, 0, 0, 2),
    armor: int(c.armor, 0, 0, 2),
    neon: c.neon === null || c.neon === undefined ? null : int(c.neon, null, 0, 4),
    stolen: c.stolen === true,
    stolenX: Number.isFinite(c.stolenX) ? c.stolenX : null,
    stolenY: Number.isFinite(c.stolenY) ? c.stolenY : null,
  };
}

/**
 * The saved progress object, or null when there is none (or storage is
 * unavailable). Old five-field saves gain the new fields at their defaults:
 * no purchases, an empty wardrobe, and a noon start.
 */
export function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return null;
    const base = freshSave();
    const gear = data.gear && typeof data.gear === 'object' ? data.gear : null;
    const fit = data.fit && typeof data.fit === 'object' ? data.fit : null;
    return {
      money: Number.isFinite(data.money) ? data.money : 0,
      missionsDone: Array.isArray(data.missionsDone) ? data.missionsDone.filter((n) => Number.isInteger(n)) : [],
      jobsDone: Number.isFinite(data.jobsDone) ? data.jobsDone : 0,
      earned: Number.isFinite(data.earned) ? data.earned : 0,
      clock: Number.isFinite(data.clock) ? data.clock : base.clock,
      safehouse: data.safehouse === true,
      gear: {
        pistol: data.hasPistol === true || gear?.pistol === true,
        vest: gear ? int(gear.vest, 0, 0, 2) : 0,
        gloves: gear?.gloves === true,
        shoes: gear?.shoes === true,
      },
      fit: {
        scarf: fit?.scarf === true,
        hat: fit?.hat === true,
        shades: fit?.shades === true,
        color: fit ? int(fit.color, 0, 0, 4) : 0,
      },
      owned: Array.isArray(data.owned) ? data.owned.map(cleanCar).filter(Boolean) : [],
    };
  } catch {
    return null;
  }
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
  return !!data && (
    data.money > 0
    || (Array.isArray(data.missionsDone) && data.missionsDone.length > 0)
    || data.gear?.pistol === true
    || data.safehouse === true
    || data.earned > 0
    || (Array.isArray(data.owned) && data.owned.length > 0)
  );
}

/** Forget all progress (the title screen's New Game). */
export function clearSave() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    /* nothing to clear */
  }
}
