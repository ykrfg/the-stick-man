// The money side of Palmera: PALMERA MOTORS (cars and tuning), the SURF SHACK
// wardrobe, the Ammo Hut gear, the safehouse, the fixer who erases heat, and
// the phone call that brings your own car to the kerb. Everything is bought by
// tapping a row in a tray, so the same panel works with a mouse, a finger and
// the number keys.
//
// The theft rule is deliberately abstract: an owned car left alone far from the
// player for a while is taken, and its last parked spot becomes a map pin. You
// get it back by walking to the pin, or pay the Motors desk to fetch it.
import * as THREE from 'three';
import {
  FIXER, GEAR, MOTORS, NEON, OUTFIT, PLAYER, SAFEHOUSE, THEFT,
} from './config.js';
import { t } from './i18n.js';
import { jobAvailable, missionAvailable } from './missions.js';
import { applyCarSpec, removeCar, spawnCar } from './vehicles.js';

let g = null;
let tray = null;
let body = null;
let titleEl = null;
let subEl = null;
let cashEl = null;

const near = (p, spot, range) => !!spot && Math.hypot(p.x - spot.x, p.y - spot.y) < range;

/** Inject the tray's stylesheet once; the panel is the only DOM it needs. */
function installStyle() {
  if (document.getElementById('smShopStyle')) return;
  const style = document.createElement('style');
  style.id = 'smShopStyle';
  style.textContent = `
  #smShop { position:fixed; left:50%; bottom:10%; transform:translateX(-50%);
    width:min(560px, 94vw); max-height:78vh; display:none; flex-direction:column;
    background:rgba(14,18,30,0.96); border:2px solid rgba(255,217,77,0.55);
    border-radius:14px; box-shadow:0 18px 50px rgba(0,0,0,0.55); z-index:40;
    font-family:system-ui,-apple-system,'Segoe UI',sans-serif; color:#f4f1e6; overflow:hidden; }
  #smShop.show { display:flex; }
  #smShopHead { padding:12px 16px 8px; border-bottom:1px solid rgba(255,255,255,0.12); }
  #smShopTitle { font-size:19px; letter-spacing:1px; color:#ffd94d; }
  #smShopSub { display:block; font-size:12px; opacity:0.75; margin-top:3px; }
  #smShopBody { overflow-y:auto; padding:8px 10px; display:flex; flex-direction:column; gap:6px; }
  .smRow { display:flex; align-items:center; justify-content:space-between; gap:10px;
    width:100%; min-height:44px; padding:7px 12px; border-radius:9px; cursor:pointer;
    background:rgba(255,255,255,0.07); border:1px solid rgba(255,255,255,0.10);
    color:#f4f1e6; font-size:14px; font:inherit; text-align:left; }
  .smRow.tap:hover, .smRow.tap:active { background:rgba(255,217,77,0.18); border-color:#ffd94d; }
  .smRow.sel { border-color:#ffd94d; background:rgba(255,217,77,0.14); }
  .smRow.off { opacity:0.45; cursor:default; }
  .smRow.owned { border-color:rgba(90,209,232,0.6); }
  .smRow.note { background:transparent; border-color:transparent; opacity:0.7; font-size:12px; cursor:default; }
  .smPrice { color:#8dff6a; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .smPrice.bad { color:#ff8a7a; }
  .smTag { color:#5ad1e8; font-size:12px; letter-spacing:1px; }
  .smNum { opacity:0.5; font-size:12px; min-width:16px; }
  #smShopFoot { display:flex; align-items:center; justify-content:space-between;
    padding:10px 14px; border-top:1px solid rgba(255,255,255,0.12); }
  #smShopCash { font-size:13px; color:#8dff6a; font-variant-numeric:tabular-nums; }
  #smShopClose { min-height:40px; padding:0 18px; border-radius:9px; font:inherit;
    background:#ffd94d; color:#1a1a22; border:0; font-weight:700; letter-spacing:1px; cursor:pointer; }
  `;
  document.head.appendChild(style);
}

