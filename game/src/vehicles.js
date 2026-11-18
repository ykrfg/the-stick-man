// Cars: chunky toon cars built from boxes and cylinders, with an inverted-hull
// outline, glass you can see the driver through, and spinning wheels. This module
// owns the car entities and their movement: traffic cars that follow the road
// network lane by lane, the player's arcade driving, and the shared collision
// resolution (buildings, other cars, pedestrians) that police cars reuse.
import * as THREE from 'three';
import { CAR, CRASH_DAMAGE, PLAYER, ROAD, WORLD } from './config.js';
import { clampToWorld, resolveCircleCollision } from './city.js';
import { toonMat, basicMat } from './stick3d.js';

export const CAR_COLORS = [0xef6461, 0xffd166, 0x7fb5d5, 0xa8d08d, 0xf4a7c3, 0xff8a5c, 0x95d5b2, 0xf6bd60, 0xc77dff, 0xeeeeee];

const wheelGeo = new THREE.CylinderGeometry(5.6, 5.6, 4.2, 12);
wheelGeo.rotateX(Math.PI / 2);
const bodyGeo = new THREE.BoxGeometry(CAR.length, 10, CAR.width);
const cabinGeo = new THREE.BoxGeometry(24, 8.5, 20.5);

/** Build the mesh for one car. Police cars get a stripe and a flashing light bar. */
export function makeCarMesh(colorHex, police = false) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(bodyGeo, toonMat(police ? 0xf4f4f4 : colorHex));
  body.position.y = 8.5;
  const hull = new THREE.Mesh(bodyGeo, basicMat(0x17181c));
  hull.material = basicMat(0x17181c);
  hull.scale.set(1.045, 1.1, 1.06);
  hull.material.side = THREE.BackSide;
  body.add(hull);
  group.add(body);
  if (police) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(CAR.length + 0.6, 3.6, CAR.width + 0.6), basicMat(0x23232b));
    stripe.position.y = 7.2;
    group.add(stripe);
  }
  const glassMat = new THREE.MeshToonMaterial({ color: 0x9fd4e8, transparent: true, opacity: 0.5 });
  const cabin = new THREE.Mesh(cabinGeo, glassMat);
  cabin.position.set(-2, 16, 0);
  group.add(cabin);
  const wheels = [];
  for (const [wx, wz] of [[16, 12.6], [16, -12.6], [-16, 12.6], [-16, -12.6]]) {
    const wheel = new THREE.Mesh(wheelGeo, basicMat(0x1c1c22));
    wheel.position.set(wx, 5.6, wz);
    group.add(wheel);
    wheels.push(wheel);
  }
  const lightGeo = new THREE.BoxGeometry(3.2, 1.6, 5.5);
  const headL = new THREE.Mesh(lightGeo, basicMat(0xfff3a0));
  headL.position.set(24.2, 8.5, 7.5);
  const headR = headL.clone();
  headR.position.z = -7.5;
  const tailL = new THREE.Mesh(lightGeo, basicMat(0xe33f2f));
  tailL.position.set(-24.2, 8.5, 7.5);
  const tailR = tailL.clone();
  tailR.position.z = -7.5;
  group.add(headL, headR, tailL, tailR);
  let lightL = null;
  let lightR = null;
  if (police) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(13, 2.6, 9), basicMat(0x23232b));
    bar.position.set(-2, 21.2, 0); // sunk into the cabin roof, not resting exactly on it
    group.add(bar);
    const bulbGeo = new THREE.SphereGeometry(2.9, 10, 8);
    lightL = new THREE.Mesh(bulbGeo, basicMat(0xff3b30));
    lightL.position.set(-2, 24.4, 3.2);
    lightR = new THREE.Mesh(bulbGeo, basicMat(0x2f7bff));
    lightR.position.set(-2, 24.4, -3.2);
    group.add(lightL, lightR);
  }
  return { group, wheels, lightL, lightR };
}

