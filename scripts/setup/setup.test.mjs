// The machine-setup scripts (scripts/setup/*.sh), run for real against a
// throwaway repository and HOME with every external tool replaced by a fake on
// PATH. Nothing touches the network or the real machine. Each fake appends
// "<name> <args>" to a shared log, which is what most assertions read.
//
// The cases are the failures a blank machine actually hit, one by one: see
// .claude/skills/native-setup/SKILL.md for the symptoms they correspond to.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NODE_DIR = path.dirname(process.execPath);

let sandboxes = [];
afterEach(() => {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
  sandboxes = [];
});

const sha = (algorithm, file) =>
  execFileSync('shasum', ['-a', algorithm, file], { encoding: 'utf8' }).split(' ')[0];

/** A zip whose single top-level directory holds the given files. */
function makeZip(dir, name, files) {
  const staging = path.join(dir, `${name}-staging`);
  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(staging, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body, { mode: 0o755 });
  }
  const zip = path.join(dir, `${name}.zip`);
  execFileSync('zip', ['-qr', zip, '.'], { cwd: staging });
  return zip;
}

const FAKES = {
  // uname: FAKE_OS for -s, FAKE_ARCH for -m.
  uname: `[ "$1" = -m ] && echo "\${FAKE_ARCH:-arm64}" || echo "\${FAKE_OS:-Darwin}"`,
  // curl [-o <file>] <url>: serves the fixture named after the URL's basename.
  curl: `
    while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; -*) shift ;; *) url="$1"; shift ;; esac; done
    [ -n "\${FAKE_CURL_FAIL:-}" ] && exit 22
    # With -o it downloads to a file, without it to stdout (curl … | sh).
    if [ -n "\${out:-}" ]; then cp "$FIXTURES/$(basename "$url")" "$out"; else cat "$FIXTURES/$(basename "$url")"; fi`,
  mise: `
    case "$1" in
      --version) echo "2026.9.12 macos-arm64" ;;
      # Like the real one, run from the repository: exports what .env.local holds.
      env) [ -f .env.local ] && sed 's/^/export /' .env.local ;;
      exec) shift; [ "$1" = -- ] && shift; exec "$@" ;;
    esac`,
  make: 'true',
  brew: 'true',
  sleep: 'true',
  // The Android CLI: "sdk install --sdk=<root> <path>" creates the package the
  // way the real one does, licence file included. FAKE_INSTALL_FAILURES makes
  // the first N installs fail, to exercise the retry.
  android: `
    for a in "$@"; do case "$a" in --sdk=*) sdk="\${a#--sdk=}" ;; esac; done
    pkg="\${!#}"
    count="$WORK/install-attempts"; n=$(cat "$count" 2>/dev/null || echo 0); echo $((n + 1)) >"$count"
    [ "$n" -lt "\${FAKE_INSTALL_FAILURES:-0}" ] && exit 1
    mkdir -p "$sdk/$pkg" "$sdk/licenses"; touch "$sdk/$pkg/source.properties" "$sdk/licenses/android-sdk-license"
    # Like the real packages, these two ship an executable the scripts call.
    case "$pkg" in
      emulator) tool=emulator ;;
      platform-tools) tool=adb ;;
      *) tool= ;;
    esac
    if [ -n "$tool" ]; then
      printf '#!/bin/bash\necho "%s $*" >>"$LOG"\n. "$FAKEBIN/%s.impl"\n' "$tool" "$tool" >"$sdk/$pkg/$tool"
      chmod +x "$sdk/$pkg/$tool"
    fi`,
  avdmanager: `for a in "$@"; do case "$prev" in --name) echo "$a" >>"$WORK/avds" ;; esac; prev="$a"; done`,
  emulator: `[ "$1" = -list-avds ] && cat "$WORK/avds" 2>/dev/null; true`,
  adb: `
    case "$1 $2" in
      "devices ") printf 'List of devices attached\\n%s' "\${FAKE_ADB_DEVICES:-}" ;;
      "shell getprop") echo 1 ;;
    esac; true`,
  'xcode-select': `echo "\${FAKE_DEVELOPER_DIR-/Applications/Xcode.app/Contents/Developer}"`,
  xcodebuild: `
    case "$1" in
      -checkFirstLaunchStatus) exit "\${FAKE_FIRST_LAUNCH:-0}" ;;
      -license) exit "\${FAKE_LICENSE:-0}" ;;
      -version) echo "Xcode 27.0" ;;
      -downloadPlatform) echo '{"runtimes":[{"platform":"iOS","isAvailable":true,"identifier":"rt.iOS-27-0","version":"27.0"}]}' >"$WORK/runtimes.json" ;;
    esac`,
  xcrun: `
    case "$2 $3" in
      "list runtimes") cat "$WORK/runtimes.json" ;;
      "list devices") cat "$WORK/booted.json" ;;
      "list --json") cat "$WORK/all.json" ;;
      "create iPhone (make setup)") echo NEW-UDID ;;
    esac; true`,
  gem: `[ "$1" = list ] && exit "\${FAKE_GEM_MISSING:-0}"; echo "LANG=$LANG" >>"$LOG"`,
  pod: 'echo 1.17.0',
  security: `printf '%s' "\${FAKE_IDENTITIES:-  0 valid identities found}"`,
  java: 'echo \'openjdk version "17.0.20"\' >&2',
  ruby: 'printf 3.3.12',
  watchman: 'echo 2026.9.21',
};

