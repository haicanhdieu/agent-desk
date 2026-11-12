import { eq } from 'drizzle-orm';
import { Provider } from '@agentdesk/contracts';
import {
  processTicketEvent,
  startRunWorkflow,
  toAdapterProject,
  type AdapterProject,
  type AdapterRegistry,
  type Clock,
  type Config,
  type IntakeDeps,
  type PollResult,
  type WorkflowStarter,
} from '@agentdesk/core';
import { connections, pollCursors, projects, withOrg, type Db } from '@agentdesk/db';
import type { ReconcileLogger } from './reconcile.activity';

export interface PollInput {
  orgId: string;
  projectId: string;
}

/** What one tick did. Pauses are carried out by the workflow (activities `pausePollSchedule`). */
export type PollOutcome =
  | 'ok'
  | 'not_modified'
  /** Tick skipped without polling: inside a back-off/rate-limit window or paused as token_revoked. */
  | 'skipped'
  | { pause: 'rate_limited'; until: string }
  | { pause: 'token_revoked' }
  | { backoffSeconds: number };

export interface PausePollInput {
  orgId: string;
  projectId: string;
  note: string;
  /** Rate limits: when to start `resumePollWorkflow` (ISO time). */
  resumeAt?: string;
}

export interface ResumePollInput {
  orgId: string;
  projectId: string;
}

/** `waitUntil`: a later rate limit moved the reset time; the timer must sleep again. */
export type ResumeResult = { resumed: boolean } | { waitUntil: string };

/** Poll activities as seen from workflow code. */
export interface PollActivities {
  pollOnce(input: PollInput): Promise<PollOutcome>;
  pausePollSchedule(input: PausePollInput): Promise<void>;
  resumePollSchedule(input: ResumePollInput): Promise<ResumeResult>;
}

/** Temporal calls the poll activities need (a Temporal Client in production). Missing schedules are not errors. */
export interface PollScheduleOps {
  pause(projectId: string, note: string): Promise<void>;
  unpause(projectId: string): Promise<void>;
  remove(projectId: string): Promise<void>;
  /** Starts the one-shot resume timer; idempotent per project (a running timer is kept). */
  startResume(input: ResumePollInput & { until: string }): Promise<void>;
}

export interface PollDeps {
  db: Db;
  registry: AdapterRegistry;
  starter: WorkflowStarter;
  clock: Clock;
  config: Pick<Config, 'POLL_MAX_BACKOFF_SECONDS' | 'BOT_NAME'>;
  schedules: PollScheduleOps;
  log?: ReconcileLogger;
}

const NO_RUNNABLE_PROJECT = 'none' as const;

interface Loaded {
  project: AdapterProject & { provider: Provider; pollIntervalSeconds: number };
  cursor: typeof pollCursors.$inferSelect;
}

async function load(db: Db, input: PollInput, now: Date): Promise<Loaded | typeof NO_RUNNABLE_PROJECT> {
  return withOrg(db, input.orgId, async (tx) => {
    const rows = await tx
      .select({
        repoPath: projects.repoPath,
        defaultBranch: projects.defaultBranch,
        triggerMode: projects.triggerMode,
        pollIntervalSeconds: projects.pollIntervalSeconds,
        provider: connections.provider,
        externalId: connections.externalId,
      })
      .from(projects)
      .innerJoin(connections, eq(connections.id, projects.boardConnectionId))
      .where(eq(projects.id, input.projectId))
      .limit(1);
    const row = rows[0];
    if (!row || row.triggerMode !== 'polling') return NO_RUNNABLE_PROJECT;
    // A polling project without a cursor row starts now (same rule as switching to polling).
    await tx
      .insert(pollCursors)
      .values({ projectId: input.projectId, orgId: input.orgId, since: now })
      .onConflictDoNothing();
    const cursor = (await tx.select().from(pollCursors).where(eq(pollCursors.projectId, input.projectId)))[0];
    if (!cursor) return NO_RUNNABLE_PROJECT;
    return {
      project: {
        ...toAdapterProject(row, row.externalId),
        provider: Provider.parse(row.provider),
        pollIntervalSeconds: row.pollIntervalSeconds,
      },
      cursor,
    };
  });
}

const patchCursor = (db: Db, input: PollInput, set: Partial<typeof pollCursors.$inferInsert>) =>
  withOrg(db, input.orgId, (tx) => tx.update(pollCursors).set(set).where(eq(pollCursors.projectId, input.projectId)));

/**
 * One poll tick (spec 6.4). A project that is gone or no longer polling is a no-op that deletes its own orphaned
 * Schedule. A tick before `next_poll_at` returns at once. The cursor is persisted only after every event was
 * processed (dedupe makes a re-delivery harmless), so a failed tick re-reads the same comments next time.
 */
