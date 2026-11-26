import { randomBytes } from 'node:crypto';
import { appendFile, readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { expect, test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import {
  AgentConnectionDto,
  AgentDto,
  ProblemSchema,
  ProjectDto,
  RuleDto,
  pageOf,
  type AgentKind,
  type AgentTestStatus,
} from '@agentdesk/contracts';
import {
  API,
  FAKE_STATE_DIR,
  agentPane,
  cancelRun,
  commentOnNewTicket,
  createAgent,
  deleteAgent,
  deskAgentUrl,
  fakeAuthJson,
  isCredentialPut,
  newToken,
  newTokenValue,
  ok,
  openAgent,
  openAgentPane,
  readAgent,
  ruleWithAgent,
  runOf,
  touchPodFile,
  saveCredential,
  setDefaultAgent,
  signInAndCreateProject,
  signInAndStartProject,
  waitForStatus,
} from './helpers';

/*
 * Local end-to-end for the agent configuration data and permissions of Agent & settings (spec
 * 2026-11-24-multi-agent-configs-design.md, BR-2, 6, 7, 12, 13, 15, 17, 22, 23, 27 to 30, 33, 50, 51, 66). Every test
 * signs in as a new owner of its own e2e-<rand> org and creates its own project and agents (names carry a random
 * suffix). The offline stack cannot make a connection test come out "Ready", so the cases that need a tested agent
 * assert the status word of the test's own API answer. A token or credentials file typed here is never printed.
 */

test.describe.configure({ timeout: 240_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

const rand = () => randomBytes(3).toString('hex');
/** The status word a row shows for a test answer (spec BR-20). */
const WORD: Record<AgentTestStatus, string> = {
  ok: 'Ready',
  rejected: 'Credential rejected',
  unreachable: "Can't reach address",
  invalid: "Can't verify",
  unsupported: 'Not checkable',
};
const SET_LINE = /Set .+ by .+\. Hidden for good after saving\./;
/** The set date the pane shows for a credential time (the UTC day, en-GB). */
const dayOf = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
/** The credential blocks as the API sent them, with every key (a parsed DTO would drop the extra ones). */
const RawAgents = z.object({
  items: z.array(z.object({ id: z.string(), credential: z.record(z.string(), z.unknown()) })),
});
const COMING_SOON = [
  'gemini-cli',
  'github-copilot-cli',
  'cursor',
  'amp',
  'antigravity',
  'aider',
  'cline',
  'goose',
  'qwen-code',
  'kiro',
];

const list = (page: Page) => page.getByRole('region', { name: 'Agents list' });
const rowOf = (page: Page, name: string) =>
  list(page)
    .getByRole('listitem')
    .filter({ has: page.getByText(name, { exact: true }) });
const menuOf = (page: Page, name: string) => page.getByRole('button', { name: `Actions for ${name}`, exact: true });
const toast = (page: Page, text: string) => page.getByText(text, { exact: true });

/** A new agent of `provider` with a random name; `credential` also saves a first credential (an OpenCode one needs none). */
async function agentOf(
  page: Page,
  handle: string,
  projectId: string,
  provider: AgentKind,
  opts: { name?: string; accountLabel?: string; credential?: boolean } = {},
): Promise<AgentDto> {
  const agent = await createAgent(page.request, handle, projectId, {
    provider,
    name: opts.name ?? `${provider}-${rand()}`,
    ...(opts.accountLabel !== undefined && { accountLabel: opts.accountLabel }),
  });
  if (opts.credential === true) await saveCredential(page.request, agent.id, provider);
  return agent;
}

/** `GET /api/projects/:id/agents` (every agent of the project). */
async function listAgents(request: APIRequestContext, projectId: string): Promise<AgentDto[]> {
  const body = pageOf(AgentDto).parse(
    await ok(await request.get(`/api/projects/${projectId}/agents?pageSize=100`), 200, 'agents'),
  );
  return body.items;
}

async function agentById(request: APIRequestContext, projectId: string, agentId: string): Promise<AgentDto> {
  const found = (await listAgents(request, projectId)).find((a) => a.id === agentId);
  expect(found, `agent ${agentId} is listed`).toBeTruthy();
  return AgentDto.parse(found);
}

/** The pointers of a problem answer's `errors`. */
async function pointers(res: APIResponse): Promise<string[]> {
  const problem = ProblemSchema.parse(JSON.parse(await res.text()));
  return (problem.errors ?? []).map((e) => e.pointer);
}

/** The secret files the fake store holds for one agent (names end with `-agent-<id>.json`). */
async function secretFiles(agentId: string): Promise<string[]> {
  const names = await readdir(`${FAKE_STATE_DIR}/secrets`).catch(() => [] as string[]);
  return names.filter((n) => n.endsWith(`-agent-${agentId}.json`));
}

async function openList(page: Page, handle: string, projectId: string): Promise<void> {
  await openAgent(page, handle, projectId);
  await expect(list(page).getByRole('listitem').first()).toBeVisible();
}

/** Presses "Delete" in a row's menu, then "Delete agent" in the dialog. */
async function deleteFromRow(page: Page, name: string): Promise<void> {
  await menuOf(page, name).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page
    .getByRole('dialog', { name: `Delete agent ${name}?` })
    .getByRole('button', { name: 'Delete agent', exact: true })
    .click();
}

/** Types a token in the open Edit pane's credential entry and presses Save and test (answered 200). */
async function replaceToken(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Replace', exact: true }).click();
  await newToken(page).fill(newTokenValue());
  const answered = page.waitForResponse(isCredentialPut);
  await page.getByRole('button', { name: 'Save and test' }).click();
  expect((await answered).status()).toBe(200);
}

/** Runs the agent's connection test through the API; returns the answered status. */
async function testConnection(request: APIRequestContext, agentId: string): Promise<AgentTestStatus> {
  const res = AgentConnectionDto.parse(await ok(await request.post(`/api/agents/${agentId}/test`), 200, 'test'));
  expect(res.status, 'the test ran against a saved credential').not.toBe('no_credential');
  return res.status === 'no_credential' ? 'invalid' : res.status;
}

test.describe('BR-2: one default', () => {
  test('TC-2.2: setting A and B as default at the same moment leaves exactly one Default row, after reload too', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const a = await agentOf(page, handle, projectId, 'claude');
    const b = await agentOf(page, handle, projectId, 'claude');

    const answers = await Promise.all([
      page.request.post(`/api/agents/${a.id}/default`),
      page.request.post(`/api/agents/${b.id}/default`),
    ]);
    for (const res of answers) expect(res.status(), await res.text()).toBeLessThan(500);

    expect((await listAgents(page.request, projectId)).filter((x) => x.isDefault)).toHaveLength(1);
    await openList(page, handle, projectId);
    await expect(list(page).getByText('Default', { exact: true })).toHaveCount(1);
    await page.reload();
    await expect(list(page).getByRole('listitem').first()).toBeVisible();
    await expect(list(page).getByText('Default', { exact: true })).toHaveCount(1);
  });
});

test.describe('BR-6: a saved agent persists', () => {
  test('TC-6.2: an agent added through the pane is still listed with its model and label after reload', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const name = `Claude - Work ${rand()}`;
    await openList(page, handle, projectId);
    await page.getByRole('button', { name: 'Add agent', exact: true }).click();
    await page.getByRole('radio', { name: 'Claude Code', exact: true }).check();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
    await page.getByRole('textbox', { name: 'Account label' }).fill('Work');
    await page.getByRole('radio', { name: 'Subscription token' }).click();
    await newToken(page).fill(newTokenValue());
    await page.getByRole('combobox', { name: 'Default model' }).selectOption('sonnet');
    await page.getByRole('button', { name: 'Save agent' }).click();
    await expect(toast(page, 'Agent saved')).toBeVisible({ timeout: 60_000 });

    await page.reload();
    await expect(rowOf(page, name)).toBeVisible();
    await expect(rowOf(page, name)).toContainText('sonnet');
    await expect(rowOf(page, name)).toContainText('Work');
    const saved = (await listAgents(page.request, projectId)).find((a) => a.name === name);
    expect(saved?.model).toBe('sonnet');
  });
});

test.describe('BR-7: each agent keeps its own data', () => {
  test('TC-7.2: the agent with a credential shows its status and the one without shows Needs credential', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const personal = await agentOf(page, handle, projectId, 'claude', {
      name: `Claude - Personal ${rand()}`,
      accountLabel: 'Personal',
      credential: true,
    });
    const work = await agentOf(page, handle, projectId, 'claude', {
      name: `Claude - Work ${rand()}`,
      accountLabel: 'Work',
    });
    await openList(page, handle, projectId);
    await expect(rowOf(page, personal.name)).toContainText('Not tested');
    await expect(rowOf(page, personal.name)).not.toContainText('Needs credential');
    await expect(rowOf(page, work.name)).toContainText('Needs credential');
    await expect(rowOf(page, work.name)).not.toContainText('Not tested');
    await expect(rowOf(page, personal.name)).toContainText('Personal');
    await expect(rowOf(page, work.name)).toContainText('Work');
  });
});

test.describe('BR-12: a saved credential is never shown', () => {
  test('TC-12.2: a Codex credentials file with nested canary tokens shows only as set; no response or page text carries it', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const canaries = ['canary-nested-0002', 'canary-nested-0003', 'canary-nested-0004'];
    const file = JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: { id_token: canaries[0], access_token: canaries[1], nested: { refresh_token: canaries[2] } },
    });
    const codex = await agentOf(page, handle, projectId, 'codex');
    const bodies: string[] = [];
    const put = await page.request.put(`/api/agents/${codex.id}/credential`, {
      data: { type: 'auth_json', value: file },
    });
    bodies.push(await put.text());
    expect(put.status(), bodies[0]).toBe(200);

    // Positive control: the store really holds the file, so the "nothing is stored" checks elsewhere are not vacuous.
    expect(await secretFiles(codex.id)).toHaveLength(1);

    const pending: Promise<void>[] = [];
    page.on('response', (res) => {
      if (res.url().includes('/api/'))
        pending.push(
          res.text().then(
            (t) => void bodies.push(t),
            () => undefined,
          ),
        );
    });
    await page.goto(`${deskAgentUrl(handle, projectId)}`);
    await expect(rowOf(page, codex.name)).toBeVisible();
    await page.getByRole('button', { name: `Edit ${codex.name}`, exact: true }).click();
    await expect(agentPane(page)).toBeVisible();

    const listRes = await page.request.get(`/api/projects/${projectId}/agents?pageSize=100`);
    const rawList = await listRes.text();
    bodies.push(rawList);
    const raw = RawAgents.parse(JSON.parse(rawList)).items.find((x) => x.id === codex.id)?.credential;
    expect(Object.keys(raw ?? {}).sort()).toEqual(['set', 'setBy', 'type', 'updatedAt']);
    const saved = await agentById(page.request, projectId, codex.id);
    expect(saved.credential.set).toBe(true);
    expect(saved.credential.type).toBe('auth_json');
    expect(saved.credential.updatedAt).not.toBeNull();
    expect(saved.credential.setBy).toBeTruthy();

    // The row shows the type and not "Needs credential"; the pane shows when and by whom.
    await expect(rowOf(page, codex.name)).toContainText('Sign-in file (auth.json)');
    await expect(rowOf(page, codex.name)).not.toContainText('Needs credential');
    await expect(page.getByText(SET_LINE)).toContainText(
      `Set ${dayOf(saved.credential.updatedAt ?? '')} by ${saved.credential.setBy ?? ''}.`,
    );

    const pageText = `${await page.locator('body').innerText()}\n${await page.content()}`;
    bodies.push(pageText);
    // Wait for every in-flight response body to be read before scanning.
    await Promise.allSettled(pending);
    // scripts/runner-stack.sh writes one log per service to <RUNNER_STACK_DIR>/logs; a missing dir or no api.log fails.
    const logDir =
      process.env.RUNNER_STACK_DIR !== undefined && process.env.RUNNER_STACK_DIR !== ''
        ? `${process.env.RUNNER_STACK_DIR}/logs`
        : fileURLToPath(new URL('../../../../.agentdesk/runner-stack/logs', import.meta.url));
    const logNames = (await readdir(logDir)).filter((n) => n.endsWith('.log'));
    expect(logNames, `service logs in ${logDir}`).toContain('api.log');
    for (const name of logNames) bodies.push(await readFile(`${logDir}/${name}`, 'utf8'));
    for (const text of bodies) {
      for (const canary of canaries) expect(text.includes(canary), `${canary} is shown`).toBe(false);
      expect(text.includes(file), 'the credentials file text is shown').toBe(false);
    }
  });
});

