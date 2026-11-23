// economy.js — everything in Palmera that takes the player's money or
// gives something back for it.
//
// Four counters share one tray UI: PALMERA MOTORS (cars, paint, tuning,
// recovery), the Ammo Hut (gear), the Surf Shack (the wardrobe) and the
// safehouse door (a one-time purchase, then a free bed). A fifth service,
// the fixer, sells a clean slate by the star and works out of Bruno's
// diner and the phone booth by the PD. On top of the counters sit three
// world systems: the phone delivery that rolls an owned car to the kerb,
// the theft clock that takes a car left alone too long, and the position
// tracker that puts every owned car back where it was left on a reload.
//
// The pause screen's CUSTOMIZE panel also lives here: it re-dresses the
// hero and the driven car out of what is already owned, and never sells.
import {
  FIXER, GEAR, MEAL_PRICE, MOTORS, NEON, OUTFIT, PLAYER, SAFEHOUSE, THEFT,
} from './config.js';
import { getLang, t } from './i18n.js';
import { jobAvailable, missionAvailable } from './missions.js';
import { applyCarSpec, recolorCar, removeCar, setCarNeon, spawnCar, syncCarMesh } from './vehicles.js';

/** The game object, refreshed by every entry point that receives it. */
let g = null;

/** Is `spot` within `range` of the player? Missing spots never match. */
function near(spot, range) {
  return !!spot && Math.hypot(g.player.x - spot.x, g.player.y - spot.y) < range;
}

