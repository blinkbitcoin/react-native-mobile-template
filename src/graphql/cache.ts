import { type ApolloCache, InMemoryCache, type NormalizedCacheObject } from '@apollo/client';
import { AppState } from 'react-native';
import { logger } from '@/lib/logger';
import { storage } from '@/lib/storage';

const KEY = 'apollo.cache.v1';

export function createCache() {
  return new InMemoryCache();
}

/** JSON round-trips as `unknown`; only a plain object can be a cache snapshot. */
function isSnapshot(value: unknown): value is NormalizedCacheObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Best-effort hydration: a corrupt or unreadable snapshot must never keep the
 * app from starting, so a failure is logged and the cache stays empty.
 */
export async function restoreCache(cache: ApolloCache) {
  try {
    const snapshot: unknown = await storage.get(KEY);
    if (isSnapshot(snapshot)) cache.restore(snapshot);
  } catch (e: unknown) {
    logger.warn('apollo cache restore failed', { e: String(e) });
  }
}

export function persistCacheOnBackground(cache: ApolloCache) {
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'background' || state === 'inactive')
      void storage
        .set(KEY, cache.extract())
        .catch((e: unknown) => logger.warn('apollo cache persist failed', { e: String(e) }));
  });
  return () => {
    sub.remove();
  };
}
