// Atmosphere for Palmera: the sky dome with its sun disc and night stars,
// one shadow-casting key light that follows the sun (and the moon), the
// sea's two scrolling sheets, and the street dressing that makes the city
// read at a glance — palms, parasols, a harbour crane, traffic lights and
// neon shop boards. Everything is procedural; no texture file is loaded.
//
// The frame loop calls gfx.update(g, dt) after the world has moved and
// before the render. ?shot= stills pin the hour and the top quality rung
// so a still comes out the same whenever it is taken.
import * as THREE from 'three';
import { ROAD, WORLD } from './config.js';
import { BEACH_Y } from './city.js';
import { hourOf, solve } from './time.js';
import { basicMat, toonMat } from './stick3d.js';

const bound = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * A deterministic 0..1 stream (a small LCG): the procedural dressing is
 * placed from this, never from Math.random, so the city is identical on
 * every visit.
 */
function lcg(seed = 20261120) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Paint a canvas and hand it back as a texture. The painter receives a
 * fresh deterministic stream seeded from the canvas size, so a texture
 * cannot drift between sessions either.
 */
function paintTexture(w, h, painter, repeatPair = null) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  painter(canvas.getContext('2d'), w, h, lcg(w * 31 + h));
  const tex = new THREE.CanvasTexture(canvas);
  if (repeatPair) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatPair[0], repeatPair[1]);
  }
  tex.needsUpdate = true;
  return tex;
}

/* ------------------------------------------------------------------ sky */

const SKY_VERTEX_SRC = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT_SRC = `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uSunSize;
uniform float uStars;
varying vec3 vDir;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec3 d = normalize(vDir);
  float up = clamp(d.y, -1.0, 1.0);
  vec3 col = mix(uHorizon, uTop, pow(clamp(up, 0.0, 1.0), 0.42));
  col = mix(col, uBottom, clamp(-up * 2.4, 0.0, 1.0));
  float sd = distance(d, uSunDir);
  col += uSunColor * smoothstep(uSunSize, uSunSize * 0.70, sd) * 1.30;
  col += uSunColor * pow(max(0.0, 1.0 - sd * 2.7), 6.0) * 0.20;
  // A warm band hugging the horizon keeps the sunset from reading as one flat
  // sheet of orange.
  col += uSunColor * pow(max(0.0, 1.0 - up * 3.4), 3.0) * 0.16;
  vec2 cell = floor(d.xz * 210.0 + d.y * 80.0);
  float star = step(0.9967, hash(cell));
  float lift = smoothstep(0.02, 0.62, up);
  col += vec3(star * lift * uStars);
  // ACES fit + sRGB, the same two steps the lit materials get from three.
  col = clamp((col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14), 0.0, 1.0);
  gl_FragColor = vec4(pow(col, vec3(0.4545)), 1.0);
}
`;

/* ------------------------------------------------------------ module state */

let stage = null;
let dome = null;
let domeMat = null;
let sun = null;
let skyLight = null;
let fillLight = null;
let seaSheet = null;
let glintSheet = null;
let poolMaterial = null;
let quality = 2;
let paneMats = [];
let glowTex = null;
const lightPools = [];
const palmList = [];
const lampBulbs = [];
const neonSigns = [];
const glowSprites = [];
let boundRenderer = null;
let appliedHour = -1;
let currentEnv = null;
// Frame-rate ladder bookkeeping: a slow window steps quality down, and
// three consecutive fast windows step it back up (see update).
let ladderFrames = 0;
let ladderTime = 0;
let fastStreak = 0;

/* ------------------------------------------------------------ glow sprites */

/**
 * A camera-facing additive sprite: the cheap "luminous" read for every
 * light in the game. Bloom would need a post chain; a handful of soft
 * billboards at the sources gives the same glow at a fraction of the
 * cost, and never smears the HUD. Built without touching the scene.
 */
