#!/usr/bin/env node
// The shared tooling package, @blinkbitcoin/dev-config, is a git dependency on
// shared-workflows at the very commit every workflow call pins
// (docs/decisions/0024-shared-tooling-at-the-workflows-pin.md). One commit
// covers both, so a laptop runs the same contract check and tool table that CI
// runs from its own checkout of that commit.
//
// Dependabot moves the workflow pins and cannot move a git dependency with
// them, so the two part company on every bump. `toolingProblems` is what
// scripts/workflow-contract.test.mjs asserts empty; `main` (`make
// fix-tooling-pin`) repoints package.json at the pin and refreshes the lockfile.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinsIn, SHARED } from './lib/workflow-calls.mjs';

export const PACKAGE = '@blinkbitcoin/dev-config';
const SUBDIRECTORY = '/packages/dev-config';

/** The dependency spec that takes the package from shared-workflows at `commit`. */
export function toolingSpec(commit) {
  return `github:${SHARED}#${commit}&path:${SUBDIRECTORY}`;
}

/** The lockfile's resolved version for the package at `commit`, as pnpm writes it. */
export function lockedVersion(commit) {
  return `https://codeload.github.com/${SHARED}/tar.gz/${commit}#path:${SUBDIRECTORY}`;
}

/** The one commit every shared-workflows call under `root` pins; throws otherwise. */
export function workflowsPin(root) {
  const dir = path.join(root, '.github', 'workflows');
  const refs = new Set(
    readdirSync(dir)
      .filter((name) => name.endsWith('.yml'))
      .flatMap((name) => pinsIn(readFileSync(path.join(dir, name), 'utf8')).map((pin) => pin.ref)),
  );
  if (refs.size !== 1) {
    throw new Error(
      `the workflows must pin shared-workflows at exactly one commit, and pin ${refs.size === 0 ? 'none' : [...refs].join(', ')}`,
    );
  }
  return [...refs][0];
}

/** Every way package.json and the lockfile disagree with the workflows pin. */
export function toolingProblems(root) {
  const pin = workflowsPin(root);
  const problems = [];
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const spec = manifest.devDependencies?.[PACKAGE];
  if (spec !== toolingSpec(pin)) {
    problems.push(
      `package.json takes ${PACKAGE} as ${spec ?? 'nothing'}, but the workflows pin ${pin}: run \`make fix-tooling-pin\``,
    );
  }
  const lockfile = readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8');
  if (!lockfile.includes(`version: ${lockedVersion(pin)}\n`)) {
    problems.push(
      `pnpm-lock.yaml does not resolve ${PACKAGE} at ${pin}: run \`make fix-tooling-pin\``,
    );
  }
  return problems;
}

/**
 * Command-line entry: repoint the package at the workflows pin, in `root` (the
 * repository by default); returns the exit code.
 */
export function main(
  root = fileURLToPath(new URL('..', import.meta.url)),
  { log = console.log, error = console.error, exec = execFileSync } = {},
) {
  let pin;
  try {
    pin = workflowsPin(root);
  } catch (e) {
    error(e.message);
    return 1;
  }
  const file = path.join(root, 'package.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  manifest.devDependencies = { ...manifest.devDependencies, [PACKAGE]: toolingSpec(pin) };
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  exec('pnpm', ['install'], { cwd: root, stdio: 'inherit' });
  const problems = toolingProblems(root);
  if (problems.length > 0) {
    for (const problem of problems) error(problem);
    return 1;
  }
  log(`${PACKAGE} is at the workflows pin, ${pin}`);
  return 0;
}

if (import.meta.main) process.exitCode = main(process.argv[2]);
