jest.mock('../src/HelloNativeModule');

import { getBuildStamp, HelloNativeError, hello, platformName } from '..';

test('hello validates input and proxies to native', () => {
  expect(hello('Ada')).toBe('Hello, Ada from mock');
  expect(() => hello('')).toThrow(HelloNativeError);
});

test('getBuildStamp resolves', async () => {
  await expect(getBuildStamp()).resolves.toBe('mock-stamp');
});

test('platformName is exposed', () => {
  expect(platformName).toBe('mock');
});

test('missing native module produces a helpful error', () => {
  // Jest keeps a loaded manual mock in its mock registry, and that cached entry
  // wins over a later `doMock` factory; resetting the registries first lets the
  // throwing factory below stand in for an absent native module.
  jest.resetModules();
  jest.isolateModules(() => {
    jest.doMock('../src/HelloNativeModule', () => {
      throw new Error("Cannot find native module 'HelloNative'");
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the wrapper has to be re-required inside the isolated module registry
    const isolated = require('..') as typeof import('..');
    expect(() => isolated.hello('x')).toThrow(/make ios/);
    expect(isolated.platformName).toBe('unavailable');
  });
});
