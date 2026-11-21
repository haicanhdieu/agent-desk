import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { AgentDto, ProjectDto, RuleDto } from '@agentdesk/contracts';
import { API, grant, inviteAndSignIn, ok } from './helpers';
import { REPO_P1, REPO_P2, installFake } from './rbac-cast';
import { withScope, type Org, type Scope } from './onboarding-scope';

/*
 * Local end-to-end for the first-run checklist on the Projects page (spec "E2E requirements": BR-13, BR-14, BR-16).
 * Every case makes its own org with a random tag and one browser context per person. The owner is invited over the
 * whole org and signed in; the setup steps (connection, project, agent credential, rule) are done over the API with
 * the owner's own session, so the card is what the Given says. The checklist's four rows are "Connect a code host",
 * "Create a project", "Add an agent" and "Add a rule"; a done row shows "Done", a not-done row "Not done" and "Start".
 */

test.describe.configure({ timeout: 180_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

const FIRST_HEADING = { timeout: 30_000 };
const LABELS = ['Connect a code host', 'Create a project', 'Add an agent', 'Add a rule'] as const;
type Label = (typeof LABELS)[number];

interface Owner {
  org: Org;
  context: BrowserContext;
  page: Page;
  api: APIRequestContext;
}

/** A new org with an owner (invited over the whole org, signed in); nothing else is set up. */
async function ownerOrg(scope: Scope, browser: Browser): Promise<Owner> {
  const org = await scope.org('o');
  const context = await scope.person(browser);
  const page = await context.newPage();
  await inviteAndSignIn(page, scope.pa, org.id, scope.handle('owner'), 'owner', { type: 'org' });
  return { org, context, page, api: context.request };
}

const addConnection = (o: Owner): Promise<string> => installFake({ api: o.api });

async function addProject(o: Owner, connectionId: string, repoPath: string): Promise<ProjectDto> {
  return ProjectDto.parse(
    await ok(
      await o.api.post('/api/projects', { data: { connectionId, repoPath, triggerMode: 'webhook' } }),
      201,
      `create project ${repoPath}`,
    ),
  );
}

async function addCredential(o: Owner, projectId: string): Promise<void> {
  const agent = AgentDto.parse(await ok(await o.api.get(`/api/projects/${projectId}/agent`), 200, 'agent'));
  await ok(
    await o.api.put(`/api/agents/${agent.id}/credential`, {
      data: { type: 'api_key', value: `sk-ant-e2e-${randomBytes(8).toString('hex')}` },
    }),
    200,
    'set credential',
  );
}

async function addRule(o: Owner, projectId: string): Promise<void> {
  RuleDto.parse(
    await ok(
      await o.api.post(`/api/projects/${projectId}/rules`, {
        data: {
          command: 'checklist-run',
          labelFilter: [],
          target: 'any',
          enabled: true,
          kind: 'prompt',
          prompt: 'Reply with one short sentence.',
        },
      }),
      201,
      'create rule',
    ),
  );
}

const isChecklistGet = (r: { url(): string; request(): { method(): string } }): boolean =>
  new URL(r.url()).pathname.endsWith('/checklist') && r.request().method() === 'GET';

/** Opens the Projects page of the org (its heading is "Create your first project" while the org has none) and waits until the checklist answer and the heading are in. */
async function openProjects(page: Page, org: Org): Promise<void> {
  const answered = page.waitForResponse(isChecklistGet, FIRST_HEADING);
  await page.goto(`/o/${org.slug}/projects`);
  await expect(page.getByRole('heading', { level: 1, name: /^(Projects|Create your first project)$/ })).toBeVisible(
    FIRST_HEADING,
  );
  expect((await answered).status()).toBe(200);
}

const card = (page: Page) => page.getByRole('heading', { level: 2, name: 'Get started' }).locator('..');
const row = (page: Page, label: Label) =>
  card(page)
    .getByRole('listitem')
    .filter({ has: page.getByText(label, { exact: true }) });

/** The card lists exactly the four steps, in order. */
async function expectFourRows(page: Page): Promise<void> {
  await expect(card(page).getByRole('listitem')).toHaveCount(4);
  await expect(card(page).getByRole('listitem')).toHaveText([
    new RegExp(`^${LABELS[0]}`),
    new RegExp(`^${LABELS[1]}`),
    new RegExp(`^${LABELS[2]}`),
    new RegExp(`^${LABELS[3]}`),
  ]);
}

async function expectDone(page: Page, label: Label): Promise<void> {
  const r = row(page, label);
  await expect(r).toHaveCount(1);
  await expect(r.getByRole('img', { name: 'Done', exact: true })).toBeVisible();
  await expect(r.getByText('Done', { exact: true })).toBeVisible();
  await expect(r.getByRole('link', { name: /Start/ })).toHaveCount(0);
}

async function expectNotDone(page: Page, label: Label): Promise<void> {
  const r = row(page, label);
  await expect(r).toHaveCount(1);
  await expect(r.getByRole('img', { name: 'Not done', exact: true })).toBeVisible();
  await expect(r.getByRole('link', { name: /Start/ })).toBeVisible();
  await expect(r.getByText('Done', { exact: true })).toHaveCount(0);
}

async function expectAllNotDone(page: Page): Promise<void> {
  await expect(card(page)).toBeVisible(FIRST_HEADING);
  await expectFourRows(page);
  for (const label of LABELS) await expectNotDone(page, label);
}

/** No card: only asserted after the Projects page and the checklist answer are in and no loading placeholder remains. */
async function expectNoCard(page: Page, projectIds: string[], org: Org): Promise<void> {
  for (const id of projectIds) {
    await expect(page.locator(`a[href="/o/${org.slug}/p/${id}/runs"]`)).toBeVisible(FIRST_HEADING);
  }
  await expect(page.getByText('Loading checklist')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 2, name: 'Get started' })).toHaveCount(0);
  await expect(page.getByRole('listitem').filter({ hasText: 'Connect a code host' })).toHaveCount(0);
}

