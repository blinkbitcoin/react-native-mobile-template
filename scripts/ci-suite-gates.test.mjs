// The gates that let a suite skip a change it cannot affect. check-code.yml's
// `changes` job classifies the diff, and ci.yml turns `e2e-changed` into E2E's
// `if:`. Unit has no gate - its guards read every tracked file - and badges
// reads both suites' results. They are evaluated here as a graph: each
// scenario runs checks, then every job in file order, the way GitHub decides
// them - an `if:` with no status function, or none at all, gets the implicit
// success() that `needs` adds, and a job whose gate is false reports `skipped`
// to the jobs after it. Security runs beside the suites and hands the badges
// its verdict, so it is in the graph too, with the repository variable its
// gate reads.
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
 * An expression as JavaScript over { needs, cancelled, vars }. Only the terms
 * these gates use are translated; anything else is left as text and then
 * rejected, so a new term fails this file instead of evaluating wrongly. `&&`,
 * `||` and `!` need no translation: on booleans and strings GitHub's behave the
 * same, and an output that never arrived is `undefined` here and '' there -
 * unequal to 'false' in both.
 */
function translate(expression) {
  const js = expression
    .replace(/contains\(fromJSON\('(\[[^']*\])'\), (needs\.[\w-]+\.result)\)/g, '$1.includes($2)')
    .replace(/\bcancelled\(\)/g, 'cancelled')
    .replace(/\balways\(\)/g, 'true')
    .replace(/\bvars\.([A-Z_]+)/g, (_, name) => `vars[${JSON.stringify(name)}]`)
    .replace(
      /\bneeds\.([\w-]+)\.outputs\.([\w-]+)/g,
      (_, job, name) => `needs[${JSON.stringify(job)}].outputs[${JSON.stringify(name)}]`,
    )
    .replace(/\bneeds\.([\w-]+)\.result/g, (_, job) => `needs[${JSON.stringify(job)}].result`)
    .replace(/([!=])=/g, '$1==');
  const rest = js.replace(
    /needs\["[\w-]+"\]\.(?:result|outputs\["[\w-]+"\])|vars\["[A-Z_]+"\]|\[(?:"[a-z]+"(?:, )?)+\]\.includes|\bcancelled\b|\btrue\b|'[^']*'|[()!=&|\s]/g,
    '',
  );
  assert.equal(rest, '', `the gate uses a term this test cannot evaluate: ${expression}`);
  return js;
}

/** A job's `if:` as a JS function of { needs, cancelled, vars }. */
function compile(expression) {
  const gate = new Function('{ needs, cancelled, vars }', `return ${translate(expression)};`);
  // No status function means GitHub prepends success(): every job it needs
  // succeeded. A skipped one is not a success.
  if (/\b(?:success|failure|cancelled|always)\(\)/.test(expression)) return gate;
  return (context) =>
    Object.values(context.needs).every((job) => job.result === 'success') && gate(context);
}

const needsOf = (job) => [ci.jobs[job].needs ?? []].flat();

/**
 * Runs checks with `outputs`, then unit, e2e, security and badges. A job that
 * runs ends with `outcome[job]`, or success; `cancelled` is a cancelled
 * workflow run; `vars` are the repository variables; a Security that runs
 * outputs `securityVerdict`. Returns each job's result.
 */
function runCi({
  checks = 'success',
  outputs,
  outcome = {},
  cancelled = false,
  vars = {},
  securityVerdict,
}) {
  const jobs = { checks: { result: checks, outputs } };
  for (const job of ['unit', 'e2e', 'security', 'badges']) {
    const needs = Object.fromEntries(needsOf(job).map((name) => [name, jobs[name]]));
    // No `if:` is GitHub's default success(): 'true' behind the implicit one.
    const runs = compile(unwrap(ci.jobs[job].if ?? 'true'))({ needs, cancelled, vars });
    const result = runs ? (outcome[job] ?? 'success') : 'skipped';
    const jobOutputs =
      job === 'security' && result !== 'skipped' ? { verdict: securityVerdict } : {};
    jobs[job] = { result, outputs: jobOutputs };
  }
  return Object.fromEntries(Object.entries(jobs).map(([job, { result }]) => [job, result]));
}

/** check-code.yml's three outputs, as the strings its `changes` job writes. */
const classified = (docsOnly, unit, e2e) => ({
  'docs-only': String(docsOnly),
  'unit-changed': String(unit),
  'e2e-changed': String(e2e),
});

