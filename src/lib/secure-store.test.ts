import { Platform } from 'react-native';
import { SecureKey, secureStore, UnsupportedPlatformError } from './secure-store';

test('stores and reads a secret', async () => {
  await secureStore.set(SecureKey.AUTH_TOKEN, 'abc');
  expect(await secureStore.get(SecureKey.AUTH_TOKEN)).toBe('abc');
  await secureStore.remove(SecureKey.AUTH_TOKEN);
  expect(await secureStore.get(SecureKey.AUTH_TOKEN)).toBeNull();
});

test('rejects values over 2 KB', async () => {
  await expect(secureStore.set(SecureKey.AUTH_TOKEN, 'x'.repeat(2049))).rejects.toThrow(/2048/);
});

test('throws on web unless insecure storage is explicitly allowed', async () => {
  const os = Platform.OS;
  Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
  try {
    await expect(secureStore.set(SecureKey.AUTH_TOKEN, 'x')).rejects.toBeInstanceOf(
      UnsupportedPlatformError,
    );
  } finally {
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  }
});

test('falls back to an in-memory store on web when explicitly allowed', async () => {
  // `env` is frozen at import, so the opt-in needs a fresh registry with it on.
  let isolated!: typeof import('./secure-store');
  jest.isolateModules(() => {
    jest.doMock('@/config/env', () => ({
      env: {
        API_URL: 'http://localhost/graphql',
        APP_NAME: 'Test',
        WEB_DOMAIN: undefined,
        ALLOW_INSECURE_WEB_STORAGE: true,
      },
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the module has to come from the isolated registry
    isolated = require('./secure-store') as typeof import('./secure-store');
  });
  const { SecureKey: Key, secureStore: store } = isolated;
  const os = Platform.OS;
  Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
  try {
    expect(await store.get(Key.AUTH_TOKEN)).toBeNull();
    await store.set(Key.AUTH_TOKEN, 'web-secret');
    expect(await store.get(Key.AUTH_TOKEN)).toBe('web-secret');
    await store.remove(Key.AUTH_TOKEN);
    expect(await store.get(Key.AUTH_TOKEN)).toBeNull();
  } finally {
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  }
});