/**
 * A repository copy holding scripts/setup, a fake React Native catalogue and a
 * versions.env whose checksums match the fixture archives; fakes on PATH.
 */
function sandbox({ catalog = {} } = {}) {
  const work = mkdtempSync(path.join(tmpdir(), 'setup-test-'));
  sandboxes.push(work);
  const repo = path.join(work, 'repo');
  const home = path.join(work, 'home');
  const bin = path.join(work, 'bin');
  const fixtures = path.join(work, 'fixtures');
  for (const dir of [repo, home, bin, fixtures]) mkdirSync(dir, { recursive: true });
  cpSync(HERE, path.join(repo, 'scripts/setup'), { recursive: true });

  const pins = { compileSdk: '36', buildTools: '36.0.0', ndkVersion: '27.1.12297006', ...catalog };
  const toml = path.join(repo, 'node_modules/react-native/gradle/libs.versions.toml');
  mkdirSync(path.dirname(toml), { recursive: true });
  writeFileSync(
    toml,
    `[versions]\n${Object.entries(pins)
      .map(([k, v]) => `${k} = "${v}"`)
      .join('\n')}\n`,
  );

  const tools = makeZip(fixtures, 'tools', {
    'cmdline-tools/bin/android': `#!/bin/bash\necho "android $*" >>"$LOG"\n. "$FAKEBIN/android.impl"`,
    'cmdline-tools/bin/avdmanager': `#!/bin/bash\necho "avdmanager $*" >>"$LOG"\n. "$FAKEBIN/avdmanager.impl"`,
  });
  const toolsName = 'commandlinetools-mac_arm64-16111833_latest.zip';
  cpSync(tools, path.join(fixtures, toolsName));
  const maestro = makeZip(fixtures, 'maestro', {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell expansion, not a template
    'maestro/bin/maestro': '#!/bin/bash\necho "${FAKE_MAESTRO_REPORTS:-2.10.0}"',
    'maestro/lib/maestro.jar': 'jar',
  });

  const versions = path.join(repo, 'scripts/setup/versions.env');
  writeFileSync(
    versions,
    readFileSync(versions, 'utf8')
      .replace(
        /^ANDROID_CMDLINE_TOOLS_SHA1_DARWIN_ARM64=.*$/m,
        `ANDROID_CMDLINE_TOOLS_SHA1_DARWIN_ARM64=${sha(1, tools)}`,
      )
      .replace(/^MAESTRO_SHA256=.*$/m, `MAESTRO_SHA256=${sha(256, maestro)}`),
  );

  for (const [name, body] of Object.entries(FAKES)) {
    // android and avdmanager live inside the SDK (unzipped from the fixture);
    // their bodies are sourced from here, and so is the SDK's emulator/adb.
    writeFileSync(path.join(bin, `${name}.impl`), body);
    writeFileSync(
      path.join(bin, name),
      `#!/bin/bash\necho "${name} $*" >>"$LOG"\n. "$FAKEBIN/${name}.impl"\n`,
    );
    chmodSync(path.join(bin, name), 0o755);
  }
  writeFileSync(
    path.join(work, 'runtimes.json'),
    '{"runtimes":[{"platform":"iOS","isAvailable":true}]}',
  );
  writeFileSync(path.join(work, 'booted.json'), '{"devices":{}}');

  const log = path.join(work, 'log');
  writeFileSync(log, '');
  const env = {
    PATH: `${bin}:${NODE_DIR}:/usr/bin:/bin:/usr/sbin:/sbin`,
    HOME: home,
    TMPDIR: work,
    LOG: log,
    WORK: work,
    FAKEBIN: bin,
    FIXTURES: fixtures,
    SETUP_RETRY_DELAY: '0',
  };
  const sdk = path.join(home, 'Library/Android/sdk');

  /** Runs one setup script; stdin is closed, so `consent` cannot be answered. */
  const run = (script, args = [], extra = {}) => {
    const result = spawnSync('bash', [path.join(repo, 'scripts/setup', script), ...args], {
      // Never the real repository: anything a fake writes lands in the sandbox.
      cwd: work,
      env: { ...env, ...extra },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ...result, output: result.stdout + result.stderr };
  };
  const calls = (prefix) =>
    readFileSync(log, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith(`${prefix} `));
  /**
   * The calls matching `pattern`, once one has reached the log. A fake the
   * script starts with `nohup … &` can log after the script has exited, so
   * reading at once races it; this waits up to five seconds instead.
   */
  const callsOnceLogged = async (prefix, pattern) => {
    const deadline = Date.now() + 5000;
    let found = [];
    while (!found.length && Date.now() < deadline) {
      found = calls(prefix).filter((line) => pattern.test(line));
      if (!found.length) await delay(20);
    }
    return found;
  };
  const resetLog = () => writeFileSync(log, '');
  return { work, repo, home, sdk, bin, env, run, calls, callsOnceLogged, resetLog, log };
}

const installsOf = (calls) => calls('android').map((line) => line.split(' ').at(-1));

// ---------------------------------------------------------------- android.sh

test('android: a blank machine gets the SDK, every build package and the emulator', () => {
  const s = sandbox();
  const r = s.run('android.sh', ['--yes']);
  assert.equal(r.status, 0, r.output);

  // The SDK's own command-line tools, unpacked from the checksummed archive.
  assert.ok(existsSync(path.join(s.sdk, 'cmdline-tools/latest/bin/android')));
  // React Native's pins from its catalogue, AGP's fallbacks, and the image.
  assert.deepEqual(installsOf(s.calls), [
    'platform-tools',
    'emulator',
    'platforms/android-36',
    'build-tools/36.0.0',
    'ndk/27.1.12297006',
    'ndk/27.0.12077973',
    'build-tools/35.0.0',
    'cmake/3.22.1',
    'system-images/android-36/google_apis/arm64-v8a',
  ]);
  // Every install opts out of the CLI's default-on usage metrics.
  for (const call of s.calls('android'))
    assert.match(call, /^android --no-metrics sdk install --sdk=/);
  // avdmanager wants the semicolon form of the image path.
  assert.match(
    s.calls('avdmanager')[0],
    /create avd --name Pixel_10_API_36 --package system-images;android-36;google_apis;arm64-v8a -d pixel_10/,
  );
  assert.equal(readFileSync(path.join(s.repo, '.env.local'), 'utf8'), `ANDROID_HOME=${s.sdk}\n`);
});

test('android: packages follow the React Native catalogue, not a copy of it', () => {
  const s = sandbox({ catalog: { compileSdk: '37', buildTools: '37.0.0', ndkVersion: '28.0.1' } });
  assert.equal(s.run('android.sh', ['--yes']).status, 0);
  const installs = installsOf(s.calls);
  assert.ok(installs.includes('platforms/android-37'));
  assert.ok(installs.includes('build-tools/37.0.0'));
  assert.ok(installs.includes('ndk/28.0.1'));
});

test('android: installing accepts licences, so nothing installs without a yes', () => {
  const s = sandbox();
  const r = s.run('android.sh');
  assert.notEqual(r.status, 0);
  assert.match(r.output, /not confirmed: Install 9 Android SDK packages, accepting their licences/);
  assert.match(r.output, /SETUP_YES=1/);
  assert.deepEqual(s.calls('android'), []);
});

test('android: SETUP_YES=1 in the environment is the same yes as --yes', () => {
  const s = sandbox();
  assert.equal(s.run('android.sh', [], { SETUP_YES: '1' }).status, 0);
});

test('android: an SDK whose licences were accepted before is not asked again', () => {
  const s = sandbox();
  assert.equal(s.run('android.sh', ['--yes']).status, 0);
  rmSync(path.join(s.sdk, 'cmake'), { recursive: true });
  s.resetLog();
  const r = s.run('android.sh');
  assert.equal(r.status, 0, r.output);
  assert.deepEqual(installsOf(s.calls), ['cmake/3.22.1']);
});

test('android: a second run changes nothing', () => {
  const s = sandbox();
  writeFileSync(path.join(s.repo, '.env.local'), 'OTHER=kept\nANDROID_HOME=/old/sdk\n');
  // Explicit on the first run; the second relies on what that one recorded.
  assert.equal(s.run('android.sh', ['--yes'], { ANDROID_HOME: s.sdk }).status, 0);
  s.resetLog();
  const r = s.run('android.sh');
  assert.equal(r.status, 0, r.output);
  assert.deepEqual(s.calls('curl'), []);
  assert.deepEqual(s.calls('android'), []);
  assert.deepEqual(s.calls('avdmanager'), []);
  // Other per-machine values survive; ANDROID_HOME is replaced, not repeated.
  assert.equal(
    readFileSync(path.join(s.repo, '.env.local'), 'utf8'),
    `OTHER=kept\nANDROID_HOME=${s.sdk}\n`,
  );
});

test('android: a dropped connection mid-install is retried, not fatal', () => {
  const s = sandbox();
  const r = s.run('android.sh', ['--yes'], { FAKE_INSTALL_FAILURES: '2' });
  assert.equal(r.status, 0, r.output);
  assert.match(r.output, /attempt 1 of 3 failed/);
  assert.equal(installsOf(s.calls).filter((p) => p === 'platform-tools').length, 3);
});

test('android: a package that keeps failing stops the run and names itself', () => {
  const s = sandbox();
  const r = s.run('android.sh', ['--yes'], { FAKE_INSTALL_FAILURES: '99' });
  assert.notEqual(r.status, 0);
  assert.match(r.output, /gave up after 3 attempts: .*platform-tools/);
});

test('android: a tampered command-line tools download is refused', () => {
  const s = sandbox();
  writeFileSync(
    path.join(s.work, 'fixtures/commandlinetools-mac_arm64-16111833_latest.zip'),
    'not the archive',
  );
  const r = s.run('android.sh', ['--yes']);
  assert.notEqual(r.status, 0);
  assert.match(r.output, /checksum mismatch/);
  assert.ok(!existsSync(path.join(s.sdk, 'cmdline-tools/latest')));
});

test('android: ANDROID_HOME, when set, is where the SDK goes', () => {
  const s = sandbox();
  const custom = path.join(s.work, 'custom-sdk');
  assert.equal(s.run('android.sh', ['--yes'], { ANDROID_HOME: custom }).status, 0);
  assert.ok(existsSync(path.join(custom, 'platform-tools/source.properties')));
  assert.match(
    readFileSync(path.join(s.repo, '.env.local'), 'utf8'),
    new RegExp(`ANDROID_HOME=${custom}`),
  );
});

test('android: an explicit ANDROID_HOME wins over the one recorded in .env.local', () => {
  const s = sandbox();
  writeFileSync(path.join(s.repo, '.env.local'), 'ANDROID_HOME=/recorded/elsewhere\n');
  const custom = path.join(s.work, 'explicit-sdk');
  const r = s.run('android.sh', ['--yes'], { ANDROID_HOME: custom });
  assert.equal(r.status, 0, r.output);
  assert.ok(existsSync(path.join(custom, 'platform-tools/source.properties')));
  assert.equal(readFileSync(path.join(s.repo, '.env.local'), 'utf8'), `ANDROID_HOME=${custom}\n`);
});

test('android: without an explicit one, the SDK recorded in .env.local is reused', () => {
  const s = sandbox();
  const recorded = path.join(s.work, 'recorded-sdk');
  writeFileSync(path.join(s.repo, '.env.local'), `ANDROID_HOME=${recorded}\n`);
  assert.equal(s.run('android.sh', ['--yes']).status, 0);
  assert.ok(existsSync(path.join(recorded, 'platform-tools/source.properties')));
});

test('android: Linux on x86_64 gets its own archive and image', () => {
  const s = sandbox();
  cpSync(
    path.join(s.work, 'fixtures/tools.zip'),
    path.join(s.work, 'fixtures/commandlinetools-linux-16111833_latest.zip'),
  );
  const versions = path.join(s.repo, 'scripts/setup/versions.env');
  writeFileSync(
    versions,
    readFileSync(versions, 'utf8').replace(
      /^ANDROID_CMDLINE_TOOLS_SHA1_LINUX=.*$/m,
      `ANDROID_CMDLINE_TOOLS_SHA1_LINUX=${sha(1, path.join(s.work, 'fixtures/tools.zip'))}`,
    ),
  );
  const r = s.run('android.sh', ['--yes'], { FAKE_OS: 'Linux', FAKE_ARCH: 'x86_64' });
  assert.equal(r.status, 0, r.output);
  assert.match(s.calls('curl')[0], /commandlinetools-linux-/);
  assert.ok(installsOf(s.calls).includes('system-images/android-36/google_apis/x86_64'));
  assert.ok(existsSync(path.join(s.home, 'Android/Sdk/platform-tools')));
});

test('android: without node_modules it says to install first', () => {
  const s = sandbox();
  rmSync(path.join(s.repo, 'node_modules'), { recursive: true });
  const r = s.run('android.sh', ['--yes']);
  assert.notEqual(r.status, 0);
  assert.match(r.output, /libs.versions.toml is missing. Run: make setup-toolchain/);
});

test('android: --boot starts the emulator, waits for boot and turns animations off', async () => {
  const s = sandbox();
  assert.equal(s.run('android.sh', ['--yes']).status, 0);
  s.resetLog();
  const r = s.run('android.sh', ['--boot'], { CI: 'true' });
  assert.equal(r.status, 0, r.output);
  // Awaited before resetLog below, so a late write cannot land in the next run's log.
  assert.match(
    (await s.callsOnceLogged('emulator', / -avd /)).join('\n'),
    /-avd Pixel_10_API_36 .*-no-window/,
  );
  assert.equal(
    s.calls('adb').filter((c) => /animation_scale|animator_duration_scale/.test(c)).length,
    3,
  );

  s.resetLog();
  const again = s.run('android.sh', ['--boot'], { FAKE_ADB_DEVICES: 'emulator-5554\tdevice' });
  assert.equal(again.status, 0, again.output);
  assert.match(again.output, /an emulator is already running/);
  assert.deepEqual(
    s.calls('emulator').filter((c) => c.includes(' -avd ')),
    [],
  );
});

test('setup scripts refuse an unknown flag instead of ignoring it', () => {
  const s = sandbox();
  const r = s.run('android.sh', ['--yess']);
  assert.notEqual(r.status, 0);
  assert.match(r.output, /unknown argument: --yess/);
});

// ---------------------------------------------------------------- maestro.sh

test('maestro: installs the pinned, checksummed release without touching shell profiles', () => {
  const s = sandbox();
  const r = s.run('maestro.sh');
  assert.equal(r.status, 0, r.output);
  assert.match(s.calls('curl')[0], /cli-2\.10\.0\/maestro\.zip/);
  assert.ok(existsSync(path.join(s.home, '.maestro/bin/maestro')));
  assert.ok(existsSync(path.join(s.home, '.maestro/lib/maestro.jar')));
  assert.ok(!existsSync(path.join(s.home, '.zshrc')));

  s.resetLog();
  assert.equal(s.run('maestro.sh').status, 0);
  assert.deepEqual(s.calls('curl'), []);
});

test('maestro: an older install is replaced', () => {
  const s = sandbox();
  mkdirSync(path.join(s.home, '.maestro/bin'), { recursive: true });
  writeFileSync(path.join(s.home, '.maestro/bin/maestro'), '#!/bin/bash\necho 1.39.0', {
    mode: 0o755,
  });
  const r = s.run('maestro.sh');
  assert.equal(r.status, 0, r.output);
  assert.match(r.output, /replacing maestro 1\.39\.0/);
});

test('maestro: a tampered download is refused', () => {
  const s = sandbox();
  writeFileSync(path.join(s.work, 'fixtures/maestro.zip'), 'not the archive');
  const r = s.run('maestro.sh');
  assert.notEqual(r.status, 0);
  assert.match(r.output, /refusing an unverified Maestro download/);
});

test('maestro: an archive that does not report the pinned version fails loudly', () => {
  const s = sandbox();
  const r = s.run('maestro.sh', [], { FAKE_MAESTRO_REPORTS: '9.9.9' });
  assert.notEqual(r.status, 0);
  assert.match(r.output, /reports '9\.9\.9' after installing 2\.10\.0/);
});

// ---------------------------------------------------------------- ios.sh

test('ios: skipped entirely off macOS', () => {
  const s = sandbox();
  const r = s.run('ios.sh', [], { FAKE_OS: 'Linux' });
  assert.equal(r.status, 0);
  assert.match(r.output, /not macOS: iOS setup skipped/);
  assert.deepEqual(s.calls('xcodebuild'), []);
});

test('ios: a ready Mac only installs CocoaPods, pinned, under a UTF-8 locale', () => {
  const s = sandbox();
  const r = s.run('ios.sh', [], { FAKE_GEM_MISSING: '1', LANG: 'C' });
  assert.equal(r.status, 0, r.output);
  assert.ok(
    s.calls('gem').some((c) => c === 'gem install cocoapods --version 1.17.0 --no-document'),
  );
  assert.ok(readFileSync(s.log, 'utf8').includes('LANG=en_US.UTF-8'));
  assert.deepEqual(
    s.calls('xcodebuild').filter((c) => c.includes('-downloadPlatform')),
    [],
  );
});

for (const [name, env, hint] of [
  [
    'the Command Line Tools selected',
    { FAKE_DEVELOPER_DIR: '/Library/Developer/CommandLineTools' },
    /sudo xcode-select -s \/Applications\/Xcode\.app/,
  ],
  ['no Xcode at all', { FAKE_DEVELOPER_DIR: '' }, /Xcode is not installed/],
  ['first launch not done', { FAKE_FIRST_LAUNCH: '1' }, /sudo xcodebuild -runFirstLaunch/],
  ['licence not accepted', { FAKE_LICENSE: '1' }, /sudo xcodebuild -license accept/],
]) {
  test(`ios: ${name} stops with the exact admin command to run`, () => {
    const s = sandbox();
    const r = s.run('ios.sh', [], env);
    assert.notEqual(r.status, 0);
    assert.match(r.output, hint);
  });
}

test('ios: a missing simulator runtime is downloaded', () => {
  const s = sandbox();
  writeFileSync(path.join(s.work, 'runtimes.json'), '{"runtimes":[]}');
  const r = s.run('ios.sh');
  assert.equal(r.status, 0, r.output);
  assert.ok(s.calls('xcodebuild').includes('xcodebuild -downloadPlatform iOS'));
});

test('ios: no signing certificate is a warning that points at the skill', () => {
  const s = sandbox();
  const without = s.run('ios.sh');
  assert.equal(without.status, 0);
  assert.match(without.stderr, /no code signing certificate.*\n.*native-setup/);
  const withOne = s.run('ios.sh', [], {
    FAKE_IDENTITIES: '  1) ABC "Apple Development: x"\n     1 valid identities found',
  });
  assert.match(withOne.output, /1 signing identities/);
});

test('ios: --boot reuses a booted iPhone, boots an existing one, or creates one', () => {
  const s = sandbox();
  const rt = { identifier: 'rt.iOS-27-0', platform: 'iOS', isAvailable: true, version: '27.0' };
  const type = {
    identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro',
    name: 'iPhone 18 Pro',
  };

  writeFileSync(
    path.join(s.work, 'booted.json'),
    JSON.stringify({ devices: { [rt.identifier]: [{ name: 'iPhone 18 Pro', udid: 'BOOTED' }] } }),
  );
  assert.match(s.run('ios.sh', ['--boot']).output, /already booted: BOOTED/);

  writeFileSync(path.join(s.work, 'booted.json'), '{"devices":{}}');
  writeFileSync(
    path.join(s.work, 'all.json'),
    JSON.stringify({
      runtimes: [{ ...rt, supportedDeviceTypes: [type] }],
      devices: {
        [rt.identifier]: [
          { name: 'iPhone 17', udid: 'OLD', isAvailable: true },
          { name: 'iPhone 18 Pro', udid: 'NEW', isAvailable: true },
        ],
      },
    }),
  );
  s.resetLog();
  assert.equal(s.run('ios.sh', ['--boot']).status, 0);
  assert.ok(s.calls('xcrun').includes('xcrun simctl boot NEW'));

  writeFileSync(
    path.join(s.work, 'all.json'),
    JSON.stringify({ runtimes: [{ ...rt, supportedDeviceTypes: [type] }], devices: {} }),
  );
  s.resetLog();
  assert.equal(s.run('ios.sh', ['--boot']).status, 0);
  assert.ok(
    s
      .calls('xcrun')
      .some((c) =>
        c.startsWith(`xcrun simctl create iPhone (make setup) ${type.identifier} ${rt.identifier}`),
      ),
  );
  assert.ok(s.calls('xcrun').includes('xcrun simctl boot NEW-UDID'));
});

// ---------------------------------------------------------------- toolchain.sh

test('toolchain: mise is trusted and installed before any dependency, never after', () => {
  const s = sandbox();
  const r = s.run('toolchain.sh');
  assert.equal(r.status, 0, r.output);
  const order = readFileSync(s.log, 'utf8')
    .split('\n')
    .filter((line) => /^(mise (trust|install)|make )/.test(line));
  assert.deepEqual(order, [
    `mise trust --quiet ${s.repo}/.mise.toml`,
    'mise install --yes',
    `make -C ${s.repo} install`,
  ]);
});

test('toolchain: on a Mac without mise, Homebrew installs it', () => {
  const s = sandbox();
  // mise appears once brew has "installed" it.
  writeFileSync(path.join(s.bin, 'brew.impl'), `cp "$FAKEBIN/mise.real" "$FAKEBIN/mise"`);
  cpSync(path.join(s.bin, 'mise'), path.join(s.bin, 'mise.real'));
  rmSync(path.join(s.bin, 'mise'));
  const r = s.run('toolchain.sh');
  assert.equal(r.status, 0, r.output);
  assert.ok(s.calls('brew').includes('brew install mise'));
});

test('toolchain: elsewhere, the remote mise installer needs a yes', () => {
  const s = sandbox();
  rmSync(path.join(s.bin, 'mise'));
  const r = s.run('toolchain.sh', [], { FAKE_OS: 'Linux' });
  assert.notEqual(r.status, 0);
  assert.match(r.output, /not confirmed: Download and run the mise installer/);
  assert.deepEqual(s.calls('curl'), []);
});

// ---------------------------------------------------------------- .mise.toml

test('.mise.toml puts the SDK tools and Maestro on PATH from the ANDROID_HOME in .env.local', {
  skip: spawnSync('mise', ['--version']).status === 0 ? false : 'mise is not installed',
}, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'setup-mise-'));
  sandboxes.push(dir);
  // Only [env]: the [tools] pins are not what this test is about.
  const toml = readFileSync(path.join(HERE, '../../.mise.toml'), 'utf8');
  writeFileSync(path.join(dir, '.mise.toml'), toml.slice(toml.indexOf('[env]')));
  writeFileSync(path.join(dir, '.env.local'), 'ANDROID_HOME=/sdk-from-env-local\n');
  const result = spawnSync('mise', ['exec', '--', 'printenv', 'PATH'], {
    cwd: dir,
    encoding: 'utf8',
    // Trusted for this process only, never written to the machine's list.
    env: { ...process.env, MISE_TRUSTED_CONFIG_PATHS: dir, ANDROID_HOME: '' },
  });
  assert.equal(result.status, 0, result.stderr);
  const entries = result.stdout.trim().split(':');
  // `_.file` must be evaluated before `_.path`; the other order leaves
  // ANDROID_HOME set but adb missing, which is how `make doctor` failed.
  for (const tool of ['platform-tools', 'emulator', 'cmdline-tools/latest/bin']) {
    assert.ok(entries.includes(`/sdk-from-env-local/${tool}`), `${tool} missing from ${entries}`);
  }
  assert.ok(entries.some((entry) => entry.endsWith('/.maestro/bin')));
});

