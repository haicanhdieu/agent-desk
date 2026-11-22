import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page, PlatformAdminDto } from '@agentdesk/contracts';
import { FORBIDDEN_DETAIL } from '../src/access/authorize';
import { createTestApp, type TestApp } from './helpers/app';
import { asPlatformAdmin, createOrg, inviteAndLogin, loginAs, userIdOf } from './helpers/auth';
import { expectContract } from './helpers/contract';
import { installFake, makeProject, wideFakeRepos } from './helpers/fixtures';

let t: TestApp;
let admin: string;
const logLines: Record<string, unknown>[] = [];

beforeAll(async () => {
  const logger = pino(
    { level: 'info' },
    {
      write: (line: string) => {
        logLines.push(JSON.parse(line) as Record<string, unknown>);
      },
    },
  );
  t = await createTestApp({ logger, wrapAdapters: wideFakeRepos });
  admin = await asPlatformAdmin(t);
});
afterAll(async () => {
  await t.close();
});

const list = (cookie: string, query = '', headers: Record<string, string> = {}) =>
  t.app.inject({ method: 'GET', url: `/api/platform/admins${query}`, headers: { cookie, ...headers } });

const listAll = async (): Promise<Page<PlatformAdminDto>> => {
  const res = await list(admin, '?pageSize=100');
  expectContract('platform.listAdmins', res);
  return res.json<Page<PlatformAdminDto>>();
};

