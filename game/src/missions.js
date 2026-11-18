// The story: three jobs for Bruno, the black stick figure who runs Bruno's Diner
// and half the errands in Palmera. Walk up to Bruno and press E to take the next
// job. Each mission drives a gold marker (red while someone has to be beaten),
// pays cash, and unlocks the next; the pistol arrives with the second job. Failing
// (busted or wasted) sends the player back to Bruno to try again.
import { HEAT_THRESHOLDS } from './config.js';
import { makeMarker } from './world3d.js';
import { removePed, spawnPed } from './people.js';
import { addHeat } from './police.js';

export const MISSION_TITLES = ['FIRST RUN', 'THE GETAWAY', 'COLLECTION DAY'];

const INTRO_LINES = [
  "Bruno: A package sits at the Pier Warehouse with my name on it. Bring it home.",
  "Bruno: Shade's in trouble at Club Neon. Pick him up, lose the law, drop him at the warehouse.",
  "Bruno: Three shops owe me protection money. Their new 'collectors' disagree. Persuade them.",
];

export function missionsInit(g) {
  g.mission = {
    index: Math.min(MISSION_TITLES.length, (g.saveData.missionsDone ?? []).length),
    active: false,
    phase: '',
    shopStep: 0,
    rivals: [],
    shade: null,
  };
  g.markerGold = makeMarker(0xffcf3f, '!');
  g.markerRed = makeMarker(0xff5a4d, '!');
  g.markerGold.visible = false;
  g.markerRed.visible = false;
  g.scene.add(g.markerGold, g.markerRed);
}

export function missionAvailable(g) {
  return !g.mission.active && g.mission.index < MISSION_TITLES.length;
}

function setMarker(g, marker, x, y) {
  marker.visible = true;
  marker.position.set(x, 0, y);
}

function hideMarkers(g) {
  g.markerGold.visible = false;
  g.markerRed.visible = false;
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
  } else {
    m.phase = 'toShop';
  }
  void L;
  g.say(MISSION_TITLES[m.index], INTRO_LINES[m.index], 5.5);
  g.events.push({ type: 'missionstart' });
}

/**
 * The current objective line for the HUD ('' when nothing is running). Every
 * step names its PLACE as well as its person — "come back for Shade" alone
 * left players asking who Shade is and where "back" is.
 */
export function objectiveText(g) {
  const m = g.mission;
  if (!m.active) {
    if (m.index >= MISSION_TITLES.length) return 'Free roam — Palmera is yours.';
    return "Talk to Bruno at Bruno's Diner (E) for work.";
  }
  const shop = g.city.shops[m.shopStep];
  const shopName = shop ? shop.name : 'the shop';
  switch (m.phase) {
    case 'toWarehouse': return 'Pick up the package at the Pier Warehouse.';
    case 'returnDiner': return "Bring the package back to Bruno's Diner.";
    case 'toClub': return 'Head to Club Neon and find Shade.';
    case 'getCar': return 'Get a car and come back for Shade at Club Neon.';
    case 'escape': return 'LOSE THE HEAT! Get the stars off your back.';
    case 'dropoff': return 'Drop Shade at the Pier Warehouse.';
    case 'toShop': return `Collect at ${shopName} — it owes Bruno. (${m.shopStep + 1}/3)`;
    case 'fight': return `Beat the collectors at ${shopName}!`;
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
    if (!missionAvailable(g)) return null;
    // Point at the man himself, not just his diner: while the "Talk to
    // Bruno" prompt is what the game wants, Bruno is the objective.
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
  g.say('JOB DONE', `${line}  +$${reward}`, 4.5);
  g.events.push({ type: 'missiondone' });
  m.index += 1;
}

/** The active mission collapses when the player is busted or wasted. */
export function failMission(g) {
  const m = g.mission;
  if (!m.active) return;
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
  g.say('JOB FAILED', 'Bruno still has the job, if you want it.', 3.5);
}

/** Shade climbed into the player's car (event from people.js). */
export function onBoarded(g) {
  const m = g.mission;
  if (!m.active || m.index !== 1 || m.phase !== 'getCar') return;
  m.phase = 'escape';
  const need = HEAT_THRESHOLDS[2] + 5 - g.heat;
  if (need > 0) addHeat(g, need, g.player.x, g.player.y, { force: true });
  g.say('SHADE IS IN!', 'Every cop in Palmera just heard. Lose the heat!', 4);
}

/** Arrival checks, fight checks and marker placement, once per frame. */
export function updateMissions(g, dt, time) {
  const m = g.mission;
  g.markerGold.userData.update(time);
  g.markerRed.userData.update(time);
  if (!m.active) {
    // No job running: the gold marker (and the minimap blip that follows
    // the same target) stands on Bruno himself, so the next job is always
    // findable — the talk prompt never points at an empty doorstep.
    if (missionAvailable(g) && g.bruno) {
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
        g.say('PACKAGE SECURED', 'Now get it back to Bruno.', 3);
        g.events.push({ type: 'pickup' });
      }
    } else if (m.phase === 'returnDiner') {
      setMarker(g, g.markerGold, L.diner.x, L.diner.y);
      if (near(L.diner.x, L.diner.y, 56)) {
        completeMission(g, 150, 'The package made it home.');
      }
    }
  } else if (m.index === 1) {
    if (m.phase === 'toClub') {
      setMarker(g, g.markerGold, L.club.x, L.club.y);
      g.markerRed.visible = false;
      if (near(L.club.x, L.club.y, 52) && p.state === 'foot') {
        m.shade = spawnPed(g, { role: 'shade', x: L.club.x + 24, y: L.club.y + 10, name: 'SHADE' });
        m.shade.fig.setExpression('angry');
        // Shade waits at the club door (like Bruno at the diner) instead of
        // wandering the sidewalk graph — "come back for Shade" needs him
        // findable in exactly one place.
        m.shade.state = 'idle';
        m.phase = 'getCar';
        g.say('SHADE', 'Bruno\'s getaway driver, one step ahead of the law. "Get us a car. Any car."', 4.5);
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
        g.say('CLEAN', 'Now drop Shade at the warehouse, quiet-like.', 3.5);
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
        completeMission(g, 300, 'Shade vanished into the warehouse.');
      }
    }
  } else if (m.index === 2) {
    const shop = g.city.shops[m.shopStep];
    if (m.phase === 'toShop') {
      setMarker(g, g.markerGold, shop.x, shop.y);
      g.markerRed.visible = false;
      if (near(shop.x, shop.y, 52) && p.state === 'foot') {
        m.phase = 'fight';
        m.rivals = [
          spawnPed(g, { role: 'rival', x: shop.x + 30, y: shop.y - 16, shopIndex: m.shopStep }),
          spawnPed(g, { role: 'rival', x: shop.x - 26, y: shop.y + 22, shopIndex: m.shopStep }),
        ];
        for (const rival of m.rivals) rival.state = 'fight';
        g.say('COLLECTORS', '"This turf has new management, stick."', 3);
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
          completeMission(g, 250, 'Every shop remembers who protects them.');
        } else {
          m.phase = 'toShop';
          g.say('PAID UP', 'One shop down. Keep moving.', 2.6);
        }
      }
    }
  }
  void dt;
}