// ---------------------------------------------------------------- all.sh

test('all: toolchain, Maestro, Android, iOS, then the doctor, in that order', () => {
  const s = sandbox();
  const r = s.run('all.sh', ['--yes']);
  assert.equal(r.status, 0, r.output);
  const milestones = readFileSync(s.log, 'utf8')
    .split('\n')
    .map((line) =>
      /^mise install/.test(line)
        ? 'toolchain'
        : /^curl .*maestro\.zip/.test(line)
          ? 'maestro'
          : /^android .*platform-tools$/.test(line)
            ? 'android'
            : /^xcodebuild -version/.test(line)
              ? 'ios'
              : /^make doctor/.test(line)
                ? 'doctor'
                : null,
    )
    .filter(Boolean);
  assert.deepEqual(milestones, ['toolchain', 'maestro', 'android', 'ios', 'doctor']);
});

test('all: a failing step stops the run before the steps after it', () => {
  const s = sandbox();
  const r = s.run('all.sh', ['--yes'], { FAKE_INSTALL_FAILURES: '99' });
  assert.notEqual(r.status, 0);
  assert.deepEqual(s.calls('xcodebuild'), []);
  assert.deepEqual(
    s.calls('make').filter((c) => c.includes('doctor')),
    [],
  );
});

test('all: passes its flags on, so --yes reaches the Android licences', () => {
  const s = sandbox();
  const r = s.run('all.sh');
  assert.notEqual(r.status, 0);
  assert.match(r.output, /not confirmed: Install 9 Android SDK packages/);
});