describe('GET /api/platform/admins', () => {
  it('BR-1: lists every entry with exactly the documented keys', async () => {
    const adminId = await userIdOf(t, 'admin');
    await t.db.pool.query('insert into platform_admins (email, granted_by) values ($1, $2), ($3, $4), ($5, null)', [
      'lst-granted@dev.local',
      adminId,
      'lst-stray@dev.local',
      randomUUID(),
      'lst-noacct@dev.local',
    ]);
    await loginAs(t, 'lst-granted');
    await loginAs(t, 'lst-stray');

    const res = await list(admin, '?pageSize=100');
    expectContract('platform.listAdmins', res);
    const raw = res.json<{ items: Record<string, unknown>[] }>().items;
    for (const item of raw)
      expect(Object.keys(item).sort()).toEqual(['email', 'grantedAt', 'grantedBy', 'handle', 'id', 'name', 'userId']);
    const byEmail = (email: string) => raw.find((i) => i['email'] === email);

    const self = byEmail('admin@dev.local');
    expect(self).toMatchObject({ userId: adminId, handle: 'admin', grantedBy: null });
    expect(typeof self?.['name']).toBe('string');

    const granted = byEmail('lst-granted@dev.local');
    expect(granted?.['userId']).toBe(await userIdOf(t, 'lst-granted'));
    expect(granted?.['grantedBy']).toEqual({ name: self?.['name'], handle: 'admin' });
    expect(granted?.['handle']).toBe('lst-granted');

    expect(byEmail('lst-stray@dev.local')?.['grantedBy']).toBeNull();

    // BR-29 list part: an entry with no account has null account fields
    expect(byEmail('lst-noacct@dev.local')).toMatchObject({ userId: null, name: null, handle: null, grantedBy: null });
  });

  it('orders by granted_at desc, then id', async () => {
    await t.db.pool.query(
      "insert into platform_admins (email, granted_at) values ('ord-old@dev.local', now() - interval '2 days'), ('ord-new@dev.local', now() + interval '2 days')",
    );
    const page = await listAll();
    const emails = page.items.map((i) => i.email);
    expect(emails[0]).toBe('ord-new@dev.local');
    expect(emails.indexOf('ord-old@dev.local')).toBeGreaterThan(emails.indexOf('admin@dev.local'));
    const expected = await t.db.pool.query<{ id: string }>(
      'select id from platform_admins order by granted_at desc, id',
    );
    expect(page.items.map((i) => i.id)).toEqual(expected.rows.map((r) => r.id));
  });

  it('entries with the same granted_at page by id, each exactly once', async () => {
    const client = await t.db.pool.connect();
    try {
      await client.query('begin');
      for (const n of ['tie-a', 'tie-b', 'tie-c']) {
        await client.query('insert into platform_admins (email) values ($1)', [`${n}@dev.local`]);
      }
      await client.query('commit');
    } finally {
      client.release();
    }
    const expected = await t.db.pool.query<{ id: string }>(
      'select id from platform_admins order by granted_at desc, id',
    );
    const ids: string[] = [];
    for (let page = 1; page <= expected.rows.length; page += 1) {
      const res = await list(admin, `?page=${page}&pageSize=1`);
      expectContract('platform.listAdmins', res);
      const body = res.json<Page<PlatformAdminDto>>();
      expect(body.total).toBe(expected.rows.length);
      ids.push(...body.items.map((i) => i.id));
    }
    expect(ids).toEqual(expected.rows.map((r) => r.id));
    expect(new Set(ids).size).toBe(ids.length);
    const tied = await t.db.pool.query<{ id: string }>(
      "select id from platform_admins where email like 'tie-%@dev.local' order by id",
    );
    const walked = ids.filter((id) => tied.rows.some((r) => r.id === id));
    expect(walked).toEqual(tied.rows.map((r) => r.id));
  });

  it('BR-15: every non-platform caller gets 403 before any lookup on the list', async () => {
    const org = await createOrg(t, 'Pa List Org', 'pa-list-org');
    const owner = await inviteAndLogin(t, org.id, 'pal-owner', 'owner', { type: 'org' });
    const orgAdmin = await inviteAndLogin(t, org.id, 'pal-admin', 'admin', { type: 'org' });
    const connectionId = await installFake(t, owner);
    const { projectId } = await makeProject(t, owner, connectionId);
    const projectAdmin = await inviteAndLogin(t, org.id, 'pal-padmin', 'admin', {
      type: 'project',
      projectIds: [projectId],
    });
    const member = await inviteAndLogin(t, org.id, 'pal-member', 'member', { type: 'org' });
    const viewer = await inviteAndLogin(t, org.id, 'pal-viewer', 'viewer', { type: 'org' });
    // a signed-in user with an account but no org: invited into another org and never accepted
    const other = await createOrg(t, 'Pa List Other', 'pa-list-other');
    const inviteRes = await t.app.inject({
      method: 'GET',
      url: `/api/platform/orgs/${other.id}/roles`,
      headers: { cookie: admin },
    });
    const roleId = inviteRes.json<{ id: string; key: string }[]>().find((r) => r.key === 'viewer')?.id;
    await t.app.inject({
      method: 'POST',
      url: `/api/platform/orgs/${other.id}/invitations`,
      headers: { cookie: admin },
      payload: { email: 'pal-noorg@dev.local', roleId, scope: { type: 'org' } },
    });
    const noOrg = await loginAs(t, 'pal-noorg');
    expect(noOrg).not.toBe('');

    logLines.length = 0;
    for (const cookie of [owner, orgAdmin, projectAdmin, member, viewer, noOrg]) {
      const res = await list(cookie);
      expect(res.statusCode).toBe(403);
      const body = res.json<{ detail: string; items?: unknown }>();
      expect(body.detail).toBe(FORBIDDEN_DETAIL);
      expect(body.items).toBeUndefined();
    }
    const denied = logLines.filter((l) => l['msg'] === 'access denied' && l['routeKey'] === 'platform.listAdmins');
    expect(denied).toHaveLength(6);
    expect(JSON.stringify(denied)).not.toContain('@');
  });

  it('ignores an org header', async () => {
    const org = await createOrg(t, 'Pa Header Org', 'pa-header-org');
    const res = await list(admin, '', { 'x-org-id': org.id });
    expect(res.statusCode).toBe(200);
    expectContract('platform.listAdmins', res);
  });
});
