import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import { AGENT_KIND_CAPABILITIES } from '@agentdesk/contracts';
import { agentListId } from '../../src/mocks/dto/ids';
import { answerRequest, INVOICER_API, ORG, OTHER, options, seedAgents, setAgentModels } from './mock';

/*
 * The Edit agent pane and the row actions around it (spec 2026-11-24-multi-agent-configs-design.md, BR-10 to BR-12,
 * BR-14 to BR-22, BR-24, BR-68). `perAgentModels` seeds the seven fixture agents of invoicer-api ("Claude - Personal" is
 * the default and, with "Codex", has its own live model list); the other scenarios seed the same agents and bend the
 * connection test or a model list. The mock store reseeds on every page load, so a test opens the page once and walks
 * by clicks.
 */
test.describe.configure({ timeout: 60_000 });

const agentPage = `/o/${ORG}/p/${INVOICER_API}/desk/agent`;
const TOKEN = 'sk-ant-oat01-e2e-not-a-real-token';
const PERSONAL = 'Claude - Personal';
const WORK = 'Claude - Work';
const CODEX = 'Codex';
const OWN_ENDPOINT = 'OpenCode - Own endpoint';
const FILE = 'OpenCode - Credentials file';
const NO_SIGN_IN = 'OpenCode - No sign-in';
const NEW = 'Claude - New';

const heading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Agent & settings' });
const list = (page: Page) => page.getByRole('region', { name: 'Agents list' });
const rows = (page: Page) => list(page).getByRole('listitem');
const rowOf = (page: Page, name: string) => rows(page).filter({ has: page.getByText(name, { exact: true }) });
const addPane = (page: Page) => page.getByRole('complementary', { name: 'Add agent' });
const editPane = (page: Page) => page.getByRole('complementary', { name: 'Edit agent' });
const field = (pane: Locator, label: string) => pane.getByLabel(label, { exact: true });
const toast = (page: Page, text: string) => page.getByText(text, { exact: true });
const saveAndTest = (pane: Locator) => pane.getByRole('button', { name: 'Save and test', exact: true });
const saveAgent = (pane: Locator) => pane.getByRole('button', { name: 'Save agent', exact: true });
const modelSelect = (pane: Locator) => field(pane, 'Default model');
const connection = (pane: Locator) => pane.getByRole('region', { name: 'Connection' });
const credentialInfo = (pane: Locator) => pane.getByText(/^Set .+ by .+\. Hidden for good after saving\.$/);
const AGAIN = 'Credential needed again';
const ADDRESS_NOTE =
  'The API address changed. A saved credential is only sent to the address it was saved with, so paste it again for the new one.';
const AUTH_NOTE = 'The authentication changed. Paste the new credential.';

async function open(page: Page): Promise<void> {
  await page.goto(agentPage);
  await expect(heading(page)).toBeVisible();
}

async function openEdit(page: Page, name: string): Promise<Locator> {
  await page.getByRole('button', { name: `Edit ${name}`, exact: true }).click();
  const pane = editPane(page);
  await expect(field(pane, 'Name')).toHaveValue(name);
  return pane;
}

async function closePane(pane: Locator): Promise<void> {
  await pane.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(pane).toHaveCount(0);
}

/** Picks "Other model…" (unless it is already showing) and types the model. */
async function typeModel(pane: Locator, model: string): Promise<void> {
  const typed = pane.getByRole('textbox', { name: 'Model name', exact: true });
  if ((await typed.count()) === 0) await modelSelect(pane).selectOption({ label: OTHER });
  await typed.fill(model);
}

async function runRowTest(page: Page, name: string): Promise<void> {
  // A person scrolls a low row into view before opening its menu; a scroll after the click would close the menu.
  await rowOf(page, name).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: `Actions for ${name}`, exact: true }).click();
  await page.getByRole('button', { name: 'Test connection', exact: true }).click();
}