function baseCar(kind, x, y, angle, colorHex) {
  const mesh = makeCarMesh(colorHex, kind === 'police');
  return {
    kind,
    x, y, angle,
    speed: 0,
    color: colorHex,
    mesh: mesh.group,
    wheels: mesh.wheels,
    lightL: mesh.lightL,
    lightR: mesh.lightR,
    occupant: null, // 'player', a ped object, or null
    hp: 100,
    // Knock velocity from a hard car-to-car hit (see collideCars): a free
    // car struck at speed is shoved sideways and the shove decays over a
    // few frames. Parked cars have no update loop to carry one, so they
    // take their knock as immediate displacement instead.
    shoveX: 0,
    shoveY: 0,
    // Player ownership: once the player takes a car it is theirs — the fleet
    // systems (traffic lane-following/despawn, police chase/drive-off) must
    // never touch it again. `wrecked` is the terminal state of a car beaten
    // to hp <= 0 while the player drove it: it never moves again.
    touched: false,
    wrecked: false,
    // Traffic state (lane following):
    axis: 'y', road: 0, dir: 1, lane: 0, turnCd: 0,
    // Police state:
    reverseT: 0, officerSpawned: false,
    wheelSpin: 0,
  };
}

/** Place the car's mesh from its logical (x, y, angle) and spin its wheels. */
export function syncCarMesh(car, dt) {
  // Sanitize first: one bad frame (a NaN slipped into the physics) must never
  // leave a car permanently invisible — a non-finite transform renders as
  // nothing at all, which reads to the player as "my car vanished".
  if (!Number.isFinite(car.x) || !Number.isFinite(car.y)) {
    car.x = 1600;
    car.y = 1260;
  }
  if (!Number.isFinite(car.angle)) car.angle = 0;
  if (!Number.isFinite(car.speed)) car.speed = 0;
  // A wreck sits low and tilted, so it reads as a dead car, not a good one.
  car.mesh.position.set(car.x, car.wrecked ? -1.4 : 0, car.y);
  car.mesh.rotation.y = -car.angle;
  car.mesh.rotation.z = car.wrecked ? 0.07 : 0;
  car.wheelSpin += (car.speed * dt) / 5.6;
  for (const wheel of car.wheels) wheel.rotation.z = -car.wheelSpin;
}

/** Scatter parked cars along the curbs, clear of intersections and doorways. */
export function spawnParkedCars(g) {
  const rng = g.rng;
  for (let i = 0; i < 26; i += 1) {
    const avenue = rng.pick(ROAD.avenues);
    const side = rng.chance(0.5) ? 1 : -1;
    const x = avenue + side * 41;
    const y = rng.range(120, WORLD.height - 120);
    if (ROAD.streets.some((s) => Math.abs(y - s) < 95)) continue;
    if (Math.hypot(x - g.player.x, y - g.player.y) < 130) continue;
    if (g.cars.some((c) => Math.hypot(c.x - x, c.y - y) < 70)) continue;
    const dir = side > 0 ? 1 : -1; // parked facing the traffic direction of their side
    const car = baseCar('parked', x, y, dir > 0 ? Math.PI / 2 : -Math.PI / 2, rng.pick(CAR_COLORS));
    car.axis = 'y';
    car.road = avenue;
    car.dir = dir;
    g.cars.push(car);
    g.scene.add(car.mesh);
    syncCarMesh(car, 0);
  }
}

/** Create one traffic car on a random road, away from the player. */
export function spawnTrafficCar(g) {
  const rng = g.rng;
  for (let tries = 0; tries < 8; tries += 1) {
    const onAvenue = rng.chance(0.55);
    const road = onAvenue ? rng.pick(ROAD.avenues) : rng.pick(ROAD.streets);
    const dir = rng.chance(0.5) ? 1 : -1;
    const along = rng.range(100, (onAvenue ? WORLD.height : WORLD.width) - 100);
    const lane = road + (dir > 0 ? -26 : 26);
    const x = onAvenue ? lane : along;
    const y = onAvenue ? along : lane;
    const dxp = x - g.player.x;
    const dyp = y - g.player.y;
    if (Math.hypot(dxp, dyp) < 560) continue;
    // Nor anywhere inside the view box around the player: a fresh car
    // must drive into the world, never materialize on screen — not even
    // at the edge of the frame.
    if (Math.abs(dxp) < 700 && Math.abs(dyp) < 460) continue;
    if (g.cars.some((c) => Math.hypot(c.x - x, c.y - y) < 80)) continue;
    const car = baseCar('traffic', x, y, 0, rng.pick(CAR_COLORS));
    car.axis = onAvenue ? 'y' : 'x';
    car.road = road;
    car.dir = dir;
    car.lane = lane;
    car.angle = car.axis === 'y' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
    car.speed = CAR.trafficSpeed * rng.range(0.8, 1.05);
    g.cars.push(car);
    g.scene.add(car.mesh);
    syncCarMesh(car, 0);
    return car;
  }
  return null;
}