test.describe('BR-13: replacing one credential leaves the others', () => {
  test('TC-13.1: replacing A in its pane leaves B with the same status and set line; A gets a newer set time', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const b = await agentOf(page, handle, projectId, 'claude', { credential: true });
    const a = await agentOf(page, handle, projectId, 'claude', { credential: true });

    await openAgentPane(page, handle, projectId, b.id);
    const bBefore = await page.getByText(SET_LINE).textContent();
    const bApiBefore = await agentById(page.request, projectId, b.id);
    const aBefore = await agentById(page.request, projectId, a.id);

    await openAgentPane(page, handle, projectId, a.id);
    // The pane shows the set day (UTC), so A's line names the day of its saved time before and after.
    await expect(page.getByText(SET_LINE)).toContainText(`Set ${dayOf(aBefore.credential.updatedAt ?? '')} by`);
    await replaceToken(page);
    const aSaved = await agentById(page.request, projectId, a.id);
    await expect(page.getByText(SET_LINE)).toContainText(`Set ${dayOf(aSaved.credential.updatedAt ?? '')} by`);

    await openAgentPane(page, handle, projectId, b.id);
    expect(await page.getByText(SET_LINE).textContent()).toBe(bBefore);
    const bAfter = await agentById(page.request, projectId, b.id);
    expect(bAfter.credential).toEqual(bApiBefore.credential);
    expect(bAfter.lastTest).toEqual(bApiBefore.lastTest);
    const aAfter = await agentById(page.request, projectId, a.id);
    expect(Date.parse(aAfter.credential.updatedAt ?? '')).toBeGreaterThan(
      Date.parse(aBefore.credential.updatedAt ?? ''),
    );
  });
});

