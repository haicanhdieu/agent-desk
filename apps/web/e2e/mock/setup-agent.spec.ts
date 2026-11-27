import { expect, test, type Page } from '@playwright/test';
import { AGENT_KIND_CAPABILITIES, type AgentKind } from '@agentdesk/contracts';
import { BUILTIN, FIRST_CREATED_AGENT, ORG, OTHER, options, seedAgents, setAgentModels } from './mock';

const GATEWAY = 'https://gateway.harbor-labs.com';
const TOKEN = 'sk-ant-oat01-e2e-not-a-real-token';
const ADDRESS_HELP =
  'Optional. Leave empty for Anthropic’s default. Runs get it as ANTHROPIC_BASE_URL. Public https addresses only. Changing it needs the credential again.';
const ADDRESS_ERROR = 'Paste the token again to change the API address.';

const modelSelect = (page: Page) => page.getByLabel('Default model');
const addressInput = (page: Page) => page.getByLabel('API address');
const agentHeading = (page: Page) => page.getByRole('heading', { name: 'Add your agent', level: 1 });
const workspaceHeading = (page: Page) => page.getByRole('heading', { name: 'Prepare the workspace', level: 1 });

/** Wizard step 1 (a new project), which creates the project and its credential-less agent. Nothing is picked yet. */
async function startWizard(page: Page) {
  // Through the projects list, so Back reaches it again.
  await page.goto(`/o/${ORG}/projects`);
  await page.getByRole('link', { name: 'New project' }).click();
  await page.getByRole('radio', { name: 'dev/demo' }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(agentHeading(page)).toBeVisible();
}

/** The Agent step with Claude Code picked, as the placeholder agent is configured in place. */
async function startClaudeWizard(page: Page) {
  await startWizard(page);
  await page.getByRole('radio', { name: 'Claude Code' }).check();
}

/**
 * Resumes the Agent step of a project whose credential is already saved: save the token in the Agent step, leave
 * to the project list, press "Resume setup" (the project is saved on a later step) and press Back to the Agent step.
 * Client-side navigation only: a reload would reseed the mock store.
 */
async function resumeAgentStepWithCredential(page: Page) {
  await startClaudeWizard(page);
  await page.getByRole('textbox', { name: 'Token' }).fill(TOKEN);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(workspaceHeading(page)).toBeVisible();
  await page.getByRole('link', { name: 'Exit setup' }).click();
  await page.getByRole('link', { name: /^Resume setup for / }).click();
  await expect(workspaceHeading(page)).toBeVisible();
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(agentHeading(page)).toBeVisible();
}

test.describe('BR-18 the Agent step shows the API address and a Default model dropdown', () => {
  const live = { [FIRST_CREATED_AGENT]: { kind: 'live' as const, ids: ['model-a', 'model-b'] } };

  test('TC-18.1 API address with its help, and Default model listing model-a, model-b, Other model…', async ({
    page,
  }) => {
    await setAgentModels(page, live);
    await resumeAgentStepWithCredential(page);
    await expect(addressInput(page)).toBeVisible();
    await expect(page.getByText(ADDRESS_HELP)).toBeVisible();
    await expect(modelSelect(page)).toHaveJSProperty('tagName', 'SELECT');
    await expect(options(modelSelect(page))).toHaveText(['model-a', 'model-b', OTHER]);
  });

  test('TC-18.2 the fixed opus / sonnet list is not shown and Other model… is last', async ({ page }) => {
    await setAgentModels(page, live);
    await resumeAgentStepWithCredential(page);
    await expect(options(modelSelect(page)).first()).toHaveText('model-a');
    await expect(options(modelSelect(page)).last()).toHaveText(OTHER);
    for (const name of BUILTIN) await expect(modelSelect(page).locator(`option[value="${name}"]`)).toHaveCount(0);
  });
});

test.describe('BR-19 the Agent step falls back to the standard names with a reason', () => {
  const cases = [
    ['TC-19.1', { kind: 'fallback', reason: 'no_credential' }, /Showing the standard names\..*Save a credential/],
    ['TC-19.2', { kind: 'fallback', reason: 'unreachable' }, /Showing the standard names\..*could not be loaded/],
    [
      'TC-19.3',
      { kind: 'fallback', reason: 'rejected' },
      /Showing the standard names\..*did not accept the saved credential/,
    ],
    ['TC-19.4', { kind: 'fallback', reason: 'empty' }, /Showing the standard names\..*returned no models/],
  ] as const;
  for (const [id, scenario, note] of cases) {
    test(`${id} opus, sonnet, haiku, Other model… and a note for "${scenario.reason}"`, async ({ page }) => {
      await setAgentModels(page, { [FIRST_CREATED_AGENT]: scenario });
      await startClaudeWizard(page);
      await expect(options(modelSelect(page))).toHaveText([...BUILTIN, OTHER]);
      await expect(page.getByText(note)).toBeVisible();
    });
  }
});

test.describe('BR-20 changing the address needs the token again', () => {
  test('TC-20.1 a new address with the token empty shows the field error and stays on the Agent step', async ({
    page,
  }) => {
    await resumeAgentStepWithCredential(page);
    await addressInput(page).fill(GATEWAY);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText(ADDRESS_ERROR, { exact: true })).toBeVisible();
    await expect(addressInput(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(agentHeading(page)).toBeVisible();
    await expect(workspaceHeading(page)).toHaveCount(0);
  });

  test('TC-20.2 a new address with a pasted token shows no such error and moves to the next step', async ({ page }) => {
    await resumeAgentStepWithCredential(page);
    await addressInput(page).fill(GATEWAY);
    // The resumed step shows the credential as set; a new token goes in through Replace.
    await page.getByRole('button', { name: 'Replace' }).click();
    await page.getByRole('textbox', { name: 'Token' }).fill(TOKEN);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(workspaceHeading(page)).toBeVisible();
    await expect(page.getByText(ADDRESS_ERROR, { exact: true })).toHaveCount(0);
  });

  test('TC-20.3 an unchanged address with the token empty shows no such error and moves to the next step', async ({
    page,
  }) => {
    await resumeAgentStepWithCredential(page);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(workspaceHeading(page)).toBeVisible();
    await expect(page.getByText(ADDRESS_ERROR, { exact: true })).toHaveCount(0);
  });
});

/*
 * The wizard Agent step for any provider (spec 2026-11-24-multi-agent-configs-design.md, BR-53, BR-63 to BR-65, BR-68,
 * BR-69). The mock store reseeds on every page load, so a test walks by clicks after its first goto; Back and the
 * browser history go between the steps and the projects list.
 */
const CODEX_FILE = '{"tokens":{"access_token":"e2e-not-a-real-token"}}';
const OPENCODE_FILE = '{"anthropic":{"type":"api","key":"e2e-not-a-real-key"}}';
const ENDPOINT = 'https://llm.harbor-labs.com/v1';
const COMING_SOON = [
  'Gemini CLI',
  'GitHub Copilot CLI',
  'Cursor',
  'Amp',
  'Google Antigravity',
  'Aider',
  'Cline',
  'Goose',
  'Qwen Code',
  'Kiro',
];
const pick = (page: Page, label: string) => page.getByRole('radio', { name: label, exact: true }).check();
const cont = (page: Page) => page.getByRole('button', { name: 'Continue', exact: true }).click();
const agentsList = (page: Page) => page.getByRole('region', { name: 'Agents list' }).getByRole('listitem');
const stepper = (page: Page) =>
  page.getByRole('listitem').filter({ has: page.getByText('Add agent', { exact: true }) });

/** The text of the page body without the provider picker: the part that follows the pick. */
async function belowPicker(page: Page): Promise<string> {
  return page.getByRole('main').evaluate((main) => {
    const copy = main.cloneNode(true);
    if (copy instanceof HTMLElement) copy.querySelectorAll('fieldset').forEach((f) => f.remove());
    return copy.textContent ?? '';
  });
}

/** The model the step shows: the picked option, or the typed name under Other model…. */
async function shownModel(page: Page): Promise<string> {
  const typed = page.getByLabel('Model name');
  if ((await typed.count()) > 0) return typed.inputValue();
  const value = await page.getByLabel('Default model').inputValue();
  // The first option of a provider whose model is optional is its own default: no model name to show.
  return value === '_default' ? '' : value;
}

/** Wizard writes since `page.on('request')` was attached: anything that is not a read. */
function recordWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on('request', (req) => {
    if (req.method() !== 'GET' && new URL(req.url()).pathname.startsWith('/api/'))
      writes.push(`${req.method()} ${req.url()}`);
  });
  return writes;
}

/** From a wizard step back to the projects list by the browser history (as many steps as it takes), then the new project's Agents tab. */
async function openAgentsTab(page: Page): Promise<void> {
  for (let i = 0; i < 5 && !new URL(page.url()).pathname.endsWith('/projects'); i++) {
    const from = page.url();
    await page.goBack();
    await expect(page).not.toHaveURL(from);
  }
  await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
  await page.getByRole('link', { name: 'demo', exact: true }).click();
  await page.getByRole('navigation', { name: 'Project menu' }).getByRole('link', { name: 'Agent & settings' }).click();
  await expect(page.getByRole('heading', { name: 'Agent & settings', level: 1 })).toBeVisible();
  await expect(agentsList(page).first()).toBeVisible();
}

test.describe('BR-53: the Agent step offers every provider', () => {
  test('TC-53.1: heading, stepper label, three provider cards, ten Coming-soon chips, nothing picked', async ({
    page,
  }) => {
    await startWizard(page);
    await expect(agentHeading(page)).toBeVisible();
    await expect(stepper(page)).toBeVisible();
    for (const label of ['Claude Code', 'OpenAI Codex', 'OpenCode']) {
      await expect(page.getByRole('radio', { name: label, exact: true })).not.toBeChecked();
    }
    await expect(page.getByRole('radio', { name: 'Claude Code', exact: true })).toBeEnabled();
    for (const name of COMING_SOON) await expect(page.getByRole('img', { name: `${name}, coming soon` })).toBeVisible();
    await expect(page.getByRole('img', { name: /, coming soon$/ })).toHaveCount(10);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.getByLabel('Default model')).toHaveCount(0);
  });

  test('TC-53.2: Continue with nothing picked says "Pick an agent to continue." and sends nothing', async ({
    page,
  }) => {
    await startWizard(page);
    const writes = recordWrites(page);
    await cont(page);
    await expect(page.getByText('Pick an agent to continue.', { exact: true })).toBeVisible();
    await expect(agentHeading(page)).toBeVisible();
    expect(writes).toEqual([]);
  });

  test("TC-53.3: each provider shows its own choices, address and no other provider's text", async ({ page }) => {
    await startWizard(page);

    await pick(page, 'Claude Code');
    await expect(page.getByRole('radio', { name: 'Subscription token' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'API key' })).toBeVisible();
    await expect(page.getByLabel('API address')).toBeVisible();
    await expect(page.getByText(ADDRESS_HELP)).toBeVisible();

    await pick(page, 'OpenAI Codex');
    await expect(page.getByRole('radio', { name: 'Sign-in file (auth.json)' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'API key' })).toBeVisible();
    await expect(page.getByLabel('API address')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'API endpoint' })).toHaveCount(0);
    expect(await belowPicker(page)).not.toMatch(/ANTHROPIC_BASE_URL|Claude/);

    await pick(page, 'OpenCode');
    await expect(page.getByRole('radio', { name: 'Credentials file' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'API endpoint and key' })).toBeVisible();
    await expect(
      page.getByText(
        'OpenCode works without signing in. Leave the credential empty to use it that way, or add one of these.',
      ),
    ).toBeVisible();
    await expect(page.getByLabel('API address')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'API endpoint' })).toHaveCount(0);
    expect(await belowPicker(page)).not.toMatch(/ANTHROPIC_BASE_URL|Claude/);
    await pick(page, 'API endpoint and key');
    await expect(page.getByRole('textbox', { name: 'API endpoint' })).toBeVisible();
    expect(await belowPicker(page)).not.toMatch(/ANTHROPIC_BASE_URL|Claude/);
    expect(await page.locator('body').innerText()).not.toContain('Model provider');
  });
});

