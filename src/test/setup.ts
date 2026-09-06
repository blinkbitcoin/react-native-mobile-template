// @testing-library/react-native@14 registers its Jest matchers as a side effect
// of importing the package itself; the old `/extend-expect` subpath was removed.
import '@testing-library/react-native';
import { setupServer } from 'msw/node';
import { createHandlers } from '../../mocks/msw';

export const server = setupServer(...createHandlers());

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
