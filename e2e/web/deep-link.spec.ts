import { expect, test } from './fixtures';

// A shared link or a reload on a dynamic route. Static output has no file for
// `/details/42`, so the host serves `404.html` - the not-found page doubling as
// the app shell - and the router renders the route from the real URL. The
// preview server mirrors GitHub Pages here, so this is what the deploy does.
test('a deep link into a dynamic route renders the route', async ({ page }) => {
  await page.goto('./details/42');
  await expect(page.getByTestId('details-id')).toHaveText('42');
});
