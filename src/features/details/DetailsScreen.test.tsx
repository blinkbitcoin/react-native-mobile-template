import { renderRouter, screen } from 'expo-router/testing-library';
import DetailsRoute from '@/app/details/[id]';

test('details route reads the id param', async () => {
  await renderRouter({ 'details/[id]': DetailsRoute }, { initialUrl: '/details/42' });
  expect(screen.getByTestId('details-id')).toHaveTextContent('42');
});
