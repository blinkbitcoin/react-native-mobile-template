import { ApolloProvider as Provider } from '@apollo/client/react';
import { type PropsWithChildren, useEffect, useMemo } from 'react';
import { logger } from '@/lib/logger';
import { persistCacheOnBackground, restoreCache } from './cache';
import { createApolloClient } from './client';

export function ApolloProvider({ children, uri }: PropsWithChildren<{ uri?: string }>) {
  const client = useMemo(() => createApolloClient(uri), [uri]);
  useEffect(() => {
    // `restoreCache` already swallows its own failures; the guard here keeps a
    // future change from turning this fire-and-forget call into an unhandled
    // rejection.
    void restoreCache(client.cache).catch((e: unknown) =>
      logger.warn('apollo cache restore failed', { e: String(e) }),
    );
    return persistCacheOnBackground(client.cache);
  }, [client]);
  return <Provider client={client}>{children}</Provider>;
}
