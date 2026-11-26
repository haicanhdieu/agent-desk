import { expect, test, type Page } from '@playwright/test';
import { INVOICER_API, ORG, OTHER_PROJECT, options, seedAgents } from './mock';

/*
 * The rule form's "With agent" selector and the rule row's credential warning (spec
 * 2026-11-24-multi-agent-configs-design.md, BR-32, BR-33, BR-40 to BR-42). `perAgentModels` seeds the seven fixture
 * agents of invoicer-api (the first, "Claude - Personal", is the default; "Claude - Personal" and "Codex" have their own
 * live model lists). Rules and extra agents a case needs as its Given go through the mock API route, as the forms do:
 * the store lives in the page, so a test never reloads after it.
 */
test.describe.configure({ timeout: 60_000 });

const rulesPage = `/o/${ORG}/p/${INVOICER_API}/desk/rules`;
const agentPage = `/o/${ORG}/p/${INVOICER_API}/desk/agent`;
const PERSONAL = 'Claude - Personal';
const CODEX = 'Codex';
const AGENT_NAMES = [
  PERSONAL,
  'Claude - Work',
  CODEX,
  'OpenCode - Own endpoint',
  'OpenCode - Credentials file',
  'OpenCode - No sign-in',
  'Claude - New',
];
const DEFAULT_OPTION = `Project default (${PERSONAL})`;

const agentSelect = (page: Page) => page.getByLabel('With agent');
const modelSelect = (page: Page) => page.getByLabel('Model', { exact: true });
const rowOf = (page: Page, command: string) => page.getByRole('button', { name: `Edit rule /${command}` });
/** The row's body: the sentence button and, beside it, the credential warning. */
const bodyOf = (page: Page, command: string) => rowOf(page, command).locator('..');
const warning = (name: string) => `${name} has no working credential. Runs from this rule will fail.`;

async function openRules(page: Page): Promise<void> {
  await page.goto(rulesPage);
  await expect(page.getByRole('heading', { name: 'Routing rules', level: 1 })).toBeVisible();
}

async function openNewRule(page: Page): Promise<void> {
  await openRules(page);
  await page.getByRole('button', { name: 'New rule' }).click();
  await expect(page.getByRole('heading', { name: 'New rule' })).toBeVisible();
}

/** Fills the command and skill of a new rule and saves it with the agent and model already picked. */
async function saveRule(page: Page, command: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Command' }).fill(command);
  await page.getByRole('combobox', { name: 'Skill', exact: true }).selectOption('code-build');
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(rowOf(page, command)).toBeVisible();
}

