import { expect, test, type Browser, type Page } from '@playwright/test';
import { PlatformRoleDto, ProjectDto } from '@agentdesk/contracts';
import { z } from 'zod';
import { API, acceptViaApi, inviteAndSignIn, inviteViaApi, ok, signInAs } from './helpers';
import { REPO_P1, REPO_P2, installFake } from './rbac-cast';
import { withScope, type Org, type Scope } from './onboarding-scope';

/*
 * Local end-to-end for org onboarding: the refused sign-in, the welcome page and the invitations notice (spec "E2E
 * requirements": BR-1, BR-2, BR-3, BR-41, BR-45). A dev-login handle `h` signs in as the verified email `h@dev.local`,
 * which is the address an invitation names.
 *
 * Every case makes its own handles and orgs with a random tag (users and orgs cannot be deleted, so nothing is reused),
 * one browser context per person, and closes every context it opened. Invitations are made through the platform route
 * (the platform admin's request context), which is what an owner's invitation looks like to the invitee.
 */

test.describe.configure({ timeout: 180_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

/** `/auth/get-session` as the browser context sees it: the parsed body (null when there is no session). */
async function sessionOf(page: Page): Promise<unknown> {
  const res = await page.request.get('/auth/get-session');
  expect(res.status(), 'get-session status').toBe(200);
  return res.json();
}

const orgSwitchButton = (page: Page) => page.getByRole('button', { name: /^Switch organization/ });
const cardOf = (page: Page, org: Org) => page.getByRole('listitem').filter({ hasText: `${org.name} invited you as` });

/** Opens the org switcher and returns the names of the orgs it lists. */
async function switcherOrgs(page: Page): Promise<string[]> {
  await orgSwitchButton(page).click();
  const menu = page.getByRole('dialog', { name: 'Organizations' });
  await expect(menu).toBeVisible();
  return (await menu.getByRole('group', { name: 'Switch organization' }).getByRole('link').allInnerTexts()).map((t) =>
    t.trim(),
  );
}

test('TC-1.1: a person with no account and no invitation is sent back to sign-in with the no-invitation banner and no session', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const context = await scope.person(browser);
    const page = await context.newPage();
    await page.goto(`/auth/dev-login?handle=${scope.handle('x')}`);
    await expect(page).toHaveURL(/\/sign-in\?error=no_invitation$/);
    await expect(page.getByText('No invitation found for your email')).toBeVisible();
    await expect(
      page.getByText('Ask an owner or admin of your organization to invite you, then sign in again.'),
    ).toBeVisible();
    expect(await sessionOf(page)).toBeNull();
  });
});

test('TC-1.2: the same refused person is refused again and still has no session', async ({ browser }) => {
  await withScope(async (scope) => {
    const context = await scope.person(browser);
    const page = await context.newPage();
    const handle = scope.handle('x');
    await page.goto(`/auth/dev-login?handle=${handle}`);
    await expect(page).toHaveURL(/\/sign-in\?error=no_invitation$/);
    expect(await sessionOf(page)).toBeNull();

    await page.goto(`/auth/dev-login?handle=${handle}`);
    await expect(page).toHaveURL(/\/sign-in\?error=no_invitation$/);
    await expect(page.getByText('No invitation found for your email')).toBeVisible();
    await expect(
      page.getByText('Ask an owner or admin of your organization to invite you, then sign in again.'),
    ).toBeVisible();
    expect(await sessionOf(page)).toBeNull();
  });
});

/** Org O with an owner, two projects P1 and P2 (project scope names), and a pending member invitation to `invitee`. */
async function orgWithProjectInvitation(
  scope: Scope,
  browser: Browser,
): Promise<{ org: Org; invitationId: string; projectNames: string[]; roleName: string }> {
  const org = await scope.org('o');
  const ownerContext = await scope.person(browser);
  const ownerPage = await ownerContext.newPage();
  await inviteAndSignIn(ownerPage, scope.pa, org.id, scope.handle('owner'), 'owner', { type: 'org' });
  const connectionId = await installFake({ api: ownerContext.request });
  const projects: ProjectDto[] = [];
  for (const repoPath of [REPO_P1, REPO_P2]) {
    projects.push(
      ProjectDto.parse(
        await ok(
          await ownerContext.request.post('/api/projects', {
            data: { connectionId, repoPath, triggerMode: 'webhook' },
          }),
          201,
          `create project ${repoPath}`,
        ),
      ),
    );
  }
  const invitation = await inviteViaApi(scope.pa, org.id, scope.email('invitee'), 'member', {
    type: 'project',
    projectIds: projects.map((p) => p.id),
  });
  const roles = z
    .array(PlatformRoleDto)
    .parse(await ok(await scope.pa.get(`/api/platform/orgs/${org.id}/roles`), 200, 'platform roles'));
  const roleName = roles.find((r) => r.key === 'member')?.name;
  expect(roleName, 'the org has a member role with a name').toBeTruthy();
  return { org, invitationId: invitation.id, projectNames: projects.map((p) => p.name), roleName: roleName ?? '' };
}

