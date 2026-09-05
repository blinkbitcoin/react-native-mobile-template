import { createContext, type PropsWithChildren, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { buildTheme, type Scheme, type Theme } from './tokens';

export type ThemePreference = 'system' | Scheme;

export const ThemeContext = createContext<Theme>(buildTheme('light'));
export const ThemePreferenceContext = createContext<{
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
}>({ preference: 'system', setPreference: () => {} });

export function ThemeProvider({
  children,
  preference: initial = 'system',
}: PropsWithChildren<{ preference?: ThemePreference }>) {
  const system = useColorScheme();
  const [preference, setPreference] = useState<ThemePreference>(initial);
  const scheme: Scheme =
    preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
  const theme = useMemo(() => buildTheme(scheme), [scheme]);
  const prefValue = useMemo(() => ({ preference, setPreference }), [preference]);
  return (
    <ThemePreferenceContext.Provider value={prefValue}>
      <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
    </ThemePreferenceContext.Provider>
  );
}
