import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext, type BrowserContext, type Locator, type Page } from '@playwright/test';
import {
  API,
  allPlatformAdmins,
  asPlatformAdmin,
  createOrg,
  freshUser,
  grantPlatformAdmin,
  inviteAndSignIn,
  platformAdminContext,
} from './helpers';

/*
 * Local end-to-end for the Platform admins page (spec "E2E requirements": TC-5.2, TC-6.2, TC-8.1, TC-12.1, TC-13.1,
 * TC-15.2, TC-16.4). "admin" is `admin@dev.local`, seeded by the local stack start; its own entry is never revoked.
 * A fresh user is an `e2e-<rand>` user invited (viewer) into the org `beforeAll` creates; dev login marks it verified.
 * Rows are found by email, never by position. Every entry a case grants is revoked in `afterEach`, errors swallowed.
 */

test.describe.configure({ timeout: 120_000 });

const ADMINS = '/platform/admins';
const ADMIN_EMAIL = 'admin@dev.local';

let pa: APIRequestContext;
let orgId: string;
const toDispose: APIRequestContext[] = [];
const toClose: BrowserContext[] = [];
const toRevoke: string[] = [];
// Emails granted through the UI: the entry id is unknown until the grant lands, so they are resolved lazily.
const toRevokeEmails: string[] = [];

test.beforeAll(async ({ request: probe }) => {
  const ready = await probe.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
  pa = await asPlatformAdmin();
  const tag = randomBytes(4).toString('hex');
  orgId = (await createOrg(pa, `E2E PAU ${tag}`, `e2e-pau-${tag}`)).id;
});

test.afterEach(async () => {
  for (const id of toRevoke.splice(0)) await pa.delete(`/api/platform/admins/${id}`).catch(() => null);
  for (const email of toRevokeEmails.splice(0)) {
    if (email === ADMIN_EMAIL) continue;
    const entries = await allPlatformAdmins(pa).catch(() => []);
    for (const e of entries.filter((x) => x.email === email)) {
      await pa.delete(`/api/platform/admins/${e.id}`).catch(() => null);
    }
  }
  for (const ctx of toDispose.splice(0)) await ctx.dispose().catch(() => null);
  for (const ctx of toClose.splice(0)) await ctx.close().catch(() => null);
});

test.afterAll(async () => {
  await pa?.dispose().catch(() => null);
});

/** A fresh user (account, verified email, no org); its api context is disposed after the case. */
async function newUser() {
  const user = await freshUser(pa, orgId);
  toDispose.push(user.api);
  return user;
}

/** Grants `email` and registers the entry for the cleanup. */
async function grantFor(email: string) {
  const { entry } = await grantPlatformAdmin(pa, email);
  toRevoke.push(entry.id);
  return entry;
}

async function adminPage(browser: Parameters<typeof platformAdminContext>[0]): Promise<Page> {
  const context = await platformAdminContext(browser);
  toClose.push(context);
  return context.newPage();
}

const bodyRows = (page: Page): Locator => page.locator('tbody tr');
const rowOf = (page: Page, email: string): Locator => bodyRows(page).filter({ hasText: email });
const revokeOf = (page: Page, email: string): Locator =>
  page.getByRole('button', { name: `Revoke platform access for ${email}` });
const toastOf = (page: Page, text: string): Locator => page.getByRole('status').filter({ hasText: text });

/** Opens the admins page and pages forward until the row of `email` is shown. */
async function openAdmins(page: Page, email: string): Promise<void> {
  await page.goto(ADMINS);
  await expect(page.getByRole('heading', { name: 'Platform admins', level: 1 })).toBeVisible();
  await expect(bodyRows(page).first()).toBeVisible();
  const next = page.getByRole('navigation', { name: 'Pagination' }).getByRole('button', { name: 'Next', exact: true });
  for (let i = 0; i < 50 && (await rowOf(page, email).count()) === 0; i++) {
    if (!(await next.isEnabled())) break;
    await next.click();
  }
  await expect(rowOf(page, email)).toHaveCount(1);
}

async function entryOf(email: string) {
  const entry = (await allPlatformAdmins(pa)).find((e) => e.email === email);
  expect(entry, `${email} is not listed as a platform admin`).toBeTruthy();
  if (!entry) throw new Error(`${email} is not listed`);
  return entry;
}

test.describe('BR-5: the admins table', () => {
  test('TC-5.2: a fresh admin row shows name, email, handle, Added and admin@dev.local as Added by', async ({
    browser,
  }) => {
    const user = await newUser();
    const entry = await grantFor(user.email);
    const admin = await entryOf(ADMIN_EMAIL);
    const page = await adminPage(browser);

    await openAdmins(page, user.email);

    const cells = rowOf(page, user.email).getByRole('cell');
    await expect(cells.nth(0)).toContainText(entry.name ?? '');
    await expect(cells.nth(1)).toHaveText(user.email);
    await expect(cells.nth(2)).toHaveText(user.handle);
    await expect(cells.nth(3)).not.toHaveText('');
    await expect(cells.nth(3)).not.toHaveText('—');
    await expect(cells.nth(4)).toHaveText(admin.name ?? '');
    expect(entry.grantedBy?.handle).toBe('admin');
  });
});

