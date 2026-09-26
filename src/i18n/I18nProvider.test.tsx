import { Trans } from '@lingui/react/macro';
import { act, render, screen } from '@testing-library/react-native';
import { I18nProvider } from './I18nProvider';
import { activateLocale } from './i18n';

afterEach(async () => {
  await act(() => activateLocale('en'));
});

test('a bare <Trans> renders as native Text, which React Native requires of a string', async () => {
  await render(
    <I18nProvider>
      <Trans>Home</Trans>
    </I18nProvider>,
  );
  // Text queries only match host Text, so this fails if the string renders bare.
  expect(screen.getByText('Home')).toBeOnTheScreen();
});

test('renders its children in the active locale', async () => {
  await act(() => activateLocale('es'));
  await render(
    <I18nProvider>
      <Trans>Home</Trans>
    </I18nProvider>,
  );
  expect(screen.getByText('Inicio')).toBeOnTheScreen();
});
