import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findViolations } from './check-licenses.mjs';

test('flags packages outside the allowlist and ignores allowed ones', () => {
  const report = {
    MIT: [{ name: 'a' }],
    'GPL-3.0': [{ name: 'b' }],
    '(MIT OR Apache-2.0)': [{ name: 'c' }],
  };
  assert.deepEqual(findViolations(report), [{ name: 'b', license: 'GPL-3.0' }]);
});

test('OR expression is allowed when any alternative is allowed', () => {
  const report = { '(MIT OR GPL-3.0)': [{ name: 'a' }] };
  assert.deepEqual(findViolations(report), []);
});

test('AND expression is a violation unless every conjunct is allowed', () => {
  const report = { '(GPL-3.0 AND MIT)': [{ name: 'a' }] };
  assert.deepEqual(findViolations(report), [{ name: 'a', license: '(GPL-3.0 AND MIT)' }]);
});

test('AND expression is allowed when every conjunct is allowed', () => {
  const report = { 'MIT AND Apache-2.0': [{ name: 'a' }] };
  assert.deepEqual(findViolations(report), []);
});

test('plain unknown license string is a violation', () => {
  const report = { UNLICENSED: [{ name: 'a' }] };
  assert.deepEqual(findViolations(report), [{ name: 'a', license: 'UNLICENSED' }]);
});
