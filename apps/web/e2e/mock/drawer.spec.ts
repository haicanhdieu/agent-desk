import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  INVOICER_API,
  ORG,
  SCRIPTED_RUN,
  seedLists,
  seedOnboarding,
  seedPlatform,
  seedProjectSpace,
  seedShell,
  startSignedOut,
} from './mock';

/*
 * The side menu below 1024px (spec 2026-11-25-sidebar-navigation-shell-design.md "E2E requirements": BR-59 the menu
 * button, BR-61 drawer content and picking, BR-62 dismissal).
 * Every case runs at 390 wide with touch, except where it sets another width. The end state of each transition is
 * awaited with web assertions, never a sleep.
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US', hasTouch: true, viewport: { width: 390, height: 844 } });

const ALICE_ORG = 'b6000000-0000-4000-8000-000000000001';
const openMenu = (page: Page): Locator => page.getByRole('button', { name: 'Open menu' });
const drawer = (page: Page): Locator => page.getByRole('dialog', { name: 'Main menu' });
const menu = (page: Page, name: string): Locator => page.getByRole('navigation', { name });
const orgMenu = (page: Page): Locator => menu(page, 'Organization menu');
const projectMenu = (page: Page): Locator => menu(page, 'Project menu');
const anyMenu = (page: Page): Locator => page.getByRole('navigation', { name: /menu$/ });

const runsUrl = `/o/${ORG}/p/${INVOICER_API}/runs`;

/** The labels of the menu's links, with the needs-you badge text left off the Runs label. */
async function labelsOf(nav: Locator): Promise<string[]> {
  return (await nav.getByRole('link').allTextContents()).map((t) => t.replace(/\d+ needs you$/, '').trim());
}

async function openDrawer(page: Page): Promise<Locator> {
  await openMenu(page).tap();
  await expect(drawer(page)).toBeVisible();
  return drawer(page);
}