// ------------------------------------------------- toolchain.sh, error paths

test('toolchain: a Mac without watchman gets it from Homebrew', () => {
  const s = sandbox();
  rmSync(path.join(s.bin, 'watchman'));
  writeFileSync(path.join(s.bin, 'brew.impl'), `cp "$FAKEBIN/watchman.real" "$FAKEBIN/watchman"`);
  writeFileSync(path.join(s.bin, 'watchman.real'), '#!/bin/bash\necho 2026.9.21\n', {
    mode: 0o755,
  });
  const r = s.run('toolchain.sh');
  assert.equal(r.status, 0, r.output);
  assert.ok(s.calls('brew').includes('brew install watchman'));
});

test('toolchain: without watchman or Homebrew it says where to get Homebrew', () => {
  const s = sandbox();
  rmSync(path.join(s.bin, 'watchman'));
  rmSync(path.join(s.bin, 'brew'));
  const r = s.run('toolchain.sh');
  assert.notEqual(r.status, 0);
  assert.match(r.output, /watchman needs Homebrew \(https:\/\/brew\.sh\)/);
});

test('toolchain: Linux needs no watchman', () => {
  const s = sandbox();
  rmSync(path.join(s.bin, 'watchman'));
  const r = s.run('toolchain.sh', [], { FAKE_OS: 'Linux' });
  assert.equal(r.status, 0, r.output);
  assert.doesNotMatch(r.output, /watchman/);
});