/** Create a plain car of any kind at an exact spot (used by the screenshot scenes). */
export function spawnCar(g, kind, x, y, angle, colorHex) {
  const car = baseCar(kind, x, y, angle, colorHex);
  g.cars.push(car);
  g.scene.add(car.mesh);
  syncCarMesh(car, 0);
  return car;
}

/** Create a police car (used by police.js) at a road point. */
export function spawnPoliceCar(g, x, y) {
  const car = baseCar('police', x, y, 0, 0xf4f4f4);
  g.cars.push(car);
  g.scene.add(car.mesh);
  syncCarMesh(car, 0);
  return car;
}

/** Remove a car from the world entirely (despawned police, wrecked traffic). */
export function removeCar(g, car) {
  g.scene.remove(car.mesh);
  const i = g.cars.indexOf(car);
  if (i >= 0) g.cars.splice(i, 1);
}

/**
 * A shoved car must stay consistent: kept inside the world, resolved out
 * of any building it was pushed into, and with its mesh where its body
 * actually is. Parked cars otherwise never re-sync after spawn, so a
 * pushed one used to leave its visible mesh behind at the old spot while
 * the real car sat somewhere else, invisible.
 */
function settleShovedCar(g, other) {
  clampToWorld(other, 30);
  resolveCircleCollision(g.city, other, CAR.radius);
  syncCarMesh(other, 0);
}

/** Carry a car's knock velocity for one frame, decaying fast. */
function applyShove(car, dt) {
  if (!car.shoveX && !car.shoveY) return;
  car.x += car.shoveX * dt;
  car.y += car.shoveY * dt;
  const decay = Math.max(0, 1 - 5 * dt);
  car.shoveX *= decay;
  car.shoveY *= decay;
  if (Math.abs(car.shoveX) < 2) car.shoveX = 0;
  if (Math.abs(car.shoveY) < 2) car.shoveY = 0;
}

/**
 * The wreck state, entered at hp <= 0 however the damage arrived (crash,
 * fists, a wall): sunk and tilted via syncCarMesh, speed zero, never
 * enterable (nearestEnterableCar skips wrecked), and no fleet system
 * moves it again — traffic and police updates both skip wrecked cars.
 */
export function wreckCar(g, car) {
  if (car.wrecked) return;
  car.wrecked = true;
  car.speed = 0;
  car.shoveX = 0;
  car.shoveY = 0;
  syncCarMesh(car, 0);
}

/**
 * Apply damage to a car; crossing to zero enters the wreck state. When
 * the PLAYER's car is wrecked out from under him, a 'playerwreck' event
 * lets main.js run the forced-exit flow (the same one flying fists use).
 */
export function damageCar(g, car, amount) {
  if (car.wrecked || !(amount > 0)) return;
  car.hp = Math.max(0, car.hp - amount);
  if (car.hp <= 0) {
    wreckCar(g, car);
    if (car.occupant === 'player') g.events.push({ type: 'playerwreck', car });
  }
}

/**
 * Move a free-driving car (player's or police) by its angle and speed, resolving
 * building collisions (with a crash event when the impact is hard), car-to-car
 * bumps and pedestrian run-overs (reported through g.events for main.js to judge).
 */
