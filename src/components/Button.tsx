import { Pressable, StyleSheet } from 'react-native';
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

const styles = StyleSheet.create({
  base: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  pressed: { opacity: 0.6 },
});