test.describe('BR-10: an invalid API address', () => {
  test('TC-10.1: http://example.com on a Claude Code agent shows a field error under API address and changes nothing', async ({
    page,
  }) => {
    await seedAgents(page, 'perAgentModels');
    await open(page);
    let pane = await openEdit(page, PERSONAL);
    const before = await credentialInfo(pane).innerText();
    await field(pane, 'API address').fill('http://example.com');
    await field(pane, 'Subscription token').fill(TOKEN);
    await saveAndTest(pane).click();
    await expect(field(pane, 'API address')).toHaveAttribute('aria-invalid', 'true');
    await closePane(pane);
    pane = await openEdit(page, PERSONAL);
    await expect(field(pane, 'API address')).toHaveValue('');
    await expect(credentialInfo(pane)).toHaveText(before);
    await expect(pane.getByText(AGAIN)).toHaveCount(0);
  });

  test('TC-10.2: https://10.0.0.5 (a private host) shows a field error under API address and changes nothing', async ({
    page,
  }) => {
    await seedAgents(page, 'perAgentModels');
    await open(page);
    let pane = await openEdit(page, PERSONAL);
    const before = await credentialInfo(pane).innerText();
    await field(pane, 'API address').fill('https://10.0.0.5');
    await field(pane, 'Subscription token').fill(TOKEN);
    await saveAndTest(pane).click();
    await expect(field(pane, 'API address')).toHaveAttribute('aria-invalid', 'true');
    await closePane(pane);
    pane = await openEdit(page, PERSONAL);
    await expect(field(pane, 'API address')).toHaveValue('');
    await expect(credentialInfo(pane)).toHaveText(before);
  });

  test('TC-10.3: http://llm.example.com as the OpenCode endpoint shows a field error under API endpoint and changes nothing', async ({
    page,
  }) => {
    await seedAgents(page, 'perAgentModels');
    await open(page);
    let pane = await openEdit(page, OWN_ENDPOINT);
    const saved = await field(pane, 'API endpoint').inputValue();
    await field(pane, 'API endpoint').fill('http://llm.example.com');
    await field(pane, 'API key').fill('e2e-not-a-real-key');
    await saveAndTest(pane).click();
    await expect(field(pane, 'API endpoint')).toHaveAttribute('aria-invalid', 'true');
    await closePane(pane);
    pane = await openEdit(page, OWN_ENDPOINT);
    await expect(field(pane, 'API endpoint')).toHaveValue(saved);
  });

  test('TC-10.4: an https endpoint of 2049 characters shows a field error under API endpoint and changes nothing', async ({
    page,
  }) => {
    await seedAgents(page, 'perAgentModels');
    await open(page);
    let pane = await openEdit(page, OWN_ENDPOINT);
    const saved = await field(pane, 'API endpoint').inputValue();
    const long = `https://${'a'.repeat(2041)}`;
    expect(long).toHaveLength(2049);
    await field(pane, 'API endpoint').fill(long);
    await field(pane, 'API key').fill('e2e-not-a-real-key');
    await saveAndTest(pane).click();
    await expect(field(pane, 'API endpoint')).toHaveAttribute('aria-invalid', 'true');
    await closePane(pane);
    pane = await openEdit(page, OWN_ENDPOINT);
    await expect(field(pane, 'API endpoint')).toHaveValue(saved);
  });

  test('TC-10.5: https://llm.example.com with a token shows no address error and the new credential as set', async ({
    page,
  }) => {
    await seedAgents(page, 'perAgentModels');
    await open(page);
    const seen: Request[] = [];
    page.on('request', (r) => seen.push(r));
    const pane = await openEdit(page, PERSONAL);
    const before = await credentialInfo(pane).innerText();
    await field(pane, 'API address').fill('https://llm.example.com');
    await field(pane, 'Subscription token').fill(TOKEN);
    await saveAndTest(pane).click();
    const credentialPuts = () =>
      seen.filter((r) => r.method() === 'PUT' && /\/agents\/[^/]+\/credential$/.test(new URL(r.url()).pathname));
    await expect.poll(() => credentialPuts().length).toBe(1);
    const puts = credentialPuts();
    expect(puts[0]?.postDataJSON()).toMatchObject({ baseUrl: 'https://llm.example.com' });
    await expect(field(pane, 'Subscription token')).toHaveCount(0);
    await expect(credentialInfo(pane)).toBeVisible();
    await expect(credentialInfo(pane)).not.toHaveText(before);
    await expect(pane.getByText(AGAIN)).toHaveCount(0);
    await expect(field(pane, 'API address')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(field(pane, 'API address')).toHaveValue('https://llm.example.com');
  });
});

test.describe('BR-11: an invalid model id', () => {
  test.beforeEach(async ({ page }) => {
    await seedAgents(page, 'perAgentModels');
  });

  test('TC-11.1: "bad model" (a space) shows a field error on the model and keeps the row’s model', async ({
    page,
  }) => {
    await open(page);
    const pane = await openEdit(page, PERSONAL);
    await typeModel(pane, 'bad model');
    await saveAgent(pane).click();
    await expect(pane.getByRole('textbox', { name: 'Model name', exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(editPane(page)).toBeVisible();
    await expect(rowOf(page, PERSONAL)).toContainText('opus');
    await expect(rowOf(page, PERSONAL)).not.toContainText('bad model');
  });

  test('TC-11.2: a model of 201 characters shows a field error on the model', async ({ page }) => {
    await open(page);
    const pane = await openEdit(page, PERSONAL);
    await typeModel(pane, 'm'.repeat(201));
    await saveAgent(pane).click();
    await expect(pane.getByRole('textbox', { name: 'Model name', exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(rowOf(page, PERSONAL)).not.toContainText('m'.repeat(201));
  });

  test('TC-11.3: a model of 200 valid characters is saved and shown on the row', async ({ page }) => {
    await open(page);
    const pane = await openEdit(page, PERSONAL);
    const model = 'm'.repeat(200);
    await typeModel(pane, model);
    await saveAgent(pane).click();
    await expect(toast(page, 'Agent saved')).toBeVisible();
    await expect(rowOf(page, PERSONAL)).toContainText(model);
  });

  test('TC-11.4: "Other model…" with nothing typed shows "Enter a model name."', async ({ page }) => {
    await open(page);
    const pane = await openEdit(page, PERSONAL);
    await typeModel(pane, '');
    await saveAgent(pane).click();
    await expect(pane.getByText('Enter a model name.', { exact: true })).toBeVisible();
    await expect(rowOf(page, PERSONAL)).toContainText('opus');
  });
});

test.describe('BR-12: the credential is write-only', () => {
  test('TC-12.1: after saving a token the Edit pane shows no token field, "Set … by …" and the token nowhere', async ({
    page,
  }) => {
    const canary = 'sk-fake-canary-0001';
    await open(page);
    await page.getByRole('button', { name: 'Add agent' }).click();
    const add = addPane(page);
    await add.getByRole('radio', { name: 'Claude Code', exact: true }).check();
    await field(add, 'Name').fill('Claude - Canary');
    await field(add, 'Subscription token').fill(canary);
    await saveAgent(add).click();
    await expect(toast(page, 'Agent saved')).toBeVisible();

    const pane = await openEdit(page, 'Claude - Canary');
    await expect(pane.getByLabel('Subscription token', { exact: true })).toHaveCount(0);
    await expect(pane.getByText('Subscription token', { exact: true })).toBeVisible();
    await expect(credentialInfo(pane)).toBeVisible();
    await expect(page.locator('body')).not.toContainText(canary);
    const typed = await page
      .locator('input, textarea')
      .evaluateAll((els) =>
        els.map((e) => (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement ? e.value : '')),
      );
    expect(typed.some((v) => v.includes(canary))).toBe(false);
  });
});

test.describe('BR-14: an address change needs the credential again', () => {
  test.beforeEach(async ({ page }) => {
    await seedAgents(page, 'perAgentModels');
  });

  test('TC-14.1: changing the API address shows "Credential needed again" with its note and blocks Save and test', async ({
    page,
  }) => {
    await open(page);
    const pane = await openEdit(page, PERSONAL);
    await field(pane, 'API address').fill('https://llm.example.com');
    await expect(pane.getByText(AGAIN, { exact: true })).toBeVisible();
    await expect(pane.getByText(ADDRESS_NOTE, { exact: true })).toBeVisible();
    await expect(saveAndTest(pane)).toBeDisabled();
  });

  test('TC-14.2: typing a token for the new address enables Save and test', async ({ page }) => {
    await open(page);
    const pane = await openEdit(page, PERSONAL);
    await field(pane, 'API address').fill('https://llm.example.com');
    await expect(saveAndTest(pane)).toBeDisabled();
    await field(pane, 'Subscription token').fill(TOKEN);
    await expect(saveAndTest(pane)).toBeEnabled();
  });

  test('TC-14.3: changing only the name does not ask for the credential again', async ({ page }) => {
    await open(page);
    const pane = await openEdit(page, PERSONAL);
    await field(pane, 'Name').fill('Claude - Renamed');
    await expect(pane.getByText(AGAIN)).toHaveCount(0);
    await expect(credentialInfo(pane)).toBeVisible();
  });

  test('TC-14.4: a Codex agent has no address field', async ({ page }) => {
    await open(page);
    const pane = await openEdit(page, CODEX);
    await expect(pane.getByLabel('API address')).toHaveCount(0);
    await expect(pane.getByLabel('API endpoint')).toHaveCount(0);
  });

  test('TC-14.5: changing an OpenCode endpoint shows "Credential needed again" and blocks Save and test until the key is typed', async ({
    page,
  }) => {
    await open(page);
    const pane = await openEdit(page, OWN_ENDPOINT);
    await field(pane, 'API endpoint').fill('https://llm.example.com/v1');
    await expect(pane.getByText(AGAIN, { exact: true })).toBeVisible();
    await expect(saveAndTest(pane)).toBeDisabled();
    await field(pane, 'API key').fill('e2e-not-a-real-key');
    await expect(saveAndTest(pane)).toBeEnabled();
  });

  test('TC-14.6: neither OpenCode Edit pane with a file or no credential shows an endpoint field', async ({ page }) => {
    await open(page);
    for (const name of [FILE, NO_SIGN_IN]) {
      const pane = await openEdit(page, name);
      await expect(pane.getByLabel('API endpoint')).toHaveCount(0);
      await expect(pane.getByLabel('API address')).toHaveCount(0);
      await closePane(pane);
    }
  });
});

test.describe('BR-15: an auth method change', () => {
  test.beforeEach(async ({ page }) => {
    await seedAgents(page, 'perAgentModels');
  });

  test('TC-15.1: switching a Claude Code token to an API key shows the note and blocks Save and test', async ({
    page,
  }) => {
    await open(page);
    const pane = await openEdit(page, PERSONAL);
    await pane.getByRole('button', { name: 'Replace', exact: true }).click();
    await pane.getByRole('radio', { name: 'API key', exact: true }).click();
    await expect(pane.getByText(AUTH_NOTE, { exact: true })).toBeVisible();
    await expect(saveAndTest(pane)).toBeDisabled();
  });

  test('TC-15.2: typing the API key enables Save and test', async ({ page }) => {
    await open(page);
    const pane = await openEdit(page, PERSONAL);
    await pane.getByRole('button', { name: 'Replace', exact: true }).click();
    await pane.getByRole('radio', { name: 'API key', exact: true }).click();
    await expect(saveAndTest(pane)).toBeDisabled();
    await field(pane, 'API key').fill('sk-ant-api03-e2e-not-a-real-key');
    await expect(saveAndTest(pane)).toBeEnabled();
  });

  test('TC-15.3: switching a Codex sign-in file to an API key shows the note and blocks Save and test until a key is typed', async ({
    page,
  }) => {
    await open(page);
    const pane = await openEdit(page, CODEX);
    await pane.getByRole('button', { name: 'Replace', exact: true }).click();
    await pane.getByRole('radio', { name: 'API key', exact: true }).click();
    await expect(pane.getByText(AUTH_NOTE, { exact: true })).toBeVisible();
    await expect(saveAndTest(pane)).toBeDisabled();
    await field(pane, 'API key').fill('sk-e2e-not-a-real-key');
    await expect(saveAndTest(pane)).toBeEnabled();
  });

  test('TC-15.4: switching an OpenCode credentials file to an endpoint and key needs both before Save and test', async ({
    page,
  }) => {
    await open(page);
    const pane = await openEdit(page, FILE);
    await pane.getByRole('button', { name: 'Replace', exact: true }).click();
    await pane.getByRole('radio', { name: 'API endpoint and key', exact: true }).click();
    await expect(pane.getByText(AUTH_NOTE, { exact: true })).toBeVisible();
    await field(pane, 'API key').fill('e2e-not-a-real-key');
    await expect(saveAndTest(pane)).toBeDisabled();
    await field(pane, 'API endpoint').fill('https://llm.example.com/v1');
    await expect(saveAndTest(pane)).toBeEnabled();
  });

  test('TC-15.5: keeping the subscription token and typing a new one shows no note and enables Save and test', async ({
    page,
  }) => {
    await open(page);
    const pane = await openEdit(page, PERSONAL);
    await pane.getByRole('button', { name: 'Replace', exact: true }).click();
    await field(pane, 'Subscription token').fill(TOKEN);
    await expect(pane.getByText(AUTH_NOTE)).toHaveCount(0);
    await expect(saveAndTest(pane)).toBeEnabled();
  });
});

test.describe('BR-16: the provider is read-only on Edit', () => {
  test('TC-16.1: each Edit pane shows the provider as "Fixed after creation" with no control to change it', async ({
    page,
  }) => {
    await seedAgents(page, 'perAgentModels');
    await open(page);
    const cases = [
      [PERSONAL, 'claude'],
      [CODEX, 'codex'],
      [OWN_ENDPOINT, 'opencode'],
    ] as const;
    for (const [name, kind] of cases) {
      const pane = await openEdit(page, name);
      await expect(pane.getByText('Fixed after creation', { exact: true })).toBeVisible();
      await expect(pane.getByText(AGENT_KIND_CAPABILITIES[kind].label, { exact: true })).toBeVisible();
      for (const cap of Object.values(AGENT_KIND_CAPABILITIES)) {
        await expect(pane.getByRole('radio', { name: cap.label, exact: true })).toHaveCount(0);
      }
      await expect(pane.getByRole('group', { name: 'Provider' })).toHaveCount(0);
      await closePane(pane);
    }
  });
});

test.describe('BR-17: editing persists', () => {
  test('TC-17.1: a new name, label and model show on the row after saving', async ({ page }) => {
    await seedAgents(page, 'perAgentModels');
    await open(page);
    const pane = await openEdit(page, PERSONAL);
    await field(pane, 'Name').fill('Claude - Home');
    await field(pane, 'Account label').fill('Home');
    await modelSelect(pane).selectOption('claude-sonnet-4-5');
    await saveAgent(pane).click();
    await expect(editPane(page)).toHaveCount(0);
    const row = rowOf(page, 'Claude - Home');
    await expect(row).toContainText('Home');
    await expect(row).toContainText('claude-sonnet-4-5');
    await expect(rowOf(page, PERSONAL)).toHaveCount(0);
  });
});

test.describe('BR-18: the model list is the agent’s own', () => {
  test('TC-18.1: the note shows each time and each agent’s picker lists its own models', async ({ page }) => {
    await seedAgents(page, 'opencodeEndpointModels');
    // Each list holds the agent's saved model ("opus"), so the picker shows it as a listed choice.
    await setAgentModels(page, {
      [agentListId(1)]: { kind: 'live', ids: ['opus', 'claude-opus-4-5'] },
      [agentListId(2)]: { kind: 'live', ids: ['opus', 'claude-sonnet-4-5', 'claude-haiku-4-5'] },
    });
    await open(page);
    const note = 'Loaded from the provider. Rules that don’t name a model use this one.';
    let pane = await openEdit(page, PERSONAL);
    await expect(options(modelSelect(pane))).toHaveText(['opus', 'claude-opus-4-5', OTHER]);
    await expect(pane.getByText(note, { exact: true })).toBeVisible();
    await closePane(pane);
    pane = await openEdit(page, WORK);
    await expect(options(modelSelect(pane))).toHaveText(['opus', 'claude-sonnet-4-5', 'claude-haiku-4-5', OTHER]);
    await expect(pane.getByText(note, { exact: true })).toBeVisible();
  });

  test('TC-18.2: an agent with no credential shows the standard names and the save-a-credential note', async ({
    page,
  }) => {
    await seedAgents(page, 'perAgentModels');
    await open(page);
    const pane = await openEdit(page, NEW);
    await expect(
      pane.getByText(/^Showing the standard names\. Save a credential to load the provider['’]s list\.$/),
    ).toBeVisible();
    await expect(options(modelSelect(pane))).toHaveText([
      ...AGENT_KIND_CAPABILITIES.claude.builtinModels.map((m) => m.id),
      OTHER,
    ]);
  });
});

test.describe('BR-19: the model list cannot load', () => {
  test('TC-19.1: a Claude agent whose list fails shows the standard names, the host note, and saves a typed model', async ({
    page,
  }) => {
    await seedAgents(page, 'opencodeEndpointModels');
    await setAgentModels(page, { [agentListId(1)]: { kind: 'fallback', reason: 'unreachable' } });
    await open(page);
    const pane = await openEdit(page, PERSONAL);
    // Give the agent an address so the note can name the host.
    await field(pane, 'API address').fill('https://llm.example.com');
    await field(pane, 'Subscription token').fill(TOKEN);
    await saveAndTest(pane).click();
    await expect(credentialInfo(pane)).toBeVisible();
    await expect(pane.getByText('The model list at llm.example.com could not be loaded.')).toBeVisible();
    await expect(options(modelSelect(pane))).toHaveText([
      ...AGENT_KIND_CAPABILITIES.claude.builtinModels.map((m) => m.id),
      OTHER,
    ]);
    await typeModel(pane, 'my-model-1');
    await saveAgent(pane).click();
    await expect(toast(page, 'Agent saved')).toBeVisible();
    await expect(rowOf(page, PERSONAL)).toContainText('my-model-1');
  });

  test('TC-19.2: an OpenCode endpoint whose list fails shows the built-in names and saves a typed model', async ({
    page,
  }) => {
    await seedAgents(page, 'perAgentModels');
    await setAgentModels(page, { [agentListId(4)]: { kind: 'fallback', reason: 'unreachable' } });
    await open(page);
    const pane = await openEdit(page, OWN_ENDPOINT);
    await expect(options(modelSelect(pane))).toHaveText([
      ...AGENT_KIND_CAPABILITIES.opencode.builtinModels.map((m) => m.id),
      OTHER,
    ]);
    await typeModel(pane, 'gpt-4.1');
    await saveAgent(pane).click();
    await expect(toast(page, 'Agent saved')).toBeVisible();
    await expect(rowOf(page, OWN_ENDPOINT)).toContainText('gpt-4.1');
  });

  test('TC-19.3: an OpenCode endpoint whose list answers lists the endpoint’s models', async ({ page }) => {
    await seedAgents(page, 'opencodeEndpointModels');
    await open(page);
    const pane = await openEdit(page, OWN_ENDPOINT);
    await expect(options(modelSelect(pane))).toHaveText([
      'qwen3-coder',
      'qwen3-coder-flash',
      'llama-3.3-70b-instruct',
      OTHER,
    ]);
  });
});

test.describe('BR-20: Test connection', () => {
  test('TC-20.1: the row shows "Testing…" and then "Ready"; the Edit pane’s connection block shows "Ready" and "Connected"', async ({
    page,
  }) => {
    await seedAgents(page, 'perAgentModels');
    await answerRequest(page, { method: 'POST', path: '/agents/[^/]+/test$', times: 1, hold: true });
    await open(page);
    await runRowTest(page, WORK);
    await expect(rowOf(page, WORK)).toContainText('Testing…');
    await page.evaluate(() => (window as unknown as { __releaseHeldRequest(): void }).__releaseHeldRequest());
    await expect(rowOf(page, WORK)).toContainText('Ready');
    await expect(rowOf(page, WORK)).not.toContainText('Testing…');
    const pane = await openEdit(page, WORK);
    await expect(connection(pane)).toContainText('Ready');
    await expect(connection(pane)).toContainText('Connected');
  });

  test('TC-20.2: a refused credential shows "Credential rejected" and the fixed message, and no provider text', async ({
    page,
  }) => {
    await seedAgents(page, 'testRejected');
    await open(page);
    await runRowTest(page, PERSONAL);
    await expect(rowOf(page, PERSONAL)).toContainText('Credential rejected');
    const pane = await openEdit(page, PERSONAL);
    await expect(connection(pane)).toContainText(
      'The provider refused the saved credential. Replace it, then test again.',
    );
    // The mock provider sends no text of its own; the screen must still hold no secret-looking text.
    await expect(page.locator('body')).not.toContainText('secret-token-abc');
    await expect(page.locator('body')).not.toContainText(TOKEN);
  });

  test('TC-20.3: an address that does not answer shows "Can’t reach address" and a message with no full address', async ({
    page,
  }) => {
    await seedAgents(page, 'testUnreachable');
    await open(page);
    await runRowTest(page, OWN_ENDPOINT);
    await expect(rowOf(page, OWN_ENDPOINT)).toContainText("Can't reach address");
    // The closest the mock gives: the visible message never carries the saved address with its path.
    await expect(page.locator('body')).not.toContainText('https://llm.harbor-labs.example/v1');
  });

  test('TC-20.4: an unexpected answer shows "Can’t verify"', async ({ page }) => {
    await seedAgents(page, 'testInvalid');
    await open(page);
    await runRowTest(page, PERSONAL);
    await expect(rowOf(page, PERSONAL)).toContainText("Can't verify");
  });

  test('TC-20.5: a Codex agent with a credentials file shows "Not checkable"', async ({ page }) => {
    await seedAgents(page, 'perAgentModels');
    await open(page);
    await runRowTest(page, CODEX);
    await expect(rowOf(page, CODEX)).toContainText('Not checkable');
  });

  test('TC-20.6: an OpenCode agent with a credentials file shows "Not checkable"', async ({ page }) => {
    await seedAgents(page, 'perAgentModels');
    await open(page);
    await runRowTest(page, FILE);
    await expect(rowOf(page, FILE)).toContainText('Not checkable');
  });

  test('TC-20.7: an OpenCode agent with no credential shows "Not checkable" and not "Needs credential"', async ({
    page,
  }) => {
    await seedAgents(page, 'perAgentModels');
    await open(page);
    await runRowTest(page, NO_SIGN_IN);
    await expect(rowOf(page, NO_SIGN_IN)).toContainText('Not checkable');
    await expect(rowOf(page, NO_SIGN_IN)).not.toContainText('Needs credential');
  });

  test('TC-20.8: a Claude agent with no credential shows "Needs credential"', async ({ page }) => {
    await seedAgents(page, 'perAgentModels');
    await open(page);
    await runRowTest(page, NEW);
    await expect(rowOf(page, NEW)).toContainText('Needs credential');
  });
});

test.describe('BR-21: a failing test never blocks save', () => {
  test('TC-21.1: a refused credential is still saved and the row shows "Credential rejected"', async ({ page }) => {
    await seedAgents(page, 'testRejected');
    await open(page);
    await page.getByRole('button', { name: 'Add agent' }).click();
    const pane = addPane(page);
    await pane.getByRole('radio', { name: 'Claude Code', exact: true }).check();
    await field(pane, 'Name').fill('Claude - Bad');
    await field(pane, 'Subscription token').fill(TOKEN);
    await saveAgent(pane).click();
    await expect(addPane(page)).toHaveCount(0);
    await expect(toast(page, 'Agent saved')).toBeVisible();
    await expect(rowOf(page, 'Claude - Bad')).toContainText('Credential rejected');
  });

  test('TC-21.2: an address that does not answer is still saved and the row shows "Can’t reach address"', async ({
    page,
  }) => {
    await seedAgents(page, 'testUnreachable');
    await open(page);
    await page.getByRole('button', { name: 'Add agent' }).click();
    const pane = addPane(page);
    await pane.getByRole('radio', { name: 'Claude Code', exact: true }).check();
    await field(pane, 'Name').fill('Claude - Gateway');
    await field(pane, 'API address').fill('https://llm.example.com');
    await field(pane, 'Subscription token').fill(TOKEN);
    await saveAgent(pane).click();
    await expect(toast(page, 'Agent saved')).toBeVisible();
    await expect(rowOf(page, 'Claude - Gateway')).toContainText("Can't reach address");
  });
});

test.describe('BR-22: the test status is kept', () => {
  test('TC-22.1: "Not tested", then "Ready" after a test, and still "Ready" after the list reloads', async ({
    page,
  }) => {
    // The mock keeps no row in the never-tested state, so one is made the way the app makes it: the connection test
    // that follows saving a credential cannot run (the request fails), which leaves the row "Not tested".
    await answerRequest(page, {
      method: 'POST',
      path: '/agents/[^/]+/test$',
      times: 1,
      problem: { status: 500, title: 'Internal server error' },
    });
    await open(page);
    await page.getByRole('button', { name: 'Add agent' }).click();
    const pane = addPane(page);
    await pane.getByRole('radio', { name: 'Claude Code', exact: true }).check();
    await field(pane, 'Name').fill('Claude - Fresh');
    await field(pane, 'Subscription token').fill(TOKEN);
    await saveAgent(pane).click();
    await expect(toast(page, 'Agent saved')).toBeVisible();
    await expect(rowOf(page, 'Claude - Fresh')).toContainText('Not tested');

    await runRowTest(page, 'Claude - Fresh');
    await expect(rowOf(page, 'Claude - Fresh')).toContainText('Ready');
    await page.getByRole('tab', { name: 'Limits', exact: true }).click();
    await page.getByRole('tab', { name: 'Agents', exact: true }).click();
    await expect(rowOf(page, 'Claude - Fresh')).toContainText('Ready');
    await expect(rowOf(page, 'Claude - Fresh')).not.toContainText('Not tested');
  });
});

test.describe('BR-24: Set as default from the editor', () => {
  test('TC-24.1: ticking "Use as the project default" on another agent moves the Default chip and shows the Toast', async ({
    page,
  }) => {
    await seedAgents(page, 'perAgentModels');
    await open(page);
    const pane = await openEdit(page, WORK);
    await pane.getByRole('checkbox', { name: 'Use as the project default', exact: true }).check();
    await saveAgent(pane).click();
    await expect(toast(page, 'Default agent changed. New runs only.')).toBeVisible();
    await expect(list(page).getByText('Default', { exact: true })).toHaveCount(1);
    await expect(rowOf(page, WORK).getByText('Default', { exact: true })).toBeVisible();
    await expect(rowOf(page, PERSONAL).getByText('Default', { exact: true })).toHaveCount(0);
  });

  test('TC-24.2: a new agent added with the box ticked is the only one with the Default chip', async ({ page }) => {
    await seedAgents(page, 'perAgentModels');
    await open(page);
    await page.getByRole('button', { name: 'Add agent' }).click();
    const pane = addPane(page);
    await pane.getByRole('radio', { name: 'Claude Code', exact: true }).check();
    await field(pane, 'Name').fill('Claude - Lead');
    await field(pane, 'Subscription token').fill(TOKEN);
    await pane.getByRole('checkbox', { name: 'Use as the project default', exact: true }).check();
    await saveAgent(pane).click();
    await expect(toast(page, 'Agent saved')).toBeVisible();
    await expect(list(page).getByText('Default', { exact: true })).toHaveCount(1);
    await expect(rowOf(page, 'Claude - Lead').getByText('Default', { exact: true })).toBeVisible();
  });
});

test.describe('BR-68: OpenCode with no login in the rule form', () => {
  test('TC-68.2: the rule form’s "With agent" offers it with no credential warning, and a rule on it shows none', async ({
    page,
  }) => {
    await open(page);
    await page.getByRole('button', { name: 'Add agent' }).click();
    const pane = addPane(page);
    await pane.getByRole('radio', { name: 'OpenCode', exact: true }).check();
    await field(pane, 'Name').fill('OpenCode - Free');
    await saveAgent(pane).click();
    await expect(toast(page, 'Agent saved')).toBeVisible();

    await page.getByRole('link', { name: 'Routing rules' }).click();
    await expect(page.getByRole('heading', { name: 'Routing rules', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'New rule' }).click();
    const agent = page.getByLabel('With agent');
    await expect(agent.locator('option', { hasText: 'OpenCode - Free' })).toHaveText('OpenCode - Free');
    await agent.selectOption({ label: 'OpenCode - Free' });
    await page.getByRole('textbox', { name: 'Command' }).fill('free-run');
    await page.getByRole('combobox', { name: 'Skill', exact: true }).selectOption('code-build');
    await page.getByRole('button', { name: 'Save rule' }).click();
    await expect(page.getByRole('button', { name: 'Edit rule /free-run' })).toContainText('with OpenCode - Free');
    await expect(page.getByText('has no working credential')).toHaveCount(0);
  });
});
