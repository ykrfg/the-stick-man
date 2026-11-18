// THE STICK MAN — main glue. Builds the world and the game state, runs the loop,
// routes input (start/pause, entering cars, talking to Bruno, the spray garage),
// drains the event queue that the other modules push into (crimes become heat,
// hits become sounds, boardings advance missions), drives the camera, and owns
// the run's start, busted and wasted flows. In ?shot= mode it instead poses one
// of the deterministic screenshot scenes from shots.js.
import * as THREE from 'three';
import { CAR, HEAT_FOR, PLAYER, SPRAY_PER_STAR } from './config.js';
import { makeRng } from './random.js';
import { Input } from './input.js';
import { SoundFX } from './audio.js';
import { loadSave, storeSave } from './save.js';
import { buildCity } from './city.js';
import { buildWorld } from './world3d.js';
import { createFigure } from './stick3d.js';
import { drivePlayerCar, spawnParkedCars, spawnTrafficCar, updateTraffic } from './vehicles.js';
import { hurtPed, seatDriverFigure, spawnPeds, syncFigure, updatePeds, updatePlayerOnFoot } from './people.js';
import { spawnCashPickup, updateBullets, updateCombat, updatePickups } from './combat.js';
import { addHeat, updatePolice } from './police.js';
import {
  acceptMission, failMission, missionAvailable, missionsInit, onBoarded, updateMissions,
} from './missions.js';
import { drawHUD } from './hud.js';
import { setupShot, tickShot } from './shots.js';
import { detectMobile, initTouch } from './touch.js';

const params = new URLSearchParams(location.search);
const shotName = params.get('shot');
const statusEl = document.getElementById('status');

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 4200);
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
  shake: 0,
  lastFine: 0,
  saveData: loadSave() ?? { money: 0, missionsDone: [], hasPistol: false, earned: 0 },
  shotMode: null,
  fixedCam: null,
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
  hp: PLAYER.maxHp,
  state: 'foot',
  car: null,
  fig: createFigure({ fill: 'white' }),
  speedNow: 0,
  punchCd: 0,
  shotCd: 0,
  punchHitT: 0,
  aimT: 0,
  exprT: 0,
  hasPistol: g.saveData.hasPistol === true,
};
g.player.fig.setExpression('grin');
scene.add(g.player.fig.group);

spawnParkedCars(g);
for (let i = 0; i < 7; i += 1) spawnTrafficCar(g);
g.bruno = spawnPeds(g, 15);
missionsInit(g);

if (shotName) setupShot(g, shotName);

// Smartphone mode: virtual joystick + buttons feeding g.input (touch.js).
// Null on desktop, where nothing about the input path changes.
const touchUI = g.mobile && !shotName ? initTouch(g) : null;

// A handle for the headless play-test and screenshot scripts (and curious players
// in devtools): the whole game state, live.
window.__sm = g;

function persist() {
  g.saveData.money = g.money;
  g.saveData.earned = g.earned;
  g.saveData.hasPistol = g.player.hasPistol;
  storeSave(g.saveData);
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
    if (car.occupant === 'player') continue;
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
  failMission(g);
  g.state = 'busted';
  g.sfx.hurt();
  persist();
  statusEl.textContent = `Busted. Fine $${fine}. Press Enter to keep going.`;
}

function doWasted() {
  g.lastFine = 80;
  g.money = Math.max(0, g.money - 80);
  g.heat = 0;
  g.stars = 0;
  failMission(g);
  g.state = 'wasted';
  g.sfx.hurt();
  persist();
  statusEl.textContent = 'Wasted. St. Palm Hospital patched you up. Press Enter to keep going.';
}

/** After busted/wasted: back on the street with full health, heat gone. */
function respawn() {
  const p = g.player;
  const wasBusted = g.state === 'busted';
  if (p.car) {
    p.car.occupant = null;
    p.car = null;
  }
  p.state = 'foot';
  p.fig.target.drive = 0;
  p.fig.target.down = 0;
  p.fig.shadow.visible = true;
  const spot = wasBusted ? g.city.landmarks.pd : g.city.landmarks.hospital;
  p.x = spot.x;
  p.y = spot.y + 12;
  p.hp = PLAYER.maxHp;
  g.state = 'play';
  g.say(wasBusted ? 'RELEASED' : 'DISCHARGED', 'Palmera keeps spinning. Bruno is at the diner.', 3);
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
        hurtPed(g, ev.ped, 30 + ev.speed * 0.16);
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
          p.car.hp -= 6;
          if (p.car.hp <= 0) {
            exitCar();
            p.hp = Math.min(p.hp, 35);
            g.say('WRECKED!', 'Your ride is done. On your feet, stick.', 3);
          }
        } else {
          p.hp -= ev.ped.role === 'cop' ? 7 : 9;
          g.shake = Math.max(g.shake, 3);
        }
        break;
      }
      case 'busted': doBusted(); break;
      case 'starup':
        g.sfx.alarm();
        g.toast = { text: `WANTED ${'★'.repeat(ev.stars)}`, t: 1.8 };
        break;
      case 'boarded': onBoarded(g); g.sfx.pickup(); break;
      case 'officer': g.sfx.tone('square', 520, 660, 0.07, 0.14); break;
      case 'missionstart': g.sfx.confirm(); break;
      case 'missiondone': g.sfx.confirm(); persist(); break;
      case 'pistol':
        g.say('PISTOL ACQUIRED', "Shade left you his piece. K or click to shoot.", 4.2);
        g.sfx.pickup();
        break;
      case 'save': persist(); break;
      case 'spark': g.sfx.tone('square', 1250, 900, 0.03, 0.07); break;
      default: break;
    }
  }
  g.events.length = 0;
}

