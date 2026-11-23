import { randomBytes, randomInt } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { ProjectDto } from '@agentdesk/contracts';
import { API, CommentResult, ok, runOf, signInAs, waitForStatus } from './helpers';
import { REPO_P1, buildCast, disposeCast, type Actor, type Cast } from './rbac-cast';
import { freshOrgMember } from './project-admin';

/*
 * Local end-to-end for the project admin's Members page (spec "E2E requirements": BR-4, BR-5, BR-7, BR-13). A is the
 * admin of P1 only, B and C are members of P1, O the owner, V the org viewer, D the org admin (`buildCast`); every case
 * runs in a fresh org. The people a case adds to P1 (D, E) are built inside the case as members of P2 only, each in its
 * own browser context (`freshOrgMember`), and closed in a `finally`. In the cast a dev-login person's name is their
 * handle, so a row, a picker option or a toast names the handle.
 */

test.describe.configure({ timeout: 300_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

let cast: Cast;
/** The cast to dispose: unset until a build succeeded, and again after its disposal, so a failed build never disposes a stale one. */
let built: Cast | undefined;

test.beforeEach(async ({ browser }) => {
  built = undefined;
  built = await buildCast(browser);
  cast = built;
});

test.afterEach(async () => {
  const done = built;
  built = undefined;
  if (done) await disposeCast(done);
});

/** Cleanup that never masks the failure of the test it runs after. */
async function quietly(action: () => Promise<unknown>): Promise<void> {
  await action().catch(() => null);
}

/** The cast's org name: `buildCast` creates the org as `RBAC <tag>` with the slug `rbac-<tag>`. */
const orgName = (): string => `RBAC ${cast.slug.slice('rbac-'.length)}`;

const membersHeading = (page: Page): Locator => page.getByRole('heading', { level: 1, name: 'Members' });
const rowOf = (page: Page, handle: string): Locator => page.getByRole('row').filter({ hasText: handle });
const roleCell = (row: Locator): Locator => row.getByRole('cell').nth(1);
const okToast = (page: Page, title: string): Locator => page.getByRole('status').filter({ hasText: title });
const runsUrl = (): string => `/o/${cast.slug}/p/${cast.p1}/runs`;

/** Opens P1 → Settings → Members through the Settings tab and the Desk side menu. */
async function openMembers(who: Actor): Promise<void> {
  await who.page.goto(runsUrl());
  await who.page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings', exact: true }).click();
  await who.page.getByRole('navigation', { name: 'Desk' }).getByRole('link', { name: 'Members' }).click();
  await expect(membersHeading(who.page)).toBeVisible();
}

async function reloadMembers(who: Actor): Promise<void> {
  await who.page.reload();
  await expect(membersHeading(who.page)).toBeVisible();
}

const addDialog = (page: Page): Locator => page.getByRole('dialog', { name: /^Add member to/ });
const personBox = (page: Page): Locator => addDialog(page).getByRole('combobox', { name: 'Person' });

async function openAddDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Add member' }).first().click();
  await expect(addDialog(page)).toBeVisible();
}

/** On the open Members page: Add member, pick `handle` in Person, pick the `role` card, save; ends on the success toast. */
async function addViaDialog(page: Page, handle: string, role: 'Admin' | 'Member' | 'Viewer'): Promise<void> {
  await openAddDialog(page);
  await personBox(page).click();
  await page.getByRole('option').filter({ hasText: handle }).first().click();
  await addDialog(page)
    .getByRole('radiogroup', { name: 'Role' })
    .getByRole('radio', { name: new RegExp(`^${role}`) })
    .check({ force: true });
  await addDialog(page).getByRole('button', { name: 'Add member' }).click();
  await expect(okToast(page, `${handle} added as ${role}`)).toBeVisible();
}

/** Starts `/rbac-run` on a new pull request of P1's repo as `who` and waits until the run is idle; returns its id. */
async function startRunOnP1(who: Actor, onStarted: (runId: string) => void): Promise<string> {
  const ticketNumber = randomInt(100_000, 1_000_000_000);
  await ok(
    await who.api.post('/dev/fake/tickets', {
      data: { repoPath: REPO_P1, number: ticketNumber, kind: 'pr', title: `rbac ${who.handle}` },
    }),
    201,
    'fake ticket',
  );
  const comment = CommentResult.parse(
    await ok(
      await who.api.post('/dev/fake/comments', {
        data: {
          repoPath: REPO_P1,
          ticketNumber,
          body: '/rbac-run',
          deliver: 'webhook',
          projectId: cast.p1,
          author: who.handle,
        },
      }),
      201,
      'fake comment',
    ),
  );
  expect(comment.runId, `comment outcome ${comment.outcome}`).toBeTruthy();
  const runId = comment.runId ?? '';
  onStarted(runId);
  await waitForStatus(who.page, runId, 'idle', 90_000);
  return runId;
}

/** A cast project's name, for its link on the projects page. */
async function nameOf(projectId: string): Promise<string> {
  return ProjectDto.parse(await ok(await cast.o.api.get(`/api/projects/${projectId}`), 200, 'project')).name;
}

const createdDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Invitation created' });

/** On the open Members page: Invite people, a new email as Viewer, Create invitation, Done; returns the invitation id. */
async function inviteViewer(page: Page, email: string): Promise<string> {
  await page.getByRole('button', { name: 'Invite people' }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite people' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Email' }).fill(email);
  await dialog.getByRole('combobox', { name: 'Role' }).selectOption({ label: 'Viewer' });
  await dialog.getByRole('button', { name: 'Create invitation' }).click();
  await expect(createdDialog(page)).toBeVisible();
  const field = createdDialog(page).getByLabel('Invitation link');
  await expect(field).toContainText('/invitations/');
  const link = ((await field.textContent()) ?? '').trim();
  const id = link.split('/invitations/')[1] ?? '';
  expect(id, `invitation id in the link ${link}`).not.toBe('');
  await createdDialog(page).getByRole('button', { name: 'Done', exact: true }).click();
  await expect(createdDialog(page)).toHaveCount(0);
  return id;
}

