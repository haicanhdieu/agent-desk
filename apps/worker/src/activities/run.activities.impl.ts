import { ApplicationFailure } from '@temporalio/common';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  AGENT_TIMEOUT_SECONDS_DEFAULT,
  Provider,
  RunStatus,
  TicketKind,
  toAgentNote,
  type AgentState,
} from '@agentdesk/contracts';
import {
  REPO_URL_KEY,
  SIGNAL,
  WORKSPACE_TOKEN_KEY,
  TMUX_KILL,
  buildPrompt,
  buildRunJob,
  credentialSecretName,
  parseLogLine,
  redact,
  runJobName,
  runLabels,
  runPodConfigFrom,
  runVolumeName,
  toAdapterProject,
  type AdapterProject,
  type AdapterRegistry,
  type Clock,
  type Config,
  type KubeGateway,
  type SecretStore,
} from '@agentdesk/core';
import {
  agents,
  connections,
  organization,
  projects,
  runEvents,
  runs,
  setupScriptVersions,
  withOrg,
  type Db,
  type Tx,
} from '@agentdesk/db';
import { alias } from 'drizzle-orm/pg-core';
import {
  ERROR_MESSAGE_MAX,
  MIN_SECRET_LENGTH,
  guarded,
  oneLine,
  safeError,
  secretValues,
  sleep,
} from './activity-utils';
import {
  followPodLog,
  createSecretAccumulator,
  outputBudget,
  storeLineEvent as storeLineEventIn,
  type FollowPass,
  type LineEventTable,
} from './follow-core';
import { nextRefreshDelaySeconds, type TokenRefreshPlan } from '../workflows/token-refresh';
import { appendRunEvent } from './run-events';
import { setRunStatusTx } from './run-status.activity';
import { createSessionActivities } from './session.activity';
import {
  type CommentKind,
  type FinishDetails,
  type FollowPodLogsResult,
  type RunActivities,
  type RunContext,
} from './run.activities';

/** The run status a protocol state maps to. */
function mapAgentState(state: AgentState): { status: 'running' | 'idle' | 'done'; waitingOn: 'background' | null } {
  switch (state) {
    case 'working':
      return { status: 'running', waitingOn: null };
    case 'waiting':
      return { status: 'running', waitingOn: 'background' };
    case 'needs_input':
      return { status: 'idle', waitingOn: null };
    case 'done':
      return { status: 'done', waitingOn: null };
  }
}

/** Sends a signal to `run-{runId}`; a closed or missing workflow is not an error (activities may outlive it). */
export interface RunSignaller {
  signalRun(runId: string, signal: string, arg?: string): Promise<void>;
}

export type RunActivityConfig = Pick<
  Config,
  | 'RUNNER_IMAGE'
  | 'BOT_NAME'
  | 'BOT_EMAIL'
  | 'RUN_PLUGIN_MARKETPLACES'
  | 'RUN_SETUP_TIMEOUT_SECONDS'
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
  | 'RUN_VOLUME_STORAGE_CLASS'
  | 'RUN_KEPT_DONE_SESSIONS_PER_PROJECT'
  | 'RUN_IDLE_END_SECONDS'
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
/** The runner entrypoint's exit code for a failed (or timed out) setup in a real run. */
const SETUP_FAILED_EXIT_CODE = 78;
/** The runner entrypoint's exit code for a resume with no saved session on the volume. */
const RESUME_FAILED_EXIT_CODE = 79;
const COMMENT_TAIL_CHARS = 2000;
const COMMENT_REASON_CHARS = 500;

/** Where the runner image expects the agent credential (runner contract; the credential store keeps `{type, value}`). */
const CREDENTIAL_ENV: Record<string, string> = {
  oauth_token: 'CLAUDE_CODE_OAUTH_TOKEN',
  api_key: 'ANTHROPIC_API_KEY',
};

const SetupMarkerPayload = z.object({
  kind: z.string(),
  exitCode: z.number().int().optional(),
});
/** The `finish` outbox marker; `status` is absent on markers written before it was recorded. */
const FinishMarker = z.object({ status: z.string().optional() });
const StoredCredential = z.object({ type: z.string(), value: z.string().min(1) });

