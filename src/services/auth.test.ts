import { ApolloClient, ApolloLink, execute, gql, InMemoryCache, Observable } from '@apollo/client';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createErrorLink } from '@/graphql/links/error';
import { logger } from '@/lib/logger';
import { allowConsole } from '@/test/console';
import { auth, useAuth } from './auth';

const QUERY = gql`
  query X {
    hello
  }
`;

/**
 * Drives a 401-equivalent through the real error link, which is the only way to
 * reach the `onUnauthenticated` listener this module registers on import.
 */
async function runUnauthenticated() {
  const client = new ApolloClient({ cache: new InMemoryCache(), link: ApolloLink.empty() });
  const link = ApolloLink.from([
    createErrorLink(),
    new ApolloLink(
      () =>
        new Observable<ApolloLink.Result>((obs) => {
          obs.next({ errors: [{ message: 'nope', extensions: { code: 'UNAUTHENTICATED' } }] });
          obs.complete();
        }),
    ),
  ]);
  await new Promise<void>((resolve) => {
    execute(link, { query: QUERY }, { client }).subscribe({
      next: () => {},
      error: () => resolve(),
      complete: resolve,
    });
  });
}

test('mock sign-in stores a token and sign-out clears it', async () => {
  expect(await auth.getToken()).toBeNull();
  await auth.signInMock();
  expect(await auth.getToken()).toMatch(/^mock-/);
  await auth.signOut();
  expect(await auth.getToken()).toBeNull();
});

test('useAuth tracks the signed-in state across sign-in and sign-out', async () => {
  const { result } = await renderHook(() => useAuth());
  await waitFor(() => expect(result.current.signedIn).toBe(false));

  await act(async () => {
    await result.current.signIn();
  });
  await waitFor(() => expect(result.current.signedIn).toBe(true));

  await act(async () => {
    await result.current.signOut();
  });
  await waitFor(() => expect(result.current.signedIn).toBe(false));
});

test('useAuth falls back to signed out when the secure store rejects', async () => {
  const rejection = new Error('secure storage is not available on web');
  const getToken = jest.spyOn(auth, 'getToken').mockRejectedValue(rejection);
  const unhandled = jest.fn();
  process.on('unhandledRejection', unhandled);
  try {
    const { result } = await renderHook(() => useAuth());
    await waitFor(() => expect(getToken).toHaveBeenCalled());
    expect(result.current.signedIn).toBe(false);
    // Let any escaped rejection reach the process hook before asserting.
    await new Promise((resolve) => setImmediate(resolve));
    expect(unhandled).not.toHaveBeenCalled();
  } finally {
    process.off('unhandledRejection', unhandled);
    getToken.mockRestore();
  }
});

test('a 401-equivalent from the API drops the stored token', async () => {
  // The error link logs every GraphQL error by design; the matcher keeps that an
  // assertion rather than a blanket silence.
  allowConsole('warn', 'GraphQL error in X');
  await auth.signInMock();
  expect(await auth.getToken()).toMatch(/^mock-/);

  await runUnauthenticated();

  await waitFor(async () => expect(await auth.getToken()).toBeNull());
});

test('a sign-out that cannot reach the secure store is logged, not thrown', async () => {
  const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
  const signOut = jest
    .spyOn(auth, 'signOut')
    .mockRejectedValue(new Error('secure storage is not available on web'));
  try {
    await runUnauthenticated();

    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith('sign-out failed', {
        e: 'Error: secure storage is not available on web',
      }),
    );
  } finally {
    signOut.mockRestore();
    warn.mockRestore();
  }
});

test('useAuth stops updating state once unmounted', async () => {
  const { result, unmount } = await renderHook(() => useAuth());
  await waitFor(() => expect(result.current.signedIn).toBe(false));
  unmount();
  // A notify() after unmount must not reach setSignedIn; React would warn
  // through console.error — which the console guard turns into a failure — and
  // the listener set would keep the unmounted hook alive. Deliberately not
  // wrapped in act(): RNTL's unmount() closes its own act scope, so any act()
  // afterwards trips React 19's overlapping-act check even with an empty body,
  // and post-unmount work performs no React work to flush by definition.
  await auth.signInMock();
  expect(result.current.signedIn).toBe(false);
  await auth.signOut();
});

test.each([
  ['resolves', true],
  ['rejects', false],
] as const)('useAuth ignores a token read that %s after unmount', async (_case, succeeds) => {
  // Both `mounted.current` guards protect the same thing: a setState on a hook
  // React has already torn down, which surfaces as a console.error the guard in
  // src/test/console.ts turns into a failure.
  let finish: ((ok: boolean) => void) | undefined;
  const getToken = jest.spyOn(auth, 'getToken').mockImplementation(
    () =>
      new Promise<string | null>((resolve, reject) => {
        finish = (ok) => (ok ? resolve('mock-token') : reject(new Error('keychain unavailable')));
      }),
  );
  try {
    const { result, unmount } = await renderHook(() => useAuth());
    await waitFor(() => expect(getToken).toHaveBeenCalled());

    // `unmount()` is async in RNTL 14: without the await, the effect cleanup that
    // clears `mounted` lands a microtask *after* the settled promise's callback,
    // and the test would pass while covering the mounted path instead.
    await unmount();
    finish?.(succeeds);
    await new Promise((resolve) => setImmediate(resolve));

    expect(result.current.signedIn).toBe(false);
  } finally {
    getToken.mockRestore();
  }
});