test.describe('BR-4: Members lists only people with a project role', () => {
  test('TC-4.4: A opens P1 → Settings → Members and sees B, C and A (You) with their roles and the intro note', async () => {
    const { a, b, c } = cast;
    await openMembers(a);
    await expect(
      a.page.getByText(`People with a role on this project. A role in ${orgName()} also applies here.`),
    ).toBeVisible();
    await expect(roleCell(rowOf(a.page, b.handle))).toHaveText('Member');
    await expect(roleCell(rowOf(a.page, c.handle))).toHaveText('Member');
    await expect(roleCell(rowOf(a.page, a.handle))).toHaveText('Admin');
    await expect(rowOf(a.page, a.handle).getByText('You', { exact: true })).toBeVisible();
    await expect(rowOf(a.page, b.handle).getByText('You', { exact: true })).toHaveCount(0);
  });

  test('TC-4.5: O (org-scope role only), D and V (org roles only) do not appear on P1 Members', async () => {
    const { a, b, c, o, d, v } = cast;
    await openMembers(a);
    // The list is loaded: the people with a P1 role are there, so the absences below are not an unrendered table.
    await expect(rowOf(a.page, b.handle)).toBeVisible();
    await expect(rowOf(a.page, c.handle)).toBeVisible();
    await expect(rowOf(a.page, a.handle)).toBeVisible();
    for (const person of [o, v, d]) {
      await expect(a.page.getByRole('table')).not.toContainText(person.handle);
    }
  });

  test('TC-4.6: O opens P1 Members and sees the same project-role people as A: A, B and C', async () => {
    const { o, a, b, c, d, v } = cast;
    await openMembers(o);
    await expect(
      o.page.getByText(`People with a role on this project. A role in ${orgName()} also applies here.`),
    ).toBeVisible();
    await expect(roleCell(rowOf(o.page, a.handle))).toHaveText('Admin');
    await expect(roleCell(rowOf(o.page, b.handle))).toHaveText('Member');
    await expect(roleCell(rowOf(o.page, c.handle))).toHaveText('Member');
    await expect(o.page.locator('tbody tr')).toHaveCount(3);
    for (const person of [o, v, d]) {
      await expect(o.page.getByRole('table')).not.toContainText(person.handle);
    }
  });
});

