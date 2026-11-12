import { expect, test } from '@playwright/test';
import { ORG, startSignedOut } from './mock';

test('sign in with GitHub, set up a project in four steps and land on its runs', async ({ page }) => {
  await startSignedOut(page);
  await page.goto(`/o/${ORG}/projects/new/repo`);

  // Signed out: the guard sends us to sign-in, keeping where we were going.
  await expect(page).toHaveURL(/\/sign-in\?redirect=/);
  await page.getByRole('link', { name: 'Sign in with GitHub' }).click();

  // Step 1: repository and trigger.
  await expect(page.getByRole('heading', { name: 'Connect a repository', level: 1 })).toBeVisible();
  await expect(page.getByText('Step 1 of 4')).toBeVisible();
  await page.getByRole('textbox', { name: 'Project name' }).fill('demo');
  await page.getByRole('radio', { name: 'dev/demo' }).check();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 2: Claude credential.
  await expect(page.getByRole('heading', { name: 'Add the Claude credential', level: 1 })).toBeVisible();
  await expect(page.getByText('Step 2 of 4')).toBeVisible();
  await page.getByRole('textbox', { name: 'Token' }).fill('sk-ant-oat01-e2e-not-a-real-token');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 3: skill templates (both picked by default).
  await expect(page.getByRole('heading', { name: 'Start from skill templates', level: 1 })).toBeVisible();
  await expect(page.getByText('Step 3 of 4, optional')).toBeVisible();
  await page.getByRole('button', { name: 'Commit 2 skills and continue' }).click();

  // Step 4: the first rule (prefilled /code-build plus the /code-review follow-up).
  await expect(page.getByRole('heading', { name: 'Add your first rule', level: 1 })).toBeVisible();
  await expect(page.getByText('Step 4 of 4')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Command' })).toHaveValue('code-build');
  await page.getByRole('button', { name: 'Save rules and finish' }).click();

  // Ready: the summary of what was set up.
  await expect(page.getByRole('heading', { name: 'Trigger your first run from GitHub', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/new\/ready\?project=/);
  const summary = page.getByRole('main');
  await expect(summary.getByRole('definition').filter({ hasText: 'dev/demo' })).toBeVisible();
  await expect(summary.getByRole('definition').filter({ hasText: 'code-build, code-review' })).toBeVisible();

  // The token never shows again.
  await expect(page.getByText('sk-ant-oat01-e2e-not-a-real-token')).toHaveCount(0);

  await page.getByRole('link', { name: 'Go to runs' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/[0-9a-f-]+/runs$`));
  await expect(page.getByRole('heading', { name: 'Runs', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Switch project, currently demo' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'All 0' })).toBeVisible();
});
