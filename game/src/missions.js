// The story: six jobs for Bruno, the black stick figure who runs Bruno's Diner
// and half the errands in Palmera. Walk up to Bruno and press E to take the next
// job. Each mission drives a gold marker (red while someone has to be beaten),
// pays cash, and unlocks the next; the pistol arrives with the second job. The
// back three jobs mix the tools together — fists and a marked car (REPO JOB),
// a moving courier car stopped by crash damage and its crew (COURIER HIT), and
// a timed drive into a two-wave warehouse fight (WAREHOUSE RAID). Failing
// (busted or wasted) sends the player back to Bruno to try again.
import { HEAT_THRESHOLDS, RAID_TIME_BONUS, RAID_TIMER } from './config.js';
import { makeMarker } from './world3d.js';
import { removePed, spawnPed } from './people.js';
import { driveCourier, removeCar, spawnCar, spawnCourierCar, syncCarMesh } from './vehicles.js';
import { addHeat } from './police.js';
import { t } from './i18n.js';

/** The six chained story missions, in order (titles/intros live in i18n.js). */
const MISSION_COUNT = 6;
export function missionTitle(index) {
  return t(`mission.${index}.title`);
}
function missionIntro(index) {
  return t(`mission.${index}.intro`);
}

export function missionsInit(g) {
  g.mission = {
    index: Math.min(MISSION_COUNT, (g.saveData.missionsDone ?? []).length),
    active: false,
    phase: '',
    shopStep: 0,
    rivals: [],
    shade: null,
    // Missions 4–6 state: the REPO JOB's marked car and its guards, the
    // COURIER HIT car, and the WAREHOUSE RAID's second wave (posted at
    // accept time, swapped into `rivals` when the door guards fall) and
    // its opening-drive clock.
    targetCar: null,
    courier: null,
    yardMen: [],
    timer: 0,
    timeBonus: false,
  };
  // Bruno's odd jobs: the free-roam work loop, unlocked once the story is
  // done. Same shape as a mission (marker, phases, JOB DONE payoff) but
  // repeatable forever, with a fresh destination every time.
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
}

export function missionAvailable(g) {
  return !g.mission.active && g.mission.index < MISSION_COUNT;
}

function setMarker(g, marker, x, y) {
  marker.visible = true;
  marker.position.set(x, 0, y);
}

function hideMarkers(g) {
  g.markerGold.visible = false;
  g.markerRed.visible = false;
}

/**
 * Post the current shop's collectors at its door. Called when the step
 * becomes current — when the job is accepted and on each advance — never
 * when the player arrives: two black figures loitering at the shopfront
 * are part of the approach the player can see coming, not a pair of
 * enemies materializing the instant the fight step triggers.
 */
function postCollectors(g) {
  const m = g.mission;
  const shop = g.city.shops[m.shopStep];
  if (!shop) return;
  m.rivals = [
    spawnPed(g, { role: 'rival', x: shop.x + 30, y: shop.y - 16, shopIndex: m.shopStep }),
    spawnPed(g, { role: 'rival', x: shop.x - 26, y: shop.y + 22, shopIndex: m.shopStep }),
  ];
  for (const rival of m.rivals) rival.state = 'idle';
}

/**
 * REPO JOB set-up, at accept time: the debtor's gold car parked on the
 * avenue curb behind the Ammo Hut, and his two guards posted beside it.
 * Everything exists from the moment Bruno hands the job out — the
 * approach shows a guarded car, never a pop-in. The car is extra tough
 * (and quietly repaired by the update loop while it is still the
 * objective) so an early shunt can never soft-lock the job.
 */
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

/**
 * WAREHOUSE RAID set-up, at accept time: two door guards at the
 * warehouse's south face and the three-man yard crew behind them, all
 * posted while the player is still at the diner. The yard crew waits in
 * `yardMen` (idle) until the door fight ends; only then do they become
 * the mission's `rivals` and wake.
 */
