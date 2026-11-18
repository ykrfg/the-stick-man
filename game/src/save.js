// Progress saving: money, finished missions, the pistol and lifetime earnings are
// kept in localStorage so the title screen can offer a Continue. Saving is best
// effort only — a browser that refuses storage just loses the feature, never the game.
import { SAVE_KEY } from './config.js';

/** The saved progress object, or null when there is none (or storage is unavailable). */
export function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return null;
    return {
      money: Number.isFinite(data.money) ? data.money : 0,
      missionsDone: Array.isArray(data.missionsDone) ? data.missionsDone.filter((n) => Number.isInteger(n)) : [],
      jobsDone: Number.isFinite(data.jobsDone) ? data.jobsDone : 0,
      hasPistol: data.hasPistol === true,
      earned: Number.isFinite(data.earned) ? data.earned : 0,
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
    || data.hasPistol === true
    || data.earned > 0
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