test.describe('BR-59: the menu button below 1024', () => {
  test('TC-59.1: at 1024 the fixed side menu shows with no "Open menu"; at 1023 only the button is there', async ({
    page,
  }) => {
    await seedOnboarding(page, 'owner');
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto('/o/acme/settings/members');
    await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible();
    await expect(orgMenu(page)).toBeVisible();
    await expect(openMenu(page)).toHaveCount(0);

    await page.setViewportSize({ width: 1023, height: 800 });
    await expect(openMenu(page)).toBeVisible();
    await expect(page.getByRole('banner').first().getByRole('button', { name: 'Open menu' })).toBeVisible();
    await expect(orgMenu(page)).toHaveCount(0);
    await expect(drawer(page)).toHaveCount(0);
  });

  test('TC-59.2: a platform admin who owns the org has "Open menu" and no fixed menu on every kind of page', async ({
    page,
  }) => {
    await seedPlatform(page, 'platformAdminMemberOrg');
    const pages = [
      `/o/${ORG}/projects`,
      runsUrl,
      `/o/${ORG}/p/${INVOICER_API}/runs/${SCRIPTED_RUN}`,
      '/platform/orgs',
      `/platform/orgs/${ALICE_ORG}`,
      '/invitations',
    ];
    for (const path of pages) {
      await page.goto(path);
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('banner').first().getByRole('button', { name: 'Open menu' })).toBeVisible();
      await expect(anyMenu(page)).toHaveCount(0);
    }
  });

  test('TC-59.3: in the wizard the drawer holds the stepper "Setup progress" without "Exit setup"', async ({
    page,
  }) => {
    await seedOnboarding(page, 'owner');
    await page.goto('/o/acme/projects/new/repo');
    await expect(page.getByRole('heading', { name: 'Connect a repository', level: 1 })).toBeVisible();
    const panel = await openDrawer(page);
    await expect(panel.getByRole('complementary', { name: 'Setup progress' })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Exit setup' })).toHaveCount(0);
    await expect(panel.getByText('Exit setup')).toHaveCount(0);
  });

  test('TC-59.4: sign-in, a suspended org page and a not-found page have no "Open menu"', async ({ browser }) => {
    const fresh = async (seed: (p: Page) => Promise<void>, path: string): Promise<Page> => {
      const context = await browser.newContext({
        hasTouch: true,
        viewport: { width: 390, height: 844 },
        timezoneId: 'UTC',
        locale: 'en-US',
      });
      const p = await context.newPage();
      await seed(p);
      await p.goto(path);
      return p;
    };

    const signIn = await fresh(startSignedOut, '/sign-in');
    await expect(signIn.getByRole('link', { name: 'Sign in with GitHub' })).toBeVisible();
    await expect(openMenu(signIn)).toHaveCount(0);
    await signIn.context().close();

    const suspended = await fresh((p) => seedShell(p, 'suspendedOnly'), `/o/${ORG}/projects`);
    await expect(suspended.getByRole('main')).toBeVisible();
    await expect(suspended.getByRole('banner').first()).toBeVisible();
    await expect(openMenu(suspended)).toHaveCount(0);
    await expect(anyMenu(suspended)).toHaveCount(0);
    await suspended.context().close();

    const missing = await fresh((p) => seedOnboarding(p, 'twoOrgs'), '/o/zephyr-foreign/projects');
    await expect(missing.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(openMenu(missing)).toHaveCount(0);
    await expect(anyMenu(missing)).toHaveCount(0);
    await missing.context().close();
  });
});

test.describe('BR-61: drawer content and picking', () => {
  test('TC-61.1: an owner on project Runs gets the same items as at 1440, with "Close menu" for "Collapse menu"', async ({
    page,
  }) => {
    await seedProjectSpace(page, { role: 'owner' });
    await seedLists(page, { needsYou: 1 });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(runsUrl);
    await expect(projectMenu(page).getByRole('link', { name: /^Runs/ })).toHaveAccessibleName(/1 needs you/);
    await expect(projectMenu(page).getByRole('button', { name: 'Collapse menu' })).toBeVisible();
    const desktop = await labelsOf(projectMenu(page));
    expect(desktop).toEqual([
      'All projects',
      'Runs',
      'Routing rules',
      'Skills',
      'Workspace setup',
      'Agent & settings',
      'Members',
      'Audit log',
      'Open repository',
    ]);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(projectMenu(page)).toHaveCount(0);
    const panel = await openDrawer(page);
    const nav = panel.getByRole('navigation', { name: 'Project menu' });
    expect(await labelsOf(nav)).toEqual(desktop);
    const runs = nav.getByRole('link', { name: /^Runs/ });
    await expect(runs).toHaveAccessibleName(/1 needs you/);
    await expect(runs).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('region', { name: 'Repository' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Close menu' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Collapse menu' })).toHaveCount(0);
  });

  test('TC-61.2: a member gets "All projects", Runs with its badge and the repository block only', async ({ page }) => {
    await seedProjectSpace(page, { role: 'member' });
    await seedLists(page, { needsYou: 1 });
    await page.goto(runsUrl);
    const panel = await openDrawer(page);
    const nav = panel.getByRole('navigation', { name: 'Project menu' });
    await expect.poll(() => labelsOf(nav)).toEqual(['All projects', 'Runs', 'Open repository']);
    await expect(nav.getByRole('link', { name: /^Runs/ })).toHaveAccessibleName(/1 needs you/);
    await expect(nav.getByRole('region', { name: 'Repository' })).toBeVisible();
    await expect(nav.getByText('Configure', { exact: true })).toHaveCount(0);
    await expect(nav.getByText('Access', { exact: true })).toHaveCount(0);
  });

  test('TC-61.3: picking Skills opens it, closes the drawer and moves focus to the main', async ({ page }) => {
    await seedProjectSpace(page, { role: 'owner' });
    await page.goto(runsUrl);
    const panel = await openDrawer(page);
    await panel.getByRole('navigation', { name: 'Project menu' }).getByRole('link', { name: 'Skills' }).tap();

    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/${INVOICER_API}/desk/skills$`));
    await expect(drawer(page)).toHaveCount(0);
    await expect(page.getByRole('main')).toBeFocused();
  });

  test('TC-61.4: a platform admin who is org admin sees Projects, the Settings items and "Manage in Platform", and picks Members', async ({
    page,
  }) => {
    await seedPlatform(page, 'platformAdminMemberOrg');
    await page.goto(`/o/${ORG}/projects`);
    const panel = await openDrawer(page);
    const nav = panel.getByRole('navigation', { name: 'Organization menu' });
    await expect(nav.getByRole('link')).toHaveText([
      'Projects',
      'Members',
      'Invitations',
      'Audit log',
      'General',
      'Manage in Platform',
    ]);
    await nav.getByRole('link', { name: 'Members', exact: true }).tap();

    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/settings/members$`));
    await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible();
    await expect(drawer(page)).toHaveCount(0);
  });
});

