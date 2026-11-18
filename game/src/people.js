// People: the player on foot and every pedestrian, rival, officer and story
// character in Palmera. Each person is a small state machine (walk the sidewalks,
// flee from violence, fight when hostile, lie down when beaten) riding on one of
// the supple stick figures from stick3d.js. Movement and collisions are solved in
// the flat (x, y) world; the figure's group is placed at (x, 0, y) each frame.
import { PLAYER, ROAD, WORLD } from './config.js';
import { clampToWorld, resolveCircleCollision } from './city.js';
import { createFigure } from './stick3d.js';

const SIDEWALK_OFFSET = 71;

/** Sidewalk lines run beside every road: avenue lines are constant-x, street lines constant-y. */
function randomSidewalkPoint(rng) {
  if (rng.chance(0.55)) {
    const avenue = rng.pick(ROAD.avenues);
    const line = avenue + (rng.chance(0.5) ? SIDEWALK_OFFSET : -SIDEWALK_OFFSET);
    return { x: line, y: rng.range(90, WORLD.height - 90), axis: 'y', line, dir: rng.chance(0.5) ? 1 : -1 };
  }
  const street = rng.pick(ROAD.streets);
  const line = street + (rng.chance(0.5) ? SIDEWALK_OFFSET : -SIDEWALK_OFFSET);
  return { x: rng.range(90, WORLD.width - 90), y: line, axis: 'x', line, dir: rng.chance(0.5) ? 1 : -1 };
}

let pedSeq = 0;

/**
 * Create one person and add its figure to the scene. role decides the behaviour
 * and the look: 'ped' (citizen, mixed fills), 'rival' (black, hostile), 'cop'
 * (black with a blue cap, arrests), 'shade' (black, the getaway passenger),
 * 'bruno' (black, stands at the diner and hands out missions).
 */
export function spawnPed(g, { role = 'ped', x = 0, y = 0, name = null, shopIndex = -1 } = {}) {
  const rng = g.rng;
  let spot = { x, y, axis: 'y', line: x, dir: 1 };
  if (x === 0 && y === 0) {
    spot = randomSidewalkPoint(rng);
    x = spot.x;
    y = spot.y;
  }
  const black = role !== 'ped' ? true : rng.chance(0.35);
  const fig = createFigure({
    fill: black ? 'black' : 'white',
    cap: role === 'cop' ? 0x2f7bff : null,
  });
  const ped = {
    id: (pedSeq += 1),
    role,
    name,
    shopIndex,
    x, y,
    angle: rng.range(0, Math.PI * 2),
    hp: role === 'cop' ? 120 : role === 'rival' ? 100 : 60,
    state: role === 'bruno' ? 'idle' : 'walk',
    fig,
    axis: spot.axis,
    line: spot.line,
    dir: spot.dir,
    speedNow: 0,
    turnCd: rng.range(0, 1),
    scaredT: 0,
    downT: 0,
    punchCd: rng.range(0.2, 0.7),
    exprT: 0,
    baseExpr: role === 'ped' ? 'neutral' : 'angry',
  };
  fig.group.position.set(x, 0, y);
  g.peds.push(ped);
  g.scene.add(fig.group);
  return ped;
}

/** Fill the sidewalks with citizens at the start of a run. */
export function spawnPeds(g, count = 15) {
  for (let i = 0; i < count; i += 1) {
    const ped = spawnPed(g, { role: 'ped' });
    if (Math.hypot(ped.x - g.player.x, ped.y - g.player.y) < 200) {
      ped.x += 260;
      ped.y += 200;
      ped.fig.group.position.set(ped.x, 0, ped.y);
    }
  }
  // Bruno waits outside his diner all day.
  const diner = g.city.landmarks.diner;
  const bruno = spawnPed(g, { role: 'bruno', x: diner.x - 26, y: diner.y + 6, name: 'BRUNO' });
  bruno.angle = Math.PI / 2;
  return bruno;
}

/** Remove a person from the world (despawned, or a passenger who climbed in). */
export function removePed(g, ped) {
  g.scene.remove(ped.fig.group);
  const i = g.peds.indexOf(ped);
  if (i >= 0) g.peds.splice(i, 1);
}

/**
 * Damage a person. Beaten people fall (state 'down') and may drop cash; the events
 * are pushed to g.events so main.js can add heat, sound and messages. Returns true
 * when this hit put them down.
 */
