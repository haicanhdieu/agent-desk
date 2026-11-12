import { inArray } from 'drizzle-orm';
import { FINAL_RUN_STATUSES } from '@agentdesk/contracts';
import { runWorkflowId, type KubeGateway } from '@agentdesk/core';
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

export interface ReconcileResult {
  deletedJobs: number;
  /** Run Secrets deleted on their own (their Job was already gone or never created). */
  deletedSecrets: number;
  releasedSlots: number;
}

/** Statuses during which a Secret may legitimately exist without its Job (createRunSecretAndJob in flight). */
const CREATING = new Set(['queued', 'starting']);

/**
 * Spec §6.5, daily.
 * (1) Deletes run Jobs (and their Secrets) whose run is final or missing, or whose workflow is closed.
 * (2) Deletes run Secrets whose run is final or missing or whose workflow is closed, and Secrets whose Job is gone
 *     while the run is past `starting` (a leaked token), even when no Job exists.
 * (3) Releases gate slots held by runs whose workflow is closed (a terminated RunWorkflow never reached its
 *     `releaseSlot`).
 * Runs are looked up per org from the objects' labels, each under `withOrg`. Every step is idempotent; a failure on
 * one object is logged (error name only) and skipped.
 */
export async function reconcile(deps: ReconcileDeps): Promise<ReconcileResult> {
  const { db, kube, temporal } = deps;
  const out: ReconcileResult = { deletedJobs: 0, deletedSecrets: 0, releasedSlots: 0 };
  const warn = (msg: string, meta: Record<string, unknown>, err: unknown): void =>
    deps.log?.warn(msg, { ...meta, error: err instanceof Error ? err.name : 'unknown' });

  const jobs = await kube.listRunJobs();
  const secrets = await kube.listRunSecrets();
  const jobNames = new Set(jobs.map((j) => j.jobName));

  // Run status per run id, read per org. Labels are ours, but a malformed one must not reach withOrg or a query:
  // such an object belongs to no run (status undefined → deleted).
  const runIdsByOrg = new Map<string, Set<string>>();
  for (const ref of [...jobs, ...secrets]) {
    if (!UUID.test(ref.orgId) || !UUID.test(ref.runId)) continue;
    runIdsByOrg.set(ref.orgId, (runIdsByOrg.get(ref.orgId) ?? new Set()).add(ref.runId));
  }
  const status = new Map<string, string>();
  for (const [orgId, ids] of runIdsByOrg) {
    const rows = await withOrg(db, orgId, (tx) =>
      tx
        .select({ id: runs.id, orgId: runs.orgId, status: runs.status })
        .from(runs)
        .where(inArray(runs.id, [...ids])),
    );
    for (const r of rows) status.set(`${r.orgId}/${r.id}`, r.status);
  }
  const statusOf = (ref: { orgId: string; runId: string }): string | undefined =>
    status.get(`${ref.orgId}/${ref.runId}`);

  const open = new Map<string, Promise<boolean>>();
  const isOpen = (runId: string): Promise<boolean> => {
    let p = open.get(runId);
    if (!p) {
      p = temporal.isWorkflowOpen(runWorkflowId(runId));
      open.set(runId, p);
    }
    return p;
  };
  const stale = async (ref: { orgId: string; runId: string }): Promise<boolean> => {
    const s = statusOf(ref);
    return s === undefined || isFinal(s) || !(await isOpen(ref.runId));
  };

  const deletedWithJob = new Set<string>();
  for (const job of jobs) {
    try {
      if (!(await stale(job))) continue;
      await kube.deleteJob(job.jobName);
      await kube.deleteSecret(job.jobName);
      deletedWithJob.add(job.jobName);
      out.deletedJobs += 1;
    } catch (err) {
      warn('reconcile: job cleanup failed', { job: job.jobName }, err);
    }
  }

  for (const secret of secrets) {
    if (deletedWithJob.has(secret.secretName)) continue;
    try {
      const s = statusOf(secret);
      const orphan = !jobNames.has(secret.secretName) && !(s !== undefined && CREATING.has(s));
      if (!orphan && !(await stale(secret))) continue;
      await kube.deleteSecret(secret.secretName);
      out.deletedSecrets += 1;
    } catch (err) {
      warn('reconcile: secret cleanup failed', { secret: secret.secretName }, err);
    }
  }

  for (const projectId of await temporal.listOpenGateProjectIds()) {
    try {
      for (const runId of await temporal.gateRuns(projectId)) {
        if (await isOpen(runId)) continue;
        await temporal.releaseSlot(projectId, runId);
        out.releasedSlots += 1;
      }
    } catch (err) {
      warn('reconcile: gate cleanup failed', { projectId }, err);
    }
  }
  return out;
}
