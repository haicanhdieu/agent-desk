import { expect, test, type Locator, type Page } from '@playwright/test';
import { INVOICER_API, ORG, SESSION_MOCK_NOW, seedOnboarding, seedPlatform, startSignedOut } from './mock';

/*
 * Smaller items of the sidebar navigation shell (spec 2026-11-25-sidebar-navigation-shell-design.md "E2E requirements":
 * TC-28.1 to TC-28.3, TC-71.1, TC-74.1 to TC-74.3, TC-75.1, TC-75.2, TC-76.1, TC-76.2). TC-28.4 (the phone card) and
 * TC-70.1/TC-70.2 (the invitation card, in invitations.spec.ts) are not here.
 *
 * Every test seeds its scenario before the first goto (the mock store reseeds on each page load).
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const rowMenu = (page: Page, project = 'invoicer-api'): Locator =>
  page.getByRole('dialog', { name: `Actions for ${project}` });
const tablist = (page: Page): Locator => page.getByRole('tablist', { name: 'Agent and project settings' });

test.describe('BR-28: row action "Agent & settings"', () => {
  test('TC-28.1: the row action opens the Agents tab with no tab in the address', async ({ page }) => {
    await page.goto(`/o/${ORG}/projects`);
    await page.getByRole('button', { name: 'More for invoicer-api' }).click();
    await rowMenu(page).getByRole('link', { name: 'Agent & settings' }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/${INVOICER_API}/desk/agent$`));
    await expect(tablist(page).getByRole('tab', { selected: true })).toHaveText('Agents');
    expect(new URL(page.url()).searchParams.has('tab')).toBe(false);
  });

  test('TC-28.2: no row action is named "Settings"', async ({ page }) => {
    await page.goto(`/o/${ORG}/projects`);
    const buttons = page.getByRole('button', { name: /^More for / });
    await expect(buttons.first()).toBeVisible();
    const count = await buttons.count();
    expect(count).toBeGreaterThan(1);
    for (let i = 0; i < count; i++) {
      await buttons.nth(i).click();
      const menu = page.getByRole('dialog', { name: /^Actions for / });
      await expect(menu.getByRole('link', { name: 'Agent & settings' })).toBeVisible();
      await expect(menu.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);
      await expect(menu.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
    }
  });

  test('TC-28.3: a member has no "Agent & settings" and no "Settings" action', async ({ page }) => {
    await seedOnboarding(page, 'member');
    await page.goto('/o/acme/projects');
    const more = page.getByRole('button', { name: /^More for invoicer-api/ });
    await expect(more).toBeVisible();
    await more.click();
    const menu = rowMenu(page);
    await expect(menu.getByRole('link', { name: 'Runs' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Agent & settings' })).toHaveCount(0);
    await expect(menu.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);
  });
});

test.describe('BR-71: platform org Projects: name first', () => {
  test('TC-71.1: the columns are Name then Id and each row shows the name then its id', async ({ page }) => {
    await page.clock.install({ time: new Date(SESSION_MOCK_NOW) });
    await seedPlatform(page, 'platformOrgFewProjects');
    await page.goto('/platform/orgs/b8000000-0000-4000-8000-000000000001/projects');
    await expect(page.getByRole('heading', { name: 'Projects', level: 2 })).toBeVisible();
    await expect(page.getByRole('columnheader')).toHaveText(['Name', 'Id']);
    const rows = [
      ['Alpha', 'b8100000-0000-4000-8000-000000000001'],
      ['Project 02', 'b8100000-0000-4000-8000-000000000002'],
    ];
    await expect(page.locator('tbody tr')).toHaveCount(rows.length);
    for (const [i, cells] of rows.entries()) {
      await expect(page.locator('tbody tr').nth(i).getByRole('cell')).toHaveText(cells);
    }
  });
});

test.describe('BR-74: skill template preview', () => {
  const STEP = `/o/${ORG}/projects/new/skills?project=${INVOICER_API}`;
  const preview = (page: Page, name: string): Locator => page.getByRole('button', { name: `Preview ${name}` });
  const card = (page: Page, name: string): Locator => page.getByRole('checkbox', { name: new RegExp(`^${name}`) });

  test('TC-74.1: Preview on code-review shows that template, not code-build', async ({ page }) => {
    await page.goto(STEP);
    await card(page, 'code-review').uncheck();
    await expect(card(page, 'code-build')).toBeChecked();
    await preview(page, 'code-review').click();
    const dialog = page.getByRole('dialog', { name: 'code-review SKILL.md' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Review a pull request' })).toBeVisible();
    await expect(dialog.getByText('Build an issue')).toHaveCount(0);
  });

  test('TC-74.2: Close returns to the step with the picks unchanged and focus on Preview', async ({ page }) => {
    await page.goto(STEP);
    await card(page, 'code-review').uncheck();
    await preview(page, 'code-review').click();
    const dialog = page.getByRole('dialog', { name: 'code-review SKILL.md' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Start from skill templates', level: 1 })).toBeVisible();
    await expect(card(page, 'code-build')).toBeChecked();
    await expect(card(page, 'code-review')).not.toBeChecked();
    await expect(preview(page, 'code-review')).toBeFocused();
  });

  test('TC-74.3: at 390 the dialog is full width, its text scrolls and Close returns to the step', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(STEP);
    await preview(page, 'code-build').click();
    const dialog = page.getByRole('dialog', { name: 'code-build SKILL.md' });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    if (!box) throw new Error('no dialog box');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.width).toBeGreaterThanOrEqual(380);
    await expect(dialog.getByRole('heading', { name: 'Build an issue' })).toBeVisible();
    const scrolled = await dialog.evaluate((el) => {
      const pane = [...el.querySelectorAll<HTMLElement>('*')].find(
        (n) => getComputedStyle(n).overflowY === 'auto' && n.scrollHeight > n.clientHeight,
      );
      if (!pane) return false;
      pane.scrollTop = pane.scrollHeight;
      return pane.scrollTop > 0;
    });
    expect(scrolled).toBe(true);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(card(page, 'code-build')).toBeChecked();
    await expect(card(page, 'code-review')).toBeChecked();
  });
});

test.describe('BR-75: Projects intro text', () => {
  const INTRO = 'After sign-in you land on this list. It is one click away on the logo.';

  test('TC-75.1: the intro reads the new sentence', async ({ page }) => {
    await seedOnboarding(page, 'member');
    await page.goto('/o/acme/projects');
    await expect(page.getByText(INTRO, { exact: true })).toBeVisible();
  });

  test('TC-75.2: no other intro sentence and nothing about the last used project', async ({ page }) => {
    await seedOnboarding(page, 'member');
    await page.goto('/o/acme/projects');
    await expect(page.getByText(INTRO, { exact: true })).toBeVisible();
    const main = page.getByRole('main');
    await expect(main.locator(':scope > p')).toHaveText([INTRO]);
    await expect(main.getByText(/last used|used last|you used/i)).toHaveCount(0);
    await expect(main.getByText(/runs of the project/i)).toHaveCount(0);
  });
});

test.describe('BR-76: sign-in text', () => {
  test('TC-76.1: the page reads "Proof of concept."', async ({ page }) => {
    await startSignedOut(page);
    await page.goto('/sign-in');
    await expect(page.getByText('Proof of concept.', { exact: true })).toBeVisible();
  });

  test('TC-76.2: "Single user per project" appears nowhere', async ({ page }) => {
    await startSignedOut(page);
    await page.goto('/sign-in');
    await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toBeVisible();
    await expect(page.getByText(/Single user per project/i)).toHaveCount(0);
  });
});
