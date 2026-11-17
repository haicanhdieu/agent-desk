import { ApplicationFailure } from '@temporalio/common';
import { and, desc, eq, gt, ne } from 'drizzle-orm';
import {
  AGENT_DONE_KEEP_SECONDS_DEFAULT,
  AGENT_PAUSED_KEEP_SECONDS_DEFAULT,
  RunStatus,
  type PauseReason,
} from '@agentdesk/contracts';
import { SIGNAL, redact, type Config } from '@agentdesk/core';
import { agents, notifyRunStatus, runs, withOrg, type Db } from '@agentdesk/db';
import { ERROR_MESSAGE_MAX, oneLine } from './activity-utils';
import { appendRunEvent } from './run-events';
import { setRunStatusTx } from './run-status.activity';
import type { ParkKind, ParkResult, RunActivities, RunContext } from './run.activities';

/** What the session activities need. `signalRun` is the run-workflow signaller of the other run activities. */
export interface SessionActivityDeps {
  db: Db;
  config: Pick<Config, 'RUN_KEPT_DONE_SESSIONS_PER_PROJECT'>;
  signaller: { signalRun(runId: string, signal: string, arg?: string): Promise<void> };
  /** Values to redact from a stored reason (the agent credential); a read error propagates (fail closed). */
  redactionValues(ctx: RunContext): Promise<string[]>;
}

export type SessionActivityImpls = Pick<RunActivities, 'parkRun' | 'endKeptSession' | 'restoreParked'>;

const parseAt = (at: string): Date => {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) throw ApplicationFailure.nonRetryable('invalid timestamp');
  return d;
};

