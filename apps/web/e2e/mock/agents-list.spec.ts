import { expect, test, type Page } from '@playwright/test';
import { answerRequest, INVOICER_API, ORG, seedAgents } from './mock';

/*
 * The Agents tab (spec 2026-11-24-multi-agent-configs-design.md, BR-1 to BR-3, BR-23, BR-25, BR-62). The mock store
 * reseeds on every page load. `perAgentModels` is the scenario that seeds the seven fixture agents (Claude - Personal
 * is the default); its model answers are not used here.
 */
test.describe.configure({ timeout: 60_000 });

const agentPage = `/o/${ORG}/p/${INVOICER_API}/desk/agent`;

const heading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Agent & settings' });
const list = (page: Page) => page.getByRole('region', { name: 'Agents list' });
const rows = (page: Page) => list(page).getByRole('listitem');
const rowOf = (page: Page, name: string) => rows(page).filter({ has: page.getByText(name, { exact: true }) });
const menuOf = (page: Page, name: string) => page.getByRole('button', { name: `Actions for ${name}`, exact: true });
const toast = (page: Page, text: string) => page.getByText(text, { exact: true });

async function open(page: Page): Promise<void> {
  await page.goto(agentPage);
  await expect(heading(page)).toBeVisible();
}

const PERSONAL = 'Claude - Personal';
const WORK = 'Claude - Work';
const CODEX = 'Codex';
const OWN_ENDPOINT = 'OpenCode - Own endpoint';
const FILE = 'OpenCode - Credentials file';
const NO_SIGN_IN = 'OpenCode - No sign-in';

