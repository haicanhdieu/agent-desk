import type { Db } from './client';

/** Webhook intake: map (provider, account, repo) to a project across tenants (SECURITY DEFINER function). */
export async function resolveProject(
  db: Db,
  provider: string,
  externalId: string,
  repoPath: string,
): Promise<{ orgId: string; projectId: string } | null> {
  const r = await db.pool.query<{ org_id: string; project_id: string }>(
    'select org_id, project_id from resolve_project($1, $2, $3)',
    [provider, externalId, repoPath],
  );
  const row = r.rows[0];
  return row ? { orgId: row.org_id, projectId: row.project_id } : null;
}

/** Sweep: queued runs with no workflow older than the interval, across tenants. */
export async function queuedRunsWithoutWorkflow(
  db: Db,
  olderThanSeconds: number,
): Promise<{ orgId: string; runId: string }[]> {
  if (!Number.isInteger(olderThanSeconds) || olderThanSeconds < 0) {
    throw new Error('olderThanSeconds must be a non-negative integer');
  }
  const r = await db.pool.query<{ org_id: string; run_id: string }>(
    'select org_id, run_id from queued_runs_without_workflow($1::int)',
    [olderThanSeconds],
  );
  return r.rows.map((x) => ({ orgId: x.org_id, runId: x.run_id }));
}

/** Sign-up gate and acceptance: pending, unexpired invitations for an email across orgs (SECURITY DEFINER). Ids only. */
export async function pendingInvitationsForEmail(db: Db, email: string): Promise<{ id: string; orgId: string }[]> {
  const r = await db.pool.query<{ id: string; org_id: string }>(
    'select id, org_id from pending_invitations_for_email($1)',
    [email],
  );
  return r.rows.map((x) => ({ id: x.id, orgId: x.org_id }));
}

/** The org id of the invitation when its email equals lower(email), in any status; null otherwise (SECURITY DEFINER). */
export async function invitationOrgForEmail(db: Db, invitationId: string, email: string): Promise<string | null> {
  const r = await db.pool.query<{ org_id: string | null }>('select invitation_org_for_email($1, $2) as org_id', [
    invitationId,
    email,
  ]);
  return r.rows[0]?.org_id ?? null;
}

export interface PlatformOrgStatsRow {
  orgId: string;
  projectCount: number;
  lastActivityAt: Date | null;
  ownerUserId: string | null;
}

/** Platform directory: counts, last run queue time and the earliest org-scope owner per org (SECURITY DEFINER). At most 100 ids. */
export async function platformOrgStats(db: Db, orgIds: readonly string[]): Promise<PlatformOrgStatsRow[]> {
  if (orgIds.length > 100) throw new Error('platformOrgStats accepts at most 100 org ids');
  const r = await db.pool.query<{
    org_id: string;
    project_count: number;
    last_activity_at: Date | null;
    owner_user_id: string | null;
  }>('select org_id, project_count, last_activity_at, owner_user_id from platform_org_stats($1::uuid[])', [
    [...orgIds],
  ]);
  return r.rows.map((x) => ({
    orgId: x.org_id,
    projectCount: x.project_count,
    lastActivityAt: x.last_activity_at,
    ownerUserId: x.owner_user_id,
  }));
}