type Fill = (page: Page) => Promise<void>;
const typeSecret =
  (name: string, value: string): Fill =>
  async (page) => {
    await page.getByRole('textbox', { name }).fill(value);
  };
const opencodeEndpoint: Fill = async (page) => {
  await pick(page, 'API endpoint and key');
  await page.getByRole('textbox', { name: 'API endpoint' }).fill(ENDPOINT);
  await page.getByRole('textbox', { name: 'API key' }).fill('e2e-not-a-real-key');
  await page.getByLabel('Model name').fill('qwen3-coder');
};

test.describe('BR-63: the picked provider replaces the placeholder agent', () => {
  const cases: Array<{
    id: string;
    title: string;
    kind: AgentKind;
    name: string;
    provider: string;
    label: string;
    fill: Fill;
    model?: string;
  }> = [
    {
      id: 'TC-63.1',
      kind: 'codex',
      name: 'OpenAI Codex',
      title: 'Codex with a credentials file',
      provider: 'OpenAI Codex',
      label: 'OpenAI Codex',
      fill: typeSecret('auth.json contents', CODEX_FILE),
    },
    {
      id: 'TC-63.2',
      kind: 'opencode',
      name: 'OpenCode',
      title: 'OpenCode with no credential',
      provider: 'OpenCode',
      label: 'OpenCode',
      fill: async () => undefined,
    },
    {
      id: 'TC-63.2',
      kind: 'opencode',
      name: 'OpenCode',
      title: 'OpenCode with a credentials file',
      provider: 'OpenCode',
      label: 'OpenCode',
      fill: async (page) => {
        await pick(page, 'Credentials file');
        await typeSecret('Credentials file', OPENCODE_FILE)(page);
      },
    },
    {
      id: 'TC-63.2',
      kind: 'opencode',
      name: 'OpenCode',
      title: 'OpenCode with an endpoint and key',
      provider: 'OpenCode',
      label: 'OpenCode',
      fill: opencodeEndpoint,
      model: 'qwen3-coder',
    },
    {
      id: 'TC-63.3',
      kind: 'claude',
      name: 'Claude',
      title: 'Claude Code with a token',
      provider: 'Claude Code',
      label: 'Claude Code',
      fill: typeSecret('Token', TOKEN),
    },
  ];
  for (const c of cases) {
    test(`${c.id}: ${c.title}: one agent of that provider, Default, no extra Claude`, async ({ page }) => {
      await startWizard(page);
      await pick(page, c.provider);
      await c.fill(page);
      // The model the provider starts with comes from the capability table, not from what the step shows.
      const cap = AGENT_KIND_CAPABILITIES[c.kind];
      const model = c.model ?? (cap.modelOptional ? '' : (cap.builtinModels[0]?.id ?? ''));
      expect(await shownModel(page)).toBe(model);
      await cont(page);
      await expect(workspaceHeading(page)).toBeVisible();
      await expect(stepper(page)).toContainText(model === '' ? c.label : `${c.label}, ${model}`);
      await openAgentsTab(page);
      await expect(agentsList(page)).toHaveCount(1);
      const row = agentsList(page).first();
      await expect(row.getByText('Default', { exact: true })).toBeVisible();
      // The one row is named for the provider (the placeholder "Claude" stays only for Claude Code).
      await expect(row.getByText(c.name, { exact: true }).first()).toBeVisible();
      // The detail line starts with the provider the row's agent runs on.
      await expect(row.getByText(new RegExp(`^${c.label}( \\.|$)`)).last()).toBeVisible();
      const listText = (await page.getByRole('region', { name: 'Agents list' }).innerText()).replace(c.name, '');
      if (c.kind === 'claude') await expect(row.getByText('Claude', { exact: true })).toBeVisible();
      else expect(listText).not.toMatch(/Claude/);
    });
  }

  test('TC-63.5: when the placeholder cannot be deleted, step 3 opens and a Claude row needing a credential stays', async ({
    page,
  }) => {
    await seedAgents(page, 'swapDeleteFails');
    await startWizard(page);
    await pick(page, 'OpenAI Codex');
    await typeSecret('auth.json contents', CODEX_FILE)(page);
    await cont(page);
    await expect(workspaceHeading(page)).toBeVisible();
    await openAgentsTab(page);
    const left = agentsList(page).filter({ has: page.getByText('Claude', { exact: true }) });
    await expect(left).toHaveCount(1);
    await expect(left).toContainText('Needs credential');
    await expect(left.getByText('Default', { exact: true })).toHaveCount(0);
    await left.getByRole('button', { name: 'Actions for Claude', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled();
  });
});

test.describe('BR-64: no step asks for a Claude credential', () => {
  test('TC-64.1: a Codex project walks steps 3, 4 and the last, the rule follows the project default, "Add an agent" is done', async ({
    page,
  }) => {
    await startWizard(page);
    await pick(page, 'OpenAI Codex');
    await typeSecret('auth.json contents', CODEX_FILE)(page);
    await cont(page);
    const noClaudeCredential = async () => {
      await expect(page.getByText(/Claude credential/)).toHaveCount(0);
      await expect(page.locator('input[type="password"]')).toHaveCount(0);
    };
    await expect(workspaceHeading(page)).toBeVisible();
    await noClaudeCredential();
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.getByRole('heading', { name: 'Start from skill templates', level: 1 })).toBeVisible();
    await noClaudeCredential();
    await page.getByRole('button', { name: 'Commit 2 skills and continue' }).click();
    await expect(page.getByRole('heading', { name: 'Add your first rule', level: 1 })).toBeVisible();
    await noClaudeCredential();
    await expect(page.getByLabel('With agent').locator('option:checked')).toHaveText('Project default (OpenAI Codex)');
    await page.getByRole('button', { name: 'Save rules and finish' }).click();
    await expect(page.getByRole('heading', { name: 'Trigger your first run from GitHub', level: 1 })).toBeVisible();
    await noClaudeCredential();

    await page.getByRole('link', { name: 'Exit setup' }).click();
    const row = page
      .getByRole('heading', { level: 2, name: 'Get started' })
      .locator('..')
      .getByRole('listitem')
      .filter({ has: page.getByText('Add an agent', { exact: true }) });
    await expect(row.getByRole('img', { name: 'Done', exact: true })).toBeVisible();
  });
});

test.describe('BR-65: leaving and coming back keeps the saved provider', () => {
  test('TC-65.1: the step shows the Codex provider read-only, its name, its model and the credential as set, and Continue works without pasting again', async ({
    page,
  }) => {
    await startWizard(page);
    await pick(page, 'OpenAI Codex');
    await typeSecret('auth.json contents', CODEX_FILE)(page);
    const model = await shownModel(page);
    await cont(page);
    await expect(workspaceHeading(page)).toBeVisible();
    await page.getByRole('link', { name: 'Back' }).click();
    await expect(agentHeading(page)).toBeVisible();
    await expect(page.getByRole('radio', { name: 'OpenAI Codex', exact: true })).toBeChecked();
    for (const label of ['Claude Code', 'OpenAI Codex', 'OpenCode']) {
      await expect(page.getByRole('radio', { name: label, exact: true })).toBeDisabled();
    }
    await expect.poll(() => shownModel(page)).toBe(model);
    // The name and the credential show as saved: no empty token field, a "Set ... by ..." line with Replace.
    await expect(page.getByText('Agent name:')).toContainText('OpenAI Codex');
    await expect(page.getByText(/^Set .* by .*Hidden for good after saving\./)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Replace' })).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    // The credential counts as set: Continue needs no new paste.
    await cont(page);
    await expect(workspaceHeading(page)).toBeVisible();
    await expect(stepper(page)).toContainText(`OpenAI Codex, ${model}`);
    await expect(page.getByText('Paste the token to continue.')).toHaveCount(0);
  });
});

test.describe('BR-68: OpenCode needs no credential, the others do', () => {
  test('TC-68.3: OpenCode continues with an empty credential', async ({ page }) => {
    await startWizard(page);
    await pick(page, 'OpenCode');
    await cont(page);
    await expect(workspaceHeading(page)).toBeVisible();
  });

  for (const other of ['Claude Code', 'OpenAI Codex']) {
    // A separate walk on a fresh project: a saved agent's provider cannot be switched (BR-65).
    test(`TC-68.3: ${other} with an empty credential shows "Paste the token to continue."`, async ({ page }) => {
      await startWizard(page);
      await pick(page, other);
      await cont(page);
      await expect(page.getByText('Paste the token to continue.', { exact: true })).toBeVisible();
      await expect(agentHeading(page)).toBeVisible();
      await expect(workspaceHeading(page)).toHaveCount(0);
    });
  }
});

test.describe('BR-69: an OpenCode endpoint and its key go together', () => {
  test('TC-69.4: only an endpoint, then only a key, show the missing half and the step stays', async ({ page }) => {
    await startWizard(page);
    await pick(page, 'OpenCode');
    await pick(page, 'API endpoint and key');
    await page.getByLabel('Model name').fill('qwen3-coder');
    const writes = recordWrites(page);

    await page.getByRole('textbox', { name: 'API endpoint' }).fill(ENDPOINT);
    await cont(page);
    const key = page.getByRole('textbox', { name: 'API key' });
    await expect(page.getByText('Enter the API key for this endpoint.', { exact: true })).toBeVisible();
    await expect(key).toHaveAccessibleDescription(/Enter the API key for this endpoint\./);
    await expect(agentHeading(page)).toBeVisible();

    await page.getByRole('textbox', { name: 'API endpoint' }).fill('');
    await key.fill('e2e-not-a-real-key');
    await cont(page);
    await expect(page.getByText('Enter the API endpoint for this key.', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'API endpoint' })).toHaveAccessibleDescription(
      /Enter the API endpoint for this key\./,
    );
    await expect(agentHeading(page)).toBeVisible();
    await expect(workspaceHeading(page)).toHaveCount(0);
    expect(writes).toEqual([]);
  });
});

test.describe('the test result of the Agent step', () => {
  const cases = [
    ['testRejected', 'Credential rejected'],
    ['testUnreachable', "Can't reach address"],
  ] as const;
  for (const [scenario, word] of cases) {
    test(`a ${scenario} credential keeps the step with "${word}" and Continue anyway moves on`, async ({ page }) => {
      await seedAgents(page, scenario);
      await startWizard(page);
      await pick(page, 'OpenAI Codex');
      await typeSecret('auth.json contents', CODEX_FILE)(page);
      await cont(page);
      await expect(page.getByText(word, { exact: true })).toBeVisible();
      await expect(agentHeading(page)).toBeVisible();
      await page.getByRole('button', { name: 'Continue anyway' }).click();
      await expect(workspaceHeading(page)).toBeVisible();
    });
  }
});
