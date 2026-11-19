import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { RuleDto, RunDto } from '@agentdesk/contracts';
import { z } from 'zod';
import {
  API,
  FAKE_STATE_DIR,
  addressInput,
  commentOnNewTicket,
  isAgentPut,
  isCredentialPut,
  modelSelect,
  newToken,
  newTokenValue,
  ok,
  openAgent,
  podLogLines,
  readAgent,
  setAddressAndCredential,
  setDefaultModel,
  signInAndCreateProject,
} from './helpers';

/*
 * Local end-to-end for the model and API address a run starts with (spec BR-31 to BR-37): the rule's model, the default
 * at that moment, a changed default, resume, the pod's first log line and runs queued before models existed. The stack
 * runs with AGENT_MODELS_SOURCE=builtin (.env.example), so the model list is the fallback opus, sonnet, haiku. Every
 * test signs in as a new dev-login user and creates its own project, so the tests do not depend on each other. A token
 * typed here is never printed or asserted on.
 *
 * How the cases that the sources leave open are driven (spec Q7): a run pauses through a `--fake-fail` comment (the
 * fake agent exits 3 after its first turn: paused, "agent crashed") and is resumed with the Resume button on its page.
 * BR-37 needs a run "queued before this change": no API creates a run without a model, so the test clears
 * `runs.model` (and `runs.agent_id`) through the stack's psql, as `devbox run db-psql` does.
 */

