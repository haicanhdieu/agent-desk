import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page, PlatformOrgDetailDto, PlatformOrgDto } from '@agentdesk/contracts';
import { auditLog, connections, organization, platformAuditLog, projects, withOrg } from '@agentdesk/db';
import { FORBIDDEN_DETAIL } from '../src/access/authorize';
import { createTestApp, type TestApp } from './helpers/app';
import {
  asPlatformAdmin,
  auditList,
  createOrg,
  inviteAndLogin,
  loginAs,
  suspendedOrgApp,
  userIdOf,
} from './helpers/auth';
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

function editRoute(cookie: string | undefined, orgId: string, body: Record<string, unknown>, extra = {}) {
  return t.app.inject({
    method: 'PATCH',
    url: `/api/platform/orgs/${orgId}`,
    headers: { ...(cookie === undefined ? {} : { cookie }), ...extra },
    payload: body,
  });
}

async function platformRows(orgId: string) {
  const rows = await t.db.orm.select().from(platformAuditLog).where(eq(platformAuditLog.targetOrgId, orgId));
  return rows.filter((r) => r.action === 'org.updated');
}

async function tenantRows(orgId: string) {
  const rows = await withOrg(t.db, orgId, (tx) => tx.select().from(auditLog));
  return rows.filter((r) => r.action === 'org.updated');
}

async function orgRow(orgId: string) {
  const [row] = await t.db.orm.select().from(organization).where(eq(organization.id, orgId));
  if (!row) throw new Error('org row missing');
  return row;
}

const pointerOf = (res: { json: () => unknown }): string | undefined =>
  (res.json() as { errors?: { pointer: string }[] }).errors?.[0]?.pointer;

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

async function signedInWithoutOrg(handle: string, orgId: string): Promise<string> {
  const roles = (
    await t.app.inject({ method: 'GET', url: `/api/platform/orgs/${orgId}/roles`, headers: { cookie: admin } })
  ).json<{ id: string; key: string }[]>();
  const viewer = roles.find((r) => r.key === 'viewer');
  if (!viewer) throw new Error('no viewer role');
  const res = await t.app.inject({
    method: 'POST',
    url: `/api/platform/orgs/${orgId}/invitations`,
    headers: { cookie: admin },
    payload: { email: `${handle}@dev.local`, roleId: viewer.id, scope: { type: 'org' } },
  });
  if (res.statusCode !== 201) throw new Error(`invite ${handle} answered ${res.statusCode}`);
  return loginAs(t, handle);
}

