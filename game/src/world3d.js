// Palmera's visible city, assembled from the layout data in city.js. Buildings
// are plain boxes dressed in canvas-painted facades — window grids with frames,
// lit panes, storefronts and doors — capped by parapet slabs and rooftop props;
// around them sit painted road planes, pavements, a park, the beach and its
// pier, palms and street lamps. Flat bright colour throughout: a sunny
// diorama, never a photograph. Data coordinates (x, y) become (x, height, y).
import * as THREE from 'three';
import { COLORS, ROAD, WORLD } from './config.js';
import { toonMat, basicMat, toonGradient } from './stick3d.js';

/** Fill one rectangle on a 2D context with the given style. */
function paint(ctx, style, x, y, w, h) {
  ctx.fillStyle = style;
  ctx.fillRect(x, y, w, h);
}

/**
 * A floating label sprite (landmark names, marker captions). The text is
 * measured on a throwaway context first so the canvas hugs it exactly, then
 * painted with a dark outline pass under the coloured fill.
 */
export function makeTextSprite(text, { size = 46, color = '#ffffff', scale = 1 } = {}) {
  const pad = 18;
  const font = `bold ${size}px system-ui, sans-serif`;
  const scratch = document.createElement('canvas').getContext('2d');
  scratch.font = font;
  const w = Math.ceil(scratch.measureText(text).width) + pad * 2;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = size + pad * 2;
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 9;
  ctx.strokeStyle = 'rgba(18,18,28,0.72)';
  ctx.strokeText(text, w / 2, canvas.height / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 2;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  const height = 34 * scale;
  sprite.scale.set(height * (w / canvas.height), height, 1);
  return sprite;
}

/** Road paint: asphalt, pale edge lines and one dashed centre line per tile. */
function roadTexture(rotated) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  paint(ctx, COLORS.road, 0, 0, 128, 256);
  paint(ctx, COLORS.roadLine, 4, 0, 4, 256);
  paint(ctx, COLORS.roadLine, 120, 0, 4, 256);
  paint(ctx, COLORS.roadLine, 61, 18, 6, 92);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  if (rotated) {
    tex.center.set(0.5, 0.5);
    tex.rotation = Math.PI / 2;
  }
  return tex;
}

/**
 * A plain asphalt tile for the crossing squares. The road planes sample their
 * surface from a canvas map as linear data, so a flat material of the same
 * declared hex renders markedly darker — crossings painted that way read as
 * puddles. Routing the square through an identical canvas fill makes both
 * surfaces take the same path and merge exactly.
 */
function asphaltTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 4;
  paint(canvas.getContext('2d'), COLORS.road, 0, 0, 4, 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** A plane mesh lying flat on the ground, sized w by h. */
function groundPlane(w, h, material) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

/** Deterministic 0..1 hash of a number: facades are stable between runs. */
function hash01(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** A hex colour scaled by factor f (1 = unchanged), returned as a hex string. */
function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.r = Math.min(1, c.r * f);
  c.g = Math.min(1, c.g * f);
  c.b = Math.min(1, c.b * f);
  return `#${c.getHexString()}`;
}

/** Flat roof tones a parapet cap may wear besides the building's own colour. */
const ROOF_TONES = ['#8d7d6b', '#a1887f', '#7d8a96', '#b08968', '#6f7d7a', '#96826f'];
const GLASS_TONES = ['#bfe3f2', '#8fc3dd', '#5d84a0', '#3c5a68'];

/**
 * Paint one building face: wall wash with a faint per-building tint, striped
 * bay rhythm, a window grid (frames, lit panes, sky-reflecting panes), floor
 * separators, and a ground floor — glazed storefront with a sign band for
 * named buildings, larger windows and a door for plain ones. Produces a
 * colour map plus a glow map that is black except for the lit panes.
 * faceWidth is the face's width in world units.
 */
function facadeTextures(b, faceWidth, hgt, salt) {
  const S = 192;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = S;
  glowCanvas.height = S;
  const glow = glowCanvas.getContext('2d');
  paint(glow, '#000000', 0, 0, S, S);

  // b.roof is the bright facade colour the building already wears; b.wall is
  // its deeper partner, used for frames, bands and the parapet.
  const wallTone = b.roof;
  const trimTone = b.wall;
  const seedBase = b.x * 3.7 + b.y * 9.1 + salt * 57.3;
  const pick = (k) => hash01(seedBase + k * 13.73);

  const floors = Math.max(2, Math.min(5, Math.round(hgt / 27)));
  const groundFrac = Math.max(0.24, Math.min(0.44, 34 / hgt));
  const groundH = S * groundFrac;
  const upperH = S - groundH;
  const bandH = upperH / (floors - 1);
  const cols = Math.max(2, Math.min(8, Math.round(faceWidth / 30)));
  const cellW = S / cols;
  const frameTone = shade(trimTone, 0.72);

  /** One framed pane at (x, y); roll k decides lit versus sky glass. */
  function pane(x, y, w, h, k) {
    paint(ctx, frameTone, x - 2.5, y - 2.5, w + 5, h + 5);
    const r = pick(k);
    if (r < 0.30) {
      ctx.fillStyle = '#ffd98c'; // lit from inside
      paint(glow, '#ffbe78', x, y, w, h);
    } else {
      ctx.fillStyle = GLASS_TONES[Math.floor(pick(k + 40) * GLASS_TONES.length)];
    }
    ctx.fillRect(x, y, w, h);
    paint(ctx, 'rgba(255,255,255,0.20)', x, y, w, 2.5); // sill highlight
    if (w > 15) paint(ctx, 'rgba(0,0,0,0.22)', x + w / 2 - 1, y, 2, h); // mullion
  }

  function wash() {
    paint(ctx, wallTone, 0, 0, S, S);
    // A whisper of per-building tint variation.
    paint(ctx, pick(1) > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)', 0, 0, S, S);
    // Vertical bay striping behind the windows.
    for (let c = 0; c < cols; c += 1) {
      if (c % 2 === 0) continue;
      paint(ctx, 'rgba(0,0,0,0.055)', c * cellW, 0, cellW, S);
    }
    // Cornice line under the roof and a separator at every floor.
    paint(ctx, 'rgba(0,0,0,0.20)', 0, 0, S, 5);
    ctx.fillStyle = 'rgba(0,0,0,0.13)';
    for (let f = 1; f < floors - 1; f += 1) ctx.fillRect(0, f * bandH, S, 3);
    ctx.fillRect(0, upperH, S, 4);
  }

  function upperStoreys() {
    for (let f = 0; f < floors - 1; f += 1) {
      const bandY = f * bandH;
      const wh = bandH * 0.52;
      const wy = bandY + (bandH - wh) / 2;
      for (let c = 0; c < cols; c += 1) {
        if (pick(f * 31 + c * 7) < 0.07) continue; // the odd blank bay
        const ww = cellW * 0.5;
        pane(c * cellW + (cellW - ww) / 2, wy, ww, wh, f * 100 + c);
      }
    }
  }

  function storefront(gy) {
    const signH = groundH * 0.30;
    paint(ctx, shade(trimTone, 0.82), 0, gy, S, signH);
    paint(ctx, 'rgba(255,255,255,0.75)', 0, gy + signH - 4, S, 2.5);
    const panels = Math.max(2, Math.round(faceWidth / 46));
    const pw = S / panels;
    const doorAt = Math.floor(pick(77) * panels);
    for (let p = 0; p < panels; p += 1) {
      const px = p * pw + 4;
      const py = gy + signH + 5;
      const pwid = pw - 8;
      const ph = groundH - signH - 9;
      paint(ctx, frameTone, px - 2, py - 2, pwid + 4, ph + 4);
      if (p === doorAt) {
        paint(ctx, shade(trimTone, 1.05), px, py, pwid, ph);
        paint(ctx, '#ffd98c', px + pwid - 8, py + ph * 0.45, 4, 4); // handle
        paint(glow, '#7a5a30', px + pwid - 8, py + ph * 0.45, 4, 4);
      } else {
        const litPanel = pick(p + 90) < 0.35;
        paint(ctx, litPanel ? '#ffd98c' : '#a8d4ea', px, py, pwid, ph);
        if (litPanel) paint(glow, '#e8a95e', px, py, pwid, ph);
        paint(ctx, 'rgba(255,255,255,0.25)', px, py, pwid, 4);
      }
    }
  }

  function plainGround(gy) {
    const doorCol = faceWidth >= 90 ? Math.floor(pick(78) * cols) : -1;
    for (let c = 0; c < cols; c += 1) {
      const cx = c * cellW;
      if (c === doorCol) {
        const dw = cellW * 0.52;
        const dx = cx + (cellW - dw) / 2;
        paint(ctx, frameTone, dx - 2.5, gy + 5, dw + 5, groundH - 5);
        paint(ctx, shade(trimTone, 1.1), dx, gy + 7, dw, groundH - 7);
        paint(ctx, '#ffd98c', dx + dw - 7, gy + groundH * 0.5, 3.5, 3.5);
      } else {
        const ww = cellW * 0.58;
        const wh = groundH * 0.55;
        pane(cx + (cellW - ww) / 2, gy + (groundH - wh) / 2, ww, wh, 500 + c);
      }
    }
  }

  wash();
  upperStoreys();
  const gy = upperH;
  paint(ctx, 'rgba(0,0,0,0.10)', 0, gy, S, groundH);
  if (b.name) storefront(gy); else plainGround(gy);
  paint(ctx, 'rgba(0,0,0,0.22)', 0, S - 4, S, 4); // plinth line at the pavement

  const map = new THREE.CanvasTexture(canvas);
  map.anisotropy = 4;
  return { map, glow: new THREE.CanvasTexture(glowCanvas) };
}

/** The compass side ('n'|'s'|'e'|'w') of a building facing its nearest road. */
function frontDir(b) {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  let bestD = Infinity;
  let bestDir = 's';
  for (const a of ROAD.avenues) {
    const d = Math.abs(cx - a);
    if (d < bestD) { bestD = d; bestDir = cx < a ? 'e' : 'w'; }
  }
  for (const s of ROAD.streets) {
    const d = Math.abs(cy - s);
    if (d < bestD) { bestD = d; bestDir = cy < s ? 's' : 'n'; }
  }
  return bestDir;
}

/** Striped awning materials, cached one per trim colour. */
const awningCache = new Map();
function awningMaterial(trimHex) {
  let mat = awningCache.get(trimHex);
  if (!mat) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < 8; i += 1) paint(ctx, i % 2 === 0 ? '#f7f3df' : trimHex, i * 8, 0, 8, 16);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.set(3, 1);
    mat = new THREE.MeshToonMaterial({ map: tex, gradientMap: toonGradient() });
    awningCache.set(trimHex, mat);
  }
  return mat;
}