test('toolchain: with a yes, the mise installer runs and its ~/.local/bin is used', () => {
  const s = sandbox();
  cpSync(path.join(s.bin, 'mise'), path.join(s.bin, 'mise.real'));
  rmSync(path.join(s.bin, 'mise'));
  // What https://mise.run does: drop mise into ~/.local/bin.
  writeFileSync(
    path.join(s.work, 'fixtures/mise.run'),
    'mkdir -p "$HOME/.local/bin" && cp "$FAKEBIN/mise.real" "$HOME/.local/bin/mise"\n',
  );
  const r = s.run('toolchain.sh', ['--yes'], { FAKE_OS: 'Linux' });
  assert.equal(r.status, 0, r.output);
  assert.ok(existsSync(path.join(s.home, '.local/bin/mise')));
  assert.deepEqual(s.calls('curl'), ['curl -fsSL https://mise.run']);
});

test('toolchain: an installer that leaves no mise behind is reported, not ignored', () => {
  const s = sandbox();
  rmSync(path.join(s.bin, 'mise'));
  writeFileSync(path.join(s.work, 'fixtures/mise.run'), 'true\n');
  const r = s.run('toolchain.sh', ['--yes'], { FAKE_OS: 'Linux' });
  assert.notEqual(r.status, 0);
  assert.match(r.output, /mise is not on PATH after installing it/);
});

