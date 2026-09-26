import { screen } from '@testing-library/react-native';
import { renderWithProviders } from '@/test/render';
import { NativeDemoCard as WebNativeDemoCard } from './NativeDemoCard.web';

test('the web variant explains that the native demo is unavailable', async () => {
  await renderWithProviders(<WebNativeDemoCard />);

  expect(screen.getByTestId('native-hello')).toHaveTextContent('Native demo unavailable on web');
});
