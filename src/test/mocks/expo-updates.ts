// Stand-in for the native expo-updates module: jest.config.ts maps `expo-updates`
// here so anything that reads update metadata in tests gets inert defaults.
export const isEnabled = false;
export const updateId: string | null = null;
export const channel: string | null = null;
export const runtimeVersion: string | null = null;
export async function checkForUpdateAsync() {
  return { isAvailable: false, isRollBackToEmbedded: false } as const;
}
export async function fetchUpdateAsync() {
  return { isNew: false, isRollBackToEmbedded: false } as const;
}
export async function reloadAsync() {}