export function hurtPed(g, ped, damage, { byPlayer = true } = {}) {
  if (ped.state === 'down' || ped.state === 'inCar') return false;
  ped.hp -= damage;
  ped.fig.setExpression('frustrated');
  ped.exprT = 0.7;
  if (ped.role === 'ped') {
    ped.state = 'flee';
    ped.scaredT = 3.2;
    g.threat = { x: ped.x, y: ped.y, t: 4 };
  }
  if (ped.hp <= 0) {
    ped.state = 'down';
    ped.downT = 0;
    if (byPlayer && ped.role !== 'cop') {
      if (g.rng.chance(0.55)) {
        g.events.push({ type: 'cashdrop', x: ped.x, y: ped.y, amount: g.rng.int(8, 30) });
      }
    }
    return true;
  }
  return false;
}

/** Place a figure in the world and advance its pose. */
export function syncFigure(ent, dt, time, groundY = 0) {
  ent.fig.group.position.set(ent.x, groundY, ent.y);
  ent.fig.group.rotation.y = -ent.angle;
  ent.fig.target.speed = Math.min(1.4, ent.speedNow / 200);
  ent.fig.update(dt, time);
}

/**
 * Seat the player's figure in their car: on the driver's side, sunk onto the seat,
 * hands on the wheel (the drive pose), shadow off. Used every frame while driving.
 */
export function seatDriverFigure(g, dt, time) {
  const p = g.player;
  const car = p.car;
  if (!car) return;
  const lx = -2;
  const ly = -6;
  const c = Math.cos(car.angle);
  const s = Math.sin(car.angle);
  p.fig.group.position.set(car.x + lx * c - ly * s, 2, car.y + lx * s + ly * c);
  p.fig.group.rotation.y = -car.angle;
  p.fig.target.drive = 1;
  p.fig.target.speed = 0;
  p.fig.shadow.visible = false;
  p.fig.update(dt, time);
}

/** The player's legs: WASD/arrows, Shift to sprint, smooth facing, building collisions. */
export function updatePlayerOnFoot(g, dt) {
  const p = g.player;
  const axes = g.input.axes();
  const sprint = g.input.down('ShiftLeft', 'ShiftRight');
  const speed = sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
  let mx = axes.x;
  let my = axes.y;
  const len = Math.hypot(mx, my);
  if (len > 0) {
    // Analog stick magnitude scales the pace (a light push walks slowly);
    // keyboard axes are always full-length, so this is 1 there as before.
    const mag = Math.min(1, len);
    mx /= len;
    my /= len;
    p.x += mx * speed * mag * dt;
    p.y += my * speed * mag * dt;
    p.angle = Math.atan2(my, mx);
    p.speedNow = speed * mag;
  } else {
    p.speedNow = 0;
  }
  resolveCircleCollision(g.city, p, PLAYER.radius);
  clampToWorld(p, 16);
  // Do not share a spot with a pedestrian: nudge them politely aside.
  for (const ped of g.peds) {
    if (ped.state === 'down' || ped.state === 'inCar') continue;
    const dx = ped.x - p.x;
    const dy = ped.y - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < 21 * 21 && d2 > 0.01) {
      const d = Math.sqrt(d2);
      ped.x += (dx / d) * 26 * dt;
      ped.y += (dy / d) * 26 * dt;
    }
  }
}

