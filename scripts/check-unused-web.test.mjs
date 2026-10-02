import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// playwright.config.ts throws without the ports from the `ports` program of @blinkbitcoin/app-tooling, on
// purpose, and knip only logs "Error loading" and exits 0: the e2e/web specs
// silently stop being entries. check:unused exports the ports first.
const env = { ...process.env, NO_COLOR: '1' };
delete env.WEB_PREVIEW_PORT;
delete env.EXPO_PUBLIC_API_URL;

const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', env });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

test('bare knip, without the ports, cannot load the Playwright config', () => {
  // What makes the next test a real probe: if knip ever stopped printing
  // this, an "Error loading" check would pass whatever the script did.
  const bare = run(path.join(root, 'node_modules/.bin/knip'), []);
  assert.match(bare.output, /Error loading playwright\.config\.ts/);
});

test('check:unused loads the Playwright config, so knip analyses e2e/web', () => {
  const gate = run('pnpm', ['run', '--silent', 'check:unused']);
  assert.doesNotMatch(gate.output, /Error loading/);
  assert.equal(gate.status, 0, gate.output);
});
