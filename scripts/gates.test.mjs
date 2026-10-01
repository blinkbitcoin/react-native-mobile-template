// The gates this repo defines and the gates CI runs have to be the same gates.
//
// shared-workflows prefers this repo's own script for generated files, Expo
// health, the audit and the CI linters, falling back to its own only when we
// ship none (scripts/checks/run-consumer-or.sh over there). Where the two would
// do the same thing, ours now calls the shared one from @blinkbitcoin/app-tooling,
// and the tests below pin those calls.
//
// The cross-repo half of this contract - that `make ci` and CI run the same
// gates - is enforced by this repo's own CI: the Checks / Contract job runs
// shared-workflows' contract checker against this repo. What this file checks
// is that the scripts CI asks for exist, and that each is at least as strict as
// the implementation it displaced.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
const pkg = JSON.parse(read('package.json'));

// Every script name shared-workflows' check.yml and test-unit.yml ask this
// consumer for. Adding a CI step that calls a script we do not ship fails the
// step with "consumer package.json has no ... script"; this list is the local
// half of that contract, so the failure arrives in a unit test instead.
const REQUIRED_SCRIPTS = [
  'check:types',
  'check:lint',
  'check:format',
  'check:unused',
  'check:spell',
  'check:docs',
  'check:release',
  'check:ci',
  'check:secrets',
  'check:generated',
  'check:expo-health',
  'check:audit',
  'check:licenses',
  'check:prebuild',
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

  test('knip stays a binary behind check:unused, not a script of its own name', () => {
    // Deliberate: a package.json script literally named `knip` fails
    // expo-doctor's "scripts in package.json conflict with node_modules/.bin"
    // check, and CI runs expo-doctor too.
    assert.equal(pkg.scripts?.knip, undefined);
    assert.match(pkg.scripts['check:unused'], /(^|&& )knip$/);
    assert.ok(pkg.devDependencies?.knip, 'knip must stay a devDependency');
  });

  test('the gates that wrap make say so, rather than duplicating it', () => {
    // The mechanism this family uses to put make into CI: the package script is
    // the interface the reusable workflow calls, make is the implementation.
    for (const name of ['check:docs', 'check:release', 'check:ci', 'check:secrets']) {
      assert.match(pkg.scripts[name], /^make /, `${name} should delegate to a make target`);
    }
  });
});

// The drift, Expo health, licence and lockfile checks are not ours any more
// either: CI's check.yml runs shared-workflows' scripts, and
// @blinkbitcoin/app-tooling ships byte-identical copies or the same programs,
// so the gates below run exactly those. Their behaviour (untracked output
// counts as drift, SDK drift as a warning, the licence allowlist) is tested
// over there.
describe('the generated, Expo health, licence and audit gates run the shared tooling', () => {
  const PACKAGE = 'node_modules/@blinkbitcoin/app-tooling';

  test('check:generated runs the packaged drift check over both generators', () => {
    assert.equal(pkg.scripts['check:generated'], `bash ${PACKAGE}/checks/generated.sh`);
    // What the shared check runs and diffs: Lingui's extract has to compile
    // too, or the committed messages.ts would drift unseen.
    assert.equal(pkg.scripts['gen:i18n'], 'lingui extract --clean && lingui compile');
    assert.match(pkg.scripts['gen:graphql'], /^graphql-codegen /);
  });

  test('check:expo-health runs the packaged check, which reports SDK drift instead of failing on it', () => {
    assert.equal(pkg.scripts['check:expo-health'], `bash ${PACKAGE}/checks/expo-health.sh`);
  });

  test('check:licenses and check:audit run the package programs', () => {
    assert.equal(pkg.scripts['check:licenses'], 'check-licenses');
    assert.match(pkg.scripts['check:audit'], / && check-lockfile$/);
  });

  test('the packaged scripts the gates call are installed', () => {
    for (const rel of [
      'checks/generated.sh',
      'checks/expo-health.sh',
      'checks/secrets.sh',
      'ci/check-ci.sh',
      'hooks/install-if-lockfile-changed.sh',
    ]) {
      assert.ok(existsSync(path.join(root, PACKAGE, rel)), `${PACKAGE}/${rel} is not installed`);
    }
  });
});

