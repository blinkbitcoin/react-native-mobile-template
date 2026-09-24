import {
  DarkTheme,
  DefaultTheme,
  type Theme as NavigationThemeValue,
  ThemeProvider,
} from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { type PropsWithChildren, useMemo } from 'react';
import { useTheme } from '../theme/useTheme';

/**
 * Hands the app theme to React Navigation, so headers, the tab bar and screen
 * backgrounds follow it instead of the library's own light palette (and its
 * blue active tab), including when the dark scheme is chosen. The status bar
 * follows the app's scheme too: `style="auto"` would follow the system's, which
 * leaves dark icons on a dark screen when the dev menu forces dark.
 */
export function NavigationTheme({ children }: PropsWithChildren) {
  const { scheme, colors } = useTheme();
  const value = useMemo<NavigationThemeValue>(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.text,
        background: colors.background,
        card: colors.background,
        text: colors.text,
        border: colors.border,
        notification: colors.text,
      },
    };
  }, [scheme, colors]);
  return (
    <ThemeProvider value={value}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {children}
    </ThemeProvider>
  );
}
