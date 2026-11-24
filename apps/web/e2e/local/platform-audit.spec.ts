import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext, type BrowserContext, type Locator, type Page } from '@playwright/test';
import {
  API,
  asPlatformAdmin,
  chooseAction,
  createOrg,
  grant,
  inviteAndSignIn,
  inviteViaApi,
  ok,
  platformAdminContext,
  platformAuditFor,
  reactivateOrg,
  revoke,
  suspendOrg,
} from './helpers';

/*
 * Local end-to-end for the platform audit log (spec 2026-11-23-platform-admin-dashboard-design.md "E2E requirements":
 * TC-44.1, TC-44.2, TC-45.5, TC-50.4, TC-60.1, TC-60.2; plus BR-45, the role in the gave, removed and invited
 * sentences, which is not a spec case). Every case makes fresh `e2e-<rand>` orgs (orgs cannot be
 * deleted) and asserts its entries through `/platform/audit?org=<fresh id>`, never by position in the global list
 * (TC-45.5 and TC-50.4 open the global list, whose newest entries are the ones the case just made). `afterEach`
 * reactivates every org a case suspends and renames edited orgs back, errors swallowed.
 */

test.describe.configure({ timeout: 300_000 });

const AUDIT = '/platform/audit';

let pa: APIRequestContext;
const toClose: BrowserContext[] = [];
const toReactivate: string[] = [];
const toRevoke: { orgId: string; invitationId: string }[] = [];
const toRestore: { id: string; name: string; slug: string }[] = [];

test.beforeAll(async ({ request: probe }) => {
  const ready = await probe.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
  pa = await asPlatformAdmin();
});

test.afterEach(async () => {
  for (const id of toReactivate.splice(0)) await reactivateOrg(pa, id, 'e2e cleanup').catch(() => null);
  for (const org of toRestore.splice(0).reverse()) {
    await pa.patch(`/api/platform/orgs/${org.id}`, { data: { name: org.name, slug: org.slug } }).catch(() => null);
  }
  for (const i of toRevoke.splice(0)) {
    await pa.delete(`/api/platform/orgs/${i.orgId}/invitations/${i.invitationId}`).catch(() => null);
  }
  for (const ctx of toClose.splice(0)) await ctx.close().catch(() => null);
});

test.afterAll(async () => {
  await pa?.dispose().catch(() => null);
});

const tagOf = (): string => randomBytes(4).toString('hex');
const bodyRows = (page: Page): Locator => page.locator('tbody tr');
const heading = (page: Page): Locator => page.getByRole('heading', { name: 'Audit log', level: 1 });

async function freshOrg(): Promise<{ id: string; name: string; slug: string }> {
  const slug = `e2e-${tagOf()}`;
  const name = `E2E ${slug}`;
  const org = await createOrg(pa, name, slug);
  const made = { id: org.id, name, slug };
  toRestore.push(made);
  return made;
}

async function adminPage(browser: Parameters<typeof platformAdminContext>[0]): Promise<Page> {
  const context = await platformAdminContext(browser);
  toClose.push(context);
  return context.newPage();
}

async function openAudit(page: Page, query = ''): Promise<void> {
  await page.goto(`${AUDIT}${query}`);
  await expect(heading(page)).toBeVisible();
}