/** Compute the interaction prompt and the spray-garage service for this frame. */
function updateInteractions(dt) {
  const p = g.player;
  g.prompt = '';
  if (g.transition) return;
  if (p.state === 'foot') {
    if (Math.hypot(p.x - g.bruno.x, p.y - g.bruno.y) < 50 && missionAvailable(g)) {
      g.prompt = 'E — Talk to Bruno';
    } else if (nearestEnterableCar()) {
      g.prompt = 'E — Steal car';
    }
    return;
  }
  // In a car: the Spray 'n Go bay washes the heat off while you hold still.
  const zone = g.city.garageZone;
  const inZone = p.car
    && p.x > zone.x - 10 && p.x < zone.x + zone.w + 10
    && p.y > zone.y - 10 && p.y < zone.y + zone.h + 10;
  if (inZone && g.heat > 0 && p.car && Math.abs(p.car.speed) < 25) {
    const cost = Math.max(40, g.stars * SPRAY_PER_STAR);
    g.prompt = `Spray 'n Go — fresh paint for $${cost}. Hold still…`;
    g.garageT += dt;
    if (g.garageT > 1.1) {
      g.garageT = -2.5;
      if (g.money >= cost) {
        g.money -= cost;
        g.heat = 0;
        g.stars = 0;
        g.say("SPRAY 'N GO", 'New paint, new you. The heat is gone.', 3);
        g.sfx.cash();
        persist();
      } else {
        g.say("SPRAY 'N GO", 'Not enough cash to lose the heat.', 2.4);
      }
    }
  } else {
    g.garageT = Math.max(0, g.garageT - dt * 2);
    if (p.car && Math.abs(p.car.speed) < 45) g.prompt = 'E — Exit car';
  }
}

/** Handle the E key: talk, steal, or climb out — in that order. */
function handleInteract() {
  const p = g.player;
  if (g.transition) return;
  if (p.state === 'foot') {
    if (Math.hypot(p.x - g.bruno.x, p.y - g.bruno.y) < 50 && missionAvailable(g)) {
      acceptMission(g);
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
function updateCamera(dt) {
  const p = g.player;
  if (g.fixedCam) {
    camera.position.set(g.fixedCam.pos.x, g.fixedCam.pos.y, g.fixedCam.pos.z);
    camera.lookAt(g.fixedCam.look.x, g.fixedCam.look.y, g.fixedCam.look.z);
    return;
  }
  let tx;
  let ty;
  let tz;
  let lx;
  let ly;
  let lz;
  let rate = 5;
  if (g.state === 'title') {
    const a = g.time * 0.07;
    tx = 1270 + Math.cos(a) * 620;
    ty = 330;
    tz = 1100 + Math.sin(a) * 620;
    lx = 1270;
    ly = 0;
    lz = 1100;
    rate = 2;
  } else if (p.state === 'car' && p.car) {
    const a = p.car.angle;
    tx = p.car.x - Math.cos(a) * 195;
    ty = 138;
    tz = p.car.y - Math.sin(a) * 195;
    lx = p.car.x + Math.cos(a) * 85;
    ly = 12;
    lz = p.car.y + Math.sin(a) * 85;
    rate = 4.2;
  } else {
    tx = p.x - 60;
    ty = 165;
    tz = p.y + 215;
    lx = p.x + Math.cos(p.angle) * 42;
    ly = 12;
    lz = p.y + Math.sin(p.angle) * 42;
  }
  const k = 1 - Math.exp(-rate * dt);
  camPos.x += (tx - camPos.x) * k;
  camPos.y += (ty - camPos.y) * k;
  camPos.z += (tz - camPos.z) * k;
  camLook.x += (lx - camLook.x) * k;
  camLook.y += (ly - camLook.y) * k;
  camLook.z += (lz - camLook.z) * k;
  camera.position.copy(camPos);
  if (g.shake > 0.1) {
    camera.position.x += (Math.random() - 0.5) * g.shake;
    camera.position.y += (Math.random() - 0.5) * g.shake * 0.6;
    g.shake *= Math.exp(-7 * dt);
  }
  camera.lookAt(camLook);
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
    if (input.tapped('Enter')) {
      g.sfx.unlock();
      g.state = 'play';
      g.say('WELCOME TO PALMERA', 'Bruno at the diner has work for a stick like you.', 4.2);
      statusEl.textContent = 'Welcome to Palmera. Bruno at the diner has work.';
    }
  } else if (g.state === 'busted' || g.state === 'wasted') {
    if (input.tapped('Enter')) respawn();
  } else if (g.state === 'paused') {
    if (input.tapped('KeyP', 'Enter')) g.state = 'play';
  } else if (g.state === 'play') {
    if (input.tapped('KeyP')) {
      g.state = 'paused';
    } else {
      const p = g.player;
      // Car enter/exit transition: a crouched scramble to the door.
      if (g.transition) {
        const tr = g.transition;
        tr.t += dt;
        const k = Math.min(1, tr.t / tr.dur);
        p.x = tr.fromX + (tr.doorX - tr.fromX) * k;
        p.y = tr.fromY + (tr.doorY - tr.fromY) * k;
        p.fig.target.crouch = Math.sin(k * Math.PI) * 0.9;
        p.speedNow = 60;
        syncFigure(p, dt, g.time);
        if (k >= 1) finishEnterCar();
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
  if (touchUI) touchUI.update();
  drawHUD(g);
  renderer.render(scene, camera);
  input.endFrame();
}
requestAnimationFrame(frame);
