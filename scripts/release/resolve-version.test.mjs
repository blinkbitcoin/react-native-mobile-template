import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./resolve-version.sh', import.meta.url));
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/**
 * Builds a throwaway git repo with `commits` commits; `tags` maps a 1-based
 * commit index to a tag name or an array of tag names.
 */
function fixtureRepo(commits, tags = {}, subjects = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'resolve-version-'));
  roots.push(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  for (let i = 1; i <= commits; i += 1) {
    git('commit', '--quiet', '--allow-empty', '-m', subjects[i] ?? `commit ${i}`);
    for (const tag of [tags[i] ?? []].flat()) git('tag', tag);
  }
  return root;
}

/** Runs the script against `cwd` and parses its KEY=VALUE stdout. */
function resolve(cwd, env = {}) {
  const stdout = execFileSync('bash', [script, cwd], {
    encoding: 'utf8',
    // A stray GH_TOKEN/GITHUB_OUTPUT in the ambient environment would make the
    // script hit the network or append to a real file, so both are cleared.
    env: { ...process.env, GH_TOKEN: '', GITHUB_OUTPUT: '', RELEASE_PR_TITLE: '', ...env },
  });
  return Object.fromEntries(
    stdout
      .trim()
      .split('\n')
      .map((line) => line.split('=')),
  );
}

test('no tags falls back to 0.0.1', () => {
  assert.equal(resolve(fixtureRepo(1)).APP_VERSION, '0.0.1');
});

test('a tag on an older commit bumps the patch', () => {
  assert.equal(resolve(fixtureRepo(3, { 1: 'v1.4.2' })).APP_VERSION, '1.4.3');
});

test('a tag on HEAD is used exactly', () => {
  assert.equal(resolve(fixtureRepo(3, { 3: 'v1.4.2' })).APP_VERSION, '1.4.2');
});

test('a release-please PR title wins over the tag fallback', () => {
  const repo = fixtureRepo(3, { 1: 'v1.4.2' });
  const env = { RELEASE_PR_TITLE: 'chore(main): release 1.5.0' };
  assert.equal(resolve(repo, env).APP_VERSION, '1.5.0');
});

test('a tag on HEAD wins over a release-please PR title', () => {
  const repo = fixtureRepo(3, { 3: 'v2.0.0' });
  const env = { RELEASE_PR_TITLE: 'chore(main): release 1.5.0' };
  assert.equal(resolve(repo, env).APP_VERSION, '2.0.0');
});

test('the release commit is stamped with the version it releases, not patch+1', () => {
  // The commit that merges release-please's PR: the vX.Y.Z tag does not exist
  // yet (release-please and release-internal are triggered by the same push and
  // run concurrently), RELEASE_PR_TITLE is empty on a push, and the pending PR
  // has just been merged. Without the subject source this resolves to 1.4.3 and
  // beta then looks for a v1.5.0-build.N pre-release nothing ever created.
  const repo = fixtureRepo(3, { 1: 'v1.4.2' }, { 3: 'chore(main): release 1.5.0' });
  assert.equal(resolve(repo).APP_VERSION, '1.5.0');
});

test('the release subject also carries the first release of a repo with no tags', () => {
  const repo = fixtureRepo(2, {}, { 2: 'chore(main): release 0.1.0' });
  assert.equal(resolve(repo).APP_VERSION, '0.1.0');
});

test('a tag on HEAD still wins over the release subject', () => {
  const repo = fixtureRepo(3, { 3: 'v2.0.0' }, { 3: 'chore(main): release 1.5.0' });
  assert.equal(resolve(repo).APP_VERSION, '2.0.0');
});

test('the release subject wins over an open release-please PR title', () => {
  // Ordering matters: on the release commit the pending PR lookup would find
  // the *next* release's PR if release-please has already opened one.
  const repo = fixtureRepo(3, { 1: 'v1.4.2' }, { 3: 'chore(main): release 1.5.0' });
  assert.equal(
    resolve(repo, { RELEASE_PR_TITLE: 'chore(main): release 1.6.0' }).APP_VERSION,
    '1.5.0',
  );
});

test('an ordinary commit subject does not look like a release', () => {
  for (const subject of [
    'feat: release 9.9.9 notes',
    'chore(main): release notes',
    'Merge pull request #12 from chore(main): release 9.9.9',
  ]) {
    const repo = fixtureRepo(2, { 1: 'v1.4.2' }, { 2: subject });
    assert.equal(resolve(repo).APP_VERSION, '1.4.3', `subject ${subject} was read as a release`);
  }
});

test('build number is the first-parent commit count plus the default offset', () => {
  assert.equal(resolve(fixtureRepo(3)).APP_BUILD_NUMBER, '1003');
});

test('BUILD_NUMBER_OFFSET overrides the default offset', () => {
  const result = resolve(fixtureRepo(2), { BUILD_NUMBER_OFFSET: '5000' });
  assert.equal(result.APP_BUILD_NUMBER, '5002');
});

test('non-semver tags are ignored when picking the last tag', () => {
  assert.equal(resolve(fixtureRepo(2, { 1: 'nightly' })).APP_VERSION, '0.0.1');
});

test('a prerelease tag is ignored in favour of the newest release tag', () => {
  // `v1.4.2-rc.1` sorts above `v1.4.2` under -v:refname, so an unfiltered
  // last-tag lookup would feed "1.4.2-rc.1" to the patch arithmetic, fail it,
  // and emit an empty APP_VERSION with exit code 0.
  const repo = fixtureRepo(3, { 1: 'v1.4.2', 2: 'v1.4.2-rc.1' });
  assert.equal(resolve(repo).APP_VERSION, '1.4.3');
});

test('tags that are not plain vX.Y.Z never produce an empty version', () => {
  // Every shape that the loose `v[0-9]*` glob would have let through.
  for (const tag of ['v1.4.2-rc.1', 'v1.2.3+build', 'v1.2', 'v1']) {
    const result = resolve(fixtureRepo(2, { 1: tag }));
    assert.match(result.APP_VERSION, /^\d+\.\d+\.\d+$/, `tag ${tag} produced a bad version`);
    assert.equal(result.APP_VERSION, '0.0.1', `tag ${tag} should not count as a release`);
  }
});

test('a repo the script cannot resolve fails instead of emitting an empty version', () => {
  // No commits at all: `git rev-list HEAD` fails, `set -e` aborts, and nothing
  // is printed. The contract is that an unresolvable repo is never reported as
  // a successful build with a blank version.
  const root = mkdtempSync(path.join(tmpdir(), 'resolve-version-'));
  roots.push(root);
  execFileSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: root, stdio: 'pipe' });
  assert.throws(
    () =>
      execFileSync('bash', [script, root], {
        encoding: 'utf8',
        env: { ...process.env, GH_TOKEN: '', GITHUB_OUTPUT: '', RELEASE_PR_TITLE: '' },
        stdio: 'pipe',
      }),
    (error) => error.status !== 0 && !String(error.stdout).includes('APP_VERSION='),
  );
});
