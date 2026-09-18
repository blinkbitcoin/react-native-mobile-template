import { expect, test } from './fixtures';

test('home renders and navigates to details', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('home-title')).toBeVisible();
  await expect(page.getByTestId('home-hello')).toHaveText('Hello, world!');
  await page.getByTestId('home-open-details').click();
  await expect(page.getByTestId('details-id')).toHaveText('42');
});
