// serve.ts — a tiny static file server for local play.
//
// Node 22, standard library only. `node serve.ts` serves this entry's
// game/ folder on http://localhost:8080; `node serve.ts --port 8123`
// picks another port. It answers with the MIME types a browser game
// needs, keeps every request inside game/, and does nothing else: a
// development convenience, not a server for the open internet.

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('./game', import.meta.url)));

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
};

function contentType(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/** --port N wins when N is a usable port number; 8080 otherwise. */
function choosePort(argv: string[]): number {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== '--port') continue;
    const wanted = Number(argv[i + 1]);
    return Number.isInteger(wanted) && wanted > 0 && wanted < 65536 ? wanted : 8080;
  }
  return 8080;
}

/** Map a request path to a file inside game/, or null when it escapes. */
function locate(pathname: string): string | null {
  const rel = normalize(pathname.endsWith('/') ? pathname + 'index.html' : pathname);
  const file = resolve(join(ROOT, rel));
  return file === ROOT || file.startsWith(ROOT + sep) ? file : null;
}

const port = choosePort(process.argv.slice(2));

createServer((req, res) => {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('bad request');
    return;
  }
  const file = locate(pathname);
  if (file === null) {
    res.writeHead(403).end('forbidden');
    return;
  }
  let size: number;
  try {
    const stats = statSync(file);
    if (!stats.isFile()) throw new Error('not a file');
    size = stats.size;
  } catch {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': contentType(file),
    'content-length': size,
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => {
  console.log('game/ is on http://localhost:' + port);
});
