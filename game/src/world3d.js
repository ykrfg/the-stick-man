// The 3D city of Palmera, built from the data in city.js: flat toon-shaded box
// buildings with roof slabs and name sprites on the landmarks, dark road planes
// with painted dashes, sidewalks, a park, a beach with a pier, palms and lamps.
// Everything is procedural geometry in bright flat colours — a sunny diorama, never
// realistic. World data coordinates (x, y) map to 3D as (x, height, y).
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

function flatPlane(w, h, material) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
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
  // Touch the gradient so toon materials compile with it from the first frame.
  toonGradient();

  // Base ground and block pavements.
  const base = flatPlane(WORLD.width + 500, WORLD.height + 500, toonMat(0xb9c98d));
  base.position.set(WORLD.width / 2, -0.05, WORLD.height / 2);
  group.add(base);
  const sidewalkMat = toonMat(0xe8e2d0);
  for (const block of city.blocks) {
    if (block.row === 5) continue;
    const p = flatPlane(block.w, block.h, sidewalkMat);
    p.position.set(block.x + block.w / 2, 0.02, block.y + block.h / 2);
    group.add(p);
  }
  if (city.park) {
    const p = flatPlane(city.park.w, city.park.h, toonMat(0x8fce6e));
    p.position.set(city.park.x + city.park.w / 2, 0.04, city.park.y + city.park.h / 2);
    group.add(p);
  }
  // Beach sand and the sea beyond the south edge.
  const sand = flatPlane(WORLD.width, WORLD.height - city.beachY, toonMat(0xf2ddab));
  sand.position.set(WORLD.width / 2, 0.03, (city.beachY + WORLD.height) / 2);
  group.add(sand);
  const sea = flatPlane(WORLD.width + 900, 620, toonMat(0x3f9fd8));
  sea.position.set(WORLD.width / 2, -0.5, WORLD.height + 300);
  group.add(sea);
  // The pier: a wooden jetty reaching into the sea near the warehouse.
  const pierDeck = new THREE.Mesh(new THREE.BoxGeometry(84, 5, 430), toonMat(0xa97c50));
  pierDeck.position.set(3085, 2.5, WORLD.height - 190);
  group.add(pierDeck);

  // Roads: one textured plane per avenue and street, plain squares on crossings.
  const vTex = makeRoadTexture(false);
  vTex.repeat.set(1, WORLD.height / 256);
  const vRoadMat = new THREE.MeshToonMaterial({ map: vTex, gradientMap: toonGradient() });
  for (const avenue of ROAD.avenues) {
    const p = flatPlane(ROAD.width, WORLD.height, vRoadMat);
    p.position.set(avenue, 0.05, WORLD.height / 2);
    group.add(p);
  }
  const hTex = makeRoadTexture(true);
  hTex.repeat.set(1, WORLD.width / 256);
  const hRoadMat = new THREE.MeshToonMaterial({ map: hTex, gradientMap: toonGradient() });
  for (const street of ROAD.streets) {
    const p = flatPlane(WORLD.width, ROAD.width, hRoadMat);
    p.position.set(WORLD.width / 2, 0.05, street);
    group.add(p);
  }
  const asphaltMat = toonMat(0x4a4a52);
  for (const avenue of ROAD.avenues) {
    for (const street of ROAD.streets) {
      const p = flatPlane(ROAD.width, ROAD.width, asphaltMat);
      p.position.set(avenue, 0.06, street);
      group.add(p);
    }
  }

  // Buildings: a toon box, a darker roof slab, and a name sprite when named.
  for (const b of city.buildings) {
    const hgt = b.height * 1.9;
    const box = new THREE.Mesh(new THREE.BoxGeometry(b.w, hgt, b.h), toonMat(new THREE.Color(b.roof).getHex()));
    box.position.set(b.x + b.w / 2, hgt / 2, b.y + b.h / 2);
    group.add(box);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(b.w + 6, 5, b.h + 6), toonMat(new THREE.Color(b.wall).getHex()));
    slab.position.set(b.x + b.w / 2, hgt + 2.5, b.y + b.h / 2);
    group.add(slab);
    if (b.name) {
      const label = makeTextSprite(b.name, { size: 40, scale: 0.9 });
      label.position.set(b.x + b.w / 2, hgt + 30, b.y + b.h / 2);
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
  const pad = flatPlane(zone.w + 16, zone.h + 16, toonMat(0xc9c9c9));
  pad.position.set(zone.x + zone.w / 2, 0.07, zone.y + zone.h / 2);
  group.add(pad);

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

  return { group };
}

/**
 * A mission marker: a translucent beam of light with a bobbing label sprite.
 * The owner positions the group and toggles visibility; update spins it gently.
 */
export function makeMarker(colorHex = 0xffcf3f, label = '!') {
  const group = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(15, 15, 110, 18, 1, true),
    new THREE.MeshBasicMaterial({
      color: colorHex, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  beam.position.y = 55;
  group.add(beam);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(15, 22),
    new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.5, depthWrite: false }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.4;
  group.add(disc);
  const sprite = makeTextSprite(label, { size: 64, color: '#ffd94d', scale: 1.15 });
  sprite.position.y = 122;
  group.add(sprite);
  group.userData.update = (time) => {
    beam.rotation.y = time * 0.8;
    sprite.position.y = 122 + Math.sin(time * 2.2) * 5;
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