describe('access (BR-52)', () => {
  it('answers 403 before any lookup for every non-platform caller, known or unknown id, and writes nothing', async () => {
    const org = await createOrg(t, 'Edit Guard', 'edit-guard');
    const other = await createOrg(t, 'Edit Guard Other', 'edit-guard-other');
    const p1 = await seedProject(org.id, 'EG1');
    const cookies = {
      owner: await inviteAndLogin(t, org.id, 'eg-owner', 'owner', { type: 'org' }),
      admin: await inviteAndLogin(t, org.id, 'eg-admin', 'admin', { type: 'org' }),
      projectAdmin: await inviteAndLogin(t, org.id, 'eg-padmin', 'admin', { type: 'project', projectIds: [p1] }),
      member: await inviteAndLogin(t, org.id, 'eg-member', 'member', { type: 'org' }),
      viewer: await inviteAndLogin(t, org.id, 'eg-viewer', 'viewer', { type: 'org' }),
      otherOrgOwner: await inviteAndLogin(t, other.id, 'eg-other-o', 'owner', { type: 'org' }),
      noOrg: await signedInWithoutOrg('eg-nobody', org.id),
    };
    for (const [who, cookie] of Object.entries(cookies)) {
      const known = await editRoute(cookie, org.id, { name: 'Hacked' });
      const unknown = await editRoute(cookie, randomUUID(), { name: 'Hacked' });
      expect(known.statusCode, who).toBe(403);
      expect(unknown.statusCode, who).toBe(403);
      expect((known.json() as { detail: string }).detail, who).toBe(FORBIDDEN_DETAIL);
      expect(known.body, who).not.toContain('Edit Guard');
    }
    // the owner's X-Org header does not make the route theirs
    const withHeader = await editRoute(cookies.owner, org.id, { name: 'Hacked' }, { 'x-org-id': org.id });
    expect(withHeader.statusCode).toBe(403);
    expect((await orgRow(org.id)).name).toBe('Edit Guard');
    expect((await orgRow(other.id)).name).toBe('Edit Guard Other');
    expect(await platformRows(org.id)).toHaveLength(0);
    expect(await tenantRows(org.id)).toHaveLength(0);
  });

  it('answers 401 signed out', async () => {
    const org = await createOrg(t, 'Edit Anon', 'edit-anon');
    const res = await editRoute(undefined, org.id, { name: 'X' });
    expect(res.statusCode).toBe(401);
    expect((await orgRow(org.id)).name).toBe('Edit Anon');
  });

  it('answers 404 for an unknown and a malformed id to the platform admin', async () => {
    for (const id of [randomUUID(), 'not-a-uuid']) {
      expect((await editRoute(admin, id, { name: 'X' })).statusCode, id).toBe(404);
    }
  });

  it('ignores a body orgId or actorKind: the path decides the org and the session the actor', async () => {
    const org = await createOrg(t, 'Edit Body', 'edit-body');
    const other = await createOrg(t, 'Edit Body Other', 'edit-body-other');
    const res = await editRoute(admin, org.id, { name: 'Edit Body 2', orgId: other.id, actorKind: 'member' });
    expect(res.statusCode, res.body).toBe(200);
    expect((await orgRow(org.id)).name).toBe('Edit Body 2');
    expect((await orgRow(other.id)).name).toBe('Edit Body Other');
    expect((await tenantRows(org.id))[0]?.payload).toMatchObject({ actorKind: 'platform_admin' });
    expect(await tenantRows(other.id)).toHaveLength(0);
  });
});

describe('edit (BR-53)', () => {
  it('answers 200 with the detail, leaves a second org alone and shows in platform.listOrgs', async () => {
    const org = await createOrg(t, 'Edit One', 'edit-one');
    const other = await createOrg(t, 'Edit Two', 'edit-two');
    const res = await editRoute(admin, org.id, { name: 'Edit One Renamed', slug: 'edit-one-renamed' });
    expect(res.statusCode, res.body).toBe(200);
    const body = expectContract('platform.updateOrg', res) as PlatformOrgDetailDto;
    expect(body).toMatchObject({ id: org.id, name: 'Edit One Renamed', slug: 'edit-one-renamed' });
    expect(await orgRow(other.id)).toMatchObject({ name: 'Edit Two', slug: 'edit-two' });
    const list = await t.app.inject({
      method: 'GET',
      url: '/api/platform/orgs?q=edit-one-renamed',
      headers: { cookie: admin },
    });
    const page = expectContract('platform.listOrgs', list) as Page<PlatformOrgDto>;
    expect(page.items.map((o) => [o.id, o.name, o.slug])).toEqual([[org.id, 'Edit One Renamed', 'edit-one-renamed']]);
  });

  it('stores a name with markup or SQL text as typed', async () => {
    const org = await createOrg(t, 'Edit Markup', 'edit-markup');
    const name = `<b>x</b>'; drop table organization; --`;
    const res = await editRoute(admin, org.id, { name });
    expect(res.statusCode, res.body).toBe(200);
    expect((await orgRow(org.id)).name).toBe(name);
    expect((res.json() as PlatformOrgDetailDto).name).toBe(name);
  });
});

