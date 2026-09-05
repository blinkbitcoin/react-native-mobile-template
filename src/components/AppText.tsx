import { Text, type TextProps } from 'react-native';

type Variant = 'title' | 'body' | 'caption';

const sizes: Record<Variant, number> = { title: 24, body: 16, caption: 12 };

export function AppText({ variant = 'body', style, ...props }: TextProps & { variant?: Variant }) {
  return <Text {...props} style={[{ fontSize: sizes[variant] }, style]} />;
}
