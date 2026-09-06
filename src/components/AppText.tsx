import { Text, type TextProps } from 'react-native';
import { useTheme } from '../theme/useTheme';

type Variant = 'title' | 'body' | 'caption';

export function AppText({ variant = 'body', style, ...props }: TextProps & { variant?: Variant }) {
  const { colors, typography } = useTheme();
  return (
    <Text
      {...props}
      style={[
        { fontFamily: 'InterVariable', fontSize: typography[variant], color: colors.text },
        style,
      ]}
    />
  );
}
