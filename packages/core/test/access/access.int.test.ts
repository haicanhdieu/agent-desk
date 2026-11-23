import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  connections,
  createDb,
  projects,
  rolePermissions,
  roleAssignments,
  roles,
  withOrg,
  type Db,
} from '@agentdesk/db';
import { startPg, type TestPg } from '@agentdesk/db/testing';
import { copyRoleTemplates, findLinkedUser, loadAccess } from '../../src';

let pgServer: TestPg;
let db: Db;
let admin: pg.Pool;

beforeAll(async () => {
  pgServer = await startPg();
  db = createDb(pgServer.appUrl);
  const u = new URL(pgServer.adminUrl);
  u.pathname = '/agentdesk';
  admin = new pg.Pool({ connectionString: u.toString() });
}, 180_000);
afterAll(async () => {
  await admin.end();
  await db.close();
  await pgServer.stop();
});

async function makeUser(handle: string): Promise<string> {
  const id = randomUUID();
  await admin.query(`insert into "user" (id, name, email, handle) values ($1, $2, $3, $2)`, [
    id,
    handle,
    `${handle}-${id}@example.test`,
  ]);
  return id;
}

async function makeProject(orgId: string): Promise<string> {
  return withOrg(db, orgId, async (tx) => {
    const [conn] = await tx
      .insert(connections)
      .values({
        orgId,
        provider: 'fake',
        externalId: `fake-${orgId}`,
        accountName: 'acme',
        capabilities: { code: true, board: true },
      })
      .returning({ id: connections.id });
    const [p] = await tx
      .insert(projects)
      .values({
        orgId,
        name: 'app',
        repoPath: `acme/${randomUUID()}`,
        codeConnectionId: conn!.id,
        boardConnectionId: conn!.id,
      })
      .returning({ id: projects.id });
    return p!.id;
  });
}

const linesOf = (rows: { key: string; permission: string; condition: string }[]) =>
  rows.map((r) => `${r.key}:${r.permission}=${r.condition}`).sort();