test.describe.configure({ timeout: 180_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

const GATEWAY = 'https://gateway.harbor-labs.com';
const GATEWAY_V1 = `${GATEWAY}/v1/anthropic`;
const FOLLOW_UP = 'code-review';

const runUrl = (handle: string, projectId: string, number: number) => `/o/${handle}/p/${projectId}/runs/${number}`;
const launchLine = (model: string, endpoint: string) => `agentdesk: agent claude model ${model} endpoint ${endpoint}`;

async function readRun(page: Page, runId: string): Promise<RunDto> {
  return RunDto.parse(await ok(await page.request.get(`/api/runs/${runId}`), 200, 'run'));
}

async function listRules(page: Page, projectId: string): Promise<RuleDto[]> {
  return z.array(RuleDto).parse(await ok(await page.request.get(`/api/projects/${projectId}/rules`), 200, 'rules'));
}

/** Given: the rule's own model (null follows the default), set through the rules API; the reply is checked. */
async function setRuleModel(page: Page, ruleId: string, model: string | null) {
  const rule = RuleDto.parse(
    await ok(await page.request.patch(`/api/rules/${ruleId}`, { data: { model } }), 200, 'set rule model'),
  );
  expect(rule.model, 'the rule is saved with the given model').toBe(model);
}

/** The setup's follow-up rule (/code-review, pull requests): the rule a `/code-review` comment triggers. */
async function followUpRule(page: Page, projectId: string): Promise<RuleDto> {
  const rule = (await listRules(page, projectId)).find((r) => r.command === FOLLOW_UP);
  if (!rule) throw new Error(`the /${FOLLOW_UP} rule from the setup is missing`);
  return rule;
}

/** Given: a second rule on pull requests that names `model`; returns its command. */
async function addRuleWithModel(page: Page, projectId: string, model: string): Promise<string> {
  const skillName = (await listRules(page, projectId)).find((r) => r.skillName !== null)?.skillName;
  expect(skillName, 'a skill rule from the setup to borrow its skill').toBeTruthy();
  const command = `mdl-${randomBytes(4).toString('hex')}`;
  const rule = RuleDto.parse(
    await ok(
      await page.request.post(`/api/projects/${projectId}/rules`, {
        data: { kind: 'skill', command, labelFilter: [], target: 'pr', enabled: true, skillName, model },
      }),
      201,
      'create rule',
    ),
  );
  expect(rule.model, 'the rule is saved with the given model').toBe(model);
  return command;
}

/** Run detail: the Agent line of the side panel shows the agent's name and the model (the model alone is the span). */
async function expectRunDetailModel(page: Page, handle: string, projectId: string, runId: string, model: string) {
  const run = await readRun(page, runId);
  await page.goto(runUrl(handle, projectId, run.number));
  const agentLine = page.locator('dt', { hasText: /^Agent$/ }).locator('xpath=following-sibling::dd[1]');
  await expect(agentLine.locator('span')).toHaveText(model);
  expect(run.agent.model, 'the model of GET /api/runs/:runId').toBe(model);
}

/** On Desk → Agent & settings: pick `model` in "Default model", click Save agent, wait for the answer. */
async function pickDefaultModelAndSave(page: Page, handle: string, projectId: string, model: string) {
  await openAgent(page, handle, projectId);
  await modelSelect(page).selectOption({ label: model });
  const answered = page.waitForResponse(isAgentPut);
  await page.getByRole('button', { name: 'Save agent' }).click();
  expect((await answered).status(), 'Save agent answered').toBe(200);
  // The change really happened: the saved default is the picked model (so a run that keeps its old model proves something).
  expect((await readAgent(page, projectId)).model, 'the saved default model').toBe(model);
}

/** On Desk → Agent & settings: type `address` ('' clears it), paste a token, click Test and replace. */
async function changeAddress(page: Page, handle: string, projectId: string, address: string) {
  await openAgent(page, handle, projectId);
  await addressInput(page).fill(address);
  await newToken(page).fill(newTokenValue());
  const answered = page.waitForResponse(isCredentialPut);
  await page.getByRole('button', { name: 'Test and replace' }).click();
  expect((await answered).status(), 'Test and replace answered').toBe(200);
}

/**
 * The first line of the pod's log, once the pod has written it. The line is read from the fake pod's log file (the
 * plan's technique), not from the terminal widget on Run detail: whether the terminal relay shows it is not proven here.
 */
async function firstLogLine(runId: string): Promise<string> {
  let line = '';
  await expect
    .poll(
      async () => {
        line = (await podLogLines(runId))[0] ?? '';
        return line;
      },
      { timeout: 60_000, message: `the first log line of the pod of run ${runId}` },
    )
    .toMatch(/^agentdesk: agent /);
  return line;
}

/**
 * A run that starts, crashes after its first turn and parks as paused (a `--fake-fail` comment). Returns the run, and
 * the launch line its first pod wrote. Waits until the paused run's pod is gone, so that the next pod's log is the
 * resumed one.
 */
async function startPausedRun(page: Page, handle: string, projectId: string) {
  const runId = await commentOnNewTicket(page, handle, projectId, `/${FOLLOW_UP} --fake-fail`);
  const firstPodLine = await firstLogLine(runId);
  await expect.poll(async () => (await readRun(page, runId)).status, { timeout: 60_000 }).toBe('paused');
  await expect.poll(() => existsSync(`${FAKE_STATE_DIR}/kube/run-${runId}`), { timeout: 30_000 }).toBe(false);
  return { runId, firstPodLine, number: (await readRun(page, runId)).number };
}

/** Resume from the run's page and return the first log line of the new pod. */
async function resumeAndReadLaunchLine(page: Page, handle: string, projectId: string, runId: string, number: number) {
  await page.goto(runUrl(handle, projectId, number));
  await expect(page.getByRole('banner').getByText('Paused', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Resume' }).click();
  return firstLogLine(runId);
}

/** Best effort: end a run the test left alive. */
async function cancelRun(page: Page, runId: string) {
  await ok(await page.request.post(`/api/runs/${runId}/cancel`), 202, 'cancel').catch(() => null);
}

/** Waits until the run's pod is up (running or idle), so a database change cannot race the launch. */
async function waitForStarted(page: Page, runId: string) {
  await firstLogLine(runId); // the pod has launched, so a later change to the run row cannot race the launch
  await expect
    .poll(async () => ['running', 'idle'].includes((await readRun(page, runId)).status), {
      timeout: 90_000,
      message: 'the run reaches running or idle',
    })
    .toBe(true);
}

const COMPOSE_FILE =
  process.env['AGENTDESK_COMPOSE_FILE'] ?? fileURLToPath(new URL('../../../../docker-compose.yml', import.meta.url));

/**
 * Runs `sql` in the stack's Postgres (as `devbox run db-psql` does; needs docker-compose on the PATH, as devbox
 * provides). The run id is checked as a UUID first and reaches the SQL only as the psql variable :'id', set on stdin.
 */
async function psqlForRun(runId: string, sql: string): Promise<string> {
  const id = z.uuid().parse(runId);
  const child = spawn(
    'docker-compose',
    [
      '-f',
      COMPOSE_FILE,
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'agentdesk',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const exited = new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  child.stdin.end(`\\set id ${id}\n${sql}\n`);
  const code = await exited;
  expect(code, `psql exit code: ${stderr}`).toBe(0);
  return stdout;
}

/** Given: a run "queued before this change": no model recorded (and, for `withoutAgent`, no agent either). */
async function clearRunModel(runId: string, withoutAgent: boolean) {
  const out = await psqlForRun(
    runId,
    withoutAgent
      ? `UPDATE runs SET model = NULL, agent_id = NULL WHERE id = :'id';`
      : `UPDATE runs SET model = NULL WHERE id = :'id';`,
  );
  expect(out, 'the run row was updated').toContain('UPDATE 1');
}

// ---- BR-31: a rule's own model is used for the run ----

const RULE_MODEL_CASES = [
  { id: 'TC-31.1', model: 'haiku' },
  { id: 'TC-31.2', model: 'sonnet[1m]' },
];
for (const { id, model } of RULE_MODEL_CASES) {
  test(`${id} a run from a rule naming ${model} shows ${model} on Run detail`, async ({ page }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    await setDefaultModel(page, projectId, 'sonnet');
    await setRuleModel(page, (await followUpRule(page, projectId)).id, model);
    const runId = await commentOnNewTicket(page, handle, projectId, `/${FOLLOW_UP}`);
    try {
      await expectRunDetailModel(page, handle, projectId, runId, model);
    } finally {
      await cancelRun(page, runId);
    }
  });
}

// ---- BR-32: a default-following rule uses the default at that moment ----

const DEFAULT_MODEL_CASES = [
  { id: 'TC-32.1', model: 'opus' },
  { id: 'TC-32.2', model: 'vendor/model-1' },
];
for (const { id, model } of DEFAULT_MODEL_CASES) {
  test(`${id} a run from a default-following rule shows the default ${model} on Run detail`, async ({ page }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    await setDefaultModel(page, projectId, model);
    await setRuleModel(page, (await followUpRule(page, projectId)).id, null);
    const runId = await commentOnNewTicket(page, handle, projectId, `/${FOLLOW_UP}`);
    try {
      await expectRunDetailModel(page, handle, projectId, runId, model);
    } finally {
      await cancelRun(page, runId);
    }
  });
}

// ---- BR-33: changing the default model ----

/** Given of TC-33.x: rule A follows the default, rule B names haiku, default sonnet, a run from rule A exists. */
async function withChangedDefault(
  page: Page,
  body: (s: { handle: string; projectId: string; before: string; ruleB: string }) => Promise<void>,
) {
  const { handle, projectId } = await signInAndCreateProject(page);
  await setDefaultModel(page, projectId, 'sonnet');
  await setRuleModel(page, (await followUpRule(page, projectId)).id, null);
  const ruleB = await addRuleWithModel(page, projectId, 'haiku');
  const before = await commentOnNewTicket(page, handle, projectId, `/${FOLLOW_UP}`);
  const created = [before];
  try {
    await expectRunDetailModel(page, handle, projectId, before, 'sonnet');
    await pickDefaultModelAndSave(page, handle, projectId, 'opus');
    await body({ handle, projectId, before, ruleB });
  } finally {
    for (const runId of created) await cancelRun(page, runId);
  }
}

test('TC-33.1 after the default changes to opus, rule A starts a run on opus and rule B on haiku', async ({ page }) => {
  test.setTimeout(300_000);
  await withChangedDefault(page, async ({ handle, projectId, ruleB }) => {
    const runA = await commentOnNewTicket(page, handle, projectId, `/${FOLLOW_UP}`);
    // Run B may still be queued (the first run holds a slot): the assertion is on the model frozen at intake, which a
    // queued run already has (proved at the API layer in Task 4).
    const runB = await commentOnNewTicket(page, handle, projectId, `/${ruleB}`);
    try {
      await expectRunDetailModel(page, handle, projectId, runA, 'opus');
      await expectRunDetailModel(page, handle, projectId, runB, 'haiku');
    } finally {
      await cancelRun(page, runA);
      await cancelRun(page, runB);
    }
  });
});

test('TC-33.2 after the default changes to opus, the run that existed before still shows sonnet', async ({ page }) => {
  test.setTimeout(300_000);
  await withChangedDefault(page, async ({ handle, projectId, before }) => {
    await expectRunDetailModel(page, handle, projectId, before, 'sonnet');
  });
});

// ---- BR-34: a resumed run keeps its model ----

test('TC-34.1 a paused run resumed after the default changed to opus keeps sonnet on its resumed pod', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const { handle, projectId } = await signInAndCreateProject(page);
  await setDefaultModel(page, projectId, 'sonnet');
  await setRuleModel(page, (await followUpRule(page, projectId)).id, null);
  const { runId, firstPodLine, number } = await startPausedRun(page, handle, projectId);
  try {
    expect(firstPodLine, 'the run started under sonnet').toMatch(/^agentdesk: agent claude model sonnet endpoint /);
    await pickDefaultModelAndSave(page, handle, projectId, 'opus');
    const resumed = await resumeAndReadLaunchLine(page, handle, projectId, runId, number);
    expect(resumed).toMatch(/^agentdesk: agent claude model sonnet endpoint \S+$/);
    await expectRunDetailModel(page, handle, projectId, runId, 'sonnet');
  } finally {
    await cancelRun(page, runId);
  }
});

// ---- BR-35: the first terminal line names agent, model and endpoint ----

test('TC-35.1 a run on haiku with a custom address prints the origin only on its first line', async ({ page }) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  await setDefaultModel(page, projectId, 'haiku');
  await setAddressAndCredential(page, (await readAgent(page, projectId)).id, GATEWAY_V1);
  await setRuleModel(page, (await followUpRule(page, projectId)).id, null);
  const runId = await commentOnNewTicket(page, handle, projectId, `/${FOLLOW_UP}`);
  try {
    expect(await firstLogLine(runId)).toBe(launchLine('haiku', GATEWAY));
  } finally {
    await cancelRun(page, runId);
  }
});

test('TC-35.2 a run on sonnet with no address prints endpoint default on its first line', async ({ page }) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  await setDefaultModel(page, projectId, 'sonnet');
  expect((await readAgent(page, projectId)).baseUrl, 'no address saved').toBeNull();
  await setRuleModel(page, (await followUpRule(page, projectId)).id, null);
  const runId = await commentOnNewTicket(page, handle, projectId, `/${FOLLOW_UP}`);
  try {
    expect(await firstLogLine(runId)).toBe(launchLine('sonnet', 'default'));
  } finally {
    await cancelRun(page, runId);
  }
});

test('TC-35.3 a run from a rule naming vendor/model-1 prints that model on its first line', async ({ page }) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  await setDefaultModel(page, projectId, 'sonnet');
  expect((await readAgent(page, projectId)).baseUrl, 'no address saved').toBeNull();
  await setRuleModel(page, (await followUpRule(page, projectId)).id, 'vendor/model-1');
  const runId = await commentOnNewTicket(page, handle, projectId, `/${FOLLOW_UP}`);
  try {
    expect(await firstLogLine(runId)).toBe(launchLine('vendor/model-1', 'default'));
  } finally {
    await cancelRun(page, runId);
  }
});

// ---- BR-36: resume uses the current address ----

test('TC-36.1 a run started with no address resumes with the address set while it was paused', async ({ page }) => {
  test.setTimeout(300_000);
  const { handle, projectId } = await signInAndCreateProject(page);
  await setDefaultModel(page, projectId, 'sonnet');
  await setRuleModel(page, (await followUpRule(page, projectId)).id, null);
  const { runId, firstPodLine, number } = await startPausedRun(page, handle, projectId);
  try {
    expect(firstPodLine, 'the run started with no address').toBe(launchLine('sonnet', 'default'));
    const model = (await readRun(page, runId)).agent.model;
    await changeAddress(page, handle, projectId, GATEWAY);
    expect(await resumeAndReadLaunchLine(page, handle, projectId, runId, number)).toBe(launchLine(model, GATEWAY));
    await expectRunDetailModel(page, handle, projectId, runId, model);
  } finally {
    await cancelRun(page, runId);
  }
});

test('TC-36.2 a run started under an address resumes with endpoint default after the address was cleared', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const { handle, projectId } = await signInAndCreateProject(page);
  await setDefaultModel(page, projectId, 'sonnet');
  await setAddressAndCredential(page, (await readAgent(page, projectId)).id, GATEWAY);
  await setRuleModel(page, (await followUpRule(page, projectId)).id, null);
  const { runId, firstPodLine, number } = await startPausedRun(page, handle, projectId);
  try {
    expect(firstPodLine, 'the run started under the address').toBe(launchLine('sonnet', GATEWAY));
    const model = (await readRun(page, runId)).agent.model;
    await changeAddress(page, handle, projectId, '');
    expect(await resumeAndReadLaunchLine(page, handle, projectId, runId, number)).toBe(launchLine(model, 'default'));
    await expectRunDetailModel(page, handle, projectId, runId, model);
  } finally {
    await cancelRun(page, runId);
  }
});

// ---- BR-37: runs queued before this change ----

test('TC-37.1 a run with no model recorded shows the agent default sonnet', async ({ page }) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  await setDefaultModel(page, projectId, 'sonnet');
  await setRuleModel(page, (await followUpRule(page, projectId)).id, 'haiku');
  const runId = await commentOnNewTicket(page, handle, projectId, `/${FOLLOW_UP}`);
  try {
    await waitForStarted(page, runId);
    // The run was queued with haiku (not the default), so sonnet can only come from the cleared column.
    await expectRunDetailModel(page, handle, projectId, runId, 'haiku');
    await clearRunModel(runId, false);
    await expectRunDetailModel(page, handle, projectId, runId, 'sonnet');
  } finally {
    await cancelRun(page, runId);
  }
});

