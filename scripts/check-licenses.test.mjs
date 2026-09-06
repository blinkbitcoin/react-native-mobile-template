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