/**
 * Build the whole visible city into the scene. Returns { group, windowMats };
 * windowMats collects every facade material so the day/night cycle can drive
 * their emissive intensity.
 */
export function buildWorld(scene, city) {
  const group = new THREE.Group();
  scene.add(group);
  scene.background = new THREE.Color(COLORS.sky);
  scene.fog = new THREE.Fog(new THREE.Color(COLORS.sky), 1000, 2600);

  // Placeholder lights: gfx.js owns the real sun and dome, but the scene
  // graph carries these two (kept invisible) from the start.
  const hemi = new THREE.HemisphereLight(0xcfeeff, 0x9a8a5f, 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
  sun.position.set(900, 1500, 500);
  scene.add(sun);
  hemi.visible = false;
  sun.visible = false;
  // Touch the gradient so toon materials compile with it from the first frame.
  toonGradient();

  const windowMats = [];
  layGrounds(group, city);
  layRoads(group);
  for (const b of city.buildings) raiseBuilding(group, b, windowMats);
  buildGarage(group, city);
  buildMotorsLot(group, city);
  buildBooth(group, city);
  buildSafehouseLamp(group, city);
  plantTrees(group, city);
  plantLamps(group);
  return { group, windowMats };
}

/**
 * Base ground, block pavements, park and beach sand. The flat layers sit on
 * a spread ladder of heights (steps of ~0.14 or more): planes stacked within
 * a few hundredths of a unit z-fight at city viewing distances, so no two
 * overlapping surfaces may sit closer than that.
 */
function layGrounds(group, city) {
  const base = groundPlane(WORLD.width + 500, WORLD.height + 500, toonMat(0xb9c98d));
  base.position.set(WORLD.width / 2, -0.3, WORLD.height / 2);
  base.receiveShadow = true;
  group.add(base);

  const sidewalkMat = toonMat(0xe8e2d0);
  for (const block of city.blocks) {
    if (block.row === 5) continue;
    const p = groundPlane(block.w, block.h, sidewalkMat);
    p.position.set(block.x + block.w / 2, 0, block.y + block.h / 2);
    p.receiveShadow = true;
    group.add(p);
  }
  if (city.park) {
    const p = groundPlane(city.park.w, city.park.h, toonMat(0x8fce6e));
    p.position.set(city.park.x + city.park.w / 2, 0.14, city.park.y + city.park.h / 2);
    p.receiveShadow = true;
    group.add(p);
  }
  // Beach sand; the sea itself is built and animated by gfx.js.
  const sand = groundPlane(WORLD.width, WORLD.height - city.beachY, toonMat(0xf2ddab));
  sand.position.set(WORLD.width / 2, 0.14, (city.beachY + WORLD.height) / 2);
  sand.receiveShadow = true;
  group.add(sand);
  buildPier(group);
}

/** The pier: a wooden jetty on pilings reaching into the sea by the warehouse. */
function buildPier(group) {
  const deck = new THREE.Mesh(new THREE.BoxGeometry(84, 5, 430), toonMat(0xa97c50));
  deck.position.set(3085, 2.5, WORLD.height - 190);
  group.add(deck);
  // Pilings under the deck: without them the jetty reads as a plank lying on
  // the sand instead of a pier standing in the water.
  const pilingMat = toonMat(0x6b4c33);
  for (let pz = WORLD.height - 380; pz <= WORLD.height - 20; pz += 72) {
    for (const px of [3085 - 32, 3085 + 32]) {
      const pile = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, 34, 6), pilingMat);
      pile.position.set(px, -14, pz);
      group.add(pile);
    }
  }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 420), toonMat(0x8a6242));
  rail.position.set(3085 + 41, 7, WORLD.height - 190);
  group.add(rail);
}