export async function pollOnce(deps: PollDeps, input: PollInput): Promise<PollOutcome> {
  const now = deps.clock.now();
  const loaded = await load(deps.db, input, now);
  if (loaded === NO_RUNNABLE_PROJECT) {
    try {
      await deps.schedules.remove(input.projectId);
    } catch (err) {
      deps.log?.warn('orphan poll schedule delete failed', { err: err instanceof Error ? err.name : 'unknown' });
    }
    return 'ok';
  }
  const { project, cursor } = loaded;
  if (cursor.pausedReason === 'token_revoked') return { pause: 'token_revoked' };
  if (cursor.nextPollAt && now < cursor.nextPollAt) return 'skipped';

  const healthy = { lastError: null, failures: 0, nextPollAt: null, pausedReason: null, lastPolledAt: now };
  let result: PollResult;
  try {
    result = await deps.registry
      .board(project.provider)
      .pollEvents(project, { since: (cursor.since ?? now).toISOString(), etag: cursor.etag });
  } catch {
    return backoff(deps, input, project.pollIntervalSeconds, cursor.failures, now);
  }

  switch (result.kind) {
    case 'not_modified':
      await patchCursor(deps.db, input, healthy);
      return 'not_modified';
    case 'rate_limited': {
      // The reset time comes from provider headers: reject garbage, and never park a project longer than the cap.
      const resetMs = result.resetAt.getTime();
      if (!Number.isFinite(resetMs)) return backoff(deps, input, project.pollIntervalSeconds, cursor.failures, now);
      const maxHold = Math.max(deps.config.POLL_MAX_BACKOFF_SECONDS, 3600) * 1000;
      const until = new Date(Math.min(Math.max(resetMs, now.getTime()), now.getTime() + maxHold));
      await patchCursor(deps.db, input, {
        lastPolledAt: now,
        lastError: 'rate limited by the provider',
        nextPollAt: until,
        pausedReason: 'rate_limited',
      });
      return { pause: 'rate_limited', until: until.toISOString() };
    }
    case 'revoked':
      await patchCursor(deps.db, input, {
        lastPolledAt: now,
        lastError: 'connection credentials were rejected by the provider',
        pausedReason: 'token_revoked',
      });
      return { pause: 'token_revoked' };
    case 'events': {
      const log = deps.log && {
        warn: (obj: object, msg: string) => deps.log?.warn(msg, Object.fromEntries(Object.entries(obj))),
      };
      const intake: IntakeDeps = {
        db: deps.db,
        registry: deps.registry,
        clock: deps.clock,
        botLogin: deps.config.BOT_NAME,
        ...(log ? { log } : {}),
        startRun: async (orgId, runId) => void (await startRunWorkflow(deps.starter, deps.db, orgId, runId, log)),
      };
      try {
        for (const event of result.events) await processTicketEvent(intake, event, 'poll', input);
      } catch {
        return backoff(deps, input, project.pollIntervalSeconds, cursor.failures, now);
      }
      await patchCursor(deps.db, input, {
        ...healthy,
        since: new Date(result.cursor.since),
        etag: result.cursor.etag,
      });
      return 'ok';
    }
  }
}

/** `interval * 2^failures` (counting this failure), capped at POLL_MAX_BACKOFF_SECONDS. */
async function backoff(
  deps: PollDeps,
  input: PollInput,
  intervalSeconds: number,
  failuresSoFar: number,
  now: Date,
): Promise<PollOutcome> {
  const failures = failuresSoFar + 1;
  const backoffSeconds = Math.min(intervalSeconds * 2 ** Math.min(failures, 30), deps.config.POLL_MAX_BACKOFF_SECONDS);
  await patchCursor(deps.db, input, {
    failures,
    lastPolledAt: now,
    // Generic text only: provider error messages can carry URLs or tokens.
    lastError: 'poll failed (network or provider error)',
    nextPollAt: new Date(now.getTime() + backoffSeconds * 1000),
  });
  return { backoffSeconds };
}

/** Pauses the project's Schedule; for rate limits also starts the one-shot timer that unpauses it. */
export async function pausePollSchedule(deps: PollDeps, input: PausePollInput): Promise<void> {
  await deps.schedules.pause(input.projectId, input.note);
  if (input.resumeAt) {
    await deps.schedules.startResume({ orgId: input.orgId, projectId: input.projectId, until: input.resumeAt });
  }
}

/**
 * Rate limit lifted: unpause the Schedule and clear the rate-limit pause. Re-reads the cursor first: a later rate
 * limit may have moved `next_poll_at` (sleep again), and a `token_revoked` pause or a deleted project is left alone.
 */
export async function resumePollSchedule(deps: PollDeps, input: ResumePollInput): Promise<ResumeResult> {
  const now = deps.clock.now();
  const cursor = await withOrg(deps.db, input.orgId, async (tx) => {
    const row = (await tx.select().from(pollCursors).where(eq(pollCursors.projectId, input.projectId)))[0];
    if (!row) return undefined;
    if (row.pausedReason === 'rate_limited' && row.nextPollAt && row.nextPollAt > now) return row;
    if (row.pausedReason === 'rate_limited') {
      await tx
        .update(pollCursors)
        .set({ pausedReason: null, nextPollAt: null })
        .where(eq(pollCursors.projectId, input.projectId));
    }
    return row;
  });
  if (!cursor || cursor.pausedReason === 'token_revoked') return { resumed: false };
  if (cursor.pausedReason === 'rate_limited' && cursor.nextPollAt && cursor.nextPollAt > now) {
    return { waitUntil: cursor.nextPollAt.toISOString() };
  }
  await deps.schedules.unpause(input.projectId);
  return { resumed: true };
}
