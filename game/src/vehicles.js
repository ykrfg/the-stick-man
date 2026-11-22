// Cars: chunky toon cars built from boxes and cylinders, with an inverted-hull
// outline, glass you can see the driver through, and spinning wheels. This module
// owns the car entities and their movement: traffic cars that follow the road
// network lane by lane, the player's arcade driving, and the shared collision
// resolution (buildings, other cars, pedestrians) that police cars reuse.
import * as THREE from 'three';
import { CAR, COURIER_HP, CRASH_DAMAGE, CRASH_GRACE, DRIVEN_CRASH_TAKEN, MOTORS, NEON, PLAYER, ROAD, TRAFFIC_WARN, TRAFFIC_YIELD, WORLD, WRECK_BURN } from './config.js';
import { clampToWorld, resolveCircleCollision } from './city.js';
import { basicMat, toonMat } from './stick3d.js';
import { makeGlowSprite, nightLevel } from './gfx.js';

export const CAR_COLORS = [0xef6461, 0xffd166, 0x7fb5d5, 0xa8d08d, 0xf4a7c3, 0xff8a5c, 0x95d5b2, 0xf6bd60, 0xc77dff, 0xeeeeee];

const wheelGeo = new THREE.CylinderGeometry(5.6, 5.6, 4.2, 12);
wheelGeo.rotateX(Math.PI / 2);
const bodyGeo = new THREE.BoxGeometry(CAR.length, 10, CAR.width);
const cabinGeo = new THREE.BoxGeometry(24, 8.5, 20.5);
// Shared sub-parts: every car uses the same light, stripe, bar and bulb
// shapes and the same glass. They were rebuilt per car.
const lightGeo = new THREE.BoxGeometry(3.2, 1.6, 5.5);
const stripeGeo = new THREE.BoxGeometry(CAR.length + 0.6, 3.6, CAR.width + 0.6);
const barGeo = new THREE.BoxGeometry(13, 2.6, 9);
const bulbGeo = new THREE.SphereGeometry(2.9, 10, 8);
const glassMat = new THREE.MeshToonMaterial({ color: 0x9fd4e8, transparent: true, opacity: 0.5 });

/** Build the mesh for one car. Police cars get a stripe and a flashing light bar. */
export function makeCarMesh(colorHex, police = false) {
  const group = new THREE.Group();
  // Yaw first, then roll about the car's own nose (syncCarMesh writes
  // rotation.x with the body roll). Without this order a roll would tip
  // the car about a world axis instead of its own.
  group.rotation.order = 'YXZ';
  const body = new THREE.Mesh(bodyGeo, toonMat(police ? 0xf4f4f4 : colorHex));
  body.position.y = 8.5;
  const hull = new THREE.Mesh(bodyGeo, basicMat(0x17181c));
  hull.material = basicMat(0x17181c);
  hull.scale.set(1.045, 1.1, 1.06);
  hull.material.side = THREE.BackSide;
  body.add(hull);
  group.add(body);
  if (police) {
    const stripe = new THREE.Mesh(stripeGeo, basicMat(0x23232b));
    stripe.position.y = 7.2;
    group.add(stripe);
  }
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
  const headL = new THREE.Mesh(lightGeo, basicMat(0xfff3a0));
  headL.position.set(24.2, 8.5, 7.5);
  const headR = headL.clone();
  headR.position.z = -7.5;
  const tailL = new THREE.Mesh(lightGeo, basicMat(0xe33f2f));
  tailL.position.set(-24.2, 8.5, 7.5);
  const tailR = tailL.clone();
  tailR.position.z = -7.5;
  group.add(headL, headR, tailL, tailR);
  // A soft bloom on the nose: headlights are what reads on a night street.
  const beam = makeGlowSprite(72, 0xffe6a8);
  beam.position.set(30, 10, 0);
  group.add(beam);
  let lightL = null;
  let lightR = null;
  let glowL = null;
  let glowR = null;
  if (police) {
    const bar = new THREE.Mesh(barGeo, basicMat(0x23232b));
    bar.position.set(-2, 21.2, 0); // sunk into the cabin roof, not resting exactly on it
    group.add(bar);
    lightL = new THREE.Mesh(bulbGeo, basicMat(0xff3b30));
    lightL.position.set(-2, 24.4, 3.2);
    lightR = new THREE.Mesh(bulbGeo, basicMat(0x2f7bff));
    lightR.position.set(-2, 24.4, -3.2);
    group.add(lightL, lightR);
    // The bar itself blooms red and blue, and the two alternate.
    glowL = makeGlowSprite(64, 0xff3b30);
    glowL.position.set(-2, 24.4, 3.2);
    glowR = makeGlowSprite(64, 0x2f7bff);
    glowR.position.set(-2, 24.4, -3.2);
    group.add(glowL, glowR);
  }
  return { group, wheels, lightL, lightR, beam, glowL, glowR };
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
    beam: mesh.beam,
    glowL: mesh.glowL,
    glowR: mesh.glowR,
    sirenT: 0,
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
    // Wreck afterlife (updateWrecks): seconds spent burning, the fire
    // effect group while it burns, and how far the dead car has sunk
    // while it fades away. None of it is saved — wrecks are world state,
    // never progress.
    burnT: 0,
    fireFx: null,
    sinkY: 0,
    // Crash-encounter record (player's car only, written by moveFreeCar):
    // the partner whose crash impact last damaged this car, and the
    // window during which that same partner cannot damage it again.
    // The record clears early once the pair has properly parted (see
    // the top of moveFreeCar), so a genuinely new encounter counts.
    crashPartner: null,
    crashPartnerUntil: 0,
    // Driving feel only (the player's car): body roll into a corner, and
    // the handbrake's slide — the angle by which the car's travel lags
    // its nose. Both settle back to 0 on their own.
    lean: 0,
    drift: 0,
    skidT: 0,
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
  if (!Number.isFinite(car.lean)) car.lean = 0;
  if (!Number.isFinite(car.drift)) car.drift = 0;
  // A wreck sits low and tilted, so it reads as a dead car, not a good
  // one — and lower still while it sinks away at the end of its burn
  // (sinkY is updateWrecks' doing; every sync path honours it).
  car.mesh.position.set(car.x, (car.wrecked ? -1.4 : 0) - (car.sinkY ?? 0), car.y);
  car.mesh.rotation.y = -car.angle;
  car.mesh.rotation.x = car.wrecked ? 0 : car.lean;
  car.mesh.rotation.z = car.wrecked ? 0.07 : 0;
  car.wheelSpin += (car.speed * dt) / 5.6;
  // Night-only light bloom: headlights always, the patrol bar alternating.
  const night = nightLevel();
  if (car.beam) {
    car.beam.material.opacity = car.wrecked ? 0 : night * 0.6;
    car.beam.visible = !car.wrecked && night > 0.02;
  }
  if (car.glowL && car.lightL) {
    car.sirenT = (car.sirenT ?? 0) + dt;
    const on = car.lightL.visible && !car.wrecked;
    const phase = Math.floor(car.sirenT * 3.4) % 2 === 0;
    car.glowL.material.opacity = on ? night * (phase ? 0.95 : 0.08) : 0;
    car.glowR.material.opacity = on ? night * (phase ? 0.08 : 0.95) : 0;
    car.glowL.visible = on && night > 0.02;
    car.glowR.visible = on && night > 0.02;
  }
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
 * The COURIER HIT car: a charcoal wagon looping the city's ring of road
 * centres — street 720 east, avenue 2480 south, street 2040 west, avenue
 * 720 north. It is nobody's fleet car (kind 'courier': traffic ignores
 * it, police ignore it, and the player cannot climb in — a driver sits
 * at the wheel with the doors locked, see nearestEnterableCar in
 * main.js). It carries extra HP (COURIER_HP), drives itself through
 * moveFreeCar so the crash-damage system is what stops it, and tracks
 * how long it has been held near-stationary (stillT) so the mission
 * can also accept a good pin as a stop.
 */
