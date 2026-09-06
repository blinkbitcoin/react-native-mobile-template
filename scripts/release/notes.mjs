#!/usr/bin/env node
// Store release notes for a build, from a release-please body or from
// conventional commit subjects.
//
// The deterministic renderer is the product: it always runs, always produces
// something a store will accept, and is what the optional LLM pass falls back
// to. Nothing here talks to a store -- the lanes read `store-notes.json` and
// `notes-store.txt` (see fastlane/lanes/shared.rb `store_notes`).
//
//   node scripts/release/notes.mjs --from-body RELEASE_BODY.md --out dist/
//   node scripts/release/notes.mjs --from-commits v1.2.0..HEAD --out -
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rewriteNotes } from './llm/index.mjs';

/** Store caps, in characters -- which is how both stores count. */
export const STORE_LIMITS = { testflight: 4000, play: 500, appstore: 4000 };
/** Must stay byte-identical to STORE_NOTES_SUFFIX in fastlane/lanes/shared.rb. */
export const TRUNCATION_SUFFIX = ' [+more on GitHub]';
/** Groups shown to users, in the order they are rendered. */
const USER_GROUPS = ['New', 'Improved', 'Fixed'];
/** Everything else is changelog-only: real, but not worth a user's attention. */
const OTHER_GROUP = 'Other';
const EMPTY_NOTES = 'Bug fixes and improvements.';
const BULLET = '• ';
/** Opt-in marker that lets a refactor reach users; stripped from the output. */
const USER_VISIBLE_MARKER = /\s*\[user-visible\]\s*/i;

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const CONTEXT_FILE = path.join(repoRoot, 'fastlane', 'release-notes-context.md');
const IOS_METADATA_DIR = path.join(repoRoot, 'fastlane', 'metadata', 'ios');

const TYPE_GROUPS = { feat: 'New', fix: 'Fixed', perf: 'Improved', refactor: 'Improved' };
const SECTION_GROUPS = {
  features: 'New',
  'bug fixes': 'Fixed',
  'performance improvements': 'Improved',
};

// ---------- text hygiene ----------

/**
 * Strips every trace of the repository from a changelog line: markdown, links,
 * PR references, commit hashes and the conventional-commit scope. What is left
 * is a sentence a person can read on a store page.
 */
