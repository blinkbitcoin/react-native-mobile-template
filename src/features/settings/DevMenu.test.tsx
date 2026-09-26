import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ErrorBoundary } from 'react-error-boundary';
import { StyleSheet } from 'react-native';
import { ErrorFallback } from '@/components/ErrorFallback';
import { activateLocale } from '@/i18n/i18n';
import { logger } from '@/lib/logger';
import { updates } from '@/services/updates';
import { renderWithProviders } from '@/test/render';
import { buildTheme } from '@/theme/tokens';
import { DevMenu } from './DevMenu';

// The OTA block only renders in a build configured for updates, so the suite
// runs against a constants module that reports one; `mockOtaEnabled` is read on
// every access, so one test can turn it off.
let mockOtaEnabled = true;
jest.mock('@/config/constants', () => ({
  constants: {
    version: '9.9.9',
    buildNumber: '42',
    variant: 'development',
    get otaEnabled() {
      return mockOtaEnabled;
    },
    buildStamp: 'test-stamp',
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
  mockOtaEnabled = true;
});

test('the dev menu reports the build metadata it was given', async () => {
  await renderWithProviders(<DevMenu />);

  expect(screen.getByTestId('settings-build-stamp')).toHaveTextContent('test-stamp');
  expect(screen.getByTestId('settings-version')).toHaveTextContent('9.9.9 (42)');
});

test('the channel switcher is shown when OTA is enabled and hands the channel to updates', async () => {
  const switchChannel = jest.spyOn(updates, 'switchChannel').mockResolvedValue(undefined);
  try {
    await renderWithProviders(<DevMenu />);

    expect(screen.getByTestId('settings-channel-internal')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-channel-beta')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-channel-production')).toBeOnTheScreen();

    for (const channel of ['internal', 'beta', 'production'] as const) {
      await act(async () => {
        fireEvent.press(screen.getByTestId(`settings-channel-${channel}`));
      });
      await waitFor(() => expect(switchChannel).toHaveBeenCalledWith(channel));
    }

    expect(switchChannel).toHaveBeenCalledTimes(3);
  } finally {
    switchChannel.mockRestore();
  }
});

test('a failing dev-menu action is logged instead of thrown', async () => {
  const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
  const switchChannel = jest
    .spyOn(updates, 'switchChannel')
    .mockRejectedValue(new Error('no update server'));
  try {
    await renderWithProviders(<DevMenu />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-channel-beta'));
    });

    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith('switch to channel beta failed', {
        e: 'Error: no update server',
      }),
    );
  } finally {
    switchChannel.mockRestore();
    warn.mockRestore();
  }
});

test('the update info line reports the running update metadata', async () => {
  await renderWithProviders(<DevMenu />);

  expect(screen.getByTestId('settings-update-info')).toHaveTextContent(
    JSON.stringify({
      channel: null,
      runtimeVersion: 'test-runtime',
      updateId: null,
      enabled: false,
    }),
  );
});

test('the menu is quiet: small caps section headings and outlined buttons', async () => {
  await renderWithProviders(<DevMenu />);
  const { colors } = buildTheme('light');

  for (const heading of ['Theme', 'Language', 'Channel']) {
    // <Trans> renders its string in a nested, unstyled Text: the style is one up.
    const text = screen.getByText(heading);
    const styled = text.props.style ? text : text.parent;
    expect(StyleSheet.flatten(styled?.props.style)).toMatchObject({
      textTransform: 'uppercase',
      color: colors.muted,
    });
  }
  // Every action here is secondary: outlined on the page colour, never filled.
  for (const id of ['settings-theme-dark', 'settings-lang-es', 'settings-trigger-error']) {
    expect(StyleSheet.flatten(screen.getByTestId(id).props.style)).toMatchObject({
      backgroundColor: colors.background,
      borderColor: colors.border,
    });
  }
});

test('the theme buttons set the preference the whole tree follows', async () => {
  await renderWithProviders(<DevMenu />);
  const background = () =>
    StyleSheet.flatten(screen.getByTestId('settings-theme-light').props.style).backgroundColor;

  await press('settings-theme-dark');
  expect(background()).toBe(buildTheme('dark').colors.background);
  await press('settings-theme-light');
  expect(background()).toBe(buildTheme('light').colors.background);
  await press('settings-theme-dark');
  // Jest's system scheme is light, so "system" lands on the light theme again.
  await press('settings-theme-system');
  expect(background()).toBe(buildTheme('light').colors.background);
});

test('the language buttons switch the locale', async () => {
  await renderWithProviders(<DevMenu />);

  await press('settings-lang-es');
  expect(screen.getByText('Idioma')).toBeOnTheScreen();
  await press('settings-lang-en');
  expect(screen.getByText('Language')).toBeOnTheScreen();
});

test('without OTA there is no channel switcher', async () => {
  mockOtaEnabled = false;
  await renderWithProviders(<DevMenu />);

  expect(screen.queryByTestId('settings-channel-beta')).toBeNull();
  expect(screen.queryByTestId('settings-update-info')).toBeNull();
});

test('the dev menu signs in and out through the auth service', async () => {
  await renderWithProviders(<DevMenu />);
  expect(screen.getByTestId('settings-auth-state')).toHaveTextContent('signed out');

  await press('settings-auth-sign-in');
  await waitFor(() =>
    expect(screen.getByTestId('settings-auth-state')).toHaveTextContent('signed in'),
  );

  await press('settings-auth-sign-out');
  await waitFor(() =>
    expect(screen.getByTestId('settings-auth-state')).toHaveTextContent('signed out'),
  );
});

test('the trigger-error button raises to the boundary and retry comes back', async () => {
  // React logs the error it caught; keep the test output readable.
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await renderWithProviders(
      <ErrorBoundary FallbackComponent={ErrorFallback}>
        <DevMenu />
      </ErrorBoundary>,
    );
    await press('settings-trigger-error');
    expect(screen.getByTestId('error-screen')).toBeOnTheScreen();

    await press('error-retry');
    expect(screen.getByTestId('settings-trigger-error')).toBeOnTheScreen();
    expect(screen.queryByTestId('error-screen')).toBeNull();
  } finally {
    spy.mockRestore();
  }
});
