// This repo ships its own `build-info.sh` (the local DRY_RUN rehearsal), while
// CI writes the release's build-info.json with shared-workflows' copy. The two
// are contract-identical, not byte-identical: ours also resolves the version
// when APP_VERSION is unset and computes the fingerprints itself. A drift in
// the record they write means a local rehearsal that says one thing and a
// release that does another. (`resolve-version.sh` has no copy here any more:
// `make version` runs the shared one from @blinkbitcoin/dev-config.)
//
// This case compares our copy with shared-workflows' copy. It lives here, not
// over there: shared-workflows defines the contract and never checks out a
// consumer, and it is this repo that has to follow. In CI the shared copy is the
// one this run's workflows were called at - the setup action checks it out at
// $WORKFLOWS_DIR - so the Dependabot PR moving the pin is also when a drift turns red here.
//
// Locally there is no $WORKFLOWS_DIR unless you point it at a checkout
// (`WORKFLOWS_DIR=../shared-workflows make test-scripts`), and the case skips
// saying so. In CI a missing $WORKFLOWS_DIR fails: a comparison that silently
// ran against nothing is the failure this case exists to prevent.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = (name) => fileURLToPath(new URL(`./${name}`, import.meta.url));

/** The shared-workflows copy of `name`, or a reason the comparison cannot run. */
function sharedCopy(name) {
  const dir = process.env.WORKFLOWS_DIR;
  if (!dir) {
    if (process.env.GITHUB_ACTIONS === 'true') {
      throw new Error(
        'WORKFLOWS_DIR is not set in CI - the setup action exports it; without it the copies were NOT compared',
      );
    }
    return {
      skip: 'WORKFLOWS_DIR not set: our copy was NOT compared with shared-workflows (set it to a checkout to compare)',
    };
  }
  const file = path.resolve(dir, 'scripts', 'release', name);
  if (!existsSync(file)) throw new Error(`no shared copy at ${file}`);
  return { file };
}

// build-info.sh shells out to @expo/fingerprint, so running the shared copy
// here would need its own node_modules. What drifted before is caught from the
// source: a key added, renamed or dropped on one side, and the choice of
// installed over declared versions.
test('build-info.sh: our copy and shared-workflows write the same keys and read installed versions', (t) => {
  const shared = sharedCopy('build-info.sh');
  if (shared.skip) return t.skip(shared.skip);
  // The record is one object literal indented two spaces inside a node program
  // in both copies, so its top-level keys are the two-space `key:` lines.
  const keys = (file) =>
    [...readFileSync(file, 'utf8').matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*):/gm)].map((m) => m[1]);
  const ours = here('build-info.sh');
  assert.deepEqual(keys(ours), keys(shared.file), 'the two copies write different top-level keys');
  for (const file of [ours, shared.file]) {
    const text = readFileSync(file, 'utf8');
    assert.match(text, /installed\("expo"\)/, `${file} no longer reads the installed expo version`);
    assert.match(
      text,
      /installed\("react-native"\)/,
      `${file} no longer reads the installed react-native version`,
    );
    assert.match(text, /ios:/, `${file} has no fingerprint.ios`);
    assert.match(text, /android:/, `${file} has no fingerprint.android`);
  }
});
