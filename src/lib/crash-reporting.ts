// Slot for Sentry/Crashlytics. Ship-time default is a no-op; see
// docs/ota-and-crash-reporting.md for the Sentry recipe.
export interface CrashReporter {
  captureException(error: unknown, context?: Record<string, unknown>): void;
  setUser(id: string | null): void;
}

const noop: CrashReporter = { captureException: () => {}, setUser: () => {} };
let current: CrashReporter = noop;

export function setCrashReporter(reporter: CrashReporter) {
  current = reporter;
}

export const crashReporting: CrashReporter = {
  captureException: (e, c) => current.captureException(e, c),
  setUser: (id) => current.setUser(id),
};
