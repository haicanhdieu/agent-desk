import { Inject, Injectable, Logger, type OnModuleDestroy, type OnApplicationBootstrap } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import websocket from '@fastify/websocket';
import type { Client } from '@temporalio/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import type { RawData, WebSocket } from 'ws';
import { z } from 'zod';
import { member, projects, runs, withOrg, type Db } from '@agentdesk/db';
import { routes } from '@agentdesk/contracts';
import { SIGNAL, TMUX_ATTACH, runJobName, runWorkflowId, type ExecSession, type KubeGateway } from '@agentdesk/core';
import { AUTH, type Auth } from '../auth/auth';
import { toHeaders } from '../auth/session.guard';
import { CONFIG, type Config } from '../config/config.module';
import { DB } from '../db/db.module';
import { KUBE_GATEWAY } from '../kube/kube-gateway.module';
import { TEMPORAL_CLIENT } from '../temporal/temporal-client.module';

/** Close codes (spec 7.5); the browser treats 4403 and 4409 as terminal, 4401 as "sign in". */
export const CLOSE = {
  normal: 1000,
  goingAway: 1001,
  tooBig: 1009,
  internal: 1011,
  tryAgainLater: 1013,
  unauthorized: 4401,
  forbidden: 4403,
  notActive: 4409,
} as const;

/** Largest frame the browser may send (a keystroke burst or paste chunk); ws closes the socket with 1009 above it. */
export const MAX_FRAME_BYTES = 64 * 1024;
/** Terminals attached to one run at once, per api process. More are closed with 1013. */
export const MAX_TERMINALS_PER_RUN = 4;
/** `resumed` is signalled at most this often per run per process; the run status is re-read at the same pace. */
export const RESUME_THROTTLE_MS = 5000;
/** A client that lets this much output pile up unsent is dropped (1013); it reattaches to the tmux session. */
export const HIGH_WATER_BYTES = 4 * 1024 * 1024;
/** Input arriving before the exec session is up is held, up to this much. */
const PENDING_INPUT_MAX_BYTES = 256 * 1024;

const ResizeFrame = z.object({
  type: z.literal('resize'),
  cols: z.number().int().min(1).max(500),
  rows: z.number().int().min(1).max(500),
});

type AuthzResult =
  | { ok: true; userId: string; orgId: string; status: 'running' | 'idle' }
  | { ok: false; code: number; why: string };

interface Conn {
  readonly runId: string;
  readonly socket: WebSocket;
  userId: string;
  orgId: string;
  closed: boolean;
  attached: boolean;
  session?: ExecSession;
  pending: Buffer[];
  pendingBytes: number;
  /** The latest resize that arrived before the exec session was up (browsers send one right after open). */
  pendingResize?: { cols: number; rows: number };
  idle: boolean;
  statusReadAt: number;
  alive: boolean;
  pingTimer?: NodeJS.Timeout;
  registered: boolean;
}

const toBuffer = (data: RawData): Buffer =>
  Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data;

/**
 * `GET /api/runs/:runId/terminal` as a WebSocket. The Nest guard stack does not apply to a raw Fastify route, so this
 * authorizes on its own, before any exec:
 *
 *  - `Origin`, when present, must equal PUBLIC_ORIGIN (cross-site WebSocket hijacking: the cookie rides along on a
 *    cross-site upgrade). A missing Origin is allowed: only non-browser clients omit it, and they still need a session.
 *  - session (better-auth cookie) -> 4401; active org membership, then (project creator or org owner) -> 4403;
 *  - a run that is missing or in another org is 4403 too (RLS hides it; 4404 would leak existence across orgs);
 *  - run not running/idle, or its pod not Running -> 4409.
 *
 * The socket is always upgraded first, because a browser cannot read an HTTP status off a failed upgrade; the close code
 * is the error channel. Terminal bytes are never logged: only run id, user id and event names.
 */
