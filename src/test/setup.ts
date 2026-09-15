// @testing-library/react-native@14 registers its Jest matchers as a side effect
// of importing the package itself; the old `/extend-expect` subpath was removed.
import '@testing-library/react-native';
import { setupServer } from 'msw/node';
import { createHandlers } from '../../mocks/msw';
import { installConsoleGuard } from './console';

export const server = setupServer(...createHandlers());

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Registered last so its `afterEach` runs after RNTL's auto-cleanup and MSW's
// reset: an un-acted update surfacing during unmount must still fail the test.
installConsoleGuard();
