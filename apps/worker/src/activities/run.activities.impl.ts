import { Context } from '@temporalio/activity';
import { ApplicationFailure, CancelledFailure } from '@temporalio/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { RunStatus, TicketKind } from '@agentdesk/contracts';
import {
  IDLE_END_SECONDS,
  SIGNAL,
  TMUX_KILL,
  buildPrompt,
  buildRunJob,
  credentialSecretName,
  parseLogLine,
  redact,
  runJobName,
  runLabels,
  runPodConfigFrom,
  type AdapterProject,
  type AdapterRegistry,
  type Clock,
  type Config,
  type KubeGateway,
  type RunPod,
  type SecretStore,
} from '@agentdesk/core';
import { agents, connections, organization, projects, runEvents, runs, withOrg, type Db, type Tx } from '@agentdesk/db';
import { alias } from 'drizzle-orm/pg-core';
import { appendRunEvent } from './run-events';
import { setRunStatusTx } from './run-status.activity';
import {
  POD_PENDING_TIMEOUT,
  type CommentKind,
  type FinishDetails,
  type FollowPodLogsResult,
  type RunActivities,
  type RunContext,
} from './run.activities';

/** Sends a signal to `run-{runId}`; a closed or missing workflow is not an error (activities may outlive it). */
export interface RunSignaller {
  signalRun(runId: string, signal: string): Promise<void>;
}

export type RunActivityConfig = Pick<
  Config,
  | 'RUNNER_IMAGE'
  | 'BOT_NAME'
  | 'BOT_EMAIL'
  | 'PUBLIC_ORIGIN'
  | 'RUN_POD_CPU_REQUEST'
  | 'RUN_POD_CPU_LIMIT'
  | 'RUN_POD_MEMORY_REQUEST'
  | 'RUN_POD_MEMORY_LIMIT'
  | 'RUN_POD_EPHEMERAL_STORAGE_LIMIT'
  | 'RUN_POD_WORKSPACE_SIZE_LIMIT'
  | 'RUN_POD_NODE_SELECTOR'
  | 'RUN_POD_TOLERATIONS'
  | 'RUN_POD_RUNTIME_CLASS'
>;

export interface RunActivityTiming {
  /** Pod Pending limit (spec: 2 min). */
  pendingLimitMs?: number;
  /** Poll interval while waiting for the pod / its exit code. */
  pollMs?: number;
  /** followPodLogs heartbeat interval (spec: 10 s). */
  heartbeatMs?: number;
}

export interface RunActivityDeps {
  db: Db;
  kube: KubeGateway;
  adapters: AdapterRegistry;
  secrets: SecretStore;
  signaller: RunSignaller;
  clock: Clock;
  config: RunActivityConfig;
  timing?: RunActivityTiming;
}

export type RunActivityImpls = Omit<RunActivities, 'requestSlot' | 'setRunStatus'>;

const PENDING_LIMIT_MS = 2 * 60 * 1000;
const POLL_MS = 1000;
const HEARTBEAT_MS = 10_000;
/** How long to wait for the container's exit code after its log stream ended. */
const EXIT_WAIT_MS = 60_000;
const EXEC_CLOSE_WAIT_MS = 30_000;
const SCROLLBACK_MAX_CHARS = 1_000_000;
const SCROLLBACK_TAIL_CHARS = 4000;
const TEXT_TAIL_LINES = 50;
const ERROR_MESSAGE_MAX = 500;
const COMMENT_TAIL_CHARS = 2000;
const COMMENT_REASON_CHARS = 500;
/** Secret values shorter than this are not used for redaction (they would blank out ordinary text). */
const MIN_SECRET_LENGTH = 6;

/** Where the runner image expects the agent credential (runner contract; the credential store keeps `{type, value}`). */
const CREDENTIAL_ENV: Record<string, string> = {
  oauth_token: 'CLAUDE_CODE_OAUTH_TOKEN',
  api_key: 'ANTHROPIC_API_KEY',
};
const CLONE_URL_KEY = 'REPO_CLONE_URL';

