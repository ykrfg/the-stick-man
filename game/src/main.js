// THE STICK MAN — main glue. Builds the world and the game state, runs the loop,
// routes input (start/pause, entering cars, talking to Bruno, the spray garage),
// drains the event queue that the other modules push into (crimes become heat,
// hits become sounds, boardings advance missions), drives the camera, and owns
// the run's start, busted and wasted flows. In ?shot= mode it instead poses one
// of the deterministic screenshot scenes from shots.js.
import * as THREE from 'three';
import { CAR, HEAT_FOR, MEAL_PRICE, PLAYER, ROBBERY_COOLDOWN, ROBBERY_HEAT, ROBBERY_TIME, SPRAY_PER_STAR, TREAT_PRICE } from './config.js';
import { makeRng } from './random.js';
import { Input } from './input.js';
import { SoundFX } from './audio.js';
import { clearSave, hasProgress, loadSave, storeSave } from './save.js';
import { buildCity } from './city.js';
import { buildWorld } from './world3d.js';
import { createFigure } from './stick3d.js';
import { computeTrafficWarnings, damageCar, drivePlayerCar, spawnParkedCars, spawnTrafficCar, updatePlayerCarHits, updateTraffic } from './vehicles.js';
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
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 5, 4200);
const hudCanvas = document.getElementById('hud');
const hudCtx = hudCanvas.getContext('2d');

const rng = makeRng(params.get('seed') ? Number(params.get('seed')) : (Date.now() % 2147483647));
const city = buildCity(rng);

const g = {
  scene,
  camera,
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
  transition: null,
  garageT: 0,
  robbery: null, // { shop, t } while a hold-up is being stood through
  robbedAt: {}, // shop index -> g.time of its last completed hold-up
  shake: 0,
  lastFine: 0,
  // Progress-reset confirm state (title / pause): the first R press or
  // RESET PROGRESS tap arms it, a second within a few seconds wipes the
  // save; any other input, or the timer running out, disarms it.
  resetArm: { armed: false, t: 0 },
  saveData: loadSave() ?? { money: 0, missionsDone: [], hasPistol: false, earned: 0, jobsDone: 0 },
  shotMode: null,
  fixedCam: null,
  // GTA-style free camera state (play states only; the ?shot= scenes and the
  // title orbit never touch it). yaw/pitch orbit the hero, dist is the
  // smoothed slant range, collDist the building-collision limit on it.
  cam: {
    init: false, yaw: 0, pitch: 0.42, dist: 250, zoomIdx: 2,
    manualT: 99, collDist: 1e9, backBlend: 0, lookBack: false, occluded: false,
  },
  say(title, sub = '', dur = 3.4) {
    g.message = { title, sub, t: dur, dur };
    statusEl.textContent = sub ? `${title}. ${sub}` : title;
  },
};

g.money = g.saveData.money ?? 0;
g.earned = g.saveData.earned ?? 0;
buildWorld(scene, g.city);

// The hero: a white-headed, black-bodied stick figure with a grin, spawned outside the diner.
const dinerDoor = g.city.landmarks.diner;
g.player = {
  x: dinerDoor.x - 62,
  y: dinerDoor.y + 34,
  angle: Math.PI / 2,
  moveAngle: Math.PI / 2,
  hp: PLAYER.maxHp,
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

function persist() {
  g.saveData.money = g.money;
  g.saveData.earned = g.earned;
  g.saveData.hasPistol = g.player.hasPistol;
  storeSave(g.saveData);
}

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
  g.saveData = { money: 0, missionsDone: [], hasPistol: false, earned: 0, jobsDone: 0 };
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
  g.events.push({ type: 'crime', kind: 'stealCar', x: car.x, y: car.y });
  g.sfx.carDoor();
}

