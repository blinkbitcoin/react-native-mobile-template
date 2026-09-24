import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, load, main, parseBoolean, resolve } from './config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

test('defaults apply when the file and the environment are silent', () => {
  const settings = resolve({}, {});
  assert.equal(settings.enabled, true);
  assert.equal(settings.severity, 'high');
  assert.deepEqual(settings.failOn, ['deterministic']);
  assert.equal(settings.jobs.deps, true);
  assert.equal(settings.jobs.review, false);
});

test('the file overrides a default', () => {
  const settings = resolve({ jobs: { deps: { enabled: false } }, severity: 'low' }, {});
  assert.equal(settings.jobs.deps, false);
  assert.equal(settings.severity, 'low');
});

test('the environment overrides the file', () => {
  const settings = resolve({ jobs: { deps: { enabled: false } } }, { SECURITY_DEPS: 'true' });
  assert.equal(settings.jobs.deps, true);
});

test('SECURITY_ENABLED is the master switch and follows the same order', () => {
  assert.equal(resolve({ enabled: false }, {}).enabled, false);
  assert.equal(resolve({ enabled: false }, { SECURITY_ENABLED: 'true' }).enabled, true);
});

test('a value that is not a boolean fails the run rather than reading as off', () => {
  assert.throws(
    () => parseBoolean('yes', 'SECURITY_DEPS'),
    /SECURITY_DEPS: expected true or false, got "yes"/,
  );
  assert.throws(() => resolve({}, { SECURITY_CODE: '1' }), /SECURITY_CODE/);
  assert.throws(
    () => resolve({ jobs: { code: { enabled: 'on' } } }, {}),
    /security-policy.json: jobs.code/,
  );
});

test('an unknown severity names itself in the error', () => {
  assert.throws(
    () => resolve({}, { SECURITY_SEVERITY: 'huge' }),
    /SECURITY_SEVERITY: expected one of none, low, medium, high, critical/,
  );
  assert.throws(() => resolve({ severity: 'huge' }, {}), /^Error: severity: expected one of/);
});

test('failOn is a comma list from the environment and an array from the file', () => {
  assert.deepEqual(resolve({}, { SECURITY_FAIL_ON: 'deterministic,review' }).failOn, [
    'deterministic',
    'review',
  ]);
  assert.deepEqual(resolve({ severity: 'high', failOn: ['review'] }, {}).failOn, ['review']);
  assert.deepEqual(resolve({}, { SECURITY_FAIL_ON: '' }).failOn, []);
});

test('every job in DEFAULTS has an environment twin', () => {
  for (const name of Object.keys(DEFAULTS.jobs)) {
    const env = { [`SECURITY_${name.toUpperCase()}`]: 'false' };
    assert.equal(resolve({}, env).jobs[name], false, name);
  }
});

const capture = () => {
  const out = [];
  return { out, log: (line) => out.push(String(line)), error: (line) => out.push(String(line)) };
};

test('get prints one setting, a list comma-joined', () => {
  const io = capture();
  assert.equal(main(['get', 'jobs.deps'], { ...io, env: {} }), 0);
  assert.equal(main(['get', 'failOn'], { ...io, env: {} }), 0);
  assert.deepEqual(io.out, ['true', 'deterministic']);
});

test('--json prints every setting', () => {
  const io = capture();
  assert.equal(main(['--json'], { ...io, env: {} }), 0);
  assert.equal(JSON.parse(io.out[0]).severity, 'high');
});

test('an unknown key and a missing argument both exit 2', () => {
  const io = capture();
  assert.equal(main(['get', 'jobs.nope'], { ...io, env: {} }), 2);
  assert.equal(main([], { ...io, env: {} }), 2);
  assert.deepEqual(io.out, [
    'no such setting: jobs.nope',
    'usage: config.mjs get <dotted.key> | --json',
  ]);
});

test('load returns defaults when the file is missing', () => {
  const settings = load('/nonexistent/path.json', {});
  assert.equal(settings.enabled, true);
  assert.equal(settings.severity, 'high');
});

test('load rethrows non-ENOENT errors like when the path is a directory', () => {
  assert.throws(() => load('.', {}));
});

test('environment boolean string false is parsed correctly', () => {
  const settings = resolve({}, { SECURITY_ENABLED: 'false' });
  assert.equal(settings.enabled, false);
});

