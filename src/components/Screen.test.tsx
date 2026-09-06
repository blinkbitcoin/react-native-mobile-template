import { StyleSheet } from 'react-native';
import { renderWithProviders, screen } from '@/test/render';
import { AppText } from './AppText';
import { Screen } from './Screen';

test('the scrolling variant does not pin its content container to the viewport', async () => {
  await renderWithProviders(
    <Screen testID="scroll-screen" scroll accessibilityLabel="scrolling body">
      <AppText>content</AppText>
    </Screen>,
  );

  const body = screen.getByLabelText('scrolling body');
  const content = StyleSheet.flatten(body.props.contentContainerStyle);
  // `flex: 1` here would clamp the content to one screen and kill scrolling.
  expect(content.flex).toBeUndefined();
  expect(content.flexGrow).toBe(1);
  expect(content.padding).toBeGreaterThan(0);
  expect(StyleSheet.flatten(body.props.style)).toMatchObject({ flex: 1 });
});

test('extra view props reach the container in both variants', async () => {
  await renderWithProviders(
    <Screen testID="plain-screen" accessibilityLabel="plain body">
      <AppText>content</AppText>
    </Screen>,
  );

  const body = screen.getByLabelText('plain body');
  expect(body).toBeOnTheScreen();
  // The non-scrolling variant carries both style layers on the view itself.
  expect(StyleSheet.flatten(body.props.style)).toMatchObject({ flex: 1, flexGrow: 1 });
});

test('a caller style is merged over the defaults in both variants', async () => {
  await renderWithProviders(
    <>
      <Screen testID="styled-plain" accessibilityLabel="plain body" style={{ padding: 42 }}>
        <AppText>content</AppText>
      </Screen>
      <Screen
        testID="styled-scroll"
        scroll
        accessibilityLabel="scrolling body"
        style={{ backgroundColor: 'rebeccapurple' }}
      >
        <AppText>content</AppText>
      </Screen>
    </>,
  );

  // Merged, not replaced: the defaults survive next to the caller's override.
  expect(StyleSheet.flatten(screen.getByLabelText('plain body').props.style)).toMatchObject({
    flex: 1,
    flexGrow: 1,
    padding: 42,
  });
  expect(StyleSheet.flatten(screen.getByLabelText('scrolling body').props.style)).toMatchObject({
    flex: 1,
    backgroundColor: 'rebeccapurple',
  });
});
