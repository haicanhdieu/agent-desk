import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { projectEnvSecretName } from '@agentdesk/core';
import { withOrg } from '@agentdesk/db';
import type { EnvEntryDto, Page } from '@agentdesk/contracts';
import { FORBIDDEN_DETAIL } from '../src/access/authorize';
import { createTestApp, type TestApp } from './helpers/app';
import { createOrg, inviteAndLogin } from './helpers/auth';
import { expectContract } from './helpers/contract';
import { freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';
import { customRole, loginWithRole, seedEnvRows, slowStore } from './helpers/project-env';

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
const TOTAL_LIMIT = 262144;

interface Cast {
  t: TestApp;
  orgId: string;
  owner: string;
  admin: string;
  p1admin: string;
  member: string;
  viewer: string;
  p1: string;
  p2: string;
}

async function buildCast(t: TestApp, slug: string): Promise<Cast> {
  const org = await createOrg(t, `Org ${slug}`, slug);
  const owner = await inviteAndLogin(t, org.id, `${slug}-owner`, 'owner', { type: 'org' });
  const connectionId = await installFake(t, owner);
  const p1 = (await makeProject(t, owner, connectionId)).projectId;
  const p2 = (await makeProject(t, owner, connectionId)).projectId;
  return {
    t,
    orgId: org.id,
    owner,
    admin: await inviteAndLogin(t, org.id, `${slug}-admin`, 'admin', { type: 'org' }),
    p1admin: await inviteAndLogin(t, org.id, `${slug}-p1a`, 'admin', { type: 'project', projectIds: [p1] }),
    member: await inviteAndLogin(t, org.id, `${slug}-member`, 'member', { type: 'org' }),
    viewer: await inviteAndLogin(t, org.id, `${slug}-viewer`, 'viewer', { type: 'org' }),
    p1,
    p2,
  };
}

const send = (t: TestApp, method: Method, url: string, cookie: string, payload?: object) =>
  t.app.inject({ method, url, headers: { cookie }, payload });
const secretsUrl = (id: string, name?: string) =>
  `/api/projects/${id}/env-secrets${name === undefined ? '' : `/${name}`}`;
const listUrl = (id: string, qs = 'kind=plain') => `/api/projects/${id}/env?${qs}`;
const varsUrl = (id: string, name?: string) => `/api/projects/${id}/env-vars${name === undefined ? '' : `/${name}`}`;

async function clear(c: Cast, projectId: string): Promise<void> {
  await withOrg(c.t.db, c.orgId, (tx) => tx.execute(sql`delete from project_env_vars where project_id = ${projectId}`));
  for (const n of c.t.secrets.names().filter((x) => x.startsWith(`org-${c.orgId}-env-`))) await c.t.secrets.delete(n);
}
async function rows(c: Cast, projectId: string) {
  const r = await withOrg(c.t.db, c.orgId, (tx) =>
    tx.execute(
      sql`select name, kind, value, size_bytes, updated_by from project_env_vars where project_id = ${projectId} order by name collate "C"`,
    ),
  );
  return r.rows as { name: string; kind: string; value: string | null; size_bytes: number; updated_by: string }[];
}
async function entryId(c: Cast, projectId: string, name: string): Promise<string> {
  const r = await withOrg(c.t.db, c.orgId, (tx) =>
    tx.execute(sql`select id from project_env_vars where project_id = ${projectId} and name = ${name}`),
  );
  return (r.rows[0] as { id: string } | undefined)?.id ?? '';
}
/** Stored Secret names of this org's env entries. */
const envSecretNames = (c: Cast): string[] => c.t.secrets.names().filter((n) => n.startsWith(`org-${c.orgId}-env-`));
async function listAll(c: Cast, cookie: string, projectId: string, qs = 'kind=plain&pageSize=100') {
  const res = await send(c.t, 'GET', listUrl(projectId, qs), cookie);
  return expectContract('projectEnv.list', res) as Page<EnvEntryDto>;
}

let t: TestApp;
let a: Cast;
let bobOrgOwner: string;

beforeAll(async () => {
  t = await createTestApp({ env: { FAKE_STATE_DIR: freshStateDir() }, wrapAdapters: wideFakeRepos });
  a = await buildCast(t, 'pe-a');
  const bobOrg = await createOrg(t, 'Org pe-b', 'pe-b');
  bobOrgOwner = await inviteAndLogin(t, bobOrg.id, 'pe-b-owner', 'owner', { type: 'org' });
});
afterAll(async () => {
  await t.close();
});

describe('access (BR-2, BR-4)', () => {
  const routesOf = (id: string): [string, Method, string, object | undefined][] => [
    ['list', 'GET', listUrl(id), undefined],
    ['createVar', 'POST', varsUrl(id), { name: 'FOREIGN_NAME', value: 'x' }],
    ['updateVar', 'PUT', varsUrl(id, 'FOREIGN_NAME'), { value: 'y' }],
    ['removeVar', 'DELETE', varsUrl(id, 'FOREIGN_NAME'), undefined],
    ['createSecret', 'POST', secretsUrl(id), { name: 'FOREIGN_NAME', value: 'foreign-secret' }],
    ['updateSecret', 'PUT', secretsUrl(id, 'FOREIGN_NAME'), { value: 'foreign-secret-2' }],
    ['removeSecret', 'DELETE', secretsUrl(id, 'FOREIGN_NAME'), undefined],
  ];

  it.each(['member', 'viewer'] as const)('a %s gets the generic 403 on every route, whatever the id', async (who) => {
    await clear(a, a.p1);
    expect((await send(t, 'POST', varsUrl(a.p1), a.owner, { name: 'FOREIGN_NAME', value: 'keep' })).statusCode).toBe(
      201,
    );
    for (const id of [a.p1, randomUUID(), 'not-a-uuid']) {
      for (const [key, method, url, payload] of routesOf(id)) {
        const res = await send(t, method, url, a[who], payload);
        expect(res.statusCode, `${key} ${id}`).toBe(403);
        expect(res.json<{ detail: string }>().detail).toBe(FORBIDDEN_DETAIL);
        expect(res.body).not.toContain('FOREIGN_NAME');
      }
    }
    expect((await rows(a, a.p1)).map((r) => [r.name, r.value])).toEqual([['FOREIGN_NAME', 'keep']]);
    expect(envSecretNames(a)).toEqual([]);
  });

  it('an admin on P1 reads and writes P1 and gets 404 on P2', async () => {
    await clear(a, a.p1);
    await clear(a, a.p2);
    expect((await send(t, 'POST', varsUrl(a.p1), a.p1admin, { name: 'ONE', value: '1' })).statusCode).toBe(201);
    expect((await send(t, 'PUT', varsUrl(a.p1, 'ONE'), a.p1admin, { value: '2' })).statusCode).toBe(200);
    expect((await listAll(a, a.p1admin, a.p1)).total).toBe(1);
    expect((await send(t, 'DELETE', varsUrl(a.p1, 'ONE'), a.p1admin)).statusCode).toBe(204);
    await send(t, 'POST', varsUrl(a.p2), a.owner, { name: 'FOREIGN_NAME', value: 'p2' });
    for (const [key, method, url, payload] of routesOf(a.p2)) {
      const res = await send(t, method, url, a.p1admin, payload);
      expect(res.statusCode, key).toBe(404);
      expect(res.body).not.toContain('FOREIGN_NAME');
    }
    expect((await rows(a, a.p2)).map((r) => r.value)).toEqual(['p2']);
    expect(envSecretNames(a)).toEqual([]);
  });

  it('an owner of another org gets 404 on every route and changes nothing', async () => {
    await clear(a, a.p1);
    await send(t, 'POST', varsUrl(a.p1), a.owner, { name: 'FOREIGN_NAME', value: 'keep' });
    for (const [key, method, url, payload] of routesOf(a.p1)) {
      const res = await send(t, method, url, bobOrgOwner, payload);
      expect(res.statusCode, key).toBe(404);
      expect(res.body).not.toContain('FOREIGN_NAME');
    }
    expect((await rows(a, a.p1)).map((r) => r.value)).toEqual(['keep']);
    expect(envSecretNames(a)).toEqual([]);
  });

  it('a custom role with secret:update only writes secrets and gets 403 on variable writes; setup:update only the reverse', async () => {
    await clear(a, a.p1);
    const secretWriter = await loginWithRole(t, a.orgId, 'pe-a-sw', await customRole(t, a.orgId, ['secret:update']));
    const varWriter = await loginWithRole(t, a.orgId, 'pe-a-vw', await customRole(t, a.orgId, ['setup:update']));
    const created = await send(t, 'POST', secretsUrl(a.p1), secretWriter, { name: 'S1', value: 'secret-one' });
    expect(created.statusCode).toBe(201);
    expect((await send(t, 'PUT', secretsUrl(a.p1, 'S1'), secretWriter, { value: 'secret-two' })).statusCode).toBe(200);
    expect((await send(t, 'POST', varsUrl(a.p1), secretWriter, { name: 'V1', value: '1' })).statusCode).toBe(403);
    expect((await send(t, 'GET', listUrl(a.p1, 'kind=secret'), secretWriter)).statusCode).toBe(403);
    const before = envSecretNames(a);
    const denied = await send(t, 'POST', secretsUrl(a.p1), varWriter, { name: 'S2', value: 'secret-three' });
    expect(denied.statusCode).toBe(403);
    expect((await send(t, 'PUT', secretsUrl(a.p1, 'S1'), varWriter, { value: 'secret-four' })).statusCode).toBe(403);
    expect((await send(t, 'DELETE', secretsUrl(a.p1, 'S1'), varWriter)).statusCode).toBe(403);
    expect(envSecretNames(a)).toEqual(before);
    expect((await rows(a, a.p1)).map((r) => r.name)).toEqual(['S1']);
    expect((await send(t, 'DELETE', secretsUrl(a.p1, 'S1'), secretWriter)).statusCode).toBe(204);
  });

  it('a custom role with setup:update only writes variables but cannot list; setup:read only lists but cannot write', async () => {
    await clear(a, a.p1);
    const writer = await loginWithRole(t, a.orgId, 'pe-a-writer', await customRole(t, a.orgId, ['setup:update']));
    const reader = await loginWithRole(t, a.orgId, 'pe-a-reader', await customRole(t, a.orgId, ['setup:read']));
    expect((await send(t, 'POST', varsUrl(a.p1), writer, { name: 'W', value: '1' })).statusCode).toBe(201);
    expect((await send(t, 'PUT', varsUrl(a.p1, 'W'), writer, { value: '2' })).statusCode).toBe(200);
    expect((await send(t, 'GET', listUrl(a.p1), writer)).statusCode).toBe(403);
    expect((await listAll(a, reader, a.p1)).items.map((e) => e.name)).toEqual(['W']);
    expect((await send(t, 'POST', varsUrl(a.p1), reader, { name: 'R', value: '1' })).statusCode).toBe(403);
    expect((await send(t, 'PUT', varsUrl(a.p1, 'W'), reader, { value: '3' })).statusCode).toBe(403);
    expect((await send(t, 'DELETE', varsUrl(a.p1, 'W'), reader)).statusCode).toBe(403);
    expect((await send(t, 'DELETE', varsUrl(a.p1, 'W'), writer)).statusCode).toBe(204);
  });
});

describe('variables', () => {
  it('POST creates (201), a repeat is 409 with the first value unchanged', async () => {
    await clear(a, a.p1);
    const res = await send(t, 'POST', varsUrl(a.p1), a.owner, { name: 'FOO', value: 'first' });
    expect(res.statusCode).toBe(201);
    expect(expectContract('projectEnv.createVar', res)).toEqual({
      name: 'FOO',
      kind: 'plain',
      value: 'first',
      updatedAt: expect.any(String),
      updatedBy: 'pe-a-owner',
    });
    const dup = await send(t, 'POST', varsUrl(a.p1), a.owner, { name: 'FOO', value: 'second' });
    expect(dup.statusCode).toBe(409);
    expect((await rows(a, a.p1)).map((r) => r.value)).toEqual(['first']);
  });

  it('a secret row of the same name makes a variable POST 409, and PUT or DELETE of it 404', async () => {
    await clear(a, a.p1);
    await seedEnvRows(t, a.orgId, a.p1, 1, 'secret');
    expect((await send(t, 'POST', varsUrl(a.p1), a.owner, { name: 'SEED_secret_1', value: 'x' })).statusCode).toBe(409);
    expect((await send(t, 'PUT', varsUrl(a.p1, 'SEED_secret_1'), a.owner, { value: 'x' })).statusCode).toBe(404);
    expect((await send(t, 'DELETE', varsUrl(a.p1, 'SEED_secret_1'), a.owner)).statusCode).toBe(404);
    expect((await rows(a, a.p1)).map((r) => [r.kind, r.value])).toEqual([['secret', null]]);
  });

  it('PUT edits and stamps the actor and time; PUT of a missing name is 404 and creates nothing', async () => {
    await clear(a, a.p1);
    await send(t, 'POST', varsUrl(a.p1), a.owner, { name: 'FOO', value: 'one' });
    await withOrg(t.db, a.orgId, (tx) =>
      tx.execute(sql`update project_env_vars set updated_at = now() - interval '1 day' where project_id = ${a.p1}`),
    );
    const before = (await listAll(a, a.owner, a.p1)).items[0]?.updatedAt ?? '';
    const res = await send(t, 'PUT', varsUrl(a.p1, 'FOO'), a.admin, { value: 'two' });
    const dto = expectContract('projectEnv.updateVar', res) as EnvEntryDto;
    expect(dto).toMatchObject({ name: 'FOO', value: 'two', updatedBy: 'pe-a-admin' });
    expect(Date.parse(dto.updatedAt)).toBeGreaterThan(Date.parse(before));
    const missing = await send(t, 'PUT', varsUrl(a.p1, 'NOPE'), a.owner, { value: 'x' });
    expect(missing.statusCode).toBe(404);
    expect((await rows(a, a.p1)).map((r) => r.name)).toEqual(['FOO']);
  });

  it('DELETE removes (204); a missing name is 404', async () => {
    await clear(a, a.p1);
    await send(t, 'POST', varsUrl(a.p1), a.owner, { name: 'FOO', value: 'one' });
    expectContract('projectEnv.removeVar', await send(t, 'DELETE', varsUrl(a.p1, 'FOO'), a.owner));
    expect(await rows(a, a.p1)).toEqual([]);
    expect((await send(t, 'DELETE', varsUrl(a.p1, 'FOO'), a.owner)).statusCode).toBe(404);
  });

  it('validation: invalid and reserved names at /name; long, line-break and NUL values at /value', async () => {
    await clear(a, a.p1);
    const pointers = async (payload: object) => {
      const res = await send(t, 'POST', varsUrl(a.p1), a.owner, payload);
      expect(res.statusCode).toBe(400);
      return res.json<{ errors: { pointer: string }[] }>().errors.map((e) => e.pointer);
    };
    expect(await pointers({ name: '1BAD', value: 'x' })).toEqual(['/name']);
    expect(await pointers({ name: 'PATH', value: 'x' })).toEqual(['/name']);
    expect(await pointers({ name: 'OK', value: 'a'.repeat(8193) })).toEqual(['/value']);
    expect(await pointers({ name: 'OK', value: 'a\nb' })).toEqual(['/value']);
    expect(await pointers({ name: 'OK', value: 'a\u0000b' })).toEqual(['/value']);
    const put = await send(t, 'PUT', varsUrl(a.p1, 'OK'), a.owner, { value: 'a\rb' });
    expect(put.statusCode).toBe(400);
    expect((await send(t, 'POST', varsUrl(a.p1), a.owner, { name: 'OK', value: 'a'.repeat(8192) })).statusCode).toBe(
      201,
    );
    expect(await rows(a, a.p1)).toHaveLength(1);
  });

  it('keeps leading and trailing spaces and an empty value verbatim', async () => {
    await clear(a, a.p1);
    await send(t, 'POST', varsUrl(a.p1), a.owner, { name: 'SPACED', value: '  a b  ' });
    await send(t, 'POST', varsUrl(a.p1), a.owner, { name: 'EMPTY', value: '' });
    const items = (await listAll(a, a.owner, a.p1)).items;
    expect(items.map((e) => [e.name, e.value])).toEqual([
      ['EMPTY', ''],
      ['SPACED', '  a b  '],
    ]);
    expect((await rows(a, a.p1)).map((r) => r.size_bytes)).toEqual([5, 13]);
  });
});

describe('list', () => {
  it('returns only the requested kind', async () => {
    await clear(a, a.p1);
    await seedEnvRows(t, a.orgId, a.p1, 2, 'plain');
    await seedEnvRows(t, a.orgId, a.p1, 3, 'secret');
    const plain = await listAll(a, a.owner, a.p1);
    expect(plain.total).toBe(2);
    expect(plain.items.every((e) => e.kind === 'plain' && e.value === 'v')).toBe(true);
    const secret = await listAll(a, a.owner, a.p1, 'kind=secret');
    expect(secret.total).toBe(3);
    expect(secret.items.every((e) => e.kind === 'secret' && e.value === null)).toBe(true);
  });

  it('pages 20 by default with a total; a page past the end is empty; pageSize 100 ok and 101 refused', async () => {
    await clear(a, a.p1);
    await seedEnvRows(t, a.orgId, a.p1, 23, 'plain');
    const p1 = await listAll(a, a.owner, a.p1, 'kind=plain');
    expect([p1.items.length, p1.total, p1.page, p1.pageSize]).toEqual([20, 23, 1, 20]);
    const p2 = await listAll(a, a.owner, a.p1, 'kind=plain&page=2');
    expect([p2.items.length, p2.total]).toEqual([3, 23]);
    const p3 = await listAll(a, a.owner, a.p1, 'kind=plain&page=3');
    expect([p3.items.length, p3.total]).toEqual([0, 23]);
    expect((await listAll(a, a.owner, a.p1, 'kind=plain&pageSize=100')).items).toHaveLength(23);
    expect((await send(t, 'GET', listUrl(a.p1, 'kind=plain&pageSize=101'), a.owner)).statusCode).toBe(400);
  });

  it('a missing or bad kind is 400', async () => {
    expect((await send(t, 'GET', listUrl(a.p1, ''), a.owner)).statusCode).toBe(400);
    expect((await send(t, 'GET', listUrl(a.p1, 'kind=other'), a.owner)).statusCode).toBe(400);
  });

  it('orders by name in byte order', async () => {
    await clear(a, a.p1);
    for (const name of ['b', 'Z', 'A1', '_X', 'a', 'B']) {
      await send(t, 'POST', varsUrl(a.p1), a.owner, { name, value: '1' });
    }
    expect((await listAll(a, a.owner, a.p1)).items.map((e) => e.name)).toEqual(['A1', 'B', 'Z', '_X', 'a', 'b']);
  });
});

describe('size total', () => {
  /** 31 rows of 8198 bytes, leaving 8006 bytes of the 262144. */
  async function fill(): Promise<void> {
    await clear(a, a.p1);
    await withOrg(t.db, a.orgId, (tx) =>
      tx.execute(sql`
        insert into project_env_vars (org_id, project_id, name, kind, value, size_bytes, updated_by)
        select ${a.orgId}::uuid, ${a.p1}::uuid, 'BIG_' || lpad(i::text, 2, '0'), 'plain', repeat('a', 8192), 8198, 'seed'
        from generate_series(1, 31) as i`),
    );
  }
  const total = async () => (await rows(a, a.p1)).reduce((n, r) => n + r.size_bytes, 0);

  it('accepts exactly 262144 bytes and refuses one more on create, with nothing written', async () => {
    await fill();
    const over = await send(t, 'POST', varsUrl(a.p1), a.owner, { name: 'LAST', value: 'a'.repeat(8003) });
    expect(over.statusCode).toBe(409);
    // the web tells the size 409 from the cap 409 by this text (contracts ENV_SIZE_DETAIL_PREFIX)
    expect(over.json<{ detail: string }>().detail).toBe(
      'Names and values together cannot exceed 262144 bytes (256 KiB) per project.',
    );
    expect(await rows(a, a.p1)).toHaveLength(31);
    const exact = await send(t, 'POST', varsUrl(a.p1), a.owner, { name: 'LAST', value: 'a'.repeat(8002) });
    expect(exact.statusCode).toBe(201);
    expect(await total()).toBe(TOTAL_LIMIT);
  });

  it('refuses one more byte on edit leaving the old value, and still allows a smaller edit at the limit', async () => {
    await fill();
    await send(t, 'POST', varsUrl(a.p1), a.owner, { name: 'LAST', value: 'a'.repeat(8002) });
    const over = await send(t, 'PUT', varsUrl(a.p1, 'LAST'), a.owner, { value: 'b'.repeat(8003) });
    expect(over.statusCode).toBe(409);
    expect((await rows(a, a.p1)).find((r) => r.name === 'LAST')?.value).toBe('a'.repeat(8002));
    const smaller = await send(t, 'PUT', varsUrl(a.p1, 'LAST'), a.owner, { value: 'c' });
    expect(smaller.statusCode).toBe(200);
    expect(await total()).toBe(TOTAL_LIMIT - 8001);
  });
});

describe('entry cap at the default', () => {
  it('refuses the 501st entry with 409 and writes nothing', async () => {
    await clear(a, a.p1);
    await seedEnvRows(t, a.orgId, a.p1, 400, 'plain');
    await seedEnvRows(t, a.orgId, a.p1, 100, 'secret');
    const res = await send(t, 'POST', varsUrl(a.p1), a.owner, { name: 'ONE_TOO_MANY', value: 'x' });
    expect(res.statusCode).toBe(409);
    // the web tells the cap 409 from the size 409 by this text (contracts ENV_CAP_DETAIL_PREFIX)
    expect(res.json<{ detail: string }>().detail).toBe(
      'This project already has the maximum of 500 environment entries.',
    );
    expect(await rows(a, a.p1)).toHaveLength(500);
  });

  it('reports an existing name at /name, not the limit, when the project is at the cap (BR-14)', async () => {
    await clear(a, a.p1);
    await seedEnvRows(t, a.orgId, a.p1, 400, 'plain');
    await seedEnvRows(t, a.orgId, a.p1, 100, 'secret');
    const res = await send(t, 'POST', varsUrl(a.p1), a.owner, { name: 'SEED_plain_1', value: 'other' });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ errors: { pointer: string }[] }>().errors.map((e) => e.pointer)).toEqual(['/name']);
    expect(await rows(a, a.p1)).toHaveLength(500);
  });
});

