import { log } from '@temporalio/activity';
import { ApplicationFailure } from '@temporalio/common';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  AGENT_IDLE_END_SECONDS_DEFAULT,
  AGENT_TIMEOUT_SECONDS_DEFAULT,
  AgentKind,
  CredentialType,
  Provider,
  RunStatus,
  TicketKind,
  toAgentNote,
  type AgentState,
} from '@agentdesk/contracts';
import {
  agentAdapterFor,
  END_COMMAND,
  END_REASONS,
  EXEC_NOT_FOUND,
  IDLE_END_SECONDS,
  REPO_URL_KEY,
  SIGNAL,
  WORKSPACE_TOKEN_KEY,
  TMUX_KILL,
  buildPrompt,
  classifyKubeError,
  promptSourceOf,
  buildRunJob,
  credentialMatchesAddress,
  credentialSecretName,
  parseCredentialSecret,
  parseLogLine,
  redact,
  runJobName,
  runLabels,
  runPodConfigFrom,
  resolveRunAuthor,
  runVolumeName,
  toAdapterProject,
  type AdapterProject,
  type AdapterRegistry,
  type Clock,
  type EndReason,
  type LogLineKind,
  type Config,
  type KubeGateway,
  type SecretStore,
} from '@agentdesk/core';
import {
  agents,
  connections,
  notifyRunStatus,
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
  clusterRefused,
  followPodLog,
  createSecretAccumulator,
  outputBudget,
  storeLineEvent as storeLineEventIn,
  type FollowPass,
  type LineEventTable,
} from './follow-core';
import { nextRefreshDelaySeconds, type TokenRefreshPlan } from '../workflows/token-refresh';
import { appendRunEvent, currentSeq } from './run-events';
import { setRunStatusTx } from './run-status.activity';
import { createSessionActivities } from './session.activity';
import { createTranscriptSink } from './transcript-store';
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
  | 'RUN_RECONNECT_WINDOW_SECONDS'
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
  | 'RUN_ENDING_DEADLINE_SECONDS'
  | 'RUN_LEASE_TTL_SECONDS'
>;

export interface RunActivityTiming {
  /** Pod Pending limit (spec: 2 min). */
  pendingLimitMs?: number;
  /** Poll interval while waiting for the pod / its exit code. */
  pollMs?: number;
  /** followPodLogs heartbeat interval (spec: 10 s). */
  heartbeatMs?: number;
  /** How long the cluster may stay unreachable before the follower gives up (default: `RUN_RECONNECT_WINDOW_SECONDS`). */
  reconnectWindowMs?: number;
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

const SetupMarkerPayload = z.object({
  kind: z.string(),
  exitCode: z.number().int().optional(),
});
/** A stored `session_ended` event: only an enum value and a number are ever kept from the runner's end line. */
const EndMarkerPayload = z.object({ reason: z.enum(END_REASONS), code: z.number().int() });
/** The `finish` outbox marker; `status` is absent on markers written before it was recorded. */
const FinishMarker = z.object({ status: z.string().optional() });

const isFinal = (s: RunStatus): boolean =>
  s === 'succeeded' || s === 'failed' || s === 'cancelled' || s === 'timed_out';

/**
 * The lines of one final-scrollback block, keeping only the newest `maxChars` (a window over an array with a moving
 * head and a running character count, so each line costs O(1) amortised). `markEnd` records the last end marker;
 * `text()` is everything before it (or everything, when the block never closed).
 */
/**
 * Whether the open scrollback block takes this line. Everything does, except a `session_ended` line after the block's
 * end marker: the runner prints it right after the block, and it must reach the parser (a pane line that merely looks
 * like it, before the end marker, stays scrollback).
 */
export function blockTakesLine(block: ScrollbackBlock, kind: LogLineKind): boolean {
  return !(block.closed && kind === 'session_ended');
}

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
  skillName: string | null;
  prompt: string | null;
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
  /** The model the run was queued with, else the agent's default; empty when neither exists (agent gone, old run). */
  model: string;
  /** The agent's kind; null when the agent was deleted after queueing. */
  agentKind: AgentKind | null;
  /** The agent's custom API address now (read fresh on a resume); null means the provider's own. */
  baseUrl: string | null;
  /** `runs.agent_id` now (null when the agent was deleted); resume reads it fresh instead of trusting a RunContext. */
  agentId: string | null;
  /** Login and provider user id of the person who triggered the run; null on runs created before they were recorded. */
  triggeredBy: string | null;
  triggeredByExternalId: string | null;
}

