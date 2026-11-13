import { Context } from '@temporalio/activity';
import { ApplicationFailure, CancelledFailure } from '@temporalio/common';
import { z } from 'zod';
import {
  SetupLogTracker,
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
}

// ---- Pending wait

/** The pod once it has left Pending; throws a non-retryable `POD_PENDING_TIMEOUT` after `pendingLimitMs`. */
export async function waitForPod(env: FollowEnv, jobName: string, signal: AbortSignal): Promise<RunPod> {
  let firstSeen: Date | null = null;
  for (;;) {
    if (signal.aborted) throw new CancelledFailure('cancelled');
    const pod = await env.kube.getRunPod(jobName);
    if (pod && pod.phase !== 'Pending' && pod.phase !== 'Unknown') return pod;
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

const HeartbeatDetails = z.object({ lastLine: z.number().int().min(0) });

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
}

export interface FollowHooks<R> {
  /** Used in the redacted, bounded error message of an unexpected failure. */
  what: string;
  jobName: string;
  /** Values to redact from output. Must fail closed: a read error propagates, never "no values". */
  secrets(): Promise<string[]>;
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
  const beat = (): void => actx.heartbeat({ lastLine: durable });
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
  try {
    secrets = await hooks.secrets();
    for (;;) {
      const pod = await waitForPod(env, hooks.jobName, ac.signal);
      // State of one pass over the log. Output in the tracker's buffer is not durable until stored as a chunk.
      let index = 0;
      let lastOutputIndex = 0;
      let bufferStart = 0;
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
      };

      const skip = durable;
      for await (const line of env.kube.streamLogs(pod.name, ac.signal)) {
        index += 1;
        if (index <= skip) continue;
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
      const after = await hooks.afterStream(pass);
      if (after === 'reattach') continue;
      return after.done;
    }
  } catch (err) {
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
