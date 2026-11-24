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

test('Change which repositories the app can access opens GitHub in a new tab and leaves the repository step open', async ({
  page,
}) => {
  const repoUrl = `/o/${ORG}/projects/new/repo`;
  await page.goto(repoUrl);
  await expect(page.getByRole('radio', { name: 'harbor-labs/invoicer-api' })).toBeVisible();

  const popup = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Change which repositories the app can access' }).click();
  await popup;
  expect(new URL(page.url()).pathname).toBe(repoUrl);

  // Back in the app, the list can be read again without leaving the step.
  await page.getByRole('button', { name: 'Refresh repositories' }).click();
  await expect(page.getByRole('radio', { name: 'harbor-labs/invoicer-api' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(repoUrl);
});
