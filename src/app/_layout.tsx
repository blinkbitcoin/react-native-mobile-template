import { t } from '@lingui/core/macro';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ErrorBoundary } from 'react-error-boundary';
// Side-effect import: registers the UNAUTHENTICATED → signOut hook for every
// variant, including production builds that never mount the dev menu.
import '@/services/auth';
import { ErrorFallback } from '../components/ErrorFallback';
import { ApolloProvider } from '../graphql/ApolloProvider';
import { I18nProvider } from '../i18n/I18nProvider';
import { crashReporting } from '../lib/crash-reporting';
import { ThemeProvider } from '../theme/ThemeProvider';

/**
 * React Native's global error hook. It is absent on web and under Jest, hence
 * the `typeof` guard below.
 */
declare const ErrorUtils: {
  getGlobalHandler: () => (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => void;
};

// Module scope so it runs exactly once per bundle load: errors thrown outside
// React's render tree still reach the crash reporter, and chaining to the
// previous handler keeps the red box in dev / termination in release.
if (typeof ErrorUtils !== 'undefined') {
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    crashReporting.captureException(error, { isFatal: isFatal === true });
    previous(error, isFatal);
  });
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <ErrorBoundary
          FallbackComponent={ErrorFallback}
          onError={(error) => crashReporting.captureException(error)}
        >
          <ApolloProvider>
            <StatusBar style="auto" />
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="details/[id]" options={{ title: t`Details` }} />
            </Stack>
          </ApolloProvider>
        </ErrorBoundary>
      </I18nProvider>
    </ThemeProvider>
  );
}
