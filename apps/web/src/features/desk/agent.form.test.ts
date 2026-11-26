import { AGENT_TEST_MESSAGES, type AgentDto, type ProjectDto } from '@agentdesk/contracts';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentPaneValues } from '@/components';
import { agentPaneAgent } from '@/mocks/agent';
import { agentFixtures, agentsFixture } from '@/mocks/dto/agents';
import type { AgentPaneAgent } from '@/mocks/types';
import { ids } from '@/mocks/dto/ids';
import { projectFixtures } from '@/mocks/dto/projects';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import {
  hasLimitChanges,
  limitsOf,
  limitsRequests,
  REFRESH_ERROR,
  toAgentSettings,
  useDeleteAgent,
  useReplaceCredential,
  useSaveLimits,
  useSaveAgent,
  useSetDefaultAgent,
  useTestAgent,
  type AddResult,
  type EditResult,
} from './agent.form';
import { projectsQueries } from '../projects/queries';
import { checklistKey } from '../onboarding/checklist';
import { agentsKey, deskQueries, rulesKey } from './queries';

const now = new Date('2026-11-12T14:14:00.000Z');

function fixture<T>(list: T[]): T {
  const first = list[0];
  if (!first) throw new Error('no fixture');
  return first;
}
const agent: AgentDto = fixture(agentFixtures);
const project: ProjectDto = fixture(projectFixtures);
const base = limitsOf(project);

describe('limitsOf', () => {
  it('reads every limit from the project, not the agent', () => {
    expect(limitsOf({ ...project, autoResumeMax: 2 }).autoResumeMax).toBe(2);
    expect(limitsOf({ ...project, timeoutSeconds: 7200 }).timeoutMinutes).toBe(120);
    expect(limitsOf(project).timeoutMinutes).toBe(Math.round(project.timeoutSeconds / 60));
  });
});

describe('toAgentSettings', () => {
  it('maps seconds to minutes and the credential to a relative "set at" and who set it', () => {
    expect(toAgentSettings(agent, project, now)).toEqual({
      agent: 'Claude',
      model: 'opus',
      baseUrl: '',
      credential: { type: 'oauth_token', setAt: '12 Oct', setBy: 'kim-hale' },
      timeoutMinutes: 1440,
      pausedKeepMinutes: 10080,
      doneKeepMinutes: 1440,
      idleEndMinutes: 30,
      maxConcurrent: 2,
      maxRunsPerTicket: 10,
      autoResumeMax: 5,
    });
  });

  it('a custom address maps through; none maps to the empty string', () => {
    expect(toAgentSettings({ ...agent, baseUrl: 'https://gw.example.com/a' }, project, now).baseUrl).toBe(
      'https://gw.example.com/a',
    );
  });

  it('no credential yet: empty set-at and set-by', () => {
    const unset = { ...agent, credential: { set: false, type: null, updatedAt: null, setBy: null } };
    expect(toAgentSettings(unset, project, now).credential).toEqual({ type: 'oauth_token', setAt: '', setBy: '' });
  });
});

describe('limitsRequests', () => {
  it('nothing changed → nothing to send', () => {
    expect(limitsRequests(base, { ...base })).toEqual({});
    expect(hasLimitChanges(limitsRequests(base, { ...base }))).toBe(false);
  });

  it('the idle end comes from the project, in minutes', () => {
    expect(limitsOf({ ...project, idleEndSeconds: 5400 }).idleEndMinutes).toBe(90);
  });

  it('a changed idle end is sent in seconds, with the other changed limits', () => {
    const req = limitsRequests(base, { ...base, maxRunsPerTicket: 20, idleEndMinutes: 15 });
    expect(req).toEqual({ maxRunsPerTicket: 20, idleEndSeconds: 900 });
    expect(hasLimitChanges(limitsRequests(base, { ...base, idleEndMinutes: 15 }))).toBe(true);
  });

  it('an unchanged idle end is not sent', () => {
    expect(limitsRequests(base, { ...base, idleEndMinutes: base.idleEndMinutes })).toEqual({});
  });

  it('a changed timeout is sent in seconds', () => {
    expect(limitsRequests(base, { ...base, timeoutMinutes: 60, maxConcurrent: 3 })).toEqual({
      maxConcurrentRuns: 3,
      timeoutSeconds: 3600,
    });
  });
});

