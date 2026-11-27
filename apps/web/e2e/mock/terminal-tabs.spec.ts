import { expect, test, type Page } from '@playwright/test';
import { IDLE_RUN, INVOICER_API, ORG, STOPPED_RUN } from './mock';

/*
 * Arrow, Home and End keys on the run terminal view tabs (spec 2026-11-25-sidebar-navigation-shell-design.md, BR-81).
 * The app shows one usable tab per view, so e2e can only prove the one-tab clause; moving between tabs is proved by
 * src/components/TerminalBar.test.tsx.
 */
test.describe.configure({ timeout: 60_000 });

const runUrl = (number: number) => `/o/${ORG}/p/${INVOICER_API}/runs/${number}`;
const viewTabs = (page: Page) => page.getByRole('tablist', { name: 'Run view' });
const KEYS = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];

async function pressKeysOnTheOnlyTab(page: Page, name: string): Promise<void> {
  const only = viewTabs(page).getByRole('tab');
  await expect(only).toHaveCount(1);
  await expect(only).toHaveText(name);
  await only.focus();
  for (const key of KEYS) {
    await page.keyboard.press(key);
    await expect(only).toBeFocused();
    await expect(only).toHaveAttribute('aria-selected', 'true');
    await expect(viewTabs(page).getByRole('tab')).toHaveCount(1);
  }
}

test.describe('BR-81: arrow keys on run terminal view tabs', () => {
  test('TC-81.1: on a live run the one Terminal tab keeps focus, selection and view', async ({ page }) => {
    await page.goto(runUrl(IDLE_RUN));
    const terminal = page.getByRole('group', { name: 'Claude Code terminal' });
    await expect(terminal).toBeVisible();
    await pressKeysOnTheOnlyTab(page, 'Terminal');
    await expect(terminal).toBeVisible();
  });

  test('TC-81.2: on a transcript the one tab keeps focus, selection and view', async ({ page }) => {
    await page.goto(runUrl(STOPPED_RUN));
    await expect(viewTabs(page)).toBeVisible();
    await pressKeysOnTheOnlyTab(page, 'Transcript');
    await expect(page.getByRole('log')).toBeVisible();
  });

  test('TC-81.3: Left and Right inside the terminal are not taken by the tab list', async ({ page }) => {
    await page.goto(runUrl(IDLE_RUN));
    const terminal = page.getByRole('group', { name: 'Claude Code terminal' });
    await expect(terminal).toContainText('agent-desk fake terminal');
    await terminal.click();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowRight');
    await expect(viewTabs(page).getByRole('tab')).not.toBeFocused();
    await expect(terminal.locator(':focus')).toHaveCount(1);
  });
});