test.describe('BR-15: a credential of another type resets the test', () => {
  test('TC-15.6: an API-key credential for A shows type API key and Not tested; B is unchanged', async ({ page }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const a = await agentOf(page, handle, projectId, 'claude', { credential: true });
    const b = await agentOf(page, handle, projectId, 'claude', { credential: true });
    const tested = await testConnection(page.request, a.id);
    expect((await agentById(page.request, projectId, a.id)).lastTest?.status).toBe(tested);
    const bBefore = await agentById(page.request, projectId, b.id);

    await ok(
      await page.request.put(`/api/agents/${a.id}/credential`, { data: { type: 'api_key', value: newTokenValue() } }),
      200,
      'api key',
    );
    const aAfter = await agentById(page.request, projectId, a.id);
    expect(aAfter.credential.type).toBe('api_key');
    expect(aAfter.lastTest).toBeNull();
    await openList(page, handle, projectId);
    await expect(rowOf(page, a.name)).toContainText('Not tested');
    await expect(rowOf(page, a.name)).toContainText('API key');
    expect(await agentById(page.request, projectId, b.id)).toEqual(bBefore);
  });

  test('TC-15.7: a Codex credential of type oauth_token answers 422 on /type and the credential is unchanged', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const codex = await agentOf(page, handle, projectId, 'codex', { credential: true });
    const before = await agentById(page.request, projectId, codex.id);
    const res = await page.request.put(`/api/agents/${codex.id}/credential`, {
      data: { type: 'oauth_token', value: newTokenValue() },
    });
    expect(res.status(), await res.text()).toBe(422);
    expect(await pointers(res)).toContain('/type');
    expect((await agentById(page.request, projectId, codex.id)).credential).toEqual(before.credential);
  });
});