export function createRunActivities(deps: RunActivityDeps): RunActivityImpls {
  const { db, kube, clock } = deps;
  const pendingLimitMs = deps.timing?.pendingLimitMs ?? PENDING_LIMIT_MS;
  const pollMs = deps.timing?.pollMs ?? POLL_MS;
  const heartbeatMs = deps.timing?.heartbeatMs ?? HEARTBEAT_MS;
  const reconnectWindowMs = deps.timing?.reconnectWindowMs ?? deps.config.RUN_RECONNECT_WINDOW_SECONDS * 1000;
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
        prompt: runs.prompt,
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
        runModel: runs.model,
        agentModel: agents.model,
        agentKind: agents.provider,
        baseUrl: agents.baseUrl,
        agentId: runs.agentId,
        triggeredBy: runs.triggeredBy,
        triggeredByExternalId: runs.triggeredByExternalId,
      })
      .from(runs)
      .innerJoin(projects, eq(projects.id, runs.projectId))
      .innerJoin(code, eq(code.id, projects.codeConnectionId))
      .innerJoin(board, eq(board.id, projects.boardConnectionId))
      .leftJoin(agents, eq(agents.id, runs.agentId))
      .where(eq(runs.id, runId));
    if (!r) return null;
    let agentKind: AgentKind | null = null;
    if (r.agentKind !== null) {
      const kind = AgentKind.safeParse(r.agentKind);
      if (!kind.success) throw ApplicationFailure.nonRetryable('unknown agent kind');
      agentKind = kind.data;
    }
    const [o] = await tx.select({ slug: organization.slug }).from(organization).where(eq(organization.id, orgId));
    const ticketNumber = r.ticketNumber ?? Number.parseInt(r.ticketRef.replace(/^#/, ''), 10);
    return {
      number: r.number,
      status: RunStatus.parse(r.status),
      command: r.command,
      skillName: r.skillName,
      prompt: r.prompt,
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
      model: r.runModel ?? r.agentModel ?? '',
      agentKind,
      baseUrl: r.baseUrl,
      agentId: r.agentId,
      triggeredBy: r.triggeredBy,
      triggeredByExternalId: r.triggeredByExternalId,
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
   * The stored agent credential, or null when none is set. The Secret name is derived from (org, agent), never
   * read from the database. A store error propagates (it must not look like "no credential").
   */
  async function storedCredential(
    ctx: RunContext,
    agentBaseUrl: string | null,
  ): Promise<{ type: CredentialType; value: string } | null> {
    const secret = await readCredentialSecret(ctx);
    // A credential saved for another address is not a credential for this agent (it is still redacted, see below).
    return secret && credentialMatchesAddress(secret, agentBaseUrl) ? secret : null;
  }

  /** The Secret as stored, whatever address it was saved for: for redaction, and the base of `storedCredential`. */
  async function readCredentialSecret(ctx: RunContext): Promise<ReturnType<typeof parseCredentialSecret>> {
    if (!ctx.agentId) return null;
    const name = credentialSecretName(ctx.orgId, ctx.agentId);
    let stored: Record<string, string> | null;
    try {
      stored = await deps.secrets.get(name);
    } catch (err) {
      // A store error may quote stored content (a parse error over a corrupt value): keep only its name.
      throw ApplicationFailure.retryable('credential store read failed', err instanceof Error ? err.name : 'Error');
    }
    return parseCredentialSecret(stored);
  }

  /** The credential values to redact (values only; the runner env names are not needed). */
  async function credentialValues(ctx: RunContext): Promise<string[]> {
    const cred = await readCredentialSecret(ctx);
    return cred ? [cred.value] : [];
  }

  /**
   * Values to redact from run output. Fails closed: a missing Secret or credential means "no values", but any read
   * error propagates (retryable), so nothing is ever persisted redacted only by the generic patterns.
   */
  async function redactionList(ctx: RunContext): Promise<string[]> {
    const runSecret = await kube.readSecret(runJobName(ctx.runId));
    return [...new Set([...secretValues(runSecret), ...(await credentialValues(ctx))])];
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
          idleEndSeconds: agents.idleEndSeconds,
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
      // The agent's setting. RUN_IDLE_END_SECONDS is a test seam: only a value away from its default overrides it.
      idleEndSeconds:
        deps.config.RUN_IDLE_END_SECONDS !== IDLE_END_SECONDS
          ? deps.config.RUN_IDLE_END_SECONDS
          : (row.idleEndSeconds ?? AGENT_IDLE_END_SECONDS_DEFAULT),
      endingDeadlineSeconds: deps.config.RUN_ENDING_DEADLINE_SECONDS,
      leaseTtlSeconds: deps.config.RUN_LEASE_TTL_SECONDS,
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
    const stored = await storedCredential(resume ? { ...ctx, agentId: d.agentId } : ctx, d.baseUrl);
    // An agent with a credential always has a kind; a run without an agent has no credential.
    if (!stored || d.agentKind === null) {
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
    const adapter = agentAdapterFor(d.agentKind);
    const cred = { [adapter.credentialEnv(stored.type)]: stored.value };
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
        ...promptSourceOf(d),
        ticketKind: d.ticketKind,
        ticketNumber: d.ticketNumber,
        repoPath: d.repoPath,
        args: d.args,
      });
      // Recorded once (only while null), redacted with the same list as run output. The PROMPT env stays as built.
      const finalPrompt = redact(prompt, await redactionList(ctx));
      await withOrg(db, ctx.orgId, (tx) =>
        tx
          .update(runs)
          .set({ finalPrompt })
          .where(and(eq(runs.id, ctx.runId), isNull(runs.finalPrompt))),
      );
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
        agentEnv: adapter.launchEnv({ model: d.model, baseUrl: d.baseUrl }),
        deadlineSeconds: opts.deadlineSeconds ?? ctx.timeoutSeconds,
        resume,
        botName: deps.config.BOT_NAME,
        botEmail: deps.config.BOT_EMAIL,
        author: resolveRunAuthor(d, { name: deps.config.BOT_NAME, email: deps.config.BOT_EMAIL }, codeHost),
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
    if (kind === 'queued') {
      return `Agent Desk queued run #${d.number} (\`/${oneLine(d.command)}\`): every execution slot for this project is in use. It will start as soon as one is free.\n\nFollow it here: ${link}`;
    }
    if (kind === 'start') {
      const via = d.prompt !== null ? 'custom prompt' : `skill \`${oneLine(d.skillName ?? '')}\``;
      return `Agent Desk started run #${d.number} (\`/${oneLine(d.command)}\`, ${via}).\n\nFollow it here: ${link}`;
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
    const secrets = await credentialValues(ctx);
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

  // The agent shares the container and can print a forged end line: the result is a hint, never authority.
  /**
   * The reason of the newest stored `session_ended` event after `floor`, if any. The entrypoint exits with the code it
   * prints, so a line whose code differs from the pod's real exit code (`exitCode`, when known) is not the runner's and
   * is ignored.
   */
  async function findEndReason(ctx: RunContext, floor: number, exitCode?: number): Promise<EndReason | undefined> {
    const [row] = await withOrg(db, ctx.orgId, (tx) =>
      tx
        .select({ payload: runEvents.payload })
        .from(runEvents)
        .where(
          and(
            eq(runEvents.runId, ctx.runId),
            eq(runEvents.type, 'lifecycle'),
            gt(runEvents.seq, floor),
            sql`${runEvents.payload} ->> 'kind' = 'session_ended'`,
          ),
        )
        .orderBy(desc(runEvents.seq))
        .limit(1),
    );
    const parsed = EndMarkerPayload.safeParse(row?.payload);
    if (!parsed.success) return undefined;
    if (exitCode !== undefined && parsed.data.code !== exitCode) return undefined;
    return parsed.data.reason;
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
    // Transcript entries go to their own table, not run_events, so a replayed line is deduped by source id there.
    const transcriptSink = createTranscriptSink({
      db,
      orgId: ctx.orgId,
      runId: ctx.runId,
      now: () => clock.now(),
      warn: (msg, fields) => log.warn(msg, fields),
    });
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

    const tailText = (): string | undefined =>
      scrollbackTail ?? (textTail.length > 0 ? textTail.join('\n').slice(-SCROLLBACK_TAIL_CHARS) : undefined);

    return followPodLog<FollowPodLogsResult>(
      {
        kube,
        clock,
        pendingLimitMs,
        pollMs,
        heartbeatMs,
        reconnectWindowMs,
      },
      {
        what: 'follow pod logs',
        // Fixed wording plus the classified cause code: never a raw error message.
        contact: {
          lost: (cause, at) =>
            appendContactEvent(ctx, at, `Lost contact with the cluster (${cause}). Retrying.`, 'contact_lost'),
          restored: (downMs, at) =>
            appendContactEvent(
              ctx,
              at,
              `Contact with the cluster restored after ${windowMinutes(downMs)} min.`,
              'contact_restored',
            ),
        },
        onContactLost: async () => {
          const pre = await findSetupState(ctx, -1, resume ? await floorOf() : 0);
          // Without a started agent there is no session to keep: a real failure, not retried.
          if (!pre.agentStarted) {
            throw ApplicationFailure.nonRetryable('lost contact with the cluster before the agent started');
          }
          const tail = tailText();
          return {
            done: {
              exitCode: -1,
              ...(tail !== undefined ? { scrollbackTail: tail } : {}),
              agentStarted: true,
              podLost: true as const,
              contactLost: true as const,
              lostText: `lost contact with the cluster for ${windowMinutes(reconnectWindowMs)} min`,
            },
          };
        },
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
          const kind = parseLogLine(line).kind;
          if (kind === 'scrollback_end') block.markEnd();
          else if (!blockTakesLine(block, kind)) return false;
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
          } else if (parsed.kind === 'session_ended' && parsed.end) {
            // Only the reason and the code are stored (never the line); read back in afterStream, so a retry keeps it.
            await withOrg(db, ctx.orgId, (tx) =>
              storeLineEvent(tx, ctx, floor, 'lifecycle', index, {
                kind: parsed.kind,
                reason: parsed.end?.reason,
                code: parsed.end?.code,
              }),
            );
            // Inside an unfinished scrollback block the durable line must not move (flushBlock does it); the event is
            // keyed by its line, so a replay dedupes.
            if (block) return 'skipDurable';
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
          } else if (parsed.kind === 'transcript' && parsed.transcript) {
            // Redacted and stored by the sink (never written to run_events, logs or workflow history).
            await transcriptSink.store(parsed.transcript, secrets);
          } else if (parsed.kind === 'text') {
            textTail.push(redact(line, secrets));
            if (textTail.length > TEXT_TAIL_LINES) textTail.shift();
          }
          return undefined;
        },
        afterStream: async (pass) => {
          await pass.throwIfCancelled();
          const exitCode = await waitForExit(ctx, pass.signal, pass.cluster);
          await pass.throwIfCancelled();
          // The log stream dropped while the container still runs: re-attach. An unfinished block is not stored; the
          // next pass re-reads it from its begin line (`durable` never passed it).
          if (exitCode === 'running') return 'reattach';
          await flushBlock(pass, pass.index);
          await pass.flushPending();
          pass.markDurable(pass.index);
          pass.beat();
          const pre = await findSetupState(
            ctx,
            typeof exitCode === 'object' ? -1 : exitCode,
            resume ? await floorOf() : 0,
          );
          const tail = tailText();
          if (typeof exitCode === 'object') {
            // A pod that vanished before the agent began is a real failure: keep it loud and not retryable.
            if (!pre.agentStarted) {
              throw ApplicationFailure.nonRetryable(exitCode.gone);
            }
            const lost = await findEndReason(ctx, resume ? await floorOf() : 0);
            return {
              done: {
                exitCode: -1,
                ...(tail !== undefined ? { scrollbackTail: tail } : {}),
                agentStarted: true,
                podLost: true as const,
                lostText: exitCode.gone,
                ...(lost ? { endReason: lost } : {}),
              },
            };
          }
          const endReason = await findEndReason(ctx, resume ? await floorOf() : 0, exitCode);
          // The runner exits 79 when the volume holds no started session: nothing to continue (not a setup failure).
          const resumeFailed = resume && exitCode === RESUME_FAILED_EXIT_CODE && !pre.agentStarted;
          return {
            done: {
              exitCode,
              ...(endReason ? { endReason } : {}),
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

  /**
   * The container's exit code once its log ended; 'running' when it still runs (the stream merely dropped);
   * `{ gone }` (the failure text) when the pod no longer exists or ended with no exit code. The caller decides whether
   * that is a failure (before `session_started`) or a lost pod.
   */
  async function waitForExit(
    ctx: RunContext,
    signal: AbortSignal,
    cluster: FollowPass['cluster'],
  ): Promise<number | 'running' | { gone: string }> {
    const deadline = clock.now().getTime() + EXIT_WAIT_MS;
    for (;;) {
      const pod = await cluster(() => kube.getRunPod(runJobName(ctx.runId)));
      if (!pod) return { gone: 'the run pod disappeared before it reported an exit code' };
      if (pod.exitCode !== null) return pod.exitCode;
      if (clock.now().getTime() > deadline) {
        if (pod.phase === 'Running') return 'running';
        const reason = pod.reason ? `: ${oneLine(pod.reason).slice(0, ERROR_MESSAGE_MAX)}` : '';
        return { gone: `the run pod ended (${pod.phase}) without an exit code${reason}` };
      }
      if (signal.aborted) return 'running';
      await sleep(pollMs, signal);
    }
  }

  // ---- endSession, deleteJob, ensureJobGone

  /** Runs a fixed argv in the pod and resolves with its exit code, or 0 when it did not close in time (nothing to learn). */
  async function execAndWait(podName: string, command: string[]): Promise<number> {
    const session = await kube.exec(podName, command, { tty: false });
    return new Promise<number>((resolve) => {
      const t = setTimeout(() => {
        session.close();
        resolve(0);
      }, EXEC_CLOSE_WAIT_MS);
      // The code is returned as is. For `agentdesk-end`, any non-zero code other than 127 means the request may not have
      // been made; this is not retried here, and the `ending` deadline (the Job is deleted) covers it.
      session.onClose((code) => {
        clearTimeout(t);
        resolve(code);
      });
    });
  }

  async function endSession(ctx: RunContext): Promise<void> {
    // Before the exec, so the page can say the session is ending as soon as the end begins. The first moment is kept on
    // a retry, and the status write that parks or finishes the run clears it.
    await withOrg(db, ctx.orgId, async (tx) => {
      const changed = await tx
        .update(runs)
        .set({ sessionEndingAt: clock.now() })
        .where(and(eq(runs.id, ctx.runId), isNull(runs.sessionEndingAt)))
        .returning({ id: runs.id });
      // No status or event changes, so the page would never hear of "pausing": wake the open streams (like every status
      // write does), in this same transaction and only when the column changed.
      if (changed.length > 0)
        await notifyRunStatus(tx, { orgId: ctx.orgId, runId: ctx.runId, seq: await currentSeq(tx, ctx.runId) });
    });
    try {
      const pod = await kube.getRunPod(runJobName(ctx.runId));
      if (!pod || pod.phase !== 'Running') return; // nothing to end
      // The fixed in-image command asks the runner to end the session. Exit 127 means an old pod image without it: then
      // (once) the old tmux kill. Remove the fallback 7 days after the new image is live.
      const code = await execAndWait(pod.name, [...END_COMMAND]);
      if (code === EXEC_NOT_FOUND) await execAndWait(pod.name, [...TMUX_KILL]);
    } catch (err) {
      throw clusterError(err, 'end session');
    }
  }

  /**
   * The failure for a cluster call (the Job delete, session end and cleanup run under an unlimited retry policy): an
   * HTTP 4xx other than 429 is permanent, so it must not be retried for ever; anything else is today's retryable error.
   */
  function clusterError(err: unknown, what: string): Error {
    const kind = classifyKubeError(err);
    return kind.kind === 'permanent' ? clusterRefused(what, kind.status) : safeError(err, [], what);
  }

  async function deleteJob(ctx: RunContext): Promise<void> {
    const name = runJobName(ctx.runId);
    try {
      await kube.deleteJob(name);
      await kube.deleteSecret(name);
    } catch (err) {
      throw clusterError(err, 'delete run Job');
    }
  }

  /** Whole minutes of a duration, at least 1 (the contact event texts and the parked-run text). */
  function windowMinutes(ms: number): number {
    return Math.max(1, Math.round(ms / 60_000));
  }

  /** A `lifecycle` event about the cluster connection: fixed text, no line key (not tied to a log line). */
  async function appendContactEvent(
    ctx: RunContext,
    at: Date,
    text: string,
    kind: 'contact_lost' | 'contact_restored',
  ): Promise<void> {
    await withOrg(db, ctx.orgId, async (tx) => {
      const ev = await appendRunEvent(tx, ctx.orgId, {
        runId: ctx.runId,
        type: 'lifecycle',
        payload: { kind, text },
        ts: at,
      });
      if (!ev) throw ApplicationFailure.nonRetryable('run not found');
    });
  }

  async function recordEndingDeadline(ctx: RunContext, input: { scrollbackSaved: boolean; at: string }): Promise<void> {
    const ts = new Date(input.at);
    if (Number.isNaN(ts.getTime())) throw ApplicationFailure.nonRetryable('invalid timestamp');
    const text = `The session did not end in time; the pod was stopped.${input.scrollbackSaved ? '' : ' Final scrollback not saved.'}`;
    await withOrg(db, ctx.orgId, async (tx) => {
      const ev = await appendRunEvent(tx, ctx.orgId, {
        runId: ctx.runId,
        type: 'lifecycle',
        payload: { kind: 'ending_deadline', text },
        ts,
      });
      if (!ev) throw ApplicationFailure.nonRetryable('run not found');
    });
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
      throw clusterError(err, 'clean up run Job');
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
    redactionValues: credentialValues,
  });

  return {
    loadRun: guarded('load run', loadRun),
    createRunSecretAndJob: guarded('create run Job', createRunSecretAndJob),
    refreshWorkspaceToken: guarded('refresh workspace token', refreshWorkspaceToken),
    postComment: guarded('post comment', postComment),
    followPodLogs: guarded('follow pod logs', followPodLogs),
    endSession: guarded('end session', endSession),
    deleteJob: guarded('delete run Job', deleteJob),
    recordEndingDeadline: guarded('record ending deadline', recordEndingDeadline),
    ensureJobGone: guarded('clean up run Job', ensureJobGone),
    deleteRunVolume: guarded('delete run volume', deleteRunVolume),
    parkRun: guarded('park run', session.parkRun),
    endKeptSession: guarded('end kept session', session.endKeptSession),
    restoreParked: guarded('restore parked run', session.restoreParked),
  };
}
