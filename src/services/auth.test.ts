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
