import { Stack } from 'expo-router';
import { renderRouter, screen, within } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';
import DetailsRoute from '@/app/details/[id]';
import { Providers } from '@/test/render';
import { buildTheme } from '@/theme/tokens';

test('details route reads the id param', async () => {
  await renderRouter(
    { _layout: () => <Stack />, 'details/[id]': DetailsRoute },
    { initialUrl: '/details/42', wrapper: Providers },
  );
  expect(screen.getByTestId('details-id')).toHaveTextContent('42');
});

test('details route falls back to an empty id when the route has no param', async () => {
  // Mounting the same component on a path with no `[id]` segment is the shape a
  // mistyped route takes: the param is simply absent and must not render
  // "undefined" to the user.
  await renderRouter(
    { _layout: () => <Stack />, index: DetailsRoute },
    { initialUrl: '/', wrapper: Providers },
  );
  expect(screen.getByTestId('details-id').props.children).toBe('');
});

test('the id sits in a card, under a caption naming it', async () => {
  await renderRouter(
    { _layout: () => <Stack />, 'details/[id]': DetailsRoute },
    { initialUrl: '/details/42', wrapper: Providers },
  );
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
