import { Context } from '@temporalio/activity';
import { ApplicationFailure, CancelledFailure } from '@temporalio/common';
import { z } from 'zod';
import {
  CLUSTER_PERMANENT_ERROR,
  SetupLogTracker,
  classifyKubeError,
  parseLogLine,
  redact,
  type Clock,
  type KubeGateway,
  type ParsedLogLine,
  type RunPod,
  type SetupLogEffect,
} from '@agentdesk/core';
import type { Tx } from '@agentdesk/db';
import {
  ERROR_MESSAGE_MAX,
  SETUP_CHUNK_LINES,
  SETUP_OUTPUT_MAX_CHARS,
  oneLine,
  safeError,
  sleep,
} from './activity-utils';
import { POD_PENDING_TIMEOUT } from './run.activities';

/**
 * The pod-log follow machinery shared by run Jobs and setup-test Jobs: the Pending wait, the per-line event store
 * (dedupe by log line under a row lock), the seq-assigning event append, the stored-output budget, and the follow loop
 * (heartbeat, cancel wiring, per-pass tracker seeding, `durable` / buffer / chunk-key bookkeeping, re-attach). It knows
 * nothing about runs or setup tests: callers plug in their events, their per-line reactions and their result through
 * `FollowHooks`.
 */

export interface FollowEnv {
  kube: KubeGateway;
  clock: Clock;
  /** Pod Pending limit. */
  pendingLimitMs: number;
  /** Poll interval while waiting for the pod. */
  pollMs: number;
  heartbeatMs: number;
  /** How long the cluster may stay unreachable before the follower gives up (see `ContactLostError`). */
  reconnectWindowMs: number;
  /** How often the redaction list is re-read while following (the workspace token rotates during long runs). */
  redactionRefreshMs?: number;
}

/**
 * Default redaction refresh interval. The kubelet updates the mounted token file about 1-2 min after the Secret is
 * rewritten, so a short interval lets the follower learn a rotated token before the pod can print it.
 */
export const REDACTION_REFRESH_MS = 30_000;

/** Rotated values kept beyond the first read (one token per ~45 min, so about 6 h, far past a token's 1 h life). */
export const REDACTION_EXTRA_KEEP = 8;

export interface SecretAccumulator {
  /** Folds in a fresh read and returns the bounded list: first-read values, then the most recent extras. */
  merge(next: readonly string[]): string[];
}

/**
 * Accumulates redaction values across re-reads without growing for the whole run (`redact` cost is per entry). The
 * values of the first read (credential and first token) are always kept; of later reads only the latest `maxExtra`
 * distinct new values stay.
 */
export function createSecretAccumulator(maxExtra: number = REDACTION_EXTRA_KEEP): SecretAccumulator {
  let base: string[] | null = null;
  let extras: string[] = [];
  return {
    merge(next) {
      if (base === null) {
        base = [...new Set(next)];
      } else {
        const known = new Set([...base, ...extras]);
        for (const v of next) {
          if (!known.has(v)) {
            known.add(v);
            extras.push(v);
          }
        }
        extras = extras.slice(Math.max(0, extras.length - maxExtra));
      }
      return [...base, ...extras];
    },
  };
}

// ---- Reconnecting

export const RECONNECT_INITIAL_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;
/** A backoff wait is cut into slices of at most this long, each preceded by a heartbeat (the timeout is 60 s). */
const RECONNECT_BEAT_SLICE_MS = 10_000;

/** Where the "cluster unreachable" / "cluster reachable again" events go. */
export interface ContactEvents {
  lost(cause: string, at: Date): Promise<void>;
  restored(downMs: number, at: Date): Promise<void>;
}

/** The cluster stayed unreachable for the whole reconnect window. `lostSinceMs` is the epoch ms of the first failure. */
export class ContactLostError extends Error {
  constructor(readonly lostSinceMs: number) {
    super('cluster contact lost');
    this.name = 'ContactLostError';
  }
}

export interface Reconnector {
  /** Epoch ms when the open outage began; null when there is none. */
  readonly lostSinceMs: number | null;
  /** Records a failed contact, then waits the next jittered backoff; throws `ContactLostError` once the window ran out. */
  lost(cause: string): Promise<void>;
  /** Contact worked again: closes an open outage. */
  restored(): Promise<void>;
  /**
   * Runs `fn`, retrying transient cluster errors with backoff. A permanent error becomes a non-retryable
   * `ClusterPermanentError`; anything else is rethrown. `settled` (default: always) says whether a result proves the
   * cluster is back; an unsettled result leaves the outage open.
   */
  call<T>(fn: () => Promise<T>, opts?: { settled?: (value: T) => boolean }): Promise<T>;
}

