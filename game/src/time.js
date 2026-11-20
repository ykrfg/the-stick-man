// The clock over Palmera. One day runs in DAY_SECONDS of real play time and
// walks through night, dawn, day, golden hour and dusk. solve(hour) answers the
// values the renderer copies every frame: sky, horizon and haze tones, key and
// ambient light strength, tone-map exposure, window and neon glow, star opacity,
// and where the sun stands.
//
// Stills pin the hour: ?shot= uses SHOT_HOUR and the title uses noon. main.js
// saves the raw seconds in `clock` on the save; an older save has no such field
// and opens at noon, which is exactly what the game did before this update.
import * as THREE from 'three';
import { DAY_SECONDS } from './config.js';

const h24 = (h) => ((h % 24) + 24) % 24;
const lerp = (a, b, k) => a + (b - a) * k;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * Key stops. Columns: hour, sky, horizon, fog, key, key strength, hemi sky,
 * hemi ground, hemi strength, water, lamp pool, window glow, neon glow, stars,
 * exposure, shadow. Colours are hex; strengths are plain numbers. The day is
 * closed at 24 so 23:59 and 00:00 read the same.
 */
const STOPS = [
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

/** The environment at `hour` (0..24). */
export function solve(hour) {
  const h = h24(hour);
  let i = 0;
  while (i < STOPS.length - 2 && STOPS[i + 1][0] <= h) i += 1;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  const k = b[0] > a[0] ? (h - a[0]) / (b[0] - a[0]) : 0;
  const col = (n) => new THREE.Color(a[n]).lerp(new THREE.Color(b[n]), k);
  const num = (n) => lerp(a[n], b[n], k);
  const sunUp = h > 6.15 && h < 18.95;
  const env = {
    hour: h,
    sky: col(1),
    horizon: col(2),
    fog: col(3),
    key: col(4),
    keyI: num(5),
    hemiSky: col(6),
    hemiGround: col(7),
    hemiI: num(8),
    water: col(9),
    beam: col(10),
    windowGlow: num(11),
    neonGlow: num(12),
    stars: num(13),
    exposure: num(14),
    shadow: num(15),
    sunUp,
    night: !sunUp,
    darkness: 0,
  };
  // Darkness 0 by day, 1 in the deep night: lamp glow, lit windows and the sea
  // sparkle all scale by it.
  if (!sunUp) {
    const edge = h < 12 ? 6.15 - h : h - 18.95;
    env.darkness = clamp01((edge + 1.2) / 2.6);
  }
  // Sun arc: up at 06:15, high at 12:30, down at 18:55. Azimuth runs east to
  // west; the still camera is east, so the long shadows fall across frame.
  const dayT = clamp01((h - 5.4) / 13.6);
  const elev = 0.11 + Math.sin(dayT * Math.PI) * 0.95;
  const azim = -2.35 + dayT * 3.40;
  const dir = new THREE.Vector3(
    Math.cos(azim) * Math.cos(elev),
    Math.sin(elev),
    Math.sin(azim) * Math.cos(elev),
  ).normalize();
  if (!sunUp) dir.set(-dir.x * 0.42, 0.58, -dir.z * 0.42).normalize();
  env.dir = dir;
  return env;
}

/** Seconds into the day for an hour. */
export const clockAt = (hour) => (h24(hour) / 24) * DAY_SECONDS;

/** Hour for a day position, wrapped. */
export const hourOf = (seconds) => h24((seconds / DAY_SECONDS) * 24);
