// Shared tuning for THE STICK MAN: the world grid, the palette, the wanted-level
// thresholds and the numbers every other module reads. Nothing here draws or moves;
// it is the one place the game's constants live.

/** The canvas is laid out for a 1280x720 view; the camera shows a window of this size. */
export const VIEW = { width: 1280, height: 720 };

/** The whole city of Palmera, in world pixels: about three screens by three. */
export const WORLD = { width: 3360, height: 2520 };

/** Road centre lines. Avenues run north-south, streets east-west; roads are ROAD.width wide. */
export const ROAD = {
  width: 110,
  avenues: [280, 720, 1160, 1600, 2040, 2480, 2920],
  streets: [280, 720, 1160, 1600, 2040],
};

/** Bright, flat, sun-soaked palette: the city is cheerful on purpose, the stick men are not. */
export const COLORS = {
  sky: '#79c7e3',
  ground: '#cfd8b0',
  sidewalk: '#e8e2d0',
  road: '#4a4a52',
  roadLine: '#f7f3df',
  crosswalk: '#d9d9d9',
  park: '#8fce6e',
  sand: '#f2ddab',
  water: '#3f9fd8',
  buildingRoofs: ['#ff8a5c', '#ffd166', '#ef6461', '#7fb5d5', '#a8d08d', '#f4a7c3', '#ffe8a3', '#95d5b2', '#f6bd60', '#84a98c'],
  buildingWalls: ['#e56b3d', '#e0a92e', '#c94f4c', '#5b8db8', '#86b06c', '#d67fa6', '#e0c06a', '#6fae86', '#d99a3d', '#678a70'],
};

/** Heat points at which each wanted star lights up; stars are the count passed. */
export const HEAT_THRESHOLDS = [30, 80, 150, 240, 350];
/** Heat a crime adds, by kind. */
export const HEAT_FOR = {
  punchPed: 25,
  punchCop: 60,
  stealCar: 40,
  runOver: 80,
  shotFired: 12,
  shootPed: 70,
  hitCar: 10,
};

export const PLAYER = {
  radius: 11,
  walkSpeed: 175,
  sprintSpeed: 265,
  dashSpeed: 660,
  dashTime: 0.26,
  dashCooldown: 1.2,
  maxHp: 100,
  punchRange: 36,
  punchDamage: 34,
  punchCooldown: 0.32,
  shotCooldown: 0.22,
  bulletSpeed: 760,
  bulletRange: 580,
  bulletDamage: 40,
};

export const CAR = {
  length: 48,
  width: 24,
  radius: 21,
  maxSpeed: 440,
  maxReverse: 150,
  accel: 360,
  brake: 520,
  turnRate: 2.7,
  trafficSpeed: 165,
  policeSpeed: 470,
};

/**
 * Crash damage, scaled by the impact's strength (closing speed / 420, the
 * same scale crash sound/shake/heat already use). Below the grind
 * threshold (closing <= 55) there is no damage at all — pushing and
 * scraping stay free. A clean full-speed hit costs the mover about a
 * fifth of its HP and the struck car about a third; a ram that
 * bulldozes through into a second contact costs roughly a third / a
 * half, so a couple of full-tilt wrecks total the struck car. A wall
 * takes the struck car's share out of the mover.
 */
export const CRASH_DAMAGE = { mover: 21, struck: 34, wall: 40 };

export const SAVE_KEY = 'the-stick-man-save-v1';

/** Price of the pistol at the Ammo Hut, and the Spray 'n Go fee per wanted star. */
export const PISTOL_PRICE = 120;
export const SPRAY_PER_STAR = 40;

/** Recovery prices: a full-heal meal at Bruno's Diner, treatment at St. Palm. */
export const MEAL_PRICE = 25;
export const TREAT_PRICE = 40;

/**
 * Store hold-ups: stand in a shop's door zone this long to empty its till.
 * The payout is rolled per robbery ($70–130, see main.js); the heat is a
 * witnessed crime by definition — two stars' worth. A robbed shop's till
 * stays empty for ROBBERY_COOLDOWN seconds of game time.
 */
export const ROBBERY_TIME = 2.5;
export const ROBBERY_HEAT = 100;
export const ROBBERY_COOLDOWN = 240;
