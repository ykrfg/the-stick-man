// The wanted system and Palmera PD. Crimes add heat (witnessed crimes add more);
// heat lights up stars; stars decide how many police cars hunt the player. Police
// cars chase and ram, officers climb out near a player on foot and fill the bust
// meter by staying close; heat cools when no officer is near, and the Spray 'n Go
// garage wipes it for a fee (handled in main.js). Police behaviour is deliberately
// readable: fast in a straight line, clumsy in corners, hopeless off-road.
import { CAR, HEAT_THRESHOLDS } from './config.js';
import { isOnRoad } from './city.js';
import { moveFreeCar, removeCar, spawnPoliceCar, syncCarMesh, updatePoliceLights } from './vehicles.js';
import { spawnPed } from './people.js';

/** How many stars a heat value lights up. */
export function starsFor(heat) {
  let stars = 0;
  for (const threshold of HEAT_THRESHOLDS) if (heat >= threshold) stars += 1;
  return stars;
}

/** Was anyone in a position to see the crime at (x, y)? Cops see far, citizens less. */
function witnessed(g, x, y) {
  for (const ped of g.peds) {
    if (ped.state === 'down' || ped.state === 'inCar') continue;
    const range = ped.role === 'cop' ? 470 : 250;
    if (Math.hypot(ped.x - x, ped.y - y) < range) return true;
  }
  for (const car of g.cars) {
    if (car.kind === 'police' && Math.hypot(car.x - x, car.y - y) < 470) return true;
  }
  return false;
}

/**
 * Add heat for a crime at (x, y). Unwitnessed crimes count for a third. Crimes
 * against the police themselves are always fully witnessed.
 */
export function addHeat(g, amount, x, y, { force = false } = {}) {
  if (g.stars >= 5 && amount > 0) amount *= 0.4; // already at maximum attention
  const seen = force || witnessed(g, x, y);
  g.heat += seen ? amount : amount * 0.34;
  const stars = starsFor(g.heat);
  if (stars > g.stars) {
    g.events.push({ type: 'starup', stars });
  }
  g.stars = stars;
}

/** Pick a road point 520–720px from the player for a police spawn. */
function spawnPoint(g) {
  for (let tries = 0; tries < 10; tries += 1) {
    const angle = g.rng.range(0, Math.PI * 2);
    const dist = g.rng.range(520, 720);
    const x = g.player.x + Math.cos(angle) * dist;
    const y = g.player.y + Math.sin(angle) * dist;
    if (x < 60 || y < 60 || x > 3300 || y > 2460) continue;
    if (!isOnRoad(x, y)) continue;
    return { x, y };
  }
  return null;
}

/** Steer one police car after the player for a frame. */
function chasePlayer(g, car, dt) {
  const p = g.player;
  const tx = p.x + Math.cos(p.angle) * (p.state === 'car' ? 0 : 0);
  const ty = p.y + Math.sin(p.angle) * (p.state === 'car' ? 0 : 0);
  const desired = Math.atan2(ty - car.y, tx - car.x);
  let diff = desired - car.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (car.reverseT > 0) {
    car.reverseT -= dt;
    car.speed = -150;
    car.angle -= Math.sign(diff || 1) * 1.8 * dt;
  } else {
    const top = CAR.policeSpeed * (g.stars >= 3 ? 1 : 0.82);
    const wanted = Math.abs(diff) > 2.1 ? 110 : top;
    car.speed += Math.max(-500 * dt, Math.min(300 * dt, wanted - car.speed));
    car.angle += Math.max(-2.5 * dt, Math.min(2.5 * dt, diff));
    if (Math.abs(car.speed) < 22 && Math.hypot(tx - car.x, ty - car.y) > 90) {
      car.stuckT = (car.stuckT ?? 0) + dt;
      if (car.stuckT > 1.1) {
        car.reverseT = 0.55;
        car.stuckT = 0;
      }
    } else {
      car.stuckT = 0;
    }
  }
  moveFreeCar(g, car, dt);
  // An officer climbs out when the car is stopped near a player on foot.
  if (!car.officerSpawned && p.state === 'foot' && Math.abs(car.speed) < 65) {
    if (Math.hypot(p.x - car.x, p.y - car.y) < 105) {
      car.officerSpawned = true;
      const officer = spawnPed(g, { role: 'cop', x: car.x + 20, y: car.y + 10 });
      officer.state = 'fight';
      g.events.push({ type: 'officer' });
    }
  }
}