/**
 * Roads: one textured plane per avenue and street, plain squares on the
 * crossings. Avenues and streets share one level and the crossing squares
 * sit a clear step above both (they used to be 0.01 apart, all three
 * coplanar at the crossings, and the whole square flickered); polygonOffset
 * on the road materials is a second line of defence.
 */
function layRoads(group) {
  const vTex = roadTexture(false);
  vTex.repeat.set(1, WORLD.height / 256);
  const vRoadMat = new THREE.MeshToonMaterial({ map: vTex, gradientMap: toonGradient(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  for (const avenue of ROAD.avenues) {
    const p = groundPlane(ROAD.width, WORLD.height, vRoadMat);
    p.position.set(avenue, 0.28, WORLD.height / 2);
    p.receiveShadow = true;
    group.add(p);
  }
  const hTex = roadTexture(true);
  hTex.repeat.set(1, WORLD.width / 256);
  const hRoadMat = new THREE.MeshToonMaterial({ map: hTex, gradientMap: toonGradient(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  for (const street of ROAD.streets) {
    const p = groundPlane(WORLD.width, ROAD.width, hRoadMat);
    p.position.set(WORLD.width / 2, 0.28, street);
    p.receiveShadow = true;
    group.add(p);
  }
  const crossingMat = new THREE.MeshToonMaterial({
    map: asphaltTexture(),
    gradientMap: toonGradient(),
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  for (const avenue of ROAD.avenues) {
    for (const street of ROAD.streets) {
      const p = groundPlane(ROAD.width, ROAD.width, crossingMat);
      p.position.set(avenue, 0.42, street);
      p.receiveShadow = true;
      group.add(p);
    }
  }
}

const ROOF_MATS = ROOF_TONES.map((t) => toonMat(new THREE.Color(t).getHex()));
const AC_MAT = () => toonMat(0xcfd4d8);

/**
 * One building: a box wearing painted canvas facades, a parapet slab, a
 * varied flat roof deck, hash-picked rooftop props, a fire escape on a few
 * tall plain blocks, and — for named landmarks — a striped awning, an
 * entrance step and a floating name sprite. Footprints are unchanged, so
 * the collision data in city.js still matches what is drawn.
 */
function raiseBuilding(group, b, windowMats) {
  const acMat = AC_MAT();
  const acTopMat = toonMat(0x9aa1a6);
  const towerMat = toonMat(0xa97c50);
  const towerRoofMat = toonMat(0x707880);
  const metalMat = toonMat(0x3a3f46);
  const stepMat = toonMat(0xcac2ae);

  const hgt = b.height * 1.9;
  const cx = b.x + b.w / 2;
  const cz = b.y + b.h / 2;
  const seed = b.x * 3.7 + b.y * 9.1;
  const wide = facadeTextures(b, b.w, hgt, 1);
  const narrow = facadeTextures(b, b.h, hgt, 2);
  const faceMat = (t) => new THREE.MeshToonMaterial({
    map: t.map, emissiveMap: t.glow, emissive: 0xffc98a, emissiveIntensity: 0.55,
    gradientMap: toonGradient(),
  });
  const roofMat = hash01(seed + 5) < 0.55
    ? ROOF_MATS[Math.floor(hash01(seed + 6) * ROOF_MATS.length)]
    : toonMat(new THREE.Color(b.wall).getHex());
  const narrowMat = faceMat(narrow);
  const wideMat = faceMat(wide);
  windowMats.push(wideMat, narrowMat);

  // The box stops 0.4 short of the full height so its top face is not
  // exactly coplanar with the parapet slab's underside.
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(b.w, hgt - 0.4, b.h),
    [narrowMat, narrowMat, roofMat, roofMat, wideMat, wideMat],
  );
  box.position.set(cx, (hgt - 0.4) / 2, cz);
  box.castShadow = true;
  group.add(box);
  // Parapet: the familiar cap slab, in the building's trim colour, with a
  // slightly inset roof deck on top wearing a varied flat roof tone.
  const slab = new THREE.Mesh(new THREE.BoxGeometry(b.w + 6, 5, b.h + 6), toonMat(new THREE.Color(b.wall).getHex()));
  slab.position.set(cx, hgt + 2.5, cz);
  group.add(slab);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(Math.max(10, b.w - 12), 2, Math.max(10, b.h - 12)), roofMat);
  deck.position.set(cx, hgt + 6, cz);
  group.add(deck);

  raiseRoofProps(group, b, { cx, cz, hgt, seed, acMat, acTopMat, towerMat, towerRoofMat });
  if (!b.name && hgt >= 74 && hash01(seed + 21) < 0.30) {
    raiseFireEscape(group, b, { cz, hgt, metalMat });
  }
  if (b.name) dressLandmark(group, b, { cx, cz, hgt, stepMat });
}

/**
 * Rooftop props, hash-picked: a water tower on some tall blocks, an AC unit
 * or a vent pipe on others. They sit on the roof deck (top hgt+7). Props
 * sink a few tenths into the deck/unit below them: faces resting exactly on
 * a surface are coplanar and can shimmer at glancing angles.
 */
function raiseRoofProps(group, b, env) {
  const { cx, cz, hgt, seed } = env;
  const propR = hash01(seed + 11);
  const offX = (hash01(seed + 12) - 0.5) * Math.max(0, b.w - 44);
  const offZ = (hash01(seed + 13) - 0.5) * Math.max(0, b.h - 44);
  if (hgt > 62 && propR < 0.30) {
    const tower = new THREE.Group();
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 7.5, 13, 10), env.towerMat);
    tank.position.y = 12.5;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(9, 6, 10), env.towerRoofMat);
    cone.position.y = 22;
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.8, 6, 8), toonMat(0x3a3f46));
    stand.position.y = 3;
    tower.add(tank, cone, stand);
    tower.position.set(cx + offX, hgt + 6.7, cz + offZ);
    group.add(tower);
  } else if (propR < 0.62) {
    const ac = new THREE.Mesh(new THREE.BoxGeometry(15, 7, 11), env.acMat);
    ac.position.set(cx + offX, hgt + 10.3, cz + offZ);
    const acTop = new THREE.Mesh(new THREE.BoxGeometry(11, 1.8, 8), env.acTopMat);
    acTop.position.set(cx + offX, hgt + 14.5, cz + offZ);
    group.add(ac, acTop);
  } else if (propR < 0.78) {
    const vent = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 7, 8), env.acTopMat);
    vent.position.set(cx + offX, hgt + 10.2, cz + offZ);
    group.add(vent);
  }
}

