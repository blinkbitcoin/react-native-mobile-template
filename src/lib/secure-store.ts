import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { env } from '@/config/env';

export enum SecureKey {
  AUTH_TOKEN = 'auth.token',
}

const MAX_BYTES = 2048; // expo-secure-store documented limit

export class UnsupportedPlatformError extends Error {
  constructor() {
    super(
      'Secure storage is not available on web. Set EXPO_PUBLIC_ALLOW_INSECURE_WEB_STORAGE=true for local development only.',
    );
    this.name = 'UnsupportedPlatformError';
  }
}

const memoryFallback = new Map<string, string>();

function assertPlatform() {
  if (Platform.OS === 'web' && !env.ALLOW_INSECURE_WEB_STORAGE)
    throw new UnsupportedPlatformError();
}

export const secureStore = {
  async get(key: SecureKey): Promise<string | null> {
    assertPlatform();
    if (Platform.OS === 'web') return memoryFallback.get(key) ?? null;
    return SecureStore.getItemAsync(key);
  },
  async set(key: SecureKey, value: string) {
    assertPlatform();
    if (new TextEncoder().encode(value).byteLength > MAX_BYTES)
      throw new Error(`Secure values must be <= ${MAX_BYTES} bytes`);
    if (Platform.OS === 'web') {
      memoryFallback.set(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key: SecureKey) {
    assertPlatform();
    if (Platform.OS === 'web') {
      memoryFallback.delete(key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};
