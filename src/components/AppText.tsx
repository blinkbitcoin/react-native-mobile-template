import { Text, type TextProps, type TextStyle } from 'react-native';
import type { Theme } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

type Variant = 'title' | 'body' | 'caption';

/** Weight, tracking and colour per variant; the size comes from the theme. */
const variants: Record<Variant, (colors: Theme['colors']) => TextStyle> = {
  title: (colors) => ({ fontWeight: '700', letterSpacing: -0.5, color: colors.text }),
  body: (colors) => ({ lineHeight: 22, color: colors.text }),
  // Captions label sections and metadata, so they sit a step back in grey.
  caption: (colors) => ({ lineHeight: 18, color: colors.muted }),
};

export function AppText({ variant = 'body', style, ...props }: TextProps & { variant?: Variant }) {
  const { colors, typography } = useTheme();
  return (
    <Text
      {...props}
      style={[
        { fontFamily: 'InterVariable', fontSize: typography[variant] },
        variants[variant](colors),
        style,
      ]}
    />
  );
}