describe('copyRoleTemplates', () => {
  it('copies the four built-in roles with lines equal to the templates', async () => {
    const orgId = randomUUID();
    await withOrg(db, orgId, (tx) => copyRoleTemplates(tx, orgId));

    const templateRows = await admin.query<{ key: string; permission: string; condition: string }>(
      `select t.key, p.permission, p.condition from role_templates t
       join role_template_permissions p on p.template_id = t.id`,
    );
    const { roleRows, lineRows } = await withOrg(db, orgId, async (tx) => ({
      roleRows: await tx.select().from(roles),
      lineRows: await tx
        .select({ key: roles.key, permission: rolePermissions.permission, condition: rolePermissions.condition })
        .from(rolePermissions)
        .innerJoin(roles, eq(roles.id, rolePermissions.roleId)),
    }));
    expect(roleRows.map((r) => r.key).sort()).toEqual(['admin', 'member', 'owner', 'viewer']);
    expect(roleRows.every((r) => r.builtIn && r.orgId === orgId && r.templateId !== null)).toBe(true);
    expect(linesOf(lineRows)).toEqual(linesOf(templateRows.rows));
  });

  it('gives a new org member and viewer none of the four Desk reads, and admin and owner all four (issue 216)', async () => {
    const orgId = randomUUID();
    await withOrg(db, orgId, (tx) => copyRoleTemplates(tx, orgId));
    const rows = await withOrg(db, orgId, (tx) =>
      tx
        .select({ key: roles.key, permission: rolePermissions.permission })
        .from(rolePermissions)
        .innerJoin(roles, eq(roles.id, rolePermissions.roleId)),
    );
    const of = (key: string) => rows.filter((r) => r.key === key).map((r) => r.permission);
    for (const p of ['agent:read', 'skill:read', 'rule:read', 'setup:read']) {
      expect(of('member'), `member ${p}`).not.toContain(p);
      expect(of('viewer'), `viewer ${p}`).not.toContain(p);
      expect(of('admin'), `admin ${p}`).toContain(p);
      expect(of('owner'), `owner ${p}`).toContain(p);
    }
  });

  it('gives an org created after 0033 audit:read for owner and admin only (NO-4)', async () => {
    const orgId = randomUUID();
    await withOrg(db, orgId, (tx) => copyRoleTemplates(tx, orgId));
    const rows = await withOrg(db, orgId, (tx) =>
      tx
        .select({ key: roles.key, permission: rolePermissions.permission, condition: rolePermissions.condition })
        .from(rolePermissions)
        .innerJoin(roles, eq(roles.id, rolePermissions.roleId)),
    );
    const holders = rows.filter((r) => r.permission === 'audit:read').map((r) => `${r.key}=${r.condition}`);
    expect(holders.sort()).toEqual(['admin=any', 'owner=any']);
  });

  it('adds nothing on a second call', async () => {
    const orgId = randomUUID();
    await withOrg(db, orgId, (tx) => copyRoleTemplates(tx, orgId));
    const before = await withOrg(db, orgId, async (tx) => [
      (await tx.select().from(roles)).length,
      (await tx.select().from(rolePermissions)).length,
    ]);
    await withOrg(db, orgId, (tx) => copyRoleTemplates(tx, orgId));
    const after = await withOrg(db, orgId, async (tx) => [
      (await tx.select().from(roles)).length,
      (await tx.select().from(rolePermissions)).length,
    ]);
    expect(after).toEqual(before);
    expect(before[0]).toBe(4);
  });

  it('throws on a platform permission in a template and writes no role', async () => {
    const orgId = randomUUID();
    const [owner] = (await admin.query<{ id: string }>(`select id from role_templates where key = 'owner'`)).rows;
    await admin.query(
      `insert into role_template_permissions (template_id, permission, condition) values ($1, 'platform-org:read', 'any')`,
      [owner!.id],
    );
    try {
      await expect(withOrg(db, orgId, (tx) => copyRoleTemplates(tx, orgId))).rejects.toThrow(/platform/i);
    } finally {
      await admin.query(`delete from role_template_permissions where permission = 'platform-org:read'`);
    }
    const count = await withOrg(db, orgId, async (tx) => (await tx.select().from(roles)).length);
    expect(count).toBe(0);
  });

  it('refuses an org id other than the one the transaction is scoped to', async () => {
    const scoped = randomUUID();
    await expect(withOrg(db, scoped, (tx) => copyRoleTemplates(tx, randomUUID()))).rejects.toThrow(/not scoped/);
    expect(await withOrg(db, scoped, async (tx) => (await tx.select().from(roles)).length)).toBe(0);
  });
});