/** Cash the way the HUD writes it, so the tray never disagrees with it. */
function cash(n) {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/* ------------------------------------------------------------------ */
/* Styles. Two sheets: the shop tray, and the full-screen CUSTOMIZE    */
/* panel that borrows the tray's row classes.                          */
/* ------------------------------------------------------------------ */

const TRAY_RULES = [
  '#smShop{position:fixed;left:50%;bottom:10%;transform:translateX(-50%);width:min(560px,94vw);max-height:78vh;display:none;flex-direction:column;background:rgba(14,18,30,.96);border:2px solid rgba(255,217,77,.55);border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.55);z-index:40;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#f4f1e6;overflow:hidden}',
  '#smShop.show{display:flex}',
  '#smShopHead{padding:12px 16px 8px;border-bottom:1px solid rgba(255,255,255,.12)}',
  '#smShopTitle{font-size:19px;letter-spacing:1px;color:#ffd94d}',
  '#smShopSub{display:block;font-size:12px;opacity:.75;margin-top:3px}',
  '#smShopBody{overflow-y:auto;padding:8px 10px;display:flex;flex-direction:column;gap:6px}',
  '.smRow{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-height:44px;padding:7px 12px;border-radius:9px;cursor:pointer;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.10);color:#f4f1e6;font-size:14px;font:inherit;text-align:left}',
  '.smRow.tap:hover,.smRow.tap:active{background:rgba(255,217,77,.18);border-color:#ffd94d}',
  '.smRow.sel{border-color:#ffd94d;background:rgba(255,217,77,.14)}',
  '.smRow.off{opacity:.45;cursor:default}',
  '.smRow.owned{border-color:rgba(90,209,232,.6)}',
  '.smRow.note{background:transparent;border-color:transparent;opacity:.7;font-size:12px;cursor:default}',
  '.smPrice{color:#8dff6a;font-variant-numeric:tabular-nums;white-space:nowrap}',
  '.smPrice.bad{color:#ff8a7a}',
  '.smTag{color:#5ad1e8;font-size:12px;letter-spacing:1px}',
  '.smNum{opacity:.5;font-size:12px;min-width:16px}',
  '#smShopFoot{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-top:1px solid rgba(255,255,255,.12)}',
  '#smShopCash{font-size:13px;color:#8dff6a;font-variant-numeric:tabular-nums}',
  '#smShopClose{min-height:40px;min-width:96px;padding:0 18px;border-radius:9px;font:inherit;background:#ffd94d;color:#1a1a22;border:0;font-weight:700;letter-spacing:1px;cursor:pointer}',
];

const CUST_RULES = [
  '#smCust{position:fixed;inset:0;z-index:60;display:none;overflow-y:auto;-webkit-overflow-scrolling:touch;box-sizing:border-box;padding:calc(12px + env(safe-area-inset-top)) 16px calc(22px + env(safe-area-inset-bottom));background:rgba(10,13,22,.94);font-family:system-ui,sans-serif;color:#f4f1e6}',
  '#smCust.show{display:block}',
  '#smCust .inner{max-width:560px;margin:0 auto}',
  '#smCustBody{display:flex;flex-direction:column;gap:6px}',
  '#smCust .head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0 4px}',
  '#smCust h1{margin:0;color:#ffd94d;font-size:26px;font-weight:900;letter-spacing:1px}',
  '#smCust h2{color:#ffd94d;font-size:15px;font-weight:800;letter-spacing:1px;margin:16px 0 2px;padding-bottom:4px;border-bottom:2px solid rgba(255,217,77,.35)}',
  '#smCust .backBtn{padding:10px 22px;border-radius:999px;border:3px solid #17181c;background:#ffd94d;color:#17181c;font:800 15px system-ui,sans-serif;white-space:nowrap;cursor:pointer;touch-action:none;-webkit-user-select:none;user-select:none}',
  '#smCust .foot{text-align:center;margin:20px 0 4px}',
];

/** Drop a stylesheet into the document once, keyed by element id. */
function injectStyle(id, rules) {
  if (document.getElementById(id)) return;
  const el = document.createElement('style');
  el.id = id;
  el.textContent = rules.join('\n');
  document.head.appendChild(el);
}

/* ------------------------------------------------------------------ */
/* The shop tray's DOM, created lazily and kept for the whole run.     */
/* ------------------------------------------------------------------ */

const trayEl = { root: null, body: null, title: null, sub: null, cash: null, close: null };

function buildTray() {
  if (trayEl.root) return;
  injectStyle('smShopStyle', TRAY_RULES);
  const root = document.createElement('div');
  root.id = 'smShop';
  const head = document.createElement('div');
  head.id = 'smShopHead';
  const title = document.createElement('span');
  title.id = 'smShopTitle';
  const sub = document.createElement('span');
  sub.id = 'smShopSub';
  head.append(title, sub);
  const body = document.createElement('div');
  body.id = 'smShopBody';
  const foot = document.createElement('div');
  foot.id = 'smShopFoot';
  const cashEl = document.createElement('span');
  cashEl.id = 'smShopCash';
  const closeBtn = document.createElement('button');
  closeBtn.id = 'smShopClose';
  closeBtn.textContent = t('shop.close');
  foot.append(cashEl, closeBtn);
  root.append(head, body, foot);
  document.body.appendChild(root);
  Object.assign(trayEl, { root, body, title, sub, cash: cashEl, close: closeBtn });
  closeBtn.addEventListener('click', () => closeShop());
  window.addEventListener('keydown', trayKeys);
}

/* ------------------------------------------------------------------ */
/* Shared money plumbing.                                             */
/* ------------------------------------------------------------------ */

/** Take `price` from the player. Refuses — loudly — when he is short. */
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

/** Common tail of every purchase: gear re-applied, save written, tray redrawn. */
function afterPurchase() {
  if (g.applyGear) g.applyGear();
  g.persist?.();
  renderShop();
}

/** The save slot the Motors desk works on: the first car not flagged stolen. */
function tuningSlot() {
  const owned = g.saveData.owned || [];
  for (let i = 0; i < owned.length; i += 1) {
    if (!owned[i].stolen) return i;
  }
  return -1;
}

/** The world car currently standing for save slot `i`, if it exists. */
function carOf(i) {
  return g.cars.find((c) => c.owned && c.slot === i) || null;
}

/** The first slot whose live car is wrecked, or -1 when all are whole. */
function wreckedSlot() {
  const owned = g.saveData.owned || [];
  for (let i = 0; i < owned.length; i += 1) {
    if (carOf(i)?.wrecked) return i;
  }
  return -1;
}

/* ------------------------------------------------------------------ */
/* PALMERA MOTORS — cars, paint, tuning.                               */
/* ------------------------------------------------------------------ */

/** A brand-new ownership record: stock grade, first paint, nothing fitted. */
function freshSpec(gradeIndex) {
  return {
    grade: gradeIndex,
    paint: 0,
    paints: [0],
    engine: 0,
    armor: 0,
    neon: null,
    glow: true,
    stolen: false,
    stolenX: null,
    stolenY: null,
    posX: null,
    posY: null,
    posA: null,
  };
}

/** Spawn a just-bought car on the Motors lot and bind it to its slot. */
function deliverBought(spec, slot) {
  const lot = g.city.motorsLot || [];
  let spot = lot[slot % Math.max(1, lot.length)] || { x: g.player.x + 90, y: g.player.y };
  // Nudge along the lot until the spot is not already occupied.
  for (let tries = 0; tries < 6; tries += 1) {
    if (!g.cars.some((c) => Math.hypot(c.x - spot.x, c.y - spot.y) < 66)) break;
    spot = { x: spot.x + 70, y: spot.y };
  }
  const car = spawnCar(g, 'parked', spot.x, spot.y, Math.PI / 2, MOTORS.paints[spec.paint]);
  car.touched = true;
  car.slot = slot;
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
  const spec = freshSpec(gradeIndex);
  g.saveData.owned.push(spec);
  deliverBought(spec, g.saveData.owned.length - 1);
  g.say(t('banner.car.title'), t('banner.car.sub', { name: t(`car.${grade.id}`) }), 3.2);
  afterPurchase();
}

/** Push a slot's saved spec back onto its live car after a desk change. */
function respec(slot) {
  const spec = g.saveData.owned[slot];
  const car = carOf(slot);
  if (spec && car) applyCarSpec(car, spec);
}

/**
 * Paint slot's car `colour`. Paint is owned per car: the first use of a
 * colour costs the desk price, every later re-application — here or from
 * the pause panel — is free.
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
  respec(slot);
  afterPurchase();
}

/** One desk tuning step: an engine tier, an armour tier, or the neon cycle. */
function tune(kind) {
  const slot = tuningSlot();
  if (slot < 0) return;
  const spec = g.saveData.owned[slot];
  if (kind === 'paint') {
    // Kept legacy entry: cycle to the next colour. The desk rows now
    // call paintCar with an explicit colour instead.
    paintCar(slot, (spec.paint + 1) % MOTORS.paints.length);
    return;
  }
  if (kind === 'neon') {
    if (!spend(MOTORS.neon)) return;
    spec.neon = ((spec.neon ?? -1) + 1) % NEON.length;
    respec(slot);
    afterPurchase();
    return;
  }
  const ladder = kind === 'engine' ? MOTORS.engine : MOTORS.armor;
  const next = ladder[spec[kind]];
  if (!next || !spend(next.price)) return;
  spec[kind] += 1;
  respec(slot);
  g.sfx.confirm();
  afterPurchase();
}

/* ------------------------------------------------------------------ */
/* Ammo Hut — the gear counter.                                        */
/* ------------------------------------------------------------------ */

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
  afterPurchase();
}

