import { NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { projects, type Tx } from '@agentdesk/db';

/** 404 unless the project is visible in the caller's org. The permission is the guard's job (`checkTenantAccess`); this only keeps a service safe when called without it. */
export async function assertProjectVisible(tx: Tx, projectId: string): Promise<void> {
  const rows = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!rows[0]) throw new NotFoundException('Project not found');
}
