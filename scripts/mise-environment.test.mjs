// This repository's .mise.toml [env]: what the shared machine setup relies on
// it to do. The setup scripts themselves are the shared tooling's, tested in
// shared-workflows; this file tests the half that is this repository's own.
// Each case runs the real mise (skipped where it is absent) against a copy of
// the [env] section in a throwaway directory.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MISE = spawnSync('mise', ['--version']).status === 0 ? false : 'mise is not installed';

let sandboxes = [];
afterEach(() => {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
  sandboxes = [];
});

/** A directory holding only the [env] half of .mise.toml: the [tools] pins are not what these cases are about. */
const environmentOnly = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mise-environment-'));
  sandboxes.push(dir);
  const toml = readFileSync(path.join(HERE, '../.mise.toml'), 'utf8');
  writeFileSync(path.join(dir, '.mise.toml'), toml.slice(toml.indexOf('[env]')));
  return dir;
};

test('.mise.toml puts the SDK tools and Maestro on PATH from the ANDROID_HOME in .env.local', {
  skip: MISE,
}, () => {
  const dir = environmentOnly();
  writeFileSync(path.join(dir, '.env.local'), 'ANDROID_HOME=/sdk-from-env-local\n');
  const result = spawnSync('mise', ['exec', '--', 'printenv', 'PATH'], {
    cwd: dir,
    encoding: 'utf8',
    // Trusted for this process only, never written to the machine's list.
    env: { ...process.env, MISE_TRUSTED_CONFIG_PATHS: dir, ANDROID_HOME: '' },
  });
  assert.equal(result.status, 0, result.stderr);
  const entries = result.stdout.trim().split(':');
  // `_.file` must be evaluated before `_.path`; the other order leaves
  // ANDROID_HOME set but adb missing, which is how `make doctor` failed.
  for (const tool of ['platform-tools', 'emulator', 'cmdline-tools/latest/bin']) {
    assert.ok(entries.includes(`/sdk-from-env-local/${tool}`), `${tool} missing from ${entries}`);
  }
  assert.ok(entries.some((entry) => entry.endsWith('/.maestro/bin')));
});

test('.mise.toml gives a shell without a locale UTF-8, and leaves a chosen one alone', {
  skip: MISE,
}, () => {
  const dir = environmentOnly();
  const langIn = (lang) => {
    const env = { ...process.env, MISE_TRUSTED_CONFIG_PATHS: dir };
    if (lang) env.LANG = lang;
    else delete env.LANG;
    return spawnSync('mise', ['exec', '--', 'printenv', 'LANG'], {
      cwd: dir,
      env,
      encoding: 'utf8',
    }).stdout.trim();
  };
  // Without it Ruby reads source as US-ASCII, and fastlane and CocoaPods break.
  assert.equal(langIn(undefined), 'en_US.UTF-8');
  assert.equal(langIn('sv_SE.UTF-8'), 'sv_SE.UTF-8');
});
