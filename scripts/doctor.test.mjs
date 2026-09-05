import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareVersions, parseVersion } from './doctor.mjs';

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