function exitCar() {
  const p = g.player;
  const car = p.car;
  if (!car) return;
  const a = car.angle;
  p.x = car.x + Math.sin(a) * 36;
  p.y = car.y - Math.cos(a) * 36;
  p.angle = a;
  car.occupant = null;
  p.car = null;
  p.state = 'foot';
  p.fig.target.drive = 0;
  p.fig.shadow.visible = true;
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
  const spot = wasBusted ? g.city.landmarks.pd : g.city.landmarks.hospital;
  p.x = spot.x;
  p.y = spot.y + 12;
  p.hp = PLAYER.maxHp;
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
      case 'punchhit': g.sfx.punch(); break;
      case 'punchmiss': g.sfx.tone('triangle', 150, 90, 0.05, 0.1); break;
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
        if (ev.byPlayer) addHeat(g, HEAT_FOR.runOver, ev.ped.x, ev.ped.y);
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

/** Index of the shop whose doorstep zone the player is standing in, or -1. */
function shopDoorIndex(p) {
  for (let i = 0; i < g.city.shops.length; i += 1) {
    const s = g.city.shops[i];
    if (Math.hypot(p.x - s.x, p.y - s.y) < 62) return i;
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
  if (g.transition) return;
  if (p.state === 'foot') {
    const L = g.city.landmarks;
    if (g.robbery) {
      // A hold-up in progress owns the prompt line: stand in the door
      // zone and watch it fill. Walking off is always an option — the
      // payout is forfeit, and that is the whole of the punishment.
      const r = g.robbery;
      const shop = g.city.shops[r.shop];
      if (!shop || Math.hypot(p.x - shop.x, p.y - shop.y) > 84) {
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
    if (p.hp < PLAYER.maxHp && Math.hypot(p.x - L.diner.x, p.y - L.diner.y) < 64) {
      // A hurt player at the counter eats first: Bruno's work (story or
      // odd job) is one step to his side, and the meal would otherwise
      // be unreachable in free roam, where a job is always on offer.
      g.prompt = t('prompt.meal', { price: `$${MEAL_PRICE}` });
    } else if (p.hp < PLAYER.maxHp && Math.hypot(p.x - L.hospital.x, p.y - L.hospital.y) < 64) {
      g.prompt = t('prompt.treat', { price: `$${TREAT_PRICE}` });
    } else if (Math.hypot(p.x - g.bruno.x, p.y - g.bruno.y) < 50 && (missionAvailable(g) || jobAvailable(g))) {
      g.prompt = t('prompt.talk');
    } else if (missionPrompt(g)) {
      // A mission grab spot (the courier's case, the raid's crate) owns
      // its prompt, ahead of the shop doors below.
      g.prompt = missionPrompt(g);
    } else if (shopDoorIndex(p) >= 0) {
      const si = shopDoorIndex(p);
      if (shopBusy(si)) {
        // The mission owns this door: no robbery prompt, no note.
      } else if (robCooldownLeft(si) > 0) {
        g.prompt = t('prompt.recentlyHit', { shop: g.city.shops[si].name });
      } else {
        g.prompt = t('prompt.holdup', { shop: g.city.shops[si].name });
      }
    } else if (nearestEnterableCar()) {
      g.prompt = t('prompt.stealCar');
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
  const missing = PLAYER.maxHp - p.hp;
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
  p.hp = Math.min(PLAYER.maxHp, p.hp + healed);
  g.say(name, t('heal.result', { line: okLine, healed, cost: `$${cost}` }), 2.8);
  g.sfx.cash();
  persist();
}

/** Handle the E key: talk, heal, steal, or climb out — in that order. */
function handleInteract() {
  const p = g.player;
  if (g.transition) return;
  if (p.state === 'foot') {
    if (g.robbery) return; // E does nothing while a hold-up is being stood through
    const L = g.city.landmarks;
    if (p.hp < PLAYER.maxHp && Math.hypot(p.x - L.diner.x, p.y - L.diner.y) < 64) {
      healAt("BRUNO'S", MEAL_PRICE, t('heal.meal.ok'), t('heal.meal.broke'));
      return;
    }
    if (p.hp < PLAYER.maxHp && Math.hypot(p.x - L.hospital.x, p.y - L.hospital.y) < 64) {
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
    const si = shopDoorIndex(p);
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

/** Where the mouse is pointing in the world (for aiming), as an angle or null. */
function computeAimAngle() {
  const p = g.player;
  const ndc = new THREE.Vector2(
    (g.input.mouse.x / g.viewW) * 2 - 1,
    -(g.input.mouse.y / g.viewH) * 2 + 1,
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const { origin, direction } = ray.ray;
  if (direction.y > -0.05) return null;
  const t = -origin.y / direction.y;
  const wx = origin.x + direction.x * t;
  const wz = origin.z + direction.z * t;
  return Math.atan2(wz - p.y, wx - p.x);
}

const camPos = new THREE.Vector3(900, 420, 300);
const camLook = new THREE.Vector3(1270, 10, 1100);

/** Move the camera for the current state: title orbit, foot follow, car chase. */
// GTA-style camera zoom steps (slant range from the hero).
const ZOOM_STEPS = [140, 190, 250, 330];

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
  if (moving && cam.manualT > 1.1 && !lookBack) {
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
  const cp = Math.cos(cam.pitch);
  const dir = { x: Math.cos(yawEff) * cp, y: Math.sin(cam.pitch), z: Math.sin(yawEff) * cp };

  // Building collision: the camera may never have a building between itself
  // and the hero. Pull in instantly, ease back out slowly — no popping.
  const hitT = rayBuildingT(anchor.x, anchor.y, anchor.z, dir.x, dir.y, dir.z, cam.dist);
  // Stay a margin in front of the blocker; when the hero hugs a wall the
  // clearance is only a few units, so the floor scales with the hit distance
  // instead of overshooting into the building.
  const allowed = hitT === Infinity ? cam.dist : (hitT > 14 ? hitT - 6 : Math.max(6, hitT * 0.55));
  if (allowed < cam.collDist) cam.collDist = allowed;
  else cam.collDist += (allowed - cam.collDist) * (1 - Math.exp(-3.5 * dt));
  const effDist = Math.min(cam.dist, cam.collDist);

  // Close-quarters fallback: when collision has pulled the camera right in,
  // raise it toward a top-down view so the hero and his surroundings stay
  // readable instead of the screen filling with the wall that blocked it.
  const lift = effDist < 70 ? (1 - effDist / 70) * 0.55 : 0;
  cam.lift = lift;
  const pitchEff = Math.min(1.35, cam.pitch + lift);
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
    drawHUD(g);
    renderer.render(scene, camera);
    g.shotFrames = (g.shotFrames ?? 0) + 1;
    if (g.shotFrames > 45) window.__shotReady = true;
    input.endFrame();
    return;
  }

  if (g.state === 'title') {
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
    } else if (input.tapped('KeyP', 'Enter')) {
      disarmReset();
      g.state = 'play';
    }
  } else if (g.state === 'play') {
    if (input.tapped('KeyP')) {
      g.state = 'paused';
    } else {
      // Camera control first: movement below reads the yaw settled here.
      updateCameraControl(dt);
      const p = g.player;
      // Car enter/exit transition: a crouched scramble to the door.
      if (g.transition) {
        const tr = g.transition;
        if (tr.car.wrecked || !g.cars.includes(tr.car)) {
          // The car died (or was removed) mid-scramble: there is no
          // seat to take, so the scramble just ends where he stands.
          g.transition = null;
          p.fig.target.crouch = 0;
        } else {
          // The door is wherever the car is NOW, not where it was when
          // E was pressed: a moving car does not wait for a man
          // scrambling at its side, and the old fixed door point left
          // him arriving at an empty patch of road and teleporting in
          // (or, to the player, looking like the car refused him).
          // Tracking the door makes him run alongside and climb in as
          // it rolls — and a stopped car behaves exactly as before.
          const a = tr.car.angle;
          tr.doorX = tr.car.x + Math.sin(a) * 34;
          tr.doorY = tr.car.y - Math.cos(a) * 34;
          tr.t += dt;
          const k = Math.min(1, tr.t / tr.dur);
          p.x = tr.fromX + (tr.doorX - tr.fromX) * k;
          p.y = tr.fromY + (tr.doorY - tr.fromY) * k;
          p.fig.target.crouch = Math.sin(k * Math.PI) * 0.9;
          p.speedNow = 60;
          syncFigure(p, dt, g.time);
          if (k >= 1) finishEnterCar();
        }
      } else if (p.state === 'foot') {
        updatePlayerOnFoot(g, dt);
        syncFigure(p, dt, g.time);
      } else {
        drivePlayerCar(g, dt);
        seatDriverFigure(g, dt, g.time);
      }
      if (input.tapped('KeyE')) handleInteract();
      g.aimAngle = p.state === 'foot' ? computeAimAngle() : null;
      updateTraffic(g, dt);
      updatePeds(g, dt, g.time);
      updateCombat(g, dt);
      updateBullets(g, dt);
      updatePickups(g, dt, g.time);
      updatePolice(g, dt, g.time);
      updatePlayerCarHits(g);
      updateMissions(g, dt, g.time);
      updateInteractions(dt);
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
  updateCamera(dt);
  syncResetBtn();
  syncLangToggle();
  if (touchUI) touchUI.update();
  // Off-screen traffic warnings for the HUD (on foot only; the shot
  // scenes returned above and never reach this, so their compositions
  // stay clean).
  computeTrafficWarnings(g);
  drawHUD(g);
  renderer.render(scene, camera);
  input.endFrame();
}
requestAnimationFrame(frame);
