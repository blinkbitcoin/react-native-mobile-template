import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DEPENDENCY_KEYS,
  isStructuralManifestChange,
  main,
  readAtRef,
  readWorkingCopy,
  structuralManifests,
} from './manifest-structural.mjs';

const SCRIPT = fileURLToPath(new URL('./manifest-structural.mjs', import.meta.url));

const base = {
  name: 'app',
  version: '1.0.0',
  packageManager: 'pnpm@12.3.4',
  scripts: { test: 'jest' },
  dependencies: { expo: '54.0.0' },
  devDependencies: { jest: '30.0.0' },
  expo: { install: { exclude: ['react-native'] } },
};

test('an identical manifest is not a structural change', () => {
  assert.equal(isStructuralManifestChange(base, { ...base }), false);
});

test('a dependency bump is not structural', () => {
  assert.equal(
    isStructuralManifestChange(base, { ...base, dependencies: { expo: '54.1.0' } }),
    false,
  );
});

test('an added dependency is not structural', () => {
  assert.equal(
    isStructuralManifestChange(base, {
      ...base,
      devDependencies: { ...base.devDependencies, knip: '5.0.0' },
    }),
    false,
  );
});

test('a version bump is not structural', () => {
  assert.equal(isStructuralManifestChange(base, { ...base, version: '1.1.0' }), false);
});

test('every dependency key is treated as bookkeeping, not structure', () => {
  for (const key of DEPENDENCY_KEYS) {
    assert.equal(
      isStructuralManifestChange({ ...base, [key]: { a: '1' } }, { ...base, [key]: { a: '2' } }),
      false,
      `${key} should not be structural`,
    );
  }
});

test('a scripts change is structural', () => {
  assert.equal(
    isStructuralManifestChange(base, { ...base, scripts: { test: 'jest', 'check:docs': 'x' } }),
    true,
  );
});

test('a packageManager change is structural', () => {
  assert.equal(isStructuralManifestChange(base, { ...base, packageManager: 'pnpm@13.0.0' }), true);
});

test('an engines change is structural', () => {
  assert.equal(isStructuralManifestChange(base, { ...base, engines: { node: '>=24' } }), true);
});

test('an expo.install.exclude change is structural', () => {
  assert.equal(
    isStructuralManifestChange(base, { ...base, expo: { install: { exclude: [] } } }),
    true,
  );
});

test('reordering keys is not a change', () => {
  assert.equal(
    isStructuralManifestChange(base, { scripts: { test: 'jest' }, ...base, name: 'app' }),
    false,
  );
  assert.equal(
    isStructuralManifestChange(base, { ...base, scripts: { test: 'jest', a: undefined } }),
    false,
  );
});

test('an added or deleted manifest is always structural', () => {
  assert.equal(isStructuralManifestChange(undefined, base), true);
  assert.equal(isStructuralManifestChange(base, undefined), true);
  assert.equal(isStructuralManifestChange(undefined, undefined), true);
});

test('structuralManifests keeps only the files whose change is structural', () => {
  const before = { 'a/package.json': base, 'b/package.json': base };
  const after = {
    'a/package.json': { ...base, dependencies: { expo: '54.2.0' } },
    'b/package.json': { ...base, scripts: {} },
  };
  assert.deepEqual(
    structuralManifests(
      Object.keys(before),
      (f) => before[f],
      (f) => after[f],
    ),
    ['b/package.json'],
  );
});

test('readAtRef parses the file git shows at the ref', () => {
  const calls = [];
  const exec = (command, args) => {
    calls.push([command, ...args]);
    return '{"name":"app"}';
  };
  assert.deepEqual(readAtRef('origin/main', 'package.json', exec), { name: 'app' });
  assert.deepEqual(calls, [['git', 'show', 'origin/main:package.json']]);
});

test('readAtRef reads a file absent at the ref as undefined', () => {
  const exec = () => {
    throw new Error('fatal: path does not exist');
  };
  assert.equal(readAtRef('origin/main', 'package.json', exec), undefined);
});

test('readWorkingCopy parses the file, and a missing or broken one is undefined', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'manifest-structural-'));
  try {
    const good = path.join(dir, 'good.json');
    const broken = path.join(dir, 'broken.json');
    writeFileSync(good, '{"name":"app"}');
    writeFileSync(broken, '{');
    assert.deepEqual(readWorkingCopy(good), { name: 'app' });
    assert.equal(readWorkingCopy(broken), undefined);
    assert.equal(readWorkingCopy(path.join(dir, 'absent.json')), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('main without a base ref prints the usage and exits 2', () => {
  const errors = [];
  assert.equal(main([], { error: (line) => errors.push(line) }), 2);
  assert.deepEqual(errors, ['usage: manifest-structural.mjs <base-ref> <package.json>...']);
});

test('main prints only the manifests whose change is structural', () => {
  const printed = [];
  const at = { 'a/package.json': base, 'b/package.json': base };
  const now = {
    'a/package.json': { ...base, version: '2.0.0' },
    'b/package.json': { ...base, scripts: { test: 'vitest' } },
  };
  const seenRefs = [];
  const code = main(['origin/main', 'a/package.json', 'b/package.json'], {
    log: (line) => printed.push(line),
    readAt: (ref, file) => {
      seenRefs.push(ref);
      return at[file];
    },
    readNow: (file) => now[file],
  });
  assert.equal(code, 0);
  assert.deepEqual(printed, ['b/package.json']);
  assert.deepEqual(seenRefs, ['origin/main', 'origin/main']);
});

// The command line, end to end: HEAD against the working copy is offline and
// fast. The environment is inherited so a coverage run sees the child too.
test('as a command it compares against the ref through git', () => {
  const run = (args) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: process.env });
  const usage = run([]);
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /usage: manifest-structural\.mjs/);

  const absent = run(['HEAD', 'no/such/package.json']);
  assert.equal(absent.status, 0, absent.stderr);
  // Missing on both sides still counts as structural (a missing side always does).
  assert.equal(absent.stdout, 'no/such/package.json\n');
});
