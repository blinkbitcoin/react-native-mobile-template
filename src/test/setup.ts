import '@testing-library/react-native';
import { setupServer } from 'msw/node';
import { createHandlers } from '../../mocks/msw';

export const server = setupServer(...createHandlers());

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
