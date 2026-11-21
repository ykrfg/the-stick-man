// THE STICK MAN — main glue. Builds the world and the game state, runs the loop,
// routes input (start/pause, entering cars, talking to Bruno, the spray garage),
// drains the event queue that the other modules push into (crimes become heat,
// hits become sounds, boardings advance missions), drives the camera, and owns
// the run's start, busted and wasted flows. In ?shot= mode it instead poses one
// of the deterministic screenshot scenes from shots.js.
import * as THREE from 'three';
import {
  CAR, DAY_SECONDS, DAY_START, HEAT_FOR, MEAL_PRICE, PLAYER, ROBBERY_COOLDOWN, ROBBERY_HEAT,
  ROBBERY_RADIUS, ROBBERY_TIME, SHOT_HOUR, SPRAY_PER_STAR, TREAT_PRICE,
} from './config.js';
import { makeRng } from './random.js';
import { Input } from './input.js';
import { SoundFX } from './audio.js';
import { clearSave, freshSave, hasProgress, loadSave, storeSave } from './save.js';
import { buildCity } from './city.js';
import { buildWorld } from './world3d.js';
import { createFigure } from './stick3d.js';
import { computeTrafficWarnings, damageCar, drivePlayerCar, spawnParkedCars, spawnTrafficCar, updatePlayerCarHits, updateTraffic, updateWrecks } from './vehicles.js';
import { runOverPed, seatDriverFigure, spawnPeds, syncFigure, updatePeds, updatePlayerOnFoot } from './people.js';
import { spawnCashPickup, updateBullets, updateCombat, updatePickups } from './combat.js';
import { addHeat, updatePolice } from './police.js';
import {
  acceptJob, acceptMission, failMission, jobAvailable, missionAvailable, missionInteract, missionPrompt, missionsInit, onBoarded, updateMissions,
} from './missions.js';
import { drawHUD } from './hud.js';
import { setupShot, tickShot } from './shots.js';
import { detectMobile, initTouch } from './touch.js';
import { getLang, initLang, setLang, t } from './i18n.js';
import { bindRenderer, initGfx, setQuality, update as updateGfx } from './gfx.js';
import { initAudio, updateAudio } from './audio-director.js';
import { closeHowto, howtoOpen, initHowto, openHowto, syncHowto } from './howto.js';
import {
  callCar, closeCustomize, customizeOpen, economyBusy, economyInteract, fixerPrompt,
  initEconomy, openCustomize, resetEconomy, shopPrompt, spawnOwnedCars, syncCustomize,
  updateEconomy,
} from './economy.js';

const params = new URLSearchParams(location.search);
const shotName = params.get('shot');
const statusEl = document.getElementById('status');

// JP/EN language (src/i18n.js): default from the browser language, the
// player's choice persists under its own localStorage key. Shot mode
// forces English — the official screenshots are judged in an
// English-speaking context and must not change with a saved language.
initLang({ forceEn: !!shotName });

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 5, 4200);
const hudCanvas = document.getElementById('hud');
const hudCtx = hudCanvas.getContext('2d');

const rng = makeRng(params.get('seed') ? Number(params.get('seed')) : (Date.now() % 2147483647));
const city = buildCity(rng);

const g = {
  scene,
  camera,
  renderer,
  hudCtx,
  viewW: 1280,
  viewH: 720,
  city,
  rng,
  input: new Input(canvas),
  sfx: new SoundFX(),
  mobile: detectMobile(params.get('mobile') === '1'),
  state: 'title',
  time: 0,
  cars: [],
  peds: [],
  bullets: [],
  pickups: [],
  impacts: [],
  events: [],
  money: 0,
  earned: 0,
  heat: 0,
  stars: 0,
  bustProgress: 0,
  bustMax: 2.2,
  coolT: 0,
  cooling: false,
  policeSpawnCd: 0,
  policeNear: false,
  threat: null,
  passenger: null,
  nearestCar: null,
  message: null,
  toast: null,
  prompt: '',
  aimAngle: null,
  aimPoint: null,
  transition: null,
  garageT: 0,
  robbery: null, // { shop, t } while a hold-up is being stood through
  robbedAt: {}, // shop index -> g.time of its last completed hold-up
  shake: 0,
  // A landed punch stops the world for a few frames (see frame()): the
  // hit reads as weight, not as a hand passing through. Seconds of real
  // time left; only the play state's world update takes the freeze.
  hitstop: 0,
  lastFine: 0,
  // Progress-reset confirm state (title / pause): the first R press or
  // RESET PROGRESS tap arms it, a second within a few seconds wipes the
  // save; any other input, or the timer running out, disarms it.
  resetArm: { armed: false, t: 0 },
  saveData: shotName ? freshSave() : (loadSave() ?? freshSave()),
  // The day clock, in DAY_SECONDS from midnight. Saved; ?shot= pins its hour.
  clock: 0,
  shotHour: shotName ? SHOT_HOUR : null,
  shopOpen: null,
  stolenPins: [],
  shotMode: null,
  fixedCam: null,
  // GTA-style free camera state (play states only; the ?shot= scenes and the
  // title orbit never touch it). yaw/pitch orbit the hero, dist is the
  // smoothed slant range, collDist the building-collision limit on it.
  cam: {
    init: false, yaw: 0, pitch: 0.42, dist: 200, zoomIdx: 2,
    manualT: 99, collDist: 1e9, backBlend: 0, lookBack: false, occluded: false,
    rescue: 0,
    // Seconds left of the post-entry swing (see finishEnterCar): while
    // this runs, the control step eases the yaw behind the car the
    // player just climbed into, ahead of the movement auto-align.
    entryAlignT: 0,
  },
  say(title, sub = '', dur = 3.4) {
    g.message = { title, sub, t: dur, dur };
    statusEl.textContent = sub ? `${title}. ${sub}` : title;
  },
};

g.money = g.saveData.money ?? 0;
g.earned = g.saveData.earned ?? 0;
g.clock = typeof g.saveData.clock === 'number' ? g.saveData.clock : DAY_START;
const world = buildWorld(scene, g.city);
// Lit window panes: gfx.js drives their emissive strength from the clock.
g.windowMats = world.windowMats || [];

// The hero: a white-headed, black-bodied stick figure with a grin, spawned outside the diner.
const dinerDoor = g.city.landmarks.diner;
g.player = {
  x: dinerDoor.x - 62,
  y: dinerDoor.y + 34,
  angle: Math.PI / 2,
  moveAngle: Math.PI / 2,
  hp: PLAYER.maxHp,
  maxHp: PLAYER.maxHp,
  state: 'foot',
  car: null,
  fig: createFigure({ fill: 'white' }),
  speedNow: 0,
  dashT: 0,
  dashCd: 0,
  dashDirX: 1,
  dashDirY: 0,
  // Car-hit state (vehicles.js): post-hit invulnerability, the down
  // timer of a knockback, and the knockback velocity people.js carries.
  hurtT: 0,
  downT: 0,
  kbX: 0,
  kbY: 0,
  punchCd: 0,
  shotCd: 0,
  punchHitT: 0,
  aimT: 0,
  exprT: 0,
  hasPistol: g.saveData.hasPistol === true,
};
g.player.fig.setExpression('grin');
scene.add(g.player.fig.group);

// Two different hero tells, because they solve two different problems:
// - heroRing: a thin gold ring on the ground under the hero, ALWAYS on
//   during play. Pedestrian heads are tinted off-white now, but in a
//   crowd of white-headed stick figures the ring is what settles "which
//   one is me" at a glance. In a car it widens to ring the car instead.
// - heroMark: the chevron above his head, drawn through buildings (depth
//   test off) and shown only while a building actually hides the hero, so
//   he can never fully disappear behind one.
const heroRing = new THREE.Mesh(
  new THREE.RingGeometry(13.5, 15.2, 28),
  new THREE.MeshBasicMaterial({ color: 0xffd94d, transparent: true, opacity: 0.55, depthTest: false, side: THREE.DoubleSide }),
);
heroRing.rotation.x = -Math.PI / 2;
heroRing.renderOrder = 999;
heroRing.visible = false;
scene.add(heroRing);

