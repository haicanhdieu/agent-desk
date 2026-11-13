import { randomBytes, randomInt } from 'node:crypto';
import { expect, test, type APIResponse } from '@playwright/test';
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

test('a comment on the fake board becomes a live run: idle, terminal echo, finish, read-only scrollback', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(e.message));

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
  // `turn_finished` lifecycle event in the run log with the run idle.
  const runId = comment.runId ?? '';
  await expect
    .poll(
      async () => {
        const log = RunLogResponse.parse(await ok(await page.request.get(`/api/runs/${runId}/log`), 200, 'run log'));
        const turns = log.items.filter((e) => e.type === 'lifecycle' && e.payload['kind'] === 'turn_finished').length;
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