test.describe('BR-44: one platform audit entry per successful platform write', () => {
  test('TC-44.1: suspend then reactivate shows the reactivate entry above the suspend entry for that org', async ({
    browser,
  }) => {
    const org = await freshOrg();
    toReactivate.push(org.id);
    await suspendOrg(pa, org.id, 'e2e first');
    await reactivateOrg(pa, org.id, 'e2e second');

    const mine = await adminPage(browser);
    await openAudit(mine, `?org=${org.id}`);
    await expect(bodyRows(mine).first()).toBeVisible();

    // Agent call: the org's own creation entry (BR-44 lists org create) is the oldest row, so "exactly two" is read as
    // exactly two suspend/reactivate entries, newest first, with the creation entry below them.
    await expect(bodyRows(mine)).toHaveCount(3);
    await expect(bodyRows(mine).nth(0)).toContainText(`reactivated ${org.name}`);
    await expect(bodyRows(mine).nth(1)).toContainText(`suspended ${org.name}`);
    await expect(bodyRows(mine).nth(2)).toContainText(`created ${org.name}`);
    await expect(bodyRows(mine).filter({ hasText: /suspended|reactivated/ })).toHaveCount(2);

    const entries = await platformAuditFor(pa, org.id);
    expect(entries.map((e) => e.action)).toEqual(['org.reactivated', 'org.suspended', 'org.created']);
  });

  test('TC-44.2: a suspend with an empty reason is refused and adds no suspend entry', async ({ browser }) => {
    const org = await freshOrg();
    const refused = await pa.post(`/api/platform/orgs/${org.id}/suspend`, { data: { reason: '' } });
    expect(refused.status(), await refused.text()).toBe(400);

    const mine = await adminPage(browser);
    await openAudit(mine, `?org=${org.id}`);
    await expect(bodyRows(mine).first()).toBeVisible();
    // Only the creation entry exists: no suspend entry.
    await expect(bodyRows(mine)).toHaveCount(1);
    await expect(bodyRows(mine).first()).toContainText(`created ${org.name}`);
    expect((await platformAuditFor(pa, org.id)).map((e) => e.action)).toEqual(['org.created']);
  });
});

test.describe('BR-45: the audit list', () => {
  test('TC-45.5: the list shows the suspend and reactivate entries with the reason as typed, and the Action select narrows it', async ({
    browser,
  }) => {
    const org = await freshOrg();
    toReactivate.push(org.id);
    const reason = `Invoice ${tagOf()}`;
    await suspendOrg(pa, org.id, reason);
    await reactivateOrg(pa, org.id, `${reason} paid`);

    const mine = await adminPage(browser);
    await openAudit(mine);
    const suspended = bodyRows(mine).filter({ hasText: `suspended ${org.name}` });
    const reactivated = bodyRows(mine).filter({ hasText: `reactivated ${org.name}` });
    await expect(suspended).toHaveCount(1);
    await expect(reactivated).toHaveCount(1);
    await expect(suspended).toContainText(`Reason: ${reason}`);
    await expect(reactivated).toContainText(`Reason: ${reason} paid`);

    await mine.getByRole('combobox', { name: 'Action' }).selectOption({ label: 'Organization suspended' });
    await expect(mine).toHaveURL(/[?&]action=org\.suspended(&|$)/);
    await expect(bodyRows(mine).filter({ hasText: `suspended ${org.name}` })).toHaveCount(1);
    await expect(bodyRows(mine).filter({ hasText: `reactivated ${org.name}` })).toHaveCount(0);
    await expect(bodyRows(mine).filter({ hasText: /reactivated/ })).toHaveCount(0);
  });
});

test.describe('BR-45: the sentences name the role', () => {
  test('BR-45: the gave, removed and invited sentences carry the role, read from the real API', async ({
    browser,
    page,
  }) => {
    const org = await freshOrg();
    const { userId } = await inviteAndSignIn(page, pa, org.id, org.slug, 'viewer', { type: 'org' });
    const members = await ok(await pa.get(`/api/platform/orgs/${org.id}/members?pageSize=100`), 200, 'members');
    const person = (members as { items: { userId: string; name: string }[] }).items.find((m) => m.userId === userId);
    const name = person?.name ?? '';
    expect(name).not.toBe('');
    const assignment = await grant(pa, org.id, userId, 'owner', { type: 'org' });
    await revoke(pa, org.id, assignment.id);
    const email = `e2e-${tagOf()}@dev.local`;
    const invitation = await inviteViaApi(pa, org.id, email, 'owner', { type: 'org' });
    toRevoke.push({ orgId: org.id, invitationId: invitation.id });

    const mine = await adminPage(browser);
    await openAudit(mine, `?org=${org.id}`);
    const sentence = (text: string): Locator => bodyRows(mine).locator('td:nth-child(3)').filter({ hasText: text });
    await expect(sentence(`gave ${name} the Owner role in ${org.name}`)).toHaveCount(1);
    await expect(sentence(`removed ${name}'s Owner role in ${org.name}`)).toHaveCount(1);
    await expect(sentence(`invited ${email} to ${org.name} as Owner`)).toHaveCount(1);
  });
});

