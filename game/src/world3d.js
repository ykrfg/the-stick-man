// The 3D city of Palmera, built from the data in city.js: toon-shaded buildings
// whose facades are painted on canvas (window grids with frames and lit panes,
// ground-floor storefronts, doors), with parapet roofs, rooftop props, awnings
// on the landmarks and a few fire escapes; dark road planes with painted dashes,
// sidewalks, a park, a beach with a pier, palms and lamps. Everything is
// procedural in bright flat colours — a sunny diorama, never realistic.
// World data coordinates (x, y) map to 3D as (x, height, y).
import * as THREE from 'three';
import { COLORS, ROAD, WORLD } from './config.js';
import { toonMat, basicMat, toonGradient } from './stick3d.js';

/** A floating text sprite (landmark names, marker labels), drawn on a canvas. */
export function makeTextSprite(text, { size = 46, color = '#ffffff', scale = 1 } = {}) {
  const pad = 18;
  const canvas = document.createElement('canvas');
  const probe = canvas.getContext('2d');
  probe.font = `bold ${size}px system-ui, sans-serif`;
  const w = Math.ceil(probe.measureText(text).width) + pad * 2;
  canvas.width = w;
  canvas.height = size + pad * 2;
  const ctx = canvas.getContext('2d');
  ctx.font = `bold ${size}px system-ui, sans-serif`;
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

/** Road surface texture: asphalt with edge lines and a dashed centre line. */
function makeRoadTexture(horizontal) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = COLORS.road;
  ctx.fillRect(0, 0, 128, 256);
  ctx.fillStyle = COLORS.roadLine;
  ctx.fillRect(4, 0, 4, 256);
  ctx.fillRect(120, 0, 4, 256);
  ctx.fillRect(61, 18, 6, 92); // one dash per tile
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  if (horizontal) {
    tex.center.set(0.5, 0.5);
    tex.rotation = Math.PI / 2;
  }
  return tex;
}

/**
 * A plain asphalt tile for the crossing squares. The avenue/street
 * planes draw their surface from a canvas map; those canvas pixels are
 * sampled as linear data here (the project's textures are not tagged
 * sRGB), so a FLAT toon material of the same declared hex renders
 * markedly darker than the road around it — the crossings read as
 * puddles. Using a map with the identical fill makes both surfaces go
 * through the same path, so the square merges with the road exactly.
 */
function makeAsphaltTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 4;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = COLORS.road;
  ctx.fillRect(0, 0, 4, 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function flatPlane(w, h, material) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

/** Deterministic 0..1 hash from a number, so facades are stable between runs. */
function hash01(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** A THREE.Color shade of a hex string, scaled by f (1 = unchanged). */
function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.r = Math.min(1, c.r * f);
  c.g = Math.min(1, c.g * f);
  c.b = Math.min(1, c.b * f);
  return `#${c.getHexString()}`;
}

/** Flat roof tones a parapet cap can wear, besides the building's own wall colour. */
const ROOF_TONES = ['#8d7d6b', '#a1887f', '#7d8a96', '#b08968', '#6f7d7a', '#96826f'];

/**
 * Paint one building face onto a canvas: the wall colour with a subtly striped
 * bay rhythm, a window grid with frames (some panes lit, some reflecting the
 * sky), floor separator lines, and a ground floor — a glazed storefront with a
 * sign band for named buildings, larger windows and a door for plain ones.
 * Returns { map, glow } textures; glow is black except for the lit panes, for
 * use as an emissive map. faceWidth is the face's width in world units.
 */
function makeFacadeTextures(b, faceWidth, hgt, salt) {
  const S = 192;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = S;
  glowCanvas.height = S;
  const glow = glowCanvas.getContext('2d');
  glow.fillStyle = '#000000';
  glow.fillRect(0, 0, S, S);

  const wall = b.roof; // the bright facade colour this building already wears
  const trim = b.wall; // its deeper partner colour: frames, bands, parapet
  const seed = b.x * 3.7 + b.y * 9.1 + salt * 57.3;
  const rnd = (k) => hash01(seed + k * 13.73);

  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, S, S);
  // A whisper of per-building tint variation.
  ctx.fillStyle = rnd(1) > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
  ctx.fillRect(0, 0, S, S);

  const floors = Math.max(2, Math.min(5, Math.round(hgt / 27)));
  const groundFrac = Math.max(0.24, Math.min(0.44, 34 / hgt));
  const groundH = S * groundFrac;
  const upperH = S - groundH;
  const bandH = upperH / (floors - 1);
  const cols = Math.max(2, Math.min(8, Math.round(faceWidth / 30)));
  const cellW = S / cols;

  // Vertical bay striping behind the windows.
  for (let c = 0; c < cols; c += 1) {
    if (c % 2 === 0) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.055)';
    ctx.fillRect(c * cellW, 0, cellW, S);
  }
  // Cornice line under the roof and a separator at every floor.
  ctx.fillStyle = 'rgba(0,0,0,0.20)';
  ctx.fillRect(0, 0, S, 5);
  ctx.fillStyle = 'rgba(0,0,0,0.13)';
  for (let f = 1; f < floors - 1; f += 1) ctx.fillRect(0, f * bandH, S, 3);
  ctx.fillRect(0, upperH, S, 4);

  const glassTones = ['#bfe3f2', '#8fc3dd', '#5d84a0', '#3c5a68'];
  function windowPane(x, y, w, h, k) {
    ctx.fillStyle = shade(trim, 0.72);
    ctx.fillRect(x - 2.5, y - 2.5, w + 5, h + 5);
    const r = rnd(k);
    if (r < 0.30) {
      ctx.fillStyle = '#ffd98c'; // lit from inside
      glow.fillStyle = '#ffbe78';
      glow.fillRect(x, y, w, h);
    } else {
      ctx.fillStyle = glassTones[Math.floor(rnd(k + 40) * glassTones.length)];
    }
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.20)';
    ctx.fillRect(x, y, w, 2.5); // sill highlight
    if (w > 15) { // a mullion cross on wider panes
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x + w / 2 - 1, y, 2, h);
    }
  }

  // Upper floors: the window grid.
  for (let f = 0; f < floors - 1; f += 1) {
    const bandY = f * bandH;
    const wh = bandH * 0.52;
    const wy = bandY + (bandH - wh) / 2;
    for (let c = 0; c < cols; c += 1) {
      if (rnd(f * 31 + c * 7) < 0.07) continue; // the odd blank bay
      const ww = cellW * 0.5;
      windowPane(c * cellW + (cellW - ww) / 2, wy, ww, wh, f * 100 + c);
    }
  }

  // Ground floor.
  const gy = upperH;
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  ctx.fillRect(0, gy, S, groundH);
  if (b.name) {
    // Storefront: a sign band over wide glazed panels and a framed door.
    const signH = groundH * 0.30;
    ctx.fillStyle = shade(trim, 0.82);
    ctx.fillRect(0, gy, S, signH);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(0, gy + signH - 4, S, 2.5);
    const panels = Math.max(2, Math.round(faceWidth / 46));
    const pw = S / panels;
    const doorAt = Math.floor(rnd(77) * panels);
    for (let p = 0; p < panels; p += 1) {
      const px = p * pw + 4;
      const py = gy + signH + 5;
      const pwid = pw - 8;
      const ph = groundH - signH - 9;
      ctx.fillStyle = shade(trim, 0.72);
      ctx.fillRect(px - 2, py - 2, pwid + 4, ph + 4);
      if (p === doorAt) {
        ctx.fillStyle = shade(trim, 1.05);
        ctx.fillRect(px, py, pwid, ph);
        ctx.fillStyle = '#ffd98c';
        ctx.fillRect(px + pwid - 8, py + ph * 0.45, 4, 4); // handle
        glow.fillStyle = '#7a5a30';
        glow.fillRect(px + pwid - 8, py + ph * 0.45, 4, 4);
      } else {
        ctx.fillStyle = rnd(p + 90) < 0.35 ? '#ffd98c' : '#a8d4ea';
        ctx.fillRect(px, py, pwid, ph);
        if (rnd(p + 90) < 0.35) {
          glow.fillStyle = '#e8a95e';
          glow.fillRect(px, py, pwid, ph);
        }
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(px, py, pwid, 4);
      }
    }
  } else {
    // Plain ground floor: larger windows and a door on wider faces.
    const doorCol = faceWidth >= 90 ? Math.floor(rnd(78) * cols) : -1;
    for (let c = 0; c < cols; c += 1) {
      const cx = c * cellW;
      if (c === doorCol) {
        const dw = cellW * 0.52;
        const dx = cx + (cellW - dw) / 2;
        ctx.fillStyle = shade(trim, 0.72);
        ctx.fillRect(dx - 2.5, gy + 5, dw + 5, groundH - 5);
        ctx.fillStyle = shade(trim, 1.1);
        ctx.fillRect(dx, gy + 7, dw, groundH - 7);
        ctx.fillStyle = '#ffd98c';
        ctx.fillRect(dx + dw - 7, gy + groundH * 0.5, 3.5, 3.5);
      } else {
        const ww = cellW * 0.58;
        const wh = groundH * 0.55;
        windowPane(cx + (cellW - ww) / 2, gy + (groundH - wh) / 2, ww, wh, 500 + c);
      }
    }
  }
  // Plinth line at the pavement.
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(0, S - 4, S, 4);

  const map = new THREE.CanvasTexture(canvas);
  map.anisotropy = 4;
  const glowTex = new THREE.CanvasTexture(glowCanvas);
  return { map, glow: glowTex };
}

