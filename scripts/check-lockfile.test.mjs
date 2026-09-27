import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./check-lockfile.sh', import.meta.url));
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const INTEGRITY =
  'sha512-bWWwypLpGrS1Aq9v6Mtc/YFIuf6zizgwhhyI+RHoqw3ll16RfrcS1u6WZhgf8yahRZUOlTgPngu5gB1PnV3anA==';
const REGISTRY = `    resolution: {integrity: ${INTEGRITY}}`;

/** A directory holding a pnpm-lock.yaml whose packages resolve as `resolutions`. */
function lockfileDir(...resolutions) {
  const dir = mkdtempSync(path.join(tmpdir(), 'check-lockfile-'));
  roots.push(dir);
  const packages = resolutions.map((line, i) => `  pkg-${i}@1.0.0:\n${line}\n`).join('\n');
  writeFileSync(
    path.join(dir, 'pnpm-lock.yaml'),
    `lockfileVersion: '9.0'\n\npackages:\n\n${packages}`,
  );
  return dir;
}

function check(...args) {
  return spawnSync('bash', [script, ...args], { encoding: 'utf8' });
}

test("this repository's own lockfile passes", () => {
  const result = check();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /lockfile ok/);
});

test('registry packages pass, with or without an explicit registry tarball', () => {
  const result = check(
    lockfileDir(
      REGISTRY,
      `    resolution: {integrity: ${INTEGRITY}, tarball: https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz}`,
    ),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /lockfile ok/);
});

for (const [name, line] of [
  [
    "a git dependency in pnpm 12's gitHosted shape",
    `    resolution: {gitHosted: true, integrity: ${INTEGRITY}, path: /packages/x, tarball: https://codeload.github.com/o/r/tar.gz/0123456789abcdef0123456789abcdef01234567}`,
  ],
  [
    'a git dependency in the type: git shape',
    '    resolution: {commit: 0123456789abcdef0123456789abcdef01234567, repo: https://github.com/o/r.git, type: git}',
  ],
  [
    'a tarball outside registry.npmjs.org',
    `    resolution: {integrity: ${INTEGRITY}, tarball: https://example.com/pkg.tgz}`,
  ],
  [
    'a registry tarball with no integrity hash',
    '    resolution: {tarball: https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz}',
  ],
  ['a local directory', '    resolution: {directory: ../pkg, type: directory}'],
]) {
  test(`${name} fails, naming the line`, () => {
    const result = check(lockfileDir(REGISTRY, line));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /outside the npm registry/);
    assert.ok(result.stderr.includes(line.trim()), result.stderr);
    assert.ok(!result.stderr.includes(REGISTRY.trim()), 'the registry package was reported too');
  });
}

test('a directory with no lockfile fails', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'check-lockfile-'));
  roots.push(dir);
  const result = check(dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no pnpm-lock\.yaml/);
});
