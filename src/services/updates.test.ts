import * as Updates from 'expo-updates';
import { updates } from './updates';

test('switchChannel overrides the header and checks for updates', async () => {
  await updates.switchChannel('beta');
  expect(Updates.setUpdateRequestHeadersOverride).toHaveBeenCalledWith({
    'expo-channel-name': 'beta',
  });
  expect(Updates.checkForUpdateAsync).toHaveBeenCalled();
});

test('applyIfAvailable is a no-op when nothing is available', async () => {
  await expect(updates.applyIfAvailable()).resolves.toBe(false);
  expect(Updates.reloadAsync).not.toHaveBeenCalled();
});

test('info exposes runtime metadata', () => {
  expect(updates.info()).toEqual({
    channel: null,
    runtimeVersion: 'test-runtime',
    updateId: null,
    enabled: false,
  });
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
