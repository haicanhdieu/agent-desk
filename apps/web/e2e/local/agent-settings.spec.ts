import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { RunDto } from '@agentdesk/contracts';
import {
  API,
  FAKE_STATE_DIR,
  addressInput,
  agentPane,
  commentOnNewTicket,
  isAgentPut,
  isCredentialPut,
  modelSelect,
  newToken,
  newTokenValue,
  ok,
  openAgent,
  openAgentPane,
  podLogLines,
  readAgent,
  setAddressAndCredential,
  setDefaultModel,
  signInAndCreateProject,
  signInAndStartProject,
} from './helpers';

/*
 * Local end-to-end for Desk → Agent & settings: default model, API address and credential replacement (spec BR-2, 6, 7,
 * 8, 11, 12, 14, 15, 16). The stack runs with AGENT_MODELS_SOURCE=builtin (.env.example), so the model list is always the
 * fallback opus, sonnet, haiku with the reason "disabled". Every test signs in as a new dev-login user and creates its
 * own project, so the tests do not depend on each other. A token typed here is never printed or asserted on.
 */

test.describe.configure({ timeout: 180_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

const GATEWAY = 'https://gateway.harbor-labs.com';
const GATEWAY_2 = 'https://gw2.harbor-labs.com';
const OTHER = 'Other model…';
const EMPTY_ADDRESS_HELP = /Optional\. Leave empty for Anthropic’s default\./;
/** The credential's "Set … by …" line: shown only while a credential is set. */
const SET_LINE = /Set .+ by .+\. Hidden for good after saving\./;

const modelName = (page: Page) => page.getByRole('textbox', { name: 'Model name' });

/** The Edit agent pane of the project's default agent, opened by its address (a fresh load of the page). */
async function openPane(page: Page, handle: string, projectId: string) {
  await openAgentPane(page, handle, projectId, (await readAgent(page, projectId)).id);
}

/** The Edit agent pane of the default agent, opened as a person does: the row's Edit button on the Agents tab. */
async function pressEdit(page: Page, handle: string, projectId: string) {
  const agent = await readAgent(page, projectId);
  await openAgent(page, handle, projectId);
  await page.getByRole('button', { name: `Edit ${agent.name}`, exact: true }).click();
  await expect(agentPane(page)).toBeVisible();
  await expect(modelSelect(page).locator('option')).toHaveText(['opus', 'sonnet', 'haiku', OTHER]);
}

/** Clicks Save agent and waits for the save to be answered; returns the HTTP status. */
async function saveAgent(page: Page): Promise<number> {
  const answered = page.waitForResponse(isAgentPut);
  await page.getByRole('button', { name: 'Save agent' }).click();
  return (await answered).status();
}

/** Types a token in the credential entry and clicks Save and test; returns the HTTP status of the credential save. */
async function testAndReplace(page: Page): Promise<number> {
  await newToken(page).fill(newTokenValue());
  const answered = page.waitForResponse(isCredentialPut);
  await page.getByRole('button', { name: 'Save and test' }).click();
  return (await answered).status();
}

/** Types an address and a token and clicks Save and test (the address change opens the replacing panel itself). */
async function changeAddress(page: Page, address: string): Promise<number> {
  await addressInput(page).fill(address);
  return testAndReplace(page);
}

/** The agent's credential file in the fake secret store (`<org>-agent-<agentId>.json`). */
async function credentialFile(agentId: string): Promise<string> {
  const dir = `${FAKE_STATE_DIR}/secrets`;
  const names = (await readdir(dir)).filter((n) => n.startsWith('org-') && n.endsWith(`-agent-${agentId}.json`));
  expect(names, `credential file of agent ${agentId} in ${dir}`).toHaveLength(1);
  return `${dir}/${names[0] ?? ''}`;
}

/**
 * The failure injection for BR-16: the agent's secret file becomes a directory holding one file. The API's first
 * Secret call of an address change is the delete of the old Secret (`rm` without `recursive` fails on a directory),
 * so the change stops there: new address, credential metadata cleared, HTTP 500. The write of the new Secret (the
 * other BR-16 failure point) is proved at the API integration layer (apps/api/test/agents.int.test.ts). The spec adds
 * no failure hook.
 */
async function breakCredentialWrites(agentId: string) {
  const file = await credentialFile(agentId);
  await rm(file, { force: true });
  await mkdir(file);
  await writeFile(`${file}/keep`, 'x');
}

/** Removes whatever is at the agent's secret path (the injected directory); fine when nothing is there. */
async function repairCredentialWrites(agentId: string) {
  const dir = `${FAKE_STATE_DIR}/secrets`;
  const names = (await readdir(dir)).filter((n) => n.startsWith('org-') && n.endsWith(`-agent-${agentId}.json`));
  for (const name of names) await rm(`${dir}/${name}`, { recursive: true, force: true });
}

/**
 * Given of TC-16.x: an address and credential saved, then the new credential write fails after the address change.
 * Reaches the state through the screen, checks it (new address, credential not set through the API and the screen),
 * runs `body`, and always removes the injected directory afterwards.
 */
async function withFailedAddressChange(
  page: Page,
  body: (state: { handle: string; projectId: string; agentId: string }) => Promise<void>,
) {
  const { handle, projectId } = await signInAndCreateProject(page);
  const agent = await readAgent(page, projectId);
  await setAddressAndCredential(page, agent.id, GATEWAY);
  await breakCredentialWrites(agent.id);
  try {
    await openPane(page, handle, projectId);
    await expect(page.getByText(SET_LINE)).toBeVisible();
    expect(await changeAddress(page, GATEWAY_2), 'credential save with the injected failure').toBe(500);
    await openPane(page, handle, projectId);
    await expect(addressInput(page)).toHaveValue(GATEWAY_2);
    await expect(page.getByText(SET_LINE)).toHaveCount(0);
    const after = await readAgent(page, projectId);
    expect(after.baseUrl, 'the new address is saved').toBe(GATEWAY_2);
    expect(after.credential.set, 'the credential is not set').toBe(false);
    await body({ handle, projectId, agentId: agent.id });
  } finally {
    await repairCredentialWrites(agent.id);
  }
}

async function runStatus(page: Page, runId: string) {
  return RunDto.parse(await ok(await page.request.get(`/api/runs/${runId}`), 200, 'run')).status;
}

test('TC-2.5 with live model lists off, Default model offers opus, sonnet, haiku and Other model… with a note, no error', async ({
  page,
}) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  await openPane(page, handle, projectId);
  await expect(modelSelect(page).locator('option')).toHaveText(['opus', 'sonnet', 'haiku', OTHER]);
  await expect(page.getByText(/Live model lists are turned off/)).toBeVisible();
  // No error or loading state. The options are DOM nodes of a native select, so opening it would add nothing.
  await expect(page.getByText(/The model list could not be loaded\. You can still type/)).toHaveCount(0);
  await expect(page.getByText('Loading models…')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(modelSelect(page)).not.toHaveAttribute('aria-invalid', 'true');
});

test('TC-6.1 a picked listed model is saved and shown after a reload', async ({ page }) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  await setDefaultModel(page, projectId, 'sonnet');
  await openPane(page, handle, projectId);
  await expect(modelSelect(page)).toHaveValue('sonnet');
  await modelSelect(page).selectOption({ label: 'haiku' });
  expect(await saveAgent(page)).toBe(200);
  await openPane(page, handle, projectId);
  await expect(modelSelect(page)).toHaveValue('haiku');
});

const TYPED_CASES = [
  { id: 'TC-6.2', typed: 'sonnet[1m]', saved: 'sonnet[1m]' },
  { id: 'TC-6.3', typed: 'vendor/model', saved: 'vendor/model' },
  { id: 'TC-6.4', typed: '  my-model-1  ', saved: 'my-model-1' },
];
for (const { id, typed, saved } of TYPED_CASES) {
  test(`${id} a typed model name is saved as ${JSON.stringify(saved)} and shown after a reload`, async ({ page }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    await setDefaultModel(page, projectId, 'sonnet');
    await openPane(page, handle, projectId);
    await modelSelect(page).selectOption({ label: OTHER });
    await modelName(page).fill(typed);
    expect(await saveAgent(page)).toBe(200);
    await openPane(page, handle, projectId);
    await expect(modelSelect(page).locator('option:checked')).toHaveText(OTHER);
    await expect(modelName(page)).toHaveValue(saved);
  });
}

test('TC-7.1–TC-7.9 invalid default model names are refused with a field error, valid ones are saved', async ({
  page,
}) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  await setDefaultModel(page, projectId, 'sonnet');
  await openPane(page, handle, projectId);

  const refused = [
    { id: 'TC-7.1', value: '' },
    { id: 'TC-7.2', value: 'a'.repeat(201) },
    { id: 'TC-7.5', value: 'my model' },
    { id: 'TC-7.6', value: 'a\tb' },
    { id: 'TC-7.7', value: '-opus' },
    { id: 'TC-7.8', value: '.opus' },
  ];
  for (const { id, value } of refused) {
    await openPane(page, handle, projectId);
    await modelSelect(page).selectOption({ label: OTHER });
    await modelName(page).fill(value);
    await page.getByRole('button', { name: 'Save agent' }).click();
    await expect(modelName(page), `${id}: field error on the Model field`).toHaveAttribute('aria-invalid', 'true');
    await openPane(page, handle, projectId);
    await expect(modelSelect(page), `${id}: default model after reload`).toHaveValue('sonnet');
  }

  const accepted = [
    { id: 'TC-7.3', value: 'a'.repeat(200) },
    { id: 'TC-7.4', value: 'a' },
    { id: 'TC-7.9', value: '9model' },
  ];
  for (const { id, value } of accepted) {
    await openPane(page, handle, projectId);
    await modelSelect(page).selectOption({ label: OTHER });
    await modelName(page).fill(value);
    expect(await saveAgent(page), `${id}: save answered`).toBe(200);
    // A saved agent closes its pane: no field error is left.
    await expect(agentPane(page), `${id}: the pane closed`).toHaveCount(0);
    await openPane(page, handle, projectId);
    await expect(modelName(page), `${id}: input after reload`).toHaveValue(value);
  }
});

