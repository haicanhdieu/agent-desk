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

/**
 * Run subscribers are only woken (`null`): they re-read the run themselves. Project subscribers get a snapshot, or
 * `null` meaning "notifications may have been missed, resync".
 */
export type WakeHandler = (snapshot: RunSnapshot | null) => void;

const RETRY_MS = 1000;
const MAX_CONCURRENT_READS = 4;

/** Test seam. */
export interface ListenerHooks {
  beforeRead?: () => Promise<void>;
}

/**
 * One LISTEN connection per replica. A notification is only a hint: nothing from its payload reaches a client. Run
 * subscribers are woken and re-read under their own org; for project subscribers the run is re-read here under
 * withOrg(orgId). Subscriptions are keyed by (orgId, id), so one org can never see another org's runs.
 */
@Injectable()
export class RunStatusListener implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(RunStatusListener.name);
  private readonly emitter = new EventEmitter();
  private readonly orgRunSubs = new Map<string, number>();
  private readonly orgProjectSubs = new Map<string, number>();
  private stop: (() => Promise<void>) | null = null;
  private connecting: Promise<void> | null = null;
  private retry: NodeJS.Timeout | null = null;
  private tick: NodeJS.Timeout | null = null;
  private destroyed = false;

  // Per-run read scheduling: one read in flight and at most one pending per (orgId, runId), a few reads at a time.
  private readonly pending = new Map<string, RunStatusMessage>();
  private readonly again = new Map<string, RunStatusMessage>();
  private readonly inFlight = new Set<string>();

  hooks: ListenerHooks = {};
  /** Snapshot reads performed (debug and tests). */
  readCount = 0;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(DB) private readonly db: Db,
  ) {
    this.emitter.setMaxListeners(0);
  }

  async onModuleInit(): Promise<void> {
    this.tick = setInterval(() => this.wakeRuns(), this.config.SSE_SAFETY_TICK_MS);
    this.tick.unref();
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    if (this.tick) clearInterval(this.tick);
    if (this.retry) clearTimeout(this.retry);
    // A connect still in flight resolves with a live client: wait for it, then stop it.
    await this.connecting?.catch(() => undefined);
    const stop = this.stop;
    this.stop = null;
    if (stop) await stop();
    this.emitter.removeAllListeners();
    this.orgRunSubs.clear();
    this.orgProjectSubs.clear();
    this.pending.clear();
    this.again.clear();
  }

  private connect(): Promise<void> {
    const attempt = (async (): Promise<void> => {
      try {
        const stop = await listenRunStatus(this.config.DATABASE_APP_URL, (m) => this.enqueue(m), {
          onReconnect: () => this.resyncAll(),
        });
        if (this.destroyed) await stop();
        else this.stop = stop;
      } catch (err) {
        this.log.warn(`LISTEN connect failed, retrying: ${err instanceof Error ? err.message : 'unknown'}`);
        if (this.destroyed) return;
        this.retry = setTimeout(() => {
          this.retry = null;
          this.connecting = this.connect();
        }, RETRY_MS);
      }
    })();
    this.connecting = attempt;
    return attempt;
  }

  /** Subscribes to wake-ups for one run in one org. Returns the unsubscribe function. */
  onRun(orgId: string, runId: string, handler: WakeHandler): () => void {
    return this.subscribe(this.orgRunSubs, orgId, `run:${orgId}:${runId}`, handler);
  }

  /** Subscribes to snapshots of every run of one project in one org. */
  onProject(orgId: string, projectId: string, handler: WakeHandler): () => void {
    return this.subscribe(this.orgProjectSubs, orgId, `project:${orgId}:${projectId}`, handler);
  }

  subscriberCount(): number {
    let total = 0;
    for (const m of [this.orgRunSubs, this.orgProjectSubs]) for (const n of m.values()) total += n;
    return total;
  }

  private subscribe(counts: Map<string, number>, orgId: string, key: string, handler: WakeHandler): () => void {
    this.emitter.on(key, handler);
    counts.set(orgId, (counts.get(orgId) ?? 0) + 1);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.emitter.off(key, handler);
      const left = (counts.get(orgId) ?? 1) - 1;
      if (left <= 0) counts.delete(orgId);
      else counts.set(orgId, left);
    };
  }

  private emit(key: string, snapshot: RunSnapshot | null): void {
    for (const handler of this.emitter.listeners(key) as WakeHandler[]) {
      try {
        handler(snapshot);
      } catch (err) {
        this.log.warn(`subscriber failed: ${err instanceof Error ? err.message : 'unknown'}`);
      }
    }
  }

  /** Marks every open stream dirty: after a LISTEN reconnect (missed notifications) and on the safety tick. */
  private wakeRuns(): void {
    for (const name of this.emitter.eventNames()) {
      if (typeof name === 'string' && name.startsWith('run:')) this.emit(name, null);
    }
  }

  private resyncAll(): void {
    this.wakeRuns();
    for (const name of this.emitter.eventNames()) {
      if (typeof name === 'string' && name.startsWith('project:')) this.emit(name, null);
    }
  }

  private enqueue(msg: RunStatusMessage): void {
    if (this.destroyed) return;
    // Run subscribers re-read for themselves; nothing from the payload is used beyond choosing whom to wake.
    if (this.orgRunSubs.has(msg.orgId)) this.emit(`run:${msg.orgId}:${msg.runId}`, null);
    if (!this.orgProjectSubs.has(msg.orgId)) return;
    const key = `${msg.orgId}:${msg.runId}`;
    if (this.inFlight.has(key)) this.again.set(key, msg);
    else this.pending.set(key, msg);
    this.pump();
  }

  private pump(): void {
    while (!this.destroyed && this.inFlight.size < MAX_CONCURRENT_READS) {
      const next = this.pending.entries().next();
      if (next.done) return;
      const [key, msg] = next.value;
      this.pending.delete(key);
      this.inFlight.add(key);
      void this.read(msg)
        .catch((err: unknown) => {
          this.log.warn(`run_status re-read failed: ${err instanceof Error ? err.message : 'unknown'}`);
        })
        .finally(() => {
          this.inFlight.delete(key);
          const more = this.again.get(key);
          if (more) {
            this.again.delete(key);
            this.pending.set(key, more);
          }
          this.pump();
        });
    }
  }

  private async read(msg: RunStatusMessage): Promise<void> {
    if (!this.orgProjectSubs.has(msg.orgId)) return;
    await this.hooks.beforeRead?.();
    this.readCount += 1;
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
    this.emit(`project:${snapshot.orgId}:${snapshot.projectId}`, snapshot);
  }
}
