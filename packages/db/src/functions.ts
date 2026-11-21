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
