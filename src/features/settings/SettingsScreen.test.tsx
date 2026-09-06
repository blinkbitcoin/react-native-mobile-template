import { act, fireEvent, screen } from '@testing-library/react-native';
import { ErrorBoundary } from 'react-error-boundary';
import { ErrorFallback } from '@/components/ErrorFallback';
import { activateLocale } from '@/i18n/i18n';
import { renderWithProviders } from '@/test/render';
import { SettingsScreen } from './SettingsScreen';

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

test('the trigger-error button raises to the boundary and retry comes back', async () => {
  // React logs the error it caught; keep the test output readable.
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await renderWithProviders(
      <ErrorBoundary FallbackComponent={ErrorFallback}>
        <SettingsScreen />
      </ErrorBoundary>,
    );
    await press('settings-trigger-error');
    expect(screen.getByTestId('error-screen')).toBeOnTheScreen();

    await press('error-retry');
    expect(screen.getByTestId('settings-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('error-screen')).toBeNull();
  } finally {
    spy.mockRestore();
  }
});
