import { expect, test, type Page } from '@playwright/test';
import { agentsFixture } from '../../src/mocks/dto/agents';
import { agentListId, ids } from '../../src/mocks/dto/ids';
import {
  INVOICER_API,
  NO_CREDENTIAL_RUN,
  ORG,
  TRANSCRIPT_TIMED_OUT_RUN,
  seedAgents,
  seedLists,
  seedOnboarding,
  seedProjectSpace,
} from './mock';

/*
 * Agent & settings tabs (spec 2026-11-24-multi-agent-configs-design.md, BR-55 to BR-60). The mock store reseeds on
 * every page load, so a test opens the page once and moves between tabs by click; only the cases about the address
 * itself open an address.
 */
test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const agentPage = `/o/${ORG}/p/${INVOICER_API}/desk/agent`;
const projectBase = `/o/${ORG}/p/${INVOICER_API}`;
const TABS = ['Agents', 'GitHub connection', 'Limits', 'Danger zone'];

const tablist = (page: Page) => page.getByRole('tablist', { name: 'Agent and project settings' });
const tab = (page: Page, name: string) => tablist(page).getByRole('tab', { name, exact: true });
const tabNames = (page: Page) => tablist(page).getByRole('tab');
const selected = (page: Page) => tablist(page).getByRole('tab', { selected: true });
const agentsHeading = (page: Page) => page.getByRole('heading', { level: 2, name: 'Agents', exact: true });
const limitsField = (page: Page) => page.getByLabel('Run time limit', { exact: true });
const webhook = (page: Page) => page.getByRole('radio', { name: 'Webhook' });
const deleteProject = (page: Page) => page.getByRole('button', { name: 'Delete project' });
const idleField = (page: Page) => page.getByLabel('End idle runs after');

