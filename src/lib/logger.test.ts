import { logger } from './logger';

test('logger forwards to console with a level prefix', () => {
  const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
  logger.info('hello', { a: 1 });
  expect(spy).toHaveBeenCalledWith('[info] hello', { a: 1 });
  spy.mockRestore();
});

test('logger forwards without meta when none is given', () => {
  const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  logger.warn('careful');
  expect(spy).toHaveBeenCalledWith('[warn] careful');
  spy.mockRestore();
});

test('error forwards to console.error', () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  logger.error('boom', { a: 1 });
  expect(spy).toHaveBeenCalledWith('[error] boom', { a: 1 });
  spy.mockRestore();
});

test('debug logs inside __DEV__', () => {
  const spy = jest.spyOn(console, 'debug').mockImplementation(() => {});
  const original = (globalThis as { __DEV__?: boolean | undefined }).__DEV__;
  (globalThis as { __DEV__?: boolean | undefined }).__DEV__ = true;
  logger.debug('x');
  expect(spy).toHaveBeenCalledWith('[debug] x');
  (globalThis as { __DEV__?: boolean | undefined }).__DEV__ = original;
  spy.mockRestore();
});

test('debug is silent outside __DEV__', () => {
  const spy = jest.spyOn(console, 'debug').mockImplementation(() => {});
  const original = (globalThis as { __DEV__?: boolean | undefined }).__DEV__;
  (globalThis as { __DEV__?: boolean | undefined }).__DEV__ = false;
  logger.debug('x');
  expect(spy).not.toHaveBeenCalled();
  (globalThis as { __DEV__?: boolean | undefined }).__DEV__ = original;
  spy.mockRestore();
});
