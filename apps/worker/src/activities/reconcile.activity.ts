import { inArray } from 'drizzle-orm';
import { FINAL_RUN_STATUSES, isSettled, RunStatus } from '@agentdesk/contracts';
import { runWorkflowId, type Clock, type KubeGateway } from '@agentdesk/core';
import { runs, setupTests, withOrg, type Db } from '@agentdesk/db';
import { and, eq } from 'drizzle-orm';
import { setRunStatusTx } from './run-status.activity';

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
  error?(msg: string, meta?: Record<string, unknown>): void;
}

export interface ReconcileDeps {
  db: Db;
  kube: KubeGateway;
  temporal: ReconcileTemporal;
  log?: ReconcileLogger;
  /** Platform limits that bound a setup test's lifetime (config `RUN_SETUP_TIMEOUT_SECONDS`). */
  setupTest: { setupTimeoutSeconds: number };
  /** Defaults to the system clock. */
  clock?: Clock;
}

/** Slack on top of the setup timeout before a setup test's Job or Secret counts as leaked. */
const SETUP_TEST_GRACE_SECONDS = 600;

/** A kept session's volume is deleted this long after `sessionExpiresAt` if its workflow has not already done so. */
export const SESSION_EXPIRY_GRACE_SECONDS = 3600;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isFinal = (s: string): boolean => (FINAL_RUN_STATUSES as readonly string[]).includes(s);

