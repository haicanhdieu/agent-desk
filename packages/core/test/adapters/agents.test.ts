import { MockAgent } from 'undici';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentModelsError, agentAdapterFor, type AgentAdapter } from '../../src';
import { LIST_TIMEOUT_MS } from '../../src/adapters/agents/claude';
import { guardedGetJson } from '../../src/net/guarded-http';

const GW = 'https://gw.example.com';
const KEY = { type: 'api_key', value: 'sk-secret-key-123' } as const;
const OAUTH = { type: 'oauth_token', value: 'oauth-secret-456' } as const;

describe('claude agent adapter', () => {
  const agents: MockAgent[] = [];
  function setup(): { mock: MockAgent; adapter: AgentAdapter } {
    const mock = new MockAgent();
    mock.disableNetConnect();
    agents.push(mock);
    const adapter = agentAdapterFor('claude', {
      http: (u, h) => guardedGetJson(u, { headers: h, dispatcher: mock }),
    });
    return { mock, adapter };
  }
  afterEach(async () => {
    await Promise.all(agents.splice(0).map((a) => a.close()));
  });

  const json = { headers: { 'content-type': 'application/json' } };

  it('sends x-api-key and anthropic-version for an API key', async () => {
    const { mock, adapter } = setup();
    let seen: Record<string, unknown> = {};
    mock
      .get(GW)
      .intercept({ path: '/v1/models?limit=1000', method: 'GET' })
      .reply(
        200,
        (opts) => {
          seen = { ...Object.fromEntries(Object.entries(opts.headers ?? {})) };
          return { data: [{ id: 'm-1' }] };
        },
        json,
      );
    await adapter.listModels({ credential: KEY, baseUrl: GW });
    expect(seen['x-api-key']).toBe(KEY.value);
    expect(seen['anthropic-version']).toBe('2023-06-01');
    expect(seen['authorization']).toBeUndefined();
  });

  it('sends a Bearer token and the oauth beta header for an OAuth token, and no x-api-key', async () => {
    const { mock, adapter } = setup();
    let seen: Record<string, unknown> = {};
    mock
      .get(GW)
      .intercept({ path: '/v1/models?limit=1000', method: 'GET' })
      .reply(
        200,
        (opts) => {
          seen = { ...Object.fromEntries(Object.entries(opts.headers ?? {})) };
          return { data: [{ id: 'm-1' }] };
        },
        json,
      );
    await adapter.listModels({ credential: OAUTH, baseUrl: GW });
    expect(seen['authorization']).toBe(`Bearer ${OAUTH.value}`);
    expect(seen['anthropic-beta']).toBe('oauth-2025-04-20');
    expect(seen['anthropic-version']).toBe('2023-06-01');
    expect(seen['x-api-key']).toBeUndefined();
  });

  it('lists in the provider order, labels with display_name, and drops duplicates', async () => {
    const { mock, adapter } = setup();
    mock
      .get(GW)
      .intercept({ path: '/v1/models?limit=1000', method: 'GET' })
      .reply(
        200,
        { data: [{ id: 'm-5', display_name: 'Model Five' }, { id: 'm-1' }, { id: 'm-5' }, { id: 'm-4' }] },
        json,
      );
    const models = await adapter.listModels({ credential: KEY, baseUrl: GW });
    expect(models.map((m) => m.id)).toEqual(['m-5', 'm-1', 'm-4']);
    expect(models.map((m) => m.label)).toEqual(['Model Five', 'm-1', 'm-4']);
  });

  it('follows has_more and last_id for at most five pages', async () => {
    const { mock, adapter } = setup();
    const pool = mock.get(GW);
    const paths: string[] = [];
    for (let i = 1; i <= 6; i++) {
      pool
        .intercept({
          path: i === 1 ? '/v1/models?limit=1000' : `/v1/models?limit=1000&after_id=p${i - 1}`,
          method: 'GET',
        })
        .reply(
          200,
          (opts) => {
            paths.push(opts.path);
            return { data: [{ id: `p${i}` }], has_more: true, last_id: `p${i}` };
          },
          json,
        );
    }
    const models = await adapter.listModels({ credential: KEY, baseUrl: GW });
    expect(paths).toHaveLength(5);
    expect(paths[0]).toBe('/v1/models?limit=1000');
    expect(paths[1]).toBe('/v1/models?limit=1000&after_id=p1');
    expect(models.map((m) => m.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
  });

  it('accepts the OpenAI-style gateway body { data: [{ id }] }', async () => {
    const { mock, adapter } = setup();
    mock
      .get(GW)
      .intercept({ path: '/v1/models?limit=1000', method: 'GET' })
      .reply(200, { object: 'list', data: [{ id: 'gpt-x', object: 'model' }] }, json);
    expect(await adapter.listModels({ credential: KEY, baseUrl: GW })).toEqual([{ id: 'gpt-x', label: 'gpt-x' }]);
  });

  it('appends to the address path: https://gw.example.com/anthropic/ → /anthropic/v1/models', async () => {
    const { mock, adapter } = setup();
    mock
      .get(GW)
      .intercept({ path: '/anthropic/v1/models?limit=1000', method: 'GET' })
      .reply(200, { data: [{ id: 'm-1' }] }, json);
    const models = await adapter.listModels({ credential: KEY, baseUrl: `${GW}/anthropic/` });
    expect(models.map((m) => m.id)).toEqual(['m-1']);
  });

  it('strips several trailing slashes from the address path', async () => {
    const { mock, adapter } = setup();
    mock
      .get(GW)
      .intercept({ path: '/a/b/v1/models?limit=1000', method: 'GET' })
      .reply(200, { data: [{ id: 'm-1' }] }, json);
    await adapter.listModels({ credential: KEY, baseUrl: `${GW}/a/b///` });
  });

  it('with no address calls https://api.anthropic.com/v1/models?limit=1000', async () => {
    const { mock, adapter } = setup();
    mock
      .get('https://api.anthropic.com')
      .intercept({ path: '/v1/models?limit=1000', method: 'GET' })
      .reply(200, { data: [{ id: 'm-1' }] }, json);
    const models = await adapter.listModels({ credential: KEY, baseUrl: null });
    expect(models.map((m) => m.id)).toEqual(['m-1']);
  });

  it('keeps the trimmed id, so a padded id and its plain twin are one model', async () => {
    const { mock, adapter } = setup();
    mock
      .get(GW)
      .intercept({ path: '/v1/models?limit=1000', method: 'GET' })
      .reply(200, { data: [{ id: ' m-1' }, { id: 'm-1' }, { id: 'm-2 ', display_name: 'Two' }] }, json);
    expect(await adapter.listModels({ credential: KEY, baseUrl: GW })).toEqual([
      { id: 'm-1', label: 'm-1' },
      { id: 'm-2', label: 'Two' },
    ]);
  });

  it('drops ids that are not valid model ids', async () => {
    const { mock, adapter } = setup();
    mock
      .get(GW)
      .intercept({ path: '/v1/models?limit=1000', method: 'GET' })
      .reply(200, { data: [{ id: 'bad id' }, { id: 'good-1' }] }, json);
    const models = await adapter.listModels({ credential: KEY, baseUrl: GW });
    expect(models.map((m) => m.id)).toEqual(['good-1']);
  });

  describe('errors', () => {
    async function failure(run: () => Promise<unknown>): Promise<AgentModelsError> {
      try {
        await run();
      } catch (e) {
        if (e instanceof AgentModelsError) return e;
        throw e;
      }
      throw new Error('expected an AgentModelsError');
    }
    const BODY = 'upstream-body-leak-789';

    const cases: { name: string; kind: string; reply: (m: MockAgent) => void; baseUrl?: string }[] = [
      {
        name: '401',
        kind: 'rejected',
        reply: (m) => m.get(GW).intercept({ path: /.*/, method: 'GET' }).reply(401, { error: BODY }, json),
      },
      {
        name: '403',
        kind: 'rejected',
        reply: (m) => m.get(GW).intercept({ path: /.*/, method: 'GET' }).reply(403, { error: BODY }, json),
      },
      {
        name: '404',
        kind: 'invalid',
        reply: (m) => m.get(GW).intercept({ path: /.*/, method: 'GET' }).reply(404, { error: BODY }, json),
      },
      {
        name: 'a body with the wrong shape',
        kind: 'invalid',
        reply: (m) => m.get(GW).intercept({ path: /.*/, method: 'GET' }).reply(200, { foo: BODY }, json),
      },
      {
        name: 'a 302',
        kind: 'unreachable',
        reply: (m) =>
          m
            .get(GW)
            .intercept({ path: /.*/, method: 'GET' })
            .reply(302, BODY, { headers: { location: 'https://evil.example.com/' } }),
      },
      {
        name: 'a network error',
        kind: 'unreachable',
        reply: (m) => m.get(GW).intercept({ path: /.*/, method: 'GET' }).replyWithError(new Error(BODY)),
      },
      { name: 'a blocked address', kind: 'unreachable', reply: () => undefined, baseUrl: 'https://10.0.0.1' },
    ];
    for (const c of cases) {
      it(`${c.name} → ${c.kind}, leaking nothing`, async () => {
        const { mock, adapter } = setup();
        c.reply(mock);
        const err = await failure(() => adapter.listModels({ credential: KEY, baseUrl: c.baseUrl ?? GW }));
        expect(err.kind).toBe(c.kind);
        expect(err.message).toBe(`agent models: ${c.kind}`);
        const text = `${String(err)} ${JSON.stringify(err)} ${String(err.cause ?? '')}`;
        expect(text).not.toContain(KEY.value);
        expect(text).not.toContain(BODY);
      });
    }
  });

  it('a slow provider times out as unreachable, leaking nothing', async () => {
    const mock = new MockAgent();
    mock.disableNetConnect();
    agents.push(mock);
    mock.get(GW).intercept({ path: /.*/, method: 'GET' }).reply(200, { data: [] }, json).delay(500);
    const adapter = agentAdapterFor('claude', {
      http: (u, h, o) => guardedGetJson(u, { headers: h, dispatcher: mock, ...(o ? { timeoutMs: 50 } : {}) }),
    });
    const err = await adapter.listModels({ credential: KEY, baseUrl: GW }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentModelsError);
    expect(String(err)).toBe('AgentModelsError: agent models: unreachable');
  });

  describe('total deadline', () => {
    afterEach(() => vi.restoreAllMocks());
    const page = (i: number) => ({ status: 200, json: { data: [{ id: `p${i}` }], has_more: true, last_id: `p${i}` } });

    it('gives each page only the time left of one overall budget', async () => {
      let now = 1_000_000;
      vi.spyOn(Date, 'now').mockImplementation(() => now);
      const budgets: number[] = [];
      const adapter = agentAdapterFor('claude', {
        http: async (_u, _h, o) => {
          budgets.push(o?.timeoutMs ?? -1);
          now += 1000;
          return page(budgets.length);
        },
      });
      await adapter.listModels({ credential: KEY, baseUrl: GW });
      expect(budgets).toEqual([
        LIST_TIMEOUT_MS,
        LIST_TIMEOUT_MS - 1000,
        LIST_TIMEOUT_MS - 2000,
        LIST_TIMEOUT_MS - 3000,
        LIST_TIMEOUT_MS - 4000,
      ]);
    });

    it('stops with unreachable once the budget is spent, without another request', async () => {
      let now = 1_000_000;
      vi.spyOn(Date, 'now').mockImplementation(() => now);
      let calls = 0;
      const adapter = agentAdapterFor('claude', {
        http: async () => {
          calls += 1;
          now += LIST_TIMEOUT_MS;
          return page(calls);
        },
      });
      const err = await adapter.listModels({ credential: KEY, baseUrl: GW }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AgentModelsError);
      expect(calls).toBe(1);
    });
  });

  it('credentialEnv names the runner env per type', () => {
    const a = agentAdapterFor('claude');
    expect(a.credentialEnv('oauth_token')).toBe('CLAUDE_CODE_OAUTH_TOKEN');
    expect(a.credentialEnv('api_key')).toBe('ANTHROPIC_API_KEY');
  });

  it('launchEnv sets the agent, model and address in order', () => {
    const a = agentAdapterFor('claude');
    expect(a.launchEnv({ model: 'sonnet[1m]', baseUrl: 'https://gw.example.com/a' })).toEqual([
      { name: 'AGENT', value: 'claude' },
      { name: 'AGENT_MODEL', value: 'sonnet[1m]' },
      { name: 'ANTHROPIC_MODEL', value: 'sonnet[1m]' },
      { name: 'ANTHROPIC_BASE_URL', value: 'https://gw.example.com/a' },
    ]);
  });

  it('launchEnv leaves out the address when there is none', () => {
    const names = agentAdapterFor('claude')
      .launchEnv({ model: 'opus', baseUrl: null })
      .map((e) => e.name);
    expect(names).toEqual(['AGENT', 'AGENT_MODEL', 'ANTHROPIC_MODEL']);
  });

  it('launchEnv leaves out the model entries when the model is empty', () => {
    expect(agentAdapterFor('claude').launchEnv({ model: '', baseUrl: null })).toEqual([
      { name: 'AGENT', value: 'claude' },
    ]);
  });

  it('builtinModels are opus, sonnet and haiku', () => {
    expect(agentAdapterFor('claude').builtinModels).toEqual([
      { id: 'opus', label: 'opus' },
      { id: 'sonnet', label: 'sonnet' },
      { id: 'haiku', label: 'haiku' },
    ]);
  });
});
