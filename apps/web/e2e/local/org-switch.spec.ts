import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ORG_HEADER, ProjectDto, RuleDto, pageOf } from '@agentdesk/contracts';
import { API, acceptViaApi, inviteAndSignIn, inviteViaApi, ok, signInAs } from './helpers';
import { REPO_P1, REPO_P2, installFake } from './rbac-cast';
import { withScope, type Org, type Scope } from './onboarding-scope';

/*
 * Local end-to-end for switching orgs, the landing org and the stale tab (spec "E2E requirements": BR-7, BR-8, BR-11,
 * BR-43). Every case makes its own handle and two orgs with a random tag, one browser context for the person (two pages
 * of it where a case says two tabs), and closes every context it opened.
 *
 * The person U joins org A first and org B second, as owner of both (an owner can open the rule editor, which BR-11
 * needs). Each org has one project on a different repo (different names) and one prompt rule with its own text.
 */

test.describe.configure({ timeout: 180_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

const FIRST_HEADING = { timeout: 30_000 };
const ORG_SWITCHED = 'This organization was switched in another tab. Try again.';

interface OrgSetup {
  org: Org;
  projectId: string;
  ruleId: string;
  command: string;
  prompt: string;
}

interface Person {
  handle: string;
  ctx: BrowserContext;
  /** The page left on `/` after the last sign-in (the oldest org's projects). */
  page: Page;
  a: OrgSetup;
  b: OrgSetup;
}

const projectsHeading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Projects' });
const projectLink = (page: Page, o: OrgSetup) => page.locator(`a[href="/o/${o.org.slug}/p/${o.projectId}/runs"]`);
const switchButton = (page: Page) => page.getByRole('button', { name: /^Switch organization/ });

/** A project on `repoPath` and one prompt rule in the org the signed-in `api` has active. */
async function projectWithRule(
  api: APIRequestContext,
  org: Org,
  repoPath: string,
  label: string,
  tag: string,
): Promise<OrgSetup> {
  const headers = { [ORG_HEADER]: org.id };
  const connectionId = await installFake({ api });
  const project = ProjectDto.parse(
    await ok(
      await api.post('/api/projects', { data: { connectionId, repoPath, triggerMode: 'webhook' }, headers }),
      201,
      `create project ${repoPath}`,
    ),
  );
  const command = `sw-${label}-${tag}`;
  const prompt = `Original ${label} ${tag}`;
  const rule = RuleDto.parse(
    await ok(
      await api.post(`/api/projects/${project.id}/rules`, {
        data: { command, labelFilter: [], target: 'any', enabled: true, kind: 'prompt', prompt },
        headers,
      }),
      201,
      'create rule',
    ),
  );
  return { org, projectId: project.id, ruleId: rule.id, command, prompt };
}

/** U is a member of A (joined first) and B, each with a different project; ends signed in on A's projects page. */
async function personInTwoOrgs(scope: Scope, browser: Browser): Promise<Person> {
  const a = await scope.org('a');
  const b = await scope.org('b');
  const handle = scope.handle('u');
  const ctx = await scope.person(browser);
  const page = await ctx.newPage();
  await inviteAndSignIn(page, scope.pa, a.id, handle, 'owner', { type: 'org' });
  const inA = await projectWithRule(ctx.request, a, REPO_P1, 'a', scope.tag);
  const second = await inviteViaApi(scope.pa, b.id, scope.email('u'), 'owner', { type: 'org' });
  await acceptViaApi(page, second.id);
  // Accepting does not change the session's active org: open B (the URL org becomes active) to create its project.
  await page.goto(`/o/${b.slug}/projects`);
  await expect(page.getByRole('button', { name: `Switch organization, currently ${b.name}` })).toBeVisible(
    FIRST_HEADING,
  );
  const inB = await projectWithRule(ctx.request, b, REPO_P2, 'b', scope.tag);
  // A new session starts in the oldest membership: org A.
  await page.goto(`/auth/dev-login?handle=${handle}&redirect=/`);
  await expect(page).toHaveURL(new RegExp(`/o/${a.slug}/projects$`));
  await expect(projectsHeading(page)).toBeVisible(FIRST_HEADING);
  await expect(projectLink(page, inA)).toBeVisible();
  return { handle, ctx, page, a: inA, b: inB };
}

/** The org's projects page shows its own project and none of the other org's. */
async function expectOnlyProjectsOf(page: Page, shown: OrgSetup, hidden: OrgSetup) {
  await expect(projectsHeading(page)).toBeVisible(FIRST_HEADING);
  await expect(projectLink(page, shown)).toBeVisible();
  await expect(projectLink(page, hidden)).toHaveCount(0);
}

/** Picks `org` in the open-able org switcher. */
async function pickOrg(page: Page, org: Org) {
  await switchButton(page).click();
  const menu = page.getByRole('dialog', { name: 'Organizations' });
  await expect(menu).toBeVisible();
  await menu.getByRole('link', { name: new RegExp(org.name) }).click();
}

/**
 * The prompt of the rule as the server holds it for `o`, read through a separate context of the person (its own
 * session), so reading B never changes which org the tabs under test have active.
 */
async function promptOf(scope: Scope, browser: Browser, handle: string, o: OrgSetup): Promise<string> {
  const reader = await scope.person(browser);
  const page = await signInAs(reader, handle, `/o/${o.org.slug}/projects`);
  await expect(page).toHaveURL(new RegExp(`/o/${o.org.slug}/projects$`));
  await expect(projectsHeading(page)).toBeVisible(FIRST_HEADING);
  const { items } = pageOf(RuleDto).parse(
    await ok(
      await reader.request.get(`/api/projects/${o.projectId}/rules?pageSize=100`, {
        headers: { [ORG_HEADER]: o.org.id },
      }),
      200,
      'rules',
    ),
  );
  const rule = items.find((r) => r.id === o.ruleId);
  expect(rule, `the rule ${o.ruleId} is listed`).toBeTruthy();
  const prompt = rule?.kind === 'prompt' ? rule.prompt : undefined;
  expect(prompt, 'the rule is a prompt rule').toBeTruthy();
  await page.close();
  return prompt ?? '';
}

// ---- BR-7 ----

test('TC-7.1: picking org B in the switcher opens B projects and A projects are gone', async ({ browser }) => {
  await withScope(async (scope) => {
    const u = await personInTwoOrgs(scope, browser);
    await pickOrg(u.page, u.b.org);
    await expect(u.page).toHaveURL(new RegExp(`/o/${u.b.org.slug}/projects$`));
    await expectOnlyProjectsOf(u.page, u.b, u.a);
  });
});

test('TC-7.2: after switching to B a reload stays on B projects', async ({ browser }) => {
  await withScope(async (scope) => {
    const u = await personInTwoOrgs(scope, browser);
    await pickOrg(u.page, u.b.org);
    await expect(u.page).toHaveURL(new RegExp(`/o/${u.b.org.slug}/projects$`));
    await expectOnlyProjectsOf(u.page, u.b, u.a);

    await u.page.reload();
    await expect(u.page).toHaveURL(new RegExp(`/o/${u.b.org.slug}/projects$`));
    await expectOnlyProjectsOf(u.page, u.b, u.a);
  });
});

// ---- BR-8 ----

test('TC-8.1: a signed-out deep link to B goes to sign-in with a redirect and signing in lands on B projects', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const u = await personInTwoOrgs(scope, browser);
    const path = `/o/${u.b.org.slug}/projects`;
    await u.ctx.clearCookies();
    await u.page.goto(path);
    await expect(u.page).toHaveURL(/\/sign-in\?/, FIRST_HEADING);
    const url = new URL(u.page.url());
    expect(url.pathname).toBe('/sign-in');
    expect(url.searchParams.get('redirect')).toBe(path);

    await u.page.goto(`/auth/dev-login?handle=${u.handle}&redirect=${encodeURIComponent(path)}`);
    await expect(u.page).toHaveURL(new RegExp(`${path}$`));
    await expectOnlyProjectsOf(u.page, u.b, u.a);
  });
});

