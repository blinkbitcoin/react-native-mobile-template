// Tests are silent on `console.error` and `console.warn`. The app logs through
// the injectable `logger`, and React Native reports un-acted state updates and
// invalid props through `console.error`, so a line on either method during a
// test is a bug — usually a missing `await waitFor`, not a logging need.
//
// `console.log` is deliberately NOT guarded: Metro, jest-expo and the Expo
// modules log progress through it in ways the app suite does not control.
//
// Two opt-outs, both explicit:
//   - `allowConsole('warn', /deprecated/)` — this test expects that line.
//   - `jest.spyOn(console, 'warn')` — a test that asserts on the logging takes
//     the method over and the recorder never sees the call.
//
// This module deliberately imports nothing, so the plain-node `plugins` Jest
// project can load it without pulling in RNTL or MSW.

export type GuardedConsoleMethod = 'error' | 'warn';

export const GUARDED_METHODS: readonly GuardedConsoleMethod[] = ['error', 'warn'];

export type ConsoleMatcher = string | RegExp;

export interface ConsoleCall {
  method: GuardedConsoleMethod;
  message: string;
}

export interface ConsoleLike {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

export interface ConsoleRecorder {
  /** Install the recording stubs. Safe to call once per test. */
  start: () => void;
  /** Restore the real methods and return the calls no allowance covered. */
  stop: () => ConsoleCall[];
  /** Permit matching output on `method` for the current test only. */
  allow: (method: GuardedConsoleMethod, matcher?: ConsoleMatcher) => void;
}

interface Allowance {
  method: GuardedConsoleMethod;
  // Not optional: `exactOptionalPropertyTypes` is on, and an allowance with no
  // matcher genuinely carries `undefined` — "match anything".
  matcher: ConsoleMatcher | undefined;
}

const formatArg = (arg: unknown): string =>
  arg instanceof Error ? `${arg.name}: ${arg.message}` : String(arg);

export const formatCall = ({ method, message }: ConsoleCall): string =>
  `console.${method}: ${message}`;

export const matches = (matcher: ConsoleMatcher | undefined, message: string): boolean => {
  if (matcher === undefined) return true;
  return typeof matcher === 'string' ? message.includes(matcher) : matcher.test(message);
};

const isAllowed = (allowances: readonly Allowance[], call: ConsoleCall): boolean =>
  allowances.some(
    (allowance) => allowance.method === call.method && matches(allowance.matcher, call.message),
  );

/**
 * Record `console.error` / `console.warn` on `target` between `start` and
 * `stop`. Kept as a factory with no Jest dependency so it is unit-testable
 * directly — `afterEach` cannot observe its own failure.
 *
 * The pristine methods are captured once, at construction, so a nested spy
 * installed by a test can never be mistaken for the real implementation.
 */
export const createConsoleRecorder = (target: ConsoleLike = console): ConsoleRecorder => {
  const pristine: Pick<ConsoleLike, GuardedConsoleMethod> = {
    error: target.error,
    warn: target.warn,
  };
  let calls: ConsoleCall[] = [];
  let allowances: Allowance[] = [];

  return {
    start() {
      calls = [];
      allowances = [];
      for (const method of GUARDED_METHODS) {
        target[method] = (...args: unknown[]) => {
          calls.push({ method, message: args.map(formatArg).join(' ') });
        };
      }
    },
    stop() {
      for (const method of GUARDED_METHODS) {
        target[method] = pristine[method];
      }
      const unexpected = calls.filter((call) => !isAllowed(allowances, call));
      calls = [];
      allowances = [];
      return unexpected;
    },
    allow(method, matcher) {
      allowances.push({ method, matcher });
    },
  };
};

export const formatFailure = (unexpected: readonly ConsoleCall[]): string =>
  [
    'unexpected console output during the test:',
    ...unexpected.map(formatCall),
    '',
    'A console line is usually a missing `await waitFor`, not a logging need.',
    "Deliberate output opts out with allowConsole('warn', /matcher/).",
  ].join('\n');

const recorder = createConsoleRecorder();

/**
 * Allow matching `console[method]` output for the remainder of the current
 * test. Without a matcher every line on that method is allowed; with one, only
 * matching lines are — anything else still fails the test.
 */
export const allowConsole = (method: GuardedConsoleMethod, matcher?: ConsoleMatcher): void => {
  recorder.allow(method, matcher);
};

/**
 * Stop `target` and throw when it recorded output no allowance covered. Split
 * out of `installConsoleGuard` for the same reason `createConsoleRecorder` is a
 * factory: the ambient `afterEach` cannot observe its own failure, so this is
 * the seam a test drives directly.
 */
export const assertSilent = (target: ConsoleRecorder): void => {
  const unexpected = target.stop();
  if (unexpected.length > 0) {
    throw new Error(formatFailure(unexpected));
  }
};

/** Wire the recorder into the ambient Jest lifecycle. Called from setup files. */
export const installConsoleGuard = (): void => {
  beforeEach(() => {
    recorder.start();
  });
  afterEach(() => {
    assertSilent(recorder);
  });
};
