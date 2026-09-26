import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

test('an unknown path renders the not-found route, whose link goes home', async () => {
  const router = renderRouter('src/app', { initialUrl: '/no-such-route' });
  await router;

  expect(screen.getByTestId('not-found-screen')).toBeOnTheScreen();
  // Pressing it, rather than only reading the label, is what pins the target:
  // the screen's whole job is to be a way back out of a bad URL.
  const home = screen.getByRole('link');
  expect(home.props.href).toBe('/');

  await act(async () => {
    fireEvent.press(home);
  });

  expect(router.getPathname()).toBe('/');
  expect(screen.getByTestId('home-screen')).toBeOnTheScreen();
});
