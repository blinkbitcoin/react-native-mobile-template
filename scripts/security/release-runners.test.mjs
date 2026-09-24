// The six runners the release gate added: sbom, bundle, mobile, binaries,
// review and openant. Each is run for real as a bash script against this
// repository, with every external tool replaced by a fake on PATH - the real
// ones (expo export, a prebuild, mobsfscan, aapt2, an LLM) take minutes, need
// an SDK or a key, and are not what these tests are about: the runner's own
// decisions are. The runners under test never see a real scanner, so the
// outcome is the same on a laptop and in CI's Unit job.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const withDir = (fn) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'release-runners-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** Writes executable fakes into `<dir>/bin` and returns that directory. */
const fakes = (dir, scripts) => {
  const bin = path.join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  for (const [name, body] of Object.entries(scripts)) {
    const file = path.join(bin, name);
    writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(file, 0o755);
  }
  return bin;
};

// A PATH with only the basics a runner needs besides the tool under test, so
// "the tool is missing" is really true - including on a machine that has it.
const BASICS = [
  'bash',
  'env',
  'mkdir',
  'grep',
  'dirname',
  'basename',
  'sed',
  'cat',
  'find',
  'sort',
  'head',
  'mktemp',
  'rm',
  'rsync',
  'ln',
  'awk',
  'tr',
  'unzip',
  'git',
  'pwd',
  'python3',
  'openssl',
  'chmod',
  'cp',
];
const minimalPath = (dir) => {
  const bin = path.join(dir, 'basics');
  mkdirSync(bin, { recursive: true });
  symlinkSync(process.execPath, path.join(bin, 'node'));
  for (const tool of BASICS) {
    const found = spawnSync('/usr/bin/which', [tool], { encoding: 'utf8' }).stdout.trim();
    if (found) symlinkSync(found, path.join(bin, tool));
  }
  return bin;
};

const run = (script, { env = {}, args = [] } = {}) =>
  spawnSync('bash', [path.join(root, 'scripts/security', script), ...args], {
    cwd: root,
    encoding: 'utf8',
    // No ANDROID_HOME: the runners must find build tools on PATH, where the
    // fakes are, never in a real SDK on the machine running the tests.
    env: {
      ...process.env,
      CI: '',
      ANDROID_HOME: '',
      ANDROID_SDK_ROOT: '',
      SECURITY_POLICY_FILE: '/nonexistent/security-policy.json',
      ...env,
    },
  });

const sarif = (dir, job) => JSON.parse(readFileSync(path.join(dir, `${job}.sarif`), 'utf8'));
const note = (doc) =>
  doc.runs[0].invocations[0].toolExecutionNotifications?.[0]?.message.text ?? '';
const ruleIds = (doc) => doc.runs[0].results.map((r) => r.ruleId);

