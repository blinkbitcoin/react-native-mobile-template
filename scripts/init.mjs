#!/usr/bin/env node
// `make init` — turn this template into your app, then delete itself.
//
// Everything it touches is declared in scripts/init.manifest.json; this file is
// only the engine (prompting, validation, the per-file-type rewrites and the
// finishing gates). Zero npm dependencies: it runs before `pnpm install` has
// necessarily been re-run.
//
// Order of business: build the plan, validate EVERY anchor, marker and target
// the plan depends on against the files as they are now, and only then write.
// A stale anchor exits 2 with the list and leaves the tree untouched, because a
// half-stripped repo is much worse than one that refused to start.
//
//   node scripts/init.mjs                      interactive
//   node scripts/init.mjs --dry-run            print the touch list, change nothing
//   node scripts/init.mjs --yes --name "Acme" --slug acme --scheme acme \
//     --ios-bundle-id com.acme.app --android-package com.acme.app \
//     --owners acme --no-web
//
// POSIX only: the rewrites are line-oriented on LF and the sub-processes are
// spawned without a shell, so a CRLF checkout or a Windows `pnpm.cmd` is out of
// scope (the template's toolchain is mise on macOS/Linux either way).
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
// Answer validation
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

/** How many times `needle` occurs in `text` (non-overlapping). */
export function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

/** Fill `{{placeholder}}` holes from the answers object. */
export function renderTemplate(template, answers) {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key) => {
    if (!(key in answers)) throw new Error(`unknown placeholder in manifest: ${whole}`);
    return String(answers[key]);
  });
}

/**
 * Apply ordered `[from, to]` (or `[from, to, count]`) literal replacements.
 * `to` may contain placeholders; `count` is only read by the validator.
 */
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

/** Drop blank-line-delimited paragraphs containing a match. */
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

const isBullet = (line) => line !== undefined && /^\s*[-*] /.test(line);

/**
 * Remove the Markdown list item containing a match, wrapping lines included —
 * and only that item. A whole list is one blank-line-delimited paragraph, so
 * `removeParagraphs` would take the item's neighbours with it; walking back to
 * "some earlier bullet" without a guard would eat every bullet above a match
 * that is not in a list at all. So: the match must sit on a list-item line or on
 * one of its continuation lines (no blank line in between), otherwise this pass
 * leaves the file alone and the `paragraphs` pass deals with it.
 */
export function removeBullets(text, patterns) {
  const lines = text.split('\n');
  for (const pattern of patterns) {
    const re = new RegExp(pattern);
    for (let i = 0; i < lines.length; i += 1) {
      if (!re.test(lines[i])) continue;
      let start = i;
      while (start >= 0 && !isBullet(lines[start])) {
        // A blank line ends the item: the match is not inside a list item.
        if (lines[start] === '') {
          start = -1;
          break;
        }
        start -= 1;
      }
      if (start < 0 || !isBullet(lines[start])) continue;
      let end = start + 1;
      while (end < lines.length && lines[end] !== '' && !isBullet(lines[end])) end += 1;
      lines.splice(start, end - start);
      i = start - 1;
    }
  }
  return lines.join('\n');
}

/**
 * Remove every `{ from, until }` span: a line matching `from` through the next
 * line matching `until`, inclusive, plus the blank line that follows. This is
 * for code that cannot carry markers (a `test(...)` call in a suite this task
 * does not own) and that blank lines run straight through.
 */
export function removeBlocks(text, blocks) {
  const lines = text.split('\n');
  for (const { from, until } of blocks) {
    const fromRe = new RegExp(from);
    const untilRe = new RegExp(until);
    for (let start = lines.findIndex((line) => fromRe.test(line)); start !== -1; ) {
      let end = start;
      while (end < lines.length && !untilRe.test(lines[end])) end += 1;
      if (end === lines.length) throw new Error(`no line matching ${until} after ${from}`);
      if (lines[end + 1] === '') end += 1;
      lines.splice(start, end - start + 1);
      start = lines.findIndex((line) => fromRe.test(line));
    }
  }
  return lines.join('\n');
}

