import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PlatformOrgDetailDto, RoleDto } from '@agentdesk/contracts';
import { auditLog, connections, organization, platformAuditLog, projects, withOrg } from '@agentdesk/db';
import { FORBIDDEN_DETAIL } from '../src/access/authorize';
import { createTestApp, type TestApp } from './helpers/app';
import {
  asPlatformAdmin,
  createOrg,
  inviteAndLogin,
  loginAs,
  reactivateOrgRoute,
  suspendOrgRoute,
  suspendedOrgApp,
  userIdOf,
} from './helpers/auth';
import { expectContract } from './helpers/contract';

const NOW = new Date('2031-05-06T07:08:09.000Z');
let t: TestApp;
let admin: string;

beforeAll(async () => {
  t = await createTestApp({ clock: { now: () => NOW } });
  admin = await asPlatformAdmin(t);
});
afterAll(async () => {
  await t.close();
});

/** Suspend and reactivate platform rows only: creating the org writes an `org.created` row (BR-44). */
async function platformRows(orgId: string, actions = ['org.suspended', 'org.reactivated']) {
  const all = await t.db.orm.select().from(platformAuditLog).where(eq(platformAuditLog.targetOrgId, orgId));
  const rows = all.filter((r) => actions.includes(r.action));
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

async function tenantRows(orgId: string, actions = ['org.suspended', 'org.reactivated']) {
  const rows = await withOrg(t.db, orgId, (tx) => tx.select().from(auditLog));
  return rows.filter((r) => actions.includes(r.action));
}

async function statusOf(orgId: string): Promise<string | undefined> {
  const [row] = await t.db.orm
    .select({ status: organization.status })
    .from(organization)
    .where(eq(organization.id, orgId));
  return row?.status;
}

async function detail(orgId: string): Promise<PlatformOrgDetailDto> {
  const res = await t.app.inject({ method: 'GET', url: `/api/platform/orgs/${orgId}`, headers: { cookie: admin } });
  expect(res.statusCode, res.body).toBe(200);
  return expectContract('platform.getOrg', res) as PlatformOrgDetailDto;
}

/** A signed-in user with no membership: invited (so dev-login may sign them up) but never accepted. */
async function signedInWithoutOrg(handle: string, orgId: string): Promise<string> {
  const roles = (
    await t.app.inject({ method: 'GET', url: `/api/platform/orgs/${orgId}/roles`, headers: { cookie: admin } })
  ).json<RoleDto[]>();
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

describe('suspend and reactivate (BR-32, BR-34)', () => {
  it('suspends with the injected clock and the reason, then reactivates, with one row of each audit table per change', async () => {
    const org = await createOrg(t, 'Susp One', 'susp-one');
    const adminId = await userIdOf(t, 'admin');
    const res = await suspendOrgRoute(t, admin, org.id, { reason: '  Unpaid invoice  ' });
    expect(res.statusCode, res.body).toBe(200);
    const body = expectContract('platform.suspendOrg', res) as PlatformOrgDetailDto;
    expect(body.status).toBe('suspended');
    expect(body.suspendedAt).toBe(NOW.toISOString());
    expect(body.suspension).toEqual({
      at: NOW.toISOString(),
      reason: 'Unpaid invoice',
      by: { userId: adminId, name: expect.any(String), handle: 'admin' },
    });
    expect(await detail(org.id)).toEqual(body);

    const [suspendedRow] = await platformRows(org.id);
    expect(suspendedRow).toMatchObject({
      actorUserId: adminId,
      action: 'org.suspended',
      targetType: 'org',
      targetId: org.id,
      targetOrgId: org.id,
    });
    expect(suspendedRow?.payload).toMatchObject({ from: 'active', to: 'suspended', reason: 'Unpaid invoice' });
    const tenant = await tenantRows(org.id);
    expect(tenant).toHaveLength(1);
    expect(tenant[0]).toMatchObject({ action: 'org.suspended', actorUserId: adminId, targetType: 'org' });
    expect(tenant[0]?.payload).toEqual({ from: 'active', to: 'suspended', actorKind: 'platform_admin' });
    expect(JSON.stringify(tenant[0])).not.toContain('Unpaid invoice');

    const re = await reactivateOrgRoute(t, admin, org.id, { reason: 'Paid' });
    expect(re.statusCode, re.body).toBe(200);
    const after = expectContract('platform.reactivateOrg', re) as PlatformOrgDetailDto;
    expect(after.status).toBe('active');
    expect(after.suspendedAt).toBeNull();
    expect(after.suspension).toBeNull();
    expect(await detail(org.id)).toEqual(after);
    const rows = await platformRows(org.id);
    expect(rows.map((r) => r.action)).toEqual(['org.suspended', 'org.reactivated']);
    expect(rows[1]?.payload).toMatchObject({ from: 'suspended', to: 'active', reason: 'Paid' });
    const tenantAfter = await tenantRows(org.id);
    expect(tenantAfter.map((r) => r.action).sort()).toEqual(['org.reactivated', 'org.suspended']);
    expect(JSON.stringify(tenantAfter)).not.toContain('Paid');
  });

  it('stores a secret-looking reason redacted', async () => {
    const org = await createOrg(t, 'Susp Secret', 'susp-secret');
    const secret = `ghp_${'a'.repeat(36)}`;
    expect((await suspendOrgRoute(t, admin, org.id, { reason: `token ${secret} leaked` })).statusCode).toBe(200);
    const [row] = await platformRows(org.id);
    expect(JSON.stringify(row?.payload)).not.toContain(secret);
  });

  it('suspends with a reason of exactly 500 characters and stores it whole (BR-33)', async () => {
    const org = await createOrg(t, 'Susp Max', 'susp-max');
    const reason = 'r'.repeat(500);
    expect((await suspendOrgRoute(t, admin, org.id, { reason })).statusCode).toBe(200);
    expect(await statusOf(org.id)).toBe('suspended');
    const [row] = await platformRows(org.id);
    expect(row?.payload).toMatchObject({ reason });
    expect((await detail(org.id)).suspension?.reason).toBe(reason);
  });

  it('a suspended org shows the latest reason after a second suspension', async () => {
    const org = await createOrg(t, 'Susp Twice', 'susp-twice');
    await suspendedOrgApp(t, org.id, 'first reason');
    expect((await reactivateOrgRoute(t, admin, org.id, { reason: 'back' })).statusCode).toBe(200);
    await suspendedOrgApp(t, org.id, 'second reason');
    expect((await detail(org.id)).suspension?.reason).toBe('second reason');
  });
});

describe('request body (BR-33)', () => {
  it.each([
    ['empty', { reason: '' }],
    ['spaces only', { reason: '   ' }],
    ['501 characters', { reason: 'x'.repeat(501) }],
    ['an extra key', { reason: 'ok', extra: 1 }],
    ['a missing reason', {}],
  ])('rejects %s with 400 at /reason and changes nothing', async (_name, payload) => {
    const org = await createOrg(t, `Body ${_name}`, `body-${_name.replace(/\W/g, '-')}`);
    for (const route of [suspendOrgRoute, reactivateOrgRoute]) {
      const res = await route(t, admin, org.id, payload);
      expect(res.statusCode, res.body).toBe(400);
      // an unknown key is reported on the object itself (empty pointer), the other cases on /reason
      if (_name !== 'an extra key') expect(res.body).toContain('/reason');
    }
    expect(await statusOf(org.id)).toBe('active');
    expect(await platformRows(org.id)).toHaveLength(0);
    expect(await tenantRows(org.id)).toHaveLength(0);
  });
});

describe('repeats and races (BR-35)', () => {
  it('a repeat is 200, changes nothing and writes no row', async () => {
    const org = await createOrg(t, 'Repeat', 'repeat-org');
    const re0 = await reactivateOrgRoute(t, admin, org.id, { reason: 'already active' });
    expect(re0.statusCode).toBe(200);
    expect(await platformRows(org.id)).toHaveLength(0);
    await suspendedOrgApp(t, org.id, 'first');
    const again = await suspendOrgRoute(t, admin, org.id, { reason: 'second' });
    expect(again.statusCode).toBe(200);
    expect((again.json() as PlatformOrgDetailDto).suspension?.reason).toBe('first');
    expect(await platformRows(org.id)).toHaveLength(1);
    expect(await tenantRows(org.id)).toHaveLength(1);
  });

  it('two concurrent suspends give one change and one row each', async () => {
    const org = await createOrg(t, 'Race Two', 'race-two');
    const res = await Promise.all([
      suspendOrgRoute(t, admin, org.id, { reason: 'a' }),
      suspendOrgRoute(t, admin, org.id, { reason: 'b' }),
    ]);
    expect(res.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(await platformRows(org.id)).toHaveLength(1);
    expect(await tenantRows(org.id)).toHaveLength(1);
    expect(await statusOf(org.id)).toBe('suspended');
  });

  it('suspend racing reactivate leaves audit rows equal to the real changes', async () => {
    const org = await createOrg(t, 'Race Mixed', 'race-mixed');
    const res = await Promise.all([
      suspendOrgRoute(t, admin, org.id, { reason: 'a' }),
      reactivateOrgRoute(t, admin, org.id, { reason: 'b' }),
    ]);
    expect(res.map((r) => r.statusCode)).toEqual([200, 200]);
    const rows = (await platformRows(org.id)).map((r) => r.action).sort();
    const status = await statusOf(org.id);
    // suspend won the lock: both change, ends active; reactivate won: a no-op, then suspend changes, ends suspended (row order is not asserted: created_at is the transaction start, not the lock order)
    const outcome = status === 'active' ? ['org.reactivated', 'org.suspended'] : ['org.suspended'];
    expect(status === 'active' || status === 'suspended').toBe(true);
    expect(rows).toEqual(outcome);
    expect((await tenantRows(org.id)).map((r) => r.action).sort()).toEqual([...outcome].sort());
  });
});

describe('access (BR-36)', () => {
  it('answers 403 before any lookup for every non-platform caller, known or unknown id', async () => {
    const org = await createOrg(t, 'Guard Susp', 'guard-susp');
    const other = await createOrg(t, 'Guard Other', 'guard-other');
    const p1 = await seedProject(org.id, 'GP1');
    const cookies = {
      owner: await inviteAndLogin(t, org.id, 'gs-owner', 'owner', { type: 'org' }),
      admin: await inviteAndLogin(t, org.id, 'gs-admin', 'admin', { type: 'org' }),
      projectAdmin: await inviteAndLogin(t, org.id, 'gs-padmin', 'admin', { type: 'project', projectIds: [p1] }),
      member: await inviteAndLogin(t, org.id, 'gs-member', 'member', { type: 'org' }),
      viewer: await inviteAndLogin(t, org.id, 'gs-viewer', 'viewer', { type: 'org' }),
      otherOrgOwner: await inviteAndLogin(t, other.id, 'gs-other-o', 'owner', { type: 'org' }),
      noOrg: await signedInWithoutOrg('gs-nobody', org.id),
    };
    for (const [who, cookie] of Object.entries(cookies)) {
      for (const route of [suspendOrgRoute, reactivateOrgRoute]) {
        const known = await route(t, cookie, org.id, { reason: 'nope' });
        const unknown = await route(t, cookie, randomUUID(), { reason: 'nope' });
        expect(known.statusCode, who).toBe(403);
        expect(unknown.statusCode, who).toBe(403);
        expect((known.json() as { detail: string }).detail, who).toBe(FORBIDDEN_DETAIL);
        expect(known.body, who).not.toContain('Guard Susp');
      }
    }
    expect(await statusOf(org.id)).toBe('active');
    expect(await statusOf(other.id)).toBe('active');
    expect(await platformRows(org.id)).toHaveLength(0);
    expect(await tenantRows(org.id)).toHaveLength(0);
  });

  it('answers 401 signed out', async () => {
    const org = await createOrg(t, 'Anon Susp', 'anon-susp');
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/platform/orgs/${org.id}/suspend`,
      payload: { reason: 'x' },
    });
    expect(res.statusCode).toBe(401);
    expect(await statusOf(org.id)).toBe('active');
  });

  it('answers 404 for an unknown and a malformed id to the platform admin', async () => {
    for (const id of [randomUUID(), 'not-a-uuid']) {
      expect((await suspendOrgRoute(t, admin, id, { reason: 'x' })).statusCode, id).toBe(404);
      expect((await reactivateOrgRoute(t, admin, id, { reason: 'x' })).statusCode, id).toBe(404);
    }
  });

  it('suspending one org leaves another org untouched', async () => {
    const a = await createOrg(t, 'Iso A', 'iso-a');
    const b = await createOrg(t, 'Iso B', 'iso-b');
    await suspendedOrgApp(t, a.id);
    expect(await statusOf(b.id)).toBe('active');
    expect(await platformRows(b.id)).toHaveLength(0);
    expect(await tenantRows(b.id)).toHaveLength(0);
  });
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
