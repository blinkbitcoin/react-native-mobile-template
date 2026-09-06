import { render, screen } from '@testing-library/react-native';
import { AppText } from './AppText';
import { Providers } from './Providers';

function Boom(): never {
  throw new Error('boom');
}

test('the provider stack renders its children', async () => {
  await render(
    <Providers>
      <AppText testID="child">hello</AppText>
    </Providers>,
  );
  expect(screen.getByTestId('child')).toHaveTextContent('hello');
});

test('the error boundary catches a render error and shows the localized fallback', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await render(
      <Providers>
        <Boom />
      </Providers>,
    );
    expect(screen.getByTestId('error-screen')).toBeOnTheScreen();
  } finally {
    spy.mockRestore();
  }
});

test('the boundary can be opted out of, so errors propagate to the caller', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await expect(
      render(
        <Providers withErrorBoundary={false}>
          <Boom />
        </Providers>,
      ),
    ).rejects.toThrow('boom');
  } finally {
    spy.mockRestore();
  }
});
