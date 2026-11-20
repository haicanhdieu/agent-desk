import { randomBytes, randomInt } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, type APIResponse, type Page } from '@playwright/test';
import {
  AgentDto,
  InstallResponse,
  RunDto,
  RunTranscriptResponse,
  type RunTranscriptEntryDto,
} from '@agentdesk/contracts';
import { z } from 'zod';

// Shared by the local e2e specs: the stack's addresses, the dev-login project setup, the fake board and fake pod
// helpers (the stack from `pnpm dev` with KUBE_MODE=fake).

export const API = 'http://localhost:3000';
export const REPO = 'dev/demo';
/** Where the stack keeps the fake cluster's state (E2E_FAKE_STATE_DIR when it is not the default); a run's pod dir is `<dir>/kube/run-<runId>`. */
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

/** The wizard's first step only: a project whose agent has no credential and no address. */
export async function signInAndStartProject(page: Page): Promise<{ handle: string; projectId: string }> {
  const handle = `e2e-${randomBytes(4).toString('hex')}`;
  await page.goto(`/auth/dev-login?handle=${handle}&redirect=/`);
  await expect(page).toHaveURL(new RegExp(`/o/${handle}/projects$`));
  const install = InstallResponse.parse(
    await ok(await page.request.post('/api/connections/fake/install'), 201, 'install'),
  );
  await page.goto(install.url);
  await expect(page).toHaveURL(new RegExp(`/o/${handle}/projects/new/repo\\?connection=`));
  await page.getByRole('radio', { name: REPO }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Add the Claude credential', level: 1 })).toBeVisible();
  const projectId = /[?&]project=([0-9a-f-]+)/.exec(page.url())?.[1];
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

/** Lines of the fake pod's log for a run ([] when none yet). */
export async function podLogLines(runId: string): Promise<string[]> {
  const log = await readFile(`${FAKE_STATE_DIR}/kube/run-${runId}/log`, 'utf8').catch(() => '');
  return log === '' ? [] : log.split('\n');
}

// ---- Desk → Agent & settings: shared by the specs that drive the agent screen and its API ----

export const deskAgentUrl = (handle: string, projectId: string) => `/o/${handle}/p/${projectId}/desk/agent`;
export const modelSelect = (page: Page) => page.getByRole('combobox', { name: 'Default model' });
export const addressInput = (page: Page) => page.getByRole('textbox', { name: 'API address' });
export const newToken = (page: Page) => page.getByLabel('New token', { exact: true });
export const newTokenValue = () => `sk-ant-e2e-${randomBytes(8).toString('hex')}`;

export async function openAgent(page: Page, handle: string, projectId: string) {
  await page.goto(deskAgentUrl(handle, projectId));
  await expect(page.getByRole('heading', { name: 'Agent & settings', level: 1 })).toBeVisible();
  // The picker leaves its loading state once the list is there.
  await expect(modelSelect(page).locator('option')).toHaveText(['opus', 'sonnet', 'haiku', 'Other model…']);
}

export async function readAgent(page: Page, projectId: string): Promise<AgentDto> {
  return AgentDto.parse(await ok(await page.request.get(`/api/projects/${projectId}/agent`), 200, 'agent'));
}

/** Given: the agent's saved default model (the run limits stay as they are). */
export async function setDefaultModel(page: Page, projectId: string, model: string) {
  const agent = await readAgent(page, projectId);
  await ok(
    await page.request.put(`/api/projects/${projectId}/agent`, {
      data: { model, timeoutSeconds: agent.timeoutSeconds },
    }),
    200,
    'set default model',
  );
}

/** Given: the agent's automatic-resume limit (the model and run limits stay as they are). 0 pins the "off" behaviour. */
export async function setAutoResumeMax(page: Page, projectId: string, value: number): Promise<void> {
  const agent = await readAgent(page, projectId);
  await ok(
    await page.request.put(`/api/projects/${projectId}/agent`, {
      data: { model: agent.model, timeoutSeconds: agent.timeoutSeconds, autoResumeMax: value },
    }),
    200,
    'set auto resume max',
  );
}

/** Given: a saved API address and a credential for it, through the agent API (the same route the screen uses). */
export async function setAddressAndCredential(page: Page, agentId: string, baseUrl: string) {
  await ok(
    await page.request.put(`/api/agents/${agentId}/credential`, {
      data: { type: 'api_key', value: newTokenValue(), baseUrl },
    }),
    200,
    'set address and credential',
  );
}

export const isAgentPut = (r: { url(): string; request(): { method(): string } }) =>
  new URL(r.url()).pathname.endsWith('/agent') && r.request().method() === 'PUT';
export const isCredentialPut = (r: { url(): string; request(): { method(): string } }) =>
  /\/api\/agents\/[^/]+\/credential$/.test(new URL(r.url()).pathname) && r.request().method() === 'PUT';
