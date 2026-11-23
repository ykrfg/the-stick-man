// missions.js — Bruno's work.
//
// Two kinds of it. The story is a chain of six jobs that starts at Bruno's
// diner counter and unlocks one at a time: a package run, a pickup, shop
// collections, a car repossession, a courier intercept and a timed
// warehouse raid — fists, cars and the whole toolbox in the back half.
// Once the chain is done, Bruno hands out repeatable odd jobs instead
// (deliveries and collections, alternating). Every job starts at the
// counter, is steered by the gold objective marker (red while a fight is
// owed), pays through the JOB DONE banner and unlocks what follows.
// Getting busted or wasted collapses whatever is running, set pieces
// included, and sends the player back to Bruno to try again.
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

/**
 * Fresh mission and job state, plus the markers: gold for the objective,
 * red for an owed fight, and the diner's own permanent orange one so home
 * base stays findable mid-job (syncDinerMarker decides when it shows).
 */
export function missionsInit(g) {
  const doneCount = (g.saveData.missionsDone ?? []).length;
  g.mission = {
    index: Math.min(STORY_LENGTH, doneCount),
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

/* ------------------------------------------------------------- markers -- */

function showGold(g, x, y) {
  g.markerGold.visible = true;
  g.markerGold.position.set(x, 0, y);
  g.markerRed.visible = false;
}

function showRed(g, x, y) {
  g.markerRed.visible = true;
  g.markerRed.position.set(x, 0, y);
  g.markerGold.visible = false;
}

function hideMarkers(g) {
  g.markerGold.visible = false;
  g.markerRed.visible = false;
}

/**
 * Gold on a live car, or — when the car is somehow gone — just make sure
 * the OTHER marker is not left lying about the step. Which marker gets
 * hidden in the car's absence is part of each step's original staging.
 */
function markCar(g, car, gold) {
  if (car) {
    if (gold) showGold(g, car.x, car.y);
    else showRed(g, car.x, car.y);
  } else if (gold) {
    g.markerRed.visible = false;
  } else {
    g.markerGold.visible = false;
  }
}

/**
 * The diner marker shows whenever play is live and the objective is
 * somewhere else. When the objective IS Bruno's doorstep the gold marker
 * already says so; in ?shot= scenes the diner marker never appears.
 */
function syncDinerMarker(g, time) {
  const d = g.markerDiner;
  if (!d) return;
  d.userData.update(time);
  if (g.shotMode) {
    d.visible = false;
    return;
  }
  const diner = g.city.landmarks.diner;
  const target = objectiveTarget(g);
  d.visible = !(target && Math.hypot(target.x - diner.x, target.y - diner.y) < 90);
}

/* ------------------------------------------- posting the set pieces --
 * Men and cars are placed when work is accepted or a step advances —
 * never when the player arrives, so nobody pops into existence on screen. */

function postShopPair(g, shop, shopIndex) {
  const men = [
    spawnPed(g, { role: 'rival', x: shop.x + 30, y: shop.y - 16, shopIndex }),
    spawnPed(g, { role: 'rival', x: shop.x - 26, y: shop.y + 22, shopIndex }),
  ];
  for (const man of men) man.state = 'idle';
  return men;
}

/** REPO JOB: the debtor's gold car at the curb behind the Ammo Hut, guarded. */
function postRepoCar(g) {
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
  for (const guard of m.rivals) guard.state = 'idle';
}

/** WAREHOUSE RAID: two guards on the south face, the yard crew behind them. */
function postRaidCrew(g) {
  const m = g.mission;
  const pier = g.city.landmarks.pier;
  const elite = { hp: 150, chase: 208, punchRate: 0.7, armed: true };
  m.rivals = [
    spawnPed(g, { role: 'rival', x: pier.x - 40, y: pier.y - 28 }),
    spawnPed(g, { role: 'rival', x: pier.x + 42, y: pier.y - 28 }),
  ];
  m.yardMen = [
    spawnPed(g, { role: 'rival', x: pier.x - 92, y: pier.y + 22, ...elite }),
    spawnPed(g, { role: 'rival', x: pier.x, y: pier.y + 38, ...elite }),
    spawnPed(g, { role: 'rival', x: pier.x + 92, y: pier.y + 22, ...elite }),
  ];
  for (const ped of [...m.rivals, ...m.yardMen]) ped.state = 'idle';
}

/** Where the raid's crate waits, on the pier's north edge. */
function crateSpot(g) {
  const pier = g.city.landmarks.pier;
  return { x: pier.x, y: pier.y - 35 };
}

/* -------------------------------------------------------- fight ledger -- */

/**
 * Beaten means down for good (hp <= 0) or already swept from the world.
 * A plain 'down' is NOT beaten: a car knockdown puts a fighter down with
 * hp to spare and he gets back up — counting the state once let a single
 * drive through a wave "win" the fight and vanish living men in cleanup.
 */
function isBeaten(g, r) {
  return r.hp <= 0 || !g.peds.includes(r);
}

function waveBeaten(g, rivals) {
  return rivals.every((r) => isBeaten(g, r));
}

/** Wake only the men still idling — a man already down stays down. */
function wakeWave(rivals) {
  for (const r of rivals) if (r.state === 'idle') r.state = 'fight';
}

function sweepWave(g, holder) {
  for (const r of holder.rivals) removePed(g, r);
  holder.rivals = [];
}

/** The nearest rival still standing — where a fight objective truly is. */
function nearestStanding(g) {
  let best = null;
  let bestD = Infinity;
  for (const r of g.mission.rivals) {
    if (isBeaten(g, r)) continue;
    const d = Math.hypot(r.x - g.player.x, r.y - g.player.y);
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

/** Push the heat to a scripted star count (the law "notices" the job). */
function scriptedHeat(g, stars) {
  const need = HEAT_THRESHOLDS[stars - 1] + 5 - g.heat;
  if (need > 0) addHeat(g, need, g.player.x, g.player.y, { force: true });
}

/* ---------------------------------------------------------- taking work -- */

/** Start the current story mission: the player talked to Bruno. */
export function acceptMission(g) {
  const m = g.mission;
  if (!missionAvailable(g)) return;
  m.active = true;
  m.shopStep = 0;
  m.rivals = [];
  const L = g.city.landmarks;
  if (m.index === 0) {
    m.phase = 'toWarehouse';
  } else if (m.index === 1) {
    m.phase = 'toClub';
    // Shade waits at the club door from this moment on — arriving reveals
    // a man who was already there, never a spawn-in.
    m.shade = spawnPed(g, { role: 'shade', x: L.club.x + 24, y: L.club.y + 10, name: 'SHADE' });
    m.shade.fig.setExpression('angry');
    m.shade.state = 'idle';
    m.shade.homeX = m.shade.x;
    m.shade.homeY = m.shade.y;
  } else if (m.index === 2) {
    m.phase = 'toShop';
    m.rivals = postShopPair(g, g.city.shops[0], 0);
  } else if (m.index === 3) {
    m.phase = 'toCar';
    postRepoCar(g);
  } else if (m.index === 4) {
    m.phase = 'intercept';
    m.courier = spawnCourierCar(g);
  } else {
    m.phase = 'raidDrive';
    m.timer = RAID_TIMER;
    m.timeBonus = true;
    postRaidCrew(g);
  }
  g.say(missionTitle(m.index), missionIntro(m.index), 5.5);
  g.events.push({ type: 'missionstart' });
}

/**
 * The places an odd job can name: the five landmarks (by their proper
 * names — place names stay as they are in every language) and every shop.
 */
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

/**
 * Start the next odd job. Deliveries and collections alternate (a coin
 * flip picks the first ever), each paying through the same JOB DONE
 * banner and counting into the same totals as the story's work.
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
    j.rivals = postShopPair(g, shop, j.shopIndex);
    g.say(t('job.collection.title'), t('job.collection.sub', { shop: shop.name, reward: `$${j.reward}` }), 5.5);
  }
  g.events.push({ type: 'missionstart' });
}

/** Pay out and close an odd job; the kind is remembered for alternation. */
function completeJob(g, line) {
  const j = g.job;
  j.active = false;
  j.phase = '';
  j.lastType = j.type;
  hideMarkers(g);
  g.money += j.reward;
  g.earned += j.reward;
  g.saveData.jobsDone = (g.saveData.jobsDone ?? 0) + 1;
  g.events.push({ type: 'save' });
  g.say(t('say.jobDone.title'), `${line}  +$${j.reward}`, 4.5);
  g.events.push({ type: 'missiondone' });
}

/** The odd job's frame: arrivals, the collection fight, the markers. */
function updateJob(g) {
  const j = g.job;
  const p = g.player;
  const near = (x, y, r) => Math.hypot(p.x - x, p.y - y) < r;
  if (j.type === 'delivery') {
    if (j.phase === 'toPickup') {
      showGold(g, j.from.x, j.from.y);
      if (near(j.from.x, j.from.y, 56)) {
        j.phase = 'toDropoff';
        g.say(t('say.packageSecured.title'), t('say.packageSecured.job', { place: j.to.name }), 3);
        g.events.push({ type: 'pickup' });
      }
    } else if (j.phase === 'toDropoff') {
      showGold(g, j.to.x, j.to.y);
      if (near(j.to.x, j.to.y, 56)) completeJob(g, t('say.jobDone.delivery'));
    }
    return;
  }
  if (j.type !== 'collection') return;
  const shop = g.city.shops[j.shopIndex];
  if (!shop) return;
  if (j.phase === 'toShop') {
    showGold(g, shop.x, shop.y);
    if (near(shop.x, shop.y, 52) && p.state === 'foot') {
      j.phase = 'fight';
      wakeWave(j.rivals);
      g.say(t('say.collectors.title'), t('say.collectors.job'), 3);
    }
  } else if (j.phase === 'fight') {
    showRed(g, shop.x, shop.y);
    if (waveBeaten(g, j.rivals)) {
      sweepWave(g, j);
      completeJob(g, t('say.jobDone.collection', { shop: shop.name }));
    }
  }
}

/* ------------------------------------------------ what the HUD points at -- */

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
  const byPhase = {
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
  const line = byPhase[m.phase];
  return line ? line() : '';
}

function pt(x, y) {
  return { x, y };
}

/**
 * The world point the objective stands on. The marker, the minimap blip
 * and the HUD distance all read this one answer, so they agree by
 * construction. Null when the step has no place — an escape's target is
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
        return spot ? pt(spot.x, spot.y) : null;
      }
      const shop = g.city.shops[j.shopIndex];
      return shop ? pt(shop.x, shop.y) : null;
    }
    // Waiting for work, Bruno himself is the objective — story jobs
    // before the story ends, odd jobs after it.
    if (!missionAvailable(g) && !jobAvailable(g)) return null;
    return g.bruno ? pt(g.bruno.x, g.bruno.y) : pt(L.diner.x, L.diner.y);
  }
  if (m.phase === 'toCar' || m.phase === 'repoFight' || m.phase === 'repoSteal') {
    return m.targetCar ? pt(m.targetCar.x, m.targetCar.y) : pt(L.ammo.x, L.ammo.y);
  }
  switch (m.phase) {
    case 'toWarehouse': return pt(L.pier.x, L.pier.y);
    case 'returnDiner': return pt(L.diner.x, L.diner.y);
    case 'toClub': return pt(L.club.x, L.club.y);
    case 'getCar': return m.shade ? pt(m.shade.x, m.shade.y) : pt(L.club.x, L.club.y);
    case 'dropoff': return pt(L.pier.x, L.pier.y);
    case 'toShop':
    case 'fight': {
      const shop = g.city.shops[m.shopStep];
      return shop ? pt(shop.x, shop.y) : null;
    }
    case 'repoDeliver': return pt(L.pier.x, L.pier.y);
    case 'intercept':
    case 'escortsFight':
    case 'grabCase':
      return m.courier ? pt(m.courier.x, m.courier.y) : null;
    case 'returnBruno': return pt(L.diner.x, L.diner.y);
    case 'raidDrive':
    case 'raidDoor':
      return pt(L.pier.x, L.pier.y);
    case 'raidFightDoor':
    case 'raidFightYard': {
      const r = nearestStanding(g);
      return r ? pt(r.x, r.y) : pt(L.pier.x, L.pier.y);
    }
    case 'grabCrate': return crateSpot(g);
    default: return null;
  }
}

/* -------------------------------------------------------------- endings -- */

/** Pay out and close a story mission; the chain advances by one. */
function completeMission(g, reward, line) {
  const m = g.mission;
  m.active = false;
  m.phase = '';
  hideMarkers(g);
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
    hideMarkers(g);
    if (m.shade) {
      removePed(g, m.shade);
      m.shade = null;
    }
    if (g.passenger) g.passenger = null;
    sweepWave(g, m);
    for (const ped of m.yardMen) removePed(g, ped);
    m.yardMen = [];
    if (m.courier) {
      removeCar(g, m.courier);
      m.courier = null;
    }
    if (m.targetCar) {
      // Only while it is still the debtor's car — once taken, it is the
      // player's and stays in the world like any other car.
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
    hideMarkers(g);
    sweepWave(g, j);
    g.say(t('say.jobFailed.title'), t('say.jobFailed.job'), 3.5);
  }
}

/** Shade climbed into the player's car (an event out of people.js). */
export function onBoarded(g) {
  const m = g.mission;
  if (!m.active || m.index !== 1 || m.phase !== 'getCar') return;
  m.phase = 'escape';
  scriptedHeat(g, 3);
  g.say(t('say.shadeIn.title'), t('say.shadeIn.sub'), 4);
}

/* ------------------------------------- the grab steps (case and crate) -- */

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

/** Run the grab (E pressed at the spot). True when the press was consumed. */
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

/* ---------------------------------------------------- the phase machines --
 * One stepper per story mission, dispatched by index. Each owns its
 * markers for the frame and advances its phase on arrivals and fights. */

/** Shared shape of "the law lost you": hide the markers, wait for star 0. */
function whenClean(g, nextPhase, subKey) {
  const m = g.mission;
  hideMarkers(g);
  if (g.stars === 0) {
    m.phase = nextPhase;
    g.say(t('say.clean.title'), t(subKey), 3.5);
  }
}

function stepPackageRun(g, near) {
  const m = g.mission;
  const L = g.city.landmarks;
  if (m.phase === 'toWarehouse') {
    showGold(g, L.pier.x, L.pier.y);
    if (near(L.pier.x, L.pier.y, 56)) {
      m.phase = 'returnDiner';
      g.say(t('say.packageSecured.title'), t('say.packageSecured.mission'), 3);
      g.events.push({ type: 'pickup' });
    }
  } else if (m.phase === 'returnDiner') {
    showGold(g, L.diner.x, L.diner.y);
    if (near(L.diner.x, L.diner.y, 56)) completeMission(g, 150, t('say.jobDone.mission0'));
  }
}

function stepShadeRun(g, near) {
  const m = g.mission;
  const p = g.player;
  const L = g.city.landmarks;
  if (m.phase === 'toClub') {
    showGold(g, L.club.x, L.club.y);
    if (near(L.club.x, L.club.y, 52) && p.state === 'foot') {
      m.phase = 'getCar';
      g.say('SHADE', t('say.shade.sub'), 4.5);
    }
  } else if (m.phase === 'getCar') {
    // The marker stands on Shade himself: he IS this step's destination.
    if (m.shade) showGold(g, m.shade.x, m.shade.y);
    else showGold(g, L.club.x, L.club.y);
    if (m.shade && p.state === 'car' && p.car) {
      const d = Math.hypot(m.shade.x - p.car.x, m.shade.y - p.car.y);
      if (d < 175 && m.shade.state !== 'board') m.shade.state = 'board';
    }
  } else if (m.phase === 'escape') {
    whenClean(g, 'dropoff', 'say.clean.sub');
  } else if (m.phase === 'dropoff') {
    showGold(g, L.pier.x, L.pier.y);
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

function stepCollectionsRun(g, near) {
  const m = g.mission;
  const p = g.player;
  const shop = g.city.shops[m.shopStep];
  if (m.phase === 'toShop') {
    showGold(g, shop.x, shop.y);
    if (near(shop.x, shop.y, 52) && p.state === 'foot') {
      m.phase = 'fight';
      wakeWave(m.rivals);
      g.say(t('say.collectors.title'), t('say.collectors.mission'), 3);
    }
  } else if (m.phase === 'fight') {
    showRed(g, shop.x, shop.y);
    if (waveBeaten(g, m.rivals)) {
      sweepWave(g, m);
      g.money += 120;
      g.earned += 120;
      g.events.push({ type: 'cash', amount: 120 });
      m.shopStep += 1;
      if (m.shopStep >= g.city.shops.length) {
        completeMission(g, 250, t('say.jobDone.mission2'));
      } else {
        m.phase = 'toShop';
        m.rivals = postShopPair(g, g.city.shops[m.shopStep], m.shopStep);
        g.say(t('say.paidUp.title'), t('say.paidUp.sub'), 2.6);
      }
    }
  }
}

function stepRepoRun(g, near) {
  const m = g.mission;
  const p = g.player;
  const L = g.city.landmarks;
  const car = m.targetCar;
  if (m.phase === 'toCar') {
    markCar(g, car, true);
    if (car && near(car.x, car.y, 60) && p.state === 'foot') {
      m.phase = 'repoFight';
      wakeWave(m.rivals);
      g.say(t('say.repoGuards.title'), t('say.repoGuards.sub'), 3);
    }
  } else if (m.phase === 'repoFight') {
    markCar(g, car, false);
    if (waveBeaten(g, m.rivals)) {
      sweepWave(g, m);
      m.phase = 'repoSteal';
      g.say(t('say.repoClear.title'), t('say.repoClear.sub'), 3);
    }
  } else if (m.phase === 'repoSteal') {
    markCar(g, car, true);
    if (car && p.state === 'car' && p.car === car) {
      m.phase = 'repoDeliver';
      // The whole PD hears about this particular car the moment it rolls.
      scriptedHeat(g, 2);
      g.say(t('say.repoHot.title'), t('say.repoHot.sub'), 4);
    }
  } else if (m.phase === 'repoDeliver') {
    showGold(g, L.pier.x, L.pier.y);
    if (car && p.state === 'car' && p.car === car && near(L.pier.x, L.pier.y, 62)) {
      m.targetCar = null; // delivered: from here on it is just a car in the world
      completeMission(g, 220, t('say.jobDone.mission3'));
    }
  }
}

function stepCourierRun(g, near, dt) {
  const m = g.mission;
  const L = g.city.landmarks;
  const car = m.courier;
  if (m.phase === 'intercept') {
    if (car) {
      driveCourier(g, car, dt);
      showGold(g, car.x, car.y);
    } else {
      g.markerRed.visible = false;
    }
    const pinned = car && (car.stillT ?? 0) > 2.2 && near(car.x, car.y, 320);
    if (car && (car.wrecked || pinned)) {
      // The crew bails out swinging — Bruno-grade troublemakers with more
      // health and faster feet than the shop collectors. Their pistols
      // are for show: Palmera's combat only lets the player shoot, so
      // they fight as elite fist fighters.
      car.speed = 0;
      const escort = { hp: 150, chase: 208, punchRate: 0.7, armed: true };
      m.rivals = [
        spawnPed(g, { role: 'rival', x: car.x + 32, y: car.y + 20, ...escort }),
        spawnPed(g, { role: 'rival', x: car.x - 32, y: car.y - 20, ...escort }),
      ];
      for (const rival of m.rivals) rival.state = 'fight';
      m.phase = 'escortsFight';
      g.say(t('say.escorts.title'), t('say.escorts.sub'), 3.5);
    }
  } else if (m.phase === 'escortsFight') {
    markCar(g, car, false);
    if (waveBeaten(g, m.rivals)) {
      sweepWave(g, m);
      m.phase = 'grabCase';
      g.say(t('say.escortsDown.title'), t('say.escortsDown.sub'), 3);
    }
  } else if (m.phase === 'grabCase') {
    markCar(g, car, true);
  } else if (m.phase === 'escapeHeat') {
    whenClean(g, 'returnBruno', 'say.clean.sub2');
  } else if (m.phase === 'returnBruno') {
    showGold(g, L.diner.x, L.diner.y);
    if (near(L.diner.x, L.diner.y, 56)) completeMission(g, 300, t('say.jobDone.mission4'));
  }
}

function stepRaidRun(g, near, dt) {
  const m = g.mission;
  const p = g.player;
  const L = g.city.landmarks;
  if (m.phase === 'raidDrive') {
    showGold(g, L.pier.x, L.pier.y);
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
    showGold(g, L.pier.x, L.pier.y);
    if (near(L.pier.x, L.pier.y, 56) && p.state === 'foot') {
      m.phase = 'raidFightDoor';
      wakeWave(m.rivals);
      g.say(t('say.raidGuards.title'), t('say.raidGuards.sub'), 3);
    }
  } else if (m.phase === 'raidFightDoor' || m.phase === 'raidFightYard') {
    const tgt = nearestStanding(g);
    showRed(g, tgt ? tgt.x : L.pier.x, tgt ? tgt.y : L.pier.y);
    if (!waveBeaten(g, m.rivals)) return;
    sweepWave(g, m);
    if (m.phase === 'raidFightDoor') {
      // The yard crew becomes the fight. The wake stays guarded: a man
      // beaten while he waited — even swept by the down-timer — must not
      // be flipped back to 'fight' as a ghost the count can never satisfy.
      m.rivals = m.yardMen;
      m.yardMen = [];
      wakeWave(m.rivals);
      m.phase = 'raidFightYard';
      g.say(t('say.yard.title'), t('say.yard.sub'), 3);
    } else {
      m.phase = 'grabCrate';
      g.say(t('say.yardDown.title'), t('say.yardDown.sub'), 3);
    }
  } else if (m.phase === 'grabCrate') {
    const spot = crateSpot(g);
    showGold(g, spot.x, spot.y);
  } else if (m.phase === 'raidEscapeCar') {
    hideMarkers(g);
    if (p.state === 'car') m.phase = 'loseLaw';
  } else if (m.phase === 'loseLaw') {
    whenClean(g, 'returnBruno', 'say.clean.sub2');
  } else if (m.phase === 'returnBruno') {
    showGold(g, L.diner.x, L.diner.y);
    if (near(L.diner.x, L.diner.y, 56)) {
      const reward = 450 + (m.timeBonus ? RAID_TIME_BONUS : 0);
      completeMission(g, reward, t('say.jobDone.mission5'));
      // The finale gets its own moment over the JOB DONE banner.
      g.say(t('say.storyComplete.title'), t('say.storyComplete.sub', { reward: `$${reward}` }), 6.5);
    }
  }
}

const STEPPERS = [stepPackageRun, stepShadeRun, stepCollectionsRun, stepRepoRun, stepCourierRun, stepRaidRun];

/** Arrivals, fight checks and marker placement, once per frame. */
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
    // next job is always findable — story work and odd jobs alike.
    if ((missionAvailable(g) || jobAvailable(g)) && g.bruno) {
      showGold(g, g.bruno.x, g.bruno.y);
    } else {
      hideMarkers(g);
    }
    return;
  }
  const p = g.player;
  const near = (x, y, r) => Math.hypot(p.x - x, p.y - y) < r;
  const step = STEPPERS[m.index];
  if (step) step(g, near, dt);
}
