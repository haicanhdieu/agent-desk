import { expect, test, type Page } from '@playwright/test';
import { API, commentOnNewTicket, projectFor, runHeader, runOf, waitForStatus } from './helpers';

/*
 * Reopen, Close session, Reopen again on the real localhost stack (the fake pod). Spec: ADR 0032, issue #203. A run the
 * agent declared done is Finished (the disk is kept), reopened, closed and reopened again; while the session is open
 * its result is fixed: Cancel, Stop and Finish are refused and no action turns the run into anything but Succeeded.
 */
test.describe.configure({ timeout: 240_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

const pill = (page: Page, label: string) => runHeader(page).getByText(label, { exact: true });
const reopenButton = (page: Page) => page.getByRole('button', { name: 'Reopen session' });
const closeButton = (page: Page) => runHeader(page).getByRole('button', { name: 'Close session' });

test('TC-1: a succeeded run can be reopened and closed repeatedly, and its result never changes', async ({ page }) => {
  const { handle, projectId } = await projectFor(page);
  const runId = await commentOnNewTicket(page, handle, projectId, '/code-review --fake-done');
  await waitForStatus(page, runId, 'done');
  const run = await runOf(page, runId);
  await page.goto(`/o/${handle}/p/${projectId}/runs/${run.number}`);

  // A fresh Done run finishes with its disk kept: Reopen session is offered.
  await runHeader(page).getByRole('button', { name: 'Finish run' }).click();
  await expect(pill(page, 'Succeeded')).toBeVisible({ timeout: 60_000 });
  await expect(reopenButton(page)).toBeEnabled({ timeout: 30_000 });

  for (const round of [1, 2]) {
    await reopenButton(page).click();
    await expect(pill(page, 'Succeeded · Session open')).toBeVisible({ timeout: 60_000 });
    await expect(closeButton(page)).toBeEnabled({ timeout: 60_000 });
    for (const name of ['Finish run', 'Stop session', 'Cancel run']) {
      await expect(runHeader(page).getByRole('button', { name })).toHaveCount(0);
    }
    expect((await runOf(page, runId)).reopenedAt, `round ${round}`).not.toBeNull();

    // The result is fixed: the API refuses Cancel, Stop and Finish while the session is open.
    for (const action of ['cancel', 'stop', 'finish']) {
      expect((await page.request.post(`/api/runs/${runId}/${action}`)).status(), action).toBe(409);
    }

    await closeButton(page).click();
    await expect(pill(page, 'Succeeded')).toBeVisible({ timeout: 90_000 });
    await expect(reopenButton(page)).toBeEnabled({ timeout: 30_000 });
    const closed = await runOf(page, runId);
    expect(closed.status).toBe('succeeded');
    expect(closed.reopenedAt).toBeNull();
    expect(closed.sessionExpiresAt).not.toBeNull();
  }
});
