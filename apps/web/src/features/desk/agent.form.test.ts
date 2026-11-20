import type { AgentDto, ProjectDto } from '@agentdesk/contracts';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentFixtures } from '@/mocks/dto/agents';
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
  useReplaceCredential,
  useSaveAgent,
} from './agent.form';
import { deskQueries } from './queries';

const now = new Date('2026-11-12T14:14:00.000Z');

function fixture<T>(list: T[]): T {
  const first = list[0];
  if (!first) throw new Error('no fixture');
  return first;
}
const agent: AgentDto = fixture(agentFixtures);
const project: ProjectDto = fixture(projectFixtures);
const base = limitsOf(agent, project);

describe('limitsOf', () => {
  it('carries the agent automatic resume limit', () => {
    expect(limitsOf({ ...agent, autoResumeMax: 2 }, project).autoResumeMax).toBe(2);
  });
});

describe('toAgentSettings', () => {
  it('maps seconds to minutes and the credential to a relative "set at" and who set it', () => {
    expect(toAgentSettings(agent, project, now)).toEqual({
      agent: 'Claude',
      model: 'opus',
      baseUrl: '',
      credential: { type: 'oauth_token', setAt: '12 Oct', setBy: 'kim-hale' },
      timeoutMinutes: 30,
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

  it('the idle end comes from the agent, in minutes', () => {
    expect(limitsOf({ ...agent, idleEndSeconds: 5400 }, project).idleEndMinutes).toBe(90);
  });

  it('a changed idle end is sent in seconds, with the other changed limits', () => {
    const req = limitsRequests(base, { ...base, maxRunsPerTicket: 20, idleEndMinutes: 15 });
    expect(req).toEqual({ project: { maxRunsPerTicket: 20 }, idleEndSeconds: 900 });
    expect(hasLimitChanges(limitsRequests(base, { ...base, idleEndMinutes: 15 }))).toBe(true);
  });

  it('an unchanged idle end is not sent', () => {
    expect(limitsRequests(base, { ...base, idleEndMinutes: base.idleEndMinutes })).toEqual({});
  });

  it('a changed timeout is sent in seconds', () => {
    expect(limitsRequests(base, { ...base, timeoutMinutes: 60, maxConcurrent: 3 })).toEqual({
      project: { maxConcurrentRuns: 3 },
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
    void request
      .clone()
      .json()
      .then((b: unknown) => sent.push(b));
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

describe('useSaveAgent', () => {
  it('sends the model with the timeout and max turns from the fresh agent and no keep times (BR-8)', async () => {
    const row = mockDb.state.agents.find((a) => a.id === agentId);
    if (!row) throw new Error('no agent');
    row.maxTurns = 7;
    const sent = bodies();
    const { qc, wrapper } = withClient();
    const { result } = renderHook(() => useSaveAgent('alice', projectId), { wrapper });
    let ok = false;
    await act(async () => {
      ok = await result.current.save('claude-opus-4-5-20251101');
    });
    expect(ok).toBe(true);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ model: 'claude-opus-4-5-20251101', timeoutSeconds: row.timeoutSeconds, maxTurns: 7 });
    expect(qc.getQueryData(deskQueries.agent('alice', projectId).queryKey)?.model).toBe('claude-opus-4-5-20251101');
  });

  it('omits maxTurns when the agent has none', async () => {
    const row = mockDb.state.agents.find((a) => a.id === agentId);
    if (!row) throw new Error('no agent');
    row.maxTurns = null;
    const sent = bodies();
    const { wrapper } = withClient();
    const { result } = renderHook(() => useSaveAgent('alice', projectId), { wrapper });
    await act(async () => {
      await result.current.save('sonnet');
    });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ model: 'sonnet', timeoutSeconds: row.timeoutSeconds });
  });

  it('maps a /model problem to error', async () => {
    scenarios.problem('agents.put', {
      status: 400,
      title: 'Validation failed',
      type: 'validation',
      errors: [{ pointer: '/model', detail: 'Use 1 to 200 letters.' }],
    });
    const { wrapper } = withClient();
    const { result } = renderHook(() => useSaveAgent('alice', projectId), { wrapper });
    let ok = true;
    await act(async () => {
      ok = await result.current.save('bad name');
    });
    expect(ok).toBe(false);
    expect(result.current.error).toBe('Use 1 to 200 letters.');
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
