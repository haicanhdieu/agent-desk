import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrg } from '@agentdesk/db';
import type { SetupScriptDto, SetupScriptVersionDto } from '@agentdesk/contracts';
import { createTestApp, type TestApp } from './helpers/app';
import { loginAs } from './helpers/auth';
import { expectContract } from './helpers/contract';
import { freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';

let t: TestApp;
let alice: string;
let bob: string;
let carol: string;
let aliceOrg: string;
let connectionId: string;
let projectId: string;

beforeAll(async () => {
  t = await createTestApp({ env: { FAKE_STATE_DIR: freshStateDir() }, wrapAdapters: wideFakeRepos });
  alice = await loginAs(t, 'alice');
  bob = await loginAs(t, 'bob');
  carol = await loginAs(t, 'carol');
  connectionId = await installFake(t, alice);
  aliceOrg = ((await t.db.pool.query("select id from organization where slug = 'alice'")).rows[0] as { id: string }).id;
  // carol is a plain member of alice's org (not the project's creator, not the owner), with it as her active org.
  await t.db.pool.query(
    `insert into member (id, organization_id, user_id, role, created_at)
     select $2, $1, id, 'member', now() from "user" where handle = 'carol'`,
    [aliceOrg, randomUUID()],
  );
  await t.db.pool.query(
    `update session set active_organization_id = $1 where user_id = (select id from "user" where handle = 'carol')`,
    [aliceOrg],
  );
});
afterAll(async () => {
  await t.close();
});

const base = (id = projectId) => `/api/projects/${id}/setup-script`;
const put = (payload: object, cookie = alice, id = projectId) =>
  t.app.inject({ method: 'PUT', url: base(id), headers: { cookie }, payload });
const get = (path = '', cookie = alice, id = projectId) =>
  t.app.inject({ method: 'GET', url: base(id) + path, headers: { cookie } });

/** Each test works on its own project (alice is its creator) so version numbers start from none. */
async function freshProject(): Promise<void> {
  projectId = (await makeProject(t, alice, connectionId)).projectId;
}

describe('setup script API', () => {
  it('GET with no versions is null', async () => {
    await freshProject();
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(expectContract('setupScript.get', res)).toBeNull();
  });

  it('PUT creates v1, then v2 on the current base; a stale base is a 409 problem', async () => {
    await freshProject();
    const v1 = await put({ body: 'echo 1', baseVersion: null, note: 'first' });
    expect(v1.statusCode).toBe(200);
    expect(expectContract('setupScript.put', v1)).toMatchObject({
      version: 1,
      body: 'echo 1',
      note: 'first',
      createdBy: 'alice',
    });
    const v2 = await put({ body: 'echo 2', baseVersion: 1 });
    expect((expectContract('setupScript.put', v2) as SetupScriptDto).version).toBe(2);
    const stale = await put({ body: 'echo 3', baseVersion: 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.headers['content-type']).toContain('application/problem+json');
    const nullBase = await put({ body: 'echo 3', baseVersion: null });
    expect(nullBase.statusCode).toBe(409);
    expect(((await get()).json() as SetupScriptDto).version).toBe(2);
  });

  it('stores body byte-exact: CRLF, no trailing newline, emoji', async () => {
    await freshProject();
    const body = 'echo "héllo 🚀"\r\nnpm ci\r\n\r\nexit 0';
    expect((await put({ body, baseVersion: null })).statusCode).toBe(200);
    const cur = (await get().then((r) => r.json())) as SetupScriptDto;
    expect(cur.body).toBe(body);
    const stored = await withOrg(t.db, aliceOrg, (tx) =>
      tx.execute(sql`select body from setup_script_versions where project_id = ${projectId}`),
    );
    expect((stored.rows[0] as { body: string }).body).toBe(body);
  });

  it('rejects 65537 bytes with 400 and accepts exactly 65536', async () => {
    await freshProject();
    expect((await put({ body: 'a'.repeat(65537), baseVersion: null })).statusCode).toBe(400);
    expect((await put({ body: 'a'.repeat(65536), baseVersion: null })).statusCode).toBe(200);
  });

  it('rejects a NUL character with 400 (never a 500 that could log the body)', async () => {
    await freshProject();
    const res = await put({ body: 'a\u0000b', baseVersion: null });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('a\u0000b');
  });

  it('allows an empty body (no setup)', async () => {
    await freshProject();
    const res = await put({ body: '', baseVersion: null });
    expect((expectContract('setupScript.put', res) as SetupScriptDto).body).toBe('');
  });

  it('non-creator member: PUT 403, GET 200; another org 404', async () => {
    await freshProject();
    await put({ body: 'echo a', baseVersion: null });
    expect((await put({ body: 'x', baseVersion: 1 }, carol)).statusCode).toBe(403);
    expect((await get('', carol)).statusCode).toBe(200);
    expect((await get('/versions', carol)).statusCode).toBe(200);
    expect((await put({ body: 'x', baseVersion: 1 }, bob)).statusCode).toBe(404);
    expect((await get('', bob)).statusCode).toBe(404);
    expect((await get('/versions', bob)).statusCode).toBe(404);
    expect((await get('/versions/1', bob)).statusCode).toBe(404);
    expect(((await get().then((r) => r.json())) as SetupScriptDto).version).toBe(1);
  });

  it('PUT to an unknown project is 404', async () => {
    expect((await put({ body: 'x', baseVersion: null }, alice, randomUUID())).statusCode).toBe(404);
  });

  it('versions list has no body; version N returns its body; unknown version 404; huge version 400', async () => {
    await freshProject();
    await put({ body: 'one', baseVersion: null });
    await put({ body: 'two', baseVersion: 1, note: 'n2' });
    const listRes = await get('/versions');
    const list = expectContract('setupScript.versions', listRes) as SetupScriptVersionDto[];
    expect(list.map((v) => v.version)).toEqual([2, 1]);
    for (const v of listRes.json() as object[]) expect(v).not.toHaveProperty('body');
    const v1 = expectContract('setupScript.version', await get('/versions/1')) as SetupScriptDto;
    expect(v1.body).toBe('one');
    expect((await get('/versions/3')).statusCode).toBe(404);
    expect((await get('/versions/9999999999')).statusCode).toBe(400);
  });

  it('restore is a PUT with version N body, creating N+1', async () => {
    await freshProject();
    await put({ body: 'one', baseVersion: null });
    await put({ body: 'two', baseVersion: 1 });
    const old = (await get('/versions/1').then((r) => r.json())) as SetupScriptDto;
    const restored = (await put({ body: old.body, baseVersion: 2, note: 'restore v1' }).then((r) =>
      r.json(),
    )) as SetupScriptDto;
    expect(restored).toMatchObject({ version: 3, body: 'one' });
    expect(((await get('/versions').then((r) => r.json())) as unknown[]).length).toBe(3);
  });

  it('versions stay readable, with the user id as createdBy, after the creator user row is deleted', async () => {
    await freshProject();
    const dave = await loginAs(t, 'dave');
    const daveId = ((await t.db.pool.query(`select id from "user" where handle = 'dave'`)).rows[0] as { id: string })
      .id;
    await t.db.pool.query(
      `insert into member (id, organization_id, user_id, role, created_at) values ($1, $2, $3, 'owner', now())`,
      [randomUUID(), aliceOrg, daveId],
    );
    await t.db.pool.query(`update session set active_organization_id = $1 where user_id = $2`, [aliceOrg, daveId]);
    await put({ body: 'one', baseVersion: null });
    expect((await put({ body: 'two', baseVersion: 1 }, dave)).statusCode).toBe(200);
    await t.db.pool.query(`delete from "user" where id = $1`, [daveId]);

    const cur = (await get().then((r) => r.json())) as SetupScriptDto;
    expect(cur).toMatchObject({ version: 2, body: 'two', createdBy: daveId });
    const list = (await get('/versions').then((r) => r.json())) as SetupScriptVersionDto[];
    expect(list.map((v) => [v.version, v.createdBy])).toEqual([
      [2, daveId],
      [1, 'alice'],
    ]);
    expect(((await get('/versions/2').then((r) => r.json())) as SetupScriptDto).body).toBe('two');
    expect((await put({ body: 'three', baseVersion: 2 })).statusCode).toBe(200);
  });

  it('two parallel PUTs with the same base: exactly one wins', async () => {
    await freshProject();
    const [a, b] = await Promise.all([put({ body: 'A', baseVersion: null }), put({ body: 'B', baseVersion: null })]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
  });

  it('audit_log payload carries sha256 and bytes, never the script', async () => {
    await freshProject();
    const body = 'echo SECRET_VALUE_DO_NOT_LOG 🚀';
    await put({ body, baseVersion: null, note: 'audited' });
    const rows = await withOrg(t.db, aliceOrg, (tx) =>
      tx.execute(sql`select payload from audit_log where action = 'PUT setupScript.put' and target_id = ${projectId}`),
    );
    expect(rows.rows).toHaveLength(1);
    const payload = (rows.rows[0] as { payload: Record<string, unknown> }).payload;
    expect(payload).not.toHaveProperty('body');
    expect(payload).toMatchObject({
      sha256: createHash('sha256').update(body, 'utf8').digest('hex'),
      bytes: Buffer.byteLength(body, 'utf8'),
      note: 'audited',
      baseVersion: null,
    });
    expect(JSON.stringify(rows.rows)).not.toContain('SECRET_VALUE_DO_NOT_LOG');
  });
});
