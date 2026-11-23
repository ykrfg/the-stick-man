// The audio director: background music that follows the mood of the run, a
// separate sound-effect bus, and the two volume sliders. Track files live in
// game/audio/ and are optional: a missing file plays silence and nothing else
// breaks. Mobile starts audio on the same first tap that starts the game.
//
// Volumes persist under their own key, away from the run save, so wiping
// progress never resets them. Mute (M) stays session-only.
import { DAY_SECONDS } from './config.js';
import { t } from './i18n.js';

const VOL_KEY = 'the-stick-man-audio-v1';

const TRACKS = {
  title: 'audio/bgm_title.ogg',
  roam: 'audio/bgm_roam.ogg',
  night: 'audio/bgm_night.ogg',
  chase: 'audio/bgm_chase.ogg',
};

const clamp01 = (v) => Math.max(0, Math.min(1, v));

let game = null;
let bgm = 0.7;
let se = 1;
let unlocked = false;
let want = null;
let current = null;
let prev = null;
const nodes = {};

function readVolumes() {
  let raw = null;
  try {
    raw = JSON.parse(window.localStorage.getItem(VOL_KEY) || 'null');
  } catch {
    /* defaults stand */
  }
  if (raw && Number.isFinite(raw.bgm)) bgm = clamp01(raw.bgm);
  if (raw && Number.isFinite(raw.se)) se = clamp01(raw.se);
}

function storeVolumes() {
  try {
    window.localStorage.setItem(VOL_KEY, JSON.stringify({ bgm, se }));
  } catch {
    /* no storage: the volumes just do not persist */
  }
}

function nodeFor(name) {
  if (!nodes[name]) {
    const el = new window.Audio(TRACKS[name]);
    el.dataset.name = name;
    el.loop = true;
    el.preload = 'auto';
    el.volume = 0;
    nodes[name] = el;
  }
  return nodes[name];
}

function playQuietly(el) {
  el.play().catch(() => {});
}

/* ---------------------------------------------------------------- sliders */

const panelRefs = { panel: null, bgmInput: null, seInput: null, shown: null };

function buildPanel() {
  if (panelRefs.panel) return;
  if (!document.getElementById('smVolStyle')) {
    const style = document.createElement('style');
    style.id = 'smVolStyle';
    style.textContent = `
    #smVol { position:fixed; right:14px; top:calc(120px + env(safe-area-inset-top));
      display:none; flex-direction:column; gap:7px; padding:9px 12px; z-index:30;
      background:rgba(14,18,30,0.9); border:1px solid rgba(255,255,255,0.22);
      border-radius:11px; color:#f4f1e6; font:600 11px system-ui,sans-serif;
      letter-spacing:1px; }
    #smVol.show { display:flex; }
    #smVol label { display:flex; align-items:center; gap:8px; }
    #smVol input { width:100px; accent-color:#ffd94d; }
    `;
    document.head.appendChild(style);
  }
  const panel = document.createElement('div');
  panel.id = 'smVol';
  panel.innerHTML = `
    <label><span id="smVolBgmLabel"></span><input id="smVolBgm" type="range" min="0" max="100" step="1"></label>
    <label><span id="smVolSeLabel"></span><input id="smVolSe" type="range" min="0" max="100" step="1"></label>`;
  document.body.appendChild(panel);
  panelRefs.panel = panel;
  panelRefs.bgmInput = panel.querySelector('#smVolBgm');
  panelRefs.seInput = panel.querySelector('#smVolSe');
  panelRefs.bgmInput.value = String(Math.round(bgm * 100));
  panelRefs.seInput.value = String(Math.round(se * 100));
  panelRefs.bgmInput.addEventListener('input', () => setBgmVolume(Number(panelRefs.bgmInput.value) / 100));
  panelRefs.seInput.addEventListener('input', () => {
    const v = Number(panelRefs.seInput.value) / 100;
    if (game) setSeVolume(v, game);
    else setSeVolume(v);
  });
}

function setLabel(el, key) {
  const text = t(key);
  if (el.textContent !== text) el.textContent = text;
}

function setSlider(input, value) {
  if (document.activeElement !== input) input.value = String(Math.round(value * 100));
}

function syncPanel() {
  const { panel, bgmInput, seInput } = panelRefs;
  if (!panel || !game) return;
  const show = game.state === 'title' || game.state === 'paused';
  if (show !== panelRefs.shown) {
    panelRefs.shown = show;
    panel.classList.toggle('show', show);
  }
  if (!show) return;
  setLabel(panel.querySelector('#smVolBgmLabel'), 'audio.bgm');
  setLabel(panel.querySelector('#smVolSeLabel'), 'audio.se');
  setSlider(bgmInput, bgm);
  setSlider(seInput, se);
}

/* ------------------------------------------------------------------- core */

/** Build the buses and read saved volumes; main calls this once at boot. */
export function initAudio(g) {
  game = g;
  readVolumes();
  g.sfx.setSeVolume(se);
  buildPanel();
  const start = () => {
    if (unlocked) return;
    unlocked = true;
    g.sfx.unlock();
    if (want && !current) current = nodeFor(want);
    if (current) playQuietly(current);
  };
  window.addEventListener('pointerdown', start);
  window.addEventListener('keydown', start);
}

/** Which track the run's mood calls for right now. */
function choose(g) {
  if (g.state === 'title' || g.state === 'paused') return 'title';
  if (g.stars >= 2) return 'chase';
  const clock = typeof g.clock === 'number' ? g.clock : DAY_SECONDS / 2;
  const hour = ((clock / DAY_SECONDS) * 24) % 24;
  return hour > 20.4 || hour < 5.6 ? 'night' : 'roam';
}

/** Move to a track: the old node fades out under the new one. */
function begin(name) {
  if (current && current.dataset.name === name) return;
  if (prev && prev !== current) prev.pause();
  prev = current;
  current = nodeFor(name);
  current.volume = 0;
  if (unlocked) playQuietly(current);
}

/** Ease one fading-out node toward silence; retire it when it gets there. */
function fadeOut(node, step) {
  node.volume = Math.max(0, node.volume - step * 0.9);
  if (node.volume > 0.01) return node;
  node.pause();
  return null;
}

/** Frame hook: pick the track, crossfade, and follow the sliders. */
export function updateAudio(g, dt) {
  game = g;
  want = choose(g);
  if (!current) {
    current = nodeFor(want);
    if (unlocked) playQuietly(current);
  } else if (current.dataset.name !== want) {
    begin(want);
  }
  syncPanel();
  const step = Math.min(1, dt * 1.8);
  if (current) {
    const target = unlocked ? bgm : 0;
    current.volume = clamp01(current.volume + (target - current.volume) * step);
    if (g.sfx.muted) current.volume = 0;
  }
  if (prev) prev = fadeOut(prev, step);
}

/** Music volume 0..1 (persisted). */
export function setBgmVolume(v) {
  bgm = clamp01(v);
  storeVolumes();
  if (panelRefs.bgmInput) panelRefs.bgmInput.value = String(Math.round(bgm * 100));
}

/** Sound-effect volume 0..1 (persisted, applied to the SE bus). */
export function setSeVolume(v, g) {
  se = clamp01(v);
  storeVolumes();
  if (panelRefs.seInput) panelRefs.seInput.value = String(Math.round(se * 100));
  if (g) g.sfx.setSeVolume(se);
}

export function bgmVolume() {
  return bgm;
}

export function seVolume() {
  return se;
}
