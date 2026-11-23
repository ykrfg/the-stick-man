// main.ts — the gta6-01 hand-in program for THE STICK MAN.
//
// Runs as-is under Node 22 (`node main.ts`): standard library only,
// erasable TypeScript, no build step. The entry being handed in is the
// game/ tree beside this file — plain static files a desktop browser
// loads offline (game/index.html, its ES modules, a vendored Three.js;
// nothing is fetched at runtime). This program copies that tree and the
// screenshots/ set into the output directory and writes dossier.json,
// the summary the judge reads. The dossier is produced by make.fun's own
// vendored builder, so what is scored on the far side is byte-for-byte
// the summary this program prints here.
//
// Output directory: MAKEFUN_OUTPUT_DIR when set, /output otherwise.
// Local play instead: `node serve.ts`, then open http://localhost:8080.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

/** The entry's name, stamped into the run log so a hand-in names what it ships. */
const ENTRY_NAME = 'THE STICK MAN';

// The scorer's caps, mirrored so this program refuses a tree the scorer
// would refuse anyway: at most 4 screenshots of at most 256 KiB each, at
// most 993 files and 48 MiB under game/, no game path over 1000 bytes.
// Of these, only the text cap shapes the dossier's bytes.
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

/** This file's own directory: game/ and screenshots/ live beside it. */
function entryDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

/** Copy one entry tree (game/, screenshots/) into the output directory. */
function copyTree(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  if (existsSync(from)) cpSync(from, to, { recursive: true });
}

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
console.log(`Staging ${ENTRY_NAME} into ${outDir}: game/ + screenshots/, then dossier.json`);
mkdirSync(outDir, { recursive: true });
copyTree(join(entryDir(), 'game'), join(outDir, 'game'));
copyTree(join(entryDir(), 'screenshots'), join(outDir, 'screenshots'));
writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, CAPS));
console.log('Hand-in complete.');
