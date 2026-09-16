#!/usr/bin/env node
// Markdown tables on GitHub share the page width in proportion to their content:
// one long cell squeezes every other column until its code spans wrap character
// by character (`make`&nbsp;/ `check-`&nbsp;/ `docs`). The house rule: write a
// table cell as lines of at most MAX_LINE visible characters, broken with
// `<br>`. This finds the cells that break it so `make check-docs` fails instead
// of a reviewer noticing after the merge.
//
// 120, not the 72 the sibling repos use: theirs is tuned for narrow package
// READMEs on npm, while these tables are read on GitHub at full page width and
// document long command lines. Measured against this repo, 72 flags 117 lines
// and 120 flags the 25 that actually squeeze a neighbouring column.
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_LINE = 120;

// The docs GitHub renders for this repo. `docs/superpowers/**` is excluded:
// those are agent plans and specs, not published documentation, and they carry
// wide tables on purpose.
export const DOC_GLOBS = [
  'README.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'docs/**/*.md',
];
export const DOC_EXCLUDES = ['docs/superpowers/'];

/**
 * Every fenced block in `lines`, as
 * `{ info, indent, start, end, closed, body }`. `start`/`end` are 0-based
 * indices of the opening and closing delimiters (`end` is `lines.length` and
 * `closed` is false when the fence is never closed); `body` is the content with
 * the opening fence's indentation removed; `info` is the lowercased first word
 * of the info string.
 *
 * Shared by both docs checks — the table check must not measure a code block,
 * the diagram check wants the mermaid ones — so there is one answer to "am I
 * inside a fence". A fence closes only on a delimiter of the same character,
 * at least as long, with nothing after it. That is what makes a ```mermaid
 * inside a ````-fence its content rather than a diagram, and what stops a
 * four-backtick block containing a three-backtick line from desyncing the
 * scanner for the rest of the file.
 */
export function fencedBlocks(lines) {
  const blocks = [];
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
        blocks.push({ ...open, end: i, closed: true });
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
        start: i,
        body: [],
      };
    }
  }
  if (open) blocks.push({ ...open, end: lines.length, closed: false });
  return blocks;
}

/** 0-based indices of every line inside a fenced block, delimiters included. */
function fencedLines(lines) {
  const inside = new Set();
  for (const block of fencedBlocks(lines)) {
    for (let i = block.start; i <= Math.min(block.end, lines.length - 1); i++) inside.add(i);
  }
  return inside;
}

// Visible width of a cell line: markdown and HTML decoration takes no space on
// the rendered page.
function stripTags(text) {
  let previous;
  let current = text;
  do {
    previous = current;
    current = current.replace(/<[^>]*>/g, '');
  } while (current !== previous); // nested or partial tags: repeat until stable
  return current;
}

function visible(text) {
  return stripTags(text)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links become their text
    .replace(/[`*_]/g, '') // code spans, emphasis
    .replace(/&nbsp;/g, ' ')
    .trim();
}

const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
const isSeparator = (line) => /^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(line);

/** A row's cells, ignoring the outer pipes and any escaped `\|`. */
function cells(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
}

/**
 * Every table cell line in `markdown` wider than `max`, as
 * `{ line, column, width, text }` with 1-based line and column numbers. Fenced
 * code blocks and separator rows are skipped; a cell is measured per `<br>`
 * segment, because that is what a rendered line is.
 */
export function overlongTableLines(markdown, max = MAX_LINE) {
  const findings = [];
  const lines = markdown.split('\n');
  const inFence = fencedLines(lines);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inFence.has(i) || !isTableRow(line) || isSeparator(line)) continue;
    cells(line).forEach((cell, column) => {
      for (const segment of cell.split(/<br\s*\/?>/i)) {
        const width = visible(segment).length;
        if (width > max) {
          findings.push({ line: i + 1, column: column + 1, width, text: visible(segment) });
        }
      }
    });
  }
  return findings;
}

/** One report line per finding, for the terminal and the CI log. */
export function formatFindings(file, findings, max = MAX_LINE) {
  return findings.map(
    (f) =>
      `${file}:${f.line}: table cell (column ${f.column}) has a ${f.width}-character line, limit ${max} — break it with <br>: "${f.text.slice(0, 60)}…"`,
  );
}

/** The doc set, with the excluded subtrees dropped. */
export function docFiles(globs = DOC_GLOBS, excludes = DOC_EXCLUDES) {
  return globSync(globs)
    .filter((file) => !excludes.some((prefix) => file.startsWith(prefix)))
    .sort();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const files = process.argv.length > 2 ? process.argv.slice(2) : docFiles();
  let problems = 0;
  for (const file of files) {
    for (const line of formatFindings(file, overlongTableLines(readFileSync(file, 'utf8')))) {
      console.error(line);
      problems++;
    }
  }
  if (problems > 0) {
    console.error(`docs tables: ${problems} over-wide table line(s), limit ${MAX_LINE}`);
    process.exit(1);
  }
  console.log(`docs tables ok (${files.length} files)`);
}
