# 4. Lingui for i18n, with catalogs compiled to TypeScript

- **Status:** Accepted
- **Date:** 2026-09-05 (compiled catalogs ruled on 2026-09-06)

## Context

Typed i18n has to survive Metro, Jest and a static web export. Key-based
libraries (`i18next`, `typesafe-i18n`) make the source unreadable and let
translators invent key names; Lingui's macros keep English in the JSX and
extract it. Lingui 6 is ESM-only and documents a Metro transformer for `.po`
files — a plugin to keep alive that helps neither Jest nor the static export.

## Decision

Lingui macros for source strings, `.po` as the translator-facing format, and
catalogs **compiled to committed TypeScript** — no Metro transformer. `make
i18n` runs `lingui extract --clean && lingui compile`; `make check-gen` fails
when the result differs from what is committed.

- `lingui.config.ts` — locales `en`, `es`, `compileNamespace: 'ts'`; `format`
  is omitted because `@lingui/conf@6.6` rejects `format: 'po'` as a string.
- `src/i18n/locales/{en,es}/messages.po` (edited) and `messages.ts`
  (generated, committed, excluded from Biome, ESLint, typos and knip).
- `src/i18n/i18n.ts` — imports the compiled catalogs and activates the device
  locale; `I18nProvider.tsx` sits under the theme provider.
- `scripts/check-i18n.sh`; `package.json` `i18n:extract` / `i18n:check`.

## Consequences

Metro, Jest and the web export all just import a module, so there is no
transformer and no test-environment special case. The price is a generated file
in git plus a drift check: forgetting `make i18n` after adding a string fails
`make check-gen` rather than failing at runtime. Translators still get `.po`.

## Alternatives

- **Lingui with the Metro transformer** — rejected, see Context.
- **i18next with typed resources** — rejected: key soup, weaker extraction.
- **typesafe-i18n** — rejected: small ecosystem, its own codegen pipeline.
