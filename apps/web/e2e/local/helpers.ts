import { randomBytes, randomInt } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  expect,
  request,
  type APIRequestContext,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import {
  AccessDto,
  AgentDto,
  AssignmentDto,
  CreateOrgResponse,
  InstallResponse,
  InvitationDto,
  PlatformAdminDto,
  PlatformMemberDto,
  PlatformRoleDto,
  type PrState,
  RoleDto,
  RunDto,
  RunLogResponse,
  RunTranscriptResponse,
  pageOf,
  type RunTranscriptEntryDto,
} from '@agentdesk/contracts';
import { z } from 'zod';

// Shared by the local e2e specs: the stack's addresses, the platform-admin org and invitation setup, the project setup, the fake board and fake pod
// helpers (the stack from `pnpm dev` with KUBE_MODE=fake).

export const API = 'http://localhost:3000';
export const REPO = 'dev/demo';
/** The repository radio of the setup: its name starts with the path, and the fake board also lists dev/demo-2 and dev/demo-3. */
const REPO_RADIO = new RegExp(`^${REPO}(?![\\w-])`);
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

/** The built-in role keys every org starts with. */
export type RoleKey = 'owner' | 'admin' | 'member' | 'viewer';
export type InviteScope = { type: 'org' } | { type: 'project'; projectIds: string[] };
export type GrantScope = { type: 'org' } | { type: 'project'; projectId: string };

/** The platform admin's dev-login handle: `admin@dev.local`, seeded by the local stack start. */
export const PLATFORM_ADMIN_HANDLE = 'admin';

/**
 * A request context (own cookie jar, straight to the api) signed in as the platform admin; callers `dispose()` it.
 * On a fresh database parallel workers all try the first sign-up: one wins and the others answer 401 (duplicate
 * email), so a 401 is retried a few times (the user exists by then) and the last failure is thrown.
 */
export async function asPlatformAdmin(): Promise<APIRequestContext> {
  const pa = await request.newContext({ baseURL: API });
  const attempts = 4;
  for (let attempt = 1; ; attempt++) {
    const res = await pa.get(`/auth/dev-login?handle=${PLATFORM_ADMIN_HANDLE}&redirect=/`, { maxRedirects: 0 });
    if (res.status() === 302) {
      // No account and no platform_admins entry: dev login refuses with a 302 to /sign-in?error=no_invitation and sets no cookie.
      const refused = (res.headers()['location'] ?? '').startsWith('/sign-in');
      const orgs = refused ? null : await pa.get('/api/platform/orgs?pageSize=1');
      if (refused || orgs?.status() === 401 || orgs?.status() === 403) {
        await pa.dispose();
        throw new Error(
          `${PLATFORM_ADMIN_HANDLE}@dev.local is not a platform admin on this stack: seed it (docs/runbooks/platform-setup.md, step 5)`,
        );
      }
      return pa;
    }
    if (res.status() === 401 && attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      continue;
    }
    const text = await res.text();
    await pa.dispose();
    throw new Error(`platform admin dev-login answered ${res.status()}: ${text}`);
  }
}

/** A new e2e-<rand> user invited (viewer, org scope) into orgId and signed in through dev login in its own context, not accepted (no org). */
export async function freshUser(
  pa: APIRequestContext,
  orgId: string,
): Promise<{ api: APIRequestContext; handle: string; email: string; userId: string }> {
  const handle = `e2e-${randomBytes(4).toString('hex')}`;
  const email = `${handle}@dev.local`;
  await inviteViaApi(pa, orgId, email, 'viewer', { type: 'org' });
  const api = await request.newContext({ baseURL: API });
  try {
    const login = await api.get(`/auth/dev-login?handle=${handle}&redirect=/`, { maxRedirects: 0 });
    expect(login.status(), `dev-login ${handle}: ${await login.text()}`).toBe(302);
    const access = AccessDto.parse(await ok(await api.get('/api/me/access'), 200, `access of ${handle}`));
    return { api, handle, email, userId: access.userId };
  } catch (error) {
    await api.dispose();
    throw error;
  }
}

