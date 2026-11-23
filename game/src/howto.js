// The HOW TO PLAY sheet.
//
// A full-screen, scrollable overlay that sits on top of the title and pause
// screens. Every word on it comes out of the string table, so it follows
// the language toggle like the rest of the interface. It is built from DOM
// nodes under its own injected stylesheet — the text is long and sectioned
// and has to scroll on a phone, which canvas text does badly. Opening or
// closing the sheet touches no game state: the screen underneath (title or
// pause) is simply still there when the sheet goes away, and the Back
// buttons — or Esc / Enter / P, handled by the caller — close it.
import { getLang, t } from './i18n.js';

// The page's layout: section name and how many body lines it carries, in
// reading order. Heading and lines are string-table keys built from the
// name: the heading is `howto.<name>.h`, the lines `howto.<name>.0` and up.
const LAYOUT = [
  ['goal', 3],
  ['keys', 9],
  ['touch', 6],
  ['cars', 5],
  ['wanted', 5],
  ['money', 7],
  ['day', 2],
  ['sound', 2],
  ['tips', 3],
];

/** One section, expanded: its heading key and the key of every body line. */
function expandSection([name, lineCount]) {
  const lines = [];
  for (let i = 0; i < lineCount; i++) lines.push(`howto.${name}.${i}`);
  return { heading: `howto.${name}.h`, lines };
}

const SECTIONS = LAYOUT.map(expandSection);

// The sheet's look. Gold on near-black, to match the game's menus; the head
// row sticks while the body scrolls under it, and the whole sheet respects
// the phone's safe areas. Written as one text block and injected once.
const SHEET_CSS = `
#smHowto {
  position: fixed; inset: 0; z-index: 60; display: none; overflow-y: auto;
  -webkit-overflow-scrolling: touch; box-sizing: border-box;
  padding: calc(12px + env(safe-area-inset-top)) 16px calc(22px + env(safe-area-inset-bottom));
  background: rgba(10,13,22,0.97); color: #dfe5ef; font-family: system-ui, sans-serif;
}
#smHowto.show { display: block; }
#smHowto .inner { max-width: 700px; margin: 0 auto; }
#smHowto .head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  position: sticky; top: 0; padding: 6px 0 10px; background: rgba(10,13,22,0.97);
}
#smHowto h1 { margin: 0; color: #ffd94d; font-size: 29px; font-weight: 900; letter-spacing: 1px; }
#smHowto h2 {
  color: #ffd94d; font-size: 17px; font-weight: 800; letter-spacing: 1px;
  margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 2px solid rgba(255,217,77,0.35);
}
#smHowto p { font-size: 15px; line-height: 1.55; margin: 6px 0; }
#smHowto .backBtn {
  padding: 10px 22px; border-radius: 999px; border: 3px solid #17181c;
  background: #ffd94d; color: #17181c; font: 800 15px system-ui, sans-serif; white-space: nowrap;
  cursor: pointer; touch-action: none; -webkit-user-select: none; user-select: none;
}
#smHowto .foot { text-align: center; margin: 26px 0 4px; }
`;

// The built nodes, gathered once the sheet exists; `shown` is the open
// flag and `shownLang` the language the current render was made in, so the
// frame hook can spot a mid-read language switch.
const dom = { root: null, title: null, body: null, backTop: null, backFoot: null };
let shown = false;
let shownLang = null;

function ensureStyle() {
  if (document.getElementById('smHowtoStyle')) return;
  const el = document.createElement('style');
  el.id = 'smHowtoStyle';
  el.textContent = SHEET_CSS;
  document.head.appendChild(el);
}

function ensureSheet() {
  if (dom.root) return;
  ensureStyle();
  const root = document.createElement('div');
  root.id = 'smHowto';
  const inner = document.createElement('div');
  inner.className = 'inner';
  const head = document.createElement('div');
  head.className = 'head';
  dom.title = document.createElement('h1');
  dom.title.id = 'smHowtoTitle';
  dom.backTop = document.createElement('button');
  dom.backTop.className = 'backBtn';
  dom.backTop.id = 'smHowtoBack';
  dom.backTop.type = 'button';
  head.append(dom.title, dom.backTop);
  dom.body = document.createElement('div');
  dom.body.id = 'smHowtoBody';
  const foot = document.createElement('div');
  foot.className = 'foot';
  dom.backFoot = document.createElement('button');
  dom.backFoot.className = 'backBtn';
  dom.backFoot.id = 'smHowtoBack2';
  dom.backFoot.type = 'button';
  foot.appendChild(dom.backFoot);
  inner.append(head, dom.body, foot);
  root.appendChild(inner);
  document.body.appendChild(root);
  dom.root = root;
  const dismiss = (event) => {
    event.preventDefault();
    closeHowto();
  };
  dom.backTop.addEventListener('click', dismiss);
  dom.backFoot.addEventListener('click', dismiss);
}

/** Fill the sheet from the string table, in the language of the moment. */
function render() {
  shownLang = getLang();
  dom.title.textContent = t('howto.title');
  dom.backTop.textContent = t('howto.back');
  dom.backFoot.textContent = t('howto.back');
  const fresh = [];
  for (const { heading, lines } of SECTIONS) {
    const h = document.createElement('h2');
    h.textContent = t(heading);
    fresh.push(h);
    for (const key of lines) {
      const p = document.createElement('p');
      p.textContent = t(key);
      fresh.push(p);
    }
  }
  dom.body.replaceChildren(...fresh);
}

/** Build the sheet once (called at boot; never in ?shot= mode). */
export function initHowto() {
  ensureSheet();
}

export function howtoOpen() {
  return shown;
}

export function openHowto() {
  ensureSheet();
  render();
  dom.root.scrollTop = 0;
  dom.root.classList.add('show');
  shown = true;
}

export function closeHowto() {
  if (!shown) return;
  dom.root.classList.remove('show');
  shown = false;
  // A focused sheet button would swallow the next Enter as a re-click.
  const active = document.activeElement;
  if (active && dom.root.contains(active)) active.blur();
}

/** Frame hook: if the language changed while reading, render it again. */
export function syncHowto() {
  if (shown && shownLang !== getLang()) render();
}