/** Walk one person along the sidewalk graph, turning at crossings. */
function walkSidewalk(g, ped, dt, speed) {
  ped.turnCd -= dt;
  if (ped.axis === 'y') ped.y += ped.dir * speed * dt;
  else ped.x += ped.dir * speed * dt;
  ped.angle = ped.axis === 'y' ? (ped.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (ped.dir > 0 ? 0 : Math.PI);
  // Crossings: the perpendicular sidewalk lines of every crossing road.
  const lines = ped.axis === 'y'
    ? ROAD.streets.flatMap((s) => [s - SIDEWALK_OFFSET, s + SIDEWALK_OFFSET])
    : ROAD.avenues.flatMap((a) => [a - SIDEWALK_OFFSET, a + SIDEWALK_OFFSET]);
  const pos = ped.axis === 'y' ? ped.y : ped.x;
  for (const line of lines) {
    if (Math.abs(pos - line) < speed * dt + 1.5 && ped.turnCd <= 0) {
      ped.turnCd = 0.8;
      if (g.rng.chance(0.3)) {
        if (ped.axis === 'y') {
          ped.axis = 'x';
          ped.y = line;
          ped.line = line;
        } else {
          ped.axis = 'y';
          ped.x = line;
          ped.line = line;
        }
        ped.dir = g.rng.chance(0.5) ? 1 : -1;
      } else if (g.rng.chance(0.06)) {
        ped.dir *= -1;
      }
      break;
    }
  }
  if (ped.axis === 'y') ped.x = ped.line;
  else ped.y = ped.line;
  if (ped.x < 30 || ped.x > WORLD.width - 30 || ped.y < 30 || ped.y > WORLD.height - 30) ped.dir *= -1;
  ped.speedNow = speed;
}

/** Move a person straight toward a point at a speed; returns the distance left. */
function moveToward(g, ped, tx, ty, dt, speed) {
  const dx = tx - ped.x;
  const dy = ty - ped.y;
  const d = Math.hypot(dx, dy);
  if (d > 1) {
    ped.angle = Math.atan2(dy, dx);
    const step = Math.min(d, speed * dt);
    ped.x += (dx / d) * step;
    ped.y += (dy / d) * step;
  }
  ped.speedNow = d > 4 ? speed : 0;
  resolveCircleCollision(g.city, ped, PLAYER.radius);
  clampToWorld(ped, 16);
  return d;
}

/** Every person's brain for one frame. */
export function updatePeds(g, dt, time) {
  const p = g.player;
  for (const ped of [...g.peds]) {
    if (ped.exprT > 0) {
      ped.exprT -= dt;
      if (ped.exprT <= 0) ped.fig.setExpression(ped.baseExpr);
    }
    switch (ped.state) {
      case 'down': {
        ped.downT += dt;
        ped.speedNow = 0;
        ped.fig.target.down = 1;
        if (ped.hp > 0 && ped.downT > 2.6) {
          ped.state = ped.role === 'ped' ? 'flee' : 'fight';
          ped.scaredT = 2;
          ped.fig.target.down = 0;
        } else if (ped.hp <= 0 && ped.downT > 14) {
          removePed(g, ped);
          continue;
        }
        break;
      }
      case 'inCar':
        continue;
      case 'idle': // Bruno: stands, sways, watches the street.
        ped.speedNow = 0;
        ped.angle = Math.PI / 2 + Math.sin(time * 0.4) * 0.25;
        break;
      case 'board': { // Shade runs for the player's car and climbs in.
        const car = p.car ?? g.nearestCar;
        if (!car) {
          ped.state = 'fight';
          break;
        }
        const d = moveToward(g, ped, car.x, car.y, dt, 250);
        if (d < 30) {
          ped.state = 'inCar';
          ped.fig.group.visible = false;
          g.passenger = ped;
          g.events.push({ type: 'boarded' });
        }
        break;
      }
      case 'flee': {
        ped.scaredT -= dt;
        const threat = g.threat ?? p;
        const d = moveToward(g, ped, ped.x * 2 - threat.x, ped.y * 2 - threat.y, dt, 235);
        void d;
        if (ped.scaredT <= 0) ped.state = 'walk';
        break;
      }
      case 'fight': {
        // Hostiles chase the player; on foot they punch him, in a car they beat the car.
        const target = p.state === 'car' && p.car ? p.car : p;
        const d = Math.hypot(target.x - ped.x, target.y - ped.y);
        // Officers stand down once the heat is gone: they stop, then wander off.
        if (ped.role === 'cop' && g.stars === 0) {
          if (d > 150) {
            removePed(g, ped);
            continue;
          }
          ped.state = 'idle';
          break;
        }
        if (d > (p.state === 'car' ? 40 : 30)) {
          moveToward(g, ped, target.x, target.y, dt, ped.role === 'cop' ? 196 : 178);
        } else {
          ped.speedNow = 0;
          ped.angle = Math.atan2(target.y - ped.y, target.x - ped.x);
          ped.punchCd -= dt;
          if (ped.punchCd <= 0) {
            ped.punchCd = ped.role === 'cop' ? 0.85 : 0.95;
            ped.fig.triggerPunch();
            g.events.push({ type: 'npcpunch', ped, targetCar: p.state === 'car' });
          }
        }
        // Cops give up the foot chase when the player is long gone.
        if (ped.role === 'cop' && d > 620) {
          removePed(g, ped);
          continue;
        }
        break;
      }
      default: { // 'walk'
        if (g.threat && g.threat.t > 0 && Math.hypot(ped.x - g.threat.x, ped.y - g.threat.y) < 190 && ped.role === 'ped') {
          ped.state = 'flee';
          ped.scaredT = 2.6;
          break;
        }
        walkSidewalk(g, ped, dt, 92);
      }
    }
    syncFigure(ped, dt, time);
  }
  if (g.threat && g.threat.t > 0) g.threat.t -= dt;
}
