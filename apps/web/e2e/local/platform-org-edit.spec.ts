import { randomBytes } from 'node:crypto';
import { PlatformOrgDetailDto } from '@agentdesk/contracts';
import { expect, test, type APIRequestContext, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { API, asPlatformAdmin, createOrg, inviteAndSignIn, ok, platformAdminContext } from './helpers';

/*
 * Local end-to-end for editing an organization from the platform org detail (spec 2026-11-23-platform-admin-dashboard-design.md
 * "E2E requirements": TC-53.3, TC-56.2, TC-58.1 to TC-58.3, TC-61.1). Every case makes fresh `e2e-<rand>` orgs (orgs
 * cannot be deleted). `afterEach` restores each org's original name and slug (errors swallowed); an org made on a freed
 * slug is first moved to a unique slug so the original can be restored.
 */

test.describe.configure({ timeout: 300_000 });

const ORGS = '/platform/orgs';

let pa: APIRequestContext;
const toClose: BrowserContext[] = [];
/** Orgs to restore: the id with the name and slug it was made with. */
const toRestore: { id: string; name: string; slug: string }[] = [];
/** Orgs created on a freed slug: moved to a unique slug before the restores run. */
const toFree: string[] = [];

test.beforeAll(async ({ request: probe }) => {
  const ready = await probe.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
  pa = await asPlatformAdmin();
});

test.afterEach(async () => {
  for (const id of toFree.splice(0)) {
    await pa.patch(`/api/platform/orgs/${id}`, { data: { slug: `e2e-free-${tagOf()}` } }).catch(() => null);
  }
  for (const org of toRestore.splice(0).reverse()) {
    await pa.patch(`/api/platform/orgs/${org.id}`, { data: { name: org.name, slug: org.slug } }).catch(() => null);
  }
  for (const ctx of toClose.splice(0)) await ctx.close().catch(() => null);
});

test.afterAll(async () => {
  await pa?.dispose().catch(() => null);
});

const tagOf = (): string => randomBytes(4).toString('hex');
const bodyRows = (page: Page): Locator => page.locator('tbody tr');
const header = (page: Page): Locator => page.getByRole('heading', { level: 1 }).locator('xpath=..');

/** A fresh org (restored in `afterEach`). */
async function freshOrg(): Promise<{ id: string; name: string; slug: string }> {
  const slug = `e2e-${tagOf()}`;
  const name = `E2E ${slug}`;
  const org = await createOrg(pa, name, slug);
  const made = { id: org.id, name, slug };
  toRestore.push(made);
  return made;
}

/** Edits the org over the platform route (exactly 200) and returns the saved detail. */
async function patchOrg(id: string, data: { name?: string; slug?: string }): Promise<PlatformOrgDetailDto> {
  return PlatformOrgDetailDto.parse(await ok(await pa.patch(`/api/platform/orgs/${id}`, { data }), 200, 'edit org'));
}

async function adminPage(browser: Parameters<typeof platformAdminContext>[0]): Promise<Page> {
  const context = await platformAdminContext(browser);
  toClose.push(context);
  return context.newPage();
}

async function openEdit(page: Page, orgId: string, name: string): Promise<Locator> {
  await page.goto(`${ORGS}/${orgId}`);
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Edit organization' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit organization' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('BR-53: edit the name and URL of an organization', () => {
  test('TC-53.3: after a name and URL edit, confirmed, the header and the directory row show the new values', async ({
    browser,
  }) => {
    const org = await freshOrg();
    const newSlug = `e2e-new-${tagOf()}`;
    const newName = `E2E renamed ${newSlug}`;
    const mine = await adminPage(browser);

    const dialog = await openEdit(mine, org.id, org.name);
    await dialog.getByRole('textbox', { name: 'Name' }).fill(newName);
    await dialog.getByRole('textbox', { name: 'URL' }).fill(newSlug);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await mine
      .getByRole('dialog', { name: 'Change the organization URL?' })
      .getByRole('button', { name: 'Change URL' })
      .click();

    await expect(mine.getByText('Organization updated', { exact: true })).toBeVisible();
    await expect(mine).toHaveURL(new RegExp(`${ORGS}/${org.id}$`));
    await expect(mine.getByRole('heading', { name: newName, level: 1 })).toBeVisible();
    await expect(header(mine).getByText(`/o/${newSlug}`)).toBeVisible();

    await mine.goto(ORGS);
    await expect(mine.getByRole('heading', { name: 'Organizations', level: 1 })).toBeVisible();
    await mine.getByRole('searchbox', { name: 'Search organizations' }).fill(newSlug);
    const row = bodyRows(mine).filter({ hasText: `/o/${newSlug}` });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(newName);
  });
});

test.describe('BR-56: a taken URL', () => {
  test('TC-56.2: editing B to the new slug of A shows "This URL is taken. Try another." and B keeps its slug', async ({
    browser,
  }) => {
    const a = await freshOrg();
    const b = await freshOrg();
    const aNew = `e2e-a-${tagOf()}`;
    await patchOrg(a.id, { slug: aNew });

    const mine = await adminPage(browser);
    const dialog = await openEdit(mine, b.id, b.name);
    await dialog.getByRole('textbox', { name: 'URL' }).fill(aNew);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await mine
      .getByRole('dialog', { name: 'Change the organization URL?' })
      .getByRole('button', { name: 'Change URL' })
      .click();

    const edit = mine.getByRole('dialog', { name: 'Edit organization' });
    await expect(edit.getByText('This URL is taken. Try another.', { exact: true })).toBeVisible();
    await expect(edit.getByRole('textbox', { name: 'URL' })).toHaveAttribute('aria-invalid', 'true');

    const saved = PlatformOrgDetailDto.parse(await ok(await pa.get(`/api/platform/orgs/${b.id}`), 200, 'platform org'));
    expect(saved.slug).toBe(b.slug);
  });
});

test.describe('BR-58: what a slug or name change does for members', () => {
  test('TC-58.1: the old /o/<slug> link is not found for the owner and the new one opens the org', async ({ page }) => {
    const org = await freshOrg();
    await inviteAndSignIn(page, pa, org.id, org.slug, 'owner', { type: 'org' });
    const newSlug = `e2e-new-${tagOf()}`;
    await patchOrg(org.id, { slug: newSlug });

    await page.goto(`/o/${org.slug}/projects`);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toHaveCount(0);

    await page.goto(`/o/${newSlug}/projects`);
    await expect(page).toHaveURL(new RegExp(`/o/${newSlug}/projects$`));
    await expect(page.getByRole('button', { name: `Switch scope, currently organization ${org.name}` })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create your first project', level: 1 })).toBeVisible();
  });

  test('TC-58.2: a new org can take the old slug at once', async () => {
    const org = await freshOrg();
    await patchOrg(org.id, { slug: `e2e-new-${tagOf()}` });

    const taker = await createOrg(pa, `E2E taker ${tagOf()}`, org.slug);
    toFree.push(taker.id);
    expect(taker.slug).toBe(org.slug);
  });

  test('TC-58.3: after a rename the owner reloads and the switcher and top bar show the new name', async ({ page }) => {
    const org = await freshOrg();
    await inviteAndSignIn(page, pa, org.id, org.slug, 'owner', { type: 'org' });
    await page.goto(`/o/${org.slug}/projects`);
    await expect(page.getByRole('button', { name: `Switch scope, currently organization ${org.name}` })).toBeVisible();

    const newName = `E2E renamed ${tagOf()}`;
    await patchOrg(org.id, { name: newName });
    await page.reload();

    await expect(page.getByRole('button', { name: `Switch scope, currently organization ${newName}` })).toBeVisible();
    await expect(page.getByText(org.name, { exact: true })).toHaveCount(0);
  });
});

test.describe('BR-61: the org audit log of an edit', () => {
  test('TC-61.1: the owner sees one entry with the old and new name and URL, tagged "Platform admin"', async ({
    page,
  }) => {
    const org = await freshOrg();
    await inviteAndSignIn(page, pa, org.id, org.slug, 'owner', { type: 'org' });
    const newSlug = `e2e-new-${tagOf()}`;
    const newName = `E2E renamed ${newSlug}`;
    await patchOrg(org.id, { name: newName, slug: newSlug });

    await page.goto(`/o/${newSlug}/settings/audit`);
    await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
    const row = bodyRows(page).filter({ hasText: 'changed the organization' });
    await expect(row).toHaveCount(1);
    await expect(row.locator('td:nth-child(2)').getByText('Platform admin', { exact: true })).toBeVisible();
    await expect(row.locator('td:nth-child(3)')).toContainText(
      `changed the organization name from ${org.name} to ${newName} and the URL from /o/${org.slug} to /o/${newSlug}`,
    );
  });
});
