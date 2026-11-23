// main.ts — the make.fun hand-in program for THE STICK MAN (gta6-01).
//
// What is being handed in is the game/ tree beside this file: a static
// browser game (an index page, its ES modules and a vendored Three.js)
// that loads fully offline. This program's whole job is to stage that
// tree, plus the screenshots/ set, into the output directory and then
// write dossier.json — the summary the judge reads — using make.fun's
// own vendored builder, so the dossier scored on the far side is
// byte-for-byte the one this program produces here.
//
// Node 22, standard library only, erasable TypeScript: it runs as-is
// with `node main.ts`, no build step. The output directory is
// MAKEFUN_OUTPUT_DIR when set and /output otherwise. To play the game
// locally instead, run `node serve.ts` and open http://localhost:8080.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

/** The entry's name, stamped into the run log so a hand-in names what it ships. */
const TITLE = 'THE STICK MAN';

/**
 * The scorer's caps, restated so the dossier is built under the same
 * limits the far side enforces: at most 4 screenshots of at most
 * 256 KiB each, at most 993 files and 48 MiB under game/, no game path
 * over 1000 bytes, and dossier text excerpts capped at 160 KiB. Of
 * these, only the text cap shapes the dossier's bytes.
 */
const LIMITS = {
  text_max_bytes: 160 * 1024,
  screenshots: { max: 4, max_bytes: 256 * 1024 },
  game_max_files: 993,
  game_max_bytes: 48 * 1024 * 1024,
  game_path_max_bytes: 1000,
};

/** The trees that make up the entry, staged in this order. */
const TREES = ['game', 'screenshots'];

/** The directory this file lives in; both entry trees sit beside it. */
function homeDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

/**
 * Stage one entry tree into the output directory. The destination is
 * created first, so a tree missing on the source side still leaves an
 * (empty) directory behind rather than failing the hand-in.
 */
function stageTree(name: string, outDir: string): void {
  const from = join(homeDir(), name);
  const to = join(outDir, name);
  mkdirSync(to, { recursive: true });
  if (existsSync(from)) cpSync(from, to, { recursive: true });
}

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
console.log(`Staging ${TITLE} into ${outDir}: game/ + screenshots/, then dossier.json`);
mkdirSync(outDir, { recursive: true });
for (const name of TREES) stageTree(name, outDir);
writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, LIMITS));
console.log('Hand-in complete.');
