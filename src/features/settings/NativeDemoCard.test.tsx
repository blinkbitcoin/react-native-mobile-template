import { screen, waitFor } from '@testing-library/react-native';
import { renderWithProviders } from '@/test/render';
import { NativeDemoCard } from './NativeDemoCard';
import { NativeDemoCard as WebNativeDemoCard } from './NativeDemoCard.web';

// A failure that is not a `HelloNativeError` (a bug in the native code rather
// than a missing module) must still render rather than crash the screen. The
// `mock` prefix is what lets jest's hoisted factory reference this.
let mockThrown: unknown = new TypeError('unexpected native failure');

jest.mock('../../../modules/hello-native', () => ({
  ...jest.requireActual('../../../modules/hello-native'),
  hello: () => {
    throw mockThrown;
  },
  getBuildStamp: async () => {
    throw new TypeError('unexpected native failure');
  },
}));

afterEach(() => {
  mockThrown = new TypeError('unexpected native failure');
});

test('an unexpected native failure degrades to its message', async () => {
  await renderWithProviders(<NativeDemoCard />);

  expect(screen.getByTestId('native-hello')).toHaveTextContent('unexpected native failure');
  await waitFor(() =>
    expect(screen.getByTestId('native-build-stamp')).toHaveTextContent('build-stamp:unavailable'),
  );
});

// JS lets anything be thrown, and `catch (e: unknown)` is the only honest type.
// A thrown string has no `.message`, so it is stringified instead.
test('a thrown non-Error is stringified rather than swallowed', async () => {
  mockThrown = 'native blew up';

  await renderWithProviders(<NativeDemoCard />);

  expect(screen.getByTestId('native-hello')).toHaveTextContent('native blew up');
});

test('the web variant explains that the native demo is unavailable', async () => {
  await renderWithProviders(<WebNativeDemoCard />);

  expect(screen.getByTestId('native-hello')).toHaveTextContent('Native demo unavailable on web');
});
