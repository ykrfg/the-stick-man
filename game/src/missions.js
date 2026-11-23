// missions.js — everything Bruno hands out at the diner counter.
//
// The story is a chain of six jobs, unlocked strictly in order: run a
// package to the pier and come back, fetch Shade from Club Neon, lean on
// every shop in town, take back a debtor's car, stop a courier and lift
// his case, and finally hit the pier warehouse against the clock. When
// the chain is finished Bruno keeps the counter busy with repeatable
// odd jobs — deliveries and collections in alternation.
//
// Set pieces (guards, cars, Shade, the courier) are posted the moment
// work is accepted or a step turns, never when the player shows up, so
// nobody materialises in plain sight. One gold marker points at the
// current objective, a red one at a fight that is owed, and a permanent
// orange one keeps the diner findable. Being busted or wasted tears
// down whatever is running and the player starts again at the counter.
import { HEAT_THRESHOLDS, RAID_TIME_BONUS, RAID_TIMER } from './config.js';
import { makeMarker } from './world3d.js';
import { removePed, spawnPed } from './people.js';
import { driveCourier, removeCar, spawnCar, spawnCourierCar } from './vehicles.js';
import { addHeat } from './police.js';
import { t } from './i18n.js';

const CHAIN = 6;

// Bruno's serious troublemakers: escorts and the warehouse yard crew.
// Their pistols are carried, never fired — in Palmera only the player
// shoots — so on paper they are elite fist fighters.
const MUSCLE = { hp: 150, chase: 208, punchRate: 0.7, armed: true };

export function missionTitle(index) {
  return t(`mission.${index}.title`);
}

function introLine(index) {
  return t(`mission.${index}.intro`);
}

function blankMission(doneCount) {
  return {
    index: Math.min(CHAIN, doneCount),
    active: false,
    phase: '',
    shopStep: 0,
    rivals: [],
    shade: null,
    targetCar: null,
    courier: null,
    yardMen: [],
    timer: 0,
    timeBonus: false,
  };
}

function blankJob() {
  return {
    active: false,
    type: '',
    phase: '',
    from: null,
    to: null,
    shopIndex: -1,
    rivals: [],
    reward: 0,
    lastType: '',
  };
}

/**
 * Set up the mission/job state and the three markers. The diner marker
 * is placed once and never moves; whether it shows is re-decided every
 * frame by watchDinerMarker below.
 */
export function missionsInit(g) {
  const finished = (g.saveData.missionsDone ?? []).length;
  g.mission = blankMission(finished);
  g.job = blankJob();
  g.markerGold = makeMarker(0xffcf3f, '!');
  g.markerRed = makeMarker(0xff5a4d, '!');
  g.markerGold.visible = false;
  g.markerRed.visible = false;
  g.scene.add(g.markerGold, g.markerRed);
  const diner = g.city.landmarks.diner;
  g.markerDiner = makeMarker(0xff9f43, t('marker.diner'), { height: 58, spriteColor: '#ffb25e', spriteScale: 0.95 });
  g.markerDiner.position.set(diner.x, 0, diner.y);
  g.markerDiner.visible = false;
  g.scene.add(g.markerDiner);
}

export function missionAvailable(g) {
  return !g.mission.active && g.mission.index < CHAIN;
}

export function jobAvailable(g) {
  return !g.mission.active && !g.job.active && g.mission.index >= CHAIN;
}

/* ------------------------------------------------------------ markers -- */

function goldAt(g, x, y) {
  g.markerGold.visible = true;
  g.markerGold.position.set(x, 0, y);
  g.markerRed.visible = false;
}

function redAt(g, x, y) {
  g.markerRed.visible = true;
  g.markerRed.position.set(x, 0, y);
  g.markerGold.visible = false;
}

function markersOff(g) {
  g.markerGold.visible = false;
  g.markerRed.visible = false;
}

/**
 * Point a marker at a car. If the car is somehow no longer in the world,
 * only the OTHER marker is hidden — each step's staging relies on which
 * one survives, so the asymmetry is deliberate.
 */
function carMark(g, car, gold) {
  if (car) {
    if (gold) goldAt(g, car.x, car.y);
    else redAt(g, car.x, car.y);
    return;
  }
  if (gold) g.markerRed.visible = false;
  else g.markerGold.visible = false;
}