function buildGlowSprite(size, colorHex) {
  if (!glowTex) {
    glowTex = paintTexture(64, 64, (ctx) => {
      const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
      grad.addColorStop(0.55, 'rgba(255,255,255,0.16)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 64, 64);
    });
  }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex,
    color: colorHex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  sprite.scale.set(size, size, 1);
  return sprite;
}

/**
 * A glow sprite for a light the caller owns (car headlights, the patrol
 * bar). vehicles.js builds these before initGfx runs, so nothing here
 * may need the scene.
 */
export function makeGlowSprite(size, colorHex) {
  return buildGlowSprite(size, colorHex);
}

/** How dark it is right now: 0 by day, 1 in the dead of night. */
export function nightLevel() {
  return currentEnv ? currentEnv.darkness : 0;
}

/** A glow sprite owned by the atmosphere layer itself, faded by the clock. */
function placeGlow(size, colorHex, baseOpacity) {
  const sprite = buildGlowSprite(size, colorHex);
  sprite.userData.base = baseOpacity;
  stage.add(sprite);
  glowSprites.push(sprite);
  return sprite;
}

/* ------------------------------------------------------------------- boot */

/**
 * Build every atmosphere resource once, at boot. Purely additive: the
 * world3d ground, facades and props are untouched, so city collision is
 * untouched too.
 */
export function initGfx(g) {
  stage = g.scene;
  stage.background = null;
  paneMats = g.windowMats || [];

  buildDome();
  buildLights(g);
  buildSeaSheets();
  buildLampRow();
  buildStreetDressing(g);

  g.renderer.shadowMap.enabled = true;
  g.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

/** The sky dome: a big inverted sphere running the gradient shader. */
function buildDome() {
  domeMat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(0x2f93d6) },
      uHorizon: { value: new THREE.Color(0xa9dcf0) },
      uBottom: { value: new THREE.Color(0x9fc6cf) },
      uSunColor: { value: new THREE.Color(0xfff4dd) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.2) },
      uSunSize: { value: 0.048 },
      uStars: { value: 0 },
    },
    vertexShader: SKY_VERTEX_SRC,
    fragmentShader: SKY_FRAGMENT_SRC,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), domeMat);
  // 3000 against the camera's 4200 far plane: the dome is always inside
  // the frustum, so no corner of the sky is ever clipped away.
  dome.scale.setScalar(3000);
  dome.renderOrder = -20;
  dome.frustumCulled = false;
  stage.add(dome);
}

/** The three lights: the shadow-casting key, the sky bounce, a cool fill. */
function buildLights(g) {
  sun = new THREE.DirectionalLight(0xfff4dd, 2.1);
  sun.position.set(700, 1200, 500);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera;
  cam.near = 1;
  cam.far = 2400;
  cam.left = -230;
  cam.right = 230;
  cam.top = 230;
  cam.bottom = -230;
  cam.updateProjectionMatrix();
  sun.shadow.bias = -0.0007;
  sun.shadow.normalBias = 0.9;
  stage.add(sun);
  stage.add(sun.target);

  skyLight = new THREE.HemisphereLight(0xcfeeff, 0x9a8a5f, 1.02);
  stage.add(skyLight);
  fillLight = new THREE.DirectionalLight(0xbcd8ff, 0.18);
  fillLight.position.set(-500, 380, -700);
  stage.add(fillLight);

  g.shadowLight = sun;
}

