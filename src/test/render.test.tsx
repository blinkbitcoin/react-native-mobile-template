import { HttpResponse, http } from 'msw';
import { HomeScreen } from '@/features/home/HomeScreen';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import { server } from '@/test/setup';

test('renderWithProviders points the stack at the given Apollo endpoint', async () => {
  server.use(
    http.post('http://other.test/graphql', () =>
      HttpResponse.json({ data: { hello: 'Hello from the override!' } }),
    ),
  );

  await renderWithProviders(<HomeScreen />, { apolloUri: 'http://other.test/graphql' });

  await waitFor(() =>
    expect(screen.getByTestId('home-hello')).toHaveTextContent('Hello from the override!'),
  );
});
