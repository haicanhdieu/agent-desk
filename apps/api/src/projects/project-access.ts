import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { projects, type Tx } from '@agentdesk/db';
import type { OrgContext } from '../auth/org-context';

/**
 * Write/test access to a project: the org owner or the project's creator (the same rule as terminal attach).
 * Reads need only org membership, which the session guard already established.
 * Throws 404 when the project is not visible in the caller's org (missing or another org's), 403 otherwise.
 * Call it inside the `withOrg` transaction that does the work so RLS scopes the lookup.
 */
export async function assertCanEditProject(tx: Tx, org: OrgContext, projectId: string): Promise<void> {
  const rows = await tx
    .select({ createdBy: projects.createdBy })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const project = rows[0];
  if (!project) throw new NotFoundException('Project not found');
  if (org.role !== 'owner' && project.createdBy !== org.userId) {
    throw new ForbiddenException('Only the project creator or an org owner can do this');
  }
}

/** 404 unless the project is visible in the caller's org. Use for read endpoints. */
export async function assertProjectVisible(tx: Tx, projectId: string): Promise<void> {
  const rows = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!rows[0]) throw new NotFoundException('Project not found');
}
