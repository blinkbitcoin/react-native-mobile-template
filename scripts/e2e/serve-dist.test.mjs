import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { normalizeBasePath, resolveRequest, startServer } from './serve-dist.mjs';

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