test.describe('BR-1: the Agents tab', () => {
  test.beforeEach(async ({ page }) => {
    await seedAgents(page, 'perAgentModels');
  });

  test('TC-1.1: shows the heading, the description, Add agent and the rows with their details and actions', async ({
    page,
  }) => {
    await open(page);
    await expect(page.getByRole('tab', { name: 'Agents', exact: true, selected: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Agents', exact: true })).toBeVisible();
    await expect(
      page.getByText('Configure the agent runtimes and accounts available to this project.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add agent' })).toBeVisible();
    // The fixture project has seven agents (the case's "four" is an example size).
    await expect(rows(page)).toHaveCount(7);

    // Every row: the name, the "<provider> . <account> . <auth>" line, the model, the status word, Edit and the menu.
    const expectedRows: Array<{ name: string; line: string; model: string | null; status: string }> = [
      { name: PERSONAL, line: 'Claude Code . kim@example.com . Subscription token', model: 'opus', status: 'Ready' },
      { name: WORK, line: 'Claude Code . Harbor Labs team . API key', model: 'opus', status: 'Credential rejected' },
      {
        name: CODEX,
        line: 'OpenAI Codex . kim@example.com . Sign-in file (auth.json)',
        model: 'gpt-5-codex',
        status: 'Ready',
      },
      { name: OWN_ENDPOINT, line: 'OpenCode . API endpoint and key', model: 'qwen3-coder', status: 'Ready' },
      {
        name: FILE,
        line: 'OpenCode . Credentials file',
        model: 'anthropic/claude-sonnet-4-5',
        status: 'Ready',
      },
      { name: NO_SIGN_IN, line: 'OpenCode . No sign-in', model: null, status: 'No credential' },
      { name: 'Claude - New', line: 'Claude Code', model: 'opus', status: 'Needs credential' },
    ];
    for (const { name, line, model, status } of expectedRows) {
      const row = rowOf(page, name);
      await expect(row).toContainText(line);
      if (model !== null) await expect(row).toContainText(model);
      await expect(row).toContainText(status);
      await expect(row.getByRole('button', { name: `Edit ${name}`, exact: true })).toBeVisible();
      await expect(menuOf(page, name)).toBeVisible();
    }
    await expect(list(page).getByText('Default', { exact: true })).toHaveCount(1);
    await expect(rowOf(page, PERSONAL).getByText('Default', { exact: true })).toBeVisible();

    // The row menu of a row that is not the default offers all three actions.
    for (const name of [WORK, CODEX]) {
      await menuOf(page, name).click();
      for (const item of ['Test connection', 'Set as default', 'Delete']) {
        await expect(page.getByRole('button', { name: item, exact: true })).toBeVisible();
      }
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Test connection', exact: true })).toHaveCount(0);
    }
  });

  test('TC-1.2: every row shows the provider logo as an icon next to the provider name as text; the OpenCode sublines read as specified', async ({
    page,
  }) => {
    await open(page);
    const expected: Array<[string, string]> = [
      [PERSONAL, 'Claude Code'],
      [WORK, 'Claude Code'],
      [CODEX, 'OpenAI Codex'],
      [OWN_ENDPOINT, 'OpenCode'],
      [FILE, 'OpenCode'],
      [NO_SIGN_IN, 'OpenCode'],
      ['Claude - New', 'Claude Code'],
    ];
    for (const [name, provider] of expected) {
      const row = rowOf(page, name);
      // The provider's mark is the row's first element: an icon (an svg), never a letter monogram.
      const mark = row.locator('> span').first();
      await expect(mark.locator('svg[aria-hidden="true"]')).toBeVisible();
      await expect(mark).toHaveText('');
      await expect(row.getByText(new RegExp(`^${provider}( \\.|$)`))).toBeVisible();
      await expect(row.getByRole('button', { name: `Edit ${name}`, exact: true })).toBeVisible();
    }
    await expect(rowOf(page, FILE)).toContainText('OpenCode . Credentials file');
    await expect(rowOf(page, OWN_ENDPOINT)).toContainText('OpenCode . API endpoint and key');
    await expect(rowOf(page, NO_SIGN_IN)).toContainText('OpenCode . No sign-in');
  });
});

test.describe('BR-2: one default', () => {
  test('TC-2.1: exactly one row has the Default chip and it has no Set as default', async ({ page }) => {
    await seedAgents(page, 'perAgentModels');
    await open(page);
    await expect(list(page).getByText('Default', { exact: true })).toHaveCount(1);
    await expect(rowOf(page, PERSONAL).getByText('Default', { exact: true })).toBeVisible();

    await menuOf(page, PERSONAL).click();
    await expect(page.getByRole('button', { name: 'Test connection', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Set as default', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await menuOf(page, CODEX).click();
    await expect(page.getByRole('button', { name: 'Set as default', exact: true })).toBeVisible();
  });
});

test.describe('BR-3: loading and error', () => {
  test('TC-3.1: while the list loads, skeleton rows show and no agent rows', async ({ page }) => {
    await seedAgents(page, 'perAgentModels');
    await answerRequest(page, { method: 'GET', path: '/agents$', times: 1, hold: true });
    await page.goto(agentPage);
    await expect(heading(page)).toBeVisible();
    await expect(page.getByRole('status', { name: 'Loading agents' })).toBeVisible();
    await expect(page.getByText(PERSONAL, { exact: true })).toHaveCount(0);
    await page.evaluate(() => {
      const release: unknown = Reflect.get(window, '__releaseHeldRequest');
      if (typeof release === 'function') release();
    });
    await expect(page.getByRole('status', { name: 'Loading agents' })).toHaveCount(0);
    await expect(rowOf(page, PERSONAL)).toBeVisible();
  });

  test('TC-3.2: when the list answers 500, the panel shows the error, the request id and Retry', async ({ page }) => {
    await seedAgents(page, 'listError');
    await open(page);
    await expect(page.getByText('Could not load the agents. Try again.', { exact: true })).toBeVisible();
    await expect(page.getByText(/^Request ID: \S+/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
  });

  test('TC-3.3: Retry shows the rows once the list answers normally', async ({ page }) => {
    await seedAgents(page, 'perAgentModels');
    // The list fails on its first requests (the query retries), then answers normally.
    await answerRequest(page, {
      method: 'GET',
      path: '/agents$',
      times: 4,
      problem: { status: 500, title: 'Internal server error' },
    });
    await page.goto(agentPage);
    await expect(heading(page)).toBeVisible();
    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    await expect(page.getByText('Could not load the agents. Try again.', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await retry.click();
    await expect(rows(page)).toHaveCount(7);
    await expect(page.getByText('Could not load the agents. Try again.', { exact: true })).toHaveCount(0);
  });
});

test.describe('BR-23 and BR-25: default and its explanation', () => {
  test.beforeEach(async ({ page }) => {
    await seedAgents(page, 'perAgentModels');
  });

  test('TC-23.1: Set as default moves the chip, shows the Toast and swaps the menu items', async ({ page }) => {
    await open(page);
    await menuOf(page, CODEX).click();
    await page.getByRole('button', { name: 'Set as default', exact: true }).click();
    await expect(toast(page, 'Default agent changed. New runs only.')).toBeVisible();
    await expect(rowOf(page, CODEX).getByText('Default', { exact: true })).toBeVisible();
    await expect(rowOf(page, PERSONAL).getByText('Default', { exact: true })).toHaveCount(0);
    await expect(list(page).getByText('Default', { exact: true })).toHaveCount(1);

    await menuOf(page, PERSONAL).click();
    await expect(page.getByRole('button', { name: 'Set as default', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await menuOf(page, CODEX).click();
    await expect(page.getByRole('button', { name: 'Set as default', exact: true })).toHaveCount(0);
  });

  test('TC-25.1: the tab explains when the default agent is used', async ({ page }) => {
    await open(page);
    await expect(
      page.getByText('The default agent runs a command when its routing rule does not pick an agent.', {
        exact: true,
      }),
    ).toBeVisible();
  });

  test('TC-25.2: Edit on the default agent shows "Use as the project default" checked, disabled, with its help', async ({
    page,
  }) => {
    await open(page);
    await rowOf(page, PERSONAL)
      .getByRole('button', { name: `Edit ${PERSONAL}`, exact: true })
      .click();
    const pane = page.getByRole('complementary', { name: 'Edit agent' });
    const box = pane.getByRole('checkbox', { name: 'Use as the project default' });
    await expect(box).toBeChecked();
    await expect(box).toBeDisabled();
    await expect(pane.getByText('Set another agent as default to change this.', { exact: true })).toBeVisible();
  });
});

test.describe('BR-62: a project with no agent', () => {
  const addAgent = async (page: Page, provider: string, name: string): Promise<void> => {
    await page.getByRole('button', { name: 'Add agent', exact: true }).click();
    const pane = page.getByRole('complementary', { name: 'Add agent' });
    await pane.getByRole('radio', { name: provider }).check();
    await pane.getByLabel('Name', { exact: true }).fill(name);
    await pane.getByRole('button', { name: 'Save agent', exact: true }).click();
  };

  test('TC-62.1: shows "No agents yet", the sentence and the Add agent button', async ({ page }) => {
    await seedAgents(page, 'agentsEmpty');
    await open(page);
    await expect(page.getByText('No agents yet', { exact: true })).toBeVisible();
    await expect(page.getByText(/The first one you add becomes the project default\./)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add agent', exact: true })).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
  });

  test('TC-62.2 and TC-62.3: the first agent added is Default with one POST and no set-default; the second is not', async ({
    page,
  }) => {
    await seedAgents(page, 'agentsEmpty');
    const writes: string[] = [];
    page.on('request', (req) => {
      const path = new URL(req.url()).pathname;
      if (req.method() !== 'GET' && path.startsWith('/api/')) writes.push(`${req.method()} ${path}`);
    });
    await open(page);

    await addAgent(page, 'Claude Code', 'First agent');
    // TC-62.2
    await expect(toast(page, 'Agent saved')).toBeVisible();
    await expect(rowOf(page, 'First agent').getByText('Default', { exact: true })).toBeVisible();
    await expect(page.getByText(/The first one you add becomes the project default\./)).toHaveCount(0);
    expect(writes.filter((w) => w.startsWith('POST') && w.endsWith('/agents'))).toHaveLength(1);
    expect(writes.filter((w) => w.includes('default'))).toHaveLength(0);

    // TC-62.3
    await addAgent(page, 'OpenAI Codex', 'Second agent');
    await expect(rowOf(page, 'Second agent')).toBeVisible();
    await expect(rowOf(page, 'Second agent').getByText('Default', { exact: true })).toHaveCount(0);
    await expect(rowOf(page, 'First agent').getByText('Default', { exact: true })).toBeVisible();
    expect(writes.filter((w) => w.startsWith('POST') && w.endsWith('/agents'))).toHaveLength(2);
    expect(writes.filter((w) => w.includes('default'))).toHaveLength(0);
  });
});
