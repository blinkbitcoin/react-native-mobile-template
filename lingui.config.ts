import { defineConfig } from '@lingui/cli';

export default defineConfig({
  sourceLocale: 'en',
  locales: ['en', 'es'],
  catalogs: [{ path: '<rootDir>/src/i18n/locales/{locale}/messages', include: ['<rootDir>/src'] }],
  // `format: 'po'` (as a string) is no longer accepted by @lingui/conf@6.6.0's
  // `CatalogFormatter` type — po is the default formatter when `format` is omitted.
  compileNamespace: 'ts',
});
