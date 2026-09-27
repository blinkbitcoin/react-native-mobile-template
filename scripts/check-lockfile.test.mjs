import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

/** Gives `dir` a ci.yml calling shared-workflows once at each of `pins`. */
function withPins(dir, ...pins) {
  mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
  const calls = pins.map(
    (pin, i) =>
      `  job-${i}:\n    uses: blinkbitcoin/shared-workflows/.github/workflows/check-code.yml@${pin} # v0.14.0\n`,
  );
  writeFileSync(path.join(dir, '.github', 'workflows', 'ci.yml'), `jobs:\n${calls.join('')}`);
  return dir;
}

const PIN = '53689ee348f2b077d9c474d0e8e7c7fb0b37c83f';
const OTHER = '0123456789abcdef0123456789abcdef01234567';
/** The shared tooling package's resolution, as pnpm 12 writes it. */
const tooling = ({
  commit = PIN,
  repository = 'blinkbitcoin/shared-workflows',
  subdirectory = '/packages/dev-config',
} = {}) =>
  `    resolution: {gitHosted: true, integrity: ${INTEGRITY}, path: ${subdirectory}, tarball: https://codeload.github.com/${repository}/tar.gz/${commit}}`;

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

test('the shared tooling package at the commit the workflows pin passes', () => {
  const result = check(withPins(lockfileDir(REGISTRY, tooling()), PIN, PIN));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /lockfile ok/);
});

for (const [name, line, pins] of [
  ['at a commit the workflows do not pin', tooling({ commit: OTHER }), [PIN]],
  ['from another repository', tooling({ repository: 'someone-else/other' }), [PIN]],
  [
    'from another directory of shared-workflows',
    tooling({ subdirectory: '/packages/other' }),
    [PIN],
  ],
  ['when no workflow pins shared-workflows', tooling(), []],
  ['when the workflows pin two commits', tooling(), [PIN, OTHER]],
]) {
  test(`the shared tooling package ${name} fails`, () => {
    const result = check(withPins(lockfileDir(REGISTRY, line), ...pins));
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(line.trim()), result.stderr);
  });
}

test('a second git dependency beside the allowed one fails, and only it is named', () => {
  const second = tooling({ repository: 'someone-else/other' });
  const result = check(withPins(lockfileDir(tooling(), second), PIN));
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(second.trim()), result.stderr);
  assert.ok(!result.stderr.includes(tooling().trim()), 'the allowed package was reported too');
});