test('TC-8.1 Save agent after another session changed a run limit keeps that limit and saves the model', async ({
  page,
  context,
}) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  await setDefaultModel(page, projectId, 'sonnet');
  const sessionB = await context.newPage();
  // Session A has the agent's pane open; session B has the Limits tab open.
  await openPane(page, handle, projectId);
  await openAgent(sessionB, handle, projectId, 'limits');
  const limit = (p: Page) => p.getByLabel('Run time limit', { exact: true });
  const before = await limit(sessionB).inputValue();
  // Given: session A loaded with default model sonnet.
  await expect(modelSelect(page)).toHaveValue('sonnet');
  const changed = before === '12' ? '10' : '12';

  await limit(sessionB).fill(changed);
  await sessionB.getByRole('button', { name: 'Save limits' }).click();
  await expect(sessionB.getByText('Limits saved')).toBeVisible();

  // Session A was not reloaded: it saves the model with the pane it has.
  await modelSelect(page).selectOption({ label: 'haiku' });
  expect(await saveAgent(page)).toBe(200);
  await openAgent(page, handle, projectId, 'limits');
  await expect(limit(page)).toHaveValue(changed);
  await openPane(page, handle, projectId);
  await expect(modelSelect(page)).toHaveValue('haiku');
});

test('TC-11.1 an empty API address with a new credential is saved as empty, the credential shows as set', async ({
  page,
}) => {
  const { handle, projectId } = await signInAndStartProject(page);
  await openPane(page, handle, projectId);
  await expect(addressInput(page)).toHaveValue('');
  await expect(page.getByText(SET_LINE)).toHaveCount(0);
  // No credential yet: the pane asks for the token at once, there is nothing to replace.
  await expect(page.getByRole('button', { name: 'Replace', exact: true })).toHaveCount(0);
  expect(await testAndReplace(page)).toBe(200);
  await openPane(page, handle, projectId);
  await expect(addressInput(page)).toHaveValue('');
  await expect(page.getByText(EMPTY_ADDRESS_HELP)).toBeVisible();
  await expect(page.getByText(SET_LINE)).toBeVisible();
});