// Every runner starts the same way. One loop instead of six copies.
for (const job of ['sbom', 'bundle', 'mobile', 'binaries', 'review', 'openant']) {
  test(`${job}: switched off, it writes a skipped SARIF and exits 0`, () => {
    withDir((dir) => {
      const result = run(`${job}.sh`, {
        env: { SECURITY_DIR: dir, [`SECURITY_${job.toUpperCase()}`]: 'false' },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(note(sarif(dir, job)), /disabled/);
    });
  });
}

// ---------- sbom ----------

const FAKE_PNPM = (components) => `
out=""
while [ $# -gt 0 ]; do [ "$1" = --out ] && out="$2"; shift; done
printf '{"bomFormat":"CycloneDX","components":${components}}' > "$out"`;

test('sbom: writes the bill beside a clean SARIF that counts it', () => {
  withDir((dir) => {
    const bin = fakes(dir, { pnpm: FAKE_PNPM('[{},{},{}]') });
    const result = run('sbom.sh', {
      env: { SECURITY_DIR: dir, PATH: `${bin}:${process.env.PATH}` },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(path.join(dir, 'sbom.cdx.json')));
    assert.match(note(sarif(dir, 'sbom')), /^3 components/);
  });
});

test('sbom: a bill that lists nothing fails the job rather than reading as clean', () => {
  withDir((dir) => {
    const bin = fakes(dir, { pnpm: FAKE_PNPM('[]') });
    const result = run('sbom.sh', {
      env: { SECURITY_DIR: dir, PATH: `${bin}:${process.env.PATH}` },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no components/);
  });
});

test('sbom: without pnpm it skips locally and fails under CI', () => {
  withDir((dir) => {
    const bare = minimalPath(dir);
    assert.equal(run('sbom.sh', { env: { SECURITY_DIR: dir, PATH: bare } }).status, 0);
    assert.match(note(sarif(dir, 'sbom')), /pnpm is not installed/);
    assert.equal(run('sbom.sh', { env: { SECURITY_DIR: dir, PATH: bare, CI: 'true' } }).status, 1);
  });
});

// ---------- bundle ----------

// Writes one bundle per requested platform, as `expo export` lays them out.
const fakeExpoExport = (dir, content) =>
  path.join(
    fakes(dir, {
      expo: `
out=""; platforms=()
while [ $# -gt 0 ]; do
  case "$1" in --output-dir) out="$2" ;; --platform) platforms+=("$2") ;; esac
  shift
done
echo "$*" > "${dir}/expo-args"
for p in "\${platforms[@]}"; do
  mkdir -p "$out/_expo/static/js/$p"
  printf '%s' '${content}' > "$out/_expo/static/js/$p/entry.hbc"
done`,
    }),
    'expo',
  );

test('bundle: exports every platform and reports what the bundle gives away', () => {
  withDir((dir) => {
    const expo = fakeExpoExport(dir, 'http://plain.example.com');
    const result = run('bundle.sh', { env: { SECURITY_DIR: dir, SECURITY_EXPO_BIN: expo } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /scanned 2 bundle\(s\)/);
    assert.deepEqual(ruleIds(sarif(dir, 'bundle')), ['MASTG-TEST-0233', 'MASTG-TEST-0233']);
  });
});

test('bundle: bundle.platforms narrows the export', () => {
  withDir((dir) => {
    const expo = fakeExpoExport(dir, 'fine');
    const result = run('bundle.sh', {
      env: { SECURITY_DIR: dir, SECURITY_EXPO_BIN: expo, SECURITY_BUNDLE_PLATFORMS: 'android' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /scanned 1 bundle\(s\)/);
  });
});

test('bundle: an empty platform list is a skip, not an empty pass', () => {
  withDir((dir) => {
    const result = run('bundle.sh', { env: { SECURITY_DIR: dir, SECURITY_BUNDLE_PLATFORMS: '' } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(note(sarif(dir, 'bundle')), /bundle\.platforms is empty/);
  });
});

test('bundle: an export that wrote no bundle fails the job', () => {
  withDir((dir) => {
    const expo = path.join(fakes(dir, { expo: 'exit 0' }), 'expo');
    const result = run('bundle.sh', { env: { SECURITY_DIR: dir, SECURITY_EXPO_BIN: expo } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /wrote no bundle/);
  });
});

test('bundle: without dependencies it skips locally and fails under CI', () => {
  withDir((dir) => {
    const env = { SECURITY_DIR: dir, SECURITY_EXPO_BIN: path.join(dir, 'missing-expo') };
    assert.equal(run('bundle.sh', { env }).status, 0);
    assert.match(note(sarif(dir, 'bundle')), /dependencies are not installed/);
    const ci = run('bundle.sh', { env: { ...env, CI: 'true' } });
    assert.equal(ci.status, 1);
    assert.match(ci.stderr, /under CI that is a failure/);
  });
});

// ---------- mobile ----------

const MOBSF_SARIF = JSON.stringify({
  version: '2.1.0',
  runs: [{ tool: { driver: { name: 'mobsfscan' } }, results: [] }],
});

const mobileFakes = (dir, mobsfscan) =>
  fakes(dir, {
    expo: `echo "$*" > "${dir}/expo-args"; mkdir -p android ios`,
    mobsfscan,
  });

test('mobile: prebuilds into a copy and hands mobsfscan the configuration by name', () => {
  withDir((dir) => {
    const bin = mobileFakes(
      dir,
      `echo "$*" > "${dir}/mobsf-args"; pwd > "${dir}/mobsf-cwd"
while [ $# -gt 0 ]; do [ "$1" = -o ] && printf '%s' '${MOBSF_SARIF}' > "$2"; shift; done`,
    );
    const result = run('mobile.sh', {
      env: {
        SECURITY_DIR: dir,
        SECURITY_EXPO_BIN: path.join(bin, 'expo'),
        PATH: `${bin}:${process.env.PATH}`,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      readFileSync(path.join(dir, 'expo-args'), 'utf8'),
      /prebuild --platform all --clean --no-install/,
    );
    const args = readFileSync(path.join(dir, 'mobsf-args'), 'utf8');
    assert.match(args, /--sarif --no-fail -c .*\/\.mobsf -o .*mobile\.sarif android ios/);
    // Never the working tree's own ios/ and android/.
    assert.notEqual(readFileSync(path.join(dir, 'mobsf-cwd'), 'utf8').trim(), root);
    assert.equal(sarif(dir, 'mobile').runs[0].tool.driver.name, 'mobsfscan');
  });
});

test('mobile: a .mobsf that mobsfscan could not read fails the job', () => {
  withDir((dir) => {
    const bin = mobileFakes(dir, `echo 'The config \`ignore-pathz\` is not supported.' >&2`);
    const result = run('mobile.sh', {
      env: {
        SECURITY_DIR: dir,
        SECURITY_EXPO_BIN: path.join(bin, 'expo'),
        PATH: `${bin}:${process.env.PATH}`,
      },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /could not read \.mobsf/);
  });
});

test('mobile: a mobsfscan crash fails the job and shows its output', () => {
  withDir((dir) => {
    const bin = mobileFakes(dir, 'echo "Traceback: boom" >&2; exit 3');
    const result = run('mobile.sh', {
      env: {
        SECURITY_DIR: dir,
        SECURITY_EXPO_BIN: path.join(bin, 'expo'),
        PATH: `${bin}:${process.env.PATH}`,
      },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Traceback: boom/);
  });
});

test('mobile: without mobsfscan, or without dependencies, it skips locally and fails under CI', () => {
  withDir((dir) => {
    const bare = minimalPath(dir);
    assert.equal(run('mobile.sh', { env: { SECURITY_DIR: dir, PATH: bare } }).status, 0);
    assert.match(note(sarif(dir, 'mobile')), /mobsfscan is not installed/);
    const bin = fakes(dir, { mobsfscan: 'exit 0' });
    const env = {
      SECURITY_DIR: dir,
      PATH: `${bin}:${bare}`,
      SECURITY_EXPO_BIN: path.join(dir, 'missing'),
    };
    assert.equal(run('mobile.sh', { env }).status, 0);
    assert.match(note(sarif(dir, 'mobile')), /dependencies are not installed/);
    assert.equal(run('mobile.sh', { env: { ...env, CI: 'true' } }).status, 1);
  });
});

// ---------- binaries ----------

const MANIFEST = [
  'N: android=http://schemas.android.com/apk/res/android (line=2)',
  '  E: manifest (line=2)',
  '      E: application (line=5)',
  '        A: http://schemas.android.com/apk/res/android:debuggable(0x0101000f)=true',
  '        A: http://schemas.android.com/apk/res/android:allowBackup(0x01010280)=false',
  '        A: http://schemas.android.com/apk/res/android:networkSecurityConfig(0x01010527)=@0x7f150002',
].join('\n');
const NSC =
  'N: x\n  E: network-security-config (line=1)\n      E: base-config (line=2)\n        A: cleartextTrafficPermitted=true';
const RESOURCES =
  '    resource 0x7f150002 xml/network_security_config\n      () (file) res/xml/nsc.xml type=XML';
const SIGNER =
  'Verified using v2 scheme (APK Signature Scheme v2): true\nSigner #1 key size (bits): 2048';

const androidFakes = (dir, { resources = RESOURCES, signer = `echo '${SIGNER}'` } = {}) =>
  fakes(dir, {
    aapt2: `
if [ "$1 $2" = "dump xmltree" ] && [ "$4" = AndroidManifest.xml ]; then echo '${MANIFEST}'
elif [ "$1 $2" = "dump xmltree" ]; then echo '${NSC}'
elif [ "$1 $2" = "dump resources" ]; then echo '${resources}'
else exit 9; fi`,
    apksigner: signer,
  });

test('binaries: nothing to check is a skip that says how to give it something', () => {
  withDir((dir) => {
    const result = run('binaries.sh', { env: { SECURITY_DIR: dir, APK: '', IPA: '' } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(note(sarif(dir, 'binaries')), /no binaries to check/);
  });
});

test('binaries: a named file that does not exist fails the job', () => {
  withDir((dir) => {
    const result = run('binaries.sh', {
      env: { SECURITY_DIR: dir, APK: path.join(dir, 'nope.apk') },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no such file/);
  });
});

test('binaries: the APK is read with aapt2 and apksigner, the network config through the resource table', () => {
  withDir((dir) => {
    const apk = path.join(dir, 'app-universal.apk');
    writeFileSync(apk, 'not really an apk');
    const bin = androidFakes(dir);
    const result = run('binaries.sh', {
      env: { SECURITY_DIR: dir, APK: apk, PATH: `${bin}:${process.env.PATH}` },
    });
    assert.equal(result.status, 0, result.stderr);
    const doc = sarif(dir, 'binaries');
    assert.deepEqual(ruleIds(doc), ['MASTG-TEST-0226', 'MASTG-TEST-0235']);
    assert.equal(
      doc.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri,
      'app-universal.apk',
    );
  });
});

test('binaries: SECURITY_BINARIES_DIR supplies the APK, the way CI hands it over', () => {
  withDir((dir) => {
    const assets = path.join(dir, 'assets');
    mkdirSync(assets);
    writeFileSync(path.join(assets, 'app.apk'), 'x');
    writeFileSync(path.join(assets, 'app.aab'), 'x');
    const bin = androidFakes(dir);
    const result = run('binaries.sh', {
      env: {
        SECURITY_DIR: dir,
        SECURITY_BINARIES_DIR: assets,
        APK: '',
        IPA: '',
        PATH: `${bin}:${process.env.PATH}`,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(sarif(dir, 'binaries').runs[0].results.length, 2);
  });
});

test('binaries: a network config the resource table cannot place fails the job', () => {
  withDir((dir) => {
    const apk = path.join(dir, 'a.apk');
    writeFileSync(apk, 'x');
    const bin = androidFakes(dir, { resources: '    resource 0x7f000000 xml/other' });
    const result = run('binaries.sh', {
      env: { SECURITY_DIR: dir, APK: apk, PATH: `${bin}:${process.env.PATH}` },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no file for it/);
  });
});

test('binaries: an APK apksigner cannot verify fails the job', () => {
  withDir((dir) => {
    const apk = path.join(dir, 'a.apk');
    writeFileSync(apk, 'x');
    const bin = androidFakes(dir, { signer: 'echo "DOES NOT VERIFY"; exit 1' });
    const result = run('binaries.sh', {
      env: { SECURITY_DIR: dir, APK: apk, PATH: `${bin}:${process.env.PATH}` },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DOES NOT VERIFY/);
  });
});

test('binaries: missing build tools leave the run skipped locally and fail it under CI', () => {
  withDir((dir) => {
    const apk = path.join(dir, 'a.apk');
    writeFileSync(apk, 'x');
    const bare = minimalPath(dir);
    const result = run('binaries.sh', { env: { SECURITY_DIR: dir, APK: apk, PATH: bare } });
    assert.equal(result.status, 0, result.stderr);
    const [invocation] = sarif(dir, 'binaries').runs[0].invocations;
    assert.equal(invocation.executionSuccessful, false);
    assert.deepEqual(
      invocation.toolExecutionNotifications.map((n) => n.message.text.split(' (')[0]),
      ['skipped: aapt2 is not installed', 'skipped: apksigner is not installed'],
    );
    const ci = run('binaries.sh', { env: { SECURITY_DIR: dir, APK: apk, PATH: bare, CI: 'true' } });
    assert.equal(ci.status, 1);
    assert.match(ci.stderr, /aapt2 is not installed.*under CI that is a failure/);
  });
});

// An IPA is a zip with Payload/<name>.app inside. python3 builds one, with an
// XML Info.plist and a stand-in provisioning profile the fake openssl unwraps.
const makeIpa = (dir, { info, profile = true }) => {
  const ipa = path.join(dir, 'App.ipa');
  const script = `
import plistlib, sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w") as z:
    z.writestr("Payload/App.app/Info.plist", plistlib.dumps(${info}))
    if sys.argv[2] == "yes":
        z.writestr("Payload/App.app/embedded.mobileprovision", b"signed-blob")
`;
  const made = spawnSync('python3', ['-c', script, ipa, profile ? 'yes' : 'no'], {
    encoding: 'utf8',
  });
  assert.equal(made.status, 0, made.stderr);
  return ipa;
};
const PROFILE_PLIST =
  '<?xml version="1.0"?><plist version="1.0"><dict><key>Entitlements</key><dict><key>get-task-allow</key><true/></dict></dict></plist>';

test('binaries: the IPA is read through plistlib and its provisioning profile', () => {
  withDir((dir) => {
    const ipa = makeIpa(dir, {
      info: '{"NSAppTransportSecurity": {"NSAllowsArbitraryLoads": True}}',
    });
    const bin = fakes(dir, { openssl: `echo '${PROFILE_PLIST}'` });
    const result = run('binaries.sh', {
      env: { SECURITY_DIR: dir, IPA: ipa, APK: '', PATH: `${bin}:${process.env.PATH}` },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(ruleIds(sarif(dir, 'binaries')), ['MASTG-TEST-0261', 'MASTG-TEST-0322']);
  });
});

test('binaries: an IPA with no provisioning profile says get-task-allow went unchecked', () => {
  withDir((dir) => {
    const ipa = makeIpa(dir, { info: '{}', profile: false });
    const result = run('binaries.sh', { env: { SECURITY_DIR: dir, IPA: ipa, APK: '' } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      note(sarif(dir, 'binaries')),
      /no embedded\.mobileprovision: the get-task-allow check did not run/,
    );
  });
});

test('binaries: a file that is not an iOS archive fails the job', () => {
  withDir((dir) => {
    const ipa = path.join(dir, 'broken.ipa');
    writeFileSync(ipa, 'not a zip');
    const result = run('binaries.sh', { env: { SECURITY_DIR: dir, IPA: ipa, APK: '' } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not an iOS app archive/);
  });
});

test('binaries: without python3 or openssl the iOS checks are skipped locally', () => {
  withDir((dir) => {
    const ipa = makeIpa(dir, { info: '{}' });
    const noPython = minimalPath(dir);
    rmSync(path.join(noPython, 'python3'), { force: true });
    run('binaries.sh', { env: { SECURITY_DIR: dir, IPA: ipa, APK: '', PATH: noPython } });
    assert.match(note(sarif(dir, 'binaries')), /python3 is not installed/);
    rmSync(path.join(noPython, 'openssl'), { force: true });
    const withPython = fakes(dir, { python3: 'exit 0' });
    run('binaries.sh', {
      env: { SECURITY_DIR: dir, IPA: ipa, APK: '', PATH: `${withPython}:${noPython}` },
    });
    assert.match(note(sarif(dir, 'binaries')), /openssl is not installed/);
  });
});

// ---------- review ----------

test("review: switched on with no provider, the runner writes the reviewer's skip", () => {
  withDir((dir) => {
    const result = run('review.sh', {
      env: { SECURITY_DIR: dir, SECURITY_REVIEW: 'true', SECURITY_LLM_PROVIDER: '' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(note(sarif(dir, 'review')), /no LLM provider configured/);
  });
});

test('review: without git it skips locally and fails under CI', () => {
  withDir((dir) => {
    const bare = minimalPath(dir);
    rmSync(path.join(bare, 'git'), { force: true });
    const env = { SECURITY_DIR: dir, SECURITY_REVIEW: 'true', PATH: bare };
    assert.equal(run('review.sh', { env }).status, 0);
    assert.match(note(sarif(dir, 'review')), /git is not installed/);
    assert.equal(run('review.sh', { env: { ...env, CI: 'true' } }).status, 1);
  });
});

// ---------- openant ----------

const OPENANT_ON = {
  SECURITY_OPENANT: 'true',
  SECURITY_LLM_PROVIDER: 'openai',
  SECURITY_LLM_MODEL: 'kimi-k3',
  OPENAI_API_KEY: 'sk-test-openant',
  OPENAI_BASE_URL: 'https://api.moonshot.ai/v1',
};

// A fake openant: `scan` records its arguments and a copy of the
// configuration it was given, writes a results file, and exits with $SCAN;
// `report` writes the SARIF where -o says.
const fakeOpenant = (dir, { scan = 1, results = true, report = 0 } = {}) =>
  fakes(dir, {
    openant: `
if [ "$1" = scan ]; then
  echo "$*" > "${dir}/scan-args"
  cp "$XDG_CONFIG_HOME/openant/config.json" "${dir}/config.json"
  stat -f %Lp "$XDG_CONFIG_HOME/openant/config.json" 2>/dev/null > "${dir}/config-mode" || stat -c %a "$XDG_CONFIG_HOME/openant/config.json" > "${dir}/config-mode"
  out=""; while [ $# -gt 0 ]; do [ "$1" = -o ] && out="$2"; shift; done
  ${results ? 'mkdir -p "$out/x" && echo "{}" > "$out/x/results_verified.json"' : ':'}
  exit ${scan}
fi
if [ "$1" = report ]; then
  echo "$*" > "${dir}/report-args"
  [ ${report} = 0 ] || { echo "report broke" >&2; exit ${report}; }
  while [ $# -gt 0 ]; do [ "$1" = -o ] && echo '{"version":"2.1.0","runs":[{"tool":{"driver":{"name":"OpenAnt"}},"results":[]}]}' > "$2"; shift; done
fi`,
  });

test('openant: every missing piece of configuration is a skip with its reason', () => {
  withDir((dir) => {
    const cases = [
      [{ SECURITY_LLM_PROVIDER: '' }, /no LLM provider configured/],
      [{ OPENAI_API_KEY: '' }, /OPENAI_API_KEY is not set/],
      [
        { SECURITY_LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: '' },
        /ANTHROPIC_API_KEY is not set/,
      ],
      [{ SECURITY_LLM_MODEL: '' }, /no model configured/],
      [{ PATH: minimalPath(dir) }, /openant is not installed/],
    ];
    for (const [overrides, reason] of cases) {
      const result = run('openant.sh', { env: { SECURITY_DIR: dir, ...OPENANT_ON, ...overrides } });
      assert.equal(result.status, 0, result.stderr);
      assert.match(note(sarif(dir, 'openant')), reason);
    }
  });
});

test('openant: scans with a private configuration built from the llm settings, then reports SARIF', () => {
  withDir((dir) => {
    const bin = fakeOpenant(dir);
    const result = run('openant.sh', {
      env: {
        SECURITY_DIR: dir,
        ...OPENANT_ON,
        SECURITY_OPENANT_LIMIT: '25',
        SECURITY_OPENANT_VERIFY: 'true',
        PATH: `${bin}:${process.env.PATH}`,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const args = readFileSync(path.join(dir, 'scan-args'), 'utf8');
    assert.match(
      args,
      /^scan \. -l javascript -o \S+ --llm-config security --skip-dynamic-test --no-report --limit 25 --verify$/m,
    );
    const config = JSON.parse(readFileSync(path.join(dir, 'config.json'), 'utf8'));
    assert.deepEqual(config.llm_providers.security, {
      type: 'openai',
      api_key: 'sk-test-openant',
      base_url: 'https://api.moonshot.ai/v1',
    });
    assert.equal(Object.keys(config.llm_configs.security).length, 7);
    assert.equal(config.llm_configs.security.analyze.model, 'kimi-k3');
    assert.equal(readFileSync(path.join(dir, 'config-mode'), 'utf8').trim(), '600');
    assert.match(
      readFileSync(path.join(dir, 'report-args'), 'utf8'),
      /results_verified\.json -f sarif -o /,
    );
    assert.equal(sarif(dir, 'openant').runs[0].tool.driver.name, 'OpenAnt');
    // The key must never reach the job log.
    assert.doesNotMatch(result.stdout + result.stderr, /sk-test-openant/);
  });
});

test('openant: an Anthropic provider gets no base URL, and default limits add no flags', () => {
  withDir((dir) => {
    const bin = fakeOpenant(dir, { scan: 0 });
    const result = run('openant.sh', {
      env: {
        SECURITY_DIR: dir,
        ...OPENANT_ON,
        SECURITY_LLM_PROVIDER: 'anthropic',
        ANTHROPIC_API_KEY: 'sk-ant-x',
        PATH: `${bin}:${process.env.PATH}`,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(readFileSync(path.join(dir, 'config.json'), 'utf8'));
    assert.deepEqual(config.llm_providers.security, { type: 'anthropic', api_key: 'sk-ant-x' });
    assert.doesNotMatch(readFileSync(path.join(dir, 'scan-args'), 'utf8'), /--limit|--verify/);
  });
});

test('openant: a failed scan (exit 2 or more) fails the job', () => {
  withDir((dir) => {
    const bin = fakeOpenant(dir, { scan: 2 });
    const result = run('openant.sh', {
      env: { SECURITY_DIR: dir, ...OPENANT_ON, PATH: `${bin}:${process.env.PATH}` },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /openant scan failed \(exit 2\)/);
  });
});

test('openant: a scan with no results file is a skip, and a broken report a failure', () => {
  withDir((dir) => {
    const empty = fakeOpenant(dir, { scan: 0, results: false });
    assert.equal(
      run('openant.sh', {
        env: { SECURITY_DIR: dir, ...OPENANT_ON, PATH: `${empty}:${process.env.PATH}` },
      }).status,
      0,
    );
    assert.match(note(sarif(dir, 'openant')), /without a results file/);
  });
  withDir((dir) => {
    const broken = fakeOpenant(dir, { report: 3 });
    const result = run('openant.sh', {
      env: { SECURITY_DIR: dir, ...OPENANT_ON, PATH: `${broken}:${process.env.PATH}` },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /report broke/);
  });
});

test('openant: under CI a missing binary is built from the pinned commit, and reused after', () => {
  withDir((dir) => {
    const openantScript = readFileSync(path.join(root, 'scripts/security/openant.sh'), 'utf8');
    const commit = /^OPENANT_COMMIT=(\w+)$/m.exec(openantScript)[1];
    // A fake git that "fetches" nothing, and a fake mise whose go build drops
    // a fake openant into bin/ - the one the scan then runs.
    // Kept off PATH: it is only what the build produces.
    const built = path.join(dir, 'built');
    mkdirSync(built);
    const openantBin = fakeOpenant(built);
    const bin = fakes(dir, {
      git: `echo "git $*" >> "${dir}/build-log"; [ "$1" != init ] || mkdir -p "$3/apps/openant-cli"`,
      mise: `echo "mise $*" >> "${dir}/build-log"; mkdir -p bin; cp "${openantBin}/openant" bin/openant`,
    });
    const home = path.join(dir, 'openant-home');
    const env = {
      SECURITY_DIR: dir,
      ...OPENANT_ON,
      CI: 'true',
      OPENANT_HOME: home,
      PATH: `${bin}:${minimalPath(dir)}`,
    };
    const first = run('openant.sh', { env });
    assert.equal(first.status, 0, first.stderr);
    const log = readFileSync(path.join(dir, 'build-log'), 'utf8');
    assert.match(
      log,
      new RegExp(`git -C \\S+ fetch -q --depth 1 https://github.com/knostic/OpenAnt ${commit}`),
    );
    assert.match(log, /mise x go@1\.26 -- go build -o bin\/openant \.\/main\.go/);
    assert.ok(statSync(path.join(home, commit, 'apps/openant-cli/bin/openant')).isFile());
    // The second run finds the build in place and does not fetch again.
    rmSync(path.join(dir, 'build-log'));
    assert.equal(run('openant.sh', { env }).status, 0);
    assert.equal(existsSync(path.join(dir, 'build-log')), false);
  });
});

// ---------- the aggregate ----------

test('local.sh with job names runs only those, and an unknown one exits 2', () => {
  withDir((dir) => {
    const bin = fakes(dir, { pnpm: FAKE_PNPM('[{}]') });
    const result = run('local.sh', {
      env: { SECURITY_DIR: dir, PATH: `${bin}:${process.env.PATH}` },
      args: ['sbom'],
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^sbom: clean$/m);
    assert.match(result.stdout, /security: pass, highest none, 0 finding\(s\)/);
    assert.equal(existsSync(path.join(dir, 'deps.sarif')), false);
    const bad = run('local.sh', { env: { SECURITY_DIR: dir }, args: ['sbom', 'lint'] });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /unknown security job: lint/);
  });
});
