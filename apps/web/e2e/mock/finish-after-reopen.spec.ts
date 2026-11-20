import { expect, test } from '@playwright/test';
import { INVOICER_API, ORG, PAUSED_RUN } from './mock';

/*
 * Finish after Re-open keeps the session (spec 2026-11-20 "E2E requirements", TC-1, TC-2). Run 65 is a succeeded run
 * with a kept session (dto/runs.ts); run 64 is paused. After a re-open the mock agent goes back to "done" (10 s), the
 * state in which Finish run is offered.
 */
test.describe.configure({ timeout: 60_000 });

const runUrl = (number: number) => `/o/${ORG}/p/${INVOICER_API}/runs/${number}`;
const KEPT_SUCCEEDED_RUN = 65;

const topBar = (page: import('@playwright/test').Page) => page.getByRole('banner');
const finishRun = (page: import('@playwright/test').Page) => topBar(page).getByRole('button', { name: 'Finish run' });

test('TC-1: Finish after Re-open still offers Re-open session', async ({ page }) => {
  await page.goto(runUrl(KEPT_SUCCEEDED_RUN));
  await expect(topBar(page).getByText('Succeeded', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Re-open session' }).click();
  await expect(finishRun(page)).toBeEnabled({ timeout: 25_000 });
  await finishRun(page).click();
  await expect(topBar(page).getByText('Succeeded', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Re-open session' })).toBeVisible();
  await expect(page.getByText(/cannot be resumed/)).toHaveCount(0);
});

test('TC-2: a paused run resumed then finished is not re-openable', async ({ page }) => {
  await page.goto(runUrl(PAUSED_RUN));
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(finishRun(page)).toBeEnabled({ timeout: 25_000 });
  await finishRun(page).click();
  await expect(topBar(page).getByText('Succeeded', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Re-open session' })).toHaveCount(0);
});
