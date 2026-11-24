import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page, PlatformAuditEntryDto, RoleDto } from '@agentdesk/contracts';
import { platformAuditLog, user } from '@agentdesk/db';
import { FORBIDDEN_DETAIL } from '../src/access/authorize';
import { createTestApp, type TestApp } from './helpers/app';
import {
  asPlatformAdmin,
  auditList,
  createOrg,
  grantPlatformAdmin,
  inviteAndLogin,
  loginAs,
  reactivateOrgRoute,
  suspendOrgRoute,
  userIdOf,
} from './helpers/auth';
import { expectContract } from './helpers/contract';
import { makeProject, installFake, freshStateDir, wideFakeRepos } from './helpers/fixtures';

let t: TestApp;
let admin: string;
let seq = 0;
const next = (): number => (seq += 1);

beforeAll(async () => {
  t = await createTestApp({ env: { FAKE_STATE_DIR: freshStateDir() }, wrapAdapters: wideFakeRepos });
  admin = await asPlatformAdmin(t);
});
afterAll(async () => {
  await t.close();
});

function listRoute(cookie: string | undefined, query: Record<string, string> = {}) {
  return t.app.inject({
    method: 'GET',
    url: '/api/platform/audit',
    headers: cookie === undefined ? {} : { cookie },
    query,
  });
}

async function listAs(cookie: string, query: Record<string, string> = {}): Promise<Page<PlatformAuditEntryDto>> {
  const res = await listRoute(cookie, query);
  expect(res.statusCode, res.body).toBe(200);
  return expectContract('platform.listAudit', res) as Page<PlatformAuditEntryDto>;
}

const patchOrg = (orgId: string, body: Record<string, unknown>) =>
  t.app.inject({ method: 'PATCH', url: `/api/platform/orgs/${orgId}`, headers: { cookie: admin }, payload: body });

async function roleId(orgId: string, key: string): Promise<string> {
  const res = await t.app.inject({
    method: 'GET',
    url: `/api/platform/orgs/${orgId}/roles`,
    headers: { cookie: admin },
  });
  const role = res.json<RoleDto[]>().find((r) => r.key === key);
  if (!role) throw new Error(`no role ${key}`);
  return role.id;
}

/** An org with every kind of row the audit list shows, all made through the real routes. */
async function orgWithHistory(label: string): Promise<{
  orgId: string;
  name: string;
  renamed: string;
  reason: string;
  memberName: string;
  inviteEmail: string;
}> {
  const n = next();
  const name = `Pal ${label} ${n}`;
  const org = await createOrg(t, name, `pal-${label}-${n}`);
  const renamed = `${name} Renamed`;
  expect((await patchOrg(org.id, { name: renamed, slug: `pal-${label}-${n}-new` })).statusCode).toBe(200);
  const reason = `Unpaid invoice ${n}`;
  expect((await suspendOrgRoute(t, admin, org.id, { reason })).statusCode).toBe(200);
  expect((await reactivateOrgRoute(t, admin, org.id, { reason: `Paid ${n}` })).statusCode).toBe(200);
  const handle = `pal-m${n}`;
  await inviteAndLogin(t, org.id, handle, 'viewer', { type: 'org' });
  const memberId = await userIdOf(t, handle);
  const member = await roleId(org.id, 'member');
  const granted = await t.app.inject({
    method: 'POST',
    url: `/api/platform/orgs/${org.id}/assignments`,
    headers: { cookie: admin },
    payload: { userId: memberId, roleId: member, scope: { type: 'org' } },
  });
  expect(granted.statusCode, granted.body).toBe(201);
  const inviteEmail = `pal-inv${n}@dev.local`;
  const invited = await t.app.inject({
    method: 'POST',
    url: `/api/platform/orgs/${org.id}/invitations`,
    headers: { cookie: admin },
    payload: { email: inviteEmail, roleId: await roleId(org.id, 'viewer'), scope: { type: 'org' } },
  });
  expect(invited.statusCode, invited.body).toBe(201);
  const [u] = await t.db.orm.select({ name: user.name }).from(user).where(eq(user.id, memberId));
  return { orgId: org.id, name, renamed, reason, memberName: u?.name ?? '', inviteEmail };
}