// --------------------------------------------------- android.sh, error paths

test('android: an OS other than macOS or Linux is refused', () => {
  const s = sandbox();
  const r = s.run('android.sh', ['--yes'], { FAKE_OS: 'FreeBSD' });
  assert.notEqual(r.status, 0);
  assert.match(r.output, /unsupported OS freebsd/);
});

test('android: a catalogue without the SDK pins is an error, not an empty package name', () => {
  const s = sandbox({ catalog: { ndkVersion: '' } });
  const r = s.run('android.sh', ['--yes']);
  assert.notEqual(r.status, 0);
  assert.match(r.output, /could not read compileSdk\/buildTools\/ndkVersion/);
  assert.deepEqual(s.calls('android'), []);
});

test('android: --boot gives up on an emulator that never finishes booting', () => {
  const s = sandbox();
  assert.equal(s.run('android.sh', ['--yes']).status, 0);
  writeFileSync(
    path.join(s.bin, 'adb.impl'),
    `case "$1 $2" in "devices ") echo 'List of devices attached' ;; "shell getprop") echo 0 ;; esac; true`,
  );
  const r = s.run('android.sh', ['--boot'], { SETUP_BOOT_TIMEOUT: '2' });
  assert.notEqual(r.status, 0);
  assert.match(r.output, /emulator did not finish booting; see .*emulator-Pixel_10_API_36\.log/);
});

