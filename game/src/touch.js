// Smartphone mode: a virtual joystick and thumb buttons for touch devices.
// Everything here feeds the one input layer in input.js — buttons write the
// same key codes the keyboard uses (KeyE, KeyF, KeyK, ShiftLeft, KeyP,
// Enter) and the joystick writes input.stick — so no gameplay code knows or
// cares which device is driving. Desktop (no touch, or a large screen)
// never initialises this module and behaves exactly as before.
import { PROMPT_PREFIX, t } from './i18n.js';

/**
 * True when this looks like a phone: touch support and a small screen.
 * `force` (the ?mobile=1 query flag) turns the mode on anywhere, for
 * testing.
 */
export function detectMobile(force) {
  if (force) return true;
  const touchCapable = (navigator.maxTouchPoints ?? 0) > 0 || 'ontouchstart' in window;
  if (!touchCapable) return false;
  return Math.min(window.innerWidth, window.innerHeight) <= 560;
}

const STICK_RADIUS = 46;
const byId = (id) => document.getElementById(id);

/**
 * Wire the touch DOM (in index.html) into g.input. Returns { update,
 * relabel } — main.js calls update() once per frame to refresh labels and
 * visibility, and relabel() when the language changes.
 */
export function initTouch(g) {
  document.body.classList.add('mobile');
  const input = g.input;
  const els = {
    zone: byId('stickZone'),
    base: byId('stickBase'),
    knob: byId('stickKnob'),
    btns: byId('btns'),
    pause: byId('btnPause'),
    tap: byId('tapBtn'),
    use: byId('btnUse'),
    punch: byId('btnPunch'),
    shoot: byId('btnShoot'),
    sprint: byId('btnSprint'),
    dash: byId('btnDash'),
    call: byId('btnCall'),
  };

  /* ---- Virtual joystick: dynamic origin wherever the left thumb lands. */
  const stick = { id: null, ox: 0, oy: 0 };
  const placeKnob = (dx, dy) => {
    els.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  };
  const stickTo = (touch) => {
    let dx = touch.clientX - stick.ox;
    let dy = touch.clientY - stick.oy;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx = (dx / len) * STICK_RADIUS;
      dy = (dy / len) * STICK_RADIUS;
    }
    placeKnob(dx, dy);
    input.stick.x = dx / STICK_RADIUS;
    input.stick.y = dy / STICK_RADIUS;
    input.stick.active = true;
  };
  const stickRelease = () => {
    stick.id = null;
    input.stick.x = 0;
    input.stick.y = 0;
    input.stick.active = false;
    els.base.style.display = 'none';
  };
  els.zone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (stick.id !== null) return;
    const touch = e.changedTouches[0];
    stick.id = touch.identifier;
    stick.ox = touch.clientX;
    stick.oy = touch.clientY;
    els.base.style.left = `${stick.ox}px`;
    els.base.style.top = `${stick.oy}px`;
    els.base.style.display = 'block';
    placeKnob(0, 0);
    stickTo(touch);
  }, { passive: false });
  els.zone.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const touch of e.changedTouches) if (touch.identifier === stick.id) stickTo(touch);
  }, { passive: false });
  els.zone.addEventListener('touchend', (e) => {
    for (const touch of e.changedTouches) if (touch.identifier === stick.id) stickRelease();
  });
  els.zone.addEventListener('touchcancel', () => stickRelease());

  /* ---- Buttons: hold-style writes into the shared key sets. */
  const bindHold = (el, code) => {
    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      input.pressButton(code);
      el.classList.add('on');
    }, { passive: false });
    const release = (e) => {
      e.preventDefault();
      input.releaseButton(code);
      el.classList.remove('on');
    };
    el.addEventListener('touchend', release, { passive: false });
    el.addEventListener('touchcancel', release, { passive: false });
  };
  /** A tap: press and release in one gesture (and on a plain click). */
  const bindTap = (el, code, alsoClick) => {
    const tap = () => {
      input.pressButton(code);
      input.releaseButton(code);
    };
    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      tap();
    }, { passive: false });
    if (alsoClick) el.addEventListener('click', tap);
    return tap;
  };
  bindHold(els.use, 'KeyE');
  bindHold(els.punch, 'KeyF');
  bindHold(els.shoot, 'KeyK');
  // Dash rides the Space code, exactly like the desktop key.
  bindHold(els.dash, 'Space');
  // CALL is a tap: the same KeyC the keyboard uses to summon your own car.
  bindTap(els.call, 'KeyC', true);
  // Pause is a tap, not a hold.
  bindTap(els.pause, 'KeyP', true);
  // Sprint toggles: one less thumb to keep busy while steering.
  let sprintOn = false;
  els.sprint.addEventListener('touchstart', (e) => {
    e.preventDefault();
    sprintOn = !sprintOn;
    if (sprintOn) input.pressButton('ShiftLeft');
    else input.releaseButton('ShiftLeft');
    els.sprint.classList.toggle('on', sprintOn);
  }, { passive: false });

  /* ---- Camera orbit: a drag that lands on the bare canvas — the free
   * area covered by neither the stick zone nor the buttons — swings the
   * camera. Deltas go into the shared input.orbit the desktop mouse drag
   * also feeds. (Pinch zoom is deliberately not implemented: with the
   * stick and buttons holding the other touches, a two-finger gesture on
   * the free area alone proved too easy to trigger by accident.) */
  const orbit = { id: null, x: 0, y: 0 };
  const canvas = byId('game');
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault(); // also stops the synthetic mouse events (would fire the pistol)
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
  const orbitRelease = (e) => {
    for (const touch of e.changedTouches) if (touch.identifier === orbit.id) orbit.id = null;
  };
  canvas.addEventListener('touchend', orbitRelease);
  canvas.addEventListener('touchcancel', orbitRelease);

  /* ---- The big state button: start, continue after busted/wasted, resume.
   * Mouse fallback too (desktop with ?mobile=1): plain clicks work. */
  bindTap(els.tap, 'Enter', true);

  // Keep the page itself from scrolling, zooming or rubber-banding.
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });

  const seen = { state: '', prompt: null, pistol: null, lang: null };
  /** (Re)label every button in the current language. */
  function relabel() {
    els.punch.textContent = t('touch.punch');
    els.shoot.textContent = t('touch.shoot');
    els.sprint.textContent = t('touch.sprint');
    els.dash.textContent = t('touch.dash');
    els.call.textContent = t('touch.call');
    seen.state = ''; // force update() to re-derive the state button's label
    seen.prompt = null; // and the USE button's
  }

  function refreshChrome(state) {
    const inRun = state === 'play' || state === 'paused';
    els.zone.style.display = state === 'play' ? 'block' : 'none';
    els.btns.style.display = inRun ? 'block' : 'none';
    els.pause.style.display = inRun ? 'block' : 'none';
    els.tap.style.display = state === 'play' ? 'none' : 'block';
    els.tap.textContent = state === 'title' ? t('touch.tapStart')
      : state === 'paused' ? t('touch.resume') : t('touch.tapContinue');
    if (state !== 'play' && stick.id !== null) stickRelease();
  }

  function update() {
    const state = g.state;
    if (state !== seen.state) {
      seen.state = state;
      refreshChrome(state);
    }
    // The USE button wears the current prompt ("E — Talk to Bruno" → that).
    // The "E — " key-cap prefix is the same in both languages (i18n.js), so
    // the derivation — strip the prefix, shout what is left — works
    // unchanged for Japanese prompts.
    const prompt = g.prompt ?? '';
    if (prompt !== seen.prompt) {
      seen.prompt = prompt;
      els.use.textContent = prompt.startsWith(PROMPT_PREFIX)
        ? prompt.slice(PROMPT_PREFIX.length).toUpperCase()
        : t('touch.use');
      els.use.classList.toggle('on', prompt.length > 0);
    }
    const pistol = g.player.hasPistol && state === 'play' && g.player.state === 'foot';
    if (pistol !== seen.pistol) {
      seen.pistol = pistol;
      els.shoot.style.display = pistol ? 'flex' : 'none';
    }
    // Dash lives on foot only; in a car the same button is the handbrake
    // (both write Space), so it stays up with its label switched. It dims
    // while the on-foot dash cools down. CALL only means something once
    // you own a car, and only in play.
    const onFoot = state === 'play' && g.player.state === 'foot';
    const driving = state === 'play' && g.player.state === 'car' && !!g.player.car;
    els.call.style.display = state === 'play' && (g.saveData.owned ?? []).length > 0 ? 'flex' : 'none';
    els.dash.style.display = onFoot || driving ? 'flex' : 'none';
    els.dash.classList.toggle('cool', onFoot && (g.player.dashCd ?? 0) > 0);
    const dashLabel = t(driving ? 'touch.brake' : 'touch.dash');
    if (els.dash.textContent !== dashLabel) els.dash.textContent = dashLabel;
    // A language switch re-labels the static buttons once (main.js also
    // calls relabel() directly; this keeps update() self-sufficient).
    if (g.lang !== seen.lang) {
      seen.lang = g.lang;
      relabel();
    }
  }
  relabel();
  update();
  return { update, relabel };
}
