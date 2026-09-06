import { crashReporting, setCrashReporter } from './crash-reporting';

test('default reporter is a no-op and can be swapped', () => {
  expect(() => crashReporting.captureException(new Error('x'))).not.toThrow();
  expect(() => crashReporting.setUser(null)).not.toThrow();
  const fake = { captureException: jest.fn(), setUser: jest.fn() };
  setCrashReporter(fake);
  crashReporting.captureException(new Error('y'), { where: 'test' });
  crashReporting.setUser('u1');
  expect(fake.captureException).toHaveBeenCalledWith(expect.any(Error), { where: 'test' });
  expect(fake.setUser).toHaveBeenCalledWith('u1');
});
