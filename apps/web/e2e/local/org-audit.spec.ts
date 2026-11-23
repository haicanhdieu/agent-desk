import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { AuditEntryDto, MemberDto, OrgDto, pageOf } from '@agentdesk/contracts';
import {
  API,
  acceptViaApi,
  inviteAndSignIn,
  inviteViaApi,
  ok,
  signInAs,
  type InviteScope,
  type RoleKey,
} from './helpers';
import { disposeSecondOrg, roleIdsOf, secondOrg, type Actor } from './rbac-cast';
import { withScope, type Org, type Scope } from './onboarding-scope';

/*
 * Local end-to-end for the org Audit log and cross-org isolation (spec 2026-11-22-org-tenant-admin-design.md "E2E
 * requirements": TC-20.1, TC-20.2, TC-21.1 to TC-21.5, TC-22.1, TC-22.2, TC-23.1 to TC-23.6, TC-25.1 to TC-25.4).
 *
 * Every test builds its own org with random `e2e-<rand>` handles and only the people it needs, one browser context per
 * person, and closes every context it opened. The Givens use the API; the Steps go through the UI, except that the
 * BR-25 API answers are the raw requests of each person's request context. The entry text is asserted, never the
 * relative time. Dev-login users are named after their handle, so a person's name in an entry is their handle.
 */

test.describe.configure({ timeout: 300_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`scripts/runner-stack.sh up\``).toBe(true);
});

/** One org with its owner O. */
interface World {
  scope: Scope;
  browser: Browser;
  org: Org;
  o: Actor;
  roleIds: Record<RoleKey, string>;
}

async function withWorld(browser: Browser, body: (w: World) => Promise<void>): Promise<void> {
  await withScope(async (scope) => {
    const org = await scope.org('au');
    const roleIds = await roleIdsOf(scope.pa, org.id);
    const o = await join(scope, browser, org, 'o', 'owner');
    await body({ scope, browser, org, o, roleIds });
  });
}

/** Invites `<who>-<tag>@dev.local` into `org` with a built-in role (the whole org), signs them in on a new context. */
async function join(
  scope: Scope,
  browser: Browser,
  org: Org,
  who: string,
  roleKey: RoleKey,
  access: InviteScope = { type: 'org' },
): Promise<Actor> {
  const ctx = await scope.person(browser);
  const page = await ctx.newPage();
  const handle = scope.handle(who);
  const { userId } = await inviteAndSignIn(page, scope.pa, org.id, handle, roleKey, access);
  return { handle, userId, ctx, page, api: ctx.request };
}

async function membersOf(api: Actor['api'], orgId: string): Promise<MemberDto[]> {
  return pageOf(MemberDto).parse(await ok(await api.get(`/api/orgs/${orgId}/members?pageSize=100`), 200, 'member list'))
    .items;
}

async function nameOf(w: World, userId: string): Promise<string> {
  const member = (await membersOf(w.o.api, w.org.id)).find((m) => m.userId === userId);
  expect(member, `user ${userId} is a member of the org`).toBeTruthy();
  return member?.name ?? '';
}

async function roleKeysOf(w: World, userId: string): Promise<string[] | undefined> {
  return (await membersOf(w.o.api, w.org.id)).find((m) => m.userId === userId)?.assignments.map((a) => a.role.key);
}

async function setRole(w: World, userId: string, roleId: string | null): Promise<void> {
  await ok(
    await w.o.api.put(`/api/orgs/${w.org.id}/members/${userId}/role`, { data: { roleId } }),
    200,
    'change member role',
  );
}

async function renameViaApi(api: Actor['api'], orgId: string, name: string): Promise<void> {
  OrgDto.parse(await ok(await api.patch(`/api/orgs/${orgId}`, { data: { name } }), 200, 'rename'));
}

