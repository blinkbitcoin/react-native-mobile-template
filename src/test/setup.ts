// @testing-library/react-native@14 registers its Jest matchers as a side effect
// of importing the package itself; the old `/extend-expect` subpath was removed.
import '@testing-library/react-native';
import { setupServer } from 'msw/node';
import { createHandlers } from '../../mocks/msw';

export const server = setupServer(...createHandlers());

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// The silent-tests guard is not installed here: the shared Jest preset appends
// it after this file, so its `afterEach` runs after RNTL's auto-cleanup and
// MSW's reset and an un-acted update surfacing during unmount still fails.
