import { type RenderOptions, render } from '@testing-library/react-native';
import type { PropsWithChildren, ReactElement } from 'react';
import { ApolloProvider } from '../graphql/ApolloProvider';
import { I18nProvider } from '../i18n/I18nProvider';
import { ThemeProvider } from '../theme/ThemeProvider';

export function Providers({ children }: PropsWithChildren) {
  return (
    <ThemeProvider>
      <I18nProvider>
        <ApolloProvider>{children}</ApolloProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}

export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  return render(ui, { wrapper: Providers, ...options });
}

export * from '@testing-library/react-native';
