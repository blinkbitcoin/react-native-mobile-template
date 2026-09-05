import { act, renderHook } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';
import { createStyles } from './createStyles';
import { ThemeProvider } from './ThemeProvider';
import { useTheme, useThemePreference } from './useTheme';

const wrapper = ({ children }: PropsWithChildren) => <ThemeProvider>{children}</ThemeProvider>;

test('defaults to the system scheme (light in jest) and can be forced to dark', async () => {
  const { result } = await renderHook(() => ({ theme: useTheme(), pref: useThemePreference() }), {
    wrapper,
  });
  expect(result.current.theme.scheme).toBe('light');
  await act(() => result.current.pref.setPreference('dark'));
  expect(result.current.theme.scheme).toBe('dark');
  expect(result.current.theme.colors.background).not.toBe('#ffffff');
});

test('createStyles produces a hook bound to the current theme', async () => {
  const useStyles = createStyles((t) => ({ box: { backgroundColor: t.colors.background } }));
  const { result } = await renderHook(() => useStyles(), { wrapper });
  expect(result.current.box.backgroundColor).toBe('#ffffff');
});
