import type { Db } from "./client";

/** Webhook intake: map (provider, account, repo) to a project across tenants (SECURITY DEFINER function). */
export async function resolveProject(
  db: Db,
  provider: string,
  externalId: string,
  repoPath: string,
): Promise<{ orgId: string; projectId: string } | null> {
  const r = await db.pool.query<{ org_id: string; project_id: string }>(
    "select org_id, project_id from resolve_project($1, $2, $3)",
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
  const r = await db.pool.query<{ org_id: string; run_id: string }>(
    "select org_id, run_id from queued_runs_without_workflow($1::int)",
    [Math.trunc(olderThanSeconds)],
  );
  return r.rows.map((x) => ({ orgId: x.org_id, runId: x.run_id }));
}
