import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import {
  BadgeError,
  COLORS,
  colorFor,
  coverageFrom,
  escapeXml,
  formatPercent,
  PLACEHOLDERS,
  parseStatus,
  renderBadgeJson,
  renderBadgeSvg,
  STATUS_RESULTS,
  textWidth,
} from './badge.mjs';
import { argValue, writeCoverageBadge } from './coverage-badge.mjs';
import { coverageModeFor, renderBadges } from './render.mjs';
import { writeStatusBadge } from './status-badge.mjs';

const tmp = mkdtempSync(path.join(tmpdir(), 'badge-render-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

/** A fresh output directory per case, so no test reads another's leftovers. */
let n = 0;
const outDir = () => path.join(tmp, `out-${++n}`);

const summaryWith = (covered, total) => ({
  total: { lines: { covered, total, skipped: 0, pct: (covered / total) * 100 } },
});

describe('colorFor', () => {
  test('walks the thresholds, boundaries included', () => {
    assert.equal(colorFor(100), 'brightgreen');
    assert.equal(colorFor(99.9), 'green');
    assert.equal(colorFor(90), 'green');
    assert.equal(colorFor(89.9), 'yellowgreen');
    assert.equal(colorFor(80), 'yellowgreen');
    assert.equal(colorFor(79.9), 'yellow');
    assert.equal(colorFor(70), 'yellow');
    assert.equal(colorFor(69.9), 'red');
    assert.equal(colorFor(0), 'red');
  });

  test('every colour it can return is a colour renderBadgeSvg knows', () => {
    for (const pct of [0, 70, 80, 90, 100]) assert.ok(COLORS[colorFor(pct)]);
  });
});

describe('formatPercent', () => {
  test('drops a trailing .0 but keeps a real decimal', () => {
    assert.equal(formatPercent(100), '100%');
    assert.equal(formatPercent(98.45), '98.5%');
    assert.equal(formatPercent(0), '0%');
    assert.equal(formatPercent(66.666), '66.7%');
  });
});

describe('STATUS_RESULTS', () => {
  test('covers every result GitHub can hand a dependent job', () => {
    assert.deepEqual(Object.keys(STATUS_RESULTS).sort(), [
      'cancelled',
      'failure',
      'skipped',
      'success',
    ]);
  });

  test('only success is green', () => {
    for (const [result, { color }] of Object.entries(STATUS_RESULTS)) {
      assert.equal(color === 'brightgreen', result === 'success');
      assert.ok(COLORS[color], `${result} uses an unknown colour`);
    }
  });
});

describe('parseStatus', () => {
  test('is null without --status', () => {
    assert.equal(parseStatus([]), null);
    assert.equal(parseStatus(['--out', 'x']), null);
  });

  test('accepts each placeholder', () => {
    for (const status of Object.keys(PLACEHOLDERS)) {
      assert.equal(parseStatus(['--status', status]), status);
    }
  });

  test('rejects anything else rather than rendering a green badge', () => {
    assert.throws(() => parseStatus(['--status', 'passing']), BadgeError);
    assert.throws(() => parseStatus(['--status']), BadgeError);
  });
});

describe('coverageFrom', () => {
  test('reports line coverage with its colour and detail', () => {
    assert.deepEqual(coverageFrom(summaryWith(348, 348)), {
      message: '100%',
      color: 'brightgreen',
      detail: '348/348 lines',
    });
    assert.deepEqual(coverageFrom(summaryWith(75, 100)), {
      message: '75%',
      color: 'yellow',
      detail: '75/100 lines',
    });
  });

  test('a summary with no total.lines is an error, not a 0% badge', () => {
    assert.throws(() => coverageFrom({}), BadgeError);
    assert.throws(() => coverageFrom({ total: {} }), BadgeError);
    assert.throws(() => coverageFrom({ total: { lines: { covered: 1 } } }), BadgeError);
  });

  test('zero measured lines refuses to render', () => {
    assert.throws(() => coverageFrom(summaryWith(0, 0)), BadgeError);
  });
});

describe('textWidth', () => {
  test('is zero for the empty string and grows with the text', () => {
    assert.equal(textWidth(''), 0);
    assert.ok(textWidth('Coverage') > textWidth('Unit'));
    assert.ok(textWidth('W') > textWidth('i'));
  });

  test('an unlisted glyph still gets a width', () => {
    assert.ok(textWidth('é') > 0);
  });
});

describe('escapeXml', () => {
  test('escapes every character that could close a tag or an attribute', () => {
    assert.equal(escapeXml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&apos;');
  });
});

describe('renderBadgeSvg', () => {
  const svg = renderBadgeSvg({ label: 'Coverage', message: '100%', color: 'brightgreen' });

  test('is a well-formed, self-contained flat badge', () => {
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /<\/svg>\n$/);
    assert.ok(!svg.includes('<image'), 'a badge must not pull in an external resource');
    assert.equal(svg.split('<text').length - 1, 4, 'two halves, each with its shadow');
  });

  test('carries the colour and an accessible label', () => {
    assert.ok(svg.includes(`fill="${COLORS.brightgreen}"`));
    assert.ok(svg.includes('aria-label="Coverage: 100%"'));
    assert.ok(svg.includes('<title>Coverage: 100%</title>'));
  });

  test('the two boxes tile the full width exactly', () => {
    const width = Number(svg.match(/<svg[^>]*width="(\d+)"/)[1]);
    const label = Number(svg.match(/<rect width="(\d+)" height="20" fill="#555"\/>/)[1]);
    const message = Number(svg.match(/<rect x="\d+" width="(\d+)"/)[1]);
    assert.equal(label + message, width);
    assert.equal(Number(svg.match(/<rect x="(\d+)" width="\d+"/)[1]), label);
  });

  // The centring arithmetic is written asymmetrically (`labelBox * 5` against
  // `(labelBox + messageBox / 2) * 10`), which makes it the likeliest place for
  // a future typo - and a typo there is invisible to the tiling assertion
  // above. This pins both halves to their own box.
  test('each half is centred in its own box and pinned to that width', () => {
    const texts = [
      ...svg.matchAll(/<text x="(\d+)" y="140" transform="scale\(\.1\)" textLength="(\d+)"/g),
    ];
    assert.equal(texts.length, 2);
    // The two coloured halves, not the clipPath rect that spans the whole badge.
    const label = Number(svg.match(/<rect width="(\d+)" height="20" fill="#555"\/>/)[1]);
    const message = Number(svg.match(/<rect x="\d+" width="(\d+)" height="20" fill="#/)[1]);
    assert.equal(Number(texts[0][1]), (label * 10) / 2);
    assert.equal(Number(texts[0][2]), (label - 10) * 10);
    assert.equal(Number(texts[1][1]), (label + message / 2) * 10);
    assert.equal(Number(texts[1][2]), (message - 10) * 10);
  });

  // A badge with a CSS width should scale, not stretch its viewport.
  test('carries a viewBox matching its declared size', () => {
    const width = svg.match(/<svg[^>]*width="(\d+)"/)[1];
    assert.ok(svg.includes(`viewBox="0 0 ${width} 20"`));
  });

  test('a longer message makes a wider badge', () => {
    const short = renderBadgeSvg({ label: 'E2E', message: 'passing', color: 'brightgreen' });
    const long = renderBadgeSvg({ label: 'E2E', message: 'cancelled', color: 'lightgrey' });
    const width = (s) => Number(s.match(/<svg[^>]*width="(\d+)"/)[1]);
    assert.ok(width(long) > width(short));
  });

  test('markup in a label cannot escape into the SVG', () => {
    const evil = renderBadgeSvg({ label: '</text><script/>', message: 'x', color: 'red' });
    assert.ok(!evil.includes('<script'));
    assert.ok(evil.includes('&lt;/text&gt;'));
  });

  test('an unknown colour is an error, not an unfilled box', () => {
    assert.throws(
      () => renderBadgeSvg({ label: 'a', message: 'b', color: 'chartreuse' }),
      BadgeError,
    );
  });
});

describe('renderBadgeJson', () => {
  test('is the shields endpoint shape with a trailing newline', () => {
    const json = renderBadgeJson({ label: 'Unit', message: 'passing', color: 'brightgreen' });
    assert.match(json, /\n$/);
    assert.deepEqual(JSON.parse(json), {
      schemaVersion: 1,
      label: 'Unit',
      message: 'passing',
      color: 'brightgreen',
    });
  });
});

describe('argValue', () => {
  test('reads a flag value and falls back when it is absent or dangling', () => {
    assert.equal(argValue(['--out', 'dir'], '--out', 'x'), 'dir');
    assert.equal(argValue([], '--out', 'x'), 'x');
    assert.equal(argValue(['--out'], '--out', 'x'), 'x');
  });
});

describe('writeCoverageBadge', () => {
  test('measures a real summary and writes both files', () => {
    const dir = outDir();
    const summaryFile = path.join(tmp, 'summary.json');
    writeFileSync(summaryFile, JSON.stringify(summaryWith(9, 10)));
    const result = writeCoverageBadge({ outDir: dir, summaryFile });
    assert.equal(result.message, '90%');
    assert.ok(readFileSync(path.join(dir, 'coverage.svg'), 'utf8').includes('90%'));
    assert.equal(JSON.parse(readFileSync(path.join(dir, 'coverage.json'), 'utf8')).message, '90%');
  });

  test('a placeholder reads no summary at all', () => {
    const dir = outDir();
    const result = writeCoverageBadge({
      outDir: dir,
      summaryFile: path.join(tmp, 'does-not-exist.json'),
      status: 'failing',
    });
    assert.equal(result.message, 'failing');
    assert.ok(readFileSync(path.join(dir, 'coverage.svg'), 'utf8').includes(COLORS.red));
  });

  test('a missing summary without a placeholder is an error', () => {
    assert.throws(
      () => writeCoverageBadge({ outDir: outDir(), summaryFile: path.join(tmp, 'nope.json') }),
      BadgeError,
    );
  });
});

describe('writeStatusBadge', () => {
  test('renders each known result', () => {
    for (const [result, expected] of Object.entries(STATUS_RESULTS)) {
      const dir = outDir();
      const badge = writeStatusBadge({ outDir: dir, name: 'unit', label: 'Unit', result });
      assert.equal(badge.message, expected.message);
      assert.ok(readFileSync(path.join(dir, 'unit.svg'), 'utf8').includes(expected.message));
    }
  });

  test('an unknown result is an error', () => {
    assert.throws(
      () => writeStatusBadge({ outDir: outDir(), name: 'unit', label: 'Unit', result: 'green' }),
      BadgeError,
    );
  });

  test('a name that is not a file-safe slug is an error', () => {
    for (const name of ['../evil', 'Unit', 'unit.svg', '']) {
      assert.throws(
        () => writeStatusBadge({ outDir: outDir(), name, label: 'Unit', result: 'success' }),
        BadgeError,
      );
    }
  });

  test('a missing label is an error', () => {
    assert.throws(
      () => writeStatusBadge({ outDir: outDir(), name: 'unit', label: '', result: 'success' }),
      BadgeError,
    );
  });
});

describe('coverageModeFor', () => {
  test('only a failure writes the red placeholder', () => {
    assert.equal(coverageModeFor('success'), 'measure');
    assert.equal(coverageModeFor('failure'), 'failing');
    for (const result of ['skipped', 'cancelled', '']) {
      assert.equal(coverageModeFor(result), 'skip');
    }
  });
});

describe('renderBadges', () => {
  const summaryFile = path.join(tmp, 'render-summary.json');
  writeFileSync(summaryFile, JSON.stringify(summaryWith(348, 348)));

  test('a green run renders coverage plus both statuses', () => {
    const dir = outDir();
    const written = renderBadges({
      BADGE_OUT_DIR: dir,
      BADGE_COVERAGE_SUMMARY: summaryFile,
      BADGE_UNIT: 'success',
      BADGE_E2E: 'success',
    });
    assert.deepEqual(written, ['coverage.svg', 'unit.svg', 'e2e.svg']);
    assert.ok(readFileSync(path.join(dir, 'coverage.svg'), 'utf8').includes('100%'));
    assert.ok(readFileSync(path.join(dir, 'e2e.svg'), 'utf8').includes('passing'));
  });

  test('a failed Unit renders the red placeholder without reading the summary', () => {
    const dir = outDir();
    renderBadges({
      BADGE_OUT_DIR: dir,
      BADGE_COVERAGE_SUMMARY: path.join(tmp, 'absent.json'),
      BADGE_UNIT: 'failure',
      BADGE_E2E: 'skipped',
    });
    const svg = readFileSync(path.join(dir, 'coverage.svg'), 'utf8');
    assert.ok(svg.includes('failing'));
    assert.ok(svg.includes(COLORS.red));
    assert.ok(readFileSync(path.join(dir, 'unit.svg'), 'utf8').includes('failing'));
  });

  test('a skipped Unit writes no coverage badge, so publishing leaves it alone', () => {
    const dir = outDir();
    const written = renderBadges({
      BADGE_OUT_DIR: dir,
      BADGE_UNIT: 'skipped',
      BADGE_E2E: 'skipped',
    });
    assert.deepEqual(written, ['unit.svg', 'e2e.svg']);
    assert.throws(() => readFileSync(path.join(dir, 'coverage.svg')));
  });

  test('BADGE_COVERAGE overrides the derived mode', () => {
    const dir = outDir();
    renderBadges({
      BADGE_OUT_DIR: dir,
      BADGE_COVERAGE: 'pending',
      BADGE_UNIT: 'skipped',
      BADGE_E2E: 'skipped',
    });
    assert.ok(readFileSync(path.join(dir, 'coverage.svg'), 'utf8').includes('pending'));
  });

  test('labels are overridable', () => {
    const dir = outDir();
    renderBadges({
      BADGE_OUT_DIR: dir,
      BADGE_UNIT: 'success',
      BADGE_E2E: 'success',
      BADGE_COVERAGE: 'skip',
      BADGE_UNIT_LABEL: 'Tests',
      BADGE_E2E_LABEL: 'Device',
    });
    assert.ok(readFileSync(path.join(dir, 'unit.svg'), 'utf8').includes('Tests'));
    assert.ok(readFileSync(path.join(dir, 'e2e.svg'), 'utf8').includes('Device'));
  });

  test('an unset job result is an error rather than a green badge', () => {
    assert.throws(
      () => renderBadges({ BADGE_OUT_DIR: outDir(), BADGE_COVERAGE: 'skip' }),
      BadgeError,
    );
  });
});
