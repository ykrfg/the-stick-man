// missions.js — Bruno's work: the six-job story chain and, once it is
// finished, his repeatable odd jobs. Bruno runs the diner on the north
// side and half the errands in Palmera; every job starts at his counter,
// drives a gold marker (red while a fight is owed), pays through the JOB
// DONE banner and unlocks the next. The back half of the chain mixes the
// toolbox: fists around a marked car, a moving courier stopped by crash
// damage, and a timed warehouse raid with two waves. Being busted or
// wasted collapses whatever is running and sends the player back to
// Bruno to try again.
import { HEAT_THRESHOLDS, RAID_TIME_BONUS, RAID_TIMER } from './config.js';
import { makeMarker } from './world3d.js';
import { removePed, spawnPed } from './people.js';
import { driveCourier, removeCar, spawnCar, spawnCourierCar } from './vehicles.js';
import { addHeat } from './police.js';
import { t } from './i18n.js';

const STORY_LENGTH = 6;

export function missionTitle(index) {
  return t(`mission.${index}.title`);
}

function missionIntro(index) {
  return t(`mission.${index}.intro`);
}

/** Fresh mission/job state plus the three markers (objective gold, objective red, diner). */
export function missionsInit(g) {
  const done = (g.saveData.missionsDone ?? []).length;
  g.mission = {
    index: Math.min(STORY_LENGTH, done),
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
  g.job = {
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
  g.markerGold = makeMarker(0xffcf3f, '!');
  g.markerRed = makeMarker(0xff5a4d, '!');
  g.markerGold.visible = false;
  g.markerRed.visible = false;
  g.scene.add(g.markerGold, g.markerRed);
  // The diner keeps its own permanent marker — shorter, orange, tagged
  // DINER — so home base stays findable mid-mission. syncDinerMarker
  // owns when it shows.
  const diner = g.city.landmarks.diner;
  g.markerDiner = makeMarker(0xff9f43, t('marker.diner'), { height: 58, spriteColor: '#ffb25e', spriteScale: 0.95 });
  g.markerDiner.position.set(diner.x, 0, diner.y);
  g.markerDiner.visible = false;
  g.scene.add(g.markerDiner);
}

export function missionAvailable(g) {
  return !g.mission.active && g.mission.index < STORY_LENGTH;
}

export function jobAvailable(g) {
  return !g.mission.active && !g.job.active && g.mission.index >= STORY_LENGTH;
}

// --- marker plumbing -------------------------------------------------------

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
 * The diner marker shows whenever play is live and the objective is
 * somewhere else; when the objective IS Bruno's doorstep the gold
 * marker already says so, and in ?shot= scenes it never appears.
 */
function syncDinerMarker(g, time) {
  const d = g.markerDiner;
  if (!d) return;
  d.userData.update(time);
  if (g.shotMode) { d.visible = false; return; }
  const diner = g.city.landmarks.diner;
  const target = objectiveTarget(g);
  d.visible = !(target && Math.hypot(target.x - diner.x, target.y - diner.y) < 90);
}

// --- posting men (always at accept/advance time, never on arrival) --------

function postPair(g, shop, shopIndex) {
  const men = [
    spawnPed(g, { role: 'rival', x: shop.x + 30, y: shop.y - 16, shopIndex }),
    spawnPed(g, { role: 'rival', x: shop.x - 26, y: shop.y + 22, shopIndex }),
  ];
  for (const man of men) man.state = 'idle';
  return men;
}

/** REPO JOB: the debtor's gold car on the curb behind the Ammo Hut, guards beside it. */
function postRepoJob(g) {
  const m = g.mission;
  let y = 2300;
  for (let tries = 0; tries < 4; tries += 1) {
    if (!g.cars.some((c) => Math.hypot(c.x - 761, c.y - y) < 70)) break;
    y += 110;
  }
  const car = spawnCar(g, 'parked', 761, y, Math.PI / 2, 0xffd166);
  car.hp = 260;
  m.targetCar = car;
  m.rivals = [
    spawnPed(g, { role: 'rival', x: 726, y: y - 30 }),
    spawnPed(g, { role: 'rival', x: 726, y: y + 32 }),
  ];
  for (const rival of m.rivals) rival.state = 'idle';
}

/** WAREHOUSE RAID: door guards on the south face, the yard crew waiting behind them. */
function postRaid(g) {
  const m = g.mission;
  const pier = g.city.landmarks.pier;
  m.rivals = [
    spawnPed(g, { role: 'rival', x: pier.x - 40, y: pier.y - 28 }),
    spawnPed(g, { role: 'rival', x: pier.x + 42, y: pier.y - 28 }),
  ];
  m.yardMen = [
    spawnPed(g, { role: 'rival', x: pier.x - 92, y: pier.y + 22, hp: 150, chase: 208, punchRate: 0.7, armed: true }),
    spawnPed(g, { role: 'rival', x: pier.x, y: pier.y + 38, hp: 150, chase: 208, punchRate: 0.7, armed: true }),
    spawnPed(g, { role: 'rival', x: pier.x + 92, y: pier.y + 22, hp: 150, chase: 208, punchRate: 0.7, armed: true }),
  ];
  for (const ped of [...m.rivals, ...m.yardMen]) ped.state = 'idle';
}

function crateSpot(g) {
  const pier = g.city.landmarks.pier;
  return { x: pier.x, y: pier.y - 35 };
}

// --- fight bookkeeping ------------------------------------------------------

/**
 * Beaten means down for good (hp <= 0) or already swept from the world.
 * A plain 'down' state is NOT beaten: a car knockdown puts a fighter
 * down with hp to spare and he gets back up, and counting the state
 * once let a single drive through a wave "win" the fight and vanish
 * living men in the cleanup.
 */
function rivalBeaten(g, r) {
  return r.hp <= 0 || !g.peds.includes(r);
}

function allBeaten(g, rivals) {
  return rivals.every((r) => rivalBeaten(g, r));
}

/** Wake only the men still idling — a man already down stays down. */
function wakeRivals(rivals) {
  for (const r of rivals) if (r.state === 'idle') r.state = 'fight';
}

function clearRivals(g, holder) {
  for (const r of holder.rivals) removePed(g, r);
  holder.rivals = [];
}

/** The nearest rival still standing — where a fight objective actually is. */
function nearestStandingRival(g) {
  let best = null;
  let bestD = Infinity;
  for (const r of g.mission.rivals) {
    if (rivalBeaten(g, r)) continue;
    const d = Math.hypot(r.x - g.player.x, r.y - g.player.y);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best;
}

/** Force the heat up to a scripted star count (the law "notices" the job). */
function scriptedHeat(g, stars) {
  const need = HEAT_THRESHOLDS[stars - 1] + 5 - g.heat;
  if (need > 0) addHeat(g, need, g.player.x, g.player.y, { force: true });
}

// --- taking work -------------------------------------------------------------

/** Start the current story mission (the player talked to Bruno). */
export function acceptMission(g) {
  const m = g.mission;
  if (!missionAvailable(g)) return;
  m.active = true;
  m.shopStep = 0;
  m.rivals = [];
  const L = g.city.landmarks;
  switch (m.index) {
    case 0:
      m.phase = 'toWarehouse';
      break;
    case 1:
      m.phase = 'toClub';
      // Shade waits at the club door from this moment on — arriving
      // reveals a man who was already there, never a spawn-in.
      m.shade = spawnPed(g, { role: 'shade', x: L.club.x + 24, y: L.club.y + 10, name: 'SHADE' });
      m.shade.fig.setExpression('angry');
      m.shade.state = 'idle';
      m.shade.homeX = m.shade.x;
      m.shade.homeY = m.shade.y;
      break;
    case 2:
      m.phase = 'toShop';
      m.rivals = postPair(g, g.city.shops[0], 0);
      break;
    case 3:
      m.phase = 'toCar';
      postRepoJob(g);
      break;
    case 4:
      m.phase = 'intercept';
      m.courier = spawnCourierCar(g);
      break;
    default:
      m.phase = 'raidDrive';
      m.timer = RAID_TIMER;
      m.timeBonus = true;
      postRaid(g);
      break;
  }
  g.say(missionTitle(m.index), missionIntro(m.index), 5.5);
  g.events.push({ type: 'missionstart' });
}

// Bruno's odd jobs: the free-roam earning loop, unlocked only once the
// story is done so the two kinds of work never compete at his counter.
// Deliveries and collections alternate (coin flip for the first), each
// pays through the same JOB DONE banner and counts into the same totals.

function jobPlaces(g) {
  const L = g.city.landmarks;
  const named = [
    ['the Pier Warehouse', L.pier],
    ['Club Neon', L.club],
    ['St. Palm Hospital', L.hospital],
    ['the Ammo Hut', L.ammo],
    ["Spray 'n Go", L.spray],
  ].map(([name, spot]) => ({ name, x: spot.x, y: spot.y }));
  return named.concat(g.city.shops.map((s) => ({ name: s.name, x: s.x, y: s.y })));
}

/** Start the next odd job (the player talked to Bruno in free roam). */
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
    j.rivals = postPair(g, shop, j.shopIndex);
    g.say(t('job.collection.title'), t('job.collection.sub', { shop: shop.name, reward: `$${j.reward}` }), 5.5);
  }
  g.events.push({ type: 'missionstart' });
}

function completeJob(g, line) {
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

/** The odd job's per-frame work: arrivals, the fight check, the markers. */
function updateJob(g) {
  const j = g.job;
  const p = g.player;
  const near = (x, y, r) => Math.hypot(p.x - x, p.y - y) < r;
  if (j.type === 'delivery') {
    if (j.phase === 'toPickup') {
      goldAt(g, j.from.x, j.from.y);
      if (near(j.from.x, j.from.y, 56)) {
        j.phase = 'toDropoff';
        g.say(t('say.packageSecured.title'), t('say.packageSecured.job', { place: j.to.name }), 3);
        g.events.push({ type: 'pickup' });
      }
    } else if (j.phase === 'toDropoff') {
      goldAt(g, j.to.x, j.to.y);
      if (near(j.to.x, j.to.y, 56)) completeJob(g, t('say.jobDone.delivery'));
    }
    return;
  }
  if (j.type !== 'collection') return;
  const shop = g.city.shops[j.shopIndex];
  if (!shop) return;
  if (j.phase === 'toShop') {
    goldAt(g, shop.x, shop.y);
    if (near(shop.x, shop.y, 52) && p.state === 'foot') {
      j.phase = 'fight';
      wakeRivals(j.rivals);
      g.say(t('say.collectors.title'), t('say.collectors.job'), 3);
    }
  } else if (j.phase === 'fight') {
    redAt(g, shop.x, shop.y);
    if (allBeaten(g, j.rivals)) {
      clearRivals(g, j);
      completeJob(g, t('say.jobDone.collection', { shop: shop.name }));
    }
  }
}

// --- what the HUD points at --------------------------------------------------

/**
 * The current objective line ('' when nothing is running). Every step
 * names its PLACE as well as its person — "come back for Shade" alone
 * left players asking who Shade is and where "back" is.
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
    return m.index >= STORY_LENGTH ? t('obj.freeRoam') : t('obj.talkBruno');
  }
  const shop = g.city.shops[m.shopStep];
  const shopName = shop ? shop.name : 'the shop';
  const lines = {
    toWarehouse: () => t('obj.toWarehouse'),
    returnDiner: () => t('obj.returnDiner'),
    toClub: () => t('obj.toClub'),
    getCar: () => t('obj.getCar'),
    escape: () => t('obj.escape'),
    dropoff: () => t('obj.dropoff'),
    toShop: () => t('obj.toShop', { shop: shopName, step: m.shopStep + 1 }),
    fight: () => t('obj.fight', { shop: shopName }),
    toCar: () => t('obj.repoGo'),
    repoFight: () => t('obj.repoFight'),
    repoSteal: () => t('obj.repoSteal'),
    repoDeliver: () => t('obj.repoDeliver'),
    intercept: () => t('obj.courierIntercept'),
    escortsFight: () => t('obj.courierEscorts'),
    grabCase: () => t('obj.courierCase'),
    returnBruno: () => t('obj.returnBruno'),
    raidDrive: () => t('obj.raidDrive', { secs: Math.max(0, Math.ceil(m.timer)) }),
    raidDoor: () => t('obj.raidDoor'),
    raidFightDoor: () => t('obj.raidDoorFight'),
    raidFightYard: () => t('obj.raidYardFight'),
    grabCrate: () => t('obj.raidCrate'),
    raidEscapeCar: () => t('obj.raidEscapeCar'),
    loseLaw: () => t('obj.escape'),
    escapeHeat: () => t('obj.escape'),
  };
  const line = lines[m.phase];
  return line ? line() : '';
}

function point(x, y) {
  return { x, y };
}

/**
 * The world point the objective stands on — marker, minimap blip and
 * HUD distance all read this, so they agree by construction. Null when
 * the step has no place (an escape: the target is the heat itself).
 */
export function objectiveTarget(g) {
  const m = g.mission;
  const L = g.city.landmarks;
  if (!m.active) {
    const j = g.job;
    if (j && j.active) {
      if (j.type === 'delivery') {
        const spot = j.phase === 'toPickup' ? j.from : j.to;
        return spot ? point(spot.x, spot.y) : null;
      }
      const shop = g.city.shops[j.shopIndex];
      return shop ? point(shop.x, shop.y) : null;
    }
    // Waiting for work, Bruno himself is the objective — story jobs
    // before the story ends, odd jobs after it.
    if (!missionAvailable(g) && !jobAvailable(g)) return null;
    return g.bruno ? point(g.bruno.x, g.bruno.y) : point(L.diner.x, L.diner.y);
  }
  const carPhases = ['toCar', 'repoFight', 'repoSteal'];
  if (carPhases.includes(m.phase)) {
    return m.targetCar ? point(m.targetCar.x, m.targetCar.y) : point(L.ammo.x, L.ammo.y);
  }
  switch (m.phase) {
    case 'toWarehouse': return point(L.pier.x, L.pier.y);
    case 'returnDiner': return point(L.diner.x, L.diner.y);
    case 'toClub': return point(L.club.x, L.club.y);
    case 'getCar': return m.shade ? point(m.shade.x, m.shade.y) : point(L.club.x, L.club.y);
    case 'dropoff': return point(L.pier.x, L.pier.y);
    case 'toShop':
    case 'fight': {
      const shop = g.city.shops[m.shopStep];
      return shop ? point(shop.x, shop.y) : null;
    }
    case 'repoDeliver': return point(L.pier.x, L.pier.y);
    case 'intercept':
    case 'escortsFight':
    case 'grabCase':
      return m.courier ? point(m.courier.x, m.courier.y) : null;
    case 'returnBruno': return point(L.diner.x, L.diner.y);
    case 'raidDrive':
    case 'raidDoor':
      return point(L.pier.x, L.pier.y);
    case 'raidFightDoor':
    case 'raidFightYard': {
      const r = nearestStandingRival(g);
      return r ? point(r.x, r.y) : point(L.pier.x, L.pier.y);
    }
    case 'grabCrate': return crateSpot(g);
    default: return null;
  }
}

// --- endings -------------------------------------------------------------------

function completeMission(g, reward, line) {
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

/** Busted or wasted collapses whatever is running, set pieces included. */
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
    clearRivals(g, m);
    for (const ped of m.yardMen) removePed(g, ped);
    m.yardMen = [];
    if (m.courier) {
      removeCar(g, m.courier);
      m.courier = null;
    }
    if (m.targetCar) {
      // Only while it is still the debtor's — once taken, it is the
      // player's car and stays in the world like any other.
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
    clearRivals(g, j);
    g.say(t('say.jobFailed.title'), t('say.jobFailed.job'), 3.5);
  }
}

/** Shade climbed into the player's car (event from people.js). */
export function onBoarded(g) {
  const m = g.mission;
  if (!m.active || m.index !== 1 || m.phase !== 'getCar') return;
  m.phase = 'escape';
  const need = HEAT_THRESHOLDS[2] + 5 - g.heat;
  if (need > 0) addHeat(g, need, g.player.x, g.player.y, { force: true });
  g.say(t('say.shadeIn.title'), t('say.shadeIn.sub'), 4);
}

// --- the grab steps (the courier's case, the raid's crate) ---------------------

function grabSpot(g) {
  const m = g.mission;
  if (!m.active) return null;
  if (m.index === 4 && m.phase === 'grabCase' && m.courier) {
    return { x: m.courier.x, y: m.courier.y, key: 'prompt.grabCase' };
  }
  if (m.index === 5 && m.phase === 'grabCrate') {
    const spot = crateSpot(g);
    return { x: spot.x, y: spot.y, key: 'prompt.grabCrate' };
  }
  return null;
}

/** The E prompt for the current grab step, or '' when there is none here. */
export function missionPrompt(g) {
  const spot = grabSpot(g);
  if (!spot || g.player.state !== 'foot') return '';
  return Math.hypot(g.player.x - spot.x, g.player.y - spot.y) < 54 ? t(spot.key) : '';
}

/** Run the grab (E pressed at the spot). True when it consumed the press. */
export function missionInteract(g) {
  if (!missionPrompt(g)) return false;
  const m = g.mission;
  if (m.index === 4 && m.phase === 'grabCase') {
    m.phase = 'escapeHeat';
    scriptedHeat(g, 3);
    g.say(t('say.caseSecured.title'), t('say.caseSecured.sub'), 4);
    g.events.push({ type: 'pickup' });
  } else if (m.index === 5 && m.phase === 'grabCrate') {
    m.phase = 'raidEscapeCar';
    scriptedHeat(g, 3);
    g.say(t('say.crateSecured.title'), t('say.crateSecured.sub'), 4);
    g.events.push({ type: 'pickup' });
  }
  return true;
}

// --- per-frame phase machines --------------------------------------------------

function stepPackage(g, near) {
  const m = g.mission;
  const L = g.city.landmarks;
  if (m.phase === 'toWarehouse') {
    goldAt(g, L.pier.x, L.pier.y);
    if (near(L.pier.x, L.pier.y, 56)) {
      m.phase = 'returnDiner';
      g.say(t('say.packageSecured.title'), t('say.packageSecured.mission'), 3);
      g.events.push({ type: 'pickup' });
    }
  } else if (m.phase === 'returnDiner') {
    goldAt(g, L.diner.x, L.diner.y);
    if (near(L.diner.x, L.diner.y, 56)) completeMission(g, 150, t('say.jobDone.mission0'));
  }
}

function stepShade(g, near) {
  const m = g.mission;
  const p = g.player;
  const L = g.city.landmarks;
  if (m.phase === 'toClub') {
    goldAt(g, L.club.x, L.club.y);
    if (near(L.club.x, L.club.y, 52) && p.state === 'foot') {
      m.phase = 'getCar';
      g.say('SHADE', t('say.shade.sub'), 4.5);
    }
  } else if (m.phase === 'getCar') {
    // The marker stands on Shade himself: he IS this step's destination.
    if (m.shade) goldAt(g, m.shade.x, m.shade.y);
    else goldAt(g, L.club.x, L.club.y);
    if (m.shade && p.state === 'car' && p.car) {
      const d = Math.hypot(m.shade.x - p.car.x, m.shade.y - p.car.y);
      if (d < 175 && m.shade.state !== 'board') m.shade.state = 'board';
    }
  } else if (m.phase === 'escape') {
    markersOff(g);
    if (g.stars === 0) {
      m.phase = 'dropoff';
      g.say(t('say.clean.title'), t('say.clean.sub'), 3.5);
    }
  } else if (m.phase === 'dropoff') {
    goldAt(g, L.pier.x, L.pier.y);
    if (near(L.pier.x, L.pier.y, 60) && g.passenger) {
      removePed(g, g.passenger);
      g.passenger = null;
      m.shade = null;
      if (!g.player.hasPistol) {
        g.player.hasPistol = true;
        g.events.push({ type: 'pistol' });
      }
      completeMission(g, 300, t('say.jobDone.mission1'));
    }
  }
}

function stepCollections(g, near) {
  const m = g.mission;
  const p = g.player;
  const shop = g.city.shops[m.shopStep];
  if (m.phase === 'toShop') {
    goldAt(g, shop.x, shop.y);
    if (near(shop.x, shop.y, 52) && p.state === 'foot') {
      m.phase = 'fight';
      wakeRivals(m.rivals);
      g.say(t('say.collectors.title'), t('say.collectors.mission'), 3);
    }
  } else if (m.phase === 'fight') {
    redAt(g, shop.x, shop.y);
    if (allBeaten(g, m.rivals)) {
      clearRivals(g, m);
      g.money += 120;
      g.earned += 120;
      g.events.push({ type: 'cash', amount: 120 });
      m.shopStep += 1;
      if (m.shopStep >= g.city.shops.length) {
        completeMission(g, 250, t('say.jobDone.mission2'));
      } else {
        m.phase = 'toShop';
        m.rivals = postPair(g, g.city.shops[m.shopStep], m.shopStep);
        g.say(t('say.paidUp.title'), t('say.paidUp.sub'), 2.6);
      }
    }
  }
}

function stepRepo(g, near) {
  const m = g.mission;
  const p = g.player;
  const L = g.city.landmarks;
  const car = m.targetCar;
  if (m.phase === 'toCar') {
    if (car) goldAt(g, car.x, car.y);
    else g.markerRed.visible = false;
    if (car && near(car.x, car.y, 60) && p.state === 'foot') {
      m.phase = 'repoFight';
      wakeRivals(m.rivals);
      g.say(t('say.repoGuards.title'), t('say.repoGuards.sub'), 3);
    }
  } else if (m.phase === 'repoFight') {
    if (car) redAt(g, car.x, car.y);
    else g.markerGold.visible = false;
    if (allBeaten(g, m.rivals)) {
      clearRivals(g, m);
      m.phase = 'repoSteal';
      g.say(t('say.repoClear.title'), t('say.repoClear.sub'), 3);
    }
  } else if (m.phase === 'repoSteal') {
    if (car) goldAt(g, car.x, car.y);
    else g.markerRed.visible = false;
    if (car && p.state === 'car' && p.car === car) {
      m.phase = 'repoDeliver';
      // The whole PD hears about this particular car the moment it rolls.
      scriptedHeat(g, 2);
      g.say(t('say.repoHot.title'), t('say.repoHot.sub'), 4);
    }
  } else if (m.phase === 'repoDeliver') {
    goldAt(g, L.pier.x, L.pier.y);
    if (car && p.state === 'car' && p.car === car && near(L.pier.x, L.pier.y, 62)) {
      m.targetCar = null; // delivered: from here it is just a car in the world
      completeMission(g, 220, t('say.jobDone.mission3'));
    }
  }
}

function stepCourier(g, near, dt) {
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
    const pinned = car && (car.stillT ?? 0) > 2.2 && near(car.x, car.y, 320);
    if (car && (car.wrecked || pinned)) {
      // The crew bails out swinging — Bruno-grade troublemakers with
      // more health and faster feet than the shop collectors. Their
      // pistols are for show: Palmera's combat only lets the player
      // shoot, so they fight as elite fist fighters.
      car.speed = 0;
      m.rivals = [
        spawnPed(g, { role: 'rival', x: car.x + 32, y: car.y + 20, hp: 150, chase: 208, punchRate: 0.7, armed: true }),
        spawnPed(g, { role: 'rival', x: car.x - 32, y: car.y - 20, hp: 150, chase: 208, punchRate: 0.7, armed: true }),
      ];
      for (const rival of m.rivals) rival.state = 'fight';
      m.phase = 'escortsFight';
      g.say(t('say.escorts.title'), t('say.escorts.sub'), 3.5);
    }
  } else if (m.phase === 'escortsFight') {
    if (car) redAt(g, car.x, car.y);
    else g.markerGold.visible = false;
    if (allBeaten(g, m.rivals)) {
      clearRivals(g, m);
      m.phase = 'grabCase';
      g.say(t('say.escortsDown.title'), t('say.escortsDown.sub'), 3);
    }
  } else if (m.phase === 'grabCase') {
    if (car) goldAt(g, car.x, car.y);
    else g.markerRed.visible = false;
  } else if (m.phase === 'escapeHeat') {
    markersOff(g);
    if (g.stars === 0) {
      m.phase = 'returnBruno';
      g.say(t('say.clean.title'), t('say.clean.sub2'), 3.5);
    }
  } else if (m.phase === 'returnBruno') {
    goldAt(g, L.diner.x, L.diner.y);
    if (near(L.diner.x, L.diner.y, 56)) completeMission(g, 300, t('say.jobDone.mission4'));
  }
}

function stepRaid(g, near, dt) {
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
    if (near(L.pier.x, L.pier.y, 72)) m.phase = 'raidDoor';
  } else if (m.phase === 'raidDoor') {
    goldAt(g, L.pier.x, L.pier.y);
    if (near(L.pier.x, L.pier.y, 56) && p.state === 'foot') {
      m.phase = 'raidFightDoor';
      wakeRivals(m.rivals);
      g.say(t('say.raidGuards.title'), t('say.raidGuards.sub'), 3);
    }
  } else if (m.phase === 'raidFightDoor' || m.phase === 'raidFightYard') {
    const tgt = nearestStandingRival(g);
    redAt(g, tgt ? tgt.x : L.pier.x, tgt ? tgt.y : L.pier.y);
    if (!allBeaten(g, m.rivals)) return;
    clearRivals(g, m);
    if (m.phase === 'raidFightDoor') {
      // The yard crew becomes the fight. The wake stays guarded: a man
      // beaten while he waited (even swept by the down-timer) must not
      // be flipped back to 'fight' as a ghost the count can never
      // satisfy again.
      m.rivals = m.yardMen;
      m.yardMen = [];
      wakeRivals(m.rivals);
      m.phase = 'raidFightYard';
      g.say(t('say.yard.title'), t('say.yard.sub'), 3);
    } else {
      m.phase = 'grabCrate';
      g.say(t('say.yardDown.title'), t('say.yardDown.sub'), 3);
    }
  } else if (m.phase === 'grabCrate') {
    const spot = crateSpot(g);
    goldAt(g, spot.x, spot.y);
  } else if (m.phase === 'raidEscapeCar') {
    markersOff(g);
    if (p.state === 'car') m.phase = 'loseLaw';
  } else if (m.phase === 'loseLaw') {
    markersOff(g);
    if (g.stars === 0) {
      m.phase = 'returnBruno';
      g.say(t('say.clean.title'), t('say.clean.sub2'), 3.5);
    }
  } else if (m.phase === 'returnBruno') {
    goldAt(g, L.diner.x, L.diner.y);
    if (near(L.diner.x, L.diner.y, 56)) {
      const reward = 450 + (m.timeBonus ? RAID_TIME_BONUS : 0);
      completeMission(g, reward, t('say.jobDone.mission5'));
      // The finale gets its own moment over the JOB DONE banner.
      g.say(t('say.storyComplete.title'), t('say.storyComplete.sub', { reward: `$${reward}` }), 6.5);
    }
  }
}

const STEP_BY_INDEX = [stepPackage, stepShade, stepCollections, stepRepo, stepCourier, stepRaid];

/** Arrival checks, fight checks and marker placement, once per frame. */
export function updateMissions(g, dt, time) {
  const m = g.mission;
  g.markerGold.userData.update(time);
  g.markerRed.userData.update(time);
  syncDinerMarker(g, time);
  if (!m.active) {
    if (g.job.active) {
      updateJob(g);
      return;
    }
    // Nothing running: the gold marker stands on Bruno himself, so the
    // next job is always findable — for story work and odd jobs alike.
    if ((missionAvailable(g) || jobAvailable(g)) && g.bruno) {
      goldAt(g, g.bruno.x, g.bruno.y);
    } else {
      markersOff(g);
    }
    return;
  }
  const p = g.player;
  const near = (x, y, r) => Math.hypot(p.x - x, p.y - y) < r;
  const step = STEP_BY_INDEX[m.index];
  if (step) step(g, near, dt);
}