describe('limitsRequests automatic resumes', () => {
  it('a changed value is sent as is', () => {
    expect(limitsRequests(base, { ...base, autoResumeMax: 2 })).toEqual({ autoResumeMax: 2 });
  });

  it('an unchanged value sends nothing', () => {
    expect(limitsRequests(base, { ...base, autoResumeMax: base.autoResumeMax })).toEqual({});
  });

  it('0 (off) counts as a change', () => {
    expect(hasLimitChanges({ autoResumeMax: 0 })).toBe(true);
  });
});

describe('limitsRequests keep times', () => {
  it('a changed paused keep time is sent in seconds', () => {
    expect(limitsRequests(base, { ...base, pausedKeepMinutes: 3 * 1440 })).toEqual({ pausedKeepSeconds: 259200 });
  });

  it('a finished-run keep time of 0 is sent as 0 (no session kept)', () => {
    expect(limitsRequests(base, { ...base, doneKeepMinutes: 0 })).toEqual({ doneKeepSeconds: 0 });
    expect(hasLimitChanges(limitsRequests(base, { ...base, doneKeepMinutes: 0 }))).toBe(true);
  });
});

const projectId = ids.project.invoicerApi;
const agentId = ids.agent.invoicerApi;
const modelsKey = deskQueries.agentModels('alice', agentId).queryKey;
const secret = 'sk-ant-oat01-hook-secret-0123456789';

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
});

/** The JSON bodies of the writes the hooks send. */
function bodies() {
  const sent: unknown[] = [];
  const listener = ({ request }: { request: Request }) => {
    if (request.method === 'GET') return;
    // Bodyless writes (test, set default, delete) are not recorded.
    void request
      .clone()
      .text()
      .then((t) => {
        if (t !== '') sent.push(JSON.parse(t) as unknown);
      });
  };
  server.events.on('request:start', listener);
  stop = () => server.events.removeListener('request:start', listener);
  return sent;
}

function withClient() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  return { qc, wrapper };
}

/** The query keys the client was asked to invalidate. */
function recordInvalidations(qc: QueryClient) {
  const keys: unknown[] = [];
  const original = qc.invalidateQueries.bind(qc);
  qc.invalidateQueries = (filters, options) => {
    keys.push(filters?.queryKey);
    return original(filters, options);
  };
  return keys;
}

const noValues = {
  accountLabel: '',
  model: '',
  maxTurns: null,
  makeDefault: false,
  credential: null,
} as const;

/** The method and path of every request the hooks send, in order, GETs left out. */
function requestLog() {
  const sent: string[] = [];
  const listener = ({ request }: { request: Request }) => {
    if (request.method === 'GET') return;
    sent.push(`${request.method} ${new URL(request.url).pathname.replace(/[0-9a-f-]{36}/g, ':id')}`);
  };
  server.events.on('request:start', listener);
  stop = () => server.events.removeListener('request:start', listener);
  return sent;
}

const projectAgents = () => mockDb.state.agents.filter((a) => a.projectId === projectId);
const paneAgent = (name: string) => {
  const found = agentsFixture.find((a) => a.name === name);
  if (!found) throw new Error(`no fixture ${name}`);
  return agentPaneAgent(found);
};
const editValues = (saved: AgentPaneAgent, over: Partial<AgentPaneValues> = {}): AgentPaneValues => ({
  provider: saved.provider,
  name: saved.name,
  accountLabel: saved.accountLabel,
  model: saved.model,
  maxTurns: null,
  makeDefault: false,
  credential: null,
  ...over,
});

