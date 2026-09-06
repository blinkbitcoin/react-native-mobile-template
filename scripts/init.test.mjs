// Tests for `make init` (scripts/init.mjs).
//
// The pure rewrites are unit-tested directly; the end-to-end behaviour is
// tested by copying the whole repo into a temp dir (node_modules symlinked)
// and running the real script there with INIT_SKIP_INSTALL=1 INIT_SKIP_COMMIT=1.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  applyTokens,
  deriveAnswers,
  expandGlob,
  loadManifest,
  parseArgs,
  removeBlocks,
  removeBullets,
  removeLines,
  removeMakeTargets,
  removeMarkedBlock,
  removeParagraphs,
  renderTemplate,
  rewriteJson,
  validateAnswers,
  validateField,
} from './init.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const RENAME_TOKENS = /rnmt|RN Mobile Template|react-native-mobile-template|rn-mobile-template/;
// `react-native-webview` and `--dev-client` are native, not web: the negative
// lookaheads keep the sweep from flagging them.
const WEB_TOKENS = /react-native-web(?![\w-])|[Pp]laywright|build:web|--dev(?!-client)/;

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

describe('validation', () => {
  test('accepts the shapes the template documents', () => {
    assert.deepEqual(
      validateAnswers({
        name: 'Acme Wallet',
        slug: 'acme-wallet',
        iosBundleId: 'com.acme.wallet',
        androidPackage: 'com.acme.wallet',
        scheme: 'acme',
        owner: 'acme-inc',
      }),
      [],
    );
  });

  test('rejects a slug that is not lowercase-dashed', () => {
    assert.match(validateField('slug', 'Acme Wallet'), /^slug:/);
    assert.match(validateField('slug', '1acme'), /^slug:/);
    assert.equal(validateField('slug', 'acme-wallet-2'), null);
  });

  test('rejects a bundle id or package that is not reverse-DNS', () => {
    assert.match(validateField('iosBundleId', 'acme'), /^iosBundleId:/);
    assert.equal(validateField('iosBundleId', 'com.Acme.Wallet'), null);
    // The Android package must be lowercase; the iOS bundle id need not be.
    assert.match(validateField('androidPackage', 'com.Acme.Wallet'), /^androidPackage:/);
    assert.equal(validateField('androidPackage', 'com.acme.wallet'), null);
  });

  test('rejects a scheme with a dash or an uppercase letter', () => {
    assert.match(validateField('scheme', 'acme-wallet'), /^scheme:/);
    assert.match(validateField('scheme', 'Acme'), /^scheme:/);
    assert.equal(validateField('scheme', 'acme2'), null);
  });
});

describe('parseArgs', () => {
  test('reads the long flags and both web forms', () => {
    const options = parseArgs(['--yes', '--name', 'Acme', '--slug=acme', '--no-web']);
    assert.equal(options.yes, true);
    assert.equal(options.web, false);
    assert.equal(options.answers.name, 'Acme');
    assert.equal(options.answers.slug, 'acme');
    assert.equal(parseArgs(['--web']).web, true);
    assert.equal(parseArgs([]).web, null);
    assert.equal(parseArgs(['--dry-run']).dryRun, true);
  });

  test('rejects an unknown flag and a flag with no value', () => {
    assert.throws(() => parseArgs(['--nope']), /unknown argument/);
    assert.throws(() => parseArgs(['--slug', '--yes']), /needs a value/);
  });
});

describe('rewriteJson', () => {
  test('preserves key order, 2-space indent and the trailing newline', () => {
    const before = '{\n  "z": 1,\n  "a": { "b": 2 }\n}\n';
    const after = rewriteJson(before, (data) => {
      delete data.a.b;
    });
    assert.equal(after, '{\n  "z": 1,\n  "a": {}\n}\n');
  });

  test('drops only the requested dependency keys', () => {
    const after = rewriteJson('{"dependencies":{"a":"1","react-dom":"2","b":"3"}}\n', (pkg) => {
      delete pkg.dependencies['react-dom'];
    });
    assert.deepEqual(Object.keys(JSON.parse(after).dependencies), ['a', 'b']);
  });
});

