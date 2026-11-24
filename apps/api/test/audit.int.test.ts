import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuditEntryDto, Page } from '@agentdesk/contracts';
import { auditLog, connections, invitations, projects, withOrg } from '@agentdesk/db';
import { createTestApp, type TestApp } from './helpers/app';
import {
  acceptInvite,
  addProjectMember,
  changeRole,
  createOrg,
  declineInvite,
  inviteAndLogin,
  invite,
  grant,
  asPlatformAdmin,
  loginAs,
  auditList,
  projectAudit,
  reactivateOrgRoute,
  removeMember,
  removeProjectMember,
  revoke,
  roleIdsOf,
  setProjectRole,
  suspendOrgRoute,
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
      expect(byAction('invitation.accepted', accepted.id)?.actor?.userId).toBe(await userIdOf(t, 'au-inv-acc'));
      expect(byAction('invitation.declined', declined.id)?.target.label).toBe('au-inv-dec@dev.local');
      for (const e of page.items.filter((x) => x.target.type !== 'invitation')) {
        expect(JSON.stringify(e)).not.toContain('@dev.local');
      }
      expect(page.items.some((e) => e.action === 'assignment.granted')).toBe(true);
    }
  });

  it('names the listed projects on invitation entries for the owner and org admin, and on no other entry', async () => {
    const f = await buildCast('au-proj');
    const other = await buildCast('au-proj-b');
    const zeta = await seedProject(f.orgId, 'Zeta project');
    const alpha = await seedProject(f.orgId, 'Alpha project');
    await seedProject(other.orgId, 'Org B secret project');
    const email = 'au-proj-guest@dev.local';
    const created = await invite(t, f.orgId, email, 'viewer', { type: 'project', projectIds: [zeta, alpha] });
    const orgScope = await invite(t, f.orgId, 'au-proj-org@dev.local', 'viewer', { type: 'org' });
    for (const cookie of [f.o, f.a]) {
      const page = await entries(f.orgId, cookie);
      const inv = page.items.find((e) => e.action === 'invitation.created' && e.target.id === created.id);
      expect(inv?.projects).toEqual([
        { id: alpha, name: 'Alpha project' },
        { id: zeta, name: 'Zeta project' },
      ]);
      expect(inv?.target.label).toBe(email);
      const orgInv = page.items.find((e) => e.action === 'invitation.created' && e.target.id === orgScope.id);
      expect(orgInv?.projects).toEqual([]);
      expect(orgInv?.target.label).toBe('au-proj-org@dev.local');
      for (const e of page.items.filter((x) => !x.action.startsWith('invitation.'))) expect(e.projects).toEqual([]);
      expect(JSON.stringify(page)).not.toContain('Org B secret project');
    }
  });

  it('a project deleted after the invitation is left out of the entry, never shown as an id', async () => {
    const f = await buildCast('au-projdel');
    const keep = await seedProject(f.orgId, 'Kept project');
    const gone = await seedProject(f.orgId, 'Gone project');
    const pending = await invite(t, f.orgId, 'au-projdel-guest@dev.local', 'viewer', {
      type: 'project',
      projectIds: [keep, gone],
    });
    await withOrg(t.db, f.orgId, (tx) => tx.delete(projects).where(eq(projects.id, gone)));
    const page = await entries(f.orgId, f.o);
    const inv = page.items.find((e) => e.action === 'invitation.created' && e.target.id === pending.id);
    expect(inv?.projects).toEqual([{ id: keep, name: 'Kept project' }]);
    expect(JSON.stringify(inv)).not.toContain(gone);
  });

  it('assignment.granted rows show the role as a change', async () => {
    const f = await buildCast('au-grant');
    const granted = (await entries(f.orgId, f.o)).items.find((e) => e.action === 'assignment.granted');
    expect(granted?.changes).toHaveLength(1);
    expect(granted?.changes[0]).toMatchObject({ field: 'role', from: null });
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

  it('a forged actorKind in a member request body is not shown as an operator marker', async () => {
    const f = await buildCast('au-forge');
    const pending = await invite(t, f.orgId, 'au-forge-guest@dev.local', 'viewer', { type: 'org' });
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgId}/invitations/${pending.id}/resend`,
      headers: { cookie: f.a, 'x-org-id': f.orgId },
      payload: { actorKind: 'platform_admin' },
    });
    expect(res.statusCode).toBe(200);
    const stored = await withOrg(t.db, f.orgId, (tx) =>
      tx.select({ action: auditLog.action, payload: auditLog.payload }).from(auditLog),
    );
    expect(stored.some((r) => r.action.startsWith('POST ') && r.payload['actorKind'] === 'platform_admin')).toBe(true);
    for (const cookie of [f.o, f.a]) {
      const page = await entries(f.orgId, cookie);
      const generic = page.items.filter((e) => e.action.startsWith('POST '));
      expect(generic.length).toBeGreaterThan(0);
      expect(generic.every((e) => e.actorKind === null)).toBe(true);
    }
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

interface ProjectCast {
  orgId: string;
  p1: string;
  p2: string;
  /** org owner */
  o: string;
  /** admin on P1 only */
  a: string;
  /** admin on P2 only */
  a2: string;
  /** member on P1 */
  b: string;
  v: string;
  /** a signed-in org member with no assignment */
  n: string;
  /** org viewer, admin on P1 */
  vAdmin: string;
  roles: Record<'owner' | 'admin' | 'member' | 'viewer', string>;
  ids: { a: string; c: string };
}

async function buildProjectCast(slug: string): Promise<ProjectCast> {
  const org = await createOrg(t, `Org ${slug}`, slug);
  const p1 = await seedProject(org.id, `P1-${slug}`);
  const p2 = await seedProject(org.id, `P2-${slug}`);
  const h = (n: string) => `${slug}-${n}`;
  const o = await inviteAndLogin(t, org.id, h('o'), 'owner', { type: 'org' });
  const a = await inviteAndLogin(t, org.id, h('a'), 'admin', { type: 'project', projectIds: [p1] });
  const a2 = await inviteAndLogin(t, org.id, h('a2'), 'admin', { type: 'project', projectIds: [p2] });
  const b = await inviteAndLogin(t, org.id, h('b'), 'member', { type: 'project', projectIds: [p1] });
  // the person the member routes act on: an org member with a P2 role only
  await inviteAndLogin(t, org.id, h('c'), 'member', { type: 'project', projectIds: [p2] });
  const v = await inviteAndLogin(t, org.id, h('v'), 'viewer', { type: 'org' });
  const n = await inviteAndLogin(t, org.id, h('n'), 'viewer', { type: 'org' });
  const nId = await userIdOf(t, h('n'));
  await revoke(t, org.id, (await grant(t, org.id, nId, 'viewer', { type: 'org' })).id);
  const vAdmin = await inviteAndLogin(t, org.id, h('va'), 'viewer', { type: 'org' });
  await grant(t, org.id, await userIdOf(t, h('va')), 'admin', { type: 'project', projectId: p1 });
  return {
    orgId: org.id,
    p1,
    p2,
    o,
    a,
    a2,
    b,
    v,
    n,
    vAdmin,
    roles: await roleIdsOf(t, o, org.id),
    ids: { a: await userIdOf(t, h('a')), c: await userIdOf(t, h('c')) },
  };
}

async function projectEntries(
  f: ProjectCast,
  projectId: string,
  cookie: string,
  query: { page?: number; pageSize?: number } = {},
) {
  const res = await projectAudit(t, cookie, f.orgId, projectId, { pageSize: 100, ...query });
  expect(res.statusCode, res.body).toBe(200);
  return expectContract('projects.audit', res) as Page<AuditEntryDto>;
}

describe('projects.audit', () => {
  it('BR-16 lists the rows tagged with the project newest first by time then id, paged with a total', async () => {
    const f = await buildProjectCast('pa-list');
    const ids: string[] = [];
    await withOrg(t.db, f.orgId, async (tx) => {
      const base = Date.parse('2031-01-01T00:00:00Z');
      for (let i = 0; i < 5; i += 1) {
        const [row] = await tx
          .insert(auditLog)
          .values({
            orgId: f.orgId,
            actorUserId: f.ids.a,
            action: `GET pa-list.${i}`,
            projectIds: [f.p1],
            // rows 3 and 4 share a time, so the id decides their order
            at: new Date(base + Math.min(i, 3) * 1000),
          })
          .returning({ id: auditLog.id });
        ids.push(row?.id ?? '');
      }
    });
    const all = await projectEntries(f, f.p1, f.a);
    const mine = all.items.filter((e) => e.action.startsWith('GET pa-list.'));
    const tied = [ids[3] ?? '', ids[4] ?? ''].sort().reverse();
    expect(mine.map((e) => e.id)).toEqual([...tied, ids[2], ids[1], ids[0]]);
    expect(all.total).toBe(all.items.length);
    const second = await projectEntries(f, f.p1, f.a, { pageSize: 2, page: 2 });
    expect(second.total).toBe(all.total);
    expect(second.items.map((e) => e.id)).toEqual(all.items.slice(2, 4).map((e) => e.id));
  });

  it('BR-16 shows actor null for a deleted actor', async () => {
    const f = await buildProjectCast('pa-gone');
    await withOrg(t.db, f.orgId, async (tx) => {
      await tx
        .insert(auditLog)
        .values({ orgId: f.orgId, actorUserId: null, action: 'GET pa-gone', projectIds: [f.p1] });
    });
    const row = (await projectEntries(f, f.p1, f.a)).items.find((e) => e.action === 'GET pa-gone');
    expect(row?.actor).toBeNull();
  });

  it('BR-17 shows add, change role and remove with the role before and after, and the same rows in the org log', async () => {
    const f = await buildProjectCast('pa-members');
    const cId = f.ids.c;
    const added = await addProjectMember(t, f.a, f.orgId, f.p1, { userId: cId, roleId: f.roles.member });
    expect(added.statusCode).toBe(201);
    expect((await setProjectRole(t, f.a, f.orgId, f.p1, cId, f.roles.viewer)).statusCode).toBe(200);
    expect((await removeProjectMember(t, f.a, f.orgId, f.p1, cId)).statusCode).toBe(204);
    for (const page of [await projectEntries(f, f.p1, f.a), await entries(f.orgId, f.o)]) {
      const mine = page.items.filter(
        (e) => e.target.id === cId && /^(assignment\.granted|project_member\.)/.test(e.action),
      );
      const byAction = (action: string) => mine.find((e) => e.action === action);
      expect(byAction('assignment.granted')?.changes).toEqual([{ field: 'role', from: null, to: 'Member' }]);
      expect(byAction('project_member.role_changed')?.changes).toEqual([
        { field: 'role', from: 'Member', to: 'Viewer' },
      ]);
      expect(byAction('project_member.removed')?.changes).toEqual([{ field: 'role', from: 'Viewer', to: null }]);
      expect(byAction('project_member.removed')?.actor?.userId).toBe(f.ids.a);
    }
  });

  it('BR-19 holds no row of another project, no org-only row and no row of another org', async () => {
    const f = await buildProjectCast('pa-iso');
    const other = await buildProjectCast('pa-iso-b');
    await withOrg(t.db, f.orgId, async (tx) => {
      await tx.insert(auditLog).values([
        { orgId: f.orgId, actorUserId: f.ids.a, action: 'GET only.in.p2', projectIds: [f.p2] },
        { orgId: f.orgId, actorUserId: f.ids.a, action: 'GET only.in.p1', projectIds: [f.p1] },
        { orgId: f.orgId, actorUserId: f.ids.a, action: 'GET both', projectIds: [f.p1, f.p2] },
      ]);
    });
    await withOrg(t.db, other.orgId, async (tx) => {
      await tx.insert(auditLog).values({ orgId: other.orgId, action: 'GET only.in.b', projectIds: [other.p1] });
    });
    expect((await updateOrg(t, f.o, f.orgId, { name: 'Renamed iso' })).statusCode).toBe(200);
    const actions = (await projectEntries(f, f.p1, f.a)).items.map((e) => e.action);
    expect(actions).toContain('GET only.in.p1');
    expect(actions).toContain('GET both');
    expect(actions).not.toContain('GET only.in.p2');
    expect(actions).not.toContain('GET only.in.b');
    expect(actions).not.toContain('PATCH orgs.update');
    const p2Actions = (await projectEntries(f, f.p2, f.a2)).items.map((e) => e.action);
    expect(p2Actions).toContain('GET only.in.p2');
    expect(p2Actions).not.toContain('GET only.in.p1');
  });

  it('BR-27 a project admin sees an invitation email only when every listed project is theirs', async () => {
    const f = await buildProjectCast('pa-inv');
    const create = async (email: string, projectIds: string[]): Promise<string> => {
      const res = await t.app.inject({
        method: 'POST',
        url: `/api/orgs/${f.orgId}/invitations`,
        headers: { cookie: f.o, 'x-org-id': f.orgId },
        payload: { email, roleId: f.roles.viewer, scope: { type: 'project', projectIds } },
      });
      expect(res.statusCode, res.body).toBe(201);
      return res.json<{ id: string }>().id;
    };
    const onlyP1 = await create('pa-inv-x@dev.local', [f.p1]);
    const both = await create('pa-inv-y@dev.local', [f.p1, f.p2]);
    const onlyP2 = await create('pa-inv-z@dev.local', [f.p2]);
    const created = (page: Page<AuditEntryDto>, id: string) =>
      page.items.find((e) => e.action === 'invitation.created' && e.target.id === id);

    const asA = await projectEntries(f, f.p1, f.a);
    expect(created(asA, onlyP1)?.target.label).toBe('pa-inv-x@dev.local');
    expect(created(asA, onlyP1)?.projects).toEqual([{ id: f.p1, name: 'P1-pa-inv' }]);
    expect(created(asA, both)?.target.label).toBeNull();
    expect(created(asA, both)?.projects).toEqual([{ id: f.p1, name: 'P1-pa-inv' }]);
    expect(created(asA, onlyP2)).toBeUndefined();
    expect(JSON.stringify(asA)).not.toContain('pa-inv-y@dev.local');
    expect(JSON.stringify(asA)).not.toContain('P2-pa-inv');

    const asO = await entries(f.orgId, f.o);
    expect(created(asO, both)?.target.label).toBe('pa-inv-y@dev.local');
    expect(created(asO, both)?.projects).toEqual([
      { id: f.p1, name: 'P1-pa-inv' },
      { id: f.p2, name: 'P2-pa-inv' },
    ]);
  });

  it('BR-27 an invitation that expired is redacted like any other', async () => {
    const f = await buildProjectCast('pa-exp');
    const email = 'pa-exp-guest@dev.local';
    const stale = await invite(t, f.orgId, email, 'viewer', { type: 'project', projectIds: [f.p1, f.p2] });
    await withOrg(t.db, f.orgId, (tx) =>
      tx
        .update(invitations)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(invitations.id, stale.id)),
    );
    // a new invitation to the same address replaces the stale one and writes `invitation.expired`
    await invite(t, f.orgId, email, 'viewer', { type: 'project', projectIds: [f.p1, f.p2] });
    const asA = await projectEntries(f, f.p1, f.a);
    const expired = asA.items.find((e) => e.action === 'invitation.expired' && e.target.id === stale.id);
    expect(expired?.target.label).toBeNull();
    expect(expired?.projects).toEqual([{ id: f.p1, name: 'P1-pa-exp' }]);
    expect(JSON.stringify(asA)).not.toContain(email);
    const asO = await entries(f.orgId, f.o);
    expect(asO.items.find((e) => e.action === 'invitation.expired' && e.target.id === stale.id)?.target.label).toBe(
      email,
    );
  });

  it('refuses a member, a viewer and a person with no role with 403, for any project id', async () => {
    const f = await buildProjectCast('pa-deny');
    for (const cookie of [f.b, f.v, f.n]) {
      for (const id of [f.p1, f.p2, randomUUID(), 'not-a-uuid']) {
        const res = await projectAudit(t, cookie, f.orgId, id);
        expect(res.statusCode, id).toBe(403);
        expect(res.json()).not.toHaveProperty('items');
      }
    }
  });

  it('keeps a project admin to their own project: another project is 404', async () => {
    const f = await buildProjectCast('pa-scope');
    const res = await projectAudit(t, f.a, f.orgId, f.p2);
    expect(res.statusCode).toBe(404);
    expect(res.json()).not.toHaveProperty('items');
    expect((await projectAudit(t, f.a, f.orgId, randomUUID())).statusCode).toBe(404);
    expect((await projectAudit(t, f.a2, f.orgId, f.p1)).statusCode).toBe(404);
  });

  it('answers 404 for a project of another org, with no row of it', async () => {
    const a = await buildProjectCast('pa-x-a');
    const b = await buildProjectCast('pa-x-b');
    await withOrg(t.db, b.orgId, async (tx) => {
      await tx.insert(auditLog).values({ orgId: b.orgId, action: 'GET only.in.b', projectIds: [b.p1] });
    });
    for (const cookie of [a.o, a.a]) {
      const res = await projectAudit(t, cookie, a.orgId, b.p1);
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain('only.in.b');
    }
  });

  it('lets an org viewer who is admin on the project read its audit log, and an org owner read any', async () => {
    const f = await buildProjectCast('pa-ok');
    expect((await projectAudit(t, f.vAdmin, f.orgId, f.p1)).statusCode).toBe(200);
    // an org viewer sees P2, so its scope passes and the missing permission answers 403
    expect((await projectAudit(t, f.vAdmin, f.orgId, f.p2)).statusCode).toBe(403);
    expect((await projectAudit(t, f.o, f.orgId, f.p1)).statusCode).toBe(200);
    expect((await projectAudit(t, f.o, f.orgId, f.p2)).statusCode).toBe(200);
  });

  it('never returns a credential or an env value', async () => {
    const f = await buildProjectCast('pa-secret');
    await withOrg(t.db, f.orgId, async (tx) => {
      await tx.insert(auditLog).values([
        {
          orgId: f.orgId,
          actorUserId: f.ids.a,
          action: 'PUT agents.putCredential',
          projectIds: [f.p1],
          payload: { type: 'api_key', value: 'tok-SECRET-1' },
        },
        {
          orgId: f.orgId,
          actorUserId: f.ids.a,
          action: 'PUT setupEnv.put',
          projectIds: [f.p1],
          payload: { env: { API_KEY: 'tok-SECRET-2' }, password: 'tok-SECRET-3' },
        },
      ]);
    });
    const res = await projectAudit(t, f.a, f.orgId, f.p1);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('PUT agents.putCredential');
    expect(res.body).not.toContain('SECRET');
    expect(res.body).not.toContain('"payload"');
  });

  it('keeps the rows in the org log after the project is deleted, and answers 404 for the project', async () => {
    const f = await buildProjectCast('pa-del');
    const added = await addProjectMember(t, f.a, f.orgId, f.p1, { userId: f.ids.c, roleId: f.roles.member });
    expect(added.statusCode).toBe(201);
    await withOrg(t.db, f.orgId, (tx) =>
      tx.delete(projects).where(and(eq(projects.id, f.p1), eq(projects.orgId, f.orgId))),
    );
    expect((await projectAudit(t, f.o, f.orgId, f.p1)).statusCode).toBe(404);
    // the deleted project took the admin's only grant with it, so the permission check refuses first
    expect((await projectAudit(t, f.a, f.orgId, f.p1)).statusCode).toBe(403);
    const kept = (await entries(f.orgId, f.o)).items.find(
      (e) => e.action === 'assignment.granted' && e.target.id === f.ids.c,
    );
    expect(kept).toBeDefined();
  });
});

describe('platform suspension in the tenant audit (BR-43)', () => {
  it('the owner reads both rows after a reactivation, tagged platform_admin, with a status change and no reason', async () => {
    const f = await buildCast('au-susp');
    const admin = await asPlatformAdmin(t);
    const reasonA = 'unpaid-invoice-REASON-A';
    const reasonB = 'paid-up-REASON-B';
    expect((await suspendOrgRoute(t, admin, f.orgId, { reason: reasonA })).statusCode).toBe(200);
    expect((await reactivateOrgRoute(t, admin, f.orgId, { reason: reasonB })).statusCode).toBe(200);
    const res = await auditList(t, f.o, f.orgId, { pageSize: 100 });
    expect(res.statusCode, res.body).toBe(200);
    const page = expectContract('audit.list', res) as Page<AuditEntryDto>;
    const susp = page.items.find((e) => e.action === 'org.suspended');
    const react = page.items.find((e) => e.action === 'org.reactivated');
    expect(susp?.actorKind).toBe('platform_admin');
    expect(susp?.changes).toEqual([{ field: 'status', from: 'active', to: 'suspended' }]);
    expect(react?.actorKind).toBe('platform_admin');
    expect(react?.changes).toEqual([{ field: 'status', from: 'suspended', to: 'active' }]);
    expect(res.body).not.toContain('REASON');
  });

  it('writes no row for a repeat', async () => {
    const f = await buildCast('au-susp2');
    const admin = await asPlatformAdmin(t);
    expect((await suspendOrgRoute(t, admin, f.orgId, { reason: 'one' })).statusCode).toBe(200);
    expect((await suspendOrgRoute(t, admin, f.orgId, { reason: 'two' })).statusCode).toBe(200);
    expect((await reactivateOrgRoute(t, admin, f.orgId, { reason: 'back' })).statusCode).toBe(200);
    const page = await entries(f.orgId, f.o);
    expect(page.items.filter((e) => e.action === 'org.suspended')).toHaveLength(1);
    expect(page.items.filter((e) => e.action === 'org.reactivated')).toHaveLength(1);
  });
});