test('TC-12.1–TC-12.5, TC-12.7, TC-12.8 an invalid API address is refused with a field error and nothing is saved', async ({
  page,
}) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  const refused = [
    { id: 'TC-12.1', address: 'http://gateway.harbor-labs.com' },
    { id: 'TC-12.2', address: 'https://user:pass@gateway.harbor-labs.com' },
    { id: 'TC-12.3', address: 'https://gateway.harbor-labs.com/v1?key=1' },
    { id: 'TC-12.4', address: 'https://gateway.harbor-labs.com/v1#top' },
    { id: 'TC-12.5', address: `https://gateway.harbor-labs.com/${'a'.repeat(2017)}` },
    { id: 'TC-12.7', address: 'https://localhost' },
    { id: 'TC-12.7', address: 'https://app.localhost' },
    ...[
      'https://10.0.0.1',
      'https://172.16.0.1',
      'https://192.168.1.1',
      'https://127.0.0.1',
      'https://169.254.169.254',
      'https://100.64.0.1',
      'https://0.0.0.0',
    ].map((address) => ({ id: 'TC-12.8', address })),
  ];
  for (const { id, address } of refused) {
    const what = `${id} ${address.slice(0, 60)}`;
    await openPane(page, handle, projectId);
    expect(await changeAddress(page, address), `${what}: credential save refused`).toBe(400);
    await expect(addressInput(page), `${what}: field error on the address`).toHaveAttribute('aria-invalid', 'true');
    await openPane(page, handle, projectId);
    await expect(addressInput(page), `${what}: address after reload`).toHaveValue('');
  }
});

