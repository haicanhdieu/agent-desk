import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AgentModelsError, agentAdapterFor, type AgentHttpGet } from '../../src';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/agents/codex/${name}.json`, import.meta.url)), 'utf8'));
const spike = fixture('spike') as { builtinModels: { id: string; label: string }[] };

const KEY = { type: 'api_key', value: 'sk-secret-key-123' } as const;
const AUTH = { type: 'auth_json', value: '{"auth_mode":"chatgpt"}' } as const;

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

describe('codex agent adapter', () => {
  it('has the built-in model names from the spike', () => {
    expect(agentAdapterFor('codex').builtinModels).toEqual(spike.builtinModels);
  });

  it('names CODEX_API_KEY for an API key and no env for auth_json', () => {
    const a = agentAdapterFor('codex');
    expect(a.credentialEnv('api_key')).toBe('CODEX_API_KEY');
    expect(a.credentialEnv('auth_json')).toBeNull();
  });

  it('launchEnv is AGENT=codex plus AGENT_MODEL, and never an address variable', () => {
    const a = agentAdapterFor('codex');
    expect(
      a.launchEnv({ model: 'gpt-6-sol', baseUrl: 'https://gw.example.com/v1', credentialType: 'api_key' }),
    ).toEqual([
      { name: 'AGENT', value: 'codex' },
      { name: 'AGENT_MODEL', value: 'gpt-6-sol' },
    ]);
    expect(a.launchEnv({ model: '', baseUrl: null, credentialType: null })).toEqual([
      { name: 'AGENT', value: 'codex' },
    ]);
  });

  it('lists the ids of GET https://api.openai.com/v1/models with a Bearer key, ignoring any address', async () => {
    const r = recorder({ status: 200, json: fixture('models-ok') });
    const models = await agentAdapterFor('codex', { http: r.http }).listModels({
      credential: KEY,
      baseUrl: 'https://other.example.com',
    });
    expect(r.calls.map(String)).toEqual(['https://api.openai.com/v1/models']);
    expect(r.seen[0]).toEqual({ authorization: `Bearer ${KEY.value}` });
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) expect(m.label).toBe(m.id);
  });

  it('drops hostile model names and duplicates', async () => {
    const r = recorder({
      status: 200,
      json: {
        data: [{ id: 'gpt-x' }, { id: 'a b' }, { id: '"; rm -rf /' }, { id: 'gpt-x' }, { id: 'x\ny' }, { id: 7 }],
      },
    });
    const models = await agentAdapterFor('codex', { http: r.http }).listModels({ credential: KEY, baseUrl: null });
    expect(models.map((m) => m.id)).toEqual(['gpt-x']);
  });

  it('returns the built-in names for auth_json, with zero calls', async () => {
    const r = recorder({ status: 200, json: {} });
    const a = agentAdapterFor('codex', { http: r.http });
    expect(await a.listModels({ credential: AUTH, baseUrl: null })).toEqual(spike.builtinModels);
    expect(r.calls).toHaveLength(0);
  });

  const failures: [string, { status: number; json: unknown } | Error, string][] = [
    ['401 fixture', { status: 401, json: fixture('models-401') }, 'rejected'],
    ['403', { status: 403, json: {} }, 'rejected'],
    ['network error', new Error('down sk-secret-key-123'), 'unreachable'],
    ['odd body fixture', { status: 200, json: fixture('models-bad') }, 'invalid'],
    ['500', { status: 500, json: {} }, 'invalid'],
  ];
  it.each(failures)('listModels maps %s to %s, leaking nothing', async (_n, res, kind) => {
    const a = agentAdapterFor('codex', { http: recorder(res).http });
    const err = await a.listModels({ credential: KEY, baseUrl: null }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentModelsError);
    expect((err as AgentModelsError).kind).toBe(kind);
    expect(JSON.stringify(err) + String(err)).not.toContain(KEY.value);
  });

  it('checkConnection is ok for a list and maps the failures', async () => {
    expect(
      await agentAdapterFor('codex', {
        http: recorder({ status: 200, json: fixture('models-ok') }).http,
      }).checkConnection({ credential: KEY, baseUrl: null }),
    ).toBe('ok');
    for (const [, res, kind] of failures) {
      const a = agentAdapterFor('codex', { http: recorder(res).http });
      expect(await a.checkConnection({ credential: KEY, baseUrl: null })).toBe(kind);
    }
  });

  it('checkConnection is unsupported with zero calls for auth_json and for no credential', async () => {
    const r = recorder({ status: 200, json: { data: [] } });
    const a = agentAdapterFor('codex', { http: r.http });
    expect(await a.checkConnection({ credential: AUTH, baseUrl: null })).toBe('unsupported');
    expect(await a.checkConnection({ credential: null, baseUrl: null })).toBe('unsupported');
    expect(r.calls).toHaveLength(0);
  });
});
