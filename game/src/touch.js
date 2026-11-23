// touch.js — phone controls: a floating stick and a button cluster.
//
// Nothing here has its own input vocabulary. Buttons write the same key
// codes the keyboard writes (KeyE, KeyF, KeyK, Space, KeyP, Enter,
// ShiftLeft) into input.js's shared sets, and the stick writes
// input.stick, so gameplay code cannot tell which device is driving.
// On desktop this module is never initialised and nothing changes.
import { PROMPT_PREFIX, t } from './i18n.js';

/**
 * Phone mode applies when the device can be touched AND its smaller
 * screen edge is phone-sized. `force` (the ?mobile=1 flag) turns the
 * mode on anywhere, for testing on a desktop.
 */
export function detectMobile(force) {
  if (force) return true;
  const touchable = (navigator.maxTouchPoints ?? 0) > 0 || 'ontouchstart' in window;
  return touchable && Math.min(window.innerWidth, window.innerHeight) <= 560;
}

const KNOB_RANGE = 46; // px the stick knob may travel from its origin
const byId = (id) => document.getElementById(id);

/**
 * Connect the touch DOM declared in index.html to g.input. Returns the
 * pair main.js uses: update() once per frame (labels and visibility
 * follow game state) and relabel() on a language change.
 */
export function initTouch(g) {
  document.body.classList.add('mobile');
  const input = g.input;
  const dom = {
    zone: byId('stickZone'), base: byId('stickBase'), knob: byId('stickKnob'),
    btns: byId('btns'), pause: byId('btnPause'), tap: byId('tapBtn'),
    use: byId('btnUse'), punch: byId('btnPunch'), shoot: byId('btnShoot'),
    sprint: byId('btnSprint'), dash: byId('btnDash'), call: byId('btnCall'),
  };

  /* ---- Stick: the origin is wherever the left thumb lands; the knob
   * reports a normalised push of at most 1 in any direction. */
  const stick = { id: null, ox: 0, oy: 0 };
  const placeKnob = (dx, dy) => {
    dom.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  };
  const reportStick = (touch) => {
    let dx = touch.clientX - stick.ox;
    let dy = touch.clientY - stick.oy;
    const len = Math.hypot(dx, dy);
    if (len > KNOB_RANGE) {
      dx = (dx / len) * KNOB_RANGE;
      dy = (dy / len) * KNOB_RANGE;
    }
    placeKnob(dx, dy);
    input.stick.x = dx / KNOB_RANGE;
    input.stick.y = dy / KNOB_RANGE;
    input.stick.active = true;
  };
  const releaseStick = () => {
    stick.id = null;
    input.stick.x = 0;
    input.stick.y = 0;
    input.stick.active = false;
    dom.base.style.display = 'none';
  };
  dom.zone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (stick.id !== null) return;
    const touch = e.changedTouches[0];
    stick.id = touch.identifier;
    stick.ox = touch.clientX;
    stick.oy = touch.clientY;
    dom.base.style.left = `${stick.ox}px`;
    dom.base.style.top = `${stick.oy}px`;
    dom.base.style.display = 'block';
    placeKnob(0, 0);
    reportStick(touch);
  }, { passive: false });
  dom.zone.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const touch of e.changedTouches) if (touch.identifier === stick.id) reportStick(touch);
  }, { passive: false });
  dom.zone.addEventListener('touchend', (e) => {
    for (const touch of e.changedTouches) if (touch.identifier === stick.id) releaseStick();
  });
  dom.zone.addEventListener('touchcancel', () => releaseStick());

  /* ---- Buttons: a hold keeps its code written while the thumb is down;
   * a tap writes a press and a release inside the single gesture. */
  const bindHold = (node, code) => {
    node.addEventListener('touchstart', (e) => {
      e.preventDefault();
      input.pressButton(code);
      node.classList.add('on');
    }, { passive: false });
    const release = (e) => {
      e.preventDefault();
      input.releaseButton(code);
      node.classList.remove('on');
    };
    node.addEventListener('touchend', release, { passive: false });
    node.addEventListener('touchcancel', release, { passive: false });
  };
  const bindTap = (node, code, withClick) => {
    const tap = () => {
      input.pressButton(code);
      input.releaseButton(code);
    };
    node.addEventListener('touchstart', (e) => {
      e.preventDefault();
      tap();
    }, { passive: false });
    if (withClick) node.addEventListener('click', tap);
    return tap;
  };
  bindHold(dom.use, 'KeyE');
  bindHold(dom.punch, 'KeyF');
  bindHold(dom.shoot, 'KeyK');
  bindHold(dom.dash, 'Space'); // dash and handbrake share the Space code
  bindTap(dom.call, 'KeyC', true); // the same KeyC the keyboard summons with
  bindTap(dom.pause, 'KeyP', true);

  // Sprint latches: one tap on, one tap off — one thumb fewer to hold.
  let sprintOn = false;
  dom.sprint.addEventListener('touchstart', (e) => {
    e.preventDefault();
    sprintOn = !sprintOn;
    if (sprintOn) input.pressButton('ShiftLeft');
    else input.releaseButton('ShiftLeft');
    dom.sprint.classList.toggle('on', sprintOn);
  }, { passive: false });

  /* ---- Camera orbit: dragging on the bare canvas (covered by neither
   * the stick zone nor the buttons) feeds input.orbit, the accumulator
   * the desktop mouse drag feeds. Pinch zoom is deliberately absent:
   * with the other touches spoken for, a two-finger gesture on the free
   * area alone fired by accident too easily. */
  const orbit = { id: null, x: 0, y: 0 };
  const canvas = byId('game');
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault(); // also swallows the synthetic mouse events (they would fire the pistol)
    if (orbit.id !== null) return;
    const touch = e.changedTouches[0];
    orbit.id = touch.identifier;
    orbit.x = touch.clientX;
    orbit.y = touch.clientY;
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const touch of e.changedTouches) {
      if (touch.identifier !== orbit.id) continue;
      input.orbit.dx += touch.clientX - orbit.x;
      input.orbit.dy += touch.clientY - orbit.y;
      orbit.x = touch.clientX;
      orbit.y = touch.clientY;
    }
  }, { passive: false });
  const endOrbit = (e) => {
    for (const touch of e.changedTouches) if (touch.identifier === orbit.id) orbit.id = null;
  };
  canvas.addEventListener('touchend', endOrbit);
  canvas.addEventListener('touchcancel', endOrbit);

  /* ---- The big state button: start, continue after a bust or a
   * wasting, resume from pause. Clicks count too, for ?mobile=1. */
  bindTap(dom.tap, 'Enter', true);

  // The page itself must never scroll, zoom or rubber-band under the game.
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });

  /* ---- Labels and visibility, refreshed against the game state.
   * `shown` remembers what the DOM currently displays so a frame only
   * writes what actually changed. */
  const shown = { state: '', prompt: null, pistol: null, lang: null };

  function relabel() {
    dom.punch.textContent = t('touch.punch');
    dom.shoot.textContent = t('touch.shoot');
    dom.sprint.textContent = t('touch.sprint');
    dom.dash.textContent = t('touch.dash');
    dom.call.textContent = t('touch.call');
    shown.state = '';    // force update() to re-derive the state button
    shown.prompt = null; // ... and the USE button
  }

  function chromeFor(state) {
    const inRun = state === 'play' || state === 'paused';
    dom.zone.style.display = state === 'play' ? 'block' : 'none';
    dom.btns.style.display = inRun ? 'block' : 'none';
    dom.pause.style.display = inRun ? 'block' : 'none';
    dom.tap.style.display = state === 'play' ? 'none' : 'block';
    dom.tap.textContent = state === 'title' ? t('touch.tapStart')
      : state === 'paused' ? t('touch.resume') : t('touch.tapContinue');
    if (state !== 'play' && stick.id !== null) releaseStick();
  }

  function update() {
    const state = g.state;
    if (state !== shown.state) {
      shown.state = state;
      chromeFor(state);
    }
    // USE wears the live prompt: "E — Talk to Bruno" becomes "TALK TO
    // BRUNO". The "E — " key-cap prefix is identical in both languages
    // (see i18n.js), so stripping it and upper-casing the rest works for
    // Japanese prompts unchanged.
    const prompt = g.prompt ?? '';
    if (prompt !== shown.prompt) {
      shown.prompt = prompt;
      dom.use.textContent = prompt.startsWith(PROMPT_PREFIX)
        ? prompt.slice(PROMPT_PREFIX.length).toUpperCase()
        : t('touch.use');
      dom.use.classList.toggle('on', prompt.length > 0);
    }
    const shootVisible = g.player.hasPistol && state === 'play' && g.player.state === 'foot';
    if (shootVisible !== shown.pistol) {
      shown.pistol = shootVisible;
      dom.shoot.style.display = shootVisible ? 'flex' : 'none';
    }
    // Dash lives on foot; in a car the same Space-writing button is the
    // handbrake, so it stays up with its label switched, and on foot it
    // dims while the dash cools down. CALL appears only once a car is
    // owned, and only in play.
    const onFoot = state === 'play' && g.player.state === 'foot';
    const driving = state === 'play' && g.player.state === 'car' && !!g.player.car;
    dom.call.style.display = state === 'play' && (g.saveData.owned ?? []).length > 0 ? 'flex' : 'none';
    dom.dash.style.display = onFoot || driving ? 'flex' : 'none';
    dom.dash.classList.toggle('cool', onFoot && (g.player.dashCd ?? 0) > 0);
    const dashLabel = t(driving ? 'touch.brake' : 'touch.dash');
    if (dom.dash.textContent !== dashLabel) dom.dash.textContent = dashLabel;
    // A language switch re-labels the static buttons once. (main.js also
    // calls relabel() itself; this keeps update() self-sufficient.)
    if (g.lang !== shown.lang) {
      shown.lang = g.lang;
      relabel();
    }
  }

  relabel();
  update();
  return { update, relabel };
}