describe('useSaveAgent add', () => {
  it('creates with the model, saves the credential, then tests: three calls, no PATCH (BR-6)', async () => {
    const sent = requestLog();
    const bodiesSent = bodies();
    const { wrapper } = withClient();
    const { result } = renderHook(() => useSaveAgent('alice', projectId), { wrapper });
    let outcome: AddResult | undefined;
    await act(async () => {
      outcome = await result.current.add({
        ...noValues,
        provider: 'claude',
        name: 'Claude - Work',
        accountLabel: 'Work',
        model: 'claude-sonnet-4-5',
        credential: { type: 'api_key', value: secret },
      });
    });
    expect(sent).toEqual([
      'POST /api/projects/:id/agents',
      'PUT /api/agents/:id/credential',
      'POST /api/agents/:id/test',
    ]);
    await vi.waitFor(() => expect(bodiesSent).toHaveLength(2));
    expect(bodiesSent[0]).toEqual({
      provider: 'claude',
      name: 'Claude - Work',
      accountLabel: 'Work',
      model: 'claude-sonnet-4-5',
    });
    expect(bodiesSent[1]).toEqual({ type: 'api_key', value: secret });
    expect(outcome?.ok).toBe(true);
    expect(outcome?.steps).toEqual({ create: 'done', credential: 'done', test: 'done', setDefault: 'skipped' });
    expect(projectAgents().find((a) => a.name === 'Claude - Work')?.model).toBe('claude-sonnet-4-5');
  });

  it('an OpenCode add with nothing picked sends the create only, without model or label (BR-68)', async () => {
    const sent = requestLog();
    const bodiesSent = bodies();
    const { wrapper } = withClient();
    const { result } = renderHook(() => useSaveAgent('alice', projectId), { wrapper });
    let outcome: AddResult | undefined;
    await act(async () => {
      outcome = await result.current.add({ ...noValues, provider: 'opencode', name: 'OpenCode' });
    });
    expect(sent).toEqual(['POST /api/projects/:id/agents']);
    await vi.waitFor(() => expect(bodiesSent).toHaveLength(1));
    expect(bodiesSent[0]).toEqual({ provider: 'opencode', name: 'OpenCode' });
    expect(outcome?.steps).toEqual({ create: 'done', credential: 'skipped', test: 'skipped', setDefault: 'skipped' });
  });

  it('a credentials file never sends baseUrl', async () => {
    const bodiesSent = bodies();
    const { wrapper } = withClient();
    const { result } = renderHook(() => useSaveAgent('alice', projectId), { wrapper });
    await act(async () => {
      await result.current.add({
        ...noValues,
        provider: 'opencode',
        name: 'OpenCode - File',
        credential: { type: 'auth_json', value: '{"a":1}', baseUrl: 'https://llm.example.com/v1' },
      });
    });
    await vi.waitFor(() => expect(bodiesSent).toHaveLength(2));
    expect(bodiesSent[1]).toEqual({ type: 'auth_json', value: '{"a":1}' });
  });

  it('an endpoint and key are sent together', async () => {
    const bodiesSent = bodies();
    const { wrapper } = withClient();
    const { result } = renderHook(() => useSaveAgent('alice', projectId), { wrapper });
    await act(async () => {
      await result.current.add({
        ...noValues,
        provider: 'opencode',
        name: 'OpenCode - Endpoint',
        model: 'qwen3-coder',
        credential: { type: 'api_key', value: secret, baseUrl: 'https://llm.example.com/v1' },
      });
    });
    await vi.waitFor(() => expect(bodiesSent).toHaveLength(2));
    expect(bodiesSent[1]).toEqual({ type: 'api_key', value: secret, baseUrl: 'https://llm.example.com/v1' });
  });

  it('calls set-default after the test when it is ticked', async () => {
    const sent = requestLog();
    const { wrapper } = withClient();
    const { result } = renderHook(() => useSaveAgent('alice', projectId), { wrapper });
    await act(async () => {
      await result.current.add({
        ...noValues,
        provider: 'claude',
        name: 'Claude - Default',
        model: 'opus',
        makeDefault: true,
        credential: { type: 'oauth_token', value: secret },
      });
    });
    expect(sent.at(-1)).toBe('POST /api/agents/:id/default');
    expect(
      projectAgents()
        .filter((a) => a.isDefault)
        .map((a) => a.name),
    ).toEqual(['Claude - Default']);
  });

  it('a failed test is not an error: the agent and credential stay saved (BR-21)', async () => {
    scenarios.agents('testRejected');
    const { wrapper } = withClient();
    const { result } = renderHook(() => useSaveAgent('alice', projectId), { wrapper });
    let outcome: AddResult | undefined;
    await act(async () => {
      outcome = await result.current.add({
        ...noValues,
        provider: 'claude',
        name: 'Claude - Bad',
        model: 'opus',
        credential: { type: 'oauth_token', value: secret },
      });
    });
    expect(outcome?.ok).toBe(true);
    expect(outcome?.steps.test).toBe('done');
    expect(projectAgents().find((a) => a.name === 'Claude - Bad')?.lastTest?.status).toBe('rejected');
  });

  it('create worked and the credential failed: a partial result with the new id; the secret is kept nowhere (BR-12)', async () => {
    scenarios.problem('agents.putCredential', {
      status: 400,
      title: 'Validation failed',
      type: 'validation',
      errors: [{ pointer: '/value', detail: 'The token was rejected.' }],
    });
    const { qc, wrapper } = withClient();
    const { result } = renderHook(() => useSaveAgent('alice', projectId), { wrapper });
    let outcome: AddResult | undefined;
    await act(async () => {
      outcome = await result.current.add({
        ...noValues,
        provider: 'claude',
        name: 'Claude - Half',
        model: 'opus',
        makeDefault: true,
        credential: { type: 'oauth_token', value: secret, baseUrl: 'https://llm.example.com' },
      });
    });
    const created = projectAgents().find((a) => a.name === 'Claude - Half');
    expect(outcome?.ok).toBe(false);
    expect(outcome?.agentId).toBe(created?.id);
    expect(outcome?.steps).toEqual({ create: 'done', credential: 'failed', test: 'skipped', setDefault: 'skipped' });
    expect(result.current.partial).toMatchObject({ agentId: created?.id, reason: 'The token was rejected.' });
    expect(result.current.partial?.requestId).toMatch(/^req-/);
    // The non-secret draft is kept for the Edit pane; the secret is not part of it.
    expect(result.current.partial?.draft).toEqual({
      makeDefault: true,
      authType: 'oauth_token',
      address: 'https://llm.example.com',
    });
    expect(JSON.stringify(result.current.partial)).not.toContain(secret);
    expect(result.current.saving).toBe(false);
    expect(
      JSON.stringify(
        qc
          .getMutationCache()
          .getAll()
          .map((m) => m.state),
      ),
    ).not.toContain(secret);
    expect(
      JSON.stringify(
        qc
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data),
      ),
    ).not.toContain(secret);
  });

  it('a 256-character name is accepted; 257 shows the field error and sends nothing (BR-8)', async () => {
    const sent = requestLog();
    const { wrapper } = withClient();
    const { result } = renderHook(() => useSaveAgent('alice', projectId), { wrapper });
    let outcome: AddResult | undefined;
    await act(async () => {
      outcome = await result.current.add({ ...noValues, provider: 'opencode', name: 'n'.repeat(257) });
    });
    expect(outcome?.ok).toBe(false);
    expect(outcome?.steps.create).toBe('failed');
    expect(result.current.fieldErrors.name).toBe('Use 256 characters or fewer.');
    expect(sent).toEqual([]);
    await act(async () => {
      outcome = await result.current.add({ ...noValues, provider: 'opencode', name: 'n'.repeat(256) });
    });
    expect(outcome?.ok).toBe(true);
    expect(result.current.fieldErrors).toEqual({});
  });

  it('a duplicate name maps to the name field and nothing else is sent (BR-9)', async () => {
    const sent = requestLog();
    const { wrapper } = withClient();
    const { result } = renderHook(() => useSaveAgent('alice', projectId), { wrapper });
    await act(async () => {
      await result.current.add({
        ...noValues,
        provider: 'claude',
        name: 'claude',
        model: 'opus',
        credential: { type: 'oauth_token', value: secret },
      });
    });
    expect(result.current.fieldErrors.name).toBe('An agent with this name already exists.');
    expect(sent).toEqual(['POST /api/projects/:id/agents']);
    expect(result.current.partial).toBeUndefined();
  });

  it('invalidates the agent lists, the rules lists and the checklist after a create', async () => {
    const { qc, wrapper } = withClient();
    const keys = recordInvalidations(qc);
    const { result } = renderHook(() => useSaveAgent('alice', projectId), { wrapper });
    await act(async () => {
      await result.current.add({ ...noValues, provider: 'opencode', name: 'OpenCode' });
    });
    expect(keys).toContainEqual(agentsKey('alice', projectId));
    expect(keys).toContainEqual(rulesKey('alice', projectId));
    expect(keys).toContainEqual(checklistKey('alice'));
  });
});