/** The whole audit list of an org as `api` reads it (the audit route, exactly 200). */
async function auditOf(api: Actor['api'], orgId: string): Promise<AuditEntryDto[]> {
  return pageOf(AuditEntryDto).parse(
    await ok(await api.get(`/api/orgs/${orgId}/audit?pageSize=100`), 200, 'audit list'),
  ).items;
}

const auditUrl = (slug: string): string => `/o/${slug}/settings/audit`;
const membersUrl = (slug: string): string => `/o/${slug}/settings/members`;
const invitationsUrl = (slug: string): string => `/o/${slug}/settings/invitations`;
const generalUrl = (slug: string): string => `/o/${slug}/settings/general`;
const h1 = (page: Page, name: string): Locator => page.getByRole('heading', { level: 1, name });
const toastOf = (page: Page, title: string | RegExp): Locator =>
  page.getByRole('status').or(page.getByRole('alert')).filter({ hasText: title });
const rowOf = (page: Page, text: string): Locator => page.getByRole('row').filter({ hasText: text });

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WHO = 1;
const WHAT = 2;

/** The audit rows whose What cell reads exactly `sentence`. */
function entryRows(page: Page, sentence: string): Locator {
  return page.locator('tbody tr').filter({ has: page.locator('td:nth-child(3)', { hasText: exact(sentence) }) });
}
const exact = (sentence: string): RegExp => new RegExp(`^${escapeRegExp(sentence)}$`);

/** Every What cell of the audit table, in the order shown. */
async function whatTexts(page: Page): Promise<string[]> {
  return (await page.locator('tbody tr td:nth-child(3)').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
}

async function openAudit(page: Page, slug: string): Promise<void> {
  await page.goto(auditUrl(slug));
  await expect(h1(page, 'Audit log')).toBeVisible();
  await expect(page.locator('tbody tr').first()).toBeVisible();
}

async function openMembers(page: Page, slug: string): Promise<void> {
  await page.goto(membersUrl(slug));
  await expect(h1(page, 'Members')).toBeVisible();
  await expect(page.locator('tbody tr').first()).toBeVisible();
}

const menuButton = (page: Page, name: string): Locator => page.getByRole('button', { name: `Actions for ${name}` });
const roleDialog = (page: Page, name: string): Locator => page.getByRole('dialog', { name: `Change role for ${name}` });
const card = (scope: Locator, role: string): Locator => scope.getByRole('radio', { name: new RegExp(`^${role}`) });

async function pickMenuItem(page: Page, name: string, item: 'Change role' | 'Remove from organization'): Promise<void> {
  await menuButton(page, name).click();
  await page.getByRole('button', { name: item, exact: true }).click();
}

/** Opens the role dialog of `name` and picks `role`; ends with the dialog open, before "Save role". */
async function chooseRole(page: Page, name: string, role: string): Promise<Locator> {
  await pickMenuItem(page, name, 'Change role');
  const dialog = roleDialog(page, name);
  await expect(dialog).toBeVisible();
  await card(dialog, role).check();
  return dialog;
}

async function changeRoleThroughUi(page: Page, name: string, role: string): Promise<void> {
  const dialog = await chooseRole(page, name, role);
  await dialog.getByRole('button', { name: 'Save role' }).click();
  await expect(toastOf(page, 'Role changed')).toBeVisible();
  await expect(dialog).toHaveCount(0);
}

// ---- BR-20: the Audit page lists entries ----

test('TC-20.1: O changed B to Admin and renamed the org; the Audit log lists the rename above the role change, each by O', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const b = await join(w.scope, browser, w.org, 'b', 'member');
    const nameO = await nameOf(w, w.o.userId);
    const nameB = await nameOf(w, b.userId);
    await setRole(w, b.userId, w.roleIds.admin);
    const renamed = `E2E Renamed ${w.scope.tag}`;
    await renameViaApi(w.o.api, w.org.id, renamed);

    const page = w.o.page;
    await openAudit(page, w.org.slug);
    await expect(page.getByRole('columnheader')).toHaveText(['When', 'Who', 'What']);
    const rename = `${nameO} changed the organization name from ${w.org.name} to ${renamed}`;
    const change = `${nameO} changed ${nameB}'s role from Member to Admin`;
    await expect(entryRows(page, rename)).toHaveCount(1);
    await expect(entryRows(page, change)).toHaveCount(1);
    const order = await whatTexts(page);
    expect(order.indexOf(rename), 'the rename is listed').toBeGreaterThanOrEqual(0);
    expect(order.indexOf(change), 'the role change is listed').toBeGreaterThanOrEqual(0);
    expect(order.indexOf(rename), 'newest first: the rename is above the role change').toBeLessThan(
      order.indexOf(change),
    );
    // Each shows O as the actor, and the role change names B as the target.
    await expect(entryRows(page, rename).getByRole('cell').nth(WHO)).toHaveText(nameO);
    await expect(entryRows(page, change).getByRole('cell').nth(WHO)).toHaveText(nameO);
    await expect(entryRows(page, change).getByRole('cell').nth(WHAT).locator('b')).toHaveText([nameO, nameB]);
  });
});

