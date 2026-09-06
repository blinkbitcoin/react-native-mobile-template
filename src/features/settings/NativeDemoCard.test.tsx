import { screen, waitFor } from '@testing-library/react-native';
import { renderWithProviders } from '@/test/render';
import { NativeDemoCard } from './NativeDemoCard';
import { NativeDemoCard as WebNativeDemoCard } from './NativeDemoCard.web';

// A failure that is not a `HelloNativeError` (a bug in the native code rather
// than a missing module) must still render rather than crash the screen.
jest.mock('../../../modules/hello-native', () => ({
  ...jest.requireActual('../../../modules/hello-native'),
  hello: () => {
    throw new TypeError('unexpected native failure');
  },
  getBuildStamp: async () => {
    throw new TypeError('unexpected native failure');
  },
}));

test('an unexpected native failure degrades to a placeholder', async () => {
  await renderWithProviders(<NativeDemoCard />);

  expect(screen.getByTestId('native-hello')).toHaveTextContent('error');
  await waitFor(() =>
    expect(screen.getByTestId('native-build-stamp')).toHaveTextContent('build-stamp:unavailable'),
  );
});

test('the web variant explains that the native demo is unavailable', async () => {
  await renderWithProviders(<WebNativeDemoCard />);

  expect(screen.getByTestId('native-hello')).toHaveTextContent('Native demo unavailable on web');
});
