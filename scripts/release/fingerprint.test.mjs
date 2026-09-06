// Guards the OTA runtime version. `runtimeVersion: { policy: 'fingerprint' }`
// means a fingerprint that moves on a version bump makes every published
// update incompatible with every shipped build — and @expo/fingerprint fails
// open (it swallows a broken fingerprint.config.js and silently reverts to the
// defaults), so this has to be asserted, not assumed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
// Static, unqualified specifier on purpose: if @expo/fingerprint is not
// resolvable from this repo (a dangling pnpm link, a lockfile that names a
// snapshot that was never written), this import fails and the whole file
// fails loudly — which is exactly the failure mode being guarded.
import { createFingerprintAsync } from '@expo/fingerprint';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const requireFromRoot = createRequire(path.join(repoRoot, 'package.json'));

/**
 * iOS fingerprint hash, computed in a child process that reaches the library
 * through a plain `require` from the repo root — deliberately not through
 * node_modules/.bin/fingerprint, whose shim exports NODE_PATH and can make a
 * package resolve inside that one invocation and nowhere else.
 */
function fingerprintHash(env = {}) {
  const script =
    "require('@expo/fingerprint')" +
    ".createFingerprintAsync(process.cwd(), { platforms: ['ios'] })" +
    '.then((f) => process.stdout.write(f.hash));';
  return execFileSync(process.execPath, ['-e', script], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, APP_VERSION: '', APP_BUILD_NUMBER: '', ...env },
  });
}

test('@expo/fingerprint resolves from the repo root without a bin shim', () => {
  assert.equal(typeof createFingerprintAsync, 'function');
  assert.match(requireFromRoot('@expo/fingerprint/package.json').version, /^\d+\.\d+\.\d+/);
  assert.equal(typeof requireFromRoot('@expo/fingerprint').createFingerprintAsync, 'function');
});

test('fingerprint.config.js skips the library default and the config versions', () => {
  // A config `sourceSkips` replaces DEFAULT_SOURCE_SKIPS instead of merging
  // with it, so the default must be listed alongside ExpoConfigVersions.
  const { sourceSkips } = requireFromRoot('./fingerprint.config.js');
  assert.deepEqual([...sourceSkips].sort(), [
    'ExpoConfigVersions',
    'PackageJsonAndroidAndIosScriptsIfNotContainRun',
  ]);
});

test('a version bump does not move the fingerprint', () => {
  const base = fingerprintHash();
  const bumped = fingerprintHash({ APP_VERSION: '9.9.9', APP_BUILD_NUMBER: '777' });
  assert.match(base, /^[0-9a-f]{40}$/);
  assert.equal(bumped, base);
});
