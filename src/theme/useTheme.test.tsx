import { renderHook } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';
import { ThemeContext, ThemePreferenceContext } from './ThemeProvider';
import { buildTheme } from './tokens';
import { useTheme, useThemePreference } from './useTheme';

test('useTheme reads the theme its provider supplies', async () => {
  const dark = buildTheme('dark');
  const wrapper = ({ children }: PropsWithChildren) => (
    <ThemeContext.Provider value={dark}>{children}</ThemeContext.Provider>
  );
  const { result } = await renderHook(() => useTheme(), { wrapper });
  expect(result.current).toBe(dark);
});

test('useTheme falls back to the light theme outside a provider', async () => {
  const { result } = await renderHook(() => useTheme());
  expect(result.current).toEqual(buildTheme('light'));
});

test('useThemePreference reads the preference and setter its provider supplies', async () => {
  const value = { preference: 'dark' as const, setPreference: jest.fn() };
  const wrapper = ({ children }: PropsWithChildren) => (
    <ThemePreferenceContext.Provider value={value}>{children}</ThemePreferenceContext.Provider>
  );
  const { result } = await renderHook(() => useThemePreference(), { wrapper });
  expect(result.current).toBe(value);
});
