import { and, asc, eq } from 'drizzle-orm';
import { roleAssignments, rolePermissions, roles, type Tx } from '@agentdesk/db';
import {
  isPlatformPermission,
  Permission,
  PermissionCondition,
  type Access,
  type Grant,
  type GrantLine,
  type Scope,
} from '@agentdesk/contracts';

export interface AccessLog {
  warn(obj: object, msg: string): void;
}

export interface AccessRow {
  roleId: string;
  roleKey: string;
  scopeType: string;
  projectId: string | null;
  permission: string;
  condition: string;
}

function scopeOf(row: AccessRow): Scope | null {
  if (row.scopeType === 'org') return { type: 'org' };
  if (row.scopeType === 'project' && row.projectId) return { type: 'project', projectId: row.projectId };
  return null;
}

/** Groups rows by (roleId, scope); unknown or platform-* permission names and unknown conditions are skipped with one warn each (N7). */
export function toAccess(userId: string, rows: AccessRow[], log?: AccessLog): Access {
  const grants = new Map<string, Grant>();
  for (const row of rows) {
    const permission = Permission.safeParse(row.permission);
    if (!permission.success || isPlatformPermission(permission.data)) {
      log?.warn({ permission: row.permission }, 'ignoring unknown permission name in a role');
      continue;
    }
    const condition = PermissionCondition.safeParse(row.condition);
    if (!condition.success) {
      log?.warn({ condition: row.condition }, 'ignoring unknown permission condition in a role');
      continue;
    }
    const scope = scopeOf(row);
    if (!scope) {
      log?.warn({ scopeType: row.scopeType }, 'ignoring role assignment with an invalid scope');
      continue;
    }
    const key = `${row.roleId}|${scope.type}|${scope.type === 'project' ? scope.projectId : ''}`;
    let grant = grants.get(key);
    if (!grant) {
      grant = { roleId: row.roleId, roleKey: row.roleKey, scope, lines: [] };
      grants.set(key, grant);
    }
    const line: GrantLine = { permission: permission.data, condition: condition.data };
    grant.lines.push(line);
  }
  return { userId, grants: [...grants.values()] };
}

/** One query over role_assignments ⨝ roles ⨝ role_permissions for the user, inside the caller's withOrg tx. */
export async function loadAccess(tx: Tx, userId: string, log?: AccessLog): Promise<Access> {
  const rows = await tx
    .select({
      roleId: roles.id,
      roleKey: roles.key,
      scopeType: roleAssignments.scopeType,
      projectId: roleAssignments.projectId,
      permission: rolePermissions.permission,
      condition: rolePermissions.condition,
    })
    .from(roleAssignments)
    .innerJoin(roles, and(eq(roles.orgId, roleAssignments.orgId), eq(roles.id, roleAssignments.roleId)))
    .innerJoin(rolePermissions, and(eq(rolePermissions.orgId, roles.orgId), eq(rolePermissions.roleId, roles.id)))
    .where(eq(roleAssignments.userId, userId))
    .orderBy(
      asc(roles.key),
      asc(roleAssignments.scopeType),
      asc(roleAssignments.projectId),
      asc(rolePermissions.permission),
    );
  return toAccess(userId, rows, log);
}