export function moveFreeCar(g, car, dt) {
  if (car.wrecked) {
    car.speed = 0;
    syncCarMesh(car, dt);
    return;
  }
  applyShove(car, dt);
  const prevSpeed = car.speed;
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  clampToWorld(car, 30);
  const attX = car.x;
  const attY = car.y;
  if (resolveCircleCollision(g.city, car, CAR.radius)) {
    if (Math.abs(prevSpeed) > 190) {
      g.events.push({ type: 'crash', strength: Math.min(1, Math.abs(prevSpeed) / 420), byPlayer: car.occupant === 'player' });
    }
    // Wall damage follows the speed INTO the wall, not the raw speed:
    // the resolver's push-out vector points along the wall's normal, so
    // the closing speed is the velocity component against it. Rubbing
    // along a facade while parking has almost no inward component and
    // stays free; a fast head-on pays the struck car's share of damage.
    const pushX = car.x - attX;
    const pushY = car.y - attY;
    const pushLen = Math.hypot(pushX, pushY);
    if (pushLen > 0.01) {
      const vx = Math.cos(car.angle) * prevSpeed;
      const vy = Math.sin(car.angle) * prevSpeed;
      const closing = -(vx * (pushX / pushLen) + vy * (pushY / pushLen));
      if (closing > 80) {
        damageCar(g, car, Math.min(1, closing / 420) * CRASH_DAMAGE.wall);
      }
    }
    car.speed = -prevSpeed * 0.22;
  }
  for (const other of g.cars) {
    if (other === car) continue;
    const dx = car.x - other.x;
    const dy = car.y - other.y;
    const d2 = dx * dx + dy * dy;
    const rr = CAR.radius + CAR.radius - 4;
    if (d2 >= rr * rr || d2 < 0.01) continue;
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    // The impact of a bump is the CLOSING SPEED along the contact normal —
    // how fast the gap between the two cars is shrinking — never either
    // car's raw speed. Two cars cruising at the same speed have a closing
    // speed of zero: they must grind against each other, not bounce apart.
    const relVx = Math.cos(car.angle) * car.speed - Math.cos(other.angle) * (other.speed || 0);
    const relVy = Math.sin(car.angle) * car.speed - Math.sin(other.angle) * (other.speed || 0);
    const closing = -(relVx * nx + relVy * ny);
    // Positional separation always applies: it is what lets a slow push
    // grind a stopped or slower car ahead of you instead of bouncing off.
    const push = (rr - d) / 2;
    car.x += nx * push;
    car.y += ny * push;
    if (other.kind !== 'parked' || closing > 25) {
      other.x -= nx * push * 0.5;
      other.y -= ny * push * 0.5;
      settleShovedCar(g, other);
    }
    if (closing > 55) {
      // A real impact, and its strength follows the speed DIFFERENCE (the
      // same /420 scale as a building hit, so the crash sound, the camera
      // shake and the hitCar heat in main.js all track the actual blow).
      const strength = Math.min(1, closing / 420);
      if (other.kind === 'parked') {
        // Parked cars have no update loop to carry a shove velocity, so
        // the knock lands as extra displacement right now.
        const extra = Math.min(30, closing * 0.09);
        other.x -= nx * extra;
        other.y -= ny * extra;
        settleShovedCar(g, other);
      } else {
        other.shoveX -= nx * closing * 0.75;
        other.shoveY -= ny * closing * 0.75;
      }
      // The mover sheds speed in proportion to the blow: a brush at
      // matched speed costs almost nothing, a full-tilt rear-end still
      // costs about half. Below the threshold there is no cut at all —
      // the grind keeps its speed and shoves the other car ahead.
      car.speed *= 1 - 0.5 * strength;
      // Both cars pay for a real impact, the struck car more than the
      // mover (CRASH_DAMAGE). A wrecked car takes no further damage;
      // damageCar handles the crossing into the wreck state.
      damageCar(g, car, strength * CRASH_DAMAGE.mover);
      damageCar(g, other, strength * CRASH_DAMAGE.struck);
      g.events.push({ type: 'crash', strength, byPlayer: car.occupant === 'player' });
    }
  }
  if (Math.abs(car.speed) > 55) {
    for (const ped of g.peds) {
      if (ped.state === 'down' || ped.state === 'inCar') continue;
      const dx = ped.x - car.x;
      const dy = ped.y - car.y;
      if (dx * dx + dy * dy < 26 * 26) {
        g.events.push({ type: 'runover', ped, speed: Math.abs(car.speed), byPlayer: car.occupant === 'player' });
      }
    }
  }
  syncCarMesh(car, dt);
}

const PLAYER_HIT_RANGE = 30;

/**
 * The on-foot player vs moving cars. He is not a ped, and nothing used
 * to touch him: cars passed through him without consequence. Now the
 * same relative-speed philosophy as car-to-car applies — a car rolling
 * at grind speed (<= 55) only shoulders him aside, but a car with real
 * speed behind it hits him: speed-scaled damage, a knockback that
 * throws him clear (people.js carries it as a brief down/stagger), and
 * a second of post-hit invulnerability (p.hurtT) so one car cannot
 * multi-tap him to death. Traffic and police cars alike. A fast enough
 * hit at low health wastes him through the usual hp <= 0 flow.
 */
