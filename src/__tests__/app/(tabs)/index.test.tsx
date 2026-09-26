import { renderRouter, screen } from 'expo-router/testing-library';
import HomeRoute from '@/app/(tabs)/index';
import { HomeScreen } from '@/features/home/HomeScreen';

test('the index route is the home screen', () => {
  expect(HomeRoute).toBe(HomeScreen);
});

test('the real route tree mounts the tab layout at the index route', async () => {
  const router = renderRouter('src/app', { initialUrl: '/' });
  await router;

  expect(router.getPathname()).toBe('/');
  expect(screen.getByTestId('home-screen')).toBeOnTheScreen();
  expect(screen.getByTestId('tab-home')).toBeOnTheScreen();
  expect(screen.getByTestId('tab-settings')).toBeOnTheScreen();
});