test.describe('BR-17: edits persist', () => {
  test('TC-17.2: a new name, label and model made in the pane show on the row after reload', async ({ page }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const agent = await agentOf(page, handle, projectId, 'claude', {
      name: `Claude - Personal ${rand()}`,
      accountLabel: 'Personal',
      credential: true,
    });
    const renamed = `Claude - Home ${rand()}`;
    await openAgentPane(page, handle, projectId, agent.id);
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(renamed);
    await page.getByRole('textbox', { name: 'Account label' }).fill('Home');
    await page.getByRole('combobox', { name: 'Default model' }).selectOption('haiku');
    await page.getByRole('button', { name: 'Save agent' }).click();
    await expect(agentPane(page)).toHaveCount(0);

    await page.reload();
    await expect(rowOf(page, renamed)).toBeVisible();
    await expect(rowOf(page, renamed)).toContainText('Home');
    await expect(rowOf(page, renamed)).toContainText('haiku');
    await expect(rowOf(page, agent.name)).toHaveCount(0);
  });
});

test.describe('BR-22: the row keeps its last test', () => {
  test('TC-22.2: the row shows the test result after reload and Not tested after a new token', async ({ page }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const agent = await agentOf(page, handle, projectId, 'claude', { credential: true });
    await openList(page, handle, projectId);
    await menuOf(page, agent.name).click();
    const answered = page.waitForResponse(
      (r) => r.url().endsWith(`/api/agents/${agent.id}/test`) && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Test connection', exact: true }).click();
    const result = AgentConnectionDto.parse(JSON.parse(await (await answered).text()));
    expect(result.status).not.toBe('no_credential');
    const word = WORD[result.status === 'no_credential' ? 'invalid' : result.status];
    await expect(rowOf(page, agent.name)).toContainText(word);

    await page.reload();
    await expect(rowOf(page, agent.name)).toContainText(word);
    await expect(rowOf(page, agent.name)).not.toContainText('Not tested');

    await ok(
      await page.request.put(`/api/agents/${agent.id}/credential`, {
        data: { type: 'oauth_token', value: newTokenValue() },
      }),
      200,
      'new token',
    );
    await page.reload();
    await expect(rowOf(page, agent.name)).toContainText('Not tested');
  });

  test('TC-22.3: a credential of another type puts the tested row back to Not tested', async ({ page }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const agent = await agentOf(page, handle, projectId, 'claude', { credential: true });
    const status = await testConnection(page.request, agent.id);
    await openList(page, handle, projectId);
    await expect(rowOf(page, agent.name)).toContainText(WORD[status]);

    await ok(
      await page.request.put(`/api/agents/${agent.id}/credential`, {
        data: { type: 'api_key', value: newTokenValue() },
      }),
      200,
      'another type',
    );
    await page.reload();
    await expect(rowOf(page, agent.name)).toContainText('Not tested');
    await expect(rowOf(page, agent.name)).not.toContainText(WORD[status]);
  });

  test('TC-22.4: a new address with a token puts the tested row back to Not tested', async ({ page }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const agent = await agentOf(page, handle, projectId, 'claude', { credential: true });
    const status = await testConnection(page.request, agent.id);
    await openList(page, handle, projectId);
    await expect(rowOf(page, agent.name)).toContainText(WORD[status]);

    await ok(
      await page.request.put(`/api/agents/${agent.id}/credential`, {
        data: { type: 'oauth_token', value: newTokenValue(), baseUrl: 'https://gateway.harbor-labs.com' },
      }),
      200,
      'new address',
    );
    await page.reload();
    await expect(rowOf(page, agent.name)).toContainText('Not tested');
  });
});

test.describe('BR-23: Set as default', () => {
  test('TC-23.2: Set as default on B moves the Default marker to B and it stays after reload', async ({ page }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const a = await readAgent(page, projectId);
    const b = await agentOf(page, handle, projectId, 'claude');
    await openList(page, handle, projectId);
    await menuOf(page, b.name).click();
    await page.getByRole('button', { name: 'Set as default', exact: true }).click();
    await expect(toast(page, 'Default agent changed. New runs only.')).toBeVisible();

    await page.reload();
    await expect(rowOf(page, b.name).getByText('Default', { exact: true })).toBeVisible();
    await expect(rowOf(page, a.name).getByText('Default', { exact: true })).toHaveCount(0);
    await expect(list(page).getByText('Default', { exact: true })).toHaveCount(1);
  });
});

/** Given: a rule that names the agent, a run it started, and the run cancelled (a closed run). */
async function closedRunOn(page: Page, handle: string, projectId: string, agentId: string, command: string) {
  const runId = await commentOnNewTicket(page, handle, projectId, `/${command}`);
  expect((await runOf(page, runId)).agent.id, 'the rule started the run on the agent').toBe(agentId);
  await cancelRun(page, runId);
  return runId;
}

test.describe('BR-27: delete an unused agent', () => {
  test('TC-27.3: an agent whose rule was re-pointed and whose run is closed is deleted from its row and stays gone', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const a = await agentOf(page, handle, projectId, 'claude', { credential: true });
    const b = await agentOf(page, handle, projectId, 'claude', { credential: true });
    expect((await agentById(page.request, projectId, b.id)).isDefault, 'B is not the default').toBe(false);
    const command = `cmd-${rand()}`;
    const rule = await ruleWithAgent(page.request, handle, projectId, { command, agentId: b.id, target: 'any' });
    await closedRunOn(page, handle, projectId, b.id, command);
    const repointed = RuleDto.parse(
      await ok(
        await page.request.patch(`/api/rules/${rule.id}`, { data: { agentId: a.id, model: null } }),
        200,
        'repoint',
      ),
    );
    expect(repointed.agentId).toBe(a.id);

    await openList(page, handle, projectId);
    await deleteFromRow(page, b.name);
    await expect(toast(page, 'Agent deleted')).toBeVisible();
    await expect(rowOf(page, b.name)).toHaveCount(0);
    await page.reload();
    await expect(list(page).getByRole('listitem').first()).toBeVisible();
    await expect(rowOf(page, b.name)).toHaveCount(0);
  });
});

