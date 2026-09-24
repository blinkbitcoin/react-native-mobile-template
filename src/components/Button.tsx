import { Pressable } from 'react-native';
import { createStyles } from '../theme/createStyles';
import { AppText } from './AppText';

type Variant = 'primary' | 'secondary';

export function Button({
  title,
  onPress,
  testID,
  variant = 'primary',
}: {
  title: string;
  onPress: () => void;
  testID: string;
  /** `primary` is filled, for a screen's main action; `secondary` is outlined. */
  variant?: Variant;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.base, styles[variant], pressed && styles.pressed]}
    >
      <AppText style={variant === 'primary' ? styles.primaryLabel : styles.secondaryLabel}>
        {title}
      </AppText>
    </Pressable>
  );
}

const useStyles = createStyles((theme) => ({
  base: {
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  secondary: { backgroundColor: theme.colors.background, borderColor: theme.colors.border },
  primaryLabel: { color: theme.colors.onPrimary, fontWeight: '600' },
  secondaryLabel: { color: theme.colors.text, fontWeight: '500' },
  pressed: { opacity: 0.6 },
}));
