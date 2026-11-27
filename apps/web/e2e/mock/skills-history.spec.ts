import { expect, test, type Page } from '@playwright/test';
import { INVOICER_API, ORG } from './mock';

// The History link is built from the provider-specific file prefix the API supplies for the connected repository.

const SKILLS = `/o/${ORG}/p/${INVOICER_API}/desk/skills`;
const REPO = 'https://github.com/harbor-labs/invoicer-api/blob/main';

/** Changes only the project response, leaving the app and the rest of the mock API untouched. */
async function withProject(page: Page, patch: (project: Record<string, unknown>) => Record<string, unknown>) {
  await page.route(`**/api/projects/${INVOICER_API}`, async (route) => {
    const response = await route.fetch();
    const project = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: patch(project) });
  });
}

test('History follows the selected skill to its file on the repo default branch', async ({ page }) => {
  await page.goto(SKILLS);
  const history = page.getByRole('link', { name: 'History' });
  await expect(history).toHaveAttribute('href', `${REPO}/.claude/skills/code-build/SKILL.md`);

  await page
    .getByRole('navigation', { name: 'Skills' })
    .getByRole('link', { name: /code-e2e/ })
    .click();
  await expect(history).toHaveAttribute('href', `${REPO}/.claude/skills/code-e2e/SKILL.md`);
});

test('History uses the file prefix of the connected provider', async ({ page }) => {
  await withProject(page, (project) => ({
    ...project,
    codeProvider: 'fake',
    skillFileBaseUrl: 'https://git.example.com/harbor-labs/invoicer-api/-/blob/trunk/',
  }));
  await page.goto(SKILLS);
  await expect(page.getByRole('link', { name: 'History' })).toHaveAttribute(
    'href',
    'https://git.example.com/harbor-labs/invoicer-api/-/blob/trunk/.claude/skills/code-build/SKILL.md',
  );
});

test('History is disabled when the connected repo has no file prefix', async ({ page }) => {
  await withProject(page, (project) => ({ ...project, skillFileBaseUrl: null }));
  await page.goto(SKILLS);
  const history = page.getByRole('button', { name: 'History' });
  await expect(history).toBeDisabled();
  await expect(history).toHaveAttribute('title', /connected repository/);
});
