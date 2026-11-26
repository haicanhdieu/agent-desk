import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import { AGENT_KIND_CAPABILITIES, AGENT_KINDS_COMING_SOON, type AgentKind } from '@agentdesk/contracts';
import { INVOICER_API, ORG, OTHER, options, seedAgents } from './mock';

/*
 * The Add agent pane (spec 2026-11-24-multi-agent-configs-design.md, BR-4 to BR-6, BR-8, BR-9, BR-44, BR-68, BR-69).
 * Cases without a scenario run on the project as seeded (one agent, "Claude"); cases that need several agents use
 * `perAgentModels`, which seeds the seven fixture agents ("Claude - Personal" is the default). The mock store reseeds
 * on every page load, so a test opens the page once and walks by clicks.
 */
test.describe.configure({ timeout: 60_000 });

const agentPage = `/o/${ORG}/p/${INVOICER_API}/desk/agent`;
const TOKEN = 'sk-ant-oat01-e2e-not-a-real-token';

const heading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Agent & settings' });
const list = (page: Page) => page.getByRole('region', { name: 'Agents list' });
const rows = (page: Page) => list(page).getByRole('listitem');
const rowOf = (page: Page, name: string) => rows(page).filter({ has: page.getByText(name, { exact: true }) });
const addPane = (page: Page) => page.getByRole('complementary', { name: 'Add agent' });
const editPane = (page: Page) => page.getByRole('complementary', { name: 'Edit agent' });
const field = (pane: Locator, label: string) => pane.getByLabel(label, { exact: true });
const toast = (page: Page, text: string) => page.getByText(text, { exact: true });

async function open(page: Page): Promise<void> {
  await page.goto(agentPage);
  await expect(heading(page)).toBeVisible();
}

/** Opens the Add pane and picks a provider. */
async function startAdd(page: Page, provider: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Add agent' }).click();
  const pane = addPane(page);
  await expect(pane).toBeVisible();
  await pane.getByRole('radio', { name: provider, exact: true }).check();
  return pane;
}

/** A Claude Code add pane with the token typed (the subscription token is the first choice). */
async function claudePane(page: Page, name?: string): Promise<Locator> {
  const pane = await startAdd(page, 'Claude Code');
  if (name !== undefined) await field(pane, 'Name').fill(name);
  await field(pane, 'Subscription token').fill(TOKEN);
  return pane;
}

const save = (pane: Locator) => pane.getByRole('button', { name: 'Save agent' });

/** Every request the page makes, to prove what was and was not sent. */
function logRequests(page: Page): Request[] {
  const seen: Request[] = [];
  page.on('request', (r) => seen.push(r));
  return seen;
}
const apiCalls = (seen: Request[], method: string, path: RegExp) =>
  seen.filter((r) => r.method() === method && path.test(new URL(r.url()).pathname));

/**
 * Providers that show a letter monogram instead of a logo on purpose, one reason each (spec line 625). Keep in sync
 * with MONOGRAM_ONLY in src/ds/providerLogos.test.ts: the checks below fail when a listed provider shows an svg or an
 * unlisted one shows none.
 */
const MONOGRAM_ONLY: Record<string, string> = {
  Aider: 'logo terms unconfirmed (spec line 639)',
};

/** A logo is an inline svg in the container; a monogram-only provider shows its first letter and no svg instead. */
async function expectLogoOrMonogram(container: Locator, name: string): Promise<void> {
  if (name in MONOGRAM_ONLY) {
    await expect(container.locator('svg')).toHaveCount(0);
    await expect(container.locator('span[aria-hidden="true"]').filter({ hasText: /^A$/ })).toHaveCount(1);
    await expect(container).toContainText(name);
  } else {
    await expect(container.locator('svg')).toBeVisible();
  }
}

const SOON = AGENT_KINDS_COMING_SOON.map((k) => k.label);
const RUNNABLE = Object.entries(AGENT_KIND_CAPABILITIES).map(([kind, cap]) => ({
  kind: kind as AgentKind,
  label: cap.label,
  models: cap.builtinModels.map((m) => m.id),
}));

