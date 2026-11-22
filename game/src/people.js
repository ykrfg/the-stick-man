// People: the player on foot and every pedestrian, rival, officer and story
// character in Palmera. Each person is a small state machine (walk the sidewalks,
// flee from violence, fight when hostile, lie down when beaten) riding on one of
// the supple stick figures from stick3d.js. Movement and collisions are solved in
// the flat (x, y) world; the figure's group is placed at (x, 0, y) each frame.
import { PLAYER, ROAD, WORLD } from './config.js';
import { clampToWorld, resolveCircleCollision } from './city.js';
import { createFigure } from './stick3d.js';
import { makeTextSprite } from './world3d.js';

const SIDEWALK_OFFSET = 71;

// Every crossing line, built once from the (constant) road grid. walkSidewalk
// used to rebuild these two arrays with flatMap for every walking pedestrian
// on every frame.
const CROSS_LINES_Y = ROAD.streets.flatMap((s) => [s - SIDEWALK_OFFSET, s + SIDEWALK_OFFSET]);
const CROSS_LINES_X = ROAD.avenues.flatMap((a) => [a - SIDEWALK_OFFSET, a + SIDEWALK_OFFSET]);

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
 * 'bruno' (black, stands at the diner and hands out missions). The `armed`
 * option puts the visible pistol in the right hand (mission gunmen); it
 * changes the look and the fight pose, never the mechanics.
 */
// Pedestrian A-type heads wear warm off-whites — close to the hero's look,
// but never his pure #ffffff: in a crowd, the one PURE white head is the
// player's. The slight per-person variation keeps the crowd individual.
const PED_HEAD_TINTS = [0xe7dfc9, 0xdfd7c2, 0xe9e3d3, 0xdcd4bd, 0xe2dbc9];

export function spawnPed(g, { role = 'ped', x = 0, y = 0, name = null, shopIndex = -1, hp = null, chase = null, punchRate = null, armed = false } = {}) {
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
    headColor: black ? undefined : rng.pick(PED_HEAD_TINTS),
    cap: role === 'cop' ? 0x2f7bff : null,
    armed,
  });
  const ped = {
    id: (pedSeq += 1),
    role,
    name,
    shopIndex,
    x, y,
    angle: rng.range(0, Math.PI * 2),
    hp: hp ?? (role === 'cop' ? 120 : role === 'rival' ? 100 : 60),
    state: role === 'bruno' ? 'idle' : 'walk',
    fig,
    axis: spot.axis,
    line: spot.line,
    dir: spot.dir,
    speedNow: 0,
    turnCd: rng.range(0, 1),
    // Sidewalk anti-deadlock state (walkSidewalk): how long a building
    // face has been cancelling this walker's step outright (a quarter
    // second of it turns him back the way he came), and the lateral
    // detour offset the building resolver last imposed on his line.
    blockedT: 0,
    lineOff: 0,
    scaredT: 0,
    downT: 0,
    // Fighter car-dodge (updatePeds): the dive's remaining time, its
    // cooldown, and its burst velocity. Ordinary peds never use them.
    dodgeT: 0,
    dodgeCd: 0,
    dodgeX: 0,
    dodgeY: 0,
    punchCd: rng.range(0.2, 0.7),
    // The cruiser that put this officer out (police.js sets it at
    // deployment; null for everyone else). The stand-down walk in the
    // 'leave' state goes back to it. leaveT is that state's clock:
    // a hard cap so no officer can ever be left standing in a state
    // with no live behaviour.
    ride: null,
    leaveT: 0,
    // Elite-fighter overrides (mission escorts and raid crews): a faster
    // chase and a faster punch than the rank and file, when the spawn
    // asks for them. Null keeps the role defaults in the fight case.
    chase,
    punchRate,
    // Visibly carries the pistol (mission gunmen). A look, not a
    // mechanic: syncFigure raises the gun arm in the fight state, and
    // the fist does the rest exactly as before.
    armed: !!armed,
    exprT: 0,
    baseExpr: role === 'ped' ? 'neutral' : 'angry',
  };
  // Mission-critical people (anyone spawned with a name: Bruno, Shade) carry
  // a floating name label, shown while the player is near — a black stick
  // figure is otherwise indistinguishable from every other black stick
  // figure, which is how "come back for Shade" lost its meaning.
  if (name) {
    const label = makeTextSprite(name, { size: 40, color: '#ffd94d', scale: 0.6 });
    label.position.set(0, 47, 0);
    label.visible = false;
    fig.group.add(label);
    ped.label = label;
  }
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
  bruno.homeX = bruno.x;
  bruno.homeY = bruno.y;
  return bruno;
}

