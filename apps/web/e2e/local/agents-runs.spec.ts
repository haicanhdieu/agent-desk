import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { expect, test, type Page } from '@playwright/test';
import { RuleDto, RunListResponse, pageOf } from '@agentdesk/contracts';
import {
  API,
  FAKE_STATE_DIR,
  agentPane,
  cancelRun,
  commentOnNewTicket,
  createAgent,
  deleteAgent,
  isCredentialPut,
  newToken,
  newTokenValue,
  ok,
  openAgent,
  addressInput,
  openAgentPane,
  podLogLines,
  postedComments,
  readAgent,
  ruleWithAgent,
  runOf,
  saveCredential,
  setDefaultAgent,
  signInAndCreateProject,
  transcriptOf,
  lifecycleTexts,
  waitForStatus,
} from './helpers';

/*
 * Local end-to-end for the runs of a project with several agent configurations (spec
 * 2026-11-24-multi-agent-configs-design.md, BR-7, 26, 31, 34 to 41, 45, 52, 54, 68). Every test signs in as a new owner
 * of its own e2e-<rand> org and creates its own project and agents. The pod's first log line is read from the fake
 * pod's log file (`agentdesk: agent <kind> model <m> endpoint <origin>`, BR-52). The offline stack cannot make a
 * connection test come out "Ready", so no case needs it. Cases that need paused runs run only on a stack started
 * with a short idle end (docs/runbooks/tests-and-e2e.md section 4) and E2E_IDLE_END_SECONDS set to it. A token or
 * credentials file typed here is never printed.
 */

