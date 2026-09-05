import { Pressable } from 'react-native';
import { createStyles } from '../theme/createStyles';
import { AppText } from './AppText';

export function Button({
  title,
  onPress,
  testID,
}: {
  title: string;
  onPress: () => void;
  testID: string;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.base, pressed && styles.pressed]}
    >
      <AppText>{title}</AppText>
    </Pressable>
  );
}

const useStyles = createStyles((theme) => ({
  base: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
  },
  pressed: { opacity: 0.6 },
}));
