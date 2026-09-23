import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { main, normalizeBasePath, resolveRequest, startServer } from './serve-dist.mjs';

let dist;
let server;
let port;

before(async () => {
  dist = mkdtempSync(path.join(tmpdir(), 'serve-dist-'));
  mkdirSync(path.join(dist, 'details'));
  writeFileSync(path.join(dist, 'index.html'), 'home');
  writeFileSync(path.join(dist, 'settings.html'), 'settings');
  writeFileSync(path.join(dist, '404.html'), 'not-found shell');
  writeFileSync(path.join(dist, 'details', '[id].html'), 'details');
  server = startServer({ dist, basePath: '/repo', port: 0 });
  await new Promise((resolve) => server.once('listening', resolve));
  port = server.address().port;
});

after(() => {
  server.close();
  rmSync(dist, { recursive: true, force: true });
});

test('normalizes the base path the way Pages needs it', () => {
  assert.equal(normalizeBasePath(undefined), '');
  assert.equal(normalizeBasePath(''), '');
  assert.equal(normalizeBasePath('/repo'), '/repo');
  assert.equal(normalizeBasePath('repo/'), '/repo');
});

test('resolves the root, an html route and a directory index', () => {
  assert.equal(resolveRequest(dist, '/repo', '/repo').file, path.join(dist, 'index.html'));
  assert.equal(resolveRequest(dist, '/repo', '/repo/').file, path.join(dist, 'index.html'));
  assert.equal(
    resolveRequest(dist, '/repo', '/repo/settings').file,
    path.join(dist, 'settings.html'),
  );
  assert.equal(resolveRequest(dist, '', '/settings').file, path.join(dist, 'settings.html'));
});

test('a path with no file gets 404.html with a 404, like Pages', () => {
  const hit = resolveRequest(dist, '/repo', '/repo/details/42');
  assert.equal(hit.file, path.join(dist, '404.html'));
  assert.equal(hit.status, 404);
});

test('a path outside the base path is not this site', () => {
  assert.equal(resolveRequest(dist, '/repo', '/settings'), null);
  assert.equal(resolveRequest(dist, '/repo', '/repository/x'), null);
});

test('a path that escapes dist is answered with the 404 page, not a file', () => {
  const hit = resolveRequest(dist, '', '/../serve-dist.mjs');
  assert.equal(hit.file, path.join(dist, '404.html'));
});

test('serves over http with the status Pages would send', async () => {
  const get = (p) => fetch(`http://localhost:${port}${p}`);
  assert.equal((await get('/repo/')).status, 200);
  assert.equal(await (await get('/repo/settings')).text(), 'settings');
  const deep = await get('/repo/details/42');
  assert.equal(deep.status, 404);
  assert.equal(await deep.text(), 'not-found shell');
  assert.equal((await get('/elsewhere')).status, 404);
});

test('an unknown extension is served as a plain byte stream', async () => {
  writeFileSync(path.join(dist, 'data.bin'), 'bytes');
  const response = await fetch(`http://localhost:${port}/repo/data.bin`);
  assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.equal(await response.text(), 'bytes');
});

test('a missing 404 page is answered with plain text', async () => {
  const bare = mkdtempSync(path.join(tmpdir(), 'serve-dist-bare-'));
  const plain = startServer({ dist: bare, basePath: '', port: 0 });
  try {
    await new Promise((resolve) => plain.once('listening', resolve));
    const response = await fetch(`http://localhost:${plain.address().port}/nothing`);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), 'not found');
  } finally {
    plain.close();
    rmSync(bare, { recursive: true, force: true });
  }
});

test('a request without a url is treated as the root', () => {
  // Node always sets req.url for a real request; the fallback guards the
  // handler's contract, so exercise it by handing the handler a bare request.
  const written = {};
  const response = {
    writeHead: (status, headers) => Object.assign(written, { status, headers }),
    end: (body) => Object.assign(written, { body }),
  };
  server.emit('request', {}, response);
  // The root is outside the /repo base path, so Pages would serve another site.
  assert.deepEqual(written, {
    status: 404,
    headers: { 'content-type': 'text/plain' },
    body: 'not found',
  });
});

/** Runs `main` with a fake server start and captures what it writes. */
const runMain = (env) => {
  const started = [];
  const out = [];
  const err = [];
  const code = main({
    env,
    root: '/checkout',
    start: (options) => started.push(options),
    log: (line) => out.push(line),
    error: (line) => err.push(line),
  });
  return { code, started, out, err };
};

test('main serves dist under the base path on the preview port', () => {
  const previewPort = String(port);
  const { code, started, out, err } = runMain({
    WEB_PREVIEW_PORT: previewPort,
    EXPO_PUBLIC_BASE_URL: 'repo/',
  });
  assert.equal(code, 0);
  assert.deepEqual(started, [
    { dist: path.join('/checkout', 'dist'), basePath: '/repo', port: Number(previewPort) },
  ]);
  assert.deepEqual(out, [
    `serving /checkout/dist at http://localhost:${previewPort}/repo (404 -> 404.html)`,
  ]);
  assert.deepEqual(err, []);
});

test('main without a base path serves at the root', () => {
  const { out } = runMain({ WEB_PREVIEW_PORT: String(port) });
  assert.match(out[0], /^serving \/checkout\/dist at http:\/\/localhost:\d+\/ \(404/);
});

test('main without a preview port starts nothing and exits 1', () => {
  const { code, started, err } = runMain({});
  assert.equal(code, 1);
  assert.deepEqual(started, []);
  assert.deepEqual(err, ['WEB_PREVIEW_PORT is not set; run through scripts/e2e/web.sh']);
});

test('as a command it refuses to start without a preview port', () => {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'serve-dist.mjs');
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    // The rest of the environment is kept so NODE_V8_COVERAGE counts the child.
    env: { ...process.env, WEB_PREVIEW_PORT: '' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /WEB_PREVIEW_PORT is not set/);
});
