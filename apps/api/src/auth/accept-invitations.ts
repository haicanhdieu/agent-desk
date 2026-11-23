import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { auditLog, invitations, member, projects, roleAssignments, roles, type Tx } from '@agentdesk/db';
import { buildAuditRow, writeAuditEntry } from '../audit/audit-entry';

/**
 * Applies one invitation the caller has already re-read `for update` under the per-user advisory lock and found
 * pending, unexpired and addressed to the user: member row (one per org, kept if present), role assignments (project
 * ids that no longer exist are skipped), status `accepted` and the audit entries, all in the caller's transaction.
 */
export async function acceptInvitationInTx(
  tx: Tx,
  invitation: typeof invitations.$inferSelect,
  user: { id: string },
): Promise<void> {
  const [role] = await tx
    .select({ id: roles.id, key: roles.key })
    .from(roles)
    .where(and(eq(roles.orgId, invitation.orgId), eq(roles.id, invitation.roleId)))
    .limit(1);
  if (!role) throw new Error('invitation role is missing');

  const [existingMember] = await tx
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, invitation.orgId), eq(member.userId, user.id)))
    .limit(1);
  if (!existingMember) {
    await tx.insert(member).values({
      id: randomUUID(),
      organizationId: invitation.orgId,
      userId: user.id,
      role: invitation.scopeType === 'org' && role.key === 'owner' ? 'owner' : 'member',
      createdAt: sql`now()`,
    });
  }

  const isProjectScope = invitation.scopeType === 'project';
  const existingProjects = isProjectScope
    ? await tx
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.orgId, invitation.orgId), inArray(projects.id, invitation.projectIds)))
    : [];
  const existingIds = new Set(existingProjects.map((p) => p.id));
  const skippedProjectIds = invitation.projectIds.filter((id) => !existingIds.has(id));
  const targets: (string | null)[] = isProjectScope
    ? invitation.projectIds.filter((id) => existingIds.has(id))
    : [null];

  // One statement for all targets. The unique key (org, user, role, project) is NULLS NOT DISTINCT, so an
  // org-scope row (project_id null) dedupes like a project row; a bare ON CONFLICT DO NOTHING covers both.
  const inserted =
    targets.length === 0
      ? []
      : await tx
          .insert(roleAssignments)
          .values(
            targets.map((projectId) => ({
              orgId: invitation.orgId,
              userId: user.id,
              roleId: invitation.roleId,
              scopeType: invitation.scopeType,
              projectId,
              grantedBy: invitation.invitedBy,
            })),
          )
          .onConflictDoNothing()
          .returning({ projectId: roleAssignments.projectId });
  const insertedIds = new Set(inserted.map((r) => r.projectId));
  const created = targets.filter((projectId) => insertedIds.has(projectId));

  await tx
    .update(invitations)
    .set({ status: 'accepted', acceptedBy: user.id, acceptedAt: sql`now()` })
    .where(and(eq(invitations.orgId, invitation.orgId), eq(invitations.id, invitation.id)));

  await writeAuditEntry(tx, {
    orgId: invitation.orgId,
    actorUserId: user.id,
    action: 'invitation.accepted',
    targetType: 'invitation',
    targetId: invitation.id,
    payload: {
      email: invitation.email,
      to: {
        roleId: role.id,
        roleKey: role.key,
        scope: isProjectScope ? { type: 'project', projectIds: invitation.projectIds } : { type: 'org' },
      },
      ...(skippedProjectIds.length > 0 ? { skippedProjectIds } : {}),
      acceptedBy: user.id,
    },
    projectIds: invitation.projectIds,
  });
  if (created.length > 0) {
    await tx.insert(auditLog).values(
      created.map((projectId) =>
        buildAuditRow({
          orgId: invitation.orgId,
          actorUserId: invitation.invitedBy,
          action: 'assignment.granted',
          targetType: 'user',
          targetId: user.id,
          payload: {
            to: {
              roleId: role.id,
              roleKey: role.key,
              scope: projectId === null ? { type: 'org' } : { type: 'project', projectId },
            },
            via: { invitationId: invitation.id },
          },
          projectIds: projectId === null ? [] : [projectId],
        }),
      ),
    );
  }
}