const HeartbeatDetails = z.object({ lastLine: z.number().int().min(0) });
const StoredCredential = z.object({ type: z.string(), value: z.string().min(1) });

const isFinal = (s: RunStatus): boolean =>
  s === 'succeeded' || s === 'failed' || s === 'cancelled' || s === 'timed_out';

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done(): void {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });

/** Values worth redacting: each value, plus the user/password parts of URL values (the clone URL's token). */
function secretValues(data: Record<string, string> | null | undefined): string[] {
  const out: string[] = [];
  for (const v of Object.values(data ?? {})) {
    out.push(v);
    try {
      const u = new URL(v);
      if (u.password) out.push(decodeURIComponent(u.password), u.password);
      if (u.username && u.password) out.push(decodeURIComponent(u.username));
    } catch {
      // not a URL
    }
  }
  return [...new Set(out.filter((s) => s.length >= MIN_SECRET_LENGTH))];
}

/**
 * Activity errors end up in Temporal history, `runs.failure_reason` and the finish comment: re-throw anything that is
 * not ours as an ApplicationFailure with a redacted, bounded message (the original error is dropped, not chained).
 */
function safeError(err: unknown, secrets: string[], what: string): Error {
  if (err instanceof ApplicationFailure || err instanceof CancelledFailure) return err;
  const raw = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : 'Error';
  const message = redact(raw, secrets).replace(/\s+/g, ' ').slice(0, ERROR_MESSAGE_MAX);
  return ApplicationFailure.retryable(`${what}: ${message}`, name);
}

const oneLine = (s: string): string => s.replace(/[\r\n\u2028\u2029]+/g, ' ').trim();

interface RunDetails {
  number: number;
  status: RunStatus;
  command: string;
  skillName: string;
  ticketRef: string;
  ticketKind: TicketKind;
  ticketNumber: number;
  checkoutRef: string;
  args: string;
  outbox: Record<string, unknown>;
  startedAt: Date | null;
  finishedAt: Date | null;
  repoPath: string;
  orgSlug: string | null;
  code: { provider: string; externalId: string };
  board: { provider: string; externalId: string };
  maxTurns: number | null;
  credentialSecretName: string | null;
}

