// One seeded stream for the whole game: the city layout, the traffic and
// the staged screenshot scenes all pull from a generator built here, so a
// given seed always deals the same Palmera and the shots come out identical
// every run. The core is the mulberry32 recurrence — a 32-bit state advanced
// by a fixed odd step and scrambled with two multiply-xorshift rounds.

const STEP = 0x6d2b79f5;
const TWO_POW_32 = 4294967296;

/** Scramble a 32-bit state word into the next float in [0, 1). */
function scramble(word) {
  let t = Math.imul(word ^ (word >>> 15), word | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / TWO_POW_32;
}

export function makeRng(seed) {
  // A zero seed would still work, but the house rule is to start from 1.
  let state = (seed >>> 0) || 1;
  const draw = () => {
    state = (state + STEP) >>> 0;
    return scramble(state);
  };
  return {
    next: draw,
    /** Float in [min, max). */
    range(min, max) {
      return min + draw() * (max - min);
    },
    /** Integer in [min, max], both ends included. */
    int(min, max) {
      return min + Math.floor(draw() * (max - min + 1));
    },
    /** True with probability p. */
    chance(p) {
      return draw() < p;
    },
    /** One element of the array. */
    pick(items) {
      return items[Math.floor(draw() * items.length)];
    },
  };
}