test.describe.configure({ timeout: 300_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

const IDLE_END_SECONDS = Number.parseInt(process.env['E2E_IDLE_END_SECONDS'] ?? '', 10);
const idleStack = Number.isFinite(IDLE_END_SECONDS);

const rand = () => randomBytes(3).toString('hex');
const runUrl = (handle: string, projectId: string, number: number) => `/o/${handle}/p/${projectId}/runs/${number}`;

/** The first line of the pod's log, once the pod has written it. */
async function firstLine(runId: string): Promise<string> {
  let line = '';
  await expect
    .poll(
      async () => {
        line = (await podLogLines(runId))[0] ?? '';
        return line;
      },
      { timeout: 90_000, message: `the first log line of the pod of run ${runId}` },
    )
    .toMatch(/^agentdesk: agent /);
  return line;
}

/** Given: a rule that names the agent (or the project default when `agentId` is absent). Returns its command. */
async function ruleFor(
  page: Page,
  handle: string,
  projectId: string,
  agentId?: string,
  model?: string,
): Promise<string> {
  const command = `cmd-${rand()}`;
  await ruleWithAgent(page.request, handle, projectId, {
    command,
    target: 'any',
    ...(agentId !== undefined && { agentId }),
    ...(model !== undefined && { model }),
  });
  return command;
}

/** Run detail: the side panel's Agent line shows the agent's name and the model. */
async function expectRunDetailAgent(
  page: Page,
  handle: string,
  projectId: string,
  runId: string,
  name: string,
  model?: string,
): Promise<void> {
  const run = await runOf(page, runId);
  await page.goto(runUrl(handle, projectId, run.number));
  const line = page.locator('dt', { hasText: /^Agent$/ }).locator('xpath=following-sibling::dd[1]');
  await expect(line).toContainText(name);
  if (model !== undefined) await expect(line.locator('span')).toHaveText(model);
}

/** The run as `GET /api/projects/:id/runs` lists it. */
async function listedRun(page: Page, projectId: string, runId: string) {
  const list = RunListResponse.parse(
    await ok(await page.request.get(`/api/projects/${projectId}/runs?pageSize=100`), 200, 'runs'),
  );
  const found = list.items.find((r) => r.id === runId);
  expect(found, `run ${runId} is listed`).toBeTruthy();
  return found;
}

/** The agent's secret files in the fake store (names end with `-agent-<id>.json`). */
async function secretFiles(agentId: string): Promise<string[]> {
  const names = await readdir(`${FAKE_STATE_DIR}/secrets`).catch(() => [] as string[]);
  return names.filter((n) => n.endsWith(`-agent-${agentId}.json`));
}

/** The text of every secret file of the agent. */
async function secretText(agentId: string): Promise<string> {
  const parts = await Promise.all(
    (await secretFiles(agentId)).map((n) => readFile(`${FAKE_STATE_DIR}/secrets/${n}`, 'utf8')),
  );
  return parts.join('\n');
}

/** A run that pauses by the idle timeout; the next pod's log starts fresh once the old pod is gone. */
async function waitPaused(page: Page, runId: string): Promise<void> {
  await waitForStatus(page, runId, 'paused', (IDLE_END_SECONDS + 60) * 1000);
  await expect.poll(() => existsSync(`${FAKE_STATE_DIR}/kube/run-${runId}`), { timeout: 30_000 }).toBe(false);
}

test.describe('BR-7: two agents of one provider', () => {
  test('TC-7.1: two Claude Code agents each keep their own settings and each run starts with its own model and endpoint', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const personal = await createAgent(page.request, handle, projectId, {
      provider: 'claude',
      name: 'Claude - Personal',
      accountLabel: 'Personal',
      model: 'haiku',
    });
    await saveCredential(page.request, personal.id, 'claude');
    const work = await createAgent(page.request, handle, projectId, {
      provider: 'claude',
      name: 'Claude - Work',
      accountLabel: 'Work',
      model: 'opus',
    });
    await ok(
      await page.request.put(`/api/agents/${work.id}/credential`, {
        data: { type: 'oauth_token', value: newTokenValue(), baseUrl: 'https://llm.example.com' },
      }),
      200,
      'work credential',
    );
    const r1 = await ruleFor(page, handle, projectId, personal.id);
    const r2 = await ruleFor(page, handle, projectId, work.id);

    await openAgent(page, handle, projectId);
    const list = page.getByRole('region', { name: 'Agents list' });
    for (const [name, label, model] of [
      ['Claude - Personal', 'Personal', 'haiku'],
      ['Claude - Work', 'Work', 'opus'],
    ] as const) {
      const row = list.getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) });
      await expect(row).toContainText(label);
      await expect(row).toContainText(model);
      await expect(row).toContainText('Not tested');
    }

    // BR-7: each keeps its own address (Personal has none, Work has its own).
    await openAgentPane(page, handle, projectId, personal.id);
    await expect(addressInput(page)).toHaveValue('');
    await openAgentPane(page, handle, projectId, work.id);
    await expect(addressInput(page)).toHaveValue('https://llm.example.com');

    const run1 = await commentOnNewTicket(page, handle, projectId, `/${r1}`);
    const run2 = await commentOnNewTicket(page, handle, projectId, `/${r2}`);
    try {
      expect(await firstLine(run1)).toBe('agentdesk: agent claude model haiku endpoint default');
      expect(await firstLine(run2)).toBe('agentdesk: agent claude model opus endpoint https://llm.example.com');
      expect((await runOf(page, run1)).agent.id).toBe(personal.id);
      expect((await runOf(page, run2)).agent.id).toBe(work.id);
    } finally {
      await cancelRun(page, run1).catch(() => undefined);
      await cancelRun(page, run2).catch(() => undefined);
    }
  });
});

