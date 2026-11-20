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

let game = null;
let bgm = 0.7;
let se = 1;
let unlocked = false;
let want = null;
let current = null;
let prev = null;
const nodes = {};

function readVolumes() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(VOL_KEY) || 'null');
    if (raw && Number.isFinite(raw.bgm)) bgm = Math.max(0, Math.min(1, raw.bgm));
    if (raw && Number.isFinite(raw.se)) se = Math.max(0, Math.min(1, raw.se));
  } catch {
    /* defaults stand */
  }
}

function storeVolumes() {
  try {
    window.localStorage.setItem(VOL_KEY, JSON.stringify({ bgm, se }));
  } catch {
    /* no storage: the volumes just do not persist */
  }
}

function makeNode(name) {
  const el = new window.Audio(TRACKS[name]);
  el.dataset.name = name;
  el.loop = true;
  el.preload = 'auto';
  el.volume = 0;
  nodes[name] = el;
  return el;
}

/* ---------------------------------------------------------------- sliders */

let panel = null;
let bgmInput = null;
let seInput = null;
let lastShown = null;

function buildPanel() {
  if (panel) return;
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
  panel = document.createElement('div');
  panel.id = 'smVol';
  panel.innerHTML = `
    <label><span id="smVolBgmLabel"></span><input id="smVolBgm" type="range" min="0" max="100" step="1"></label>
    <label><span id="smVolSeLabel"></span><input id="smVolSe" type="range" min="0" max="100" step="1"></label>`;
  document.body.appendChild(panel);
  bgmInput = panel.querySelector('#smVolBgm');
  seInput = panel.querySelector('#smVolSe');
  bgmInput.value = String(Math.round(bgm * 100));
  seInput.value = String(Math.round(se * 100));
  bgmInput.addEventListener('input', () => setBgmVolume(Number(bgmInput.value) / 100));
  seInput.addEventListener('input', () => {
    const v = Number(seInput.value) / 100;
    if (game) setSeVolume(v, game);
    else setSeVolume(v);
  });
}

function syncPanel() {
  if (!panel || !game) return;
  const show = game.state === 'title' || game.state === 'paused';
  if (show !== lastShown) {
    lastShown = show;
    panel.classList.toggle('show', show);
  }
  if (!show) return;
  const bl = panel.querySelector('#smVolBgmLabel');
  const sl = panel.querySelector('#smVolSeLabel');
  const bt = t('audio.bgm');
  const st = t('audio.se');
  if (bl.textContent !== bt) bl.textContent = bt;
  if (sl.textContent !== st) sl.textContent = st;
  if (document.activeElement !== bgmInput) bgmInput.value = String(Math.round(bgm * 100));
  if (document.activeElement !== seInput) seInput.value = String(Math.round(se * 100));
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
    if (want && !current) current = nodes[want] || makeNode(want);
    if (current) current.play().catch(() => {});
  };
  window.addEventListener('pointerdown', start);
  window.addEventListener('keydown', start);
}

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
  current = nodes[name] || makeNode(name);
  current.volume = 0;
  if (unlocked) current.play().catch(() => {});
}

/** Frame hook: pick the track, crossfade, and follow the sliders. */
export function updateAudio(g, dt) {
  game = g;
  want = choose(g);
  if (!current) {
    current = nodes[want] || makeNode(want);
    if (unlocked) current.play().catch(() => {});
  } else if (current.dataset.name !== want) {
    begin(want);
  }
  syncPanel();
  const step = Math.min(1, dt * 1.8);
  if (current) {
    const target = unlocked ? bgm : 0;
    current.volume = Math.max(0, Math.min(1, current.volume + (target - current.volume) * step));
    if (g.sfx.muted) current.volume = 0;
  }
  if (prev) {
    prev.volume = Math.max(0, prev.volume - step * 0.9);
    if (prev.volume <= 0.01) {
      prev.pause();
      prev = null;
    }
  }
}

/** Music volume 0..1 (persisted). */
export function setBgmVolume(v) {
  bgm = Math.max(0, Math.min(1, v));
  storeVolumes();
  if (bgmInput) bgmInput.value = String(Math.round(bgm * 100));
}

/** Sound-effect volume 0..1 (persisted, applied to the SE bus). */
export function setSeVolume(v, g) {
  se = Math.max(0, Math.min(1, v));
  storeVolumes();
  if (seInput) seInput.value = String(Math.round(se * 100));
  if (g) g.sfx.setSeVolume(se);
}

export function bgmVolume() {
  return bgm;
}

export function seVolume() {
  return se;
}
