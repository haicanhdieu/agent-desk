import { expect, test } from '@playwright/test';
import { INVOICER_API, ORG, SCRIPTED_RUN } from './mock';

// The scripted run takes about 16 s from queued to idle (mock.ts).
test.describe.configure({ timeout: 60_000 });

test('a live run starts, goes idle, echoes the terminal and finishes as succeeded', async ({ page }) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/runs/${SCRIPTED_RUN}`);
  const header = page.getByRole('banner');
  const status = (label: string) => header.getByText(label, { exact: true });

  await expect(status('Starting')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'Starting the agent' })).toBeVisible();
  await expect(status('Running')).toBeVisible({ timeout: 15_000 });
  await expect(status('Needs you')).toBeVisible({ timeout: 15_000 });

  const terminal = page.getByRole('group', { name: 'Claude Code terminal' });
  await expect(terminal).toContainText('agent-desk fake terminal');
  await expect(terminal).toContainText(`run ${SCRIPTED_RUN}`);

  await terminal.click();
  await page.keyboard.type('hello e2e');
  await page.keyboard.press('Enter');
  await expect(terminal).toContainText('> hello e2e');

  await page.getByRole('region', { name: 'Terminal' }).getByRole('button', { name: 'Finish run' }).click();
  await expect(status('Succeeded')).toBeVisible();
  // The session is kept as read-only scrollback.
  const view = page.getByRole('region', { name: 'Terminal' });
  await expect(view.getByRole('tab', { name: 'Final scrollback', selected: true })).toBeVisible();
  await expect(view.getByText(/^Ended, read-only/)).toBeVisible();
  await expect(terminal).toContainText('> hello e2e');
});
