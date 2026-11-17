// Combat: the player's fists and pistol, the bullets they send, and the cash that
// falls out of beaten rivals. Hits are reported through g.events (crime kinds for
// the wanted system, sounds for main.js) so this module never talks to the police
// or the speakers directly. The punch lands a beat after the swing starts, when
// the strike of the animation lands.
import * as THREE from 'three';
import { PLAYER } from './config.js';
import { buildingAt } from './city.js';
import { hurtPed } from './people.js';
import { basicMat } from './stick3d.js';
import { makeCashPickup } from './world3d.js';

const bulletGeo = new THREE.BoxGeometry(7, 1.8, 1.8);
const bulletMat = basicMat(0xffe066);

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

/** Fire one bullet from the player's hand toward the player's facing. */
function fireBullet(g) {
  const p = g.player;
  const mesh = new THREE.Mesh(bulletGeo, bulletMat);
  const fromX = p.x + Math.cos(p.angle) * 16;
  const fromY = p.y + Math.sin(p.angle) * 16;
  mesh.position.set(fromX, 27, fromY);
  mesh.rotation.y = -p.angle;
  g.scene.add(mesh);
  g.bullets.push({
    x: fromX,
    y: fromY,
    vx: Math.cos(p.angle) * PLAYER.bulletSpeed,
    vy: Math.sin(p.angle) * PLAYER.bulletSpeed,
    life: PLAYER.bulletRange / PLAYER.bulletSpeed,
    mesh,
  });
  g.events.push({ type: 'shot' });
}

/** Resolve the strike of a punch: whoever is in front of the player takes it. */
function landPunch(g) {
  const p = g.player;
  let hitSomething = false;
  for (const ped of g.peds) {
    if (ped.state === 'down' || ped.state === 'inCar') continue;
    const d = Math.hypot(ped.x - p.x, ped.y - p.y);
    if (d > PLAYER.punchRange + 8) continue;
    const dir = Math.atan2(ped.y - p.y, ped.x - p.x);
    if (Math.abs(angleDiff(dir, p.angle)) > 1.15) continue;
    hurtPed(g, ped, PLAYER.punchDamage);
    ped.x += Math.cos(dir) * 9;
    ped.y += Math.sin(dir) * 9;
    g.events.push({ type: 'crime', kind: ped.role === 'cop' ? 'punchCop' : 'punchPed', x: ped.x, y: ped.y });
    hitSomething = true;
  }
  for (const car of g.cars) {
    if (car === p.car) continue;
    const d = Math.hypot(car.x - p.x, car.y - p.y);
    if (d > 44) continue;
    car.hp -= 8;
    g.events.push({ type: 'crime', kind: 'hitCar', x: car.x, y: car.y });
    hitSomething = true;
  }
  g.events.push({ type: hitSomething ? 'punchhit' : 'punchmiss' });
}

/** The player's attacks for one frame: punch taps, held gunfire, landing strikes. */
export function updateCombat(g, dt) {
  const p = g.player;
  p.punchCd = Math.max(0, p.punchCd - dt);
  p.shotCd = Math.max(0, p.shotCd - dt);
  if (p.punchHitT > 0) {
    p.punchHitT -= dt;
    if (p.punchHitT <= 0) landPunch(g);
  }
  if (p.state !== 'foot') return;
  if (g.input.tapped('KeyF', 'KeyJ') && p.punchCd <= 0) {
    p.punchCd = PLAYER.punchCooldown;
    p.punchHitT = 0.13;
    p.fig.triggerPunch();
    p.fig.setExpression('angry');
    p.exprT = 0.45;
  }
  const wantsFire = g.input.down('KeyK') || g.input.mouse.down;
  if (p.hasPistol && wantsFire && p.shotCd <= 0) {
    p.shotCd = PLAYER.shotCooldown;
    p.aimT = 0.4;
    if (g.input.mouse.down && g.aimAngle !== null) p.angle = g.aimAngle;
    fireBullet(g);
    p.fig.setExpression('shout');
    p.exprT = 0.3;
  }
  p.fig.target.aim = p.aimT > 0 ? 1 : 0;
  if (p.aimT > 0) p.aimT -= dt;
}

/** Move every bullet, test it against buildings, people and cars. */
export function updateBullets(g, dt) {
  for (const bullet of [...g.bullets]) {
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.life -= dt;
    bullet.mesh.position.set(bullet.x, 27, bullet.y);
    let dead = bullet.life <= 0;
    if (!dead && buildingAt(g.city, bullet.x, bullet.y)) dead = true;
    if (!dead) {
      for (const ped of g.peds) {
        if (ped.state === 'down' || ped.state === 'inCar') continue;
        if (Math.hypot(ped.x - bullet.x, ped.y - bullet.y) < 15) {
          hurtPed(g, ped, PLAYER.bulletDamage);
          g.events.push({ type: 'crime', kind: ped.role === 'cop' ? 'punchCop' : 'shootPed', x: ped.x, y: ped.y });
          dead = true;
          break;
        }
      }
    }
    if (!dead) {
      for (const car of g.cars) {
        if (Math.hypot(car.x - bullet.x, car.y - bullet.y) < 27) {
          car.hp -= 12;
          g.events.push({ type: 'spark', x: bullet.x, y: bullet.y });
          dead = true;
          break;
        }
      }
    }
    if (dead) {
      g.scene.remove(bullet.mesh);
      g.bullets.splice(g.bullets.indexOf(bullet), 1);
    }
  }
}

/** Spin the cash pickups and collect the ones the player walks over (or drives over). */
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
