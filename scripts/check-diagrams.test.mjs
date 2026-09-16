import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  BROWSER_PATHS,
  checkBlock,
  cleanOutput,
  extractMermaidBlocks,
  filesWithMermaid,
  findBrowser,
  formatParseError,
  MERMAID_CLI,
  PROBE_DIAGRAM,
  probeToolchain,
  writePuppeteerConfig,
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

test('the probe renders a diagram this module owns, never one from the docs', () => {
  const seen = [];
  probeToolchain((code) => {
    seen.push(code);
    return { status: 0, stderr: '' };
  });
  assert.deepEqual(seen, [PROBE_DIAGRAM]);
  assert.match(PROBE_DIAGRAM, /^graph TD;/);
});

test('a toolchain that renders the known-good diagram is available', () => {
  assert.deepEqual(
    probeToolchain(() => ({ status: 0, stderr: '' })),
    { available: true },
  );
});

test('a toolchain that cannot render the known-good diagram is unavailable', () => {
  for (const stderr of [
    'Could not find Chrome (ver. 131). This can occur if either',
    'Error: Failed to launch the browser process!',
    'npm error code ENOTFOUND',
    'request to https://registry.npmjs.org/... failed, reason: getaddrinfo EAI_AGAIN',
    'could not run npx: spawnSync npx ENOENT',
  ]) {
    assert.deepEqual(
      probeToolchain(() => ({ status: 1, stderr })),
      { available: false, stderr },
    );
  }
});

// The regression that made this rewrite necessary: mmdc echoes the diagram
// source back in its parse errors, so the old stderr sniff let a broken diagram
// whose text mentioned "network" (or a timeout, or a missing command) classify
// itself as an environment problem and switch the gate off. Availability is now
// decided by the probe above, which the docs cannot reach.
test('a broken diagram whose text mentions the network is a parse failure, not a skip', () => {
  const stderr =
    'UnknownDiagramError: No diagram type detected matching given configuration ' +
    'for text: not a diagram but it mentions the network layer';
  const result = checkBlock('docs/architecture.md', { line: 3, code: 'x' }, () => ({
    status: 1,
    stderr,
  }));
  assert.equal(result.ok, undefined);
  assert.match(result.error, /^docs\/architecture\.md:3: mermaid block does not parse —/);
});

test('no word in a diagram can make checkBlock report anything but a parse failure', () => {
  for (const word of [
    'network',
    'timeout',
    'ETIMEDOUT',
    'command not found',
    'Could not find Chrome',
    'npm error',
    'registry.npmjs.org',
    'ECONNREFUSED',
  ]) {
    const result = checkBlock('a.md', { line: 1, code: word }, () => ({
      status: 1,
      stderr: `Parse error ... for text: ${word}`,
    }));
    assert.ok(result.error, `"${word}" should still be a parse failure`);
  }
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

test('cleanOutput drops npx config chatter and keeps the diagnosis', () => {
  assert.equal(
    cleanOutput('npm warn Unknown project config "auto-install-peers".\nParse error on line 1'),
    'Parse error on line 1',
  );
  assert.equal(cleanOutput('npm notice a new version\n\nFailed to launch'), 'Failed to launch');
  assert.equal(cleanOutput(''), '');
  assert.equal(cleanOutput(undefined), '');
});

test('cleanOutput keeps at most the requested number of lines', () => {
  assert.equal(cleanOutput('a\nb\nc\nd\ne'), 'a b c d');
  assert.equal(cleanOutput('a\nb\nc', 2), 'a b');
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

test('the browser search prefers the first path that exists', () => {
  assert.equal(
    findBrowser(['/nowhere/chrome', '/usr/bin/chromium', '/usr/bin/google-chrome'], (p) =>
      p.startsWith('/usr/bin'),
    ),
    '/usr/bin/chromium',
  );
});

test('the browser search skips unset environment entries rather than crashing', () => {
  assert.equal(
    findBrowser([undefined, '', '/usr/bin/google-chrome'], () => true),
    '/usr/bin/google-chrome',
  );
});

test('no browser anywhere yields undefined, not a bogus path', () => {
  assert.equal(
    findBrowser(BROWSER_PATHS, () => false),
    undefined,
  );
});

test('the puppeteer config names the browser found and always disarms the sandbox', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'check-diagrams-test-'));
  try {
    const withBrowser = JSON.parse(
      readFileSync(writePuppeteerConfig(dir, '/usr/bin/chromium'), 'utf8'),
    );
    assert.equal(withBrowser.executablePath, '/usr/bin/chromium');
    assert.deepEqual(withBrowser.args, ['--no-sandbox', '--disable-dev-shm-usage']);

    // Without one, puppeteer must be left to its own download rather than
    // pointed at a path that does not exist.
    const without = JSON.parse(readFileSync(writePuppeteerConfig(dir, undefined), 'utf8'));
    assert.equal('executablePath' in without, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
