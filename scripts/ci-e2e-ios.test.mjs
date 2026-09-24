// When CI runs the iOS E2E suite. It bills at ten times the Linux rate on a
// private repo and takes about three times as long as Android on any repo, so
// ci.yml runs it on a push to main (when E2E_IOS is true) and on a PR only
// with the `e2e:ios` label.
//
// The gate is one expression in ci.yml, and nothing else in the repository
// exercises it: a run that should have skipped iOS still goes green, only
// slower. So this file reads the expression out of ci.yml and evaluates it for
// each event the workflow is triggered by, rather than matching its text.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const ci = readFileSync(
  fileURLToPath(new URL('../.github/workflows/ci.yml', import.meta.url)),
  'utf8',
);

/** The `ios:` input ci.yml passes to check-e2e.yml, without the ${{ }}. */
function iosExpression() {
  const lines = ci.split('\n').filter((l) => /^\s+ios: /.test(l));
  assert.equal(lines.length, 1, 'ci.yml should pass exactly one ios: input');
  const match = /^\s+ios: \$\{\{ (.+) \}\}$/.exec(lines[0]);
  assert.ok(match, `ios: is not a single \${{ }} expression: ${lines[0]}`);
  return match[1];
}

/**
 * The expression as a JS function of { event, E2E_IOS, labels }. Only the
 * terms the gate uses are translated; anything else is left as text and then
 * rejected, so a new term fails this file instead of evaluating wrongly.
 * `&&`, `||` and `!` need no translation: on booleans GitHub's behave the same.
 */
function compile(expression) {
  const js = expression
    .replace(
      /contains\(github\.event\.pull_request\.labels\.\*\.name, '([^']+)'\)/g,
      (_, label) => `labels.includes(${JSON.stringify(label)})`,
    )
    .replaceAll('github.event_name', 'event')
    .replaceAll('vars.E2E_IOS', 'E2E_IOS')
    .replace(/([!=])=/g, '$1==');
  const rest = js.replace(/labels\.includes\("[^"]+"\)|event|E2E_IOS|'[^']*'|[()!=&|\s]/g, '');
  assert.equal(rest, '', `ios: uses a term this test cannot evaluate: ${expression}`);
  return new Function('{ event, E2E_IOS, labels }', `return ${js};`);
}

describe('ci.yml runs iOS E2E on main and on labelled PRs only', () => {
  const ios = compile(iosExpression());
  // The payload GitHub gives each event: a push or a manual run has no
  // pull_request, so the labels expression is empty, and an unset variable is ''.
  const cases = [
    ['a PR, even with E2E_IOS true', { event: 'pull_request', E2E_IOS: 'true', labels: [] }, false],
    [
      'a PR with another label',
      { event: 'pull_request', E2E_IOS: 'true', labels: ['docs'] },
      false,
    ],
    [
      'a PR with the e2e:ios label',
      { event: 'pull_request', E2E_IOS: 'true', labels: ['e2e:ios'] },
      true,
    ],
    [
      'a labelled PR where E2E_IOS is unset',
      { event: 'pull_request', E2E_IOS: '', labels: ['e2e:ios'] },
      true,
    ],
    ['a push to main with E2E_IOS true', { event: 'push', E2E_IOS: 'true', labels: [] }, true],
    ['a push to main where E2E_IOS is unset', { event: 'push', E2E_IOS: '', labels: [] }, false],
    [
      'a manual run with E2E_IOS true',
      { event: 'workflow_dispatch', E2E_IOS: 'true', labels: [] },
      true,
    ],
    [
      'a manual run where E2E_IOS is unset',
      { event: 'workflow_dispatch', E2E_IOS: '', labels: [] },
      false,
    ],
  ];
  for (const [name, context, expected] of cases) {
    test(`${name}: ${expected ? 'runs' : 'skips'} iOS`, () => {
      assert.equal(ios(context), expected);
    });
  }

  test('a label added to an open PR starts a run of its own', () => {
    // Without `labeled`, the label would only take effect on the next push.
    assert.match(ci, /^\s+types: \[[^\]]*\blabeled\b[^\]]*\]$/m);
  });
});
