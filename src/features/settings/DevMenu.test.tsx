import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { logger } from '@/lib/logger';
import { updates } from '@/services/updates';
import { renderWithProviders } from '@/test/render';
import { buildTheme } from '@/theme/tokens';
import { DevMenu } from './DevMenu';

// The OTA block only renders in a build configured for updates, so the whole
// suite runs against a constants module that reports one.
jest.mock('@/config/constants', () => ({
  constants: {
    version: '9.9.9',
    buildNumber: '42',
    variant: 'development',
    otaEnabled: true,
    buildStamp: 'test-stamp',
  },
}));

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
