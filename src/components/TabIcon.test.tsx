import Ionicons from '@expo/vector-icons/Ionicons';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { TabIcon } from './TabIcon';

// Until `expo-font` reports the font loaded, the icon renders an empty string,
// which would make every glyph assertion below pass vacuously. Reporting it
// loaded makes the icon render its real glyph synchronously. (A module mock,
// because `jest.spyOn` cannot redefine an ES module namespace export.)
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), isLoaded: () => true }));

// The icon is hidden from accessibility on purpose, so default queries skip it.
const icon = () => screen.getByTestId('icon', { includeHiddenElements: true });
// Same resolution as the icon set itself: code points are numbers, a few are strings.
const glyph = (name: keyof typeof Ionicons.glyphMap) => {
  const code = Ionicons.glyphMap[name];
  return typeof code === 'number' ? String.fromCodePoint(code) : code;
};

test.each([
  ['home', true, 'home'],
  ['home', false, 'home-outline'],
  ['settings', true, 'settings'],
  ['settings', false, 'settings-outline'],
] as const)('%s, focused=%s, draws the %s glyph', async (name, focused, expected) => {
  await render(<TabIcon name={name} focused={focused} color="#123456" size={24} testID="icon" />);

  expect(icon()).toHaveTextContent(glyph(expected));
});

test('takes its colour and size from the navigator', async () => {
  await render(<TabIcon name="home" focused color="#123456" size={31} testID="icon" />);

  expect(StyleSheet.flatten(icon().props.style)).toMatchObject({ color: '#123456', fontSize: 31 });
});

test('is decorative: screen readers skip it, the tab label speaks for it', async () => {
  await render(<TabIcon name="settings" focused={false} color="#000" size={24} testID="icon" />);

  expect(screen.queryByTestId('icon')).toBeNull();
  expect(icon().props).toMatchObject({
    accessibilityElementsHidden: true,
    importantForAccessibility: 'no-hide-descendants',
  });
});