const isFinal = (s: RunStatus): boolean =>
  s === 'succeeded' || s === 'failed' || s === 'cancelled' || s === 'timed_out';

/**
 * The lines of one final-scrollback block, keeping only the newest `maxChars` (a window over an array with a moving
 * head and a running character count, so each line costs O(1) amortised). `markEnd` records the last end marker;
 * `text()` is everything before it (or everything, when the block never closed).
 */
export class ScrollbackBlock {
  private lines: string[] = [];
  private head = 0;
  private chars = 0;
  /** Lines pushed / dropped since the block began (absolute counts, unaffected by compaction). */
  private pushed = 0;
  private dropped = 0;
  private endAt: number | null = null;
  truncated = false;

  constructor(
    readonly begin: number,
    private readonly maxChars: number,
  ) {}

  get closed(): boolean {
    return this.endAt !== null;
  }

  markEnd(): void {
    this.endAt = this.pushed;
  }

  push(line: string): void {
    const l = line.length > this.maxChars ? line.slice(-this.maxChars) : line;
    if (l !== line) this.truncated = true;
    this.lines.push(l);
    this.pushed += 1;
    this.chars += l.length + 1;
    while (this.chars > this.maxChars && this.lines.length - this.head > 1) {
      this.chars -= (this.lines[this.head]?.length ?? 0) + 1;
      this.head += 1;
      this.dropped += 1;
      this.truncated = true;
    }
    if (this.head > 1024 && this.head * 2 > this.lines.length) {
      this.lines = this.lines.slice(this.head);
      this.head = 0;
    }
  }

