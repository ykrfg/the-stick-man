// serve.ts — a throwaway static server for playing the game locally.
//
// Node 22, standard library only. `node serve.ts` serves this entry's
// game/ folder at http://localhost:8080; `node serve.ts --port 8123`
// picks another port. Requests are mapped onto files inside game/ and
// nowhere else, answered with the content types a browser game needs,
// and that is all it does: a development convenience, not a server for
// the open internet.

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The folder being served: game/, resolved from this file's location. */
const GAME_DIR = resolve(fileURLToPath(new URL('./game', import.meta.url)));

/** Content type by lowercase file extension; anything unlisted is binary. */
const MIME = new Map<string, string>([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
  ['.glb', 'model/gltf-binary'],
  ['.gltf', 'model/gltf+json'],
  ['.bin', 'application/octet-stream'],
  ['.wasm', 'application/wasm'],
  ['.wav', 'audio/wav'],
  ['.mp3', 'audio/mpeg'],
  ['.ogg', 'audio/ogg'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

/**
 * The port to listen on: the number after the first `--port` flag when
 * it is a usable port, and 8080 in every other case (no flag, a flag
 * with no value after it, or a value that is not a port).
 */
function pickPort(argv: string[]): number {
  const at = argv.indexOf('--port');
  const wanted = at === -1 ? 8080 : Number(argv[at + 1]);
  return Number.isInteger(wanted) && wanted > 0 && wanted < 65536 ? wanted : 8080;
}

/**
 * Resolve a request path to a file inside game/, or null when the path
 * climbs out of it. A path ending in '/' names that folder's index
 * page. The game folder itself passes this check and is rejected
 * later, as a non-file.
 */
function insideGame(pathname: string): string | null {
  const rel = normalize(pathname.endsWith('/') ? pathname + 'index.html' : pathname);
  const file = resolve(join(GAME_DIR, rel));
  return file === GAME_DIR || file.startsWith(GAME_DIR + sep) ? file : null;
}

/** Answer with a bare status line and a short plain-text body. */
function refuse(res: import('node:http').ServerResponse, status: number, body: string): void {
  res.writeHead(status).end(body);
}

const port = pickPort(process.argv.slice(2));

createServer((req, res) => {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    refuse(res, 400, 'bad request');
    return;
  }
  const file = insideGame(pathname);
  if (file === null) {
    refuse(res, 403, 'forbidden');
    return;
  }
  let size: number;
  try {
    const stats = statSync(file);
    if (!stats.isFile()) throw new Error('not a file');
    size = stats.size;
  } catch {
    refuse(res, 404, 'not found');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME.get(extname(file).toLowerCase()) ?? 'application/octet-stream',
    'content-length': size,
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => {
  console.log('game/ is on http://localhost:' + port);
});
