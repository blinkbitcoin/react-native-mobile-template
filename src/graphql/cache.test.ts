import { waitFor } from '@testing-library/react-native';
import type { AppStateStatus } from 'react-native';
import { AppState } from 'react-native';
import { logger } from '@/lib/logger';
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

test('restoreCache logs and leaves the cache empty when storage rejects', async () => {
  const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
  jest.spyOn(storage, 'get').mockRejectedValue(new Error('kv store unavailable'));
  const cache = createCache();
  const restore = jest.spyOn(cache, 'restore');

  await expect(restoreCache(cache)).resolves.toBeUndefined();

  expect(restore).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledWith('apollo cache restore failed', {
    e: 'Error: kv store unavailable',
  });
});

test('restoreCache ignores a persisted value that is not an object', async () => {
  await storage.set(KEY, ['not', 'a', 'snapshot']);
  const cache = createCache();
  const restore = jest.spyOn(cache, 'restore');
  await restoreCache(cache);
  expect(restore).not.toHaveBeenCalled();
});

test('persistCacheOnBackground logs instead of throwing when the write fails', async () => {
  const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
  jest.spyOn(storage, 'set').mockRejectedValue(new Error('disk full'));
  let handler: ((state: AppStateStatus) => void) | undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, cb) => {
    handler = cb as (state: AppStateStatus) => void;
    return { remove: jest.fn() } as ReturnType<typeof AppState.addEventListener>;
  });

  const unsubscribe = persistCacheOnBackground(createCache());
  handler?.('background');
  await waitFor(() =>
    expect(warn).toHaveBeenCalledWith('apollo cache persist failed', { e: 'Error: disk full' }),
  );
  unsubscribe();
});
