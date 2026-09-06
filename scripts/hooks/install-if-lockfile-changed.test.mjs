import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'install-if-lockfile-changed.sh');

let repo;

function git(...args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

/** Runs the hook script from inside the fixture repo, as lefthook would. */
function hook(...args) {
  return execFileSync('bash', ['scripts/hooks/install-if-lockfile-changed.sh', ...args], {
    cwd: repo,
    encoding: 'utf8',
    // The install itself is the one thing a unit test must not do.
    env: { ...process.env, RNW_INSTALL_CMD: 'echo INSTALLED' },
  });
}

function commit(message, lockfile) {
  if (lockfile !== undefined) writeFileSync(join(repo, 'pnpm-lock.yaml'), lockfile);
  writeFileSync(join(repo, 'file.txt'), message);
  git('add', '-A');
  git('commit', '-q', '-m', message);
}

before(() => {
  repo = mkdtempSync(join(tmpdir(), 'lockfile-hook-'));
  mkdirSync(join(repo, 'scripts', 'hooks'), { recursive: true });
  cpSync(script, join(repo, 'scripts', 'hooks', 'install-if-lockfile-changed.sh'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  commit('base', 'lockfileVersion: 9\n');
});

after(() => {
  rmSync(repo, { recursive: true, force: true });
});

test('post-checkout installs when the two refs differ in the lockfile', () => {
  const before_ = git('rev-parse', 'HEAD');
  commit('bump deps', 'lockfileVersion: 9\npackages: {}\n');
  const after_ = git('rev-parse', 'HEAD');

  assert.match(hook('post-checkout', before_, after_, '1'), /INSTALLED/);
});

test('post-checkout is silent when only other files changed', () => {
  const before_ = git('rev-parse', 'HEAD');
  commit('docs only');
  const after_ = git('rev-parse', 'HEAD');

  assert.equal(hook('post-checkout', before_, after_, '1'), '');
});

test('a file checkout (flag 0) never installs', () => {
  const before_ = git('rev-parse', 'HEAD');
  commit('bump deps again', 'lockfileVersion: 9\npackages: {a: 1}\n');
  const after_ = git('rev-parse', 'HEAD');

  assert.equal(hook('post-checkout', before_, after_, '0'), '');
});

test('a null old ref (fresh clone) is skipped rather than failing', () => {
  const zero = '0000000000000000000000000000000000000000';

  assert.equal(hook('post-checkout', zero, git('rev-parse', 'HEAD'), '1'), '');
});

test('post-merge compares ORIG_HEAD with HEAD, not the HEAD@{1} that git rejected', () => {
  git('checkout', '-q', '-b', 'feature');
  commit('feature bumps the lockfile', 'lockfileVersion: 9\npackages: {b: 2}\n');
  git('checkout', '-q', 'main');
  git('merge', '-q', '--no-ff', '-m', 'merge feature', 'feature');

  const out = hook('post-merge', '0');
  assert.match(out, /INSTALLED/);
  assert.doesNotMatch(out, /ambiguous argument/);
});

test('post-merge without an ORIG_HEAD exits quietly', () => {
  rmSync(join(repo, '.git', 'ORIG_HEAD'), { force: true });

  assert.equal(hook('post-merge', '0'), '');
});

test('an unknown hook name fails loudly', () => {
  try {
    hook('pre-commit');
    assert.fail('an unknown hook name must not pass silently');
  } catch (e) {
    assert.equal(e.status, 2);
    assert.match(String(e.stderr), /usage/);
  }
});
