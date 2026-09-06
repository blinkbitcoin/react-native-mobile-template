import { type RenderOptions, render } from '@testing-library/react-native';
import type { PropsWithChildren, ReactElement } from 'react';
import { Providers as AppProviders } from '../components/Providers';

/**
 * The app's provider stack with the error boundary disabled, so a render error
 * fails the test loudly instead of rendering the fallback.
 */
export function Providers({ children }: PropsWithChildren) {
  return <AppProviders withErrorBoundary={false}>{children}</AppProviders>;
}

/**
 * `apolloUri` points the stack at another endpoint, so a test can serve one
 * query from a handler of its own without touching the default mock server.
 */
export function renderWithProviders(
  ui: ReactElement,
  { apolloUri, ...options }: RenderOptions & { apolloUri?: string } = {},
) {
  const wrapper = apolloUri
    ? ({ children }: PropsWithChildren) => (
        <AppProviders withErrorBoundary={false} apolloUri={apolloUri}>
          {children}
        </AppProviders>
      )
    : Providers;
  return render(ui, { wrapper, ...options });
}

export * from '@testing-library/react-native';
