import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ApplicationFailure, WorkflowNotFoundError, WorkflowUpdateFailedError, type Client } from '@temporalio/client';
import { and, asc, desc, eq, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  agents,
  inboundEvents,
  projects,
  runEvents,
  runTranscriptEntries,
  runs,
  withOrg,
  type Db,
  type Tx,
} from '@agentdesk/db';
import {
  ACTIVE_RUN_STATUSES,
  AGENT_IDLE_END_SECONDS_DEFAULT,
  AGENT_PAUSED_KEEP_SECONDS_DEFAULT,
  AGENT_TIMEOUT_SECONDS_DEFAULT,
  FINAL_RUN_STATUSES,
  FINISHABLE_RUN_STATUSES,
  FailureStage,
  RunStatus,
  STOPPABLE_RUN_STATUSES,
  TicketKind,
  TranscriptKind,
  TriggerSource,
  PauseReason,
  WaitingOn,
  canResume,
  pageWindow,
  toPage,
  type IgnoredEventDto,
  type LinkedTicketDto,
  type Page,
  type PageQuery,
  type RunDto,
  type RunListItem,
  type RunUsageDetail,
  type RunListQuery,
  type RunListFilter,
  type RunListResponse,
  type RunLogResponse,
  type RunTranscriptQuery,
  type RunTranscriptResponse,
  type RunStatsDto,
} from '@agentdesk/contracts';
import { SIGNAL, TASK_QUEUE, UPDATE, WORKFLOW, runWorkflowId, toUsageSummary } from '@agentdesk/core';
import type { OrgContext } from '../auth/org-context';
import { DB } from '../db/db.module';
import { TEMPORAL_CLIENT } from '../temporal/temporal-client.module';
import { assembleLinkedTickets, newestLinks, newestSnapshots } from './linked-tickets';
import { runSearchCondition } from './run-search';
import { usageFor } from './run-usage';

/** The log endpoint has no pagination in the contract: it returns at most the newest LOG_CAP events, oldest first. */
export const LOG_CAP = 5000;

const isFinal = (status: string): boolean => (FINAL_RUN_STATUSES as readonly string[]).includes(status);

/** Why Cancel, Stop and Finish are refused while a succeeded run's session is reopened (its result is fixed, ADR 0032). */
const REOPENED_ONLY_CLOSE = 'This session is reopened; the run has already succeeded. Close the session instead';

type RunRow = typeof runs.$inferSelect;
interface AgentInfo {
  name: string;
  model: string;
  timeoutSeconds: number;
  idleEndSeconds: number;
  pausedKeepSeconds: number;
}