export function createRunActivities(deps: RunActivityDeps): RunActivityImpls {
  const { db, kube, clock } = deps;
  const pendingLimitMs = deps.timing?.pendingLimitMs ?? PENDING_LIMIT_MS;
  const pollMs = deps.timing?.pollMs ?? POLL_MS;
  const heartbeatMs = deps.timing?.heartbeatMs ?? HEARTBEAT_MS;
  const now = (): string => clock.now().toISOString();

  async function details(tx: Tx, orgId: string, runId: string): Promise<RunDetails | null> {
    const code = alias(connections, 'code');
    const board = alias(connections, 'board');
    const [r] = await tx
      .select({
        number: runs.number,
        status: runs.status,
        command: runs.command,
        skillName: runs.skillName,
        ticketRef: runs.ticketRef,
        ticketKind: runs.ticketKind,
        ticketNumber: runs.ticketNumber,
        checkoutRef: runs.checkoutRef,
        args: runs.args,
        outbox: runs.outbox,
        startedAt: runs.startedAt,
        finishedAt: runs.finishedAt,
        repoPath: projects.repoPath,
        codeProvider: code.provider,
        codeExternalId: code.externalId,
        boardProvider: board.provider,
        boardExternalId: board.externalId,
        maxTurns: agents.maxTurns,
        credentialSecretName: agents.credentialSecretName,
      })
      .from(runs)
      .innerJoin(projects, eq(projects.id, runs.projectId))
      .innerJoin(code, eq(code.id, projects.codeConnectionId))
      .innerJoin(board, eq(board.id, projects.boardConnectionId))
      .leftJoin(agents, eq(agents.id, runs.agentId))
      .where(eq(runs.id, runId));
    if (!r) return null;
    const [o] = await tx.select({ slug: organization.slug }).from(organization).where(eq(organization.id, orgId));
    const ticketNumber = r.ticketNumber ?? Number.parseInt(r.ticketRef.replace(/^#/, ''), 10);
    return {
      number: r.number,
      status: RunStatus.parse(r.status),
      command: r.command,
      skillName: r.skillName,
      ticketRef: r.ticketRef,
      ticketKind: TicketKind.parse(r.ticketKind),
      ticketNumber: Number.isInteger(ticketNumber) ? ticketNumber : 0,
      checkoutRef: r.checkoutRef,
      args: r.args ?? '',
      outbox: r.outbox,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      repoPath: r.repoPath,
      orgSlug: o?.slug ?? null,
      code: { provider: r.codeProvider, externalId: r.codeExternalId },
      board: { provider: r.boardProvider, externalId: r.boardExternalId },
      maxTurns: r.maxTurns,
      credentialSecretName: r.credentialSecretName,
    };
  }

  const mustDetails = async (orgId: string, runId: string): Promise<RunDetails> => {
    const d = await withOrg(db, orgId, (tx) => details(tx, orgId, runId));
    if (!d) throw ApplicationFailure.nonRetryable('run not found');
    return d;
  };

  const providerOf = (p: string) => {
    if (p !== 'github' && p !== 'fake') throw ApplicationFailure.nonRetryable(`unknown provider "${oneLine(p)}"`);
    return p;
  };

  /** The agent credential as runner env, or null when none is set. */
  async function credentialEnv(ctx: RunContext, d: RunDetails): Promise<Record<string, string> | null> {
    if (!ctx.agentId) return null;
    const name = d.credentialSecretName ?? credentialSecretName(ctx.orgId, ctx.agentId);
    const parsed = StoredCredential.safeParse(await deps.secrets.get(name));
    if (!parsed.success) return null;
    const key = CREDENTIAL_ENV[parsed.data.type];
    return key ? { [key]: parsed.data.value } : null;
  }

  async function redactionList(ctx: RunContext): Promise<string[]> {
    const runSecret = await kube.readSecret(runJobName(ctx.runId)).catch(() => null);
    let cred: Record<string, string> | null = null;
    if (ctx.agentId) {
      const d = await withOrg(db, ctx.orgId, (tx) => details(tx, ctx.orgId, ctx.runId)).catch(() => null);
      if (d) cred = await credentialEnv(ctx, d).catch(() => null);
    }
    return [...new Set([...secretValues(runSecret), ...secretValues(cred)])];
  }

  // ---- loadRun

  async function loadRun(orgId: string, runId: string): Promise<RunContext> {
    const row = await withOrg(db, orgId, async (tx) => {
      const [r] = await tx
        .select({
          projectId: runs.projectId,
          agentId: runs.agentId,
          status: runs.status,
          maxConcurrentRuns: projects.maxConcurrentRuns,
          timeoutSeconds: agents.timeoutSeconds,
        })
        .from(runs)
        .innerJoin(projects, eq(projects.id, runs.projectId))
        .leftJoin(agents, eq(agents.id, runs.agentId))
        .where(eq(runs.id, runId));
      return r;
    });
    if (!row) throw ApplicationFailure.nonRetryable('run not found');
    return {
      orgId,
      runId,
      projectId: row.projectId,
      agentId: row.agentId,
      status: RunStatus.parse(row.status),
      // An agent deleted after queueing: fall back to the agents.timeout_seconds default.
      timeoutSeconds: row.timeoutSeconds ?? 1800,
      maxConcurrentRuns: row.maxConcurrentRuns,
      idleEndSeconds: IDLE_END_SECONDS,
    };
  }

  // ---- createRunSecretAndJob

  async function createRunSecretAndJob(ctx: RunContext): Promise<void> {
    const d = await mustDetails(ctx.orgId, ctx.runId);
    if (isFinal(d.status)) return;
    const cred = await credentialEnv(ctx, d);
    if (!cred) throw ApplicationFailure.nonRetryable('the agent has no credential set');
    const name = runJobName(ctx.runId);
    const project: AdapterProject = { repoPath: d.repoPath, connectionExternalId: d.code.externalId };
    let known = secretValues(cred);
    try {
      const codeHost = deps.adapters.codeHost(providerOf(d.code.provider));
      // The token stays inside this activity: it goes into the run Secret and nowhere else (ruling R19).
      const { token } = await codeHost.mintWorkspaceToken(project);
      known = [...known, token];
      const cloneUrl = codeHost.cloneUrl(project, token);
      known = [...known, ...secretValues({ cloneUrl })];
      await kube.ensureSecret(name, { [CLONE_URL_KEY]: cloneUrl, ...cred }, runLabels(ctx));
      const prompt = buildPrompt({
        skillName: d.skillName,
        ticketKind: d.ticketKind,
        ticketNumber: d.ticketNumber,
        repoPath: d.repoPath,
        args: d.args,
      });
      await kube.ensureJob(
        buildRunJob({
          runId: ctx.runId,
          orgId: ctx.orgId,
          projectId: ctx.projectId,
          image: deps.config.RUNNER_IMAGE,
          prompt,
          checkoutRef: d.checkoutRef,
          cloneUrlSecretKey: CLONE_URL_KEY,
          maxTurns: d.maxTurns,
          timeoutSeconds: ctx.timeoutSeconds,
          botName: deps.config.BOT_NAME,
          botEmail: deps.config.BOT_EMAIL,
          pod: runPodConfigFrom(deps.config),
        }),
      );
    } catch (err) {
      throw safeError(err, known, 'create run Job');
    }
    await withOrg(db, ctx.orgId, (tx) => tx.update(runs).set({ jobName: name }).where(eq(runs.id, ctx.runId)));
  }

  // ---- postComment

  function runLink(ctx: RunContext, d: RunDetails): string {
    const origin = deps.config.PUBLIC_ORIGIN.replace(/\/+$/, '');
    return d.orgSlug
      ? `${origin}/o/${encodeURIComponent(d.orgSlug)}/p/${ctx.projectId}/runs/${d.number}`
      : `${origin}/api/runs/${ctx.runId}`;
  }

  function duration(d: RunDetails): string | null {
    if (!d.startedAt) return null;
    const end = d.finishedAt ?? clock.now();
    const s = Math.max(0, Math.round((end.getTime() - d.startedAt.getTime()) / 1000));
    const m = Math.floor(s / 60);
    return m > 0 ? `${m} min ${s % 60} s` : `${s} s`;
  }

  function commentText(
    ctx: RunContext,
    d: RunDetails,
    kind: CommentKind,
    fd: FinishDetails | undefined,
    secrets: string[],
  ) {
    const link = runLink(ctx, d);
    if (kind === 'start') {
      return `Agent Desk started run #${d.number} (\`/${oneLine(d.command)}\`, skill \`${oneLine(d.skillName)}\`).\n\nFollow it here: ${link}`;
    }
    const status = fd?.status ?? d.status;
    const took = duration(d);
    const lines = [`Agent Desk run #${d.number} finished: **${status}**${took ? ` after ${took}` : ''}.`, ''];
    if (fd?.exitCode !== undefined) lines.push(`Exit code: ${fd.exitCode}`);
    if (fd?.failureReason) {
      lines.push(`Reason: ${oneLine(redact(fd.failureReason, secrets)).slice(0, COMMENT_REASON_CHARS)}`);
    }
    if (fd?.scrollbackTail) {
      const tail = redact(fd.scrollbackTail, secrets)
        .slice(-COMMENT_TAIL_CHARS)
        .replace(/`{3,}/g, (m) => m.split('').join('\u200b'));
      lines.push('', '<details><summary>Last output</summary>', '', '```', tail, '```', '', '</details>');
    }
    lines.push('', `Run: ${link}`);
    return lines.join('\n');
  }

  async function postComment(ctx: RunContext, kind: CommentKind, fd?: FinishDetails): Promise<void> {
    const d = await mustDetails(ctx.orgId, ctx.runId);
    if (d.outbox[kind] !== undefined) return; // already posted
    const secrets = secretValues(await credentialEnv(ctx, d).catch(() => null));
    const text = commentText(ctx, d, kind, fd, secrets);
    let commentId: string;
    try {
      const board = deps.adapters.board(providerOf(d.board.provider));
      commentId = await board.comment(
        { repoPath: d.repoPath, connectionExternalId: d.board.externalId },
        d.ticketRef,
        text,
      );
    } catch (err) {
      throw safeError(err, secrets, `post ${kind} comment`);
    }
    // At least once: a crash between the post and this write posts again on retry.
    await withOrg(db, ctx.orgId, async (tx) => {
      const marker = JSON.stringify({ [kind]: { commentId, at: now() } });
      const updated = await tx
        .update(runs)
        .set({ outbox: sql`${runs.outbox} || ${marker}::jsonb` })
        .where(and(eq(runs.id, ctx.runId), sql`not (${runs.outbox} ? ${kind})`))
        .returning({ id: runs.id });
      if (updated.length > 0) {
        await appendRunEvent(tx, ctx.orgId, { runId: ctx.runId, type: 'comment', payload: { kind, commentId } });
      }
    });
  }

  // ---- followPodLogs

  /** Inserts a lifecycle/scrollback row for log line `line` unless one exists. Returns whether it inserted. */
  async function storeLineEvent(
    tx: Tx,
    ctx: RunContext,
    type: 'lifecycle' | 'scrollback',
    line: number,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    await tx.select({ id: runs.id }).from(runs).where(eq(runs.id, ctx.runId)).for('update');
    const [dup] = await tx
      .select({ seq: runEvents.seq })
      .from(runEvents)
      .where(
        and(
          eq(runEvents.runId, ctx.runId),
          inArray(runEvents.type, ['lifecycle', 'scrollback']),
          sql`(${runEvents.payload} ->> 'line')::int = ${line}`,
        ),
      )
      .limit(1);
    if (dup) return false;
    return (await appendRunEvent(tx, ctx.orgId, { runId: ctx.runId, type, payload: { line, ...payload } })) !== null;
  }

  async function waitForPod(ctx: RunContext, signal: AbortSignal): Promise<RunPod> {
    const jobName = runJobName(ctx.runId);
    let firstSeen: Date | null = null;
    for (;;) {
      if (signal.aborted) throw new CancelledFailure('cancelled');
      const pod = await kube.getRunPod(jobName);
      if (pod && pod.phase !== 'Pending' && pod.phase !== 'Unknown') return pod;
      const at = clock.now();
      firstSeen ??= at;
      const since = pod?.pendingSince ?? firstSeen;
      if (at.getTime() - since.getTime() > pendingLimitMs) {
        const reason = pod?.reason ? oneLine(pod.reason).slice(0, ERROR_MESSAGE_MAX) : 'no pod was created';
        throw ApplicationFailure.create({
          type: POD_PENDING_TIMEOUT,
          nonRetryable: true,
          message: `pod pending for over ${Math.round(pendingLimitMs / 1000)} s: ${reason}`,
        });
      }
      await sleep(pollMs, signal);
    }
  }

  async function followPodLogs(ctx: RunContext): Promise<FollowPodLogsResult> {
    const actx = Context.current();
    const resumed = HeartbeatDetails.safeParse(actx.info.heartbeatDetails);
    /** Lines whose effects are durable; the next attempt skips them. */
    let durable = resumed.success ? resumed.data.lastLine : 0;
    const beat = (): void => actx.heartbeat({ lastLine: durable });
    beat();
    const timer = setInterval(beat, heartbeatMs);
    const ac = new AbortController();
    const onCancel = (): void => ac.abort();
    actx.cancellationSignal.addEventListener('abort', onCancel, { once: true });
    const throwIfCancelled = async (): Promise<void> => {
      if (actx.cancellationSignal.aborted) {
        await actx.cancelled; // rejects with the CancelledFailure
        throw new CancelledFailure('cancelled');
      }
    };
    let secrets: string[] = [];
    try {
      secrets = await redactionList(ctx);
      let runningChecked = false;
      let scrollbackTail: string | undefined;
      const textTail: string[] = [];

      for (;;) {
        const pod = await waitForPod(ctx, ac.signal);
        // State of one pass over the log. A scrollback block is only durable once stored as one row, so `durable`
        // never moves past an unfinished block and a new pass re-reads it from its begin line.
        let index = 0;
        let block: { begin: number; lines: string[]; endAt: number | null; truncated: boolean } | null = null;
        const flushBlock = async (lastIndex: number): Promise<void> => {
          if (!block) return;
          const raw = (block.endAt !== null ? block.lines.slice(0, block.endAt) : block.lines).join('\n');
          const text = redact(raw, secrets);
          const begin = block.begin;
          const truncated = block.truncated || block.endAt === null;
          await withOrg(db, ctx.orgId, (tx) => storeLineEvent(tx, ctx, 'scrollback', begin, { text, truncated }));
          scrollbackTail = text.slice(-SCROLLBACK_TAIL_CHARS);
          block = null;
          durable = Math.max(durable, lastIndex);
          beat();
        };

        const skip = durable;
        for await (const line of kube.streamLogs(pod.name, ac.signal)) {
          index += 1;
          if (index <= skip) continue;
          if (block) {
            // Everything after the begin marker is scrollback; the last end marker closes it (a pane line that looks
            // like a marker cannot end it early or fake a lifecycle event).
            if (parseLogLine(line).kind === 'scrollback_end') block.endAt = block.lines.length;
            block.lines.push(line);
            if (block.lines.join('\n').length > SCROLLBACK_MAX_CHARS) {
              block.lines.shift();
              if (block.endAt !== null) block.endAt -= 1;
              block.truncated = true;
            }
            continue;
          }
          const parsed = parseLogLine(line);
          if (!runningChecked) {
            runningChecked = true;
            await withOrg(db, ctx.orgId, (tx) =>
              setRunStatusTx(
                tx,
                { orgId: ctx.orgId, runId: ctx.runId, status: 'running', at: now() },
                { onlyFrom: ['starting'] },
              ),
            );
          }
          if (parsed.kind === 'session_started') {
            await withOrg(db, ctx.orgId, (tx) =>
              storeLineEvent(tx, ctx, 'lifecycle', index, { kind: parsed.kind, text: parsed.text }),
            );
          } else if (parsed.kind === 'turn_finished') {
            const { inserted, status } = await withOrg(db, ctx.orgId, async (tx) => {
              const ins = await storeLineEvent(tx, ctx, 'lifecycle', index, { kind: parsed.kind, text: parsed.text });
              if (ins) {
                await setRunStatusTx(
                  tx,
                  { orgId: ctx.orgId, runId: ctx.runId, status: 'idle', at: now() },
                  { onlyFrom: ['starting', 'running'] },
                );
              }
              const [cur] = await tx.select({ status: runs.status }).from(runs).where(eq(runs.id, ctx.runId));
              return { inserted: ins, status: cur?.status };
            });
            // A replayed line (crash after the write, before the signal) re-signals only while the run is still idle;
            // the workflow ignores turnFinished unless it is running.
            if (inserted || status === 'idle') await deps.signaller.signalRun(ctx.runId, SIGNAL.turnFinished);
          } else if (parsed.kind === 'scrollback_begin') {
            block = { begin: index, lines: [], endAt: null, truncated: false };
            continue;
          } else if (parsed.kind === 'text') {
            textTail.push(redact(line, secrets));
            if (textTail.length > TEXT_TAIL_LINES) textTail.shift();
          }
          durable = Math.max(durable, index);
          beat();
        }
        await throwIfCancelled();
        if (block) await flushBlock(index);

        const exitCode = await waitForExit(ctx, ac.signal);
        await throwIfCancelled();
        if (exitCode === 'running') continue; // the log stream dropped while the container still runs: re-attach
        const tail =
          scrollbackTail ?? (textTail.length > 0 ? textTail.join('\n').slice(-SCROLLBACK_TAIL_CHARS) : undefined);
        return { exitCode, ...(tail !== undefined ? { scrollbackTail: tail } : {}) };
      }
    } catch (err) {
      if (actx.cancellationSignal.aborted && !(err instanceof ApplicationFailure)) {
        await throwIfCancelled();
      }
      throw safeError(err, secrets, 'follow pod logs');
    } finally {
      clearInterval(timer);
      actx.cancellationSignal.removeEventListener('abort', onCancel);
      ac.abort();
    }
  }

  /** The container's exit code once its log ended; 'running' when it still runs (the stream merely dropped). */
  async function waitForExit(ctx: RunContext, signal: AbortSignal): Promise<number | 'running'> {
    const deadline = Date.now() + EXIT_WAIT_MS;
    for (;;) {
      const pod = await kube.getRunPod(runJobName(ctx.runId));
      if (!pod) throw ApplicationFailure.nonRetryable('the run pod disappeared before it reported an exit code');
      if (pod.exitCode !== null) return pod.exitCode;
      if (Date.now() > deadline) {
        if (pod.phase === 'Running') return 'running';
        const reason = pod.reason ? `: ${oneLine(pod.reason).slice(0, ERROR_MESSAGE_MAX)}` : '';
        throw ApplicationFailure.nonRetryable(`the run pod ended (${pod.phase}) without an exit code${reason}`);
      }
      if (signal.aborted) return 'running';
      await sleep(pollMs, signal);
    }
  }

  // ---- endSession, deleteJob, ensureJobGone

  async function endSession(ctx: RunContext): Promise<void> {
    try {
      const pod = await kube.getRunPod(runJobName(ctx.runId));
      if (!pod || pod.phase !== 'Running') return; // nothing to end
      const session = await kube.exec(pod.name, [...TMUX_KILL], { tty: false });
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          session.close();
          resolve();
        }, EXEC_CLOSE_WAIT_MS);
        // A non-zero code (no such session) means it is already gone: fine either way.
        session.onClose(() => {
          clearTimeout(t);
          resolve();
        });
      });
    } catch (err) {
      throw safeError(err, [], 'end session');
    }
  }

  async function deleteJob(ctx: RunContext): Promise<void> {
    const name = runJobName(ctx.runId);
    try {
      await kube.deleteJob(name);
      await kube.deleteSecret(name);
    } catch (err) {
      throw safeError(err, [], 'delete run Job');
    }
  }

  async function ensureJobGone(ctx: RunContext): Promise<void> {
    const name = runJobName(ctx.runId);
    try {
      const pod = await kube.getRunPod(name);
      // A finished Job stays (ttlSecondsAfterFinished) for debugging; one still running is deleted.
      if (pod && pod.exitCode === null && pod.phase !== 'Succeeded' && pod.phase !== 'Failed')
        await kube.deleteJob(name);
      await kube.deleteSecret(name);
    } catch (err) {
      throw safeError(err, [], 'clean up run Job');
    }
  }

  return { loadRun, createRunSecretAndJob, postComment, followPodLogs, endSession, deleteJob, ensureJobGone };
}
