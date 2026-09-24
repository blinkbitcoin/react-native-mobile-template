import { useLingui } from '@lingui/react/macro';
import { Stack } from 'expo-router';
// Side-effect import: registers the UNAUTHENTICATED → signOut hook for every
// variant, including production builds that never mount the dev menu.
import '@/services/auth';
import { NavigationTheme } from '../components/NavigationTheme';
import { Providers } from '../components/Providers';
import { installGlobalErrorHandler } from '../lib/global-error-handler';

// Module scope so it runs exactly once per bundle load. The body lives in
// `src/lib` because a file under `src/app` cannot hold a colocated test: the
// router would treat it as a route.
installGlobalErrorHandler();

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
      <NavigationTheme>
        <RootStack />
      </NavigationTheme>
    </Providers>
  );
}
