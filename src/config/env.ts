import { Platform } from 'react-native';
import { z } from 'zod';

const schema = z.object({
  EXPO_PUBLIC_API_URL: z.string().url(),
  EXPO_PUBLIC_APP_NAME: z.string().min(1),
  EXPO_PUBLIC_WEB_DOMAIN: z.string().optional(),
  EXPO_PUBLIC_ALLOW_INSECURE_WEB_STORAGE: z.enum(['true', 'false']).default('false'),
});

type Raw = Partial<Record<keyof z.infer<typeof schema>, string | undefined>>;

export function parseEnv(raw: Raw, ctx: { platform?: string; dev?: boolean } = {}) {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(
      `Invalid environment. Check .env.development / .env.production:\n${lines.join('\n')}`,
    );
  }
  const v = result.data;
  let apiUrl = v.EXPO_PUBLIC_API_URL;
  if (ctx.dev && ctx.platform === 'android') apiUrl = apiUrl.replace('://localhost', '://10.0.2.2');
  return Object.freeze({
    API_URL: apiUrl,
    APP_NAME: v.EXPO_PUBLIC_APP_NAME,
    WEB_DOMAIN: v.EXPO_PUBLIC_WEB_DOMAIN,
    ALLOW_INSECURE_WEB_STORAGE: v.EXPO_PUBLIC_ALLOW_INSECURE_WEB_STORAGE === 'true',
  });
}

// Static property access is REQUIRED for Expo to inline EXPO_PUBLIC_* at build time.
export const env = parseEnv(
  {
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
    EXPO_PUBLIC_APP_NAME: process.env.EXPO_PUBLIC_APP_NAME,
    EXPO_PUBLIC_WEB_DOMAIN: process.env.EXPO_PUBLIC_WEB_DOMAIN,
    EXPO_PUBLIC_ALLOW_INSECURE_WEB_STORAGE: process.env.EXPO_PUBLIC_ALLOW_INSECURE_WEB_STORAGE,
  },
  { platform: Platform.OS, dev: __DEV__ },
);
