#!/usr/bin/env node
// The security scanning settings, resolved in one order everywhere: an
// environment variable wins over security-policy.json, which wins over the
// built-in default. Bash runners read one key at a time
//
//     node scripts/security/config.mjs get jobs.deps
//
// and CI reads the lot with `--json`. A value that is not a boolean throws
// rather than reading as off: a typo must not quietly disable a scanner.
import { readFileSync } from 'node:fs';

export const SEVERITIES = ['none', 'low', 'medium', 'high', 'critical'];

/** Built-in defaults. Deterministic scanners on, LLM engines dark until a key exists. */
export const DEFAULTS = {
  enabled: true,
  severity: 'high',
  failOn: ['deterministic'],
  jobs: {
    deps: true,
    code: true,
    policy: true,
    sbom: true,
    bundle: true,
    mobile: false,
    binaries: true,
    review: false,
    openant: false,
  },
};

export const parseBoolean = (value, source) => {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`${source}: expected true or false, got ${JSON.stringify(value)}`);
};

const parseSeverity = (value, source) => {
  if (!SEVERITIES.includes(value)) {
    throw new Error(
      `${source}: expected one of ${SEVERITIES.join(', ')}, got ${JSON.stringify(value)}`,
    );
  }
  return value;
};

const parseList = (value) =>
  Array.isArray(value)
    ? value
    : value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);

/** Settings from a parsed policy object and an environment. */
export const resolve = (policy = {}, env = process.env) => {
  const bool = (key, envKey, fileValue, fallback) => {
    if (env[envKey] !== undefined) return parseBoolean(env[envKey], envKey);
    if (fileValue !== undefined) return parseBoolean(fileValue, `security-policy.json: ${key}`);
    return fallback;
  };
  const jobs = Object.fromEntries(
    Object.entries(DEFAULTS.jobs).map(([name, fallback]) => [
      name,
      bool(
        `jobs.${name}`,
        `SECURITY_${name.toUpperCase()}`,
        policy.jobs?.[name]?.enabled,
        fallback,
      ),
    ]),
  );
  const severity =
    env.SECURITY_SEVERITY !== undefined
      ? parseSeverity(env.SECURITY_SEVERITY, 'SECURITY_SEVERITY')
      : parseSeverity(policy.severity ?? DEFAULTS.severity, 'severity');
  const failOn = parseList(env.SECURITY_FAIL_ON ?? policy.failOn ?? DEFAULTS.failOn);
  return {
    enabled: bool('enabled', 'SECURITY_ENABLED', policy.enabled, DEFAULTS.enabled),
    jobs,
    severity,
    failOn,
  };
};

/** Settings from the policy file on disk; a missing file is the defaults. */
export const load = (file = 'security-policy.json', env = process.env) => {
  let policy = {};
  try {
    policy = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return resolve(policy, env);
};

const at = (settings, dotted) =>
  dotted
    .split('.')
    .reduce((value, key) => (value === undefined ? undefined : value[key]), settings);

/** Command-line entry; returns the exit code. */
export function main(
  argv = process.argv.slice(2),
  { log = console.log, error = console.error, env = process.env } = {},
) {
  const settings = load('security-policy.json', env);
  if (argv[0] === '--json') {
    log(JSON.stringify(settings));
    return 0;
  }
  if (argv[0] === 'get' && argv[1]) {
    const value = at(settings, argv[1]);
    if (value === undefined) {
      error(`no such setting: ${argv[1]}`);
      return 2;
    }
    log(Array.isArray(value) ? value.join(',') : String(value));
    return 0;
  }
  error('usage: config.mjs get <dotted.key> | --json');
  return 2;
}

if (import.meta.main) process.exitCode = main();
