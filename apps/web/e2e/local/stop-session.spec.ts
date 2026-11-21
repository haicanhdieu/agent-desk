import { existsSync } from 'node:fs';
import { mkdir, rename } from 'node:fs/promises';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  API,
  FAKE_STATE_DIR,
  commentOnNewTicket,
  postedComments,
  projectFor,
  runOf,
  touchPodFile,
  waitForStatus,
} from './helpers';

/*
 * Stop session lifecycle on the real localhost stack (the fake pod). Cases: spec 2026-11-19 "E2E requirements", BR-6 to
 * BR-13, BR-15, BR-16, BR-21 to BR-24 and BR-27. Each test is named by its TC id.
 *
 * BR-14 (TC-14.1 to TC-14.3, a run started before Stop session was available) is not written: the local stack cannot
 * start a run on the workflow code from before the `stop-session` patch. The lowest layer that proves it is the worker's
 * in-process workflow test (`runtime.unpatched.add('stop-session')`, plan Task 2 Part A).
 *
 * The idle-timer and ending-deadline cases only run on a stack with short timers (see the describe blocks below and
 * docs/runbooks/tests-and-e2e.md §4).
 *
 * One dev-login user and project are made once per worker and reused: each test starts its own run on a new fake ticket
 * and cancels it at the end, so the project's run slots are free for the next test.
 */
