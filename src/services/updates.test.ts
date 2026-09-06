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
