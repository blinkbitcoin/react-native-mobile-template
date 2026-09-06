import { fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@/test/render';
import { ErrorFallback } from './ErrorFallback';

test('shows a friendly message and retries', async () => {
  const reset = jest.fn();
  await renderWithProviders(<ErrorFallback error={new Error('boom')} resetErrorBoundary={reset} />);
  expect(screen.getByTestId('error-screen')).toBeOnTheScreen();
  fireEvent.press(screen.getByTestId('error-retry'));
  expect(reset).toHaveBeenCalled();
});
