// The money side of Palmera: PALMERA MOTORS (cars and tuning), the SURF SHACK
// wardrobe, the Ammo Hut gear, the safehouse, the fixer who erases heat, and
// the phone call that brings your own car to the kerb. Everything is bought
// by tapping a row in a tray, so the same panel works with a mouse, a finger
// and the number keys.
//
// The theft rule is deliberately abstract: an owned car left alone far from
// the player for a while is taken, and its last parked spot becomes a map
// pin. You get it back by walking to the pin, or pay the Motors desk to
// fetch it.
import {
  FIXER, GEAR, MEAL_PRICE, MOTORS, NEON, OUTFIT, PLAYER, SAFEHOUSE, THEFT,
} from './config.js';
import { getLang, t } from './i18n.js';
import { jobAvailable, missionAvailable } from './missions.js';
import { applyCarSpec, recolorCar, removeCar, setCarNeon, spawnCar, syncCarMesh } from './vehicles.js';

let g = null;

/** The shop tray's DOM, built once and kept in this one record. */
const shop = { el: null, body: null, title: null, sub: null, cash: null, close: null };

const near = (p, spot, range) => !!spot && Math.hypot(p.x - spot.x, p.y - spot.y) < range;

/** Format money the way the HUD does, so the two always agree. */
function cash(n) {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/* ------------------------------------------------------------------ styles */

const SHOP_STYLE = [
  '#smShop { position:fixed; left:50%; bottom:10%; transform:translateX(-50%);',
  '  width:min(560px, 94vw); max-height:78vh; display:none; flex-direction:column;',
  '  background:rgba(14,18,30,0.96); border:2px solid rgba(255,217,77,0.55);',
  '  border-radius:14px; box-shadow:0 18px 50px rgba(0,0,0,0.55); z-index:40;',
  '  font-family:system-ui,-apple-system,\'Segoe UI\',sans-serif; color:#f4f1e6; overflow:hidden; }',
  '#smShop.show { display:flex; }',
  '#smShopHead { padding:12px 16px 8px; border-bottom:1px solid rgba(255,255,255,0.12); }',
  '#smShopTitle { font-size:19px; letter-spacing:1px; color:#ffd94d; }',
  '#smShopSub { display:block; font-size:12px; opacity:0.75; margin-top:3px; }',
  '#smShopBody { overflow-y:auto; padding:8px 10px; display:flex; flex-direction:column; gap:6px; }',
  '.smRow { display:flex; align-items:center; justify-content:space-between; gap:10px;',
  '  width:100%; min-height:44px; padding:7px 12px; border-radius:9px; cursor:pointer;',
  '  background:rgba(255,255,255,0.07); border:1px solid rgba(255,255,255,0.10);',
  '  color:#f4f1e6; font-size:14px; font:inherit; text-align:left; }',
  '.smRow.tap:hover, .smRow.tap:active { background:rgba(255,217,77,0.18); border-color:#ffd94d; }',
  '.smRow.sel { border-color:#ffd94d; background:rgba(255,217,77,0.14); }',
  '.smRow.off { opacity:0.45; cursor:default; }',
  '.smRow.owned { border-color:rgba(90,209,232,0.6); }',
  '.smRow.note { background:transparent; border-color:transparent; opacity:0.7; font-size:12px; cursor:default; }',
  '.smPrice { color:#8dff6a; font-variant-numeric:tabular-nums; white-space:nowrap; }',
  '.smPrice.bad { color:#ff8a7a; }',
  '.smTag { color:#5ad1e8; font-size:12px; letter-spacing:1px; }',
  '.smNum { opacity:0.5; font-size:12px; min-width:16px; }',
  '#smShopFoot { display:flex; align-items:center; justify-content:space-between;',
  '  padding:10px 14px; border-top:1px solid rgba(255,255,255,0.12); }',
  '#smShopCash { font-size:13px; color:#8dff6a; font-variant-numeric:tabular-nums; }',
  '#smShopClose { min-height:40px; min-width:96px; padding:0 18px; border-radius:9px; font:inherit;',
  '  background:#ffd94d; color:#1a1a22; border:0; font-weight:700; letter-spacing:1px; cursor:pointer; }',
];

const CUST_STYLE = [
  '#smCust { position:fixed; inset:0; z-index:60; display:none; overflow-y:auto;',
  '  -webkit-overflow-scrolling:touch; box-sizing:border-box;',
  '  padding:calc(12px + env(safe-area-inset-top)) 16px calc(22px + env(safe-area-inset-bottom));',
  '  background:rgba(10,13,22,0.94); font-family:system-ui,sans-serif; color:#f4f1e6; }',
  '#smCust.show { display:block; }',
  '#smCust .inner { max-width:560px; margin:0 auto; }',
  '#smCustBody { display:flex; flex-direction:column; gap:6px; }',
  '#smCust .head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:6px 0 4px; }',
  '#smCust h1 { margin:0; color:#ffd94d; font-size:26px; font-weight:900; letter-spacing:1px; }',
  '#smCust h2 { color:#ffd94d; font-size:15px; font-weight:800; letter-spacing:1px;',
  '  margin:16px 0 2px; padding-bottom:4px; border-bottom:2px solid rgba(255,217,77,0.35); }',
  '#smCust .backBtn { padding:10px 22px; border-radius:999px; border:3px solid #17181c;',
  '  background:#ffd94d; color:#17181c; font:800 15px system-ui,sans-serif; white-space:nowrap;',
  '  cursor:pointer; touch-action:none; -webkit-user-select:none; user-select:none; }',
  '#smCust .foot { text-align:center; margin:20px 0 4px; }',
];

/** Inject a stylesheet once, under the given element id. */
function installStyle(id, rules) {
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = rules.join('\n');
  document.head.appendChild(style);
}

/* ------------------------------------------------------------- tray shell */

/** Build the tray DOM once. */
function buildTray() {
  if (shop.el) return;
  installStyle('smShopStyle', SHOP_STYLE);
  const el = document.createElement('div');
  el.id = 'smShop';
  el.innerHTML = `
    <div id="smShopHead"><span id="smShopTitle"></span><span id="smShopSub"></span></div>
    <div id="smShopBody"></div>
    <div id="smShopFoot"><span id="smShopCash"></span><button id="smShopClose"></button></div>`;
  document.body.appendChild(el);
  shop.el = el;
  shop.title = el.querySelector('#smShopTitle');
  shop.sub = el.querySelector('#smShopSub');
  shop.body = el.querySelector('#smShopBody');
  shop.cash = el.querySelector('#smShopCash');
  shop.close = el.querySelector('#smShopClose');
  shop.close.textContent = t('shop.close');
  shop.close.addEventListener('click', () => closeShop());
  window.addEventListener('keydown', onKey);
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

/** A fresh owned-car record: base grade, first paint, nothing fitted yet. */
function freshSpec(gradeIndex) {
  return {
    grade: gradeIndex, paint: 0, paints: [0], engine: 0, armor: 0, neon: null,
    glow: true, stolen: false, stolenX: null, stolenY: null,
    posX: null, posY: null, posA: null,
  };
}

function buyGrade(gradeIndex) {
  const grade = MOTORS.grades[gradeIndex];
  if (!grade) return;
  if ((g.saveData.owned || []).length >= 3) {
    g.say(t('shop.motors.title'), t('shop.maxCars'), 2.6);
    return;
  }
  if (!spend(grade.price)) return;
  const spec = freshSpec(gradeIndex);
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

/** One tuning purchase at the desk: engine tier, armour tier or the neon cycle. */
function tune(kind) {
  const slot = activeOwned();
  if (slot < 0) return;
  const spec = g.saveData.owned[slot];
  if (kind === 'paint') {
    // Legacy entry point kept for safety; the desk rows call paintCar
    // with an explicit colour now (see below).
    paintCar(slot, (spec.paint + 1) % MOTORS.paints.length);
    return;
  }
  if (kind === 'engine' || kind === 'armor') {
    const tiers = kind === 'engine' ? MOTORS.engine : MOTORS.armor;
    const next = tiers[spec[kind]];
    if (!next || !spend(next.price)) return;
    spec[kind] += 1;
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
}

/**
 * Paint one owned car a chosen colour (the ownership model): a colour the
 * car does not own yet costs the desk price once and joins its owned set;
 * a colour it already owns is re-applied FREE — at this desk and from the
 * pause screen alike. Ownership is per car, like the engine and armour
 * tiers.
 */
function paintCar(slot, colour) {
  const spec = g.saveData.owned?.[slot];
  if (!spec || colour < 0 || colour >= MOTORS.paints.length) return;
  if (!Array.isArray(spec.paints)) spec.paints = [spec.paint];
  if (!spec.paints.includes(colour)) {
    if (!spend(MOTORS.paint)) return;
    spec.paints.push(colour);
  }
  spec.paint = colour;
  refreshCar(slot);
  commit();
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

/** The wardrobe's ownership record, rebuilt for saves that predate it. */
function fitOwn(fit) {
  if (!fit.own) {
    fit.own = { scarf: fit.scarf === true, hat: fit.hat === true, shades: fit.shades === true };
  }
  return fit.own;
}

function buyOutfit(kind, arg) {
  const fit = g.saveData.fit;
  // Ownership: fit.own records what has been BOUGHT; the fit[key] fields
  // themselves are only what is WORN. (Before this split, the worn flag
  // doubled as the owned flag, so taking a piece off and putting it back
  // on charged the full price again — the HOW TO PLAY page always
  // promised "bought once, worn whenever you like".)
  const own = fitOwn(fit);
  if (kind === 'color') {
    if (!own.scarf) return;
    fit.color = arg;
    g.player.fig.setFit(fit);
    g.sfx.uiBlip();
    commit();
    return;
  }
  if (own[kind]) {
    // Owned already: wearing and taking off are free.
    fit[kind] = !fit[kind];
    g.player.fig.setFit(fit);
    g.sfx.uiBlip();
    commit();
    return;
  }
  if (!spend(OUTFIT[kind])) return;
  own[kind] = true;
  fit[kind] = true;
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
  if (!spend(stars * FIXER.perStar)) return;
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

/** A row that can be tapped, with its price (or tag) on the right. */
function buyRow(label, right, on, extra = {}) {
  return { label, right, on, ...extra };
}

/** A row for something already at its final state: tagged, not tappable. */
function ownedRow(label) {
  return { label, tag: t('shop.owned'), cls: 'owned' };
}

function motorsRows(rows) {
  const owned = g.saveData.owned || [];
  for (let i = 0; i < MOTORS.grades.length; i += 1) {
    const gr = MOTORS.grades[i];
    rows.push(buyRow(t(`shop.motors.grade.${gr.id}`), cash(gr.price), () => buyGrade(i), {
      bad: g.money < gr.price,
    }));
  }
  const slot = activeOwned();
  if (slot < 0) {
    if (owned.length === 0) rows.push(noteRow(t('shop.motors.noCar')));
  } else {
    const spec = g.saveData.owned[slot];
    rows.push(noteRow(t('shop.motors.ownCar', { name: gradeName(MOTORS.grades[spec.grade].id) })));
    // One row per paint colour: owned colours re-apply FREE, a new colour
    // costs the paint price once (the ownership model).
    const ownedPaints = Array.isArray(spec.paints) ? spec.paints : [spec.paint];
    for (let i = 0; i < MOTORS.paints.length; i += 1) {
      const has = ownedPaints.includes(i);
      rows.push({
        label: t('shop.motors.paintN', { n: i + 1 }),
        right: has ? t('shop.free') : cash(MOTORS.paint),
        tag: spec.paint === i ? t('cust.current') : (has ? t('shop.owned') : null),
        cls: spec.paint === i ? 'owned' : '',
        bad: !has && g.money < MOTORS.paint,
        on: () => paintCar(slot, i),
      });
    }
    const eng = spec.engine < MOTORS.engine.length ? MOTORS.engine[spec.engine] : null;
    rows.push(eng
      ? buyRow(t('shop.motors.engine', { n: spec.engine + 1 }), cash(eng.price), () => tune('engine'), { bad: g.money < eng.price })
      : ownedRow(t('shop.motors.engine', { n: spec.engine })));
    const arm = spec.armor < MOTORS.armor.length ? MOTORS.armor[spec.armor] : null;
    rows.push(arm
      ? buyRow(t('shop.motors.armor', { n: spec.armor + 1 }), cash(arm.price), () => tune('armor'), { bad: g.money < arm.price })
      : ownedRow(t('shop.motors.armor', { n: spec.armor })));
    rows.push(buyRow(t('shop.motors.neon', { n: (spec.neon ?? -1) + 2 }), cash(MOTORS.neon), () => tune('neon'), {
      bad: g.money < MOTORS.neon,
    }));
    rows.push(buyRow(t('shop.motors.call'), cash(MOTORS.call), () => callCar(g), {
      bad: g.money < MOTORS.call,
    }));
  }
  if (owned.some((s) => s.stolen)) {
    rows.push(buyRow(t('shop.motors.recover'), cash(MOTORS.recover), () => recoverStolen(true), {
      bad: g.money < MOTORS.recover,
    }));
  }
  if (wreckedSlot() >= 0) {
    rows.push(buyRow(t('shop.motors.recoverWreck'), cash(MOTORS.recover), () => recoverWrecked(), {
      bad: g.money < MOTORS.recover,
    }));
  }
  return rows;
}

function ammoRows(rows) {
  const gear = g.saveData.gear;
  rows.push(gear.pistol
    ? ownedRow(t('shop.ammo.pistol'))
    : buyRow(t('shop.ammo.pistol'), cash(GEAR.pistol), () => buyGear('pistol'), { bad: g.money < GEAR.pistol }));
  const vest = GEAR.vest[gear.vest];
  rows.push(vest
    ? buyRow(t('shop.ammo.vest', { n: gear.vest + 1 }), cash(vest.price), () => buyGear('vest'), { bad: g.money < vest.price })
    : ownedRow(t('shop.ammo.vest', { n: gear.vest })));
  rows.push(gear.gloves
    ? ownedRow(t('shop.ammo.gloves'))
    : buyRow(t('shop.ammo.gloves'), cash(GEAR.gloves), () => buyGear('gloves'), { bad: g.money < GEAR.gloves }));
  rows.push(gear.shoes
    ? ownedRow(t('shop.ammo.shoes'))
    : buyRow(t('shop.ammo.shoes'), cash(GEAR.shoes), () => buyGear('shoes'), { bad: g.money < GEAR.shoes }));
  return rows;
}

function outfitRows(rows) {
  const fit = g.saveData.fit;
  const own = fit.own || {
    scarf: fit.scarf === true, hat: fit.hat === true, shades: fit.shades === true,
  };
  for (const key of ['scarf', 'hat', 'shades']) {
    rows.push({
      label: t(`shop.outfit.${key}`),
      right: own[key] ? null : cash(OUTFIT[key]),
      bad: !own[key] && g.money < OUTFIT[key],
      tag: fit[key] ? t('shop.wearing') : (own[key] ? t('shop.owned') : null),
      cls: own[key] ? 'owned' : '',
      on: () => buyOutfit(key),
    });
  }
  if (!own.scarf) rows.push(noteRow(t('shop.outfit.colorFree')));
  for (let i = 0; i < OUTFIT.colors.length; i += 1) {
    rows.push({
      label: t('shop.outfit.color', { n: i + 1 }),
      tag: fit.color === i ? t('cust.current') : null,
      cls: own.scarf && fit.color === i ? 'owned' : '',
      on: own.scarf ? () => buyOutfit('color', i) : null,
      off: !own.scarf,
    });
  }
  return rows;
}

function safehouseRows(rows) {
  if (g.saveData.safehouse) {
    rows.push(ownedRow(t('shop.safehouse.buy')));
    if (wreckedSlot() >= 0) {
      rows.push(buyRow(t('shop.motors.recoverWreck'), cash(MOTORS.recover), () => recoverWrecked(), {
        bad: g.money < MOTORS.recover,
      }));
    }
  } else {
    rows.push(buyRow(t('shop.safehouse.buy'), cash(SAFEHOUSE.price), buySafehouse, {
      bad: g.money < SAFEHOUSE.price,
    }));
  }
  return rows;
}

function fixerRows(rows) {
  if (g.stars > 0) {
    const cost = g.stars * FIXER.perStar;
    rows.push(buyRow(t('shop.fixer.clear', { stars: g.stars }), cash(cost), payFixer, {
      bad: g.money < cost,
    }));
  } else {
    rows.push(noteRow(t('shop.fixer.none')));
  }
  return rows;
}

const ROW_BUILDERS = {
  motors: motorsRows, ammo: ammoRows, outfit: outfitRows,
  safehouse: safehouseRows, fixer: fixerRows,
};

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

/** One tray row as a DOM button: label left, price or tag right. */
function rowButton(row, i) {
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
  else if (row.tag) {
    right.className = 'smTag';
    right.textContent = row.tag;
  }
  btn.appendChild(right);
  if (row.on) {
    btn.addEventListener('click', () => {
      sel = i;
      row.on();
    });
  } else {
    btn.classList.add('off');
  }
  return btn;
}

function renderShop() {
  if (!g?.shopOpen || !shop.el) return;
  const kind = g.shopOpen;
  shop.title.textContent = t(PANEL_TITLE[kind]);
  shop.sub.textContent = t(PANEL_SUB[kind]);
  if (shop.close) shop.close.textContent = t('shop.close');
  shop.cash.textContent = t('shop.money', { money: cash(g.money) });
  shop.body.innerHTML = '';
  rows = ROW_BUILDERS[kind]([]);
  sel = Math.min(sel, Math.max(0, rows.length - 1));
  rows.forEach((row, i) => shop.body.appendChild(rowButton(row, i)));
  shop.cash.textContent = t('shop.money', { money: cash(g.money) });
}

function openShop(kind) {
  if (!shop.el || g.shopOpen) return;
  g.shopOpen = kind;
  sel = 0;
  shop.el.classList.add('show');
  renderShop();
  g.sfx.uiBlip();
}

function closeShop() {
  if (!g?.shopOpen) return;
  g.shopOpen = null;
  if (shop.el) shop.el.classList.remove('show');
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

/* ------------------------------------------------------ pause CUSTOMIZE */
// The pause screen's re-dressing panel: switch only what the player
// already OWNS — outfit pieces and scarf colours, plus, while driving one
// of their own cars, that car's owned paint colours and its underglow
// switch. Nothing is sold here: buying still happens at the Surf Shack
// and the Motors desk. Every change writes the SAME save fields the shops
// write (saveData.fit, the car's spec), so the panel and the shops can
// never disagree, and applies to the rig / car at once. Paint applied
// from here only recolours — it never runs the full applyCarSpec, so it
// cannot double as a free repair.

const cust = { panel: null, body: null, title: null, backTop: null, backBottom: null };
let custIsOpen = false;
let custLang = null;

function buildCustomize() {
  if (cust.panel) return;
  installStyle('smShopStyle', SHOP_STYLE); // the .smRow classes live in the shop stylesheet
  installStyle('smCustStyle', CUST_STYLE);
  const panel = document.createElement('div');
  panel.id = 'smCust';
  panel.innerHTML = `
    <div class="inner">
      <div class="head"><h1 id="smCustTitle"></h1><button class="backBtn" id="smCustBack" type="button"></button></div>
      <div id="smCustBody"></div>
      <div class="foot"><button class="backBtn" id="smCustBack2" type="button"></button></div>
    </div>`;
  document.body.appendChild(panel);
  cust.panel = panel;
  cust.title = panel.querySelector('#smCustTitle');
  cust.body = panel.querySelector('#smCustBody');
  cust.backTop = panel.querySelector('#smCustBack');
  cust.backBottom = panel.querySelector('#smCustBack2');
  const onBack = (event) => { event.preventDefault(); closeCustomize(); };
  cust.backTop.addEventListener('click', onBack);
  cust.backBottom.addEventListener('click', onBack);
}

function custRow(label, tag, on) {
  const btn = document.createElement('button');
  btn.className = 'smRow tap';
  const left = document.createElement('span');
  left.textContent = label;
  btn.appendChild(left);
  if (tag) {
    const right = document.createElement('span');
    right.className = 'smTag';
    right.textContent = tag;
    btn.appendChild(right);
  }
  btn.addEventListener('click', () => on());
  return btn;
}

function custNote(text) {
  const d = document.createElement('div');
  d.className = 'smRow note';
  d.textContent = text;
  return d;
}

function custHead(text) {
  const h = document.createElement('h2');
  h.textContent = text;
  return h;
}

function custCommit() {
  g.persist?.();
  renderCustomize();
}

/** The outfit half of the panel: owned pieces and, with a scarf, its colours. */
function renderCustOutfit(fit, own) {
  cust.body.appendChild(custHead(t('cust.outfit')));
  if (!own.scarf && !own.hat && !own.shades) {
    cust.body.appendChild(custNote(t('cust.none')));
    return;
  }
  for (const key of ['scarf', 'hat', 'shades']) {
    if (!own[key]) continue;
    cust.body.appendChild(custRow(
      t(`shop.outfit.${key}`),
      fit[key] ? t('cust.on') : t('cust.off'),
      () => { fit[key] = !fit[key]; g.player.fig.setFit(fit); custCommit(); },
    ));
  }
  if (own.scarf) {
    for (let i = 0; i < OUTFIT.colors.length; i += 1) {
      cust.body.appendChild(custRow(
        t('shop.outfit.color', { n: i + 1 }),
        fit.color === i ? t('cust.current') : null,
        () => { fit.color = i; g.player.fig.setFit(fit); custCommit(); },
      ));
    }
  }
}

/** The car half of the panel: the driven own car's paints and glow switch. */
function renderCustCar() {
  cust.body.appendChild(custHead(t('cust.car')));
  const car = g.player.state === 'car' ? g.player.car : null;
  let slot = -1;
  if (car && car.owned) {
    slot = Number.isInteger(car.slot) ? car.slot
      : (g.saveData.owned || []).findIndex((s, i) => carForSlot(i) === car);
  }
  const spec = slot >= 0 ? g.saveData.owned[slot] : null;
  if (!spec) {
    cust.body.appendChild(custNote(t('cust.noCar')));
    return;
  }
  const paints = Array.isArray(spec.paints) ? spec.paints : [spec.paint];
  for (const i of [...paints].sort((a, b) => a - b)) {
    cust.body.appendChild(custRow(
      t('shop.motors.paintN', { n: i + 1 }),
      spec.paint === i ? t('cust.current') : null,
      () => { spec.paint = i; recolorCar(car, i); custCommit(); },
    ));
  }
  if (spec.neon !== null && spec.neon !== undefined) {
    cust.body.appendChild(custRow(
      t('cust.glow'),
      spec.glow === false ? t('cust.off') : t('cust.on'),
      () => {
        spec.glow = spec.glow === false ? true : false;
        setCarNeon(car, spec.glow ? spec.neon : -1);
        custCommit();
      },
    ));
  }
}

function renderCustomize() {
  if (!cust.panel) return;
  custLang = getLang();
  cust.title.textContent = t('cust.title');
  cust.backTop.textContent = t('cust.back');
  cust.backBottom.textContent = t('cust.back');
  cust.body.replaceChildren();
  const fit = g.saveData.fit;
  const own = fit.own || {
    scarf: fit.scarf === true, hat: fit.hat === true, shades: fit.shades === true,
  };
  renderCustOutfit(fit, own);
  renderCustCar();
}

export function customizeOpen() {
  return custIsOpen;
}

export function openCustomize() {
  if (!g || g.shopOpen) return;
  buildCustomize();
  renderCustomize();
  cust.panel.scrollTop = 0;
  cust.panel.classList.add('show');
  custIsOpen = true;
  g.sfx.uiBlip();
}

export function closeCustomize() {
  if (!custIsOpen) return;
  cust.panel.classList.remove('show');
  custIsOpen = false;
  // Never leave focus on a panel button: Enter would re-click it.
  const active = document.activeElement;
  if (active && cust.panel.contains(active)) active.blur();
  g.sfx.uiBlip();
}

/** Frame hook: a language switch while the panel is up re-renders it. */
export function syncCustomize() {
  if (custIsOpen && custLang !== getLang()) renderCustomize();
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
 * works the phone booth by the PD and Bruno's counter alike. Priority at
 * the counter: Bruno's work first (his talk keeps the E press while work
 * is on offer), then the MEAL while the player is hurt — healing is the
 * urgent need, and a wanted man who limps in must be able to eat; once he
 * has eaten, this prompt returns and the fixer is offered as usual. The
 * booth has no meal to yield to.
 */
export function fixerPrompt(game) {
  if (game.player.state !== 'foot' || game.stars <= 0) return null;
  const L = game.city.landmarks;
  const atBooth = near(game.player, L.fixer, 62);
  const atDiner = near(game.player, L.diner, 64);
  if (!atBooth && !atDiner) return null;
  if (atDiner && game.bruno && near(game.player, game.bruno, 50)
    && (missionAvailable(game) || jobAvailable(game))) return null;
  // The meal yield applies only when the meal can actually be bought (the
  // affordability gate, as in main.js): a hurt player who cannot pay is
  // not sent to a meal prompt that would eat his press — the fixer is
  // then judged on its own terms.
  if (atDiner && game.player.hp < game.player.maxHp && game.money >= MEAL_PRICE) return null;
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

const AVENUES = [280, 720, 1160, 1600, 2040, 2480, 2920];
const STREETS = [280, 720, 1160, 1600, 2040];

/** The nearest road frame to a point: the kerb spot a summoned car arrives at. */
function kerbSpot(p) {
  let best = null;
  const consider = (d, spot) => { if (!best || d < best.d) best = { d, ...spot }; };
  for (const avenue of AVENUES) {
    const toward = p.x >= avenue ? 1 : -1;
    consider(Math.abs(p.x - avenue), { x: avenue + toward * 42, y: p.y, axis: 'y', sign: toward });
  }
  for (const street of STREETS) {
    const toward = p.y >= street ? 1 : -1;
    consider(Math.abs(p.y - street), { x: p.x, y: street + toward * 42, axis: 'x', sign: toward });
  }
  return best;
}

/**
 * C / the CALL button: your own car is driven to the kerb for a fee. It
 * appears out of sight along the nearest road and rolls in, so it never
 * pops into view.
 */
export function callCar(game) {
  g = game;
  const owned = g.saveData.owned || [];
  if (owned.length === 0) {
    g.say(t('banner.call.title'), t('banner.call.none'), 2.8);
    g.sfx.tone('triangle', 180, 120, 0.1, 0.12);
    return;
  }
  const nearCar = g.cars.find((c) => c.owned && !c.wrecked
    && Math.hypot(c.x - g.player.x, c.y - g.player.y) < 150);
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
    if (owned[i].stolen) {
      if (!blocked) blocked = 'stolen';
      continue;
    }
    const live = carForSlot(i);
    if (live?.wrecked) {
      blocked = 'wrecked';
      continue;
    }
    if (live?.summon) {
      if (!blocked) blocked = 'coming';
      continue;
    }
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
  // The same car rolls in — never a duplicate: the slot's live car leaves
  // the world here and re-enters at the kerb approach below.
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
  // A call is a service, not a purchase: the car rolls in out in the
  // world, and the world stays frozen while the tray is open — so a
  // successful call from the desk closes the tray behind it. From the C
  // key / CALL button no tray is open and closeShop() simply no-ops. The
  // refusal paths above return early and keep the tray open: the player
  // is still at the desk.
  closeShop();
}

/** Roll a summoned car in toward its kerb spot, then let it sit. */
function updateSummon(dt) {
  for (const car of g.cars) {
    if (!car.summon) continue;
    const dx = car.summon.x - car.x;
    const dy = car.summon.y - car.y;
    const d = Math.hypot(dx, dy);
    // Arrival is a car length, not a point — and if the way to the exact
    // spot is wedged (a parked car holding the kerb, a corner),
    // separation physics can hold the car at a stand-off forever. No
    // closing progress for a beat and a half counts as arrived: it is at
    // the kerb, which is all the player asked for.
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
      // The arrival frame syncs too: the mesh must end exactly where the
      // logic says the car stopped.
      syncCarMesh(car, 0);
      continue;
    }
    const step = Math.min(d, 300 * dt);
    car.x += (dx / d) * step;
    car.y += (dy / d) * step;
    car.angle = Math.atan2(dy, dx);
    car.speed = 300;
    // A summoned car is parked-kind: nothing else syncs its mesh per
    // frame (updateTraffic is traffic-only, moveFreeCar is driven cars),
    // so moving x/y/angle here without a sync left the visible car
    // standing at the spawn point while its logical self rolled to the
    // kerb — the minimap dot and the enter prompt arrived, the car did
    // not. Sync every frame it moves.
    syncCarMesh(car, dt);
  }
}

/* -------------------------------------------------------- theft & recover */

/** Take a live car out of the world by hand (mesh and list entry). */
function pullFromWorld(car) {
  car.mesh.parent?.remove(car.mesh);
  const i = g.cars.indexOf(car);
  if (i >= 0) g.cars.splice(i, 1);
}

/** A car left alone far away is taken: flag it, pull it, and pin the map. */
function reportStolen(car) {
  const spec = g.saveData.owned?.[car.slot];
  if (!spec || spec.stolen) return;
  spec.stolen = true;
  spec.stolenX = car.x;
  spec.stolenY = car.y;
  pinsDirty = true;
  pullFromWorld(car);
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
  pinsDirty = true;
  const car = spawnCar(g, 'parked', x, y, Math.PI / 2, MOTORS.paints[spec.paint]);
  car.touched = true;
  car.slot = idx;
  applyCarSpec(car, spec);
  g.say(t('banner.recovered.title'), t('banner.recovered.sub'), 3);
  g.sfx.confirm();
  g.persist?.();
  renderShop();
  // The PAID desk recovery is a service, not a purchase: the car is back
  // out in the world, so the tray closes behind it. The free
  // walk-to-the-pin path (paid === false) never has a tray open and keeps
  // its hands off it.
  if (paid) closeShop();
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
 * Pay to un-wreck a bought car where it sits: the wreck state clears, the
 * fire goes out on the next updateWrecks pass, and the HP comes back
 * whole. A bought car is never towed away, so this — at the Motors desk
 * or the safehouse — is its way back from dead.
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
  // Stand the mesh back up NOW: the wreck pose (sunk, tilted) was written
  // by syncCarMesh when the car died, and an owned wreck never sinks, so
  // updateWrecks' sink-undo branch never fires for it — without this sync
  // the car sat sunken and tilted, whole on paper and dead to look at,
  // until somebody drove or shoved it. The fire FX still goes out on the
  // next updateWrecks pass, as before.
  syncCarMesh(car, 0);
  g.say(t('banner.recovered.title'), t('banner.recovered.sub'), 3);
  g.sfx.confirm();
  g.persist?.();
  renderShop();
  // A service like the call and the theft recovery: the car is whole
  // again out where it sits, so the tray closes behind it — at the
  // Motors desk and at the safehouse alike.
  closeShop();
}

/** Map pins for the stolen cars, rebuilt as the save changes. */
let pinsDirty = true;
function syncPins() {
  if (!pinsDirty) return;
  pinsDirty = false;
  const pins = [];
  for (const s of g.saveData.owned || []) {
    if (s.stolen && s.stolenX !== null) pins.push({ x: s.stolenX, y: s.stolenY });
  }
  g.stolenPins = pins;
}

/** Bring the owned cars back into the world after a load. */
export function spawnOwnedCars(game) {
  g = game;
  const list = g.saveData.owned || [];
  for (let i = 0; i < list.length; i += 1) {
    const spec = list[i];
    if (spec.stolen) continue;
    if (g.cars.some((c) => c.owned && c.slot === i)) continue;
    // A car with a recorded last position comes back where the player
    // left it, heading included. A car without one (never driven under a
    // build that records it — every car in an older save) keeps the
    // Motors-lot spawn it has always had.
    const hasPos = Number.isFinite(spec.posX) && Number.isFinite(spec.posY);
    const lot = g.city.motorsLot?.[i % Math.max(1, g.city.motorsLot.length)] || { x: game.player.x + 80, y: game.player.y };
    const car = spawnCar(
      g, 'parked',
      hasPos ? spec.posX : lot.x,
      hasPos ? spec.posY : lot.y,
      hasPos && Number.isFinite(spec.posA) ? spec.posA : Math.PI / 2,
      MOTORS.paints[spec.paint],
    );
    car.touched = true;
    car.slot = i;
    applyCarSpec(car, spec);
  }
  syncPins();
}

/**
 * Bring back the last car the player stole: one ordinary stealable car of
 * the recorded colour, standing where he left it. It is `touched` — the
 * fleet systems leave it alone exactly like any car he has taken — and
 * the tracker below keeps its record current for as long as it stays in
 * the world.
 */
export function spawnLastStolenCar(game) {
  g = game;
  const rec = g.saveData?.lastStolen;
  if (!rec || g.lastStolenCar) return;
  const car = spawnCar(g, 'parked', rec.x, rec.y, rec.angle, rec.color);
  car.touched = true;
  g.lastStolenCar = car;
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
  game.lastStolenCar = null;
  game.applyGear = applyGear;
  applyGear();
}

/** The theft clock: an owned car left alone far away is taken. */
function updateTheft(dt) {
  for (let ci = g.cars.length - 1; ci >= 0; ci -= 1) {
    const car = g.cars[ci];
    if (!car.owned || car.occupant || car.wrecked || car.summon) continue;
    const d = Math.hypot(car.x - g.player.x, car.y - g.player.y);
    car.awayT = d > THEFT.range ? (car.awayT ?? 0) + dt : 0;
    if (car.awayT > THEFT.after) reportStolen(car);
  }
}

/**
 * Last positions: each owned car's record follows its live car — driven,
 * parked, even shoved by traffic — so a reload puts it back where it
 * actually rests. A stolen-flagged car is the theft flow's business (its
 * pin position rules), not this one's.
 */
function trackPositions(list) {
  for (let i = 0; i < list.length; i += 1) {
    const spec = list[i];
    if (spec.stolen) continue;
    const car = carForSlot(i);
    if (!car) continue;
    spec.posX = car.x;
    spec.posY = car.y;
    spec.posA = car.angle;
  }
}

/**
 * The one recorded stolen car, likewise: its record tracks the live car
 * while it sits in the world. A wreck — or a car somehow gone from the
 * world — ends the record: a wreck is never resurrected.
 */
function trackLastStolen() {
  const recCar = g.lastStolenCar;
  if (!recCar) return;
  if (!g.cars.includes(recCar) || recCar.wrecked) {
    g.lastStolenCar = null;
    if (g.saveData.lastStolen) {
      g.saveData.lastStolen = null;
      g.persist?.();
    }
  } else if (g.saveData.lastStolen) {
    g.saveData.lastStolen.x = recCar.x;
    g.saveData.lastStolen.y = recCar.y;
    g.saveData.lastStolen.angle = recCar.angle;
  }
}

/** Walk-up recovery: standing at a stolen car's pin brings it back free. */
function updatePinRecovery(list) {
  for (let i = 0; i < list.length; i += 1) {
    const spec = list[i];
    if (!spec.stolen || spec.stolenX === null) continue;
    if (Math.hypot(g.player.x - spec.stolenX, g.player.y - spec.stolenY) < 56) {
      recoverStolen(false, i);
      break;
    }
  }
}

/** Per-frame: the theft clock, walk-up recovery and summoned cars rolling in. */
export function updateEconomy(game, dt) {
  g = game;
  if (!g.saveData || g.state !== 'play') return;
  updateSummon(dt);
  updateTheft(dt);
  const list = g.saveData.owned || [];
  trackPositions(list);
  trackLastStolen();
  updatePinRecovery(list);
  syncPins();
}

/** Progress reset: take the bought cars out of the world too. */
export function resetEconomy(game) {
  g = game;
  for (const car of [...g.cars]) {
    if (!car.owned) continue;
    pullFromWorld(car);
  }
  g.lastStolenCar = null;
  g.stolenPins = [];
  pinsDirty = true;
  g.shopOpen = null;
  if (shop.el) shop.el.classList.remove('show');
}

/** Movement-blocking check for the touch CALL button. */
export function canCallCar(game) {
  return (game.saveData.owned || []).length > 0;
}
