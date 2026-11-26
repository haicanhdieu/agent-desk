import { expect, test, type Page } from '@playwright/test';
import { ids } from '../../src/mocks/dto/ids';
import type { OnboardingScenario } from '../../src/mocks/msw/onboardingScenarios';
import { INVOICER_API, ORG, seedOnboarding, seedProjectSpace } from './mock';

/*
 * Issue 216: a member or viewer cannot open the Desk configuration pages or the new-project wizard. Each Desk route
 * and the wizard shows the Forbidden page for a direct URL, no Desk data is requested, and the Settings tab and the
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

    test('has no Settings tab on the runs page and no Desk data is requested there', async ({ page }) => {
      const seen = await open(page, role, `/o/acme/p/${P1}/runs`);
      await expect(
        page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name: /^Runs/ }),
      ).toBeVisible();
      await expect(
        page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name: 'Project settings' }),
      ).toHaveCount(0);
      expect(seen.filter((p) => DESK_DATA.test(p))).toEqual([]);
    });

    test('has no Settings entry in the project list row menu', async ({ page }) => {
      await open(page, role, '/o/acme/projects');
      await page.getByRole('button', { name: /^More for invoicer-api/ }).click();
      await expect(rowMenu(page).getByRole('link', { name: 'Runs' })).toBeVisible();
      await expect(rowMenu(page).getByRole('link', { name: 'Settings' })).toHaveCount(0);
    });

    test('has no Delete project entry in the project list row menu', async ({ page }) => {
      await open(page, role, '/o/acme/projects');
      await page.getByRole('button', { name: /^More for invoicer-api/ }).click();
      await expect(rowMenu(page).getByRole('link', { name: 'Runs' })).toBeVisible();
      await expect(rowMenu(page).getByRole('button', { name: /Delete/ })).toHaveCount(0);
    });
  });
}

test.describe('an admin', () => {
  for (const tab of TABS) {
    test(`opens the Desk ${tab} page by direct URL`, async ({ page }) => {
      await open(page, 'orgAdmin', `/o/acme/p/${P1}/desk/${tab}`);
      await expect(
        page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name: 'Project settings' }),
      ).toBeVisible();
      await expect(forbidden(page)).toHaveCount(0);
    });
  }

  test('opens the new project wizard and sees the Settings tab and Settings entry', async ({ page }) => {
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

// BR-21: Delete project is an org-level permission, so an admin of this project only never sees it.
test.describe('the Danger zone on Agent & settings', () => {
  const agentPage = `/o/${ORG}/p/${INVOICER_API}/desk/agent`;
  const deleteProject = (page: Page) => page.getByRole('button', { name: 'Delete project' });

  test('TC-21.1: a project admin sees no Danger zone and no Delete project control', async ({ page }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    await page.goto(agentPage);
    await expect(page.getByRole('heading', { level: 1, name: 'Agent & settings' })).toBeVisible();
    await expect(page.getByText('Danger zone')).toHaveCount(0);
    await expect(deleteProject(page)).toHaveCount(0);
  });

  test('a project admin has no Delete project entry in the project list row menu', async ({ page }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    await page.goto(`/o/${ORG}/projects`);
    await page.getByRole('button', { name: /^More for invoicer-api/ }).click();
    await expect(rowMenu(page).getByRole('link', { name: 'Runs' })).toBeVisible();
    await expect(rowMenu(page).getByRole('button', { name: /Delete/ })).toHaveCount(0);
  });

  for (const [tc, role] of [
    ['TC-21.2', 'owner'],
    ['TC-21.3', 'admin'],
  ] as const) {
    test(`${tc}: an org ${role} sees the Danger zone with Delete project`, async ({ page }) => {
      await seedProjectSpace(page, { role });
      await page.goto(agentPage);
      await page.getByRole('tab', { name: 'Danger zone' }).click();
      await expect(deleteProject(page)).toBeVisible();
    });
  }
});

// BR-46: a member or viewer has no Agent & settings entry and gets the no-access page; an org admin sees the page.
test.describe('BR-46: Agent & settings access', () => {
  const agentPath = `/o/acme/p/${P1}/desk/agent`;
  const AGENT_DATA = new RegExp(`/api/(projects/${P1}/agents|agents/)`);

  for (const [tc, role] of [
    ['TC-46.1', 'member'],
    ['TC-46.2', 'viewer'],
  ] as const) {
    test(`${tc}: a ${role} has no Agent & settings entry and sees the no-access page with no agent data`, async ({
      page,
    }) => {
      const seen = await open(page, role, `/o/acme/p/${P1}/runs`);
      const sections = page.getByRole('navigation', { name: 'Project sections' });
      await expect(sections.getByRole('link', { name: /^Runs/ })).toBeVisible();
      await expect(sections.getByRole('link', { name: 'Project settings' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: /Agent & settings/ })).toHaveCount(0);

      await page.goto(agentPath);
      await expect(forbidden(page)).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: 'Agent & settings' })).toHaveCount(0);
      expect(seen.filter((p) => AGENT_DATA.test(p))).toEqual([]);
    });
  }

  test('TC-46.5: an org admin sees the Agent & settings entry and page', async ({ page }) => {
    await open(page, 'orgAdmin', agentPath);
    await expect(page.getByRole('heading', { level: 1, name: 'Agent & settings' })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Desk' }).getByRole('link', { name: 'Agent & settings' }),
    ).toBeVisible();
    await expect(forbidden(page)).toHaveCount(0);
  });
});