@Injectable()
export class RunsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TEMPORAL_CLIENT) private readonly temporal: Client,
  ) {}

  private toDto(row: RunRow, agent: AgentInfo | undefined, usage: RunUsageDetail | null): RunDto {
    return { ...this.toBase(row, agent), prompt: row.prompt, finalPrompt: row.finalPrompt, usage };
  }

  /** The run without its prompt texts, and with the list-only ticket count and linked tickets. */
  private toListItem(
    row: RunRow,
    agent: AgentInfo | undefined,
    ticketRunCount: number,
    usage: RunUsageDetail | null,
    linkedTickets: LinkedTicketDto[] = [],
  ): RunListItem {
    return {
      ...this.toBase(row, agent),
      usage: usage === null ? null : toUsageSummary(usage),
      ticketRunCount,
      linkedTickets,
    };
  }

  private toBase(
    row: RunRow,
    agent: AgentInfo | undefined,
  ): Omit<RunListItem, 'ticketRunCount' | 'linkedTickets' | 'usage'> {
    return {
      id: row.id,
      number: row.number,
      projectId: row.projectId,
      ruleId: row.ruleId,
      command: row.command,
      ruleKind: row.prompt !== null ? 'prompt' : 'skill',
      skillName: row.skillName,
      // The agent row can be gone (agent_id is ON DELETE SET NULL); the DTO still needs a shape.
      agent: { name: agent?.name ?? '(deleted agent)', model: row.model ?? agent?.model ?? 'unknown' },
      ticket: {
        ref: row.ticketRef,
        kind: TicketKind.parse(row.ticketKind),
        number: row.ticketNumber ?? 0,
        title: row.ticketTitle ?? '',
        url: row.ticketUrl ?? '',
        labels: row.ticketLabels,
      },
      args: row.args,
      status: RunStatus.parse(row.status),
      triggerSource: TriggerSource.parse(row.triggerSource),
      triggeredBy: row.triggeredBy,
      ownerUserId: row.ownerUserId,
      queuedAt: row.queuedAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      exitCode: row.exitCode,
      failureReason: row.failureReason,
      failureStage: row.failureStage === null ? null : FailureStage.parse(row.failureStage),
      setupScriptVersion: row.setupScriptVersion,
      costUsd: row.costUsd === null ? null : Number(row.costUsd),
      timeoutSeconds: agent?.timeoutSeconds ?? AGENT_TIMEOUT_SECONDS_DEFAULT,
      idleEndSeconds: agent?.idleEndSeconds ?? AGENT_IDLE_END_SECONDS_DEFAULT,
      pausedKeepSeconds: agent?.pausedKeepSeconds ?? AGENT_PAUSED_KEEP_SECONDS_DEFAULT,
      idleSince: row.idleSince?.toISOString() ?? null,
      waitingOn: row.waitingOn === null ? null : WaitingOn.parse(row.waitingOn),
      agentNote: row.agentNote,
      pausedAt: row.pausedAt?.toISOString() ?? null,
      sessionExpiresAt: row.sessionExpiresAt?.toISOString() ?? null,
      sessionEndingAt: row.sessionEndingAt?.toISOString() ?? null,
      pauseReason: row.pauseReason === null ? null : PauseReason.parse(row.pauseReason),
      reopenedAt: row.reopenedAt?.toISOString() ?? null,
    };
  }

  private async agentsFor(tx: Tx, rows: RunRow[]): Promise<Map<string, AgentInfo>> {
    const out = new Map<string, AgentInfo>();
    const ids = [...new Set(rows.flatMap((r) => (r.agentId === null ? [] : [r.agentId])))];
    if (ids.length === 0) return out;
    const found = await tx
      .select({
        id: agents.id,
        name: agents.name,
        model: agents.model,
        timeoutSeconds: agents.timeoutSeconds,
        idleEndSeconds: agents.idleEndSeconds,
        pausedKeepSeconds: agents.pausedKeepSeconds,
      })
      .from(agents)
      .where(inArray(agents.id, ids));
    for (const a of found) out.set(a.id, a);
    return out;
  }

  private async dto(tx: Tx, row: RunRow): Promise<RunDto> {
    const agent = row.agentId === null ? undefined : (await this.agentsFor(tx, [row])).get(row.agentId);
    return this.toDto(row, agent, (await usageFor(tx, [row.id])).get(row.id) ?? null);
  }

  /** Runs each ticket has had in the project, all statuses: one grouped query for the tickets on the page. */
  private async ticketRunCountsFor(tx: Tx, projectId: string, refs: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const unique = [...new Set(refs)];
    if (unique.length === 0) return out;
    const found = await tx
      .select({ ref: runs.ticketRef, n: sql<number>`count(*)::int` })
      .from(runs)
      .where(and(eq(runs.projectId, projectId), inArray(runs.ticketRef, unique)))
      .groupBy(runs.ticketRef);
    for (const f of found) out.set(f.ref, f.n);
    return out;
  }

  private async listItems(tx: Tx, projectId: string, rows: RunRow[]): Promise<RunListItem[]> {
    const ag = await this.agentsFor(tx, rows);
    const links = await newestLinks(
      tx,
      projectId,
      rows.filter((r) => r.ticketKind === 'pr').map((r) => r.ticketRef),
      rows.filter((r) => r.ticketKind !== 'pr').map((r) => r.ticketRef),
    );
    const linkedRefs = links.flatMap((l) => [l.ref, ...l.refs]);
    const counts = await this.ticketRunCountsFor(tx, projectId, [...rows.map((r) => r.ticketRef), ...linkedRefs]);
    const snapshots = await newestSnapshots(tx, projectId, linkedRefs);
    const linked = assembleLinkedTickets(rows, links, counts, snapshots);
    const usage = await usageFor(
      tx,
      rows.map((r) => r.id),
    );
    return rows.map((r) =>
      this.toListItem(
        r,
        r.agentId === null ? undefined : ag.get(r.agentId),
        counts.get(r.ticketRef) ?? 1,
        usage.get(r.id) ?? null,
        linked.get(r.id) ?? [],
      ),
    );
  }

  /** The status condition of a run list filter; `all` and no filter have none. */
  private statusIn(filter: RunListFilter | undefined): SQL | undefined {
    switch (filter) {
      case 'needs_you':
        return inArray(runs.status, ['idle', 'paused']);
      case 'active':
        return inArray(runs.status, [...ACTIVE_RUN_STATUSES]);
      case 'queued':
        return eq(runs.status, 'queued');
      case 'ended':
        return inArray(runs.status, [...FINAL_RUN_STATUSES]);
      default:
        return undefined;
    }
  }

  private async requireProject(tx: Tx, projectId: string): Promise<void> {
    const p = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!p[0]) throw new NotFoundException('Project not found');
  }

  private async loadRun(tx: Tx, runId: string): Promise<RunRow> {
    const row = (await tx.select().from(runs).where(eq(runs.id, runId)).limit(1))[0];
    if (!row) throw new NotFoundException('Run not found');
    return row;
  }

  async list(org: OrgContext, projectId: string, q: RunListQuery): Promise<RunListResponse> {
    return withOrg(this.db, org.orgId, async (tx) => {
      await this.requireProject(tx, projectId);
      const where = and(
        eq(runs.projectId, projectId),
        this.statusIn(q.filter),
        q.ticket === undefined ? undefined : eq(runs.ticketRef, q.ticket),
        runSearchCondition(projectId, q.q),
      );
      const { limit, offset } = pageWindow(q);
      const [counted] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(runs)
        .where(where);
      const rows = await tx
        .select()
        .from(runs)
        .where(where)
        .orderBy(desc(runs.queuedAt), asc(runs.id))
        .limit(limit)
        .offset(offset);
      return toPage(await this.listItems(tx, projectId, rows), counted?.total ?? 0, q);
    });
  }

  /** The Run list's numbers in one transaction: chip counts, today's runs, the idle run and the next queued number. */
  async stats(org: OrgContext, projectId: string, since: string): Promise<RunStatsDto> {
    const sinceDate = new Date(since);
    return withOrg(this.db, org.orgId, async (tx) => {
      await this.requireProject(tx, projectId);
      const inStatuses = (statuses: readonly string[]) =>
        sql`${runs.status} in (${sql.join(
          statuses.map((x) => sql`${x}`),
          sql`, `,
        )})`;
      const [c] = await tx
        .select({
          needsYou: sql<number>`(count(*) filter (where ${inStatuses(['idle', 'paused'])}))::int`,
          active: sql<number>`(count(*) filter (where ${inStatuses(ACTIVE_RUN_STATUSES)}))::int`,
          queued: sql<number>`(count(*) filter (where ${runs.status} = 'queued'))::int`,
          ended: sql<number>`(count(*) filter (where ${inStatuses(FINAL_RUN_STATUSES)}))::int`,
          all: sql<number>`count(*)::int`,
          todayTotal: sql<number>`(count(*) filter (where ${runs.queuedAt} >= ${sinceDate}))::int`,
          todayFailed: sql<number>`(count(*) filter (where ${runs.queuedAt} >= ${sinceDate} and ${runs.status} = 'failed'))::int`,
        })
        .from(runs)
        .where(eq(runs.projectId, projectId));
      const [ign] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(inboundEvents)
        .where(and(eq(inboundEvents.projectId, projectId), sql`starts_with(${inboundEvents.outcome}, 'ignored_')`));
      const idleRow = (
        await tx
          .select()
          .from(runs)
          .where(and(eq(runs.projectId, projectId), eq(runs.status, 'idle')))
          .orderBy(desc(runs.queuedAt), asc(runs.id))
          .limit(1)
      )[0];
      const queuedRow = (
        await tx
          .select({ number: runs.number })
          .from(runs)
          .where(and(eq(runs.projectId, projectId), eq(runs.status, 'queued')))
          .orderBy(asc(runs.queuedAt), desc(runs.id))
          .limit(1)
      )[0];
      const idleRun = idleRow ? ((await this.listItems(tx, projectId, [idleRow]))[0] ?? null) : null;
      return {
        counts: {
          needs_you: c?.needsYou ?? 0,
          active: c?.active ?? 0,
          queued: c?.queued ?? 0,
          ended: c?.ended ?? 0,
          all: c?.all ?? 0,
          ignored: ign?.n ?? 0,
        },
        today: { total: c?.todayTotal ?? 0, failed: c?.todayFailed ?? 0 },
        idleRun,
        nextQueuedNumber: queuedRow?.number ?? null,
      };
    });
  }

  async byNumber(org: OrgContext, projectId: string, number: number): Promise<RunDto> {
    return withOrg(this.db, org.orgId, async (tx) => {
      await this.requireProject(tx, projectId);
      const row = (
        await tx
          .select()
          .from(runs)
          .where(and(eq(runs.projectId, projectId), eq(runs.number, number)))
          .limit(1)
      )[0];
      if (!row) throw new NotFoundException('Run not found');
      return this.dto(tx, row);
    });
  }

  async get(org: OrgContext, runId: string): Promise<RunDto> {
    return withOrg(this.db, org.orgId, async (tx) => {
      const row = await this.loadRun(tx, runId);
      return this.dto(tx, row);
    });
  }

  async log(org: OrgContext, runId: string): Promise<RunLogResponse> {
    return withOrg(this.db, org.orgId, async (tx) => {
      await this.loadRun(tx, runId);
      const rows = await tx
        .select()
        .from(runEvents)
        .where(eq(runEvents.runId, runId))
        .orderBy(desc(runEvents.seq))
        .limit(LOG_CAP);
      rows.reverse();
      return {
        items: rows.map((e) => ({
          seq: e.seq,
          ts: e.ts.toISOString(),
          type: z.enum(['lifecycle', 'status', 'scrollback', 'comment']).parse(e.type),
          payload: e.payload,
        })),
      };
    });
  }

  /** The saved transcript, newest page first by `seq desc` and returned oldest first; `nextBefore` pages further back. */
  async transcript(org: OrgContext, runId: string, q: RunTranscriptQuery): Promise<RunTranscriptResponse> {
    return withOrg(this.db, org.orgId, async (tx) => {
      await this.loadRun(tx, runId);
      const where =
        q.before === undefined
          ? eq(runTranscriptEntries.runId, runId)
          : and(eq(runTranscriptEntries.runId, runId), lt(runTranscriptEntries.seq, q.before));
      const rows = await tx
        .select()
        .from(runTranscriptEntries)
        .where(where)
        .orderBy(desc(runTranscriptEntries.seq))
        .limit(q.limit + 1);
      const more = rows.length > q.limit;
      if (more) rows.pop();
      const nextBefore = more ? (rows.at(-1)?.seq ?? null) : null;
      rows.reverse();
      return {
        items: rows.map((e) => ({
          seq: e.seq,
          at: e.at.toISOString(),
          kind: TranscriptKind.parse(e.kind),
          tool: e.tool,
          text: e.text,
          truncated: e.truncated,
        })),
        nextBefore,
      };
    });
  }

  /**
   * Cancel is a signal to the run's workflow; the API never writes runs.status. A queued run whose workflow has not
   * been started yet (outbox not swept) gets signalWithStart, so the workflow itself performs the cancellation.
   */
  async cancel(org: OrgContext, runId: string): Promise<void> {
    const run = await withOrg(this.db, org.orgId, (tx) => this.loadRun(tx, runId));
    if (run.reopenedAt !== null) throw new ConflictException(REOPENED_ONLY_CLOSE);
    if (isFinal(run.status)) throw new ConflictException(`Run already ${run.status}`);
    const workflowId = runWorkflowId(run.id);
    if (run.status === 'queued' && run.workflowId === null) {
      await this.temporal.workflow.signalWithStart(WORKFLOW.run, {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [{ orgId: run.orgId, runId: run.id }],
        signal: SIGNAL.cancel,
        signalArgs: [],
      });
      return;
    }
    await this.signal(workflowId, SIGNAL.cancel);
  }

  /**
   * Stop session is a workflow update too: the workflow's validator decides and its answer is what the caller gets. The
   * DB status and `sessionEndingAt` are only a cheap pre-check. The run stays live until the workflow parks it.
   */
  async stop(org: OrgContext, runId: string): Promise<void> {
    const run = await withOrg(this.db, org.orgId, (tx) => this.loadRun(tx, runId));
    if (run.reopenedAt !== null) throw new ConflictException(REOPENED_ONLY_CLOSE);
    if (run.sessionEndingAt !== null) throw new ConflictException('The session is already ending');
    if (!(STOPPABLE_RUN_STATUSES as readonly string[]).includes(run.status))
      throw new ConflictException('Only a live session can be stopped');
    try {
      await this.temporal.workflow.getHandle(runWorkflowId(run.id)).executeUpdate(UPDATE.stopSession);
    } catch (err) {
      if (err instanceof WorkflowNotFoundError) throw new ConflictException('Run is no longer active');
      if (
        err instanceof WorkflowUpdateFailedError &&
        err.cause instanceof ApplicationFailure &&
        err.cause.type === 'NotStoppable'
      )
        throw new ConflictException(err.cause.message);
      // The server fails an accepted update when the workflow completes before the handler returns.
      if (
        err instanceof WorkflowUpdateFailedError &&
        err.cause instanceof ApplicationFailure &&
        err.cause.type === 'AcceptedUpdateCompletedWorkflow'
      )
        throw new ConflictException('Run is no longer active');
      throw err;
    }
  }

  /**
   * Finish is a workflow update: the workflow's own validator decides, and its answer is what the caller gets. The DB
   * status is only a cheap pre-check; the workflow phase is authoritative.
   */
  async finish(org: OrgContext, runId: string): Promise<void> {
    const run = await withOrg(this.db, org.orgId, (tx) => this.loadRun(tx, runId));
    if (run.reopenedAt !== null) throw new ConflictException(REOPENED_ONLY_CLOSE);
    if (!(FINISHABLE_RUN_STATUSES as readonly string[]).includes(run.status))
      throw new ConflictException(`Only a run that needs you or is done can be finished (status is ${run.status})`);
    try {
      await this.temporal.workflow.getHandle(runWorkflowId(run.id)).executeUpdate(UPDATE.finishRun);
    } catch (err) {
      if (err instanceof WorkflowNotFoundError) throw new ConflictException('Run is no longer active');
      if (
        err instanceof WorkflowUpdateFailedError &&
        err.cause instanceof ApplicationFailure &&
        err.cause.type === 'NotFinishable'
      )
        throw new ConflictException(err.cause.message);
      // The server fails an accepted update when the workflow completes before the handler returns.
      if (
        err instanceof WorkflowUpdateFailedError &&
        err.cause instanceof ApplicationFailure &&
        err.cause.type === 'AcceptedUpdateCompletedWorkflow'
      )
        throw new ConflictException('Run is no longer active');
      throw err;
    }
  }

  /**
   * Close session ends a reopened session: the workflow ends the pod and the run returns to succeeded with its disk kept
   * for a fresh keep time (ADR 0032). It is the same workflow update as Finish; the run row says which one applies, so
   * only a reopened run can be closed and a reopened run cannot be finished.
   */
  async closeSession(org: OrgContext, runId: string): Promise<void> {
    const run = await withOrg(this.db, org.orgId, (tx) => this.loadRun(tx, runId));
    if (run.reopenedAt === null) throw new ConflictException('Only a reopened session can be closed');
    try {
      await this.temporal.workflow.getHandle(runWorkflowId(run.id)).executeUpdate(UPDATE.finishRun);
    } catch (err) {
      if (err instanceof WorkflowNotFoundError) throw new ConflictException('Run is no longer active');
      if (
        err instanceof WorkflowUpdateFailedError &&
        err.cause instanceof ApplicationFailure &&
        err.cause.type === 'NotFinishable'
      )
        throw new ConflictException(err.cause.message);
      if (
        err instanceof WorkflowUpdateFailedError &&
        err.cause instanceof ApplicationFailure &&
        err.cause.type === 'AcceptedUpdateCompletedWorkflow'
      )
        throw new ConflictException('Run is no longer active');
      throw err;
    }
  }

  /**
   * Resume is a workflow update that is accepted at once (the pod starts afterwards). The DB status and the agent row
   * are cheap pre-checks; the workflow's own validator decides, so a second press while resuming is a 409.
   */
  async resume(org: OrgContext, runId: string): Promise<void> {
    const run = await withOrg(this.db, org.orgId, (tx) => this.loadRun(tx, runId));
    if (
      !canResume(
        {
          status: RunStatus.parse(run.status),
          sessionExpiresAt: run.sessionExpiresAt?.toISOString() ?? null,
          sessionEndingAt: run.sessionEndingAt?.toISOString() ?? null,
          reopenedAt: run.reopenedAt?.toISOString() ?? null,
        },
        new Date(),
      )
    )
      throw new ConflictException('Only a paused run, or a finished run whose session is still kept, can be resumed');
    const agentId = run.agentId;
    const agent =
      agentId === null
        ? undefined
        : (
            await withOrg(this.db, org.orgId, (tx) =>
              tx
                .select({ credentialSecretName: agents.credentialSecretName })
                .from(agents)
                .where(eq(agents.id, agentId))
                .limit(1),
            )
          )[0];
    if (!agent || agent.credentialSecretName === null)
      throw new ConflictException('This project has no agent credential, so the run cannot be resumed');
    try {
      await this.temporal.workflow.getHandle(runWorkflowId(run.id)).executeUpdate(UPDATE.resumeRun);
    } catch (err) {
      if (err instanceof WorkflowNotFoundError) throw new ConflictException('Run is no longer active');
      if (
        err instanceof WorkflowUpdateFailedError &&
        err.cause instanceof ApplicationFailure &&
        err.cause.type === 'NotResumable'
      )
        throw new ConflictException(err.cause.message);
      if (
        err instanceof WorkflowUpdateFailedError &&
        err.cause instanceof ApplicationFailure &&
        err.cause.type === 'AcceptedUpdateCompletedWorkflow'
      )
        throw new ConflictException('Run is no longer active');
      throw err;
    }
  }

  private async signal(workflowId: string, name: string): Promise<void> {
    try {
      await this.temporal.workflow.getHandle(workflowId).signal(name);
    } catch (err) {
      // The run changed state under us (its workflow completed): report it as a conflict, not a server error.
      if (err instanceof WorkflowNotFoundError) throw new ConflictException('Run is no longer active');
      throw err;
    }
  }

  async ignored(org: OrgContext, projectId: string, q: PageQuery): Promise<Page<IgnoredEventDto>> {
    return withOrg(this.db, org.orgId, async (tx) => {
      await this.requireProject(tx, projectId);
      const where = and(eq(inboundEvents.projectId, projectId), sql`starts_with(${inboundEvents.outcome}, 'ignored_')`);
      const { limit, offset } = pageWindow(q);
      const [counted] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(inboundEvents)
        .where(where);
      const rows = await tx
        .select()
        .from(inboundEvents)
        .where(where)
        .orderBy(desc(inboundEvents.receivedAt), asc(inboundEvents.id))
        .limit(limit)
        .offset(offset);
      const items = rows.map((r) => ({
        id: r.id,
        receivedAt: r.receivedAt.toISOString(),
        ticketRef: r.ticketRef,
        // inbound_events does not store the ticket kind.
        ticketKind: null,
        command: r.command,
        author: r.author,
        outcome: r.outcome,
        detail: r.detail,
      }));
      return toPage(items, counted?.total ?? 0, q);
    });
  }
}
