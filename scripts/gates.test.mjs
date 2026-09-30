// The gates this repo defines and the gates CI runs have to be the same gates.
//
// shared-workflows now prefers this repo's own script for i18n, codegen,
// Expo doctor, the audit and the CI linters, falling back to its own only when
// we ship none (scripts/checks/run-consumer-or.sh over there). That makes these
// scripts load-bearing in CI, so the properties below are no longer a local
// style preference.
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

// Every script name shared-workflows' check-code.yml and check-unit.yml ask this
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

  test('deps:check reports Expo SDK drift instead of failing on it', () => {
    // Expo patches most weeks and minimumReleaseAge holds each patch for a
    // day; a blocking drift check turned every open PR red for that day and
    // skipped unit and E2E behind it. scripts/check-deps.sh says the rest.
    assert.equal(pkg.scripts['deps:check'], 'bash scripts/check-deps.sh');
    const script = readFileSync(new URL('./check-deps.sh', import.meta.url), 'utf8');
    assert.match(script, /EXPO_DOCTOR_SKIP_DEPENDENCY_VERSION_CHECK=1 pnpm deps:doctor/);
    assert.equal(pkg.scripts['deps:doctor'], 'expo-doctor');
    assert.match(script, /expo install --check/);
    assert.match(
      script,
      /\|\| drift_status=\$\?/,
      'the drift exit code is captured, never propagated',
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
  assert.match(src, /find scripts \.claude\/skills -name '\*\.sh' -exec shellcheck -x \{\} \+/);
  assert.doesNotMatch(
    src,
    /scripts\/\*\/\*\//,
    'shellcheck.sh is back to a fixed-depth glob and will skip deeper scripts',
  );
});

// Six guards and the version script are not ours any more: they come from
// @blinkbitcoin/dev-config, at the commit the workflows pin. A copy deleted in
// favour of a bin is only as good as the call that replaced it, so each call is
// pinned here, in the gate CI runs it from: `check:ci` (make check-ci) and
// `check:docs` (make check-docs) run on every change in the Checks job.
describe('the shared tooling guards run where CI runs them', () => {
  const PACKAGE = 'node_modules/@blinkbitcoin/dev-config';
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

  const code = (rel) =>
    read(rel)
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
  const makefile = read('Makefile');

  test('the recipe reader stops at the next target', () => {
    const sample = 'a: ## A\n\tone\n\ttwo\n\nb: ## B\n\tthree\n';
    assert.equal(recipe(sample, 'a'), '\tone\n\ttwo');
    assert.equal(recipe(sample, 'b'), '\tthree');
  });

  test('make check-ci runs the shell locale and workflow name guards', () => {
    const ci = recipe(makefile, 'check-ci');
    assert.match(ci, /pnpm exec check-shell-locale/);
    assert.match(ci, /pnpm exec check-workflow-names --group ci=CI --group cd=CD/);
  });

  test('check-docs.sh runs the tables, diagrams and make target name guards', () => {
    const docs = code('scripts/check-docs.sh');
    assert.match(docs, /pnpm exec check-docs-tables/);
    assert.match(
      docs,
      /if \[ -n "\$\{EVENT_NAME:-\}" \]; then\n\s*pnpm exec check-diagrams --all\nelse\n\s*pnpm exec check-diagrams\n/,
      'check-diagrams must check every diagram under CI (EVENT_NAME set)',
    );
    assert.match(docs, /pnpm exec check-make-target-names \\\n\s*--allow 'gen-graphql=\S/);
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
