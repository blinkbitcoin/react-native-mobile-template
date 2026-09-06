import { useEffect, useState } from 'react';
import { onUnauthenticated } from '@/graphql/links/error';
import { SecureKey, secureStore } from '@/lib/secure-store';

const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

/**
 * Token-backed session. `signInMock` is the template's stand-in for a real
 * identity provider: swap its body for the provider SDK, keep the shape.
 */
export const auth = {
  getToken: () => secureStore.get(SecureKey.AUTH_TOKEN),
  async signInMock() {
    await secureStore.set(SecureKey.AUTH_TOKEN, `mock-${Date.now()}`);
    notify();
  },
  async signOut() {
    await secureStore.remove(SecureKey.AUTH_TOKEN);
    notify();
  },
};

// A 401-equivalent from the API drops the stored token so the app falls back to
// the signed-out state instead of retrying with a token the server rejected.
onUnauthenticated(() => void auth.signOut());

export function useAuth() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    const refresh = () => void auth.getToken().then((token) => setSignedIn(token !== null));
    refresh();
    listeners.add(refresh);
    return () => void listeners.delete(refresh);
  }, []);
  return { signedIn, signIn: auth.signInMock, signOut: auth.signOut };
}