// ---- BR-43 ----

test('TC-43.1: signing in without a link lands on the projects of the org joined first', async ({ browser }) => {
  await withScope(async (scope) => {
    const u = await personInTwoOrgs(scope, browser);
    await u.page.goto(`/o/${u.b.org.slug}/projects`);
    await expect(u.page).toHaveURL(new RegExp(`/o/${u.b.org.slug}/projects$`));
    await expectOnlyProjectsOf(u.page, u.b, u.a);

    // Sign out: the projects page has no sign-out control, so use the auth route the app itself uses.
    const out = await u.page.request.post('/auth/sign-out', {
      data: {},
      headers: { Origin: new URL(u.page.url()).origin },
    });
    expect(out.status(), 'sign-out status').toBe(200);
    const session = await u.page.request.get('/auth/get-session');
    expect(await session.json()).toBeNull();

    await u.page.goto(`/auth/dev-login?handle=${u.handle}&redirect=/`);
    await expect(u.page).toHaveURL(new RegExp(`/o/${u.a.org.slug}/projects$`));
    await expectOnlyProjectsOf(u.page, u.a, u.b);
  });
});

// ---- BR-11: two tabs of one context ----

/** Page B of the person's context: it starts on A's projects, then switches to B in the switcher and waits for B. */
async function switchInOtherTab(u: Person): Promise<Page> {
  const pageB = await u.ctx.newPage();
  await pageB.goto(`/o/${u.a.org.slug}/projects`);
  await expect(projectsHeading(pageB)).toBeVisible(FIRST_HEADING);
  await pickOrg(pageB, u.b.org);
  await expect(pageB).toHaveURL(new RegExp(`/o/${u.b.org.slug}/projects$`));
  await expectOnlyProjectsOf(pageB, u.b, u.a);
  return pageB;
}

