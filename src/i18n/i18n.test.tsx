import { Trans } from '@lingui/react/macro';
import { act, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { renderWithProviders } from '@/test/render';
import { activateLocale } from './i18n';

test('switching locale re-renders translated text', async () => {
  await renderWithProviders(
    <Text>
      <Trans>Home</Trans>
    </Text>,
  );
  expect(screen.getByText('Home')).toBeOnTheScreen();
  await act(() => activateLocale('es'));
  expect(screen.getByText('Inicio')).toBeOnTheScreen();
});

/**
 * `detectLocale` runs once at import time, so each case needs its own module
 * registry with `expo-localization` standing in for the device.
 */
async function detectWith(locales: { languageCode: string | null }[]) {
  let detected: string | undefined;
  jest.resetModules();
  await jest.isolateModulesAsync(async () => {
    jest.doMock('expo-localization', () => ({ getLocales: () => locales }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the module has to come from the isolated registry
    const isolated = require('./i18n') as typeof import('./i18n');
    detected = isolated.detectLocale();
  });
  return detected;
}

test('detectLocale keeps a supported device language', async () => {
  await expect(detectWith([{ languageCode: 'es' }])).resolves.toBe('es');
});

test('detectLocale falls back to English for an unsupported language', async () => {
  await expect(detectWith([{ languageCode: 'fr' }])).resolves.toBe('en');
});

test('detectLocale falls back to English when the device reports no locale', async () => {
  await expect(detectWith([])).resolves.toBe('en');
});