export function cleanText(raw) {
  let text = String(raw).trim();
  text = text.replace(/^[*-]\s+/, '');
  // `**scope:**` (release-please) before generic bold stripping, so that the
  // scope is removed rather than unwrapped into the sentence.
  text = text.replace(/^\*\*[^*]+:\*\*\s*/, '');
  // `[label](url)` -> `label`, then bare urls.
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replace(/https?:\/\/\S+/g, '');
  // Trailing `(#128)` / `(9f2c1ab)` decorations, then any stray reference.
  text = text.replace(/\s*\((?:#\d+|[0-9a-f]{7,40})\)/gi, '');
  text = text.replace(/\s*#\d+/g, '');
  text = text.replace(/\s*\b(?=[0-9a-f]{7,40}\b)[0-9a-f]*\d[0-9a-f]*\b/gi, '');
  text = text.replace(/[*_`]/g, '');
  text = text.replace(USER_VISIBLE_MARKER, ' ');
  text = text
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
  text = text.replace(/[\s(,;:-]+$/, '').trim();
  if (!text) return '';
  const sentence = text[0].toUpperCase() + text.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/**
 * `text` cut to `limit` characters at a word boundary, with a pointer to the
 * full changelog. Mirrors `store_notes` in fastlane/lanes/shared.rb: a word
 * boundary is only honoured when it keeps more than half the window, the
 * suffix is dropped when the limit cannot hold it, and the result is never
 * longer than `limit`.
 */
export function limitText(text, limit) {
  const value = String(text).trim();
  if (limit <= 0) return '';
  if (value.length <= limit) return value;
  if (limit <= TRUNCATION_SUFFIX.length) return value.slice(0, limit).trimEnd();

  const window = value.slice(0, limit - TRUNCATION_SUFFIX.length);
  let boundary = -1;
  for (let i = window.length - 1; i >= 0; i -= 1) {
    if (/\s/.test(window[i])) {
      boundary = i;
      break;
    }
  }
  const cut = boundary > window.length / 2 ? window.slice(0, boundary) : window;
  return `${cut.trimEnd()}${TRUNCATION_SUFFIX}`;
}

// ---------- parsing ----------

/** Release-please markdown body -> items. Unknown `###` sections become Other. */
export function parseBody(markdown) {
  const items = [];
  let group = OTHER_GROUP;
  for (const line of String(markdown).split('\n')) {
    const heading = /^#{2,4}\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const name = heading[1].replace(/[*_`]/g, '').trim().toLowerCase();
      group = SECTION_GROUPS[name] ?? OTHER_GROUP;
      continue;
    }
    if (!/^\s*[*-]\s+\S/.test(line)) continue;
    const userVisible = USER_VISIBLE_MARKER.test(line);
    const text = cleanText(line);
    if (!text) continue;
    items.push({ group, text, userVisible });
  }
  return items;
}

/** Conventional commit subjects -> items. */
export function parseCommits(subjects) {
  const items = [];
  for (const subject of subjects) {
    const line = String(subject).trim();
    if (!line) continue;
    const match = /^([a-z]+)(\([^)]*\))?(!)?:\s*(.+)$/i.exec(line);
    if (!match) continue;
    const [, type, , breaking, rest] = match;
    const userVisible = USER_VISIBLE_MARKER.test(rest);
    const group = TYPE_GROUPS[type.toLowerCase()] ?? OTHER_GROUP;
    const text = cleanText(rest);
    if (!text) continue;
    // A `refactor` is invisible to users unless its author says otherwise, so
    // it only reaches the notes with the marker; everything else keeps its
    // group. `chore`, `docs`, `ci`, ... fall through to Other by construction.
    const resolved = type.toLowerCase() === 'refactor' && !userVisible ? OTHER_GROUP : group;
    items.push({ group: resolved, text, userVisible: userVisible || Boolean(breaking) });
  }
  return items;
}

/** `git log --format=%s RANGE` for the repo, defaulting to "since the last tag". */
export function commitSubjects(range, cwd = repoRoot) {
  // stderr is piped, not inherited: a repo with no tags is an expected state
  // here, and git's "No names found" would otherwise land in the output.
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let resolved = range;
  if (!resolved) {
    let lastTag = '';
    try {
      lastTag = git('describe', '--tags', '--abbrev=0', '--match', 'v*', 'HEAD');
    } catch {
      lastTag = '';
    }
    resolved = lastTag ? `${lastTag}..HEAD` : 'HEAD';
  }
  const log = git('log', '--format=%s', resolved);
  return log ? log.split('\n') : [];
}

/** The `## Store notes` section of a release body, or '' when there is none. */
export function extractStoreSection(markdown) {
  const lines = String(markdown).split('\n');
  const start = lines.findIndex((line) => /^#{2,4}\s+store notes\s*$/i.test(line));
  if (start === -1) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,4}\s+\S/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
}

// ---------- rendering ----------

/** Grouped bullets, in plain text. Empty input gets one honest line. */
export function renderNotes(items) {
  const blocks = [];
  for (const group of USER_GROUPS) {
    const texts = items.filter((item) => item.group === group).map((item) => item.text);
    if (texts.length) blocks.push([group, ...texts.map((t) => `${BULLET}${t}`)].join('\n'));
  }
  return blocks.length ? blocks.join('\n\n') : EMPTY_NOTES;
}

/**
 * The compact, complete list -- including the work that never reaches the
 * user-facing groups. Deliberately denser than the prose it follows: it has to
 * survive Google Play's 500 characters alongside it.
 */
export function renderChangelog(items) {
  const lines = [];
  for (const group of [...USER_GROUPS, OTHER_GROUP]) {
    const texts = items.filter((item) => item.group === group).map((item) => item.text);
    if (texts.length) lines.push(`${group}: ${texts.join(' ')}`);
  }
  return lines.length ? ['Changelog', ...lines].join('\n') : '';
}

/** Locale directories under fastlane/metadata/ios (`review_information` is not one). */
export function discoverLocales(dir = IOS_METADATA_DIR) {
  if (!existsSync(dir)) return ['en-US'];
  const locales = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  return locales.length ? locales : ['en-US'];
}

/** `{locale: {testflight, play, appstore}}` from one text per locale. */
export function toStoreNotes(textByLocale) {
  const notes = {};
  for (const [locale, text] of Object.entries(textByLocale)) {
    notes[locale] = {
      testflight: limitText(text, STORE_LIMITS.testflight),
      play: limitText(text, STORE_LIMITS.play),
      appstore: limitText(text, STORE_LIMITS.appstore),
    };
  }
  return notes;
}

/**
 * The whole pipeline: items in, one text per locale out. `rewrite` is the LLM
 * pass; it returns null whenever it cannot be trusted, and this falls back to
 * the deterministic prose without saying anything else about it.
 */
export async function buildNotes({
  items,
  locales,
  verbatim = '',
  includeChangelog = false,
  provider,
  model,
  context,
  fetchImpl,
  rewrite = rewriteNotes,
}) {
  const prose = renderNotes(items);
  let byLocale = Object.fromEntries(locales.map((locale) => [locale, verbatim || prose]));

  if (!verbatim && provider && provider !== 'none') {
    const rewritten = await rewrite({ items, context, locales, provider, model, fetchImpl });
    if (rewritten) byLocale = rewritten;
  }

  if (includeChangelog) {
    const changelog = renderChangelog(items);
    if (changelog) {
      byLocale = Object.fromEntries(
        Object.entries(byLocale).map(([locale, text]) => [locale, `${text}\n\n${changelog}`]),
      );
    }
  }
  return byLocale;
}

// ---------- CLI ----------

export function parseArgs(argv) {
  const options = {
    fromBody: '',
    fromCommits: false,
    range: '',
    locales: [],
    out: '',
    includeChangelog: process.env.STORE_NOTES_INCLUDE_CHANGELOG === 'true',
    bodySection: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      return argv[i];
    };
    if (arg === '--from-body') options.fromBody = next();
    else if (arg === '--from-commits') {
      options.fromCommits = true;
      if (argv[i + 1] && !argv[i + 1].startsWith('--')) options.range = next();
    } else if (arg === '--locales') options.locales = next().split(',').filter(Boolean);
    else if (arg === '--out') options.out = next();
    else if (arg === '--include-changelog') options.includeChangelog = true;
    else if (arg === '--body-section') options.bodySection = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.fromBody && !options.fromCommits) {
    throw new Error('one of --from-body FILE or --from-commits [RANGE] is required');
  }
  return options;
}

export async function main(argv, { cwd = process.cwd() } = {}) {
  const options = parseArgs(argv);
  const locales = options.locales.length ? options.locales : discoverLocales();

  let items = [];
  let verbatim = '';
  if (options.fromBody) {
    const body = readFileSync(path.resolve(cwd, options.fromBody), 'utf8');
    items = parseBody(body);
    if (options.bodySection) verbatim = extractStoreSection(body);
  } else {
    items = parseCommits(commitSubjects(options.range));
  }

  const context = existsSync(CONTEXT_FILE) ? readFileSync(CONTEXT_FILE, 'utf8') : '';
  const byLocale = await buildNotes({
    items,
    locales,
    verbatim,
    includeChangelog: options.includeChangelog,
    provider: process.env.RELEASE_NOTES_LLM_PROVIDER,
    model: process.env.RELEASE_NOTES_LLM_MODEL,
    context,
  });
  const notes = toStoreNotes(byLocale);
  const primary = notes['en-US'] ? 'en-US' : locales[0];
  const json = `${JSON.stringify(notes, null, 2)}\n`;

  if (!options.out || options.out === '-') {
    process.stdout.write(json);
    return notes;
  }
  const outDir = path.resolve(cwd, options.out);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'store-notes.json'), json);
  writeFileSync(path.join(outDir, 'notes-store.txt'), `${notes[primary].testflight}\n`);
  console.error(`store notes written to ${outDir} (${locales.join(', ')})`);
  return notes;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(String(error.message ?? error));
    process.exit(1);
  });
}