test.describe('BR-26, BR-34, BR-36: a default change affects new runs only', () => {
  test('TC-34.1, TC-36.1, TC-26.1: a rule on Project default follows the default for new runs; the running run keeps A', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const a = await readAgent(page, projectId);
    const b = await createAgent(page.request, handle, projectId, { provider: 'claude', name: `B-${rand()}` });
    await saveCredential(page.request, b.id, 'claude');
    const command = await ruleFor(page, handle, projectId);

    // TC-34.1 steps 1: the row and the reopened rule.
    await page.goto(`/o/${handle}/p/${projectId}/desk/rules`);
    const row = page.getByRole('button', { name: `Edit rule /${command}` });
    await expect(row).toContainText('with the project default agent');
    await row.click();
    await expect(page.getByLabel('With agent').locator('option:checked')).toHaveText(/^Project default/);

    const run1 = await commentOnNewTicket(page, handle, projectId, `/${command}`);
    let run2 = '';
    try {
      await expectRunDetailAgent(page, handle, projectId, run1, a.name);

      // Step 2: B becomes the default (the Set as default button of the list).
      await openAgent(page, handle, projectId);
      await page.getByRole('button', { name: `Actions for ${b.name}`, exact: true }).click();
      await page.getByRole('button', { name: 'Set as default', exact: true }).click();
      await expect(page.getByText('Default agent changed. New runs only.', { exact: true })).toBeVisible();

      // TC-34.1: the rule still shows Project default.
      await page.goto(`/o/${handle}/p/${projectId}/desk/rules`);
      await expect(page.getByRole('button', { name: `Edit rule /${command}` })).toContainText(
        'with the project default agent',
      );

      run2 = await commentOnNewTicket(page, handle, projectId, `/${command}`);
      // TC-36.1 / TC-34.1: the new run shows B. TC-26.1: the run that was running shows A.
      await expectRunDetailAgent(page, handle, projectId, run2, b.name);
      await expectRunDetailAgent(page, handle, projectId, run1, a.name);
      expect((await runOf(page, run1)).agent.id).toBe(a.id);
      expect((await runOf(page, run2)).agent.id).toBe(b.id);
    } finally {
      await cancelRun(page, run1).catch(() => undefined);
      if (run2 !== '') await cancelRun(page, run2).catch(() => undefined);
    }
  });
});

test.describe('BR-37: a queued run keeps its agent', () => {
  test('TC-37.1: after the rule is edited to name B, the run queued on A still shows A', async ({ page }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const a = await createAgent(page.request, handle, projectId, { provider: 'claude', name: `A-${rand()}` });
    await saveCredential(page.request, a.id, 'claude');
    const b = await createAgent(page.request, handle, projectId, { provider: 'claude', name: `B-${rand()}` });
    await saveCredential(page.request, b.id, 'claude');
    const command = `cmd-${rand()}`;
    const rule = await ruleWithAgent(page.request, handle, projectId, { command, agentId: a.id, target: 'any' });
    const runId = await commentOnNewTicket(page, handle, projectId, `/${command}`);
    try {
      expect((await runOf(page, runId)).agent.id).toBe(a.id);
      // Step 1: edit the rule in its form to name B.
      await page.goto(`/o/${handle}/p/${projectId}/desk/rules`);
      await page.getByRole('button', { name: `Edit rule /${command}` }).click();
      await page.getByLabel('With agent').selectOption({ label: b.name });
      await page.getByRole('button', { name: 'Save rule' }).click();
      await expect(page.getByRole('button', { name: `Edit rule /${command}` })).toContainText(`with ${b.name}`);
      const saved = pageOf(RuleDto).parse(
        await ok(await page.request.get(`/api/projects/${projectId}/rules?pageSize=100`), 200, 'rules'),
      );
      expect(saved.items.find((r) => r.id === rule.id)?.agentId, 'the rule now names B').toBe(b.id);
      // Step 2: the run still shows A.
      await expectRunDetailAgent(page, handle, projectId, runId, a.name);
      expect((await runOf(page, runId)).agent.id).toBe(a.id);
    } finally {
      await cancelRun(page, runId).catch(() => undefined);
    }
  });
});

