// combat.js — everything the player does with his hands and his pistol.
//
// Scope: swings and when they land, bullets in flight, impact bursts, the
// muzzle flash, and cash pickups dropped by beaten men. Consequences are
// reported outward as g.events (crime kinds, sound cues); this module
// never speaks to the police system or the speakers itself.
import * as THREE from 'three';
import { MUZZLE_FLASH_TIME, PLAYER } from './config.js';
import { buildingAt } from './city.js';
import { hurtPed, resolvePedCollision } from './people.js';
import { damageCar } from './vehicles.js';
import { basicMat } from './stick3d.js';
import { makeCashPickup } from './world3d.js';

// One bullet mesh shape and one burst shape for the whole game; only the
// burst material is per-instance, because each burst fades on its own.
const SHOT_BOX = new THREE.BoxGeometry(7, 1.8, 1.8);
const SHOT_PAINT = basicMat(0xffe066);
const BURST_RING = new THREE.RingGeometry(2.1, 3.0, 16);
const BURST_RAY = new THREE.BoxGeometry(3.8, 0.75, 1.0);
const BURST_RAYS = 6;
const BURST_LIFE = 0.22;

/**
 * Spawn the hit-confirmation burst: a ring plus six rays, facing along
 * the blow, alive for BURST_LIFE seconds. The frozen ?shot= scenes spawn
 * one and never advance it, which is exactly their freeze-frame.
 */
export function spawnImpact(g, x, y, angle = 0, height = 24) {
  const paint = new THREE.MeshBasicMaterial({
    color: 0xfff3c4, transparent: true, opacity: 0.95,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const burst = new THREE.Group();
  const addPart = (mesh) => {
    mesh.renderOrder = 950;
    burst.add(mesh);
    return mesh;
  };
  addPart(new THREE.Mesh(BURST_RING, paint));
  for (let i = 0; i < BURST_RAYS; i += 1) {
    const a = (i / BURST_RAYS) * Math.PI * 2 + 0.4;
    const ray = addPart(new THREE.Mesh(BURST_RAY, paint));
    ray.position.set(Math.cos(a) * 6.8, Math.sin(a) * 6.8, 0);
    ray.rotation.z = a;
  }
  burst.position.set(x, height, y);
  burst.rotation.y = Math.PI / 2 - angle;
  g.scene.add(burst);
  g.impacts.push({ t: 0, dur: BURST_LIFE, group: burst, mat: paint });
}

/** Advance all bursts: swell, drift up, fade; remove the finished ones. */
export function updateImpacts(g, dt) {
  for (const burst of [...g.impacts]) {
    burst.t += dt;
    const k = burst.t / burst.dur;
    if (k >= 1) {
      g.scene.remove(burst.group);
      burst.mat.dispose();
      g.impacts.splice(g.impacts.indexOf(burst), 1);
    } else {
      burst.group.scale.setScalar(0.55 + k * 1.9);
      burst.group.position.y += 3 * dt;
      burst.mat.opacity = 0.95 * (1 - k) ** 1.4;
    }
  }
}

/** Smallest signed difference between two headings, in -PI..PI. */
function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Put a spinning cash pickup on the ground. */
export function spawnCashPickup(g, x, y, amount) {
  const mesh = makeCashPickup();
  mesh.position.set(x, 0, y);
  g.scene.add(mesh);
  g.pickups.push({ x, y, amount, mesh, seed: g.rng.range(0, 10) });
}

/**
 * The clickable-target search behind click-to-face shooting. A click on
 * a figure lands on his body, whose ground projection overshoots his
 * feet by an amount that grows with range, so the acceptance radius
 * grows with the click's distance from the player (capped at 240).
 * Candidates must be living hostiles, ahead of the player, and inside
 * bullet range with a little slack.
 */
function pickClickedFoe(g, x, z) {
  const p = g.player;
  const clickDist = Math.hypot(x - p.x, z - p.y);
  let chosen = null;
  let chosenDist = Math.min(240, 90 + clickDist * 0.35);
  for (const ped of g.peds) {
    if (ped.state === 'down' || ped.state === 'inCar') continue;
    if (ped.role !== 'rival' && ped.role !== 'cop') continue;
    const rx = ped.x - p.x;
    const ry = ped.y - p.y;
    if (Math.hypot(rx, ry) > PLAYER.bulletRange + 40) continue;
    if (rx * (x - p.x) + ry * (z - p.y) <= 0) continue;
    const d = Math.hypot(ped.x - x, ped.y - z);
    if (d < chosenDist) {
      chosenDist = d;
      chosen = ped;
    }
  }
  return chosen;
}

/* ------------------------------------------------------- muzzle flash --
 * A single shared flash: starburst sprite + point light, built lazily on
 * the first shot and reused forever. It lives only for
 * MUZZLE_FLASH_TIME per shot and is never created in the ?shot= scenes
 * (nothing fires there), keeping the stills byte-stable. */

const FLASH_SPIKES = [
  [0, 62, 9], [Math.PI / 2, 44, 7], [Math.PI, 42, 7], [-Math.PI / 2, 42, 7],
  [Math.PI / 4, 30, 5], [-Math.PI / 4, 30, 5], [3 * Math.PI / 4, 30, 5], [-3 * Math.PI / 4, 30, 5],
];

/** Render the starburst into a canvas texture, once. */
function drawFlashTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.translate(64, 64);
  ctx.fillStyle = 'rgba(255,166,60,0.85)';
  for (const [ang, len, wid] of FLASH_SPIKES) {
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
  const glow = ctx.createRadialGradient(0, 0, 1, 0, 0, 34);
  glow.addColorStop(0, 'rgba(255,255,244,1)');
  glow.addColorStop(0.35, 'rgba(255,216,110,0.95)');
  glow.addColorStop(1, 'rgba(255,140,40,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, 34, 0, Math.PI * 2);
  ctx.fill();
  return new THREE.CanvasTexture(cv);
}

/** Get the shared flash rig, building and parking it on first use. */
function flashRig(g) {
  if (g.muzzle) return g.muzzle;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: drawFlashTexture(), blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false, opacity: 0,
  }));
  sprite.scale.set(19, 19, 1);
  sprite.renderOrder = 960;
  const lamp = new THREE.PointLight(0xffb45e, 0, 320, 2);
  const rig = new THREE.Group();
  rig.add(sprite);
  rig.add(lamp);
  rig.visible = false;
  g.scene.add(rig);
  g.muzzle = { group: rig, sprite, light: lamp, t: 0 };
  return g.muzzle;
}

