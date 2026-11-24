import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { InvitationDto, PlatformMemberDto, PlatformRoleDto, ProjectDto, pageOf } from '@agentdesk/contracts';
import { z } from 'zod';
import { API, acceptViaApi, inviteAndSignIn, inviteViaApi, ok, signInAs } from './helpers';
import { REPO_NEW, REPO_P1, REPO_P2, installFake } from './rbac-cast';
import { withScope, type Org, type Scope } from './onboarding-scope';

/*
 * Local end-to-end for the invitation link page (spec "E2E requirements": BR-5, BR-21, BR-22, BR-23, BR-24, BR-25,
 * BR-26, BR-42, BR-52). A dev-login handle `h` signs in as the verified email `h@dev.local`, which is the address an
 * invitation names.
 *
 * Every case makes its own handles and orgs with a random tag (users and orgs cannot be deleted, so nothing is
 * reused), one browser context per person, and closes every context it opened. The owner invites through the org's own
 * route as the signed-in owner, so the invitation's inviter is that owner (BR-25, BR-52).
 */

test.describe.configure({ timeout: 180_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

interface Setup {
  org: Org;
  owner: { context: BrowserContext; handle: string };
  projects: ProjectDto[];
  invitationId: string;
  invitee: string;
  inviteeEmail: string;
  roleName: string;
}

/**
 * Org O with an owner (handle `e2e-owner-<tag>`), three projects P1, P2, P3, and a pending member invitation sent by
 * that owner to a person with no account: on P1 and P2 (`scopeKind: 'projects'`) or on the whole org.
 */
async function orgWithInvitation(
  scope: Scope,
  browser: Browser,
  scopeKind: 'projects' | 'org' = 'projects',
): Promise<Setup> {
  const org = await scope.org('o');
  const context = await scope.person(browser);
  const ownerPage = await context.newPage();
  const handle = scope.handle('owner');
  await inviteAndSignIn(ownerPage, scope.pa, org.id, handle, 'owner', { type: 'org' });
  const connectionId = await installFake({ api: context.request });
  const projects: ProjectDto[] = [];
  for (const repoPath of [REPO_P1, REPO_P2, REPO_NEW]) {
    projects.push(
      ProjectDto.parse(
        await ok(
          await context.request.post('/api/projects', { data: { connectionId, repoPath, triggerMode: 'webhook' } }),
          201,
          `create project ${repoPath}`,
        ),
      ),
    );
  }
  const inviteeEmail = scope.email('invitee');
  const invitation = await inviteViaApi(
    context.request,
    org.id,
    inviteeEmail,
    'member',
    scopeKind === 'org' ? { type: 'org' } : { type: 'project', projectIds: projects.slice(0, 2).map((p) => p.id) },
    'tenant',
  );
  const roles = z
    .array(PlatformRoleDto)
    .parse(await ok(await scope.pa.get(`/api/platform/orgs/${org.id}/roles`), 200, 'platform roles'));
  const roleName = roles.find((r) => r.key === 'member')?.name;
  expect(roleName, 'the org has a member role with a name').toBeTruthy();
  await ownerPage.close();
  return {
    org,
    owner: { context, handle },
    projects,
    invitationId: invitation.id,
    invitee: scope.handle('invitee'),
    inviteeEmail,
    roleName: roleName ?? '',
  };
}

const linkOf = (id: string) => `/invitations/${id}`;
const mainButtons = (page: Page) => page.getByRole('main').getByRole('button');
const orgSwitchButton = (page: Page) => page.getByRole('button', { name: /^Switch scope/ });

/** The accept page for the invitee, signed in through dev-login with the link as the redirect. */
async function inviteeOnAcceptPage(
  scope: Scope,
  browser: Browser,
  s: Setup,
): Promise<{ page: Page; context: BrowserContext }> {
  const context = await scope.person(browser);
  const page = await signInAs(context, s.invitee, linkOf(s.invitationId));
  await expect(page.getByRole('heading', { level: 1, name: `Join ${s.org.name}` })).toBeVisible();
  return { page, context };
}

/** Another page of the same person open on the same accept page. */
async function secondPage(context: BrowserContext, s: Setup): Promise<Page> {
  const page = await context.newPage();
  await page.goto(linkOf(s.invitationId));
  await expect(page.getByRole('heading', { level: 1, name: `Join ${s.org.name}` })).toBeVisible();
  return page;
}

/** Presses Decline and confirms in the dialog. */
async function declineViaDialog(page: Page, orgName: string): Promise<void> {
  await page.getByRole('button', { name: 'Decline', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Decline invitation to ${orgName}?` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('You will need a new invitation to join later.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Decline', exact: true }).click();
}

/** The value next to a term of the accept page's details. */
const detail = (page: Page, term: string) =>
  page.getByText(term, { exact: true }).locator('xpath=following-sibling::dd[1]');

async function expectNoAnswerButtons(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Decline', exact: true })).toHaveCount(0);
}

async function expectNotFound(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByText('Page not found')).toBeVisible();
}

/** Every member of the org as the platform admin lists it. */
async function membersOf(scope: Scope, orgId: string): Promise<PlatformMemberDto[]> {
  const items: PlatformMemberDto[] = [];
  for (let n = 1; ; n++) {
    const body = pageOf(PlatformMemberDto).parse(
      await ok(
        await scope.pa.get(`/api/platform/orgs/${orgId}/members?pageSize=100&page=${n}`),
        200,
        'platform members',
      ),
    );
    items.push(...body.items);
    if (body.items.length === 0 || items.length >= body.total) return items;
  }
}

const membershipsOf = async (scope: Scope, orgId: string, email: string): Promise<number> =>
  (await membersOf(scope, orgId)).filter((m) => m.email === email).length;

/** The inviter revokes the invitation through the org's route (204). */
async function revokeAsOwner(s: Setup): Promise<void> {
  await ok(await s.owner.context.request.delete(`/api/orgs/${s.org.id}/invitations/${s.invitationId}`), 204, 'revoke');
}

async function switcherOrgs(page: Page): Promise<string[]> {
  await orgSwitchButton(page).click();
  const menu = page.getByRole('dialog', { name: 'Scope' });
  await expect(menu).toBeVisible();
  return (await menu.getByRole('group', { name: 'Switch organization' }).getByRole('link').allInnerTexts()).map((t) =>
    t.trim(),
  );
}

/** Y: a user with an account and a membership in a separate org, signed in on a fresh context. */
async function existingUser(
  scope: Scope,
  browser: Browser,
  who: string,
): Promise<{ page: Page; org: Org; email: string }> {
  const org = await scope.org(`y${who}`);
  const page = await (await scope.person(browser)).newPage();
  await inviteAndSignIn(page, scope.pa, org.id, scope.handle(who), 'member', { type: 'org' });
  return { page, org, email: scope.email(who) };
}

test('TC-5.1: a signed-in person with another email sees "not available" and no org name, role or invited email', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const s = await orgWithInvitation(scope, browser);
    const y = await existingUser(scope, browser, 'y');
    await y.page.goto(linkOf(s.invitationId));

    await expect(y.page.getByRole('heading', { level: 1, name: 'This invitation is not available' })).toBeVisible();
    await expect(
      y.page.getByText(
        'Check that you signed in with the email it was sent to, or ask the person who invited you for a new link.',
      ),
    ).toBeVisible();
    await expect(y.page.getByText(`Signed in as ${y.email}`)).toBeVisible();
    await expect(y.page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    const body = y.page.getByRole('main');
    await expect(body).not.toContainText(s.org.name);
    await expect(body).not.toContainText(s.roleName);
    await expect(body).not.toContainText(s.inviteeEmail);
    await expect(body).not.toContainText(s.invitee);
    await expectNoAnswerButtons(y.page);
  });
});

test('TC-5.2: that person gets not found on the invited org and the invitation is still pending for its invitee', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const s = await orgWithInvitation(scope, browser);
    const y = await existingUser(scope, browser, 'y');
    await y.page.goto(linkOf(s.invitationId));
    await expect(y.page.getByRole('heading', { level: 1, name: 'This invitation is not available' })).toBeVisible();

    await expectNotFound(y.page, `/o/${s.org.slug}/projects`);
    expect(await membershipsOf(scope, s.org.id, y.email)).toBe(0);
    const pending = pageOf(InvitationDto).parse(
      await ok(await s.owner.context.request.get(`/api/orgs/${s.org.id}/invitations?pageSize=100`), 200, 'invitations'),
    );
    const mine = pending.items.find((i) => i.id === s.invitationId);
    expect(mine?.status).toBe('pending');
    expect(mine?.email).toBe(s.inviteeEmail);
  });
});

test('TC-5.3: an unknown invitation id shows the same "not available" state', async ({ browser }) => {
  await withScope(async (scope) => {
    const y = await existingUser(scope, browser, 'y');
    await y.page.goto(linkOf(crypto.randomUUID()));

    await expect(y.page.getByRole('heading', { level: 1, name: 'This invitation is not available' })).toBeVisible();
    await expect(
      y.page.getByText(
        'Check that you signed in with the email it was sent to, or ask the person who invited you for a new link.',
      ),
    ).toBeVisible();
    await expect(y.page.getByText(`Signed in as ${y.email}`)).toBeVisible();
    await expect(y.page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await expectNoAnswerButtons(y.page);
  });
});

test('TC-21.1: Accept lands on the org projects page with exactly the invited projects', async ({ browser }) => {
  await withScope(async (scope) => {
    const s = await orgWithInvitation(scope, browser);
    const { page } = await inviteeOnAcceptPage(scope, browser, s);
    const [p1, p2, p3] = s.projects;

    await page.getByRole('button', { name: 'Accept', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${s.org.slug}/projects$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
    await expect(page.getByRole('link', { name: p1?.name ?? '', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: p2?.name ?? '', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: p3?.name ?? '', exact: true })).toHaveCount(0);
    await expect(page.getByText(s.org.name).first()).toBeVisible();
  });
});

test('TC-21.2: an existing user accepting a whole-org invitation lands in it and the switcher lists both orgs', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const s = await orgWithInvitation(scope, browser, 'org');
    const a = await scope.org('a');
    const context = await scope.person(browser);
    const page = await context.newPage();
    const u = scope.handle('u');
    await inviteAndSignIn(page, scope.pa, a.id, u, 'member', { type: 'org' });
    const toO = await inviteViaApi(
      s.owner.context.request,
      s.org.id,
      scope.email('u'),
      'member',
      { type: 'org' },
      'tenant',
    );

    await page.goto(linkOf(toO.id));
    await expect(page.getByRole('heading', { level: 1, name: `Join ${s.org.name}` })).toBeVisible();
    await page.getByRole('button', { name: 'Accept', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${s.org.slug}/projects$`));
    expect((await switcherOrgs(page)).sort()).toEqual([a.name, s.org.name].sort());
  });
});

