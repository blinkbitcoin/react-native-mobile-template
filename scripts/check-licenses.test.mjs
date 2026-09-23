import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findViolations, main } from './check-licenses.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

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

test('a nested group is conservatively a violation', () => {
  const report = { '((MIT OR ISC) AND Apache-2.0)': [{ name: 'a' }] };
  assert.deepEqual(findViolations(report), [
    { name: 'a', license: '((MIT OR ISC) AND Apache-2.0)' },
  ]);
});

/** Captures what `main` writes, and answers `pnpm licenses` with `report`. */
const run = (report) => {
  const out = [];
  const err = [];
  const commands = [];
  const code = main({
    exec: (command) => {
      commands.push(command);
      return JSON.stringify(report);
    },
    log: (line) => out.push(line),
    error: (line) => err.push(line),
  });
  return { code, out, err, commands };
};

test('main asks pnpm for the production licenses and passes an allowed set', () => {
  const { code, out, err, commands } = run({ MIT: [{ name: 'a' }] });
  assert.equal(code, 0);
  assert.deepEqual(commands, ['pnpm licenses list --json --prod']);
  assert.deepEqual(out, ['licenses ok']);
  assert.deepEqual(err, []);
});

test('main names every disallowed package and fails', () => {
  const { code, out, err } = run({ 'GPL-3.0': [{ name: 'b' }, { name: 'c' }] });
  assert.equal(code, 1);
  assert.deepEqual(out, []);
  assert.deepEqual(err, ['disallowed license GPL-3.0: b', 'disallowed license GPL-3.0: c']);
});

test('as a command it reads the report from pnpm on PATH', (t) => {
  const bin = mkdtempSync(path.join(tmpdir(), 'check-licenses-bin-'));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const pnpm = path.join(bin, 'pnpm');
  writeFileSync(pnpm, '#!/bin/sh\necho \'{"GPL-3.0":[{"name":"b"}]}\'\n');
  chmodSync(pnpm, 0o755);
  const result = spawnSync(process.execPath, [path.join(here, 'check-licenses.mjs')], {
    encoding: 'utf8',
    // Inherits NODE_V8_COVERAGE, so the child counts toward coverage.
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
  });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, 'disallowed license GPL-3.0: b\n');
});
