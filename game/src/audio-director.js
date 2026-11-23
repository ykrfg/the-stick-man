// The audio director.
//
// Owns the music: four looping tracks in game/audio/ (title, daytime roam,
// night, chase) crossfaded after the mood of the run, on a bus of their
// own, apart from the sound effects. A missing track file is just a quiet
// game, never an error. The two volume sliders live on a small panel shown
// over the title and pause screens; their values persist under a key of
// their own, away from the progress save, so a reset never touches them.
// The M-key mute is session-only and lives on the SoundFX side.
//
// Nothing here makes a sound until the first gesture: browsers hold audio
// until then, and on mobile that gesture is the same tap that starts play.
import { DAY_SECONDS } from './config.js';
import { t } from './i18n.js';

const VOL_KEY = 'the-stick-man-audio-v1';
const TRACK_FILE = {
  title: 'audio/bgm_title.ogg',
  roam: 'audio/bgm_roam.ogg',
  night: 'audio/bgm_night.ogg',
  chase: 'audio/bgm_chase.ogg',
};

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Director state. `deck` holds the two music elements in play: the one the
// audience hears (front) and the one fading out beneath it (back).
let game = null;
let bgmLevel = 0.7;
let seLevel = 1;
let unlocked = false;
let wanted = null;
const deck = { front: null, back: null };
const elements = new Map();

/* ------------------------------------------------------------ persistence */

function loadVolumes() {
  let saved = null;
  try {
    saved = JSON.parse(window.localStorage.getItem(VOL_KEY) || 'null');
  } catch {
    /* unreadable storage: the defaults stand */
  }
  if (saved && Number.isFinite(saved.bgm)) bgmLevel = clamp01(saved.bgm);
  if (saved && Number.isFinite(saved.se)) seLevel = clamp01(saved.se);
}

function saveVolumes() {
  try {
    window.localStorage.setItem(VOL_KEY, JSON.stringify({ bgm: bgmLevel, se: seLevel }));
  } catch {
    /* storage refused: the levels just do not persist */
  }
}

/* ------------------------------------------------------------------ deck */

function elementFor(name) {
  if (!elements.has(name)) {
    const el = new window.Audio(TRACK_FILE[name]);
    el.dataset.name = name;
    el.loop = true;
    el.preload = 'auto';
    el.volume = 0;
    elements.set(name, el);
  }
  return elements.get(name);
}

function startQuietly(el) {
  el.play().catch(() => {});
}

/** Hand the stage to a new track: the old front steps back, still playing. */
function bringUp(name) {
  if (deck.front && deck.front.dataset.name === name) return;
  if (deck.back && deck.back !== deck.front) deck.back.pause();
  deck.back = deck.front;
  deck.front = elementFor(name);
  deck.front.volume = 0;
  if (unlocked) startQuietly(deck.front);
}

/** Sink the back element toward silence; pause and clear it on arrival. */
function sinkBack(step) {
  const el = deck.back;
  if (!el) return;
  el.volume = Math.max(0, el.volume - step * 0.9);
  if (el.volume <= 0.01) {
    el.pause();
    deck.back = null;
  }
}

/* ---------------------------------------------------------- volume panel */

const panel = { root: null, bgmIn: null, seIn: null, bgmLabel: null, seLabel: null, shown: null };

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
  const mkRow = (labelId, inputId) => {
    const label = document.createElement('label');
    const caption = document.createElement('span');
    caption.id = labelId;
    const input = document.createElement('input');
    input.id = inputId;
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.step = '1';
    label.append(caption, input);
    return { label, caption, input };
  };
  const bgmRow = mkRow('smVolBgmLabel', 'smVolBgm');
  const seRow = mkRow('smVolSeLabel', 'smVolSe');
  root.append(bgmRow.label, seRow.label);
  document.body.appendChild(root);
  panel.root = root;
  panel.bgmIn = bgmRow.input;
  panel.seIn = seRow.input;
  panel.bgmLabel = bgmRow.caption;
  panel.seLabel = seRow.caption;
  panel.bgmIn.value = String(Math.round(bgmLevel * 100));
  panel.seIn.value = String(Math.round(seLevel * 100));
  panel.bgmIn.addEventListener('input', () => setBgmVolume(Number(panel.bgmIn.value) / 100));
  panel.seIn.addEventListener('input', () => {
    const v = Number(panel.seIn.value) / 100;
    if (game) setSeVolume(v, game);
    else setSeVolume(v);
  });
}

function caption(el, key) {
  const text = t(key);
  if (el.textContent !== text) el.textContent = text;
}

function reflect(input, level) {
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
  caption(panel.bgmLabel, 'audio.bgm');
  caption(panel.seLabel, 'audio.se');
  reflect(panel.bgmIn, bgmLevel);
  reflect(panel.seIn, seLevel);
}

/* ------------------------------------------------------------------- core */

/** Wire the buses and read the saved levels; called once at boot. */
export function initAudio(g) {
  game = g;
  loadVolumes();
  g.sfx.setSeVolume(seLevel);
  buildPanel();
  const openGate = () => {
    if (unlocked) return;
    unlocked = true;
    g.sfx.unlock();
    if (wanted && !deck.front) deck.front = elementFor(wanted);
    if (deck.front) startQuietly(deck.front);
  };
  window.addEventListener('pointerdown', openGate);
  window.addEventListener('keydown', openGate);
}

/** The track the run's mood asks for: menus, heat, then the hour. */
function moodFor(g) {
  if (g.state === 'title' || g.state === 'paused') return 'title';
  if (g.stars >= 2) return 'chase';
  const clock = typeof g.clock === 'number' ? g.clock : DAY_SECONDS / 2;
  const hour = ((clock / DAY_SECONDS) * 24) % 24;
  return hour > 20.4 || hour < 5.6 ? 'night' : 'roam';
}

/** Frame hook: follow the mood, run the crossfade, mind the panel. */
export function updateAudio(g, dt) {
  game = g;
  wanted = moodFor(g);
  if (!deck.front) {
    deck.front = elementFor(wanted);
    if (unlocked) startQuietly(deck.front);
  } else if (deck.front.dataset.name !== wanted) {
    bringUp(wanted);
  }
  syncPanel();
  const step = Math.min(1, dt * 1.8);
  if (deck.front) {
    const goal = unlocked ? bgmLevel : 0;
    deck.front.volume = clamp01(deck.front.volume + (goal - deck.front.volume) * step);
    if (g.sfx.muted) deck.front.volume = 0;
  }
  sinkBack(step);
}

/** Music level 0..1; persisted, and reflected on the panel's slider. */
export function setBgmVolume(v) {
  bgmLevel = clamp01(v);
  saveVolumes();
  if (panel.bgmIn) panel.bgmIn.value = String(Math.round(bgmLevel * 100));
}

/** Effects level 0..1; persisted, and pushed onto the SE bus. */
export function setSeVolume(v, g) {
  seLevel = clamp01(v);
  saveVolumes();
  if (panel.seIn) panel.seIn.value = String(Math.round(seLevel * 100));
  if (g) g.sfx.setSeVolume(seLevel);
}

export function bgmVolume() {
  return bgmLevel;
}

export function seVolume() {
  return seLevel;
}
