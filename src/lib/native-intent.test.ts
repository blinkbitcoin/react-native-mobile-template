import { redirectSystemPath } from './native-intent';

describe('redirectSystemPath', () => {
  it('rewrites legacy /d/:id paths to /details/:id', () => {
    expect(redirectSystemPath({ path: '/d/7', initial: false })).toBe('/details/7');
  });

  it('passes through paths that do not match the legacy pattern', () => {
    expect(redirectSystemPath({ path: '/details/7', initial: true })).toBe('/details/7');
  });
});
