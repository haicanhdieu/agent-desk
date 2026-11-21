import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { PlatformRoleDto, ProjectDto } from '@agentdesk/contracts';
import { z } from 'zod';
import { API, grant, inviteAndSignIn, inviteViaApi, ok, signInAs } from './helpers';
import type { InviteScope, RoleKey } from './helpers';
import { REPO_NEW, REPO_P1, REPO_P2, installFake } from './rbac-cast';
import { Scope, withScope as withSharedScope, type Org } from './onboarding-scope';

/*
 * Local end-to-end for the inviter's side (spec "E2E requirements": BR-27, BR-18, BR-30, BR-31, BR-32, BR-47): the
 * invite dialog, Resend, Copy link, Revoke, the status filter and the project admin's narrowed list. A dev-login handle
 * `h` signs in as the verified email `h@dev.local`, which is the address an invitation names.
 *
 * Every case makes its own handles and orgs with a random tag (users and orgs cannot be deleted, so nothing is
 * reused), one browser context per person, and closes every context it opened. An owner who entered the org by
 * invitation owns one accepted invitation of his own: where a case counts rows, that one is the "accepted" row.
 */

test.describe.configure({ timeout: 180_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

/** A scope whose people have a clipboard stub: this spec reads what "Copy link" wrote. */
const withScope = (body: (scope: Scope) => Promise<void>): Promise<void> => withSharedScope(body, { clipboard: true });

interface Setup {
  org: Org;
  context: BrowserContext;
  /** The owner's page, signed in. */
  page: Page;
  projects: ProjectDto[];
  /** Role display names by key, read from the platform roles endpoint. */
  roleNames: Record<RoleKey, string>;
}

/** Org O with an owner (handle `e2e-owner-<tag>`, signed in) and three projects P1, P2, P3. */
async function ownerOrg(scope: Scope, browser: Browser): Promise<Setup> {
  const org = await scope.org('o');
  const context = await scope.person(browser);
  const page = await context.newPage();
  await inviteAndSignIn(page, scope.pa, org.id, scope.handle('owner'), 'owner', { type: 'org' });
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
  const roles = z
    .array(PlatformRoleDto)
    .parse(await ok(await scope.pa.get(`/api/platform/orgs/${org.id}/roles`), 200, 'platform roles'));
  const nameOf = (key: RoleKey): string => {
    const name = roles.find((r) => r.key === key)?.name;
    expect(name, `the org has a ${key} role with a name`).toBeTruthy();
    return name ?? '';
  };
  const roleNames = {
    owner: nameOf('owner'),
    admin: nameOf('admin'),
    member: nameOf('member'),
    viewer: nameOf('viewer'),
  };
  return { org, context, page, projects, roleNames };
}

const invitationsPath = (s: Setup) => `/o/${s.org.slug}/invitations`;

async function openInvitations(s: Setup, page: Page = s.page, query = ''): Promise<void> {
  await page.goto(`${invitationsPath(s)}${query}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Invitations' })).toBeVisible();
}

const inviteDialog = (page: Page) => page.getByRole('dialog', { name: 'Invite people' });
const createdDialog = (page: Page) => page.getByRole('dialog', { name: 'Invitation created' });
const rowOf = (page: Page, email: string) => page.getByRole('row').filter({ hasText: email });
const bodyRows = (page: Page) => page.locator('tbody tr');
const chip = (page: Page, label: string) =>
  page.getByRole('group', { name: 'Filter by status' }).getByRole('button', { name: label, exact: true });
const cell = (row: Locator, index: number) => row.getByRole('cell').nth(index);

/**
 * A success (green) toast: the Toast component gives every non-error tone role "status" and the error tone role
 * "alert", so a red toast with the same title is not found here.
 */
const okToast = (page: Page, title: string | RegExp): Locator => page.getByRole('status').filter({ hasText: title });
const ACCESS = 2;
const STATUS = 3;
const EXPIRES = 4;

type InviteAccess = { kind: 'org' } | { kind: 'projects'; names: string[] };

/** Opens the invite dialog, fills it and presses "Create invitation"; ends on the "Invitation created" dialog. */
async function fillAndCreate(page: Page, email: string, roleName: string, access: InviteAccess): Promise<void> {
  await page.getByRole('button', { name: 'Invite people' }).first().click();
  const dialog = inviteDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByLabel('Role').selectOption({ label: roleName });
  if (access.kind === 'org') {
    await dialog.getByRole('radio', { name: 'Whole organization' }).check();
  } else {
    await dialog.getByRole('radio', { name: 'Some projects' }).check();
    for (const name of access.names) await dialog.getByRole('checkbox', { name, exact: true }).check();
  }
  await dialog.getByRole('button', { name: 'Create invitation' }).click();
  await expect(createdDialog(page)).toBeVisible();
}

/** The link in the "Invitation link" field of the "Invitation created" dialog. */
async function linkInDialog(page: Page): Promise<string> {
  const field = createdDialog(page).getByLabel('Invitation link');
  await expect(field).toContainText('/invitations/');
  return ((await field.textContent()) ?? '').trim();
}

/** Drives the invite dialog (on the Invitations page), reads the link from its field, presses Done; returns the link. */
async function inviteByUi(page: Page, email: string, roleName: string, access: InviteAccess): Promise<string> {
  await fillAndCreate(page, email, roleName, access);
  const link = await linkInDialog(page);
  await createdDialog(page).getByRole('button', { name: 'Done', exact: true }).click();
  await expect(createdDialog(page)).toHaveCount(0);
  await expect(rowOf(page, email)).toBeVisible();
  return link;
}

/** A row's expiry: the machine-readable instant of its `<time>`. */
async function expiryOf(row: Locator): Promise<Date> {
  const iso = await cell(row, EXPIRES).locator('time').first().getAttribute('datetime');
  expect(iso, 'the Expires cell has a datetime').toBeTruthy();
  return new Date(iso ?? '');
}

const HOUR = 3_600_000;

/** "About 2 days from now": within an hour of 48 hours. */
function expectAboutTwoDaysOut(expiry: Date): void {
  const left = expiry.getTime() - Date.now();
  expect(left, `expiry ${expiry.toISOString()} is about 2 days out`).toBeGreaterThan(47 * HOUR);
  expect(left).toBeLessThan(49 * HOUR);
}

/** "23 Nov 2026, 14:05" (the hover date) as the toast and dialog write it: "23 Nov, 14:05". */
const withoutYear = (full: string): string => full.replace(/ \d{4},/, ',');

async function copiedText(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { __copied?: string }).__copied ?? '');
}

async function openRowMenu(page: Page, email: string): Promise<void> {
  await page.getByRole('button', { name: `Actions for ${email}` }).click();
}

test('TC-27.1: inviting to some projects shows the link, then lists a Pending row naming P1 and P2 expiring in about 2 days', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const s = await ownerOrg(scope, browser);
    const [p1, p2, p3] = s.projects;
    const email = scope.email('invitee');
    await openInvitations(s);

    await fillAndCreate(s.page, email, s.roleNames.member, {
      kind: 'projects',
      names: [p1?.name ?? '', p2?.name ?? ''],
    });
    const dialog = createdDialog(s.page);
    await expect(
      dialog.getByText(new RegExp(`^Send this link to ${email}\\. It works only for that email and expires on .+\\.$`)),
    ).toBeVisible();
    await expect(dialog.getByLabel('Invitation link')).toContainText(`${new URL(s.page.url()).origin}/invitations/`);
    await expect(dialog.getByRole('button', { name: 'Copy link' })).toBeVisible();
    const shownDate = (await dialog.getByText(/^Send this link to/).textContent())?.match(/expires on (.+)\.$/)?.[1];

    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    const row = rowOf(s.page, email);
    await expect(row).toBeVisible();
    await expect(cell(row, STATUS)).toHaveText('Pending');
    const access = ((await cell(row, ACCESS).textContent()) ?? '')
      .split(', ')
      .map((n) => n.trim())
      .sort();
    expect(access).toEqual([p1?.name ?? '', p2?.name ?? ''].sort());
    expect(access).not.toContain(p3?.name ?? '');
    expectAboutTwoDaysOut(await expiryOf(row));
    const hover = await cell(row, EXPIRES).locator('time').first().getAttribute('title');
    expect(withoutYear(hover ?? '')).toBe(shownDate);
  });
});

test('TC-27.2: inviting the whole organization shows the link and lists a Pending row with Access "Whole organization"', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const s = await ownerOrg(scope, browser);
    const email = scope.email('invitee');
    await openInvitations(s);

    await fillAndCreate(s.page, email, s.roleNames.viewer, { kind: 'org' });
    const link = await linkInDialog(s.page);
    expect(link).toMatch(/\/invitations\/[0-9a-f-]{36}$/);
    await createdDialog(s.page).getByRole('button', { name: 'Done', exact: true }).click();

    const row = rowOf(s.page, email);
    await expect(row).toBeVisible();
    await expect(cell(row, STATUS)).toHaveText('Pending');
    await expect(cell(row, ACCESS)).toHaveText('Whole organization');
  });
});

test('TC-27.3: Cancel closes the invite dialog and adds no invitation', async ({ browser }) => {
  await withScope(async (scope) => {
    const s = await ownerOrg(scope, browser);
    await openInvitations(s);
    // The owner's own accepted invitation is under "All"; nothing else exists.
    await chip(s.page, 'All').click();
    await expect(bodyRows(s.page)).toHaveCount(1);

    await s.page.getByRole('button', { name: 'Invite people' }).first().click();
    await expect(inviteDialog(s.page)).toBeVisible();
    await inviteDialog(s.page).getByRole('button', { name: 'Cancel' }).click();

    await expect(inviteDialog(s.page)).toHaveCount(0);
    await expect(createdDialog(s.page)).toHaveCount(0);
    await expect(bodyRows(s.page)).toHaveCount(1);
    await s.page.reload();
    await expect(s.page.getByRole('heading', { level: 1, name: 'Invitations' })).toBeVisible();
    await expect(bodyRows(s.page)).toHaveCount(1);
    const listed = await s.context.request.get(`/api/orgs/${s.org.id}/invitations?status=all&pageSize=100`);
    expect(z.object({ total: z.number() }).parse(await ok(listed, 200, 'list invitations')).total).toBe(1);
  });
});

test('TC-18.1: Resend shows the renewed toast and a Pending row that expires about 2 days out, later than before', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const s = await ownerOrg(scope, browser);
    const email = scope.email('invitee');
    await openInvitations(s);
    await inviteByUi(s.page, email, s.roleNames.member, { kind: 'org' });
    const row = rowOf(s.page, email);
    const before = await expiryOf(row);
    const labelBefore = await cell(row, EXPIRES).locator('time').first().innerText();

    await openRowMenu(s.page, email);
    await s.page.getByRole('button', { name: 'Resend', exact: true }).click();

    const toast = okToast(s.page, /^Invitation renewed\. It now expires on .+\.$/);
    await expect(toast).toBeVisible();
    await expect.poll(async () => (await expiryOf(row)).getTime()).toBeGreaterThan(before.getTime());
    await expect(cell(row, STATUS)).toHaveText('Pending');
    const after = await expiryOf(row);
    expectAboutTwoDaysOut(after);
    const labelAfter = await cell(row, EXPIRES).locator('time').first().innerText();
    expect(labelAfter).toMatch(/^Expires in /);
    expect(labelBefore).toMatch(/^Expires in /);
    const hover = await cell(row, EXPIRES).locator('time').first().getAttribute('title');
    const toastDate = (await toast.textContent())?.match(/expires on (.+)\.$/)?.[1];
    expect(withoutYear(hover ?? '')).toBe(toastDate);
  });
});

test('TC-18.2: after Resend, Copy link copies the same link L', async ({ browser }) => {
  await withScope(async (scope) => {
    const s = await ownerOrg(scope, browser);
    const email = scope.email('invitee');
    await openInvitations(s);
    const link = await inviteByUi(s.page, email, s.roleNames.member, { kind: 'org' });
    const row = rowOf(s.page, email);
    const before = await expiryOf(row);
    await openRowMenu(s.page, email);
    await s.page.getByRole('button', { name: 'Resend', exact: true }).click();
    await expect(okToast(s.page, /^Invitation renewed\. It now expires on .+\.$/)).toBeVisible();
    await expect.poll(async () => (await expiryOf(row)).getTime()).toBeGreaterThan(before.getTime());

    await openRowMenu(s.page, email);
    await s.page.getByRole('button', { name: 'Copy link', exact: true }).click();

    await expect.poll(() => copiedText(s.page)).not.toBe('');
    expect(await copiedText(s.page)).toBe(link);
  });
});

/**
 * Pending and revoked invitations (and, unless `withDeclined` is false, a declined one) next to the owner's own accepted
 * one: one row per status.
 */
async function seedStatuses(
  scope: Scope,
  browser: Browser,
  s: Setup,
  withDeclined = true,
): Promise<Record<string, string>> {
  const emails = {
    pending: scope.email('pending'),
    declined: scope.email('declined'),
    revoked: scope.email('revoked'),
    accepted: scope.email('owner'),
  };
  await inviteViaApi(s.context.request, s.org.id, emails.pending, 'member', { type: 'org' }, 'tenant');
  if (withDeclined) {
    const declined = await inviteViaApi(
      s.context.request,
      s.org.id,
      emails.declined,
      'member',
      { type: 'org' },
      'tenant',
    );
    const decliner = await signInAs(await scope.person(browser), scope.handle('declined'));
    await ok(await decliner.request.post(`/api/me/invitations/${declined.id}/decline`), 204, 'decline invitation');
  }
  const revoked = await inviteViaApi(s.context.request, s.org.id, emails.revoked, 'member', { type: 'org' }, 'tenant');
  await ok(await s.context.request.delete(`/api/orgs/${s.org.id}/invitations/${revoked.id}`), 204, 'revoke invitation');
  return emails;
}

test('TC-30.1: the Invitations page opens on Pending: no status in the URL, only the pending row, with its columns', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const s = await ownerOrg(scope, browser);
    const emails = await seedStatuses(scope, browser, s, false);

    await openInvitations(s);

    expect(new URL(s.page.url()).searchParams.has('status')).toBe(false);
    await expect(chip(s.page, 'Pending')).toHaveAttribute('aria-pressed', 'true');
    await expect(chip(s.page, 'All')).toHaveAttribute('aria-pressed', 'false');
    await expect(rowOf(s.page, emails.pending ?? '')).toBeVisible();
    await expect(bodyRows(s.page)).toHaveCount(1);
    await expect(cell(rowOf(s.page, emails.pending ?? ''), STATUS)).toHaveText('Pending');
    const headers = await s.page.getByRole('columnheader').allInnerTexts();
    expect(headers.slice(0, 5).map((h) => h.trim())).toEqual(['Email', 'Role', 'Access', 'Status', 'Expires']);
  });
});

test('TC-31.1: a project admin of P1 sees only the invitation on P1', async ({ browser }) => {
  await withScope(async (scope) => {
    const s = await ownerOrg(scope, browser);
    const [p1, p2] = s.projects;
    const ids = (...ps: (ProjectDto | undefined)[]) => ps.map((p) => p?.id ?? '');
    const scopes: Record<string, InviteScope> = {
      onlyP1: { type: 'project', projectIds: ids(p1) },
      onlyP2: { type: 'project', projectIds: ids(p2) },
      both: { type: 'project', projectIds: ids(p1, p2) },
      whole: { type: 'org' },
    };
    for (const [who, inviteScope] of Object.entries(scopes)) {
      await inviteViaApi(s.context.request, s.org.id, scope.email(who), 'member', inviteScope, 'tenant');
    }
    // The project admin: a member of P1 who is then granted admin on P1 (the slice 1 grant helper).
    const adminPage = await (await scope.person(browser)).newPage();
    const { userId } = await inviteAndSignIn(adminPage, scope.pa, s.org.id, scope.handle('padmin'), 'member', {
      type: 'project',
      projectIds: ids(p1),
    });
    await grant(scope.pa, s.org.id, userId, 'admin', { type: 'project', projectId: p1?.id ?? '' });

    await openInvitations(s, adminPage);

    await expect(rowOf(adminPage, scope.email('onlyP1'))).toBeVisible();
    await expect(bodyRows(adminPage)).toHaveCount(1);
    for (const hidden of ['onlyP2', 'both', 'whole']) {
      await expect(rowOf(adminPage, scope.email(hidden))).toHaveCount(0);
    }
  });
});

test('TC-32.1: Revoke shows the toast, the row is Revoked under All, and the invitee link says it was revoked', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const s = await ownerOrg(scope, browser);
    const email = scope.email('invitee');
    await openInvitations(s);
    const link = await inviteByUi(s.page, email, s.roleNames.member, { kind: 'org' });
    // The invitee signs in while the invitation is pending, so they have an account.
    const invitee = await signInAs(await scope.person(browser), scope.handle('invitee'), new URL(link).pathname);
    await expect(invitee.getByRole('heading', { level: 1, name: `Join ${s.org.name}` })).toBeVisible();

    await openRowMenu(s.page, email);
    await s.page.getByRole('button', { name: 'Revoke', exact: true }).click();
    const dialog = s.page.getByRole('dialog', { name: `Revoke invitation for ${email}?` });
    await expect(dialog.getByText('The link stops working.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Revoke', exact: true }).click();

    await expect(okToast(s.page, /^Invitation revoked$/)).toBeVisible();
    await chip(s.page, 'All').click();
    await expect(s.page).toHaveURL(/[?&]status=all\b/);
    await expect(cell(rowOf(s.page, email), STATUS)).toHaveText('Revoked');

    await invitee.goto(new URL(link).pathname);
    await expect(invitee.getByRole('heading', { level: 1, name: 'This invitation was revoked' })).toBeVisible();
    await expect(invitee.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0);
  });
});

test('TC-32.2: Cancel in the revoke dialog leaves the row Pending', async ({ browser }) => {
  await withScope(async (scope) => {
    const s = await ownerOrg(scope, browser);
    const email = scope.email('invitee');
    await openInvitations(s);
    await inviteByUi(s.page, email, s.roleNames.member, { kind: 'org' });

    await openRowMenu(s.page, email);
    await s.page.getByRole('button', { name: 'Revoke', exact: true }).click();
    const dialog = s.page.getByRole('dialog', { name: `Revoke invitation for ${email}?` });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await expect(dialog).toHaveCount(0);
    await expect(cell(rowOf(s.page, email), STATUS)).toHaveText('Pending');
    await s.page.reload();
    await expect(cell(rowOf(s.page, email), STATUS)).toHaveText('Pending');
  });
});

test('TC-47.1: each status chip shows only its row, "?status=" follows the chip and the page count follows the rows', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const s = await ownerOrg(scope, browser);
    const emails = await seedStatuses(scope, browser, s);
    await openInvitations(s);
    await expect(rowOf(s.page, emails.pending ?? '')).toBeVisible();

    const steps: [string, string, string | undefined][] = [
      ['Accepted', 'Accepted', 'accepted'],
      ['Declined', 'Declined', 'declined'],
      ['Revoked', 'Revoked', 'revoked'],
      ['Pending', 'Pending', undefined],
    ];
    for (const [label, statusText, param] of steps) {
      await chip(s.page, label).click();
      await expect(chip(s.page, label)).toHaveAttribute('aria-pressed', 'true');
      if (param) await expect(s.page).toHaveURL(new RegExp(`[?&]status=${param}\\b`));
      else await expect.poll(() => new URL(s.page.url()).searchParams.has('status')).toBe(false);
      const email = emails[label.toLowerCase()] ?? '';
      await expect(rowOf(s.page, email)).toBeVisible();
      await expect(cell(rowOf(s.page, email), STATUS)).toHaveText(statusText);
      await expect(bodyRows(s.page)).toHaveCount(1);
      // One row fits on one page: no pagination control (the count of pages is 1).
      await expect(s.page.getByRole('navigation', { name: 'Pagination' })).toHaveCount(0);
    }
  });
});

test('TC-47.2: the All chip shows all four rows, each with its status text', async ({ browser }) => {
  await withScope(async (scope) => {
    const s = await ownerOrg(scope, browser);
    const emails = await seedStatuses(scope, browser, s);
    await openInvitations(s);

    await chip(s.page, 'All').click();

    await expect(s.page).toHaveURL(/[?&]status=all\b/);
    await expect(chip(s.page, 'All')).toHaveAttribute('aria-pressed', 'true');
    await expect(bodyRows(s.page)).toHaveCount(4);
    for (const [status, text] of [
      ['pending', 'Pending'],
      ['accepted', 'Accepted'],
      ['declined', 'Declined'],
      ['revoked', 'Revoked'],
    ] as const) {
      await expect(cell(rowOf(s.page, emails[status] ?? ''), STATUS)).toHaveText(text);
    }
  });
});

test('TC-47.3: the Expired chip shows the empty state "No expired invitations"', async ({ browser }) => {
  await withScope(async (scope) => {
    const s = await ownerOrg(scope, browser);
    await seedStatuses(scope, browser, s);
    await openInvitations(s);

    await chip(s.page, 'Expired').click();

    await expect(s.page).toHaveURL(/[?&]status=expired\b/);
    await expect(s.page.getByRole('heading', { name: 'No expired invitations' })).toBeVisible();
    await expect(bodyRows(s.page)).toHaveCount(0);
  });
});

test('TC-47.4: Accepted shows "No accepted invitations" and All shows "No invitations yet" when there are none', async ({
  browser,
}) => {
  await withScope(async (scope) => {
    const s = await ownerOrg(scope, browser);
    const [p1, p2, p3] = s.projects;
    // An owner who joined by invitation always has an accepted one. A project admin sees only the invitations whose
    // every project they administer, so one whose own invitation is on P3 sees none of their own: pa1 administers P1
    // (a single pending invitation on P1 only), pa2 administers P2 (no invitation at all).
    await inviteViaApi(
      s.context.request,
      s.org.id,
      scope.email('onp1'),
      'member',
      { type: 'project', projectIds: [p1?.id ?? ''] },
      'tenant',
    );
    const admins: Record<string, Page> = {};
    for (const [who, project] of [
      ['pa1', p1],
      ['pa2', p2],
    ] as const) {
      const page = await (await scope.person(browser)).newPage();
      const { userId } = await inviteAndSignIn(page, scope.pa, s.org.id, scope.handle(who), 'member', {
        type: 'project',
        projectIds: [p3?.id ?? ''],
      });
      await grant(scope.pa, s.org.id, userId, 'admin', { type: 'project', projectId: project?.id ?? '' });
      admins[who] = page;
    }
    const pa1 = admins['pa1'];
    const pa2 = admins['pa2'];
    expect(pa1 && pa2).toBeTruthy();
    if (!pa1 || !pa2) return;

    await openInvitations(s, pa1);
    await expect(rowOf(pa1, scope.email('onp1'))).toBeVisible();
    await expect(bodyRows(pa1)).toHaveCount(1);
    await chip(pa1, 'Accepted').click();
    await expect(pa1).toHaveURL(/[?&]status=accepted\b/);
    await expect(pa1.getByRole('heading', { name: 'No accepted invitations' })).toBeVisible();
    await expect(bodyRows(pa1)).toHaveCount(0);

    await openInvitations(s, pa2);
    await expect(pa2.getByRole('heading', { name: 'No pending invitations' })).toBeVisible();
    await chip(pa2, 'All').click();
    await expect(pa2).toHaveURL(/[?&]status=all\b/);
    await expect(pa2.getByRole('heading', { name: 'No invitations yet' })).toBeVisible();
    await expect(bodyRows(pa2)).toHaveCount(0);
  });
});
