import { InMemoryCache } from '@apollo/client';
import { AppState } from 'react-native';
import { storage } from '@/lib/storage';

const KEY = 'apollo.cache.v1';

export function createCache() {
  return new InMemoryCache();
}

export async function restoreCache(cache: InMemoryCache) {
  const snapshot = await storage.get<Record<string, unknown>>(KEY);
  if (snapshot) cache.restore(snapshot as never);
}

export function persistCacheOnBackground(cache: InMemoryCache) {
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'background' || state === 'inactive') void storage.set(KEY, cache.extract());
  });
  return () => {
    sub.remove();
  };
}
