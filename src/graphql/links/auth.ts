import { SetContextLink } from '@apollo/client/link/context';
import { SecureKey, secureStore } from '@/lib/secure-store';

export function createAuthLink() {
  return new SetContextLink(async (prev) => {
    const token = await secureStore.get(SecureKey.AUTH_TOKEN).catch(() => null);
    const headers = (prev.headers ?? {}) as Record<string, string>;
    return { headers: token ? { ...headers, authorization: `Bearer ${token}` } : headers };
  });
}
