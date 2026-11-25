import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AgentModelsError, agentAdapterFor, type AgentHttpGet } from '../../src';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/agents/opencode/${name}.json`, import.meta.url)), 'utf8'));
const spike = fixture('spike') as { builtinModels: { id: string; label: string }[] };

const EP = 'https://llm.example.com/v1';
const KEY = { type: 'api_key', value: 'sk-secret-key-123' } as const;
const AUTH = { type: 'auth_json', value: '[]' } as const;

function recorder(res: { status: number; json: unknown } | Error): {
  http: AgentHttpGet;
  calls: URL[];
  seen: Record<string, string>[];
} {
  const calls: URL[] = [];
  const seen: Record<string, string>[] = [];
  const http: AgentHttpGet = (url, headers) => {
    calls.push(url);
    seen.push(headers);
    return res instanceof Error ? Promise.reject(res) : Promise.resolve(res);
  };
  return { http, calls, seen };
}

const adapter = (http?: AgentHttpGet) => agentAdapterFor('opencode', { http });
const configOf = (env: { name: string; value: string }[]): unknown => {
  const e = env.find((x) => x.name === 'OPENCODE_CONFIG_CONTENT');
  return e ? JSON.parse(e.value) : undefined;
};

describe('opencode adapter env', () => {
  it('has the built-in model names from the spike', () => {
    expect(adapter().builtinModels).toEqual(spike.builtinModels);
  });

  it('credentialEnv: api_key is AGENTDESK_LLM_API_KEY, auth_json is null', () => {
    expect(adapter().credentialEnv('api_key')).toBe('AGENTDESK_LLM_API_KEY');
    expect(adapter().credentialEnv('auth_json')).toBeNull();
  });

  it('own endpoint: AGENT, autoupdate off, prefixed model, and exactly the inline config', () => {
    const env = adapter().launchEnv({ model: 'org/model-a', baseUrl: EP, credentialType: 'api_key' });
    expect(env.slice(0, 3)).toEqual([
      { name: 'AGENT', value: 'opencode' },
      { name: 'OPENCODE_DISABLE_AUTOUPDATE', value: '1' },
      { name: 'AGENT_MODEL', value: 'agentdesk/org/model-a' },
    ]);
    expect(env).toHaveLength(4);
    expect(configOf(env)).toEqual({
      provider: {
        agentdesk: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Agent Desk',
          options: { baseURL: EP },
          env: ['AGENTDESK_LLM_API_KEY'],
          models: { 'org/model-a': { name: 'org/model-a' } },
        },
      },
    });
  });

  it('never puts a key in the env or config', () => {
    const env = adapter().launchEnv({ model: 'm', baseUrl: EP, credentialType: 'api_key' });
    expect(JSON.stringify(env)).not.toContain(KEY.value);
  });

  it('with no model: no AGENT_MODEL and no models in the config', () => {
    const env = adapter().launchEnv({ model: '', baseUrl: EP, credentialType: 'api_key' });
    expect(env.map((e) => e.name)).toEqual(['AGENT', 'OPENCODE_DISABLE_AUTOUPDATE', 'OPENCODE_CONFIG_CONTENT']);
    expect(configOf(env)).toMatchObject({ provider: { agentdesk: { models: {} } } });
  });

  it('api_key with no address: no config and the native model as typed (no agentdesk/ prefix)', () => {
    const env = adapter().launchEnv({ model: 'anthropic/claude-sonnet-4-5', baseUrl: null, credentialType: 'api_key' });
    expect(env).toEqual([
      { name: 'AGENT', value: 'opencode' },
      { name: 'OPENCODE_DISABLE_AUTOUPDATE', value: '1' },
      { name: 'AGENT_MODEL', value: 'anthropic/claude-sonnet-4-5' },
    ]);
  });

  it.each([['auth_json' as const], [null]])('credential %s: native model as typed and no config', (credentialType) => {
    const env = adapter().launchEnv({ model: 'anthropic/claude-sonnet-4-5', baseUrl: null, credentialType });
    expect(env).toEqual([
      { name: 'AGENT', value: 'opencode' },
      { name: 'OPENCODE_DISABLE_AUTOUPDATE', value: '1' },
      { name: 'AGENT_MODEL', value: 'anthropic/claude-sonnet-4-5' },
    ]);
  });

  it('no model and no credential: no AGENT_MODEL', () => {
    const env = adapter().launchEnv({ model: '', baseUrl: null, credentialType: null });
    expect(env.map((e) => e.name)).toEqual(['AGENT', 'OPENCODE_DISABLE_AUTOUPDATE']);
  });

  it('an own-endpoint run with no address gets no config', () => {
    const env = adapter().launchEnv({ model: 'm', baseUrl: null, credentialType: 'api_key' });
    expect(configOf(env)).toBeUndefined();
  });

  const hostile = ['a"b', 'x\ny', '}{', '"; rm -rf /', 'a'.repeat(100_000), '__proto__', '$(id)'];
  it.each(hostile)('hostile strings stay inside one provider object (%#)', (s) => {
    const env = adapter().launchEnv({ model: s, baseUrl: `https://h/${s}`, credentialType: 'api_key' });
    const cfg = configOf(env) as {
      provider: Record<string, { options: { baseURL: string }; models: Record<string, unknown> }>;
    };
    expect(Object.keys(cfg)).toEqual(['provider']);
    expect(Object.keys(cfg.provider)).toEqual(['agentdesk']);
    expect(cfg.provider.agentdesk.options.baseURL).toBe(`https://h/${s}`);
    expect(Object.keys(cfg.provider.agentdesk.models)).toEqual([s]);
  });
});