test.describe.configure({ timeout: 240_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

interface Started {
  handle: string;
  projectId: string;
  runId: string;
  number: number;
  ticketNumber: number;
}

const startedRuns: string[] = [];

/** A run on a new fake ticket (`flags` are fake-pod prompt flags), not yet opened in the browser. */
async function startRun(page: Page, flags = ''): Promise<Started> {
  const { handle, projectId } = await projectFor(page);
  const runId = await commentOnNewTicket(page, handle, projectId, `/code-review ${flags}`.trim());
  startedRuns.push(runId);
  const run = await runOf(page, runId);
  return { handle, projectId, runId, number: run.number, ticketNumber: run.ticket.number };
}

test.afterEach(async ({ page }) => {
  for (const runId of startedRuns.splice(0)) {
    await page.request.post(`/api/runs/${runId}/cancel`).catch(() => null);
  }
});

const topBar = (page: Page) => page.getByRole('banner');
const pill = (page: Page, label: string) => topBar(page).getByText(label, { exact: true });
const stopButton = (page: Page) => topBar(page).getByRole('button', { name: 'Stop session' });
const confirmDialog = (page: Page) => page.getByRole('dialog', { name: 'Stop the session?' });
const area = (page: Page) => page.getByRole('region', { name: /^(Terminal|Transcript)$/ });
const liveTerminal = (page: Page) => page.getByRole('group', { name: 'Claude Code terminal' });
const toast = (page: Page, message: string) => page.getByRole('region', { name: 'Notifications' }).getByText(message);
const stoppedHeadline = (page: Page) => page.getByText(/^Stopped: can be resumed for /);
const transcriptLog = (page: Page) => page.getByRole('log', { name: 'Transcript of the agent conversation' });

async function openRun(page: Page, s: Started): Promise<void> {
  await page.goto(`/o/${s.handle}/p/${s.projectId}/runs/${s.number}`);
  await expect(topBar(page)).toBeVisible();
}

/** Opens a run that reaches `idle` or `done` and waits for its live terminal. */
async function openLive(page: Page, flags: string, status: 'idle' | 'done'): Promise<Started> {
  const s = await startRun(page, flags);
  await waitForStatus(page, s.runId, status);
  await openRun(page, s);
  await expect(liveTerminal(page)).toContainText('Fake Claude Code', { timeout: 15_000 });
  return s;
}

/** Types lines into the live terminal; each queues one more 2 s turn in the fake pod, so the run stays `running`. */
async function typeLines(page: Page, lines: string[]): Promise<void> {
  const terminal = liveTerminal(page);
  for (const line of lines) {
    await terminal.click();
    await page.keyboard.type(line);
    await page.keyboard.press('Enter');
  }
}

/** A run page that shows Running: one exchange done, then `turns` more turns queued (about 2 s each). */
async function openRunning(page: Page, flags: string, turns = 6): Promise<Started> {
  const s = await openLive(page, flags, 'idle');
  await typeLines(
    page,
    Array.from({ length: turns }, (_, i) => `step ${i + 1}`),
  );
  await expect(pill(page, 'Running')).toBeVisible({ timeout: 15_000 });
  return s;
}

/** Stop session on a running run: opens the confirm and confirms. */
async function stopRunning(page: Page): Promise<void> {
  await stopButton(page).click();
  await confirmDialog(page).getByRole('button', { name: 'Stop session' }).click();
}

/** Records, from now on, whether `text` was ever on the page (a state that lasts a moment cannot be polled for). */
async function watchText(page: Page, text: string): Promise<() => Promise<boolean>> {
  const key = `__e2e_seen_${Math.random().toString(36).slice(2)}`;
  await page.evaluate(
    ({ t, k }) => {
      Reflect.set(window, k, false);
      const check = () => {
        if (document.body.innerText.includes(t)) Reflect.set(window, k, true);
      };
      new MutationObserver(check).observe(document.body, { subtree: true, childList: true, characterData: true });
      check();
    },
    { t: text, k: key },
  );
  return () => page.evaluate((k) => Reflect.get(window, k) === true, key);
}

/** After this the page keeps what it shows: every GET to the API fails (streams, refetches), POSTs still go. */
async function freezeView(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (route) => (route.request().method() === 'GET' ? route.abort() : route.continue()),
  );
}

/** The run's live event stream never reaches the page: it keeps the state it loaded (no `sessionEndingAt` push). */
async function blockRunStream(page: Page): Promise<void> {
  await page.route('**/api/runs/*/events*', (route) => route.abort());
}

/** A second tab that shows the run as it is now and does not hear of later changes (stream blocked before it opens). */
async function otherTab(context: BrowserContext, s: Started): Promise<Page> {
  const tab = await context.newPage();
  await blockRunStream(tab);
  await openRun(tab, s);
  await expect(liveTerminal(tab)).toContainText('Fake Claude Code', { timeout: 15_000 });
  return tab;
}

test.describe('BR-6: an idle or done run stops at once', () => {
  test('TC-6.1 an idle run stops at once, with no confirm, through Session ending to Stopped', async ({ page }) => {
    const s = await openLive(page, '--fake-slow-end', 'idle');
    await stopButton(page).click();
    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(page.getByText('Session ending…')).toBeVisible();
    await touchPodFile(s.runId, 'release-end');
    await expect(stoppedHeadline(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Session ending…')).toHaveCount(0);
  });

  test('TC-6.2 a done run stops at once, with no confirm, through Session ending to Stopped', async ({ page }) => {
    const s = await openLive(page, '--fake-done --fake-slow-end', 'done');
    await stopButton(page).click();
    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(page.getByText('Session ending…')).toBeVisible();
    await touchPodFile(s.runId, 'release-end');
    await expect(stoppedHeadline(page)).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('BR-7: a confirmed stop goes to ending and then Stopped', () => {
  test('TC-7.1 a running run shows Session ending over a loading Transcript, then Stopped, without a reload', async ({
    page,
  }) => {
    const s = await openRunning(page, '--fake-slow-end');
    await page.evaluate(() => Reflect.set(window, '__e2eNoReload', true));

    // The Transcript is asked for only when the pod goes away; hold that request so its loading state can be seen.
    let releaseTranscript: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseTranscript = resolve;
    });
    await page.route('**/api/runs/*/transcript*', async (route) => {
      await gate;
      await route.continue();
    });

    await stopRunning(page);
    await expect(page.getByText('Session ending…')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Transcript', selected: true })).toBeVisible();
    await expect(area(page).getByText('Ending…', { exact: true })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Loading the transcript' })).toBeVisible();

    releaseTranscript();
    await touchPodFile(s.runId, 'release-end');
    await expect(stoppedHeadline(page)).toBeVisible({ timeout: 30_000 });
    await expect(transcriptLog(page)).toBeVisible();
    await expect(pill(page, 'Paused')).toBeVisible();
    await expect(page.getByText('Session ending…')).toHaveCount(0);
    expect(await page.evaluate(() => Reflect.get(window, '__e2eNoReload') === true), 'the page was reloaded').toBe(
      true,
    );
  });
});

test.describe('BR-8: stopping in the middle of a step keeps what was written', () => {
  test('TC-8.1 the Transcript of a run stopped mid-turn has the earlier reply and tool step, not the cut turn', async ({
    page,
  }) => {
    await openRunning(page, '--fake-tools');
    await stopRunning(page);
    await expect(stoppedHeadline(page)).toBeVisible({ timeout: 30_000 });
    const log = transcriptLog(page);
    await expect(log.getByText('Fake agent reply 1', { exact: true })).toBeVisible();
    await expect(log.getByText('Bash', { exact: true })).toBeVisible();
    await expect(log.getByText('dotnet test', { exact: true })).toBeVisible();
    // The first turn plus six typed lines queued seven turns (replies 1 to 7), each recorded only when it ends. The stop
    // came while turns were still queued, so the cut turn's reply and every later one must be missing: fewer replies
    // than turns queued, numbered without a gap from 1.
    const replies = (await log.getByText(/^Fake agent reply \d+$/).allTextContents())
      .map((t) => Number.parseInt(t.replace('Fake agent reply ', ''), 10))
      .sort((a, b) => a - b);
    expect(replies.length).toBeGreaterThanOrEqual(1);
    expect(replies.length).toBeLessThan(7);
    expect(replies).toEqual(replies.map((_, i) => i + 1));
  });
});

test.describe('BR-9: stopping a done run', () => {
  test('TC-9.1 a stopped done run shows Stopped with Resume and Finish, not Succeeded', async ({ page }) => {
    await openLive(page, '--fake-done', 'done');
    await stopButton(page).click();
    await expect(stoppedHeadline(page)).toBeVisible({ timeout: 30_000 });
    await expect(area(page).getByRole('button', { name: 'Resume' })).toBeVisible();
    await expect(area(page).getByRole('button', { name: 'Finish', exact: true })).toBeVisible();
    await expect(page.getByText(/^Succeeded/)).toHaveCount(0);
    await expect(pill(page, 'Paused')).toBeVisible();
  });

  test("TC-9.2 resuming a stopped done run shows Needs you with the agent's last note", async ({ page }) => {
    await openLive(page, '--fake-done', 'done');
    await stopButton(page).click();
    await expect(stoppedHeadline(page)).toBeVisible({ timeout: 30_000 });
    await area(page).getByRole('button', { name: 'Resume' }).click();
    await expect(liveTerminal(page)).toContainText('Fake Claude Code', { timeout: 60_000 });
    await expect(pill(page, 'Needs you')).toBeVisible({ timeout: 30_000 });
    // exact: the Resumed banner also quotes the note inside a longer sentence.
    await expect(page.getByText('Fake agent finished', { exact: true })).toBeVisible();
  });
});

test.describe('BR-10: stopping before the agent session started', () => {
  async function openHeld(page: Page): Promise<Started> {
    const s = await startRun(page, '--fake-hold-start --fake-slow-end');
    // The pod is up (the Job runs) but holds before `session started`.
    await expect
      .poll(() => existsSync(`${FAKE_STATE_DIR}/kube/run-${s.runId}/started`), { timeout: 60_000 })
      .toBe(true);
    await expect
      .poll(async () => (await runOf(page, s.runId)).status, { timeout: 30_000 })
      .toMatch(/^(starting|running)$/);
    await openRun(page, s);
    return s;
  }

  // TC-10.1 is not written as a local e2e: Stop session is offered only for running, idle and done runs and a run is
  // `running` only after the agent's session started, so the Given cannot be reached on the page (human decision on
  // issue #126, option 1). The 'The agent has not started yet' rejection is proven at:
  // - apps/worker/test/agent-phase.test.ts: 'refuses before the agent reported session_started' (stopSessionRejection)
  // - apps/worker/test/run.workflow.in-process.test.ts: 'stop before the pod reported session_started is rejected, and accepted after it'
  // - apps/api/test/runs.int.test.ts: 'stop answered NotStoppable is a 409 with its message'
  // - apps/web/src/features/runs/detail.route.test.tsx: 'a 409 from stop toasts The agent has not started yet'

  test('TC-10.2 after the session started Stop session goes to Session ending', async ({ page }) => {
    const s = await openHeld(page);
    await touchPodFile(s.runId, 'release-start');
    await expect(liveTerminal(page)).toContainText('Fake Claude Code', { timeout: 30_000 });
    // The first turn takes 2 s and then the run is idle, where Stop session needs no confirm: wait for that state so the
    // click does not race the running state's confirm popover.
    await expect(pill(page, 'Needs you')).toBeVisible({ timeout: 30_000 });
    await stopButton(page).click();
    await expect(page.getByText('Session ending…')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('alert')).toHaveCount(0);
    await touchPodFile(s.runId, 'release-end');
    await expect(stoppedHeadline(page)).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('BR-11: stopping while the session is already ending', () => {
  test('TC-11.1 Stop during a Finish toasts "The session is already ending" and the run ends Succeeded', async ({
    page,
    context,
  }) => {
    const s = await openLive(page, '--fake-slow-end', 'idle');
    const stale = await otherTab(context, s);
    await freezeView(stale);

    await topBar(page).getByRole('button', { name: 'Finish run' }).click();
    await expect(page.getByText('Session ending…')).toBeVisible();
    await stale.bringToFront();
    await stopButton(stale).click();
    await expect(toast(stale, 'The session is already ending')).toBeVisible();

    await touchPodFile(s.runId, 'release-end');
    await expect(pill(page, 'Succeeded')).toBeVisible({ timeout: 30_000 });
    const run = await runOf(page, s.runId);
    expect(run.status).toBe('succeeded');
    expect(run.pauseReason).toBeNull();
  });

  test('TC-11.2 a second Stop from another tab toasts "The session is already ending"; the run stops once', async ({
    page,
    context,
  }) => {
    const s = await openLive(page, '--fake-slow-end', 'idle');
    const tabB = await otherTab(context, s);
    await freezeView(tabB);

    await stopButton(page).click();
    await expect(page.getByText('Session ending…')).toBeVisible();
    await tabB.bringToFront();
    await stopButton(tabB).click();
    await expect(toast(tabB, 'The session is already ending')).toBeVisible();

    await touchPodFile(s.runId, 'release-end');
    await expect(stoppedHeadline(page)).toBeVisible({ timeout: 30_000 });
    const run = await runOf(page, s.runId);
    expect(run.status).toBe('paused');
    expect(run.pauseReason).toBe('stopped');
  });

  test('TC-11.3 a Finish from another tab after a Stop toasts "The session is already ending"; the run is Stopped', async ({
    page,
    context,
  }) => {
    const s = await openLive(page, '--fake-slow-end', 'idle');
    const tabB = await otherTab(context, s);
    await freezeView(tabB);

    await stopButton(page).click();
    await expect(page.getByText('Session ending…')).toBeVisible();
    await tabB.bringToFront();
    await topBar(tabB).getByRole('button', { name: 'Finish run' }).click();
    await expect(toast(tabB, 'The session is already ending')).toBeVisible();

    await touchPodFile(s.runId, 'release-end');
    await expect(stoppedHeadline(page)).toBeVisible({ timeout: 30_000 });
    const run = await runOf(page, s.runId);
    expect(run.status).toBe('paused');
    expect(run.pauseReason).toBe('stopped');
  });
});

test.describe('BR-13: Cancel wins over a stop in progress', () => {
  test('TC-13.1 cancelling while Session ending is shown ends the run as cancelled', async ({ page }) => {
    await openLive(page, '--fake-slow-end', 'idle');
    await stopButton(page).click();
    await expect(page.getByText('Session ending…')).toBeVisible();
    await topBar(page).getByRole('button', { name: 'Cancel run' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel run' }).click();
    await expect(pill(page, 'Cancelled')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/^Cancelled at \d{2}:\d{2}:\d{2}\.$/)).toBeVisible();
    await expect(stoppedHeadline(page)).toHaveCount(0);
  });
});

test.describe('BR-15: no ticket comment on a stop', () => {
  test('TC-15.1 stopping an idle run posts no paused comment on its ticket', async ({ page }) => {
    const s = await openLive(page, '', 'idle');
    const before = (await postedComments(page)).filter((c) => c.ticketNumber === s.ticketNumber).length;
    await stopButton(page).click();
    await expect(stoppedHeadline(page)).toBeVisible({ timeout: 30_000 });
    // Give a comment posted after the park time to arrive.
    await page.waitForTimeout(3_000);
    const after = (await postedComments(page)).filter((c) => c.ticketNumber === s.ticketNumber);
    expect(after.slice(before).map((c) => c.body)).toEqual([]);
    expect(after.some((c) => /is paused: the agent is waiting for an answer/.test(c.body))).toBe(false);
  });
});

test.describe('BR-16: a stop with a pod that hangs or is lost still ends', () => {
  test('TC-16.2 a pod lost while the stop is ending still shows Stopped, not a pod-lost notice', async ({ page }) => {
    const s = await openRunning(page, '--fake-slow-end');
    await stopRunning(page);
    await expect(page.getByText('Session ending…')).toBeVisible();
    await touchPodFile(s.runId, 'hardkill');
    await expect(stoppedHeadline(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/^Paused: the pod (stopped unexpectedly|was killed)/)).toHaveCount(0);
    expect((await runOf(page, s.runId)).pauseReason).toBe('stopped');
  });
});

test.describe('BR-21: resuming a stopped run', () => {
  test('TC-21.1 Resume shows Resuming the run, then the live terminal and Needs you, with no Transcript tab', async ({
    page,
  }) => {
    await openLive(page, '', 'idle');
    await stopButton(page).click();
    await expect(stoppedHeadline(page)).toBeVisible({ timeout: 30_000 });
    const sawResuming = await watchText(page, 'Resuming the run');
    await area(page).getByRole('button', { name: 'Resume' }).click();
    await expect(liveTerminal(page)).toContainText('Fake Claude Code', { timeout: 60_000 });
    expect(await sawResuming(), 'the Resuming the run placeholder was never shown').toBe(true);
    await expect(page.getByRole('tab', { name: 'Terminal', selected: true })).toBeVisible();
    await expect(area(page).getByText(/^Live\b/)).toBeVisible();
    await expect(page.getByRole('tab', { name: /Transcript/ })).toHaveCount(0);
    await expect(pill(page, 'Needs you')).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('BR-22: a failed Resume of a stopped run', () => {
  test('TC-22.1 and TC-22.2 a failed resume shows Stopped again with the same time left; Resume works afterwards', async ({
    page,
  }) => {
    const s = await openLive(page, '', 'idle');
    await stopButton(page).click();
    await expect(stoppedHeadline(page)).toBeVisible({ timeout: 30_000 });

    // "Stopped 1 day ago": the browser's clock runs one day ahead of the server's (as the mock specs do), so the
    // headline is counted from the 7 day keep time.
    await page.clock.install({ time: new Date(Date.now() + 24 * 3_600_000) });
    await page.reload();
    await expect(page.getByText('Stopped: can be resumed for 6 days.', { exact: true })).toBeVisible();

    // The pod finds no saved session: the volume's marker is moved aside.
    const marker = `${FAKE_STATE_DIR}/kube/.volume-data/run-${s.runId}/session-started`;
    expect(existsSync(marker), `no volume marker at ${marker}`).toBe(true);
    await mkdir(`${FAKE_STATE_DIR}/kube/.volume-data/aside`, { recursive: true });
    const aside = `${FAKE_STATE_DIR}/kube/.volume-data/aside/${s.runId}`;
    await rename(marker, aside);
    try {
      await area(page).getByRole('button', { name: 'Resume' }).click();
      await expect(page.getByText(/^Resume failed/)).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText('Stopped: can be resumed for 6 days.', { exact: true })).toBeVisible();
      await expect(area(page).getByRole('button', { name: 'Resume' })).toBeEnabled();
    } finally {
      await rename(aside, marker);
    }

    // TC-22.2: the pod can start now.
    const sawResuming = await watchText(page, 'Resuming the run');
    await area(page).getByRole('button', { name: 'Resume' }).click();
    await expect(liveTerminal(page)).toContainText('Fake Claude Code', { timeout: 60_000 });
    expect(await sawResuming(), 'the Resuming the run placeholder was never shown').toBe(true);
  });
});

test.describe('BR-23: Resume pressed while the stop is ending', () => {
  test('TC-23.1 a resume request during the ending is accepted and starts right after the stop', async ({ page }) => {
    const s = await openLive(page, '--fake-slow-end', 'idle');
    await stopButton(page).click();
    await expect(page.getByText('Session ending…')).toBeVisible();
    await expect(area(page).getByRole('button', { name: 'Resume' })).toHaveCount(0);

    const res = await page.request.post(`/api/runs/${s.runId}/resume`);
    expect(res.status(), await res.text()).toBe(204);

    await touchPodFile(s.runId, 'release-end');
    await expect(liveTerminal(page)).toContainText('Fake Claude Code', { timeout: 90_000 });
    await expect(pill(page, 'Needs you')).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('BR-24: Finish on a stopped run', () => {
  async function stopThenFinish(page: Page): Promise<void> {
    await openLive(page, '', 'idle');
    await stopButton(page).click();
    await expect(stoppedHeadline(page)).toBeVisible({ timeout: 30_000 });
    await area(page).getByRole('button', { name: 'Finish', exact: true }).click();
    await expect(pill(page, 'Succeeded')).toBeVisible({ timeout: 30_000 });
  }

  test('TC-24.1 Finish on a stopped run ends it Succeeded, deleted and not resumable', async ({ page }) => {
    await stopThenFinish(page);
    await expect(page.getByText(/^Succeeded in .+\.$/)).toBeVisible();
    await expect(page.getByText('Finished. The session was deleted and cannot be resumed.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reopen session' })).toBeDisabled();
  });

  test('TC-24.2 the finished run still shows the Transcript, Ended, read-only', async ({ page }) => {
    await stopThenFinish(page);
    await expect(transcriptLog(page)).toBeVisible();
    await expect(area(page).getByText('Ended, read-only', { exact: true })).toBeVisible();
  });
});

test.describe('BR-27: cancelling a stopped run', () => {
  test('TC-27.1 a stopped run cancelled through the API shows the cancelled notice and the Transcript', async ({
    page,
  }) => {
    const s = await openLive(page, '', 'idle');
    await stopButton(page).click();
    await expect(stoppedHeadline(page)).toBeVisible({ timeout: 30_000 });

    const res = await page.request.post(`/api/runs/${s.runId}/cancel`);
    expect(res.status(), await res.text()).toBe(202);
    await waitForStatus(page, s.runId, 'cancelled', 30_000);

    await openRun(page, s);
    // Wording ruled for this run: today's cancelled notice has no name ("Cancelled by kim-hale at …" is an example).
    await expect(page.getByText(/^Cancelled at \d{2}:\d{2}:\d{2}\.$/)).toBeVisible();
    await expect(transcriptLog(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume' })).toHaveCount(0);
  });
});

/*
 * Cases that need short timers. Start a stack with
 *
 *   RUN_IDLE_END_SECONDS=5 RUN_LEASE_TTL_SECONDS=4 TERMINAL_LEASE_INTERVAL_MS=1000 RUN_ENDING_DEADLINE_SECONDS=10
 *
 * and run with E2E_IDLE_END_SECONDS=5 E2E_ENDING_DEADLINE_SECONDS=10 (docs/runbooks/tests-and-e2e.md §4).
 */
const IDLE_END_SECONDS = Number.parseInt(process.env['E2E_IDLE_END_SECONDS'] ?? '', 10);
const ENDING_DEADLINE_SECONDS = Number.parseInt(process.env['E2E_ENDING_DEADLINE_SECONDS'] ?? '', 10);

test.describe('BR-12 and BR-15: the idle timer', () => {
  test.skip(!Number.isFinite(IDLE_END_SECONDS), 'set E2E_IDLE_END_SECONDS to the stack worker RUN_IDLE_END_SECONDS');

  test('TC-12.1 a Stop after the idle timer started ending the session toasts and shows the idle-timeout notice', async ({
    page,
  }) => {
    const s = await startRun(page, '--fake-slow-end');
    // Open the page as soon as the run is idle, and keep it as it is: with a terminal attached the idle timer would not
    // run, and a page that keeps updating would already show the session ending. The terminal WebSocket is answered by
    // the page route itself (page.route does not see WebSockets), so it never reaches the API and never renews the lease.
    await expect
      .poll(async () => (await runOf(page, s.runId)).status, { intervals: [100], timeout: 60_000 })
      .toBe('idle');
    await page.routeWebSocket(/\/terminal(\?|$)/, () => undefined);
    await blockRunStream(page);
    await openRun(page, s);
    await freezeView(page);
    await expect(stopButton(page)).toBeEnabled();

    await expect
      .poll(async () => (await runOf(page, s.runId)).sessionEndingAt, { timeout: (IDLE_END_SECONDS + 60) * 1000 })
      .not.toBeNull();
    await stopButton(page).click();
    await expect(toast(page, 'The session is already ending')).toBeVisible();

    await touchPodFile(s.runId, 'release-end');
    await waitForStatus(page, s.runId, 'paused', 60_000);
    expect((await runOf(page, s.runId)).pauseReason).toBe('idle_timeout');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.reload();
    await expect(page.getByText('Paused: waiting for your answer.')).toBeVisible({ timeout: 30_000 });
    await expect(stoppedHeadline(page)).toHaveCount(0);
  });

  test('TC-15.2 an idle run paused by the idle timer does get the paused comment (control for TC-15.1)', async ({
    page,
  }) => {
    const s = await startRun(page, '');
    await waitForStatus(page, s.runId, 'paused', (IDLE_END_SECONDS + 60) * 1000);
    expect((await runOf(page, s.runId)).pauseReason).toBe('idle_timeout');
    await expect
      .poll(
        async () =>
          (await postedComments(page)).some(
            (c) => c.ticketNumber === s.ticketNumber && /is paused: the agent is waiting for an answer/.test(c.body),
          ),
        { timeout: 30_000 },
      )
      .toBe(true);
  });
});

test.describe('BR-16: the ending deadline', () => {
  test.skip(
    !Number.isFinite(ENDING_DEADLINE_SECONDS),
    'set E2E_ENDING_DEADLINE_SECONDS to the stack worker RUN_ENDING_DEADLINE_SECONDS',
  );

  test('TC-16.1 a pod that hangs on the stop still leaves Session ending within the deadline, as Stopped', async ({
    page,
  }) => {
    await openRunning(page, '--fake-hang-on-stop');
    await stopRunning(page);
    await expect(page.getByText('Session ending…')).toBeVisible();
    // The deadline, plus a few seconds for the worker to delete the Job and park the run.
    await expect(stoppedHeadline(page)).toBeVisible({ timeout: (ENDING_DEADLINE_SECONDS + 20) * 1000 });
    await expect(page.getByText('Session ending…')).toHaveCount(0);
    await expect(page.getByText(/^Paused: the pod (stopped unexpectedly|was killed)/)).toHaveCount(0);
  });
});
