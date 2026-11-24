import { expect, test } from '@playwright/test';
import { ORG, setGithubSync } from './mock';

/*
 * Refresh repositories when GitHub no longer accepts the signed-in account's token (issue 284). The mock `connections.sync`
 * answers the API's 409 "reconnect" problem until the mocked GitHub sign-in runs, then answers normally.
 */
const REPO_STEP = `/o/${ORG}/projects/new/repo`;

test('a dead GitHub token shows Reconnect GitHub, which signs in again, returns to the step and refreshing works', async ({
  page,
}) => {
  await setGithubSync(page, 'reauth');
  await page.goto(REPO_STEP);
  await expect(page.getByRole('radio', { name: 'harbor-labs/invoicer-api' })).toBeVisible();

  await page.getByRole('button', { name: 'Refresh repositories' }).click();
  await expect(page.getByText('GitHub needs you to sign in again')).toBeVisible();
  await expect(page.getByText(/Sign in with GitHub again/)).toBeVisible();
  // The list already on the page stays, and nothing says "Internal Server Error".
  await expect(page.getByRole('radio', { name: 'harbor-labs/invoicer-api' })).toBeVisible();
  await expect(page.getByText(/Internal Server Error/i)).toHaveCount(0);

  await page.getByRole('button', { name: 'Reconnect GitHub' }).click();
  // The GitHub sign-in sends the browser back to the repository step.
  await expect(page).toHaveURL(new RegExp(`${REPO_STEP}$`));
  await expect(page.getByText('GitHub needs you to sign in again')).toHaveCount(0);

  await page.getByRole('button', { name: 'Refresh repositories' }).click();
  await expect(page.getByRole('button', { name: 'Refresh repositories' })).toBeEnabled();
  await expect(page.getByText('GitHub needs you to sign in again')).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'harbor-labs/invoicer-api' })).toBeVisible();
});

test('GitHub being down says to try again later and offers no reconnect', async ({ page }) => {
  await setGithubSync(page, 'unavailable');
  await page.goto(REPO_STEP);
  await expect(page.getByRole('radio', { name: 'harbor-labs/invoicer-api' })).toBeVisible();

  await page.getByRole('button', { name: 'Refresh repositories' }).click();
  await expect(page.getByText(/Try again later/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reconnect GitHub' })).toHaveCount(0);
});
