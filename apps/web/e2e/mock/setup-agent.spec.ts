import { expect, test, type Page } from '@playwright/test';
import { BUILTIN, FIRST_CREATED_AGENT, ORG, OTHER, options, setAgentModels } from './mock';

const GATEWAY = 'https://gateway.harbor-labs.com';
const TOKEN = 'sk-ant-oat01-e2e-not-a-real-token';
const ADDRESS_HELP =
  "Optional. Leave empty for Anthropic's default. Runs get it as ANTHROPIC_BASE_URL. Public https addresses only.";
const ADDRESS_ERROR = 'Paste the token again to change the API address.';

const modelSelect = (page: Page) => page.getByLabel('Default model');
const addressInput = (page: Page) => page.getByLabel('API address');
const agentHeading = (page: Page) => page.getByRole('heading', { name: 'Add the Claude credential', level: 1 });
const workspaceHeading = (page: Page) => page.getByRole('heading', { name: 'Prepare the workspace', level: 1 });

/** Wizard step 1 (a new project), which creates the project and its credential-less agent. */
async function startWizard(page: Page) {
  await page.goto(`/o/${ORG}/projects/new/repo`);
  await page.getByRole('radio', { name: 'dev/demo' }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(agentHeading(page)).toBeVisible();
}

/**
 * Resumes the Agent step of a project whose credential is already saved: save the token in the Agent step, then go
 * back to it. Client-side navigation only: a reload would reseed the mock store.
 */
async function resumeAgentStepWithCredential(page: Page) {
  await startWizard(page);
  await page.getByRole('textbox', { name: 'Token' }).fill(TOKEN);
  await page.getByRole('button', { name: 'Continue' }).click();
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
      await startWizard(page);
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
