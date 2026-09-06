#!/usr/bin/env node
// `make init` — turn this template into your app, then delete itself.
//
// Everything it touches is declared in scripts/init.manifest.json; this file is
// only the engine (prompting, validation, the per-file-type rewrites and the
// finishing gates). Zero npm dependencies: it runs before `pnpm install` has
// necessarily been re-run.
//
//   node scripts/init.mjs                      interactive
//   node scripts/init.mjs --dry-run            print the touch list, change nothing
//   node scripts/init.mjs --yes --name "Acme" --slug acme --scheme acme \
//     --ios-bundle-id com.acme.app --android-package com.acme.app \
//     --owners acme --no-web
//
// Env escape hatches (used by scripts/init.test.mjs):
//   INIT_SKIP_INSTALL=1   skip `pnpm install`, codegen, i18n and `make check-code`
//   INIT_SKIP_COMMIT=1    skip `git add -A && git commit`

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export const RULES = {
  name: {
    re: /^[^\n]{2,60}$/,
    hint: 'the display name, 2-60 characters on one line (e.g. "Acme Wallet")',
  },
  slug: {
    re: /^[a-z][a-z0-9-]{1,49}$/,
    hint: 'lowercase letters, digits and dashes, 2-50 chars, starts with a letter (e.g. "acme-wallet")',
  },
  iosBundleId: {
    re: /^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z][A-Za-z0-9-]*)+$/,
    hint: 'reverse-DNS, at least two segments (e.g. "com.acme.wallet")',
  },
  androidPackage: {
    re: /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/,
    hint: 'lowercase reverse-DNS, at least two segments (e.g. "com.acme.wallet")',
  },
  scheme: {
    re: /^[a-z][a-z0-9]{1,20}$/,
    hint: 'lowercase letters and digits, 2-21 chars, starts with a letter (e.g. "acme")',
  },
  owner: {
    re: /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/,
    hint: 'the GitHub org or user that will own the repo (e.g. "acme")',
  },
};

/** @returns {string|null} an error message, or null when the value is valid. */
export function validateField(field, value) {
  const rule = RULES[field];
  if (!rule) throw new Error(`unknown field: ${field}`);
  if (typeof value !== 'string' || !rule.re.test(value)) {
    return `${field}: expected ${rule.hint}`;
  }
  return null;
}

export function validateAnswers(answers) {
  return Object.keys(RULES)
    .map((field) => validateField(field, answers[field]))
    .filter((message) => message !== null);
}

// ---------------------------------------------------------------------------
// Pure rewrites
// ---------------------------------------------------------------------------

const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Fill `{{placeholder}}` holes from the answers object. */
export function renderTemplate(template, answers) {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key) => {
    if (!(key in answers)) throw new Error(`unknown placeholder in manifest: ${whole}`);
    return String(answers[key]);
  });
}

/** Apply ordered [from, to] literal replacements. `to` may contain placeholders. */
export function applyTokens(text, replacements, answers) {
  let out = text;
  for (const [from, to] of replacements) {
    out = out.split(from).join(renderTemplate(to, answers));
  }
  return out;
}

/**
 * Rewrite a JSON file through parse/stringify. Key order survives (V8 keeps
 * string-key insertion order) and the result is 2-space indented with the
 * trailing newline every other JSON file in the repo has.
 */
export function rewriteJson(text, mutate) {
  const data = JSON.parse(text);
  mutate(data);
  return `${JSON.stringify(data, null, 2)}\n`;
}

/** Drop whole lines matching any of the regex sources. */
export function removeLines(text, patterns) {
  const res = patterns.map((p) => new RegExp(p));
  const kept = text.split('\n').filter((line) => !res.some((re) => re.test(line)));
  return kept.join('\n');
}

/**
 * Drop blank-line-delimited paragraphs containing a match. Used for the doc
 * bullets and the one Jest case that only exists for the web variant.
 */
export function removeParagraphs(text, patterns) {
  if (patterns.length === 0) return text;
  const res = patterns.map((p) => new RegExp(p));
  const trailing = text.endsWith('\n') ? '\n' : '';
  const kept = text
    .replace(/\n+$/, '')
    .split(/\n{2,}/)
    .filter((block) => !res.some((re) => re.test(block)));
  return kept.join('\n\n') + trailing;
}

/**
 * Remove the Markdown list item containing a match, wrapping lines included.
 * A list is a single blank-line-delimited paragraph, so `removeParagraphs`
 * would take its neighbours with it.
 */
