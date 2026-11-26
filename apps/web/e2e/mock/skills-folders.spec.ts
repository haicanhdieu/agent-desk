import { expect, test } from '@playwright/test';
import { INVOICER_API, ORG } from './mock';

// The Skills page names the folders it searches: the default agent's folder, then .agents/skills. The mock project's
// default agent is Claude Code.

const SKILLS = `/o/${ORG}/p/${INVOICER_API}/desk/skills`;

test('the skill list header names .claude/skills/ and .agents/skills/', async ({ page }) => {
  await page.goto(SKILLS);
  await expect(page.getByRole('navigation', { name: 'Skills' })).toBeVisible();
  await expect(page.getByText('.claude/skills/, .agents/skills/ on main')).toBeVisible();
});
