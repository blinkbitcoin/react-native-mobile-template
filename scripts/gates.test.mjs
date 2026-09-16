// The gates this repo defines and the gates CI runs have to be the same gates.
//
// react-native-workflows now prefers this repo's own script for i18n, codegen,
// Expo doctor, the audit and the CI linters, falling back to its own only when
// we ship none (scripts/checks/run-consumer-or.sh over there). That makes these
// scripts load-bearing in CI, so the properties below are no longer a local
// style preference.
//
// The cross-repo half of this contract is enforced from the workflows repo,
// where the CI step list lives. What is checkable from here is that the scripts
// CI asks for exist, and that each is at least as strict as the implementation
// it displaced.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
const pkg = JSON.parse(read('package.json'));

// Every script name react-native-workflows' checks.yml and unit.yml ask this
// consumer for. Adding a CI step that calls a script we do not ship fails the
// step with "consumer package.json has no ... script"; this list is the local
// half of that contract, so the failure arrives in a unit test instead.
const REQUIRED_SCRIPTS = [
  'typecheck',
  'lint',
  'format:check',
  'spell',
  'check:docs',
  'check:release',
  'check:ci',
  'i18n:check',
  'codegen:check',
  'deps:check',
  'deps:audit',
  'deps:licenses',
  'check-prebuild',
  'check:bundle-secrets',
  'test',
  'test:coverage',
  'test:scripts',
  'build:web',
];

describe('the scripts CI calls', () => {
  test('all exist', () => {
    const missing = REQUIRED_SCRIPTS.filter((name) => !pkg.scripts?.[name]);
    assert.deepEqual(
      missing,
      [],
      `package.json is missing scripts CI calls: ${missing.join(', ')}`,
    );
  });

  test('knip stays a binary, not a script', () => {
    // Deliberate: a package.json script literally named `knip` fails
    // expo-doctor's "scripts in package.json conflict with node_modules/.bin"
    // check, and CI runs expo-doctor too. The binary fallback covers it.
    assert.equal(pkg.scripts?.knip, undefined);
    assert.ok(pkg.devDependencies?.knip, 'knip must stay a devDependency for the binary fallback');
  });

  test('the gates that wrap make say so, rather than duplicating it', () => {
    // The mechanism this family uses to put make into CI: the package script is
    // the interface the reusable workflow calls, make is the implementation.
    for (const name of ['check:docs', 'check:release', 'check:ci', 'check:bundle-secrets']) {
      assert.match(pkg.scripts[name], /^make /, `${name} should delegate to a make target`);
    }
  });
});

describe('the drift-detecting gates catch an untracked file', () => {
  // A `git diff` only sees files git already tracks, so a brand-new catalog or
  // generated document was invisible to these gates and they passed on a tree
  // that was genuinely stale. The workflows repo's fallback always used the
  // stronger form; now that CI runs ours, ours has to as well.
  for (const rel of ['scripts/check-i18n.sh', 'scripts/check-codegen.sh']) {
    test(`${rel} uses git status, not git diff`, () => {
      const src = read(rel);
      assert.match(src, /git status --porcelain/, `${rel} must detect untracked output`);
      assert.doesNotMatch(
        src,
        /git diff --exit-code/,
        `${rel} still gates on git diff, which cannot see an untracked file`,
      );
    });
  }
});

test('shellcheck.sh walks the tree instead of globbing to a fixed depth', () => {
  // `scripts/*.sh scripts/*/*.sh scripts/*/*/*.sh` silently skips anything
  // deeper. This bug has now appeared twice in the family: the workflows repo
  // fixed the same glob in its own Makefile during the esign/kyc port.
  // Comments stripped first: this file's own prose quotes the old glob to
  // explain it, and a test that reads prose as code is a false positive waiting
  // to happen.
  const src = read('scripts/shellcheck.sh')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
  assert.match(src, /find scripts -name '\*\.sh'/);
  assert.doesNotMatch(
    src,
    /scripts\/\*\/\*\//,
    'shellcheck.sh is back to a fixed-depth glob and will skip deeper scripts',
  );
});
