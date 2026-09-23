#!/usr/bin/env node
// The findings of a CodeQL SARIF run, as `make codeql` prints them: one line
// per result with its rule id, location and message, marked when an inline
//
//     // codeql[<rule-id>]
//
// comment suppresses it. That marker only does anything because
// .github/codeql/codeql-config.yml loads `AlertSuppression.ql`, which is what
// records the suppression as a `suppressions` entry on the result here.
//
//   node scripts/codeql-findings.mjs <results.sarif>
//
// Exits 1 while any finding is still unsuppressed, so the local run works as a
// pre-push gate. The pure half is exported and tested in codeql-findings.test.mjs.
import { readFileSync } from 'node:fs';

const location = (result) => {
  const physical = result.locations?.[0]?.physicalLocation;
  const uri = physical?.artifactLocation?.uri ?? '<no location>';
  const line = physical?.region?.startLine;
  return line === undefined ? uri : `${uri}:${line}`;
};

/** Every result across the SARIF's runs, in report order. */
export const findings = (sarif) =>
  (sarif.runs ?? []).flatMap((run) =>
    (run.results ?? []).map((result) => ({
      // A result with no ruleId is still a finding; dropping it because it
      // cannot be named is how a real one goes unnoticed.
      ruleId: result.ruleId ?? '<no rule>',
      location: location(result),
      message: (result.message?.text ?? '').replace(/\s+/g, ' ').trim(),
      suppressed: (result.suppressions ?? []).length > 0,
    })),
  );

/** The report lines and the counts for a run. */
export const summarize = (sarif) => {
  const all = findings(sarif);
  const open = all.filter((f) => !f.suppressed).length;
  const suppressed = all.length - open;
  const lines = all.map(
    (f) =>
      `${f.suppressed ? 'suppressed' : 'open      '}  ${f.ruleId}  ${f.location}  ${f.message}`,
  );
  lines.push(
    all.length === 0
      ? 'codeql: no findings'
      : `codeql: ${open} open, ${suppressed} suppressed by an inline marker`,
  );
  return { open, suppressed, lines };
};

/** Command-line entry; returns the exit code. */
export function main(
  argv = process.argv.slice(2),
  { log = console.log, error = console.error } = {},
) {
  const [file] = argv;
  if (!file) {
    error('usage: codeql-findings.mjs <results.sarif>');
    return 2;
  }
  const { open, lines } = summarize(JSON.parse(readFileSync(file, 'utf8')));
  for (const line of lines) log(line);
  return open > 0 ? 1 : 0;
}

if (import.meta.main) process.exitCode = main();
