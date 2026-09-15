import { act, renderHook, waitFor } from '@testing-library/react-native';
import { auth, useAuth } from './auth';

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
