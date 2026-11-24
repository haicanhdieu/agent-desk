import { randomBytes } from 'node:crypto';
import { expect, test, type APIResponse } from '@playwright/test';
import { SetupTestDto } from '@agentdesk/contracts';
import { API, ok } from './helpers';
import { buildCast, disposeCast, openTerminal, streamStatus, type Actor, type Cast } from './rbac-cast';

/*
 * Local end-to-end for issue 216 against the running stack: a member or viewer holds no Desk configuration read. Every
 * Desk read answers 403 with the generic body (also for a made-up or malformed id), the setup test stream answers 403
 * and its terminal closes 4403, the roles list is an admin read, and owner and admins still read and write the Desk.
 * The cast (`buildCast`): O owner, D org admin, A admin of P1 only, B and C members of P1 (B also of P2), V org viewer.
 */

test.describe.configure({ timeout: 300_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

let cast: Cast;
let built: Cast | undefined;

test.beforeEach(async ({ browser }) => {
  built = undefined;
  built = await buildCast(browser);
  cast = built;
});

test.afterEach(async () => {
  const done = built;
  built = undefined;
  if (done) await disposeCast(done);
});

const RANDOM = '5b0f5d6e-8f4e-4c55-9d52-0c2f3a9a1e11';

/** The Desk reads of project `p` (agent id `agentId`, setup test id `setupTestId`). */
const deskReads = (p: string, agentId: string): string[] => [
  `/api/projects/${p}/agent`,
  `/api/agents/${agentId}/models`,
  `/api/projects/${p}/setup-script`,
  `/api/projects/${p}/setup-script/versions`,
  `/api/projects/${p}/plugins`,
  `/api/projects/${p}/setup-tests/latest`,
  `/api/projects/${p}/skills`,
  `/api/projects/${p}/rules`,
  `/api/projects/${p}/rules/prompt-preview`,
];

async function agentIdOf(who: Actor, p: string): Promise<string> {
  const body = (await ok(await who.api.get(`/api/projects/${p}/agent`), 200, 'agents.get as owner')) as { id: string };
  return body.id;
}

test.describe('a member and a viewer', () => {
  for (const [name, pick] of [
    ['member (B, on P1 and P2)', (c: Cast) => c.b],
    ['member (C, on P1)', (c: Cast) => c.c],
    ['viewer (V, org-wide)', (c: Cast) => c.v],
  ] as const) {
    test(`${name} get 403 on every Desk read, with a body that names no permission`, async () => {
      const who = pick(cast);
      const agentId = await agentIdOf(cast.o, cast.p1);
      for (const path of deskReads(cast.p1, agentId)) {
        const res = await who.api.get(path);
        const text = await res.text();
        expect(res.status(), `${path}: ${text}`).toBe(403);
        expect(text, path).toMatch(/not allowed for your role here/i);
        expect(text, path).not.toMatch(/:read|agent:|skill:|rule:|setup:/);
      }
    });

    test(`${name} get the same 403 for a made-up or malformed id`, async () => {
      const who = pick(cast);
      for (const path of [
        `/api/projects/${RANDOM}/agent`,
        '/api/projects/not-a-uuid/skills',
        `/api/projects/${RANDOM}/rules/prompt-preview`,
        `/api/agents/${RANDOM}/models`,
        `/api/setup-tests/${RANDOM}/events`,
      ]) {
        expect((await who.api.get(path)).status(), path).toBe(403);
      }
    });

    test(`${name} get 403 on the org roles list`, async () => {
      expect((await pick(cast).api.get(`/api/orgs/${cast.orgId}/roles`)).status()).toBe(403);
    });
  }

  test('a member and a viewer still read projects and runs', async () => {
    for (const who of [cast.b, cast.v]) {
      expect((await who.api.get(`/api/projects/${cast.p1}`)).status()).toBe(200);
      expect((await who.api.get(`/api/runs/${cast.rb}`)).status()).toBe(200);
    }
  });

  test('the setup test event stream answers 403 and its terminal closes 4403 with no bytes', async () => {
    const started = await cast.o.api.post(`/api/projects/${cast.p1}/setup-tests`, { data: { script: 'echo desk\n' } });
    expect(started.status(), await started.text()).toBeLessThan(300);
    const test216 = SetupTestDto.parse(await started.json());
    for (const who of [cast.b, cast.v]) {
      expect(await streamStatus(who, `/api/setup-tests/${test216.id}/events`)).toBe(403);
      expect(await openTerminal(who, `/api/setup-tests/${test216.id}/terminal`)).toEqual({ code: 4403, bytes: 0 });
    }
  });

  test('every Desk write is still 403 and changes nothing', async () => {
    const agentId = await agentIdOf(cast.o, cast.p1);
    for (const who of [cast.b, cast.v]) {
      const writes = [
        await who.api.put(`/api/projects/${cast.p1}/agent`, { data: { model: 'opus' } }),
        await who.api.put(`/api/agents/${agentId}/credential`, { data: { type: 'api_key', value: 'desk-e2e-secret' } }),
        await who.api.put(`/api/projects/${cast.p1}/setup-script`, { data: { body: 'echo x', baseVersion: null } }),
        await who.api.post(`/api/projects/${cast.p1}/setup-tests`, { data: { script: 'echo x' } }),
        await who.api.put(`/api/projects/${cast.p1}/skills/x`, { data: { body: 'x', message: 'x' } }),
        await who.api.post(`/api/projects/${cast.p1}/rules`, {
          data: { kind: 'prompt', command: 'x', labelFilter: [], target: 'issue', prompt: 'p', enabled: true },
        }),
      ];
      for (const res of writes) expect(res.status(), await res.text()).toBe(403);
    }
  });
});

test.describe('an owner, an org admin and a project admin', () => {
  test('owner O and org admin D read the Desk of P1 and list the roles', async () => {
    const agentId = await agentIdOf(cast.o, cast.p1);
    for (const who of [cast.o, cast.d]) {
      for (const path of deskReads(cast.p1, agentId)) {
        expect((await who.api.get(path)).status(), `${path} as ${who.handle}`).toBe(200);
      }
      expect((await who.api.get(`/api/orgs/${cast.orgId}/roles`)).status()).toBe(200);
    }
  });

  test('the admin of P1 only reads the Desk of P1, gets 404 on P2 and can list the roles', async () => {
    const agentId = await agentIdOf(cast.o, cast.p1);
    for (const path of deskReads(cast.p1, agentId)) {
      expect((await cast.a.api.get(path)).status(), path).toBe(200);
    }
    for (const path of [
      `/api/projects/${cast.p2}/agent`,
      `/api/projects/${cast.p2}/skills`,
      `/api/projects/${cast.p2}/rules`,
    ]) {
      expect((await cast.a.api.get(path)).status(), path).toBe(404);
    }
    expect((await cast.a.api.get(`/api/orgs/${cast.orgId}/roles`)).status()).toBe(200);
  });
});

/** The 7 project env routes as calls: list, then create, update and remove for variables, then for secrets. */
function envCalls(
  who: Actor,
  projectId: string,
  plain: string,
  secret: string,
): { what: string; call: () => Promise<APIResponse> }[] {
  const base = `/api/projects/${projectId}`;
  return [
    { what: 'list', call: () => who.api.get(`${base}/env?kind=plain`) },
    {
      what: 'create var',
      call: () => who.api.post(`${base}/env-vars`, { data: { name: plain, value: 'e2e-new-value' } }),
    },
    { what: 'update var', call: () => who.api.put(`${base}/env-vars/${plain}`, { data: { value: 'e2e-changed' } }) },
    { what: 'remove var', call: () => who.api.delete(`${base}/env-vars/${plain}`) },
    {
      what: 'create secret',
      call: () => who.api.post(`${base}/env-secrets`, { data: { name: secret, value: 'e2e-secret-new' } }),
    },
    {
      what: 'update secret',
      call: () => who.api.put(`${base}/env-secrets/${secret}`, { data: { value: 'e2e-secret-changed' } }),
    },
    { what: 'remove secret', call: () => who.api.delete(`${base}/env-secrets/${secret}`) },
  ];
}

type EnvItem = { name: string; kind: string; value: string | null };

async function expectEnvDenied(res: APIResponse, what: string, leaks: string[]): Promise<void> {
  const text = await res.text();
  expect(res.status(), `${what}: ${text}`).toBe(403);
  expect(text, what).toMatch(/not allowed for your role here/i);
  for (const leak of leaks) expect(text, `${what} leaks ${leak}`).not.toContain(leak);
}

test.describe('BR-2: project env routes for a member and a viewer', () => {
  const rand = randomBytes(3).toString('hex');
  const plain = `E2E_PLAIN_${rand}`;
  const secret = `E2E_SECRET_${rand}`;
  const leaks = [plain, secret, 'e2e-plain-value', 'e2e-secret-value'];

  test.beforeEach(async () => {
    const v = await cast.o.api.post(`/api/projects/${cast.p1}/env-vars`, {
      data: { name: plain, value: 'e2e-plain-value' },
    });
    expect(v.status(), await v.text()).toBeLessThan(300);
    const s = await cast.o.api.post(`/api/projects/${cast.p1}/env-secrets`, {
      data: { name: secret, value: 'e2e-secret-value' },
    });
    expect(s.status(), await s.text()).toBeLessThan(300);
  });

  async function ownerList(kind: 'plain' | 'secret'): Promise<EnvItem[]> {
    const res = await cast.o.api.get(`/api/projects/${cast.p1}/env?kind=${kind}`);
    expect(res.status(), await res.text()).toBe(200);
    return ((await res.json()) as { items: EnvItem[] }).items;
  }

  /** As owner, the list still holds the same two entries with the same values (a secret has none). */
  async function expectUnchanged(): Promise<void> {
    const vars = await ownerList('plain');
    expect(vars.filter((e) => e.name === plain)).toMatchObject([{ name: plain, value: 'e2e-plain-value' }]);
    const secrets = await ownerList('secret');
    expect(secrets.filter((e) => e.name === secret)).toMatchObject([{ name: secret, kind: 'secret', value: null }]);
  }

  test('TC-2.1: a member gets 403 with the generic body on the 7 calls and the owner still reads both entries', async () => {
    for (const who of [cast.b, cast.c]) {
      for (const { what, call } of envCalls(who, cast.p1, plain, secret)) {
        await expectEnvDenied(await call(), `${what} as ${who.handle}`, leaks);
      }
    }
    await expectUnchanged();
  });

  test('TC-2.2: a viewer gets 403 with the generic body on the 7 calls and nothing was written', async () => {
    for (const { what, call } of envCalls(cast.v, cast.p1, plain, secret)) {
      await expectEnvDenied(await call(), `${what} as viewer`, leaks);
    }
    await expectUnchanged();
  });

  test('TC-2.3: a member gets the same 403 for a made-up uuid and a malformed id, not 404 or 400', async () => {
    for (const who of [cast.b, cast.c]) {
      const calls = [
        await who.api.get(`/api/projects/${RANDOM}/env?kind=plain`),
        await who.api.get('/api/projects/not-a-uuid/env?kind=plain'),
        await who.api.post(`/api/projects/${RANDOM}/env-vars`, { data: { name: plain, value: 'x' } }),
      ];
      for (const [i, res] of calls.entries()) await expectEnvDenied(res, `call ${i + 1} as ${who.handle}`, leaks);
    }
  });
});