describe('useSaveAgent edit', () => {
  it('sends one PATCH with only the changed fields (BR-6)', async () => {
    scenarios.agents('perAgentModels');
    const sent = requestLog();
    const bodiesSent = bodies();
    const { wrapper } = withClient();
    const { result } = renderHook(() => useSaveAgent('alice', projectId), { wrapper });
    const saved = paneAgent('Claude - Personal');
    let outcome: EditResult | undefined;
    await act(async () => {
      outcome = await result.current.edit(saved, editValues(saved, { model: 'claude-sonnet-4-5' }));
    });
    expect(sent).toEqual(['PATCH /api/agents/:id']);
    await vi.waitFor(() => expect(bodiesSent).toHaveLength(1));
    expect(bodiesSent[0]).toEqual({ model: 'claude-sonnet-4-5' });
    expect(outcome).toEqual({ ok: true, defaultChanged: false });
  });

  it('nothing changed: nothing is sent', async () => {
    scenarios.agents('perAgentModels');
    const sent = requestLog();
    const { wrapper } = withClient();
    const { result } = renderHook(() => useSaveAgent('alice', projectId), { wrapper });
    const saved = paneAgent('Claude - Work');
    let outcome: EditResult | undefined;
    await act(async () => {
      outcome = await result.current.edit(saved, editValues(saved));
    });
    expect(sent).toEqual([]);
    expect(outcome?.ok).toBe(true);
  });

  it('clearing the label sends null; a max turns number is sent as a number', async () => {
    scenarios.agents('perAgentModels');
    const bodiesSent = bodies();
    const { wrapper } = withClient();
    const { result } = renderHook(() => useSaveAgent('alice', projectId), { wrapper });
    const saved = paneAgent('Claude - Work');
    await act(async () => {
      await result.current.edit(saved, editValues(saved, { accountLabel: '', maxTurns: 40 }));
    });
    await vi.waitFor(() => expect(bodiesSent).toHaveLength(1));
    expect(bodiesSent[0]).toEqual({ accountLabel: null, maxTurns: 40 });
  });

  it('ticking the default sends set-default after the PATCH and reports it (BR-24)', async () => {
    scenarios.agents('perAgentModels');
    const sent = requestLog();
    const { wrapper } = withClient();
    const { result } = renderHook(() => useSaveAgent('alice', projectId), { wrapper });
    const saved = paneAgent('Claude - Work');
    let outcome: EditResult | undefined;
    await act(async () => {
      outcome = await result.current.edit(saved, editValues(saved, { name: 'Claude - Work 2', makeDefault: true }));
    });
    expect(sent).toEqual(['PATCH /api/agents/:id', 'POST /api/agents/:id/default']);
    expect(outcome).toEqual({ ok: true, defaultChanged: true });
  });

  it('maps a duplicate name to the name field and a /model problem to the model field', async () => {
    scenarios.agents('perAgentModels');
    const { wrapper } = withClient();
    const { result } = renderHook(() => useSaveAgent('alice', projectId), { wrapper });
    const saved = paneAgent('Claude - Work');
    await act(async () => {
      await result.current.edit(saved, editValues(saved, { name: 'codex' }));
    });
    expect(result.current.fieldErrors.name).toBe('An agent with this name already exists.');
    scenarios.problem('agents.update', {
      status: 400,
      title: 'Validation failed',
      type: 'validation',
      errors: [{ pointer: '/model', detail: 'Use 1 to 200 letters.' }],
    });
    let outcome: EditResult | undefined;
    await act(async () => {
      outcome = await result.current.edit(saved, editValues(saved, { model: 'gw/model-x' }));
    });
    expect(outcome?.ok).toBe(false);
    expect(result.current.fieldErrors).toEqual({ model: 'Use 1 to 200 letters.' });
  });

  it('a 257-character name is refused before any request', async () => {
    scenarios.agents('perAgentModels');
    const sent = requestLog();
    const { wrapper } = withClient();
    const { result } = renderHook(() => useSaveAgent('alice', projectId), { wrapper });
    const saved = paneAgent('Claude - Work');
    await act(async () => {
      await result.current.edit(saved, editValues(saved, { name: 'n'.repeat(257) }));
    });
    expect(result.current.fieldErrors.name).toBe('Use 256 characters or fewer.');
    expect(sent).toEqual([]);
  });
});

