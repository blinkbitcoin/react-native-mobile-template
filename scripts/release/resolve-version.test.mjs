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

/** Builds a throwaway git repo with `commits` commits; `tags` maps 1-based commit index → tag. */
function fixtureRepo(commits, tags = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'resolve-version-'));
  roots.push(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  for (let i = 1; i <= commits; i += 1) {
    git('commit', '--quiet', '--allow-empty', '-m', `commit ${i}`);
    if (tags[i]) git('tag', tags[i]);
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
