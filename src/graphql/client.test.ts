import { gql } from '@apollo/client';
import { HttpResponse, http } from 'msw';
import { crashReporting } from '@/lib/crash-reporting';
import { SecureKey, secureStore } from '@/lib/secure-store';
import { allowConsole } from '@/test/console';
import { server } from '@/test/setup';
import { createApolloClient } from './client';
import { onUnauthenticated } from './links/error';

const HELLO = gql`
  query Hello {
    hello
  }
`;
const OTHER = 'http://other.test/graphql';

afterEach(async () => {
  await secureStore.remove(SecureKey.AUTH_TOKEN);
  jest.restoreAllMocks();
});

test('talks to the configured API by default', async () => {
  const { data } = await createApolloClient().query({ query: HELLO });
  expect(data).toEqual({ hello: 'Hello, world!' });
});

test('talks to the endpoint it is given, carrying the stored token', async () => {
  await secureStore.set(SecureKey.AUTH_TOKEN, 'tok');
  const seen: (string | null)[] = [];
  server.use(
    http.post(OTHER, ({ request }) => {
      seen.push(request.headers.get('authorization'));
      return HttpResponse.json({ data: { hello: 'from elsewhere' } });
    }),
  );
  const { data } = await createApolloClient(OTHER).query({ query: HELLO });
  expect(data).toEqual({ hello: 'from elsewhere' });
  expect(seen).toEqual(['Bearer tok']);
});

test('an UNAUTHENTICATED answer reaches the sign-out listeners', async () => {
  allowConsole('warn', 'GraphQL error in Hello');
  server.use(
    http.post(OTHER, () =>
      HttpResponse.json({
        data: null,
        errors: [{ message: 'nope', extensions: { code: 'UNAUTHENTICATED' } }],
      }),
    ),
  );
  const listener = jest.fn();
  const off = onUnauthenticated(listener);
  await expect(createApolloClient(OTHER).query({ query: HELLO })).rejects.toThrow('nope');
  off();
  expect(listener).toHaveBeenCalledTimes(1);
});

test('retries a network failure three times in all before reporting it once', async () => {
  allowConsole('error', 'Network error in Hello');
  const captureException = jest.spyOn(crashReporting, 'captureException').mockImplementation();
  let attempts = 0;
  server.use(
    http.post(OTHER, () => {
      attempts += 1;
      return HttpResponse.error();
    }),
  );
  await expect(createApolloClient(OTHER).query({ query: HELLO })).rejects.toThrow();
  expect(attempts).toBe(3);
  expect(captureException).toHaveBeenCalledTimes(1);
});
