import { ApolloClient, ApolloLink, execute, gql, InMemoryCache, Observable } from '@apollo/client';
import { SecureKey, secureStore } from '@/lib/secure-store';
import { createAuthLink } from './auth';

const QUERY = gql`
  query X {
    hello
  }
`;

// Apollo 4's `execute` needs an `ExecuteContext`, and `ErrorLink` reaches through
// `operation.client` for the incremental handler, so a real client is required.
const client = new ApolloClient({ cache: new InMemoryCache(), link: ApolloLink.empty() });

function terminating(handler: (op: ApolloLink.Operation) => ApolloLink.Result) {
  return new ApolloLink(
    (operation) =>
      new Observable<ApolloLink.Result>((obs) => {
        obs.next(handler(operation));
        obs.complete();
      }),
  );
}

/** Runs the chain to completion (success or failure) and returns the captured headers. */
async function run(link: ApolloLink) {
  await new Promise<void>((resolve) => {
    execute(link, { query: QUERY }, { client }).subscribe({
      next: () => {},
      error: () => resolve(),
      complete: resolve,
    });
  });
}

afterEach(async () => {
  await secureStore.remove(SecureKey.AUTH_TOKEN);
  jest.restoreAllMocks();
});

test('auth link adds a bearer header when a token exists', async () => {
  await secureStore.set(SecureKey.AUTH_TOKEN, 'tok');
  let headers: Record<string, string> | undefined;
  const link = ApolloLink.from([
    createAuthLink(),
    terminating((op) => {
      headers = op.getContext().headers as Record<string, string> | undefined;
      return { data: { hello: 'x' } };
    }),
  ]);
  await run(link);
  expect(headers?.authorization).toBe('Bearer tok');
});

test('auth link leaves headers alone when there is no token', async () => {
  let headers: Record<string, string> | undefined;
  const link = ApolloLink.from([
    createAuthLink(),
    terminating((op) => {
      headers = op.getContext().headers as Record<string, string> | undefined;
      return { data: { hello: 'x' } };
    }),
  ]);
  await run(link);
  expect(headers?.authorization).toBeUndefined();
});

test('auth link treats a secure-store failure as "no token"', async () => {
  jest.spyOn(secureStore, 'get').mockRejectedValue(new Error('keychain unavailable'));
  let headers: Record<string, string> | undefined;
  const link = ApolloLink.from([
    createAuthLink(),
    terminating((op) => {
      headers = op.getContext().headers as Record<string, string> | undefined;
      return { data: { hello: 'x' } };
    }),
  ]);
  await run(link);
  expect(headers?.authorization).toBeUndefined();
});
