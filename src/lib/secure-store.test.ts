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