/**
 * Fire escape on the east face: stacked platforms joined by diagonal stairs,
 * in dark metal. The lowest platform sits above the collision push-out
 * distance, so nobody clips it at street level. Platforms sink 0.4 into the
 * wall: a face exactly flush with the facade plane is coplanar and flickers.
 */
function raiseFireEscape(group, b, env) {
  const { cz, hgt, metalMat } = env;
  const floors = Math.max(2, Math.min(5, Math.round(hgt / 27)));
  const platW = Math.min(b.h * 0.5, 64);
  const platGeo = new THREE.BoxGeometry(7, 1.6, platW);
  let prev = null;
  for (let f = 1; f < floors; f += 1) {
    const py = f * 27 - 5;
    const plat = new THREE.Mesh(platGeo, metalMat);
    plat.position.set(b.x + b.w + 3.1, py, cz + (f % 2 === 0 ? -platW / 4 : platW / 4));
    group.add(plat);
    if (prev) {
      const dz = plat.position.z - prev.position.z;
      const dy = py - prev.position.y;
      const len = Math.hypot(dz, dy);
      const stair = new THREE.Mesh(new THREE.BoxGeometry(5, 1.2, len), metalMat);
      stair.position.set(b.x + b.w + 3.1, (py + prev.position.y) / 2, (plat.position.z + prev.position.z) / 2);
      stair.rotation.x = -Math.atan2(dy, dz);
      group.add(stair);
    }
    prev = { position: plat.position, y: py };
  }
}

