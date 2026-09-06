import { renderHook, waitFor } from '@testing-library/react-native';
import * as Updates from 'expo-updates';
import { updates, useUpdateInfo } from './updates';

const checkForUpdateAsync = Updates.checkForUpdateAsync as jest.MockedFunction<
  typeof Updates.checkForUpdateAsync
>;

// `__DEV__` is declared as a bare global, not as a member of `globalThis`, so it
// needs a typed view of the global object before `replaceProperty` can see it.
const globals = globalThis as unknown as { __DEV__: boolean };

type UpdateCheckResult = Awaited<ReturnType<typeof Updates.checkForUpdateAsync>>;
const available = { isAvailable: true } as UpdateCheckResult;

afterEach(() => {
  // `replaceProperty` only rolls back on an explicit restore, and both `__DEV__`
  // and `Updates.isEnabled` would otherwise leak into the next test.
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

test('switchChannel overrides the header and checks for updates', async () => {
  await updates.switchChannel('beta');
  expect(Updates.setUpdateRequestHeadersOverride).toHaveBeenCalledWith({
    'expo-channel-name': 'beta',
  });
  expect(Updates.checkForUpdateAsync).toHaveBeenCalled();
  expect(Updates.reloadAsync).not.toHaveBeenCalled();
});

test('switchChannel fetches and reloads when the new channel has an update', async () => {
  checkForUpdateAsync.mockResolvedValueOnce(available);

  await updates.switchChannel('production');

  expect(Updates.setUpdateRequestHeadersOverride).toHaveBeenCalledWith({
    'expo-channel-name': 'production',
  });
  expect(Updates.fetchUpdateAsync).toHaveBeenCalled();
  expect(Updates.reloadAsync).toHaveBeenCalled();
});

test('switchChannel swallows a failing update check', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    checkForUpdateAsync.mockRejectedValueOnce(new Error('NotAvailableInDevClientException'));

    await expect(updates.switchChannel('internal')).resolves.toBeUndefined();

    expect(Updates.fetchUpdateAsync).not.toHaveBeenCalled();
    expect(Updates.reloadAsync).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  } finally {
    warn.mockRestore();
  }
});

test('applyIfAvailable is a no-op when nothing is available', async () => {
  await expect(updates.applyIfAvailable()).resolves.toBe(false);
  expect(Updates.checkForUpdateAsync).not.toHaveBeenCalled();
  expect(Updates.reloadAsync).not.toHaveBeenCalled();
});

test('applyIfAvailable stops at the check when no update is published', async () => {
  jest.replaceProperty(Updates, 'isEnabled', true);

  await expect(updates.applyIfAvailable()).resolves.toBe(false);

  expect(Updates.checkForUpdateAsync).toHaveBeenCalled();
  expect(Updates.fetchUpdateAsync).not.toHaveBeenCalled();
});

test('applyIfAvailable fetches and reloads when an update is available', async () => {
  jest.replaceProperty(Updates, 'isEnabled', true);
  checkForUpdateAsync.mockResolvedValueOnce(available);

  await expect(updates.applyIfAvailable()).resolves.toBe(true);

  expect(Updates.fetchUpdateAsync).toHaveBeenCalled();
  expect(Updates.reloadAsync).toHaveBeenCalled();
});

test('info exposes runtime metadata', () => {
  expect(updates.info()).toEqual({
    channel: null,
    runtimeVersion: 'test-runtime',
    updateId: null,
    enabled: false,
  });
});

// `useUpdateInfo` throttles through module scope, so the two skip cases have to
// run before the case that arms the throttle.
test('useUpdateInfo skips the check in a dev build', async () => {
  jest.replaceProperty(Updates, 'isEnabled', true);

  const { result } = await renderHook(() => useUpdateInfo());

  expect(__DEV__).toBe(true);
  expect(Updates.checkForUpdateAsync).not.toHaveBeenCalled();
  expect(result.current.runtimeVersion).toBe('test-runtime');
});

test('useUpdateInfo skips the check when updates are disabled', async () => {
  jest.replaceProperty(globals, '__DEV__', false);

  await renderHook(() => useUpdateInfo());

  expect(Updates.checkForUpdateAsync).not.toHaveBeenCalled();
});

test('useUpdateInfo applies an available update once and then throttles', async () => {
  jest.replaceProperty(globals, '__DEV__', false);
  jest.replaceProperty(Updates, 'isEnabled', true);
  checkForUpdateAsync.mockResolvedValue(available);

  const { result } = await renderHook(() => useUpdateInfo());

  await waitFor(() => expect(Updates.reloadAsync).toHaveBeenCalled());
  await waitFor(() => expect(result.current.enabled).toBe(true));

  checkForUpdateAsync.mockClear();
  await renderHook(() => useUpdateInfo());

  expect(Updates.checkForUpdateAsync).not.toHaveBeenCalled();
});

test('applyIfAvailable resolves false when the update check rejects', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    jest.resetModules();
    await jest.isolateModulesAsync(async () => {
      jest.doMock('expo-updates', () => ({
        isEnabled: true,
        updateId: null,
        channel: null,
        runtimeVersion: 'test-runtime',
        checkForUpdateAsync: jest.fn(async () => {
          throw new Error('NotAvailableInDevClientException');
        }),
        fetchUpdateAsync: jest.fn(async () => ({ isNew: false })),
        reloadAsync: jest.fn(async () => {}),
        setUpdateRequestHeadersOverride: jest.fn(),
      }));
      /* eslint-disable @typescript-eslint/no-require-imports -- both modules have to come from the isolated registry */
      const isolated = require('./updates') as typeof import('./updates');
      const IsolatedUpdates = require('expo-updates') as typeof import('expo-updates');
      /* eslint-enable @typescript-eslint/no-require-imports */

      await expect(isolated.updates.applyIfAvailable()).resolves.toBe(false);
      expect(IsolatedUpdates.reloadAsync).not.toHaveBeenCalled();
    });
  } finally {
    warn.mockRestore();
  }
});