async function openAgentPage(page: Page, search = ''): Promise<void> {
  await page.goto(`${agentPage}${search}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Agent & settings' })).toBeVisible();
}

test.describe('BR-55: the tab strip', () => {
  test('TC-55.1: opens on Agents with four tabs in order and only the Agents panel', async ({ page }) => {
    await openAgentPage(page);
    await expect(tablist(page)).toBeVisible();
    await expect(tabNames(page)).toHaveText(TABS);
    await expect(selected(page)).toHaveText('Agents');
    await expect(agentsHeading(page)).toBeVisible();
    await expect(page.getByRole('tabpanel')).toHaveCount(1);
    await expect(limitsField(page)).toHaveCount(0);
    await expect(webhook(page)).toHaveCount(0);
    await expect(deleteProject(page)).toHaveCount(0);
  });

  test('TC-55.2: each tab shows only its own content', async ({ page }) => {
    await openAgentPage(page);
    await tab(page, 'GitHub connection').click();
    await expect(selected(page)).toHaveText('GitHub connection');
    await expect(webhook(page)).toBeVisible();
    await expect(agentsHeading(page)).toHaveCount(0);
    await expect(limitsField(page)).toHaveCount(0);

    await tab(page, 'Limits').click();
    await expect(selected(page)).toHaveText('Limits');
    await expect(limitsField(page)).toBeVisible();
    await expect(webhook(page)).toHaveCount(0);
    await expect(agentsHeading(page)).toHaveCount(0);

    await tab(page, 'Danger zone').click();
    await expect(selected(page)).toHaveText('Danger zone');
    await expect(deleteProject(page).first()).toBeVisible();
    await expect(limitsField(page)).toHaveCount(0);

    await tab(page, 'Agents').click();
    await expect(selected(page)).toHaveText('Agents');
    await expect(agentsHeading(page)).toBeVisible();
    await expect(deleteProject(page)).toHaveCount(0);
  });
});

test.describe('BR-56: tab URLs and keyboard', () => {
  test('TC-56.1: the address shows tab=github, tab=limits, tab=danger and then no tab', async ({ page }) => {
    await openAgentPage(page);
    await tab(page, 'GitHub connection').click();
    await expect(page).toHaveURL(/\/desk\/agent\?tab=github$/);
    await tab(page, 'Limits').click();
    await expect(page).toHaveURL(/\/desk\/agent\?tab=limits$/);
    await tab(page, 'Danger zone').click();
    await expect(page).toHaveURL(/\/desk\/agent\?tab=danger$/);
    await tab(page, 'Agents').click();
    await expect(page).toHaveURL(/\/desk\/agent$/);
  });

  test('TC-56.2: Back from Limits shows Agents and the address has no tab', async ({ page }) => {
    await openAgentPage(page);
    await tab(page, 'Limits').click();
    await expect(selected(page)).toHaveText('Limits');
    await page.goBack();
    await expect(selected(page)).toHaveText('Agents');
    await expect(page).toHaveURL(/\/desk\/agent$/);
  });

  test('TC-56.3: the address with tab=limits opens Limits', async ({ page }) => {
    await openAgentPage(page, '?tab=limits');
    await expect(selected(page)).toHaveText('Limits');
    await expect(limitsField(page)).toBeVisible();
  });

  test('TC-56.4: ArrowRight, ArrowLeft, End and Home move the selection and the focus stays on the tab', async ({
    page,
  }) => {
    await openAgentPage(page);
    await tab(page, 'Agents').focus();
    await page.keyboard.press('ArrowRight');
    await expect(selected(page)).toHaveText('GitHub connection');
    await expect(selected(page)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(selected(page)).toHaveText('Agents');
    await expect(selected(page)).toBeFocused();
    await page.keyboard.press('End');
    await expect(selected(page)).toHaveText('Danger zone');
    await expect(selected(page)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(selected(page)).toHaveText('Agents');
    await expect(selected(page)).toBeFocused();
  });
});

test.describe('BR-57: unknown tab and Danger zone', () => {
  test('TC-57.1: an unknown tab shows Agents', async ({ page }) => {
    await openAgentPage(page, '?tab=nonsense');
    await expect(selected(page)).toHaveText('Agents');
    await expect(agentsHeading(page)).toBeVisible();
  });

  test('TC-57.2: a project admin sees three tabs and no Danger zone, and tab=danger shows Agents', async ({ page }) => {
    await seedProjectSpace(page, { role: 'projectAdmin' });
    await openAgentPage(page);
    await expect(tabNames(page)).toHaveText(['Agents', 'GitHub connection', 'Limits']);
    await expect(tab(page, 'Danger zone')).toHaveCount(0);

    await openAgentPage(page, '?tab=danger');
    await expect(tabNames(page)).toHaveText(['Agents', 'GitHub connection', 'Limits']);
    await expect(selected(page)).toHaveText('Agents');
    await expect(agentsHeading(page)).toBeVisible();
    await expect(deleteProject(page)).toHaveCount(0);
  });

  test('TC-57.3: an owner sees four tabs and deletes the project from the Danger zone tab', async ({ page }) => {
    await openAgentPage(page);
    await expect(tabNames(page)).toHaveText(TABS);
    await tab(page, 'Danger zone').click();
    await deleteProject(page).click();
    const dialog = page.getByRole('dialog', { name: 'Delete project' });
    await dialog.getByRole('button', { name: 'Delete project' }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${ORG}/projects$`));
    // The delete worked: the project is gone from the list.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('invoicer-api')).toHaveCount(0);
  });
});