/* ------------------------------------------------------------------ */
/* Surf Shack — the wardrobe. Ownership (fit.own) is kept apart from   */
/* what is worn (the fit flags themselves), so taking a bought piece   */
/* off and putting it back on never charges twice.                     */
/* ------------------------------------------------------------------ */

/** The ownership record for a save, derived from the worn flags if absent. */
function ownOf(fit) {
  if (!fit.own) {
    fit.own = { scarf: fit.scarf === true, hat: fit.hat === true, shades: fit.shades === true };
  }
  return fit.own;
}

function buyOutfit(kind, arg) {
  const fit = g.saveData.fit;
  const own = ownOf(fit);
  if (kind === 'color') {
    // Scarf colours are part of owning the scarf.
    if (!own.scarf) return;
    fit.color = arg;
    g.player.fig.setFit(fit);
    g.sfx.uiBlip();
    afterPurchase();
    return;
  }
  if (own[kind]) {
    fit[kind] = !fit[kind];
    g.player.fig.setFit(fit);
    g.sfx.uiBlip();
    afterPurchase();
    return;
  }
  if (!spend(OUTFIT[kind])) return;
  own[kind] = true;
  fit[kind] = true;
  g.player.fig.setFit(fit);
  g.sfx.confirm();
  afterPurchase();
}

/* ------------------------------------------------------------------ */
/* The safehouse and the fixer — one-shot services.                    */
/* ------------------------------------------------------------------ */

function buySafehouse() {
  if (g.saveData.safehouse || !spend(SAFEHOUSE.price)) return;
  g.saveData.safehouse = true;
  g.sfx.confirm();
  g.say(t('banner.safehouse.title'), t('banner.safehouse.sub'), 3.4);
  afterPurchase();
}

function payFixer() {
  const stars = g.stars;
  if (stars <= 0) return;
  if (!spend(stars * FIXER.perStar)) return;
  g.heat = 0;
  g.stars = 0;
  g.cooling = false;
  g.say(t('banner.fixer.title'), t('banner.fixer.sub'), 3);
  g.sfx.confirm();
  afterPurchase();
}

/* ------------------------------------------------------------------ */
/* Tray panels. A panel is a list of row descriptors:                  */
/*   { label, right }  a tappable row showing a price on the right     */
/*   { label, tag }    a tappable row showing a status tag instead     */
/*   { label, cls }    an inert note or an already-owned marker        */
/* `bad` flags a price the player cannot currently cover.              */
/* ------------------------------------------------------------------ */

function noteLine(text) {
  return { label: text, cls: 'note', on: null };
}

function priceLine(label, price, on, extra = {}) {
  return { label, right: cash(price), on, bad: g.money < price, ...extra };
}

function ownedLine(label) {
  return { label, tag: t('shop.owned'), cls: 'owned' };
}

function motorsRows() {
  const rows = [];
  const owned = g.saveData.owned || [];
  for (let i = 0; i < MOTORS.grades.length; i += 1) {
    const gr = MOTORS.grades[i];
    rows.push(priceLine(t(`shop.motors.grade.${gr.id}`), gr.price, () => buyGrade(i)));
  }
  const slot = tuningSlot();
  if (slot < 0) {
    if (owned.length === 0) rows.push(noteLine(t('shop.motors.noCar')));
  } else {
    const spec = owned[slot];
    rows.push(noteLine(t('shop.motors.ownCar', { name: t(`car.${MOTORS.grades[spec.grade].id}`) })));
    // One row per colour: owned colours re-apply free, new ones cost once.
    const paints = Array.isArray(spec.paints) ? spec.paints : [spec.paint];
    for (let i = 0; i < MOTORS.paints.length; i += 1) {
      const has = paints.includes(i);
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
      ? priceLine(t('shop.motors.engine', { n: spec.engine + 1 }), eng.price, () => tune('engine'))
      : ownedLine(t('shop.motors.engine', { n: spec.engine })));
    const arm = spec.armor < MOTORS.armor.length ? MOTORS.armor[spec.armor] : null;
    rows.push(arm
      ? priceLine(t('shop.motors.armor', { n: spec.armor + 1 }), arm.price, () => tune('armor'))
      : ownedLine(t('shop.motors.armor', { n: spec.armor })));
    rows.push(priceLine(t('shop.motors.neon', { n: (spec.neon ?? -1) + 2 }), MOTORS.neon, () => tune('neon')));
    rows.push(priceLine(t('shop.motors.call'), MOTORS.call, () => callCar(g)));
  }
  if (owned.some((s) => s.stolen)) {
    rows.push(priceLine(t('shop.motors.recover'), MOTORS.recover, () => recoverStolen(true)));
  }
  if (wreckedSlot() >= 0) {
    rows.push(priceLine(t('shop.motors.recoverWreck'), MOTORS.recover, () => recoverWrecked()));
  }
  return rows;
}