test('TC-20.2: org admin A opens the Audit log and finds the rename entry O just made', async ({ browser }) => {
  await withWorld(browser, async (w) => {
    const a = await join(w.scope, browser, w.org, 'a', 'admin');
    const nameO = await nameOf(w, w.o.userId);
    const renamed = `E2E Renamed ${w.scope.tag}`;
    await renameViaApi(w.o.api, w.org.id, renamed);

    await openAudit(a.page, w.org.slug);
    await expect(a.page.getByRole('columnheader')).toHaveText(['When', 'Who', 'What']);
    const rename = `${nameO} changed the organization name from ${w.org.name} to ${renamed}`;
    await expect(entryRows(a.page, rename)).toHaveCount(1);
  });
});

// ---- BR-21: role change and removal ----

test('TC-21.1: O changes B from Member to Admin; the Audit log reads "O changed B\'s role from Member to Admin"', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const b = await join(w.scope, browser, w.org, 'b', 'member');
    const nameO = await nameOf(w, w.o.userId);
    const nameB = await nameOf(w, b.userId);
    await openMembers(w.o.page, w.org.slug);
    await changeRoleThroughUi(w.o.page, nameB, 'Admin');

    await openAudit(w.o.page, w.org.slug);
    await expect(entryRows(w.o.page, `${nameO} changed ${nameB}'s role from Member to Admin`)).toHaveCount(1);
  });
});

test('TC-21.2: O changes admin B to Owner; the Audit log reads "O changed B\'s role from Admin to Owner"', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const b = await join(w.scope, browser, w.org, 'b', 'admin');
    const nameO = await nameOf(w, w.o.userId);
    const nameB = await nameOf(w, b.userId);
    await openMembers(w.o.page, w.org.slug);
    await changeRoleThroughUi(w.o.page, nameB, 'Owner');

    await openAudit(w.o.page, w.org.slug);
    await expect(entryRows(w.o.page, `${nameO} changed ${nameB}'s role from Admin to Owner`)).toHaveCount(1);
  });
});

test('TC-21.3: with owners O and B, B steps O down to Admin; the Audit log reads "B changed O\'s role from Owner to Admin"', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const b = await join(w.scope, browser, w.org, 'b', 'member');
    await setRole(w, b.userId, w.roleIds.owner);
    const nameO = await nameOf(w, w.o.userId);
    const nameB = await nameOf(w, b.userId);
    // nobody changes their own role, so the other owner B does it (through the API, as the Given)
    await ok(
      await b.api.put(`/api/orgs/${w.org.id}/members/${w.o.userId}/role`, { data: { roleId: w.roleIds.admin } }),
      200,
      'B steps O down',
    );

    await openAudit(b.page, w.org.slug);
    await expect(entryRows(b.page, `${nameB} changed ${nameO}'s role from Owner to Admin`)).toHaveCount(1);
  });
});

