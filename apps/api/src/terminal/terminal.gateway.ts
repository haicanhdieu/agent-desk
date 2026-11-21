import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnApplicationBootstrap } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import websocket from '@fastify/websocket';
import type { Client } from '@temporalio/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RawData, WebSocket } from 'ws';
import { z } from 'zod';
import { withOrg, type Db } from '@agentdesk/db';
import { routeAccess, routes } from '@agentdesk/contracts';
import {
  EXEC_NOT_FOUND,
  TMUX_ATTACH,
  attachCommand,
  detachCommand,
  runWorkflowId,
  type ExecSession,
  type KubeGateway,
} from '@agentdesk/core';
import { checkTenantAccess } from '../access/check-access';
import { AUTH, type Auth } from '../auth/auth';
import { toHeaders } from '../auth/session.guard';
import { CONFIG, type Config } from '../config/config.module';
import { DB } from '../db/db.module';
import { KUBE_GATEWAY } from '../kube/kube-gateway.module';
import { TEMPORAL_CLIENT } from '../temporal/temporal-client.module';
import { TerminalLeases } from './terminal-leases';
import { isPersonTyping } from './typing';
import { runTarget, setupTestTarget, terminalKey, type TerminalTarget } from './terminal-targets';

/** Close codes (spec 7.5); the browser treats 4403, 4409 and 4410 as terminal, 4401 as "sign in". */
export const CLOSE = {
  normal: 1000,
  goingAway: 1001,
  tooBig: 1009,
  internal: 1011,
  tryAgainLater: 1013,
  unauthorized: 4401,
  forbidden: 4403,
  notActive: 4409,
  /** The pod's tmux session is gone (attach exit 3): the run ended while the socket was opening or open. */
  sessionEnded: 4410,
} as const;

/** Largest frame the browser may send (a keystroke burst or paste chunk); ws closes the socket with 1009 above it. */
export const MAX_FRAME_BYTES = 64 * 1024;
/** Terminals attached to one run at once, per api process. More are closed with 1013. */
export const MAX_TERMINALS_PER_RUN = 4;
/** A client that lets this much output pile up unsent is dropped (1013); it reattaches to the tmux session. */
export const HIGH_WATER_BYTES = 4 * 1024 * 1024;
/** Input arriving before the exec session is up is held, up to this much. */
const PENDING_INPUT_MAX_BYTES = 256 * 1024;
/** Until authorization completes an unauthenticated peer may buffer almost nothing. */
const UNAUTHORIZED_INPUT_MAX_BYTES = 4 * 1024;
/** Authorization (session + membership + run lookup) must finish within this, else 1013. */
const AUTH_TIMEOUT_MS = 10_000;
/** Shutdown waits at most this long for the detach execs, so a hung exec cannot stall the process. */
const DETACH_WAIT_MS = 5_000;
/** `agentdesk-attach` exit code: no agent session (or already detached). */
const ATTACH_NO_SESSION = 3;
/** Attach/detach signal attempts (first try plus retries with a short backoff). */
const SIGNAL_ATTEMPTS = 3;

const ResizeFrame = z.object({
  type: z.literal('resize'),
  cols: z.number().int().min(1).max(500),
  rows: z.number().int().min(1).max(500),
});

type AuthzResult =
  { ok: true; userId: string; orgId: string; jobName: string } | { ok: false; code: number; why: string };