describe('opencode models and connection', () => {
  const call = { credential: KEY, baseUrl: EP };

  it('lists the ids of GET <base>/models with a Bearer key; a slash stays one id', async () => {
    const r = recorder({ status: 200, json: fixture('models-ok') });
    const models = await adapter(r.http).listModels(call);
    expect(r.calls.map(String)).toEqual([`${EP}/models`]);
    expect(r.seen[0]).toEqual({ authorization: `Bearer ${KEY.value}` });
    expect(models.map((m) => m.id)).toEqual(['org/model-a', 'model-b']);
  });

  it('drops hostile model names', async () => {
    const r = recorder({ status: 200, json: { data: [{ id: 'ok-1' }, { id: 'a b' }, { id: '"; rm -rf /' }] } });
    expect((await adapter(r.http).listModels(call)).map((m) => m.id)).toEqual(['ok-1']);
  });

  it('auth_json lists the built-in names with zero calls', async () => {
    const r = recorder({ status: 200, json: {} });
    expect(await adapter(r.http).listModels({ credential: AUTH, baseUrl: null })).toEqual(spike.builtinModels);
    expect(r.calls).toHaveLength(0);
  });

  const failures: [string, { status: number; json: unknown } | Error, string][] = [
    ['models-401', { status: 401, json: fixture('models-401') }, 'rejected'],
    ['403', { status: 403, json: {} }, 'rejected'],
    ['network error', new Error('down sk-secret-key-123'), 'unreachable'],
    ['models-bad', { status: 200, json: fixture('models-bad') }, 'invalid'],
    ['missing /models route', { status: 404, json: undefined }, 'invalid'],
    ['500', { status: 500, json: {} }, 'invalid'],
  ];

  it.each(failures)('%s -> %s', async (_n, res, kind) => {
    const a = adapter(recorder(res).http);
    const err = await a.listModels(call).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentModelsError);
    expect((err as AgentModelsError).kind).toBe(kind);
    expect(JSON.stringify(err) + String(err)).not.toContain(KEY.value);
    expect(await a.checkConnection(call)).toBe(kind);
  });

  it('malformed JSON and a truncated body (guarded errors) are invalid', async () => {
    const { GuardedHttpError } = await import('../../src/net/guarded-http');
    for (const k of ['bad_json', 'too_large'] as const) {
      const a = adapter(() => Promise.reject(new GuardedHttpError(k)));
      expect(await a.checkConnection(call)).toBe('invalid');
    }
    const a = adapter(() => Promise.reject(new GuardedHttpError('redirect')));
    expect(await a.checkConnection(call)).toBe('unreachable');
  });

  it('checkConnection is ok for the models-ok fixture', async () => {
    expect(await adapter(recorder({ status: 200, json: fixture('models-ok') }).http).checkConnection(call)).toBe('ok');
  });

  it('checkConnection is unsupported with zero calls for auth_json and for no credential', async () => {
    const r = recorder({ status: 200, json: { data: [] } });
    const a = adapter(r.http);
    expect(await a.checkConnection({ credential: AUTH, baseUrl: null })).toBe('unsupported');
    expect(await a.checkConnection({ credential: null, baseUrl: EP })).toBe('unsupported');
    expect(r.calls).toHaveLength(0);
  });

  it('an api_key with no address is unreachable without a call', async () => {
    const r = recorder({ status: 200, json: { data: [] } });
    expect(await adapter(r.http).checkConnection({ credential: KEY, baseUrl: null })).toBe('unreachable');
    expect(r.calls).toHaveLength(0);
  });
});