test('TC-21.4: O removes member B; the Audit log reads "O removed B from the organization (was Member)"', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const b = await join(w.scope, browser, w.org, 'b', 'member');
    const nameO = await nameOf(w, w.o.userId);
    const nameB = await nameOf(w, b.userId);
    const page = w.o.page;
    await openMembers(page, w.org.slug);
    await pickMenuItem(page, nameB, 'Remove from organization');
    const dialog = page.getByRole('dialog', { name: `Remove ${nameB} from ${w.org.name}?` });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(toastOf(page, `${nameB} removed`)).toBeVisible();

    await openAudit(page, w.org.slug);
    await expect(entryRows(page, `${nameO} removed ${nameB} from the organization (was Member)`)).toHaveCount(1);
  });
});

test('TC-21.5: sole owner O has no menu on the own row and is refused changing it (403); the Audit log has no role-change entry', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const nameO = await nameOf(w, w.o.userId);
    const page = w.o.page;
    await openMembers(page, w.org.slug);
    await expect(rowOf(page, w.o.handle)).toContainText('You');
    await expect(menuButton(page, nameO)).toHaveCount(0);
    const put = await w.o.api.put(`/api/orgs/${w.org.id}/members/${w.o.userId}/role`, {
      data: { roleId: w.roleIds.admin },
    });
    expect(put.status(), 'PUT own role').toBe(403);
    expect(await roleKeysOf(w, w.o.userId)).toEqual(['owner']);

    await openAudit(page, w.org.slug);
    // Positive control: the page lists entries (the org's creation row), so an empty match below is not an unloaded page.
    await expect(page.locator('tbody tr td:nth-child(3)').filter({ hasText: 'org.created' })).toHaveCount(1);
    await expect(page.locator('tbody tr td:nth-child(3)').filter({ hasText: "'s role from" })).toHaveCount(0);
    expect((await auditOf(w.o.api, w.org.id)).filter((e) => e.action === 'member.role_changed')).toHaveLength(0);
  });
});

// ---- BR-22: name and slug ----

test('TC-22.1: O renames the org from X to Y on General; the Audit log reads "O changed the organization name from X to Y"', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const nameO = await nameOf(w, w.o.userId);
    const renamed = `E2E Renamed ${w.scope.tag}`;
    const page = w.o.page;
    await page.goto(generalUrl(w.org.slug));
    await expect(h1(page, 'General')).toBeVisible();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue(w.org.name);
    await page.getByLabel('Name', { exact: true }).fill(renamed);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(toastOf(page, 'Organization updated')).toBeVisible();

    await openAudit(page, w.org.slug);
    await expect(
      entryRows(page, `${nameO} changed the organization name from ${w.org.name} to ${renamed}`),
    ).toHaveCount(1);
  });
});

test('TC-22.2: O changes the URL from old to new; the Audit log at the new URL reads "O changed the organization URL from /o/old to /o/new"', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const nameO = await nameOf(w, w.o.userId);
    const fresh = `e2e-new-${w.scope.tag}`;
    const page = w.o.page;
    await page.goto(generalUrl(w.org.slug));
    await expect(h1(page, 'General')).toBeVisible();
    await page.getByLabel('URL', { exact: true }).fill(fresh);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Change the organization URL?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Change URL', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${fresh}/settings/general$`));

    await openAudit(page, fresh);
    await expect(
      entryRows(page, `${nameO} changed the organization URL from /o/${w.org.slug} to /o/${fresh}`),
    ).toHaveCount(1);
  });
});

// ---- BR-23: invitation events ----

const inviteDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Invite people' });

async function openInvitations(page: Page, slug: string): Promise<void> {
  await page.goto(invitationsUrl(slug));
  await expect(h1(page, 'Invitations')).toBeVisible();
}

