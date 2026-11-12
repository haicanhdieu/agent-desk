import { inArray } from 'drizzle-orm';
import { FINAL_RUN_STATUSES } from '@agentdesk/contracts';
import { runWorkflowId, type KubeGateway, type RunJobRef } from '@agentdesk/core';
import { runs, withOrg, type Db } from '@agentdesk/db';

/** The Temporal operations reconcile needs (implemented over the client in temporal-ops.ts). */
export interface ReconcileTemporal {
  /** True while the workflow execution is running; false when closed or unknown. */
  isWorkflowOpen(workflowId: string): Promise<boolean>;
  /** Project ids of running `gate-{projectId}` workflows. */
  listOpenGateProjectIds(): Promise<string[]>;
  /** Run ids the gate holds (active and queued). */
  gateRuns(projectId: string): Promise<string[]>;
  releaseSlot(projectId: string, runId: string): Promise<void>;
}

export interface ReconcileLogger {
  warn(msg: string, meta?: Record<string, unknown>): void;
}

export interface ReconcileDeps {
  db: Db;
  kube: KubeGateway;
  temporal: ReconcileTemporal;
  log?: ReconcileLogger;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isFinal = (s: string): boolean => (FINAL_RUN_STATUSES as readonly string[]).includes(s);

/**
 * Spec §6.5, daily. (1) Deletes run Jobs (and their Secrets) whose run is final or missing, or whose workflow is
 * closed. Runs are looked up per org from the Jobs' labels, each under `withOrg`. (2) Releases gate slots held by runs
 * whose workflow is closed (a terminated RunWorkflow never reached its `releaseSlot`). Both steps are idempotent.
 */
export async function reconcile(deps: ReconcileDeps): Promise<{ deletedJobs: number; releasedSlots: number }> {
  const { db, kube, temporal } = deps;
  let deletedJobs = 0;
  let releasedSlots = 0;

  const byOrg = new Map<string, RunJobRef[]>();
  for (const job of await kube.listRunJobs()) {
    // Labels are ours, but a malformed one must not reach withOrg or a query; such a Job belongs to no run.
    const key = UUID.test(job.orgId) && UUID.test(job.runId) ? job.orgId : '';
    byOrg.set(key, [...(byOrg.get(key) ?? []), job]);
  }

  const remove = async (job: RunJobRef): Promise<void> => {
    await kube.deleteJob(job.jobName);
    await kube.deleteSecret(job.jobName);
    deletedJobs += 1;
  };

  for (const [orgId, jobs] of byOrg) {
    const status = new Map<string, string>();
    if (orgId !== '') {
      const rows = await withOrg(db, orgId, (tx) =>
        tx
          .select({ id: runs.id, status: runs.status })
          .from(runs)
          .where(
            inArray(
              runs.id,
              jobs.map((j) => j.runId),
            ),
          ),
      );
      for (const r of rows) status.set(r.id, r.status);
    }
    for (const job of jobs) {
      const s = status.get(job.runId);
      try {
        if (s === undefined || isFinal(s) || !(await temporal.isWorkflowOpen(runWorkflowId(job.runId)))) {
          await remove(job);
        }
      } catch (err) {
        deps.log?.warn('reconcile: job cleanup failed', {
          job: job.jobName,
          error: err instanceof Error ? err.name : 'unknown',
        });
      }
    }
  }

  for (const projectId of await temporal.listOpenGateProjectIds()) {
    try {
      for (const runId of await temporal.gateRuns(projectId)) {
        if (await temporal.isWorkflowOpen(runWorkflowId(runId))) continue;
        await temporal.releaseSlot(projectId, runId);
        releasedSlots += 1;
      }
    } catch (err) {
      deps.log?.warn('reconcile: gate cleanup failed', {
        projectId,
        error: err instanceof Error ? err.name : 'unknown',
      });
    }
  }
  return { deletedJobs, releasedSlots };
}
