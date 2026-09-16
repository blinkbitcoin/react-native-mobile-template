#!/usr/bin/env node
// Parse-check every fenced ```mermaid block in the docs.
//
// This repo keeps its diagrams as GitHub-native fences rather than rendering
// `.mmd` sources to committed SVGs: GitHub draws the fence, so an SVG artifact,
// an assembler and a regeneration hook would be machinery with no reader. What
// that costs is validation — a malformed diagram merges happily and renders as
// a grey error box — so the blocks are extracted here and fed to the same
// mermaid parser GitHub uses, pinned to one version.
//
//   node scripts/check-diagrams.mjs [--all] [files...]
//
// With no arguments only docs that changed against origin/main are checked, so
// the usual `make check-docs` costs nothing; `--all` checks the whole doc set
// and is what CI runs.
//
// This is the one gate that needs the network on a cold npx cache. When the CLI
// cannot be fetched the check skips with a warning rather than blocking an
// offline developer — loudly, as a `::warning::` annotation, when CI is set, so
// a skip is never invisible in a run log.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOC_EXCLUDES, DOC_GLOBS, docFiles } from './check-docs-tables.mjs';

// Pinned, not `@latest`: the parser is the thing under test, so a mermaid
// release must be a reviewed commit here rather than a check that changes its
// mind overnight. Same pin as the sibling repos.
export const MERMAID_CLI = '@mermaid-js/mermaid-cli@11.16.0';

/**
 * Every fenced mermaid block in `markdown`, as `{ line, code }` with `line` the
 * 1-based line of the opening fence. Handles indented fences (a block inside a
 * list item) and nested fences: a ```` ```mermaid ```` inside a longer fence is
 * that outer block's content, not a diagram.
 */
export function extractMermaidBlocks(markdown) {
  const blocks = [];
  const lines = markdown.split('\n');
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const match = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (open) {
      const closes =
        match &&
        match[2][0] === open.char &&
        match[2].length >= open.length &&
        match[3].trim() === '';
      if (closes) {
        if (open.info === 'mermaid') blocks.push({ line: open.line, code: open.body.join('\n') });
        open = null;
      } else {
        open.body.push(lines[i].slice(open.indent));
      }
      continue;
    }
    if (match) {
      open = {
        char: match[2][0],
        length: match[2].length,
        indent: match[1].length,
        info: match[3].trim().split(/\s+/)[0].toLowerCase(),
        line: i + 1,
        body: [],
      };
    }
  }
  // An unclosed fence is a markdown bug, not a diagram; leave it to the reader.
  return blocks;
}

/** The subset of `files` that contains at least one mermaid block. */
export function filesWithMermaid(files, read) {
  return files.filter((file) => extractMermaidBlocks(read(file)).length > 0);
}

// A failing `mmdc` call means one of two very different things. Anything that
// says the tool or its browser is not there is an environment problem — an
// offline `npx`, a puppeteer install without Chrome — and must not read as "the
// diagram is broken"; everything else is the parser talking.
const UNAVAILABLE =
  /could not find (chrome|chromium)|failed to launch|npm error|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|command not found|ERR_MODULE_NOT_FOUND|ERR_SOCKET|network|registry\.npmjs\.org/i;

/** `'unavailable'` when the CLI or its browser could not run, else `'parse'`. */
export function classifyFailure(stderr) {
  return UNAVAILABLE.test(stderr ?? '') ? 'unavailable' : 'parse';
}

/** One report line per broken block, pointing at the fence that opened it. */
export function formatParseError(file, block, message) {
  const first = (message ?? '')
    .split('\n')
    .map((l) => l.trim())
    // npx prints its own config warnings on the same stream; they are never
    // what is wrong with the diagram.
    .filter((l) => l && !/^npm (warn|notice)\b/.test(l))
    .slice(0, 4)
    .join(' ');
  return `${file}:${block.line}: mermaid block does not parse — ${first || 'no parser output'}`;
}

/**
 * Check one block with `run(code)`, which must return
 * `{ status, stderr }`. Returns `{ ok }`, `{ unavailable, stderr }` or
 * `{ error }` so the CLI below stays a thin loop and this stays testable.
 */
export function checkBlock(file, block, run) {
  const { status, stderr } = run(block.code);
  if (status === 0) return { ok: true };
  if (classifyFailure(stderr) === 'unavailable') return { unavailable: true, stderr };
  return { error: formatParseError(file, block, stderr) };
}

function changedDocs() {
  try {
    const out = execFileSync('git', ['diff', '--name-only', 'origin/main...HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out
      .split('\n')
      .filter(Boolean)
      .filter((f) => f.endsWith('.md') && !DOC_EXCLUDES.some((p) => f.startsWith(p)));
  } catch {
    return undefined; // no origin/main, shallow clone: check everything
  }
}

function mmdcRunner(dir) {
  let n = 0;
  return (code) => {
    const input = path.join(dir, `block-${n++}.mmd`);
    writeFileSync(input, `${code}\n`);
    const result = spawnSync(
      'npx',
      ['--yes', MERMAID_CLI, '--quiet', '-i', input, '-o', `${input}.svg`],
      { encoding: 'utf8' },
    );
    if (result.error)
      return { status: 1, stderr: `command not found: npx (${result.error.message})` };
    return { status: result.status, stderr: `${result.stderr ?? ''}${result.stdout ?? ''}` };
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const explicit = args.filter((a) => a !== '--all');

  const read = (file) => readFileSync(file, 'utf8');
  let candidates;
  if (explicit.length > 0) {
    candidates = explicit;
  } else if (all) {
    candidates = docFiles(DOC_GLOBS, DOC_EXCLUDES);
  } else {
    const changed = changedDocs();
    candidates = changed === undefined ? docFiles(DOC_GLOBS, DOC_EXCLUDES) : changed;
  }
  const files = filesWithMermaid(
    candidates.filter((file) => {
      try {
        read(file);
        return true;
      } catch {
        return false; // deleted in the working tree
      }
    }),
    read,
  );

  if (files.length === 0) {
    console.log('diagrams ok (no changed doc has a mermaid block)');
    process.exit(0);
  }

  const dir = mkdtempSync(path.join(tmpdir(), 'check-diagrams-'));
  const run = mmdcRunner(dir);
  const errors = [];
  let blocks = 0;
  let skipped = null;
  try {
    for (const file of files) {
      if (skipped) break;
      for (const block of extractMermaidBlocks(read(file))) {
        blocks++;
        const result = checkBlock(file, block, run);
        if (result.unavailable) {
          skipped = result.stderr;
          break;
        }
        if (result.error) errors.push(result.error);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (skipped) {
    const why = skipped.split('\n').find((l) => l.trim()) ?? 'unknown reason';
    const message = `mermaid check skipped: ${MERMAID_CLI} could not run (${why.trim()}) — this gate needs the network on a cold npx cache`;
    console.error(process.env.CI ? `::warning::${message}` : `warning: ${message}`);
    process.exit(0);
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    console.error(`diagrams: ${errors.length} mermaid block(s) do not parse`);
    process.exit(1);
  }
  console.log(`diagrams ok (${blocks} mermaid block(s) in ${files.length} file(s))`);
}