function postRaid(g) {
  const m = g.mission;
  const L = g.city.landmarks;
  m.rivals = [
    spawnPed(g, { role: 'rival', x: L.pier.x - 40, y: L.pier.y - 28 }),
    spawnPed(g, { role: 'rival', x: L.pier.x + 42, y: L.pier.y - 28 }),
  ];
  m.yardMen = [
    spawnPed(g, { role: 'rival', x: L.pier.x - 92, y: L.pier.y + 22, hp: 150, chase: 208, punchRate: 0.7 }),
    spawnPed(g, { role: 'rival', x: L.pier.x, y: L.pier.y + 38, hp: 150, chase: 208, punchRate: 0.7 }),
    spawnPed(g, { role: 'rival', x: L.pier.x + 92, y: L.pier.y + 22, hp: 150, chase: 208, punchRate: 0.7 }),
  ];
  for (const ped of [...m.rivals, ...m.yardMen]) ped.state = 'idle';
}

/** The cash crate's spot for the raid: just south of the warehouse doors. */
function crateSpot(g) {
  const L = g.city.landmarks;
  return { x: L.pier.x, y: L.pier.y - 35 };
}

/** Start the current mission (the player talked to Bruno). */
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
    // Shade exists from the moment the job is taken: he waits at the club
    // door the whole approach, so arriving reveals a man, not a spawn.
    m.shade = spawnPed(g, { role: 'shade', x: L.club.x + 24, y: L.club.y + 10, name: 'SHADE' });
    m.shade.fig.setExpression('angry');
    m.shade.state = 'idle';
  } else if (m.index === 2) {
    m.phase = 'toShop';
    postCollectors(g);
  } else if (m.index === 3) {
    m.phase = 'toCar';
    postRepoJob(g);
  } else if (m.index === 4) {
    m.phase = 'intercept';
    // The courier is already looping the city when Bruno names it.
    m.courier = spawnCourierCar(g);
  } else {
    m.phase = 'raidDrive';
    m.timer = RAID_TIMER;
    m.timeBonus = true;
    postRaid(g);
  }
  g.say(missionTitle(m.index), missionIntro(m.index), 5.5);
  g.events.push({ type: 'missionstart' });
}

// ---------------------------------------------------------------------------
// Bruno's odd jobs — the free-roam earning loop. Unlocked only once the
// story missions are done, so Bruno's counter never has two kinds of work
// competing: while a story job exists it is always offered first. The two
// kinds alternate (after a coin-flip first pick), each run is short, pays
// through the same JOB DONE banner as the story, and counts into the same
// earned/save totals.
// ---------------------------------------------------------------------------

export function jobAvailable(g) {
  return !g.mission.active && !g.job.active && g.mission.index >= MISSION_COUNT;
}

/** Named places a delivery can start and end at: landmarks plus the shops. */
function jobPlaces(g) {
  const L = g.city.landmarks;
  return [
    { name: 'the Pier Warehouse', x: L.pier.x, y: L.pier.y },
    { name: 'Club Neon', x: L.club.x, y: L.club.y },
    { name: 'St. Palm Hospital', x: L.hospital.x, y: L.hospital.y },
    { name: 'the Ammo Hut', x: L.ammo.x, y: L.ammo.y },
    { name: "Spray 'n Go", x: L.spray.x, y: L.spray.y },
    ...g.city.shops.map((s) => ({ name: s.name, x: s.x, y: s.y })),
  ];
}

/** Post a job collection's two collectors at their shop door, at accept time. */
function postJobCollectors(g) {
  const j = g.job;
  const shop = g.city.shops[j.shopIndex];
  if (!shop) return;
  j.rivals = [
    spawnPed(g, { role: 'rival', x: shop.x + 30, y: shop.y - 16, shopIndex: j.shopIndex }),
    spawnPed(g, { role: 'rival', x: shop.x - 26, y: shop.y + 22, shopIndex: j.shopIndex }),
  ];
  for (const rival of j.rivals) rival.state = 'idle';
}

