import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DOC_EXCLUDES,
  DOC_GLOBS,
  fencedBlocks,
  formatFindings,
  MAX_LINE,
  overlongTableLines,
} from './check-docs-tables.mjs';

const row = (cell) => `| a | ${cell} |`;
const table = (cell) => ['| h | h |', '| --- | --- |', row(cell)].join('\n');

test('a cell within the limit is not a finding', () => {
  assert.deepEqual(overlongTableLines(table('x'.repeat(MAX_LINE))), []);
});

test('a cell one character over the limit is a finding, with line and column', () => {
  const findings = overlongTableLines(table('x'.repeat(MAX_LINE + 1)));
  assert.equal(findings.length, 1);
  assert.deepEqual(
    { line: findings[0].line, column: findings[0].column, width: findings[0].width },
    { line: 3, column: 2, width: MAX_LINE + 1 },
  );
});

test('<br> segments are measured individually, not as one cell', () => {
  const half = 'x'.repeat(MAX_LINE);
  assert.deepEqual(overlongTableLines(table(`${half}<br>${half}`)), []);
  assert.equal(overlongTableLines(table(`${half}<br>${half}x`)).length, 1);
});

test('<br/> and <BR /> split the same way', () => {
  const half = 'x'.repeat(MAX_LINE);
  assert.deepEqual(overlongTableLines(table(`${half}<br/>${half}`)), []);
  assert.deepEqual(overlongTableLines(table(`${half}<BR />${half}`)), []);
});

test('markdown decoration does not count towards the visible width', () => {
  const text = 'x'.repeat(MAX_LINE);
  assert.deepEqual(overlongTableLines(table(`\`${text}\``)), []);
  assert.deepEqual(overlongTableLines(table(`**${text}**`)), []);
  assert.deepEqual(overlongTableLines(table(`[${text}](https://example.com/a/very/long/url)`)), []);
  assert.deepEqual(overlongTableLines(table(`<kbd>${text}</kbd>`)), []);
  assert.deepEqual(overlongTableLines(table(`${'x'.repeat(MAX_LINE)}&nbsp;`)), []);
});

test('an escaped pipe stays inside its cell rather than starting a new one', () => {
  const findings = overlongTableLines(table(`a \\| b ${'x'.repeat(MAX_LINE)}`));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].column, 2);
});

test('the separator row is never measured', () => {
  const wide = `| ${'-'.repeat(MAX_LINE + 10)} | --- |`;
  assert.deepEqual(overlongTableLines(['| h | h |', wide].join('\n')), []);
});

test('a table-shaped line inside a fenced block is ignored', () => {
  const markdown = ['```', table('x'.repeat(MAX_LINE + 50)), '```'].join('\n');
  assert.deepEqual(overlongTableLines(markdown), []);
});

test('a table after a closed fence is measured again', () => {
  const markdown = ['```', '| ignored |', '```', table('x'.repeat(MAX_LINE + 1))].join('\n');
  assert.equal(overlongTableLines(markdown).length, 1);
});

test('a non-table line is never measured', () => {
  assert.deepEqual(overlongTableLines('x'.repeat(MAX_LINE + 100)), []);
});

test('the limit is configurable, which is how the 72/120 measurement was taken', () => {
  assert.equal(overlongTableLines(table('x'.repeat(80)), 72).length, 1);
  assert.deepEqual(overlongTableLines(table('x'.repeat(80)), 120), []);
});

test('a finding formats to a file:line with the column, the width and the fix', () => {
  const [line] = formatFindings('docs/x.md', overlongTableLines(table('x'.repeat(MAX_LINE + 1))));
  assert.match(line, /^docs\/x\.md:3: table cell \(column 2\)/);
  assert.match(line, new RegExp(`${MAX_LINE + 1}-character line, limit ${MAX_LINE}`));
  assert.match(line, /break it with <br>/);
});

test('the doc set covers the published docs and excludes the agent plans', () => {
  assert.ok(DOC_GLOBS.includes('README.md'));
  assert.ok(DOC_GLOBS.includes('docs/**/*.md'));
  assert.deepEqual(DOC_EXCLUDES, ['docs/superpowers/']);
});

// M3: the table check used to toggle a boolean on any ```-prefixed line, so a
// tilde fence was invisible and a four-backtick block containing a three-
// backtick line desynced the scanner - measuring code as a table, then skipping
// the rest of the file. Both checks now share fencedBlocks().
test('a tilde-fenced block is skipped like a backtick-fenced one', () => {
  const markdown = ['~~~', table('x'.repeat(MAX_LINE + 50)), '~~~'].join('\n');
  assert.deepEqual(overlongTableLines(markdown), []);
});

test('a three-backtick line inside a four-backtick fence does not desync the scan', () => {
  const markdown = [
    '````markdown',
    table('x'.repeat(MAX_LINE + 50)), // inside the outer fence: not measured
    '```',
    table('y'.repeat(MAX_LINE + 50)), // still inside it
    '````',
    table('z'.repeat(MAX_LINE + 1)), // after it: measured
  ].join('\n');
  const findings = overlongTableLines(markdown);
  assert.equal(findings.length, 1);
  assert.match(findings[0].text, /^z+$/);
});

test('an unclosed fence swallows the rest of the file rather than half of it', () => {
  const markdown = ['```', table('x'.repeat(MAX_LINE + 50))].join('\n');
  assert.deepEqual(overlongTableLines(markdown), []);
});

test('fencedBlocks reports the info string, the delimiters and whether it closed', () => {
  const [block] = fencedBlocks(['```ts title=x', 'const a = 1;', '```']);
  assert.deepEqual(
    { info: block.info, start: block.start, end: block.end, closed: block.closed },
    { info: 'ts', start: 0, end: 2, closed: true },
  );
  assert.deepEqual(block.body, ['const a = 1;']);
});

test('fencedBlocks reports an unclosed fence as running to the end of the file', () => {
  const [block] = fencedBlocks(['```ts', 'const a = 1;']);
  assert.deepEqual({ end: block.end, closed: block.closed }, { end: 2, closed: false });
});