@Injectable()
export class TerminalGateway implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(TerminalGateway.name);
  private readonly byRun = new Map<string, Set<Conn>>();
  /** Per-run time of the last `resumed` signal; an entry lives only while the run has a terminal attached. */
  private readonly resumedAt = new Map<string, number>();

  constructor(
    @Inject(HttpAdapterHost) private readonly host: HttpAdapterHost,
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(KUBE_GATEWAY) private readonly kube: KubeGateway,
    @Inject(TEMPORAL_CLIENT) private readonly temporal: Client,
  ) {}

  openCount(): number {
    let n = 0;
    for (const set of this.byRun.values()) n += set.size;
    return n;
  }

  async onApplicationBootstrap(): Promise<void> {
    const fastify = this.host.httpAdapter.getInstance<FastifyInstance>();
    await fastify.register(websocket, { options: { maxPayload: MAX_FRAME_BYTES } });
    fastify.get<{ Params: { runId: string } }>(routes.runs.terminal.path, { websocket: true }, (socket, req) =>
      this.accept(socket, req),
    );
  }

  onModuleDestroy(): void {
    for (const set of this.byRun.values()) {
      for (const conn of [...set]) {
        this.cleanup(conn);
        conn.socket.close(CLOSE.goingAway);
      }
    }
  }

  private accept(socket: WebSocket, req: FastifyRequest): void {
    const params = z.object({ runId: z.string() }).safeParse(req.params);
    const conn: Conn = {
      runId: params.success ? params.data.runId : '',
      socket,
      userId: '',
      orgId: '',
      closed: false,
      attached: false,
      pending: [],
      pendingBytes: 0,
      idle: false,
      statusReadAt: 0,
      alive: true,
      registered: false,
    };
    // Listeners go on synchronously: frames sent right after the upgrade must not be lost while we authorize.
    socket.on('message', (data, isBinary) => this.onFrame(conn, data, isBinary));
    socket.on('pong', () => {
      conn.alive = true;
    });
    socket.on('close', () => this.cleanup(conn));
    socket.on('error', (err: Error & { code?: string }) => {
      this.log.warn(`terminal socket error run=${conn.runId} code=${err.code ?? 'unknown'}`);
      this.cleanup(conn);
    });
    conn.pingTimer = setInterval(() => {
      if (!conn.alive) {
        this.log.warn(`terminal ping timeout run=${conn.runId}`);
        socket.terminate();
        return;
      }
      conn.alive = false;
      socket.ping();
    }, this.config.TERMINAL_PING_MS);
    this.start(conn, req).catch((err: unknown) => {
      this.log.error(`terminal start failed run=${conn.runId} user=${conn.userId}: ${errorName(err)}`);
      this.shut(conn, CLOSE.internal);
    });
  }

  private shut(conn: Conn, code: number): void {
    this.cleanup(conn);
    if (conn.socket.readyState === conn.socket.OPEN || conn.socket.readyState === conn.socket.CONNECTING) {
      conn.socket.close(code);
    }
  }

  private async start(conn: Conn, req: FastifyRequest): Promise<void> {
    const authz = await this.authorize(req, conn.runId);
    if (conn.closed) return;
    if (!authz.ok) {
      this.log.log(`terminal denied run=${conn.runId} code=${authz.code} why=${authz.why}`);
      this.shut(conn, authz.code);
      return;
    }
    conn.userId = authz.userId;
    conn.orgId = authz.orgId;
    conn.idle = authz.status === 'idle';
    conn.statusReadAt = Date.now();

    // Reserve the slot before the first await below, so the cap holds under concurrent attaches.
    const set = this.byRun.get(conn.runId) ?? new Set<Conn>();
    if (set.size >= MAX_TERMINALS_PER_RUN) {
      this.shut(conn, CLOSE.tryAgainLater);
      return;
    }
    set.add(conn);
    this.byRun.set(conn.runId, set);
    conn.registered = true;

    const pod = await this.kube.getRunPod(runJobName(conn.runId));
    if (conn.closed) return;
    if (!pod || pod.phase !== 'Running') {
      this.shut(conn, CLOSE.notActive);
      return;
    }
    const session = await this.kube.exec(pod.name, [...TMUX_ATTACH], { tty: true });
    if (conn.closed) {
      session.close();
      return;
    }
    conn.session = session;
    session.onData((d) => this.onOutput(conn, d));
    session.onClose(() => {
      if (!conn.closed) this.shut(conn, CLOSE.normal);
    });
    conn.attached = true;
    this.log.log(`terminal attached run=${conn.runId} user=${conn.userId}`);
    void this.signal(conn.runId, SIGNAL.terminalAttached);
    if (conn.pendingResize) session.resize(conn.pendingResize.cols, conn.pendingResize.rows);
    const pending = conn.pending.splice(0);
    conn.pendingBytes = 0;
    for (const b of pending) this.onInput(conn, b);
  }

  private async authorize(req: FastifyRequest, runId: string): Promise<AuthzResult> {
    const deny = (code: number, why: string): AuthzResult => ({ ok: false, code, why });
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== new URL(this.config.PUBLIC_ORIGIN).origin)
      return deny(CLOSE.forbidden, 'origin');

    const session = await this.auth.api.getSession({ headers: toHeaders(req) }).catch(() => null);
    if (!session) return deny(CLOSE.unauthorized, 'no-session');
    const orgId = session.session.activeOrganizationId;
    const userId = session.user.id;
    if (!orgId) return deny(CLOSE.forbidden, 'no-org');
    const rows = await this.db.orm
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
      .limit(1);
    const role = rows[0]?.role;
    if (role === undefined) return deny(CLOSE.forbidden, 'not-member');
    if (!z.uuid().safeParse(runId).success) return deny(CLOSE.forbidden, 'bad-run-id');

    const run = (
      await withOrg(this.db, orgId, (tx) =>
        tx
          .select({ status: runs.status, createdBy: projects.createdBy })
          .from(runs)
          .innerJoin(projects, eq(projects.id, runs.projectId))
          .where(eq(runs.id, runId))
          .limit(1),
      )
    )[0];
    if (!run) return deny(CLOSE.forbidden, 'run-not-visible');
    if (role !== 'owner' && run.createdBy !== userId) return deny(CLOSE.forbidden, 'not-owner-or-creator');
    if (run.status !== 'running' && run.status !== 'idle') return deny(CLOSE.notActive, 'run-not-active');
    return { ok: true, userId, orgId, status: run.status };
  }

  private onFrame(conn: Conn, data: RawData, isBinary: boolean): void {
    if (conn.closed) return;
    const buf = toBuffer(data);
    if (isBinary) {
      if (!conn.session) {
        conn.pendingBytes += buf.length;
        if (conn.pendingBytes > PENDING_INPUT_MAX_BYTES) {
          this.shut(conn, CLOSE.tooBig);
          return;
        }
        conn.pending.push(buf);
        return;
      }
      this.onInput(conn, buf);
      return;
    }
    // Text frames carry only resize; anything else (or a malformed resize) is ignored, never an error for the user.
    let json: unknown;
    try {
      json = JSON.parse(buf.toString('utf8'));
    } catch {
      return;
    }
    const resize = ResizeFrame.safeParse(json);
    if (!resize.success) return;
    if (conn.session) conn.session.resize(resize.data.cols, resize.data.rows);
    else conn.pendingResize = resize.data;
  }

  private onInput(conn: Conn, buf: Buffer): void {
    conn.session?.write(new Uint8Array(buf.buffer, buf.byteOffset, buf.length));
    void this.maybeResume(conn);
  }

  private onOutput(conn: Conn, d: Uint8Array): void {
    if (conn.closed || conn.socket.readyState !== conn.socket.OPEN) return;
    if (conn.socket.bufferedAmount > HIGH_WATER_BYTES) {
      this.log.warn(`terminal slow consumer dropped run=${conn.runId}`);
      this.shut(conn, CLOSE.tryAgainLater);
      return;
    }
    conn.socket.send(d, { binary: true }, () => undefined);
  }

  /**
   * The first input of a turn gap: if the run is `idle`, tell its workflow. The status is re-read (withOrg) at most once
   * per RESUME_THROTTLE_MS per connection; `resumed` is signalled at most once per RESUME_THROTTLE_MS per run.
   */
  private async maybeResume(conn: Conn): Promise<void> {
    let now = Date.now();
    if (now - conn.statusReadAt >= RESUME_THROTTLE_MS) {
      conn.statusReadAt = now;
      try {
        const row = (
          await withOrg(this.db, conn.orgId, (tx) =>
            tx.select({ status: runs.status }).from(runs).where(eq(runs.id, conn.runId)).limit(1),
          )
        )[0];
        conn.idle = row?.status === 'idle';
      } catch (err) {
        this.log.warn(`terminal status read failed run=${conn.runId}: ${errorName(err)}`);
      }
      now = Date.now();
    }
    if (conn.closed || !conn.idle) return;
    const last = this.resumedAt.get(conn.runId);
    if (last !== undefined && now - last < RESUME_THROTTLE_MS) return;
    this.resumedAt.set(conn.runId, now);
    await this.signal(conn.runId, SIGNAL.resumed);
  }

  /** Best-effort: a failed signal is logged and never breaks the relay. */
  private async signal(runId: string, name: string): Promise<void> {
    try {
      await this.temporal.workflow.getHandle(runWorkflowId(runId)).signal(name);
    } catch (err) {
      this.log.warn(`terminal signal ${name} failed run=${runId}: ${errorName(err)}`);
    }
  }

  /** Idempotent: close, error, ping timeout and shutdown can all land here. */
  private cleanup(conn: Conn): void {
    if (conn.closed) return;
    conn.closed = true;
    if (conn.pingTimer) clearInterval(conn.pingTimer);
    conn.pending.length = 0;
    try {
      conn.session?.close();
    } catch {
      // the session may already be gone
    }
    if (conn.registered) {
      const set = this.byRun.get(conn.runId);
      set?.delete(conn);
      if (set?.size === 0) {
        this.byRun.delete(conn.runId);
        this.resumedAt.delete(conn.runId);
      }
    }
    if (conn.attached) {
      this.log.log(`terminal detached run=${conn.runId} user=${conn.userId}`);
      void this.signal(conn.runId, SIGNAL.terminalDetached);
    }
  }
}

/** Error class name only: messages from the kube/ws layers could carry stream content. */
function errorName(err: unknown): string {
  return err instanceof Error ? err.name : 'error';
}