export function updatePlayerCarHits(g) {
  const p = g.player;
  if (p.state !== 'foot' || g.transition) return;
  for (const car of g.cars) {
    if (car.occupant === 'player') continue;
    const dx = p.x - car.x;
    const dy = p.y - car.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= PLAYER_HIT_RANGE * PLAYER_HIT_RANGE) continue;
    const d = Math.sqrt(d2) || 1;
    const nx = dx / d;
    const ny = dy / d;
    const speed = Math.abs(car.speed);
    if (speed <= 55) {
      // Slow roll: no damage, just out of the way.
      p.x = car.x + nx * PLAYER_HIT_RANGE;
      p.y = car.y + ny * PLAYER_HIT_RANGE;
      continue;
    }
    if ((p.hurtT ?? 0) > 0) continue;
    const strength = Math.min(1, speed / 440);
    p.hp -= Math.round(15 + strength * 70);
    // Knockback: away from the car, blended with its travel direction,
    // so he is thrown clear of the path instead of under the wheels.
    const fx = Math.cos(car.angle) * Math.sign(car.speed);
    const fy = Math.sin(car.angle) * Math.sign(car.speed);
    let kx = nx * 0.7 + fx * 0.7;
    let ky = ny * 0.7 + fy * 0.7;
    const kl = Math.hypot(kx, ky) || 1;
    const power = 300 + speed * 1.1;
    p.kbX = (kx / kl) * power;
    p.kbY = (ky / kl) * power;
    p.downT = 0.55;
    p.hurtT = 1.0;
    p.exprT = 1.1;
    p.fig.setExpression('angry');
    g.shake = Math.max(g.shake, 4 + strength * 7);
    g.sfx.hurt();
    break; // one hit per frame is plenty
  }
  resolveCircleCollision(g.city, p, PLAYER.radius);
  clampToWorld(p, 20);
}

/** The player's driving: arcade acceleration, braking, steering and drag. */
export function drivePlayerCar(g, dt) {  const car = g.player.car;
  if (!car || car.wrecked) return;
  const axes = g.input.axes();
  const throttle = -axes.y;
  const steer = axes.x;
  if (throttle > 0) {
    car.speed = Math.min(CAR.maxSpeed, car.speed + CAR.accel * dt);
  } else if (throttle < 0) {
    if (car.speed > 12) car.speed = Math.max(0, car.speed - CAR.brake * dt);
    else car.speed = Math.max(-CAR.maxReverse, car.speed - CAR.accel * 0.7 * dt);
  } else {
    car.speed -= car.speed * 0.5 * dt;
    if (Math.abs(car.speed) < 4) car.speed = 0;
  }
  if (car.speed !== 0) {
    const grip = Math.max(-1, Math.min(1, car.speed / 130));
    car.angle += steer * CAR.turnRate * dt * grip;
  }
  moveFreeCar(g, car, dt);
  // The player rides inside: keep the figure glued to the driver's seat.
  g.player.x = car.x;
  g.player.y = car.y;
}

/** Traffic: follow the lane, slow for the car ahead, sometimes turn at crossings. */
export function updateTraffic(g, dt) {
  for (const car of [...g.cars]) {
    if (car.kind !== 'traffic') continue;
    // A car the player has taken is theirs: never lane-drive it out from
    // under them and never despawn it. finishEnterCar already converts its
    // kind away from 'traffic'; this is the belt-and-braces check so no
    // path (a scramble interrupted mid-enter, a scene seating) can ever
    // hand an occupied or player-owned car to the fleet logic.
    if (car.touched || car.occupant === 'player' || car.wrecked) continue;
    // A knock from a harder car still lands: the shove's along-lane part
    // persists (the lane glue below only re-seats the lateral coordinate).
    applyShove(car, dt);
    // Despawn far-away traffic and respawn it elsewhere, keeping the city alive.
    const distToPlayer = Math.hypot(car.x - g.player.x, car.y - g.player.y);
    if (distToPlayer > 1500) {
      removeCar(g, car);
      spawnTrafficCar(g);
      continue;
    }
    let targetSpeed = CAR.trafficSpeed;
    // A car ahead in my path slows us down. The corridor is wider than
    // my lane on purpose: a car CROSSING my path at an intersection
    // (laterally near my lane line while it passes) counts too, so
    // traffic brakes for a crossing car instead of driving into its
    // flank and merging with it at the corner.
    for (const other of g.cars) {
      if (other === car) continue;
      const lateral = car.axis === 'y' ? other.x - car.lane : other.y - car.lane;
      const along = car.axis === 'y' ? (other.y - car.y) * car.dir : (other.x - car.x) * car.dir;
      if (Math.abs(lateral) < 34 && along > 0 && along < 80) {
        targetSpeed = Math.min(targetSpeed, Math.max(0, (along - 52) * 4));
      }
    }
    car.speed += Math.max(-260 * dt, Math.min(200 * dt, targetSpeed - car.speed));
    const along = (car.axis === 'y' ? car.y : car.x) + car.dir * car.speed * dt;
    if (car.axis === 'y') car.y = along;
    else car.x = along;
    car.turnCd -= dt;
    // At a crossing, maybe turn onto the crossing road.
    const crossings = car.axis === 'y' ? ROAD.streets : ROAD.avenues;
    for (const cross of crossings) {
      const pos = car.axis === 'y' ? car.y : car.x;
      if (Math.abs(pos - cross) < Math.abs(car.speed * dt) + 3 && car.turnCd <= 0) {
        car.turnCd = 1.2;
        if (g.rng.chance(0.38)) {
          const newDir = g.rng.chance(0.5) ? 1 : -1;
          const crossRoad = cross;
          if (car.axis === 'y') {
            car.axis = 'x';
            car.road = crossRoad;
            car.dir = newDir;
            car.lane = crossRoad + (newDir > 0 ? 26 : -26);
            car.y = car.lane;
            car.angle = newDir > 0 ? 0 : Math.PI;
          } else {
            car.axis = 'y';
            car.road = crossRoad;
            car.dir = newDir;
            car.lane = crossRoad + (newDir > 0 ? -26 : 26);
            car.x = car.lane;
            car.angle = newDir > 0 ? Math.PI / 2 : -Math.PI / 2;
          }
        }
      }
    }
    // Keep the lateral position glued to the lane, and stay in the world.
    if (car.axis === 'y') car.x = car.lane;
    else car.y = car.lane;
    if (car.x < 40 || car.x > WORLD.width - 40 || car.y < 40 || car.y > WORLD.height - 40) {
      removeCar(g, car);
      spawnTrafficCar(g);
      continue;
    }
    syncCarMesh(car, dt);
  }
  separateTrafficCars(g);
}

