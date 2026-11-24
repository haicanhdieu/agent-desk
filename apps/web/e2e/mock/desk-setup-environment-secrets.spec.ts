import { expect, test, type Locator, type Page } from '@playwright/test';
import { ids } from '../../src/mocks/dto/ids';
import { seedOnboarding } from './mock';

/*
 * Workspace setup, Environment tab (issue 176), mock side: the secrets flow (add, replace, remove), the name and value
 * validation of the secret form, and the no-value rule (a typed secret value never appears in the page text). The owner
 * opens invoicer-api (variable DB_HOST; secrets NPM_TOKEN, SENTRY_DSN). Each test seeds before the first goto and never
 * reloads: persistence is proved by leaving the tab and returning by click.
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const P1 = ids.project.invoicerApi;
const ENV = `/o/acme/p/${P1}/desk/setup?tab=environment`;

const secrets = (page: Page) => page.getByRole('region', { name: 'Secrets' });
const form = (page: Page) => secrets(page).getByRole('group', { name: 'Add secret' });
const submit = (page: Page) => form(page).getByRole('button', { name: 'Add secret' });
const row = (page: Page, name: string) => secrets(page).getByText(name, { exact: true });
const item = (page: Page, name: string): Locator => secrets(page).getByRole('listitem').filter({ hasText: name });
const replaceButtons = (page: Page): Locator => secrets(page).getByRole('button', { name: /^Replace / });
const nameField = (page: Page) => form(page).getByRole('textbox', { name: 'Name' });
const valueField = (page: Page) => form(page).getByLabel('Value', { exact: true });

const NAME_ERROR = 'Use letters, digits and _, and do not start with a digit.';
const EXISTS = (name: string) => `${name} already exists. A name can be used once, as a variable or a secret.`;
const TOO_SHORT = 'Too short to hide in logs.';

async function open(page: Page) {
  await seedOnboarding(page, 'owner');
  await page.goto(ENV);
  await expect(row(page, 'NPM_TOKEN')).toBeVisible();
}

async function openForm(page: Page) {
  await open(page);
  await secrets(page).getByRole('button', { name: 'Add secret' }).click();
  await expect(form(page)).toBeVisible();
}

async function fillAndSubmit(page: Page, name: string, value?: string) {
  await nameField(page).fill(name);
  if (value !== undefined) await valueField(page).fill(value);
  await submit(page).click();
}

async function leaveAndReturn(page: Page) {
  await page.getByRole('tab', { name: 'Setup script' }).click();
  await page.getByRole('tab', { name: 'Environment' }).click();
  await expect(secrets(page).getByRole('button', { name: 'Add secret' })).toBeVisible();
}

async function noValueOnPage(page: Page, value: string) {
  await expect(page.locator('body')).not.toContainText(value);
}

test.describe('BR-9: add a secret', () => {
  test('BR-9: TC-9.1: adding API_KEY lists it with the mask and "Set just now by", closes the form and never shows the value', async ({
    page,
  }) => {
    const value = 'test-token-not-real-1';
    await openForm(page);
    await fillAndSubmit(page, 'API_KEY', value);
    await expect(row(page, 'API_KEY')).toBeVisible();
    await expect(item(page, 'API_KEY').getByText('Value hidden', { exact: true })).toBeAttached();
    await expect(item(page, 'API_KEY').getByText('••••••••')).toBeVisible();
    await expect(item(page, 'API_KEY').getByText(/^Set just now by .+/)).toBeVisible();
    await expect(form(page)).toHaveCount(0);
    await noValueOnPage(page, value);
  });
});

test.describe('BR-10: replace a secret', () => {
  test('BR-10: TC-10.1: pressing Replace NPM_TOKEN shows an empty password input "New value" and not the stored value', async ({
    page,
  }) => {
    await open(page);
    await secrets(page).getByRole('button', { name: 'Replace NPM_TOKEN' }).click();
    const input = secrets(page).getByLabel('New value', { exact: true });
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute('type', 'password');
    await expect(input).toHaveValue('');
  });

  test('BR-10: TC-10.2: saving a new value closes the input, updates the line to "Set just now by" and never shows the value', async ({
    page,
  }) => {
    const value = 'test-token-not-real-2';
    await open(page);
    await secrets(page).getByRole('button', { name: 'Replace NPM_TOKEN' }).click();
    await secrets(page).getByLabel('New value', { exact: true }).fill(value);
    await secrets(page).getByRole('button', { name: 'Save' }).click();
    await expect(secrets(page).getByLabel('New value', { exact: true })).toHaveCount(0);
    await expect(item(page, 'NPM_TOKEN').getByText(/^Set just now by .+/)).toBeVisible();
    await noValueOnPage(page, value);
  });

  test('BR-10: TC-10.3: Save is disabled while "New value" is empty and Cancel leaves the "Set ... by ..." line unchanged', async ({
    page,
  }) => {
    await open(page);
    const before = await item(page, 'NPM_TOKEN')
      .getByText(/^Set .+ by .+/)
      .innerText();
    await secrets(page).getByRole('button', { name: 'Replace NPM_TOKEN' }).click();
    await expect(secrets(page).getByLabel('New value', { exact: true })).toHaveValue('');
    await expect(secrets(page).getByRole('button', { name: 'Save' })).toBeDisabled();
    await secrets(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(secrets(page).getByLabel('New value', { exact: true })).toHaveCount(0);
    await expect(item(page, 'NPM_TOKEN').getByText(before, { exact: true })).toBeVisible();
  });
});

test.describe('BR-11: remove a secret', () => {
  test('BR-11: TC-11.1: removing NPM_TOKEN asks in a dialog, drops the row and it stays gone after leaving the tab', async ({
    page,
  }) => {
    await open(page);
    await secrets(page).getByRole('button', { name: 'Remove NPM_TOKEN' }).click();
    const dialog = page.getByRole('dialog', { name: 'Remove NPM_TOKEN?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Keep' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Remove secret' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row(page, 'NPM_TOKEN')).toHaveCount(0);
    await leaveAndReturn(page);
    await expect(row(page, 'NPM_TOKEN')).toHaveCount(0);
  });

  test('BR-11: TC-11.3: pressing Keep closes the dialog and NPM_TOKEN is still listed', async ({ page }) => {
    await open(page);
    await secrets(page).getByRole('button', { name: 'Remove NPM_TOKEN' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Keep' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(row(page, 'NPM_TOKEN')).toBeVisible();
  });
});

test.describe('BR-12, BR-13, BR-14: secret names', () => {
  test('BR-12: TC-12.10: the secret name 1BAD shows the Name error and adds no secret', async ({ page }) => {
    const value = 'test-token-not-real-3';
    await openForm(page);
    const count = await replaceButtons(page).count();
    await fillAndSubmit(page, '1BAD', value);
    await expect(form(page).getByText(NAME_ERROR)).toBeVisible();
    await expect(replaceButtons(page)).toHaveCount(count);
    await expect(row(page, '1BAD')).toHaveCount(0);
    await noValueOnPage(page, value);
  });

  test('BR-13: TC-13.2: GITHUB_TOKEN shows "GITHUB_TOKEN is reserved: Agent Desk sets it for every run." and adds no secret', async ({
    page,
  }) => {
    const value = 'test-token-not-real-4';
    await openForm(page);
    const count = await replaceButtons(page).count();
    await fillAndSubmit(page, 'GITHUB_TOKEN', value);
    await expect(form(page).getByText('GITHUB_TOKEN is reserved: Agent Desk sets it for every run.')).toBeVisible();
    await expect(replaceButtons(page)).toHaveCount(count);
    await expect(row(page, 'GITHUB_TOKEN')).toHaveCount(0);
    await noValueOnPage(page, value);
  });

  test('BR-14: TC-14.3: a secret named like the variable DB_HOST shows the exists error and adds no secret', async ({
    page,
  }) => {
    const value = 'test-token-not-real-5';
    await openForm(page);
    const count = await replaceButtons(page).count();
    await fillAndSubmit(page, 'DB_HOST', value);
    await expect(form(page).getByText(EXISTS('DB_HOST'))).toBeVisible();
    await expect(replaceButtons(page)).toHaveCount(count);
    await expect(row(page, 'DB_HOST')).toHaveCount(0);
    await noValueOnPage(page, value);
  });

  test('BR-14: TC-14.4: adding NPM_TOKEN again shows the exists error and its "Set ... by ..." line is unchanged', async ({
    page,
  }) => {
    const value = 'test-token-not-real-6';
    await openForm(page);
    const before = await item(page, 'NPM_TOKEN')
      .getByText(/^Set .+ by .+/)
      .innerText();
    await fillAndSubmit(page, 'NPM_TOKEN', value);
    await expect(form(page).getByText(EXISTS('NPM_TOKEN'))).toBeVisible();
    await expect(item(page, 'NPM_TOKEN').getByText(before, { exact: true })).toBeVisible();
    await noValueOnPage(page, value);
  });
});

test.describe('BR-15: secret value length', () => {
  test('BR-15: TC-15.1: an empty value shows "Enter a value." and adds no secret', async ({ page }) => {
    await openForm(page);
    const count = await replaceButtons(page).count();
    await fillAndSubmit(page, 'SHORT_ONE');
    await expect(form(page).getByText('Enter a value.')).toBeVisible();
    await expect(replaceButtons(page)).toHaveCount(count);
    await expect(row(page, 'SHORT_ONE')).toHaveCount(0);
  });

  test('BR-15: TC-15.2: a 5-character value shows "Too short to hide in logs." and adds no secret', async ({
    page,
  }) => {
    const value = '12345';
    await openForm(page);
    const count = await replaceButtons(page).count();
    await fillAndSubmit(page, 'SHORT_ONE', value);
    await expect(form(page).getByText(TOO_SHORT)).toBeVisible();
    await expect(replaceButtons(page)).toHaveCount(count);
    await expect(row(page, 'SHORT_ONE')).toHaveCount(0);
    await noValueOnPage(page, value);
  });

  test('BR-15: TC-15.3: a 6-character value adds the secret with the mask', async ({ page }) => {
    await openForm(page);
    await fillAndSubmit(page, 'SHORT_ONE', '123456');
    await expect(row(page, 'SHORT_ONE')).toBeVisible();
    await expect(item(page, 'SHORT_ONE').getByText('••••••••')).toBeVisible();
    await expect(page.getByText(TOO_SHORT)).toHaveCount(0);
    await noValueOnPage(page, '123456');
  });

  test('BR-15: TC-15.4: the Add secret form shows the help "At least 6 characters." on Value', async ({ page }) => {
    await openForm(page);
    await expect(form(page).getByText('At least 6 characters.')).toBeVisible();
  });

  test('BR-15: TC-15.5: replacing NPM_TOKEN with 12345 shows "Too short to hide in logs." and the line is unchanged', async ({
    page,
  }) => {
    const value = '12345';
    await open(page);
    const before = await item(page, 'NPM_TOKEN')
      .getByText(/^Set .+ by .+/)
      .innerText();
    await secrets(page).getByRole('button', { name: 'Replace NPM_TOKEN' }).click();
    await secrets(page).getByLabel('New value', { exact: true }).fill(value);
    await secrets(page).getByRole('button', { name: 'Save' }).click();
    await expect(secrets(page).getByText(TOO_SHORT)).toBeVisible();
    // The row is replaced by the form while it is open, so the line is read after closing it with Cancel.
    await secrets(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(item(page, 'NPM_TOKEN').getByText(before, { exact: true })).toBeVisible();
    await noValueOnPage(page, value);
  });
});

test.describe('BR-17: no secret value on any screen', () => {
  test('BR-17: TC-17.1: the Value input hides what is typed, the saved value is not in the page and Replace starts empty', async ({
    page,
  }) => {
    const value = 'test-token-not-real-7';
    await openForm(page);
    const input = valueField(page);
    await expect(input).toHaveAttribute('type', 'password');
    await expect(input).toHaveAttribute('autocomplete', 'new-password');
    await fillAndSubmit(page, 'API_KEY', value);
    await expect(row(page, 'API_KEY')).toBeVisible();
    await noValueOnPage(page, value);
    await secrets(page).getByRole('button', { name: 'Replace API_KEY' }).click();
    await expect(secrets(page).getByLabel('New value', { exact: true })).toHaveValue('');
    await noValueOnPage(page, value);
  });

  test('BR-17: TC-17.2: a failed submit on the name shows the Name error and the page text does not contain the value', async ({
    page,
  }) => {
    const value = 'test-token-not-real-8';
    await openForm(page);
    await fillAndSubmit(page, '1BAD', value);
    await expect(form(page).getByText(NAME_ERROR)).toBeVisible();
    await noValueOnPage(page, value);
  });

  test('BR-17: TC-17.3: a failed submit with 12345 shows "Too short to hide in logs." and the page text does not contain 12345', async ({
    page,
  }) => {
    await openForm(page);
    await fillAndSubmit(page, 'API_KEY', '12345');
    await expect(form(page).getByText(TOO_SHORT)).toBeVisible();
    await noValueOnPage(page, '12345');
  });

  test('BR-17: TC-17.4: after saving API_KEY, the Replace form has Show value but it reveals nothing and New value starts empty', async ({
    page,
  }) => {
    const value = 'test-token-not-real-9';
    await openForm(page);
    await fillAndSubmit(page, 'API_KEY', value);
    await expect(row(page, 'API_KEY')).toBeVisible();
    await secrets(page).getByRole('button', { name: 'Replace API_KEY' }).click();
    const input = secrets(page).getByLabel('New value', { exact: true });
    await expect(input).toHaveValue('');
    await noValueOnPage(page, value);
    const show = secrets(page).getByRole('button', { name: 'Show value' });
    await expect(show).toBeVisible();
    await show.click();
    await expect(secrets(page).getByRole('button', { name: 'Hide value' })).toBeVisible();
    await expect(input).toHaveAttribute('type', 'text');
    await expect(input).toHaveValue('');
    await noValueOnPage(page, value);
  });
});

test.describe('BR-25: secret size', () => {
  test('BR-25: TC-25.2: a secret of 8193 characters shows "Use 8 KiB or less." and adds nothing', async ({ page }) => {
    const value = 'v'.repeat(8193);
    await openForm(page);
    const count = await replaceButtons(page).count();
    await fillAndSubmit(page, 'BIG_SECRET', value);
    await expect(form(page).getByText('Use 8 KiB or less.')).toBeVisible();
    await expect(row(page, 'BIG_SECRET')).toHaveCount(0);
    await expect(replaceButtons(page)).toHaveCount(count);
    await noValueOnPage(page, value);
  });

  test('BR-25: TC-25.4: a secret of 8192 characters is added with the mask and no Value error', async ({ page }) => {
    const value = 'v'.repeat(8192);
    await openForm(page);
    await fillAndSubmit(page, 'BIG_SECRET', value);
    await expect(row(page, 'BIG_SECRET')).toBeVisible();
    await expect(item(page, 'BIG_SECRET').getByText('••••••••')).toBeVisible();
    await expect(page.getByText('Use 8 KiB or less.')).toHaveCount(0);
    await noValueOnPage(page, value);
  });
});
