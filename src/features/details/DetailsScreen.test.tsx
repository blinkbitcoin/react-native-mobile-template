import { Stack } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';
import DetailsRoute from '@/app/details/[id]';
import { I18nProvider } from '@/i18n/I18nProvider';

function TestLayout() {
  return (
    <I18nProvider>
      <Stack />
    </I18nProvider>
  );
}

test('details route reads the id param', async () => {
  await renderRouter(
    { _layout: TestLayout, 'details/[id]': DetailsRoute },
    { initialUrl: '/details/42' },
  );
  expect(screen.getByTestId('details-id')).toHaveTextContent('42');
});
