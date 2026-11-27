import { expect, test } from '@playwright/test';
import { INVOICER_API, ORG } from './mock';

test('Routing rules is the first Configure item of the Project menu and opens from it', async ({ page }) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/runs`);
  const menu = page.getByRole('navigation', { name: 'Project menu' });
  await menu.getByRole('link', { name: 'Routing rules' }).click();

  await expect(page).toHaveURL(new RegExp(`/o/${ORG}/p/${INVOICER_API}/desk/rules$`));
  await expect(page.getByRole('heading', { name: 'Routing rules', level: 1 })).toBeVisible();

  const items = menu.getByRole('link');
  const labels = (await items.allTextContents()).map((t) => t.replace(/\d+ needs you$/, '').trim());
  expect(labels.indexOf('Routing rules')).toBe(labels.indexOf('Runs') + 1);
  expect(labels[labels.indexOf('Routing rules') + 1]).toBe('Skills');
  await expect(menu.getByRole('link', { name: 'Routing rules' })).toHaveAttribute('aria-current', 'page');
});

test("the shell shows the project's name in the bar and the repository in the menu, not a generic Desk label", async ({
  page,
}) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/desk/rules`);
  await expect(page.getByRole('heading', { name: 'Routing rules', level: 1 })).toBeVisible();

  const menu = page.getByRole('navigation', { name: 'Project menu' });
  await expect(page.getByRole('button', { name: 'Switch project, currently invoicer-api' })).toBeVisible();
  await expect(menu.getByRole('region', { name: 'Repository' })).toContainText('invoicer-api');
  await expect(menu.getByText('Desk', { exact: true })).toHaveCount(0);
});
