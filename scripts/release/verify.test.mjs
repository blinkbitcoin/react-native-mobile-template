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
const verifyAndroid = path.join(here, 'verify-android.sh');

// Strict mode turns itself on under CI, so the default for a test is "off"
// unless the test is about strict mode. Anything else would make these tests
// behave differently on a laptop and on a runner.
const baseEnv = { ...process.env, CI: '', GITHUB_ACTIONS: '' };

/** Sources the helper library and runs one snippet, returning trimmed stdout. */
function sh(snippet, env = {}) {
  return execFileSync('bash', ['-c', `set -euo pipefail; . "${lib}"; ${snippet}`], {
    encoding: 'utf8',
    env: { ...baseEnv, ...env },
  }).trim();
}

/** Runs a gate script and returns { status, stdout } instead of throwing. */
function run(script, args, env = {}) {
  try {
    const stdout = execFileSync('bash', [script, ...args], {
      encoding: 'utf8',
      env: { ...baseEnv, ...env },
    });
    return { status: 0, stdout };
  } catch (error) {
    return { status: error.status, stdout: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

/** The iOS gate reads Info.plist with plutil and slices with lipo: macOS only. */
function hasCmd(cmd) {
  try {
    execFileSync('command', ['-v', cmd], { shell: true, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const macOnly = {
  skip: hasCmd('plutil') && hasCmd('lipo') ? false : 'needs plutil and lipo (macOS)',
};

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

const HERMES_MAGIC = Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]);

/** A file that vc_bundle_kind will call Hermes bytecode. */
function hermesBundle(file, body = '') {
  writeFileSync(file, Buffer.concat([HERMES_MAGIC, Buffer.from(body, 'utf8')]));
  return file;
}

test('a plain-text bundle that names the Metro dev server fails', () =>
  withTempDir((dir) => {
    const bundle = path.join(dir, 'main.jsbundle');
    writeFileSync(bundle, 'var url = "http://localhost:8081/index.bundle";\n');
    assert.match(
      sh(`vc_dev_server_verdict "${bundle}" text`),
      /^FAIL bundle references a Metro dev server: http:\/\/localhost:8081/,
    );
  }));

test('the emulator loopback address counts as a dev server too', () =>
  withTempDir((dir) => {
    const bundle = path.join(dir, 'index.android.bundle');
    writeFileSync(bundle, 'fetch("http://10.0.2.2:8081/status")');
    assert.match(sh(`vc_dev_server_verdict "${bundle}" text`), /^FAIL .*10\.0\.2\.2:8081/);
  }));

test('a clean plain-text bundle passes the dev-server check', () =>
  withTempDir((dir) => {
    const bundle = path.join(dir, 'main.jsbundle');
    writeFileSync(bundle, 'var url = "https://api.example.com/graphql";\n');
    assert.equal(
      sh(`vc_dev_server_verdict "${bundle}" text`),
      'ok no dev-server URL in the bundle',
    );
  }));

test('a missing bundle fails rather than being skipped', () => {
  assert.match(sh('vc_dev_server_verdict "/nope/main.jsbundle" text'), /^FAIL no JS bundle at/);
});

// React Native's getDevServer FALLBACK constant is in every bundle ever built,
// dev or release. On its own it proves nothing, so it must not fail a release.
test("React Native's inert getDevServer fallback alone does not fail", () =>
  withTempDir((dir) => {
    const bundle = path.join(dir, 'main.jsbundle');
    writeFileSync(bundle, "var e,t,o='http://localhost:8081/';function f(){}");
    assert.equal(
      sh(`vc_dev_server_verdict "${bundle}" text`),
      "ok only React Native's inert getDevServer fallback",
    );
  }));

// The regression this whole rule exists for. Hermes packs its string table into
// one buffer with no terminators and overlaps shared prefixes and suffixes, so
// the FALLBACK constant (which ends in `/`) and any string starting with `/`
// read, byte for byte, as one URL that is in no program. Scanning bytecode for
// URLs therefore cannot be trusted at all -- only complete dev-only literals
// can. This fixture is the two adjacent strings, exactly as hermesc emits them.
test('adjacent Hermes strings that look like a dev-server URL do not fail', () =>
  withTempDir((dir) => {
    const bundle = path.join(dir, 'index.android.bundle');
    // Verbatim what a real release build of this template produces: RN's
    // FALLBACK `'http://localhost:8081/'` packed immediately before Metro's
    // ordinary asset httpServerLocation `'/assets/node_modules/...'`,
    // overlapping on the shared `/`. Two strings; `grep -ao` reads one URL.
    hermesBundle(
      bundle,
      'http://localhost:8081/assets/node_modules/.pnpm/@expo-google-fonts+material-symbols@0.4.45/node_modules/@expo-google-fonts/material-symbols/400Regular',
    );
    assert.equal(
      sh(`vc_dev_server_verdict "${bundle}" hermes`),
      'ok no development markers in the Hermes bundle',
    );
  }));

test('a URL-shaped concatenation is not a dev marker either', () =>
  withTempDir((dir) => {
    const bundle = path.join(dir, 'index.android.bundle');
    hermesBundle(bundle, 'http://localhost:8081/index.bundle');
    assert.equal(
      sh(`vc_dev_server_verdict "${bundle}" hermes`),
      'ok no development markers in the Hermes bundle',
    );
  }));

test('a Hermes bundle carrying real development markers fails', () => {
  for (const marker of ['dev=true', 'hot=true', 'minify=false', '/.expo/.virtual-metro-entry']) {
    withTempDir((dir) => {
      const bundle = hermesBundle(path.join(dir, 'index.android.bundle'), `x${marker}y`);
      assert.match(
        sh(`vc_dev_server_verdict "${bundle}" hermes`),
        /^FAIL bundle carries development markers/,
        `expected ${marker} to fail`,
      );
    });
  }
});

test('vc_bundle_kind tells Hermes bytecode from text', () =>
  withTempDir((dir) => {
    assert.equal(sh(`vc_bundle_kind "${hermesBundle(path.join(dir, 'h.bundle'))}"`), 'hermes');
    const plain = path.join(dir, 'p.bundle');
    writeFileSync(plain, 'var __d = 1;');
    assert.equal(sh(`vc_bundle_kind "${plain}"`), 'text');
  }));

// I1: a tool that did not run must never read as a check that passed. `grep`
// exits 1 for "no match" and >=2 for "I broke", and `|| true` cannot tell them
// apart -- which is how a missing grep used to print `ok`.
test("vc_grep keeps grep's exit status", () =>
  withTempDir((dir) => {
    const file = path.join(dir, 'f.txt');
    writeFileSync(file, 'hello\n');
    assert.equal(sh(`vc_grep hello "${file}" && printf 'rc=0 %s' "$VC_GREP_OUTPUT"`), 'rc=0 hello');
    assert.equal(sh(`vc_grep nope "${file}" || printf 'rc=%s' "$?"`), 'rc=1');
    assert.match(sh(`vc_grep hello "${dir}/missing" || printf 'rc=%s' "$?"`), /rc=[2-9]/);
  }));

test('a grep that cannot run fails the check instead of passing it', () =>
  withTempDir((dir) => {
    const bundle = path.join(dir, 'main.jsbundle');
    writeFileSync(bundle, 'var url = "http://localhost:8081/index.bundle";\n');
    // A grep on PATH that always fails, which is what a broken or absent grep
    // looks like from the caller's side.
    const shim = path.join(dir, 'bin');
    mkdirSync(shim);
    writeFileSync(path.join(shim, 'grep'), '#!/bin/sh\necho "grep: broken" >&2\nexit 2\n', {
      mode: 0o755,
    });
    const out = sh(`PATH="${shim}:$PATH" vc_dev_server_verdict "${bundle}" text`);
    assert.match(out, /^FAIL could not scan the bundle/);
  }));

test('a broken grep fails the metadata check instead of passing it', () =>
  withTempDir((dir) => {
    mkdirSync(path.join(dir, 'fastlane', 'metadata'), { recursive: true });
    const shim = path.join(dir, 'bin');
    mkdirSync(shim);
    writeFileSync(path.join(shim, 'grep'), '#!/bin/sh\necho "grep: broken" >&2\nexit 2\n', {
      mode: 0o755,
    });
    assert.match(
      sh(`PATH="${shim}:$PATH" vc_metadata_placeholder_verdict "${dir}"`),
      /^FAIL could not scan fastlane\/metadata/,
    );
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
    assert.match(out, /^skip nothing checkable in this environment \(not checked: /);
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
  // No updates configuration at all is what OTA_ENABLED=false looks like.
  assert.match(sh('vc_ota_verdict false absent'), /^ok no updates configuration/);
  assert.match(sh('vc_ota_verdict true absent'), /^FAIL OTA_ENABLED=true/);
});

test('OTA_ENABLED is read the way app.config.ts reads it', () => {
  assert.equal(sh('vc_bool true'), 'true');
  assert.equal(sh('vc_bool false'), 'false');
  assert.equal(sh('vc_bool anything'), 'false');
  assert.equal(sh('vc_bool ""'), '');
});

test('a binary with no runtime version fails: it would never be offered an update', () => {
  assert.match(
    sh('vc_runtime_version_verdict "" "" ""'),
    /^FAIL updates are enabled but the artifact carries no runtime version/,
  );
});

// The sentinel is what `expo prebuild` really writes under
// `runtimeVersion: { policy: 'fingerprint' }` -- see fixtures/ota/README.md.
// The first version of this check compared the sentinel *itself* against the
// build fingerprint and so failed every OTA-enabled build.
test('the fingerprint sentinel is resolved, not compared', () => {
  assert.equal(
    sh('vc_runtime_version_verdict file:fingerprint abc123 abc123'),
    'ok runtime version abc123 matches the build fingerprint',
  );
  assert.equal(
    sh('vc_runtime_version_verdict "@string/expo_runtime_version" abc123 abc123'),
    'ok runtime version abc123 matches the build fingerprint',
  );
  assert.equal(
    sh('vc_runtime_version_verdict file:fingerprint abc123 def456'),
    'FAIL runtime version abc123 does not match the build fingerprint def456',
  );
  // No build-info.json to compare against is not a mismatch.
  assert.match(
    sh('vc_runtime_version_verdict file:fingerprint abc123 ""'),
    /^ok runtime version abc123 \(from file:fingerprint; no build-info/,
  );
});

test('a sentinel with no fingerprint file behind it fails', () => {
  // The binary cannot resolve a runtime version at all, so it would never be
  // offered an update -- which is the defect this check exists for.
  assert.match(
    sh('vc_runtime_version_verdict file:fingerprint "" abc123'),
    /^FAIL runtime version is file:fingerprint but the artifact carries no fingerprint file/,
  );
});

test('a pinned literal runtime version is reported, never compared to a fingerprint', () => {
  // `runtimeVersion: "1.0.0"` is a supported Expo config; under any policy but
  // `fingerprint` the build-info hash is a different thing entirely, and
  // failing a correct build is worse than not checking.
  assert.equal(
    sh('vc_runtime_version_verdict 1.0.0 "" deadbeef'),
    'ok runtime version 1.0.0 (pinned literal, not a fingerprint policy)',
  );
});

test('a store build must ask for the production channel', () => {
  assert.equal(sh('vc_channel_verdict production production'), 'ok update channel production');
  assert.equal(
    sh('vc_channel_verdict internal production'),
    'FAIL update channel internal, expected production',
  );
  assert.match(
    sh('vc_channel_verdict "" production'),
    /^FAIL updates are enabled but no expo-channel-name request header/,
  );
});

test('the channel is read out of the manifest request-header JSON', () => {
  const json = '{"expo-channel-name":"production","other":"x"}';
  assert.equal(sh(`vc_json_string_field '${json}' expo-channel-name`), 'production');
  assert.equal(sh(`vc_json_string_field '${json}' missing`), '');
  assert.equal(
    sh(`vc_json_string_field '{"expo-channel-name": "beta"}' expo-channel-name`),
    'beta',
  );
});

test('XML entities are undone before the JSON is parsed', () => {
  // AndroidManifest.xml stores the request headers XML-escaped, so the plain
  // sed found nothing and the channel check failed on every Android build.
  const escaped = '{&quot;expo-channel-name&quot;:&quot;production&quot;}';
  assert.equal(sh(`vc_xml_unescape '${escaped}'`), '{"expo-channel-name":"production"}');
  assert.equal(
    sh(`vc_json_string_field "$(vc_xml_unescape '${escaped}')" expo-channel-name`),
    'production',
  );
  // &amp; is undone last, so an escaped entity does not become a live one.
  assert.equal(sh(`vc_xml_unescape 'a&amp;quot;b'`), 'a&quot;b');
});

test('a fingerprint is read out of build-info.json, and absence is not a mismatch', () =>
  withTempDir((dir) => {
    const file = path.join(dir, 'build-info.json');
    writeFileSync(file, JSON.stringify({ fingerprint: { ios: 'aaa', android: 'bbb' } }));
    assert.equal(sh(`vc_build_info_fingerprint "${file}" ios`), 'aaa');
    assert.equal(sh(`vc_build_info_fingerprint "${file}" android`), 'bbb');
    assert.equal(sh(`vc_build_info_fingerprint "${dir}/absent.json" ios`), '');
    writeFileSync(file, 'not json');
    assert.equal(sh(`vc_build_info_fingerprint "${file}" ios`), '');
  }));

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
    sh('vc_reset; vc_init_strict ""; vc_require_cmd thing definitely-not-a-real-binary || true'),
    /^skip thing: requires/,
  );
  assert.equal(sh('vc_reset; vc_require_cmd thing bash && echo PRESENT'), 'PRESENT');
});

// I2: one tool guarding several checks must not delete rows from the checklist.
test('one missing tool emits one skip line per check it guards', () => {
  const out = sh(
    'vc_reset; vc_init_strict ""; vc_require_cmd_for definitely-not-a-real-binary version build-number bundle-id || true',
  ).split('\n');
  assert.deepEqual(
    out.map((line) => line.split(':')[0]),
    ['skip version', 'skip build-number', 'skip bundle-id'],
  );
});

test('a tool that is present emits nothing and succeeds', () => {
  assert.equal(sh('vc_reset; vc_require_cmd_for bash a b c && echo PRESENT'), 'PRESENT');
});

test('a tool that cannot read the artifact fails every check it guards', () => {
  const out = sh('vc_reset; vc_fail_group "aapt2 could not read it" apk-package min-sdk').split(
    '\n',
  );
  assert.deepEqual(out, [
    'FAIL apk-package: aapt2 could not read it',
    'FAIL min-sdk: aapt2 could not read it',
  ]);
});

// I3: a gate must not be able to pass by skipping everything.
test('--strict turns a tool-missing skip into a failure', () => {
  assert.match(
    sh(
      'vc_reset; vc_init_strict 1; vc_require_cmd bundletool definitely-not-a-real-binary || true',
    ),
    /^FAIL bundletool: requires .*--strict/,
  );
});

test('CI and GITHUB_ACTIONS turn strict mode on by themselves', () => {
  for (const [name, value] of [
    ['CI', 'true'],
    ['GITHUB_ACTIONS', 'true'],
  ]) {
    assert.match(
      sh('vc_reset; vc_init_strict ""; vc_require_cmd t definitely-not-a-real-binary || true', {
        [name]: value,
      }),
      /^FAIL t: /,
      `expected ${name}=${value} to enable strict mode`,
    );
  }
  assert.match(
    sh('vc_reset; vc_init_strict ""; vc_require_cmd t definitely-not-a-real-binary || true', {
      CI: 'false',
    }),
    /^skip t: /,
  );
});

test('an input that was never supplied stays a skip even under --strict', () => {
  assert.match(
    sh('vc_reset; vc_init_strict 1; vc_skip signing-cert "no --cert-sha256 given"'),
    /^skip signing-cert/,
  );
});

test('summary cells escape a pipe so the job-summary table survives a path', () =>
  withTempDir((dir) => {
    const summary = path.join(dir, 'summary.md');
    writeFileSync(summary, '');
    sh(`vc_reset; vc_fail signature "apksigner said a|b"; vc_summary 'A' || true`, {
      GITHUB_STEP_SUMMARY: summary,
    });
    assert.match(readFileSync(summary, 'utf8'), /\| `signature` \| apksigner said a\\\|b \|/);
  }));

// ---------------------------------------------------------------------------
// End to end, against a hand-made fake .app
// ---------------------------------------------------------------------------

/**
 * The smallest thing `lipo -archs` calls an arm64 binary: a 64-bit Mach-O
 * header with no load commands. Written by hand so no binary is committed and
 * no compiler is needed.
 */
function machOArm64() {
  const b = Buffer.alloc(4096);
  b.writeUInt32LE(0xfeedfacf, 0); // MH_MAGIC_64
  b.writeInt32LE(0x0100000c, 4); // CPU_TYPE_ARM64
  b.writeInt32LE(0, 8); // CPU_SUBTYPE_ARM64_ALL
  b.writeUInt32LE(2, 12); // MH_EXECUTE
  return b;
}

/**
 * A fake .app that a correct release would produce: the right version, an
 * arm64 binary, a Hermes bundle. Tests that want a specific defect override
 * exactly that one thing, so a FAIL in their output can only be the defect.
 */
/**
 * The Expo.plist to put in a fake .app, taken from `fixtures/ota/Expo.plist` --
 * real `expo prebuild --clean` output with OTA on, not a hand-written guess.
 * That distinction is the whole point: the first version of these tests wrote
 * a fingerprint hash into EXUpdatesRuntimeVersion, which prebuild never does,
 * so the fixture agreed with the bug and all four cases passed green.
 *
 * The overrides rewrite one key of the real file at a time, so a FAIL in a
 * test's output can only be the defect that test injected.
 */
function expoPlist({ enabled = null, runtime = null, channel = null, drop = [] } = {}) {
  let xml = readFileSync(path.join(here, 'fixtures', 'ota', 'Expo.plist'), 'utf8');
  const replaceString = (key, value) =>
    xml.replace(new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`), `$1${value}$2`);
  if (enabled !== null) {
    xml = xml.replace(/(<key>EXUpdatesEnabled<\/key>\s*)<(true|false)\/>/, `$1<${enabled}/>`);
  }
  if (runtime !== null) xml = replaceString('EXUpdatesRuntimeVersion', runtime);
  if (channel !== null) xml = replaceString('expo-channel-name', channel);
  for (const key of drop) {
    // Drop a <key>/<string> pair, or a <key> followed by a <dict>…</dict>.
    xml = xml
      .replace(new RegExp(`\\s*<key>${key}</key>\\s*<string>[^<]*</string>`), '')
      .replace(new RegExp(`\\s*<key>${key}</key>\\s*<dict>[\\s\\S]*?</dict>`), '');
  }
  return xml;
}

/** The real prebuilt AndroidManifest.xml, for the Android OTA assertions. */
const androidManifestFixture = () =>
  readFileSync(path.join(here, 'fixtures', 'ota', 'AndroidManifest.xml'), 'utf8');

function fakeApp(
  dir,
  {
    version = '1.2.3',
    build = '42',
    bundle = HERMES_MAGIC,
    arch = machOArm64(),
    expo = null,
    // The file expo-updates' build phase writes into the app's resource
    // bundle; `null` leaves it out, which is what an OTA build that never ran
    // that phase looks like.
    fingerprint = null,
  } = {},
) {
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
  writeFileSync(path.join(app, 'Fake'), arch);
  writeFileSync(path.join(app, 'main.jsbundle'), bundle);
  if (expo) writeFileSync(path.join(app, 'Expo.plist'), expo);
  if (fingerprint !== null) {
    // EXUpdates.bundle, not the .app root: create-updates-resources-ios.sh
    // writes into the pod's resource bundle, and UpdatesConfig.swift reads it
    // back from there.
    mkdirSync(path.join(app, 'EXUpdates.bundle'), { recursive: true });
    writeFileSync(path.join(app, 'EXUpdates.bundle', 'fingerprint'), fingerprint);
  }
  return app;
}

// I4: the case that matters most -- a well-formed artifact must come out
// green. Without it every end-to-end assertion of `status === 1` is satisfied
// by an unrelated FAIL, and a spurious new FAIL goes unnoticed.
test('verify-ios.sh passes a well-formed artifact with exit 0', macOnly, () =>
  withTempDir((dir) => {
    const app = fakeApp(dir);
    const { status, stdout } = run(verifyIos, [app, '--no-signing'], {
      APP_VERSION: '1.2.3',
      APP_BUILD_NUMBER: '42',
      IOS_BUNDLE_ID: 'com.example.rnmt',
      OTA_ENABLED: 'false',
    });
    assert.equal(status, 0, stdout);
    assert.doesNotMatch(stdout, /^FAIL /m, stdout);
    assert.match(stdout, /ok version: 1\.2\.3/);
    assert.match(stdout, /ok build-number: 42/);
    assert.match(stdout, /ok bundle-id: com\.example\.rnmt/);
    assert.match(stdout, /ok arch: arm64 only/);
    assert.match(stdout, /ok hermes: Hermes bytecode/);
    assert.match(stdout, /ok dev-server: no development markers/);
    assert.match(stdout, /0 failed/);
  }),
);

test('verify-ios.sh fails on a version that is not the one being released', macOnly, () =>
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
  }),
);

test('verify-ios.sh fails on a plain-text bundle naming a Metro dev server', macOnly, () =>
  withTempDir((dir) => {
    // Not Hermes on purpose: a text bundle in a release artifact is itself a
    // FAIL, and it is the only bundle whose string boundaries are observable.
    const app = fakeApp(dir, { bundle: 'var u = "http://localhost:8081/index.bundle";\n' });
    const { status, stdout } = run(verifyIos, [app, '--no-signing'], {
      APP_VERSION: '1.2.3',
      APP_BUILD_NUMBER: '42',
    });
    assert.equal(status, 1);
    assert.match(stdout, /FAIL dev-server: bundle references a Metro dev server/);
    assert.match(stdout, /FAIL hermes: not Hermes bytecode/);
  }),
);

test('verify-ios.sh fails an x86_64 slice', macOnly, () =>
  withTempDir((dir) => {
    const intel = machOArm64();
    intel.writeInt32LE(0x01000007, 4); // CPU_TYPE_X86_64
    intel.writeInt32LE(3, 8); // CPU_SUBTYPE_X86_64_ALL
    const app = fakeApp(dir, { arch: intel });
    const { status, stdout } = run(verifyIos, [app, '--no-signing'], {
      APP_VERSION: '1.2.3',
      APP_BUILD_NUMBER: '42',
    });
    assert.equal(status, 1);
    assert.match(stdout, /FAIL arch: expected arm64 only, got x86_64/);
  }),
);

test('verify-ios.sh skips every signing check under --no-signing', macOnly, () =>
  withTempDir((dir) => {
    const app = fakeApp(dir);
    const { stdout } = run(verifyIos, [app, '--no-signing'], {
      APP_VERSION: '1.2.3',
      APP_BUILD_NUMBER: '42',
    });
    assert.match(stdout, /skip signing: --no-signing given/);
    assert.match(stdout, /skip provisioning: --no-signing given/);
  }),
);

// I5/R1: a runtime version or channel that is wrong is invisible -- the update
// publishes fine and reaches nobody -- so both are checked end to end against
// the *real* prebuilt Expo.plist in fixtures/ota/, never a hand-written one.
test('verify-ios.sh accepts a real prebuilt Expo.plist and its fingerprint file', macOnly, () =>
  withTempDir((dir) => {
    const app = fakeApp(dir, { expo: expoPlist(), fingerprint: 'fp-abc\n' });
    writeFileSync(
      path.join(dir, 'build-info.json'),
      JSON.stringify({ fingerprint: { ios: 'fp-abc', android: 'fp-xyz' } }),
    );
    const { stdout } = run(verifyIos, [app, '--no-signing'], {
      APP_VERSION: '1.2.3',
      APP_BUILD_NUMBER: '42',
      OTA_ENABLED: 'true',
      BUILD_INFO_FILE: path.join(dir, 'build-info.json'),
    });
    assert.match(
      stdout,
      /ok ota-runtime-version: runtime version fp-abc matches the build fingerprint/,
    );
    assert.match(stdout, /ok ota-channel: update channel production/);
    assert.doesNotMatch(stdout, /^FAIL ota-/m, stdout);
  }),
);

test('verify-ios.sh accepts the sentinel with no build-info to compare against', macOnly, () =>
  withTempDir((dir) => {
    const app = fakeApp(dir, { expo: expoPlist(), fingerprint: 'fp-abc' });
    const { stdout } = run(verifyIos, [app, '--no-signing'], {
      APP_VERSION: '1.2.3',
      APP_BUILD_NUMBER: '42',
      OTA_ENABLED: 'true',
      BUILD_INFO_FILE: path.join(dir, 'absent.json'),
    });
    assert.match(stdout, /ok ota-runtime-version: runtime version fp-abc \(from file:fingerprint/);
    assert.doesNotMatch(stdout, /^FAIL ota-/m, stdout);
  }),
);

test('verify-ios.sh fails an OTA build whose bundle has no fingerprint file', macOnly, () =>
  withTempDir((dir) => {
    // The build phase that writes it never ran: the binary cannot resolve a
    // runtime version at all, so no update would ever be offered to it.
    const app = fakeApp(dir, { expo: expoPlist() });
    const { status, stdout } = run(verifyIos, [app, '--no-signing'], {
      APP_VERSION: '1.2.3',
      APP_BUILD_NUMBER: '42',
      OTA_ENABLED: 'true',
    });
    assert.equal(status, 1);
    assert.match(
      stdout,
      /FAIL ota-runtime-version: runtime version is file:fingerprint but the artifact carries no fingerprint file/,
    );
  }),
);

test('verify-ios.sh fails a fingerprint that is not the one the build recorded', macOnly, () =>
  withTempDir((dir) => {
    const app = fakeApp(dir, { expo: expoPlist(), fingerprint: 'stale-fp' });
    writeFileSync(
      path.join(dir, 'build-info.json'),
      JSON.stringify({ fingerprint: { ios: 'fp-abc' } }),
    );
    const { status, stdout } = run(verifyIos, [app, '--no-signing'], {
      APP_VERSION: '1.2.3',
      APP_BUILD_NUMBER: '42',
      OTA_ENABLED: 'true',
      BUILD_INFO_FILE: path.join(dir, 'build-info.json'),
    });
    assert.equal(status, 1);
    assert.match(stdout, /FAIL ota-runtime-version: runtime version stale-fp does not match/);
  }),
);

test('verify-ios.sh fails a plist with no runtime version and the wrong channel', macOnly, () =>
  withTempDir((dir) => {
    const app = fakeApp(dir, {
      expo: expoPlist({ channel: 'internal', drop: ['EXUpdatesRuntimeVersion'] }),
      fingerprint: 'fp-abc',
    });
    const { status, stdout } = run(verifyIos, [app, '--no-signing'], {
      APP_VERSION: '1.2.3',
      APP_BUILD_NUMBER: '42',
      OTA_ENABLED: 'true',
    });
    assert.equal(status, 1);
    assert.match(
      stdout,
      /FAIL ota-runtime-version: updates are enabled but the artifact carries no runtime version/,
    );
    assert.match(stdout, /FAIL ota-channel: update channel internal, expected production/);
  }),
);

test('verify-ios.sh leaves the OTA checks alone when updates are off', macOnly, () =>
  withTempDir((dir) => {
    const app = fakeApp(dir, {
      expo: expoPlist({
        enabled: false,
        drop: ['EXUpdatesURL', 'EXUpdatesRuntimeVersion', 'EXUpdatesRequestHeaders'],
      }),
    });
    const { status, stdout } = run(verifyIos, [app, '--no-signing'], {
      APP_VERSION: '1.2.3',
      APP_BUILD_NUMBER: '42',
      OTA_ENABLED: 'false',
    });
    assert.equal(status, 0, stdout);
    assert.doesNotMatch(stdout, /ota-runtime-version/);
    assert.doesNotMatch(stdout, /ota-channel/);
  }),
);

// The fixtures are the contract with a generator this repo does not control, so
// assert what they say. If an Expo bump changes any of it, this fails here
// rather than in a release job.
test('the captured prebuild output still says what the gates assume', () => {
  const plist = readFileSync(path.join(here, 'fixtures', 'ota', 'Expo.plist'), 'utf8');
  assert.match(plist, /<key>EXUpdatesRuntimeVersion<\/key>\s*<string>file:fingerprint<\/string>/);
  assert.match(plist, /<key>expo-channel-name<\/key>\s*<string>production<\/string>/);

  const manifest = androidManifestFixture();
  assert.match(
    manifest,
    /expo\.modules\.updates\.EXPO_RUNTIME_VERSION" android:value="@string\/expo_runtime_version"/,
  );
  assert.match(
    manifest,
    /UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY" android:value="\{&quot;expo-channel-name&quot;:&quot;production&quot;\}"/,
  );
  const strings = readFileSync(path.join(here, 'fixtures', 'ota', 'strings.xml'), 'utf8');
  assert.match(strings, /<string name="expo_runtime_version">file:fingerprint<\/string>/);
});

// The Android gate cannot be run end to end (no hand-made file is a readable
// AAB), so its two OTA reads are exercised as the exact shell pipeline the gate
// uses, against the real manifest.
test('the android gate reads the real manifest the way the gate does', () =>
  withTempDir((dir) => {
    const manifest = path.join(dir, 'AndroidManifest.xml');
    writeFileSync(manifest, androidManifestFixture());
    const meta = (name) =>
      `$(grep -A2 '${name}' "${manifest}" | sed -n 's/.*android:value="\\([^"]*\\)".*/\\1/p' | head -1)`;
    assert.equal(
      sh(`printf '%s' "${meta('expo.modules.updates.EXPO_RUNTIME_VERSION')}"`),
      '@string/expo_runtime_version',
    );
    assert.equal(
      sh(
        `vc_json_string_field "$(vc_xml_unescape "${meta('expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY')}")" expo-channel-name`,
      ),
      'production',
    );
    // And the verdicts those two values produce.
    assert.match(
      sh(`vc_runtime_version_verdict "@string/expo_runtime_version" abc123 abc123`),
      /^ok runtime version abc123 matches/,
    );
    assert.equal(sh(`vc_channel_verdict production production`), 'ok update channel production');
  }));

test('verify-ios.sh refuses an artifact that holds no .app', () =>
  withTempDir((dir) => {
    const empty = path.join(dir, 'Empty.xcarchive');
    mkdirSync(empty, { recursive: true });
    const { status, stdout } = run(verifyIos, [empty, '--no-signing']);
    assert.equal(status, 1);
    assert.match(stdout, /FAIL artifact: no \.app found/);
  }));

test('verify-ios.sh --strict fails a check whose tool is missing', macOnly, () =>
  withTempDir((dir) => {
    const app = fakeApp(dir);
    const shim = path.join(dir, 'bin');
    mkdirSync(shim);
    // No plutil on PATH: the three checks it guards must all appear, and under
    // --strict they must fail rather than quietly disappear.
    const { status, stdout } = run(verifyIos, [app, '--no-signing', '--strict'], {
      PATH: `${shim}:/usr/bin:/bin`,
      APP_VERSION: '1.2.3',
      APP_BUILD_NUMBER: '42',
      PLUTIL_ABSENT: '1',
    });
    if (!/requires plutil/.test(stdout)) return; // plutil is in /usr/bin; nothing to assert
    assert.equal(status, 1);
    for (const check of ['version', 'build-number', 'bundle-id']) {
      assert.match(stdout, new RegExp(`FAIL ${check}: requires plutil`), stdout);
    }
  }),
);

// ---------------------------------------------------------------------------
// The Android gate's checklist shape
// ---------------------------------------------------------------------------
//
// There is no exit-0 end-to-end case here on purpose: aapt2 and bundletool
// have to be able to *read* the artifact, and no hand-made fixture is a real
// AAB. What can be asserted without them is the thing I2 and I3 are about --
// that the checklist keeps its rows when a tool is absent, and that --strict
// refuses to call that a pass.

const ANDROID_TOOL_CHECKS = [
  'apk-manifest',
  'apk-package',
  'apk-version-name',
  'apk-version-code',
  'debuggable',
  'min-sdk',
  'aab-manifest',
  'aab-version-code',
  'aab-version-name',
  'aab-matches-apk',
  'ota',
  'signature',
  'signing-cert',
];

/**
 * A PATH and SDK with no aapt2, apksigner or bundletool on them. node stays on
 * it: the provenance check reads build-info.json with it, and dropping node
 * would turn every apk-sha assertion into "requires node".
 */
function withoutAndroidTools(dir) {
  return {
    PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
    ANDROID_HOME: path.join(dir, 'no-sdk'),
    ANDROID_SDK_ROOT: '',
    BUNDLETOOL_JAR: '',
  };
}

function fakeAndroidArtifacts(dir) {
  const aab = path.join(dir, 'app-release.aab');
  const apk = path.join(dir, 'app-universal.apk');
  writeFileSync(aab, 'not really a bundle');
  writeFileSync(apk, 'not really an apk');
  return [aab, apk];
}

// I2: the "APK derived from the exact AAB" gate. Nothing wrote
// `artifacts.apkSha256` before, so this check was a permanent skip that read as
// coverage the release did not have; the `android build` lane records it now.
test('verify-android.sh compares the APK against the checksum the build recorded', () =>
  withTempDir((dir) => {
    const [aab, apk] = fakeAndroidArtifacts(dir);
    const sha = createHash('sha256').update(readFileSync(apk)).digest('hex');
    // Next to the APK, which is where the build lane writes its merged copy and
    // therefore this gate's default when BUILD_INFO_FILE is not set.
    writeFileSync(
      path.join(dir, 'build-info.json'),
      JSON.stringify({ artifacts: { apkSha256: sha } }),
    );
    const { stdout } = run(verifyAndroid, [aab, apk], withoutAndroidTools(dir));
    assert.match(stdout, new RegExp(`^ok apk-sha: APK SHA-256 ${sha}`, 'm'), stdout);
  }));

test('verify-android.sh fails an APK that is not the one the build produced', () =>
  withTempDir((dir) => {
    const [aab, apk] = fakeAndroidArtifacts(dir);
    writeFileSync(
      path.join(dir, 'build-info.json'),
      JSON.stringify({ artifacts: { apkSha256: 'deadbeef' } }),
    );
    const { status, stdout } = run(verifyAndroid, [aab, apk], withoutAndroidTools(dir));
    assert.equal(status, 1);
    assert.match(stdout, /^FAIL apk-sha: APK SHA-256 /m, stdout);
  }));

test('verify-android.sh skips apk-sha when no checksum was recorded', () =>
  withTempDir((dir) => {
    const [aab, apk] = fakeAndroidArtifacts(dir);
    writeFileSync(path.join(dir, 'build-info.json'), JSON.stringify({ artifacts: {} }));
    const { stdout } = run(verifyAndroid, [aab, apk], withoutAndroidTools(dir));
    assert.match(
      stdout,
      /^skip apk-sha: build-info\.json carries no artifacts\.apkSha256/m,
      stdout,
    );
  }));

test('BUILD_INFO_FILE overrides the copy next to the APK', () =>
  withTempDir((dir) => {
    const [aab, apk] = fakeAndroidArtifacts(dir);
    writeFileSync(
      path.join(dir, 'build-info.json'),
      JSON.stringify({
        artifacts: { apkSha256: createHash('sha256').update(readFileSync(apk)).digest('hex') },
      }),
    );
    const other = path.join(dir, 'elsewhere.json');
    writeFileSync(other, JSON.stringify({ artifacts: { apkSha256: 'deadbeef' } }));
    const { status } = run(verifyAndroid, [aab, apk], {
      ...withoutAndroidTools(dir),
      BUILD_INFO_FILE: other,
    });
    assert.equal(status, 1);
  }));

test('verify-android.sh keeps every check row when its tool is missing', () =>
  withTempDir((dir) => {
    const [aab, apk] = fakeAndroidArtifacts(dir);
    const { stdout } = run(verifyAndroid, [aab, apk], withoutAndroidTools(dir));
    for (const check of ANDROID_TOOL_CHECKS) {
      assert.match(stdout, new RegExp(`^skip ${check}: requires `, 'm'), `${check}\n${stdout}`);
    }
  }));

test('verify-android.sh --strict refuses to pass a check it could not run', () =>
  withTempDir((dir) => {
    const [aab, apk] = fakeAndroidArtifacts(dir);
    const { status, stdout } = run(verifyAndroid, [aab, apk, '--strict'], withoutAndroidTools(dir));
    assert.equal(status, 1);
    for (const check of ANDROID_TOOL_CHECKS) {
      assert.match(stdout, new RegExp(`^FAIL ${check}: requires `, 'm'), `${check}\n${stdout}`);
    }
  }));
