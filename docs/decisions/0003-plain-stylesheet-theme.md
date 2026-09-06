# 3. Theming with plain `StyleSheet` and typed tokens

- **Status:** Accepted
- **Date:** 2026-09-05

## Context

Styling in React Native is a live argument: class strings (NativeWind), a
compiled runtime (Unistyles), or the platform's own `StyleSheet`. A template
outlives its styling fashion, so being wrong costs a migration in every
component. NativeWind adds a Babel transform and a dialect neither Biome nor
`tsc` can check; Unistyles is another runtime to upgrade with React Native.

## Decision

Theme = typed tokens plus a `createStyles` hook over `StyleSheet.create`. No
styling dependency at all.

- `src/theme/tokens.ts` — colors, spacing and typography as a typed `Theme`.
- `src/theme/ThemeProvider.tsx` / `useTheme.ts` — light and dark from the
  system appearance; first provider in the tree.
- `src/theme/createStyles.ts` — `createStyles((theme) => ({...}))` returns a
  hook memoizing `StyleSheet.create` per theme.

## Consequences

Styles are plain objects: autocompleted, type-checked, greppable, free of
build-time magic. There is no variant or responsive sugar, so components are
more verbose than a class-string equivalent and shared recipes are factored by
hand. Because nothing is generated, moving to Unistyles later is mechanical —
the `createStyles` call site is the only seam, which is why the hook exists
instead of calling `StyleSheet.create` inline.

## Alternatives

- **Unistyles** — rejected for now, but the intended upgrade path: it replaces
  `createStyles` and nothing else. Revisit if breakpoints or variants get hot.
- **NativeWind** — not recommended: an untypeable dialect plus a Babel
  transform, for ergonomics only.
- **styled-components / emotion** — rejected: runtime cost, weak checking.
