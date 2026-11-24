import { expect, test, type Locator, type Page } from '@playwright/test';
import { ids } from '../../src/mocks/dto/ids';
import { seedLists, seedOnboarding } from './mock';

/*
 * Workspace setup, Environment tab (issue 176), mock side: the paged lists (BR-27). The owner opens invoicer-api with
 * 23 generated variables (VAR_001..VAR_023) and 22 generated secrets (SEC_001..SEC_022); the page size is 20, so each
 * list has a second page (3 and 2 entries). Each test seeds before the first goto and moves by click or by URL.
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const P1 = ids.project.invoicerApi;
const ENV = `/o/acme/p/${P1}/desk/setup?tab=environment`;

const vars = (page: Page) => page.getByRole('region', { name: 'Environment variables' });
const secrets = (page: Page) => page.getByRole('region', { name: 'Secrets' });
const nav = (group: Locator) => group.getByRole('navigation', { name: 'Pagination' });
const range = (group: Locator) => nav(group).locator('p');
const param = (page: Page, name: string) => new URL(page.url()).searchParams.get(name);

const names = (group: Locator, prefix: string) => group.getByText(new RegExp(`^${prefix}_\\d{3}$`)).allTextContents();
const sequence = (prefix: string, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}_${String(from + i).padStart(3, '0')}`);

async function open(page: Page, path = ENV) {
  await seedOnboarding(page, 'owner');
  await seedLists(page, { env: { variables: 23, secrets: 22 } });
  await page.goto(path);
}

test.describe('BR-27: paged lists', () => {
  test('BR-27: TC-27.1: each list has a page control and its total in the header', async ({ page }) => {
    await open(page);
    for (const group of [vars(page), secrets(page)]) {
      const control = nav(group);
      await expect(control).toBeVisible();
      await expect(control.locator('p')).toHaveText(/^Showing 1–20 of 2[23]$/);
      await expect(control.getByRole('button', { name: 'Previous', exact: true })).toBeVisible();
      await expect(control.getByRole('button', { name: 'Page 1', exact: true })).toBeVisible();
      await expect(control.getByRole('button', { name: 'Page 2', exact: true })).toBeVisible();
      await expect(control.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
      await expect(control.getByLabel('Go to page')).toBeVisible();
      await expect(control.getByLabel('Rows per page')).toBeVisible();
    }
    await expect(vars(page).getByText('23 variables', { exact: true })).toBeVisible();
    await expect(secrets(page).getByText('22 secrets', { exact: true })).toBeVisible();
  });

  test('BR-27: TC-27.2: each list is in ascending order of name on page 1', async ({ page }) => {
    await open(page);
    await expect(vars(page).getByText('VAR_001', { exact: true })).toBeVisible();
    await expect(secrets(page).getByText('SEC_001', { exact: true })).toBeVisible();
    expect(await names(vars(page), 'VAR')).toEqual(sequence('VAR', 1, 20));
    expect(await names(secrets(page), 'SEC')).toEqual(sequence('SEC', 1, 20));
  });

  test('BR-27: TC-27.3: Next under the variables list sets varsPage=2 and leaves the secrets list on page 1', async ({
    page,
  }) => {
    await open(page);
    await nav(vars(page)).getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page).toHaveURL(/varsPage=2/);
    expect(param(page, 'secretsPage')).toBeNull();
    await expect(range(vars(page))).toHaveText('Showing 21–23 of 23');
    expect(await names(vars(page), 'VAR')).toEqual(sequence('VAR', 21, 23));
    await expect(range(secrets(page))).toHaveText('Showing 1–20 of 22');
    expect(await names(secrets(page), 'SEC')).toEqual(sequence('SEC', 1, 20));
  });

  test('BR-27: TC-27.4: Next under the secrets list keeps the variables list and the open Add form with KEEP_ME', async ({
    page,
  }) => {
    await open(page);
    await vars(page).getByRole('button', { name: 'Add variable' }).click();
    const form = vars(page).getByRole('group', { name: 'Add variable' });
    await form.getByRole('textbox', { name: 'Name' }).fill('KEEP_ME');
    await nav(secrets(page)).getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page).toHaveURL(/secretsPage=2/);
    await expect(range(secrets(page))).toHaveText('Showing 21–22 of 22');
    expect(await names(secrets(page), 'SEC')).toEqual(sequence('SEC', 21, 22));
    await expect(range(vars(page))).toHaveText('Showing 1–20 of 23');
    expect(await names(vars(page), 'VAR')).toEqual(sequence('VAR', 1, 20));
    expect(param(page, 'varsPage')).toBeNull();
    await expect(form).toBeVisible();
    await expect(form.getByRole('textbox', { name: 'Name' })).toHaveValue('KEEP_ME');
  });

  test('BR-27: TC-27.5: opening varsPage=2 directly shows variables page 2 and secrets page 1', async ({ page }) => {
    await open(page, `${ENV}&varsPage=2`);
    await expect(range(vars(page))).toHaveText('Showing 21–23 of 23');
    expect(await names(vars(page), 'VAR')).toEqual(sequence('VAR', 21, 23));
    await expect(range(secrets(page))).toHaveText('Showing 1–20 of 22');
    expect(await names(secrets(page), 'SEC')).toEqual(sequence('SEC', 1, 20));
  });

  test('BR-27: TC-27.6: varsPage=99 is clamped back to the last page', async ({ page }) => {
    await open(page, `${ENV}&varsPage=99`);
    await expect(range(vars(page))).toHaveText('Showing 21–23 of 23');
    expect(await names(vars(page), 'VAR')).toEqual(sequence('VAR', 21, 23));
    await expect(range(secrets(page))).toHaveText('Showing 1–20 of 22');
  });
});
