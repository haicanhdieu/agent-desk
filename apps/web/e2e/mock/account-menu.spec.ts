import { expect, test, type Page } from '@playwright/test';
import { IDLE_RUN, INVOICER_API, ORG } from './mock';

/*
 * The account menu behind the top bar avatar (issues #213, #227, #229): the avatar is a menu button that opens the identity header (name, full email) and Logout,
 * on the global, project and run top bars. Logout signs out and lands on the sign-in page; Escape and an outside
 * press dismiss the popover.
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const PAGES = [
  ['global', `/o/${ORG}/projects`],
  ['project', `/o/${ORG}/p/${INVOICER_API}/runs`],
  ['run', `/o/${ORG}/p/${INVOICER_API}/runs/${IDLE_RUN}`],
] as const;

const avatar = (page: Page) => page.getByRole('button', { name: /^Account menu for / });
const menu = (page: Page) => page.getByRole('menu', { name: 'Account' });

for (const [name, path] of PAGES) {
  test(`the ${name} top bar avatar opens an account menu and Logout lands on the sign-in page`, async ({ page }) => {
    await page.goto(path);
    await expect(avatar(page)).toBeVisible();
    await avatar(page).click();
    await expect(menu(page)).toBeVisible();
    await menu(page).getByRole('menuitem', { name: 'Logout' }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toBeVisible();
  });
}

test('Escape and an outside press close the account menu', async ({ page }) => {
  await page.goto(`/o/${ORG}/projects`);
  await avatar(page).click();
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(avatar(page)).toBeFocused();
  await avatar(page).click();
  await expect(menu(page)).toBeVisible();
  await page.mouse.click(5, 300);
  await expect(menu(page)).toHaveCount(0);
});

test('the account menu shows the name with the full email under it, Logout with an icon below a separator, and no My invitations or Settings', async ({
  page,
}) => {
  await page.goto(`/o/${ORG}/projects`);
  await expect(avatar(page)).toHaveAttribute('aria-haspopup', 'menu');
  await avatar(page).click();
  const m = menu(page);
  await expect(m).toBeVisible();
  await expect(m.getByText('Alice', { exact: true })).toBeVisible();
  await expect(m.getByText('alice@example.com', { exact: true })).toBeVisible();
  await expect(m.getByRole('menuitem')).toHaveText(['Logout']);
  await expect(m.getByRole('menuitem', { name: 'Logout' }).locator('svg')).toHaveCount(1);
  await expect(m.getByRole('separator')).toHaveCount(1);
  await expect(m.getByRole('menuitem', { name: /Settings|invitations/i })).toHaveCount(0);
  expect((await m.boundingBox())?.width).toBe(240);
});

test('the top bar brand is the horizontal logo lockup, with the name drawn inside the logo', async ({ page }) => {
  await page.goto(`/o/${ORG}/projects`);
  const brand = page.getByRole('link', { name: 'Agent Desk, all projects' });
  await expect(brand.locator('svg[viewBox="0 0 480 120"]')).toBeVisible();
  await expect(brand.locator('svg text')).toHaveText(['Agent', 'Desk']);
});