/** Grants the platform admin role to an email through the platform route: 201 new or 200 existing, else throws. */
export async function grantPlatformAdmin(
  pa: APIRequestContext,
  email: string,
): Promise<{ status: number; entry: PlatformAdminDto }> {
  const res = await pa.post('/api/platform/admins', { data: { email } });
  const text = await res.text();
  if (res.status() !== 200 && res.status() !== 201) {
    throw new Error(`grant platform admin ${email}: ${res.status()} ${text}`);
  }
  return { status: res.status(), entry: PlatformAdminDto.parse(JSON.parse(text)) };
}

/** Removes a platform admin entry (exactly 204). */
export async function revokePlatformAdmin(pa: APIRequestContext, adminId: string): Promise<void> {
  await ok(await pa.delete(`/api/platform/admins/${adminId}`), 204, 'revoke platform admin');
}

/** Every platform admin entry (reads every page). */
export async function allPlatformAdmins(pa: APIRequestContext): Promise<PlatformAdminDto[]> {
  const entries: PlatformAdminDto[] = [];
  for (let page = 1; ; page++) {
    const body = pageOf(PlatformAdminDto).parse(
      await ok(await pa.get(`/api/platform/admins?pageSize=100&page=${page}`), 200, 'platform admins'),
    );
    entries.push(...body.items);
    if (body.items.length === 0 || entries.length >= body.total) return entries;
  }
}

/** Creates an org through `POST /api/platform/orgs` (its built-in roles are copied in). */
export async function createOrg(pa: APIRequestContext, name: string, slug: string): Promise<CreateOrgResponse> {
  return CreateOrgResponse.parse(
    await ok(await pa.post('/api/platform/orgs', { data: { name, slug } }), 201, `create org ${slug}`),
  );
}

async function roleIdOf(pa: APIRequestContext, orgId: string, roleKey: RoleKey): Promise<string> {
  const roles = z
    .array(PlatformRoleDto)
    .parse(await ok(await pa.get(`/api/platform/orgs/${orgId}/roles`), 200, 'platform roles'));
  const role = roles.find((r) => r.key === roleKey);
  expect(role, `org ${orgId} has no role ${roleKey}`).toBeTruthy();
  return role?.id ?? '';
}

/**
 * Invites `email` to the org with a built-in role and scope through the platform route (the default) or the org's own
 * route (`via: 'tenant'`, for the signed-in owner or admin `api`); returns the pending invitation's id.
 */
export async function inviteViaApi(
  api: APIRequestContext,
  orgId: string,
  email: string,
  roleKey: RoleKey,
  scope: InviteScope,
  via: 'tenant' | 'platform' = 'platform',
): Promise<{ id: string }> {
  const roleId =
    via === 'platform'
      ? await roleIdOf(api, orgId, roleKey)
      : z
          .array(RoleDto)
          .parse(await ok(await api.get(`/api/orgs/${orgId}/roles`), 200, 'org roles'))
          .find((r) => r.key === roleKey)?.id;
  expect(roleId, `org ${orgId} has no role ${roleKey}`).toBeTruthy();
  const path = via === 'platform' ? `/api/platform/orgs/${orgId}/invitations` : `/api/orgs/${orgId}/invitations`;
  const created = InvitationDto.parse(
    await ok(await api.post(path, { data: { email, roleId, scope } }), 201, `invite ${email}`),
  );
  return { id: created.id };
}

/** Accepts an invitation as the person `page` is signed in as (`POST /api/me/invitations/:id/accept`, exactly 200). */
export async function acceptViaApi(page: Page, invitationId: string): Promise<void> {
  await ok(await page.request.post(`/api/me/invitations/${invitationId}/accept`), 200, 'accept invitation');
}

/** Dev-logs `handle` in on a new page of `context` (no invitation is accepted) and returns the page. */
export async function signInAs(context: BrowserContext, handle: string, redirect = '/'): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`/auth/dev-login?handle=${handle}&redirect=${encodeURIComponent(redirect)}`);
  return page;
}

