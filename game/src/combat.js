// Combat: fists, the pistol, the bullets between them, and the money that
// falls out of beaten men.
//
// This module owns the player's violence and nothing else's: outcomes are
// reported as g.events (crime kinds for the wanted system, sound cues for
// main.js), so combat never talks to the police or the speakers directly.
// A punch does its damage a beat after the swing starts — at the moment
// the rig's strike actually lands — not on the key press.
import * as THREE from 'three';
import { MUZZLE_FLASH_TIME, PLAYER } from './config.js';
import { buildingAt } from './city.js';
import { hurtPed, resolvePedCollision } from './people.js';
import { damageCar } from './vehicles.js';
import { basicMat } from './stick3d.js';
import { makeCashPickup } from './world3d.js';

// Shared geometry: every bullet flies the same small box, and every impact
// burst is the same ring with the same spokes — only the burst's material
// is per-burst, because each one fades on its own clock.
const BULLET_GEO = new THREE.BoxGeometry(7, 1.8, 1.8);
const BULLET_MAT = basicMat(0xffe066);
const RING_GEO = new THREE.RingGeometry(2.1, 3.0, 16);
const SPOKE_GEO = new THREE.BoxGeometry(3.8, 0.75, 1.0);
const SPOKE_COUNT = 6;

/**
 * A radial burst at the point of contact — a shockwave ring facing along
 * the blow, six spokes around it — that lives 0.22 s: long enough to read
 * as "that connected", short enough to never pile up in a brawl. The
 * ?shot= scenes spawn one and never update it, which is what makes their
 * freeze-frame. `angle` is the punch's direction; the disc faces it, and
 * the camera behind the puncher sees it face-on.
 */
export function spawnImpact(g, x, y, angle = 0, height = 24) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xfff3c4, transparent: true, opacity: 0.95,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const group = new THREE.Group();
  const place = (mesh) => {
    mesh.renderOrder = 950;
    group.add(mesh);
    return mesh;
  };
  place(new THREE.Mesh(RING_GEO, mat));
  for (let i = 0; i < SPOKE_COUNT; i += 1) {
    const a = (i / SPOKE_COUNT) * Math.PI * 2 + 0.4;
    const spoke = place(new THREE.Mesh(SPOKE_GEO, mat));
    spoke.position.set(Math.cos(a) * 6.8, Math.sin(a) * 6.8, 0);
    spoke.rotation.z = a;
  }
  group.position.set(x, height, y);
  group.rotation.y = Math.PI / 2 - angle; // the group's +z rides the blow
  g.scene.add(group);
  g.impacts.push({ t: 0, dur: 0.22, group, mat });
}

/** Grow, lift and fade every live burst; retire the spent ones. */
export function updateImpacts(g, dt) {
  if (g.impacts.length === 0) return;
  for (const burst of [...g.impacts]) {
    burst.t += dt;
    const k = burst.t / burst.dur;
    if (k >= 1) {
      g.scene.remove(burst.group);
      burst.mat.dispose();
      g.impacts.splice(g.impacts.indexOf(burst), 1);
      continue;
    }
    burst.group.scale.setScalar(0.55 + k * 1.9);
    burst.group.position.y += 3 * dt;
    burst.mat.opacity = 0.95 * (1 - k) ** 1.4;
  }
}

