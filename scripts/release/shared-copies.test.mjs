// This repo ships its own copies of two release scripts that shared-workflows
// also ships: `resolve-version.sh` (run locally by `make version`, while
// build-prepare.yml runs the shared copy in CI) and `build-info.sh` (the local
// DRY_RUN rehearsal, while CI writes the release's build-info.json with the
// shared copy). The two copies are contract-identical, not byte-identical, and
// a drift between them means a local rehearsal that says one thing and a
// release that does another.
//
// These cases compare our copy with shared-workflows' copy. They live here, not
// over there: shared-workflows defines the contract and never checks out a
// consumer, and it is this repo that has to follow. In CI the shared copy is the
// one this run's workflows were called at - the setup action checks it out at
// $WORKFLOWS_DIR - so the Dependabot PR moving the pin is also when a drift turns red here.
//
// Locally there is no $WORKFLOWS_DIR unless you point it at a checkout
// (`WORKFLOWS_DIR=../shared-workflows make test-scripts`), and the cases skip
// saying so. In CI a missing $WORKFLOWS_DIR fails: a comparison that silently
// ran against nothing is the failure these cases exist to prevent.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = (name) => fileURLToPath(new URL(`./${name}`, import.meta.url));
const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** The shared-workflows copy of `name`, or a reason the comparison cannot run. */
function sharedCopy(name) {
  const dir = process.env.WORKFLOWS_DIR;
  if (!dir) {
    if (process.env.GITHUB_ACTIONS === 'true') {
      throw new Error(
        'WORKFLOWS_DIR is not set in CI - the setup action exports it; without it the copies were NOT compared',
      );
    }
    return {
      skip: 'WORKFLOWS_DIR not set: our copy was NOT compared with shared-workflows (set it to a checkout to compare)',
    };
  }
  // Resolved here: the scripts run with the fixture repository as their working
  // directory, where a relative WORKFLOWS_DIR would point at nothing.
  const file = path.resolve(dir, 'scripts', 'release', name);
  if (!existsSync(file)) throw new Error(`no shared copy at ${file}`);
  return { file };
}

function tempDir(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

/**
 * The merge-commit shape: with "Create a merge commit" as the merge method,
 * HEAD is `Merge pull request #N from ...` and the release commit is its second
 * parent. It is where the two implementations are most likely to differ.
 */
function mergeReleaseFixture() {
  const repo = tempDir('shared-copies-');
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  git('commit', '--quiet', '--allow-empty', '-m', 'commit 1');
  git('tag', 'v1.1.1');
  git('checkout', '--quiet', '-b', 'release-please--branches--main');
  git('commit', '--quiet', '--allow-empty', '-m', 'chore(main): release 1.2.0');
  git('checkout', '--quiet', 'main');
  git(
    'merge',
    '--quiet',
    '--no-ff',
    '-m',
    'Merge pull request #12 from release-please--branches--main',
    'release-please--branches--main',
  );
  return repo;
}

// Everything a copy writes: the APP_* lines on stdout, $GITHUB_OUTPUT, and
// $GITHUB_ENV, which neither copy may write. GITHUB_OUTPUT is set for both
// because with it unset the shared copy also prints its outputs to stdout.
function runResolve(script, repo, env = {}) {
  const out = path.join(tempDir('out-'), 'out');
  const envFile = path.join(tempDir('env-'), 'env');
  writeFileSync(out, '');
  writeFileSync(envFile, '');
  const result = spawnSync('bash', [script, repo], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      GH_TOKEN: '',
      RELEASE_PR_TITLE: '',
      GITHUB_REF_NAME: '',
      WORKFLOWS_RELEASE_SCOPE: '',
      BUILD_NUMBER_OFFSET: '',
      GITHUB_OUTPUT: out,
      GITHUB_ENV: envFile,
      ...env,
    },
  });
  const sorted = (file) => readFileSync(file, 'utf8').split('\n').filter(Boolean).sort();
  return {
    status: result.status,
    stdout: result.stdout
      .split('\n')
      .filter((line) => line.startsWith('APP_'))
      .join('\n'),
    output: sorted(out),
    env: sorted(envFile),
  };
}

test('resolve-version.sh: our copy and shared-workflows agree on the merge-commit fixture', (t) => {
  const shared = sharedCopy('resolve-version.sh');
  if (shared.skip) return t.skip(shared.skip);
  const repo = mergeReleaseFixture();
  const ours = runResolve(here('resolve-version.sh'), repo);
  const theirs = runResolve(shared.file, repo);
  assert.equal(ours.status, 0, 'our copy failed');
  assert.equal(theirs.status, 0, 'the shared copy failed');
  assert.match(
    ours.stdout,
    /APP_VERSION=1\.2\.0/,
    'the fixture did not exercise the merge-commit source',
  );
  assert.equal(ours.stdout, theirs.stdout, 'the two copies disagree on stdout');
  assert.deepEqual(ours.output, theirs.output, 'the two copies disagree on $GITHUB_OUTPUT');
  assert.deepEqual(ours.env, [], 'our copy wrote $GITHUB_ENV');
  assert.deepEqual(theirs.env, [], 'the shared copy wrote $GITHUB_ENV');
});

// A typo'd offset read as 0 sends the build number backwards, which a store
// rejects permanently. The copies drifted here once; both must refuse it.
test('resolve-version.sh: our copy and shared-workflows both refuse a non-numeric offset', (t) => {
  const shared = sharedCopy('resolve-version.sh');
  if (shared.skip) return t.skip(shared.skip);
  const repo = mergeReleaseFixture();
  assert.notEqual(
    runResolve(here('resolve-version.sh'), repo, { BUILD_NUMBER_OFFSET: 'abc' }).status,
    0,
    'our copy accepted it',
  );
  assert.notEqual(
    runResolve(shared.file, repo, { BUILD_NUMBER_OFFSET: 'abc' }).status,
    0,
    'the shared copy accepted it',
  );
});

// build-info.sh shells out to @expo/fingerprint, so running the shared copy
// here would need its own node_modules. What drifted before is caught from the
// source: a key added, renamed or dropped on one side, and the choice of
// installed over declared versions.
test('build-info.sh: our copy and shared-workflows write the same keys and read installed versions', (t) => {
  const shared = sharedCopy('build-info.sh');
  if (shared.skip) return t.skip(shared.skip);
  // The record is one object literal indented two spaces inside a node program
  // in both copies, so its top-level keys are the two-space `key:` lines.
  const keys = (file) =>
    [...readFileSync(file, 'utf8').matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*):/gm)].map((m) => m[1]);
  const ours = here('build-info.sh');
  assert.deepEqual(keys(ours), keys(shared.file), 'the two copies write different top-level keys');
  for (const file of [ours, shared.file]) {
    const text = readFileSync(file, 'utf8');
    assert.match(text, /installed\("expo"\)/, `${file} no longer reads the installed expo version`);
    assert.match(
      text,
      /installed\("react-native"\)/,
      `${file} no longer reads the installed react-native version`,
    );
    assert.match(text, /ios:/, `${file} has no fingerprint.ios`);
    assert.match(text, /android:/, `${file} has no fingerprint.android`);
  }
});