interface Conn {
  readonly target: TerminalTarget;
  /** The run or setup-test id from the route (empty when the params did not parse). */
  readonly runId: string;
  readonly socket: WebSocket;
  userId: string;
  orgId: string;
  closed: boolean;
  attached: boolean;
  session?: ExecSession;
  /** Server-made id of this socket's named tmux attach client; never taken from the browser. */
  readonly connId: string;
  /** Set just before the attach exec is issued: the pod a detach must be sent to. Unset means nothing was exec'd. */
  podName?: string;
  /** The old-pod fallback (plain `tmux attach`) was already tried once. */
  fellBack: boolean;
  /** Latest resize, replayed on a fallback session. */
  lastResize?: { cols: number; rows: number };
  pending: Buffer[];
  pendingBytes: number;
  /** The latest resize that arrived before the exec session was up (browsers send one right after open). */
  pendingResize?: { cols: number; rows: number };
  alive: boolean;
  pingTimer?: NodeJS.Timeout;
  registered: boolean;
  /** Request headers (session cookie), kept in memory only to re-validate the session on a long-lived socket. */
  headers: Headers;
  authTimer?: NodeJS.Timeout;
  reauthTimer?: NodeJS.Timeout;
  reauthBusy: boolean;
  /** Resolves true when `terminalAttached` was delivered. `terminalDetached` is sent only after, and only if true. */
  attachSignal?: Promise<boolean>;
  /** The workflow knows this id and is sent it with every lease signal until the socket closes. */
  leased: boolean;
}

const toBuffer = (data: RawData): Buffer =>
  Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data;

/**
 * `GET /api/runs/:runId/terminal` as a WebSocket. The Nest guard stack does not apply to a raw Fastify route, so this
 * authorizes on its own, before any exec:
 *
 *  - `Origin`, when present, must equal PUBLIC_ORIGIN (cross-site WebSocket hijacking: the cookie rides along on a
 *    cross-site upgrade). A missing Origin is allowed: only non-browser clients omit it, and they still need a session.
 *  - session (better-auth cookie) -> 4401; then `terminal:attach` on the target's project from the caller's role
 *    assignments (ownership for a member's `own` grant) -> 4403 (ADR-0031, amending ADR-0014);
 *  - a run that is missing, out of scope or in another org is 4403 too (4404 would leak existence);
 *  - run whose session is ending or that is paused -> 4410 (the browser shows "Pausing" or "Paused", no retry);
 *  - run not running/idle, or its pod not Running -> 4409.
 *
 * The socket is always upgraded first, because a browser cannot read an HTTP status off a failed upgrade; the close code
 * is the error channel. Terminal bytes are never logged: only run id, user id and event names.
 */
