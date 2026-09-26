import { act, fireEvent, screen } from '@testing-library/react-native';
import { activateLocale } from '@/i18n/i18n';
import { renderWithProviders } from '@/test/render';
import { SettingsScreen } from './SettingsScreen';

// The build variant decides whether the dev menu shows up front. `mockVariant`
// is read on every access, so a test can switch to a production build.
let mockVariant = 'development';
jest.mock('@/config/constants', () => ({
  constants: {
    version: '1.0.0',
    buildNumber: '1',
    get variant() {
      return mockVariant;
    },
    otaEnabled: false,
    buildStamp: 'prod-stamp',
  },
}));

/**
 * Theme and locale changes both land through subscriptions outside React's own
 * state (a context provider and Lingui's external store), so each press needs
 * its own awaited `act` for React 19 to flush before the next one starts.
 */
async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

afterEach(() => {
  activateLocale('en');
  mockVariant = 'development';
});

test('dev menu toggles theme and language', async () => {
  await renderWithProviders(<SettingsScreen />);
  await press('settings-theme-dark');
  await press('settings-lang-es');
  expect(screen.getByTestId('settings-title')).toHaveTextContent('Ajustes');

  await press('settings-theme-light');
  await press('settings-theme-system');
  await press('settings-lang-en');
  expect(screen.getByTestId('settings-title')).toHaveTextContent('Settings');
});

test('dev menu shows the build stamp and version', async () => {
  await renderWithProviders(<SettingsScreen />);
  expect(screen.getByTestId('settings-build-stamp')).toBeOnTheScreen();
  expect(screen.getByTestId('settings-version')).toBeOnTheScreen();
});

async function tapTitle(times: number) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-title'));
    });
  }
}

test('the dev menu stays hidden in a production build until seven taps', async () => {
  // A production build must not show the dev menu until the hidden gesture on
  // the title has been completed.
  mockVariant = 'production';
  await renderWithProviders(<SettingsScreen />);
  expect(screen.queryByTestId('settings-build-stamp')).toBeNull();

  await tapTitle(6);
  expect(screen.queryByTestId('settings-build-stamp')).toBeNull();

  await tapTitle(1);
  expect(screen.getByTestId('settings-build-stamp')).toHaveTextContent('prod-stamp');
});
