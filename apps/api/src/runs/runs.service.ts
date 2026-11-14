import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { WorkflowNotFoundError, type Client } from '@temporalio/client';
import { and, asc, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { agents, inboundEvents, projects, runEvents, runs, withOrg, type Db, type Tx } from '@agentdesk/db';
import {
  ACTIVE_RUN_STATUSES,
  FINAL_RUN_STATUSES,
  FailureStage,
  RunStatus,
  TicketKind,
  TriggerSource,
  type IgnoredEventDto,
  type RunDto,
  type RunListQuery,
  type RunListResponse,
  type RunLogResponse,
} from '@agentdesk/contracts';
import { SIGNAL, TASK_QUEUE, WORKFLOW, runWorkflowId } from '@agentdesk/core';
import type { OrgContext } from '../auth/org-context';
import { ValidationProblemException } from '../common/zod-validation';
import { DB } from '../db/db.module';
import { TEMPORAL_CLIENT } from '../temporal/temporal-client.module';

/** The log endpoint has no pagination in the contract: it returns at most the newest LOG_CAP events, oldest first. */
export const LOG_CAP = 5000;
export const IGNORED_LIMIT = 100;

const TS_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/** The shape check plus a real calendar/clock check (month 1-12, valid day for month/year, hh<24, mm/ss<60). */
function isRealTimestamp(t: string): boolean {
  if (!TS_ISO.test(t)) return false;
  const [y, mo, d, h, mi, sec] = t.split(/[-T:.Z]/).map(Number);
  if (
    y === undefined ||
    mo === undefined ||
    d === undefined ||
    h === undefined ||
    mi === undefined ||
    sec === undefined
  )
    return false;
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return (
    mo >= 1 &&
    mo <= 12 &&
    d >= 1 &&
    d <= daysInMonth &&
    h < 24 &&
    mi < 60 &&
    sec < 60 &&
    !Number.isNaN(Date.parse(t.slice(0, 23) + 'Z'))
  );
}
const Cursor = z.object({ t: z.string().refine(isRealTimestamp), i: z.uuid() });
type Cursor = z.infer<typeof Cursor>;

/** Microsecond-exact timestamp text (a JS Date would truncate to milliseconds and break tie-breaking). */
const QUEUED_AT_TEXT = sql<string>`to_char(${runs.queuedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): Cursor {
  const bad = () => new ValidationProblemException([{ pointer: '/cursor', detail: 'malformed cursor' }]);
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw bad();
  try {
    const parsed = Cursor.safeParse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
    if (!parsed.success) throw bad();
    return parsed.data;
  } catch {
    throw bad();
  }
}

function isPgCode(err: unknown, codes: string[]): boolean {
  for (let e: unknown = err, depth = 0; typeof e === 'object' && e !== null && depth < 4; depth += 1) {
    if ('code' in e && typeof e.code === 'string' && codes.includes(e.code)) return true;
    e = 'cause' in e ? e.cause : undefined;
  }
  return false;
}

const isFinal = (status: string): boolean => (FINAL_RUN_STATUSES as readonly string[]).includes(status);

type RunRow = typeof runs.$inferSelect;
interface AgentInfo {
  name: string;
  model: string;
  timeoutSeconds: number;
}

@Injectable()
export class RunsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TEMPORAL_CLIENT) private readonly temporal: Client,
  ) {}

  private toDto(row: RunRow, agent: AgentInfo | undefined): RunDto {
    return {
      id: row.id,
      number: row.number,
      projectId: row.projectId,
      ruleId: row.ruleId,
      command: row.command,
      skillName: row.skillName,
      // The agent row can be gone (agent_id is ON DELETE SET NULL); the DTO still needs a shape.
      agent: { name: agent?.name ?? '(deleted agent)', model: agent?.model ?? 'unknown' },
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
      queuedAt: row.queuedAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      exitCode: row.exitCode,
      failureReason: row.failureReason,
      failureStage: row.failureStage === null ? null : FailureStage.parse(row.failureStage),
      setupScriptVersion: row.setupScriptVersion,
      costUsd: row.costUsd === null ? null : Number(row.costUsd),
      timeoutSeconds: agent?.timeoutSeconds ?? 1800,
      idleSince: row.idleSince?.toISOString() ?? null,
      // TODO(task 3): read from the new runs columns once the migration lands.
      waitingOn: null,
      agentNote: null,
    };
  }

  private async agentsFor(tx: Tx, rows: RunRow[]): Promise<Map<string, AgentInfo>> {
    const out = new Map<string, AgentInfo>();
    const ids = [...new Set(rows.flatMap((r) => (r.agentId === null ? [] : [r.agentId])))];
    if (ids.length === 0) return out;
    const found = await tx
      .select({ id: agents.id, name: agents.name, model: agents.model, timeoutSeconds: agents.timeoutSeconds })
      .from(agents)
      .where(inArray(agents.id, ids));
    for (const a of found) out.set(a.id, a);
    return out;
  }

  private async dto(tx: Tx, row: RunRow): Promise<RunDto> {
    return this.toDto(row, row.agentId === null ? undefined : (await this.agentsFor(tx, [row])).get(row.agentId));
  }

  private async dtos(tx: Tx, rows: RunRow[]): Promise<RunDto[]> {
    const ag = await this.agentsFor(tx, rows);
    return rows.map((r) => this.toDto(r, r.agentId === null ? undefined : ag.get(r.agentId)));
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
    const cursor = q.cursor === undefined ? undefined : decodeCursor(q.cursor);
    try {
      return await this.listPage(org, projectId, q, cursor);
    } catch (err) {
      // Defence in depth: a timestamp Postgres rejects (22007 invalid format, 22008 out of range) is a bad cursor.
      if (cursor && isPgCode(err, ['22007', '22008'])) {
        throw new ValidationProblemException([{ pointer: '/cursor', detail: 'malformed cursor' }]);
      }
      throw err;
    }
  }

  private async listPage(org: OrgContext, projectId: string, q: RunListQuery, cursor: Cursor | undefined) {
    return withOrg(this.db, org.orgId, async (tx) => {
      await this.requireProject(tx, projectId);
      const conds: (SQL | undefined)[] = [eq(runs.projectId, projectId)];
      switch (q.filter) {
        case 'needs_you':
          conds.push(eq(runs.status, 'idle'));
          break;
        case 'active':
          conds.push(inArray(runs.status, [...ACTIVE_RUN_STATUSES]));
          break;
        case 'queued':
          conds.push(eq(runs.status, 'queued'));
          break;
        case 'ended':
          conds.push(inArray(runs.status, [...FINAL_RUN_STATUSES]));
          break;
        default:
          break;
      }
      if (q.ticket !== undefined) conds.push(eq(runs.ticketRef, q.ticket));
      if (cursor) {
        const t = sql`${cursor.t}::timestamptz`;
        conds.push(or(sql`${runs.queuedAt} < ${t}`, and(sql`${runs.queuedAt} = ${t}`, sql`${runs.id} > ${cursor.i}`)));
      }
      const rows = await tx
        .select({ run: runs, queuedAtText: QUEUED_AT_TEXT })
        .from(runs)
        .where(and(...conds))
        .orderBy(desc(runs.queuedAt), asc(runs.id))
        .limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const last = page[page.length - 1];
      const nextCursor = rows.length > q.limit && last ? encodeCursor({ t: last.queuedAtText, i: last.run.id }) : null;
      return {
        items: await this.dtos(
          tx,
          page.map((r) => r.run),
        ),
        nextCursor,
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

  /**
   * Cancel is a signal to the run's workflow; the API never writes runs.status. A queued run whose workflow has not
   * been started yet (outbox not swept) gets signalWithStart, so the workflow itself performs the cancellation.
   */
  async cancel(org: OrgContext, runId: string): Promise<void> {
    const run = await withOrg(this.db, org.orgId, (tx) => this.loadRun(tx, runId));
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

  async finish(org: OrgContext, runId: string): Promise<void> {
    const run = await withOrg(this.db, org.orgId, (tx) => this.loadRun(tx, runId));
    if (run.status !== 'idle')
      throw new ConflictException(`Only an idle run can be finished (status is ${run.status})`);
    await this.signal(runWorkflowId(run.id), SIGNAL.finish);
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

  async ignored(org: OrgContext, projectId: string): Promise<IgnoredEventDto[]> {
    return withOrg(this.db, org.orgId, async (tx) => {
      await this.requireProject(tx, projectId);
      const rows = await tx
        .select()
        .from(inboundEvents)
        .where(and(eq(inboundEvents.projectId, projectId), sql`starts_with(${inboundEvents.outcome}, 'ignored_')`))
        .orderBy(desc(inboundEvents.receivedAt), asc(inboundEvents.id))
        .limit(IGNORED_LIMIT);
      return rows.map((r) => ({
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
    });
  }
}