test.describe('BR-6: the signed-in admin is tagged "You"', () => {
  test('TC-6.2: admin@dev.local is tagged "You", the fresh admin is not', async ({ browser }) => {
    const user = await newUser();
    await grantFor(user.email);
    const page = await adminPage(browser);

    await openAdmins(page, user.email);
    await expect(rowOf(page, user.email).getByText('You', { exact: true })).toHaveCount(0);

    await openAdmins(page, ADMIN_EMAIL);
    await expect(rowOf(page, ADMIN_EMAIL).getByText('You', { exact: true })).toBeVisible();
  });
});

test.describe('BR-8: adding a platform admin', () => {
  test('TC-8.1: Add closes the dialog, toasts "Platform admin added" and lists the new entry', async ({ browser }) => {
    const user = await newUser();
    toRevokeEmails.push(user.email);
    const page = await adminPage(browser);
    await page.goto(ADMINS);
    await expect(bodyRows(page).first()).toBeVisible();

    await page.getByRole('button', { name: 'Add platform admin' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add platform admin' });
    await dialog.getByLabel('Email').fill(user.email);
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();

    await expect(dialog).toHaveCount(0);
    await expect(toastOf(page, 'Platform admin added')).toBeVisible();
    await openAdmins(page, user.email);
  });
});

test.describe('BR-12: adding an existing admin', () => {
  test('TC-12.1: adding the same email again closes the dialog with no error and lists the user once', async ({
    browser,
  }) => {
    const user = await newUser();
    await grantFor(user.email);
    const page = await adminPage(browser);
    await page.goto(ADMINS);
    await expect(bodyRows(page).first()).toBeVisible();

    await page.getByRole('button', { name: 'Add platform admin' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add platform admin' });
    await dialog.getByLabel('Email').fill(user.email);
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('No account has this email yet.')).toHaveCount(0);
    await openAdmins(page, user.email);
    expect((await allPlatformAdmins(pa)).filter((e) => e.email === user.email)).toHaveLength(1);
  });
});

test.describe('BR-13: revoking another admin', () => {
  test('TC-13.1: confirming the dialog toasts "Platform admin revoked" and removes the row', async ({ browser }) => {
    const user = await newUser();
    const entry = await grantFor(user.email);
    const page = await adminPage(browser);
    await openAdmins(page, user.email);

    await revokeOf(page, user.email).click();
    const dialog = page.getByRole('dialog', { name: `Revoke platform access for ${entry.name ?? user.email}?` });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Revoke', exact: true }).click();

    await expect(toastOf(page, 'Platform admin revoked')).toBeVisible();
    await expect(rowOf(page, user.email)).toHaveCount(0);
  });
});

test.describe('BR-15: revoking your own platform access', () => {
  test('TC-15.2: the browser lands on /, the org menu loses "Platform admin" and /platform/orgs is forbidden', async ({
    browser,
  }) => {
    // A member of the org (so there is an org menu), then granted platform admin by email.
    const handle = `e2e-${randomBytes(4).toString('hex')}`;
    const context = await browser.newContext();
    toClose.push(context);
    const page = await context.newPage();
    await inviteAndSignIn(page, pa, orgId, handle, 'viewer', { type: 'org' });
    const email = `${handle}@dev.local`;
    await grantFor(email);

    await openAdmins(page, email);
    await expect(rowOf(page, email).getByText('You', { exact: true })).toBeVisible();
    await revokeOf(page, email).click();
    const dialog = page.getByRole('dialog', { name: 'Revoke your own platform access?' });
    await dialog.getByRole('button', { name: 'Revoke', exact: true }).click();

    // `/` hands over to the active org's projects, so the browser has left /platform.
    await expect(page).toHaveURL(/^[^?#]*?\/(o\/[^/]+\/projects)?$/);
    await expect(page).not.toHaveURL(/\/platform/);
    await page.getByRole('button', { name: /^(Switch organization|Organization menu)/ }).click();
    const orgs = page.getByRole('dialog', { name: 'Organizations' });
    await expect(orgs).toBeVisible();
    await expect(orgs.getByText('Platform admin')).toHaveCount(0);

    await page.goto('/platform/orgs');
    await expect(page.getByText("You don't have access", { exact: true })).toBeVisible();
  });
});

test.describe('BR-16: the last working admin cannot be revoked', () => {
  test('TC-16.4: with two working admins "Revoke" is enabled on both rows', async ({ browser }) => {
    const user = await newUser();
    await grantFor(user.email);
    const page = await adminPage(browser);

    await openAdmins(page, user.email);
    await expect(revokeOf(page, user.email)).toBeEnabled();
    await openAdmins(page, ADMIN_EMAIL);
    await expect(revokeOf(page, ADMIN_EMAIL)).toBeEnabled();
  });
});
