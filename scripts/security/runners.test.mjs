import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

test('the code scanner skips when semgrep is absent', () => {
  withDir((dir) => {
    const result = run('code.sh', { env: { SECURITY_DIR: dir, PATH: withoutScanners(dir) } });
    assert.equal(result.status, 0, result.stderr);
    const sarif = JSON.parse(readFileSync(path.join(dir, 'code.sarif'), 'utf8'));
    assert.match(
      sarif.runs[0].invocations[0].toolExecutionNotifications[0].message.text,
      /semgrep is not installed/,
    );
  });
});

test('the policy scanner reports a weakened install policy as a finding, not a crash', () => {
  withDir((dir) => {
    const result = run('policy.sh', {
      env: { SECURITY_DIR: dir, SECURITY_POLICY_FILE: '/dev/null' },
    });
    assert.equal(result.status, 0, result.stderr);
    const sarif = JSON.parse(readFileSync(path.join(dir, 'policy.sarif'), 'utf8'));
    const rules = sarif.runs[0].results.map((r) => r.ruleId);
    assert.ok(rules.includes('pnpm/minimum-release-age'));
    assert.ok(rules.includes('pnpm/strict-dep-builds'));
    assert.ok(rules.includes('pnpm/trust-policy'));
  });
});

test('the policy scanner is clean against the real workspace file', () => {
  withDir((dir) => {
    const result = run('policy.sh', { env: { SECURITY_DIR: dir } });
    assert.equal(result.status, 0, result.stderr);
    const sarif = JSON.parse(readFileSync(path.join(dir, 'policy.sarif'), 'utf8'));
    assert.deepEqual(sarif.runs[0].results, []);
    assert.equal(sarif.runs[0].invocations[0].executionSuccessful, true);
  });
});

test('the policy scanner reports a near-miss value, not just a missing one', () => {
  withDir((dir) => {
    const fixtureDir = mkdtempSync(path.join(tmpdir(), 'security-policy-fixture-'));
    try {
      const file = path.join(fixtureDir, 'pnpm-workspace.yaml');
      writeFileSync(file, 'trustPolicy: no-downgrade-x\n');
      const result = run('policy.sh', { env: { SECURITY_DIR: dir, SECURITY_POLICY_FILE: file } });
      assert.equal(result.status, 0, result.stderr);
      const sarif = JSON.parse(readFileSync(path.join(dir, 'policy.sarif'), 'utf8'));
      const rules = sarif.runs[0].results.map((r) => r.ruleId);
      assert.ok(rules.includes('pnpm/trust-policy'));
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});

test('the aggregate runs the enabled jobs and reports a verdict', () => {
  withDir((dir) => {
    const result = run('local.sh', {
      env: {
        SECURITY_DIR: dir,
        SECURITY_CODE: 'false',
        SECURITY_DEPS: 'false',
        SECURITY_POLICY: 'true',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /security: (pass|informational)/);
    assert.match(result.stdout, /deps: skipped/);
  });
});