test('TC-2.1: an invited new person lands on the welcome page with the invitation card, Accept and Decline', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const { org, projectNames, roleName } = await orgWithProjectInvitation(scope, browser);
    const context = await scope.person(browser);
    const page = await signInAs(context, scope.handle('invitee'));

    await expect(page).toHaveURL(/\/invitations$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Invitations' })).toBeVisible();
    const card = cardOf(page, org);
    await expect(card).toHaveCount(1);
    await expect(card.getByRole('heading', { level: 2 })).toHaveText(`${org.name} invited you as ${roleName}`);
    // The access line names exactly P1 and P2.
    const access = (await card.locator('span').allInnerTexts()).find((t) => projectNames.some((n) => t.includes(n)));
    expect(access, 'the card has an access line naming the projects').toBeTruthy();
    expect((access ?? '').split(', ').sort()).toEqual([...projectNames].sort());
    await expect(card.getByRole('button', { name: 'Accept' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Decline' })).toBeVisible();
  });
});

test('TC-2.2: signing in with the invitation link as the redirect opens the accept page', async ({ browser }) => {
  await withScope(async (scope) => {
    const { org, invitationId } = await orgWithProjectInvitation(scope, browser);
    const context = await scope.person(browser);
    const page = await signInAs(context, scope.handle('invitee'), `/invitations/${invitationId}`);

    await expect(page).toHaveURL(new RegExp(`/invitations/${invitationId}$`));
    await expect(page.getByRole('heading', { level: 1, name: `Join ${org.name}` })).toBeVisible();
    for (const term of ['Role', 'Access', 'Invited by', 'Expires']) {
      await expect(page.getByText(term, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Accept' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Decline' })).toBeVisible();
  });
});

test('TC-2.3: an invitee who has not accepted gets not found on the org and is offered no org', async ({ browser }) => {
  await withScope(async (scope) => {
    const { org } = await orgWithProjectInvitation(scope, browser);
    const context = await scope.person(browser);
    const page = await signInAs(context, scope.handle('invitee'));
    await expect(page.getByRole('heading', { level: 1, name: 'Invitations' })).toBeVisible();

    await page.goto(`/o/${org.slug}/projects`);
    await expect(page.getByText('Page not found')).toBeVisible();
    await expect(orgSwitchButton(page)).toHaveCount(0);
    await expect(page.getByText(org.name)).toHaveCount(0);
  });
});

/**
 * U (a member of orgs A and D, A the oldest) with pending invitations from orgs B and C; U's context is signed in
 * again (a new session) and its page is parked on the dev-login redirect target.
 */
async function memberWithTwoPending(
  scope: Scope,
  browser: Browser,
): Promise<{ page: Page; handle: string; a: Org; b: Org; c: Org; d: Org }> {
  const a = await scope.org('a');
  const d = await scope.org('d');
  const b = await scope.org('b');
  const c = await scope.org('c');
  const handle = scope.handle('u');
  const context = await scope.person(browser);
  const page = await context.newPage();
  await inviteAndSignIn(page, scope.pa, a.id, handle, 'member', { type: 'org' });
  const toD = await inviteViaApi(scope.pa, d.id, scope.email('u'), 'member', { type: 'org' });
  await acceptViaApi(page, toD.id);
  await inviteViaApi(scope.pa, b.id, scope.email('u'), 'member', { type: 'org' });
  await inviteViaApi(scope.pa, c.id, scope.email('u'), 'member', { type: 'org' });
  await page.goto(`/auth/dev-login?handle=${handle}&redirect=${encodeURIComponent('/')}`);
  return { page, handle, a, b, c, d };
}

const acceptButtons = (page: Page) => page.getByRole('button', { name: 'Accept', exact: true });

test('TC-3.1: a member with two pending invitations sees the count on Projects and View opens the welcome page', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const { page, a, b, c } = await memberWithTwoPending(scope, browser);
    await expect(page).toHaveURL(new RegExp(`/o/${a.slug}/projects$`));
    await expect(page.getByText('You have 2 pending invitations.')).toBeVisible();

    await page.getByRole('link', { name: 'View' }).click();
    await expect(page).toHaveURL(/\/invitations$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Invitations' })).toBeVisible();
    await expect(acceptButtons(page)).toHaveCount(2);
    for (const org of [b, c]) {
      const card = cardOf(page, org);
      await expect(card).toHaveCount(1);
      await expect(card.getByRole('button', { name: 'Accept', exact: true })).toBeVisible();
      await expect(card.getByRole('button', { name: 'Decline', exact: true })).toBeVisible();
    }
  });
});

