import { randomBytes } from 'node:crypto';
import { ProjectDto, SetupScriptDto } from '@agentdesk/contracts';
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import {
  API,
  acceptViaApi,
  cancelRun,
  commentOnNewTicket,
  grant,
  inviteAndSignIn,
  inviteViaApi,
  ok,
  runHeader,
  runOf,
  signInAndCreateProject,
  touchPodFile,
} from './helpers';
import { buildCast, disposeCast, disposeSecondOrg, secondOrg, type Actor, type Cast } from './rbac-cast';

/*
 * Local end-to-end for the project menu, the project switcher and the run page header by role, on the real API (spec
 * "E2E requirements": BR-22 to BR-25, BR-29, BR-39, BR-41, BR-42, BR-48, BR-49, BR-51, BR-68, BR-82; the mock halves
 * are in e2e/mock/side-nav.spec.ts). The cast is the spec's: O owner, D admin on the org, A admin on P1, B member on P1
 * and P2, C member on P1, V viewer on the org, runs RB (B, P1), RC (C, P1) and RP2 (O, P2), all idle (they need a
 * person). Two more people are made for the cross-project and cross-org cases: M (admin of P1, member of P2) and X
 * (admin of the org, member of org Y). One cast, one second org Y and these people serve every case of a worker, built
 * in `beforeAll` and disposed in `afterAll`. Only TC-68.1 writes (the setup scripts of P1 and P2). TC-25.3 needs a
 * project with no run that needs a person, so it makes its own owner and project.
 */

test.describe.configure({ timeout: 300_000 });

const FIRST = { timeout: 30_000 };
const CONFIGURE = ['Routing rules', 'Skills', 'Workspace setup', 'Agent & settings'];
const ACCESS = ['Members', 'Audit log'];
const FULL = ['All projects', 'Runs', ...CONFIGURE, ...ACCESS, 'Open repository'];
const RUNS_ONLY = ['All projects', 'Runs', 'Open repository'];
const RUN_ACTION = /^(Finish run|Finish|Stop session|Cancel run|Resume|Close session)$/;

let cast: Cast;
let castBuilt: Cast | undefined;
let second: Awaited<ReturnType<typeof secondOrg>> | undefined;
let secondNames: { org: string; project: string; repo: string };
let p1Names: { project: string; repo: string };
let p2Names: { project: string; repo: string };
/** M: admin of P1, member of P2. */
let mixed: Actor;
/** X: admin of the cast org and member of org Y. */
let crossOrg: Actor;
/** N: a member of the whole org (not scoped to projects), for the cases that say "an org member". */
let orgMember: Actor;
const extraContexts: BrowserContext[] = [];

async function newPerson(
  browser: Browser,
  handle: string,
  roleKey: 'admin' | 'member',
  scope: Parameters<typeof inviteAndSignIn>[5],
): Promise<Actor> {
  const ctx = await browser.newContext();
  extraContexts.push(ctx);
  const page = await ctx.newPage();
  const { userId } = await inviteAndSignIn(page, cast.pa, cast.orgId, handle, roleKey, scope);
  return { handle, userId, ctx, page, api: ctx.request };
}