function ammoRows() {
  const gear = g.saveData.gear;
  const rows = [];
  rows.push(gear.pistol
    ? ownedLine(t('shop.ammo.pistol'))
    : priceLine(t('shop.ammo.pistol'), GEAR.pistol, () => buyGear('pistol')));
  const vest = GEAR.vest[gear.vest];
  rows.push(vest
    ? priceLine(t('shop.ammo.vest', { n: gear.vest + 1 }), vest.price, () => buyGear('vest'))
    : ownedLine(t('shop.ammo.vest', { n: gear.vest })));
  rows.push(gear.gloves
    ? ownedLine(t('shop.ammo.gloves'))
    : priceLine(t('shop.ammo.gloves'), GEAR.gloves, () => buyGear('gloves')));
  rows.push(gear.shoes
    ? ownedLine(t('shop.ammo.shoes'))
    : priceLine(t('shop.ammo.shoes'), GEAR.shoes, () => buyGear('shoes')));
  return rows;
}

function outfitRows() {
  const fit = g.saveData.fit;
  // Read the ownership split without writing it back: the panel only
  // reports; buyOutfit is what materialises fit.own on an old save.
  const own = fit.own || {
    scarf: fit.scarf === true, hat: fit.hat === true, shades: fit.shades === true,
  };
  const rows = [];
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
  if (!own.scarf) rows.push(noteLine(t('shop.outfit.colorFree')));
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

function safehouseRows() {
  const rows = [];
  if (g.saveData.safehouse) {
    rows.push(ownedLine(t('shop.safehouse.buy')));
    if (wreckedSlot() >= 0) {
      rows.push(priceLine(t('shop.motors.recoverWreck'), MOTORS.recover, () => recoverWrecked()));
    }
  } else {
    rows.push(priceLine(t('shop.safehouse.buy'), SAFEHOUSE.price, buySafehouse));
  }
  return rows;
}

function fixerRows() {
  if (g.stars <= 0) return [noteLine(t('shop.fixer.none'))];
  const cost = g.stars * FIXER.perStar;
  return [{
    label: t('shop.fixer.clear', { stars: g.stars }),
    right: cash(cost),
    bad: g.money < cost,
    on: payFixer,
  }];
}

const PANEL_BUILDERS = {
  motors: motorsRows,
  ammo: ammoRows,
  outfit: outfitRows,
  safehouse: safehouseRows,
  fixer: fixerRows,
};

let shownRows = [];
let highlight = 0;

/** Render one row descriptor as the tray's button element. */
function rowButton(row, index) {
  const btn = document.createElement('button');
  btn.className = `smRow ${row.cls || ''} ${row.on ? 'tap' : ''}`.trim();
  if (row.bad) btn.classList.add('short');
  if (index === highlight && row.on) btn.classList.add('sel');
  const label = document.createElement('span');
  label.textContent = row.label;
  btn.appendChild(label);
  const right = document.createElement('span');
  right.className = `smPrice${row.bad ? ' bad' : ''}`;
  if (row.right) {
    right.textContent = row.right;
  } else if (row.tag) {
    right.className = 'smTag';
    right.textContent = row.tag;
  }
  btn.appendChild(right);
  if (row.on) {
    btn.addEventListener('click', () => {
      highlight = index;
      row.on();
    });
  } else {
    btn.classList.add('off');
  }
  return btn;
}

function renderShop() {
  if (!g?.shopOpen || !trayEl.root) return;
  const kind = g.shopOpen;
  trayEl.title.textContent = t(`shop.${kind}.title`);
  trayEl.sub.textContent = t(`shop.${kind}.sub`);
  if (trayEl.close) trayEl.close.textContent = t('shop.close');
  trayEl.body.innerHTML = '';
  shownRows = PANEL_BUILDERS[kind]();
  highlight = Math.min(highlight, Math.max(0, shownRows.length - 1));
  shownRows.forEach((row, i) => trayEl.body.appendChild(rowButton(row, i)));
  trayEl.cash.textContent = t('shop.money', { money: cash(g.money) });
}

function openShop(kind) {
  if (!trayEl.root || g.shopOpen) return;
  g.shopOpen = kind;
  highlight = 0;
  trayEl.root.classList.add('show');
  renderShop();
  g.sfx.uiBlip();
}

function closeShop() {
  if (!g?.shopOpen) return;
  g.shopOpen = null;
  if (trayEl.root) trayEl.root.classList.remove('show');
  g.sfx.uiBlip();
}

/** True while a shop tray is up; the world waits behind it. */
export function economyBusy(game) {
  return !!game.shopOpen;
}

/** Tray keys: Escape or E closes; a digit fires that row. */
function trayKeys(event) {
  if (!g?.shopOpen) return;
  if (event.key === 'Escape' || event.code === 'KeyE') {
    event.preventDefault();
    closeShop();
    return;
  }
  const n = Number(event.key);
  if (Number.isInteger(n) && n >= 1 && n <= shownRows.length) {
    const row = shownRows[n - 1];
    if (row?.on) {
      event.preventDefault();
      highlight = n - 1;
      row.on();
    }
  }
}

/* ------------------------------------------------------------------ */
/* CUSTOMIZE — the pause panel. It only re-applies what the player     */
/* already owns: outfit pieces and scarf colours, and — while he is    */
/* driving one of his own cars — that car's owned paints and its       */
/* underglow switch. It writes the very same save fields the shops     */
/* write, so panel and counters can never disagree; paint from here    */
/* recolours through recolorCar only, never the full applyCarSpec,     */
/* so it cannot double as a free repair.                               */
/* ------------------------------------------------------------------ */

const custEl = { panel: null, body: null, title: null, backTop: null, backFoot: null };
let custShown = false;
let custRenderedLang = null;

function buildCustomize() {
  if (custEl.panel) return;
  injectStyle('smShopStyle', TRAY_RULES); // the .smRow classes live in the tray sheet
  injectStyle('smCustStyle', CUST_RULES);
  const panel = document.createElement('div');
  panel.id = 'smCust';
  const inner = document.createElement('div');
  inner.className = 'inner';
  const head = document.createElement('div');
  head.className = 'head';
  const title = document.createElement('h1');
  title.id = 'smCustTitle';
  const backTop = document.createElement('button');
  backTop.className = 'backBtn';
  backTop.id = 'smCustBack';
  backTop.type = 'button';
  head.append(title, backTop);
  const body = document.createElement('div');
  body.id = 'smCustBody';
  const foot = document.createElement('div');
  foot.className = 'foot';
  const backFoot = document.createElement('button');
  backFoot.className = 'backBtn';
  backFoot.id = 'smCustBack2';
  backFoot.type = 'button';
  foot.appendChild(backFoot);
  inner.append(head, body, foot);
  panel.appendChild(inner);
  document.body.appendChild(panel);
  Object.assign(custEl, { panel, body, title, backTop, backFoot });
  const onBack = (event) => { event.preventDefault(); closeCustomize(); };
  backTop.addEventListener('click', onBack);
  backFoot.addEventListener('click', onBack);
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
  const div = document.createElement('div');
  div.className = 'smRow note';
  div.textContent = text;
  return div;
}

function custHeading(text) {
  const h = document.createElement('h2');
  h.textContent = text;
  return h;
}

/** After a panel change: persist, then redraw the panel in place. */
function custAfter() {
  g.persist?.();
  renderCustomize();
}

function custOutfitPart(fit, own) {
  custEl.body.appendChild(custHeading(t('cust.outfit')));
  if (!own.scarf && !own.hat && !own.shades) {
    custEl.body.appendChild(custNote(t('cust.none')));
    return;
  }
  for (const key of ['scarf', 'hat', 'shades']) {
    if (!own[key]) continue;
    custEl.body.appendChild(custRow(
      t(`shop.outfit.${key}`),
      fit[key] ? t('cust.on') : t('cust.off'),
      () => { fit[key] = !fit[key]; g.player.fig.setFit(fit); custAfter(); },
    ));
  }
  if (own.scarf) {
    for (let i = 0; i < OUTFIT.colors.length; i += 1) {
      custEl.body.appendChild(custRow(
        t('shop.outfit.color', { n: i + 1 }),
        fit.color === i ? t('cust.current') : null,
        () => { fit.color = i; g.player.fig.setFit(fit); custAfter(); },
      ));
    }
  }
}

function custCarPart() {
  custEl.body.appendChild(custHeading(t('cust.car')));
  const driven = g.player.state === 'car' ? g.player.car : null;
  let slot = -1;
  if (driven && driven.owned) {
    slot = Number.isInteger(driven.slot)
      ? driven.slot
      : (g.saveData.owned || []).findIndex((s, i) => carOf(i) === driven);
  }
  const spec = slot >= 0 ? g.saveData.owned[slot] : null;
  if (!spec) {
    custEl.body.appendChild(custNote(t('cust.noCar')));
    return;
  }
  const paints = Array.isArray(spec.paints) ? spec.paints : [spec.paint];
  for (const i of [...paints].sort((a, b) => a - b)) {
    custEl.body.appendChild(custRow(
      t('shop.motors.paintN', { n: i + 1 }),
      spec.paint === i ? t('cust.current') : null,
      () => { spec.paint = i; recolorCar(driven, i); custAfter(); },
    ));
  }
  if (spec.neon !== null && spec.neon !== undefined) {
    custEl.body.appendChild(custRow(
      t('cust.glow'),
      spec.glow === false ? t('cust.off') : t('cust.on'),
      () => {
        spec.glow = spec.glow === false ? true : false;
        setCarNeon(driven, spec.glow ? spec.neon : -1);
        custAfter();
      },
    ));
  }
}

function renderCustomize() {
  if (!custEl.panel) return;
  custRenderedLang = getLang();
  custEl.title.textContent = t('cust.title');
  custEl.backTop.textContent = t('cust.back');
  custEl.backFoot.textContent = t('cust.back');
  custEl.body.replaceChildren();
  const fit = g.saveData.fit;
  const own = fit.own || {
    scarf: fit.scarf === true, hat: fit.hat === true, shades: fit.shades === true,
  };
  custOutfitPart(fit, own);
  custCarPart();
}

export function customizeOpen() {
  return custShown;
}

export function openCustomize() {
  if (!g || g.shopOpen) return;
  buildCustomize();
  renderCustomize();
  custEl.panel.scrollTop = 0;
  custEl.panel.classList.add('show');
  custShown = true;
  g.sfx.uiBlip();
}

export function closeCustomize() {
  if (!custShown) return;
  custEl.panel.classList.remove('show');
  custShown = false;
  // A focused panel button would swallow the next Enter as a re-click.
  const active = document.activeElement;
  if (active && custEl.panel.contains(active)) active.blur();
  g.sfx.uiBlip();
}

/** Frame hook: keep an open panel in the player's current language. */
export function syncCustomize() {
  if (custShown && custRenderedLang !== getLang()) renderCustomize();
}

/* ------------------------------------------------------------------ */
/* Spots and prompts — what an E press here would do.                  */
/* ------------------------------------------------------------------ */

/** The counter the player is standing at, in priority order. */
function counterHere(game) {
  const L = game.city.landmarks;
  if (Math.hypot(game.player.x - L.motors.x, game.player.y - L.motors.y) < 74) return 'motors';
  if (Math.hypot(game.player.x - L.ammo.x, game.player.y - L.ammo.y) < 74) return 'ammo';
  if (Math.hypot(game.player.x - L.surf.x, game.player.y - L.surf.y) < 62) return 'outfit';
  if (Math.hypot(game.player.x - L.safehouse.x, game.player.y - L.safehouse.y) < 74) return 'safehouse';
  return null;
}

/**
 * The fixer's prompt. He only shows himself while the heat is on, at the
 * phone booth by the PD and at Bruno's counter. At the counter his offer
 * yields twice: to Bruno himself while work is on the table (Bruno keeps
 * the E press), and to the meal while the player is hurt AND can pay for
 * it — healing is the urgent errand, but a man who cannot afford the
 * meal is not sent chasing a prompt that would eat his press, so a broke
 * and hurt player still gets the fixer judged on its own terms.
 */
export function fixerPrompt(game) {
  if (game.player.state !== 'foot' || game.stars <= 0) return null;
  const L = game.city.landmarks;
  const atBooth = Math.hypot(game.player.x - L.fixer.x, game.player.y - L.fixer.y) < 62;
  const atDiner = Math.hypot(game.player.x - L.diner.x, game.player.y - L.diner.y) < 64;
  if (!atBooth && !atDiner) return null;
  if (atDiner && game.bruno
    && Math.hypot(game.player.x - game.bruno.x, game.player.y - game.bruno.y) < 50
    && (missionAvailable(game) || jobAvailable(game))) return null;
  if (atDiner && game.player.hp < game.player.maxHp && game.money >= MEAL_PRICE) return null;
  return t('prompt.fixer', { cost: cash(game.stars * FIXER.perStar) });
}

/** The door prompt for the four counters. */
export function shopPrompt(game) {
  if (game.player.state !== 'foot') return null;
  const kind = counterHere(game);
  if (!kind) return null;
  if (kind === 'safehouse' && game.saveData.safehouse) {
    return game.player.hp < game.player.maxHp ? t('prompt.bed') : t('prompt.safehouse.owned');
  }
  return t(`prompt.${kind}`);
}

/** Spend an E press at a counter or the fixer; true when it was spent. */
export function economyInteract(game) {
  g = game;
  if (g.player.state !== 'foot') return false;
  if (fixerPrompt(g)) {
    openShop('fixer');
    return true;
  }
  const kind = counterHere(g);
  if (kind === 'safehouse' && g.saveData.safehouse) {
    // The owned safehouse's bed is the interaction; there is no tray.
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

/* ------------------------------------------------------------------ */
/* Car delivery — the C key / CALL button service.                     */
/* ------------------------------------------------------------------ */

const AVENUES = [280, 720, 1160, 1600, 2040, 2480, 2920];
const STREETS = [280, 720, 1160, 1600, 2040];

/**
 * The kerb a summoned car makes for: the nearest point of the road grid,
 * offset to the player's side of that road. Avenues are judged first, so
 * an exact tie keeps the avenue's answer.
 */
function kerbSpotFor(p) {
  let best = null;
  const consider = (dist, spot) => { if (!best || dist < best.dist) best = { dist, ...spot }; };
  for (const x of AVENUES) {
    const side = p.x >= x ? 1 : -1;
    consider(Math.abs(p.x - x), { x: x + side * 42, y: p.y, axis: 'y', sign: side });
  }
  for (const y of STREETS) {
    const side = p.y >= y ? 1 : -1;
    consider(Math.abs(p.y - y), { x: p.x, y: y + side * 42, axis: 'x', sign: side });
  }
  return best;
}

/**
 * Send the player's own car to him. The car that comes is the slot's own
 * car — it leaves the world wherever it stood and re-enters 620 units
 * out along the road, out of sight, then rolls to the kerb. Refusals
 * (nothing owned, one already close, stolen, wrecked, already coming)
 * each answer with their own banner and never charge or duplicate.
 */
export function callCar(game) {
  g = game;
  const owned = g.saveData.owned || [];
  if (owned.length === 0) {
    g.say(t('banner.call.title'), t('banner.call.none'), 2.8);
    g.sfx.tone('triangle', 180, 120, 0.1, 0.12);
    return;
  }
  const close = g.cars.find((c) => c.owned && !c.wrecked
    && Math.hypot(c.x - g.player.x, c.y - g.player.y) < 150);
  if (close) {
    g.say(t('banner.call.title'), t('banner.call.here'), 2.4);
    return;
  }
  let slot = -1;
  let refusal = null;
  for (let i = 0; i < owned.length; i += 1) {
    if (owned[i].stolen) {
      if (!refusal) refusal = 'stolen';
      continue;
    }
    const live = carOf(i);
    if (live?.wrecked) {
      refusal = 'wrecked';
      continue;
    }
    if (live?.summon) {
      if (!refusal) refusal = 'coming';
      continue;
    }
    slot = i;
    break;
  }
  if (slot < 0) {
    const key = refusal === 'wrecked' ? 'banner.call.wrecked'
      : refusal === 'coming' ? 'banner.call.coming' : 'banner.call.stolen';
    g.say(t('banner.call.title'), t(key), 3);
    return;
  }
  if (!spend(MOTORS.call)) return;
  const old = carOf(slot);
  if (old) removeCar(g, old);
  const p = g.player;
  const kerb = kerbSpotFor(p);
  const start = kerb.axis === 'y'
    ? { x: kerb.x, y: p.y - kerb.sign * 620 }
    : { x: p.x - kerb.sign * 620, y: kerb.y };
  const car = spawnCar(g, 'parked', start.x, start.y, kerb.axis === 'y' ? Math.PI / 2 : 0, MOTORS.paints[0]);
  car.touched = true;
  car.slot = slot;
  applyCarSpec(car, owned[slot]);
  car.summon = { x: kerb.x, y: kerb.y };
  g.say(t('banner.call.title'), t('banner.call.sub'), 3);
  g.persist?.();
  // A delivery is a service, not a purchase: its result happens out in
  // the world, which stays frozen behind an open tray — so a successful
  // call made from the desk closes the tray behind it. From the C key no
  // tray is open and closeShop() simply does nothing. Every refusal
  // above returned early, keeping the tray open at the desk.
  closeShop();
}

/**
 * Roll summoned cars to their kerbs. A parked-kind car has no other
 * per-frame mesh sync (traffic syncs its own kind, the driver syncs the
 * driven car), so every frame a summon moves, its mesh is synced here —
 * and once more on the arrival frame, so the visible car ends exactly
 * where the logical car stopped, facing the way it arrived.
 */
function advanceSummons(dt) {
  for (const car of g.cars) {
    if (!car.summon) continue;
    const dx = car.summon.x - car.x;
    const dy = car.summon.y - car.y;
    const dist = Math.hypot(dx, dy);
    // Closing progress is remembered: if the remaining gap has not
    // shrunk by more than 2 for a beat and a half, the car is wedged at
    // a stand-off (a kerbside car, a corner) and counts as arrived — it
    // is at the kerb, which is what was asked for.
    if (car.summonBest === undefined || dist < car.summonBest - 2) {
      car.summonBest = dist;
      car.summonStall = 0;
    } else {
      car.summonStall = (car.summonStall ?? 0) + dt;
    }
    if (dist < 30 || car.summonStall > 1.2) {
      car.summon = null;
      car.summonBest = undefined;
      car.summonStall = 0;
      car.speed = 0;
      syncCarMesh(car, 0);
      continue;
    }
    const step = Math.min(dist, 300 * dt);
    car.x += (dx / dist) * step;
    car.y += (dy / dist) * step;
    car.angle = Math.atan2(dy, dx);
    car.speed = 300;
    syncCarMesh(car, dt);
  }
}

/* ------------------------------------------------------------------ */
/* Theft and recovery.                                                 */
/* ------------------------------------------------------------------ */

/** Remove a car from the world by hand: mesh out, list entry out. */
function detachCar(car) {
  car.mesh.parent?.remove(car.mesh);
  const i = g.cars.indexOf(car);
  if (i >= 0) g.cars.splice(i, 1);
}

let pinsDirty = true;

/** Flag an owned car stolen where it stands and drop its map pin. */
function markStolen(car) {
  const spec = g.saveData.owned?.[car.slot];
  if (!spec || spec.stolen) return;
  spec.stolen = true;
  spec.stolenX = car.x;
  spec.stolenY = car.y;
  pinsDirty = true;
  detachCar(car);
  g.say(t('banner.stolen.title'), t('banner.stolen.sub'), 3.4);
  g.sfx.alarm();
  g.persist?.();
}

/**
 * Bring a stolen car back. Paid (the Motors desk): the car reappears by
 * the player and the tray closes — it is a service, not a purchase.
 * Free (walking to the pin): the car reappears where it was dumped and
 * no tray is involved.
 */
function recoverStolen(paid, want = -1) {
  const owned = g.saveData.owned || [];
  const idx = want >= 0 ? want : owned.findIndex((s) => s.stolen);
  if (idx < 0 || !owned[idx]?.stolen) return;
  const spec = owned[idx];
  if (paid && !spend(MOTORS.recover)) return;
  const x = paid || spec.stolenX === null ? g.player.x + 70 : spec.stolenX;
  const y = paid || spec.stolenY === null ? g.player.y : spec.stolenY;
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
  if (paid) closeShop();
}

/**
 * Un-wreck an owned car where it sits, for the recovery price. The wreck
 * state clears and the mesh is stood back up at once: an owned wreck
 * never sinks, so the wreck system's sink-undo would never fire for it,
 * and without the sync the car would sit in its sunken, tilted wreck
 * pose — whole on paper, dead to look at — until driven or shoved. The
 * fire itself still goes out on the next wreck pass, as it always has.
 */
function recoverWrecked() {
  const slot = wreckedSlot();
  if (slot < 0) return;
  if (!spend(MOTORS.recover)) return;
  const car = carOf(slot);
  car.wrecked = false;
  car.hp = car.maxHp ?? 100;
  car.burnT = 0;
  car.speed = 0;
  syncCarMesh(car, 0);
  g.say(t('banner.recovered.title'), t('banner.recovered.sub'), 3);
  g.sfx.confirm();
  g.persist?.();
  renderShop();
  closeShop();
}

/** Rebuild the stolen-car pin list when the save has changed under it. */
function rebuildPins() {
  if (!pinsDirty) return;
  pinsDirty = false;
  const pins = [];
  for (const s of g.saveData.owned || []) {
    if (s.stolen && s.stolenX !== null) pins.push({ x: s.stolenX, y: s.stolenY });
  }
  g.stolenPins = pins;
}

/* ------------------------------------------------------------------ */
/* Bringing the fleet back after a load.                               */
/* ------------------------------------------------------------------ */

/**
 * Respawn every owned car. A car with a recorded last position comes
 * back where the player left it, heading included; a car without one
 * (never driven under a build that records positions — every car in an
 * older save) keeps the Motors-lot spawn it has always had. Stolen cars
 * stay out of the world; their pins are rebuilt instead.
 */
export function spawnOwnedCars(game) {
  g = game;
  const owned = g.saveData.owned || [];
  const lot = g.city.motorsLot || [];
  for (let i = 0; i < owned.length; i += 1) {
    const spec = owned[i];
    if (spec.stolen) continue;
    if (g.cars.some((c) => c.owned && c.slot === i)) continue;
    const hasPos = Number.isFinite(spec.posX) && Number.isFinite(spec.posY);
    const home = lot[i % Math.max(1, lot.length)] || { x: game.player.x + 80, y: game.player.y };
    const car = spawnCar(
      g, 'parked',
      hasPos ? spec.posX : home.x,
      hasPos ? spec.posY : home.y,
      hasPos && Number.isFinite(spec.posA) ? spec.posA : Math.PI / 2,
      MOTORS.paints[spec.paint],
    );
    car.touched = true;
    car.slot = i;
    applyCarSpec(car, spec);
  }
  rebuildPins();
}

/**
 * Respawn the last car the player stole: one ordinary stealable car of
 * the recorded colour, standing where he left it. It is `touched`, so
 * the fleet systems leave it alone like any car he has taken.
 */
export function spawnLastStolenCar(game) {
  g = game;
  const rec = g.saveData?.lastStolen;
  if (!rec || g.lastStolenCar) return;
  const car = spawnCar(g, 'parked', rec.x, rec.y, rec.angle, rec.color);
  car.touched = true;
  g.lastStolenCar = car;
}

/* ------------------------------------------------------------------ */
/* Lifecycle.                                                          */
/* ------------------------------------------------------------------ */

/** Gear is a pure stat patch on the hero; there are no new systems. */
function applyGearStats() {
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

/** Build the tray and apply the saved gear. Call once, hero in place. */
export function initEconomy(game) {
  g = game;
  buildTray();
  game.shopOpen = null;
  game.stolenPins = [];
  game.lastStolenCar = null;
  game.applyGear = applyGearStats;
  applyGearStats();
}

/**
 * The theft clock, walked backwards because a theft splices the list:
 * an owned car with nobody in it, whole and not rolling in, accrues
 * time alone beyond THEFT.range and is taken when it passes THEFT.after.
 */
function watchForTheft(dt) {
  for (let i = g.cars.length - 1; i >= 0; i -= 1) {
    const car = g.cars[i];
    if (!car.owned || car.occupant || car.wrecked || car.summon) continue;
    const d = Math.hypot(car.x - g.player.x, car.y - g.player.y);
    car.awayT = d > THEFT.range ? (car.awayT ?? 0) + dt : 0;
    if (car.awayT > THEFT.after) markStolen(car);
  }
}

/**
 * Each owned car's save record follows its live car — driven, parked,
 * even shoved by traffic — so a reload restores the spot it actually
 * rests at. Stolen cars are the theft flow's business, not this one's.
 */
function trackPositions(owned) {
  for (let i = 0; i < owned.length; i += 1) {
    const spec = owned[i];
    if (spec.stolen) continue;
    const car = carOf(i);
    if (!car) continue;
    spec.posX = car.x;
    spec.posY = car.y;
    spec.posA = car.angle;
  }
}

/**
 * The recorded stolen car, likewise: its record tracks the live car
 * while it stays in the world. A wreck, or a car somehow gone, ends the
 * record — a wreck is never resurrected.
 */
function trackLastStolen() {
  const car = g.lastStolenCar;
  if (!car) return;
  if (!g.cars.includes(car) || car.wrecked) {
    g.lastStolenCar = null;
    if (g.saveData.lastStolen) {
      g.saveData.lastStolen = null;
      g.persist?.();
    }
  } else if (g.saveData.lastStolen) {
    g.saveData.lastStolen.x = car.x;
    g.saveData.lastStolen.y = car.y;
    g.saveData.lastStolen.angle = car.angle;
  }
}

/** Standing at a stolen car's pin brings that car back, free. */
function pinWalkRecovery(owned) {
  for (let i = 0; i < owned.length; i += 1) {
    const spec = owned[i];
    if (!spec.stolen || spec.stolenX === null) continue;
    if (Math.hypot(g.player.x - spec.stolenX, g.player.y - spec.stolenY) < 56) {
      recoverStolen(false, i);
      break;
    }
  }
}

/** Per-frame economy: summons, theft, position records, pins. */
export function updateEconomy(game, dt) {
  g = game;
  if (!g.saveData || g.state !== 'play') return;
  advanceSummons(dt);
  watchForTheft(dt);
  const owned = g.saveData.owned || [];
  trackPositions(owned);
  trackLastStolen();
  pinWalkRecovery(owned);
  rebuildPins();
}

/** Progress reset: the bought cars leave the world with everything else. */
export function resetEconomy(game) {
  g = game;
  for (const car of [...g.cars]) {
    if (car.owned) detachCar(car);
  }
  g.lastStolenCar = null;
  g.stolenPins = [];
  pinsDirty = true;
  g.shopOpen = null;
  if (trayEl.root) trayEl.root.classList.remove('show');
}

/** Whether the touch CALL button has anything to call. */
export function canCallCar(game) {
  return (game.saveData.owned || []).length > 0;
}