test('TC-22.1: declining shows "You declined this invitation", leaves the list and joins nothing', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const s = await orgWithInvitation(scope, browser);
    const { page } = await inviteeOnAcceptPage(scope, browser, s);

    await declineViaDialog(page, s.org.name);
    await expect(page.getByRole('heading', { level: 1, name: 'You declined this invitation' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to invitations' })).toBeVisible();
    const mine = z
      .object({ items: z.array(z.object({ id: z.string() })) })
      .parse(await ok(await page.request.get('/api/me/invitations?pageSize=100'), 200, 'my invitations'));
    expect(mine.items.map((i) => i.id)).not.toContain(s.invitationId);
    await page.goto('/invitations');
    // Wait for the loaded page first: the loading state has no list items either.
    await expect(
      page.getByRole('heading', { level: 1, name: "You're not a member of any organization" }),
    ).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: `${s.org.name} invited you as` })).toHaveCount(0);
    await expectNotFound(page, `/o/${s.org.slug}/projects`);
    expect(await membershipsOf(scope, s.org.id, s.inviteeEmail)).toBe(0);
  });
});

test('TC-22.2: the inviter sees the declined invitation under the Declined chip', async ({ browser }) => {
  await withScope(async (scope) => {
    const s = await orgWithInvitation(scope, browser);
    const { page } = await inviteeOnAcceptPage(scope, browser, s);
    await declineViaDialog(page, s.org.name);
    await expect(page.getByRole('heading', { level: 1, name: 'You declined this invitation' })).toBeVisible();

    const owner = await s.owner.context.newPage();
    await owner.goto(`/o/${s.org.slug}/invitations`);
    await expect(owner.getByRole('heading', { level: 1, name: 'Invitations' })).toBeVisible();
    await owner.getByRole('group', { name: 'Filter by status' }).getByRole('button', { name: 'Declined' }).click();
    const row = owner.getByRole('row').filter({ hasText: s.inviteeEmail });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Declined');
  });
});