/** The sea: a scrolled wave sheet with a brighter sparkle sheet over it. */
function buildSeaSheets() {
  const wave = paintTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#2f9fd4';
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 7) {
      ctx.fillStyle = `rgba(255,255,255,${0.05 + (y % 21) / 420})`;
      ctx.fillRect(0, y, w, 2);
    }
    for (let i = 0; i < 70; i += 1) {
      ctx.fillStyle = `rgba(255,255,255,${0.10 + (i % 5) * 0.02})`;
      ctx.fillRect((i * 37) % w, (i * 53) % h, 8 + (i % 4) * 6, 2);
    }
  }, [1, 1]);
  seaSheet = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.width + 900, 2600),
    new THREE.MeshBasicMaterial({ map: wave }),
  );
  seaSheet.rotation.x = -Math.PI / 2;
  seaSheet.position.set(WORLD.width / 2, -0.78, WORLD.height + 1300);
  stage.add(seaSheet);

  const glints = paintTexture(128, 128, (ctx) => {
    ctx.clearRect(0, 0, 128, 128);
    for (let i = 0; i < 90; i += 1) {
      const sz = 1 + (i % 3);
      ctx.fillStyle = `rgba(255,255,255,${0.45 + (i % 6) * 0.09})`;
      ctx.fillRect((i * 29) % 128, (i * 47) % 128, sz, sz * 0.6);
    }
  }, [22, 22]);
  glintSheet = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.width + 900, 2600),
    new THREE.MeshBasicMaterial({
      map: glints, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  glintSheet.rotation.x = -Math.PI / 2;
  glintSheet.position.set(WORLD.width / 2, -0.62, WORLD.height + 1300);
  stage.add(glintSheet);
}

/** Street lamps: a bulb at every other crossing, plus a warm pool of light. */
function buildLampRow() {
  const bulbGeo = new THREE.SphereGeometry(3.1, 8, 6);
  const poleGeo = new THREE.CylinderGeometry(1.3, 1.6, 30, 6);
  const poleMat = toonMat(0x59606b);
  // A radial falloff, not a hard disc: a flat circle lit additively reads
  // as a puddle of milk. One shared material, faded by the clock in
  // applyEnvironment.
  const falloff = paintTexture(64, 64, (ctx) => {
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.45, 'rgba(255,240,200,0.45)');
    grad.addColorStop(1, 'rgba(255,230,170,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
  });
  const poolGeo = new THREE.PlaneGeometry(150, 150);
  poolMaterial = new THREE.MeshBasicMaterial({
    map: falloff,
    color: 0xffcf86,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  for (let i = 0; i < ROAD.avenues.length; i += 1) {
    for (let j = 0; j < ROAD.streets.length; j += 1) {
      if ((i + j) % 2 !== 0) continue;
      const x = ROAD.avenues[i] + 62;
      const y = ROAD.streets[j] + 62;
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(x, 15, y);
      stage.add(pole);
      const bulb = new THREE.Mesh(bulbGeo, new THREE.MeshBasicMaterial({ color: 0xfff3b0 }));
      bulb.position.set(x, 30.5, y);
      stage.add(bulb);
      lampBulbs.push(bulb);
      const glow = placeGlow(96, 0xffd88a, 0.85);
      glow.position.set(x, 30.5, y);
      const pool = new THREE.Mesh(poolGeo, poolMaterial);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(x, 0.72, y);
      stage.add(pool);
      lightPools.push(pool);
    }
  }
}

/* --------------------------------------------------------- street dressing */

/** A palm: a leaning trunk and six flat fronds fanned around its crown. */
function buildPalm(rnd) {
  const group = new THREE.Group();
  const h = 26 + rnd() * 9;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 2.0, h, 7), toonMat(0x8b5e3a));
  trunk.position.y = h / 2;
  trunk.rotation.z = (rnd() - 0.5) * 0.2;
  group.add(trunk);
  const frondMat = toonMat(0x4fae5e);
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2 + rnd() * 0.5;
    const frond = new THREE.Mesh(new THREE.BoxGeometry(17, 0.8, 4), frondMat);
    frond.position.set(Math.cos(a) * 7.5, h - 1.5, Math.sin(a) * 7.5);
    frond.rotation.y = -a;
    frond.rotation.z = -0.35;
    group.add(frond);
  }
  return group;
}

/** A beach parasol: a striped cone — a quarter-slice in the second colour. */
function buildParasol(colorA, colorB) {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 15, 6), basicMat(0xf7f3df));
  pole.position.y = 7.5;
  group.add(pole);
  const canopy = new THREE.Mesh(new THREE.ConeGeometry(8.4, 3.2, 8, 1, true), basicMat(colorA));
  canopy.position.y = 15.6;
  group.add(canopy);
  const stripe = new THREE.Mesh(new THREE.ConeGeometry(8.44, 3.24, 8, 1, true, 0, Math.PI / 2), basicMat(colorB));
  stripe.position.y = 15.6;
  group.add(stripe);
  return group;
}