/** A new browser context signed in as the platform admin (`admin@dev.local`); the caller closes it. */
export async function platformAdminContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext();
  try {
    const page = await signInAs(context, PLATFORM_ADMIN_HANDLE);
    await page.close();
    return context;
  } catch (error) {
    await context.close().catch(() => null);
    throw error;
  }
}

/**
 * Platform-invites `<handle>@dev.local` with a built-in role and scope, dev-logs `page` in as that handle, accepts the
 * invitation through the invitee route and signs in again (a new session starts in the oldest membership); returns the
 * new user's id. Ends on the dev-login redirect target (`/`).
 */
export async function inviteAndSignIn(
  page: Page,
  pa: APIRequestContext,
  orgId: string,
  handle: string,
  roleKey: RoleKey,
  scope: InviteScope,
): Promise<{ userId: string }> {
  const email = `${handle.toLowerCase()}@dev.local`;
  const invitation = await inviteViaApi(pa, orgId, email, roleKey, scope);
  await page.goto(`/auth/dev-login?handle=${handle}&redirect=/`);
  await acceptViaApi(page, invitation.id);
  await page.goto(`/auth/dev-login?handle=${handle}&redirect=/`);
  const members = pageOf(PlatformMemberDto).parse(
    await ok(await pa.get(`/api/platform/orgs/${orgId}/members?pageSize=100`), 200, 'platform members'),
  );
  const member = members.items.find((m) => m.email === email);
  expect(member, `${email} is not a member of org ${orgId} after sign-in`).toBeTruthy();
  return { userId: member?.userId ?? '' };
}

/** Grants a built-in role to a member of the org through the platform route; returns the assignment (200 for a repeat). */
export async function grant(
  pa: APIRequestContext,
  orgId: string,
  userId: string,
  roleKey: RoleKey,
  scope: GrantScope,
): Promise<AssignmentDto> {
  const res = await pa.post(`/api/platform/orgs/${orgId}/assignments`, {
    data: { userId, roleId: await roleIdOf(pa, orgId, roleKey), scope },
  });
  const text = await res.text();
  expect([200, 201], `grant ${roleKey}: ${res.status()} ${text}`).toContain(res.status());
  return AssignmentDto.parse(JSON.parse(text));
}

/** Removes an assignment through the platform route. */
export async function revoke(pa: APIRequestContext, orgId: string, assignmentId: string): Promise<void> {
  await ok(await pa.delete(`/api/platform/orgs/${orgId}/assignments/${assignmentId}`), 204, 'revoke assignment');
}

/**
 * A fresh user for one flow: a platform admin creates an org whose slug is the handle and invites the handle as
 * `owner` over the whole org, then `page` signs in as that handle, so the URLs stay `/o/<handle>/...`.
 */
async function newOwner(page: Page): Promise<string> {
  const handle = `e2e-${randomBytes(4).toString('hex')}`;
  const pa = await asPlatformAdmin();
  try {
    const org = await createOrg(pa, `E2E ${handle}`, handle);
    await inviteAndSignIn(page, pa, org.id, handle, 'owner', { type: 'org' });
  } finally {
    await pa.dispose();
  }
  await page.goto('/');
  await expect(page).toHaveURL(new RegExp(`/o/${handle}/projects$`));
  return handle;
}