/**
 * Landmark dressing: a striped awning over the storefront on the face toward
 * the nearest road, a shallow entrance step below it, and the name sprite.
 */
function dressLandmark(group, b, env) {
  const { cx, cz, hgt, stepMat } = env;
  const dir = frontDir(b);
  const out = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[dir];
  const faceLen = dir === 'n' || dir === 's' ? b.w : b.h;
  const faceDist = dir === 'n' || dir === 's' ? b.h / 2 : b.w / 2;
  const awnLen = Math.min(faceLen * 0.62, 120);
  // A yawed group whose local +z points out of the facade; inside it the
  // awning slab tilts down away from the wall.
  const awnGroup = new THREE.Group();
  awnGroup.position.set(cx + out[0] * faceDist, 35, cz + out[1] * faceDist);
  awnGroup.rotation.y = Math.atan2(out[0], out[1]);
  const awning = new THREE.Mesh(new THREE.BoxGeometry(awnLen, 1.7, 11), awningMaterial(b.wall));
  awning.position.z = 4.6;
  awning.rotation.x = 0.42;
  awnGroup.add(awning);
  group.add(awnGroup);
  const step = new THREE.Mesh(new THREE.BoxGeometry(30, 1.6, 7), stepMat);
  step.position.set(
    cx + out[0] * ((dir === 'e' || dir === 'w' ? b.w / 2 : 0) + 2.6),
    0.8,
    cz + out[1] * ((dir === 'n' || dir === 's' ? b.h / 2 : 0) + 2.6),
  );
  if (dir === 'e' || dir === 'w') step.rotation.y = Math.PI / 2;
  group.add(step);
  const label = makeTextSprite(b.name, { size: 40, scale: 0.9 });
  label.position.set(cx, hgt + 30, cz);
  group.add(label);
}

