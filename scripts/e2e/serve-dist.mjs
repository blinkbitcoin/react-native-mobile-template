#!/usr/bin/env node
// A preview server shaped like GitHub Pages, for the Playwright suite.
//
// `expo serve dist` serves at `/` and has no base-path option, but a deploy
// export is built for `/<repo>/` (EXPO_PUBLIC_BASE_URL -> experiments.baseUrl)
// and every path in it carries that prefix. Served at `/`, the page shell
// renders and the bundle 404s. This serves `dist` under the base path, the
// way Pages does, and mirrors the two Pages behaviours the app depends on:
// `/settings` resolves to `settings.html`, and a path with no file - a deep
// link into a dynamic route such as `/details/42` - gets `404.html` with a
// 404 status, which is the not-found page doubling as the app shell so the
// router can boot from the real URL.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

/** Trailing slashes off, exactly one leading slash on; '' for the root. */
export function normalizeBasePath(raw) {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  if (trimmed === '') return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/**
 * Maps a request path to a file under `dist`, or to the 404 page.
 * Returns { file, status } where file is absolute, or null when the path is
 * outside the base path (Pages would serve another site there).
 */
export function resolveRequest(dist, basePath, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  if (basePath && decoded !== basePath && !decoded.startsWith(`${basePath}/`)) return null;
  let rel = basePath ? decoded.slice(basePath.length) : decoded;
  if (rel === '' || rel === '/') rel = '/index.html';
  // Never above dist: the resolved candidate must stay inside it.
  const candidate = path.resolve(dist, `.${rel}`);
  if (!candidate.startsWith(`${path.resolve(dist)}${path.sep}`))
    return { file: path.join(dist, '404.html'), status: 404 };
  const tries = [candidate, `${candidate}.html`, path.join(candidate, 'index.html')];
  for (const file of tries) {
    if (existsSync(file) && statSync(file).isFile()) return { file, status: 200 };
  }
  return { file: path.join(dist, '404.html'), status: 404 };
}

export function startServer({ dist, basePath, port }) {
  const server = createServer((req, res) => {
    const hit = resolveRequest(dist, basePath, req.url ?? '/');
    if (!hit || !existsSync(hit.file)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(hit.status, {
      'content-type': TYPES[path.extname(hit.file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(hit.file).pipe(res);
  });
  server.listen(port);
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const dist = path.join(root, 'dist');
  const basePath = normalizeBasePath(process.env.EXPO_PUBLIC_BASE_URL);
  const port = Number(process.env.WEB_PREVIEW_PORT);
  if (!port) {
    console.error('WEB_PREVIEW_PORT is not set; run through scripts/e2e/web.sh');
    process.exit(1);
  }
  startServer({ dist, basePath, port });
  console.log(`serving ${dist} at http://localhost:${port}${basePath || '/'} (404 -> 404.html)`);
}
