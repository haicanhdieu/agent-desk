import { type AgentDto, AGENT_NAME_MAX } from '@agentdesk/contracts';
// The contracts package's own client drives the handlers; the restriction is for app code.

import { ApiError, createApi } from '@agentdesk/contracts/client';
import { describe, expect, it } from 'vitest';
import { agentsFixture } from '../dto/agents';
import { ids } from '../dto/ids';
import { mockDb } from './db';
import { scenarios } from './scenarios';

const BASE = 'http://localhost:3000';
const api = createApi({ baseUrl: BASE, parse: true });
const P = ids.project.invoicerApi;
const params = { projectId: P };

async function rejection(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('expected the call to fail');
}

const list = async (): Promise<AgentDto[]> => (await api.agents.list({ params, query: {} })).items;
const byName = async (name: string): Promise<AgentDto> => {
  const found = (await list()).find((a) => a.name === name);
  if (!found) throw new Error(`agent ${name} missing`);
  return found;
};
/** The raw answer, for bodies the typed client would refuse before sending. */
const post = (path: string, body: unknown) =>
  fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('agents.list', () => {
  it('lists the default agent first, paged', async () => {
    scenarios.agents('manyAgents');
    const page = await api.agents.list({ params, query: { pageSize: 10 } });
    expect(page.items).toHaveLength(10);
    expect(page.total).toBe(30);
    expect(page.items[0]?.isDefault).toBe(true);
    const last = await api.agents.list({ params, query: { page: 3, pageSize: 10 } });
    expect(last.items.filter((a) => a.isDefault)).toHaveLength(0);
  });

  it('puts the default first even when it was stored last', async () => {
    mockDb.state.agents = [...agentsFixture].reverse();
    expect((await list())[0]?.isDefault).toBe(true);
  });

  it('answers an empty page for agentsEmpty and 500 for listError', async () => {
    scenarios.agents('agentsEmpty');
    expect(await list()).toEqual([]);
    scenarios.agents('listError');
    expect((await rejection(api.agents.list({ params, query: {} }))).status).toBe(500);
  });
});

describe('agents.create', () => {
  it('BR-62: the first agent of a project with none is the default, the second is not', async () => {
    scenarios.agents('agentsEmpty');
    const first = await api.agents.create({ params, body: { provider: 'claude', name: 'First' } });
    expect(first.isDefault).toBe(true);
    const second = await api.agents.create({ params, body: { provider: 'codex', name: 'Second' } });
    expect(second.isDefault).toBe(false);
    expect((await list()).filter((a) => a.isDefault)).toHaveLength(1);
  });

  it('BR-62: a project whose data has no default makes the new agent the default', async () => {
    mockDb.state.agents = mockDb.state.agents.map((a) => ({ ...a, isDefault: false }));
    const created = await api.agents.create({ params, body: { provider: 'claude', name: 'Fresh' } });
    expect(created.isDefault).toBe(true);
  });

  it('starts without a credential, with the project limits and the provider default model', async () => {
    const created = await api.agents.create({ params, body: { provider: 'codex', name: 'Codex' } });
    expect(created).toMatchObject({
      provider: 'codex',
      projectId: P,
      credential: { set: false, type: null },
      lastTest: null,
      usage: { rules: 0, blockingRuns: 0 },
      timeoutSeconds: 86400,
    });
    expect(created.model).not.toBe('');
  });

  it('accepts opencode with an empty model', async () => {
    const created = await api.agents.create({ params, body: { provider: 'opencode', name: 'Open' } });
    expect(created).toMatchObject({ provider: 'opencode', model: '' });
  });

  it('409 on a duplicate name, ignoring case', async () => {
    await api.agents.create({ params, body: { provider: 'claude', name: 'Dup' } });
    const e = await rejection(api.agents.create({ params, body: { provider: 'claude', name: 'dUP' } }));
    expect(e.status).toBe(409);
    expect(e.errors).toEqual([{ pointer: '/name', detail: expect.any(String) }]);
  });

  it.each(['gemini-cli', 'google-antigravity', 'antigravity', 'nope'])('422 on /provider for %s', async (provider) => {
    const res = await post(`/api/projects/${P}/agents`, { provider, name: 'X' });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: { pointer: string }[] };
    expect(body.errors[0]?.pointer).toBe('/provider');
    expect((await list()).some((a) => a.name === 'X')).toBe(false);
  });

  it('404 for a project of another org', async () => {
    const e = await rejection(
      api.agents.create({ params: { projectId: ids.project.storefront }, body: { provider: 'claude', name: 'X' } }),
    );
    expect(e.status).toBe(404);
  });
});

