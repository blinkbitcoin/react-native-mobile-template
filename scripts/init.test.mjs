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
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import test, { after, describe } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  applyTokens,
  buildPlan,
  cli,
  deriveAnswers,
  expandGlob,
  loadManifest,
  parseArgs,
  removeBlocks,
  removeBullets,
  removeLines,
  removeMakeTargets,
  removeMarkedBlock,
  removeMarkerLines,
  removeParagraphs,
  renderTemplate,
  rewriteJson,
  validateAnswers,
  validateEdit,
  validateField,
  validatePlan,
} from './init.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const RENAME_TOKENS = /rnmt|RN Mobile Template|react-native-mobile-template|rn-mobile-template/;
// `blinkbitcoin` is two different things: the GitHub owner of THIS repo, which
// init must rewrite, and the owner of the reusable-workflow repo, which it must
// not. Blanking the second is what makes the first greppable.
const WORKFLOWS_REPO = /blinkbitcoin\/shared-workflows/g;
const namesTheOwner = (text) => text.replace(WORKFLOWS_REPO, '').includes('blinkbitcoin');
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

  test('an unknown field is a programming error, not a validation message', () => {
    assert.throws(() => validateField('colour', 'blue'), /unknown field: colour/);
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
    'dev: ## Metro',
    '\tpnpm start',
    '',
    'dev-web: ## Expo web dev server',
    '\tpnpm web',
    '',
    'test-unit: ## Tests',
    '\tpnpm test',
    '',
    '.PHONY: dev dev-web test-unit',
    '',
  ].join('\n');

  test('removes the recipe, one blank line and the .PHONY word', () => {
    const after = removeMakeTargets(makefile, ['dev-web']);
    assert.doesNotMatch(after, /^dev-web:/m);
    assert.doesNotMatch(after, /pnpm web/);
    assert.match(after, /^\.PHONY: dev test-unit$/m);
    assert.match(after, /^dev: ## Metro$/m);
    assert.match(after, /^test-unit: ## Tests$/m);
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

  test('collapses the blank-line run the removal leaves behind', () => {
    const { text } = removeMarkedBlock(
      ['a', '', '// init:web-start', 'body', '// init:web-end', '', 'b'].join('\n'),
      'init:web',
    );
    assert.equal(text, 'a\n\nb');
  });

  test('removeMarkerLines keeps the block and drops only the markers', () => {
    const text = removeMarkerLines(
      ['a', '  // init:web-start', '  web: {},', '  // init:web-end', 'b'].join('\n'),
      'init:web',
    );
    assert.equal(text, 'a\n  web: {},\nb');
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

  test('removeParagraphs keeps a missing trailing newline missing', () => {
    assert.equal(removeParagraphs('keep\n\ndrop me', ['drop']), 'keep');
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

  // The bug this guard exists for: a match in ordinary prose used to make the
  // walk-back run past blank lines and headings to *some* earlier bullet, delete
  // that innocent item, and repeat until the list above it was gone.
  test('removeBullets leaves a match that is not in a list item completely alone', () => {
    const text = [
      '## A section',
      '',
      '- an unrelated bullet',
      '  with a wrapped line.',
      '- another unrelated bullet',
      '',
      'A paragraph that mentions PLAYWRIGHT_SKIP_EXPORT in passing.',
      '',
    ].join('\n');
    assert.equal(removeBullets(text, ['PLAYWRIGHT_SKIP_EXPORT']), text);
    // The paragraphs pass is what handles that shape.
    assert.doesNotMatch(removeParagraphs(text, ['PLAYWRIGHT_SKIP_EXPORT']), /in passing/);
  });

  test('removeBullets and removeBlocks handle every occurrence, not just the first', () => {
    const bullets = ['- drop A web', '- keep', '- drop B web', ''].join('\n');
    assert.equal(removeBullets(bullets, [' web$']), '- keep\n');

    const blocks = ['S one', 'E', 'keep', 'S two', 'E', ''].join('\n');
    assert.equal(removeBlocks(blocks, [{ from: '^S ', until: '^E$' }]), 'keep');
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
    assert.deepEqual(expandGlob(REPO, 'docs/no-such-file.md'), []);
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

  // The drift alarm. Every anchor, marker, scrub pattern, make target, package
  // script and dependency the manifest names is in there *because* it matches
  // the repo today; `validatePlan` is what init runs before its first write, so
  // asserting it is empty here is what stops a doc reflow from turning into a
  // silent no-op (or a half-stripped tree) later.
  test('validatePlan is clean in both modes', () => {
    assert.deepEqual(validatePlan(REPO, manifest, { web: false }), []);
    assert.deepEqual(validatePlan(REPO, manifest, { web: true }), []);
  });

  test('validatePlan reports a drifted anchor instead of shrugging', () => {
    const drifted = structuredClone(manifest);
    drifted.web.edits[0].replace = [['a string that is not in that file', 'x']];
    const problems = validatePlan(REPO, drifted, { web: false });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /anchor occurs 0x, expected 1x/);
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
        // Test fixtures, not renamed: they feed the skill's own scripts sample
        // template-default values as *input*, not as text the template ships.
        ':(exclude,glob).claude/skills/*/tests/**',
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

  // The owner is the other rename token, and the one that produces dead links
  // rather than an odd-looking string, so it gets its own sweep.
  test('it covers every file that names the GitHub owner', () => {
    const covered = new Set([
      ...manifest.rename.perFile.map((entry) => entry.path),
      ...manifest.selfDelete.paths,
    ]);
    const tracked = spawnSync(
      'git',
      [
        'grep',
        '-l',
        '-I',
        '-F',
        'blinkbitcoin',
        '--',
        '.',
        ':!docs/superpowers',
        ':!pnpm-lock.yaml',
      ],
      { cwd: REPO, encoding: 'utf8' },
    );
    const files = tracked.stdout.split('\n').filter(Boolean);
    assert.ok(files.length > 0, 'git grep found nothing — the owner token is wrong');
    const owned = files.filter((rel) => namesTheOwner(readFileSync(path.join(REPO, rel), 'utf8')));
    assert.ok(owned.length > 0, 'every hit was the workflows repo — the filter is wrong');
    const missing = owned.filter((rel) => !covered.has(rel));
    assert.deepEqual(missing, [], `owner not renamed in: ${missing.join(', ')}`);
  });
});

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

// The planning trees are checked in but are not part of the product, and they
// are full of the very tokens the scan asserts on. The two skill test dirs are
// the same story: their fixtures feed the template-default values in as test
// *input*, so they are deliberately outside the rename manifest and must
// survive `make init` unchanged.
const SKIP_PREFIXES = [
  'docs/superpowers/',
  '.superpowers/',
  '.claude/skills/store-consoles/tests/',
  '.claude/skills/store-setup/tests/',
  '.claude/skills/store-credentials/tests/',
  '.claude/skills/store-metadata/tests/',
];
// Skipped wherever they appear when walking the result.
const SKIP_ANYWHERE = new Set(['node_modules', '.git', '.expo', '.workflows']);
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

function copyRepo({ git = false } = {}) {
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
  if (git) {
    const git4 = (...args) =>
      spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env } });
    git4('init', '-q');
    git4('add', '-A');
    git4(
      '-c',
      'user.email=t@example.com',
      '-c',
      'user.name=t',
      'commit',
      '-qm',
      'base',
      '--no-verify',
    );
  }
  return root;
}

const gitStatus = (root) =>
  spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout;

/**
 * The non-blank lines `before` has that `after` does not, in order. Blank lines
 * are ignored because reflowing around a removal shifts them harmlessly.
 */
function removedLines(beforeRoot, afterRoot, rel) {
  const before = readFileSync(path.join(beforeRoot, rel), 'utf8').split('\n');
  const after = readFileSync(path.join(afterRoot, rel), 'utf8').split('\n');
  const remaining = new Map();
  for (const line of after) remaining.set(line, (remaining.get(line) ?? 0) + 1);
  const gone = [];
  for (const line of before) {
    const left = remaining.get(line) ?? 0;
    if (left > 0) remaining.set(line, left - 1);
    else if (line !== '') gone.push(line);
  }
  return gone;
}

/** Real sub-processes, but with their output captured instead of inherited. */
const quietSpawn = (command, args, options) =>
  spawnSync(command, args, { ...options, stdio: 'pipe' });

/**
 * Runs init in-process against the copy at `root` — the same engine the copy
 * carries, driven through `cli` so a thrown failure becomes exit 1 exactly as
 * it does on the command line — with INIT_SKIP_INSTALL=1 INIT_SKIP_COMMIT=1
 * unless `env` says otherwise. Resolves to `{ status, stdout, stderr }`.
 */
async function runInit(root, args, { env = {}, spawn = quietSpawn, ...io } = {}) {
  const out = [];
  const err = [];
  const status = await cli(args, {
    root,
    env: { ...process.env, INIT_SKIP_INSTALL: '1', INIT_SKIP_COMMIT: '1', ...env },
    log: (line) => out.push(`${line}\n`),
    error: (line) => err.push(`${line}\n`),
    spawn,
    ...io,
  });
  return { status, stdout: out.join(''), stderr: err.join('') };
}

/**
 * Runs init with a `pnpm` that fails, so the gates run for real and the first
 * of them blows up the way a registry hiccup would.
 */
const runInitWithFailingPnpm = (root, args) =>
  runInit(root, args, {
    // INIT_SKIP_INSTALL deliberately NOT set: the point is to reach the gates.
    env: { INIT_SKIP_INSTALL: '' },
    spawn: (command, commandArgs, options) =>
      command === 'pnpm' ? { status: 1 } : quietSpawn(command, commandArgs, options),
  });

/** Walk the tree and return [relative path, contents] for every text file. */
function textFiles(root, rel = '') {
  const out = [];
  for (const entry of readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (SKIP_ANYWHERE.has(entry.name)) continue;
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    if (SKIP_SCAN_AT_ROOT.has(next)) continue;
    if (entry.isDirectory()) {
      out.push(...textFiles(root, next));
    } else if (!BINARY.test(entry.name)) {
      out.push([next, readFileSync(path.join(root, next), 'utf8')]);
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
  test('prints the touch list, exits 0 and changes nothing', async () => {
    const root = copyRepo();
    const before = new Map(textFiles(root));
    const result = await runInit(root, ['--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /init --dry-run: \d+ operations/);
    assert.match(result.stdout, /scripts\/init\.mjs/);
    assert.match(result.stdout, /app\.config\.ts/);
    for (const [rel, text] of textFiles(root)) {
      assert.equal(text, before.get(rel), `${rel} changed during a dry run`);
    }
  });
});

describe('init --yes --no-web', async () => {
  const root = copyRepo();
  const result = await runInit(root, ['--yes', '--no-web', ...ANSWERS]);
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

  // The four store setup skills get the same rename as the rest of the
  // template: none of them may still say `com.example.rnmt`, `rn-mobile-template`,
  // `RN Mobile Template` or `react-native-mobile-template` afterwards, and the
  // reusable-workflow repo they call out to (not a rename token) must survive.
  test('renames the store setup skills, keeping blinkbitcoin/shared-workflows', () => {
    const skillFiles = files.filter(([rel]) => rel.startsWith('.claude/skills/'));
    assert.ok(skillFiles.length > 0, 'no .claude/skills files were scanned');
    const offenders = skillFiles.filter(([, text]) => RENAME_TOKENS.test(text)).map(([rel]) => rel);
    assert.deepEqual(offenders, []);
    // `blinkbitcoin` names the reusable-workflow repo, not this one, so it is
    // deliberately not a rename token — it must still appear somewhere in the
    // renamed tree (e.g. the CI workflows the skills' scripts read `gh` state
    // through), the same fact the GitHub-owner sweep above already relies on.
    const survivors = files.filter(([, text]) => text.includes('blinkbitcoin/shared-workflows'));
    assert.ok(survivors.length > 0, 'no file names blinkbitcoin/shared-workflows anymore');
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

  test('rewrites the GitHub owner, and only where it is this repo', () => {
    const offenders = files
      .filter(([rel]) => rel !== 'pnpm-lock.yaml')
      .filter(([, text]) => namesTheOwner(text))
      .map(([rel]) => rel);
    assert.deepEqual(offenders, []);
    // The three links a new contributor sees first, all live.
    // Literal substrings, not regexes: a regex shaped like a host is read by
    // CodeQL as an unanchored URL check, and these are content assertions.
    const config = readFileSync(path.join(root, '.github/ISSUE_TEMPLATE/config.yml'), 'utf8');
    assert.ok(
      config.includes('github.com/acme-inc/acme-wallet/security/policy'),
      'config.yml: security policy link',
    );
    assert.ok(
      config.includes('github.com/acme-inc/acme-wallet/blob/main/CONTRIBUTING.md'),
      'config.yml: contributing link',
    );
    const bugReport = readFileSync(
      path.join(root, '.github/ISSUE_TEMPLATE/bug_report.yml'),
      'utf8',
    );
    assert.ok(
      bugReport.includes('github.com/acme-inc/acme-wallet/blob/main/SECURITY.md'),
      'bug_report.yml: security link',
    );
    // The reusable-workflow repo keeps its owner.
    const ci = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
    assert.ok(ci.includes('blinkbitcoin/shared-workflows'), 'ci.yml: workflows repo owner');
  });

  // The commit-msg hook rejects `web` afterwards, so a doc that still lists it
  // walks the contributor into a failing commit.
  test('drops the `web` commit scope from every place it is spelled out', () => {
    for (const rel of [
      'AGENTS.md',
      'CONTRIBUTING.md',
      '.github/PULL_REQUEST_TEMPLATE.md',
      'docs/quality.md',
    ]) {
      assert.doesNotMatch(readFileSync(path.join(root, rel), 'utf8'), /docs e2e web`/, rel);
    }
    const quality = readFileSync(path.join(root, 'docs/quality.md'), 'utf8');
    assert.doesNotMatch(quality, /\| `web` \|/);
    // The neighbours in that table cell survive.
    assert.match(quality, /\| `docs` \| `e2e` \| \| \|/);
  });

  test('drops the two web residues in .github/ and the ADR index row', () => {
    assert.doesNotMatch(
      readFileSync(path.join(root, '.github/dependabot.yml'), 'utf8'),
      /react-dom/,
    );
    // The neighbouring ignore rules are untouched.
    assert.match(
      readFileSync(path.join(root, '.github/dependabot.yml'), 'utf8'),
      /- dependency-name: react\n/,
    );
    assert.doesNotMatch(
      readFileSync(path.join(root, '.github/ISSUE_TEMPLATE/bug_report.yml'), 'utf8'),
      /^\s*- Web$/m,
    );
    assert.doesNotMatch(
      readFileSync(path.join(root, 'docs/decisions/README.md'), 'utf8'),
      /0006-web-opt-in/,
    );
  });

  // One paragraph disagreeing with three others is worse than all four being
  // stale, because the reader cannot tell which one to trust. The template has
  // eleven workflow files and `--no-web` deletes `ci-web.yml`, so the generated app
  // has ten: no "eleven" may survive the rewrite, and every count that describes
  // the ten has to have moved with it. (The `nine` below is not a file count —
  // it is how many `uses:` are left in `cd-production.yml` once the web job
  // goes with its marker block.)
  test('rewrites every workflow-file count in docs/ci.md, not just the first', () => {
    const ci = readFileSync(path.join(root, 'docs/ci.md'), 'utf8');
    assert.doesNotMatch(ci, /\b[Tt]welve\b/);
    assert.match(ci, /Eleven files, in two groups: four that run on every change/);
    assert.match(ci, /the eleven files in/);
    assert.match(ci, /Two of the eleven are the exception/);
    assert.match(ci, /Ten of the eleven files carry/);
    assert.match(ci, /`cd-production\.yml` alone has eleven\./);
  });

  test('replaced the placeholders with the answers', () => {
    const config = readFileSync(path.join(root, 'app.config.ts'), 'utf8');
    assert.match(config, /name: isDev \? 'Acme Wallet \(dev\)' : 'Acme Wallet'/);
    assert.match(config, /slug: 'acme-wallet'/);
    assert.match(config, /scheme: 'acme'/);
    assert.match(config, /IOS_BUNDLE_ID \|\| 'com\.acme\.wallet'/);
    assert.match(config, /ANDROID_PACKAGE \|\| 'com\.acme\.wallet'/);

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
    for (const rel of ['app.config.ts', 'metro.config.js', '.github/workflows/cd-production.yml']) {
      assert.doesNotMatch(readFileSync(path.join(root, rel), 'utf8'), /init:web-(start|end)/, rel);
    }
    assert.doesNotMatch(readFileSync(path.join(root, 'app.config.ts'), 'utf8'), /^\s*web: \{/m);
    assert.doesNotMatch(
      readFileSync(path.join(root, '.github/workflows/cd-production.yml'), 'utf8'),
      /^ {2}web:$/m,
    );
  });

  test('drops the web make targets, the commitlint scope and the knip plugin', () => {
    const makefile = readFileSync(path.join(root, 'Makefile'), 'utf8');
    for (const target of ['dev-web', 'build-web', 'test-e2e-web']) {
      assert.doesNotMatch(makefile, new RegExp(`^${target}:`, 'm'), target);
    }
    assert.match(makefile, /^dev-ios:/m);
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

  // The gate for over-deletion. Every other assertion here looks for what should
  // be *absent*, so a scrub that ate innocent prose used to pass them all. These
  // two pin the removal down to the line.
  test('removes exactly these lines from docs/testing.md', () => {
    assert.deepEqual(removedLines(REPO, root, 'docs/testing.md'), [
      '| E2E, web | Playwright | `e2e/web/` | `make test-e2e-web` |',
      // Not web: the suite it names is one of the files init deletes.
      '| `scripts/init.test.mjs` | The template rename and web-removal script behind `make init` |',
      '## Playwright',
      '`make test-e2e-web` runs `scripts/e2e/web.sh`, which exports the site with',
      '`pnpm build:web` (a production export, the flavour that deploys) and then runs',
      'the suite in `e2e/web/`.',
      '`playwright.config.ts` starts two web servers for it: the mock API and',
      '`scripts/e2e/serve-dist.mjs`, both on ports derived from `APP_PORT_BASE`. The',
      'latter serves `dist` the way GitHub Pages does - under `EXPO_PUBLIC_BASE_URL`',
      'when a deploy export was built for a sub-path, `/settings` from',
      '`settings.html`, and `404.html` with a 404 for a path with no file, which is',
      'how a deep link into `/details/42` boots the router (`e2e/web/deep-link.spec.ts`).',
      'Setting `PLAYWRIGHT_SKIP_EXPORT` skips the export and tests whatever is',
      'already in `dist/`. CI sets it so Playwright exercises the exact artifact the',
      'deploy job would publish, instead of a second, possibly different export.',
      'That artifact is a **production** export when it is going to deploy, and a',
      "production export bakes `.env.production`'s API URL - a host no test can",
      'reach. `e2e/web/fixtures.ts` therefore routes every `**/graphql` request the',
      'page makes to the mock API and replays the response, whatever host the bundle',
      'was built for. Specs import `test` from `./fixtures`, not from',
      '`@playwright/test`. Rebuilding the export against the mock would have meant',
      'testing different bytes from the ones that deploy.',
      '| `playwright-report` | the web job | The Playwright HTML report with traces and screenshots |',
    ]);
  });

  test('removes exactly these lines from docs/README.md', () => {
    assert.deepEqual(removedLines(REPO, root, 'docs/README.md'), [
      '| Turn this template into your own app | [template-usage.md](template-usage.md) |',
      // Rewritten, not deleted: the row survives without the Playwright mention.
      '| [testing.md](testing.md) | The test layers, coverage rules, RNTL notes, adding a Maestro flow, Playwright, forensics artifacts |',
      '| [template-usage.md](template-usage.md) | What `make init` renames and removes when you adopt the template |',
      '| [web-files.txt](web-files.txt) | The list of web-only files, read by `make init` when web is declined. Data, not prose |',
    ]);
  });

  test('removes exactly these lines from AGENTS.md', () => {
    assert.deepEqual(removedLines(REPO, root, 'AGENTS.md'), [
      // Two layout lines are rewritten, not deleted: they name the init script
      // and its doc page, both of which are gone afterwards.
      'scripts/            check-*.sh, doctor, init, hooks/, release/ (verify, notes, version), e2e/, badges/',
      '.maestro/           Maestro flows (native e2e); e2e/web/ is Playwright',
      '                    release-runbook, ota, ota-and-crash-reporting, template-usage, decisions/',
      '| `make init` | Rename this template into your app, then delete itself (template only; `docs/template-usage.md`) |',
      '| `make dev-web` | Expo web dev server |',
      '| `make build-web` | Static web export into `dist/` |',
      '| `make test-e2e-web` | Web export (dev env, mock API) + Playwright smoke |',
      '  ci release deps deps-dev docs e2e web`. Squash merges take the PR title as the',
      '| Web e2e | `e2e/web/` | `make test-e2e-web` |',
    ]);
  });
});

describe('init --yes --web', async () => {
  const root = copyRepo();
  const result = await runInit(root, ['--yes', '--web', ...ANSWERS]);

  test('exits 0 and keeps the web target', () => {
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(existsSync(path.join(root, 'playwright.config.ts')));
    assert.ok(existsSync(path.join(root, 'scripts/e2e/web.sh')));
    assert.ok(existsSync(path.join(root, '.github/workflows/ci-web.yml')));
    assert.ok(existsSync(path.join(root, 'src/features/settings/NativeDemoCard.web.tsx')));
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts['build:web'], 'bash scripts/build-web.sh');
    assert.ok(pkg.dependencies['react-native-web']);
    assert.match(readFileSync(path.join(root, 'Makefile'), 'utf8'), /^test-e2e-web:/m);
    assert.match(readFileSync(path.join(root, 'app.config.ts'), 'utf8'), /^\s*web: \{/m);
  });

  test('still renames and still deletes itself', () => {
    assert.equal(existsSync(path.join(root, 'scripts/init.mjs')), false);
    assert.equal(existsSync(path.join(root, 'docs/template-usage.md')), false);
    const files = textFiles(root);
    const offenders = files.filter(([, text]) => RENAME_TOKENS.test(text)).map(([rel]) => rel);
    assert.deepEqual(offenders, []);
    const owners = files
      .filter(([rel]) => rel !== 'pnpm-lock.yaml')
      .filter(([, text]) => namesTheOwner(text))
      .map(([rel]) => rel);
    assert.deepEqual(owners, []);
  });

  test('drops the init:web markers but keeps what they wrapped', () => {
    for (const rel of ['app.config.ts', 'metro.config.js', '.github/workflows/cd-production.yml']) {
      assert.doesNotMatch(readFileSync(path.join(root, rel), 'utf8'), /init:web-(start|end)/, rel);
    }
    assert.match(readFileSync(path.join(root, 'metro.config.js'), 'utf8'), /tslib\.es6\.mjs/);
    assert.match(
      readFileSync(path.join(root, '.github/workflows/cd-production.yml'), 'utf8'),
      /^ {2}web:$/m,
    );
  });

  test('keeps the web-files.txt doc row, reworded now that make init is gone', () => {
    const index = readFileSync(path.join(root, 'docs/README.md'), 'utf8');
    assert.match(index, /\| \[web-files\.txt\]\(web-files\.txt\) \| The list of web-only files\./);
    assert.doesNotMatch(index, /make init/);
  });
});

describe('init --yes with a bad value', () => {
  test('exits 2 and changes nothing', async () => {
    const root = copyRepo();
    const result = await runInit(root, [
      '--yes',
      '--no-web',
      ...ANSWERS.slice(0, -1),
      'Bad Owner!',
    ]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^owner:/m);
    assert.ok(existsSync(path.join(root, 'scripts/init.mjs')));
  });

  test('--yes without --web or --no-web exits 2 rather than guessing', async () => {
    const root = copyRepo();
    const result = await runInit(root, ['--yes', ...ANSWERS]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /--yes needs --web or --no-web/);
    assert.ok(existsSync(path.join(root, 'scripts/init.mjs')));
  });
});

describe('init preflight', () => {
  test('a drifted anchor stops the run before the first write', async () => {
    const root = copyRepo({ git: true });
    // Reflow the sentence docs/ci.md's anchored replacement points at, the way
    // a later docs change would.
    const ci = path.join(root, 'docs/ci.md');
    writeFileSync(
      ci,
      readFileSync(ci, 'utf8').replace(
        'Two script-contract details are load-bearing:',
        'Two script-contract details matter here:',
      ),
    );
    spawnSync('git', ['add', '-A'], { cwd: root });
    spawnSync(
      'git',
      [
        '-c',
        'user.email=t@example.com',
        '-c',
        'user.name=t',
        'commit',
        '-qm',
        'reflow',
        '--no-verify',
      ],
      { cwd: root },
    );

    const result = await runInit(root, ['--yes', '--no-web', ...ANSWERS]);
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stderr, /no longer matches this repo/);
    assert.match(result.stderr, /docs\/ci\.md: anchor occurs 0x/);
    assert.match(result.stderr, /Nothing was changed/);
    // The whole point: not one byte was written before it gave up.
    assert.equal(gitStatus(root), '');
    assert.ok(existsSync(path.join(root, 'scripts/init.mjs')));
    assert.ok(existsSync(path.join(root, 'playwright.config.ts')));
  });

  test('--dry-run defaults to --no-web, the way the prompt does', async () => {
    const root = copyRepo({ git: true });
    const bare = await runInit(root, ['--dry-run']);
    const noWeb = await runInit(root, ['--dry-run', '--no-web']);
    const web = await runInit(root, ['--dry-run', '--web']);
    assert.equal(bare.status, 0, bare.stderr);
    assert.equal(bare.stdout, noWeb.stdout);
    assert.notEqual(bare.stdout, web.stdout);
    assert.match(bare.stdout, /web target: removed/);
    assert.match(web.stdout, /web target: kept/);
    assert.equal(gitStatus(root), '');
  });
});

// A failing gate must leave the adopter somewhere they can get out of.
//
// The old order deleted scripts/init.mjs and its manifest *before* running
// `pnpm install`, `pnpm codegen` and `make check-code`. A first adopter on a
// flaky network therefore ended up renamed, with nothing installed, nothing
// committed, and the one command that would redo the work gone — and
// `git checkout .` would have thrown away the rename they came for. The
// destructive step now runs last, after the gates have passed.
describe('init when a gate fails', () => {
  test('leaves the initialiser in place so the run can be repeated', async () => {
    const root = copyRepo({ git: true });
    const result = await runInitWithFailingPnpm(root, ['--yes', '--no-web', ...ANSWERS]);

    assert.notEqual(result.status, 0, 'a failing pnpm should fail the run');
    assert.ok(
      existsSync(path.join(root, 'scripts/init.mjs')),
      'scripts/init.mjs was deleted even though the run did not finish',
    );
    assert.ok(
      existsSync(path.join(root, 'scripts/init.manifest.json')),
      'the manifest was deleted even though the run did not finish',
    );
  });

  test('commits nothing, so the working tree is still recoverable', async () => {
    const root = copyRepo({ git: true });
    const before = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout;
    const result = await runInitWithFailingPnpm(root, ['--yes', '--no-web', ...ANSWERS]);
    const after = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout;

    assert.notEqual(result.status, 0);
    assert.equal(after, before, 'a failed init created a commit');
  });

  test('says what state the tree is in and what to type next', async () => {
    const root = copyRepo({ git: true });
    const result = await runInitWithFailingPnpm(root, ['--yes', '--no-web', ...ANSWERS]);

    assert.match(result.stderr, /init did not finish/);
    // The two facts an adopter needs: the rename happened, and the script that
    // redoes it is still there.
    assert.match(result.stderr, /still here/);
    assert.match(result.stderr, /node scripts\/init\.mjs/);
  });
});

// ---------------------------------------------------------------------------
// A miniature repository
// ---------------------------------------------------------------------------
//
// The copies above prove the real manifest against the real tree. The engine's
// own branches — optional entries, missing files, every kind of drift, the
// prompt, the gates and the commit — are cheaper and clearer against a tree of
// a dozen lines whose manifest exercises each of them on purpose.

const MINI_MANIFEST = {
  rename: {
    perFile: [
      { path: 'app.json', replace: [['"slug": "rnmt"', '"slug": "{{slug}}"', '+']] },
      { path: 'optional.txt', optional: true, replace: [['x', 'y']] },
    ],
    tokens: [['rnmt', '{{slug}}']],
    paths: ['README.md'],
    // `README.md` again, and a directory that is not there: the plan lists a
    // file once, and a glob into nothing is nothing.
    globs: ['docs/*.md', 'README.md', 'nowhere/*.md'],
  },
  web: {
    filesList: 'docs/web-files.txt',
    packageJson: 'package.json',
    makefile: 'Makefile',
    knipConfig: 'knip.json',
    commitlintConfig: 'commitlint.config.mjs',
    files: ['web.config.ts'],
    packageScripts: ['web'],
    packageDependencies: ['react-native-web'],
    packageDevDependencies: ['@playwright/test'],
    makeTargets: ['web'],
    commitlintScopes: ['web'],
    knipPlugins: ['playwright'],
    markedBlocks: [{ path: 'app.config.ts', marker: 'init:web' }],
    edits: [
      {
        path: 'docs/notes.md',
        replace: [['Web: yes', 'Web: no']],
        blocks: [{ from: '^test\\(', until: '^\\}\\);$' }],
        lines: ['^web line$'],
        paragraphs: ['web paragraph'],
      },
      { path: 'docs/gone.md', optional: true, lines: ['anything'] },
    ],
    docScrub: {
      globs: ['*.md'],
      lines: ['make dev-web'],
      bullets: ['WEB_BULLET'],
      paragraphs: ['WEB_PARAGRAPH'],
    },
  },
  selfDelete: {
    paths: ['scripts/init.mjs', 'scripts/init.manifest.json'],
    makeTargets: ['init'],
    markedBlocks: [
      { path: 'README.md', marker: 'init:usage' },
      { path: 'absent.md', marker: 'init:usage', optional: true },
    ],
    // Bullets only: the web scrub carries every kind, this one none but that.
    docScrub: { globs: ['*.md'], bullets: ['make init'] },
  },
};

const MINI_FILES = {
  'app.json': '{ "slug": "rnmt" }\n',
  'README.md': [
    '# rnmt',
    '',
    '<!-- init:usage-start -->',
    'Run `make init` first.',
    '<!-- init:usage-end -->',
    '',
    '| `make dev-web` | web |',
    '',
    '- `make init` renames it',
    '- WEB_BULLET item',
    '- kept item',
    '',
    'WEB_PARAGRAPH text',
    '',
  ].join('\n'),
  'docs/notes.md': [
    'Web: yes',
    '',
    "test('web', () => {",
    '});',
    '',
    'web line',
    '',
    'a web paragraph',
    '',
    'kept',
    '',
  ].join('\n'),
  'docs/web-files.txt': '# web-only files\n\nweb.config.ts\n',
  'web.config.ts': 'export default {};\n',
  'app.config.ts': [
    'export default {',
    '  // init:web-start',
    '  web: {},',
    '  // init:web-end',
    '};',
    '',
  ].join('\n'),
  'package.json': `${JSON.stringify(
    {
      name: 'rnmt',
      scripts: { web: 'expo start --web', test: 'jest' },
      dependencies: { 'react-native-web': '1.0.0' },
      devDependencies: { '@playwright/test': '1.0.0' },
    },
    null,
    2,
  )}\n`,
  'knip.json': '{ "playwright": {} }\n',
  Makefile: [
    'init: ## rename',
    '\tnode scripts/init.mjs',
    '',
    'web: ## web',
    '\tpnpm web',
    '',
    '.PHONY: init web',
    '',
  ].join('\n'),
  'commitlint.config.mjs': "export default [\n  'app',\n  'web',\n];\n",
  'scripts/init.mjs': '// stand-in\n',
};

/** A fresh miniature repository; `files` entries override (null deletes). */
function miniRepo({ manifest = MINI_MANIFEST, files = {} } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'init-mini-'));
  tempDirs.push(root);
  const all = {
    ...MINI_FILES,
    'scripts/init.manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
    ...files,
  };
  for (const [rel, text] of Object.entries(all)) {
    if (text === null) continue;
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  return root;
}

const MINI_ANSWERS = [...ANSWERS, '--yes'];

/** A spawner that records every command and answers with `status(command, args)`. */
function recordingSpawn(status = () => 0) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push([command, ...args].join(' '));
    assert.equal(options.stdio, 'inherit');
    assert.equal(options.shell, false);
    return { status: status(command, args) };
  };
  return { calls, spawn };
}

const GATES = { INIT_SKIP_INSTALL: '', INIT_SKIP_COMMIT: '' };

describe('init against a miniature repository', () => {
  test('the miniature manifest is sound in both modes', () => {
    const root = miniRepo();
    assert.deepEqual(validatePlan(root, loadManifest(root), { web: false }), []);
    assert.deepEqual(validatePlan(root, loadManifest(root), { web: true }), []);
  });

  test('the plan names each file once and skips what is optional and absent', () => {
    const root = miniRepo();
    const plan = buildPlan(root, loadManifest(root), { web: false });
    const readme = plan.filter(
      (row) => row.path === 'README.md' && row.detail === 'rename (tokens)',
    );
    assert.equal(readme.length, 1);
    for (const absent of ['optional.txt', 'docs/gone.md', 'absent.md']) {
      assert.equal(plan.filter((row) => row.path === absent).length, 0, absent);
    }
    assert.ok(plan.some((row) => row.action === 'delete' && row.path === 'web.config.ts'));
  });

  test('a full run installs, checks, strips web, deletes itself and commits', async () => {
    const root = miniRepo();
    const { calls, spawn } = recordingSpawn();
    const result = await runInit(root, ['--no-web', ...MINI_ANSWERS], { env: GATES, spawn });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(calls, [
      'pnpm install',
      'pnpm codegen',
      'pnpm i18n:check',
      'make check-code',
      'git add -A',
      'git commit -m chore(app): initialize acme-wallet from react-native-mobile-template',
    ]);
    assert.match(result.stdout, /Acme Wallet is ready/);
    const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
    assert.equal(read('app.json'), '{ "slug": "acme-wallet" }\n');
    assert.equal(existsSync(path.join(root, 'web.config.ts')), false);
    assert.equal(existsSync(path.join(root, 'scripts/init.mjs')), false);
    assert.equal(read('docs/notes.md'), 'Web: no\n\nkept\n');
    assert.equal(read('README.md'), '# acme-wallet\n\n- kept item\n');
    assert.equal(read('Makefile'), '\n.PHONY:\n');
    assert.equal(read('commitlint.config.mjs'), "export default [\n  'app',\n];\n");
    assert.deepEqual(JSON.parse(read('knip.json')), {});
    assert.deepEqual(JSON.parse(read('package.json')), {
      name: 'rnmt',
      scripts: { test: 'jest' },
      dependencies: {},
      devDependencies: {},
    });
    assert.equal(read('app.config.ts'), 'export default {\n};\n');
  });

  test('a gate that fails after the self-delete says the remaining steps are ordinary ones', async () => {
    const root = miniRepo();
    const { spawn } = recordingSpawn((command) => (command === 'git' ? null : 0));
    const result = await runInit(root, ['--web', ...MINI_ANSWERS], { env: GATES, spawn });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /init did not finish/);
    assert.match(result.stderr, /has already been removed/);
    assert.match(result.stderr, /git add -A exited null/);
    // Web kept: the block stays, its markers go.
    assert.equal(
      readFileSync(path.join(root, 'app.config.ts'), 'utf8'),
      'export default {\n  web: {},\n};\n',
    );
  });

  test('--help prints the usage and exits 0', async () => {
    let written = '';
    const stdout = new Writable({
      write(chunk, _encoding, done) {
        written += chunk;
        done();
      },
    });
    const result = await runInit(miniRepo(), ['--help'], { stdout });
    assert.equal(result.status, 0);
    assert.match(written, /^make init — rename this template into your app\./);
  });

  test('an unknown argument exits 1 with the reason', async () => {
    const result = await runInit(miniRepo(), ['--bogus']);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, 'unknown argument: --bogus\n');
  });
});

/**
 * A terminal that types the next of `replies` each time a question is asked,
 * and remembers every question it saw.
 */
function scriptedTerminal(replies) {
  const stdin = new PassThrough();
  const questions = [];
  const stdout = new Writable({
    write(chunk, _encoding, done) {
      questions.push(String(chunk));
      setImmediate(() => stdin.write(`${replies.shift()}\n`));
      done();
    },
  });
  return { stdin, stdout, questions };
}

/** Replies to the six value questions, taking every offered default. */
const TYPED = ['Acme Wallet', '', '', '', '', 'acme'];

describe('init prompts', () => {
  test('offers derived defaults, re-asks an invalid answer and keeps web on "y"', async () => {
    const root = miniRepo();
    const terminal = scriptedTerminal([
      '', // no name, no default: asked again
      'Acme Wallet',
      '', // slug: take acme-wallet
      '', // iOS: take com.example.acmewallet
      'com.acme.wallet',
      'Bad Scheme', // asked again
      '',
      'acme',
      'y',
    ]);
    const result = await runInit(root, [], { stdin: terminal.stdin, stdout: terminal.stdout });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(terminal.questions, [
      'App display name: ',
      'App display name: ',
      'Slug (package name, Expo slug) [acme-wallet]: ',
      'iOS bundle identifier [com.example.acmewallet]: ',
      'Android package [com.example.acmewallet]: ',
      'Deep-link scheme [acmewallet]: ',
      'Deep-link scheme [acmewallet]: ',
      'GitHub owner (org or user): ',
      'Keep the web target? [y/N]: ',
    ]);
    assert.match(result.stderr, /^name: expected/m);
    assert.match(result.stderr, /^scheme: expected/m);
    assert.ok(existsSync(path.join(root, 'web.config.ts')));
    assert.equal(readFileSync(path.join(root, 'app.json'), 'utf8'), '{ "slug": "acme-wallet" }\n');
  });

  for (const [reply, kept] of [
    ['yes', true],
    ['n', false],
  ]) {
    test(`"${reply}" to the web question ${kept ? 'keeps' : 'drops'} the web target`, async () => {
      const root = miniRepo();
      const terminal = scriptedTerminal([...TYPED, reply]);
      const result = await runInit(root, [], terminal);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(existsSync(path.join(root, 'web.config.ts')), kept);
    });
  }

  test('--web or --no-web on the command line skips the web question', async () => {
    const terminal = scriptedTerminal([...TYPED]);
    const root = miniRepo();
    const result = await runInit(root, ['--no-web'], terminal);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(terminal.questions.length, TYPED.length);
    assert.ok(!terminal.questions.some((question) => question.startsWith('Keep the web')));
    assert.equal(existsSync(path.join(root, 'web.config.ts')), false);
  });
});

describe('init preflight problems', () => {
  const problemsFor = (options, web = false) => {
    const root = miniRepo(options);
    return validatePlan(root, loadManifest(root), { web });
  };

  test('validateEdit names each kind of drift', () => {
    const root = miniRepo();
    assert.deepEqual(validateEdit(root, { path: 'absent.md', optional: true }), []);
    assert.deepEqual(validateEdit(root, { path: 'absent.md' }), [
      'absent.md: missing (the manifest lists it)',
    ]);
    assert.deepEqual(
      validateEdit(root, {
        path: 'docs/notes.md',
        replace: [
          ['Web: yes', 'x'],
          ['nothing like this', 'x', '+'],
          ['web', 'x', 2],
        ],
        blocks: [
          { from: '^no such start$', until: '.' },
          { from: '^kept$', until: '^no such end$' },
        ],
        lines: ['^no such line$'],
        paragraphs: ['no such paragraph'],
      }),
      [
        'docs/notes.md: anchor occurs 0x, expected +x: "nothing like this"',
        'docs/notes.md: anchor occurs 3x, expected 2x: "web"',
        'docs/notes.md: no line matches block start /^no such start$/',
        'docs/notes.md: no line matches block end /^no such end$/ after /^kept$/',
        'docs/notes.md: no line matches /^no such line$/',
        'docs/notes.md: no paragraph matches /no such paragraph/',
      ],
    );
  });

  test('every web-side drift is reported, not just the first', () => {
    const manifest = structuredClone(MINI_MANIFEST);
    manifest.web.markedBlocks.push({ path: 'absent.ts', marker: 'init:web' });
    manifest.web.docScrub = {
      globs: ['*.md'],
      lines: ['^no such row$'],
      bullets: ['NO_SUCH_BULLET'],
      paragraphs: ['NO_SUCH_PARAGRAPH'],
    };
    manifest.selfDelete.paths.push('scripts/absent.mjs');
    const problems = problemsFor({
      manifest,
      files: {
        'package.json': '{}\n',
        'knip.json': '{}\n',
        'docs/web-files.txt': null,
        'web.config.ts': null,
        'app.config.ts': '// init:web-start\n// init:web-start\n// init:web-end\n',
        Makefile: '.PHONY:\n',
        'commitlint.config.mjs': 'export default [];\n',
      },
    });
    assert.deepEqual(problems, [
      'web.config.ts: missing (the web file list names it)',
      'package.json: no script "web"',
      'package.json: no dependency "react-native-web"',
      'package.json: no devDependency "@playwright/test"',
      'knip.json: no "playwright" plugin key',
      'Makefile: no line matches /^web:/',
      "commitlint.config.mjs: no line matches /^\\s*'web',\\s*$/",
      'app.config.ts: expected one init:web-start/-end pair, found 2/1',
      'absent.ts: missing (the manifest lists it)',
      'web.docScrub: no line in any scrubbed file matches /^no such row$/',
      'web.docScrub: no line in any scrubbed file matches /NO_SUCH_BULLET/',
      'web.docScrub: no paragraph in any scrubbed file matches /NO_SUCH_PARAGRAPH/',
      'scripts/absent.mjs: missing (selfDelete.paths lists it)',
      'Makefile: no line matches /^init:/',
    ]);
  });

  test('a missing package.json or knip.json is left to the file checks', () => {
    const problems = problemsFor({ files: { 'package.json': null, 'knip.json': null } });
    assert.deepEqual(problems, []);
  });

  test('keeping web still checks the markers it will drop', () => {
    const problems = problemsFor({ files: { 'app.config.ts': 'no markers\n' } }, true);
    assert.deepEqual(problems, ['app.config.ts: expected one init:web-start/-end pair, found 0/0']);
  });

  test('a missing rename path is drift', () => {
    const problems = problemsFor({ files: { 'README.md': null } }, true);
    assert.ok(problems.includes('README.md: missing (rename.paths lists it)'), problems.join('\n'));
  });
});

describe('init as a command', () => {
  // The in-process runs above cover the engine; this covers the entry line
  // itself. The environment is inherited so a coverage run sees the child.
  const command = (args, input) =>
    spawnSync(process.execPath, [path.join(REPO, 'scripts/init.mjs'), ...args], {
      encoding: 'utf8',
      input,
      env: { ...process.env },
    });

  test('--help prints the usage and exits 0', () => {
    const result = command(['--help'], '');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^make init — rename this template/);
  });

  test('an unknown argument exits 1 with the reason on stderr', () => {
    const result = command(['--bogus'], '');
    assert.equal(result.status, 1);
    assert.equal(result.stderr, 'unknown argument: --bogus\n');
  });
});
