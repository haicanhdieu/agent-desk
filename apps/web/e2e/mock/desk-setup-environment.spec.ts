import { expect, test, type Page } from '@playwright/test';
import { ids } from '../../src/mocks/dto/ids';
import type { OnboardingScenario } from '../../src/mocks/msw/onboardingScenarios';
import { seedOnboarding } from './mock';

/*
 * Workspace setup, Environment tab (issue 176), mock side: who can open it, the empty states, the copy that tells
 * what a change reaches, and the read-only state. Each test seeds its scenario before the first goto (the mock store
 * reseeds on each page load), so none reloads: they move between tabs by click. The org is Acme; invoicer-api (P1)
 * has 3 variables and 2 secrets, invoicer-web (P2) has none.
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const P1 = ids.project.invoicerApi;
const P2 = ids.project.invoicerWeb;
const ENV = `/o/acme/p/${P1}/desk/setup?tab=environment`;

const forbidden = (page: Page) => page.getByRole('heading', { name: "You don't have access" });
const vars = (page: Page) => page.getByRole('region', { name: 'Environment variables' });
const secrets = (page: Page) => page.getByRole('region', { name: 'Secrets' });
const READ_ONLY = 'You can see these but not change them.';
const VAR_EMPTY = 'No environment variables yet. Add one to pass a setting to every run.';
const SECRET_EMPTY = 'No secrets yet. Add one for the tokens and passwords your setup or agent needs.';

async function open(page: Page, scenario: OnboardingScenario, path: string) {
  await seedOnboarding(page, scenario);
  await page.goto(path);
}

test.describe('BR-1: a member or viewer sees Forbidden and no entry', () => {
  test('BR-1: TC-1.1: a member opening the Environment tab sees Forbidden, no tab strip, no names or values', async ({
    page,
  }) => {
    await open(page, 'member', ENV);
    await expect(forbidden(page)).toBeVisible();
    await expect(page.getByRole('tablist')).toHaveCount(0);
    await expect(page.getByRole('tab')).toHaveCount(0);
    for (const text of [
      'DB_HOST',
      'LOG_LEVEL',
      'REGION',
      'NPM_TOKEN',
      'SENTRY_DSN',
      'db.internal.example.com',
      'eu-west-1',
    ]) {
      await expect(page.getByText(text)).toHaveCount(0);
    }
  });

  test('BR-1: TC-1.2: a viewer opening the Environment tab sees Forbidden with no names or values', async ({
    page,
  }) => {
    await open(page, 'viewer', ENV);
    await expect(forbidden(page)).toBeVisible();
    for (const text of [
      'DB_HOST',
      'LOG_LEVEL',
      'REGION',
      'NPM_TOKEN',
      'SENTRY_DSN',
      'db.internal.example.com',
      'eu-west-1',
    ]) {
      await expect(page.getByText(text)).toHaveCount(0);
    }
  });

  test('BR-1: TC-1.3: a member opening the setup page without a tab sees Forbidden', async ({ page }) => {
    await open(page, 'member', `/o/acme/p/${P1}/desk/setup`);
    await expect(forbidden(page)).toBeVisible();
    await expect(page.getByRole('tab')).toHaveCount(0);
  });
});

test.describe('BR-3: an owner or admin sees both lists with write controls', () => {
  async function expectWriteControls(page: Page) {
    await expect(vars(page).getByRole('heading', { name: 'Environment variables' })).toBeVisible();
    await expect(vars(page).getByRole('button', { name: 'Add variable' })).toBeVisible();
    for (const name of ['DB_HOST', 'LOG_LEVEL', 'REGION']) {
      await expect(vars(page).getByRole('button', { name: `Edit ${name}` })).toBeVisible();
      await expect(vars(page).getByRole('button', { name: `Remove ${name}` })).toBeVisible();
    }
    await expect(secrets(page).getByRole('heading', { name: 'Secrets' })).toBeVisible();
    await expect(secrets(page).getByRole('button', { name: 'Add secret' })).toBeVisible();
    for (const name of ['NPM_TOKEN', 'SENTRY_DSN']) {
      await expect(secrets(page).getByRole('button', { name: `Replace ${name}` })).toBeVisible();
      await expect(secrets(page).getByRole('button', { name: `Remove ${name}` })).toBeVisible();
    }
  }

  test('BR-3: TC-3.1: the owner presses the Environment tab and sees both lists with Add, Edit, Replace and Remove', async ({
    page,
  }) => {
    await open(page, 'owner', `/o/acme/p/${P1}/desk/setup`);
    await page.getByRole('tab', { name: 'Environment' }).click();
    await expect(page).toHaveURL(/\?tab=environment/);
    await expectWriteControls(page);
  });

  test('BR-3: TC-3.2: an org admin opening the Environment tab sees the same lists and controls', async ({ page }) => {
    await open(page, 'orgAdmin', ENV);
    await expectWriteControls(page);
  });

  test('BR-3: TC-3.3: the owner sees no read-only note', async ({ page }) => {
    await open(page, 'owner', ENV);
    await expect(vars(page).getByRole('button', { name: 'Add variable' })).toBeVisible();
    await expect(page.getByText(READ_ONLY)).toHaveCount(0);
  });
});

test.describe('BR-5: empty states', () => {
  test('BR-5: TC-5.1: a project with no entries shows both empty states with Add buttons and no count', async ({
    page,
  }) => {
    await open(page, 'owner', `/o/acme/p/${P2}/desk/setup?tab=environment`);
    await expect(vars(page).getByText(VAR_EMPTY)).toBeVisible();
    await expect(vars(page).getByRole('button', { name: 'Add variable' })).toBeVisible();
    await expect(secrets(page).getByText(SECRET_EMPTY)).toBeVisible();
    await expect(secrets(page).getByRole('button', { name: 'Add secret' })).toBeVisible();
    await expect(vars(page).getByText(/^\d+ variables?$/)).toHaveCount(0);
    await expect(secrets(page).getByText(/^\d+ secrets?$/)).toHaveCount(0);
  });

  test('BR-5: TC-5.2: a project with entries shows neither empty text', async ({ page }) => {
    await open(page, 'owner', ENV);
    await expect(vars(page).getByText('DB_HOST', { exact: true })).toBeVisible();
    await expect(page.getByText(VAR_EMPTY)).toHaveCount(0);
    await expect(page.getByText(SECRET_EMPTY)).toHaveCount(0);
  });

  test('BR-5: TC-5.3: adding DB_HOST removes the variables empty text and keeps the secrets one', async ({ page }) => {
    await open(page, 'owner', `/o/acme/p/${P2}/desk/setup?tab=environment`);
    await expect(vars(page).getByText(VAR_EMPTY)).toBeVisible();
    await vars(page).getByRole('button', { name: 'Add variable' }).click();
    await vars(page).getByRole('textbox', { name: 'Name' }).fill('DB_HOST');
    await vars(page).getByRole('textbox', { name: 'Value' }).fill('db');
    await vars(page).getByRole('group', { name: 'Add variable' }).getByRole('button', { name: 'Add variable' }).click();
    await expect(vars(page).getByText('DB_HOST', { exact: true })).toBeVisible();
    await expect(vars(page).getByText(VAR_EMPTY)).toHaveCount(0);
    await expect(secrets(page).getByText(SECRET_EMPTY)).toBeVisible();
  });
});

test.describe('BR-20: the tab says what a change reaches', () => {
  test('BR-20: TC-20.1: the intro says a running run keeps its old values and no restart control is on the page', async ({
    page,
  }) => {
    await open(page, 'owner', ENV);
    await expect(
      page.getByText(
        'Every run and setup test in this project gets these as environment variables. Runs and tests that start after you save use the new values. A running run keeps its old ones: stop its session and resume it to pick up the change.',
      ),
    ).toBeVisible();
    await expect(page.getByText('A running run keeps its old ones')).toBeVisible();
    await expect(page.getByRole('button', { name: /restart/i })).toHaveCount(0);
  });

  test('BR-20: TC-20.2: removing DB_HOST asks with the text about runs that start after and running runs', async ({
    page,
  }) => {
    await open(page, 'owner', ENV);
    await page.getByRole('button', { name: 'Remove DB_HOST' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Runs that start after this do not get it. Running runs keep it.')).toBeVisible();
  });
});

test.describe('BR-24: plain values and the script hint', () => {
  test('BR-24: TC-24.1: the variables group says plain values are shown and not hidden in logs', async ({ page }) => {
    await open(page, 'owner', ENV);
    await expect(
      vars(page).getByText(
        'Plain values are shown in full and are not hidden in logs. Put anything sensitive in Secrets.',
      ),
    ).toBeVisible();
  });

  test('BR-24: TC-24.2: the Setup script tab points secrets to the Environment tab', async ({ page }) => {
    await open(page, 'owner', `/o/acme/p/${P1}/desk/setup`);
    await expect(
      page.getByText(
        "Don't put passwords or tokens here. Add them as secrets on the Environment tab. Runs that start after you save use the new version; running runs keep theirs.",
      ),
    ).toBeVisible();
  });
});

test.describe('BR-29: a role that reads setup but cannot change it', () => {
  test('BR-29: TC-29.1: the setup reader sees both lists, secrets without values, and the read-only note', async ({
    page,
  }) => {
    await open(page, 'setupReader', ENV);
    await expect(page.getByText(READ_ONLY)).toBeVisible();
    for (const [name, value] of [
      ['DB_HOST', 'db.internal.example.com'],
      ['LOG_LEVEL', 'info'],
      ['REGION', 'eu-west-1'],
    ]) {
      await expect(vars(page).getByText(name, { exact: true })).toBeVisible();
      await expect(vars(page).getByText(value, { exact: true })).toBeVisible();
    }
    for (const name of ['NPM_TOKEN', 'SENTRY_DSN']) {
      await expect(secrets(page).getByText(name, { exact: true })).toBeVisible();
    }
    await expect(secrets(page).getByText(/Set .* by kim-hale/)).toHaveCount(2);
    await expect(secrets(page).getByRole('list')).not.toContainText(/db\.internal|eu-west-1/);
  });

  test('BR-29: TC-29.2: the setup reader has no Add, Edit, Replace or Remove control in either list', async ({
    page,
  }) => {
    await open(page, 'setupReader', ENV);
    await expect(vars(page).getByText('DB_HOST', { exact: true })).toBeVisible();
    await expect(secrets(page).getByText('NPM_TOKEN', { exact: true })).toBeVisible();
    for (const group of [vars(page), secrets(page)]) {
      await expect(group.getByRole('button', { name: /^(Add|Edit|Replace|Remove)/ })).toHaveCount(0);
    }
  });

  test('BR-29: TC-29.3: the owner sees no read-only note and the write controls', async ({ page }) => {
    await open(page, 'owner', ENV);
    await expect(vars(page).getByRole('button', { name: 'Add variable' })).toBeVisible();
    await expect(secrets(page).getByRole('button', { name: 'Add secret' })).toBeVisible();
    await expect(page.getByText(READ_ONLY)).toHaveCount(0);
  });
});
