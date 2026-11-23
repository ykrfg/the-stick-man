// audio-director.js — the music side of the game's sound.
//
// Four looping tracks (title, daytime roam, night, chase) live on their
// own bus and crossfade with the run's mood: menus, police heat, then the
// hour of the day. A missing track file means a quieter game, never an
// error. The two volume sliders sit on a small panel over the title and
// pause screens and persist under their own storage key, apart from the
// progress save, so a save reset never touches them. The M-key mute is
// session-only and belongs to SoundFX.
//
// Browsers hold all audio until the first gesture; nothing here sounds
// before then, and on mobile that gesture is the tap that starts play.
import { DAY_SECONDS } from './config.js';
import { t } from './i18n.js';

const STORAGE_KEY = 'the-stick-man-audio-v1';
const TRACKS = {
  title: 'audio/bgm_title.ogg',
  roam: 'audio/bgm_roam.ogg',
  night: 'audio/bgm_night.ogg',
  chase: 'audio/bgm_chase.ogg',
};

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Module state. The deck is the pair of elements mid-crossfade: `front`
// is the one rising toward the audience, `back` the one sinking away.
let game = null;
let musicLevel = 0.7;
let fxLevel = 1;
let gateOpen = false;
let moodWanted = null;
const deck = { front: null, back: null };
const trackCache = new Map();

/* ------------------------------------------------------------ persistence */

function readLevels() {
  let saved = null;
  try {
    saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    /* unreadable storage: keep the defaults */
  }
  if (saved && Number.isFinite(saved.bgm)) musicLevel = clamp01(saved.bgm);
  if (saved && Number.isFinite(saved.se)) fxLevel = clamp01(saved.se);
}

function writeLevels() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ bgm: musicLevel, se: fxLevel }));
  } catch {
    /* storage refused: the levels simply do not persist */
  }
}

/* ------------------------------------------------------------------ deck */

function trackElement(name) {
  if (!trackCache.has(name)) {
    const el = new window.Audio(TRACKS[name]);
    el.dataset.name = name;
    el.loop = true;
    el.preload = 'auto';
    el.volume = 0;
    trackCache.set(name, el);
  }
  return trackCache.get(name);
}

function tryPlay(el) {
  el.play().catch(() => {});
}

/** Promote a track to the front; the old front steps back, still playing. */
function promote(name) {
  if (deck.front && deck.front.dataset.name === name) return;
  if (deck.back && deck.back !== deck.front) deck.back.pause();
  deck.back = deck.front;
  deck.front = trackElement(name);
  deck.front.volume = 0;
  if (gateOpen) tryPlay(deck.front);
}

/** Fade the back element out; pause and release it once it is silent. */
function fadeBack(step) {
  const el = deck.back;
  if (!el) return;
  el.volume = Math.max(0, el.volume - step * 0.9);
  if (el.volume <= 0.01) {
    el.pause();
    deck.back = null;
  }
}

/* ---------------------------------------------------------- volume panel */

const panel = { root: null, bgmIn: null, seIn: null, bgmCap: null, seCap: null, shown: null };

const PANEL_CSS = `
#smVol {
  position: fixed; right: 14px; top: calc(120px + env(safe-area-inset-top));
  display: none; flex-direction: column; gap: 7px; padding: 9px 12px; z-index: 30;
  background: rgba(14,18,30,0.9); border: 1px solid rgba(255,255,255,0.22);
  border-radius: 11px; color: #f4f1e6; font: 600 11px system-ui, sans-serif;
  letter-spacing: 1px;
}
#smVol.show { display: flex; }
#smVol label { display: flex; align-items: center; gap: 8px; }
#smVol input { width: 100px; accent-color: #ffd94d; }
`;