/** A new owner (org created by the platform admin, owner invitation), then the five setup steps against the fake board; ends on the project's Runs page. */
export async function signInAndCreateProject(page: Page): Promise<{ handle: string; projectId: string }> {
  // Sign in: a platform-created org with the handle as its slug, an owner invitation, then dev login accepts it.
  const handle = await newOwner(page);

  // The fake connection: the app's Connect button installs GitHub only, so the install starts over the API. Its URL is
  // the fake callback, which records the connection and lands on the setup's repository step.
  const install = InstallResponse.parse(
    await ok(await page.request.post('/api/connections/fake/install'), 201, 'install'),
  );
  await page.goto(install.url);
  await expect(page).toHaveURL(new RegExp(`/o/${handle}/projects/new/repo\\?connection=`));

  // Step 1: repository dev/demo, webhook trigger (the default).
  await expect(page.getByRole('heading', { name: 'Connect a repository', level: 1 })).toBeVisible();
  await page.getByRole('radio', { name: REPO_RADIO }).check();
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

/** A new owner (as above), then the wizard's first step only: a project whose agent has no credential and no address. */
export async function signInAndStartProject(page: Page): Promise<{ handle: string; projectId: string }> {
  const handle = await newOwner(page);
  const install = InstallResponse.parse(
    await ok(await page.request.post('/api/connections/fake/install'), 201, 'install'),
  );
  await page.goto(install.url);
  await expect(page).toHaveURL(new RegExp(`/o/${handle}/projects/new/repo\\?connection=`));
  await page.getByRole('radio', { name: REPO_RADIO }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Add the Claude credential', level: 1 })).toBeVisible();
  const projectId = /[?&]project=([0-9a-f-]+)/.exec(page.url())?.[1];
  expect(projectId, page.url()).toBeTruthy();
  return { handle, projectId: projectId ?? '' };
}

/** A pull request on the fake board with a webhook comment; returns the run it created. The comment's author is `author`, else the signed-in handle (its linked identity). */
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
        data: { repoPath: REPO, ticketNumber, body, deliver: 'webhook', projectId, author: author ?? handle },
      }),
      201,
      'fake comment',
    ),
  );
  expect(comment.runId, `comment outcome ${comment.outcome}`).toBeTruthy();
  return comment.runId ?? '';
}

/** A fake ticket with a random number (or `number` to re-add one with a new link or `prState`, PRs only). Issues carry the user-story label
 *  the /code-build rule needs. `linked`: on a PR, the issues it closes; on an issue, its linked PRs. Returns its number. */
export async function addFakeTicket(
  page: Page,
  kind: 'issue' | 'pr',
  opts: { number?: number; linked?: number[]; prState?: PrState } = {},
): Promise<number> {
  const number = opts.number ?? randomInt(100_000, 1_000_000_000);
  await ok(
    await page.request.post('/dev/fake/tickets', {
      data: {
        repoPath: REPO,
        number,
        kind,
        title: `e2e ${kind} ${number}`,
        labels: kind === 'issue' ? ['user-story'] : [],
        ...(opts.linked ? { linked: opts.linked } : {}),
        ...(opts.prState ? { prState: opts.prState } : {}),
      },
    }),
    201,
    'fake ticket',
  );
  return number;
}

/** A webhook-delivered comment on an existing fake ticket of the project. `author` must be a linked user (the signed-in handle) to start a run. */
export async function commentOn(
  page: Page,
  projectId: string,
  ticketNumber: number,
  body: string,
  author?: string,
): Promise<{ outcome: string; runId?: string }> {
  return CommentResult.parse(
    await ok(
      await page.request.post('/dev/fake/comments', {
        data: { repoPath: REPO, ticketNumber, body, deliver: 'webhook', projectId, ...(author ? { author } : {}) },
      }),
      201,
      'fake comment',
    ),
  );
}

/** Cancels a run and waits for `cancelled` (a second run of one skill on a ticket is refused while one is active). */
export async function cancelRun(page: Page, runId: string): Promise<void> {
  await ok(await page.request.post(`/api/runs/${runId}/cancel`), 202, 'cancel');
  await waitForStatus(page, runId, 'cancelled');
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

/** The `text` of every `lifecycle` event of a run (`GET /api/runs/:runId/log`), oldest first; events without a text are left out. */
export async function lifecycleTexts(page: Page, runId: string): Promise<string[]> {
  const log = RunLogResponse.parse(await ok(await page.request.get(`/api/runs/${runId}/log`), 200, 'run log'));
  return log.items.flatMap((e) => {
    if (e.type !== 'lifecycle') return [];
    const text = e.payload['text'];
    return typeof text === 'string' ? [text] : [];
  });
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
