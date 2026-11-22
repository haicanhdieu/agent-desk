import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuditEntryDto, Page } from '@agentdesk/contracts';
import { auditLog, connections, projects, withOrg } from '@agentdesk/db';
import { createTestApp, type TestApp } from './helpers/app';
import {
  acceptInvite,
  changeRole,
  createOrg,
  declineInvite,
  inviteAndLogin,
  invite,
  loginAs,
  auditList,
  removeMember,
  roleIdsOf,
  updateOrg,
  userIdOf,
} from './helpers/auth';
import { expectContract } from './helpers/contract';

let t: TestApp;
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
  t = await createTestApp({ logger });
});
afterAll(async () => {
  await t.close();
});

async function seedProject(orgId: string, name: string): Promise<string> {
  return withOrg(t.db, orgId, async (tx) => {
    const [conn] = await tx
      .insert(connections)
      .values({
        orgId,
        provider: 'fake',
        capabilities: { code: true, board: true },
        externalId: randomUUID(),
        accountName: 'dev',
      })
      .returning({ id: connections.id });
    const [project] = await tx
      .insert(projects)
      .values({
        orgId,
        name,
        repoPath: `dev/${name.toLowerCase()}`,
        codeConnectionId: conn?.id ?? '',
        boardConnectionId: conn?.id ?? '',
      })
      .returning({ id: projects.id });
    return project?.id ?? '';
  });
}

interface Cast {
  orgId: string;
  o: string;
  a: string;
  p1admin: string;
  m: string;
  v: string;
  ids: { o: string; a: string; m: string };
}

async function buildCast(slug: string): Promise<Cast> {
  const org = await createOrg(t, `Org ${slug}`, slug);
  const p1 = await seedProject(org.id, `P1-${slug}`);
  const h = (n: string) => `${slug}-${n}`;
  const o = await inviteAndLogin(t, org.id, h('o'), 'owner', { type: 'org' });
  const a = await inviteAndLogin(t, org.id, h('a'), 'admin', { type: 'org' });
  const p1admin = await inviteAndLogin(t, org.id, h('pa'), 'admin', { type: 'project', projectIds: [p1] });
  const m = await inviteAndLogin(t, org.id, h('m'), 'member', { type: 'org' });
  const v = await inviteAndLogin(t, org.id, h('v'), 'viewer', { type: 'org' });
  return {
    orgId: org.id,
    o,
    a,
    p1admin,
    m,
    v,
    ids: { o: await userIdOf(t, h('o')), a: await userIdOf(t, h('a')), m: await userIdOf(t, h('m')) },
  };
}

async function entries(orgId: string, cookie: string, query: { page?: number; pageSize?: number } = {}) {
  const res = await auditList(t, cookie, orgId, { pageSize: 100, ...query });
  expect(res.statusCode, res.body).toBe(200);
  return expectContract('audit.list', res) as Page<AuditEntryDto>;
}