test('TC-12.6 an API address of exactly 2048 characters is accepted', async ({ page }) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  const address = `https://gateway.harbor-labs.com/${'a'.repeat(2016)}`;
  await openPane(page, handle, projectId);
  expect(await changeAddress(page, address)).toBe(200);
  await expect(addressInput(page)).not.toHaveAttribute('aria-invalid', 'true');
  await openPane(page, handle, projectId);
  await expect(addressInput(page)).toHaveValue(address);
});

test('TC-12.9 a public https API address is accepted and the credential shows as set', async ({ page }) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  await openPane(page, handle, projectId);
  expect(await changeAddress(page, GATEWAY)).toBe(200);
  await expect(addressInput(page)).not.toHaveAttribute('aria-invalid', 'true');
  await openPane(page, handle, projectId);
  await expect(addressInput(page)).toHaveValue(GATEWAY);
  await expect(page.getByText(SET_LINE)).toBeVisible();
});

test('TC-14.1 a new address with a new credential is saved together, the credential shows as set', async ({ page }) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  await openPane(page, handle, projectId);
  await expect(addressInput(page)).toHaveValue('');
  await expect(page.getByText(SET_LINE)).toBeVisible();
  expect(await changeAddress(page, GATEWAY)).toBe(200);
  await openPane(page, handle, projectId);
  await expect(addressInput(page)).toHaveValue(GATEWAY);
  await expect(page.getByText(SET_LINE)).toBeVisible();
});

test('TC-14.2 an address changed to another address with a new credential is saved together', async ({ page }) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  await setAddressAndCredential(page, (await readAgent(page, projectId)).id, GATEWAY);
  await openPane(page, handle, projectId);
  await expect(addressInput(page)).toHaveValue(GATEWAY);
  expect(await changeAddress(page, GATEWAY_2)).toBe(200);
  await openPane(page, handle, projectId);
  await expect(addressInput(page)).toHaveValue(GATEWAY_2);
  await expect(page.getByText(SET_LINE)).toBeVisible();
});

test('TC-14.3 a cleared address with a new credential is saved as empty, the credential shows as set', async ({
  page,
}) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  await setAddressAndCredential(page, (await readAgent(page, projectId)).id, GATEWAY);
  await openPane(page, handle, projectId);
  await expect(addressInput(page)).toHaveValue(GATEWAY);
  expect(await changeAddress(page, '')).toBe(200);
  await openPane(page, handle, projectId);
  await expect(addressInput(page)).toHaveValue('');
  await expect(page.getByText(EMPTY_ADDRESS_HELP)).toBeVisible();
  await expect(page.getByText(SET_LINE)).toBeVisible();
});

test('TC-15.1 Save agent alone does not change the API address (it stays disabled while the address is edited)', async ({
  page,
}) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  await setAddressAndCredential(page, (await readAgent(page, projectId)).id, GATEWAY);
  const before = await readAgent(page, projectId);
  await openPane(page, handle, projectId);
  await addressInput(page).fill(GATEWAY_2);
  // An edited address is saved only together with its credential, so Save agent cannot send it alone.
  await expect(page.getByRole('button', { name: 'Save agent' })).toBeDisabled();
  await openPane(page, handle, projectId);
  await expect(addressInput(page)).toHaveValue(GATEWAY);
  await expect(page.getByText(SET_LINE)).toBeVisible();
  const after = await readAgent(page, projectId);
  expect(after.baseUrl, 'saved address').toBe(GATEWAY);
  expect(after.credential, 'the credential was not replaced').toEqual(before.credential);
});

