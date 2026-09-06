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

export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  return render(ui, { wrapper: Providers, ...options });
}

export * from '@testing-library/react-native';
