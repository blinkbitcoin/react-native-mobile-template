import { useLingui } from '@lingui/react/macro';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
// Side-effect import: registers the UNAUTHENTICATED → signOut hook for every
// variant, including production builds that never mount the dev menu.
import '@/services/auth';
import { Providers } from '../components/Providers';
import { crashReporting } from '../lib/crash-reporting';

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

function RootStack() {
  // `useLingui` subscribes to locale activation, so the header titles below
  // re-render when the language changes.
  const { t } = useLingui();
  return (
    <Stack>
      {/* The title doubles as the back label on pushed screens; without it the
          stack falls back to the route name and shows "(tabs)". */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false, title: t`Home` }} />
      <Stack.Screen name="details/[id]" options={{ title: t`Details` }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <Providers>
      <StatusBar style="auto" />
      <RootStack />
    </Providers>
  );
}