/** The signed gap between two headings, wrapped into -PI..PI. */
function headingGap(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Drop a spinning cash pickup (a beaten rival's money, a mission bonus). */
export function spawnCashPickup(g, x, y, amount) {
  const mesh = makeCashPickup();
  mesh.position.set(x, 0, y);
  g.scene.add(mesh);
  g.pickups.push({ x, y, amount, mesh, seed: g.rng.range(0, 10) });
}

/**
 * The living hostile nearest a clicked ground point, or null. The search
 * radius grows with the click's distance from the player: a figure's body
 * projects past his feet along the view ray and the overshoot grows with
 * range (measured: a chest click on a man 180 away lands ~84 past him, a
 * head click ~170), so a fixed radius either misses honest clicks at range
 * or swallows the whole street up close. Only hostiles the player could
 * actually hit count — in front of him and inside bullet range.
 */
function hostileNear(g, x, z) {
  const p = g.player;
  const clickRange = Math.hypot(x - p.x, z - p.y);
  let best = null;
  let bestDist = Math.min(240, 90 + clickRange * 0.35);
  for (const ped of g.peds) {
    if (ped.state === 'down' || ped.state === 'inCar') continue;
    if (ped.role !== 'rival' && ped.role !== 'cop') continue;
    const rx = ped.x - p.x;
    const ry = ped.y - p.y;
    if (Math.hypot(rx, ry) > PLAYER.bulletRange + 40) continue;
    if (rx * (x - p.x) + ry * (z - p.y) <= 0) continue; // behind the player
    const d = Math.hypot(ped.x - x, ped.y - z);
    if (d < bestDist) {
      bestDist = d;
      best = ped;
    }
  }
  return best;
}

/* --------------------------------------------------------- muzzle flash --
 * One flash for the whole game, built on the first shot and reused after:
 * a starburst sprite at the gun tip and a point light that pulses with it.
 * It exists only while a shot is live (MUZZLE_FLASH_TIME), allocates
 * nothing per shot, and is never built in the ?shot= scenes — nothing
 * fires there, so the stills stay byte-stable. Player only: NPCs never
 * shoot in Palmera. */

// The star's spikes as [angle, length, width]; the longest rides the barrel.
const STAR_SPIKES = [
  [0, 62, 9], [Math.PI / 2, 44, 7], [Math.PI, 42, 7], [-Math.PI / 2, 42, 7],
  [Math.PI / 4, 30, 5], [-Math.PI / 4, 30, 5], [3 * Math.PI / 4, 30, 5], [-3 * Math.PI / 4, 30, 5],
];

/** Paint the flash's starburst once onto a canvas texture. */
function paintFlashTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.translate(64, 64);
  ctx.fillStyle = 'rgba(255,166,60,0.85)';
  for (const [ang, len, wid] of STAR_SPIKES) {
    ctx.save();
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(0, -wid / 2);
    ctx.lineTo(len, 0);
    ctx.lineTo(0, wid / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  const core = ctx.createRadialGradient(0, 0, 1, 0, 0, 34);
  core.addColorStop(0, 'rgba(255,255,244,1)');
  core.addColorStop(0.35, 'rgba(255,216,110,0.95)');
  core.addColorStop(1, 'rgba(255,140,40,0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, 34, 0, Math.PI * 2);
  ctx.fill();
  return new THREE.CanvasTexture(cv);
}

/** Build the shared flash on first use and park it, dark, in the scene. */
function flashRig(g) {
  if (g.muzzle) return g.muzzle;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: paintFlashTexture(), blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false, opacity: 0,
  }));
  sprite.scale.set(19, 19, 1);
  sprite.renderOrder = 960;
  const light = new THREE.PointLight(0xffb45e, 0, 320, 2);
  const group = new THREE.Group();
  group.add(sprite);
  group.add(light);
  group.visible = false;
  g.scene.add(group);
  g.muzzle = { group, sprite, light, t: 0 };
  return g.muzzle;
}

/** Age the live flash: a fast swell of light, gone inside 60 ms. */
function ageFlash(g, dt) {
  const m = g.muzzle;
  if (!m || m.t <= 0) return;
  m.t -= dt;
  const k = Math.max(0, m.t / MUZZLE_FLASH_TIME);
  if (k <= 0) {
    m.group.visible = false;
    m.light.intensity = 0;
    m.sprite.material.opacity = 0;
    return;
  }
  m.sprite.material.opacity = k;
  m.light.intensity = 2200 * k;
  const s = 15 + 8 * (1 - k);
  m.sprite.scale.set(s, s, 1);
}

/** Send one bullet out of the player's hand along his facing. */
function fireBullet(g) {
  const p = g.player;
  const cos = Math.cos(p.angle);
  const sin = Math.sin(p.angle);
  const mesh = new THREE.Mesh(BULLET_GEO, BULLET_MAT);
  mesh.position.set(p.x + cos * 16, 27, p.y + sin * 16);
  mesh.rotation.y = -p.angle;
  g.scene.add(mesh);
  g.bullets.push({
    x: p.x + cos * 16,
    y: p.y + sin * 16,
    vx: cos * PLAYER.bulletSpeed,
    vy: sin * PLAYER.bulletSpeed,
    life: PLAYER.bulletRange / PLAYER.bulletSpeed,
    mesh,
  });
  // The flash sits just past the bullet's spawn, at the gun tip, its star
  // tilted a little differently with every shot.
  const m = flashRig(g);
  m.group.position.set(p.x + cos * 27, 29, p.y + sin * 27);
  m.sprite.material.rotation = (g.time * 13.7) % Math.PI;
  m.t = MUZZLE_FLASH_TIME;
  m.group.visible = true;
  m.sprite.material.opacity = 1;
  m.light.intensity = 2200;
  g.events.push({ type: 'shot' });
}

/**
 * Resolve the strike of a punch. The FIRST connect of the swing is what
 * the impact burst and the camera shake read (tracked in `mark`); every
 * man and car in the arc still takes the blow itself.
 */
function landPunch(g) {
  const p = g.player;
  const mark = { marked: false, x: 0, y: 0, angle: p.angle, height: 30, downed: false };
  const noteHit = (x, y, angle, height) => {
    if (mark.marked) return;
    mark.marked = true;
    mark.x = x;
    mark.y = y;
    mark.angle = angle;
    if (height !== undefined) mark.height = height;
  };
  for (const ped of g.peds) {
    if (ped.state === 'down' || ped.state === 'inCar') continue;
    const d = Math.hypot(ped.x - p.x, ped.y - p.y);
    if (d > PLAYER.punchRange + 8) continue;
    const dir = Math.atan2(ped.y - p.y, ped.x - p.x);
    if (Math.abs(headingGap(dir, p.angle)) > 1.15) continue;
    hurtPed(g, ped, p.punchDamage ?? PLAYER.punchDamage);
    if (ped.state === 'down') mark.downed = true;
    ped.x += Math.cos(dir) * 9;
    ped.y += Math.sin(dir) * 9;
    // The shove stops at walls. A man knocked down with his back to a
    // facade used to end up inside it for the whole down time; the
    // knockback is a displacement like any other and resolves against
    // the buildings around him.
    resolvePedCollision(g, ped);
    noteHit(ped.x, ped.y, dir);
    g.events.push({ type: 'crime', kind: ped.role === 'cop' ? 'punchCop' : 'punchPed', x: ped.x, y: ped.y });
  }
  for (const car of g.cars) {
    if (car === p.car) continue;
    if (Math.hypot(car.x - p.x, car.y - p.y) > 44) continue;
    // Through damageCar, never a bare hp write: a car beaten to zero by
    // fists has to wreck (sink, tilt, refuse entry) like any other dead
    // car. The direct write this replaced left zombie cars at hp <= 0 —
    // upright, enterable, drivable — and made traffic cars unkillable
    // by fists and bullets alike.
    damageCar(g, car, 8);
    noteHit(car.x, car.y, p.angle, 16); // a car connect reads at bonnet height
    g.events.push({ type: 'crime', kind: 'hitCar', x: car.x, y: car.y });
  }
  if (mark.marked) {
    spawnImpact(g, mark.x, mark.y, mark.angle, mark.height);
    // A connect reads through the camera as well as through the arm.
    g.shake = Math.max(g.shake, 2.8);
    // Only a connect is an event: the whoosh moved to the swing itself
    // ('punchswing'), so a miss needs no landing event at all.
    g.events.push({ type: 'punchhit', down: mark.downed });
  }
}

/** Aim the shot: a clicked hostile if one is there, else the aim state. */
function settleAim(g) {
  const p = g.player;
  const foe = g.aimPoint ? hostileNear(g, g.aimPoint.x, g.aimPoint.z) : null;
  if (foe) p.angle = Math.atan2(foe.y - p.y, foe.x - p.x);
  else if (g.aimAngle !== null) p.angle = g.aimAngle;
}

/** The player's attacks for one frame: swings, held fire, landing strikes. */
export function updateCombat(g, dt) {
  const p = g.player;
  updateImpacts(g, dt);
  ageFlash(g, dt);
  p.punchCd = Math.max(0, p.punchCd - dt);
  p.shotCd = Math.max(0, p.shotCd - dt);
  if (p.punchHitT > 0) {
    p.punchHitT -= dt;
    if (p.punchHitT <= 0) landPunch(g);
  }
  // The aim flag is a rig target and must settle in EVERY state: it used
  // to stop being written the moment he sat in a car, so a shot fired
  // while running for the door left the driving arm raised all trip.
  p.fig.target.aim = p.aimT > 0 ? 1 : 0;
  if (p.aimT > 0) p.aimT -= dt;
  if (p.state !== 'foot' || g.transition) return;
  if (g.input.tapped('KeyF', 'KeyJ') && p.punchCd <= 0) {
    p.punchCd = PLAYER.punchCooldown;
    // The whoosh belongs to the SWING, not the landing: it fires here, at
    // initiation, for every punch thrown — hit or miss. (It used to hang
    // off the landing 'punchmiss' event, so connects never whooshed and
    // misses whooshed 0.2 s late.)
    g.events.push({ type: 'punchswing' });
    // The rig's strike reaches full extension 46% into its 0.44 s punch;
    // that is when the fist arrives, so the damage waits for it.
    p.punchHitT = 0.2;
    p.fig.triggerPunch();
    p.fig.setExpression('angry');
    p.exprT = 0.45;
  }
  const wantsFire = g.input.down('KeyK') || g.input.mouse.down;
  if (p.hasPistol && wantsFire && p.shotCd <= 0) {
    p.shotCd = PLAYER.shotCooldown;
    p.aimT = 0.4;
    if (g.input.mouse.down) {
      // Click-to-face, settled on this very press, before the bullet
      // spawns: if an enemy stands at (or near) the clicked point, face
      // HIM. A click lands on a figure's body, whose ground projection
      // falls a good way past his feet, so aiming at the bare point
      // walks shots past the man the player clicked on. A click on empty
      // ground keeps the plain ground-point aim, untouched.
      settleAim(g);
    }
    fireBullet(g);
    p.fig.setExpression('shout');
    p.exprT = 0.3;
  }
}

/** One bullet against people, then cars: true when it dies on either. */
function bulletConnects(g, bullet) {
  for (const ped of g.peds) {
    if (ped.state === 'down' || ped.state === 'inCar') continue;
    if (Math.hypot(ped.x - bullet.x, ped.y - bullet.y) < 15) {
      hurtPed(g, ped, PLAYER.bulletDamage);
      g.events.push({ type: 'crime', kind: ped.role === 'cop' ? 'punchCop' : 'shootPed', x: ped.x, y: ped.y });
      return true;
    }
  }
  for (const car of g.cars) {
    if (Math.hypot(car.x - bullet.x, car.y - bullet.y) < 27) {
      // The same rule as fists: damageCar owns the wreck crossing, so a
      // shot-out car — even the player's own — dies properly.
      damageCar(g, car, 12);
      g.events.push({ type: 'spark', x: bullet.x, y: bullet.y });
      return true;
    }
  }
  return false;
}

/** Advance every bullet; buildings, bodies and cars all stop one. */
export function updateBullets(g, dt) {
  if (g.bullets.length === 0) return;
  for (const bullet of [...g.bullets]) {
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.life -= dt;
    bullet.mesh.position.set(bullet.x, 27, bullet.y);
    let dead = bullet.life <= 0;
    if (!dead && buildingAt(g.city, bullet.x, bullet.y)) dead = true;
    if (!dead) dead = bulletConnects(g, bullet);
    if (dead) {
      g.scene.remove(bullet.mesh);
      g.bullets.splice(g.bullets.indexOf(bullet), 1);
    }
  }
}

/** Spin the cash pickups; collect the ones the player reaches, foot or car. */
export function updatePickups(g, dt, time) {
  const p = g.player;
  if (g.pickups.length === 0) return;
  for (const pickup of [...g.pickups]) {
    pickup.mesh.userData.update(time, pickup.seed);
    const reach = p.state === 'car' ? 34 : 24;
    if (Math.hypot(p.x - pickup.x, p.y - pickup.y) < reach) {
      g.money += pickup.amount;
      g.earned += pickup.amount;
      g.events.push({ type: 'cash', amount: pickup.amount });
      g.scene.remove(pickup.mesh);
      g.pickups.splice(g.pickups.indexOf(pickup), 1);
    }
  }
  void dt;
}