export function createSessionActivities(deps: SessionActivityDeps): SessionActivityImpls {
  const { db } = deps;

  async function parkRun(
    ctx: RunContext,
    // `reason` is optional: a parkRun scheduled by workflow code from before it existed has none, and idle_timeout was the only reason then.
    input: { kind: ParkKind; at: string; reason?: PauseReason; resumeQueued?: boolean },
  ): Promise<ParkResult> {
    const at = parseAt(input.at);
    const { result, drop } = await withOrg(db, ctx.orgId, async (tx) => {
      // The agent row may be gone (deleted after the run was queued): the defaults then apply.
      const [agent] = ctx.agentId
        ? await tx
            .select({ paused: agents.pausedKeepSeconds, done: agents.doneKeepSeconds })
            .from(agents)
            .where(eq(agents.id, ctx.agentId))
        : [];
      const keepSeconds =
        input.kind === 'needs_input'
          ? (agent?.paused ?? AGENT_PAUSED_KEEP_SECONDS_DEFAULT)
          : (agent?.done ?? AGENT_DONE_KEEP_SECONDS_DEFAULT);
      const keep = keepSeconds > 0;
      const expiresAt = new Date(at.getTime() + keepSeconds * 1000);
      const status = input.kind === 'needs_input' ? 'paused' : 'succeeded';
      const written = await setRunStatusTx(tx, {
        orgId: ctx.orgId,
        runId: ctx.runId,
        status,
        at: input.at,
        // Nothing kept: clear any earlier session (a re-opened run) and let the note go like any final status.
        ...(keep ? { session: { expiresAt: expiresAt.toISOString() }, keepAgentNote: true } : { session: null }),
      });

      // Why it parked (the status write also cleared `session_ending_at`). A run that was already final is left alone.
      if (written.changed) {
        await tx
          .update(runs)
          .set({ pauseReason: input.reason ?? 'idle_timeout' })
          .where(eq(runs.id, ctx.runId));
        // A Resume was accepted while the session was ending, and this park keeps nothing to resume from: say so, so
        // the person who was told "accepted" can see why no pod started. Fixed text only (no run or user text).
        if (input.resumeQueued === true && !keep) {
          await appendRunEvent(tx, ctx.orgId, {
            runId: ctx.runId,
            type: 'lifecycle',
            payload: {
              kind: 'resume_failed',
              reason: 'nothing was kept to resume from',
              text: 'The resume could not run: nothing was kept to resume from.',
            },
            ts: at,
          });
        }
      }

      // The per-project cap: succeeded runs with a kept session, newest first; all beyond the newest `cap - 1`
      // (this run is the cap-th) are told to drop theirs. Paused runs are never counted.
      const drop: string[] = [];
      if (input.kind === 'done' && keep) {
        const cap = deps.config.RUN_KEPT_DONE_SESSIONS_PER_PROJECT;
        const older = await tx
          .select({ id: runs.id })
          .from(runs)
          .where(
            and(
              eq(runs.projectId, ctx.projectId),
              eq(runs.status, 'succeeded'),
              gt(runs.sessionExpiresAt, at),
              ne(runs.id, ctx.runId),
            ),
          )
          .orderBy(desc(runs.sessionExpiresAt))
          .offset(Math.max(0, cap - 1));
        drop.push(...older.map((r) => r.id));
      }
      const result: ParkResult = { status, sessionExpiresAt: keep ? expiresAt.toISOString() : null };
      return { result, drop };
    });
    // After the commit: a signal to a workflow that already closed is harmless (the signaller swallows it).
    for (const runId of drop) await deps.signaller.signalRun(runId, SIGNAL.dropSession);
    return result;
  }

  async function endKeptSession(ctx: RunContext, reason: 'expired' | 'dropped', at: string): Promise<void> {
    const when = parseAt(at);
    await withOrg(db, ctx.orgId, async (tx) => {
      const [run] = await tx
        .select({
          status: runs.status,
          sessionExpiresAt: runs.sessionExpiresAt,
          pausedAt: runs.pausedAt,
          agentNote: runs.agentNote,
          exitCode: runs.exitCode,
          failureReason: runs.failureReason,
        })
        .from(runs)
        .where(eq(runs.id, ctx.runId))
        .for('update');
      // The row is gone when its project was deleted: nothing to end, and the workflow still deletes the volume next.
      if (!run) return;
      const status = RunStatus.parse(run.status);
      if (status === 'paused') {
        // A paused run is never dropped early.
        if (reason === 'expired') {
          await setRunStatusTx(
            tx,
            { orgId: ctx.orgId, runId: ctx.runId, status: 'expired', at },
            { onlyFrom: ['paused'] },
          );
        }
        return;
      }
      if (status !== 'succeeded' || run.sessionExpiresAt === null) return;
      // `setRunStatus` leaves a final row alone, so the session of a done run is cleared here, with its own event.
      await tx.update(runs).set({ sessionExpiresAt: null }).where(eq(runs.id, ctx.runId));
      const ev = await appendRunEvent(tx, ctx.orgId, {
        runId: ctx.runId,
        type: 'status',
        payload: {
          status: 'succeeded',
          exitCode: run.exitCode ?? null,
          failureReason: run.failureReason ?? null,
          waitingOn: null,
          agentNote: run.agentNote,
          pausedAt: run.pausedAt?.toISOString() ?? null,
          sessionExpiresAt: null,
        },
        ts: when,
      });
      if (!ev) throw ApplicationFailure.nonRetryable('run not found');
      await notifyRunStatus(tx, { orgId: ctx.orgId, runId: ctx.runId, seq: ev.seq });
    });
  }

  async function restoreParked(
    ctx: RunContext,
    input: { kind: ParkKind; sessionExpiresAt: string; reason: string; at: string },
  ): Promise<void> {
    const at = parseAt(input.at);
    // Redact the whole reason first, then cap: cutting first could split a secret and leave a prefix behind.
    const reason = oneLine(redact(input.reason, await deps.redactionValues(ctx))).slice(0, ERROR_MESSAGE_MAX);
    await withOrg(db, ctx.orgId, async (tx) => {
      const [run] = await tx
        .select({ sessionExpiresAt: runs.sessionExpiresAt })
        .from(runs)
        .where(eq(runs.id, ctx.runId))
        .for('update');
      if (!run) throw ApplicationFailure.nonRetryable('run not found');
      // The resume leaves the stored expiry alone; only write it (which also stamps paused_at) if it went missing.
      const keptAsIs = run.sessionExpiresAt?.toISOString() === new Date(input.sessionExpiresAt).toISOString();
      await setRunStatusTx(tx, {
        orgId: ctx.orgId,
        runId: ctx.runId,
        status: input.kind === 'needs_input' ? 'paused' : 'succeeded',
        keepAgentNote: true,
        ...(keptAsIs ? {} : { session: { expiresAt: input.sessionExpiresAt } }),
        at: input.at,
      });
      await appendRunEvent(tx, ctx.orgId, {
        runId: ctx.runId,
        type: 'lifecycle',
        payload: { kind: 'resume_failed', reason },
        ts: at,
      });
    });
  }

  return { parkRun, endKeptSession, restoreParked };
}
