import { act, renderHook } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';
import { useColorScheme } from 'react-native';
import { ThemeProvider } from './ThemeProvider';
import { useTheme, useThemePreference } from './useTheme';

const wrapper = ({ children }: PropsWithChildren) => <ThemeProvider>{children}</ThemeProvider>;

// React Native's Jest preset replaces `useColorScheme` with a `jest.fn` that
// reports 'light'; pointing it at 'dark' is how a test drives the system scheme.
const systemScheme = jest.mocked(useColorScheme);

afterEach(() => {
  systemScheme.mockReturnValue('light');
});

test('defaults to the system scheme (light in jest) and can be forced to dark', async () => {
  const { result } = await renderHook(() => ({ theme: useTheme(), pref: useThemePreference() }), {
    wrapper,
  });
  expect(result.current.theme.scheme).toBe('light');
  await act(() => result.current.pref.setPreference('dark'));
  expect(result.current.theme.scheme).toBe('dark');
  expect(result.current.theme.colors.background).not.toBe('#ffffff');
});

test('the system preference follows a dark system scheme', async () => {
  systemScheme.mockReturnValue('dark');
  const { result } = await renderHook(() => useTheme(), { wrapper });
  expect(result.current.scheme).toBe('dark');
});

test('the preference context has an inert default outside a provider', async () => {
  // Reading the context without a ThemeProvider is a programming error, not a
  // crash: the default setter is a no-op so an orphaned consumer still renders.
  const { result } = await renderHook(() => useThemePreference());
  expect(result.current.preference).toBe('system');
  expect(() => {
    result.current.setPreference('dark');
  }).not.toThrow();
});

test('an explicit preference ignores the system scheme', async () => {
  systemScheme.mockReturnValue('dark');
  const light = ({ children }: PropsWithChildren) => (
    <ThemeProvider preference="light">{children}</ThemeProvider>
  );
  const { result } = await renderHook(() => ({ theme: useTheme(), pref: useThemePreference() }), {
    wrapper: light,
  });
  expect(result.current.pref.preference).toBe('light');
  expect(result.current.theme.scheme).toBe('light');
});
