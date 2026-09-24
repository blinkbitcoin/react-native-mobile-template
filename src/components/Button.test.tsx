import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { type StyleProp, StyleSheet, type ViewStyle } from 'react-native';
import { renderWithProviders } from '@/test/render';
import { buildTheme } from '../theme/tokens';
import { Button } from './Button';

// Pressable feeds `pressed` from Pressability, which listens on the responder
// handlers rather than an `onPressIn` prop, so `fireEvent(el, 'pressIn')` never
// reaches it. Granting the responder is the event that actually flips the flag.
//
// Shaped against react-native 0.86.3, whose Pressability grant path reads
// `persist()`, `currentTarget` and `nativeEvent`. An upgrade that reshapes that
// payload fails this test loudly rather than passing silently: compare with
// `Libraries/Pressability/Pressability.js` and extend the stub.
const responderEvent = {
  persist: () => {},
  nativeEvent: {
    touches: [],
    changedTouches: [],
    identifier: 1,
    locationX: 0,
    locationY: 0,
    pageX: 0,
    pageY: 0,
    target: 1,
    timestamp: 0,
  },
  currentTarget: 1,
  touchHistory: {
    touchBank: [],
    numberActiveTouches: 0,
    indexOfSingleActiveTouch: 0,
    mostRecentTimeStamp: 0,
  },
};

const opacityOf = (testID: string) =>
  StyleSheet.flatten(screen.getByTestId(testID).props.style as StyleProp<ViewStyle>).opacity;

test('reports presses to onPress', async () => {
  const onPress = jest.fn();
  await render(<Button title="Go" testID="go" onPress={onPress} />);

  fireEvent.press(screen.getByTestId('go'));

  expect(screen.getByText('Go')).toBeOnTheScreen();
  expect(onPress).toHaveBeenCalledTimes(1);
});

test('dims itself while it is being pressed', async () => {
  await render(<Button title="Go" testID="go" onPress={jest.fn()} />);

  expect(opacityOf('go')).toBeUndefined();

  await act(async () => {
    fireEvent(screen.getByTestId('go'), 'responderGrant', responderEvent);
  });

  expect(opacityOf('go')).toBe(0.6);
});

const styleOf = (testID: string) =>
  StyleSheet.flatten(screen.getByTestId(testID).props.style as StyleProp<ViewStyle>);

test('is filled by default and outlined as a secondary action', async () => {
  await renderWithProviders(
    <>
      <Button title="Main" testID="main" onPress={jest.fn()} />
      <Button title="Other" testID="other" variant="secondary" onPress={jest.fn()} />
    </>,
  );
  const { colors } = buildTheme('light');

  // Filled: the button is ink-coloured and its label is the inverse.
  expect(styleOf('main')).toMatchObject({ backgroundColor: colors.primary });
  expect(StyleSheet.flatten(screen.getByText('Main').props.style).color).toBe(colors.onPrimary);
  // Outlined: page-coloured with a hairline-grey border and ink text.
  expect(styleOf('other')).toMatchObject({
    backgroundColor: colors.background,
    borderColor: colors.border,
  });
  expect(StyleSheet.flatten(screen.getByText('Other').props.style).color).toBe(colors.text);
});