test('TC-13.1: the owner of a new org sees the Get started card with four not-done rows', async ({ browser }) => {
  await withScope(async (scope) => {
    const o = await ownerOrg(scope, browser);
    await openProjects(o.page, o.org);
    await expect(o.page.getByRole('heading', { level: 2, name: 'Get started' })).toBeVisible();
    await expectAllNotDone(o.page);
  });
});

test('TC-13.2: an org admin sees the same Get started card with four not-done rows', async ({ browser }) => {
  await withScope(async (scope) => {
    const org = await scope.org('o');
    const owner = await scope.person(browser);
    const ownerPage = await owner.newPage();
    await inviteAndSignIn(ownerPage, scope.pa, org.id, scope.handle('owner'), 'owner', { type: 'org' });
    // The user joins as a viewer, then is granted the org admin role over the whole org (slice 1 helper).
    const admin = await scope.person(browser);
    const page = await admin.newPage();
    const { userId } = await inviteAndSignIn(page, scope.pa, org.id, scope.handle('admin'), 'viewer', { type: 'org' });
    await grant(scope.pa, org.id, userId, 'admin', { type: 'org' });
    await openProjects(page, org);
    await expect(page.getByRole('heading', { level: 2, name: 'Get started' })).toBeVisible();
    await expectAllNotDone(page);
  });
});

test('TC-13.3: with a project on a connection, the first two rows are done and the last two are not', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const o = await ownerOrg(scope, browser);
    await addProject(o, await addConnection(o), REPO_P1);
    await openProjects(o.page, o.org);
    await expect(card(o.page)).toBeVisible(FIRST_HEADING);
    await expectFourRows(o.page);
    await expectDone(o.page, 'Connect a code host');
    await expectDone(o.page, 'Create a project');
    await expectNotDone(o.page, 'Add an agent');
    await expectNotDone(o.page, 'Add a rule');
  });
});

