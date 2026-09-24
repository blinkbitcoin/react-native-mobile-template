import type { PropsWithChildren } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { createStyles } from '../theme/createStyles';

export function Card({ children, style, ...props }: PropsWithChildren<ViewProps>) {
  const styles = useStyles();
  return (
    <View {...props} style={[styles.card, style]}>
      {children}
    </View>
  );
}

const useStyles = createStyles((theme) => ({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
  },
}));