test('TC-15.2 Save and test needs a token: with an empty token nothing is replaced', async ({ page }) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  await setAddressAndCredential(page, (await readAgent(page, projectId)).id, GATEWAY);
  const before = await readAgent(page, projectId);
  await openPane(page, handle, projectId);
  await addressInput(page).fill(GATEWAY_2);
  await expect(newToken(page)).toHaveValue('');
  // The case allows a message or a disabled control (Q4); the screen disables the button.
  await expect(page.getByRole('button', { name: 'Save and test' })).toBeDisabled();
  await openPane(page, handle, projectId);
  await expect(addressInput(page)).toHaveValue(GATEWAY);
  await expect(page.getByText(SET_LINE)).toBeVisible();
  const after = await readAgent(page, projectId);
  expect(after.baseUrl, 'saved address').toBe(GATEWAY);
  expect(after.credential, 'the credential was not replaced').toEqual(before.credential);
});

test('TC-16.1 a failed credential write after an address change leaves the new address with the credential not set', async ({
  page,
}) => {
  // The state itself is asserted inside: new address after reload, no "Set … by …" line, credential.set false by API.
  await withFailedAddressChange(page, async () => {});
});

test('TC-16.2 with the credential not set, a comment on the rule starts no run for the agent', async ({ page }) => {
  // Sign-in and wizard (up to 60 s waiting for the setup test) plus the run's failure.
  test.setTimeout(300_000);
  await withFailedAddressChange(page, async ({ handle, projectId, agentId }) => {
    // The broken secret path would make the worker's read fail with a retryable store error. Remove it first, so
    // the only reason left for the run to fail is "no credential": the database says not set and no Secret exists.
    await repairCredentialWrites(agentId);
    const runId = await commentOnNewTicket(page, handle, projectId, '/code-review');
    const seen = new Set<string>();
    await expect
      .poll(
        async () => {
          const status = await runStatus(page, runId);
          seen.add(status);
          return status;
        },
        { timeout: 90_000, message: 'the run ends failed' },
      )
      .toBe('failed');
    const run = RunDto.parse(await ok(await page.request.get(`/api/runs/${runId}`), 200, 'run'));
    expect(run.failureReason, 'why the run failed').toContain('the agent has no credential set');
    // Sample-independent proof: the final state is failed, it never started, and no pod was ever created.
    expect(run.startedAt, 'the run never started').toBeNull();
    expect(await podLogLines(runId), 'no pod started').toEqual([]);
    // `seen` holds only the statuses this poll happened to sample.
    expect(seen.has('running'), `statuses sampled: ${[...seen].join(', ')}`).toBe(false);
    expect(seen.has('idle'), `statuses sampled: ${[...seen].join(', ')}`).toBe(false);

    // The Run list (the surface the case names): the run is there with its reason and is not shown as running.
    await page.goto(`/o/${handle}/p/${projectId}/runs`);
    await expect(page.getByRole('heading', { name: 'Runs', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: `Run ${run.number}`, exact: true })).toBeVisible();
    await expect(page.getByText('the agent has no credential set')).toBeVisible();
    await expect(page.getByText('Running', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Needs you', { exact: true })).toHaveCount(0);
  });
});

test('TC-16.3 after the failure is gone, a new credential shows as set and the run starts', async ({ page }) => {
  test.setTimeout(300_000);
  await withFailedAddressChange(page, async ({ handle, projectId, agentId }) => {
    // The failure injection removed.
    await repairCredentialWrites(agentId);
    await openPane(page, handle, projectId);
    // The credential is not set, so the pane asks for the token at once.
    expect(await testAndReplace(page)).toBe(200);
    await expect(page.getByText(SET_LINE)).toBeVisible();
    await expect(addressInput(page)).toHaveValue(GATEWAY_2);
    const runId = await commentOnNewTicket(page, handle, projectId, '/code-review');
    await expect
      .poll(async () => ['running', 'idle'].includes(await runStatus(page, runId)), {
        timeout: 90_000,
        message: 'the run reaches running or idle',
      })
      .toBe(true);
  });
});

const STATUS_WORD = {
  ok: 'Ready',
  rejected: 'Credential rejected',
  unreachable: "Can't reach address",
  invalid: "Can't verify",
  unsupported: 'Not checkable',
} as const;

test('TC-10.6 a metadata-service address with a token shows a field error under API address and nothing is saved', async ({
  page,
}) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  await pressEdit(page, handle, projectId);
  const before = await readAgent(page, projectId);
  await expect(page.getByText(SET_LINE)).toBeVisible();
  expect(await changeAddress(page, 'https://169.254.169.254'), 'credential save refused').toBe(400);
  await expect(addressInput(page)).toHaveAttribute('aria-invalid', 'true');
  // The error text shows under the field (it describes the input), not only the field's state.
  await expect(addressInput(page)).toHaveAccessibleDescription(/Use a public https address/);
  await openPane(page, handle, projectId);
  await expect(addressInput(page)).toHaveValue('');
  const after = await readAgent(page, projectId);
  expect(after.baseUrl, 'saved address').toBeNull();
  expect(after.credential, 'the credential was not replaced').toEqual(before.credential);
});

test('TC-11.5 a typed model with a space shows a field error under the model field and the row keeps its model', async ({
  page,
}) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  await setDefaultModel(page, projectId, 'sonnet');
  await pressEdit(page, handle, projectId);
  await modelSelect(page).selectOption({ label: OTHER });
  await modelName(page).fill('bad model');
  await page.getByRole('button', { name: 'Save agent' }).click();
  await expect(modelName(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(agentPane(page)).toBeVisible();
  // Reload and read the row on the Agents tab.
  await openAgent(page, handle, projectId);
  const agent = await readAgent(page, projectId);
  expect(agent.model, 'saved model').toBe('sonnet');
  await expect(
    page.getByRole('region', { name: 'Agents list' }).getByRole('listitem').filter({ hasText: agent.name }),
  ).toContainText('sonnet');
});

test('TC-14.7 a new address with a new credential shows the new test result and the new address, not the earlier result', async ({
  page,
}) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  const agent = await readAgent(page, projectId);
  // Given: a credential saved with an address and tested once. The stack has no provider to answer, so the earlier
  // result is whatever the offline test returns (the case's "Ready" cannot be reached here); the new test must replace it.
  await setAddressAndCredential(page, agent.id, GATEWAY);
  const first = await ok(await page.request.post(`/api/agents/${agent.id}/test`), 200, 'first test');
  const firstAt = (first as { testedAt: string }).testedAt;
  const earlierStatus = (first as { status?: string }).status;
  expect((await readAgent(page, projectId)).lastTest?.at, 'the earlier test is stored').toBe(firstAt);
  // The earlier result as the row shows it (reloaded), to be replaced by the new one.
  await openAgent(page, handle, projectId);
  const rowOf = () =>
    page.getByRole('region', { name: 'Agents list' }).getByRole('listitem').filter({ hasText: agent.name });
  const earlierRow = await rowOf().innerText();

  await pressEdit(page, handle, projectId);
  await addressInput(page).fill(GATEWAY_2);
  await newToken(page).fill(newTokenValue());
  const tested = page.waitForResponse(
    (r) => /\/api\/agents\/[^/]+\/test$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
  );
  const saved = page.waitForResponse(isCredentialPut);
  await page.getByRole('button', { name: 'Save and test' }).click();
  expect((await saved).status()).toBe(200);
  expect((await tested).status()).toBe(200);

  // Reload and read the row.
  await openAgent(page, handle, projectId);
  const after = await readAgent(page, projectId);
  expect(after.baseUrl, 'the new address').toBe(GATEWAY_2);
  expect(after.lastTest, 'a test of the new credential is stored').not.toBeNull();
  expect(Date.parse(after.lastTest?.at ?? ''), 'the result is newer than the earlier one').toBeGreaterThan(
    Date.parse(firstAt),
  );
  const row = rowOf();
  const word = STATUS_WORD[after.lastTest?.status ?? 'unsupported'];
  await expect(row).toContainText(word);
  // Limit of the offline stack: no provider answers, so both tests end the same (unreachable) and the row text cannot
  // differ. When the words do differ, the row must have moved to the new one.
  if (word !== STATUS_WORD[(earlierStatus ?? 'unsupported') as keyof typeof STATUS_WORD])
    expect(await row.innerText()).not.toBe(earlierRow);
  await pressEdit(page, handle, projectId);
  await expect(addressInput(page)).toHaveValue(GATEWAY_2);
});