test.describe('BR-35, BR-40: a rule naming an agent', () => {
  test('TC-35.1: a run from a rule naming Claude agent B shows B and its model; the pod names agent claude', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const b = await createAgent(page.request, handle, projectId, {
      provider: 'claude',
      name: `B-${rand()}`,
      model: 'haiku',
    });
    await saveCredential(page.request, b.id, 'claude');
    const command = await ruleFor(page, handle, projectId, b.id);
    const runId = await commentOnNewTicket(page, handle, projectId, `/${command}`);
    try {
      await expectRunDetailAgent(page, handle, projectId, runId, b.name, 'haiku');
      expect(await firstLine(runId)).toMatch(/^agentdesk: agent claude model haiku endpoint /);
    } finally {
      await cancelRun(page, runId).catch(() => undefined);
    }
  });

  test("TC-40.3: a rule naming B with its own model M2 starts a run on B and M2, not B's default model", async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const b = await createAgent(page.request, handle, projectId, {
      provider: 'claude',
      name: `B-${rand()}`,
      model: 'haiku',
    });
    await saveCredential(page.request, b.id, 'claude');
    const command = await ruleFor(page, handle, projectId, b.id, 'opus');
    const runId = await commentOnNewTicket(page, handle, projectId, `/${command}`);
    try {
      await expectRunDetailAgent(page, handle, projectId, runId, b.name, 'opus');
      expect((await runOf(page, runId)).agent.model).toBe('opus');
    } finally {
      await cancelRun(page, runId).catch(() => undefined);
    }
  });

  test('TC-35.2, TC-52.1: a Codex agent run shows the agent, prints the codex launch line, opens a terminal and finishes', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const codex = await createAgent(page.request, handle, projectId, { provider: 'codex', name: `Codex-${rand()}` });
    await saveCredential(page.request, codex.id, 'codex');
    const command = await ruleFor(page, handle, projectId, codex.id);
    const runId = await commentOnNewTicket(page, handle, projectId, `/${command} --fake-done`);
    try {
      await expectRunDetailAgent(page, handle, projectId, runId, codex.name, codex.model);
      expect(await firstLine(runId)).toBe(`agentdesk: agent codex model ${codex.model} endpoint default`);
      const header = page.getByRole('banner');
      await expect(page.getByRole('region', { name: 'Terminal' })).toBeVisible({ timeout: 60_000 });
      await expect(header.getByText('Done', { exact: true })).toBeVisible({ timeout: 60_000 });
      await page.getByRole('region', { name: 'Terminal' }).getByRole('button', { name: 'Finish run' }).click();
      await expect(header.getByText('Succeeded', { exact: true })).toBeVisible({ timeout: 30_000 });
      expect((await runOf(page, runId)).status).toBe('succeeded');
    } finally {
      await cancelRun(page, runId).catch(() => undefined);
    }
  });

  test('TC-35.3, TC-41.5, TC-52.2, TC-68.4: an OpenCode agent with no credential and no model starts, prints model default endpoint default, stores no secret and finishes', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const oc = await createAgent(page.request, handle, projectId, { provider: 'opencode', name: `OpenCode-${rand()}` });
    expect(oc.credential.set, 'the agent has no credential').toBe(false);
    expect(oc.model, 'the agent has no model').toBe('');
    const command = await ruleFor(page, handle, projectId, oc.id);
    const runId = await commentOnNewTicket(page, handle, projectId, `/${command} --fake-done`);
    try {
      expect(await firstLine(runId)).toBe('agentdesk: agent opencode model default endpoint default');
      await expectRunDetailAgent(page, handle, projectId, runId, oc.name);
      const header = page.getByRole('banner');
      await expect(header.getByText('Done', { exact: true })).toBeVisible({ timeout: 60_000 });
      await page.getByRole('region', { name: 'Terminal' }).getByRole('button', { name: 'Finish run' }).click();
      await expect(header.getByText('Succeeded', { exact: true })).toBeVisible({ timeout: 30_000 });
      const run = await runOf(page, runId);
      expect(run.status).toBe('succeeded');
      expect(run.failureReason, 'no credential failure').toBeNull();
      expect(run.failureCode).toBeNull();
      expect(await secretFiles(oc.id), 'no Secret file is stored for the agent').toEqual([]);
    } finally {
      await cancelRun(page, runId).catch(() => undefined);
    }
  });
});

