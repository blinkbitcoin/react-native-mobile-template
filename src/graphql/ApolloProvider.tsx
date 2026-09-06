import { ApolloProvider as Provider } from '@apollo/client/react';
import { type PropsWithChildren, useEffect, useMemo } from 'react';
import { persistCacheOnBackground, restoreCache } from './cache';
import { createApolloClient } from './client';

export function ApolloProvider({ children, uri }: PropsWithChildren<{ uri?: string }>) {
  const client = useMemo(() => createApolloClient(uri), [uri]);
  useEffect(() => {
    void restoreCache(client.cache as never);
    return persistCacheOnBackground(client.cache as never);
  }, [client]);
  return <Provider client={client}>{children}</Provider>;
}
