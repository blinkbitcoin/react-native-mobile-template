import { t } from '@lingui/core/macro';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ApolloProvider } from '../graphql/ApolloProvider';
import { I18nProvider } from '../i18n/I18nProvider';
import { ThemeProvider } from '../theme/ThemeProvider';

export default function RootLayout() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <ApolloProvider>
          <StatusBar style="auto" />
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="details/[id]" options={{ title: t`Details` }} />
          </Stack>
        </ApolloProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