test.describe('BR-41: a Claude Code agent with no credential', () => {
  test('TC-41.4: a run on a Claude Code agent with no credential fails at start with the reason, on the run and the ticket', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const other = await readAgent(page, projectId);
    const bare = await createAgent(page.request, handle, projectId, { provider: 'claude', name: `Bare-${rand()}` });
    expect(bare.credential.set).toBe(false);
    const command = await ruleFor(page, handle, projectId, bare.id);
    const runId = await commentOnNewTicket(page, handle, projectId, `/${command}`);
    await waitForStatus(page, runId, 'failed', 90_000);
    const run = await runOf(page, runId);
    expect(run.failureReason).toContain('the agent has no credential set');
    expect(run.startedAt, 'the run never started').toBeNull();
    expect(await podLogLines(runId), 'no pod started for the run').toEqual([]);
    expect(run.agent.id, 'no other agent ran').toBe(bare.id);
    expect(other.id).not.toBe(bare.id);

    // The run.
    await page.goto(runUrl(handle, projectId, run.number));
    await expect(page.getByText('the agent has no credential set').first()).toBeVisible();
    // The ticket: the comment the app posted there.
    const posted = (await postedComments(page)).filter((c) => c.ticketNumber === run.ticket.number);
    expect(posted.map((c) => c.body).join('\n'), `comments on ticket ${run.ticket.number}`).toContain(
      'the agent has no credential set',
    );
  });
});

test.describe('BR-52: the launch line never shows a credential', () => {
  test('TC-52.3: an OpenCode agent with a credentials file prints endpoint default and the file text appears nowhere', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const oc = await createAgent(page.request, handle, projectId, { provider: 'opencode', name: `OpenCode-${rand()}` });
    const marker = `e2e-file-${randomBytes(8).toString('hex')}`;
    const file = JSON.stringify({ tokens: { access_token: marker } });
    await ok(
      await page.request.put(`/api/agents/${oc.id}/credential`, { data: { type: 'auth_json', value: file } }),
      200,
      'credentials file',
    );
    const command = await ruleFor(page, handle, projectId, oc.id);
    const runId = await commentOnNewTicket(page, handle, projectId, `/${command}`);
    try {
      const line = await firstLine(runId);
      expect(line).toMatch(/^agentdesk: agent opencode model \S+ endpoint default$/);
      await waitForStatus(page, runId, 'idle', 90_000);
      await expectNowhere(page, handle, projectId, runId, [marker], line);
    } finally {
      await cancelRun(page, runId).catch(() => undefined);
    }
  });

  test('TC-52.4: an OpenCode agent with its own endpoint, key and model prints the origin and model; the key shows nowhere', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const oc = await createAgent(page.request, handle, projectId, {
      provider: 'opencode',
      name: `OpenCode-${rand()}`,
      model: 'gpt-4.1',
    });
    const key = `e2e-key-${randomBytes(8).toString('hex')}`;
    await ok(
      await page.request.put(`/api/agents/${oc.id}/credential`, {
        data: { type: 'api_key', value: key, baseUrl: 'https://llm.example.com' },
      }),
      200,
      'endpoint and key',
    );
    // The agent is saved whatever the offline connection test answers.
    expect(oc.model).toBe('gpt-4.1');
    const command = await ruleFor(page, handle, projectId, oc.id);
    const runId = await commentOnNewTicket(page, handle, projectId, `/${command}`);
    try {
      const line = await firstLine(runId);
      expect(line).toBe('agentdesk: agent opencode model gpt-4.1 endpoint https://llm.example.com');
      await waitForStatus(page, runId, 'idle', 90_000);
      await expectNowhere(page, handle, projectId, runId, [key], line);
    } finally {
      await cancelRun(page, runId).catch(() => undefined);
    }
  });
});

/**
 * The secrets appear in no pod log line, run detail, transcript entry, run event, log or ticket comment the API
 * returns, and not on the run page.
 */