const heroMark = new THREE.Group();
{
  const chev = new THREE.Mesh(
    new THREE.ConeGeometry(5.5, 11, 4),
    new THREE.MeshBasicMaterial({ color: 0xffd94d, transparent: true, opacity: 0.9, depthTest: false }),
  );
  chev.rotation.x = Math.PI; // point down at the hero
  chev.position.y = 52;
  chev.renderOrder = 999;
  heroMark.add(chev);
  heroMark.visible = false;
  scene.add(heroMark);
}

spawnParkedCars(g);
for (let i = 0; i < 7; i += 1) spawnTrafficCar(g);
g.bruno = spawnPeds(g, 15);
missionsInit(g);

// Atmosphere, economy and audio come up after the world and the hero exist.
initGfx(g);
bindRenderer(renderer);
initEconomy(g);
if (!shotName) spawnOwnedCars(g);
if (!shotName) initAudio(g);
if (!shotName) initHowto();
if (shotName) setQuality(2);

if (shotName) setupShot(g, shotName);

// Smartphone mode: virtual joystick + buttons feeding g.input (touch.js).
// Null on desktop, where nothing about the input path changes.
const touchUI = g.mobile && !shotName ? initTouch(g) : null;

// --- JP/EN toggle (title & pause screens) ---
// Two small DOM buttons overlaid top-center; the canvas title/pause text
// redraws every frame from the string table, so a switch re-renders the
// visible screen at once — only the DOM labels (reset button, touch
// buttons) need an explicit re-label pass, which applyLang drives.
g.lang = getLang();
const langToggleEl = document.getElementById('langToggle');
const langJaBtn = document.getElementById('langJa');
const langEnBtn = document.getElementById('langEn');
function applyLang() {
  g.lang = getLang();
  document.documentElement.lang = g.lang;
  langJaBtn.classList.toggle('on', g.lang === 'ja');
  langEnBtn.classList.toggle('on', g.lang === 'en');
  lastResetBtnKey = ''; // force the reset button to re-label in the new language
  syncResetBtn();
  if (touchUI) touchUI.relabel();
}
langJaBtn.addEventListener('click', () => { setLang('ja'); applyLang(); });
langEnBtn.addEventListener('click', () => { setLang('en'); applyLang(); });
let lastLangKey = '';
function syncLangToggle() {
  const show = !shotName && (g.state === 'title' || g.state === 'paused');
  const key = `${show}|${g.lang}`;
  if (key === lastLangKey) return;
  lastLangKey = key;
  langToggleEl.style.display = show ? 'flex' : 'none';
  langJaBtn.classList.toggle('on', g.lang === 'ja');
  langEnBtn.classList.toggle('on', g.lang === 'en');
}

// A handle for the headless play-test and screenshot scripts (and curious players
// in devtools): the whole game state, live.
window.__sm = g;
g.camera = camera; // debug handle for the headless camera checks
g.heroMark = heroMark;
// Let a headless harness that cannot rely on rAF (hidden window) still step
// and render a frame on demand, and let it write a shot at the 1280x720 size
// the official screenshots use.
window.__frame = () => frame(performance.now());
window.__resize = (w, h) => {
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  hudCanvas.width = w;
  hudCanvas.height = h;
  g.viewW = w;
  g.viewH = h;
};

function persist() {
  g.saveData.money = g.money;
  g.saveData.earned = g.earned;
  g.saveData.clock = g.clock;
  g.saveData.gear.pistol = g.player.hasPistol === true;
  storeSave(g.saveData);
}
g.persist = persist;

// --- Progress reset (title / pause screens, desktop and touch) ---
// One shared poke for the R key and the RESET PROGRESS button: the first
// poke arms the confirm, the second wipes. The wipe zeroes the in-memory
// save, clears localStorage and reloads the page, so the run that follows
// is a first-ever run by construction — no stale mission, money or pistol
// state can survive it.
const resetBtn = document.getElementById('btnReset');
let resetPokeAt = 0;

function disarmReset() {
  g.resetArm.armed = false;
  g.resetArm.t = 0;
}

function pokeReset() {
  const now = performance.now();
  if (now - resetPokeAt < 350) return; // a tap fires touchstart AND click
  resetPokeAt = now;
  // Never leave focus on the button: Enter/Space would re-click it, and an
  // armed reset must only ever be confirmed deliberately.
  resetBtn.blur();
  if (!hasProgress(g.saveData)) return;
  if (!g.resetArm.armed) {
    g.resetArm.armed = true;
    g.resetArm.t = 4;
    statusEl.textContent = t('status.resetArmed');
    return;
  }
  disarmReset();
  resetEconomy(g);
  g.saveData = freshSave();
  g.money = 0;
  g.earned = 0;
  clearSave();
  location.reload();
}
resetBtn.addEventListener('click', pokeReset);
resetBtn.addEventListener('touchstart', (event) => {
  event.preventDefault();
  pokeReset();
}, { passive: false });

let lastResetBtnKey = '';
function syncResetBtn() {
  const show = (g.state === 'title' || g.state === 'paused') && hasProgress(g.saveData);
  const key = `${show}|${g.resetArm.armed}|${g.lang}`;
  if (key === lastResetBtnKey) return;
  lastResetBtnKey = key;
  resetBtn.style.display = show ? 'block' : 'none';
  resetBtn.textContent = g.resetArm.armed ? t('btn.resetArmed') : t('btn.reset');
  resetBtn.classList.toggle('armed', g.resetArm.armed);
}

// --- HOW TO PLAY entry (title / pause screens, desktop and touch) ---
// Opens howto.js's full-screen sheet. It covers the chrome while open
// (its own z-index sits above every button), so the sync below only
// has to hide this entry behind it.
const howtoBtn = document.getElementById('btnHowto');
function pokeHowto() {
  howtoBtn.blur(); // Enter must never re-click it (see pokeReset)
  if (g.state === 'title' || g.state === 'paused') openHowto();
}
howtoBtn.addEventListener('click', pokeHowto);
howtoBtn.addEventListener('touchstart', (event) => {
  event.preventDefault();
  pokeHowto();
}, { passive: false });

let lastHowtoBtnKey = '';
function syncHowtoBtn() {
  const show = !shotName && (g.state === 'title' || g.state === 'paused') && !howtoOpen();
  const key = `${show}|${g.lang}`;
  if (key === lastHowtoBtnKey) return;
  lastHowtoBtnKey = key;
  howtoBtn.style.display = show ? 'block' : 'none';
  howtoBtn.textContent = t('btn.howto');
}

// --- CUSTOMIZE entry (pause screen only, desktop and touch) ---
// Opens economy.js's owned-items panel over the pause. The frame loop
// gives the panel the keys while it is up (Esc / Enter / P close it back
// to the pause, exactly like the HOW TO PLAY sheet), so a press can
// never leak through into a resume.
const customizeBtn = document.getElementById('btnCustomize');
function pokeCustomize() {
  customizeBtn.blur(); // Enter must never re-click it (see pokeReset)
  if (g.state === 'paused') openCustomize();
}
customizeBtn.addEventListener('click', pokeCustomize);
customizeBtn.addEventListener('touchstart', (event) => {
  event.preventDefault();
  pokeCustomize();
}, { passive: false });

