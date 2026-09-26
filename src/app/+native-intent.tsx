// This file must stay a thin re-export: expo-router's route context (`_ctx.ios.js` /
// `_ctx.js`) treats every `.ts(x)`/`.js(x)` file under `src/app` as a route, and a
// `+`-prefixed file that isn't one of its recognized special names (`+html`,
// `+not-found`, `+native-intent`, `+api`, `+middleware`) crashes at runtime with
// "Route nodes cannot start with the '+' character." That rules out colocating
// `+native-intent.test.ts` here — see `src/lib/native-intent.ts` for the
// implementation and its test. The re-export's own test mirrors this path
// under `src/__tests__/app/`.
export { redirectSystemPath } from '@/lib/native-intent';
