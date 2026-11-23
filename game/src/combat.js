// Combat: the player's fists and pistol, the bullets they send, and the cash
// that falls out of beaten rivals. Hits are reported through g.events (crime
// kinds for the wanted system, sounds for main.js) so this module never talks
// to the police or the speakers directly. The punch lands a beat after the
// swing starts, when the strike of the animation lands.
import * as THREE from 'three';
import { MUZZLE_FLASH_TIME, PLAYER } from './config.js';
import { buildingAt } from './city.js';
import { hurtPed, resolvePedCollision } from './people.js';
import { damageCar } from './vehicles.js';
import { basicMat } from './stick3d.js';
import { makeCashPickup } from './world3d.js';

const bulletGeo = new THREE.BoxGeometry(7, 1.8, 1.8);
const bulletMat = basicMat(0xffe066);
// One shared ring and spoke for impact bursts; each burst gets its own
// material so it can fade without touching anyone else's.
const impactGeo = new THREE.RingGeometry(2.1, 3.0, 16);
const sparkGeo = new THREE.BoxGeometry(3.8, 0.75, 1.0);

const SPOKES = 6;

/**
 * A short radial burst at the point of contact: a shockwave disc facing
 * along the blow with six spokes around it. It lives just over a fifth of
 * a second, which is long enough to read as "that connected" at 60 fps and
 * short enough to never pile up in a brawl. Screenshot scenes call this
 * once and never update it, so the still keeps the freeze-frame. `angle`
 * is the direction of the punch, which the disc faces; the camera sits
 * behind the puncher, so it is seen face-on in play.
 */
export function spawnImpact(g, x, y, angle = 0, height = 24) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xfff3c4, transparent: true, opacity: 0.95,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const group = new THREE.Group();
  const addPart = (mesh) => {
    mesh.renderOrder = 950;
    group.add(mesh);
    return mesh;
  };
  addPart(new THREE.Mesh(impactGeo, mat));
  for (let i = 0; i < SPOKES; i += 1) {
    const a = (i / SPOKES) * Math.PI * 2 + 0.4;
    const bar = addPart(new THREE.Mesh(sparkGeo, mat));
    bar.position.set(Math.cos(a) * 6.8, Math.sin(a) * 6.8, 0);
    bar.rotation.z = a;
  }
  group.position.set(x, height, y);
  group.rotation.y = Math.PI / 2 - angle; // local +z along the blow
  g.scene.add(group);
  g.impacts.push({ t: 0, dur: 0.22, group, mat });
}

/** Advance and retire every live impact burst. */
export function updateImpacts(g, dt) {
  if (g.impacts.length === 0) return;
  for (const im of [...g.impacts]) {
    im.t += dt;
    const k = im.t / im.dur;
    if (k >= 1) {
      g.scene.remove(im.group);
      im.mat.dispose();
      g.impacts.splice(g.impacts.indexOf(im), 1);
      continue;
    }
    im.group.scale.setScalar(0.55 + k * 1.9);
    im.group.position.y += 3 * dt;
    im.mat.opacity = 0.95 * (1 - k) ** 1.4;
  }
}

/** Angle difference wrapped to -PI..PI. */
function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Spawn a spinning cash pickup (from a beaten rival or a mission bonus). */
export function spawnCashPickup(g, x, y, amount) {
  const mesh = makeCashPickup();
  mesh.position.set(x, 0, y);
  g.scene.add(mesh);
  g.pickups.push({ x, y, amount, mesh, seed: g.rng.range(0, 10) });
}

/**
 * The nearest living hostile to a clicked ground point, or null. The
 * search radius grows with the click's range: a figure's body projects
 * past his feet along the view ray, and the overshoot grows with distance
 * (measured: a chest click on a man 180 away lands ~84 past him, a head
 * click ~170), so a fixed radius either misses honest clicks at range or
 * swallows the whole street up close. Only hostiles the player could
 * actually hit count — in front of him, inside bullet range.
 */
function nearestHostile(g, x, z) {
  const p = g.player;
  const aimDist = Math.hypot(x - p.x, z - p.y);
  let best = null;
  let bestD = Math.min(240, 90 + aimDist * 0.35);
  for (const ped of g.peds) {
    if (ped.state === 'down' || ped.state === 'inCar') continue;
    if (ped.role !== 'rival' && ped.role !== 'cop') continue;
    const rx = ped.x - p.x;
    const ry = ped.y - p.y;
    if (Math.hypot(rx, ry) > PLAYER.bulletRange + 40) continue;
    if (rx * (x - p.x) + ry * (z - p.y) <= 0) continue; // behind the player
    const d = Math.hypot(ped.x - x, ped.y - z);
    if (d < bestD) {
      bestD = d;
      best = ped;
    }
  }
  return best;
}

