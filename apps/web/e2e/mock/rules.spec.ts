import { expect, test } from '@playwright/test';
import { INVOICER_API, ORG } from './mock';

test('create a rule, then edit it', async ({ page }) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/desk/rules`);
  await expect(page.getByRole('heading', { name: 'Routing rules', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'New rule' }).click();
  await page.getByRole('textbox', { name: 'Command' }).fill('code-docs');
  await page.getByRole('combobox', { name: 'Skill', exact: true }).selectOption('code-build');
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

test('the More menu edits and deletes a rule', async ({ page }) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/desk/rules`);
  await expect(page.getByRole('heading', { name: 'Routing rules', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'More actions for /code-e2e' }).click();
  await page.getByRole('dialog', { name: 'Actions for /code-e2e' }).getByRole('button', { name: 'Edit' }).click();
  const pane = page.getByRole('complementary', { name: 'Edit rule' });
  await expect(pane.getByRole('textbox', { name: 'Command' })).toHaveValue('code-e2e');

  await page.getByRole('button', { name: 'More actions for /code-e2e' }).click();
  await page.getByRole('dialog', { name: 'Actions for /code-e2e' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('button', { name: 'Edit rule /code-e2e' })).toHaveCount(0);
  await expect(pane).toHaveCount(0);
});

test('the More menu of the last rule opens in full, not cut off by the list', async ({ page }) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/desk/rules`);
  const more = page.getByRole('button', { name: /^More actions for \// }).last();
  await more.click();
  const menu = page.getByRole('dialog', { name: /^Actions for \// });
  await expect(menu.getByRole('button', { name: 'Delete' })).toBeVisible();
  // The Delete item is the topmost element at its own centre: nothing clips or covers it.
  const del = menu.getByRole('button', { name: 'Delete' });
  const hit = await del.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  });
  expect(hit).toBe(true);
});
