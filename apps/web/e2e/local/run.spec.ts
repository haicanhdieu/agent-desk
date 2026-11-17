import { randomBytes, randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { InstallResponse, RunDto, RunLogResponse } from '@agentdesk/contracts';
import { z } from 'zod';

/*
 * Real localhost end-to-end: the Vite dev server (proxy to the API on :3000) and the stack from `pnpm dev` at the repo
 * root with KUBE_MODE=fake, ENABLE_FAKE_PROVIDER=true and AUTH_DEV_LOGIN=true. Each run signs in as a new dev-login
 * user (`e2e-<rand>`, a fresh personal org), so it can run against a stack someone is using.
 *
 * The fake board (`dev/demo`) is shared by every org on the machine, so the ticket gets a random number.
 */

const API = 'http://localhost:3000';
const REPO = 'dev/demo';

/** `POST /dev/fake/comments` answer (dev route, not in the contracts; apps/api/src/dev/fake.controller.ts). */
const CommentResult = z.object({ commentId: z.string(), outcome: z.string(), runId: z.string().optional() });

async function ok(res: APIResponse, status: number, what: string): Promise<unknown> {
  const text = await res.text();
  expect(res.status(), `${what}: ${text}`).toBe(status);
  return text === '' ? null : (JSON.parse(text) as unknown);
}

// Queued → idle takes a few seconds with the fake pod; each turn ends 2 s after input.
test.describe.configure({ timeout: 180_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

/** Dev login, then the five setup steps against the fake board; ends on the project's Runs page. */
async function signInAndCreateProject(page: Page): Promise<{ handle: string; projectId: string }> {
  // Sign in: dev login creates the user and a personal org, sets the session cookie and sends us to the projects.
  const handle = `e2e-${randomBytes(4).toString('hex')}`;
  await page.goto(`/auth/dev-login?handle=${handle}&redirect=/`);
  await expect(page).toHaveURL(new RegExp(`/o/${handle}/projects$`));

  // The fake connection: the app's Connect button installs GitHub only, so the install starts over the API. Its URL is
  // the fake callback, which records the connection and lands on the setup's repository step.
  const install = InstallResponse.parse(
    await ok(await page.request.post('/api/connections/fake/install'), 201, 'install'),
  );
  await page.goto(install.url);
  await expect(page).toHaveURL(new RegExp(`/o/${handle}/projects/new/repo\\?connection=`));

  // Step 1: repository dev/demo, webhook trigger (the default).
  await expect(page.getByRole('heading', { name: 'Connect a repository', level: 1 })).toBeVisible();
  await page.getByRole('radio', { name: REPO }).check();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 2: any string as the credential.
  await expect(page.getByRole('heading', { name: 'Add the Claude credential', level: 1 })).toBeVisible();
  await page.getByRole('textbox', { name: 'Token' }).fill(`sk-ant-e2e-${randomBytes(8).toString('hex')}`);
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 3: prepare the workspace. The test passes in the fake pod, then the starter script is saved as version 1.
  await expect(page.getByRole('heading', { name: 'Prepare the workspace', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Test setup' }).click();
  await expect(page.getByText('Setup passed', { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Save and continue' }).click();

  // Step 4: the skill templates, code-review among them (templates already on the shared board are skipped).
  await expect(page.getByRole('heading', { name: 'Start from skill templates', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: /^Commit \d+ skills? and continue$/ }).click();

  // Step 5: the prefilled /code-build rule and the /code-review follow-up (pull requests).
  await expect(page.getByRole('heading', { name: 'Add your first rule', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Save rules and finish' }).click();

  await expect(page).toHaveURL(/\/new\/ready\?project=/);
  await page.getByRole('link', { name: 'Go to runs' }).click();
  await expect(page.getByRole('heading', { name: 'Runs', level: 1 })).toBeVisible();
  const projectId = /\/p\/([0-9a-f-]+)\/runs$/.exec(page.url())?.[1];
  expect(projectId, page.url()).toBeTruthy();
  return { handle, projectId: projectId ?? '' };
}

/** A pull request on the fake board with a webhook comment; returns the run it created. */
async function commentOnNewTicket(page: Page, handle: string, projectId: string, body: string): Promise<string> {
  const ticketNumber = randomInt(100_000, 1_000_000_000);
  await ok(
    await page.request.post('/dev/fake/tickets', {
      data: { repoPath: REPO, number: ticketNumber, kind: 'pr', title: `e2e ${handle}` },
    }),
    201,
    'fake ticket',
  );
  const comment = CommentResult.parse(
    await ok(
      await page.request.post('/dev/fake/comments', {
        data: { repoPath: REPO, ticketNumber, body, deliver: 'webhook', projectId },
      }),
      201,
      'fake comment',
    ),
  );
  expect(comment.runId, `comment outcome ${comment.outcome}`).toBeTruthy();
  return comment.runId ?? '';
}

test('a comment on the fake board becomes a live run: idle, terminal echo, finish, read-only scrollback', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(e.message));

  const { handle, projectId } = await signInAndCreateProject(page);

  // A pull request on the fake board, and `/code-review` on it delivered as a webhook.
  const ticketNumber = randomInt(100_000, 1_000_000_000);
  await ok(
    await page.request.post('/dev/fake/tickets', {
      data: { repoPath: REPO, number: ticketNumber, kind: 'pr', title: `e2e ${handle}` },
    }),
    201,
    'fake ticket',
  );
  const comment = CommentResult.parse(
    await ok(
      await page.request.post('/dev/fake/comments', {
        data: { repoPath: REPO, ticketNumber, body: '/code-review', deliver: 'webhook', projectId },
      }),
      201,
      'fake comment',
    ),
  );
  expect(comment.runId, `comment outcome ${comment.outcome}`).toBeTruthy();

  // The run shows up in the open list without a reload (project event stream).
  const runLink = page.getByRole('link', { name: 'Run 1', exact: true });
  await expect(runLink).toBeVisible({ timeout: 30_000 });
  await runLink.click();

  const header = page.getByRole('banner');
  const status = (label: string) => header.getByText(label, { exact: true });
  await expect(status('Needs you')).toBeVisible({ timeout: 60_000 });

  // The terminal attaches to the fake pod: its banner, then a typed line echoes back.
  const terminal = page.getByRole('group', { name: 'Claude Code terminal' });
  await expect(terminal).toContainText('Fake Claude Code', { timeout: 15_000 });
  await terminal.click();
  await page.keyboard.type('ok');
  await page.keyboard.press('Enter');
  await expect(terminal).toContainText(/\bok\b/);

  // The typed line starts a second turn in the pod; Finish is a 409 unless the run is idle, and "Needs you" may still be
  // the pre-turn status. The browser may never see `running` (the API signals `resumed` only when it knows the run is
  // idle, re-reading that at most every 5 s, and the turn is 2 s), so wait for proof the turn ended: a second
  // `agent_state` lifecycle event with state `needs_input` in the run log with the run idle.
  const runId = comment.runId ?? '';
  await expect
    .poll(
      async () => {
        const log = RunLogResponse.parse(await ok(await page.request.get(`/api/runs/${runId}/log`), 200, 'run log'));
        const turns = log.items.filter(
          (e) => e.type === 'lifecycle' && e.payload['kind'] === 'agent_state' && e.payload['state'] === 'needs_input',
        ).length;
        const run = RunDto.parse(await ok(await page.request.get(`/api/runs/${runId}`), 200, 'run'));
        return `${turns >= 2 ? 'second turn finished' : `${turns} turn(s)`}, ${run.status}`;
      },
      { timeout: 30_000 },
    )
    .toBe('second turn finished, idle');
  await expect(status('Needs you')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('region', { name: 'Terminal' }).getByRole('button', { name: 'Finish run' }).click();
  await expect(status('Succeeded')).toBeVisible({ timeout: 30_000 });

  // The session stays as read-only final scrollback.
  const view = page.getByRole('region', { name: 'Terminal' });
  await expect(view.getByRole('tab', { name: 'Final scrollback', selected: true })).toBeVisible();
  await expect(view.getByText(/^Ended, read-only/)).toBeVisible();
  await expect(terminal).toContainText('Fake Claude Code', { timeout: 15_000 });

  expect(consoleErrors).toEqual([]);
});

test('a --fake-done run shows Done and Finish closes it as succeeded', async ({ page }) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  await commentOnNewTicket(page, handle, projectId, '/code-review --fake-done');

  const runLink = page.getByRole('link', { name: 'Run 1', exact: true });
  await expect(runLink).toBeVisible({ timeout: 30_000 });
  await runLink.click();

  // The fake pod declares `done` at the end of its first turn: the Done status and its banner, not Needs you.
  const header = page.getByRole('banner');
  await expect(header.getByText('Done', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(header.getByText('Needs you', { exact: true })).toHaveCount(0);
  await expect(page.getByText('The agent says the task is done')).toBeVisible();

  await page.getByRole('region', { name: 'Terminal' }).getByRole('button', { name: 'Finish run' }).click();
  await expect(header.getByText('Succeeded', { exact: true })).toBeVisible({ timeout: 30_000 });
});

test('a --fake-fail run pauses with "agent crashed (exit code 3)" and offers Resume', async ({ page }) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  const runId = await commentOnNewTicket(page, handle, projectId, '/code-review --fake-fail');
  const number = RunDto.parse(await ok(await page.request.get(`/api/runs/${runId}`), 200, 'run')).number;

  // The fake agent exits 3 after its first turn: the run parks as paused with the reason, not as failed.
  await expect
    .poll(async () => RunDto.parse(await ok(await page.request.get(`/api/runs/${runId}`), 200, 'run')).status, {
      timeout: 60_000,
    })
    .toBe('paused');
  const run = RunDto.parse(await ok(await page.request.get(`/api/runs/${runId}`), 200, 'run'));
  expect(run.pauseReason).toBe('agent_crashed');

  await page.goto(`/o/${handle}/p/${projectId}/runs/${number}`);
  await expect(page.getByRole('banner').getByText('Paused', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Paused: agent crashed (exit code 3)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();

  await ok(await page.request.post(`/api/runs/${runId}/cancel`), 202, 'cancel').catch(() => null);
});

/*
 * Pause and resume (ADR 0022). Needs a stack whose worker has a short idle time, which would break the tests above (a
 * pod would be stopped between idle and attach), so it only runs when asked:
 *
 *   RUN_IDLE_END_SECONDS=5 devbox run dev-bg   # then
 *   E2E_IDLE_END_SECONDS=5 devbox run e2e-local
 *
 * The run page is not opened while waiting for the pause: attaching a terminal stops the idle timer. The stale-terminal
 * test below also wants short attach leases (a terminal that never closes cleanly is dropped after the lease time):
 *
 *   RUN_IDLE_END_SECONDS=5 RUN_LEASE_TTL_SECONDS=4 TERMINAL_LEASE_INTERVAL_MS=1000 devbox run dev-bg
 */
const IDLE_END_SECONDS = Number.parseInt(process.env['E2E_IDLE_END_SECONDS'] ?? '', 10);
const FAKE_STATE_DIR =
  process.env['E2E_FAKE_STATE_DIR'] ?? fileURLToPath(new URL('../../../../.agentdesk/fake', import.meta.url));

test.describe('pause and resume', () => {
  test.skip(
    !Number.isFinite(IDLE_END_SECONDS),
    'set E2E_IDLE_END_SECONDS to the stack worker RUN_IDLE_END_SECONDS (see the comment above)',
  );

  async function statusOf(page: Page, runId: string): Promise<string> {
    return RunDto.parse(await ok(await page.request.get(`/api/runs/${runId}`), 200, 'run')).status;
  }

  test('an idle run pauses, frees its slot for a queued run, and resumes with its conversation', async ({ page }) => {
    const waitMs = (IDLE_END_SECONDS + 60) * 1000;
    const { handle, projectId } = await signInAndCreateProject(page);

    // One slot, so the second run queues behind the first.
    await ok(
      await page.request.patch(`/api/projects/${projectId}`, { data: { maxConcurrentRuns: 1 } }),
      200,
      'project limit',
    );
    const first = await commentOnNewTicket(page, handle, projectId, '/code-review');
    const second = await commentOnNewTicket(page, handle, projectId, '/code-review');
    await expect.poll(() => statusOf(page, second), { timeout: 30_000 }).toBe('queued');

    // The first run asks its question (needs you), nobody attaches, and the idle time stops its pod.
    await expect.poll(() => statusOf(page, first), { timeout: waitMs }).toBe('paused');
    expect(existsSync(`${FAKE_STATE_DIR}/kube/run-${first}`), 'the paused run still has a pod').toBe(false);

    // Its slot went to the queued run.
    await expect.poll(() => statusOf(page, second), { timeout: waitMs }).not.toBe('queued');

    // Resume it from the run page. It queues behind the second run until that one pauses too.
    const firstNumber = RunDto.parse(await ok(await page.request.get(`/api/runs/${first}`), 200, 'run')).number;
    await page.goto(`/o/${handle}/p/${projectId}/runs/${firstNumber}`);
    const header = page.getByRole('banner');
    await expect(header.getByText('Paused', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(header.getByText('Needs you', { exact: true })).toBeVisible({ timeout: waitMs });

    // The resumed pod shows the earlier conversation (it only exists on the volume), and takes an answer.
    const terminal = page.getByRole('group', { name: 'Claude Code terminal' });
    await expect(terminal).toContainText('Fake Claude Code', { timeout: 15_000 });
    await terminal.click();
    await page.keyboard.type('answer');
    await page.keyboard.press('Enter');
    await expect(terminal).toContainText(/\banswer\b/);

    // The answer starts a new turn that ends needs_input again (the second one in the run's log).
    await expect
      .poll(
        async () => {
          const log = RunLogResponse.parse(await ok(await page.request.get(`/api/runs/${first}/log`), 200, 'run log'));
          return log.items.filter(
            (e) =>
              e.type === 'lifecycle' && e.payload['kind'] === 'agent_state' && e.payload['state'] === 'needs_input',
          ).length;
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThanOrEqual(2);
    await expect(header.getByText('Needs you', { exact: true })).toBeVisible({ timeout: 15_000 });

    // Clean up so the pods do not outlive the test.
    await ok(await page.request.post(`/api/runs/${first}/cancel`), 202, 'cancel first').catch(() => null);
    await ok(await page.request.post(`/api/runs/${second}/cancel`), 202, 'cancel second').catch(() => null);
  });

  test('a run whose terminal tab was killed still pauses on idle, and resumes with an answer', async ({
    page,
    context,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const runId = await commentOnNewTicket(page, handle, projectId, '/code-review');
    const number = RunDto.parse(await ok(await page.request.get(`/api/runs/${runId}`), 200, 'run')).number;
    await expect.poll(() => statusOf(page, runId), { timeout: 60_000 }).toBe('idle');

    // Attach a terminal from a second tab, then kill the tab without leaving the page (no clean close of its socket).
    const tab = await context.newPage();
    await tab.goto(`/o/${handle}/p/${projectId}/runs/${number}`);
    await expect(tab.getByRole('group', { name: 'Claude Code terminal' })).toContainText('Fake Claude Code', {
      timeout: 15_000,
    });
    await tab.close({ runBeforeUnload: false });

    // The dead terminal must not hold the idle timer: the run pauses after the idle time (plus the lease time).
    await expect.poll(() => statusOf(page, runId), { timeout: (IDLE_END_SECONDS + 60) * 1000 }).toBe('paused');
    expect(existsSync(`${FAKE_STATE_DIR}/kube/run-${runId}`), 'the paused run still has a pod').toBe(false);

    await page.goto(`/o/${handle}/p/${projectId}/runs/${number}`);
    const header = page.getByRole('banner');
    await expect(header.getByText('Paused', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Paused: waiting for your answer.')).toBeVisible();
    await expect(page.getByText(/Paused .*, after .* with nobody attached/)).toBeVisible();

    // Resume, answer, and the answer starts a new turn.
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(header.getByText('Needs you', { exact: true })).toBeVisible({ timeout: 60_000 });
    const terminal = page.getByRole('group', { name: 'Claude Code terminal' });
    await expect(terminal).toContainText('Fake Claude Code', { timeout: 15_000 });
    await terminal.click();
    await page.keyboard.type('answer');
    await page.keyboard.press('Enter');
    await expect(terminal).toContainText(/\banswer\b/);
    await expect
      .poll(
        async () => {
          const log = RunLogResponse.parse(await ok(await page.request.get(`/api/runs/${runId}/log`), 200, 'run log'));
          return log.items.filter(
            (e) =>
              e.type === 'lifecycle' && e.payload['kind'] === 'agent_state' && e.payload['state'] === 'needs_input',
          ).length;
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThanOrEqual(2);

    await ok(await page.request.post(`/api/runs/${runId}/cancel`), 202, 'cancel').catch(() => null);
  });
});

/*
 * Cluster outage (ADR 0024). The fake cluster refuses every call while `<state dir>/kube/.outage` exists. Start the
 * stack with a short reconnect window, then run with the same value:
 *
 *   RUN_RECONNECT_WINDOW_SECONDS=20 devbox run dev-bg   # then
 *   E2E_RECONNECT_WINDOW_SECONDS=20 pnpm --filter @agentdesk/web exec playwright test e2e/local/run.spec.ts -g "cluster outage"
 *
 * Run only these (`-g`), on a stack of their own: the outage is global to the fake cluster, so any other run on that
 * stack (other e2e tests run in parallel workers, or your own runs) loses contact too and parks once the short window
 * ends. Never combine them with the full `e2e-local`.
 */
const RECONNECT_WINDOW_SECONDS = Number.parseInt(process.env['E2E_RECONNECT_WINDOW_SECONDS'] ?? '', 10);
const OUTAGE_FILE = `${FAKE_STATE_DIR}/kube/.outage`;

test.describe('cluster outage', () => {
  // The outage switch is one file for the whole fake cluster: the two tests must not overlap each other.
  test.describe.configure({ mode: 'serial' });
  test.skip(
    !Number.isFinite(RECONNECT_WINDOW_SECONDS),
    'set E2E_RECONNECT_WINDOW_SECONDS to the stack worker RUN_RECONNECT_WINDOW_SECONDS (see the comment above)',
  );

  async function runOf(page: Page, runId: string): Promise<RunDto> {
    return RunDto.parse(await ok(await page.request.get(`/api/runs/${runId}`), 200, 'run'));
  }

  async function lifecycleKinds(page: Page, runId: string): Promise<string[]> {
    const log = RunLogResponse.parse(await ok(await page.request.get(`/api/runs/${runId}/log`), 200, 'run log'));
    return log.items.flatMap((e) => (e.type === 'lifecycle' ? [String(e.payload['kind'])] : []));
  }

  test('a short cluster outage mid-run does not fail the run: the timeline shows lost and restored contact', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const runId = await commentOnNewTicket(page, handle, projectId, '/code-review');
    await expect.poll(async () => (await runOf(page, runId)).status, { timeout: 60_000 }).toBe('idle');

    try {
      await mkdir(`${FAKE_STATE_DIR}/kube`, { recursive: true });
      await writeFile(OUTAGE_FILE, '');
      await expect.poll(() => lifecycleKinds(page, runId), { timeout: 60_000 }).toContain('contact_lost');
    } finally {
      await rm(OUTAGE_FILE, { force: true });
    }
    await expect.poll(() => lifecycleKinds(page, runId), { timeout: 60_000 }).toContain('contact_restored');

    expect((await runOf(page, runId)).status).toBe('idle');
    expect(existsSync(`${FAKE_STATE_DIR}/kube/run-${runId}`), 'the run still has its pod').toBe(true);

    await ok(await page.request.post(`/api/runs/${runId}/cancel`), 202, 'cancel').catch(() => null);
  });

  test('an outage longer than the window parks the run with its work kept and it can be resumed', async ({ page }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const runId = await commentOnNewTicket(page, handle, projectId, '/code-review');
    const number = (await runOf(page, runId)).number;
    await expect.poll(async () => (await runOf(page, runId)).status, { timeout: 60_000 }).toBe('idle');

    try {
      await mkdir(`${FAKE_STATE_DIR}/kube`, { recursive: true });
      await writeFile(OUTAGE_FILE, '');
      await expect.poll(() => lifecycleKinds(page, runId), { timeout: 60_000 }).toContain('contact_lost');
      await page.waitForTimeout((RECONNECT_WINDOW_SECONDS + 5) * 1000);
    } finally {
      await rm(OUTAGE_FILE, { force: true });
    }

    await expect.poll(async () => (await runOf(page, runId)).status, { timeout: 90_000 }).toBe('paused');
    expect((await runOf(page, runId)).pauseReason).toBe('pod_lost');
    await expect.poll(() => existsSync(`${FAKE_STATE_DIR}/kube/run-${runId}`), { timeout: 30_000 }).toBe(false);

    await page.goto(`/o/${handle}/p/${projectId}/runs/${number}`);
    const header = page.getByRole('banner');
    await expect(header.getByText('Paused', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(header.getByText('Needs you', { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('group', { name: 'Claude Code terminal' })).toContainText('Fake Claude Code', {
      timeout: 15_000,
    });

    await ok(await page.request.post(`/api/runs/${runId}/cancel`), 202, 'cancel').catch(() => null);
  });
});