/**
 * The diner marker is up whenever play is live and the objective sits
 * somewhere else; when the objective is Bruno's own doorstep the gold
 * marker already covers it. Shot scenes never show it.
 */
function watchDinerMarker(g, time) {
  const d = g.markerDiner;
  if (!d) return;
  d.userData.update(time);
  if (g.shotMode) {
    d.visible = false;
    return;
  }
  const diner = g.city.landmarks.diner;
  const goal = objectiveTarget(g);
  d.visible = !(goal && Math.hypot(goal.x - diner.x, goal.y - diner.y) < 90);
}

/* ------------------------------------------------------- posting pieces --
 * Guards and cars enter the world when work is taken or a step turns —
 * placed ahead of the player, never popped in on arrival. */

function postShopGuards(g, shop, shopIndex) {
  const pair = [
    spawnPed(g, { role: 'rival', x: shop.x + 30, y: shop.y - 16, shopIndex }),
    spawnPed(g, { role: 'rival', x: shop.x - 26, y: shop.y + 22, shopIndex }),
  ];
  for (const man of pair) man.state = 'idle';
  return pair;
}

/** REPO JOB: the debtor's gold car, kerbed behind the Ammo Hut, guarded. */
function postRepoCar(g) {
  const m = g.mission;
  let y = 2300;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const blocked = g.cars.some((c) => Math.hypot(c.x - 761, c.y - y) < 70);
    if (!blocked) break;
    y += 110;
  }
  const car = spawnCar(g, 'parked', 761, y, Math.PI / 2, 0xffd166);
  car.hp = 260;
  m.targetCar = car;
  m.rivals = [
    spawnPed(g, { role: 'rival', x: 726, y: y - 30 }),
    spawnPed(g, { role: 'rival', x: 726, y: y + 32 }),
  ];
  for (const guard of m.rivals) guard.state = 'idle';
}

/** WAREHOUSE RAID: a pair on the south face, the real crew in the yard. */
function postRaidCrew(g) {
  const m = g.mission;
  const pier = g.city.landmarks.pier;
  m.rivals = [
    spawnPed(g, { role: 'rival', x: pier.x - 40, y: pier.y - 28 }),
    spawnPed(g, { role: 'rival', x: pier.x + 42, y: pier.y - 28 }),
  ];
  m.yardMen = [
    spawnPed(g, { role: 'rival', x: pier.x - 92, y: pier.y + 22, ...MUSCLE }),
    spawnPed(g, { role: 'rival', x: pier.x, y: pier.y + 38, ...MUSCLE }),
    spawnPed(g, { role: 'rival', x: pier.x + 92, y: pier.y + 22, ...MUSCLE }),
  ];
  for (const ped of m.rivals.concat(m.yardMen)) ped.state = 'idle';
}

/** The raid's crate sits on the pier's north edge. */
function cratePoint(g) {
  const pier = g.city.landmarks.pier;
  return { x: pier.x, y: pier.y - 35 };
}

/* ---------------------------------------------------------- fight maths -- */

/**
 * A rival counts as beaten when he is dead (hp <= 0) or already gone
 * from the world. Merely being 'down' does not count: a car knockdown
 * floors a man with health to spare and he climbs back up, so treating
 * the state as beaten once let a drive-through "win" a fight and the
 * cleanup then vanished living men.
 */
function foeOut(g, r) {
  return r.hp <= 0 || !g.peds.includes(r);
}

function waveOut(g, rivals) {
  return rivals.every((r) => foeOut(g, r));
}

/** Only men still idling are woken — a man already down stays down. */
function rouseWave(rivals) {
  for (const r of rivals) {
    if (r.state === 'idle') r.state = 'fight';
  }
}

function sweepFoes(g, holder) {
  for (const r of holder.rivals) removePed(g, r);
  holder.rivals = [];
}

/** The closest rival still on his feet — a fight objective's true spot. */
function nearestFoeUp(g) {
  let pick = null;
  let pickDist = Infinity;
  for (const r of g.mission.rivals) {
    if (foeOut(g, r)) continue;
    const d = Math.hypot(r.x - g.player.x, r.y - g.player.y);
    if (d < pickDist) {
      pickDist = d;
      pick = r;
    }
  }
  return pick;
}

/** Raise the heat to a scripted star level: the law "notices" the job. */
function forceStars(g, stars) {
  const gap = HEAT_THRESHOLDS[stars - 1] + 5 - g.heat;
  if (gap > 0) addHeat(g, gap, g.player.x, g.player.y, { force: true });
}