test.describe('BR-58: changing tab drops the pane', () => {
  test('TC-58.1: a typed token is dropped with the pane and shows nowhere', async ({ page }) => {
    const canary = 'sk-fake-canary-0058';
    const sent: string[] = [];
    page.on('request', (req) => {
      sent.push(`${req.url()} ${req.postData() ?? ''}`);
    });
    await openAgentPage(page);
    await page.getByRole('button', { name: 'Add agent' }).click();
    const pane = page.getByRole('complementary', { name: 'Add agent' });
    await pane.getByRole('radio', { name: 'Claude Code' }).click();
    await pane.getByRole('textbox', { name: 'Subscription token' }).fill(canary);

    await tab(page, 'Limits').click();
    await tab(page, 'Agents').click();
    await expect(agentsHeading(page)).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Add agent' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Add agent' }).click();
    const again = page.getByRole('complementary', { name: 'Add agent' });
    await again.getByRole('radio', { name: 'Claude Code' }).click();
    await expect(again.getByRole('textbox', { name: 'Subscription token' })).toHaveValue('');
    expect(await page.evaluate(() => document.body.innerText)).not.toContain(canary);
    expect(await page.content()).not.toContain(canary);
    expect(sent.filter((line) => line.includes(canary))).toEqual([]);
  });

  test('TC-58.2: changing tab with the Edit pane open clears agent from the address', async ({ page }) => {
    await openAgentPage(page);
    await page.getByRole('button', { name: 'Edit Claude' }).click();
    await expect(page).toHaveURL(/[?&]agent=/);
    await expect(page.getByRole('complementary', { name: 'Edit agent' })).toBeVisible();
    await tab(page, 'Limits').click();
    await expect(page).toHaveURL(/\/desk\/agent\?tab=limits$/);
    await expect(page).not.toHaveURL(/agent=/);
  });

  test('TC-58.3: Limits and back to Agents shows the first page and no page in the address', async ({ page }) => {
    await seedAgents(page, 'manyAgents');
    await openAgentPage(page, '?page=2');
    await expect(page).toHaveURL(/[?&]page=2/);
    await expect(page.getByText('Agent 01', { exact: true })).toHaveCount(0);
    await tab(page, 'Limits').click();
    await tab(page, 'Agents').click();
    await expect(page.getByText('Agent 01', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/desk\/agent$/);
  });

  test('TC-58.4: an unsaved Limits edit is dropped on the way back; saved values stay', async ({ page }) => {
    await openAgentPage(page, '?tab=limits');
    await expect(idleField(page)).toHaveValue('30');
    await idleField(page).fill('90');
    await page.getByRole('button', { name: 'Save limits' }).click();
    await expect(page.getByText('Limits saved')).toBeVisible();
    await idleField(page).fill('45');
    await tab(page, 'Agents').click();
    await tab(page, 'Limits').click();
    await expect(idleField(page)).toHaveValue('90');
  });
});

test.describe('BR-59: per-tab errors', () => {
  test('TC-59.1: a 500 on the agent list shows its own error with Retry; the other tabs load', async ({ page }) => {
    await seedAgents(page, 'listError');
    await openAgentPage(page);
    await expect(page.getByRole('tabpanel').getByText('Could not load the agents. Try again.')).toBeVisible();
    await expect(page.getByRole('tabpanel').getByRole('button', { name: 'Retry' })).toBeVisible();
    await tab(page, 'GitHub connection').click();
    await expect(webhook(page)).toBeVisible();
    await tab(page, 'Limits').click();
    await expect(limitsField(page)).toBeVisible();
  });

  test('TC-59.2: after the 500 the list answers normally; Retry shows the list', async ({ page }) => {
    // The list fails on its first three requests (the load and the query's two automatic retries), then answers as usual.
    await seedLists(page, { fail: [{ route: 'agents.list', times: 3 }] });
    await openAgentPage(page);
    const retry = page.getByRole('tabpanel').getByRole('button', { name: 'Retry' });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(retry).toBeHidden();
    await expect(page.getByRole('region', { name: 'Agents list' }).getByRole('listitem').first()).toBeVisible();
  });

  test('TC-59.3: a refused Limits save shows field errors and leaves Agents loading and saving', async ({ page }) => {
    await openAgentPage(page, '?tab=limits');
    await idleField(page).fill('2');
    await page.getByRole('button', { name: 'Save limits' }).click();
    await expect(page.getByText('Idle runs must end after between 5 minutes and 7 days')).toBeVisible();
    await expect(idleField(page)).toHaveAttribute('aria-invalid', 'true');

    await tab(page, 'Agents').click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Claude' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Add agent' }).click();
    const pane = page.getByRole('complementary', { name: 'Add agent' });
    await pane.getByRole('radio', { name: 'OpenCode' }).click();
    await pane.getByLabel('Name').fill('OpenCode - Bare');
    await pane.getByRole('button', { name: 'Save agent' }).click();
    await expect(page.getByText('Agent saved')).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'OpenCode - Bare' })).toBeVisible();
  });
});