/** Page A on its rules page with the rule open for editing (before the other tab switches). */
async function openRuleInA(page: Page, a: OrgSetup) {
  await page.goto(`/o/${a.org.slug}/p/${a.projectId}/desk/rules`);
  await expect(page.getByRole('heading', { level: 1, name: 'Routing rules' })).toBeVisible(FIRST_HEADING);
  await page.getByRole('button', { name: `Edit rule /${a.command}` }).click();
  await expect(page.getByRole('heading', { name: 'Edit rule' })).toBeVisible();
  await expect(page.getByLabel('Prompt', { exact: true })).toHaveValue(a.prompt);
}

test('TC-11.1: after another tab switched to B, page A reloads A data only and shows no error', async ({ browser }) => {
  await withScope(async (scope) => {
    const u = await personInTwoOrgs(scope, browser);
    const pageA = u.page;
    await switchInOtherTab(u);

    await pageA.reload();
    await expect(pageA).toHaveURL(new RegExp(`/o/${u.a.org.slug}/projects$`));
    await expectOnlyProjectsOf(pageA, u.a, u.b);
    await expect(pageA.getByRole('alert')).toHaveCount(0);
    await expect(pageA.getByText(ORG_SWITCHED)).toHaveCount(0);
    await expect(pageA.getByText('Something went wrong')).toHaveCount(0);
  });
});

test('TC-11.2: a rule save in the stale tab is refused once, keeps the input and changes nothing in A or B', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const u = await personInTwoOrgs(scope, browser);
    const pageA = u.page;
    await openRuleInA(pageA, u.a);
    await switchInOtherTab(u);

    const writes: string[] = [];
    pageA.on('request', (r) => {
      if (r.method() === 'PATCH' && new URL(r.url()).pathname === `/api/rules/${u.a.ruleId}`) writes.push(r.url());
    });
    const changed = `Changed in A ${scope.tag}`;
    const prompt = pageA.getByLabel('Prompt', { exact: true });
    await prompt.fill(changed);
    await pageA.getByRole('button', { name: 'Save rule' }).click();

    await expect(pageA.getByText(ORG_SWITCHED)).toBeVisible();
    await pageA.waitForLoadState('networkidle');
    expect(writes, 'write requests to the rule route').toHaveLength(1);
    await expect(prompt).toHaveValue(changed);
    await expect(pageA.getByRole('button', { name: 'Save rule' })).toBeEnabled();

    expect(await promptOf(scope, browser, u.handle, u.a)).toBe(u.a.prompt);
    expect(await promptOf(scope, browser, u.handle, u.b)).toBe(u.b.prompt);
    expect(writes, 'still one write request after the reads').toHaveLength(1);
  });
});

test('TC-11.3: saving again after the refusal applies the change to A only', async ({ browser }) => {
  await withScope(async (scope) => {
    const u = await personInTwoOrgs(scope, browser);
    const pageA = u.page;
    await openRuleInA(pageA, u.a);
    await switchInOtherTab(u);

    const changed = `Changed in A ${scope.tag}`;
    await pageA.getByLabel('Prompt', { exact: true }).fill(changed);
    await pageA.getByRole('button', { name: 'Save rule' }).click();
    await expect(pageA.getByText(ORG_SWITCHED)).toBeVisible();
    await expect(pageA.getByRole('button', { name: 'Save rule' })).toBeEnabled();
    await pageA.waitForLoadState('networkidle');

    const saved = pageA.waitForResponse(
      (r) => r.request().method() === 'PATCH' && new URL(r.url()).pathname === `/api/rules/${u.a.ruleId}`,
    );
    await pageA.getByRole('button', { name: 'Save rule' }).click();
    expect((await saved).status(), 'second save status').toBe(200);
    await expect(pageA.getByRole('heading', { name: 'Edit rule' })).toHaveCount(0);

    expect(await promptOf(scope, browser, u.handle, u.a)).toBe(changed);
    expect(await promptOf(scope, browser, u.handle, u.b)).toBe(u.b.prompt);
  });
});
