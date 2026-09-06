import type { PropsWithChildren } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { ApolloProvider } from '@/graphql/ApolloProvider';
import { I18nProvider } from '@/i18n/I18nProvider';
import { crashReporting } from '@/lib/crash-reporting';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { ErrorFallback } from './ErrorFallback';

type Props = PropsWithChildren<{
  /** Apollo endpoint override; the client falls back to the configured URI. */
  apolloUri?: string;
  /**
   * The boundary sits inside Theme/I18n (its fallback uses both) and outside
   * Apollo. Tests turn it off so a thrown render error fails the test instead
   * of quietly rendering the fallback.
   */
  withErrorBoundary?: boolean;
}>;

/**
 * The app's provider stack, shared by the root route and the test harness so
 * the tree under test is the tree that ships.
 */
export function Providers({ children, apolloUri, withErrorBoundary = true }: Props) {
  const apollo = (
    <ApolloProvider {...(apolloUri === undefined ? {} : { uri: apolloUri })}>
      {children}
    </ApolloProvider>
  );
  return (
    <ThemeProvider>
      <I18nProvider>
        {withErrorBoundary ? (
          <ErrorBoundary
            FallbackComponent={ErrorFallback}
            onError={(error) => crashReporting.captureException(error)}
          >
            {apollo}
          </ErrorBoundary>
        ) : (
          apollo
        )}
      </I18nProvider>
    </ThemeProvider>
  );
}
