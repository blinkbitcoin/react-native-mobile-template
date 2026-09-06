// WEB ONLY
// `pnpm test:e2e:web` exports the site first (`expo export --platform web
// --dev`); the `--dev` flag makes Expo read `.env.development`, so the bundle
// talks to the mock API on :4000 that the first web server below starts.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e/web',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:8089' },
  webServer: [
    {
      command: 'pnpm mock-api',
      url: 'http://localhost:4000/graphql',
      reuseExistingServer: true,
      timeout: 30_000,
      stdout: 'ignore',
    },
    {
      command: 'pnpm exec expo serve dist --port 8089',
      url: 'http://localhost:8089',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
