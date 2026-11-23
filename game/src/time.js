// Palmera's day/night clock. A full day takes DAY_SECONDS of play; solve(hour)
// turns an hour into everything the renderer needs for that moment — sky and
// haze colours, light levels, glow strengths, exposure, and the sun's
// direction. The cycle is a ring of keyframes: solve finds the pair of stops
// bracketing the hour and blends between them.
//
// Two callers pin the hour instead of advancing it: the ?shot= stills use the
// golden-hour constant from main.js, and the title screen sits at noon. The
// save stores raw clock seconds; a save from before the clock existed has no
// such field and starts at noon, as the game always used to.
import * as THREE from 'three';
import { DAY_SECONDS } from './config.js';

/** Wrap any hour value into [0, 24). */
function wrapHour(h) {
  return ((h % 24) + 24) % 24;
}

/** Straight blend: mix(a, b, 0) is a, mix(a, b, 1) is b. */
function mix(a, b, k) {
  return a + (b - a) * k;
}

/** Clamp into [0, 1]. */
function unit(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// The keyframe ring. Every row is one stop of the day:
//   [hour, sky, horizon, fog, keyColour, keyLevel, hemiSky, hemiGround,
//    hemiLevel, water, lampColour, windowGlow, neonGlow, starGlow,
//    exposure, shadow]
// Colours are hex, levels are plain numbers. The ring closes at 24 with the
// same values as 0, so the blend across midnight is seamless.
const KEYFRAMES = [
  [0.0, 0x0b1230, 0x243058, 0x1a2340, 0xa8bdff, 0.52, 0x3a4c7c, 0x232a3a, 0.95, 0x1d3d5e, 0xffd98b, 1.35, 1.00, 0.90, 1.22, 0.62],
  [4.8, 0x0d1433, 0x4f3455, 0x232a42, 0xb0c2ff, 0.62, 0x40527c, 0x24242c, 1.00, 0x1d3a58, 0xffe0a0, 1.20, 0.95, 0.70, 1.18, 0.66],
  [5.7, 0x314a78, 0xe5a06f, 0xb98167, 0xffc08a, 1.00, 0x9db2c9, 0x6b5a4a, 0.85, 0x5b7186, 0xffcf90, 0.90, 0.45, 0.18, 1.06, 0.80],
  [6.4, 0x4d88be, 0xffd0a0, 0xe2b99c, 0xffd6a5, 1.55, 0xcfe3ef, 0x8a7a60, 1.00, 0x4c8fb4, 0xffe6b0, 0.55, 0.12, 0.00, 1.02, 1.00],
  [9.0, 0x2486c4, 0x8fd3ea, 0xa9d9ea, 0xfff4dd, 1.92, 0xcfeeff, 0x9a8a5f, 1.05, 0x2f9fd4, 0xffe9b8, 0.35, 0.00, 0.00, 0.98, 1.00],
  [13.0, 0x2486c4, 0x93d7ee, 0xa9d9ea, 0xfff8e8, 2.00, 0xcfeeff, 0x9a8a5f, 1.05, 0x2f9fd4, 0xffe9b8, 0.30, 0.00, 0.00, 0.98, 1.00],
  [16.3, 0x3c8fbe, 0xffd39a, 0xe7bd93, 0xffdcaa, 2.05, 0xe2e3d0, 0x9a8058, 1.00, 0x3f88a8, 0xffd59a, 0.55, 0.20, 0.00, 1.00, 1.00],
  [17.4, 0x2f4f86, 0xff9d5c, 0xe08a63, 0xffb066, 2.40, 0xb9a3b5, 0x76563f, 1.10, 0x54708a, 0xffb066, 1.00, 0.62, 0.00, 1.05, 1.00],
  [18.4, 0x26355f, 0xff7a4d, 0x8e5a58, 0xff8a55, 1.80, 0x7f7ea6, 0x4a342c, 1.10, 0x354d6a, 0xff9a5e, 1.20, 0.85, 0.10, 1.10, 0.90],
  [19.6, 0x161d40, 0x50406c, 0x302a4a, 0xbfc3ff, 0.92, 0x53507a, 0x2a2536, 1.06, 0x27405e, 0xffd08a, 1.30, 1.00, 0.55, 1.18, 0.80],
  [21.0, 0x0b1230, 0x243058, 0x1a2340, 0xa8bdff, 0.52, 0x3a4c7c, 0x232a3a, 0.95, 0x1d3d5e, 0xffd98b, 1.35, 1.00, 0.90, 1.22, 0.62],
  [24.0, 0x0b1230, 0x243058, 0x1a2340, 0xa8bdff, 0.52, 0x3a4c7c, 0x232a3a, 0.95, 0x1d3d5e, 0xffd98b, 1.35, 1.00, 0.90, 1.22, 0.62],
];

// Which env fields each column feeds. Colour columns blend in THREE.Color
// space; level columns blend as plain numbers.
const COLOUR_COLUMNS = [
  ['sky', 1], ['horizon', 2], ['fog', 3], ['key', 4],
  ['hemiSky', 6], ['hemiGround', 7], ['water', 9], ['beam', 10],
];
const LEVEL_COLUMNS = [
  ['keyI', 5], ['hemiI', 8], ['windowGlow', 11], ['neonGlow', 12],
  ['stars', 13], ['exposure', 14], ['shadow', 15],
];

/** Index of the keyframe the blend for hour h starts from. */
function segmentStart(h) {
  let i = 0;
  while (i < KEYFRAMES.length - 2 && KEYFRAMES[i + 1][0] <= h) i += 1;
  return i;
}

/** The environment at `hour` (any real number; wrapped into the day). */
export function solve(hour) {
  const h = wrapHour(hour);
  const from = KEYFRAMES[segmentStart(h)];
  const to = KEYFRAMES[segmentStart(h) + 1];
  const k = to[0] > from[0] ? (h - from[0]) / (to[0] - from[0]) : 0;

  const blended = {};
  for (const [field, col] of COLOUR_COLUMNS) {
    blended[field] = new THREE.Color(from[col]).lerp(new THREE.Color(to[col]), k);
  }
  for (const [field, col] of LEVEL_COLUMNS) {
    blended[field] = mix(from[col], to[col], k);
  }

  const sunUp = h > 6.15 && h < 18.95;
  const env = {
    hour: h,
    sky: blended.sky,
    horizon: blended.horizon,
    fog: blended.fog,
    key: blended.key,
    keyI: blended.keyI,
    hemiSky: blended.hemiSky,
    hemiGround: blended.hemiGround,
    hemiI: blended.hemiI,
    water: blended.water,
    beam: blended.beam,
    windowGlow: blended.windowGlow,
    neonGlow: blended.neonGlow,
    stars: blended.stars,
    exposure: blended.exposure,
    shadow: blended.shadow,
    sunUp,
    night: !sunUp,
    darkness: 0,
  };

  // Darkness ramps from 0 in daylight to 1 in the deep of night; lamp glow,
  // lit windows and the sea sparkle all scale by it. The ramp is measured
  // from the nearer of the two sun gates (up 06:15, down 18:55).
  if (!sunUp) {
    const pastGate = h < 12 ? 6.15 - h : h - 18.95;
    env.darkness = unit((pastGate + 1.2) / 2.6);
  }

  // The sun's arc: rises 06:15, peaks at 12:30, sets 18:55, travelling east
  // to west. The still camera looks east, so shadows rake across the frame.
  // At night the same vector is flipped and lifted — a moon stand-in.
  const dayT = unit((h - 5.4) / 13.6);
  const elevation = 0.11 + Math.sin(dayT * Math.PI) * 0.95;
  const azimuth = -2.35 + dayT * 3.40;
  const dir = new THREE.Vector3(
    Math.cos(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.sin(azimuth) * Math.cos(elevation),
  ).normalize();
  if (!sunUp) dir.set(-dir.x * 0.42, 0.58, -dir.z * 0.42).normalize();
  env.dir = dir;
  return env;
}

/** Clock seconds corresponding to an hour of the day. */
export const clockAt = (hour) => (wrapHour(hour) / 24) * DAY_SECONDS;

/** The hour a clock position falls in, wrapped into [0, 24). */
export const hourOf = (seconds) => wrapHour((seconds / DAY_SECONDS) * 24);
