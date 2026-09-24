import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ENGINE_OF, main, severityOf, summarize, verdict } from './verdict.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

const result = (severity, ruleId = 'r') => ({
  ruleId,
  level: severity === 'low' ? 'note' : severity === 'medium' ? 'warning' : 'error',
  message: { text: 'boom' },
  properties: {
    'security-severity': { critical: '9.0', high: '7.0', medium: '4.0', low: '1.0' }[severity],
  },
  locations: [
    { physicalLocation: { artifactLocation: { uri: 'f.ts' }, region: { startLine: 1 } } },
  ],
});

const doc = (tool, results, successful = true) => ({
  version: '2.1.0',
  runs: [
    {
      tool: { driver: { name: tool } },
      results,
      invocations: [{ executionSuccessful: successful }],
    },
  ],
});

const entry = (job, document) => ({ job, document });

test('severity comes from security-severity, then from level', () => {
  assert.equal(severityOf(result('critical')), 'critical');
  assert.equal(severityOf({ level: 'error' }), 'high');
  assert.equal(severityOf({ level: 'warning' }), 'medium');
  assert.equal(severityOf({ level: 'note' }), 'low');
  assert.equal(severityOf({}), 'medium');
  assert.equal(
    severityOf({ properties: { 'security-severity': 'not a number' }, level: 'note' }),
    'low',
  );
});

test('every job maps to an engine class', () => {
  assert.equal(ENGINE_OF.deps, 'deterministic');
  assert.equal(ENGINE_OF.binaries, 'deterministic');
  assert.equal(ENGINE_OF.review, 'review');
  assert.equal(ENGINE_OF.openant, 'openant');
});

test('counts, highest severity and skipped jobs', () => {
  const s = summarize([
    entry('deps', doc('osv-scanner', [result('high'), result('low')])),
    entry('code', doc('semgrep', [], false)),
  ]);
  assert.deepEqual(s.counts, { critical: 0, high: 1, medium: 0, low: 1 });
  assert.equal(s.highest, 'high');
  assert.deepEqual(s.skipped, ['code']);
});

test('a finding at the threshold from a fail-on engine fails', () => {
  const v = verdict({
    entries: [entry('deps', doc('osv-scanner', [result('high')]))],
    severity: 'high',
    failOn: ['deterministic'],
  });
  assert.equal(v.verdict, 'fail');
  assert.equal(v.exitCode, 1);
});

test('the same finding below the threshold passes', () => {
  const v = verdict({
    entries: [entry('deps', doc('osv-scanner', [result('medium')]))],
    severity: 'high',
    failOn: ['deterministic'],
  });
  assert.equal(v.verdict, 'pass');
  assert.equal(v.exitCode, 0);
});

test('a finding from an engine that is not in fail-on is informational', () => {
  const v = verdict({
    entries: [entry('review', doc('review', [result('critical')]))],
    severity: 'high',
    failOn: ['deterministic'],
  });
  assert.equal(v.verdict, 'informational');
  assert.equal(v.exitCode, 0);
});

test('severity none never fails', () => {
  const v = verdict({
    entries: [entry('deps', doc('osv-scanner', [result('critical')]))],
    severity: 'none',
    failOn: ['deterministic'],
  });
  assert.equal(v.verdict, 'informational');
  assert.equal(v.exitCode, 0);
});

test('a suppressed result is not a finding', () => {
  const suppressed = { ...result('critical'), suppressions: [{ kind: 'inSource' }] };
  const v = verdict({
    entries: [entry('deps', doc('osv-scanner', [suppressed]))],
    severity: 'high',
    failOn: ['deterministic'],
  });
  assert.equal(v.verdict, 'pass');
  assert.equal(v.counts.critical, 0);
});

test('the summary names skipped jobs so they are never read as clean', () => {
  const v = verdict({
    entries: [entry('code', doc('semgrep', [], false))],
    severity: 'high',
    failOn: ['deterministic'],
  });
  assert.ok(v.lines.some((line) => /code: skipped/.test(line)));
  assert.ok(!v.lines.some((line) => /code: clean/.test(line)));
});

test('a job that ran and found nothing is clean', () => {
  const v = verdict({
    entries: [entry('deps', doc('osv-scanner', []))],
    severity: 'high',
    failOn: ['deterministic'],
  });
  assert.ok(v.lines.some((line) => /deps: clean/.test(line)));
});

test('the CLI prints the summary and returns the exit code', () => {
  const out = [];
  const readEntries = () => [entry('deps', doc('osv-scanner', [result('critical')]))];
  const code = main(['.security'], {
    log: (l) => out.push(l),
    error: () => {},
    env: {},
    readEntries,
  });
  assert.equal(code, 1);
  assert.ok(out.some((line) => /security: fail/.test(line)));
});

test('a missing directory exits 2 with advice', () => {
  const out = [];
  const readEntries = () => {
    throw new Error('ENOENT');
  };
  assert.equal(main([], { log: () => {}, error: (l) => out.push(l), env: {}, readEntries }), 2);
  assert.match(out[0], /run a scanner first/);
});