/* ---------------------------------------------------------- taking work -- */

// One starter per story job, run at the counter the moment the player
// accepts. Everything the job needs is posted here, up front.
const STARTERS = [
  (g, m) => {
    m.phase = 'toWarehouse';
  },
  (g, m) => {
    m.phase = 'toClub';
    // Shade is standing at the club door from now on; walking up later
    // reveals a man who was already there, not a spawn-in.
    const club = g.city.landmarks.club;
    m.shade = spawnPed(g, { role: 'shade', x: club.x + 24, y: club.y + 10, name: 'SHADE' });
    m.shade.fig.setExpression('angry');
    m.shade.state = 'idle';
    m.shade.homeX = m.shade.x;
    m.shade.homeY = m.shade.y;
  },
  (g, m) => {
    m.phase = 'toShop';
    m.rivals = postShopGuards(g, g.city.shops[0], 0);
  },
  (g, m) => {
    m.phase = 'toCar';
    postRepoCar(g);
  },
  (g, m) => {
    m.phase = 'intercept';
    m.courier = spawnCourierCar(g);
  },
  (g, m) => {
    m.phase = 'raidDrive';
    m.timer = RAID_TIMER;
    m.timeBonus = true;
    postRaidCrew(g);
  },
];

/** Start the story job the chain has reached: the player talked to Bruno. */
export function acceptMission(g) {
  const m = g.mission;
  if (!missionAvailable(g)) return;
  m.active = true;
  m.shopStep = 0;
  m.rivals = [];
  STARTERS[m.index](g, m);
  g.say(missionTitle(m.index), introLine(m.index), 5.5);
  g.events.push({ type: 'missionstart' });
}

/**
 * Everywhere an odd job may send the player: the five landmarks under
 * their proper names (place names are never translated) plus all shops.
 */
function jobPlaces(g) {
  const L = g.city.landmarks;
  const spots = [
    ['the Pier Warehouse', L.pier],
    ['Club Neon', L.club],
    ['St. Palm Hospital', L.hospital],
    ['the Ammo Hut', L.ammo],
    ["Spray 'n Go", L.spray],
  ].map(([name, spot]) => ({ name, x: spot.x, y: spot.y }));
  for (const s of g.city.shops) spots.push({ name: s.name, x: s.x, y: s.y });
  return spots;
}

/**
 * Start the next odd job. Kinds alternate — delivery, collection,
 * delivery — with a coin flip only for the first one ever. Pay lands
 * through the same JOB DONE banner as story work and feeds the same
 * totals.
 */
export function acceptJob(g) {
  const j = g.job;
  if (!jobAvailable(g)) return;
  j.active = true;
  j.rivals = [];
  if (j.lastType === 'delivery') j.type = 'collection';
  else if (j.lastType === 'collection') j.type = 'delivery';
  else j.type = g.rng.chance(0.5) ? 'delivery' : 'collection';
  if (j.type === 'delivery') {
    const places = jobPlaces(g);
    const a = g.rng.int(0, places.length - 1);
    let b = g.rng.int(0, places.length - 1);
    if (b === a) b = (b + 1) % places.length;
    j.from = places[a];
    j.to = places[b];
    j.phase = 'toPickup';
    j.reward = 5 * g.rng.int(18, 28);
    g.say(t('job.delivery.title'), t('job.delivery.sub', { from: j.from.name, to: j.to.name, reward: `$${j.reward}` }), 5.5);
  } else {
    j.shopIndex = g.rng.int(0, g.city.shops.length - 1);
    const shop = g.city.shops[j.shopIndex];
    j.phase = 'toShop';
    j.reward = 5 * g.rng.int(24, 36);
    j.rivals = postShopGuards(g, shop, j.shopIndex);
    g.say(t('job.collection.title'), t('job.collection.sub', { shop: shop.name, reward: `$${j.reward}` }), 5.5);
  }
  g.events.push({ type: 'missionstart' });
}

/** Close out an odd job: pay, save, and remember the kind for next time. */
function finishJob(g, line) {
  const j = g.job;
  j.active = false;
  j.phase = '';
  j.lastType = j.type;
  markersOff(g);
  g.money += j.reward;
  g.earned += j.reward;
  g.saveData.jobsDone = (g.saveData.jobsDone ?? 0) + 1;
  g.events.push({ type: 'save' });
  g.say(t('say.jobDone.title'), `${line}  +$${j.reward}`, 4.5);
  g.events.push({ type: 'missiondone' });
}

