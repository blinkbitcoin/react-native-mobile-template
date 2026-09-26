// The gates that let each suite skip a change it cannot affect. check-code.yml's
// `changes` job classifies the diff into `unit-changed` and `e2e-changed`, and
// ci.yml turns them into `if:`s on unit, e2e and badges. Those three read each
// other's results, so they are evaluated here as a graph: each scenario runs
// checks, then every job in file order, the way GitHub decides them - an `if:`
// with no status function gets the implicit success() that `needs` adds, and a
// job whose gate is false reports `skipped` to the jobs after it.
//
// The web suite gates itself (scripts/ci-web-gate.test.mjs).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('..', import.meta.url));
const ci = parse(readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8'));

/** An `if:` without its `${{ }}`, which GitHub allows either way. */
function unwrap(expression) {
  return /^\$\{\{\s*([\s\S]*?)\s*\}\}$/.exec(expression)?.[1] ?? expression;
}

/**
 * A job's `if:` as a JS function of { needs, cancelled }. Only the terms these
 * gates use are translated; anything else is left as text and then rejected, so
 * a new term fails this file instead of evaluating wrongly. `&&`, `||` and `!`
 * need no translation: on booleans GitHub's behave the same, and an output
 * that never arrived is `undefined` here and '' there - unequal to 'false' in
 * both.
 */
function compile(expression) {
  const js = expression
    .replace(/contains\(fromJSON\('(\[[^']*\])'\), (needs\.[\w-]+\.result)\)/g, '$1.includes($2)')
    .replace(/\bcancelled\(\)/g, 'cancelled')
    .replace(/\balways\(\)/g, 'true')
    .replace(
      /\bneeds\.([\w-]+)\.outputs\.([\w-]+)/g,
      (_, job, name) => `needs[${JSON.stringify(job)}].outputs[${JSON.stringify(name)}]`,
    )
    .replace(/\bneeds\.([\w-]+)\.result/g, (_, job) => `needs[${JSON.stringify(job)}].result`)
    .replace(/([!=])=/g, '$1==');
  const rest = js.replace(
    /needs\["[\w-]+"\]\.(?:result|outputs\["[\w-]+"\])|\[(?:"[a-z]+"(?:, )?)+\]\.includes|\bcancelled\b|\btrue\b|'[^']*'|[()!=&|\s]/g,
    '',
  );
  assert.equal(rest, '', `the gate uses a term this test cannot evaluate: ${expression}`);
  const gate = new Function('{ needs, cancelled }', `return ${js};`);
  // No status function means GitHub prepends success(): every job it needs
  // succeeded. A skipped one is not a success.
  if (/\b(?:success|failure|cancelled|always)\(\)/.test(expression)) return gate;
  return (context) =>
    Object.values(context.needs).every((job) => job.result === 'success') && gate(context);
}

const needsOf = (job) => [ci.jobs[job].needs ?? []].flat();

/**
 * Runs checks with `outputs`, then unit, e2e and badges. A job that runs ends
 * with `outcome[job]`, or success; `cancelled` is a cancelled workflow run.
 * Returns each job's result.
 */
function runCi({ checks = 'success', outputs, outcome = {}, cancelled = false }) {
  const jobs = { checks: { result: checks, outputs } };
  for (const job of ['unit', 'e2e', 'badges']) {
    const needs = Object.fromEntries(needsOf(job).map((name) => [name, jobs[name]]));
    const runs = compile(unwrap(ci.jobs[job].if))({ needs, cancelled });
    jobs[job] = { result: runs ? (outcome[job] ?? 'success') : 'skipped', outputs: {} };
  }
  return Object.fromEntries(Object.entries(jobs).map(([job, { result }]) => [job, result]));
}

/** check-code.yml's three outputs, as the strings its `changes` job writes. */
const classified = (docsOnly, unit, e2e) => ({
  'docs-only': String(docsOnly),
  'unit-changed': String(unit),
  'e2e-changed': String(e2e),
});

