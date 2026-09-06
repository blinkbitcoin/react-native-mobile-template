import { Trans } from '@lingui/react/macro';
import { act, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { renderWithProviders } from '@/test/render';
import { activateLocale } from './i18n';

test('switching locale re-renders translated text', async () => {
  await renderWithProviders(
    <Text>
      <Trans>Home</Trans>
    </Text>,
  );
  expect(screen.getByText('Home')).toBeOnTheScreen();
  await act(() => activateLocale('es'));
  expect(screen.getByText('Inicio')).toBeOnTheScreen();
});