test.describe('BR-4: providers in the Add agent pane', () => {
  test('TC-4.1: the pane shows the hint and three radio cards named by the provider only, each with a logo', async ({
    page,
  }) => {
    await open(page);
    await page.getByRole('button', { name: 'Add agent' }).click();
    const pane = addPane(page);
    await expect(pane.getByText('Pick a provider to set up its name, login and model.', { exact: true })).toBeVisible();
    await expect(pane.getByRole('radio')).toHaveCount(3);
    for (const { label } of RUNNABLE) {
      const radio = pane.getByRole('radio', { name: label, exact: true });
      await expect(radio).toBeVisible();
      // The logo sits in the same card as the name.
      await expect(radio.locator('xpath=ancestor::label[1]').locator('svg')).toBeVisible();
    }
  });

  test('TC-4.2: ten Coming soon chips with logo and name, none a radio; clicking one selects nothing', async ({
    page,
  }) => {
    await open(page);
    await page.getByRole('button', { name: 'Add agent' }).click();
    const pane = addPane(page);
    expect(SOON).toHaveLength(10);
    expect(Object.keys(MONOGRAM_ONLY).every((k) => SOON.includes(k))).toBe(true);
    for (const name of SOON) {
      const chip = pane.getByRole('img', { name: `${name}, coming soon`, exact: true });
      await expect(chip).toBeVisible();
      await expect(chip).toContainText(name);
      await expectLogoOrMonogram(chip, name);
      await expect(pane.getByRole('radio', { name, exact: true })).toHaveCount(0);
    }
    await pane.getByRole('img', { name: 'Google Antigravity, coming soon', exact: true }).click();
    await expect(pane.getByRole('radio', { checked: true })).toHaveCount(0);
    await expect(pane.getByLabel('Name', { exact: true })).toHaveCount(0);
    await expect(pane.getByText('Pick a provider to set up its name, login and model.')).toBeVisible();
  });

  test('TC-4.3: Tab never lands on a Coming soon chip', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Add agent' }).click();
    const pane = addPane(page);
    await expect(pane).toBeVisible();
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press('Tab');
      const onChip = await page.evaluate(() => {
        const el = document.activeElement;
        return el instanceof HTMLElement && (el.closest('[aria-label$=", coming soon"]') !== null || el.tabIndex < -1);
      });
      expect(onChip).toBe(false);
    }
  });

  test('TC-4.4: the Edit pane of the Codex agent shows the Codex logo and the provider name', async ({ page }) => {
    await seedAgents(page, 'perAgentModels');
    await open(page);
    await page.getByRole('button', { name: 'Edit Codex', exact: true }).click();
    const pane = editPane(page);
    await expect(pane).toBeVisible();
    const provider = pane.getByText('OpenAI Codex', { exact: true });
    await expect(provider).toBeVisible();
    await expect(provider.locator('..').locator('svg')).toBeVisible();
  });

  test('TC-4.5: every logo shows and no request goes to another origin than the app', async ({ page }) => {
    const seen = logRequests(page);
    await open(page);
    await page.getByRole('button', { name: 'Add agent' }).click();
    const pane = addPane(page);
    for (const name of [...RUNNABLE.map((r) => r.label), ...SOON]) {
      await expect(pane.getByText(name, { exact: true }).first()).toBeVisible();
    }
    // Every logo shows: an inline svg in each radio card and each chip, a monogram for the allow-listed kinds.
    for (const { label } of RUNNABLE) {
      const card = pane.getByRole('radio', { name: label, exact: true }).locator('xpath=ancestor::label[1]');
      await expectLogoOrMonogram(card, label);
    }
    for (const name of SOON) {
      await expectLogoOrMonogram(pane.getByRole('img', { name: `${name}, coming soon`, exact: true }), name);
    }
    const app = new URL(page.url()).origin;
    // The page's own web fonts come from Google Fonts on every screen; the logos are inline marks, so only fonts and
    // stylesheets are left out of the count.
    const origins = new Set(
      seen
        .filter((r) => !['font', 'stylesheet'].includes(r.resourceType()))
        .map((r) => new URL(r.url()).origin)
        .filter((o) => o.startsWith('http')),
    );
    expect([...origins]).toEqual([app]);
  });
});

