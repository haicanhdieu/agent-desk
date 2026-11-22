import { expect, test, type Page } from '@playwright/test';
import { ids } from '../../src/mocks/dto/ids';
import type { OnboardingScenario } from '../../src/mocks/msw/onboardingScenarios';
import { seedOnboarding } from './mock';

/*
 * Issue 216: a member or viewer cannot open the Desk configuration pages or the new-project wizard. Each Desk route
 * and the wizard shows the Forbidden page for a direct URL, no Desk data is requested, and the Desk tab and the
 * project Settings entry are not there. An admin still opens every page. Mock mode: MSW answers the API, and answers
 * 403 to a role without the permission, as the real guard does (see the local spec rbac-desk-access.spec.ts for the API).
 *
 * Every test seeds its scenario before the first goto (the mock store reseeds on each page load). The org is Acme;
 * its projects are invoicer-api (P1) and invoicer-web (P2).
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const P1 = ids.project.invoicerApi;
const TABS = ['agent', 'setup', 'skills', 'rules'] as const;
/** The API paths that carry Desk configuration (agent, skills, rules, setup script, plugins, setup tests, models). */
const DESK_DATA =
  /\/api\/(projects\/[^/]+\/(agent|skills|rules|setup-script|plugins|setup-tests)|agents\/|rules\/|setup-tests\/)/;

/** Records every API request the page sends from now on. */
function watchRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith('/api/')) seen.push(url.pathname);
  });
  return seen;
}

const forbidden = (page: Page) => page.getByRole('heading', { name: "You don't have access" });
/** The project row's action menu: the top bar's own Settings tab is outside it. */
const rowMenu = (page: Page) => page.getByRole('dialog', { name: 'Actions for invoicer-api' });

async function open(page: Page, scenario: OnboardingScenario, path: string): Promise<string[]> {
  await seedOnboarding(page, scenario);
  const seen = watchRequests(page);
  await page.goto(path);
  return seen;
}

for (const role of ['member', 'viewer'] as const) {
  test.describe(`a ${role}`, () => {
    for (const tab of TABS) {
      test(`sees Forbidden on the Desk ${tab} page by direct URL and nothing is requested`, async ({ page }) => {
        const seen = await open(page, role, `/o/acme/p/${P1}/desk/${tab}`);
        await expect(forbidden(page)).toBeVisible();
        expect(seen.filter((p) => DESK_DATA.test(p))).toEqual([]);
      });
    }

    test('sees Forbidden on the new project wizard by direct URL and the connections API is not called', async ({
      page,
    }) => {
      const seen = await open(page, role, '/o/acme/projects/new/repo');
      await expect(forbidden(page)).toBeVisible();
      expect(seen.filter((p) => p.startsWith('/api/connections'))).toEqual([]);
    });

    test('has no Desk tab on the runs page and no Desk data is requested there', async ({ page }) => {
      const seen = await open(page, role, `/o/acme/p/${P1}/runs`);
      await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /^Runs/ })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Desk' })).toHaveCount(0);
      expect(seen.filter((p) => DESK_DATA.test(p))).toEqual([]);
    });

    test('has no Settings entry in the project list row menu', async ({ page }) => {
      await open(page, role, '/o/acme/projects');
      await page.getByRole('button', { name: /^More for invoicer-api/ }).click();
      await expect(rowMenu(page).getByRole('link', { name: 'Runs' })).toBeVisible();
      await expect(rowMenu(page).getByRole('link', { name: 'Settings' })).toHaveCount(0);
    });
  });
}

test.describe('an admin', () => {
  for (const tab of TABS) {
    test(`opens the Desk ${tab} page by direct URL`, async ({ page }) => {
      await open(page, 'orgAdmin', `/o/acme/p/${P1}/desk/${tab}`);
      await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Desk' })).toBeVisible();
      await expect(forbidden(page)).toHaveCount(0);
    });
  }

  test('opens the new project wizard and sees the Desk tab and Settings entry', async ({ page }) => {
    await open(page, 'orgAdmin', '/o/acme/projects/new/repo');
    await expect(page.getByRole('heading', { level: 1, name: 'Connect a repository' })).toBeVisible();
    await expect(forbidden(page)).toHaveCount(0);
  });

  test('has the Settings entry in the project list row menu', async ({ page }) => {
    await open(page, 'orgAdmin', '/o/acme/projects');
    await page.getByRole('button', { name: /^More for invoicer-api/ }).click();
    await expect(rowMenu(page).getByRole('link', { name: 'Settings' })).toBeVisible();
  });
});