test('TC-37.2 a run with no model recorded shows the current default opus after the default changed', async ({
  page,
}) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  await setDefaultModel(page, projectId, 'sonnet');
  await setRuleModel(page, (await followUpRule(page, projectId)).id, 'haiku');
  const runId = await commentOnNewTicket(page, handle, projectId, `/${FOLLOW_UP}`);
  try {
    await waitForStarted(page, runId);
    await clearRunModel(runId, false);
    await expectRunDetailModel(page, handle, projectId, runId, 'sonnet');
    await pickDefaultModelAndSave(page, handle, projectId, 'opus');
    await expectRunDetailModel(page, handle, projectId, runId, 'opus');
  } finally {
    await cancelRun(page, runId);
  }
});

// Plan-prescribed stand-in: agents.model is NOT NULL, so "the agent has no default model" cannot be built. A run with
// no agent (runs.agent_id cleared) reaches the same 'unknown' fallback; Run detail also shows (deleted agent).
test('TC-37.3 a run with no model recorded and no agent shows unknown', async ({ page }) => {
  const { handle, projectId } = await signInAndCreateProject(page);
  await setDefaultModel(page, projectId, 'sonnet');
  await setRuleModel(page, (await followUpRule(page, projectId)).id, null);
  const runId = await commentOnNewTicket(page, handle, projectId, `/${FOLLOW_UP}`);
  try {
    await waitForStarted(page, runId);
    await expectRunDetailModel(page, handle, projectId, runId, 'sonnet');
    await clearRunModel(runId, true);
    await expectRunDetailModel(page, handle, projectId, runId, 'unknown');
  } finally {
    await cancelRun(page, runId);
  }
});
