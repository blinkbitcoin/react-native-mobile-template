import { renderRouter, screen } from 'expo-router/testing-library';
import { HomeScreen } from './HomeScreen';

test('home screen shows the title and links to details', async () => {
  await renderRouter({ index: HomeScreen, 'details/[id]': () => null }, { initialUrl: '/' });
  expect(screen.getByTestId('home-title')).toBeOnTheScreen();
  expect(screen.getByTestId('home-open-details')).toBeOnTheScreen();
});