let lastCustomizeBtnKey = '';
function syncCustomizeBtn() {
  const show = !shotName && g.state === 'paused' && !howtoOpen() && !customizeOpen();
  const key = `${show}|${g.lang}`;
  if (key === lastCustomizeBtnKey) return;
  lastCustomizeBtnKey = key;
  customizeBtn.style.display = show ? 'block' : 'none';
  customizeBtn.textContent = t('btn.customize');
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  hudCanvas.width = w;
  hudCanvas.height = h;
  g.viewW = w;
  g.viewH = h;
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
resize();

/** The nearest car the player could climb into, or null. */
function nearestEnterableCar() {
  const p = g.player;
  let best = null;
  let bestD = 56;
  for (const car of g.cars) {
    if (car.occupant === 'player' || car.wrecked) continue;
    // The courier car is never enterable: its driver is at the wheel
    // with the doors locked — stopping it is the COURIER HIT job, and
    // climbing in would strand the mission's case in a "stolen" car.
    if (car.kind === 'courier') continue;
    const d = Math.hypot(car.x - p.x, car.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}

/** Begin climbing into a car: a short crouched scramble to the driver's door. */
function startEnterCar(car) {
  const a = car.angle;
  g.transition = {
    kind: 'enter',
    car,
    t: 0,
    dur: 0.5,
    fromX: g.player.x,
    fromY: g.player.y,
    doorX: car.x + Math.sin(a) * 34,
    doorY: car.y - Math.cos(a) * 34,
  };
}

function finishEnterCar() {
  const car = g.transition.car;
  const p = g.player;
  g.transition = null;
  p.state = 'car';
  p.car = car;
  p.angle = car.angle;
  p.fig.target.crouch = 0;
  p.fig.target.reach = 0;
  p.fig.target.bank = 0;
  p.fig.target.aim = 0;
  car.occupant = 'player';
  // The car is the player's now — and the fleet systems key off `kind`:
  // traffic cars lane-drive themselves and despawn at range, police cars
  // chase their target and drive off to despawn when the heat dies. A taken
  // car therefore leaves its fleet here, at the one moment ownership
  // changes: traffic/police cars become free cars, and traffic gets a
  // replacement so the city stays alive. Without this, a stolen traffic car
  // fought its driver with lane-following the whole drive, drove itself
  // away the moment he stepped out, and then despawned — the "my car
  // disappeared" bug, up to and including while he was using it.
  if (!car.touched) {
    car.touched = true;
    if (car.kind === 'traffic') {
      car.kind = 'parked';
      spawnTrafficCar(g);
    } else if (car.kind === 'police') {
      car.kind = 'parked';
      if (car.lightL && car.lightR) {
        car.lightL.visible = true;
        car.lightR.visible = true;
      }
    }
  }
  p.fig.target.crouch = 0;
  // Getting into your OWN car is not a crime: the stealCar heat only
  // fires for a car that is not the player's (round #22 — before this,
  // every entry into a bought car cost 40 heat, a star at the first
  // threshold, as if it had been stolen).
  if (!car.owned) g.events.push({ type: 'crime', kind: 'stealCar', x: car.x, y: car.y });
  g.sfx.carDoor();
  // Swing the camera behind the car he just climbed into (round #23):
  // the on-foot yaw he arrived with can point anywhere, and until the
  // movement auto-align caught up (its 1.1 s hands-off gate, then a
  // 2.4/s ease) the first seconds of driving steered against a camera
  // facing the wrong way. The control step runs this swing over the
  // next ~0.3 s; a manual drag cancels it on the spot.
  g.cam.entryAlignT = 0.35;
}

function exitCar() {
  const p = g.player;
  const car = p.car;
  if (!car) return;
  const a = car.angle;
  const lx = -2;
  const ly = -6;
  const c = Math.cos(a);
  const s = Math.sin(a);
  // The figure is sitting at the seat offset, not on the car's centre.
  // The step-out starts there and swings to the door: a 0.3 s transition
  // so the hero climbs out instead of teleporting to the kerb. He is
  // already on foot for every gameplay system (state, collision, hits);
  // only the pose and the position are carried by the transition.
  const seatX = car.x + lx * c - ly * s;
  const seatY = car.y + lx * s + ly * c;
  p.x = seatX;
  p.y = seatY;
  p.angle = a;
  car.occupant = null;
  p.car = null;
  p.state = 'foot';
  p.fig.target.drive = 1; // the transition eases this out
  p.fig.target.bank = 0;
  p.fig.target.reach = 0.6;
  p.fig.shadow.visible = true;
  g.transition = {
    kind: 'exit',
    t: 0,
    dur: 0.32,
    fromX: seatX,
    fromY: seatY,
    doorX: car.x + Math.sin(a) * 36,
    doorY: car.y - Math.cos(a) * 36,
    angle: a,
  };
  g.sfx.carDoor();
}

function doBusted() {
  const fine = 60 + g.stars * 90;
  g.lastFine = fine;
  g.money = Math.max(0, g.money - fine);
  g.heat = 0;
  g.stars = 0;
  g.bustProgress = 0;
  g.robbery = null; // a hold-up in progress dies with the run's flow
  failMission(g);
  g.state = 'busted';
  g.sfx.hurt();
  persist();
  statusEl.textContent = t('status.busted', { fine });
}

function doWasted() {
  g.lastFine = 80;
  g.money = Math.max(0, g.money - 80);
  g.heat = 0;
  g.stars = 0;
  g.robbery = null; // a hold-up in progress dies with the run's flow
  failMission(g);
  g.state = 'wasted';
  g.sfx.hurt();
  persist();
  statusEl.textContent = t('status.wasted');
}

/** After busted/wasted: back on the street with full health, heat gone. */
function respawn() {
  const p = g.player;
  g.transition = null; // a scramble interrupted by a bust must not seat him later
  g.cam.init = false; // teleport: the free camera re-seats behind the hero
  const wasBusted = g.state === 'busted';
  if (p.car) {
    p.car.occupant = null;
    p.car = null;
  }
  p.state = 'foot';
  p.fig.target.drive = 0;
  p.fig.target.down = 0;
  p.downT = 0;
  p.hurtT = 0;
  p.kbX = 0;
  p.kbY = 0;
  p.fig.shadow.visible = true;
  // The safehouse, once bought, is the respawn point for both endings:
  // busted and wasted alike wake up at its door. Without it the old
  // split stands — the PD after a bust, the hospital after a wasting.
  const spot = g.saveData.safehouse
    ? g.city.landmarks.safehouse
    : (wasBusted ? g.city.landmarks.pd : g.city.landmarks.hospital);
  p.x = spot.x;
  p.y = spot.y + 12;
  p.hp = p.maxHp;
  g.state = 'play';
  g.say(wasBusted ? t('banner.released') : t('banner.discharged'), t('banner.respawn.sub'), 3);
}

/** Drain the event queue: crimes to heat, hits to sounds, story beats onward. */
function processEvents() {
  const p = g.player;
  for (const ev of g.events) {
    switch (ev.type) {
      case 'crime':
        addHeat(g, HEAT_FOR[ev.kind] ?? 10, ev.x, ev.y);
        break;
      case 'shot':
        g.sfx.shoot();
        addHeat(g, HEAT_FOR.shotFired, p.x, p.y);
        break;
      case 'punchhit':
        // A blow that put a man down gets the heavy connect; an ordinary
        // landed punch keeps the regular recorded hit.
        if (ev.down) g.sfx.punchHeavy(); else g.sfx.punch();
        // The world stops for a few frames on a landed blow. This is the
        // single biggest "the punch has weight" cue; it is short enough
        // (three frames) that it never reads as a stutter.
        g.hitstop = Math.max(g.hitstop, 0.05);
        break;
      case 'punchswing': g.sfx.swing(); break;
      case 'brake': g.sfx.brake(false); break;
      case 'brakeLong': g.sfx.brake(true); break;
      case 'screech': g.sfx.screech(ev.strength ?? 1); break;
      case 'cash':
        g.sfx.cash();
        g.toast = { text: `+$${ev.amount}`, t: 1.6 };
        break;
      case 'cashdrop': spawnCashPickup(g, ev.x, ev.y, ev.amount); break;
      case 'pickup': g.sfx.pickup(); break;
      case 'runover': {
        // Fighters dive and shrug off most of a hit (people.js); the
        // full damage lands only on ordinary pedestrians.
        runOverPed(g, ev.ped, ev.speed);
        g.sfx.punch();
        // Bruno himself never raises the heat: he only flinches, never
        // falls, so the per-tick runover events would stack a star a
        // frame for as long as the car rests against him. Everyone else
        // keeps the plain per-event heat, exactly as before.
        if (ev.byPlayer && ev.ped.role !== 'bruno') addHeat(g, HEAT_FOR.runOver, ev.ped.x, ev.ped.y);
        break;
      }
      case 'crash':
        g.sfx.crash(ev.strength);
        if (ev.byPlayer) {
          g.shake = Math.max(g.shake, ev.strength * 9);
          if (ev.strength > 0.45) addHeat(g, HEAT_FOR.hitCar, p.x, p.y);
        }
        break;
      case 'npcpunch': {
        g.sfx.punch();
        g.hitstop = Math.max(g.hitstop, 0.04);
        if (ev.targetCar && p.car) {
          // Fists drain the car 6 a hit; damageCar owns the crossing to
          // the wreck state (and the 'playerwreck' event below runs the
          // forced exit), so a car softened up before it was stolen can
          // still die here in a single hit. The car HP bar on the HUD is
          // the warning; the Spray 'n Go bay is the way back.
          damageCar(g, p.car, 6);
        } else {
          p.hp -= ev.ped.role === 'cop' ? 7 : 9;
          g.shake = Math.max(g.shake, 3);
        }
        break;
      }
      case 'playerwreck': {
        // The player's car reached hp 0 under him — crash damage or
        // fists (damageCar pushed this). The wreck stays where it died:
        // marked, tilted, unenterable, and — being player-owned since
        // it was taken — never cleaned up or driven away by a fleet.
        if (p.state === 'car' && p.car === ev.car) {
          exitCar();
          p.hp = Math.min(p.hp, 35);
          g.say(t('banner.wrecked.title'), t('banner.wrecked.sub'), 3);
        }
        break;
      }
      case 'busted': doBusted(); break;
      case 'starup':
        g.sfx.alarm();
        g.toast = { text: t('toast.wanted', { stars: '★'.repeat(ev.stars) }), t: 1.8 };
        break;
      case 'heatoff':
        g.say(t('banner.heatoff.title'), t('banner.heatoff.sub'), 3.2);
        g.sfx.tone('sine', 520, 780, 0.14, 0.09);
        break;
      case 'boarded': onBoarded(g); g.sfx.pickup(); break;
      case 'officer': g.sfx.tone('square', 520, 660, 0.07, 0.14); break;
      case 'missionstart': g.sfx.confirm(); break;
      case 'missiondone': g.sfx.confirm(); persist(); break;
      case 'pistol':
        g.say(t('banner.pistol.title'), t('banner.pistol.sub'), 4.2);
        g.sfx.pickup();
        break;
      case 'save': persist(); break;
      case 'spark': g.sfx.tone('square', 1250, 900, 0.03, 0.07); break;
      default: break;
    }
  }
  g.events.length = 0;
}

/**
 * Index of the shop whose hold-up zone the player is standing in, or -1.
 * The zone is the shop's whole frontage (ROBBERY_RADIUS around its door
 * point), not a doorstep spot: a hold-up can be started from anywhere at
 * the shop (round #23). The prompt chain and the E handler both read the
 * world through this one function, so they can never disagree about
 * where a hold-up may start.
 */
function shopZoneIndex(p) {
  for (let i = 0; i < g.city.shops.length; i += 1) {
    const s = g.city.shops[i];
    if (Math.hypot(p.x - s.x, p.y - s.y) < ROBBERY_RADIUS) return i;
  }
  return -1;
}

/**
 * A story collection or an odd-job collection owns this shop's door right
 * now: the mission takes the door, and a hold-up there could tangle the
 * collection's fight — so robbery simply waits its turn.
 */
function shopBusy(i) {
  const m = g.mission;
  if (m.active && m.index === 2 && m.shopStep === i) return true;
  const j = g.job;
  return !!(j && j.active && j.type === 'collection' && j.shopIndex === i);
}

/** Seconds until this shop can be held up again (0 = fair game). */
function robCooldownLeft(i) {
  const at = g.robbedAt[i];
  return at === undefined ? 0 : Math.max(0, ROBBERY_COOLDOWN - (g.time - at));
}

/** The till empties: payout, the law, and the shop's cooldown all land at once. */
function finishRobbery(i) {
  const shop = g.city.shops[i];
  const payout = 5 * g.rng.int(14, 26); // $70–130
  g.money += payout;
  g.earned += payout;
  g.robbedAt[i] = g.time;
  g.events.push({ type: 'cash', amount: payout });
  // Seen by definition — the keeper is staring straight at you.
  addHeat(g, ROBBERY_HEAT, shop.x, shop.y, { force: true });
  g.say(t('banner.heldup.title'), t('banner.heldup.sub', { shop: shop.name, payout: `$${payout}` }), 3.4);
  persist();
}

/** Compute the interaction prompt and the spray-garage service for this frame. */
function updateInteractions(dt) {
  const p = g.player;
  g.prompt = '';
  // Only the enter scramble owns the prompt line. The exit step-out
  // must not: he is on foot for every gameplay system from the moment
  // he leaves the seat, so his prompt (re-enter, talk, a service) has
  // to come up at once — gating it ate the press that followed.
  if (g.transition && g.transition.kind !== 'exit') return;
  if (p.state === 'foot') {
    const L = g.city.landmarks;
    if (g.robbery) {
      // A hold-up in progress owns the prompt line: stand in the shop
      // zone and watch it fill. Walking off is always an option — the
      // payout is forfeit, and that is the whole of the punishment.
      const r = g.robbery;
      const shop = g.city.shops[r.shop];
      if (!shop || Math.hypot(p.x - shop.x, p.y - shop.y) > ROBBERY_RADIUS) {
        g.robbery = null;
        g.say(t('banner.holdupOff.title'), t('banner.holdupOff.sub'), 2.4);
      } else {
        r.t += dt;
        const pct = Math.min(100, Math.floor((r.t / ROBBERY_TIME) * 100));
        g.prompt = t('prompt.holdingUp', { shop: shop.name, pct });
        if (r.t >= ROBBERY_TIME) {
          g.robbery = null;
          finishRobbery(r.shop);
        }
      }
      return;
    }
    if (fixerPrompt(g)) {
      g.prompt = fixerPrompt(g);
      return;
    }
    // Affordability gate (round #22): an action the player cannot pay
    // for never claims the prompt or the E press. A hurt player with
    // less than the meal price used to be trapped here — every press
    // bought a meal he could not afford, and Bruno's work behind the
    // meal branch was unreachable. Among AFFORDABLE actions the
    // round #21 order stands unchanged: talk (in the fixer yield and
    // below) / meal / fixer.
    if (p.hp < p.maxHp && g.money >= MEAL_PRICE && Math.hypot(p.x - L.diner.x, p.y - L.diner.y) < 64) {
      // A hurt player at the counter eats first: Bruno's work (story or
      // odd job) is one step to his side, and the meal would otherwise
      // be unreachable in free roam, where a job is always on offer.
      g.prompt = t('prompt.meal', { price: `$${MEAL_PRICE}` });
    } else if (p.hp < p.maxHp && g.money >= TREAT_PRICE && Math.hypot(p.x - L.hospital.x, p.y - L.hospital.y) < 64) {
      g.prompt = t('prompt.treat', { price: `$${TREAT_PRICE}` });
    } else if (Math.hypot(p.x - g.bruno.x, p.y - g.bruno.y) < 50 && (missionAvailable(g) || jobAvailable(g))) {
      g.prompt = t('prompt.talk');
    } else if (missionPrompt(g)) {
      // A mission grab spot (the courier's case, the raid's crate) owns
      // its prompt, ahead of the shop doors below.
      g.prompt = missionPrompt(g);
    } else if (shopZoneIndex(p) >= 0) {
      const si = shopZoneIndex(p);
      if (shopBusy(si)) {
        // The mission owns this door: no robbery prompt, no note.
      } else if (robCooldownLeft(si) > 0) {
        g.prompt = t('prompt.recentlyHit', { shop: g.city.shops[si].name });
      } else {
        g.prompt = t('prompt.holdup', { shop: g.city.shops[si].name });
      }
    } else if (shopPrompt(g)) {
      g.prompt = shopPrompt(g);
    } else if (nearestEnterableCar()) {
      // Your own car is not a theft, and the prompt must not call it one.
      g.prompt = t(nearestEnterableCar().owned ? 'prompt.ownCar' : 'prompt.stealCar');
    } else {
      // The one car that will never open its door: the courier, driver
      // at the wheel, doors locked. It used to refuse in silence — the
      // player bumped into a solid car, got no prompt, and read it as
      // a bug. A deliberate refusal has to SAY why: during COURIER HIT
      // the line points at the job; afterwards (a stopped courier
      // stays in the world) it just names the driver. No "E —" prefix:
      // there is no action here, and the prefix would put it on the
      // touch USE button as if there were.
      const courier = g.cars.find((c) => c.kind === 'courier'
        && Math.hypot(c.x - p.x, c.y - p.y) < 64);
      if (courier) {
        g.prompt = g.mission.active && g.mission.index === 4
          ? t('prompt.courierMission')
          : t('prompt.courierDriver');
      }
    }
    return;
  }
  // In a car: the Spray 'n Go bay is a full service while you hold still —
  // fresh paint washes the heat off, and the same visit repairs the car,
  // so a damaged car has a way back that does not need any heat at all.
  const zone = g.city.garageZone;
  const inZone = p.car
    && p.x > zone.x - 10 && p.x < zone.x + zone.w + 10
    && p.y > zone.y - 10 && p.y < zone.y + zone.h + 10;
  const damaged = !!p.car && p.car.hp < 100;
  if (inZone && p.car && Math.abs(p.car.speed) < 25 && (g.heat > 0 || damaged)) {
    const repairFee = damaged ? Math.max(15, Math.round((100 - p.car.hp) * 0.5)) : 0;
    const cost = (g.heat > 0 ? Math.max(40, g.stars * SPRAY_PER_STAR) : 0) + repairFee;
    const what = g.heat > 0 && damaged ? t('spray.what.both') : damaged ? t('spray.what.repair') : t('spray.what.paint');
    g.prompt = t('prompt.spray', { what, cost: `$${cost}` });
    g.garageT += dt;
    if (g.garageT > 1.1) {
      g.garageT = -2.5;
      if (g.money >= cost) {
        const hadHeat = g.heat > 0;
        g.money -= cost;
        g.heat = 0;
        g.stars = 0;
        p.car.hp = 100;
        g.say(t('spray.title'), hadHeat && damaged
          ? t('spray.sub.both')
          : damaged
            ? t('spray.sub.repair')
            : t('spray.sub.paint'), 3);
        g.sfx.cash();
        persist();
      } else {
        g.say(t('spray.title'), t('spray.sub.broke'), 2.4);
      }
    }
  } else {
    g.garageT = Math.max(0, g.garageT - dt * 2);
    if (p.car && Math.abs(p.car.speed) < 45) g.prompt = t('prompt.exitCar');
  }
}

/**
 * Buy back health at a fixed spot: a meal at Bruno's, treatment at St. Palm.
 * Forgiving on purpose — this is the convenience route back from a beating:
 * the full price buys a full restore, and a short purse buys the share of
 * it the player can afford, charged only what they actually had.
 */
function healAt(name, fullPrice, okLine, brokeLine) {
  const p = g.player;
  const missing = p.maxHp - p.hp;
  if (missing <= 0) return;
  if (g.money <= 0) {
    g.say(name, brokeLine, 2.6);
    g.sfx.tone('triangle', 160, 110, 0.08, 0.12);
    return;
  }
  const frac = Math.min(1, g.money / fullPrice);
  const healed = Math.max(1, Math.round(missing * frac));
  const cost = Math.ceil(fullPrice * frac);
  g.money -= cost;
  p.hp = Math.min(p.maxHp, p.hp + healed);
  g.say(name, t('heal.result', { line: okLine, healed, cost: `$${cost}` }), 2.8);
  g.sfx.cash();
  persist();
}

/** Handle the E key: talk, heal, steal, or climb out — in that order. */
function handleInteract() {
  const p = g.player;
  if (g.transition && g.transition.kind !== 'exit') return;
  if (g.transition) {
    // An E press during the step-out is a real order, not noise to
    // swallow: drop the exit carry where he stands and handle the
    // press from there (re-enter, talk, grab — whatever is in range).
    g.transition = null;
    p.fig.target.crouch = 0;
    p.fig.target.reach = 0;
    p.fig.target.drive = 0;
  }
  if (p.state === 'foot') {
    if (g.robbery) return; // E does nothing while a hold-up is being stood through
    if (economyInteract(g)) return;
    const L = g.city.landmarks;
    if (p.hp < p.maxHp && g.money >= MEAL_PRICE && Math.hypot(p.x - L.diner.x, p.y - L.diner.y) < 64) {
      healAt("BRUNO'S", MEAL_PRICE, t('heal.meal.ok'), t('heal.meal.broke'));
      return;
    }
    if (p.hp < p.maxHp && g.money >= TREAT_PRICE && Math.hypot(p.x - L.hospital.x, p.y - L.hospital.y) < 64) {
      healAt('ST. PALM', TREAT_PRICE, t('heal.treat.ok'), t('heal.treat.broke'));
      return;
    }
    if (Math.hypot(p.x - g.bruno.x, p.y - g.bruno.y) < 50 && (missionAvailable(g) || jobAvailable(g))) {
      // Story work first: odd jobs only exist once no story job does, so
      // this counter never has to choose between the two out loud. (A
      // hurt player eats first — see the prompt order above.)
      if (missionAvailable(g)) acceptMission(g);
      else acceptJob(g);
      return;
    }
    if (missionInteract(g)) return; // a mission grab spot takes the press
    const si = shopZoneIndex(p);
    if (si >= 0 && !shopBusy(si) && robCooldownLeft(si) <= 0) {
      g.robbery = { shop: si, t: 0 };
      g.say(t('banner.holdup.title'), t('banner.holdup.sub', { shop: g.city.shops[si].name }), 2.2);
      return;
    }
    const car = nearestEnterableCar();
    if (car) startEnterCar(car);
  } else if (p.car && Math.abs(p.car.speed) < 45) {
    exitCar();
  }
}

/**
 * Where the mouse is pointing in the world (for aiming), as an angle or
 * null. The ground point itself is kept in g.aimPoint: a click lands on a
 * figure's body long before it lands on his feet, so the ground point is
 * what "near the click" means when combat looks for an enemy to face.
 */
function computeAimAngle() {
  const p = g.player;
  const ndc = new THREE.Vector2(
    (g.input.mouse.x / g.viewW) * 2 - 1,
    -(g.input.mouse.y / g.viewH) * 2 + 1,
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const { origin, direction } = ray.ray;
  if (direction.y > -0.05) { g.aimPoint = null; return null; }
  const t = -origin.y / direction.y;
  const wx = origin.x + direction.x * t;
  const wz = origin.z + direction.z * t;
  g.aimPoint = { x: wx, z: wz };
  return Math.atan2(wz - p.y, wx - p.x);
}

const camPos = new THREE.Vector3(900, 420, 300);
const camLook = new THREE.Vector3(1270, 10, 1100);

/** Move the camera for the current state: title orbit, foot follow, car chase. */
// GTA-style camera zoom steps (slant range from the hero). Round #22:
// every step 20% closer than the original [140, 190, 250, 330], in the
// direction of the top-ranked games' character-forward framing — the
// default (index 2) is now 200. The pitch-rescue floor, the in-car
// 1.2x and the speed lift all key off the chosen step, so they follow
// automatically; the ?shot= cameras are separate and untouched.
const ZOOM_STEPS = [112, 152, 200, 264];

/** Shortest signed arc from angle a to angle b, in (-PI, PI]. */
function angleArc(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Nearest distance along the ray (origin + dir * t, dir normalised) at which
 * it enters a building's box — footprint [b.x, b.x+b.w] x [b.y, b.y+b.h],
 * height the visual height including the parapet — or Infinity when the ray
 * stays clear for maxT units. Drives both the camera collision (nothing may
 * sit between the anchor and the camera) and the hero-occlusion test.
 */
function rayBuildingT(ox, oy, oz, dx, dy, dz, maxT) {
  let best = Infinity;
  for (const b of g.city.buildings) {
    const top = b.height * 1.9 + 5;
    let t0 = 0;
    let t1 = maxT;
    if (Math.abs(dx) < 1e-9) {
      if (ox < b.x || ox > b.x + b.w) continue;
    } else {
      let ta = (b.x - ox) / dx;
      let tb = (b.x + b.w - ox) / dx;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    if (Math.abs(dy) < 1e-9) {
      if (oy < 0 || oy > top) continue;
    } else {
      let ta = -oy / dy;
      let tb = (top - oy) / dy;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    if (Math.abs(dz) < 1e-9) {
      if (oz < b.y || oz > b.y + b.h) continue;
    } else {
      let ta = (b.y - oz) / dz;
      let tb = (b.y + b.h - oz) / dz;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    if (t0 < best) best = t0;
  }
  return best;
}

/** Seat the free camera behind the hero (entering play, or respawning). */
function seatCamera() {
  const p = g.player;
  const cam = g.cam;
  const inCar = p.state === 'car' && !!p.car;
  const facing = inCar ? p.car.angle : p.angle;
  cam.yaw = facing + Math.PI;
  cam.dist = ZOOM_STEPS[cam.zoomIdx] * (inCar ? 1.2 : 1);
  cam.collDist = cam.dist;
  cam.rescue = 0;
  cam.backBlend = 0;
  cam.init = true;
  const cp0 = Math.cos(cam.pitch);
  camPos.set(
    p.x + Math.cos(cam.yaw) * cp0 * cam.dist,
    18 + Math.sin(cam.pitch) * cam.dist,
    p.y + Math.sin(cam.yaw) * cp0 * cam.dist,
  );
}

/**
 * Settle the free camera's control state for this frame — manual orbit,
 * zoom steps, look-back blend and the GTA auto-align — BEFORE the world
 * updates, so on-foot movement (people.js) reads the exact yaw the camera
 * will render with this frame (g.cam.yaw + PI * g.cam.backBlend) and
 * stays camera-relative. Positioning happens later in updateCamera.
 */
function updateCameraControl(dt) {
  const p = g.player;
  const cam = g.cam;
  const inCar = p.state === 'car' && !!p.car;

  if (!cam.init) seatCamera();

  // Manual orbit: right/middle mouse drag on desktop, free-area drag on
  // touch — both arrive as input.orbit pixel deltas.
  const orb = g.input.orbit;
  if (orb.dx !== 0 || orb.dy !== 0) {
    cam.yaw += orb.dx * 0.0052;
    cam.pitch = Math.max(0.05, Math.min(1.3, cam.pitch + orb.dy * 0.0052));
    cam.manualT = 0;
    // A drag is the player taking the camera: the post-entry swing
    // (below) yields to it at once and does not resume afterwards.
    cam.entryAlignT = 0;
  } else {
    cam.manualT += dt;
  }
  if (g.input.wheelSteps !== 0) {
    cam.zoomIdx = Math.max(0, Math.min(ZOOM_STEPS.length - 1, cam.zoomIdx + g.input.wheelSteps));
  }
  // Auto-align: while the hero moves and the user is not orbiting, ease
  // back behind the direction he is actually travelling (his moveAngle —
  // which the camera-relative movement derives from this very yaw, so the
  // on-screen direction of travel holds steady while the camera eases).
  const lookBack = g.input.down('KeyQ') || g.input.middleDown;
  cam.lookBack = lookBack;
  const moving = inCar ? Math.abs(p.car.speed) > 45 : p.speedNow > 40;
  if (cam.entryAlignT > 0) {
    // Post-entry swing (round #23): for ~0.3 s after finishEnterCar,
    // ease the yaw behind the car at a fast rate — movement or not, so
    // the car is framed before the player even touches the throttle.
    // Look-back still wins while held; the window simply runs out.
    cam.entryAlignT = Math.max(0, cam.entryAlignT - dt);
    if (inCar && !lookBack) {
      cam.yaw += angleArc(cam.yaw, p.car.angle + Math.PI) * (1 - Math.exp(-14 * dt));
    }
  } else if (moving && cam.manualT > 1.1 && !lookBack) {
    const behind = inCar ? p.car.angle : (p.moveAngle ?? p.angle);
    const rate = inCar ? 2.4 : 1.7;
    cam.yaw += angleArc(cam.yaw, behind + Math.PI) * (1 - Math.exp(-rate * dt));
  }
  cam.backBlend += ((lookBack ? 1 : 0) - cam.backBlend) * (1 - Math.exp(-16 * dt));
}

function updateCamera(dt) {
  const p = g.player;
  if (g.fixedCam) {
    camera.position.set(g.fixedCam.pos.x, g.fixedCam.pos.y, g.fixedCam.pos.z);
    camera.lookAt(g.fixedCam.look.x, g.fixedCam.look.y, g.fixedCam.look.z);
    return;
  }
  if (g.state === 'title') {
    // The title keeps its slow cinematic orbit, exactly as before.
    const a = g.time * 0.07;
    const k = 1 - Math.exp(-2 * dt);
    camPos.x += (1270 + Math.cos(a) * 620 - camPos.x) * k;
    camPos.y += (330 - camPos.y) * k;
    camPos.z += (1100 + Math.sin(a) * 620 - camPos.z) * k;
    camLook.x += (1270 - camLook.x) * k;
    camLook.y += (0 - camLook.y) * k;
    camLook.z += (1100 - camLook.z) * k;
    camera.position.copy(camPos);
    if (camera.fov !== 55) { camera.fov = 55; camera.updateProjectionMatrix(); }
    heroMark.visible = false;
    heroRing.visible = false;
    camera.lookAt(camLook);
    return;
  }

  // --- GTA-style free camera for the play states ---
  const cam = g.cam;
  const inCar = p.state === 'car' && !!p.car;
  const facing = inCar ? p.car.angle : p.angle;
  const speedFrac = inCar ? Math.min(1, Math.abs(p.car.speed) / CAR.maxSpeed) : 0;
  const anchor = { x: p.x, y: 18, z: p.y };

  // Control state (yaw, pitch, zoom, look-back, auto-align) was settled
  // earlier in the frame by updateCameraControl; this only positions the
  // camera. Seat defensively for paths that arrive here without a control
  // step (the title -> play transition frame).
  if (!cam.init) seatCamera();

  // Distance: zoom step, more room in a car, a small lift with speed.
  const distTarget = ZOOM_STEPS[cam.zoomIdx] * (inCar ? 1.2 : 1) * (1 + 0.22 * speedFrac);
  cam.dist += (distTarget - cam.dist) * (1 - Math.exp(-6 * dt));

  const yawEff = cam.yaw + Math.PI * cam.backBlend;

  // Building collision: the camera may never have a building between itself
  // and the hero. Pull in instantly, ease back out — no popping.
  //
  // Pitch rescue: the pull-in alone has no floor, so with a wall anywhere
  // near the hero's back the camera collapsed to the bare gap (measured:
  // 21 units with the hero 25 from a wall, 7 hugging it) whatever zoom step
  // was chosen, and the screen filled with wall. So when the ray at the
  // player's pitch would force the camera closer than the floor (a fixed
  // fraction of the chosen distance), trade pitch for distance instead: a
  // steeper ray meets the same wall later in slant range (and clears low
  // roofs outright), so the camera stays back and looks down over the hero
  // with the surroundings readable. The rescue amount eases in and out
  // (cam.rescue), the search runs only while blocked, and the collision
  // test always runs at the pitch actually rendered — so the no-clip
  // guarantee holds at every step of the ease, with the hard clamp below
  // still standing as the final backstop.
  const floorDist = Math.max(48, cam.dist * 0.35);
  const hitAt = (pitch) => {
    const c = Math.cos(pitch);
    return rayBuildingT(anchor.x, anchor.y, anchor.z,
      Math.cos(yawEff) * c, Math.sin(pitch), Math.sin(yawEff) * c, cam.dist);
  };
  let rescueT = 0;
  if (hitAt(cam.pitch) < floorDist + 6) {
    rescueT = 0.9; // best effort: the steepest candidate still buys distance
    for (const extra of [0.3, 0.55, 0.9]) {
      if (hitAt(Math.min(1.32, cam.pitch + extra)) >= floorDist + 6) { rescueT = extra; break; }
    }
  }
  // Rise fast (the dip before it bites is a frame or two), release slower
  // so skirting a wall does not sawtooth the view pitch.
  const rescueRate = rescueT > cam.rescue ? 12 : 6;
  cam.rescue += (rescueT - cam.rescue) * (1 - Math.exp(-rescueRate * dt));
  if (Math.abs(cam.rescue - rescueT) < 0.01) cam.rescue = rescueT;
  const pitchEff = Math.min(1.32, cam.pitch + cam.rescue);
  const hitT = hitAt(pitchEff);
  // Stay a margin in front of the blocker; when the hero hugs a wall the
  // clearance is only a few units, so the floor scales with the hit distance
  // instead of overshooting into the building.
  const allowed = hitT === Infinity ? cam.dist : (hitT > 14 ? hitT - 6 : Math.max(6, hitT * 0.55));
  if (allowed < cam.collDist) cam.collDist = allowed;
  else cam.collDist += (allowed - cam.collDist) * (1 - Math.exp(-5.5 * dt));
  const effDist = Math.min(cam.dist, cam.collDist);
  cam.lift = pitchEff - cam.pitch;
  const cpE = Math.cos(pitchEff);
  const dirE = { x: Math.cos(yawEff) * cpE, y: Math.sin(pitchEff), z: Math.sin(yawEff) * cpE };

  const tx = anchor.x + dirE.x * effDist;
  const ty = Math.max(7, anchor.y + dirE.y * effDist);
  const tz = anchor.z + dirE.z * effDist;
  const k = 1 - Math.exp(-12 * dt);
  camPos.x += (tx - camPos.x) * k;
  camPos.y += (ty - camPos.y) * k;
  camPos.z += (tz - camPos.z) * k;
  // Hard guarantee on the smoothed result: if a building still blocks the
  // anchor->camera segment, pull the camera in front of it.
  {
    const dx = camPos.x - anchor.x;
    const dy = camPos.y - anchor.y;
    const dz = camPos.z - anchor.z;
    const len = Math.hypot(dx, dy, dz);
    if (len > 1) {
      const t = rayBuildingT(anchor.x, anchor.y, anchor.z, dx / len, dy / len, dz / len, len);
      if (t < len - 1) {
        const d2 = t > 12 ? t - 5 : Math.max(5, t * 0.55);
        camPos.set(
          anchor.x + (dx / len) * d2,
          Math.max(7, anchor.y + (dy / len) * d2),
          anchor.z + (dz / len) * d2,
        );
      }
    }
  }
  camera.position.copy(camPos);
  if (g.shake > 0.1) {
    camera.position.x += (Math.random() - 0.5) * g.shake;
    camera.position.y += (Math.random() - 0.5) * g.shake * 0.6;
    g.shake *= Math.exp(-7 * dt);
  }
  // Look at the hero, a little ahead of him — further ahead at car speed.
  const ahead = inCar ? 40 : 12;
  camLook.set(anchor.x + Math.cos(facing) * ahead, 14, anchor.z + Math.sin(facing) * ahead);
  camera.lookAt(camLook);

  // A slight FOV lift while driving fast.
  const fovT = 55 + (inCar ? 9 * speedFrac : 0);
  if (Math.abs(camera.fov - fovT) > 0.05) {
    camera.fov += (fovT - camera.fov) * (1 - Math.exp(-5 * dt));
    camera.updateProjectionMatrix();
  }

  // Occlusion fallback: if a building still hides the hero from the final
  // camera (anchor ray clear but the hero's head behind a corner), show the
  // through-walls marker so he never fully disappears.
  const hx = p.x - camera.position.x;
  const hy = 22 - camera.position.y;
  const hz = p.y - camera.position.z;
  const hLen = Math.hypot(hx, hy, hz);
  const blocked = hLen > 1
    && rayBuildingT(camera.position.x, camera.position.y, camera.position.z, hx / hLen, hy / hLen, hz / hLen, hLen) < hLen * 0.97;
  cam.occluded = blocked;
  heroMark.visible = blocked && (g.state === 'play' || g.state === 'paused');
  if (heroMark.visible) {
    heroMark.position.set(p.x, 0, p.y);
    heroMark.children[0].position.y = 52 + Math.sin(g.time * 3.2) * 4;
  }
  // The ground ring is the permanent tell: on whenever the run is live,
  // under the hero on foot, widened around his car while he drives.
  heroRing.visible = g.state === 'play' || g.state === 'paused';
  if (heroRing.visible) {
    const anchor = inCar && p.car ? p.car : p;
    heroRing.position.set(anchor.x, 0.8, anchor.y);
    const s = inCar ? 4.3 : 1;
    heroRing.scale.set(s, s, 1);
    heroRing.material.opacity = (inCar ? 0.32 : 0.5) + Math.sin(g.time * 2.6) * 0.13;
  }
}

/** Engine and siren loops follow the world state. */
function updateAudioState() {
  const driving = g.state === 'play' && g.player.state === 'car' && !!g.player.car;
  g.sfx.setEngine(driving, driving ? Math.abs(g.player.car.speed) / CAR.maxSpeed : 0);
  g.sfx.setSiren(g.state === 'play' && g.stars > 0 && g.policeNear);
}

let last = performance.now();
let autosaveT = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (shotName) dt = 1 / 30;
  g.time += dt;
  const input = g.input;

  if (input.tapped('KeyM')) g.sfx.setMuted(!g.sfx.muted);

  if (shotName) {
    tickShot(g, dt);
    updateMissions(g, dt, g.time);
    updateCamera(dt);
    updateGfx(g, dt);
    drawHUD(g);
    renderer.render(scene, camera);
    g.shotFrames = (g.shotFrames ?? 0) + 1;
    if (g.shotFrames > 45) window.__shotReady = true;
    input.endFrame();
    return;
  }

  if (customizeOpen()) {
    // The CUSTOMIZE panel owns the keys while it is up (over the
    // pause): a close key shuts it back to the pause menu, and the
    // press that closes it must not also resume — one Esc press closes
    // exactly one layer, the same rule as the HOW TO PLAY sheet below.
    if (input.tapped('Escape', 'Enter', 'KeyP')) closeCustomize();
  } else if (howtoOpen()) {
    // The HOW TO PLAY sheet owns the keys while it is up: a close key
    // shuts it, and nothing leaks into the title's start, the pause's
    // resume or a reset underneath. The world keeps rendering behind
    // the sheet (it is a DOM cover), frozen in its current state.
    if (input.tapped('Escape', 'Enter', 'KeyP')) closeHowto();
  } else if (g.state === 'title') {
    if (input.tapped('KeyR')) {
      pokeReset();
    } else if (g.resetArm.armed && (input.pressed.size > 0 || input.mouse.clicked)) {
      disarmReset(); // any other input cancels an armed reset
    }
    if (input.tapped('Enter')) {
      g.sfx.unlock();
      g.state = 'play';
      g.say(t('banner.welcome.title'), t('banner.welcome.sub'), 4.2);
      statusEl.textContent = t('status.welcome');
    }
  } else if (g.state === 'busted' || g.state === 'wasted') {
    if (input.tapped('Enter')) respawn();
  } else if (g.state === 'paused') {
    if (input.tapped('KeyR')) {
      pokeReset();
    } else if (input.tapped('KeyP', 'Enter', 'Escape')) {
      // Esc resumes, exactly like P / Enter (round #23). Opening the
      // pause stays P-only — Escape in play does nothing.
      disarmReset();
      g.state = 'play';
    }
  } else if (g.state === 'play') {
    if (economyBusy(g)) {
      // A shop tray owns the frame: the world holds still behind it.
    } else if (input.tapped('KeyP')) {
      g.state = 'paused';
    } else {
      // Camera control first: movement below reads the yaw settled here.
      updateCameraControl(dt);
      const p = g.player;
      // Hit stop: a landed punch freezes the WORLD for a few frames —
      // camera, HUD, banners and input keep running on real dt. A zero
      // world-dt leaves every damping value where it was and holds the
      // strike at the exact frame of contact, which is what gives a
      // punch its weight. It gates the world update only, never a timer
      // the player is waiting on for more than a few frames.
      const wdt = g.hitstop > 0 ? 0 : dt;
      if (g.hitstop > 0) g.hitstop = Math.max(0, g.hitstop - dt);
      g.clock = (g.clock + dt) % DAY_SECONDS;
      if (g.transition?.kind === 'exit') {
        // Stepping out: from the seat to the kerb, rising out of the
        // drive pose while the reach comes down off the door. The
        // carry owns his position only while he is still where it
        // left him last frame: anything that moves him off the path
        // (a hit, a shove, a knockback landing) ends the carry on
        // the spot instead of dragging him back to the kerb line,
        // and the normal on-foot update takes him from where he is.
        const tr = g.transition;
        const lx = tr.px ?? tr.fromX;
        const ly = tr.py ?? tr.fromY;
        if (Math.hypot(p.x - lx, p.y - ly) > 3) {
          g.transition = null;
          p.fig.target.crouch = 0;
          p.fig.target.reach = 0;
          p.fig.target.drive = 0;
          updatePlayerOnFoot(g, wdt);
          syncFigure(p, wdt, g.time);
        } else {
          tr.t += wdt;
          const k = Math.min(1, tr.t / tr.dur);
          const e = k * k * (3 - 2 * k);
          p.x = tr.fromX + (tr.doorX - tr.fromX) * e;
          p.y = tr.fromY + (tr.doorY - tr.fromY) * e;
          tr.px = p.x;
          tr.py = p.y;
          p.angle = tr.angle;
          p.fig.target.drive = Math.max(0, 1 - e * 1.35);
          p.fig.target.crouch = Math.sin(Math.min(1, k) * Math.PI) * 0.55;
          p.fig.target.reach = Math.max(0, 1 - k * 1.8);
          p.fig.target.bank = 0;
          p.speedNow = 90 * (1 - e);
          syncFigure(p, wdt, g.time);
          if (k >= 1) {
            g.transition = null;
            p.fig.target.crouch = 0;
            p.fig.target.reach = 0;
          }
        }
      } else if (g.transition) {
        const tr = g.transition;
        if (tr.car.wrecked || !g.cars.includes(tr.car)) {
          // The car died (or was removed) mid-scramble: there is no
          // seat to take, so the scramble just ends where he stands.
          g.transition = null;
          p.fig.target.crouch = 0;
          p.fig.target.reach = 0;
        } else {
          // The door is wherever the car is NOW, not where it was when
          // E was pressed: a moving car does not wait for a man
          // scrambling at its side, and the old fixed door point left
          // him arriving at an empty patch of road and teleporting in
          // (or, to the player, looking like the car refused him).
          // Tracking the door makes him run alongside and climb in as
          // it rolls — and a stopped car behaves exactly as before.
          // The approach eases in and out, the body faces the car and
          // the right hand comes up to the handle in the last half:
          // a scramble, not a slide.
          const a = tr.car.angle;
          tr.doorX = tr.car.x + Math.sin(a) * 34;
          tr.doorY = tr.car.y - Math.cos(a) * 34;
          tr.t += wdt;
          const k = Math.min(1, tr.t / tr.dur);
          const e = k * k * (3 - 2 * k);
          p.x = tr.fromX + (tr.doorX - tr.fromX) * e;
          p.y = tr.fromY + (tr.doorY - tr.fromY) * e;
          // Face the CAR, never the door point (round #24): the old
          // target was the door point itself, whose direction diverges
          // from the car everywhere but a straight-on approach — a man
          // who pressed E standing between the car and its door (inside
          // the 34-unit door ring, the natural spot after walking up to
          // the flank) had the door BEHIND him and turned his back to
          // the car for the whole scramble (178 degrees of error,
          // entry-facing-probe G1); flank approaches ended ~90 degrees
          // off, and a man already at the door got atan2(0, 0). The
          // direction to the car's centre is the door's inward normal
          // exactly at the door and stays meaningful on every approach
          // — except within a step of the centre itself, where there
          // is no direction to face and the ease simply holds.
          const fdx = tr.car.x - p.x;
          const fdy = tr.car.y - p.y;
          if (fdx * fdx + fdy * fdy > 1 && wdt > 0) {
            const face = Math.atan2(fdy, fdx);
            p.angle += angleArc(p.angle, face) * (1 - Math.exp(-10 * wdt));
          }
          p.fig.target.crouch = Math.sin(k * Math.PI) * 0.9;
          p.fig.target.reach = k > 0.35 ? Math.min(1, (k - 0.35) / 0.4) : 0;
          p.speedNow = 60 + 70 * (1 - k);
          syncFigure(p, wdt, g.time);
          if (k >= 1) finishEnterCar();
        }
      } else if (p.state === 'foot') {
        updatePlayerOnFoot(g, wdt);
        syncFigure(p, wdt, g.time);
      } else {
        drivePlayerCar(g, wdt);
        seatDriverFigure(g, wdt, g.time);
      }
      if (input.tapped('KeyE')) handleInteract();
      if (input.tapped('KeyC')) callCar(g);
      g.aimAngle = p.state === 'foot' ? computeAimAngle() : null;
      if (p.state !== 'foot') g.aimPoint = null;
      updateTraffic(g, wdt);
      updateWrecks(g, wdt);
      updatePeds(g, wdt, g.time);
      updateCombat(g, wdt);
      updateBullets(g, wdt);
      updatePickups(g, wdt, g.time);
      updatePolice(g, wdt, g.time);
      updatePlayerCarHits(g);
      updateEconomy(g, dt);
      updateMissions(g, wdt, g.time);
      updateInteractions(wdt);
      processEvents();
      // Player expression settles back to a grin (or a scowl under heat).
      if (p.exprT > 0) {
        p.exprT -= dt;
        if (p.exprT <= 0) p.fig.setExpression(g.stars >= 2 ? 'angry' : 'grin');
      }
      if (p.hp <= 0 && g.state === 'play') doWasted();
      autosaveT += dt;
      if (autosaveT > 4) {
        autosaveT = 0;
        persist();
      }
    }
  }

  if (g.resetArm.armed) {
    g.resetArm.t -= dt;
    if (g.resetArm.t <= 0) disarmReset();
  }
  if (g.message) {
    g.message.t -= dt;
    if (g.message.t <= 0) g.message = null;
  }
  if (g.toast) {
    g.toast.t -= dt;
    if (g.toast.t <= 0) g.toast = null;
  }
  updateAudioState();
  if (!shotName) updateAudio(g, dt);
  updateCamera(dt);
  syncResetBtn();
  syncHowtoBtn();
  syncHowto();
  syncCustomizeBtn();
  syncCustomize();
  syncLangToggle();
  if (touchUI) touchUI.update();
  // Off-screen traffic warnings for the HUD (on foot only; the shot
  // scenes returned above and never reach this, so their compositions
  // stay clean).
  computeTrafficWarnings(g);
  updateGfx(g, dt);
  drawHUD(g);
  renderer.render(scene, camera);
  input.endFrame();
}
requestAnimationFrame(frame);
