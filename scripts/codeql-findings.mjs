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
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [file] = process.argv.slice(2);
  if (!file) {
    console.error('usage: codeql-findings.mjs <results.sarif>');
    process.exit(2);
  }
  const { open, lines } = summarize(JSON.parse(readFileSync(file, 'utf8')));
  for (const line of lines) console.log(line);
  process.exit(open > 0 ? 1 : 0);
}