/** The odd job's per-frame work: arrivals, its one fight, its marker. */
function updateJob(g) {
  const j = g.job;
  const p = g.player;
  const close = (x, y, r) => Math.hypot(p.x - x, p.y - y) < r;
  if (j.type === 'delivery') {
    if (j.phase === 'toPickup') {
      goldAt(g, j.from.x, j.from.y);
      if (close(j.from.x, j.from.y, 56)) {
        j.phase = 'toDropoff';
        g.say(t('say.packageSecured.title'), t('say.packageSecured.job', { place: j.to.name }), 3);
        g.events.push({ type: 'pickup' });
      }
    } else if (j.phase === 'toDropoff') {
      goldAt(g, j.to.x, j.to.y);
      if (close(j.to.x, j.to.y, 56)) finishJob(g, t('say.jobDone.delivery'));
    }
    return;
  }
  if (j.type !== 'collection') return;
  const shop = g.city.shops[j.shopIndex];
  if (!shop) return;
  if (j.phase === 'toShop') {
    goldAt(g, shop.x, shop.y);
    if (close(shop.x, shop.y, 52) && p.state === 'foot') {
      j.phase = 'fight';
      rouseWave(j.rivals);
      g.say(t('say.collectors.title'), t('say.collectors.job'), 3);
    }
  } else if (j.phase === 'fight') {
    redAt(g, shop.x, shop.y);
    if (waveOut(g, j.rivals)) {
      sweepFoes(g, j);
      finishJob(g, t('say.jobDone.collection', { shop: shop.name }));
    }
  }
}

/* ------------------------------------------------- what the HUD shows -- */

/**
 * The objective line for the HUD ('' when there is nothing to say).
 * Steps name their place as well as their person: "come back for Shade"
 * on its own left players asking who Shade is and where "back" is.
 */
export function objectiveText(g) {
  const m = g.mission;
  if (!m.active) {
    const j = g.job;
    if (j && j.active) {
      if (j.type === 'delivery') {
        return j.phase === 'toPickup'
          ? t('obj.jobPickup', { place: j.from.name })
          : t('obj.jobDeliver', { place: j.to.name });
      }
      const shop = g.city.shops[j.shopIndex];
      const shopName = shop ? shop.name : 'the shop';
      return j.phase === 'fight'
        ? t('obj.jobFight', { shop: shopName })
        : t('obj.jobCollect', { shop: shopName });
    }
    return m.index >= CHAIN ? t('obj.freeRoam') : t('obj.talkBruno');
  }
  const shop = g.city.shops[m.shopStep];
  const shopName = shop ? shop.name : 'the shop';
  switch (m.phase) {
    case 'toWarehouse': return t('obj.toWarehouse');
    case 'returnDiner': return t('obj.returnDiner');
    case 'toClub': return t('obj.toClub');
    case 'getCar': return t('obj.getCar');
    case 'escape': return t('obj.escape');
    case 'dropoff': return t('obj.dropoff');
    case 'toShop': return t('obj.toShop', { shop: shopName, step: m.shopStep + 1 });
    case 'fight': return t('obj.fight', { shop: shopName });
    case 'toCar': return t('obj.repoGo');
    case 'repoFight': return t('obj.repoFight');
    case 'repoSteal': return t('obj.repoSteal');
    case 'repoDeliver': return t('obj.repoDeliver');
    case 'intercept': return t('obj.courierIntercept');
    case 'escortsFight': return t('obj.courierEscorts');
    case 'grabCase': return t('obj.courierCase');
    case 'returnBruno': return t('obj.returnBruno');
    case 'raidDrive': return t('obj.raidDrive', { secs: Math.max(0, Math.ceil(m.timer)) });
    case 'raidDoor': return t('obj.raidDoor');
    case 'raidFightDoor': return t('obj.raidDoorFight');
    case 'raidFightYard': return t('obj.raidYardFight');
    case 'grabCrate': return t('obj.raidCrate');
    case 'raidEscapeCar': return t('obj.raidEscapeCar');
    case 'loseLaw': return t('obj.escape');
    case 'escapeHeat': return t('obj.escape');
    default: return '';
  }
}

