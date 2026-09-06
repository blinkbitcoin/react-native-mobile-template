import { useEffect, useRef, useState } from 'react';
import { onUnauthenticated } from '@/graphql/links/error';
import { logger } from '@/lib/logger';
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
// The store is unavailable on web without the insecure-storage opt-in, so the
// rejection is logged rather than left to surface as an unhandled rejection.
onUnauthenticated(() => {
  void auth.signOut().catch((e: unknown) => logger.warn('sign-out failed', { e: String(e) }));
});

export function useAuth() {
  const [signedIn, setSignedIn] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const refresh = () => {
      void auth
        .getToken()
        // Reading the token can reject (no secure store on web unless the
        // insecure fallback is enabled); treat that as "not signed in".
        .then((token) => {
          if (mounted.current) setSignedIn(token !== null);
        })
        .catch(() => {
          if (mounted.current) setSignedIn(false);
        });
    };
    refresh();
    listeners.add(refresh);
    return () => {
      mounted.current = false;
      listeners.delete(refresh);
    };
  }, []);
  return { signedIn, signIn: auth.signInMock, signOut: auth.signOut };
}