/** Collapse the run of blank lines a removal can leave behind. */
const collapseBlankRuns = (text) => text.replace(/\n{3,}/g, '\n\n');

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
  return { text: collapseBlankRuns(out.join('\n')), found };
}

/** Drop the marker lines but keep what they wrap (the "web is kept" case). */
export function removeMarkerLines(text, marker) {
  return removeLines(text, [`${escapeRe(marker)}-(start|end)`]);
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

function run(command, args, { cwd } = {}) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited ${result.status ?? 'null'}`);
  }
  return result.status;
}

export function loadManifest(root = REPO_ROOT) {
  return JSON.parse(readFileSync(path.join(root, 'scripts/init.manifest.json'), 'utf8'));
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
// Preflight: does every anchor the manifest declares still exist?
// ---------------------------------------------------------------------------

/**
 * Check one `edits`-shaped entry against the file as it is now. Every anchor is
 * in the manifest *because* it matches today, so a non-match is drift, not an
 * optional case.
 * @returns {string[]} problems, empty when the entry is sound.
 */
export function validateEdit(root, entry) {
  const problems = [];
  if (!exists(root, entry.path)) {
    if (!entry.optional) problems.push(`${entry.path}: missing (the manifest lists it)`);
    return problems;
  }
  const text = read(root, entry.path);
  const lines = text.split('\n');

  for (const [from, , count] of entry.replace ?? []) {
    // A number is an exact count; "+" means "one or more", for the replace-all
    // anchors whose count is not itself meaningful (CODEOWNERS rows, fixture links).
    const wanted = count ?? 1;
    const actual = countOccurrences(text, from);
    const ok = wanted === '+' ? actual >= 1 : actual === wanted;
    if (!ok) {
      problems.push(
        `${entry.path}: anchor occurs ${actual}x, expected ${wanted}x: ${JSON.stringify(from)}`,
      );
    }
  }
  for (const { from, until } of entry.blocks ?? []) {
    const start = lines.findIndex((line) => new RegExp(from).test(line));
    if (start === -1) {
      problems.push(`${entry.path}: no line matches block start /${from}/`);
      continue;
    }
    if (!lines.slice(start).some((line) => new RegExp(until).test(line))) {
      problems.push(`${entry.path}: no line matches block end /${until}/ after /${from}/`);
    }
  }
  for (const pattern of entry.lines ?? []) {
    if (!lines.some((line) => new RegExp(pattern).test(line))) {
      problems.push(`${entry.path}: no line matches /${pattern}/`);
    }
  }
  for (const pattern of entry.paragraphs ?? []) {
    if (!new RegExp(pattern, 'm').test(text)) {
      problems.push(`${entry.path}: no paragraph matches /${pattern}/`);
    }
  }
  return problems;
}

function validateMarkedBlock(root, block) {
  if (!exists(root, block.path)) {
    return block.optional ? [] : [`${block.path}: missing (the manifest lists it)`];
  }
  const text = read(root, block.path);
  const starts = countOccurrences(text, `${block.marker}-start`);
  const ends = countOccurrences(text, `${block.marker}-end`);
  if (starts !== 1 || ends !== 1) {
    return [`${block.path}: expected one ${block.marker}-start/-end pair, found ${starts}/${ends}`];
  }
  return [];
}

function validateScrub(root, scrub, label) {
  const problems = [];
  const files = expandGlobs(root, scrub.globs).map((rel) => [rel, read(root, rel)]);
  const matches = (pattern, test) =>
    files.some(([, text]) => test(new RegExp(pattern, 'm'), text.split('\n'), text));
  for (const pattern of scrub.lines ?? []) {
    if (!matches(pattern, (re, lines) => lines.some((line) => re.test(line)))) {
      problems.push(`${label}: no line in any scrubbed file matches /${pattern}/`);
    }
  }
  for (const pattern of scrub.bullets ?? []) {
    if (!matches(pattern, (re, lines) => lines.some((line) => re.test(line)))) {
      problems.push(`${label}: no line in any scrubbed file matches /${pattern}/`);
    }
  }
  for (const pattern of scrub.paragraphs ?? []) {
    if (!matches(pattern, (re, _lines, text) => re.test(text))) {
      problems.push(`${label}: no paragraph in any scrubbed file matches /${pattern}/`);
    }
  }
  return problems;
}

/**
 * Everything that has to be true before the first byte is written.
 * @returns {string[]} problems, empty when the run can proceed.
 */
export function validatePlan(root, manifest, { web }) {
  const problems = [];

  for (const entry of manifest.rename.perFile) problems.push(...validateEdit(root, entry));
  for (const rel of manifest.rename.paths) {
    if (!exists(root, rel)) problems.push(`${rel}: missing (rename.paths lists it)`);
  }

  if (!web) {
    const cfg = manifest.web;
    for (const rel of webFiles(root, manifest)) {
      if (!exists(root, rel)) problems.push(`${rel}: missing (the web file list names it)`);
    }
    if (exists(root, cfg.packageJson)) {
      const pkg = JSON.parse(read(root, cfg.packageJson));
      for (const key of cfg.packageScripts) {
        if (!(key in (pkg.scripts ?? {}))) problems.push(`${cfg.packageJson}: no script "${key}"`);
      }
      for (const key of cfg.packageDependencies) {
        if (!(key in (pkg.dependencies ?? {})))
          problems.push(`${cfg.packageJson}: no dependency "${key}"`);
      }
      for (const key of cfg.packageDevDependencies) {
        if (!(key in (pkg.devDependencies ?? {})))
          problems.push(`${cfg.packageJson}: no devDependency "${key}"`);
      }
    }
    if (exists(root, cfg.knipConfig)) {
      const knip = JSON.parse(read(root, cfg.knipConfig));
      for (const key of cfg.knipPlugins) {
        if (!(key in knip)) problems.push(`${cfg.knipConfig}: no "${key}" plugin key`);
      }
    }
    problems.push(
      ...validateEdit(root, {
        path: cfg.makefile,
        lines: cfg.makeTargets.map((target) => `^${escapeRe(target)}:`),
      }),
      ...validateEdit(root, {
        path: cfg.commitlintConfig,
        lines: cfg.commitlintScopes.map((scope) => `^\\s*'${escapeRe(scope)}',\\s*$`),
      }),
    );
    for (const block of cfg.markedBlocks) problems.push(...validateMarkedBlock(root, block));
    for (const entry of cfg.edits) problems.push(...validateEdit(root, entry));
    problems.push(...validateScrub(root, cfg.docScrub, 'web.docScrub'));
  } else {
    // Kept web still means the markers go: they point at a script that is
    // about to delete itself.
    for (const block of manifest.web.markedBlocks)
      problems.push(...validateMarkedBlock(root, block));
  }

  const self = manifest.selfDelete;
  for (const rel of self.paths) {
    if (!exists(root, rel)) problems.push(`${rel}: missing (selfDelete.paths lists it)`);
  }
  problems.push(
    ...validateEdit(root, {
      path: manifest.web.makefile,
      lines: self.makeTargets.map((target) => `^${escapeRe(target)}:`),
    }),
  );
  for (const block of self.markedBlocks) problems.push(...validateMarkedBlock(root, block));
  for (const entry of self.edits ?? []) problems.push(...validateEdit(root, entry));
  problems.push(...validateScrub(root, self.docScrub, 'selfDelete.docScrub'));

  return problems;
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/**
 * Everything the run would touch, as `{ action, path, detail }` rows. `--dry-run`
 * prints this and stops; the real run walks the same list. Purely descriptive —
 * `validatePlan` is what decides whether the run may start.
 */
export function buildPlan(root, manifest, { web }) {
  const plan = [];
  const seen = new Set();
  const add = (action, rel, detail) => {
    const key = `${action} ${rel} ${detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    plan.push({ action, path: rel, detail });
  };

  for (const entry of manifest.rename.perFile) {
    if (exists(root, entry.path)) add('rewrite', entry.path, 'rename (anchored)');
  }
  for (const rel of manifest.rename.paths) add('rewrite', rel, 'rename (tokens)');
  for (const rel of expandGlobs(root, manifest.rename.globs)) {
    add('rewrite', rel, 'rename (tokens)');
  }

  const cfg = manifest.web;
  if (!web) {
    for (const rel of webFiles(root, manifest)) add('delete', rel, 'web target');
    add('rewrite', cfg.packageJson, 'drop web scripts and deps');
    add('rewrite', cfg.makefile, `drop targets: ${cfg.makeTargets.join(', ')}`);
    add('rewrite', cfg.knipConfig, `drop plugins: ${cfg.knipPlugins.join(', ')}`);
    add('rewrite', cfg.commitlintConfig, `drop scopes: ${cfg.commitlintScopes.join(', ')}`);
    for (const block of cfg.markedBlocks) {
      add('rewrite', block.path, `drop ${block.marker} block`);
    }
    for (const entry of cfg.edits) {
      if (exists(root, entry.path)) add('rewrite', entry.path, 'drop web references');
    }
    for (const rel of expandGlobs(root, cfg.docScrub.globs)) {
      add('rewrite', rel, 'scrub web doc rows');
    }
  } else {
    for (const block of cfg.markedBlocks) {
      add('rewrite', block.path, `drop ${block.marker} marker lines (keep the block)`);
    }
  }

  const self = manifest.selfDelete;
  for (const rel of self.paths) add('delete', rel, 'self-delete');
  add('rewrite', cfg.makefile, `drop targets: ${self.makeTargets.join(', ')}`);
  for (const block of self.markedBlocks) {
    if (exists(root, block.path)) add('rewrite', block.path, `drop ${block.marker} block`);
  }
  for (const entry of self.edits ?? []) {
    if (exists(root, entry.path)) add('rewrite', entry.path, 'drop template-usage references');
  }
  for (const rel of expandGlobs(root, self.docScrub.globs)) {
    add('rewrite', rel, 'scrub template-usage rows');
  }
  return plan;
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

function applyEdits(root, entries) {
  for (const entry of entries) {
    if (!exists(root, entry.path)) continue;
    let text = read(root, entry.path);
    if (entry.replace) text = applyTokens(text, entry.replace, {});
    if (entry.blocks) text = removeBlocks(text, entry.blocks);
    if (entry.lines) text = removeLines(text, entry.lines);
    if (entry.paragraphs) text = removeParagraphs(text, entry.paragraphs);
    write(root, entry.path, text);
  }
}

function applyDocScrub(root, scrub) {
  for (const rel of expandGlobs(root, scrub.globs)) {
    const before = read(root, rel);
    const after = removeParagraphs(
      removeBullets(removeLines(before, scrub.lines ?? []), scrub.bullets ?? []),
      scrub.paragraphs ?? [],
    );
    if (after !== before) write(root, rel, after);
  }
}

function applyWebRemoval(root, manifest) {
  const cfg = manifest.web;
  for (const rel of webFiles(root, manifest)) {
    rmSync(abs(root, rel), { recursive: true, force: true });
  }

  write(
    root,
    cfg.packageJson,
    rewriteJson(read(root, cfg.packageJson), (pkg) => {
      for (const key of cfg.packageScripts) delete pkg.scripts[key];
      for (const key of cfg.packageDependencies) delete pkg.dependencies[key];
      for (const key of cfg.packageDevDependencies) delete pkg.devDependencies[key];
    }),
  );
  write(
    root,
    cfg.knipConfig,
    rewriteJson(read(root, cfg.knipConfig), (knip) => {
      for (const key of cfg.knipPlugins) delete knip[key];
    }),
  );
  write(root, cfg.makefile, removeMakeTargets(read(root, cfg.makefile), cfg.makeTargets));
  write(
    root,
    cfg.commitlintConfig,
    removeLines(
      read(root, cfg.commitlintConfig),
      cfg.commitlintScopes.map((scope) => `^\\s*'${escapeRe(scope)}',\\s*$`),
    ),
  );

  for (const block of cfg.markedBlocks) {
    write(root, block.path, removeMarkedBlock(read(root, block.path), block.marker).text);
  }
  applyEdits(root, cfg.edits);
  applyDocScrub(root, cfg.docScrub);
}

function applySelfDelete(root, manifest, { web }) {
  if (web) {
    // The block stays, the markers do not — they name a script that is going away.
    for (const block of manifest.web.markedBlocks) {
      write(root, block.path, removeMarkerLines(read(root, block.path), block.marker));
    }
  }
  const self = manifest.selfDelete;
  write(
    root,
    manifest.web.makefile,
    removeMakeTargets(read(root, manifest.web.makefile), self.makeTargets),
  );
  for (const block of self.markedBlocks) {
    if (!exists(root, block.path)) continue;
    write(root, block.path, removeMarkedBlock(read(root, block.path), block.marker).text);
  }
  applyEdits(root, self.edits ?? []);
  applyDocScrub(root, self.docScrub);
  for (const rel of self.paths) {
    rmSync(abs(root, rel), { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Prompting
// ---------------------------------------------------------------------------

const USAGE = `make init — rename this template into your app.

  --yes                  non-interactive; every value below must be supplied,
                         including --web or --no-web
  --dry-run              print the touch list and exit without changing anything
                         (defaults to --no-web, like the prompt does)
  --name <str>           display name, e.g. "Acme Wallet"
  --slug <str>           Expo slug / package name, e.g. acme-wallet
  --ios-bundle-id <id>   e.g. com.acme.wallet
  --android-package <id> e.g. com.acme.wallet
  --scheme <str>         deep-link scheme, e.g. acme
  --owners <org>         GitHub org or user that owns the repo, e.g. acme
  --web | --no-web       keep or strip the web target (see docs/web-files.txt)
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
    // A dry run never prompts: the touch list does not depend on the values, so
    // anything missing gets an obvious placeholder. `web` defaults the way the
    // prompt does — dropped — so the bare form shows the bigger, riskier list.
    answers = { ...DRY_RUN_PLACEHOLDERS, ...answers };
    if (web === null) web = false;
  } else if (options.yes) {
    if (web === null) {
      console.error('--yes needs --web or --no-web: say whether to keep the web target.');
      console.error(`\n${USAGE}`);
      return 2;
    }
  } else {
    answers.web = web ?? undefined;
    answers = await prompt(answers);
    web = answers.web;
  }

  const errors = validateAnswers(answers);
  if (errors.length > 0) {
    for (const message of errors) console.error(message);
    console.error(`\n${USAGE}`);
    return 2;
  }
  const filled = deriveAnswers(answers);

  // Preflight before the first write: a stale anchor stops the run rather than
  // leaving a half-renamed, half-stripped tree behind.
  const problems = validatePlan(root, manifest, { web });
  if (problems.length > 0) {
    console.error('scripts/init.manifest.json no longer matches this repo:\n');
    for (const problem of problems) console.error(`  ${problem}`);
    console.error('\nNothing was changed. Update the manifest anchors and run init again.');
    return 2;
  }

  const plan = buildPlan(root, manifest, { web });
  if (options.dryRun) {
    console.log(`init --dry-run: ${plan.length} operations (nothing was changed)\n`);
    for (const row of plan) {
      console.log(`  ${row.action.padEnd(7)} ${row.path.padEnd(52)} ${row.detail}`);
    }
    console.log(`\nweb target: ${web ? 'kept' : 'removed'}`);
    return 0;
  }

  applyRename(root, manifest, filled);
  if (!web) applyWebRemoval(root, manifest);

  // Everything from here on is wrapped, because everything from here on can fail
  // on a first adopter's machine for reasons that have nothing to do with them:
  // a registry hiccup during `pnpm install`, a codegen step that needs the
  // network. What must not happen is that such a failure leaves a tree with no
  // way forward — which is exactly what the old order did, by deleting this
  // script *before* running any of this. The adopter was left renamed, with
  // nothing installed, nothing committed, and the one command that would redo
  // the work gone. `git checkout .` would have thrown away the rename they came
  // for.
  //
  // So the destructive step moved to the end, and a failure before it now leaves
  // the tree exactly as re-runnable as it was.
  try {
    if (process.env.INIT_SKIP_INSTALL !== '1') {
      run('pnpm', ['install'], { cwd: root });
      run('pnpm', ['codegen'], { cwd: root });
      // Renaming touches no message id, so the catalogs must come back unchanged.
      run('pnpm', ['i18n:check'], { cwd: root });
    } else {
      console.log('INIT_SKIP_INSTALL=1: skipping install, codegen, i18n and check-code');
    }

    // The JSON rewrites above are parse/stringify: valid JSON, but not always
    // Biome's line-width choice. Formatting only needs node_modules, not a fresh
    // install, so it runs whenever Biome is there — otherwise a skipped-install
    // run ends with an unformatted tree and a red `make check-code`.
    // Biome directly, not `pnpm format`: pnpm would re-run the `prepare` lifecycle
    // (`lefthook install`), which needs a git repo the scratch copies do not have.
    if (exists(root, 'node_modules/.bin/biome')) {
      run(abs(root, 'node_modules/.bin/biome'), ['format', '--write', '.'], { cwd: root });
    }
    if (process.env.INIT_SKIP_INSTALL !== '1') {
      run('make', ['check-code'], { cwd: root });
    }

    // Last, and only once the gates have passed: this removes the initialiser
    // and its manifest, so it is the one step that cannot be undone by re-running.
    applySelfDelete(root, manifest, { web });

    if (process.env.INIT_SKIP_COMMIT !== '1') {
      run('git', ['add', '-A'], { cwd: root });
      run(
        'git',
        ['commit', '-m', `chore(app): initialize ${filled.slug} from react-native-mobile-template`],
        { cwd: root },
      );
    } else {
      console.log('INIT_SKIP_COMMIT=1: leaving the changes uncommitted');
    }
  } catch (error) {
    // A bare non-zero exit here would look like the adopter did something wrong.
    // Say what state the tree is in and what to type next, then re-throw so the
    // exit code still reports failure.
    const initialiserGone = !exists(root, 'scripts/init.mjs');
    console.error('\ninit did not finish.\n');
    console.error('The rename and the web-target choice have been applied to the working tree.');
    if (initialiserGone) {
      console.error(
        'scripts/init.mjs has already been removed, so the remaining steps are ordinary ones:\n' +
          '  pnpm install && pnpm codegen && make check-code\n' +
          '  git add -A && git commit -m "chore(app): initialize ' +
          `${filled.slug} from react-native-mobile-template"`,
      );
    } else {
      console.error(
        'scripts/init.mjs is still here and nothing has been committed, so you can fix the\n' +
          'cause and re-run it:\n' +
          '  git checkout . && node scripts/init.mjs\n' +
          'or finish by hand:\n' +
          '  pnpm install && pnpm codegen && make check-code',
      );
    }
    throw error;
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
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
