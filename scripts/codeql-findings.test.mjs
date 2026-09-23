import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findings, main, summarize } from './codeql-findings.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

const result = (ruleId, uri, line, text, extra = {}) => ({
  ruleId,
  message: { text },
  locations: [{ physicalLocation: { artifactLocation: { uri }, region: { startLine: line } } }],
  ...extra,
});

// One suppressed finding, one open one, and - in a second run - one with no
// location and no rule id, which is the shape that used to throw.
const sarif = {
  runs: [
    {
      results: [
        result('js/insufficient-password-hash', 'src/auth.ts', 45, 'Password  from\n a call.', {
          suppressions: [{ kind: 'inSource' }],
        }),
        result('js/unused-local-variable', 'src/x.ts', 3, 'Unused variable y.'),
      ],
    },
    { results: [{ ruleId: 'js/no-location', message: { text: 'nowhere' } }] },
  ],
};

test('reads rule, location, message and the in-source suppression from every run', () => {
  assert.deepEqual(findings(sarif), [
    {
      ruleId: 'js/insufficient-password-hash',
      location: 'src/auth.ts:45',
      message: 'Password from a call.',
      suppressed: true,
    },
    {
      ruleId: 'js/unused-local-variable',
      location: 'src/x.ts:3',
      message: 'Unused variable y.',
      suppressed: false,
    },
    { ruleId: 'js/no-location', location: '<no location>', message: 'nowhere', suppressed: false },
  ]);
});

test('tolerates a SARIF with no runs, results, rule or message', () => {
  assert.deepEqual(findings({}), []);
  assert.deepEqual(findings({ runs: [{}] }), []);
  assert.deepEqual(
    findings({
      runs: [
        { results: [{ locations: [{ physicalLocation: { artifactLocation: { uri: 'a.ts' } } }] }] },
      ],
    }),
    [{ ruleId: '<no rule>', location: 'a.ts', message: '', suppressed: false }],
  );
});

test('an empty suppressions array is not a suppression', () => {
  // SARIF producers emit `suppressions: []` for an unsuppressed result, so
  // testing the key's presence rather than its length would silence everything.
  const one = findings({
    runs: [{ results: [result('js/x', 'a.ts', 1, 'm', { suppressions: [] })] }],
  });
  assert.equal(one[0].suppressed, false);
});

test('lists every finding, marks the suppressed ones and counts both', () => {
  const { open, suppressed, lines } = summarize(sarif);
  assert.equal(open, 2);
  assert.equal(suppressed, 1);
  assert.deepEqual(lines, [
    'suppressed  js/insufficient-password-hash  src/auth.ts:45  Password from a call.',
    'open        js/unused-local-variable  src/x.ts:3  Unused variable y.',
    'open        js/no-location  <no location>  nowhere',
    'codeql: 2 open, 1 suppressed by an inline marker',
  ]);
});

test('says so when there is nothing', () => {
  assert.deepEqual(summarize({ runs: [] }), {
    open: 0,
    suppressed: 0,
    lines: ['codeql: no findings'],
  });
});

test('a run whose every finding is suppressed reports zero open, so the gate passes', () => {
  const allSuppressed = {
    runs: [{ results: [result('js/x', 'a.ts', 1, 'm', { suppressions: [{ kind: 'inSource' }] })] }],
  };
  const { open, suppressed, lines } = summarize(allSuppressed);
  assert.equal(open, 0);
  assert.equal(suppressed, 1);
  assert.equal(lines.at(-1), 'codeql: 0 open, 1 suppressed by an inline marker');
});

/** Writes `sarif` to a temporary file and returns its path. */
const sarifFile = (t, contents) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codeql-findings-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'results.sarif');
  writeFileSync(file, JSON.stringify(contents));
  return file;
};

/** Captures what `main` writes, instead of letting it reach the test output. */
const capture = () => {
  const out = [];
  const err = [];
  return { out, err, io: { log: (line) => out.push(line), error: (line) => err.push(line) } };
};

test('main without a file prints the usage and exits 2', () => {
  const { out, err, io } = capture();
  assert.equal(main([], io), 2);
  assert.deepEqual(out, []);
  assert.deepEqual(err, ['usage: codeql-findings.mjs <results.sarif>']);
});

test('main prints every line and exits 1 while a finding is open', (t) => {
  const { out, io } = capture();
  assert.equal(main([sarifFile(t, sarif)], io), 1);
  assert.deepEqual(out, summarize(sarif).lines);
});

test('main exits 0 when nothing is open', (t) => {
  const { out, io } = capture();
  assert.equal(main([sarifFile(t, { runs: [] })], io), 0);
  assert.deepEqual(out, ['codeql: no findings']);
});

test('as a command it reads the file named on the command line', (t) => {
  const script = path.join(here, 'codeql-findings.mjs');
  // The inherited environment keeps NODE_V8_COVERAGE, so the child counts.
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: process.env });
  assert.equal(run().status, 2);
  const open = run(sarifFile(t, sarif));
  assert.equal(open.status, 1);
  assert.match(open.stdout, /codeql: 2 open, 1 suppressed/);
});