test('load reads and parses the policy file', () => {
  const settings = load('security-policy.json', {});
  assert.equal(settings.enabled, true);
  assert.equal(settings.severity, 'high');
});

test('parseBoolean accepts boolean true and false', () => {
  assert.equal(parseBoolean(true, 'test'), true);
  assert.equal(parseBoolean(false, 'test'), false);
});

test('parseBoolean accepts string true and false', () => {
  assert.equal(parseBoolean('true', 'test'), true);
  assert.equal(parseBoolean('false', 'test'), false);
});

test('resolve with string false in environment', () => {
  assert.equal(resolve({}, { SECURITY_DEPS: 'false' }).jobs.deps, false);
});

test('get handles deeply nested nonexistent paths', () => {
  const io = capture();
  assert.equal(main(['get', 'jobs.nope.foo'], { ...io, env: {} }), 2);
  assert.equal(io.out[0], 'no such setting: jobs.nope.foo');
});

test('get without a key argument exits 2', () => {
  const io = capture();
  assert.equal(main(['get'], { ...io, env: {} }), 2);
  assert.equal(io.out[0], 'usage: config.mjs get <dotted.key> | --json');
});

test('Array.isArray branch in value output', () => {
  const io = capture();
  // This tests the non-array case where value is a boolean
  assert.equal(main(['get', 'enabled'], { ...io, env: {} }), 0);
  // 'true' is the string representation of the boolean
  assert.equal(io.out[0], 'true');
});

test('parseList with single item string', () => {
  const settings = resolve({}, { SECURITY_FAIL_ON: 'review' });
  assert.deepEqual(settings.failOn, ['review']);
});

test('parseList with spaces in comma-separated values', () => {
  const settings = resolve({}, { SECURITY_FAIL_ON: 'deterministic , review , critical' });
  assert.deepEqual(settings.failOn, ['deterministic', 'review', 'critical']);
});

test('policy jobs object without a specific job falls back to default', () => {
  const settings = resolve({ jobs: {} }, {});
  assert.equal(settings.jobs.deps, true); // DEFAULTS.jobs.deps
  assert.equal(settings.jobs.review, false); // DEFAULTS.jobs.review
});

test('resolve with default env parameter', () => {
  const settings = resolve({});
  assert.equal(settings.enabled, true);
  assert.equal(settings.severity, 'high');
});

test('load with default env parameter', () => {
  const settings = load('security-policy.json');
  assert.equal(settings.enabled, true);
});

test('job in policy without enabled property falls back to default', () => {
  const settings = resolve({ jobs: { deps: {} } }, {});
  assert.equal(settings.jobs.deps, true); // Falls back to DEFAULTS.jobs.deps
});

test('file policy with string false value in job is parsed correctly', () => {
  const settings = resolve({ jobs: { code: { enabled: 'false' } } }, {});
  assert.equal(settings.jobs.code, false);
});

test('load with invalid JSON file rethrows SyntaxError', () => {
  assert.throws(() => load('/tmp/test-invalid.json', {}), /SyntaxError/);
});

test('file policy with string true value in job', () => {
  const settings = resolve({ jobs: { policy: { enabled: 'true' } } }, {});
  assert.equal(settings.jobs.policy, true);
});

test('main with policy file and environment variable override', () => {
  const io = capture();
  // When we call main with SECURITY_ENABLED=true in env, it should enable the system
  assert.equal(main(['--json'], { ...io, env: { SECURITY_ENABLED: 'true' } }), 0);
  const parsed = JSON.parse(io.out[0]);
  assert.equal(parsed.enabled, true);
});

test('severity none is valid', () => {
  const settings = resolve({}, { SECURITY_SEVERITY: 'none' });
  assert.equal(settings.severity, 'none');
});

test('enabled with boolean value true from policy', () => {
  const settings = resolve({ enabled: true }, {});
  assert.equal(settings.enabled, true);
});

test('as a command it reads security-policy.json from the working directory', () => {
  const script = path.join(here, 'config.mjs');
  // The inherited environment keeps NODE_V8_COVERAGE, so the child counts,
  // and it also runs the file as the entry point rather than an import, so
  // `import.meta.main` is true here the way it never is under `node --test`.
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: process.env });
  const got = run('get', 'jobs.deps');
  assert.equal(got.status, 0);
  assert.equal(got.stdout.trim(), 'true');
});