describe('ci.yml runs E2E only for a change that can affect it, and Unit on every change', () => {
  const cases = [
    [
      'a source change runs both suites and publishes the badges',
      { outputs: classified(false, true, true) },
      { unit: 'success', e2e: 'success', security: 'success', badges: 'success' },
    ],
    [
      'a docs-only change runs Unit, whose guards read docs, skips E2E, and publishes',
      { outputs: classified(true, false, false) },
      { unit: 'success', e2e: 'skipped', security: 'skipped', badges: 'success' },
    ],
    [
      'a Maestro-flows-only change runs both suites',
      { outputs: classified(false, false, true) },
      { unit: 'success', e2e: 'success', security: 'success', badges: 'success' },
    ],
    [
      'a unit-test-only change runs Unit and skips E2E',
      { outputs: classified(false, true, false) },
      { unit: 'success', e2e: 'skipped', security: 'success', badges: 'success' },
    ],
    [
      'a fastlane/-only change still runs Unit, whose guards read it too',
      { outputs: classified(false, false, false) },
      { unit: 'success', e2e: 'skipped', security: 'success', badges: 'success' },
    ],
    [
      'a failed unit run keeps E2E from running, and still gets its red badge',
      { outputs: classified(false, true, true), outcome: { unit: 'failure' } },
      { unit: 'failure', e2e: 'skipped', security: 'success', badges: 'success' },
    ],
    [
      'a failed E2E run gets its red badge',
      { outputs: classified(false, true, true), outcome: { e2e: 'failure' } },
      { unit: 'success', e2e: 'failure', security: 'success', badges: 'success' },
    ],
    [
      'failed checks run neither suite, so there is no result to publish',
      { checks: 'failure', outputs: classified(false, true, true) },
      { unit: 'skipped', e2e: 'skipped', security: 'skipped', badges: 'skipped' },
    ],
    [
      'failed checks on a docs-only change publish nothing either',
      { checks: 'failure', outputs: classified(true, false, false) },
      { unit: 'skipped', e2e: 'skipped', security: 'skipped', badges: 'skipped' },
    ],
    [
      'outputs that never arrived run both suites: the gates fail open',
      { outputs: {} },
      { unit: 'success', e2e: 'success', security: 'success', badges: 'success' },
    ],
    [
      'outputs left empty (detection disabled) run both suites',
      { outputs: { 'docs-only': '', 'unit-changed': '', 'e2e-changed': '' } },
      { unit: 'success', e2e: 'success', security: 'success', badges: 'success' },
    ],
    [
      'a run cancelled during unit starts no E2E and publishes nothing',
      {
        outputs: classified(false, true, true),
        outcome: { unit: 'cancelled', security: 'cancelled' },
        cancelled: true,
      },
      { unit: 'cancelled', e2e: 'skipped', security: 'cancelled', badges: 'skipped' },
    ],
    [
      'a run cancelled during E2E publishes nothing',
      { outputs: classified(false, true, true), outcome: { e2e: 'cancelled' } },
      { unit: 'success', e2e: 'cancelled', security: 'success', badges: 'skipped' },
    ],
    [
      'a Security run that failed on findings still gets its red badge',
      { outputs: classified(false, true, true), outcome: { security: 'failure' } },
      { unit: 'success', e2e: 'success', security: 'failure', badges: 'success' },
    ],
    [
      'Security switched off for the repository still publishes the suites',
      { outputs: classified(false, true, true), vars: { SECURITY_ENABLED: 'false' } },
      { unit: 'success', e2e: 'success', security: 'skipped', badges: 'success' },
    ],
    [
      'a run cancelled during Security publishes nothing',
      { outputs: classified(false, true, true), outcome: { security: 'cancelled' } },
      { unit: 'success', e2e: 'success', security: 'cancelled', badges: 'skipped' },
    ],
  ];
  for (const [name, scenario, expected] of cases) {
    test(name, () => {
      assert.deepEqual(runCi(scenario), { checks: scenario.checks ?? 'success', ...expected });
    });
  }

  test('Unit has no gate of its own: its guards read every tracked file', () => {
    // A gate on unit-changed skipped a change to .maestro/, fastlane/ or docs
    // alone, all of which ports.test.mjs and shell-locale.test.mjs read.
    assert.equal(ci.jobs.unit.if, undefined);
  });

  test('E2E reads its own class, never the docs-only one', () => {
    assert.match(ci.jobs.e2e.if, /needs\.checks\.outputs\.e2e-changed != 'false'/);
    assert.doesNotMatch(ci.jobs.e2e.if, /docs-only/);
  });

  test('E2E still runs past a skipped unit, as the consumer guide gates it', () => {
    const e2e = compile(unwrap(ci.jobs.e2e.if));
    const checks = { result: 'success', outputs: classified(false, false, true) };
    assert.equal(e2e({ needs: { checks, unit: { result: 'skipped' } }, cancelled: false }), true);
  });

  test('E2E still needs unit, so a failed unit run never reaches it', () => {
    assert.deepEqual(needsOf('e2e'), ['checks', 'unit']);
  });

  test('the badges call passes no docs-only, which publish-badges.yml would skip on', () => {
    // A docs-only change runs Unit now, so its result is worth publishing.
    assert.equal(ci.jobs.badges.with['docs-only'], undefined);
    assert.doesNotMatch(ci.jobs.badges.if, /docs-only/);
  });
});

describe('ci.yml hands the badges the security verdict, or nothing to keep the published one', () => {
  const value = (context) =>
    new Function(
      '{ needs, vars }',
      `return ${translate(unwrap(ci.jobs.badges.with['security-verdict'] ?? "''"))};`,
    )(context);
  const verdict = '{"verdict":"pass","highest":"none","canBlock":true}';

  test('a verdict passes through as it is', () => {
    assert.equal(value({ needs: { security: { outputs: { verdict } } }, vars: {} }), verdict);
  });

  test('Security switched off for the repository reads as disabled', () => {
    assert.equal(
      value({ needs: { security: { outputs: {} } }, vars: { SECURITY_ENABLED: 'false' } }),
      '{"verdict":"disabled"}',
    );
  });

  test('a docs-only change, where Security skipped, hands over nothing', () => {
    assert.equal(value({ needs: { security: { outputs: {} } }, vars: {} }), '');
  });

  test('the badges wait for Security', () => {
    assert.ok(needsOf('badges').includes('security'));
  });
});

describe('the gate evaluator itself', () => {
  test('a term it cannot translate fails the file instead of evaluating wrongly', () => {
    assert.throws(() => compile("github.event_name == 'push'"), /cannot evaluate/);
  });

  test('a repository variable is read from vars', () => {
    assert.equal(
      translate("vars.SECURITY_ENABLED == 'false'"),
      `vars["SECURITY_ENABLED"] === 'false'`,
    );
  });

  test('an if: may leave out its expression wrapper', () => {
    const inner = "needs.a.result == 'success'";
    assert.equal(unwrap(inner), inner);
    assert.equal(unwrap(`\${{ ${inner} }}`), inner);
  });
});