test('TC-3.2: the org switcher lists only the joined orgs and a pending org is not found', async ({ browser }) => {
  await withScope(async (scope) => {
    const { page, a, b, c, d } = await memberWithTwoPending(scope, browser);
    await expect(page).toHaveURL(new RegExp(`/o/${a.slug}/projects$`));

    const listed = await switcherOrgs(page);
    expect([...listed].sort()).toEqual([a.name, d.name].sort());
    expect(listed).not.toContain(b.name);
    expect(listed).not.toContain(c.name);

    await page.goto(`/o/${b.slug}/projects`);
    await expect(page.getByText('Page not found')).toBeVisible();
  });
});

test('TC-41.1: accepting one of two invitations lands on that org and leaves only the other pending', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const { page, b, c } = await memberWithTwoPending(scope, browser);
    await page.goto('/invitations');
    await expect(page.getByRole('heading', { level: 1, name: 'Invitations' })).toBeVisible();

    await cardOf(page, b).getByRole('button', { name: 'Accept', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${b.slug}/projects$`));
    expect(await switcherOrgs(page)).toContain(b.name);

    await page.goto('/invitations');
    await expect(page.getByRole('heading', { level: 1, name: 'Invitations' })).toBeVisible();
    await expect(cardOf(page, c)).toHaveCount(1);
    await expect(cardOf(page, b)).toHaveCount(0);
    await expect(acceptButtons(page)).toHaveCount(1);
    await expect(cardOf(page, c).getByRole('button', { name: 'Accept', exact: true })).toBeVisible();
    await expect(cardOf(page, c).getByRole('button', { name: 'Decline', exact: true })).toBeVisible();
    expect(await switcherOrgs(page)).not.toContain(c.name);
  });
});

/** A new person with pending invitations from orgs B and C and no org, signed in and on the welcome page. */
async function newcomerWithTwoPending(
  scope: Scope,
  browser: Browser,
): Promise<{ page: Page; handle: string; email: string; b: Org; c: Org }> {
  const b = await scope.org('b');
  const c = await scope.org('c');
  const handle = scope.handle('new');
  const email = scope.email('new');
  await inviteViaApi(scope.pa, b.id, email, 'member', { type: 'org' });
  await inviteViaApi(scope.pa, c.id, email, 'member', { type: 'org' });
  const context = await scope.person(browser);
  const page = await signInAs(context, handle);
  await page.goto('/invitations');
  await expect(page.getByRole('heading', { level: 1, name: 'Invitations' })).toBeVisible();
  return { page, handle, email, b, c };
}

async function declineViaDialog(page: Page, org: Org): Promise<void> {
  await cardOf(page, org).getByRole('button', { name: 'Decline', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Decline invitation to ${org.name}?` });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Decline', exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function expectNoOrgWelcome(page: Page, email: string, orgs: Org[]): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: "You're not a member of any organization" })).toBeVisible();
  await expect(page.getByText(`No invitations for ${email}. Ask an owner or admin to invite you.`)).toBeVisible();
  await expect(orgSwitchButton(page)).toHaveCount(0);
  for (const org of orgs) await expect(page.getByText(org.name)).toHaveCount(0);
}

test('TC-45.1: declining every invitation shows the no-organization welcome copy and no org in the top bar', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const { page, email, b, c } = await newcomerWithTwoPending(scope, browser);
    await declineViaDialog(page, b);
    await expect(cardOf(page, b)).toHaveCount(0);
    await declineViaDialog(page, c);
    await expectNoOrgWelcome(page, email, [b, c]);
  });
});

test('TC-45.2: after declining all, signing out and in again works and shows the same welcome page', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const { page, handle, email, b, c } = await newcomerWithTwoPending(scope, browser);
    await declineViaDialog(page, b);
    await declineViaDialog(page, c);
    await expectNoOrgWelcome(page, email, [b, c]);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    expect(await sessionOf(page)).toBeNull();

    await page.goto(`/auth/dev-login?handle=${handle}`);
    await expect(page).not.toHaveURL(/error=/);
    await expectNoOrgWelcome(page, email, [b, c]);
  });
});
