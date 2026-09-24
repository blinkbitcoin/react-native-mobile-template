# 6. Web is an opt-in target, strippable at template adoption

- **Status:** Accepted
- **Date:** 2026-09-05

## Context

Most apps started from this template are mobile-only, but some want a static
web build for marketing or a deep-link landing page. Shipping web
unconditionally taxes every mobile-only app with `react-native-web`,
Playwright, a Pages workflow and `.web.tsx` fallbacks it never runs; shipping
none means the first team that wants it rebuilds the path, badly.

## Decision

Web ships enabled and first-class, but every web-only path is listed in one
place, so the template's adoption script can strip it completely in one pass.

- `docs/web-files.txt` — the file list (`assets/favicon.png`, `e2e/web/`,
  `playwright.config.ts`, `src/app/+html.tsx`, the `.web.tsx` fallbacks), the
  same list the adoption script's manifest consumed.
- Non-file removals: the `app.config.ts` `web:` block, the `metro.config.js`
  web branch, `package.json` `web` / `build:web` / `test:e2e:web`, Makefile
  `dev-web` / `build-web` / `test-e2e-web`, `scripts/e2e/web.sh`,
  `.github/workflows/ci-web.yml`, `knip.json`'s `playwright` plugin key.
- Deployment is GitHub Pages from the gated production dispatch, not the tag
  push, so the site tracks what is actually live in the stores.

## Consequences

A mobile-only app declines web once, at adoption, and never sees Playwright or
`react-native-web` again; `make check`, `make test-unit` and `pnpm knip` must stay
green after the strip. The cost: a new web-only file has to join the list.

## Alternatives

- **Always ship web** — rejected: dead weight and a failing E2E lane for most.
- **Never ship web** — rejected: static-export and `.web.tsx` details are what
  teams get wrong unprompted.
- **A separate web template repo** — rejected: two repos to keep in sync.
