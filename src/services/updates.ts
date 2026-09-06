import * as Updates from 'expo-updates';
import { useEffect, useState } from 'react';
import { logger } from '@/lib/logger';

export type Channel = 'internal' | 'beta' | 'production';

export const updates = {
  info: () => ({
    channel: Updates.channel,
    runtimeVersion: Updates.runtimeVersion,
    updateId: Updates.updateId,
    enabled: Updates.isEnabled,
  }),
  async applyIfAvailable(): Promise<boolean> {
    if (!Updates.isEnabled) return false;
    try {
      const check = await Updates.checkForUpdateAsync();
      if (!check.isAvailable) return false;
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
      return true;
    } catch (e) {
      // A dev client reports `isEnabled` while every check throws
      // NotAvailableInDevClientException; a failed check must never escape as an
      // unhandled rejection.
      logger.warn('update check failed', { e: String(e) });
      return false;
    }
  },
  /** Dev/QA only: point the running binary at another release channel. */
  async switchChannel(channel: Channel) {
    Updates.setUpdateRequestHeadersOverride({ 'expo-channel-name': channel });
    const check = await Updates.checkForUpdateAsync().catch((e: unknown) => {
      logger.warn('update check failed', { e: String(e) });
      return { isAvailable: false };
    });
    if (check.isAvailable) {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    }
  },
};

const ONE_HOUR = 60 * 60 * 1000;
let lastCheck = 0;

export function useUpdateInfo() {
  const [info, setInfo] = useState(updates.info());
  useEffect(() => {
    // Nothing to check in Expo Go, dev clients or debug builds: a dev client can
    // report `Updates.isEnabled` while every check throws, so `__DEV__` gates it too.
    if (__DEV__ || !Updates.isEnabled) return;
    if (Date.now() - lastCheck < ONE_HOUR) return;
    lastCheck = Date.now();
    void updates
      .applyIfAvailable()
      .catch((e: unknown) => logger.warn('update check failed', { e: String(e) }))
      .finally(() => setInfo(updates.info()));
  }, []);
  return info;
}
