// Every port this repo listens on, derived from one base. A service listens on
// APP_PORT_BASE (default 8080) plus a fixed offset, so a second worktree of the
// template runs side by side with one variable:
//
//   APP_PORT_BASE=8090 make mock-api     # 8092 instead of 8082
//
// The Metro offset is +1 on purpose: 8081 is Expo's own default and the port
// the `expo-development-client` deep link assumes, so the default base keeps
// every existing instruction true.
//
// This file is the ONE producer of a derived port. Consumers read it directly
// (the web E2E config, `mocks/server.ts`) or through `node scripts/ports.mjs
// --sh`, which the Makefile's run targets and the E2E shell scripts eval.
//
// `.mise.toml` exports APP_PORT_BASE - the input - and deliberately not the
// three derived ports: a mirrored `METRO_PORT=8081` sitting in the environment
// of every mise-activated shell, `mise exec` and CI job is indistinguishable
// from a deliberate per-service override below, and the base would then stop
// moving anything. `ports.test.mjs` asserts the mirror cannot come back.
//
// The other things that restate a number - the `.env*` defaults and the port
// table in docs/local-dev.md - are pinned against this file by `ports.test.mjs`,
// which also fails on a bare port literal anywhere else in the tree.

export const BASE_VAR = 'APP_PORT_BASE';
export const BASE_DEFAULT = 8080;

/** key → { offset from the base, its own override variable, what listens there } */
export const SERVICES = {
  metro: {
    offset: 1,
    env: 'METRO_PORT',
    what: 'Metro / the Expo dev server (`make start`)',
  },
  mockApi: {
    offset: 2,
    env: 'MOCK_API_PORT',
    what: 'the graphql-yoga mock API (`make mock-api`)',
  },
  webPreview: {
    offset: 3,
    env: 'WEB_PREVIEW_PORT',
    what: 'the static web preview (`expo serve dist`)',
  },
};

/** The mock API endpoint on that port — what `EXPO_PUBLIC_API_URL` points at in dev. */
export const mockApiUrl = (port) => `http://localhost:${port}/graphql`;

/**
 * A port from one variable: unset or empty means the fallback; anything else
 * must be a real port number, so a typo fails here rather than as a server
 * that silently never comes up.
 */
export const portFrom = (name, value, fallback) => {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error(`${name} must be a port number (1-65535), got ${JSON.stringify(value)}`);
  }
  return Number(value);
};

/** The base port from the environment (validated), else the default. */
export const baseFrom = (env) => portFrom(BASE_VAR, env[BASE_VAR], BASE_DEFAULT);

/**
 * Every service's port: its own override variable if set, else base + offset.
 * The shape is spelled out for TypeScript's benefit - `mocks/server.ts` and the
 * web E2E config are typechecked, and a key built in a loop is opaque to
 * inference.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ base: number, metro: number, mockApi: number, webPreview: number }}
 */
export const resolvePorts = (env) => {
  const base = baseFrom(env);
  const ports = { base };
  for (const [key, { offset, env: name }] of Object.entries(SERVICES)) {
    ports[key] = portFrom(name, env[name], base + offset);
  }
  return ports;
};

/**
 * Shell `export` lines for every derived value, which the Makefile's run
 * targets and the E2E scripts eval. `EXPO_PUBLIC_API_URL` is in here and
 * deliberately NOT in `.mise.toml`: Expo bakes it into the bundle, and the
 * committed `.env.development` value has to stay the default that a bare
 * `expo start` picks up. `RCT_METRO_PORT` is what `expo run:ios` and
 * `expo run:android` bake into the native debug app as its dev-server port.
 */
export const envLines = (env) => {
  const ports = resolvePorts(env);
  return [
    `export ${BASE_VAR}=${ports.base}`,
    ...Object.entries(SERVICES).map(([key, { env: name }]) => `export ${name}=${ports[key]}`),
    `export RCT_METRO_PORT=${ports.metro}`,
    `export EXPO_PUBLIC_API_URL=${mockApiUrl(ports.mockApi)}`,
  ];
};

// CLI: `--sh` for `eval "$(node scripts/ports.mjs --sh)"`, no argument for a
// human-readable table. Returns the exit code.
export const main = (
  argv = process.argv.slice(2),
  { env = process.env, log = console.log, error = console.error } = {},
) => {
  const [flag] = argv;
  if (flag === '--sh') {
    log(envLines(env).join('\n'));
  } else if (flag === undefined) {
    const ports = resolvePorts(env);
    log(`${BASE_VAR}=${ports.base} (default ${BASE_DEFAULT})`);
    for (const [key, { offset, env: name, what }] of Object.entries(SERVICES)) {
      log(`  ${String(ports[key]).padEnd(6)} base+${offset}  ${name}  ${what}`);
    }
  } else {
    error(`usage: node scripts/ports.mjs [--sh]`);
    return 2;
  }
  return 0;
};

if (import.meta.main) process.exitCode = main();
