import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const run = (script, { env = {}, args = [] } = {}) =>
  spawnSync('bash', [path.join(root, 'scripts/security', script), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CI: '', ...env },
  });

const withDir = (fn) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'security-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// A PATH holding only what the runners themselves need, so the scanner binary
// is genuinely absent. Emptying PATH instead would take `node` with it, and
// the runner could not even write its skipped SARIF - the test would pass for
// the wrong reason.
const withoutScanners = (dir) => {
  const bin = path.join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  symlinkSync(process.execPath, path.join(bin, 'node'));
  for (const tool of ['bash', 'env', 'mkdir', 'grep', 'dirname', 'sed', 'cat']) {
    const found = spawnSync('/usr/bin/which', [tool], { encoding: 'utf8' }).stdout.trim();
    if (found) symlinkSync(found, path.join(bin, tool));
  }
  return bin;
};

test('a disabled job writes a skipped SARIF and exits 0', () => {
  withDir((dir) => {
    const result = run('deps.sh', { env: { SECURITY_DIR: dir, SECURITY_DEPS: 'false' } });
    assert.equal(result.status, 0, result.stderr);
    const sarif = JSON.parse(readFileSync(path.join(dir, 'deps.sarif'), 'utf8'));
    assert.equal(sarif.runs[0].invocations[0].executionSuccessful, false);
    assert.match(
      sarif.runs[0].invocations[0].toolExecutionNotifications[0].message.text,
      /disabled/,
    );
  });
});

test('a missing tool is a skip locally', () => {
  withDir((dir) => {
    const result = run('deps.sh', { env: { SECURITY_DIR: dir, PATH: withoutScanners(dir) } });
    assert.equal(result.status, 0, result.stderr);
    const sarif = JSON.parse(readFileSync(path.join(dir, 'deps.sarif'), 'utf8'));
    assert.match(
      sarif.runs[0].invocations[0].toolExecutionNotifications[0].message.text,
      /osv-scanner is not installed/,
    );
  });
});

test('a missing tool is a failure under CI', () => {
  withDir((dir) => {
    const result = run('deps.sh', {
      env: { SECURITY_DIR: dir, PATH: withoutScanners(dir), CI: 'true' },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /osv-scanner is not installed/);
  });
});