test.describe('BR-60: links land on the right tab', () => {
  const docsRuns = `/o/${ORG}/p/${ids.project.docsSite}/runs?filter=ignored`;

  test('TC-60.1: "Connection details" opens the GitHub connection tab', async ({ page }) => {
    await page.goto(docsRuns);
    await page.getByRole('link', { name: 'Connection details' }).click();
    await expect(selected(page)).toHaveText('GitHub connection');
    await expect(page).toHaveURL(/\/desk\/agent\?tab=github$/);
  });

  test('TC-60.2: "Switch to polling" on the runs page opens the GitHub connection tab', async ({ page }) => {
    await page.goto(docsRuns);
    await page.getByRole('link', { name: 'Switch to polling' }).click();
    await expect(selected(page)).toHaveText('GitHub connection');
    await expect(webhook(page)).toBeVisible();
  });

  test('TC-60.3: the projects-list switch-to-polling link opens the GitHub connection tab', async ({ page }) => {
    await page.goto(`/o/${ORG}/projects`);
    await page.getByRole('link', { name: 'Switch to polling for docs-site' }).click();
    await expect(selected(page)).toHaveText('GitHub connection');
    await expect(page).toHaveURL(new RegExp(`/p/${ids.project.docsSite}/desk/agent\\?tab=github$`));
  });

  test('TC-60.4: "Change time limit" on a timed-out run opens the Limits tab', async ({ page }) => {
    await page.goto(`${projectBase}/runs/${TRANSCRIPT_TIMED_OUT_RUN}`);
    await page.getByRole('link', { name: 'Change time limit' }).click();
    await expect(selected(page)).toHaveText('Limits');
    await expect(limitsField(page)).toBeVisible();
  });

  test('TC-60.5: "Change" for runs per ticket on Routing rules opens the Limits tab', async ({ page }) => {
    await page.goto(`${projectBase}/desk/rules`);
    await page.getByRole('link', { name: 'Change', exact: true }).click();
    await expect(selected(page)).toHaveText('Limits');
    await expect(page.getByLabel('Runs per ticket')).toBeVisible();
  });

  test('TC-60.6: "Replace credential" on a run that failed for a missing credential opens that agent on Agents', async ({
    page,
  }) => {
    // The run's agent is the first of the seven-agent list, so seed that list (the default mock project has one agent).
    await seedAgents(page, 'perAgentModels');
    await page.goto(`${projectBase}/runs/${NO_CREDENTIAL_RUN}`);
    await page.getByRole('link', { name: 'Replace credential' }).click();
    await expect(selected(page)).toHaveText('Agents');
    // The run's agent (the mock's agent 1) opens in the pane: its id is the `agent` param, its name fills the Name field.
    const runAgent = agentsFixture.find((a) => a.id === agentListId(1));
    if (!runAgent) throw new Error('the run agent is missing from the agents fixture');
    await expect(page).toHaveURL(new RegExp(`[?&]agent=${runAgent.id}(&|$)`));
    const pane = page.getByRole('complementary', { name: 'Edit agent' });
    await expect(pane).toBeVisible();
    await expect(pane.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(runAgent.name);
  });

  test('TC-60.7: the navigation link, the project Settings link and the checklist item open Agents', async ({
    page,
  }) => {
    await page.goto(`${projectBase}/desk/rules`);
    await page.getByRole('link', { name: 'Agent & settings' }).click();
    await expect(selected(page)).toHaveText('Agents');
    await expect(page).toHaveURL(/\/desk\/agent$/);

    // The project's Settings link is the one in its row menu on the projects list.
    await page.goto(`/o/${ORG}/projects`);
    await page.getByRole('button', { name: /^More for invoicer-api/ }).click();
    await page
      .getByRole('dialog', { name: 'Actions for invoicer-api' })
      .getByRole('link', { name: 'Settings' })
      .click();
    await expect(selected(page)).toHaveText('Agents');

    await seedOnboarding(page, 'checklistPartial');
    await page.goto('/o/acme/projects');
    const card = page.getByRole('heading', { level: 2, name: 'Get started' }).locator('..');
    await card
      .getByRole('listitem')
      .filter({ has: page.getByText('Add an agent', { exact: true }) })
      .getByRole('link', { name: 'Start' })
      .click();
    await expect(selected(page)).toHaveText('Agents');
  });
});
