import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findings, summarize } from './codeql-findings.mjs';

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