export function removeBullets(text, patterns) {
  const lines = text.split('\n');
  const isBullet = (line) => line !== undefined && /^\s*[-*] /.test(line);
  for (const pattern of patterns) {
    const re = new RegExp(pattern);
    for (let hit = lines.findIndex((line) => re.test(line)); hit !== -1; ) {
      let start = hit;
      while (start > 0 && !isBullet(lines[start])) start -= 1;
      if (!isBullet(lines[start])) break;
      let end = start + 1;
      while (end < lines.length && lines[end] !== '' && !isBullet(lines[end])) end += 1;
      lines.splice(start, end - start);
      hit = lines.findIndex((line) => re.test(line));
    }
  }
  return lines.join('\n');
}

/**
 * Remove each `{ from, until }` span: the first line matching `from` through the
 * next line matching `until`, inclusive, plus the blank line that follows. This
 * is for code that cannot carry markers (a `test(...)` call in a suite this task
 * does not own) and that blank lines run straight through.
 */
export function removeBlocks(text, blocks) {
  const lines = text.split('\n');
  for (const { from, until } of blocks) {
    const fromRe = new RegExp(from);
    const untilRe = new RegExp(until);
    const start = lines.findIndex((line) => fromRe.test(line));
    if (start === -1) continue;
    let end = start;
    while (end < lines.length && !untilRe.test(lines[end])) end += 1;
    if (end === lines.length) throw new Error(`no line matching ${until} after ${from}`);
    if (lines[end + 1] === '') end += 1;
    lines.splice(start, end - start + 1);
    if (lines[start - 1] === '' && lines[start] === undefined) lines.pop();
  }
  return lines.join('\n');
}

/**
 * Remove `<comment> marker-start` .. `<comment> marker-end` inclusive. The
 * comment syntax does not matter: the marker text is matched anywhere on the
 * line, so `//`, `#` and `<!-- -->` markers all work.
 */
export function removeMarkedBlock(text, marker) {
  const lines = text.split('\n');
  const out = [];
  let depth = 0;
  let found = false;
  for (const line of lines) {
    if (line.includes(`${marker}-start`)) {
      depth += 1;
      found = true;
      continue;
    }
    if (line.includes(`${marker}-end`)) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) out.push(line);
  }
  return { text: out.join('\n'), found };
}

/**
 * Remove `target: ## description` recipes from a Makefile, together with their
 * recipe lines, the blank line they leave behind and their `.PHONY` word.
 */