/** Start the next odd job (the player talked to Bruno in free roam). */
export function acceptJob(g) {
  const j = g.job;
  if (!jobAvailable(g)) return;
  j.active = true;
  j.rivals = [];
  j.type = j.lastType === 'delivery'
    ? 'collection'
    : j.lastType === 'collection'
      ? 'delivery'
      : (g.rng.chance(0.5) ? 'delivery' : 'collection');
  if (j.type === 'delivery') {
    const places = jobPlaces(g);
    const a = g.rng.int(0, places.length - 1);
    let b = g.rng.int(0, places.length - 1);
    if (b === a) b = (b + 1) % places.length;
    j.from = places[a];
    j.to = places[b];
    j.phase = 'toPickup';
    j.reward = 5 * g.rng.int(18, 28); // $90–140
    g.say(t('job.delivery.title'), t('job.delivery.sub', { from: j.from.name, to: j.to.name, reward: `$${j.reward}` }), 5.5);
  } else {
    j.shopIndex = g.rng.int(0, g.city.shops.length - 1);
    const shop = g.city.shops[j.shopIndex];
    j.phase = 'toShop';
    j.reward = 5 * g.rng.int(24, 36); // $120–180
    // Posted NOW, while the player is still at the diner: the approach
    // shows two men waiting at the shopfront, never a pop-in at the door.
    postJobCollectors(g);
    g.say(t('job.collection.title'), t('job.collection.sub', { shop: shop.name, reward: `$${j.reward}` }), 5.5);
  }
  g.events.push({ type: 'missionstart' });
}

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

/** The odd job's per-frame work: arrivals, the fight check, the markers. */
function updateJob(g) {
  const j = g.job;
  const p = g.player;
  const near = (x, y, r) => Math.hypot(p.x - x, p.y - y) < r;
  if (j.type === 'delivery') {
    if (j.phase === 'toPickup') {
      setMarker(g, g.markerGold, j.from.x, j.from.y);
      g.markerRed.visible = false;
      if (near(j.from.x, j.from.y, 56)) {
        j.phase = 'toDropoff';
        g.say(t('say.packageSecured.title'), t('say.packageSecured.job', { place: j.to.name }), 3);
        g.events.push({ type: 'pickup' });
      }
    } else if (j.phase === 'toDropoff') {
      setMarker(g, g.markerGold, j.to.x, j.to.y);
      g.markerRed.visible = false;
      if (near(j.to.x, j.to.y, 56)) {
        completeJob(g, t('say.jobDone.delivery'));
      }
    }
  } else if (j.type === 'collection') {
    const shop = g.city.shops[j.shopIndex];
    if (!shop) return;
    if (j.phase === 'toShop') {
      setMarker(g, g.markerGold, shop.x, shop.y);
      g.markerRed.visible = false;
      if (near(shop.x, shop.y, 52) && p.state === 'foot') {
        // The trigger only wakes the men posted at accept time.
        j.phase = 'fight';
        for (const rival of j.rivals) if (rival.state === 'idle') rival.state = 'fight';
        g.say(t('say.collectors.title'), t('say.collectors.job'), 3);
      }
    } else if (j.phase === 'fight') {
      setMarker(g, g.markerRed, shop.x, shop.y);
      g.markerGold.visible = false;
      if (j.rivals.every((r) => r.state === 'down')) {
        for (const rival of j.rivals) removePed(g, rival);
        j.rivals = [];
        completeJob(g, t('say.jobDone.collection', { shop: shop.name }));
      }
    }
  }
}

/**
 * The current objective line for the HUD ('' when nothing is running). Every
 * step names its PLACE as well as its person — "come back for Shade" alone
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
    if (m.index >= MISSION_COUNT) return t('obj.freeRoam');
    return t('obj.talkBruno');
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
    case 'loseLaw':
    case 'escapeHeat': return t('obj.escape');
    default: return '';
  }
}

/**
 * The world point the current objective points at — the spot the gold/red
 * marker stands on — or null when the step has no place (the escape: the
 * target there is the heat itself). The HUD reads this for its distance
 * readout, so the text, the marker, the minimap blip and the distance all
 * agree by construction.
 */
