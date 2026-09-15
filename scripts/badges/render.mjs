#!/usr/bin/env node
// `pnpm badges:render` — the contract the reusable `badges.yml` calls through
// `scripts/checks/run-script.sh`, exactly the way `checks.yml` delegates
// typecheck and lint. That wrapper runs `pnpm run NAME` with no arguments, so
// everything variable arrives as environment:
//
//   BADGE_UNIT / BADGE_E2E        GitHub job results (`needs.<job>.result`)
//   BADGE_UNIT_LABEL / ..._E2E_   badge labels (default Unit / E2E)
//   BADGE_COVERAGE                measure | failing | pending | skip
//                                 (default: derived from BADGE_UNIT)
//   BADGE_COVERAGE_SUMMARY        coverage/coverage-summary.json
//   BADGE_OUT_DIR                 coverage/badge
//
// The coverage default is the rule the plan calls out: only a Unit *failure*
// writes the red placeholder. A skipped Unit — a docs-only change, a cancelled
// upstream — renders no coverage badge at all, so publishing leaves the
// branch's existing one untouched instead of blanking it.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BadgeError } from './badge.mjs';
import { BADGE_DIR, SUMMARY_PATH, writeCoverageBadge } from './coverage-badge.mjs';
import { writeStatusBadge } from './status-badge.mjs';

/** What to do about the coverage badge, given the Unit job's result. */
export function coverageModeFor(unitResult) {
  if (unitResult === 'success') return 'measure';
  if (unitResult === 'failure') return 'failing';
  return 'skip';
}

/** Render every badge the env asks for; returns the file names written. */
export function renderBadges(env = process.env) {
  const outDir = env.BADGE_OUT_DIR || BADGE_DIR;
  const unit = env.BADGE_UNIT || '';
  const e2e = env.BADGE_E2E || '';
  const written = [];

  const mode = env.BADGE_COVERAGE || coverageModeFor(unit);
  if (mode !== 'skip') {
    const { message, detail } = writeCoverageBadge({
      outDir,
      summaryFile: env.BADGE_COVERAGE_SUMMARY || SUMMARY_PATH,
      status: mode === 'measure' ? null : mode,
    });
    console.log(`badges: Coverage ${message} (${detail})`);
    written.push('coverage.svg');
  } else {
    console.log(`badges: no coverage badge (unit result "${unit}") — leaving the published one`);
  }

  for (const [name, label, result] of [
    ['unit', env.BADGE_UNIT_LABEL || 'Unit', unit],
    ['e2e', env.BADGE_E2E_LABEL || 'E2E', e2e],
  ]) {
    const badge = writeStatusBadge({ outDir, name, label, result });
    console.log(`badges: ${badge.label} ${badge.message}`);
    written.push(`${name}.svg`);
  }
  return written;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    renderBadges();
  } catch (e) {
    if (!(e instanceof BadgeError)) throw e;
    console.error(e.message);
    process.exit(1);
  }
}
