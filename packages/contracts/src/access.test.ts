import { describe, expect, it } from 'vitest';
import {
  PERMISSION_LEVEL,
  Permission,
  can,
  holdsAnywhere,
  inScope,
  isPlatformPermission,
  visibleProjects,
  type Access,
  type Grant,
  type GrantLine,
  type PermissionCondition,
  type Scope,
} from './access';

const line = (permission: Permission, condition: PermissionCondition = 'any'): GrantLine => ({
  permission,
  condition,
});

const TENANT = Permission.options.filter((p) => !p.startsWith('platform-'));
const OWNABLE = ['run:update', 'run:cancel', 'terminal:attach'];
const READS: Permission[] = ['project:read', 'run:read']; // the viewer's reads: no Desk configuration (issue 216)

const OWNER = TENANT.map((p) => line(p));
const ADMIN = TENANT.filter((p) => p !== 'org:delete').map((p) => line(p));
const MEMBER = [...READS.map((p) => line(p)), line('run:create'), ...OWNABLE.map((p) => line(p as Permission, 'own'))];
const VIEWER = READS.map((p) => line(p));
const READ_RUNS_ONLY = [line('run:read')];
const PROJECT_DELETER = [line('project:delete')];

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P1 = uuid(1);
const P2 = uuid(2);
const P3 = uuid(3);
const NEW_PROJECT = uuid(4);
const ME = uuid(5);
const OTHER = uuid(6);

const grant = (roleKey: string, scope: Scope, lines: GrantLine[]): Grant => ({
  roleId: `role-${roleKey}`,
  roleKey,
  scope,
  lines,
});
const org = (key: string, lines: GrantLine[]) => grant(key, { type: 'org' }, lines);
const proj = (key: string, projectId: string, lines: GrantLine[]) => grant(key, { type: 'project', projectId }, lines);
const access = (...grants: Grant[]): Access => ({ userId: ME, grants });

describe('can', () => {
  it.each([
    [
      'union: member on P1 + viewer on P2, run:create on P1',
      [proj('member', P1, MEMBER), proj('viewer', P2, VIEWER)],
      'run:create',
      { projectId: P1 },
      true,
    ],
    [
      'union: run:create on P2',
      [proj('member', P1, MEMBER), proj('viewer', P2, VIEWER)],
      'run:create',
      { projectId: P2 },
      false,
    ],
    [
      'union: run:create on P3',
      [proj('member', P1, MEMBER), proj('viewer', P2, VIEWER)],
      'run:create',
      { projectId: P3 },
      false,
    ],
    ['org viewer reads a new project', [org('viewer', VIEWER)], 'project:read', { projectId: NEW_PROJECT }, true],
    ['project viewer on P1 cannot read P2', [proj('viewer', P1, VIEWER)], 'project:read', { projectId: P2 }, false],
    [
      'org-level permission from a project grant',
      [proj('x', P1, PROJECT_DELETER)],
      'project:delete',
      { projectId: P1 },
      false,
    ],
    ['org-level permission from an org grant', [org('x', PROJECT_DELETER)], 'project:delete', { projectId: P1 }, true],
    ['own: self', [proj('member', P1, MEMBER)], 'run:cancel', { projectId: P1, ownerUserId: ME }, true],
    ['own: other', [proj('member', P1, MEMBER)], 'run:cancel', { projectId: P1, ownerUserId: OTHER }, false],
    ['own: null', [proj('member', P1, MEMBER)], 'run:cancel', { projectId: P1, ownerUserId: null }, false],
    [
      'own: admin any with null owner',
      [proj('admin', P1, ADMIN)],
      'run:cancel',
      { projectId: P1, ownerUserId: null },
      true,
    ],
    ['owner org:delete', [org('owner', OWNER)], 'org:delete', undefined, true],
    ['admin org:delete', [org('admin', ADMIN)], 'org:delete', undefined, false],
    ['admin member:create', [org('admin', ADMIN)], 'member:create', undefined, true],
    ['admin org:update', [org('admin', ADMIN)], 'org:update', undefined, true],
    ['member member:read', [org('member', MEMBER)], 'member:read', undefined, false],
    ['owner audit:read', [org('owner', OWNER)], 'audit:read', undefined, true],
    ['admin audit:read', [org('admin', ADMIN)], 'audit:read', undefined, true],
    ['project admin audit:read', [proj('admin', P1, ADMIN)], 'audit:read', { projectId: P1 }, false],
    ['project admin audit:read without target', [proj('admin', P1, ADMIN)], 'audit:read', undefined, false],
    ['viewer member:read', [org('viewer', VIEWER)], 'member:read', undefined, false],
    ['read-only runs at org', [org('r', READ_RUNS_ONLY)], 'run:read', { projectId: P1 }, true],
    ['owner never holds platform permission', [org('owner', OWNER)], 'platform-org:create', undefined, false],
  ] as [string, Grant[], Permission, { projectId?: string; ownerUserId?: string | null } | undefined, boolean][])(
    '%s',
    (_name, grants, permission, target, expected) => {
      expect(can(access(...grants), permission, target)).toBe(expected);
    },
  );
});

