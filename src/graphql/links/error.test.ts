import { ApolloClient, ApolloLink, execute, gql, InMemoryCache, Observable } from '@apollo/client';
import { crashReporting } from '@/lib/crash-reporting';
import { allowConsole } from '@/test/console';
import { createErrorLink, onUnauthenticated } from './error';

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

function failing(error: Error) {
  return new ApolloLink(
    () =>
      new Observable<ApolloLink.Result>((obs) => {
        obs.error(error);
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

afterEach(() => {
  jest.restoreAllMocks();
});

test('error link emits onUnauthenticated for UNAUTHENTICATED codes', async () => {
  // The link logs every GraphQL error through `logger.warn` by design; the
  // matcher keeps that an assertion rather than a blanket silence.
  allowConsole('warn', 'GraphQL error in X');
  const cb = jest.fn();
  const off = onUnauthenticated(cb);
  const link = ApolloLink.from([
    createErrorLink(),
    terminating(() => ({ errors: [{ message: 'nope', extensions: { code: 'UNAUTHENTICATED' } }] })),
  ]);
  await run(link);
  expect(cb).toHaveBeenCalled();
  off();
});

test('error link does not emit onUnauthenticated for other GraphQL errors', async () => {
  allowConsole('warn', 'GraphQL error in X');
  const cb = jest.fn();
  const off = onUnauthenticated(cb);
  const link = ApolloLink.from([
    createErrorLink(),
    terminating(() => ({ errors: [{ message: 'boom', extensions: { code: 'BAD_USER_INPUT' } }] })),
  ]);
  await run(link);
  expect(cb).not.toHaveBeenCalled();
  off();
});

test('error link reports network errors to the crash reporter', async () => {
  allowConsole('error', 'Network error in X');
  const captureException = jest.spyOn(crashReporting, 'captureException').mockImplementation();
  const cb = jest.fn();
  const off = onUnauthenticated(cb);
  const link = ApolloLink.from([createErrorLink(), failing(new Error('offline'))]);
  await run(link);
  expect(captureException).toHaveBeenCalled();
  expect(cb).not.toHaveBeenCalled();
  off();
});
