import { randomBytes, randomInt } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, type APIResponse, type Page } from '@playwright/test';
import { InstallResponse, RunDto, RunTranscriptResponse, type RunTranscriptEntryDto } from '@agentdesk/contracts';
import { z } from 'zod';

/* Helpers shared by the real localhost end-to-end specs (the stack from `pnpm dev` with KUBE_MODE=fake). */

export const API = 'http://localhost:3000';
export const REPO = 'dev/demo';
/** The fake pod state dir of the running stack (a run's pod dir is `<dir>/kube/run-<runId>`). */
export const FAKE_STATE_DIR =
  process.env['E2E_FAKE_STATE_DIR'] ?? fileURLToPath(new URL('../../../../.agentdesk/fake', import.meta.url));

/** `POST /dev/fake/comments` answer (dev route, not in the contracts; apps/api/src/dev/fake.controller.ts). */
export const CommentResult = z.object({ commentId: z.string(), outcome: z.string(), runId: z.string().optional() });

export async function ok(res: APIResponse, status: number, what: string): Promise<unknown> {
  const text = await res.text();
  expect(res.status(), `${what}: ${text}`).toBe(status);
  return text === '' ? null : (JSON.parse(text) as unknown);
}

/** Dev login, then the five setup steps against the fake board; ends on the project's Runs page. */
export async function signInAndCreateProject(page: Page): Promise<{ handle: string; projectId: string }> {
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
export async function commentOnNewTicket(
  page: Page,
  handle: string,
  projectId: string,
  body: string,
  author?: string,
): Promise<string> {
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
        data: { repoPath: REPO, ticketNumber, body, deliver: 'webhook', projectId, ...(author ? { author } : {}) },
      }),
      201,
      'fake comment',
    ),
  );
  expect(comment.runId, `comment outcome ${comment.outcome}`).toBeTruthy();
  return comment.runId ?? '';
}

/** Creates `name` in the run's fake pod state dir (`release-start`, `release-end`, `hardkill`). */
export async function touchPodFile(runId: string, name: string): Promise<void> {
  const podDir = `${FAKE_STATE_DIR}/kube/run-${runId}`;
  await mkdir(podDir, { recursive: true });
  await writeFile(`${podDir}/${name}`, '');
}

const PostedComments = z.array(z.object({ ticketRef: z.string(), body: z.string() }));

/** Reads `GET /dev/fake/posted` (comments the app posted on the fake board). */
export async function postedComments(page: Page): Promise<{ ticketNumber: number; body: string }[]> {
  const res = await page.request.get(`/dev/fake/posted?repoPath=${encodeURIComponent(REPO)}`);
  return PostedComments.parse(await ok(res, 200, 'posted comments')).map((c) => ({
    ticketNumber: Number.parseInt(c.ticketRef, 10),
    body: c.body,
  }));
}

/** Fetches every transcript entry of a run through `runs.transcript`, oldest first. */
export async function transcriptOf(page: Page, runId: string): Promise<RunTranscriptEntryDto[]> {
  const pages: RunTranscriptEntryDto[][] = [];
  let before: number | null = null;
  do {
    const query = before === null ? '?limit=500' : `?limit=500&before=${before}`;
    const res = RunTranscriptResponse.parse(
      await ok(await page.request.get(`/api/runs/${runId}/transcript${query}`), 200, 'run transcript'),
    );
    pages.unshift(res.items);
    before = res.nextBefore;
  } while (before !== null);
  return pages.flat();
}

let shared: { handle: string; projectId: string } | undefined;

/** One dev-login user and project per worker: made on first use, signed in again on the next. */
export async function projectFor(page: Page): Promise<{ handle: string; projectId: string }> {
  if (shared === undefined) {
    shared = await signInAndCreateProject(page);
  } else {
    await page.goto(`/auth/dev-login?handle=${shared.handle}&redirect=/`);
    await expect(page).toHaveURL(new RegExp(`/o/${shared.handle}/projects$`));
  }
  return shared;
}

export async function runOf(page: Page, runId: string): Promise<RunDto> {
  return RunDto.parse(await ok(await page.request.get(`/api/runs/${runId}`), 200, 'run'));
}

export async function waitForStatus(
  page: Page,
  runId: string,
  status: RunDto['status'],
  timeout = 60_000,
): Promise<void> {
  await expect
    .poll(async () => (await runOf(page, runId)).status, { timeout, intervals: [200, 500, 1000] })
    .toBe(status);
}
