# Mock GraphQL API

`schema.graphql` is the single source of truth for the API this template talks to. It is what
`codegen.ts` reads to generate typed documents into `src/graphql/generated/`, and it is what
`resolvers.ts` implements. Change the schema here and every consumer — generated types, the local
server, and the tests — moves with it in one step.

There are two ways to run that schema. `pnpm mock-api` (or `make mock-api`) starts a
[graphql-yoga](https://the-guild.dev/graphql/yoga-server) server on `http://localhost:4000/graphql`,
which is what simulators and devices point at through `EXPO_PUBLIC_API_URL`. Jest (and Playwright,
should you add it) instead use `msw.ts`, whose handlers execute the very same executable schema
in-process via MSW. Both paths share `executable-schema.ts` and `resolvers.ts`, so a test can never
pass against a hand-written response that the real server would not produce. These files are
Node-only — `executable-schema.ts` reads the SDL with `node:fs` — so nothing under `src/` may import
them, or `node:fs` would end up in the React Native bundle.

To move to a real API: point the `schema` field in `codegen.ts` at the live endpoint (or at a
downloaded SDL file) and regenerate with `make codegen`. Keep `mocks/` around for tests — resolvers
that mirror your production schema give Jest a fast, deterministic, network-free backend, and the
`pnpm mock-api` server stays useful for offline UI work.