  text(): string {
    const window = this.lines.slice(this.head);
    const keep = this.endAt === null ? window.length : Math.max(0, this.endAt - this.dropped);
    return window.slice(0, keep).join('\n');
  }
}

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
  defaultBranch: string | null;
  orgSlug: string | null;
  code: { provider: string; externalId: string };
  board: { provider: string; externalId: string };
  maxTurns: number | null;
  /** `runs.agent_id` now (null when the agent was deleted); resume reads it fresh instead of trusting a RunContext. */
  agentId: string | null;
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
        defaultBranch: projects.defaultBranch,
        codeProvider: code.provider,
        codeExternalId: code.externalId,
        boardProvider: board.provider,
        boardExternalId: board.externalId,
        maxTurns: agents.maxTurns,
        agentId: runs.agentId,
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
      defaultBranch: r.defaultBranch,
      orgSlug: o?.slug ?? null,
      code: { provider: r.codeProvider, externalId: r.codeExternalId },
      board: { provider: r.boardProvider, externalId: r.boardExternalId },
      maxTurns: r.maxTurns,
      agentId: r.agentId,
    };
  }

  const mustDetails = async (orgId: string, runId: string): Promise<RunDetails> => {
    const d = await withOrg(db, orgId, (tx) => details(tx, orgId, runId));
    if (!d) throw ApplicationFailure.nonRetryable('run not found');
    return d;
  };

  const providerOf = (p: string): Provider => {
    const parsed = Provider.safeParse(p);
    if (!parsed.success) throw ApplicationFailure.nonRetryable(`unknown provider "${oneLine(p).slice(0, 40)}"`);
    return parsed.data;
  };

  /**
   * The agent credential as runner env, or null when none is set. The Secret name is derived from (org, agent), never
   * read from the database. A store error propagates (it must not look like "no credential").
   */
  async function credentialEnv(ctx: RunContext): Promise<Record<string, string> | null> {
    if (!ctx.agentId) return null;
    const name = credentialSecretName(ctx.orgId, ctx.agentId);
    let stored: Record<string, string> | null;
    try {
      stored = await deps.secrets.get(name);
    } catch (err) {
      // A store error may quote stored content (a parse error over a corrupt value): keep only its name.
      throw ApplicationFailure.retryable('credential store read failed', err instanceof Error ? err.name : 'Error');
    }
    const parsed = StoredCredential.safeParse(stored);
    if (!parsed.success) return null;
    const key = CREDENTIAL_ENV[parsed.data.type];
    return key ? { [key]: parsed.data.value } : null;
  }

  /**
   * Values to redact from run output. Fails closed: a missing Secret or credential means "no values", but any read
   * error propagates (retryable), so nothing is ever persisted redacted only by the generic patterns.
   */
  async function redactionList(ctx: RunContext): Promise<string[]> {
    const runSecret = await kube.readSecret(runJobName(ctx.runId));
    const cred = await credentialEnv(ctx);
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
      timeoutSeconds: row.timeoutSeconds ?? AGENT_TIMEOUT_SECONDS_DEFAULT,
      maxConcurrentRuns: row.maxConcurrentRuns,
      idleEndSeconds: deps.config.RUN_IDLE_END_SECONDS,
    };
  }

  // ---- createRunSecretAndJob

  /**
   * The setup script body this run's Job gets. The version is recorded on the run once (only while still null), then
   * the body is loaded by that recorded version, so a retry after a newer save still gets the original script. The
   * body stays inside this activity: it is never returned, logged or part of Temporal history.
   */
  async function recordedSetupScript(ctx: RunContext): Promise<string | null> {
    return withOrg(db, ctx.orgId, async (tx) => {
      const [run] = await tx.select({ v: runs.setupScriptVersion }).from(runs).where(eq(runs.id, ctx.runId));
      let version = run?.v ?? null;
      if (version === null) {
        const [current] = await tx
          .select({ version: setupScriptVersions.version, body: setupScriptVersions.body })
          .from(setupScriptVersions)
          .where(eq(setupScriptVersions.projectId, ctx.projectId))
          .orderBy(desc(setupScriptVersions.version))
          .limit(1);
        if (!current || current.body === '') return null;
        await tx
          .update(runs)
          .set({ setupScriptVersion: current.version })
          .where(and(eq(runs.id, ctx.runId), isNull(runs.setupScriptVersion)));
        // A concurrent attempt may have recorded first; the stored value wins.
        const [after] = await tx.select({ v: runs.setupScriptVersion }).from(runs).where(eq(runs.id, ctx.runId));
        version = after?.v ?? null;
        if (version === null) return null;
      }
      const [row] = await tx
        .select({ body: setupScriptVersions.body })
        .from(setupScriptVersions)
        .where(and(eq(setupScriptVersions.projectId, ctx.projectId), eq(setupScriptVersions.version, version)));
      return row && row.body !== '' ? row.body : null;
    });
  }

  async function refreshWorkspaceToken(ctx: RunContext): Promise<TokenRefreshPlan | undefined> {
    const d = await mustDetails(ctx.orgId, ctx.runId);
    if (isFinal(d.status)) return undefined;
    const name = runJobName(ctx.runId);
    let known: string[] = [];
    try {
      const codeHost = deps.adapters.codeHost(providerOf(d.code.provider));
      // The token stays inside this activity (ruling R19); a failure message must not carry it either.
      const { token, expiresAt } = await codeHost.mintWorkspaceToken(toAdapterProject(d, d.code.externalId));
      known = [token];
      if ((await kube.readSecret(name)) === null) {
        throw ApplicationFailure.nonRetryable('the run Secret is gone, so there is nothing to refresh');
      }
      await kube.replaceSecretData(name, { [WORKSPACE_TOKEN_KEY]: token });
      return { nextRefreshSeconds: nextRefreshDelaySeconds(expiresAt, clock.now()) };
    } catch (err) {
      throw safeError(err, known, 'refresh workspace token');
    }
  }

  async function createRunSecretAndJob(
    ctx: RunContext,
    opts: { resume?: boolean; deadlineSeconds?: number } = {},
  ): Promise<TokenRefreshPlan | undefined> {
    const resume = opts.resume === true;
    const d = await mustDetails(ctx.orgId, ctx.runId);
    if (isFinal(d.status)) return undefined;
    // A resume happens long after `ctx` was loaded: the agent and its credential are read fresh (the agent may be gone).
    const cred = await credentialEnv(resume ? { ...ctx, agentId: d.agentId } : ctx);
    if (!cred) {
      throw resume
        ? ApplicationFailure.create({
            type: 'NoAgentCredential',
            nonRetryable: true,
            message: 'the agent or its credential is missing',
          })
        : ApplicationFailure.nonRetryable('the agent has no credential set');
    }
    const name = runJobName(ctx.runId);
    if (resume) {
      // Park deleted the Job, but a foreground delete may still be in progress, and `ensureJob` would not replace a Job
      // that exists. Fail retryably so the activity retry waits it out; if it never clears, the workflow restores the
      // parked run.
      let stillThere: boolean;
      try {
        stillThere = (await kube.getRunPod(name)) !== null;
      } catch (err) {
        throw safeError(err, [], 'create run Job');
      }
      if (stillThere) {
        throw ApplicationFailure.create({
          type: 'RunJobStillPresent',
          nonRetryable: false,
          message: 'create run Job: the parked run Job is still being deleted',
        });
      }
    }
    const project: AdapterProject = toAdapterProject(d, d.code.externalId);
    let known = secretValues(cred);
    let plan: TokenRefreshPlan | undefined;
    try {
      // The setup script does not run again on resume.
      const setupScript = resume ? null : await recordedSetupScript(ctx);
      // The script is untrusted text: keep it out of an error too (the failure reason is posted to the ticket).
      if (setupScript !== null && setupScript.length >= MIN_SECRET_LENGTH) known = [...known, setupScript];
      const codeHost = deps.adapters.codeHost(providerOf(d.code.provider));
      // The token stays inside this activity: it goes into the run Secret and nowhere else (ruling R19).
      const { token, expiresAt } = await codeHost.mintWorkspaceToken(project);
      known = [...known, token];
      plan = { nextRefreshSeconds: nextRefreshDelaySeconds(expiresAt, clock.now()) };
      // The repo URL carries no credential. The token is its own key, mounted as a file so a refresh reaches the
      // running pod (ADR 0021); only the repo URL and the agent credential become env vars.
      await kube.ensureSecret(
        name,
        { [REPO_URL_KEY]: codeHost.repoUrl(project), [WORKSPACE_TOKEN_KEY]: token, ...cred },
        runLabels(ctx),
      );
      const prompt = buildPrompt({
        skillName: d.skillName,
        ticketKind: d.ticketKind,
        ticketNumber: d.ticketNumber,
        repoPath: d.repoPath,
        args: d.args,
      });
      const job = buildRunJob({
        runId: ctx.runId,
        orgId: ctx.orgId,
        projectId: ctx.projectId,
        image: deps.config.RUNNER_IMAGE,
        prompt,
        checkoutRef: d.checkoutRef,
        credentialEnvKeys: Object.keys(cred),
        gitUsername: codeHost.gitCredentialUsername(),
        gitHost: new URL(codeHost.repoUrl(project)).host,
        cliTokenEnvName: codeHost.cliTokenEnvName(),
        maxTurns: d.maxTurns,
        deadlineSeconds: opts.deadlineSeconds ?? ctx.timeoutSeconds,
        resume,
        botName: deps.config.BOT_NAME,
        botEmail: deps.config.BOT_EMAIL,
        pluginMarketplaces: deps.config.RUN_PLUGIN_MARKETPLACES,
        setupTimeoutSeconds: deps.config.RUN_SETUP_TIMEOUT_SECONDS,
        setupScript,
        pod: runPodConfigFrom(deps.config),
      });
      // The per-run volume holds the workspace and the agent's home; it outlives the pod.
      await kube.ensureVolumeClaim(
        runVolumeName(ctx.runId),
        {
          size: deps.config.RUN_POD_WORKSPACE_SIZE_LIMIT,
          ...(deps.config.RUN_VOLUME_STORAGE_CLASS ? { storageClass: deps.config.RUN_VOLUME_STORAGE_CLASS } : {}),
        },
        runLabels(ctx),
      );
      try {
        await kube.ensureJob(job);
      } catch (err) {
        // Do not leave a Secret with a live token behind; the next attempt recreates it with a fresh token.
        await kube.deleteSecret(name).catch(() => undefined);
        throw err;
      }
    } catch (err) {
      throw safeError(err, known, 'create run Job');
    }
    await withOrg(db, ctx.orgId, (tx) => tx.update(runs).set({ jobName: name }).where(eq(runs.id, ctx.runId)));
    return plan;
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
    if (kind === 'paused') {
      return `Agent Desk run #${d.number} is paused: the agent is waiting for an answer, and its pod was stopped after the idle time.\n\nResume it here: ${link}`;
    }
    const status = fd?.status ?? d.status;
    const took = duration(d);
    const setupFailed = fd?.failureStage === 'setup';
    const lines = setupFailed
      ? [`Agent Desk run #${d.number} failed during workspace setup; the agent did not start.`, '']
      : [`Agent Desk run #${d.number} finished: **${status}**${took ? ` after ${took}` : ''}.`, ''];
    if (fd?.exitCode !== undefined && !setupFailed) lines.push(`Exit code: ${fd.exitCode}`);
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
    // The finish comment names the end status, so a re-opened run that ends differently posts again; the same status
    // does not. Marker without a status (written before statuses were recorded) counts as posted.
    const status = kind === 'finish' ? (fd?.status ?? d.status) : undefined;
    const stored = d.outbox[kind];
    if (stored !== undefined) {
      const storedStatus = FinishMarker.safeParse(stored).data?.status;
      if (status === undefined || storedStatus === undefined || storedStatus === status) return; // already posted
    }
    const secrets = secretValues(await credentialEnv(ctx));
    const text = commentText(ctx, d, kind, fd, secrets);
    let commentId: string;
    try {
      const board = deps.adapters.board(providerOf(d.board.provider));
      commentId = await board.comment(toAdapterProject(d, d.board.externalId), d.ticketRef, text);
    } catch (err) {
      throw safeError(err, secrets, `post ${kind} comment`);
    }
    // At least once: a crash between the post and this write posts again on retry.
    await withOrg(db, ctx.orgId, async (tx) => {
      const marker = JSON.stringify({ [kind]: { commentId, at: now(), ...(status !== undefined && { status }) } });
      // Write only if nothing is stored yet, or (finish) the stored status is recorded and differs: a concurrent
      // retry of the same status loses this race and does not append a second event.
      const notYetPosted =
        status === undefined
          ? sql`not (${runs.outbox} ? ${kind})`
          : sql`(not (${runs.outbox} ? ${kind}) or ${runs.outbox} -> ${kind} ->> 'status' is distinct from ${status} and ${runs.outbox} -> ${kind} ? 'status')`;
      const updated = await tx
        .update(runs)
        .set({ outbox: sql`${runs.outbox} || ${marker}::jsonb` })
        .where(and(eq(runs.id, ctx.runId), notYetPosted))
        .returning({ id: runs.id });
      if (updated.length > 0) {
        await appendRunEvent(tx, ctx.orgId, { runId: ctx.runId, type: 'comment', payload: { kind, commentId } });
      }
    });
  }

  // ---- followPodLogs

  /** The run's events as the shared line-event store sees them. */
  const runEventTable = (ctx: RunContext, floor: number): LineEventTable<'lifecycle' | 'scrollback'> => ({
    lock: async (tx) => {
      await tx.select({ id: runs.id }).from(runs).where(eq(runs.id, ctx.runId)).for('update');
    },
    hasLine: async (tx, types, line) => {
      const [dup] = await tx
        .select({ seq: runEvents.seq })
        .from(runEvents)
        .where(
          and(
            eq(runEvents.runId, ctx.runId),
            inArray(runEvents.type, [...types]),
            // A resumed pod's log starts again at line 1: only events since the latest start can be duplicates.
            gt(runEvents.seq, floor),
            sql`(${runEvents.payload} ->> 'line')::int = ${line}`,
          ),
        )
        .limit(1);
      return dup !== undefined;
    },
    append: async (tx, type, payload) =>
      (await appendRunEvent(tx, ctx.orgId, { runId: ctx.runId, type, payload })) !== null,
  });

  /** Inserts a lifecycle/scrollback row for log line `line` (since `floor`) unless one exists. Returns whether it inserted. */
  const storeLineEvent = (
    tx: Tx,
    ctx: RunContext,
    floor: number,
    type: 'lifecycle' | 'scrollback',
    line: number,
    payload: Record<string, unknown>,
  ): Promise<boolean> =>
    storeLineEventIn(tx, runEventTable(ctx, floor), ['lifecycle', 'scrollback'], type, line, payload);

  /**
   * Seq of the run's latest `starting` status event: where the current pod's story begins (the first start, or the
   * latest resume). Log line numbers restart with every pod, so line dedupe and the `session_started` check only look
   * at events after it. 0 when none is stored.
   */
  async function latestStartSeq(ctx: RunContext): Promise<number> {
    const [row] = await withOrg(db, ctx.orgId, (tx) =>
      tx
        .select({ seq: sql<number>`coalesce(max(${runEvents.seq}), 0)::int` })
        .from(runEvents)
        .where(
          and(
            eq(runEvents.runId, ctx.runId),
            eq(runEvents.type, 'status'),
            sql`${runEvents.payload} ->> 'status' = 'starting'`,
          ),
        ),
    );
    return row?.seq ?? 0;
  }

  /**
   * What the stored run events say about the pre-agent phase: whether `session_started` was stored and, if not, whether
   * setup failed (a `setup_failed` / `setup_timed_out` event, or the runner's dedicated exit code 78). Reading the
   * database (not this attempt's memory) keeps the answer stable across activity retries.
   */
  async function findSetupState(
    ctx: RunContext,
    exitCode: number,
    floor: number,
  ): Promise<{ agentStarted: boolean; setup: { exitCode?: number } | null }> {
    const rows = await withOrg(db, ctx.orgId, (tx) =>
      tx
        .select({ payload: runEvents.payload })
        .from(runEvents)
        .where(
          and(
            eq(runEvents.runId, ctx.runId),
            eq(runEvents.type, 'lifecycle'),
            gt(runEvents.seq, floor),
            sql`${runEvents.payload} ->> 'kind' in ('setup_failed', 'setup_timed_out', 'session_started')`,
          ),
        )
        .orderBy(runEvents.seq),
    );
    const kinds = rows.map((r) => SetupMarkerPayload.safeParse(r.payload));
    if (kinds.some((k) => k.success && k.data.kind === 'session_started')) return { agentStarted: true, setup: null };
    const failed = kinds.find(
      (k) => k.success && (k.data.kind === 'setup_failed' || k.data.kind === 'setup_timed_out'),
    );
    if (failed?.success) {
      return {
        agentStarted: false,
        setup: failed.data.exitCode !== undefined ? { exitCode: failed.data.exitCode } : {},
      };
    }
    // The runner exits 78 on a setup failure; honour it even if the marker was lost.
    if (exitCode === SETUP_FAILED_EXIT_CODE) return { agentStarted: false, setup: { exitCode } };
    return { agentStarted: false, setup: null };
  }

  /** Output already stored for the run (all passes and attempts): characters spent and whether it was truncated. */
  async function storedOutputBudget(ctx: RunContext): Promise<{ chars: number; truncated: boolean }> {
    const rows = await withOrg(db, ctx.orgId, (tx) =>
      tx
        .select({ payload: runEvents.payload })
        .from(runEvents)
        .where(
          and(
            eq(runEvents.runId, ctx.runId),
            eq(runEvents.type, 'lifecycle'),
            sql`${runEvents.payload} ->> 'kind' in ('setup_output', 'plugin_output')`,
          ),
        ),
    );
    return outputBudget(rows.map((r) => r.payload));
  }

  async function followPodLogs(ctx: RunContext, opts: { resume?: boolean } = {}): Promise<FollowPodLogsResult> {
    const resume = opts.resume === true;
    // Read on first use (after the pod wait), once per attempt.
    let floorRead: Promise<number> | undefined;
    const floorOf = (): Promise<number> => (floorRead ??= latestStartSeq(ctx));
    let scrollbackTail: string | undefined;
    const textTail: string[] = [];
    let secrets: string[] = [];
    const secretList = createSecretAccumulator();
    // A scrollback block is only durable once stored as one row, so `durable` never moves past an unfinished block and
    // a new pass re-reads it from its begin line. The block is per pass.
    let block: ScrollbackBlock | null = null;
    const flushBlock = async (pass: FollowPass, lastIndex: number): Promise<void> => {
      if (!block) return;
      const text = redact(block.text(), secrets);
      const begin = block.begin;
      const truncated = block.truncated || !block.closed;
      const floor = await floorOf();
      await withOrg(db, ctx.orgId, (tx) => storeLineEvent(tx, ctx, floor, 'scrollback', begin, { text, truncated }));
      scrollbackTail = text.slice(-SCROLLBACK_TAIL_CHARS);
      block = null;
      pass.markDurable(lastIndex);
      pass.beat();
    };

    return followPodLog<FollowPodLogsResult>(
      { kube, clock, pendingLimitMs, pollMs, heartbeatMs },
      {
        what: 'follow pod logs',
        jobName: runJobName(ctx.runId),
        secrets: async () => {
          // Accumulates (bounded): a rotated token is added, recent earlier ones stay redacted.
          secrets = secretList.merge(await redactionList(ctx));
          return secrets;
        },
        storedBudget: () => storedOutputBudget(ctx),
        storeLifecycle: async (line, payload) => {
          const floor = await floorOf();
          await withOrg(db, ctx.orgId, (tx) => storeLineEvent(tx, ctx, floor, 'lifecycle', line, payload));
        },
        beginPass: () => {
          block = null;
        },
        onRawLine: async (_pass, line) => {
          if (!block) return false;
          // Everything after the begin marker is scrollback; the last end marker closes it (a pane line that looks
          // like a marker cannot end it early or fake a lifecycle event).
          if (parseLogLine(line).kind === 'scrollback_end') block.markEnd();
          block.push(line);
          return true;
        },
        onParsed: async (pass, parsed, line) => {
          const index = pass.index;
          const floor = await floorOf();
          if (parsed.kind === 'session_started') {
            // Only the runner's own marker starts the session; setup/plugin output is prefixed and parses as output.
            // `onlyFrom` keeps a replayed line harmless. A resumed run is not written `running`: the workflow
            // writes the state it was stopped in (`idle` or `done`) when it sees the signal below.
            await withOrg(db, ctx.orgId, async (tx) => {
              await storeLineEvent(tx, ctx, floor, 'lifecycle', index, { kind: parsed.kind, text: parsed.text });
              if (!resume) {
                await setRunStatusTx(
                  tx,
                  { orgId: ctx.orgId, runId: ctx.runId, status: 'running', at: now() },
                  { onlyFrom: ['starting'] },
                );
              }
            });
            // Also on a replayed line (a crash between the write and the signal): the workflow ignores a repeat.
            await deps.signaller.signalRun(ctx.runId, SIGNAL.sessionStarted);
          } else if (parsed.kind === 'agent_state' && parsed.agent) {
            const agent = parsed.agent;
            const mapped = mapAgentState(agent.state);
            // The note is redacted with the run's secrets before it reaches the status row; the event keeps no note.
            // Redact the whole text first, then cap: cutting first could split a secret and leave a prefix behind.
            const agentNote = agent.note !== undefined ? toAgentNote(redact(agent.note, secrets)) : undefined;
            const { inserted, status } = await withOrg(db, ctx.orgId, async (tx) => {
              const ins = await storeLineEvent(tx, ctx, floor, 'lifecycle', index, {
                kind: 'agent_state',
                state: agent.state,
                source: agent.source ?? null,
                waitingOn: agent.waitingOn ?? null,
              });
              const [before] = await tx
                .select({ status: runs.status, waitingOn: runs.waitingOn })
                .from(runs)
                .where(eq(runs.id, ctx.runId));
              // A `working` line while already plainly running changes nothing: no duplicate status event.
              const unchanged =
                mapped.status === 'running' && before?.status === 'running' && before.waitingOn === mapped.waitingOn;
              if (ins && !unchanged) {
                await setRunStatusTx(
                  tx,
                  {
                    orgId: ctx.orgId,
                    runId: ctx.runId,
                    status: mapped.status,
                    waitingOn: mapped.waitingOn,
                    ...(agentNote !== undefined ? { agentNote } : {}),
                    at: now(),
                  },
                  { onlyFrom: ['starting', 'running', 'idle', 'done'] },
                );
              }
              const [cur] = await tx.select({ status: runs.status }).from(runs).where(eq(runs.id, ctx.runId));
              return { inserted: ins, status: cur?.status };
            });
            // A replayed line (crash after the write, before the signal) re-signals only while the run still shows
            // the status this line mapped to; the workflow ignores a signal that does not apply to its phase.
            if (inserted || status === mapped.status)
              await deps.signaller.signalRun(ctx.runId, SIGNAL.agentState, agent.state);
          } else if (parsed.kind === 'scrollback_begin') {
            block = new ScrollbackBlock(index, SCROLLBACK_MAX_CHARS);
            return 'skipDurable';
          } else if (parsed.kind === 'text') {
            textTail.push(redact(line, secrets));
            if (textTail.length > TEXT_TAIL_LINES) textTail.shift();
          }
          return undefined;
        },
        afterStream: async (pass) => {
          await pass.throwIfCancelled();
          const exitCode = await waitForExit(ctx, pass.signal);
          await pass.throwIfCancelled();
          // The log stream dropped while the container still runs: re-attach. An unfinished block is not stored; the
          // next pass re-reads it from its begin line (`durable` never passed it).
          if (exitCode === 'running') return 'reattach';
          await flushBlock(pass, pass.index);
          await pass.flushPending();
          pass.markDurable(pass.index);
          pass.beat();
          const pre = await findSetupState(ctx, exitCode, resume ? await floorOf() : 0);
          // The runner exits 79 when the volume holds no started session: nothing to continue (not a setup failure).
          const resumeFailed = resume && exitCode === RESUME_FAILED_EXIT_CODE && !pre.agentStarted;
          const tail =
            scrollbackTail ?? (textTail.length > 0 ? textTail.join('\n').slice(-SCROLLBACK_TAIL_CHARS) : undefined);
          return {
            done: {
              exitCode,
              ...(tail !== undefined ? { scrollbackTail: tail } : {}),
              agentStarted: pre.agentStarted,
              ...(resumeFailed ? { resumeFailed: true as const } : {}),
              ...(pre.setup && !resumeFailed ? { failureStage: 'setup' as const } : {}),
              ...(pre.setup?.exitCode !== undefined && !resumeFailed ? { setupExitCode: pre.setup.exitCode } : {}),
            },
          };
        },
      },
    );
  }

  /** The container's exit code once its log ended; 'running' when it still runs (the stream merely dropped). */
  async function waitForExit(ctx: RunContext, signal: AbortSignal): Promise<number | 'running'> {
    const deadline = clock.now().getTime() + EXIT_WAIT_MS;
    for (;;) {
      const pod = await kube.getRunPod(runJobName(ctx.runId));
      if (!pod) throw ApplicationFailure.nonRetryable('the run pod disappeared before it reported an exit code');
      if (pod.exitCode !== null) return pod.exitCode;
      if (clock.now().getTime() > deadline) {
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

  /** Deletes the run's volume claim; missing → success. Only the workflow's cleanup calls this. */
  async function deleteRunVolume(ctx: RunContext): Promise<void> {
    try {
      await kube.deleteVolumeClaim(runVolumeName(ctx.runId));
    } catch (err) {
      throw safeError(err, [], 'delete run volume');
    }
  }

  const session = createSessionActivities({
    db,
    config: deps.config,
    signaller: deps.signaller,
    redactionValues: async (ctx) => secretValues(await credentialEnv(ctx)),
  });

  return {
    loadRun: guarded('load run', loadRun),
    createRunSecretAndJob: guarded('create run Job', createRunSecretAndJob),
    refreshWorkspaceToken: guarded('refresh workspace token', refreshWorkspaceToken),
    postComment: guarded('post comment', postComment),
    followPodLogs: guarded('follow pod logs', followPodLogs),
    endSession: guarded('end session', endSession),
    deleteJob: guarded('delete run Job', deleteJob),
    ensureJobGone: guarded('clean up run Job', ensureJobGone),
    deleteRunVolume: guarded('delete run volume', deleteRunVolume),
    parkRun: guarded('park run', session.parkRun),
    endKeptSession: guarded('end kept session', session.endKeptSession),
    restoreParked: guarded('restore parked run', session.restoreParked),
  };
}
