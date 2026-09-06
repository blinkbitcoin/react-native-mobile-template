// build-info.json is a cross-repo contract: the release workflow reads it and
// fills in `artifacts`. Pin the key set and the value types.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const outDir = mkdtempSync(path.join(tmpdir(), 'build-info-'));

after(() => rmSync(outDir, { recursive: true, force: true }));

/** Runs build-info.sh into a temp file and returns the parsed record. */
function buildInfo(env = {}) {
  const out = path.join(outDir, `${Math.random().toString(36).slice(2)}.json`);
  execFileSync('bash', ['scripts/release/build-info.sh'], {
    cwd: repoRoot,
    stdio: 'pipe',
    env: {
      ...process.env,
      BUILD_INFO_PATH: out,
      APP_VERSION: '1.2.3',
      APP_BUILD_NUMBER: '4242',
      GITHUB_SHA: '',
      GITHUB_RUN_ID: '',
      ...env,
    },
  });
  return JSON.parse(readFileSync(out, 'utf8'));
}

test('writes exactly the contracted keys, with the contracted types', () => {
  const info = buildInfo({ BUILD_STAGE: 'internal', GITHUB_RUN_ID: '987654' });

  assert.deepEqual(Object.keys(info), [
    'sha',
    'version',
    'buildNumber',
    'stage',
    'fingerprint',
    'expoSdk',
    'reactNative',
    'workflowRunId',
    'artifacts',
  ]);
  assert.match(info.sha, /^[0-9a-f]{40}$/);
  assert.equal(info.version, '1.2.3');
  assert.equal(info.buildNumber, 4242);
  assert.equal(info.stage, 'internal');
  assert.deepEqual(Object.keys(info.fingerprint), ['ios', 'android']);
  assert.match(info.fingerprint.ios, /^[0-9a-f]{40}$/);
  assert.match(info.fingerprint.android, /^[0-9a-f]{40}$/);
  assert.notEqual(info.fingerprint.ios, info.fingerprint.android);
  // Installed versions, not the `~`/`^` ranges from package.json.
  assert.match(info.expoSdk, /^\d+\.\d+\.\d+/);
  assert.match(info.reactNative, /^\d+\.\d+\.\d+/);
  assert.equal(info.workflowRunId, '987654');
  assert.deepEqual(info.artifacts, {});
});

test('stage defaults to development and workflowRunId is null off CI', () => {
  const info = buildInfo();
  assert.equal(info.stage, 'development');
  assert.equal(info.workflowRunId, null);
});