test.describe('BR-62: drawer dismissal', () => {
  const MEMBERS = '/o/acme/settings/members';

  async function openOnMembers(page: Page): Promise<void> {
    await seedOnboarding(page, 'owner');
    await page.goto(MEMBERS);
    await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible();
    await openDrawer(page);
  }

  async function expectClosedUnchanged(page: Page): Promise<void> {
    await expect(drawer(page)).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`${MEMBERS}$`));
    await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible();
  }

  test('TC-62.1: Escape closes the drawer, keeps the page and address and returns focus to "Open menu"', async ({
    page,
  }) => {
    await openOnMembers(page);
    await page.keyboard.press('Escape');
    await expectClosedUnchanged(page);
    await expect(openMenu(page)).toBeFocused();
  });

  test('TC-62.2: pressing the scrim outside the drawer closes it with the page unchanged', async ({ page }) => {
    await openOnMembers(page);
    // The panel is 280px wide: x = 350 of 390 is on the scrim.
    await page.getByTestId('drawer-scrim').tap({ position: { x: 350, y: 400 } });
    await expectClosedUnchanged(page);
  });

  test('TC-62.3: "Close menu" closes the drawer with the page unchanged', async ({ page }) => {
    await openOnMembers(page);
    await drawer(page).getByRole('button', { name: 'Close menu' }).tap();
    await expectClosedUnchanged(page);
  });

  test('TC-62.4: Tab stays inside the open drawer; widening to 1024 closes it and shows the fixed menu', async ({
    page,
  }) => {
    await openOnMembers(page);
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null))
        .toBe(true);
    }
    await expect(drawer(page)).toBeVisible();

    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(drawer(page)).toHaveCount(0);
    await expect(orgMenu(page)).toBeVisible();
    await expect(openMenu(page)).toHaveCount(0);
  });
});

test.describe('BR-62: the drawer keeps the page behind it', () => {
  test('TC-62.5: an open add pane with typed values survives Escape, a widening to 1024 and a narrowing back', async ({
    page,
  }) => {
    const agentUrl = `/o/${ORG}/p/${INVOICER_API}/desk/agent`;
    await page.goto(agentUrl);
    await expect(page.getByRole('heading', { name: 'Agent & settings', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Add agent' }).click();
    const pane = page.getByRole('complementary', { name: 'Add agent' });
    await pane.getByRole('radio', { name: 'Claude Code', exact: true }).check();
    await pane.getByLabel('Name', { exact: true }).fill('Claude - Phone');
    await pane.getByLabel('Subscription token', { exact: true }).fill('sk-ant-oat01-e2e-not-a-real-token');
    const address = new URL(page.url()).pathname + new URL(page.url()).search;

    /** The pane is open, what was typed is still there and the address is the one it was. */
    const expectPaneKept = async (): Promise<void> => {
      await expect(pane).toBeVisible();
      await expect(pane.getByLabel('Name', { exact: true })).toHaveValue('Claude - Phone');
      await expect(pane.getByLabel('Subscription token', { exact: true })).toHaveValue(
        'sk-ant-oat01-e2e-not-a-real-token',
      );
      expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(address);
    };

    await openDrawer(page);
    await page.keyboard.press('Escape');
    await expect(drawer(page)).toHaveCount(0);
    await expectPaneKept();

    await openDrawer(page);
    await page.setViewportSize({ width: 1024, height: 844 });
    await expect(drawer(page)).toHaveCount(0);
    await expect(orgMenu(page).or(projectMenu(page))).toBeVisible();
    await expectPaneKept();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(openMenu(page)).toBeVisible();
    await expectPaneKept();
  });
});
