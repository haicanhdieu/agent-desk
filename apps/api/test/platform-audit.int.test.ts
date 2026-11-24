import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { flattenRoutes, routeAccess, routes, type PlatformAuditAction, type RoleDto } from '@agentdesk/contracts';
import { auditLog, invitations, organization, platformAuditLog, roleAssignments, roles, withOrg } from '@agentdesk/db';
import { createTestApp, type TestApp } from './helpers/app';
import { freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';
import {
  asPlatformAdmin,
  createOrg,
  grant,
  grantPlatformAdmin,
  invite,
  inviteAndLogin,
  userIdOf,
} from './helpers/auth';

let t: TestApp;
let admin: string;
let adminId: string;
let seq = 0;
const next = (): number => (seq += 1);

/** A string a redaction pass must catch: never stored by any platform audit row. */
const SECRET = `ghp_${'a'.repeat(36)}`;

beforeAll(async () => {
  t = await createTestApp({ env: { FAKE_STATE_DIR: freshStateDir() }, wrapAdapters: wideFakeRepos });
  admin = await asPlatformAdmin(t);
  adminId = await userIdOf(t, 'admin');
});
afterAll(async () => {
  await t.close();
});

type Res = Awaited<ReturnType<TestApp['app']['inject']>>;

interface Prepared {
  /** The org the row is about: its id, 'self' when the write creates it (the target id), null for rows that target no org. */
  orgId: string | null | 'self';
  /** The write that must add exactly one row. */
  write: () => Promise<Res>;
  status: number;
  action: PlatformAuditAction;
  targetType: 'platform_admin' | 'org' | 'assignment' | 'invitation';
  targetId: (res: Res) => string;
  payload: Record<string, unknown>;
  /** A write the API refuses with a 4xx. */
  refused?: () => Promise<Res>;
  refusedStatus?: number;
  /** A repeat of `write` that changes nothing and answers 2xx. */
  noop?: () => Promise<Res>;
  noopStatus?: number;
  /** True when the request carries `SECRET` somewhere the payload copies. */
  seeded?: boolean;
}

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

const platformPost = (url: string, payload: Record<string, unknown>): Promise<Res> =>
  t.app.inject({ method: 'POST', url, headers: { cookie: admin }, payload });
const platformDelete = (url: string): Promise<Res> =>
  t.app.inject({ method: 'DELETE', url, headers: { cookie: admin } });
const idOf = (res: Res): string => res.json<{ id: string }>().id;

/** One shared org that holds the users the admin-grant cases need (an account with a verified email). */
let usersOrg: string | undefined;
async function verifiedUser(handle: string): Promise<string> {
  usersOrg ??= (await createOrg(t, 'Pau Users', `pau-users-${next()}`)).id;
  await inviteAndLogin(t, usersOrg, handle, 'viewer', { type: 'org' });
  return `${handle}@dev.local`;
}

/** A fresh org with a viewer member: the starting point of the assignment cases. */
async function orgWithMember(): Promise<{ orgId: string; userId: string }> {
  const n = next();
  const org = await createOrg(t, `Pau Org ${n}`, `pau-org-${n}`);
  await inviteAndLogin(t, org.id, `pau-m${n}`, 'viewer', { type: 'org' });
  return { orgId: org.id, userId: await userIdOf(t, `pau-m${n}`) };
}

/** Every mutating `scope: 'platform'` route key, with how to make it write, be refused and (when it can) repeat. */
const CASES: Record<string, () => Promise<Prepared>> = {
  'platform.createOrg': async () => {
    const n = next();
    const slug = `pau-create-${n}`;
    const body = { name: `Created ${n} ${SECRET}`, slug };
    return {
      orgId: 'self',
      write: () => platformPost('/api/platform/orgs', body),
      status: 201,
      action: 'org.created',
      targetType: 'org',
      targetId: idOf,
      payload: { slug },
      seeded: true,
      refused: () => platformPost('/api/platform/orgs', { name: 'Again', slug }),
      refusedStatus: 409,
    };
  },
  'platform.updateOrg': async () => {
    const n = next();
    const org = await createOrg(t, `Pau Edit ${n}`, `pau-edit-${n}`);
    const patch = (body: Record<string, unknown>) =>
      t.app.inject({ method: 'PATCH', url: `/api/platform/orgs/${org.id}`, headers: { cookie: admin }, payload: body });
    return {
      orgId: org.id,
      write: () => patch({ name: `Renamed ${n} ${SECRET}` }),
      status: 200,
      action: 'org.updated',
      targetType: 'org',
      targetId: () => org.id,
      payload: {},
      seeded: true,
      refused: () => patch({ name: '' }),
      refusedStatus: 400,
      noop: () => patch({ slug: `pau-edit-${n}` }),
      noopStatus: 200,
    };
  },
  'platform.suspendOrg': async () => {
    const n = next();
    const org = await createOrg(t, `Pau Susp ${n}`, `pau-susp-${n}`);
    const suspend = (body: Record<string, unknown>) => platformPost(`/api/platform/orgs/${org.id}/suspend`, body);
    return {
      orgId: org.id,
      write: () => suspend({ reason: `Unpaid ${SECRET}` }),
      status: 200,
      action: 'org.suspended',
      targetType: 'org',
      targetId: () => org.id,
      payload: { from: 'active', to: 'suspended' },
      seeded: true,
      refused: () => suspend({ reason: '   ' }),
      refusedStatus: 400,
      noop: () => suspend({ reason: 'Again' }),
      noopStatus: 200,
    };
  },
  'platform.reactivateOrg': async () => {
    const n = next();
    const org = await createOrg(t, `Pau React ${n}`, `pau-react-${n}`);
    const suspended = await platformPost(`/api/platform/orgs/${org.id}/suspend`, { reason: 'Setup' });
    expect(suspended.statusCode, suspended.body).toBe(200);
    const reactivate = (body: Record<string, unknown>) => platformPost(`/api/platform/orgs/${org.id}/reactivate`, body);
    return {
      orgId: org.id,
      write: () => reactivate({ reason: `Paid ${SECRET}` }),
      status: 200,
      action: 'org.reactivated',
      targetType: 'org',
      targetId: () => org.id,
      payload: { from: 'suspended', to: 'active' },
      seeded: true,
      refused: () => reactivate({}),
      refusedStatus: 400,
      noop: () => reactivate({ reason: 'Again' }),
      noopStatus: 200,
    };
  },
  'platform.createAssignment': async () => {
    const { orgId, userId } = await orgWithMember();
    const adminRole = await roleId(orgId, 'admin');
    const create = (roleIdValue: string) =>
      platformPost(`/api/platform/orgs/${orgId}/assignments`, {
        userId,
        roleId: roleIdValue,
        scope: { type: 'org' },
      });
    return {
      orgId,
      write: () => create(adminRole),
      status: 201,
      action: 'assignment.granted',
      targetType: 'assignment',
      targetId: idOf,
      payload: { userId, roleKey: 'admin', scope: { type: 'org' } },
      refused: () => create(randomUUID()),
      refusedStatus: 422,
      noop: () => create(adminRole),
      noopStatus: 200,
    };
  },
  'platform.removeAssignment': async () => {
    const { orgId, userId } = await orgWithMember();
    const made = await grant(t, orgId, userId, 'admin', { type: 'org' });
    return {
      orgId,
      write: () => platformDelete(`/api/platform/orgs/${orgId}/assignments/${made.id}`),
      status: 204,
      action: 'assignment.revoked',
      targetType: 'assignment',
      targetId: () => made.id,
      payload: { userId, roleKey: 'admin', scope: { type: 'org' } },
      refused: () => platformDelete(`/api/platform/orgs/${orgId}/assignments/${randomUUID()}`),
      refusedStatus: 404,
    };
  },
  'platform.createInvitation': async () => {
    const n = next();
    const org = await createOrg(t, `Pau Inv ${n}`, `pau-inv-${n}`);
    const viewer = await roleId(org.id, 'viewer');
    const email = `pau-inv${n}@dev.local`;
    const create = () =>
      platformPost(`/api/platform/orgs/${org.id}/invitations`, { email, roleId: viewer, scope: { type: 'org' } });
    return {
      orgId: org.id,
      write: create,
      status: 201,
      action: 'invitation.created',
      targetType: 'invitation',
      targetId: idOf,
      payload: { email, roleKey: 'viewer', scope: { type: 'org' } },
      refused: create,
      refusedStatus: 409,
    };
  },
  'platform.resendInvitation': async () => {
    const n = next();
    const org = await createOrg(t, `Pau Resend ${n}`, `pau-resend-${n}`);
    const email = `pau-rs${n}@dev.local`;
    const inv = await invite(t, org.id, email, 'viewer', { type: 'org' });
    return {
      orgId: org.id,
      write: () => platformPost(`/api/platform/orgs/${org.id}/invitations/${inv.id}/resend`, {}),
      status: 200,
      action: 'invitation.resent',
      targetType: 'invitation',
      targetId: () => inv.id,
      payload: { email, roleKey: 'viewer', scope: { type: 'org' } },
      refused: () => platformPost(`/api/platform/orgs/${org.id}/invitations/${randomUUID()}/resend`, {}),
      refusedStatus: 404,
    };
  },
  'platform.removeInvitation': async () => {
    const n = next();
    const org = await createOrg(t, `Pau Revoke ${n}`, `pau-revoke-${n}`);
    const email = `pau-rv${n}@dev.local`;
    const inv = await invite(t, org.id, email, 'viewer', { type: 'org' });
    const remove = () => platformDelete(`/api/platform/orgs/${org.id}/invitations/${inv.id}`);
    return {
      orgId: org.id,
      write: remove,
      status: 204,
      action: 'invitation.revoked',
      targetType: 'invitation',
      targetId: () => inv.id,
      payload: { email, roleKey: 'viewer', scope: { type: 'org' } },
      refused: remove,
      refusedStatus: 409,
    };
  },
  'platform.grantAdmin': async () => {
    const n = next();
    const email = await verifiedUser(`pau-ga${n}`);
    const userId = await userIdOf(t, `pau-ga${n}`);
    const post = (body: Record<string, unknown>) => platformPost('/api/platform/admins', body);
    return {
      orgId: null,
      write: () => post({ email }),
      status: 201,
      action: 'platform_admin.granted',
      targetType: 'platform_admin',
      targetId: idOf,
      payload: { email, userId },
      refused: () => post({ email: `pau-nobody${n}@dev.local` }),
      refusedStatus: 404,
      noop: () => post({ email }),
      noopStatus: 200,
    };
  },
  'platform.revokeAdmin': async () => {
    const n = next();
    const email = await verifiedUser(`pau-ra${n}`);
    const userId = await userIdOf(t, `pau-ra${n}`);
    const granted = await grantPlatformAdmin(t, admin, email);
    expect(granted.statusCode).toBe(201);
    return {
      orgId: null,
      write: () => platformDelete(`/api/platform/admins/${granted.entry.id}`),
      status: 204,
      action: 'platform_admin.revoked',
      targetType: 'platform_admin',
      targetId: () => granted.entry.id,
      payload: { email, userId },
      refused: () => platformDelete(`/api/platform/admins/${randomUUID()}`),
      refusedStatus: 404,
    };
  },
};

type AuditRow = typeof platformAuditLog.$inferSelect;
const allRows = (): Promise<AuditRow[]> =>
  t.db.orm.select().from(platformAuditLog).orderBy(desc(platformAuditLog.createdAt), desc(platformAuditLog.id));
const idsOf = async (): Promise<Set<string>> => new Set((await allRows()).map((r) => r.id));
async function newRows(before: Set<string>): Promise<AuditRow[]> {
  return (await allRows()).filter((r) => !before.has(r.id));
}

describe('platform audit completeness (BR-44)', () => {
  it('has a case for every mutating platform route key, and no case for anything else', () => {
    const mutating = Object.entries(flattenRoutes(routes))
      .filter(
        ([key, def]) => routeAccess[key as keyof typeof routeAccess]?.scope === 'platform' && def.method !== 'GET',
      )
      .map(([key]) => key)
      .sort();
    expect(Object.keys(CASES).sort()).toEqual(mutating);
  });
});

describe.each(Object.keys(CASES))('%s (BR-44)', (key) => {
  const prepare = (): Promise<Prepared> => {
    const make = CASES[key];
    if (!make) throw new Error(`no case for ${key}`);
    return make();
  };

  it('writes exactly one row with the action, target, org, actor from the session and a redacted payload', async () => {
    const p = await prepare();
    const before = await idsOf();
    const res = await p.write();
    expect(res.statusCode, res.body).toBe(p.status);
    const rows = await newRows(before);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({
      actorUserId: adminId,
      action: p.action,
      targetType: p.targetType,
      targetId: p.targetId(res),
    });
    expect(row?.targetOrgId).toBe(p.orgId === 'self' ? p.targetId(res) : p.orgId);
    expect(row?.payload).toMatchObject(p.payload);
    expect(JSON.stringify(row?.payload)).not.toContain('ghp_');
    expect(JSON.stringify(row?.payload)).not.toContain('"token"');
    // the seeded secret was copied into the payload and masked there
    if (p.seeded) expect(JSON.stringify(row?.payload)).toContain('***');
  });

  it('writes no row when the API refuses the request', async () => {
    const p = await prepare();
    if (!p.refused || p.refusedStatus === undefined) return;
    // the refusal of a repeat (a taken slug, a revoked invitation) needs the first write to have happened
    if (['platform.createOrg', 'platform.createInvitation', 'platform.removeInvitation'].includes(key)) {
      const first = await p.write();
      expect(first.statusCode, first.body).toBe(p.status);
    }
    const before = await idsOf();
    const res = await p.refused();
    expect(res.statusCode, res.body).toBe(p.refusedStatus);
    expect(await newRows(before)).toEqual([]);
  });

  it('writes no row for a repeat that changes nothing', async () => {
    const p = await prepare();
    if (!p.noop || p.noopStatus === undefined) return;
    const first = await p.write();
    expect(first.statusCode, first.body).toBe(p.status);
    const before = await idsOf();
    const res = await p.noop();
    expect(res.statusCode, res.body).toBe(p.noopStatus);
    expect(await newRows(before)).toEqual([]);
  });
});

describe('project-scope payloads (BR-44)', () => {
  /** A fresh org with one project (made through the real path by an org owner). */
  async function orgWithProject(): Promise<{ orgId: string; projectId: string }> {
    const n = next();
    const org = await createOrg(t, `Pau Proj ${n}`, `pau-proj-${n}`);
    const owner = await inviteAndLogin(t, org.id, `pau-own${n}`, 'owner', { type: 'org' });
    const { projectId } = await makeProject(t, owner, await installFake(t, owner));
    return { orgId: org.id, projectId };
  }

  it('platform.createInvitation stores the project scope and its project ids in the platform row', async () => {
    const { orgId, projectId } = await orgWithProject();
    const viewer = await roleId(orgId, 'viewer');
    const before = await idsOf();
    const res = await platformPost(`/api/platform/orgs/${orgId}/invitations`, {
      email: `pau-pinv${next()}@dev.local`,
      roleId: viewer,
      scope: { type: 'project', projectIds: [projectId] },
    });
    expect(res.statusCode, res.body).toBe(201);
    const rows = await newRows(before);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'invitation.created', targetOrgId: orgId });
    expect(rows[0]?.payload).toMatchObject({ roleKey: 'viewer', scope: { type: 'project', projectIds: [projectId] } });
  });

  it('platform.createAssignment stores the project scope and its project id in the platform row', async () => {
    const { orgId, projectId } = await orgWithProject();
    const n = next();
    await inviteAndLogin(t, orgId, `pau-pm${n}`, 'viewer', { type: 'org' });
    const userId = await userIdOf(t, `pau-pm${n}`);
    const member = await roleId(orgId, 'member');
    const before = await idsOf();
    const res = await platformPost(`/api/platform/orgs/${orgId}/assignments`, {
      userId,
      roleId: member,
      scope: { type: 'project', projectId },
    });
    expect(res.statusCode, res.body).toBe(201);
    const rows = await newRows(before);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'assignment.granted', targetOrgId: orgId });
    expect(rows[0]?.payload).toMatchObject({ userId, roleKey: 'member', scope: { type: 'project', projectId } });
  });
});