describe('concurrency (BR-22)', () => {
  it('two PUTs on different entries both persist; on the same entry one of them wins', async () => {
    await clear(a, a.p1);
    await send(t, 'POST', varsUrl(a.p1), a.owner, { name: 'ONE', value: '0' });
    await send(t, 'POST', varsUrl(a.p1), a.owner, { name: 'TWO', value: '0' });
    const both = await Promise.all([
      send(t, 'PUT', varsUrl(a.p1, 'ONE'), a.owner, { value: 'a' }),
      send(t, 'PUT', varsUrl(a.p1, 'TWO'), a.admin, { value: 'b' }),
    ]);
    expect(both.map((r) => r.statusCode)).toEqual([200, 200]);
    expect((await rows(a, a.p1)).map((r) => r.value)).toEqual(['a', 'b']);
    const same = await Promise.all([
      send(t, 'PUT', varsUrl(a.p1, 'ONE'), a.owner, { value: 'x' }),
      send(t, 'PUT', varsUrl(a.p1, 'ONE'), a.admin, { value: 'y' }),
    ]);
    expect(same.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(['x', 'y']).toContain((await rows(a, a.p1)).find((r) => r.name === 'ONE')?.value);
  });

  it('two POSTs of one name give one 2xx and one 409', async () => {
    await clear(a, a.p1);
    const res = await Promise.all([
      send(t, 'POST', varsUrl(a.p1), a.owner, { name: 'RACE', value: '1' }),
      send(t, 'POST', varsUrl(a.p1), a.admin, { name: 'RACE', value: '2' }),
    ]);
    expect(res.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await rows(a, a.p1)).toHaveLength(1);
  });
});

describe('secrets (BR-9 to BR-17, BR-23, BR-28)', () => {
  const VALUE = 'zq-secret-value-1';

  it('POST stores the value in a per-entry Secret and none in Postgres; the DTO carries value null', async () => {
    await clear(a, a.p1);
    const res = await send(t, 'POST', secretsUrl(a.p1), a.owner, { name: 'TOKEN', value: VALUE });
    expect(res.statusCode).toBe(201);
    expect(expectContract('projectEnv.createSecret', res)).toEqual({
      name: 'TOKEN',
      kind: 'secret',
      value: null,
      updatedAt: expect.any(String),
      updatedBy: 'pe-a-owner',
    });
    expect(res.body).not.toContain(VALUE);
    const [row] = await rows(a, a.p1);
    expect(row).toMatchObject({ name: 'TOKEN', kind: 'secret', value: null, size_bytes: 5 + VALUE.length });
    const id = await entryId(a, a.p1, 'TOKEN');
    expect(await t.secrets.get(projectEnvSecretName(a.orgId, id))).toEqual({ value: VALUE });
    const listed = await listAll(a, a.owner, a.p1, 'kind=secret');
    expect(listed.items).toEqual([expect.objectContaining({ name: 'TOKEN', kind: 'secret', value: null })]);
    expect(JSON.stringify(listed)).not.toContain(VALUE);
  });

  it('PUT replaces the Secret at the same id and stamps actor, time and size; a missing name is 404', async () => {
    await clear(a, a.p1);
    await send(t, 'POST', secretsUrl(a.p1), a.owner, { name: 'TOKEN', value: VALUE });
    const id = await entryId(a, a.p1, 'TOKEN');
    await withOrg(t.db, a.orgId, (tx) =>
      tx.execute(sql`update project_env_vars set updated_at = now() - interval '1 day' where project_id = ${a.p1}`),
    );
    const res = await send(t, 'PUT', secretsUrl(a.p1, 'TOKEN'), a.admin, { value: 'another-secret-value-22' });
    const dto = expectContract('projectEnv.updateSecret', res) as EnvEntryDto;
    expect(dto).toMatchObject({ name: 'TOKEN', kind: 'secret', value: null, updatedBy: 'pe-a-admin' });
    expect(Date.parse(dto.updatedAt)).toBeGreaterThan(Date.now() - 60_000);
    expect(await entryId(a, a.p1, 'TOKEN')).toBe(id);
    expect(await t.secrets.get(projectEnvSecretName(a.orgId, id))).toEqual({ value: 'another-secret-value-22' });
    expect((await rows(a, a.p1))[0]?.size_bytes).toBe(5 + 'another-secret-value-22'.length);
    const missing = await send(t, 'PUT', secretsUrl(a.p1, 'NOPE'), a.owner, { value: VALUE });
    expect(missing.statusCode).toBe(404);
    expect(envSecretNames(a)).toEqual([projectEnvSecretName(a.orgId, id)]);
  });

  it('DELETE removes the row and the Secret (204); a missing name is 404', async () => {
    await clear(a, a.p1);
    await send(t, 'POST', secretsUrl(a.p1), a.owner, { name: 'TOKEN', value: VALUE });
    const id = await entryId(a, a.p1, 'TOKEN');
    expectContract('projectEnv.removeSecret', await send(t, 'DELETE', secretsUrl(a.p1, 'TOKEN'), a.owner));
    expect(await rows(a, a.p1)).toEqual([]);
    expect(await t.secrets.get(projectEnvSecretName(a.orgId, id))).toBeNull();
    expect((await send(t, 'DELETE', secretsUrl(a.p1, 'TOKEN'), a.owner)).statusCode).toBe(404);
  });

  it('refuses 5 characters with 400 at /value and accepts 6, never echoing the value', async () => {
    await clear(a, a.p1);
    const short = await send(t, 'POST', secretsUrl(a.p1), a.owner, { name: 'TOKEN', value: 'abcde' });
    expect(short.statusCode).toBe(400);
    expect(short.json<{ errors: { pointer: string }[] }>().errors.map((e) => e.pointer)).toEqual(['/value']);
    expect(short.body).not.toContain('abcde');
    expect(await rows(a, a.p1)).toEqual([]);
    expect(envSecretNames(a)).toEqual([]);
    expect((await send(t, 'POST', secretsUrl(a.p1), a.owner, { name: 'TOKEN', value: 'abcdef' })).statusCode).toBe(201);
    expect((await send(t, 'PUT', secretsUrl(a.p1, 'TOKEN'), a.owner, { value: 'vwxyz' })).statusCode).toBe(400);
  });

  it('BR-14: a name used by the other kind is 409 and nothing is written; wrong-kind PUT or DELETE is 404', async () => {
    await clear(a, a.p1);
    await send(t, 'POST', varsUrl(a.p1), a.owner, { name: 'PLAIN_ONE', value: 'plain-value' });
    await send(t, 'POST', secretsUrl(a.p1), a.owner, { name: 'SECRET_ONE', value: VALUE });
    const names = envSecretNames(a);
    const dupSecret = await send(t, 'POST', secretsUrl(a.p1), a.owner, { name: 'PLAIN_ONE', value: 'other-secret' });
    expect(dupSecret.statusCode).toBe(409);
    expect(dupSecret.json<{ errors: { pointer: string }[] }>().errors.map((e) => e.pointer)).toEqual(['/name']);
    expect((await send(t, 'POST', varsUrl(a.p1), a.owner, { name: 'SECRET_ONE', value: 'x' })).statusCode).toBe(409);
    expect((await send(t, 'PUT', secretsUrl(a.p1, 'PLAIN_ONE'), a.owner, { value: 'other-secret' })).statusCode).toBe(
      404,
    );
    expect((await send(t, 'DELETE', secretsUrl(a.p1, 'PLAIN_ONE'), a.owner)).statusCode).toBe(404);
    expect((await send(t, 'PUT', varsUrl(a.p1, 'SECRET_ONE'), a.owner, { value: 'x' })).statusCode).toBe(404);
    expect((await send(t, 'DELETE', varsUrl(a.p1, 'SECRET_ONE'), a.owner)).statusCode).toBe(404);
    expect(envSecretNames(a)).toEqual(names);
    expect(names).toHaveLength(1);
    expect((await rows(a, a.p1)).map((r) => [r.name, r.kind, r.value])).toEqual([
      ['PLAIN_ONE', 'plain', 'plain-value'],
      ['SECRET_ONE', 'secret', null],
    ]);
    const id = await entryId(a, a.p1, 'SECRET_ONE');
    expect(await t.secrets.get(projectEnvSecretName(a.orgId, id))).toEqual({ value: VALUE });
  });

  it('BR-17: no secret value in any 400, 404, 409 or 500 body, in audit_log, in stdout or stderr, or in a Secret name', async () => {
    await clear(a, a.p1);
    const out: string[] = [];
    const spies = [
      vi.spyOn(process.stdout, 'write').mockImplementation((c: string | Uint8Array) => (out.push(String(c)), true)),
      vi.spyOn(process.stderr, 'write').mockImplementation((c: string | Uint8Array) => (out.push(String(c)), true)),
    ];
    const secretText = 'leak-check-value-9';
    const bodies: string[] = [];
    try {
      await send(t, 'POST', varsUrl(a.p1), a.owner, { name: 'TAKEN', value: 'v' });
      for (const [method, url, payload] of [
        ['POST', secretsUrl(a.p1), { name: '1BAD', value: secretText }],
        ['POST', secretsUrl(a.p1), { name: 'TAKEN', value: secretText }],
        ['PUT', secretsUrl(a.p1, 'MISSING'), { value: secretText }],
        ['PUT', secretsUrl(randomUUID(), 'MISSING'), { value: secretText }],
        ['PUT', secretsUrl(a.p1, 'TAKEN'), { value: secretText }],
      ] as [Method, string, object][]) {
        bodies.push((await send(t, method, url, a.owner, payload)).body);
      }
      const spy = vi.spyOn(t.secrets, 'put').mockRejectedValueOnce(new Error(`boom ${secretText}`));
      const failed = await send(t, 'POST', secretsUrl(a.p1), a.owner, { name: 'NEW_ONE', value: secretText });
      spy.mockRestore();
      expect(failed.statusCode).toBe(500);
      bodies.push(failed.body);
      await send(t, 'POST', secretsUrl(a.p1), a.owner, { name: 'GOOD_ONE', value: secretText });
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
    for (const body of bodies) expect(body).not.toContain(secretText);
    expect(out.join('')).not.toContain(secretText);
    const audit = await withOrg(t.db, a.orgId, (tx) => tx.execute(sql`select * from audit_log`));
    expect(JSON.stringify(audit.rows)).not.toContain(secretText);
    expect(envSecretNames(a).join('')).not.toContain(secretText);
  });

  it('BR-23: a failing store put is a generic 500 with no row, an unchanged list and no value in body or log', async () => {
    await clear(a, a.p1);
    await send(t, 'POST', varsUrl(a.p1), a.owner, { name: 'KEEP', value: 'k' });
    const errors = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const spy = vi.spyOn(t.secrets, 'put').mockRejectedValueOnce(new Error(`boom ${VALUE}`));
    const res = await send(t, 'POST', secretsUrl(a.p1), a.owner, { name: 'TOKEN', value: VALUE });
    spy.mockRestore();
    const logged = JSON.stringify(errors.mock.calls);
    errors.mockRestore();
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain(VALUE);
    expect(logged).not.toContain(VALUE);
    expect((await rows(a, a.p1)).map((r) => r.name)).toEqual(['KEEP']);
    expect((await listAll(a, a.owner, a.p1, 'kind=secret')).total).toBe(0);
    expect(envSecretNames(a)).toEqual([]);
  });

  it('a failing store put on update is a generic 500 and keeps the old Secret', async () => {
    await clear(a, a.p1);
    await send(t, 'POST', secretsUrl(a.p1), a.owner, { name: 'TOKEN', value: VALUE });
    const id = await entryId(a, a.p1, 'TOKEN');
    const spy = vi.spyOn(t.secrets, 'put').mockRejectedValueOnce(new Error(`boom ${VALUE}`));
    const res = await send(t, 'PUT', secretsUrl(a.p1, 'TOKEN'), a.owner, { value: 'new-secret-value' });
    spy.mockRestore();
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('new-secret-value');
    expect(await t.secrets.get(projectEnvSecretName(a.orgId, id))).toEqual({ value: VALUE });
  });

  it('a row write failing after the Secret put (project gone) leaves an inert Secret and no "set" row', async () => {
    const connectionId = await installFake(t, a.owner);
    const gone = (await makeProject(t, a.owner, connectionId)).projectId;
    await clear(a, gone);
    const slow = slowStore(t);
    const putCalls = vi.spyOn(t.secrets, 'put');
    try {
      const pending = send(t, 'POST', secretsUrl(gone), a.owner, { name: 'ORPHAN', value: VALUE });
      await vi.waitFor(() => expect(putCalls).toHaveBeenCalled());
      await withOrg(t.db, a.orgId, (tx) => tx.execute(sql`delete from projects where id = ${gone}`));
      slow.release();
      const res = await pending;
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain(VALUE);
    } finally {
      slow.release();
      putCalls.mockRestore();
      slow.restore();
    }
    expect(await rows(a, gone)).toEqual([]);
    expect(envSecretNames(a)).toHaveLength(1);
    await clear(a, gone);
  });

  it('remove with a rejecting store delete still removes the entry and logs only the error class', async () => {
    await clear(a, a.p1);
    await send(t, 'POST', secretsUrl(a.p1), a.owner, { name: 'TOKEN', value: VALUE });
    class StoreDownError extends Error {
      override name = 'StoreDownError';
    }
    const errors = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const spy = vi.spyOn(t.secrets, 'delete').mockRejectedValueOnce(new StoreDownError(`boom ${VALUE}`));
    const res = await send(t, 'DELETE', secretsUrl(a.p1, 'TOKEN'), a.owner);
    spy.mockRestore();
    const logged = JSON.stringify(errors.mock.calls);
    errors.mockRestore();
    expect(res.statusCode).toBe(204);
    expect(await rows(a, a.p1)).toEqual([]);
    expect((await listAll(a, a.owner, a.p1, 'kind=secret')).total).toBe(0);
    expect(logged).toContain('StoreDownError');
    expect(logged).not.toContain(VALUE);
    expect(logged).not.toContain('boom');
    for (const n of envSecretNames(a)) await t.secrets.delete(n);
  });

  it('BR-28: an update racing a remove and re-create under the same name is 404 and leaves no Secret for the old entry', async () => {
    await clear(a, a.p1);
    await send(t, 'POST', secretsUrl(a.p1), a.owner, { name: 'TOKEN', value: VALUE });
    const oldName = projectEnvSecretName(a.orgId, await entryId(a, a.p1, 'TOKEN'));
    const slow = slowStore(t);
    const putCalls = vi.spyOn(t.secrets, 'put');
    try {
      const update = send(t, 'PUT', secretsUrl(a.p1, 'TOKEN'), a.owner, { value: 'racing-secret-value' });
      await vi.waitFor(() => expect(putCalls).toHaveBeenCalledTimes(1));
      expect((await send(t, 'DELETE', secretsUrl(a.p1, 'TOKEN'), a.owner)).statusCode).toBe(204);
      slow.restore(); // the in-flight put keeps waiting; the re-create writes at once and commits first
      const recreate = await send(t, 'POST', secretsUrl(a.p1), a.owner, {
        name: 'TOKEN',
        value: 'second-secret-value',
      });
      expect(recreate.statusCode).toBe(201);
      slow.release();
      expect((await update).statusCode).toBe(404);
    } finally {
      slow.release();
      putCalls.mockRestore();
      slow.restore();
    }
    const newName = projectEnvSecretName(a.orgId, await entryId(a, a.p1, 'TOKEN'));
    expect(newName).not.toBe(oldName);
    expect(await t.secrets.get(oldName)).toBeNull();
    expect(envSecretNames(a)).toEqual([newName]);
    for (const n of envSecretNames(a)) await t.secrets.delete(n);
  });

  it('BR-28: an update whose project is deleted during the store put is 404 and leaves no Secret', async () => {
    const connectionId = await installFake(t, a.owner);
    const gone = (await makeProject(t, a.owner, connectionId)).projectId;
    await clear(a, gone);
    await send(t, 'POST', secretsUrl(gone), a.owner, { name: 'TOKEN', value: VALUE });
    const slow = slowStore(t);
    const putCalls = vi.spyOn(t.secrets, 'put');
    try {
      const update = send(t, 'PUT', secretsUrl(gone, 'TOKEN'), a.owner, { value: 'racing-secret-value' });
      await vi.waitFor(() => expect(putCalls).toHaveBeenCalled());
      await withOrg(t.db, a.orgId, (tx) => tx.execute(sql`delete from projects where id = ${gone}`));
      slow.release();
      expect((await update).statusCode).toBe(404);
    } finally {
      slow.release();
      putCalls.mockRestore();
      slow.restore();
    }
    expect(envSecretNames(a)).toEqual([]);
  });

  it('BR-28: an update racing a remove is 404 and leaves no Secret for that entry', async () => {
    await clear(a, a.p1);
    await send(t, 'POST', secretsUrl(a.p1), a.owner, { name: 'TOKEN', value: VALUE });
    const name = projectEnvSecretName(a.orgId, await entryId(a, a.p1, 'TOKEN'));
    const slow = slowStore(t);
    const putCalls = vi.spyOn(t.secrets, 'put');
    try {
      const update = send(t, 'PUT', secretsUrl(a.p1, 'TOKEN'), a.owner, { value: 'racing-secret-value' });
      await vi.waitFor(() => expect(putCalls).toHaveBeenCalled());
      expect((await send(t, 'DELETE', secretsUrl(a.p1, 'TOKEN'), a.owner)).statusCode).toBe(204);
      slow.release();
      expect((await update).statusCode).toBe(404);
    } finally {
      slow.release();
      putCalls.mockRestore();
      slow.restore();
    }
    expect(await rows(a, a.p1)).toEqual([]);
    expect(await t.secrets.get(name)).toBeNull();
  });

  describe('size and cap count both kinds', () => {
    /** 31 secret rows of 8198 bytes each, leaving 8006 bytes of the 262144. */
    async function fillWithSecrets(): Promise<void> {
      await clear(a, a.p1);
      await withOrg(t.db, a.orgId, (tx) =>
        tx.execute(sql`
          insert into project_env_vars (org_id, project_id, name, kind, value, size_bytes, updated_by)
          select ${a.orgId}::uuid, ${a.p1}::uuid, 'BIG_' || lpad(i::text, 2, '0'), 'secret', null, 8198, 'seed'
          from generate_series(1, 31) as i`),
      );
    }

    it('31 secrets plus one more entry over the total is 409 for either kind, with no Secret written', async () => {
      await fillWithSecrets();
      const before = envSecretNames(a);
      const secret = await send(t, 'POST', secretsUrl(a.p1), a.owner, { name: 'LAST', value: 'a'.repeat(8003) });
      expect(secret.statusCode).toBe(409);
      const plain = await send(t, 'POST', varsUrl(a.p1), a.owner, { name: 'LAST', value: 'a'.repeat(8003) });
      expect(plain.statusCode).toBe(409);
      expect(envSecretNames(a)).toEqual(before);
      expect(await rows(a, a.p1)).toHaveLength(31);
      const exact = await send(t, 'POST', secretsUrl(a.p1), a.owner, { name: 'LAST', value: 'a'.repeat(8002) });
      expect(exact.statusCode).toBe(201);
    });

    it('an update over the total is 409 and keeps the old Secret; a racing add that loses the re-check deletes its Secret', async () => {
      await fillWithSecrets();
      await send(t, 'POST', secretsUrl(a.p1), a.owner, { name: 'LAST', value: 'a'.repeat(100) });
      const id = await entryId(a, a.p1, 'LAST');
      const over = await send(t, 'PUT', secretsUrl(a.p1, 'LAST'), a.owner, { value: 'b'.repeat(8100) });
      expect(over.statusCode).toBe(409);
      expect(await t.secrets.get(projectEnvSecretName(a.orgId, id))).toEqual({ value: 'a'.repeat(100) });
      await send(t, 'DELETE', secretsUrl(a.p1, 'LAST'), a.owner);
      const kept = envSecretNames(a);

      const slow = slowStore(t);
      const putCalls = vi.spyOn(t.secrets, 'put');
      let res;
      try {
        const both = Promise.all([
          send(t, 'POST', secretsUrl(a.p1), a.owner, { name: 'RACE_A', value: 'a'.repeat(4000) }),
          send(t, 'POST', secretsUrl(a.p1), a.admin, { name: 'RACE_B', value: 'b'.repeat(4000) }),
        ]);
        await vi.waitFor(() => expect(putCalls).toHaveBeenCalledTimes(2));
        slow.release();
        res = await both;
      } finally {
        slow.release();
        putCalls.mockRestore();
        slow.restore();
      }
      expect(res.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      expect(envSecretNames(a)).toHaveLength(kept.length + 1);
      expect(await rows(a, a.p1)).toHaveLength(32);
    });
  });

  it('holds no database lock while the store put is in flight', async () => {
    await clear(a, a.p1);
    const slow = slowStore(t);
    const putCalls = vi.spyOn(t.secrets, 'put');
    try {
      const pending = send(t, 'POST', secretsUrl(a.p1), a.owner, { name: 'SLOW', value: VALUE });
      await vi.waitFor(() => expect(putCalls).toHaveBeenCalled());
      const script = await send(t, 'PUT', `/api/projects/${a.p1}/setup-script`, a.owner, {
        body: 'echo lock',
        baseVersion: null,
      });
      expect(script.statusCode).toBeLessThan(300);
      expect((await send(t, 'POST', varsUrl(a.p1), a.owner, { name: 'DURING', value: '1' })).statusCode).toBe(201);
      expect((await send(t, 'GET', listUrl(a.p1), a.owner)).statusCode).toBe(200);
      const probe = await t.db.pool.connect();
      try {
        await probe.query('begin');
        await probe.query("select set_config('app.org_id', $1, true)", [a.orgId]);
        const locked = await probe.query('select id from projects where id = $1 for update nowait', [a.p1]);
        expect(locked.rowCount).toBe(1);
        await probe.query('rollback');
      } finally {
        probe.release();
      }
      slow.release();
      expect((await pending).statusCode).toBe(201);
    } finally {
      slow.release();
      putCalls.mockRestore();
      slow.restore();
    }
  });
});

describe('audit', () => {
  it('each variable route writes one row with action, actor, project, name and kind, and no value', async () => {
    await clear(a, a.p1);
    const before = await auditRows();
    await send(t, 'POST', varsUrl(a.p1), a.owner, { name: 'AUD_ONE', value: 'audit-secret-text' });
    await send(t, 'PUT', varsUrl(a.p1, 'AUD_ONE'), a.owner, { value: 'audit-secret-text-2' });
    await send(t, 'DELETE', varsUrl(a.p1, 'AUD_ONE'), a.owner);
    await send(t, 'GET', listUrl(a.p1), a.owner);
    const fresh = (await auditRows()).slice(before.length);
    expect(fresh.map((r) => r.action)).toEqual([
      'POST projectEnv.createVar',
      'PUT projectEnv.updateVar',
      'DELETE projectEnv.removeVar',
    ]);
    for (const r of fresh) {
      expect(r).toMatchObject({ target_id: a.p1, payload: { name: 'AUD_ONE', kind: 'plain' } });
      expect(r.actor_user_id).not.toBeNull();
      expect(JSON.stringify(r)).not.toContain('audit-secret-text');
    }
  });

  it('each secret route writes one row with kind secret, the name and no value', async () => {
    await clear(a, a.p1);
    const before = await auditRows();
    await send(t, 'POST', secretsUrl(a.p1), a.owner, { name: 'AUD_SEC', value: 'audit-secret-text' });
    await send(t, 'PUT', secretsUrl(a.p1, 'AUD_SEC'), a.owner, { value: 'audit-secret-text-2' });
    await send(t, 'DELETE', secretsUrl(a.p1, 'AUD_SEC'), a.owner);
    const fresh = (await auditRows()).slice(before.length);
    expect(fresh.map((r) => r.action)).toEqual([
      'POST projectEnv.createSecret',
      'PUT projectEnv.updateSecret',
      'DELETE projectEnv.removeSecret',
    ]);
    for (const r of fresh) {
      expect(r).toMatchObject({ target_id: a.p1, payload: { name: 'AUD_SEC', kind: 'secret' } });
      expect(JSON.stringify(r)).not.toContain('audit-secret-text');
    }
  });

  async function auditRows() {
    const r = await withOrg(t.db, a.orgId, (tx) =>
      tx.execute(
        sql`select action, actor_user_id, target_id, payload from audit_log where action like '% projectEnv.%' order by at, id`,
      ),
    );
    return r.rows as { action: string; actor_user_id: string | null; target_id: string; payload: object }[];
  }
});

describe('entry cap lowered by config', () => {
  let t2: TestApp;
  let c: Cast;
  beforeAll(async () => {
    t2 = await createTestApp({
      env: { FAKE_STATE_DIR: freshStateDir(), PROJECT_ENV_MAX_ENTRIES: '3' },
      wrapAdapters: wideFakeRepos,
    });
    c = await buildCast(t2, 'pe-cap');
  });
  afterAll(async () => {
    await t2.close();
  });

  it('refuses an add at the cap, while edit and remove still work above it', async () => {
    await clear(c, c.p1);
    await seedEnvRows(t2, c.orgId, c.p1, 5, 'plain');
    const add = await send(t2, 'POST', varsUrl(c.p1), c.owner, { name: 'NEW', value: 'x' });
    expect(add.statusCode).toBe(409);
    expect(await rows(c, c.p1)).toHaveLength(5);
    expect((await send(t2, 'PUT', varsUrl(c.p1, 'SEED_plain_1'), c.owner, { value: 'edited' })).statusCode).toBe(200);
    expect((await send(t2, 'DELETE', varsUrl(c.p1, 'SEED_plain_2'), c.owner)).statusCode).toBe(204);
    expect(await rows(c, c.p1)).toHaveLength(4);
  });

  it('two POSTs for the last free slot give one 2xx and one 409, and the count equals the cap', async () => {
    await clear(c, c.p1);
    await seedEnvRows(t2, c.orgId, c.p1, 2, 'plain');
    const res = await Promise.all([
      send(t2, 'POST', varsUrl(c.p1), c.owner, { name: 'SLOT_A', value: '1' }),
      send(t2, 'POST', varsUrl(c.p1), c.admin, { name: 'SLOT_B', value: '2' }),
    ]);
    expect(res.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await rows(c, c.p1)).toHaveLength(3);
  });
});