/** A pending invitation as the owner (the org's own route, so O is the actor), by the API. */
async function pendingInvitation(w: World, email: string, role: RoleKey): Promise<string> {
  return (await inviteViaApi(w.o.api, w.org.id, email, role, { type: 'org' }, 'tenant')).id;
}

test('TC-23.1: O invites a person as Viewer; the Audit log reads "O invited <email> as Viewer", the email as plain text', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const nameO = await nameOf(w, w.o.userId);
    const email = w.scope.email('sam');
    const page = w.o.page;
    await openInvitations(page, w.org.slug);
    await page.getByRole('button', { name: 'Invite people' }).first().click();
    const dialog = inviteDialog(page);
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Email').fill(email);
    await dialog.getByLabel('Role').selectOption({ label: 'Viewer' });
    await dialog.getByRole('radio', { name: 'Whole organization' }).check();
    await dialog.getByRole('button', { name: 'Create invitation' }).click();
    const created = page.getByRole('dialog', { name: 'Invitation created' });
    await expect(created).toBeVisible();
    await created.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(rowOf(page, email)).toHaveCount(1);

    await openAudit(page, w.org.slug);
    const row = entryRows(page, `${nameO} invited ${email} as Viewer`);
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('link')).toHaveCount(0);
    await expect(row.locator('td:nth-child(3) b').nth(1)).toHaveText(email);
  });
});

test('TC-23.2: O resends a pending invitation; the Audit log reads "O resent the invitation for <email>"', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const nameO = await nameOf(w, w.o.userId);
    const email = w.scope.email('sam');
    await pendingInvitation(w, email, 'member');
    const page = w.o.page;
    await openInvitations(page, w.org.slug);
    await page.getByRole('button', { name: `Actions for ${email}` }).click();
    await page.getByRole('button', { name: 'Resend', exact: true }).click();
    await expect(toastOf(page, /^Invitation renewed\./)).toBeVisible();

    await openAudit(page, w.org.slug);
    await expect(entryRows(page, `${nameO} resent the invitation for ${email}`)).toHaveCount(1);
  });
});