// ------------------------------------------------ the remaining exit paths

test('android: an Intel Mac gets the x86_64 archive and image', () => {
  const s = sandbox();
  const tools = path.join(s.work, 'fixtures/tools.zip');
  cpSync(tools, path.join(s.work, 'fixtures/commandlinetools-mac_x86_64-16111833_latest.zip'));
  const versions = path.join(s.repo, 'scripts/setup/versions.env');
  writeFileSync(
    versions,
    readFileSync(versions, 'utf8').replace(
      /^ANDROID_CMDLINE_TOOLS_SHA1_DARWIN_X86_64=.*$/m,
      `ANDROID_CMDLINE_TOOLS_SHA1_DARWIN_X86_64=${sha(1, tools)}`,
    ),
  );
  const r = s.run('android.sh', ['--yes'], { FAKE_ARCH: 'x86_64' });
  assert.equal(r.status, 0, r.output);
  assert.match(s.calls('curl')[0], /commandlinetools-mac_x86_64-/);
  assert.ok(installsOf(s.calls).includes('system-images/android-36/google_apis/x86_64'));
});

test('android: an install that reports success but leaves nothing behind is caught', () => {
  const s = sandbox();
  assert.equal(s.run('android.sh', ['--yes']).status, 0);
  rmSync(path.join(s.sdk, 'cmake'), { recursive: true });
  writeFileSync(path.join(s.bin, 'android.impl'), 'true');
  const r = s.run('android.sh');
  assert.notEqual(r.status, 0);
  assert.match(r.output, /cmake\/3\.22\.1 did not install \(no source\.properties\)/);
});