/** The non-retryable failure for a cluster call that was refused (HTTP 4xx other than 429). Carries no cluster text. */
export function clusterRefused(what: string, status: number): ApplicationFailure {
  return ApplicationFailure.nonRetryable(
    `${what}: cluster refused the request (HTTP ${status})`,
    CLUSTER_PERMANENT_ERROR,
  );
}

export function createReconnector(o: {
  clock: Clock;
  windowMs: number;
  signal: AbortSignal;
  beat: () => void;
  lostSinceMs: number | null;
  events?: ContactEvents;
  random?: () => number;
  /** Names the caller in the permanent-error message. */
  what?: string;
}): Reconnector {
  const random = o.random ?? Math.random;
  const what = o.what ?? 'cluster call';
  let lostSince = o.lostSinceMs;
  let attempt = 0;
  /** Event writes not yet stored, oldest first: a failed write stays here and is retried on the next call. */
  const pending: (() => Promise<void>)[] = [];
  const flush = async (): Promise<void> => {
    for (let next = pending[0]; next !== undefined; next = pending[0]) {
      try {
        await next();
      } catch {
        return; // retried on the next lost() / restored()
      }
      pending.shift();
    }
  };
  const nowMs = (): number => o.clock.now().getTime();
  const cancelled = (): CancelledFailure => new CancelledFailure('cancelled');

  const self: Reconnector = {
    get lostSinceMs() {
      return lostSince;
    },
    async lost(cause) {
      if (o.signal.aborted) throw cancelled();
      const at = o.clock.now();
      if (lostSince === null) {
        lostSince = at.getTime();
        attempt = 0;
        const since = lostSince;
        if (o.events) {
          const events = o.events;
          pending.push(() => events.lost(cause, new Date(since)));
        }
      }
      await flush();
      const elapsed = at.getTime() - lostSince;
      if (elapsed >= o.windowMs) throw new ContactLostError(lostSince);
      const base = Math.min(RECONNECT_MAX_MS, RECONNECT_INITIAL_MS * 2 ** attempt);
      attempt += 1;
      // Equal jitter: between half and all of the step, so runs that lost contact together drift apart.
      let remaining = Math.min(base / 2 + (random() * base) / 2, o.windowMs - elapsed);
      while (remaining > 0) {
        o.beat();
        const slice = Math.min(remaining, RECONNECT_BEAT_SLICE_MS);
        await sleep(slice, o.signal);
        if (o.signal.aborted) throw cancelled();
        remaining -= slice;
      }
      o.beat();
    },
    async restored() {
      if (lostSince !== null) {
        const downMs = nowMs() - lostSince;
        const at = o.clock.now();
        lostSince = null;
        attempt = 0;
        if (o.events) {
          const events = o.events;
          pending.push(() => events.restored(downMs, at));
        }
      }
      await flush();
    },
    async call(fn, opts) {
      for (;;) {
        try {
          const value = await fn();
          if (opts?.settled?.(value) ?? true) await self.restored();
          return value;
        } catch (err) {
          if (err instanceof ContactLostError || err instanceof CancelledFailure || o.signal.aborted) throw err;
          const kind = classifyKubeError(err);
          if (kind.kind === 'permanent') throw clusterRefused(what, kind.status);
          if (kind.kind === 'other') throw err;
          await self.lost(kind.cause);
        }
      }
    },
  };
  return self;
}

// ---- Pending wait