test('TC-22.3: Cancel in the decline dialog closes it and keeps the invitation pending', async ({ browser }) => {
  await withScope(async (scope) => {
    const s = await orgWithInvitation(scope, browser);
    const { page } = await inviteeOnAcceptPage(scope, browser, s);

    await page.getByRole('button', { name: 'Decline', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Decline invitation to ${s.org.name}?` });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: `Join ${s.org.name}` })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Decline', exact: true })).toBeEnabled();
    const mine = await ok(await page.request.get(`/api/me/invitations/${s.invitationId}`), 200, 'my invitation');
    expect(z.object({ status: z.string() }).parse(mine).status).toBe('pending');
  });
});

test('TC-23.1: Accept on an invitation revoked after the page opened shows "revoked" and joins nothing', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const s = await orgWithInvitation(scope, browser);
    const { page } = await inviteeOnAcceptPage(scope, browser, s);
    await revokeAsOwner(s);

    await page.getByRole('button', { name: 'Accept', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'This invitation was revoked' })).toBeVisible();
    await expectNoAnswerButtons(page);
    await expectNotFound(page, `/o/${s.org.slug}/projects`);
    expect(await membershipsOf(scope, s.org.id, s.inviteeEmail)).toBe(0);
  });
});

test('TC-23.2: Decline on an invitation revoked after the page opened shows "revoked"', async ({ browser }) => {
  await withScope(async (scope) => {
    const s = await orgWithInvitation(scope, browser);
    const { page } = await inviteeOnAcceptPage(scope, browser, s);
    await revokeAsOwner(s);

    await declineViaDialog(page, s.org.name);
    await expect(page.getByRole('heading', { level: 1, name: 'This invitation was revoked' })).toBeVisible();
    await expectNoAnswerButtons(page);
  });
});

test('TC-23.3: Accept in a page whose invitation another page declined shows "declined" and joins nothing', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const s = await orgWithInvitation(scope, browser);
    const { page, context } = await inviteeOnAcceptPage(scope, browser, s);
    const other = await secondPage(context, s);
    await declineViaDialog(other, s.org.name);
    await expect(other.getByRole('heading', { level: 1, name: 'You declined this invitation' })).toBeVisible();

    await page.getByRole('button', { name: 'Accept', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'You declined this invitation' })).toBeVisible();
    await expectNoAnswerButtons(page);
    expect(await membershipsOf(scope, s.org.id, s.inviteeEmail)).toBe(0);
  });
});

test('TC-23.4: Decline in a page whose invitation another page accepted shows "already joined" and keeps the membership', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const s = await orgWithInvitation(scope, browser);
    const { page, context } = await inviteeOnAcceptPage(scope, browser, s);
    const other = await secondPage(context, s);
    await other.getByRole('button', { name: 'Accept', exact: true }).click();
    await expect(other).toHaveURL(new RegExp(`/o/${s.org.slug}/projects$`));

    await declineViaDialog(page, s.org.name);
    await expect(page.getByRole('heading', { level: 1, name: `You already joined ${s.org.name}` })).toBeVisible();
    await expect(page.getByRole('link', { name: `Go to ${s.org.name}` })).toBeVisible();
    await expectNoAnswerButtons(page);
    expect(await membershipsOf(scope, s.org.id, s.inviteeEmail)).toBe(1);
  });
});

test('TC-24.1: a signed-out person opening the link is sent to sign-in and back to the invitation', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const s = await orgWithInvitation(scope, browser);
    const context = await scope.person(browser);
    const page = await context.newPage();

    await page.goto(linkOf(s.invitationId));
    await expect(page).toHaveURL(/\/sign-in\?/);
    const url = new URL(page.url());
    expect(url.pathname).toBe('/sign-in');
    expect(url.searchParams.get('redirect')).toBe(linkOf(s.invitationId));

    await page.goto(`/auth/dev-login?handle=${s.invitee}&redirect=${encodeURIComponent(linkOf(s.invitationId))}`);
    await expect(page).toHaveURL(new RegExp(`${linkOf(s.invitationId)}$`));
    await expect(page.getByRole('heading', { level: 1, name: `Join ${s.org.name}` })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Decline', exact: true })).toBeVisible();
  });
});

test('TC-25.1: the matching invitee sees role, projects, inviter and expiry, with Accept before Decline', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const s = await orgWithInvitation(scope, browser);
    const { page } = await inviteeOnAcceptPage(scope, browser, s);

    await expect(detail(page, 'Role')).toHaveText(s.roleName);
    const access = (await detail(page, 'Access').innerText()).split(', ').sort();
    expect(access).toEqual(
      s.projects
        .slice(0, 2)
        .map((p) => p.name)
        .sort(),
    );
    await expect(detail(page, 'Invited by')).toHaveText(s.owner.handle);
    const expires = detail(page, 'Expires').locator('time');
    await expect(expires).toHaveText(/^\d{1,2} \w{3}, \d{2}:\d{2}$/);
    const hours = (Date.parse((await expires.getAttribute('datetime')) ?? '') - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(47);
    expect(hours).toBeLessThan(49);
    expect(await mainButtons(page).allInnerTexts()).toEqual(['Accept', 'Decline']);
  });
});

test('TC-25.2: a whole-org invitation shows "Whole organization" as the access', async ({ browser }) => {
  await withScope(async (scope) => {
    const s = await orgWithInvitation(scope, browser, 'org');
    const { page } = await inviteeOnAcceptPage(scope, browser, s);
    await expect(detail(page, 'Access')).toHaveText('Whole organization');
  });
});

test('TC-26.1: the link of an accepted invitation shows "already joined" and no Accept or Decline', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const s = await orgWithInvitation(scope, browser);
    const { page } = await inviteeOnAcceptPage(scope, browser, s);
    await acceptViaApi(page, s.invitationId);

    await page.goto(linkOf(s.invitationId));
    await expect(page.getByRole('heading', { level: 1, name: `You already joined ${s.org.name}` })).toBeVisible();
    await expect(page.getByRole('link', { name: `Go to ${s.org.name}` })).toBeVisible();
    await expectNoAnswerButtons(page);
  });
});

test('TC-26.2: the link of a declined invitation shows "declined" and no Accept or Decline', async ({ browser }) => {
  await withScope(async (scope) => {
    const s = await orgWithInvitation(scope, browser);
    const { page } = await inviteeOnAcceptPage(scope, browser, s);
    await ok(await page.request.post(`/api/me/invitations/${s.invitationId}/decline`), 204, 'decline invitation');

    await page.goto(linkOf(s.invitationId));
    await expect(page.getByRole('heading', { level: 1, name: 'You declined this invitation' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to invitations' })).toBeVisible();
    await expectNoAnswerButtons(page);
  });
});

test('TC-26.3: the link of a revoked invitation shows "revoked" and no Accept or Decline', async ({ browser }) => {
  await withScope(async (scope) => {
    const s = await orgWithInvitation(scope, browser);
    // The invitee has an account (signed in while the invitation was pending), then the owner revokes it.
    const { page } = await inviteeOnAcceptPage(scope, browser, s);
    await revokeAsOwner(s);
    await page.goto(linkOf(s.invitationId));

    await expect(page.getByRole('heading', { level: 1, name: 'This invitation was revoked' })).toBeVisible();
    await expectNoAnswerButtons(page);
  });
});

test('TC-42.1: Accept in two pages gives one membership and the second page shows "already joined"', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const s = await orgWithInvitation(scope, browser);
    const { page, context } = await inviteeOnAcceptPage(scope, browser, s);
    const other = await secondPage(context, s);

    await page.getByRole('button', { name: 'Accept', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${s.org.slug}/projects$`));
    await other.getByRole('button', { name: 'Accept', exact: true }).click();
    await expect(other.getByRole('heading', { level: 1, name: `You already joined ${s.org.name}` })).toBeVisible();
    await expect(other.getByRole('link', { name: `Go to ${s.org.name}` })).toBeVisible();
    expect(await membershipsOf(scope, s.org.id, s.inviteeEmail)).toBe(1);
  });
});

