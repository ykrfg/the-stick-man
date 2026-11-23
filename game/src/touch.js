// Touch controls for phones.
//
// A floating joystick under the left thumb and a cluster of buttons under
// the right one. Nothing in here invents its own input vocabulary: buttons
// write the very key codes the keyboard writes (KeyE, KeyF, KeyK, Space,
// KeyP, Enter, ShiftLeft) into input.js's shared sets, and the joystick
// writes input.stick, so the gameplay code cannot tell — and never has to
// care — which device is driving. On a desktop this module is never
// initialised and nothing about the game changes.
import { PROMPT_PREFIX, t } from './i18n.js';

/**
 * Whether this device should run in phone mode: it can be touched AND its
 * smaller screen edge is phone-sized. `force` (the ?mobile=1 flag) turns
 * the mode on anywhere, for testing on a desktop.
 */
export function detectMobile(force) {
  if (force) return true;
  const canTouch = (navigator.maxTouchPoints ?? 0) > 0 || 'ontouchstart' in window;
  return canTouch && Math.min(window.innerWidth, window.innerHeight) <= 560;
}

const STICK_TRAVEL = 46; // px the knob may wander from its origin
const el = (id) => document.getElementById(id);

/**
 * Wire the touch DOM declared in index.html into g.input. The returned
 * pair is main.js's whole interface: update() once a frame (labels and
 * visibility follow the game state) and relabel() on a language change.
 */
