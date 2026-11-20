import { expect, test, type Page } from '@playwright/test';
import {
  API,
  commentOnNewTicket,
  lifecycleTexts,
  runOf,
  setAutoResumeMax,
  signInAndCreateProject,
  touchPodFile,
  waitForStatus,
} from './helpers';

/*
 * Automatic resume after an unexpected pod end, on the real localhost stack (the fake pod). Spec:
 * docs/superpowers/specs/2026-11-20-pod-crash-auto-resume-design.md. A `hardkill` file makes the fake pod exit 137 at
 * once. Each test uses its own project and cancels its run at the end (best effort).
 *
 * Not proved here: the 1 to 10 minute retry wait after a try whose pod could not start. A fake Job cannot be held in
 * deletion on purpose and a real wait takes minutes; the workflow's in-process tests with fired timers prove it.
 */
test.describe.configure({ timeout: 240_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

const KILLED = '\\(Error, exit 137\\)';
const tryText = (n: number, max: number) =>
  new RegExp(`^The last session was killed ${KILLED}\\. Resuming automatically, try ${n} of ${max}\\.$`);
const countOf = (texts: string[], re: RegExp) => texts.filter((t) => re.test(t)).length;
const GAVE_UP = /^Gave up resuming automatically/;

const liveTerminal = (page: Page) => page.getByRole('group', { name: 'Claude Code terminal' });
const topBar = (page: Page) => page.getByRole('banner');

/** A new project and a run on `/code-review` that is idle; the page is signed in. */
async function startIdleRun(page: Page, limit?: number) {
  const { handle, projectId } = await signInAndCreateProject(page);
  if (limit !== undefined) await setAutoResumeMax(page, projectId, limit);
  const runId = await commentOnNewTicket(page, handle, projectId, '/code-review');
  const run = await runOf(page, runId);
  await waitForStatus(page, runId, 'idle');
  return { handle, projectId, runId, number: run.number };
}

async function cancel(page: Page, runId: string) {
  await page.request.post(`/api/runs/${runId}/cancel`).catch(() => null);
}

/** Kills the run's pod and waits until `texts` holds `count` matches of `re` (the automatic resume was logged). */
async function killAndWaitForTry(page: Page, runId: string, re: RegExp, count: number) {
  await touchPodFile(runId, 'hardkill');
  await expect.poll(async () => countOf(await lifecycleTexts(page, runId), re), { timeout: 90_000 }).toBe(count);
  await waitForStatus(page, runId, 'idle', 90_000);
}

/** Limit 1 (set by the caller): kill, wait for idle (try 1 of 1), kill again, wait for paused. */
async function gaveUpOnce(page: Page, runId: string) {
  await killAndWaitForTry(page, runId, tryText(1, 1), 1);
  await touchPodFile(runId, 'hardkill');
  await waitForStatus(page, runId, 'paused', 90_000);
  expect((await runOf(page, runId)).pauseReason).toBe('pod_lost');
}

test('a killed run comes back to Needs you by itself, logs "Resuming automatically, try 1 of 5" and shows the note', async ({
  page,
}) => {
  const { handle, projectId, runId, number } = await startIdleRun(page);
  try {
    await killAndWaitForTry(page, runId, tryText(1, 5), 1);
    await page.goto(`/o/${handle}/p/${projectId}/runs/${number}`);
    await expect(topBar(page).getByText('Needs you', { exact: true })).toBeVisible();
    await expect(liveTerminal(page)).toContainText(
      'Agent Desk: your last session was killed (Error, exit 137). Resumed, try 1/5. Background processes and /tmp are gone.',
      { timeout: 30_000 },
    );
  } finally {
    await cancel(page, runId);
  }
});

test('with the limit at 1, a second kill leaves the run paused with "Tried to resume automatically 1 time."', async ({
  page,
}) => {
  const { handle, projectId, runId, number } = await startIdleRun(page, 1);
  try {
    await gaveUpOnce(page, runId);
    await page.goto(`/o/${handle}/p/${projectId}/runs/${number}`);
    await expect(page.getByText('Tried to resume automatically 1 time.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Finish' })).toBeVisible();
  } finally {
    await cancel(page, runId);
  }
});

test('typing in the terminal between kills lets the run resume again', async ({ page }) => {
  const { handle, projectId, runId, number } = await startIdleRun(page, 1);
  try {
    await killAndWaitForTry(page, runId, tryText(1, 1), 1);
    await page.goto(`/o/${handle}/p/${projectId}/runs/${number}`);
    const terminal = liveTerminal(page);
    await expect(terminal).toContainText('Fake Claude Code', { timeout: 30_000 });
    await terminal.click();
    await page.keyboard.type('hello');
    await page.keyboard.press('Enter');
    await expect(terminal).toContainText('hello', { timeout: 30_000 });
    await waitForStatus(page, runId, 'idle', 60_000);

    await killAndWaitForTry(page, runId, tryText(1, 1), 2);
    const texts = await lifecycleTexts(page, runId);
    expect(texts.filter((t) => GAVE_UP.test(t))).toEqual([]);
  } finally {
    await cancel(page, runId);
  }
});

test("a person's Resume after the limit shows the note without a try number", async ({ page }) => {
  const { handle, projectId, runId, number } = await startIdleRun(page, 1);
  try {
    await gaveUpOnce(page, runId);
    await page.goto(`/o/${handle}/p/${projectId}/runs/${number}`);
    await page.getByRole('button', { name: 'Resume' }).click();
    const terminal = liveTerminal(page);
    await expect(terminal).toContainText(
      'Agent Desk: your last session was killed (Error, exit 137). Resumed. Background processes and /tmp are gone.',
      { timeout: 90_000 },
    );
    await expect(terminal).not.toContainText(/Resumed, try \d+\/\d+/);
  } finally {
    await cancel(page, runId);
  }
});