test.describe('BR-28: the default agent', () => {
  test('TC-28.2: deleting the default agent is refused with 409 and it stays Default', async ({ page }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const a = await readAgent(page, projectId);
    await agentOf(page, handle, projectId, 'claude');
    const res = await page.request.delete(`/api/agents/${a.id}`);
    const text = await res.text();
    expect(res.status(), text).toBe(409);
    expect(text).toContain('Set another agent as default first');
    await openList(page, handle, projectId);
    await expect(rowOf(page, a.name).getByText('Default', { exact: true })).toBeVisible();
  });
});

test.describe('BR-29: an agent a rule names', () => {
  test('TC-29.3: deleting an agent a rule names is refused with 409 naming the rule; the rule still names it', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const b = await agentOf(page, handle, projectId, 'claude');
    const command = `cmd-${rand()}`;
    const rule = await ruleWithAgent(page.request, handle, projectId, { command, agentId: b.id });
    const res = await page.request.delete(`/api/agents/${b.id}`);
    const text = await res.text();
    expect(res.status(), text).toBe(409);
    expect(text).toContain(`/${command}`);

    await page.goto(`/o/${handle}/p/${projectId}/desk/rules`);
    await expect(page.getByRole('button', { name: `Edit rule /${command}` })).toContainText(`with ${b.name}`);
    const rules = pageOf(RuleDto).parse(
      await ok(await page.request.get(`/api/projects/${projectId}/rules`), 200, 'rules'),
    );
    expect(rules.items.find((r) => r.id === rule.id)?.agentId).toBe(b.id);
    expect(await listAgents(page.request, projectId)).toContainEqual(expect.objectContaining({ id: b.id }));
  });

  test('TC-29.4: after the rule is changed to Project default, the agent is deleted', async ({ page }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const b = await agentOf(page, handle, projectId, 'claude');
    const rule = await ruleWithAgent(page.request, handle, projectId, { command: `cmd-${rand()}`, agentId: b.id });
    expect(await deleteAgent(page.request, handle, b.id)).toBe(409);
    await ok(
      await page.request.patch(`/api/rules/${rule.id}`, { data: { agentId: null, model: null } }),
      200,
      'repoint',
    );
    expect(await deleteAgent(page.request, handle, b.id)).toBe(204);
    expect((await listAgents(page.request, projectId)).some((x) => x.id === b.id)).toBe(false);
  });
});

