import { expect, test } from '@playwright/test';
import { INVOICER_API, ORG } from './mock';

test('create a rule, then edit it', async ({ page }) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/desk/rules`);
  await expect(page.getByRole('heading', { name: 'Routing rules', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'New rule' }).click();
  await page.getByRole('textbox', { name: 'Command' }).fill('code-docs');
  await page.getByRole('combobox', { name: 'Run skill' }).selectOption('code-build');
  await page.getByRole('button', { name: 'Save rule' }).click();

  const created = page.getByRole('button', { name: 'Edit rule /code-docs' });
  await expect(created).toBeVisible();
  await expect(created).toContainText('run code-build with Claude');

  await created.click();
  await expect(page.getByRole('textbox', { name: 'Command' })).toHaveValue('code-docs');
  await page.getByRole('radio', { name: 'Pull request' }).check();
  await page.getByRole('button', { name: 'Save rule' }).click();

  await expect(page.getByRole('button', { name: 'Edit rule /code-docs' })).toContainText('is posted on a pull request');
});
