import { expect, test, type Locator, type Page } from '@playwright/test';
import { ids } from '../../src/mocks/dto/ids';
import { seedOnboarding } from './mock';

/*
 * Workspace setup, Environment tab (issue 176), mock side: the variables flow (add, edit, remove) and the name and
 * value validation of the add form. The owner opens invoicer-api (3 variables DB_HOST, LOG_LEVEL, REGION; 2 secrets
 * NPM_TOKEN, SENTRY_DSN). Each test seeds before the first goto and never reloads: persistence is proved by leaving
 * the tab and returning by click.
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const P1 = ids.project.invoicerApi;
const ENV = `/o/acme/p/${P1}/desk/setup?tab=environment`;

const vars = (page: Page) => page.getByRole('region', { name: 'Environment variables' });
const form = (page: Page) => vars(page).getByRole('group', { name: 'Add variable' });
const submit = (page: Page) => form(page).getByRole('button', { name: 'Add variable' });
const row = (page: Page, name: string) => vars(page).getByText(name, { exact: true });

const NAME_ERROR = 'Use letters, digits and _, and do not start with a digit.';
const EXISTS = (name: string) => `${name} already exists. A name can be used once, as a variable or a secret.`;
const RESERVED = (name: string) => `${name} is reserved: Agent Desk sets it for every run.`;

async function open(page: Page) {
  await seedOnboarding(page, 'owner');
  await page.goto(ENV);
  await expect(row(page, 'DB_HOST')).toBeVisible();
}

async function openForm(page: Page) {
  await open(page);
  await vars(page).getByRole('button', { name: 'Add variable' }).click();
  await expect(form(page)).toBeVisible();
}

async function fillAndSubmit(page: Page, name: string, value?: string) {
  await form(page).getByRole('textbox', { name: 'Name' }).fill(name);
  if (value !== undefined) await form(page).getByRole('textbox', { name: 'Value' }).fill(value);
  await submit(page).click();
}

async function leaveAndReturn(page: Page) {
  await page.getByRole('tab', { name: 'Setup script' }).click();
  await page.getByRole('tab', { name: 'Environment' }).click();
  await expect(vars(page).getByRole('button', { name: 'Add variable' })).toBeVisible();
}

const editButtons = (page: Page): Locator => vars(page).getByRole('button', { name: /^Edit / });

test.describe('BR-6: add a variable', () => {
  test('BR-6: TC-6.1: adding AWS_REGION shows the row, closes the form, toasts, focuses Add variable and keeps the row after leaving the tab', async ({
    page,
  }) => {
    await openForm(page);
    await expect(row(page, 'AWS_REGION')).toHaveCount(0);
    await fillAndSubmit(page, 'AWS_REGION', 'us-east-1');
    await expect(row(page, 'AWS_REGION')).toBeVisible();
    await expect(vars(page).getByText('us-east-1', { exact: true })).toBeVisible();
    await expect(form(page)).toHaveCount(0);
    await expect(page.getByText('Added AWS_REGION')).toBeVisible();
    await expect(vars(page).getByRole('button', { name: 'Add variable' })).toBeFocused();
    await leaveAndReturn(page);
    await expect(row(page, 'AWS_REGION')).toBeVisible();
    await expect(vars(page).getByText('us-east-1', { exact: true })).toBeVisible();
  });

  test('BR-6: TC-6.3: a variable with an empty value is added and its value reads Empty', async ({ page }) => {
    await openForm(page);
    await fillAndSubmit(page, 'EMPTY_ONE');
    await expect(row(page, 'EMPTY_ONE')).toBeVisible();
    await expect(
      vars(page).getByRole('listitem').filter({ hasText: 'EMPTY_ONE' }).getByText('Empty', { exact: true }),
    ).toBeVisible();
  });
});

test.describe('BR-7: edit a variable', () => {
  test('BR-7: TC-7.1: editing DB_HOST opens in place with a read-only name and the new value stays after leaving the tab', async ({
    page,
  }) => {
    await open(page);
    await vars(page).getByRole('button', { name: 'Edit DB_HOST' }).click();
    const edit = vars(page).getByRole('group', { name: 'Edit DB_HOST' });
    await expect(edit).toBeVisible();
    await expect(edit.getByRole('textbox', { name: 'Name' })).toHaveCount(0);
    await expect(edit.getByText('DB_HOST', { exact: true })).toBeVisible();
    await expect(edit.getByRole('textbox', { name: 'Value' })).toHaveValue('db.internal.example.com');
    const value = vars(page).getByRole('textbox', { name: 'Value' });
    await value.fill('db.internal');
    await vars(page).getByRole('button', { name: 'Save' }).click();
    await expect(vars(page).getByRole('button', { name: 'Save' })).toHaveCount(0);
    await expect(vars(page).getByText('db.internal', { exact: true })).toBeVisible();
    await leaveAndReturn(page);
    await expect(vars(page).getByText('db.internal', { exact: true })).toBeVisible();
    await expect(vars(page).getByText('db.internal.example.com', { exact: true })).toHaveCount(0);
  });

  test('BR-7: TC-7.3: cancelling an edit closes the form and DB_HOST keeps its previous value', async ({ page }) => {
    await open(page);
    await vars(page).getByRole('button', { name: 'Edit DB_HOST' }).click();
    await vars(page).getByRole('textbox', { name: 'Value' }).fill('something-else');
    await vars(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(vars(page).getByRole('textbox', { name: 'Value' })).toHaveCount(0);
    await expect(vars(page).getByText('db.internal.example.com', { exact: true })).toBeVisible();
    await expect(vars(page).getByText('something-else')).toHaveCount(0);
  });
});

test.describe('BR-8: remove a variable', () => {
  test('BR-8: TC-8.1: removing DB_HOST asks in a dialog, drops the row, focuses Add variable and stays gone', async ({
    page,
  }) => {
    await open(page);
    await vars(page).getByRole('button', { name: 'Remove DB_HOST' }).click();
    const dialog = page.getByRole('dialog', { name: 'Remove DB_HOST?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Runs that start after this do not get it. Running runs keep it.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Keep' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Remove variable' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row(page, 'DB_HOST')).toHaveCount(0);
    await expect(vars(page).getByRole('button', { name: 'Add variable' })).toBeFocused();
    await leaveAndReturn(page);
    await expect(row(page, 'DB_HOST')).toHaveCount(0);
    await expect(row(page, 'LOG_LEVEL')).toBeVisible();
  });

  test('BR-8: TC-8.3: pressing Keep closes the dialog and DB_HOST is still listed', async ({ page }) => {
    await open(page);
    await vars(page).getByRole('button', { name: 'Remove DB_HOST' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Keep' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(row(page, 'DB_HOST')).toBeVisible();
  });
});

test.describe('BR-12: invalid names', () => {
  test('BR-12: TC-12.1: an empty name shows "Enter a name.", adds nothing and keeps the typed value', async ({
    page,
  }) => {
    await openForm(page);
    await fillAndSubmit(page, '', 'x');
    await expect(form(page).getByText('Enter a name.')).toBeVisible();
    await expect(editButtons(page)).toHaveCount(3);
    await expect(form(page).getByRole('textbox', { name: 'Value' })).toHaveValue('x');
  });

  for (const [tc, name] of [
    ['TC-12.2', '1BAD'],
    ['TC-12.3', 'MY VAR'],
    ['TC-12.4', 'MY-VAR'],
  ] as const) {
    test(`BR-12: ${tc}: the name "${name}" shows the Name error and adds nothing`, async ({ page }) => {
      await openForm(page);
      await fillAndSubmit(page, name, 'x');
      await expect(form(page).getByText(NAME_ERROR)).toBeVisible();
      await expect(editButtons(page)).toHaveCount(3);
      await expect(row(page, name)).toHaveCount(0);
    });
  }

  test('BR-12: TC-12.5: a name with a leading space is rejected with a Name error, not fixed silently', async ({
    page,
  }) => {
    await openForm(page);
    await fillAndSubmit(page, ' DB', 'x');
    await expect(form(page).getByText(NAME_ERROR)).toBeVisible();
    await expect(form(page).getByRole('textbox', { name: 'Name' })).toHaveAttribute('aria-invalid', 'true');
    await expect(form(page).getByRole('textbox', { name: 'Name' })).toHaveValue(' DB');
    await expect(editButtons(page)).toHaveCount(3);
    await expect(row(page, 'DB')).toHaveCount(0);
  });

  test('BR-12: TC-12.6: a name of 129 characters shows "Use 128 characters or fewer." and adds nothing', async ({
    page,
  }) => {
    await openForm(page);
    await fillAndSubmit(page, 'A'.repeat(129), 'x');
    await expect(form(page).getByText('Use 128 characters or fewer.')).toBeVisible();
    await expect(editButtons(page)).toHaveCount(3);
  });

  for (const [tc, name] of [
    ['TC-12.7', 'A'.repeat(128)],
    ['TC-12.8', 'A'],
    ['TC-12.9', '_A1'],
  ] as const) {
    test(`BR-12: ${tc}: the valid name of ${name.length} characters "${name.slice(0, 8)}" is added with no Name error`, async ({
      page,
    }) => {
      await openForm(page);
      await fillAndSubmit(page, name, 'x');
      await expect(row(page, name)).toBeVisible();
      await expect(editButtons(page)).toHaveCount(4);
      await expect(page.getByText(NAME_ERROR)).toHaveCount(0);
      await expect(page.getByText('Use 128 characters or fewer.')).toHaveCount(0);
    });
  }
});

test.describe('BR-13: reserved names', () => {
  test('BR-13: TC-13.1: PATH shows "PATH is reserved: Agent Desk sets it for every run." and adds nothing', async ({
    page,
  }) => {
    await openForm(page);
    await fillAndSubmit(page, 'PATH', 'x');
    await expect(form(page).getByText(RESERVED('PATH'))).toBeVisible();
    await expect(editButtons(page)).toHaveCount(3);
    await expect(row(page, 'PATH')).toHaveCount(0);
  });

  test('BR-13: TC-13.3: AGENTDESK_X (a reserved prefix) shows a reserved-name error and adds nothing', async ({
    page,
  }) => {
    await openForm(page);
    await fillAndSubmit(page, 'AGENTDESK_X', 'x');
    await expect(form(page).getByText(RESERVED('AGENTDESK_X'))).toBeVisible();
    await expect(editButtons(page)).toHaveCount(3);
    await expect(row(page, 'AGENTDESK_X')).toHaveCount(0);
  });

  for (const [tc, name] of [
    ['TC-13.4', 'PATHS'],
    ['TC-13.5', 'MY_RUN_ID'],
  ] as const) {
    test(`BR-13: ${tc}: the near-miss ${name} is added with no reserved error`, async ({ page }) => {
      await openForm(page);
      await fillAndSubmit(page, name, 'x');
      await expect(row(page, name)).toBeVisible();
      await expect(page.getByText(/is reserved/)).toHaveCount(0);
    });
  }
});

test.describe('BR-14: duplicate names', () => {
  test('BR-14: TC-14.1: adding DB_HOST again shows the exists error, keeps the typed value and the old value', async ({
    page,
  }) => {
    await openForm(page);
    await fillAndSubmit(page, 'DB_HOST', 'other');
    await expect(form(page).getByText(EXISTS('DB_HOST'))).toBeVisible();
    await expect(form(page).getByRole('textbox', { name: 'Value' })).toHaveValue('other');
    await expect(vars(page).getByText('db.internal.example.com', { exact: true })).toBeVisible();
    await expect(editButtons(page)).toHaveCount(3);
  });

  test('BR-14: TC-14.2: adding a variable named like the secret NPM_TOKEN shows the exists error and leaves the secret', async ({
    page,
  }) => {
    await openForm(page);
    await fillAndSubmit(page, 'NPM_TOKEN', 'x');
    await expect(form(page).getByText(EXISTS('NPM_TOKEN'))).toBeVisible();
    await expect(editButtons(page)).toHaveCount(3);
    await expect(row(page, 'NPM_TOKEN')).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'Secrets' }).getByRole('button', { name: 'Replace NPM_TOKEN' }),
    ).toBeVisible();
  });

  test('BR-14: TC-14.5: db_host is added next to DB_HOST (names are case-sensitive)', async ({ page }) => {
    await openForm(page);
    await fillAndSubmit(page, 'db_host', 'lower');
    await expect(row(page, 'db_host')).toBeVisible();
    await expect(row(page, 'DB_HOST')).toBeVisible();
    await expect(editButtons(page)).toHaveCount(4);
  });
});

test.describe('BR-25: value size', () => {
  test('BR-25: TC-25.1: a value of 8193 characters shows "Use 8 KiB or less." and adds nothing', async ({ page }) => {
    await openForm(page);
    await fillAndSubmit(page, 'BIG_ONE', 'v'.repeat(8193));
    await expect(form(page).getByText('Use 8 KiB or less.')).toBeVisible();
    await expect(row(page, 'BIG_ONE')).toHaveCount(0);
    await expect(editButtons(page)).toHaveCount(3);
  });

  test('BR-25: TC-25.3: a value of 8192 characters is added with no Value error', async ({ page }) => {
    await openForm(page);
    await fillAndSubmit(page, 'BIG_ONE', 'v'.repeat(8192));
    await expect(row(page, 'BIG_ONE')).toBeVisible();
    await expect(page.getByText('Use 8 KiB or less.')).toHaveCount(0);
    await expect(editButtons(page)).toHaveCount(4);
  });
});