test.describe('BR-50: "View audit log" from the org detail', () => {
  test('TC-50.4: the chip shows and is removable, and entries of other orgs show after removal', async ({
    browser,
  }) => {
    const org = await freshOrg();
    const other = await freshOrg();
    toReactivate.push(org.id, other.id);
    await suspendOrg(pa, other.id, 'e2e other');
    await suspendOrg(pa, org.id, 'e2e mine');

    const mine = await adminPage(browser);
    await mine.goto(`/platform/orgs/${org.id}`);
    await expect(mine.getByRole('heading', { name: org.name, level: 1 })).toBeVisible();
    await chooseAction(mine, 'View audit log');

    await expect(mine).toHaveURL(new RegExp(`${AUDIT}\\?org=${org.id}$`));
    await expect(heading(mine)).toBeVisible();
    await expect(mine.getByText(`Organization: ${org.name}`, { exact: true })).toBeVisible();
    await expect(bodyRows(mine).filter({ hasText: `suspended ${org.name}` })).toHaveCount(1);
    await expect(bodyRows(mine).filter({ hasText: other.name })).toHaveCount(0);

    await mine.getByRole('button', { name: `Remove filter Organization: ${org.name}` }).click();

    await expect(mine.getByText(`Organization: ${org.name}`)).toHaveCount(0);
    await expect(mine).not.toHaveURL(/org=/);
    await expect(bodyRows(mine).filter({ hasText: `suspended ${other.name}` })).toHaveCount(1);
  });
});

test.describe('BR-60: one platform audit entry for an edit', () => {
  test('TC-60.1: a rename and re-slug in one save shows one entry with the old and new name and URL', async ({
    browser,
  }) => {
    const org = await freshOrg();
    const newSlug = `e2e-new-${tagOf()}`;
    const newName = `E2E renamed ${newSlug}`;
    await ok(await pa.patch(`/api/platform/orgs/${org.id}`, { data: { name: newName, slug: newSlug } }), 200, 'edit');

    const mine = await adminPage(browser);
    await openAudit(mine, `?org=${org.id}`);
    const edit = bodyRows(mine).filter({ hasText: 'changed the name of' });
    await expect(edit).toHaveCount(1);
    await expect(edit.locator('td:nth-child(3)')).toContainText(
      `changed the name of ${newName} from ${org.name} to ${newName} and the URL from /o/${org.slug} to /o/${newSlug}`,
    );
    expect((await platformAuditFor(pa, org.id)).filter((e) => e.action === 'org.updated')).toHaveLength(1);
  });

  test('TC-60.2: a refused edit (invalid slug) leaves no edit entry', async ({ browser }) => {
    const org = await freshOrg();
    const refused = await pa.patch(`/api/platform/orgs/${org.id}`, { data: { slug: 'Not A Valid Slug!' } });
    expect(refused.status(), await refused.text()).toBe(400);

    const mine = await adminPage(browser);
    await openAudit(mine, `?org=${org.id}`);
    await expect(bodyRows(mine).first()).toBeVisible();
    await expect(bodyRows(mine).filter({ hasText: 'changed the' })).toHaveCount(0);
    expect((await platformAuditFor(pa, org.id)).filter((e) => e.action === 'org.updated')).toHaveLength(0);
  });
});
