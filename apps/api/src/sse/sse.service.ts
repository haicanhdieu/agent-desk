import { Inject, Injectable, Logger, NotFoundException, type OnModuleDestroy } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { and, asc, eq, gt, inArray, notInArray, or, sql } from 'drizzle-orm';
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
import { RunStatusListener } from './run-status-listener';
import { SseWriter } from './sse-writer';

const BACKLOG_PAGE = 500;
const RESYNC_LIMIT = 200;

/** Test seam. */
export interface SseHooks {
  /** Awaited after the first run read, before the response is started. */
  afterFirstRead?: (runId: string) => Promise<void>;
}
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
  ) {
    this.drainTimeoutMs = config.SSE_DRAIN_TIMEOUT_MS;
  }

  openStreams(): number {
    return this.open.size;
  }

  /** Server shutdown: open streams would otherwise keep the HTTP server from closing. */
  onModuleDestroy(): void {
    for (const w of [...this.open]) w.shutdown();
  }

  hooks: SseHooks = {};
  /** Test seam: initialised from SSE_DRAIN_TIMEOUT_MS. */
  drainTimeoutMs: number;

  /**
   * Registers the writer before any await, so a socket that closes while we are still reading is cleaned up (subscriber
   * and registry entry); the response is not touched until `begin`.
   */
  private track(reply: FastifyReply, unsubscribe: () => void): SseWriter {
    const writer = new SseWriter(reply.raw, this.drainTimeoutMs);
    this.open.add(writer);
    writer.onClose(() => {
      this.open.delete(writer);
      unsubscribe();
    });
    return writer;
  }

  /** Takes the response out of Fastify's hands (keeping headers its hooks set, like x-request-id) and starts SSE. */
  private begin(reply: FastifyReply, writer: SseWriter): boolean {
    try {
      reply.hijack();
      if (writer.closed) return false;
      writer.start(reply.getHeaders());
      writer.startHeartbeat(this.config.SSE_HEARTBEAT_MS);
      return true;
    } catch (err) {
      this.log.warn(`could not start stream: ${err instanceof Error ? err.message : 'unknown'}`);
      writer.release();
      return false;
    }
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
   * Subscribes first, then reads the backlog, so nothing committed in between is missed. A notification only bumps a
   * generation counter; every flush re-reads from the last sent seq and repeats while the counter moved during it, so a
   * wake-up can neither be lost (even one that lands before the first flush) nor cause duplicates.
   */
  async streamRun(org: OrgContext, runId: string, after: number, reply: FastifyReply): Promise<void> {
    let gen = 0;
    let started = false;
    let flushing = false;
    const writer = this.track(
      reply,
      this.listener.onRun(org.orgId, runId, () => {
        gen += 1;
        if (started && !flushing) void flush();
      }),
    );
    let page: RunPage | null;
    const pageGen = gen;
    try {
      page = await this.readRun(org.orgId, runId, after);
      if (!page) throw new NotFoundException('Run not found');
      await this.hooks.afterFirstRead?.(runId);
    } catch (err) {
      writer.release();
      throw err;
    }
    if (writer.closed) {
      this.begin(reply, writer);
      return;
    }

    let lastSeq = after;
    let lastStatusKey = '';
    let initial = true;

    const sendStatus = (s: RunStatusEvent): void => {
      const key = JSON.stringify([s.status, s.seq, s.exitCode, s.failureReason]);
      if (key === lastStatusKey) return;
      lastStatusKey = key;
      // No `id:` on status frames: only events advance the client's Last-Event-ID.
      writer.event('status', s);
    };

    const step = async (): Promise<void> => {
      let cur: RunPage | null = page ?? (await this.readRun(org.orgId, runId, lastSeq));
      page = null;
      if (!cur) {
        writer.end();
        return;
      }
      if (initial) {
        initial = false;
        sendStatus({ ...cur.status, seq: Math.max(cur.status.seq, lastSeq) });
      }
      for (;;) {
        for (const e of cur.events) {
          writer.event('event', e, e.seq);
          lastSeq = e.seq;
          // Per event, so a big backlog can never outrun a slow reader past the buffer cap.
          await writer.drained();
          if (writer.closed) return;
        }
        if (cur.events.length < BACKLOG_PAGE) break;
        const next: RunPage | null = await this.readRun(org.orgId, runId, lastSeq);
        if (!next) {
          writer.end();
          return;
        }
        cur = next;
      }
      sendStatus({ ...cur.status, seq: Math.max(cur.status.seq, lastSeq) });
      if (isFinal(cur.status.status)) writer.end();
    };

    const flush = async (): Promise<void> => {
      flushing = true;
      try {
        let g: number;
        do {
          // The first iteration consumes the page read at `pageGen`; wake-ups since then force another pass.
          g = page ? pageGen : gen;
          await step();
        } while (g !== gen && !writer.closed);
      } catch (err) {
        this.log.warn(`run stream failed: ${err instanceof Error ? err.message : 'unknown'}`);
        writer.end();
      } finally {
        flushing = false;
      }
    };

    if (!this.begin(reply, writer)) return;
    started = true;
    await flush();
  }

  async streamProject(org: OrgContext, projectId: string, reply: FastifyReply): Promise<void> {
    let started = false;
    const lastFrame = new Map<string, { status: RunStatus; seq: number }>();
    const emit = (runId: string, number: number, status: RunStatus, seq: number): void => {
      const prev = lastFrame.get(runId);
      if (prev) {
        if (prev.status === status && prev.seq === seq) return;
        // A stale resync must never overwrite a fresher frame.
        if (prev.seq > seq || (isFinal(prev.status) && !isFinal(status))) return;
      }
      lastFrame.set(runId, { status, seq });
      writer.event('run', ProjectRunEvent.parse({ runId, number, status, seq }));
    };
    // After a LISTEN reconnect notifications may have been missed: re-send the state of the project's unfinished runs.
    const resync = async (): Promise<void> => {
      const seenOpen = [...lastFrame].filter(([, f]) => !isFinal(f.status)).map(([id]) => id);
      try {
        const rows = await withOrg(this.db, org.orgId, (tx) =>
          tx
            .select({
              id: runs.id,
              number: runs.number,
              status: runs.status,
              seq: sql<number>`(select coalesce(max(seq), 0)::int from run_events where run_events.run_id = runs.id)`,
            })
            .from(runs)
            .where(
              and(
                eq(runs.projectId, projectId),
                // Unfinished runs, plus runs this stream last saw as unfinished (they may have finished in the gap).
                seenOpen.length > 0
                  ? or(notInArray(runs.status, [...FINAL_RUN_STATUSES]), inArray(runs.id, seenOpen))
                  : notInArray(runs.status, [...FINAL_RUN_STATUSES]),
              ),
            )
            .limit(RESYNC_LIMIT),
        );
        if (writer.closed) return;
        for (const r of rows) emit(r.id, r.number, RunStatus.parse(r.status), r.seq);
      } catch (err) {
        this.log.warn(`project resync failed: ${err instanceof Error ? err.message : 'unknown'}`);
      }
    };
    const writer = this.track(
      reply,
      this.listener.onProject(org.orgId, projectId, (s) => {
        if (!started || writer.closed) return;
        if (s) emit(s.runId, s.number, s.status, s.seq);
        else void resync();
      }),
    );
    try {
      const exists = await withOrg(this.db, org.orgId, (tx) =>
        tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1),
      );
      if (!exists[0]) throw new NotFoundException('Project not found');
    } catch (err) {
      writer.release();
      throw err;
    }
    if (!this.begin(reply, writer)) return;
    started = true;
  }
}