/** The whole wanted system for one frame: spawning, chasing, cooling, busting. */
export function updatePolice(g, dt, time) {
  const p = g.player;
  g.stars = starsFor(g.heat);
  // Cooling: heat drains while no police unit is close enough to watch.
  let nearest = Infinity;
  for (const car of g.cars) {
    if (car.kind === 'police') nearest = Math.min(nearest, Math.hypot(car.x - p.x, car.y - p.y));
  }
  for (const ped of g.peds) {
    if (ped.role === 'cop' && ped.state === 'fight') nearest = Math.min(nearest, Math.hypot(ped.x - p.x, ped.y - p.y));
  }
  g.policeNear = nearest < 470;
  // `cooling` is the HUD's "losing them" signal: it is true exactly while
  // heat is draining, so the blinking stars never lie about the state.
  g.cooling = false;
  if (nearest > 430) {
    g.coolT += dt;
    if (g.coolT > 3.2 && g.heat > 0) {
      const prevStars = g.stars;
      g.heat = Math.max(0, g.heat - 13 * dt);
      g.stars = starsFor(g.heat);
      g.cooling = true;
      // A chase ended by stealth is an event worth announcing: fire at
      // the moment the drain winks out the last star (heat still has a
      // little left to bleed off, but the PD gives up at zero stars —
      // that is when its cars turn away). The Spray 'n Go wipe and
      // busted/wasted set heat directly in main.js and never come
      // through here, so they stay banner-free.
      if (prevStars > 0 && g.stars === 0) g.events.push({ type: 'heatoff' });
    }
  } else {
    g.coolT = 0;
  }

  // Maintain the fleet: one car per star, up to four. A police car the
  // player has taken is no longer a unit: it must never chase its own
  // driver, count toward the fleet, or drive off and despawn with the
  // player in it. (finishEnterCar converts its kind too; this filter is
  // the second lock on the same door.)
  const policeCars = g.cars.filter((c) => c.kind === 'police' && !c.touched && c.occupant !== 'player');
  const desired = g.stars === 0 ? 0 : Math.min(4, g.stars);
  g.policeSpawnCd -= dt;
  if (policeCars.length < desired && g.policeSpawnCd <= 0) {
    const point = spawnPoint(g);
    if (point) {
      spawnPoliceCar(g, point.x, point.y);
      g.policeSpawnCd = 2.2;
    }
  }
  for (const car of policeCars) {
    if (g.stars === 0) {
      // The heat is gone: drive off and despawn in the distance.
      car.speed = Math.min(CAR.trafficSpeed, car.speed + 200 * dt);
      car.x += Math.cos(car.angle) * car.speed * dt;
      car.y += Math.sin(car.angle) * car.speed * dt;
      syncCarMesh(car, dt);
      if (Math.hypot(car.x - p.x, car.y - p.y) > 780) removeCar(g, car);
    } else {
      chasePlayer(g, car, dt);
    }
    updatePoliceLights(car, time);
  }

  // The bust meter: an officer (or a stopped police car) staying close fills it.
  let pressure = false;
  if (p.state === 'foot') {
    for (const ped of g.peds) {
      if (ped.role === 'cop' && ped.state === 'fight' && Math.hypot(ped.x - p.x, ped.y - p.y) < 32) pressure = true;
    }
  } else if (p.car && Math.abs(p.car.speed) < 30) {
    for (const car of policeCars) {
      if (Math.hypot(car.x - p.x, car.y - p.y) < 52) pressure = true;
    }
    for (const ped of g.peds) {
      if (ped.role === 'cop' && ped.state === 'fight' && Math.hypot(ped.x - p.x, ped.y - p.y) < 40) pressure = true;
    }
  }
  g.bustProgress = Math.max(0, Math.min(g.bustMax, g.bustProgress + (pressure ? dt : -dt * 0.8)));
  if (g.bustProgress >= g.bustMax && g.stars > 0) {
    g.bustProgress = 0;
    g.events.push({ type: 'busted' });
  }
}