export function objectiveTarget(g) {
  const m = g.mission;
  const L = g.city.landmarks;
  if (!m.active) {
    const j = g.job;
    if (j && j.active) {
      if (j.type === 'delivery') {
        const t = j.phase === 'toPickup' ? j.from : j.to;
        return t ? { x: t.x, y: t.y } : null;
      }
      const shop = g.city.shops[j.shopIndex];
      return shop ? { x: shop.x, y: shop.y } : null;
    }
    // Point at the man himself, not just his diner, while work waits at
    // his counter — story jobs before the story is done, odd jobs after
    // it: Bruno is the objective either way.
    if (!missionAvailable(g) && !jobAvailable(g)) return null;
    return g.bruno ? { x: g.bruno.x, y: g.bruno.y } : { x: L.diner.x, y: L.diner.y };
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
    case 'toCar':
    case 'repoFight':
    case 'repoSteal':
      return m.targetCar ? { x: m.targetCar.x, y: m.targetCar.y } : { x: L.ammo.x, y: L.ammo.y };
    case 'repoDeliver': return { x: L.pier.x, y: L.pier.y };
    case 'intercept':
    case 'escortsFight':
    case 'grabCase':
      return m.courier ? { x: m.courier.x, y: m.courier.y } : null;
    case 'returnBruno': return { x: L.diner.x, y: L.diner.y };
    case 'raidDrive':
    case 'raidDoor':
    case 'raidFightDoor':
    case 'raidFightYard':
      return { x: L.pier.x, y: L.pier.y };
    case 'grabCrate': return crateSpot(g);
    // raidEscapeCar (any car will do) and loseLaw / escapeHeat (the
    // target is the heat itself) have no place to point at.
    default: return null;
  }
}

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