describe('useDeleteAgent, useSetDefaultAgent and useTestAgent', () => {
  it('delete removes the agent, drops its models key and refreshes the lists and the rules', async () => {
    scenarios.agents('perAgentModels');
    const target = projectAgents().find((a) => a.name === 'OpenCode - No sign-in');
    if (!target) throw new Error('no target');
    const { qc, wrapper } = withClient();
    qc.setQueryData(deskQueries.agentModels('alice', target.id).queryKey, { source: 'live', reason: null, models: [] });
    const keys = recordInvalidations(qc);
    const { result } = renderHook(() => useDeleteAgent('alice', projectId), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(target.id);
    });
    expect(projectAgents().some((a) => a.id === target.id)).toBe(false);
    expect(qc.getQueryData(deskQueries.agentModels('alice', target.id).queryKey)).toBeUndefined();
    expect(keys).toContainEqual(agentsKey('alice', projectId));
    expect(keys).toContainEqual(rulesKey('alice', projectId));
  });

  it('a delete refused by a rule keeps the agent and rejects with the 409', async () => {
    scenarios.agents('deleteBlocked');
    const target = projectAgents().find((a) => a.name === 'Claude - Work');
    if (!target) throw new Error('no target');
    const { wrapper } = withClient();
    const { result } = renderHook(() => useDeleteAgent('alice', projectId), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(target.id)).rejects.toMatchObject({ status: 409 });
    });
    expect(projectAgents().some((a) => a.id === target.id)).toBe(true);
  });

  it('set default moves the default and refreshes the lists', async () => {
    scenarios.agents('perAgentModels');
    const target = projectAgents().find((a) => a.name === 'Codex');
    if (!target) throw new Error('no target');
    const { qc, wrapper } = withClient();
    const keys = recordInvalidations(qc);
    const { result } = renderHook(() => useSetDefaultAgent('alice', projectId), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(target.id);
    });
    expect(
      projectAgents()
        .filter((a) => a.isDefault)
        .map((a) => a.name),
    ).toEqual(['Codex']);
    expect(keys).toContainEqual(agentsKey('alice', projectId));
  });

  it('test returns the status and the fixed message and refreshes the lists', async () => {
    scenarios.agents('testRejected');
    const target = projectAgents().find((a) => a.name === 'Claude - Personal');
    if (!target) throw new Error('no target');
    const { qc, wrapper } = withClient();
    const keys = recordInvalidations(qc);
    const { result } = renderHook(() => useTestAgent('alice', projectId), { wrapper });
    let answer: { status: string; message: string } | undefined;
    await act(async () => {
      answer = await result.current.mutateAsync(target.id);
    });
    expect(answer).toMatchObject({ status: 'rejected', message: AGENT_TEST_MESSAGES.rejected });
    expect(keys).toContainEqual(agentsKey('alice', projectId));
  });
});