export function initTouch(g) {
  document.body.classList.add('mobile');
  const input = g.input;
  const ui = {
    zone: el('stickZone'), base: el('stickBase'), knob: el('stickKnob'),
    btns: el('btns'), pause: el('btnPause'), tap: el('tapBtn'),
    use: el('btnUse'), punch: el('btnPunch'), shoot: el('btnShoot'),
    sprint: el('btnSprint'), dash: el('btnDash'), call: el('btnCall'),
  };

  /* ---- The joystick: its origin is wherever the left thumb comes down,
   * and the knob reports a normalised push of at most one in any direction. */
  const stick = { touchId: null, originX: 0, originY: 0 };
  const moveKnob = (dx, dy) => {
    ui.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  };
  const pushStick = (touch) => {
    let dx = touch.clientX - stick.originX;
    let dy = touch.clientY - stick.originY;
    const len = Math.hypot(dx, dy);
    if (len > STICK_TRAVEL) {
      dx = (dx / len) * STICK_TRAVEL;
      dy = (dy / len) * STICK_TRAVEL;
    }
    moveKnob(dx, dy);
    input.stick.x = dx / STICK_TRAVEL;
    input.stick.y = dy / STICK_TRAVEL;
    input.stick.active = true;
  };
  const letGoStick = () => {
    stick.touchId = null;
    input.stick.x = 0;
    input.stick.y = 0;
    input.stick.active = false;
    ui.base.style.display = 'none';
  };
  ui.zone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (stick.touchId !== null) return;
    const touch = e.changedTouches[0];
    stick.touchId = touch.identifier;
    stick.originX = touch.clientX;
    stick.originY = touch.clientY;
    ui.base.style.left = `${stick.originX}px`;
    ui.base.style.top = `${stick.originY}px`;
    ui.base.style.display = 'block';
    moveKnob(0, 0);
    pushStick(touch);
  }, { passive: false });
  ui.zone.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const touch of e.changedTouches) if (touch.identifier === stick.touchId) pushStick(touch);
  }, { passive: false });
  ui.zone.addEventListener('touchend', (e) => {
    for (const touch of e.changedTouches) if (touch.identifier === stick.touchId) letGoStick();
  });
  ui.zone.addEventListener('touchcancel', () => letGoStick());

  /* ---- Buttons. A hold writes its code for as long as the thumb is down;
   * a tap writes a press and a release inside the one gesture. */
  const holdButton = (node, code) => {
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
  const tapButton = (node, code, withClick) => {
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
  holdButton(ui.use, 'KeyE');
  holdButton(ui.punch, 'KeyF');
  holdButton(ui.shoot, 'KeyK');
  holdButton(ui.dash, 'Space'); // dash and handbrake share the Space code
  tapButton(ui.call, 'KeyC', true); // the same KeyC the keyboard summons with
  tapButton(ui.pause, 'KeyP', true);

  // Sprint is a toggle, not a hold: one thumb fewer to keep busy steering.
  let sprintLatched = false;
  ui.sprint.addEventListener('touchstart', (e) => {
    e.preventDefault();
    sprintLatched = !sprintLatched;
    if (sprintLatched) input.pressButton('ShiftLeft');
    else input.releaseButton('ShiftLeft');
    ui.sprint.classList.toggle('on', sprintLatched);
  }, { passive: false });

  /* ---- Camera orbit: a drag across the bare canvas — the ground covered
   * by neither the stick zone nor the buttons — feeds input.orbit, the
   * same accumulator the desktop mouse drag feeds. Pinch zoom is left out
   * on purpose: with the other touches spoken for, a two-finger gesture
   * on the free area alone fired by accident too easily. */
  const drag = { touchId: null, x: 0, y: 0 };
  const canvas = el('game');
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault(); // also swallows the synthetic mouse events (they would fire the pistol)
    if (drag.touchId !== null) return;
    const touch = e.changedTouches[0];
    drag.touchId = touch.identifier;
    drag.x = touch.clientX;
    drag.y = touch.clientY;
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const touch of e.changedTouches) {
      if (touch.identifier !== drag.touchId) continue;
      input.orbit.dx += touch.clientX - drag.x;
      input.orbit.dy += touch.clientY - drag.y;
      drag.x = touch.clientX;
      drag.y = touch.clientY;
    }
  }, { passive: false });
  const endDrag = (e) => {
    for (const touch of e.changedTouches) if (touch.identifier === drag.touchId) drag.touchId = null;
  };
  canvas.addEventListener('touchend', endDrag);
  canvas.addEventListener('touchcancel', endDrag);

  /* ---- The big state button: start the game, continue after a bust or a
   * wasting, resume from pause. Clicks count too, for ?mobile=1 desktops. */
  tapButton(ui.tap, 'Enter', true);

  // The page itself must never scroll, zoom or rubber-band under the game.
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });

  /* ---- Labels and visibility, refreshed against the game state. `seen`
   * remembers what the DOM currently shows so a frame only writes what
   * actually changed. */
  const seen = { state: '', prompt: null, pistol: null, lang: null };

  function relabel() {
    ui.punch.textContent = t('touch.punch');
    ui.shoot.textContent = t('touch.shoot');
    ui.sprint.textContent = t('touch.sprint');
    ui.dash.textContent = t('touch.dash');
    ui.call.textContent = t('touch.call');
    seen.state = '';    // make update() re-derive the state button's label
    seen.prompt = null; // ... and the USE button's
  }

  function showChromeFor(state) {
    const inRun = state === 'play' || state === 'paused';
    ui.zone.style.display = state === 'play' ? 'block' : 'none';
    ui.btns.style.display = inRun ? 'block' : 'none';
    ui.pause.style.display = inRun ? 'block' : 'none';
    ui.tap.style.display = state === 'play' ? 'none' : 'block';
    ui.tap.textContent = state === 'title' ? t('touch.tapStart')
      : state === 'paused' ? t('touch.resume') : t('touch.tapContinue');
    if (state !== 'play' && stick.touchId !== null) letGoStick();
  }

  function update() {
    const state = g.state;
    if (state !== seen.state) {
      seen.state = state;
      showChromeFor(state);
    }
    // USE wears the live prompt: "E — Talk to Bruno" becomes "TALK TO
    // BRUNO". The "E — " key-cap prefix is identical in both languages
    // (see i18n.js), so stripping it and shouting the rest works for
    // Japanese prompts unchanged.
    const prompt = g.prompt ?? '';
    if (prompt !== seen.prompt) {
      seen.prompt = prompt;
      ui.use.textContent = prompt.startsWith(PROMPT_PREFIX)
        ? prompt.slice(PROMPT_PREFIX.length).toUpperCase()
        : t('touch.use');
      ui.use.classList.toggle('on', prompt.length > 0);
    }
    const showShoot = g.player.hasPistol && state === 'play' && g.player.state === 'foot';
    if (showShoot !== seen.pistol) {
      seen.pistol = showShoot;
      ui.shoot.style.display = showShoot ? 'flex' : 'none';
    }
    // Dash lives on foot; in a car the same Space-writing button is the
    // handbrake, so it stays up with its label switched, and on foot it
    // dims while the dash cools down. CALL appears only once a car is
    // owned, and only in play.
    const onFoot = state === 'play' && g.player.state === 'foot';
    const driving = state === 'play' && g.player.state === 'car' && !!g.player.car;
    ui.call.style.display = state === 'play' && (g.saveData.owned ?? []).length > 0 ? 'flex' : 'none';
    ui.dash.style.display = onFoot || driving ? 'flex' : 'none';
    ui.dash.classList.toggle('cool', onFoot && (g.player.dashCd ?? 0) > 0);
    const dashText = t(driving ? 'touch.brake' : 'touch.dash');
    if (ui.dash.textContent !== dashText) ui.dash.textContent = dashText;
    // A language switch re-labels the static buttons once. (main.js also
    // calls relabel() itself; this keeps update() self-sufficient.)
    if (g.lang !== seen.lang) {
      seen.lang = g.lang;
      relabel();
    }
  }

  relabel();
  update();
  return { update, relabel };
}
