import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  lockedVersion,
  main,
  PACKAGE,
  toolingProblems,
  toolingSpec,
  workflowsPin,
} from './tooling-pin.mjs';

const script = fileURLToPath(new URL('./tooling-pin.mjs', import.meta.url));
const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const PIN = '53689ee348f2b077d9c474d0e8e7c7fb0b37c83f';
const OTHER = '0123456789abcdef0123456789abcdef01234567';

/** A lockfile resolving the package at `commit`, in pnpm's importer shape. */
const lockfileAt = (commit) =>
  `importers:\n  .:\n    devDependencies:\n      '${PACKAGE}':\n        specifier: ${toolingSpec(commit)}\n        version: ${lockedVersion(commit)}\n`;

/**
 * A repository whose workflows call shared-workflows at `pins`, whose
 * package.json takes the package as `spec` (none when null) and whose
 * lockfile is `lockfile`.
 */
function repo({ pins = [PIN], spec = toolingSpec(PIN), lockfile = lockfileAt(PIN) } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'tooling-pin-'));
  roots.push(root);
  const workflows = path.join(root, '.github', 'workflows');
  mkdirSync(workflows, { recursive: true });
  pins.forEach((pin, i) => {
    writeFileSync(
      path.join(workflows, `ci-${i}.yml`),
      `jobs:\n  checks:\n    uses: blinkbitcoin/shared-workflows/.github/workflows/check-code.yml@${pin} # v0.14.0\n`,
    );
  });
  writeFileSync(
    path.join(workflows, 'README.md'),
    `uses: blinkbitcoin/shared-workflows/.github/workflows/x.yml@${OTHER}\n`,
  );
  const devDependencies = {
    lefthook: '^2.1.14',
    ...(spec === null ? {} : { [PACKAGE]: spec }),
  };
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'app', devDependencies }, null, 2)}\n`,
  );
  writeFileSync(path.join(root, 'pnpm-lock.yaml'), lockfile);
  return root;
}

const manifest = (root) => JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

test('the spec and the locked version name shared-workflows, the commit and the package directory', () => {
  assert.equal(
    toolingSpec(PIN),
    `github:blinkbitcoin/shared-workflows#${PIN}&path:/packages/dev-config`,
  );
  assert.equal(
    lockedVersion(PIN),
    `https://codeload.github.com/blinkbitcoin/shared-workflows/tar.gz/${PIN}#path:/packages/dev-config`,
  );
});

test('the workflows pin is the one commit their shared calls use; other files are not read', () => {
  assert.equal(workflowsPin(repo({ pins: [PIN, PIN] })), PIN);
});

test('workflows that pin no commit, or two, have no pin to follow', () => {
  assert.throws(() => workflowsPin(repo({ pins: [] })), /exactly one commit, and pin none/);
  assert.throws(
    () => workflowsPin(repo({ pins: [PIN, OTHER] })),
    new RegExp(`pin ${PIN}, ${OTHER}`),
  );
});

test('package.json and the lockfile at the pin have no problems', () => {
  assert.deepEqual(toolingProblems(repo()), []);
});

test('a package.json without the package, or at another commit, is a problem naming the fix', () => {
  const [missing] = toolingProblems(repo({ spec: null }));
  assert.ok(missing.includes(`takes ${PACKAGE} as nothing, but the workflows pin`), missing);
  assert.match(missing, /make fix-tooling-pin/);
  const [stale] = toolingProblems(repo({ spec: toolingSpec(OTHER) }));
  assert.match(
    stale,
    new RegExp(`as ${toolingSpec(OTHER).replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
  );
});

test('a lockfile resolving the package at another commit is a problem', () => {
  assert.deepEqual(toolingProblems(repo({ lockfile: lockfileAt(OTHER) })), [
    `pnpm-lock.yaml does not resolve ${PACKAGE} at ${PIN}: run \`make fix-tooling-pin\``,
  ]);
});

test('main repoints package.json at the pin, installs, and reports the pin', () => {
  const root = repo({ spec: toolingSpec(OTHER), lockfile: lockfileAt(OTHER) });
  const calls = [];
  const logs = [];
  const exec = (command, args, options) => {
    calls.push([command, args, options.cwd]);
    writeFileSync(path.join(root, 'pnpm-lock.yaml'), lockfileAt(PIN));
  };
  const code = main(root, { log: (line) => logs.push(line), error: assert.fail, exec });
  assert.equal(code, 0);
  assert.deepEqual(calls, [['pnpm', ['install'], root]]);
  assert.equal(manifest(root).devDependencies[PACKAGE], toolingSpec(PIN));
  assert.equal(
    manifest(root).devDependencies.lefthook,
    '^2.1.14',
    'another dependency was changed',
  );
  assert.deepEqual(logs, [`${PACKAGE} is at the workflows pin, ${PIN}`]);
});

test('main fails, naming what is still wrong, when the install leaves the lockfile behind', () => {
  const root = repo({ spec: null, lockfile: '' });
  const errors = [];
  const code = main(root, { log: assert.fail, error: (line) => errors.push(line), exec: () => {} });
  assert.equal(code, 1);
  assert.deepEqual(errors, [
    `pnpm-lock.yaml does not resolve ${PACKAGE} at ${PIN}: run \`make fix-tooling-pin\``,
  ]);
});

test('main changes nothing when the workflows have no single pin', () => {
  const root = repo({ pins: [PIN, OTHER], spec: toolingSpec(OTHER) });
  const errors = [];
  const code = main(root, {
    log: assert.fail,
    error: (line) => errors.push(line),
    exec: assert.fail,
  });
  assert.equal(code, 1);
  assert.match(errors[0], /exactly one commit/);
  assert.equal(manifest(root).devDependencies[PACKAGE], toolingSpec(OTHER));
});

test('run as a script it takes the repository from its argument and exits with main', () => {
  const empty = mkdtempSync(path.join(tmpdir(), 'tooling-pin-'));
  roots.push(empty);
  const result = spawnSync(process.execPath, [script, empty], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no such file or directory/);
});