test.describe('BR-30: an agent with open runs', () => {
  /** A rule that names B, a comment that starts a run on B, and the run idle. Returns the run id. */
  async function idleRunOn(page: Page, handle: string, projectId: string, agent: AgentDto): Promise<string> {
    const command = `cmd-${rand()}`;
    await ruleWithAgent(page.request, handle, projectId, { command, agentId: agent.id, target: 'any' });
    const runId = await commentOnNewTicket(page, handle, projectId, `/${command}`);
    await waitForStatus(page, runId, 'idle');
    return runId;
  }

  /** The rule is re-pointed to the default so only the run holds the agent. */
  async function releaseRule(page: Page, projectId: string): Promise<void> {
    const rules = pageOf(RuleDto).parse(
      await ok(await page.request.get(`/api/projects/${projectId}/rules?pageSize=100`), 200, 'rules'),
    );
    for (const r of rules.items.filter((x) => x.agentId !== null)) {
      await ok(
        await page.request.patch(`/api/rules/${r.id}`, { data: { agentId: null, model: null } }),
        200,
        'release',
      );
    }
  }

  test('TC-30.2: deleting an agent with a running run is refused with 409 and a reason; the agent stays', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const b = await agentOf(page, handle, projectId, 'claude', { credential: true });
    const command = `cmd-${rand()}`;
    await ruleWithAgent(page.request, handle, projectId, { command, agentId: b.id, target: 'any' });
    // `--fake-unflushed` keeps the turn of the first typed line open until a `release-turn` file exists, so the run stays running.
    const runId = await commentOnNewTicket(page, handle, projectId, `/${command} --fake-unflushed`);
    try {
      await waitForStatus(page, runId, 'idle');
      await appendFile(`${FAKE_STATE_DIR}/kube/run-${runId}/input`, 'hold\r');
      await waitForStatus(page, runId, 'running');
      await releaseRule(page, projectId);
      const res = await page.request.delete(`/api/agents/${b.id}`);
      const text = await res.text();
      expect(res.status(), text).toBe(409);
      const number = (await runOf(page, runId)).number;
      expect(text).toContain(`Run ${number} is running. Finish it first, then delete.`);
      expect((await runOf(page, runId)).status).toBe('running');
      expect((await listAgents(page.request, projectId)).some((x) => x.id === b.id)).toBe(true);
    } finally {
      await touchPodFile(runId, 'release-turn');
      await cancelRun(page, runId).catch(() => undefined);
    }
  });

  test('TC-30.3: deleting an agent with a paused run is refused with 409 and a reason; the agent stays', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const b = await agentOf(page, handle, projectId, 'claude', { credential: true });
    const runId = await idleRunOn(page, handle, projectId, b);
    try {
      await ok(await page.request.post(`/api/runs/${runId}/stop`), 202, 'stop');
      await waitForStatus(page, runId, 'paused', 90_000);
      await releaseRule(page, projectId);
      const res = await page.request.delete(`/api/agents/${b.id}`);
      const text = await res.text();
      expect(res.status(), text).toBe(409);
      expect(text).toMatch(/Run \d+ is paused and can be resumed\. Finish it first, then delete\./);
      expect((await runOf(page, runId)).status).toBe('paused');
      expect((await listAgents(page.request, projectId)).some((x) => x.id === b.id)).toBe(true);
    } finally {
      await cancelRun(page, runId).catch(() => undefined);
    }
  });

  test('TC-30.4: once the only run of an agent is cancelled the agent is deleted', async ({ page }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const b = await agentOf(page, handle, projectId, 'claude', { credential: true });
    const runId = await idleRunOn(page, handle, projectId, b);
    await releaseRule(page, projectId);
    await cancelRun(page, runId);
    expect(await deleteAgent(page.request, handle, b.id)).toBe(204);
    expect((await listAgents(page.request, projectId)).some((x) => x.id === b.id)).toBe(false);
  });
});

