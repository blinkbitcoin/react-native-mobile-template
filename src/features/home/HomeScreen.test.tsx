import { Stack } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';
import { I18nProvider } from '@/i18n/I18nProvider';
import { HomeScreen } from './HomeScreen';

function TestLayout() {
  return (
    <I18nProvider>
      <Stack />
    </I18nProvider>
  );
}

test('home screen shows the title and links to details', async () => {
  await renderRouter(
    { _layout: TestLayout, index: HomeScreen, 'details/[id]': () => null },
    { initialUrl: '/' },
  );
  expect(screen.getByTestId('home-title')).toBeOnTheScreen();
  expect(screen.getByTestId('home-open-details')).toBeOnTheScreen();
});