/** The pod once it has left Pending; throws a non-retryable `POD_PENDING_TIMEOUT` after `pendingLimitMs`. */
export async function waitForPod(
  env: FollowEnv,
  jobName: string,
  signal: AbortSignal,
  opts: { cluster?: Reconnector; seenStarted?: boolean; holdOutage?: () => boolean } = {},
): Promise<RunPod> {
  const { cluster, seenStarted, holdOutage } = opts;
  const started = (p: RunPod | null): boolean => p !== null && p.phase !== 'Pending' && p.phase !== 'Unknown';
  let firstSeen: Date | null = null;
  for (;;) {
    if (signal.aborted) throw new CancelledFailure('cancelled');
    const pod = cluster
      ? await cluster.call(() => env.kube.getRunPod(jobName), {
          settled: (p) => !holdOutage?.() && (!seenStarted || started(p)),
        })
      : await env.kube.getRunPod(jobName);
    if (pod && started(pod)) return pod;
    if (cluster && seenStarted && pod) {
      // The pod ran before: Unknown or Pending now means the node lost contact, not a pod that cannot start.
      await cluster.lost('pod_unknown');
      continue;
    }
    const at = env.clock.now();
    firstSeen ??= at;
    const since = pod?.pendingSince ?? firstSeen;
    if (at.getTime() - since.getTime() > env.pendingLimitMs) {
      const reason = pod?.reason ? oneLine(pod.reason).slice(0, ERROR_MESSAGE_MAX) : 'no pod was created';
      throw ApplicationFailure.create({
        type: POD_PENDING_TIMEOUT,
        nonRetryable: true,
        message: `pod pending for over ${Math.round(env.pendingLimitMs / 1000)} s: ${reason}`,
      });
    }
    await sleep(env.pollMs, signal);
  }
}

// ---- Events

/** What the line-event store needs of an events table (one owner: a run, a setup test). Run inside `withOrg`. */
export interface LineEventTable<T extends string> {
  /** Takes the owner's row lock (SELECT ... FOR UPDATE) so concurrent writers serialise. */
  lock(tx: Tx): Promise<void>;
  /** Whether an event of one of `types` already carries `line` in its payload. */
  hasLine(tx: Tx, types: readonly T[], line: number): Promise<boolean>;
  /** Appends with the next seq; false when the owner does not exist. */
  append(tx: Tx, type: T, payload: Record<string, unknown>): Promise<boolean>;
}

/**
 * Inserts an event for pod log line `line` unless one exists (the dedupe key of a retried or re-attached follow: the
 * same log line always has the same number). Returns whether it inserted.
 */
export async function storeLineEvent<T extends string>(
  tx: Tx,
  table: LineEventTable<T>,
  dedupeTypes: readonly T[],
  type: T,
  line: number,
  payload: Record<string, unknown>,
): Promise<boolean> {
  await table.lock(tx);
  if (await table.hasLine(tx, dedupeTypes, line)) return false;
  return table.append(tx, type, { line, ...payload });
}

/** What the seq-assigning append needs of an events table. */
export interface SeqEventTable {
  /** Locks the owner row; false when it does not exist. */
  lockOwner(tx: Tx): Promise<boolean>;
  /** Highest seq stored for the owner (0 when none). */
  maxSeq(tx: Tx): Promise<number>;
  insert(tx: Tx, seq: number): Promise<void>;
}

/**
 * Appends an event with the next per-owner seq. The owner row lock serialises concurrent appenders, so seqs stay unique
 * and gapless. Must run inside `withOrg`. Returns null when the owner does not exist.
 */
export async function appendSeqEvent(tx: Tx, table: SeqEventTable): Promise<{ seq: number } | null> {
  if (!(await table.lockOwner(tx))) return null;
  const next = (await table.maxSeq(tx)) + 1;
  await table.insert(tx, next);
  return { seq: next };
}

const StoredOutputPayload = z.object({ text: z.string(), truncated: z.boolean().optional() });

/** Output already stored for an owner (all passes and attempts): characters spent and whether it was truncated. */
export function outputBudget(payloads: readonly unknown[]): { chars: number; truncated: boolean } {
  let chars = 0;
  let truncated = false;
  for (const payload of payloads) {
    const p = StoredOutputPayload.safeParse(payload);
    if (!p.success) continue;
    chars += p.data.text.length + 1;
    truncated ||= p.data.truncated === true;
  }
  return { chars, truncated };
}

// ---- Follow loop

const HeartbeatDetails = z.object({ lastLine: z.number().int().min(0), lostSinceMs: z.number().optional() });

/** One pass over the pod's log, as the hooks see it. */
export interface FollowPass {
  /** 1-based number of the log line being handled (or the last one, once the stream ended). */
  readonly index: number;
  readonly signal: AbortSignal;
  /** Raises the durable line (never lowers it). Lines up to it are skipped by the next attempt. */
  markDurable(line: number): void;
  beat(): void;
  /** Throws the CancelledFailure when the activity was cancelled. */
  throwIfCancelled(): Promise<void>;
  /** Stores any output still buffered in the tracker (keyed by its last line). */
  flushPending(): Promise<void>;
  /** Runs a cluster query with the pass's reconnect handling (transient errors wait and retry). */
  cluster<T>(fn: () => Promise<T>): Promise<T>;
}