async function expectNowhere(
  page: Page,
  handle: string,
  projectId: string,
  runId: string,
  secrets: string[],
  line: string,
): Promise<void> {
  const run = await runOf(page, runId);
  const transcript = await transcriptOf(page, runId);
  const log = await (await page.request.get(`/api/runs/${runId}/log`)).text();
  const lifecycle = await lifecycleTexts(page, runId);
  const comments = (await postedComments(page)).filter((c) => c.ticketNumber === run.ticket.number);
  const podLog = (await podLogLines(runId)).join('\n');
  const everything = [
    line,
    podLog,
    JSON.stringify(run),
    JSON.stringify(transcript),
    log,
    lifecycle.join('\n'),
    JSON.stringify(comments),
  ].join('\n');
  for (const s of secrets) expect(everything, 'a secret shows in a run surface').not.toContain(s);
  await page.goto(runUrl(handle, projectId, run.number));
  await expect(
    page
      .getByRole('banner')
      .getByText(/Running|Idle|Needs you|Paused/)
      .first(),
  ).toBeVisible();
  const text = await page.locator('body').innerText();
  for (const s of secrets) expect(text, 'a secret shows on the run page').not.toContain(s);
}

test.describe('BR-31, BR-54: a run keeps the agent name', () => {
  /** Given: a finished (cancelled) run on a Claude agent named `name` with model haiku; the rule is then removed. */
  async function finishedRun(page: Page, name: string) {
    const { handle, projectId } = await signInAndCreateProject(page);
    const agent = await createAgent(page.request, handle, projectId, { provider: 'claude', name, model: 'haiku' });
    await saveCredential(page.request, agent.id, 'claude');
    const command = `cmd-${rand()}`;
    const rule = await ruleWithAgent(page.request, handle, projectId, { command, agentId: agent.id, target: 'any' });
    const runId = await commentOnNewTicket(page, handle, projectId, `/${command}`);
    expect((await runOf(page, runId)).agent.id).toBe(agent.id);
    await cancelRun(page, runId);
    return { handle, projectId, agent, runId, ruleId: rule.id };
  }

  test('TC-31.1, TC-54.2: after the agent is deleted the Runs list and the run detail show the name saved at queue time and the model', async ({
    page,
  }) => {
    const { handle, projectId, agent, runId, ruleId } = await finishedRun(page, 'Claude - Work');
    await ok(await page.request.delete(`/api/rules/${ruleId}`), 204, 'delete rule');
    expect(await deleteAgent(page.request, handle, agent.id)).toBe(204);

    const listed = await listedRun(page, projectId, runId);
    expect(listed?.agent.name).toBe('Claude - Work');
    expect(listed?.agent.model).toBe('haiku');
    await page.goto(`/o/${handle}/p/${projectId}/runs`);
    await expect(page.getByRole('heading', { name: 'Runs', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: `Run ${listed?.number}`, exact: true })).toBeVisible();
    await expect(page.getByText('Claude - Work · haiku', { exact: true })).toBeVisible();
    await expectRunDetailAgent(page, handle, projectId, runId, 'Claude - Work', 'haiku');
  });

  test('TC-54.1: after the agent is renamed the Runs list and the run detail show the new name', async ({ page }) => {
    const { handle, projectId, agent, runId } = await finishedRun(page, 'Claude - Work');
    await ok(await page.request.patch(`/api/agents/${agent.id}`, { data: { name: 'Claude - Home' } }), 200, 'rename');

    const listed = await listedRun(page, projectId, runId);
    expect(listed?.agent.name).toBe('Claude - Home');
    await page.goto(`/o/${handle}/p/${projectId}/runs`);
    await expect(page.getByRole('link', { name: `Run ${listed?.number}`, exact: true })).toBeVisible();
    await expect(page.getByText('Claude - Home · haiku', { exact: true })).toBeVisible();
    await expect(page.getByText('Claude - Work')).toHaveCount(0);
    await expectRunDetailAgent(page, handle, projectId, runId, 'Claude - Home');
    await expect(page.locator('dd', { hasText: 'Claude - Work' })).toHaveCount(0);
  });
});

