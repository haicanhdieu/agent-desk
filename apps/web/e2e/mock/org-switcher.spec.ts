import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  INVOICER_API,
  ORG,
  SESSION_MOCK_NOW,
  holdReads,
  release,
  seedOnboarding,
  seedShell,
  seedTenantAdmin,
  setRead,
} from './mock';

/*
 * BR-53, keyboard in the project switcher while its list loads (spec 2026-11-25-sidebar-navigation-shell-design.md
 * "E2E requirements": TC-53.1, TC-53.3). The page needs the project list for its crumb, so the list is held with `setRead` after the page
 * has loaded (the switcher fetches it when it opens); the test releases it after the popover is open. Keyboard only. The org switcher cases (TC-53.2, TC-53.4) come with the org switcher states.
 */
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const PROJECT = `/o/${ORG}/p/${INVOICER_API}/runs`;
const switcher = (page: Page) => page.getByRole('button', { name: 'Switch project, currently invoicer-api' });

/** An org member on a project page, with the project list held. */
async function openHeld(page: Page): Promise<void> {
  await seedTenantAdmin(page, 'twoOwners');
  await page.goto(PROJECT);
  await expect(switcher(page)).toBeVisible();
  await setRead(page, 'projectList', 'hold');
}

test.describe('BR-53: keyboard while the project switcher loads', () => {
  test('TC-53.1: arrows move through the projects once they show', async ({ page }) => {
    await openHeld(page);
    await switcher(page).focus();
    await page.keyboard.press('Enter');
    const popover = page.getByRole('dialog', { name: 'Projects' });
    await expect(popover.getByRole('status')).toHaveText('Loading projects');
    await release(page, 'projectList');
    const links = popover.getByRole('link');
    await expect(links.first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(links.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(links.first()).toBeFocused();
  });

  test('TC-53.3: Escape closes the loading popover and focus returns to the button', async ({ page }) => {
    await openHeld(page);
    await switcher(page).focus();
    await page.keyboard.press('Enter');
    const popover = page.getByRole('dialog', { name: 'Projects' });
    await expect(popover.getByRole('status')).toHaveText('Loading projects');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Projects' })).toHaveCount(0);
    await expect(switcher(page)).toBeFocused();
  });
});

/*
 * The org switcher: scope choices only (BR-45), where each entry lands (BR-46), the plain-text name and how it turns
 * into text only once the person has left it (BR-47), the keyboard while the list loads (BR-53), and the loading and
 * failed states with the page behind them (BR-80). The list is held with `holdReads(page, { orgList: 'hold' })` before the
 * first goto and let go with `release`; `release(page, 'orgList', 'fail')` makes it, and every later request, answer 500.
 */
const bar = (page: Page): Locator => page.getByRole('banner').first();
const crumbs = (page: Page): Locator => bar(page).getByRole('navigation', { name: 'Breadcrumb' });
const orgSwitcher = (page: Page): Locator => bar(page).getByRole('button', { name: /^Switch scope/ });
const scopeMenu = (page: Page): Locator => page.getByRole('dialog', { name: 'Scope' });
const orgGroup = (page: Page): Locator => scopeMenu(page).getByRole('group', { name: 'Switch organization' });
const sideMenu = (page: Page): Locator => page.getByRole('navigation', { name: /^(Organization|Project) menu$/ });
/** A failing read is tried twice more, with growing pauses, before its error shows. */
const RETRIED = 15_000;
const ORG_PAGE = `/o/${ORG}/projects`;
const loadedOrgPage = (page: Page): Locator => page.getByRole('heading', { level: 1, name: 'Projects' });

async function openSwitcher(page: Page): Promise<Locator> {
  await orgSwitcher(page).click();
  await expect(scopeMenu(page)).toBeVisible();
  return scopeMenu(page);
}

test.describe('BR-45: the switcher shows scope choices only', () => {
  test('TC-45.1: Platform, a separator, the orgs with the current one checked and the suspended one labelled, a separator, Create organization', async ({
    page,
  }) => {
    await seedShell(page, 'adminTwoOrgsOneSuspended');
    await page.goto(ORG_PAGE);
    await expect(loadedOrgPage(page)).toBeVisible();
    const menu = await openSwitcher(page);
    await expect(menu.getByRole('link')).toHaveText([
      'Platform',
      /^Alice/,
      /^Acme\s*Suspended$/,
      'Create organization',
    ]);
    await expect(orgGroup(page).getByRole('link', { name: 'Alice' })).toHaveAttribute('aria-current', /.+/);
    await expect(orgGroup(page).getByRole('link', { name: /^Acme/ })).toContainText('Suspended');
    await expect(menu.getByRole('separator')).toHaveCount(2);
  });

  test('TC-45.2: a person with two orgs and no platform role sees only their orgs, the current one checked', async ({
    page,
  }) => {
    await seedOnboarding(page, 'twoOrgs');
    await page.goto(ORG_PAGE);
    await expect(loadedOrgPage(page)).toBeVisible();
    const menu = await openSwitcher(page);
    await expect(menu.getByRole('link')).toHaveText(['Alice', 'Acme']);
    await expect(orgGroup(page).getByRole('link', { name: 'Alice' })).toHaveAttribute('aria-current', /.+/);
    await expect(menu.getByText('Platform', { exact: true })).toHaveCount(0);
    await expect(menu.getByText('Create organization')).toHaveCount(0);
  });

  test('TC-45.3: a platform admin who owns an org sees no Projects, Org settings, Manage in Platform or Platform admin entry, on an org and a platform page', async ({
    page,
  }) => {
    await seedOnboarding(page, 'platformAdminOneOrg');
    for (const path of [ORG_PAGE, '/platform/orgs']) {
      await page.goto(path);
      await expect(orgSwitcher(page)).toBeVisible();
      const menu = await openSwitcher(page);
      for (const name of [
        'Projects',
        'Org settings',
        'Manage this org in Platform',
        'Manage in Platform',
        'Platform admin',
      ]) {
        await expect(menu.getByRole('link', { name, exact: true })).toHaveCount(0);
      }
    }
  });
});

test.describe('BR-46: the entries lead to their scope', () => {
  test("TC-46.1: picking org B from a Members page of A opens B's Projects page", async ({ page }) => {
    await seedOnboarding(page, 'twoOrgs');
    await page.goto(`/o/${ORG}/settings/members`);
    await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
    await openSwitcher(page);
    await orgGroup(page).getByRole('link', { name: 'Acme', exact: true }).click();
    await expect(page).toHaveURL(/\/o\/acme\/projects$/);
    await expect(loadedOrgPage(page)).toBeVisible();
  });

  test('TC-46.2: picking Platform opens the platform Organizations directory', async ({ page }) => {
    await seedOnboarding(page, 'platformAdminOneOrg');
    await page.goto(ORG_PAGE);
    await expect(loadedOrgPage(page)).toBeVisible();
    await openSwitcher(page);
    await scopeMenu(page).getByRole('link', { name: 'Platform', exact: true }).click();
    await expect(page).toHaveURL(/\/platform\/orgs$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Organizations' })).toBeVisible();
  });

  test('TC-46.3: picking Create organization opens the create organization form', async ({ page }) => {
    await seedOnboarding(page, 'platformAdminOneOrg');
    await page.goto(ORG_PAGE);
    await expect(loadedOrgPage(page)).toBeVisible();
    await openSwitcher(page);
    await scopeMenu(page).getByRole('link', { name: 'Create organization', exact: true }).click();
    await expect(page).toHaveURL(/\/platform\/orgs\/new$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Create an organization' })).toBeVisible();
  });
});

test.describe('BR-47: the plain-text org name', () => {
  test('TC-47.1: one org and no platform role: the name is text, with no switch button and no menu', async ({
    page,
  }) => {
    await seedOnboarding(page, 'singleOrg');
    await page.goto(ORG_PAGE);
    await expect(loadedOrgPage(page)).toBeVisible();
    await expect(crumbs(page).getByText('Alice', { exact: true })).toBeVisible();
    await expect(orgSwitcher(page)).toHaveCount(0);
    await expect(scopeMenu(page)).toHaveCount(0);
  });

  test('TC-47.2: no org and no platform role: "No organization" is text with no menu', async ({ page }) => {
    await seedOnboarding(page, 'noOrgUninvited');
    await page.goto('/invitations');
    await expect(crumbs(page).getByText('No organization', { exact: true })).toBeVisible();
    await expect(orgSwitcher(page)).toHaveCount(0);
    await expect(sideMenu(page)).toHaveCount(0);
  });

  test('TC-47.3: two orgs with no platform role, and a platform admin with one org, both get a button that opens a menu', async ({
    page,
  }) => {
    for (const scenario of ['twoOrgs', 'platformAdminOneOrg'] as const) {
      await seedOnboarding(page, scenario);
      await page.goto(ORG_PAGE);
      await expect(loadedOrgPage(page)).toBeVisible();
      await expect(orgSwitcher(page)).toBeVisible();
      await openSwitcher(page);
      await page.keyboard.press('Escape');
      await expect(scopeMenu(page)).toHaveCount(0);
    }
  });

  /** One org and no platform role, the list held: the switcher is open when the list is released. */
  async function openWhileHeld(page: Page, scenario: 'singleOrg' | 'noOrgUninvited' = 'singleOrg'): Promise<void> {
    await seedOnboarding(page, scenario);
    await holdReads(page, { orgList: 'hold' });
    await page.goto(scenario === 'singleOrg' ? ORG_PAGE : '/invitations');
    await expect(orgSwitcher(page)).toBeVisible();
    await orgSwitcher(page).click();
    await expect(scopeMenu(page).getByRole('status')).toHaveText('Loading organizations');
    await release(page, 'orgList');
  }

  test('TC-47.4: held, opened, then released: it stays a button and the popover lists the one org, checked', async ({
    page,
  }) => {
    await openWhileHeld(page);
    await expect(orgSwitcher(page)).toBeVisible();
    await expect(orgGroup(page).getByRole('link')).toHaveText(['Alice']);
    await expect(orgGroup(page).getByRole('link', { name: 'Alice' })).toHaveAttribute('aria-current', /.+/);
  });

  test('TC-47.5: it stays a button while focus is in the entries and after Escape, and becomes text after Tab away', async ({
    page,
  }) => {
    await openWhileHeld(page);
    const entry = orgGroup(page).getByRole('link', { name: 'Alice' });
    await expect(entry).toBeVisible();
    await entry.focus();
    await expect(orgSwitcher(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(scopeMenu(page)).toHaveCount(0);
    await expect(orgSwitcher(page)).toBeVisible();
    await expect(orgSwitcher(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(orgSwitcher(page)).toHaveCount(0);
    await expect(crumbs(page).getByText('Alice', { exact: true })).toBeVisible();
    // Focus moved to the next control of the bar (the bell is disabled), not lost to the page.
    await expect(page.getByRole('button', { name: /^Account menu for / })).toBeFocused();
  });

  test('TC-47.6: held, the closed switcher focused: it stays a button after release until focus leaves', async ({
    page,
  }) => {
    await seedOnboarding(page, 'singleOrg');
    await holdReads(page, { orgList: 'hold' });
    await page.goto(ORG_PAGE);
    await orgSwitcher(page).focus();
    await expect(orgSwitcher(page)).toBeFocused();
    await release(page, 'orgList');
    await expect(loadedOrgPage(page)).toBeVisible();
    await expect(orgSwitcher(page)).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(orgSwitcher(page)).toHaveCount(0);
    await expect(crumbs(page).getByText('Alice', { exact: true })).toBeVisible();
  });

  test('TC-47.7: held and open, released, a click on a control outside closes it and it becomes text', async ({
    page,
  }) => {
    await openWhileHeld(page);
    await expect(loadedOrgPage(page)).toBeVisible();
    const outside = sideMenu(page).getByRole('button', { name: /(Collapse|Expand) menu/ });
    await outside.click();
    await expect(scopeMenu(page)).toHaveCount(0);
    await expect(orgSwitcher(page)).toHaveCount(0);
    await expect(crumbs(page).getByText('Alice', { exact: true })).toBeVisible();
    await expect(outside).toBeFocused();
  });

  test('TC-47.8: no org, held and opened, released: "No organization" is an unpickable line; after Escape and Tab it is text', async ({
    page,
  }) => {
    await openWhileHeld(page, 'noOrgUninvited');
    await expect(scopeMenu(page).getByText('No organization', { exact: true })).toBeVisible();
    await expect(scopeMenu(page).getByRole('link')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    await expect(orgSwitcher(page)).toHaveCount(0);
    await expect(crumbs(page).getByText('No organization', { exact: true })).toBeVisible();
  });
});

test.describe('BR-53: keyboard while the org switcher loads', () => {
  test('TC-53.2: Enter on the held switcher, release, then ArrowDown moves through the entries', async ({ page }) => {
    await seedOnboarding(page, 'twoOrgs');
    await holdReads(page, { orgList: 'hold' });
    await page.goto('/invitations');
    await orgSwitcher(page).focus();
    await page.keyboard.press('Enter');
    await expect(scopeMenu(page).getByRole('status')).toHaveText('Loading organizations');
    await release(page, 'orgList');
    const links = scopeMenu(page).getByRole('link');
    await expect(links.first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(links.nth(1)).toBeFocused();
  });

  test('TC-53.4: Escape closes the loading popover and focus returns to the switcher', async ({ page }) => {
    await seedOnboarding(page, 'twoOrgs');
    await holdReads(page, { orgList: 'hold' });
    await page.goto('/invitations');
    await orgSwitcher(page).focus();
    await page.keyboard.press('Enter');
    await expect(scopeMenu(page).getByRole('status')).toHaveText('Loading organizations');
    await page.keyboard.press('Escape');
    await expect(scopeMenu(page)).toHaveCount(0);
    await expect(orgSwitcher(page)).toBeFocused();
  });
});

test.describe('BR-80: the switcher and the page behind it while the org list loads or fails', () => {
  const name = (page: Page): Locator => orgSwitcher(page);

  test('TC-80.1: held, the switcher shows the loading state and no org entry; the button reads "Organization"', async ({
    page,
  }) => {
    await seedOnboarding(page, 'twoOrgs');
    await holdReads(page, { orgList: 'hold' });
    await page.goto('/invitations');
    await expect(name(page)).toHaveText('Organization');
    await expect(name(page)).toHaveAccessibleName('Switch scope');
    await expect(bar(page)).not.toContainText('Alice');
    await expect(bar(page)).not.toContainText('No organization');
    await name(page).click();
    await expect(scopeMenu(page).getByRole('status')).toHaveText('Loading organizations');
    await expect(scopeMenu(page).getByRole('link')).toHaveCount(0);
    await expect(scopeMenu(page)).not.toContainText('No organization');
  });

  test('TC-80.2: failed, the switcher shows "Could not load your organizations." with Retry and no org entry', async ({
    page,
  }) => {
    await seedOnboarding(page, 'twoOrgs');
    await holdReads(page, { orgList: 'fail' });
    await page.goto('/invitations');
    await name(page).click();
    await expect(scopeMenu(page).getByText('Could not load your organizations.')).toBeVisible();
    await expect(scopeMenu(page).getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(scopeMenu(page).getByRole('link')).toHaveCount(0);
    await expect(name(page)).toHaveText('Organization');
  });

  test('TC-80.3: Retry by keyboard brings the organization entries', async ({ page }) => {
    await seedOnboarding(page, 'twoOrgs');
    await holdReads(page, { orgList: 'fail' });
    await page.goto('/invitations');
    await name(page).focus();
    await page.keyboard.press('Enter');
    const retry = scopeMenu(page).getByRole('button', { name: 'Retry' });
    await expect(retry).toBeVisible();
    await setRead(page, 'orgList', undefined);
    await retry.focus();
    await page.keyboard.press('Enter');
    await expect(scopeMenu(page).getByRole('link')).toHaveText(['Alice', 'Acme']);
  });

  test('TC-80.4: a known platform admin sees Platform and Create organization, the placeholder "Platform", no org entry, held and failed', async ({
    page,
  }) => {
    await seedOnboarding(page, 'platformAdminOneOrg');
    await holdReads(page, { orgList: 'hold' });
    await page.goto('/platform/orgs');
    await expect(name(page)).toHaveText('Platform');
    await name(page).click();
    await expect(scopeMenu(page).getByRole('link', { name: 'Platform', exact: true })).toBeVisible();
    await expect(scopeMenu(page).getByRole('link', { name: 'Create organization' })).toBeVisible();
    await expect(scopeMenu(page).getByRole('group', { name: 'Switch organization' })).toHaveCount(0);
    await release(page, 'orgList', 'fail');
    await expect(scopeMenu(page).getByText('Could not load your organizations.')).toBeVisible({ timeout: RETRIED });
    await expect(scopeMenu(page).getByRole('link', { name: 'Platform', exact: true })).toBeVisible();
    await expect(scopeMenu(page).getByRole('link', { name: 'Create organization' })).toBeVisible();
    await expect(name(page)).toHaveText('Platform');
  });

  test('TC-80.5: while the platform admin check is pending, there is no Platform or Create organization', async ({
    page,
  }) => {
    await seedOnboarding(page, 'platformAdminOneOrg');
    await holdReads(page, { orgList: 'hold', platformAdmin: 'pending' });
    await page.goto('/invitations');
    await name(page).click();
    await expect(scopeMenu(page).getByRole('status')).toHaveText('Loading organizations');
    await expect(scopeMenu(page).getByRole('link', { name: 'Platform', exact: true })).toHaveCount(0);
    await expect(scopeMenu(page).getByRole('link', { name: 'Create organization' })).toHaveCount(0);
  });

  test('TC-80.5: once the platform admin check has failed, there is still no Platform or Create organization', async ({
    page,
  }) => {
    await seedOnboarding(page, 'platformAdminOneOrg');
    await holdReads(page, { orgList: 'hold', platformAdmin: 'fail' });
    await page.goto('/invitations');
    await name(page).click();
    await expect(scopeMenu(page).getByRole('status')).toHaveText('Loading organizations');
    await release(page, 'orgList');
    await expect(orgGroup(page).getByRole('link')).toHaveText(['Alice']);
    // The failing check is tried twice more with growing pauses (1 s, 2 s) before it settles as failed.
    await page.waitForTimeout(4_000);
    await expect(scopeMenu(page).getByRole('link', { name: 'Platform', exact: true })).toHaveCount(0);
    await expect(scopeMenu(page).getByRole('link', { name: 'Create organization' })).toHaveCount(0);
  });

  test('TC-80.6: one org and no platform role, held: the switcher is an openable button with no org name', async ({
    page,
  }) => {
    await seedOnboarding(page, 'singleOrg');
    await holdReads(page, { orgList: 'hold' });
    await page.goto(ORG_PAGE);
    await expect(name(page)).toBeVisible();
    await expect(name(page)).toHaveText('Organization');
    await expect(bar(page)).not.toContainText('Alice');
    await name(page).click();
    await expect(scopeMenu(page)).toBeVisible();
  });

  /** A page whose menu may hold only its one everyone-item while the list is unknown. */
  const PAGES = [
    ['TC-80.7', 'an org Projects address', ORG_PAGE, 'Projects'],
    ['TC-80.8', 'a project Runs address', `/o/${ORG}/p/${INVOICER_API}/runs`, 'Runs'],
  ] as const;

  for (const [id, label, path, item] of PAGES) {
    test(`${id}: held on ${label}, the content waits and the menu holds only "${item}", with no name or gated item`, async ({
      page,
    }) => {
      await seedOnboarding(page, 'platformAdminOneOrg');
      await holdReads(page, { orgList: 'hold' });
      await page.goto(path);
      await expect(page.getByRole('main').getByRole('status', { name: 'Loading' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: /^(Projects|Runs)$/ })).toHaveCount(0);
      await expect(sideMenu(page).getByRole('link', { name: item, exact: true })).toBeVisible();
      // Exactly one item (the project menu's "All projects" back link is not an item).
      await expect(sideMenu(page).getByRole('link').filter({ hasNotText: 'All projects' })).toHaveCount(1);
      await expect(
        sideMenu(page).getByRole('link', { name: /^(Members|Invitations|Audit log|General|Manage in Platform)/ }),
      ).toHaveCount(0);
      await expect(sideMenu(page).getByRole('button', { name: 'Retry' })).toHaveCount(0);
      await expect(sideMenu(page).locator('[aria-busy="true"]')).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText('Alice');
      await expect(page.locator('body')).not.toContainText('invoicer-api');
    });
  }

  for (const [id, label, path, item] of [
    ['TC-80.9', 'an org page', ORG_PAGE, 'Projects'],
    ['TC-80.9', 'a project page', `/o/${ORG}/p/${INVOICER_API}/runs`, 'Runs'],
  ] as const) {
    test(`${id}: failed on ${label}, the content shows an error with Retry and the menu holds "${item}" with "Could not load the menu." and Retry`, async ({
      page,
    }) => {
      await seedOnboarding(page, 'platformAdminOneOrg');
      await holdReads(page, { orgList: 'fail' });
      await page.goto(path);
      await expect(page.getByRole('main').getByRole('button', { name: 'Retry' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: /^(Projects|Runs)$/ })).toHaveCount(0);
      const menu = sideMenu(page);
      await expect(menu.getByRole('link', { name: item, exact: true })).toBeVisible();
      await expect(menu.getByText('Could not load the menu.')).toBeVisible();
      await expect(menu.getByRole('button', { name: 'Retry' })).toBeVisible();
      await expect(
        menu.getByRole('link', { name: /^(Members|Invitations|Audit log|General|Manage in Platform)/ }),
      ).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText('Alice');
      await expect(page.locator('body')).not.toContainText('invoicer-api');
    });
  }

  test('TC-80.10: after the menu Retry the role items appear; the page loads after its own Retry at the latest', async ({
    page,
  }) => {
    await seedOnboarding(page, 'platformAdminOneOrg');
    await holdReads(page, { orgList: 'fail' });
    await page.goto(ORG_PAGE);
    await expect(sideMenu(page).getByText('Could not load the menu.')).toBeVisible({ timeout: RETRIED });
    await setRead(page, 'orgList', undefined);
    await sideMenu(page).getByRole('button', { name: 'Retry' }).click();
    await expect(sideMenu(page).getByRole('link', { name: 'Members', exact: true })).toBeVisible();
    const pageRetry = page.getByRole('main').getByRole('button', { name: 'Retry' });
    if (await pageRetry.isVisible()) await pageRetry.click();
    await expect(loadedOrgPage(page)).toBeVisible();
  });

  test('TC-80.11: a background refetch that fails keeps the last good list and shows no error', async ({ page }) => {
    await page.clock.install({ time: new Date(SESSION_MOCK_NOW) });
    await seedOnboarding(page, 'twoOrgs');
    await page.goto(ORG_PAGE);
    await expect(loadedOrgPage(page)).toBeVisible();
    // The list is stale after 30 s; the Members page mounts a new reader of it, which refetches in the background.
    await page.clock.fastForward(31_000);
    await setRead(page, 'orgList', 'fail');
    await sideMenu(page).getByRole('link', { name: 'Members', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
    await openSwitcher(page);
    await expect(orgGroup(page).getByRole('link')).toHaveText(['Alice', 'Acme']);
    await expect(scopeMenu(page).getByText('Could not load your organizations.')).toHaveCount(0);
  });
});
