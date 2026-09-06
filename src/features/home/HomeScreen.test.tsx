import { act, fireEvent } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { HttpResponse, http } from 'msw';
import { Providers } from '@/test/render';
import { server } from '@/test/setup';
import { HomeScreen } from './HomeScreen';

const routes = { _layout: () => <Stack />, index: HomeScreen, 'details/[id]': () => null };

test('home screen shows the title and links to details', async () => {
  await renderRouter(routes, { initialUrl: '/', wrapper: Providers });
  expect(screen.getByTestId('home-title')).toBeOnTheScreen();
  expect(screen.getByTestId('home-open-details')).toBeOnTheScreen();
});

test('home shows the hello greeting from the (mock) API', async () => {
  await renderRouter(routes, { initialUrl: '/', wrapper: Providers });
  await waitFor(() => expect(screen.getByTestId('home-hello')).toHaveTextContent('Hello, world!'));
});

test('tapping the details button routes to the details screen', async () => {
  // The pathname getters hang off the object `renderRouter` returns (which is
  // also the awaitable render result), not off `screen`.
  const router = renderRouter(routes, { initialUrl: '/', wrapper: Providers });
  await router;

  await act(async () => {
    fireEvent.press(screen.getByTestId('home-open-details'));
  });

  expect(router.getPathname()).toBe('/details/42');
});

test('home shows a user-facing message when the query fails', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    server.use(
      http.post('http://localhost:4000/graphql', () =>
        HttpResponse.json({ errors: [{ message: 'boom' }] }),
      ),
    );

    await renderRouter(routes, { initialUrl: '/', wrapper: Providers });

    await waitFor(() =>
      expect(screen.getByTestId('home-hello')).toHaveTextContent(
        'Something went wrong. Please try again.',
      ),
    );
  } finally {
    warn.mockRestore();
  }
});