async function dbOrder(orgId: string): Promise<string[]> {
  const rows = await t.db.orm
    .select({ id: platformAuditLog.id })
    .from(platformAuditLog)
    .where(eq(platformAuditLog.targetOrgId, orgId))
    .orderBy(desc(platformAuditLog.createdAt), desc(platformAuditLog.id));
  return rows.map((r) => r.id);
}

describe('the list (BR-45)', () => {
  it('lists newest first (created_at desc, id desc), filtered by org', async () => {
    const h = await orgWithHistory('order');
    const page = await listAs(admin, { orgId: h.orgId });
    const expected = await dbOrder(h.orgId);
    expect(expected.length).toBeGreaterThanOrEqual(7);
    expect(page.items.map((e) => e.id)).toEqual(expected);
    expect(page.total).toBe(expected.length);
    expect(page.items.every((e) => e.org?.id === h.orgId)).toBe(true);
  });

  it('orders the unfiltered list the same way and pages it with a matching total', async () => {
    await orgWithHistory('all');
    const all = await t.db.orm
      .select({ id: platformAuditLog.id })
      .from(platformAuditLog)
      .orderBy(desc(platformAuditLog.createdAt), desc(platformAuditLog.id))
      .limit(3);
    const first = await listAs(admin, { pageSize: '3' });
    expect(first.pageSize).toBe(3);
    expect(first.total).toBeGreaterThanOrEqual(all.length);
    expect(first.items.map((e) => e.id)).toEqual(all.map((r) => r.id));
    const second = await listAs(admin, { pageSize: '3', page: '2' });
    expect(second.items.length).toBeLessThanOrEqual(3);
    expect(second.items.map((e) => e.id)).not.toEqual(first.items.map((e) => e.id));
    expect(second.total).toBe(first.total);
  });

  it('filters by action, and by org and action together, with the total of the filter', async () => {
    const h = await orgWithHistory('filter');
    const other = await orgWithHistory('filter2');
    const byAction = await listAs(admin, { action: 'org.suspended' });
    expect(byAction.items.length).toBeGreaterThanOrEqual(2);
    expect(byAction.items.every((e) => e.action === 'org.suspended')).toBe(true);
    const ids = byAction.items.map((e) => e.org?.id);
    expect(ids).toEqual(expect.arrayContaining([h.orgId, other.orgId]));
    const [counted] = await t.db.pool
      .query<{ n: number }>(`select count(*)::int as n from platform_audit_log where action = 'org.suspended'`)
      .then((r) => r.rows);
    expect(byAction.total).toBe(counted?.n);

    const both = await listAs(admin, { orgId: h.orgId, action: 'org.suspended' });
    expect(both.total).toBe(1);
    expect(both.items).toHaveLength(1);
    expect(both.items[0]).toMatchObject({ action: 'org.suspended', org: { id: h.orgId } });

    const none = await listAs(admin, { orgId: randomUUID() });
    expect(none).toMatchObject({ items: [], total: 0 });
  });

  it('shows a reason on suspend and reactivate rows only', async () => {
    const h = await orgWithHistory('reason');
    const page = await listAs(admin, { orgId: h.orgId });
    const reasons = Object.fromEntries(page.items.map((e) => [e.action, e.reason]));
    expect(reasons['org.suspended']).toBe(h.reason);
    expect(reasons['org.reactivated']).toMatch(/^Paid /);
    for (const e of page.items) {
      if (e.action !== 'org.suspended' && e.action !== 'org.reactivated') expect(e.reason, e.action).toBeNull();
    }
  });

  it('shows the old and new name and slug of an edit as changes, and none for other actions', async () => {
    const h = await orgWithHistory('changes');
    const page = await listAs(admin, { orgId: h.orgId, action: 'org.updated' });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.changes).toEqual([
      { field: 'name', from: h.name, to: h.renamed },
      { field: 'slug', from: expect.stringMatching(/^pal-changes-/), to: expect.stringMatching(/-new$/) },
    ]);
    const rest = (await listAs(admin, { orgId: h.orgId })).items.filter((e) => e.action !== 'org.updated');
    expect(rest.some((e) => e.action === 'org.suspended')).toBe(true);
    const roleActions = ['assignment.granted', 'assignment.revoked', 'invitation.created'];
    for (const e of rest.filter((r) => !roleActions.includes(r.action))) expect(e.changes, e.action).toEqual([]);
    for (const e of rest.filter((r) => roleActions.includes(r.action))) {
      expect(
        e.changes.map((c) => c.field),
        e.action,
      ).toEqual(['role']);
    }
  });

  it('shows the role on granted, removed and invited rows, so the sentence can name it', async () => {
    const h = await orgWithHistory('role');
    const handle = `pal-r${next()}`;
    await inviteAndLogin(t, h.orgId, handle, 'viewer', { type: 'org' });
    const userId = await userIdOf(t, handle);
    const granted = await t.app.inject({
      method: 'POST',
      url: `/api/platform/orgs/${h.orgId}/assignments`,
      headers: { cookie: admin },
      payload: { userId, roleId: await roleId(h.orgId, 'admin'), scope: { type: 'org' } },
    });
    expect(granted.statusCode, granted.body).toBe(201);
    const assignmentId = granted.json<{ id: string }>().id;
    const removed = await t.app.inject({
      method: 'DELETE',
      url: `/api/platform/orgs/${h.orgId}/assignments/${assignmentId}`,
      headers: { cookie: admin },
    });
    expect(removed.statusCode, removed.body).toBe(204);
    const page = await listAs(admin, { orgId: h.orgId });
    const roles = (action: string) => page.items.filter((e) => e.action === action).map((e) => e.changes);
    expect(roles('assignment.granted')).toContainEqual([{ field: 'role', from: null, to: 'admin' }]);
    expect(roles('assignment.revoked')).toEqual([[{ field: 'role', from: 'admin', to: null }]]);
    expect(roles('invitation.created')).toContainEqual([{ field: 'role', from: null, to: 'viewer' }]);
  });

  it('builds the target label on read: admin email, org name, member name and invitee email', async () => {
    const h = await orgWithHistory('label');
    const page = await listAs(admin, { orgId: h.orgId });
    const labelOf = (action: string) => page.items.find((e) => e.action === action)?.target;
    expect(labelOf('org.suspended')).toMatchObject({ type: 'org', id: h.orgId, label: h.renamed });
    expect(labelOf('assignment.granted')).toMatchObject({ type: 'assignment', label: h.memberName });
    expect(labelOf('invitation.created')).toMatchObject({ type: 'invitation', label: h.inviteEmail });
    expect(page.items.find((e) => e.action === 'org.suspended')?.org).toEqual({ id: h.orgId, name: h.renamed });

    const grantedTo = `pal-adm${next()}@dev.local`;
    const orgId = (await createOrg(t, `Pal Users ${next()}`, `pal-users-${next()}`)).id;
    const handle = grantedTo.split('@')[0] ?? '';
    await inviteAndLogin(t, orgId, handle, 'viewer', { type: 'org' });
    expect((await grantPlatformAdmin(t, admin, grantedTo)).statusCode).toBe(201);
    const granted = (await listAs(admin, { action: 'platform_admin.granted' })).items.find(
      (e) => e.target.label === grantedTo,
    );
    expect(granted).toMatchObject({ org: null, reason: null, changes: [], target: { type: 'platform_admin' } });
  });

  it('returns exactly the DTO keys and never a payload key, a token or a secret', async () => {
    const h = await orgWithHistory('leak');
    const res = await listRoute(admin, { orgId: h.orgId });
    const body = res.json<{ items: Record<string, unknown>[] }>();
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual(['action', 'actor', 'at', 'changes', 'id', 'org', 'reason', 'target']);
      expect(Object.keys(item['target'] as object).sort()).toEqual(['id', 'label', 'type']);
    }
    for (const word of ['payload', 'roleKey', 'projectIds', 'token', 'scope', 'ghp_']) {
      expect(res.body, word).not.toContain(word);
    }
  });

  it('reads a stored row defensively: a payload of the wrong shape gives a null label, no changes and no reason', async () => {
    const orgId = randomUUID();
    const adminRowId = randomUUID();
    const inserted = await t.db.orm
      .insert(platformAuditLog)
      .values([
        {
          action: 'org.suspended',
          targetType: 'org',
          targetId: orgId,
          targetOrgId: orgId,
          payload: { reason: 7, from: 1 },
        },
        {
          action: 'org.updated',
          targetType: 'org',
          targetId: orgId,
          targetOrgId: orgId,
          payload: { from: 'x', to: [] },
        },
        {
          action: 'assignment.granted',
          targetType: 'assignment',
          targetId: 'x',
          targetOrgId: orgId,
          payload: { userId: 5 },
        },
        { action: 'invitation.created', targetType: 'invitation', targetId: 'x', targetOrgId: orgId, payload: {} },
        { action: 'platform_admin.granted', targetType: 'platform_admin', targetId: adminRowId, payload: [] },
      ])
      .returning({ id: platformAuditLog.id });
    expect(inserted).toHaveLength(5);
    const page = await listAs(admin, { orgId });
    expect(page.items).toHaveLength(4);
    // the fifth row has no target org, so read it by action and pick it out by its target id
    const adminRow = (await listAs(admin, { action: 'platform_admin.granted' })).items.find(
      (e) => e.target.id === adminRowId,
    );
    expect(adminRow).toBeDefined();
    for (const e of [...page.items, ...(adminRow ? [adminRow] : [])]) {
      expect(e.reason, e.action).toBeNull();
      expect(e.changes, e.action).toEqual([]);
      expect(e.target.label, e.action).toBeNull();
      expect(e.org, e.action).toBeNull();
    }
  });

  it('labels an org row from its stored name when the org is gone, with a null org', async () => {
    const ghost = randomUUID();
    await t.db.orm.insert(platformAuditLog).values({
      action: 'org.created',
      targetType: 'org',
      targetId: ghost,
      targetOrgId: ghost,
      payload: { name: 'X' },
    });
    const page = await listAs(admin, { orgId: ghost });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ org: null, target: { type: 'org', id: ghost, label: 'X' } });
  });

  it('keeps total equal to the listed rows when a stored row has an action the contract does not know', async () => {
    const orgId = randomUUID();
    await t.db.orm.insert(platformAuditLog).values([
      { action: 'org.created', targetType: 'org', targetId: orgId, targetOrgId: orgId, payload: { name: 'K' } },
      { action: 'org.deleted', targetType: 'org', targetId: orgId, targetOrgId: orgId, payload: {} },
    ]);
    const page = await listAs(admin, { orgId });
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(page.items.length);
  });

  it('gives a null actor after the actor account is deleted, and a null org when the org is gone', async () => {
    const n = next();
    const org = await createOrg(t, `Pal Gone ${n}`, `pal-gone-${n}`);
    const handle = `pal-actor${n}`;
    await inviteAndLogin(t, org.id, handle, 'viewer', { type: 'org' });
    const email = `${handle}@dev.local`;
    expect((await grantPlatformAdmin(t, admin, email)).statusCode).toBe(201);
    const actorCookie = await loginAs(t, handle);
    const actorId = await userIdOf(t, handle);
    const edit = await t.app.inject({
      method: 'PATCH',
      url: `/api/platform/orgs/${org.id}`,
      headers: { cookie: actorCookie },
      payload: { name: `Pal Gone ${n} By Actor` },
    });
    expect(edit.statusCode, edit.body).toBe(200);

    const before = await listAs(admin, { orgId: org.id, action: 'org.updated' });
    expect(before.items[0]?.actor).toMatchObject({ userId: actorId });

    await t.db.pool.query('delete from "user" where id = $1', [actorId]);
    const after = await listAs(admin, { orgId: org.id, action: 'org.updated' });
    expect(after.items).toHaveLength(1);
    expect(after.items[0]?.actor).toBeNull();
    expect(after.items[0]?.org?.id).toBe(org.id);

    // a row whose target org was never created (or is gone): the org and its label are null
    const ghost = randomUUID();
    await t.db.orm.insert(platformAuditLog).values({
      actorUserId: actorId,
      action: 'org.updated',
      targetType: 'org',
      targetId: ghost,
      targetOrgId: ghost,
      payload: { from: { name: 'A' }, to: { name: 'B' } },
    });
    const gone = await listAs(admin, { orgId: ghost });
    expect(gone.items).toHaveLength(1);
    expect(gone.items[0]).toMatchObject({ actor: null, org: null, target: { type: 'org', id: ghost, label: null } });
    expect(gone.items[0]?.changes).toEqual([{ field: 'name', from: 'A', to: 'B' }]);
  });

  it('rejects a malformed org id or an unknown action with 400 for the platform admin, and lists nothing for an unknown org', async () => {
    expect((await listRoute(admin, { orgId: 'not-a-uuid' })).statusCode).toBe(400);
    expect((await listRoute(admin, { action: 'org.deleted' })).statusCode).toBe(400);
    expect((await listRoute(admin, { page: '0' })).statusCode).toBe(400);
    const unknown = await listAs(admin, { orgId: randomUUID() });
    expect(unknown.items).toEqual([]);
  });
});