/**
 * Traffic cars must never REST overlapped. Lane-following alone cannot
 * promise that: two cars can arrive at a crossing together, and a
 * turning car snaps laterally onto its new lane in one frame — the
 * user's screenshot showed four or five cars interpenetrating in one
 * stack at a corner. This pairwise pass runs once per frame after the
 * lane updates (few traffic cars, only nearby pairs considered):
 * overlapping cars are pushed apart along their centre line, capped
 * per step so a three-car meeting converges over a few frames instead
 * of exploding, and each pushed traffic car is immediately re-glued
 * to its lane laterally — the lasting effect is along-axis spacing,
 * i.e. a queue, not a sideways shove into the next lane. Parked cars,
 * police cars and wrecks are immovable partners (the traffic car
 * takes the whole correction); another traffic car shares it. The
 * widened yield corridor in updateTraffic stops new overlaps from
 * forming; this pass is the guarantee for the ones that still do.
 */
function separateTrafficCars(g) {
  const MIN = CAR.radius * 2 - 2; // centres closer than this are interpenetrating
  const cars = g.cars;
  for (let i = 0; i < cars.length; i += 1) {
    const a = cars[i];
    if (a.kind !== 'traffic' || a.touched || a.wrecked || a.occupant === 'player') continue;
    for (let j = 0; j < cars.length; j += 1) {
      if (j === i) continue;
      const b = cars[j];
      if (b.occupant === 'player') continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= MIN * MIN || d2 < 0.01) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d;
      const ny = dy / d;
      const overlap = MIN - d;
      const bMovable = b.kind === 'traffic' && !b.touched && !b.wrecked;
      const aPush = Math.min(bMovable ? overlap / 2 : overlap, 18);
      a.x += nx * aPush;
      a.y += ny * aPush;
      if (bMovable) {
        const bPush = Math.min(overlap / 2, 18);
        b.x -= nx * bPush;
        b.y -= ny * bPush;
        if (b.axis === 'y') b.x = b.lane;
        else b.y = b.lane;
        resolveCircleCollision(g.city, b, CAR.radius);
        syncCarMesh(b, 0);
      }
      if (a.axis === 'y') a.x = a.lane;
      else a.y = a.lane;
      resolveCircleCollision(g.city, a, CAR.radius);
      syncCarMesh(a, 0);
    }
  }
}

/** Flash the police light bars (called for every police car each frame). */
export function updatePoliceLights(car, time) {
  if (!car.lightL || !car.lightR) return;
  const phase = Math.floor(time * 5) % 2 === 0;
  car.lightL.visible = phase;
  car.lightR.visible = !phase;
}
