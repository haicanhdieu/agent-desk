import { expect, test } from '@playwright/test';
import { INVOICER_API, ORG } from './mock';

test('the Grouped by ticket button toggles ticket grouping on the Run Board', async ({ page }) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/runs`);
  const toggle = page.getByRole('button', { name: 'Grouped by ticket' });
  const runLinks = page.getByRole('link', { name: /^Run \d+$/ });
  const groupRows = page.locator('tr', { has: page.getByText(/ of \d+ runs$/) });

  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(runLinks.first()).toBeVisible();
  const runCount = await runLinks.count();
  const grouped = await groupRows.count();
  expect(grouped).toBeGreaterThan(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(groupRows).toHaveCount(0);
  await expect(runLinks).toHaveCount(runCount);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(groupRows).toHaveCount(grouped);
  await expect(runLinks).toHaveCount(runCount);
});