describe('agents.update', () => {
  it('changes name, account label, model and max turns', async () => {
    const a = await api.agents.create({ params, body: { provider: 'claude', name: 'Upd' } });
    const updated = await api.agents.update({
      params: { agentId: a.id },
      body: { name: 'Renamed', accountLabel: 'Work', model: 'sonnet', maxTurns: 7 },
    });
    expect(updated).toMatchObject({ name: 'Renamed', accountLabel: 'Work', model: 'sonnet', maxTurns: 7 });
    const cleared = await api.agents.update({
      params: { agentId: a.id },
      body: { accountLabel: null, maxTurns: null },
    });
    expect(cleared).toMatchObject({ accountLabel: null, maxTurns: null });
  });

  it('409 on a name another agent has, ignoring case; the agent keeps its own name', async () => {
    scenarios.agents('perAgentModels');
    const codex = await byName('Codex');
    const e = await rejection(api.agents.update({ params: { agentId: codex.id }, body: { name: 'claude - work' } }));
    expect(e.status).toBe(409);
    await expect(api.agents.update({ params: { agentId: codex.id }, body: { name: 'CODEX' } })).resolves.toMatchObject({
      name: 'CODEX',
    });
  });

  it('accepts an empty model only for a kind whose model is optional', async () => {
    scenarios.agents('perAgentModels');
    const open = await byName('OpenCode - Credentials file');
    await expect(api.agents.update({ params: { agentId: open.id }, body: { model: '' } })).resolves.toMatchObject({
      model: '',
    });
    const codex = await byName('Codex');
    const e = await rejection(api.agents.update({ params: { agentId: codex.id }, body: { model: '' } }));
    expect(e.status).toBe(422);
    expect(e.errors?.[0]?.pointer).toBe('/model');
  });

  it('404 for an unknown agent and for an agent of another org', async () => {
    expect(
      (await rejection(api.agents.update({ params: { agentId: ids.created(9999) }, body: { name: 'x' } }))).status,
    ).toBe(404);
    const e = await rejection(api.agents.update({ params: { agentId: ids.agent.storefront }, body: { name: 'x' } }));
    expect(e.status).toBe(404);
  });

  it('rejects a 257-character name through the contract', async () => {
    const a = await api.agents.create({ params, body: { provider: 'claude', name: 'Long' } });
    const res = await fetch(`${BASE}/api/agents/${a.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x'.repeat(AGENT_NAME_MAX + 1) }),
    });
    expect(res.status).toBe(400);
  });
});

describe('agents.setDefault', () => {
  it('moves the default: exactly one agent is default afterwards', async () => {
    scenarios.agents('perAgentModels');
    const codex = await byName('Codex');
    const answer = await api.agents.setDefault({ params: { agentId: codex.id } });
    expect(answer).toMatchObject({ id: codex.id, isDefault: true });
    const all = await list();
    expect(all.filter((a) => a.isDefault).map((a) => a.id)).toEqual([codex.id]);
    expect(all[0]?.id).toBe(codex.id);
  });

  it('leaves the defaults of other projects alone', async () => {
    scenarios.agents('perAgentModels');
    const codex = await byName('Codex');
    await api.agents.setDefault({ params: { agentId: codex.id } });
    const other = mockDb.state.agents.filter((a) => a.projectId !== P);
    expect(other.every((a) => a.isDefault)).toBe(true);
  });
});

describe('agents.remove', () => {
  const removal = (agentId: string) => rejection(api.agents.remove({ params: { agentId } }));

  it('deletes an unused non-default agent', async () => {
    scenarios.agents('perAgentModels');
    const codex = await byName('Codex');
    await api.agents.remove({ params: { agentId: codex.id } });
    expect((await list()).some((a) => a.id === codex.id)).toBe(false);
  });

  it('refuses the only agent, also when unused', async () => {
    const only = (await list())[0];
    const e = await removal(only?.id ?? '');
    expect(e.status).toBe(409);
    expect(e.detail).toBe('A project needs at least one agent. Add another agent first.');
    expect(await list()).toHaveLength(1);
  });

  it('refuses the default while another agent exists', async () => {
    scenarios.agents('perAgentModels');
    const dflt = (await list()).find((a) => a.isDefault);
    const e = await removal(dflt?.id ?? '');
    expect(e.status).toBe(409);
    expect(e.detail).toBe('Set another agent as default first');
  });

  it('refuses an agent a rule names, with the rule command', async () => {
    scenarios.agents('deleteBlocked');
    const work = await byName('Claude - Work');
    const e = await removal(work.id);
    expect(e.status).toBe(409);
    expect(e.detail).toBe('1 rule names it: /fix. Point it at another agent first, then delete.');
    expect((await list()).some((a) => a.id === work.id)).toBe(true);
  });

  it('refuses an agent with a run that blocks it, in the API words, with the run number', async () => {
    scenarios.agents('deleteBlocked');
    const codex = await byName('Codex');
    const e = await removal(codex.id);
    expect(e.status).toBe(409);
    expect(e.detail).toBe('Run 900 is paused and can be resumed. Finish it first, then delete.');
  });

  it('swapDeleteFails: the placeholder delete answers 500 and the agent stays', async () => {
    scenarios.agents('swapDeleteFails');
    const placeholder = await byName('Claude');
    expect((await removal(placeholder.id)).status).toBe(500);
    expect((await list()).some((a) => a.id === placeholder.id)).toBe(true);
  });

  it('404 for an agent of another org', async () => {
    expect((await removal(ids.agent.storefront)).status).toBe(404);
  });
});

describe('agents.test', () => {
  const run = (agentId: string) => api.agents.test({ params: { agentId } });

  it('answers ok for an agent with a credential and records the test on the row', async () => {
    scenarios.agents('perAgentModels');
    const claude = await byName('Claude - Work');
    const answer = await run(claude.id);
    expect(answer).toMatchObject({ status: 'ok', message: 'Connected' });
    expect(answer.testedAt).not.toBeNull();
    expect((await byName('Claude - Work')).lastTest?.status).toBe('ok');
  });

  it('answers unsupported for a Codex credentials file: there is nothing to check', async () => {
    scenarios.agents('perAgentModels');
    expect((await run((await byName('Codex')).id)).status).toBe('unsupported');
  });

  it('answers no_credential for an agent with none', async () => {
    scenarios.agents('perAgentModels');
    const fresh = await byName('Claude - New');
    expect(await run(fresh.id)).toMatchObject({ status: 'no_credential', testedAt: null });
    expect((await byName('Claude - New')).lastTest).toBeNull();
  });

  it('answers unsupported for OpenCode with no credential or with a credentials file, ok with an endpoint and key', async () => {
    scenarios.agents('perAgentModels');
    expect((await run((await byName('OpenCode - No sign-in')).id)).status).toBe('unsupported');
    // The row keeps that answer.
    expect((await byName('OpenCode - No sign-in')).lastTest?.status).toBe('unsupported');
    expect((await run((await byName('OpenCode - Credentials file')).id)).status).toBe('unsupported');
    expect((await run((await byName('OpenCode - Own endpoint')).id)).status).toBe('ok');
  });

  it.each([
    ['testRejected', 'rejected'],
    ['testUnreachable', 'unreachable'],
    ['testInvalid', 'invalid'],
    ['testUnsupported', 'unsupported'],
  ] as const)('%s answers %s with the contract message and stores it', async (scenario, status) => {
    scenarios.agents(scenario);
    const claude = await byName('Claude - Personal');
    const answer = await run(claude.id);
    expect(answer.status).toBe(status);
    expect((await byName('Claude - Personal')).lastTest?.status).toBe(status);
  });
});

describe('agents.putCredential for OpenCode', () => {
  const put = async (name: string, body: unknown) => {
    const agent = await byName(name);
    return fetch(`${BASE}/api/agents/${agent.id}/credential`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  };
  const pointer = async (res: Response) => ((await res.json()) as { errors: { pointer: string }[] }).errors[0]?.pointer;

  it('422 /baseUrl for a credentials file with an address, and nothing is stored', async () => {
    scenarios.agents('perAgentModels');
    const before = (await byName('OpenCode - No sign-in')).credential;
    const res = await put('OpenCode - No sign-in', {
      type: 'auth_json',
      value: '{}',
      baseUrl: 'https://gw.example.com/v1',
    });
    expect(res.status).toBe(422);
    expect(await pointer(res)).toBe('/baseUrl');
    expect((await byName('OpenCode - No sign-in')).credential).toEqual(before);
  });

  it('422 /baseUrl for a key with no address sent and none saved', async () => {
    scenarios.agents('perAgentModels');
    const res = await put('OpenCode - No sign-in', { type: 'api_key', value: 'sk-x' });
    expect(res.status).toBe(422);
    expect(await pointer(res)).toBe('/baseUrl');
  });

  it('accepts a key with an address, and a key alone when an address is saved', async () => {
    scenarios.agents('perAgentModels');
    expect(
      (await put('OpenCode - No sign-in', { type: 'api_key', value: 'sk-x', baseUrl: 'https://gw.example.com/v1' }))
        .status,
    ).toBe(200);
    expect((await put('OpenCode - Own endpoint', { type: 'api_key', value: 'sk-y' })).status).toBe(200);
  });

  it.each(['not json', '[1,2]', '"text"', 'null'])('422 /value for a credentials file that is %s', async (value) => {
    scenarios.agents('perAgentModels');
    const res = await put('OpenCode - No sign-in', { type: 'auth_json', value });
    expect(res.status).toBe(422);
    expect(await pointer(res)).toBe('/value');
  });

  it('accepts a credentials file that is a JSON object', async () => {
    scenarios.agents('perAgentModels');
    expect((await put('OpenCode - No sign-in', { type: 'auth_json', value: '{"anthropic":{}}' })).status).toBe(200);
  });

  it('422 /type for a type the kind does not list', async () => {
    scenarios.agents('perAgentModels');
    const res = await put('Claude - New', { type: 'auth_json', value: '{}' });
    expect(res.status).toBe(422);
    expect(await pointer(res)).toBe('/type');
  });
});

describe('agents.models per agent', () => {
  it('opencodeEndpointModels lists the /models ids of the OpenCode endpoint agent', async () => {
    scenarios.agents('opencodeEndpointModels');
    const open = await byName('OpenCode - Own endpoint');
    const models = await api.agents.models({ params: { agentId: open.id } });
    expect(models).toMatchObject({ source: 'live', reason: null });
    expect(models.models.map((m) => m.id)).toContain('qwen3-coder');
  });

  it('perAgentModels gives two agents different lists', async () => {
    scenarios.agents('perAgentModels');
    const ids2 = await Promise.all(
      ['Claude - Personal', 'Codex'].map(async (n) =>
        (await api.agents.models({ params: { agentId: (await byName(n)).id } })).models.map((m) => m.id),
      ),
    );
    expect(ids2[0]).not.toEqual(ids2[1]);
  });
});

describe('projects', () => {
  it('projects.create still seeds the placeholder default agent', async () => {
    const used = new Set(mockDb.state.projects.map((p) => p.repoPath));
    const found = Object.entries(mockDb.state.repos)
      .flatMap(([connectionId, repos]) => repos.map((r) => ({ connectionId, repoPath: r.repoPath })))
      .find((r) => !used.has(r.repoPath));
    if (!found) throw new Error('no free repo fixture');
    const project = await api.projects.create({ body: { ...found, triggerMode: 'webhook' } });
    const page = await api.agents.list({ params: { projectId: project.id }, query: {} });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      name: 'Claude',
      provider: 'claude',
      isDefault: true,
      credential: { set: false },
    });
  });

  describe("orgs.checklist follows the created project's default agent (BR-64, BR-68)", () => {
    const steps = async (): Promise<Record<string, boolean>> => {
      const c = await api.orgs.checklist({ params: { orgId: ids.created(777) } });
      return Object.fromEntries(c.steps.map((s) => [s.key, s.done]));
    };
    const createProject = async () => {
      const used = new Set(mockDb.state.projects.map((p) => p.repoPath));
      const found = Object.entries(mockDb.state.repos)
        .flatMap(([connectionId, repos]) => repos.map((r) => ({ connectionId, repoPath: r.repoPath })))
        .find((r) => !used.has(r.repoPath));
      if (!found) throw new Error('no free repo fixture');
      return api.projects.create({ body: { ...found, triggerMode: 'webhook' } });
    };

    it('the credential-less placeholder is not done; a credential on the default makes it done', async () => {
      const project = await createProject();
      expect(await steps()).toMatchObject({ create_project: true, add_agent: false });
      const placeholder = (await api.agents.list({ params: { projectId: project.id }, query: {} })).items[0];
      if (!placeholder) throw new Error('no placeholder');
      await api.agents.putCredential({
        params: { agentId: placeholder.id },
        body: { type: 'oauth_token', value: 'sk-ant-oat01-x' },
      });
      expect(await steps()).toMatchObject({ add_agent: true });
    });

    it('a default OpenCode agent with no credential is done at once; a credential-less Codex default is not', async () => {
      const project = await createProject();
      const p = { projectId: project.id };
      const codex = await api.agents.create({ params: p, body: { provider: 'codex', name: 'Codex' } });
      await api.agents.setDefault({ params: { agentId: codex.id } });
      expect(await steps()).toMatchObject({ add_agent: false });
      const open = await api.agents.create({ params: p, body: { provider: 'opencode', name: 'OpenCode' } });
      await api.agents.setDefault({ params: { agentId: open.id } });
      expect(await steps()).toMatchObject({ add_agent: true });
    });
  });

  it('projects.update stores the five limits', async () => {
    const limits = {
      timeoutSeconds: 7200,
      pausedKeepSeconds: 7200,
      doneKeepSeconds: 0,
      idleEndSeconds: 600,
      autoResumeMax: 2,
    };
    const updated = await api.projects.update({ params, body: limits });
    expect(updated).toMatchObject(limits);
    await expect(api.projects.get({ params })).resolves.toMatchObject(limits);
  });

  it('a created agent starts with the limits the project stores', async () => {
    await api.projects.update({ params, body: { timeoutSeconds: 7200, autoResumeMax: 2 } });
    const created = await api.agents.create({ params, body: { provider: 'claude', name: 'Limits' } });
    expect(created).toMatchObject({ timeoutSeconds: 7200, autoResumeMax: 2 });
  });
});
