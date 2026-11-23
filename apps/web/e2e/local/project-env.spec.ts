import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { EnvEntryDto, PlatformOrgDto, pageOf } from '@agentdesk/contracts';
import { API, asPlatformAdmin, inviteAndSignIn, ok, signInAndStartProject } from './helpers';

/*
 * Local end-to-end for the project environment (spec docs/superpowers/specs/2026-11-23-workspace-env-secrets-design.md,
 * "E2E requirements": BR-6, 7, 8, 9, 11, 14, 17, 26 and 28), real API and real stack with the fake Kubernetes pod.
 * Every test signs in as a new owner and starts its own project; entries are filled and removed over the owner's
 * page.request, and names carry a random suffix.
 */

test.describe.configure({ timeout: 300_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

const rand = () => randomBytes(4).toString('hex');
const envUrl = (handle: string, projectId: string, query = '') =>
  `/o/${handle}/p/${projectId}/desk/setup?tab=environment${query}`;

const vars = (page: Page) => page.getByRole('region', { name: 'Environment variables' });
const secrets = (page: Page) => page.getByRole('region', { name: 'Secrets' });
const varForm = (page: Page) => vars(page).getByRole('group', { name: 'Add variable' });
const secretForm = (page: Page) => secrets(page).getByRole('group', { name: 'Add secret' });
/** The secret row's meta text: "Set <ago> by <handle>"; the owner's handle is what the API returns as `updatedBy`. */
const setBy = (handle: string) => new RegExp(`^Set .+ by ${handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
const secretItem = (page: Page, name: string) => secrets(page).getByRole('listitem').filter({ hasText: name });

const EXISTS = (name: string) => `${name} already exists. A name can be used once, as a variable or a secret.`;
const GONE = 'This entry no longer exists. Reload the list.';
const TOO_LARGE_DETAIL =
  'Names and values of this project would pass 256 KiB together. Shorten or remove entries to make room.';

type Kind = 'plain' | 'secret';
const route = (kind: Kind) => (kind === 'plain' ? 'env-vars' : 'env-secrets');

async function listEnv(page: Page, projectId: string, kind: Kind): Promise<EnvEntryDto[]> {
  const body = pageOf(EnvEntryDto).parse(
    await ok(await page.request.get(`/api/projects/${projectId}/env?kind=${kind}&pageSize=100`), 200, `list ${kind}`),
  );
  return body.items;
}

async function addEntry(page: Page, projectId: string, kind: Kind, name: string, value: string): Promise<void> {
  await ok(await page.request.post(`/api/projects/${projectId}/${route(kind)}`, { data: { name, value } }), 201, name);
}

/** Given: `count` entries E2E_FILL_01.. of 8192 characters each (31 of them are about 254 KiB with their names). */
async function fill(page: Page, projectId: string, kind: Kind, count: number): Promise<void> {
  for (let i = 1; i <= count; i++) {
    await addEntry(page, projectId, kind, `E2E_FILL_${String(i).padStart(2, '0')}`, 'v'.repeat(8192));
  }
}

async function openEnv(page: Page, handle: string, projectId: string, query = ''): Promise<void> {
  await page.goto(envUrl(handle, projectId, query));
  await expect(vars(page).getByRole('button', { name: 'Add variable' })).toBeVisible();
}

async function addVariableInUi(page: Page, name: string, value: string): Promise<void> {
  await vars(page).getByRole('button', { name: 'Add variable' }).click();
  await varForm(page).getByRole('textbox', { name: 'Name' }).fill(name);
  await varForm(page).getByRole('textbox', { name: 'Value' }).fill(value);
  await varForm(page).getByRole('button', { name: 'Add variable' }).click();
}

async function addSecretInUi(page: Page, name: string, value: string): Promise<void> {
  await secrets(page).getByRole('button', { name: 'Add secret' }).click();
  await secretForm(page).getByRole('textbox', { name: 'Name' }).fill(name);
  await secretForm(page).getByLabel('Value', { exact: true }).fill(value);
  await secretForm(page).getByRole('button', { name: 'Add secret' }).click();
}

async function expectTooLarge(page: Page): Promise<void> {
  const form = varForm(page);
  await expect(form.getByText('Too large', { exact: true })).toBeVisible();
  await expect(form.getByText(TOO_LARGE_DETAIL, { exact: true })).toBeVisible();
}

test.describe('BR-6: add a variable', () => {
  test('BR-6: TC-6.2: a variable added in the UI is listed with its value after a reload', async ({ page }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const name = `E2E_PLAIN_${rand()}`;
    const value = `value-${rand()}`;
    await openEnv(page, handle, projectId);
    await addVariableInUi(page, name, value);
    await expect(vars(page).getByText(name, { exact: true })).toBeVisible();
    await page.reload();
    await expect(vars(page).getByText(name, { exact: true })).toBeVisible();
    await expect(vars(page).getByText(value, { exact: true })).toBeVisible();
  });
});

test.describe('BR-7: edit a variable', () => {
  test('BR-7: TC-7.2: the new value is listed after a reload and the old one is not', async ({ page }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const name = `E2E_PLAIN_${rand()}`;
    const oldValue = `old-${rand()}`;
    const newValue = `new-${rand()}`;
    await addEntry(page, projectId, 'plain', name, oldValue);
    await openEnv(page, handle, projectId);
    await vars(page)
      .getByRole('button', { name: `Edit ${name}` })
      .click();
    await vars(page).getByRole('textbox', { name: 'Value' }).fill(newValue);
    await vars(page).getByRole('button', { name: 'Save' }).click();
    await expect(vars(page).getByText(newValue, { exact: true })).toBeVisible();
    await page.reload();
    await expect(vars(page).getByText(name, { exact: true })).toBeVisible();
    await expect(vars(page).getByText(newValue, { exact: true })).toBeVisible();
    await expect(vars(page).getByText(oldValue, { exact: true })).toHaveCount(0);
  });
});

test.describe('BR-8: remove a variable', () => {
  test('BR-8: TC-8.2: a removed variable is not listed after a reload', async ({ page }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const name = `E2E_PLAIN_${rand()}`;
    await addEntry(page, projectId, 'plain', name, `value-${rand()}`);
    await openEnv(page, handle, projectId);
    await vars(page)
      .getByRole('button', { name: `Remove ${name}` })
      .click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove variable' }).click();
    await expect(vars(page).getByText(name, { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(vars(page).getByRole('button', { name: 'Add variable' })).toBeVisible();
    await expect(vars(page).getByText(name, { exact: true })).toHaveCount(0);
  });
});

test.describe('BR-9: add a secret', () => {
  test('BR-9: TC-9.2: after a reload the secret row shows the name, the mask and "Set <ago> by <user>", not the value', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const name = `E2E_SECRET_${rand()}`;
    const value = randomBytes(6).toString('hex');
    expect(value).toHaveLength(12);
    await openEnv(page, handle, projectId);
    await addSecretInUi(page, name, value);
    await expect(secrets(page).getByText(name, { exact: true })).toBeVisible();
    await page.reload();
    await expect(secrets(page).getByText(name, { exact: true })).toBeVisible();
    await expect(secretItem(page, name).getByText('••••••••')).toBeVisible();
    await expect(secretItem(page, name).getByText(setBy(handle))).toBeVisible();
    await expect(page.locator('body')).not.toContainText(value);
  });
});

test.describe('BR-11: remove a secret', () => {
  test('BR-11: TC-11.2: a removed secret is not listed after a reload', async ({ page }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const name = `E2E_SECRET_${rand()}`;
    await addEntry(page, projectId, 'secret', name, `secret-${rand()}`);
    await openEnv(page, handle, projectId);
    await secrets(page)
      .getByRole('button', { name: `Remove ${name}` })
      .click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove secret' }).click();
    await expect(secrets(page).getByText(name, { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(secrets(page).getByRole('button', { name: 'Add secret' })).toBeVisible();
    await expect(secrets(page).getByText(name, { exact: true })).toHaveCount(0);
  });
});

test.describe('BR-14: duplicate names', () => {
  test('BR-14: TC-14.6: adding an existing variable name shows the exists error and keeps the first value', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const name = `E2E_PLAIN_${rand()}`;
    const first = `first-${rand()}`;
    const second = `second-${rand()}`;
    await addEntry(page, projectId, 'plain', name, first);
    await openEnv(page, handle, projectId);
    await addVariableInUi(page, name, second);
    await expect(varForm(page).getByText(EXISTS(name), { exact: true })).toBeVisible();
    await page.reload();
    await expect(vars(page).getByText(name, { exact: true })).toBeVisible();
    await expect(vars(page).getByText(first, { exact: true })).toBeVisible();
    await expect(vars(page).getByText(second, { exact: true })).toHaveCount(0);
  });

  test('BR-14: TC-14.7: a variable named like an existing secret shows the exists error and only the secret keeps the name', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const name = `E2E_SECRET_${rand()}`;
    await addEntry(page, projectId, 'secret', name, `secret-${rand()}`);
    await openEnv(page, handle, projectId);
    await addVariableInUi(page, name, `value-${rand()}`);
    await expect(varForm(page).getByText(EXISTS(name), { exact: true })).toBeVisible();
    await page.reload();
    await expect(secrets(page).getByText(name, { exact: true })).toBeVisible();
    await expect(vars(page).getByText(name, { exact: true })).toHaveCount(0);
  });

  test('BR-14: TC-14.8: over the API a repeated name answers 409 for a variable and for a secret, and the first value stays', async ({
    page,
  }) => {
    const { projectId } = await signInAndStartProject(page);
    const name = `E2E_PLAIN_${rand()}`;
    const first = `first-${rand()}`;
    const base = `/api/projects/${projectId}`;
    const created = await page.request.post(`${base}/env-vars`, { data: { name, value: first } });
    expect(created.status(), await created.text()).toBe(201);
    const again = await page.request.post(`${base}/env-vars`, { data: { name, value: `second-${rand()}` } });
    expect(again.status(), await again.text()).toBe(409);
    const asSecret = await page.request.post(`${base}/env-secrets`, { data: { name, value: `secret-${rand()}` } });
    expect(asSecret.status(), await asSecret.text()).toBe(409);
    const items = await listEnv(page, projectId, 'plain');
    expect(items.filter((e) => e.name === name).map((e) => e.value)).toEqual([first]);
    expect((await listEnv(page, projectId, 'secret')).map((e) => e.name)).not.toContain(name);
  });
});

test.describe('BR-17: no screen or response shows a secret value', () => {
  test('BR-17: TC-17.5: the list and the replace answer carry the entry with value null and neither body has a secret value', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const name = `E2E_SECRET_${rand()}`;
    const first = `secret-value-${rand()}`;
    const second = `secret-value2-${rand()}`;
    await addEntry(page, projectId, 'secret', name, first);
    const base = `/api/projects/${projectId}`;

    const listed = await page.request.get(`${base}/env?kind=secret`);
    const listedText = await listed.text();
    expect(listed.status(), listedText).toBe(200);
    const entry = pageOf(EnvEntryDto)
      .parse(JSON.parse(listedText))
      .items.find((e) => e.name === name);
    expect(entry, listedText).toMatchObject({ name, kind: 'secret', value: null });
    expect(entry?.updatedBy).toBe(handle);
    expect(Number.isNaN(Date.parse(entry?.updatedAt ?? '')), listedText).toBe(false);
    expect(listedText).not.toContain(first);
    expect(listedText).not.toContain(second);

    const replaced = await page.request.put(`${base}/env-secrets/${name}`, { data: { value: second } });
    const replacedText = await replaced.text();
    expect(replaced.status(), replacedText).toBe(200);
    const replacedEntry = EnvEntryDto.parse(JSON.parse(replacedText));
    expect(replacedEntry, replacedText).toMatchObject({ name, kind: 'secret', value: null, updatedBy: handle });
    expect(Number.isNaN(Date.parse(replacedEntry.updatedAt)), replacedText).toBe(false);
    expect(replacedText).not.toContain(first);
    expect(replacedText).not.toContain(second);
  });

  test('BR-17: TC-17.6: the 409 and both 400 answers of failed secret saves do not contain the value that was sent', async ({
    page,
  }) => {
    const { projectId } = await signInAndStartProject(page);
    const name = `E2E_SECRET_${rand()}`;
    await addEntry(page, projectId, 'secret', name, `secret-value-${rand()}`);
    const base = `/api/projects/${projectId}/env-secrets`;
    const dup = `dup-value-${rand()}`;
    const reserved = `reserved-value-${rand()}`;
    const short = '12345';
    const sent = [
      { data: { name, value: dup }, status: 409, value: dup },
      { data: { name: 'PATH', value: reserved }, status: 400, value: reserved },
      { data: { name: `E2E_OK_${rand()}`, value: short }, status: 400, value: short },
    ];
    for (const { data, status, value } of sent) {
      const res = await page.request.post(base, { data });
      const text = await res.text();
      expect(res.status(), text).toBe(status);
      expect(res.headers()['content-type'] ?? '', text).toContain('problem+json');
      expect(text).not.toContain(value);
    }
  });

  test('BR-17: TC-17.7: a secret saved in the UI shows the name, the mask and "Set ... by ...", and its value is not in the page before or after a reload', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const name = `E2E_SECRET_${rand()}`;
    const value = `secret-value-${rand()}`;
    await openEnv(page, handle, projectId);
    await addSecretInUi(page, name, value);
    await expect(secretItem(page, name).getByText(setBy(handle))).toBeVisible();
    await expect(secretItem(page, name).getByText('••••••••')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(value);
    await page.reload();
    await expect(secretItem(page, name).getByText('••••••••')).toBeVisible();
    await expect(secretItem(page, name).getByText(setBy(handle))).toBeVisible();
    await expect(page.locator('body')).not.toContainText(value);
  });
});

test.describe('BR-26: total size of 256 KiB', () => {
  test('BR-26: TC-26.1: a variable that passes 256 KiB shows the Too large banner, keeps the input and is not listed after a reload', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    await fill(page, projectId, 'plain', 31);
    await openEnv(page, handle, projectId);
    const big = 'n'.repeat(8192);
    await addVariableInUi(page, 'NEWVAR', big);
    await expectTooLarge(page);
    await expect(varForm(page).getByRole('textbox', { name: 'Name' })).toHaveValue('NEWVAR');
    await expect(varForm(page).getByRole('textbox', { name: 'Value' })).toHaveValue(big);
    await page.reload();
    await expect(vars(page).getByRole('button', { name: 'Add variable' })).toBeVisible();
    await expect(vars(page).getByText('NEWVAR', { exact: true })).toHaveCount(0);
    await page.goto(envUrl(handle, projectId, '&varsPage=2'));
    await expect(vars(page).getByText('E2E_FILL_31', { exact: true })).toBeVisible();
    await expect(vars(page).getByText('NEWVAR', { exact: true })).toHaveCount(0);
    expect((await listEnv(page, projectId, 'plain')).map((e) => e.name)).not.toContain('NEWVAR');
  });

  test('BR-26: TC-26.2: a small variable still fits under 256 KiB and its row is added', async ({ page }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    await fill(page, projectId, 'plain', 31);
    await openEnv(page, handle, projectId);
    await addVariableInUi(page, 'SMALL', 'x');
    await expect(page.getByText('Too large', { exact: true })).toHaveCount(0);
    await expect(varForm(page)).toHaveCount(0);
    await expect.poll(async () => (await listEnv(page, projectId, 'plain')).map((e) => e.name)).toContain('SMALL');
    await page.goto(envUrl(handle, projectId, '&varsPage=2'));
    await expect(vars(page).getByText('SMALL', { exact: true })).toBeVisible();
  });

  test('BR-26: TC-26.3: growing a variable past 256 KiB shows the Too large banner and it keeps its short value after a reload', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    await fill(page, projectId, 'plain', 31);
    await addEntry(page, projectId, 'plain', 'GROW', 'short');
    await openEnv(page, handle, projectId, '&varsPage=2');
    await vars(page).getByRole('button', { name: 'Edit GROW' }).click();
    await vars(page).getByRole('textbox', { name: 'Value' }).fill('g'.repeat(8192));
    await vars(page).getByRole('button', { name: 'Save' }).click();
    await expect(vars(page).getByText('Too large', { exact: true })).toBeVisible();
    await expect(vars(page).getByText(TOO_LARGE_DETAIL, { exact: true })).toBeVisible();
    await page.reload();
    await expect(vars(page).getByText('GROW', { exact: true })).toBeVisible();
    await expect(vars(page).getByText('short', { exact: true })).toBeVisible();
    const grow = (await listEnv(page, projectId, 'plain')).find((e) => e.name === 'GROW');
    expect(grow?.value).toBe('short');
  });

  test('BR-26: TC-26.4: with 31 large secrets a variable that passes 256 KiB shows the Too large banner and nothing is added', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    await fill(page, projectId, 'secret', 31);
    await openEnv(page, handle, projectId);
    await addVariableInUi(page, 'NEWVAR', 'n'.repeat(8192));
    await expectTooLarge(page);
    await expect(vars(page).getByText('NEWVAR', { exact: true })).toHaveCount(0);
    expect(await listEnv(page, projectId, 'plain')).toEqual([]);
  });
});

/** The id of the org whose slug is `slug` (the platform admin lists orgs; a new owner's org slug is its handle). */
async function orgIdOfSlug(pa: APIRequestContext, slug: string): Promise<string> {
  for (let p = 1; p <= 50; p++) {
    const body = pageOf(PlatformOrgDto).parse(
      await ok(await pa.get(`/api/platform/orgs?pageSize=100&page=${p}`), 200, 'platform orgs'),
    );
    const org = body.items.find((o) => o.slug === slug);
    if (org) return org.id;
    if (body.items.length === 0 || p * 100 >= body.total) break;
  }
  throw new Error(`no org with slug ${slug}`);
}

test.describe('BR-28: edit of an entry removed meanwhile', () => {
  /** Runs `body` with a second admin D of the owner's org, signed in in its own context. */
  async function withAdminD(browser: Browser, handle: string, body: (d: Page) => Promise<void>): Promise<void> {
    const pa = await asPlatformAdmin();
    const ctx = await browser.newContext();
    try {
      const orgId = await orgIdOfSlug(pa, handle);
      const dPage = await ctx.newPage();
      await inviteAndSignIn(dPage, pa, orgId, `e2e-d-${rand()}`, 'admin', { type: 'org' });
      await body(dPage);
    } finally {
      await ctx.close().catch(() => null);
      await pa.dispose();
    }
  }

  test('BR-28: TC-28.1: saving an edit of a variable another admin removed shows the gone banner and creates nothing', async ({
    page,
    browser,
  }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const name = `E2E_PLAIN_${rand()}`;
    await addEntry(page, projectId, 'plain', name, `value-${rand()}`);
    await openEnv(page, handle, projectId);
    await vars(page)
      .getByRole('button', { name: `Edit ${name}` })
      .click();
    await vars(page).getByRole('textbox', { name: 'Value' }).fill(`typed-${rand()}`);
    await withAdminD(browser, handle, async (d) => {
      await ok(await d.request.delete(`/api/projects/${projectId}/env-vars/${name}`), 204, 'D removes the variable');
    });
    await vars(page).getByRole('button', { name: 'Save' }).click();
    await expect(vars(page).getByText(GONE, { exact: true })).toBeVisible();
    // The placeholder form row keeps the banner up; closing it shows the refreshed list without a reload.
    await vars(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(vars(page).getByText(GONE, { exact: true })).toHaveCount(0);
    await expect(vars(page).getByText(name, { exact: true })).toHaveCount(0);
    await expect(vars(page).getByRole('button', { name: `Edit ${name}` })).toHaveCount(0);
    await expect(vars(page).getByRole('button', { name: 'Add variable' })).toBeVisible();
    expect(await listEnv(page, projectId, 'plain')).toEqual([]);
    await page.reload();
    await expect(vars(page).getByRole('button', { name: 'Add variable' })).toBeVisible();
    await expect(vars(page).getByText(name, { exact: true })).toHaveCount(0);
    expect(await listEnv(page, projectId, 'plain')).toEqual([]);
  });

  test('BR-28: TC-28.2: saving a replace of a secret another admin removed shows the gone banner and creates nothing', async ({
    page,
    browser,
  }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const name = `E2E_SECRET_${rand()}`;
    await addEntry(page, projectId, 'secret', name, `secret-${rand()}`);
    await openEnv(page, handle, projectId);
    await secrets(page)
      .getByRole('button', { name: `Replace ${name}` })
      .click();
    await secrets(page).getByLabel('New value', { exact: true }).fill(`typed-${rand()}`);
    await withAdminD(browser, handle, async (d) => {
      await ok(await d.request.delete(`/api/projects/${projectId}/env-secrets/${name}`), 204, 'D removes the secret');
    });
    await secrets(page).getByRole('button', { name: 'Save' }).click();
    await expect(secrets(page).getByText(GONE, { exact: true })).toBeVisible();
    // The placeholder form row keeps the banner up; closing it shows the refreshed list without a reload.
    await secrets(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(secrets(page).getByText(GONE, { exact: true })).toHaveCount(0);
    await expect(secrets(page).getByText(name, { exact: true })).toHaveCount(0);
    await expect(secrets(page).getByRole('button', { name: `Replace ${name}` })).toHaveCount(0);
    await expect(secrets(page).getByRole('button', { name: 'Add secret' })).toBeVisible();
    expect(await listEnv(page, projectId, 'secret')).toEqual([]);
    await page.reload();
    await expect(secrets(page).getByRole('button', { name: 'Add secret' })).toBeVisible();
    await expect(secrets(page).getByText(name, { exact: true })).toHaveCount(0);
  });
});
