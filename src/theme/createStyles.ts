import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import type { Theme } from './tokens';
import { useTheme } from './useTheme';

export function createStyles<T extends StyleSheet.NamedStyles<T>>(factory: (theme: Theme) => T) {
  return function useStyles(): T {
    const theme = useTheme();
    return useMemo(() => StyleSheet.create(factory(theme)), [theme]);
  };
}
