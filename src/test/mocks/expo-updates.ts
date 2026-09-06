// Stand-in for the native expo-updates module: jest.config.ts maps `expo-updates`
// here so anything that reads update metadata in tests gets inert defaults.
export const isEnabled = false;
export const updateId: string | null = null;
export const channel: string | null = null;
export const runtimeVersion: string | null = 'test-runtime';
export const checkForUpdateAsync = jest.fn(async () => ({ isAvailable: false }));
export const fetchUpdateAsync = jest.fn(async () => ({ isNew: false }));
export const reloadAsync = jest.fn(async () => {});
export const setUpdateRequestHeadersOverride = jest.fn();