export function removeMakeTargets(text, targets) {
  let lines = text.split('\n');
  for (const target of targets) {
    const start = lines.findIndex((line) => new RegExp(`^${escapeRe(target)}:`).test(line));
    if (start === -1) continue;
    let end = start + 1;
    while (end < lines.length && (lines[end].startsWith('\t') || lines[end].startsWith('    '))) {
      end += 1;
    }
    // Swallow one of the two blank lines that would otherwise collide.
    if (lines[end] === '' && lines[start - 1] === '') end += 1;
    lines.splice(start, end - start);
  }
  lines = lines.map((line) =>
    line.startsWith('.PHONY:')
      ? line
          .split(' ')
          .filter((word, index) => index === 0 || !targets.includes(word))
          .join(' ')
      : line,
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const FLAG_TO_FIELD = {
  '--name': 'name',
  '--slug': 'slug',
  '--ios-bundle-id': 'iosBundleId',
  '--android-package': 'androidPackage',
  '--scheme': 'scheme',
  '--owners': 'owner',
};

export function parseArgs(argv) {
  const options = { dryRun: false, yes: false, help: false, web: null, answers: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--yes' || arg === '-y') options.yes = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--web') options.web = true;
    else if (arg === '--no-web') options.web = false;
    else if (arg in FLAG_TO_FIELD) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${arg} needs a value`);
      }
      options.answers[FLAG_TO_FIELD[arg]] = value;
      i += 1;
    } else if (arg.startsWith('--') && arg.includes('=')) {
      const [flag, ...rest] = arg.split('=');
      if (!(flag in FLAG_TO_FIELD)) throw new Error(`unknown flag: ${flag}`);
      options.answers[FLAG_TO_FIELD[flag]] = rest.join('=');
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

/** Derive the values the manifest can interpolate but nobody types. */
export function deriveAnswers(answers) {
  return {
    ...answers,
    iosBundleIdRe: escapeRe(answers.iosBundleId),
    androidPackageRe: escapeRe(answers.androidPackage),
  };
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

const abs = (root, rel) => path.join(root, rel);
const read = (root, rel) => readFileSync(abs(root, rel), 'utf8');
const write = (root, rel, text) => writeFileSync(abs(root, rel), text);
const exists = (root, rel) => existsSync(abs(root, rel));

/** Minimal glob: `*` is allowed in the last segment only, which is all the manifest needs. */
export function expandGlob(root, pattern) {
  const parts = pattern.split('/');
  const last = parts.pop();
  const dirRel = parts.join('/');
  const dirAbs = dirRel ? path.join(root, dirRel) : root;
  if (!existsSync(dirAbs) || !statSync(dirAbs).isDirectory()) return [];
  if (!last.includes('*')) {
    const rel = dirRel ? `${dirRel}/${last}` : last;
    return existsSync(path.join(root, rel)) ? [rel] : [];
  }
  const re = new RegExp(`^${last.split('*').map(escapeRe).join('.*')}$`);
  return readdirSync(dirAbs)
    .filter((entry) => re.test(entry) && statSync(path.join(dirAbs, entry)).isFile())
    .map((entry) => (dirRel ? `${dirRel}/${entry}` : entry))
    .sort();
}

function expandGlobs(root, patterns) {
  return [...new Set(patterns.flatMap((pattern) => expandGlob(root, pattern)))];
}

function run(command, args, { cwd, allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${command} ${args.join(' ')} exited ${result.status ?? 'null'}`);
  }
  return result.status ?? 1;
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export function loadManifest(root = REPO_ROOT) {
  return JSON.parse(readFileSync(path.join(root, 'scripts/init.manifest.json'), 'utf8'));
}

/**
 * Everything the run would touch, as `{ action, path, detail }` rows. `--dry-run`
 * prints this and stops; the real run walks the same list.
 */
export function buildPlan(root, manifest, { web }) {
  const plan = [];
  const seenRewrite = new Set();
  const addRewrite = (rel, detail) => {
    const key = `${rel} ${detail}`;
    if (seenRewrite.has(key)) return;
    seenRewrite.add(key);
    plan.push({ action: 'rewrite', path: rel, detail });
  };

  for (const entry of manifest.rename.perFile) {
    if (!exists(root, entry.path)) {
      if (entry.optional) continue;
      throw new Error(`manifest lists a missing file: ${entry.path}`);
    }
    addRewrite(entry.path, 'rename (anchored)');
  }
  for (const rel of manifest.rename.paths) {
    if (!exists(root, rel)) throw new Error(`manifest lists a missing file: ${rel}`);
    addRewrite(rel, 'rename (tokens)');
  }
  for (const rel of expandGlobs(root, manifest.rename.globs)) {
    addRewrite(rel, 'rename (tokens)');
  }

  if (!web) {
    for (const rel of webFiles(root, manifest)) {
      if (exists(root, rel)) plan.push({ action: 'delete', path: rel, detail: 'web target' });
    }
    plan.push({
      action: 'rewrite',
      path: manifest.web.packageJson,
      detail: 'drop web scripts and deps',
    });
    plan.push({
      action: 'rewrite',
      path: manifest.web.makefile,
      detail: `drop targets: ${manifest.web.makeTargets.join(', ')}`,
    });
    plan.push({
      action: 'rewrite',
      path: manifest.web.knipConfig,
      detail: `drop plugins: ${manifest.web.knipPlugins.join(', ')}`,
    });
    plan.push({
      action: 'rewrite',
      path: manifest.web.commitlintConfig,
      detail: `drop scopes: ${manifest.web.commitlintScopes.join(', ')}`,
    });
    for (const block of manifest.web.markedBlocks) {
      plan.push({ action: 'rewrite', path: block.path, detail: `drop ${block.marker} block` });
    }
    for (const edit of manifest.web.edits) {
      if (exists(root, edit.path))
        plan.push({ action: 'rewrite', path: edit.path, detail: 'drop web references' });
    }
    for (const rel of expandGlobs(root, manifest.web.docScrub.globs)) {
      plan.push({ action: 'rewrite', path: rel, detail: 'scrub web doc rows' });
    }
  }

  for (const rel of manifest.selfDelete.paths) {
    plan.push({ action: 'delete', path: rel, detail: 'self-delete' });
  }
  plan.push({
    action: 'rewrite',
    path: manifest.web.makefile,
    detail: `drop targets: ${manifest.selfDelete.makeTargets.join(', ')}`,
  });
  for (const block of manifest.selfDelete.markedBlocks) {
    if (exists(root, block.path))
      plan.push({ action: 'rewrite', path: block.path, detail: `drop ${block.marker} block` });
  }
  for (const rel of expandGlobs(root, manifest.selfDelete.docScrub.globs)) {
    plan.push({ action: 'rewrite', path: rel, detail: 'scrub template-usage rows' });
  }
  return plan;
}

function webFiles(root, manifest) {
  const listed = exists(root, manifest.web.filesList)
    ? read(root, manifest.web.filesList)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
    : [];
  return [...new Set([...listed, ...manifest.web.files])];
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

function applyRename(root, manifest, answers) {
  for (const entry of manifest.rename.perFile) {
    if (!exists(root, entry.path)) continue;
    write(root, entry.path, applyTokens(read(root, entry.path), entry.replace, answers));
  }
  const targets = [...manifest.rename.paths, ...expandGlobs(root, manifest.rename.globs)];
  for (const rel of new Set(targets)) {
    if (!exists(root, rel)) continue;
    write(root, rel, applyTokens(read(root, rel), manifest.rename.tokens, answers));
  }
}

function applyDocScrub(root, scrub) {
  for (const rel of expandGlobs(root, scrub.globs)) {
    const before = read(root, rel);
    const after = removeParagraphs(
      removeBullets(removeLines(before, scrub.lines), scrub.bullets ?? []),
      scrub.paragraphs,
    );
    if (after !== before) write(root, rel, after);
  }
}

function applyWebRemoval(root, manifest) {
  const web = manifest.web;
  for (const rel of webFiles(root, manifest)) {
    rmSync(abs(root, rel), { recursive: true, force: true });
  }

  write(
    root,
    web.packageJson,
    rewriteJson(read(root, web.packageJson), (pkg) => {
      for (const key of web.packageScripts) delete pkg.scripts?.[key];
      for (const key of web.packageDependencies) delete pkg.dependencies?.[key];
      for (const key of web.packageDevDependencies) delete pkg.devDependencies?.[key];
    }),
  );

  write(
    root,
    web.knipConfig,
    rewriteJson(read(root, web.knipConfig), (knip) => {
      for (const key of web.knipPlugins) delete knip[key];
    }),
  );

  write(root, web.makefile, removeMakeTargets(read(root, web.makefile), web.makeTargets));

  write(
    root,
    web.commitlintConfig,
    removeLines(
      read(root, web.commitlintConfig),
      web.commitlintScopes.map((scope) => `^\\s*'${escapeRe(scope)}',\\s*$`),
    ),
  );

  for (const block of web.markedBlocks) {
    const { text, found } = removeMarkedBlock(read(root, block.path), block.marker);
    if (!found) throw new Error(`${block.path}: no ${block.marker}-start marker found`);
    write(root, block.path, text);
  }

  for (const edit of web.edits) {
    if (!exists(root, edit.path)) {
      if (edit.optional) continue;
      throw new Error(`manifest lists a missing file: ${edit.path}`);
    }
    let text = read(root, edit.path);
    if (edit.replace) text = applyTokens(text, edit.replace, {});
    if (edit.blocks) text = removeBlocks(text, edit.blocks);
    if (edit.lines) text = removeLines(text, edit.lines);
    if (edit.paragraphs) text = removeParagraphs(text, edit.paragraphs);
    write(root, edit.path, text);
  }

  applyDocScrub(root, web.docScrub);
}

function applySelfDelete(root, manifest) {
  write(
    root,
    manifest.web.makefile,
    removeMakeTargets(read(root, manifest.web.makefile), manifest.selfDelete.makeTargets),
  );
  for (const block of manifest.selfDelete.markedBlocks) {
    if (!exists(root, block.path)) continue;
    const { text } = removeMarkedBlock(read(root, block.path), block.marker);
    write(root, block.path, text);
  }
  applyDocScrub(root, manifest.selfDelete.docScrub);
  for (const rel of manifest.selfDelete.paths) {
    rmSync(abs(root, rel), { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Prompting
// ---------------------------------------------------------------------------

const USAGE = `make init — rename this template into your app.

  --yes                 non-interactive; every value below must be supplied
  --dry-run             print the touch list and exit without changing anything
  --name <str>          display name, e.g. "Acme Wallet"
  --slug <str>          Expo slug / package name, e.g. acme-wallet
  --ios-bundle-id <id>  e.g. com.acme.wallet
  --android-package <id> e.g. com.acme.wallet
  --scheme <str>        deep-link scheme, e.g. acme
  --owners <org>        GitHub org or user that owns the repo, e.g. acme
  --web | --no-web      keep or strip the web target (see docs/web-files.txt)
`;

export const DRY_RUN_PLACEHOLDERS = {
  name: 'Example App',
  slug: 'example-app',
  iosBundleId: 'com.example.exampleapp',
  androidPackage: 'com.example.exampleapp',
  scheme: 'exampleapp',
  owner: 'example',
};

function defaultsFrom(answers) {
  const slug = answers.slug;
  return {
    slug: answers.name
      ? answers.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
      : undefined,
    scheme: slug ? slug.replace(/-/g, '') : undefined,
    iosBundleId: slug ? `com.example.${slug.replace(/-/g, '')}` : undefined,
    androidPackage: slug ? `com.example.${slug.replace(/-/g, '')}` : undefined,
  };
}

async function prompt(answers) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ask = async (field, label) => {
      for (;;) {
        const fallback = defaultsFrom(answers)[field];
        const suffix = fallback ? ` [${fallback}]` : '';
        const raw = (await rl.question(`${label}${suffix}: `)).trim();
        const value = raw || fallback || '';
        const error = validateField(field, value);
        if (!error) {
          answers[field] = value;
          return;
        }
        console.error(error);
      }
    };
    await ask('name', 'App display name');
    await ask('slug', 'Slug (package name, Expo slug)');
    await ask('iosBundleId', 'iOS bundle identifier');
    await ask('androidPackage', 'Android package');
    await ask('scheme', 'Deep-link scheme');
    await ask('owner', 'GitHub owner (org or user)');
    if (answers.web === undefined) {
      const raw = (await rl.question('Keep the web target? [y/N]: ')).trim().toLowerCase();
      answers.web = raw === 'y' || raw === 'yes';
    }
  } finally {
    rl.close();
  }
  return answers;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

export async function main(argv, root = REPO_ROOT) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const manifest = loadManifest(root);
  let answers = { ...options.answers };
  let web = options.web;

  if (options.dryRun) {
    // The touch list does not depend on the values, so a dry run never prompts:
    // whatever was not passed on the command line gets an obvious placeholder.
    answers = { ...DRY_RUN_PLACEHOLDERS, ...answers };
  } else if (!options.yes) {
    answers.web = web ?? undefined;
    answers = await prompt(answers);
    web = answers.web;
  }
  if (web === null || web === undefined) web = true;

  const errors = validateAnswers(answers);
  if (errors.length > 0) {
    for (const message of errors) console.error(message);
    console.error(`\n${USAGE}`);
    return 2;
  }
  const filled = deriveAnswers(answers);

  const plan = buildPlan(root, manifest, { web });
  if (options.dryRun) {
    console.log(`init --dry-run: ${plan.length} operations (nothing was changed)\n`);
    for (const row of plan)
      console.log(`  ${row.action.padEnd(7)} ${row.path.padEnd(52)} ${row.detail}`);
    console.log(`\nweb target: ${web ? 'kept' : 'removed'}`);
    return 0;
  }

  applyRename(root, manifest, filled);
  if (!web) applyWebRemoval(root, manifest);
  applySelfDelete(root, manifest);

  if (process.env.INIT_SKIP_INSTALL !== '1') {
    run('pnpm', ['install'], { cwd: root });
    run('pnpm', ['codegen'], { cwd: root });
    // Renaming touches no message id, so the catalogs must come back unchanged.
    run('pnpm', ['i18n:check'], { cwd: root });
    // The JSON rewrites above are parse/stringify, which is valid JSON but not
    // necessarily Biome's line-width choice; format before the gate reads it.
    run('pnpm', ['format'], { cwd: root });
    run('make', ['check-code'], { cwd: root });
  } else {
    console.log('INIT_SKIP_INSTALL=1: skipping install, codegen, i18n and check-code');
  }

  if (process.env.INIT_SKIP_COMMIT !== '1') {
    run('git', ['add', '-A'], { cwd: root });
    run(
      'git',
      ['commit', '-m', `chore(app): initialize ${filled.slug} from react-native-mobile-template`],
      {
        cwd: root,
      },
    );
  } else {
    console.log('INIT_SKIP_COMMIT=1: leaving the changes uncommitted');
  }

  console.log(
    `\n${filled.name} is ready. Next: set the repo variables and secrets listed in docs/release-runbook.md.`,
  );
  return 0;
}

// realpath on both sides: Node resolves symlinks for the main module's URL, and
// on macOS a temp dir is reached through the /var -> /private/var symlink.
const invokedDirectly =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