test.describe('BR-5: provider-specific options', () => {
  const ADDRESS_HELP =
    'Optional. Leave empty for Anthropic’s default. Runs get it as ANTHROPIC_BASE_URL. Public https addresses only. Changing it needs the credential again.';

  test('TC-5.1: Claude Code offers a subscription token or API key and an API address with its help', async ({
    page,
  }) => {
    await open(page);
    const pane = await startAdd(page, 'Claude Code');
    const auth = pane.getByRole('radiogroup', { name: 'Authentication' });
    await expect(auth.getByRole('radio')).toHaveText(['Subscription token', 'API key']);
    await expect(field(pane, 'API address')).toBeVisible();
    await expect(pane.getByText(ADDRESS_HELP, { exact: true })).toBeVisible();
  });

  test('TC-5.2: Codex offers a sign-in file or API key, no API address and no ANTHROPIC_BASE_URL', async ({ page }) => {
    await open(page);
    const pane = await startAdd(page, 'OpenAI Codex');
    const auth = pane.getByRole('radiogroup', { name: 'Authentication' });
    await expect(auth.getByRole('radio')).toHaveText(['Sign-in file (auth.json)', 'API key']);
    await expect(pane.getByLabel('API address')).toHaveCount(0);
    await expect(pane).not.toContainText('ANTHROPIC_BASE_URL');
  });

  test('TC-5.3: OpenCode offers a credentials file or an endpoint and key, neither chosen, with the no-login line', async ({
    page,
  }) => {
    await open(page);
    const pane = await startAdd(page, 'OpenCode');
    const auth = pane.getByRole('radiogroup', { name: 'Authentication' });
    await expect(auth.getByRole('radio')).toHaveText(['Credentials file', 'API endpoint and key']);
    await expect(auth.getByRole('radio', { checked: true })).toHaveCount(0);
    await expect(
      pane.getByText(
        'OpenCode works without signing in. Leave the credential empty to use it that way, or add one of these.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(pane.getByLabel('API address')).toHaveCount(0);
    await expect(pane.getByLabel('API endpoint', { exact: true })).toHaveCount(0);
    await expect(pane.getByText('Model provider')).toHaveCount(0);
    await expect(pane).not.toContainText('ANTHROPIC_BASE_URL');
  });

  test('TC-5.4: OpenCode: the endpoint and key fields show with the endpoint choice and go with a credentials file', async ({
    page,
  }) => {
    await open(page);
    const pane = await startAdd(page, 'OpenCode');
    await pane.getByRole('radio', { name: 'API endpoint and key', exact: true }).click();
    await expect(field(pane, 'API endpoint')).toBeVisible();
    await expect(field(pane, 'API key')).toBeVisible();
    await pane.getByRole('radio', { name: 'Credentials file', exact: true }).click();
    await expect(pane.getByLabel('API endpoint', { exact: true })).toHaveCount(0);
  });

  test('TC-5.5: switching from Claude Code to Codex removes the API address and the ANTHROPIC_BASE_URL text', async ({
    page,
  }) => {
    await open(page);
    const pane = await startAdd(page, 'Claude Code');
    await expect(field(pane, 'API address')).toBeVisible();
    await pane.getByRole('radio', { name: 'OpenAI Codex', exact: true }).check();
    await expect(pane.getByLabel('API address')).toHaveCount(0);
    await expect(pane).not.toContainText('ANTHROPIC_BASE_URL');
  });

  test('TC-5.6: Max turns is absent in the Add pane, present on a Claude Code Edit pane, absent on Codex', async ({
    page,
  }) => {
    await seedAgents(page, 'perAgentModels');
    await open(page);
    const close = (pane: Locator) => pane.getByRole('button', { name: 'Close', exact: true }).click();
    const added = await startAdd(page, 'Claude Code');
    await expect(added.getByLabel('Max turns')).toHaveCount(0);
    await close(added);
    await expect(addPane(page)).toHaveCount(0);

    await page.getByRole('button', { name: 'Edit Claude - Personal', exact: true }).click();
    await expect(field(editPane(page), 'Max turns')).toBeVisible();
    await close(editPane(page));
    await expect(editPane(page)).toHaveCount(0);

    await page.getByRole('button', { name: 'Edit Codex', exact: true }).click();
    await expect(field(editPane(page), 'Name')).toHaveValue('Codex');
    await expect(editPane(page).getByLabel('Max turns')).toHaveCount(0);
  });
});

test.describe('BR-6: saving a new agent', () => {
  test('TC-6.1: a Claude Code agent with name, label, token and a chosen model is created, credentialed and tested, never patched', async ({
    page,
  }) => {
    const seen = logRequests(page);
    await open(page);
    const pane = await startAdd(page, 'Claude Code');
    await field(pane, 'Name').fill('Claude - Work');
    await field(pane, 'Account label').fill('Work');
    await pane.getByRole('radio', { name: 'Subscription token', exact: true }).click();
    await field(pane, 'Subscription token').fill(TOKEN);
    await field(pane, 'Default model').selectOption('sonnet');
    await save(pane).click();

    await expect(addPane(page)).toHaveCount(0);
    await expect(toast(page, 'Agent saved')).toBeVisible();
    const row = rowOf(page, 'Claude - Work');
    await expect(row).toContainText('sonnet');
    await expect(row).toContainText('Work');

    expect(apiCalls(seen, 'POST', /\/agents$/)).toHaveLength(1);
    expect(apiCalls(seen, 'PUT', /\/agents\/[^/]+\/credential$/)).toHaveLength(1);
    expect(apiCalls(seen, 'POST', /\/agents\/[^/]+\/test$/)).toHaveLength(1);
    expect(seen.filter((r) => r.method() === 'PATCH')).toHaveLength(0);
  });

  test('TC-6.3: choosing no model saves the agent with the provider’s first standard model and sends none', async ({
    page,
  }) => {
    const seen = logRequests(page);
    await open(page);
    const pane = await claudePane(page, 'Claude - No model');
    await save(pane).click();
    await expect(toast(page, 'Agent saved')).toBeVisible();
    // The provider's first standard model, not an empty model.
    await expect(rowOf(page, 'Claude - No model')).toContainText(RUNNABLE[0]?.models[0] ?? 'missing');
    const [create] = apiCalls(seen, 'POST', /\/agents$/);
    expect(create?.postDataJSON()).not.toHaveProperty('model');
  });

  for (const { kind, label, models } of RUNNABLE) {
    test(`TC-6.3 (Add picker, ${kind}): the model picker lists the standard names of ${label}`, async ({ page }) => {
      await open(page);
      const pane = await startAdd(page, label);
      const leading = kind === 'opencode' ? [`${label} default`] : [];
      await expect(options(field(pane, 'Default model'))).toHaveText([...leading, ...models, OTHER]);
    });
  }

  test('TC-6.3 (Add picker): creating with a standard name picked sends it and the row shows it', async ({ page }) => {
    const seen = logRequests(page);
    await open(page);
    const pane = await startAdd(page, 'OpenAI Codex');
    await field(pane, 'Name').fill('Codex - Picked');
    await field(pane, 'auth.json contents').fill('{"tokens":{"access_token":"e2e-not-a-real-token"}}');
    const picked = AGENT_KIND_CAPABILITIES.codex.builtinModels[1]?.id ?? 'missing';
    await field(pane, 'Default model').selectOption(picked);
    await save(pane).click();
    await expect(toast(page, 'Agent saved')).toBeVisible();
    await expect(rowOf(page, 'Codex - Picked')).toContainText(picked);
    const [create] = apiCalls(seen, 'POST', /\/agents$/);
    expect(create?.postDataJSON()).toMatchObject({ model: picked });
  });
});

test.describe('BR-8: name and label length', () => {
  test('TC-8.1: an empty name shows a field error, keeps the pane open and adds no row', async ({ page }) => {
    await open(page);
    const pane = await claudePane(page);
    await save(pane).click();
    await expect(field(pane, 'Name')).toHaveAttribute('aria-invalid', 'true');
    await expect(addPane(page)).toBeVisible();
    await expect(rows(page)).toHaveCount(1);
  });

  test('TC-8.2: a name of only spaces shows a field error and adds no row', async ({ page }) => {
    await open(page);
    const pane = await claudePane(page, '   ');
    await save(pane).click();
    await expect(field(pane, 'Name')).toHaveAttribute('aria-invalid', 'true');
    await expect(rows(page)).toHaveCount(1);
  });

  test('TC-8.3: a name of 256 characters is saved and listed', async ({ page }) => {
    await open(page);
    const name = 'a'.repeat(256);
    const pane = await claudePane(page, name);
    await save(pane).click();
    await expect(toast(page, 'Agent saved')).toBeVisible();
    await expect(rows(page)).toHaveCount(2);
    await expect(rowOf(page, name)).toBeVisible();
  });

  test('TC-8.4: a name of 257 characters shows a field error and adds no row', async ({ page }) => {
    await open(page);
    const pane = await claudePane(page, 'a'.repeat(257));
    await save(pane).click();
    await expect(field(pane, 'Name')).toHaveAttribute('aria-invalid', 'true');
    await expect(addPane(page)).toBeVisible();
    await expect(rows(page)).toHaveCount(1);
  });

  test('TC-8.5: an account label of 256 characters is saved', async ({ page }) => {
    await open(page);
    const pane = await claudePane(page, 'Label 256');
    const label = 'b'.repeat(256);
    await field(pane, 'Account label').fill(label);
    await save(pane).click();
    await expect(toast(page, 'Agent saved')).toBeVisible();
    await expect(rowOf(page, 'Label 256')).toContainText(label);
  });

  test('TC-8.6: an account label of 257 characters shows a field error and adds no row', async ({ page }) => {
    await open(page);
    const pane = await claudePane(page, 'Label 257');
    await field(pane, 'Account label').fill('b'.repeat(257));
    await save(pane).click();
    await expect(field(pane, 'Account label')).toHaveAttribute('aria-invalid', 'true');
    await expect(addPane(page)).toBeVisible();
    await expect(rows(page)).toHaveCount(1);
  });
});

test.describe('BR-9: duplicate name', () => {
  test.beforeEach(async ({ page }) => {
    await seedAgents(page, 'perAgentModels');
  });

  test('TC-9.1: a name used in another case shows the duplicate error under Name and adds no row', async ({ page }) => {
    await open(page);
    const pane = await claudePane(page, 'claude - personal');
    await save(pane).click();
    await expect(pane.getByText('An agent with this name already exists.', { exact: true })).toBeVisible();
    await expect(field(pane, 'Name')).toHaveAttribute('aria-invalid', 'true');
    await expect(addPane(page)).toBeVisible();
    await expect(rows(page)).toHaveCount(7);
  });

  test('TC-9.2: a new name is saved and listed', async ({ page }) => {
    await open(page);
    const pane = await claudePane(page, 'Claude - Personal 2');
    await save(pane).click();
    await expect(toast(page, 'Agent saved')).toBeVisible();
    await expect(rows(page)).toHaveCount(8);
    await expect(rowOf(page, 'Claude - Personal 2')).toBeVisible();
  });

  test('TC-9.3: editing only the label of an agent is not a duplicate of its own name', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Edit Claude - Personal', exact: true }).click();
    const pane = editPane(page);
    await field(pane, 'Account label').fill('Home');
    await save(pane).click();
    await expect(toast(page, 'Agent saved')).toBeVisible();
    await expect(editPane(page)).toHaveCount(0);
    await expect(rowOf(page, 'Claude - Personal')).toContainText('Home');
  });
});

test.describe('BR-44: no run limits in the editor', () => {
  const LIMIT_FIELDS = /run time limit|keep paused|keep finished|end idle|automatic resume/i;

  test('TC-44.1: no Add pane (any provider) and no Claude Code Edit pane shows a run limit field', async ({ page }) => {
    await seedAgents(page, 'perAgentModels');
    await open(page);
    await page.getByRole('button', { name: 'Add agent' }).click();
    for (const { label } of RUNNABLE) {
      const pane = addPane(page);
      await pane.getByRole('radio', { name: label, exact: true }).check();
      await expect(field(pane, 'Name')).toBeVisible();
      await expect(pane.getByLabel(LIMIT_FIELDS)).toHaveCount(0);
      await expect(pane.getByText(LIMIT_FIELDS)).toHaveCount(0);
    }
    await addPane(page).getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Edit Claude - Personal', exact: true }).click();
    const pane = editPane(page);
    await expect(field(pane, 'Name')).toHaveValue('Claude - Personal');
    await expect(pane.getByLabel(LIMIT_FIELDS)).toHaveCount(0);
    await expect(pane.getByText(LIMIT_FIELDS)).toHaveCount(0);
  });
});

test.describe('BR-68: OpenCode with no login', () => {
  test('TC-68.1: an OpenCode agent with nothing picked is saved as "No credential", "OpenCode . No sign-in", with no warning', async ({
    page,
  }) => {
    await open(page);
    const pane = await startAdd(page, 'OpenCode');
    await field(pane, 'Name').fill('OpenCode - Free');
    await save(pane).click();
    await expect(toast(page, 'Agent saved')).toBeVisible();
    const row = rowOf(page, 'OpenCode - Free');
    await expect(row).toContainText('No credential');
    await expect(row).toContainText('OpenCode . No sign-in');
    await expect(row).not.toContainText('Needs credential');
    await expect(row).not.toContainText(/has no working credential/i);
  });
});

test.describe('BR-69: OpenCode endpoint and key together', () => {
  test('TC-69.1: only an endpoint shows "Enter the API key for this endpoint." under the key and saves nothing', async ({
    page,
  }) => {
    const seen = logRequests(page);
    await open(page);
    const pane = await startAdd(page, 'OpenCode');
    await field(pane, 'Name').fill('OpenCode - Half');
    await pane.getByRole('radio', { name: 'API endpoint and key', exact: true }).click();
    await field(pane, 'API endpoint').fill('https://llm.harbor-labs.com/v1');
    await save(pane).click();
    await expect(pane.getByText('Enter the API key for this endpoint.', { exact: true })).toBeVisible();
    await expect(field(pane, 'API key')).toHaveAttribute('aria-invalid', 'true');
    await expect(field(pane, 'API key')).toHaveAccessibleDescription(/Enter the API key for this endpoint\./);
    await expect(rows(page)).toHaveCount(1);
    expect(apiCalls(seen, 'POST', /\/agents$/)).toHaveLength(0);
    expect(apiCalls(seen, 'PUT', /\/credential$/)).toHaveLength(0);
  });

  test('TC-69.2: only a key shows "Enter the API endpoint for this key." under the endpoint and saves nothing', async ({
    page,
  }) => {
    const seen = logRequests(page);
    await open(page);
    const pane = await startAdd(page, 'OpenCode');
    await field(pane, 'Name').fill('OpenCode - Half');
    await pane.getByRole('radio', { name: 'API endpoint and key', exact: true }).click();
    await field(pane, 'API key').fill('e2e-not-a-real-key');
    await save(pane).click();
    await expect(pane.getByText('Enter the API endpoint for this key.', { exact: true })).toBeVisible();
    await expect(field(pane, 'API endpoint')).toHaveAttribute('aria-invalid', 'true');
    await expect(field(pane, 'API endpoint')).toHaveAccessibleDescription(/Enter the API endpoint for this key\./);
    await expect(rows(page)).toHaveCount(1);
    expect(apiCalls(seen, 'POST', /\/agents$/)).toHaveLength(0);
    expect(apiCalls(seen, 'PUT', /\/credential$/)).toHaveLength(0);
  });

  test('TC-69.3: a pasted credentials file with newlines is sent as valid JSON with no baseUrl; the row reads "OpenCode . Credentials file" and "Not checkable"', async ({
    page,
  }) => {
    const seen = logRequests(page);
    await open(page);
    const pane = await startAdd(page, 'OpenCode');
    await field(pane, 'Name').fill('OpenCode - File');
    await pane.getByRole('radio', { name: 'Credentials file', exact: true }).click();
    const file = '{\n  "anthropic": {\n    "type": "api",\n    "key": "e2e-not-a-real-key"\n  }\n}';
    await field(pane, 'Credentials file').fill(file);
    await save(pane).click();
    await expect(toast(page, 'Agent saved')).toBeVisible();
    const [put] = apiCalls(seen, 'PUT', /\/agents\/[^/]+\/credential$/);
    const body: unknown = put?.postDataJSON();
    expect(body).toMatchObject({ type: 'auth_json' });
    expect(body).not.toHaveProperty('baseUrl');
    const value: unknown = body !== null && typeof body === 'object' && 'value' in body ? body.value : undefined;
    expect(typeof value === 'string' && JSON.parse(value)).toEqual({
      anthropic: { type: 'api', key: 'e2e-not-a-real-key' },
    });
    const row = rowOf(page, 'OpenCode - File');
    await expect(row).toContainText('OpenCode . Credentials file');
    await expect(row).toContainText('Not checkable');
  });

  test('TC-69.3: with "Credentials file" no endpoint field is offered', async ({ page }) => {
    await open(page);
    const pane = await startAdd(page, 'OpenCode');
    await pane.getByRole('radio', { name: 'Credentials file', exact: true }).click();
    await expect(pane.getByLabel('API endpoint', { exact: true })).toHaveCount(0);
    await expect(pane.getByLabel('API address')).toHaveCount(0);
  });
});
