import { expect, test } from '@playwright/test';
import { INVOICER_API, ORG, PAUSED_RUN } from './mock';

/*
 * Reopen, Close session and Reopen again (ADR 0032, which amends the 2026-11-20 "finish after re-open" spec). Run 65 is a
 * succeeded run with a kept session (dto/runs.ts); run 64 is paused. After a reopen the mock agent goes back to "done"
 * (10 s). The header shows the Succeeded · Session open pill and Close session as the only action.
 */
test.describe.configure({ timeout: 60_000 });

const runUrl = (number: number) => `/o/${ORG}/p/${INVOICER_API}/runs/${number}`;
const KEPT_SUCCEEDED_RUN = 65;

const topBar = (page: import('@playwright/test').Page) => page.getByRole('banner');
const closeSession = (page: import('@playwright/test').Page) =>
  topBar(page).getByRole('button', { name: 'Close session' });
const finishRun = (page: import('@playwright/test').Page) => topBar(page).getByRole('button', { name: 'Finish run' });

test('TC-1: Close session after Reopen leaves the run Succeeded and offers Reopen session again', async ({ page }) => {
  await page.goto(runUrl(KEPT_SUCCEEDED_RUN));
  await expect(topBar(page).getByText('Succeeded', { exact: true })).toBeVisible();
  for (const round of [1, 2]) {
    await page.getByRole('button', { name: 'Reopen session' }).click();
    await expect(topBar(page).getByText('Succeeded · Session open', { exact: true })).toBeVisible();
    await expect(closeSession(page)).toBeEnabled({ timeout: 25_000 });
    // The result is fixed: no Finish, Stop or Cancel in a reopened session.
    for (const name of ['Finish run', 'Stop session', 'Cancel run']) {
      await expect(topBar(page).getByRole('button', { name }), `round ${round}`).toHaveCount(0);
    }
    await closeSession(page).click();
    await expect(topBar(page).getByText('Succeeded', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reopen session' })).toBeEnabled();
    await expect(page.getByText(/cannot be resumed/)).toHaveCount(0);
  }
});

test('TC-2: a paused run resumed then finished is not reopenable', async ({ page }) => {
  await page.goto(runUrl(PAUSED_RUN));
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(finishRun(page)).toBeEnabled({ timeout: 25_000 });
  await finishRun(page).click();
  await expect(topBar(page).getByText('Succeeded', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reopen session' })).toBeDisabled();
});