describe('holdsAnywhere', () => {
  it('is false for an org-level permission held only at project scope', () => {
    expect(holdsAnywhere(access(proj('x', P1, PROJECT_DELETER)), 'project:delete')).toBe(false);
  });
  it('is true for an org-level permission held at org scope', () => {
    expect(holdsAnywhere(access(org('x', PROJECT_DELETER)), 'project:delete')).toBe(true);
  });
  it('is true for a project-level permission at project scope', () => {
    expect(holdsAnywhere(access(proj('viewer', P1, VIEWER)), 'run:read')).toBe(true);
  });
  it('counts own-condition lines', () => {
    expect(holdsAnywhere(access(proj('member', P1, MEMBER)), 'run:cancel')).toBe(true);
  });
  it('is false for platform permissions', () => {
    expect(holdsAnywhere(access(org('owner', OWNER)), 'platform-role:read')).toBe(false);
  });
});

describe('visibleProjects', () => {
  it('is all for an org grant', () => {
    expect(visibleProjects(access(org('viewer', VIEWER)), 'project:read')).toBe('all');
  });
  it('is the sorted unique project ids', () => {
    const ids = [P1, P2].sort();
    const a = access(proj('member', P2, MEMBER), proj('member', P1, MEMBER), proj('viewer', P1, VIEWER));
    expect(visibleProjects(a, 'run:read')).toEqual(ids);
  });
  it('is empty without grants', () => {
    expect(visibleProjects(access(), 'run:read')).toEqual([]);
  });
});

describe('inScope', () => {
  it('org grant covers any project', () => {
    expect(inScope(access(org('viewer', VIEWER)), NEW_PROJECT)).toBe(true);
  });
  it('project grant covers only its project', () => {
    const a = access(proj('viewer', P1, VIEWER));
    expect(inScope(a, P1)).toBe(true);
    expect(inScope(a, P2)).toBe(false);
  });
});

describe('PERMISSION_LEVEL', () => {
  it('covers every permission exactly', () => {
    expect(Object.keys(PERMISSION_LEVEL).sort()).toEqual(Permission.options.slice().sort());
  });
  it('marks platform permissions as platform', () => {
    for (const p of Permission.options) {
      expect(PERMISSION_LEVEL[p] === 'platform').toBe(p.startsWith('platform-'));
      expect(isPlatformPermission(p)).toBe(p.startsWith('platform-'));
    }
  });
  it('marks the org-level permissions as org', () => {
    const orgLevel = Permission.options.filter((p) => PERMISSION_LEVEL[p] === 'org').sort();
    expect(orgLevel).toEqual(
      [
        'project:create',
        'project:delete',
        'connection:create',
        'connection:read',
        'member:read',
        'member:create',
        'member:update',
        'member:delete',
        'org:update',
        'org:delete',
        'audit:read',
      ].sort(),
    );
  });
  it('has 35 tenant and 16 platform permissions', () => {
    expect(TENANT).toHaveLength(35);
    expect(Permission.options).toHaveLength(51);
  });
  it('marks project-audit:read as project level, counted from a project grant only on that project', () => {
    expect(PERMISSION_LEVEL['project-audit:read']).toBe('project');
    const a = access(proj('custom', P1, [line('project-audit:read')]));
    expect(can(a, 'project-audit:read', { projectId: P1 })).toBe(true);
    expect(can(a, 'project-audit:read', { projectId: P2 })).toBe(false);
  });
  it('BR-26: an org viewer plus an admin on P1 can read the audit and manage members on P1 only', () => {
    const a = access(org('viewer', VIEWER), proj('admin', P1, ADMIN));
    expect(can(a, 'project-audit:read', { projectId: P1 })).toBe(true);
    expect(can(a, 'assignment:create', { projectId: P1 })).toBe(true);
    expect(can(a, 'rule:create', { projectId: P2 })).toBe(false);
    expect(can(a, 'project:read', { projectId: P2 })).toBe(true);
  });
  it.each(['platform-admin:read', 'platform-admin:create', 'platform-admin:delete'] as const)(
    '%s is a platform permission the owner never holds',
    (p) => {
      expect(Permission.options).toContain(p);
      expect(PERMISSION_LEVEL[p]).toBe('platform');
      expect(isPlatformPermission(p)).toBe(true);
      expect(holdsAnywhere(access(org('owner', OWNER)), p)).toBe(false);
    },
  );
  it('platform-org:update is a platform-level permission the owner never holds', () => {
    expect(PERMISSION_LEVEL['platform-org:update']).toBe('platform');
    expect(holdsAnywhere(access(org('owner', OWNER)), 'platform-org:update')).toBe(false);
  });
  it('treats platform-invitation:update as a platform permission', () => {
    expect(Permission.options).toContain('platform-invitation:update');
    expect(isPlatformPermission('platform-invitation:update')).toBe(true);
  });
});