describe('access (BR-46)', () => {
  it('answers 403 before any lookup for every non-platform caller, with a known or unknown org id', async () => {
    const h = await orgWithHistory('guard');
    const other = await createOrg(t, `Pal Guard Other ${next()}`, `pal-guard-other-${next()}`);
    const ownerCookie = await inviteAndLogin(t, h.orgId, 'pal-g-own', 'owner', { type: 'org' });
    const { projectId } = await makeProject(t, ownerCookie, await installFake(t, ownerCookie));
    const noOrgInvite = await t.app.inject({
      method: 'POST',
      url: `/api/platform/orgs/${h.orgId}/invitations`,
      headers: { cookie: admin },
      payload: { email: 'pal-nobody@dev.local', roleId: await roleId(h.orgId, 'viewer'), scope: { type: 'org' } },
    });
    expect(noOrgInvite.statusCode).toBe(201);
    const cookies = {
      owner: ownerCookie,
      admin: await inviteAndLogin(t, h.orgId, 'pal-g-adm', 'admin', { type: 'org' }),
      projectAdmin: await inviteAndLogin(t, h.orgId, 'pal-g-padm', 'admin', {
        type: 'project',
        projectIds: [projectId],
      }),
      member: await inviteAndLogin(t, h.orgId, 'pal-g-mem', 'member', { type: 'org' }),
      viewer: await inviteAndLogin(t, h.orgId, 'pal-g-view', 'viewer', { type: 'org' }),
      otherOrgOwner: await inviteAndLogin(t, other.id, 'pal-g-oown', 'owner', { type: 'org' }),
      noOrg: await loginAs(t, 'pal-nobody'),
    };
    for (const [who, cookie] of Object.entries(cookies)) {
      const known = await listRoute(cookie, { orgId: h.orgId });
      const unknown = await listRoute(cookie, { orgId: randomUUID() });
      const malformed = await listRoute(cookie, { orgId: 'not-a-uuid' });
      for (const res of [known, unknown, malformed]) {
        expect(res.statusCode, `${who}: ${res.body}`).toBe(403);
        expect((res.json() as { detail: string }).detail, who).toBe(FORBIDDEN_DETAIL);
        expect(res.body, who).not.toContain(h.name);
        expect(res.body, who).not.toContain(h.reason);
      }
      expect((await listRoute(cookie)).statusCode, who).toBe(403);
    }
  });

  it('answers 401 signed out', async () => {
    expect((await listRoute(undefined)).statusCode).toBe(401);
    expect((await listRoute(undefined, { orgId: randomUUID() })).statusCode).toBe(401);
  });

  it('never shows a platform row or its reason on a tenant audit route', async () => {
    const h = await orgWithHistory('tenant');
    const owner = await inviteAndLogin(t, h.orgId, `pal-t-own${next()}`, 'owner', { type: 'org' });
    const platformIds = new Set(await dbOrder(h.orgId));
    const res = await auditList(t, owner, h.orgId, { pageSize: 100 });
    expect(res.statusCode, res.body).toBe(200);
    const page = res.json<Page<{ id: string; action: string }>>();
    expect(page.items.some((e) => e.action === 'org.suspended')).toBe(true);
    expect(page.items.filter((e) => platformIds.has(e.id))).toEqual([]);
    expect(res.body).not.toContain(h.reason);
    expect(res.body).not.toContain('reason');
    // a tenant owner reads the platform route of the same org only as a 403
    expect((await listRoute(owner, { orgId: h.orgId })).statusCode).toBe(403);
    // the table is untouched by reads
    const [row] = await t.db.orm
      .select({ id: platformAuditLog.id })
      .from(platformAuditLog)
      .where(and(eq(platformAuditLog.targetOrgId, h.orgId), eq(platformAuditLog.action, 'org.suspended')));
    expect(row).toBeDefined();
  });
});
