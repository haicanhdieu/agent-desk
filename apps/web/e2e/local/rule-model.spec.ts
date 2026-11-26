import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { RuleDto, pageOf } from '@agentdesk/contracts';
import { API, continueAgentStep, ok, readAgent, signInAndCreateProject, signInAndStartProject } from './helpers';

/*
 * Local end-to-end for the rule form's Model field (Desk → Routing rules) and the setup wizard's Agent step (spec BR-19,
 * 21, 24, 25, 26, 27, 29). The stack runs with AGENT_MODELS_SOURCE=builtin (.env.example), so every model list is the
 * fallback opus, sonnet, haiku with the reason "disabled". Every test signs in as a new dev-login user and creates its
 * own project, so the tests do not depend on each other and leave nothing shared behind. A token typed here is never
 * printed or asserted on.
 */

test.describe.configure({ timeout: 180_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

const GATEWAY = 'https://gateway.harbor-labs.com';
const OTHER = 'Other model…';
const DEFAULT = 'Default model';
const BUILTIN = ['opus', 'sonnet', 'haiku'];
const LIVE_OFF_NOTE = /Live model lists are turned off/;
/** The contract's wording for a badly formed model name (packages/contracts AgentModelId; plan "Agent calls"). */
const MODEL_FORMAT = /Use 1 to 200 letters, digits or \. _ : \/ @ \[ \] \+ -, starting with a letter or digit\./;
/** The credential's "Set … by …" line on Desk → Agent: shown only while a credential is set. */
const SET_LINE = /Set .+ by .+\. Hidden for good after saving\./;

// A unique command per rule: lowercase letters, digits and dashes only.
const newCommand = () => `mdl-${randomBytes(4).toString('hex')}`;

// ---- Setup wizard, Agent step (Setup2) ----

const wizardModel = (page: Page) => page.getByRole('combobox', { name: 'Default model' });
const wizardModelName = (page: Page) => page.getByRole('textbox', { name: 'Model name' });
const wizardAddress = (page: Page) => page.getByRole('textbox', { name: 'API address' });
const wizardToken = (page: Page) => page.getByRole('textbox', { name: 'Token' });
const agentStepHeading = (page: Page) => page.getByRole('heading', { name: 'Add your agent', level: 1 });

/** A new project's agent step opens with nothing picked: pick Claude Code, whose fields then show. */
async function pickClaude(page: Page) {
  await page.getByRole('radio', { name: 'Claude Code', exact: true }).check();
}

/** The Agent step's picker has left its loading state once the whole list is there (no "Default model" entry here). */
async function waitForWizardList(page: Page) {
  await expect(wizardModel(page).locator('option')).toHaveText([...BUILTIN, OTHER]);
}

/** The Agent step of a project, opened by its address: the page a person lands on when resuming the wizard. */
async function openAgentStep(page: Page, handle: string, projectId: string) {
  await page.goto(`/o/${handle}/projects/new/agent?project=${projectId}`);
  await expect(agentStepHeading(page)).toBeVisible();
  await waitForWizardList(page);
}

/**
 * BR-21: a new project at the Agent step; paste a token, type the address, pick the model through `pickModel`, press
 * Continue; leave to the project list; resume the project at the Agent step. `pickModel` runs after the list loaded.
 */
async function continueLeaveAndResume(page: Page, pickModel: () => Promise<void>) {
  const { handle, projectId } = await signInAndStartProject(page);
  await pickClaude(page);
  await waitForWizardList(page);
  await wizardToken(page).fill(`sk-ant-e2e-${randomBytes(8).toString('hex')}`);
  await wizardAddress(page).fill(GATEWAY);
  await pickModel();
  await continueAgentStep(page);

  // Go to the project list: a full page load, so nothing of the step is kept in the browser. The row of the project
  // is there; the list has no link back into the wizard, so the Agent step is opened by its address.
  await page.goto(`/o/${handle}/projects`);
  await expect(page.locator(`a[href="/o/${handle}/p/${projectId}/runs"]`)).toBeVisible();
  await openAgentStep(page, handle, projectId);
  return { handle, projectId };
}

/**
 * The credential "shows as set": the wizard's Agent step never shows a credential (its token field starts empty), so
 * this reads the credential where the app shows it, Desk → Agent & settings, and through the agent API.
 */
async function expectCredentialSet(page: Page, handle: string, projectId: string) {
  const agent = await readAgent(page, projectId);
  expect(agent.credential.set, 'the credential is set').toBe(true);
  await page.goto(`/o/${handle}/p/${projectId}/desk/agent?agent=${agent.id}`);
  await expect(page.getByRole('complementary', { name: 'Edit agent' })).toBeVisible();
  await expect(page.getByText(SET_LINE)).toBeVisible();
}

test('TC-19.5 with live lists off, the Agent step of a new project lists opus, sonnet, haiku, Other model… and says why', async ({
  page,
}) => {
  await signInAndStartProject(page);
  await pickClaude(page);
  await waitForWizardList(page);
  await expect(page.getByText(LIVE_OFF_NOTE)).toBeVisible();
  // A note, not an error or a loading state.
  await expect(page.getByText(/The model list could not be loaded\. You can still type/)).toHaveCount(0);
  await expect(page.getByText('Loading models…')).toHaveCount(0);
  await expect(wizardModel(page)).not.toHaveAttribute('aria-invalid', 'true');
});

// Human ruling (issue #122 run): BR-21's premise (resume from the project list; the wizard step shows the credential as
// set) is not product behaviour: users do not go back into setup; the case text should be corrected by a human. This
// test checks the saved model and address on the step after leaving, resumed through the setup URL, and the credential
// as set via the API and Desk → Agent & settings.
test('TC-21.1 the Agent step keeps haiku and the address after Continue and leaving; the credential is set (stand-in: resumed through the setup URL)', async ({
  page,
}) => {
  const { handle, projectId } = await continueLeaveAndResume(page, async () => {
    await wizardModel(page).selectOption({ label: 'haiku' });
  });
  await expect(wizardModel(page).locator('option:checked')).toHaveText('haiku');
  await expect(wizardModelName(page)).toHaveCount(0);
  await expect(wizardAddress(page)).toHaveValue(GATEWAY);
  await expectCredentialSet(page, handle, projectId);
});

// Stand-in for TC-21.2, same human ruling as TC-21.1 above.
test('TC-21.2 the Agent step keeps Other model… with vendor/model and the address after Continue and leaving; the credential is set (stand-in: resumed through the setup URL)', async ({
  page,
}) => {
  const { handle, projectId } = await continueLeaveAndResume(page, async () => {
    await wizardModel(page).selectOption({ label: OTHER });
    await wizardModelName(page).fill('vendor/model');
  });
  await expect(wizardModel(page).locator('option:checked')).toHaveText(OTHER);
  await expect(wizardModelName(page)).toHaveValue('vendor/model');
  await expect(wizardAddress(page)).toHaveValue(GATEWAY);
  await expectCredentialSet(page, handle, projectId);
});

// ---- Rule form on Desk → Routing rules ----

const modelSelect = (page: Page) => page.getByRole('combobox', { name: 'Model', exact: true });
const modelNameInput = (page: Page) => page.getByRole('textbox', { name: 'Model name' });
const ruleRow = (page: Page, command: string) => page.getByRole('button', { name: `Edit rule /${command}` });

/** The Model picker has left its loading state once the whole list is there. */
async function waitForRuleList(page: Page) {
  await expect(modelSelect(page).locator('option')).toHaveText([DEFAULT, ...BUILTIN, OTHER]);
}

/** Desk → Routing rules, with nothing open. Going to the address is a full reload. */
async function openRules(page: Page, handle: string, projectId: string) {
  await page.goto(`/o/${handle}/p/${projectId}/desk/rules`);
  await expect(page.getByRole('heading', { name: 'Routing rules', level: 1 })).toBeVisible();
}

async function openNewRule(page: Page, handle: string, projectId: string) {
  await openRules(page, handle, projectId);
  await page.getByRole('button', { name: 'New rule' }).first().click();
  await expect(page.getByRole('heading', { name: 'New rule' })).toBeVisible();
  await waitForRuleList(page);
}

/** Opens a saved rule from its row. */
async function openRule(page: Page, command: string) {
  await ruleRow(page, command).click();
  await expect(page.getByRole('heading', { name: 'Edit rule' })).toBeVisible();
  await waitForRuleList(page);
}

/** Reload (a fresh load of the rules page) and reopen the rule. */
async function reloadAndOpenRule(page: Page, handle: string, projectId: string, command: string) {
  await openRules(page, handle, projectId);
  await openRule(page, command);
}

/** Selected option text and the typed name of the Model field; `typed` undefined means no typed-name input. */
async function expectModel(page: Page, shown: string, typed?: string) {
  await expect(modelSelect(page).locator('option:checked')).toHaveText(shown);
  if (typed === undefined) await expect(modelNameInput(page)).toHaveCount(0);
  else await expect(modelNameInput(page)).toHaveValue(typed);
}

/** Given: a rule saved through the rules API (the same route the form uses), naming `model` or following the default. */
async function createRule(page: Page, projectId: string, command: string, model: string | null) {
  const { items: rules } = pageOf(RuleDto).parse(
    await ok(await page.request.get(`/api/projects/${projectId}/rules?pageSize=100`), 200, 'rules'),
  );
  const skillName = rules.find((r) => r.skillName !== null)?.skillName;
  expect(skillName, 'a skill rule from the setup to borrow its skill').toBeTruthy();
  const rule = RuleDto.parse(
    await ok(
      await page.request.post(`/api/projects/${projectId}/rules`, {
        data: { kind: 'skill', command, labelFilter: [], target: 'issue', enabled: true, skillName, model },
      }),
      201,
      'create rule',
    ),
  );
  expect(rule.model, 'the rule is saved with the given model').toBe(model);
  return rule;
}

async function listRuleCommands(page: Page, projectId: string): Promise<string[]> {
  const { items: rules } = pageOf(RuleDto).parse(
    await ok(await page.request.get(`/api/projects/${projectId}/rules?pageSize=100`), 200, 'rules'),
  );
  return rules.map((r) => r.command);
}

/** Types the command on the open new-rule form. */
async function fillCommand(page: Page, command: string) {
  await page.getByRole('textbox', { name: 'Command' }).fill(command);
}

/** Clicks Save rule on an open form; a saved rule closes the pane. */
async function clickSave(page: Page) {
  await page.getByRole('button', { name: 'Save rule' }).click();
}

async function expectSaved(page: Page) {
  await expect(page.getByRole('heading', { name: /^(New|Edit) rule$/ })).toHaveCount(0);
}

/** The error on the Model field: the typed-name input is invalid and described by the message; the pane stays open. */
async function expectModelFieldError(page: Page) {
  await expect(modelNameInput(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(modelNameInput(page)).toHaveAccessibleDescription(MODEL_FORMAT);
  await expect(page.getByRole('heading', { name: /^(New|Edit) rule$/ })).toBeVisible();
}

test('TC-24.5 with live lists off, the rule form lists Default model, opus, sonnet, haiku, Other model… and says why', async ({
  page,
}) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  await openNewRule(page, handle, projectId);
  await expect(page.getByText(LIVE_OFF_NOTE)).toBeVisible();
  await expect(page.getByText(/The model list could not be loaded\. You can still type/)).toHaveCount(0);
  await expect(page.getByText('Loading models…')).toHaveCount(0);
  await expect(modelSelect(page)).not.toHaveAttribute('aria-invalid', 'true');
});

test('TC-25.1 a listed model picked on a new rule shows after reopening and after a reload', async ({ page }) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  const command = newCommand();
  await openNewRule(page, handle, projectId);
  await fillCommand(page, command);
  await modelSelect(page).selectOption({ label: 'haiku' });
  await clickSave(page);
  await expectSaved(page);
  await expect(ruleRow(page, command)).toBeVisible();
  await openRule(page, command);
  await expectModel(page, 'haiku');
  await reloadAndOpenRule(page, handle, projectId, command);
  await expectModel(page, 'haiku');
});

test('TC-25.2 a rule following the default, edited to opus, shows opus after a reload', async ({ page }) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  const command = newCommand();
  await createRule(page, projectId, command, null);
  await openRules(page, handle, projectId);
  await openRule(page, command);
  // The Given: the rule follows the default model.
  await expectModel(page, DEFAULT);
  await modelSelect(page).selectOption({ label: 'opus' });
  await clickSave(page);
  await expectSaved(page);
  await reloadAndOpenRule(page, handle, projectId, command);
  await expectModel(page, 'opus');
});

test('TC-26.1 a typed model name is saved trimmed and shows under Other model… after reopening and a reload', async ({
  page,
}) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  const command = newCommand();
  await openNewRule(page, handle, projectId);
  await fillCommand(page, command);
  await modelSelect(page).selectOption({ label: OTHER });
  await modelNameInput(page).fill('  vendor/model[1m]  ');
  await clickSave(page);
  await expectSaved(page);
  await expect(ruleRow(page, command)).toBeVisible();
  await openRule(page, command);
  await expectModel(page, OTHER, 'vendor/model[1m]');
  await reloadAndOpenRule(page, handle, projectId, command);
  await expectModel(page, OTHER, 'vendor/model[1m]');
});

