import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { ProjectParam } from '@agentdesk/contracts';
import { agents, projects, rules, runs, setupTests, type Tx } from '@agentdesk/db';

export interface ResolvedTarget {
  projectId: string;
  /** Set for `runId` and `setupTestId` targets: the run's owner, or the setup test's starter. `null` = ownerless run. */
  ownerUserId?: string | null;
}

const Uuid = z.uuid();

/**
 * The project (and, for runs and setup tests, the owner) behind an id-keyed route param, in one lookup. Call it inside
 * `withOrg`, so RLS hides other orgs' rows: they come back as `null`, the same as a missing row. A missing or non-uuid id
 * is `null` too and never reaches the database.
 */
export async function resolveTarget(
  tx: Tx,
  param: ProjectParam,
  id: string | undefined,
): Promise<ResolvedTarget | null> {
  if (id === undefined || !Uuid.safeParse(id).success) return null;
  switch (param) {
    case 'projectId': {
      const [row] = await tx.select({ projectId: projects.id }).from(projects).where(eq(projects.id, id)).limit(1);
      return row ?? null;
    }
    case 'runId': {
      const [row] = await tx
        .select({ projectId: runs.projectId, ownerUserId: runs.ownerUserId })
        .from(runs)
        .where(eq(runs.id, id))
        .limit(1);
      return row ?? null;
    }
    case 'ruleId': {
      const [row] = await tx.select({ projectId: rules.projectId }).from(rules).where(eq(rules.id, id)).limit(1);
      return row ?? null;
    }
    case 'agentId': {
      const [row] = await tx.select({ projectId: agents.projectId }).from(agents).where(eq(agents.id, id)).limit(1);
      return row ?? null;
    }
    case 'setupTestId': {
      const [row] = await tx
        .select({ projectId: setupTests.projectId, ownerUserId: setupTests.startedBy })
        .from(setupTests)
        .where(eq(setupTests.id, id))
        .limit(1);
      return row ?? null;
    }
  }
}
