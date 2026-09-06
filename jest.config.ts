import type { Config } from 'jest';
// jest-expo's own preset only registers babel-jest for `.[jt]sx?` files (see
// jest-preset.js). Lingui 6 ships ESM-only `.mjs` files (no CJS build), so
// `@lingui/react`/`@lingui/core` need the same babel-jest transform applied
// to `.mjs` too, or Jest tries to `require()` their raw ESM and throws. We
// can't deep-merge `transform` (Jest replaces the preset's key wholesale if
// we set our own), so we spread the preset's transform map and add one entry.
// jest-expo ships no type declarations for this subpath.
// @ts-expect-error -- no declaration file for 'jest-expo/jest-preset.js'
import jestExpoPreset from 'jest-expo/jest-preset.js';

const config: Config = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^expo-secure-store$': '<rootDir>/src/test/mocks/expo-secure-store.ts',
    '^expo-sqlite/kv-store$': '<rootDir>/src/test/mocks/expo-sqlite-kv-store.ts',
    '^expo-updates$': '<rootDir>/src/test/mocks/expo-updates.ts',
  },
  transform: {
    ...jestExpoPreset.transform,
    '\\.mjs$': jestExpoPreset.transform['\\.[jt]sx?$'],
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
