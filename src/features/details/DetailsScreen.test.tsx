import { StyleSheet } from 'react-native';
import { renderWithProviders, screen, within } from '@/test/render';
import { buildTheme } from '@/theme/tokens';
import { DetailsScreen } from './DetailsScreen';

test('the id sits in a card, under a caption naming it', async () => {
  await renderWithProviders(<DetailsScreen id="42" />);
  const { colors, typography } = buildTheme('light');
  // <Trans> renders its string in a nested, unstyled Text: read the styled one.
  type Node = ReturnType<typeof screen.getByText> | null;
  const styledAncestor = (node: Node) => {
    let current = node;
    while (current && !current.props.style) current = current.parent;
    return current;
  };
  const caption = styledAncestor(screen.getByText('Identifier'));
  expect(StyleSheet.flatten(caption?.props.style)).toMatchObject({
    fontSize: typography.caption,
    color: colors.muted,
  });
  // The card is the surface-coloured box around the id; the caption is in it.
  let card: Node = screen.getByTestId('details-id').parent;
  while (card && StyleSheet.flatten(card.props.style)?.backgroundColor !== colors.surface) {
    card = card.parent;
  }
  expect(card).toBeTruthy();
  expect(StyleSheet.flatten(card?.props.style)).toMatchObject({ borderColor: colors.border });
  expect(within(card as NonNullable<Node>).getByText('Identifier')).toBeOnTheScreen();
});