test('TC-27.1 a rule naming haiku, set back to Default model, shows Default model after reopening and a reload', async ({
  page,
}) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  const command = newCommand();
  await createRule(page, projectId, command, 'haiku');
  await openRules(page, handle, projectId);
  await openRule(page, command);
  // The Given: the rule names haiku.
  await expectModel(page, 'haiku');
  await modelSelect(page).selectOption({ label: DEFAULT });
  await clickSave(page);
  await expectSaved(page);
  await openRule(page, command);
  await expectModel(page, DEFAULT);
  await reloadAndOpenRule(page, handle, projectId, command);
  await expectModel(page, DEFAULT);
});

test('TC-29.1 a typed model with a space shows an error on the Model field and the rule R1 is not created', async ({
  page,
}) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  expect(await listRuleCommands(page, projectId), 'no rule R1 yet').not.toContain('r1');
  await openNewRule(page, handle, projectId);
  await fillCommand(page, 'r1');
  await modelSelect(page).selectOption({ label: OTHER });
  await modelNameInput(page).fill('my model');
  await clickSave(page);
  await expectModelFieldError(page);
  // Open the rules list: no R1 row, on screen or on the server.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await openRules(page, handle, projectId);
  await expect(ruleRow(page, 'r1')).toHaveCount(0);
  expect(await listRuleCommands(page, projectId)).not.toContain('r1');
});

test('TC-29.2 a typed model with a space on an existing rule shows an error on the Model field and the rule keeps haiku', async ({
  page,
}) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  const command = newCommand();
  await createRule(page, projectId, command, 'haiku');
  await openRules(page, handle, projectId);
  await openRule(page, command);
  await expectModel(page, 'haiku');
  await modelSelect(page).selectOption({ label: OTHER });
  await modelNameInput(page).fill('bad model');
  await clickSave(page);
  await expectModelFieldError(page);
  await reloadAndOpenRule(page, handle, projectId, command);
  await expectModel(page, 'haiku');
});

test('TC-29.6 a typed model of exactly 200 characters is saved and shows under Other model…', async ({ page }) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  const command = newCommand();
  const longest = 'a'.repeat(200);
  await openNewRule(page, handle, projectId);
  await fillCommand(page, command);
  await modelSelect(page).selectOption({ label: OTHER });
  await modelNameInput(page).fill(longest);
  await clickSave(page);
  // No error: the pane closes and the rule is listed.
  await expectSaved(page);
  await expect(ruleRow(page, command)).toBeVisible();
  await openRule(page, command);
  await expectModel(page, OTHER, longest);
});
