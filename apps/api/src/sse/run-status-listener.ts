import { EventEmitter } from 'node:events';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { listenRunStatus, runEvents, runs, withOrg, type Db, type RunStatusMessage } from '@agentdesk/db';
import { RunStatus } from '@agentdesk/contracts';
import { CONFIG, type Config } from '../config/config.module';
import { DB } from '../db/db.module';

/** What the listener learned by re-reading a run after a notification. */
export interface RunSnapshot {
  orgId: string;
  runId: string;
  projectId: string;
  number: number;
  status: RunStatus;
  /** Highest run_events seq at read time (0 when none). */
  seq: number;
  exitCode: number | null;
  failureReason: string | null;
}

export type SnapshotHandler = (snapshot: RunSnapshot) => void;

const RETRY_MS = 1000;

/**
 * One LISTEN connection per replica. A notification is only a hint: the run is re-read under withOrg(orgId) and the
 * result, never the payload, is handed to subscribers. Subscriptions are keyed by (orgId, id), so a subscriber for one
 * org can never see another org's runs, whatever ids a notification carries.
 */
@Injectable()
export class RunStatusListener implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(RunStatusListener.name);
  private readonly emitter = new EventEmitter();
  private readonly orgSubscribers = new Map<string, number>();
  private stop: (() => Promise<void>) | null = null;
  private retry: NodeJS.Timeout | null = null;
  private destroyed = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(DB) private readonly db: Db,
  ) {
    this.emitter.setMaxListeners(0);
  }

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    if (this.retry) clearTimeout(this.retry);
    const stop = this.stop;
    this.stop = null;
    if (stop) await stop();
    await this.queue.catch(() => undefined);
    this.emitter.removeAllListeners();
    this.orgSubscribers.clear();
  }

  private async connect(): Promise<void> {
    try {
      this.stop = await listenRunStatus(this.config.DATABASE_APP_URL, (m) => this.enqueue(m));
    } catch (err) {
      this.log.warn(`LISTEN connect failed, retrying: ${err instanceof Error ? err.message : 'unknown'}`);
      if (this.destroyed) return;
      this.retry = setTimeout(() => {
        this.retry = null;
        void this.connect();
      }, RETRY_MS);
    }
  }

  /** Subscribes to snapshots of one run in one org. Returns the unsubscribe function. */
  onRun(orgId: string, runId: string, handler: SnapshotHandler): () => void {
    return this.subscribe(orgId, `run:${orgId}:${runId}`, handler);
  }

  /** Subscribes to snapshots of every run of one project in one org. */
  onProject(orgId: string, projectId: string, handler: SnapshotHandler): () => void {
    return this.subscribe(orgId, `project:${orgId}:${projectId}`, handler);
  }

  subscriberCount(): number {
    let total = 0;
    for (const n of this.orgSubscribers.values()) total += n;
    return total;
  }

  private subscribe(orgId: string, key: string, handler: SnapshotHandler): () => void {
    this.emitter.on(key, handler);
    this.orgSubscribers.set(orgId, (this.orgSubscribers.get(orgId) ?? 0) + 1);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.emitter.off(key, handler);
      const left = (this.orgSubscribers.get(orgId) ?? 1) - 1;
      if (left <= 0) this.orgSubscribers.delete(orgId);
      else this.orgSubscribers.set(orgId, left);
    };
  }

  /** Notifications are processed strictly in order, so a later (fresher) read is never overtaken by an earlier one. */
  private enqueue(msg: RunStatusMessage): void {
    if (this.destroyed || !this.orgSubscribers.has(msg.orgId)) return;
    this.queue = this.queue
      .then(() => this.handle(msg))
      .catch((err: unknown) => {
        this.log.warn(`run_status re-read failed: ${err instanceof Error ? err.message : 'unknown'}`);
      });
  }

  private async handle(msg: RunStatusMessage): Promise<void> {
    if (this.destroyed || !this.orgSubscribers.has(msg.orgId)) return;
    const snapshot = await withOrg(this.db, msg.orgId, async (tx): Promise<RunSnapshot | null> => {
      const run = (
        await tx
          .select({
            id: runs.id,
            orgId: runs.orgId,
            projectId: runs.projectId,
            number: runs.number,
            status: runs.status,
            exitCode: runs.exitCode,
            failureReason: runs.failureReason,
          })
          .from(runs)
          .where(eq(runs.id, msg.runId))
          .limit(1)
      )[0];
      // RLS hides other orgs' rows; the explicit check keeps the guarantee even if a policy were ever loosened.
      if (!run || run.orgId !== msg.orgId) return null;
      const max = (
        await tx
          .select({ m: sql<number>`coalesce(max(${runEvents.seq}), 0)::int` })
          .from(runEvents)
          .where(eq(runEvents.runId, msg.runId))
      )[0];
      return {
        orgId: run.orgId,
        runId: run.id,
        projectId: run.projectId,
        number: run.number,
        status: RunStatus.parse(run.status),
        seq: max?.m ?? 0,
        exitCode: run.exitCode,
        failureReason: run.failureReason,
      };
    });
    if (!snapshot || this.destroyed) return;
    for (const key of [`run:${snapshot.orgId}:${snapshot.runId}`, `project:${snapshot.orgId}:${snapshot.projectId}`]) {
      for (const handler of this.emitter.listeners(key) as SnapshotHandler[]) {
        try {
          handler(snapshot);
        } catch (err) {
          this.log.warn(`snapshot handler failed: ${err instanceof Error ? err.message : 'unknown'}`);
        }
      }
    }
  }
}
