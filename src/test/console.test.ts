import {
  allowConsole,
  assertSilent,
  type ConsoleLike,
  createConsoleRecorder,
  formatCall,
  formatFailure,
  GUARDED_METHODS,
  matches,
} from './console';

/** A stand-in console so the recorder can be driven without touching the real one. */
function fakeConsole() {
  const seen: string[] = [];
  const target: ConsoleLike = {
    error: (...args: unknown[]) => seen.push(`real error ${args.join(' ')}`),
    warn: (...args: unknown[]) => seen.push(`real warn ${args.join(' ')}`),
  };
  return { target, seen };
}

test('the guard fires: an unmatched line is reported by stop()', () => {
  const { target } = fakeConsole();
  const recorder = createConsoleRecorder(target);
  recorder.start();
  target.warn('something slipped out');
  expect(recorder.stop()).toEqual([{ method: 'warn', message: 'something slipped out' }]);
});

test('a silent test reports nothing', () => {
  const { target } = fakeConsole();
  const recorder = createConsoleRecorder(target);
  recorder.start();
  expect(recorder.stop()).toEqual([]);
});

test('console.log is not guarded — only error and warn are', () => {
  expect(GUARDED_METHODS).toEqual(['error', 'warn']);
});

test('recording joins arguments and names Errors readably', () => {
  const { target } = fakeConsole();
  const recorder = createConsoleRecorder(target);
  recorder.start();
  target.error('failed:', new TypeError('bad prop'), { id: 1 });
  expect(recorder.stop()).toEqual([
    { method: 'error', message: 'failed: TypeError: bad prop [object Object]' },
  ]);
});

test('an allowance without a matcher permits every line on that method', () => {
  const { target } = fakeConsole();
  const recorder = createConsoleRecorder(target);
  recorder.start();
  recorder.allow('warn');
  target.warn('anything at all');
  expect(recorder.stop()).toEqual([]);
});

test('an allowance is scoped to its method', () => {
  const { target } = fakeConsole();
  const recorder = createConsoleRecorder(target);
  recorder.start();
  recorder.allow('warn');
  target.error('boom');
  expect(recorder.stop()).toEqual([{ method: 'error', message: 'boom' }]);
});

test('a string matcher allows only the lines containing it', () => {
  const { target } = fakeConsole();
  const recorder = createConsoleRecorder(target);
  recorder.start();
  recorder.allow('warn', 'GraphQL error in X');
  target.warn('[warn] GraphQL error in X', 'meta');
  target.warn('[warn] something else');
  expect(recorder.stop()).toEqual([{ method: 'warn', message: '[warn] something else' }]);
});

test('a RegExp matcher works the same way', () => {
  const { target } = fakeConsole();
  const recorder = createConsoleRecorder(target);
  recorder.start();
  recorder.allow('error', /^\[error] Network/);
  target.error('[error] Network error in X');
  target.error('trailing [error] Network error in X');
  expect(recorder.stop()).toEqual([
    { method: 'error', message: 'trailing [error] Network error in X' },
  ]);
});

test('allowances and recorded calls do not leak into the next test', () => {
  const { target } = fakeConsole();
  const recorder = createConsoleRecorder(target);
  recorder.start();
  recorder.allow('warn');
  target.warn('allowed here');
  recorder.stop();

  recorder.start();
  target.warn('not allowed any more');
  expect(recorder.stop()).toEqual([{ method: 'warn', message: 'not allowed any more' }]);
});

test('stop() restores the real methods', () => {
  const { target, seen } = fakeConsole();
  const recorder = createConsoleRecorder(target);
  recorder.start();
  target.warn('captured');
  recorder.stop();
  target.warn('passed through');
  expect(seen).toEqual(['real warn passed through']);
});

test('a spy installed on top is never mistaken for the real method', () => {
  const { target, seen } = fakeConsole();
  const recorder = createConsoleRecorder(target);
  recorder.start();
  // A test that spies takes the method over: the recorder sees nothing.
  const outer = target.warn;
  target.warn = () => {};
  target.warn('swallowed by the spy');
  expect(recorder.stop()).toEqual([]);
  // …and the pristine method comes back, not the recorder and not the spy.
  expect(target.warn).not.toBe(outer);
  target.warn('passed through');
  expect(seen).toEqual(['real warn passed through']);
});

test('matches() treats an absent matcher as "anything"', () => {
  expect(matches(undefined, 'whatever')).toBe(true);
  expect(matches('needle', 'a needle here')).toBe(true);
  expect(matches('needle', 'nothing here')).toBe(false);
  expect(matches(/^a/, 'abc')).toBe(true);
});

test('the failure message names every call and points at the usual cause', () => {
  const message = formatFailure([
    { method: 'error', message: 'not wrapped in act(...)' },
    { method: 'warn', message: 'deprecated' },
  ]);
  expect(message).toContain('console.error: not wrapped in act(...)');
  expect(message).toContain('console.warn: deprecated');
  expect(message).toContain('await waitFor');
  expect(formatCall({ method: 'warn', message: 'x' })).toBe('console.warn: x');
});

// `assertSilent` is what the ambient `afterEach` calls. Driving it here is the
// only way to reach its throwing branch: an `afterEach` cannot fail itself and
// then report on it.
test('assertSilent stops the recorder and says nothing when the test was silent', () => {
  const { target, seen } = fakeConsole();
  const recorder = createConsoleRecorder(target);
  recorder.start();
  expect(() => {
    assertSilent(recorder);
  }).not.toThrow();
  // It stops as well as asserts: the real methods are back afterwards.
  target.warn('passed through');
  expect(seen).toEqual(['real warn passed through']);
});

test('assertSilent throws a message naming every unexpected line', () => {
  const { target } = fakeConsole();
  const recorder = createConsoleRecorder(target);
  recorder.start();
  target.error('not wrapped in act(...)');
  target.warn('and a warning');
  expect(() => {
    assertSilent(recorder);
  }).toThrow(/console\.error: not wrapped in act\(\.\.\.\)[\s\S]*console\.warn: and a warning/);
});

// The two integration cases below run against the live guard installed by
// `src/test/setup.ts`: they pass only because the opt-outs really work.
test('allowConsole() opts out of the live guard', () => {
  allowConsole('warn', 'deliberate');
  console.warn('deliberate output');
});

test('spying on the method opts out of the live guard naturally', () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  console.error('swallowed');
  expect(spy).toHaveBeenCalledWith('swallowed');
  spy.mockRestore();
});