/**
 * The world point the objective stands on. The marker, the minimap blip
 * and the HUD distance all take this single answer, so they can never
 * disagree. Null when the step has no place — an escape's objective is
 * the heat itself.
 */
export function objectiveTarget(g) {
  const m = g.mission;
  const L = g.city.landmarks;
  if (!m.active) {
    const j = g.job;
    if (j && j.active) {
      if (j.type === 'delivery') {
        const spot = j.phase === 'toPickup' ? j.from : j.to;
        return spot ? { x: spot.x, y: spot.y } : null;
      }
      const shop = g.city.shops[j.shopIndex];
      return shop ? { x: shop.x, y: shop.y } : null;
    }
    // Idle at the counter: Bruno himself is the objective, whichever
    // kind of work he would hand out — and nobody is, when neither is
    // on offer.
    if (!missionAvailable(g) && !jobAvailable(g)) return null;
    return g.bruno ? { x: g.bruno.x, y: g.bruno.y } : { x: L.diner.x, y: L.diner.y };
  }
  // The repo steps stand on the car wherever it currently sits; if it
  // is somehow gone, the Ammo Hut behind which it was posted will do.
  if (m.phase === 'toCar' || m.phase === 'repoFight' || m.phase === 'repoSteal') {
    return m.targetCar ? { x: m.targetCar.x, y: m.targetCar.y } : { x: L.ammo.x, y: L.ammo.y };
  }
  switch (m.phase) {
    case 'toWarehouse': return { x: L.pier.x, y: L.pier.y };
    case 'returnDiner': return { x: L.diner.x, y: L.diner.y };
    case 'toClub': return { x: L.club.x, y: L.club.y };
    case 'getCar': return m.shade ? { x: m.shade.x, y: m.shade.y } : { x: L.club.x, y: L.club.y };
    case 'dropoff': return { x: L.pier.x, y: L.pier.y };
    case 'toShop':
    case 'fight': {
      const shop = g.city.shops[m.shopStep];
      return shop ? { x: shop.x, y: shop.y } : null;
    }
    case 'repoDeliver': return { x: L.pier.x, y: L.pier.y };
    case 'intercept':
    case 'escortsFight':
    case 'grabCase':
      return m.courier ? { x: m.courier.x, y: m.courier.y } : null;
    case 'returnBruno': return { x: L.diner.x, y: L.diner.y };
    case 'raidDrive':
    case 'raidDoor':
      return { x: L.pier.x, y: L.pier.y };
    case 'raidFightDoor':
    case 'raidFightYard': {
      const foe = nearestFoeUp(g);
      return foe ? { x: foe.x, y: foe.y } : { x: L.pier.x, y: L.pier.y };
    }
    case 'grabCrate': return cratePoint(g);
    default: return null;
  }
}

/* --------------------------------------------------------------- endings -- */

/** Pay a story job out and advance the chain by one. */
function finishMission(g, reward, line) {
  const m = g.mission;
  m.active = false;
  m.phase = '';
  markersOff(g);
  g.money += reward;
  g.earned += reward;
  if (!g.saveData.missionsDone.includes(m.index)) g.saveData.missionsDone.push(m.index);
  g.events.push({ type: 'save' });
  g.say(t('say.jobDone.title'), `${line}  +$${reward}`, 4.5);
  g.events.push({ type: 'missiondone' });
  m.index += 1;
}

/** Busted or wasted: whatever is running collapses, set pieces included. */
export function failMission(g) {
  const m = g.mission;
  if (m.active) {
    m.active = false;
    m.phase = '';
    markersOff(g);
    if (m.shade) {
      removePed(g, m.shade);
      m.shade = null;
    }
    if (g.passenger) g.passenger = null;
    sweepFoes(g, m);
    for (const ped of m.yardMen) removePed(g, ped);
    m.yardMen = [];
    if (m.courier) {
      removeCar(g, m.courier);
      m.courier = null;
    }
    if (m.targetCar) {
      // Take the car back only while it is still the debtor's — once
      // the player has taken it, it is his and stays in the world.
      if (!m.targetCar.touched) removeCar(g, m.targetCar);
      m.targetCar = null;
    }
    m.timer = 0;
    m.timeBonus = false;
    g.say(t('say.jobFailed.title'), t('say.jobFailed.mission'), 3.5);
  }
  const j = g.job;
  if (j && j.active) {
    j.active = false;
    j.phase = '';
    markersOff(g);
    sweepFoes(g, j);
    g.say(t('say.jobFailed.title'), t('say.jobFailed.job'), 3.5);
  }
}

