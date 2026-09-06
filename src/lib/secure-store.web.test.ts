import { Platform } from 'react-native';

jest.mock('@/config/env', () => ({
  env: {
    API_URL: 'http://localhost:4000/graphql',
    APP_NAME: 'Test',
    WEB_DOMAIN: undefined,
    ALLOW_INSECURE_WEB_STORAGE: true,
  },
}));

import { SecureKey, secureStore } from './secure-store';

test('falls back to an in-memory store on web when explicitly allowed', async () => {
  const os = Platform.OS;
  Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
  try {
    expect(await secureStore.get(SecureKey.AUTH_TOKEN)).toBeNull();
    await secureStore.set(SecureKey.AUTH_TOKEN, 'web-secret');
    expect(await secureStore.get(SecureKey.AUTH_TOKEN)).toBe('web-secret');
    await secureStore.remove(SecureKey.AUTH_TOKEN);
    expect(await secureStore.get(SecureKey.AUTH_TOKEN)).toBeNull();
  } finally {
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  }
});
