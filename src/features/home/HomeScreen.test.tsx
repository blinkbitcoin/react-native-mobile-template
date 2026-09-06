import { Stack } from 'expo-router';
import { renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Providers } from '@/test/render';
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