// Every test above injects readEntries, which never exercises the module's
// own directory reader - the function that lists *.sarif files and parses
// them, and the path every real run takes. This writes real SARIF files to a
// temporary directory and calls main() without injecting readEntries, so the
// 100% coverage gate has to mean what it says.
test('the real directory reader lists *.sarif files and parses them', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'verdict-read-'));
  try {
    writeFileSync(
      path.join(dir, 'deps.sarif'),
      JSON.stringify(doc('osv-scanner', [result('critical')])),
    );
    writeFileSync(path.join(dir, 'code.sarif'), JSON.stringify(doc('semgrep', [], false)));
    writeFileSync(path.join(dir, 'notes.txt'), 'not a sarif file');
    const out = [];
    const code = main([dir], {
      log: (l) => out.push(l),
      error: () => {},
      env: { SECURITY_SEVERITY: 'high', SECURITY_FAIL_ON: 'deterministic' },
    });
    assert.equal(code, 1);
    assert.ok(out.some((line) => /deps: 1 finding\(s\)/.test(line)));
    assert.ok(out.some((line) => /code: skipped/.test(line)));
    assert.ok(out.some((line) => /security: fail/.test(line)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The functions below read SARIF fields defensively (`?? []`) because the
// spec makes several of them optional, and this module reads whatever a
// scanner wrote, not only what sarif.mjs produces. The tests above never
// exercise those fallbacks - every document, run and result they build is
// fully populated - so these fill in the malformed-but-spec-legal shapes:
// a document with no runs, a run with no results or invocations, and a
// result with no ruleId or message.

test('a document with no runs at all counts nothing and is not skipped', () => {
  const s = summarize([entry('deps', {})]);
  assert.deepEqual(s.counts, { critical: 0, high: 0, medium: 0, low: 0 });
  assert.deepEqual(s.skipped, []);
});

test('a run with no results and no invocations is clean, not skipped', () => {
  const s = summarize([entry('deps', { runs: [{}] })]);
  assert.deepEqual(s.counts, { critical: 0, high: 0, medium: 0, low: 0 });
  assert.deepEqual(s.skipped, []);
});

test('a finding with no ruleId or message text still gets recorded, with placeholders', () => {
  const bare = { level: 'note', locations: [] };
  const s = summarize([entry('deps', doc('tool', [bare]))]);
  assert.equal(s.findings[0].ruleId, '<no rule>');
  assert.equal(s.findings[0].message, '');
});

// The shape sarif.mjs's skipped() actually produces: an executionSuccessful:
// false invocation carrying a toolExecutionNotifications note. Only this
// shape exercises the code that reads the reason out of it - the tests
// above only ever see a skipped run with no notification at all, which
// takes the 'no reason given' fallback instead.
const skippedWithReason = (tool, reason) => ({
  version: '2.1.0',
  runs: [
    {
      tool: { driver: { name: tool } },
      results: [],
      invocations: [
        {
          executionSuccessful: false,
          toolExecutionNotifications: [{ level: 'note', message: { text: `skipped: ${reason}` } }],
        },
      ],
    },
  ],
});

test('a skipped job with a reported reason uses that reason in the summary', () => {
  const v = verdict({
    entries: [entry('code', skippedWithReason('semgrep', 'not installed'))],
    severity: 'high',
    failOn: ['deterministic'],
  });
  assert.ok(v.lines.includes('code: skipped: not installed'));
});

// A SARIF document may carry more than one run, and per spec only
// invocations is optional per run - so a run that never reports invocations
// at all can sit next to one that does. That run's `run.invocations ?? []`
// fallback only fires while the job is still read as skipped, which needs
// another run in the same document to report the failure.
test('a skipped job with a run that reports no invocations at all still finds the reason', () => {
  const document = {
    version: '2.1.0',
    runs: [
      { tool: { driver: { name: 'first' } }, results: [] },
      {
        tool: { driver: { name: 'second' } },
        results: [],
        invocations: [
          {
            executionSuccessful: false,
            toolExecutionNotifications: [
              { level: 'note', message: { text: 'skipped: no key configured' } },
            ],
          },
        ],
      },
    ],
  };
  const v = verdict({
    entries: [entry('review', document)],
    severity: 'high',
    failOn: ['deterministic'],
  });
  assert.ok(v.lines.includes('review: skipped: no key configured'));
});

// import.meta.main only runs when the file is its own entry point - never
// when it is merely imported under `node --test`. Spawn it as a child
// process, the way config.test.mjs and codeql-findings.test.mjs both do, so
// that arm is actually covered rather than assumed.
test('as a command it reads *.sarif files from the directory named on the command line', () => {
  const script = path.join(here, 'verdict.mjs');
  const dir = mkdtempSync(path.join(tmpdir(), 'verdict-cli-'));
  try {
    writeFileSync(
      path.join(dir, 'deps.sarif'),
      JSON.stringify(doc('osv-scanner', [result('critical')])),
    );
    // The inherited environment keeps NODE_V8_COVERAGE, so the child counts,
    // and it also runs the file as the entry point rather than an import, so
    // `import.meta.main` is true here the way it never is under `node --test`.
    // SECURITY_SEVERITY/SECURITY_FAIL_ON are pinned so the result cannot
    // change because a developer or runner happens to have one exported.
    const childEnv = {
      ...process.env,
      SECURITY_SEVERITY: 'high',
      SECURITY_FAIL_ON: 'deterministic',
    };
    const run = (...args) =>
      spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: childEnv });
    const found = run(dir);
    assert.equal(found.status, 1);
    assert.match(found.stdout, /security: fail/);

    const missing = run(path.join(dir, 'nonexistent'));
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /run a scanner first/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