/** The direction ('n'|'s'|'e'|'w') from a building toward its nearest road. */
function frontDir(b) {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  let best = { d: Infinity, dir: 's' };
  for (const a of ROAD.avenues) {
    const d = Math.abs(cx - a);
    if (d < best.d) best = { d, dir: cx < a ? 'e' : 'w' };
  }
  for (const s of ROAD.streets) {
    const d = Math.abs(cy - s);
    if (d < best.d) best = { d, dir: cy < s ? 's' : 'n' };
  }
  return best.dir;
}

/** Shared striped awning textures, one per trim colour. */
const awningTexCache = new Map();
function awningMaterial(trimHex) {
  if (!awningTexCache.has(trimHex)) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < 8; i += 1) {
      ctx.fillStyle = i % 2 === 0 ? '#f7f3df' : trimHex;
      ctx.fillRect(i * 8, 0, 8, 16);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.set(3, 1);
    awningTexCache.set(trimHex, new THREE.MeshToonMaterial({ map: tex, gradientMap: toonGradient() }));
  }
  return awningTexCache.get(trimHex);
}

/**
 * Build the whole visible city into the scene. Returns { group, spinMarkers }
 * where spinMarkers is the list of marker groups world3d animates itself.
 */
export function buildWorld(scene, city) {
  const group = new THREE.Group();
  scene.add(group);
  scene.background = new THREE.Color(COLORS.sky);
  scene.fog = new THREE.Fog(new THREE.Color(COLORS.sky), 1000, 2600);

  const hemi = new THREE.HemisphereLight(0xcfeeff, 0x9a8a5f, 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
  sun.position.set(900, 1500, 500);
  scene.add(sun);
  hemi.visible = false;
  sun.visible = false;
  // Touch the gradient so toon materials compile with it from the first frame.
  toonGradient();

  // Base ground and block pavements. The flat ground layers sit on a spread
  // ladder of heights (steps of ~0.14 or more): planes stacked within a few
  // hundredths of a unit z-fight at city viewing distances, so no two
  // overlapping surfaces may sit closer than that.
  const base = flatPlane(WORLD.width + 500, WORLD.height + 500, toonMat(0xb9c98d));
  base.position.set(WORLD.width / 2, -0.3, WORLD.height / 2);
  base.receiveShadow = true;
  group.add(base);
  const sidewalkMat = toonMat(0xe8e2d0);
  for (const block of city.blocks) {
    if (block.row === 5) continue;
    const p = flatPlane(block.w, block.h, sidewalkMat);
    p.position.set(block.x + block.w / 2, 0, block.y + block.h / 2);
    p.receiveShadow = true;
    group.add(p);
  }
  if (city.park) {
    const p = flatPlane(city.park.w, city.park.h, toonMat(0x8fce6e));
    p.position.set(city.park.x + city.park.w / 2, 0.14, city.park.y + city.park.h / 2);
    p.receiveShadow = true;
    group.add(p);
  }
  // Beach sand; the sea itself is built and animated by gfx.js.
  const sand = flatPlane(WORLD.width, WORLD.height - city.beachY, toonMat(0xf2ddab));
  sand.position.set(WORLD.width / 2, 0.14, (city.beachY + WORLD.height) / 2);
  sand.receiveShadow = true;
  group.add(sand);
  // The pier: a wooden jetty reaching into the sea near the warehouse.
  const pierDeck = new THREE.Mesh(new THREE.BoxGeometry(84, 5, 430), toonMat(0xa97c50));
  pierDeck.position.set(3085, 2.5, WORLD.height - 190);
  group.add(pierDeck);
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
  const pierRail = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 420), toonMat(0x8a6242));
  pierRail.position.set(3085 + 41, 7, WORLD.height - 190);
  group.add(pierRail);

  // Roads: one textured plane per avenue and street, plain squares on
  // crossings. Avenues and streets share one level and the crossing squares
  // sit a clear step above both (they used to be 0.01 apart, all three
  // coplanar at the crossings, and the whole square flickered); polygonOffset
  // on the road materials is a second line of defence.
  const vTex = makeRoadTexture(false);
  vTex.repeat.set(1, WORLD.height / 256);
  const vRoadMat = new THREE.MeshToonMaterial({ map: vTex, gradientMap: toonGradient(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  for (const avenue of ROAD.avenues) {
    const p = flatPlane(ROAD.width, WORLD.height, vRoadMat);
    p.position.set(avenue, 0.28, WORLD.height / 2);
    p.receiveShadow = true;
    group.add(p);
  }
  const hTex = makeRoadTexture(true);
  hTex.repeat.set(1, WORLD.width / 256);
  const hRoadMat = new THREE.MeshToonMaterial({ map: hTex, gradientMap: toonGradient(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  for (const street of ROAD.streets) {
    const p = flatPlane(WORLD.width, ROAD.width, hRoadMat);
    p.position.set(WORLD.width / 2, 0.28, street);
    p.receiveShadow = true;
    group.add(p);
  }
  const asphaltMat = new THREE.MeshToonMaterial({
    map: makeAsphaltTexture(),
    gradientMap: toonGradient(),
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  for (const avenue of ROAD.avenues) {
    for (const street of ROAD.streets) {
      const p = flatPlane(ROAD.width, ROAD.width, asphaltMat);
      p.position.set(avenue, 0.42, street);
      p.receiveShadow = true;
      group.add(p);
    }
  }

  // Buildings: a box wearing painted canvas facades (window grids, storefronts,
  // doors), a parapet slab, a varied flat roof, rooftop props on some, an
  // awning and step for the named landmarks, a fire escape on a few tall
  // blocks, and a floating name sprite when named. Footprints are unchanged,
  // so collision data in city.js still matches what is drawn.
  const roofMats = ROOF_TONES.map((t) => toonMat(new THREE.Color(t).getHex()));
  const acMat = toonMat(0xcfd4d8);
  const acTopMat = toonMat(0x9aa1a6);
  const towerMat = toonMat(0xa97c50);
  const towerRoofMat = toonMat(0x707880);
  const metalMat = toonMat(0x3a3f46);
  const stepMat = toonMat(0xcac2ae);
  const windowMats = [];
  for (const b of city.buildings) {
    const hgt = b.height * 1.9;
    const cx = b.x + b.w / 2;
    const cz = b.y + b.h / 2;
    const seed = b.x * 3.7 + b.y * 9.1;
    const wide = makeFacadeTextures(b, b.w, hgt, 1);
    const narrow = makeFacadeTextures(b, b.h, hgt, 2);
    const faceMat = (t) => new THREE.MeshToonMaterial({
      map: t.map, emissiveMap: t.glow, emissive: 0xffc98a, emissiveIntensity: 0.55,
      gradientMap: toonGradient(),
    });
    const roofMat = hash01(seed + 5) < 0.55
      ? roofMats[Math.floor(hash01(seed + 6) * roofMats.length)]
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

    // Rooftop props, hash-picked: a water tower on some tall blocks, an AC
    // unit or a vent pipe on others. They sit on the roof deck (top hgt+7).
    const propR = hash01(seed + 11);
    const offX = (hash01(seed + 12) - 0.5) * Math.max(0, b.w - 44);
    const offZ = (hash01(seed + 13) - 0.5) * Math.max(0, b.h - 44);
    if (hgt > 62 && propR < 0.30) {
      const tower = new THREE.Group();
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 7.5, 13, 10), towerMat);
      tank.position.y = 12.5;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(9, 6, 10), towerRoofMat);
      cone.position.y = 22;
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.8, 6, 8), metalMat);
      stand.position.y = 3;
      tower.add(tank, cone, stand);
      tower.position.set(cx + offX, hgt + 6.7, cz + offZ);
      group.add(tower);
    } else if (propR < 0.62) {
      // Props sink a few tenths into the deck/unit below them: faces resting
      // exactly on a surface are coplanar and can shimmer at glancing angles.
      const ac = new THREE.Mesh(new THREE.BoxGeometry(15, 7, 11), acMat);
      ac.position.set(cx + offX, hgt + 10.3, cz + offZ);
      const acTop = new THREE.Mesh(new THREE.BoxGeometry(11, 1.8, 8), acTopMat);
      acTop.position.set(cx + offX, hgt + 14.5, cz + offZ);
      group.add(ac, acTop);
    } else if (propR < 0.78) {
      const vent = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 7, 8), acTopMat);
      vent.position.set(cx + offX, hgt + 10.2, cz + offZ);
      group.add(vent);
    }

    // Fire escape on a few tall plain blocks: stacked platforms on the east
    // face with diagonal stairs, in dark metal. Lowest platform is above the
    // collision push-out distance, so nobody clips it at street level.
    if (!b.name && hgt >= 74 && hash01(seed + 21) < 0.30) {
      const floors = Math.max(2, Math.min(5, Math.round(hgt / 27)));
      const platW = Math.min(b.h * 0.5, 64);
      const platGeo = new THREE.BoxGeometry(7, 1.6, platW);
      let prev = null;
      for (let f = 1; f < floors; f += 1) {
        const py = f * 27 - 5;
        const plat = new THREE.Mesh(platGeo, metalMat);
        // Sunk 0.4 into the wall: a platform face exactly flush with the
        // facade plane is coplanar with it and flickers.
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

    // Named landmarks get a striped awning over the storefront on the face
    // toward the nearest road, and a shallow entrance step below it.
    if (b.name) {
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
  }

  // The Spray 'n Go carport over the garage zone: posts and a roof, open sides.
  const zone = city.garageZone;
  const postMat = toonMat(0xdadada);
  for (const [px, pz] of [
    [zone.x + 4, zone.y + 4],
    [zone.x + zone.w - 4, zone.y + 4],
    [zone.x + 4, zone.y + zone.h - 4],
    [zone.x + zone.w - 4, zone.y + zone.h - 4],
  ]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 34, 8), postMat);
    post.position.set(px, 17, pz);
    group.add(post);
  }
  const carport = new THREE.Mesh(new THREE.BoxGeometry(zone.w + 26, 5, zone.h + 26), toonMat(0x37b24d));
  carport.position.set(zone.x + zone.w / 2, 35, zone.y + zone.h / 2);
  group.add(carport);
  const padMat = new THREE.MeshToonMaterial({
    color: 0xc9c9c9, gradientMap: toonGradient(),
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  const pad = flatPlane(zone.w + 16, zone.h + 16, padMat);
  pad.position.set(zone.x + zone.w / 2, 0.56, zone.y + zone.h / 2);
  group.add(pad);

  // PALMERA MOTORS: three painted bays under a slim canopy. Posts stand at
  // the four corners of the roof so it reads as a carport, never as a slab
  // hovering over the lot (it is in frame in the pier mission shot).
  const lot = city.motorsLot || [];
  if (lot.length) {
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
    const pad = flatPlane(330, 110, new THREE.MeshToonMaterial({
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

  // The fixer's phone booth on the PD corner: a dark box with a lit front,
  // so the one paid way out of a wanted level is findable at night.
  const fixerSpot = city.landmarks.fixer;
  if (fixerSpot) {
    const booth = new THREE.Mesh(new THREE.BoxGeometry(20, 46, 20), toonMat(0x2c3f5e));
    booth.position.set(fixerSpot.x, 23, fixerSpot.y);
    group.add(booth);
    const pane = new THREE.Mesh(new THREE.BoxGeometry(14, 28, 0.6), basicMat(0xffe9a8));
    pane.position.set(fixerSpot.x, 25, fixerSpot.y - 10.2);
    group.add(pane);
    const signBox = new THREE.Mesh(new THREE.BoxGeometry(26, 7, 4), basicMat(0xffd94d));
    signBox.position.set(fixerSpot.x, 49, fixerSpot.y - 8);
    group.add(signBox);
    const glow = new THREE.PointLight(0xffd98b, 1.1, 140);
    glow.position.set(fixerSpot.x, 30, fixerSpot.y - 22);
    group.add(glow);
  }

  // The safehouse door: one warm lamp over the step, so "home" reads at night.
  const safeSpot = city.landmarks.safehouse;
  if (safeSpot) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(3.4, 8, 6), basicMat(0xffe9b0));
    lamp.position.set(safeSpot.x, 34, safeSpot.y - 8);
    group.add(lamp);
    const halo = new THREE.PointLight(0xffd98b, 0.9, 120);
    halo.position.set(safeSpot.x, 30, safeSpot.y - 18);
    group.add(halo);
  }

  // Trees and palms.
  const trunkMat = toonMat(0x8a5a33);
  const leafMat = toonMat(0x4da653);
  const palmMat = toonMat(0x63c174);
  for (const tree of city.trees) {
    const t = new THREE.Group();
    const trunkH = tree.kind === 'palm' ? 21 : 11;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.6, trunkH, 7), trunkMat);
    trunk.position.y = trunkH / 2;
    if (tree.kind === 'palm') trunk.rotation.z = 0.13;
    t.add(trunk);
    const crown = new THREE.Mesh(
      new THREE.IcosahedronGeometry(tree.r * 0.95, 0),
      tree.kind === 'palm' ? palmMat : leafMat,
    );
    crown.position.set(tree.kind === 'palm' ? 2.6 : 0, trunkH + tree.r * 0.5, 0);
    crown.scale.y = tree.kind === 'palm' ? 0.55 : 0.85;
    t.add(crown);
    t.position.set(tree.x, 0, tree.y);
    group.add(t);
  }

  // Street lamps at every other intersection corner.
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

  return { group, windowMats };
}

/**
 * A mission marker: a translucent beam of light with a bobbing label sprite.
 * The owner positions the group and toggles visibility; update spins it gently.
 * The options exist for the secondary diner marker: a shorter column in its
 * own colour so it can never be mistaken for the objective. Defaults are
 * exactly the objective marker's dimensions.
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
    bill.position.y = 7 + Math.sin(time * 3 + seed) * 1.6;
    band.position.y = bill.position.y;
  };
  return group;
}
