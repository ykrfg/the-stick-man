// Cars: chunky toon cars built from boxes and cylinders, with an inverted-hull
// outline, glass you can see the driver through, and spinning wheels. This module
// owns the car entities and their movement: traffic cars that follow the road
// network lane by lane, the player's arcade driving, and the shared collision
// resolution (buildings, other cars, pedestrians) that police cars reuse.
import * as THREE from 'three';
import { CAR, ROAD, WORLD } from './config.js';
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
  const prevSpeed = car.speed;
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  clampToWorld(car, 30);
  if (resolveCircleCollision(g.city, car, CAR.radius)) {
    if (Math.abs(prevSpeed) > 190) {
      g.events.push({ type: 'crash', strength: Math.min(1, Math.abs(prevSpeed) / 420), byPlayer: car.occupant === 'player' });
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
    const push = (rr - d) / 2;
    car.x += (dx / d) * push;
    car.y += (dy / d) * push;
    if (other.kind !== 'parked' || Math.abs(car.speed) > 200) {
      other.x -= (dx / d) * push * 0.5;
      other.y -= (dy / d) * push * 0.5;
      // A shoved car must stay consistent: kept inside the world, resolved
      // out of any building it was pushed into, and with its mesh where its
      // body actually is. Parked cars otherwise never re-sync after spawn,
      // so a pushed one used to leave its visible mesh behind at the old
      // spot while the real car sat somewhere else, invisible.
      clampToWorld(other, 30);
      resolveCircleCollision(g.city, other, CAR.radius);
      syncCarMesh(other, 0);
    }
    if (Math.abs(car.speed) > 170) {
      g.events.push({ type: 'crash', strength: 0.7, byPlayer: car.occupant === 'player' });
    }
    car.speed *= 0.55;
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

/** The player's driving: arcade acceleration, braking, steering and drag. */
export function drivePlayerCar(g, dt) {
  const car = g.player.car;
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
    // Despawn far-away traffic and respawn it elsewhere, keeping the city alive.
    const distToPlayer = Math.hypot(car.x - g.player.x, car.y - g.player.y);
    if (distToPlayer > 1500) {
      removeCar(g, car);
      spawnTrafficCar(g);
      continue;
    }
    let targetSpeed = CAR.trafficSpeed;
    // A car ahead in the same lane slows us down.
    for (const other of g.cars) {
      if (other === car) continue;
      const ahead = car.axis === 'y'
        ? Math.abs(other.x - car.lane) < 20 && (other.y - car.y) * car.dir > 0 && (other.y - car.y) * car.dir < 74
        : Math.abs(other.y - car.lane) < 20 && (other.x - car.x) * car.dir > 0 && (other.x - car.x) * car.dir < 74;
      if (ahead) targetSpeed = Math.min(targetSpeed, Math.max(0, ((car.axis === 'y' ? (other.y - car.y) * car.dir : (other.x - car.x) * car.dir) - 52) * 4));
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
}

/** Flash the police light bars (called for every police car each frame). */
export function updatePoliceLights(car, time) {
  if (!car.lightL || !car.lightR) return;
  const phase = Math.floor(time * 5) % 2 === 0;
  car.lightL.visible = phase;
  car.lightR.visible = !phase;
}
