import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkCommand, compareVersions, parseVersion } from './doctor.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('parseVersion extracts the first semver-ish token', () => {
  assert.deepEqual(parseVersion('Xcode 26.6\nBuild version 17F45'), [26, 6, 0]);
  assert.deepEqual(parseVersion('v24.13.0'), [24, 13, 0]);
  assert.equal(parseVersion('no version here'), null);
});

test('compareVersions orders numerically', () => {
  assert.equal(compareVersions([26, 6, 0], [26, 4, 0]), 1);
  assert.equal(compareVersions([1, 2, 3], [1, 2, 3]), 0);
  assert.equal(compareVersions([0, 9, 0], [1, 0, 0]), -1);
});

test('checkCommand reports the exit status, not a version', () => {
  assert.deepEqual(
    checkCommand({ command: 'true' }, () => ''),
    { ok: true },
  );
  const failing = checkCommand({ command: 'bundle check' }, () => {
    throw Object.assign(new Error('exit 1'), {
      stdout: "Could not find gem 'fastlane'.\nmore noise\n",
    });
  });
  assert.equal(failing.ok, false);
  assert.equal(failing.reason, "Could not find gem 'fastlane'.");

  // `bundle check` reports on stderr with an empty stdout, which is exactly the
  // case a `??` chain would swallow.
  const onStderr = checkCommand({ command: 'bundle check' }, () => {
    throw Object.assign(new Error('exit 1'), {
      stdout: '',
      stderr: 'The following gems are missing\n * fastlane\n',
    });
  });
  assert.equal(onStderr.reason, 'The following gems are missing');
});

// The missing-gems case is a documented `make doctor` failure, so the entry
// has to stay in the requirements file for local-dev.md to keep telling the truth.
test('the requirements file checks the fastlane gems', () => {
  const req = JSON.parse(readFileSync(path.join(HERE, 'doctor.requirements.json'), 'utf8'));
  const gems = req.commands.find((entry) => entry.command === 'bundle check');
  assert.ok(gems, 'no `bundle check` entry in doctor.requirements.json');
  assert.match(gems.hint, /make install/);
});