test.describe('BR-45: limits are project-wide', () => {
  test('TC-45.2: a saved limit shows after reload on Limits and neither agent pane shows a limit', async ({ page }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const a = await readAgent(page, projectId);
    const b = await createAgent(page.request, handle, projectId, { provider: 'claude', name: `B-${rand()}` });
    await openAgent(page, handle, projectId, 'limits');
    const field = page.getByLabel('End idle runs after', { exact: true });
    const before = await field.inputValue();
    const changed = before === '45' ? '50' : '45';
    await field.fill(changed);
    await page.getByRole('button', { name: 'Save limits' }).click();
    await expect(page.getByText('Limits saved')).toBeVisible();

    await page.reload();
    await openAgent(page, handle, projectId, 'limits');
    await expect(page.getByLabel('End idle runs after', { exact: true })).toHaveValue(changed);
    for (const agent of [a, b]) {
      await openAgentPane(page, handle, projectId, agent.id);
      const pane = agentPane(page);
      for (const label of [
        'Run time limit',
        'Keep a paused run for',
        "Keep a finished run's session for",
        'End idle runs after',
        'Concurrent runs',
        'Runs per ticket',
        'Automatic resumes after a crash',
      ]) {
        await expect(pane.getByLabel(label), `${agent.name}: ${label}`).toHaveCount(0);
      }
    }
  });
});

