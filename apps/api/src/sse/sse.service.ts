import { Inject, Injectable, Logger, NotFoundException, type OnModuleDestroy } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { projects, runEvents, runs, withOrg, type Db } from '@agentdesk/db';
import {
  FINAL_RUN_STATUSES,
  ProjectRunEvent,
  RunEventMessage,
  RunStatus,
  type RunStatusEvent,
} from '@agentdesk/contracts';
import type { OrgContext } from '../auth/org-context';
import { CONFIG, type Config } from '../config/config.module';
import { DB } from '../db/db.module';
import { RunStatusListener, type RunSnapshot } from './run-status-listener';
import { SseWriter } from './sse-writer';

const BACKLOG_PAGE = 500;
const isFinal = (s: string): boolean => (FINAL_RUN_STATUSES as readonly string[]).includes(s);

interface RunPage {
  status: RunStatusEvent;
  events: RunEventMessage[];
}

@Injectable()
export class SseService implements OnModuleDestroy {
  private readonly log = new Logger(SseService.name);
  private readonly open = new Set<SseWriter>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(RunStatusListener) private readonly listener: RunStatusListener,
  ) {}

  openStreams(): number {
    return this.open.size;
  }

  /** Server shutdown: open streams would otherwise keep the HTTP server from closing. */
  onModuleDestroy(): void {
    for (const w of [...this.open]) w.end();
  }

  private attach(reply: FastifyReply, cleanup: () => void): SseWriter {
    const writer = new SseWriter(reply.raw);
    this.open.add(writer);
    const heartbeat = setInterval(() => writer.comment('ping'), this.config.SSE_HEARTBEAT_MS);
    heartbeat.unref();
    writer.onClose(() => {
      clearInterval(heartbeat);
      this.open.delete(writer);
      cleanup();
    });
    // Take the response out of Fastify's hands; keep headers its hooks already set (x-request-id).
    reply.hijack();
    writer.start(reply.getHeaders());
    return writer;
  }

  private async readRun(orgId: string, runId: string, after: number): Promise<RunPage | null> {
    return withOrg(this.db, orgId, async (tx) => {
      // Run row first, events second: an event batch that the row reflects is always visible to the events read, so a
      // final status can never be sent before the events that led to it.
      const run = (await tx.select().from(runs).where(eq(runs.id, runId)).limit(1))[0];
      if (!run) return null;
      const max = (
        await tx
          .select({ m: sql<number>`coalesce(max(${runEvents.seq}), 0)::int` })
          .from(runEvents)
          .where(eq(runEvents.runId, runId))
      )[0];
      const rows = await tx
        .select()
        .from(runEvents)
        .where(and(eq(runEvents.runId, runId), gt(runEvents.seq, after)))
        .orderBy(asc(runEvents.seq))
        .limit(BACKLOG_PAGE);
      return {
        status: {
          runId: run.id,
          number: run.number,
          status: RunStatus.parse(run.status),
          seq: max?.m ?? 0,
          exitCode: run.exitCode,
          failureReason: run.failureReason,
        },
        events: rows.map((e) =>
          RunEventMessage.parse({ seq: e.seq, ts: e.ts.toISOString(), type: e.type, payload: e.payload }),
        ),
      };
    });
  }

  /**
   * Subscribes first, then reads the backlog, so nothing committed in between is missed; notifications only mark the
   * stream dirty and every flush re-reads from the last sent seq, which makes duplicates impossible.
   */
  async streamRun(org: OrgContext, runId: string, after: number, reply: FastifyReply): Promise<void> {
    let dirty = false;
    let flushing = false;
    let writer: SseWriter | null = null;
    const unsubscribe = this.listener.onRun(org.orgId, runId, () => {
      dirty = true;
      if (writer && !flushing) void flush(writer);
    });
    let first: RunPage | null;
    try {
      first = await this.readRun(org.orgId, runId, after);
    } catch (err) {
      unsubscribe();
      throw err;
    }
    if (!first) {
      unsubscribe();
      throw new NotFoundException('Run not found');
    }

    let lastSeq = after;
    let lastStatusKey = '';
    let initial = true;
    let page: RunPage | null = first;

    const sendStatus = (s: RunStatusEvent): void => {
      const key = JSON.stringify([s.status, s.seq, s.exitCode, s.failureReason]);
      if (key === lastStatusKey) return;
      lastStatusKey = key;
      // No `id:` on status frames: only events advance the client's Last-Event-ID.
      w().event('status', s);
    };
    const w = (): SseWriter => {
      if (!writer) throw new Error('stream not started');
      return writer;
    };

    const step = async (): Promise<void> => {
      let cur: RunPage | null = page ?? (await this.readRun(org.orgId, runId, lastSeq));
      page = null;
      if (!cur) {
        w().end();
        return;
      }
      if (initial) {
        initial = false;
        sendStatus({ ...cur.status, seq: Math.max(cur.status.seq, lastSeq) });
      }
      for (;;) {
        for (const e of cur.events) {
          w().event('event', e, e.seq);
          lastSeq = e.seq;
        }
        await w().drained();
        if (w().closed || cur.events.length < BACKLOG_PAGE) break;
        const next: RunPage | null = await this.readRun(org.orgId, runId, lastSeq);
        if (!next) {
          w().end();
          return;
        }
        cur = next;
      }
      if (w().closed) return;
      sendStatus({ ...cur.status, seq: Math.max(cur.status.seq, lastSeq) });
      if (isFinal(cur.status.status)) w().end();
    };

    const flush = async (wr: SseWriter): Promise<void> => {
      flushing = true;
      try {
        do {
          dirty = false;
          await step();
        } while (dirty && !wr.closed);
      } catch (err) {
        this.log.warn(`run stream failed: ${err instanceof Error ? err.message : 'unknown'}`);
        wr.end();
      } finally {
        flushing = false;
      }
    };

    writer = this.attach(reply, unsubscribe);
    await flush(writer);
  }

  async streamProject(org: OrgContext, projectId: string, reply: FastifyReply): Promise<void> {
    let writer: SseWriter | null = null;
    const unsubscribe = this.listener.onProject(org.orgId, projectId, (s: RunSnapshot) => {
      writer?.event('run', ProjectRunEvent.parse({ runId: s.runId, number: s.number, status: s.status, seq: s.seq }));
    });
    try {
      const exists = await withOrg(this.db, org.orgId, (tx) =>
        tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1),
      );
      if (!exists[0]) throw new NotFoundException('Project not found');
    } catch (err) {
      unsubscribe();
      throw err;
    }
    writer = this.attach(reply, unsubscribe);
  }
}
