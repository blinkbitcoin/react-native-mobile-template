#!/usr/bin/env node
// Which `package.json` changes are architecture-relevant. A dependency bump —
// Dependabot's or a hand-written one — only moves version ranges, and the docs
// never describe a range; a change to `scripts`, `engines`, `packageManager`,
// `pnpm`, `expo.install.exclude` or the package identity is what the docs may
// have to follow. `check-docs.sh` uses this so its "architecture changed
// without a docs/ update" warning does not fire on every renovate branch.
//
//   node scripts/manifest-structural.mjs <base-ref> <package.json>...
//
// prints the paths whose change against <base-ref> is structural.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Keys whose changes are dependency bookkeeping, never structure. */
export const DEPENDENCY_KEYS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
  'resolutions',
  'overrides',
  'version',
];

function withoutDependencyKeys(manifest) {
  const copy = { ...manifest };
  for (const key of DEPENDENCY_KEYS) delete copy[key];
  return copy;
}

// Key order in a JSON file is not meaning, so reordering `scripts` must not read
// as a structural change. Objects are serialised with sorted keys; arrays keep
// their order, which in `expo.install.exclude` and friends is also not meaning
// but is cheap to keep stable and never produces a false negative.
function stableJson(value) {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
}

/**
 * True when two manifests differ in anything but dependency ranges and the
 * version. A missing side (the manifest was added or deleted) is always
 * structural.
 */
export function isStructuralManifestChange(before, after) {
  if (!before || !after) return true;
  return stableJson(withoutDependencyKeys(before)) !== stableJson(withoutDependencyKeys(after));
}

/** The manifests among `files` whose change against `base` is structural. */
export function structuralManifests(files, readAt, readNow) {
  return files.filter((file) => isStructuralManifestChange(readAt(file), readNow(file)));
}

function readAtRef(ref, file) {
  try {
    return JSON.parse(
      execFileSync('git', ['show', `${ref}:${file}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'], // absent at that ref: no git noise
      }),
    );
  } catch {
    return undefined; // did not exist at that ref
  }
}

function readWorkingCopy(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined; // deleted, or not valid JSON any more
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [base, ...files] = process.argv.slice(2);
  if (!base) {
    console.error('usage: manifest-structural.mjs <base-ref> <package.json>...');
    process.exit(2);
  }
  for (const file of structuralManifests(files, (f) => readAtRef(base, f), readWorkingCopy)) {
    console.log(file);
  }
}
