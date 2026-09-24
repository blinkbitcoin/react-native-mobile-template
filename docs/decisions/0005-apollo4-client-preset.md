# 5. Apollo Client 4 with the codegen client preset and one mock schema

- **Status:** Accepted
- **Date:** 2026-09-05

## Context

The GraphQL layer must be typed end to end, survive a cold start, and be
exercisable without a backend — by Jest, by MSW in the browser and by a
simulator running Maestro. Generated hooks (`useGetThingQuery`) hide the client
and force a regeneration for every trivial operation change.

## Decision

Apollo Client 4, operations in `.graphql` files, `TypedDocumentNode` from the
GraphQL Codegen client preset — no generated hooks. One executable schema
serves both the local server and MSW.

- `src/graphql/client.ts` — `ApolloLink.from([error, retry, auth, http])`;
  `links/{error,auth}.ts`; `ApolloProvider.tsx` is the innermost provider.
- `src/graphql/cache.ts` — restored on start and persisted on background via
  `src/lib/storage.ts`; best-effort, a corrupt snapshot never blocks start.
- `codegen.ts` → `src/graphql/generated/` (never edited, drift-checked by
  `make check-gen`), `fragmentMasking: false`, `useTypeImports: true`.
- `mocks/` — `schema.graphql` + `resolvers.ts` → `executable-schema.ts`, served
  by graphql-yoga (`make dev-api`, Maestro) and `msw.ts` (Jest, Playwright).

## Consequences

One schema means the mock cannot drift from what tests assert, and a typed
document with plain `useQuery` keeps the client visible. Contributors must run
`make gen-graphql` after touching a `.graphql` file and reviewers see a generated
diff. Cache persistence is a snapshot, not a normalized offline store.

## Alternatives

- **Generated-hooks preset** — rejected: large output, hides the client.
- **urql or TanStack Query + graphql-request** — rejected: Apollo's link chain
  and normalized cache are what a store app grows into.
- **Hand-written mocks per test layer** — rejected: they drift.
