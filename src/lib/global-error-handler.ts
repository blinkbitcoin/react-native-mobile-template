import { crashReporting } from './crash-reporting';

type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;

/**
 * React Native's global error hook. It is absent on web, so every caller has to
 * cope with `undefined` rather than assume the native runtime.
 */
export interface ErrorUtilsLike {
  getGlobalHandler: () => GlobalErrorHandler;
  setGlobalHandler: (handler: GlobalErrorHandler) => void;
}

const ambientErrorUtils = (): ErrorUtilsLike | undefined =>
  (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;

/**
 * Route errors thrown outside React's render tree to the crash reporter, then
 * chain to the handler that was already installed so the red box in dev and the
 * termination in release both survive.
 *
 * `errorUtils` is a parameter rather than a direct global read so the web case
 * (no hook at all) is a value a test can pass, not an unreachable branch.
 */
export function installGlobalErrorHandler(
  errorUtils: ErrorUtilsLike | undefined = ambientErrorUtils(),
): void {
  if (errorUtils === undefined) return;
  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    crashReporting.captureException(error, { isFatal: isFatal === true });
    previous(error, isFatal);
  });
}
