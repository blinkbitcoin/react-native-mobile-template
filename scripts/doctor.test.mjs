import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  checkCommand,
  checkTool,
  compareVersions,
  main,
  parseVersion,
  readRequirements,
} from './doctor.mjs';

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

/** A `run` that answers each command from `outputs`: a string, or an error to throw. */
const fakeRun = (outputs) => (command) => {
  const answer = outputs[command];
  if (answer instanceof Error) throw answer;
  return answer;
};

const failed = (streams) => Object.assign(new Error('exit 1'), streams);

test('checkTool accepts a version at or above the minimum', () => {
  const tool = { command: 'node --version', minimum: '24.0.0' };
  assert.deepEqual(checkTool(tool, fakeRun({ 'node --version': 'v24.13.1\n' })), {
    ok: true,
    version: '24.13.1',
  });
});

test('checkTool rejects a version below the minimum', () => {
  const tool = { command: 'pod --version', minimum: '1.16.0' };
  assert.deepEqual(checkTool(tool, fakeRun({ 'pod --version': '1.15.2' })), {
    ok: false,
    reason: 'found 1.15.2, need >= 1.16.0',
  });
});

test('checkTool reads the version a failing command still printed', () => {
  // Some tools print their version and exit non-zero; the output is the answer.
  const tool = { command: 'watchman --version', minimum: '2024.0.0' };
  const run = fakeRun({ 'watchman --version': failed({ stdout: '2025.1.6.0\n' }) });
  assert.equal(checkTool(tool, run).ok, true);
});

test('checkTool reports a command with no output as not found', () => {
  const tool = { command: 'ruby --version', minimum: '3.3.0' };
  assert.deepEqual(checkTool(tool, fakeRun({ 'ruby --version': failed({}) })), {
    ok: false,
    reason: 'not found',
  });
  assert.deepEqual(checkTool(tool, fakeRun({ 'ruby --version': failed({ stdout: '' }) })), {
    ok: false,
    reason: 'not found',
  });
});

test('checkTool reports output with no version in it', () => {
  const tool = { command: 'java -version 2>&1', minimum: '17.0.0' };
  assert.deepEqual(checkTool(tool, fakeRun({ 'java -version 2>&1': ' no java here \n' })), {
    ok: false,
    reason: 'unparseable version output: no java here',
  });
});

test('checkCommand says "command failed" when neither stream says anything', () => {
  assert.deepEqual(
    checkCommand({ command: 'x' }, () => {
      throw failed({ stdout: '  ', stderr: null });
    }),
    { ok: false, reason: 'command failed' },
  );
});

test('readRequirements parses the requirements file next to the script', () => {
  const req = readRequirements();
  assert.ok(req.tools.length > 0);
  assert.ok(Array.isArray(req.env));
});

/** Runs `main` against a small requirements set and captures what it writes. */
const doctor = (options) => {
  let text = '';
  const code = main({ write: (chunk) => (text += chunk), ...options });
  return { code, lines: text.split('\n') };
};

const REQ = {
  tools: [
    { name: 'node', command: 'node --version', minimum: '24.0.0', hint: 'mise install' },
    {
      name: 'xcodebuild',
      command: 'xcodebuild -version',
      minimum: '26.4.0',
      hint: 'Install Xcode',
      platform: 'darwin',
    },
    {
      name: 'maestro',
      command: 'maestro --version',
      minimum: '2.0.0',
      hint: 'curl maestro',
      optional: true,
    },
  ],
  commands: [{ name: 'fastlane gems', command: 'bundle check', hint: 'make install' }],
  env: [{ name: 'APP_PORT_BASE', hint: 'mise trust' }],
};

test('main reports all good when every check passes', () => {
  const { code, lines } = doctor({
    req: REQ,
    platform: 'darwin',
    env: { APP_PORT_BASE: 'from-mise' },
    run: fakeRun({
      'node --version': 'v24.13.0',
      'xcodebuild -version': 'Xcode 26.4',
      'maestro --version': '2.1.0',
      'bundle check': '',
    }),
  });
  assert.equal(code, 0);
  assert.deepEqual(lines, [
    'ok    node 24.13.0',
    'ok    xcodebuild 26.4.0',
    'ok    maestro 2.1.0',
    'ok    fastlane gems',
    'ok    $APP_PORT_BASE=from-mise',
    '',
    'All good.',
    '',
  ]);
});

test('main skips other platforms, warns on optional tools and counts every failure', () => {
  const { code, lines } = doctor({
    req: REQ,
    platform: 'linux',
    env: {},
    run: fakeRun({
      'node --version': 'v22.1.0',
      'maestro --version': failed({}),
      'bundle check': failed({ stderr: 'Could not find gem fastlane' }),
    }),
  });
  assert.equal(code, 1);
  assert.deepEqual(lines, [
    'FAIL  node: found 22.1.0, need >= 24.0.0. Fix: mise install',
    'warn  maestro: not found. Fix: curl maestro',
    'FAIL  fastlane gems: Could not find gem fastlane. Fix: make install',
    'FAIL  $APP_PORT_BASE is not set. Fix: mise trust',
    '',
    '3 problem(s). Fix them and re-run: make doctor',
    '',
  ]);
});

test('main tolerates a requirements file without commands', () => {
  const { code } = doctor({
    req: { tools: [], env: [] },
    platform: 'darwin',
    env: {},
    run: fakeRun({}),
  });
  assert.equal(code, 0);
});

test('as a command it checks the real requirements and fails when nothing is on PATH', () => {
  const result = spawnSync(process.execPath, [path.join(HERE, 'doctor.mjs')], {
    encoding: 'utf8',
    // An empty PATH makes every tool "not found" on any machine. The rest of the
    // environment is kept so NODE_V8_COVERAGE lets the child count toward coverage.
    env: { ...process.env, PATH: '', APP_PORT_BASE: '' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL {2}node: not found\. Fix: mise install$/m);
  assert.match(result.stdout, /problem\(s\)\. Fix them and re-run: make doctor/);
});
