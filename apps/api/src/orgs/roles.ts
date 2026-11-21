import { asc, eq } from 'drizzle-orm';
import { rolePermissions, roles, type Tx } from '@agentdesk/db';
import {
  Permission,
  PermissionCondition,
  ScopeType,
  isPlatformPermission,
  type GrantLine,
  type RoleDto,
} from '@agentdesk/contracts';
import type { RoleForGrant } from '../access/grant-rules';

/** Built-in roles come first in this order, then any other role by name. */
const BUILT_IN_ORDER = ['owner', 'admin', 'member', 'viewer'];

function rank(key: string): number {
  const i = BUILT_IN_ORDER.indexOf(key);
  return i === -1 ? BUILT_IN_ORDER.length : i;
}

/**
 * Roles of the tx's org with their permission lines. Unknown or platform-* permission names, unknown conditions and
 * unknown scope types are dropped (a tenant role never takes effect through them). `tx` must be a `withOrg` tx.
 */
async function loadRoles(tx: Tx, roleId?: string): Promise<RoleForGrant[]> {
  const roleRows = await tx
    .select()
    .from(roles)
    .where(roleId === undefined ? undefined : eq(roles.id, roleId))
    .orderBy(asc(roles.name), asc(roles.id));
  const lineRows = await tx
    .select({
      roleId: rolePermissions.roleId,
      permission: rolePermissions.permission,
      condition: rolePermissions.condition,
    })
    .from(rolePermissions)
    .where(roleId === undefined ? undefined : eq(rolePermissions.roleId, roleId))
    .orderBy(asc(rolePermissions.permission));
  const linesByRole = new Map<string, GrantLine[]>();
  for (const row of lineRows) {
    const permission = Permission.safeParse(row.permission);
    const condition = PermissionCondition.safeParse(row.condition);
    if (!permission.success || !condition.success || isPlatformPermission(permission.data)) continue;
    const lines = linesByRole.get(row.roleId) ?? [];
    lines.push({ permission: permission.data, condition: condition.data });
    linesByRole.set(row.roleId, lines);
  }
  return roleRows
    .map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      builtIn: r.builtIn,
      assignableScopes: r.assignableScopes.flatMap((s) => {
        const scope = ScopeType.safeParse(s);
        return scope.success ? [scope.data] : [];
      }),
      lines: linesByRole.get(r.id) ?? [],
    }))
    .sort((a, b) => rank(a.key) - rank(b.key) || a.name.localeCompare(b.name));
}

/** The role with this id in the tx's org, or null (missing, or another org's: RLS hides it). */
export async function loadRole(tx: Tx, roleId: string): Promise<RoleForGrant | null> {
  return (await loadRoles(tx, roleId))[0] ?? null;
}

/** Every role of the tx's org. */
export function loadAllRoles(tx: Tx): Promise<RoleForGrant[]> {
  return loadRoles(tx);
}

export function toRoleDto(role: RoleForGrant): RoleDto {
  return {
    id: role.id,
    key: role.key,
    name: role.name,
    builtIn: role.builtIn,
    assignableScopes: role.assignableScopes,
    permissions: role.lines.map((l) => ({ permission: l.permission, condition: l.condition })),
  };
}