test('ios: a runtime download that still leaves no iOS runtime is reported', () => {
  const s = sandbox();
  writeFileSync(path.join(s.work, 'runtimes.json'), '{"runtimes":[]}');
  writeFileSync(
    path.join(s.bin, 'xcodebuild.impl'),
    'case "$1" in -version) echo "Xcode 27.0" ;; esac; true',
  );
  const r = s.run('ios.sh');
  assert.notEqual(r.status, 0);
  assert.match(r.output, /no iOS simulator runtime after xcodebuild -downloadPlatform iOS/);
});

test('ios: --boot with no iPhone device type for the runtime says so', () => {
  const s = sandbox();
  writeFileSync(
    path.join(s.work, 'all.json'),
    JSON.stringify({
      runtimes: [
        {
          identifier: 'rt.iOS-27-0',
          platform: 'iOS',
          isAvailable: true,
          version: '27.0',
          supportedDeviceTypes: [],
        },
      ],
      devices: {},
    }),
  );
  const r = s.run('ios.sh', ['--boot']);
  assert.notEqual(r.status, 0);
  assert.match(r.output, /no iPhone device type for rt\.iOS-27-0/);
});

test('the platform scripts need the toolchain first, and say which target installs it', () => {
  for (const script of ['android.sh', 'maestro.sh', 'ios.sh']) {
    const s = sandbox();
    rmSync(path.join(s.bin, 'mise'));
    const r = s.run(
      script,
      ['--yes'].filter(() => script === 'android.sh'),
    );
    assert.notEqual(r.status, 0, script);
    assert.match(r.output, /mise is not installed\. Run: make setup-toolchain/, script);
  }
});

// `consent` in a terminal: the script runs on a real pseudo-terminal (Python's
// pty module, the same on macOS and Linux) and the answer is typed into it once
// the question appears.
const PTY_DRIVER = `
import os, pty, sys
answer = sys.argv[1].encode() + b"\\n"
pid, fd = pty.fork()
if pid == 0:
    os.execvp("bash", ["bash"] + sys.argv[2:])
out, sent = b"", False
while True:
    try:
        chunk = os.read(fd, 4096)
    except OSError:
        break
    if not chunk:
        break
    out += chunk
    if not sent and b"[y/N]" in out:
        os.write(fd, answer)
        sent = True
sys.stdout.write(out.decode(errors="replace"))
sys.exit(os.waitpid(pid, 0)[1] >> 8)
`;
const PTY_SKIP =
  spawnSync('python3', ['-c', 'import pty']).status === 0
    ? false
    : 'python3 with pty is not available';

function runInTerminal(s, script, answer) {
  const result = spawnSync(
    'python3',
    ['-c', PTY_DRIVER, answer, path.join(s.repo, 'scripts/setup', script)],
    { cwd: s.work, env: s.env, encoding: 'utf8' },
  );
  return { ...result, output: `${result.stdout}${result.stderr}` };
}

test('android: in a terminal, the licence question is asked and a yes installs', {
  skip: PTY_SKIP,
}, () => {
  const s = sandbox();
  const yes = runInTerminal(s, 'android.sh', 'y');
  assert.match(
    yes.output,
    /\?\? {4}Install 9 Android SDK packages, accepting their licences.*\[y\/N\]/,
  );
  assert.equal(yes.status, 0, yes.output);
  assert.equal(installsOf(s.calls).length, 9);
});

test('android: in a terminal, anything but yes is a no', { skip: PTY_SKIP }, () => {
  const s = sandbox();
  const no = runInTerminal(s, 'android.sh', 'n');
  assert.notEqual(no.status, 0);
  assert.match(no.output, /not confirmed/);
  assert.deepEqual(s.calls('android'), []);
});

test('.mise.toml gives a shell without a locale UTF-8, and leaves a chosen one alone', {
  skip: spawnSync('mise', ['--version']).status === 0 ? false : 'mise is not installed',
}, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'setup-mise-'));
  sandboxes.push(dir);
  const toml = readFileSync(path.join(HERE, '../../.mise.toml'), 'utf8');
  writeFileSync(path.join(dir, '.mise.toml'), toml.slice(toml.indexOf('[env]')));
  const langIn = (lang) => {
    const env = { ...process.env, MISE_TRUSTED_CONFIG_PATHS: dir };
    if (lang) env.LANG = lang;
    else delete env.LANG;
    return spawnSync('mise', ['exec', '--', 'printenv', 'LANG'], {
      cwd: dir,
      env,
      encoding: 'utf8',
    }).stdout.trim();
  };
  // Without it Ruby reads source as US-ASCII, and fastlane and CocoaPods break.
  assert.equal(langIn(undefined), 'en_US.UTF-8');
  assert.equal(langIn('sv_SE.UTF-8'), 'sv_SE.UTF-8');
});