/** The Spray 'n Go carport over the garage zone: posts and a roof, open sides. */
function buildGarage(group, city) {
  const zone = city.garageZone;
  const postMat = toonMat(0xdadada);
  const corners = [
    [zone.x + 4, zone.y + 4],
    [zone.x + zone.w - 4, zone.y + 4],
    [zone.x + 4, zone.y + zone.h - 4],
    [zone.x + zone.w - 4, zone.y + zone.h - 4],
  ];
  for (const [px, pz] of corners) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 34, 8), postMat);
    post.position.set(px, 17, pz);
    group.add(post);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(zone.w + 26, 5, zone.h + 26), toonMat(0x37b24d));
  roof.position.set(zone.x + zone.w / 2, 35, zone.y + zone.h / 2);
  group.add(roof);
  const padMat = new THREE.MeshToonMaterial({
    color: 0xc9c9c9, gradientMap: toonGradient(),
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  const pad = groundPlane(zone.w + 16, zone.h + 16, padMat);
  pad.position.set(zone.x + zone.w / 2, 0.56, zone.y + zone.h / 2);
  group.add(pad);
}

/**
 * PALMERA MOTORS: three painted bays under a slim canopy. Posts stand at the
 * four corners of the roof so it reads as a carport, never as a slab hovering
 * over the lot (it is in frame in the pier mission shot).
 */
function buildMotorsLot(group, city) {
  const lot = city.motorsLot || [];
  if (!lot.length) return;
  const bayMat = basicMat(0xf7f3df);
  for (const spot of lot) {
    for (const side of [-30, 30]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(3, 0.6, 70), bayMat);
      line.position.set(spot.x + side, 0.72, spot.y - 24);
      group.add(line);
    }
  }
  const midX = (lot[0].x + lot[lot.length - 1].x) / 2;
  const midZ = lot[0].y - 20;
  const pad = groundPlane(330, 110, new THREE.MeshToonMaterial({
    color: 0xb9bcc2, gradientMap: toonGradient(),
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  }));
  pad.position.set(midX, 0.58, midZ);
  pad.receiveShadow = true;
  group.add(pad);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(300, 4, 92), toonMat(0xdcdfe3));
  roof.position.set(midX, 45, midZ);
  roof.castShadow = true;
  group.add(roof);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(306, 1.6, 98), toonMat(0x9aa1a6));
  trim.position.set(midX, 42.4, midZ);
  group.add(trim);
  const postMat = toonMat(0xc9ced6);
  for (const px of [midX - 142, midX + 142]) {
    for (const pz of [midZ - 40, midZ + 40]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.3, 45, 8), postMat);
      post.position.set(px, 22.5, pz);
      post.castShadow = true;
      group.add(post);
    }
  }
}

/**
 * The fixer's phone booth on the PD corner: a dark box with a lit front, so
 * the one paid way out of a wanted level is findable at night.
 */
function buildBooth(group, city) {
  const spot = city.landmarks.fixer;
  if (!spot) return;
  const booth = new THREE.Mesh(new THREE.BoxGeometry(20, 46, 20), toonMat(0x2c3f5e));
  booth.position.set(spot.x, 23, spot.y);
  group.add(booth);
  const pane = new THREE.Mesh(new THREE.BoxGeometry(14, 28, 0.6), basicMat(0xffe9a8));
  pane.position.set(spot.x, 25, spot.y - 10.2);
  group.add(pane);
  const signBox = new THREE.Mesh(new THREE.BoxGeometry(26, 7, 4), basicMat(0xffd94d));
  signBox.position.set(spot.x, 49, spot.y - 8);
  group.add(signBox);
  const glow = new THREE.PointLight(0xffd98b, 1.1, 140);
  glow.position.set(spot.x, 30, spot.y - 22);
  group.add(glow);
}