describe('removeMakeTargets', () => {
  const makefile = [
    'start: ## Metro',
    '\tpnpm start',
    '',
    'web: ## Expo web dev server',
    '\tpnpm web',
    '',
    'unit: ## Tests',
    '\tpnpm test',
    '',
    '.PHONY: start web unit',
    '',
  ].join('\n');

  test('removes the recipe, one blank line and the .PHONY word', () => {
    const after = removeMakeTargets(makefile, ['web']);
    assert.doesNotMatch(after, /^web:/m);
    assert.doesNotMatch(after, /pnpm web/);
    assert.match(after, /^\.PHONY: start unit$/m);
    assert.match(after, /^start: ## Metro$/m);
    assert.match(after, /^unit: ## Tests$/m);
    // No double blank line left behind.
    assert.doesNotMatch(after, /\n\n\n/);
  });

  test('is a no-op for a target that is not there', () => {
    assert.equal(removeMakeTargets(makefile, ['nope']), makefile);
  });
});

describe('removeMarkedBlock', () => {
  test('removes the markers and everything between them', () => {
    const { text, found } = removeMarkedBlock(
      ['a', '  // init:web-start', '  web: {},', '  // init:web-end', 'b'].join('\n'),
      'init:web',
    );
    assert.equal(found, true);
    assert.equal(text, 'a\nb');
  });

  test('works with # and <!-- --> comment syntax', () => {
    assert.equal(
      removeMarkedBlock(
        ['x', '# init:web-start', 'web:', '# init:web-end', 'y'].join('\n'),
        'init:web',
      ).text,
      'x\ny',
    );
    assert.equal(
      removeMarkedBlock(
        ['x', '<!-- init:usage-start -->', 'row', '<!-- init:usage-end -->', 'y'].join('\n'),
        'init:usage',
      ).text,
      'x\ny',
    );
  });

  test('reports a missing marker instead of silently keeping the block', () => {
    const { text, found } = removeMarkedBlock('a\nb\n', 'init:web');
    assert.equal(found, false);
    assert.equal(text, 'a\nb\n');
  });
});

describe('removeLines / removeParagraphs', () => {
  test('removeLines drops matching rows only', () => {
    const after = removeLines('| a | b |\n| playwright | x |\n| c | d |\n', ['[Pp]laywright']);
    assert.equal(after, '| a | b |\n| c | d |\n');
  });

  test('removeParagraphs drops the whole blank-line-delimited block', () => {
    const text = 'one\n\ntwo\nPLAYWRIGHT_SKIP_EXPORT here\n\nthree\n';
    assert.equal(removeParagraphs(text, ['PLAYWRIGHT_SKIP_EXPORT']), 'one\n\nthree\n');
  });

  test('removeParagraphs with no patterns is a no-op', () => {
    assert.equal(removeParagraphs('a\n\nb\n', []), 'a\n\nb\n');
  });

  test('removeBlocks takes a whole call, blank lines and all', () => {
    const text = [
      "test('keep me', () => {",
      '  ok();',
      '});',
      '',
      "test('the web variant', async () => {",
      '  render();',
      '',
      '  expect(x);',
      '});',
      '',
      "test('keep me too', () => {});",
      '',
    ].join('\n');
    const after = removeBlocks(text, [{ from: "^test\\('the web variant", until: '^\\}\\);$' }]);
    assert.doesNotMatch(after, /web variant/);
    assert.doesNotMatch(after, /expect\(x\)/);
    assert.match(after, /keep me/);
    assert.match(after, /keep me too/);
    assert.doesNotMatch(after, /\n\n\n/);
  });

  test('removeBullets takes one list item and its wrapped lines, not its neighbours', () => {
    const text = [
      '- keep this bullet',
      '  wrapped line of the keeper.',
      '- drop me because I mention PLAYWRIGHT_SKIP_EXPORT',
      '  and I wrap onto a second line.',
      '',
      'A following paragraph.',
      '',
    ].join('\n');
    const after = removeBullets(text, ['PLAYWRIGHT_SKIP_EXPORT']);
    assert.match(after, /keep this bullet/);
    assert.match(after, /wrapped line of the keeper/);
    assert.match(after, /A following paragraph/);
    assert.doesNotMatch(after, /drop me/);
    assert.doesNotMatch(after, /second line/);
  });

  test('removeBlocks refuses a span with no terminator', () => {
    assert.throws(
      () => removeBlocks('test(\n', [{ from: '^test\\(', until: '^\\}\\);$' }]),
      /no line matching/,
    );
  });
});

describe('token rendering', () => {
  test('renderTemplate fills placeholders and rejects unknown ones', () => {
    assert.equal(renderTemplate('{{slug}}-x', { slug: 'acme' }), 'acme-x');
    assert.throws(() => renderTemplate('{{nope}}', {}), /unknown placeholder/);
  });

  test('applyTokens replaces in order, longest first', () => {
    const tokens = [
      ['exp+react-native-mobile-template', 'exp+{{slug}}'],
      ['react-native-mobile-template', '{{slug}}'],
      ['rnmt', '{{scheme}}'],
    ];
    const out = applyTokens(
      'exp+react-native-mobile-template rnmt://x react-native-mobile-template',
      tokens,
      {
        slug: 'acme-wallet',
        scheme: 'acme',
      },
    );
    assert.equal(out, 'exp+acme-wallet acme://x acme-wallet');
  });

  test('deriveAnswers escapes the dots for the regex literals in the fixtures', () => {
    assert.equal(
      deriveAnswers({ iosBundleId: 'com.acme.x', androidPackage: 'com.acme.y' }).iosBundleIdRe,
      'com\\.acme\\.x',
    );
  });
});

describe('expandGlob', () => {
  test('matches files in a directory and returns [] for a missing one', () => {
    assert.ok(expandGlob(REPO, 'docs/*.md').includes('docs/template-usage.md'));
    assert.deepEqual(expandGlob(REPO, 'nope/*.md'), []);
    assert.deepEqual(expandGlob(REPO, 'Makefile'), ['Makefile']);
  });
});

describe('the manifest', () => {
  const manifest = loadManifest(REPO);

  test('every non-optional path it names exists', () => {
    for (const rel of manifest.rename.paths) {
      assert.ok(existsSync(path.join(REPO, rel)), `rename.paths: missing ${rel}`);
    }
    for (const entry of manifest.rename.perFile) {
      if (entry.optional) continue;
      assert.ok(existsSync(path.join(REPO, entry.path)), `rename.perFile: missing ${entry.path}`);
    }
    for (const entry of manifest.web.edits) {
      if (entry.optional) continue;
      assert.ok(existsSync(path.join(REPO, entry.path)), `web.edits: missing ${entry.path}`);
    }
    for (const block of manifest.web.markedBlocks) {
      const text = readFileSync(path.join(REPO, block.path), 'utf8');
      assert.match(
        text,
        new RegExp(`${block.marker}-start`),
        `${block.path} has no ${block.marker}-start`,
      );
      assert.match(
        text,
        new RegExp(`${block.marker}-end`),
        `${block.path} has no ${block.marker}-end`,
      );
    }
  });

  test('every anchored perFile replacement still matches the file it names', () => {
    for (const entry of manifest.rename.perFile) {
      if (entry.optional && !existsSync(path.join(REPO, entry.path))) continue;
      const text = readFileSync(path.join(REPO, entry.path), 'utf8');
      for (const [from] of entry.replace) {
        assert.ok(
          text.includes(from),
          `${entry.path}: anchored replacement no longer matches: ${from}`,
        );
      }
    }
  });

  test('it covers every file in the repo that still carries a rename token', () => {
    const covered = new Set([
      ...manifest.rename.paths,
      ...manifest.rename.perFile.map((entry) => entry.path),
      ...manifest.rename.globs.flatMap((pattern) => expandGlob(REPO, pattern)),
      // The init machinery itself is full of the tokens it looks for, and it
      // deletes itself rather than being renamed.
      ...manifest.selfDelete.paths,
    ]);
    const tracked = spawnSync(
      'git',
      [
        'grep',
        '-l',
        '-I',
        '-E',
        RENAME_TOKENS.source,
        '--',
        '.',
        ':!docs/superpowers',
        ':!pnpm-lock.yaml',
      ],
      {
        cwd: REPO,
        encoding: 'utf8',
      },
    );
    const files = tracked.stdout.split('\n').filter(Boolean);
    assert.ok(files.length > 0, 'git grep found nothing — the token list is wrong');
    const missing = files.filter((rel) => !covered.has(rel));
    assert.deepEqual(missing, [], `manifest does not cover: ${missing.join(', ')}`);
  });
});

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

// The planning trees are checked in but are not part of the product, and they
// are full of the very tokens the scan asserts on.
const SKIP_PREFIXES = ['docs/superpowers/', '.superpowers/'];
// Skipped wherever they appear when walking the result.
const SKIP_ANYWHERE = new Set(['node_modules', '.git', '.expo', '.rnw']);
// Skipped only at the repo root: `ios`/`android` there would be prebuild output,
// but `modules/hello-native/ios` is source the manifest renames.
const SKIP_SCAN_AT_ROOT = new Set([
  'dist',
  'coverage',
  'test-results',
  'ios',
  'android',
  'vendor',
  'playwright-report',
  'docs/superpowers',
  '.superpowers',
  'assets',
  'Gemfile.lock',
]);
const BINARY = /\.(png|jpg|jpeg|gif|ttf|otf|ico|webp|pem|keystore|jks|zip)$/i;

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function copyRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'rnmt-init-'));
  tempDirs.push(dir);
  const root = path.join(dir, 'app');
  // Tracked + untracked-but-not-ignored: exactly what a fresh clone (plus this
  // task's not-yet-committed files) has. Copying the working tree wholesale
  // would drag in gitignored build output, which no init run should see.
  const listed = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(listed.status, 0, listed.stderr);
  for (const rel of listed.stdout.split('\0').filter(Boolean)) {
    if (SKIP_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue;
    const target = path.join(root, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(REPO, rel), target);
  }
  // Symlinked, not copied: init only reads package.json here (INIT_SKIP_INSTALL).
  symlinkSync(path.join(REPO, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  return root;
}

function runInit(root, args) {
  return spawnSync(process.execPath, [path.join(root, 'scripts/init.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, INIT_SKIP_INSTALL: '1', INIT_SKIP_COMMIT: '1' },
  });
}

/** Walk the tree and return [relative path, contents] for every text file. */
function textFiles(root, rel = '') {
  const out = [];
  for (const entry of readdirSync(path.join(root, rel))) {
    if (SKIP_ANYWHERE.has(entry)) continue;
    const next = rel ? `${rel}/${entry}` : entry;
    if (SKIP_SCAN_AT_ROOT.has(next)) continue;
    const full = path.join(root, next);
    if (statSync(full).isDirectory()) {
      out.push(...textFiles(root, next));
    } else if (!BINARY.test(entry)) {
      out.push([next, readFileSync(full, 'utf8')]);
    }
  }
  return out;
}

const ANSWERS = [
  '--name',
  'Acme Wallet',
  '--slug',
  'acme-wallet',
  '--ios-bundle-id',
  'com.acme.wallet',
  '--android-package',
  'com.acme.wallet',
  '--scheme',
  'acme',
  '--owners',
  'acme-inc',
];

describe('init --dry-run', () => {
  test('prints the touch list, exits 0 and changes nothing', () => {
    const root = copyRepo();
    const before = new Map(textFiles(root));
    const result = runInit(root, ['--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /init --dry-run: \d+ operations/);
    assert.match(result.stdout, /scripts\/init\.mjs/);
    assert.match(result.stdout, /app\.config\.ts/);
    for (const [rel, text] of textFiles(root)) {
      assert.equal(text, before.get(rel), `${rel} changed during a dry run`);
    }
  });
});

describe('init --yes --no-web', () => {
  const root = copyRepo();
  const result = runInit(root, ['--yes', '--no-web', ...ANSWERS]);
  const files = result.status === 0 ? textFiles(root) : [];

  test('exits 0', () => {
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });

  test('deletes itself', () => {
    const manifest = loadManifest(REPO);
    for (const rel of manifest.selfDelete.paths) {
      assert.equal(existsSync(path.join(root, rel)), false, `${rel} survived`);
    }
    assert.doesNotMatch(readFileSync(path.join(root, 'Makefile'), 'utf8'), /^init:/m);
    assert.doesNotMatch(readFileSync(path.join(root, 'Makefile'), 'utf8'), /\.PHONY:.* init /);
  });

  test('deletes every web path the manifest names', () => {
    const manifest = loadManifest(REPO);
    const listed = readFileSync(path.join(REPO, manifest.web.filesList), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
    for (const rel of [...listed, ...manifest.web.files]) {
      assert.equal(existsSync(path.join(root, rel)), false, `${rel} survived`);
    }
  });

  test('leaves no rename token anywhere', () => {
    const offenders = files.filter(([, text]) => RENAME_TOKENS.test(text)).map(([rel]) => rel);
    assert.deepEqual(offenders, []);
  });

  test('leaves no web reference anywhere', () => {
    // pnpm-lock.yaml is excluded: INIT_SKIP_INSTALL=1 skips the `pnpm install`
    // that rewrites it, so the removed dependencies are still resolved there.
    const offenders = files
      .filter(([rel]) => rel !== 'pnpm-lock.yaml')
      .filter(([, text]) => WEB_TOKENS.test(text))
      .map(([rel]) => rel);
    assert.deepEqual(offenders, []);
  });

  test('replaced the placeholders with the answers', () => {
    const config = readFileSync(path.join(root, 'app.config.ts'), 'utf8');
    assert.match(config, /name: isDev \? 'Acme Wallet \(dev\)' : 'Acme Wallet'/);
    assert.match(config, /slug: 'acme-wallet'/);
    assert.match(config, /scheme: 'acme'/);
    assert.match(config, /IOS_BUNDLE_ID \?\? 'com\.acme\.wallet'/);
    assert.match(config, /ANDROID_PACKAGE \?\? 'com\.acme\.wallet'/);

    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.name, 'acme-wallet');
    assert.equal(pkg.scripts.web, undefined);
    assert.equal(pkg.scripts['build:web'], undefined);
    assert.equal(pkg.scripts['test:e2e:web'], undefined);
    assert.equal(pkg.dependencies['react-native-web'], undefined);
    assert.equal(pkg.dependencies['react-dom'], undefined);
    assert.equal(pkg.dependencies['@expo/metro-runtime'], undefined);
    assert.equal(pkg.devDependencies['@playwright/test'], undefined);
    // Untouched neighbours survive.
    assert.ok(pkg.dependencies.expo);
    assert.ok(pkg.scripts.ios);

    assert.match(
      readFileSync(path.join(root, '.maestro/flows/deep-link.yaml'), 'utf8'),
      /acme:\/\/details\/99/,
    );
    assert.equal(
      JSON.parse(readFileSync(path.join(root, 'release-please-config.json'), 'utf8')).packages['.'][
        'package-name'
      ],
      'acme-wallet',
    );
  });

  test('removes the marker blocks and the markers themselves', () => {
    for (const rel of [
      'app.config.ts',
      'metro.config.js',
      '.github/workflows/release-production.yml',
    ]) {
      assert.doesNotMatch(readFileSync(path.join(root, rel), 'utf8'), /init:web-(start|end)/, rel);
    }
    assert.doesNotMatch(readFileSync(path.join(root, 'app.config.ts'), 'utf8'), /^\s*web: \{/m);
    assert.doesNotMatch(
      readFileSync(path.join(root, '.github/workflows/release-production.yml'), 'utf8'),
      /^ {2}web:$/m,
    );
  });

  test('drops the web make targets, the commitlint scope and the knip plugin', () => {
    const makefile = readFileSync(path.join(root, 'Makefile'), 'utf8');
    for (const target of ['web', 'build-web', 'e2e-web']) {
      assert.doesNotMatch(makefile, new RegExp(`^${target}:`, 'm'), target);
    }
    assert.match(makefile, /^ios:/m);
    assert.doesNotMatch(readFileSync(path.join(root, 'commitlint.config.mjs'), 'utf8'), /'web',/);
    assert.equal(
      JSON.parse(readFileSync(path.join(root, 'knip.json'), 'utf8')).playwright,
      undefined,
    );
  });

  test('keeps the lockfile provenance exclusions untouched', () => {
    // `minimumReleaseAgeExclude` is a security control, not template noise.
    const before = readFileSync(path.join(REPO, 'pnpm-workspace.yaml'), 'utf8');
    assert.equal(readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8'), before);
  });
});

describe('init --yes --web', () => {
  const root = copyRepo();
  const result = runInit(root, ['--yes', '--web', ...ANSWERS]);

  test('exits 0 and keeps the web target', () => {
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(existsSync(path.join(root, 'playwright.config.ts')));
    assert.ok(existsSync(path.join(root, 'scripts/e2e/web.sh')));
    assert.ok(existsSync(path.join(root, '.github/workflows/web.yml')));
    assert.ok(existsSync(path.join(root, 'src/features/settings/NativeDemoCard.web.tsx')));
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts['build:web'], 'expo export --platform web');
    assert.ok(pkg.dependencies['react-native-web']);
    assert.match(readFileSync(path.join(root, 'Makefile'), 'utf8'), /^e2e-web:/m);
    assert.match(readFileSync(path.join(root, 'app.config.ts'), 'utf8'), /^\s*web: \{/m);
  });

  test('still renames and still deletes itself', () => {
    assert.equal(existsSync(path.join(root, 'scripts/init.mjs')), false);
    assert.equal(existsSync(path.join(root, 'docs/template-usage.md')), false);
    const offenders = textFiles(root)
      .filter(([, text]) => RENAME_TOKENS.test(text))
      .map(([rel]) => rel);
    assert.deepEqual(offenders, []);
  });
});

describe('init --yes with a bad value', () => {
  test('exits 2 and changes nothing', () => {
    const root = copyRepo();
    const result = runInit(root, ['--yes', '--no-web', ...ANSWERS.slice(0, -1), 'Bad Owner!']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^owner:/m);
    assert.ok(existsSync(path.join(root, 'scripts/init.mjs')));
  });
});
