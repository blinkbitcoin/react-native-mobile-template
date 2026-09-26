import { Stack } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';
import DetailsRoute from '@/app/details/[id]';
import { Providers } from '@/test/render';

test('details route reads the id param', async () => {
  await renderRouter(
    { _layout: () => <Stack />, 'details/[id]': DetailsRoute },
    { initialUrl: '/details/42', wrapper: Providers },
  );
  expect(screen.getByTestId('details-id')).toHaveTextContent('42');
});

test('details route falls back to an empty id when the route has no param', async () => {
  // Mounting the same component on a path with no `[id]` segment is the shape a
  // mistyped route takes: the param is simply absent and must not render
  // "undefined" to the user.
  await renderRouter(
    { _layout: () => <Stack />, index: DetailsRoute },
    { initialUrl: '/', wrapper: Providers },
  );
  expect(screen.getByTestId('details-id').props.children).toBe('');
});