/** The safehouse door: one warm lamp over the step, so "home" reads at night. */
function buildSafehouseLamp(group, city) {
  const spot = city.landmarks.safehouse;
  if (!spot) return;
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(3.4, 8, 6), basicMat(0xffe9b0));
  lamp.position.set(spot.x, 34, spot.y - 8);
  group.add(lamp);
  const halo = new THREE.PointLight(0xffd98b, 0.9, 120);
  halo.position.set(spot.x, 30, spot.y - 18);
  group.add(halo);
}

/** Trees and palms from the layout: a trunk and an icosahedron crown each. */
function plantTrees(group, city) {
  const trunkMat = toonMat(0x8a5a33);
  const leafMat = toonMat(0x4da653);
  const palmMat = toonMat(0x63c174);
  for (const tree of city.trees) {
    const palm = tree.kind === 'palm';
    const trunkH = palm ? 21 : 11;
    const t = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.6, trunkH, 7), trunkMat);
    trunk.position.y = trunkH / 2;
    if (palm) trunk.rotation.z = 0.13;
    t.add(trunk);
    const crown = new THREE.Mesh(
      new THREE.IcosahedronGeometry(tree.r * 0.95, 0),
      palm ? palmMat : leafMat,
    );
    crown.position.set(palm ? 2.6 : 0, trunkH + tree.r * 0.5, 0);
    crown.scale.y = palm ? 0.55 : 0.85;
    t.add(crown);
    t.position.set(tree.x, 0, tree.y);
    group.add(t);
  }
}

/** Street lamps at every other intersection corner. */
function plantLamps(group) {
  const lampMat = toonMat(0x6b7280);
  const bulbMat = basicMat(0xfff3b0);
  ROAD.avenues.forEach((avenue, i) => {
    ROAD.streets.forEach((street, j) => {
      if ((i + j) % 2 !== 0) return;
      const lamp = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.6, 30, 6), lampMat);
      pole.position.y = 15;
      lamp.add(pole);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(3.1, 10, 8), bulbMat);
      bulb.position.y = 30.5;
      lamp.add(bulb);
      lamp.position.set(avenue + 62, 0, street + 62);
      group.add(lamp);
    });
  });
}

/**
 * A mission marker: a translucent beam of light with a bobbing label sprite.
 * The owner positions the group and toggles visibility; update spins it
 * gently. The options exist for the secondary diner marker: a shorter column
 * in its own colour so it can never be mistaken for the objective. Defaults
 * are exactly the objective marker's dimensions.
 */
export function makeMarker(colorHex = 0xffcf3f, label = '!', { height = 110, spriteColor = '#ffd94d', spriteScale = 1.15 } = {}) {
  const group = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(15, 15, height, 18, 1, true),
    new THREE.MeshBasicMaterial({
      color: colorHex, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  beam.position.y = height / 2;
  group.add(beam);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(15, 22),
    new THREE.MeshBasicMaterial({
      color: colorHex, transparent: true, opacity: 0.5, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.95;
  group.add(disc);
  const spriteY = height + 12;
  const sprite = makeTextSprite(label, { size: 64, color: spriteColor, scale: spriteScale });
  sprite.position.y = spriteY;
  group.add(sprite);
  group.userData.update = (time) => {
    beam.rotation.y = time * 0.8;
    sprite.position.y = spriteY + Math.sin(time * 2.2) * 5;
  };
  return group;
}

/** A little stack of cash bills that spins and bobs: the money pickup visual. */
export function makeCashPickup() {
  const group = new THREE.Group();
  const bill = new THREE.Mesh(new THREE.BoxGeometry(13, 2.2, 7), toonMat(0x51cf66));
  bill.position.y = 7;
  const band = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.6, 7.4), basicMat(0xf8f0c9));
  band.position.y = 7;
  group.add(bill, band);
  group.userData.update = (time, seed) => {
    group.rotation.y = time * 2.4 + seed;
    const bobY = 7 + Math.sin(time * 3 + seed) * 1.6;
    bill.position.y = bobY;
    band.position.y = bobY;
  };
  return group;
}
