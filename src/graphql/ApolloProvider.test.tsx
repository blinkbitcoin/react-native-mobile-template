import { render, screen, waitFor } from '@testing-library/react-native';
import { AppText } from '@/components/AppText';
import { logger } from '@/lib/logger';
import { ApolloProvider } from './ApolloProvider';
import { restoreCache } from './cache';

// `restoreCache` swallows its own failures, so the only way to exercise the
// provider's defensive `.catch` is to replace it with one that does not.
jest.mock('./cache', () => ({
  ...jest.requireActual<typeof import('./cache')>('./cache'),
  restoreCache: jest.fn(),
}));

const mockedRestoreCache = jest.mocked(restoreCache);

beforeEach(() => {
  mockedRestoreCache.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('renders its children and hydrates the cache once', async () => {
  await render(
    <ApolloProvider>
      <AppText testID="child">hello</AppText>
    </ApolloProvider>,
  );

  expect(screen.getByTestId('child')).toHaveTextContent('hello');
  await waitFor(() => expect(mockedRestoreCache).toHaveBeenCalledTimes(1));
});

test('logs instead of leaving an unhandled rejection when hydration rejects', async () => {
  const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
  mockedRestoreCache.mockRejectedValue(new Error('kv store unavailable'));

  await render(
    <ApolloProvider>
      <AppText testID="child">hello</AppText>
    </ApolloProvider>,
  );

  await waitFor(() =>
    expect(warn).toHaveBeenCalledWith('apollo cache restore failed', {
      e: 'Error: kv store unavailable',
    }),
  );
  expect(screen.getByTestId('child')).toHaveTextContent('hello');
});