/** Shade got into the player's car (an event raised by people.js). */
export function onBoarded(g) {
  const m = g.mission;
  if (!m.active || m.index !== 1 || m.phase !== 'getCar') return;
  m.phase = 'escape';
  forceStars(g, 3);
  g.say(t('say.shadeIn.title'), t('say.shadeIn.sub'), 4);
}

/* ------------------------------------------------------------- grabbing -- */

// The two steps settled with the E key: the courier's case and the
// raid's crate. Both spots move with their owner — the case with the
// stopped courier, the crate fixed at its pier point.
function grabPoint(g) {
  const m = g.mission;
  if (!m.active) return null;
  if (m.index === 4 && m.phase === 'grabCase' && m.courier) {
    return { x: m.courier.x, y: m.courier.y, key: 'prompt.grabCase' };
  }
  if (m.index === 5 && m.phase === 'grabCrate') {
    const spot = cratePoint(g);
    return { x: spot.x, y: spot.y, key: 'prompt.grabCrate' };
  }
  return null;
}

/** The E prompt for a grab step, or '' when the player is not on it. */
export function missionPrompt(g) {
  const spot = grabPoint(g);
  if (!spot || g.player.state !== 'foot') return '';
  return Math.hypot(g.player.x - spot.x, g.player.y - spot.y) < 54 ? t(spot.key) : '';
}

/** Take the grab (E pressed). True when the press belonged to a grab. */
export function missionInteract(g) {
  if (!missionPrompt(g)) return false;
  const m = g.mission;
  if (m.index === 4 && m.phase === 'grabCase') {
    m.phase = 'escapeHeat';
    forceStars(g, 3);
    g.say(t('say.caseSecured.title'), t('say.caseSecured.sub'), 4);
    g.events.push({ type: 'pickup' });
  } else if (m.index === 5 && m.phase === 'grabCrate') {
    m.phase = 'raidEscapeCar';
    forceStars(g, 3);
    g.say(t('say.crateSecured.title'), t('say.crateSecured.sub'), 4);
    g.events.push({ type: 'pickup' });
  }
  return true;
}

/* --------------------------------------------------------- phase runners --
 * One runner per story job, picked by chain index. Each places its own
 * markers for the frame and turns its phase on arrivals and fights. */

/**
 * The shared shape of every "lose the law" step: markers away, and the
 * phase turns only once the stars are gone.
 */
function lawGone(g, nextPhase, subKey) {
  const m = g.mission;
  markersOff(g);
  if (g.stars === 0) {
    m.phase = nextPhase;
    g.say(t('say.clean.title'), t(subKey), 3.5);
  }
}

function runPackage(g, close) {
  const m = g.mission;
  const L = g.city.landmarks;
  if (m.phase === 'toWarehouse') {
    goldAt(g, L.pier.x, L.pier.y);
    if (close(L.pier.x, L.pier.y, 56)) {
      m.phase = 'returnDiner';
      g.say(t('say.packageSecured.title'), t('say.packageSecured.mission'), 3);
      g.events.push({ type: 'pickup' });
    }
  } else if (m.phase === 'returnDiner') {
    goldAt(g, L.diner.x, L.diner.y);
    if (close(L.diner.x, L.diner.y, 56)) finishMission(g, 150, t('say.jobDone.mission0'));
  }
}

function runShade(g, close) {
  const m = g.mission;
  const p = g.player;
  const L = g.city.landmarks;
  if (m.phase === 'toClub') {
    goldAt(g, L.club.x, L.club.y);
    if (close(L.club.x, L.club.y, 52) && p.state === 'foot') {
      m.phase = 'getCar';
      g.say('SHADE', t('say.shade.sub'), 4.5);
    }
  } else if (m.phase === 'getCar') {
    // Shade himself is this step's destination, so the marker rides on
    // him; the club door is the fallback if he is somehow gone.
    if (m.shade) goldAt(g, m.shade.x, m.shade.y);
    else goldAt(g, L.club.x, L.club.y);
    if (m.shade && p.state === 'car' && p.car) {
      const gap = Math.hypot(m.shade.x - p.car.x, m.shade.y - p.car.y);
      if (gap < 175 && m.shade.state !== 'board') m.shade.state = 'board';
    }
  } else if (m.phase === 'escape') {
    lawGone(g, 'dropoff', 'say.clean.sub');
  } else if (m.phase === 'dropoff') {
    goldAt(g, L.pier.x, L.pier.y);
    if (close(L.pier.x, L.pier.y, 60) && g.passenger) {
      removePed(g, g.passenger);
      g.passenger = null;
      m.shade = null;
      if (!g.player.hasPistol) {
        g.player.hasPistol = true;
        g.events.push({ type: 'pistol' });
      }
      finishMission(g, 300, t('say.jobDone.mission1'));
    }
  }
}

