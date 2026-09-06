type ConstantsModule = typeof import('./constants');

function loadConstants(
  expoConfig: Record<string, unknown> | undefined,
): ConstantsModule['constants'] {
  jest.doMock('expo-constants', () => ({
    __esModule: true,
    default: { expoConfig },
  }));
  let mod: ConstantsModule | undefined;
  jest.isolateModules(() => {
    // Jest's documented pattern for re-importing a module under a per-test mock is a
    // CJS `require()` inside `isolateModules`; a static `import` would be hoisted above
    // the `jest.doMock` call and a dynamic `import()` needs --experimental-vm-modules.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('./constants') as ConstantsModule;
  });
  return (mod as ConstantsModule).constants;
}

afterEach(() => {
  jest.dontMock('expo-constants');
  jest.resetModules();
});

test('reads version, iOS build number, and extra fields from a full config', () => {
  const constants = loadConstants({
    version: '1.2.3',
    ios: { buildNumber: '42' },
    android: { versionCode: 99 },
    extra: { variant: 'production', otaEnabled: true, buildStamp: 'production-abc1234-2026-09-06' },
  });
  expect(constants.version).toBe('1.2.3');
  expect(constants.buildNumber).toBe('42');
  expect(constants.variant).toBe('production');
  expect(constants.otaEnabled).toBe(true);
  expect(constants.buildStamp).toBe('production-abc1234-2026-09-06');
});

test('falls back to the Android version code when there is no iOS build number', () => {
  const constants = loadConstants({
    version: '1.0.0',
    android: { versionCode: 7 },
    extra: {},
  });
  expect(constants.buildNumber).toBe('7');
  expect(constants.variant).toBe('development');
  expect(constants.otaEnabled).toBe(false);
  expect(constants.buildStamp).toBe('unknown');
});

test('defaults everything when there is no expoConfig at all', () => {
  const constants = loadConstants(undefined);
  expect(constants.version).toBe('0.0.0');
  expect(constants.buildNumber).toBe('0');
  expect(constants.variant).toBe('development');
  expect(constants.otaEnabled).toBe(false);
  expect(constants.buildStamp).toBe('unknown');
});
