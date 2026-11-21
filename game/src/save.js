// Progress saving: money, finished missions, the pistol, the bought gear and
// wardrobe, the owned cars and the day clock are kept in localStorage so the
// title screen can offer a Continue. Saving is best effort only — a browser
// that refuses storage just loses the feature, never the game.
import { DAY_START, SAVE_KEY } from './config.js';

/**
 * A wardrobe with nothing bought and the first colour. The first four
 * fields are what is WORN right now (the figure's setFit reads them);
 * `own` is what has been BOUGHT (round #23): buying is once-only, and
 * wearing / taking off an owned piece is free everywhere — at the Surf
 * Shack and in the pause screen's CUSTOMIZE panel alike.
 */
export function freshFit() {
  return {
    scarf: false, hat: false, shades: false, color: 0,
    own: { scarf: false, hat: false, shades: false },
  };
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
    // The last car the player stole and drove (round #25):
    // { color, x, y, angle } or null. One record only — stealing a
    // different car moves it, and a wreck clears it.
    lastStolen: null,
  };
}

/** The recorded last-stolen car, validated: a colour and a finite spot. */
function cleanStolen(s) {
  if (!s || typeof s !== 'object') return null;
  if (!Number.isFinite(s.x) || !Number.isFinite(s.y) || !Number.isFinite(s.angle)) return null;
  return { color: int(s.color, 0, 0, 0xffffff), x: s.x, y: s.y, angle: s.angle };
}

const int = (v, fallback, min, max) => (
  Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback
);

/** One owned car, clamped to the grades and upgrade levels that exist. */
function cleanCar(c) {
  if (!c || typeof c !== 'object') return null;
  const paint = int(c.paint, 0, 0, 9);
  // Paint ownership (round #23): the set of colours this car has ever
  // been painted in. A colour is bought once ($60 at the Motors desk)
  // and switching back to it is free. Saves from before the set existed
  // start with just the car's current colour in the set.
  const paints = [];
  if (Array.isArray(c.paints)) {
    for (const p of c.paints) {
      const v = int(p, -1, 0, 9);
      if (v >= 0 && !paints.includes(v)) paints.push(v);
    }
  }
  if (!paints.includes(paint)) paints.push(paint);
  return {
    grade: int(c.grade, 0, 0, 2),
    paint,
    paints,
    engine: int(c.engine, 0, 0, 2),
    armor: int(c.armor, 0, 0, 2),
    neon: c.neon === null || c.neon === undefined ? null : int(c.neon, null, 0, 4),
    // Underglow on/off (round #23): the neon colour stays installed;
    // this is only the switch the pause panel flips. Absent = on.
    glow: c.glow !== false,
    stolen: c.stolen === true,
    stolenX: Number.isFinite(c.stolenX) ? c.stolenX : null,
    stolenY: Number.isFinite(c.stolenY) ? c.stolenY : null,
    // Last place the player left this car (round #25): where it spawns
    // on the next load, heading included. Null until the car has been
    // in the world under the new build — a car without a recorded spot
    // (every car in an older save) keeps the Motors-lot spawn.
    posX: Number.isFinite(c.posX) ? c.posX : null,
    posY: Number.isFinite(c.posY) ? c.posY : null,
    posA: Number.isFinite(c.posA) ? c.posA : null,
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
        // Ownership (round #23). Old saves have no `own`: whatever was
        // worn at the time counts as owned (a piece that had been bought
        // and taken off in an old save comes back as unowned — the worn
        // state was the only record those saves kept).
        own: {
          scarf: fit?.own?.scarf === true || (fit?.own === undefined && fit?.scarf === true),
          hat: fit?.own?.hat === true || (fit?.own === undefined && fit?.hat === true),
          shades: fit?.own?.shades === true || (fit?.own === undefined && fit?.shades === true),
        },
      },
      owned: Array.isArray(data.owned) ? data.owned.map(cleanCar).filter(Boolean) : [],
      lastStolen: cleanStolen(data.lastStolen),
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