/** A harbour crane on the pier block: lattice mast, jib and a hook line. */
function buildCrane(x, y) {
  const group = new THREE.Group();
  const steel = toonMat(0xd9a227);
  const dark = toonMat(0x6b6f78);
  const parts = [
    // [geometry, material, x, y, z]
    [new THREE.BoxGeometry(9, 150, 9), steel, 0, 75, 0], // mast
    [new THREE.BoxGeometry(190, 7, 7), steel, 70, 148, 0], // jib
    [new THREE.BoxGeometry(46, 16, 26), dark, -34, 140, 0], // counterweight
    [new THREE.ConeGeometry(7, 18, 4), steel, 0, 159, 0], // cap
    [new THREE.CylinderGeometry(0.7, 0.7, 96, 4), dark, 148, 100, 0], // hook line
    [new THREE.BoxGeometry(11, 8, 11), dark, 148, 50, 0], // hook block
  ];
  for (const [geo, mat, px, py, pz] of parts) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(px, py, pz);
    group.add(mesh);
  }
  group.position.set(x, 0, y);
  group.rotation.y = -0.5;
  return group;
}

/**
 * Static street furniture: palms and parasols on the sand, boulevard
 * palms along three avenues, traffic lights at the big crossings, and
 * neon boards over the named shops. All of it is additive scenery;
 * nothing here collides.
 */
function buildStreetDressing(g) {
  const rnd = lcg(7410);
  const city = g.city;
  if (!city) return;

  // Promenade palms, spaced along the beach, and parasols out on the sand.
  for (let x = 120; x < WORLD.width; x += 215) {
    const palm = buildPalm(rnd);
    palm.position.set(x + rnd() * 40, 0.1, BEACH_Y + 26 + rnd() * 22);
    palm.rotation.y = rnd() * 6.28;
    palm.scale.setScalar(0.85 + rnd() * 0.4);
    stage.add(palm);
    palmList.push(palm);
  }
  const parasolCols = [0xff6b57, 0x35a7c4, 0xffd166, 0xf4a7c3];
  for (let i = 0; i < 12; i += 1) {
    const a = parasolCols[i % parasolCols.length];
    const b = parasolCols[(i + 2) % parasolCols.length];
    const p = buildParasol(a, b);
    p.position.set(260 + i * 245 + rnd() * 60, 0.05, BEACH_Y + 130 + rnd() * 150);
    p.rotation.y = rnd() * 6.28;
    stage.add(p);
  }

  // Boulevard palms in the sidewalk strips of three avenues.
  for (const avenue of [ROAD.avenues[1], ROAD.avenues[4], ROAD.avenues[6]]) {
    for (let i = 0; i < 8; i += 1) {
      const palm = buildPalm(rnd);
      palm.position.set(avenue + (i % 2 ? 62 : -62), 0.1, 140 + i * 300 + rnd() * 60);
      palm.scale.setScalar(0.8 + rnd() * 0.3);
      stage.add(palm);
      palmList.push(palm);
    }
  }

  // Traffic lights: a diagonal pair of corners at every third crossing,
  // so the junctions read as signalised without flooding the scene with
  // meshes.
  const poleGeo = new THREE.CylinderGeometry(1.2, 1.4, 34, 6);
  const headGeo = new THREE.BoxGeometry(5, 14, 4);
  const lensGeo = new THREE.CircleGeometry(1.4, 8);
  const poleMat = toonMat(0x3d434d);
  const headMat = toonMat(0x22262c);
  const lensCols = [0xff4b3e, 0xffc93c, 0x46d46d];
  let n = 0;
  for (const avenue of ROAD.avenues) {
    for (const street of ROAD.streets) {
      n += 1;
      if (n % 3 !== 0) continue;
      const corners = n % 2 ? [[-1, -1], [1, 1]] : [[1, -1], [-1, 1]];
      for (const [sx, sy] of corners) {
        const x = avenue + sx * 68;
        const y = street + sy * 68;
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.set(x, 17, y);
        stage.add(pole);
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.set(x, 34, y);
        stage.add(head);
        for (let k = 0; k < 3; k += 1) {
          const lens = new THREE.Mesh(lensGeo, basicMat(lensCols[k]));
          lens.position.set(x, 39 - k * 4, y + sy * 2.1);
          if (sy < 0) lens.rotation.y = Math.PI;
          stage.add(lens);
        }
      }
    }
  }

  // Neon boards over the shop fronts: a dark fascia, a frame of bulbs
  // along both long edges, and two nested glows washing the front.
  for (const shop of city.shops || []) {
    if (!shop) continue;
    const sign = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.BoxGeometry(120, 26, 4), basicMat(0x161a2c));
    sign.add(panel);
    for (let i = 0; i < 9; i += 1) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(2.1, 6, 5), basicMat(0xffe9a8));
      bulb.position.set(-52 + i * 13, 14, 0);
      sign.add(bulb);
      const bulb2 = bulb.clone();
      bulb2.position.y = -14;
      sign.add(bulb2);
    }
    sign.position.set(shop.x, 44, shop.y - 96);
    stage.add(sign);
    neonSigns.push(sign);
    const wash = placeGlow(190, 0xffe08a, 0.5);
    wash.position.set(shop.x, 44, shop.y - 96);
    const core = placeGlow(96, 0xfff4c0, 0.9);
    core.position.set(shop.x, 30, shop.y - 96);
  }
  const crane = buildCrane(2830, 2180);
  stage.add(crane);
}

