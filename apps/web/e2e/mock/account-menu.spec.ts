import { expect, test, type Page } from '@playwright/test';
import { IDLE_RUN, INVOICER_API, ORG } from './mock';

/*
 * The account menu behind the top bar avatar (issue #213): the avatar is a button that opens a popover with Logout,
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
const menu = (page: Page) => page.getByRole('dialog', { name: 'Account' });

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
