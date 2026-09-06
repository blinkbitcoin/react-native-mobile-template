import type { HelloNativeModuleType } from './src/HelloNative.types';

export class HelloNativeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HelloNativeError';
  }
}

let native: HelloNativeModuleType | null = null;

function module_(): HelloNativeModuleType {
  if (native) return native;
  try {
    // Deliberately lazy and CommonJS: `requireNativeModule` throws at import time
    // when the native module is absent (web, Expo Go, Jest), so this wrapper must
    // only touch it inside the try block.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    native = require('./src/HelloNativeModule').default as HelloNativeModuleType;
    return native;
  } catch (cause) {
    throw new HelloNativeError(
      'HelloNative is not available in this runtime (Expo Go or web). Build a dev client: make ios / make android.',
      { cause },
    );
  }
}

export function hello(name: string): string {
  if (name.length === 0) throw new HelloNativeError('name must not be empty');
  return module_().hello(name);
}

// `async` on purpose: a missing native module must surface as a rejection, so
// callers can rely on the declared `Promise<string>` contract and a single
// `.catch()` instead of also guarding the synchronous call.
export async function getBuildStamp(): Promise<string> {
  return module_().getBuildStamp();
}

export const platformName: string = (() => {
  try {
    return module_().platformName;
  } catch {
    return 'unavailable';
  }
})();
