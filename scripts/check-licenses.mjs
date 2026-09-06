#!/usr/bin/env node
// Allowlist check over `pnpm licenses list --json --prod`.
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED = [
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  'MPL-2.0',
  'CC-BY-4.0',
  'Python-2.0',
  'BlueOak-1.0.0',
];

function licenseAllowed(expr) {
  // Strip a single outer paren pair. A package must satisfy ALL conjuncts of
  // an AND expression, but only ONE alternative of an OR expression, so the
  // two operators are not interchangeable: 'GPL-3.0 AND MIT' is only allowed
  // if every conjunct is allowed, while 'MIT OR GPL-3.0' is allowed if any
  // alternative is. Nested/mixed groups beyond this one outer level are
  // conservatively treated as disallowed rather than parsed incorrectly.
  const stripped = expr.replace(/^\(/, '').replace(/\)$/, '');
  if (stripped.includes('(') || stripped.includes(')')) return false;
  return stripped
    .split(/\s+OR\s+/i)
    .some((alt) => alt.split(/\s+AND\s+/i).every((l) => ALLOWED.includes(l.trim())));
}

export function findViolations(report) {
  const out = [];
  for (const [license, pkgs] of Object.entries(report)) {
    if (licenseAllowed(license)) continue;
    for (const p of pkgs) out.push({ name: p.name, license });
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const report = JSON.parse(execSync('pnpm licenses list --json --prod', { encoding: 'utf8' }));
  const violations = findViolations(report);
  if (violations.length) {
    for (const v of violations) console.error(`disallowed license ${v.license}: ${v.name}`);
    process.exit(1);
  }
  console.log('licenses ok');
}
