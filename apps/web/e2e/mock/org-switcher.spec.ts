import { expect, test, type Page } from '@playwright/test';
import { INVOICER_API, ORG, release, seedTenantAdmin, setRead } from './mock';

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
