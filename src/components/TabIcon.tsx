import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';

type IconProps = ComponentProps<typeof Ionicons>;
type Glyph = IconProps['name'];

/**
 * One entry per tab: the filled glyph marks the active tab, the outline the
 * rest, which is the platform convention on both iOS and Android.
 */
const glyphs = {
  home: { focused: 'home', unfocused: 'home-outline' },
  settings: { focused: 'settings', unfocused: 'settings-outline' },
} as const satisfies Record<string, { focused: Glyph; unfocused: Glyph }>;

export type TabIconName = keyof typeof glyphs;

/** `focused`, `color` and `size` come straight from the navigator's `tabBarIcon` callback. */
type Props = Pick<IconProps, 'color' | 'size' | 'testID'> & {
  name: TabIconName;
  focused: boolean;
};

/**
 * A tab bar icon. Without one, React Navigation draws its `⏷` placeholder
 * (`MissingIcon`) in every tab.
 */
export function TabIcon({ name, focused, ...props }: Props) {
  return (
    <Ionicons
      {...props}
      name={glyphs[name][focused ? 'focused' : 'unfocused']}
      // Decorative: the tab button already carries the tab's title as its label.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