function buildPanel() {
  if (panel.root) return;
  if (!document.getElementById('smVolStyle')) {
    const style = document.createElement('style');
    style.id = 'smVolStyle';
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);
  }
  const root = document.createElement('div');
  root.id = 'smVol';
  const sliderRow = (captionId, inputId) => {
    const label = document.createElement('label');
    const caption = document.createElement('span');
    caption.id = captionId;
    const input = document.createElement('input');
    input.id = inputId;
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.step = '1';
    label.append(caption, input);
    return { label, caption, input };
  };
  const bgmRow = sliderRow('smVolBgmLabel', 'smVolBgm');
  const seRow = sliderRow('smVolSeLabel', 'smVolSe');
  root.append(bgmRow.label, seRow.label);
  document.body.appendChild(root);
  panel.root = root;
  panel.bgmIn = bgmRow.input;
  panel.seIn = seRow.input;
  panel.bgmCap = bgmRow.caption;
  panel.seCap = seRow.caption;
  panel.bgmIn.value = String(Math.round(musicLevel * 100));
  panel.seIn.value = String(Math.round(fxLevel * 100));
  panel.bgmIn.addEventListener('input', () => setBgmVolume(Number(panel.bgmIn.value) / 100));
  panel.seIn.addEventListener('input', () => {
    const v = Number(panel.seIn.value) / 100;
    if (game) setSeVolume(v, game);
    else setSeVolume(v);
  });
}

function setCaption(el, key) {
  const text = t(key);
  if (el.textContent !== text) el.textContent = text;
}

function reflectSlider(input, level) {
  if (document.activeElement !== input) input.value = String(Math.round(level * 100));
}

function syncPanel() {
  if (!panel.root || !game) return;
  const show = game.state === 'title' || game.state === 'paused';
  if (show !== panel.shown) {
    panel.shown = show;
    panel.root.classList.toggle('show', show);
  }
  if (!show) return;
  setCaption(panel.bgmCap, 'audio.bgm');
  setCaption(panel.seCap, 'audio.se');
  reflectSlider(panel.bgmIn, musicLevel);
  reflectSlider(panel.seIn, fxLevel);
}

/* ------------------------------------------------------------------- core */

/** Boot hook: read the saved levels, build the panel, arm the unlock gate. */
export function initAudio(g) {
  game = g;
  readLevels();
  g.sfx.setSeVolume(fxLevel);
  buildPanel();
  const openGate = () => {
    if (gateOpen) return;
    gateOpen = true;
    g.sfx.unlock();
    if (moodWanted && !deck.front) deck.front = trackElement(moodWanted);
    if (deck.front) tryPlay(deck.front);
  };
  window.addEventListener('pointerdown', openGate);
  window.addEventListener('keydown', openGate);
}

/** The track the moment asks for: menus first, then heat, then the hour. */
function pickMood(g) {
  if (g.state === 'title' || g.state === 'paused') return 'title';
  if (g.stars >= 2) return 'chase';
  const clock = typeof g.clock === 'number' ? g.clock : DAY_SECONDS / 2;
  const hour = ((clock / DAY_SECONDS) * 24) % 24;
  return hour > 20.4 || hour < 5.6 ? 'night' : 'roam';
}

/** Frame hook: follow the mood, run the crossfade, keep the panel honest. */
export function updateAudio(g, dt) {
  game = g;
  moodWanted = pickMood(g);
  if (!deck.front) {
    deck.front = trackElement(moodWanted);
    if (gateOpen) tryPlay(deck.front);
  } else if (deck.front.dataset.name !== moodWanted) {
    promote(moodWanted);
  }
  syncPanel();
  const step = Math.min(1, dt * 1.8);
  if (deck.front) {
    const goal = gateOpen ? musicLevel : 0;
    deck.front.volume = clamp01(deck.front.volume + (goal - deck.front.volume) * step);
    if (g.sfx.muted) deck.front.volume = 0;
  }
  fadeBack(step);
}

/** Music level 0..1: persisted, and mirrored onto the panel slider. */
export function setBgmVolume(v) {
  musicLevel = clamp01(v);
  writeLevels();
  if (panel.bgmIn) panel.bgmIn.value = String(Math.round(musicLevel * 100));
}

/** Effects level 0..1: persisted, mirrored, and pushed onto the SE bus. */
export function setSeVolume(v, g) {
  fxLevel = clamp01(v);
  writeLevels();
  if (panel.seIn) panel.seIn.value = String(Math.round(fxLevel * 100));
  if (g) g.sfx.setSeVolume(fxLevel);
}

export function bgmVolume() {
  return musicLevel;
}

export function seVolume() {
  return fxLevel;
}
