import { AppError, toUserMessage } from './errors';

test('AppError carries a code and cause', () => {
  const cause = new Error('boom');
  const e = new AppError('NETWORK', 'Network down', cause);
  expect(e.code).toBe('NETWORK');
  expect(e.cause).toBe(cause);
  expect(e).toBeInstanceOf(Error);
});

test('AppError without a cause has no cause property set', () => {
  const e = new AppError('UNKNOWN', 'oops');
  expect(e.cause).toBeUndefined();
});

test('toUserMessage maps known codes and falls back generically', () => {
  expect(toUserMessage(new AppError('NETWORK', 'x'))).toMatch(/connection/i);
  expect(toUserMessage(new AppError('UNAUTHENTICATED', 'x'))).toMatch(/sign in/i);
  expect(toUserMessage(new AppError('UNKNOWN', 'x'))).toMatch(/something went wrong/i);
  expect(toUserMessage(new Error('raw'))).toMatch(/something went wrong/i);
  expect(toUserMessage('not an error')).toMatch(/something went wrong/i);
});