/* ------------------------------------------------------------------ frame */

/** Pick the hour: the live clock, else noon, and pin it for stills. */
function pickHour(g) {
  // The title always opens at noon, whatever time the saved run ended
  // at; the clock takes over the moment play starts.
  if (g.state === 'title') return 12;
  if (g.shotHour !== null && g.shotHour !== undefined) return g.shotHour;
  if (typeof g.clock === 'number') return hourOf(g.clock);
  return 12;
}

/** Apply one solved environment to every atmosphere resource. */
function applyEnvironment(g, e) {
  currentEnv = e;
  const u = domeMat.uniforms;
  u.uTop.value.copy(e.sky);
  u.uHorizon.value.copy(e.horizon);
  u.uBottom.value.copy(e.water);
  u.uSunColor.value.copy(e.key);
  u.uSunDir.value.copy(e.dir);
  u.uStars.value = e.stars;

  sun.color.copy(e.key);
  sun.intensity = e.keyI * (e.shadow > 0 ? 1 : 0.9);
  skyLight.color.copy(e.hemiSky);
  skyLight.groundColor.copy(e.hemiGround);
  skyLight.intensity = e.hemiI;
  fillLight.color.copy(e.hemiSky);
  fillLight.intensity = 0.10 + e.hemiI * 0.16;
  g.renderer.toneMappingExposure = e.exposure;

  if (stage.fog) {
    stage.fog.color.copy(e.fog);
    stage.fog.near = e.night ? 620 : 1000;
    stage.fog.far = e.night ? 2050 : 2850;
  }
  g.renderer.setClearColor(e.fog, 1);

  // Lit windows carry the night (see world3d's facade glow map): dim
  // panes by day, warm bright panes once the sun is down.
  const glowLevel = 0.10 + e.windowGlow * 1.55;
  for (const mat of paneMats) mat.emissiveIntensity = glowLevel;

  const lit = e.darkness;
  if (poolMaterial) poolMaterial.opacity = lit * 0.55;
  for (const sprite of glowSprites) {
    const base = sprite.userData.base ?? 0.6;
    sprite.material.opacity = base * (0.06 + lit * 0.94);
  }
  for (const bulb of lampBulbs) bulb.material.color.setHex(lit > 0.12 ? 0xfff3b0 : 0xcfc9b5);
  for (const sign of neonSigns) sign.scale.setScalar(0.7 + lit * 0.3 + 0.3);

  if (seaSheet) seaSheet.material.map.colorSpace = THREE.SRGBColorSpace;
  if (seaSheet) seaSheet.material.color.copy(e.water).multiplyScalar(0.55 + (1 - e.darkness) * 0.55);
  if (glintSheet) glintSheet.material.opacity = 0.16 + e.darkness * 0.55;
}