/** The active mission (or odd job) collapses when the player is busted or wasted. */
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
    if (g.passenger) {
      g.passenger = null;
    }
    for (const rival of m.rivals) removePed(g, rival);
    m.rivals = [];
    // Missions 4–6 leave set pieces behind: the raid's second wave, the
    // courier car, and the repo target car (only while it is still the
    // debtor's — once the player has taken it, it is just their car).
    for (const ped of m.yardMen) removePed(g, ped);
    m.yardMen = [];
    if (m.courier) {
      removeCar(g, m.courier);
      m.courier = null;
    }
    if (m.targetCar) {
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
    for (const rival of j.rivals) removePed(g, rival);
    j.rivals = [];
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

/** Raise the heat to a scripted star count (the law "notices" the job). */
function scriptedHeat(g, stars) {
  const need = HEAT_THRESHOLDS[stars - 1] + 5 - g.heat;
  if (need > 0) addHeat(g, need, g.player.x, g.player.y, { force: true });
}

// ---------------------------------------------------------------------------
// The grab steps (the courier's case, the raid's cash crate): a place the
// player walks up to and takes with E. main.js asks missionPrompt() what
// to show and missionInteract() to run the take, in the same prompt /
// interact priority as Bruno's counter — the mission owns these spots.
// ---------------------------------------------------------------------------

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

/** Run the grab (E pressed at the spot). Returns true when it consumed the press. */
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

/** Arrival checks, fight checks and marker placement, once per frame. */
export function updateMissions(g, dt, time) {
  const m = g.mission;
  g.markerGold.userData.update(time);
  g.markerRed.userData.update(time);
  if (!m.active) {
    if (g.job.active) {
      updateJob(g);
      return;
    }
    // No job running: the gold marker (and the minimap blip that follows
    // the same target) stands on Bruno himself, so the next job is always
    // findable — the talk prompt never points at an empty doorstep. True
    // for story work and, in free roam, for odd jobs alike.
    if ((missionAvailable(g) || jobAvailable(g)) && g.bruno) {
      setMarker(g, g.markerGold, g.bruno.x, g.bruno.y);
      g.markerRed.visible = false;
    } else {
      hideMarkers(g);
    }
    return;
  }
  const p = g.player;
  const L = g.city.landmarks;
  const near = (x, y, r) => Math.hypot(p.x - x, p.y - y) < r;

  if (m.index === 0) {
    if (m.phase === 'toWarehouse') {
      setMarker(g, g.markerGold, L.pier.x, L.pier.y);
      g.markerRed.visible = false;
      if (near(L.pier.x, L.pier.y, 56)) {
        m.phase = 'returnDiner';
        g.say(t('say.packageSecured.title'), t('say.packageSecured.mission'), 3);
        g.events.push({ type: 'pickup' });
      }
    } else if (m.phase === 'returnDiner') {
      setMarker(g, g.markerGold, L.diner.x, L.diner.y);
      if (near(L.diner.x, L.diner.y, 56)) {
        completeMission(g, 150, t('say.jobDone.mission0'));
      }
    }
  } else if (m.index === 1) {
    if (m.phase === 'toClub') {
      setMarker(g, g.markerGold, L.club.x, L.club.y);
      g.markerRed.visible = false;
      if (near(L.club.x, L.club.y, 52) && p.state === 'foot') {
        // Shade has been waiting at the club door since the job was taken
        // (posted in acceptMission) — arriving just starts the next step.
        m.phase = 'getCar';
        g.say('SHADE', t('say.shade.sub'), 4.5);
      }
    } else if (m.phase === 'getCar') {
      // The marker (and with it the minimap blip) stands on Shade himself:
      // he IS the destination of this step.
      if (m.shade) setMarker(g, g.markerGold, m.shade.x, m.shade.y);
      else setMarker(g, g.markerGold, L.club.x, L.club.y);
      g.markerRed.visible = false;
      if (m.shade && p.state === 'car' && p.car) {
        const d = Math.hypot(m.shade.x - p.car.x, m.shade.y - p.car.y);
        if (d < 175 && m.shade.state !== 'board') m.shade.state = 'board';
      }
    } else if (m.phase === 'escape') {
      hideMarkers(g);
      if (g.stars === 0) {
        m.phase = 'dropoff';
        g.say(t('say.clean.title'), t('say.clean.sub'), 3.5);
      }
    } else if (m.phase === 'dropoff') {
      setMarker(g, g.markerGold, L.pier.x, L.pier.y);
      g.markerRed.visible = false;
      if (near(L.pier.x, L.pier.y, 60) && g.passenger) {
        if (g.passenger) {
          removePed(g, g.passenger);
          g.passenger = null;
        }
        m.shade = null;
        if (!g.player.hasPistol) {
          g.player.hasPistol = true;
          g.events.push({ type: 'pistol' });
        }
        completeMission(g, 300, t('say.jobDone.mission1'));
      }
    }
  } else if (m.index === 2) {
    const shop = g.city.shops[m.shopStep];
    if (m.phase === 'toShop') {
      setMarker(g, g.markerGold, shop.x, shop.y);
      g.markerRed.visible = false;
      if (near(shop.x, shop.y, 52) && p.state === 'foot') {
        // The collectors were posted at this shop when the step became
        // current (acceptMission / the previous shop's payoff) — the
        // trigger only wakes the men the player already saw waiting.
        m.phase = 'fight';
        for (const rival of m.rivals) if (rival.state === 'idle') rival.state = 'fight';
        g.say(t('say.collectors.title'), t('say.collectors.mission'), 3);
      }
    } else if (m.phase === 'fight') {
      setMarker(g, g.markerRed, shop.x, shop.y);
      g.markerGold.visible = false;
      if (m.rivals.every((r) => r.state === 'down')) {
        for (const rival of m.rivals) removePed(g, rival);
        m.rivals = [];
        g.money += 120;
        g.earned += 120;
        g.events.push({ type: 'cash', amount: 120 });
        m.shopStep += 1;
        if (m.shopStep >= g.city.shops.length) {
          completeMission(g, 250, t('say.jobDone.mission2'));
        } else {
          m.phase = 'toShop';
          postCollectors(g);
          g.say(t('say.paidUp.title'), t('say.paidUp.sub'), 2.6);
        }
      }
    }
  } else if (m.index === 3) {
    // REPO JOB: fists at the curb, then the marked car to the warehouse.
    const car = m.targetCar;
    if (m.phase === 'toCar') {
      if (car) setMarker(g, g.markerGold, car.x, car.y);
      g.markerRed.visible = false;
      if (car && near(car.x, car.y, 60) && p.state === 'foot') {
        m.phase = 'repoFight';
        for (const rival of m.rivals) if (rival.state === 'idle') rival.state = 'fight';
        g.say(t('say.repoGuards.title'), t('say.repoGuards.sub'), 3);
      }
    } else if (m.phase === 'repoFight') {
      if (car) setMarker(g, g.markerRed, car.x, car.y);
      g.markerGold.visible = false;
      if (m.rivals.every((r) => r.state === 'down')) {
        for (const rival of m.rivals) removePed(g, rival);
        m.rivals = [];
        m.phase = 'repoSteal';
        g.say(t('say.repoClear.title'), t('say.repoClear.sub'), 3);
      }
    } else if (m.phase === 'repoSteal') {
      if (car) {
        setMarker(g, g.markerGold, car.x, car.y);
        // The objective car must survive until it is taken: if anything
        // wrecks it first, the job would soft-lock on an unenterable
        // wreck, so it quietly comes back whole.
        if (car.wrecked) {
          car.wrecked = false;
          car.hp = 200;
          syncCarMesh(car, 0);
        }
      }
      g.markerRed.visible = false;
      if (car && p.state === 'car' && p.car === car) {
        m.phase = 'repoDeliver';
        // The whole PD hears about this particular car the moment it rolls.
        scriptedHeat(g, 2);
        g.say(t('say.repoHot.title'), t('say.repoHot.sub'), 4);
      }
    } else if (m.phase === 'repoDeliver') {
      setMarker(g, g.markerGold, L.pier.x, L.pier.y);
      g.markerRed.visible = false;
      if (car && p.state === 'car' && p.car === car && near(L.pier.x, L.pier.y, 62)) {
        m.targetCar = null; // delivered: from here it is just a car in the world
        completeMission(g, 220, t('say.jobDone.mission3'));
      }
    }
  } else if (m.index === 4) {
    // COURIER HIT: stop the moving car, beat its crew, take the case.
    const car = m.courier;
    if (m.phase === 'intercept') {
      if (car) {
        driveCourier(g, car, dt);
        setMarker(g, g.markerGold, car.x, car.y);
      }
      g.markerRed.visible = false;
      const pinned = car && (car.stillT ?? 0) > 2.2 && near(car.x, car.y, 320);
      if (car && (car.wrecked || pinned)) {
        // The crew bails out swinging: two of Bruno-grade troublemakers
        // with more health and faster feet than the shop collectors.
        // (NPCs have no guns in Palmera — the combat system only arms
        // the player — so the escorts fight as elite fist fighters.)
        car.speed = 0;
        m.rivals = [
          spawnPed(g, { role: 'rival', x: car.x + 32, y: car.y + 20, hp: 150, chase: 208, punchRate: 0.7 }),
          spawnPed(g, { role: 'rival', x: car.x - 32, y: car.y - 20, hp: 150, chase: 208, punchRate: 0.7 }),
        ];
        for (const rival of m.rivals) rival.state = 'fight';
        m.phase = 'escortsFight';
        g.say(t('say.escorts.title'), t('say.escorts.sub'), 3.5);
      }
    } else if (m.phase === 'escortsFight') {
      if (car) setMarker(g, g.markerRed, car.x, car.y);
      g.markerGold.visible = false;
      if (m.rivals.every((r) => r.state === 'down')) {
        for (const rival of m.rivals) removePed(g, rival);
        m.rivals = [];
        m.phase = 'grabCase';
        g.say(t('say.escortsDown.title'), t('say.escortsDown.sub'), 3);
      }
    } else if (m.phase === 'grabCase') {
      if (car) setMarker(g, g.markerGold, car.x, car.y);
      g.markerRed.visible = false;
    } else if (m.phase === 'escapeHeat') {
      hideMarkers(g);
      if (g.stars === 0) {
        m.phase = 'returnBruno';
        g.say(t('say.clean.title'), t('say.clean.sub2'), 3.5);
      }
    } else if (m.phase === 'returnBruno') {
      setMarker(g, g.markerGold, L.diner.x, L.diner.y);
      g.markerRed.visible = false;
      if (near(L.diner.x, L.diner.y, 56)) {
        completeMission(g, 300, t('say.jobDone.mission4'));
      }
    }
  } else if (m.index === 5) {
    // WAREHOUSE RAID: the timed drive, two waves of fists, the crate,
    // and a hot escape — the whole toolbox in one job.
    if (m.phase === 'raidDrive') {
      setMarker(g, g.markerGold, L.pier.x, L.pier.y);
      g.markerRed.visible = false;
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
      setMarker(g, g.markerGold, L.pier.x, L.pier.y);
      g.markerRed.visible = false;
      if (near(L.pier.x, L.pier.y, 56) && p.state === 'foot') {
        m.phase = 'raidFightDoor';
        for (const rival of m.rivals) if (rival.state === 'idle') rival.state = 'fight';
        g.say(t('say.raidGuards.title'), t('say.raidGuards.sub'), 3);
      }
    } else if (m.phase === 'raidFightDoor') {
      setMarker(g, g.markerRed, L.pier.x, L.pier.y);
      g.markerGold.visible = false;
      if (m.rivals.every((r) => r.state === 'down')) {
        for (const rival of m.rivals) removePed(g, rival);
        // The yard crew becomes the fight: posted since accept time,
        // they only wake now that the door is clear.
        m.rivals = m.yardMen;
        m.yardMen = [];
        for (const rival of m.rivals) rival.state = 'fight';
        m.phase = 'raidFightYard';
        g.say(t('say.yard.title'), t('say.yard.sub'), 3);
      }
    } else if (m.phase === 'raidFightYard') {
      const spot = crateSpot(g);
      setMarker(g, g.markerRed, spot.x, spot.y);
      g.markerGold.visible = false;
      if (m.rivals.every((r) => r.state === 'down')) {
        for (const rival of m.rivals) removePed(g, rival);
        m.rivals = [];
        m.phase = 'grabCrate';
        g.say(t('say.yardDown.title'), t('say.yardDown.sub'), 3);
      }
    } else if (m.phase === 'grabCrate') {
      const spot = crateSpot(g);
      setMarker(g, g.markerGold, spot.x, spot.y);
      g.markerRed.visible = false;
    } else if (m.phase === 'raidEscapeCar') {
      hideMarkers(g);
      if (p.state === 'car') m.phase = 'loseLaw';
    } else if (m.phase === 'loseLaw') {
      hideMarkers(g);
      if (g.stars === 0) {
        m.phase = 'returnBruno';
        g.say(t('say.clean.title'), t('say.clean.sub2'), 3.5);
      }
    } else if (m.phase === 'returnBruno') {
      setMarker(g, g.markerGold, L.diner.x, L.diner.y);
      g.markerRed.visible = false;
      if (near(L.diner.x, L.diner.y, 56)) {
        const reward = 450 + (m.timeBonus ? RAID_TIME_BONUS : 0);
        completeMission(g, reward, t('say.jobDone.mission5'));
        // The finale gets its own moment over the JOB DONE banner:
        // the extended story is over, and Palmera knows it.
        g.say(t('say.storyComplete.title'), t('say.storyComplete.sub', { reward: `$${reward}` }), 6.5);
      }
    }
  }
}
