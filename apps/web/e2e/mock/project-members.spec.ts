import { expect, test, type Locator, type Page } from '@playwright/test';
import { INVOICER_API, ORG, OTHER_PROJECT, seedProjectSpace } from './mock';

/*
 * Project admin space: the project Settings → Members page (access, list and states). Cases come from the spec
 * docs/superpowers/specs/2026-11-23-rbac-project-admin-space-design.md (E2E requirements, BR-1 to BR-4, BR-11, BR-15).
 *
 * Every test seeds its role and scenario before the first goto (the mock store reseeds on each page load). The org is
 * Alice; P is invoicer-api, and OTHER_PROJECT (invoicer-web) is a project a project admin of P does not administer.
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const P = INVOICER_API;
const membersUrl = (project: string) => `/o/${ORG}/p/${project}/desk/members`;
const forbidden = (page: Page) => page.getByRole('heading', { name: "You don't have access" });
const sideMenu = (page: Page) => page.getByRole('navigation', { name: 'Project menu' });
const rowOf = (page: Page, name: string): Locator => page.getByRole('row').filter({ hasText: name });

/** Records every API request path the page sends from now on. */
function watchRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith('/api/')) seen.push(url.pathname);
  });
  return seen;
}

test.describe('BR-1: Members and Audit log in the side menu', () => {
  for (const [tc, role] of [
    ['TC-1.1', 'owner'],
    ['TC-1.2', 'admin'],
    ['TC-1.3', 'projectAdmin'],
  ] as const) {
    test(`${tc}: the ${role} sees Members and Audit log under Access in the Project menu`, async ({ page }) => {
      await seedProjectSpace(page, { role });
      await page.goto(`/o/${ORG}/p/${P}/runs`);
      const menu = sideMenu(page);
      for (const name of ['Routing rules', 'Skills', 'Workspace setup', 'Agent & settings']) {
        await expect(menu.getByRole('link', { name })).toBeVisible();
      }
      await expect(menu.getByText('Access', { exact: true })).toBeVisible();
      await expect(menu.getByRole('link', { name: 'Members' })).toBeVisible();
      await expect(menu.getByRole('link', { name: 'Audit log' })).toBeVisible();
    });
  }

  for (const [tc, role] of [
    ['TC-1.4', 'member'],
    ['TC-1.5', 'viewer'],
  ] as const) {
    test(`${tc}: the ${role} has no configuration items, so no Members or Audit log`, async ({ page }) => {
      await seedProjectSpace(page, { role });
      await page.goto(`/o/${ORG}/p/${P}/runs`);
      const main = sideMenu(page);
      await expect(main.getByRole('link', { name: /^Runs/ })).toBeVisible();
      await expect(main.getByRole('link', { name: 'Routing rules' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Members' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Audit log' })).toHaveCount(0);
    });
  }

  test('TC-1.6: the clicked item is the active item and its page shows', async ({ page }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    await page.goto(`/o/${ORG}/p/${P}/desk/agent`);
    const menu = sideMenu(page);

    await menu.getByRole('link', { name: 'Members' }).click();
    await expect(menu.getByRole('link', { name: 'Members' })).toHaveAttribute('aria-current', 'page');
    await expect(menu.getByRole('link', { name: 'Audit log' })).not.toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();

    await menu.getByRole('link', { name: 'Audit log' }).click();
    await expect(menu.getByRole('link', { name: 'Audit log' })).toHaveAttribute('aria-current', 'page');
    await expect(menu.getByRole('link', { name: 'Members' })).not.toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();
  });
});

test.describe('BR-2: member and viewer get Forbidden on Members', () => {
  for (const [tc, role] of [
    ['TC-2.1', 'member'],
    ['TC-2.3', 'viewer'],
  ] as const) {
    test(`${tc}: a ${role} typing the Members URL sees Forbidden and no names`, async ({ page }) => {
      await seedProjectSpace(page, { role });
      const seen = watchRequests(page);
      await page.goto(membersUrl(P));
      await expect(forbidden(page)).toBeVisible();
      await expect(page.getByRole('table')).toHaveCount(0);
      await expect(page.getByText('Cleo Martin')).toHaveCount(0);
      expect(seen.filter((p) => p === `/api/projects/${P}/members`)).toEqual([]);
    });
  }
});

test.describe('BR-3: an admin of P only gets not found on another project', () => {
  test("TC-3.1: the Members URL of another project shows 'Page not found' and nothing of it", async ({ page }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    await page.goto(membersUrl(OTHER_PROJECT));
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.getByText('invoicer-web')).toHaveCount(0);
    await expect(page.getByText('Eli Ford')).toHaveCount(0);
  });
});

