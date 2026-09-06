import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@/test/render';
import { SettingsScreen } from './SettingsScreen';

// A production build must not show the dev menu until the hidden gesture on the
// title has been completed.
jest.mock('@/config/constants', () => ({
  constants: {
    version: '1.0.0',
    buildNumber: '1',
    variant: 'production',
    otaEnabled: false,
    buildStamp: 'prod-stamp',
  },
}));

async function tapTitle(times: number) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-title'));
    });
  }
}

test('the dev menu stays hidden in a production build until seven taps', async () => {
  await renderWithProviders(<SettingsScreen />);
  expect(screen.queryByTestId('settings-build-stamp')).toBeNull();

  await tapTitle(6);
  expect(screen.queryByTestId('settings-build-stamp')).toBeNull();

  await tapTitle(1);
  expect(screen.getByTestId('settings-build-stamp')).toHaveTextContent('prod-stamp');
});