describe('useReplaceCredential', () => {
  it('sends baseUrl only when given, and null to clear', async () => {
    const sent = bodies();
    const { wrapper } = withClient();
    const { result } = renderHook(() => useReplaceCredential('alice', projectId, agentId), { wrapper });
    await act(async () => {
      await result.current.replace('api_key', secret);
      await result.current.replace('api_key', secret, 'https://gw.example.com/a');
      await result.current.replace('api_key', secret, null);
    });
    await vi.waitFor(() => expect(sent).toHaveLength(3));
    expect(sent).toEqual([
      { type: 'api_key', value: secret },
      { type: 'api_key', value: secret, baseUrl: 'https://gw.example.com/a' },
      { type: 'api_key', value: secret, baseUrl: null },
    ]);
  });

  it('invalidates the agent and the model list after a success', async () => {
    const { qc, wrapper } = withClient();
    const keys = recordInvalidations(qc);
    const { result } = renderHook(() => useReplaceCredential('alice', projectId, agentId), { wrapper });
    await act(async () => {
      await result.current.replace('api_key', secret);
    });
    expect(keys).toContainEqual(modelsKey);
    expect(keys).toContainEqual(deskQueries.agent('alice', projectId).queryKey);
  });

  it('maps a /baseUrl problem to addressError and still refetches the agent and the model list (BR-16)', async () => {
    scenarios.problem('agents.putCredential', {
      status: 400,
      title: 'Validation failed',
      type: 'validation',
      errors: [{ pointer: '/baseUrl', detail: 'Use a public https address.' }],
    });
    const { qc, wrapper } = withClient();
    const keys = recordInvalidations(qc);
    const { result } = renderHook(() => useReplaceCredential('alice', projectId, agentId), { wrapper });
    let ok = true;
    await act(async () => {
      ok = await result.current.replace('api_key', secret, 'http://x');
    });
    expect(ok).toBe(false);
    expect(result.current.addressError).toBe('Use a public https address.');
    expect(result.current.error).toBeUndefined();
    expect(keys).toContainEqual(modelsKey);
    expect(keys).toContainEqual(deskQueries.agent('alice', projectId).queryKey);
  });

  it('resolves only after the agent is refetched, and pending clears after that', async () => {
    const address = 'https://gw.example.com/a';
    const { qc, wrapper } = withClient();
    const { result } = renderHook(
      () => ({
        agent: useQuery(deskQueries.agent('alice', projectId)),
        credential: useReplaceCredential('alice', projectId, agentId),
      }),
      { wrapper },
    );
    await vi.waitFor(() => expect(result.current.agent.data).toBeDefined());
    let seenAtResolve: string | null | undefined;
    await act(async () => {
      await result.current.credential.replace('api_key', secret, address);
      seenAtResolve = qc.getQueryData(deskQueries.agent('alice', projectId).queryKey)?.baseUrl;
    });
    expect(seenAtResolve).toBe(address);
    expect(result.current.credential.pending).toBe(false);
  });

  it('shows a refresh error when the agent cannot be refetched after a failed write (BR-16)', async () => {
    scenarios.problem('agents.putCredential', {
      status: 400,
      title: 'Validation failed',
      type: 'validation',
      errors: [{ pointer: '/value', detail: 'The token was rejected.' }],
    });
    const { wrapper } = withClient();
    const { result } = renderHook(
      () => ({
        agent: useQuery(deskQueries.agent('alice', projectId)),
        credential: useReplaceCredential('alice', projectId, agentId),
      }),
      { wrapper },
    );
    await vi.waitFor(() => expect(result.current.agent.data).toBeDefined());
    scenarios.serverError('agents.get');
    await act(async () => {
      await result.current.credential.replace('api_key', secret, 'https://gw.example.com/a');
    });
    expect(result.current.credential.error).toBe(`The token was rejected. ${REFRESH_ERROR}`);
  });

  it('a refetch failure after a saved credential keeps the panel open with the refresh error', async () => {
    const { wrapper } = withClient();
    const { result } = renderHook(
      () => ({
        agent: useQuery(deskQueries.agent('alice', projectId)),
        credential: useReplaceCredential('alice', projectId, agentId),
      }),
      { wrapper },
    );
    await vi.waitFor(() => expect(result.current.agent.data).toBeDefined());
    scenarios.serverError('agents.get');
    let ok = true;
    await act(async () => {
      ok = await result.current.credential.replace('api_key', secret);
    });
    expect(ok).toBe(false);
    expect(result.current.credential.error).toBe(REFRESH_ERROR);
  });

  it('clears error and addressError on the next attempt', async () => {
    scenarios.problem('agents.putCredential', {
      status: 400,
      title: 'Validation failed',
      type: 'validation',
      errors: [
        { pointer: '/value', detail: 'Bad token.' },
        { pointer: '/baseUrl', detail: 'Bad address.' },
      ],
    });
    const { wrapper } = withClient();
    const { result } = renderHook(() => useReplaceCredential('alice', projectId, agentId), { wrapper });
    await act(async () => {
      await result.current.replace('api_key', secret, 'http://x');
    });
    expect(result.current.error).toBe('Bad token.');
    expect(result.current.addressError).toBe('Bad address.');
    server.resetHandlers();
    await act(async () => {
      await result.current.replace('api_key', secret);
    });
    expect(result.current.error).toBeUndefined();
    expect(result.current.addressError).toBeUndefined();
  });
});

