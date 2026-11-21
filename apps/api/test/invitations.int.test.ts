import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InvitationDto, Page, RoleDto } from '@agentdesk/contracts';
import { connections, projects, withOrg } from '@agentdesk/db';
import { createTestApp, type TestApp } from './helpers/app';
import { asPlatformAdmin, createOrg, loginAs } from './helpers/auth';
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
    await loginAs(t, 'existing-member');
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
    const other = await loginAs(t, 'not-an-admin');
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
