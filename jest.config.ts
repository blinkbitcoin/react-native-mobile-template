import type { Config } from 'jest';

const config: Config = {
  preset: 'jest-expo',
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
    'node_modules/(?!\\.pnpm/)(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@lingui/.*|@messageformat/.*|msw|@mswjs/.*|until-async|standard-navigation)',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/e2e/', '/plugins/', '/scripts/'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    'modules/*/index.ts',
    '!src/**/*.test.*',
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
  },
};

export default config;
