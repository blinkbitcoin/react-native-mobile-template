import { act, renderHook } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';
import { createStyles } from './createStyles';
import { ThemeProvider } from './ThemeProvider';
import { buildTheme } from './tokens';
import { useThemePreference } from './useTheme';

const wrapper = ({ children }: PropsWithChildren) => <ThemeProvider>{children}</ThemeProvider>;

test('createStyles produces a hook bound to the current theme', async () => {
  const useStyles = createStyles((t) => ({ box: { backgroundColor: t.colors.background } }));
  const { result } = await renderHook(() => useStyles(), { wrapper });
  expect(result.current.box.backgroundColor).toBe('#ffffff');
});

test('the styles follow a theme change and are kept while the theme stands', async () => {
  const useStyles = createStyles((t) => ({ box: { backgroundColor: t.colors.background } }));
  const { result, rerender } = await renderHook(
    () => ({ styles: useStyles(), pref: useThemePreference() }),
    { wrapper },
  );
  const first = result.current.styles;
  await rerender({});
  expect(result.current.styles).toBe(first);
  await act(() => result.current.pref.setPreference('dark'));
  expect(result.current.styles.box.backgroundColor).toBe(buildTheme('dark').colors.background);
});