describe('loadAccess', () => {
  it('returns the user org and project grants in that org and nothing from another org', async () => {
    const orgA = randomUUID();
    const orgB = randomUUID();
    const alice = await makeUser('alice');
    const projectA = await makeProject(orgA);
    await makeProject(orgB);
    for (const o of [orgA, orgB]) await withOrg(db, o, (tx) => copyRoleTemplates(tx, o));

    const roleIds = async (orgId: string) =>
      withOrg(db, orgId, async (tx) => {
        const rows = await tx.select({ id: roles.id, key: roles.key }).from(roles);
        return Object.fromEntries(rows.map((r) => [r.key, r.id])) as Record<string, string>;
      });
    const a = await roleIds(orgA);
    const b = await roleIds(orgB);
    await withOrg(db, orgA, (tx) =>
      tx.insert(roleAssignments).values([
        { orgId: orgA, userId: alice, roleId: a.viewer!, scopeType: 'org' },
        { orgId: orgA, userId: alice, roleId: a.member!, scopeType: 'project', projectId: projectA },
      ]),
    );
    await withOrg(db, orgB, (tx) =>
      tx.insert(roleAssignments).values({ orgId: orgB, userId: alice, roleId: b.owner!, scopeType: 'org' }),
    );

    const accessA = await withOrg(db, orgA, (tx) => loadAccess(tx, alice));
    expect(accessA.userId).toBe(alice);
    expect(accessA.grants.map((g) => [g.roleKey, g.scope]).sort()).toEqual(
      [
        ['viewer', { type: 'org' }],
        ['member', { type: 'project', projectId: projectA }],
      ].sort(),
    );
    const member = accessA.grants.find((g) => g.roleKey === 'member');
    expect(member?.roleId).toBe(a.member);
    expect(member?.lines).toContainEqual({ permission: 'run:cancel', condition: 'own' });
    expect(member?.lines).toContainEqual({ permission: 'run:create', condition: 'any' });
    expect(accessA.grants.some((g) => g.roleKey === 'owner')).toBe(false);

    const accessB = await withOrg(db, orgB, (tx) => loadAccess(tx, alice));
    expect(accessB.grants.map((g) => g.roleKey)).toEqual(['owner']);
    expect(accessB.grants[0]?.lines).toHaveLength(35);
  });

  it('returns no grants for a user without assignments in the org', async () => {
    const orgId = randomUUID();
    const nobody = await makeUser('nobody');
    await withOrg(db, orgId, (tx) => copyRoleTemplates(tx, orgId));
    expect(await withOrg(db, orgId, (tx) => loadAccess(tx, nobody))).toEqual({ userId: nobody, grants: [] });
  });

  it('skips a stored permission name it does not know and warns', async () => {
    const orgId = randomUUID();
    const carol = await makeUser('carol');
    await withOrg(db, orgId, (tx) => copyRoleTemplates(tx, orgId));
    const warnings: object[] = [];
    const access = await withOrg(db, orgId, async (tx) => {
      const [viewer] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, 'viewer'));
      await tx.insert(rolePermissions).values({ orgId, roleId: viewer!.id, permission: 'project:explode' });
      await tx.insert(roleAssignments).values({ orgId, userId: carol, roleId: viewer!.id, scopeType: 'org' });
      return loadAccess(tx, carol, { warn: (obj) => warnings.push(obj) });
    });
    expect(access.grants[0]?.lines.map((l) => l.permission)).not.toContain('project:explode');
    expect(access.grants[0]?.lines).toHaveLength(2);
    expect(warnings).toEqual([{ permission: 'project:explode' }]);
  });
});

describe('findLinkedUser', () => {
  it('finds the user linked to a provider account and nothing else', async () => {
    const alice = await makeUser('alice2');
    const externalId = `alice-${alice}`;
    await admin.query(
      `insert into account (id, account_id, provider_id, user_id, updated_at) values ($1, $2, 'fake', $3, now())`,
      [randomUUID(), externalId, alice],
    );
    const orgId = randomUUID();
    await withOrg(db, orgId, async (tx) => {
      expect(await findLinkedUser(tx, 'fake', externalId)).toBe(alice);
      expect(await findLinkedUser(tx, 'fake', `bob-${alice}`)).toBeNull();
      expect(await findLinkedUser(tx, 'github', externalId)).toBeNull();
    });
  });

  it('returns null when two users carry the same provider account', async () => {
    const a = await makeUser('amb-a');
    const b = await makeUser('amb-b');
    const externalId = `shared-${a}`;
    for (const u of [a, b]) {
      await admin.query(
        `insert into account (id, account_id, provider_id, user_id, updated_at) values ($1, $2, 'fake', $3, now())`,
        [randomUUID(), externalId, u],
      );
    }
    await withOrg(db, randomUUID(), async (tx) => {
      expect(await findLinkedUser(tx, 'fake', externalId)).toBeNull();
    });
  });

  it('still returns the user when one user has the same provider account twice', async () => {
    const a = await makeUser('dup-a');
    const externalId = `dup-${a}`;
    for (let n = 0; n < 2; n++) {
      await admin.query(
        `insert into account (id, account_id, provider_id, user_id, updated_at) values ($1, $2, 'fake', $3, now())`,
        [randomUUID(), externalId, a],
      );
    }
    await withOrg(db, randomUUID(), async (tx) => {
      expect(await findLinkedUser(tx, 'fake', externalId)).toBe(a);
    });
  });
});
