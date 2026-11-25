import { MockAgent } from 'undici';
import { afterEach, describe, expect, it } from 'vitest';
import { AGENT_KIND_CAPABILITIES, AgentBaseUrl, AgentKind } from '@agentdesk/contracts';
import { AgentModelsError, agentAdapterFor, type AgentAdapter } from '../../src';
import { guardedGetJson } from '../../src/net/guarded-http';

const json = { headers: { 'content-type': 'application/json' } };
const KEY = { type: 'api_key', value: 'sk-secret-key-123' } as const;
const addressKinds = AgentKind.options.filter((k) => AGENT_KIND_CAPABILITIES[k].baseUrl !== null);

const BAD_ADDRESSES: [string, string][] = [
  ['http://', 'http://gw.example.com/v1'],
  ['file:', 'file:///etc/passwd'],
  ['javascript:', 'javascript:alert(1)'],
  ['private host', 'https://10.0.0.1/v1'],
  ['link-local host', 'https://169.254.169.254/v1'],
  ['embedded credentials', 'https://user:pass@gw.example.com/v1'],
  ['over 2048 characters', `https://gw.example.com/${'a'.repeat(2100)}`],
];

describe('agent address rules', () => {
  it('the address-supporting kinds are claude and opencode', () => {
    expect(addressKinds).toEqual(['claude', 'opencode']);
  });

  describe.each(addressKinds)('%s', (kind) => {
    it.each(BAD_ADDRESSES)('the contract refuses %s', (_n, url) => {
      expect(AgentBaseUrl.safeParse(url).success).toBe(false);
    });
    it('the contract accepts a public https address', () => {
      expect(AgentBaseUrl.safeParse('https://gw.example.com/v1').success).toBe(true);
    });
    it.each(BAD_ADDRESSES)('the adapter refuses %s without any http call', async (_n, url) => {
      const mock = new MockAgent();
      mock.disableNetConnect();
      try {
        mock
          .get(/.*/)
          .intercept({ path: /.*/, method: 'GET' })
          .reply(200, { data: [{ id: 'm' }] }, json);
        const adapter = agentAdapterFor(kind, {
          http: (u, h, o) =>
            guardedGetJson(u, { headers: h, dispatcher: mock, ...(o ? { timeoutMs: o.timeoutMs } : {}) }),
        });
        const err = await adapter.listModels({ credential: KEY, baseUrl: url }).catch((e: unknown) => e);
        expect((err as AgentModelsError).kind).toBe('unreachable');
        expect(await adapter.checkConnection({ credential: KEY, baseUrl: url })).toBe('unreachable');
        expect(mock.pendingInterceptors()).toHaveLength(1);
      } finally {
        await mock.close();
      }
    });
  });
});

describe('opencode own-endpoint transport', () => {
  const mocks: MockAgent[] = [];
  function setup(timeoutMs?: number): { mock: MockAgent; adapter: AgentAdapter } {
    const mock = new MockAgent();
    mock.disableNetConnect();
    mocks.push(mock);
    const adapter = agentAdapterFor('opencode', {
      http: (u, h, o) =>
        guardedGetJson(u, { headers: h, dispatcher: mock, ...(o ? { timeoutMs: timeoutMs ?? o.timeoutMs } : {}) }),
    });
    return { mock, adapter };
  }
  afterEach(async () => {
    await Promise.all(mocks.splice(0).map((m) => m.close()));
  });

  it.each(BAD_ADDRESSES)('the adapter never connects for %s', async (_n, url) => {
    const { mock, adapter } = setup();
    // disableNetConnect makes any attempted request fail the same way, so also assert nothing was matched.
    mock
      .get(/.*/)
      .intercept({ path: /.*/, method: 'GET' })
      .reply(200, { data: [{ id: 'm' }] }, json);
    expect(await adapter.checkConnection({ credential: KEY, baseUrl: url })).toBe('unreachable');
    expect(mock.pendingInterceptors()).toHaveLength(1);
  });

  it('does not follow a redirect', async () => {
    const { mock, adapter } = setup();
    mock
      .get('https://gw.example.com')
      .intercept({ path: '/v1/models', method: 'GET' })
      .reply(302, '', { headers: { location: 'https://evil.example.com/' } });
    const err = await adapter
      .listModels({ credential: KEY, baseUrl: 'https://gw.example.com/v1' })
      .catch((e: unknown) => e);
    expect((err as AgentModelsError).kind).toBe('unreachable');
  });

  it('refuses an oversized body as invalid', async () => {
    const { mock, adapter } = setup();
    mock
      .get('https://gw.example.com')
      .intercept({ path: '/v1/models', method: 'GET' })
      .reply(200, 'x'.repeat(1_100_000), json);
    expect(await adapter.checkConnection({ credential: KEY, baseUrl: 'https://gw.example.com/v1' })).toBe('invalid');
  });

  it('gives up on a stalled endpoint as unreachable', async () => {
    const { mock, adapter } = setup(50);
    mock
      .get('https://gw.example.com')
      .intercept({ path: '/v1/models', method: 'GET' })
      .reply(200, { data: [] }, json)
      .delay(500);
    expect(await adapter.checkConnection({ credential: KEY, baseUrl: 'https://gw.example.com/v1' })).toBe(
      'unreachable',
    );
  });

  it('two agents with different endpoints and keys never cross', async () => {
    const { mock, adapter } = setup();
    const seen: Record<string, string> = {};
    for (const [host, id] of [
      ['a.example.com', 'model-a'],
      ['b.example.com', 'model-b'],
    ] as const) {
      mock
        .get(`https://${host}`)
        .intercept({ path: '/v1/models', method: 'GET' })
        .reply(
          200,
          (opts) => {
            seen[host] = String((opts.headers as Record<string, unknown>)['authorization']);
            return { data: [{ id }] };
          },
          json,
        );
    }
    const [a, b] = await Promise.all([
      adapter.listModels({ credential: { type: 'api_key', value: 'key-a-aaaa' }, baseUrl: 'https://a.example.com/v1' }),
      adapter.listModels({ credential: { type: 'api_key', value: 'key-b-bbbb' }, baseUrl: 'https://b.example.com/v1' }),
    ]);
    expect(a.map((m) => m.id)).toEqual(['model-a']);
    expect(b.map((m) => m.id)).toEqual(['model-b']);
    expect(seen).toEqual({ 'a.example.com': 'Bearer key-a-aaaa', 'b.example.com': 'Bearer key-b-bbbb' });
  });
});