function runCollections(g, close) {
  const m = g.mission;
  const p = g.player;
  const shop = g.city.shops[m.shopStep];
  if (m.phase === 'toShop') {
    goldAt(g, shop.x, shop.y);
    if (close(shop.x, shop.y, 52) && p.state === 'foot') {
      m.phase = 'fight';
      rouseWave(m.rivals);
      g.say(t('say.collectors.title'), t('say.collectors.mission'), 3);
    }
  } else if (m.phase === 'fight') {
    redAt(g, shop.x, shop.y);
    if (waveOut(g, m.rivals)) {
      sweepFoes(g, m);
      // Each shop pays its own cash on the spot; the mission's reward
      // proper lands only when the last shop has paid up.
      g.money += 120;
      g.earned += 120;
      g.events.push({ type: 'cash', amount: 120 });
      m.shopStep += 1;
      if (m.shopStep >= g.city.shops.length) {
        finishMission(g, 250, t('say.jobDone.mission2'));
      } else {
        m.phase = 'toShop';
        m.rivals = postShopGuards(g, g.city.shops[m.shopStep], m.shopStep);
        g.say(t('say.paidUp.title'), t('say.paidUp.sub'), 2.6);
      }
    }
  }
}

function runRepo(g, close) {
  const m = g.mission;
  const p = g.player;
  const L = g.city.landmarks;
  const car = m.targetCar;
  if (m.phase === 'toCar') {
    carMark(g, car, true);
    if (car && close(car.x, car.y, 60) && p.state === 'foot') {
      m.phase = 'repoFight';
      rouseWave(m.rivals);
      g.say(t('say.repoGuards.title'), t('say.repoGuards.sub'), 3);
    }
  } else if (m.phase === 'repoFight') {
    carMark(g, car, false);
    if (waveOut(g, m.rivals)) {
      sweepFoes(g, m);
      m.phase = 'repoSteal';
      g.say(t('say.repoClear.title'), t('say.repoClear.sub'), 3);
    }
  } else if (m.phase === 'repoSteal') {
    carMark(g, car, true);
    if (car && p.state === 'car' && p.car === car) {
      m.phase = 'repoDeliver';
      // This particular car is hot the moment it rolls.
      forceStars(g, 2);
      g.say(t('say.repoHot.title'), t('say.repoHot.sub'), 4);
    }
  } else if (m.phase === 'repoDeliver') {
    goldAt(g, L.pier.x, L.pier.y);
    if (car && p.state === 'car' && p.car === car && close(L.pier.x, L.pier.y, 62)) {
      m.targetCar = null; // handed over: from here it is just a car
      finishMission(g, 220, t('say.jobDone.mission3'));
    }
  }
}

function runCourier(g, close, dt) {
  const m = g.mission;
  const L = g.city.landmarks;
  const car = m.courier;
  if (m.phase === 'intercept') {
    if (car) {
      driveCourier(g, car, dt);
      goldAt(g, car.x, car.y);
    } else {
      g.markerRed.visible = false;
    }
    const held = car && (car.stillT ?? 0) > 2.2 && close(car.x, car.y, 320);
    if (car && (car.wrecked || held)) {
      // Stopped one way or another, the crew bails out swinging.
      car.speed = 0;
      m.rivals = [
        spawnPed(g, { role: 'rival', x: car.x + 32, y: car.y + 20, ...MUSCLE }),
        spawnPed(g, { role: 'rival', x: car.x - 32, y: car.y - 20, ...MUSCLE }),
      ];
      for (const man of m.rivals) man.state = 'fight';
      m.phase = 'escortsFight';
      g.say(t('say.escorts.title'), t('say.escorts.sub'), 3.5);
    }
  } else if (m.phase === 'escortsFight') {
    carMark(g, car, false);
    if (waveOut(g, m.rivals)) {
      sweepFoes(g, m);
      m.phase = 'grabCase';
      g.say(t('say.escortsDown.title'), t('say.escortsDown.sub'), 3);
    }
  } else if (m.phase === 'grabCase') {
    carMark(g, car, true);
  } else if (m.phase === 'escapeHeat') {
    lawGone(g, 'returnBruno', 'say.clean.sub2');
  } else if (m.phase === 'returnBruno') {
    goldAt(g, L.diner.x, L.diner.y);
    if (close(L.diner.x, L.diner.y, 56)) finishMission(g, 300, t('say.jobDone.mission4'));
  }
}