/** Remove a person from the world (despawned, or a passenger who climbed in). */
export function removePed(g, ped) {
  // A departing officer frees his cruiser: with nobody left to pick
  // up, the car stops holding at the kerb and drives off like any
  // unit whose heat died (police.js reads car.officer).
  if (ped.ride && ped.ride.officer === ped) {
    ped.ride.officer = null;
    ped.ride.officerSpawned = false;
  }
  g.scene.remove(ped.fig.group);
  const i = g.peds.indexOf(ped);
  if (i >= 0) g.peds.splice(i, 1);
}

/**
 * Mission-critical people are essential: Bruno, the job desk, and
 * Shade, mission 2's passenger. An essential man flinches at harm but
 * can never be beaten down, run over into the 14-second removal, or
 * turned into a fighter who abandons his post — every protection in
 * this file and in main.js's runover heat keys off this one test.
 */
export function isEssential(ped) {
  return ped.role === 'bruno' || ped.role === 'shade';
}

/**
 * Damage a person. Beaten people fall (state 'down') and may drop cash; the events
 * are pushed to g.events so main.js can add heat, sound and messages. Returns true
 * when this hit put them down.
 */
export function hurtPed(g, ped, damage, { byPlayer = true } = {}) {
  if (ped.state === 'down' || ped.state === 'inCar') return false;
  if (isEssential(ped)) {
    // Essential: he flinches, but he can never be beaten down, run
    // over into the 14-second removal, or turned into a fighter who
    // abandons his post. Without this, one car through the diner door
    // deleted Bruno for good while the "Talk to Bruno" prompt kept
    // firing at the empty spot his stale reference pointed to — and
    // one car past Club Neon did the same to Shade mid-mission.
    ped.fig.setExpression('frustrated');
    ped.exprT = 0.7;
    return false;
  }
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

/**
 * A car ran someone over (the runover event from vehicles.js). Ordinary
 * pedestrians take the full historical damage. FIGHTERS — the mission
 * collectors and officers on foot — take a scaled-down hit and are
 * KNOCKED DOWN instead: the down state stands them back up into the
 * fight after a couple of seconds, so mowing a collection fight down
 * with a car buys the driver a knockdown, not a kill. Only a very fast
 * impact or repeated hits (each ~8 + speed x 0.075, so three-plus
 * solid connections) actually finish a fighter. Bruno keeps his
 * flinch-only path through hurtPed.
 */
export function runOverPed(g, ped, speed, byPlayer = true) {
  if (ped.role === 'rival' || ped.role === 'cop') {
    hurtPed(g, ped, 8 + speed * 0.075, { byPlayer });
    if (ped.hp > 0 && ped.state !== 'down' && ped.state !== 'inCar') {
      ped.state = 'down';
      ped.downT = 0;
      ped.fig.target.down = 1;
    }
    return;
  }
  hurtPed(g, ped, 30 + speed * 0.16, { byPlayer });
}

/** Place a figure in the world and advance its pose. */
export function syncFigure(ent, dt, time, groundY = 0) {
  ent.fig.group.position.set(ent.x, groundY, ent.y);
  ent.fig.group.rotation.y = -ent.angle;
  ent.fig.target.speed = Math.min(1.4, ent.speedNow / 200);
  // Lean into the corner: the arc turned this frame, scaled by how fast
  // he is moving, feeds the rig's bank (clamped, then damped inside
  // stick3d). Walking straight banks nothing; cutting a corner at speed
  // tips the shoulders a few degrees into the line and settles back.
  const prevAngle = ent.figAngle ?? ent.angle;
  const arc = angleArc(prevAngle, ent.angle);
  ent.figAngle = ent.angle;
  const rate = dt > 0 ? arc / dt : 0;
  const pace = Math.min(1, (ent.speedNow ?? 0) / 170);
  ent.fig.target.bank = Math.max(-0.85, Math.min(0.85, rate * 0.05)) * pace;
  // A gunman in the fight holds the pistol up on the player — the rig's
  // aim pose on the gun arm, which the ped's facing (set by the fight
  // state) points at him. Posted, walking or down, the arm hangs and
  // the pistol rides at his side. Only armed peds are touched: the
  // player's own aim is combat.js's business.
  if (ent.armed) ent.fig.target.aim = ent.state === 'fight' ? 1 : 0;
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
  p.angle = car.angle;
  p.fig.target.drive = 1;
  p.fig.target.speed = 0;
  // A seated driver does not bank, crouch, aim or reach for a door: the
  // walk-cycle and climb targets must be cleared, or the arm stays up
  // from a punch fired while running for the door.
  p.fig.target.bank = 0;
  p.fig.target.crouch = 0;
  p.fig.target.reach = 0;
  p.fig.target.aim = 0;
  p.fig.shadow.visible = false;
  p.fig.update(dt, time);
}

/** Shortest signed arc from angle a to angle b, in (-PI, PI]. */
function angleArc(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * The player's legs: WASD/arrows or the touch stick, Shift to sprint,
 * building collisions. Movement is CAMERA-RELATIVE (GTA-style): the input
 * axes are screen-space intent (x = screen right, y = screen down), rotated
 * by the yaw the camera renders with this frame — g.cam.yaw plus the
 * look-back flip — which main.js settles in its camera-control step before
 * this runs. Screen-right in world terms is (sin yaw, -cos yaw) and
 * screen-down is (cos yaw, sin yaw); combining the two gives the world
 * move vector below, so "up" always runs away from the camera the player
 * is actually looking through, however it has orbited or is still easing
 * into its auto-align.
 */
export function updatePlayerOnFoot(g, dt) {
  const p = g.player;
  // Post-hit state (vehicles.js updatePlayerCarHits sets these when a
  // moving car connects): a second of invulnerability, and the brief
  // down/stagger of the hit itself. While down there is no input
  // control — the knockback slide carries him clear while the rig's
  // down pose plays, then he is back on his feet.
  p.hurtT = Math.max(0, (p.hurtT ?? 0) - dt);
  if ((p.downT ?? 0) > 0) {
    p.downT -= dt;
    p.x += (p.kbX ?? 0) * dt;
    p.y += (p.kbY ?? 0) * dt;
    const kbDecay = Math.max(0, 1 - 6 * dt);
    p.kbX = (p.kbX ?? 0) * kbDecay;
    p.kbY = (p.kbY ?? 0) * kbDecay;
    p.speedNow = Math.hypot(p.kbX ?? 0, p.kbY ?? 0);
    p.fig.target.down = p.downT > 0 ? 1 : 0;
    resolveCircleCollision(g.city, p, PLAYER.radius);
    clampToWorld(p, 16);
    return;
  }
  p.fig.target.down = 0;
  const axes = g.input.axes();
  const sprint = g.input.down('ShiftLeft', 'ShiftRight');
  const speed = sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
  const yaw = g.cam.yaw + Math.PI * g.cam.backBlend;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  let mx = axes.x * sin + axes.y * cos;
  let my = -axes.x * cos + axes.y * sin;
  const len = Math.hypot(mx, my);
  // --- Dash: a Space tap (the touch DASH button writes the same code)
  // bursts in the input direction — or straight ahead with no input —
  // at well over sprint speed for a quarter of a second, on a short
  // cooldown. It is the on-foot escape tool: out of a forming bust
  // circle, away from fists, across a gap in traffic. The rig needs no
  // new pose for it: speedNow drives the stride and the spine lean.
  p.dashCd = Math.max(0, (p.dashCd ?? 0) - dt);
  if (g.input.tapped('Space') && p.dashCd <= 0 && !(p.dashT > 0)) {
    if (len > 0.01) {
      p.dashDirX = mx / len;
      p.dashDirY = my / len;
    } else {
      p.dashDirX = Math.cos(p.angle);
      p.dashDirY = Math.sin(p.angle);
    }
    p.dashT = PLAYER.dashTime;
    p.dashCd = PLAYER.dashCooldown;
  }
  if (p.dashT > 0) {
    p.dashT -= dt;
    p.x += p.dashDirX * PLAYER.dashSpeed * dt;
    p.y += p.dashDirY * PLAYER.dashSpeed * dt;
    p.moveAngle = Math.atan2(p.dashDirY, p.dashDirX);
    p.angle += angleArc(p.angle, p.moveAngle) * (1 - Math.exp(-18 * dt));
    p.speedNow = PLAYER.dashSpeed;
  } else if (len > 0) {
    // Analog stick magnitude scales the pace (a light push walks slowly);
    // keyboard axes are always full-length, so this is 1 there as before.
    const mag = Math.min(1, len);
    mx /= len;
    my /= len;
    p.x += mx * speed * mag * dt;
    p.y += my * speed * mag * dt;
    // The direction actually travelled this frame: the camera's auto-align
    // keys off this, never off the eased facing below.
    p.moveAngle = Math.atan2(my, mx);
    // Facing eases toward the travel direction; it never steers movement.
    p.angle += angleArc(p.angle, p.moveAngle) * (1 - Math.exp(-14 * dt));
    p.speedNow = speed * mag;
  } else {
    p.speedNow = 0;
  }
  resolveCircleCollision(g.city, p, PLAYER.radius);
  clampToWorld(p, 16);
  // Do not share a spot with a pedestrian: nudge them politely aside.
  // Essential men are never nudged: the shove has no building resolution
  // behind it, so leaning on Bruno used to walk him into the diner wall,
  // where he stood inside the geometry, invisible, while his talk prompt
  // kept firing. Shade waits for a car at his post, not for a shove.
  for (const ped of g.peds) {
    if (ped.state === 'down' || ped.state === 'inCar' || isEssential(ped)) continue;
    const dx = ped.x - p.x;
    const dy = ped.y - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < 21 * 21 && d2 > 0.01) {
      const d = Math.sqrt(d2);
      ped.x += (dx / d) * 26 * dt;
      ped.y += (dy / d) * 26 * dt;
      // The shove itself must respect walls: leaning on a man who is
      // standing against a facade used to press him into it until his
      // own state's next resolution (Bruno is excluded above for the
      // same reason; now everyone gets the guarantee directly).
      resolvePedCollision(g, ped);
    }
  }
}

/**
 * Pedestrian building collision (round #24). A person is an 11-unit
 * circle and must never end a frame inside a building — but the
 * sidewalk graph alone cannot promise that: its lines run at road
 * centre +/- 71, and the procedural block fill starts buildings 16
 * units inside the block edge (road half-width 55), so for two of the
 * three fill styles the building face lies EXACTLY on the line, and a
 * few landmark footprints span the line outright. walkSidewalk pins a
 * walker to his line every frame, so without resolution he strolled
 * with his body in the wall along whole block faces (the user's
 * "pedestrians pass through walls"). Cars resolve against the whole
 * city (resolveCircleCollision); a crowd cannot afford that per head
 * per frame, so peds resolve against a static grid index of the city:
 * each cell lists only the buildings and trees whose expanded
 * footprints reach into it — every building a person standing in the
 * cell could possibly touch. The push-out math is
 * resolveCircleCollision's own, run on the cell shim, so a ped slides
 * along a face exactly the way a car does, and a centre that somehow
 * lands inside a footprint leaves by its nearest face.
 */
const PED_CELL = 128;
const PED_CELL_PAD = 16; // >= the ped radius: a cell lists everything that can touch it
let pedGridFor = null;
let pedGrid = null;

function buildPedGrid(city) {
  const grid = new Map();
  const put = (key, kind, item) => {
    let cell = grid.get(key);
    if (!cell) {
      cell = { buildings: [], trees: [] };
      grid.set(key, cell);
    }
    cell[kind].push(item);
  };
  const span = (v0, v1) => [Math.floor(v0 / PED_CELL), Math.floor(v1 / PED_CELL)];
  for (const b of city.buildings) {
    const [cx0, cx1] = span(b.x - PED_CELL_PAD, b.x + b.w + PED_CELL_PAD);
    const [cy0, cy1] = span(b.y - PED_CELL_PAD, b.y + b.h + PED_CELL_PAD);
    for (let cx = cx0; cx <= cx1; cx += 1) {
      for (let cy = cy0; cy <= cy1; cy += 1) put(`${cx},${cy}`, 'buildings', b);
    }
  }
  for (const t of city.trees) {
    // Tree collision reaches 18 from the centre (resolveCircleCollision).
    const [cx0, cx1] = span(t.x - 20, t.x + 20);
    const [cy0, cy1] = span(t.y - 20, t.y + 20);
    for (let cx = cx0; cx <= cx1; cx += 1) {
      for (let cy = cy0; cy <= cy1; cy += 1) put(`${cx},${cy}`, 'trees', t);
    }
  }
  return grid;
}

const EMPTY_CELL = { buildings: [], trees: [] };

/** Push a pedestrian's circle out of the buildings and trees near him. */
export function resolvePedCollision(g, ped) {
  if (pedGridFor !== g.city) {
    pedGridFor = g.city;
    pedGrid = buildPedGrid(g.city);
  }
  const key = `${Math.floor(ped.x / PED_CELL)},${Math.floor(ped.y / PED_CELL)}`;
  return resolveCircleCollision(pedGrid.get(key) ?? EMPTY_CELL, ped, PLAYER.radius);
}

/** Walk one person along the sidewalk graph, turning at crossings. */
function walkSidewalk(g, ped, dt, speed) {
  ped.turnCd -= dt;
  const startAxis = ped.axis;
  const startPos = ped.axis === 'y' ? ped.y : ped.x;
  if (ped.axis === 'y') ped.y += ped.dir * speed * dt;
  else ped.x += ped.dir * speed * dt;
  ped.angle = ped.axis === 'y' ? (ped.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (ped.dir > 0 ? 0 : Math.PI);
  // Crossings: the perpendicular sidewalk lines of every crossing road.
  const lines = ped.axis === 'y' ? CROSS_LINES_Y : CROSS_LINES_X;
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
        ped.lineOff = 0; // a new line starts with no detour offset
        ped.dir = g.rng.chance(0.5) ? 1 : -1;
      } else if (g.rng.chance(0.06)) {
        ped.dir *= -1;
      }
      break;
    }
  }
  // Pin to the line — through the detour offset the resolver last
  // imposed (see below), not the bare line: where a face sits on the
  // line, the working path is one radius off it, and re-pinning to the
  // bare line inside the gap between two buildings would seat him
  // between their corners, where both exits are head-on (the alley
  // trap measured in ped-clip-probe's first run).
  const off = ped.lineOff ?? 0;
  if (ped.axis === 'y') ped.x = ped.line + off;
  else ped.y = ped.line + off;
  if (ped.x < 30 || ped.x > WORLD.width - 30 || ped.y < 30 || ped.y > WORLD.height - 30) ped.dir *= -1;
  // The line is a guide, not a promise of clearance: where a building
  // face lies on (or across) the line, the walker steps out to the
  // face and strolls the gutter line instead of the wall (round #24).
  resolvePedCollision(g, ped);
  // Keep the resolver's word over the pin's: if the push-out moved him
  // across his axis, that offset becomes his working line (lineOff)
  // until the bare line is clear again, where it decays home. A purely
  // along-axis push (head-on into a face) leaves the offset alone —
  // the blocked rule below handles that case.
  const crossNow = ped.axis === 'y' ? ped.x : ped.y;
  if (Math.abs(crossNow - (ped.line + off)) > 0.01) {
    ped.lineOff = crossNow - ped.line;
  } else if (off !== 0) {
    ped.lineOff = off * Math.max(0, 1 - 2.5 * dt);
    if (Math.abs(ped.lineOff) < 0.3) ped.lineOff = 0;
  }
  // Head-on is the one case a push-out cannot solve: where a footprint
  // SPANS the line (the Safehouse and Motors frontages) or the next
  // building of an alley faces him across the gap, the resolver cancels
  // his step outright, every frame, and the pin leaves him no lateral
  // room to slide around the corner. If his along-axis progress stays
  // cancelled for a quarter of a second he treats the way as blocked
  // and turns back the way he came — a citizen detour, never a freeze.
  // (A corner he could round resolves within a frame or two, well
  // under the threshold, so rounding never triggers this.)
  const stepLen = speed * dt;
  const progressed = ped.axis === startAxis
    ? Math.abs((ped.axis === 'y' ? ped.y : ped.x) - startPos)
    : stepLen;
  if (stepLen > 0.01 && progressed < stepLen * 0.25) {
    ped.blockedT = (ped.blockedT ?? 0) + dt;
    if (ped.blockedT > 0.25) {
      ped.dir *= -1;
      ped.blockedT = 0;
    }
  } else {
    ped.blockedT = 0;
  }
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
  resolvePedCollision(g, ped);
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
    // Name labels (Bruno, Shade) fade in only at conversational range.
    if (ped.label) {
      ped.label.visible = ped.state !== 'inCar'
        && Math.hypot(ped.x - p.x, ped.y - p.y) < 320;
    }
    // Fighter dive-dodge: collectors and officers on foot dive out of a
    // car's path. A car bearing down on them (real speed, the fighter
    // inside a window ahead of it and near its line) triggers a quick
    // lateral burst — the rig reads it as a crouched dive — with a
    // per-fighter cooldown of just over a second, so the dodge is
    // strong but not absolute: corner him, catch him mid-recovery or
    // mid-cooldown, or while his attention is on the fight, and the
    // car connects. Ordinary pedestrians get none of this.
    if (ped.role === 'rival' || ped.role === 'cop') {
      ped.dodgeCd = Math.max(0, (ped.dodgeCd ?? 0) - dt);
      if (!((ped.dodgeT ?? 0) > 0) && ped.dodgeCd <= 0
        && ped.state !== 'down' && ped.state !== 'inCar' && ped.state !== 'board') {
        for (const car of g.cars) {
          if (car.occupant === ped) continue;
          const cs = Math.abs(car.speed);
          if (cs < 110) continue;
          const fx = Math.cos(car.angle) * Math.sign(car.speed);
          const fy = Math.sin(car.angle) * Math.sign(car.speed);
          const rx = ped.x - car.x;
          const ry = ped.y - car.y;
          const ahead = rx * fx + ry * fy;
          if (ahead < 8 || ahead > 165) continue;
          const lat = ry * fx - rx * fy;
          if (Math.abs(lat) > 46) continue;
          // Dive perpendicular, to the side he is already on; a
          // dead-centre approach dives to his right.
          const side = lat < 0 ? -1 : 1;
          ped.dodgeX = -fy * side * 560;
          ped.dodgeY = fx * side * 560;
          ped.dodgeT = 0.34;
          ped.dodgeCd = 1.15;
          ped.angle = Math.atan2(ped.dodgeY, ped.dodgeX);
          break;
        }
      }
      if ((ped.dodgeT ?? 0) > 0) {
        ped.dodgeT -= dt;
        ped.x += (ped.dodgeX ?? 0) * dt;
        ped.y += (ped.dodgeY ?? 0) * dt;
        const diveDecay = Math.max(0, 1 - 7 * dt);
        ped.dodgeX = (ped.dodgeX ?? 0) * diveDecay;
        ped.dodgeY = (ped.dodgeY ?? 0) * diveDecay;
        ped.speedNow = Math.hypot(ped.dodgeX ?? 0, ped.dodgeY ?? 0);
        ped.fig.target.crouch = 1;
        resolvePedCollision(g, ped);
        clampToWorld(ped, 16);
        syncFigure(ped, dt, time);
        continue;
      }
      ped.fig.target.crouch = 0;
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
      case 'idle': // Bruno (and Shade): stands, sways, watches the street.
        ped.speedNow = 0;
        ped.angle = Math.PI / 2 + Math.sin(time * 0.4) * 0.25;
        if (isEssential(ped) && ped.homeX !== undefined) {
          // Post-keeping: if anything ever displaces an essential man
          // (a shove, a spawn overlap), he walks back to his post, so
          // the man the prompt and the marker name is always standing
          // where they point.
          const dx = ped.homeX - ped.x;
          const dy = ped.homeY - ped.y;
          const d = Math.hypot(dx, dy);
          if (d > 2) {
            const step = Math.min(d, 92 * dt);
            ped.x += (dx / d) * step;
            ped.y += (dy / d) * step;
            // The walk home is a straight line; if a shove ever left
            // him on the far side of the diner wall, he slides along
            // its face to his post instead of strolling through it.
            resolvePedCollision(g, ped);
            ped.speedNow = 60;
          }
        }
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
        // Officers stand down once the heat is gone. A far officer is
        // already out of the story — the cooling clear can only happen
        // with every unit >430 away — and simply leaves the world. A
        // NEAR officer walks back to his cruiser in the 'leave' state:
        // the instant clears (Spray 'n Go paint, the fixer) can zero
        // the heat with him at the player's elbow. (He used to be
        // switched to 'idle' here — Bruno's stand-at-post state, which
        // nothing ever leaves or despawns — so he froze upright
        // forever while his car drove off without him.)
        if (ped.role === 'cop' && g.stars === 0) {
          if (d > 150) {
            removePed(g, ped);
            continue;
          }
          ped.state = 'leave';
          ped.leaveT = 0;
          break;
        }
        if (d > (p.state === 'car' ? 40 : 30)) {
          moveToward(g, ped, target.x, target.y, dt, ped.chase ?? (ped.role === 'cop' ? 196 : 178));
        } else {
          ped.speedNow = 0;
          ped.angle = Math.atan2(target.y - ped.y, target.x - ped.x);
          ped.punchCd -= dt;
          if (ped.punchCd <= 0) {
            ped.punchCd = ped.punchRate ?? (ped.role === 'cop' ? 0.85 : 0.95);
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
      case 'leave': {
        // A stood-down officer walks back to the cruiser that deployed
        // him and climbs in; the car holds at the kerb for him
        // (police.js) and drives off once he is aboard. If the heat
        // comes back he is a pursuer again. If the cruiser is gone —
        // wrecked, taken, or already driven off — he walks away from
        // the player and leaves the world at the usual give-up
        // distance. A hard time cap backstops both routes: this state
        // always ends with the officer back in a car or out of the
        // world, never standing frozen.
        if (g.stars > 0) {
          ped.state = 'fight';
          break;
        }
        ped.leaveT += dt;
        const car = ped.ride;
        const rideOk = !!car && g.cars.includes(car) && car.kind === 'police'
          && !car.wrecked && car.occupant !== 'player';
        if (rideOk && Math.hypot(car.x - ped.x, car.y - ped.y) <= 700) {
          const d = moveToward(g, ped, car.x, car.y, dt, 172);
          if (d <= 38) {
            removePed(g, ped); // climbed in; removePed frees the car
            continue;
          }
        } else {
          moveToward(g, ped, ped.x * 2 - p.x, ped.y * 2 - p.y, dt, 150);
          if (Math.hypot(p.x - ped.x, p.y - ped.y) > 560) {
            removePed(g, ped);
            continue;
          }
        }
        if (ped.leaveT > 15) {
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