test('TC-23.3: O revokes a pending invitation; the Audit log reads "O revoked the invitation for <email>"', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const nameO = await nameOf(w, w.o.userId);
    const email = w.scope.email('sam');
    await pendingInvitation(w, email, 'member');
    const page = w.o.page;
    await openInvitations(page, w.org.slug);
    await page.getByRole('button', { name: `Actions for ${email}` }).click();
    await page.getByRole('button', { name: 'Revoke', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Revoke invitation for ${email}?` });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Revoke', exact: true }).click();
    await expect(toastOf(page, 'Invitation revoked')).toBeVisible();

    await openAudit(page, w.org.slug);
    await expect(entryRows(page, `${nameO} revoked the invitation for ${email}`)).toHaveCount(1);
  });
});

/** The invitee signs in (an account, no membership) and accepts or declines the pending invitation `id`. */
async function answer(w: World, who: string, id: string, verb: 'accept' | 'decline'): Promise<string> {
  const ctx = await w.scope.person(w.browser);
  const handle = w.scope.handle(who);
  const page = await signInAs(ctx, handle);
  if (verb === 'accept') await acceptViaApi(page, id);
  else await ok(await page.request.post(`/api/me/invitations/${id}/decline`), 204, 'decline invitation');
  return handle;
}

test('TC-23.4: a pending Member invitation is accepted; O\'s Audit log reads "<invitee> accepted an invitation as Member", with no email', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const email = w.scope.email('inv');
    const id = await pendingInvitation(w, email, 'member');
    const handle = await answer(w, 'inv', id, 'accept');
    const invitee = (await membersOf(w.o.api, w.org.id)).find((m) => m.handle === handle);
    expect(invitee, 'the invitee is a member after accepting').toBeTruthy();

    await openAudit(w.o.page, w.org.slug);
    const row = entryRows(w.o.page, `${invitee?.name ?? ''} accepted an invitation as Member`);
    await expect(row).toHaveCount(1);
    await expect(row).not.toContainText(email);
    await expect(row.getByRole('link')).toHaveCount(0);
  });
});

test('TC-23.5: a pending invitation is declined; O\'s Audit log reads "<invitee> declined an invitation"', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const email = w.scope.email('inv');
    const id = await pendingInvitation(w, email, 'member');
    const handle = await answer(w, 'inv', id, 'decline');

    await openAudit(w.o.page, w.org.slug);
    // The decliner is not a member, so there is no member row to read the name from: a dev-login user is named by handle.
    const row = entryRows(w.o.page, `${handle} declined an invitation`);
    await expect(row).toHaveCount(1);
    await expect(row).not.toContainText(email);
    await expect(row.getByRole('cell').nth(WHO)).toHaveText(handle);
  });
});

test('TC-23.6: after the acceptance the Audit log shows the role granted through it (spec Q3: "accepted an invitation as Member")', async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const email = w.scope.email('inv');
    const id = await pendingInvitation(w, email, 'member');
    const handle = await answer(w, 'inv', id, 'accept');
    const invitee = (await membersOf(w.o.api, w.org.id)).find((m) => m.handle === handle);
    expect(invitee?.assignments.map((a) => a.role.key)).toEqual(['member']);

    await openAudit(w.o.page, w.org.slug);
    const row = entryRows(w.o.page, `${invitee?.name ?? ''} accepted an invitation as Member`);
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('cell').nth(WHO)).toHaveText(invitee?.name ?? '');
    // The invitee has no accepted entry for another role (O's own Owner acceptance is a different row).
    await expect(
      w.o.page.locator('tbody tr td:nth-child(3)').filter({
        hasText: new RegExp(`^${escapeRegExp(invitee?.name ?? '')} accepted an invitation as (?!Member\\b)`),
      }),
    ).toHaveCount(0);
    // The grant row of the same accept: actor O (who granted the role), target the invitee, linked to the invitation.
    const granted = (await auditOf(w.o.api, w.org.id)).filter(
      (e) => e.action === 'assignment.granted' && e.target.id === invitee?.userId,
    );
    expect(granted).toHaveLength(1);
    expect(granted[0]?.actor?.userId).toBe(w.o.userId);
    expect(granted[0]?.target.type).toBe('user');
  });
});

// ---- BR-25: cross-org isolation ----

/**
 * U owns org A (the world) and org B (made by `secondOrg`, with its own owner Y) takes U as a Member or Owner: the
 * platform admin invites U's email and U accepts on their own session.
 */
async function joinOtherOrg(w: World, orgId: string, u: Actor, roleKey: RoleKey): Promise<void> {
  const invitation = await inviteViaApi(w.scope.pa, orgId, `${u.handle.toLowerCase()}@dev.local`, roleKey, {
    type: 'org',
  });
  await acceptViaApi(u.page, invitation.id);
}

test("TC-25.1: U owns A and is a plain member of B; after B renames, A's Audit log has no entry about B", async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const second = await secondOrg(browser, w.scope.pa);
    try {
      await joinOtherOrg(w, second.orgId, w.o, 'member');
      const bName = `B Renamed ${w.scope.tag}`;
      await renameViaApi(second.owner.api, second.orgId, bName);
      const bOwnerName = (await membersOf(second.owner.api, second.orgId)).find(
        (m) => m.userId === second.owner.userId,
      )?.name;
      expect(bOwnerName, 'B owner is a member of B').toBeTruthy();
      const nameU = await nameOf(w, w.o.userId);
      // A's own activity, the positive control for "A's page shows A's entries".
      const aName = `E2E A Renamed ${w.scope.tag}`;
      await renameViaApi(w.o.api, w.org.id, aName);

      const page = w.o.page;
      await openAudit(page, w.org.slug);
      await expect(
        entryRows(page, `${nameU} changed the organization name from ${w.org.name} to ${aName}`),
      ).toHaveCount(1);
      await expect(page.getByText(bName)).toHaveCount(0);
      await expect(page.getByText(bOwnerName ?? '')).toHaveCount(0);
      await expect(page.getByText(second.owner.handle)).toHaveCount(0);

      // The same through the API: B's entries exist (as B's owner reads them), none of their ids is in A's list.
      const bEntries = await auditOf(second.owner.api, second.orgId);
      expect(bEntries.some((e) => e.action === 'org.updated' && e.changes.some((c) => c.to === bName))).toBe(true);
      // Control: U's own acceptance into B is in B's list, so the overlap check below compares real rows.
      expect(bEntries.some((e) => e.actor?.userId === w.o.userId || e.target.id === w.o.userId)).toBe(true);
      const aEntries = await auditOf(w.o.api, w.org.id);
      const bIds = new Set(bEntries.map((e) => e.id));
      expect(aEntries.filter((e) => bIds.has(e.id))).toHaveLength(0);
      expect(aEntries.some((e) => e.actor?.userId === second.owner.userId)).toBe(false);
      expect(JSON.stringify(aEntries)).not.toContain(bName);
      // U's session is on org A: B's audit route is not the active org, so it answers 404 (never 403, never B's rows).
      expect((await w.o.api.get(`/api/orgs/${second.orgId}/audit`)).status()).toBe(404);
    } finally {
      await disposeSecondOrg(second);
    }
  });
});

test("TC-25.2: U owns A and is a plain member of B; U opens B's members URL and sees the no-access state", async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const second = await secondOrg(browser, w.scope.pa);
    try {
      await joinOtherOrg(w, second.orgId, w.o, 'member');
      const bOwnerName = (await membersOf(second.owner.api, second.orgId)).find(
        (m) => m.userId === second.owner.userId,
      )?.name;
      const page = w.o.page;
      // Control: A's own members page lists people for U, so the refusal below is B's, not a broken session.
      await openMembers(page, w.org.slug);
      await page.goto(membersUrl(second.owner.handle));
      await expect(page.getByRole('heading', { name: "You don't have access" })).toBeVisible();
      await expect(page.getByText('Ask an owner of this organization to give you access.')).toBeVisible();
      await expect(page.locator('tbody tr')).toHaveCount(0);
      await expect(page.getByText(bOwnerName ?? '')).toHaveCount(0);
      await expect(page.getByText('Page not found')).toHaveCount(0);

      // B is now U's active org: as a plain member, every B route is refused 403 (permission before any lookup).
      const bOrg = `/api/orgs/${second.orgId}`;
      const roleId = (await roleIdsOf(w.scope.pa, second.orgId)).viewer;
      const refused: [string, number][] = [
        ['GET members', (await w.o.api.get(`${bOrg}/members`)).status()],
        ['GET audit', (await w.o.api.get(`${bOrg}/audit`)).status()],
        ['PATCH org', (await w.o.api.patch(bOrg, { data: { name: 'x' } })).status()],
        ['PUT role', (await w.o.api.put(`${bOrg}/members/${second.owner.userId}/role`, { data: { roleId } })).status()],
      ];
      for (const [what, status] of refused) expect(status, what).toBe(403);
      // Nothing changed in B, read as B's owner (positive control: the owner's own reads are 200).
      const members = await membersOf(second.owner.api, second.orgId);
      expect(members.find((m) => m.userId === second.owner.userId)?.assignments.map((a) => a.role.key)).toEqual([
        'owner',
      ]);
      const bAfter = await auditOf(second.owner.api, second.orgId);
      expect(bAfter.some((e) => e.action === 'org.updated')).toBe(false);
      expect(bAfter.some((e) => e.action === 'member.role_changed')).toBe(false);
    } finally {
      await disposeSecondOrg(second);
    }
  });
});

test("TC-25.3: W is not a member of B; W opens B's members URL and sees not found, and the API answers 404, not 403", async ({
  browser,
}) => {
  await withWorld(browser, async (w) => {
    const second = await secondOrg(browser, w.scope.pa);
    try {
      const wPerson = await join(w.scope, browser, w.org, 'w', 'owner');
      const bOrg = `/api/orgs/${second.orgId}`;
      const page = wPerson.page;
      // Control: W's own org works for W.
      await openMembers(page, w.org.slug);
      await page.goto(membersUrl(second.owner.handle));
      await expect(page.getByText('Page not found')).toBeVisible();
      await expect(page.getByText("You don't have access")).toHaveCount(0);
      await expect(page.locator('tbody tr')).toHaveCount(0);

      // Another org's record is 404 for every B route, whatever the verb (never 403).
      const roleId = (await roleIdsOf(w.scope.pa, second.orgId)).viewer;
      const requests: [string, number][] = [
        ['GET audit', (await wPerson.api.get(`${bOrg}/audit`)).status()],
        ['GET members', (await wPerson.api.get(`${bOrg}/members`)).status()],
        [
          'PUT role',
          (await wPerson.api.put(`${bOrg}/members/${second.owner.userId}/role`, { data: { roleId } })).status(),
        ],
        ['DELETE member', (await wPerson.api.delete(`${bOrg}/members/${second.owner.userId}`)).status()],
        ['PATCH org', (await wPerson.api.patch(bOrg, { data: { name: 'x' } })).status()],
        ['GET invitations', (await wPerson.api.get(`${bOrg}/invitations`)).status()],
        ['DELETE random', (await wPerson.api.delete(`${bOrg}/members/${randomUUID()}`)).status()],
      ];
      for (const [what, status] of requests) expect(status, what).toBe(404);

      // Nothing changed in B, read as B's owner; the owner's own read of the same routes works.
      const members = await membersOf(second.owner.api, second.orgId);
      expect(members.find((m) => m.userId === second.owner.userId)?.assignments.map((a) => a.role.key)).toEqual([
        'owner',
      ]);
      // The refused PATCH did not rename B: no name or slug change was recorded, and the page still lists B's own rows.
      const bAudit = await auditOf(second.owner.api, second.orgId);
      expect(bAudit.length).toBeGreaterThan(0);
      expect(bAudit.every((e) => e.action !== 'member.role_changed' && e.action !== 'org.updated')).toBe(true);
    } finally {
      await disposeSecondOrg(second);
    }
  });
});

test("TC-25.4: U owns both A and B; U opens B's Audit log and B's entries show, not A's", async ({ browser }) => {
  await withWorld(browser, async (w) => {
    const second = await secondOrg(browser, w.scope.pa);
    try {
      await joinOtherOrg(w, second.orgId, w.o, 'owner');
      const bName = `B Renamed ${w.scope.tag}`;
      await renameViaApi(second.owner.api, second.orgId, bName);
      const bOwnerName = (await membersOf(second.owner.api, second.orgId)).find(
        (m) => m.userId === second.owner.userId,
      )?.name;
      const aName = `E2E A Renamed ${w.scope.tag}`;
      await renameViaApi(w.o.api, w.org.id, aName);

      const page = w.o.page;
      await openAudit(page, second.owner.handle);
      await expect(
        entryRows(
          page,
          `${bOwnerName ?? ''} changed the organization name from RBAC Y ${second.owner.handle.slice(7)} to ${bName}`,
        ),
      ).toHaveCount(1);
      // A's own rename is not in B's list.
      await expect(page.getByText(aName)).toHaveCount(0);
      const entries = await auditOf(w.o.api, second.orgId);
      expect(entries.some((e) => e.action === 'org.updated' && e.changes.some((c) => c.to === bName))).toBe(true);
      expect(JSON.stringify(entries)).not.toContain(aName);
    } finally {
      await disposeSecondOrg(second);
    }
  });
});