describe('same transaction (BR-44)', () => {
  /** Adds a NOT VALID CHECK (new rows only) for the duration of `run`, then drops it. */
  async function withCheck(expr: string, run: () => Promise<void>): Promise<void> {
    const name = `pau_refuse_${next()}`;
    const owner = new pg.Pool({ connectionString: t.pg.ownerUrl, max: 1 });
    try {
      await owner.query(`alter table platform_audit_log add constraint ${name} check (${expr}) not valid`);
      try {
        await run();
      } finally {
        await owner.query(`alter table platform_audit_log drop constraint ${name}`);
      }
    } finally {
      await owner.end();
    }
  }

  it('leaves no assignment and no tenant row when the platform insert is refused', async () => {
    const { orgId, userId } = await orgWithMember();
    const adminRole = await roleId(orgId, 'admin');
    await withCheck(`target_org_id is distinct from '${orgId}'::uuid or action <> 'assignment.granted'`, async () => {
      const res = await platformPost(`/api/platform/orgs/${orgId}/assignments`, {
        userId,
        roleId: adminRole,
        scope: { type: 'org' },
      });
      expect(res.statusCode).toBe(500);
    });
    const admins = await withOrg(t.db, orgId, (tx) =>
      tx
        .select({ id: roleAssignments.id })
        .from(roleAssignments)
        .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
        .where(eq(roles.key, 'admin')),
    );
    expect(admins).toEqual([]);
    const tenant = await withOrg(t.db, orgId, (tx) => tx.select().from(auditLog));
    expect(
      tenant.filter((r) => r.action === 'assignment.granted' && JSON.stringify(r.payload).includes('"admin"')),
    ).toEqual([]);
  });

  it('leaves no invitation and no tenant row when the platform insert is refused', async () => {
    const n = next();
    const org = await createOrg(t, `Pau Atomic Inv ${n}`, `pau-atomic-inv-${n}`);
    const viewer = await roleId(org.id, 'viewer');
    await withCheck(`target_org_id is distinct from '${org.id}'::uuid or action <> 'invitation.created'`, async () => {
      const res = await platformPost(`/api/platform/orgs/${org.id}/invitations`, {
        email: `pau-atomic${n}@dev.local`,
        roleId: viewer,
        scope: { type: 'org' },
      });
      expect(res.statusCode).toBe(500);
    });
    const rows = await withOrg(t.db, org.id, (tx) => tx.select().from(invitations));
    expect(rows).toEqual([]);
    const tenant = await withOrg(t.db, org.id, (tx) => tx.select().from(auditLog));
    expect(tenant.filter((r) => r.action === 'invitation.created')).toEqual([]);
  });

  it('creates no organization and no tenant row when the platform insert is refused', async () => {
    const slug = `pau-atomic-org-${next()}`;
    await withCheck(`payload->>'slug' is distinct from '${slug}'`, async () => {
      const res = await platformPost('/api/platform/orgs', { name: 'Atomic Org', slug });
      expect(res.statusCode).toBe(500);
    });
    const orgs = await t.db.orm.select({ slug: organization.slug }).from(organization);
    expect(orgs.map((o) => o.slug)).not.toContain(slug);
    // the superuser sees every org's rows, so a row left by the failed create would show here
    const adminUrl = new URL(t.pg.adminUrl);
    adminUrl.pathname = '/agentdesk';
    const superuser = new pg.Pool({ connectionString: adminUrl.toString(), max: 1 });
    try {
      const rows = await superuser.query(
        `select 1 from audit_log where action = 'org.created' and payload->>'slug' = $1`,
        [slug],
      );
      expect(rows.rowCount).toBe(0);
    } finally {
      await superuser.end();
    }
  });
});
