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
// This is the one gate that needs the network on a cold npx cache. Whether the
// toolchain works is settled once, up front, by rendering a diagram this file
// owns (PROBE_DIAGRAM) — never by reading the parser's complaints about the
// docs' own diagrams. When that probe fails the check skips with a warning
// rather than blocking an offline developer — loudly, as a `::warning::`
// annotation, when CI is set, so a skip is never invisible in a run log.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOC_EXCLUDES, DOC_GLOBS, docFiles, fencedBlocks } from './check-docs-tables.mjs';

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
  return (
    fencedBlocks(markdown.split('\n'))
      // An unclosed fence is a markdown bug, not a diagram; leave it to the reader.
      .filter((block) => block.info === 'mermaid' && block.closed)
      .map((block) => ({ line: block.start + 1, code: block.body.join('\n') }))
  );
}

/** The subset of `files` that contains at least one mermaid block. */
export function filesWithMermaid(files, read) {
  return files.filter((file) => extractMermaidBlocks(read(file)).length > 0);
}

// A diagram this file owns, used to decide whether the toolchain works at all.
// It must never come from the docs: the whole point is that the thing being
// checked cannot influence the decision to check it.
export const PROBE_DIAGRAM = 'graph TD;\n  A-->B;';

/**
 * Whether `run` can render at all, decided by rendering PROBE_DIAGRAM — a
 * known-good diagram — rather than by reading the parser's complaints.
 *
 * The earlier version sniffed `mmdc`'s stderr for words like "network" or
 * "command not found" to tell an offline npx from a broken diagram. That was
 * unsound: `mmdc` echoes the diagram source back in its parse errors
 * ("...for text: <the block>"), so a malformed diagram containing any of those
 * words classified itself as an environment problem and turned the gate off.
 * The one failure mode a gate must not have. Availability is now settled once,
 * before a single doc block is read, and every later non-zero exit is the
 * diagram's fault by construction.
 */
export function probeToolchain(run) {
  const { status, stderr } = run(PROBE_DIAGRAM);
  return status === 0 ? { available: true } : { available: false, stderr };
}

/** `message` without npx's own config chatter, which is never the diagnosis. */
export function cleanOutput(message, lines = 4) {
  return (message ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^npm (warn|notice)\b/.test(l))
    .slice(0, lines)
    .join(' ');
}

/** One report line per broken block, pointing at the fence that opened it. */
export function formatParseError(file, block, message) {
  const first = cleanOutput(message);
  return `${file}:${block.line}: mermaid block does not parse — ${first || 'no parser output'}`;
}

/**
 * Check one block with `run(code)`, which must return `{ status, stderr }`.
 * Called only after `probeToolchain` said the toolchain works, so a non-zero
 * exit here is a parse failure and nothing else.
 */
export function checkBlock(file, block, run) {
  const { status, stderr } = run(block.code);
  return status === 0 ? { ok: true } : { error: formatParseError(file, block, stderr) };
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

// One `npx` process per diagram, plus one for the probe. The doc set has a
// single block today, so this is two spawns; past roughly three blocks it is
// worth writing them all into `dir` and handing `mmdc` the directory once
// (`-i dir`), or resolving the CLI once with a warm `npx --no-install`.
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
    // A spawn that never started (no npx on PATH) has no exit code of its own.
    if (result.error) return { status: 1, stderr: `could not run npx: ${result.error.message}` };
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
  let probe;
  try {
    // Availability first, on our own diagram. Nothing from the docs has been
    // handed to the CLI at this point, so nothing in the docs can turn the
    // gate off.
    probe = probeToolchain(run);
    if (probe.available) {
      for (const file of files) {
        for (const block of extractMermaidBlocks(read(file))) {
          blocks++;
          const { error } = checkBlock(file, block, run);
          if (error) errors.push(error); // collect them all; never stop early
        }
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (!probe.available) {
    const why = cleanOutput(probe.stderr, 2) || 'no output';
    const message = `mermaid check skipped: ${MERMAID_CLI} could not render a known-good diagram (${why}) — this gate needs the network on a cold npx cache`;
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
