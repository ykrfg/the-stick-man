// Smartphone mode: a virtual joystick and thumb buttons for touch devices.
// Everything here feeds the one input layer in input.js — buttons write the
// same key codes the keyboard uses (KeyE, KeyF, KeyK, ShiftLeft, KeyP, Enter)
// and the joystick writes input.stick — so no gameplay code knows or cares
// which device is driving. Desktop (no touch, or a large screen) never
// initialises this module and behaves exactly as before.

/**
 * True when this looks like a phone: touch support and a small screen.
 * `force` (the ?mobile=1 query flag) turns the mode on anywhere, for testing.
 */
export function detectMobile(force) {
  if (force) return true;
  const touch = (navigator.maxTouchPoints ?? 0) > 0 || 'ontouchstart' in window;
  if (!touch) return false;
  return Math.min(window.innerWidth, window.innerHeight) <= 560;
}

const STICK_RADIUS = 46;

/**
 * Wire the touch DOM (in index.html) into g.input. Returns { update } —
 * main.js calls update() once per frame to refresh labels and visibility.
 */
export function initTouch(g) {
  document.body.classList.add('mobile');
  const input = g.input;
  const $ = (id) => document.getElementById(id);
  const zone = $('stickZone');
  const base = $('stickBase');
  const knob = $('stickKnob');
  const btns = $('btns');
  const btnPause = $('btnPause');
  const tapBtn = $('tapBtn');
  const btnUse = $('btnUse');
  const btnShoot = $('btnShoot');
  const btnSprint = $('btnSprint');

  // --- Virtual joystick: dynamic origin wherever the left thumb lands. ---
  let stickId = null;
  let originX = 0;
  let originY = 0;
  const setKnob = (dx, dy) => {
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  };
  const stickMove = (t) => {
    let dx = t.clientX - originX;
    let dy = t.clientY - originY;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx = (dx / len) * STICK_RADIUS;
      dy = (dy / len) * STICK_RADIUS;
    }
    setKnob(dx, dy);
    input.stick.x = dx / STICK_RADIUS;
    input.stick.y = dy / STICK_RADIUS;
    input.stick.active = true;
  };
  const stickEnd = () => {
    stickId = null;
    input.stick.x = 0;
    input.stick.y = 0;
    input.stick.active = false;
    base.style.display = 'none';
  };
  zone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (stickId !== null) return;
    const t = e.changedTouches[0];
    stickId = t.identifier;
    originX = t.clientX;
    originY = t.clientY;
    base.style.left = `${originX}px`;
    base.style.top = `${originY}px`;
    base.style.display = 'block';
    setKnob(0, 0);
    stickMove(t);
  }, { passive: false });
  zone.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === stickId) stickMove(t);
  }, { passive: false });
  zone.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) if (t.identifier === stickId) stickEnd();
  });
  zone.addEventListener('touchcancel', () => stickEnd());

  // --- Buttons: hold-style writes into the shared key sets. ---
  const hold = (el, code) => {
    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      input.pressButton(code);
      el.classList.add('on');
    }, { passive: false });
    const off = (e) => {
      e.preventDefault();
      input.releaseButton(code);
      el.classList.remove('on');
    };
    el.addEventListener('touchend', off, { passive: false });
    el.addEventListener('touchcancel', off, { passive: false });
  };
  hold(btnUse, 'KeyE');
  hold($('btnPunch'), 'KeyF');
  hold(btnShoot, 'KeyK');
  // Pause is a tap, not a hold.
  btnPause.addEventListener('touchstart', (e) => {
    e.preventDefault();
    input.pressButton('KeyP');
    input.releaseButton('KeyP');
  }, { passive: false });
  // Sprint toggles: one less thumb to keep busy while steering.
  let sprintOn = false;
  btnSprint.addEventListener('touchstart', (e) => {
    e.preventDefault();
    sprintOn = !sprintOn;
    if (sprintOn) input.pressButton('ShiftLeft');
    else input.releaseButton('ShiftLeft');
    btnSprint.classList.toggle('on', sprintOn);
  }, { passive: false });

  // --- The big state button: start, continue after busted/wasted, resume. ---
  tapBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    input.pressButton('Enter');
    input.releaseButton('Enter');
  }, { passive: false });
  // Mouse fallback (desktop with ?mobile=1): plain clicks work too.
  const clickTap = (code) => () => {
    input.pressButton(code);
    input.releaseButton(code);
  };
  tapBtn.addEventListener('click', clickTap('Enter'));
  btnPause.addEventListener('click', clickTap('KeyP'));

  // Keep the page itself from scrolling, zooming or rubber-banding.
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });

  let lastState = '';
  let lastPrompt = null;
  let lastPistol = null;
  function update() {
    const state = g.state;
    const inRun = state === 'play' || state === 'paused';
    if (state !== lastState) {
      lastState = state;
      zone.style.display = state === 'play' ? 'block' : 'none';
      btns.style.display = inRun ? 'block' : 'none';
      btnPause.style.display = inRun ? 'block' : 'none';
      tapBtn.style.display = state === 'play' ? 'none' : 'block';
      tapBtn.textContent = state === 'title' ? 'TAP TO START'
        : state === 'paused' ? 'RESUME' : 'TAP TO CONTINUE';
      if (state !== 'play' && stickId !== null) stickEnd();
    }
    // The USE button wears the current prompt ("E — Talk to Bruno" → that).
    const prompt = g.prompt ?? '';
    if (prompt !== lastPrompt) {
      lastPrompt = prompt;
      btnUse.textContent = prompt.startsWith('E — ') ? prompt.slice(4).toUpperCase() : 'USE';
      btnUse.classList.toggle('on', prompt.length > 0);
    }
    const pistol = g.player.hasPistol && state === 'play' && g.player.state === 'foot';
    if (pistol !== lastPistol) {
      lastPistol = pistol;
      btnShoot.style.display = pistol ? 'flex' : 'none';
    }
  }
  update();
  return { update };
}