/**
 * Frame hook: solve the clock only when it changed, keep the dome and
 * the shadow box on the camera, and let the sun's shadow follow the
 * player.
 */
export function update(g, dt) {
  if (!dome) return;
  const hour = pickHour(g);
  if (hour !== appliedHour) {
    appliedHour = hour;
    applyEnvironment(g, solve(hour));
  }
  if (!currentEnv) applyEnvironment(g, solve(hour));

  const cam = g.camera;
  dome.position.set(cam.position.x, 0, cam.position.z);
  const p = g.player;
  // The key light sits a fixed slant range along the sun direction, so
  // the angle (and therefore the length) of every shadow follows the
  // clock.
  sun.position.set(p.x + currentEnv.dir.x * 900, currentEnv.dir.y * 900, p.y + currentEnv.dir.z * 900);
  sun.target.position.set(p.x, 0, p.y);
  sun.target.updateMatrixWorld();
  // Shadows belong to every hour: the moon is a real key light at night
  // (its direction is flipped in time.js precisely so night shadows
  // exist), so castShadow must never be gated on the time-of-day
  // envelope. The old `env.shadow > 0.45` term could not fire anyway —
  // the envelope bottoms out at 0.62 — but leaving an hour-based gate
  // here invites exactly the "shadows vanish at night" pop. Quality
  // level is the only switch (round #23).
  sun.castShadow = quality > 0;

  for (const palm of palmList) {
    palm.rotation.z = Math.sin(g.time * 0.6 + palm.position.x * 0.01) * 0.018;
  }
  // Automatic quality: two and a half seconds under 42 fps drops one
  // rung. Stills pin the top rung, so a screenshot never changes on its
  // own. The ladder also climbs back (round #23): three consecutive
  // windows above 50 fps restore one rung. It used to ratchet down only,
  // so a transient dip — a heavy night scene is the classic case — cost
  // the shadow map for the rest of the session: at level 0 shadows are
  // off entirely, which read as "building shadows disappear at night".
  if (g.shotHour === null || g.shotHour === undefined) {
    ladderFrames += 1;
    ladderTime += Math.min(0.1, dt);
    if (ladderTime > 2.5) {
      const fps = ladderFrames / ladderTime;
      ladderFrames = 0;
      ladderTime = 0;
      if (fps < 42 && quality > 0) {
        setQuality(quality - 1);
        fastStreak = 0;
      } else if (fps > 50 && quality < 2) {
        fastStreak += 1;
        if (fastStreak >= 3) {
          setQuality(quality + 1);
          fastStreak = 0;
        }
      } else {
        fastStreak = 0;
      }
    }
  }
  // The sea scrolls by wall-clock dt in live play only: a ?shot= still
  // must be the same picture whenever it is taken, so the water holds
  // still there (the same freeze the fps ladder above obeys).
  if (seaSheet && (g.shotHour === null || g.shotHour === undefined)) {
    seaSheet.material.map.offset.y = (seaSheet.material.map.offset.y + dt * 0.012) % 1;
    glintSheet.material.map.offset.x = (glintSheet.material.map.offset.x + dt * 0.03) % 1;
  }
}

/** Quality ladder: 2 high, 1 medium, 0 low (shadow off, coarse map). */
export function setQuality(q) {
  quality = bound(q, 0, 2);
  if (!sun) return;
  const size = [512, 1536, 2048][quality];
  if (sun.shadow.mapSize.x !== size) {
    sun.shadow.mapSize.set(size, size);
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
  }
  if (boundRenderer) boundRenderer.shadowMap.enabled = quality > 0;
  for (const palm of palmList) palm.visible = quality > 0;
}

/** Remember the renderer so the quality ladder can reach the shadow map. */
export function bindRenderer(renderer) {
  boundRenderer = renderer;
}

/** Current quality level. */
export function qualityLevel() {
  return quality;
}
