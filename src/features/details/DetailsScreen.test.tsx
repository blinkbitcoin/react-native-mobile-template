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
