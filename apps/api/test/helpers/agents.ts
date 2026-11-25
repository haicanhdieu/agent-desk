import type { AgentDto, AgentKind, CreateAgentRequest } from '@agentdesk/contracts';
import type { TestApp } from './app';
import { expectContract } from './contract';

let seq = 0;

type Json = Record<string, unknown>;
const send = (t: TestApp, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, cookie: string, p?: Json) =>
  t.app.inject({ method, url, headers: { cookie }, ...(p === undefined ? {} : { payload: p }) });

/** Creates an agent through the real create route; the name is unique per call unless `overrides` sets one. */
export async function makeAgent(
  t: TestApp,
  cookie: string,
  projectId: string,
  overrides: Partial<CreateAgentRequest> = {},
): Promise<AgentDto> {
  seq += 1;
  const payload: CreateAgentRequest = { provider: 'claude', name: `Agent ${seq}`, ...overrides };
  const res = await send(t, 'POST', `/api/projects/${projectId}/agents`, cookie, payload);
  if (res.statusCode !== 201) throw new Error(`agent create failed: ${res.statusCode} ${res.body}`);
  return expectContract('agents.create', res) as AgentDto;
}

const listOf = async (t: TestApp, cookie: string, projectId: string): Promise<AgentDto[]> =>
  (
    expectContract('agents.list', await send(t, 'GET', `/api/projects/${projectId}/agents?pageSize=100`, cookie)) as {
      items: AgentDto[];
    }
  ).items;

/**
 * The wizard's swap through the real routes: create the agent of `provider`, make it the default, delete the old
 * default (the placeholder), then save a credential and test it. A provider that needs no credential
 * (`credentialOptional`) is left without one when `credential` is null. Returns the new default agent.
 */
export async function swapAgent(
  t: TestApp,
  cookie: string,
  projectId: string,
  provider: AgentKind,
  credential: { type: string; value: string; baseUrl?: string } | null = {
    type: 'api_key',
    value: 'swap-key-not-real',
  },
): Promise<AgentDto> {
  const before = await listOf(t, cookie, projectId);
  const old = before.find((a) => a.isDefault);
  const created = await makeAgent(t, cookie, projectId, { provider, name: `Swap ${provider}` });
  const made = await send(t, 'POST', `/api/agents/${created.id}/default`, cookie);
  if (made.statusCode !== 200) throw new Error(`set default failed: ${made.statusCode} ${made.body}`);
  if (old && old.id !== created.id) {
    const gone = await send(t, 'DELETE', `/api/agents/${old.id}`, cookie);
    if (gone.statusCode !== 204) throw new Error(`delete failed: ${gone.statusCode} ${gone.body}`);
  }
  if (credential !== null) {
    const saved = await send(t, 'PUT', `/api/agents/${created.id}/credential`, cookie, credential);
    if (saved.statusCode !== 200) throw new Error(`credential failed: ${saved.statusCode} ${saved.body}`);
  }
  const tested = await send(t, 'POST', `/api/agents/${created.id}/test`, cookie);
  if (tested.statusCode !== 200) throw new Error(`test failed: ${tested.statusCode} ${tested.body}`);
  const after = (await listOf(t, cookie, projectId)).find((a) => a.id === created.id);
  if (!after) throw new Error('swapped agent missing');
  return after;
}
