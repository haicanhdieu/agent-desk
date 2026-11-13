import { Inject, Injectable, Logger, NotFoundException, type OnModuleDestroy } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { and, asc, eq, gt } from 'drizzle-orm';
import { setupTestEvents, setupTests, user, withOrg, type Db } from '@agentdesk/db';
import { RunEventDto, type SetupTestDto } from '@agentdesk/contracts';
import type { OrgContext } from '../auth/org-context';
import { CONFIG, type Config } from '../config/config.module';
import { DB } from '../db/db.module';
import { SseWriter } from '../sse/sse-writer';
import { SetupScriptService } from './setup-script.service';
import { setupTestColumns, toSetupTestDto } from './setup-tests.service';

const BACKLOG_PAGE = 500;

interface Page {
  test: SetupTestDto;
  events: RunEventDto[];
}

/** Test seam. */
export interface SetupTestStreamHooks {
  /** Called before every database read of a stream (the first one included). */
  onPoll?: () => void;
}

/**
 * SSE for one setup test: `status` frames (SetupTestDto, when it changes) and `event` frames (RunEventDto) from
 * `setup_test_events`. A project has at most one active test, so live updates are a 1 s poll, not LISTEN. The stream
 * ends once `ended_at` is set and the backlog is sent. It never reads or sends `script_body`.
 */
@Injectable()
export class SetupTestStream implements OnModuleDestroy {
  private readonly log = new Logger(SetupTestStream.name);
  private readonly open = new Set<SseWriter>();

  /** Test seam. */
  hooks: SetupTestStreamHooks = {};
  /** Poll interval in ms; a test seam, 1 s in production. */
  pollMs = 1000;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(SetupScriptService) private readonly scripts: SetupScriptService,
  ) {}

  openStreams(): number {
    return this.open.size;
  }

  onModuleDestroy(): void {
    for (const w of [...this.open]) w.shutdown();
  }

  /** Test row first, events second: a status the row reflects always has its events visible to the events read. */
  private async read(orgId: string, setupTestId: string, after: number): Promise<Page | null> {
    this.hooks.onPoll?.();
    return withOrg(this.db, orgId, async (tx) => {
      const rows = await tx
        .select(setupTestColumns)
        .from(setupTests)
        .leftJoin(user, eq(user.id, setupTests.startedBy))
        .where(eq(setupTests.id, setupTestId))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      const current = (await this.scripts.current(tx, row.projectId))?.body ?? null;
      const events = await tx
        .select({
          seq: setupTestEvents.seq,
          ts: setupTestEvents.ts,
          type: setupTestEvents.type,
          payload: setupTestEvents.payload,
        })
        .from(setupTestEvents)
        .where(and(eq(setupTestEvents.setupTestId, setupTestId), gt(setupTestEvents.seq, after)))
        .orderBy(asc(setupTestEvents.seq))
        .limit(BACKLOG_PAGE);
      return {
        test: toSetupTestDto(row, current, this.config.SETUP_TEST_TTL_SECONDS),
        events: events.map((e) => RunEventDto.parse({ ...e, ts: e.ts.toISOString() })),
      };
    });
  }

  /** Validation and the 404 happen before the response is taken over, so they are ordinary problem+json. */
  async stream(org: OrgContext, setupTestId: string, after: number, reply: FastifyReply): Promise<void> {
    const writer = new SseWriter(reply.raw, this.config.SSE_DRAIN_TIMEOUT_MS);
    this.open.add(writer);
    let wake: (() => void) | null = null;
    let timer: NodeJS.Timeout | null = null;
    writer.onClose(() => {
      this.open.delete(writer);
      if (timer) clearTimeout(timer);
      timer = null;
      wake?.();
    });

    let page: Page | null;
    try {
      page = await this.read(org.orgId, setupTestId, after);
      if (!page) throw new NotFoundException('Setup test not found');
    } catch (err) {
      writer.release();
      throw err;
    }
    try {
      reply.hijack();
      if (writer.closed) return;
      writer.start(reply.getHeaders());
      writer.startHeartbeat(this.config.SSE_HEARTBEAT_MS);
    } catch (err) {
      this.log.warn(`could not start setup test stream: ${err instanceof Error ? err.name : 'unknown'}`);
      writer.release();
      return;
    }

    const sleep = (): Promise<void> =>
      new Promise<void>((resolve) => {
        wake = resolve;
        timer = setTimeout(resolve, this.pollMs);
      });

    let lastSeq = after;
    let lastStatusKey = '';
    const sendStatus = (test: SetupTestDto): void => {
      const key = JSON.stringify(test);
      if (key === lastStatusKey) return;
      lastStatusKey = key;
      // No `id:` on status frames: only events advance the client's Last-Event-ID.
      writer.event('status', test);
    };
    try {
      while (!writer.closed) {
        const cur: Page | null = page ?? (await this.read(org.orgId, setupTestId, lastSeq));
        page = null;
        if (!cur) break;
        if (writer.closed) return;
        // The first frame is the status, so a client always knows where the test stands before the backlog arrives.
        if (lastStatusKey === '') sendStatus(cur.test);
        for (const e of cur.events) {
          writer.event('event', e, e.seq);
          lastSeq = e.seq;
          await writer.drained();
          if (writer.closed) return;
        }
        // More backlog than one page: read on without waiting.
        if (cur.events.length >= BACKLOG_PAGE) continue;
        sendStatus(cur.test);
        if (cur.test.endedAt !== null) break;
        await sleep();
      }
    } catch (err) {
      this.log.warn(`setup test stream failed: ${err instanceof Error ? err.name : 'unknown'}`);
    }
    writer.end();
  }
}
