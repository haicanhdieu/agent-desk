import { expect, test } from '@playwright/test';
import { INVOICER_API, ORG } from './mock';

/** Run 65 is a succeeded run on issue 153 (src/mocks/dto/runs.ts). */
const ISSUE_RUN = 65;

test('Repo on GitHub opens in a new tab and leaves the Run List open', async ({ page }) => {
  const runsUrl = `/o/${ORG}/p/${INVOICER_API}/runs`;
  await page.goto(runsUrl);
  const link = page.getByRole('link', { name: /Repo on GitHub/ });
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');

  const popup = page.waitForEvent('popup');
  await link.click();
  await popup;
  expect(new URL(page.url()).pathname).toBe(runsUrl);
  await expect(page.getByRole('link', { name: /Repo on GitHub/ })).toBeVisible();
});

test('the run detail ticket link says View issue and opens in a new tab', async ({ page }) => {
  const runUrl = `/o/${ORG}/p/${INVOICER_API}/runs/${ISSUE_RUN}`;
  await page.goto(runUrl);
  const link = page.getByRole('link', { name: 'View issue' });
  await expect(link).toHaveAttribute('href', /\/issues\/153$/);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.getByRole('link', { name: 'View ticket' })).toHaveCount(0);

  const popup = page.waitForEvent('popup');
  await link.click();
  await popup;
  expect(new URL(page.url()).pathname).toBe(runUrl);
});