function runRaid(g, close, dt) {
  const m = g.mission;
  const p = g.player;
  const L = g.city.landmarks;
  if (m.phase === 'raidDrive') {
    goldAt(g, L.pier.x, L.pier.y);
    if (m.timeBonus) {
      m.timer -= dt;
      if (m.timer <= 0) {
        m.timer = 0;
        m.timeBonus = false;
        g.say(t('say.timeBonusLost.title'), t('say.timeBonusLost.sub'), 3);
      }
    }
    if (close(L.pier.x, L.pier.y, 72)) m.phase = 'raidDoor';
  } else if (m.phase === 'raidDoor') {
    goldAt(g, L.pier.x, L.pier.y);
    if (close(L.pier.x, L.pier.y, 56) && p.state === 'foot') {
      m.phase = 'raidFightDoor';
      rouseWave(m.rivals);
      g.say(t('say.raidGuards.title'), t('say.raidGuards.sub'), 3);
    }
  } else if (m.phase === 'raidFightDoor' || m.phase === 'raidFightYard') {
    const foe = nearestFoeUp(g);
    redAt(g, foe ? foe.x : L.pier.x, foe ? foe.y : L.pier.y);
    if (!waveOut(g, m.rivals)) return;
    sweepFoes(g, m);
    if (m.phase === 'raidFightDoor') {
      // The yard crew takes over the fight. The rouse stays guarded by
      // state: a man beaten while he waited — even swept by the
      // down-timer — must not flip back to 'fight' as a ghost the
      // beaten-count could never satisfy.
      m.rivals = m.yardMen;
      m.yardMen = [];
      rouseWave(m.rivals);
      m.phase = 'raidFightYard';
      g.say(t('say.yard.title'), t('say.yard.sub'), 3);
    } else {
      m.phase = 'grabCrate';
      g.say(t('say.yardDown.title'), t('say.yardDown.sub'), 3);
    }
  } else if (m.phase === 'grabCrate') {
    const spot = cratePoint(g);
    goldAt(g, spot.x, spot.y);
  } else if (m.phase === 'raidEscapeCar') {
    markersOff(g);
    if (p.state === 'car') m.phase = 'loseLaw';
  } else if (m.phase === 'loseLaw') {
    lawGone(g, 'returnBruno', 'say.clean.sub2');
  } else if (m.phase === 'returnBruno') {
    goldAt(g, L.diner.x, L.diner.y);
    if (close(L.diner.x, L.diner.y, 56)) {
      const reward = 450 + (m.timeBonus ? RAID_TIME_BONUS : 0);
      finishMission(g, reward, t('say.jobDone.mission5'));
      // The end of the chain earns its own word over the JOB DONE banner.
      g.say(t('say.storyComplete.title'), t('say.storyComplete.sub', { reward: `$${reward}` }), 6.5);
    }
  }
}

const RUNNERS = [runPackage, runShade, runCollections, runRepo, runCourier, runRaid];

/** Arrivals, fight checks and marker placement, once per frame. */
export function updateMissions(g, dt, time) {
  const m = g.mission;
  g.markerGold.userData.update(time);
  g.markerRed.userData.update(time);
  watchDinerMarker(g, time);
  if (!m.active) {
    if (g.job.active) {
      updateJob(g);
      return;
    }
    // Nothing running: the gold marker stands on Bruno, so the next
    // piece of work — story or odd job — is always findable.
    if ((missionAvailable(g) || jobAvailable(g)) && g.bruno) {
      goldAt(g, g.bruno.x, g.bruno.y);
    } else {
      markersOff(g);
    }
    return;
  }
  const p = g.player;
  const close = (x, y, r) => Math.hypot(p.x - x, p.y - y) < r;
  const run = RUNNERS[m.index];
  if (run) run(g, close, dt);
}
