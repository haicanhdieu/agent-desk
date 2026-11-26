import { expect, test, type Page } from '@playwright/test';
import {
  BUILTIN,
  FIRST_CREATED_AGENT,
  INVOICER_API,
  INVOICER_API_AGENT,
  ORG,
  OTHER,
  options,
  setAgentModels,
} from './mock';

const DEFAULT = 'Default model';
const PROJECT_DEFAULT = 'Project default (Claude)';
const STEP_2_NOTE = 'Default model is the one picked in step 2.';

const modelSelect = (page: Page) => page.getByLabel('Model', { exact: true });
const modelNameInput = (page: Page) => page.getByLabel('Model name');
const agentSelect = (page: Page) => page.getByLabel('With agent');
const openRules = (page: Page) => page.goto(`/o/${ORG}/p/${INVOICER_API}/desk/rules`);

async function openNewRule(page: Page) {
  await openRules(page);
  await page.getByRole('button', { name: 'New rule' }).click();
  await expect(page.getByRole('heading', { name: 'New rule' })).toBeVisible();
}

/** Fills the rule form's command and picks Other model… with the given typed value, then saves. */
async function saveTypedModel(page: Page, typed: string) {
  await page.getByRole('textbox', { name: 'Command' }).fill('code-docs');
  await modelSelect(page).selectOption({ label: OTHER });
  await modelNameInput(page).fill(typed);
  await page.getByRole('button', { name: 'Save rule' }).click();
}

/** Walks the wizard from step 1 to the rules step (Step 5 of 5, "step 4" of the requirements), by clicks only. */
async function openWizardRulesStep(page: Page) {
  await page.goto(`/o/${ORG}/projects/new/repo`);
  await page.getByRole('radio', { name: 'dev/demo' }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: 'Claude Code' }).check();
  await page.getByRole('textbox', { name: 'Token' }).fill('sk-ant-oat01-e2e-not-a-real-token');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByRole('heading', { name: 'Add your first rule', level: 1 })).toBeVisible();
}

const live = (ids: string[]) => ({ [INVOICER_API_AGENT]: { kind: 'live' as const, ids } });

