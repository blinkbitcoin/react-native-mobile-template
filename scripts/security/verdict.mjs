#!/usr/bin/env node
// Merges the scanners' SARIF files into one verdict.
//
//     node scripts/security/verdict.mjs .security
//
// Exits 1 when a finding at or above the configured severity comes from a job
// whose engine class is listed in failOn. Every other case exits 0: a finding
// never fails its own scanner, and an engine outside failOn annotates only.
// The same file runs locally and in CI, so `make check-security` gives the
// answer the pipeline will give.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { load, SEVERITIES } from './config.mjs';

/** Which engine class each job belongs to. failOn names classes, not jobs. */
export const ENGINE_OF = {
  deps: 'deterministic',
  code: 'deterministic',
  policy: 'deterministic',
  sbom: 'deterministic',
  bundle: 'deterministic',
  mobile: 'deterministic',
  binaries: 'deterministic',
  review: 'review',
  openant: 'openant',
};

export const ORDER = ['low', 'medium', 'high', 'critical'];

const FROM_LEVEL = { error: 'high', warning: 'medium', note: 'low' };

// SARIF puts a rule's numeric severity on tool.driver.rules[], not on the
// result - a scanner reports "this result fired ruleId X" and expects a
// reader to look X up. osv-scanner does exactly that: every result is
// `level: warning` regardless of score, and the CVSS number lives only on
// the matching rule. CodeQL uses the same convention, so a result's own
// properties are checked first (a scanner is free to repeat the score there)
// and the owning rule is the fallback, not a special case.
/** GitHub's numeric scale first (result, then its rule), the SARIF level last. */
export const severityOf = (result, rule) => {
  const score = Number(
    result.properties?.['security-severity'] ?? rule?.properties?.['security-severity'],
  );
  if (Number.isFinite(score)) {
    if (score >= 9) return 'critical';
    if (score >= 7) return 'high';
    if (score >= 4) return 'medium';
    return 'low';
  }
  return FROM_LEVEL[result.level] ?? 'medium';
};

const rulesOf = (run) =>
  Object.fromEntries((run.tool?.driver?.rules ?? []).map((rule) => [rule.id, rule]));

const resultsOf = (document) =>
  (document.runs ?? []).flatMap((run) => {
    const rules = rulesOf(run);
    return (run.results ?? [])
      .filter((r) => !(r.suppressions ?? []).length)
      .map((result) => ({ result, rule: rules[result.ruleId] }));
  });

const ranOf = (document) =>
  (document.runs ?? []).every((run) =>
    (run.invocations ?? []).every((i) => i.executionSuccessful !== false),
  );

/** Counts, the highest severity seen, which jobs skipped, and every finding. */
export const summarize = (entries) => {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  const skipped = [];
  const findings = [];
  for (const { job, document } of entries) {
    if (!ranOf(document)) skipped.push(job);
    for (const { result, rule } of resultsOf(document)) {
      const severity = severityOf(result, rule);
      counts[severity] += 1;
      findings.push({
        job,
        severity,
        ruleId: result.ruleId ?? '<no rule>',
        message: result.message?.text ?? '',
      });
    }
  }
  const highest = [...ORDER].reverse().find((s) => counts[s] > 0) ?? 'none';
  return { counts, highest, skipped, findings };
};

/** The verdict, its exit code and the lines to print. */
export const verdict = ({ entries, severity, failOn }) => {
  // This is the only module allowed to fail a run, so it does not trust a
  // caller to have validated severity already: an unrecognized value throws
  // rather than silently behaving like 'none' (report, never block).
  if (!SEVERITIES.includes(severity)) {
    throw new Error(
      `severity: expected one of ${SEVERITIES.join(', ')}, got ${JSON.stringify(severity)}`,
    );
  }
  const { counts, highest, skipped, findings } = summarize(entries);
  const floor = ORDER.indexOf(severity);
  // 'none' (floor < 0) reports everything as informational but never blocks;
  // any other severity drops findings below the floor from both buckets, so
  // a below-threshold finding reads as clean rather than informational.
  const reportable = findings.filter((f) => floor < 0 || ORDER.indexOf(f.severity) >= floor);
  const blocking = floor >= 0 ? reportable.filter((f) => failOn.includes(ENGINE_OF[f.job])) : [];
  const lines = entries.map(({ job, document }) => {
    if (skipped.includes(job)) {
      const note = (document.runs ?? [])
        .flatMap((run) =>
          (run.invocations ?? []).flatMap((i) => i.toolExecutionNotifications ?? []),
        )
        .map((n) => n.message?.text)
        .filter(Boolean)[0];
      return `${job}: ${note ?? 'skipped: no reason given'}`;
    }
    const mine = findings.filter((f) => f.job === job);
    if (mine.length === 0) return `${job}: clean`;
    const worst = [...ORDER].reverse().find((s) => mine.some((f) => f.severity === s));
    return `${job}: ${mine.length} finding(s), highest ${worst}`;
  });
  for (const finding of findings) {
    lines.push(`  ${finding.severity}\t${finding.job}\t${finding.ruleId}\t${finding.message}`);
  }
  const name = blocking.length > 0 ? 'fail' : reportable.length > 0 ? 'informational' : 'pass';
  lines.push(
    `security: ${name}, highest ${highest}, ${findings.length} finding(s), ${skipped.length} job(s) skipped`,
  );
  return { verdict: name, highest, counts, lines, exitCode: blocking.length > 0 ? 1 : 0 };
};

const read = (dir) =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.sarif'))
    .sort()
    .map((name) => ({
      job: path.basename(name, '.sarif'),
      document: JSON.parse(readFileSync(path.join(dir, name), 'utf8')),
    }));

/** Command-line entry; returns the exit code. */
export function main(
  argv = process.argv.slice(2),
  { log = console.log, error = console.error, env = process.env, readEntries = read } = {},
) {
  const dir = argv[0] ?? '.security';
  let entries;
  try {
    entries = readEntries(dir);
  } catch {
    error(`no SARIF files in ${dir}: run a scanner first`);
    return 2;
  }
  const settings = load('security-policy.json', env);
  const outcome = verdict({ entries, severity: settings.severity, failOn: settings.failOn });
  for (const line of outcome.lines) log(line);
  return outcome.exitCode;
}

if (import.meta.main) process.exitCode = main();