test('TC-14.1: adding a connection shows "Connect a code host" done after a reload, the rest not done', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const o = await ownerOrg(scope, browser);
    await openProjects(o.page, o.org);
    await expectAllNotDone(o.page);
    await addConnection(o);
    await openProjects(o.page, o.org);
    await expect(card(o.page)).toBeVisible(FIRST_HEADING);
    await expectFourRows(o.page);
    await expectDone(o.page, 'Connect a code host');
    await expectNotDone(o.page, 'Create a project');
    await expectNotDone(o.page, 'Add an agent');
    await expectNotDone(o.page, 'Add a rule');
  });
});

test('TC-14.2: creating a project shows "Create a project" done after a reload', async ({ browser }) => {
  await withScope(async (scope) => {
    const o = await ownerOrg(scope, browser);
    const connectionId = await addConnection(o);
    await openProjects(o.page, o.org);
    await expect(card(o.page)).toBeVisible(FIRST_HEADING);
    await expectNotDone(o.page, 'Create a project');
    await addProject(o, connectionId, REPO_P1);
    await openProjects(o.page, o.org);
    await expect(card(o.page)).toBeVisible(FIRST_HEADING);
    await expectFourRows(o.page);
    await expectDone(o.page, 'Create a project');
    await expectNotDone(o.page, 'Add an agent');
    await expectNotDone(o.page, 'Add a rule');
  });
});

test('TC-14.3: setting the agent credential shows "Add an agent" done after a reload', async ({ browser }) => {
  await withScope(async (scope) => {
    const o = await ownerOrg(scope, browser);
    const project = await addProject(o, await addConnection(o), REPO_P1);
    await openProjects(o.page, o.org);
    await expect(card(o.page)).toBeVisible(FIRST_HEADING);
    await expectNotDone(o.page, 'Add an agent');
    await addCredential(o, project.id);
    await openProjects(o.page, o.org);
    await expect(card(o.page)).toBeVisible(FIRST_HEADING);
    await expectFourRows(o.page);
    await expectDone(o.page, 'Add an agent');
    await expectNotDone(o.page, 'Add a rule');
  });
});

test('TC-14.4: adding a rule shows "Add a rule" done after a reload', async ({ browser }) => {
  await withScope(async (scope) => {
    const o = await ownerOrg(scope, browser);
    const project = await addProject(o, await addConnection(o), REPO_P1);
    await openProjects(o.page, o.org);
    await expect(card(o.page)).toBeVisible(FIRST_HEADING);
    await expectNotDone(o.page, 'Add a rule');
    await addRule(o, project.id);
    await openProjects(o.page, o.org);
    await expect(card(o.page)).toBeVisible(FIRST_HEADING);
    await expectFourRows(o.page);
    await expectDone(o.page, 'Add a rule');
    await expectNotDone(o.page, 'Add an agent');
  });
});

test('TC-16.1: one project with a connection, a credential and a rule shows no Get started card', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const o = await ownerOrg(scope, browser);
    const project = await addProject(o, await addConnection(o), REPO_P1);
    await addCredential(o, project.id);
    await addRule(o, project.id);
    await openProjects(o.page, o.org);
    await expectNoCard(o.page, [project.id], o.org);
  });
});

test('TC-16.2: two projects, one fully set up and one not, show no Get started card', async ({ browser }) => {
  await withScope(async (scope) => {
    const o = await ownerOrg(scope, browser);
    const connectionId = await addConnection(o);
    const p1 = await addProject(o, connectionId, REPO_P1);
    await addCredential(o, p1.id);
    await addRule(o, p1.id);
    const p2 = await addProject(o, connectionId, REPO_P2);
    await openProjects(o.page, o.org);
    await expectNoCard(o.page, [p1.id, p2.id], o.org);
  });
});

test('TC-16.3: no single project has all four steps, so the Get started card still shows', async ({ browser }) => {
  await withScope(async (scope) => {
    const o = await ownerOrg(scope, browser);
    const connectionId = await addConnection(o);
    const p1 = await addProject(o, connectionId, REPO_P1);
    await addCredential(o, p1.id);
    const p2 = await addProject(o, connectionId, REPO_P2);
    await addRule(o, p2.id);
    await openProjects(o.page, o.org);
    await expect(card(o.page)).toBeVisible(FIRST_HEADING);
    await expectFourRows(o.page);
  });
});
