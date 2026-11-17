// The city of Palmera: a bright grid of avenues and streets with named landmark
// blocks (Bruno's Diner, the Spray 'n Go garage, Palmera PD, the hospital, the Ammo
// Hut, Club Neon, the pier warehouse), a park, a beach promenade, and plain city
// blocks filled with flat-coloured buildings. This module owns the map data and the
// collision helpers every moving thing uses; it draws nothing itself.
import { COLORS, ROAD, WORLD } from './config.js';

/** Y coordinate where the beach sand starts; south of the last street. */
export const BEACH_Y = 2240;

/** Block rectangles between the roads: {x, y, w, h} in world pixels. */
function blockRects() {
  const cols = [];
  let edge = 0;
  for (const avenue of ROAD.avenues) {
    cols.push([edge, avenue - ROAD.width / 2]);
    edge = avenue + ROAD.width / 2;
  }
  cols.push([edge, WORLD.width]);
  const rows = [];
  edge = 0;
  for (const street of ROAD.streets) {
    rows.push([edge, street - ROAD.width / 2]);
    edge = street + ROAD.width / 2;
  }
  rows.push([edge, WORLD.height]);
  const blocks = [];
  rows.forEach(([y0, y1], row) => {
    cols.forEach(([x0, x1], col) => {
      blocks.push({ col, row, x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    });
  });
  return blocks;
}

function building(x, y, w, h, rng, name = null) {
  const i = rng.int(0, COLORS.buildingRoofs.length - 1);
  return {
    x, y, w, h,
    height: rng.int(22, 58),
    roof: COLORS.buildingRoofs[i],
    wall: COLORS.buildingWalls[i],
    name,
  };
}

/** Fill one plain block with one, two or four buildings, leaving walkable alleys. */
function fillBlock(city, block, rng) {
  const pad = 16;
  const x = block.x + pad;
  const y = block.y + pad;
  const w = block.w - pad * 2;
  const h = block.h - pad * 2;
  if (w < 120 || h < 120) return;
  const style = rng.int(0, 2);
  if (style === 0) {
    city.buildings.push(building(x + 10, y + 10, w - 20, h - 20, rng));
  } else if (style === 1) {
    const gap = 30;
    const each = (w - gap) / 2;
    city.buildings.push(building(x, y + 8, each, h - 16, rng));
    city.buildings.push(building(x + each + gap, y + 8, each, h - 16, rng));
  } else {
    const gap = 28;
    const ew = (w - gap) / 2;
    const eh = (h - gap) / 2;
    city.buildings.push(building(x, y, ew, eh, rng));
    city.buildings.push(building(x + ew + gap, y, ew, eh, rng));
    city.buildings.push(building(x, y + eh + gap, ew, eh, rng));
    city.buildings.push(building(x + ew + gap, y + eh + gap, ew, eh, rng));
  }
}

/**
 * Build the whole city from the seeded rng. Landmark blocks are placed by hand so
 * the missions always have their diner, garage, station and warehouse; every other
 * block is procedural. Returns the city object the rest of the game reads.
 */
export function buildCity(rng) {
  const city = {
    buildings: [],
    trees: [],
    blocks: blockRects(),
    beachY: BEACH_Y,
    garageZone: { x: 2195, y: 430, w: 130, h: 190 },
    landmarks: {},
    shops: [],
  };
  const at = (col, row) => city.blocks.find((b) => b.col === col && b.row === row);

  // Hand-placed landmarks (name shown on the roof in render.js).
  const diner = at(3, 2);
  city.buildings.push(building(diner.x + 45, diner.y + 35, 240, 200, rng, "BRUNO'S DINER"));
  city.landmarks.diner = { x: diner.x + 165, y: diner.y + 300, doorX: diner.x + 165, doorY: diner.y + 245 };

  const club = at(4, 1);
  city.buildings.push(building(club.x + 45, club.y + 35, 240, 200, rng, 'CLUB NEON'));
  city.landmarks.club = { x: club.x + 300, y: club.y + 330 };

  const spray = at(5, 1);
  city.buildings.push(building(spray.x + 45, spray.y + 20, 240, 60, rng, "SPRAY 'N GO"));
  city.buildings.push(building(spray.x + 45, spray.y + 80, 50, 225, rng));
  city.buildings.push(building(spray.x + 235, spray.y + 80, 50, 225, rng));
  city.landmarks.spray = { x: spray.x + 165, y: spray.y + 190 };

  const pd = at(1, 3);
  city.buildings.push(building(pd.x + 45, pd.y + 35, 240, 200, rng, 'PALMERA PD'));
  city.landmarks.pd = { x: pd.x + 165, y: pd.y + 385 };

  const hospital = at(6, 3);
  city.buildings.push(building(hospital.x + 45, hospital.y + 35, 240, 200, rng, 'ST. PALM HOSPITAL'));
  city.landmarks.hospital = { x: hospital.x + 165, y: hospital.y + 385 };

  const ammo = at(2, 4);
  city.buildings.push(building(ammo.x + 45, ammo.y + 45, 240, 200, rng, 'AMMO HUT'));
  city.landmarks.ammo = { x: ammo.x + 165, y: ammo.y + 275 };

  const pier = at(7, 4);
  city.buildings.push(building(pier.x + 35, pier.y + 35, 320, 240, rng, 'PIER WAREHOUSE'));
  city.landmarks.pier = { x: pier.x + 195, y: pier.y + 335 };

  // The three shops Bruno sends you to in the rent-collection mission.
  const shopDefs = [
    { col: 1, row: 1, name: 'NOODLE BAR NUKI' },
    { col: 5, row: 3, name: 'PALMERA PAWN' },
    { col: 2, row: 0, name: 'SURF SHACK' },
  ];
  for (const def of shopDefs) {
    const block = at(def.col, def.row);
    const top = def.row === 0 ? 15 : 35;
    city.buildings.push(building(block.x + 45, block.y + top, 240, 180, rng, def.name));
    city.shops.push({ name: def.name, x: block.x + 165, y: block.y + top + 200 });
  }

  // The park block: lawns and round trees, no buildings.
  const park = at(4, 2);
  city.park = { x: park.x + 10, y: park.y + 10, w: park.w - 20, h: park.h - 20 };
  for (let i = 0; i < 9; i += 1) {
    city.trees.push({
      x: park.x + 50 + (i % 3) * 110 + rng.int(-14, 14),
      y: park.y + 55 + Math.floor(i / 3) * 105 + rng.int(-12, 12),
      r: rng.int(16, 24),
      kind: 'round',
    });
  }

  // Palms along the beach promenade and a few shade trees on random sidewalks.
  for (let x = 140; x < WORLD.width; x += 260) {
    city.trees.push({ x: x + rng.int(-30, 30), y: BEACH_Y + 60 + rng.int(-8, 8), r: 15, kind: 'palm' });
  }
  const landmarkBlocks = new Set(['3,2', '4,1', '5,1', '1,3', '6,3', '2,4', '7,4', '1,1', '5,3', '2,0', '4,2']);
  for (const block of city.blocks) {
    if (block.row === 5) continue; // the beach row stays open
    if (landmarkBlocks.has(`${block.col},${block.row}`)) continue;
    fillBlock(city, block, rng);
  }
  return city;
}

/** True when the point is on a road surface (avenue, street or intersection). */
export function isOnRoad(x, y) {
  const half = ROAD.width / 2;
  for (const avenue of ROAD.avenues) if (Math.abs(x - avenue) <= half) return true;
  for (const street of ROAD.streets) if (Math.abs(y - street) <= half) return true;
  return false;
}

/** The building whose footprint contains the point, or null. */
export function buildingAt(city, x, y) {
  for (const b of city.buildings) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
  }
  return null;
}

/**
 * Push a circle (entity with x/y) out of every building and tree it overlaps.
 * Returns true when a push happened, so callers can damp speed on impact.
 */
export function resolveCircleCollision(city, ent, radius) {
  let hit = false;
  for (const b of city.buildings) {
    const cx = Math.max(b.x, Math.min(ent.x, b.x + b.w));
    const cy = Math.max(b.y, Math.min(ent.y, b.y + b.h));
    let dx = ent.x - cx;
    let dy = ent.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= radius * radius) continue;
    hit = true;
    if (d2 > 0.0001) {
      const d = Math.sqrt(d2);
      ent.x = cx + (dx / d) * radius;
      ent.y = cy + (dy / d) * radius;
    } else {
      // Centre inside the building: leave by the nearest face.
      const left = ent.x - b.x;
      const right = b.x + b.w - ent.x;
      const top = ent.y - b.y;
      const bottom = b.y + b.h - ent.y;
      const min = Math.min(left, right, top, bottom);
      if (min === left) ent.x = b.x - radius;
      else if (min === right) ent.x = b.x + b.w + radius;
      else if (min === top) ent.y = b.y - radius;
      else ent.y = b.y + b.h + radius;
    }
  }
  for (const tree of city.trees) {
    const dx = ent.x - tree.x;
    const dy = ent.y - tree.y;
    const rr = radius + 7;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr || d2 < 0.0001) continue;
    const d = Math.sqrt(d2);
    ent.x = tree.x + (dx / d) * rr;
    ent.y = tree.y + (dy / d) * rr;
    hit = true;
  }
  return hit;
}

/** Clamp an entity inside the world bounds with a small margin. */
export function clampToWorld(ent, margin = 14) {
  ent.x = Math.max(margin, Math.min(WORLD.width - margin, ent.x));
  ent.y = Math.max(margin, Math.min(WORLD.height - margin, ent.y));
}

/** A random point on a random road, with the road's axis and centre line. */
export function randomRoadPoint(rng) {
  if (rng.chance(0.5)) {
    const road = rng.pick(ROAD.avenues);
    return { x: road, y: rng.range(80, WORLD.height - 80), axis: 'y', road };
  }
  const road = rng.pick(ROAD.streets);
  return { x: rng.range(80, WORLD.width - 80), y: road, axis: 'x', road };
}