export function spawnCourierCar(g) {
  const car = baseCar('courier', 694, 720, 0, 0x39424e);
  car.hp = COURIER_HP;
  car.wps = [
    { x: 2480, y: 720 },
    { x: 2480, y: 2040 },
    { x: 720, y: 2040 },
    { x: 720, y: 720 },
  ];
  car.wp = 0;
  car.stillT = 0;
  car.speed = 200;
  g.cars.push(car);
  g.scene.add(car.mesh);
  syncCarMesh(car, 0);
  return car;
}

/**
 * Drive the courier for one frame (called by missions.js while the
 * intercept step runs): steer for the next loop waypoint, cruise the
 * ring, hurry when the player's car closes in. All collision, crash
 * damage and run-over reporting comes free from moveFreeCar.
 */
export function driveCourier(g, car, dt) {
  if (car.wrecked) {
    car.speed = 0;
    car.stillT = (car.stillT ?? 0) + dt;
    syncCarMesh(car, dt);
    return;
  }
  const wp = car.wps[car.wp ?? 0];
  if (wp) {
    const dx = wp.x - car.x;
    const dy = wp.y - car.y;
    if (Math.hypot(dx, dy) < 85) car.wp = ((car.wp ?? 0) + 1) % car.wps.length;
    const desired = Math.atan2(dy, dx);
    let diff = desired - car.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    car.angle += Math.max(-2.0 * dt, Math.min(2.0 * dt, diff));
  }
  const p = g.player;
  const fleeing = p.state === 'car' && Math.hypot(p.x - car.x, p.y - car.y) < 360;
  const target = fleeing ? 295 : 200;
  car.speed += Math.max(-300 * dt, Math.min(240 * dt, target - car.speed));
  moveFreeCar(g, car, dt);
  car.stillT = Math.abs(car.speed) < 25 ? (car.stillT ?? 0) + dt : 0;
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
  // The burn starts now: updateWrecks raises the flames on its next
  // pass and runs the wreck's whole afterlife from this clock.
  car.burnT = 0;
  car.sinkY = 0;
  syncCarMesh(car, 0);
}

// --- Wreck fire ---------------------------------------------------------
// A wreck burns so "destroyed" reads at a glance, then leaves the world
// so a dead car cannot block a lane forever. The whole show is sprites
// and timing — the fire deals no damage, applies no heat, and touches no
// mission, police or save state. Two shared canvas textures (a flame
// blob, a smoke puff) serve every wreck; each burning car owns only its
// sprite materials, created when it catches and disposed when the fire
// goes out. Animation is analytic in g.time, so nothing allocates and
// nothing drifts per frame.

let flameTexture = null;
let smokeTexture = null;

