// Tests for the decision-making inside the release verification gates.
//
// The gates themselves need a 90 MB build to run against; their *decisions* do
// not. Every rule that can fail a release lives in
// scripts/release/lib/verify-common.sh as a small function that takes text and
// prints `<status> <detail>`, and each one is called here through `bash -c`
// exactly as the gates call it.
//
// The end-to-end cases build a fake .app out of an XML Info.plist and a text
// file standing in for the JS bundle -- no binaries are committed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const lib = path.join(here, 'lib', 'verify-common.sh');
const verifyIos = path.join(here, 'verify-ios.sh');

/** Sources the helper library and runs one snippet, returning trimmed stdout. */
function sh(snippet, env = {}) {
  return execFileSync('bash', ['-c', `set -euo pipefail; . "${lib}"; ${snippet}`], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  }).trim();
}

/** Runs a gate script and returns { status, stdout } instead of throwing. */
function run(script, args, env = {}) {
  try {
    const stdout = execFileSync('bash', [script, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
    return { status: 0, stdout };
  } catch (error) {
    return { status: error.status, stdout: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'verify-test-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Architecture
// ---------------------------------------------------------------------------

test('arm64-only binaries pass the architecture check', () => {
  assert.equal(sh('vc_arch_verdict "arm64"'), 'ok arm64 only');
});

test('a simulator slice fails the architecture check', () => {
  assert.match(
    sh('vc_arch_verdict "x86_64 arm64"'),
    /^FAIL expected arm64 only, got arm64 x86_64$/,
  );
});

test('an empty lipo result fails rather than passing silently', () => {
  assert.equal(sh('vc_arch_verdict ""'), 'FAIL no architectures reported');
});

// ---------------------------------------------------------------------------
// Android ABIs
// ---------------------------------------------------------------------------

const armEntries = 'base/lib/arm64-v8a/libhermes.so\\nbase/lib/armeabi-v7a/libhermes.so';

test('arm-only libraries pass the ABI check', () => {
  assert.equal(sh(`vc_abi_verdict "$(printf '${armEntries}')"`), 'ok arm64-v8a armeabi-v7a');
});

test('an x86 library fails the ABI check', () => {
  const entries = `${armEntries}\\nbase/lib/x86_64/libhermes.so`;
  assert.match(
    sh(`vc_abi_verdict "$(printf '${entries}')"`),
    /^FAIL forbidden ABI present: x86_64/,
  );
});

test('an artifact with no arm library fails the ABI check', () => {
  assert.equal(
    sh(`vc_abi_verdict "$(printf 'base/lib/x86/libhermes.so')"`),
    'FAIL forbidden ABI present: x86 (all: x86)',
  );
});

test('an artifact with no native libraries at all fails', () => {
  assert.equal(sh('vc_abi_verdict "base/res/drawable/icon.png"'), 'FAIL no native libraries found');
});

// ---------------------------------------------------------------------------
// aapt2 badging parsing
// ---------------------------------------------------------------------------

const badging = [
  "package: name='com.example.rnmt' versionCode='42' versionName='1.2.3' compileSdkVersion='36'",
  "minSdkVersion:'24'",
  "targetSdkVersion:'36'",
  "uses-permission: name='android.permission.INTERNET'",
  "application-label:'RN Mobile Template'",
].join('\n');

/** aapt2 output is full of single quotes, so it goes through a file, not argv. */
function withBadging(text, fn) {
  return withTempDir((dir) => {
    const file = path.join(dir, 'badging.txt');
    writeFileSync(file, `${text}\n`);
    return fn(`"$(cat '${file}')"`);
  });
}

test('badging fields come off the package line, not a permission line', () =>
  withBadging(badging, (arg) => {
    assert.equal(sh(`vc_badging_field ${arg} name`), 'com.example.rnmt');
    assert.equal(sh(`vc_badging_field ${arg} versionCode`), '42');
    assert.equal(sh(`vc_badging_field ${arg} versionName`), '1.2.3');
    assert.equal(sh(`vc_badging_line_value ${arg} minSdkVersion`), '24');
  }));

test('a release build that is debuggable fails', () => {
  withBadging(`${badging}\napplication-debuggable`, (arg) => {
    assert.equal(sh(`vc_debuggable_verdict ${arg}`), 'FAIL application-debuggable is set');
  });
  withBadging(badging, (arg) => {
    assert.equal(sh(`vc_debuggable_verdict ${arg}`), 'ok not debuggable');
  });
});

test('minSdk below the floor fails and at or above it passes', () => {
  assert.equal(sh('vc_min_sdk_verdict 24 24'), 'ok minSdk 24 (>= 24)');
  assert.equal(sh('vc_min_sdk_verdict 21 24'), 'FAIL minSdk 21 is below the supported minimum 24');
  assert.match(sh('vc_min_sdk_verdict "" 24'), /^FAIL could not read minSdkVersion/);
});

// ---------------------------------------------------------------------------
// JS bundle
// ---------------------------------------------------------------------------

test('a bundle that names the Metro dev server fails', () =>
  withTempDir((dir) => {
    const bundle = path.join(dir, 'main.jsbundle');
    writeFileSync(bundle, 'var url = "http://localhost:8081/index.bundle";\n');
    assert.match(
      sh(`vc_dev_server_verdict "${bundle}"`),
      /^FAIL bundle references a Metro dev server: http:\/\/localhost:8081/,
    );
  }));

test('the emulator loopback address counts as a dev server too', () =>
  withTempDir((dir) => {
    const bundle = path.join(dir, 'index.android.bundle');
    writeFileSync(bundle, 'fetch("http://10.0.2.2:8081/status")');
    assert.match(sh(`vc_dev_server_verdict "${bundle}"`), /^FAIL .*10\.0\.2\.2:8081/);
  }));

test('a clean bundle passes the dev-server check', () =>
  withTempDir((dir) => {
    const bundle = path.join(dir, 'main.jsbundle');
    writeFileSync(bundle, 'var url = "https://api.example.com/graphql";\n');
    assert.equal(sh(`vc_dev_server_verdict "${bundle}"`), 'ok no dev-server URL in the bundle');
  }));

test('a missing bundle fails rather than being skipped', () => {
  assert.match(sh('vc_dev_server_verdict "/nope/main.jsbundle"'), /^FAIL no JS bundle at/);
});

test('an asset baked with a dev-server origin warns instead of failing', () =>
  withTempDir((dir) => {
    const bundle = path.join(dir, 'main.jsbundle');
    writeFileSync(bundle, 'uri:"http://localhost:8081/assets/node_modules/pkg/font"');
    assert.match(
      sh(`vc_dev_server_verdict "${bundle}"`),
      /^warn asset\(s\) baked with a dev-server origin/,
    );
  }));

test('a dev-server asset does not excuse dev-server code in the same bundle', () =>
  withTempDir((dir) => {
    const bundle = path.join(dir, 'main.jsbundle');
    writeFileSync(
      bundle,
      'a="http://localhost:8081/assets/x";b="http://localhost:8081/index.bundle"',
    );
    assert.match(sh(`vc_dev_server_verdict "${bundle}"`), /^FAIL .*localhost:8081\/index\.bundle/);
  }));

test('Hermes bytecode is recognised by its magic and plain JS is not', () =>
  withTempDir((dir) => {
    const hermes = path.join(dir, 'hermes.bundle');
    writeFileSync(
      hermes,
      Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f, 0x00, 0x00]),
    );
    assert.equal(sh(`vc_hermes_verdict "${hermes}"`), 'ok Hermes bytecode');

    const plain = path.join(dir, 'plain.bundle');
    writeFileSync(plain, 'var __d = function () {};\n');
    assert.match(sh(`vc_hermes_verdict "${plain}"`), /^FAIL not Hermes bytecode/);
  }));

// ---------------------------------------------------------------------------
// EXPO_PUBLIC_*
// ---------------------------------------------------------------------------

const envExample = [
  '# comment',
  'EXPO_PUBLIC_API_URL=http://localhost:4000/graphql',
  'EXPO_PUBLIC_APP_NAME=RN Mobile Template',
  'EXPO_PUBLIC_WEB_DOMAIN=',
  '# APP_VERSION is not public',
  'APP_VERSION=1.2.3',
].join('\n');

test('EXPO_PUBLIC_ names are read out of .env.example, build-time names are not', () =>
  withTempDir((dir) => {
    const file = path.join(dir, '.env.example');
    writeFileSync(file, envExample);
    const out = sh(`vc_public_env_names "$(cat '${file}')"`);
    assert.deepEqual(out.split('\n'), [
      'EXPO_PUBLIC_API_URL',
      'EXPO_PUBLIC_APP_NAME',
      'EXPO_PUBLIC_WEB_DOMAIN',
    ]);
  }));

test('a set EXPO_PUBLIC_ value must be inlined in the bundle', () =>
  withTempDir((dir) => {
    const file = path.join(dir, '.env.example');
    writeFileSync(file, envExample);
    const bundle = path.join(dir, 'main.jsbundle');
    writeFileSync(bundle, 'var API = "https://api.example.com/graphql";\n');

    const good = sh(`vc_public_env_verdict "${bundle}" "$(cat '${file}')"`, {
      EXPO_PUBLIC_API_URL: 'https://api.example.com/graphql',
      EXPO_PUBLIC_APP_NAME: '',
      EXPO_PUBLIC_WEB_DOMAIN: '',
    });
    assert.match(good, /^ok inlined: EXPO_PUBLIC_API_URL/);

    const bad = sh(`vc_public_env_verdict "${bundle}" "$(cat '${file}')"`, {
      EXPO_PUBLIC_API_URL: 'https://other.example.com/graphql',
      EXPO_PUBLIC_APP_NAME: '',
      EXPO_PUBLIC_WEB_DOMAIN: '',
    });
    assert.equal(bad, 'FAIL value not inlined in the bundle: EXPO_PUBLIC_API_URL');
  }));

test('unset EXPO_PUBLIC_ names are skipped, never failed', () =>
  withTempDir((dir) => {
    const file = path.join(dir, '.env.example');
    writeFileSync(file, envExample);
    const bundle = path.join(dir, 'main.jsbundle');
    writeFileSync(bundle, 'nothing public here');
    const out = sh(`vc_public_env_verdict "${bundle}" "$(cat '${file}')"`, {
      EXPO_PUBLIC_API_URL: '',
      EXPO_PUBLIC_APP_NAME: '',
      EXPO_PUBLIC_WEB_DOMAIN: '',
    });
    assert.match(out, /^skip none set in this environment: EXPO_PUBLIC_API_URL/);
  }));

// ---------------------------------------------------------------------------
// OTA and certificates
// ---------------------------------------------------------------------------

test('OTA has to agree with OTA_ENABLED, and is only skipped when it is unset', () => {
  assert.equal(sh('vc_ota_verdict false false'), 'ok updates enabled=false, matching OTA_ENABLED');
  assert.equal(
    sh('vc_ota_verdict true false'),
    'FAIL OTA_ENABLED=true but the artifact says updates enabled=false',
  );
  assert.match(sh('vc_ota_verdict "" true'), /^skip OTA_ENABLED not set/);
});

test('OTA_ENABLED is read the way app.config.ts reads it', () => {
  assert.equal(sh('vc_bool true'), 'true');
  assert.equal(sh('vc_bool false'), 'false');
  assert.equal(sh('vc_bool anything'), 'false');
  assert.equal(sh('vc_bool ""'), '');
});

test('the template placeholder certificate warns but does not fail', () => {
  assert.match(
    sh('vc_cert_placeholder_verdict "$VC_PLACEHOLDER_CERT_SHA256"'),
    /^warn certs\/expo-updates-cert\.pem is still the template placeholder/,
  );
  assert.match(sh('vc_cert_placeholder_verdict deadbeef'), /^ok code-signing certificate is not/);
});

test('the shipped certificate is the one the placeholder check knows about', () => {
  // If someone regenerates certs/expo-updates-cert.pem this test is the thing
  // that says the constant has to move with it.
  const pem = readFileSync(path.join(here, '..', '..', 'certs', 'expo-updates-cert.pem'));
  const shipped = createHash('sha256').update(pem).digest('hex');
  assert.equal(sh('printf %s "$VC_PLACEHOLDER_CERT_SHA256"'), shipped);
});

test('signing certificate fingerprints compare without colons or case', () => {
  assert.match(sh('vc_cert_verdict "AA:BB:CC" "aabbcc"'), /^ok signing certificate SHA-256 aabbcc/);
  assert.match(sh('vc_cert_verdict "aabbcc" "ddeeff"'), /^FAIL signing certificate SHA-256 ddeeff/);
  assert.match(sh('vc_cert_verdict "aabbcc" ""'), /^FAIL no signing certificate SHA-256/);
});

// ---------------------------------------------------------------------------
// dSYM
// ---------------------------------------------------------------------------

const binaryUuid = 'UUID: 1A2B3C4D-0000-0000-0000-000000000001 (arm64) /App.app/App';

test('a dSYM that does not cover the binary fails', () => {
  const matching = 'UUID: 1a2b3c4d-0000-0000-0000-000000000001 (arm64) /App.app.dSYM';
  assert.match(sh(`vc_dsym_verdict "${binaryUuid}" "${matching}"`), /^ok dSYM covers 1A2B3C4D/);

  const other = 'UUID: 99999999-0000-0000-0000-000000000009 (arm64) /Other.dSYM';
  assert.match(
    sh(`vc_dsym_verdict "${binaryUuid}" "${other}"`),
    /^FAIL dSYM does not cover binary UUID/,
  );
  assert.equal(sh(`vc_dsym_verdict "${binaryUuid}" ""`), 'FAIL no UUID in the dSYM');
});

// ---------------------------------------------------------------------------
// Store metadata (a warning, never a failure -- the hard gate is the lane)
// ---------------------------------------------------------------------------

test('placeholder store metadata warns rather than failing', () =>
  withTempDir((dir) => {
    mkdirSync(path.join(dir, 'fastlane', 'metadata', 'ios', 'en-US'), { recursive: true });
    writeFileSync(
      path.join(dir, 'fastlane', 'metadata', 'ios', 'en-US', 'description.txt'),
      'Replace this text\n',
    );
    assert.match(
      sh(`vc_metadata_placeholder_verdict "${dir}"`),
      /^warn store metadata still has template placeholder/,
    );

    writeFileSync(
      path.join(dir, 'fastlane', 'metadata', 'ios', 'en-US', 'description.txt'),
      'Real copy.\n',
    );
    assert.equal(
      sh(`vc_metadata_placeholder_verdict "${dir}"`),
      'ok no placeholder text in fastlane/metadata',
    );
  }));

// ---------------------------------------------------------------------------
// The checklist itself
// ---------------------------------------------------------------------------

test('the checklist exits non-zero on a FAIL and zero otherwise', () => {
  assert.equal(
    sh('vc_reset; vc_ok a fine; vc_summary T && echo EXIT_OK').split('\n').pop(),
    'EXIT_OK',
  );
  assert.equal(
    sh('vc_reset; vc_fail a broken; vc_summary T || echo EXIT_FAIL').split('\n').pop(),
    'EXIT_FAIL',
  );
  assert.equal(
    sh('vc_reset; vc_warn a odd; vc_summary T && echo EXIT_OK').split('\n').pop(),
    'EXIT_OK',
  );
  assert.equal(
    sh('vc_reset; vc_skip a absent; vc_summary T && echo EXIT_OK').split('\n').pop(),
    'EXIT_OK',
  );
});

test('the checklist is mirrored into GITHUB_STEP_SUMMARY when CI sets it', () =>
  withTempDir((dir) => {
    const summary = path.join(dir, 'summary.md');
    writeFileSync(summary, '');
    sh(`vc_reset; vc_ok version 1.2.3; vc_fail arch "x86_64 arm64"; vc_summary 'iOS' || true`, {
      GITHUB_STEP_SUMMARY: summary,
    });
    const written = readFileSync(summary, 'utf8');
    assert.match(written, /### iOS/);
    assert.match(written, /\| `version` \| 1\.2\.3 \|/);
    assert.match(written, /\| `arch` \| x86_64 arm64 \|/);
    assert.match(written, /2 checks, 1 failed/);
  }));

test('a missing tool is a skip, not a failure', () => {
  assert.match(
    sh('vc_reset; vc_require_cmd thing definitely-not-a-real-binary || true'),
    /^skip thing: requires/,
  );
  assert.equal(sh('vc_reset; vc_require_cmd thing bash && echo PRESENT'), 'PRESENT');
});

// ---------------------------------------------------------------------------
// End to end, against a hand-made fake .app
// ---------------------------------------------------------------------------

function fakeApp(dir, { version = '1.2.3', build = '42', bundleBody = 'var x = 1;\n' } = {}) {
  const app = path.join(dir, 'Fake.app');
  mkdirSync(app, { recursive: true });
  writeFileSync(
    path.join(app, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleVersion</key><string>${build}</string>
<key>CFBundleIdentifier</key><string>com.example.rnmt</string>
<key>CFBundleExecutable</key><string>Fake</string>
</dict></plist>
`,
  );
  writeFileSync(path.join(app, 'Fake'), 'not a real mach-o');
  writeFileSync(path.join(app, 'main.jsbundle'), bundleBody);
  return app;
}

test('verify-ios.sh fails on a version that is not the one being released', () =>
  withTempDir((dir) => {
    const app = fakeApp(dir, { version: '1.2.2' });
    const { status, stdout } = run(verifyIos, [app, '--no-signing'], {
      APP_VERSION: '1.2.3',
      APP_BUILD_NUMBER: '42',
      IOS_BUNDLE_ID: 'com.example.rnmt',
    });
    assert.equal(status, 1);
    assert.match(stdout, /FAIL version: expected '1\.2\.3', got '1\.2\.2'/);
    assert.match(stdout, /ok build-number: 42/);
  }));

test('verify-ios.sh fails on a bundle that points at a Metro dev server', () =>
  withTempDir((dir) => {
    const app = fakeApp(dir, { bundleBody: 'var u = "http://localhost:8081/index.bundle";\n' });
    const { status, stdout } = run(verifyIos, [app, '--no-signing'], {
      APP_VERSION: '1.2.3',
      APP_BUILD_NUMBER: '42',
    });
    assert.equal(status, 1);
    assert.match(stdout, /FAIL dev-server: bundle references a Metro dev server/);
  }));

test('verify-ios.sh skips every signing check under --no-signing', () =>
  withTempDir((dir) => {
    const app = fakeApp(dir);
    const { stdout } = run(verifyIos, [app, '--no-signing'], {
      APP_VERSION: '1.2.3',
      APP_BUILD_NUMBER: '42',
    });
    assert.match(stdout, /skip signing: --no-signing given/);
    assert.match(stdout, /skip provisioning: --no-signing given/);
  }));

test('verify-ios.sh refuses an artifact that holds no .app', () =>
  withTempDir((dir) => {
    const empty = path.join(dir, 'Empty.xcarchive');
    mkdirSync(empty, { recursive: true });
    const { status, stdout } = run(verifyIos, [empty, '--no-signing']);
    assert.equal(status, 1);
    assert.match(stdout, /FAIL artifact: no \.app found/);
  }));
