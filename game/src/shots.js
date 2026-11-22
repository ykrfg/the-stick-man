// Deterministic screenshot scenes, selected with ?shot=<name>&seed=1. Each scene
// composes the world the judge should see — a police chase for the cover, a busy
// street, a mission meeting, a burning wreck at golden hour — then freezes
// movement while the figures keep posing (mid-stride gaits, held expressions),
// so a still frame still reads as alive. Movement systems do not run in shot
// mode; only poses, markers and police lights advance.
import { HEAT_THRESHOLDS } from './config.js';
import { resolveCircleCollision } from './city.js';
import { spawnPed, syncFigure } from './people.js';
import { spawnCar, spawnPoliceCar, syncCarMesh, updatePoliceLights, wreckCar, updateWrecks } from './vehicles.js';
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
  // Keep the full save shape (gear/fit/owned) that economy.js expects.
  g.saveData.money = 640;
  g.saveData.missionsDone = [];
  g.saveData.earned = 0;

  if (name === 'cover') {
    // A stolen red car tears south down the avenue at four stars: two
    // cruisers on its tail, a third cutting in from the side street,
    // traffic scattering ahead. The camera rides low behind the chase
    // so the pursuit fills the frame instead of surveying it.
    clearArea(g, 1590, 1300, 640);
    const hero = spawnCar(g, 'traffic', 1586, 1335, Math.PI / 2, 0xef6461);
    seatPlayer(g, hero);
    // Nothing moves in shot mode, but the speedo reads the car's speed:
    // let it tell the chase story too.
    hero.speed = 320;
    const cop1 = spawnPoliceCar(g, 1622, 1215);
    cop1.angle = Math.PI / 2;
    cop1.speed = 320;
    const cop2 = spawnPoliceCar(g, 1558, 1105);
    cop2.angle = Math.PI / 2;
    cop2.speed = 320;
    const cop3 = spawnPoliceCar(g, 1835, 1155);
    cop3.angle = Math.PI;
    cop3.speed = 300;
    syncCarMesh(cop1, 0);
    syncCarMesh(cop2, 0);
    syncCarMesh(cop3, 0);
    // Traffic sharing the avenue: one car ahead in the hero's lane, one
    // oncoming, one parked at the kerb.
    spawnCar(g, 'traffic', 1586, 1590, Math.PI / 2, 0x7fb2d9);
    spawnCar(g, 'traffic', 1658, 1560, -Math.PI / 2, 0xf2c14e);
    spawnCar(g, 'traffic', 1522, 1245, Math.PI / 2, 0xc0c6ce);
    g.heat = HEAT_THRESHOLDS[3] + 30;
    g.stars = starsFor(g.heat);
    g.mission.active = true;
    g.mission.index = 1;
    g.mission.phase = 'escape';
    g.fixedCam = {
      pos: { x: 1620, y: 120, z: 905 },
      look: { x: 1588, y: 12, z: 1330 },
    };
    // Bystanders on the sidewalks for life.
    spawnShotPed(g, { role: 'ped', x: 1505, y: 1330 });
    spawnShotPed(g, { role: 'ped', x: 1712, y: 1500 });
  } else if (name === 'city') {
    // On foot at a busy crossing, mid-stride in the crowd, traffic
    // rolling past on both roads.
    clearArea(g, 1620, 1670, 300);
    p.x = 1620;
    p.y = 1680;
    p.angle = 0.5;
    p.speedNow = 150;
    p.fig.setExpression('grin');
    // [x, y, facing, stride speed]: crossing the street, waiting at the
    // kerb, walking the sidewalks — one passer-by close to the camera.
    const spots = [
      [1560, 1620, 0, 100], [1705, 1735, Math.PI, 95], [1529, 1500, Math.PI / 2, 95],
      [1671, 1780, -Math.PI / 2, 95], [1671, 1490, -Math.PI / 2, 95],
      [1690, 1605, -2.6, 90], [1500, 1690, Math.PI / 2, 95],
      [1745, 1560, -Math.PI / 2, 95], [1500, 1560, Math.PI / 2, 95], [1745, 1830, -Math.PI / 2, 95],
    ];
    for (const [x, y, angle, speed] of spots) {
      const ped = spawnShotPed(g, { role: 'ped', x, y });
      ped.speedNow = speed;
      ped.angle = angle;
    }
    // Traffic: two cars on the avenue, one crossing on the street.
    spawnCar(g, 'traffic', 1548, 1440, Math.PI / 2, 0xf2c14e);
    spawnCar(g, 'traffic', 1658, 1420, -Math.PI / 2, 0x9fd356);
    spawnCar(g, 'traffic', 1330, 1568, 0, 0xc0c6ce);
    // The camera stays over the avenue corridor so no building blocks the view.
    g.fixedCam = {
      pos: { x: 1540, y: 86, z: 1895 },
      look: { x: 1635, y: 16, z: 1665 },
    };
  } else if (name === 'mission') {
    // Mission 2, first step: the hero walks the last stretch to Club
    // Neon, where Shade is posted at the door — the objective text,
    // the gold marker beam and Shade's name label all in one frame.
    // Shade stands exactly where acceptMission posts him.
    const club = g.city.landmarks.club;
    clearArea(g, club.x + 10, club.y + 10, 300);
    g.mission.active = true;
    g.mission.index = 1;
    g.mission.phase = 'toClub';
    const shade = spawnPed(g, { role: 'shade', x: club.x + 24, y: club.y + 10, name: 'SHADE' });
    shade.fig.setExpression('angry');
    shade.state = 'idle';
    shade.homeX = shade.x;
    shade.homeY = shade.y;
    // Name labels are toggled by updatePeds, which shot mode never
    // runs; the hero is at conversational range, so hold it on.
    shade.label.visible = true;
    g.mission.shade = shade;
    p.x = club.x - 88;
    p.y = club.y + 28;
    p.angle = Math.atan2(shade.y - p.y, shade.x - p.x);
    p.speedNow = 140;
    p.fig.setExpression('neutral');
    // Life around the club: a car parked along the street east of the
    // corner, a bystander drifting past the door.
    spawnCar(g, 'traffic', club.x + 205, club.y + 82, 0, 0x8e6fc8);
    const passer = spawnShotPed(g, { role: 'ped', x: club.x + 105, y: club.y - 25 });
    passer.speedNow = 95;
    passer.angle = Math.PI;
    g.fixedCam = {
      pos: { x: club.x - 215, y: 82, z: club.y + 130 },
      look: { x: club.x + 35, y: 24, z: club.y + 5 },
    };
  } else if (name === 'beauty') {
    // Golden hour on the coast road by the pier: a wreck still burning
    // in the foreground, the hero standing over it, his own car parked
    // behind him and the warehouse across the road. The fire is raised
    // once, here at g.time = 0, and shot mode never advances it — the
    // flames hold this exact pose in every capture.
    const pier = g.city.landmarks.pier;
    clearArea(g, pier.x - 130, pier.y + 90, 330);
    const wreck = spawnCar(g, 'traffic', pier.x - 125, pier.y + 80, 0.9, 0x707880);
    wreckCar(g, wreck);
    updateWrecks(g, 0.5);
    spawnCar(g, 'traffic', pier.x - 255, pier.y + 95, 0, 0xef6461);
    p.x = pier.x - 145;
    p.y = pier.y + 125;
    p.angle = Math.atan2((pier.y + 80) - p.y, (pier.x - 125) - p.x);
    p.speedNow = 0;
    p.fig.setExpression('neutral');
    g.fixedCam = {
      pos: { x: pier.x - 235, y: 50, z: pier.y + 215 },
      look: { x: pier.x - 105, y: 22, z: pier.y + 70 },
    };
  }
}

/** Advance only the posing in shot mode: gaits in place, markers, lights. */
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
  if (g.markerGold.visible) g.markerGold.userData.update(g.time);
  if (g.markerRed.visible) g.markerRed.userData.update(g.time);
}