/** Run the flash's short life: bright at birth, gone within 60 ms. */
function tickFlash(g, dt) {
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

/** Fire one round from the player's hand along his current facing. */
function discharge(g) {
  const p = g.player;
  const cos = Math.cos(p.angle);
  const sin = Math.sin(p.angle);
  const mesh = new THREE.Mesh(SHOT_BOX, SHOT_PAINT);
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
 * Land a punch whose swing has reached its strike moment. Everyone in
 * the arc is hit; the FIRST connect alone drives the burst, the camera
 * shake and the punchhit event, remembered in `first`.
 */
function resolvePunch(g) {
  const p = g.player;
  const first = { hit: false, x: 0, y: 0, angle: p.angle, height: 30, downed: false };
  const remember = (x, y, angle, height) => {
    if (first.hit) return;
    first.hit = true;
    first.x = x;
    first.y = y;
    first.angle = angle;
    if (height !== undefined) first.height = height;
  };
  for (const ped of g.peds) {
    if (ped.state === 'down' || ped.state === 'inCar') continue;
    const d = Math.hypot(ped.x - p.x, ped.y - p.y);
    if (d > PLAYER.punchRange + 8) continue;
    const dir = Math.atan2(ped.y - p.y, ped.x - p.x);
    if (Math.abs(angleDiff(dir, p.angle)) > 1.15) continue;
    hurtPed(g, ped, p.punchDamage ?? PLAYER.punchDamage);
    if (ped.state === 'down') first.downed = true;
    ped.x += Math.cos(dir) * 9;
    ped.y += Math.sin(dir) * 9;
    // The knockback shove is a displacement and resolves against
    // buildings like any other, so a man never ends up inside a wall.
    resolvePedCollision(g, ped);
    remember(ped.x, ped.y, dir);
    g.events.push({ type: 'crime', kind: ped.role === 'cop' ? 'punchCop' : 'punchPed', x: ped.x, y: ped.y });
  }
  for (const car of g.cars) {
    if (car === p.car) continue;
    if (Math.hypot(car.x - p.x, car.y - p.y) > 44) continue;
    // Always through damageCar: fists alone must be able to wreck a car
    // (sink, tilt, refuse entry), never leave a drivable husk at hp <= 0.
    damageCar(g, car, 8);
    remember(car.x, car.y, p.angle, 16);
    g.events.push({ type: 'crime', kind: 'hitCar', x: car.x, y: car.y });
  }
  if (first.hit) {
    spawnImpact(g, first.x, first.y, first.angle, first.height);
    g.shake = Math.max(g.shake, 2.8);
    g.events.push({ type: 'punchhit', down: first.downed });
  }
}

/** Settle the aim for a mouse-fired shot: clicked foe first, else the stored aim. */
function aimForShot(g) {
  const p = g.player;
  const foe = g.aimPoint ? pickClickedFoe(g, g.aimPoint.x, g.aimPoint.z) : null;
  if (foe) p.angle = Math.atan2(foe.y - p.y, foe.x - p.x);
  else if (g.aimAngle !== null) p.angle = g.aimAngle;
}

/** Per-frame player offence: cooldowns, swing starts, held fire, landings. */
export function updateCombat(g, dt) {
  const p = g.player;
  updateImpacts(g, dt);
  tickFlash(g, dt);
  p.punchCd = Math.max(0, p.punchCd - dt);
  p.shotCd = Math.max(0, p.shotCd - dt);
  if (p.punchHitT > 0) {
    p.punchHitT -= dt;
    if (p.punchHitT <= 0) resolvePunch(g);
  }
  // The rig's aim target settles in every state, cars included: a shot
  // fired while running for a door must not leave the driving arm raised.
  p.fig.target.aim = p.aimT > 0 ? 1 : 0;
  if (p.aimT > 0) p.aimT -= dt;
  if (p.state !== 'foot' || g.transition) return;
  if (g.input.tapped('KeyF', 'KeyJ') && p.punchCd <= 0) {
    p.punchCd = PLAYER.punchCooldown;
    // The whoosh belongs to the swing's start, hit or miss alike.
    g.events.push({ type: 'punchswing' });
    // The fist lands 0.2 s in, when the rig's strike reaches extension.
    p.punchHitT = 0.2;
    p.fig.triggerPunch();
    p.fig.setExpression('angry');
    p.exprT = 0.45;
  }
  const triggerHeld = g.input.down('KeyK') || g.input.mouse.down;
  if (p.hasPistol && triggerHeld && p.shotCd <= 0) {
    p.shotCd = PLAYER.shotCooldown;
    p.aimT = 0.4;
    // A click settles the facing on this press, before the bullet spawns.
    if (g.input.mouse.down) aimForShot(g);
    discharge(g);
    p.fig.setExpression('shout');
    p.exprT = 0.3;
  }
}

/** Test one bullet against people, then cars. True when it stops there. */
function bulletHits(g, bullet) {
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
      damageCar(g, car, 12);
      g.events.push({ type: 'spark', x: bullet.x, y: bullet.y });
      return true;
    }
  }
  return false;
}

/** Move every bullet; a wall, a body or a car ends its flight. */
export function updateBullets(g, dt) {
  for (const bullet of [...g.bullets]) {
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.life -= dt;
    bullet.mesh.position.set(bullet.x, 27, bullet.y);
    let stopped = bullet.life <= 0;
    if (!stopped && buildingAt(g.city, bullet.x, bullet.y)) stopped = true;
    if (!stopped) stopped = bulletHits(g, bullet);
    if (stopped) {
      g.scene.remove(bullet.mesh);
      g.bullets.splice(g.bullets.indexOf(bullet), 1);
    }
  }
}

/** Spin the pickups and pay out the ones the player walks or drives over. */
export function updatePickups(g, dt, time) {
  const p = g.player;
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
