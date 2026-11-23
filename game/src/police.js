// Palmera PD and the wanted system. Heat is the currency: crimes add it
// (more when somebody saw the crime), heat lights stars, and stars decide
// how many cruisers hunt the player. Cruisers ram a player in a car, but
// against a man on foot they stop short and put an officer out — the bust
// meter fills while an officer (or a stopped cruiser) stays close. Heat
// bleeds away only while no unit is near enough to watch, and the Spray
// 'n Go wipe lives in main.js. Police driving is meant to be readable:
// quick in a straight line, clumsy in corners, lost off-road.
import { CAR, HEAT_THRESHOLDS } from './config.js';
import { isOnRoad } from './city.js';
import { moveFreeCar, removeCar, spawnPoliceCar, updatePoliceLights } from './vehicles.js';
import { spawnPed } from './people.js';

/** How many stars a heat value lights. */
export function starsFor(heat) {
  let lit = 0;
  for (const threshold of HEAT_THRESHOLDS) {
    if (heat >= threshold) lit += 1;
  }
  return lit;
}

/** Shortest signed arc from a to b, in (-PI, PI]. */
function angleDelta(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Clamp a per-frame change into [lo, hi]. */
function clampDelta(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Could anyone see a crime committed at (x, y)? Officers and cruisers
 * spot at 470; citizens at 250. Downed and seated people see nothing.
 */
function witnessed(g, x, y) {
  const reaches = (ox, oy, range) => Math.hypot(ox - x, oy - y) < range;
  for (const ped of g.peds) {
    if (ped.state === 'down' || ped.state === 'inCar') continue;
    if (reaches(ped.x, ped.y, ped.role === 'cop' ? 470 : 250)) return true;
  }
  for (const car of g.cars) {
    if (car.kind === 'police' && reaches(car.x, car.y, 470)) return true;
  }
  return false;
}

/**
 * Add heat for a crime at (x, y). An unseen crime counts for about a
 * third; a crime against the police themselves is always fully seen.
 * At five stars the PD is already giving everything, so extra heat
 * counts for less.
 */
export function addHeat(g, amount, x, y, { force = false } = {}) {
  if (g.stars >= 5 && amount > 0) amount *= 0.4;
  g.heat += (force || witnessed(g, x, y)) ? amount : amount * 0.34;
  const stars = starsFor(g.heat);
  if (stars > g.stars) g.events.push({ type: 'starup', stars });
  g.stars = stars;
}

/** A road point 700–900 out from the player, for a fresh cruiser. */
function spawnPoint(g) {
  for (let tries = 0; tries < 10; tries += 1) {
    const angle = g.rng.range(0, Math.PI * 2);
    const dist = g.rng.range(700, 900);
    const x = g.player.x + Math.cos(angle) * dist;
    const y = g.player.y + Math.sin(angle) * dist;
    if (x < 60 || y < 60 || x > 3300 || y > 2460) continue;
    if (!isOnRoad(x, y)) continue;
    return { x, y };
  }
  return null;
}

/** Brake a cruiser to a standstill over the frame and roll it. */
function rollToStop(g, car, dt) {
  const step = 500 * dt;
  car.speed = Math.abs(car.speed) <= step ? 0 : car.speed - Math.sign(car.speed) * step;
  moveFreeCar(g, car, dt);
}

/**
 * Shared cruiser steering: reverse out when wedged, otherwise ease the
 * speed toward `wanted` and the heading toward the target bearing.
 * `stuckRange` is the distance beyond which crawling counts as stuck —
 * near a planned stop, crawling is the job, not a wedge.
 */
function steerCruiser(car, dt, diff, wanted, distNow, stuckRange) {
  if (car.reverseT > 0) {
    car.reverseT -= dt;
    car.speed = -150;
    car.angle -= Math.sign(diff || 1) * 1.8 * dt;
    return;
  }
  car.speed += clampDelta(wanted - car.speed, -500 * dt, 300 * dt);
  car.angle += clampDelta(diff, -2.5 * dt, 2.5 * dt);
  if (Math.abs(car.speed) < 22 && distNow > stuckRange) {
    car.stuckT = (car.stuckT ?? 0) + dt;
    if (car.stuckT > 1.1) {
      car.reverseT = 0.55;
      car.stuckT = 0;
    }
  } else {
    car.stuckT = 0;
  }
}

/** A cruiser hunting a man on foot stops this far short of him. */
const DEPLOY_DIST = 95;

/**
 * Hunt a player ON FOOT: the car is never the weapon here. It brakes on
 * a curve that stops DEPLOY_DIST short, the officer climbs out, and the
 * arrest happens on foot. While the officer works, the car holds its
 * stop; if the player quits the neighbourhood entirely, the car is free
 * to reposition and deploy again once no officer is already on him.
 * The braking curve (brake 300) sits well under what the approach can
 * deliver (500), so the stop tracks with room to spare — and the hit
 * rules refuse police-car damage to an on-foot player outright anyway.
 */
function chaseOnFoot(g, car, dt) {
  const p = g.player;
  const dist = Math.hypot(p.x - car.x, p.y - car.y);
  if (car.officerSpawned) {
    if (dist < 380) {
      rollToStop(g, car, dt);
      return;
    }
    // Long gone from this car: it may deploy again where he went, once
    // no officer is already working him. The abandoned officer keeps
    // his own lifecycle (stand-down, then despawn when left behind).
    const officerBusy = g.peds.some((ped) => ped.role === 'cop' && ped.state === 'fight'
      && Math.hypot(ped.x - p.x, ped.y - p.y) < 470);
    if (!officerBusy) car.officerSpawned = false;
  }
  const diff = angleDelta(car.angle, Math.atan2(p.y - car.y, p.x - car.x));
  const top = CAR.policeSpeed * (g.stars >= 3 ? 1 : 0.82);
  const curve = Math.sqrt(2 * 300 * Math.max(0, dist - DEPLOY_DIST));
  let wanted = Math.min(top, curve);
  if (Math.abs(diff) > 2.1) wanted = Math.min(wanted, 110);
  steerCruiser(car, dt, diff, wanted, dist, 170);
  moveFreeCar(g, car, dt);
  // Stopped near him, with no officer out yet: deploy.
  if (!car.officerSpawned && Math.abs(car.speed) < 65
    && Math.hypot(p.x - car.x, p.y - car.y) < 105) {
    car.officerSpawned = true;
    const officer = spawnPed(g, { role: 'cop', x: car.x + 20, y: car.y + 10 });
    officer.state = 'fight';
    // The stand-down walk (people.js 'leave') returns to this car, and
    // this car holds at the kerb for him once the heat dies.
    officer.ride = car;
    car.officer = officer;
    g.events.push({ type: 'officer' });
  }
}

/** Hunt the player for one frame, in whichever mode fits his state. */
function chasePlayer(g, car, dt) {
  const p = g.player;
  // Chasing is not a drive-off: the stall watch in the stand-down
  // branch starts fresh when the heat next dies.
  car.offAnchor = null;
  car.offWindow = 0;
  car.offStuck = 0;
  if (p.state === 'foot') {
    chaseOnFoot(g, car, dt);
    return;
  }
  // In a car it is a chase, ramming included, exactly as it always was.
  const diff = angleDelta(car.angle, Math.atan2(p.y - car.y, p.x - car.x));
  const top = CAR.policeSpeed * (g.stars >= 3 ? 1 : 0.82);
  const wanted = Math.abs(diff) > 2.1 ? 110 : top;
  const dist = Math.hypot(p.x - car.x, p.y - car.y);
  steerCruiser(car, dt, diff, wanted, dist, 90);
  moveFreeCar(g, car, dt);
}

// The active cruiser list, rebuilt in place each frame. It used to be a
// fresh filter() per update — an allocation and a closure sixty times a
// second — for a list that never escapes updatePolice.
const policeCars = [];

/** One frame of the wanted system: cooling, the fleet, the bust meter. */
export function updatePolice(g, dt, time) {
  const p = g.player;
  g.stars = starsFor(g.heat);

  // --- Cooling. Heat drains only while nothing is close enough to
  // watch: the nearest live cruiser or fighting officer sets the range.
  // A wrecked cruiser watches nothing and holds nothing open.
  let nearest = Infinity;
  for (const car of g.cars) {
    if (car.kind === 'police' && !car.wrecked) {
      nearest = Math.min(nearest, Math.hypot(car.x - p.x, car.y - p.y));
    }
  }
  for (const ped of g.peds) {
    if (ped.role === 'cop' && ped.state === 'fight') {
      nearest = Math.min(nearest, Math.hypot(ped.x - p.x, ped.y - p.y));
    }
  }
  g.policeNear = nearest < 470;
  // `cooling` is the HUD's losing-them signal: true exactly while heat
  // is draining, so the blinking stars never lie about the state.
  g.cooling = false;
  if (nearest > 380) {
    g.coolT += dt;
    if (g.coolT > 1.5 && g.heat > 0) {
      const prevStars = g.stars;
      g.heat = Math.max(0, g.heat - 22 * dt);
      g.stars = starsFor(g.heat);
      g.cooling = true;
      // Losing the last star to stealth is worth announcing. The paint
      // wipe and busted/wasted set heat directly in main.js and never
      // pass through here, so they stay banner-free.
      if (prevStars > 0 && g.stars === 0) g.events.push({ type: 'heatoff' });
    }
  } else {
    g.coolT = 0;
  }

  // --- The fleet. One live cruiser per star, up to four. A cruiser the
  // player has taken is no longer a unit: it never counts, never chases
  // its own driver, never drives off with him in it. A wrecked unit is
  // out of the response too — it burns where it died until the wreck
  // system sinks it — but it stays in the list below for its lights and
  // its stopped-car bust pressure, as it behaved while the heat was up.
  policeCars.length = 0;
  for (const c of g.cars) {
    if (c.kind === 'police' && !c.touched && c.occupant !== 'player') policeCars.push(c);
  }
  const desired = g.stars === 0 ? 0 : Math.min(4, g.stars);
  g.policeSpawnCd -= dt;
  let activeUnits = 0;
  for (const c of policeCars) if (!c.wrecked) activeUnits += 1;
  if (activeUnits < desired && g.policeSpawnCd <= 0) {
    const point = spawnPoint(g);
    if (point) {
      spawnPoliceCar(g, point.x, point.y);
      g.policeSpawnCd = 2.2;
    }
  }

  for (const car of policeCars) {
    if (g.stars === 0) {
      if (car.wrecked) {
        // A wrecked unit cannot drive off; it burns where it died. (It
        // also skips its lights update — it is out of the story.)
        continue;
      }
      // A car whose officer is walking back holds at the kerb until he
      // climbs in — driving off would strand him. A knocked-down
      // officer who will get back up is waited for; a dead one is not.
      // removePed frees car.officer the moment he boards or leaves the
      // world, and the 'leave' state's own cap bounds the wait.
      const off = car.officer;
      const officerReturning = !!off && g.peds.includes(off)
        && (off.state === 'leave' || (off.state === 'down' && off.hp > 0));
      if (officerReturning) {
        rollToStop(g, car, dt);
        // Holding is not a drive-off: the stall watch starts fresh
        // once he boards.
        car.offAnchor = null;
        car.offWindow = 0;
        car.offStuck = 0;
      } else {
        // The heat is gone: drive off and despawn in the distance. The
        // drive goes through moveFreeCar — the collision-aware move —
        // so a withdrawing cruiser is stopped and slid by buildings
        // like any other car. (It used to integrate its position
        // directly and ghost through walls.) Removal is distance-based,
        // with one bound: a cruiser wedged against a facade makes no
        // progress, so its stall is measured in 1-second windows and
        // after ~4 game-seconds of going nowhere it is towed out.
        car.speed = Math.min(CAR.trafficSpeed, car.speed + 200 * dt);
        moveFreeCar(g, car, dt);
        if (Math.hypot(car.x - p.x, car.y - p.y) > 780) {
          removeCar(g, car);
        } else {
          if (!car.offAnchor) {
            car.offAnchor = { x: car.x, y: car.y };
            car.offWindow = 0;
            car.offStuck = 0;
          }
          car.offWindow += dt;
          if (car.offWindow >= 1) {
            const moved = Math.hypot(car.x - car.offAnchor.x, car.y - car.offAnchor.y);
            car.offStuck = moved < 40 ? (car.offStuck ?? 0) + 1 : 0;
            car.offAnchor = { x: car.x, y: car.y };
            car.offWindow = 0;
            if (car.offStuck >= 4) removeCar(g, car);
          }
        }
      }
    } else if (!car.wrecked) {
      chasePlayer(g, car, dt);
    }
    // A wrecked unit is never driven, at any heat — only its lights
    // still update.
    updatePoliceLights(car, time);
  }

  // --- The bust meter. An officer on top of a player on foot fills it;
  // against a stopped player car, a close cruiser or officer does.
  let pressure = false;
  if (p.state === 'foot') {
    for (const ped of g.peds) {
      if (ped.role === 'cop' && ped.state === 'fight'
        && Math.hypot(ped.x - p.x, ped.y - p.y) < 32) pressure = true;
    }
  } else if (p.car && Math.abs(p.car.speed) < 30) {
    for (const car of policeCars) {
      if (Math.hypot(car.x - p.x, car.y - p.y) < 52) pressure = true;
    }
    for (const ped of g.peds) {
      if (ped.role === 'cop' && ped.state === 'fight'
        && Math.hypot(ped.x - p.x, ped.y - p.y) < 40) pressure = true;
    }
  }
  g.bustProgress = Math.max(0, Math.min(g.bustMax, g.bustProgress + (pressure ? dt : -dt * 0.8)));
  if (g.bustProgress >= g.bustMax && g.stars > 0) {
    g.bustProgress = 0;
    g.events.push({ type: 'busted' });
  }
}
