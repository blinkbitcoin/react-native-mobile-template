import { parseEnv } from './env';

// 9999 on purpose: a port the rewrite has to carry across (otherwise a
// `replace(/:\/\/localhost.*/, '://10.0.2.2')` regression would pass here), but
// not one scripts/ports.test.mjs guards, since nothing binds it.

test('accepts a valid public env', () => {
  const env = parseEnv({
    EXPO_PUBLIC_API_URL: 'http://localhost:9999/graphql',
    EXPO_PUBLIC_APP_NAME: 'X',
    EXPO_PUBLIC_ALLOW_INSECURE_WEB_STORAGE: 'false',
  });
  expect(env.API_URL).toBe('http://localhost:9999/graphql');
  expect(env.ALLOW_INSECURE_WEB_STORAGE).toBe(false);
});

test('rejects a missing API url with a readable message', () => {
  expect(() => parseEnv({ EXPO_PUBLIC_APP_NAME: 'X' })).toThrow(/EXPO_PUBLIC_API_URL/);
});

test('rewrites localhost for the Android emulator in development', () => {
  const env = parseEnv(
    { EXPO_PUBLIC_API_URL: 'http://localhost:9999/graphql', EXPO_PUBLIC_APP_NAME: 'X' },
    { platform: 'android', dev: true },
  );
  expect(env.API_URL).toBe('http://10.0.2.2:9999/graphql');
});
