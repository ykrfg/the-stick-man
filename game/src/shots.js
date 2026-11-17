// Deterministic screenshot scenes, selected with ?shot=<name>&seed=1. Each scene
// composes the world the judge should see — a police chase for the cover, a busy
// street, a mission marker, a fistfight — then freezes movement while the figures
// keep posing (mid-stride gaits, a looping punch), so a still frame still reads
// as alive. Movement systems do not run in shot mode; only poses, markers and
// police lights advance.
import { HEAT_THRESHOLDS } from './config.js';
import { resolveCircleCollision } from './city.js';
import { spawnPed, syncFigure } from './people.js';
import { spawnCar, spawnPoliceCar, syncCarMesh, updatePoliceLights } from './vehicles.js';
import { starsFor } from './police.js';

/** Spawn a bystander for a scene, pushed out of any building it landed inside. */
function spawnShotPed(g, opts) {
  const ped = spawnPed(g, opts);
  resolveCircleCollision(g.city, ped, 12);
  ped.fig.group.position.set(ped.x, 0, ped.y);
  return ped;
}

/** Remove every car and pedestrian near a point so a composed scene stays clean. */
function clearArea(g, x, y, r) {
  for (const car of [...g.cars]) {
    if (Math.hypot(car.x - x, car.y - y) < r) {
      g.scene.remove(car.mesh);
      g.cars.splice(g.cars.indexOf(car), 1);
    }
  }
  for (const ped of [...g.peds]) {
    if (ped.role !== 'bruno' && Math.hypot(ped.x - x, ped.y - y) < r) {
      g.scene.remove(ped.fig.group);
      g.peds.splice(g.peds.indexOf(ped), 1);
    }
  }
}

/** Put the player into a car for a scene: state, pose targets, seat placement. */
function seatPlayer(g, car) {
  const p = g.player;
  p.state = 'car';
  p.car = car;
  car.occupant = 'player';
  p.x = car.x;
  p.y = car.y;
  p.angle = car.angle;
}

