import { render, screen } from '@testing-library/react-native';
import { AppText } from './AppText';

test('renders children with the body variant by default', async () => {
  // @testing-library/react-native@14 made `render` async (it awaits pending
  // React updates internally); the brief's example predates that change.
  await render(<AppText>hello</AppText>);
  expect(screen.getByText('hello')).toBeOnTheScreen();
});
