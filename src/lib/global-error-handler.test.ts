import { crashReporting } from './crash-reporting';
import { type ErrorUtilsLike, installGlobalErrorHandler } from './global-error-handler';

type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;

function fakeErrorUtils(previous: GlobalErrorHandler) {
  let handler = previous;
  const errorUtils: ErrorUtilsLike = {
    getGlobalHandler: () => handler,
    setGlobalHandler: (next) => {
      handler = next;
    },
  };
  return { errorUtils, current: () => handler };
}

afterEach(() => {
  jest.restoreAllMocks();
});

test.each([
  ['a fatal error', true, true],
  ['an error with no fatality flag', undefined, false],
])('reports %s and chains to the previous handler', (_case, isFatal, expected) => {
  const captureException = jest.spyOn(crashReporting, 'captureException').mockImplementation();
  const previous = jest.fn();
  const { errorUtils, current } = fakeErrorUtils(previous);
  const error = new Error('boom');

  installGlobalErrorHandler(errorUtils);
  current()(error, isFatal);

  expect(captureException).toHaveBeenCalledWith(error, { isFatal: expected });
  expect(previous).toHaveBeenCalledWith(error, isFatal);
});

test('does nothing where the hook is absent, as it is on web', () => {
  const globals = globalThis as { ErrorUtils?: ErrorUtilsLike | undefined };
  const captureException = jest.spyOn(crashReporting, 'captureException').mockImplementation();
  const original = globals.ErrorUtils;
  delete globals.ErrorUtils;
  try {
    expect(() => {
      installGlobalErrorHandler();
    }).not.toThrow();
    expect(captureException).not.toHaveBeenCalled();
  } finally {
    globals.ErrorUtils = original;
  }
});

test('defaults to the ambient ErrorUtils when no hook is passed', () => {
  const globals = globalThis as { ErrorUtils?: ErrorUtilsLike | undefined };
  const previous = jest.fn();
  const { errorUtils, current } = fakeErrorUtils(previous);
  const original = globals.ErrorUtils;
  globals.ErrorUtils = errorUtils;
  try {
    installGlobalErrorHandler();
    expect(current()).not.toBe(previous);
  } finally {
    globals.ErrorUtils = original;
  }
});