test.describe('BR-22 With agent lists the agent by name only', () => {
  test('TC-22.1 on a new rule the With agent option reads Claude with no model suffix', async ({ page }) => {
    await openNewRule(page);
    // Project default first, then every agent by name (multi-agent-configs BR-32).
    await expect(options(agentSelect(page))).toHaveText([PROJECT_DEFAULT, 'Claude']);
    await expect(agentSelect(page).locator('option:checked')).toHaveText(PROJECT_DEFAULT);
    await expect(page.getByText('(opus)')).toHaveCount(0);
  });

  test('TC-22.2 on an existing rule With agent reads Claude with no suffix', async ({ page }) => {
    await openRules(page);
    await page
      .getByRole('button', { name: /^Edit rule \// })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: 'Edit rule' })).toBeVisible();
    await expect(options(agentSelect(page))).toHaveText([PROJECT_DEFAULT, 'Claude']);
    await expect(page.getByText('(opus)')).toHaveCount(0);
  });

  test('TC-22.3 on the wizard rule step With agent reads Claude with no suffix', async ({ page }) => {
    await openWizardRulesStep(page);
    // The wizard rule follows the project default, so the locked field names it (multi-agent-configs BR-63).
    await expect(options(agentSelect(page))).toHaveText([PROJECT_DEFAULT]);
    await expect(page.getByText('(opus)')).toHaveCount(0);
  });
});

test.describe('BR-23 the Model field starts with Default model, then the agent models', () => {
  test('TC-23.1 the Model options are Default model, model-a, model-b, Other model…', async ({ page }) => {
    await setAgentModels(page, live(['model-a', 'model-b']));
    await openNewRule(page);
    await expect(options(modelSelect(page))).toHaveText([DEFAULT, 'model-a', 'model-b', OTHER]);
  });

  test('TC-23.2 on the wizard rule step the Model note reads "Default model is the one picked in step 2."', async ({
    page,
  }) => {
    await setAgentModels(page, { [FIRST_CREATED_AGENT]: { kind: 'live', ids: ['model-a', 'model-b'] } });
    await openWizardRulesStep(page);
    await expect(options(modelSelect(page))).toHaveText([DEFAULT, 'model-a', 'model-b', OTHER]);
    await expect(page.getByText(STEP_2_NOTE)).toBeVisible();
  });
});

test.describe('BR-24 the Model list falls back to the standard names with a reason', () => {
  const cases = [
    ['TC-24.1', 'unreachable', /Showing the standard names\..*could not be loaded/],
    ['TC-24.2', 'no_credential', /Showing the standard names\..*Save a credential/],
    ['TC-24.3', 'rejected', /Showing the standard names\..*did not accept the saved credential/],
    ['TC-24.4', 'empty', /Showing the standard names\..*returned no models/],
  ] as const;
  for (const [id, reason, note] of cases) {
    test(`${id} Default model then opus, sonnet, haiku, Other model… and a note for "${reason}"`, async ({ page }) => {
      await setAgentModels(page, { [INVOICER_API_AGENT]: { kind: 'fallback', reason } });
      await openNewRule(page);
      await expect(options(modelSelect(page))).toHaveText([DEFAULT, ...BUILTIN, OTHER]);
      await expect(page.getByText(note)).toBeVisible();
    });
  }
});

test.describe('BR-29 an invalid typed model shows an error on the Model field and the rule is not saved', () => {
  const MODEL_FORMAT = /Use 1 to 200 letters, digits or \. _ : \/ @ \[ \] \+ -, starting with a letter or digit\./;

  async function expectModelError(page: Page, message: RegExp) {
    await expect(modelNameInput(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(modelNameInput(page)).toHaveAccessibleDescription(message);
    // The rule is not saved: the pane stays open and no row exists.
    await expect(page.getByRole('heading', { name: 'New rule' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit rule /code-docs' })).toHaveCount(0);
  }

  test('TC-29.3 201 characters show an error on the Model field', async ({ page }) => {
    await openNewRule(page);
    await saveTypedModel(page, 'a'.repeat(201));
    await expectModelError(page, MODEL_FORMAT);
  });

  test('TC-29.4 -opus shows an error on the Model field', async ({ page }) => {
    await openNewRule(page);
    await saveTypedModel(page, '-opus');
    await expectModelError(page, MODEL_FORMAT);
  });

  test('TC-29.5 an empty typed model shows an error on the Model field', async ({ page }) => {
    await openNewRule(page);
    await saveTypedModel(page, '');
    await expectModelError(page, /\S/);
  });
});

test.describe('BR-30 (changed by issue #294) a rule that names a model reads "with Claude(model)"', () => {
  const ROW = 'Edit rule /code-docs';

  /** Saves a rule through the form: command code-docs, skill code-build, and the given model (a listed name or Default). */
  async function createRule(page: Page, model: string) {
    await openNewRule(page);
    await page.getByRole('textbox', { name: 'Command' }).fill('code-docs');
    await page.getByRole('combobox', { name: 'Skill', exact: true }).selectOption('code-build');
    // The Given of BR-30 is a rule that names agent Claude. Picking an agent resets Model, so it comes first.
    await agentSelect(page).selectOption({ label: 'Claude' });
    await modelSelect(page).selectOption({ label: model });
    await page.getByRole('button', { name: 'Save rule' }).click();
    await expect(page.getByRole('button', { name: ROW })).toBeVisible();
  }

  test('TC-30.1 the row of a rule naming haiku reads "run code-build with Claude(haiku)"', async ({ page }) => {
    await setAgentModels(page, { [INVOICER_API_AGENT]: { kind: 'fallback', reason: 'disabled' } });
    await createRule(page, 'haiku');
    const row = page.getByRole('button', { name: ROW });
    await expect(row).toContainText('run code-build with Claude(haiku)');
  });

  test("TC-30.2 the rule form's sentence reads run skill code-build with agent Claude(haiku)", async ({ page }) => {
    await setAgentModels(page, { [INVOICER_API_AGENT]: { kind: 'fallback', reason: 'disabled' } });
    await createRule(page, 'haiku');
    await page.getByRole('button', { name: ROW }).click();
    // The rule is open again: its Model field shows the saved model, so the model is known to the form.
    await expect(modelSelect(page)).toHaveValue('haiku');
    // Issue #294 changed BR-30: the form's slots sentence shows the selected model after the agent name.
    const sentence = page.getByText(/^When a comment starting with/);
    await expect(sentence).toHaveText(
      'When a comment starting with /code-docs is posted on an issue, run skill code-build with agent Claude(haiku).',
    );
  });

  test('TC-30.3 the row of a rule that follows the default reads "run code-build with Claude", like TC-30.1', async ({
    page,
  }) => {
    await setAgentModels(page, { [INVOICER_API_AGENT]: { kind: 'fallback', reason: 'disabled' } });
    await createRule(page, DEFAULT);
    const row = page.getByRole('button', { name: ROW });
    await expect(row).toContainText('run code-build with Claude');
    for (const name of BUILTIN) await expect(row).not.toContainText(name);
  });
});
