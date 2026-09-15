#!/usr/bin/env node
// Coverage rows with nothing to cover. A re-export barrel or a type-only module
// has zero statements, so istanbul prints it as 0% in every column while the
// totals stay at 100% — noise that reads as a hole, and a silent way to add an
// untested file without moving the number. The house rule: such modules go in
// `coveragePathIgnorePatterns` with a reason, and this check (run by
// `make coverage`, after the Jest run) fails when one slips through.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SUMMARY_PATH = 'coverage/coverage-summary.json';

/** Files in a coverage-summary.json with no statements at all. */
export function emptyCoverageFiles(summary) {
  return Object.entries(summary)
    .filter(([file, metrics]) => file !== 'total' && metrics?.statements?.total === 0)
    .map(([file]) => file);
}

/** Rows in a coverage-summary.json, excluding the `total` row. */
export function summaryFiles(summary) {
  return Object.keys(summary).filter((file) => file !== 'total');
}

/** One report line per empty file, pointing at the fix. */
export function formatEmptyFiles(files, root = process.cwd()) {
  return files.map(
    (file) =>
      `${path.relative(root, file)} has no statements to cover — add it to coveragePathIgnorePatterns in jest.config.ts, with a reason (re-export barrel or type-only module)`,
  );
}

/**
 * Read and parse the summary. An absent or unreadable report is a failure, not
 * a pass: without it the check would be silently vacuous, which is exactly what
 * happens if `json-summary` is dropped from `coverageReporters`.
 */
export function readSummary(file = SUMMARY_PATH) {
  try {
    return { summary: JSON.parse(readFileSync(file, 'utf8')) };
  } catch (e) {
    return {
      error: `${file} is missing or unreadable (${e.message}) — run \`make coverage\`, and keep 'json-summary' in jest.config.ts's coverageReporters`,
    };
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { summary, error } = readSummary();
  if (error) {
    console.error(error);
    process.exit(1);
  }
  const empty = emptyCoverageFiles(summary);
  if (empty.length > 0) {
    for (const line of formatEmptyFiles(empty)) console.error(line);
    process.exit(1);
  }
  console.log(`coverage: no empty rows (${summaryFiles(summary).length} files)`);
}