test.describe('BR-5: A adds an org member to P1', () => {
  test('TC-5.1: A adds D (a P2-only member) as Member; the toast shows and D is a Member row after a reload', async () => {
    const { a } = cast;
    const d = await freshOrgMember(cast, 'member', { type: 'project', projectId: cast.p2 });
    try {
      await openMembers(a);
      await expect(rowOf(a.page, d.handle)).toHaveCount(0);
      await addViaDialog(a.page, d.handle, 'Member');
      await reloadMembers(a);
      await expect(roleCell(rowOf(a.page, d.handle))).toHaveText('Member');
    } finally {
      await quietly(() => d.ctx.close());
    }
  });

  test('TC-5.2: D added as Member sees P1 in the project list on the next load, opens its runs, and has Cancel run on a run of their own', async () => {
    const { a, o, rb } = cast;
    const d = await freshOrgMember(cast, 'member', { type: 'project', projectId: cast.p2 });
    let runId: string | undefined;
    try {
      const name = await nameOf(cast.p1);
      const name2 = await nameOf(cast.p2);
      const projects = `/o/${cast.slug}/projects`;
      // Before: D reads the project list; P2 is there and P1 is not.
      await d.page.goto(projects);
      await expect(d.page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
      await expect(d.page.getByRole('link', { name: name2, exact: true })).toBeVisible();
      await expect(d.page.getByRole('link', { name, exact: true })).toHaveCount(0);

      await openMembers(a);
      await addViaDialog(a.page, d.handle, 'Member');

      // D's next load: P1 is in the list and opens with its runs.
      await d.page.goto(projects);
      await expect(d.page.getByRole('link', { name, exact: true })).toBeVisible();
      const rbRun = await runOf(d.page, rb);
      await d.page.goto(runsUrl());
      await expect(d.page.locator(`a[href="${runsUrl()}/${rbRun.number}"]`).first()).toBeVisible();

      // A Member cancels the runs they own (run:cancel is `own`): D starts a run on P1, its page offers Cancel run.
      const started = await startRunOnP1(d, (id) => {
        runId = id;
      });
      const own = await runOf(d.page, started);
      expect(own.ownerUserId, 'the run is D’s').toBe(d.userId);
      await d.page.goto(`${runsUrl()}/${own.number}`);
      await expect(d.page.getByText('Triggered by')).toBeVisible();
      await expect(d.page.getByRole('button', { name: 'Cancel run' })).toBeVisible();
    } finally {
      if (runId) {
        const id = runId;
        await quietly(() => o.api.post(`/api/runs/${id}/cancel`));
      }
      await quietly(() => d.ctx.close());
    }
  });

  test('TC-5.3: D added as Viewer is a Viewer row after a reload, sees P1 and its runs, and has no Cancel run', async () => {
    const { a, o, rb } = cast;
    const d = await freshOrgMember(cast, 'member', { type: 'project', projectId: cast.p2 });
    try {
      await openMembers(a);
      await addViaDialog(a.page, d.handle, 'Viewer');
      await reloadMembers(a);
      await expect(roleCell(rowOf(a.page, d.handle))).toHaveText('Viewer');

      const run = await runOf(d.page, rb);
      const runUrl = `${runsUrl()}/${run.number}`;
      // Control: the owner sees Cancel run on this run, so its absence for D is a real difference.
      await o.page.goto(runUrl);
      await expect(o.page.getByRole('button', { name: 'Cancel run' })).toBeVisible();

      await d.page.goto(runsUrl());
      await expect(d.page.locator(`a[href="${runUrl}"]`).first()).toBeVisible();
      await d.page.goto(runUrl);
      await expect(d.page.getByText('Triggered by')).toBeVisible();
      await expect(d.page.getByRole('button', { name: 'Cancel run' })).toHaveCount(0);
    } finally {
      await quietly(() => d.ctx.close());
    }
  });

  test('TC-5.4: D added as Admin is an Admin row after a reload and sees the Settings tab with Members and Audit log', async () => {
    const { a } = cast;
    const d = await freshOrgMember(cast, 'member', { type: 'project', projectId: cast.p2 });
    try {
      await openMembers(a);
      await addViaDialog(a.page, d.handle, 'Admin');
      await reloadMembers(a);
      await expect(roleCell(rowOf(a.page, d.handle))).toHaveText('Admin');

      await d.page.goto(runsUrl());
      await d.page
        .getByRole('navigation', { name: 'Main' })
        .getByRole('link', { name: 'Settings', exact: true })
        .click();
      const menu = d.page.getByRole('navigation', { name: 'Desk' });
      await expect(menu.getByRole('link', { name: 'Members' })).toBeVisible();
      await expect(menu.getByRole('link', { name: 'Audit log' })).toBeVisible();
    } finally {
      await quietly(() => d.ctx.close());
    }
  });
});

test.describe('BR-7: the Person picker', () => {
  test('TC-7.12: A opens Add member; the Person list contains E (no P1 role) and not C (holds a P1 role)', async () => {
    const { a, c } = cast;
    const e = await freshOrgMember(cast, 'member', { type: 'project', projectId: cast.p2 });
    try {
      await openMembers(a);
      await openAddDialog(a.page);
      await personBox(a.page).click();
      const options = a.page.getByRole('option');
      // The list is loaded once E is offered; only then is C's absence a result.
      await expect(options.filter({ hasText: e.handle })).toBeVisible();
      await expect(options.filter({ hasText: c.handle })).toHaveCount(0);
    } finally {
      await quietly(() => e.ctx.close());
    }
  });
});

test.describe('BR-13: Invite people from Members', () => {
  test('TC-13.4: A invites a new email as Viewer from Members; the invitation shows under org Settings → Invitations', async () => {
    const { a, orgId } = cast;
    const handle = `e2e-${randomBytes(4).toString('hex')}`;
    const email = `${handle}@dev.local`;
    let invitationId: string | undefined;
    try {
      await openMembers(a);
      invitationId = await inviteViewer(a.page, email);
      await a.page.goto(`/o/${cast.slug}/settings/invitations`);
      await expect(a.page.getByRole('row').filter({ hasText: email })).toBeVisible();
    } finally {
      if (invitationId) {
        const id = invitationId;
        await quietly(() => a.api.delete(`/api/orgs/${orgId}/invitations/${id}`));
      }
    }
  });

  test('TC-13.5: the invitee accepts the link; A reloads P1 Members and the invitee shows with the invited role', async ({
    browser,
  }) => {
    const { a, orgId } = cast;
    const handle = `e2e-${randomBytes(4).toString('hex')}`;
    const email = `${handle}@dev.local`;
    const ctx = await browser.newContext();
    let invitationId: string | undefined;
    try {
      await openMembers(a);
      invitationId = await inviteViewer(a.page, email);
      await reloadMembers(a);
      await expect(rowOf(a.page, handle)).toHaveCount(0);

      const page = await signInAs(ctx, handle, `/invitations/${invitationId}`);
      await page.getByRole('button', { name: 'Accept', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/o/${cast.slug}/projects$`));

      await reloadMembers(a);
      await expect(roleCell(rowOf(a.page, handle))).toHaveText('Viewer');
    } finally {
      if (invitationId) {
        const id = invitationId;
        await quietly(() => a.api.delete(`/api/orgs/${orgId}/invitations/${id}`));
      }
      await quietly(() => ctx.close());
    }
  });
});
