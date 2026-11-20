import { expect, test } from '@playwright/test';
import { API, commentOnNewTicket, projectFor, runOf } from './helpers';

/*
 * Local end-to-end for the resource rule line Agent Desk adds to every run prompt: the rule form's preview of the
 * custom-prompt system lines (served by the API) and the prompt the worker records for a run both carry it.
 */

test.describe.configure({ timeout: 180_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

const RESOURCE_RULE =
  'RULE: RAM is capped (/sys/fs/cgroup/memory.max); exceeding it kills the pod. You MUST check memory before heavy tasks and order parallel work to fit, and MUST kill unused processes and shells and delete temp files.';

test('the custom prompt preview shows the resource rule before the status line', async ({ page }) => {
  const { handle, projectId } = await projectFor(page);
  await page.goto(`/o/${handle}/p/${projectId}/desk/rules`);
  await expect(page.getByRole('heading', { name: 'Routing rules', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'New rule' }).first().click();
  const form = page.getByRole('complementary', { name: 'New rule' });
  await form.getByRole('radio', { name: 'Custom prompt' }).click();

  const added = form.getByRole('group', { name: "Added by Agent Desk (can't be edited)" });
  await expect(added.getByText(RESOURCE_RULE, { exact: true })).toBeVisible();
  await expect(added).toContainText(`${RESOURCE_RULE}Before you end a turn, run`);
});

test('a skill run records a prompt that carries the resource rule', async ({ page }) => {
  const { handle, projectId } = await projectFor(page);
  const runId = await commentOnNewTicket(page, handle, projectId, '/code-review --fake-done');
  await expect
    .poll(async () => (await runOf(page, runId)).finalPrompt, { timeout: 60_000, intervals: [200, 500, 1000] })
    .not.toBeNull();
  const lines = ((await runOf(page, runId)).finalPrompt ?? '').split('\n');
  expect(lines).toHaveLength(6);
  expect(lines[4]).toBe(RESOURCE_RULE);
  expect(lines[5]).toMatch(/^Before you end a turn, run `agentdesk-status done/);
});
