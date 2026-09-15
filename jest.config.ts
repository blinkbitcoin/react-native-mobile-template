import type { Config } from 'jest';

const config: Config = {
  // Two projects: the app suite (jest-expo, RN environment) and the config
  // plugins suite (plain node, no RN preset — plugins run inside the Expo CLI).
  // Project-scoped options (setupFiles, moduleNameMapper, transforms, …) must
  // live inside each project; only coverage options stay at the top level.
  projects: [
    {
      displayName: 'app',
      preset: 'jest-expo',
      // 15s, not Jest's 5s. The screen-level RNTL suites finish well inside a
      // second when the machine is idle, but two SettingsScreen tests went over
      // 5s under load, which is a flake, not a real failure.
      testTimeout: 15000,
      setupFiles: ['<rootDir>/src/test/env.ts'],
      setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        '^expo-secure-store$': '<rootDir>/src/test/mocks/expo-secure-store.ts',
        '^expo-sqlite/kv-store$': '<rootDir>/src/test/mocks/expo-sqlite-kv-store.ts',
        '^expo-updates$': '<rootDir>/src/test/mocks/expo-updates.ts',
      },
      // Lingui 6 ships `.mjs`, which jest-expo's transform does not cover; Jest
      // merges this with the preset's own `transform` map (see
      // mergeOptionWithPreset in jest-config), so jest-expo's `.[jt]sx?` entry
      // stays intact.
      transform: {
        '\\.mjs$': 'babel-jest',
      },
      // The (?!\.pnpm/) guard skips pnpm's nested `.pnpm/<pkg>/node_modules/` hop so the
      // exclusion list below matches against the real inner package name, not the pnpm store dir.
      transformIgnorePatterns: [
        'node_modules/(?!\\.pnpm/)(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@lingui/.*|@messageformat/.*|msw|@mswjs/.*|@open-draft/.*|@bundled-es-modules/.*|until-async|rettime|outvariant|strict-event-emitter|is-node-process|headers-polyfill|path-to-regexp|cookie|statuses|tough-cookie|picocolors|standard-navigation)',
      ],
      // `/plugins/` stays ignored here because the app project has no explicit
      // `testMatch`: without it, jest-expo would pick the plugin suites up as
      // well and every plugin test would run twice (once per project).
      testPathIgnorePatterns: ['/node_modules/', '/e2e/', '/plugins/', '/scripts/'],
    },
    {
      displayName: 'plugins',
      testEnvironment: 'node',
      testTimeout: 15000,
      // The console guard applies to both projects; this one gets its own setup
      // file because `src/test/setup.ts` pulls in RNTL and MSW.
      setupFilesAfterEnv: ['<rootDir>/src/test/setup.plugins.ts'],
      testMatch: ['<rootDir>/plugins/**/*.test.ts'],
      // `.tsx` is in the pattern even though no plugin suite uses JSX: coverage
      // options are global, so this project also instruments the app's untested
      // `.tsx` files (e.g. platform variants) and needs a transform for them.
      transform: {
        '^.+\\.tsx?$': ['babel-jest', { presets: ['babel-preset-expo'] }],
      },
    },
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    'modules/*/index.ts',
    'plugins/*.ts',
    '!src/**/*.test.*',
    '!src/**/*.d.ts',
    '!plugins/*.test.ts',
    '!src/test/**',
    '!src/graphql/generated/**',
    '!src/i18n/locales/**',
    '!src/app/**',
  ],
  coverageThreshold: {
    global: { lines: 80, branches: 80 },
    'src/config/**': { lines: 100, branches: 100 },
    'src/lib/**': { lines: 100, branches: 100 },
    'modules/*/index.ts': { lines: 100, branches: 100 },
    'plugins/**': { lines: 100, branches: 100 },
  },
};

export default config;