describe('validation (BR-54, BR-55)', () => {
  it.each([
    ['empty name', { name: '' }, '/name'],
    ['overlong name', { name: 'n'.repeat(101) }, '/name'],
    ['uppercase slug', { slug: 'Bad_Slug' }, '/slug'],
    ['slug with a space', { slug: 'a b' }, '/slug'],
  ])('rejects %s with 400 and writes nothing', async (label, payload, pointer) => {
    const org = await createOrg(t, `Edit Val ${label}`, `edit-val-${label.replace(/\W/g, '-')}`);
    const res = await editRoute(admin, org.id, payload);
    expect(res.statusCode, res.body).toBe(400);
    expect(pointerOf(res)).toBe(pointer);
    expect((await orgRow(org.id)).name).toBe(`Edit Val ${label}`);
    expect(await platformRows(org.id)).toHaveLength(0);
    expect(await tenantRows(org.id)).toHaveLength(0);
  });

  it('rejects an empty body with 400', async () => {
    const org = await createOrg(t, 'Edit Empty', 'edit-empty');
    expect((await editRoute(admin, org.id, {})).statusCode).toBe(400);
    expect(await platformRows(org.id)).toHaveLength(0);
  });
});

describe('slug taken (BR-56)', () => {
  it('answers 409 at /slug and leaves the org and audit unchanged', async () => {
    const org = await createOrg(t, 'Edit Taken', 'edit-taken');
    await createOrg(t, 'Edit Holder', 'edit-holder');
    const res = await editRoute(admin, org.id, { name: 'Changed', slug: 'edit-holder' });
    expect(res.statusCode, res.body).toBe(409);
    expect(pointerOf(res)).toBe('/slug');
    expect(await orgRow(org.id)).toMatchObject({ name: 'Edit Taken', slug: 'edit-taken' });
    expect(await platformRows(org.id)).toHaveLength(0);
    expect(await tenantRows(org.id)).toHaveLength(0);
  });

  it('two edits racing for one slug give one 200 and one 409', async () => {
    const a = await createOrg(t, 'Edit Race A', 'edit-race-a');
    const b = await createOrg(t, 'Edit Race B', 'edit-race-b');
    const res = await Promise.all([
      editRoute(admin, a.id, { slug: 'edit-race-win' }),
      editRoute(admin, b.id, { slug: 'edit-race-win' }),
    ]);
    expect(res.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect((await platformRows(a.id)).length + (await platformRows(b.id)).length).toBe(1);
  });
});

describe('after a slug change (BR-58)', () => {
  it("keeps the owner's session working and frees the old slug at once", async () => {
    const org = await createOrg(t, 'Edit Slug', 'edit-slug');
    const owner = await inviteAndLogin(t, org.id, 'es-owner', 'owner', { type: 'org' });
    const res = await editRoute(admin, org.id, { slug: 'edit-slug-new' });
    expect(res.statusCode, res.body).toBe(200);
    const me = await t.app.inject({ method: 'GET', url: '/api/me/access', headers: { cookie: owner } });
    expect(me.statusCode).toBe(200);
    const byId = await t.app.inject({
      method: 'GET',
      url: `/api/orgs/${org.id}/roles`,
      headers: { cookie: owner, 'x-org-id': org.id },
    });
    expect(byId.statusCode, byId.body).toBe(200);
    const reuse = await t.app.inject({
      method: 'POST',
      url: '/api/platform/orgs',
      headers: { cookie: admin },
      payload: { name: 'Takes The Old Slug', slug: 'edit-slug' },
    });
    expect(reuse.statusCode, reuse.body).toBe(201);
  });
});

describe('no-op and partial change (BR-59)', () => {
  it('equal values answer 200 and write no row in either audit table', async () => {
    const org = await createOrg(t, 'Edit Noop', 'edit-noop');
    const res = await editRoute(admin, org.id, { name: 'Edit Noop', slug: 'edit-noop' });
    expect(res.statusCode, res.body).toBe(200);
    expect(await platformRows(org.id)).toHaveLength(0);
    expect(await tenantRows(org.id)).toHaveLength(0);
  });

  it('a name-only change audits only name', async () => {
    const org = await createOrg(t, 'Edit Half', 'edit-half');
    const res = await editRoute(admin, org.id, { name: 'Edit Half 2', slug: 'edit-half' });
    expect(res.statusCode, res.body).toBe(200);
    const [row] = await platformRows(org.id);
    expect(row?.payload).toEqual({ from: { name: 'Edit Half' }, to: { name: 'Edit Half 2' } });
    const [tenant] = await tenantRows(org.id);
    expect(tenant?.payload).toMatchObject({ from: { name: 'Edit Half' }, to: { name: 'Edit Half 2' } });
    expect(JSON.stringify(tenant?.payload)).not.toContain('slug');
  });
});

describe('audit rows (BR-60, BR-61)', () => {
  it('writes one platform row and one tenant row the org admins read through audit.list', async () => {
    const org = await createOrg(t, 'Edit Audit', 'edit-audit');
    const orgAdmin = await inviteAndLogin(t, org.id, 'ea-admin', 'admin', { type: 'org' });
    const adminId = await userIdOf(t, 'admin');
    const res = await editRoute(admin, org.id, { name: 'Edit Audit 2', slug: 'edit-audit-2' });
    expect(res.statusCode, res.body).toBe(200);
    const rows = await platformRows(org.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorUserId: adminId,
      action: 'org.updated',
      targetType: 'org',
      targetId: org.id,
      targetOrgId: org.id,
    });
    expect(rows[0]?.payload).toEqual({
      from: { name: 'Edit Audit', slug: 'edit-audit' },
      to: { name: 'Edit Audit 2', slug: 'edit-audit-2' },
    });
    const tenant = await tenantRows(org.id);
    expect(tenant).toHaveLength(1);
    expect(tenant[0]?.payload).toMatchObject({ actorKind: 'platform_admin' });
    const list = await auditList(t, orgAdmin, org.id);
    expect(list.statusCode, list.body).toBe(200);
    expect(list.body).toContain('org.updated');
    expect(list.body).toContain('platform_admin');
  });

  it('rolls the rename back when the platform audit insert is refused', async () => {
    const org = await createOrg(t, 'Edit Atomic', 'edit-atomic');
    const check = `edit_atomic_${org.id.replace(/-/g, '')}`;
    const owner = new pg.Pool({ connectionString: t.pg.ownerUrl, max: 1 });
    try {
      await owner.query(
        `alter table platform_audit_log add constraint ${check} check (target_org_id is distinct from '${org.id}'::uuid or action <> 'org.updated')`,
      );
      try {
        const res = await editRoute(admin, org.id, { name: 'Edit Atomic 2' });
        expect(res.statusCode).toBe(500);
      } finally {
        await owner.query(`alter table platform_audit_log drop constraint ${check}`);
      }
    } finally {
      await owner.end();
    }
    expect((await orgRow(org.id)).name).toBe('Edit Atomic');
    expect(await tenantRows(org.id)).toHaveLength(0);
    expect(await platformRows(org.id)).toHaveLength(0);
  });
});

describe('suspended org (BR-62)', () => {
  it('answers 200 and keeps status and suspended_at', async () => {
    const org = await createOrg(t, 'Edit Susp', 'edit-susp');
    await suspendedOrgApp(t, org.id);
    const before = await orgRow(org.id);
    const res = await editRoute(admin, org.id, { name: 'Edit Susp 2' });
    expect(res.statusCode, res.body).toBe(200);
    const after = await orgRow(org.id);
    expect(after.name).toBe('Edit Susp 2');
    expect(after.status).toBe('suspended');
    expect(after.suspendedAt).toEqual(before.suspendedAt);
    expect((res.json() as PlatformOrgDetailDto).status).toBe('suspended');
  });
});
