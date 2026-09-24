#!/usr/bin/env node
// Asserts the local toolchain matches scripts/doctor.requirements.json and
// prints a fix hint per failure. Exit 1 if any required tool is missing.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseVersion(output) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(output);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
}

export function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}

/** `run` is injectable, like `checkCommand`'s, so a test controls the output. */
export function checkTool(tool, run = execSync) {
  let output;
  try {
    output = run(tool.command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    output = error.stdout ?? '';
    if (!output) return { ok: false, reason: 'not found' };
  }
  const found = parseVersion(output);
  if (!found) return { ok: false, reason: `unparseable version output: ${output.trim()}` };
  const minimum = parseVersion(tool.minimum);
  if (compareVersions(found, minimum) < 0) {
    return { ok: false, reason: `found ${found.join('.')}, need >= ${tool.minimum}` };
  }
  return { ok: true, version: found.join('.') };
}

/**
 * A pass/fail probe: no version to parse, the exit status is the answer.
 * `run` is injectable so the unit test can exercise both branches without
 * depending on what happens to be installed on the machine.
 */
export function checkCommand(entry, run = execSync) {
  try {
    run(entry.command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true };
  } catch (error) {
    // Whichever stream carried the message: `bundle check` writes its
    // "Could not find ..." to stderr and leaves stdout empty, so `??` (which
    // only falls through on null) would report nothing useful.
    const detail = [error.stdout, error.stderr]
      .map((stream) => String(stream ?? '').trim())
      .find(Boolean);
    return { ok: false, reason: detail?.split('\n')[0] || 'command failed' };
  }
}

/** scripts/doctor.requirements.json, parsed. */
export function readRequirements() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return JSON.parse(readFileSync(path.join(here, 'doctor.requirements.json'), 'utf8'));
}

/**
 * Command-line entry; returns the exit code. Everything it touches is
 * injectable so a test decides what is installed and what is set.
 */
export function main({
  req = readRequirements(),
  platform = process.platform,
  env = process.env,
  run = execSync,
  write = (text) => process.stdout.write(text),
} = {}) {
  let failures = 0;
  for (const tool of req.tools) {
    if (tool.platform && tool.platform !== platform) continue;
    const result = checkTool(tool, run);
    if (result.ok) {
      write(`ok    ${tool.name} ${result.version}\n`);
    } else if (tool.optional) {
      write(`warn  ${tool.name}: ${result.reason}. Fix: ${tool.hint}\n`);
    } else {
      failures++;
      write(`FAIL  ${tool.name}: ${result.reason}. Fix: ${tool.hint}\n`);
    }
  }
  for (const entry of req.commands ?? []) {
    const result = checkCommand(entry, run);
    if (result.ok) {
      write(`ok    ${entry.name}\n`);
    } else {
      failures++;
      write(`FAIL  ${entry.name}: ${result.reason}. Fix: ${entry.hint}\n`);
    }
  }
  for (const v of req.env) {
    if (env[v.name]) write(`ok    $${v.name}=${env[v.name]}\n`);
    else {
      failures++;
      write(`FAIL  $${v.name} is not set. Fix: ${v.hint}\n`);
    }
  }
  if (failures > 0) {
    write(`\n${failures} problem(s). Fix them and re-run: make doctor\n`);
    return 1;
  }
  write('\nAll good.\n');
  return 0;
}

if (import.meta.main) process.exitCode = main();