describe('audit list', () => {
  it('BR-20 lists newest first by time then id, with offset paging and a total', async () => {
    const f = await buildCast('au-order');
    const base = Date.parse('2031-01-01T00:00:00Z');
    const same = new Date(base + 5000);
    await withOrg(t.db, f.orgId, async (tx) => {
      await tx.insert(auditLog).values([
        { orgId: f.orgId, actorUserId: f.ids.o, action: 'GET seed.a', at: new Date(base + 1000) },
        { orgId: f.orgId, actorUserId: f.ids.o, action: 'GET seed.b', at: same },
        { orgId: f.orgId, actorUserId: f.ids.o, action: 'GET seed.c', at: same },
        { orgId: f.orgId, actorUserId: f.ids.o, action: 'GET seed.d', at: new Date(base + 9000) },
      ]);
    });
    const all = await entries(f.orgId, f.o);
    const seeded = all.items.filter((e) => e.action.startsWith('GET seed.'));
    expect(seeded[0]?.action).toBe('GET seed.d');
    expect(seeded[3]?.action).toBe('GET seed.a');
    const ties = seeded.slice(1, 3);
    expect(ties.map((e) => e.id)).toEqual([...ties.map((e) => e.id)].sort().reverse());
    const times = all.items.map((e) => Date.parse(e.at));
    expect(times).toEqual([...times].sort((x, y) => y - x));
    const first = await entries(f.orgId, f.o, { page: 1, pageSize: 20 });
    expect(first.total).toBe(all.total);
    expect(first.items).toHaveLength(Math.min(20, all.total));
    // offset paging: with a window of 3, page 1 and page 2 are the first and next 3 rows of the full ordered list
    expect(all.total).toBeGreaterThan(6);
    expect(all.items).toHaveLength(all.total);
    const w1 = await entries(f.orgId, f.o, { page: 1, pageSize: 3 });
    const w2 = await entries(f.orgId, f.o, { page: 2, pageSize: 3 });
    expect(w1.total).toBe(all.total);
    expect(w2.total).toBe(all.total);
    expect(w2.page).toBe(2);
    expect(w1.items.map((e) => e.id)).toEqual(all.items.slice(0, 3).map((e) => e.id));
    expect(w2.items.map((e) => e.id)).toEqual(all.items.slice(3, 6).map((e) => e.id));
    // an admin sees the same rows as the owner
    expect((await entries(f.orgId, f.a)).total).toBe(all.total);
  });

  it('BR-20 names the actor, null for a deleted user, and marks a platform admin', async () => {
    const f = await buildCast('au-actor');
    await withOrg(t.db, f.orgId, async (tx) => {
      await tx.insert(auditLog).values({
        orgId: f.orgId,
        actorUserId: 'user-that-is-gone',
        action: 'DELETE seed.gone',
        at: new Date('2032-01-01T00:00:00Z'),
      });
    });
    const page = await entries(f.orgId, f.o);
    const gone = page.items.find((e) => e.action === 'DELETE seed.gone');
    expect(gone?.actor).toBeNull();
    const created = page.items.find((e) => e.action === 'org.created');
    expect(created?.actorKind).toBe('platform_admin');
    expect(created?.actor?.handle).toBeTruthy();
    const accepted = page.items.find((e) => e.action === 'invitation.accepted');
    expect(accepted?.actor?.name).toBeTruthy();
  });

  it('BR-21 a role change and a removal show the member and the role before and after', async () => {
    const f = await buildCast('au-role');
    const roleIds = await roleIdsOf(t, f.o, f.orgId);
    expect((await changeRole(t, f.o, f.orgId, f.ids.m, roleIds.admin)).statusCode).toBe(200);
    expect((await removeMember(t, f.o, f.orgId, f.ids.m)).statusCode).toBe(204);
    const page = await entries(f.orgId, f.o);
    const changed = page.items.find((e) => e.action === 'member.role_changed');
    expect(changed?.target).toEqual({ type: 'user', id: f.ids.m, label: 'au-role-m' });
    expect(changed?.changes).toEqual([{ field: 'role', from: 'Member', to: 'Admin' }]);
    expect(changed?.actor?.userId).toBe(f.ids.o);
    expect(changed?.actorKind).toBe('member');
    const removed = page.items.find((e) => e.action === 'member.removed');
    expect(removed?.changes).toEqual([{ field: 'role', from: 'Admin', to: null }]);
    expect(removed?.target.id).toBe(f.ids.m);
  });

  it('BR-22 a name and slug change show the value before and after', async () => {
    const f = await buildCast('au-org');
    expect((await updateOrg(t, f.o, f.orgId, { name: 'Renamed', slug: 'au-org-new' })).statusCode).toBe(200);
    const page = await entries(f.orgId, f.o);
    const row = page.items.find((e) => e.action === 'org.updated');
    expect(row?.changes).toEqual([
      { field: 'name', from: 'Org au-org', to: 'Renamed' },
      { field: 'slug', from: 'au-org', to: 'au-org-new' },
    ]);
  });

  it('BR-23 invitation entries carry the invitee email as the label, no other entry does', async () => {
    const f = await buildCast('au-inv');
    const email = 'au-inv-guest@dev.local';
    const pending = await invite(t, f.orgId, email, 'viewer', { type: 'org' });
    const tenantInv = (path: string, method: 'POST' | 'DELETE') =>
      t.app.inject({
        method,
        url: `/api/orgs/${f.orgId}/invitations/${pending.id}${path}`,
        headers: { cookie: f.a, 'x-org-id': f.orgId },
      });
    expect((await tenantInv('/resend', 'POST')).statusCode).toBe(200);
    expect((await tenantInv('', 'DELETE')).statusCode).toBe(204);
    const accepted = await invite(t, f.orgId, 'au-inv-acc@dev.local', 'member', { type: 'org' });
    const accCookie = await loginAs(t, 'au-inv-acc');
    expect((await acceptInvite(t, accCookie, accepted.id)).statusCode).toBe(200);
    const declined = await invite(t, f.orgId, 'au-inv-dec@dev.local', 'member', { type: 'org' });
    const decCookie = await loginAs(t, 'au-inv-dec');
    expect((await declineInvite(t, decCookie, declined.id)).statusCode).toBe(204);

    for (const cookie of [f.o, f.a]) {
      const page = await entries(f.orgId, cookie);
      const byAction = (a: string, id: string) => page.items.find((e) => e.action === a && e.target.id === id);
      expect(byAction('invitation.created', pending.id)?.target.label).toBe(email);
      expect(byAction('invitation.resent', pending.id)?.target.label).toBe(email);
      expect(byAction('invitation.revoked', pending.id)?.target.label).toBe(email);
      expect(byAction('invitation.created', accepted.id)?.changes).toEqual([
        { field: 'role', from: null, to: 'Member' },
      ]);
      expect(byAction('invitation.accepted', accepted.id)?.target.label).toBe('au-inv-acc@dev.local');
      expect(byAction('invitation.declined', declined.id)?.target.label).toBe('au-inv-dec@dev.local');
      for (const e of page.items.filter((x) => x.target.type !== 'invitation')) {
        expect(JSON.stringify(e)).not.toContain('@dev.local');
      }
      expect(page.items.some((e) => e.action === 'assignment.granted')).toBe(true);
    }
  });

  it('lists generic METHOD route-key rows with no changes', async () => {
    const f = await buildCast('au-generic');
    await withOrg(t.db, f.orgId, async (tx) => {
      await tx.insert(auditLog).values({
        orgId: f.orgId,
        actorUserId: f.ids.o,
        action: 'POST projects.create',
        payload: { name: 'Proj' },
      });
    });
    const row = (await entries(f.orgId, f.o)).items.find((e) => e.action === 'POST projects.create');
    expect(row?.changes).toEqual([]);
    expect(row?.target).toEqual({ type: null, id: null, label: null });
  });

  it('a row with a known action and an empty payload still lists (no 500)', async () => {
    const f = await buildCast('au-empty');
    await withOrg(t.db, f.orgId, async (tx) => {
      await tx.insert(auditLog).values([
        { orgId: f.orgId, actorUserId: f.ids.o, action: 'member.role_changed', targetType: 'user', targetId: f.ids.m },
        { orgId: f.orgId, actorUserId: f.ids.o, action: 'assignment.revoked', targetType: 'user', targetId: 'nobody' },
        {
          orgId: f.orgId,
          actorUserId: f.ids.o,
          action: 'invitation.revoked',
          targetType: 'invitation',
          targetId: 'not-a-uuid',
        },
      ]);
    });
    const page = await entries(f.orgId, f.o);
    const changed = page.items.find((e) => e.action === 'member.role_changed');
    expect(changed?.changes).toEqual([]);
    expect(changed?.target.label).toBe('au-empty-m');
    expect(page.items.find((e) => e.action === 'invitation.revoked')?.target.label).toBeNull();
  });

  it('BR-18 member, viewer and a project admin get 403 and no entry data', async () => {
    const f = await buildCast('au-deny');
    for (const cookie of [f.m, f.v, f.p1admin]) {
      const res = await auditList(t, cookie, f.orgId);
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain('org.created');
      expect(res.json()).not.toHaveProperty('items');
    }
  });

  it('BR-25 org B rows never show in org A, and org B audit is 404 for A owner', async () => {
    const a = await buildCast('au-iso-a');
    const b = await buildCast('au-iso-b');
    await withOrg(t.db, b.orgId, async (tx) => {
      await tx.insert(auditLog).values({ orgId: b.orgId, actorUserId: b.ids.o, action: 'GET only.in.b' });
    });
    const pageA = await entries(a.orgId, a.o);
    expect(pageA.items.some((e) => e.action === 'GET only.in.b')).toBe(false);
    expect(JSON.stringify(pageA)).not.toContain(b.ids.o);
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/orgs/${b.orgId}/audit`,
      headers: { cookie: a.o, 'x-org-id': a.orgId },
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('only.in.b');
    const mismatch = await t.app.inject({
      method: 'GET',
      url: `/api/orgs/${b.orgId}/audit`,
      headers: { cookie: a.o, 'x-org-id': b.orgId },
    });
    expect(mismatch.statusCode).toBe(409);
  });

  it('shows untrusted HTML and SQL text as plain text', async () => {
    const f = await buildCast('au-text');
    const nasty = `<img src=x onerror=alert(1)>'; drop table audit_log;--`;
    expect((await updateOrg(t, f.o, f.orgId, { name: nasty })).statusCode).toBe(200);
    const row = (await entries(f.orgId, f.o)).items.find((e) => e.action === 'org.updated');
    expect(row?.changes).toEqual([{ field: 'name', from: 'Org au-text', to: nasty }]);
  });

  it('never returns a secret-shaped payload value', async () => {
    const f = await buildCast('au-secret');
    await withOrg(t.db, f.orgId, async (tx) => {
      await tx.insert(auditLog).values({
        orgId: f.orgId,
        actorUserId: f.ids.o,
        action: 'org.updated',
        targetType: 'org',
        targetId: f.orgId,
        payload: {
          from: { name: 'A', token: 'tok-SECRET-1' },
          to: { name: 'B', apiKey: 'tok-SECRET-2' },
          password: 'tok-SECRET-3',
        },
      });
    });
    const res = await auditList(t, f.o, f.orgId);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('SECRET');
    expect(res.body).not.toContain('"payload"');
  });

  it('logs carry no email', async () => {
    const f = await buildCast('au-log');
    const email = 'au-log-guest@dev.local';
    const pending = await invite(t, f.orgId, email, 'viewer', { type: 'org' });
    const resend = await t.app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgId}/invitations/${pending.id}/resend`,
      headers: { cookie: f.a, 'x-org-id': f.orgId },
    });
    expect(resend.statusCode).toBe(200);
    await entries(f.orgId, f.o);
    // the injected logger is the one in use: the resend line is captured, and it carries ids only
    const resent = logLines.find((l) => l['msg'] === 'invitation resent' && l['invitationId'] === pending.id);
    expect(resent?.['orgId']).toBe(f.orgId);
    expect(logLines.some((l) => JSON.stringify(l).includes(email))).toBe(false);
  });
});
