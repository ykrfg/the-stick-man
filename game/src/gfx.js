// Atmosphere: the sky dome, one shadow-casting key light, the sea's sparkle, and
// the small street furniture that makes Palmera read as a city (palms, parasols,
// a crane, traffic lights, neon boards). All procedural canvas/code.
//
// The frame calls gfx.update(g, dt) after the world moved and before the render.
// ?shot= stills pin the hour and the highest quality so a still never changes.
import * as THREE from 'three';
import { ROAD, WORLD } from './config.js';
import { BEACH_Y } from './city.js';
import { hourOf, solve } from './time.js';
import { basicMat, toonMat } from './stick3d.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Deterministic 0..1 stream: procedural art must not change between visits. */
function det(seed = 20261120) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A canvas texture from a painter; no file loading anywhere here. */
function canvasTex(w, h, paint, { repeat = null } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  paint(canvas.getContext('2d'), w, h, det(w * 31 + h));
  const tex = new THREE.CanvasTexture(canvas);
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  tex.needsUpdate = true;
  return tex;
}

/* ---------------------------------------------------------------------- sky */

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = `
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

/* ---------------------------------------------------------------- resources */

let scene = null;
let sky = null;
let skyMat = null;
let key = null;
let hemi = null;
let fill = null;
let sea = null;
let spark = null;
const pools = [];
const palms = [];
const lamps = [];
const signs = [];
let poolMat = null;
let level = 2;
let windowMats = [];
let fpsFrames = 0;
let fpsTime = 0;
let haloTex = null;
const halos = [];

/**
 * A camera-facing additive sprite: the cheap "luminous" read for every light.
 * Bloom would need a post chain; a handful of soft billboards at the sources
 * gives the same glow at a fraction of the cost, and never smears the HUD.
 */
/** A soft additive billboard, built without touching the scene. */
function makeSprite(size, colorHex) {
  if (!haloTex) {
    haloTex = canvasTex(64, 64, (ctx) => {
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
    map: haloTex,
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
 * A sprite for a light the caller owns (car headlights, the patrol bar).
 * vehicles.js builds these before initGfx, so nothing here may need `scene`.
 */
export function makeGlowSprite(size, colorHex) {
  return makeSprite(size, colorHex);
}

/** How dark it is right now: 0 by day, 1 in the dead of night. */
export function nightLevel() {
  return env ? env.darkness : 0;
}

/**
 * A camera-facing additive sprite: the cheap "luminous" read for every lamp.
 * Bloom would need a post chain; a handful of soft billboards at the sources
 * gives the same glow at a fraction of the cost, and never smears the HUD.
 */
function halo(size, colorHex, opacity) {
  const sprite = makeSprite(size, colorHex);
  sprite.userData.base = opacity;
  scene.add(sprite);
  halos.push(sprite);
  return sprite;
}

/**
 * Build every atmosphere resource once, at boot. Additive: the old world3d
 * ground, facades and props are untouched, so city collision is untouched.
 */
export function initGfx(g) {
  scene = g.scene;
  scene.background = null;
  windowMats = g.windowMats || [];

  skyMat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(0x2f93d6) },
      uHorizon: { value: new THREE.Color(0xa9dcf0) },
      uBottom: { value: new THREE.Color(0x9fc6cf) },
      uSunColor: { value: new THREE.Color(0xfff4dd) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.2) },
      uSunSize: { value: 0.048 },
      uStars: { value: 0 },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), skyMat);
  // 3000 against the camera's 4200 far plane: the dome is always inside the
  // frustum, so no corner of the sky is ever clipped away.
  sky.scale.setScalar(3000);
  sky.renderOrder = -20;
  sky.frustumCulled = false;
  scene.add(sky);

  key = new THREE.DirectionalLight(0xfff4dd, 2.1);
  key.position.set(700, 1200, 500);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const cam = key.shadow.camera;
  cam.near = 1;
  cam.far = 2400;
  cam.left = -230;
  cam.right = 230;
  cam.top = 230;
  cam.bottom = -230;
  cam.updateProjectionMatrix();
  key.shadow.bias = -0.0007;
  key.shadow.normalBias = 0.9;
  scene.add(key);
  scene.add(key.target);

  hemi = new THREE.HemisphereLight(0xcfeeff, 0x9a8a5f, 1.02);
  scene.add(hemi);
  fill = new THREE.DirectionalLight(0xbcd8ff, 0.18);
  fill.position.set(-500, 380, -700);
  scene.add(fill);

  g.shadowLight = key;

  makeSea();
  makeLamps();
  buildProps(g);

  g.renderer.shadowMap.enabled = true;
  g.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

/** The sea: a scrolled wave sheet with a brighter sparkle sheet over it. */
function makeSea() {
  const wave = canvasTex(256, 256, (ctx, w, h) => {
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
  }, { repeat: [1, 1] });
  sea = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.width + 900, 2600),
    new THREE.MeshBasicMaterial({ map: wave }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(WORLD.width / 2, -0.78, WORLD.height + 1300);
  scene.add(sea);

  const glints = canvasTex(128, 128, (ctx) => {
    ctx.clearRect(0, 0, 128, 128);
    for (let i = 0; i < 90; i += 1) {
      const sz = 1 + (i % 3);
      ctx.fillStyle = `rgba(255,255,255,${0.45 + (i % 6) * 0.09})`;
      ctx.fillRect((i * 29) % 128, (i * 47) % 128, sz, sz * 0.6);
    }
  }, { repeat: [22, 22] });
  spark = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.width + 900, 2600),
    new THREE.MeshBasicMaterial({
      map: glints, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  spark.rotation.x = -Math.PI / 2;
  spark.position.set(WORLD.width / 2, -0.62, WORLD.height + 1300);
  scene.add(spark);
}

/** Street lamps: a bulb at the lit corners and a soft warm pool on the road. */
function makeLamps() {
  const bulbGeo = new THREE.SphereGeometry(3.1, 8, 6);
  const poleGeo = new THREE.CylinderGeometry(1.3, 1.6, 30, 6);
  const poleMat = toonMat(0x59606b);
  // A radial falloff, not a hard disc: a flat circle lit additively reads as
  // a puddle of milk. One shared material, faded by the clock in applyEnv.
  const falloff = canvasTex(64, 64, (ctx) => {
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.45, 'rgba(255,240,200,0.45)');
    grad.addColorStop(1, 'rgba(255,230,170,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
  });
  const poolGeo = new THREE.PlaneGeometry(150, 150);
  poolMat = new THREE.MeshBasicMaterial({
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
      scene.add(pole);
      const bulb = new THREE.Mesh(bulbGeo, new THREE.MeshBasicMaterial({ color: 0xfff3b0 }));
      bulb.position.set(x, 30.5, y);
      scene.add(bulb);
      lamps.push(bulb);
      const glow = halo(96, 0xffd88a, 0.85);
      glow.position.set(x, 30.5, y);
      const pool = new THREE.Mesh(poolGeo, poolMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(x, 0.72, y);
      scene.add(pool);
      pools.push(pool);
    }
  }
}

/** A palm: a leaning trunk and six flat fronds. */
function makePalm(rnd) {
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

/** A beach parasol: a striped cone on a pole. */
function makeParasol(colorA, colorB) {
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
function makeCrane(x, y) {
  const group = new THREE.Group();
  const steel = toonMat(0xd9a227);
  const dark = toonMat(0x6b6f78);
  const mast = new THREE.Mesh(new THREE.BoxGeometry(9, 150, 9), steel);
  mast.position.y = 75;
  group.add(mast);
  const jib = new THREE.Mesh(new THREE.BoxGeometry(190, 7, 7), steel);
  jib.position.set(70, 148, 0);
  group.add(jib);
  const counter = new THREE.Mesh(new THREE.BoxGeometry(46, 16, 26), dark);
  counter.position.set(-34, 140, 0);
  group.add(counter);
  const top = new THREE.Mesh(new THREE.ConeGeometry(7, 18, 4), steel);
  top.position.y = 159;
  group.add(top);
  const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 96, 4), dark);
  hook.position.set(148, 100, 0);
  group.add(hook);
  const block = new THREE.Mesh(new THREE.BoxGeometry(11, 8, 11), dark);
  block.position.set(148, 50, 0);
  group.add(block);
  group.position.set(x, 0, y);
  group.rotation.y = -0.5;
  return group;
}

/**
 * Static street furniture: palms and parasols on the sand, palisade posts and
 * boulevard palms, traffic lights at the big crossings, and neon boards over
 * the named shops. All of it is additive scenery; nothing here collides.
 */
function buildProps(g) {
  const rnd = det(7410);
  const city = g.city;
  if (!city) return;

  // Promenade palms, spaced along the beach, and parasols out on the sand.
  for (let x = 120; x < WORLD.width; x += 215) {
    const palm = makePalm(rnd);
    palm.position.set(x + rnd() * 40, 0.1, BEACH_Y + 26 + rnd() * 22);
    palm.rotation.y = rnd() * 6.28;
    palm.scale.setScalar(0.85 + rnd() * 0.4);
    scene.add(palm);
    palms.push(palm);
  }
  const parasolCols = [0xff6b57, 0x35a7c4, 0xffd166, 0xf4a7c3];
  for (let i = 0; i < 12; i += 1) {
    const a = parasolCols[i % parasolCols.length];
    const b = parasolCols[(i + 2) % parasolCols.length];
    const p = makeParasol(a, b);
    p.position.set(260 + i * 245 + rnd() * 60, 0.05, BEACH_Y + 130 + rnd() * 150);
    p.rotation.y = rnd() * 6.28;
    scene.add(p);
  }

  // Boulevard palms in the sidewalk strips of two avenues.
  for (const avenue of [ROAD.avenues[1], ROAD.avenues[4], ROAD.avenues[6]]) {
    for (let i = 0; i < 8; i += 1) {
      const palm = makePalm(rnd);
      palm.position.set(avenue + (i % 2 ? 62 : -62), 0.1, 140 + i * 300 + rnd() * 60);
      palm.scale.setScalar(0.8 + rnd() * 0.3);
      scene.add(palm);
      palms.push(palm);
    }
  }

  // Traffic lights: a diagonal pair of corners at every third crossing, so
  // the junctions read as signalised without flooding the scene with meshes.
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
        scene.add(pole);
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.set(x, 34, y);
        scene.add(head);
        for (let k = 0; k < 3; k += 1) {
          const lens = new THREE.Mesh(lensGeo, basicMat(lensCols[k]));
          lens.position.set(x, 39 - k * 4, y + sy * 2.1);
          if (sy < 0) lens.rotation.y = Math.PI;
          scene.add(lens);
        }
      }
    }
  }

  // Neon boards over the shop fronts: a bright fascia plus a bulb frame.
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
    scene.add(sign);
    signs.push(sign);
    const wash = halo(190, 0xffe08a, 0.5);
    wash.position.set(shop.x, 44, shop.y - 96);
    const core = halo(96, 0xfff4c0, 0.9);
    core.position.set(shop.x, 30, shop.y - 96);
  }
  const crane = makeCrane(2830, 2180);
  scene.add(crane);
}

/* ------------------------------------------------------------------- frame */

let lastHour = -1;
let env = null;

/** Pick the hour: the live clock, else noon, and pin it for stills. */
function hourFor(g) {
  // The title always opens at noon, whatever time the saved run ended at;
  // the clock takes over the moment play starts.
  if (g.state === 'title') return 12;
  if (g.shotHour !== null && g.shotHour !== undefined) return g.shotHour;
  if (typeof g.clock === 'number') return hourOf(g.clock);
  return 12;
}

/** Apply one solved environment to every atmosphere resource. */
function applyEnv(g, e) {
  env = e;
  const u = skyMat.uniforms;
  u.uTop.value.copy(e.sky);
  u.uHorizon.value.copy(e.horizon);
  u.uBottom.value.copy(e.water);
  u.uSunColor.value.copy(e.key);
  u.uSunDir.value.copy(e.dir);
  u.uStars.value = e.stars;

  key.color.copy(e.key);
  key.intensity = e.keyI * (e.shadow > 0 ? 1 : 0.9);
  hemi.color.copy(e.hemiSky);
  hemi.groundColor.copy(e.hemiGround);
  hemi.intensity = e.hemiI;
  fill.color.copy(e.hemiSky);
  fill.intensity = 0.10 + e.hemiI * 0.16;
  g.renderer.toneMappingExposure = e.exposure;

  if (scene.fog) {
    scene.fog.color.copy(e.fog);
    scene.fog.near = e.night ? 620 : 1000;
    scene.fog.far = e.night ? 2050 : 2850;
  }
  g.renderer.setClearColor(e.fog, 1);

  // Lit windows carry the night (see world3d's facade glow map): dim panes by
  // day, warm bright panes once the sun is down.
  const glow = 0.10 + e.windowGlow * 1.55;
  for (const mat of windowMats) mat.emissiveIntensity = glow;

  const lit = e.darkness;
  if (poolMat) poolMat.opacity = lit * 0.55;
  for (const sprite of halos) {
    const base = sprite.userData.base ?? 0.6;
    sprite.material.opacity = base * (0.06 + lit * 0.94);
  }
  for (const bulb of lamps) bulb.material.color.setHex(lit > 0.12 ? 0xfff3b0 : 0xcfc9b5);
  for (const sign of signs) sign.scale.setScalar(0.7 + lit * 0.3 + 0.3);

  if (sea) sea.material.map.colorSpace = THREE.SRGBColorSpace;
  if (sea) sea.material.color.copy(e.water).multiplyScalar(0.55 + (1 - e.darkness) * 0.55);
  if (spark) spark.material.opacity = 0.16 + e.darkness * 0.55;
}

/**
 * Frame hook: solve the clock only when it changed, keep the dome and the
 * shadow box on the camera, and let the sun's shadow follow the player.
 */
export function update(g, dt) {
  if (!sky) return;
  const hour = hourFor(g);
  if (hour !== lastHour) {
    lastHour = hour;
    applyEnv(g, solve(hour));
  }
  if (!env) applyEnv(g, solve(hour));

  const cam = g.camera;
  sky.position.set(cam.position.x, 0, cam.position.z);
  const p = g.player;
  // The key light sits a fixed slant range along the sun direction, so the
  // angle (and therefore the length) of every shadow follows the clock.
  key.position.set(p.x + env.dir.x * 900, env.dir.y * 900, p.y + env.dir.z * 900);
  key.target.position.set(p.x, 0, p.y);
  key.target.updateMatrixWorld();
  key.castShadow = env.shadow > 0.45 && level > 0;

  for (const palm of palms) {
    palm.rotation.z = Math.sin(g.time * 0.6 + palm.position.x * 0.01) * 0.018;
  }
  // Automatic quality: two and a half seconds under 42 fps drops one rung.
  // Stills pin the top rung, so a screenshot never changes on its own.
  if (g.shotHour === null || g.shotHour === undefined) {
    fpsFrames += 1;
    fpsTime += Math.min(0.1, dt);
    if (fpsTime > 2.5) {
      const fps = fpsFrames / fpsTime;
      fpsFrames = 0;
      fpsTime = 0;
      if (fps < 42 && level > 0) setQuality(level - 1);
    }
  }
  // The sea scrolls by wall-clock dt in live play only: a ?shot= still
  // must be the same picture whenever it is taken, so the water holds
  // still there (the same freeze the fps ladder above obeys).
  if (sea && (g.shotHour === null || g.shotHour === undefined)) {
    sea.material.map.offset.y = (sea.material.map.offset.y + dt * 0.012) % 1;
    spark.material.map.offset.x = (spark.material.map.offset.x + dt * 0.03) % 1;
  }
}

/** Quality ladder: 2 high, 1 medium, 0 low (shadow off, coarse map). */
export function setQuality(q) {
  level = Math.max(0, Math.min(2, q));
  if (!key) return;
  const size = [512, 1536, 2048][level];
  if (key.shadow.mapSize.x !== size) {
    key.shadow.mapSize.set(size, size);
    if (key.shadow.map) {
      key.shadow.map.dispose();
      key.shadow.map = null;
    }
  }
  if (gfxRenderer) gfxRenderer.shadowMap.enabled = level > 0;
  for (const palm of palms) palm.visible = level > 0;
}

let gfxRenderer = null;

/** Remember the renderer so the quality ladder can reach the shadow map. */
export function bindRenderer(renderer) {
  gfxRenderer = renderer;
}

/** Current quality level. */
export function qualityLevel() {
  return level;
}
