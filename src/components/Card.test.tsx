import { render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { buildTheme } from '../theme/tokens';
import { Card } from './Card';

test('renders its children inside a surface-coloured, bordered box', async () => {
  await render(
    <Card testID="card">
      <Text>inside</Text>
    </Card>,
  );
  const { colors, radii, spacing } = buildTheme('light');
  expect(screen.getByTestId('card')).toHaveTextContent('inside');
  expect(StyleSheet.flatten(screen.getByTestId('card').props.style)).toMatchObject({
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
  });
});

test('a caller style is applied over the card style', async () => {
  await render(<Card testID="card" style={{ padding: 0, marginTop: 8 }} />);
  expect(StyleSheet.flatten(screen.getByTestId('card').props.style)).toMatchObject({
    padding: 0,
    marginTop: 8,
    backgroundColor: buildTheme('light').colors.surface,
  });
});