// The family's variables were prefixed with the initials of the workflows
// repo's name, and its self-checkout landed in a directory named the same way.
// A reader meeting those in their own app repo had no way to recover the
// expansion. They are spelled out now, and the absence of the old form is
// asserted rather than assumed: the rename touched ~1300 occurrences across two
// repos, which is more than review catches, and a half-finished rename reads
// worse than either name would alone.
//
// The old spelling is built from fragments here so this file does not trip its
// own check - a test that reads its own explanation as a violation is a false
// positive waiting to happen.
test('no trace of the old abbreviated namespace survives', () => {
  const legacy = ['R', 'N', 'W'].join('');
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    // Archives are dated records of what was planned at the time; rewriting
    // them to match today's names would make them lie about their own past.
    .filter((f) => !f.startsWith('docs/superpowers/'))
    // Lock file integrity hashes contain the letters by coincidence.
    .filter((f) => f !== 'pnpm-lock.yaml')
    .filter((f) => f !== 'scripts/gates.test.mjs');

  const offenders = [];
  for (const file of tracked) {
    let src;
    try {
      src = readFileSync(path.join(root, file), 'utf8');
    } catch {
      continue; // a path that is not a readable text file
    }
    if (src.includes(`${legacy}_`) || src.includes(`.${legacy.toLowerCase()}`)) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [], `these still carry the old prefix: ${offenders.join(', ')}`);
});

// The guards, the version script, the pin fixer and the lockfile check are
// not ours any more: they come from @blinkbitcoin/app-tooling, at the commit
// the workflows pin. A copy deleted in favour of a program is only as good as
// the call that replaced it, so each call is pinned here, in the gate CI runs
// it from: `check:ci` (make check-ci), `check:docs` (make check-docs) and
// `test:scripts` run on every change.
describe('the shared tooling guards run where CI runs them', () => {
  const PACKAGE = 'node_modules/@blinkbitcoin/app-tooling';
  const RESOLVE_VERSION = `${PACKAGE}/release/resolve-version.sh`;

  /** The recipe lines of a Makefile target, joined. */
  function recipe(makefile, target) {
    const lines = makefile.split('\n');
    const start = lines.findIndex((line) => line.startsWith(`${target}:`));
    assert.notEqual(start, -1, `the Makefile has no ${target} target`);
    const body = [];
    for (const line of lines.slice(start + 1)) {
      if (!line.startsWith('\t')) break;
      body.push(line);
    }
    return body.join('\n');
  }

  const makefile = read('Makefile');

  test('the recipe reader stops at the next target', () => {
    const sample = 'a: ## A\n\tone\n\ttwo\n\nb: ## B\n\tthree\n';
    assert.equal(recipe(sample, 'a'), '\tone\n\ttwo');
    assert.equal(recipe(sample, 'b'), '\tthree');
  });

  test('make check-ci runs the shared CI lint over scripts and skills, and the locale, workflow name and ignored directory guards', () => {
    const ci = recipe(makefile, 'check-ci');
    assert.match(
      ci,
      new RegExp(
        `^\\tWORKFLOWS_SHELLCHECK_PATHS="scripts \\.claude/skills" bash ${PACKAGE}/ci/check-ci\\.sh$`,
        'm',
      ),
    );
    assert.match(ci, /pnpm exec check-shell-locale/);
    assert.match(ci, /pnpm exec check-workflow-names --group ci=CI --group cd=CD/);
    assert.match(ci, /pnpm exec check-ignored-directories/);
  });

  test('make check-secrets and make fix-tooling-pin run the shared script and program', () => {
    assert.equal(recipe(makefile, 'check-secrets'), `\tbash ${PACKAGE}/checks/secrets.sh`);
    assert.equal(recipe(makefile, 'fix-tooling-pin'), '\tpnpm exec fix-tooling-pin');
  });

  test('make check-docs runs the shared docs check, with the rules in app-tooling.json', () => {
    assert.equal(recipe(makefile, 'check-docs'), '\tpnpm exec check-docs');
    const settings = JSON.parse(read('app-tooling.json'));
    assert.match(settings.docs.allowTargetNames['gen-graphql'], /\S/);
    assert.ok(settings.docs.architecture.includes('Makefile'));
  });

  test('test:scripts starts with the sibling-test guard, whose rules are in app-tooling.json', () => {
    assert.match(pkg.scripts['test:scripts'], /^check-test-siblings && node --test /);
    const settings = JSON.parse(read('app-tooling.json'));
    assert.deepEqual(settings.testSiblings.mirror, { 'src/app/': 'src/__tests__/app/' });
  });

  test('test:coverage runs the empty-row guard from the package', () => {
    assert.match(pkg.scripts['test:coverage'], /&& pnpm check:coverage-empty$/);
    assert.equal(pkg.scripts['check:coverage-empty'], 'check-coverage-empty');
  });

  test('make version resolves the version with the package script', () => {
    assert.match(recipe(makefile, 'version'), new RegExp(`^\\tbash ${RESOLVE_VERSION}$`));
    assert.ok(existsSync(path.join(root, RESOLVE_VERSION)), `${RESOLVE_VERSION} is not installed`);
  });
});
