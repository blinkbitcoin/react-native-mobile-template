import Ionicons from '@expo/vector-icons/Ionicons';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';

// Without a loaded font, vector icons render an empty string, so the tab icon
// test below could pass on any icon at all. A module mock, because
// `jest.spyOn` cannot redefine an ES module namespace export; the other tests
// here do not read glyphs, so reporting the font loaded changes nothing for them.
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), isLoaded: () => true }));

test('every tab has an icon, filled on the active tab and outlined on the rest', async () => {
  const router = renderRouter('src/app', { initialUrl: '/' });
  await router;

  // The tab bar renders every icon twice, once `focused` and once not, and
  // cross-fades the two layers by opacity. The one a user sees is the layer at
  // opacity 1, so that is the one asserted.
  const glyphOf = (testID: string) => {
    const layers = screen.getAllByTestId(testID, { includeHiddenElements: true });
    const visible = layers.filter(
      (layer) => StyleSheet.flatten(layer.parent?.props.style)?.opacity === 1,
    );
    expect(visible).toHaveLength(1);
    return visible[0];
  };
  // Same resolution as the icon set itself: code points are numbers, a few are strings.
  const glyph = (name: keyof typeof Ionicons.glyphMap) => {
    const code = Ionicons.glyphMap[name];
    return typeof code === 'number' ? String.fromCodePoint(code) : code;
  };

  // React Navigation's `MissingIcon` placeholder is what a tab without
  // `tabBarIcon` draws; it must not appear anywhere in the bar.
  expect(screen.queryByText('⏷', { includeHiddenElements: true })).toBeNull();
  expect(glyphOf('tab-home-icon')).toHaveTextContent(glyph('home'));
  expect(glyphOf('tab-settings-icon')).toHaveTextContent(glyph('settings-outline'));

  await act(async () => {
    fireEvent.press(screen.getByTestId('tab-settings'));
  });

  expect(router.getPathname()).toBe('/settings');
  expect(glyphOf('tab-home-icon')).toHaveTextContent(glyph('home-outline'));
  expect(glyphOf('tab-settings-icon')).toHaveTextContent(glyph('settings'));
});
