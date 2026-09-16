import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkBlock,
  classifyFailure,
  extractMermaidBlocks,
  filesWithMermaid,
  formatParseError,
  MERMAID_CLI,
} from './check-diagrams.mjs';

const doc = (...lines) => lines.join('\n');

test('extracts a mermaid block with the line of its opening fence', () => {
  const markdown = doc('# Title', '', '```mermaid', 'graph TD;', '  A-->B;', '```', 'after');
  assert.deepEqual(extractMermaidBlocks(markdown), [{ line: 3, code: 'graph TD;\n  A-->B;' }]);
});

test('ignores fences of other languages', () => {
  const markdown = doc('```ts', 'const a = 1;', '```', '```', 'plain', '```');
  assert.deepEqual(extractMermaidBlocks(markdown), []);
});

test('finds every block in a document', () => {
  const markdown = doc('```mermaid', 'a', '```', 'text', '```mermaid', 'b', '```');
  assert.deepEqual(
    extractMermaidBlocks(markdown).map((b) => [b.line, b.code]),
    [
      [1, 'a'],
      [5, 'b'],
    ],
  );
});

test('an indented block keeps its own indentation, not the list item indent', () => {
  const markdown = doc('- item:', '', '  ```mermaid', '  graph TD;', '    A-->B;', '  ```');
  assert.deepEqual(extractMermaidBlocks(markdown), [{ line: 3, code: 'graph TD;\n  A-->B;' }]);
});

test('a mermaid fence nested inside a longer fence is content, not a diagram', () => {
  const markdown = doc('````markdown', '```mermaid', 'graph TD;', '```', '````');
  assert.deepEqual(extractMermaidBlocks(markdown), []);
});

test('a longer mermaid fence closes only on a fence at least as long', () => {
  const markdown = doc('````mermaid', 'graph TD;', '```', 'A-->B;', '````');
  assert.deepEqual(extractMermaidBlocks(markdown), [{ line: 1, code: 'graph TD;\n```\nA-->B;' }]);
});

test('a tilde fence is a fence too, and does not close a backtick one', () => {
  assert.deepEqual(extractMermaidBlocks(doc('~~~mermaid', 'graph TD;', '~~~')), [
    { line: 1, code: 'graph TD;' },
  ]);
  assert.deepEqual(extractMermaidBlocks(doc('```mermaid', 'a', '~~~', 'b', '```')), [
    { line: 1, code: 'a\n~~~\nb' },
  ]);
});

test('a fence with an info string beyond the language still counts', () => {
  assert.equal(extractMermaidBlocks(doc('```mermaid title=x', 'a', '```')).length, 1);
});

test('an unclosed fence yields no block rather than a truncated one', () => {
  assert.deepEqual(extractMermaidBlocks(doc('```mermaid', 'graph TD;')), []);
});

test('filesWithMermaid keeps only documents carrying a block', () => {
  const contents = {
    'a.md': '```mermaid\ngraph TD;\n```',
    'b.md': 'no diagrams here',
    'c.md': '```ts\nconst a = 1;\n```',
  };
  assert.deepEqual(
    filesWithMermaid(Object.keys(contents), (f) => contents[f]),
    ['a.md'],
  );
});

test('a missing CLI or browser is an unavailable environment, not a bad diagram', () => {
  for (const stderr of [
    'Could not find Chrome (ver. 131). This can occur if either',
    'Error: Failed to launch the browser process!',
    'npm error code ENOTFOUND',
    'request to https://registry.npmjs.org/... failed, reason: getaddrinfo EAI_AGAIN',
    'command not found: npx',
  ]) {
    assert.equal(classifyFailure(stderr), 'unavailable', stderr);
  }
});

test('a parser complaint is a parse failure', () => {
  assert.equal(classifyFailure('Parse error on line 2:\n  grph TD;\n  ^'), 'parse');
  assert.equal(classifyFailure(''), 'parse');
  assert.equal(classifyFailure(undefined), 'parse');
});

test('a parse error names the file and the fence line', () => {
  const line = formatParseError('docs/architecture.md', { line: 42 }, 'Parse error on line 2:\n^');
  assert.equal(
    line,
    'docs/architecture.md:42: mermaid block does not parse — Parse error on line 2: ^',
  );
});

test('a parse error with no parser output still says something', () => {
  assert.match(formatParseError('a.md', { line: 1 }, ''), /no parser output/);
});

test('checkBlock passes a block the stubbed CLI accepts', () => {
  assert.deepEqual(
    checkBlock('a.md', { line: 1, code: 'graph TD;' }, () => ({ status: 0, stderr: '' })),
    { ok: true },
  );
});

test('checkBlock reports a parse failure as an error line', () => {
  const result = checkBlock('a.md', { line: 7, code: 'grph TD;' }, () => ({
    status: 1,
    stderr: 'Parse error on line 1',
  }));
  assert.equal(result.error, 'a.md:7: mermaid block does not parse — Parse error on line 1');
});

test('checkBlock reports an unrunnable CLI as unavailable rather than an error', () => {
  const result = checkBlock('a.md', { line: 1, code: 'graph TD;' }, () => ({
    status: 1,
    stderr: 'npm error code ENOTFOUND',
  }));
  assert.equal(result.unavailable, true);
  assert.equal(result.error, undefined);
});

test('checkBlock hands the CLI the block source unchanged', () => {
  const seen = [];
  checkBlock('a.md', { line: 1, code: 'graph TD;\n  A-->B;' }, (code) => {
    seen.push(code);
    return { status: 0, stderr: '' };
  });
  assert.deepEqual(seen, ['graph TD;\n  A-->B;']);
});

test('the mermaid CLI is pinned to an exact version', () => {
  assert.match(MERMAID_CLI, /^@mermaid-js\/mermaid-cli@\d+\.\d+\.\d+$/);
});

test('npx config noise is dropped from a parse error', () => {
  const line = formatParseError(
    'a.md',
    { line: 1 },
    'npm warn Unknown project config\nParse error',
  );
  assert.equal(line, 'a.md:1: mermaid block does not parse — Parse error');
});
