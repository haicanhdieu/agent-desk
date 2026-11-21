import { randomUUID } from 'node:crypto';
import pg, { type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { InvitationDto, Page, RoleDto } from '@agentdesk/contracts';
import { connections, projects, withOrg } from '@agentdesk/db';
import { createTestApp, type TestApp } from './helpers/app';
import { acceptPendingInvitations } from '../src/auth/accept-invitations';
import { AUTH } from '../src/auth/auth';
import { devSignUp } from '../src/auth/dev-signup';
import { asPlatformAdmin, createOrg, inviteAndLogin, loginAs, userIdOf } from './helpers/auth';
import { expectContract } from './helpers/contract';

let t: TestApp;
let admin: string;

beforeAll(async () => {
  t = await createTestApp();
  admin = await asPlatformAdmin(t);
});
afterAll(async () => {
  await t.close();
});

/** One statement as the app role inside the org's RLS scope. */
async function asOrg(orgId: string, text: string, params: unknown[] = []): Promise<{ rows: QueryResultRow[] }> {
  const client = await t.db.pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.org_id', $1, true)", [orgId]);
    const res = await client.query(text, params);
    await client.query('commit');
    return res;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

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

async function roleIds(orgId: string): Promise<Record<string, string>> {
  const res = await t.app.inject({
    method: 'GET',
    url: `/api/platform/orgs/${orgId}/roles`,
    headers: { cookie: admin },
  });
  const list = res.json<RoleDto[]>();
  return Object.fromEntries(list.map((r) => [r.key, r.id]));
}

function invite(orgId: string, payload: unknown) {
  return t.app.inject({
    method: 'POST',
    url: `/api/platform/orgs/${orgId}/invitations`,
    headers: { cookie: admin },
    payload: payload as object,
  });
}

function list(orgId: string) {
  return t.app.inject({
    method: 'GET',
    url: `/api/platform/orgs/${orgId}/invitations`,
    headers: { cookie: admin },
  });
}

function revokeInvitation(orgId: string, invitationId: string, cookie: string = admin) {
  return t.app.inject({
    method: 'DELETE',
    url: `/api/platform/orgs/${orgId}/invitations/${invitationId}`,
    headers: { cookie },
  });
}

function pointerOf(res: { json: () => unknown }): string | undefined {
  return (res.json() as { errors?: { pointer: string }[] }).errors?.[0]?.pointer;
}

interface Fixture {
  orgId: string;
  roles: Record<string, string>;
  projectId: string;
}

async function fixture(slug: string): Promise<Fixture> {
  const org = await createOrg(t, slug, slug);
  return { orgId: org.id, roles: await roleIds(org.id), projectId: await seedProject(org.id, `P-${slug}`) };
}

describe('platform invitation create', () => {
  it('creates a pending org-scope invitation that expires 7 days after it was created', async () => {
    const f = await fixture('inv-create');
    const res = await invite(f.orgId, { email: 'first@example.com', roleId: f.roles.owner, scope: { type: 'org' } });
    expect(res.statusCode).toBe(201);
    const dto = expectContract('platform.createInvitation', res) as InvitationDto;
    expect(dto).toMatchObject({
      email: 'first@example.com',
      role: { id: f.roles.owner, key: 'owner' },
      scope: { type: 'org' },
      status: 'pending',
      acceptedAt: null,
    });
    const days = (Date.parse(dto.expiresAt) - Date.parse(dto.createdAt)) / 1000;
    expect(Math.abs(days - 7 * 24 * 3600)).toBeLessThan(5);
    const adminId = (await t.db.pool.query('select id from "user" where email = $1', ['admin@dev.local'])).rows[0]?.id;
    expect(dto.invitedBy).toBe(adminId);
  });

  it('lists the id and name of each project of a project-scope invitation', async () => {
    const f = await fixture('inv-project');
    const second = await seedProject(f.orgId, 'Second');
    const res = await invite(f.orgId, {
      email: 'proj@example.com',
      roleId: f.roles.member,
      scope: { type: 'project', projectIds: [f.projectId, second, f.projectId] },
    });
    expect(res.statusCode).toBe(201);
    const dto = expectContract('platform.createInvitation', res) as InvitationDto;
    expect(dto.scope.type).toBe('project');
    if (dto.scope.type !== 'project') throw new Error('unreachable');
    expect([...dto.scope.projects].sort((a, b) => a.name.localeCompare(b.name))).toEqual(
      [
        { id: f.projectId, name: 'P-inv-project' },
        { id: second, name: 'Second' },
      ].sort((a, b) => a.name.localeCompare(b.name)),
    );
  });

  it('stores the address in lower case', async () => {
    const f = await fixture('inv-case');
    const res = await invite(f.orgId, { email: 'Mixed@Example.COM', roleId: f.roles.viewer, scope: { type: 'org' } });
    expect(res.statusCode).toBe(201);
    expect((res.json() as InvitationDto).email).toBe('mixed@example.com');
    const row = await asOrg(f.orgId, 'select email from invitations');
    expect(row.rows).toEqual([{ email: 'mixed@example.com' }]);
  });
});

describe('platform invitation validation', () => {
  it('rejects a malformed address with 400 and a /email pointer', async () => {
    const f = await fixture('inv-bad-email');
    const res = await invite(f.orgId, { email: 'not-an-email', roleId: f.roles.viewer, scope: { type: 'org' } });
    expect(res.statusCode).toBe(400);
    expect(pointerOf(res)).toBe('/email');
  });

  it('rejects an empty project list with 400', async () => {
    const f = await fixture('inv-empty-list');
    const res = await invite(f.orgId, {
      email: 'a@example.com',
      roleId: f.roles.viewer,
      scope: { type: 'project', projectIds: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses another org's role with 422 /roleId", async () => {
    const f = await fixture('inv-role-a');
    const other = await fixture('inv-role-b');
    const res = await invite(f.orgId, { email: 'a@example.com', roleId: other.roles.viewer, scope: { type: 'org' } });
    expect(res.statusCode).toBe(422);
    expect(pointerOf(res)).toBe('/roleId');
  });

  it('refuses a role id that does not exist with 422 /roleId', async () => {
    const f = await fixture('inv-role-none');
    const res = await invite(f.orgId, { email: 'a@example.com', roleId: randomUUID(), scope: { type: 'org' } });
    expect(res.statusCode).toBe(422);
    expect(pointerOf(res)).toBe('/roleId');
  });

  it('refuses owner on a project scope with 422 /roleId', async () => {
    const f = await fixture('inv-owner-project');
    const res = await invite(f.orgId, {
      email: 'a@example.com',
      roleId: f.roles.owner,
      scope: { type: 'project', projectIds: [f.projectId] },
    });
    expect(res.statusCode).toBe(422);
    expect(pointerOf(res)).toBe('/roleId');
  });

  it("refuses another org's project with 422 and the index in the pointer", async () => {
    const f = await fixture('inv-proj-a');
    const other = await fixture('inv-proj-b');
    const res = await invite(f.orgId, {
      email: 'a@example.com',
      roleId: f.roles.member,
      scope: { type: 'project', projectIds: [other.projectId] },
    });
    expect(res.statusCode).toBe(422);
    expect(pointerOf(res)).toBe('/scope/projectIds/0');
    const second = await invite(f.orgId, {
      email: 'b@example.com',
      roleId: f.roles.member,
      scope: { type: 'project', projectIds: [f.projectId, randomUUID()] },
    });
    expect(second.statusCode).toBe(422);
    expect(pointerOf(second)).toBe('/scope/projectIds/1');
  });

  it('refuses a second pending invitation for the address with 409 /email', async () => {
    const f = await fixture('inv-dup');
    const body = { email: 'dup@example.com', roleId: f.roles.viewer, scope: { type: 'org' } };
    expect((await invite(f.orgId, body)).statusCode).toBe(201);
    const again = await invite(f.orgId, body);
    expect(again.statusCode).toBe(409);
    expect(pointerOf(again)).toBe('/email');
  });

  it('a second invitation differing only in case is 409', async () => {
    const f = await fixture('inv-dup-case');
    const first = await invite(f.orgId, { email: 'Mixed@Example.COM', roleId: f.roles.viewer, scope: { type: 'org' } });
    expect(first.statusCode).toBe(201);
    const again = await invite(f.orgId, { email: 'mixed@example.com', roleId: f.roles.viewer, scope: { type: 'org' } });
    expect(again.statusCode).toBe(409);
    expect(pointerOf(again)).toBe('/email');
  });

  it('two concurrent invitations for one address give 201 and 409', async () => {
    const f = await fixture('inv-race');
    const body = { email: 'race@example.com', roleId: f.roles.viewer, scope: { type: 'org' } };
    const results = await Promise.all([invite(f.orgId, body), invite(f.orgId, body)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const count = await asOrg(f.orgId, "select count(*)::int as n from invitations where status = 'pending'");
    expect(count.rows[0]?.n).toBe(1);
  });

  it('refuses an address that already belongs to a member of the org with 409 /email', async () => {
    const f = await fixture('inv-member');
    const home = await fixture('inv-member-home');
    await inviteAndLogin(t, home.orgId, 'existing-member', 'viewer', { type: 'org' });
    const row = (await t.db.pool.query('select id, email from "user" where handle = $1', ['existing-member'])).rows[0];
    await t.db.pool.query(
      `insert into member (id, organization_id, user_id, role, created_at) values ($1, $2, $3, 'member', now())`,
      [randomUUID(), f.orgId, row?.id],
    );
    const res = await invite(f.orgId, {
      email: String(row?.email).toUpperCase(),
      roleId: f.roles.viewer,
      scope: { type: 'org' },
    });
    expect(res.statusCode).toBe(409);
    expect(pointerOf(res)).toBe('/email');
  });

  it('an unknown org is 404 and a non-admin is 403', async () => {
    const f = await fixture('inv-404');
    const body = { email: 'a@example.com', roleId: f.roles.viewer, scope: { type: 'org' } };
    expect((await invite(randomUUID(), body)).statusCode).toBe(404);
    const other = await inviteAndLogin(t, f.orgId, 'not-an-admin', 'viewer', { type: 'org' });
    const denied = await t.app.inject({
      method: 'POST',
      url: `/api/platform/orgs/${f.orgId}/invitations`,
      headers: { cookie: other },
      payload: body,
    });
    expect(denied.statusCode).toBe(403);
    expect((await list(randomUUID())).statusCode).toBe(404);
  });
});

describe('platform invitation expiry', () => {
  it('shows an old pending invitation as expired, refuses to revoke it and lets a new one replace it', async () => {
    const f = await fixture('inv-expiry');
    const body = { email: 'late@example.com', roleId: f.roles.viewer, scope: { type: 'org' } };
    const created = (await invite(f.orgId, body)).json<InvitationDto>();
    await asOrg(f.orgId, "update invitations set expires_at = now() - interval '1 minute' where id = $1", [created.id]);

    const listed = (await list(f.orgId)).json<Page<InvitationDto>>();
    expect(listed.items.find((i) => i.id === created.id)?.status).toBe('expired');

    const revoked = await revokeInvitation(f.orgId, created.id);
    expect(revoked.statusCode).toBe(409);

    const replacement = await invite(f.orgId, body);
    expect(replacement.statusCode).toBe(201);
    const stored = await asOrg(f.orgId, 'select status from invitations where id = $1', [created.id]);
    expect(stored.rows[0]?.status).toBe('expired');
    const audit = await asOrg(f.orgId, "select * from audit_log where action = 'invitation.expired'");
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      target_type: 'invitation',
      target_id: created.id,
      payload: { email: 'late@example.com', actorKind: 'platform_admin' },
    });
  });
});

describe('platform invitation list and revoke', () => {
  it('lists newest first with the computed status', async () => {
    const f = await fixture('inv-list');
    const a = (
      await invite(f.orgId, { email: 'a@example.com', roleId: f.roles.viewer, scope: { type: 'org' } })
    ).json<InvitationDto>();
    await asOrg(f.orgId, "update invitations set created_at = now() - interval '1 hour' where id = $1", [a.id]);
    const b = (
      await invite(f.orgId, { email: 'b@example.com', roleId: f.roles.viewer, scope: { type: 'org' } })
    ).json<InvitationDto>();
    const res = await list(f.orgId);
    expect(res.statusCode).toBe(200);
    const page = expectContract('platform.listInvitations', res) as Page<InvitationDto>;
    expect(page.items.map((i) => i.id)).toEqual([b.id, a.id]);
    expect(page.total).toBe(2);
  });

  it('revokes with 204, lists it as revoked and refuses a second revoke with 409', async () => {
    const f = await fixture('inv-revoke');
    const created = (
      await invite(f.orgId, { email: 'gone@example.com', roleId: f.roles.viewer, scope: { type: 'org' } })
    ).json<InvitationDto>();
    const res = await revokeInvitation(f.orgId, created.id);
    expect(res.statusCode).toBe(204);
    const page = (await list(f.orgId)).json<Page<InvitationDto>>();
    expect(page.items.find((i) => i.id === created.id)?.status).toBe('revoked');
    expect((await revokeInvitation(f.orgId, created.id)).statusCode).toBe(409);
    // the address is free again
    const again = await invite(f.orgId, { email: 'gone@example.com', roleId: f.roles.viewer, scope: { type: 'org' } });
    expect(again.statusCode).toBe(201);
  });

  it('answers 404 for an unknown invitation and for one of another org', async () => {
    const f = await fixture('inv-404-a');
    const other = await fixture('inv-404-b');
    const created = (
      await invite(other.orgId, { email: 'x@example.com', roleId: other.roles.viewer, scope: { type: 'org' } })
    ).json<InvitationDto>();
    expect((await revokeInvitation(f.orgId, randomUUID())).statusCode).toBe(404);
    expect((await revokeInvitation(f.orgId, created.id)).statusCode).toBe(404);
    expect((await revokeInvitation(randomUUID(), created.id)).statusCode).toBe(404);
    const still = await asOrg(other.orgId, 'select status from invitations where id = $1', [created.id]);
    expect(still.rows[0]?.status).toBe('pending');
  });
});

describe('invitation audit entries', () => {
  it('writes created and revoked rows with the role and scope and no secret-like key', async () => {
    const f = await fixture('inv-audit');
    const created = (
      await invite(f.orgId, {
        email: 'audit@example.com',
        roleId: f.roles.member,
        scope: { type: 'project', projectIds: [f.projectId] },
      })
    ).json<InvitationDto>();
    await revokeInvitation(f.orgId, created.id);
    const adminId = (await t.db.pool.query('select id from "user" where email = $1', ['admin@dev.local'])).rows[0]?.id;
    const rows = await asOrg(f.orgId, "select * from audit_log where target_type = 'invitation' order by at, action");
    expect(rows.rows.map((r) => r.action).sort()).toEqual(['invitation.created', 'invitation.revoked']);
    for (const row of rows.rows) {
      expect(row).toMatchObject({ actor_user_id: adminId, target_type: 'invitation', target_id: created.id });
      expect(row.payload).toEqual({
        email: 'audit@example.com',
        to: { roleId: f.roles.member, roleKey: 'member', scope: { type: 'project', projectIds: [f.projectId] } },
        actorKind: 'platform_admin',
      });
      expect(JSON.stringify(Object.keys(row.payload))).not.toMatch(/token|secret|password/i);
    }
  });

  it('an org-scope entry carries no project list', async () => {
    const f = await fixture('inv-audit-org');
    const created = (
      await invite(f.orgId, { email: 'o@example.com', roleId: f.roles.owner, scope: { type: 'org' } })
    ).json<InvitationDto>();
    const rows = await asOrg(f.orgId, 'select payload from audit_log where target_id = $1', [created.id]);
    expect(rows.rows[0]?.payload).toEqual({
      email: 'o@example.com',
      to: { roleId: f.roles.owner, roleKey: 'owner', scope: { type: 'org' } },
      actorKind: 'platform_admin',
    });
  });
});

async function activeOrgOf(cookie: string): Promise<string | null | undefined> {
  const res = await t.app.inject({ method: 'GET', url: '/auth/get-session', headers: { cookie } });
  return res.json<{ session?: { activeOrganizationId?: string | null } } | null>()?.session?.activeOrganizationId;
}

async function memberRows(orgId: string, userId: string): Promise<QueryResultRow[]> {
  const res = await t.db.pool.query('select * from member where organization_id = $1 and user_id = $2', [
    orgId,
    userId,
  ]);
  return res.rows;
}

async function assignmentRows(orgId: string, userId: string): Promise<QueryResultRow[]> {
  const res = await asOrg(
    orgId,
    `select ra.scope_type, ra.project_id, ra.granted_by, r.key from role_assignments ra
       join roles r on r.id = ra.role_id where ra.user_id = $1 order by ra.project_id nulls first`,
    [userId],
  );
  return res.rows;
}

async function membershipCount(userId: string): Promise<number> {
  const res = await t.db.pool.query('select count(*)::int as n from member where user_id = $1', [userId]);
  return res.rows[0]?.n;
}

describe('accepting invitations at sign-in', () => {
  it('BR-55: an invited person signs in to the invited org with the invited role and no personal org', async () => {
    const f = await fixture('acc-org');
    const cookie = await inviteAndLogin(t, f.orgId, 'acc-h1', 'viewer', { type: 'org' });
    const userId = await userIdOf(t, 'acc-h1');
    expect(await activeOrgOf(cookie)).toBe(f.orgId);
    expect(await memberRows(f.orgId, userId)).toHaveLength(1);
    expect(await assignmentRows(f.orgId, userId)).toMatchObject([
      { scope_type: 'org', project_id: null, key: 'viewer' },
    ]);
    expect(await membershipCount(userId)).toBe(1);
  });

  it('BR-55: an owner invitation makes an owner member and a member invitation lists one assignment per project', async () => {
    const f = await fixture('acc-proj');
    const p2 = await seedProject(f.orgId, 'P2-acc-proj');
    await inviteAndLogin(t, f.orgId, 'acc-owner', 'owner', { type: 'org' });
    const ownerId = await userIdOf(t, 'acc-owner');
    expect((await memberRows(f.orgId, ownerId))[0]?.role).toBe('owner');
    expect(await assignmentRows(f.orgId, ownerId)).toMatchObject([{ scope_type: 'org', key: 'owner' }]);

    await inviteAndLogin(t, f.orgId, 'acc-mem', 'member', { type: 'project', projectIds: [f.projectId, p2] });
    const memId = await userIdOf(t, 'acc-mem');
    expect((await memberRows(f.orgId, memId))[0]?.role).toBe('member');
    const rows = await assignmentRows(f.orgId, memId);
    expect(rows.map((r) => r.project_id).sort()).toEqual([f.projectId, p2].sort());
    expect(rows.every((r) => r.scope_type === 'project' && r.key === 'member')).toBe(true);
  });

  it('BR-56: an existing user invited to a second org joins it on the next sign-in and the invitation is accepted', async () => {
    const first = await fixture('acc-second-a');
    const second = await fixture('acc-second-b');
    await inviteAndLogin(t, first.orgId, 'acc-h2', 'viewer', { type: 'org' });
    const userId = await userIdOf(t, 'acc-h2');
    expect(await memberRows(second.orgId, userId)).toHaveLength(0);

    await inviteAndLogin(t, second.orgId, 'acc-h2', 'member', { type: 'org' });
    expect(await memberRows(second.orgId, userId)).toHaveLength(1);
    const listed = (await list(second.orgId)).json<Page<InvitationDto>>();
    expect(listed.items[0]).toMatchObject({ email: 'acc-h2@dev.local', status: 'accepted' });
    expect(listed.items[0]?.acceptedAt).not.toBeNull();
    // the oldest membership stays the active org
    const cookie = await loginAs(t, 'acc-h2');
    expect(await activeOrgOf(cookie)).toBe(first.orgId);
  });

  it('BR-57: an expired invitation does not let its handle sign up, and it stays non-accepted', async () => {
    const f = await fixture('acc-expired');
    const created = (
      await invite(f.orgId, { email: 'acc-late@dev.local', roleId: f.roles.viewer, scope: { type: 'org' } })
    ).json<InvitationDto>();
    await asOrg(f.orgId, "update invitations set expires_at = now() - interval '1 minute' where id = $1", [created.id]);
    expect((await devLogin('acc-late')).statusCode).toBe(401);
    expect(await userRowCount('acc-late@dev.local')).toBe(0);
    const stored = await asOrg(f.orgId, 'select status, accepted_by from invitations where id = $1', [created.id]);
    expect(stored.rows[0]).toMatchObject({ status: 'pending', accepted_by: null });
  });

  it('an invitation whose projects were all deleted is accepted with membership only and names them as skipped', async () => {
    const f = await fixture('acc-deleted');
    const p2 = await seedProject(f.orgId, 'P2-acc-deleted');
    const created = (
      await invite(f.orgId, {
        email: 'acc-gone@dev.local',
        roleId: f.roles.member,
        scope: { type: 'project', projectIds: [f.projectId, p2] },
      })
    ).json<InvitationDto>();
    await asOrg(f.orgId, 'delete from projects where id = any($1::uuid[])', [[f.projectId, p2]]);
    await loginAs(t, 'acc-gone');
    const userId = await userIdOf(t, 'acc-gone');
    expect(await memberRows(f.orgId, userId)).toHaveLength(1);
    expect(await assignmentRows(f.orgId, userId)).toHaveLength(0);
    const stored = await asOrg(f.orgId, 'select status from invitations where id = $1', [created.id]);
    expect(stored.rows[0]?.status).toBe('accepted');
    const audit = await asOrg(f.orgId, "select payload from audit_log where action = 'invitation.accepted'");
    const skipped = (audit.rows[0]?.payload as { skippedProjectIds: string[] }).skippedProjectIds;
    expect([...skipped].sort()).toEqual([f.projectId, p2].sort());
    const granted = await asOrg(f.orgId, "select 1 from audit_log where action = 'assignment.granted'");
    expect(granted.rows).toHaveLength(0);
  });

  it('a project deleted before sign-in is skipped while the others are granted', async () => {
    const f = await fixture('acc-partial');
    const p2 = await seedProject(f.orgId, 'P2-acc-partial');
    await invite(f.orgId, {
      email: 'acc-part@dev.local',
      roleId: f.roles.member,
      scope: { type: 'project', projectIds: [f.projectId, p2] },
    });
    await asOrg(f.orgId, 'delete from projects where id = $1', [p2]);
    await loginAs(t, 'acc-part');
    const rows = await assignmentRows(f.orgId, await userIdOf(t, 'acc-part'));
    expect(rows.map((r) => r.project_id)).toEqual([f.projectId]);
    const audit = await asOrg(f.orgId, "select payload from audit_log where action = 'invitation.accepted'");
    expect((audit.rows[0]?.payload as { skippedProjectIds: string[] }).skippedProjectIds).toEqual([p2]);
  });

  it('a repeat sign-in creates nothing new', async () => {
    const f = await fixture('acc-repeat');
    await inviteAndLogin(t, f.orgId, 'acc-rep', 'member', { type: 'project', projectIds: [f.projectId] });
    const userId = await userIdOf(t, 'acc-rep');
    await loginAs(t, 'acc-rep');
    await loginAs(t, 'acc-rep');
    expect(await memberRows(f.orgId, userId)).toHaveLength(1);
    expect(await assignmentRows(f.orgId, userId)).toHaveLength(1);
    const audit = await asOrg(
      f.orgId,
      "select action from audit_log where action like '%.accepted' or action = 'assignment.granted'",
    );
    expect(audit.rows).toHaveLength(2);
  });

  it('a concurrent pair of accepts creates one membership and one assignment', async () => {
    const f = await fixture('acc-race');
    await invite(f.orgId, { email: 'acc-race@dev.local', roleId: f.roles.viewer, scope: { type: 'org' } });
    const userId = randomUUID();
    await t.db.pool.query(
      `insert into "user" (id, name, email, email_verified, handle) values ($1, 'race', 'acc-race@dev.local', true, 'acc-race')`,
      [userId],
    );
    const who = { id: userId, email: 'acc-race@dev.local', emailVerified: true };
    await Promise.all([acceptPendingInvitations(t.db, who), acceptPendingInvitations(t.db, who)]);
    expect(await memberRows(f.orgId, userId)).toHaveLength(1);
    expect(await assignmentRows(f.orgId, userId)).toHaveLength(1);
  });

  it('a many-project invitation grants and audits every project in a constant number of statements', async () => {
    const f = await fixture('acc-bulk');
    const extra = [await seedProject(f.orgId, 'P2-acc-bulk'), await seedProject(f.orgId, 'P3-acc-bulk')];
    const projectIds = [f.projectId, ...extra];
    const created = (
      await invite(f.orgId, {
        email: 'acc-bulk@dev.local',
        roleId: f.roles.member,
        scope: { type: 'project', projectIds },
      })
    ).json<InvitationDto>();
    const userId = randomUUID();
    await t.db.pool.query(
      `insert into "user" (id, name, email, email_verified, handle) values ($1, 'bulk', 'acc-bulk@dev.local', true, 'acc-bulk')`,
      [userId],
    );
    const original = pg.Client.prototype.query;
    const texts: string[] = [];
    const spy = vi.spyOn(pg.Client.prototype, 'query').mockImplementation(function (
      this: pg.Client,
      ...args: unknown[]
    ) {
      const first = args[0];
      texts.push(typeof first === 'string' ? first : ((first as { text?: string } | null)?.text ?? ''));
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    } as typeof pg.Client.prototype.query);
    try {
      await acceptPendingInvitations(t.db, { id: userId, email: 'acc-bulk@dev.local', emailVerified: true });
    } finally {
      spy.mockRestore();
    }
    const count = (needle: string): number => texts.filter((s) => s.includes(needle)).length;
    expect(count('insert into "role_assignments"')).toBe(1);
    expect(count('insert into "audit_log"')).toBe(2);

    const rows = await assignmentRows(f.orgId, userId);
    expect(rows.map((r) => r.project_id).sort()).toEqual([...projectIds].sort());
    const granted = await asOrg(
      f.orgId,
      "select target_id, payload from audit_log where action = 'assignment.granted' order by id",
    );
    expect(granted.rows).toHaveLength(3);
    expect(granted.rows.every((r) => r.target_id === userId)).toBe(true);
    expect(
      granted.rows.map((r) => (r.payload as { to: { scope: { projectId: string } } }).to.scope.projectId).sort(),
    ).toEqual([...projectIds].sort());
    expect(granted.rows[0]?.payload).toMatchObject({ via: { invitationId: created.id } });
  });

  it('N5: the audit rows name the inviter as the actor and link each grant to the invitation', async () => {
    const f = await fixture('acc-audit');
    const created = (
      await invite(f.orgId, {
        email: 'acc-aud@dev.local',
        roleId: f.roles.member,
        scope: { type: 'project', projectIds: [f.projectId] },
      })
    ).json<InvitationDto>();
    await loginAs(t, 'acc-aud');
    const userId = await userIdOf(t, 'acc-aud');
    const adminId = await userIdOf(t, 'admin');
    const accepted = await asOrg(f.orgId, "select * from audit_log where action = 'invitation.accepted'");
    expect(accepted.rows).toHaveLength(1);
    expect(accepted.rows[0]).toMatchObject({
      actor_user_id: adminId,
      target_type: 'invitation',
      target_id: created.id,
    });
    expect(accepted.rows[0]?.payload).toEqual({
      email: 'acc-aud@dev.local',
      to: { roleId: f.roles.member, roleKey: 'member', scope: { type: 'project', projectIds: [f.projectId] } },
      acceptedBy: userId,
    });
    const granted = await asOrg(f.orgId, "select * from audit_log where action = 'assignment.granted'");
    expect(granted.rows).toHaveLength(1);
    expect(granted.rows[0]).toMatchObject({ actor_user_id: adminId, target_type: 'user', target_id: userId });
    expect(granted.rows[0]?.payload).toEqual({
      to: { roleId: f.roles.member, roleKey: 'member', scope: { type: 'project', projectId: f.projectId } },
      via: { invitationId: created.id },
    });
  });

  it('Review Focus 1: an invitation sent in upper case is accepted at sign-in', async () => {
    const f = await fixture('acc-upper');
    const res = await invite(f.orgId, { email: 'ACC-H5@DEV.LOCAL', roleId: f.roles.viewer, scope: { type: 'org' } });
    expect(res.statusCode).toBe(201);
    await loginAs(t, 'acc-h5');
    expect(await memberRows(f.orgId, await userIdOf(t, 'acc-h5'))).toHaveLength(1);
  });

  it('inviting an address that has since joined is 409 /email', async () => {
    const f = await fixture('acc-again');
    await inviteAndLogin(t, f.orgId, 'acc-h1b', 'viewer', { type: 'org' });
    const res = await invite(f.orgId, { email: 'acc-h1b@dev.local', roleId: f.roles.viewer, scope: { type: 'org' } });
    expect(res.statusCode).toBe(409);
    expect(pointerOf(res)).toBe('/email');
  });

  it('does nothing for an unverified email', async () => {
    const f = await fixture('acc-unverified');
    await invite(f.orgId, { email: 'acc-unv@dev.local', roleId: f.roles.viewer, scope: { type: 'org' } });
    const userId = randomUUID();
    await t.db.pool.query(
      `insert into "user" (id, name, email, email_verified, handle) values ($1, 'unv', 'acc-unv@dev.local', false, 'acc-unv')`,
      [userId],
    );
    await acceptPendingInvitations(t.db, { id: userId, email: 'acc-unv@dev.local', emailVerified: false });
    expect(await memberRows(f.orgId, userId)).toHaveLength(0);
    expect(await assignmentRows(f.orgId, userId)).toHaveLength(0);
    const pending = (await list(f.orgId)).json<Page<InvitationDto>>();
    expect(pending.items[0]?.status).toBe('pending');
    // positive control: the same call for a verified email applies it
    await acceptPendingInvitations(t.db, { id: userId, email: 'acc-unv@dev.local', emailVerified: true });
    expect(await memberRows(f.orgId, userId)).toHaveLength(1);
  });

  it('accepts an invitation at the next sign-in of a legacy dev user whose stored email is unverified', async () => {
    const first = await fixture('acc-legacy-a');
    const f = await fixture('acc-legacy');
    await inviteAndLogin(t, first.orgId, 'acc-legacy', 'viewer', { type: 'org' });
    const userId = await userIdOf(t, 'acc-legacy');
    await t.db.pool.query('update "user" set email_verified = false where id = $1', [userId]);
    await invite(f.orgId, { email: 'acc-legacy@dev.local', roleId: f.roles.viewer, scope: { type: 'org' } });
    await loginAs(t, 'acc-legacy');
    expect(await memberRows(f.orgId, userId)).toHaveLength(1);
  });

  it('BR-58: a revoked invitation does not let its handle sign up', async () => {
    const f = await fixture('acc-revoked');
    const created = (
      await invite(f.orgId, { email: 'acc-rev@dev.local', roleId: f.roles.viewer, scope: { type: 'org' } })
    ).json<InvitationDto>();
    expect((await revokeInvitation(f.orgId, created.id)).statusCode).toBe(204);
    expect((await devLogin('acc-rev')).statusCode).toBe(401);
    expect(await userRowCount('acc-rev@dev.local')).toBe(0);
    const listed = (await list(f.orgId)).json<Page<InvitationDto>>();
    expect(listed.items.find((i) => i.id === created.id)?.status).toBe('revoked');
    expect((await revokeInvitation(f.orgId, created.id)).statusCode).toBe(409);
  });

  it('an invitation for another address does not let a different handle sign up', async () => {
    const f = await fixture('acc-other');
    await invite(f.orgId, { email: 'acc-nobody@dev.local', roleId: f.roles.viewer, scope: { type: 'org' } });
    expect((await devLogin('acc-somebody')).statusCode).toBe(401);
    expect(await userRowCount('acc-somebody@dev.local')).toBe(0);
    expect(await userRowCount('acc-nobody@dev.local')).toBe(0);
  });

  it('dev-login links a fake provider account for the handle', async () => {
    const f = await fixture('acc-link-org');
    await inviteAndLogin(t, f.orgId, 'acc-link', 'viewer', { type: 'org' });
    await loginAs(t, 'acc-link');
    const userId = await userIdOf(t, 'acc-link');
    const res = await t.db.pool.query(
      "select provider_id, account_id from account where user_id = $1 and provider_id = 'fake'",
      [userId],
    );
    expect(res.rows).toEqual([{ provider_id: 'fake', account_id: 'acc-link' }]);
  });
});

describe('tenant invitations (BR-60)', () => {
  let orgId: string;
  let roles: Record<string, string>;
  let p1: string;
  let p2: string;
  let owner: string;
  let orgAdmin: string;
  let projectAdmin: string;
  let plainMember: string;
  let viewer: string;

  beforeAll(async () => {
    const f = await fixture('ten-inv');
    orgId = f.orgId;
    roles = f.roles;
    p1 = f.projectId;
    p2 = await seedProject(orgId, 'Second-ten-inv');
    owner = await inviteAndLogin(t, orgId, 'ten-o', 'owner', { type: 'org' });
    orgAdmin = await inviteAndLogin(t, orgId, 'ten-d', 'admin', { type: 'org' });
    projectAdmin = await inviteAndLogin(t, orgId, 'ten-a', 'admin', { type: 'project', projectIds: [p1] });
    plainMember = await inviteAndLogin(t, orgId, 'ten-b', 'member', { type: 'org' });
    viewer = await inviteAndLogin(t, orgId, 'ten-v', 'viewer', { type: 'org' });
  });

  function tenantInvite(cookie: string, payload: unknown) {
    return t.app.inject({
      method: 'POST',
      url: `/api/orgs/${orgId}/invitations`,
      headers: { cookie },
      payload: payload as object,
    });
  }
  function tenantList(cookie: string) {
    return t.app.inject({ method: 'GET', url: `/api/orgs/${orgId}/invitations`, headers: { cookie } });
  }
  function tenantRevoke(cookie: string, id: string) {
    return t.app.inject({ method: 'DELETE', url: `/api/orgs/${orgId}/invitations/${id}`, headers: { cookie } });
  }
  async function statusOf(id: string): Promise<string | undefined> {
    const page = (await tenantList(owner)).json<Page<InvitationDto>>();
    return page.items.find((i) => i.id === id)?.status;
  }

  it('lets a project admin invite a member on a project they administer', async () => {
    const res = await tenantInvite(projectAdmin, {
      email: 'ten-new1@example.com',
      roleId: roles.member,
      scope: { type: 'project', projectIds: [p1] },
    });
    expect(res.statusCode).toBe(201);
    const dto = expectContract('invitations.create', res) as InvitationDto;
    expect(dto).toMatchObject({
      email: 'ten-new1@example.com',
      status: 'pending',
      role: { key: 'member' },
      scope: { type: 'project', projects: [{ id: p1 }] },
    });
  });

  it('lets a project admin invite an admin on their project', async () => {
    const res = await tenantInvite(projectAdmin, {
      email: 'ten-new2@example.com',
      roleId: roles.admin,
      scope: { type: 'project', projectIds: [p1] },
    });
    expect(res.statusCode).toBe(201);
  });

  it('refuses a project admin at org scope, on a project they do not administer, or for the owner role', async () => {
    const atOrg = await tenantInvite(projectAdmin, {
      email: 'ten-no1@example.com',
      roleId: roles.member,
      scope: { type: 'org' },
    });
    expect(atOrg.statusCode).toBe(403);
    expect(atOrg.json<{ detail: string }>().detail).toBe('Not allowed for your role here');
    const twoProjects = await tenantInvite(projectAdmin, {
      email: 'ten-no2@example.com',
      roleId: roles.member,
      scope: { type: 'project', projectIds: [p1, p2] },
    });
    expect(twoProjects.statusCode).toBe(403);
    const ownerRole = await tenantInvite(projectAdmin, {
      email: 'ten-no3@example.com',
      roleId: roles.owner,
      scope: { type: 'project', projectIds: [p1] },
    });
    expect(ownerRole.statusCode).toBe(403);
    // a project outside the org is 403 too for someone who administers only P1: no hint whether it exists
    const unknownProject = await tenantInvite(projectAdmin, {
      email: 'ten-no4@example.com',
      roleId: roles.member,
      scope: { type: 'project', projectIds: [randomUUID()] },
    });
    expect(unknownProject.statusCode).toBe(403);
    const none = await list(orgId);
    expect(none.json<Page<InvitationDto>>().items.some((i) => i.email.startsWith('ten-no'))).toBe(false);
  });

  it('refuses a plain member and a viewer', async () => {
    for (const cookie of [plainMember, viewer]) {
      const res = await tenantInvite(cookie, {
        email: 'ten-no5@example.com',
        roleId: roles.viewer,
        scope: { type: 'project', projectIds: [p1] },
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it('lets an org owner invite another owner and refuses an org admin the owner role', async () => {
    const ok = await tenantInvite(owner, { email: 'ten-own@example.com', roleId: roles.owner, scope: { type: 'org' } });
    expect(ok.statusCode).toBe(201);
    const refused = await tenantInvite(orgAdmin, {
      email: 'ten-own2@example.com',
      roleId: roles.owner,
      scope: { type: 'org' },
    });
    expect(refused.statusCode).toBe(403);
    const adminOnProject = await tenantInvite(orgAdmin, {
      email: 'ten-own3@example.com',
      roleId: roles.owner,
      scope: { type: 'project', projectIds: [p1] },
    });
    expect(adminOnProject.statusCode).toBe(403);
  });

  it('lets an org admin invite an admin at org scope and gives 422 for a bad role or project', async () => {
    const ok = await tenantInvite(orgAdmin, {
      email: 'ten-adm@example.com',
      roleId: roles.admin,
      scope: { type: 'org' },
    });
    expect(ok.statusCode).toBe(201);
    const ownerOnProject = await tenantInvite(owner, {
      email: 'ten-422a@example.com',
      roleId: roles.owner,
      scope: { type: 'project', projectIds: [p1] },
    });
    expect(ownerOnProject.statusCode).toBe(422);
    expect(pointerOf(ownerOnProject)).toBe('/roleId');
    const badProject = await tenantInvite(orgAdmin, {
      email: 'ten-422b@example.com',
      roleId: roles.member,
      scope: { type: 'project', projectIds: [p1, randomUUID()] },
    });
    expect(badProject.statusCode).toBe(422);
    expect(pointerOf(badProject)).toBe('/scope/projectIds/1');
  });

  it('shows a project admin only the invitations whose every project they administer', async () => {
    const others = await tenantInvite(owner, {
      email: 'ten-p2@example.com',
      roleId: roles.member,
      scope: { type: 'project', projectIds: [p2] },
    });
    expect(others.statusCode).toBe(201);
    const mixed = await tenantInvite(owner, {
      email: 'ten-mixed@example.com',
      roleId: roles.member,
      scope: { type: 'project', projectIds: [p1, p2] },
    });
    expect(mixed.statusCode).toBe(201);

    const res = await tenantList(projectAdmin);
    expect(res.statusCode).toBe(200);
    const page = expectContract('invitations.list', res) as Page<InvitationDto>;
    const emails = page.items.map((i) => i.email);
    expect(emails).toContain('ten-new1@example.com');
    expect(emails).not.toContain('ten-p2@example.com');
    expect(emails).not.toContain('ten-mixed@example.com');
    expect(emails).not.toContain('ten-own@example.com');
    expect(page.total).toBe(page.items.length);

    const all = (await tenantList(owner)).json<Page<InvitationDto>>().items.map((i) => i.email);
    expect(all).toEqual(
      expect.arrayContaining([
        'ten-new1@example.com',
        'ten-p2@example.com',
        'ten-mixed@example.com',
        'ten-own@example.com',
      ]),
    );
    const adminAll = (await tenantList(orgAdmin)).json<Page<InvitationDto>>().items.map((i) => i.email);
    expect(adminAll).toContain('ten-p2@example.com');
    expect((await tenantList(plainMember)).statusCode).toBe(403);
    expect((await tenantList(viewer)).statusCode).toBe(403);
  });

  it('lets a project admin revoke their own project invitation and not another one', async () => {
    const mine = (
      await tenantInvite(projectAdmin, {
        email: 'ten-rev1@example.com',
        roleId: roles.viewer,
        scope: { type: 'project', projectIds: [p1] },
      })
    ).json<InvitationDto>();
    const theirs = (
      await tenantInvite(owner, {
        email: 'ten-rev2@example.com',
        roleId: roles.viewer,
        scope: { type: 'project', projectIds: [p2] },
      })
    ).json<InvitationDto>();
    const atOrg = (
      await tenantInvite(owner, { email: 'ten-rev3@example.com', roleId: roles.viewer, scope: { type: 'org' } })
    ).json<InvitationDto>();

    expect((await tenantRevoke(projectAdmin, theirs.id)).statusCode).toBe(403);
    expect((await tenantRevoke(projectAdmin, atOrg.id)).statusCode).toBe(403);
    expect((await tenantRevoke(plainMember, mine.id)).statusCode).toBe(403);
    expect(await statusOf(theirs.id)).toBe('pending');
    expect(await statusOf(atOrg.id)).toBe('pending');
    expect(await statusOf(mine.id)).toBe('pending');

    expect((await tenantRevoke(projectAdmin, mine.id)).statusCode).toBe(204);
    expect(await statusOf(mine.id)).toBe('revoked');
    expect((await tenantRevoke(projectAdmin, mine.id)).statusCode).toBe(409);
    expect((await tenantRevoke(projectAdmin, randomUUID())).statusCode).toBe(404);
    // an org admin may revoke the others, never an owner invitation
    expect((await tenantRevoke(orgAdmin, theirs.id)).statusCode).toBe(204);
    expect((await tenantRevoke(owner, atOrg.id)).statusCode).toBe(204);
  });

  it('refuses an org admin revoking an owner invitation', async () => {
    const ownerInv = (
      await tenantInvite(owner, { email: 'ten-rev4@example.com', roleId: roles.owner, scope: { type: 'org' } })
    ).json<InvitationDto>();
    expect((await tenantRevoke(orgAdmin, ownerInv.id)).statusCode).toBe(403);
    expect(await statusOf(ownerInv.id)).toBe('pending');
    expect((await tenantRevoke(owner, ownerInv.id)).statusCode).toBe(204);
  });

  it('writes tenant audit entries with actorKind member and the actor as actor_user_id', async () => {
    const inv = (
      await tenantInvite(projectAdmin, {
        email: 'ten-aud@example.com',
        roleId: roles.member,
        scope: { type: 'project', projectIds: [p1] },
      })
    ).json<InvitationDto>();
    expect((await tenantRevoke(projectAdmin, inv.id)).statusCode).toBe(204);
    const actorId = await userIdOf(t, 'ten-a');
    const rows = await asOrg(orgId, 'select action, actor_user_id, payload from audit_log where target_id = $1', [
      inv.id,
    ]);
    const byAction = Object.fromEntries(rows.rows.map((r) => [r.action as string, r]));
    for (const action of ['invitation.created', 'invitation.revoked']) {
      expect(byAction[action]?.actor_user_id).toBe(actorId);
      expect(byAction[action]?.payload).toMatchObject({ actorKind: 'member', email: 'ten-aud@example.com' });
    }
  });
});

async function devLogin(handle: string) {
  return t.app.inject({ method: 'GET', url: `/auth/dev-login?handle=${encodeURIComponent(handle)}` });
}

async function userRowCount(email: string): Promise<number> {
  const res = await t.db.pool.query('select count(*)::int as n from "user" where email = $1', [email]);
  return res.rows[0]?.n;
}

describe('sign-up needs an invitation (BR-54)', () => {
  it('refuses an uninvited handle, creates no user, and refuses a second try too', async () => {
    const first = await devLogin('gate-nobody');
    expect(first.statusCode).toBe(401);
    expect(first.headers['set-cookie']).toBeUndefined();
    expect(await userRowCount('gate-nobody@dev.local')).toBe(0);
    const second = await devLogin('gate-nobody');
    expect(second.statusCode).toBe(401);
    expect(await userRowCount('gate-nobody@dev.local')).toBe(0);
    const accounts = await t.db.pool.query("select count(*)::int as n from account where account_id = 'gate-nobody'");
    expect(accounts.rows[0]?.n).toBe(0);
  });

  it('creates no personal org for an invited first sign-in', async () => {
    const f = await fixture('gate-invited');
    const before = (await t.db.pool.query('select count(*)::int as n from organization')).rows[0]?.n;
    await inviteAndLogin(t, f.orgId, 'gate-in', 'viewer', { type: 'org' });
    const after = (await t.db.pool.query('select count(*)::int as n from organization')).rows[0]?.n;
    expect(after).toBe(before);
    expect(await membershipCount(await userIdOf(t, 'gate-in'))).toBe(1);
  });

  it('refuses an invited address whose email is not verified, creating no user', async () => {
    const f = await fixture('gate-unverified');
    await invite(f.orgId, { email: 'gate-unv@example.com', roleId: f.roles.viewer, scope: { type: 'org' } });
    // The sign-up path without dev-login: the email stays unverified, so the invitation proves nothing.
    await expect(
      t.app
        .get(AUTH)
        .api.signUpEmail({ body: { email: 'gate-unv@example.com', password: 'a-long-password-1', name: 'unv' } }),
    ).rejects.toThrow();
    expect(await userRowCount('gate-unv@example.com')).toBe(0);
    const stored = await asOrg(f.orgId, "select status from invitations where email = 'gate-unv@example.com'");
    expect(stored.rows[0]?.status).toBe('pending');
  });

  it('refuses the configured platform admin address when it is not verified', async () => {
    const strict = await createTestApp({ env: { PLATFORM_ADMIN_EMAILS: 'gate-pa@example.com' } });
    try {
      await expect(
        strict.app
          .get(AUTH)
          .api.signUpEmail({ body: { email: 'gate-pa@example.com', password: 'a-long-password-1', name: 'pa' } }),
      ).rejects.toThrow();
      const rows = await strict.db.pool.query('select 1 from "user" where email = $1', ['gate-pa@example.com']);
      expect(rows.rows).toHaveLength(0);
    } finally {
      await strict.close();
    }
  });

  it('accepts a platform admin address whatever its case, in the config or at sign-in', async () => {
    const mixed = await createTestApp({ env: { PLATFORM_ADMIN_EMAILS: 'Gate-Mixed@Example.COM' } });
    try {
      await devSignUp.run(true, () =>
        mixed.app
          .get(AUTH)
          .api.signUpEmail({ body: { email: 'GATE-mixed@example.com', password: 'a-long-password-1', name: 'mx' } }),
      );
      const rows = await mixed.db.pool.query('select 1 from "user" where lower(email) = $1', [
        'gate-mixed@example.com',
      ]);
      expect(rows.rows).toHaveLength(1);
    } finally {
      await mixed.close();
    }
  });

  it('refuses when the invitation lookup fails, creating no user (fails closed)', async () => {
    const f = await fixture('gate-lookup');
    await invite(f.orgId, { email: 'gate-lookup@dev.local', roleId: f.roles.viewer, scope: { type: 'org' } });
    const realQuery = t.db.pool.query.bind(t.db.pool) as (...a: unknown[]) => Promise<unknown>;
    const spy = vi
      .spyOn(t.db.pool, 'query')
      .mockImplementation(((...args: unknown[]) =>
        typeof args[0] === 'string' && args[0].includes('pending_invitations_for_email')
          ? Promise.reject(new Error('lookup down'))
          : realQuery(...args)) as never);
    try {
      expect((await devLogin('gate-lookup')).statusCode).toBe(401);
    } finally {
      spy.mockRestore();
    }
    expect(await userRowCount('gate-lookup@dev.local')).toBe(0);
    // With the lookup back, the same invited handle signs in: the refusal came from the failed lookup alone.
    expect((await devLogin('gate-lookup')).statusCode).toBe(302);
  });
});