@Injectable()
export class TerminalGateway implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(TerminalGateway.name);
  /** Keyed by `terminalKey(target, id)`. */
  private readonly byRun = new Map<string, Set<Conn>>();
  /** Detach execs in flight, so shutdown can wait for them (bounded). */
  private readonly detaching = new Set<Promise<void>>();
  /** Test seam: base delay between attach/detach signal retries. */
  signalRetryMs = 100;
  /** How often a run's live socket ids are signalled to its workflow (test seam; set from config). */
  leaseIntervalMs: number;
  /** At most one personInput signal per run terminal in this time (test seam). */
  personInputIntervalMs = 60_000;
  /** When personInput was last signalled, keyed by `terminalKey`; dropped when the key's last socket goes. */
  private readonly lastPersonInput = new Map<string, number>();
  private readonly leases: TerminalLeases;

  constructor(
    @Inject(HttpAdapterHost) private readonly host: HttpAdapterHost,
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(KUBE_GATEWAY) private readonly kube: KubeGateway,
    @Inject(TEMPORAL_CLIENT) private readonly temporal: Client,
  ) {
    this.leaseIntervalMs = config.TERMINAL_LEASE_INTERVAL_MS;
    this.leases = new TerminalLeases(() => this.leaseIntervalMs);
  }

  openCount(): number {
    let n = 0;
    for (const set of this.byRun.values()) n += set.size;
    return n;
  }

  async onApplicationBootstrap(): Promise<void> {
    const fastify = this.host.httpAdapter.getInstance<FastifyInstance>();
    await fastify.register(websocket, { options: { maxPayload: MAX_FRAME_BYTES } });
    const targets = [
      runTarget((id, name, args) => this.signalWithRetry(id, name, args), routes.runs.terminal.path),
      setupTestTarget(routes.setupTests.terminal.path),
    ];
    for (const target of targets) {
      fastify.get(target.path, { websocket: true }, (socket, req) => this.accept(socket, req, target));
    }
  }

  /**
   * Closes every registered terminal. Sockets still authorizing are not registered yet: they are closed by the HTTP
   * server shutdown (the websocket plugin terminates all clients) and their auth timer/ping timer die with their close
   * event; their `start` returns early because `conn.closed` is set by cleanup.
   */
  async onModuleDestroy(): Promise<void> {
    for (const set of this.byRun.values()) {
      for (const conn of [...set]) {
        this.cleanup(conn);
        conn.socket.close(CLOSE.goingAway);
      }
    }
    this.leases.stop();
    if (this.detaching.size === 0) return;
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, DETACH_WAIT_MS);
    });
    await Promise.race([Promise.allSettled([...this.detaching]).then(() => undefined), limit]);
    if (timer) clearTimeout(timer);
  }

  private accept(socket: WebSocket, req: FastifyRequest, target: TerminalTarget): void {
    // Every target route has exactly one param, the id.
    const params = z.record(z.string(), z.string()).safeParse(req.params);
    const conn: Conn = {
      target,
      runId: (params.success ? Object.values(params.data)[0] : undefined) ?? '',
      socket,
      userId: '',
      orgId: '',
      closed: false,
      connId: randomUUID(),
      fellBack: false,
      leased: false,
      attached: false,
      pending: [],
      pendingBytes: 0,
      alive: true,
      registered: false,
      headers: toHeaders(req),
      reauthBusy: false,
    };
    // Listeners go on synchronously: frames sent right after the upgrade must not be lost while we authorize.
    socket.on('message', (data, isBinary) => this.onFrame(conn, data, isBinary));
    socket.on('pong', () => {
      conn.alive = true;
    });
    socket.on('close', () => this.cleanup(conn));
    socket.on('error', (err: Error & { code?: string }) => {
      this.log.warn(`terminal socket error ${conn.target.kind}=${conn.runId} code=${err.code ?? 'unknown'}`);
      this.cleanup(conn);
    });
    conn.pingTimer = setInterval(() => {
      if (!conn.alive) {
        this.log.warn(`terminal ping timeout ${conn.target.kind}=${conn.runId}`);
        socket.terminate();
        return;
      }
      conn.alive = false;
      socket.ping();
    }, this.config.TERMINAL_PING_MS);
    conn.authTimer = setTimeout(() => {
      this.log.warn(`terminal auth timeout ${conn.target.kind}=${conn.runId}`);
      this.shut(conn, CLOSE.tryAgainLater);
    }, AUTH_TIMEOUT_MS);
    this.start(conn, req).catch((err: unknown) => {
      this.log.error(`terminal start failed ${conn.target.kind}=${conn.runId} user=${conn.userId}: ${errorName(err)}`);
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
    const authz = await this.authorize(req, conn.target, conn.runId);
    if (conn.authTimer) clearTimeout(conn.authTimer);
    if (conn.closed) return;
    if (!authz.ok) {
      this.log.log(`terminal denied ${conn.target.kind}=${conn.runId} code=${authz.code} why=${authz.why}`);
      this.shut(conn, authz.code);
      return;
    }
    conn.userId = authz.userId;
    conn.orgId = authz.orgId;
    conn.reauthTimer = setInterval(() => void this.reauth(conn), this.config.TERMINAL_REAUTH_MS);

    // Reserve the slot before the first await below, so the cap holds under concurrent attaches.
    const key = terminalKey(conn.target, conn.runId);
    const set = this.byRun.get(key) ?? new Set<Conn>();
    if (set.size >= MAX_TERMINALS_PER_RUN) {
      this.shut(conn, CLOSE.tryAgainLater);
      return;
    }
    set.add(conn);
    this.byRun.set(key, set);
    conn.registered = true;

    const pod = await this.kube.getRunPod(authz.jobName);
    if (conn.closed) return;
    if (!pod || pod.phase !== 'Running') {
      this.shut(conn, CLOSE.notActive);
      return;
    }
    // From here a detach is owed, even if the exec is still in flight when the socket closes (the runner leaves a
    // tombstone, so a detach that beats its attach is safe).
    conn.podName = pod.name;
    const session = await this.kube.exec(pod.name, attachCommand(conn.connId), { tty: true });
    if (conn.closed) {
      session.close();
      return;
    }
    this.bind(conn, session);
    conn.attached = true;
    this.log.log(`terminal attached ${conn.target.kind}=${conn.runId} user=${conn.userId}`);
    conn.attachSignal = conn.target.onAttach?.(conn.runId, conn.connId).then(
      () => {
        this.beginLease(conn);
        return true;
      },
      () => false,
    );
    if (conn.pendingResize) {
      conn.lastResize = conn.pendingResize;
      session.resize(conn.pendingResize.cols, conn.pendingResize.rows);
    }
    const pending = conn.pending.splice(0);
    conn.pendingBytes = 0;
    for (const b of pending) this.onInput(conn, b);
  }

  /**
   * Wires an exec session to the socket. Exit 3 means the tmux session is gone (4410, the browser must not retry);
   * exit 127 on the named attach means an old runner image without `agentdesk-attach`: retry once with plain
   * `tmux attach` (remove this fallback 7 days after the new image is live).
   */
  private bind(conn: Conn, session: ExecSession): void {
    conn.session = session;
    session.onData((d) => this.onOutput(conn, d));
    session.onClose((code) => {
      if (conn.closed || conn.session !== session) return;
      if (code === EXEC_NOT_FOUND && !conn.fellBack && conn.podName) {
        conn.fellBack = true;
        // Input typed until the fallback is bound is held in `pending` (onFrame buffers while there is no session).
        conn.session = undefined;
        void this.fallbackAttach(conn, conn.podName);
        return;
      }
      this.shut(conn, code === ATTACH_NO_SESSION ? CLOSE.sessionEnded : CLOSE.normal);
    });
  }

  private async fallbackAttach(conn: Conn, podName: string): Promise<void> {
    try {
      const session = await this.kube.exec(podName, [...TMUX_ATTACH], { tty: true });
      if (conn.closed) {
        session.close();
        return;
      }
      this.bind(conn, session);
      if (conn.lastResize) session.resize(conn.lastResize.cols, conn.lastResize.rows);
      const pending = conn.pending.splice(0);
      conn.pendingBytes = 0;
      for (const b of pending) this.onInput(conn, b);
    } catch (err) {
      this.log.error(`terminal fallback attach failed ${conn.target.kind}=${conn.runId}: ${errorName(err)}`);
      this.shut(conn, CLOSE.internal);
    }
  }

  private async authorize(req: FastifyRequest, target: TerminalTarget, runId: string): Promise<AuthzResult> {
    const deny = (code: number, why: string): AuthzResult => ({ ok: false, code, why });
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== new URL(this.config.PUBLIC_ORIGIN).origin)
      return deny(CLOSE.forbidden, 'origin');
    return this.check(toHeaders(req), target, runId);
  }

  /**
   * Session (4401), then the same tenant decision as every HTTP route (`checkTenantAccess` with the target's
   * `routeAccess` entry: membership of the active org, `terminal:attach` on the run's or setup test's project, and
   * ownership for a grant that is `own`). Any refusal, whatever its reason (not a member, no permission, out of scope,
   * not yours, missing or other-org target, malformed id), is 4403 and never says which. Only then the target's state
   * (4410 / 4409). A thrown error (auth or DB outage) propagates: only a null session is 4401.
   */
  private async check(headers: Headers, target: TerminalTarget, runId: string): Promise<AuthzResult> {
    const deny = (code: number, why: string): AuthzResult => ({ ok: false, code, why });
    const session = await this.auth.api.getSession({ headers });
    if (!session) return deny(CLOSE.unauthorized, 'no-session');
    const orgId = session.session.activeOrganizationId;
    const userId = session.user.id;
    if (!orgId) return deny(CLOSE.forbidden, 'no-org');

    const access = await checkTenantAccess(this.db, { userId, orgId }, routeAccess[target.routeKey], {
      [target.param]: runId,
    });
    if (!access.ok) return deny(CLOSE.forbidden, access.reason);

    const run = await withOrg(this.db, orgId, (tx) => target.lookup(tx, runId));
    if (!run) return deny(CLOSE.forbidden, 'run-not-visible');
    // After authz, so the state of a run is never told to someone who may not see it.
    if (run.sessionEnded) return deny(CLOSE.sessionEnded, 'session-ended');
    if (!run.active) return deny(CLOSE.notActive, 'run-not-active');
    return { ok: true, userId, orgId, jobName: run.jobName };
  }

  private onFrame(conn: Conn, data: RawData, isBinary: boolean): void {
    if (conn.closed) return;
    const buf = toBuffer(data);
    if (isBinary) {
      if (!conn.session) {
        conn.pendingBytes += buf.length;
        if (conn.pendingBytes > (conn.userId ? PENDING_INPUT_MAX_BYTES : UNAUTHORIZED_INPUT_MAX_BYTES)) {
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
    conn.lastResize = resize.data;
    if (conn.session) conn.session.resize(resize.data.cols, resize.data.rows);
    else conn.pendingResize = resize.data;
  }

  private onInput(conn: Conn, buf: Buffer): void {
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
    conn.session?.write(bytes);
    // Only an authorized socket with a live exec session gets here with a session; replies from the terminal
    // (cursor reports, colour answers, focus, mouse) are not a person typing.
    if (!conn.session || !conn.target.onPersonInput || !isPersonTyping(bytes)) return;
    const key = terminalKey(conn.target, conn.runId);
    const now = Date.now();
    const last = this.lastPersonInput.get(key);
    if (last !== undefined && now - last < this.personInputIntervalMs) return;
    this.lastPersonInput.set(key, now);
    conn.target.onPersonInput(conn.runId).catch(() => undefined); // the run target's signaller already logged a give-up
  }

  private onOutput(conn: Conn, d: Uint8Array): void {
    if (conn.closed || conn.socket.readyState !== conn.socket.OPEN) return;
    if (conn.socket.bufferedAmount > HIGH_WATER_BYTES) {
      this.log.warn(`terminal slow consumer dropped ${conn.target.kind}=${conn.runId}`);
      this.shut(conn, CLOSE.tryAgainLater);
      return;
    }
    conn.socket.send(d, { binary: true }, () => undefined);
  }

  /** Best-effort: a failed signal is logged (error name only) and never breaks the relay. True when delivered. */
  private async signal(runId: string, name: string, args: unknown[]): Promise<boolean> {
    try {
      await this.temporal.workflow.getHandle(runWorkflowId(runId)).signal(name, ...args);
      return true;
    } catch (err) {
      this.log.warn(`terminal signal ${name} failed run=${runId}: ${errorName(err)}`);
      return false;
    }
  }

  /** Up to SIGNAL_ATTEMPTS tries with a short growing backoff (signalRetryMs, 2x each time). */
  private async signalWithRetry(runId: string, name: string, args: unknown[]): Promise<boolean> {
    for (let attempt = 1; attempt <= SIGNAL_ATTEMPTS; attempt += 1) {
      if (await this.signal(runId, name, args)) return true;
      if (attempt < SIGNAL_ATTEMPTS) await new Promise((r) => setTimeout(r, this.signalRetryMs * 2 ** (attempt - 1)));
    }
    this.log.error(`terminal signal ${name} gave up run=${runId}`);
    return false;
  }

  /**
   * Detach must reach the workflow after attach (it clamps the count at 0, so a detach that overtakes its attach would
   * leave the run looking attached forever). If attach never landed there is nothing to balance.
   */
  private async detach(conn: Conn, attachSignal: Promise<boolean>): Promise<void> {
    if (!(await attachSignal)) return;
    await conn.target.onDetach?.(conn.runId, conn.connId).catch(() => undefined); // the run target's signaller already logged the give-up
  }

  /**
   * From here the socket's id is sent to the workflow with its run's other live ids every `leaseIntervalMs`, so an API
   * crash (no detach) stops holding the idle timer after the lease time. Called only after authz and a delivered attach
   * signal; never for a socket that already closed (its detach follows the attach signal instead).
   */
  private beginLease(conn: Conn): void {
    if (conn.closed || !conn.target.onLease) return;
    conn.leased = true;
    this.leases.track(terminalKey(conn.target, conn.runId), conn.connId, (ids) => {
      // Best effort: the signaller logged a give-up; the next tick sends the ids again.
      void conn.target.onLease?.(conn.runId, ids).catch(() => undefined);
    });
  }

  /**
   * Ends this socket's attach client in the pod. Best effort and once per socket (cleanup is idempotent): a failure is
   * logged by error name only and never fails the close. The id is regex-checked by `detachCommand`.
   */
  private sendDetach(conn: Conn): void {
    const podName = conn.podName;
    if (!podName) return;
    const job = (async () => {
      try {
        const s = await this.kube.exec(podName, detachCommand(conn.connId), { tty: false });
        // Resolve when the detach command has exited (not just when its exec stream opened), so shutdown can wait.
        await new Promise<void>((resolve) =>
          s.onClose(() => {
            s.close();
            resolve();
          }),
        );
      } catch (err) {
        this.log.warn(`terminal detach exec failed ${conn.target.kind}=${conn.runId}: ${errorName(err)}`);
      }
    })();
    this.detaching.add(job);
    void job.finally(() => this.detaching.delete(job));
  }

  /** Re-validates the session and authorization of a long-lived socket; an outage never closes it. */
  private async reauth(conn: Conn): Promise<void> {
    if (conn.closed || conn.reauthBusy) return;
    conn.reauthBusy = true;
    try {
      const res = await this.check(conn.headers, conn.target, conn.runId);
      if (!res.ok && (res.code === CLOSE.unauthorized || res.code === CLOSE.forbidden) && !conn.closed) {
        this.log.log(
          `terminal reauth denied ${conn.target.kind}=${conn.runId} user=${conn.userId} code=${res.code} why=${res.why}`,
        );
        this.shut(conn, res.code);
      }
    } catch (err) {
      this.log.warn(`terminal reauth failed ${conn.target.kind}=${conn.runId}: ${errorName(err)}`);
    } finally {
      conn.reauthBusy = false;
    }
  }

  /** Idempotent: close, error, ping timeout and shutdown can all land here. */
  private cleanup(conn: Conn): void {
    if (conn.closed) return;
    conn.closed = true;
    if (conn.pingTimer) clearInterval(conn.pingTimer);
    if (conn.authTimer) clearTimeout(conn.authTimer);
    if (conn.reauthTimer) clearInterval(conn.reauthTimer);
    conn.pending.length = 0;
    try {
      conn.session?.close();
    } catch {
      // the session may already be gone
    }
    this.sendDetach(conn);
    if (conn.leased) this.leases.untrack(terminalKey(conn.target, conn.runId), conn.connId);
    if (conn.registered) {
      const key = terminalKey(conn.target, conn.runId);
      const set = this.byRun.get(key);
      set?.delete(conn);
      if (set?.size === 0) {
        this.byRun.delete(key);
        this.lastPersonInput.delete(key);
      }
    }
    if (conn.attachSignal) {
      this.log.log(`terminal detached ${conn.target.kind}=${conn.runId} user=${conn.userId}`);
      void this.detach(conn, conn.attachSignal);
    }
  }
}

/** Error class name only: messages from the kube/ws layers could carry stream content. */
function errorName(err: unknown): string {
  return err instanceof Error ? err.name : 'error';
}
