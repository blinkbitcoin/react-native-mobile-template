import { parseEnv } from './env';

test('accepts a valid public env', () => {
  const env = parseEnv({
    EXPO_PUBLIC_API_URL: 'http://localhost:4000/graphql',
    EXPO_PUBLIC_APP_NAME: 'X',
    EXPO_PUBLIC_ALLOW_INSECURE_WEB_STORAGE: 'false',
  });
  expect(env.API_URL).toBe('http://localhost:4000/graphql');
  expect(env.ALLOW_INSECURE_WEB_STORAGE).toBe(false);
});

test('rejects a missing API url with a readable message', () => {
  expect(() => parseEnv({ EXPO_PUBLIC_APP_NAME: 'X' })).toThrow(/EXPO_PUBLIC_API_URL/);
});

test('rewrites localhost for the Android emulator in development', () => {
  const env = parseEnv(
    { EXPO_PUBLIC_API_URL: 'http://localhost:4000/graphql', EXPO_PUBLIC_APP_NAME: 'X' },
    { platform: 'android', dev: true },
  );
  expect(env.API_URL).toBe('http://10.0.2.2:4000/graphql');
});
