import { redirectSystemPath } from '@/app/+native-intent';
import * as nativeIntent from '@/lib/native-intent';

// The route file is a thin re-export (see its header comment); the behaviour
// and its cases live in `src/lib/native-intent.test.ts`.
test('hands expo-router the redirect from src/lib', () => {
  expect(redirectSystemPath).toBe(nativeIntent.redirectSystemPath);
});

test('rewrites a legacy link through the re-export', () => {
  expect(redirectSystemPath({ path: '/d/7', initial: true })).toBe('/details/7');
});