/** The two shared fire textures, drawn once: flame blob and smoke puff. */
function fireTextures() {
  if (flameTexture) return { flameTexture, smokeTexture };
  const fc = document.createElement('canvas');
  fc.width = 64;
  fc.height = 64;
  const fx = fc.getContext('2d');
  const fg = fx.createRadialGradient(32, 40, 2, 32, 34, 30);
  fg.addColorStop(0, 'rgba(255,244,200,1)');
  fg.addColorStop(0.3, 'rgba(255,196,64,0.95)');
  fg.addColorStop(0.65, 'rgba(255,110,32,0.55)');
  fg.addColorStop(1, 'rgba(255,80,20,0)');
  fx.fillStyle = fg;
  fx.beginPath();
  fx.arc(32, 34, 30, 0, Math.PI * 2);
  fx.fill();
  flameTexture = new THREE.CanvasTexture(fc);
  const sc = document.createElement('canvas');
  sc.width = 64;
  sc.height = 64;
  const sx = sc.getContext('2d');
  const sg = sx.createRadialGradient(32, 32, 2, 32, 32, 30);
  sg.addColorStop(0, 'rgba(255,255,255,0.85)');
  sg.addColorStop(0.6, 'rgba(255,255,255,0.4)');
  sg.addColorStop(1, 'rgba(255,255,255,0)');
  sx.fillStyle = sg;
  sx.beginPath();
  sx.arc(32, 32, 30, 0, Math.PI * 2);
  sx.fill();
  smokeTexture = new THREE.CanvasTexture(sc);
  return { flameTexture, smokeTexture };
}

/** Raise a wreck's fire: three flames along the body, four smoke puffs. */
function makeFireFx(g, car) {
  const { flameTexture: fTex, smokeTexture: sTex } = fireTextures();
  const group = new THREE.Group();
  const flames = [];
  for (const d of [{ x: -13, y: 15, s: 17 }, { x: 1, y: 18, s: 22 }, { x: 13, y: 14, s: 15 }]) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: fTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.95,
    }));
    sp.position.set(d.x, d.y, 0);
    sp.scale.set(d.s, d.s * 1.3, 1);
    sp.renderOrder = 940;
    group.add(sp);
    flames.push({ sp, base: d.s, y: d.y });
  }
  const smokes = [];
  for (let i = 0; i < 4; i += 1) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sTex, color: 0x35353c, transparent: true, depthWrite: false, opacity: 0,
    }));
    sp.renderOrder = 939;
    group.add(sp);
    smokes.push({ sp, phase: i / 4 });
  }
  group.position.set(car.x, 0, car.y);
  group.rotation.y = -car.angle;
  g.scene.add(group);
  // A fixed per-car seed from where it died — no rng draws, so the fire
  // can never perturb the seeded sequences anything else relies on.
  return { group, flames, smokes, seed: Math.abs(car.x * 0.371 + car.y * 0.733) % 10 };
}

/** Put a wreck's fire out and free its sprite materials. */
function removeFireFx(g, car) {
  const fx = car.fireFx;
  if (!fx) return;
  g.scene.remove(fx.group);
  for (const f of fx.flames) f.sp.material.dispose();
  for (const s of fx.smokes) s.sp.material.dispose();
  car.fireFx = null;
}

/**
 * Mission-critical cars — the REPO JOB's gold car and the COURIER HIT
 * car, while their mission is active — burn but are never removed: the
 * mission still points at them, and a despawn would soft-lock it. The
 * references live on g.mission and are cleared by the mission itself
 * when the car stops being its business (delivered, taken, cleaned up).
 */
function isMissionCritical(g, car) {
  const m = g.mission;
  return !!(m && m.active && (m.targetCar === car || m.courier === car));
}

/**
 * The REPO JOB's marked car, while that job is running: the one car in
 * Palmera that can never be wrecked. damageCar floors its hp at 1, so
 * it takes every hit — shoved, slowed, its hp billed down to the
 * floor — but never crosses into the wreck state: a wrecked objective
 * car could never be driven to the pier, and the job could neither
 * complete nor fail. Deliberately NOT the courier (stopping that car
 * by wrecking it is mission 5's intercept condition) and not any other
 * mission or job car. The guard dies with the job: delivery and
 * failMission both clear m.targetCar, and from then on the car wrecks
 * like any other.
 */
function isRepoTarget(g, car) {
  const m = g.mission;
  return !!(m && m.active && m.index === 3 && m.targetCar === car);
}

/**
 * Run every wreck's afterlife for one frame: flames up while it burns,
 * dying down at the end of WRECK_BURN.burn, then the sink and removal
 * over WRECK_BURN.fade — except mission-critical wrecks, player-owned
 * wrecks (bought cars never despawn; the desk un-wrecks them for a fee)
 * and any wreck still occupied, which stay in the world as plain
 * wrecks. A traffic wreck that leaves is replaced off-screen, the same
 * bargain updateTraffic makes when it despawns a distant car.
 */
export function updateWrecks(g, dt) {
  for (const car of [...g.cars]) {
    if (!car.wrecked) {
      // Back from the dead (a wreck repaired at Spray 'n Go, or a
      // bought car un-wrecked at the desk): the fire goes out with
      // the wreck state, and any sink is undone.
      if (car.fireFx) removeFireFx(g, car);
      if (car.sinkY) {
        car.sinkY = 0;
        syncCarMesh(car, 0);
      }
      continue;
    }
    car.burnT = (car.burnT ?? 0) + dt;
    if (car.burnT < WRECK_BURN.burn) {
      if (!car.fireFx) car.fireFx = makeFireFx(g, car);
      const fx = car.fireFx;
      fx.group.position.set(car.x, 0, car.y);
      fx.group.rotation.y = -car.angle;
      // The fire dies down over its last four seconds.
      const dieDown = Math.min(1, (WRECK_BURN.burn - car.burnT) / 4);
      fx.flames.forEach((f, i) => {
        const flick = 0.82 + 0.28 * Math.sin(g.time * 23 + fx.seed * 7 + i * 2.3) * Math.sin(g.time * 9.1 + i * 1.7);
        const s = f.base * flick * Math.max(0.12, dieDown);
        f.sp.scale.set(s, s * 1.3, 1);
        f.sp.material.opacity = 0.95 * Math.max(0.15, dieDown);
        f.sp.position.y = f.y + Math.sin(g.time * 13 + i * 2.0) * 1.2;
      });
      fx.smokes.forEach((s, i) => {
        const cyc = (g.time * 0.14 + s.phase + fx.seed * 0.05) % 1; // ~7 s rise
        s.sp.position.set(
          Math.sin(fx.seed * 9 + i * 2.4) * 6 + cyc * 10,
          24 + cyc * 52,
          Math.cos(fx.seed * 7 + i) * 5,
        );
        const sc = 12 + cyc * 26;
        s.sp.scale.set(sc, sc, 1);
        s.sp.material.opacity = 0.34 * Math.sin(Math.min(1, cyc) * Math.PI) * Math.min(1, dieDown + 0.25);
      });
      continue;
    }
    // The fire is out.
    if (car.fireFx) removeFireFx(g, car);
    if (isMissionCritical(g, car) || car.owned || car.occupant) continue; // stays a plain wreck
    car.sinkY = Math.min(1, (car.burnT - WRECK_BURN.burn) / WRECK_BURN.fade) * 27;
    syncCarMesh(car, 0);
    if (car.burnT >= WRECK_BURN.burn + WRECK_BURN.fade) {
      const replace = car.kind === 'traffic' && !car.touched;
      removeCar(g, car);
      if (replace) spawnTrafficCar(g);
    }
  }
}

