import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNABLE_PERMISSIONS, Permission, isPlatformPermission, routeAccess } from '@agentdesk/contracts';
import { startPg, type TestPg } from '@agentdesk/db/testing';

interface Line {
  key: string;
  permission: string;
  condition: string;
}

const ADMIN_PERMISSIONS = [
  'project:create',
  'project:read',
  'project:update',
  'project:delete',
  'connection:create',
  'connection:read',
  'agent:read',
  'agent:update',
  'secret:update',
  'skill:read',
  'skill:update',
  'skill:delete',
  'rule:create',
  'rule:read',
  'rule:update',
  'rule:delete',
  'setup:read',
  'setup:update',
  'setup:test',
  'run:read',
  'run:create',
  'run:update',
  'run:cancel',
  'terminal:attach',
  'member:read',
  'member:create',
  'member:update',
  'member:delete',
  'assignment:read',
  'assignment:create',
  'assignment:delete',
  'org:update',
];
const MEMBER_ANY = [
  'project:read',
  'agent:read',
  'skill:read',
  'rule:read',
  'setup:read',
  'run:read',
  'run:create',
] as const;
const VIEWER = ['project:read', 'agent:read', 'skill:read', 'rule:read', 'setup:read', 'run:read'] as const;

const any = (permissions: readonly string[]) => permissions.map((p) => `${p}=any`);
const EXPECTED: Record<string, string[]> = {
  owner: any([...ADMIN_PERMISSIONS, 'org:delete']),
  admin: any(ADMIN_PERMISSIONS),
  member: [...any(MEMBER_ANY), ...OWNABLE_PERMISSIONS.map((p) => `${p}=own`)],
  viewer: any(VIEWER),
};

let pgServer: TestPg;
let admin: pg.Pool;
let lines: Line[];

beforeAll(async () => {
  pgServer = await startPg();
  const u = new URL(pgServer.adminUrl);
  u.pathname = '/agentdesk';
  admin = new pg.Pool({ connectionString: u.toString() });
  const res = await admin.query<Line>(
    `select t.key, p.permission, p.condition from role_templates t
     join role_template_permissions p on p.template_id = t.id order by t.key, p.permission`,
  );
  lines = res.rows;
}, 180_000);
afterAll(async () => {
  await admin?.end();
  await pgServer?.stop();
});

function linesOf(key: string): string[] {
  return lines.filter((l) => l.key === key).map((l) => `${l.permission}=${l.condition}`);
}

describe('seeded role templates', () => {
  it('every template line is a tenant permission name the contracts parse', () => {
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(Permission.safeParse(l.permission).success, l.permission).toBe(true);
      expect(isPlatformPermission(l.permission), l.permission).toBe(false);
    }
  });

  it('own appears only on ownable permissions', () => {
    const own = lines.filter((l) => l.condition === 'own');
    expect(own.length).toBeGreaterThan(0);
    for (const l of own) expect(OWNABLE_PERMISSIONS as readonly string[]).toContain(l.permission);
  });

  it('every tenant permission a route needs is granted by at least one template', () => {
    const granted = new Set(lines.map((l) => l.permission));
    const needed = Object.values(routeAccess).flatMap((a) => {
      if (a.scope === 'self' || a.scope === 'platform' || a.scope === 'user') return [];
      return a.scope === 'org-admin' ? [...a.anyOf] : [a.permission];
    });
    expect(needed.length).toBeGreaterThan(0);
    for (const p of needed) expect(granted.has(p), p).toBe(true);
  });

  it('the template matrix is the expected one', () => {
    expect(Object.keys(EXPECTED).map((k) => EXPECTED[k]?.length)).toEqual([33, 32, 10, 6]);
    expect([...new Set(lines.map((l) => l.key))].sort()).toEqual(['admin', 'member', 'owner', 'viewer']);
    for (const [key, expected] of Object.entries(EXPECTED)) {
      expect(linesOf(key).sort(), key).toEqual([...expected].sort());
    }
  });

  it('assignable scopes: owner org only, the others org and project', async () => {
    const res = await admin.query<{ key: string; assignable_scopes: string[] }>(
      'select key, assignable_scopes from role_templates order by key',
    );
    expect(res.rows).toEqual([
      { key: 'admin', assignable_scopes: ['org', 'project'] },
      { key: 'member', assignable_scopes: ['org', 'project'] },
      { key: 'owner', assignable_scopes: ['org'] },
      { key: 'viewer', assignable_scopes: ['org', 'project'] },
    ]);
  });
});