/** Creates an agent through the mock API route and returns its id. */
async function createAgent(page: Page, projectId: string, body: { provider: string; name: string }): Promise<string> {
  return page.evaluate(
    async ({ projectId: project, body: payload }) => {
      const res = await fetch(`/api/projects/${project}/agents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`create agent ${payload.name}: ${res.status}`);
      const created: { id: string } = await res.json();
      return created.id;
    },
    { projectId, body },
  );
}

/** Creates a rule that names the agent (by name) through the mock API route. */
async function createRuleOn(page: Page, command: string, agentName: string): Promise<void> {
  await page.evaluate(
    async ({ projectId, command: cmd, agentName: name }) => {
      const base = `/api/projects/${projectId}`;
      const listed = await (await fetch(`${base}/agents`)).json();
      const agent = (listed.items as Array<{ id: string; name: string }>).find((a) => a.name === name);
      if (!agent) throw new Error(`agent ${name} not listed`);
      const res = await fetch(`${base}/rules`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'skill',
          command: cmd,
          skillName: 'code-build',
          labelFilter: [],
          target: 'issue',
          enabled: true,
          agentId: agent.id,
        }),
      });
      if (!res.ok) throw new Error(`rule ${cmd}: ${res.status}`);
    },
    { projectId: INVOICER_API, command, agentName },
  );
}

/**
 * Opens the Agents tab (so the rules list is not loaded yet), runs the Given of a warning case through the API, then
 * follows the "Routing rules" link: client-side, so the store is kept and the list is read fresh.
 */
async function openRulesAfter(page: Page, given: () => Promise<void>): Promise<void> {
  await page.goto(agentPage);
  await expect(page.getByRole('heading', { name: 'Agent & settings', level: 1 })).toBeVisible();
  await given();
  await page.getByRole('link', { name: 'Routing rules' }).click();
  await expect(page.getByRole('heading', { name: 'Routing rules', level: 1 })).toBeVisible();
}

test.describe('BR-32: the rule form lists the project default first, then every agent', () => {
  test('TC-32.1: "With agent" opens with Project default (<name>), then each agent by name, and its help', async ({
    page,
  }) => {
    await seedAgents(page, 'perAgentModels');
    await openNewRule(page);
    await expect(options(agentSelect(page))).toHaveText([DEFAULT_OPTION, ...AGENT_NAMES]);
    await expect(agentSelect(page).locator('option:checked')).toHaveText(DEFAULT_OPTION);
    await expect(
      page.getByText('Runs use the project default when this stays on Project default.', { exact: true }),
    ).toBeVisible();
  });
});

test.describe('BR-33: a rule keeps the agent it was saved with', () => {
  test('TC-33.1: a rule saved with the Codex agent reads "with Codex" and the reopened form shows it', async ({
    page,
  }) => {
    await seedAgents(page, 'perAgentModels');
    await openNewRule(page);
    await agentSelect(page).selectOption({ label: CODEX });
    await saveRule(page, 'code-docs');
    await expect(rowOf(page, 'code-docs')).toContainText(`with ${CODEX}`);
    await rowOf(page, 'code-docs').click();
    await expect(page.getByRole('heading', { name: 'Edit rule' })).toBeVisible();
    await expect(agentSelect(page).locator('option:checked')).toHaveText(CODEX);
  });
});

test.describe('BR-40: another agent resets Model, and a rule keeps its own model with its agent', () => {
  test('TC-40.1: picking agent B puts Model back on "Default model" and names B\'s default model', async ({ page }) => {
    await seedAgents(page, 'perAgentModels');
    await openNewRule(page);
    await agentSelect(page).selectOption({ label: PERSONAL });
    await expect(options(modelSelect(page))).toContainText(['Default model', 'claude-opus-4-5', 'claude-sonnet-4-5']);
    await modelSelect(page).selectOption('claude-sonnet-4-5');
    await expect(modelSelect(page).locator('option:checked')).toHaveText('claude-sonnet-4-5');

    await agentSelect(page).selectOption({ label: CODEX });
    await expect(modelSelect(page).locator('option:checked')).toHaveText('Default model');
    await expect(
      page.getByText('Default model of Codex is gpt-5-codex, set on Agent & settings.', { exact: true }),
    ).toBeVisible();
  });

  test('TC-40.2: agent B with a model from its own list is saved and shows again on reopen', async ({ page }) => {
    await seedAgents(page, 'perAgentModels');
    await openNewRule(page);
    await agentSelect(page).selectOption({ label: CODEX });
    await expect(options(modelSelect(page))).toContainText(['Default model', 'gpt-5-codex', 'gpt-5-mini']);
    await modelSelect(page).selectOption('gpt-5-mini');
    await saveRule(page, 'code-docs');
    await rowOf(page, 'code-docs').click();
    await expect(page.getByRole('heading', { name: 'Edit rule' })).toBeVisible();
    await expect(agentSelect(page).locator('option:checked')).toHaveText(CODEX);
    await expect(modelSelect(page).locator('option:checked')).toHaveText('gpt-5-mini');
  });
});

test.describe('BR-41: a rule whose agent has no credential warns, unless the agent runs without one', () => {
  test('TC-41.1: a rule naming a Claude Code agent with no credential shows the warning', async ({ page }) => {
    await seedAgents(page, 'perAgentModels');
    await openRulesAfter(page, () => createRuleOn(page, 'no-claude', 'Claude - New'));
    await expect(bodyOf(page, 'no-claude')).toContainText(warning('Claude - New'));
  });

  test('TC-41.2: a rule naming a Codex agent with no credential shows the same warning', async ({ page }) => {
    await seedAgents(page, 'perAgentModels');
    await openRulesAfter(page, async () => {
      await createAgent(page, INVOICER_API, { provider: 'codex', name: 'Codex - Bare' });
      await createRuleOn(page, 'no-codex', 'Codex - Bare');
    });
    await expect(bodyOf(page, 'no-codex')).toContainText(warning('Codex - Bare'));
  });

  test('TC-41.3: a rule naming an OpenCode agent with no credential shows no warning', async ({ page }) => {
    await seedAgents(page, 'perAgentModels');
    await openRulesAfter(page, () => createRuleOn(page, 'no-login', 'OpenCode - No sign-in'));
    await expect(rowOf(page, 'no-login')).toBeVisible();
    await expect(rowOf(page, 'no-login')).toContainText('with OpenCode - No sign-in');
    await expect(bodyOf(page, 'no-login')).not.toContainText('has no working credential');
    await expect(page.getByText('has no working credential')).toHaveCount(0);
  });
});

test.describe("BR-42: the rule form offers only this project's agents", () => {
  test('TC-42.1: an agent of project P2 is not offered in the rule form of P1', async ({ page }) => {
    await seedAgents(page, 'perAgentModels');
    await openRules(page);
    const id = await createAgent(page, OTHER_PROJECT, { provider: 'claude', name: 'P2 only' });
    // Control: the agent exists, in P2.
    const inP2 = await page.evaluate(async (project) => {
      const listed = await (await fetch(`/api/projects/${project}/agents`)).json();
      return (listed.items as Array<{ id: string; name: string }>).map((a) => a.id);
    }, OTHER_PROJECT);
    expect(inP2).toContain(id);

    await page.getByRole('button', { name: 'New rule' }).click();
    await expect(options(agentSelect(page))).toHaveText([DEFAULT_OPTION, ...AGENT_NAMES]);
    await expect(agentSelect(page).locator('option', { hasText: 'P2 only' })).toHaveCount(0);
  });
});
