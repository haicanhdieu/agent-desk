import { and, asc, eq } from 'drizzle-orm';
import { roleAssignments, roles, type Tx } from '@agentdesk/db';

/** Locks every org-scope owner assignment of the org (id order, `for update`) and returns them. */
export async function lockOrgOwnerRows(tx: Tx, orgId: string): Promise<{ id: string; userId: string }[]> {
  return tx
    .select({ id: roleAssignments.id, userId: roleAssignments.userId })
    .from(roleAssignments)
    .innerJoin(roles, and(eq(roles.orgId, roleAssignments.orgId), eq(roles.id, roleAssignments.roleId)))
    .where(and(eq(roleAssignments.orgId, orgId), eq(roleAssignments.scopeType, 'org'), eq(roles.key, 'owner')))
    .orderBy(asc(roleAssignments.id))
    .for('update', { of: roleAssignments });
}