export interface FollowHooks<R> {
  /** Used in the redacted, bounded error message of an unexpected failure. */
  what: string;
  jobName: string;
  /**
   * Values to redact from output. The first read must fail closed: an error propagates, never "no values". It is
   * re-read periodically; a failed re-read keeps the last good list, and values seen earlier are never dropped.
   */
  secrets(): Promise<string[]>;
  /** Where contact-lost / contact-restored events go. Without it the outage is only waited out. */
  contact?: ContactEvents;
  /** The cluster stayed unreachable for the whole window. Return the result that ends the follow, or throw. */
  onContactLost(): Promise<{ done: R }>;
  storedBudget(): Promise<{ chars: number; truncated: boolean }>;
  /** Stores one lifecycle event under the dedupe key `line` (a marker's own line, or a chunk's last line). */
  storeLifecycle(line: number, payload: Record<string, unknown>): Promise<void>;
  /** A new pass over the log begins (also after a re-attach). */
  beginPass?(): void;
  /** First look at a raw line; true means the hook consumed it (no parse, no durable update). */
  onRawLine?(pass: FollowPass, line: string): Promise<boolean>;
  /**
   * A line was parsed and its setup/plugin effects stored. Return `{ done }` to end the follow with that result, or
   * 'skipDurable' to leave the durable line unchanged for this line.
   */
  onParsed?(pass: FollowPass, parsed: ParsedLogLine, line: string): Promise<{ done: R } | 'skipDurable' | undefined>;
  /** The log stream ended: finish with `{ done }`, or 'reattach' when the container still runs. */
  afterStream(pass: FollowPass): Promise<{ done: R } | 'reattach'>;
}

/**
 * Follows a pod's log until a hook finishes it. Heartbeats `{ lastLine }` (lines whose effects are durable) so a retry
 * resumes after them. Setup/plugin output goes through one SetupLogTracker per pass, seeded from storage so the output
 * cap holds across passes and retries; each output line is redacted before it is buffered. A marker event is keyed by
 * its own line, an output chunk by its last line (an output line never carries another event), so replays dedupe.
 */