describe('ci.yml runs each suite only for a change that can affect it', () => {
  const cases = [
    [
      'a source change runs both suites and publishes the badges',
      { outputs: classified(false, true, true) },
      { unit: 'success', e2e: 'success', badges: 'success' },
    ],
    [
      'a docs-only change skips both suites, and the badges stay as they are',
      { outputs: classified(true, false, false) },
      { unit: 'skipped', e2e: 'skipped', badges: 'skipped' },
    ],
    [
      'a Maestro-flows-only change skips unit and still runs E2E',
      { outputs: classified(false, false, true) },
      { unit: 'skipped', e2e: 'success', badges: 'success' },
    ],
    [
      'a unit-test-only change runs unit and skips E2E',
      { outputs: classified(false, true, false) },
      { unit: 'success', e2e: 'skipped', badges: 'success' },
    ],
    [
      'a change neither suite reads (fastlane/ alone) skips both, and the badges',
      { outputs: classified(false, false, false) },
      { unit: 'skipped', e2e: 'skipped', badges: 'skipped' },
    ],
    [
      'a failed unit run keeps E2E from running, and still gets its red badge',
      { outputs: classified(false, true, true), outcome: { unit: 'failure' } },
      { unit: 'failure', e2e: 'skipped', badges: 'success' },
    ],
    [
      'a failed E2E run gets its red badge',
      { outputs: classified(false, true, true), outcome: { e2e: 'failure' } },
      { unit: 'success', e2e: 'failure', badges: 'success' },
    ],
    [
      'failed checks run neither suite, so there is no result to publish',
      { checks: 'failure', outputs: classified(false, true, true) },
      { unit: 'skipped', e2e: 'skipped', badges: 'skipped' },
    ],
    [
      'failed checks on a flows-only change still keep E2E from running',
      { checks: 'failure', outputs: classified(false, false, true) },
      { unit: 'skipped', e2e: 'skipped', badges: 'skipped' },
    ],
    [
      'outputs that never arrived run both suites: the gates fail open',
      { outputs: {} },
      { unit: 'success', e2e: 'success', badges: 'success' },
    ],
    [
      'outputs left empty (detection disabled) run both suites',
      { outputs: { 'docs-only': '', 'unit-changed': '', 'e2e-changed': '' } },
      { unit: 'success', e2e: 'success', badges: 'success' },
    ],
    [
      'a run cancelled during unit starts no E2E and publishes nothing',
      { outputs: classified(false, true, true), outcome: { unit: 'cancelled' }, cancelled: true },
      { unit: 'cancelled', e2e: 'skipped', badges: 'skipped' },
    ],
    [
      'a run cancelled during E2E publishes nothing',
      { outputs: classified(false, true, true), outcome: { e2e: 'cancelled' } },
      { unit: 'success', e2e: 'cancelled', badges: 'skipped' },
    ],
  ];
  for (const [name, scenario, expected] of cases) {
    test(name, () => {
      assert.deepEqual(runCi(scenario), { checks: scenario.checks ?? 'success', ...expected });
    });
  }

  test('unit and E2E read their own class, never the docs-only one', () => {
    assert.match(ci.jobs.unit.if, /needs\.checks\.outputs\.unit-changed != 'false'/);
    assert.match(ci.jobs.e2e.if, /needs\.checks\.outputs\.e2e-changed != 'false'/);
    for (const job of ['unit', 'e2e']) {
      assert.doesNotMatch(ci.jobs[job].if, /docs-only/, `${job} would skip on docs-only alone`);
    }
  });

  test('E2E still needs unit, so a failed unit run never reaches it', () => {
    assert.deepEqual(needsOf('e2e'), ['checks', 'unit']);
  });
});

describe('the gate evaluator itself', () => {
  test('a term it cannot translate fails the file instead of evaluating wrongly', () => {
    assert.throws(() => compile("github.event_name == 'push'"), /cannot evaluate/);
  });

  test('an if: may leave out its expression wrapper', () => {
    const inner = "needs.a.result == 'success'";
    assert.equal(unwrap(inner), inner);
    assert.equal(unwrap(`\${{ ${inner} }}`), inner);
  });
});
