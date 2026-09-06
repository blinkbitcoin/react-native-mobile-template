import { ApolloClient, ApolloLink, HttpLink } from '@apollo/client';
import { RetryLink } from '@apollo/client/link/retry';
import { env } from '@/config/env';
import { createCache } from './cache';
import { createAuthLink } from './links/auth';
import { createErrorLink } from './links/error';

export function createApolloClient(uri = env.API_URL) {
  const cache = createCache();
  return new ApolloClient({
    cache,
    link: ApolloLink.from([
      createErrorLink(),
      new RetryLink({ attempts: { max: 3 } }),
      createAuthLink(),
      new HttpLink({ uri }),
    ]),
  });
}
