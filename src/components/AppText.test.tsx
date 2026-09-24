import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { buildTheme } from '../theme/tokens';
import { AppText } from './AppText';

test('renders children with the body variant by default', async () => {
  // @testing-library/react-native@14 made `render` async (it awaits pending
  // React updates internally); the brief's example predates that change.
  await render(<AppText>hello</AppText>);
  expect(screen.getByText('hello')).toBeOnTheScreen();
});

test('titles are heavy ink and captions step back in grey', async () => {
  await render(
    <>
      <AppText variant="title">title</AppText>
      <AppText>body</AppText>
      <AppText variant="caption">caption</AppText>
    </>,
  );
  const { colors, typography } = buildTheme('light');
  const styleOf = (text: string) => StyleSheet.flatten(screen.getByText(text).props.style);

  expect(styleOf('title')).toMatchObject({
    fontSize: typography.title,
    fontWeight: '700',
    color: colors.text,
  });
  expect(styleOf('body')).toMatchObject({ fontSize: typography.body, color: colors.text });
  expect(styleOf('caption')).toMatchObject({ fontSize: typography.caption, color: colors.muted });
});