describe('useSaveLimits (project-wide)', () => {
  it('sends the changed limits in one projects.update and no agent request', async () => {
    const sent = bodies();
    const { qc, wrapper } = withClient();
    const onSaved = vi.fn();
    const { result } = renderHook(() => useSaveLimits('alice', projectId, base, { onSaved }), { wrapper });
    await act(() => result.current.save({ ...base, timeoutMinutes: 60, maxConcurrent: 3, autoResumeMax: 2 }));
    await vi.waitFor(() => expect(sent.length).toBe(1));
    expect(sent).toEqual([{ timeoutSeconds: 3600, maxConcurrentRuns: 3, autoResumeMax: 2 }]);
    expect(onSaved).toHaveBeenCalledOnce();
    expect(qc.getQueryData(projectsQueries.detail('alice', projectId).queryKey)).toMatchObject({
      timeoutSeconds: 3600,
      maxConcurrentRuns: 3,
    });
  });

  it('a refused limit puts the problem message on its field and does not call onSaved', async () => {
    const { wrapper } = withClient();
    const onSaved = vi.fn();
    const { result } = renderHook(() => useSaveLimits('alice', projectId, base, { onSaved }), { wrapper });
    await act(() => result.current.save({ ...base, timeoutMinutes: 8 * 1440 }));
    expect(result.current.errors.timeoutMinutes).toMatch(/7 days/);
    expect(onSaved).not.toHaveBeenCalled();
  });
});
