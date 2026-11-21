import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { rolePermissions, roleTemplatePermissions, roleTemplates, roles, type Tx } from '@agentdesk/db';
import { isPlatformPermission } from '@agentdesk/contracts';

/** Copies role_templates into roles/role_permissions for orgId (tx must be withOrg(orgId)); idempotent;
 *  throws when a template line holds a platform-* permission. */
export async function copyRoleTemplates(tx: Tx, orgId: string): Promise<void> {
  const scoped = await tx.execute<{ org: string | null }>(sql`select current_setting('app.org_id', true) as org`);
  if (scoped.rows[0]?.org !== orgId) throw new Error('copyRoleTemplates: tx is not scoped to this org');

  const lines = await tx.select({ permission: roleTemplatePermissions.permission }).from(roleTemplatePermissions);
  if (lines.some((l) => isPlatformPermission(l.permission))) {
    throw new Error('copyRoleTemplates: a role template holds a platform permission');
  }

  await tx
    .insert(roles)
    .select(
      tx
        .select({
          id: sql<string>`gen_random_uuid()`.as('id'),
          orgId: sql<string>`${orgId}::uuid`.as('org_id'),
          key: roleTemplates.key,
          name: roleTemplates.name,
          builtIn: sql<boolean>`true`.as('built_in'),
          templateId: roleTemplates.id,
          assignableScopes: roleTemplates.assignableScopes,
          createdAt: sql<Date>`now()`.as('created_at'),
        })
        .from(roleTemplates),
    )
    .onConflictDoNothing({ target: [roles.orgId, roles.key] });

  await tx
    .insert(rolePermissions)
    .select(
      tx
        .select({
          orgId: roles.orgId,
          roleId: roles.id,
          permission: roleTemplatePermissions.permission,
          condition: roleTemplatePermissions.condition,
        })
        .from(roles)
        .innerJoin(roleTemplatePermissions, eq(roleTemplatePermissions.templateId, roles.templateId))
        .where(and(eq(roles.orgId, orgId), eq(roles.builtIn, true), isNotNull(roles.templateId))),
    )
    .onConflictDoNothing({ target: [rolePermissions.roleId, rolePermissions.permission] });
}
