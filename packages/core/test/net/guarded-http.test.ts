import type { lookup as dnsLookup } from 'node:dns';
import { Dispatcher, MockAgent } from 'undici';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createGuardedAgent,
  GUARDED_MAX_BYTES,
  GUARDED_TIMEOUT_MS,
  GuardedHttpError,
  guardedGetJson,
  type GuardedHttpErrorKind,
} from '../../src/net/guarded-http';

const ORIGIN = 'https://gw.example.com';

function mockAgent(): MockAgent {
  const agent = new MockAgent();
  agent.disableNetConnect();
  return agent;
}

async function kindOf(p: Promise<unknown>): Promise<GuardedHttpErrorKind> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(GuardedHttpError);
    return (e as GuardedHttpError).kind;
  }
  throw new Error('expected a GuardedHttpError');
}

/** A dispatcher that records and fails any request that reaches it. */
class ReachedDispatcher extends Dispatcher {
  calls = 0;
  override dispatch(): boolean {
    this.calls += 1;
    throw new Error('request reached the dispatcher');
  }
}

describe('guardedGetJson', () => {
  const agents: MockAgent[] = [];
  const make = (): MockAgent => {
    const a = mockAgent();
    agents.push(a);
    return a;
  };
  afterEach(async () => {
    await Promise.all(agents.splice(0).map((a) => a.close()));
  });

  it('exposes the documented limits', () => {
    expect(GUARDED_TIMEOUT_MS).toBe(5000);
    expect(GUARDED_MAX_BYTES).toBe(1_000_000);
  });

  it('returns the status and JSON of a 200 and sends the headers and query', async () => {
    const agent = make();
    agent
      .get(ORIGIN)
      .intercept({ path: '/anthropic/v1/models?limit=1000', method: 'GET', headers: { 'x-api-key': 'k' } })
      .reply(200, { data: [{ id: 'a' }] });
    const out = await guardedGetJson(new URL(`${ORIGIN}/anthropic/v1/models?limit=1000`), {
      headers: { 'x-api-key': 'k' },
      dispatcher: agent,
    });
    expect(out).toEqual({ status: 200, json: { data: [{ id: 'a' }] } });
  });

  it('returns a non-2xx status with its JSON', async () => {
    const agent = make();
    agent.get(ORIGIN).intercept({ path: '/v1/models', method: 'GET' }).reply(401, { error: 'no' });
    const out = await guardedGetJson(new URL(`${ORIGIN}/v1/models`), { headers: {}, dispatcher: agent });
    expect(out.status).toBe(401);
  });

  it('a 302 is a redirect error and the Location is not fetched', async () => {
    const agent = make();
    agent
      .get(ORIGIN)
      .intercept({ path: '/v1/models', method: 'GET' })
      .reply(302, '', { headers: { location: 'https://other.example.com/v1/models' } });
    const target = agent
      .get('https://other.example.com')
      .intercept({ path: '/v1/models', method: 'GET' })
      .reply(200, {});
    expect(await kindOf(guardedGetJson(new URL(`${ORIGIN}/v1/models`), { headers: {}, dispatcher: agent }))).toBe(
      'redirect',
    );
    expect(agent.pendingInterceptors().some((i) => i.origin === 'https://other.example.com')).toBe(true);
    void target;
  });

  it('a reply slower than the timeout is a timeout error', async () => {
    const agent = make();
    agent.get(ORIGIN).intercept({ path: '/v1/models', method: 'GET' }).reply(200, {}).delay(200);
    expect(
      await kindOf(guardedGetJson(new URL(`${ORIGIN}/v1/models`), { headers: {}, dispatcher: agent, timeoutMs: 50 })),
    ).toBe('timeout');
  });

  it('a body over the cap is too_large', async () => {
    const agent = make();
    agent.get(ORIGIN).intercept({ path: '/v1/models', method: 'GET' }).reply(200, '12345678901');
    expect(
      await kindOf(guardedGetJson(new URL(`${ORIGIN}/v1/models`), { headers: {}, dispatcher: agent, maxBytes: 10 })),
    ).toBe('too_large');
  });

  it('a body exactly at the cap is accepted', async () => {
    const agent = make();
    agent.get(ORIGIN).intercept({ path: '/v1/models', method: 'GET' }).reply(200, '[1,2,3,4]');
    const out = await guardedGetJson(new URL(`${ORIGIN}/v1/models`), {
      headers: {},
      dispatcher: agent,
      maxBytes: 9,
    });
    expect(out.json).toEqual([1, 2, 3, 4]);
  });

  it('a non-JSON body is bad_json and the error message does not contain the body', async () => {
    const agent = make();
    agent.get(ORIGIN).intercept({ path: '/v1/models', method: 'GET' }).reply(200, 'SECRET-BODY <html>');
    const err = await guardedGetJson(new URL(`${ORIGIN}/v1/models`), { headers: {}, dispatcher: agent }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(GuardedHttpError);
    expect((err as GuardedHttpError).kind).toBe('bad_json');
    expect((err as GuardedHttpError).message).toBe('guarded http: bad_json');
    expect((err as GuardedHttpError).message).not.toContain('SECRET');
  });

  it('a connection failure is a network error with no cause text in the message', async () => {
    const agent = make();
    agent
      .get(ORIGIN)
      .intercept({ path: '/v1/models?token=abc', method: 'GET' })
      .replyWithError(new Error('boom token=abc'));
    const err = await guardedGetJson(new URL(`${ORIGIN}/v1/models?token=abc`), {
      headers: { authorization: 'Bearer secret' },
      dispatcher: agent,
    }).catch((e: unknown) => e);
    expect((err as GuardedHttpError).kind).toBe('network');
    expect((err as GuardedHttpError).message).toBe('guarded http: network');
  });

  describe('refuses before connecting', () => {
    const urls = [
      'http://gw.example.com',
      'https://localhost',
      'https://LOCALHOST',
      'https://localhost.',
      'https://app.localhost',
      'https://App.LocalHost.',
      'https://127.0.0.1',
      'https://127.0.0.1.',
      'https://127.1',
      'https://2130706433',
      'https://0x7f.0.0.1',
      'https://0177.0.0.1',
      'https://0',
      'https://10.1.2.3',
      'https://169.254.169.254',
      'https://100.64.0.1',
      'https://[::1]',
      'https://[::]',
      'https://[::ffff:10.0.0.1]',
      'https://[::ffff:127.0.0.1]',
      'https://[::ffff:7f00:1]',
      'https://[0:0:0:0:0:ffff:a00:1]',
      'https://[64:ff9b::7f00:1]',
      'https://[fe80::1]',
      'https://[fd00::1]',
      'ftp://gw.example.com',
    ];
    for (const u of urls) {
      it(u, async () => {
        const dispatcher = new ReachedDispatcher();
        expect(await kindOf(guardedGetJson(new URL(u), { headers: {}, dispatcher }))).toBe('blocked_address');
        expect(dispatcher.calls).toBe(0);
      });
    }
  });
});

describe('createGuardedAgent', () => {
  const lookupAnswering = (address: string, family: number): typeof dnsLookup =>
    ((_host: string, opts: unknown, cb: (...a: unknown[]) => void) => {
      const o = opts as { all?: boolean };
      if (o.all) cb(null, [{ address, family }]);
      else cb(null, address, family);
    }) as unknown as typeof dnsLookup;

  for (const [address, family] of [
    ['10.0.0.1', 4],
    ['fe80::1', 6],
    ['::ffff:127.0.0.1', 6],
    ['fe80::1%eth0', 6],
    ['not-an-ip', 4],
  ] as const) {
    it(`a name that resolves to ${address} is refused at connect time`, async () => {
      const agent = createGuardedAgent({ lookup: lookupAnswering(address, family) });
      try {
        expect(await kindOf(guardedGetJson(new URL(`${ORIGIN}/v1/models`), { headers: {}, dispatcher: agent }))).toBe(
          'blocked_address',
        );
      } finally {
        await agent.close();
      }
    });
  }

  it('refuses when any one of several resolved addresses is blocked (DNS rebinding mix)', async () => {
    const lookup = ((_h: string, _o: unknown, cb: (...a: unknown[]) => void) =>
      cb(null, [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ])) as unknown as typeof dnsLookup;
    const agent = createGuardedAgent({ lookup });
    try {
      expect(await kindOf(guardedGetJson(new URL(`${ORIGIN}/v1/models`), { headers: {}, dispatcher: agent }))).toBe(
        'blocked_address',
      );
    } finally {
      await agent.close();
    }
  });
});
