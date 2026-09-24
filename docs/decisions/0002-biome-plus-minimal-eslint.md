# 2. Biome for everything, ESLint 9 only for React and Expo semantics

- **Status:** Accepted
- **Date:** 2026-09-05 (ESLint major fixed at 9 on 2026-09-06)

## Context

Expo apps normally run both tools, because `eslint-config-expo` carries the
`react-hooks` rules (including the React Compiler ones) that Biome has no
equivalent for. Run naively they overlap: a defect is reported twice, a rule
silenced in one tool is still enforced by the other, and lint output is ignored.

## Decision

Zero overlapping rules, with a written owner per rule class. Biome owns
formatting, import sorting, generic correctness and the React/test lint
domains. ESLint owns only `eslint-config-expo/flat` React and Expo semantics:
every preset rule duplicating an enabled Biome rule is turned off by name with
a comment naming its counterpart. Where they collide on hooks Biome yields —
`useExhaustiveDependencies` and `useHookAtTopLevel` are off, so ESLint keeps
hooks entirely. ESLint stays on **9.x** (`eslint ^9.39.5`), not the 10 the
design sketch assumed: `eslint-config-expo@^57` and its plugins peer on v9.

- `biome.json` — formatter, `recommended` preset, react/test domains,
  `noConsole` (off for `src/lib/logger.ts`), `noRestrictedImports` for the
  secure-store and storage wrappers and the `src/app/**` routes-only rule.
- `eslint.config.mjs` — header states the split; each `'off'` names its twin.
- `docs/quality.md` — the full ownership matrix.

## Consequences

Adding a rule means picking its owner and checking the other tool for a twin;
the overlap list needs revisiting on every `eslint-config-expo` bump, and two
tools still run in `make check-lint`. In exchange each diagnostic appears once.

## Alternatives

- **ESLint only** — rejected: slow, and Biome's formatter is the fast path.
- **Biome only** — rejected: no React Compiler or Expo env-var rules.
- **Accept the overlap** — rejected: duplicates train people to ignore lint.