test('TC-42.2: a double click on Accept lands in the org or on "already joined", never an error, with one membership', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const s = await orgWithInvitation(scope, browser);
    const { page } = await inviteeOnAcceptPage(scope, browser, s);

    await page.getByRole('button', { name: 'Accept', exact: true }).dblclick();
    const landed = page.getByRole('heading', { level: 1, name: 'Projects' });
    const joined = page.getByRole('heading', { level: 1, name: `You already joined ${s.org.name}` });
    await expect(landed.or(joined)).toBeVisible();
    await expect(page.getByText('Internal server error')).toHaveCount(0);
    await expect(page.getByText('Page not found')).toHaveCount(0);
    expect(await membershipsOf(scope, s.org.id, s.inviteeEmail)).toBe(1);
  });
});

test('TC-52.1: the inviter handle shows in the Invited by column and on the accept page', async ({ browser }) => {
  await withScope(async (scope) => {
    const s = await orgWithInvitation(scope, browser);
    const owner = await s.owner.context.newPage();
    await owner.goto(`/o/${s.org.slug}/invitations`);
    await expect(owner.getByRole('heading', { level: 1, name: 'Invitations' })).toBeVisible();
    const headers = await owner.getByRole('columnheader').allInnerTexts();
    const column = headers.findIndex((h) => h.trim() === 'Invited by');
    expect(column, 'the Invited by column exists').toBeGreaterThanOrEqual(0);
    const row = owner.getByRole('row').filter({ hasText: s.inviteeEmail });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('cell').nth(column)).toHaveText(s.owner.handle);

    const { page } = await inviteeOnAcceptPage(scope, browser, s);
    await expect(detail(page, 'Invited by')).toHaveText(s.owner.handle);
  });
});