test.describe('paused runs (short-idle stack, E2E_IDLE_END_SECONDS)', () => {
  test.skip(!idleStack, 'set E2E_IDLE_END_SECONDS to the stack worker RUN_IDLE_END_SECONDS');

  test('TC-45.1: with the end-idle limit saved, runs of two agents both end by the idle limit', async ({ page }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const a = await createAgent(page.request, handle, projectId, { provider: 'claude', name: `A-${rand()}` });
    await saveCredential(page.request, a.id, 'claude');
    const b = await createAgent(page.request, handle, projectId, { provider: 'claude', name: `B-${rand()}` });
    await saveCredential(page.request, b.id, 'claude');
    const r1 = await ruleFor(page, handle, projectId, a.id);
    const r2 = await ruleFor(page, handle, projectId, b.id);

    // Step 1: the Limits tab, the shortest value the field allows (5 minutes), Save limits.
    await openAgent(page, handle, projectId, 'limits');
    await page.getByLabel('End idle runs after', { exact: true }).fill('5');
    await page.getByRole('button', { name: 'Save limits' }).click();
    await expect(page.getByText('Limits saved')).toBeVisible();

    const run1 = await commentOnNewTicket(page, handle, projectId, `/${r1}`);
    const run2 = await commentOnNewTicket(page, handle, projectId, `/${r2}`);
    try {
      await waitForStatus(page, run1, 'paused', (IDLE_END_SECONDS + 60) * 1000);
      await waitForStatus(page, run2, 'paused', (IDLE_END_SECONDS + 60) * 1000);
      expect((await runOf(page, run1)).agent.id).toBe(a.id);
      expect((await runOf(page, run2)).agent.id).toBe(b.id);
    } finally {
      await cancelRun(page, run1).catch(() => undefined);
      await cancelRun(page, run2).catch(() => undefined);
    }
  });

  test('TC-26.2, TC-38.1: a paused run keeps A after B becomes default, and resumes on A with its kind and model', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const a = await createAgent(page.request, handle, projectId, {
      provider: 'claude',
      name: `A-${rand()}`,
      model: 'haiku',
    });
    await saveCredential(page.request, a.id, 'claude');
    const b = await createAgent(page.request, handle, projectId, { provider: 'codex', name: `B-${rand()}` });
    await saveCredential(page.request, b.id, 'codex');
    await setDefaultAgent(page.request, handle, a.id);
    const command = await ruleFor(page, handle, projectId);
    const runId = await commentOnNewTicket(page, handle, projectId, `/${command}`);
    try {
      expect((await runOf(page, runId)).agent.id).toBe(a.id);
      await waitPaused(page, runId);

      // Step 1: B becomes the default.
      await openAgent(page, handle, projectId);
      await page.getByRole('button', { name: `Actions for ${b.name}`, exact: true }).click();
      await page.getByRole('button', { name: 'Set as default', exact: true }).click();
      await expect(page.getByText('Default agent changed. New runs only.', { exact: true })).toBeVisible();
      // TC-26.2 step 2: the paused run still shows A.
      const run = await runOf(page, runId);
      await page.goto(runUrl(handle, projectId, run.number));
      await expect(page.getByRole('banner').getByText('Paused', { exact: true })).toBeVisible({ timeout: 15_000 });
      await expectRunDetailAgent(page, handle, projectId, runId, a.name);

      // TC-38.1 step 2: the control that resumes the paused run.
      await page.getByRole('button', { name: 'Resume' }).click();
      const line = await firstLine(runId);
      expect(line).toMatch(/^agentdesk: agent claude model haiku endpoint /);
      await expectRunDetailAgent(page, handle, projectId, runId, a.name);
      expect((await runOf(page, runId)).agent.id).toBe(a.id);
    } finally {
      await cancelRun(page, runId).catch(() => undefined);
    }
  });

  test("TC-39.1: after the credential is replaced, a resumed run uses the new token, the same agent and the run's model", async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const a = await createAgent(page.request, handle, projectId, {
      provider: 'claude',
      name: `A-${rand()}`,
      model: 'haiku',
    });
    await saveCredential(page.request, a.id, 'claude');
    const command = await ruleFor(page, handle, projectId, a.id);
    const runId = await commentOnNewTicket(page, handle, projectId, `/${command}`);
    try {
      expect((await runOf(page, runId)).agent.model).toBe('haiku');
      await waitPaused(page, runId);
      // Given: A's model is then edited to M2.
      await ok(await page.request.patch(`/api/agents/${a.id}`, { data: { model: 'opus' } }), 200, 'edit model');

      // Step 1: Replace, type a new token, Save and test.
      await openAgentPane(page, handle, projectId, a.id);
      await page.getByRole('button', { name: 'Replace', exact: true }).click();
      const token = newTokenValue();
      await newToken(page).fill(token);
      const answered = page.waitForResponse(isCredentialPut);
      await page.getByRole('button', { name: 'Save and test' }).click();
      expect((await answered).status(), 'Save and test answered').toBe(200);

      // Step 2: resume the paused run.
      const run = await runOf(page, runId);
      await page.goto(runUrl(handle, projectId, run.number));
      await expect(page.getByRole('banner').getByText('Paused', { exact: true })).toBeVisible({ timeout: 15_000 });
      await page.getByRole('button', { name: 'Resume' }).click();

      // Step 3: the first line, the agent's secret file, the run detail.
      expect(await firstLine(runId)).toMatch(/^agentdesk: agent claude model haiku endpoint /);
      expect(await secretText(a.id), "the agent's fake secret file holds the new token").toContain(token);
      await expectRunDetailAgent(page, handle, projectId, runId, a.name, 'haiku');
      const secretPod = z.object({ data: z.record(z.string(), z.string()) });
      const podSecret = `${FAKE_STATE_DIR}/kube/.secrets/run-${runId}.json`;
      await expect
        .poll(() => existsSync(podSecret), { timeout: 30_000, message: 'the resumed pod has a Secret' })
        .toBe(true);
      const data = secretPod.parse(JSON.parse(await readFile(podSecret, 'utf8'))).data;
      expect(Object.values(data), "the resumed pod's Secret holds the new token").toContain(token);
    } finally {
      await cancelRun(page, runId).catch(() => undefined);
    }
  });
});