export async function followPodLog<R>(env: FollowEnv, hooks: FollowHooks<R>): Promise<R> {
  const actx = Context.current();
  const resumed = HeartbeatDetails.safeParse(actx.info.heartbeatDetails);
  /** Lines whose effects are durable; the next attempt skips them. */
  let durable = resumed.success ? resumed.data.lastLine : 0;
  let cluster: Reconnector | null = null;
  const seededLostSince = resumed.success ? (resumed.data.lostSinceMs ?? null) : null;
  const beat = (): void => {
    const lostSinceMs = cluster ? cluster.lostSinceMs : seededLostSince;
    actx.heartbeat(lostSinceMs === null ? { lastLine: durable } : { lastLine: durable, lostSinceMs });
  };
  beat();
  const timer = setInterval(beat, env.heartbeatMs);
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
  const accumulator = createSecretAccumulator();
  const refreshMs = env.redactionRefreshMs ?? REDACTION_REFRESH_MS;
  let refreshedAt = env.clock.now().getTime();
  /** Re-reads the list when due, accumulating. A failure keeps the last good list (the error may hold secrets). */
  const refreshSecrets = async (): Promise<void> => {
    const at = env.clock.now().getTime();
    if (at - refreshedAt < refreshMs) return;
    refreshedAt = at;
    try {
      secrets = accumulator.merge(await hooks.secrets());
    } catch {
      // keep the last good list; never log the error
    }
  };
  const reconnector = createReconnector({
    clock: env.clock,
    windowMs: env.reconnectWindowMs,
    signal: ac.signal,
    beat,
    lostSinceMs: seededLostSince,
    events: hooks.contact,
    what: hooks.what,
  });
  cluster = reconnector;
  let passRan = false;
  // An outage restored from a heartbeat may have come from the stream: only a line or a clean end proves it over.
  let streamDown = seededLostSince !== null;
  try {
    // Fail closed: never follow without the redaction list, but wait out a cluster outage to get it.
    secrets = accumulator.merge(await reconnector.call(() => hooks.secrets(), { settled: () => !streamDown }));
    refreshedAt = env.clock.now().getTime();
    pass: for (;;) {
      const pod = await waitForPod(env, hooks.jobName, ac.signal, {
        cluster: reconnector,
        seenStarted: durable > 0 || passRan,
        // A log stream that failed is still down: a pod lookup answering does not end that outage.
        holdOutage: () => streamDown,
      });
      passRan = true;
      // State of one pass over the log. Output in the tracker's buffer is not durable until stored as a chunk.
      let index = 0;
      let lastOutputIndex = 0;
      let bufferStart = 0;
      await refreshSecrets();
      hooks.beginPass?.();
      // Seeded from storage so the cap (and the single truncated chunk) hold across re-attaches and retries.
      const budget = await hooks.storedBudget();
      const tracker = new SetupLogTracker({
        chunkLines: SETUP_CHUNK_LINES,
        maxChars: SETUP_OUTPUT_MAX_CHARS,
        initialChars: budget.chars,
        alreadyTruncated: budget.truncated || budget.chars >= SETUP_OUTPUT_MAX_CHARS,
      });
      /** A marker event is keyed by its own line, an output chunk by its last line. */
      const storeEffects = async (effects: SetupLogEffect[], lineIndex: number, chunkKey: number): Promise<void> => {
        for (const effect of effects) {
          if (effect.kind === 'output') {
            await hooks.storeLifecycle(chunkKey, { ...effect.payload, text: redact(effect.payload.text, secrets) });
          } else {
            await hooks.storeLifecycle(lineIndex, effect.payload);
          }
        }
      };
      const pass: FollowPass = {
        get index() {
          return index;
        },
        signal: ac.signal,
        markDurable: (line) => {
          durable = Math.max(durable, line);
        },
        beat,
        throwIfCancelled,
        flushPending: () => storeEffects(tracker.flush(), index, lastOutputIndex),
        cluster: (fn) => reconnector.call(fn),
      };

      const skip = durable;
      const lines = env.kube.streamLogs(pod.name, ac.signal)[Symbol.asyncIterator]();
      let gotLine = false;
      try {
        for (;;) {
          let next: IteratorResult<string>;
          try {
            next = await lines.next();
          } catch (err) {
            if (ac.signal.aborted) throw err; // our own cancel, not an outage
            const kind = classifyKubeError(err);
            if (kind.kind === 'permanent') throw clusterRefused(hooks.what, kind.status);
            if (kind.kind === 'other') throw err;
            streamDown = true;
            await reconnector.lost(kind.cause);
            continue pass; // re-attach; lines up to `durable` are skipped
          }
          if (next.done) {
            streamDown = false;
            await reconnector.restored();
            break;
          }
          const line = next.value;
          if (!gotLine) {
            gotLine = true;
            streamDown = false;
            await reconnector.restored();
          }
          index += 1;
          if (index <= skip) continue;
          await refreshSecrets();
          if (hooks.onRawLine && (await hooks.onRawLine(pass, line))) continue;
          const parsed = parseLogLine(line);
          const isOutput = parsed.kind === 'setup_output' || parsed.kind === 'plugin_output';
          const prevOutputIndex = lastOutputIndex;
          // Redact each output line before it is buffered and budgeted, so a cut can never split a secret.
          const effects = tracker.push(isOutput ? { ...parsed, text: redact(parsed.text, secrets) } : parsed);
          if (isOutput) lastOutputIndex = index;
          if (isOutput && tracker.pendingLines === 1) bufferStart = index; // this line opened a new buffer
          await storeEffects(effects, index, isOutput && tracker.pendingLines === 0 ? index : prevOutputIndex);
          const step = await hooks.onParsed?.(pass, parsed, line);
          if (step === 'skipDurable') continue;
          if (step) return step.done;
          // Output still buffered (not yet stored) is not durable: a retry must re-read it.
          durable = Math.max(durable, tracker.pendingLines === 0 ? index : bufferStart - 1);
          beat();
        }
      } finally {
        await lines.return?.();
      }
      const after = await hooks.afterStream(pass);
      if (after === 'reattach') continue;
      return after.done;
    }
  } catch (err) {
    if (err instanceof ContactLostError) {
      try {
        return (await hooks.onContactLost()).done;
      } catch (e) {
        throw safeError(e, secrets, hooks.what);
      }
    }
    if (actx.cancellationSignal.aborted && !(err instanceof ApplicationFailure)) {
      await throwIfCancelled();
    }
    throw safeError(err, secrets, hooks.what);
  } finally {
    clearInterval(timer);
    actx.cancellationSignal.removeEventListener('abort', onCancel);
    ac.abort();
  }
}
