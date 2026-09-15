import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { emptyCoverageFiles, formatEmptyFiles } from './check-coverage-empty.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(path.join(here, 'fixtures/coverage-summary.json'), 'utf8'));

test('reports every file with no statements and skips the totals row', () => {
  assert.deepEqual(emptyCoverageFiles(fixture), [
    '/repo/src/app/(tabs)/index.tsx',
    '/repo/src/types/only.ts',
  ]);
});

test('a fully covered report has no empty rows', () => {
  const covered = {
    total: fixture.total,
    '/repo/src/lib/storage.ts': fixture['/repo/src/lib/storage.ts'],
  };
  assert.deepEqual(emptyCoverageFiles(covered), []);
});

test('a row with covered statements is never empty, however low its percentage', () => {
  const partial = {
    '/repo/src/a.ts': { statements: { total: 10, covered: 1, skipped: 0, pct: 10 } },
  };
  assert.deepEqual(emptyCoverageFiles(partial), []);
});

test('a malformed row without a statements block is not reported as empty', () => {
  // Guards the optional chaining: a summary shape we do not recognise must not
  // be read as "nothing to cover" and fail the build for the wrong reason.
  assert.deepEqual(emptyCoverageFiles({ '/repo/src/a.ts': {} }), []);
});

test('each line names the file relative to the repo root and the fix', () => {
  const lines = formatEmptyFiles(['/repo/src/types/only.ts'], '/repo');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^src\/types\/only\.ts has no statements to cover/);
  assert.match(lines[0], /coveragePathIgnorePatterns/);
});
