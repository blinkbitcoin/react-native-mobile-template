import type { AppStateStatus } from 'react-native';
import { AppState } from 'react-native';
import { storage } from '@/lib/storage';
import { createCache, persistCacheOnBackground, restoreCache } from './cache';

const KEY = 'apollo.cache.v1';

afterEach(async () => {
  await storage.remove(KEY);
  jest.restoreAllMocks();
});

test('restoreCache is a no-op when nothing was persisted', async () => {
  const cache = createCache();
  const restore = jest.spyOn(cache, 'restore');
  await restoreCache(cache);
  expect(restore).not.toHaveBeenCalled();
});

test('restoreCache hydrates the cache from a persisted snapshot', async () => {
  const snapshot = { ROOT_QUERY: { __typename: 'Query', 'hello({})': 'Hello, world!' } };
  await storage.set(KEY, snapshot);
  const cache = createCache();
  await restoreCache(cache);
  expect(cache.extract()).toMatchObject(snapshot);
});

test('persistCacheOnBackground writes a snapshot when the app leaves the foreground', async () => {
  let handler: ((state: AppStateStatus) => void) | undefined;
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, cb) => {
    handler = cb as (state: AppStateStatus) => void;
    return { remove } as ReturnType<typeof AppState.addEventListener>;
  });

  const cache = createCache();
  cache.restore({ ROOT_QUERY: { __typename: 'Query', 'hello({})': 'Hello, world!' } });
  const unsubscribe = persistCacheOnBackground(cache);

  handler?.('active');
  expect(await storage.get(KEY)).toBeNull();

  handler?.('background');
  await Promise.resolve();
  expect(await storage.get(KEY)).toMatchObject({ ROOT_QUERY: { __typename: 'Query' } });

  await storage.remove(KEY);
  handler?.('inactive');
  await Promise.resolve();
  expect(await storage.get(KEY)).not.toBeNull();

  unsubscribe();
  expect(remove).toHaveBeenCalled();
});
