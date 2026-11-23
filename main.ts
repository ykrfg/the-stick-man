// THE STICK MAN — hand-in program for the gta6-01 bounty (Node 22, standard library
// only, erasable TypeScript: it runs as-is with `node main.ts`, no build step).
//
// The entry itself is the game/ tree beside this file: plain static files a desktop
// browser loads offline (game/index.html, its ES modules, a vendored Three.js — no
// network at runtime). This program stages that tree and the screenshots/ set into
// the output directory, then writes the dossier the judge reads. The dossier comes
// from make.fun's vendored library, so the summary is produced by the very code the
// scorer runs on the other side.
//
// Output directory: MAKEFUN_OUTPUT_DIR when set, /output otherwise.
// Local play: `node serve.ts`, then open http://localhost:8080.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

/** The entry's name, stamped into the run log so a hand-in names what it ships. */
const ENTRY_NAME = 'THE STICK MAN';

// The scorer's caps, mirrored here so this program refuses a tree the scorer would
// refuse anyway: at most 4 screenshots of at most 256 KiB each, at most 993 files
// and 48 MiB under game/, no game path over 1000 bytes. Of these, only the text cap
// shapes the dossier's bytes.
const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

/** Copy game/ and (when present) screenshots/ from beside this file into outDir. */
function stageInto(outDir: string): void {
  const home = path.dirname(fileURLToPath(import.meta.url));
  fs.mkdirSync(outDir, { recursive: true });
  fs.cpSync(path.join(home, 'game'), path.join(outDir, 'game'), { recursive: true });
  const shotsTo = path.join(outDir, 'screenshots');
  fs.mkdirSync(shotsTo, { recursive: true });
  const shotsFrom = path.join(home, 'screenshots');
  if (fs.existsSync(shotsFrom)) fs.cpSync(shotsFrom, shotsTo, { recursive: true });
}

const target = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
console.log(`Staging ${ENTRY_NAME} into ${target}: game/ + screenshots/, then dossier.json`);
stageInto(target);
fs.writeFileSync(path.join(target, 'dossier.json'), buildDossier(target, DOSSIER_CAPS));
console.log('Hand-in complete.');
