import Storage from 'expo-sqlite/kv-store';

// Non-secret key/value persistence. Secrets go through secure-store.ts.
export const storage = {
  async get<T>(key: string): Promise<T | null> {
    const raw = await Storage.getItem(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  async set(key: string, value: unknown) {
    await Storage.setItem(key, JSON.stringify(value));
  },
  async remove(key: string) {
    await Storage.removeItem(key);
  },
};
