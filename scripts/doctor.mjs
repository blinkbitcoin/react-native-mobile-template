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

export function checkTool(tool) {
  let output;
  try {
    output = execSync(tool.command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
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
    const detail = (error.stdout ?? error.stderr ?? '').trim().split('\n')[0];
    return { ok: false, reason: detail || 'command failed' };
  }
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const req = JSON.parse(readFileSync(path.join(here, 'doctor.requirements.json'), 'utf8'));
  let failures = 0;
  for (const tool of req.tools) {
    if (tool.platform && tool.platform !== process.platform) continue;
    const result = checkTool(tool);
    if (result.ok) {
      process.stdout.write(`ok    ${tool.name} ${result.version}\n`);
    } else if (tool.optional) {
      process.stdout.write(`warn  ${tool.name}: ${result.reason}. Fix: ${tool.hint}\n`);
    } else {
      failures++;
      process.stdout.write(`FAIL  ${tool.name}: ${result.reason}. Fix: ${tool.hint}\n`);
    }
  }
  for (const entry of req.commands ?? []) {
    const result = checkCommand(entry);
    if (result.ok) {
      process.stdout.write(`ok    ${entry.name}\n`);
    } else {
      failures++;
      process.stdout.write(`FAIL  ${entry.name}: ${result.reason}. Fix: ${entry.hint}\n`);
    }
  }
  for (const v of req.env) {
    if (process.env[v.name]) process.stdout.write(`ok    $${v.name}=${process.env[v.name]}\n`);
    else {
      failures++;
      process.stdout.write(`FAIL  $${v.name} is not set. Fix: ${v.hint}\n`);
    }
  }
  if (failures > 0) {
    process.stdout.write(`\n${failures} problem(s). Fix them and re-run: make doctor\n`);
    process.exit(1);
  }
  process.stdout.write('\nAll good.\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