/** Build the tray DOM once. */
function buildTray() {
  if (tray) return;
  installStyle();
  tray = document.createElement('div');
  tray.id = 'smShop';
  tray.innerHTML = `
    <div id="smShopHead"><span id="smShopTitle"></span><span id="smShopSub"></span></div>
    <div id="smShopBody"></div>
    <div id="smShopFoot"><span id="smShopCash"></span><button id="smShopClose"></button></div>`;
  document.body.appendChild(tray);
  titleEl = tray.querySelector('#smShopTitle');
  subEl = tray.querySelector('#smShopSub');
  body = tray.querySelector('#smShopBody');
  cashEl = tray.querySelector('#smShopCash');
  tray.querySelector('#smShopClose').addEventListener('click', () => closeShop());
  window.addEventListener('keydown', onKey);
}

/** Format money the way the HUD does, so the two always agree. */
function cash(n) {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/* ------------------------------------------------------------------ helpers */

/** The owned-car spec the desk is tuning: the first one that is not stolen. */
function activeOwned() {
  const list = g.saveData.owned || [];
  for (let i = 0; i < list.length; i += 1) if (!list[i].stolen) return i;
  return -1;
}

/** The live car for a saved slot, if it is in the world. */
function carForSlot(i) {
  return g.cars.find((c) => c.owned && c.slot === i) || null;
}

/** Charge the player, or refuse loudly. Nothing is ever bought on credit. */
function spend(price) {
  if (g.money < price) {
    g.say(t('banner.broke.title'), t('banner.broke.sub', {
      price: cash(price), money: cash(g.money),
    }), 2.6);
    g.sfx.tone('triangle', 170, 110, 0.1, 0.14);
    return false;
  }
  g.money -= price;
  g.sfx.cash();
  return true;
}

/** After any purchase: write the save, refresh the tray, restyle the hero. */
function commit() {
  if (g.applyGear) g.applyGear();
  g.persist?.();
  renderShop();
}

/* ------------------------------------------------------------------- motors */

function gradeName(id) {
  return t(`car.${id}`);
}

/** Put a newly bought car on the lot (or at the kerb) and hand it a slot. */
function deliverBought(spec, index) {
  const lot = g.city.motorsLot || [];
  let spot = lot[index % Math.max(1, lot.length)] || { x: g.player.x + 90, y: g.player.y };
  for (let tries = 0; tries < 6; tries += 1) {
    const busy = g.cars.some((c) => Math.hypot(c.x - spot.x, c.y - spot.y) < 66);
    if (!busy) break;
    spot = { x: spot.x + 70, y: spot.y };
  }
  const car = spawnCar(g, 'parked', spot.x, spot.y, Math.PI / 2, MOTORS.paints[spec.paint]);
  car.touched = true;
  car.slot = index;
  applyCarSpec(car, spec);
  return car;
}

function buyGrade(gradeIndex) {
  const grade = MOTORS.grades[gradeIndex];
  if (!grade) return;
  if ((g.saveData.owned || []).length >= 3) {
    g.say(t('shop.motors.title'), t('shop.maxCars'), 2.6);
    return;
  }
  if (!spend(grade.price)) return;
  const spec = {
    grade: gradeIndex, paint: 0, engine: 0, armor: 0, neon: null,
    stolen: false, stolenX: null, stolenY: null,
  };
  g.saveData.owned.push(spec);
  deliverBought(spec, g.saveData.owned.length - 1);
  g.say(t('banner.car.title'), t('banner.car.sub', { name: gradeName(grade.id) }), 3.2);
  commit();
}

/** Re-apply a slot's spec to its live car (after a tuning purchase). */
function refreshCar(slot) {
  const spec = g.saveData.owned[slot];
  const car = carForSlot(slot);
  if (spec && car) applyCarSpec(car, spec);
}

function tune(kind) {
  const slot = activeOwned();
  if (slot < 0) return;
  const spec = g.saveData.owned[slot];
  const grade = MOTORS.grades[spec.grade];
  if (kind === 'paint') {
    if (!spend(MOTORS.paint)) return;
    spec.paint = (spec.paint + 1) % MOTORS.paints.length;
    refreshCar(slot);
    commit();
    return;
  }
  if (kind === 'engine') {
    const next = MOTORS.engine[spec.engine];
    if (!next || !spend(next.price)) return;
    spec.engine += 1;
    refreshCar(slot);
    g.sfx.confirm();
    commit();
    return;
  }
  if (kind === 'armor') {
    const next = MOTORS.armor[spec.armor];
    if (!next || !spend(next.price)) return;
    spec.armor += 1;
    refreshCar(slot);
    g.sfx.confirm();
    commit();
    return;
  }
  if (kind === 'neon') {
    if (!spend(MOTORS.neon)) return;
    spec.neon = ((spec.neon ?? -1) + 1) % NEON.length;
    refreshCar(slot);
    commit();
  }
  void grade;
}

/* ---------------------------------------------------------------- ammo hut */

function buyGear(kind) {
  const gear = g.saveData.gear;
  if (kind === 'pistol') {
    if (gear.pistol || !spend(GEAR.pistol)) return;
    gear.pistol = true;
    g.player.hasPistol = true;
    g.player.fig.setGun(true);
    g.say(t('banner.pistol.title'), t('banner.pistol.sub'), 4.2);
    g.sfx.pickup();
  } else if (kind === 'vest') {
    const next = GEAR.vest[gear.vest];
    if (!next || !spend(next.price)) return;
    gear.vest += 1;
    g.sfx.confirm();
  } else if (kind === 'gloves') {
    if (gear.gloves || !spend(GEAR.gloves)) return;
    gear.gloves = true;
    g.sfx.confirm();
  } else if (kind === 'shoes') {
    if (gear.shoes || !spend(GEAR.shoes)) return;
    gear.shoes = true;
    g.sfx.confirm();
  }
  commit();
}

/* ---------------------------------------------------------------- wardrobe */

function buyOutfit(kind, arg) {
  const fit = g.saveData.fit;
  if (kind === 'color') {
    if (!fit.scarf) return;
    fit.color = arg;
    g.player.fig.setFit(fit);
    g.sfx.uiBlip();
    commit();
    return;
  }
  const key = kind;
  const price = OUTFIT[key];
  if (fit[key]) {
    // Bought already: wearing and taking off are free.
    fit[key] = false;
    g.player.fig.setFit(fit);
    g.sfx.uiBlip();
    commit();
    return;
  }
  if (!spend(price)) return;
  fit[key] = true;
  g.player.fig.setFit(fit);
  g.sfx.confirm();
  commit();
}

/* --------------------------------------------------------------- safehouse */

function buySafehouse() {
  if (g.saveData.safehouse || !spend(SAFEHOUSE.price)) return;
  g.saveData.safehouse = true;
  g.sfx.confirm();
  g.say(t('banner.safehouse.title'), t('banner.safehouse.sub'), 3.4);
  commit();
}

/* ------------------------------------------------------------------- fixer */

function payFixer() {
  const stars = g.stars;
  if (stars <= 0) return;
  const cost = stars * FIXER.perStar;
  if (!spend(cost)) return;
  g.heat = 0;
  g.stars = 0;
  g.cooling = false;
  g.say(t('banner.fixer.title'), t('banner.fixer.sub'), 3);
  g.sfx.confirm();
  commit();
}

/* ------------------------------------------------------------------- panels */

function noteRow(text) {
  return { label: text, cls: 'note', on: null };
}

function rowsFor(kind) {
  const rows = [];
  if (kind === 'motors') {
    const owned = g.saveData.owned || [];
    for (let i = 0; i < MOTORS.grades.length; i += 1) {
      const gr = MOTORS.grades[i];
      rows.push({
        label: t(`shop.motors.grade.${gr.id}`),
        right: cash(gr.price),
        bad: g.money < gr.price,
        on: () => buyGrade(i),
      });
    }
    const slot = activeOwned();
    if (slot < 0) {
      if (owned.length === 0) rows.push(noteRow(t('shop.motors.noCar')));
    } else {
      const spec = g.saveData.owned[slot];
      rows.push(noteRow(t('shop.motors.ownCar', { name: gradeName(MOTORS.grades[spec.grade].id) })));
      rows.push({
        label: t('shop.motors.paint'), right: cash(MOTORS.paint),
        tag: `#${spec.paint + 1}`, bad: g.money < MOTORS.paint, on: () => tune('paint'),
      });
      const eng = spec.engine < MOTORS.engine.length ? MOTORS.engine[spec.engine] : null;
      rows.push(eng ? {
        label: t('shop.motors.engine', { n: spec.engine + 1 }),
        right: cash(eng.price), bad: g.money < eng.price, on: () => tune('engine'),
      } : { label: t('shop.motors.engine', { n: spec.engine }), tag: t('shop.owned'), cls: 'owned' });
      const arm = spec.armor < MOTORS.armor.length ? MOTORS.armor[spec.armor] : null;
      rows.push(arm ? {
        label: t('shop.motors.armor', { n: spec.armor + 1 }),
        right: cash(arm.price), bad: g.money < arm.price, on: () => tune('armor'),
      } : { label: t('shop.motors.armor', { n: spec.armor }), tag: t('shop.owned'), cls: 'owned' });
      rows.push({
        label: t('shop.motors.neon', { n: (spec.neon ?? -1) + 2 }),
        right: cash(MOTORS.neon), bad: g.money < MOTORS.neon, on: () => tune('neon'),
      });
      rows.push({
        label: t('shop.motors.call'), right: cash(MOTORS.call),
        bad: g.money < MOTORS.call, on: () => callCar(),
      });
    }
    if (owned.some((s) => s.stolen)) {
      rows.push({
        label: t('shop.motors.recover'), right: cash(MOTORS.recover),
        bad: g.money < MOTORS.recover, on: () => recoverStolen(true),
      });
    }
    if (wreckedSlot() >= 0) {
      rows.push({
        label: t('shop.motors.recoverWreck'), right: cash(MOTORS.recover),
        bad: g.money < MOTORS.recover, on: () => recoverWrecked(),
      });
    }
  } else if (kind === 'ammo') {
    const gear = g.saveData.gear;
    rows.push(gear.pistol
      ? { label: t('shop.ammo.pistol'), tag: t('shop.owned'), cls: 'owned' }
      : { label: t('shop.ammo.pistol'), right: cash(GEAR.pistol), bad: g.money < GEAR.pistol, on: () => buyGear('pistol') });
    const vest = GEAR.vest[gear.vest];
    rows.push(vest
      ? { label: t('shop.ammo.vest', { n: gear.vest + 1 }), right: cash(vest.price), bad: g.money < vest.price, on: () => buyGear('vest') }
      : { label: t('shop.ammo.vest', { n: gear.vest }), tag: t('shop.owned'), cls: 'owned' });
    rows.push(gear.gloves
      ? { label: t('shop.ammo.gloves'), tag: t('shop.owned'), cls: 'owned' }
      : { label: t('shop.ammo.gloves'), right: cash(GEAR.gloves), bad: g.money < GEAR.gloves, on: () => buyGear('gloves') });
    rows.push(gear.shoes
      ? { label: t('shop.ammo.shoes'), tag: t('shop.owned'), cls: 'owned' }
      : { label: t('shop.ammo.shoes'), right: cash(GEAR.shoes), bad: g.money < GEAR.shoes, on: () => buyGear('shoes') });
  } else if (kind === 'outfit') {
    const fit = g.saveData.fit;
    for (const key of ['scarf', 'hat', 'shades']) {
      rows.push({
        label: t(`shop.outfit.${key}`),
        right: fit[key] ? null : cash(OUTFIT[key]),
        bad: !fit[key] && g.money < OUTFIT[key],
        tag: fit[key] ? t('shop.wearing') : null,
        cls: fit[key] ? 'owned' : '',
        on: () => buyOutfit(key),
      });
    }
    if (!fit.scarf) rows.push(noteRow(t('shop.outfit.colorFree')));
    for (let i = 0; i < OUTFIT.colors.length; i += 1) {
      rows.push({
        label: t('shop.outfit.color', { n: i + 1 }),
        tag: fit.color === i ? t('shop.wearing') : null,
        cls: fit.scarf && fit.color === i ? 'owned' : '',
        on: fit.scarf ? () => buyOutfit('color', i) : null,
        off: !fit.scarf,
      });
    }
  } else if (kind === 'safehouse') {
    if (g.saveData.safehouse) {
      rows.push({ label: t('shop.safehouse.buy'), tag: t('shop.owned'), cls: 'owned' });
      if (wreckedSlot() >= 0) {
        rows.push({
          label: t('shop.motors.recoverWreck'), right: cash(MOTORS.recover),
          bad: g.money < MOTORS.recover, on: () => recoverWrecked(),
        });
      }
    } else {
      rows.push({ label: t('shop.safehouse.buy'), right: cash(SAFEHOUSE.price), bad: g.money < SAFEHOUSE.price, on: buySafehouse });
    }
  } else if (kind === 'fixer') {
    if (g.stars > 0) {
      const cost = g.stars * FIXER.perStar;
      rows.push({
        label: t('shop.fixer.clear', { stars: g.stars }), right: cash(cost),
        bad: g.money < cost, on: payFixer,
      });
    } else {
      rows.push(noteRow(t('shop.fixer.none')));
    }
  }
  return rows;
}

const PANEL_TITLE = {
  motors: 'shop.motors.title', ammo: 'shop.ammo.title', outfit: 'shop.outfit.title',
  safehouse: 'shop.safehouse.title', fixer: 'shop.fixer.title',
};
const PANEL_SUB = {
  motors: 'shop.motors.sub', ammo: 'shop.ammo.sub', outfit: 'shop.outfit.sub',
  safehouse: 'shop.safehouse.sub', fixer: 'shop.fixer.sub',
};

let rows = [];
let sel = 0;

function renderShop() {
  if (!g?.shopOpen || !tray) return;
  const kind = g.shopOpen;
  titleEl.textContent = t(PANEL_TITLE[kind]);
  subEl.textContent = t(PANEL_SUB[kind]);
  cashEl.textContent = t('shop.money', { money: cash(g.money) });
  body.innerHTML = '';
  rows = rowsFor(kind);
  sel = Math.min(sel, Math.max(0, rows.length - 1));
  rows.forEach((row, i) => {
    const btn = document.createElement('button');
    btn.className = `smRow ${row.cls || ''} ${row.on ? 'tap' : ''}`.trim();
    if (row.bad) btn.classList.add('short');
    if (i === sel && row.on) btn.classList.add('sel');
    const left = document.createElement('span');
    left.textContent = row.label;
    btn.appendChild(left);
    const right = document.createElement('span');
    right.className = `smPrice${row.bad ? ' bad' : ''}`;
    if (row.right) right.textContent = row.right;
    else if (row.tag) { right.className = 'smTag'; right.textContent = row.tag; }
    btn.appendChild(right);
    if (row.on) {
      btn.addEventListener('click', () => {
        sel = i;
        row.on();
      });
    } else {
      btn.classList.add('off');
    }
    body.appendChild(btn);
  });
  cashEl.textContent = t('shop.money', { money: cash(g.money) });
}

function openShop(kind) {
  if (!tray || g.shopOpen) return;
  g.shopOpen = kind;
  sel = 0;
  tray.classList.add('show');
  renderShop();
  g.sfx.uiBlip();
}

function closeShop() {
  if (!g?.shopOpen) return;
  g.shopOpen = null;
  if (tray) tray.classList.remove('show');
  g.sfx.uiBlip();
}

/** True while a tray owns input; main.js skips the world for the frame. */
export function economyBusy(game) {
  return !!game.shopOpen;
}

/** Keyboard in the tray: digits pick a row, Escape/E closes. */
function onKey(event) {
  if (!g?.shopOpen) return;
  if (event.key === 'Escape' || event.code === 'KeyE') {
    event.preventDefault();
    closeShop();
    return;
  }
  const n = Number(event.key);
  if (Number.isInteger(n) && n >= 1 && n <= rows.length) {
    const row = rows[n - 1];
    if (row?.on) {
      event.preventDefault();
      sel = n - 1;
      row.on();
    }
  }
}

/* ------------------------------------------------------- spots & prompts */

/** The shop a player standing here would open, in priority order. */
function shopAt(game) {
  const p = game.player;
  const L = game.city.landmarks;
  if (near(p, L.motors, 74)) return 'motors';
  if (near(p, L.ammo, 74)) return 'ammo';
  if (near(p, L.surf, 62)) return 'outfit';
  if (near(p, L.safehouse, 74)) return 'safehouse';
  return null;
}

/**
 * The fixer is its own prompt: it only appears while the heat is on. He
 * works the phone booth by the PD and Bruno's counter alike. Priority
 * at the counter: Bruno's work first (his talk keeps the E press while
 * work is on offer), then the MEAL while the player is hurt — healing
 * is the urgent need, and a wanted man who limps in must be able to
 * eat; once he has eaten, this prompt returns and the fixer is offered
 * as usual. The booth has no meal to yield to.
 */
export function fixerPrompt(game) {
  if (game.player.state !== 'foot' || game.stars <= 0) return null;
  const L = game.city.landmarks;
  const atBooth = near(game.player, L.fixer, 62);
  const atDiner = near(game.player, L.diner, 64);
  if (!atBooth && !atDiner) return null;
  if (atDiner && game.bruno && near(game.player, game.bruno, 50)
    && (missionAvailable(game) || jobAvailable(game))) return null;
  if (atDiner && game.player.hp < game.player.maxHp) return null;
  return t('prompt.fixer', { cost: cash(game.stars * FIXER.perStar) });
}

/** Motors / Ammo Hut / wardrobe / safehouse door prompts. */
export function shopPrompt(game) {
  if (game.player.state !== 'foot') return null;
  const kind = shopAt(game);
  if (!kind) return null;
  if (kind === 'safehouse' && game.saveData.safehouse) {
    return game.player.hp < game.player.maxHp ? t('prompt.bed') : t('prompt.safehouse.owned');
  }
  return t(`prompt.${kind}`);
}

/** E at a shop or the fixer: true when the press was spent here. */
export function economyInteract(game) {
  g = game;
  if (g.player.state !== 'foot') return false;
  if (fixerPrompt(g)) {
    openShop('fixer');
    return true;
  }
  const kind = shopAt(g);
  if (kind === 'safehouse' && g.saveData.safehouse) {
    if (g.player.hp < g.player.maxHp) {
      g.player.hp = g.player.maxHp;
      g.say(t('banner.sleep.title'), t('banner.sleep.sub'), 2.6);
      g.sfx.confirm();
      return true;
    }
    return false;
  }
  if (!kind) return false;
  openShop(kind);
  return true;
}

/* ----------------------------------------------------------- car delivery */

/** The nearest road frame to a point: the kerb spot a summoned car arrives at. */
function kerbSpot(p) {
  let best = null;
  for (const avenue of [280, 720, 1160, 1600, 2040, 2480, 2920]) {
    const d = Math.abs(p.x - avenue);
    if (!best || d < best.d) {
      const toward = p.x >= avenue ? 1 : -1;
      best = { d, x: avenue + toward * 42, y: p.y, axis: 'y', sign: toward };
    }
  }
  for (const street of [280, 720, 1160, 1600, 2040]) {
    const d = Math.abs(p.y - street);
    if (!best || d < best.d) {
      const toward = p.y >= street ? 1 : -1;
      best = { d, x: p.x, y: street + toward * 42, axis: 'x', sign: toward };
    }
  }
  return best;
}

/**
 * C / the CALL button: your own car is driven to the kerb for a fee. It appears
 * out of sight along the nearest road and rolls in, so it never pops into view.
 */
export function callCar(game) {
  g = game;
  const owned = g.saveData.owned || [];
  if (owned.length === 0) {
    g.say(t('banner.call.title'), t('banner.call.none'), 2.8);
    g.sfx.tone('triangle', 180, 120, 0.1, 0.12);
    return;
  }
  const nearCar = g.cars.find((c) => c.owned && !c.wrecked && Math.hypot(c.x - g.player.x, c.y - g.player.y) < 150);
  if (nearCar) {
    g.say(t('banner.call.title'), t('banner.call.here'), 2.4);
    return;
  }
  // The first car that can actually come: not stolen, not a wreck, not
  // already rolling in. A wreck or a theft is answered with its reason,
  // never with a duplicate car wearing the same slot.
  let slot = -1;
  let blocked = null;
  for (let i = 0; i < owned.length; i += 1) {
    if (owned[i].stolen) { if (!blocked) blocked = 'stolen'; continue; }
    const live = carForSlot(i);
    if (live?.wrecked) { blocked = 'wrecked'; continue; }
    if (live?.summon) { if (!blocked) blocked = 'coming'; continue; }
    slot = i;
    break;
  }
  if (slot < 0) {
    const key = blocked === 'wrecked' ? 'banner.call.wrecked'
      : blocked === 'coming' ? 'banner.call.coming' : 'banner.call.stolen';
    g.say(t('banner.call.title'), t(key), 3);
    return;
  }
  if (!spend(MOTORS.call)) return;
  // The same car rolls in — never a duplicate: the slot's live car
  // leaves the world here and re-enters at the kerb approach below.
  const old = carForSlot(slot);
  if (old) removeCar(g, old);
  const p = g.player;
  const spot = kerbSpot(p);
  const away = spot.axis === 'y'
    ? { x: spot.x, y: p.y - spot.sign * 620 }
    : { x: p.x - spot.sign * 620, y: spot.y };
  const car = spawnCar(g, 'parked', away.x, away.y, spot.axis === 'y' ? Math.PI / 2 : 0, MOTORS.paints[0]);
  car.touched = true;
  car.slot = slot;
  applyCarSpec(car, g.saveData.owned[slot]);
  car.summon = { x: spot.x, y: spot.y };
  g.say(t('banner.call.title'), t('banner.call.sub'), 3);
  g.persist?.();
}

/** Roll a summoned car in toward its kerb spot, then let it sit. */
function updateSummon(dt) {
  for (const car of g.cars) {
    if (!car.summon) continue;
    const dx = car.summon.x - car.x;
    const dy = car.summon.y - car.y;
    const d = Math.hypot(dx, dy);
    // Arrival is a car length, not a point — and if the way to the
    // exact spot is wedged (a parked car holding the kerb, a corner),
    // separation physics can hold the car at a stand-off forever.
    // No closing progress for a beat and a half counts as arrived:
    // it is at the kerb, which is all the player asked for.
    if (car.summonBest === undefined || d < car.summonBest - 2) {
      car.summonBest = d;
      car.summonStall = 0;
    } else {
      car.summonStall = (car.summonStall ?? 0) + dt;
    }
    if (d < 30 || car.summonStall > 1.2) {
      car.summon = null;
      car.summonBest = undefined;
      car.summonStall = 0;
      car.speed = 0;
      continue;
    }
    const step = Math.min(d, 300 * dt);
    car.x += (dx / d) * step;
    car.y += (dy / d) * step;
    car.angle = Math.atan2(dy, dx);
    car.speed = 300;
  }
}

/* -------------------------------------------------------- theft & recover */

/** A car left alone far away is taken: flag it, pull it, and pin the map. */
function reportStolen(car) {
  const spec = g.saveData.owned?.[car.slot];
  if (!spec || spec.stolen) return;
  spec.stolen = true;
  spec.stolenX = car.x;
  spec.stolenY = car.y;
  car.mesh.parent?.remove(car.mesh);
  const i = g.cars.indexOf(car);
  if (i >= 0) g.cars.splice(i, 1);
  g.say(t('banner.stolen.title'), t('banner.stolen.sub'), 3.4);
  g.sfx.alarm();
  g.persist?.();
}

/** Put a stolen car back where it was found and clear the flag. */
function recoverStolen(paid, want = -1) {
  const list = g.saveData.owned || [];
  const idx = want >= 0 ? want : list.findIndex((s) => s.stolen);
  if (idx < 0) return;
  if (!list[idx]?.stolen) return;
  const spec = list[idx];
  if (paid && !spend(MOTORS.recover)) return;
  const p = g.player;
  const x = paid || spec.stolenX === null ? p.x + 70 : spec.stolenX;
  const y = paid || spec.stolenY === null ? p.y : spec.stolenY;
  spec.stolen = false;
  spec.stolenX = null;
  spec.stolenY = null;
  const car = spawnCar(g, 'parked', x, y, Math.PI / 2, MOTORS.paints[spec.paint]);
  car.touched = true;
  car.slot = idx;
  applyCarSpec(car, spec);
  g.say(t('banner.recovered.title'), t('banner.recovered.sub'), 3);
  g.sfx.confirm();
  g.persist?.();
  renderShop();
}

/** The first slot whose live car is a wreck, or -1. */
function wreckedSlot() {
  const list = g.saveData.owned || [];
  for (let i = 0; i < list.length; i += 1) {
    if (carForSlot(i)?.wrecked) return i;
  }
  return -1;
}

/**
 * Pay to un-wreck a bought car where it sits: the wreck state clears,
 * the fire goes out on the next updateWrecks pass, and the HP comes
 * back whole. A bought car is never towed away, so this — at the Motors
 * desk or the safehouse — is its way back from dead.
 */
function recoverWrecked() {
  const slot = wreckedSlot();
  if (slot < 0) return;
  if (!spend(MOTORS.recover)) return;
  const car = carForSlot(slot);
  car.wrecked = false;
  car.hp = car.maxHp ?? 100;
  car.burnT = 0;
  car.speed = 0;
  g.say(t('banner.recovered.title'), t('banner.recovered.sub'), 3);
  g.sfx.confirm();
  g.persist?.();
  renderShop();
}

/** Map pins for the stolen cars, rebuilt as the save changes. */
function syncPins() {
  g.stolenPins = (g.saveData.owned || [])
    .filter((s) => s.stolen && s.stolenX !== null)
    .map((s) => ({ x: s.stolenX, y: s.stolenY }));
}

/** Bring the owned cars back into the world after a load. */
export function spawnOwnedCars(game) {
  g = game;
  const list = g.saveData.owned || [];
  for (let i = 0; i < list.length; i += 1) {
    const spec = list[i];
    if (spec.stolen) continue;
    if (g.cars.some((c) => c.owned && c.slot === i)) continue;
    const lot = g.city.motorsLot?.[i % Math.max(1, g.city.motorsLot.length)] || { x: game.player.x + 80, y: game.player.y };
    const car = spawnCar(g, 'parked', lot.x, lot.y, Math.PI / 2, MOTORS.paints[spec.paint]);
    car.touched = true;
    car.slot = i;
    applyCarSpec(car, spec);
  }
  syncPins();
}

/* --------------------------------------------------------------- lifecycle */

/** Gear changes are pure stat patches on the hero: no new systems. */
function applyGear() {
  const gear = g.saveData.gear;
  const p = g.player;
  const vestHp = gear.vest > 0 ? GEAR.vest[gear.vest - 1].hp : 0;
  p.maxHp = PLAYER.maxHp + vestHp;
  p.hp = Math.min(Math.max(p.hp, 1), p.maxHp);
  p.punchDamage = PLAYER.punchDamage + (gear.gloves ? GEAR.glovesBonus : 0);
  p.dashCdMax = gear.shoes ? GEAR.dashCooldown : PLAYER.dashCooldown;
  p.hasPistol = gear.pistol === true;
  if (p.fig) {
    p.fig.setGun(p.hasPistol);
    p.fig.setFit(g.saveData.fit);
  }
}

/** Build the tray and apply the saved gear; call once, after the hero exists. */
export function initEconomy(game) {
  g = game;
  buildTray();
  game.shopOpen = null;
  game.stolenPins = [];
  game.applyGear = applyGear;
  applyGear();
}

/** Per-frame: the theft clock, walk-up recovery and summoned cars rolling in. */
export function updateEconomy(game, dt) {
  g = game;
  if (!g.saveData || g.state !== 'play') return;
  updateSummon(dt);
  for (const car of [...g.cars]) {
    if (!car.owned || car.occupant || car.wrecked || car.summon) continue;
    const d = Math.hypot(car.x - g.player.x, car.y - g.player.y);
    car.awayT = d > THEFT.range ? (car.awayT ?? 0) + dt : 0;
    if (car.awayT > THEFT.after) reportStolen(car);
  }
  const list = g.saveData.owned || [];
  for (let i = 0; i < list.length; i += 1) {
    const spec = list[i];
    if (!spec.stolen || spec.stolenX === null) continue;
    if (Math.hypot(g.player.x - spec.stolenX, g.player.y - spec.stolenY) < 56) {
      recoverStolen(false, i);
      break;
    }
  }
  syncPins();
}

/** Progress reset: take the bought cars out of the world too. */
export function resetEconomy(game) {
  g = game;
  for (const car of [...g.cars]) {
    if (!car.owned) continue;
    car.mesh.parent?.remove(car.mesh);
    const i = g.cars.indexOf(car);
    if (i >= 0) g.cars.splice(i, 1);
  }
  g.stolenPins = [];
  g.shopOpen = null;
  if (tray) tray.classList.remove('show');
}

/** Movement-blocking check for the touch CALL button. */
export function canCallCar(game) {
  return (game.saveData.owned || []).length > 0;
}