/**
 * Apply damage to a car; crossing to zero enters the wreck state. When
 * the PLAYER's car is wrecked out from under him, a 'playerwreck' event
 * lets main.js run the forced-exit flow (the same one flying fists use).
 */
export function damageCar(g, car, amount) {
  if (car.wrecked || !(amount > 0)) return;
  // The REPO JOB's marked car floors at 1 hp instead of crossing to
  // zero (see isRepoTarget): every damage path — fists, bullets and,
  // via crashDamageCar below, crashes — funnels through here, so this
  // one floor withholds the wreck from every source at once.
  car.hp = Math.max(isRepoTarget(g, car) ? 1 : 0, car.hp - amount);
  if (car.hp <= 0) {
    wreckCar(g, car);
    if (car.occupant === 'player') g.events.push({ type: 'playerwreck', car });
  }
}

/**
 * Crash damage (car-to-car and wall impacts) goes through here, never
 * through damageCar directly: after a car takes a crash hit it is
 * immune to further CRASH damage for CRASH_GRACE seconds. A pile-up or
 * a wall grind holds the contact for many frames, and ungated every
 * frame took another hit — one accident drained the whole HP bar in
 * about a second. The window is per car and timestamped against g.time
 * because parked cars have no update loop to tick a timer down. It
 * gates ONLY the HP: the impact's bounce, shove, speed cut and crash
 * event (sound/shake/heat) still happen on every contact frame, so the
 * driving feel is unchanged. Fist and bullet damage (damageCar from
 * main.js and combat.js) keeps its own pacing and never comes here.
 */
