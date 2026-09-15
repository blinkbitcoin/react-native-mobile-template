// WEB ONLY
// `pnpm test:e2e:web` exports the site first (`expo export --platform web
// --dev`); the `--dev` flag makes Expo read `.env.development`, so the bundle
// talks to the mock API that the first web server below starts. Both ports come
// from `scripts/ports.mjs`, so `APP_PORT_BASE=8090 make e2e-web` moves the whole
// suite out of the way of another worktree.
import { defineConfig } from '@playwright/test';
import { mockApiUrl, resolvePorts } from './scripts/ports.mjs';

const ports = resolvePorts(process.env);
const previewUrl = `http://localhost:${ports.webPreview}`;

export default defineConfig({
  testDir: 'e2e/web',
  timeout: 30_000,
  use: { baseURL: previewUrl },
  webServer: [
    {
      command: 'pnpm mock-api',
      url: mockApiUrl(ports.mockApi),
      reuseExistingServer: true,
      timeout: 30_000,
      stdout: 'ignore',
    },
    {
      command: `pnpm exec expo serve dist --port ${ports.webPreview}`,
      url: previewUrl,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
