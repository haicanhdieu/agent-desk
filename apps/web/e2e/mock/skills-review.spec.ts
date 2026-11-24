import { expect, test, type Page } from '@playwright/test';
import { INVOICER_API, ORG, setSkillReviewRequired } from './mock';

// Submitting skill changes on the Skills editor: a direct save, and a pending change request when the default branch
// needs review. Each test starts from one goto (the mock store reseeds on every load).

const SKILL = `/o/${ORG}/p/${INVOICER_API}/desk/skills?skill=qa-e2e`;

const open = async (page: Page) => {
  await page.goto(SKILL);
  await expect(page.getByRole('textbox', { name: 'SKILL.md source' })).toBeVisible();
};
const source = (page: Page) => page.getByRole('textbox', { name: 'SKILL.md source' });
const submit = (page: Page) => page.getByRole('button', { name: 'Submit changes', exact: true });

test('the commit bar targets the default branch and offers Submit changes', async ({ page }) => {
  await open(page);
  await expect(page.getByText('Target', { exact: true })).toBeVisible();
  await expect(submit(page)).toBeDisabled();
  await expect(page.getByText(/submitted for review instead of saved/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Commit to/ })).toHaveCount(0);
});

test('a direct save says Skill saved to main and shows no change request', async ({ page }) => {
  await open(page);
  await source(page).fill('# Direct edit\n');
  await submit(page).click();
  await expect(page.getByText('Skill saved to main')).toBeVisible();
  await expect(page.getByText('Changes submitted for review')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'View change request' })).toHaveCount(0);
});

test('a protected branch: the edit is submitted for review, with a link, and the draft stays', async ({ page }) => {
  await setSkillReviewRequired(page);
  await open(page);
  await source(page).fill('# Pending edit\n');
  await submit(page).click();

  const notice = page.getByRole('status').filter({ hasText: 'Changes submitted for review' });
  await expect(notice).toBeVisible();
  const link = notice.getByRole('link', { name: 'View change request' });
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
  await expect(notice).toContainText(/agent-desk\/skill-update-qa-e2e-\d+ → main/);
  await expect(notice).toContainText('not merged yet');
  await expect(page.getByText('Skill saved to main')).toHaveCount(0);
  // The editor keeps the content and still counts it as unsaved: it is not the live version.
  await expect(source(page)).toHaveValue('# Pending edit\n');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
});

test('a protected branch: deleting is submitted for review and the skill stays listed', async ({ page }) => {
  await setSkillReviewRequired(page);
  await open(page);
  await page.getByRole('button', { name: 'Delete skill' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete skill qa-e2e?' });
  await expect(dialog).toContainText('qa-e2e');
  await dialog.getByLabel(/Type qa-e2e to confirm/).fill('qa-e2e');
  await dialog.getByRole('button', { name: 'Submit changes', exact: true }).click();

  await expect(page.getByText('Deletion submitted for review')).toBeVisible();
  await expect(page.getByRole('link', { name: 'View change request' })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Skills' }).getByRole('link', { name: /qa-e2e/ })).toBeVisible();
});

test('a direct delete removes the skill from the list', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Delete skill' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete skill qa-e2e?' });
  await dialog.getByLabel(/Type qa-e2e to confirm/).fill('qa-e2e');
  await dialog.getByRole('button', { name: 'Submit changes', exact: true }).click();
  await expect(page.getByText('Skill qa-e2e removed from main')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Skills' }).getByRole('link', { name: /qa-e2e/ })).toHaveCount(0);
});
