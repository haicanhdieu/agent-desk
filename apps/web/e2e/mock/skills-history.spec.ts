import { expect, test } from '@playwright/test';
import { INVOICER_API, ORG } from './mock';

// The History link is built from the connected repository, its default branch and the selected skill's file path.

const SKILLS = `/o/${ORG}/p/${INVOICER_API}/desk/skills`;
const REPO = 'https://github.com/harbor-labs/invoicer-api/blob/main';

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
