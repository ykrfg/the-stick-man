// howto.js — the HOW TO PLAY sheet.
//
// A full-screen overlay that scrolls, laid over whichever screen called
// it (title or pause). Nothing in the game state changes when it opens
// or closes: the screen underneath is simply still there afterwards,
// and the caller routes Esc / Enter / P to the same close the Back
// buttons perform. Every visible word is pulled from the string table
// at render time, so the sheet follows the language toggle like the
// rest of the interface — and a toggle mid-read re-renders it (see
// syncHowto, the frame hook).
//
// The sheet is DOM, not canvas: the text is long, sectioned and must
// scroll on a phone, all of which DOM does natively. Its stylesheet is
// injected once under its own id, in the menus' gold-on-near-black.
import { getLang, t } from './i18n.js';

// What the sheet contains, in reading order: a section name and the
// number of body lines under it. The string keys are derived from the
// name — the heading is `howto.<name>.h` and the body lines are
// `howto.<name>.0`, `.1`, … up to the count. The tips section is the
// last one: heading howto.tips.h plus the three lines .0, .1 and .2.
const CONTENTS = [
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

// The sheet's styling. The head row is sticky so the title and its
// Back button stay reachable while the body scrolls beneath them, and
// the padding keeps clear of the phone's safe areas.
const STYLE_TEXT = `
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

// The built sheet, cached after its first construction. `open` is the
// visibility flag and `renderedLang` the language the current render
// was produced in, so the frame hook can notice a mid-read switch.
const sheet = { root: null, title: null, body: null, backTop: null, backFoot: null };
let open = false;
let renderedLang = null;

/** A DOM node with the id and class the stylesheet expects. */
function node(tag, id, cls) {
  const el = document.createElement(tag);
  if (id) el.id = id;
  if (cls) el.className = cls;
  return el;
}

function injectStyleOnce() {
  if (document.getElementById('smHowtoStyle')) return;
  const el = node('style', 'smHowtoStyle', null);
  el.textContent = STYLE_TEXT;
  document.head.appendChild(el);
}

/**
 * Build the sheet's skeleton once: root, sticky head (title + Back),
 * empty body, foot (second Back). The words themselves are filled in
 * per render; only the structure is permanent.
 */
function buildSheet() {
  if (sheet.root) return;
  injectStyleOnce();
  const root = node('div', 'smHowto', null);
  const inner = node('div', null, 'inner');
  const head = node('div', null, 'head');
  sheet.title = node('h1', 'smHowtoTitle', null);
  sheet.backTop = node('button', 'smHowtoBack', 'backBtn');
  sheet.backTop.type = 'button';
  head.append(sheet.title, sheet.backTop);
  sheet.body = node('div', 'smHowtoBody', null);
  const foot = node('div', null, 'foot');
  sheet.backFoot = node('button', 'smHowtoBack2', 'backBtn');
  sheet.backFoot.type = 'button';
  foot.appendChild(sheet.backFoot);
  inner.append(head, sheet.body, foot);
  root.appendChild(inner);
  document.body.appendChild(root);
  sheet.root = root;
  const dismiss = (event) => {
    event.preventDefault();
    closeHowto();
  };
  sheet.backTop.addEventListener('click', dismiss);
  sheet.backFoot.addEventListener('click', dismiss);
}

/** Fill the sheet from the string table, in the language of the moment. */
function renderSheet() {
  renderedLang = getLang();
  sheet.title.textContent = t('howto.title');
  sheet.backTop.textContent = t('howto.back');
  sheet.backFoot.textContent = t('howto.back');
  const children = [];
  for (const [name, lineCount] of CONTENTS) {
    const heading = node('h2', null, null);
    heading.textContent = t(`howto.${name}.h`);
    children.push(heading);
    for (let i = 0; i < lineCount; i += 1) {
      const line = node('p', null, null);
      line.textContent = t(`howto.${name}.${i}`);
      children.push(line);
    }
  }
  sheet.body.replaceChildren(...children);
}

/** Build the sheet once (called at boot; never in ?shot= mode). */
export function initHowto() {
  buildSheet();
}

export function howtoOpen() {
  return open;
}

export function openHowto() {
  buildSheet();
  renderSheet();
  sheet.root.scrollTop = 0;
  sheet.root.classList.add('show');
  open = true;
}

export function closeHowto() {
  if (!open) return;
  sheet.root.classList.remove('show');
  open = false;
  // A focused sheet button would swallow the next Enter as a re-click.
  const active = document.activeElement;
  if (active && sheet.root.contains(active)) active.blur();
}

/** Frame hook: a language switch while the sheet is up re-renders it. */
export function syncHowto() {
  if (open && renderedLang !== getLang()) renderSheet();
}