test.describe('BR-4: Members lists everyone with access: project roles and inherited org-wide roles', () => {
  test('TC-4.1: name (or handle), handle and role of each person, and the intro', async ({ page }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    await page.goto(`/o/${ORG}/p/${P}/desk/agent`);
    await sideMenu(page).getByRole('link', { name: 'Members' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
    await expect(
      page.getByText(
        'People with access to this project. A role in Alice also applies here. Those people are labelled Organization and are managed in Alice Settings, Members.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Role' })).toBeVisible();

    const cleo = rowOf(page, 'Cleo Martin');
    await expect(cleo).toContainText('cleo');
    await expect(cleo).toContainText('Member');
    const dana = rowOf(page, 'Dana Wu');
    await expect(dana).toContainText('dana');
    await expect(dana).toContainText('Viewer');
    await expect(rowOf(page, 'Lee Park')).toContainText('Admin');
  });

  test('TC-4.2: 25 rows are paged by name, page 2 holds the rest and no row repeats', async ({ page }) => {
    await seedProjectSpace(page, { role: 'owner', scenario: 'membersPaged' });
    await page.goto(membersUrl(P));
    await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
    const pager = page.getByRole('navigation', { name: 'Pagination' });

    await expect(pager.locator('p')).toHaveText('Showing 1–20 of 25');
    await expect(page.locator('tbody tr')).toHaveCount(20);
    const firstNames = (await page.locator('tbody tr td:first-child').allInnerTexts()).map(
      (t) => t.split('\n')[0]?.trim() ?? '',
    );

    await pager.getByRole('button', { name: 'Page 2', exact: true }).click();
    await expect(pager.locator('p')).toHaveText('Showing 21–25 of 25');
    await expect(page.locator('tbody tr')).toHaveCount(5);
    const secondNames = (await page.locator('tbody tr td:first-child').allInnerTexts()).map(
      (t) => t.split('\n')[0]?.trim() ?? '',
    );

    expect(new Set([...firstNames, ...secondNames]).size).toBe(25);
    const sorted = [...firstNames, ...secondNames];
    expect(sorted).toEqual([...sorted].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  test('TC-4.3: a person with several project roles shows them joined with ", "', async ({ page }) => {
    await seedProjectSpace(page, { role: 'owner' });
    await page.goto(membersUrl(P));
    await expect(rowOf(page, 'Ben Okafor').getByRole('cell').nth(1)).toHaveText('Member, Viewer');
  });
});

test.describe('BR-4: inherited org-wide rows', () => {
  test('TC-4.4: an org-wide person shows the org role with an Organization label and no Change role or Remove', async ({
    page,
  }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    await page.goto(membersUrl(P));
    const iris = rowOf(page, 'Iris Novak');
    await expect(iris.getByRole('cell').nth(1)).toContainText('Owner');
    await expect(iris.getByRole('cell').nth(1)).toContainText('Organization');
    await expect(iris.getByRole('button')).toHaveCount(0);
  });

  test('TC-4.5: a person with an org role and a project role shows both and keeps the row menu', async ({ page }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    await page.goto(membersUrl(P));
    const omar = rowOf(page, 'Omar Reyes');
    await expect(omar.getByRole('cell').nth(1)).toContainText('Member');
    await expect(omar.getByRole('cell').nth(1)).toContainText('Viewer');
    await expect(omar.getByRole('cell').nth(1)).toContainText('Organization');
    await expect(omar.getByRole('button', { name: 'Actions for Omar Reyes' })).toBeVisible();
  });

  test('TC-4.6: the Add picker does not offer org-wide people', async ({ page }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    await page.goto(membersUrl(P));
    await page.getByRole('button', { name: 'Add member' }).first().click();
    const dialog = page.getByRole('dialog', { name: /^Add member to/ });
    await dialog.getByRole('combobox', { name: 'Person' }).click();
    await expect(page.getByRole('option').first()).toBeVisible();
    await expect(page.getByRole('option').filter({ hasText: 'Iris Novak' })).toHaveCount(0);
    await expect(page.getByRole('option').filter({ hasText: 'Omar Reyes' })).toHaveCount(0);
  });
});

test.describe('BR-11: no row actions on your own row', () => {
  test('TC-11.1: own row is tagged You with no menu; other rows have Actions for <name>', async ({ page }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    await page.goto(membersUrl(P));
    const own = rowOf(page, 'Lee Park');
    await expect(own).toContainText('You');
    await expect(own.getByRole('button', { name: /^Actions for/ })).toHaveCount(0);
    for (const name of ['Cleo Martin', 'Dana Wu', 'Ben Okafor']) {
      await expect(rowOf(page, name).getByRole('button', { name: `Actions for ${name}` })).toBeVisible();
    }
  });
});

test.describe('BR-15: loading, error and empty states', () => {
  test('TC-15.1: skeleton rows show until the list arrives, then the rows', async ({ page }) => {
    await seedProjectSpace(page, { role: 'owner', scenario: 'membersSlow' });
    await page.goto(membersUrl(P));
    await expect(page.getByRole('status', { name: 'Loading' })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(rowOf(page, 'Cleo Martin')).toBeVisible();
    await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0);
  });

  test('TC-15.2: the error Banner has the request id and Retry shows the list', async ({ page }) => {
    await seedProjectSpace(page, { role: 'owner', scenario: 'membersError' });
    await page.goto(membersUrl(P));
    await expect(page.getByText('Internal server error')).toBeVisible();
    await expect(page.getByText(/Request ID: \S+/)).toBeVisible();
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(rowOf(page, 'Cleo Martin')).toBeVisible();
    await expect(page.getByText('Internal server error')).toHaveCount(0);
  });

  test('TC-15.3: no project roles shows the empty state with Add member and no rows', async ({ page }) => {
    await seedProjectSpace(page, { role: 'owner', scenario: 'membersEmpty' });
    await page.goto(membersUrl(P));
    await expect(page.getByRole('heading', { name: 'No project roles yet' })).toBeVisible();
    await expect(page.getByText('Add a member of Alice to give them a role on this project.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add member' })).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(0);
  });

  test('TC-15.4: a list with rows shows no empty state and no error Banner', async ({ page }) => {
    await seedProjectSpace(page, { role: 'owner' });
    await page.goto(membersUrl(P));
    await expect(rowOf(page, 'Cleo Martin')).toBeVisible();
    await expect(page.getByText('No project roles yet')).toHaveCount(0);
    await expect(page.getByText('Internal server error')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  });
});