export interface ReconcileResult {
  deletedJobs: number;
  /** Run Secrets deleted on their own (their Job was already gone or never created). */
  deletedSecrets: number;
  releasedSlots: number;
  /** Setup-test Jobs and Secrets deleted (their test is missing, ended or overdue); never run objects. */
  deletedSetupTestJobs: number;
  deletedSetupTestSecrets: number;
  /** Run volume claims deleted (run missing, settled, session long expired, or workflow closed). */
  deletedVolumes: number;
  /** Paused runs whose workflow was closed, written as `expired`. */
  expiredRuns: number;
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
 * (4) Deletes setup-test Jobs and Secrets whose test row is missing, has `ended_at`, or is older than
 *     `created_at + setup timeout + 600 s` (a Secret is also deleted when its Job never existed).
 * (5) Deletes run volume claims whose run is missing or settled, whose kept session expired over
 *     SESSION_EXPIRY_GRACE_SECONDS ago, or whose workflow is closed. A `paused` run with a closed workflow is first
 *     written as `expired`; a `succeeded` run with a kept session and a closed workflow loses its session expiry.
 *     A run with a kept session has a volume and no Job or Secret; that is not a leak.
 * Runs are looked up per org from the objects' labels, each under `withOrg`. Every step is idempotent; a failure on
 * one object is logged (error name only) and skipped.
 */
export async function reconcile(deps: ReconcileDeps): Promise<ReconcileResult> {
  const { db, kube, temporal } = deps;
  const out: ReconcileResult = {
    deletedJobs: 0,
    deletedSecrets: 0,
    releasedSlots: 0,
    deletedSetupTestJobs: 0,
    deletedSetupTestSecrets: 0,
    deletedVolumes: 0,
    expiredRuns: 0,
  };
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

  await reconcileVolumes(deps, out, warn, isOpen);

  await reconcileSetupTests(deps, out, warn);

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

/** Run volume claims, judged per run under `withOrg`. A malformed label belongs to no run (run missing → deleted). */
async function reconcileVolumes(
  deps: ReconcileDeps,
  out: ReconcileResult,
  warn: (msg: string, meta: Record<string, unknown>, err: unknown) => void,
  isOpen: (runId: string) => Promise<boolean>,
): Promise<void> {
  const { db, kube } = deps;
  const now = (deps.clock ?? { now: () => new Date() }).now();
  const volumes = await kube.listRunVolumeClaims();
  const idsByOrg = new Map<string, Set<string>>();
  for (const v of volumes) {
    if (!UUID.test(v.orgId) || !UUID.test(v.runId)) continue;
    idsByOrg.set(v.orgId, (idsByOrg.get(v.orgId) ?? new Set()).add(v.runId));
  }
  const rows = new Map<string, { status: string; sessionExpiresAt: Date | null }>();
  for (const [orgId, ids] of idsByOrg) {
    const found = await withOrg(db, orgId, (tx) =>
      tx
        .select({ id: runs.id, orgId: runs.orgId, status: runs.status, sessionExpiresAt: runs.sessionExpiresAt })
        .from(runs)
        .where(inArray(runs.id, [...ids])),
    );
    for (const r of found) rows.set(`${r.orgId}/${r.id}`, r);
  }

  for (const v of volumes) {
    try {
      const row = rows.get(`${v.orgId}/${v.runId}`);
      const parsed = row ? RunStatus.safeParse(row.status) : null;
      let doDelete = row === undefined || parsed === null || !parsed.success;
      if (row && parsed?.success) {
        const status = parsed.data;
        const closed = !(await isOpen(v.runId));
        const expiresAt = row.sessionExpiresAt;
        const longExpired =
          expiresAt !== null && expiresAt.getTime() < now.getTime() - SESSION_EXPIRY_GRACE_SECONDS * 1000;
        doDelete =
          closed || longExpired || isSettled({ status, sessionExpiresAt: expiresAt?.toISOString() ?? null }, now);
        if (closed && status === 'paused') {
          const changed = await withOrg(db, v.orgId, async (tx) => {
            const res = await setRunStatusTx(
              tx,
              { orgId: v.orgId, runId: v.runId, status: 'expired', session: null, at: now.toISOString() },
              { onlyFrom: ['paused'] },
            );
            return res.changed;
          });
          if (changed) out.expiredRuns += 1;
        } else if (closed && status === 'succeeded' && expiresAt !== null) {
          await withOrg(db, v.orgId, (tx) =>
            tx
              .update(runs)
              .set({ sessionExpiresAt: null })
              .where(and(eq(runs.id, v.runId), eq(runs.status, 'succeeded'))),
          );
        }
      }
      if (!doDelete) continue;
      await kube.deleteVolumeClaim(v.name);
      out.deletedVolumes += 1;
    } catch (err) {
      warn('reconcile: volume cleanup failed', { volume: v.name }, err);
    }
  }
}

/**
 * Setup-test objects (label `agentdesk/kind=setup-test`) are separate from run objects: nothing here reads or deletes a
 * run Job or Secret. A test row is looked up per org under `withOrg`, from the object's labels; a malformed label
 * belongs to no test (row missing → deleted). A Secret with no Job is judged by the same rule, so one whose Job is
 * still being created (row live, young) is kept.
 */
async function reconcileSetupTests(
  deps: ReconcileDeps,
  out: ReconcileResult,
  warn: (msg: string, meta: Record<string, unknown>, err: unknown) => void,
): Promise<void> {
  const { db, kube } = deps;
  const jobs = await kube.listSetupTestJobs();
  const secrets = await kube.listSetupTestSecrets();
  const idsByOrg = new Map<string, Set<string>>();
  for (const ref of [...jobs, ...secrets]) {
    if (!UUID.test(ref.orgId) || !UUID.test(ref.setupTestId)) continue;
    idsByOrg.set(ref.orgId, (idsByOrg.get(ref.orgId) ?? new Set()).add(ref.setupTestId));
  }
  const rows = new Map<string, { createdAt: Date; endedAt: Date | null }>();
  for (const [orgId, ids] of idsByOrg) {
    const found = await withOrg(db, orgId, (tx) =>
      tx
        .select({
          id: setupTests.id,
          orgId: setupTests.orgId,
          createdAt: setupTests.createdAt,
          endedAt: setupTests.endedAt,
        })
        .from(setupTests)
        .where(inArray(setupTests.id, [...ids])),
    );
    for (const r of found) rows.set(`${r.orgId}/${r.id}`, r);
  }
  const maxAgeMs = (deps.setupTest.setupTimeoutSeconds + SETUP_TEST_GRACE_SECONDS) * 1000;
  const nowMs = (deps.clock ?? { now: () => new Date() }).now().getTime();
  const stale = (ref: { orgId: string; setupTestId: string }): boolean => {
    const row = rows.get(`${ref.orgId}/${ref.setupTestId}`);
    return row === undefined || row.endedAt !== null || nowMs > row.createdAt.getTime() + maxAgeMs;
  };

  const deletedWithJob = new Set<string>();
  for (const job of jobs) {
    try {
      if (!stale(job)) continue;
      await kube.deleteJob(job.jobName);
      await kube.deleteSecret(job.jobName);
      deletedWithJob.add(job.jobName);
      out.deletedSetupTestJobs += 1;
    } catch (err) {
      warn('reconcile: setup test job cleanup failed', { job: job.jobName }, err);
    }
  }
  for (const secret of secrets) {
    if (deletedWithJob.has(secret.secretName)) continue;
    try {
      if (!stale(secret)) continue;
      await kube.deleteSecret(secret.secretName);
      out.deletedSetupTestSecrets += 1;
    } catch (err) {
      warn('reconcile: setup test secret cleanup failed', { secret: secret.secretName }, err);
    }
  }
}