test.describe('BR-33: a rule keeps its agent', () => {
  test('TC-33.2: a rule saved with an agent shows it on the row and in the reopened form after reload', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndCreateProject(page);
    const codex = await agentOf(page, handle, projectId, 'codex', { credential: true });
    const command = `cmd-${rand()}`;
    await page.goto(`/o/${handle}/p/${projectId}/desk/rules`);
    await page.getByRole('button', { name: 'New rule' }).first().click();
    await page.getByRole('textbox', { name: 'Command' }).fill(command);
    await page.getByRole('combobox', { name: 'Skill', exact: true }).selectOption('code-review');
    await page.getByLabel('With agent').selectOption({ label: codex.name });
    await page.getByRole('button', { name: 'Save rule' }).click();
    const row = page.getByRole('button', { name: `Edit rule /${command}` });
    await expect(row).toBeVisible();

    await page.reload();
    await expect(row).toContainText(`with ${codex.name}`);
    await row.click();
    await expect(page.getByRole('heading', { name: 'Edit rule' })).toBeVisible();
    await expect(page.getByLabel('With agent').locator('option:checked')).toHaveText(codex.name);
  });
});

test.describe('BR-50: the old agent route acts on the default agent', () => {
  test('TC-50.1: a fresh project answers the seeded agent "Claude" with the project limits', async ({ page }) => {
    const { projectId } = await signInAndStartProject(page);
    const agent = await readAgent(page, projectId);
    expect(agent.name).toBe('Claude');
    expect(agent.provider).toBe('claude');
    expect(agent.isDefault).toBe(true);
    expect(agent.projectId).toBe(projectId);
    const project = ProjectDto.parse(await ok(await page.request.get(`/api/projects/${projectId}`), 200, 'project'));
    expect({
      timeoutSeconds: agent.timeoutSeconds,
      pausedKeepSeconds: agent.pausedKeepSeconds,
      doneKeepSeconds: agent.doneKeepSeconds,
      idleEndSeconds: agent.idleEndSeconds,
      autoResumeMax: agent.autoResumeMax,
    }).toEqual({
      timeoutSeconds: project.timeoutSeconds,
      pausedKeepSeconds: project.pausedKeepSeconds,
      doneKeepSeconds: project.doneKeepSeconds,
      idleEndSeconds: project.idleEndSeconds,
      autoResumeMax: project.autoResumeMax,
    });
  });

  test('TC-50.2: with agents A then B created and B made default, the route answers B', async ({ page }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    await agentOf(page, handle, projectId, 'claude');
    const b = await agentOf(page, handle, projectId, 'claude');
    await setDefaultAgent(page.request, handle, b.id);
    expect((await readAgent(page, projectId)).id).toBe(b.id);
  });

  test('TC-50.3: PUT with a new model and time limit shows on the default agent row and the Limits tab', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    await agentOf(page, handle, projectId, 'claude');
    const b = await agentOf(page, handle, projectId, 'claude');
    await setDefaultAgent(page.request, handle, b.id);
    await ok(
      await page.request.put(`/api/projects/${projectId}/agent`, { data: { model: 'haiku', timeoutSeconds: 36000 } }),
      200,
      'put agent',
    );
    await openList(page, handle, projectId);
    await expect(rowOf(page, b.name)).toContainText('haiku');
    await openAgent(page, handle, projectId, 'limits');
    await expect(page.getByLabel('Run time limit', { exact: true })).toHaveValue('10');
    await expect(page.getByLabel('Run time limit unit', { exact: true })).toHaveValue('hours');
  });
});

