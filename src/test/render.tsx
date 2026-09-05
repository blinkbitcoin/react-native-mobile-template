import { type RenderOptions, render } from '@testing-library/react-native';
import type { PropsWithChildren, ReactElement } from 'react';

// Providers are appended here as the layers land (theme, i18n, apollo).
function Providers({ children }: PropsWithChildren) {
  return <>{children}</>;
}

export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  return render(ui, { wrapper: Providers, ...options });
}

export * from '@testing-library/react-native';
