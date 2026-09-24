// The guard: no shell code in this repository changes a locale variable as a
// command prefix (`LC_ALL=C grep ...`). It hands the locale over with `env`
// instead (`env LC_ALL=C grep ...`).
//
// Why a rule and not a style preference: with the prefix, bash sets the
// variable for the one command and restores it afterwards, and each of those is
// a setlocale() call inside bash. On macOS a bash linked against gettext
// (Homebrew's, first on PATH wherever Homebrew is installed) routes that
// through libintl_setlocale, which asks CoreFoundation for the user's
// preferred languages. Inside `$(...)` or a pipeline that runs in a forked
// child, where CoreFoundation is not fork-safe, and the child dies with SIGSEGV
// now and then: status 139, reported by the caller as if the command had failed.
// That is how `grep failed with status 139` came to fail release verification
// intermittently on an unmodified checkout (scripts/release/lib/verify-common.sh,
// vc_grep). `env` sets the variable in the command's own process only, so bash
// never changes locale at all.
//
// The crash is timing-dependent (about one fresh bash in twenty), so a test
// that runs the command and waits for it is not a test. This one reads the
// source instead.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// A locale variable assigned on a line where another word follows it: the
// shape of a command prefix. A bare `LC_ALL=C` on its own line (or before a
// `;`) is not matched, and neither is anything inside a comment. The value is
// a bare word or one quoted word, so prose that merely mentions `LC_ALL=C` at
// the end of a quoted string ("... under LC_ALL=C" "next") is not a prefix.
const LOCALE_ASSIGNMENT_RE =
  /(?<![\w$-])(?:LC_[A-Z]+|LANG|LANGUAGE)=(?:"[^"\s]*"|'[^'\s]*'|[^\s;&|)"'`]*)[ \t]+(?=[^\s#;&|)])/g;

// What may legitimately stand in front of such an assignment: `env` hands the
// variable to a new process (the fix), and the declaration builtins set it in
// the current shell rather than for one command. Any further assignments
// between those words and the match are part of the same list.
const ALLOWED_HEAD_RE =
  /\b(?:env|export|local|declare|readonly|typeset)(?:[ \t]+-\S+)*(?:[ \t]+\w+=\S*)*[ \t]+$/;

/** Every locale-prefix assignment in `text`, as `<line number>: <line>`. */
function localePrefixes(text) {
  const found = [];
  text.split('\n').forEach((line, i) => {
    if (line.trimStart().startsWith('#')) return;
    for (const match of line.matchAll(LOCALE_ASSIGNMENT_RE)) {
      if (ALLOWED_HEAD_RE.test(line.slice(0, match.index))) continue;
      found.push(`${i + 1}: ${line.trim()}`);
      break;
    }
  });
  return found;
}

// Files a shell runs: scripts by extension or shebang, the Makefile's recipes,
// and the workflows' `run:` blocks (bash on the macOS runners too).
function isShell(file, text) {
  if (/\.(?:sh|bash)$/.test(file)) return true;
  if (path.basename(file) === 'Makefile') return true;
  if (/^\.github\/workflows\/.*\.ya?ml$/.test(file)) return true;
  return /^#!.*\b(?:ba|z|k|da)?sh\b/.test(text.slice(0, text.indexOf('\n') + 1));
}

for (const line of [
  'VC_GREP_OUTPUT="$(LC_ALL=C grep -aoE -e "$1" -- "$2" 2>"$err")" || rc=$?',
  '    LC_ALL=C grep -aqF -e "$value" -- "$1" || rc=$?',
  "elif ! printf '%s' \"$ID\" | LC_ALL=C grep -qE '^[0-9]+$'; then",
  'LANG=C sort -u list.txt',
  'LC_COLLATE=C LANG=C tr a-z A-Z',
  'FOO=1 LC_ALL=C sed -n p',
  'x=$(LANGUAGE=en git status)',
  '  run: LC_ALL=C make check',
  'LC_ALL="C" grep x',
  'out=$(LC_ALL=C REPO_ROOT="$TREE" "$CHECK" --platform ios 2>&1)',
]) {
  test(`the guard catches ${JSON.stringify(line)}`, () => {
    assert.equal(localePrefixes(line).length, 1, `missed ${line}`);
  });
}

for (const line of [
  'VC_GREP_OUTPUT="$(env LC_ALL=C grep -aoE -e "$1" -- "$2" 2>"$err")" || rc=$?',
  'env -i LC_ALL=C PATH="$PATH" sort',
  'export LC_ALL=C',
  'export LC_ALL=C LANG=C',
  'local LC_ALL=C',
  'LC_ALL=C',
  'LC_ALL=C; grep x',
  '# the prefix: LC_ALL=C grep, which crashes bash',
  'MY_LC_ALL=C grep x',
  'echo "$LC_ALL" grep',
  'check_not_contains "a name passes under LC_ALL=C" "name.txt" "$out"',
]) {
  test(`the guard allows ${JSON.stringify(line)}`, () => {
    assert.deepEqual(localePrefixes(line), []);
  });
}

test('the guard reads shell files and nothing else', () => {
  assert.ok(isShell('scripts/release/verify-ios.sh', ''));
  assert.ok(isShell('scripts/hooks/lib.bash', ''));
  assert.ok(isShell('Makefile', ''));
  assert.ok(isShell('.github/workflows/ci.yml', ''));
  assert.ok(isShell('scripts/hooks/pre-commit', '#!/usr/bin/env bash\nset -e\n'));
  assert.ok(isShell('bin/tool', '#!/bin/sh\n'));
  assert.ok(!isShell('scripts/ports.mjs', '#!/usr/bin/env node\n'));
  assert.ok(!isShell('docs/local-dev.md', 'LC_ALL=C grep\n'));
  assert.ok(!isShell('app.config.ts', ''));
});

test('no shell code changes the locale as a command prefix', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);

  const offenders = [];
  let scanned = 0;
  for (const file of tracked) {
    let text;
    try {
      text = readFileSync(path.join(root, file), 'utf8');
    } catch {
      continue; // gone, or a directory entry (a submodule); nothing to read
    }
    if (!isShell(file, text)) continue;
    scanned += 1;
    for (const hit of localePrefixes(text)) offenders.push(`${file}:${hit}`);
  }

  // A guard that silently scanned nothing would pass forever.
  assert.ok(scanned > 10, `only ${scanned} shell files found; the file filter is broken`);
  assert.deepEqual(
    offenders,
    [],
    `a locale variable set as a command prefix crashes a forked bash on macOS now and then (status 139). Write \`env LC_ALL=C cmd\` instead:\n${offenders.join('\n')}`,
  );
});