test.beforeAll(async ({ browser, request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
  castBuilt = await buildCast(browser);
  cast = castBuilt;
  second = await secondOrg(browser, cast.pa);
  const y = ProjectDto.parse(await ok(await second.owner.api.get(`/api/projects/${second.project}`), 200, 'Y project'));
  secondNames = { org: `RBAC Y ${second.slug.replace('rbac-y-', '')}`, project: y.name, repo: y.repoPath };
  const p1 = ProjectDto.parse(await ok(await cast.o.api.get(`/api/projects/${cast.p1}`), 200, 'P1'));
  p1Names = { project: p1.name, repo: p1.repoPath };
  const p2 = ProjectDto.parse(await ok(await cast.o.api.get(`/api/projects/${cast.p2}`), 200, 'P2'));
  p2Names = { project: p2.name, repo: p2.repoPath };

  const tag = randomBytes(3).toString('hex');
  mixed = await newPerson(browser, `rbac-m-${tag}`, 'admin', { type: 'project', projectIds: [cast.p1] });
  await grant(cast.pa, cast.orgId, mixed.userId, 'member', { type: 'project', projectId: cast.p2 });

  orgMember = await newPerson(browser, `rbac-n-${tag}`, 'member', { type: 'org' });
  crossOrg = await newPerson(browser, `rbac-x-${tag}`, 'admin', { type: 'org' });
  const invitation = await inviteViaApi(cast.pa, second.orgId, `${crossOrg.handle}@dev.local`, 'member', {
    type: 'org',
  });
  await acceptViaApi(crossOrg.page, invitation.id);
});

test.afterAll(async () => {
  for (const ctx of extraContexts.splice(0)) await ctx.close().catch(() => null);
  if (second) await disposeSecondOrg(second);
  second = undefined;
  const done = castBuilt;
  castBuilt = undefined;
  if (done) await disposeCast(done);
});

const orgUrl = (path: string): string => `/o/${cast.slug}/${path}`;
const projectUrl = (project: string, path: string): string => `/o/${cast.slug}/p/${project}/${path}`;

const projectMenu = (page: Page): Locator => page.getByRole('navigation', { name: 'Project menu' });
const orgMenu = (page: Page): Locator => page.getByRole('navigation', { name: 'Organization menu' });
const current = (menu: Locator): Locator => menu.locator('[aria-current]');
const notFound = (page: Page): Locator => page.getByRole('main').getByRole('heading', { name: 'Page not found' });
const forbidden = (page: Page): Locator => page.getByText("You don't have access");
const runsHeading = (page: Page): Locator => page.getByRole('heading', { name: 'Runs', level: 1 });
const expandButton = (page: Page): Locator => page.getByRole('button', { name: 'Expand menu' });
const collapseButton = (page: Page): Locator => page.getByRole('button', { name: 'Collapse menu' });
const anyAction = (page: Page): Locator => page.getByRole('button', { name: RUN_ACTION });

/** The link texts of a menu, without the "needs you" count of the Runs item. */
async function menuLabels(menu: Locator): Promise<string[]> {
  return (await menu.getByRole('link').allTextContents()).map((t) => t.replace(/\d+ needs you$/, '').trim());
}

/** Nothing of `texts` is on the page: not in the visible text (bar, menu, crumbs, content) and not in the title. */
async function appearsNowhere(page: Page, ...texts: string[]): Promise<void> {
  for (const text of texts) {
    await expect(page.locator('body')).not.toContainText(text);
    expect(await page.title()).not.toContain(text);
  }
}

/** The address of a run page of the cast, read by its id. */
async function runPage(who: Actor, project: string, runId: string): Promise<string> {
  const run = await runOf(who.page, runId);
  return projectUrl(project, `runs/${run.number}`);
}

/** Sets every actor's page to 1440 wide: pages of `browser.newContext()` do not take the fixture viewport. */
async function wide(): Promise<void> {
  for (const who of [cast.o, cast.d, cast.a, cast.b, cast.c, cast.v, mixed, crossOrg, orgMember]) {
    await who.page.setViewportSize({ width: 1440, height: 900 });
  }
}

const switchButton = (page: Page): Locator => page.getByRole('button', { name: /^Switch project, currently/ });
const switcher = (page: Page): Locator => page.getByRole('dialog', { name: 'Projects' });

async function openSwitcher(page: Page): Promise<Locator> {
  await switchButton(page).click();
  await expect(switcher(page)).toBeVisible();
  return switcher(page);
}

/** The switcher's row of a project, found by its exact name ("demo" is a prefix of "demo-2"). */
const switcherRow = (menu: Locator, name: string): Locator =>
  menu.getByRole('link').filter({ has: menu.page().getByText(name, { exact: true }) });

async function switchTo(page: Page, name: string): Promise<void> {
  const menu = await openSwitcher(page);
  await switcherRow(menu, name).click();
}

const linkNames = async (menu: Locator): Promise<string[]> =>
  (await menu.getByRole('link').allInnerTexts()).map((t) => t.replace(/\s*\d+ needs you\s*$/, '').trim());

test.describe('BR-22: the project menu for owner, org admin and project admin', () => {
  test('TC-22.1: an owner, an org admin and the admin of P1 see the full project menu in order', async () => {
    for (const who of [cast.o, cast.d, cast.a]) {
      const page = who.page;
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(projectUrl(cast.p1, 'runs'));
      const menu = projectMenu(page);
      await expect(menu.getByRole('link', { name: 'Audit log' })).toBeVisible(FIRST);
      await expect.poll(() => menuLabels(menu), FIRST).toEqual(FULL);
      const text = await menu.innerText();
      const at = (needle: string): number => text.indexOf(needle);
      const order = ['Runs', 'Configure', 'Routing rules', 'Access', 'Members', 'Repository'].map(at);
      expect(order.every((i) => i >= 0)).toBe(true);
      expect([...order].sort((x, y) => x - y)).toEqual(order);
      await expect(menu.getByRole('region', { name: 'Repository' })).toBeVisible();
    }
  });

  test('TC-22.2: the admin of P1 opens each Configure and Access item, each with the same menu and that item current', async () => {
    const page = cast.a.page;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(projectUrl(cast.p1, 'runs'));
    const menu = projectMenu(page);
    await expect(menu.getByRole('link', { name: 'Audit log' })).toBeVisible(FIRST);
    for (const name of [...CONFIGURE, ...ACCESS]) {
      await menu.getByRole('link', { name, exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible(FIRST);
      await expect(menu.getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(current(menu)).toHaveCount(1);
      await expect.poll(() => menuLabels(menu), FIRST).toEqual(FULL);
    }
  });
});

test.describe('BR-23: the project menu for a member and a viewer', () => {
  test('TC-23.1: a member, then a viewer, see "All projects", Runs and the repository block only', async () => {
    for (const who of [orgMember, cast.v]) {
      const page = who.page;
      await page.goto(projectUrl(cast.p1, 'runs'));
      const menu = projectMenu(page);
      await expect(menu.getByRole('link', { name: /^Runs/ })).toBeVisible(FIRST);
      await expect(menu.getByRole('region', { name: 'Repository' })).toBeVisible();
      await expect.poll(() => menuLabels(menu), FIRST).toEqual(RUNS_ONLY);
      await expect(menu.getByText('Configure', { exact: true })).toHaveCount(0);
      await expect(menu.getByText('Access', { exact: true })).toHaveCount(0);
    }
  });

  test('TC-23.2: the same two on a run page, after "Expand menu", see the same menu and no empty group heading', async () => {
    for (const who of [cast.b, cast.v]) {
      const page = who.page;
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(await runPage(who, cast.p1, cast.rc));
      await expect(runHeader(page).getByRole('heading', { level: 1 })).toBeVisible(FIRST);
      await expandButton(page).click();
      const menu = projectMenu(page);
      await expect(menu.getByRole('link', { name: /^Runs/ })).toBeVisible();
      await expect(menu.getByRole('region', { name: 'Repository' })).toBeVisible();
      await expect.poll(() => menuLabels(menu), FIRST).toEqual(RUNS_ONLY);
      await expect(menu.getByText('Configure', { exact: true })).toHaveCount(0);
      await expect(menu.getByText('Access', { exact: true })).toHaveCount(0);
    }
  });
});

test.describe('BR-24: rights do not carry across projects or orgs', () => {
  test('TC-24.1: an admin of P1 and member of P2 sees Configure and Access on P1, and Runs and the repository only on P2 and its run page', async () => {
    const page = mixed.page;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(projectUrl(cast.p1, 'runs'));
    const menu = projectMenu(page);
    await expect(menu.getByRole('link', { name: 'Audit log' })).toBeVisible(FIRST);
    await expect.poll(() => menuLabels(menu), FIRST).toEqual(FULL);

    await page.goto(projectUrl(cast.p2, 'runs'));
    await expect(menu.getByRole('link', { name: /^Runs/ })).toBeVisible(FIRST);
    await expect.poll(() => menuLabels(menu), FIRST).toEqual(RUNS_ONLY);
    await expect(menu.getByText('Configure', { exact: true })).toHaveCount(0);
    await expect(menu.getByText('Access', { exact: true })).toHaveCount(0);

    await page.goto(await runPage(mixed, cast.p2, cast.rp2));
    await expect(runHeader(page).getByRole('heading', { level: 1 })).toBeVisible(FIRST);
    await expandButton(page).click();
    await expect.poll(() => menuLabels(menu), FIRST).toEqual(RUNS_ONLY);
    await expect(menu.getByText('Configure', { exact: true })).toHaveCount(0);
    await expect(menu.getByText('Access', { exact: true })).toHaveCount(0);
  });

  test("TC-24.2: an admin of the org who is a member of org Y sees only Projects in Y's org menu and no Configure or Access in its project", async () => {
    const page = crossOrg.page;
    const y = second;
    if (!y) throw new Error('the second org is not built');

    await page.goto(orgUrl('projects'));
    await expect(orgMenu(page).getByRole('link')).toHaveText(
      ['Projects', 'Members', 'Invitations', 'Audit log', 'General'],
      FIRST,
    );

    await page.getByRole('button', { name: /^Switch scope/ }).click();
    const scope = page.getByRole('dialog', { name: 'Scope' });
    await expect(scope).toBeVisible(FIRST);
    await scope
      .getByRole('group', { name: 'Switch organization' })
      .getByRole('link', { name: new RegExp(secondNames.org) })
      .click();
    await expect(page).toHaveURL(new RegExp(`/o/${y.slug}/projects`), FIRST);
    await expect(orgMenu(page).getByRole('link')).toHaveText(['Projects'], FIRST);
    await page.getByRole('link', { name: secondNames.project, exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`/o/${y.slug}/p/${y.project}/runs`), FIRST);
    const menu = projectMenu(page);
    await expect(menu.getByRole('link', { name: /^Runs/ })).toBeVisible(FIRST);
    await expect.poll(() => menuLabels(menu), FIRST).toEqual(RUNS_ONLY);
    await expect(menu.getByText('Configure', { exact: true })).toHaveCount(0);
    await expect(menu.getByText('Access', { exact: true })).toHaveCount(0);
  });
});

test.describe('BR-25: the "needs you" badge on Runs', () => {
  test('TC-25.3: the badge appears when the live run starts waiting and clears when it ends, with no reload', async ({
    page,
  }) => {
    // A new owner and project, so nothing else needs a person there. The run holds before its session starts.
    const { handle, projectId } = await signInAndCreateProject(page);
    const runId = await commentOnNewTicket(page, handle, projectId, '/code-review --fake-hold-start');
    try {
      await page.goto(`/o/${handle}/p/${projectId}/runs`);
      const runsItem = projectMenu(page).getByRole('link', { name: /^Runs/ });
      await expect(runsItem).toBeVisible(FIRST);
      await expect.poll(async () => (await runOf(page, runId)).status, FIRST).toMatch(/^(starting|running)$/);
      await expect(runsItem).not.toContainText('needs you');
      await page.evaluate(() => Reflect.set(window, '__noReload', true));

      // The run starts waiting for a person (its first turn ends and it is idle).
      await touchPodFile(runId, 'release-start');
      await expect(runsItem).toContainText('1 needs you', { timeout: 60_000 });

      // The wait is resolved (the run is cancelled): the badge goes away.
      await cancelRun(page, runId);
      await expect(runsItem).not.toContainText('needs you', { timeout: 60_000 });
      await expect(runsItem).not.toContainText(/\b0\b/);
      expect(await page.evaluate(() => Reflect.get(window, '__noReload'))).toBe(true);
    } finally {
      await page.request.post(`/api/runs/${runId}/cancel`).catch(() => null);
    }
  });
});

test.describe('BR-29: the bare project URL', () => {
  test('TC-29.1: a viewer with access to P1 opening its bare address lands on its Runs page', async () => {
    const page = cast.v.page;
    await page.goto(`/o/${cast.slug}/p/${cast.p1}`);
    await expect(page).toHaveURL(new RegExp(`/o/${cast.slug}/p/${cast.p1}/runs$`), FIRST);
    await expect(runsHeading(page)).toBeVisible(FIRST);
  });

  test('TC-29.2: an admin of P1 only opening the bare address of P2 sees "Page not found" that does not name P2', async () => {
    const page = cast.a.page;
    await page.goto(`/o/${cast.slug}/p/${cast.p2}`);
    await expect(notFound(page)).toBeVisible(FIRST);
    await appearsNowhere(page, p2Names.project, p2Names.repo);
  });

  test('TC-29.4: a user of org A opening org Y\'s project under A\'s slug sees "Page not found" that does not name it', async () => {
    const page = cast.b.page;
    const y = second;
    if (!y) throw new Error('the second org is not built');
    await page.goto(`/o/${cast.slug}/p/${y.project}`);
    await expect(notFound(page)).toBeVisible(FIRST);
    await appearsNowhere(page, secondNames.org, secondNames.project, secondNames.repo);
  });
});

test.describe('BR-39: collapse and expand on a live run', () => {
  test('TC-39.4: expanding then collapsing the menu keeps one terminal socket, its output and no reconnect', async () => {
    const page = cast.o.page;
    await page.setViewportSize({ width: 1440, height: 900 });
    const sockets: string[] = [];
    const onSocket = (ws: { url(): string }): void => {
      if (ws.url().includes(`/api/runs/${cast.rp2}/terminal`)) sockets.push(ws.url());
    };
    page.on('websocket', onSocket);
    try {
      await page.goto(await runPage(cast.o, cast.p2, cast.rp2));
      const terminal = page.getByRole('group', { name: 'Claude Code terminal' });
      await expect(terminal).toContainText('Fake Claude Code', { timeout: 30_000 });
      await expect.poll(() => sockets.length, FIRST).toBe(1);
      await terminal.evaluate((el) => el.setAttribute('data-keep', 'same'));
      const trouble = page.getByText(/Connecting|Reconnecting|Connection to the terminal lost/);

      await expandButton(page).click();
      await expect(collapseButton(page)).toBeVisible();
      await expect(trouble).toHaveCount(0);
      await collapseButton(page).click();
      await expect(expandButton(page)).toBeVisible();
      await expect(trouble).toHaveCount(0);

      await expect(terminal).toHaveAttribute('data-keep', 'same');
      await expect(terminal).toContainText('Fake Claude Code');
      expect(sockets, 'one terminal WebSocket through expand and collapse').toHaveLength(1);
    } finally {
      page.off('websocket', onSocket);
    }
  });
});

test.describe('BR-41: the run page header', () => {
  test.beforeEach(wide);

  test('TC-41.1: the page header holds Run N, status, command, ticket, elapsed time and the actions; the top bar none of them', async () => {
    const page = cast.o.page;
    const run = await runOf(page, cast.rp2);
    await page.goto(projectUrl(cast.p2, `runs/${run.number}`));
    const header = runHeader(page);
    await expect(header.getByRole('heading', { level: 1, name: `Run ${run.number}` })).toBeVisible(FIRST);
    await expect(header.getByText('Needs you', { exact: true })).toBeVisible();
    await expect(header.getByText(/^\/?rbac-run$/)).toBeVisible();
    await expect(header.getByText(/issue #\d+|PR #\d+/i)).toBeVisible();
    await expect(header.getByText(/\d+:\d{2}/)).toBeVisible();
    await expect(header.getByRole('button', { name: 'Stop session' })).toBeVisible();
    await expect(header.getByRole('button', { name: 'Cancel run' })).toBeVisible();

    const bar = page.getByRole('banner');
    const crumbs = bar.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumbs.getByRole('link', { name: 'Runs', exact: true })).toHaveAttribute(
      'href',
      projectUrl(cast.p2, 'runs'),
    );
    await expect(crumbs.getByText(`Run ${run.number}`)).toHaveAttribute('aria-current', 'page');
    await expect(bar.getByRole('link', { name: /Agent Desk/ })).toBeVisible();
    await expect(bar.getByRole('button', { name: /^Switch project, currently/ })).toBeVisible();
    await expect(bar.getByRole('button', { name: /^Notifications/ })).toBeVisible();
    await expect(bar.getByRole('button', { name: /^Account menu for / })).toBeVisible();
    await expect(bar.getByText('Needs you', { exact: true })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: RUN_ACTION })).toHaveCount(0);
  });
});

test.describe('BR-42: run actions by permission', () => {
  test.beforeEach(wide);

  test('TC-42.1: a viewer sees status and ticket in the header and no run action anywhere on a live run', async () => {
    const page = cast.v.page;
    await page.goto(await runPage(cast.v, cast.p1, cast.rb));
    const header = runHeader(page);
    await expect(header.getByText('Needs you', { exact: true })).toBeVisible(FIRST);
    await expect(header.getByText(/issue #\d+|PR #\d+/i)).toBeVisible();
    await expect(anyAction(page)).toHaveCount(0);
  });

  test("TC-42.2: a member sees no run action on someone else's live run", async () => {
    const page = cast.b.page;
    await page.goto(await runPage(cast.b, cast.p1, cast.rc));
    await expect(runHeader(page).getByText('Needs you', { exact: true })).toBeVisible(FIRST);
    await expect(anyAction(page)).toHaveCount(0);
  });

  test('TC-42.3: a member sees the allowed actions in the header on their own live run', async () => {
    const page = cast.b.page;
    await page.goto(await runPage(cast.b, cast.p1, cast.rb));
    const header = runHeader(page);
    await expect(header.getByRole('button', { name: 'Stop session' })).toBeVisible(FIRST);
    await expect(header.getByRole('button', { name: 'Cancel run' })).toBeVisible();
  });

  test("TC-42.4: an org admin sees the allowed actions on someone else's live run", async () => {
    const page = cast.d.page;
    await page.goto(await runPage(cast.d, cast.p1, cast.rb));
    const header = runHeader(page);
    await expect(header.getByRole('button', { name: 'Stop session' })).toBeVisible(FIRST);
    await expect(header.getByRole('button', { name: 'Cancel run' })).toBeVisible();
  });
});

test.describe('The project switcher', () => {
  test.beforeEach(wide);

  test('TC-48.1: the title, the projects with the current one checked, their "needs you" counts and "All projects"', async () => {
    const page = cast.o.page;
    const counts = async (id: string): Promise<number> =>
      ProjectDto.parse(await ok(await cast.o.api.get(`/api/projects/${id}`), 200, 'project')).counts.needsYou;
    const p1Count = await counts(cast.p1);
    expect(p1Count, 'RB and RC are idle in P1').toBeGreaterThan(0);

    await page.goto(projectUrl(cast.p1, 'runs'));
    const menu = await openSwitcher(page);
    await expect(menu.getByText('Switch project', { exact: true })).toBeVisible();
    await expect(switcherRow(menu, p1Names.project)).toHaveAttribute('aria-current', /.+/);
    await expect(switcherRow(menu, p2Names.project)).not.toHaveAttribute('aria-current', /.+/);
    await expect(switcherRow(menu, p1Names.project)).toContainText(`${p1Count} needs you`);
    await expect(switcherRow(menu, p2Names.project)).toContainText(`${await counts(cast.p2)} needs you`);
    await expect(menu.getByRole('link', { name: 'All projects' })).toBeVisible();
  });

  test('TC-48.2: an admin of P1 only sees only P1, and no other project, org or count', async () => {
    const page = cast.a.page;
    const y = second;
    if (!y) throw new Error('the second org is not built');
    await page.goto(projectUrl(cast.p1, 'runs'));
    const menu = await openSwitcher(page);
    await expect.poll(() => linkNames(menu), FIRST).toEqual([p1Names.project, 'All projects']);
    for (const hidden of [p2Names.project, secondNames.project, secondNames.org]) {
      if (hidden !== p1Names.project) await expect(menu.getByText(hidden, { exact: true })).toHaveCount(0);
    }
  });

  test('TC-49.1: an org owner, then an org admin, see "New project" and it opens the wizard', async () => {
    for (const who of [cast.o, cast.d]) {
      const page = who.page;
      await page.goto(projectUrl(cast.p1, 'runs'));
      const menu = await openSwitcher(page);
      await menu.getByRole('link', { name: 'New project' }).click();
      await expect(page).toHaveURL(new RegExp(`/o/${cast.slug}/projects/new/`), FIRST);
    }
  });

  test('TC-49.2: a member, a viewer and an admin of P1 only see the list and "All projects" but no "New project"', async () => {
    for (const who of [orgMember, cast.v, cast.a]) {
      const page = who.page;
      await page.goto(projectUrl(cast.p1, 'runs'));
      const menu = await openSwitcher(page);
      await expect(switcherRow(menu, p1Names.project)).toBeVisible(FIRST);
      await expect(menu.getByRole('link', { name: 'All projects' })).toBeVisible();
      await expect(menu.getByRole('link', { name: 'New project' })).toHaveCount(0);
    }
  });

  test("TC-51.1: from P1's Skills with a skill in the address, P2's Skills opens with none of P1's query", async () => {
    const page = cast.o.page;
    await page.goto(`${projectUrl(cast.p1, 'desk/skills')}?skill=code-review`);
    await expect(page.getByRole('heading', { name: 'Skills', level: 1 })).toBeVisible(FIRST);
    await switchTo(page, p2Names.project);
    await expect(page).toHaveURL(new RegExp(`/o/${cast.slug}/p/${cast.p2}/desk/skills$`), FIRST);
    await expect(page.getByRole('heading', { name: 'Skills', level: 1 })).toBeVisible(FIRST);
  });

  test("TC-51.2: an admin of P1 and member of P2 on P1's Routing rules lands on P2's Runs, with no forbidden state", async () => {
    const page = mixed.page;
    await page.goto(projectUrl(cast.p1, 'desk/rules'));
    await expect(page.getByRole('heading', { name: 'Routing rules', level: 1 })).toBeVisible(FIRST);
    await switchTo(page, p2Names.project);
    await expect(page).toHaveURL(new RegExp(`/o/${cast.slug}/p/${cast.p2}/runs$`), FIRST);
    await expect(runsHeading(page)).toBeVisible(FIRST);
    await expect(forbidden(page)).toHaveCount(0);
  });

  test("TC-51.5: from GitHub connection, Limits and Danger zone, P2's Agent & settings opens on the Agents tab with no tab in the address", async () => {
    const page = cast.o.page;
    await page.goto(projectUrl(cast.p1, 'desk/agent'));
    for (const tab of ['GitHub connection', 'Limits', 'Danger zone']) {
      await page
        .getByRole('tablist', { name: 'Agent and project settings' })
        .getByRole('tab', { name: tab, exact: true })
        .click();
      await expect(page).toHaveURL(/tab=/, FIRST);
      await switchTo(page, p2Names.project);
      await expect(page).toHaveURL(new RegExp(`/o/${cast.slug}/p/${cast.p2}/desk/agent$`), FIRST);
      await expect(page.getByRole('tab', { name: 'Agents', exact: true })).toHaveAttribute('aria-selected', 'true');
      await switchTo(page, p1Names.project);
      await expect(page).toHaveURL(new RegExp(`/o/${cast.slug}/p/${cast.p1}/desk/agent$`), FIRST);
    }
  });

  test("TC-51.7: an admin of P1 and member of P2 on a tab of P1's Agent & settings lands on P2's Runs, with no forbidden state", async () => {
    const page = mixed.page;
    await page.goto(`${projectUrl(cast.p1, 'desk/agent')}?tab=limits`);
    await expect(page.getByRole('tab', { name: 'Limits', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
      FIRST,
    );
    await switchTo(page, p2Names.project);
    await expect(page).toHaveURL(new RegExp(`/o/${cast.slug}/p/${cast.p2}/runs$`), FIRST);
    await expect(runsHeading(page)).toBeVisible(FIRST);
    await expect(forbidden(page)).toHaveCount(0);
  });

  test('TC-68.1: an unsaved setup line typed on P1 does not show on P2, which shows only its own saved script', async () => {
    const p1Script = `#!/usr/bin/env bash\necho setup-p1-${randomBytes(3).toString('hex')}\n`;
    const p2Script = `#!/usr/bin/env bash\necho setup-p2-${randomBytes(3).toString('hex')}\n`;
    const marker = `P1-UNSAVED-${randomBytes(3).toString('hex')}`;
    for (const [project, body] of [
      [cast.p1, p1Script],
      [cast.p2, p2Script],
    ] as const) {
      const before = SetupScriptDto.nullable().parse(
        await ok(await cast.o.api.get(`/api/projects/${project}/setup-script`), 200, 'setupScript.get'),
      );
      await ok(
        await cast.o.api.put(`/api/projects/${project}/setup-script`, {
          data: { body, baseVersion: before?.version ?? null },
        }),
        200,
        'setupScript.put',
      );
    }

    const page = cast.o.page;
    let asked = 0;
    const onDialog = (): void => {
      asked += 1;
    };
    page.on('dialog', onDialog);
    try {
      await page.goto(projectUrl(cast.p1, 'desk/setup'));
      const editor = page.getByRole('textbox', { name: 'Setup script' });
      await expect(editor).toHaveValue(p1Script, FIRST);
      await editor.click();
      await page.keyboard.press('Control+End');
      await page.keyboard.type(`\n${marker}`);
      await expect(editor).toHaveValue(`${p1Script}\n${marker}`);

      await switchTo(page, p2Names.project);
      await expect(page).toHaveURL(new RegExp(`/o/${cast.slug}/p/${cast.p2}/desk/setup`), FIRST);
      await expect(editor).toHaveValue(p2Script, FIRST);
      await expect(page.getByText(marker)).toHaveCount(0);
      await expect(page.getByText('Unsaved changes')).toHaveCount(0);

      await switchTo(page, p1Names.project);
      await expect(editor).toHaveValue(p1Script, FIRST);
      await expect(page.getByText('Unsaved changes')).toHaveCount(0);
      expect(asked, 'no confirm was asked').toBe(0);
    } finally {
      page.off('dialog', onDialog);
    }
  });
});

test.describe('BR-82: the bare /desk URL', () => {
  test('TC-82.1: a member and a viewer opening /desk land on Runs with no forbidden state', async () => {
    for (const who of [cast.b, cast.v]) {
      const page = who.page;
      // A watcher on the document, installed before the page loads: it records whether the forbidden text ever showed,
      // on the way to Runs as well as after it.
      await page.addInitScript(() => {
        const mark = (): void => {
          if (document.body?.innerText.includes("You don't have access")) Reflect.set(window, '__sawForbidden', true);
        };
        new MutationObserver(mark).observe(document, { subtree: true, childList: true, characterData: true });
      });
      await page.goto(projectUrl(cast.p1, 'desk'));
      await expect(page).toHaveURL(new RegExp(`/o/${cast.slug}/p/${cast.p1}/runs$`), FIRST);
      await expect(runsHeading(page)).toBeVisible(FIRST);
      await expect(forbidden(page)).toHaveCount(0);
      expect(await page.evaluate(() => Reflect.get(window, '__sawForbidden') === true)).toBe(false);
    }
  });

  test('TC-82.3: an admin of P1 only opening P2\'s /desk sees "Page not found", not naming P2, with the org menu', async () => {
    const page = cast.a.page;
    await page.goto(projectUrl(cast.p2, 'desk'));
    await expect(notFound(page)).toBeVisible(FIRST);
    await appearsNowhere(page, p2Names.project, p2Names.repo);
    await expect(orgMenu(page)).toBeVisible();
    await expect(projectMenu(page)).toHaveCount(0);
  });

  test("TC-82.4: a user of org A opening org Y's project /desk under Y's slug and under A's slug sees \"Page not found\", not naming it", async () => {
    const page = cast.b.page;
    const y = second;
    if (!y) throw new Error('the second org is not built');
    for (const slug of [y.slug, cast.slug]) {
      await page.goto(`/o/${slug}/p/${y.project}/desk`);
      await expect(notFound(page)).toBeVisible(FIRST);
      await appearsNowhere(page, secondNames.org, secondNames.project, secondNames.repo);
    }
  });
});