export function crashDamageCar(g, car, amount) {
  if (car.wrecked || !(amount > 0)) return;
  if (g.time < (car.crashGraceUntil ?? 0)) return;
  car.crashGraceUntil = g.time + CRASH_GRACE;
  // The driven car shrugs off a third of every crash (see
  // DRIVEN_CRASH_TAKEN in config.js): the check is this car's own
  // occupant, so the other car's call in the same impact bills it
  // full price, and the discount ends when the player steps out.
  damageCar(g, car, car.occupant === 'player' ? amount * DRIVEN_CRASH_TAKEN : amount);
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
  // A crash-encounter record (see the impact branch below) ends once
  // the pair has properly parted — the partner is gone from the world
  // or the cars are well clear of each other — so the NEXT meeting is
  // a new encounter whose first hit counts again.
  if (car.crashPartner) {
    const partner = car.crashPartner;
    if (!g.cars.includes(partner)
      || Math.hypot(car.x - partner.x, car.y - partner.y) > 110) {
      car.crashPartner = null;
      car.crashPartnerUntil = 0;
    }
  }
  applyShove(car, dt);
  const prevSpeed = car.speed;
  // While drifting, the car travels a little wide of where its nose
  // points — that gap is the slide. Every other driver keeps drift 0.
  const travel = car.angle - (car.drift ?? 0);
  car.x += Math.cos(travel) * car.speed * dt;
  car.y += Math.sin(travel) * car.speed * dt;
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
      const vx = Math.cos(travel) * prevSpeed;
      const vy = Math.sin(travel) * prevSpeed;
      const closing = -(vx * (pushX / pushLen) + vy * (pushY / pushLen));
      if (closing > 80) {
        crashDamageCar(g, car, Math.min(1, closing / 420) * CRASH_DAMAGE.wall);
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
    const relVx = Math.cos(travel) * car.speed - Math.cos(other.angle) * (other.speed || 0);
    const relVy = Math.sin(travel) * car.speed - Math.sin(other.angle) * (other.speed || 0);
    const closing = -(relVx * nx + relVy * ny);
    // Positional separation always applies: it is what lets a slow push
    // grind a stopped or slower car ahead of you instead of bouncing off.
    // A WRECKED car is the exception: dead weight never gives ground —
    // the rule separateTrafficCars already keeps for traffic — so the
    // mover takes the whole separation himself and the wreck is not
    // shoved, knocked or slid by the hit at all. Without this, a
    // cruiser still hunting the player bulldozed its own wrecked
    // colleague down the street, half a push per frame for as long as
    // the chase ran through the wreck's spot: a wreck that "kept
    // moving" (measured: 87 units in one sampled chase).
    const push = (rr - d) / 2;
    if (other.wrecked) {
      car.x += nx * push * 2;
      car.y += ny * push * 2;
    } else {
      car.x += nx * push;
      car.y += ny * push;
      if (other.kind !== 'parked' || closing > 25) {
        other.x -= nx * push * 0.5;
        other.y -= ny * push * 0.5;
        settleShovedCar(g, other);
      }
    }
    if (closing > 55) {
      // A real impact, and its strength follows the speed DIFFERENCE (the
      // same /420 scale as a building hit, so the crash sound, the camera
      // shake and the hitCar heat in main.js all track the actual blow).
      const strength = Math.min(1, closing / 420);
      if (other.kind === 'parked' && !other.wrecked) {
        // Parked cars have no update loop to carry a shove velocity, so
        // the knock lands as extra displacement right now.
        const extra = Math.min(44, closing * 0.13);
        other.x -= nx * extra;
        other.y -= ny * extra;
        settleShovedCar(g, other);
      } else if (!other.wrecked) {
        other.shoveX -= nx * closing * 0.9;
        other.shoveY -= ny * closing * 0.9;
      }
      // The pair must actually PART. The positional nudge above only
      // untangles the overlap; at speed the mover used to keep half its
      // pace and drive straight back into the same car, so one accident
      // re-hit every crash-grace window (the player's report: "the
      // bounce is too weak and I just eat consecutive hits"). Now the
      // mover is knocked back along the normal as a shove, and loses a
      // further slice of speed to a rebound scaled by how head-on the
      // hit was — a full-tilt head-on nearly stops it, a glancing
      // side-swipe barely does.
      car.shoveX += nx * closing * 0.5;
      car.shoveY += ny * closing * 0.5;
      car.speed *= 1 - 0.5 * strength;
      const velSign = Math.sign(car.speed) || 1;
      const headOn = Math.max(0, Math.min(1,
        -(Math.cos(travel) * velSign * nx + Math.sin(travel) * velSign * ny)));
      // The rebound grows with the blow: a tap leaves the mover rolling
      // forward, a full-strength head-on throws it bodily backward, so
      // the pair's separation keeps growing instead of the mover
      // coasting straight back into the same car (measured before this
      // scaling: the gap shrank again inside the first second).
      car.speed -= velSign * closing * (0.35 + 0.35 * strength) * headOn;
      // Both cars pay for a real impact, the struck car more than the
      // mover (CRASH_DAMAGE) — through the grace window, so a contact
      // that lasts many frames still costs only the one hit. A wrecked
      // car takes no further damage; damageCar handles the crossing
      // into the wreck state.
      // ONE exception, for the PLAYER's car: one crash encounter with
      // one partner costs it one hit, full stop. The per-car grace
      // above re-opens every 0.8s, so a grind or a boxed-in pile-up —
      // where the pair physically cannot part — kept billing the
      // player a fresh hit each window until the car died (measured:
      // 5 hits, HP 100 -> 18, over 4 pinned seconds). After a partner
      // has damaged the player's car, that partner is recorded and
      // cannot damage it again until the pair has properly parted
      // (cleared at the top of this function) or the record lapses.
      // Damage the player's car DEALS is never gated, and neither is
      // any other car's — ramming the courier still wears it down hit
      // by hit, and a fresh partner always lands its own first hit.
      const playerCar = car.occupant === 'player' ? car
        : (other.occupant === 'player' ? other : null);
      const partner = playerCar === null ? null : (playerCar === car ? other : car);
      const gated = playerCar !== null
        && playerCar.crashPartner === partner
        && g.time < playerCar.crashPartnerUntil;
      // The gate is per VICTIM: it shields only the player's car. The
      // other car keeps paying on the ordinary grace schedule — a
      // courier being rammed in a sustained pin still wears down hit
      // by hit, exactly as before.
      if (car !== playerCar || !gated) crashDamageCar(g, car, strength * CRASH_DAMAGE.mover);
      if (other !== playerCar || !gated) crashDamageCar(g, other, strength * CRASH_DAMAGE.struck);
      if (playerCar !== null && !gated) {
        playerCar.crashPartner = partner;
        playerCar.crashPartnerUntil = g.time + 6;
      }
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
    if (speed <= 55 || car.kind === 'police') {
      // Slow roll: no damage, just out of the way. Police cars take
      // this branch at ANY speed: against an on-foot player the car
      // is never the weapon (police.js brakes them to a deploy stop
      // and sends officers out — the arrest happens on foot), so a
      // forced contact, like stepping out of a car into a braking
      // cruiser, shoves him aside instead of running him down. A
      // pursuit that could only end in WASTED, never BUSTED, was the
      // bug this answers. Traffic cars keep the speed rule above.
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
export function drivePlayerCar(g, dt) {
  const car = g.player.car;
  if (!car || car.wrecked) return;
  const axes = g.input.axes();
  const throttle = -axes.y;
  const steer = axes.x;
  // --- Handbrake (Space; the touch DASH button doubles as BRAKE in a
  // car). It is read FIRST because it overrides the throttle outright:
  // the engine is cut and the rear wheels haul the car toward a stop
  // with a hard LINEAR deceleration (CAR.handbrake, stronger than the
  // foot brake), from either direction of travel. What DeepSeek's
  // brush-up shipped here was only a proportional scrub (0.45 * speed
  // per second, on top of the ordinary coast drag): barely better than
  // coasting from top speed, and with W held the engine simply out-pulled
  // it — the car stayed pinned at max speed, which is exactly what the
  // player reported as "the brake doesn't work".
  const a0 = Math.abs(car.speed);
  const handbrake = g.input.down('Space');
  if (handbrake) {
    const step = CAR.handbrake * dt;
    car.speed = Math.abs(car.speed) <= step ? 0 : car.speed - Math.sign(car.speed) * step;
  } else if (throttle > 0) {
    car.speed = Math.min(car.maxSpeed ?? CAR.maxSpeed, car.speed + (car.accel ?? CAR.accel) * dt);
  } else if (throttle < 0) {
    if (car.speed > 12) car.speed = Math.max(0, car.speed - CAR.brake * dt);
    else car.speed = Math.max(-CAR.maxReverse, car.speed - (car.accel ?? CAR.accel) * 0.7 * dt);
  } else {
    car.speed -= car.speed * 0.5 * dt;
    if (Math.abs(car.speed) < 4) car.speed = 0;
  }
  // Held at speed the handbrake also lets the nose come round faster
  // than grip would allow, and lets the car's travel lag behind its
  // heading — the rear steps out and the slide is visible from behind.
  // Released, grip returns and the drift washes out. (The speed cost of
  // sliding is the deceleration above; there is no separate scrub.)
  const speedAbs = Math.abs(car.speed);
  const sliding = handbrake && speedAbs > 90;
  if (car.speed !== 0) {
    const grip = Math.max(-1, Math.min(1, car.speed / 130));
    car.angle += steer * CAR.turnRate * (sliding ? 1.6 : 1) * dt * grip;
  }
  if (sliding) {
    const dir = Math.sign(car.speed) || 1;
    car.drift = Math.max(-0.5, Math.min(0.5, (car.drift ?? 0) + steer * dir * 2.1 * dt));
  } else {
    car.drift = (car.drift ?? 0) * Math.max(0, 1 - 5 * dt);
    if (Math.abs(car.drift) < 0.002) car.drift = 0;
  }
  // Body roll: onto the outside wheels through a corner, deeper while
  // sliding, and gone the moment the car is parked or wrecked.
  const leanTarget = -steer * Math.min(1, speedAbs / 300)
    * (0.07 + Math.abs(car.drift ?? 0) * 0.3);
  car.lean = (car.lean ?? 0) + (leanTarget - (car.lean ?? 0)) * Math.min(1, 8 * dt);
  // One screech per slide beat, not one per frame.
  car.skidT = (car.skidT ?? 0) - dt;
  if (sliding && car.skidT <= 0) {
    car.skidT = 0.42;
    g.events.push({ type: 'screech', strength: Math.min(1, speedAbs / 380) });
  }
  // Brake-pedal SE, once per 0.35 s: the long screech above 240, the short
  // one below it.
  const braking = handbrake || (throttle < 0 && car.speed > a0);
  car.brakeT = Math.max(0, (car.brakeT ?? 0) - dt);
  if (braking && speedAbs > 150 && car.brakeT <= 0) {
    car.brakeT = 0.35;
    g.events.push({ type: speedAbs > 240 ? 'brakeLong' : 'brake' });
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
    // --- Passing a stationary obstacle --------------------------------
    // Parked cars sit at the kerb 41 from the road centre — 15 from the
    // lane line, permanently inside the car-ahead corridor below — and
    // they never move. Measured consequence: every traffic car that came
    // up behind one stopped 52 short and waited forever, and the queues
    // behind them are the jam in the user's screenshot. Real drivers
    // edge around a kerbside car, so: when the obstacle ahead is a
    // stationary car that is not live traffic (parked, wrecked, a
    // cruiser holding its stop, a courier at a standstill), ease
    // laterally away from it far enough to restore the corridor gap,
    // pass, and ease back. Live traffic ahead is never passed this way
    // — queueing behind it is the traffic-probe behaviour — and
    // pedestrians never take part: their yield below stays absolute.
    car.off ??= 0; car.blockedT ??= 0; car.creepT ??= 0;
    const latOf = (o) => (car.axis === 'y' ? o.x : o.y);
    const alongOf = (o) => (car.axis === 'y' ? (o.y - car.y) * car.dir : (o.x - car.x) * car.dir);
    let offTarget = 0;
    {
      let bestAlong = 170;
      for (const other of g.cars) {
        if (other === car || other.occupant === 'player') continue;
        if (Math.abs(other.speed ?? 0) >= 5) continue;
        if (other.kind === 'traffic' && !other.wrecked) continue;
        const along = alongOf(other);
        if (along < -20 || along > bestAlong) continue;
        const gap = latOf(other) - car.lane; // signed: which side it sits
        if (Math.abs(gap) >= 40) continue;
        bestAlong = along;
        const away = gap > 0 ? -1 : gap < 0 ? 1 : (car.lane > car.road ? -1 : 1);
        const cap = car.creepT > 0 ? 40 : 24;
        offTarget = away * Math.min(cap, Math.max(0, 37 - Math.abs(gap)));
      }
    }
    car.off += (offTarget - car.off) * (1 - Math.exp(-6 * dt));
    if (offTarget === 0 && Math.abs(car.off) < 0.05) car.off = 0;
    const myLat = car.lane + car.off;

    // A car ahead in my path slows us down. The corridor is wider than
    // my lane on purpose: a car CROSSING my path at an intersection
    // (laterally near my lane line while it passes) counts too, so
    // traffic brakes for a crossing car instead of driving into its
    // flank and merging with it at the corner.
    let carTarget = CAR.trafficSpeed;
    let blocker = null;
    for (const other of g.cars) {
      if (other === car) continue;
      const lateral = latOf(other) - myLat;
      const along = alongOf(other);
      if (Math.abs(lateral) < 34 && along > 0 && along < 80) {
        const t = Math.max(0, (along - 52) * 4);
        if (t < carTarget) { carTarget = t; blocker = other; }
      }
    }
    let targetSpeed = carTarget;
    // Pedestrians in the path get the same courtesy, on a braking
    // curve: the target speed is the fastest speed from which this car
    // can still stop TRAFFIC_YIELD.gap short of the person, so it eases
    // in and halts instead of plowing through. The PLAYER first and
    // foremost — a car coming down the street must never run down a
    // player it had time to stop for (until now traffic never braked
    // for anyone, and updatePlayerCarHits was the only thing standing
    // between a crossing player and a car arriving from off-screen) —
    // and any citizen caught in the lane gets the same mercy. A car
    // already on top of someone at speed can still clip them; the
    // curve only promises a stop when there was road to stop in.
    // Police in pursuit and the courier never run this code.
    let pedTarget = CAR.trafficSpeed;
    const yieldFor = (px, py) => {
      const lateral = (car.axis === 'y' ? px : py) - myLat;
      if (Math.abs(lateral) >= TRAFFIC_YIELD.corridor) return;
      const along = car.axis === 'y' ? (py - car.y) * car.dir : (px - car.x) * car.dir;
      if (along <= 0 || along > TRAFFIC_YIELD.range) return;
      const t = Math.sqrt(2 * TRAFFIC_YIELD.brake * Math.max(0, along - TRAFFIC_YIELD.gap));
      if (t < pedTarget) pedTarget = t;
    };
    if (g.player.state === 'foot') yieldFor(g.player.x, g.player.y);
    for (const ped of g.peds) {
      if (ped.state === 'down' || ped.state === 'inCar') continue;
      yieldFor(ped.x, ped.y);
    }
    targetSpeed = Math.min(targetSpeed, pedTarget);

    // --- Patience: a car-yield that expires into a slow creep ----------
    // Two traffic cars can also stop each other dead at a junction
    // corner, each waiting for the other to clear a corridor neither
    // can enter first; and an obstacle the kerb pass cannot fully clear
    // (a wreck mid-lane) waits forever the same way. So a car held by a
    // STOPPED car accrues patience, and past its (staggered) threshold
    // it creeps at walking pace for a few seconds: stopped-car braking
    // is ignored while creeping, but moving cars still stop it, the
    // player's car still stops it, and every pedestrian still stops it
    // cold — patience never accrues while a person is the blocker, and
    // the creep target is minned with the pedestrian yield every frame.
    // The car that has waited longest moves first; the other's blocker
    // is then a moving car, its patience resets, and it waits its turn.
    const heldByCar = blocker !== null && Math.abs(blocker.speed ?? 0) < 5
      && blocker.occupant !== 'player' && blocker !== g.player.car
      && carTarget < 20 && car.speed < 8 && pedTarget >= 20;
    car.blockedT = heldByCar ? car.blockedT + dt : 0;
    car.creepDelay ??= 4.5 + (Math.abs(Math.round(car.x + car.y)) % 3) * 1.1;
    if (car.creepT > 0) car.creepT -= dt;
    if (car.creepT <= 0 && car.blockedT > car.creepDelay) { car.creepT = 5; car.blockedT = 0; }
    if (car.creepT > 0) {
      let creepTarget = 45;
      for (const other of g.cars) {
        if (other === car) continue;
        const stopped = Math.abs(other.speed ?? 0) < 5;
        const playerCar = other.occupant === 'player' || other === g.player.car;
        if (stopped && !playerCar) continue;
        const lateral = latOf(other) - myLat;
        const along = alongOf(other);
        if (Math.abs(lateral) < 34 && along > 0 && along < 80) {
          creepTarget = Math.min(creepTarget, Math.max(0, (along - 52) * 4));
        }
      }
      targetSpeed = Math.min(creepTarget, pedTarget);
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
          car.off = 0; car.blockedT = 0; car.creepT = 0; // a new lane, a fresh start
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
    // Keep the lateral position glued to the lane (plus the passing
    // offset, while one is in play), and stay in the world.
    if (car.axis === 'y') car.x = car.lane + car.off;
    else car.y = car.lane + car.off;
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
        if (b.axis === 'y') b.x = b.lane + (b.off ?? 0);
        else b.y = b.lane + (b.off ?? 0);
        resolveCircleCollision(g.city, b, CAR.radius);
        syncCarMesh(b, 0);
      }
      if (a.axis === 'y') a.x = a.lane + (a.off ?? 0);
      else a.y = a.lane + (a.off ?? 0);
      resolveCircleCollision(g.city, a, CAR.radius);
      syncCarMesh(a, 0);
    }
  }
}

const warnVec = new THREE.Vector3();
const warnDir = new THREE.Vector3();

/**
 * Off-screen traffic warnings, recomputed each frame into
 * g.trafficWarn for hud.js to draw: the cars a player ON FOOT cannot
 * see but is about to meet. A car qualifies when it is close (within
 * TRAFFIC_WARN.radius), actually moving, OFF screen (projected with
 * the real camera; cars behind the camera count as off-screen and get
 * their direction from the camera yaw instead), and closing — its
 * closest point of approach to the player over the next few seconds
 * passes within TRAFFIC_WARN.cpaDist. A car already opening the
 * distance never warns. Police are left out on purpose: a pursuit has
 * its own signals (stars, sirens, minimap), and a constant red edge
 * arrow through every chase would drown the traffic warnings this
 * exists for. Each entry is { angle, urgency, dist } with angle in
 * screen space (atan2 of screen-down over screen-right, so hud.js can
 * place the marker on the screen edge directly); the list is sorted
 * most urgent first and capped.
 */
export function computeTrafficWarnings(g) {
  const out = [];
  g.trafficWarn = out;
  const p = g.player;
  if (g.state !== 'play' || !p || p.state !== 'foot' || !g.camera) return;
  const cam = g.camera;
  cam.getWorldDirection(warnDir);
  const pvx = Math.cos(p.moveAngle ?? p.angle) * (p.speedNow ?? 0);
  const pvy = Math.sin(p.moveAngle ?? p.angle) * (p.speedNow ?? 0);
  // Screen axes in world terms, from the yaw the camera renders with
  // (the same convention people.js moves the player by): right is
  // (sin yaw, -cos yaw), down is (cos yaw, sin yaw).
  const yaw = g.cam.yaw + Math.PI * g.cam.backBlend;
  const rightX = Math.sin(yaw);
  const rightY = -Math.cos(yaw);
  const downX = Math.cos(yaw);
  const downY = Math.sin(yaw);
  for (const car of g.cars) {
    if (car.kind !== 'traffic' && car.kind !== 'courier') continue;
    if (car.wrecked || car.occupant === 'player' || Math.abs(car.speed) < 35) continue;
    const rx = car.x - p.x;
    const ry = car.y - p.y;
    const dist = Math.hypot(rx, ry);
    if (dist < 1 || dist > TRAFFIC_WARN.radius) continue;
    // Relative motion and the closest point of approach.
    const vx = Math.cos(car.angle) * car.speed - pvx;
    const vy = Math.sin(car.angle) * car.speed - pvy;
    const vv = vx * vx + vy * vy;
    if (vv < 1) continue;
    let tStar = -(rx * vx + ry * vy) / vv;
    if (tStar <= 0) continue; // already opening — no warning
    tStar = Math.min(tStar, TRAFFIC_WARN.cpaTime);
    if (Math.hypot(rx + vx * tStar, ry + vy * tStar) > TRAFFIC_WARN.cpaDist) continue;
    // Off-screen? Project with the real camera; a car the player can
    // see needs no arrow.
    let sx;
    let sy;
    if (rx * warnDir.x + ry * warnDir.z < 0) {
      // Behind the camera: projection mirrors, so take the direction
      // from the camera yaw instead.
      sx = rx * rightX + ry * rightY;
      sy = rx * downX + ry * downY;
    } else {
      warnVec.set(car.x, 10, car.y).project(cam);
      if (warnVec.z < 1 && Math.abs(warnVec.x) <= 1.03 && Math.abs(warnVec.y) <= 1.03) continue;
      sx = warnVec.x;
      sy = -warnVec.y;
    }
    const urgency = Math.max(0, Math.min(1,
      0.7 * (1 - tStar / TRAFFIC_WARN.cpaTime) + 0.45 * (1 - dist / TRAFFIC_WARN.radius)));
    out.push({ angle: Math.atan2(sy, sx), urgency, dist });
  }
  out.sort((a, b) => b.urgency - a.urgency);
  if (out.length > TRAFFIC_WARN.max) out.length = TRAFFIC_WARN.max;
}

/** Flash the police light bars (called for every police car each frame). */
export function updatePoliceLights(car, time) {
  if (!car.lightL || !car.lightR) return;
  const phase = Math.floor(time * 5 + (Math.abs(car.x) % 4)) % 2 === 0;
  car.lightL.visible = phase;
  car.lightR.visible = !phase;
  // The bar's bloom follows the same beat, so the red and blue halves take
  // turns lighting up the street instead of glowing together.
  const night = nightLevel();
  const show = !car.wrecked && night > 0.02;
  if (car.glowL) {
    car.glowL.material.opacity = car.wrecked ? 0 : night * (phase ? 0.95 : 0.08);
    car.glowL.visible = show;
  }
  if (car.glowR) {
    car.glowR.material.opacity = car.wrecked ? 0 : night * (phase ? 0.08 : 0.95);
    car.glowR.visible = show;
  }
}

/* ------------------------------------------------------------- owned cars */

/**
 * Apply an owned-car spec (saved grade/paint/engine/armor/neon) to a fresh
 * car: grade sets the top speed and acceleration, engine multiplies both,
 * armor adds HP over the 100 a plain car has.
 */
export function applyCarSpec(car, spec) {
  const grade = MOTORS.grades[spec.grade] ?? MOTORS.grades[0];
  const eng = spec.engine > 0 ? (MOTORS.engine[spec.engine - 1] ?? null) : null;
  car.maxSpeed = grade.top * (eng?.top ?? 1);
  car.accel = grade.accel * (eng?.accel ?? 1);
  car.hp = 100 + (spec.armor > 0 ? (MOTORS.armor[spec.armor - 1]?.hp ?? 0) : 0);
  car.maxHp = car.hp;
  car.owned = true;
  car.grade = spec.grade;
  car.engine = spec.engine;
  car.armor = spec.armor;
  car.paint = spec.paint;
  recolorCar(car, spec.paint);
  if (spec.neon !== null && spec.neon !== undefined && spec.glow !== false) {
    setCarNeon(car, spec.neon);
  } else {
    setCarNeon(car, -1); // no neon installed, or switched off at the panel
  }
}

/** Paint the body: an owned car keeps its colour across a respawn. */
export function recolorCar(car, paintIndex) {
  const color = MOTORS.paints[paintIndex] ?? MOTORS.paints[0];
  const body = car.mesh.children[0];
  if (body?.material) body.material.color.setHex(color);
  car.paint = paintIndex;
}


/** Underbody neon: two glowing sills and a soft point light, or off. */
export function setCarNeon(car, index) {
  if (car.neonGroup) {
    car.mesh.remove(car.neonGroup);
    car.neonGroup = null;
  }
  car.neon = null;
  const tone = NEON[index];
  if (!tone) return;
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: tone.color, transparent: true, opacity: 0.9, depthWrite: false,
  });
  for (const side of [-1, 1]) {
    const sill = new THREE.Mesh(new THREE.BoxGeometry(40, 1.2, 3.2), mat);
    sill.position.set(0, 2.2, side * 11);
    group.add(sill);
  }
  const light = new THREE.PointLight(tone.color, 1.4, 130);
  light.position.set(0, 3, 0);
  group.add(light);
  car.mesh.add(group);
  car.neonGroup = group;
  car.neon = index;
}