// --- Muzzle flash -------------------------------------------------------
// One shared flash, built lazily on the first shot and reused for every
// shot after: a starburst sprite at the gun tip plus a point light that
// pulses with it. It lives only while a shot is live (MUZZLE_FLASH_TIME),
// allocates nothing per shot, and is never created in the deterministic
// ?shot= scenes — nothing fires there, so the stills stay byte-stable.
// Player only: NPCs never shoot in Palmera.

// The star's spikes as [angle, length, width], longest along the barrel.
const MUZZLE_SPIKES = [
  [0, 62, 9], [Math.PI / 2, 44, 7], [Math.PI, 42, 7], [-Math.PI / 2, 42, 7],
  [Math.PI / 4, 30, 5], [-Math.PI / 4, 30, 5], [3 * Math.PI / 4, 30, 5], [-3 * Math.PI / 4, 30, 5],
];

/** The flash's starburst: a hot core with spikes, drawn once. */
function makeMuzzleTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.translate(64, 64);
  ctx.fillStyle = 'rgba(255,166,60,0.85)';
  for (const [ang, len, wid] of MUZZLE_SPIKES) {
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
function ensureMuzzle(g) {
  if (g.muzzle) return g.muzzle;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeMuzzleTexture(), blending: THREE.AdditiveBlending,
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
function updateMuzzle(g, dt) {
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

/** Fire one bullet from the player's hand toward the player's facing. */
function fireBullet(g) {
  const p = g.player;
  const cos = Math.cos(p.angle);
  const sin = Math.sin(p.angle);
  const mesh = new THREE.Mesh(bulletGeo, bulletMat);
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
  // The flash sits just past the bullet's spawn, at the gun tip, and its
  // star tilts a little differently with every shot.
  const m = ensureMuzzle(g);
  m.group.position.set(p.x + cos * 27, 29, p.y + sin * 27);
  m.sprite.material.rotation = (g.time * 13.7) % Math.PI;
  m.t = MUZZLE_FLASH_TIME;
  m.group.visible = true;
  m.sprite.material.opacity = 1;
  m.light.intensity = 2200;
  g.events.push({ type: 'shot' });
}

/** Where the first connect of a punch reads: point, facing and height. */
function newHitMark(angle) {
  return { marked: false, x: 0, y: 0, angle, height: 30, downed: false };
}

function markHit(mark, x, y, angle, height) {
  if (mark.marked) return;
  mark.marked = true;
  mark.x = x;
  mark.y = y;
  mark.angle = angle;
  if (height !== undefined) mark.height = height;
}

/** Resolve the strike of a punch: whoever is in front of the player takes it. */
function landPunch(g) {
  const p = g.player;
  const mark = newHitMark(p.angle);
  for (const ped of g.peds) {
    if (ped.state === 'down' || ped.state === 'inCar') continue;
    const d = Math.hypot(ped.x - p.x, ped.y - p.y);
    if (d > PLAYER.punchRange + 8) continue;
    const dir = Math.atan2(ped.y - p.y, ped.x - p.x);
    if (Math.abs(angleDiff(dir, p.angle)) > 1.15) continue;
    hurtPed(g, ped, p.punchDamage ?? PLAYER.punchDamage);
    if (ped.state === 'down') mark.downed = true;
    ped.x += Math.cos(dir) * 9;
    ped.y += Math.sin(dir) * 9;
    // The shove stops at walls: a man punched down with his back to a
    // facade used to land inside it and lie there for the whole down
    // time — the knockback is a displacement like any other and resolves
    // against the buildings near him.
    resolvePedCollision(g, ped);
    markHit(mark, ped.x, ped.y, dir);
    g.events.push({ type: 'crime', kind: ped.role === 'cop' ? 'punchCop' : 'punchPed', x: ped.x, y: ped.y });
  }
  for (const car of g.cars) {
    if (car === p.car) continue;
    const d = Math.hypot(car.x - p.x, car.y - p.y);
    if (d > 44) continue;
    // Through damageCar, never a direct hp write: a car beaten to zero
    // by fists must actually wreck (sink, tilt, refuse entry) like any
    // other dead car. The direct write this replaces left "zombie" cars
    // at hp <= 0 still upright, enterable and drivable, and made traffic
    // cars unkillable by fists and bullets.
    damageCar(g, car, 8);
    markHit(mark, car.x, car.y, p.angle, 16); // a car hit reads at bonnet height
    g.events.push({ type: 'crime', kind: 'hitCar', x: car.x, y: car.y });
  }
  if (mark.marked) {
    spawnImpact(g, mark.x, mark.y, mark.angle, mark.height);
    // A punch that lands reads through the camera as well as the arm.
    g.shake = Math.max(g.shake, 2.8);
    // Only a connect is an event now: the swing sound moved to punch
    // initiation ('punchswing'), so a miss needs no landing event at all.
    g.events.push({ type: 'punchhit', down: mark.downed });
  }
}

/** Face the shot: a clicked hostile if there is one, else the aim state. */
function faceShot(g) {
  const p = g.player;
  const foe = g.aimPoint ? nearestHostile(g, g.aimPoint.x, g.aimPoint.z) : null;
  if (foe) p.angle = Math.atan2(foe.y - p.y, foe.x - p.x);
  else if (g.aimAngle !== null) p.angle = g.aimAngle;
}

/** The player's attacks for one frame: punch taps, held gunfire, landing strikes. */
export function updateCombat(g, dt) {
  const p = g.player;
  updateImpacts(g, dt);
  updateMuzzle(g, dt);
  p.punchCd = Math.max(0, p.punchCd - dt);
  p.shotCd = Math.max(0, p.shotCd - dt);
  if (p.punchHitT > 0) {
    p.punchHitT -= dt;
    if (p.punchHitT <= 0) landPunch(g);
  }
  // The aim state is a rig target, and it has to settle in every state: it
  // used to stop being written the moment he sat in a car, so a shot fired
  // while running for the door left the driving arm raised for the whole
  // trip.
  p.fig.target.aim = p.aimT > 0 ? 1 : 0;
  if (p.aimT > 0) p.aimT -= dt;
  if (p.state !== 'foot' || g.transition) return;
  if (g.input.tapped('KeyF', 'KeyJ') && p.punchCd <= 0) {
    p.punchCd = PLAYER.punchCooldown;
    // The whoosh belongs to the SWING, not the landing: it fires here, at
    // initiation, for every punch the player throws — hit or miss. (It
    // used to hang off the landing 'punchmiss' event, so a punch that
    // connected never whooshed at all and a miss whooshed 0.2 s late.)
    g.events.push({ type: 'punchswing' });
    // The rig's strike reaches full extension 46% into its 0.44 s punch:
    // this is when the fist actually arrives, so the damage waits for it.
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
      // Click-to-face: if an enemy stands at (or near) the clicked point,
      // face HIM, not the bare ground point. A click lands on a figure's
      // body, whose ground projection falls a good way past his feet, so
      // aiming at the point itself walks shots past the man the player
      // clicked on. The snap happens on this very press, before the
      // bullet spawns, so the shot goes at the enemy — never a beat late.
      // Hostiles are the game's own fighters (rivals and officers); a
      // click on empty ground keeps the plain ground-point aim, untouched.
      faceShot(g);
    }
    fireBullet(g);
    p.fig.setExpression('shout');
    p.exprT = 0.3;
  }
}

/** Test one bullet against people, then cars: true when it dies on either. */
function bulletStrikes(g, bullet) {
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
      // Same rule as fists: damageCar owns the wreck crossing, so a
      // shot-out car (even the player's own) dies properly.
      damageCar(g, car, 12);
      g.events.push({ type: 'spark', x: bullet.x, y: bullet.y });
      return true;
    }
  }
  return false;
}

/** Move every bullet, test it against buildings, people and cars. */
export function updateBullets(g, dt) {
  if (g.bullets.length === 0) return;
  for (const bullet of [...g.bullets]) {
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.life -= dt;
    bullet.mesh.position.set(bullet.x, 27, bullet.y);
    let dead = bullet.life <= 0;
    if (!dead && buildingAt(g.city, bullet.x, bullet.y)) dead = true;
    if (!dead) dead = bulletStrikes(g, bullet);
    if (dead) {
      g.scene.remove(bullet.mesh);
      g.bullets.splice(g.bullets.indexOf(bullet), 1);
    }
  }
}

/** Spin the cash pickups and collect the ones the player walks over (or drives over). */
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
