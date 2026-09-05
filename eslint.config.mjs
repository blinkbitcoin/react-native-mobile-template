// ESLint owns ONLY React/Expo semantic rules (react-hooks incl. React Compiler
// rules, expo env-var rules). Biome owns formatting, import order and generic
// lint. Nothing is enabled in both. See docs/quality.md.
import { defineConfig, globalIgnores } from 'eslint/config';
import expoConfig from 'eslint-config-expo/flat.js';
import globals from 'globals';

export default defineConfig([
  globalIgnores([
    'ios/**',
    'android/**',
    '.expo/**',
    'dist/**',
    'coverage/**',
    '.rnw/**',
    'src/graphql/generated/**',
    'src/i18n/locales/**/messages.ts',
  ]),
  ...(Array.isArray(expoConfig) ? expoConfig : [expoConfig]),
  {
    rules: {
      // Biome-owned: turn off anything stylistic or ordering-related from the preset
      'import/order': 'off',
      'import/first': 'off',
      'import/no-duplicates': 'off',
      'prettier/prettier': 'off',
    },
  },
  {
    files: ['babel.config.js', 'metro.config.js', 'scripts/**/*.mjs', 'mocks/server.ts'],
    languageOptions: { globals: globals.node },
  },
]);