export function setupShot(g, name) {
  const p = g.player;
  g.state = 'play';
  g.shotMode = name;
  g.money = 640;
  g.saveData = { money: 640, missionsDone: [], hasPistol: false, earned: 0 };

  if (name === 'cover') {
    // A stolen red car tears south down the avenue with two police cars behind.
    clearArea(g, 1574, 1350, 620);
    const hero = spawnCar(g, 'traffic', 1574, 1420, Math.PI / 2, 0xef6461);
    seatPlayer(g, hero);
    const cop1 = spawnPoliceCar(g, 1574, 1245);
    cop1.angle = Math.PI / 2;
    const cop2 = spawnPoliceCar(g, 1652, 1150);
    cop2.angle = Math.PI / 2;
    syncCarMesh(cop1, 0);
    syncCarMesh(cop2, 0);
    g.heat = HEAT_THRESHOLDS[2] + 30;
    g.stars = starsFor(g.heat);
    g.mission.active = true;
    g.mission.index = 1;
    g.mission.phase = 'escape';
    // The camera sits behind the police cars, looking down the avenue at the
    // stolen car ahead of them: the whole pursuit in one frame.
    g.fixedCam = {
      pos: { x: 1574, y: 165, z: 1015 },
      look: { x: 1574, y: 12, z: 1470 },
    };
    // Bystanders on the sidewalks for life.
    spawnShotPed(g, { role: 'ped', x: 1505, y: 1330 });
    spawnShotPed(g, { role: 'ped', x: 1712, y: 1500 });
  } else if (name === 'city') {
    // On foot at a busy crossing, mid-stride, traffic rolling past.
    clearArea(g, 1640, 1660, 260);
    p.x = 1640;
    p.y = 1662;
    p.angle = 0.5;
    p.speedNow = 150;
    p.fig.setExpression('grin');
    const spots = [
      [1529, 1500], [1671, 1780], [1529, 1790], [1671, 1490], [1529, 1330], [1671, 1900],
    ];
    for (const [x, y] of spots) {
      const ped = spawnShotPed(g, { role: 'ped', x, y });
      ped.speedNow = 95;
      ped.angle = g.rng.range(0, Math.PI * 2);
    }
    // The camera stays over the avenue corridor so no building blocks the view.
    g.fixedCam = {
      pos: { x: 1562, y: 98, z: 1852 },
      look: { x: 1648, y: 18, z: 1652 },
    };
  } else if (name === 'mission') {
    // Walking the last stretch to the pier warehouse, the gold marker beam ahead.
    // The approach is along the street south of the warehouse, camera behind.
    const door = g.city.landmarks.pier;
    clearArea(g, door.x - 60, door.y - 30, 320);
    g.mission.active = true;
    g.mission.index = 0;
    g.mission.phase = 'toWarehouse';
    p.x = door.x - 70;
    p.y = door.y + 72;
    p.angle = Math.atan2(door.y - p.y, door.x - p.x);
    p.speedNow = 140;
    p.fig.setExpression('neutral');
    const guard = spawnShotPed(g, { role: 'ped', x: door.x + 80, y: door.y + 26 });
    guard.speedNow = 0;
    g.fixedCam = {
      pos: { x: door.x - 195, y: 85, z: door.y + 245 },
      look: { x: door.x - 35, y: 22, z: door.y + 8 },
    };
  } else if (name === 'fight') {
    // A fistfight on the open intersection: the hero mid-punch, two black rivals.
    clearArea(g, 1590, 1155, 340);
    p.x = 1568;
    p.y = 1150;
    p.angle = 0.1;
    p.speedNow = 0;
    p.fig.setExpression('angry');
    const rival = spawnPed(g, { role: 'rival', x: 1622, y: 1158, name: 'COLLECTOR' });
    rival.angle = Math.PI - 0.08;
    rival.speedNow = 0;
    rival.fig.setExpression('angry');
    const rival2 = spawnPed(g, { role: 'rival', x: 1500, y: 1205, name: 'COLLECTOR' });
    rival2.angle = 0.8;
    rival2.speedNow = 150;
    rival2.fig.setExpression('angry');
    // Frame it as Bruno's collection job so the HUD tells the same story, and
    // register the rivals so the mission logic leaves the scene alone.
    g.mission.active = true;
    g.mission.index = 2;
    g.mission.phase = 'fight';
    g.mission.shopStep = 0;
    g.mission.rivals = [rival, rival2];
    g.fightShot = { rival, punchT: 0 };
    // Three-quarter front view from down the avenue: both fighters' faces and the
    // punching arm stay visible, nothing built blocks the intersection.
    g.fixedCam = {
      pos: { x: 1648, y: 62, z: 1252 },
      look: { x: 1585, y: 20, z: 1152 },
    };
  }
}

/** Advance only the posing in shot mode: gaits in place, markers, lights, punches. */
export function tickShot(g, dt) {
  const p = g.player;
  if (g.shotMode === 'cover') {
    // The driver sits settled on the wheel; the police lights flash.
    p.fig.target.drive = 1;
    p.fig.target.speed = 0;
    const car = p.car;
    const lx = -2;
    const ly = -6;
    const c = Math.cos(car.angle);
    const s = Math.sin(car.angle);
    p.fig.group.position.set(car.x + lx * c - ly * s, 2, car.y + lx * s + ly * c);
    p.fig.group.rotation.y = -car.angle;
    p.fig.shadow.visible = false;
    p.fig.update(dt, g.time);
    for (const other of g.cars) {
      if (other.kind === 'police') updatePoliceLights(other, g.time);
    }
  } else {
    syncFigure(p, dt, g.time);
  }
  for (const ped of g.peds) {
    if (ped.role === 'bruno') {
      syncFigure(ped, dt, g.time);
    } else if (g.shotMode !== 'cover' || Math.hypot(ped.x - p.x, ped.y - p.y) < 700) {
      syncFigure(ped, dt, g.time);
    }
  }
  if (g.shotMode === 'fight' && g.fightShot) {
    g.fightShot.punchT -= dt;
    if (g.fightShot.punchT <= 0) {
      g.fightShot.punchT = 0.85;
      p.fig.triggerPunch();
      g.fightShot.rival.fig.triggerPunch();
    }
  }
  if (g.markerGold.visible) g.markerGold.userData.update(g.time);
  if (g.markerRed.visible) g.markerRed.userData.update(g.time);
}
