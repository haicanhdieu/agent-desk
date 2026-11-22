import { z } from 'zod';

const TENANT_PERMISSIONS = [
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
  'org:delete',
  'audit:read',
] as const;

const PLATFORM_PERMISSIONS = [
  'platform-org:create',
  'platform-org:read',
  'platform-project:read',
  'platform-role:read',
  'platform-member:read',
  'platform-assignment:read',
  'platform-assignment:create',
  'platform-assignment:delete',
  'platform-invitation:read',
  'platform-invitation:create',
  'platform-invitation:update',
  'platform-invitation:delete',
  'platform-admin:read',
  'platform-admin:create',
  'platform-admin:delete',
] as const;

export const Permission = z.enum([...TENANT_PERMISSIONS, ...PLATFORM_PERMISSIONS]);
export type Permission = z.infer<typeof Permission>;
export type PlatformPermission = Extract<Permission, `platform-${string}`>;

export const PermissionCondition = z.enum(['any', 'own']);
export type PermissionCondition = z.infer<typeof PermissionCondition>;

export const OWNABLE_PERMISSIONS = ['run:update', 'run:cancel', 'terminal:attach'] as const;

export const PermissionLevel = z.enum(['org', 'project', 'platform']);
type PermissionLevel = z.infer<typeof PermissionLevel>;

const ORG_LEVEL = new Set<string>([
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
]);

function levelOf(permission: Permission): PermissionLevel {
  if (permission.startsWith('platform-')) return 'platform';
  return ORG_LEVEL.has(permission) ? 'org' : 'project';
}

export const PERMISSION_LEVEL: Record<Permission, PermissionLevel> = Object.fromEntries(
  Permission.options.map((p) => [p, levelOf(p)]),
) as Record<Permission, PermissionLevel>; // keys are exactly Permission.options

export const ScopeType = z.enum(['org', 'project']);
export type ScopeType = z.infer<typeof ScopeType>;
export type Scope = { type: 'org' } | { type: 'project'; projectId: string };

export interface GrantLine {
  permission: Permission;
  condition: PermissionCondition;
}
export interface Grant {
  roleId: string;
  roleKey: string;
  scope: Scope;
  lines: GrantLine[];
}
export interface Access {
  userId: string;
  grants: Grant[];
}
export interface AccessTarget {
  projectId?: string;
  ownerUserId?: string | null;
}

export function isPlatformPermission(name: string): boolean {
  return name.startsWith('platform-');
}

/** A grant counts when its scope is org, or project === target.projectId (project-level permissions only);
 *  a line counts when condition is 'any', or 'own' and ownerUserId === access.userId. Platform permissions: always false. */
export function can(access: Access, permission: Permission, target: AccessTarget = {}): boolean {
  const level = PERMISSION_LEVEL[permission];
  if (level === 'platform') return false;
  return access.grants.some((g) => {
    if (g.scope.type === 'project') {
      if (level === 'org' || g.scope.projectId !== target.projectId) return false;
    }
    return g.lines.some(
      (l) =>
        l.permission === permission &&
        (l.condition === 'any' || (target.ownerUserId != null && target.ownerUserId === access.userId)),
    );
  });
}

/** Held at some scope under any condition (own included; the own-run check comes after the target lookup); an org-level permission counts only from an org-scope grant. */
export function holdsAnywhere(access: Access, permission: Permission): boolean {
  const level = PERMISSION_LEVEL[permission];
  if (level === 'platform') return false;
  return access.grants.some(
    (g) => (g.scope.type === 'org' || level === 'project') && g.lines.some((l) => l.permission === permission),
  );
}

/** Some grant covers the project: an org-scope grant, or a project grant on it. */
export function inScope(access: Access, projectId: string): boolean {
  return access.grants.some((g) => g.scope.type === 'org' || g.scope.projectId === projectId);
}

/** 'all' when an org-scope grant lists the permission, else the sorted unique project ids whose grant lists it. */
export function visibleProjects(access: Access, permission: Permission): 'all' | string[] {
  const ids = new Set<string>();
  for (const g of access.grants) {
    if (!g.lines.some((l) => l.permission === permission)) continue;
    if (g.scope.type === 'org') return 'all';
    ids.add(g.scope.projectId);
  }
  return [...ids].sort();
}
