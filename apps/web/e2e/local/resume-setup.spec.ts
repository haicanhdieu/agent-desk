import { expect, test, type Page } from '@playwright/test';
import { AgentDto } from '@agentdesk/contracts';
import {
  API,
  asPlatformAdmin,
  continueAgentStep,
  inviteAndSignIn,
  openAgent,
  platformOrgIdBySlug,
  signInAndStartProject,
} from './helpers';

/*
 * Local end-to-end for "Resume setup" on the Projects list (spec 2026-11-25-sidebar-navigation-shell-design.md, BR-77
 * and BR-78: TC-78.3, TC-77.1, TC-77.3, TC-78.1). Every case signs in as a new owner of its own e2e-<rand> org and
 * creates its own project, so the cases leave nothing shared behind. The project is left on the workspace step: its
 * agent step is saved (a Codex agent with a credential, made through the agent helpers) and the rest is not.
 */

test.describe.configure({ timeout: 300_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

const agentHeading = (page: Page) => page.getByRole('heading', { name: 'Add your agent', level: 1 });
const workspaceHeading = (page: Page) => page.getByRole('heading', { name: 'Prepare the workspace', level: 1 });
const anyResume = (page: Page) => page.getByRole('link', { name: /^Resume setup for / });
const exitSetup = (page: Page) => page.getByRole('link', { name: 'Exit setup' });

/** One step of the wizard's progress list; a done step carries the check mark and is not the current step. */
const stepItem = (page: Page, label: string) =>
  page.getByRole('complementary', { name: 'Setup progress' }).getByRole('listitem').filter({ hasText: label });
async function expectResumedAtWorkspace(page: Page) {
  await expect(stepItem(page, 'Prepare workspace')).toHaveAttribute('aria-current', 'step');
  for (const label of ['Connect repository', 'Add agent']) {
    await expect(stepItem(page, label)).not.toHaveAttribute('aria-current', /.+/);
    await expect(stepItem(page, label).locator('svg')).toHaveCount(1);
  }
}

/** A new owner with a project whose Agent step (Codex, credential saved) is done and whose setup stopped after it. */
async function projectLeftAfterAgentStep(page: Page) {
  const { handle, projectId } = await signInAndStartProject(page, 'codex');
  await page.reload();
  await expect(agentHeading(page)).toBeVisible();
  await continueAgentStep(page);
  return { handle, projectId };
}

test('TC-78.3: Resume setup opens the first unfinished step; Back shows the Codex agent read-only with one agent left', async ({
  page,
}) => {
  const { handle, projectId } = await projectLeftAfterAgentStep(page);
  await page.goto(`/o/${handle}/projects`);
  await anyResume(page).click();
  await expect(page).toHaveURL(new RegExp(`/projects/new/setup\\?project=${projectId}$`));
  await expect(workspaceHeading(page)).toBeVisible();
  await expectResumedAtWorkspace(page);
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(agentHeading(page)).toBeVisible();
  await expect(page.getByRole('radio', { name: 'OpenAI Codex', exact: true })).toBeChecked();
  for (const label of ['Claude Code', 'OpenAI Codex', 'OpenCode'])
    await expect(page.getByRole('radio', { name: label, exact: true })).toBeDisabled();
  await expect(page.getByText(/^Set .* by .*Hidden for good after saving\./)).toBeVisible();
  // The name and the model are the saved agent's, read back through the API.
  const saved = AgentDto.parse(await (await page.request.get(`/api/projects/${projectId}/agent`)).json());
  await expect(page.getByText(`Agent name: ${saved.name}`)).toBeVisible();
  expect(saved.model).toBeTruthy();
  await expect(page.getByLabel('Default model')).toHaveValue(saved.model ?? '');

  await openAgent(page, handle, projectId);
  await expect(page.getByRole('region', { name: 'Agents list' }).getByRole('listitem')).toHaveCount(1);
});

test('TC-77.1: an owner sees Resume setup, named for the project, on the unfinished project', async ({ page }) => {
  const { handle, projectId } = await projectLeftAfterAgentStep(page);
  await page.goto(`/o/${handle}/projects`);
  const row = page.locator('tr', { has: page.locator(`a[href="/o/${handle}/p/${projectId}/runs"]`) });
  await expect(row.getByRole('link', { name: /^Resume setup for / })).toBeVisible();
  await expect(row.getByRole('button', { name: /^More for / })).toBeVisible();
});

for (const roleKey of ['member', 'viewer'] as const) {
  test(`TC-77.3: a ${roleKey} sees the unfinished project without Resume setup`, async ({ page, browser }) => {
    const { handle, projectId } = await projectLeftAfterAgentStep(page);
    const pa = await asPlatformAdmin();
    const context = await browser.newContext();
    try {
      const orgId = await platformOrgIdBySlug(pa, handle);
      const other = await context.newPage();
      await inviteAndSignIn(other, pa, orgId, `e2e-${roleKey}-${handle.slice(-8)}`, roleKey, { type: 'org' });
      await other.goto(`/o/${handle}/projects`);
      await expect(other.locator(`a[href="/o/${handle}/p/${projectId}/runs"]`)).toBeVisible();
      await expect(anyResume(other)).toHaveCount(0);
    } finally {
      await context.close();
      await pa.dispose();
    }
  });
}

test('TC-78.1: leaving inside the app with no reload and resuming lands on the first unfinished step', async ({
  page,
}) => {
  const { handle, projectId } = await projectLeftAfterAgentStep(page);
  // No reload: through the top-bar Projects link (until "Exit setup" replaces it).
  await exitSetup(page).click();
  await expect(page).toHaveURL(new RegExp(`/o/${handle}/projects$`));
  await anyResume(page).click();
  await expect(page).toHaveURL(new RegExp(`/projects/new/setup\\?project=${projectId}$`));
  await expect(workspaceHeading(page)).toBeVisible();
  await expectResumedAtWorkspace(page);
  // The earlier step is saved: Back reaches it.
  await expect(page.getByRole('link', { name: 'Back' })).toBeVisible();
});
