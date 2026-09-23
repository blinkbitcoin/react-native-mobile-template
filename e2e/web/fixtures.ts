import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

/**
 * Every GraphQL request the page makes is answered by the local mock API,
 * whatever host the bundle was built for.
 *
 * A dev export bakes `.env.development`'s API URL, which already is the mock.
 * A production export - the one `ci-web.yml` deploys to Pages - bakes
 * `.env.production`'s, a real (or, in this template, placeholder) host that no
 * test can reach. The first production run at v0.2.3 rendered "Something went
 * wrong" for exactly that reason. Rebuilding the export for the test would
 * mean testing different bytes from the ones that deploy, so the request is
 * redirected instead: the URL is matched on its path alone and the call is
 * replayed against the mock, response and all.
 */
const mockApiUrl = process.env.EXPO_PUBLIC_API_URL;

export const test = base.extend({
  page: async ({ page }, provide) => {
    if (!mockApiUrl) {
      throw new Error('EXPO_PUBLIC_API_URL is not set; run the suite through scripts/e2e/web.sh');
    }
    await page.route('**/graphql', async (route) => {
      const request = route.request();
      const { host: _host, ...headers } = request.headers();
      const response = await page.request.fetch(mockApiUrl, {
        method: request.method(),
        headers,
        data: request.postDataBuffer() ?? undefined,
      });
      await route.fulfill({ response });
    });
    await provide(page);
  },
});
