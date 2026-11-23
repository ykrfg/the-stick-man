// The HOW TO PLAY page: a full-screen, scrollable sheet over the title and
// pause screens, written entirely from the string table so it follows the
// language toggle like every other screen. It is a DOM sheet (own injected
// stylesheet, built once, shown and hidden by class) rather than canvas
// text, because the content is long, sectioned and must scroll on a phone.
// Opening it changes no game state: main.js remembers nothing about it
// beyond the open flag, the Back buttons (or Esc / Enter / P) close it, and
// the screen it covered — title or pause — is simply still there.
import { getLang, t } from './i18n.js';

/** One section of the page: a heading key and its body line keys. */
function section(headKey, lineKeys) {
  return { headKey, lineKeys };
}

/** Every section of the page, in the order the reader meets them. */
const SECTIONS = [
  section('howto.goal.h', ['howto.goal.0', 'howto.goal.1', 'howto.goal.2']),
  section('howto.keys.h', [
    'howto.keys.0', 'howto.keys.1', 'howto.keys.2', 'howto.keys.3', 'howto.keys.4',
    'howto.keys.5', 'howto.keys.6', 'howto.keys.7', 'howto.keys.8',
  ]),
  section('howto.touch.h', [
    'howto.touch.0', 'howto.touch.1', 'howto.touch.2',
    'howto.touch.3', 'howto.touch.4', 'howto.touch.5',
  ]),
  section('howto.cars.h', ['howto.cars.0', 'howto.cars.1', 'howto.cars.2', 'howto.cars.3', 'howto.cars.4']),
  section('howto.wanted.h', [
    'howto.wanted.0', 'howto.wanted.1', 'howto.wanted.2', 'howto.wanted.3', 'howto.wanted.4',
  ]),
  section('howto.money.h', [
    'howto.money.0', 'howto.money.1', 'howto.money.2',
    'howto.money.3', 'howto.money.4', 'howto.money.5', 'howto.money.6',
  ]),
  section('howto.day.h', ['howto.day.0', 'howto.day.1']),
  section('howto.sound.h', ['howto.sound.0', 'howto.sound.1']),
  section('howto.tips.h', ['howto.tips.0', 'howto.tips.1']),
];

/** The sheet's stylesheet, one rule per entry, joined when injected. */
const STYLE_RULES = [
  '#smHowto { position:fixed; inset:0; z-index:60; display:none; overflow-y:auto;',
  '  -webkit-overflow-scrolling:touch; box-sizing:border-box;',
  '  padding:calc(12px + env(safe-area-inset-top)) 16px calc(22px + env(safe-area-inset-bottom));',
  '  background:rgba(10,13,22,0.97); color:#dfe5ef; font-family:system-ui,sans-serif; }',
  '#smHowto.show { display:block; }',
  '#smHowto .inner { max-width:700px; margin:0 auto; }',
  '#smHowto .head { display:flex; align-items:center; justify-content:space-between; gap:12px;',
  '  position:sticky; top:0; padding:6px 0 10px; background:rgba(10,13,22,0.97); }',
  '#smHowto h1 { margin:0; color:#ffd94d; font-size:29px; font-weight:900; letter-spacing:1px; }',
  '#smHowto h2 { color:#ffd94d; font-size:17px; font-weight:800; letter-spacing:1px;',
  '  margin:22px 0 8px; padding-bottom:4px; border-bottom:2px solid rgba(255,217,77,0.35); }',
  '#smHowto p { font-size:15px; line-height:1.55; margin:6px 0; }',
  '#smHowto .backBtn { padding:10px 22px; border-radius:999px; border:3px solid #17181c;',
  '  background:#ffd94d; color:#17181c; font:800 15px system-ui,sans-serif; white-space:nowrap;',
  '  cursor:pointer; touch-action:none; -webkit-user-select:none; user-select:none; }',
  '#smHowto .foot { text-align:center; margin:26px 0 4px; }',
];

const sheet = { page: null, body: null, title: null, backTop: null, backBottom: null };
let isOpen = false;
let renderedLang = null;

function injectStyleOnce() {
  if (document.getElementById('smHowtoStyle')) return;
  const style = document.createElement('style');
  style.id = 'smHowtoStyle';
  style.textContent = STYLE_RULES.join('\n');
  document.head.appendChild(style);
}

function buildPage() {
  if (sheet.page) return;
  injectStyleOnce();
  const page = document.createElement('div');
  page.id = 'smHowto';
  page.innerHTML = `
    <div class="inner">
      <div class="head"><h1 id="smHowtoTitle"></h1><button class="backBtn" id="smHowtoBack" type="button"></button></div>
      <div id="smHowtoBody"></div>
      <div class="foot"><button class="backBtn" id="smHowtoBack2" type="button"></button></div>
    </div>`;
  document.body.appendChild(page);
  sheet.page = page;
  sheet.title = page.querySelector('#smHowtoTitle');
  sheet.body = page.querySelector('#smHowtoBody');
  sheet.backTop = page.querySelector('#smHowtoBack');
  sheet.backBottom = page.querySelector('#smHowtoBack2');
  const onBack = (event) => {
    event.preventDefault();
    closeHowto();
  };
  sheet.backTop.addEventListener('click', onBack);
  sheet.backBottom.addEventListener('click', onBack);
}

function appendSection({ headKey, lineKeys }) {
  const h = document.createElement('h2');
  h.textContent = t(headKey);
  sheet.body.appendChild(h);
  for (const key of lineKeys) {
    const p = document.createElement('p');
    p.textContent = t(key);
    sheet.body.appendChild(p);
  }
}

/** (Re)fill the sheet from the string table, in the current language. */
function render() {
  renderedLang = getLang();
  sheet.title.textContent = t('howto.title');
  sheet.backTop.textContent = t('howto.back');
  sheet.backBottom.textContent = t('howto.back');
  sheet.body.replaceChildren();
  for (const s of SECTIONS) appendSection(s);
}

/** Build the sheet (main calls this once at boot, never in ?shot= mode). */
export function initHowto() {
  buildPage();
}

export function howtoOpen() {
  return isOpen;
}

export function openHowto() {
  buildPage();
  render();
  sheet.page.scrollTop = 0;
  sheet.page.classList.add('show');
  isOpen = true;
}

export function closeHowto() {
  if (!isOpen) return;
  sheet.page.classList.remove('show');
  isOpen = false;
  // Never leave focus on a sheet button: Enter would re-click it.
  const active = document.activeElement;
  if (active && sheet.page.contains(active)) active.blur();
}

/** Frame hook: a language switch while the sheet is up re-renders it. */
export function syncHowto() {
  if (isOpen && renderedLang !== getLang()) render();
}