test.describe('BR-51: refused agent and credential requests', () => {
  test('TC-51.1: each Coming-soon provider answers 422 on /provider and the list is unchanged', async ({ page }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const before = (await listAgents(page.request, projectId)).map((a) => a.id).sort();
    for (const provider of COMING_SOON) {
      const res = await page.request.post(`/api/projects/${projectId}/agents`, {
        data: { provider, name: `${provider}-${rand()}` },
      });
      expect(res.status(), `${provider} (${handle}): ${await res.text()}`).toBe(422);
      expect(await pointers(res), provider).toContain('/provider');
    }
    expect((await listAgents(page.request, projectId)).map((a) => a.id).sort()).toEqual(before);
  });

  test('TC-51.2: an unknown provider answers 422 on /provider', async ({ page }) => {
    const { projectId } = await signInAndStartProject(page);
    const res = await page.request.post(`/api/projects/${projectId}/agents`, {
      data: { provider: 'foo', name: `foo-${rand()}` },
    });
    expect(res.status(), await res.text()).toBe(422);
    expect(await pointers(res)).toContain('/provider');
  });

  test('TC-51.3: an OpenCode agent is created with 201 and listed', async ({ page }) => {
    const { projectId } = await signInAndStartProject(page);
    const name = `opencode-${rand()}`;
    const res = await page.request.post(`/api/projects/${projectId}/agents`, { data: { provider: 'opencode', name } });
    expect(res.status(), await res.text()).toBe(201);
    const created = AgentDto.parse(JSON.parse(await res.text()));
    expect(created.provider).toBe('opencode');
    expect((await listAgents(page.request, projectId)).some((a) => a.id === created.id)).toBe(true);
  });

  test('TC-51.4: a Coming-soon provider sent to PATCH agents/:id and PUT /agent leaves the provider unchanged', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const agent = await agentOf(page, handle, projectId, 'claude');
    const patch = await page.request.patch(`/api/agents/${agent.id}`, { data: { provider: 'gemini-cli' } });
    expect([200, 400, 422], await patch.text()).toContain(patch.status());
    await setDefaultAgent(page.request, handle, agent.id);
    const put = await page.request.put(`/api/projects/${projectId}/agent`, {
      data: { provider: 'gemini-cli', model: 'sonnet', timeoutSeconds: 3600 },
    });
    expect([200, 400, 422], await put.text()).toContain(put.status());
    expect((await agentById(page.request, projectId, agent.id)).provider).toBe('claude');
  });

  test('TC-51.5: an OpenCode credentials file with an address answers 422 on /baseUrl and nothing is stored', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const agent = await agentOf(page, handle, projectId, 'opencode');
    const res = await page.request.put(`/api/agents/${agent.id}/credential`, {
      data: { type: 'auth_json', value: fakeAuthJson(), baseUrl: 'https://gateway.harbor-labs.com' },
    });
    expect(res.status(), await res.text()).toBe(422);
    expect(await pointers(res)).toContain('/baseUrl');
    expect((await agentById(page.request, projectId, agent.id)).credential.set).toBe(false);
    expect(await secretFiles(agent.id)).toEqual([]);
  });

  test('TC-51.6: an OpenCode API key with no address answers 422 on /baseUrl and nothing is stored', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const agent = await agentOf(page, handle, projectId, 'opencode');
    const res = await page.request.put(`/api/agents/${agent.id}/credential`, {
      data: { type: 'api_key', value: newTokenValue() },
    });
    expect(res.status(), await res.text()).toBe(422);
    expect(await pointers(res)).toContain('/baseUrl');
    expect((await agentById(page.request, projectId, agent.id)).credential.set).toBe(false);
    expect(await secretFiles(agent.id)).toEqual([]);
  });

  test('TC-51.7: an OpenCode address with an empty key is a 4xx answer on the key field and nothing is stored', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const agent = await agentOf(page, handle, projectId, 'opencode');
    const res = await page.request.put(`/api/agents/${agent.id}/credential`, {
      data: { type: 'api_key', value: '', baseUrl: 'https://gateway.harbor-labs.com' },
    });
    expect(res.status(), await res.text()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
    expect(await pointers(res)).toContain('/value');
    expect((await agentById(page.request, projectId, agent.id)).credential.set).toBe(false);
    expect(await secretFiles(agent.id)).toEqual([]);
  });
});

test.describe('BR-66: a project keeps at least one agent', () => {
  test('TC-66.3: deleting the only agent answers 409 with the reason; it stays the default', async ({ page }) => {
    const { projectId } = await signInAndStartProject(page);
    const only = await readAgent(page, projectId);
    const res = await page.request.delete(`/api/agents/${only.id}`);
    const text = await res.text();
    expect(res.status(), text).toBe(409);
    expect(text).toContain('A project needs at least one agent. Add another agent first.');
    const agents = await listAgents(page.request, projectId);
    expect(agents.map((a) => a.id)).toEqual([only.id]);
    expect(agents[0]?.isDefault).toBe(true);
  });

  test('TC-66.4: the default is refused, then after a second agent becomes default the first is deleted', async ({
    page,
  }) => {
    const { handle, projectId } = await signInAndStartProject(page);
    const first = await readAgent(page, projectId);
    const second = await agentOf(page, handle, projectId, 'claude');
    expect(await deleteAgent(page.request, handle, first.id)).toBe(409);
    await setDefaultAgent(page.request, handle, second.id);
    expect(await deleteAgent(page.request, handle, first.id)).toBe(204);
    const agents = await listAgents(page.request, projectId);
    expect(agents.map((a) => a.id)).toEqual([second.id]);
    expect(agents[0]?.isDefault).toBe(true);
  });
});
